import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import {
  QualityAuditService,
  type CreateQualityAssessmentInput,
  type CreateQualityTemplateInput,
  type CreateQualityTemplateVersionInput,
  type QualityTemplateItemInput,
  type RecordQualityAssessmentResultInput
} from "../application/quality-audit-service.js";

export interface QualityAuditRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface TemplateParams {
  templateId: string;
}

interface TemplateVersionParams extends TemplateParams {
  versionId: string;
}

interface PropertyParams {
  propertyId: string;
}

interface AssessmentParams extends PropertyParams {
  assessmentId: string;
}

interface PartnerPropertyParams extends PropertyParams {
  organizationId: string;
}

interface PartnerAssessmentParams extends PartnerPropertyParams {
  assessmentId: string;
}

type CreateTemplateBody = Omit<CreateQualityTemplateInput, "request">;
type CreateTemplateVersionBody = Omit<CreateQualityTemplateVersionInput, "templateId" | "request">;

interface ReplaceTemplateItemsBody {
  items: QualityTemplateItemInput[];
}

type CreateAssessmentBody = Omit<CreateQualityAssessmentInput, "propertyId" | "request">;

interface RecordAssessmentResultsBody {
  results: RecordQualityAssessmentResultInput[];
}

const templateParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["templateId"],
  properties: {
    templateId: { type: "string", format: "uuid" }
  }
} as const;

const templateVersionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["templateId", "versionId"],
  properties: {
    templateId: { type: "string", format: "uuid" },
    versionId: { type: "string", format: "uuid" }
  }
} as const;

const propertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["propertyId"],
  properties: {
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const assessmentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["propertyId", "assessmentId"],
  properties: {
    propertyId: { type: "string", format: "uuid" },
    assessmentId: { type: "string", format: "uuid" }
  }
} as const;

const partnerPropertyParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" }
  }
} as const;

const partnerAssessmentParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "propertyId", "assessmentId"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    propertyId: { type: "string", format: "uuid" },
    assessmentId: { type: "string", format: "uuid" }
  }
} as const;

const createTemplateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "name"],
  properties: {
    code: {
      type: "string",
      minLength: 2,
      maxLength: 50,
      pattern: "^[A-Z0-9_-]+$"
    },
    name: {
      type: "string",
      minLength: 2,
      maxLength: 160
    }
  }
} as const;

const createTemplateVersionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: {
      type: "string",
      minLength: 2,
      maxLength: 200
    },
    notes: {
      type: ["string", "null"]
    }
  }
} as const;

const templateItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "title", "category", "checkType"],
  properties: {
    code: {
      type: "string",
      minLength: 2,
      maxLength: 60,
      pattern: "^[A-Z0-9_-]+$"
    },
    title: {
      type: "string",
      minLength: 2,
      maxLength: 200
    },
    description: {
      type: ["string", "null"]
    },
    category: {
      type: "string",
      minLength: 1,
      maxLength: 100
    },
    checkType: {
      type: "string",
      enum: [
        "MANDATORY_PASS",
        "SCORED_QUALITY_ITEM",
        "INFORMATIONAL_DISCLOSURE",
        "IMPROVEMENT_RECOMMENDATION"
      ]
    },
    maxScore: {
      type: ["integer", "null"],
      minimum: 1
    },
    sortOrder: {
      type: "integer",
      minimum: 0
    }
  }
} as const;

const replaceTemplateItemsBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: templateItemSchema
    }
  }
} as const;

const createAssessmentBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["templateVersionId", "triggerType"],
  properties: {
    templateVersionId: {
      type: "string",
      format: "uuid"
    },
    triggerType: {
      type: "string",
      enum: [
        "SCHEDULED_AUDIT",
        "REPEATED_LOW_REVIEWS",
        "SERIOUS_COMPLAINT",
        "OWNERSHIP_MANAGEMENT_CHANGE",
        "RENOVATION",
        "SAFETY_INCIDENT"
      ]
    },
    triggerReference: {
      type: ["string", "null"]
    },
    assignedAuditorUserId: {
      type: ["string", "null"],
      format: "uuid"
    }
  }
} as const;

const assessmentResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["templateItemId", "resultStatus"],
  properties: {
    templateItemId: {
      type: "string",
      format: "uuid"
    },
    resultStatus: {
      type: "string",
      enum: ["PASS", "FAIL", "OBSERVED", "NOT_APPLICABLE"]
    },
    score: {
      type: ["integer", "null"],
      minimum: 0
    },
    notes: {
      type: ["string", "null"]
    }
  }
} as const;

const recordResultsBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: assessmentResultSchema
    }
  }
} as const;

