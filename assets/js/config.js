// Fill these in once the Supabase project exists (Project Settings → API).
// Both values are safe to expose in the browser — real protection comes from
// Row Level Security + requiring a signed-in session (see supabase/migrations/0001_init.sql).
export const SUPABASE_URL = "https://mwljwnlufhiuvvmcevzf.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13bGp3bmx1ZmhpdXZ2bWNldnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNDY0MDgsImV4cCI6MjEwNDkyMjQwOH0.Zg1e7VG6Nf6PaCcb-8Lz0zVj70wVXPyv7sibrQK4jho";

// The single shared login used by both partners (see README.md for how this
// account is created). Only the passcode is ever typed in the UI.
export const SHARED_LOGIN_EMAIL = "team@pokii.local";
