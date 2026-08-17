import type { Selectable, Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";

type Trx = Transaction<Database>;

export type CommercialSettingsVersionRecord = Selectable<
  Database["property_commercial_setting_versions"]
>;
export type TaxPolicyRecord = Selectable<Database["commercial_tax_policies"]>;
export type TaxPolicyVersionRecord = Selectable<Database["commercial_tax_policy_versions"]>;
export type TaxComponentRecord = Selectable<Database["commercial_tax_components"]>;
export type TaxAssignmentRecord = Selectable<Database["commercial_tax_assignments"]>;
export type FeePolicyRecord = Selectable<Database["commercial_fee_policies"]>;
export type FeePolicyVersionRecord = Selectable<Database["commercial_fee_policy_versions"]>;
export type FeeAssignmentRecord = Selectable<Database["commercial_fee_assignments"]>;
export type CancellationPolicyRecord = Selectable<Database["cancellation_policies"]>;
export type CancellationPolicyVersionRecord = Selectable<Database["cancellation_policy_versions"]>;
export type CancellationTierRecord = Selectable<Database["cancellation_policy_tiers"]>;
export type CancellationAssignmentRecord = Selectable<
  Database["rate_plan_cancellation_assignments"]
>;
export type GuestAgeVersionRecord = Selectable<Database["guest_age_policy_versions"]>;

export interface CommercialQuoteResolutionData {
  settingsVersions: CommercialSettingsVersionRecord[];
  taxPolicies: TaxPolicyRecord[];
  taxVersions: TaxPolicyVersionRecord[];
  taxComponents: TaxComponentRecord[];
  taxAssignments: TaxAssignmentRecord[];
  feePolicies: FeePolicyRecord[];
  feeVersions: FeePolicyVersionRecord[];
  feeAssignments: FeeAssignmentRecord[];
  cancellationPolicies: CancellationPolicyRecord[];
  cancellationVersions: CancellationPolicyVersionRecord[];
  cancellationTiers: CancellationTierRecord[];
  cancellationAssignments: CancellationAssignmentRecord[];
  guestAgeVersions: GuestAgeVersionRecord[];
}

export class CommercialQuoteRepository {
  async loadResolutionData(
    trx: Trx,
    organizationId: string,
    propertyId: string
  ): Promise<CommercialQuoteResolutionData> {
    const [
      settingsVersions,
      taxPolicies,
      taxVersions,
      taxComponents,
      taxAssignments,
      feePolicies,
      feeVersions,
      feeAssignments,
      cancellationPolicies,
      cancellationVersions,
      cancellationTiers,
      cancellationAssignments,
      guestAgeVersions
    ] = await Promise.all([
      trx
        .selectFrom("property_commercial_setting_versions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_tax_policies")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("commercial_tax_policy_versions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("sealed_at", "is not", null)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_tax_components")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("sort_order")
        .execute(),
      trx
        .selectFrom("commercial_tax_assignments")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_fee_policies")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("commercial_fee_policy_versions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("commercial_fee_assignments")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("cancellation_policies")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("code")
        .execute(),
      trx
        .selectFrom("cancellation_policy_versions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .where("sealed_at", "is not", null)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("cancellation_policy_tiers")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("minimum_minutes_before_arrival", "desc")
        .execute(),
      trx
        .selectFrom("rate_plan_cancellation_assignments")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute(),
      trx
        .selectFrom("guest_age_policy_versions")
        .selectAll()
        .where("organization_id", "=", organizationId)
        .where("property_id", "=", propertyId)
        .orderBy("effective_from")
        .execute()
    ]);

    return {
      settingsVersions,
      taxPolicies,
      taxVersions,
      taxComponents,
      taxAssignments,
      feePolicies,
      feeVersions,
      feeAssignments,
      cancellationPolicies,
      cancellationVersions,
      cancellationTiers,
      cancellationAssignments,
      guestAgeVersions
    };
  }
}
