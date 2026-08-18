import type { JsonObject } from "../../../infrastructure/database/types.js";

export const FinancialLedgerJournalTypes = {
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  REFUND_PROCESSED: "REFUND_PROCESSED"
} as const;

export type FinancialLedgerJournalType =
  (typeof FinancialLedgerJournalTypes)[keyof typeof FinancialLedgerJournalTypes];

export const FinancialLedgerAccounts = {
  PAYMENT_PROVIDER_CLEARING: "PAYMENT_PROVIDER_CLEARING",
  GUEST_FUNDS_HELD: "GUEST_FUNDS_HELD"
} as const;

export type FinancialLedgerAccount =
  (typeof FinancialLedgerAccounts)[keyof typeof FinancialLedgerAccounts];

export const FinancialLedgerDirections = {
  DEBIT: "DEBIT",
  CREDIT: "CREDIT"
} as const;

export type FinancialLedgerDirection =
  (typeof FinancialLedgerDirections)[keyof typeof FinancialLedgerDirections];

export interface FinancialLedgerEntryView extends JsonObject {
  id: string;
  lineNumber: number;
  accountCode: FinancialLedgerAccount;
  direction: FinancialLedgerDirection;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
}

export interface FinancialLedgerJournalView extends JsonObject {
  id: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  journalType: FinancialLedgerJournalType;
  paymentEvidenceId: string | null;
  refundFinalizationId: string | null;
  amountMinor: number;
  currencyCode: string;
  occurredAt: string;
  createdAt: string;
  entries: FinancialLedgerEntryView[];
}

export interface FinancialLedgerPostingResult extends JsonObject {
  created: boolean;
  journal: FinancialLedgerJournalView;
}
