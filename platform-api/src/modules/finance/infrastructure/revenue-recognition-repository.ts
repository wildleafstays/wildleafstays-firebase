import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { QuoteNightsTable } from "../../quotes/infrastructure/quote-database-types.js";
import type {
  QuoteFinalFeeLinesTable,
  QuoteFinalTaxLinesTable
} from "../../quotes/infrastructure/quote-promotion-database-types.js";
import type {
  ReservationFinancialSnapshotsTable,
  ReservationsTable
} from "../../reservations/infrastructure/reservation-database-types.js";
import type {
  RevenueRecognitionBuildResult,
  RevenueRecognitionLineDraft,
  RevenueRecognitionLineType,
  RevenueRecognitionScheduleLineView,
  RevenueRecognitionScheduleView,
  RevenueRecognitionServiceScope
} from "../domain/revenue-recognition.js";
import type {
  RevenueRecognitionScheduleLinesTable,
  RevenueRecognitionSchedulesTable
} from "./revenue-recognition-database-types.js";

export type RevenueRecognitionScheduleRecord = Selectable<RevenueRecognitionSchedulesTable>;
export type RevenueRecognitionScheduleLineRecord = Selectable<RevenueRecognitionScheduleLinesTable>;
export type RevenueRecognitionReservationRecord = Selectable<ReservationsTable>;
export type RevenueRecognitionFinancialRecord = Selectable<ReservationFinancialSnapshotsTable>;
export type RevenueRecognitionQuoteNightRecord = Selectable<QuoteNightsTable>;
export type RevenueRecognitionFeeRecord = Selectable<QuoteFinalFeeLinesTable>;
export type RevenueRecognitionTaxRecord = Selectable<QuoteFinalTaxLinesTable>;

export interface RevenueRecognitionSourceBundle {
  reservation: RevenueRecognitionReservationRecord;
  financial: RevenueRecognitionFinancialRecord | undefined;
  quoteNights: RevenueRecognitionQuoteNightRecord[];
  feeLines: RevenueRecognitionFeeRecord[];
  taxLines: RevenueRecognitionTaxRecord[];
}

export class RevenueRecognitionRepository {
  async sourceForReservation(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    reservationId: string
  ): Promise<RevenueRecognitionSourceBundle | undefined> {
    const reservation = await trx
      .selectFrom("reservations")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", reservationId)
      .executeTakeFirst();

    if (!reservation) return undefined;

    const financial = await trx
      .selectFrom("reservation_financial_snapshots")
      .selectAll()
      .where("reservation_id", "=", reservation.id)
      .executeTakeFirst();

    const quoteNights = await trx
      .selectFrom("quote_nights")
      .selectAll()
      .where("quote_id", "=", reservation.quote_id)
      .orderBy("stay_date", "asc")
      .execute();

    const feeLines = await trx
      .selectFrom("quote_final_fee_lines")
      .selectAll()
      .where("quote_id", "=", reservation.quote_id)
      .orderBy("line_key", "asc")
      .execute();

    const taxLines = await trx
      .selectFrom("quote_final_tax_lines")
      .selectAll()
      .where("quote_id", "=", reservation.quote_id)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();

    return { reservation, financial, quoteNights, feeLines, taxLines };
  }

  async findByReservation(
    trx: Transaction<Database>,
    reservationId: string
  ): Promise<RevenueRecognitionScheduleRecord | undefined> {
    return trx
      .selectFrom("reservation_revenue_schedules")
      .selectAll()
      .where("reservation_id", "=", reservationId)
      .executeTakeFirst();
  }

  async findLines(
    trx: Transaction<Database>,
    scheduleId: string
  ): Promise<RevenueRecognitionScheduleLineRecord[]> {
    return trx
      .selectFrom("reservation_revenue_schedule_lines")
      .selectAll()
      .where("schedule_id", "=", scheduleId)
      .orderBy("line_number", "asc")
      .execute();
  }

