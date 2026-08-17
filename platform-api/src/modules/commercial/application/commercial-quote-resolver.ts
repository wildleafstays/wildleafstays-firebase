import type { Transaction } from "kysely";
import type { Database } from "../../../infrastructure/database/types.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import type {
  ResolvedCancellationPolicy,
  ResolvedCommercialDay,
  ResolvedCommercialQuoteContext,
  ResolvedFeePolicy,
  ResolvedGuestAgePolicy,
  ResolvedTaxPolicy
} from "../domain/commercial-quote-resolution.js";
import type {
  CommercialScopeType,
  FeeApplicationBasis,
  FeeCalculationType,
  FeeMode,
  PriceMode,
  TaxMode,
  TaxSelectionBasis
} from "../domain/commercial-rules.js";
import {
  CommercialQuoteRepository,
  type CommercialQuoteResolutionData,
  type FeeAssignmentRecord,
  type TaxAssignmentRecord
} from "../infrastructure/commercial-quote-repository.js";

interface ResolveInput {
  organizationId: string;
  propertyId: string;
  ratePlanId: string;
  rateProductId: string;
  stayDates: string[];
}

function latestEffective<T extends { effective_from: string }>(
  rows: T[],
  targetDate: string
): T | undefined {
  let latest: T | undefined;
  for (const row of rows) {
    if (
      row.effective_from <= targetDate &&
      (!latest || row.effective_from > latest.effective_from)
    ) {
      latest = row;
    }
  }
  return latest;
}

function assignmentPolicyId(row: TaxAssignmentRecord | FeeAssignmentRecord): string {
  return "tax_policy_id" in row ? row.tax_policy_id : row.fee_policy_id;
}

function applicableAssignment<T extends TaxAssignmentRecord | FeeAssignmentRecord>(
  rows: T[],
  policyId: string,
  targetDate: string,
  ratePlanId: string,
  rateProductId: string
): T | undefined {
  const candidates = rows.filter(
    (row) => assignmentPolicyId(row) === policyId && row.effective_from <= targetDate
  );

  const latestFor = (scope: CommercialScopeType): T | undefined => {
    const scoped = candidates.filter((row) => {
      if (row.scope_type !== scope) return false;
      if (scope === "RATE_PRODUCT") return row.rate_product_id === rateProductId;
      if (scope === "RATE_PLAN") return row.rate_plan_id === ratePlanId;
      return row.rate_plan_id === null && row.rate_product_id === null;
    });
    return latestEffective(scoped, targetDate);
  };

  return latestFor("RATE_PRODUCT") ?? latestFor("RATE_PLAN") ?? latestFor("PROPERTY");
}

function resolveTaxPolicy(
  data: CommercialQuoteResolutionData,
  policyId: string,
  targetDate: string
): ResolvedTaxPolicy {
  const policy = data.taxPolicies.find((row) => row.id === policyId);
  if (!policy) {
    throw new ConflictError("Commercial tax assignment references a missing tax policy", {
      taxPolicyId: policyId
    });
  }

  const version = latestEffective(
    data.taxVersions.filter((row) => row.tax_policy_id === policyId && row.sealed_at !== null),
    targetDate
  );
  if (!version) {
    throw new ConflictError("Assigned tax policy has no sealed version effective for the quote", {
      taxPolicyId: policyId,
      targetDate
    });
  }

  const components = data.taxComponents
    .filter((row) => row.tax_policy_version_id === version.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.component_code.localeCompare(b.component_code))
    .map((row) => ({
      code: row.component_code,
      name: row.component_name,
      rateBasisPoints: row.rate_basis_points,
      sortOrder: row.sort_order
    }));

  if (components.length === 0) {
    throw new ConflictError("Sealed tax policy version has no tax components", {
      taxPolicyId: policyId,
      taxPolicyVersionId: version.id
    });
  }

  return {
    policyId: policy.id,
    policyCode: policy.code,
    policyName: policy.name,
    versionId: version.id,
    version: version.version_number,
    effectiveFrom: version.effective_from,
    priceMode: version.price_mode as PriceMode,
    selectionBasis: version.selection_basis as TaxSelectionBasis,
    minimumBasisMinor: version.minimum_basis_minor,
    maximumBasisMinor: version.maximum_basis_minor,
    appliesToAccommodation: version.applies_to_accommodation,
    appliesToExtraGuest: version.applies_to_extra_guest,
    appliesToFee: version.applies_to_fee,
    components
  };
}

