export const GuestReservationLinkSources = {
  AUTHENTICATED_CHECKOUT: "AUTHENTICATED_CHECKOUT"
} as const;

export type GuestReservationLinkSource =
  (typeof GuestReservationLinkSources)[keyof typeof GuestReservationLinkSources];

export const GuestSelfServiceAuditActions = {
  GUEST_RESERVATION_LINKED: "GUEST_RESERVATION_LINKED"
} as const;

export interface GuestReservationLinkView {
  reservationId: string;
  userId: string;
  linkSource: GuestReservationLinkSource;
  linkedAt: Date;
}

export interface GuestReservationListCursor {
  linkedAt: Date;
  reservationId: string;
}

export interface GuestReservationView {
  id: string;
  reservationReference: string;
  status: string;
  property: {
    id: string;
    name: string;
    publicSlug: string | null;
  };
  arrivalDate: string;
  departureDate: string;
  product: {
    type: "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX";
    label: string;
    roomCategoryId: string | null;
    quantity: number;
  };
  leadGuest: {
    name: string;
    email: string | null;
    phone: string | null;
  };
  economics: {
    currencyCode: string;
    totalMinor: number;
  };
  linkedAt: string;
  createdAt: string;
}

export interface GuestReservationListResult {
  reservations: GuestReservationView[];
  nextCursor: GuestReservationListCursor | null;
}