  async createSchedule(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
      reservationFinancialSnapshotId: string;
      quoteId: string;
      build: RevenueRecognitionBuildResult;
      request: RequestMetadata;
    }
  ): Promise<RevenueRecognitionScheduleRecord | undefined> {
    return trx
      .insertInto("reservation_revenue_schedules")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        reservation_financial_snapshot_id: input.reservationFinancialSnapshotId,
        quote_id: input.quoteId,
        allocation_version: input.build.allocationVersion,
        currency_code: input.build.currencyCode,
        accepted_total_minor: input.build.acceptedTotalMinor,
        consideration_minor: input.build.considerationMinor,
        inclusive_tax_minor: input.build.inclusiveTaxMinor,
        exclusive_tax_minor: input.build.exclusiveTaxMinor,
        tax_minor: input.build.taxMinor,
        revenue_basis_minor: input.build.revenueBasisMinor,
        line_count: input.build.lines.length,
        source: input.request.source,
        request_id: input.request.requestId,
        correlation_id: input.request.correlationId
      })
      .onConflict((conflict) => conflict.column("reservation_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createLines(
    trx: Transaction<Database>,
    schedule: RevenueRecognitionScheduleRecord,
    lines: RevenueRecognitionLineDraft[]
  ): Promise<RevenueRecognitionScheduleLineRecord[]> {
    if (lines.length === 0) return [];

    return trx
      .insertInto("reservation_revenue_schedule_lines")
      .values(
        lines.map((line, index) => ({
          id: randomUUID(),
          schedule_id: schedule.id,
          organization_id: schedule.organization_id,
          property_id: schedule.property_id,
          reservation_id: schedule.reservation_id,
          quote_id: schedule.quote_id,
          line_number: index + 1,
          line_type: line.lineType,
          service_scope: line.serviceScope,
          stay_date: line.stayDate,
          source_quote_night_id: line.sourceQuoteNightId,
          source_final_fee_line_id: line.sourceFinalFeeLineId,
          source_line_key: line.sourceLineKey,
          consideration_minor: line.considerationMinor,
          inclusive_tax_minor: line.inclusiveTaxMinor,
          revenue_minor: line.revenueMinor,
          currency_code: line.currencyCode
        }))
      )
      .returningAll()
      .execute();
  }

  view(
    schedule: RevenueRecognitionScheduleRecord,
    lines: RevenueRecognitionScheduleLineRecord[]
  ): RevenueRecognitionScheduleView {
    return {
      id: schedule.id,
      organizationId: schedule.organization_id,
      propertyId: schedule.property_id,
      reservationId: schedule.reservation_id,
      reservationFinancialSnapshotId: schedule.reservation_financial_snapshot_id,
      quoteId: schedule.quote_id,
      allocationVersion: schedule.allocation_version as "REVENUE_BASIS_V1",
      currencyCode: schedule.currency_code,
      acceptedTotalMinor: schedule.accepted_total_minor,
      considerationMinor: schedule.consideration_minor,
      inclusiveTaxMinor: schedule.inclusive_tax_minor,
      exclusiveTaxMinor: schedule.exclusive_tax_minor,
      taxMinor: schedule.tax_minor,
      revenueBasisMinor: schedule.revenue_basis_minor,
      lineCount: schedule.line_count,
      createdAt: schedule.created_at.toISOString(),
      lines: lines.map((line): RevenueRecognitionScheduleLineView => ({
        id: line.id,
        lineNumber: line.line_number,
        lineType: line.line_type as RevenueRecognitionLineType,
        serviceScope: line.service_scope as RevenueRecognitionServiceScope,
        stayDate: line.stay_date,
        sourceQuoteNightId: line.source_quote_night_id,
        sourceFinalFeeLineId: line.source_final_fee_line_id,
        sourceLineKey: line.source_line_key,
        considerationMinor: line.consideration_minor,
        inclusiveTaxMinor: line.inclusive_tax_minor,
        revenueMinor: line.revenue_minor,
        currencyCode: line.currency_code,
        createdAt: line.created_at.toISOString()
      }))
    };
  }
}
