import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type {
  AddDocumentInput,
  AddMediaInput,
  AmenitySelection,
  DocumentVerificationDecision,
  OnboardingChecklist,
  ReviewDecision,
  SavePoliciesInput
} from "../domain/property-onboarding.js";
import {
  PropertyOnboardingRepository,
  type DocumentRecord,
  type MediaRecord,
  type PolicyRecord,
  type PropertyRecord,
  type ReviewRoundRecord
} from "../infrastructure/property-onboarding-repository.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

function propertyState(property: PropertyRecord): JsonObject {
  return {
    id: property.id,
    organizationId: property.organization_id,
    status: property.status,
    version: property.version,
    submissionSequence: property.submission_sequence,
    publicSlug: property.public_slug,
    submittedAt: property.submitted_at?.toISOString() ?? null,
    approvedAt: property.approved_at?.toISOString() ?? null,
    liveAt: property.live_at?.toISOString() ?? null
  };
}

function policyView(policy: PolicyRecord): JsonObject {
  return {
    childrenPolicy: policy.children_policy,
    petsPolicy: policy.pets_policy,
    smokingPolicy: policy.smoking_policy,
    partiesEventsPolicy: policy.parties_events_policy,
    minimumCheckinAge: policy.minimum_checkin_age,
    quietHoursStart: policy.quiet_hours_start,
    quietHoursEnd: policy.quiet_hours_end,
    houseRules: policy.house_rules,
    version: policy.version
  };
}

function mediaView(media: MediaRecord): JsonObject {
  return {
    id: media.id,
    mediaType: media.media_type,
    storageProvider: media.storage_provider,
    storageKey: media.storage_key,
    mimeType: media.mime_type,
    altText: media.alt_text,
    caption: media.caption,
    isCover: media.is_cover,
    sortOrder: media.sort_order,
    status: media.status
  };
}

function documentView(document: DocumentRecord): JsonObject {
  return {
    id: document.id,
    documentType: document.document_type,
    storageProvider: document.storage_provider,
    storageKey: document.storage_key,
    originalFilename: document.original_filename,
    issuedOn: document.issued_on,
    expiresOn: document.expires_on,
    verificationStatus: document.verification_status,
    verificationReason: document.verification_reason,
    status: document.status
  };
}

function reviewRoundView(review: ReviewRoundRecord): JsonObject {
  return {
    id: review.id,
    submissionNumber: review.submission_number,
    status: review.status,
    submittedAt: review.submitted_at.toISOString(),
    reviewStartedAt: review.review_started_at?.toISOString() ?? null,
    decision: review.decision,
    decisionReason: review.decision_reason,
    decidedAt: review.decided_at?.toISOString() ?? null
  };
}

function makePublicSlug(property: PropertyRecord): string {
  const base = property.name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const safeBase = base || "property";
  return `${safeBase}-${property.id.replaceAll("-", "").slice(0, 12)}`;
}

