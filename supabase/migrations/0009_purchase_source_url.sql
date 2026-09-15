-- Optional link back to the original listing/order (e.g. the Vinted item
-- page, an eBay order, an Amazon order) so a purchase can be opened straight
-- from the dashboard instead of hunting through the marketplace by hand.
alter table purchases add column source_url text;
