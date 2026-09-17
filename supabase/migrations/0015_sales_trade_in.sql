-- Optional trade-in item received as part of a sale, in addition to (or
-- instead of) cash. Linked to the inventory item it was added as (created at
-- ₪0 cost — it wasn't bought, so it has no cost basis), plus a snapshot of
-- the name/value at the time of the sale so this stays accurate even if the
-- inventory item is later renamed or re-valued.
alter table sales add column trade_inventory_item_id uuid references inventory_items(id);
alter table sales add column trade_item_name text;
alter table sales add column trade_value numeric;
