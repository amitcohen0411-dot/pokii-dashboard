import { supabase } from "./supabaseClient.js";
import { requireSession } from "./auth.js";
import { renderNav } from "./nav.js";
import { money, escapeHtml } from "./format.js";
import { getMediaSignedUrl, uploadMedia } from "./media.js";
import { setInventoryImage, setEstimatedValue, getDefaultValueMultiplier } from "./inventoryMatch.js";

const $ = (id) => document.getElementById(id);
const CATEGORY_LABEL = { funko: "Funko", pokemon_card: "Pokémon card", other: "Other" };

// estimated_value is the source of truth when you've told us what something's
// actually worth; otherwise we guess using the default multiplier against
// the item-only cost (no shipping/fees) — never against avg_unit_cost, since
// that's the real cost basis used for profit math and must stay untouched.
function estimatedValueFor(item, multiplier) {
  return item.estimated_value != null ? Number(item.estimated_value) : Number(item.avg_item_cost) * multiplier;
}

async function main() {
  const session = await requireSession();
  if (!session) return;
  renderNav("inventory.html");

  $("search-box").addEventListener("input", debounce(loadList, 250));
  $("category-filter").addEventListener("change", loadList);
  $("back-btn").addEventListener("click", showList);

  await loadList();
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function showList() {
  $("list-view").style.display = "block";
  $("detail-view").style.display = "none";
  loadList();
}

function daysAgo(dateStr) {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

async function loadList() {
  const search = $("search-box").value.trim();
  const category = $("category-filter").value;

  let q = supabase.from("inventory_items").select("*").order("name");
  if (search) q = q.ilike("name", `%${search}%`);
  if (category) q = q.eq("category", category);
  const [{ data, error }, multiplier] = await Promise.all([q, getDefaultValueMultiplier()]);

  const container = $("inventory-list");
  if (error) {
    container.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    container.innerHTML = `<div class="empty-state">No inventory yet — it fills up as you log purchases.</div>`;
    return;
  }

  const thumbUrls = await Promise.all(
    data.map((item) => (item.image_url ? getMediaSignedUrl(item.image_url).catch(() => null) : Promise.resolve(null))),
  );

  container.innerHTML = data
    .map((item, i) => {
      const thumb = thumbUrls[i]
        ? `<img src="${thumbUrls[i]}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0" />`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--border);flex-shrink:0"></div>`;
      const ageNote = item.quantity > 0 ? ` · ${daysAgo(item.updated_at)}d in stock` : "";
      const value = estimatedValueFor(item, multiplier);
      const valueTag = item.estimated_value != null ? "" : ` <span class="badge badge-ai">est.</span>`;
      return `
      <div class="list-row" style="cursor:pointer" data-id="${item.id}">
        <div style="display:flex;align-items:center;gap:10px">
          ${thumb}
          <div>
            <div class="title">${escapeHtml(item.name)}</div>
            <div class="meta">${CATEGORY_LABEL[item.category] || item.category} · ${item.quantity} in stock${ageNote}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="title">${money(item.quantity * value)}${valueTag}</div>
          <div class="meta">cost ${money(item.avg_unit_cost)}</div>
        </div>
      </div>`;
    })
    .join("");
  container.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.id)));
}

