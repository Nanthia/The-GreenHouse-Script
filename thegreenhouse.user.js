// ==UserScript==
// @name         The Green House
// @namespace    thegreenhouse-tm
// @version      2.3.2
// @description  Torn City faction war-room suite: Hit Caller, Strike Teams, Chain Manager and Air Traffic Control in one hub, floating over any Torn page.
// @author       The Green House
// @match        https://www.torn.com/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.xmlHttpRequest
// @grant        GM.registerMenuCommand
// @connect      api.torn.com
// @connect      ffscouter.com
// @connect      *.supabase.co
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Nanthia/The-GreenHouse-Script/main/thegreenhouse.user.js
// @downloadURL  https://raw.githubusercontent.com/Nanthia/The-GreenHouse-Script/main/thegreenhouse.user.js
// ==/UserScript==

/* =======================================================================
 * Runs on both Tampermonkey (sync GM_* API) and Greasemonkey 4+ (async GM.*).
 * All storage is preloaded into a synchronous in-memory cache at boot, so
 * module code can read settings synchronously on either engine.
 * =====================================================================*/

(async function () {
  "use strict";

  if (window.TGH_HUB && window.TGH_HUB.__ready) return;
  if (window.top !== window.self) return; // belt-and-braces alongside @noframes

  /* =====================================================================
   * ####################################################################
   * ##  FACTION CONFIG — fill these two in before sharing the script  ##
   * ####################################################################
   *
   * Paste your Supabase project URL and publishable (anon) key here and
   * the rest of the faction won't have to configure anything: they install
   * the script, paste their own Torn API key, and Hit Caller / Strike
   * Teams just work.
   *
   * This key is meant to be public — Supabase calls its replacement a
   * "publishable" key precisely because client apps can't hide secrets.
   * BUT it is only safe to ship once row-level security is switched on:
   * run rls_setup.sql first. Without RLS this key is a master key to
   * your whole database, including your Torn API key.
   *
   * Optional: because the raw file has to sit in a PUBLIC GitHub repo for
   * Tampermonkey to auto-update from it, automated bots that trawl GitHub
   * for Supabase keys will eventually find a plain one. Prefixing a value
   * with "b64:" and base64-ing the rest defeats those scanners. To be
   * clear this is NOT security — anyone can decode it in a second, and
   * your teammates can read it either way. It only stops drive-by
   * scraping, which is worth something on a public repo.
   *
   *   plain:   supabaseUrl: "https://abcd.supabase.co"
   *   base64:  supabaseUrl: "b64:aHR0cHM6Ly9hYmNkLnN1cGFiYXNlLmNv"
   *
   * Generate one in your browser console:  btoa("your-value-here")
   * ===================================================================*/
  // Project lmgljqelfeivxswwjahi. Base64'd only to keep automated key
  // scrapers off a public repo — decode with atob() if you need to read them.
  //   url: https://lmgljqelfeivxswwjahi.supabase.co
  //   key: role "anon", expires 2036-08-31
  const BAKED_IN = {
    supabaseUrl: "b64:aHR0cHM6Ly9sbWdsanFlbGZlaXZ4c3d3amFoaS5zdXBhYmFzZS5jbw==",
    supabaseAnonKey:
      "b64:ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW14dFoyeHFjV1ZzWm1WcGRuaHpkM2RxWVdocElpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzT0RneE9ETTVPVGNzSW1WNGNDSTZNakV3TXpjMU9UazVOMzAuYTNER1RRVVNPenVlWkNTWWlCLTY2MFpHRFlFeVZsYTdUbV9LbHRPMDF6cw==",
  };

  // The userscript auto-detects the war from each member's own API key, so
  // mirroring it into faction_config is redundant. Leave this false and
  // rls_setup.sql can keep that table (which holds API keys) fully closed.
  const SYNC_WAR_TO_SUPABASE = false;

  function unbake(v) {
    if (typeof v !== "string") return "";
    if (!v.startsWith("b64:")) return v.trim();
    try {
      return atob(v.slice(4)).trim();
    } catch (e) {
      console.warn("[TheGreenHouse] Could not decode a b64: config value.");
      return "";
    }
  }

  /* =====================================================================
   * GM COMPATIBILITY SHIM
   * ===================================================================*/
  const GMC = {
    hasLegacyGet: typeof GM_getValue === "function",
    hasLegacySet: typeof GM_setValue === "function",
    hasModern: typeof GM !== "undefined" && GM !== null,

    async getValue(key, def) {
      try {
        if (GMC.hasLegacyGet) return GM_getValue(key, def);
        if (GMC.hasModern && typeof GM.getValue === "function") {
          const v = await GM.getValue(key);
          return v === undefined ? def : v;
        }
      } catch (e) {
        console.warn("[TheGreenHouse] storage read failed for " + key, e);
      }
      return def;
    },

    setValue(key, value) {
      try {
        if (GMC.hasLegacySet) return GM_setValue(key, value);
        if (GMC.hasModern && typeof GM.setValue === "function") {
          // Fire-and-forget; the in-memory cache is the source of truth.
          return GM.setValue(key, value).catch((e) => console.warn("[TheGreenHouse] storage write failed for " + key, e));
        }
      } catch (e) {
        console.warn("[TheGreenHouse] storage write failed for " + key, e);
      }
    },

    xhr(opts) {
      const fn =
        typeof GM_xmlhttpRequest === "function"
          ? GM_xmlhttpRequest
          : GMC.hasModern && typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest
          : null;
      if (!fn) throw new Error("No GM_xmlhttpRequest / GM.xmlHttpRequest available. Grant it in the script header.");
      return fn(opts);
    },

    addStyle(css) {
      if (typeof GM_addStyle === "function") {
        try {
          return GM_addStyle(css);
        } catch (e) {
          /* fall through to manual injection */
        }
      }
      const el = document.createElement("style");
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
      return el;
    },

    registerMenuCommand(label, fn) {
      try {
        if (typeof GM_registerMenuCommand === "function") return GM_registerMenuCommand(label, fn);
        if (GMC.hasModern && typeof GM.registerMenuCommand === "function") return GM.registerMenuCommand(label, fn);
      } catch (e) {
        /* menu commands are optional */
      }
    },
  };

  /* =====================================================================
   * SETTINGS (preloaded into a sync cache)
   * ===================================================================*/
  const DEFAULTS = {
    tornApiKey: "",
    ffsApiKey: "",
    username: "",
    userId: "",
    myFactionId: "",
    myFactionName: "",
    enemyFactionId: "",
    enemyFactionName: "",
    enemyFactionManual: false, // true once the user types an enemy ID by hand
    supabaseUrl: "",
    supabaseAnonKey: "",
    claimTtlSeconds: 120,
    theme: "dark",
  };
  const EXTRA_KEYS = { hubPos: null, fabPos: null, lastTab: null };

  const cache = {};
  await Promise.all(
    Object.keys(DEFAULTS).map(async (k) => {
      cache[k] = await GMC.getValue("tgh_" + k, DEFAULTS[k]);
    })
  );
  await Promise.all(
    Object.keys(EXTRA_KEYS).map(async (k) => {
      cache[k] = await GMC.getValue("tgh_" + k, EXTRA_KEYS[k]);
    })
  );

  const settings = {
    get(key) {
      const v = cache[key];
      return v === undefined ? DEFAULTS[key] : v;
    },
    set(key, value) {
      cache[key] = value;
      GMC.setValue("tgh_" + key, value);
      window.dispatchEvent(new CustomEvent("tgh:settings-changed", { detail: { key, value } }));
    },
    getAll() {
      const out = {};
      Object.keys(DEFAULTS).forEach((k) => (out[k] = settings.get(k)));
      return out;
    },
    isTornConfigured() {
      return !!settings.get("tornApiKey");
    },
    hasIdentity() {
      return !!String(settings.get("userId") || "").replace(/\D/g, "");
    },
    // A value typed into Settings wins; otherwise fall back to whatever is
    // baked into the script, so most members configure nothing.
    supabaseUrl() {
      return String(settings.get("supabaseUrl") || "").trim() || unbake(BAKED_IN.supabaseUrl);
    },
    supabaseKey() {
      return String(settings.get("supabaseAnonKey") || "").trim() || unbake(BAKED_IN.supabaseAnonKey);
    },
    supabaseIsBakedIn() {
      return !String(settings.get("supabaseUrl") || "").trim() && !!unbake(BAKED_IN.supabaseUrl);
    },
    isSupabaseConfigured() {
      const url = settings.supabaseUrl();
      const key = settings.supabaseKey();
      if (!url || !key) return false;
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
  };

  /* =====================================================================
   * HTTP
   * ===================================================================*/
  const REQUEST_TIMEOUT_MS = 15000;

  function gmRequest({ method = "GET", url, headers = {}, data }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let watchdog = null;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        fn(arg);
      };
      // Greasemonkey's GM.xmlHttpRequest doesn't reliably honour `timeout` /
      // `ontimeout`, so don't depend on the implementation to time out — if
      // nothing has settled by now, fail it here. Without this a hung request
      // leaves the panel stuck on "Loading..." forever.
      watchdog = setTimeout(
        () => done(reject, new Error("Request timed out after " + REQUEST_TIMEOUT_MS / 1000 + "s: " + url)),
        REQUEST_TIMEOUT_MS + 1000
      );
      const maybePromise = GMC.xhr({
        method,
        url,
        headers,
        data,
        timeout: REQUEST_TIMEOUT_MS,
        onload: (res) => {
          let parsed = null;
          try {
            parsed = res.responseText ? JSON.parse(res.responseText) : null;
          } catch {
            parsed = res.responseText;
          }
          done(resolve, { status: res.status, data: parsed });
        },
        onerror: () => done(reject, new Error("Network request failed: " + url)),
        ontimeout: () => done(reject, new Error("Request timed out: " + url)),
      });
      // GM4's GM.xmlHttpRequest also returns a thenable; harmless if it resolves first.
      if (maybePromise && typeof maybePromise.catch === "function") {
        maybePromise.catch(() => done(reject, new Error("Network request failed: " + url)));
      }
    });
  }

  async function fetchTorn(endpoint) {
    const apiKey = settings.get("tornApiKey");
    if (!apiKey) throw new Error("No Torn API key configured. Open the Settings tab.");
    const sep = endpoint.includes("?") ? "&" : "?";
    const url = `https://api.torn.com/${endpoint}${sep}key=${encodeURIComponent(apiKey)}`;
    const { data } = await gmRequest({ url });
    if (data && data.error) throw new Error(`Torn API error ${data.error.code}: ${data.error.error}`);
    return data;
  }

  async function fetchFFS(endpoint, opts = {}) {
    const url = `https://ffscouter.com/api/v1/${endpoint}`;
    const { data } = await gmRequest({
      method: opts.method || "GET",
      url,
      headers: opts.body ? { "Content-Type": "application/json" } : {},
      data: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (data && data.code && data.code !== 0) throw new Error(`FFScouter error ${data.code}: ${data.error}`);
    return data;
  }

  /* =====================================================================
   * SUPABASE REST (PostgREST)
   * ===================================================================*/
  const supa = {
    async _req(method, table, { query = "", body, prefer } = {}) {
      const url = settings.supabaseUrl();
      const key = settings.supabaseKey();
      if (!url || !key) throw new Error("Supabase is not configured. Open the Settings tab.");
      const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      if (prefer) headers["Prefer"] = prefer;
      const { status, data } = await gmRequest({
        method,
        url: `${url.replace(/\/$/, "")}/rest/v1/${table}${query}`,
        headers,
        data: body ? JSON.stringify(body) : undefined,
      });
      if (status >= 400) {
        const msg = (data && (data.message || data.error || data.hint)) || `Supabase error ${status}`;
        throw new Error(msg);
      }
      return data;
    },
    select(table, { select = "*", filters = [], order } = {}) {
      const params = new URLSearchParams();
      params.set("select", select);
      filters.forEach(([col, op, val]) => params.append(col, `${op}.${val}`));
      if (order) params.set("order", order);
      return supa._req("GET", table, { query: `?${params.toString()}` });
    },
    async insert(table, row, { returning = false } = {}) {
      const res = await supa._req("POST", table, {
        body: row,
        prefer: returning ? "return=representation" : "return=minimal",
      });
      if (!returning) return res;
      const unwrapped = Array.isArray(res) ? res[0] : res;
      if (!unwrapped) {
        throw new Error("Insert succeeded but returned no row (check the table's SELECT policy).");
      }
      return unwrapped;
    },
    update(table, patch, filters) {
      const params = new URLSearchParams();
      filters.forEach(([col, op, val]) => params.append(col, `${op}.${val}`));
      return supa._req("PATCH", table, { query: `?${params.toString()}`, body: patch, prefer: "return=minimal" });
    },
    upsert(table, row, onConflict) {
      const params = new URLSearchParams();
      if (onConflict) params.set("on_conflict", onConflict);
      return supa._req("POST", table, { query: `?${params.toString()}`, body: row, prefer: "resolution=merge-duplicates,return=minimal" });
    },
    delete(table, filters) {
      const params = new URLSearchParams();
      filters.forEach(([col, op, val]) => params.append(col, `${op}.${val}`));
      return supa._req("DELETE", table, { query: `?${params.toString()}` });
    },
  };

  /* =====================================================================
   * STYLES
   * ===================================================================*/
  GMC.addStyle(`
    :root.tgh-theme-dark {
      --tgh-bg: #1a1625; --tgh-surface: #221d30; --tgh-surface-raised: #2a2440;
      --tgh-border: #352f4a; --tgh-text: #ede9f6; --tgh-muted: #8b82a7;
      --tgh-accent: #b48ecf; --tgh-accent-soft: #8b6aad;
      --tgh-okay: #6bcb8b; --tgh-hospital: #e07b7b; --tgh-traveling: #7babe0;
      --tgh-jail: #e0a056; --tgh-fallen: #6b6482; --tgh-idle: #d4b84a;
    }
    :root.tgh-theme-light {
      --tgh-bg: #f5f3f9; --tgh-surface: #ffffff; --tgh-surface-raised: #ede9f6;
      --tgh-border: #d4cfe3; --tgh-text: #1a1625; --tgh-muted: #6b6482;
      --tgh-accent: #7c5ca8; --tgh-accent-soft: #9b78c4;
      --tgh-okay: #2f8f52; --tgh-hospital: #c23a3a; --tgh-traveling: #2e6bb8;
      --tgh-jail: #b8722a; --tgh-fallen: #6b6482; --tgh-idle: #a3841f;
    }

    #tgh-fab {
      position: fixed; left: 12px; bottom: 12px; z-index: 999998;
      width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--tgh-border);
      background: var(--tgh-surface-raised); color: var(--tgh-accent); cursor: grab;
      display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4); font-family: sans-serif;
      user-select: none; touch-action: none;
    }
    #tgh-fab:hover, #tgh-fab.tgh-active { border-color: var(--tgh-accent); }
    #tgh-fab.tgh-dragging { cursor: grabbing; opacity: 0.85; }

    #tgh-hub {
      position: fixed; width: 800px; max-width: calc(100vw - 24px); height: 580px; max-height: calc(100vh - 24px);
      background: var(--tgh-bg); color: var(--tgh-text); border: 1px solid var(--tgh-border);
      border-radius: 10px; box-shadow: 0 14px 44px rgba(0,0,0,0.55); z-index: 999999;
      display: flex; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px;
    }
    #tgh-hub.tgh-hidden { display: none; }
    #tgh-hub-header {
      padding: 10px 12px; background: var(--tgh-surface); border-bottom: 1px solid var(--tgh-border);
      display: flex; align-items: center; justify-content: space-between; cursor: move;
    }
    #tgh-hub-header .tgh-title { font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; font-size: 12px; }
    #tgh-hub-header .tgh-sub { color: var(--tgh-muted); font-size: 10px; margin-top: 2px; }
    #tgh-hub-close { background: none; border: none; color: var(--tgh-muted); cursor: pointer; font-size: 16px; padding: 2px 6px; }
    #tgh-hub-close:hover { color: var(--tgh-hospital); }

    #tgh-hub-body { flex: 1; display: flex; overflow: hidden; }
    #tgh-hub-nav { width: 152px; flex-shrink: 0; background: var(--tgh-surface); border-right: 1px solid var(--tgh-border); overflow-y: auto; }
    #tgh-hub-nav .tgh-nav-item {
      display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer;
      color: var(--tgh-muted); border-left: 2px solid transparent; font-size: 11px;
    }
    #tgh-hub-nav .tgh-nav-item:hover { color: var(--tgh-text); background: var(--tgh-surface-raised); }
    #tgh-hub-nav .tgh-nav-item.tgh-active { color: var(--tgh-accent); border-left-color: var(--tgh-accent); background: var(--tgh-surface-raised); }
    #tgh-hub-content { flex: 1; overflow: hidden; background: var(--tgh-bg); display: flex; flex-direction: column; }

    #tgh-hub input, #tgh-hub select, #tgh-hub textarea, #tgh-hub button {
      font-family: inherit; font-size: 11px; color: var(--tgh-text);
      background: var(--tgh-surface); border: 1px solid var(--tgh-border); border-radius: 4px; padding: 4px 6px;
    }
    #tgh-hub button { cursor: pointer; }
    #tgh-hub button.tgh-primary { background: var(--tgh-okay); color: #08210f; font-weight: 700; border: none; }
    #tgh-hub button.tgh-danger:hover { border-color: var(--tgh-hospital); color: var(--tgh-hospital); }
    #tgh-hub table { width: 100%; border-collapse: collapse; }
    #tgh-hub th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--tgh-muted); padding: 6px 8px; border-bottom: 1px solid var(--tgh-border); position: sticky; top: 0; background: var(--tgh-surface); }
    #tgh-hub th.tgh-sortable { cursor: pointer; user-select: none; }
    #tgh-hub th.tgh-sortable:hover { color: var(--tgh-text); }
    #tgh-hub td { padding: 6px 8px; border-bottom: 1px solid var(--tgh-border); vertical-align: top; }
    #tgh-hub a.tgh-link { color: var(--tgh-accent); text-decoration: none; }
    #tgh-hub a.tgh-link:hover { text-decoration: underline; }
    .tgh-muted { color: var(--tgh-muted); }
    .tgh-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tgh-field { display: flex; flex-direction: column; gap: 2px; }
    .tgh-field label { font-size: 9px; text-transform: uppercase; color: var(--tgh-muted); }
    .tgh-badge { padding: 1px 6px; border-radius: 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
    .tgh-banner { padding: 6px 10px; font-size: 10px; border-bottom: 1px solid var(--tgh-border); }
    .tgh-banner-err { background: rgba(224,123,123,0.12); color: var(--tgh-hospital); }
    .tgh-banner-warn { background: rgba(224,160,86,0.12); color: var(--tgh-jail); }
    .tgh-scroll { flex: 1; overflow: auto; }
    .tgh-pad { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  `);

  function applyTheme() {
    const t = settings.get("theme") === "light" ? "light" : "dark";
    document.documentElement.classList.remove("tgh-theme-dark", "tgh-theme-light");
    document.documentElement.classList.add("tgh-theme-" + t);
  }
  applyTheme();
  window.addEventListener("tgh:settings-changed", (e) => {
    if (e.detail.key === "theme") applyTheme();
  });

  /* =====================================================================
   * HELPERS
   * ===================================================================*/
  const h = (tag, attrs = {}, children = []) => {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  };

  function relTime(ts) {
    if (!ts) return "—";
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const hh = Math.floor(m / 60);
    if (hh < 24) return `${hh}h ago`;
    return `${Math.floor(hh / 24)}d ago`;
  }

  function fmtDuration(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    if (hh > 0) return `${hh}h ${mm}m`;
    return `${mm}m ${ss}s`;
  }

  const numId = (v) => Number(String(v == null ? "" : v).replace(/\D/g, "")) || 0;
  const cleanId = (v) => String(v == null ? "" : v).replace(/\D/g, "");

  // Beep generated locally — no remote asset, so no page-CSP or autoplay-asset issues.
  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      osc.onended = () => ctx.close().catch(() => {});
    } catch (e) {
      /* audio is best-effort */
    }
  }

  // True while the user is actively typing inside a module, so background
  // polls can defer their re-render instead of destroying half-typed input.
  function isEditing(root) {
    const el = document.activeElement;
    if (!el || !root || !root.contains(el)) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  // Replace a list container's contents while preserving scroll position.
  function swapPreservingScroll(host, buildFn) {
    const top = host.scrollTop;
    host.innerHTML = "";
    buildFn(host);
    host.scrollTop = top;
  }

  /* =====================================================================
   * IDENTITY BOOTSTRAP - pulls your own ID / name / faction from Torn so
   * nothing depends on a hand-typed ID or a char-code hash.
   * ===================================================================*/
  let identityPromise = null;
  async function bootstrapIdentity(force) {
    if (!settings.isTornConfigured()) return;
    if (!force && settings.hasIdentity() && settings.get("myFactionId")) return;
    if (identityPromise) return identityPromise;
    identityPromise = (async () => {
      try {
        const me = await fetchTorn("user?selections=basic,profile");
        if (me && me.player_id) {
          settings.set("userId", String(me.player_id));
          if (me.name) settings.set("username", me.name);
          const fac = me.faction || {};
          if (fac.faction_id) {
            settings.set("myFactionId", String(fac.faction_id));
            if (fac.faction_name) settings.set("myFactionName", fac.faction_name);
          }
          window.dispatchEvent(new CustomEvent("tgh:identity-ready"));
        }
      } catch (e) {
        console.warn("[TheGreenHouse] Identity bootstrap failed:", e.message);
      } finally {
        identityPromise = null;
      }
    })();
    return identityPromise;
  }

  /* =====================================================================
   * WAR AUTO-DETECT
   * ===================================================================*/
  let lastWarCheck = 0;
  async function checkWarStatus() {
    if (Date.now() - lastWarCheck < 55000) return;
    lastWarCheck = Date.now();
    if (!settings.isTornConfigured()) return;
    try {
      const factionRes = await fetchTorn("faction");
      if (!factionRes) return;

      // Trust the API for our own faction ID rather than a possibly-blank setting.
      let myFactionId = cleanId(settings.get("myFactionId"));
      if (factionRes.ID && !myFactionId) {
        myFactionId = String(factionRes.ID);
        settings.set("myFactionId", myFactionId);
        if (factionRes.name) settings.set("myFactionName", factionRes.name);
      }

      let enemyId = null;
      let enemyName = null;
      if (factionRes.ranked_wars) {
        const warKeys = Object.keys(factionRes.ranked_wars);
        if (warKeys.length > 0) {
          const firstWar = factionRes.ranked_wars[warKeys[0]];
          if (firstWar && firstWar.factions) {
            const factionIds = Object.keys(firstWar.factions);
            // Only exclude our own faction when we actually know what it is.
            const found = myFactionId ? factionIds.find((id) => String(id) !== String(myFactionId)) : null;
            if (found) {
              enemyId = found;
              enemyName = (firstWar.factions[found] || {}).name || null;
            }
          }
        }
      }

      const prevEnemyId = cleanId(settings.get("enemyFactionId"));
      if (enemyId) {
        // A live war always wins, and clears the "manual" flag.
        if (String(enemyId) !== prevEnemyId) {
          settings.set("enemyFactionId", String(enemyId));
          settings.set("enemyFactionName", enemyName || "");
          settings.set("enemyFactionManual", false);
          window.dispatchEvent(new CustomEvent("tgh:war-changed", { detail: { enemyId, enemyName } }));
        }
      } else if (prevEnemyId && !settings.get("enemyFactionManual")) {
        // War ended and the value was auto-detected, so it's safe to clear.
        // A manually entered enemy faction is never wiped.
        settings.set("enemyFactionId", "");
        settings.set("enemyFactionName", "");
        window.dispatchEvent(new CustomEvent("tgh:war-changed", { detail: { enemyId: null, enemyName: null } }));
      }

      // Redundant by default: every client detects the war from its own API
      // key, so faction_config (which holds API keys) can stay fully locked.
      if (SYNC_WAR_TO_SUPABASE && settings.isSupabaseConfigured() && enemyId) {
        try {
          const rows = await supa.select("faction_config", { filters: [["id", "eq", "00000000-0000-0000-0000-000000000000"]] });
          const row = rows && rows[0];
          if (!row || String(row.enemy_faction_id || "") !== String(enemyId)) {
            await supa.upsert(
              "faction_config",
              {
                id: "00000000-0000-0000-0000-000000000000",
                enemy_faction_id: enemyId,
                enemy_faction_name: enemyName || null,
                updated_at: new Date().toISOString(),
              },
              "id"
            );
          }
        } catch (e) {
          console.warn("[TheGreenHouse] Supabase war sync failed:", e.message);
        }
      }
    } catch (e) {
      console.warn("[TheGreenHouse] War auto-detect failed:", e.message);
    }
  }

  setTimeout(() => {
    bootstrapIdentity().then(checkWarStatus);
  }, 3000);
  setInterval(checkWarStatus, 60000);

  /* =====================================================================
   * MODULE: SETTINGS
   * ===================================================================*/
  const SettingsModule = {
    id: "settings",
    title: "Settings",
    icon: "⚙",
    mount(container) {
      const scroll = h("div", { class: "tgh-scroll" });
      container.appendChild(scroll);

      function build() {
        // Rebuilt in place (not via a re-mount) so the identity bootstrap can
        // refresh the auto-filled fields without touching the hub lifecycle.
        const s = settings.getAll();
        const wrap = h("div", { class: "tgh-pad" });

        const field = (label, key, placeholder, type = "text", onChange) => {
          const input = h("input", { type, placeholder: placeholder || "" });
          input.value = s[key] === null || s[key] === undefined ? "" : s[key];
          input.addEventListener("change", (e) => {
            settings.set(key, e.target.value);
            if (onChange) onChange(e.target.value);
          });
          return h("div", { class: "tgh-field" }, [h("label", {}, label), input]);
        };

        wrap.appendChild(h("div", { class: "tgh-muted" }, "Identity"));
        wrap.appendChild(
          h("div", { class: "tgh-row" }, [
            field("Torn API key", "tornApiKey", "xxxxxxxxxxxxxxxx", "text", () => {
              bootstrapIdentity(true).then(() => {
                if (scroll.isConnected) build();
              });
            }),
            field("FFScouter API key (optional)", "ffsApiKey", "optional"),
          ])
        );
        wrap.appendChild(h("div", { class: "tgh-row" }, [field("Your Torn ID", "userId", "auto"), field("Torn Username", "username", "auto")]));
        wrap.appendChild(h("div", { class: "tgh-muted", style: "font-size:10px;" }, "Your ID, name and faction fill in automatically from your API key."));
        if (!settings.hasIdentity()) {
          wrap.appendChild(
            h("div", { class: "tgh-banner tgh-banner-warn", style: "border:0; border-radius:4px;" }, "No Torn ID yet. Hit Caller claims and Strike Teams need it — enter your API key above and it will populate, or type your ID in manually.")
          );
        }

        wrap.appendChild(h("div", { class: "tgh-muted", style: "margin-top:8px;" }, "Faction"));
        wrap.appendChild(
          h("div", { class: "tgh-row" }, [
            field("My Faction ID", "myFactionId", "auto"),
            field("Enemy Faction ID", "enemyFactionId", "auto during war", "text", (v) => {
              // Mark as manual so war auto-detect never wipes a hand-typed value.
              settings.set("enemyFactionManual", !!cleanId(v));
            }),
          ])
        );
        if (settings.get("enemyFactionName")) {
          wrap.appendChild(h("div", { class: "tgh-muted", style: "font-size:10px;" }, "Current enemy: " + settings.get("enemyFactionName")));
        }
        wrap.appendChild(h("div", { class: "tgh-row" }, [field("Claim TTL (seconds)", "claimTtlSeconds", "120", "number")]));

        wrap.appendChild(h("div", { class: "tgh-muted", style: "margin-top:8px;" }, "Shared database (Supabase) — required for Hit Caller & Strike Teams"));
        if (settings.supabaseIsBakedIn()) {
          // Nothing for most members to do — keep the fields collapsed behind
          // a toggle so nobody "fixes" a working setup.
          wrap.appendChild(
            h("div", { class: "tgh-row" }, [
              h("span", { class: "tgh-badge", style: "border:1px solid var(--tgh-okay); color:var(--tgh-okay);" }, "Built in"),
              h("span", { class: "tgh-muted", style: "font-size:10px;" }, "Connected using the faction's database. Nothing to enter here."),
            ])
          );
          const overrideHost = h("div", {});
          const overrideBtn = h("button", {
            onclick: () => {
              overrideHost.innerHTML = "";
              overrideHost.appendChild(h("div", { class: "tgh-row" }, [field("Supabase URL", "supabaseUrl", "https://xxxx.supabase.co"), field("Supabase anon key", "supabaseAnonKey", "eyJ...")]));
              overrideHost.appendChild(h("div", { class: "tgh-muted", style: "font-size:10px;" }, "Leave both blank to go back to the built-in database."));
            },
          }, "Use a different database…");
          wrap.appendChild(h("div", { class: "tgh-row", style: "margin-top:4px;" }, [overrideBtn]));
          wrap.appendChild(overrideHost);
        } else {
          wrap.appendChild(h("div", { class: "tgh-row" }, [field("Supabase URL", "supabaseUrl", "https://xxxx.supabase.co"), field("Supabase anon key", "supabaseAnonKey", "eyJ...")]));
          wrap.appendChild(h("div", { class: "tgh-muted", style: "font-size:10px; max-width:560px;" }, "Same project the webapp uses. Everyone in the faction needs the same URL/key for claims and strike teams to sync — or bake them into the script once (see BAKED_IN at the top of the file) so nobody has to."));
        }

        wrap.appendChild(h("div", { class: "tgh-muted", style: "margin-top:8px;" }, "Appearance"));
        const themeSel = h("select", {}, [h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "Light")]);
        themeSel.value = s.theme;
        themeSel.addEventListener("change", (e) => settings.set("theme", e.target.value));
        wrap.appendChild(h("div", { class: "tgh-row" }, [themeSel]));

        wrap.appendChild(
          h("div", { class: "tgh-row", style: "margin-top:8px;" }, [
            h("button", {
              onclick: () => {
                settings.set("hubPos", null);
                resetHubPos();
              },
            }, "Reset panel position"),
            h("button", {
              onclick: () => {
                settings.set("fabPos", null);
                resetFabPos();
              },
            }, "Reset button position"),
          ])
        );
        wrap.appendChild(h("div", { class: "tgh-muted", style: "font-size:10px;" }, "Drag the TGH button itself to move it anywhere; drag the panel by its header. Both positions are remembered."));

        scroll.innerHTML = "";
        scroll.appendChild(wrap);
      }

      build();
    },
  };

  /* =====================================================================
   * MODULE: HIT CALLER
   * ===================================================================*/
  const HitCallerModule = {
    id: "hitcaller",
    title: "Hit Caller",
    subtitle: "Live targets & claim coordination",
    icon: "🎯",
    mount(container) {
      const state = {
        loading: true,
        error: "",
        claimsError: "",
        enemies: [],
        ffsStats: {},
        claims: [],
        claimsLoaded: false,
        search: "",
        statusFilter: "All",
        locationFilter: "All",
        ffMin: 0,
        ffMax: 10,
        sortCol: "last_active",
        sortDir: "desc",
        pollMs: 20000,
      };
      let pollTimer = null, claimsTimer = null, lastFfsFetch = 0, destroyed = false;
      const prevHospStates = {};
      // Targets this session claimed, kept independently of TTL so the
      // out-of-hospital alert still fires after a short claim has expired.
      const myWatchedTargets = new Set();

      function me() {
        return { id: numId(settings.get("userId")), name: settings.get("username") || "Unknown" };
      }

      /* ---------- chrome (built once) ---------- */
      const banner = h("div", {});
      const toolbar = h("div", { class: "tgh-row", style: "padding:8px 10px; border-bottom:1px solid var(--tgh-border); background:var(--tgh-surface);" });
      const tableHost = h("div", { class: "tgh-scroll" });
      container.appendChild(banner);
      container.appendChild(toolbar);
      container.appendChild(tableHost);

      const searchInput = h("input", { placeholder: "Search...", style: "width:110px;" });
      searchInput.value = state.search;
      // Only the table is rebuilt on input, so focus and caret survive.
      searchInput.addEventListener("input", (e) => {
        state.search = e.target.value;
        refreshTable();
      });
      const statusSel = h("select", {}, ["All", "Okay only", "Online only", "Offline only", "Hide Fedded-Fallen"].map((o) => h("option", { value: o }, o)));
      statusSel.value = state.statusFilter;
      statusSel.addEventListener("change", (e) => {
        state.statusFilter = e.target.value;
        refreshTable();
      });
      const locSel = h("select", {}, ["All", "Torn", "Abroad"].map((o) => h("option", { value: o }, o)));
      locSel.value = state.locationFilter;
      locSel.addEventListener("change", (e) => {
        state.locationFilter = e.target.value;
        refreshTable();
      });
      const ffMinInput = h("input", { type: "number", step: "0.1", style: "width:46px;" });
      ffMinInput.value = state.ffMin;
      ffMinInput.addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        state.ffMin = Number.isFinite(v) ? v : 0;
        e.target.value = state.ffMin;
        refreshTable();
      });
      const ffMaxInput = h("input", { type: "number", step: "0.1", style: "width:46px;" });
      ffMaxInput.value = state.ffMax;
      ffMaxInput.addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        // Blank/garbage must not mean "0", which would filter everything out.
        state.ffMax = Number.isFinite(v) ? v : 10;
        e.target.value = state.ffMax;
        refreshTable();
      });
      const pollSel = h("select", {}, [10000, 20000, 30000, 60000].map((ms) => h("option", { value: ms }, ms / 1000 + "s")));
      pollSel.value = state.pollMs;
      pollSel.addEventListener("change", (e) => {
        state.pollMs = Number(e.target.value);
        startPolling();
      });
      const wipeBtn = h("button", { onclick: () => releaseTarget() }, "Wipe My Claims");

      toolbar.appendChild(searchInput);
      toolbar.appendChild(h("span", { class: "tgh-muted" }, "Status"));
      toolbar.appendChild(statusSel);
      toolbar.appendChild(h("span", { class: "tgh-muted" }, "Loc"));
      toolbar.appendChild(locSel);
      toolbar.appendChild(h("span", { class: "tgh-muted" }, "FF"));
      toolbar.appendChild(ffMinInput);
      toolbar.appendChild(h("span", {}, "–"));
      toolbar.appendChild(ffMaxInput);
      toolbar.appendChild(h("span", { class: "tgh-muted" }, "Poll"));
      toolbar.appendChild(pollSel);
      toolbar.appendChild(wipeBtn);

      /* ---------- data ---------- */
      async function fetchClaims() {
        const myFactionId = cleanId(settings.get("myFactionId"));
        if (!settings.isSupabaseConfigured() || !myFactionId) return;
        try {
          const rows = await supa.select("hit_claims", {
            filters: [
              ["faction_id", "eq", myFactionId],
              ["released_at", "is", "null"],
              ["expires_at", "gt", new Date().toISOString()],
            ],
            order: "created_at.asc",
          });
          state.claims = rows || [];
          state.claimsLoaded = true;
          state.claimsError = "";
        } catch (e) {
          // Never let a failed claims read look like "no claims" — two people
          // would both think a target is free.
          state.claimsError = e.message;
          console.warn("[TheGreenHouse:HitCaller] claims fetch failed", e.message);
        }
        if (!destroyed) refresh();
      }

      async function fetchData() {
        const factionId = cleanId(settings.get("enemyFactionId"));
        if (!settings.isTornConfigured()) {
          state.loading = false;
          state.error = "";
          if (!destroyed) refresh();
          return;
        }
        if (!factionId) {
          state.loading = false;
          state.error = "";
          if (!destroyed) refresh();
          return;
        }
        try {
          const res = await fetchTorn(`faction/${encodeURIComponent(factionId)}?selections=basic`);
          if (!res || !res.members) throw new Error("Could not load target faction.");
          const rawEnemies = Object.entries(res.members).map(([id, data]) => {
            const st = data.status || {};
            const la = data.last_action || {};
            return {
              id: numId(data.id || id),
              name: data.name || "Unknown",
              level: Number(data.level || 0),
              status: { state: st.state || "Okay", description: st.description || "", until: Number(st.until || 0) },
              last_action: { status: la.status || "Offline", timestamp: Number(la.timestamp || 0) },
            };
          });
          state.enemies = rawEnemies;

          rawEnemies.forEach((e) => {
            const wasHosp = prevHospStates[e.id];
            const isOkay = e.status.state === "Okay";
            if (wasHosp && isOkay && myWatchedTargets.has(e.id)) beep();
            prevHospStates[e.id] = e.status.state === "Hospital";
          });

          const ffsKey = settings.get("ffsApiKey");
          if (ffsKey && Date.now() - lastFfsFetch > 55000) {
            lastFfsFetch = Date.now(); // set before awaiting, so latency can't push the cadence out
            try {
              const ids = rawEnemies.map((e) => e.id);
              const ffsRes = await fetchFFS(`get-stats?key=${encodeURIComponent(ffsKey)}&targets=${ids.join(",")}`);
              let statsList = [];
              if (Array.isArray(ffsRes)) statsList = ffsRes;
              else if (ffsRes && typeof ffsRes === "object") statsList = Array.isArray(ffsRes.stats) ? ffsRes.stats : Array.isArray(ffsRes.data) ? ffsRes.data : Object.values(ffsRes);
              statsList.forEach((item) => {
                if (item && item.player_id != null) {
                  const ff = Number(item.fair_fight);
                  const bs = Number(item.bs_estimate);
                  state.ffsStats[numId(item.player_id)] = {
                    fair_fight: Number.isFinite(ff) ? ff : null,
                    bs_estimate: Number.isFinite(bs) ? bs : null,
                  };
                }
              });
            } catch (e) {
              console.warn("[TheGreenHouse:HitCaller] FFS fetch failed", e.message);
            }
          }
          state.error = "";
        } catch (e) {
          state.error = e.message;
        } finally {
          state.loading = false;
          if (!destroyed) refresh();
        }
      }

      async function claimTarget(targetId, targetName) {
        const myFactionId = cleanId(settings.get("myFactionId"));
        const u = me();
        if (!settings.isSupabaseConfigured()) return alert("Supabase is not configured. Open the Settings tab.");
        if (!myFactionId) return alert("Your faction ID isn't set yet. Open Settings — it fills in from your API key.");
        if (!u.id) return alert("Your Torn ID isn't set yet. Open Settings — it fills in from your API key.\n\nClaims are keyed to your real Torn ID so the rest of the faction sees who claimed what.");
        const ttl = Math.max(10, Number(settings.get("claimTtlSeconds")) || 120);
        try {
          // created_at is deliberately omitted: the database fills it via its
          // column default, so queue order comes from the server clock rather
          // than each member's PC clock (and can't be backdated to jump the
          // queue). The setup SQL revokes insert on that column to enforce it.
          await supa.insert("hit_claims", {
            faction_id: myFactionId,
            target_player_id: targetId,
            target_name: targetName,
            claimer_torn_id: u.id,
            claimer_name: u.name,
            expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
          });
          myWatchedTargets.add(targetId);
          await fetchClaims();
        } catch (e) {
          alert("Failed to claim target: " + e.message);
        }
      }

      async function releaseTarget(targetId) {
        const u = me();
        const myFactionId = cleanId(settings.get("myFactionId"));
        if (!settings.isSupabaseConfigured() || !u.id) return;
        try {
          const filters = [["claimer_torn_id", "eq", u.id], ["released_at", "is", "null"]];
          if (myFactionId) filters.push(["faction_id", "eq", myFactionId]);
          if (targetId) filters.push(["target_player_id", "eq", targetId]);
          await supa.update("hit_claims", { released_at: new Date().toISOString() }, filters);
          if (targetId) myWatchedTargets.delete(targetId);
          else myWatchedTargets.clear();
          await fetchClaims();
        } catch (e) {
          alert("Failed to release claim: " + e.message);
        }
      }

      /* ---------- derived ---------- */
      function processed() {
        return state.enemies.map((e) => {
          const stats = state.ffsStats[e.id] || { fair_fight: null, bs_estimate: null };
          const targetClaims = state.claims
            .filter((c) => numId(c.target_player_id) === e.id)
            .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
          return Object.assign({}, e, { stats, targetClaims });
        });
      }

      const ABROAD_RE = /\b(in|to|returning to|traveling to)\s+(mexico|canada|cayman|hawaii|united kingdom|switzerland|argentina|japan|china|uae|united arab emirates|south africa)\b/i;
      function isAbroad(e) {
        if (e.status.state === "Traveling" || e.status.state === "Abroad") return true;
        return ABROAD_RE.test(e.status.description || "");
      }

      function filteredSorted() {
        let res = processed();
        if (state.search) {
          const q = state.search.toLowerCase();
          res = res.filter((e) => e.name.toLowerCase().includes(q) || String(e.id).includes(q));
        }
        if (state.statusFilter === "Online only") res = res.filter((e) => e.last_action.status === "Online");
        else if (state.statusFilter === "Offline only") res = res.filter((e) => e.last_action.status === "Offline");
        else if (state.statusFilter === "Okay only") res = res.filter((e) => e.status.state === "Okay");
        else if (state.statusFilter === "Hide Fedded-Fallen") res = res.filter((e) => e.status.state !== "Federal" && e.status.state !== "Fallen");

        // Country-aware, so a domestic "In hospital for 1 hour" isn't read as abroad.
        if (state.locationFilter === "Torn") res = res.filter((e) => !isAbroad(e));
        else if (state.locationFilter === "Abroad") res = res.filter((e) => isAbroad(e));

        res = res.filter((e) => {
          if (e.stats.fair_fight === null) return true; // unknown FF shouldn't vanish
          return e.stats.fair_fight >= state.ffMin && e.stats.fair_fight <= state.ffMax;
        });

        const dir = state.sortDir === "asc" ? 1 : -1;
        res.sort((a, b) => {
          let va, vb;
          if (state.sortCol === "last_active") { va = a.last_action.timestamp; vb = b.last_action.timestamp; }
          else if (state.sortCol === "until") { va = a.status.until; vb = b.status.until; }
          else if (state.sortCol === "ff") { va = a.stats.fair_fight ?? -1; vb = b.stats.fair_fight ?? -1; }
          else if (state.sortCol === "bs") { va = a.stats.bs_estimate ?? -1; vb = b.stats.bs_estimate ?? -1; }
          else if (state.sortCol === "name") { return a.name.localeCompare(b.name) * dir; }
          else { va = a.level; vb = b.level; }
          return (va - vb) * dir;
        });
        return res;
      }

      function hospTime(until) {
        if (!until) return "";
        const diff = until - Math.floor(Date.now() / 1000);
        return diff <= 0 ? "" : fmtDuration(diff);
      }
      function fmtBs(bs) {
        if (bs === null || bs === undefined) return "—";
        if (bs >= 1e9) return (bs / 1e9).toFixed(2) + "B";
        if (bs >= 1e6) return (bs / 1e6).toFixed(2) + "M";
        if (bs >= 1e3) return (bs / 1e3).toFixed(2) + "K";
        return String(bs);
      }

      function requestSort(col) {
        if (state.sortCol === col) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else {
          state.sortCol = col;
          state.sortDir = "desc";
        }
        refreshTable();
      }

      /* ---------- render ---------- */
      function refreshBanner() {
        banner.innerHTML = "";
        if (!settings.isTornConfigured()) {
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "No Torn API key set. Open the Settings tab to get started."));
          return;
        }
        if (state.error) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "Torn API: " + state.error));
        if (state.claimsError) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "Claims unavailable (" + state.claimsError + ") — claim info below may be incomplete."));
        else if (settings.isSupabaseConfigured() && !state.claimsLoaded) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "Loading claims…"));
        else if (!settings.isSupabaseConfigured()) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "Supabase not configured — target list works, but claims are disabled."));
      }

      function refreshTable() {
        swapPreservingScroll(tableHost, (host) => {
          if (!settings.isTornConfigured()) {
            host.appendChild(h("div", { class: "tgh-muted", style: "padding:24px; text-align:center;" }, "Add your Torn API key in Settings to load targets."));
            return;
          }
          if (!cleanId(settings.get("enemyFactionId"))) {
            host.appendChild(h("div", { class: "tgh-muted", style: "padding:24px; text-align:center;" }, "No enemy faction set. It auto-detects during a ranked war, or set it manually in Settings."));
            return;
          }
          if (state.loading && state.enemies.length === 0) {
            host.appendChild(h("div", { class: "tgh-muted", style: "padding:24px; text-align:center;" }, "Loading targets…"));
            return;
          }

          const rows = filteredSorted();
          const table = h("table", {});
          const arrow = (col) => (state.sortCol === col ? (state.sortDir === "asc" ? " ▲" : " ▼") : "");
          const sortableTh = (label, col) => {
            const th = h("th", { class: "tgh-sortable" }, label + arrow(col));
            th.addEventListener("click", () => requestSort(col));
            return th;
          };
          table.appendChild(
            h("thead", {}, h("tr", {}, [
              sortableTh("Target", "name"),
              sortableTh("Lvl", "level"),
              sortableTh("Status / Loc", "until"),
              sortableTh("FF", "ff"),
              sortableTh("Est. Stats", "bs"),
              sortableTh("Last Action", "last_active"),
              h("th", {}, "Queue / Claim"),
            ]))
          );
          const tbody = h("tbody", {});
          const u = me();
          rows.forEach((e) => {
            const isMyClaim = e.targetClaims.some((c) => numId(c.claimer_torn_id) === u.id && u.id !== 0);
            const statusColor = e.status.state === "Okay" ? "var(--tgh-okay)" : e.status.state === "Hospital" ? "var(--tgh-hospital)" : "var(--tgh-traveling)";
            const isOnline = e.last_action.status === "Online";
            const claimsCell = h("div", {});
            if (state.claimsError) {
              claimsCell.appendChild(h("div", { style: "font-size:9px; color:var(--tgh-hospital);" }, "unknown"));
            } else if (e.targetClaims.length) {
              e.targetClaims.forEach((c, i) => claimsCell.appendChild(h("div", { class: "tgh-muted", style: "font-size:9px;" }, `#${i + 1} ${c.claimer_name || "?"}`)));
            } else {
              claimsCell.appendChild(h("div", { class: "tgh-muted", style: "font-size:9px;" }, "No active claims"));
            }
            const actionBtn = isMyClaim
              ? h("button", { class: "tgh-danger", onclick: () => releaseTarget(e.id) }, "Release")
              : h("button", { class: "tgh-primary", onclick: () => claimTarget(e.id, e.name) }, e.targetClaims.length ? `Queue #${e.targetClaims.length + 1}` : "Claim");
            tbody.appendChild(
              h("tr", {}, [
                h("td", {}, h("a", { class: "tgh-link", href: `https://www.torn.com/profiles.php?XID=${e.id}`, target: "_blank", rel: "noopener noreferrer" }, `${e.name} [${e.id}]`)),
                h("td", {}, String(e.level)),
                h("td", {}, [
                  h("div", { style: `color:${statusColor}; font-weight:700;` }, `${e.status.state}${hospTime(e.status.until) ? " (" + hospTime(e.status.until) + ")" : ""}`),
                  h("div", { class: "tgh-muted", style: "font-size:9px;" }, e.status.description || ""),
                ]),
                h("td", {}, e.stats.fair_fight === null ? "—" : e.stats.fair_fight.toFixed(2)),
                h("td", {}, fmtBs(e.stats.bs_estimate)),
                h("td", { style: isOnline ? "color:var(--tgh-okay);" : "" }, e.last_action.status === "Offline" ? relTime(e.last_action.timestamp) : e.last_action.status),
                h("td", {}, [claimsCell, actionBtn]),
              ])
            );
          });
          table.appendChild(tbody);
          host.appendChild(table);
          if (rows.length === 0) host.appendChild(h("div", { class: "tgh-muted", style: "padding:16px; text-align:center;" }, "No targets match the current filters."));
        });
      }

      let pendingRefresh = false;
      function refresh() {
        // Defer a background refresh while the user is mid-edit in the toolbar,
        // then apply it as soon as they click away.
        if (isEditing(container)) {
          pendingRefresh = true;
          return;
        }
        pendingRefresh = false;
        refreshBanner();
        refreshTable();
      }
      const onFocusOut = () => {
        if (!pendingRefresh) return;
        setTimeout(() => {
          if (!destroyed && pendingRefresh && !isEditing(container)) refresh();
        }, 0);
      };
      container.addEventListener("focusout", onFocusOut);

      function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(fetchData, state.pollMs);
      }

      refreshBanner();
      refreshTable();
      fetchData();
      fetchClaims();
      startPolling();
      claimsTimer = setInterval(fetchClaims, 5000);
      const onWar = () => fetchData();
      window.addEventListener("tgh:war-changed", onWar);

      return () => {
        destroyed = true;
        clearInterval(pollTimer);
        clearInterval(claimsTimer);
        container.removeEventListener("focusout", onFocusOut);
        window.removeEventListener("tgh:war-changed", onWar);
      };
    },
  };

  /* =====================================================================
   * MODULE: STRIKE TEAMS
   * ===================================================================*/
  const StrikeTeamsModule = {
    id: "striketeams",
    title: "Strike Teams",
    subtitle: "Squads, readiness & ordered targets",
    icon: "🛡",
    mount(container) {
      let teams = [], loading = true, loadError = "", selectedTeamId = null, pollTimer = null, destroyed = false;
      let creating = false, createDraft = { name: "", description: "" };
      const STATUS_OPTIONS = ["planning", "recruiting", "ready", "countdown", "in_progress", "completed", "cancelled"];
      const STATUS_COLOR = { planning: "var(--tgh-traveling)", recruiting: "var(--tgh-idle)", ready: "var(--tgh-okay)", countdown: "var(--tgh-jail)", in_progress: "var(--tgh-hospital)", completed: "var(--tgh-muted)", cancelled: "var(--tgh-fallen)" };

      const banner = h("div", {});
      const scroll = h("div", { class: "tgh-scroll" });
      container.appendChild(banner);
      container.appendChild(scroll);

      function fail(e, what) {
        console.warn("[TheGreenHouse:StrikeTeams] " + what, e);
        alert("Couldn't " + what + ":\n" + (e && e.message ? e.message : String(e)));
      }

      async function fetchTeams() {
        if (!settings.isSupabaseConfigured()) {
          loading = false;
          if (!destroyed) refresh();
          return;
        }
        try {
          const [teamsData, membersData, targetsData] = await Promise.all([
            supa.select("strike_teams", { order: "created_at.desc" }),
            supa.select("strike_team_members", { order: "position.asc" }),
            supa.select("strike_team_targets", { order: "order_position.asc" }),
          ]);
          teams = (teamsData || []).map((t) => ({
            ...t,
            status: t.status || "planning",
            members: (membersData || []).filter((m) => m.team_id === t.id),
            targets: (targetsData || []).filter((tg) => tg.team_id === t.id),
          }));
          loadError = "";
        } catch (e) {
          // An unreachable DB must not render as "no strike teams".
          loadError = e.message;
          console.warn("[TheGreenHouse:StrikeTeams] fetch failed", e.message);
        } finally {
          loading = false;
          if (!destroyed) refresh();
        }
      }

      async function addTeam(team) {
        const row = await supa.insert(
          "strike_teams",
          {
            name: team.name,
            leader_id: team.leader_id,
            leader_name: team.leader_name,
            description: team.description || null,
            status: "planning",
            start_time: null,
            notes: null,
          },
          { returning: true }
        );
        await supa.insert(
          "strike_team_members",
          { team_id: row.id, member_id: team.leader_id, member_name: team.leader_name, role: "leader", ready_status: "ready", invite_status: "accepted", position: 0 }
        );
        await fetchTeams();
      }
      async function updateTeam(id, patch) {
        await supa.update("strike_teams", { ...patch, updated_at: new Date().toISOString() }, [["id", "eq", id]]);
        await fetchTeams();
      }
      async function deleteTeam(id) {
        await supa.delete("strike_teams", [["id", "eq", id]]);
        await fetchTeams();
      }
      async function addMember(teamId, memberId, memberName) {
        const team = teams.find((t) => t.id === teamId);
        await supa.insert("strike_team_members", { team_id: teamId, member_id: String(memberId), member_name: memberName, role: "member", ready_status: "not_ready", invite_status: "pending", position: team ? team.members.length : 0 });
        await fetchTeams();
      }
      async function setMemberReady(rowId, status) {
        await supa.update("strike_team_members", { ready_status: status }, [["id", "eq", rowId]]);
        await fetchTeams();
      }
      async function removeMember(rowId) {
        await supa.delete("strike_team_members", [["id", "eq", rowId]]);
        await fetchTeams();
      }
      async function addTarget(teamId, targetId, targetName, targetLevel) {
        const team = teams.find((t) => t.id === teamId);
        const lvl = parseInt(targetLevel, 10);
        await supa.insert("strike_team_targets", { team_id: teamId, target_id: String(targetId), target_name: targetName, target_level: Number.isFinite(lvl) ? lvl : null, order_position: team ? team.targets.length : 0, completed: false });
        await fetchTeams();
      }
      async function toggleTargetDone(rowId, completed) {
        await supa.update("strike_team_targets", { completed }, [["id", "eq", rowId]]);
        await fetchTeams();
      }
      async function removeTarget(rowId) {
        await supa.delete("strike_team_targets", [["id", "eq", rowId]]);
        await fetchTeams();
      }
      async function moveTarget(team, rowId, delta) {
        const ordered = [...team.targets].sort((a, b) => a.order_position - b.order_position);
        const idx = ordered.findIndex((t) => t.id === rowId);
        const swapIdx = idx + delta;
        if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;
        const a = ordered[idx], b = ordered[swapIdx];
        await supa.update("strike_team_targets", { order_position: swapIdx }, [["id", "eq", a.id]]);
        await supa.update("strike_team_targets", { order_position: idx }, [["id", "eq", b.id]]);
        await fetchTeams();
      }

      function renderBanner() {
        banner.innerHTML = "";
        if (!settings.isSupabaseConfigured()) {
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "Supabase not configured — Strike Teams needs the shared database. Open Settings."));
        } else if (loadError) {
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "Couldn't load strike teams: " + loadError));
        }
      }

      function renderList() {
        swapPreservingScroll(scroll, (host) => {
          const wrap = h("div", { class: "tgh-pad" });
          const header = h("div", { class: "tgh-row", style: "justify-content:space-between;" }, [
            h("div", {}, [h("div", { style: "font-weight:700; font-size:14px;" }, "Strike Teams"), h("div", { class: "tgh-muted" }, "Coordinate tactical assaults during ranked wars.")]),
          ]);
          header.appendChild(
            h("button", {
              class: "tgh-primary",
              onclick: () => {
                creating = true;
                renderList();
              },
            }, "+ New Strike Team")
          );
          wrap.appendChild(header);

          if (creating) {
            const nameInput = h("input", { placeholder: "Mission name, e.g. Operation Bravo" });
            nameInput.value = createDraft.name;
            nameInput.addEventListener("input", (e) => (createDraft.name = e.target.value));
            const descInput = h("input", { placeholder: "Description (optional)" });
            descInput.value = createDraft.description;
            descInput.addEventListener("input", (e) => (createDraft.description = e.target.value));
            wrap.appendChild(
              h("div", { style: "border:1px solid var(--tgh-border); border-radius:6px; padding:10px; background:var(--tgh-surface); display:flex; flex-direction:column; gap:8px;" }, [
                h("div", { class: "tgh-field" }, [h("label", {}, "Mission Name"), nameInput]),
                h("div", { class: "tgh-field" }, [h("label", {}, "Description"), descInput]),
                h("div", { class: "tgh-row", style: "justify-content:flex-end;" }, [
                  h("button", {
                    onclick: () => {
                      creating = false;
                      createDraft = { name: "", description: "" };
                      renderList();
                    },
                  }, "Cancel"),
                  h("button", {
                    class: "tgh-primary",
                    onclick: async () => {
                      const name = createDraft.name.trim();
                      if (!name) return alert("Give the mission a name first.");
                      const uid = cleanId(settings.get("userId"));
                      if (!uid) return alert("Your Torn ID isn't set yet. Open Settings — it fills in from your API key.");
                      try {
                        await addTeam({ name, description: createDraft.description.trim(), leader_id: uid, leader_name: settings.get("username") || "Unknown Leader" });
                        creating = false;
                        createDraft = { name: "", description: "" };
                      } catch (e) {
                        fail(e, "create the strike team");
                      }
                    },
                  }, "Create"),
                ]),
              ])
            );
          }

          const grid = h("div", { style: "display:flex; flex-direction:column; gap:8px;" });
          if (teams.length === 0 && !loadError) {
            grid.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; padding:24px; border:1px dashed var(--tgh-border); border-radius:6px;" }, loading ? "Loading strike teams…" : "No active strike teams. Create one to start coordinating attacks."));
          }
          teams.forEach((team) => {
            const readyCount = (team.members || []).filter((m) => m.ready_status === "ready").length;
            const currentTarget = (team.targets || []).find((t) => !t.completed);
            const card = h("div", { style: "border:1px solid var(--tgh-border); border-radius:6px; padding:10px; background:var(--tgh-surface); cursor:pointer;" });
            card.addEventListener("click", () => {
              selectedTeamId = team.id;
              refresh();
            });
            card.appendChild(
              h("div", { class: "tgh-row", style: "justify-content:space-between;" }, [
                h("span", { style: "font-weight:700;" }, team.name || "(unnamed)"),
                h("span", { class: "tgh-badge", style: `border:1px solid ${STATUS_COLOR[team.status] || "var(--tgh-border)"}; color:${STATUS_COLOR[team.status] || "var(--tgh-muted)"};` }, String(team.status).replace(/_/g, " ")),
              ])
            );
            if (team.description) card.appendChild(h("div", { class: "tgh-muted", style: "margin:4px 0;" }, team.description));
            card.appendChild(
              h("div", { class: "tgh-row", style: "font-size:10px; color:var(--tgh-muted); margin-top:6px;" }, [
                h("span", {}, `${(team.members || []).length} members`),
                h("span", { style: "color:var(--tgh-okay);" }, `${readyCount} ready`),
                h("span", {}, currentTarget ? `Target: ${currentTarget.target_name}` : ((team.targets || []).length ? "All targets clear" : "No targets")),
                h("span", {}, `Leader: ${team.leader_name || "?"}`),
              ])
            );
            grid.appendChild(card);
          });
          wrap.appendChild(grid);
          host.appendChild(wrap);
        });
      }

      function renderDetail() {
        const team = teams.find((t) => t.id === selectedTeamId);
        if (!team) {
          selectedTeamId = null;
          renderList();
          return;
        }
        swapPreservingScroll(scroll, (host) => {
          const wrap = h("div", { class: "tgh-pad" });
          wrap.appendChild(
            h("div", { class: "tgh-row", style: "justify-content:space-between;" }, [
              h("button", {
                onclick: () => {
                  selectedTeamId = null;
                  refresh();
                },
              }, "← Back"),
              h("button", {
                class: "tgh-danger",
                onclick: async () => {
                  if (!confirm("Delete this strike team?")) return;
                  try {
                    await deleteTeam(team.id);
                    selectedTeamId = null;
                  } catch (e) {
                    fail(e, "delete the strike team");
                  }
                },
              }, "Delete Team"),
            ])
          );
          wrap.appendChild(h("div", { style: "font-weight:700; font-size:14px;" }, team.name || "(unnamed)"));
          if (team.description) wrap.appendChild(h("div", { class: "tgh-muted" }, team.description));

          const statusSel = h("select", {}, STATUS_OPTIONS.map((o) => h("option", { value: o }, o.replace(/_/g, " "))));
          statusSel.value = STATUS_OPTIONS.includes(team.status) ? team.status : "planning";
          statusSel.addEventListener("change", (e) => updateTeam(team.id, { status: e.target.value }).catch((err) => fail(err, "update the status")));
          wrap.appendChild(h("div", { class: "tgh-row" }, [h("span", { class: "tgh-muted" }, "Status:"), statusSel]));

          /* members */
          wrap.appendChild(h("div", { style: "font-weight:700; margin-top:6px;" }, `Members (${(team.members || []).length})`));
          const memberIdInput = h("input", { placeholder: "Torn ID", style: "width:80px;" });
          const memberNameInput = h("input", { placeholder: "Name", style: "width:110px;" });
          wrap.appendChild(
            h("div", { class: "tgh-row" }, [
              memberIdInput,
              memberNameInput,
              h("button", {
                class: "tgh-primary",
                onclick: async () => {
                  const id = cleanId(memberIdInput.value);
                  const name = memberNameInput.value.trim();
                  if (!id || !name) return alert("Enter both a Torn ID and a name.");
                  try {
                    await addMember(team.id, id, name);
                  } catch (e) {
                    fail(e, "add the member");
                  }
                },
              }, "+ Add"),
            ])
          );
          const memberTable = h("table", {});
          memberTable.appendChild(h("thead", {}, h("tr", {}, [h("th", {}, "Name"), h("th", {}, "Role"), h("th", {}, "Ready"), h("th", {}, "")])));
          const mtbody = h("tbody", {});
          (team.members || []).forEach((m) => {
            const readySel = h("select", {}, ["ready", "not_ready", "unavailable"].map((o) => h("option", { value: o }, o.replace(/_/g, " "))));
            readySel.value = ["ready", "not_ready", "unavailable"].includes(m.ready_status) ? m.ready_status : "not_ready";
            readySel.addEventListener("change", (e) => setMemberReady(m.id, e.target.value).catch((err) => fail(err, "update ready status")));
            mtbody.appendChild(
              h("tr", {}, [
                h("td", {}, h("a", { class: "tgh-link", href: `https://www.torn.com/profiles.php?XID=${cleanId(m.member_id)}`, target: "_blank", rel: "noopener noreferrer" }, m.member_name || "?")),
                h("td", { class: "tgh-muted" }, m.role || "member"),
                h("td", {}, readySel),
                h("td", {}, m.role === "leader" ? "" : h("button", { class: "tgh-danger", onclick: () => removeMember(m.id).catch((err) => fail(err, "remove the member")) }, "Remove")),
              ])
            );
          });
          memberTable.appendChild(mtbody);
          wrap.appendChild(memberTable);

          /* targets */
          wrap.appendChild(h("div", { style: "font-weight:700; margin-top:10px;" }, `Targets (${(team.targets || []).length})`));
          const targetIdInput = h("input", { placeholder: "Torn ID", style: "width:80px;" });
          const targetNameInput = h("input", { placeholder: "Name", style: "width:110px;" });
          const targetLevelInput = h("input", { placeholder: "Lvl", type: "number", style: "width:52px;" });
          wrap.appendChild(
            h("div", { class: "tgh-row" }, [
              targetIdInput,
              targetNameInput,
              targetLevelInput,
              h("button", {
                class: "tgh-primary",
                onclick: async () => {
                  const id = cleanId(targetIdInput.value);
                  const name = targetNameInput.value.trim();
                  if (!id || !name) return alert("Enter both a Torn ID and a name.");
                  try {
                    await addTarget(team.id, id, name, targetLevelInput.value);
                  } catch (e) {
                    fail(e, "add the target");
                  }
                },
              }, "+ Add"),
            ])
          );
          const targetTable = h("table", {});
          targetTable.appendChild(h("thead", {}, h("tr", {}, [h("th", {}, "#"), h("th", {}, "Target"), h("th", {}, "Lvl"), h("th", {}, "Done"), h("th", {}, "Order"), h("th", {}, "")])));
          const ttbody = h("tbody", {});
          const orderedTargets = [...(team.targets || [])].sort((a, b) => a.order_position - b.order_position);
          orderedTargets.forEach((t, i) => {
            const doneCheckbox = h("input", { type: "checkbox" });
            doneCheckbox.checked = !!t.completed;
            doneCheckbox.addEventListener("change", (e) => {
              const want = e.target.checked;
              toggleTargetDone(t.id, want).catch((err) => {
                e.target.checked = !want; // don't leave the UI lying about the DB
                fail(err, "update the target");
              });
            });
            ttbody.appendChild(
              h("tr", { style: t.completed ? "opacity:0.5;" : "" }, [
                h("td", {}, String(i + 1)),
                h("td", {}, h("a", { class: "tgh-link", href: `https://www.torn.com/profiles.php?XID=${cleanId(t.target_id)}`, target: "_blank", rel: "noopener noreferrer" }, t.target_name || "?")),
                h("td", { class: "tgh-muted" }, t.target_level ? String(t.target_level) : "—"),
                h("td", {}, doneCheckbox),
                h("td", {}, [
                  h("button", { onclick: () => moveTarget(team, t.id, -1).catch((err) => fail(err, "reorder targets")), style: "padding:2px 5px;" }, "↑"),
                  h("button", { onclick: () => moveTarget(team, t.id, 1).catch((err) => fail(err, "reorder targets")), style: "padding:2px 5px;" }, "↓"),
                ]),
                h("td", {}, h("button", { class: "tgh-danger", onclick: () => removeTarget(t.id).catch((err) => fail(err, "remove the target")) }, "Remove")),
              ])
            );
          });
          targetTable.appendChild(ttbody);
          wrap.appendChild(targetTable);
          host.appendChild(wrap);
        });
      }

      let pendingRefresh = false;
      function refresh() {
        // A background poll must never wipe a form the user is filling in;
        // the update lands as soon as they click away instead.
        if (isEditing(container)) {
          pendingRefresh = true;
          return;
        }
        pendingRefresh = false;
        renderBanner();
        if (selectedTeamId) renderDetail();
        else renderList();
      }
      const onFocusOut = () => {
        if (!pendingRefresh) return;
        setTimeout(() => {
          if (!destroyed && pendingRefresh && !isEditing(container)) refresh();
        }, 0);
      };
      container.addEventListener("focusout", onFocusOut);

      refresh();
      fetchTeams();
      pollTimer = setInterval(fetchTeams, 10000);
      return () => {
        destroyed = true;
        clearInterval(pollTimer);
        container.removeEventListener("focusout", onFocusOut);
      };
    },
  };

  /* =====================================================================
   * MODULE: CHAIN MANAGER
   * ===================================================================*/
  const BONUS_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const ChainManagerModule = {
    id: "chainmanager",
    title: "Chain Manager",
    subtitle: "Countdown, bonuses & availability",
    icon: "⛓",
    mount(container) {
      let chain = null, members = null, error = null, dataTimer = null, tickTimer = null, lastFetch = 0, destroyed = false;

      const banner = h("div", {});
      const scroll = h("div", { class: "tgh-scroll" });
      const pad = h("div", { class: "tgh-pad" });
      const hero = h("div", { style: "text-align:center; border:1px solid var(--tgh-border); border-radius:8px; padding:20px; background:var(--tgh-surface);" });
      const milestoneHost = h("div", {});
      const membersHost = h("div", {});
      pad.appendChild(hero);
      pad.appendChild(milestoneHost);
      pad.appendChild(membersHost);
      scroll.appendChild(pad);
      container.appendChild(banner);
      container.appendChild(scroll);

      function getAvailability(m) {
        const st = (m && m.status) || {};
        const la = (m && m.last_action) || {};
        if (st.state === "Hospital") return "Hospital";
        if (st.state === "Traveling" || st.state === "Abroad") return "Traveling";
        if (["Jail", "Federal", "Fallen"].includes(st.state)) return "Unavailable";
        const ts = Number(la.timestamp || 0);
        if (!ts) return "Offline";
        const minsAgo = Math.floor((Date.now() / 1000 - ts) / 60);
        if (minsAgo <= 30) return "Ready";
        if (minsAgo <= 120) return "Idle";
        return "Offline";
      }

      async function fetchData() {
        if (Date.now() - lastFetch < 25000) return;
        lastFetch = Date.now();
        if (!settings.isTornConfigured()) {
          if (!destroyed) renderAll();
          return;
        }
        try {
          const data = await fetchTorn("v2/faction/?selections=chain,members");
          if (data && data.chain && typeof data.chain === "object") {
            const nowSec = Math.floor(Date.now() / 1000);
            const c = data.chain;
            chain = {
              current: Number(c.current || 0),
              max: Number(c.max || 0),
              modifier: Number(c.modifier || 1),
              start: Number(c.start || 0),
              timeout: Number(c.timeout || 0) > 0 ? nowSec + Number(c.timeout) : 0,
              cooldown: Number(c.cooldown || 0) > 0 ? nowSec + Number(c.cooldown) : 0,
            };
          } else chain = null;
          if (data && data.members) members = Array.isArray(data.members) ? data.members : Object.values(data.members);
          error = null;
        } catch (e) {
          error = e.message;
          console.warn("[TheGreenHouse:ChainManager]", e.message);
        }
        if (!destroyed) renderAll();
      }

      function renderBanner() {
        banner.innerHTML = "";
        if (!settings.isTornConfigured()) {
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "No Torn API key set. Open the Settings tab."));
        } else if (error) {
          // Shown even when cached data exists, so nobody trusts a stale countdown.
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "Torn API: " + error + (chain ? " — showing last known data." : "")));
        }
      }

      // Ticks every second, but only rewrites the hero text — never the
      // member table, so its scroll position and text selection survive.
      function renderHero() {
        hero.innerHTML = "";
        if (!settings.isTornConfigured()) {
          hero.appendChild(h("div", { class: "tgh-muted" }, "Add your Torn API key in Settings to track the chain."));
          return;
        }
        if (!chain || chain.current === 0) {
          hero.appendChild(h("div", { class: "tgh-muted" }, error ? "Chain data unavailable." : "No active chain. Start one in Torn to begin tracking."));
          return;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const isCooldown = chain.cooldown > 0;
        const secondsRemaining = Math.max(0, (isCooldown ? chain.cooldown : chain.timeout) - nowSec);
        const isCritical = !isCooldown && secondsRemaining < 60;
        const color = isCooldown ? "var(--tgh-traveling)" : isCritical ? "var(--tgh-hospital)" : "var(--tgh-okay)";
        hero.appendChild(h("div", { style: "font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:" + color + "; margin-bottom:8px;" }, isCooldown ? "CHAIN COOLING DOWN" : "CHAIN ACTIVE"));
        hero.appendChild(h("div", { style: "font-size:32px; font-weight:700;" }, `${chain.current.toLocaleString()} ${isCooldown ? "hits completed" : "hits"}`));
        hero.appendChild(h("div", { style: `font-size:26px; font-weight:700; color:${color}; margin-top:6px;` }, (isCooldown ? "Cooldown ends in " : "") + fmtDuration(secondsRemaining) + (isCooldown ? "" : " remaining")));
        if (!isCooldown) hero.appendChild(h("div", { class: "tgh-muted", style: "margin-top:6px; font-size:10px;" }, `Modifier ×${chain.modifier} · Started ${relTime(chain.start)}`));
      }

      function renderMilestones() {
        milestoneHost.innerHTML = "";
        if (!chain || chain.current === 0 || chain.cooldown > 0) return;
        const nextIdx = BONUS_MILESTONES.findIndex((m) => m > chain.current);
        if (nextIdx === -1) return;
        const slice = BONUS_MILESTONES.slice(Math.max(0, nextIdx - 2), nextIdx + 3);
        const row = h("div", { class: "tgh-row", style: "justify-content:center; border:1px solid var(--tgh-border); border-radius:8px; padding:10px; background:var(--tgh-surface);" });
        slice.forEach((ms) => {
          const done = ms <= chain.current;
          const isNext = ms === BONUS_MILESTONES[nextIdx];
          row.appendChild(
            h("div", {
              class: "tgh-badge",
              style: done ? "border:1px solid var(--tgh-border); color:var(--tgh-muted);" : isNext ? "border:1px solid var(--tgh-accent); color:var(--tgh-accent);" : "border:1px solid var(--tgh-border); color:var(--tgh-muted); opacity:0.5;",
            }, (done ? "✓ " : isNext ? "► " : "") + ms.toLocaleString())
          );
        });
        milestoneHost.appendChild(row);
        milestoneHost.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; font-size:10px; margin-top:6px;" }, `Next bonus in ${BONUS_MILESTONES[nextIdx] - chain.current} hits`));
      }

      function renderMembers() {
        membersHost.innerHTML = "";
        if (!members || !chain || chain.current === 0) return;
        let sorted;
        try {
          sorted = [...members].sort((a, b) => {
            const order = { Ready: 1, Idle: 2, Offline: 3, Hospital: 4, Traveling: 5, Unavailable: 6 };
            const av = getAvailability(a), bv = getAvailability(b);
            if (order[av] !== order[bv]) return order[av] - order[bv];
            return Number((b.last_action || {}).timestamp || 0) - Number((a.last_action || {}).timestamp || 0);
          });
        } catch (e) {
          console.warn("[TheGreenHouse:ChainManager] member sort failed", e);
          membersHost.appendChild(h("div", { class: "tgh-muted" }, "Member list unavailable."));
          return;
        }
        const counts = sorted.reduce((acc, m) => {
          const a = getAvailability(m);
          acc[a] = (acc[a] || 0) + 1;
          return acc;
        }, {});
        const summary = h("div", { class: "tgh-row", style: "font-size:10px; margin-bottom:6px;" });
        ["Ready", "Idle", "Offline", "Hospital", "Traveling", "Unavailable"].forEach((k) => summary.appendChild(h("span", { class: "tgh-muted" }, `${counts[k] || 0} ${k.toLowerCase()}`)));
        membersHost.appendChild(summary);

        const nowSec = Math.floor(Date.now() / 1000);
        const table = h("table", {});
        table.appendChild(h("thead", {}, h("tr", {}, [h("th", {}, "Name"), h("th", {}, "Availability"), h("th", {}, "Last Action"), h("th", {}, "Status")])));
        const tbody = h("tbody", {});
        sorted.forEach((m) => {
          const st = m.status || {};
          const la = m.last_action || {};
          const avail = getAvailability(m);
          const colorMap = { Ready: "var(--tgh-okay)", Idle: "var(--tgh-idle)", Hospital: "var(--tgh-hospital)", Traveling: "var(--tgh-traveling)" };
          let availText = avail;
          if (avail === "Hospital" && st.until) availText = `Hosp ${Math.ceil(Math.max(0, Number(st.until) - nowSec) / 60)}m`;
          tbody.appendChild(
            h("tr", {}, [
              h("td", {}, h("a", { class: "tgh-link", href: `https://www.torn.com/profiles.php?XID=${numId(m.id)}`, target: "_blank", rel: "noopener noreferrer" }, m.name || "?")),
              h("td", { style: colorMap[avail] ? `color:${colorMap[avail]};` : "" }, availText),
              h("td", { class: "tgh-muted" }, relTime(Number(la.timestamp || 0))),
              h("td", { class: "tgh-muted" }, st.description || ""),
            ])
          );
        });
        table.appendChild(tbody);
        membersHost.appendChild(table);
      }

      function renderAll() {
        renderBanner();
        renderHero();
        renderMilestones();
        renderMembers();
      }

      renderAll();
      fetchData();
      dataTimer = setInterval(fetchData, 30000);
      tickTimer = setInterval(() => {
        try {
          renderHero();
        } catch (e) {
          console.warn("[TheGreenHouse:ChainManager] tick failed", e);
        }
      }, 1000);
      return () => {
        destroyed = true;
        clearInterval(dataTimer);
        clearInterval(tickTimer);
      };
    },
  };

  /* =====================================================================
   * MODULE: AIR TRAFFIC CONTROL
   * ===================================================================*/
  const COUNTRIES = ["Mexico", "Canada", "Cayman Islands", "Hawaii", "United Kingdom", "Switzerland", "Argentina", "Japan", "China", "UAE", "South Africa"];
  const FLIGHT_TIMES = { Mexico: 20, Canada: 37, "Cayman Islands": 57, Hawaii: 121, "United Kingdom": 152, Switzerland: 169, Argentina: 189, Japan: 203, China: 219, UAE: 259, "South Africa": 311 };
  const FLAGS = { Mexico: "🇲🇽", Canada: "🇨🇦", "Cayman Islands": "🌴", Hawaii: "🌺", "United Kingdom": "🇬🇧", Switzerland: "🇨🇭", Argentina: "🇦🇷", Japan: "🇯🇵", China: "🇨🇳", UAE: "🇦🇪", "South Africa": "🇿🇦" };
  const HOSPITAL_TO_COUNTRY = { mexican: "Mexico", canadian: "Canada", caymanian: "Cayman Islands", hawaiian: "Hawaii", british: "United Kingdom", swiss: "Switzerland", argentinian: "Argentina", japanese: "Japan", chinese: "China", emirati: "UAE", "south african": "South Africa" };
  const STANDARD_COUNTRY_NAMES = { mexico: "Mexico", canada: "Canada", "cayman islands": "Cayman Islands", cayman: "Cayman Islands", hawaii: "Hawaii", "united kingdom": "United Kingdom", uk: "United Kingdom", switzerland: "Switzerland", argentina: "Argentina", japan: "Japan", china: "China", "united arab emirates": "UAE", uae: "UAE", "south africa": "South Africa" };
  const COUNTRY_REGEXES = Object.entries(STANDARD_COUNTRY_NAMES).map(([key, val]) => ({ regex: new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), val }));
  function extractCountry(text) {
    if (!text) return null;
    for (const item of COUNTRY_REGEXES) if (item.regex.test(text)) return item.val;
    return null;
  }

  const AtcModule = {
    id: "atc",
    title: "Air Traffic Control",
    subtitle: "Live overseas intelligence",
    icon: "✈",
    mount(container) {
      let players = [], loading = false, apiError = "", filter = "Show All", timer = null, destroyed = false, hasFetched = false;
      const expanded = {};

      const banner = h("div", {});
      const header = h("div", { style: "padding:8px 10px; border-bottom:1px solid var(--tgh-border); background:var(--tgh-surface);" });
      const filterRow = h("div", { class: "tgh-row", style: "padding:8px 10px; border-bottom:1px solid var(--tgh-border);" });
      const grid = h("div", { class: "tgh-scroll", style: "padding:10px; display:flex; flex-direction:column; gap:8px;" });
      const footer = h("div", { class: "tgh-row", style: "padding:6px 10px; border-top:1px solid var(--tgh-border); font-size:10px;" });
      container.appendChild(banner);
      container.appendChild(header);
      container.appendChild(filterRow);
      container.appendChild(grid);
      container.appendChild(footer);

      ["Show All", "Safe Countries", "Enemy Present", "Active Conflicts", "Allied Only", "Enemy Inbound"].forEach((opt) => {
        const btn = h("button", {
          onclick: () => {
            filter = opt;
            renderAll();
          },
        }, opt);
        btn.dataset.filterOpt = opt;
        filterRow.appendChild(btn);
      });

      function classify(member, faction) {
        const st = (member && member.status) || {};
        const la = (member && member.last_action) || {};
        const state = st.state || "Okay";
        const details = String(st.details || "").toLowerCase();
        const descLower = String(st.description || "").toLowerCase() + " " + details;
        const base = { id: numId(member.id), name: member.name || "?", faction, status: { state, description: st.description || "", color: st.color || "", until: Number(st.until || 0) }, last_action: { status: la.status || "Offline", timestamp: Number(la.timestamp || 0), relative: la.relative || "" } };

        if (state === "Hospital") {
          const match = descLower.match(/in a (.+?) hospital/);
          if (match) {
            const country = HOSPITAL_TO_COUNTRY[match[1].trim()];
            if (country) return Object.assign(base, { country, bucket: "Hospital" });
          }
        }
        if (state === "Traveling") {
          if (/\b(to torn|returning to torn)\b/.test(descLower)) return Object.assign(base, { country: null, bucket: "In Torn" });
          const country = extractCountry(descLower);
          if (country) return Object.assign(base, { country, bucket: "Inbound" });
        }
        if (state === "Okay" || state === "Abroad") {
          const country = COUNTRIES.find((c) => descLower.includes(c.toLowerCase()));
          if (country && !descLower.includes("torn")) return Object.assign(base, { country, bucket: "Landed" });
        }
        return Object.assign(base, { country: null, bucket: "In Torn" });
      }

      async function fetchData() {
        // Always render, even on the guard paths — otherwise this pane is a
        // blank white box with no explanation.
        if (!settings.isTornConfigured()) {
          if (!destroyed) renderAll();
          return;
        }
        loading = true;
        apiError = "";
        if (!destroyed) renderAll();
        try {
          const enemyFactionId = cleanId(settings.get("enemyFactionId"));
          const [alliedData, enemyData] = await Promise.all([
            fetchTorn("faction?selections=basic"),
            enemyFactionId ? fetchTorn(`faction/${encodeURIComponent(enemyFactionId)}?selections=basic`) : Promise.resolve(null),
          ]);
          const newPlayers = [];
          const pushMembers = (data, faction) => {
            if (!data || !data.members) return;
            Object.entries(data.members).forEach(([key, item]) => {
              const id = numId(item.id || item.player_id || key);
              newPlayers.push(classify({ id, name: item.name, status: item.status, last_action: item.last_action }, faction));
            });
          };
          pushMembers(alliedData, "Allied");
          pushMembers(enemyData, "Enemy");
          players = newPlayers;
          hasFetched = true;
        } catch (e) {
          apiError = e.message || "Failed to fetch ATC data";
        } finally {
          loading = false;
          if (!destroyed) renderAll();
        }
      }

      function countryStats() {
        const stats = {};
        COUNTRIES.forEach((c) => (stats[c] = { alliedLanded: 0, alliedInbound: 0, alliedHospital: 0, enemyLanded: 0, enemyInbound: 0, enemyHospital: 0, players: [] }));
        players.forEach((p) => {
          if (p.country && stats[p.country]) {
            stats[p.country].players.push(p);
            const prefix = p.faction === "Allied" ? "allied" : "enemy";
            if (p.bucket === "Landed") stats[p.country][prefix + "Landed"]++;
            else if (p.bucket === "Inbound") stats[p.country][prefix + "Inbound"]++;
            else if (p.bucket === "Hospital") stats[p.country][prefix + "Hospital"]++;
          }
        });
        return stats;
      }
      function statusInfo(s) {
        if (s.enemyLanded > 0 && s.alliedLanded > 0) return { label: "Active Conflict", color: "var(--tgh-hospital)", priority: 1 };
        if (s.enemyLanded > 0) return { label: "Enemy Present", color: "var(--tgh-hospital)", priority: 2 };
        if (s.enemyInbound > 0) return { label: "Enemy Inbound", color: "var(--tgh-jail)", priority: 3 };
        if (s.alliedLanded > 0 || s.alliedInbound > 0 || s.alliedHospital > 0) return { label: "Allied Only", color: "var(--tgh-okay)", priority: 4 };
        return { label: "No Activity", color: "var(--tgh-muted)", priority: 5 };
      }

      function renderAll() {
        /* banner */
        banner.innerHTML = "";
        if (!settings.isTornConfigured()) {
          banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "No Torn API key set. Open the Settings tab."));
        } else {
          if (apiError) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "Torn API: " + apiError));
          if (!cleanId(settings.get("enemyFactionId"))) banner.appendChild(h("div", { class: "tgh-banner tgh-banner-warn" }, "No enemy faction set — showing your faction only. It auto-detects during a ranked war."));
        }

        const stats = countryStats();
        const active = COUNTRIES.filter((c) => stats[c].players.length > 0);
        const safe = COUNTRIES.filter((c) => stats[c].enemyLanded === 0 && stats[c].enemyInbound === 0);

        /* safe havens — only meaningful once we actually have roster data,
           otherwise every country would be listed as "safe" on no evidence */
        header.innerHTML = "";
        if (!hasFetched) {
          header.appendChild(h("div", { class: "tgh-row", style: "font-size:9px; text-transform:uppercase; color:var(--tgh-muted);" }, [h("span", {}, "Safe havens: no data yet")]));
        } else {
          header.appendChild(
            h("div", { class: "tgh-row", style: "font-size:9px; text-transform:uppercase; color:var(--tgh-muted);" }, [
              h("span", {}, "Safe havens:"),
              ...(safe.length ? safe.map((c) => h("span", { class: "tgh-badge", style: "border:1px solid var(--tgh-accent);" }, `${FLAGS[c]} ${c}`)) : [h("span", { style: "color:var(--tgh-hospital);" }, "No safe destinations")]),
            ])
          );
        }

        /* filter highlight (buttons persist, so no focus loss) */
        Array.from(filterRow.children).forEach((btn) => {
          btn.style.borderColor = btn.dataset.filterOpt === filter ? "var(--tgh-accent)" : "";
          btn.style.color = btn.dataset.filterOpt === filter ? "var(--tgh-accent)" : "";
        });

        /* grid */
        swapPreservingScroll(grid, (host) => {
          if (!settings.isTornConfigured()) {
            host.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; padding:20px;" }, "Add your Torn API key in Settings to sweep the airspace."));
            return;
          }
          if (loading && players.length === 0) {
            host.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; padding:20px;" }, "Sweeping airspace…"));
            return;
          }
          if (!hasFetched && !apiError) {
            host.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; padding:20px;" }, "Waiting for data…"));
            return;
          }

          const list = active
            .filter((c) => {
              const info = statusInfo(stats[c]);
              if (filter === "Show All") return true;
              if (filter === "Safe Countries") return safe.includes(c);
              if (filter === "Active Conflicts") return info.label === "Active Conflict";
              if (filter === "Enemy Present") return info.label === "Enemy Present";
              if (filter === "Enemy Inbound") return info.label === "Enemy Inbound";
              if (filter === "Allied Only") return info.label === "Allied Only";
              return true;
            })
            .sort((a, b) => statusInfo(stats[a]).priority - statusInfo(stats[b]).priority);

          if (list.length === 0) {
            host.appendChild(h("div", { class: "tgh-muted", style: "text-align:center; padding:20px;" }, active.length === 0 ? "No overseas deployments detected." : "No countries match the selected filter."));
            return;
          }

          list.forEach((country) => {
            const s = stats[country];
            const info = statusInfo(s);
            const card = h("div", { style: "border:1px solid var(--tgh-border); border-radius:6px; background:var(--tgh-surface);" });
            const cardHeader = h("div", { style: "padding:8px 10px; cursor:pointer;" });
            cardHeader.addEventListener("click", () => {
              expanded[country] = !expanded[country];
              renderAll();
            });
            cardHeader.appendChild(
              h("div", { class: "tgh-row", style: "justify-content:space-between;" }, [
                h("span", { style: "font-weight:700;" }, `${FLAGS[country]} ${country}`),
                h("span", { style: `color:${info.color}; font-size:9px; text-transform:uppercase; font-weight:700;` }, info.label),
              ])
            );
            cardHeader.appendChild(
              h("div", { class: "tgh-row", style: "font-size:9px; color:var(--tgh-muted); margin-top:4px;" }, [
                h("span", {}, `Allied: L${s.alliedLanded} I${s.alliedInbound} H${s.alliedHospital}`),
                h("span", {}, `Enemy: L${s.enemyLanded} I${s.enemyInbound} H${s.enemyHospital}`),
                h("span", {}, `${FLIGHT_TIMES[country]}m flight`),
              ])
            );
            card.appendChild(cardHeader);
            if (expanded[country]) {
              const inner = h("div", { style: "border-top:1px solid var(--tgh-border); max-height:150px; overflow:auto; padding:4px 10px;" });
              [...s.players]
                .sort((a, b) => (a.faction !== b.faction ? (a.faction === "Enemy" ? -1 : 1) : a.name.localeCompare(b.name)))
                .forEach((p) => {
                  inner.appendChild(
                    h("div", { class: "tgh-row", style: "justify-content:space-between; padding:3px 0; border-bottom:1px solid var(--tgh-border);" }, [
                      h("a", { class: "tgh-link", href: `https://www.torn.com/profiles.php?XID=${p.id}`, target: "_blank", rel: "noopener noreferrer", style: p.faction === "Enemy" ? "color:var(--tgh-hospital);" : "color:var(--tgh-okay);" }, p.name),
                      h("span", { class: "tgh-muted" }, `${p.bucket} · ${p.last_action.relative || relTime(p.last_action.timestamp)}`),
                    ])
                  );
                });
              card.appendChild(inner);
            }
            host.appendChild(card);
          });
        });

        /* footer */
        let inTornAllied = 0, inTornEnemy = 0;
        players.forEach((p) => {
          if (!p.country) {
            if (p.faction === "Allied") inTornAllied++;
            else inTornEnemy++;
          }
        });
        footer.innerHTML = "";
        footer.appendChild(h("span", { style: "color:var(--tgh-okay);" }, `${inTornAllied} allies in Torn`));
        footer.appendChild(h("span", { style: "color:var(--tgh-hospital);" }, `${inTornEnemy} enemies in Torn`));
      }

      renderAll();
      fetchData();
      timer = setInterval(fetchData, 60000);
      const onWar = () => fetchData();
      window.addEventListener("tgh:war-changed", onWar);
      return () => {
        destroyed = true;
        clearInterval(timer);
        window.removeEventListener("tgh:war-changed", onWar);
      };
    },
  };

  /* =====================================================================
   * HUB
   * ===================================================================*/
  const MODULES = [HitCallerModule, StrikeTeamsModule, ChainManagerModule, AtcModule, SettingsModule];
  const MODULE_IDS = MODULES.map((m) => m.id);

  const fab = h("button", { id: "tgh-fab", title: "The Green House" }, "TGH");
  document.body.appendChild(fab);

  const hub = h("div", { id: "tgh-hub", class: "tgh-hidden" });
  const header = h("div", { id: "tgh-hub-header" });
  const titleBox = h("div", {});
  const activeModuleTitle = h("div", { class: "tgh-title" });
  const activeModuleSub = h("div", { class: "tgh-sub" });
  titleBox.appendChild(activeModuleTitle);
  titleBox.appendChild(activeModuleSub);
  const closeBtn = h("button", { id: "tgh-hub-close", onclick: () => toggleHub(false) }, "✕");
  header.appendChild(titleBox);
  header.appendChild(closeBtn);

  const bodyRow = h("div", { id: "tgh-hub-body" });
  const nav = h("div", { id: "tgh-hub-nav" });
  const content = h("div", { id: "tgh-hub-content" });
  bodyRow.appendChild(nav);
  bodyRow.appendChild(content);
  hub.appendChild(header);
  hub.appendChild(bodyRow);
  document.body.appendChild(hub);

  const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

  // Restore positions, clamped into the current viewport so nothing can be
  // stranded off-screen after a resolution or window change.
  function resetHubPos() {
    hub.style.left = "auto";
    hub.style.top = "auto";
    hub.style.right = "auto";
    hub.style.bottom = "12px";
    // Sit next to the button, which lives bottom-left by default.
    hub.style.left = "70px";
  }
  function restoreHubPos() {
    const saved = settings.get("hubPos");
    if (saved && saved.left && saved.top) {
      hub.style.right = "auto";
      hub.style.bottom = "auto";
      hub.style.left = clamp(parseInt(saved.left, 10) || 0, 0, window.innerWidth - 120) + "px";
      hub.style.top = clamp(parseInt(saved.top, 10) || 0, 0, window.innerHeight - 60) + "px";
    } else {
      resetHubPos();
    }
  }
  restoreHubPos();

  function resetFabPos() {
    fab.style.top = "auto";
    fab.style.right = "auto";
    fab.style.left = "12px";
    fab.style.bottom = "12px";
  }
  function restoreFabPos() {
    const saved = settings.get("fabPos");
    if (saved && saved.left && saved.top) {
      const size = fab.offsetWidth || 46;
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      fab.style.left = clamp(parseInt(saved.left, 10) || 0, 0, window.innerWidth - size) + "px";
      fab.style.top = clamp(parseInt(saved.top, 10) || 0, 0, window.innerHeight - size) + "px";
    } else {
      resetFabPos();
    }
  }
  restoreFabPos();

  // Drag the button anywhere; a real click still toggles the hub.
  // Tracked as a timestamp rather than a flag cleared on a timer, so the
  // click that follows a drag release is swallowed regardless of event timing.
  let lastFabDragEnd = 0;
  (function makeFabDraggable() {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const THRESHOLD = 4; // px of travel before it counts as a drag, not a click

    const start = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const pt = e.touches ? e.touches[0] : e;
      dragging = true;
      moved = false;
      sx = pt.clientX;
      sy = pt.clientY;
      const r = fab.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      e.preventDefault();
    };
    const move = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - sx;
      const dy = pt.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < THRESHOLD) return;
      if (!moved) {
        moved = true;
        fab.classList.add("tgh-dragging");
      }
      const size = fab.offsetWidth || 46;
      fab.style.right = "auto";
      fab.style.bottom = "auto";
      fab.style.left = clamp(ox + dx, 0, window.innerWidth - size) + "px";
      fab.style.top = clamp(oy + dy, 0, window.innerHeight - size) + "px";
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      fab.classList.remove("tgh-dragging");
      if (!moved) return;
      settings.set("fabPos", { left: fab.style.left, top: fab.style.top });
      lastFabDragEnd = Date.now();
    };

    fab.addEventListener("mousedown", start);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    fab.addEventListener("touchstart", start, { passive: false });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  })();

  // Keep both inside the window if it's resized or the display changes.
  window.addEventListener("resize", () => {
    if (settings.get("fabPos")) restoreFabPos();
    if (settings.get("hubPos")) restoreHubPos();
  });

  (function makeDraggable() {
    let sx, sy, ox, oy, dragging = false;
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("#tgh-hub-close")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const rect = hub.getBoundingClientRect();
      ox = rect.left;
      oy = rect.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      hub.style.right = "auto";
      hub.style.bottom = "auto";
      hub.style.left = clamp(ox + (e.clientX - sx), 0, window.innerWidth - 120) + "px";
      hub.style.top = clamp(oy + (e.clientY - sy), 0, window.innerHeight - 60) + "px";
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      settings.set("hubPos", { left: hub.style.left, top: hub.style.top });
    });
  })();

  let storedTab = settings.get("lastTab");
  let activeModuleId = MODULE_IDS.includes(storedTab) ? storedTab : settings.isTornConfigured() ? "hitcaller" : "settings";
  let activeCleanup = null;
  let mounted = false;

  function unmountActive() {
    if (activeCleanup) {
      try {
        activeCleanup();
      } catch (e) {
        console.warn("[TheGreenHouse] module cleanup failed", e);
      }
      activeCleanup = null;
    }
    content.innerHTML = "";
    mounted = false;
  }

  function selectModule(id, force) {
    const mod = MODULES.find((m) => m.id === id) || MODULES[0];
    // Clicking the tab you're already on shouldn't tear it down and refetch.
    if (!force && mounted && mod.id === activeModuleId) return;
    unmountActive();
    activeModuleId = mod.id;
    settings.set("lastTab", mod.id); // persist the resolved id, never an unknown one
    activeModuleTitle.textContent = mod.title;
    activeModuleSub.textContent = mod.subtitle || "";
    Array.from(nav.children).forEach((el) => el.classList.toggle("tgh-active", el.dataset.modId === mod.id));
    try {
      const cleanup = mod.mount(content);
      activeCleanup = typeof cleanup === "function" ? cleanup : null;
      mounted = true;
    } catch (e) {
      console.error("[TheGreenHouse] module failed to mount", e);
      content.appendChild(h("div", { class: "tgh-banner tgh-banner-err" }, "This tool failed to load: " + (e && e.message ? e.message : String(e))));
      mounted = true;
    }
  }

  MODULES.forEach((mod) => {
    const item = h("div", { class: "tgh-nav-item" }, [h("span", {}, mod.icon), h("span", {}, mod.title)]);
    item.dataset.modId = mod.id;
    item.addEventListener("click", () => selectModule(mod.id));
    nav.appendChild(item);
  });

  function toggleHub(force) {
    const show = force !== undefined ? force : hub.classList.contains("tgh-hidden");
    hub.classList.toggle("tgh-hidden", !show);
    fab.classList.toggle("tgh-active", show);
    if (show) {
      // Remount every time it opens, so a pane that came up unconfigured
      // picks up new settings instead of staying stale forever.
      selectModule(activeModuleId, true);
    } else {
      // Closing stops all of the module's polling.
      unmountActive();
    }
  }
  fab.addEventListener("click", () => {
    if (Date.now() - lastFabDragEnd < 300) return; // just finished dragging, don't also toggle
    toggleHub();
  });

  // Nudge to Settings on a fresh install (only if the user hasn't opened it already).
  setTimeout(() => {
    if (!settings.isTornConfigured() && hub.classList.contains("tgh-hidden")) {
      activeModuleId = "settings";
      toggleHub(true);
    }
  }, 1200);

  GMC.registerMenuCommand("The Green House: Open", () => toggleHub(true));
  GMC.registerMenuCommand("The Green House: Settings", () => {
    activeModuleId = "settings";
    toggleHub(true);
  });

  window.TGH_HUB = {
    __ready: true,
    engine: GMC.hasLegacyGet ? "tampermonkey-style (GM_*)" : "greasemonkey-style (GM.*)",
    settings,
    fetchTorn,
    fetchFFS,
    supa,
    toggleHub,
    selectModule,
  };
  console.log("[TheGreenHouse] Hub loaded —", window.TGH_HUB.engine);
})();
