import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface PublicDestinationRecord {
  city: string;
  state_region: string | null;
  country_code: string;
  property_count: number;
}

export interface PublicPropertyRecord {
  id: string;
  organization_id: string;
  public_slug: string | null;
  name: string;
  property_type: string | null;
  sale_mode: string | null;
  short_description: string | null;
  description: string | null;
  locality: string | null;
  city: string | null;
  state_region: string | null;
  country_code: string;
  check_in_time: string | null;
  check_out_time: string | null;
  cover_media_id: string | null;
}

export interface PublicRoomCategoryRecord {
  id: string;
  code: string;
  name: string;
  accommodation_type: string;
  description: string | null;
  base_occupancy: number;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  size_sqm: string | null;
  bed_configuration: string | null;
  extra_bed_allowed: boolean;
  default_view_label: string | null;
}

export interface PublicAmenityRecord {
  code: string;
  name: string;
  category: string;
  details: string | null;
}

export interface PublicPoliciesRecord {
  children_policy: string;
  pets_policy: string;
  smoking_policy: string;
  parties_events_policy: string;
  minimum_checkin_age: number | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  house_rules: string | null;
}

export interface PublicMediaRecord {
  id: string;
  media_type: string;
  mime_type: string | null;
  alt_text: string | null;
  caption: string | null;
  is_cover: boolean;
  sort_order: number;
}

export class PublicCatalogRepository {
  async listDestinations(db: DbExecutor): Promise<PublicDestinationRecord[]> {
    return db
      .selectFrom("properties as p")
      .select([
        "p.city as city",
        "p.state_region as state_region",
        "p.country_code as country_code",
        sql<number>`count(*)::int`.as("property_count")
      ])
      .where("p.status", "=", "LIVE")
      .where("p.public_slug", "is not", null)
      .where("p.city", "is not", null)
      .where(sql<boolean>`btrim(p.city) <> ''`)
      .groupBy(["p.city", "p.state_region", "p.country_code"])
      .orderBy("p.city")
      .orderBy("p.state_region")
      .limit(200)
      .execute() as Promise<PublicDestinationRecord[]>;
  }

  async listProperties(
    db: DbExecutor,
    destination: string | null,
    limit: number
  ): Promise<PublicPropertyRecord[]> {
    let query = db
      .selectFrom("properties as p")
      .leftJoin("property_media as cover", (join) =>
        join
          .onRef("cover.organization_id", "=", "p.organization_id")
          .onRef("cover.property_id", "=", "p.id")
          .on("cover.status", "=", "ACTIVE")
          .on("cover.media_type", "=", "IMAGE")
          .on("cover.is_cover", "=", true)
      )
      .select([
        "p.id as id",
        "p.organization_id as organization_id",
        "p.public_slug as public_slug",
        "p.name as name",
        "p.property_type as property_type",
        "p.sale_mode as sale_mode",
        "p.short_description as short_description",
        "p.description as description",
        "p.locality as locality",
        "p.city as city",
        "p.state_region as state_region",
        "p.country_code as country_code",
        "p.check_in_time as check_in_time",
        "p.check_out_time as check_out_time",
        "cover.id as cover_media_id"
      ])
      .distinct()
      .where("p.status", "=", "LIVE")
      .where("p.public_slug", "is not", null);

    if (destination !== null) {
      query = query.where(
        sql<boolean>`(
          lower(btrim(coalesce(p.city, ''))) = lower(btrim(${destination}))
          or lower(btrim(coalesce(p.locality, ''))) = lower(btrim(${destination}))
          or lower(btrim(coalesce(p.state_region, ''))) = lower(btrim(${destination}))
        )`
      );
    }

    return query.orderBy("p.city").orderBy("p.name").limit(limit).execute() as Promise<
      PublicPropertyRecord[]
    >;
  }

  async findPropertyBySlug(
    db: DbExecutor,
    publicSlug: string
  ): Promise<PublicPropertyRecord | undefined> {
    return db
      .selectFrom("properties as p")
      .leftJoin("property_media as cover", (join) =>
        join
          .onRef("cover.organization_id", "=", "p.organization_id")
          .onRef("cover.property_id", "=", "p.id")
          .on("cover.status", "=", "ACTIVE")
          .on("cover.media_type", "=", "IMAGE")
          .on("cover.is_cover", "=", true)
      )
      .select([
        "p.id as id",
        "p.organization_id as organization_id",
        "p.public_slug as public_slug",
        "p.name as name",
        "p.property_type as property_type",
        "p.sale_mode as sale_mode",
        "p.short_description as short_description",
        "p.description as description",
        "p.locality as locality",
        "p.city as city",
        "p.state_region as state_region",
        "p.country_code as country_code",
        "p.check_in_time as check_in_time",
        "p.check_out_time as check_out_time",
        "cover.id as cover_media_id"
      ])
      .where("p.status", "=", "LIVE")
      .where("p.public_slug", "=", publicSlug)
      .executeTakeFirst() as Promise<PublicPropertyRecord | undefined>;
  }

  async listRoomCategories(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicRoomCategoryRecord[]> {
    return db
      .selectFrom("room_categories")
      .select([
        "id",
        "code",
        "name",
        "accommodation_type",
        "description",
        "base_occupancy",
        "max_adults",
        "max_children",
        "max_occupancy",
        "size_sqm",
        "bed_configuration",
        "extra_bed_allowed",
        "default_view_label"
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .orderBy("sort_order")
      .orderBy("name")
      .execute();
  }

  async listAmenities(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicAmenityRecord[]> {
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
      .where("ac.active", "=", true)
      .orderBy("ac.sort_order")
      .orderBy("ac.name")
      .execute();
  }

  async getPolicies(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicPoliciesRecord | undefined> {
    return db
      .selectFrom("property_policies")
      .select([
        "children_policy",
        "pets_policy",
        "smoking_policy",
        "parties_events_policy",
        "minimum_checkin_age",
        "quiet_hours_start",
        "quiet_hours_end",
        "house_rules"
      ])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .executeTakeFirst();
  }

  async listMedia(
    db: DbExecutor,
    organizationId: string,
    propertyId: string
  ): Promise<PublicMediaRecord[]> {
    return db
      .selectFrom("property_media")
      .select(["id", "media_type", "mime_type", "alt_text", "caption", "is_cover", "sort_order"])
      .where("organization_id", "=", organizationId)
      .where("property_id", "=", propertyId)
      .where("status", "=", "ACTIVE")
      .where("media_type", "=", "IMAGE")
      .orderBy("is_cover", "desc")
      .orderBy("sort_order")
      .orderBy("created_at")
      .execute();
  }
}
