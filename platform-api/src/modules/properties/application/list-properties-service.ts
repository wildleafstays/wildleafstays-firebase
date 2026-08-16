import type { Kysely } from "kysely";
import type { Database, JsonObject } from "../../../infrastructure/database/types.js";
import type { ActorContext } from "../../access/domain/actor-context.js";
import { AuthorizationService } from "../../access/domain/authorization-service.js";
import { Permissions } from "../../access/domain/permissions.js";
import { PropertyRepository } from "../infrastructure/property-repository.js";
import { presentProperty, type PropertyView } from "./property-presenter.js";

export interface ListPropertiesResult extends JsonObject {
  properties: PropertyView[];
}

export class ListPropertiesService {
  constructor(
    private readonly repository = new PropertyRepository(),
    private readonly authorization = new AuthorizationService()
  ) {}

  async execute(
    db: Kysely<Database>,
    actor: ActorContext,
    organizationId: string
  ): Promise<ListPropertiesResult> {
    const properties = await this.repository.listByOrganization(db, organizationId);
    const visible = properties.filter((property) =>
      this.authorization.can(actor, Permissions.PROPERTY_READ, {
        kind: "property",
        organizationId,
        propertyId: property.id
      })
    );

    return { properties: visible.map(presentProperty) };
  }
}
