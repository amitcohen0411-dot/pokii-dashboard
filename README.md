# Pokii Dashboard

A shared, no-account-hassle web dashboard for tracking Funko Pop / Pokémon card purchases, sales, inventory, and cash flow between two people. Log a purchase or a quick sale by photo, video, or text; Google Gemini reads the media and drafts the structured details; you review and confirm before anything is saved. See [PRD.md](./PRD.md) for the full spec.

This is a **build-free** static site (no Node, no bundler) backed by Supabase (database, auth, storage, and one edge function).

## What's already built

- `index.html` — passcode gate (backed by one shared Supabase Auth login)
- `dashboard.html` — Bit/Cash/**Card** balances, **estimated inventory value** (not cost — see below), in-transit value, this month's spend/revenue/profit, plus insight cards: purchases stuck in Ordered/Shipped 14+ days, inventory sitting unsold 21+ days, forwarder shipments unpaid or running late, and **Deals & drops** (coupons/new releases found by the daily market scan, dismissible)
- `purchases.html` — log a purchase (photo/video/text → AI draft → review → confirm), list, status changes, **edit in place** (reverses and reapplies its stock/cash effect), **delete** (also reverses stock/cash — open any purchase → "Delete purchase"), and **multi-currency support** — pick a currency, enter that purchase's exchange rate by hand, and everything downstream (cost basis, cash ledger, dashboard sums) is stored in ILS while the original amount stays visible for reference
- `inventory.html` — search/browse stock, edit an item, upload/replace a photo per item (also auto-set the first time a new item is created from a purchase photo), manual quantity adjustments (with a required reason, logged to `stock_adjustments`), and **estimated resale value per item** — separate from cost basis (which stays accurate to what you paid, for profit math), defaults to 1.9× the item-only cost, tell it the real number whenever you know one
- `sales.html` — "quick sale" flow: photo/text → AI-guessed items → match against stock (careful with duplicates) → confirm → inventory decremented, profit computed; also supports **edit in place**
- `orders.html` — every open order in one place (awaiting seller → at forwarder → forwarder unpaid → in transit to you → received), plus a "Forwarder shipments" section to bundle purchases sitting at Redbox/MyUS into one outbound shipment, mark it paid, add tracking/expected-arrival, and mark it arrived (flips every bundled purchase to received in one go)
- `supabase/migrations/0001_init.sql` … `0007_market_alerts.sql` — full schema, RLS, seed data, two fixes Supabase's own advisor flagged after the first migration, the `currency`/`fx_rate` columns on `purchases`, the `forwarder_shipments` table, a third `card` payment account, `app_settings` (holds the Vinted-sync EUR/ILS rate), `purchases.source_ref` (dedup key for the email sync), and `market_alerts`
- A **daily scheduled task** (`pokii-vinted-and-deals-sync`, runs 08:09 local) that reads Vinted's order-confirmation emails from your connected Gmail and imports new ones as purchases (skipping anything already imported or later cancelled/refunded), and separately scans the web for current Pokémon card / Funko coupons, deals, and drops, posting genuine finds to the dashboard's Deals & drops card. It only fires while the Claude app is open — closed at the scheduled time means it runs on next launch instead.
- `supabase/functions/analyze-media/index.ts` — the one server-side piece: proxies a photo/video to Gemini and returns a draft (never writes to the database itself), now also asking Gemini to guess the currency shown

## Live backend status

The Supabase project is up and running (project `pokii-dashboard`, region `eu-central-1`):
- ✅ Schema, RLS policies, and the private `media` storage bucket are applied (`supabase/migrations/0001_init.sql` + `0002_security_hardening.sql`)
- ✅ `assets/js/config.js` already has the real project URL and anon key filled in
- ✅ The shared login exists: email `team@pokii.local`, passcode **`11041104`** (your `1104` doubled, since Supabase requires 6+ characters — both of you sign in with this)
- ✅ The `analyze-media` edge function is deployed, with `GEMINI_API_KEY` set as a project secret
- ✅ Verified end-to-end against the live database: login, a manual purchase (with correct shipping-cost allocation into cost basis), inventory creation, a sale against that stock (correct profit calc), and dashboard numbers all checked out. Test data was cleaned back out afterward — the database is empty and ready for real use.
- ✅ Verified real photo analysis: a test receipt image was sent through the actual Gemini call and came back with every item, price, and the one real discount correctly extracted (and correctly left the non-discounted item's discount as unknown rather than guessing).
- ✅ Verified the full forwarder order-tracking cycle live: logged a purchase routed via Redbox, bundled it into a new forwarder shipment, marked the shipment paid (checked the cash ledger and "spend this month" both updated correctly), marked it arrived (checked the purchase flipped to received and "in transit" dropped to ₪0), and confirmed the dashboard's unpaid-shipment and running-late nudge cards render correctly.
- ⚠️ `kamuti-plus` was paused to free up your account's 2-project free-tier limit — resume it from the Supabase dashboard whenever you need it again.
- ✅ Imported your real historical Vinted orders: 5 real, delivered purchases (out of 9 receipts found — 4 were paid then cancelled/refunded same-day and correctly excluded), verified to reconcile exactly against the new Card account balance and inventory value. The daily sync will pick up new orders from here.

**Note on the Gemini model:** the function uses `gemini-flash-lite-latest` (an alias Google keeps pointed at their current recommended lightweight model). The originally-planned `gemini-1.5-flash` no longer exists for new API keys, and the full `gemini-flash-latest` model was intermittently overloaded (503) when this was tested — the lite variant is cheaper anyway and read the test receipt perfectly.

## What you still need to do

### 1. Put the app online so both of you can reach it

No Node, no CLI needed — pick one:
- **Netlify Drop**: go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag the whole `pokii-dashboard` folder in. You get a URL instantly, and can re-drag the folder any time you make changes.
- **GitHub Pages**: push this folder to a GitHub repo, then in the repo Settings → Pages, enable Pages from the `main` branch. You get a `github.io` URL.

## Local preview

Since this is plain static HTML/JS, you can also just open `index.html` directly in a browser, or serve the folder with Python (already on this Mac):

```bash
cd pokii-dashboard
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Known limitations (by design, for now)

- Editing or deleting a purchase/sale reverses stock **quantity** but does not attempt to recompute historical average cost if other sales happened in between — fine at this scale, just don't rely on it for major corrections after a lot of activity.
- No live eBay/Vinted order-status syncing, and no plan to build one — update status by hand. **Vinted has no public API at all**, so a real "connect my account" integration isn't possible there without scraping (which would violate their terms and break constantly). **eBay does have an official buyer order API**, but using it requires you personally to register as an eBay developer and get the app approved for production access — not something anyone else can do on your behalf. If you ever want to pursue that, say so and we can scope it, but it's a real multi-step process on eBay's side, not a quick add.
- The exchange rate on a foreign-currency purchase is typed in by hand, not fetched live — there's no external FX API wired up (deliberately, to avoid needing yet another API key).
- Deal/drop alerts come from general web searches for current Pokémon/Funko news, not from watching specific named retailer pages — no specific site was ever given to watch.
- Vinted order sync only reads one Gmail inbox (`amitcohen0411@gmail.com`) so far — a second one was mentioned but hasn't been connected in this environment yet.
- No auto-subscribing your email to retailer newsletters — no specific site was named, and submitting your email into a form needs explicit per-site permission anyway.
