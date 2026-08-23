import type { Generated } from "kysely";

export interface GuestReservationLinksTable {
  reservation_id: string;
  user_id: string;
  link_source: string;
  linked_at: Generated<Date>;
}
