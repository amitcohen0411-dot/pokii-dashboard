import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, shortDate, sourceBadge, escapeHtml } from "./format.js";
import { uploadMedia, mediaTypeFromFile, analyzeMedia, getMediaSignedUrl, MAX_MEDIA_BYTES } from "./media.js";
import { searchInventory, getInventoryItem, removeStock } from "./inventoryMatch.js";

let draftLines = [];
let selectedFile = null;
let currentMediaPath = null;
let currentMediaType = null;
let editingSaleId = null;
let editingOriginalMedia = { url: null, type: null };

const $ = (id) => document.getElementById(id);
const CATEGORY_LABEL = { funko: "Funko", pokemon_card: "Pokémon card", other: "Other" };

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("sales.html");
  wireStaticHandlers();
  await loadList();
  if (window.location.hash === "#new") showForm();
}

function wireStaticHandlers() {
  $("show-new-btn").addEventListener("click", showForm);
  $("back-from-form").addEventListener("click", showList);
  $("back-from-detail").addEventListener("click", showList);

  $("s-media").addEventListener("change", (e) => {
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
}

function showList() {
  $("list-view").style.display = "block";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "none";
  loadList();
}

function showForm() {
  editingSaleId = null;
  editingOriginalMedia = { url: null, type: null };
  $("form-heading").textContent = "New sale";
  $("confirm-btn").textContent = "Save sale";
  $("media-card").style.display = "block";

  $("list-view").style.display = "none";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "block";
  $("s-date").value = new Date().toISOString().slice(0, 10);
  $("draft-card").style.display = "none";
  draftLines = [];
  selectedFile = null;
  currentMediaPath = null;
  currentMediaType = null;
  $("s-channel").value = "";
  $("s-hint").value = "";
  $("s-media").value = "";
  $("s-total").value = "";
  $("s-account").value = "bit";
  $("analyze-btn").disabled = true;
  $("analyze-status").style.display = "none";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
async function loadList() {
  const { data, error } = await supabase
    .from("sales")
    .select("id, channel, sale_date, total_amount, payment_account")
    .order("sale_date", { ascending: false })
    .order("created_at", { ascending: false });

  const container = $("sales-list");
  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">No sales yet.</div>`;
    return;
  }
  container.innerHTML = data
    .map(
      (s) => `
      <div class="list-row" style="cursor:pointer" data-id="${s.id}">
        <div>
          <div class="title">${escapeHtml(s.channel || "Sale")}</div>
          <div class="meta">${shortDate(s.sale_date)} · ${escapeHtml(s.payment_account)}</div>
        </div>
        <div class="title">${money(s.total_amount)}</div>
      </div>`,
    )
    .join("");
  container.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
}

async function openDetail(id) {
  $("list-view").style.display = "none";
  $("form-view").style.display = "none";
  $("detail-view").style.display = "block";
  const body = $("detail-body");
  body.innerHTML = `<p class="spinner-text">Loading…</p>`;

  const { data: sale, error } = await supabase.from("sales").select("*").eq("id", id).single();
  if (error) {
    body.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  const { data: lines } = await supabase.from("sale_line_items").select("*").eq("sale_id", id).order("created_at");

  let mediaHtml = "";
  if (sale.media_url) {
    try {
      const url = await getMediaSignedUrl(sale.media_url);
      mediaHtml =
        sale.media_type === "video"
          ? `<video src="${url}" controls style="width:100%;border-radius:10px;margin:10px 0"></video>`
          : `<img src="${url}" style="width:100%;border-radius:10px;margin:10px 0" />`;
    } catch {
      /* ignore */
    }
  }

  const totalProfit = (lines || []).reduce((sum, l) => sum + l.quantity * (Number(l.unit_price) - Number(l.unit_cost_basis)), 0);

  body.innerHTML = `
    <h2>${escapeHtml(sale.channel || "Sale")}</h2>
    <p class="meta">${shortDate(sale.sale_date)} · paid into ${escapeHtml(sale.payment_account)}</p>
    ${mediaHtml}
    ${sale.notes ? `<p>${escapeHtml(sale.notes)}</p>` : ""}
    <h3>Items</h3>
    ${(lines || [])
      .map(
        (l) => `<div class="list-row">
          <div class="title">${escapeHtml(l.name_raw)} × ${l.quantity}</div>
          <div style="text-align:right">
            <div>${money(l.unit_price)}/ea</div>
            <div class="meta">profit ${money((l.unit_price - l.unit_cost_basis) * l.quantity)}</div>
          </div>
        </div>`,
      )
      .join("") || `<p class="hint">No items recorded.</p>`}
    <p class="meta">Total <strong>${money(sale.total_amount)}</strong> · profit <strong>${money(totalProfit)}</strong></p>
    <div class="btn-row">
      <button class="btn secondary" id="edit-sale-btn">Edit</button>
      <button class="btn danger" id="delete-sale-btn">Delete sale</button>
    </div>
    <p class="hint">Deleting or editing returns this sale's items to inventory before reapplying, and removes/reinserts the transaction.</p>
  `;

  $("delete-sale-btn").addEventListener("click", () => deleteSale(sale, lines || []));
  $("edit-sale-btn").addEventListener("click", () => openEditSale(sale, lines || []));
}

async function deleteSale(sale, lines) {
  if (!confirm("Delete this sale? Items return to inventory and the transaction is removed.")) return;
  try {
    await restoreSaleStock(lines);
    await supabase.from("transactions").delete().eq("related_sale_id", sale.id);
    await supabase.from("sales").delete().eq("id", sale.id);
    showList();
  } catch (err) {
    alert(err.message);
  }
}

async function restoreSaleStock(lines) {
  for (const line of lines) {
    if (line.inventory_item_id) {
      const item = await getInventoryItem(line.inventory_item_id);
      await supabase
        .from("inventory_items")
        .update({ quantity: item.quantity + line.quantity, updated_at: new Date().toISOString() })
        .eq("id", line.inventory_item_id);
    }
  }
}

function openEditSale(sale, lines) {
  editingSaleId = sale.id;
  editingOriginalMedia = { url: sale.media_url, type: sale.media_type };
  $("form-heading").textContent = "Edit sale";
  $("confirm-btn").textContent = "Save changes";
  $("media-card").style.display = "none";

  $("list-view").style.display = "none";
  $("detail-view").style.display = "none";
  $("form-view").style.display = "block";

  $("s-date").value = sale.sale_date;
  $("s-channel").value = sale.channel || "";
  $("s-account").value = sale.payment_account;
  $("s-total").value = sale.total_amount;
  $("s-hint").value = sale.notes || "";

  draftLines = lines.map((l) => ({
    id: crypto.randomUUID(),
    name: l.name_raw,
    category: "other",
    quantity: l.quantity,
    unit_price: l.unit_price,
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
    currentMediaPath = await uploadMedia(selectedFile, "sale");
    statusEl.textContent = "Analyzing with AI…";
    const result = await analyzeMedia({
      mediaPath: currentMediaPath,
      mediaType: currentMediaType,
      mode: "sale",
      hint: $("s-hint").value,
    });

    const totalQty = (result.items || []).reduce((s, i) => s + (i.quantity || 1), 0) || 1;
    const enteredTotal = Number($("s-total").value) || 0;

    draftLines = (result.items || []).map((item) => ({
      id: crypto.randomUUID(),
      name: item.name || "",
      category: item.category || "other",
      quantity: item.quantity || 1,
      unit_price: item.unit_price ?? (enteredTotal ? Number((enteredTotal / totalQty).toFixed(2)) : null),
      confidence: item.confidence ?? null,
      source: item.unit_price != null ? "ai" : "human",
      matchItemId: null,
    }));

    renderDraftLines();
    $("draft-card").style.display = "block";
    statusEl.textContent = result.confidence_notes
      ? "AI notes: " + result.confidence_notes
      : "Pick the right stock match for each item below.";
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
          <label>Sale price/ea <span class="badge-slot" data-field="unit_price">${sourceBadge(fieldSourceFor(line, "unit_price"))}</span></label>
          <input class="f-price" type="number" step="0.01" min="0" value="${line.unit_price ?? ""}" placeholder="₪" />
        </div>
      </div>
      <div class="row">
        <div style="flex:3">
          <label>Matches in stock ${sourceBadge("missing")}<span id="match-hint-${line.id}"></span></label>
          <select class="f-match"><option value="">— pick a match, or leave blank if none —</option></select>
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
  const hintEl = document.getElementById(`match-hint-${line.id}`);
  try {
    const matches = await searchInventory(line.name);
    select.innerHTML =
      `<option value="">— pick a match, or leave blank if none —</option>` +
      matches
        .map(
          (m) =>
            `<option value="${m.id}">${escapeHtml(m.name)} — ${CATEGORY_LABEL[m.category] || m.category}, ${m.quantity} in stock</option>`,
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
    if (hintEl) {
      const dupes = matches.filter((m) => m.quantity > 1);
      hintEl.textContent = dupes.length ? " — some matches have multiple copies in stock, double-check quantity" : "";
    }
  } catch {
    /* leave blank if search fails */
  }
}

// ---------------------------------------------------------------------------
// Confirm / save (handles both new sales and saving an edit)
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
      errorEl.textContent = `"${l.name}" is missing a sale price.`;
      errorEl.style.display = "block";
      return;
    }
  }

  const unmatched = draftLines.filter((l) => !l.matchItemId);
  if (unmatched.length) {
    const names = unmatched.map((l) => l.name).join(", ");
    const proceed = confirm(
      `Not matched to tracked inventory: ${names}.\n\nThese will be saved with ₪0 cost basis, so their profit will show as the full sale price. Continue anyway?`,
    );
    if (!proceed) return;
  }

  $("confirm-btn").disabled = true;
  try {
    const totalAmount = Number($("s-total").value) || draftLines.reduce((s, l) => s + l.quantity * Number(l.unit_price), 0);

    const salePayload = {
      sale_date: $("s-date").value,
      channel: $("s-channel").value || null,
      payment_account: $("s-account").value,
      total_amount: totalAmount,
      notes: $("s-hint").value || null,
    };

    let sale;
    if (editingSaleId) {
      const { data: oldLines } = await supabase.from("sale_line_items").select("*").eq("sale_id", editingSaleId);
      await restoreSaleStock(oldLines || []);
      await supabase.from("sale_line_items").delete().eq("sale_id", editingSaleId);
      await supabase.from("transactions").delete().eq("related_sale_id", editingSaleId);

      const { data, error: updateErr } = await supabase
        .from("sales")
        .update({ ...salePayload, media_url: editingOriginalMedia.url, media_type: editingOriginalMedia.type })
        .eq("id", editingSaleId)
        .select()
        .single();
      if (updateErr) throw updateErr;
      sale = data;
    } else {
      const { data, error: saleErr } = await supabase
        .from("sales")
        .insert({ ...salePayload, media_url: currentMediaPath, media_type: currentMediaType, ai_status: currentMediaPath ? "done" : "none" })
        .select()
        .single();
      if (saleErr) throw saleErr;
      sale = data;
    }

    for (const l of draftLines) {
      let unitCostBasis = 0;
      if (l.matchItemId) {
        const item = await getInventoryItem(l.matchItemId);
        unitCostBasis = Number(item.avg_unit_cost);
        await removeStock(l.matchItemId, l.quantity);
      }

      await supabase.from("sale_line_items").insert({
        sale_id: sale.id,
        inventory_item_id: l.matchItemId || null,
        name_raw: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        unit_cost_basis: unitCostBasis,
        field_source: { name_raw: l.source, unit_price: fieldSourceFor(l, "unit_price") },
        confidence: l.confidence,
      });
    }

    await supabase.from("transactions").insert({
      account: $("s-account").value,
      amount: totalAmount,
      kind: "sale",
      related_sale_id: sale.id,
      occurred_at: new Date($("s-date").value).toISOString(),
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
