import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { PropertyOnboardingService } from "../application/property-onboarding-service.js";
import type {
  ChildrenPolicy,
  DocumentType,
  MediaType,
  PartiesEventsPolicy,
  PetsPolicy,
  PropertySmokingPolicy,
  ReviewDecision,
  StorageProvider
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

interface AddMediaBody extends JsonObject {
  mediaType: MediaType;
  storageProvider: StorageProvider;
  storageKey: string;
  mimeType?: string;
  altText?: string;
  caption?: string;
  isCover?: boolean;
  sortOrder?: number;
}

interface AddDocumentBody extends JsonObject {
  documentType: DocumentType;
  storageProvider: StorageProvider;
  storageKey: string;
  originalFilename: string;
  issuedOn?: string;
  expiresOn?: string;
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

  app.post<{ Params: PropertyParams; Body: AddMediaBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/media",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Register property media metadata after secure storage upload",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["mediaType", "storageProvider", "storageKey"],
          properties: {
            mediaType: { type: "string", enum: ["IMAGE", "VIDEO"] },
            storageProvider: {
              type: "string",
              enum: ["FIREBASE", "GCS", "OTHER"]
            },
            storageKey: {
              type: "string",
              minLength: 3,
              maxLength: 1000,
              pattern: "^[A-Za-z0-9_./-]+$"
            },
            mimeType: { type: "string", maxLength: 150 },
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
      const result = await idempotency.execute(
        {
          scopeKey: `property.media.add:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.addMedia(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              mediaType: request.body.mediaType,
              storageProvider: request.body.storageProvider,
              storageKey: request.body.storageKey,
              mimeType: request.body.mimeType?.trim() || null,
              altText: request.body.altText?.trim() || null,
              caption: request.body.caption?.trim() || null,
              isCover: request.body.isCover ?? false,
              sortOrder: request.body.sortOrder ?? 0
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

  app.post<{ Params: PropertyParams; Body: AddDocumentBody }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/onboarding/documents",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Property Onboarding"],
        summary: "Register property compliance document metadata after secure upload",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documentType", "storageProvider", "storageKey", "originalFilename"],
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
            storageProvider: {
              type: "string",
              enum: ["FIREBASE", "GCS", "OTHER"]
            },
            storageKey: {
              type: "string",
              minLength: 3,
              maxLength: 1000,
              pattern: "^[A-Za-z0-9_./-]+$"
            },
            originalFilename: { type: "string", minLength: 1, maxLength: 255 },
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
      const result = await idempotency.execute(
        {
          scopeKey: `property.document.add:${request.params.propertyId}:user:${actor.userId}`,
          key,
          requestBody: request.body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.addDocument(
            trx,
            actor,
            {
              organizationId: request.params.organizationId,
              propertyId: request.params.propertyId,
              documentType: request.body.documentType,
              storageProvider: request.body.storageProvider,
              storageKey: request.body.storageKey,
              originalFilename: request.body.originalFilename.trim(),
              issuedOn: request.body.issuedOn ?? null,
              expiresOn: request.body.expiresOn ?? null
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
