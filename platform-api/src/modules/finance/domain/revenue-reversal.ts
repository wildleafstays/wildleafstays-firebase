import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { FinancialLedgerJournalView } from "./financial-ledger.js";

export interface RevenueReversalRequestedLine extends JsonObject {
  revenueScheduleLineId: string;
  amountMinor: number;
}

export interface RevenueReversalLineView extends JsonObject {
  id: string;
  reversalId: string;
  lineNumber: number;
  revenueScheduleLineId: string;
  revenueRecognitionJournalId: string;
  amountMinor: number;
  currencyCode: string;
  createdAt: string;
}

export interface RevenueReversalView extends JsonObject {
  id: string;
  organizationId: string;
  propertyId: string;
  reservationId: string;
  operationId: string;
  reasonCode: string;
  note: string;
  currencyCode: string;
  amountMinor: number;
  lineCount: number;
  actorUserId: string;
  createdAt: string;
  lines: RevenueReversalLineView[];
}

export interface RevenueReversalResult extends JsonObject {
  created: boolean;
  createdJournalCount: number;
  reversal: RevenueReversalView;
  journals: FinancialLedgerJournalView[];
}