function resolveFeePolicy(
  data: CommercialQuoteResolutionData,
  policyId: string,
  targetDate: string,
  taxMode: TaxMode
): ResolvedFeePolicy {
  const policy = data.feePolicies.find((row) => row.id === policyId);
  if (!policy) {
    throw new ConflictError("Commercial fee assignment references a missing fee policy", {
      feePolicyId: policyId
    });
  }
  const version = latestEffective(
    data.feeVersions.filter((row) => row.fee_policy_id === policyId),
    targetDate
  );
  if (!version) {
    throw new ConflictError("Assigned fee policy has no version effective for the quote", {
      feePolicyId: policyId,
      targetDate
    });
  }

  let taxPolicy: ResolvedTaxPolicy | null = null;
  if (version.taxable) {
    if (taxMode !== "POLICIES") {
      throw new ConflictError(
        "A taxable fee cannot be evaluated while the property tax mode is NO_TAX",
        {
          feePolicyId: policyId,
          targetDate
        }
      );
    }
    if (!version.tax_policy_id) {
      throw new ConflictError("Taxable fee policy is missing its tax policy reference", {
        feePolicyId: policyId
      });
    }
    taxPolicy = resolveTaxPolicy(data, version.tax_policy_id, targetDate);
    if (!taxPolicy.appliesToFee) {
      throw new ConflictError(
        "Tax policy linked to a taxable fee is not configured to apply to fees",
        {
          feePolicyId: policyId,
          taxPolicyId: taxPolicy.policyId
        }
      );
    }
  }

  return {
    policyId: policy.id,
    policyCode: policy.code,
    policyName: policy.name,
    versionId: version.id,
    version: version.version_number,
    effectiveFrom: version.effective_from,
    currencyCode: version.currency_code,
    calculationType: version.calculation_type as FeeCalculationType,
    applicationBasis: version.application_basis as FeeApplicationBasis,
    amountMinor: version.amount_minor,
    rateBasisPoints: version.rate_basis_points,
    priceMode: version.price_mode as PriceMode,
    taxable: version.taxable,
    taxPolicyId: version.tax_policy_id,
    taxPolicy
  };
}

export class CommercialQuoteResolver {
  constructor(private readonly repository = new CommercialQuoteRepository()) {}

