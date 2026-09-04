import type { Kysely, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import {
  GuestReservationLinkSources,
  GuestSelfServiceAuditActions,
  type GuestReservationLinkView,
  type GuestReservationListCursor,
  type GuestReservationListResult,
  type GuestReservationView
} from "../domain/guest-self-service.js";
import {
  GuestSelfServiceRepository,
  type GuestReservationLinkRecord,
  type GuestReservationSelfServiceRecord
} from "../infrastructure/guest-self-service-repository.js";

function linkView(record: GuestReservationLinkRecord): GuestReservationLinkView {
  return {
    reservationId: record.reservation_id,
    userId: record.user_id,
    linkSource: GuestReservationLinkSources.AUTHENTICATED_CHECKOUT,
    linkedAt: record.linked_at
  };
}

function reservationView(record: GuestReservationSelfServiceRecord): GuestReservationView {
  if (
    record.product_type !== "ROOM_CATEGORY" &&
    record.product_type !== "FULL_PROPERTY" &&
    record.product_type !== "ROOM_MIX"
  ) {
    throw new ConflictError("Guest reservation has an unsupported product type", {
      reservationId: record.id,
      productType: record.product_type
    });
  }

  return {
    id: record.id,
    reservationReference: record.reservation_reference,
    status: record.status,
    property: {
      id: record.property_id,
      name: record.property_name,
      publicSlug: record.public_slug
    },
    arrivalDate: record.arrival_date,
    departureDate: record.departure_date,
    product: {
      type: record.product_type,
      label: record.product_label,
      roomCategoryId: record.room_category_id,
      quantity: record.quantity
    },
    leadGuest: {
      name: record.guest_name,
      email: record.email,
      phone: record.phone_e164
    },
    economics: {
      currencyCode: record.currency_code,
      totalMinor: record.total_minor
    },
    linkedAt: record.linked_at.toISOString(),
    createdAt: record.created_at.toISOString()
  };
}

export interface LinkAuthenticatedCheckoutInput {
  actor: ActorContext;
  reservationId: string;
  organizationId: string;
  propertyId: string;
  request: RequestMetadata;
}

export interface LinkAuthenticatedCheckoutResult {
  link: GuestReservationLinkView;
  created: boolean;
}

export class GuestSelfService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly repository = new GuestSelfServiceRepository()
  ) {}

  async linkAuthenticatedCheckout(
    trx: Transaction<Database>,
    input: LinkAuthenticatedCheckoutInput
  ): Promise<LinkAuthenticatedCheckoutResult> {
    const existing = await this.repository.findReservationLink(trx, input.reservationId);

    if (existing) {
      if (
        existing.user_id !== input.actor.userId ||
        existing.link_source !== GuestReservationLinkSources.AUTHENTICATED_CHECKOUT
      ) {
        throw new ConflictError("Reservation is already linked to another guest account", {
          reservationId: input.reservationId
        });
      }

      return {
        link: linkView(existing),
        created: false
      };
    }

    const inserted = await this.repository.insertReservationLinkIfAbsent(trx, {
      reservationId: input.reservationId,
      userId: input.actor.userId,
      linkSource: GuestReservationLinkSources.AUTHENTICATED_CHECKOUT
    });

    const canonical =
      inserted ?? (await this.repository.findReservationLink(trx, input.reservationId));

    if (
      !canonical ||
      canonical.user_id !== input.actor.userId ||
      canonical.link_source !== GuestReservationLinkSources.AUTHENTICATED_CHECKOUT
    ) {
      throw new ConflictError("Reservation ownership could not be established safely", {
        reservationId: input.reservationId
      });
    }

    if (inserted) {
      await new AuditService(trx).record({
        actor: input.actor,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: GuestSelfServiceAuditActions.GUEST_RESERVATION_LINKED,
        entityType: "GUEST_RESERVATION_LINK",
        entityId: input.reservationId,
        before: null,
        after: {
          reservationId: input.reservationId,
          userId: input.actor.userId,
          linkSource: GuestReservationLinkSources.AUTHENTICATED_CHECKOUT
        },
        metadata: {
          linkSource: GuestReservationLinkSources.AUTHENTICATED_CHECKOUT
        },
        request: input.request
      });
    }

    return {
      link: linkView(canonical),
      created: inserted !== undefined
    };
  }

  async listReservations(input: {
    userId: string;
    cursor: GuestReservationListCursor | null;
    limit: number;
  }): Promise<GuestReservationListResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new ValidationError("Guest reservation list limit must be between 1 and 100");
    }

    const rows = await this.repository.listReservationViewsForUser(this.db, {
      userId: input.userId,
      cursor: input.cursor,
      limit: input.limit + 1
    });

    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows.at(-1);

    return {
      reservations: pageRows.map(reservationView),
      nextCursor:
        hasMore && last
          ? {
              linkedAt: last.linked_at,
              reservationId: last.id
            }
          : null
    };
  }

  async getReservation(userId: string, reservationId: string): Promise<GuestReservationView> {
    const record = await this.repository.findReservationViewForUser(this.db, userId, reservationId);

    if (!record) {
      throw new NotFoundError("Guest reservation not found");
    }

    return reservationView(record);
  }
}
