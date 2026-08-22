import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  OwnerOccupancyCapacityBasis,
  type OwnerOccupancyDayView,
  type OwnerOccupancyReportView
} from "../domain/owner-occupancy-report.js";
import { OwnerReportRepository } from "../infrastructure/owner-report-repository.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_NIGHTS = 366;

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

function reportDates(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate, "startDate");
  const end = parseDate(endDate, "endDate");
  const nights = Math.round((end.getTime() - start.getTime()) / DAY_MS);

  if (nights <= 0) {
    throw new ValidationError("endDate must be later than startDate");
  }

  if (nights > MAX_REPORT_NIGHTS) {
    throw new ValidationError(`Occupancy reports cannot exceed ${MAX_REPORT_NIGHTS} nights`);
  }

  return Array.from({ length: nights }, (_, index) =>
    new Date(start.getTime() + index * DAY_MS).toISOString().slice(0, 10)
  );
}

function occupancyBps(confirmedRooms: number, capacityRooms: number): number | null {
  if (capacityRooms <= 0) {
    return null;
  }

  return Math.round((confirmedRooms * 10_000) / capacityRooms);
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

    const dates = reportDates(input.startDate, input.endDate);

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
}
