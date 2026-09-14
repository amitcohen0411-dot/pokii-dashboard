import { supabase } from "./supabaseClient.js";
import { SHARED_LOGIN_EMAIL } from "./config.js";

// The UI only ever asks for a "passcode" — under the hood that's the password
// for the one shared Supabase Auth account both partners use.
export async function login(passcode) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: SHARED_LOGIN_EMAIL,
    password: passcode,
  });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = "index.html";
}

// Call at the top of every protected page. Redirects to the login gate if
// there's no active session, otherwise resolves with the session.
export async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.href = "index.html";
    return null;
  }
  return data.session;
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
