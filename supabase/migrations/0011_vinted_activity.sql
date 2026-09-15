-- Read-only log of Vinted seller activity that isn't a completed order: offers
-- (sellers proactively offering a lower price, and outcomes of offers made)
-- and message notifications. Sourced from Vinted's own notification emails
-- via the scheduled sync (same pattern as the Vinted purchase-receipt sync) —
-- there's no Vinted API, so this can't be interactive (no reply/accept from
-- here), it's a browsing aid so nothing gets missed in the inbox.
create table vinted_activity (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('offer_received', 'offer_accepted', 'offer_rejected', 'message')),
  item_name text not null,
  counterparty text,
  amount numeric(10,2),
  snippet text,
  account_hint text,
  occurred_at timestamptz not null,
  source_ref text,
  currency text default 'EUR'
);

create unique index vinted_activity_source_ref_unique on vinted_activity (source_ref) where source_ref is not null;
create index vinted_activity_occurred_at on vinted_activity (occurred_at desc);

alter table vinted_activity enable row level security;
create policy "authenticated full access" on vinted_activity
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