  async resolve(
    trx: Transaction<Database>,
    input: ResolveInput
  ): Promise<ResolvedCommercialQuoteContext | null> {
    if (input.stayDates.length === 0) return null;

    const data = await this.repository.loadResolutionData(
      trx,
      input.organizationId,
      input.propertyId
    );

    const arrivalDate = input.stayDates[0]!;
    const arrivalSettings = latestEffective(data.settingsVersions, arrivalDate);
    if (!arrivalSettings) {
      // Backwards-compatible rollout: properties that have not opted into commercial
      // settings continue to create the Phase 4A PRE_TAX_ONLY quote.
      return null;
    }

    const days: ResolvedCommercialDay[] = [];

    for (const stayDate of input.stayDates) {
      const settings = latestEffective(data.settingsVersions, stayDate);
      if (!settings) {
        throw new ConflictError("Commercial settings are not effective for every quoted night", {
          stayDate
        });
      }

      const taxMode = settings.tax_mode as TaxMode;
      const feeMode = settings.fee_mode as FeeMode;
      const taxPolicies: ResolvedTaxPolicy[] = [];
      const feePolicies: ResolvedFeePolicy[] = [];
      let hasTaxAssignmentState = false;
      let hasFeeAssignmentState = false;

      if (taxMode === "POLICIES") {
        for (const policy of data.taxPolicies) {
          const assignment = applicableAssignment(
            data.taxAssignments,
            policy.id,
            stayDate,
            input.ratePlanId,
            input.rateProductId
          );
          if (!assignment) continue;
          hasTaxAssignmentState = true;
          if (assignment.enabled) {
            taxPolicies.push(resolveTaxPolicy(data, policy.id, stayDate));
          }
        }

        if (!hasTaxAssignmentState) {
          throw new ConflictError(
            "Tax mode POLICIES requires an explicit effective tax assignment state",
            { stayDate }
          );
        }
      }

      if (feeMode === "POLICIES") {
        for (const policy of data.feePolicies) {
          const assignment = applicableAssignment(
            data.feeAssignments,
            policy.id,
            stayDate,
            input.ratePlanId,
            input.rateProductId
          );
          if (!assignment) continue;
          hasFeeAssignmentState = true;
          if (assignment.enabled) {
            feePolicies.push(resolveFeePolicy(data, policy.id, stayDate, taxMode));
          }
        }

        if (!hasFeeAssignmentState) {
          throw new ConflictError(
            "Fee mode POLICIES requires an explicit effective fee assignment state",
            { stayDate }
          );
        }
      }

      days.push({
        stayDate,
        settingsVersionId: settings.id,
        settingsVersion: settings.version_number,
        settingsEffectiveFrom: settings.effective_from,
        taxMode,
        feeMode,
        taxPolicies,
        feePolicies,
        hasTaxAssignmentState,
        hasFeeAssignmentState
      });
    }

    const guestAgeVersion = latestEffective(data.guestAgeVersions, arrivalDate);
    if (!guestAgeVersion) {
      throw new ConflictError(
        "Commercial quote requires an effective guest age policy once commercial settings are enabled",
        { arrivalDate }
      );
    }

    const guestAgePolicy: ResolvedGuestAgePolicy = {
      versionId: guestAgeVersion.id,
      version: guestAgeVersion.version_number,
      effectiveFrom: guestAgeVersion.effective_from,
      infantMaxAge: guestAgeVersion.infant_max_age,
      childMaxAge: guestAgeVersion.child_max_age,
      infantsCountTowardsOccupancy: guestAgeVersion.infants_count_towards_occupancy,
      infantsCountTowardsChildLimit: guestAgeVersion.infants_count_towards_child_limit,
      infantsChargeAsChildren: guestAgeVersion.infants_charge_as_children
    };

    const cancellationAssignment = latestEffective(
      data.cancellationAssignments.filter((row) => row.rate_plan_id === input.ratePlanId),
      arrivalDate
    );
    if (!cancellationAssignment) {
      throw new ConflictError(
        "Commercial quote requires an effective cancellation policy assignment for the rate plan",
        { ratePlanId: input.ratePlanId, arrivalDate }
      );
    }

    const cancellationPolicyRow = data.cancellationPolicies.find(
      (row) => row.id === cancellationAssignment.cancellation_policy_id
    );
    if (!cancellationPolicyRow) {
      throw new ConflictError("Cancellation assignment references a missing policy");
    }

    const cancellationVersion = latestEffective(
      data.cancellationVersions.filter(
        (row) =>
          row.cancellation_policy_id === cancellationAssignment.cancellation_policy_id &&
          row.sealed_at !== null
      ),
      arrivalDate
    );
    if (!cancellationVersion) {
      throw new ConflictError(
        "Assigned cancellation policy has no sealed version effective for the quote",
        { arrivalDate }
      );
    }

    const cancellationPolicy: ResolvedCancellationPolicy = {
      policyId: cancellationPolicyRow.id,
      policyCode: cancellationPolicyRow.code,
      policyName: cancellationPolicyRow.name,
      versionId: cancellationVersion.id,
      version: cancellationVersion.version_number,
      effectiveFrom: cancellationVersion.effective_from,
      arrivalLocalTime: cancellationVersion.arrival_local_time,
      currencyCode: cancellationVersion.currency_code,
      policyText: cancellationVersion.policy_text,
      tiers: data.cancellationTiers
        .filter((row) => row.cancellation_policy_version_id === cancellationVersion.id)
        .sort((a, b) => {
          if (a.trigger_type !== b.trigger_type)
            return a.trigger_type.localeCompare(b.trigger_type);
          return (
            (b.minimum_minutes_before_arrival ?? -1) - (a.minimum_minutes_before_arrival ?? -1)
          );
        })
        .map((row) => ({
          triggerType: row.trigger_type as "CANCELLATION" | "NO_SHOW",
          minimumMinutesBeforeArrival: row.minimum_minutes_before_arrival,
          penaltyType: row.penalty_type as "PERCENTAGE_OF_STAY" | "FIXED_AMOUNT" | "NIGHTS",
          penaltyValue: row.penalty_value
        }))
    };

    if (cancellationPolicy.tiers.length === 0) {
      throw new ConflictError("Resolved cancellation policy has no tiers");
    }

    return { days, guestAgePolicy, cancellationPolicy };
  }
}
