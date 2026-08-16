export const PropertyTypes = {
  HOTEL: "HOTEL",
  RESORT: "RESORT",
  VILLA: "VILLA",
  HOMESTAY: "HOMESTAY",
  COTTAGE_CLUSTER: "COTTAGE_CLUSTER",
  APARTMENT: "APARTMENT",
  HOSTEL: "HOSTEL",
  OTHER: "OTHER"
} as const;

export type PropertyType = (typeof PropertyTypes)[keyof typeof PropertyTypes];

export const SaleModes = {
  ROOMS_ONLY: "ROOMS_ONLY",
  FULL_PROPERTY_ONLY: "FULL_PROPERTY_ONLY",
  BOTH: "BOTH"
} as const;

export type SaleMode = (typeof SaleModes)[keyof typeof SaleModes];

export interface CreatePropertyDraftInput {
  organizationId: string;
  name: string;
  timezone: string;
}

export interface SavePropertyProfileInput {
  organizationId: string;
  propertyId: string;
  expectedVersion: number;
  name: string;
  timezone: string;
  propertyType: PropertyType | null;
  saleMode: SaleMode | null;
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
}
