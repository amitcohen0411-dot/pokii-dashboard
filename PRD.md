# PRD: Pokii Dashboard

> **For:** Claude Code
> **Owner:** Amit Cohen + partner
> **Status:** Ready to build
> **Date:** 2026-09-13
> **Version:** 1.0

---

## 0. How to use this document

This PRD is the source of truth for building the project. Read it top to bottom before writing any code. Sections marked **[Claude-Code-Critical]** must be followed exactly. Section 11 (Build Phases) is the execution order; do not skip ahead.

---

## 1. One-line pitch

A shared, no-login-friction web dashboard for a two-person Funko Pop / Pokémon card resale business: log purchases and sales by photo, video, or text, let AI extract the structured details, keep a live inventory, and always know where the money is.

## 2. Problem & rationale

**Problem:** Amit and his partner currently track purchases by writing amounts on WhatsApp ("X from our balance"). There are no photos, no structured records, no real inventory, and no visibility into cash flow or what's in transit.

**Why now:** The business has enough purchase/sale volume that WhatsApp math no longer gives an accurate picture of stock or money. They want to stop using WhatsApp for this entirely.

**Why this approach:** A spreadsheet was considered but rejected — it can't take a photo of a haul and turn it into structured, correctly-costed inventory rows, and it doesn't distinguish "the AI guessed this" from "we confirmed this." A small custom web app with AI-assisted capture solves both.

## 3. Target user

- **Primary persona:** Amit and his business partner — two adults running a Funko Pop / Pokémon card resale side business in Israel. Comfortable with phones, not developers. They act as a single shared identity — there's no need to distinguish who did what.
- **Secondary personas:** None — this is a private, two-person internal tool.
- **Anti-persona:** Not a public storefront, not a multi-seller marketplace, not built for customers to interact with.

## 4. Goals & success metrics

- **MVP success metric:** Within the first month, every real purchase and sale is logged in the app instead of WhatsApp, and Amit can answer "how much cash do we have and what's it worth in stock" without doing manual math.
- **Long-term success metric:** Accurate month-over-month profit (revenue minus true cost including shipping) visible at a glance, informing what to buy/sell more of.
- **Out-of-scope metrics:** Multi-user analytics, growth metrics, engagement tracking — not relevant to a 2-person internal tool.

## 5. Scope

### 5.1 MVP (must ship first)
- Shared single-passcode login (Supabase Auth, one shared account, no per-user accounts)
- Dashboard: cash balances (Bit + cash), total inventory value, value of orders in transit, this month's spend, this month's revenue, this month's profit
- Log a purchase: text note, photo, or video → AI (Gemini) extracts item(s)/price/discount when visible in the media → reviewable/editable staging screen before it's saved → on confirm, creates the purchase, its line items, updates inventory, and records the cash-out transaction
- Every extracted field is visibly tagged as **AI-extracted**, **human-entered**, or **edited-after-AI**; anything the AI couldn't determine is visibly flagged as **missing**, not silently defaulted
- Purchase shipping cost is split across that purchase's line items proportional to item price, so each item's true landed cost is known
- Manual order status per purchase: Ordered → Shipped → Received / Cancelled (no third-party auto-sync — see §5.3)
- Inventory list: current stock, avg. cost, current total value; manually editable at any time
- Log a sale ("quick sale" flow for e.g. conventions): photo or text + sale price + payment account → AI matches against current inventory (surfacing duplicate/same-item candidates for human confirmation rather than guessing) → on confirm, decrements inventory and records the cash-in transaction, with per-item profit computed against that item's cost basis
- One-time bulk import: send a receipt photo covering many items, review the extracted list like any other purchase

### 5.2 V1 (after MVP works)
- Buy/sell recommendations based on stock age, turnover, and margin
- Multi-currency support (beyond ILS) if they start buying abroad
- CSV export of transactions for accounting

### 5.3 Explicitly out of scope (do NOT build)
- Per-user accounts, roles, or permissions — there is intentionally one shared identity
- Live/automated eBay or Vinted order-status syncing — not reliably possible without fragile scraping or seller-only APIs; status is updated manually by the user instead
- Public storefront / customer-facing pages
- Barcode/SKU scanning hardware integration
- Tax or formal accounting compliance reports
- Payment processing of any kind — this app only *records* what balances changed, it never moves real money

## 6. User flows

