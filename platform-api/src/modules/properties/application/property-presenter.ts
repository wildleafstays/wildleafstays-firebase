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
  propertyType: string | null;
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
    propertyType: row.property_type,
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}
