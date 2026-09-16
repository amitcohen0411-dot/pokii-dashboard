-- A sale had no field of its own to label it with — only "channel," which
-- often goes unfilled, leaving the sales list showing a generic "Sale" for
-- everything. `name` is a short, optional label the user sets by hand
-- (distinct from the AI-facing "note" field), shown as the title in the
-- sales list and detail view before falling back to channel/"Sale".
alter table sales add column name text;

-- Simple free-text reminders shown on the dashboard — not tied to any other
-- table, just a small to-do list for things like "list the new Funko haul"
-- or "pay Redbox." Check one off (or delete it) from the dashboard card.
create table reminders (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table reminders enable row level security;
create policy "authenticated full access" on reminders
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
