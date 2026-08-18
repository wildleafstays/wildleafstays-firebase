import type { JsonObject } from "../../../infrastructure/database/types.js";

export const PaymentProcessingOutcomes = {
  RESERVATION_CONFIRMED: "RESERVATION_CONFIRMED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED"
} as const;

export type PaymentProcessingOutcome =
  (typeof PaymentProcessingOutcomes)[keyof typeof PaymentProcessingOutcomes];

export const PaymentReconciliationReasons = {
  INVENTORY_HOLD_EXPIRED: "INVENTORY_HOLD_EXPIRED",
  INVENTORY_HOLD_NOT_ACTIVE: "INVENTORY_HOLD_NOT_ACTIVE",
  INVENTORY_HOLD_UNAVAILABLE: "INVENTORY_HOLD_UNAVAILABLE",
  RESERVATION_STATE_MISMATCH: "RESERVATION_STATE_MISMATCH",
  DUPLICATE_VERIFIED_PAYMENT: "DUPLICATE_VERIFIED_PAYMENT"
} as const;

export type PaymentReconciliationReason =
  (typeof PaymentReconciliationReasons)[keyof typeof PaymentReconciliationReasons];

export const PaymentReconciliationActions = {
  REFUND_REQUIRED: "REFUND_REQUIRED",
  MANUAL_REVIEW: "MANUAL_REVIEW"
} as const;

export type PaymentReconciliationAction =
  (typeof PaymentReconciliationActions)[keyof typeof PaymentReconciliationActions];

export const PaymentReconciliationResolutionCodes = {
  PROVIDER_REFUND_PROCESSED: "PROVIDER_REFUND_PROCESSED",
  PAYMENT_RETAINED: "PAYMENT_RETAINED"
} as const;

export type PaymentReconciliationResolutionCode =
  (typeof PaymentReconciliationResolutionCodes)[keyof typeof PaymentReconciliationResolutionCodes];

export interface PaymentSuccessView extends JsonObject {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  outcome: PaymentProcessingOutcome;
  inventoryAllocationId: string | null;
  createdAt: string;
}

export interface PaymentReconciliationView extends JsonObject {
  id: string;
  paymentIntentId: string;
  paymentEvidenceId: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  reasonCode: PaymentReconciliationReason;
  requiredAction: PaymentReconciliationAction;
  status: "OPEN" | "RESOLVED";
  details: JsonObject;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionCode: PaymentReconciliationResolutionCode | null;
  resolutionNote: string | null;
}

export interface ProcessVerifiedPaymentResult extends JsonObject {
  processed: boolean;
  outcome: PaymentProcessingOutcome;
  paymentIntentId: string;
  reservationId: string;
  paymentEvidenceId: string;
  paymentSuccessId: string | null;
  inventoryAllocationId: string | null;
  reconciliationCaseId: string | null;
}
