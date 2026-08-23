import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { PropertyAssetStorage } from "../../../infrastructure/storage/property-asset-storage.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { PropertyOnboardingService } from "../application/property-onboarding-service.js";
import {
  MAX_PROPERTY_DOCUMENT_BYTES,
  MAX_PROPERTY_IMAGE_BYTES,
  PropertyAssetUploadService
} from "../application/property-asset-upload-service.js";
import type {
  ChildrenPolicy,
  DocumentType,
  PartiesEventsPolicy,
  PetsPolicy,
  PlatformReviewQueueStatus,
  PropertySmokingPolicy,
  ReviewDecision
} from "../domain/property-onboarding.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";

export interface PropertyOnboardingRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
  propertyAssetStorage: PropertyAssetStorage;
}

interface PropertyParams {
  organizationId: string;
  propertyId: string;
}

interface PartnerMediaParams extends PropertyParams {
  mediaId: string;
}

interface PartnerDocumentParams extends PropertyParams {
  documentId: string;
}

interface PlatformPropertyParams {
  propertyId: string;
}

interface PlatformDocumentParams extends PlatformPropertyParams {
  documentId: string;
}

interface SavePoliciesBody extends JsonObject {
  childrenPolicy: ChildrenPolicy;
  petsPolicy: PetsPolicy;
  smokingPolicy: PropertySmokingPolicy;
  partiesEventsPolicy: PartiesEventsPolicy;
  minimumCheckinAge?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  houseRules?: string;
}

interface ReplaceAmenitiesBody extends JsonObject {
  amenities: Array<{ code: string; details?: string }>;
}

interface UploadImageQuery {
  altText?: string;
  caption?: string;
  isCover?: boolean;
  sortOrder?: number;
}

interface UploadDocumentQuery {
  documentType: DocumentType;
  issuedOn?: string;
  expiresOn?: string;
}

interface ManagedUploadHeaders {
  "idempotency-key": string;
  "x-content-sha256": string;
}

interface VersionBody extends JsonObject {
  version: number;
}

interface ReviewDecisionBody extends VersionBody {
  decision: ReviewDecision;
  reason?: string;
}

interface DocumentReviewBody extends JsonObject {
  decision: "VERIFIED" | "REJECTED";
  reason?: string;
}

interface PlatformReviewQueueQuery {
  status?: PlatformReviewQueueStatus;
  limit?: number;
  cursor?: string;
}

const propertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const partnerMediaParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "mediaId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    mediaId: { type: "string", format: "uuid" }
  }
} as const;

const partnerDocumentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "documentId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    documentId: { type: "string", format: "uuid" }
  }
} as const;

const platformPropertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["propertyId"],
  properties: {
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const platformDocumentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["propertyId", "documentId"],
  properties: {
    propertyId: { type: "string", format: "uuid" },
    documentId: { type: "string", format: "uuid" }
  }
} as const;

const idempotencyHeaders = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 8,
      maxLength: 200,
      pattern: "^[A-Za-z0-9._:-]+$"
    }
  }
} as const;

const managedUploadHeaders = {
  type: "object",
  required: ["idempotency-key", "x-content-sha256"],
  properties: {
    ...idempotencyHeaders.properties,
    "x-content-sha256": {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    }
  }
} as const;

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const key = headers["idempotency-key"];
  if (typeof key !== "string") {
    throw new ValidationError("Idempotency key is required");
  }
  return key;
}

