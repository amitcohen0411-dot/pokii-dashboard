-- Real Vinted purchase history showed a third payment method in actual use
-- (credit card / Google Pay), distinct from Bit and physical cash.
insert into accounts (id, label, starting_balance) values ('card', 'Card', 0)
  on conflict (id) do nothing;
