import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import {
  buildRevenueRecognitionBasis,
  type RevenueRecognitionBuildResult,
  type RevenueRecognitionScheduleResult
} from "../domain/revenue-recognition.js";
import {
  RevenueRecognitionRepository,
  type RevenueRecognitionFinancialRecord,
  type RevenueRecognitionScheduleLineRecord,
  type RevenueRecognitionScheduleRecord,
  type RevenueRecognitionSourceBundle
} from "../infrastructure/revenue-recognition-repository.js";

export class RevenueRecognitionScheduleService {
  constructor(private readonly revenue = new RevenueRecognitionRepository()) {}

  private build(
    source: RevenueRecognitionSourceBundle,
    financial: RevenueRecognitionFinancialRecord
  ): RevenueRecognitionBuildResult {
    if (
      financial.organization_id !== source.reservation.organization_id ||
      financial.property_id !== source.reservation.property_id ||
      financial.quote_id !== source.reservation.quote_id ||
      financial.currency_code !== source.reservation.currency_code ||
      financial.total_minor !== source.reservation.total_minor
    ) {
      throw new ConflictError("Accepted reservation financial snapshot does not match reservation");
    }

    return buildRevenueRecognitionBasis({
      currencyCode: financial.currency_code,
      acceptedTotalMinor: financial.total_minor,
      grossAccommodationMinor: financial.gross_accommodation_minor,
      grossExtraGuestMinor: financial.gross_extra_guest_minor,
      accommodationDiscountMinor: financial.accommodation_discount_minor,
      extraGuestDiscountMinor: financial.extra_guest_discount_minor,
      inclusiveFeeMinor: financial.inclusive_fee_minor,
      exclusiveFeeMinor: financial.exclusive_fee_minor,
      inclusiveTaxMinor: financial.inclusive_tax_minor,
      exclusiveTaxMinor: financial.exclusive_tax_minor,
      taxMinor: financial.tax_minor,
      quoteNights: source.quoteNights.map((night) => ({
        id: night.id,
        stayDate: night.stay_date,
        accommodationMinor: night.accommodation_minor,
        extraGuestMinor: night.extra_guest_minor
      })),
      feeLines: source.feeLines.map((fee) => ({
        id: fee.id,
        lineKey: fee.line_key,
        stayDate: fee.stay_date,
        priceMode: fee.price_mode as "INCLUSIVE" | "EXCLUSIVE",
        feeMinor: fee.fee_minor
      })),
      taxLines: source.taxLines.map((tax) => ({
        id: tax.id,
        priceMode: tax.price_mode as "INCLUSIVE" | "EXCLUSIVE",
        chargeType: tax.charge_type as "ACCOMMODATION" | "EXTRA_GUEST" | "FEE",
        stayDate: tax.stay_date,
        finalFeeLineId: tax.final_fee_line_id,
        taxMinor: tax.tax_minor
      }))
    });
  }

  private assertExisting(
    existing: RevenueRecognitionScheduleRecord,
    lines: RevenueRecognitionScheduleLineRecord[],
    source: RevenueRecognitionSourceBundle,
    financial: RevenueRecognitionFinancialRecord,
    build: RevenueRecognitionBuildResult
  ): RevenueRecognitionScheduleResult {
    if (
      existing.organization_id !== source.reservation.organization_id ||
      existing.property_id !== source.reservation.property_id ||
      existing.reservation_id !== source.reservation.id ||
      existing.reservation_financial_snapshot_id !== financial.id ||
      existing.quote_id !== source.reservation.quote_id ||
      existing.allocation_version !== build.allocationVersion ||
      existing.currency_code !== build.currencyCode ||
      existing.accepted_total_minor !== build.acceptedTotalMinor ||
      existing.consideration_minor !== build.considerationMinor ||
      existing.inclusive_tax_minor !== build.inclusiveTaxMinor ||
      existing.exclusive_tax_minor !== build.exclusiveTaxMinor ||
      existing.tax_minor !== build.taxMinor ||
      existing.revenue_basis_minor !== build.revenueBasisMinor ||
      existing.line_count !== build.lines.length
    ) {
      throw new ConflictError(
        "Existing revenue recognition schedule is inconsistent with accepted economics"
      );
    }

    if (lines.length !== build.lines.length) {
      throw new ConflictError("Existing revenue recognition schedule line count is inconsistent");
    }

    build.lines.forEach((wanted, index) => {
      const observed = lines[index];
      if (
        !observed ||
        observed.line_number !== index + 1 ||
        observed.line_type !== wanted.lineType ||
        observed.service_scope !== wanted.serviceScope ||
        observed.stay_date !== wanted.stayDate ||
        observed.source_quote_night_id !== wanted.sourceQuoteNightId ||
        observed.source_final_fee_line_id !== wanted.sourceFinalFeeLineId ||
        observed.source_line_key !== wanted.sourceLineKey ||
        observed.consideration_minor !== wanted.considerationMinor ||
        observed.inclusive_tax_minor !== wanted.inclusiveTaxMinor ||
        observed.revenue_minor !== wanted.revenueMinor ||
        observed.currency_code !== wanted.currencyCode
      ) {
        throw new ConflictError(
          "Existing revenue recognition schedule lines are inconsistent with accepted economics"
        );
      }
    });

    return {
      created: false,
      schedule: this.revenue.view(existing, lines)
    };
  }

  async ensureForReservation(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<RevenueRecognitionScheduleResult> {
    const reservationIdentity = await trx
      .selectFrom("reservations")
      .select(["id", "product_type"])
      .where("organization_id", "=", input.organizationId)
      .where("property_id", "=", input.propertyId)
      .where("id", "=", input.reservationId)
      .executeTakeFirst();

    if (!reservationIdentity) throw new NotFoundError("Reservation not found");
    if (reservationIdentity.product_type === "ROOM_MIX") {
      throw new ConflictError(
        "Room-mix revenue recognition requires the mixed-booking accounting schedule",
        {
          reservationId: input.reservationId,
          manualReviewRequired: true
        }
      );
    }

    const source = await this.revenue.sourceForReservation(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );
    if (!source) throw new NotFoundError("Reservation not found");
    if (!source.financial) {
      throw new ConflictError("Reservation is missing its immutable accepted financial snapshot");
    }

    const build = this.build(source, source.financial);
    const existing = await this.revenue.findByReservation(trx, source.reservation.id);
    if (existing) {
      const lines = await this.revenue.findLines(trx, existing.id);
      return this.assertExisting(existing, lines, source, source.financial, build);
    }

    const created = await this.revenue.createSchedule(trx, {
      organizationId: source.reservation.organization_id,
      propertyId: source.reservation.property_id,
      reservationId: source.reservation.id,
      reservationFinancialSnapshotId: source.financial.id,
      quoteId: source.reservation.quote_id,
      build,
      request
    });

    if (!created) {
      const raced = await this.revenue.findByReservation(trx, source.reservation.id);
      if (!raced) {
        throw new ConflictError("Revenue recognition schedule could not be persisted");
      }
      const lines = await this.revenue.findLines(trx, raced.id);
      return this.assertExisting(raced, lines, source, source.financial, build);
    }

    await this.revenue.createLines(trx, created, build.lines);
    const lines = await this.revenue.findLines(trx, created.id);

    return {
      created: true,
      schedule: this.revenue.view(created, lines)
    };
  }
}
