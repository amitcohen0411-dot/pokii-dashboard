import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, shortDate, sourceBadge, statusPill, escapeHtml, fxLine, CURRENCY_SYMBOLS } from "./format.js";
import { uploadMedia, mediaTypeFromFile, analyzeMedia, getMediaSignedUrl, MAX_MEDIA_BYTES } from "./media.js";
import { searchInventory, createInventoryItem, addStock, removeStock, setInventoryImage } from "./inventoryMatch.js";

let draftLines = [];
let selectedFile = null;
let currentMediaPath = null;
let currentMediaType = null;
let editingPurchaseId = null;
let editingOriginalMedia = { url: null, type: null };

const $ = (id) => document.getElementById(id);
const CATEGORY_LABEL = { funko: "Funko", pokemon_card: "Pokémon card", sports_card: "Sports card", other: "Other" };

const FORWARDER_LABEL = { redbox: "Redbox", myus: "MyUS", other: "forwarder" };

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("purchases.html");
  wireStaticHandlers();
  await loadList();
  const params = new URLSearchParams(window.location.search);
  if (params.get("id")) {
    openDetail(params.get("id"));
  } else if (window.location.hash === "#new") {
    showForm();
  }
}

function wireStaticHandlers() {
  $("show-new-btn").addEventListener("click", showForm);
  $("back-from-form").addEventListener("click", showList);
  $("back-from-detail").addEventListener("click", showList);

  $("p-media").addEventListener("change", (e) => {
    selectedFile = e.target.files[0] || null;
    $("analyze-btn").disabled = !selectedFile;
  });

  $("analyze-btn").addEventListener("click", onAnalyze);
  $("manual-btn").addEventListener("click", () => {
    draftLines = [];
    renderDraftLines();
    $("draft-card").style.display = "block";
    addDraftLine({ source: "human" });
  });
  $("add-item-btn").addEventListener("click", () => addDraftLine({ source: "human" }));
  $("confirm-btn").addEventListener("click", onConfirm);

  $("p-currency").addEventListener("change", onCurrencyChange);
  $("p-forwarder").addEventListener("change", onForwarderChange);
}

function onForwarderChange() {
  const fw = $("p-forwarder").value;
  $("p-status-label").textContent = fw ? "Status (leg 1 — to the forwarder)" : "Status";
  const receivedOption = $("p-status").querySelector('option[value="received"]');
  receivedOption.textContent = fw ? `Arrived at ${FORWARDER_LABEL[fw]}` : "Received";
}

function onCurrencyChange() {
  const cur = $("p-currency").value;
  const symbol = CURRENCY_SYMBOLS[cur] || cur;
  if (cur === "ILS") {
    $("p-fxrate").value = "1";
    $("p-fxrate").disabled = true;
    $("fx-hint").style.display = "none";
  } else {
    $("p-fxrate").disabled = false;
    $("fx-hint").style.display = "block";
  }
  $("p-shipping-label").textContent = `Shipping cost (${symbol}, split across items automatically)`;
  document.querySelectorAll(".f-price").forEach((inp) => (inp.placeholder = symbol));
}

function showList() {
  $("list-view").style.display = "block";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "none";
  loadList();
}