export class PropertyOnboardingService {
  constructor(
    private readonly repository = new PropertyOnboardingRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  private async requireScopedProperty(
    db: DbExecutor,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.PROPERTY_READ | typeof Permissions.PROPERTY_MANAGE
  ): Promise<PropertyRecord> {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });
    const property = await this.repository.findProperty(db, organizationId, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }
    return property;
  }

  private assertOwnerEditable(property: PropertyRecord): void {
    if (property.status !== "DRAFT" && property.status !== "CHANGES_REQUIRED") {
      throw new ConflictError("Property onboarding content cannot be edited in its current state", {
        propertyId: property.id,
        status: property.status
      });
    }
  }

  private async requirePlatformProperty(
    db: DbExecutor,
    actor: ActorContext,
    propertyId: string
  ): Promise<PropertyRecord> {
    const property = await this.repository.findPropertyById(db, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }
    this.authorization.assert(actor, Permissions.PROPERTY_APPROVE, {
      kind: "property",
      organizationId: property.organization_id,
      propertyId: property.id
    });
    return property;
  }

  async buildChecklist(db: DbExecutor, property: PropertyRecord): Promise<OnboardingChecklist> {
    const [policies, counts] = await Promise.all([
      this.repository.getPolicies(db, property.organization_id, property.id),
      this.repository.onboardingCounts(db, property.organization_id, property.id)
    ]);

    const profileComplete = Boolean(
      property.name.trim() &&
      property.property_type &&
      property.sale_mode &&
      property.city &&
      property.state_region &&
      property.country_code &&
      property.check_in_time &&
      property.check_out_time
    );

    const accommodationComplete =
      property.sale_mode === "FULL_PROPERTY_ONLY" ||
      (counts.roomCategories > 0 && counts.physicalUnits > 0);

    const policiesComplete = Boolean(policies);
    const amenitiesComplete = counts.amenities > 0;
    const mediaComplete = counts.activeImages > 0 && counts.coverImages === 1;
    const rightToOperateDocumentPresent = counts.rightToOperateDocuments > 0;

    const missing: string[] = [];
    if (!profileComplete) {
      missing.push("Complete the core property profile and check-in/check-out details");
    }
    if (!accommodationComplete) {
      missing.push("Add at least one accommodation category and physical unit");
    }
    if (!policiesComplete) {
      missing.push("Save property policies and house rules");
    }
    if (!amenitiesComplete) {
      missing.push("Select at least one property amenity");
    }
    if (!mediaComplete) {
      missing.push("Add property images and select exactly one cover image");
    }
    if (!rightToOperateDocumentPresent) {
      missing.push("Add an ownership proof or lease agreement");
    }

    return {
      profileComplete,
      accommodationComplete,
      policiesComplete,
      amenitiesComplete,
      mediaComplete,
      rightToOperateDocumentPresent,
      readyToSubmit: missing.length === 0,
      missing
    };
  }

  async getOnboarding(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      db,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_READ
    );

    const [checklist, policies, amenities, media, documents, reviewRounds] = await Promise.all([
      this.buildChecklist(db, property),
      this.repository.getPolicies(db, organizationId, propertyId),
      this.repository.listAmenities(db, organizationId, propertyId),
      this.repository.listMedia(db, organizationId, propertyId),
      this.repository.listDocuments(db, organizationId, propertyId),
      this.repository.listReviewRounds(db, organizationId, propertyId)
    ]);

    return {
      property: propertyState(property),
      checklist,
      policies: policies ? policyView(policies) : null,
      amenities,
      media: media.map(mediaView),
      documents: documents.map(documentView),
      reviewHistory: reviewRounds.map(reviewRoundView)
    };
  }

  async savePolicies(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: SavePoliciesInput,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const before = await this.repository.getPolicies(trx, input.organizationId, input.propertyId);
    const after = await this.repository.upsertPolicies(trx, input);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.policies.saved",
      entityType: "property_policies",
      entityId: input.propertyId,
      before: before ? policyView(before) : null,
      after: policyView(after),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.policies.saved.v1",
      payload: { propertyId: input.propertyId, version: after.version }
    });

    return { policies: policyView(after) };
  }

  async replaceAmenities(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    amenities: AmenitySelection[],
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const normalized = amenities.map((amenity) => ({
      code: amenity.code.trim().toUpperCase(),
      details: amenity.details?.trim() || null
    }));
    const uniqueCodes = new Set(normalized.map((amenity) => amenity.code));
    if (uniqueCodes.size !== normalized.length) {
      throw new ValidationError("Amenity codes must be unique");
    }

    const activeCodes = await this.repository.activeAmenityCodes(trx, Array.from(uniqueCodes));
    const invalid = Array.from(uniqueCodes).filter((code) => !activeCodes.includes(code));
    if (invalid.length > 0) {
      throw new ValidationError("One or more amenity codes are invalid", { invalid });
    }

    const before = await this.repository.listAmenities(trx, organizationId, propertyId);
    await this.repository.replaceAmenities(trx, organizationId, propertyId, normalized);
    const after = await this.repository.listAmenities(trx, organizationId, propertyId);

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.amenities.replaced",
      entityType: "property_amenities",
      entityId: propertyId,
      before: { amenities: before },
      after: { amenities: after },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.amenities.replaced.v1",
      payload: { propertyId, amenityCodes: normalized.map((item) => item.code) }
    });

    return { amenities: after };
  }

  async addMedia(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: AddMediaInput,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    if (input.isCover && input.mediaType !== "IMAGE") {
      throw new ValidationError("Only an image can be used as the cover");
    }

    const media = await this.repository.addMedia(trx, actor.userId, input);
    const view = mediaView(media);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.media.added",
      entityType: "property_media",
      entityId: media.id,
      before: null,
      after: view,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.media.added.v1",
      payload: {
        propertyId: input.propertyId,
        mediaId: media.id,
        mediaType: media.media_type,
        isCover: media.is_cover
      }
    });

    return { media: view };
  }

  async setMediaCover(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    mediaId: string,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const before = await this.repository.findMedia(trx, organizationId, propertyId, mediaId);
    if (!before) {
      throw new NotFoundError("Property media not found");
    }
    if (before.media_type !== "IMAGE") {
      throw new ValidationError("Only an image can be used as the cover");
    }

    const after = await this.repository.setMediaCover(trx, organizationId, propertyId, mediaId);
    if (!after) {
      throw new NotFoundError("Property media not found");
    }

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.media.cover_selected",
      entityType: "property_media",
      entityId: mediaId,
      before: mediaView(before),
      after: mediaView(after),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.media.cover_selected.v1",
      payload: { propertyId, mediaId }
    });

    return { media: mediaView(after) };
  }

  async archiveMedia(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    mediaId: string,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const before = await this.repository.findMedia(trx, organizationId, propertyId, mediaId);
    if (!before) {
      throw new NotFoundError("Property media not found");
    }

    const archived = await this.repository.archiveMedia(trx, organizationId, propertyId, mediaId);
    if (!archived) {
      throw new NotFoundError("Property media not found");
    }

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.media.archived",
      entityType: "property_media",
      entityId: mediaId,
      before: mediaView(before),
      after: mediaView(archived),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.media.archived.v1",
      payload: { propertyId, mediaId }
    });

    return { mediaId, status: "ARCHIVED" };
  }

  async addDocument(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: AddDocumentInput,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const document = await this.repository.addDocument(trx, actor.userId, input);
    const view = documentView(document);

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: "property.document.added",
      entityType: "property_document",
      entityId: document.id,
      before: null,
      after: {
        id: document.id,
        documentType: document.document_type,
        originalFilename: document.original_filename,
        verificationStatus: document.verification_status
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: input.propertyId,
      eventType: "property.document.added.v1",
      payload: {
        propertyId: input.propertyId,
        documentId: document.id,
        documentType: document.document_type
      }
    });

    return { document: view };
  }

  async archiveDocument(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    documentId: string,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    const beforeDocuments = await this.repository.listDocuments(trx, organizationId, propertyId);
    const before = beforeDocuments.find((document) => document.id === documentId);
    if (!before) {
      throw new NotFoundError("Property document not found");
    }

    const archived = await this.repository.archiveDocument(
      trx,
      organizationId,
      propertyId,
      documentId
    );
    if (!archived) {
      throw new NotFoundError("Property document not found");
    }

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.document.archived",
      entityType: "property_document",
      entityId: documentId,
      before: {
        documentType: before.document_type,
        originalFilename: before.original_filename,
        verificationStatus: before.verification_status,
        status: before.status
      },
      after: {
        documentType: archived.document_type,
        originalFilename: archived.original_filename,
        verificationStatus: archived.verification_status,
        status: archived.status
      },
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.document.archived.v1",
      payload: { propertyId, documentId }
    });

    return { documentId, status: "ARCHIVED" };
  }

  async submit(
    trx: Transaction<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    expectedVersion: number,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requireScopedProperty(
      trx,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_MANAGE
    );
    this.assertOwnerEditable(property);

    if (property.version !== expectedVersion) {
      throw new ConflictError("Property was changed by another request", {
        expectedVersion,
        currentVersion: property.version
      });
    }

    const checklist = await this.buildChecklist(trx, property);
    if (!checklist.readyToSubmit) {
      throw new ValidationError("Property onboarding is incomplete", {
        missing: checklist.missing
      });
    }

    const submitted = await this.repository.submitProperty(
      trx,
      property,
      expectedVersion,
      actor.userId
    );
    if (!submitted) {
      throw new ConflictError("Property changed while submission was being processed");
    }

    await new AuditService(trx).record({
      actor,
      organizationId,
      propertyId,
      action: "property.submitted",
      entityType: "property",
      entityId: propertyId,
      before: propertyState(property),
      after: propertyState(submitted.property),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.submitted.v1",
      payload: {
        propertyId,
        organizationId,
        submissionNumber: submitted.review.submission_number,
        version: submitted.property.version
      }
    });

    return {
      property: propertyState(submitted.property),
      submissionNumber: submitted.review.submission_number
    };
  }

  async verifyDocument(
    trx: Transaction<Database>,
    actor: ActorContext,
    propertyId: string,
    documentId: string,
    decision: DocumentVerificationDecision,
    reason: string | null,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requirePlatformProperty(trx, actor, propertyId);
    if (property.status !== "SUBMITTED" && property.status !== "UNDER_REVIEW") {
      throw new ConflictError("Documents can be reviewed only after property submission", {
        status: property.status
      });
    }
    if (decision === "REJECTED" && !reason?.trim()) {
      throw new ValidationError("A reason is required when rejecting a document");
    }

    const document = await this.repository.verifyDocument(
      trx,
      propertyId,
      documentId,
      actor.userId,
      decision,
      reason?.trim() || null
    );
    if (!document) {
      throw new NotFoundError("Property document not found");
    }

    await new AuditService(trx).record({
      actor,
      organizationId: property.organization_id,
      propertyId,
      action: "property.document.reviewed",
      entityType: "property_document",
      entityId: document.id,
      after: {
        documentType: document.document_type,
        verificationStatus: document.verification_status,
        verificationReason: document.verification_reason
      },
      reason: document.verification_reason,
      request
    });

    return { document: documentView(document) };
  }

  async startReview(
    trx: Transaction<Database>,
    actor: ActorContext,
    propertyId: string,
    expectedVersion: number,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requirePlatformProperty(trx, actor, propertyId);
    if (property.status !== "SUBMITTED") {
      throw new ConflictError("Only a submitted property can enter review", {
        status: property.status
      });
    }
    if (property.version !== expectedVersion) {
      throw new ConflictError("Property was changed by another request", {
        expectedVersion,
        currentVersion: property.version
      });
    }

    const updated = await this.repository.startReview(trx, property, expectedVersion, actor.userId);
    if (!updated) {
      throw new ConflictError("Property changed while review was being started");
    }

    await new AuditService(trx).record({
      actor,
      organizationId: property.organization_id,
      propertyId,
      action: "property.review.started",
      entityType: "property",
      entityId: propertyId,
      before: propertyState(property),
      after: propertyState(updated),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.review.started.v1",
      payload: { propertyId, version: updated.version }
    });

    return { property: propertyState(updated) };
  }

  async decideReview(
    trx: Transaction<Database>,
    actor: ActorContext,
    propertyId: string,
    expectedVersion: number,
    decision: ReviewDecision,
    reason: string | null,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requirePlatformProperty(trx, actor, propertyId);
    if (property.status !== "UNDER_REVIEW") {
      throw new ConflictError("Only a property under review can receive a decision", {
        status: property.status
      });
    }
    if (property.version !== expectedVersion) {
      throw new ConflictError("Property was changed by another request", {
        expectedVersion,
        currentVersion: property.version
      });
    }
    if (decision === "CHANGES_REQUIRED" && !reason?.trim()) {
      throw new ValidationError("A reason is required when changes are requested");
    }

    if (decision === "APPROVED") {
      const documents = await this.repository.listDocuments(
        trx,
        property.organization_id,
        property.id
      );
      const verifiedRightToOperate = documents.some(
        (document) =>
          (document.document_type === "OWNERSHIP_PROOF" ||
            document.document_type === "LEASE_AGREEMENT") &&
          document.verification_status === "VERIFIED"
      );
      if (!verifiedRightToOperate) {
        throw new ConflictError(
          "Ownership proof or lease agreement must be verified before approval"
        );
      }
    }

    const updated = await this.repository.completeReview(
      trx,
      property,
      expectedVersion,
      actor.userId,
      decision,
      reason?.trim() || null
    );
    if (!updated) {
      throw new ConflictError("Property changed while the review decision was being saved");
    }

    await new AuditService(trx).record({
      actor,
      organizationId: property.organization_id,
      propertyId,
      action:
        decision === "APPROVED" ? "property.review.approved" : "property.review.changes_required",
      entityType: "property",
      entityId: propertyId,
      before: propertyState(property),
      after: propertyState(updated),
      reason: reason?.trim() || null,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: decision === "APPROVED" ? "property.approved.v1" : "property.changes_required.v1",
      payload: {
        propertyId,
        organizationId: property.organization_id,
        version: updated.version,
        reason: reason?.trim() || null
      }
    });

    return { property: propertyState(updated) };
  }

  async activate(
    trx: Transaction<Database>,
    actor: ActorContext,
    propertyId: string,
    expectedVersion: number,
    request: RequestMetadata
  ): Promise<JsonObject> {
    const property = await this.requirePlatformProperty(trx, actor, propertyId);
    if (property.status !== "APPROVED") {
      throw new ConflictError("Only an approved property can be activated", {
        status: property.status
      });
    }
    if (property.version !== expectedVersion) {
      throw new ConflictError("Property was changed by another request", {
        expectedVersion,
        currentVersion: property.version
      });
    }

    const updated = await this.repository.activateProperty(
      trx,
      property,
      expectedVersion,
      property.public_slug ?? makePublicSlug(property)
    );
    if (!updated) {
      throw new ConflictError("Property changed while activation was being processed");
    }

    await new AuditService(trx).record({
      actor,
      organizationId: property.organization_id,
      propertyId,
      action: "property.activated",
      entityType: "property",
      entityId: propertyId,
      before: propertyState(property),
      after: propertyState(updated),
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "property",
      aggregateId: propertyId,
      eventType: "property.activated.v1",
      payload: {
        propertyId,
        organizationId: property.organization_id,
        publicSlug: updated.public_slug,
        version: updated.version
      }
    });

    return { property: propertyState(updated) };
  }
}
