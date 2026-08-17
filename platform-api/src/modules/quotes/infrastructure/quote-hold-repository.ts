import { randomUUID } from "node:crypto";
import type { Insertable, Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import type { QuoteInventoryHoldsTable } from "./quote-hold-database-types.js";

export type QuoteInventoryHoldRecord = Selectable<QuoteInventoryHoldsTable>;

export class QuoteHoldRepository {
  async lockQuote(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    quoteId: string
  ): Promise<{ id: string } | undefined> {
    return trx
      .selectFrom("quotes")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", quoteId)
      .forUpdate()
      .executeTakeFirst();
  }

  async findByQuote(
    trx: Transaction<Database>,
    organizationId: string,
    propertyId: string,
    quoteId: string
  ): Promise<QuoteInventoryHoldRecord | undefined> {
    return trx
      .selectFrom("quote_inventory_holds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("quote_id", "=", quoteId)
      .executeTakeFirst();
  }

  async createLink(
    trx: Transaction<Database>,
    input: {
      organizationId: string;
      propertyId: string;
      quoteId: string;
      inventoryHoldId: string;
      linkedByUserId: string | null;
      request: RequestMetadata;
    }
  ): Promise<QuoteInventoryHoldRecord> {
    const values: Insertable<Database["quote_inventory_holds"]> = {
      id: randomUUID(),
      quote_id: input.quoteId,
      inventory_hold_id: input.inventoryHoldId,
      organization_id: input.organizationId,
      property_id: input.propertyId,
      linked_by_user_id: input.linkedByUserId,
      source: input.request.source,
      request_id: input.request.requestId,
      correlation_id: input.request.correlationId
    };

    return trx
      .insertInto("quote_inventory_holds")
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
