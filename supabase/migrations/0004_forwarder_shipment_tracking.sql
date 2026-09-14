-- Two-leg shipping support: many purchases route through a US freight
-- forwarder (Redbox, MyUS) before reaching the user in one consolidated
-- outbound shipment. purchases.status/tracking_number covers leg 1
-- (seller -> forwarder, or seller -> user directly when forwarder is null);
-- forwarder_shipments covers leg 2 (forwarder -> user), including the
-- separate payment for that leg.

create table forwarder_shipments (
  id uuid primary key default gen_random_uuid(),
  forwarder text not null check (forwarder in ('redbox', 'myus', 'other')),
  tracking_number text,
  carrier text,
  shipping_cost numeric(10,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  paid_at timestamptz,
  shipped_at date,
  expected_arrival_date date,
  received_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table purchases
  add column forwarder text check (forwarder in ('redbox', 'myus', 'other')),
  add column tracking_number text,
  add column forwarder_shipment_id uuid references forwarder_shipments(id) on delete set null;

alter table transactions
  add column related_forwarder_shipment_id uuid references forwarder_shipments(id) on delete set null;

alter table transactions drop constraint transactions_kind_check;
alter table transactions add constraint transactions_kind_check
  check (kind in ('purchase', 'sale', 'adjustment', 'shipping'));

create index purchases_forwarder_shipment_id on purchases (forwarder_shipment_id);
create index forwarder_shipments_payment_status on forwarder_shipments (payment_status);

alter table forwarder_shipments enable row level security;
create policy "authenticated full access" on forwarder_shipments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
