import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { AuthenticationError, ValidationError } from "../../../shared/errors/app-error.js";
import { requestMetadata } from "../../../shared/http/request-metadata.js";
import { IdempotencyService } from "../../../shared/idempotency/idempotency-service.js";
import {
  requireAuthentication,
  type AuthenticationDependencies
} from "../../../shared/http/authenticate.js";
import {
  GuestCancellationService,
  type GuestCancellationResult
} from "../application/guest-cancellation-service.js";
import { GuestSelfService } from "../application/guest-self-service.js";
import type { GuestReservationListCursor } from "../domain/guest-self-service.js";

export interface GuestSelfServiceRouteDependencies extends AuthenticationDependencies {
  db: Kysely<Database>;
}

interface GuestReservationsQuery {
  cursor?: string;
  limit?: number;
}

interface GuestReservationParams {
  reservationId: string;
}

const guestCancellationHeadersSchema = {
  type: "object",
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string"
    }
  }
} as const;

const guestCancellationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "reservationId",
    "status",
    "cancelledAt",
    "arrivalAt",
    "minutesBeforeArrival",
    "penaltyType",
    "penaltyMinor",
    "paidMinor",
    "refundDueMinor",
    "currencyCode",
    "refundRequired"
  ],
  properties: {
    reservationId: {
      type: "string",
      format: "uuid"
    },
    status: {
      type: "string",
      enum: ["CANCELLED"]
    },
    cancelledAt: {
      type: "string",
      format: "date-time"
    },
    arrivalAt: {
      type: "string",
      format: "date-time"
    },
    minutesBeforeArrival: {
      type: "integer",
      minimum: 0
    },
    penaltyType: {
      type: "string",
      enum: ["PERCENTAGE_OF_STAY", "FIXED_AMOUNT", "NIGHTS"]
    },
    penaltyMinor: {
      type: "integer",
      minimum: 0
    },
    paidMinor: {
      type: "integer",
      minimum: 0
    },
    refundDueMinor: {
      type: "integer",
      minimum: 0
    },
    currencyCode: {
      type: "string"
    },
    refundRequired: {
      type: "boolean"
    }
  }
} as const;

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }]
} as const;

const guestReservationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "reservationReference",
    "status",
    "property",
    "arrivalDate",
    "departureDate",
    "product",
    "leadGuest",
    "economics",
    "linkedAt",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    reservationReference: { type: "string" },
    status: { type: "string" },
    property: {
      type: "object",
      additionalProperties: false,
      required: ["id", "name", "publicSlug"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        publicSlug: nullableString
      }
    },
    arrivalDate: { type: "string", format: "date" },
    departureDate: { type: "string", format: "date" },
    product: {
      type: "object",
      additionalProperties: false,
      required: ["type", "label", "roomCategoryId", "quantity"],
      properties: {
        type: {
          type: "string",
          enum: ["ROOM_CATEGORY", "FULL_PROPERTY", "ROOM_MIX"]
        },
        label: { type: "string" },
        roomCategoryId: {
          anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
        },
        quantity: { type: "integer", minimum: 1 }
      }
    },
    leadGuest: {
      type: "object",
      additionalProperties: false,
      required: ["name", "email", "phone"],
      properties: {
        name: { type: "string" },
        email: nullableString,
        phone: nullableString
      }
    },
    economics: {
      type: "object",
      additionalProperties: false,
      required: ["currencyCode", "totalMinor"],
      properties: {
        currencyCode: { type: "string" },
        totalMinor: { type: "integer", minimum: 0 }
      }
    },
    linkedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

function setGuestNoStore(reply: { header(name: string, value: string): unknown }): void {
  void reply.header("cache-control", "no-store, private");
}

function requireActorUserId(request: FastifyRequest): string {
  if (!request.actor) {
    throw new AuthenticationError();
  }
  return request.actor.userId;
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const key = headers["idempotency-key"];

  if (typeof key !== "string") {
    throw new ValidationError("Idempotency-Key header is required");
  }

  return key;
}

function guestCancellationHttpResponse(result: GuestCancellationResult) {
  return {
    reservationId: result.reservationId,
    status: result.status,
    cancelledAt: result.cancelledAt,
    arrivalAt: result.arrivalAt,
    minutesBeforeArrival: result.minutesBeforeArrival,
    penaltyType: result.penaltyType,
    penaltyMinor: result.penaltyMinor,
    paidMinor: result.paidMinor,
    refundDueMinor: result.refundDueMinor,
    currencyCode: result.currencyCode,
    refundRequired: result.refundRequired
  };
}

