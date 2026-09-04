import { sql, type Insertable, type Kysely, type Selectable, type Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type {
  GuestReservationLinkSource,
  GuestReservationListCursor
} from "../domain/guest-self-service.js";
import type { GuestReservationLinksTable } from "./guest-self-service-database-types.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type GuestReservationLinkRecord = Selectable<GuestReservationLinksTable>;

export interface InsertGuestReservationLinkInput {
  reservationId: string;
  userId: string;
  linkSource: GuestReservationLinkSource;
}

export interface GuestReservationSelfServiceRecord {
  linked_at: Date;
  id: string;
  reservation_reference: string;
  status: string;
  property_id: string;
  property_name: string;
  public_slug: string | null;
  arrival_date: string;
  departure_date: string;
  product_type: string;
  product_label: string;
  room_category_id: string | null;
  quantity: number;
  currency_code: string;
  total_minor: number;
  guest_name: string;
  email: string | null;
  phone_e164: string | null;
  created_at: Date;
}

export class GuestSelfServiceRepository {
  async findReservationLink(
    db: DbExecutor,
    reservationId: string
  ): Promise<GuestReservationLinkRecord | undefined> {
    return db
      .selectFrom("guest_reservation_links")
      .selectAll()
      .where("reservation_id", "=", reservationId)
      .executeTakeFirst();
  }

  async findReservationLinkForUser(
    db: DbExecutor,
    userId: string,
    reservationId: string
  ): Promise<GuestReservationLinkRecord | undefined> {
    return db
      .selectFrom("guest_reservation_links")
      .selectAll()
      .where("user_id", "=", userId)
      .where("reservation_id", "=", reservationId)
      .executeTakeFirst();
  }

  async insertReservationLinkIfAbsent(
    db: DbExecutor,
    input: InsertGuestReservationLinkInput
  ): Promise<GuestReservationLinkRecord | undefined> {
    const values: Insertable<GuestReservationLinksTable> = {
      reservation_id: input.reservationId,
      user_id: input.userId,
      link_source: input.linkSource
    };

    return db
      .insertInto("guest_reservation_links")
      .values(values)
      .onConflict((conflict) => conflict.column("reservation_id").doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async listReservationViewsForUser(
    db: DbExecutor,
    input: {
      userId: string;
      cursor: GuestReservationListCursor | null;
      limit: number;
    }
  ): Promise<GuestReservationSelfServiceRecord[]> {
    let query = db
      .selectFrom("guest_reservation_links as link")
      .innerJoin("reservations as reservation", "reservation.id", "link.reservation_id")
      .innerJoin("properties as property", "property.id", "reservation.property_id")
      .leftJoin(
        "reservation_financial_snapshots as financial",
        "financial.reservation_id",
        "reservation.id"
      )
      .leftJoin(
        "reservation_room_mix_financial_snapshots as room_mix_financial",
        "room_mix_financial.reservation_id",
        "reservation.id"
      )
      .innerJoin(
        "reservation_lead_guest_snapshots as guest",
        "guest.reservation_id",
        "reservation.id"
      )
      .select([
        "link.linked_at",
        "reservation.id",
        "reservation.reservation_reference",
        "reservation.status",
        "reservation.property_id",
        "property.name as property_name",
        "property.public_slug",
        "reservation.arrival_date",
        "reservation.departure_date",
        "reservation.product_type",
        sql<string>`coalesce(financial.product_label, room_mix_financial.product_label)`.as(
          "product_label"
        ),
        "reservation.room_category_id",
        "reservation.quantity",
        "reservation.currency_code",
        "reservation.total_minor",
        "guest.guest_name",
        "guest.email",
        "guest.phone_e164",
        "reservation.created_at"
      ])
      .where("link.user_id", "=", input.userId);

    if (input.cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("link.linked_at", "<", input.cursor!.linkedAt),
          eb.and([
            eb("link.linked_at", "=", input.cursor!.linkedAt),
            eb("link.reservation_id", "<", input.cursor!.reservationId)
          ])
        ])
      );
    }

    return query
      .orderBy("link.linked_at", "desc")
      .orderBy("link.reservation_id", "desc")
      .limit(input.limit)
      .execute();
  }

  async findReservationViewForUser(
    db: DbExecutor,
    userId: string,
    reservationId: string
  ): Promise<GuestReservationSelfServiceRecord | undefined> {
    return db
      .selectFrom("guest_reservation_links as link")
      .innerJoin("reservations as reservation", "reservation.id", "link.reservation_id")
      .innerJoin("properties as property", "property.id", "reservation.property_id")
      .leftJoin(
        "reservation_financial_snapshots as financial",
        "financial.reservation_id",
        "reservation.id"
      )
      .leftJoin(
        "reservation_room_mix_financial_snapshots as room_mix_financial",
        "room_mix_financial.reservation_id",
        "reservation.id"
      )
      .innerJoin(
        "reservation_lead_guest_snapshots as guest",
        "guest.reservation_id",
        "reservation.id"
      )
      .select([
        "link.linked_at",
        "reservation.id",
        "reservation.reservation_reference",
        "reservation.status",
        "reservation.property_id",
        "property.name as property_name",
        "property.public_slug",
        "reservation.arrival_date",
        "reservation.departure_date",
        "reservation.product_type",
        sql<string>`coalesce(financial.product_label, room_mix_financial.product_label)`.as(
          "product_label"
        ),
        "reservation.room_category_id",
        "reservation.quantity",
        "reservation.currency_code",
        "reservation.total_minor",
        "guest.guest_name",
        "guest.email",
        "guest.phone_e164",
        "reservation.created_at"
      ])
      .where("link.user_id", "=", userId)
      .where("link.reservation_id", "=", reservationId)
      .executeTakeFirst();
  }
}
