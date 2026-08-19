import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import {
  FinancialLedgerAccounts,
  FinancialLedgerDirections,
  FinancialLedgerJournalTypes,
  type FinancialLedgerAccount,
  type FinancialLedgerDirection,
  type FinancialLedgerJournalType,
  type FinancialLedgerPostingResult
} from "../domain/financial-ledger.js";
import {
  FinancialLedgerRepository,
  type FinancialLedgerEntryRecord,
  type FinancialLedgerJournalRecord
} from "../infrastructure/financial-ledger-repository.js";

interface PaymentReceivedPostingInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
}

interface RefundProcessedPostingInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  refundFinalizationId: string;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
}

interface RevenueRecognizedPostingInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  revenueScheduleLineId: string;
  stayCompletionHistoryId: string;
  recognitionDate: string;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
}

interface EnsureJournalInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string | null;
  journalType: FinancialLedgerJournalType;
  paymentEvidenceId: string | null;
  refundFinalizationId: string | null;
  revenueScheduleLineId: string | null;
  stayCompletionHistoryId: string | null;
  recognitionDate: string | null;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
}

interface ExpectedEntry {
  lineNumber: number;
  accountCode: FinancialLedgerAccount;
  direction: FinancialLedgerDirection;
  amountMinor: number;
  currencyCode: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class FinancialLedgerPostingService {
  constructor(private readonly ledger = new FinancialLedgerRepository()) {}

  private validateEconomics(
    amountMinor: number,
    currencyCode: string,
    occurredAt: Date,
    recognitionDate: string | null
  ): void {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new ValidationError("Financial ledger amount must be a positive safe integer");
    }

    if (currencyCode.length !== 3) {
      throw new ValidationError(
        "Financial ledger currency code must contain exactly three characters"
      );
    }

    if (Number.isNaN(occurredAt.getTime())) {
      throw new ValidationError("Financial ledger occurrence time must be valid");
    }

    if (recognitionDate !== null && !DATE_PATTERN.test(recognitionDate)) {
      throw new ValidationError("Financial ledger recognition date must use YYYY-MM-DD");
    }
  }

  private expectedEntries(
    journalType: FinancialLedgerJournalType,
    amountMinor: number,
    currencyCode: string
  ): ExpectedEntry[] {
    if (journalType === FinancialLedgerJournalTypes.PAYMENT_RECEIVED) {
      return [
        {
          lineNumber: 1,
          accountCode: FinancialLedgerAccounts.PAYMENT_PROVIDER_CLEARING,
          direction: FinancialLedgerDirections.DEBIT,
          amountMinor,
          currencyCode
        },
        {
          lineNumber: 2,
          accountCode: FinancialLedgerAccounts.GUEST_FUNDS_HELD,
          direction: FinancialLedgerDirections.CREDIT,
          amountMinor,
          currencyCode
        }
      ];
    }

    if (journalType === FinancialLedgerJournalTypes.REFUND_PROCESSED) {
      return [
        {
          lineNumber: 1,
          accountCode: FinancialLedgerAccounts.GUEST_FUNDS_HELD,
          direction: FinancialLedgerDirections.DEBIT,
          amountMinor,
          currencyCode
        },
        {
          lineNumber: 2,
          accountCode: FinancialLedgerAccounts.PAYMENT_PROVIDER_CLEARING,
          direction: FinancialLedgerDirections.CREDIT,
          amountMinor,
          currencyCode
        }
      ];
    }

    return [
      {
        lineNumber: 1,
        accountCode: FinancialLedgerAccounts.GUEST_FUNDS_HELD,
        direction: FinancialLedgerDirections.DEBIT,
        amountMinor,
        currencyCode
      },
      {
        lineNumber: 2,
        accountCode: FinancialLedgerAccounts.STAY_REVENUE,
        direction: FinancialLedgerDirections.CREDIT,
        amountMinor,
        currencyCode
      }
    ];
  }

  private async findExisting(
    trx: Transaction<Database>,
    input: EnsureJournalInput
  ): Promise<FinancialLedgerJournalRecord | undefined> {
    if (input.paymentEvidenceId !== null) {
      return this.ledger.findByPaymentEvidence(trx, input.paymentEvidenceId);
    }

    if (input.refundFinalizationId !== null) {
      return this.ledger.findByRefundFinalization(trx, input.refundFinalizationId);
    }

    if (input.revenueScheduleLineId !== null) {
      return this.ledger.findByRevenueScheduleLine(trx, input.revenueScheduleLineId);
    }

    throw new ValidationError("Financial ledger posting requires one immutable source record");
  }

