import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { InventoryHoldView } from "../../inventory/domain/inventory-hold.js";

export interface CreateQuoteHoldInput extends JsonObject {
  organizationId: string;
  propertyId: string;
  quoteId: string;
}

export interface QuoteHoldView extends JsonObject {
  id: string;
  quoteId: string;
  quoteReference: string;
  inventoryHoldId: string;
  linkedAt: string;
  hold: InventoryHoldView;
}

export interface QuoteHoldResult extends JsonObject {
  created: boolean;
  quoteHold: QuoteHoldView;
}
