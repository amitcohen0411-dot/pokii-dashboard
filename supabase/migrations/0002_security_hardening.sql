-- Fixes found by Supabase's advisor after the initial migration:
-- 1. account_balances defaulted to running with the view owner's privileges,
--    which could bypass the RLS policies on the underlying tables entirely.
-- 2. pg_trgm was installed in the public schema (Supabase best practice is a
--    dedicated schema).

alter view account_balances set (security_invoker = true);

drop index if exists inventory_items_name_trgm;
drop extension if exists pg_trgm;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index inventory_items_name_trgm on inventory_items using gin (name extensions.gin_trgm_ops);
