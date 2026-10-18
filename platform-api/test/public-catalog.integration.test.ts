import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { PropertyAssetStorage } from "../src/infrastructure/storage/property-asset-storage.js";
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
  fallbackRoomCategoryId: string;
  retiredRoomCategoryId: string;
  amenityCode: string;
  activeMediaId: string;
  archivedMediaId: string;
  activeRoomMediaId: string;
  archivedRoomMediaId: string;
  fallbackPhysicalMediaId: string;
  archivedPhysicalMediaId: string;
  retiredPhysicalMediaId: string;
  ignoredPhysicalMediaId: string;
  privatePhysicalStorageKey: string;
  privateEmail: string;
  privatePhone: string;
  privateAddress: string;
  privateStorageKey: string;
  hotelsCategoryId: string;
  resortTypeId: string;
  villasCategoryId: string;
  homestayTypeId: string;
}

let app: FastifyInstance;
let fixture: Fixture;
const signedReadKeys: string[] = [];

const propertyAssetStorage: PropertyAssetStorage = {
  async store() {
    throw new Error("Public catalog tests do not store files");
  },
  async createReadUrl(objectKey) {
    signedReadKeys.push(objectKey);
    return `https://storage.example.test/${encodeURIComponent(objectKey)}`;
  }
};

async function taxonomyPair(typeCode: string): Promise<{
  propertyCategoryId: string;
  propertyTypeId: string;
}> {
  const row = await db
    .selectFrom("property_types as type")
    .innerJoin("property_categories as category", "category.id", "type.property_category_id")
    .select(["category.id as category_id", "type.id as type_id"])
    .where("type.code", "=", typeCode)
    .executeTakeFirstOrThrow();

  return {
    propertyCategoryId: row.category_id,
    propertyTypeId: row.type_id
  };
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const organizationId = randomUUID();
  const livePropertyId = randomUUID();
  const draftPropertyId = randomUUID();
  const otherLivePropertyId = randomUUID();
  const activeRoomCategoryId = randomUUID();
  const fallbackRoomCategoryId = randomUUID();
  const retiredRoomCategoryId = randomUUID();
  const activePhysicalUnitId = randomUUID();
  const fallbackPhysicalUnitId = randomUUID();
  const retiredPhysicalUnitId = randomUUID();
  const activeMediaId = randomUUID();
  const archivedMediaId = randomUUID();
  const activeRoomMediaId = randomUUID();
  const archivedRoomMediaId = randomUUID();
  const fallbackPhysicalMediaId = randomUUID();
  const archivedPhysicalMediaId = randomUUID();
  const retiredPhysicalMediaId = randomUUID();
  const ignoredPhysicalMediaId = randomUUID();
  const publicSlug = `wildleaf-catalog-${suffix}`;
  const draftSlug = `draft-${suffix}`;
  const city = `Catalog City ${suffix}`;
  const otherCity = `Other City ${suffix}`;
  const amenityCode = `CATALOG_${suffix.toUpperCase()}`;
  const privateEmail = `private-${suffix}@example.invalid`;
  const privatePhone = `+9199${suffix.slice(0, 8)}`;
  const privateAddress = `Private Street ${suffix}`;
  const privateStorageKey = `private/catalog/${suffix}/cover.jpg`;
  const privatePhysicalStorageKey = `private/catalog/${suffix}/physical-fallback.webp`;
  const resortTaxonomy = await taxonomyPair("RESORT");
  const hotelTaxonomy = await taxonomyPair("HOTEL");
  const homestayTaxonomy = await taxonomyPair("HOMESTAY");

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
      property_category_id: resortTaxonomy.propertyCategoryId,
      property_type_id: resortTaxonomy.propertyTypeId,
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
      property_category_id: hotelTaxonomy.propertyCategoryId,
      property_type_id: hotelTaxonomy.propertyTypeId,
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
      property_category_id: homestayTaxonomy.propertyCategoryId,
      property_type_id: homestayTaxonomy.propertyTypeId,
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
        id: fallbackRoomCategoryId,
        organization_id: organizationId,
        property_id: livePropertyId,
        code: `FALLBACK_${suffix.toUpperCase()}`,
        name: "Garden Room",
        accommodation_type: "ROOM",
        description: "Uses active physical room photos as its public fallback",
        base_occupancy: 2,
        max_adults: 2,
        max_children: 1,
        max_occupancy: 3,
        size_sqm: "24.00",
        bed_configuration: "1 King Bed",
        extra_bed_allowed: false,
        default_view_label: "Garden View",
        sort_order: 2,
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
        sort_order: 3,
        status: "RETIRED"
      }
    ])
    .execute();

  await db
    .insertInto("physical_units")
    .values([
      {
        id: activePhysicalUnitId,
        organization_id: organizationId,
        property_id: livePropertyId,
        room_category_id: activeRoomCategoryId,
        unit_code: `EXPLICIT-${suffix}`,
        display_name: "Explicit category room",
        sort_order: 1,
        status: "ACTIVE"
      },
      {
        id: fallbackPhysicalUnitId,
        organization_id: organizationId,
        property_id: livePropertyId,
        room_category_id: fallbackRoomCategoryId,
        unit_code: `FALLBACK-${suffix}`,
        display_name: "Garden Room 101",
        sort_order: 1,
        status: "ACTIVE"
      },
      {
        id: retiredPhysicalUnitId,
        organization_id: organizationId,
        property_id: livePropertyId,
        room_category_id: fallbackRoomCategoryId,
        unit_code: `RETIRED-${suffix}`,
        display_name: "Retired Garden Room",
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

  await db
    .insertInto("room_category_media")
    .values([
      {
        id: activeRoomMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        room_category_id: activeRoomCategoryId,
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/room-active.jpg`,
        mime_type: "image/jpeg",
        alt_text: "Premium Cottage bedroom",
        caption: "Premium Cottage",
        sort_order: 1,
        status: "ACTIVE",
        created_by_user_id: null
      },
      {
        id: archivedRoomMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        room_category_id: activeRoomCategoryId,
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/room-archived.jpg`,
        mime_type: "image/jpeg",
        alt_text: "Archived room image",
        caption: "Must not be public",
        sort_order: 2,
        status: "ARCHIVED",
        created_by_user_id: null
      }
    ])
    .execute();

  await db
    .insertInto("physical_unit_media")
    .values([
      {
        id: ignoredPhysicalMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        physical_unit_id: activePhysicalUnitId,
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/explicit-physical.webp`,
        mime_type: "image/webp",
        alt_text: "Physical photo hidden by explicit category media",
        caption: "Explicit category keeps priority",
        sort_order: 1,
        status: "ACTIVE",
        created_by_user_id: null
      },
      {
        id: fallbackPhysicalMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        physical_unit_id: fallbackPhysicalUnitId,
        storage_provider: "OTHER",
        storage_key: privatePhysicalStorageKey,
        mime_type: "image/webp",
        alt_text: "Garden Room bedroom",
        caption: "Garden Room",
        sort_order: 1,
        status: "ACTIVE",
        created_by_user_id: null
      },
      {
        id: archivedPhysicalMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        physical_unit_id: fallbackPhysicalUnitId,
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/physical-archived.webp`,
        mime_type: "image/webp",
        alt_text: "Archived physical room image",
        caption: "Must not be public",
        sort_order: 2,
        status: "ARCHIVED",
        created_by_user_id: null
      },
      {
        id: retiredPhysicalMediaId,
        organization_id: organizationId,
        property_id: livePropertyId,
        physical_unit_id: retiredPhysicalUnitId,
        storage_provider: "OTHER",
        storage_key: `private/catalog/${suffix}/retired-unit.webp`,
        mime_type: "image/webp",
        alt_text: "Retired physical room image",
        caption: "Must not be public",
        sort_order: 1,
        status: "ACTIVE",
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
    fallbackRoomCategoryId,
    retiredRoomCategoryId,
    amenityCode,
    activeMediaId,
    archivedMediaId,
    activeRoomMediaId,
    archivedRoomMediaId,
    fallbackPhysicalMediaId,
    archivedPhysicalMediaId,
    retiredPhysicalMediaId,
    ignoredPhysicalMediaId,
    privatePhysicalStorageKey,
    privateEmail,
    privatePhone,
    privateAddress,
    privateStorageKey,
    hotelsCategoryId: resortTaxonomy.propertyCategoryId,
    resortTypeId: resortTaxonomy.propertyTypeId,
    villasCategoryId: homestayTaxonomy.propertyCategoryId,
    homestayTypeId: homestayTaxonomy.propertyTypeId
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
  await registerPublicCatalogRoutes(app, { db, propertyAssetStorage });
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
      propertyCategoryId: fixture.hotelsCategoryId,
      propertyCategoryName: "Hotels & Resorts",
      propertyTypeId: fixture.resortTypeId,
      propertyTypeName: "Resort",
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

  it("filters live discovery by database Property Category and Property Type", async () => {
    const byCategory = await app.inject({
      method: "GET",
      url: `/v1/public/properties?categoryId=${fixture.hotelsCategoryId}&limit=20`
    });
    expect(byCategory.statusCode).toBe(200);
    const categoryBody = byCategory.json() as {
      properties: Array<{ publicSlug: string; propertyCategoryId: string | null }>;
    };
    expect(categoryBody.properties).toContainEqual(
      expect.objectContaining({
        publicSlug: fixture.publicSlug,
        propertyCategoryId: fixture.hotelsCategoryId
      })
    );
    expect(categoryBody.properties).not.toContainEqual(
      expect.objectContaining({ propertyCategoryId: fixture.villasCategoryId })
    );

    const byType = await app.inject({
      method: "GET",
      url: `/v1/public/properties?typeId=${fixture.homestayTypeId}&limit=20`
    });
    expect(byType.statusCode).toBe(200);
    const typeBody = byType.json() as {
      properties: Array<{ propertyTypeId: string | null }>;
    };
    expect(typeBody.properties).toHaveLength(1);
    expect(typeBody.properties[0]?.propertyTypeId).toBe(fixture.homestayTypeId);
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
        roomCategories: Array<{
          roomCategoryId: string;
          name: string;
          coverMediaId: string | null;
          media: Array<{
            id: string;
            mediaType: string;
            mimeType: string | null;
            altText: string | null;
            caption: string | null;
            sortOrder: number;
          }>;
        }>;
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
    const activeRoom = body.property.roomCategories.find(
      (category) => category.roomCategoryId === fixture.activeRoomCategoryId
    );
    expect(activeRoom).toMatchObject({
      coverMediaId: fixture.activeRoomMediaId,
      media: [
        {
          id: fixture.activeRoomMediaId,
          mediaType: "IMAGE",
          mimeType: "image/jpeg",
          altText: "Premium Cottage bedroom",
          caption: "Premium Cottage",
          sortOrder: 1
        }
      ]
    });
    expect(activeRoom?.media).not.toContainEqual(
      expect.objectContaining({ id: fixture.archivedRoomMediaId })
    );
    expect(activeRoom?.media).not.toContainEqual(
      expect.objectContaining({ id: fixture.ignoredPhysicalMediaId })
    );

    const fallbackRoom = body.property.roomCategories.find(
      (category) => category.roomCategoryId === fixture.fallbackRoomCategoryId
    );
    expect(fallbackRoom).toMatchObject({
      coverMediaId: fixture.fallbackPhysicalMediaId,
      media: [
        {
          id: fixture.fallbackPhysicalMediaId,
          mediaType: "IMAGE",
          mimeType: "image/webp",
          altText: "Garden Room bedroom",
          caption: "Garden Room",
          sortOrder: 1
        }
      ]
    });
    expect(fallbackRoom?.media).not.toContainEqual(
      expect.objectContaining({ id: fixture.archivedPhysicalMediaId })
    );
    expect(fallbackRoom?.media).not.toContainEqual(
      expect.objectContaining({ id: fixture.retiredPhysicalMediaId })
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
    expect(serialized).not.toContain(fixture.privatePhysicalStorageKey);
  });

  it("opens active physical room fallback media but rejects archived or retired-room media", async () => {
    signedReadKeys.length = 0;

    const active = await app.inject({
      method: "GET",
      url: `/v1/public/properties/${fixture.publicSlug}/media/${fixture.fallbackPhysicalMediaId}`
    });

    expect(active.statusCode).toBe(302);
    expect(active.headers.location).toBe(
      `https://storage.example.test/${encodeURIComponent(fixture.privatePhysicalStorageKey)}`
    );
    expect(signedReadKeys).toEqual([fixture.privatePhysicalStorageKey]);

    for (const mediaId of [fixture.archivedPhysicalMediaId, fixture.retiredPhysicalMediaId]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/public/properties/${fixture.publicSlug}/media/${mediaId}`
      });
      expect(response.statusCode).toBe(404);
    }
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
  it("rejects malformed SmartStay group searches without touching inventory", async () => {
    const invalidRequests = [
      { arrivalDate: "2030-02-10", departureDate: "2030-02-09", adults: 2,
        childAges: [], requestedRooms: 1, exclusive: false },
      { arrivalDate: "2030-02-10", departureDate: "2030-02-11", adults: 0,
        childAges: [], requestedRooms: 1, exclusive: false },
      { arrivalDate: "2030-02-10", departureDate: "2030-02-11", adults: 2,
        childAges: [-1], requestedRooms: 1, exclusive: false },
      { arrivalDate: "2030-02-10", departureDate: "2030-02-11", adults: 2,
        childAges: [], requestedRooms: 21, exclusive: false }
    ];
    for (const payload of invalidRequests) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/public/smartstay/search",
        payload
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("returns a bounded, nonbookable SmartStay discovery page without exposing private data", async () => {
    const live = await db.selectFrom("properties")
      .select("id").where("public_slug", "=", fixture.publicSlug)
      .executeTakeFirstOrThrow();
    const before = await scopedMutationCounts(live.id);
    const response = await app.inject({
      method: "POST",
      url: "/v1/public/smartstay/search",
      payload: {
        arrivalDate: "2030-02-10",
        departureDate: "2030-02-11",
        adults: 2,
        childAges: [],
        requestedRooms: 1,
        exclusive: false,
        destination: fixture.city,
        limit: 10,
        offset: 0
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      properties: Array<Record<string, unknown>>;
      scanned: number;
      nextOffset: number | null;
    };
    expect(body.scanned).toBe(1);
    expect(body.nextOffset).toBeNull();
    expect(body.properties.length).toBeLessThanOrEqual(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(fixture.privateEmail);
    expect(serialized).not.toContain(fixture.privatePhone);
    expect(serialized).not.toContain(fixture.privateStorageKey);
    const after = await scopedMutationCounts(live.id);
    expect(after).toEqual(before);
  });

});
