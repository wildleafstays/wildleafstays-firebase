import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import {
  ReservationStatuses,
  type ReservationOperationsSummary,
  type ReservationStatus,
  type ReservationSummaryView
} from "../domain/reservation.js";
import {
  ReservationRepository,
  type ReservationListCursor,
  type ReservationListRecord
} from "../infrastructure/reservation-repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<ReservationStatus>(Object.values(ReservationStatuses));

export interface ListReservationsInput {
  organizationId: string;
  propertyId: string;
  status?: ReservationStatus;
  startDate?: string;
  endDate?: string;
  limit?: number;
  cursor?: string;
}

function date(value: string, field: string): string {
  if (!DATE_PATTERN.test(value)) throw new ValidationError(`${field} must use YYYY-MM-DD format`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`${field} is invalid`);
  }
  return value;
}

function decodeCursor(value: string | undefined): ReservationListCursor | null {
  if (!value) return null;
  if (value.length > 500 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ValidationError("Invalid reservation cursor");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.createdAt !== "string" || typeof decoded.id !== "string") {
      throw new Error("invalid cursor shape");
    }
    const createdAt = new Date(decoded.createdAt);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== decoded.createdAt ||
      !UUID_PATTERN.test(decoded.id)
    ) {
      throw new Error("invalid cursor values");
    }
    return { createdAt, id: decoded.id };
  } catch {
    throw new ValidationError("Invalid reservation cursor");
  }
}

function encodeCursor(row: ReservationListRecord): string {
  return Buffer.from(
    JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id }),
    "utf8"
  ).toString("base64url");
}

function summary(row: ReservationListRecord): ReservationSummaryView {
  return {
    id: row.id,
    reservationReference: row.reservation_reference,
    status: row.status as ReservationStatus,
    arrivalDate: row.arrival_date,
    departureDate: row.departure_date,
    productType: row.product_type as "ROOM_CATEGORY" | "FULL_PROPERTY",
    productLabel: row.product_label,
    roomCategoryId: row.room_category_id,
    quantity: row.quantity,
    currencyCode: row.currency_code,
    totalMinor: row.total_minor,
    leadGuest: { name: row.guest_name, email: row.email, phone: row.phone_e164 },
    createdAt: row.created_at.toISOString()
  };
}

export class ReservationOperationsService {
  constructor(
    private readonly reservations = new ReservationRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async list(
    db: Kysely<Database>,
    actor: ActorContext,
    input: ListReservationsInput
  ): Promise<{ reservations: ReservationSummaryView[]; nextCursor: string | null }> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });
    if (input.status && !STATUSES.has(input.status)) {
      throw new ValidationError("Invalid reservation status");
    }
    if ((input.startDate && !input.endDate) || (!input.startDate && input.endDate)) {
      throw new ValidationError("startDate and endDate must be supplied together");
    }
    const startDate = input.startDate ? date(input.startDate, "startDate") : null;
    const endDate = input.endDate ? date(input.endDate, "endDate") : null;
    if (startDate && endDate && startDate >= endDate) {
      throw new ValidationError("endDate must be later than startDate");
    }
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ValidationError("limit must be between 1 and 100");
    }
    const rows = await this.reservations.listForProperty(db, {
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      status: input.status ?? null,
      startDate,
      endDate,
      cursor: decodeCursor(input.cursor),
      limit: limit + 1
    });
    const page = rows.slice(0, limit);
    return {
      reservations: page.map(summary),
      nextCursor: rows.length > limit && page.length ? encodeCursor(page[page.length - 1]!) : null
    };
  }

  async operationsSummary(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    businessDate: string
  ): Promise<ReservationOperationsSummary> {
    this.authorization.assert(actor, Permissions.RESERVATION_READ, {
      kind: "property",
      organizationId,
      propertyId
    });
    const normalizedDate = date(businessDate, "date");
    const counts = await this.reservations.operationCounts(
      db,
      organizationId,
      propertyId,
      normalizedDate
    );
    return { propertyId, businessDate: normalizedDate, ...counts };
  }
}