### 6.1 Log a purchase (primary flow)
1. User opens the app, enters the shared passcode → lands on `/dashboard.html`
2. Clicks "New purchase" → `/purchases.html#new`
3. Chooses to attach a photo, a video, or just type a note; fills in what they already know (source, payment account, shipping cost if not visible)
4. Clicks "Analyze" (only shown if media attached) → media uploads to Supabase Storage → edge function `analyze-media` is called → returns a draft list of line items (name, category, quantity, unit price, discount %, confidence) plus any detected shipping/total
5. Draft screen shows every field with a colored source tag (AI / human / missing) and lets the user edit any value inline, add a missing item, or delete a wrongly-detected one
6. User sets/reviews order status (defaults to "Ordered") and confirms
7. On confirm: shipping is allocated across line items, a `purchases` row + `purchase_line_items` rows are created, matched/new `inventory_items` are upserted (quantity += , avg_unit_cost recalculated as weighted average), and a negative `transactions` row is created against the chosen account
8. Ends back on `/purchases.html` with the new purchase visible in the list

### 6.2 Quick sale at a convention
1. From `/sales.html`, click "New sale"
2. Take/upload a photo of the item(s) being sold, or skip photo and type instead
3. Enter total sale price and payment account (Bit / cash)
4. Click "Analyze" → edge function returns guessed item name(s)/quantities
5. For each guessed item, the app searches `inventory_items` for name/category matches and shows the candidates (including when there are multiple identical copies in stock) — user picks the correct match(es) or types a manual match if the AI missed
6. Confirm → `sales` + `sale_line_items` rows created, matched `inventory_items.quantity` decremented, a positive `transactions` row created, and per-line profit computed as `(unit_price - unit_cost_basis) * quantity` using the inventory item's current average cost
7. Ends back on `/sales.html` with the sale visible, profit shown per line

### 6.3 Update order status
1. From `/purchases.html`, open a purchase still marked "Ordered" or "Shipped"
2. Change the status dropdown to "Shipped" / "Received" / "Cancelled"
3. On "Received", nothing else changes (the item was already added to inventory at capture time — see §14 assumption). On "Cancelled", the app prompts to reverse the inventory + transaction it created, since the purchase never actually happened

### 6.4 Check the day's numbers
1. Open `/dashboard.html`
2. See: Bit balance, cash balance, total inventory value, value of orders still "Ordered"/"Shipped" (in transit), this calendar month's total spend, total revenue, and profit (revenue − cost of goods sold for items sold this month)

---

## 7. Tech stack & architecture **[Claude-Code-Critical]**

### 7.1 Stack

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Frontend | Plain HTML + CSS + vanilla JS (ES modules) | n/a | No Node.js is available on the dev machine — must be build-free. Loaded straight in the browser, no bundler. |
| Supabase client | `@supabase/supabase-js` | v2, via `esm.sh` CDN import | No install step needed; works as a native ES module import. |
| Backend/DB | Supabase Postgres | current GA | Free tier, instant REST/RPC via client SDK, built-in RLS. |
| Auth | Supabase Auth, one shared email/password | n/a | Satisfies "we act as one identity" while still getting real session security instead of hand-rolled passcode logic. |
| File storage | Supabase Storage, private bucket `media` | n/a | Stores purchase/sale photos & videos. |
| AI extraction | Google Gemini API (free tier), called from a Supabase Edge Function | `gemini-1.5-flash` (or current equivalent free-tier vision model) | Free tier is sufficient at this volume; keeps the API key server-side, never exposed to the browser. |
| Edge runtime | Supabase Edge Functions (Deno) | n/a | No Node needed to write or deploy these — handled via the Supabase MCP tools already connected in this environment. |
| Hosting | Netlify Drop (or GitHub Pages) | n/a | Both deploy a static folder with **no CLI and no Node** — drag-and-drop or a plain git push. |

### 7.2 High-level architecture

```
[Browser: static HTML/JS] --Supabase JS SDK--> [Supabase Postgres + Auth + Storage]
        |                                              ^
        | uploads photo/video to Storage               |
        | calls Edge Function "analyze-media" ----------
        v
[Supabase Edge Function] --HTTPS--> [Gemini API] --JSON--> back to Browser for review
```

The browser talks to Supabase directly for all normal reads/writes (protected by RLS + the shared login session). The only server-side code is the one edge function that proxies a media file to Gemini and returns structured JSON — it does not write to the database itself, so nothing is ever saved without a human confirming the draft first.

### 7.3 Third-party services & accounts needed
- **Supabase**: project already being provisioned via this session's connected account. Free tier is $0/month (confirmed).
- **Google AI Studio (Gemini API)**: user creates their own free API key at aistudio.google.com — required for photo/video analysis to work; the app runs fine without it, just without auto-extraction (manual entry still works).
- **Netlify** (or GitHub): free static hosting so both partners can reach the app from their phones.

