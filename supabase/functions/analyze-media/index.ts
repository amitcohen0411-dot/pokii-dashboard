// Supabase Edge Function: analyze-media
//
// Downloads a purchase/sale photo or video from the private "media" storage
// bucket, sends it to the Gemini API for structured extraction, logs the raw
// response, and returns a DRAFT the client must review before writing
// anything to purchases/sales/inventory. This function never writes to those
// tables itself.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
// "latest" aliases are kept pointed at Google's current recommended models,
// so these don't go stale the way a pinned version number would. The "lite"
// variant is noticeably cheaper and plenty accurate for reading receipts /
// price tags at this app's volume; the full "flash" model was intermittently
// overloaded (503) when this was tested.
const GEMINI_MODEL = "gemini-flash-lite-latest";

const EXTRACTION_PROMPT = `You are looking at a photo or video of collectible items (Funko Pops and/or Pokémon cards) being purchased or sold, possibly with a receipt, price tags, or discount stickers visible.

Return ONLY valid JSON (no markdown fences, no commentary) matching exactly this shape:
{
  "items": [
    {
      "name": "string — best guess at the specific item, e.g. 'Charizard EX 183/165' or 'Funko Pop Batman #144'",
      "category": "funko" | "pokemon_card" | "other",
      "quantity": integer,
      "unit_price": number or null — only if a price is actually visible in the image/video,
      "discount_percent": number or null — only if a discount is actually visible,
      "confidence": number between 0 and 1
    }
  ],
  "shipping_amount": number or null — only if visible on a receipt,
  "total_amount": number or null — only if visible on a receipt,
  "currency": "string or null — the 3-letter currency code implied by symbols/text shown (e.g. 'USD' for $, 'EUR' for €, 'GBP' for £, 'ILS' for ₪), or null if genuinely not shown",
  "confidence_notes": "string — anything unclear or ambiguous, or empty string"
}

Rules:
- If you cannot see a price, discount, shipping, or total, use null. Never guess a number that isn't actually shown.
- Only set "currency" from an actual symbol or code visible in the image — never assume ILS or any other default.
- If there appear to be multiple identical copies of the same item, reflect that as one line with quantity > 1, not repeated lines.
- Keep "name" specific enough to search for later (character/set/number when visible), but do not invent details you cannot see.`;

// Edge Functions don't add CORS headers on their own, and this function is
// called from the app's own origin (Netlify/GitHub Pages/etc), which differs
// from the Supabase function's origin — so every response needs these.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Verify the caller actually has a valid session (any authenticated user —
  // there is only ever one shared account in this app).
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse(
      { error: "GEMINI_API_KEY is not configured on this Supabase project yet" },
      500,
    );
  }

  let body: { media_path?: string; media_type?: "image" | "video"; mode?: "purchase" | "sale"; hint?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const { media_path, media_type, mode, hint } = body;
  if (!media_path || !media_type) {
    return jsonResponse({ error: "missing media_path or media_type" }, 400);
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("media")
    .download(media_path);
  if (downloadError || !fileData) {
    return jsonResponse({ error: "could not read media from storage", detail: downloadError?.message }, 400);
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const base64Data = base64Encode(new Uint8Array(arrayBuffer));
  // Trust the browser-reported content type from upload (fileData.type) over
  // guessing from media_type — phones commonly record video as .mov, not .mp4.
  const mimeType = fileData.type || (media_type === "video" ? "video/quicktime" : "image/jpeg");

  const prompt = hint ? `${EXTRACTION_PROMPT}\n\nUser note: ${hint}` : EXTRACTION_PROMPT;

  let geminiJson: unknown;
  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return jsonResponse({ error: "gemini request failed", detail: errText }, 502);
    }

    const geminiBody = await geminiRes.json();
    const text = geminiBody?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    geminiJson = JSON.parse(text);
  } catch (err) {
    return jsonResponse({ error: "gemini request failed", detail: String(err) }, 502);
  }

  await supabase.from("ai_extractions").insert({
    media_url: media_path,
    target_type: mode ?? null,
    target_id: null,
    raw_response: geminiJson,
    model: GEMINI_MODEL,
  });

  return jsonResponse(geminiJson, 200);
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
