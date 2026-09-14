-- Pokii Dashboard — initial schema
-- One shared identity (Supabase Auth), no per-row ownership: RLS just requires an authenticated session.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table accounts (
  id text primary key,
  label text not null,
  starting_balance numeric(10,2) not null default 0,
  updated_at timestamptz not null default now()
);

insert into accounts (id, label, starting_balance) values
  ('bit', 'Bit', 0),
  ('cash', 'Cash', 0);

-- ---------------------------------------------------------------------------
-- inventory_items
-- ---------------------------------------------------------------------------
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('funko', 'pokemon_card', 'other')),
  details jsonb not null default '{}'::jsonb,
  image_url text,
  quantity integer not null default 0,
  avg_unit_cost numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_name_trgm on inventory_items using gin (name gin_trgm_ops);
create index inventory_items_category on inventory_items (category);

-- ---------------------------------------------------------------------------
-- purchases
-- ---------------------------------------------------------------------------
create table purchases (
  id uuid primary key default gen_random_uuid(),
  source text,
  status text not null default 'ordered' check (status in ('ordered', 'shipped', 'received', 'cancelled')),
  order_date date not null default current_date,
  items_subtotal numeric(10,2) not null default 0,
  shipping_amount numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  payment_account text not null references accounts(id),
  notes text,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  ai_status text not null default 'none' check (ai_status in ('none', 'pending', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchases_status on purchases (status);
create index purchases_order_date on purchases (order_date);

-- ---------------------------------------------------------------------------
-- purchase_line_items
-- ---------------------------------------------------------------------------
create table purchase_line_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  name_raw text not null,
  category text,
  quantity integer not null default 1,
  unit_price numeric(10,2) not null default 0,
  discount_percent numeric(5,2),
  allocated_shipping numeric(10,2) not null default 0,
  unit_cost numeric(10,2) not null default 0,
  field_source jsonb not null default '{}'::jsonb,
  confidence numeric(3,2),
  created_at timestamptz not null default now()
);

create index purchase_line_items_purchase_id on purchase_line_items (purchase_id);
create index purchase_line_items_inventory_item_id on purchase_line_items (inventory_item_id);

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
create table sales (
  id uuid primary key default gen_random_uuid(),
  sale_date date not null default current_date,
  channel text,
  payment_account text not null references accounts(id),
  total_amount numeric(10,2) not null default 0,
  notes text,
  media_url text,
  media_type text check (media_type in ('image', 'video')),
  ai_status text not null default 'none' check (ai_status in ('none', 'pending', 'done', 'failed')),
  created_at timestamptz not null default now()
);

create index sales_sale_date on sales (sale_date);

-- ---------------------------------------------------------------------------
-- sale_line_items
-- ---------------------------------------------------------------------------
create table sale_line_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references sales(id) on delete cascade,
  inventory_item_id uuid references inventory_items(id) on delete set null,
  name_raw text not null,
  quantity integer not null default 1,
  unit_price numeric(10,2) not null default 0,
  unit_cost_basis numeric(10,2) not null default 0,
  field_source jsonb not null default '{}'::jsonb,
  confidence numeric(3,2),
  created_at timestamptz not null default now()
);

create index sale_line_items_sale_id on sale_line_items (sale_id);
create index sale_line_items_inventory_item_id on sale_line_items (inventory_item_id);

-- ---------------------------------------------------------------------------
-- transactions (cash-flow ledger)
-- ---------------------------------------------------------------------------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  account text not null references accounts(id),
  amount numeric(10,2) not null,
  kind text not null check (kind in ('purchase', 'sale', 'adjustment')),
  related_purchase_id uuid references purchases(id) on delete set null,
  related_sale_id uuid references sales(id) on delete set null,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index transactions_account on transactions (account);
create index transactions_occurred_at on transactions (occurred_at);

-- ---------------------------------------------------------------------------
-- ai_extractions (audit log)
-- ---------------------------------------------------------------------------
create table ai_extractions (
  id uuid primary key default gen_random_uuid(),
  media_url text not null,
  target_type text check (target_type in ('purchase', 'sale')),
  target_id uuid,
  raw_response jsonb not null,
  model text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- stock_adjustments (audit trail for manual inventory corrections)
-- ---------------------------------------------------------------------------
create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  quantity_delta integer not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index stock_adjustments_item on stock_adjustments (inventory_item_id);

-- ---------------------------------------------------------------------------
-- account_balances view
-- ---------------------------------------------------------------------------
create view account_balances as
select
  a.id,
  a.label,
  a.starting_balance,
  a.starting_balance + coalesce(sum(t.amount), 0) as current_balance
from accounts a
left join transactions t on t.account = a.id
group by a.id, a.label, a.starting_balance;

-- ---------------------------------------------------------------------------
-- RLS — single shared identity, any authenticated session gets full access
-- ---------------------------------------------------------------------------
alter table accounts enable row level security;
alter table inventory_items enable row level security;
alter table purchases enable row level security;
alter table purchase_line_items enable row level security;
alter table sales enable row level security;
alter table sale_line_items enable row level security;
alter table transactions enable row level security;
alter table ai_extractions enable row level security;
alter table stock_adjustments enable row level security;

create policy "authenticated full access" on accounts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on inventory_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on purchases
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on purchase_line_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on sales
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on sale_line_items
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on ai_extractions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on stock_adjustments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- storage bucket for purchase/sale media
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy "authenticated read media" on storage.objects
  for select using (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "authenticated upload media" on storage.objects
  for insert with check (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "authenticated update media" on storage.objects
  for update using (bucket_id = 'media' and auth.role() = 'authenticated');
create policy "authenticated delete media" on storage.objects
  for delete using (bucket_id = 'media' and auth.role() = 'authenticated');
