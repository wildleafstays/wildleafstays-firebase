import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import type {
  PublicAmenityView,
  PublicDestinationView,
  PublicMediaView,
  PublicPoliciesView,
  PublicPropertyDetailView,
  PublicPropertySummaryView,
  PublicRoomCategoryMediaView,
  PublicRoomCategoryView
} from "../domain/public-catalog.js";
import {
  PublicCatalogRepository,
  type PublicPropertyRecord
} from "../infrastructure/public-catalog-repository.js";

function propertySummary(record: PublicPropertyRecord): PublicPropertySummaryView {
  return {
    publicSlug: record.public_slug as string,
    name: record.name,
    propertyCategoryId: record.property_category_id,
    propertyCategoryName: record.property_category_name,
    propertyTypeId: record.property_type_id,
    propertyTypeName: record.property_type_name,
    saleMode: record.sale_mode,
    shortDescription: record.short_description,
    locality: record.locality,
    city: record.city,
    stateRegion: record.state_region,
    countryCode: record.country_code,
    coverMediaId: record.cover_media_id,
    startingRoomRateMinor: record.starting_room_rate_minor,
    currencyCode: record.currency_code
  };
}

export class PublicCatalogService {
  constructor(private readonly repository = new PublicCatalogRepository()) {}

  async listDestinations(db: Kysely<Database>): Promise<{ destinations: PublicDestinationView[] }> {
    const rows = await this.repository.listDestinations(db);
    return {
      destinations: rows.map((row) => ({
        city: row.city,
        stateRegion: row.state_region,
        countryCode: row.country_code,
        propertyCount: row.property_count
      }))
    };
  }

  async listProperties(
    db: Kysely<Database>,
    input: {
      destination?: string;
      categoryId?: string;
      typeId?: string;
      limit: number;
      offset: number;
    }
  ): Promise<{ properties: PublicPropertySummaryView[] }> {
    const destination = input.destination?.trim() || null;
    const rows = await this.repository.listProperties(
      db,
      destination,
      input.categoryId?.trim() || null,
      input.typeId?.trim() || null,
      input.limit,
      input.offset
    );
    return {
      properties: rows.map(propertySummary)
    };
  }

  async getProperty(
    db: Kysely<Database>,
    publicSlug: string
  ): Promise<{ property: PublicPropertyDetailView }> {
    const record = await this.repository.findPropertyBySlug(db, publicSlug.toLowerCase());
    if (!record) {
      throw new NotFoundError("Public property not found");
    }

    const [
      roomRows,
      roomMediaRows,
      physicalRoomMediaRows,
      amenityRows,
      policyRow,
      mediaRows,
      cancellationRow,
      reviewRows
    ] = await Promise.all([
      this.repository.listRoomCategories(db, record.organization_id, record.id),
      this.repository.listRoomCategoryMedia(db, record.organization_id, record.id),
      this.repository.listPhysicalUnitMedia(db, record.organization_id, record.id),
      this.repository.listAmenities(db, record.organization_id, record.id),
      this.repository.getPolicies(db, record.organization_id, record.id),
      this.repository.listMedia(db, record.organization_id, record.id),
      this.repository.getCancellation(db, record.organization_id, record.id),
      this.repository.listGuestReviews(db, record.organization_id, record.id)
    ]);

    const categoryMedia = new Map<string, PublicRoomCategoryMediaView[]>();
    for (const media of roomMediaRows) {
      const items = categoryMedia.get(media.room_category_id) ?? [];
      items.push({
        id: media.id,
        mediaType: "IMAGE",
        mimeType: media.mime_type,
        altText: media.alt_text,
        caption: media.caption,
        sortOrder: media.sort_order
      });
      categoryMedia.set(media.room_category_id, items);
    }

    const physicalCategoryMedia = new Map<string, PublicRoomCategoryMediaView[]>();
    for (const media of physicalRoomMediaRows) {
      const items = physicalCategoryMedia.get(media.room_category_id) ?? [];
      items.push({
        id: media.id,
        mediaType: "IMAGE",
        mimeType: media.mime_type,
        altText: media.alt_text,
        caption: media.caption,
        sortOrder: media.sort_order
      });
      physicalCategoryMedia.set(media.room_category_id, items);
    }

    const roomCategories: PublicRoomCategoryView[] = roomRows.map((row) => {
      const explicitCategoryMedia = categoryMedia.get(row.id) ?? [];
      const media =
        explicitCategoryMedia.length > 0
          ? explicitCategoryMedia
          : (physicalCategoryMedia.get(row.id) ?? []);
      return {
        roomCategoryId: row.id,
        coverMediaId: media[0]?.id ?? null,
        media,
        code: row.code,
        name: row.name,
        accommodationType: row.accommodation_type,
        description: row.description,
        baseOccupancy: row.base_occupancy,
        maxAdults: row.max_adults,
        maxChildren: row.max_children,
        maxOccupancy: row.max_occupancy,
        sizeSqm: row.size_sqm === null ? null : Number(row.size_sqm),
        bedConfiguration: row.bed_configuration,
        extraBedAllowed: row.extra_bed_allowed,
        defaultViewLabel: row.default_view_label,
        unitCount: row.unit_count
      };
    });

    const amenities: PublicAmenityView[] = amenityRows.map((row) => ({
      code: row.code,
      name: row.name,
      category: row.category,
      details: row.details
    }));

    const policies: PublicPoliciesView | null = policyRow
      ? {
          childrenPolicy: policyRow.children_policy,
          petsPolicy: policyRow.pets_policy,
          smokingPolicy: policyRow.smoking_policy,
          partiesEventsPolicy: policyRow.parties_events_policy,
          minimumCheckinAge: policyRow.minimum_checkin_age,
          quietHoursStart: policyRow.quiet_hours_start,
          quietHoursEnd: policyRow.quiet_hours_end,
          houseRules: policyRow.house_rules
        }
      : null;

    const media: PublicMediaView[] = mediaRows.map((row) => ({
      id: row.id,
      mediaType: "IMAGE",
      mimeType: row.mime_type,
      altText: row.alt_text,
      caption: row.caption,
      isCover: row.is_cover,
      sortOrder: row.sort_order
    }));

    return {
      property: {
        ...propertySummary(record),
        description: record.description,
        checkInTime: record.check_in_time,
        checkOutTime: record.check_out_time,
        servicesDescription: record.services_description,
        spacesDescription: record.spaces_description,
        publicAddress: record.public_address,
        locationDescription: record.location_description,
        mapUrl: record.map_url,
        nearbyAttractions: record.nearby_attractions,
        guestContent: record.guest_content,
        roomCategories,
        amenities,
        policies,
        media,
        cancellation: cancellationRow
          ? {
              name: cancellationRow.name,
              policyText: cancellationRow.policy_text
            }
          : null,
        reviews: reviewRows.map((review) => ({
          id: review.id,
          rating: review.rating,
          title: review.title,
          reviewText: review.review_text,
          reviewerDisplayName: review.reviewer_display_name,
          publishedAt: review.published_at.toISOString()
        }))
      }
    };
  }
}