async function openDetail(id) {
  $("list-view").style.display = "none";
  $("detail-view").style.display = "block";
  const body = $("detail-body");
  body.innerHTML = `<p class="spinner-text">Loading…</p>`;

  const [{ data: item, error }, multiplier] = await Promise.all([
    supabase.from("inventory_items").select("*").eq("id", id).single(),
    getDefaultValueMultiplier(),
  ]);
  if (error) {
    body.innerHTML = `<p class="field-error">${escapeHtml(error.message)}</p>`;
    return;
  }

  let imageHtml = "";
  if (item.image_url) {
    try {
      const url = await getMediaSignedUrl(item.image_url);
      imageHtml = `<img src="${url}" style="width:100%;max-width:280px;border-radius:10px;margin-bottom:10px" />`;
    } catch {
      /* ignore missing image */
    }
  }

  const autoEstimate = Number(item.avg_item_cost) * multiplier;
  const isManual = item.estimated_value != null;

  body.innerHTML = `
    ${imageHtml}
    <label for="i-photo">${item.image_url ? "Replace photo" : "Add a photo"}</label>
    <input id="i-photo" type="file" accept="image/*" />

    <label for="i-name">Name</label>
    <input id="i-name" value="${escapeHtml(item.name)}" />
    <label for="i-category">Category</label>
    <select id="i-category">
      <option value="funko" ${item.category === "funko" ? "selected" : ""}>Funko</option>
      <option value="pokemon_card" ${item.category === "pokemon_card" ? "selected" : ""}>Pokémon card</option>
      <option value="other" ${item.category === "other" ? "selected" : ""}>Other</option>
    </select>
    <label for="i-details">Details / notes</label>
    <input id="i-details" value="${escapeHtml(item.details?.note || "")}" placeholder="Set, variant, condition, …" />
    <div class="btn-row">
      <button class="btn" id="save-basic-btn">Save</button>
    </div>

    <h3 style="margin-top:24px">Stock &amp; value</h3>
    <p class="meta">Currently <strong>${item.quantity}</strong> in stock. Cost basis (what you paid, per unit): ${money(item.avg_unit_cost)} — this is what profit is calculated against and never changes here.</p>
    ${item.quantity > 0 ? `<p class="meta">Sitting since last restock: ${daysAgo(item.updated_at)} day(s)</p>` : ""}

    <label for="i-value">Estimated resale value per unit ${sourceBadgeLike(isManual)}</label>
    <input id="i-value" type="number" step="0.01" min="0" value="${item.estimated_value ?? ""}" placeholder="auto: ${autoEstimate.toFixed(2)} (item cost × ${multiplier})" />
    <p class="hint">Leave blank to auto-estimate at ${multiplier}× the item's cost (excl. shipping). Tell us the real number here whenever you know it — this is what "inventory value" on the dashboard uses, total right now: ${money(item.quantity * (isManual ? Number(item.estimated_value) : autoEstimate))}.</p>
    <div class="btn-row">
      <button class="btn secondary" id="save-value-btn">Save value</button>
      ${isManual ? `<button class="btn secondary" id="clear-value-btn">Revert to auto-estimate</button>` : ""}
    </div>

    <label for="i-adjust" style="margin-top:20px">Adjust quantity by (use a negative number to reduce)</label>
    <input id="i-adjust" type="number" step="1" value="0" />
    <label for="i-adjust-note">Reason (required)</label>
    <input id="i-adjust-note" placeholder="e.g. found a broken one, damaged in storage, miscount" />
    <div class="btn-row">
      <button class="btn secondary" id="save-adjust-btn">Apply adjustment</button>
    </div>
    <p class="field-error" id="detail-error" style="display:none"></p>
  `;

  $("i-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = $("detail-error");
    errorEl.style.display = "none";
    try {
      const path = await uploadMedia(file, "item");
      await setInventoryImage(id, path);
      openDetail(id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  $("save-basic-btn").addEventListener("click", async () => {
    const errorEl = $("detail-error");
    errorEl.style.display = "none";
    try {
      await supabase
        .from("inventory_items")
        .update({
          name: $("i-name").value,
          category: $("i-category").value,
          details: { note: $("i-details").value },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      showList();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  $("save-value-btn").addEventListener("click", async () => {
    const errorEl = $("detail-error");
    errorEl.style.display = "none";
    const raw = $("i-value").value;
    if (raw === "") {
      errorEl.textContent = "Enter a value, or use \"Revert to auto-estimate\" to clear it.";
      errorEl.style.display = "block";
      return;
    }
    try {
      await setEstimatedValue(id, Number(raw));
      showList();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });

  const clearBtn = $("clear-value-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      const errorEl = $("detail-error");
      errorEl.style.display = "none";
      try {
        await setEstimatedValue(id, null);
        showList();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = "block";
      }
    });
  }

  $("save-adjust-btn").addEventListener("click", async () => {
    const errorEl = $("detail-error");
    errorEl.style.display = "none";
    const delta = Number($("i-adjust").value) || 0;
    const note = $("i-adjust-note").value.trim();
    if (!delta) {
      errorEl.textContent = "Enter a non-zero adjustment.";
      errorEl.style.display = "block";
      return;
    }
    if (!note) {
      errorEl.textContent = "A reason is required for every stock adjustment.";
      errorEl.style.display = "block";
      return;
    }
    try {
      const newQuantity = Math.max(0, item.quantity + delta);
      await supabase
        .from("inventory_items")
        .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
        .eq("id", id);
      await supabase.from("stock_adjustments").insert({ inventory_item_id: id, quantity_delta: delta, note });
      showList();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    }
  });
}

function sourceBadgeLike(isManual) {
  return isManual
    ? `<span class="badge badge-human">you</span>`
    : `<span class="badge badge-ai">auto-estimate</span>`;
}

main();
