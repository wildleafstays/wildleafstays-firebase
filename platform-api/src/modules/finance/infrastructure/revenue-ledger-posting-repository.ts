import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type {
  ReservationStatusHistoryTable,
  ReservationsTable
} from "../../reservations/infrastructure/reservation-database-types.js";

export type RevenuePostingReservationRecord = Selectable<ReservationsTable>;
export type RevenuePostingCheckoutHistoryRecord = Selectable<ReservationStatusHistoryTable>;

export interface RevenuePostingCompletionSource {
  reservation: RevenuePostingReservationRecord;
  checkoutHistories: RevenuePostingCheckoutHistoryRecord[];
}

export interface RevenueJournalReferenceRecord {
  journal_id: string;
  revenue_schedule_line_id: string | null;
  stay_completion_history_id: string | null;
  recognition_date: string | null;
  amount_minor: number;
  currency_code: string;
}

export class RevenueLedgerPostingRepository {
  async completionSource(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<RevenuePostingCompletionSource | undefined> {
    const reservation = await trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .executeTakeFirst();

    if (!reservation) return undefined;

    const checkoutHistories = await trx
      .selectFrom("reservation_status_history")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("reservation_id", "=", reservationId)
      .where("from_status", "=", "CHECKED_IN")
      .where("to_status", "=", "CHECKED_OUT")
      .where("reason", "=", "FRONT_DESK_CHECK_OUT")
      .orderBy("sequence_number", "asc")
      .execute();

    return { reservation, checkoutHistories };
  }

  async revenueJournalReferencesForSchedule(
    trx: Transaction<Database>,
    scheduleId: string
  ): Promise<RevenueJournalReferenceRecord[]> {
    return trx
      .selectFrom("financial_ledger_journals as journal")
      .innerJoin(
        "reservation_revenue_schedule_lines as line",
        "line.id",
        "journal.revenue_schedule_line_id"
      )
      .select([
        "journal.id as journal_id",
        "journal.revenue_schedule_line_id",
        "journal.stay_completion_history_id",
        "journal.recognition_date",
        "journal.amount_minor",
        "journal.currency_code"
      ])
      .where("journal.journal_type", "=", "REVENUE_RECOGNIZED")
      .where("line.schedule_id", "=", scheduleId)
      .orderBy("line.line_number", "asc")
      .execute();
  }
}
