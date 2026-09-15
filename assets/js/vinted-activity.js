import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { shortDate, escapeHtml, foreignMoney } from "./format.js";

const $ = (id) => document.getElementById(id);

const KIND_LABEL = {
  offer_received: "Offer from seller",
  offer_accepted: "Offer accepted",
  offer_rejected: "Offer declined",
  message: "Message",
};
const KIND_BADGE_CLASS = {
  offer_received: "badge-ai",
  offer_accepted: "badge-human",
  offer_rejected: "badge-missing",
  message: "badge-edited",
};

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("vinted-activity.html");

  $("kind-filter").addEventListener("change", loadList);
  await loadList();
}

async function loadList() {
  const kind = $("kind-filter").value;
  const container = $("activity-list");

  let q = supabase.from("vinted_activity").select("*").order("occurred_at", { ascending: false }).limit(100);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;

  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">Nothing synced yet — the daily sync picks up new offers and messages from Vinted's emails.</div>`;
    return;
  }

  container.innerHTML = data
    .map(
      (a) => `<div class="list-row">
        <div>
          <div class="title">${escapeHtml(a.item_name)} <span class="badge ${KIND_BADGE_CLASS[a.kind]}">${KIND_LABEL[a.kind]}</span></div>
          <div class="meta">
            ${a.counterparty ? `${escapeHtml(a.counterparty)} · ` : ""}${shortDate(a.occurred_at)}${a.account_hint ? ` · ${escapeHtml(a.account_hint)}` : ""}
          </div>
          ${a.snippet ? `<div class="meta">${escapeHtml(a.snippet)}</div>` : ""}
        </div>
        ${a.amount != null ? `<div class="title">${foreignMoney(a.amount, a.currency || "EUR")}</div>` : ""}
      </div>`,
    )
    .join("");
}

main();
