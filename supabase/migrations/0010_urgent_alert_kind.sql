-- Lets market_alerts also carry time-critical action items (e.g. "pay this
-- forwarder before the package is declared abandoned"), not just deals. The
-- dashboard renders `kind = 'urgent'` as a bold banner at the very top,
-- separate from the "Deals & drops" card which only shows coupon/deal/drop.
alter table market_alerts drop constraint market_alerts_kind_check;
alter table market_alerts add constraint market_alerts_kind_check
  check (kind in ('coupon', 'deal', 'drop', 'urgent'));
