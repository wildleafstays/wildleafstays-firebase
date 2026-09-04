import type { JsonObject } from "../../../infrastructure/database/types.js";

export const ReservationStatuses = {
  HELD: "HELD",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  CONFIRMED: "CONFIRMED",
  CHECKED_IN: "CHECKED_IN",
  CHECKED_OUT: "CHECKED_OUT",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  NO_SHOW: "NO_SHOW"
} as const;

export type ReservationStatus = (typeof ReservationStatuses)[keyof typeof ReservationStatuses];

export interface LeadGuestInput extends JsonObject {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export interface LeadGuestSnapshotView extends JsonObject {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ReservationFinancialSnapshotView extends JsonObject {
  quoteReference: string;
  ratePlanId: string | null;
  ratePlanCode: string | null;
  ratePlanName: string | null;
  mealPlanCode: string | null;
  rateProductId: string | null;
  rateProductVersion: number | null;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX";
  productLabel: string;
  roomCategoryId: string | null;
  arrivalDate: string;
  departureDate: string;
  quantity: number;
  commercialStatus: "COMMERCIAL_RULES_APPLIED";
  promotionStatus: "EVALUATED";
  currencyCode: string;
  grossAccommodationMinor: number;
  grossExtraGuestMinor: number;
  accommodationDiscountMinor: number;
  extraGuestDiscountMinor: number;
  discountMinor: number;
  discountedAccommodationMinor: number;
  discountedExtraGuestMinor: number;
  inclusiveFeeMinor: number;
  exclusiveFeeMinor: number;
  feeMinor: number;
  inclusiveTaxMinor: number;
  exclusiveTaxMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface ReservationView extends JsonObject {
  id: string;
  reservationReference: string;
  organizationId: string;
  propertyId: string;
  quoteId: string | null;
  quoteInventoryHoldId: string | null;
  roomMixQuoteId: string | null;
  roomMixInventoryHoldId: string | null;
  inventoryHoldId: string;
  status: ReservationStatus;
  holdExpiresAt: string;
  holdExpired: boolean;
  arrivalDate: string;
  departureDate: string;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX";
  roomCategoryId: string | null;
  quantity: number;
  currencyCode: string;
  totalMinor: number;
  leadGuest: LeadGuestSnapshotView;
  financial: ReservationFinancialSnapshotView;
  createdAt: string;
}

export interface HeldReservationResult extends JsonObject {
  created: boolean;
  reservation: ReservationView;
}

export interface ReservationSummaryView extends JsonObject {
  id: string;
  organizationId: string;
  propertyId: string;
  reservationReference: string;
  status: ReservationStatus;
  arrivalDate: string;
  departureDate: string;
  productType: "ROOM_CATEGORY" | "FULL_PROPERTY" | "ROOM_MIX";
  productLabel: string;
  roomCategoryId: string | null;
  quantity: number;
  currencyCode: string;
  totalMinor: number;
  leadGuest: LeadGuestSnapshotView;
  createdAt: string;
}

export interface PlatformReservationSummaryView extends ReservationSummaryView {
  organizationName: string;
  propertyName: string;
}

export interface ReservationOperationsSummary extends JsonObject {
  propertyId: string;
  businessDate: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  upcoming: number;
  paymentPending: number;
}

export interface PlatformReservationOperationsSummary extends JsonObject {
  businessDate: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  upcoming: number;
  paymentPending: number;
}
