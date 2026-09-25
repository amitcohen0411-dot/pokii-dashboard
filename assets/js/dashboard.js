import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, shortDate, escapeHtml } from "./format.js";
import { getDefaultValueMultiplier, estimatedValueFor, getInTransitQuantities } from "./inventoryMatch.js";

const STUCK_ORDER_DAYS = 14;
const SLOW_MOVER_DAYS = 21;

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("dashboard.html");

  document.getElementById("reminder-add-btn").addEventListener("click", addReminder);
  document.getElementById("reminder-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addReminder();
  });
  document.getElementById("adj-save-btn").addEventListener("click", saveAdjustment);

  try {
    await Promise.all([
      loadUrgentAlerts(),
      loadBalances(),
      loadInventoryValue(),
      loadInTransit(),
      loadMonthNumbers(),
      loadNeedsAttention(),
      loadReminders(),
      loadRecentActivity(),
      loadMarketAlerts(),
    ]);
  } catch (err) {
    const el = document.getElementById("load-error");
    el.style.display = "block";
    el.textContent = "Couldn't load some numbers: " + err.message;
  }
}

// Time-critical action items (e.g. "pay this forwarder before the package is
// abandoned") get their own bold banner at the very top of the dashboard —
// separate from the "Deals & drops" card, which is informational, not
// something that costs money if ignored.
async function loadUrgentAlerts() {
  const { data, error } = await supabase
    .from("market_alerts")
    .select("id, title, description, url")
    .eq("kind", "urgent")
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false });
  if (error) throw error;

  const container = document.getElementById("urgent-alerts");
  if (!data.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = data
    .map(
      (a) => `<div class="urgent-banner">
        <div class="title">⚠️ ${escapeHtml(a.title)}</div>
        ${a.description ? `<p class="meta" style="margin:6px 0">${escapeHtml(a.description)}</p>` : ""}
        <div class="btn-row" style="margin-top:8px">
          ${a.url ? `<a class="btn secondary" href="${escapeHtml(a.url)}">Handle this now</a>` : ""}
          <button type="button" class="btn secondary urgent-dismiss" data-id="${a.id}">Dismiss</button>
        </div>
      </div>`,
    )
    .join("");

  container.querySelectorAll(".urgent-dismiss").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("market_alerts").update({ dismissed: true }).eq("id", btn.dataset.id);
      loadUrgentAlerts();
    });
  });
}

// Plain free-text to-do list, not tied to anything else in the app — just a
// place for "list the new haul," "pay Redbox," etc. to live on the page you
// already open every day, instead of nowhere.
async function loadReminders() {
  const { data, error } = await supabase
    .from("reminders")
    .select("id, text, done")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const container = document.getElementById("reminders-list");
  if (!data.length) {
    container.innerHTML = `<p class="hint">Nothing on your list.</p>`;
    return;
  }
  container.innerHTML = data
    .map(
      (r) => `<div class="list-row">
        <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
          <input type="checkbox" class="reminder-toggle" data-id="${r.id}" ${r.done ? "checked" : ""} />
          <span style="${r.done ? "text-decoration:line-through;color:var(--text-muted)" : ""}">${escapeHtml(r.text)}</span>
        </label>
        <button type="button" class="remove-btn reminder-delete" data-id="${r.id}">remove</button>
      </div>`,
    )
    .join("");

  container.querySelectorAll(".reminder-toggle").forEach((cb) => {
    cb.addEventListener("change", async () => {
      await supabase.from("reminders").update({ done: cb.checked }).eq("id", cb.dataset.id);
      loadReminders();
    });
  });
  container.querySelectorAll(".reminder-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("reminders").delete().eq("id", btn.dataset.id);
      loadReminders();
    });
  });
}

async function addReminder() {
  const input = document.getElementById("reminder-input");
  const text = input.value.trim();
  if (!text) return;
  await supabase.from("reminders").insert({ text });
  input.value = "";
  loadReminders();
}

