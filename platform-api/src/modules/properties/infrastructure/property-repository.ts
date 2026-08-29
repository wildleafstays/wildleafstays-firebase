import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import type { Database, PropertiesTable } from "../../../infrastructure/database/types.js";
import type {
  CreatePropertyDraftInput,
  SavePropertyProfileInput
} from "../domain/property-profile.js";

export type PropertyRecord = Selectable<PropertiesTable>;
type DbExecutor = Kysely<Database> | Transaction<Database>;

export class PropertyRepository {
  async createDraft(db: DbExecutor, input: CreatePropertyDraftInput): Promise<PropertyRecord> {
    return db
      .insertInto("properties")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        public_slug: null,
        name: input.name,
        status: "DRAFT",
        timezone: input.timezone,
        property_type: null,
        sale_mode: null,
        short_description: null,
        description: null,
        address_line_1: null,
        address_line_2: null,
        locality: null,
        city: null,
        state_region: null,
        postal_code: null,
        country_code: "IN",
        latitude: null,
        longitude: null,
        contact_phone: null,
        contact_email: null,
        check_in_time: null,
        check_out_time: null
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyRecord | undefined> {
    return db
      .selectFrom("properties")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("id", "=", propertyId)
      .executeTakeFirst();
  }

  async listByOrganization(db: DbExecutor, organizationId: string): Promise<PropertyRecord[]> {
    return db
      .selectFrom("properties")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("status", "<>", "ARCHIVED")
      .orderBy("created_at", "desc")
      .execute();
  }

  async saveProfile(
    db: DbExecutor,
    input: SavePropertyProfileInput
  ): Promise<PropertyRecord | undefined> {
    return db
      .updateTable("properties")
      .set({
        name: input.name,
        timezone: input.timezone,
        property_type: input.propertyType,
        sale_mode: input.saleMode,
        short_description: input.shortDescription,
        description: input.description,
        address_line_1: input.addressLine1,
        address_line_2: input.addressLine2,
        locality: input.locality,
        city: input.city,
        state_region: input.stateRegion,
        postal_code: input.postalCode,
        country_code: input.countryCode,
        latitude: input.latitude === null ? null : input.latitude.toFixed(6),
        longitude: input.longitude === null ? null : input.longitude.toFixed(6),
        contact_phone: input.contactPhone,
        contact_email: input.contactEmail,
        check_in_time: input.checkInTime,
        check_out_time: input.checkOutTime,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", input.organizationId)
      .where("id", "=", input.propertyId)
      .where("version", "=", input.expectedVersion)
      .where("status", "in", ["DRAFT", "CHANGES_REQUIRED", "APPROVED", "LIVE"])
      .returningAll()
      .executeTakeFirst();
  }
}
