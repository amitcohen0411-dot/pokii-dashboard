import { supabase } from "./supabaseClient.js";

// Simple substring search used to suggest existing inventory items to match
// an AI-guessed or hand-typed line item against. Deliberately name-only: a
// freshly-added draft line defaults to category "other" until the user picks
// one, and filtering matches by that default would hide an exact name match
// against an item actually stored under "funko" or "pokemon_card" — category
// is descriptive metadata here, not part of an item's identity.
export async function searchInventory(query) {
  let q = supabase.from("inventory_items").select("id,name,category,quantity,avg_unit_cost").order("name").limit(8);
  if (query && query.trim()) q = q.ilike("name", `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createInventoryItem({ name, category }) {
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({ name, category, quantity: 0, avg_unit_cost: 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Creates a new inventory item directly with known quantity/cost, bypassing
// the purchase flow entirely — for stock you're entering by hand (e.g. a
// haul that was never logged as a purchase). Deliberately posts no
// transaction: this only records stock you already own, it doesn't spend
// money, so it must never touch account balances. itemOnlyPrice isn't known
// separately here (no shipping breakdown to split out), so avg_item_cost
// is set equal to avg_unit_cost — the default resale-value estimate will
// simply be based on the full per-unit cost you entered.
export async function createManualInventoryItem({ name, category, quantity, unitCost, estimatedValue }) {
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      name,
      category,
      quantity,
      avg_unit_cost: unitCost,
      avg_item_cost: unitCost,
      estimated_value: estimatedValue ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Edits a manually-tracked item (created via createManualInventoryItem, e.g.
// a trade-in) in place — quantity is SET, not added to, unlike addStock.
// Cost is deliberately untouched here (stays at whatever it was created
// with, usually 0) since editing this is about the item's identity/value,
// not re-stating what it cost.
export async function updateManualInventoryItem(itemId, { name, category, quantity, estimatedValue }) {
  const { error } = await supabase
    .from("inventory_items")
    .update({
      name,
      category,
      quantity,
      estimated_value: estimatedValue ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function getInventoryItem(id) {
  const { data, error } = await supabase.from("inventory_items").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

// Adds `quantity` units to an inventory item, recalculating its
// quantity-weighted average cost. `unitCost` is the full landed cost (item +
// its shipping share) — this is the real cost basis used for profit/COGS
// math and must stay accurate to what was actually paid. `itemOnlyPrice` is
// the same unit's price before shipping — kept separately purely as the base
// for the default resale-value estimate (see estimated_value on this table),
// which is a different question from cost basis and must never be confused
// with it.
export async function addStock(itemId, quantity, unitCost, itemOnlyPrice = unitCost) {
  const item = await getInventoryItem(itemId);
  const newQuantity = item.quantity + quantity;
  const newAvgCost =
    newQuantity > 0
      ? (item.quantity * Number(item.avg_unit_cost) + quantity * unitCost) / newQuantity
      : 0;
  const newAvgItemCost =
    newQuantity > 0
      ? (item.quantity * Number(item.avg_item_cost) + quantity * itemOnlyPrice) / newQuantity
      : 0;
  const { error } = await supabase
    .from("inventory_items")
    .update({
      quantity: newQuantity,
      avg_unit_cost: newAvgCost,
      avg_item_cost: newAvgItemCost,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) throw error;
}

export async function setEstimatedValue(itemId, value) {
  const { error } = await supabase
    .from("inventory_items")
    .update({ estimated_value: value, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

// Shared with inventory.js/dashboard.js/sales.js: estimated_value is the
// source of truth when set by hand, otherwise fall back to the default
// multiplier against the item-only cost (never avg_unit_cost — that's the
// real cost basis used for profit math and must stay untouched).
export function estimatedValueFor(item, multiplier) {
  return item.estimated_value != null ? Number(item.estimated_value) : Number(item.avg_item_cost) * multiplier;
}

let cachedMultiplier = null;
export async function getDefaultValueMultiplier() {
  if (cachedMultiplier !== null) return cachedMultiplier;
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "default_value_multiplier")
    .single();
  cachedMultiplier = error || !data ? 1.9 : Number(data.value) || 1.9;
  return cachedMultiplier;
}

// Removes `quantity` units from an inventory item (used by sales / purchase
// deletion). Cost basis (avg_unit_cost) is left as-is — selling stock doesn't
// change what the remaining stock cost. Clamped at 0.
export async function removeStock(itemId, quantity) {
  const item = await getInventoryItem(itemId);
  const newQuantity = Math.max(0, item.quantity - quantity);
  const { error } = await supabase
    .from("inventory_items")
    .update({ quantity: newQuantity, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

export async function setInventoryImage(itemId, mediaPath) {
  const { error } = await supabase
    .from("inventory_items")
    .update({ image_url: mediaPath, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw error;
}

// Mirrors orders.js's deriveState / dashboard.js's isFullyReceived: a
// purchase only counts as physically in hand once its forwarder shipment (if
// any) has arrived — a forwarder-less purchase counts once its own status is
// "received".
function isPurchaseReceived(p) {
  if (!p.forwarder) return p.status === "received";
  if (!p.forwarder_shipments) return false;
  return Boolean(p.forwarder_shipments.received_at);
}

// Stock is added to inventory_items the moment a purchase is logged (see
// addStock above), regardless of shipping status — so `quantity` conflates
// "own it" with "physically home". This sums, per inventory item, how many
// of those units still trace back to a not-yet-received purchase, so callers
// can split "home" value from "in transit" value without changing how stock
// itself accrues.
export async function getInTransitQuantities() {
  const { data, error } = await supabase
    .from("purchase_line_items")
    .select("inventory_item_id, quantity, purchases!inner(status, forwarder, forwarder_shipments(received_at))")
    .not("inventory_item_id", "is", null)
    .neq("purchases.status", "cancelled");
  if (error || !data) return new Map();
  const map = new Map();
  for (const line of data) {
    if (isPurchaseReceived(line.purchases)) continue;
    map.set(line.inventory_item_id, (map.get(line.inventory_item_id) || 0) + line.quantity);
  }
  return map;
}
