import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import { registerPublicCatalogRoutes } from "../src/modules/public-booking/transport/public-catalog-routes.js";
import { registerErrorHandler } from "../src/shared/http/error-handler.js";

const config = loadConfig();
const db = createDatabase(config);

interface Fixture {
  organizationId: string;
  draftPropertyId: string;
  publicSlug: string;
  draftSlug: string;
  city: string;
  otherCity: string;
  activeRoomCategoryId: string;
  retiredRoomCategoryId: string;
  amenityCode: string;
  activeMediaId: string;
  archivedMediaId: string;
  privateEmail: string;
  privatePhone: string;
  privateAddress: string;
  privateStorageKey: string;
}

let app: FastifyInstance;
let fixture: Fixture;

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const organizationId = randomUUID();
  const livePropertyId = randomUUID();
  const draftPropertyId = randomUUID();
  const otherLivePropertyId = randomUUID();
  const activeRoomCategoryId = randomUUID();
  const retiredRoomCategoryId = randomUUID();
  const activeMediaId = randomUUID();
  const archivedMediaId = randomUUID();
  const publicSlug = `wildleaf-catalog-${suffix}`;
  const draftSlug = `draft-${suffix}`;
  const city = `Catalog City ${suffix}`;
  const otherCity = `Other City ${suffix}`;
  const amenityCode = `CATALOG_${suffix.toUpperCase()}`;
  const privateEmail = `private-${suffix}@example.invalid`;
  const privatePhone = `+9199${suffix.slice(0, 8)}`;
  const privateAddress = `Private Street ${suffix}`;
  const privateStorageKey = `private/catalog/${suffix}/cover.jpg`;

  await db
    .insertInto("organizations")
    .values({
      id: organizationId,
      legal_name: `Catalog Organization ${suffix}`,
      trading_name: "Wildleaf Catalog Test",
      organization_type: "PRIVATE_LIMITED",
      status: "ACTIVE",
      country_code: "IN",
      currency_code: "INR"
    })
    .execute();

  await db
    .insertInto("properties")
    .values({
      id: livePropertyId,
      organization_id: organizationId,
      public_slug: publicSlug,
      name: `Wildleaf Catalog Live ${suffix}`,
      status: "LIVE",
      timezone: "Asia/Kolkata",
      property_type: "RESORT",
      sale_mode: "BOTH",
      short_description: "Public catalog summary",
      description: "Public catalog long description",
      address_line_1: privateAddress,
      address_line_2: "Private address line two",
      locality: "Hillside",
      city,
      state_region: "Himachal Pradesh",
      postal_code: "173217",
      country_code: "IN",
      latitude: "31.123456",
      longitude: "77.123456",
      contact_phone: privatePhone,
      contact_email: privateEmail,
      check_in_time: "14:00",
      check_out_time: "11:00",
      live_at: new Date()
    })
    .execute();

  await db
    .insertInto("properties")
    .values({
      id: draftPropertyId,
      organization_id: organizationId,
      public_slug: draftSlug,
      name: `Wildleaf Catalog Draft ${suffix}`,
      status: "DRAFT",
      timezone: "Asia/Kolkata",
      property_type: "HOTEL",
      sale_mode: "ROOMS_ONLY",
      short_description: "Must never be public",
      locality: "Hillside",
      city,
      state_region: "Himachal Pradesh",
      country_code: "IN"
    })
    .execute();

  await db
    .insertInto("properties")
    .values({
      id: otherLivePropertyId,
      organization_id: organizationId,
      public_slug: `wildleaf-other-${suffix}`,
      name: `Wildleaf Other Live ${suffix}`,
      status: "LIVE",
      timezone: "Asia/Kolkata",
      property_type: "HOMESTAY",
      sale_mode: "ROOMS_ONLY",
      short_description: "Another public destination",
      locality: "Valley",
      city: otherCity,
      state_region: "Himachal Pradesh",
      country_code: "IN",
      live_at: new Date()
    })
    .execute();

  await db
    .insertInto("room_categories")
    .values([
      {
        id: activeRoomCategoryId,
        organization_id: organizationId,
        property_id: livePropertyId,
        code: `ACTIVE_${suffix.toUpperCase()}`,
        name: "Premium Cottage",
        accommodation_type: "COTTAGE",
        description: "Active public room category",
        base_occupancy: 2,
        max_adults: 3,
        max_children: 2,
        max_occupancy: 4,
        size_sqm: "35.00",
        bed_configuration: "1 King Bed",
        extra_bed_allowed: true,
        default_view_label: "Garden View",
        sort_order: 1,
        status: "ACTIVE"
      },
      {
        id: retiredRoomCategoryId,
        organization_id: organizationId,
        property_id: livePropertyId,
        code: `RETIRED_${suffix.toUpperCase()}`,
        name: "Retired Room",
        accommodation_type: "ROOM",
        description: "Must not be public",
        base_occupancy: 2,
        max_adults: 2,
        max_children: 1,
        max_occupancy: 3,
        size_sqm: "20.00",
        bed_configuration: "1 Queen Bed",
        extra_bed_allowed: false,
        default_view_label: null,
        sort_order: 2,
        status: "RETIRED"
      }
    ])
    .execute();

  await db
    .insertInto("amenity_catalog")
    .values({
      code: amenityCode,
      name: "Catalog Test Wi-Fi",
      category: "CONNECTIVITY",
      active: true,
      sort_order: 999
    })
    .execute();

  await db
    .insertInto("property_amenities")
    .values({
      organization_id: organizationId,
      property_id: livePropertyId,
      amenity_code: amenityCode,
      details: "Included"
    })
    .execute();

  await db
    .insertInto("property_policies")
    .values({
      property_id: livePropertyId,
      organization_id: organizationId,
      children_policy: "ALLOWED",
      pets_policy: "ON_REQUEST",
      smoking_policy: "NON_SMOKING",
      parties_events_policy: "ON_REQUEST",
      minimum_checkin_age: 18,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      house_rules: "Respect quiet hours."
    })
    .execute();

  await db
    .insertInto("property_media")
    .values([
      {
        id: activeMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        media_type: "IMAGE",
        storage_provider: "OTHER",
        storage_key: privateStorageKey,
        mime_type: "image/jpeg",
        alt_text: "Public cover description",
        caption: "Cover image",
        is_cover: true,
        sort_order: 1,
        status: "ACTIVE",
        created_by_user_id: null
      },
      {
        id: archivedMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        media_type: "IMAGE",
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/archived.jpg`,
        mime_type: "image/jpeg",
        alt_text: "Archived image",
        caption: "Must not be public",
        is_cover: false,
        sort_order: 2,
        status: "ARCHIVED",
        created_by_user_id: null
      }
    ])
    .execute();

  return {
    organizationId,
    draftPropertyId,
    publicSlug,
    draftSlug,
    city,
    otherCity,
    activeRoomCategoryId,
    retiredRoomCategoryId,
    amenityCode,
    activeMediaId,
    archivedMediaId,
    privateEmail,
    privatePhone,
    privateAddress,
    privateStorageKey
  };
}

async function scopedMutationCounts(propertyId: string) {
  const [inventory, audit, outbox, property] = await Promise.all([
    db
      .selectFrom("inventory_daily_buckets")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("audit_events")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("property_id", "=", propertyId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("outbox_events")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("aggregate_id", "=", propertyId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("properties")
      .select(["version", "updated_at"])
      .where("id", "=", propertyId)
      .executeTakeFirstOrThrow()
  ]);

  return {
    inventory: Number(inventory.count),
    audit: Number(audit.count),
    outbox: Number(outbox.count),
    version: property.version,
    updatedAt: property.updated_at.toISOString()
  };
}

beforeAll(async () => {
  fixture = await createFixture();
  app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerPublicCatalogRoutes(app, { db });
});

afterAll(async () => {
  await app.close();
  await db.destroy();
});

describe("Phase 6A public property catalog", () => {
  it("lists only live destinations without requiring authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/public/destinations"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      destinations: Array<{
        city: string;
        stateRegion: string | null;
        countryCode: string;
        propertyCount: number;
      }>;
    };

    expect(body.destinations).toContainEqual({
      city: fixture.city,
      stateRegion: "Himachal Pradesh",
      countryCode: "IN",
      propertyCount: 1
    });
    expect(body.destinations).toContainEqual({
      city: fixture.otherCity,
      stateRegion: "Himachal Pradesh",
      countryCode: "IN",
      propertyCount: 1
    });
  });

  it("filters public property discovery and never returns draft or sensitive profile fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/public/properties?destination=${encodeURIComponent(fixture.city)}&limit=20`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      properties: Array<Record<string, unknown>>;
    };

    expect(body.properties).toHaveLength(1);
    expect(body.properties[0]).toMatchObject({
      publicSlug: fixture.publicSlug,
      city: fixture.city,
      stateRegion: "Himachal Pradesh",
      countryCode: "IN",
      coverMediaId: fixture.activeMediaId
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.draftPropertyId);
    expect(serialized).not.toContain(fixture.privateEmail);
    expect(serialized).not.toContain(fixture.privatePhone);
    expect(serialized).not.toContain(fixture.privateAddress);
    expect(serialized).not.toContain(fixture.privateStorageKey);
  });

  it("returns a sanitized live property detail with active categories, amenities, policies and media metadata", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/public/properties/${fixture.publicSlug}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      property: {
        publicSlug: string;
        roomCategories: Array<{ roomCategoryId: string; name: string }>;
        amenities: Array<{ code: string; name: string }>;
        policies: Record<string, unknown> | null;
        media: Array<{ id: string; mediaType: string; isCover: boolean }>;
      };
    };

    expect(body.property.publicSlug).toBe(fixture.publicSlug);
    expect(body.property.roomCategories).toContainEqual(
      expect.objectContaining({
        roomCategoryId: fixture.activeRoomCategoryId,
        name: "Premium Cottage"
      })
    );
    expect(body.property.roomCategories).not.toContainEqual(
      expect.objectContaining({ roomCategoryId: fixture.retiredRoomCategoryId })
    );
    expect(body.property.amenities).toContainEqual(
      expect.objectContaining({ code: fixture.amenityCode })
    );
    expect(body.property.policies).toMatchObject({
      childrenPolicy: "ALLOWED",
      petsPolicy: "ON_REQUEST",
      smokingPolicy: "NON_SMOKING"
    });
    expect(body.property.media).toContainEqual({
      id: fixture.activeMediaId,
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      altText: "Public cover description",
      caption: "Cover image",
      isCover: true,
      sortOrder: 1
    });
    expect(body.property.media).not.toContainEqual(
      expect.objectContaining({ id: fixture.archivedMediaId })
    );

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.organizationId);
    expect(serialized).not.toContain(fixture.privateEmail);
    expect(serialized).not.toContain(fixture.privatePhone);
    expect(serialized).not.toContain(fixture.privateAddress);
    expect(serialized).not.toContain(fixture.privateStorageKey);
  });

  it("returns 404 for an unknown or non-live public slug", async () => {
    const missing = await app.inject({
      method: "GET",
      url: `/v1/public/properties/not-live-${randomUUID().replaceAll("-", "")}`
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        message: "Public property not found"
      }
    });

    const draft = await app.inject({
      method: "GET",
      url: `/v1/public/properties/${fixture.draftSlug}`
    });

    expect(draft.statusCode).toBe(404);
  });

  it("keeps anonymous catalog reads strictly side-effect free", async () => {
    const live = await db
      .selectFrom("properties")
      .select("id")
      .where("public_slug", "=", fixture.publicSlug)
      .executeTakeFirstOrThrow();
    const before = await scopedMutationCounts(live.id);

    const destinations = await app.inject({
      method: "GET",
      url: "/v1/public/destinations"
    });
    const listing = await app.inject({
      method: "GET",
      url: `/v1/public/properties?destination=${encodeURIComponent(fixture.city)}`
    });
    const detail = await app.inject({
      method: "GET",
      url: `/v1/public/properties/${fixture.publicSlug}`
    });

    expect(destinations.statusCode).toBe(200);
    expect(listing.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);

    const after = await scopedMutationCounts(live.id);
    expect(after).toEqual(before);
  });
});
