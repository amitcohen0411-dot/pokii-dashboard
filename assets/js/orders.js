import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, shortDate, escapeHtml } from "./format.js";

const $ = (id) => document.getElementById(id);
const FORWARDER_LABEL = { redbox: "Redbox", myus: "MyUS", other: "forwarder" };
const STATE_LABEL = {
  awaiting_seller: "Awaiting seller",
  at_forwarder: "At forwarder",
  awaiting_payment: "Forwarder unpaid",
  in_transit: "In transit to you",
  received: "Received",
};
const STATE_CLASS = {
  awaiting_seller: "status-ordered",
  at_forwarder: "status-ordered",
  awaiting_payment: "status-cancelled",
  in_transit: "status-shipped",
  received: "status-received",
};

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("orders.html");

  $("filter-select").addEventListener("change", loadOrders);
  $("new-shipment-btn").addEventListener("click", showNewShipmentForm);
  $("ns-cancel-btn").addEventListener("click", hideNewShipmentForm);
  $("ns-forwarder").addEventListener("change", loadNewShipmentPurchaseList);
  $("ns-create-btn").addEventListener("click", createShipment);

  await Promise.all([loadOrders(), loadShipments()]);
}

function deriveState(p) {
  const shipment = p.forwarder_shipments;
  if (!p.forwarder) {
    if (p.status === "received") return "received";
    if (p.status === "shipped") return "in_transit";
    return "awaiting_seller";
  }
  if (shipment) {
    if (shipment.received_at) return "received";
    if (shipment.payment_status === "unpaid") return "awaiting_payment";
    return "in_transit";
  }
  if (p.status === "received") return "at_forwarder";
  return "awaiting_seller";
}

// ---------------------------------------------------------------------------
// Orders list
// ---------------------------------------------------------------------------
async function loadOrders() {
  const filter = $("filter-select").value;
  const container = $("orders-list");

  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, source, order_date, total_amount, forwarder, tracking_number, status, expected_arrival_date, forwarder_shipments(*), purchase_line_items(name_raw)",
    )
    .neq("status", "cancelled")
    .order("order_date", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }

  const rows = data
    .map((p) => ({ ...p, state: deriveState(p) }))
    .filter((p) => (filter === "all" ? p.state !== "received" : p.state === filter));

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">Nothing here right now.</div>`;
    return;
  }

  container.innerHTML = rows
    .map((p) => {
      const tracking = p.forwarder_shipments?.tracking_number || p.tracking_number;
      const contents = (p.purchase_line_items || []).map((l) => l.name_raw).join(", ");
      const expected = p.forwarder_shipments?.expected_arrival_date || (!p.forwarder ? p.expected_arrival_date : null);
      return `
      <div class="list-row" style="cursor:pointer" data-id="${p.id}">
        <div>
          <div class="title">${escapeHtml(p.source || "Purchase")}</div>
          <div class="meta">${shortDate(p.order_date)}${p.forwarder ? ` · via ${FORWARDER_LABEL[p.forwarder]}` : ""}${tracking ? ` · ${escapeHtml(tracking)}` : ""}</div>
          ${contents ? `<div class="meta">${escapeHtml(contents)}</div>` : ""}
          ${expected && p.state !== "received" ? `<div class="meta">Expected by ${shortDate(expected)}</div>` : ""}
        </div>
        <div style="text-align:right">
          <div class="title">${money(p.total_amount)}</div>
          <div class="meta"><span class="status-pill ${STATE_CLASS[p.state]}">${STATE_LABEL[p.state]}</span></div>
        </div>
      </div>`;
    })
    .join("");

  container.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      window.location.href = `purchases.html?id=${el.dataset.id}`;
    });
  });
}

// ---------------------------------------------------------------------------
// New shipment
// ---------------------------------------------------------------------------
function showNewShipmentForm() {
  $("new-shipment-card").style.display = "block";
  $("ns-cost").value = "0";
  $("ns-tracking").value = "";
  $("ns-expected").value = "";
  $("ns-error").style.display = "none";
  loadNewShipmentPurchaseList();
}

function hideNewShipmentForm() {
  $("new-shipment-card").style.display = "none";
}

