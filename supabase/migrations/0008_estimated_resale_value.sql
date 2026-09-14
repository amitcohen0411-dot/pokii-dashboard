-- Cost basis (avg_unit_cost, landed cost incl. shipping) stays exactly as-is —
-- it feeds real profit/COGS math when something sells and must stay accurate
-- to what was actually paid. "Inventory value" on the dashboard is a
-- different question (what the stock is worth, not what it cost), so it
-- gets its own fields instead of overloading avg_unit_cost.
alter table inventory_items
  add column avg_item_cost numeric(10,2) not null default 0,  -- weighted-avg item price only, excl. shipping/fees
  add column estimated_value numeric(10,2);                    -- manual resale estimate; null = use the default multiplier

insert into app_settings (key, value) values ('default_value_multiplier', '1.9')
  on conflict (key) do nothing;
