import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import { PropertyRepository } from "../infrastructure/property-repository.js";
import { presentProperty, type PropertyView } from "./property-presenter.js";

export interface GetPropertyResult extends JsonObject {
  property: PropertyView;
}

export class GetPropertyService {
  constructor(
    private readonly repository = new PropertyRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async execute(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string,
    propertyId: string
  ): Promise<GetPropertyResult> {
    this.authorization.assert(actor, Permissions.PROPERTY_READ, {
      kind: "property",
      organizationId,
      propertyId
    });

    const property = await this.repository.findById(db, organizationId, propertyId);
    if (!property) {
      throw new NotFoundError("Property not found");
    }

    return { property: presentProperty(property) };
  }
}