async function loadNewShipmentPurchaseList() {
  const forwarder = $("ns-forwarder").value;
  const listEl = $("ns-purchase-list");
  listEl.innerHTML = `<p class="spinner-text">Loading…</p>`;

  const { data, error } = await supabase
    .from("purchases")
    .select("id, source, total_amount, order_date, purchase_line_items(name_raw)")
    .eq("forwarder", forwarder)
    .eq("status", "received")
    .is("forwarder_shipment_id", null)
    .order("order_date");

  if (error) {
    listEl.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    listEl.innerHTML = `<p class="hint">Nothing marked "arrived at ${FORWARDER_LABEL[forwarder]}" and unassigned yet.</p>`;
    return;
  }
  listEl.innerHTML = data
    .map((p) => {
      const contents = (p.purchase_line_items || []).map((l) => l.name_raw).join(", ");
      return `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;color:var(--text)">
        <input type="checkbox" class="ns-pick" value="${p.id}" />
        ${escapeHtml(p.source || "Purchase")}${contents ? ` (${escapeHtml(contents)})` : ""} — ${money(p.total_amount)} (${shortDate(p.order_date)})
      </label>`;
    })
    .join("");
}

async function createShipment() {
  const errorEl = $("ns-error");
  errorEl.style.display = "none";
  const forwarder = $("ns-forwarder").value;
  const cost = Number($("ns-cost").value) || 0;
  const tracking = $("ns-tracking").value || null;
  const expected = $("ns-expected").value || null;
  const picked = Array.from(document.querySelectorAll(".ns-pick:checked")).map((el) => el.value);

  if (!picked.length) {
    errorEl.textContent = "Pick at least one purchase to include, or just track this shipment without linking any yet by adding purchases to it later.";
    errorEl.style.display = "block";
    return;
  }

  $("ns-create-btn").disabled = true;
  try {
    const { data: shipment, error: shipErr } = await supabase
      .from("forwarder_shipments")
      .insert({ forwarder, shipping_cost: cost, tracking_number: tracking, expected_arrival_date: expected })
      .select()
      .single();
    if (shipErr) throw shipErr;

    for (const id of picked) {
      await supabase.from("purchases").update({ forwarder_shipment_id: shipment.id }).eq("id", id);
    }

    hideNewShipmentForm();
    await Promise.all([loadOrders(), loadShipments()]);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    $("ns-create-btn").disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Shipments list
// ---------------------------------------------------------------------------
async function loadShipments() {
  const container = $("shipments-list");
  const { data: shipments, error } = await supabase
    .from("forwarder_shipments")
    .select("*")
    .order("payment_status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!shipments.length) {
    container.innerHTML = `<div class="card empty-state">No forwarder shipments yet.</div>`;
    return;
  }

  const withPurchases = await Promise.all(
    shipments.map(async (s) => {
      const { data: purchases } = await supabase
        .from("purchases")
        .select("id, source, total_amount, purchase_line_items(name_raw)")
        .eq("forwarder_shipment_id", s.id);
      return { ...s, purchases: purchases || [] };
    }),
  );

  container.innerHTML = withPurchases.map((s) => shipmentCardHtml(s)).join("");

  withPurchases.forEach((s) => wireShipmentCard(s));
}

function shipmentCardHtml(s) {
  return `
    <div class="card" data-shipment-id="${s.id}">
      <div class="stat-label">${FORWARDER_LABEL[s.forwarder]} shipment · created ${shortDate(s.created_at)}</div>
      <p class="meta">
        ${s.payment_status === "paid" ? `Paid ${money(s.shipping_cost)}${s.paid_at ? " on " + shortDate(s.paid_at) : ""}` : `<strong style="color:var(--danger)">Unpaid — ${money(s.shipping_cost)}</strong>`}
        ${s.received_at ? ` · arrived ${shortDate(s.received_at)}` : ""}
      </p>

      <label>Tracking number</label>
      <input class="sh-tracking" value="${escapeHtml(s.tracking_number || "")}" placeholder="Forwarder's tracking #" />
      <label>Expected arrival</label>
      <input class="sh-expected" type="date" value="${s.expected_arrival_date || ""}" />
      <div class="btn-row">
        <button class="btn secondary sh-save-btn">Save</button>
        ${
          s.payment_status === "unpaid"
            ? `<select class="sh-pay-account"><option value="bit">Bit</option><option value="cash">Cash</option><option value="card">Card</option></select>
               <button class="btn sh-pay-btn">Mark paid</button>`
            : ""
        }
        ${!s.received_at ? `<button class="btn secondary sh-arrived-btn">Mark arrived today</button>` : ""}
        <button class="btn danger sh-delete-btn">Delete shipment</button>
      </div>

      <div class="stat-label" style="margin-top:14px">Purchases in this shipment</div>
      ${
        s.purchases
          .map((p) => {
            const contents = (p.purchase_line_items || []).map((l) => l.name_raw).join(", ");
            return `<div class="list-row">
              <div>
                <div class="title">${escapeHtml(p.source || "Purchase")}</div>
                ${contents ? `<div class="meta">${escapeHtml(contents)}</div>` : ""}
              </div>
              <div>${money(p.total_amount)} <button type="button" class="remove-btn sh-unassign" data-pid="${p.id}">remove</button></div>
            </div>`;
          })
          .join("") || `<p class="hint">None assigned.</p>`
      }
      <p class="field-error sh-error" style="display:none"></p>
    </div>`;
}

function wireShipmentCard(s) {
  const card = document.querySelector(`[data-shipment-id="${s.id}"]`);
  if (!card) return;
  const errorEl = card.querySelector(".sh-error");
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  };

  card.querySelector(".sh-save-btn").addEventListener("click", async () => {
    errorEl.style.display = "none";
    try {
      await supabase
        .from("forwarder_shipments")
        .update({
          tracking_number: card.querySelector(".sh-tracking").value || null,
          expected_arrival_date: card.querySelector(".sh-expected").value || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      await Promise.all([loadOrders(), loadShipments()]);
    } catch (err) {
      showError(err.message);
    }
  });

  const payBtn = card.querySelector(".sh-pay-btn");
  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      errorEl.style.display = "none";
      try {
        const account = card.querySelector(".sh-pay-account").value;
        await supabase
          .from("forwarder_shipments")
          .update({ payment_status: "paid", paid_at: new Date().toISOString() })
          .eq("id", s.id);
        await supabase.from("transactions").insert({
          account,
          amount: -Number(s.shipping_cost),
          kind: "shipping",
          related_forwarder_shipment_id: s.id,
          note: `${FORWARDER_LABEL[s.forwarder]} shipment payment`,
        });
        await Promise.all([loadOrders(), loadShipments()]);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  const arrivedBtn = card.querySelector(".sh-arrived-btn");
  if (arrivedBtn) {
    arrivedBtn.addEventListener("click", async () => {
      errorEl.style.display = "none";
      try {
        const today = new Date().toISOString().slice(0, 10);
        await supabase.from("forwarder_shipments").update({ received_at: today }).eq("id", s.id);
        for (const p of s.purchases) {
          await supabase.from("purchases").update({ status: "received" }).eq("id", p.id);
        }
        await Promise.all([loadOrders(), loadShipments()]);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  card.querySelector(".sh-delete-btn").addEventListener("click", async () => {
    if (!confirm("Delete this shipment? Its purchases will be unassigned, and any payment for it refunded.")) return;
    errorEl.style.display = "none";
    try {
      for (const p of s.purchases) {
        await supabase.from("purchases").update({ forwarder_shipment_id: null }).eq("id", p.id);
      }
      if (s.payment_status === "paid") {
        await supabase.from("transactions").delete().eq("related_forwarder_shipment_id", s.id);
      }
      await supabase.from("forwarder_shipments").delete().eq("id", s.id);
      await Promise.all([loadOrders(), loadShipments()]);
    } catch (err) {
      showError(err.message);
    }
  });

  card.querySelectorAll(".sh-unassign").forEach((btn) => {
    btn.addEventListener("click", async () => {
      errorEl.style.display = "none";
      try {
        await supabase.from("purchases").update({ forwarder_shipment_id: null }).eq("id", btn.dataset.pid);
        await Promise.all([loadOrders(), loadShipments()]);
      } catch (err) {
        showError(err.message);
      }
    });
  });
}

main();