  private async assertExisting(
    trx: Transaction<Database>,
    existing: FinancialLedgerJournalRecord,
    input: EnsureJournalInput
  ): Promise<FinancialLedgerPostingResult> {
    if (
      existing.organization_id !== input.organizationId ||
      existing.property_id !== input.propertyId ||
      existing.reservation_id !== input.reservationId ||
      existing.payment_intent_id !== input.paymentIntentId ||
      existing.journal_type !== input.journalType ||
      existing.payment_evidence_id !== input.paymentEvidenceId ||
      existing.refund_finalization_id !== input.refundFinalizationId ||
      existing.revenue_schedule_line_id !== input.revenueScheduleLineId ||
      existing.stay_completion_history_id !== input.stayCompletionHistoryId ||
      existing.recognition_date !== input.recognitionDate ||
      existing.amount_minor !== input.amountMinor ||
      existing.currency_code !== input.currencyCode ||
      existing.occurred_at.getTime() !== input.occurredAt.getTime()
    ) {
      throw new ConflictError("Financial ledger source is already posted with different economics");
    }

    const entries = await this.ledger.findEntries(trx, existing.id);
    const expected = this.expectedEntries(input.journalType, input.amountMinor, input.currencyCode);

    const entriesMatch =
      entries.length === expected.length &&
      expected.every((wanted, index) => {
        const observed = entries[index];
        return (
          observed !== undefined &&
          observed.line_number === wanted.lineNumber &&
          observed.account_code === wanted.accountCode &&
          observed.direction === wanted.direction &&
          observed.amount_minor === wanted.amountMinor &&
          observed.currency_code === wanted.currencyCode
        );
      });

    if (!entriesMatch) {
      throw new ConflictError("Existing financial ledger journal entries are inconsistent");
    }

    return {
      created: false,
      journal: this.ledger.view(existing, entries)
    };
  }

  private async ensureJournal(
    trx: Transaction<Database>,
    input: EnsureJournalInput,
    request: RequestMetadata
  ): Promise<FinancialLedgerPostingResult> {
    this.validateEconomics(
      input.amountMinor,
      input.currencyCode,
      input.occurredAt,
      input.recognitionDate
    );

    const existing = await this.findExisting(trx, input);
    if (existing) {
      return this.assertExisting(trx, existing, input);
    }

    const created = await this.ledger.createJournal(trx, {
      ...input,
      source: request.source,
      requestId: request.requestId,
      correlationId: request.correlationId
    });

    if (!created) {
      const raced = await this.findExisting(trx, input);
      if (!raced) {
        throw new ConflictError("Financial ledger journal could not be persisted");
      }
      return this.assertExisting(trx, raced, input);
    }

    const expected = this.expectedEntries(input.journalType, input.amountMinor, input.currencyCode);
    const entries: FinancialLedgerEntryRecord[] = await this.ledger.createEntries(
      trx,
      created,
      expected
    );

    return {
      created: true,
      journal: this.ledger.view(created, entries)
    };
  }

  postPaymentReceived(
    trx: Transaction<Database>,
    input: PaymentReceivedPostingInput,
    request: RequestMetadata
  ): Promise<FinancialLedgerPostingResult> {
    return this.ensureJournal(
      trx,
      {
        ...input,
        journalType: FinancialLedgerJournalTypes.PAYMENT_RECEIVED,
        paymentEvidenceId: input.paymentEvidenceId,
        refundFinalizationId: null,
        revenueScheduleLineId: null,
        stayCompletionHistoryId: null,
        recognitionDate: null
      },
      request
    );
  }

  postRefundProcessed(
    trx: Transaction<Database>,
    input: RefundProcessedPostingInput,
    request: RequestMetadata
  ): Promise<FinancialLedgerPostingResult> {
    return this.ensureJournal(
      trx,
      {
        ...input,
        journalType: FinancialLedgerJournalTypes.REFUND_PROCESSED,
        paymentEvidenceId: null,
        refundFinalizationId: input.refundFinalizationId,
        revenueScheduleLineId: null,
        stayCompletionHistoryId: null,
        recognitionDate: null
      },
      request
    );
  }

  postRevenueRecognized(
    trx: Transaction<Database>,
    input: RevenueRecognizedPostingInput,
    request: RequestMetadata
  ): Promise<FinancialLedgerPostingResult> {
    return this.ensureJournal(
      trx,
      {
        ...input,
        paymentIntentId: null,
        journalType: FinancialLedgerJournalTypes.REVENUE_RECOGNIZED,
        paymentEvidenceId: null,
        refundFinalizationId: null,
        revenueScheduleLineId: input.revenueScheduleLineId,
        stayCompletionHistoryId: input.stayCompletionHistoryId,
        recognitionDate: input.recognitionDate
      },
      request
    );
  }
}
