# The Green House

A faction war-room for [Torn City](https://www.torn.com), as a single userscript. Four coordination tools live in one floating panel that sits on top of any Torn page — no separate site to keep open in another tab.

Works with **Tampermonkey** and **Greasemonkey**.

---

## The tools

**🎯 Hit Caller** — the live enemy roster during a war. Every target with their status, hospital timer, level, fair-fight rating and estimated stats, sorted however you like. The important part is claiming: press **Claim** and the whole faction sees the target is taken, with a queue position if someone got there first. Claims expire on a timer so nothing stays locked forever, and you get an audible alert when a target you claimed leaves hospital.

**🛡 Strike Teams** — build a squad for a coordinated push. Add members, track who's marked themselves ready, and keep an ordered target list you work down together, ticking targets off as they fall. Mission status moves through planning → recruiting → ready → in progress.

**⛓ Chain Manager** — the chain timer, large and unmissable, turning red under a minute. Shows the next bonus milestone and how many hits away it is, plus a live availability board of who in the faction is actually around to hit: ready, idle, offline, hospitalised or travelling.

**✈ Air Traffic Control** — who's overseas, allied and enemy. Each country shows how many are landed, inbound or in hospital there, flagged by whether it's an active conflict, enemy-held, or clear. A "safe havens" strip at the top tells you at a glance where you can fly without landing on top of the enemy.

---

## Requirements

- **Tampermonkey** ([Chrome/Edge/Firefox/Safari](https://www.tampermonkey.net/)) or **Greasemonkey** ([Firefox](https://www.greasespot.net/))
- A **Torn API key** — a *limited access* key is enough. Create one under [Preferences → API Key](https://www.torn.com/preferences.php#tab=api).
- Optional: an **FFScouter API key**, only for the fair-fight and estimated-stat columns in Hit Caller.

---

## Install

1. Install Tampermonkey or Greasemonkey if you haven't already.
2. Open this link — your userscript manager will offer to install it:

   **https://raw.githubusercontent.com/Nanthia/The-GreenHouse-Script/main/thegreenhouse.user.js**

3. Reload any Torn page. A round **TGH** button appears in the bottom-left corner.
4. Click it, then paste your Torn API key into the **Settings** tab.

That's it. Your Torn ID, name and faction fill themselves in from the key, and the enemy faction is detected automatically once a ranked war starts.

Updates arrive on their own — your userscript manager checks this repo periodically and pulls new versions.

---

## Using it

Click **TGH** to open the panel, then pick a tool from the menu down the left side. The panel reopens on whichever tool you used last.

- **Move things out of your way.** Drag the TGH button anywhere; drag the panel by its header bar. Both remember where you put them. There's a reset for each in Settings if something ends up somewhere awkward.
- **Only the tool you're looking at refreshes**, and closing the panel stops all polling — so it isn't quietly hammering the Torn API in the background.
- **Hit Caller filters**: search by name or ID, filter by status or location, and narrow by fair-fight range. Click any column header to sort by it.
- **Claim timers** are set by your faction's TTL (default two minutes). If your claim lapses while you're still working on a target, just claim again.

---

## Settings

| Field | What it does |
|---|---|
| Torn API key | Required. Everything reads from this. Limited access is enough. |
| FFScouter API key | Optional. Adds fair-fight and estimated stats to Hit Caller. |
| Your Torn ID / Username | Fills in automatically from your API key. Claims are tagged with your real ID so the faction knows who claimed what. |
| My Faction ID | Fills in automatically. |
| Enemy Faction ID | Detected automatically during a ranked war. Type one in manually to scout a faction outside of war — a manual entry won't be overwritten. |
| Claim TTL | How long your claims last before expiring, in seconds. |
| Theme | Dark or light. |

**Chain Manager** and **Air Traffic Control** need nothing but your Torn API key. **Hit Caller** and **Strike Teams** additionally need the faction's shared database, because they coordinate between people — see below.

---

## Your data

Your Torn API key is stored locally by your own userscript manager and is sent only to Torn's own API (`api.torn.com`). It is never sent to the shared database, and nobody else in the faction can see it.

What is shared, when you claim a target or join a strike team, is your Torn ID, name, and what you claimed — which is the entire point of the feature.

---

## Faction setup

*For whoever runs the faction's database. Members don't need any of this.*

Hit Caller and Strike Teams need a shared [Supabase](https://supabase.com) project (the free tier is fine). Two SQL scripts are included:

- **`new_project_setup.sql`** — for a fresh project. Creates every table, index, integrity rule and security policy in one pass. Edit one line at the top: your faction ID.
- **`rls_setup.sql`** — to lock down an existing project that already has the tables instead.

Then paste the project URL and publishable (anon) key into the `BAKED_IN` block at the top of `thegreenhouse.user.js`. Members then configure nothing but their own Torn API key — Settings shows a green "Built in" badge instead of the database fields.

**Run the SQL before publishing the key.** The key is designed to be publishable, but only once row-level security is switched on; the SQL is what makes it safe to ship. Either value can be base64'd with a `b64:` prefix to keep automated key scrapers off it.

---

## Troubleshooting

**No TGH button.** Check the script is enabled in your userscript manager, and reload the Torn page. It's in the bottom-left corner by default — if you dragged it somewhere odd, use Settings → Reset button position.

**"No Torn API key set."** Open Settings and paste your key. If it was rejected, confirm it's still active in Torn under Preferences → API Key.

**Hit Caller says no enemy faction.** That's normal outside a war. It fills in automatically when a ranked war starts, or you can type an enemy faction ID into Settings to scout one manually.

**Claims aren't syncing with the rest of the faction.** Everyone needs to be on the same database. If Settings shows the Supabase fields rather than a "Built in" badge, check with whoever set the project up. A red banner across the top of Hit Caller means the database is unreachable — claim info shown while that banner is up may be incomplete, so don't trust it mid-war.

**Estimated stats and fair-fight are blank.** Those need an FFScouter API key in Settings; everything else works without it.

---

## Development

```bash
npm install
npm test
```

`smoketest.cjs` drives the whole UI in a simulated browser against mocked Torn, FFScouter and Supabase responses. `sqltest.cjs` runs the database schema against a real Postgres and asserts the security rules actually hold — that claims can't be deleted, reassigned, backdated or written for another faction.

Version 2.3.1