function showForm() {
  editingPurchaseId = null;
  editingOriginalMedia = { url: null, type: null };
  $("form-heading").textContent = "New purchase";
  $("confirm-btn").textContent = "Save purchase";
  $("media-card").style.display = "block";

  $("list-view").style.display = "none";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "block";
  $("p-date").value = new Date().toISOString().slice(0, 10);
  $("draft-card").style.display = "none";
  draftLines = [];
  selectedFile = null;
  currentMediaPath = null;
  currentMediaType = null;
  $("p-source").value = "";
  $("p-sourceurl").value = "";
  $("p-hint").value = "";
  $("p-media").value = "";
  $("p-shipping").value = "0";
  $("p-account").value = "bit";
  $("p-status").value = "ordered";
  $("p-forwarder").value = "";
  $("p-tracking").value = "";
  onForwarderChange();
  $("p-currency").value = "ILS";
  onCurrencyChange();
  $("analyze-btn").disabled = true;
  $("analyze-status").style.display = "none";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
async function loadList() {
  const { data, error } = await supabase
    .from("purchases")
    .select("id, source, source_url, status, order_date, total_amount, payment_account, currency, fx_rate, forwarder")
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false });

  const container = $("purchases-list");
  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">No purchases yet — log your first one.</div>`;
    return;
  }
  container.innerHTML = data
    .map(
      (p) => `
      <div class="list-row" style="cursor:pointer" data-id="${p.id}">
        <div>
          <div class="title">${escapeHtml(p.source || "Purchase")}${p.source_url ? ` <a href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:0.85em">↗</a>` : ""}</div>
          <div class="meta">${shortDate(p.order_date)} · ${escapeHtml(p.payment_account)}${p.forwarder ? ` · via ${FORWARDER_LABEL[p.forwarder]}` : ""}</div>
        </div>
        <div style="text-align:right">
          <div class="title">${fxLine(p.total_amount, p.currency, p.fx_rate)}</div>
          <div class="meta">${statusPill(p.status)}</div>
        </div>
      </div>`,
    )
    .join("");
  container.querySelectorAll("[data-id]").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
  });
}

// ---------------------------------------------------------------------------
// Detail / status / edit / delete
// ---------------------------------------------------------------------------
async function openDetail(id) {
  $("list-view").style.display = "none";
  $("form-view").style.display = "none";
  $("detail-view").style.display = "block";
  const body = $("detail-body");
  body.innerHTML = `<p class="spinner-text">Loading…</p>`;

  const { data: purchase, error } = await supabase.from("purchases").select("*").eq("id", id).single();
  if (error) {
    body.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  const { data: lines } = await supabase
    .from("purchase_line_items")
    .select("*")
    .eq("purchase_id", id)
    .order("created_at");

  let mediaHtml = "";
  if (purchase.media_url) {
    try {
      const url = await getMediaSignedUrl(purchase.media_url);
      mediaHtml =
        purchase.media_type === "video"
          ? `<video src="${url}" controls style="width:100%;border-radius:10px;margin:10px 0"></video>`
          : `<img src="${url}" style="width:100%;border-radius:10px;margin:10px 0" />`;
    } catch {
      /* ignore missing media */
    }
  }

  let shipmentHtml = "";
  if (purchase.forwarder_shipment_id) {
    const { data: shipment } = await supabase
      .from("forwarder_shipments")
      .select("*")
      .eq("id", purchase.forwarder_shipment_id)
      .single();
    if (shipment) {
      shipmentHtml = `
        <div class="card" style="background:var(--bg)">
          <div class="stat-label">Leg 2 — ${FORWARDER_LABEL[shipment.forwarder]} → you</div>
          <p class="meta">
            ${shipment.tracking_number ? `Tracking ${escapeHtml(shipment.tracking_number)} · ` : ""}
            ${shipment.payment_status === "paid" ? "Paid" : "Not yet paid"} (${money(shipment.shipping_cost)})
            ${shipment.expected_arrival_date ? ` · expected ${shortDate(shipment.expected_arrival_date)}` : ""}
            ${shipment.received_at ? ` · arrived ${shortDate(shipment.received_at)}` : ""}
          </p>
          <a class="btn secondary" href="orders.html">Manage in Orders</a>
        </div>`;
    }
  } else if (purchase.forwarder) {
    shipmentHtml = `<p class="hint">At ${FORWARDER_LABEL[purchase.forwarder]}, not yet included in an outbound shipment — assign it to one from the <a href="orders.html">Orders</a> page.</p>`;
  }

  body.innerHTML = `
    <h2>${escapeHtml(purchase.source || "Purchase")} ${statusPill(purchase.status)}</h2>
    ${purchase.source_url ? `<p><a href="${escapeHtml(purchase.source_url)}" target="_blank" rel="noopener">${purchase.source === "Vinted" ? "Vinted purchase history ↗" : "View original order/listing ↗"}</a></p>` : ""}
    <p class="meta">${shortDate(purchase.order_date)} · paid from ${escapeHtml(purchase.payment_account)}${purchase.tracking_number ? ` · tracking ${escapeHtml(purchase.tracking_number)}` : ""}${purchase.expected_arrival_date && purchase.status !== "received" ? ` · expected by ${shortDate(purchase.expected_arrival_date)}` : ""}</p>
    ${mediaHtml}
    ${shipmentHtml}
    ${purchase.notes ? `<p>${escapeHtml(purchase.notes)}</p>` : ""}
    <h3>Items</h3>
    ${(lines || [])
      .map(
        (l) => `<div class="list-row">
          <div class="title">${escapeHtml(l.name_raw)} × ${l.quantity}</div>
          <div>${money(l.unit_cost)}/ea</div>
        </div>`,
      )
      .join("") || `<p class="hint">No items recorded.</p>`}
    <p class="meta">Items subtotal ${money(purchase.items_subtotal)} + shipping ${money(purchase.shipping_amount)} = <strong>${fxLine(purchase.total_amount, purchase.currency, purchase.fx_rate)}</strong></p>

    <label for="status-select">Update status</label>
    <select id="status-select">
      <option value="ordered" ${purchase.status === "ordered" ? "selected" : ""}>Ordered</option>
      <option value="shipped" ${purchase.status === "shipped" ? "selected" : ""}>Shipped</option>
      <option value="received" ${purchase.status === "received" ? "selected" : ""}>Received</option>
      <option value="cancelled" ${purchase.status === "cancelled" ? "selected" : ""}>Cancelled</option>
    </select>
    <div class="btn-row">
      <button class="btn" id="save-status-btn">Save status</button>
      <button class="btn secondary" id="edit-purchase-btn">Edit</button>
      <button class="btn danger" id="delete-purchase-btn">Delete purchase</button>
    </div>
    <p class="hint">Deleting or editing removes this purchase's stock and refunds the transaction before reapplying it, but does not recompute historical average cost if some of that stock has already been sold.</p>
    <p class="field-error" id="detail-error" style="display:none"></p>
  `;

  $("save-status-btn").addEventListener("click", () => saveStatus(purchase, lines || []));
  $("delete-purchase-btn").addEventListener("click", () => deletePurchase(purchase, lines || []));
  $("edit-purchase-btn").addEventListener("click", () => openEditPurchase(purchase, lines || []));
}

async function saveStatus(purchase, lines) {
  const newStatus = $("status-select").value;
  const errorEl = $("detail-error");
  errorEl.style.display = "none";
  try {
    if (newStatus === "cancelled" && purchase.status !== "cancelled") {
      // Reverse this purchase's effect on inventory + cash.
      for (const line of lines) {
        if (line.inventory_item_id) await removeStock(line.inventory_item_id, line.quantity);
      }
      await supabase.from("transactions").insert({
        account: purchase.payment_account,
        amount: purchase.total_amount, // refund the cash back
        kind: "adjustment",
        related_purchase_id: purchase.id,
        note: "Purchase cancelled — reversing cash-out",
      });
    }
    await supabase.from("purchases").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", purchase.id);
    showList();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
}

async function deletePurchase(purchase, lines) {
  if (!confirm("Delete this purchase? This removes its stock and refunds its transaction.")) return;
  try {
    for (const line of lines) {
      if (line.inventory_item_id) await removeStock(line.inventory_item_id, line.quantity);
    }
    await supabase.from("transactions").delete().eq("related_purchase_id", purchase.id);
    await supabase.from("purchases").delete().eq("id", purchase.id);
    showList();
  } catch (err) {
    alert(err.message);
  }
}

// Reverses a purchase's stock + cash effect without deleting the purchase
// row itself — used right before re-saving an edited purchase.
async function reversePurchaseEffects(purchaseId, lines) {
  for (const line of lines) {
    if (line.inventory_item_id) await removeStock(line.inventory_item_id, line.quantity);
  }
  await supabase.from("purchase_line_items").delete().eq("purchase_id", purchaseId);
  await supabase.from("transactions").delete().eq("related_purchase_id", purchaseId);
}

function openEditPurchase(purchase, lines) {
  editingPurchaseId = purchase.id;
  editingOriginalMedia = { url: purchase.media_url, type: purchase.media_type };
  $("form-heading").textContent = "Edit purchase";
  $("confirm-btn").textContent = "Save changes";
  $("media-card").style.display = "none";

  $("list-view").style.display = "none";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "block";

  $("p-source").value = purchase.source || "";
  $("p-sourceurl").value = purchase.source_url || "";
  $("p-date").value = purchase.order_date;
  $("p-account").value = purchase.payment_account;
  $("p-status").value = purchase.status === "cancelled" ? "ordered" : purchase.status;
  $("p-forwarder").value = purchase.forwarder || "";
  $("p-tracking").value = purchase.tracking_number || "";
  onForwarderChange();
  $("p-hint").value = purchase.notes || "";
  $("p-currency").value = purchase.currency || "ILS";
  $("p-fxrate").value = purchase.fx_rate || 1;
  $("p-shipping").value = (Number(purchase.shipping_amount) / Number(purchase.fx_rate || 1)).toFixed(2);
  onCurrencyChange();

  draftLines = lines.map((l) => ({
    id: crypto.randomUUID(),
    name: l.name_raw,
    category: l.category || "other",
    quantity: l.quantity,
    unit_price: l.unit_price,
    discount_percent: l.discount_percent,
    confidence: null,
    source: "human",
    matchItemId: l.inventory_item_id,
  }));
  renderDraftLines();
  $("draft-card").style.display = "block";
}

// ---------------------------------------------------------------------------
// Capture + AI analyze
// ---------------------------------------------------------------------------
async function onAnalyze() {
  if (!selectedFile) return;
  const statusEl = $("analyze-status");
  statusEl.style.display = "block";
  if (selectedFile.size > MAX_MEDIA_BYTES) {
    statusEl.textContent = `That file is too large to analyze (${(selectedFile.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_MEDIA_BYTES / 1024 / 1024}MB) — try a shorter video or a photo instead, or add items manually below.`;
    return;
  }
  statusEl.textContent = "Uploading…";
  $("analyze-btn").disabled = true;
  try {
    currentMediaType = mediaTypeFromFile(selectedFile);
    currentMediaPath = await uploadMedia(selectedFile, "purchase");
    statusEl.textContent = "Analyzing with AI…";
    const result = await analyzeMedia({
      mediaPath: currentMediaPath,
      mediaType: currentMediaType,
      mode: "purchase",
      hint: $("p-hint").value,
    });

    draftLines = (result.items || []).map((item) => ({
      id: crypto.randomUUID(),
      name: item.name || "",
      category: item.category || "other",
      quantity: item.quantity || 1,
      unit_price: item.unit_price ?? null,
      discount_percent: item.discount_percent ?? null,
      confidence: item.confidence ?? null,
      source: "ai",
      matchItemId: null,
    }));
    if (result.shipping_amount != null) $("p-shipping").value = result.shipping_amount;
    if (result.currency && CURRENCY_SYMBOLS[result.currency]) {
      $("p-currency").value = result.currency;
      onCurrencyChange();
    }

    renderDraftLines();
    $("draft-card").style.display = "block";
    statusEl.textContent = result.confidence_notes
      ? "AI notes: " + result.confidence_notes
      : "Review the items below before saving.";
  } catch (err) {
    statusEl.textContent = "Analysis failed: " + err.message + " — you can still add items manually below.";
    draftLines = [];
    renderDraftLines();
    $("draft-card").style.display = "block";
  } finally {
    $("analyze-btn").disabled = false;
  }
}

function addDraftLine(overrides) {
  draftLines.push({
    id: crypto.randomUUID(),
    name: "",
    category: "other",
    quantity: 1,
    unit_price: null,
    discount_percent: null,
    confidence: null,
    source: "human",
    matchItemId: null,
    ...overrides,
  });
  renderDraftLines();
}

function fieldSourceFor(line, field) {
  if (line[field] === null || line[field] === undefined) return "missing";
  return line.source;
}

function renderDraftLines() {
  const container = $("draft-items");
  const priceSymbol = CURRENCY_SYMBOLS[$("p-currency").value] || $("p-currency").value;
  container.innerHTML = "";
  draftLines.forEach((line) => {
    const el = document.createElement("div");
    el.className = "line-item";
    el.innerHTML = `
      <div class="row">
        <div style="flex:2">
          <label>Item <span class="badge-slot" data-field="name">${sourceBadge(fieldSourceFor(line, "name"))}</span></label>
          <input class="f-name" value="${escapeHtml(line.name)}" placeholder="Item name" />
        </div>
        <div>
          <label>Category</label>
          <select class="f-category">
            <option value="funko" ${line.category === "funko" ? "selected" : ""}>Funko</option>
            <option value="pokemon_card" ${line.category === "pokemon_card" ? "selected" : ""}>Pokémon card</option>
            <option value="sports_card" ${line.category === "sports_card" ? "selected" : ""}>Sports card</option>
            <option value="other" ${line.category === "other" ? "selected" : ""}>Other</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div>
          <label>Qty</label>
          <input class="f-qty" type="number" min="1" value="${line.quantity}" />
        </div>
        <div>
          <label>Unit price <span class="badge-slot" data-field="unit_price">${sourceBadge(fieldSourceFor(line, "unit_price"))}</span></label>
          <input class="f-price" type="number" step="0.01" min="0" value="${line.unit_price ?? ""}" placeholder="${priceSymbol}" />
        </div>
        <div>
          <label>Discount % <span class="badge-slot" data-field="discount_percent">${sourceBadge(fieldSourceFor(line, "discount_percent"))}</span></label>
          <input class="f-discount" type="number" step="0.01" min="0" max="100" value="${line.discount_percent ?? ""}" placeholder="0" />
        </div>
      </div>
      <div class="row">
        <div style="flex:3">
          <label>Match to inventory</label>
          <select class="f-match"><option value="">— create new item —</option></select>
        </div>
        <div style="flex:0">
          <button type="button" class="remove-btn f-remove">Remove</button>
        </div>
      </div>
    `;
    container.appendChild(el);

    const refreshBadges = () => {
      el.querySelectorAll(".badge-slot").forEach((slot) => {
        slot.innerHTML = sourceBadge(fieldSourceFor(line, slot.dataset.field));
      });
    };
    const markEdited = () => {
      if (line.source === "ai") line.source = "edited";
    };
    el.querySelector(".f-name").addEventListener("input", (e) => {
      line.name = e.target.value;
      markEdited();
      refreshBadges();
      refreshMatchOptions(el, line);
    });
    el.querySelector(".f-category").addEventListener("change", (e) => {
      line.category = e.target.value;
      markEdited();
      refreshBadges();
      refreshMatchOptions(el, line);
    });
    el.querySelector(".f-qty").addEventListener("input", (e) => {
      line.quantity = Number(e.target.value) || 1;
    });
    el.querySelector(".f-price").addEventListener("input", (e) => {
      line.unit_price = e.target.value === "" ? null : Number(e.target.value);
      markEdited();
      refreshBadges();
    });
    el.querySelector(".f-discount").addEventListener("input", (e) => {
      line.discount_percent = e.target.value === "" ? null : Number(e.target.value);
      markEdited();
      refreshBadges();
    });
    el.querySelector(".f-match").addEventListener("change", (e) => {
      line.matchItemId = e.target.value || null;
    });
    el.querySelector(".f-remove").addEventListener("click", () => {
      draftLines = draftLines.filter((l) => l.id !== line.id);
      renderDraftLines();
    });

    refreshMatchOptions(el, line);
  });
}

async function refreshMatchOptions(rowEl, line) {
  const select = rowEl.querySelector(".f-match");
  try {
    const matches = await searchInventory(line.name);
    select.innerHTML =
      `<option value="">— create new item —</option>` +
      matches
        .map(
          (m) =>
            `<option value="${m.id}">${escapeHtml(m.name)} — ${CATEGORY_LABEL[m.category] || m.category}, ${m.quantity} in stock, avg ${money(m.avg_unit_cost)}</option>`,
        )
        .join("");
    if (line.matchItemId && matches.some((m) => m.id === line.matchItemId)) {
      select.value = line.matchItemId;
    } else {
      const exact = matches.find((m) => m.name.toLowerCase() === line.name.toLowerCase());
      if (exact) {
        select.value = exact.id;
        line.matchItemId = exact.id;
      }
    }
  } catch {
    /* leave as "create new" if search fails */
  }
}

// ---------------------------------------------------------------------------
// Confirm / save (handles both new purchases and saving an edit)
// ---------------------------------------------------------------------------
async function onConfirm() {
  const errorEl = $("confirm-error");
  errorEl.style.display = "none";

  if (!draftLines.length) {
    errorEl.textContent = "Add at least one item.";
    errorEl.style.display = "block";
    return;
  }
  for (const l of draftLines) {
    if (!l.name.trim()) {
      errorEl.textContent = "Every item needs a name.";
      errorEl.style.display = "block";
      return;
    }
    if (l.unit_price === null) {
      errorEl.textContent = `"${l.name}" is missing a price — fill it in before saving, otherwise its cost would be recorded as ₪0.`;
      errorEl.style.display = "block";
      return;
    }
  }

  $("confirm-btn").disabled = true;
  try {
    const currency = $("p-currency").value;
    const fxRate = currency === "ILS" ? 1 : Number($("p-fxrate").value) || 1;
    const shippingForeign = Number($("p-shipping").value) || 0;
    const shippingAmount = shippingForeign * fxRate; // ILS

    const effective = draftLines.map((l) => {
      const price = Number(l.unit_price) || 0; // entered in `currency`
      const discount = Number(l.discount_percent) || 0;
      const effectiveUnitPrice = price * (1 - discount / 100) * fxRate; // ILS
      return { line: l, effectiveUnitPrice, lineTotal: effectiveUnitPrice * l.quantity };
    });
    const itemsSubtotal = effective.reduce((s, e) => s + e.lineTotal, 0); // ILS

    const purchasePayload = {
      source: $("p-source").value || null,
      source_url: $("p-sourceurl").value.trim() || null,
      status: $("p-status").value,
      order_date: $("p-date").value,
      items_subtotal: itemsSubtotal,
      shipping_amount: shippingAmount,
      total_amount: itemsSubtotal + shippingAmount,
      payment_account: $("p-account").value,
      notes: $("p-hint").value || null,
      currency,
      fx_rate: fxRate,
      forwarder: $("p-forwarder").value || null,
      tracking_number: $("p-tracking").value || null,
    };

    let purchase;
    if (editingPurchaseId) {
      const { data: oldLines } = await supabase
        .from("purchase_line_items")
        .select("*")
        .eq("purchase_id", editingPurchaseId);
      await reversePurchaseEffects(editingPurchaseId, oldLines || []);

      const { data, error: updateErr } = await supabase
        .from("purchases")
        .update({
          ...purchasePayload,
          media_url: editingOriginalMedia.url,
          media_type: editingOriginalMedia.type,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingPurchaseId)
        .select()
        .single();
      if (updateErr) throw updateErr;
      purchase = data;
    } else {
      const { data, error: purchaseErr } = await supabase
        .from("purchases")
        .insert({
          ...purchasePayload,
          media_url: currentMediaPath,
          media_type: currentMediaType,
          ai_status: currentMediaPath ? "done" : "none",
        })
        .select()
        .single();
      if (purchaseErr) throw purchaseErr;
      purchase = data;
    }

    for (const e of effective) {
      const l = e.line;
      const allocatedShipping =
        itemsSubtotal > 0 ? shippingAmount * (e.lineTotal / itemsSubtotal) : shippingAmount / draftLines.length;
      const unitCost = e.effectiveUnitPrice + allocatedShipping / l.quantity;

      let inventoryItemId = l.matchItemId;
      if (!inventoryItemId) {
        const created = await createInventoryItem({ name: l.name, category: l.category });
        inventoryItemId = created.id;
        // Give a freshly-created item a representative photo from this
        // purchase, when one was attached — makes the inventory list far
        // easier to scan visually. Only for photos (not video), and only
        // for genuinely new items (not existing ones we just restocked).
        if (currentMediaPath && currentMediaType === "image") {
          await setInventoryImage(inventoryItemId, currentMediaPath);
        }
      }
      await addStock(inventoryItemId, l.quantity, unitCost, e.effectiveUnitPrice);

      await supabase.from("purchase_line_items").insert({
        purchase_id: purchase.id,
        inventory_item_id: inventoryItemId,
        name_raw: l.name,
        category: l.category,
        quantity: l.quantity,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        allocated_shipping: allocatedShipping,
        unit_cost: unitCost,
        field_source: {
          name_raw: l.source,
          unit_price: fieldSourceFor(l, "unit_price"),
          discount_percent: fieldSourceFor(l, "discount_percent"),
        },
        confidence: l.confidence,
      });
    }

    await supabase.from("transactions").insert({
      account: $("p-account").value,
      amount: -(itemsSubtotal + shippingAmount),
      kind: "purchase",
      related_purchase_id: purchase.id,
      occurred_at: new Date($("p-date").value).toISOString(),
    });

    showList();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    $("confirm-btn").disabled = false;
  }
}

main();