### 7.4 Environment variables / secrets

| Var | Where it lives | Used by | Secret? |
|---|---|---|---|
| `SUPABASE_URL` | `assets/js/config.js` (public) | browser | no — safe to expose |
| `SUPABASE_ANON_KEY` | `assets/js/config.js` (public) | browser | no — safe to expose, RLS does the real protection |
| `GEMINI_API_KEY` | Supabase Edge Function secret (set via Supabase dashboard → Project Settings → Edge Functions → Secrets) | `analyze-media` edge function only | **yes — never put this in any browser-facing file** |

---

## 8. File / folder structure **[Claude-Code-Critical]**

```
pokii-dashboard/
├── PRD.md
├── README.md
├── index.html                    # passcode/login gate, redirects to dashboard.html on success
├── dashboard.html                 # balances, inventory value, monthly stats
├── purchases.html                 # list + new-purchase capture/review flow
├── inventory.html                 # browse/search/edit inventory items
├── sales.html                     # list + quick-sale capture/review flow
├── assets/
│   ├── css/
│   │   └── style.css              # shared styles, mobile-first
│   └── js/
│       ├── config.js              # SUPABASE_URL + SUPABASE_ANON_KEY constants
│       ├── supabaseClient.js      # creates and exports the shared supabase client
│       ├── auth.js                # login(), logout(), requireSession() guard used on every page
│       ├── format.js              # ILS currency formatting, date formatting, source-tag badge helper
│       ├── nav.js                 # injects shared top nav + logout button
│       ├── media.js               # upload photo/video to Storage, call analyze-media edge function
│       ├── dashboard.js           # dashboard.html logic
│       ├── purchases.js           # purchases.html logic (list, capture, review, confirm, status change)
│       ├── inventory.js           # inventory.html logic
│       └── sales.js               # sales.html logic (list, capture, match, confirm)
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql          # full schema, RLS, seed accounts row
│   └── functions/
│       └── analyze-media/
│           └── index.ts           # Deno edge function calling Gemini
└── .gitignore
```

---

## 9. Database schema **[Claude-Code-Critical]**

All tables live in the `public` schema. RLS is enabled on every table with one uniform policy set (see below) — there is no per-row ownership because both partners share one login.

### Table: `accounts`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | text | PK | `'bit'` or `'cash'` |
| label | text | not null | display name |
| starting_balance | numeric(10,2) | not null default 0 | user-editable opening balance |
| updated_at | timestamptz | default now() | |

Seed rows: `('bit','Bit',0)`, `('cash','Cash',0)`.

### Table: `inventory_items`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| name | text | not null | |
| category | text | not null, check in ('funko','pokemon_card','other') | |
| details | jsonb | not null default '{}' | free-form: set/series, character, card number, variant, condition, exclusive, chase, etc. |
| image_url | text | | storage path to a representative photo |
| quantity | integer | not null default 0 | current stock |
| avg_unit_cost | numeric(10,2) | not null default 0 | weighted-average cost basis, recalculated on every purchase |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

### Table: `purchases`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| source | text | | e.g. 'ebay', 'vinted', 'local', 'other' |
| status | text | not null default 'ordered', check in ('ordered','shipped','received','cancelled') | |
| order_date | date | not null default current_date | |
| items_subtotal | numeric(10,2) | not null default 0 | sum of raw line-item prices before shipping allocation |
| shipping_amount | numeric(10,2) | not null default 0 | |
| total_amount | numeric(10,2) | not null default 0 | items_subtotal + shipping_amount |
| payment_account | text | not null, references accounts(id) | |
| notes | text | | |
| media_url | text | | storage path, nullable |
| media_type | text | check in ('image','video', null) | |
| ai_status | text | not null default 'none', check in ('none','pending','done','failed') | |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | |

### Table: `purchase_line_items`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| purchase_id | uuid | FK → purchases(id) on delete cascade | |
| inventory_item_id | uuid | FK → inventory_items(id) on delete set null | set when matched/created on confirm |
| name_raw | text | not null | |
| category | text | | |
| quantity | integer | not null default 1 | |
| unit_price | numeric(10,2) | not null default 0 | raw price, pre shipping allocation, post discount |
| discount_percent | numeric(5,2) | | nullable |
| allocated_shipping | numeric(10,2) | not null default 0 | this line's share of the purchase's shipping_amount |
| unit_cost | numeric(10,2) | not null default 0 | `unit_price + allocated_shipping/quantity` — feeds inventory avg cost |
| field_source | jsonb | not null default '{}' | e.g. `{"name_raw":"ai","unit_price":"human","discount_percent":"ai"}` — values are `"ai"` \| `"human"` \| `"edited"` |
| confidence | numeric(3,2) | | AI confidence 0–1, null if human-entered |
| created_at | timestamptz | default now() | |

