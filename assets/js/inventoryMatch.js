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
