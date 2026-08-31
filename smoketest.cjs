/* Smoke test for thegreenhouse.user.js
 * Runs the script inside jsdom with mocked GM APIs and realistic Torn /
 * FFScouter / Supabase payloads, in BOTH engine modes, then drives the UI.
 * Usage: node smoketest.cjs /path/to/thegreenhouse.user.js
 */
const fs = require("fs");
const { JSDOM } = require("jsdom");

const SCRIPT_PATH = process.argv[2];
const code = fs.readFileSync(SCRIPT_PATH, "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- fixtures ---------------- */
const MEMBERS_MINE = {
  111: { id: 111, name: "NatTest", level: 40, status: { state: "Okay", description: "Okay", until: 0 }, last_action: { status: "Online", timestamp: Math.floor(Date.now() / 1000) - 10, relative: "10 seconds ago" } },
  112: { id: 112, name: "AllyAbroad", level: 30, status: { state: "Okay", description: "In Japan", until: 0 }, last_action: { status: "Idle", timestamp: Math.floor(Date.now() / 1000) - 600, relative: "10 minutes ago" } },
  113: { id: 113, name: "AllyFlying", level: 25, status: { state: "Traveling", description: "Traveling to South Africa", until: 0 }, last_action: { status: "Offline", timestamp: Math.floor(Date.now() / 1000) - 4000, relative: "1 hour ago" } },
  114: { id: 114, name: "AllyHospHome", level: 22, status: { state: "Hospital", description: "In hospital for 1 hour 5 minutes", until: Math.floor(Date.now() / 1000) + 3900 }, last_action: { status: "Offline", timestamp: Math.floor(Date.now() / 1000) - 200, relative: "3 minutes ago" } },
  // deliberately malformed: no status, no last_action
  115: { id: 115, name: "BrokenMember" },
};
const MEMBERS_ENEMY = {
  201: { id: 201, name: "EnemyOkay", level: 50, status: { state: "Okay", description: "Okay", until: 0 }, last_action: { status: "Online", timestamp: Math.floor(Date.now() / 1000) - 5 } },
  202: { id: 202, name: "EnemyHospJapan", level: 55, status: { state: "Hospital", description: "In a Japanese hospital for 20 minutes", until: Math.floor(Date.now() / 1000) + 1200 }, last_action: { status: "Offline", timestamp: Math.floor(Date.now() / 1000) - 900 } },
  203: { id: 203, name: "EnemyHospHome", level: 45, status: { state: "Hospital", description: "In hospital for 30 minutes", until: Math.floor(Date.now() / 1000) + 1800 }, last_action: { status: "Offline", timestamp: Math.floor(Date.now() / 1000) - 100 } },
  204: { id: 204, name: "EnemyInMexico", level: 60, status: { state: "Okay", description: "In Mexico", until: 0 }, last_action: { status: "Idle", timestamp: Math.floor(Date.now() / 1000) - 300 } },
  205: { id: 205, name: "NoStatusEnemy", level: 10 },
};

let supabaseRows = {
  hit_claims: [],
  strike_teams: [],
  strike_team_members: [],
  strike_team_targets: [],
  faction_config: [],
};
const calls = [];

function respond(url, method, body) {
  calls.push(method + " " + url);
  if (url.includes("api.torn.com")) {
    if (url.includes("user?selections=basic,profile")) {
      return { status: 200, responseText: JSON.stringify({ player_id: 111, name: "NatTest", faction: { faction_id: 999, faction_name: "Green House" } }) };
    }
    if (url.includes("v2/faction/?selections=chain,members")) {
      return { status: 200, responseText: JSON.stringify({ chain: { current: 137, max: 250, timeout: 245, cooldown: 0, modifier: 1.6, start: Math.floor(Date.now() / 1000) - 3600 }, members: Object.values(MEMBERS_MINE) }) };
    }
    if (/faction\/888\?selections=basic/.test(url)) {
      return { status: 200, responseText: JSON.stringify({ ID: 888, name: "Bad Guys", members: MEMBERS_ENEMY }) };
    }
    if (/faction\?selections=basic/.test(url)) {
      return { status: 200, responseText: JSON.stringify({ ID: 999, name: "Green House", members: MEMBERS_MINE }) };
    }
    if (/faction\?key=/.test(url)) {
      return { status: 200, responseText: JSON.stringify({ ID: 999, name: "Green House", ranked_wars: { 12345: { factions: { 999: { name: "Green House" }, 888: { name: "Bad Guys" } } } } }) };
    }
    return { status: 200, responseText: JSON.stringify({}) };
  }
  if (url.includes("ffscouter.com")) {
    return { status: 200, responseText: JSON.stringify([{ player_id: 201, fair_fight: 2.35, bs_estimate: 15000000 }, { player_id: 204, fair_fight: 0, bs_estimate: 900 }]) };
  }
  if (url.includes("supabase.co")) {
    const m = url.match(/\/rest\/v1\/([a-z_]+)/);
    const table = m ? m[1] : "unknown";
    if (method === "GET") return { status: 200, responseText: JSON.stringify(supabaseRows[table] || []) };
    if (method === "POST") {
      const parsed = JSON.parse(body || "{}");
      const row = Object.assign({ id: "uuid-" + Math.random().toString(36).slice(2, 8), created_at: new Date().toISOString() }, parsed);
      (supabaseRows[table] = supabaseRows[table] || []).push(row);
      return { status: 201, responseText: JSON.stringify([row]) };
    }
    if (method === "PATCH") return { status: 204, responseText: "" };
    if (method === "DELETE") return { status: 204, responseText: "" };
  }
  return { status: 404, responseText: JSON.stringify({ message: "unmocked " + url }) };
}

/* ---------------- harness ---------------- */
async function runWithCode(codeOverride, mode, preseed) {
  return run(mode, preseed, codeOverride);
}

async function run(mode, preseed, codeOverride) {
  const scriptCode = codeOverride || code;
  calls.length = 0; // per-run, so URL assertions can't read a previous run's traffic
  const errors = [];
  const warns = [];
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div id="torn-page">Torn</div></body></html>`, {
    url: "https://www.torn.com/factions.php",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  window.onerror = (msg) => errors.push("window.onerror: " + msg);
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + (e.reason && e.reason.message)));
  const origError = console.error;
  window.console = {
    log: () => {},
    warn: (...a) => warns.push(a.map(String).join(" ")),
    error: (...a) => errors.push("console.error: " + a.map(String).join(" ")),
  };

  const store = new Map(Object.entries(preseed || {}));

  if (mode === "tampermonkey") {
    window.GM_getValue = (k, d) => (store.has(k) ? store.get(k) : d);
    window.GM_setValue = (k, v) => store.set(k, v);
    window.GM_addStyle = (css) => {
      const el = window.document.createElement("style");
      el.textContent = css;
      window.document.head.appendChild(el);
      return el;
    };
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = (o) => {
      setTimeout(() => {
        const r = respond(o.url, o.method || "GET", o.data);
        o.onload && o.onload(r);
      }, 1);
    };
  } else {
    // Greasemonkey 4: async GM.* only, no GM_addStyle, no GM_* at all.
    window.GM = {
      getValue: async (k) => (store.has(k) ? store.get(k) : undefined),
      setValue: async (k, v) => void store.set(k, v),
      registerMenuCommand: () => {},
      xmlHttpRequest: (o) => {
        setTimeout(() => {
          const r = respond(o.url, o.method || "GET", o.data);
          o.onload && o.onload(r);
        }, 1);
        return Promise.resolve();
      },
    };
  }

  // AudioContext stub for the beep
  window.AudioContext = function () {
    return {
      currentTime: 0,
      createOscillator: () => ({ type: "", frequency: { value: 0 }, connect: (x) => x, start() {}, stop() {}, set onended(f) {} }),
      createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (x) => x }),
      destination: {},
      close: () => Promise.resolve(),
    };
  };
  window.alert = (m) => warns.push("ALERT: " + m);
  window.confirm = () => true;

  try {
    window.eval(scriptCode);
  } catch (e) {
    errors.push("eval threw: " + e.message);
  }

  await sleep(120);

  const doc = window.document;
  const results = { mode, errors, warns, checks: {} };

  const fab = doc.getElementById("tgh-fab");
  results.checks.fabExists = !!fab;
  results.checks.hubExists = !!doc.getElementById("tgh-hub");
  results.checks.engine = window.TGH_HUB && window.TGH_HUB.engine;
  results.checks.stylesInjected = doc.querySelectorAll("style").length > 0;
  results.checks.navItems = Array.from(doc.querySelectorAll("#tgh-hub-nav .tgh-nav-item")).map((n) => n.textContent);

  if (!fab) return results;

  // --- button placement + drag ---
  results.checks.fabDefaultPos = { left: fab.style.left, bottom: fab.style.bottom, right: fab.style.right || "(unset)" };

  const drag = (el, fromX, fromY, toX, toY) => {
    el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0, clientX: fromX, clientY: fromY }));
    window.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: toX, clientY: toY }));
    window.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, clientX: toX, clientY: toY }));
  };

  // A real drag should move it, persist it, and NOT toggle the hub open.
  // NOTE: the script swallows clicks for 300ms after a drag release, so any
  // *deliberate* click below waits past that window; the immediate click here
  // simulates the browser's own post-mouseup click and must be swallowed.
  drag(fab, 20, 700, 400, 300);
  fab.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); // the click that follows a drag release
  await sleep(60);
  results.checks.fabDrag = {
    movedTo: { left: fab.style.left, top: fab.style.top },
    persisted: !!store.get("tgh_fabPos"),
    hubStayedClosedAfterDrag: doc.getElementById("tgh-hub").classList.contains("tgh-hidden"),
  };

  // A tiny movement (under the threshold) must still count as a click.
  await sleep(350); // clear the post-drag suppression window
  drag(fab, 400, 300, 401, 300);
  fab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(250);
  results.checks.tinyMoveStillClicks = !doc.getElementById("tgh-hub").classList.contains("tgh-hidden");
  // close again so the rest of the test starts from a known state
  if (results.checks.tinyMoveStillClicks) {
    doc.getElementById("tgh-hub-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(60);
  }

  // Clamping: drag far past the bottom-right corner
  drag(fab, 400, 300, 99999, 99999);
  await sleep(40);
  const l = parseInt(fab.style.left, 10), t = parseInt(fab.style.top, 10);
  results.checks.fabClampedInViewport = l <= window.innerWidth && t <= window.innerHeight && l >= 0 && t >= 0;

  // Open the hub (past the post-drag suppression window)
  await sleep(350);
  fab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(250);
  results.checks.hubVisibleAfterOpen = !doc.getElementById("tgh-hub").classList.contains("tgh-hidden");

  // Visit every tab, twice each, checking the pane is never empty
  const paneReports = {};
  const navItems = Array.from(doc.querySelectorAll("#tgh-hub-nav .tgh-nav-item"));
  for (const item of navItems) {
    const id = item.dataset.modId;
    for (let pass = 0; pass < 2; pass++) {
      item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(220);
      const content = doc.getElementById("tgh-hub-content");
      const text = (content.textContent || "").trim();
      paneReports[id + (pass ? " (revisit)" : "")] = {
        childCount: content.children.length,
        textLen: text.length,
        blank: content.children.length === 0 || text.length === 0,
        excerpt: text.slice(0, 90).replace(/\s+/g, " "),
      };
    }
  }
  results.checks.panes = paneReports;

  // --- Hit Caller interaction: type in search, verify focus survives ---
  const hcItem = navItems.find((n) => n.dataset.modId === "hitcaller");
  hcItem.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(300);
  const searchInput = doc.querySelector('#tgh-hub-content input[placeholder="Search..."]');
  if (searchInput) {
    searchInput.focus();
    const focusedBefore = doc.activeElement === searchInput;
    searchInput.value = "Enemy";
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(30);
    const stillInDom = searchInput.isConnected;
    const focusedAfter = doc.activeElement === searchInput;
    const rowsAfter = doc.querySelectorAll("#tgh-hub-content tbody tr").length;
    searchInput.value = "";
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(30);
    results.checks.hitCallerSearch = {
      focusedBefore,
      inputSurvivedRerender: stillInDom,
      focusRetained: focusedAfter,
      rowsWhenFiltered: rowsAfter,
      rowsUnfiltered: doc.querySelectorAll("#tgh-hub-content tbody tr").length,
    };
  } else {
    results.checks.hitCallerSearch = "search input not found";
  }

  // sortable headers actually wired?
  const ths = Array.from(doc.querySelectorAll("#tgh-hub-content th"));
  const sortable = ths.filter((t) => t.classList.contains("tgh-sortable"));
  if (sortable.length) {
    const firstNameBefore = (doc.querySelector("#tgh-hub-content tbody tr td a") || {}).textContent;
    sortable[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true })); // Level
    await sleep(40);
    const firstNameAfter = (doc.querySelector("#tgh-hub-content tbody tr td a") || {}).textContent;
    results.checks.sorting = { sortableCount: sortable.length, changedOrder: firstNameBefore !== firstNameAfter, firstNameBefore, firstNameAfter };
  }

  // claim a target (scope to the table body so "Wipe My Claims" isn't matched)
  const claimBtn = Array.from(doc.querySelectorAll("#tgh-hub-content tbody button")).find((b) => /^(Claim|Queue)/.test(b.textContent));
  if (claimBtn) {
    claimBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(300);
    results.checks.claimInserted = supabaseRows.hit_claims.length;
    // While focus sits in the search box the refresh is deliberately deferred,
    // so Release should NOT have appeared yet...
    const releaseWhileFocused = !!Array.from(doc.querySelectorAll("#tgh-hub-content tbody button")).find((b) => b.textContent === "Release");
    // ...and should appear as soon as focus leaves (the focusout catch-up).
    const active = doc.activeElement;
    if (active && active.blur) {
      active.blur();
      active.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
    }
    await sleep(120);
    const releaseAfterBlur = !!Array.from(doc.querySelectorAll("#tgh-hub-content tbody button")).find((b) => b.textContent === "Release");
    results.checks.deferredRefresh = { releaseWhileTyping: releaseWhileFocused, releaseAfterBlur };
    results.checks.claimRow = supabaseRows.hit_claims[0]
      ? {
          hasCreatedAt: !!supabaseRows.hit_claims[0].created_at,
          hasExpiresAt: !!supabaseRows.hit_claims[0].expires_at,
          claimer: supabaseRows.hit_claims[0].claimer_torn_id,
          faction: supabaseRows.hit_claims[0].faction_id,
        }
      : null;
  }

  // --- Strike Teams: open create form, type, wait past the 10s poll ---
  const stItem = navItems.find((n) => n.dataset.modId === "striketeams");
  stItem.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(250);
  const newBtn = Array.from(doc.querySelectorAll("#tgh-hub-content button")).find((b) => /New Strike Team/.test(b.textContent));
  if (newBtn) {
    newBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(60);
    const nameInput = doc.querySelector('#tgh-hub-content input[placeholder^="Mission name"]');
    if (nameInput) {
      nameInput.focus();
      nameInput.value = "Operation Smoke";
      nameInput.dispatchEvent(new window.Event("input", { bubbles: true }));
      // Force a background refresh while focused — must not wipe the draft.
      window.dispatchEvent(new window.CustomEvent("tgh:settings-changed", { detail: { key: "noop" } }));
      await sleep(60);
      const stillThere = doc.querySelector('#tgh-hub-content input[placeholder^="Mission name"]');
      results.checks.strikeTeamDraft = { inputSurvived: !!stillThere, valuePreserved: stillThere ? stillThere.value : null };
      const createBtn = Array.from(doc.querySelectorAll("#tgh-hub-content button")).find((b) => b.textContent === "Create");
      if (createBtn) {
        createBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(300);
        results.checks.teamCreated = { teams: supabaseRows.strike_teams.length, members: supabaseRows.strike_team_members.length, status: (supabaseRows.strike_teams[0] || {}).status };
      }
    } else {
      results.checks.strikeTeamDraft = "mission name input not found";
    }
  }

  // --- close the hub: all polling must stop ---
  const callsBefore = calls.length;
  doc.getElementById("tgh-hub-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(50);
  const contentAfterClose = doc.getElementById("tgh-hub-content").children.length;
  await sleep(700);
  const callsAfter = calls.length;
  results.checks.closeStopsPolling = {
    contentEmptiedOnClose: contentAfterClose === 0,
    apiCallsWhileClosed: callsAfter - callsBefore,
  };

  // reopen -> remounts
  fab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(250);
  results.checks.reopenRemounts = doc.getElementById("tgh-hub-content").children.length > 0;

  // which Supabase host did it actually talk to, and does Settings say "Built in"?
  const supaCall = calls.find((c) => /supabase\.co/.test(c));
  results.checks.supabaseUrlUsed = supaCall ? (supaCall.match(/https:\/\/[^/]+/) || [])[0] : null;
  const setItem = navItems.find((n) => n.dataset.modId === "settings");
  setItem.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(150);
  results.checks.settingsBuiltInBadge = /Built in/.test(doc.getElementById("tgh-hub-content").textContent);

  dom.window.close();
  console.error = origError;
  return results;
}

(async () => {
  const configured = {
    tgh_tornApiKey: "TESTKEY123",
    tgh_ffsApiKey: "FFSKEY123",
    tgh_supabaseUrl: "https://testproj.supabase.co",
    tgh_supabaseAnonKey: "anon-test-key",
    tgh_myFactionId: "999",
    tgh_enemyFactionId: "888",
    tgh_userId: "111",
    tgh_username: "NatTest",
  };

  for (const mode of ["tampermonkey", "greasemonkey"]) {
    supabaseRows = { hit_claims: [], strike_teams: [], strike_team_members: [], strike_team_targets: [], faction_config: [] };
    const r = await run(mode, configured);
    console.log("\n================ " + mode.toUpperCase() + " (configured) ================");
    console.log(JSON.stringify(r.checks, null, 2));
    if (r.errors.length) console.log("ERRORS:\n" + r.errors.join("\n"));
    else console.log("ERRORS: none");
    if (r.warns.length) console.log("WARNS/ALERTS:\n" + r.warns.join("\n"));
    else console.log("WARNS/ALERTS: none");
  }

  // Unconfigured run: the blank-panel regression test
  supabaseRows = { hit_claims: [], strike_teams: [], strike_team_members: [], strike_team_targets: [], faction_config: [] };
  const r2 = await run("tampermonkey", {});
  console.log("\n================ TAMPERMONKEY (UNCONFIGURED - blank pane test) ================");
  console.log(JSON.stringify(r2.checks.panes, null, 2));
  console.log("errors: " + (r2.errors.length ? r2.errors.join("; ") : "none"));

  // Teammate experience: run the SHIPPED file exactly as it is, with only a
  // Torn API key stored and no Supabase settings — i.e. whatever is actually
  // in BAKED_IN must carry the whole thing.
  console.log("\n================ BAKED-IN CONFIG (teammate experience, file as shipped) ================");
  {
    // What does the shipped file claim to be baked in?
    const m = code.match(/const BAKED_IN = \{([\s\S]*?)\};/);
    const raw = m ? m[1] : "";
    const grab = (k) => {
      const mm = raw.match(new RegExp(k + ':\\s*\\n?\\s*"([^"]*)"'));
      return mm ? mm[1] : "";
    };
    const unbake = (v) => (v.startsWith("b64:") ? Buffer.from(v.slice(4), "base64").toString() : v);
    const expectedUrl = unbake(grab("supabaseUrl"));
    const expectedKey = unbake(grab("supabaseAnonKey"));
    console.log(`   BAKED_IN url -> ${expectedUrl || "(empty)"}`);
    if (expectedKey) {
      try {
        const p = JSON.parse(Buffer.from(expectedKey.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
        console.log(`   BAKED_IN key -> role=${p.role} ref=${p.ref} ${expectedUrl.includes(p.ref) ? "(matches url)" : "(!! DOES NOT MATCH URL)"}`);
        if (p.role !== "anon") console.log("   *** WARNING: baked key is not the anon role — do NOT publish ***");
      } catch {
        console.log("   BAKED_IN key -> not a decodable JWT");
      }
    } else {
      console.log("   BAKED_IN key -> (empty)");
    }

    supabaseRows = { hit_claims: [], strike_teams: [], strike_team_members: [], strike_team_targets: [], faction_config: [] };
    const r3 = await run("tampermonkey", { tgh_tornApiKey: "TESTKEY123", tgh_userId: "111", tgh_username: "NatTest", tgh_myFactionId: "999", tgh_enemyFactionId: "888" });
    const reached = r3.checks.supabaseUrlUsed || "(none)";
    const urlOk = expectedUrl && reached === expectedUrl;
    console.log(`   reached=${reached} ${urlOk ? "OK" : "MISMATCH"}`);
    console.log(`   claimInserted=${r3.checks.claimInserted} (want 1)   settingsShowsBuiltIn=${r3.checks.settingsBuiltInBadge} (want true)`);
    console.log(`   errors: ${r3.errors.length ? r3.errors.join("; ") : "none"}`);
    const pass = urlOk && r3.checks.claimInserted === 1 && r3.checks.settingsBuiltInBadge === true && r3.errors.length === 0;
    console.log(`   ${pass ? "*** BAKED-IN CONFIG WORKS ***" : "*** BAKED-IN CONFIG FAILED ***"}`);
  }

  // Override precedence: a value typed into Settings must beat the baked-in one.
  console.log("\n================ SETTINGS OVERRIDE BEATS BAKED-IN ================");
  {
    supabaseRows = { hit_claims: [], strike_teams: [], strike_team_members: [], strike_team_targets: [], faction_config: [] };
    const r4 = await run("tampermonkey", {
      tgh_tornApiKey: "TESTKEY123", tgh_userId: "111", tgh_username: "NatTest",
      tgh_myFactionId: "999", tgh_enemyFactionId: "888",
      tgh_supabaseUrl: "https://override.supabase.co", tgh_supabaseAnonKey: "override-key",
    });
    const ok = r4.checks.supabaseUrlUsed === "https://override.supabase.co" && r4.checks.settingsBuiltInBadge === false;
    console.log(`   reached=${r4.checks.supabaseUrlUsed} builtInBadge=${r4.checks.settingsBuiltInBadge} -> ${ok ? "OK" : "FAILED"}`);
  }
})();