### Table: `sales`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| sale_date | date | not null default current_date | |
| channel | text | | e.g. 'convention', 'online', 'other' |
| payment_account | text | not null, references accounts(id) | |
| total_amount | numeric(10,2) | not null default 0 | |
| notes | text | | |
| media_url | text | | nullable |
| media_type | text | check in ('image','video', null) | |
| ai_status | text | not null default 'none', check in ('none','pending','done','failed') | |
| created_at | timestamptz | default now() | |

### Table: `sale_line_items`
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| sale_id | uuid | FK → sales(id) on delete cascade | |
| inventory_item_id | uuid | FK → inventory_items(id) on delete set null | |
| name_raw | text | not null | |
| quantity | integer | not null default 1 | |
| unit_price | numeric(10,2) | not null default 0 | sale price per unit |
| unit_cost_basis | numeric(10,2) | not null default 0 | copied from `inventory_items.avg_unit_cost` at confirm time |
| field_source | jsonb | not null default '{}' | |
| confidence | numeric(3,2) | | |
| created_at | timestamptz | default now() | |

### Table: `transactions` (cash-flow ledger)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| account | text | not null, references accounts(id) | |
| amount | numeric(10,2) | not null | positive = money in, negative = money out |
| kind | text | not null, check in ('purchase','sale','adjustment') | |
| related_purchase_id | uuid | FK → purchases(id) on delete set null | |
| related_sale_id | uuid | FK → sales(id) on delete set null | |
| note | text | | |
| occurred_at | timestamptz | not null default now() | |
| created_at | timestamptz | default now() | |

### Table: `ai_extractions` (audit log)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | uuid | PK default gen_random_uuid() | |
| media_url | text | not null | |
| target_type | text | check in ('purchase','sale') | |
| target_id | uuid | | nullable until the parent row is confirmed/created |
| raw_response | jsonb | not null | full Gemini response, kept for debugging bad extractions |
| model | text | not null | |
| created_at | timestamptz | default now() | |

### View: `account_balances`
```sql
create view account_balances as
select a.id, a.label, a.starting_balance
     + coalesce(sum(t.amount), 0) as current_balance
from accounts a
left join transactions t on t.account = a.id
group by a.id, a.label, a.starting_balance;
```

### Indexes
- `purchase_line_items(purchase_id)`
- `sale_line_items(sale_id)`
- `transactions(account)`, `transactions(occurred_at)`
- `purchases(status)`, `purchases(order_date)`
- `sales(sale_date)`
- `inventory_items` — enable `pg_trgm` extension and add a GIN trigram index on `name` for fuzzy matching during the sale-matching flow: `create index inventory_items_name_trgm on inventory_items using gin (name gin_trgm_ops);`

### RLS policies (all tables, uniform)
Every table: `alter table X enable row level security;` then one policy per action, all identical since there's a single shared identity:
```sql
create policy "authenticated full access" on X
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
```
Storage bucket `media`: private, with a matching `storage.objects` policy scoped to `auth.role() = 'authenticated'` for select/insert.

---

## 10. API endpoints **[Claude-Code-Critical]**

There is no custom REST API for data — the browser talks to Supabase Postgres directly via the JS SDK (`supabase.from('table').select/insert/update/delete()`), protected by the RLS policies in §9. The **only** custom server endpoint is the edge function below.

### `POST /functions/v1/analyze-media`
- **Auth:** required — caller must send the user's Supabase session access token as `Authorization: Bearer <token>`
- **Body:**
```json
{
  "media_path": "string — storage path inside the 'media' bucket",
  "media_type": "image | video",
  "mode": "purchase | sale",
  "hint": "string, optional — any free-text note the user typed alongside the media"
}
```
- **Behavior:** downloads the file from Supabase Storage using the function's service-role key, sends it to Gemini with a prompt requesting strict JSON describing every distinct item visible (name, best-guess category, quantity, unit price if a price/tag is visible, discount percent if a discount is visible, a 0–1 confidence per item), plus a total and shipping amount if a receipt is visible. Logs the raw response into `ai_extractions`. Does **not** write to any purchase/sale/inventory table — extraction is always a draft the client must let the human confirm.
- **Response 200:**
```json
{
  "items": [
    { "name": "Charizard EX 183/165", "category": "pokemon_card", "quantity": 1, "unit_price": 12.5, "discount_percent": null, "confidence": 0.86 }
  ],
  "shipping_amount": 5.0,
  "total_amount": 17.5,
  "confidence_notes": "string, optional — anything the model flagged as unclear"
}
```
- **Response 400:** `{ "error": "missing media_path" }` (or similar validation message)
- **Response 401:** `{ "error": "unauthorized" }`
- **Response 502:** `{ "error": "gemini request failed", "detail": "..." }`

