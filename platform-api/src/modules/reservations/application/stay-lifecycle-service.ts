import type { Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import type { ReservationStatus, ReservationView } from "../domain/reservation.js";
import { ReservationRepository } from "../infrastructure/reservation-repository.js";

export interface StayLifecycleResult extends JsonObject {
  transitioned: boolean;
  reservation: ReservationView;
}

interface TransitionSpec {
  fromStatus: "CONFIRMED" | "CHECKED_IN";
  toStatus: "CHECKED_IN" | "CHECKED_OUT";
  reason: "FRONT_DESK_CHECK_IN" | "FRONT_DESK_CHECK_OUT";
  auditAction: "reservation.checked_in" | "reservation.checked_out";
  outboxEventType: "reservation.checked_in.v1" | "reservation.checked_out.v1";
}

export class StayLifecycleService {
  constructor(
    private readonly reservations = new ReservationRepository(),
    private readonly authorization = new AuthorizationService(),
    private readonly now: () => Date = () => new Date()
  ) {}

  private async transition(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    spec: TransitionSpec,
    request: RequestMetadata
  ): Promise<StayLifecycleResult> {
    this.authorization.assert(actor, Permissions.RESERVATION_MANAGE, {
      kind: "property",
      organizationId: input.organizationId,
      propertyId: input.propertyId
    });

    const reservation = await this.reservations.findByIdForUpdate(
      trx,
      input.organizationId,
      input.propertyId,
      input.reservationId
    );

    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    if (reservation.status === spec.toStatus) {
      return {
        transitioned: false,
        reservation: await this.reservations.view(trx, reservation, this.now())
      };
    }

    if (reservation.status !== spec.fromStatus) {
      throw new ConflictError(
        `Reservation must be ${spec.fromStatus} before transition to ${spec.toStatus}`,
        {
          reservationId: reservation.id,
          currentStatus: reservation.status,
          requiredStatus: spec.fromStatus,
          requestedStatus: spec.toStatus
        }
      );
    }

    const transitioned = await this.reservations.transitionStatus(
      trx,
      input.organizationId,
      input.propertyId,
      reservation.id,
      spec.fromStatus as ReservationStatus,
      spec.toStatus as ReservationStatus
    );

    if (!transitioned) {
      throw new ConflictError(
        "Reservation state changed while applying stay lifecycle transition",
        {
          reservationId: reservation.id,
          expectedStatus: spec.fromStatus,
          requestedStatus: spec.toStatus
        }
      );
    }

    await this.reservations.appendStatusHistory(trx, {
      reservationId: reservation.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      fromStatus: spec.fromStatus,
      toStatus: spec.toStatus,
      reason: spec.reason,
      actorUserId: actor.userId,
      request
    });

    const view = await this.reservations.view(trx, transitioned, this.now());

    await new AuditService(trx).record({
      actor,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      action: spec.auditAction,
      entityType: "reservation",
      entityId: reservation.id,
      before: {
        status: spec.fromStatus
      },
      after: {
        status: spec.toStatus
      },
      reason: spec.reason,
      request
    });

    await new OutboxService(trx).enqueue({
      aggregateType: "reservation",
      aggregateId: reservation.id,
      eventType: spec.outboxEventType,
      payload: {
        reservationId: reservation.id,
        reservationReference: reservation.reservation_reference,
        propertyId: input.propertyId,
        previousStatus: spec.fromStatus,
        status: spec.toStatus,
        transitionReason: spec.reason,
        actorUserId: actor.userId
      }
    });

    return {
      transitioned: true,
      reservation: view
    };
  }

  checkIn(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<StayLifecycleResult> {
    return this.transition(
      trx,
      actor,
      input,
      {
        fromStatus: "CONFIRMED",
        toStatus: "CHECKED_IN",
        reason: "FRONT_DESK_CHECK_IN",
        auditAction: "reservation.checked_in",
        outboxEventType: "reservation.checked_in.v1"
      },
      request
    );
  }

  checkOut(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      reservationId: string;
    },
    request: RequestMetadata
  ): Promise<StayLifecycleResult> {
    return this.transition(
      trx,
      actor,
      input,
      {
        fromStatus: "CHECKED_IN",
        toStatus: "CHECKED_OUT",
        reason: "FRONT_DESK_CHECK_OUT",
        auditAction: "reservation.checked_out",
        outboxEventType: "reservation.checked_out.v1"
      },
      request
    );
  }
}
