-- Splits sports cards out of the generic "other" bucket so they're filterable
-- on their own, alongside funko/pokemon_card/other. Signed football jerseys
-- were considered too, but the user doesn't want those tracked as resale
-- inventory at all (they're removed from inventory_items entirely, purchase
-- records kept for spend history) — no separate category needed for them.
alter table inventory_items drop constraint inventory_items_category_check;
alter table inventory_items add constraint inventory_items_category_check
  check (category = any (array['funko','pokemon_card','sports_card','other']));
