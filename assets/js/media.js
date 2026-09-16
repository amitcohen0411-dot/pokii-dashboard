import { supabase } from "./supabaseClient.js";

// Gemini's inline-data request limit is ~20MB after base64 (~33% inflation),
// so keep raw uploads comfortably under that.
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

// Uploads a photo/video into the private "media" bucket under
// {kind}s/{uuid}-{filename}, returns the storage path to store on the row.
export async function uploadMedia(file, kind) {
  const path = `${kind}s/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from("media").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export function mediaTypeFromFile(file) {
  return file.type.startsWith("video") ? "video" : "image";
}

// Calls the analyze-media edge function. Returns the draft extraction JSON.
// Never writes to the database itself — the caller must let the human review
// and confirm before saving anything.
export async function analyzeMedia({ mediaPath, mediaType, mode, hint }) {
  const { data, error } = await supabase.functions.invoke("analyze-media", {
    body: { media_path: mediaPath, media_type: mediaType, mode, hint },
  });
  if (error) throw error;
  return data;
}

// A stored "path" is normally a private-bucket object key, but an inventory
// item's photo can also be a plain external URL (e.g. pulled from the
// user's own storefront) — pass those straight through instead of trying
// to sign them as a storage path.
export async function getMediaSignedUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  const { data, error } = await supabase.storage.from("media").createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
