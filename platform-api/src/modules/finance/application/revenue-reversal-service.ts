import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { FinancialLedgerPostingResult } from "../domain/financial-ledger.js";
import type {
  RevenueReversalRequestedLine,
  RevenueReversalResult
} from "../domain/revenue-reversal.js";
import {
  RevenueReversalRepository,
  type RecognizedRevenueSource,
  type RevenueReversalLineRecord,
  type RevenueReversalRecord
} from "../infrastructure/revenue-reversal-repository.js";
import { FinancialLedgerPostingService } from "./financial-ledger-posting-service.js";

const OPERATION_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const REASON_PATTERN = /^[A-Z0-9_]{2,64}$/;

function sumMoney(values: number[]): number {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConflictError("Revenue reversal contains an invalid money amount");
    }
    total += BigInt(value);
  }

  const result = Number(total);
  if (!Number.isSafeInteger(result)) {
    throw new ConflictError("Revenue reversal exceeds safe integer money limits");
  }
  return result;
}

function validateRequestedLines(lines: RevenueReversalRequestedLine[]): void {
  if (lines.length < 1 || lines.length > 100) {
    throw new ValidationError("Revenue reversal requires between 1 and 100 lines");
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (typeof line.revenueScheduleLineId !== "string" || line.revenueScheduleLineId.length < 1) {
      throw new ValidationError("Revenue reversal line requires a revenue schedule line id");
    }

    if (seen.has(line.revenueScheduleLineId)) {
      throw new ValidationError("Revenue reversal cannot repeat the same revenue schedule line");
    }
    seen.add(line.revenueScheduleLineId);

    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) {
      throw new ValidationError("Revenue reversal line amount must be a positive safe integer");
    }
  }
}

export class RevenueReversalService {
  constructor(
    private readonly repository = new RevenueReversalRepository(),
    private readonly ledger = new FinancialLedgerPostingService(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async postAndValidateJournals(
    trx: Transaction<Database>,
    reversal: RevenueReversalRecord,
    lines: RevenueReversalLineRecord[],
    request: RequestMetadata
  ): Promise<FinancialLedgerPostingResult[]> {
    const postings: FinancialLedgerPostingResult[] = [];

    for (const line of lines) {
      postings.push(
        await this.ledger.postRevenueReversed(
          trx,
          {
            organizationId: reversal.organization_id,
            propertyId: reversal.property_id,
            reservationId: reversal.reservation_id,
            revenueReversalLineId: line.id,
            amountMinor: line.amount_minor,
            currencyCode: line.currency_code,
            occurredAt: reversal.created_at
          },
          request
        )
      );
    }

    const references = await this.repository.ledgerReferencesForReversal(trx, reversal.id);
    if (references.length !== lines.length) {
      throw new ConflictError(
        "Revenue reversal ledger journal count does not match reversal lines"
      );
    }

    const referencesByLine = new Map(
      references.map((reference) => [reference.revenue_reversal_line_id, reference])
    );

    for (const line of lines) {
      const reference = referencesByLine.get(line.id);
      if (
        !reference ||
        reference.amount_minor !== line.amount_minor ||
        reference.currency_code !== line.currency_code
      ) {
        throw new ConflictError(
          "Revenue reversal ledger journal is inconsistent with reversal line"
        );
      }
    }

    if (sumMoney(references.map((reference) => reference.amount_minor)) !== reversal.amount_minor) {
      throw new ConflictError("Revenue reversal ledger journals do not reconcile to header");
    }

    return postings;
  }

  private async assertExisting(
    trx: Transaction<Database>,
    actor: ActorContext,
    existing: RevenueReversalRecord,
    requestedLines: RevenueReversalRequestedLine[],
    reasonCode: string,
    note: string,
    request: RequestMetadata
  ): Promise<RevenueReversalResult> {
    const lines = await this.repository.linesForReversal(trx, existing.id);
    const requestedTotal = sumMoney(requestedLines.map((line) => line.amountMinor));

    if (
      existing.actor_user_id !== actor.userId ||
      existing.reason_code !== reasonCode ||
      existing.note !== note ||
      existing.line_count !== requestedLines.length ||
      existing.amount_minor !== requestedTotal ||
      lines.length !== requestedLines.length
    ) {
      throw new ConflictError("Revenue reversal operation id was reused with different economics");
    }

    requestedLines.forEach((requested, index) => {
      const stored = lines[index];
      if (
        !stored ||
        stored.line_number !== index + 1 ||
        stored.revenue_schedule_line_id !== requested.revenueScheduleLineId ||
        stored.amount_minor !== requested.amountMinor ||
        stored.currency_code !== existing.currency_code
      ) {
        throw new ConflictError("Revenue reversal operation id was reused with different lines");
      }
    });

    const postings = await this.postAndValidateJournals(trx, existing, lines, request);

    return {
      created: false,
      createdJournalCount: postings.filter((posting) => posting.created).length,
      reversal: this.repository.view(existing, lines),
      journals: postings.map((posting) => posting.journal)
    };
  }

  async ensure(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
      operationId: string;
      reasonCode: string;
      note: string;
      lines: RevenueReversalRequestedLine[];
    },
    request: RequestMetadata
  ): Promise<RevenueReversalResult> {
    this.authorization.assert(actor, Permissions.SETTLEMENT_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    if (!OPERATION_PATTERN.test(input.operationId)) {
      throw new ValidationError("Revenue reversal operation id is invalid");
    }

    if (!REASON_PATTERN.test(input.reasonCode)) {
      throw new ValidationError("Revenue reversal reason code is invalid");
    }

    const note = input.note.trim();
    if (note.length < 10 || note.length > 1000) {
      throw new ValidationError(
        "Revenue reversal note must contain between 10 and 1000 characters"
      );
    }

    validateRequestedLines(input.lines);

    const reservation = await this.repository.reservationForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );

    if (!reservation) throw new NotFoundError("Reservation not found");
    if (reservation.status !== "CHECKED_OUT") {
      throw new ConflictError("Revenue can be reversed only after canonical checkout");
    }

    const existing = await this.repository.findByOperationForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId,
      input.operationId
    );

    if (existing) {
      if (existing.currency_code !== reservation.currency_code) {
        throw new ConflictError("Existing revenue reversal currency does not match reservation");
      }

      return this.assertExisting(
        trx,
        actor,
        existing,
        input.lines,
        input.reasonCode,
        note,
        request
      );
    }

    const sourceByLine = new Map<string, RecognizedRevenueSource>();
    const lockOrder = [...input.lines].sort((a, b) =>
      a.revenueScheduleLineId.localeCompare(b.revenueScheduleLineId)
    );

    for (const requested of lockOrder) {
      const source = await this.repository.recognizedRevenueSourceForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        requested.revenueScheduleLineId
      );

      if (!source) {
        throw new ConflictError(
          "Revenue reversal requires an existing canonical REVENUE_RECOGNIZED journal"
        );
      }

      if (
        source.revenue_minor <= 0 ||
        source.revenue_minor !== source.recognition_journal_amount_minor ||
        source.currency_code !== source.recognition_journal_currency_code ||
        source.currency_code !== reservation.currency_code
      ) {
        throw new ConflictError("Recognized revenue source is internally inconsistent");
      }

      const priorAmounts = await this.repository.reversalAmountsForScheduleLine(
        trx,
        requested.revenueScheduleLineId
      );
      const alreadyReversed = sumMoney(priorAmounts);
      const requestedTotal = alreadyReversed + requested.amountMinor;

      if (!Number.isSafeInteger(requestedTotal) || requestedTotal > source.revenue_minor) {
        throw new ConflictError("Cumulative revenue reversal exceeds recognized revenue", {
          revenueScheduleLineId: requested.revenueScheduleLineId,
          recognizedMinor: source.revenue_minor,
          alreadyReversedMinor: alreadyReversed,
          requestedMinor: requested.amountMinor
        });
      }

      sourceByLine.set(requested.revenueScheduleLineId, source);
    }

