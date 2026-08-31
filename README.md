# The Green House — Userscript Hub

One userscript — `thegreenhouse.user.js` (v2.2.0) — bringing four war tools from the webapp (Hit Caller, Strike Teams, Chain Manager, Air Traffic Control) into a single hub that floats over any `torn.com` page. Runs on **both Tampermonkey and Greasemonkey**. My Roster, Enemy Roster, Stats Analyser, Config, and Post-War Report stay in the original webapp for now.

## How it works

A single round **TGH** button sits **bottom-left** on every Torn page, clear of Torn's chat. Click it to open the hub: a left-hand menu (Hit Caller, Strike Teams, Chain Manager, Air Traffic Control, Settings) and a content pane that swaps per tab.

**Both the button and the panel are draggable.** Drag the TGH button itself to park it anywhere; drag the panel by its header. Each position is remembered separately and survives reloads, and both are clamped back into view if you resize the window or switch to a smaller screen. Settings has a reset for each if anything ends up somewhere awkward. A drag never counts as a click, so moving the button won't open the panel.

- Only the open tab polls. Switching tabs tears down the previous tool's timers; **closing the hub stops all polling entirely**.
- No automatic page-detection — you land on whichever tab you used last and switch manually.
- Your Torn ID, name and faction ID **fill in automatically** from your API key, so nothing depends on hand-typed IDs.
- Everything is configured in the **Settings** tab.

