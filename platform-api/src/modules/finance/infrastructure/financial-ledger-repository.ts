import { randomUUID } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type {
  FinancialLedgerAccount,
  FinancialLedgerDirection,
  FinancialLedgerEntryView,
  FinancialLedgerJournalType,
  FinancialLedgerJournalView
} from "../domain/financial-ledger.js";
import type {
  FinancialLedgerEntriesTable,
  FinancialLedgerJournalsTable
} from "./financial-ledger-database-types.js";

export type FinancialLedgerJournalRecord = Selectable<FinancialLedgerJournalsTable>;
export type FinancialLedgerEntryRecord = Selectable<FinancialLedgerEntriesTable>;

interface CreateJournalInput {
  organizationId: string;
  propertyId: string;
  reservationId: string;
  paymentIntentId: string;
  journalType: FinancialLedgerJournalType;
  paymentEvidenceId: string | null;
  refundFinalizationId: string | null;
  amountMinor: number;
  currencyCode: string;
  occurredAt: Date;
  source: string;
  requestId: string;
  correlationId: string;
}

interface CreateEntryInput {
  lineNumber: number;
  accountCode: FinancialLedgerAccount;
  direction: FinancialLedgerDirection;
  amountMinor: number;
  currencyCode: string;
}

export class FinancialLedgerRepository {
  async findByPaymentEvidence(
    trx: Transaction<Database>,
    paymentEvidenceId: string
  ): Promise<FinancialLedgerJournalRecord | undefined> {
    return trx
      .selectFrom("financial_ledger_journals")
      .selectAll()
      .where("payment_evidence_id", "=", paymentEvidenceId)
      .executeTakeFirst();
  }

  async findByRefundFinalization(
    trx: Transaction<Database>,
    refundFinalizationId: string
  ): Promise<FinancialLedgerJournalRecord | undefined> {
    return trx
      .selectFrom("financial_ledger_journals")
      .selectAll()
      .where("refund_finalization_id", "=", refundFinalizationId)
      .executeTakeFirst();
  }

  async findEntries(
    trx: Transaction<Database>,
    journalId: string
  ): Promise<FinancialLedgerEntryRecord[]> {
    return trx
      .selectFrom("financial_ledger_entries")
      .selectAll()
      .where("journal_id", "=", journalId)
      .orderBy("line_number", "asc")
      .execute();
  }

  async createJournal(
    trx: Transaction<Database>,
    input: CreateJournalInput
  ): Promise<FinancialLedgerJournalRecord | undefined> {
    return trx
      .insertInto("financial_ledger_journals")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        reservation_id: input.reservationId,
        payment_intent_id: input.paymentIntentId,
        journal_type: input.journalType,
        payment_evidence_id: input.paymentEvidenceId,
        refund_finalization_id: input.refundFinalizationId,
        amount_minor: input.amountMinor,
        currency_code: input.currencyCode,
        occurred_at: input.occurredAt,
        source: input.source,
        request_id: input.requestId,
        correlation_id: input.correlationId
      })
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async createEntries(
    trx: Transaction<Database>,
    journal: FinancialLedgerJournalRecord,
    entries: CreateEntryInput[]
  ): Promise<FinancialLedgerEntryRecord[]> {
    return trx
      .insertInto("financial_ledger_entries")
      .values(
        entries.map((entry) => ({
          id: randomUUID(),
          journal_id: journal.id,
          organization_id: journal.organization_id,
          property_id: journal.property_id,
          line_number: entry.lineNumber,
          account_code: entry.accountCode,
          direction: entry.direction,
          amount_minor: entry.amountMinor,
          currency_code: entry.currencyCode
        }))
      )
      .returningAll()
      .execute();
  }

  view(
    journal: FinancialLedgerJournalRecord,
    entries: FinancialLedgerEntryRecord[]
  ): FinancialLedgerJournalView {
    return {
      id: journal.id,
      organizationId: journal.organization_id,
      propertyId: journal.property_id,
      reservationId: journal.reservation_id,
      paymentIntentId: journal.payment_intent_id,
      journalType: journal.journal_type as FinancialLedgerJournalType,
      paymentEvidenceId: journal.payment_evidence_id,
      refundFinalizationId: journal.refund_finalization_id,
      amountMinor: journal.amount_minor,
      currencyCode: journal.currency_code,
      occurredAt: journal.occurred_at.toISOString(),
      createdAt: journal.created_at.toISOString(),
      entries: entries.map((entry): FinancialLedgerEntryView => ({
        id: entry.id,
        lineNumber: entry.line_number,
        accountCode: entry.account_code as FinancialLedgerAccount,
        direction: entry.direction as FinancialLedgerDirection,
        amountMinor: entry.amount_minor,
        currencyCode: entry.currency_code,
        createdAt: entry.created_at.toISOString()
      }))
    };
  }
}
