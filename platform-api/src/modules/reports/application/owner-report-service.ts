import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  OwnerOccupancyCapacityBasis,
  type OwnerOccupancyDayView,
  type OwnerOccupancyReportView
} from "../domain/owner-occupancy-report.js";
import type {
  OwnerPortfolioPropertyView,
  OwnerPortfolioReportView
} from "../domain/owner-portfolio-report.js";
import type {
  OwnerRecognizedRevenueDayView,
  OwnerRecognizedRevenueReportView
} from "../domain/owner-recognized-revenue-report.js";
import { OwnerReportRepository } from "../infrastructure/owner-report-repository.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 366;

function parseDate(value: string, field: string): Date {
  if (!DATE_PATTERN.test(value)) {
    throw new ValidationError(`${field} must use YYYY-MM-DD format`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} is invalid`);
  }

  return parsed;
}

function reportDates(startDate: string, endDate: string, reportLabel: string): string[] {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);

  if (days <= 0) {
    throw new ValidationError("endDate must be later than startDate");
  }

  if (days > MAX_REPORT_DAYS) {
    throw new ValidationError(`${reportLabel} cannot exceed ${MAX_REPORT_DAYS} days`);
  }

  return Array.from({ length: days }, (_, index) =>
    new Date(start.getTime() + index * DAY_MS).toISOString().slice(0, 10)
  );
}

function occupancyBps(confirmedRooms: number, capacityRooms: number): number | null {
  if (capacityRooms <= 0) {
    return null;
  }

  return Math.round((confirmedRooms * 10_000) / capacityRooms);
}

function aggregateMoney(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ConflictError("Financial ledger aggregate is not a non-negative integer");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConflictError("Financial ledger aggregate exceeds safe reporting precision");
  }

  return parsed;
}

function addMoney(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new ConflictError("Financial report total exceeds safe reporting precision");
  }
  return total;
}

function assertCanonicalCurrency(
  rows: Array<{ currency_code: string }>,
  currencyCode: string
): void {
  const mismatch = rows.find((row) => row.currency_code !== currencyCode);
  if (mismatch) {
    throw new ConflictError("Financial ledger currency does not match organization currency");
  }
}

export class OwnerReportService {
  constructor(
    private readonly reports = new OwnerReportRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async occupancy(
    db: Kysely<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      startDate: string;
      endDate: string;
    }
  ): Promise<OwnerOccupancyReportView> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });
    this.authorization.assert(actor, Permissions.INVENTORY_READ, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const dates = reportDates(input.startDate, input.endDate, "Occupancy reports");

    const capacityRooms = await this.reports.activePhysicalUnitCapacity(
      db,
      input.organizationId,
      input.propertyId
    );

    if (capacityRooms === undefined) {
      throw new NotFoundError("Property not found");
    }

    const [confirmedReservationCount, inventoryRows] = await Promise.all([
      this.reports.countConfirmedReservations(
        db,
        input.organizationId,
        input.propertyId,
        input.startDate,
        input.endDate
      ),
      this.reports.listConfirmedInventoryByDate(
        db,
        input.organizationId,
        input.propertyId,
        input.startDate,
        input.endDate
      )
    ]);

    const inventoryByDate = new Map<
      string,
      { roomConfirmed: number; fullPropertyConfirmed: boolean }
    >();

    for (const row of inventoryRows) {
      const current = inventoryByDate.get(row.stay_date) ?? {
        roomConfirmed: 0,
        fullPropertyConfirmed: false
      };

      if (row.bucket_type === "FULL_PROPERTY") {
        current.fullPropertyConfirmed = current.fullPropertyConfirmed || row.confirmed_quantity > 0;
      } else if (row.bucket_type === "ROOM_CATEGORY") {
        current.roomConfirmed += row.confirmed_quantity;
      }

      inventoryByDate.set(row.stay_date, current);
    }

    const days: OwnerOccupancyDayView[] = dates.map((date) => {
      const inventory = inventoryByDate.get(date);
      const confirmedRooms = inventory?.fullPropertyConfirmed
        ? capacityRooms
        : (inventory?.roomConfirmed ?? 0);

      return {
        date,
        capacityRooms,
        confirmedRooms,
        confirmedOccupancyBps: occupancyBps(confirmedRooms, capacityRooms)
      };
    });

    const capacityRoomNights = days.reduce((sum, day) => sum + day.capacityRooms, 0);
    const confirmedRoomNights = days.reduce((sum, day) => sum + day.confirmedRooms, 0);

    return {
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      nights: dates.length,
      capacityBasis: OwnerOccupancyCapacityBasis.CURRENT_ACTIVE_PHYSICAL_UNITS,
      confirmedReservationCount,
      capacityRoomNights,
      confirmedRoomNights,
      confirmedOccupancyBps: occupancyBps(confirmedRoomNights, capacityRoomNights),
      days
    };
  }

  async recognizedRevenue(
    db: Kysely<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      startDate: string;
      endDate: string;
    }
  ): Promise<OwnerRecognizedRevenueReportView> {
    this.authorization.assert(actor, Permissions.FINANCE_READ, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const dates = reportDates(input.startDate, input.endDate, "Recognized revenue reports");

    const context = await this.reports.propertyFinancialContext(
      db,
      input.organizationId,
      input.propertyId
    );

    if (!context) {
      throw new NotFoundError("Property not found");
    }

    const [recognizedRows, reversedRows] = await Promise.all([
      this.reports.listRecognizedRevenueByDate(
        db,
        input.organizationId,
        input.propertyId,
        input.startDate,
        input.endDate
      ),
      this.reports.listRevenueReversalsByLocalDate(
        db,
        input.organizationId,
        input.propertyId,
        context.timezone,
        input.startDate,
        input.endDate
      )
    ]);

    assertCanonicalCurrency(recognizedRows, context.currency_code);
    assertCanonicalCurrency(reversedRows, context.currency_code);

    const recognizedByDate = new Map<string, number>();
    const reversedByDate = new Map<string, number>();

    for (const row of recognizedRows) {
      recognizedByDate.set(row.date, aggregateMoney(row.amount_minor));
    }

    for (const row of reversedRows) {
      reversedByDate.set(row.date, aggregateMoney(row.amount_minor));
    }

    const days: OwnerRecognizedRevenueDayView[] = dates.map((date) => {
      const recognizedRevenueMinor = recognizedByDate.get(date) ?? 0;
      const reversedRevenueMinor = reversedByDate.get(date) ?? 0;

      return {
        date,
        recognizedRevenueMinor,
        reversedRevenueMinor,
        netRecognizedRevenueMinor: recognizedRevenueMinor - reversedRevenueMinor
      };
    });

    const recognizedRevenueMinor = days.reduce(
      (sum, day) => addMoney(sum, day.recognizedRevenueMinor),
      0
    );

    const reversedRevenueMinor = days.reduce(
      (sum, day) => addMoney(sum, day.reversedRevenueMinor),
      0
    );

    const netRecognizedRevenueMinor = recognizedRevenueMinor - reversedRevenueMinor;

    if (!Number.isSafeInteger(netRecognizedRevenueMinor)) {
      throw new ConflictError("Financial report net total exceeds safe reporting precision");
    }

    return {
      propertyId: input.propertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: context.timezone,
      currencyCode: context.currency_code,
      recognizedRevenueMinor,
      reversedRevenueMinor,
      netRecognizedRevenueMinor,
      days
    };
  }

  async portfolioPerformance(
    db: Kysely<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      startDate: string;
      endDate: string;
    }
  ): Promise<OwnerPortfolioReportView> {
    for (const permission of [
      Permissions.ORGANIZATION_READ,
      Permissions.RESERVATION_READ,
      Permissions.INVENTORY_READ,
      Permissions.FINANCE_READ
    ]) {
      this.authorization.assert(actor, permission, {
        kind: "organization",
        organizationId: input.organizationId
      });
    }

    const dates = reportDates(input.startDate, input.endDate, "Portfolio reports");

    const currencyCode = await this.reports.organizationCurrency(db, input.organizationId);
    if (!currencyCode) {
      throw new NotFoundError("Organization not found");
    }

    const [propertyRows, inventoryRows, recognizedRows, reversedRows] = await Promise.all([
      this.reports.listLivePortfolioProperties(db, input.organizationId),
      this.reports.listPortfolioConfirmedInventory(
        db,
        input.organizationId,
        input.startDate,
        input.endDate
      ),
      this.reports.listPortfolioRecognizedRevenue(
        db,
        input.organizationId,
        input.startDate,
        input.endDate
      ),
      this.reports.listPortfolioRevenueReversals(
        db,
        input.organizationId,
        input.startDate,
        input.endDate
      )
    ]);

    assertCanonicalCurrency(recognizedRows, currencyCode);
    assertCanonicalCurrency(reversedRows, currencyCode);

    const inventoryByPropertyDate = new Map<
      string,
      { roomConfirmed: number; fullPropertyConfirmed: boolean }
    >();

    for (const row of inventoryRows) {
      const key = `${row.property_id}:${row.stay_date}`;
      const current = inventoryByPropertyDate.get(key) ?? {
        roomConfirmed: 0,
        fullPropertyConfirmed: false
      };

      if (row.bucket_type === "FULL_PROPERTY") {
        current.fullPropertyConfirmed = current.fullPropertyConfirmed || row.confirmed_quantity > 0;
      } else if (row.bucket_type === "ROOM_CATEGORY") {
        current.roomConfirmed += row.confirmed_quantity;
      }

      inventoryByPropertyDate.set(key, current);
    }

    const recognizedByProperty = new Map<string, number>();
    for (const row of recognizedRows) {
      recognizedByProperty.set(row.property_id, aggregateMoney(row.amount_minor));
    }

    const reversedByProperty = new Map<string, number>();
    for (const row of reversedRows) {
      reversedByProperty.set(row.property_id, aggregateMoney(row.amount_minor));
    }

    const properties: OwnerPortfolioPropertyView[] = propertyRows.map((property) => {
      const currentActivePhysicalRooms = Number(property.capacity);
      const capacityRoomNights = currentActivePhysicalRooms * dates.length;

      const confirmedRoomNights = dates.reduce((sum, date) => {
        const inventory = inventoryByPropertyDate.get(`${property.property_id}:${date}`);
        const confirmedRooms = inventory?.fullPropertyConfirmed
          ? currentActivePhysicalRooms
          : (inventory?.roomConfirmed ?? 0);

        return sum + confirmedRooms;
      }, 0);

      const recognizedRevenueMinor = recognizedByProperty.get(property.property_id) ?? 0;
      const reversedRevenueMinor = reversedByProperty.get(property.property_id) ?? 0;
      const netRecognizedRevenueMinor = recognizedRevenueMinor - reversedRevenueMinor;

      if (!Number.isSafeInteger(netRecognizedRevenueMinor)) {
        throw new ConflictError("Financial report net total exceeds safe reporting precision");
      }

      return {
        propertyId: property.property_id,
        name: property.name,
        timezone: property.timezone,
        currentActivePhysicalRooms,
        capacityRoomNights,
        confirmedRoomNights,
        occupancyBps: occupancyBps(confirmedRoomNights, capacityRoomNights),
        recognizedRevenueMinor,
        reversedRevenueMinor,
        netRecognizedRevenueMinor
      };
    });

    const currentActivePhysicalRooms = properties.reduce(
      (sum, property) => sum + property.currentActivePhysicalRooms,
      0
    );
    const capacityRoomNights = properties.reduce(
      (sum, property) => sum + property.capacityRoomNights,
      0
    );
    const confirmedRoomNights = properties.reduce(
      (sum, property) => sum + property.confirmedRoomNights,
      0
    );
    const recognizedRevenueMinor = properties.reduce(
      (sum, property) => addMoney(sum, property.recognizedRevenueMinor),
      0
    );
    const reversedRevenueMinor = properties.reduce(
      (sum, property) => addMoney(sum, property.reversedRevenueMinor),
      0
    );
    const netRecognizedRevenueMinor = recognizedRevenueMinor - reversedRevenueMinor;

    if (!Number.isSafeInteger(netRecognizedRevenueMinor)) {
      throw new ConflictError("Financial report net total exceeds safe reporting precision");
    }

    return {
      organizationId: input.organizationId,
      startDate: input.startDate,
      endDate: input.endDate,
      currencyCode,
      propertyCount: properties.length,
      currentActivePhysicalRooms,
      capacityRoomNights,
      confirmedRoomNights,
      occupancyBps: occupancyBps(confirmedRoomNights, capacityRoomNights),
      recognizedRevenueMinor,
      reversedRevenueMinor,
      netRecognizedRevenueMinor,
      properties
    };
  }
}
