import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

export interface CreateOrganizationInput {
  legalName: string;
  tradingName: string | null;
  organizationType:
    | "PROPRIETORSHIP"
    | "PARTNERSHIP"
    | "LLP"
    | "PRIVATE_LIMITED"
    | "PUBLIC_LIMITED"
    | "TRUST"
    | "OTHER";
  countryCode: string;
  currencyCode: string;
}

export class OrganizationRepository {
  async createWithOwner(
    trx: Transaction<Database>,
    input: CreateOrganizationInput,
    ownerUserId: string
  ): Promise<{ organizationId: string; membershipId: string }> {
    const organizationId = randomUUID();
    const membershipId = randomUUID();

    await trx
      .insertInto("organizations")
      .values({
        id: organizationId,
        legal_name: input.legalName,
        trading_name: input.tradingName,
        organization_type: input.organizationType,
        status: "DRAFT",
        country_code: input.countryCode,
        currency_code: input.currencyCode
      })
      .executeTakeFirst();

    await trx
      .insertInto("organization_memberships")
      .values({
        id: membershipId,
        organization_id: organizationId,
        user_id: ownerUserId,
        role_code: "OWNER",
        status: "ACTIVE",
        invited_by_user_id: null
      })
      .executeTakeFirst();

    return { organizationId, membershipId };
  }
}