    const amountMinor = sumMoney(input.lines.map((line) => line.amountMinor));
    if (amountMinor <= 0) {
      throw new ValidationError("Revenue reversal total must be positive");
    }

    const reversalId = this.repository.newId();
    let reversal = await this.repository.createReversal(trx, {
      id: reversalId,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reservationId: input.reservationId,
      operationId: input.operationId,
      reasonCode: input.reasonCode,
      note,
      currencyCode: reservation.currency_code,
      amountMinor,
      lineCount: input.lines.length,
      actorUserId: actor.userId,
      source: request.source,
      requestId: request.requestId,
      correlationId: request.correlationId
    });

    if (!reversal) {
      reversal = await this.repository.findByOperationForUpdate(
        trx,
        input.organizationId,
        input.propertyId,
        input.reservationId,
        input.operationId
      );

      if (!reversal) {
        throw new ConflictError("Revenue reversal could not be persisted");
      }

      return this.assertExisting(
        trx,
        actor,
        reversal,
        input.lines,
        input.reasonCode,
        note,
        request
      );
    }

    const lineInputs = input.lines.map((requested, index) => {
      const source = sourceByLine.get(requested.revenueScheduleLineId);
      if (!source) {
        throw new ConflictError("Recognized revenue source disappeared during reversal creation");
      }

      return {
        id: this.repository.newId(),
        reversalId: reversal.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reservationId: input.reservationId,
        lineNumber: index + 1,
        revenueScheduleLineId: requested.revenueScheduleLineId,
        revenueRecognitionJournalId: source.recognition_journal_id,
        amountMinor: requested.amountMinor,
        currencyCode: source.currency_code
      };
    });

    const lines = await this.repository.createLines(trx, lineInputs);
    if (lines.length !== input.lines.length) {
      throw new ConflictError("Revenue reversal lines could not be persisted completely");
    }

    const postings = await this.postAndValidateJournals(trx, reversal, lines, request);

    const view = this.repository.view(reversal, lines);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "finance.revenue.reversed",
      entityType: "reservation_revenue_reversal",
      entityId: reversal.id,
      after: view,
      reason: input.reasonCode,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "reservation",
      aggregateId: input.reservationId,
      eventType: "finance.revenue.reversed.v1",
      payload: view
    });

    return {
      created: true,
      createdJournalCount: postings.filter((posting) => posting.created).length,
      reversal: view,
      journals: postings.map((posting) => posting.journal)
    };
  }
}
