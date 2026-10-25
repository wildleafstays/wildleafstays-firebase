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
  propertyCategoryId: string;
  propertyTypeId: string;
}

export interface SavePropertyProfileInput {
  organizationId: string;
  propertyId: string;
  expectedVersion: number;
  name: string;
  timezone: string;
  propertyCategoryId: string;
  propertyTypeId: string;
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
  servicesDescription?: string | null;
  spacesDescription?: string | null;
  publicAddress?: string | null;
  locationDescription?: string | null;
  mapUrl?: string | null;
  nearbyAttractions?: string | null;
}