// A manual, human-initiated balance change — e.g. cash received as a gift,
// or correcting a count mismatch. Posted as a normal `adjustment`-kind
// transaction (the same kind already used when a cancelled purchase refunds
// its cash-out) so it flows through account_balances the same way every
// other transaction does; the required reason is what marks it as a
// deliberate manual entry rather than something the app computed on its own.
async function saveAdjustment() {
  const errorEl = document.getElementById("adj-error");
  errorEl.style.display = "none";
  const account = document.getElementById("adj-account").value;
  const amount = Number(document.getElementById("adj-amount").value);
  const reason = document.getElementById("adj-reason").value.trim();

  if (!amount) {
    errorEl.textContent = "Enter a non-zero amount.";
    errorEl.style.display = "block";
    return;
  }
  if (!reason) {
    errorEl.textContent = "A reason is required for every manual balance adjustment.";
    errorEl.style.display = "block";
    return;
  }
  try {
    await supabase.from("transactions").insert({ account, amount, kind: "adjustment", note: reason });
    document.getElementById("adj-amount").value = "";
    document.getElementById("adj-reason").value = "";
    await loadBalances();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function loadBalances() {
  const { data, error } = await supabase.from("account_balances").select("*");
  if (error) throw error;
  const bit = data.find((r) => r.id === "bit");
  const cash = data.find((r) => r.id === "cash");
  const card = data.find((r) => r.id === "card");
  document.getElementById("bal-bit").textContent = money(bit?.current_balance ?? 0);
  document.getElementById("bal-cash").textContent = money(cash?.current_balance ?? 0);
  document.getElementById("bal-card").textContent = money(card?.current_balance ?? 0);
}

async function loadInventoryValue() {
  const [{ data, error }, multiplier, inTransitQty] = await Promise.all([
    supabase.from("inventory_items").select("id, quantity, avg_item_cost, estimated_value"),
    getDefaultValueMultiplier(),
    getInTransitQuantities(),
  ]);
  if (error) throw error;
  let total = 0;
  let transitValue = 0;
  for (const row of data) {
    const unitValue = estimatedValueFor(row, multiplier);
    total += row.quantity * unitValue;
    const transitQty = Math.min(inTransitQty.get(row.id) || 0, row.quantity);
    transitValue += transitQty * unitValue;
  }
  document.getElementById("inv-value").textContent = money(total);
  const splitEl = document.getElementById("inv-value-split");
  splitEl.textContent = transitValue > 0 ? `${money(total - transitValue)} home · ${money(transitValue)} in transit` : "";
}

// Mirrors orders.js's deriveState: a purchase counts as "in transit" (value
// not yet physically in hand) unless it's fully received — which, once a
// forwarder is involved, means the *forwarder shipment* arrived, not just
// that the seller's leg did.
function isFullyReceived(p) {
  if (!p.forwarder) return p.status === "received";
  if (!p.forwarder_shipments) return false;
  return Boolean(p.forwarder_shipments.received_at);
}

async function loadInTransit() {
  const { data, error } = await supabase
    .from("purchases")
    .select("total_amount, status, forwarder, forwarder_shipments(received_at)")
    .neq("status", "cancelled");
  if (error) throw error;
  const total = data.filter((p) => !isFullyReceived(p)).reduce((sum, row) => sum + Number(row.total_amount), 0);
  document.getElementById("in-transit").textContent = money(total);
}

function firstOfMonthISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

async function loadMonthNumbers() {
  const monthStart = firstOfMonthISO();

  // Spend = actual cash out this month, from the ledger — this includes both
  // purchase cost and any forwarder shipping paid this month (which can land
  // in a different month than the purchase itself).
  const { data: spendTx, error: spendErr } = await supabase
    .from("transactions")
    .select("amount, kind")
    .in("kind", ["purchase", "shipping"])
    .gte("occurred_at", monthStart);
  if (spendErr) throw spendErr;
  const spend = spendTx.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
  document.getElementById("month-spend").textContent = money(spend);

  const { data: soldLines, error: salesErr } = await supabase
    .from("sale_line_items")
    .select("quantity, unit_price, unit_cost_basis, sales!inner(sale_date)")
    .gte("sales.sale_date", monthStart);
  if (salesErr) throw salesErr;

  const revenue = soldLines.reduce((sum, row) => sum + row.quantity * Number(row.unit_price), 0);
  const cogs = soldLines.reduce((sum, row) => sum + row.quantity * Number(row.unit_cost_basis), 0);
  document.getElementById("month-revenue").textContent = money(revenue);

  const profitEl = document.getElementById("month-profit");
  profitEl.textContent = money(revenue - cogs);
  profitEl.className = "stat-value " + (revenue - cogs >= 0 ? "positive" : "negative");
}

function daysAgo(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

const FORWARDER_LABEL = { redbox: "Redbox", myus: "MyUS", other: "forwarder" };

// Everything that used to be four separate cards (stuck orders, slow movers,
// unpaid shipments, overdue shipments) collapsed into one "Needs attention"
// list — same underlying queries, just one place to scan instead of four
// mostly-empty boxes taking up the page.
async function loadNeedsAttention() {
  const stuckCutoff = new Date(Date.now() - STUCK_ORDER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slowCutoff = new Date(Date.now() - SLOW_MOVER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [stuckRes, slowRes, unpaidRes, overdueRes, priceReviewRes, multiplier] = await Promise.all([
    supabase
      .from("purchases")
      .select("id, source, order_date, status, total_amount")
      .in("status", ["ordered", "shipped"])
      .lte("order_date", stuckCutoff)
      .order("order_date")
      .limit(5),
    supabase
      .from("inventory_items")
      .select("id, name, quantity, avg_item_cost, estimated_value, updated_at")
      .gt("quantity", 0)
      .lte("updated_at", slowCutoff)
      .order("updated_at")
      .limit(5),
    supabase.from("forwarder_shipments").select("id, forwarder, shipping_cost, created_at").eq("payment_status", "unpaid").order("created_at").limit(5),
    supabase
      .from("forwarder_shipments")
      .select("id, forwarder, tracking_number, expected_arrival_date")
      .is("received_at", null)
      .not("expected_arrival_date", "is", null)
      .lt("expected_arrival_date", today)
      .order("expected_arrival_date")
      .limit(5),
    supabase.from("inventory_items").select("id, name, details").contains("details", { needs_price_review: true }).limit(10),
    getDefaultValueMultiplier(),
  ]);
  for (const r of [stuckRes, slowRes, unpaidRes, overdueRes, priceReviewRes]) if (r.error) throw r.error;

  const rows = [];
  priceReviewRes.data.forEach((item) =>
    rows.push({
      badge: "Needs a price",
      title: item.name,
      meta: item.details?.price_review_reason || "Couldn't be priced automatically",
      href: `inventory.html?id=${item.id}`,
    }),
  );
  unpaidRes.data.forEach((s) =>
    rows.push({
      badge: "Unpaid shipment",
      title: FORWARDER_LABEL[s.forwarder],
      meta: `created ${shortDate(s.created_at)}`,
      amount: money(s.shipping_cost),
      negative: true,
      href: "orders.html",
    }),
  );
  overdueRes.data.forEach((s) =>
    rows.push({
      badge: "Running late",
      title: FORWARDER_LABEL[s.forwarder] + (s.tracking_number ? ` · ${s.tracking_number}` : ""),
      meta: `expected ${shortDate(s.expected_arrival_date)}`,
      href: "orders.html",
    }),
  );
  stuckRes.data.forEach((p) =>
    rows.push({
      badge: "Needs a status update",
      title: p.source || "Purchase",
      meta: `${shortDate(p.order_date)} · ${daysAgo(p.order_date)}d ago · ${p.status}`,
      amount: money(p.total_amount),
      href: `purchases.html?id=${p.id}`,
    }),
  );
  slowRes.data.forEach((item) =>
    rows.push({
      badge: "Sitting 21+ days",
      title: item.name,
      meta: `${daysAgo(item.updated_at)}d in stock · ${item.quantity} units`,
      amount: money(item.quantity * estimatedValueFor(item, multiplier)),
      href: "inventory.html",
    }),
  );

  const container = document.getElementById("needs-attention-list");
  if (!rows.length) {
    container.innerHTML = `<p class="hint">Nothing needs your attention right now.</p>`;
    return;
  }
  container.innerHTML = rows
    .map(
      (r) => `<a class="list-row" href="${r.href}" style="text-decoration:none;color:inherit">
        <div>
          <div class="title">${escapeHtml(r.title)} <span class="badge badge-edited">${r.badge}</span></div>
          <div class="meta">${escapeHtml(r.meta)}</div>
        </div>
        ${r.amount ? `<div class="title${r.negative ? " negative" : ""}">${r.amount}</div>` : ""}
      </a>`,
    )
    .join("");
}

const ACTIVITY_LABEL = { purchase: "Purchase", sale: "Sale", shipping: "Shipping paid", adjustment: "Adjustment" };

// A plain "what happened most recently" feed pulled straight from the cash
// ledger — the one place every kind of money movement already lands, so it
// doubles as an activity log for free.
async function loadRecentActivity() {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, account, amount, kind, note, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(8);
  if (error) throw error;

  const container = document.getElementById("recent-activity-list");
  if (!data.length) {
    container.innerHTML = `<p class="hint">Nothing yet.</p>`;
    return;
  }
  container.innerHTML = data
    .map(
      (t) => `<div class="list-row">
        <div>
          <div class="title">${ACTIVITY_LABEL[t.kind] || t.kind} <span class="meta">· ${escapeHtml(t.account)}</span></div>
          <div class="meta">${shortDate(t.occurred_at)}${t.note ? ` · ${escapeHtml(t.note)}` : ""}</div>
        </div>
        <div class="title ${Number(t.amount) < 0 ? "negative" : "positive"}">${money(t.amount)}</div>
      </div>`,
    )
    .join("");
}

const ALERT_KIND_LABEL = { coupon: "Coupon", deal: "Deal", drop: "New drop" };

async function loadMarketAlerts() {
  const { data, error } = await supabase
    .from("market_alerts")
    .select("id, kind, title, description, url, expires_at")
    .in("kind", ["coupon", "deal", "drop"])
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false })
    .limit(8);
  if (error) throw error;
  if (!data.length) {
    document.getElementById("market-alerts-card").style.display = "none";
    return;
  }

  document.getElementById("market-alerts-card").style.display = "block";
  document.getElementById("market-alerts-list").innerHTML = data
    .map(
      (a) => `<div class="list-row">
        <div>
          <div class="title">${escapeHtml(a.title)} <span class="badge badge-human">${ALERT_KIND_LABEL[a.kind] || a.kind}</span></div>
          <div class="meta">${escapeHtml(a.description || "")}${a.expires_at ? ` · expires ${shortDate(a.expires_at)}` : ""}</div>
          ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">View →</a>` : ""}
        </div>
        <button type="button" class="remove-btn alert-dismiss" data-id="${a.id}">dismiss</button>
      </div>`,
    )
    .join("");

  document.querySelectorAll(".alert-dismiss").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("market_alerts").update({ dismissed: true }).eq("id", btn.dataset.id);
      loadMarketAlerts();
    });
  });
}

main();
