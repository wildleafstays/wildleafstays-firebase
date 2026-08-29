import type { Kysely, Transaction } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { AuditService } from "../../../shared/audit/audit-service.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors/app-error.js";
import type { RequestMetadata } from "../../../shared/http/request-metadata.js";
import { OutboxService } from "../../../shared/outbox/outbox-service.js";
import type { PropertyRecord } from "../infrastructure/property-repository.js";

type DbExecutor = Kysely<Database> | Transaction<Database>;

const ALWAYS_EDITABLE_STATUSES = new Set(["DRAFT", "CHANGES_REQUIRED"]);
const RESPONSIBILITY_EDITABLE_STATUSES = new Set(["APPROVED", "LIVE"]);

async function currentTerms(db: DbExecutor) {
  const today = new Date().toISOString().slice(0, 10);
  const terms = await db
    .selectFrom("platform_owner_responsibility_terms")
    .selectAll()
    .where("effective_from", "<=", today)
    .orderBy("effective_from", "desc")
    .executeTakeFirst();
  if (!terms) throw new ConflictError("No effective owner responsibility terms are configured");
  return terms;
}

async function currentAcceptance(
  db: DbExecutor,
  organizationId: string,
  propertyId: string,
  termsVersionId: string
) {
  return db
    .selectFrom("property_owner_responsibility_acceptances")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("property_id", "=", propertyId)
    .where("accepted_terms_version_id", "=", termsVersionId)
    .executeTakeFirst();
}

export async function assertOwnerPropertyEditable(
  db: DbExecutor,
  property: Pick<PropertyRecord, "id" | "organization_id" | "status">
): Promise<void> {
  if (ALWAYS_EDITABLE_STATUSES.has(property.status)) return;
  if (!RESPONSIBILITY_EDITABLE_STATUSES.has(property.status)) {
    throw new ConflictError("Property content cannot be edited in its current state", {
      propertyId: property.id,
      status: property.status
    });
  }
  const terms = await currentTerms(db);
  const acceptance = await currentAcceptance(db, property.organization_id, property.id, terms.id);
  if (!acceptance) {
    throw new ConflictError(
      "Accept the owner responsibility terms before editing an approved or live property",
      { propertyId: property.id, status: property.status, termsVersion: terms.version_number }
    );
  }
}

function termsView(terms: Awaited<ReturnType<typeof currentTerms>>): JsonObject {
  return {
    id: terms.id,
    version: terms.version_number,
    effectiveFrom: terms.effective_from,
    text: terms.terms_text
  };
}

export class OwnerResponsibilityService {
  constructor(private readonly authorization = new AuthorizationService()) {}

  private async property(
    db: DbExecutor,
    actor: ActorContext,
    organizationId: string,
    propertyId: string,
    permission: typeof Permissions.PROPERTY_READ | typeof Permissions.PROPERTY_MANAGE
  ) {
    this.authorization.assert(actor, permission, {
      kind: "property",
      organizationId,
      propertyId
    });
    const property = await db
      .selectFrom("properties")
      .select(["id", "organization_id", "status"])
      .where("id", "=", propertyId)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
    if (!property) throw new NotFoundError("Property not found");
    if (property.status === "ARCHIVED") {
      throw new ConflictError("Owner responsibility cannot be managed for an archived property");
    }
    return property;
  }

  async get(
    db: DbExecutor,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<JsonObject> {
    const property = await this.property(
      db,
      actor,
      organizationId,
      propertyId,
      Permissions.PROPERTY_READ
    );
    const terms = await currentTerms(db);
    const acceptance = await currentAcceptance(db, organizationId, propertyId, terms.id);
    return {
      accepted: Boolean(acceptance),
      requiredForEditing: RESPONSIBILITY_EDITABLE_STATUSES.has(property.status),
      editable:
        ALWAYS_EDITABLE_STATUSES.has(property.status) ||
        (RESPONSIBILITY_EDITABLE_STATUSES.has(property.status) && Boolean(acceptance)),
      currentTerms: termsView(terms),
      acceptance: acceptance
        ? {
            acceptedByUserId: acceptance.accepted_by_user_id,
            acceptedAt: acceptance.accepted_at.toISOString(),
            acceptanceText: acceptance.acceptance_text
          }
        : null
    };
  }

  async accept(
    trx: Transaction<Database>,
    actor: ActorContext,
    input: {
      organizationId: string;
      propertyId: string;
      termsVersionId: string;
      accepted: boolean;
    },
    request: RequestMetadata
  ): Promise<JsonObject> {
    await this.property(
      trx,
      actor,
      input.organizationId,
      input.propertyId,
      Permissions.PROPERTY_MANAGE
    );
    if (!input.accepted) throw new ValidationError("Owner responsibility must be accepted");
    const terms = await currentTerms(trx);
    if (terms.id !== input.termsVersionId) {
      throw new ConflictError(
        "The owner responsibility terms changed. Review and accept them again"
      );
    }
    const inserted = await trx
      .insertInto("property_owner_responsibility_acceptances")
      .values({
        property_id: input.propertyId,
        organization_id: input.organizationId,
        accepted_terms_version_id: terms.id,
        acceptance_text: terms.terms_text,
        accepted_by_user_id: actor.userId,
        ip_address: request.ipAddress,
        user_agent: request.userAgent
      })
      .onConflict((oc) => oc.columns(["property_id", "accepted_terms_version_id"]).doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      const after: JsonObject = {
        propertyId: input.propertyId,
        termsVersionId: terms.id,
        termsVersion: terms.version_number,
        acceptanceText: terms.terms_text,
        acceptedAt: inserted.accepted_at.toISOString()
      };
      await new AuditService(trx).record({
        actor,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        action: "property.owner_responsibility.accepted",
        entityType: "property_owner_responsibility_acceptance",
        entityId: inserted.id,
        after,
        request
      });
      await new OutboxService(trx).enqueue({
        aggregateType: "property_owner_responsibility_acceptance",
        aggregateId: inserted.id,
        eventType: "property.owner_responsibility.accepted.v1",
        payload: after
      });
    }
    return this.get(trx, actor, input.organizationId, input.propertyId);
  }
}
