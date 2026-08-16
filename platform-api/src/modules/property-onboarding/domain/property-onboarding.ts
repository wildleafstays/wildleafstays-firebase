export type ChildrenPolicy = "ALLOWED" | "NOT_ALLOWED" | "RESTRICTIONS_APPLY";
export type PetsPolicy = "ALLOWED" | "NOT_ALLOWED" | "ON_REQUEST";
export type PropertySmokingPolicy = "NON_SMOKING" | "DESIGNATED_AREAS" | "SMOKING_ALLOWED";
export type PartiesEventsPolicy = "ALLOWED" | "NOT_ALLOWED" | "ON_REQUEST";
export type MediaType = "IMAGE" | "VIDEO";
export type StorageProvider = "FIREBASE" | "GCS" | "OTHER";
export type DocumentType =
  | "OWNERSHIP_PROOF"
  | "LEASE_AGREEMENT"
  | "PROPERTY_LICENSE"
  | "LOCAL_REGISTRATION"
  | "GST_CERTIFICATE"
  | "PAN"
  | "FSSAI"
  | "FIRE_NOC"
  | "ID_PROOF"
  | "OTHER";
export type DocumentVerificationDecision = "VERIFIED" | "REJECTED";
export type ReviewDecision = "CHANGES_REQUIRED" | "APPROVED";

export interface AmenitySelection {
  code: string;
  details: string | null;
}

export interface SavePoliciesInput {
  organizationId: string;
  propertyId: string;
  childrenPolicy: ChildrenPolicy;
  petsPolicy: PetsPolicy;
  smokingPolicy: PropertySmokingPolicy;
  partiesEventsPolicy: PartiesEventsPolicy;
  minimumCheckinAge: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  houseRules: string | null;
}

export interface AddMediaInput {
  organizationId: string;
  propertyId: string;
  mediaType: MediaType;
  storageProvider: StorageProvider;
  storageKey: string;
  mimeType: string | null;
  altText: string | null;
  caption: string | null;
  isCover: boolean;
  sortOrder: number;
}

export interface AddDocumentInput {
  organizationId: string;
  propertyId: string;
  documentType: DocumentType;
  storageProvider: StorageProvider;
  storageKey: string;
  originalFilename: string;
  issuedOn: string | null;
  expiresOn: string | null;
}

export interface OnboardingChecklist {
  profileComplete: boolean;
  accommodationComplete: boolean;
  policiesComplete: boolean;
  amenitiesComplete: boolean;
  mediaComplete: boolean;
  rightToOperateDocumentPresent: boolean;
  readyToSubmit: boolean;
  missing: string[];
}
