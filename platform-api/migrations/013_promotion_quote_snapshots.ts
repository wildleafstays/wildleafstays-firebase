import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table quote_promotion_snapshots (
      id uuid primary key default gen_random_uuid(),
      quote_id uuid not null unique,
      organization_id uuid not null,
      property_id uuid not null,
      promotion_settings_version_id uuid not null,
      settings_version_number integer not null check (settings_version_number >= 1),
      settings_effective_from date not null,
      promotion_mode text not null check (promotion_mode in ('NO_PROMOTIONS', 'POLICIES')),
      booking_date date not null,
      requested_promotion_code text,
      promotion_status text not null check (promotion_status = 'EVALUATED'),
      currency_code char(3) not null,
      gross_accommodation_minor integer not null check (gross_accommodation_minor >= 0),
      gross_extra_guest_minor integer not null check (gross_extra_guest_minor >= 0),
      accommodation_discount_minor integer not null check (accommodation_discount_minor >= 0),
      extra_guest_discount_minor integer not null check (extra_guest_discount_minor >= 0),
      discount_minor integer not null check (discount_minor >= 0),
      discounted_accommodation_minor integer not null check (discounted_accommodation_minor >= 0),
      discounted_extra_guest_minor integer not null check (discounted_extra_guest_minor >= 0),
      inclusive_fee_minor integer not null check (inclusive_fee_minor >= 0),
      exclusive_fee_minor integer not null check (exclusive_fee_minor >= 0),
      fee_minor integer not null check (fee_minor >= 0),
      inclusive_tax_minor integer not null check (inclusive_tax_minor >= 0),
      exclusive_tax_minor integer not null check (exclusive_tax_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      total_minor integer not null check (total_minor >= 0),
      hold_eligible boolean not null,
      created_at timestamptz not null default now(),
      unique (id, quote_id),
      unique (id, property_id, organization_id),
      foreign key (quote_id)
        references quote_commercial_snapshots(quote_id) on delete restrict,
      foreign key (quote_id, property_id, organization_id)
        references quotes(id, property_id, organization_id) on delete restrict,
      foreign key (promotion_settings_version_id, property_id, organization_id)
        references property_promotion_setting_versions(id, property_id, organization_id)
        on delete restrict,
      check (discount_minor = accommodation_discount_minor + extra_guest_discount_minor),
      check (discounted_accommodation_minor = gross_accommodation_minor - accommodation_discount_minor),
      check (discounted_extra_guest_minor = gross_extra_guest_minor - extra_guest_discount_minor),
      check (fee_minor = inclusive_fee_minor + exclusive_fee_minor),
      check (tax_minor = inclusive_tax_minor + exclusive_tax_minor),
      check (
        total_minor =
          discounted_accommodation_minor +
          discounted_extra_guest_minor +
          exclusive_fee_minor +
          exclusive_tax_minor
      ),
      check (hold_eligible = true)
    )
  `.execute(db);

  await sql`
    create table quote_promotion_lines (
      id uuid primary key default gen_random_uuid(),
      quote_promotion_snapshot_id uuid not null,
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      promotion_campaign_id uuid not null,
      promotion_campaign_version_id uuid not null,
      promotion_assignment_id uuid not null,
      campaign_code text not null,
      campaign_name text not null,
      promotion_kind text not null check (promotion_kind in ('AUTOMATIC', 'PROMO_CODE')),
      public_code text,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      currency_code char(3) not null,
      booking_window_start date,
      booking_window_end date,
      arrival_window_start date,
      arrival_window_end date,
      minimum_stay_nights integer not null check (minimum_stay_nights between 1 and 365),
      minimum_spend_minor integer,
      discount_type text not null check (discount_type in ('PERCENTAGE', 'FIXED_AMOUNT')),
      discount_value integer not null check (discount_value > 0),
      maximum_discount_minor integer,
      applies_to text not null check (
        applies_to in ('ACCOMMODATION', 'ACCOMMODATION_AND_EXTRA_GUEST')
      ),
      priority integer not null check (priority between 0 and 100000),
      stacking_mode text not null check (stacking_mode in ('EXCLUSIVE', 'STACKABLE')),
      stack_group text,
      assignment_scope_type text not null check (
        assignment_scope_type in ('PROPERTY', 'RATE_PLAN', 'RATE_PRODUCT')
      ),
      assignment_rate_plan_id uuid,
      assignment_rate_product_id uuid,
      assignment_effective_from date not null,
      discount_basis_minor integer not null check (discount_basis_minor >= 0),
      accommodation_discount_minor integer not null check (accommodation_discount_minor >= 0),
      extra_guest_discount_minor integer not null check (extra_guest_discount_minor >= 0),
      discount_minor integer not null check (discount_minor > 0),
      created_at timestamptz not null default now(),
      unique (quote_id, promotion_campaign_id),
      foreign key (quote_promotion_snapshot_id, quote_id)
        references quote_promotion_snapshots(id, quote_id) on delete restrict,
      foreign key (promotion_campaign_id, property_id, organization_id)
        references promotion_campaigns(id, property_id, organization_id) on delete restrict,
      foreign key (promotion_campaign_version_id, property_id, organization_id)
        references promotion_campaign_versions(id, property_id, organization_id) on delete restrict,
      foreign key (promotion_assignment_id)
        references promotion_assignments(id) on delete restrict,
      check (discount_minor = accommodation_discount_minor + extra_guest_discount_minor),
      check (discount_minor <= discount_basis_minor)
    )
  `.execute(db);

  await sql`
    create table quote_final_fee_lines (
      id uuid primary key default gen_random_uuid(),
      quote_promotion_snapshot_id uuid not null,
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      line_key text not null,
      fee_policy_id uuid not null,
      fee_policy_version_id uuid not null,
      fee_policy_code text not null,
      fee_policy_name text not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      stay_date date,
      calculation_type text not null check (calculation_type in ('FIXED', 'PERCENTAGE')),
      application_basis text not null check (
        application_basis in (
          'PER_STAY',
          'PER_NIGHT',
          'PER_UNIT_PER_STAY',
          'PER_UNIT_PER_NIGHT',
          'STAY_CHARGES'
        )
      ),
      amount_minor_snapshot integer,
      rate_basis_points_snapshot integer,
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      taxable boolean not null,
      tax_policy_id uuid,
      multiplier integer not null check (multiplier >= 1),
      fee_minor integer not null check (fee_minor >= 0),
      created_at timestamptz not null default now(),
      unique (quote_id, line_key),
      unique (id, quote_id),
      foreign key (quote_promotion_snapshot_id, quote_id)
        references quote_promotion_snapshots(id, quote_id) on delete restrict,
      foreign key (fee_policy_id, property_id, organization_id)
        references commercial_fee_policies(id, property_id, organization_id) on delete restrict,
      foreign key (fee_policy_version_id, property_id, organization_id)
        references commercial_fee_policy_versions(id, property_id, organization_id)
        on delete restrict,
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      check (
        (calculation_type = 'FIXED' and amount_minor_snapshot is not null and rate_basis_points_snapshot is null)
        or
        (calculation_type = 'PERCENTAGE' and amount_minor_snapshot is null and rate_basis_points_snapshot is not null)
      ),
      check (
        (taxable and tax_policy_id is not null)
        or
        (not taxable and tax_policy_id is null)
      )
    )
  `.execute(db);

  await sql`
    create table quote_final_tax_lines (
      id uuid primary key default gen_random_uuid(),
      quote_promotion_snapshot_id uuid not null,
      quote_id uuid not null,
      organization_id uuid not null,
      property_id uuid not null,
      tax_policy_id uuid not null,
      tax_policy_version_id uuid not null,
      tax_policy_code text not null,
      tax_policy_name text not null,
      version_number integer not null check (version_number >= 1),
      effective_from date not null,
      component_code text not null,
      component_name text not null,
      rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
      price_mode text not null check (price_mode in ('EXCLUSIVE', 'INCLUSIVE')),
      charge_type text not null check (charge_type in ('ACCOMMODATION', 'EXTRA_GUEST', 'FEE')),
      stay_date date,
      final_fee_line_id uuid,
      taxable_basis_minor integer not null check (taxable_basis_minor >= 0),
      tax_minor integer not null check (tax_minor >= 0),
      created_at timestamptz not null default now(),
      foreign key (quote_promotion_snapshot_id, quote_id)
        references quote_promotion_snapshots(id, quote_id) on delete restrict,
      foreign key (tax_policy_id, property_id, organization_id)
        references commercial_tax_policies(id, property_id, organization_id) on delete restrict,
      foreign key (tax_policy_version_id, property_id, organization_id)
        references commercial_tax_policy_versions(id, property_id, organization_id)
        on delete restrict,
      foreign key (final_fee_line_id, quote_id)
        references quote_final_fee_lines(id, quote_id) on delete restrict,
      check (
        (charge_type = 'FEE' and final_fee_line_id is not null)
        or
        (charge_type <> 'FEE' and final_fee_line_id is null)
      )
    )
  `.execute(db);

  await sql`
    create index quote_promotion_lines_quote_idx on quote_promotion_lines (quote_id, priority desc)
  `.execute(db);
  await sql`
    create index quote_final_fee_lines_quote_idx on quote_final_fee_lines (quote_id, stay_date)
  `.execute(db);
  await sql`
    create index quote_final_tax_lines_quote_idx on quote_final_tax_lines (quote_id, stay_date)
  `.execute(db);

  for (const table of [
    "quote_promotion_snapshots",
    "quote_promotion_lines",
    "quote_final_fee_lines",
    "quote_final_tax_lines"
  ]) {
    await sql
      .raw(
        `
        create trigger ${table}_no_mutation
          before update or delete on ${table}
          for each row execute function prevent_quote_snapshot_mutation()
      `
      )
      .execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "quote_final_tax_lines",
    "quote_final_fee_lines",
    "quote_promotion_lines",
    "quote_promotion_snapshots"
  ]) {
    await sql.raw(`drop trigger if exists ${table}_no_mutation on ${table}`).execute(db);
  }

  await sql`drop table if exists quote_final_tax_lines`.execute(db);
  await sql`drop table if exists quote_final_fee_lines`.execute(db);
  await sql`drop table if exists quote_promotion_lines`.execute(db);
  await sql`drop table if exists quote_promotion_snapshots`.execute(db);
}
