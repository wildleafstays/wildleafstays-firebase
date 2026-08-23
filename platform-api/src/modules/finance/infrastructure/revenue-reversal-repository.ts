import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { ReservationsTable } from "../../reservations/infrastructure/reservation-database-types.js";
import type { RevenueReversalLineView, RevenueReversalView } from "../domain/revenue-reversal.js";
import type {
  RevenueReversalLinesTable,
  RevenueReversalsTable
} from "./revenue-reversal-database-types.js";

export type RevenueReversalRecord = Selectable<RevenueReversalsTable>;
export type RevenueReversalLineRecord = Selectable<RevenueReversalLinesTable>;
export type RevenueReversalReservationRecord = Selectable<ReservationsTable>;

export interface RecognizedRevenueSource {
  revenue_schedule_line_id: string;
  schedule_id: string;
  organization_id: string;
  property_id: string;
  reservation_id: string;
  revenue_minor: number;
  currency_code: string;
  recognition_journal_id: string;
  recognition_journal_amount_minor: number;
  recognition_journal_currency_code: string;
}

export interface RevenueReversalLedgerReference {
  journal_id: string;
  revenue_reversal_line_id: string | null;
  amount_minor: number;
  currency_code: string;
}

interface CreateReversalInput {
  id: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  operationId: string;
  reasonCode: string;
  note: string;
  currencyCode: string;
  amountMinor: number;
  lineCount: number;
  actorUserId: string;
  source: string;
  requestId: string;
  correlationId: string;
}

interface CreateReversalLineInput {
  id: string;
  reversalId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  lineNumber: number;
  revenueScheduleLineId: string;
  revenueRecognitionJournalId: string;
  amountMinor: number;
  currencyCode: string;
}

export class RevenueReversalRepository {
  async reservationForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<RevenueReversalReservationRecord | undefined> {
    return trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .forUpdate()
      .executeTakeFirst();
  }

  async findByOperationForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    operationId: string
  ): Promise<RevenueReversalRecord | undefined> {
    return trx
      .selectFrom("reservation_revenue_reversals")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("operation_id", "=", operationId)
      .forUpdate()
      .executeTakeFirst();
  }

  async linesForReversal(
    trx: Transaction<Database>,
    reversalId: string
  ): Promise<RevenueReversalLineRecord[]> {
    return trx
      .selectFrom("reservation_revenue_reversal_lines")
      .selectAll()
      .where("reversal_id", "=", reversalId)
      .orderBy("line_number", "asc")
      .execute();
  }

  async recognizedRevenueSourceForUpdate(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string,
    revenueScheduleLineId: string
  ): Promise<RecognizedRevenueSource | undefined> {
    return trx
      .selectFrom("reservation_revenue_schedule_lines as line")
      .innerJoin(
        "financial_ledger_journals as journal",
        "journal.revenue_schedule_line_id",
        "line.id"
      )
      .select([
        "line.id as revenue_schedule_line_id",
        "line.schedule_id",
        "line.organization_id",
        "line.property_id",
        "line.reservation_id",
        "line.revenue_minor",
        "line.currency_code",
        "journal.id as recognition_journal_id",
        "journal.amount_minor as recognition_journal_amount_minor",
        "journal.currency_code as recognition_journal_currency_code"
      ])
      .where("line.organization_id", "=", organizationId)
      .where("line.property_id", "=", propertyId)
      .where("line.reservation_id", "=", reservationId)
      .where("line.id", "=", revenueScheduleLineId)
      .where("journal.journal_type", "=", "REVENUE_RECOGNIZED")
      .forUpdate()
      .executeTakeFirst();
  }

  async reversalAmountsForScheduleLine(
    trx: Transaction<Database>,
    revenueScheduleLineId: string
  ): Promise<number[]> {
    const rows = await trx
      .selectFrom("reservation_revenue_reversal_lines")
      .select("amount_minor")
      .where("revenue_schedule_line_id", "=", revenueScheduleLineId)
      .execute();

    return rows.map((row) => row.amount_minor);
  }

  async createReversal(
    trx: Transaction<Database>,
    input: CreateReversalInput
  ): Promise<RevenueReversalRecord | undefined> {
    return trx
      .insertInto("reservation_revenue_reversals")
      .values({
        id: input.id,
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        operation_id: input.operationId,
        reason_code: input.reasonCode,
        note: input.note,
        currency_code: input.currencyCode,
        amount_minor: input.amountMinor,
        line_count: input.lineCount,
        actor_user_id: input.actorUserId,
        source: input.source,
        request_id: input.requestId,
        correlation_id: input.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createLines(
    trx: Transaction<Database>,
    inputs: CreateReversalLineInput[]
  ): Promise<RevenueReversalLineRecord[]> {
    return trx
      .insertInto("reservation_revenue_reversal_lines")
      .values(
        inputs.map((input) => ({
          id: input.id,
          reversal_id: input.reversalId,
          organization_id: input.organizationId,
          property_id: input.propertyId,
          reservation_id: input.reservationId,
          line_number: input.lineNumber,
          revenue_schedule_line_id: input.revenueScheduleLineId,
          revenue_recognition_journal_id: input.revenueRecognitionJournalId,
          amount_minor: input.amountMinor,
          currency_code: input.currencyCode
        }))
      )
      .returningAll()
      .execute();
  }

  async ledgerReferencesForReversal(
    trx: Transaction<Database>,
    reversalId: string
  ): Promise<RevenueReversalLedgerReference[]> {
    return trx
      .selectFrom("reservation_revenue_reversal_lines as line")
      .innerJoin(
        "financial_ledger_journals as journal",
        "journal.revenue_reversal_line_id",
        "line.id"
      )
      .select([
        "journal.id as journal_id",
        "journal.revenue_reversal_line_id",
        "journal.amount_minor",
        "journal.currency_code"
      ])
      .where("line.reversal_id", "=", reversalId)
      .where("journal.journal_type", "=", "REVENUE_REVERSED")
      .orderBy("line.line_number", "asc")
      .execute();
  }

  view(reversal: RevenueReversalRecord, lines: RevenueReversalLineRecord[]): RevenueReversalView {
    return {
      id: reversal.id,
      organizationId: reversal.organization_id,
      propertyId: reversal.property_id,
      reservationId: reversal.reservation_id,
      operationId: reversal.operation_id,
      reasonCode: reversal.reason_code,
      note: reversal.note,
      currencyCode: reversal.currency_code,
      amountMinor: reversal.amount_minor,
      lineCount: reversal.line_count,
      actorUserId: reversal.actor_user_id,
      createdAt: reversal.created_at.toISOString(),
      lines: lines.map((line): RevenueReversalLineView => ({
        id: line.id,
        reversalId: line.reversal_id,
        lineNumber: line.line_number,
        revenueScheduleLineId: line.revenue_schedule_line_id,
        revenueRecognitionJournalId: line.revenue_recognition_journal_id,
        amountMinor: line.amount_minor,
        currencyCode: line.currency_code,
        createdAt: line.created_at.toISOString()
      }))
    };
  }

  newId(): string {
    return randomUUID();
  }
}
