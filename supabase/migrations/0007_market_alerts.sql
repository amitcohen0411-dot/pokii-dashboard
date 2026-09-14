-- Deals/coupons/new-product-drop findings surfaced by the recurring Pokémon
-- card / Funko market scan (run by the scheduled sync, not the app itself —
-- see PRD). Shown as a dashboard card; dismissible so old ones don't pile up.
create table market_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('coupon', 'deal', 'drop')),
  title text not null,
  description text,
  url text,
  source text,
  discovered_at timestamptz not null default now(),
  expires_at date,
  dismissed boolean not null default false
);

create index market_alerts_dismissed on market_alerts (dismissed, discovered_at desc);

alter table market_alerts enable row level security;
create policy "authenticated full access" on market_alerts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