function encodeCursor(cursor: GuestReservationListCursor): string {
  return Buffer.from(
    JSON.stringify({
      linkedAt: cursor.linkedAt.toISOString(),
      reservationId: cursor.reservationId
    }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): GuestReservationListCursor | null {
  if (value === undefined) {
    return null;
  }

  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("linkedAt" in parsed) ||
      !("reservationId" in parsed)
    ) {
      throw new ValidationError("Invalid guest reservation cursor");
    }

    const linkedAtValue = (parsed as { linkedAt: unknown }).linkedAt;
    const reservationId = (parsed as { reservationId: unknown }).reservationId;

    if (
      typeof linkedAtValue !== "string" ||
      typeof reservationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reservationId
      )
    ) {
      throw new ValidationError("Invalid guest reservation cursor");
    }

    const linkedAt = new Date(linkedAtValue);
    if (Number.isNaN(linkedAt.getTime())) {
      throw new ValidationError("Invalid guest reservation cursor");
    }

    return {
      linkedAt,
      reservationId
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError("Invalid guest reservation cursor");
  }
}

export async function registerGuestSelfServiceRoutes(
  app: FastifyInstance,
  deps: GuestSelfServiceRouteDependencies
): Promise<void> {
  const authenticate = requireAuthentication(deps);
  const service = new GuestSelfService(deps.db);
  const cancellationService = new GuestCancellationService();
  const idempotency = new IdempotencyService(deps.db);

  app.get<{ Querystring: GuestReservationsQuery }>(
    "/v1/guest/reservations",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Guest Self-Service"],
        summary: "List reservations owned by the authenticated guest",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: {
              type: "string",
              minLength: 1,
              maxLength: 1000
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 50
            }
          }
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["reservations", "nextCursor"],
            properties: {
              reservations: {
                type: "array",
                items: guestReservationSchema
              },
              nextCursor: nullableString
            }
          }
        }
      }
    },
    async (request, reply) => {
      setGuestNoStore(reply);

      const result = await service.listReservations({
        userId: requireActorUserId(request),
        cursor: decodeCursor(request.query.cursor),
        limit: request.query.limit ?? 50
      });

      return {
        reservations: result.reservations,
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null
      };
    }
  );

  app.get<{ Params: GuestReservationParams }>(
    "/v1/guest/reservations/:reservationId",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Guest Self-Service"],
        summary: "Read one reservation owned by the authenticated guest",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["reservationId"],
          properties: {
            reservationId: {
              type: "string",
              format: "uuid"
            }
          }
        },
        response: {
          200: guestReservationSchema
        }
      }
    },
    async (request, reply) => {
      setGuestNoStore(reply);

      return service.getReservation(requireActorUserId(request), request.params.reservationId);
    }
  );

  app.post<{ Params: GuestReservationParams }>(
    "/v1/guest/reservations/:reservationId/cancel",
    {
      preHandler: authenticate,
      schema: {
        tags: ["Guest Self-Service"],
        summary: "Cancel one reservation owned by the authenticated guest",
        security: [{ bearerAuth: [] }],
        headers: guestCancellationHeadersSchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["reservationId"],
          properties: {
            reservationId: {
              type: "string",
              format: "uuid"
            }
          }
        },
        response: {
          200: guestCancellationResponseSchema
        }
      }
    },
    async (request, reply) => {
      setGuestNoStore(reply);

      if (!request.actor) {
        throw new AuthenticationError();
      }

      const actor = request.actor;
      const key = requireIdempotencyKey(request.headers);

      const result = await idempotency.execute(
        {
          scopeKey: `guest.reservation.cancel:user:${actor.userId}`,
          key,
          requestBody: {
            reservationId: request.params.reservationId
          }
        },
        async (trx) => {
          const cancellation = await cancellationService.cancel(
            trx,
            actor,
            {
              reservationId: request.params.reservationId
            },
            requestMetadata(request, "guest.reservation.cancel")
          );

          return {
            body: guestCancellationHttpResponse(cancellation),
            statusCode: 200
          };
        }
      );

      if (result.replayed) {
        void reply.header("idempotency-replayed", "true");
      }

      return reply.code(result.statusCode).send(result.body);
    }
  );
}
