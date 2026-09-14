export function money(amount) {
  const n = Number(amount ?? 0);
  return "₪" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const CURRENCY_SYMBOLS = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };

export function foreignMoney(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || currency + " ";
  const n = Number(amount ?? 0);
  return symbol + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// A purchase's stored amounts are always ILS (converted at entry time via
// fx_rate) — this reconstructs "what it actually cost in the original
// currency" for display, e.g. "$23.00 → ₪83.95 (rate 3.65)".
export function fxLine(ilsAmount, currency, fxRate) {
  if (!currency || currency === "ILS" || !fxRate || fxRate === 1) return money(ilsAmount);
  const original = Number(ilsAmount) / Number(fxRate);
  return `${foreignMoney(original, currency)} → ${money(ilsAmount)} (rate ${Number(fxRate).toFixed(4)})`;
}

export function shortDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// source is one of: "ai" | "human" | "edited" | "missing"
export function sourceBadge(source) {
  const map = {
    ai: { label: "AI", cls: "badge-ai" },
    human: { label: "you", cls: "badge-human" },
    edited: { label: "edited", cls: "badge-edited" },
    missing: { label: "missing", cls: "badge-missing" },
  };
  const entry = map[source] || map.missing;
  return `<span class="badge ${entry.cls}">${entry.label}</span>`;
}

export function statusPill(status) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return `<span class="status-pill status-${status}">${label}</span>`;
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