export async function registerQualityAuditRoutes(
  app: FastifyInstance,
  deps: QualityAuditRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const quality = new QualityAuditService();

  app.post<{ Body: CreateTemplateBody }>(
    "/v1/platform/quality/templates",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Create quality standard template",
        security: [{ bearerAuth: [] }],
        body: createTemplateBodySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.createTemplate(deps.db, request.actor, {
        code: request.body.code,
        name: request.body.name,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.post<{
    Params: TemplateParams;
    Body: CreateTemplateVersionBody;
  }>(
    "/v1/platform/quality/templates/:templateId/versions",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Create quality standard template version",
        security: [{ bearerAuth: [] }],
        params: templateParamsSchema,
        body: createTemplateVersionBodySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.createTemplateVersion(deps.db, request.actor, {
        templateId: request.params.templateId,
        title: request.body.title,
        ...(request.body.notes !== undefined ? { notes: request.body.notes } : {}),
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.put<{
    Params: TemplateVersionParams;
    Body: ReplaceTemplateItemsBody;
  }>(
    "/v1/platform/quality/templates/:templateId/versions/:versionId/items",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Replace draft quality standard items",
        security: [{ bearerAuth: [] }],
        params: templateVersionParamsSchema,
        body: replaceTemplateItemsBodySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.replaceTemplateItems(deps.db, request.actor, {
        templateId: request.params.templateId,
        versionId: request.params.versionId,
        items: request.body.items,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.post<{ Params: TemplateVersionParams }>(
    "/v1/platform/quality/templates/:templateId/versions/:versionId/publish",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Publish quality standard template version",
        security: [{ bearerAuth: [] }],
        params: templateVersionParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.publishTemplateVersion(deps.db, request.actor, {
        templateId: request.params.templateId,
        versionId: request.params.versionId,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.get<{ Params: PropertyParams }>(
    "/v1/platform/properties/:propertyId/quality-assessments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "List property quality assessments",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.listPlatformAssessments(
        deps.db,
        request.actor,
        request.params.propertyId
      );

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.get<{ Params: AssessmentParams }>(
    "/v1/platform/properties/:propertyId/quality-assessments/:assessmentId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Get property quality assessment",
        security: [{ bearerAuth: [] }],
        params: assessmentParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.getPlatformAssessment(
        deps.db,
        request.actor,
        request.params.propertyId,
        request.params.assessmentId
      );

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.post<{
    Params: PropertyParams;
    Body: CreateAssessmentBody;
  }>(
    "/v1/platform/properties/:propertyId/quality-assessments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Create property quality assessment",
        security: [{ bearerAuth: [] }],
        params: propertyParamsSchema,
        body: createAssessmentBodySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.createAssessment(deps.db, request.actor, {
        propertyId: request.params.propertyId,
        templateVersionId: request.body.templateVersionId,
        triggerType: request.body.triggerType,
        ...(request.body.triggerReference !== undefined
          ? { triggerReference: request.body.triggerReference }
          : {}),
        ...(request.body.assignedAuditorUserId !== undefined
          ? {
              assignedAuditorUserId: request.body.assignedAuditorUserId
            }
          : {}),
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.post<{ Params: AssessmentParams }>(
    "/v1/platform/properties/:propertyId/quality-assessments/:assessmentId/start",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Start property quality assessment",
        security: [{ bearerAuth: [] }],
        params: assessmentParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.startAssessment(deps.db, request.actor, {
        propertyId: request.params.propertyId,
        assessmentId: request.params.assessmentId,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.put<{
    Params: AssessmentParams;
    Body: RecordAssessmentResultsBody;
  }>(
    "/v1/platform/properties/:propertyId/quality-assessments/:assessmentId/results",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Replace property quality assessment results",
        security: [{ bearerAuth: [] }],
        params: assessmentParamsSchema,
        body: recordResultsBodySchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.recordAssessmentResults(deps.db, request.actor, {
        propertyId: request.params.propertyId,
        assessmentId: request.params.assessmentId,
        results: request.body.results,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.post<{ Params: AssessmentParams }>(
    "/v1/platform/properties/:propertyId/quality-assessments/:assessmentId/complete",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Complete property quality assessment",
        security: [{ bearerAuth: [] }],
        params: assessmentParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.completeAssessment(deps.db, request.actor, {
        propertyId: request.params.propertyId,
        assessmentId: request.params.assessmentId,
        request: requestMetadata(request, "platform-api")
      });

      void reply.header("cache-control", "no-store");
      return result;
    }
  );

  app.get<{ Params: PartnerPropertyParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quality-assessments",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "List partner-visible property quality assessments",
        security: [{ bearerAuth: [] }],
        params: partnerPropertyParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.listPartnerAssessments(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.propertyId
      );

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );

  app.get<{ Params: PartnerAssessmentParams }>(
    "/v1/partner/organizations/:organizationId/properties/:propertyId/quality-assessments/:assessmentId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Quality"],
        summary: "Get partner-visible property quality assessment",
        security: [{ bearerAuth: [] }],
        params: partnerAssessmentParamsSchema
      }
    },
    async (request, reply) => {
      if (!request.actor) throw new AuthenticationError();

      const result = await quality.getPartnerAssessment(
        deps.db,
        request.actor,
        request.params.organizationId,
        request.params.propertyId,
        request.params.assessmentId
      );

      void reply.header("cache-control", "no-store, private");
      return result;
    }
  );
}
