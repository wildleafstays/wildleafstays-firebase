import type { JsonObject } from "../../../infrastructure/database/types.js";
import type { PropertyRecord } from "../infrastructure/property-repository.js";

export interface PropertyView extends JsonObject {
  id: string;
  organizationId: string;
  publicSlug: string | null;
  name: string;
  status: string;
  timezone: string;
  version: number;
  propertyCategoryId: string | null;
  propertyTypeId: string | null;
  saleMode: string | null;
  shortDescription: string | null;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  city: string | null;
  stateRegion: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  contactEmail: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  servicesDescription: string | null;
  spacesDescription: string | null;
  publicAddress: string | null;
  locationDescription: string | null;
  mapUrl: string | null;
  nearbyAttractions: string | null;
  guestContent: JsonObject | null;
  createdAt: string;
  updatedAt: string;
}

export function presentProperty(row: PropertyRecord): PropertyView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    publicSlug: row.public_slug,
    name: row.name,
    status: row.status,
    timezone: row.timezone,
    version: row.version,
    propertyCategoryId: row.property_category_id,
    propertyTypeId: row.property_type_id,
    saleMode: row.sale_mode,
    shortDescription: row.short_description,
    description: row.description,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    locality: row.locality,
    city: row.city,
    stateRegion: row.state_region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    servicesDescription: row.services_description,
    spacesDescription: row.spaces_description,
    publicAddress: row.public_address,
    locationDescription: row.location_description,
    mapUrl: row.map_url,
    nearbyAttractions: row.nearby_attractions,
    guestContent: row.guest_content,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
