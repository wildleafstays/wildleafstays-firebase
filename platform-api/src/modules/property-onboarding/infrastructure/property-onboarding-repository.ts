import { randomUUID } from "node:crypto";
import { sql, type Kysely, type Selectable, type Transaction } from "kysely";
import type {
  Database,
  PropertiesTable,
  PropertyDocumentsTable,
  PropertyMediaTable,
  PropertyPoliciesTable,
  PropertyReviewRoundsTable
} from "../../../infrastructure/database/types.js";
import type {
  AddDocumentInput,
  AddMediaInput,
  AmenitySelection,
  SavePoliciesInput
} from "../domain/property-onboarding.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export type PropertyRecord = Selectable<PropertiesTable>;
export type PolicyRecord = Selectable<PropertyPoliciesTable>;
export type MediaRecord = Selectable<PropertyMediaTable>;
export type DocumentRecord = Selectable<PropertyDocumentsTable>;
export type ReviewRoundRecord = Selectable<PropertyReviewRoundsTable>;

export interface OnboardingCounts {
  roomCategories: number;
  physicalUnits: number;
  amenities: number;
  activeImages: number;
  coverImages: number;
  rightToOperateDocuments: number;
}

export interface PropertyReviewQueueCursor {
  updatedAt: Date;
  id: string;
}

export interface PropertyReviewQueueRecord {
  id: string;
  organization_id: string;
  organization_legal_name: string;
  organization_trading_name: string | null;
  name: string;
  status: string;
  version: number;
  property_type: string | null;
  sale_mode: string | null;
  city: string | null;
  state_region: string | null;
  country_code: string;
  submission_sequence: number;
  submitted_at: Date | null;
  approved_at: Date | null;
  updated_at: Date;
}