---

## 11. Build phases **[Claude-Code-Critical]**

### Phase 1: Project bootstrap
**Tasks:**
- Create the file/folder structure from §8
- Write `assets/css/style.css` with the shared mobile-first layout, nav, cards, form, and badge styles
- Write `index.html` (passcode gate) and stub `dashboard.html`, `purchases.html`, `inventory.html`, `sales.html` with shared nav
- Write `README.md` covering: what this is, how to get a Gemini key, how to run the Supabase migration, how to deploy

**Acceptance:** Opening `index.html` directly in a browser renders the passcode form with no console errors (Supabase calls will fail until Phase 2, and that's fine at this point).

### Phase 2: Database + auth
**Tasks:**
- Once a Supabase project is available: apply `supabase/migrations/0001_init.sql` (all tables, view, indexes, RLS, seed `accounts` rows)
- Create the private `media` storage bucket + its RLS policy
- Create the one shared Supabase Auth user (email + the agreed passcode as password — Supabase requires 6+ characters, so pad/derive a password from `1104` and document it in `README.md`)
- Fill in real values in `assets/js/config.js`
- Wire `auth.js`: `login(password)` signs in with the fixed shared email + entered passcode, `requireSession()` redirects to `index.html` if there's no session, `logout()` clears it

**Acceptance:** Entering the correct passcode on `index.html` redirects to `dashboard.html` and stays logged in on reload; a wrong passcode shows an inline error; visiting `dashboard.html` directly without a session redirects back to `index.html`.

### Phase 3: Dashboard
**Tasks:**
- Query `account_balances` view for Bit + cash balances
- Compute inventory value: `sum(quantity * avg_unit_cost)` over `inventory_items`
- Compute in-transit value: `sum(total_amount)` over `purchases` where `status in ('ordered','shipped')`
- Compute this month's spend: `sum(total_amount)` over `purchases` where `order_date` is in the current calendar month and `status != 'cancelled'`
- Compute this month's revenue: `sum(unit_price * quantity)` over `sale_line_items` joined to `sales` where `sale_date` is in the current month
- Compute this month's profit: revenue above minus `sum(unit_cost_basis * quantity)` over the same joined rows
- Render all of the above as cards, mobile-first

**Acceptance:** With at least one seeded purchase and one sale (test data), all six numbers on the dashboard match a hand-calculated expectation.

### Phase 4: Purchases — capture, AI review, confirm
**Tasks:**
- "New purchase" form: source, order date, payment account, shipping amount (optional — may come from AI), notes, optional photo/video upload, optional free-text hint
- On "Analyze" (only enabled if media attached): upload to Storage under `media/purchases/{uuid}/...`, call `analyze-media`, populate a draft line-items table
- Draft/review UI: each line item is editable inline; every field shows a small badge — green "AI" / grey "you" / amber "edited" / red "missing" (per `field_source`) using the helper in `format.js`; allow add-row and delete-row
- On confirm: allocate `shipping_amount` across line items proportional to `unit_price * quantity`, compute `unit_cost` per line, upsert `inventory_items` (match by name+category+details, else create; recalc `avg_unit_cost` as a quantity-weighted average of old stock cost and new purchase cost), insert `purchases` + `purchase_line_items`, insert a negative `transactions` row for the chosen account
- Purchases list: table of all purchases with status, total, date; clicking a row opens it for status change or edit (editing after confirm should also let you adjust line items, re-running the same inventory/transaction recalculation — do this by reversing the old inventory/transaction effect and reapplying the new one, rather than double-counting)
- Status change to "Cancelled" prompts to reverse that purchase's inventory additions and its transaction

**Acceptance:** Uploading a real product photo produces a plausible draft; editing every field updates its badge to "edited"; confirming creates correct rows in all four affected tables and the dashboard numbers update accordingly; cancelling a purchase removes its stock and refunds its transaction.

### Phase 5: Inventory
**Tasks:**
- List view: search box (name), grouped/filterable by category, showing quantity + avg cost + line value per item
- Manual edit: rename, change category/details, manually adjust quantity (writes a `transactions`-free stock correction — quantity only, cost unaffected) with a required short note explaining the adjustment
- Empty state when there's no stock yet

**Acceptance:** Editing an item's quantity manually updates the dashboard's inventory value; search filters correctly on partial name match.

### Phase 6: Sales — quick-sale capture, matching, confirm
**Tasks:**
- "New sale" form: sale date, channel, payment account, total amount, optional photo, optional free-text hint
- On "Analyze": same upload + `analyze-media` call with `mode: "sale"`, returns guessed item name(s)/quantities
- Matching UI: for each guessed line, run a fuzzy search (`ilike` / trigram similarity) against `inventory_items` and show the top matches (including explicitly surfacing when an item has `quantity > 1`, i.e. there may be duplicates, so the user confirms which/how many); allow picking "no match — create new item" or typing a manual search if the AI's guess was wrong
- On confirm: decrement matched `inventory_items.quantity`, copy current `avg_unit_cost` into `unit_cost_basis` on the line item, insert `sales` + `sale_line_items`, insert a positive `transactions` row, show computed per-line profit immediately after saving
- Sales list: table of past sales with total and total profit per sale

**Acceptance:** Selling 1 of 3 identical stocked items leaves quantity at 2 and the correct item still shows in inventory; the sale's profit matches `(unit_price - unit_cost_basis) * quantity` by hand calculation.

### Phase 7: Polish & deploy
**Tasks:**
- Loading states on every Supabase call (simple inline spinner/text)
- Empty states on every list (purchases, sales, inventory) with a friendly prompt to add the first one
- Responsive check at 375px (phone), 768px (tablet), 1280px (desktop) — this app will mostly be used on phones
- Deploy: drag the project folder into Netlify Drop (netlify.com/drop) or push to a GitHub repo and enable GitHub Pages — document the exact steps taken in `README.md`
- Smoke test the full primary flow (§6.1) end-to-end on the deployed URL from an actual phone

**Acceptance:** The deployed URL works end-to-end for logging a purchase and a sale from a phone browser, and both partners can reach it.

---

## 12. UI / UX guidelines

- **Visual reference:** Clean, dense, utilitarian — closer to a personal finance app (e.g. a simple ledger) than a marketing site. No unnecessary chrome.
- **Color tokens:** Neutral background/cards; a single accent color for primary actions; green for "AI-extracted", grey for "human-entered", amber for "edited", red for "missing" field badges; red/green also used for negative/positive cash-flow numbers.
- **Typography:** System font stack (no webfont download needed, keeps it build-free and fast).
- **Component library:** None — hand-rolled minimal CSS, since this is a small, build-free app.
- **Dark mode:** Optional, follow `prefers-color-scheme`, not a hard requirement.
- **Languages & RTL:** English UI only, left-to-right. Currency is ILS (₪) throughout.
- **Mobile breakpoints:** Design mobile-first (this will mostly be used on phones, including at conventions); make sure it also works acceptably at tablet/desktop widths.
- **Animations:** Minimal — simple opacity/height transitions only where they clarify state changes (e.g. a draft row appearing).
- **Empty states:** Friendly, one-line, with a clear call to action ("No purchases yet — log your first one").
- **Loading states:** Simple inline text/spinner; no skeleton screens needed at this scale.

---

## 13. Non-functional requirements

| Concern | Target |
|---|---|
| Page load | Fast on mobile data at a convention — no heavy JS frameworks, no build step, minimal payload |
| Data safety | Every AI-driven write requires human confirmation first — no silent automated writes to inventory or cash balances |
| Accessibility | Reasonable contrast and tap-target sizes; not held to a formal WCAG audit given the 2-person audience |
| Browser support | Latest mobile Safari (iOS) and Chrome (Android), since it'll be used from phones |
| Analytics | None — not needed for a private 2-person tool |
| Error tracking | None — errors surface directly in the UI; this is a small enough app that console errors are sufficient during development |

---

## 14. Open questions / assumptions

- **Assumption:** Inventory is added to stock at the moment a purchase is *logged*, not when its status flips to "Received." This matches wanting to see incoming stock value on the dashboard. If a purchase is later marked "Cancelled," its inventory and transaction effects are reversed (see Phase 4).
- **Assumption:** "Avg unit cost" uses a simple quantity-weighted moving average across all purchases of the same matched item, which is standard and simple; it does not attempt FIFO/LIFO lot tracking.
- **Assumption:** The shared Supabase Auth password is derived from `1104` (padded to meet Supabase's 6-character minimum) — the exact value will be finalized and documented in `README.md` during Phase 2, and can be changed anytime from the Supabase dashboard.
- **Open:** A Supabase project needs to be provisioned before Phase 2 can run for real — the account currently connected to this session is at its 2-project free-tier limit (`kamuti-plus`, `Tergul` both active). Either free up a slot (pause/delete one of those) or upgrade the org, or provide a different Supabase project to point this app at.
- **Open:** A Google Gemini API key needs to be created by the user at aistudio.google.com and set as a Supabase Edge Function secret before AI extraction will work; manual entry works without it in the meantime.

---

## 15. Glossary

- **Bit:** An Israeli person-to-person mobile payment app; one of the two cash accounts tracked by this app (the other being physical cash).
- **Quick sale:** A sale logged on the spot (e.g. at a convention) via a fast photo + price capture flow, as opposed to a more detailed online-sale entry.
- **Field source badge:** The small visual tag on every data field showing whether it was AI-extracted, human-entered, edited after AI extraction, or still missing.

---

## 16. Changelog

### v1.1 — post-launch additions (built after the app was live and verified against production data)

- **Multi-currency purchases.** `purchases` gained `currency` (default `'ILS'`) and `fx_rate` (numeric, default 1). The capture form lets you pick a currency and enter that purchase's exchange rate to ILS by hand (no live-rate API — one less external dependency/API key to manage); Gemini also tries to read the currency symbol off a receipt and pre-selects it. Every stored sum (`items_subtotal`, `shipping_amount`, `total_amount`, and each line's `unit_cost`) is the **ILS-converted** value, so dashboard totals, the cash ledger, and inventory cost never need to know about currency at all — conversion happens once, at save time. `unit_price` on `purchase_line_items` stays in the original currency for traceability. The UI reconstructs the original amount for display as `total_amount / fx_rate` rather than storing it twice. Sales remain ILS-only (matches how the business actually sells).
- **Editing a saved purchase or sale.** Both `purchases.html` and `sales.html` gained a real edit mode: opening an existing record for edit reverses its prior stock/cash effect (same "remove stock, delete its transaction" logic already used for cancel/delete), then re-applies the edited version through the same code path used to create a new one — so there's exactly one save path per entity, not two. Editing a purchase does not re-open the photo/AI-analyze step; it's for correcting values by hand. This replaces the "delete and redo" workaround noted as a known limitation at v1.0.
- **Inventory item photos.** `inventory_items.image_url` (already in the v1.0 schema but never populated) is now set automatically the first time a brand-new item is created from a purchase with a photo attached, and can be uploaded/replaced by hand from the item's detail page. Shown as a thumbnail in the inventory list.
- **Dashboard insight cards.** Two new read-only cards, both dismiss themselves (render nothing) when there's nothing to flag:
  - *"Needs a status update"* — purchases still `ordered`/`shipped` more than 14 days after `order_date`.
  - *"Sitting the longest"* — in-stock items whose `updated_at` (last restock or manual adjustment) is 21+ days old, sorted oldest-first. `updated_at` is a proxy for "hasn't moved," not a dedicated last-sold timestamp — good enough at this scale, but note if it ever needs to be exact.

### v1.2 — freight-forwarder order tracking

Prompted by the volume of orders routed through US package forwarders (Redbox, MyUS) before reaching the user — a purchase now has two independent shipping legs, each with its own tracking and payment.

- **New table `forwarder_shipments`**: one outbound (forwarder → user) shipment, which can bundle several purchases. Fields: `forwarder` (`redbox`/`myus`/`other`), `tracking_number`, `carrier`, `shipping_cost`, `payment_status` (`unpaid`/`paid`) + `paid_at`, `shipped_at`, `expected_arrival_date`, `received_at`, `notes`.
- **`purchases` gained**: `forwarder` (null = ships directly to the user — the existing `status` field alone still covers that case), `tracking_number` (the seller's leg-1 tracking), and `forwarder_shipment_id` (set once this purchase has been bundled into an outbound shipment). When `forwarder` is set, `status = 'received'` means *"arrived at the forwarder,"* not *"arrived at the user"* — the UI relabels the status dropdown accordingly (e.g. "Arrived at Redbox").
- **`transactions` gained** `related_forwarder_shipment_id` and a new `kind = 'shipping'`, so paying a forwarder for leg 2 is its own ledger entry, separate from the original purchase.
- **New page `orders.html`**: every non-cancelled purchase in one place with a derived five-state status (awaiting seller → at forwarder → forwarder unpaid → in transit to you → received), a filter, and a "Forwarder shipments" section to create a shipment, bundle purchases sitting at that forwarder into it, mark it paid (which posts the `shipping`-kind transaction), add tracking/expected-arrival, and mark it arrived (which flips every bundled purchase to `received` in one action). `purchases.html` gained `?id=` deep-linking so Orders rows and dashboard cards can jump straight to a purchase's detail view.
- **Dashboard corrections for accuracy, not just new cards**: "Spend this month" now sums the `transactions` ledger (`purchase` + `shipping` kinds) instead of `purchases.total_amount`, since a shipping payment can land in a different month than its purchase. "In transit" now treats a purchase as still in transit until its *final* leg is done — for a forwarded purchase, that's the linked shipment's `received_at`, not the purchase's own `status`. Two new nudge cards: unpaid forwarder shipments, and shipments past their `expected_arrival_date` with no `received_at`.
- **Explicitly not built — flagged to the user rather than guessed at**: a live eBay/Vinted "connect my account" integration built into the web app itself. Vinted has no public API at all (scraping it would violate their terms and be fragile); eBay has an official buyer order API but using it requires the user to register as an eBay developer and get the app approved for production access, which isn't something this session can do on their behalf, and the user chose to skip pursuing it. Orders from any source are still tracked the same way in the app regardless — logged by hand (with AI-assisted photo capture) — but see v1.3 below for how Vinted got a practical workaround.

### v1.3 — Vinted email sync, a third payment account, and a market-alerts feed

Since Vinted has no API, the user asked to use the *emails* Vinted already sends instead. A real Gmail OAuth flow built into the static site is out of reach here (Google app verification for sensitive scopes is a multi-week process of its own), so this is implemented as **Claude acting as the integration layer**: reading the connected Gmail account directly (via the Gmail MCP connector already available in this environment) and writing structured rows into Supabase — same end result (orders show up in the app), different mechanism than a native in-app "Connect Vinted" button.

- **`app_settings`**: a small key/value table; currently holds `vinted_eur_ils_rate`, the manually-set/looked-up EUR→ILS rate the sync uses (still no live FX API — see v1.1's rationale).
- **`purchases.source_ref`**: stores the Vinted transaction ID, unique when set, so re-running the sync never double-imports the same order.
- **New `accounts` row: `card`**. The historical Vinted data showed real purchases paid by credit card / Google Pay — a genuine third payment method the original Bit/Cash design didn't cover. Dashboard, purchase/sale forms, and the forwarder "mark paid" picker all gained a Card option.
- **One-time historical import**: 9 Vinted "Your receipt for…" emails were found; cross-referencing against separate cancellation/refund emails correctly excluded 4 that were paid then refunded same-day, leaving 5 real, delivered purchases imported with full accuracy (verified: every purchase, inventory item, and the resulting `card` account balance reconciled exactly to the penny). Two of the five were true multi-item Vinted bundles (a single receipt covering several distinct listings) — their item-level cost was split evenly across the named items and noted as such in `purchases.notes`, since Vinted's receipt doesn't itemize a bundle's internal pricing; this is a deliberate, disclosed estimate, not a discovered fact.
- **New table `market_alerts`** (`kind`: coupon/deal/drop, `title`, `description`, `url`, `source`, `expires_at`, `dismissed`) and a dashboard card ("Deals & drops") listing undismissed ones with a dismiss action.
- **Scheduled task `pokii-vinted-and-deals-sync`** (daily, 08:09 local): re-runs the same Vinted parsing/dedup/cancellation-check logic for new receipts since the last run, and separately runs a few targeted web searches for current Pokémon card / Funko coupons, deals, and new-product drops, writing genuine new findings into `market_alerts`. Full parsing rules (the receipt template, bundle-splitting logic, cancellation cross-check, delivery-status lookup) are embedded in the task's own prompt, since each scheduled run starts with no memory of this conversation. Caveat carried over from the scheduling tool itself: it only fires while the Claude app is open — if it's closed at the scheduled time, it runs on next launch instead, so this isn't a true always-on server-side cron.
- **Explicitly declined**: auto-subscribing the user's email to marketing newsletters on unnamed third-party sites. No specific site was ever named, and submitting personal data into web forms needs explicit per-site permission regardless — this was surfaced back to the user rather than guessed at.
- **Known gap**: a second Gmail inbox the user also buys from is not yet connected in this environment; the sync currently only reads `amitcohen0411@gmail.com`. Once a second Gmail connector is added, the scheduled task's prompt needs updating (via `update_scheduled_task`) to check it too.

---

*End of PRD. If anything in this document conflicts with itself, the section closer to the top wins.*
