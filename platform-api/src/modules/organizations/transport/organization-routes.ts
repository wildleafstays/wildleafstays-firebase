import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { IdentityVerifier } from "../../../infrastructure/identity/identity-verifier.js";
import type { AccessRepository } from "../../access/infrastructure/access-repository.js";
import type { UserRepository } from "../../identity/infrastructure/user-repository.js";
import { CreateOrganizationService } from "../application/create-organization-service.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requireAuthentication } from "../../../shared/http/authenticate.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";

export interface OrganizationRouteDependencies {
  db: Kysely<Database>;
  identityVerifier: IdentityVerifier;
  userRepository: UserRepository;
  accessRepository: AccessRepository;
}

interface CreateOrganizationBody extends JsonObject {
  legalName: string;
  tradingName?: string;
  organizationType:
    | "PROPRIETORSHIP"
    | "PARTNERSHIP"
    | "LLP"
    | "PRIVATE_LIMITED"
    | "PUBLIC_LIMITED"
    | "TRUST"
    | "OTHER";
  countryCode?: string;
  currencyCode?: string;
}

const createOrganizationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["legalName", "organizationType"],
  properties: {
    legalName: { type: "string", minLength: 2, maxLength: 200 },
    tradingName: { type: "string", minLength: 1, maxLength: 200 },
    organizationType: {
      type: "string",
      enum: [
        "PROPRIETORSHIP",
        "PARTNERSHIP",
        "LLP",
        "PRIVATE_LIMITED",
        "PUBLIC_LIMITED",
        "TRUST",
        "OTHER"
      ]
    },
    countryCode: { type: "string", pattern: "^[A-Z]{2}$", default: "IN" },
    currencyCode: { type: "string", pattern: "^[A-Z]{3}$", default: "INR" }
  }
} as const;

const createOrganizationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organizationId", "membershipId", "status"],
  properties: {
    organizationId: { type: "string", format: "uuid" },
    membershipId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["DRAFT"] }
  }
} as const;

export async function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: OrganizationRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const idempotency = new IdempotencyService(deps.db);
  const service = new CreateOrganizationService();

  app.post<{ Body: CreateOrganizationBody }>(
    "/v1/partner/organizations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Organizations"],
        summary: "Create a partner organization and assign the current user as owner",
        security: [{ bearerAuth: [] }],
        headers: {
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
        },
        body: createOrganizationBodySchema,
        response: {
          201: createOrganizationResponseSchema
        }
      }
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor) {
        throw new AuthenticationError();
      }

      const idempotencyKey = request.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string") {
        throw new ValidationError("Idempotency key is required");
      }

      const body = request.body;
      const result = await idempotency.execute(
        {
          scopeKey: `organization.create:user:${actor.userId}`,
          key: idempotencyKey,
          requestBody: body
        },
        async (trx) => ({
          statusCode: 201,
          body: await service.execute(
            trx,
            actor,
            {
              legalName: body.legalName.trim(),
              tradingName: body.tradingName?.trim() || null,
              organizationType: body.organizationType,
              countryCode: body.countryCode ?? "IN",
              currencyCode: body.currencyCode ?? "INR"
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
}
