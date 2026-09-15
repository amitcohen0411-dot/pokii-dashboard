import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, shortDate, escapeHtml } from "./format.js";
import { getDefaultValueMultiplier, estimatedValueFor } from "./inventoryMatch.js";

const STUCK_ORDER_DAYS = 14;
const SLOW_MOVER_DAYS = 21;

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("dashboard.html");

  try {
    await Promise.all([
      loadUrgentAlerts(),
      loadBalances(),
      loadInventoryValue(),
      loadInTransit(),
      loadMonthNumbers(),
      loadStuckOrders(),
      loadSlowMovers(),
      loadUnpaidShipments(),
      loadOverdueShipments(),
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
  const [{ data, error }, multiplier] = await Promise.all([
    supabase.from("inventory_items").select("quantity, avg_item_cost, estimated_value"),
    getDefaultValueMultiplier(),
  ]);
  if (error) throw error;
  const total = data.reduce((sum, row) => sum + row.quantity * estimatedValueFor(row, multiplier), 0);
  document.getElementById("inv-value").textContent = money(total);
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

async function loadStuckOrders() {
  const cutoff = new Date(Date.now() - STUCK_ORDER_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("purchases")
    .select("id, source, order_date, status, total_amount")
    .in("status", ["ordered", "shipped"])
    .lte("order_date", cutoff)
    .order("order_date")
    .limit(5);
  if (error) throw error;
  if (!data.length) return;

  document.getElementById("stuck-orders-card").style.display = "block";
  document.getElementById("stuck-orders-list").innerHTML = data
    .map(
      (p) => `<div class="list-row">
        <div>
          <div class="title">${escapeHtml(p.source || "Purchase")}</div>
          <div class="meta">${shortDate(p.order_date)} · ${daysAgo(p.order_date)}d ago · ${p.status}</div>
        </div>
        <div class="title">${money(p.total_amount)}</div>
      </div>`,
    )
    .join("");
}

async function loadSlowMovers() {
  const cutoff = new Date(Date.now() - SLOW_MOVER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [{ data, error }, multiplier] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("id, name, quantity, avg_item_cost, estimated_value, updated_at")
      .gt("quantity", 0)
      .lte("updated_at", cutoff)
      .order("updated_at")
      .limit(5),
    getDefaultValueMultiplier(),
  ]);
  if (error) throw error;
  if (!data.length) return;

  document.getElementById("slow-movers-card").style.display = "block";
  document.getElementById("slow-movers-list").innerHTML = data
    .map(
      (item) => `<div class="list-row">
        <div>
          <div class="title">${escapeHtml(item.name)}</div>
          <div class="meta">${daysAgo(item.updated_at)}d in stock · ${item.quantity} units</div>
        </div>
        <div class="title">${money(item.quantity * estimatedValueFor(item, multiplier))}</div>
      </div>`,
    )
    .join("");
}

const FORWARDER_LABEL = { redbox: "Redbox", myus: "MyUS", other: "forwarder" };

async function loadUnpaidShipments() {
  const { data, error } = await supabase
    .from("forwarder_shipments")
    .select("id, forwarder, shipping_cost, created_at")
    .eq("payment_status", "unpaid")
    .order("created_at")
    .limit(5);
  if (error) throw error;
  if (!data.length) return;

  document.getElementById("unpaid-shipments-card").style.display = "block";
  document.getElementById("unpaid-shipments-list").innerHTML = data
    .map(
      (s) => `<div class="list-row">
        <div>
          <div class="title">${FORWARDER_LABEL[s.forwarder]}</div>
          <div class="meta">created ${shortDate(s.created_at)}</div>
        </div>
        <div class="title negative">${money(s.shipping_cost)}</div>
      </div>`,
    )
    .join("");
}

async function loadOverdueShipments() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("forwarder_shipments")
    .select("id, forwarder, tracking_number, expected_arrival_date")
    .is("received_at", null)
    .not("expected_arrival_date", "is", null)
    .lt("expected_arrival_date", today)
    .order("expected_arrival_date")
    .limit(5);
  if (error) throw error;
  if (!data.length) return;

  document.getElementById("overdue-shipments-card").style.display = "block";
  document.getElementById("overdue-shipments-list").innerHTML = data
    .map(
      (s) => `<div class="list-row">
        <div>
          <div class="title">${FORWARDER_LABEL[s.forwarder]}${s.tracking_number ? ` · ${escapeHtml(s.tracking_number)}` : ""}</div>
          <div class="meta">expected ${shortDate(s.expected_arrival_date)}</div>
        </div>
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
