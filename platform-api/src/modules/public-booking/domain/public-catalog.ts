export interface PublicDestinationView {
  city: string;
  stateRegion: string | null;
  countryCode: string;
  propertyCount: number;
}

export interface PublicPropertySummaryView {
  publicSlug: string;
  name: string;
  propertyType: string | null;
  saleMode: string | null;
  shortDescription: string | null;
  locality: string | null;
  city: string | null;
  stateRegion: string | null;
  countryCode: string;
  coverMediaId: string | null;
}

export interface PublicRoomCategoryView {
  roomCategoryId: string;
  coverMediaId: string | null;
  code: string;
  name: string;
  accommodationType: string;
  description: string | null;
  baseOccupancy: number;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  sizeSqm: number | null;
  bedConfiguration: string | null;
  extraBedAllowed: boolean;
  defaultViewLabel: string | null;
}

export interface PublicAmenityView {
  code: string;
  name: string;
  category: string;
  details: string | null;
}

export interface PublicPoliciesView {
  childrenPolicy: string;
  petsPolicy: string;
  smokingPolicy: string;
  partiesEventsPolicy: string;
  minimumCheckinAge: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  houseRules: string | null;
}

export interface PublicMediaView {
  id: string;
  mediaType: "IMAGE";
  mimeType: string | null;
  altText: string | null;
  caption: string | null;
  isCover: boolean;
  sortOrder: number;
}

export interface PublicPropertyDetailView extends PublicPropertySummaryView {
  description: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  roomCategories: PublicRoomCategoryView[];
  amenities: PublicAmenityView[];
  policies: PublicPoliciesView | null;
  media: PublicMediaView[];
}