## Installing

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Greasemonkey](https://www.greasespot.net/) (Firefox).
2. Open the install URL — the extension will offer to install it, then auto-update from the same URL whenever a new version is pushed:

   ```
   https://raw.githubusercontent.com/Nanthia/The-GreenHouse-Script/main/thegreenhouse.user.js
   ```

   **The repo must be public** for that raw URL to work without a token. If it's private, Tampermonkey can't fetch or auto-update it.
3. Reload a `torn.com` tab, click **TGH**, and paste your Torn API key (limited access is enough). ID/name/faction populate themselves. Add the FFScouter key if you want fair-fight estimates.

## Setup for the faction (do this once)

Two SQL files ship here — use **one** of them:

- **`new_project_setup.sql`** — for a **fresh Supabase project** (recommended). Creates every table, index, integrity rule and RLS policy in one pass. Crucially, `faction_config` has no `torn_api_key` / `ffs_api_key` columns, so the worst exposure doesn't exist by construction rather than being policed by a policy you have to trust.
- **`rls_setup.sql`** — for **locking down your existing project** instead, if you'd rather not migrate. Same security posture, but it has to work around tables the webapp already owns.

Then:

1. **Run your chosen SQL** in the Supabase SQL Editor. In `new_project_setup.sql` you edit exactly one line — your faction ID, defined once as a function so it doesn't need find-and-replace. Do this *before* step 2: it's what makes shipping the key safe.
2. **Fill in `BAKED_IN` at the top of `thegreenhouse.user.js`** with the project URL and publishable (anon) key. Teammates then install the script, paste their own Torn API key, and Hit Caller / Strike Teams work with nothing else to configure — Settings just shows a green "Built in" badge.
3. Push to your public repo. Tampermonkey auto-updates everyone from there.

If you go the fresh-project route, `new_project_setup.sql` ends with three app-side follow-ups — including one that matters: the webapp's `ConfigPage.tsx` currently writes `torn_api_key` into `faction_config`, and that column no longer exists, so that write must be stripped or the Config page will error on save.

Optional: prefix either baked-in value with `b64:` and base64 the rest (`btoa("value")` in the console) to stop GitHub's secret scanners and key-scraping bots flagging a plain key in a public repo. It is not security — anyone can decode it instantly, and your teammates can read it either way — but it does defeat drive-by scraping. The script accepts plain or `b64:` transparently.

## Does this need a backend at all?

Yes, and not because of Supabase — because of what the features are. "My faction can see that I claimed this target" means state that lives somewhere both machines can read and write. That *is* a backend, by definition. Things that look like alternatives don't survive contact:

- **Torn itself as the channel** (faction chat, announcements) — the Torn API is read-only, so writing would mean automating the site UI. Fragile, spams chat, and risks your accounts under Torn's automation rules.
- **Peer-to-peer / WebRTC** — still needs a signalling server, and peers must be online simultaneously. A claim made while nobody else is connected simply vanishes.
- **A different free database** (Firebase, JSONBin, Airtable, Cloudflare KV…) — identical trade-off with a different logo, and most have no RLS equivalent, so strictly worse.
- **Local storage only** — each person sees their own claims and nobody else's, which is the one thing claims exist to do.

The only real choices are *whose* backend and *whether the client holds a credential*. Chain Manager and Air Traffic Control genuinely need no backend at all — they read the Torn API directly and work with just your API key. It's specifically the two coordination tools that can't.

So: keep Supabase. It's free at your scale, it already works, and the fix was never to replace it — it was to turn RLS on.

## Can you avoid sharing the anon key?

Short answer: the anon key isn't actually a secret — but in your current setup it behaves like one, and that's worth fixing.

Supabase anon keys are *designed* to be public. Every Supabase web app ships its anon key in the browser JS bundle, including your existing webapp today — anyone who opens devtools on it already has that key. What's supposed to make that safe is **row-level security**: the anon key only lets you do what your RLS policies allow. Your `supabase_schema.sql` explicitly disables RLS on these tables ("auth added in a later module"), so right now the anon key *is* effectively a master key for `hit_claims` and `strike_teams`. That's the real problem — not the act of sharing it.

Three ways forward, roughly in order of effort:

**1. Embed the key in the script + turn RLS on.** Teammates enter nothing, and the key stops mattering because the policies do the gatekeeping. This is the normal Supabase deployment model and by far the smallest change. It does mean anyone who reads the script has the key — which is fine once RLS is real, and not fine while it isn't.

**2. Route the database through your own backend — no Supabase credentials in the script at all.** You already have the Vercel serverless pattern from `api/torn.ts`. Add an endpoint that holds the `service_role` key server-side; the script calls *your* endpoint, sending the user's own Torn API key; the endpoint asks Torn whether that key belongs to a member of your faction, and only then performs the read/write. This is the genuine "nobody shares a key" answer: the only credential each person needs is their own Torn API key, which they already have. Most work, best outcome.

**3. Supabase Edge Function issuing short-lived tokens.** Same verification idea as option 2, but hosted on Supabase: verify the Torn key, mint a short-lived JWT, and write RLS policies against its claims. Comparable effort to 2, keeps everything in Supabase instead of Vercel.

My recommendation: **option 2** if you're willing to spend an evening on it, since it reuses infrastructure you already run and removes the shared credential completely. **Option 1** as a stopgap you could do today — but only alongside actually enabling RLS, since embedding the key without policies just makes the current exposure more convenient. Say the word and I'll build either.

Chain Manager and Air Traffic Control need only the Torn API key — no Supabase at all.

## What changed vs. the webapp

- No `api/torn.ts` / `api/ffs.ts` proxies needed — `GM_xmlhttpRequest` / `GM.xmlHttpRequest` reaches `api.torn.com` and `ffscouter.com` directly, CORS-free.
- No React/build step — plain DOM in one injected hub panel.
- Supabase realtime websockets replaced with polling (claims 5s, strike teams 10s), which the webapp already had as its fallback path.
- Settings live in the userscript manager's own storage, not webapp `localStorage`, so each person configures once via Settings.

## Changes in v2.3.1

- Added `new_project_setup.sql` (fresh-project schema + RLS in one script) and `sqltest.cjs`, which runs it against a real Postgres.
- **Fixed a queue-jumping hole found by actually running the SQL:** `created_at` was client-supplied and the claim queue is ordered by it, so a member could have backdated a claim to position #1 — and anyone with a wrong PC clock got a wrong queue position regardless. The script now omits `created_at` so the database clock assigns it, and the setup SQL revokes insert on that column to enforce it server-side.

## Changes in v2.3.0

- Added `BAKED_IN` config at the top of the script (project URL + anon key), so most members configure nothing but their own Torn API key. A value typed into Settings still overrides it; blank both fields to fall back to built-in.
- `b64:` prefix support on baked-in values, to defeat automated key scrapers on a public repo.
- Settings shows a **Built in** badge instead of the Supabase fields when config is baked, with a "Use a different database…" escape hatch, so nobody breaks a working setup by poking at it.
- The redundant `faction_config` write is now off by default (`SYNC_WAR_TO_SUPABASE = false`). Every client already detects the war from its own API key, so the shared copy bought nothing — and switching it off lets `rls_setup.sql` keep that table (which holds API keys) completely closed.
- Added `rls_setup.sql`.

## Changes in v2.2.0

- Moved the TGH button from bottom-right to **bottom-left**, out of the way of Torn's chat.
- Made the button **draggable** with its position remembered (4px threshold so a click stays a click; clicks are ignored for 300ms after a drag release so letting go doesn't also open the panel).
- Touch drag as well as mouse, and both the button and panel are re-clamped into view on window resize.
- Added a "Reset button position" control in Settings next to the existing panel reset.

## Audit fixes in v2.1.0

An audit of v2.0.0 found real defects; all are fixed here.

Crashes and dead panes:

- **Air Traffic Control showed a permanently blank pane** when unconfigured — its config guard returned before ever rendering. Every module now renders an explanatory message on every guard path.
- **Chain Manager could brick itself permanently.** Unguarded `m.status.state` / `m.last_action.timestamp` on a member missing those objects threw *inside* the sort comparator, after the container had been emptied — and the 1s re-render threw again forever. Now fully guarded, with the member sort wrapped in try/catch.
- Strike Teams crashed the list view on a team row with a null `status`; `status` is now set explicitly on insert and defaulted on read.

Data-loss and UI bugs:

- **The Hit Caller search box only accepted one character** — every keystroke rebuilt the DOM and destroyed the focused input. Toolbar controls are now built once and only the table is redrawn.
- **Strike Teams' 10-second poll wiped half-typed forms.** Background refreshes now defer while you're typing anywhere in a module, and apply the moment you click away.
- Chain Manager rebuilt the whole scrolling container every second, making the member table impossible to scroll. Only the countdown text updates per tick now; scroll position is preserved on all table redraws.
- **Closing the hub didn't stop anything** — every tool kept polling Torn and Supabase indefinitely, and `dataset.mounted` meant reopening never remounted (so a pane that came up blank stayed blank for the life of the page). Closing now runs cleanup; opening remounts.

Correctness:

- **Manually entered enemy faction IDs were wiped within 60 seconds** by war auto-detect. Manual entries are now flagged and never auto-cleared.
- **War detection could pick your own faction as the enemy** when `myFactionId` was blank — letting people claim hits on teammates. Own-faction ID is now taken from the API, and detection won't guess without it.
- **The char-code-sum identity hash is gone.** It collided between members (so one person's claims showed as another's, and "Wipe My Claims" could release someone else's), wrote fake low-numbered player IDs into the shared table, and orphaned every earlier row the moment a real ID was entered. Identity now comes from the Torn API, and claim actions refuse to run without a real ID.
- **Failed reads no longer look like empty results** — a claims fetch failure showed "No active claims" on every target, so two people would both claim the same one. Failures now surface as an explicit banner and an "unknown" claim state.
- Every Strike Teams mutation now reports errors instead of silently failing (a ticked checkbox no longer lies about what's in the database).
- Queue order now actually orders by `created_at` (previously unordered, sorted on a column that was never written, so "#1 / #2" was arbitrary).
- Hit Caller's location filter misread a domestic `"In hospital for 1 hour"` as being abroad — now country-aware.
- The out-of-hospital alert was unreachable (a 120s claim TTL always expired before a hospital stay ended); it now tracks claimed targets independently of TTL. The alert is generated locally via WebAudio, so no remote asset and no CSP/autoplay issue.
- Chain Manager treated `Abroad` members as "Ready", overstating the ready count.
- FFScouter refreshed at ~80s rather than 60s, and Chain Manager's guard sat 500ms from its interval (dropping fetches to 60s); both timing guards fixed.
- A fair-fight of exactly `0` is no longer coerced to `1`, and clearing the FF-max box no longer filters out every target.
- Player IDs are coerced consistently, so claims can't silently fail to match their target on a text-vs-bigint column.
- Sortable column headers are now actually clickable (they looked sortable but had no handlers), and target lists can be reordered.
- Added `@noframes` — the script was running a full copy, timers and all, inside every same-origin iframe on the page.
- Hub position is clamped to the viewport on restore, with a reset button, so it can't be stranded off-screen.

## Verification

`smoketest.cjs` runs the script in a simulated browser (jsdom) with mocked GM APIs and realistic Torn/FFScouter/Supabase payloads — including deliberately malformed members with missing `status` objects — then drives the UI: drags the button (checking it moves, persists, clamps to the viewport, and doesn't toggle the panel), opens the hub, visits every tab twice, types in the search box, clicks sort headers, claims a target, creates a strike team, and closes the hub.

```
npm install jsdom
node smoketest.cjs ./thegreenhouse.user.js
```

`sqltest.cjs` does the same for the database, running `new_project_setup.sql` against a real Postgres (PGlite/WASM — no server or install needed) and then asserting the security actually behaves as advertised: that claims can't be deleted, reassigned, backdated, duplicated, given absurd TTLs or written for another faction; that faction intel isn't readable; that cascades and triggers fire. This is how the queue-jumping hole above was found.

```
npm install @electric-sql/pglite
node sqltest.cjs ./new_project_setup.sql
```

Currently reports `*** ALL CHECKS PASSED ***`, including a clean second run to confirm the script is safe to re-run.

Current result: passes on both Tampermonkey-style (`GM_*`) and Greasemonkey-style (`GM.*`) mocks — no errors, no blank panes configured or unconfigured, search keeps focus, form drafts survive background polls, claims insert with correct `created_at`/`expires_at`/claimer, and zero API calls while the hub is closed.

**This is still simulated, not live.** jsdom is not Chrome, and the mocked payloads are my best guess at real Torn API shapes — in particular the v2 `chain,members` response and FFScouter's exact response envelope are worth confirming against live data. Install it yourself and exercise each tab before rolling it out to the faction.