export class PropertyOnboardingRepository {
  async listPlatformReviewQueue(
    db: DbExecutor,
    statuses: string[],
    cursor: PropertyReviewQueueCursor | null,
    limit: number
  ): Promise<PropertyReviewQueueRecord[]> {
    let query = db
      .selectFrom("properties as property")
      .innerJoin("organizations as organization", "organization.id", "property.organization_id")
      .select([
        "property.id",
        "property.organization_id",
        "organization.legal_name as organization_legal_name",
        "organization.trading_name as organization_trading_name",
        "property.name",
        "property.status",
        "property.version",
        "property.property_type",
        "property.sale_mode",
        "property.city",
        "property.state_region",
        "property.country_code",
        "property.submission_sequence",
        "property.submitted_at",
        "property.approved_at",
        "property.updated_at"
      ])
      .where("property.status", "in", statuses);

    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb("property.updated_at", "<", cursor.updatedAt),
          eb.and([
            eb("property.updated_at", "=", cursor.updatedAt),
            eb("property.id", "<", cursor.id)
          ])
        ])
      );
    }

    return query
      .orderBy("property.updated_at", "desc")
      .orderBy("property.id", "desc")
      .limit(limit)
      .execute();
  }

  async findProperty(
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

  async findPropertyById(db: DbExecutor, propertyId: string): Promise<PropertyRecord | undefined> {
    return db.selectFrom("properties").selectAll().where("id", "=", propertyId).executeTakeFirst();
  }

  async getPolicies(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PolicyRecord | undefined> {
    return db
      .selectFrom("property_policies")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async upsertPolicies(db: DbExecutor, input: SavePoliciesInput): Promise<PolicyRecord> {
    return db
      .insertInto("property_policies")
      .values({
        property_id: input.propertyId,
        organization_id: input.organizationId,
        children_policy: input.childrenPolicy,
        pets_policy: input.petsPolicy,
        smoking_policy: input.smokingPolicy,
        parties_events_policy: input.partiesEventsPolicy,
        minimum_checkin_age: input.minimumCheckinAge,
        quiet_hours_start: input.quietHoursStart,
        quiet_hours_end: input.quietHoursEnd,
        house_rules: input.houseRules
      })
      .onConflict((oc) =>
        oc.column("property_id").doUpdateSet({
          children_policy: input.childrenPolicy,
          pets_policy: input.petsPolicy,
          smoking_policy: input.smokingPolicy,
          parties_events_policy: input.partiesEventsPolicy,
          minimum_checkin_age: input.minimumCheckinAge,
          quiet_hours_start: input.quietHoursStart,
          quiet_hours_end: input.quietHoursEnd,
          house_rules: input.houseRules,
          version: sql<number>`property_policies.version + 1`,
          updated_at: sql<Date>`now()`
        })
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async activeAmenityCodes(db: DbExecutor, codes: string[]): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }
    const rows = await db
      .selectFrom("amenity_catalog")
      .select("code")
      .where("active", "=", true)
      .where("code", "in", codes)
      .execute();
    return rows.map((row) => row.code);
  }

  async replaceAmenities(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    amenities: AmenitySelection[]
  ): Promise<void> {
    await db
      .deleteFrom("property_amenities")
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .execute();

    if (amenities.length === 0) {
      return;
    }

    await db
      .insertInto("property_amenities")
      .values(
        amenities.map((amenity) => ({
          organization_id: organizationId,
          property_id: propertyId,
          amenity_code: amenity.code,
          details: amenity.details
        }))
      )
      .execute();
  }

  async listAmenities(db: DbExecutor, organizationId: string, propertyId: string) {
    return db
      .selectFrom("property_amenities as pa")
      .innerJoin("amenity_catalog as ac", "ac.code", "pa.amenity_code")
      .select([
        "pa.amenity_code as code",
        "ac.name as name",
        "ac.category as category",
        "pa.details as details"
      ])
      .where("pa.organization_id", "=", organizationId)
      .where("pa.property_id", "=", propertyId)
      .orderBy("ac.sort_order")
      .orderBy("ac.name")
      .execute();
  }

  async addMedia(db: DbExecutor, actorUserId: string, input: AddMediaInput): Promise<MediaRecord> {
    if (input.isCover) {
      await db
        .updateTable("property_media")
        .set({
          is_cover: false,
          updated_at: sql<Date>`now()`
        })
        .where("organization_id", "=", input.organizationId)
        .where("property_id", "=", input.propertyId)
        .where("status", "=", "ACTIVE")
        .where("is_cover", "=", true)
        .execute();
    }

    return db
      .insertInto("property_media")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        media_type: input.mediaType,
        storage_provider: input.storageProvider,
        storage_key: input.storageKey,
        mime_type: input.mimeType,
        alt_text: input.altText,
        caption: input.caption,
        is_cover: input.isCover,
        sort_order: input.sortOrder,
        status: "ACTIVE",
        created_by_user_id: actorUserId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findMedia(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    mediaId: string
  ): Promise<MediaRecord | undefined> {
    return db
      .selectFrom("property_media")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", mediaId)
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
  }

  async setMediaCover(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    mediaId: string
  ): Promise<MediaRecord | undefined> {
    const target = await this.findMedia(db, organizationId, propertyId, mediaId);
    if (!target || target.media_type !== "IMAGE") {
      return undefined;
    }

    await db
      .updateTable("property_media")
      .set({
        is_cover: false,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .where("is_cover", "=", true)
      .execute();

    return db
      .updateTable("property_media")
      .set({
        is_cover: true,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", mediaId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirst();
  }

  async archiveMedia(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    mediaId: string
  ): Promise<MediaRecord | undefined> {
    return db
      .updateTable("property_media")
      .set({
        status: "ARCHIVED",
        is_cover: false,
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", mediaId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirst();
  }

  async listMedia(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<MediaRecord[]> {
    return db
      .selectFrom("property_media")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .orderBy("is_cover", "desc")
      .orderBy("sort_order")
      .orderBy("created_at")
      .execute();
  }

  async addDocument(
    db: DbExecutor,
    actorUserId: string,
    input: AddDocumentInput
  ): Promise<DocumentRecord> {
    return db
      .insertInto("property_documents")
      .values({
        id: randomUUID(),
        organization_id: input.organizationId,
        property_id: input.propertyId,
        document_type: input.documentType,
        storage_provider: input.storageProvider,
        storage_key: input.storageKey,
        original_filename: input.originalFilename,
        issued_on: input.issuedOn,
        expires_on: input.expiresOn,
        verification_status: "PENDING",
        verification_reason: null,
        verified_by_user_id: null,
        verified_at: null,
        status: "ACTIVE",
        created_by_user_id: actorUserId
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async archiveDocument(
    db: DbExecutor,
    organizationId: string,
    propertyId: string,
    documentId: string
  ): Promise<DocumentRecord | undefined> {
    return db
      .updateTable("property_documents")
      .set({
        status: "ARCHIVED",
        updated_at: sql<Date>`now()`
      })
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("id", "=", documentId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirst();
  }

  async listDocuments(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<DocumentRecord[]> {
    return db
      .selectFrom("property_documents")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .orderBy("created_at", "desc")
      .execute();
  }

  async verifyDocument(
    db: DbExecutor,
    propertyId: string,
    documentId: string,
    reviewerUserId: string,
    decision: "VERIFIED" | "REJECTED",
    reason: string | null
  ): Promise<DocumentRecord | undefined> {
    return db
      .updateTable("property_documents")
      .set({
        verification_status: decision,
        verification_reason: reason,
        verified_by_user_id: reviewerUserId,
        verified_at: sql<Date>`now()`,
        updated_at: sql<Date>`now()`
      })
      .where("property_id", "=", propertyId)
      .where("id", "=", documentId)
      .where("status", "=", "ACTIVE")
      .returningAll()
      .executeTakeFirst();
  }

  async listReviewRounds(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<ReviewRoundRecord[]> {
    return db
      .selectFrom("property_review_rounds")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .orderBy("submission_number", "desc")
      .execute();
  }

  async onboardingCounts(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<OnboardingCounts> {
    const [categoryRow, unitRow, amenityRow, imageRow, coverRow, rightsRow] = await Promise.all([
      db
        .selectFrom("room_categories")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("status", "=", "ACTIVE")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("physical_units")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("status", "=", "ACTIVE")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("property_amenities")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("property_media")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("status", "=", "ACTIVE")
        .where("media_type", "=", "IMAGE")
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("property_media")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("status", "=", "ACTIVE")
        .where("media_type", "=", "IMAGE")
        .where("is_cover", "=", true)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom("property_documents")
        .select((eb) => eb.fn.countAll<number>().as("count"))
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("status", "=", "ACTIVE")
        .where("verification_status", "<>", "REJECTED")
        .where("document_type", "in", ["OWNERSHIP_PROOF", "LEASE_AGREEMENT"])
        .executeTakeFirstOrThrow()
    ]);

    return {
      roomCategories: Number(categoryRow.count),
      physicalUnits: Number(unitRow.count),
      amenities: Number(amenityRow.count),
      activeImages: Number(imageRow.count),
      coverImages: Number(coverRow.count),
      rightToOperateDocuments: Number(rightsRow.count)
    };
  }

  async submitProperty(
    db: DbExecutor,
    property: PropertyRecord,
    expectedVersion: number,
    actorUserId: string
  ): Promise<{ property: PropertyRecord; review: ReviewRoundRecord } | undefined> {
    const nextSubmission = property.submission_sequence + 1;

    const updated = await db
      .updateTable("properties")
      .set({
        status: "SUBMITTED",
        submission_sequence: nextSubmission,
        submitted_at: sql<Date>`now()`,
        approved_at: null,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", property.id)
      .where("organization_id", "=", property.organization_id)
      .where("version", "=", expectedVersion)
      .where("status", "in", ["DRAFT", "CHANGES_REQUIRED"])
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return undefined;
    }

    const review = await db
      .insertInto("property_review_rounds")
      .values({
        id: randomUUID(),
        organization_id: property.organization_id,
        property_id: property.id,
        submission_number: nextSubmission,
        submitted_by_user_id: actorUserId,
        review_started_by_user_id: null,
        review_started_at: null,
        decision: null,
        decision_reason: null,
        decided_by_user_id: null,
        decided_at: null,
        status: "OPEN"
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { property: updated, review };
  }

  async startReview(
    db: DbExecutor,
    property: PropertyRecord,
    expectedVersion: number,
    reviewerUserId: string
  ): Promise<PropertyRecord | undefined> {
    const updated = await db
      .updateTable("properties")
      .set({
        status: "UNDER_REVIEW",
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", property.id)
      .where("version", "=", expectedVersion)
      .where("status", "=", "SUBMITTED")
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return undefined;
    }

    await db
      .updateTable("property_review_rounds")
      .set({
        review_started_by_user_id: reviewerUserId,
        review_started_at: sql<Date>`now()`,
        updated_at: sql<Date>`now()`
      })
      .where("property_id", "=", property.id)
      .where("status", "=", "OPEN")
      .executeTakeFirst();

    return updated;
  }

  async completeReview(
    db: DbExecutor,
    property: PropertyRecord,
    expectedVersion: number,
    reviewerUserId: string,
    decision: "CHANGES_REQUIRED" | "APPROVED",
    reason: string | null
  ): Promise<PropertyRecord | undefined> {
    const updated = await db
      .updateTable("properties")
      .set({
        status: decision,
        approved_at: decision === "APPROVED" ? sql<Date>`now()` : null,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", property.id)
      .where("version", "=", expectedVersion)
      .where("status", "=", "UNDER_REVIEW")
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return undefined;
    }

    await db
      .updateTable("property_review_rounds")
      .set({
        decision,
        decision_reason: reason,
        decided_by_user_id: reviewerUserId,
        decided_at: sql<Date>`now()`,
        status: "COMPLETED",
        updated_at: sql<Date>`now()`
      })
      .where("property_id", "=", property.id)
      .where("status", "=", "OPEN")
      .executeTakeFirst();

    return updated;
  }

  async activateProperty(
    db: DbExecutor,
    property: PropertyRecord,
    expectedVersion: number,
    publicSlug: string
  ): Promise<PropertyRecord | undefined> {
    return db
      .updateTable("properties")
      .set({
        status: "LIVE",
        public_slug: publicSlug,
        live_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`
      })
      .where("id", "=", property.id)
      .where("version", "=", expectedVersion)
      .where("status", "=", "APPROVED")
      .returningAll()
      .executeTakeFirst();
  }
}
