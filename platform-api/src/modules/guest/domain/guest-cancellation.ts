import type { JsonObject } from "../../../infrastructure/database/types.js";

export const GuestCancellationPenaltyTypes = {
  PERCENTAGE_OF_STAY: "PERCENTAGE_OF_STAY",
  FIXED_AMOUNT: "FIXED_AMOUNT",
  NIGHTS: "NIGHTS"
} as const;

export type GuestCancellationPenaltyType =
  (typeof GuestCancellationPenaltyTypes)[keyof typeof GuestCancellationPenaltyTypes];

export const GuestCancellationRefundSources = {
  RESERVATION_CANCELLATION: "RESERVATION_CANCELLATION"
} as const;

export interface GuestCancellationDecisionView extends JsonObject {
  id: string;
  reservationId: string;
  organizationId: string;
  propertyId: string;
  guestUserId: string;
  quoteId: string;
  quoteCancellationSnapshotId: string;
  quoteCancellationTierSnapshotId: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  cancelledAt: string;
  arrivalAt: string;
  minutesBeforeArrival: number;
  tierMinimumMinutesBeforeArrival: number;
  penaltyType: GuestCancellationPenaltyType;
  penaltyValue: number;
  acceptedTotalMinor: number;
  paidMinor: number;
  penaltyMinor: number;
  refundDueMinor: number;
  currencyCode: string;
  provider: string;
  providerPaymentId: string;
  createdAt: string;
}
