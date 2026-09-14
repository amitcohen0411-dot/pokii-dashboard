-- Purchases can be recorded in a foreign currency; items_subtotal, shipping_amount
-- and total_amount stay ILS (converted at entry time via fx_rate) so every
-- downstream sum (dashboard, cash ledger, inventory cost) stays in one currency.
-- The original foreign amount is recoverable as total_amount / fx_rate for display.
alter table purchases
  add column currency text not null default 'ILS',
  add column fx_rate numeric(10,4) not null default 1 check (fx_rate > 0);