export async function registerPropertyOnboardingRoutes(
  app: FastifyInstance,
  deps: PropertyOnboardingRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new PropertyOnboardingService();
  const uploads = new PropertyAssetUploadService(deps.propertyAssetStorage, service);

  app.get<{ Querystring: PlatformReviewQueueQuery }>(
    "/v1/platform/property-reviews",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "List the Wildleaf property review queue",
        description:
          "Returns a cursor-paginated, non-guest review queue for authorized Wildleaf platform staff.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              type: "string",
              enum: ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED"]
            },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
            cursor: { type: "string", minLength: 1, maxLength: 500, pattern: "^[A-Za-z0-9_-]+$" }
          }
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["items", "nextCursor"],
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "propertyId",
                    "organizationId",
                    "organizationLegalName",
                    "organizationTradingName",
                    "propertyName",
                    "status",
                    "version",
                    "propertyType",
                    "saleMode",
                    "city",
                    "stateRegion",
                    "countryCode",
                    "submissionSequence",
                    "submittedAt",
                    "approvedAt",
                    "updatedAt"
                  ],
                  properties: {
                    propertyId: { type: "string", format: "uuid" },
                    organizationId: { type: "string", format: "uuid" },
                    organizationLegalName: { type: "string" },
                    organizationTradingName: { anyOf: [{ type: "string" }, { type: "null" }] },
                    propertyName: { type: "string" },
                    status: {
                      type: "string",
                      enum: ["SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED"]
                    },
                    version: { type: "integer", minimum: 1 },
                    propertyType: { anyOf: [{ type: "string" }, { type: "null" }] },
                    saleMode: { anyOf: [{ type: "string" }, { type: "null" }] },
                    city: { anyOf: [{ type: "string" }, { type: "null" }] },
                    stateRegion: { anyOf: [{ type: "string" }, { type: "null" }] },
                    countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
                    submissionSequence: { type: "integer", minimum: 0 },
                    submittedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                    approvedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
                    updatedAt: { type: "string" }
                  }
                }
              },
              nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] }
            }
          }
        }
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();
      void reply.header("cache-control", "no-store");
      return service.listPlatformReviewQueue(deps.db, request.actor, request.query);
    }
  );

  app.get<{ Params: PropertyParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Get onboarding content and submission readiness",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema
      }
    },
    async (request) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }
      return service.getOnboarding(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.propertyId
      );
    }
  );

  app.put<{ Params: PropertyParams; Body: SavePoliciesBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/policies",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Save property policies and house rules",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["childrenPolicy", "petsPolicy", "smokingPolicy", "partiesEventsPolicy"],
          properties: {
            childrenPolicy: {
              type: "string",
              enum: ["ALLOWED", "NOT_ALLOWED", "RESTRICTIONS_APPLY"]
            },
            petsPolicy: {
              type: "string",
              enum: ["ALLOWED", "NOT_ALLOWED", "ON_REQUEST"]
            },
            smokingPolicy: {
              type: "string",
              enum: ["NON_SMOKING", "DESIGNATED_AREAS", "SMOKING_ALLOWED"]
            },
            partiesEventsPolicy: {
              type: "string",
              enum: ["ALLOWED", "NOT_ALLOWED", "ON_REQUEST"]
            },
            minimumCheckinAge: { type: "integer", minimum: 0, maximum: 100 },
            quietHoursStart: {
              type: "string",
              pattern: "^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
            },
            quietHoursEnd: {
              type: "string",
              pattern: "^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$"
            },
            houseRules: { type: "string", maxLength: 5000 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.policies.save:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.savePolicies(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              childrenPolicy: request.body.childrenPolicy,
              petsPolicy: request.body.petsPolicy,
              smokingPolicy: request.body.smokingPolicy,
              partiesEventsPolicy: request.body.partiesEventsPolicy,
              minimumCheckinAge: request.body.minimumCheckinAge ?? null,
              quietHoursStart: request.body.quietHoursStart ?? null,
              quietHoursEnd: request.body.quietHoursEnd ?? null,
              houseRules: request.body.houseRules?.trim() || null
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.put<{ Params: PropertyParams; Body: ReplaceAmenitiesBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/amenities",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Replace the selected property amenities",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amenities"],
          properties: {
            amenities: {
              type: "array",
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code"],
                properties: {
                  code: { type: "string", minLength: 1, maxLength: 80 },
                  details: { type: "string", maxLength: 1000 }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.amenities.replace:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.replaceAmenities(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.body.amenities.map((item) => ({
              code: item.code,
              details: item.details ?? null
            })),
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{
    Params: PropertyParams;
    Querystring: UploadImageQuery;
    Headers: ManagedUploadHeaders;
  }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/uploads/images",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Stream a property image into Wildleaf-managed storage",
        description:
          "The API authorizes the owner, selects an immutable storage key, verifies SHA-256 and streams the image without buffering the complete file in memory.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: managedUploadHeaders,
        consumes: ["multipart/form-data"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            altText: { type: "string", maxLength: 500 },
            caption: { type: "string", maxLength: 1000 },
            isCover: { type: "boolean", default: false },
            sortOrder: { type: "integer", minimum: 0, default: 0 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      await uploads.assertUploadAllowed(
        deps.db,
        actor,
        request.params.organizationId,
        request.params.propertyId
      );
      const part = await request.file();
      if (!part || part.fieldname !== "file") {
        throw new ValidationError("A single multipart file field named 'file' is required");
      }
      const contentSha256 = request.headers["x-content-sha256"];
      const stored = await uploads.storeImage({
        actor,
        organizationId: request.params.organizationId,
        propertyId: request.params.propertyId,
        idempotencyKey: key,
        contentType: part.mimetype,
        contentSha256,
        stream: part.file
      });
      if (part.file.truncated) {
        throw new ValidationError("Uploaded image is too large", {
          maxBytes: MAX_PROPERTY_IMAGE_BYTES
        });
      }
      const fingerprint = {
        contentSha256,
        contentType: part.mimetype,
        altText: request.query.altText ?? null,
        caption: request.query.caption ?? null,
        isCover: request.query.isCover ?? false,
        sortOrder: request.query.sortOrder ?? 0
      };
      const result = await idempotency.execute(
        {
          scopeKey: `property.media.upload:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: fingerprint
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.addMedia(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              mediaType: "IMAGE",
              storageProvider: "GCS",
              storageKey: stored.objectKey,
              mimeType: stored.contentType,
              altText: request.query.altText?.trim() || null,
              caption: request.query.caption?.trim() || null,
              isCover: request.query.isCover ?? false,
              sortOrder: request.query.sortOrder ?? 0
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      void reply.header("cache-control", "no-store");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PartnerMediaParams; Body: JsonObject }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/media/:mediaId/cover",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Select an existing property image as the cover",
        security: [{ bearerAuth: [] }],
        params: partnerMediaParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.media.cover:${request.params.mediaId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.setMediaCover(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.mediaId,
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.delete<{ Params: PartnerMediaParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/media/:mediaId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Archive property media",
        security: [{ bearerAuth: [] }],
        params: partnerMediaParamsSchema,
        headers: idempotencyHeaders
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.media.archive:${request.params.mediaId}:user:${actor.userId}`,
          key,
          requestBody: {}
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.archiveMedia(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.mediaId,
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{
    Params: PropertyParams;
    Querystring: UploadDocumentQuery;
    Headers: ManagedUploadHeaders;
  }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/uploads/documents",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Stream a compliance PDF into private Wildleaf-managed storage",
        description:
          "The API selects a private immutable storage key and registers the document only after the upload digest and size are verified.",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: managedUploadHeaders,
        consumes: ["multipart/form-data"],
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["documentType"],
          properties: {
            documentType: {
              type: "string",
              enum: [
                "OWNERSHIP_PROOF",
                "LEASE_AGREEMENT",
                "PROPERTY_LICENSE",
                "LOCAL_REGISTRATION",
                "GST_CERTIFICATE",
                "PAN",
                "FSSAI",
                "FIRE_NOC",
                "ID_PROOF",
                "OTHER"
              ]
            },
            issuedOn: { type: "string", format: "date" },
            expiresOn: { type: "string", format: "date" }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      await uploads.assertUploadAllowed(
        deps.db,
        actor,
        request.params.organizationId,
        request.params.propertyId
      );
      const part = await request.file();
      if (!part || part.fieldname !== "file") {
        throw new ValidationError("A single multipart file field named 'file' is required");
      }
      const contentSha256 = request.headers["x-content-sha256"];
      const stored = await uploads.storeDocument({
        actor,
        organizationId: request.params.organizationId,
        propertyId: request.params.propertyId,
        idempotencyKey: key,
        contentType: part.mimetype,
        contentSha256,
        stream: part.file,
        documentType: request.query.documentType,
        originalFilename: part.filename
      });
      if (part.file.truncated) {
        throw new ValidationError("Uploaded document is too large", {
          maxBytes: MAX_PROPERTY_DOCUMENT_BYTES
        });
      }
      const fingerprint = {
        contentSha256,
        contentType: part.mimetype,
        originalFilename: stored.originalFilename,
        documentType: request.query.documentType,
        issuedOn: request.query.issuedOn ?? null,
        expiresOn: request.query.expiresOn ?? null
      };
      const result = await idempotency.execute(
        {
          scopeKey: `property.document.upload:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: fingerprint
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.addDocument(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              documentType: request.query.documentType,
              storageProvider: "GCS",
              storageKey: stored.asset.objectKey,
              originalFilename: stored.originalFilename,
              issuedOn: request.query.issuedOn ?? null,
              expiresOn: request.query.expiresOn ?? null
            },
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      void reply.header("cache-control", "no-store");
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.delete<{ Params: PartnerDocumentParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/documents/:documentId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Archive a property compliance document",
        security: [{ bearerAuth: [] }],
        params: partnerDocumentParamsSchema,
        headers: idempotencyHeaders
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.document.archive:${request.params.documentId}:user:${actor.userId}`,
          key,
          requestBody: {}
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.archiveDocument(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.params.documentId,
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PropertyParams; Body: VersionBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/submit",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Submit a completed property to Wildleaf for review",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.submit:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.submit(
            trx,
            actor,
            request.params.organizationId,
            request.params.propertyId,
            request.body.version,
            requestMetadata(request, "partner-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.get<{ Params: PlatformDocumentParams }>(
    "/v1/platform/properties/:propertyId/documents/:documentId/read-url",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "Create a short-lived private document review URL",
        security: [{ bearerAuth: [] }],
        params: platformDocumentParamsSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["url", "expiresAt"],
            properties: {
              url: { type: "string" },
              expiresAt: { type: "string", format: "date-time" }
            }
          }
        }
      }
    },
    async (request, reply) => {
      if (!request.actor) {
        throw new AuthenticationError();
      }
      const result = await uploads.createPlatformDocumentReadUrl(
        deps.db,
        request.actor,
        request.params.propertyId,
        request.params.documentId
      );
      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.post<{ Params: PlatformDocumentParams; Body: DocumentReviewBody }>(
    "/v1/platform/properties/:propertyId/documents/:documentId/review",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "Verify or reject a property compliance document",
        security: [{ bearerAuth: [] }],
        params: platformDocumentParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision"],
          properties: {
            decision: { type: "string", enum: ["VERIFIED", "REJECTED"] },
            reason: { type: "string", maxLength: 3000 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.document.review:${request.params.documentId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.verifyDocument(
            trx,
            actor,
            request.params.propertyId,
            request.params.documentId,
            request.body.decision,
            request.body.reason ?? null,
            requestMetadata(request, "platform-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PlatformPropertyParams; Body: VersionBody }>(
    "/v1/platform/properties/:propertyId/review/start",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "Start Wildleaf review of a submitted property",
        security: [{ bearerAuth: [] }],
        params: platformPropertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.review.start:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.startReview(
            trx,
            actor,
            request.params.propertyId,
            request.body.version,
            requestMetadata(request, "platform-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PlatformPropertyParams; Body: ReviewDecisionBody }>(
    "/v1/platform/properties/:propertyId/review/decision",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "Approve a property or request changes",
        security: [{ bearerAuth: [] }],
        params: platformPropertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version", "decision"],
          properties: {
            version: { type: "integer", minimum: 1 },
            decision: {
              type: "string",
              enum: ["CHANGES_REQUIRED", "APPROVED"]
            },
            reason: { type: "string", maxLength: 5000 }
          }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.review.decision:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.decideReview(
            trx,
            actor,
            request.params.propertyId,
            request.body.version,
            request.body.decision,
            request.body.reason ?? null,
            requestMetadata(request, "platform-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );

  app.post<{ Params: PlatformPropertyParams; Body: VersionBody }>(
    "/v1/platform/properties/:propertyId/activate",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Platform Property Review"],
        summary: "Activate an approved property and assign its public slug",
        security: [{ bearerAuth: [] }],
        params: platformPropertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["version"],
          properties: { version: { type: "integer", minimum: 1 } }
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }
      const key = requireIdempotencyKey(request.headers);
      const result = await idempotency.execute(
        {
          scopeKey: `property.activate:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 200,
          body: await service.activate(
            trx,
            actor,
            request.params.propertyId,
            request.body.version,
            requestMetadata(request, "platform-api")
          )
        })
      );
      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }
      return reply.status(result.statusCode).send(result.body);
    }
  );
}
