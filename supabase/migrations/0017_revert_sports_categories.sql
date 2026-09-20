-- Reverts 0016: the user decided sports cards (like football jerseys before
-- them) shouldn't be tracked in this dashboard's inventory at all — they're
-- a separate personal interest, not part of the Funko/Pokémon resale
-- business this app tracks. The two already-sold sports-card rows are
-- recategorized to 'other' (their sale history stays intact) rather than
-- deleted, since deleting them would orphan real sale_line_items.
alter table inventory_items drop constraint inventory_items_category_check;
alter table inventory_items add constraint inventory_items_category_check
  check (category = any (array['funko','pokemon_card','other']));
