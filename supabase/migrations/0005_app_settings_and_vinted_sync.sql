-- Small key/value store for app-wide config that isn't per-record —
-- currently just the manually-set EUR/ILS rate the Vinted email sync uses
-- (no live FX API wired up, by design — see PRD).
create table app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
create policy "authenticated full access" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

insert into app_settings (key, value) values ('vinted_eur_ils_rate', '1');

-- Tags a purchase as having come from the automated Vinted email sync, and
-- records the source email's Vinted transaction ID so re-runs can detect
-- "already imported" without re-parsing every email every time.
alter table purchases add column source_ref text;
create unique index purchases_source_ref_unique on purchases (source_ref) where source_ref is not null;
