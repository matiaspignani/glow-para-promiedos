// Promiedos Glow — favorite team widget: search, highlight, stats and news.
// All data comes from the page's own __NEXT_DATA__ (no extra requests to
// Promiedos); news come from Google News RSS through background.js.
(() => {
  // "Invitame un café" in the settings: a Mercado Pago alias/CVU to copy (nothing is
  // sent anywhere, the user pastes it in their own banking app). `url` is optional
  // (an https payment link); with neither alias nor url the whole box stays hidden.
  const DONATE = { service: "Mercado Pago", alias: "tecrosario.mp", cvu: "0000003100068381232078", url: "https://cafecito.app/tecrosario" };

  const STORE_KEY = "pgFavTeam"; // main team, used in every league it plays in
  const LEAGUE_KEY = "pgLeagueFavs"; // { [leagueId]: team } club chosen for one specific league
  const DISMISS_KEY = "pgLeagueDismissed"; // { [leagueId]: true } "no, gracias" for that league
  const FOCUS_KEY = "pgFocus"; // id of the club whose stats are shown (set by clicking its crest)
  const FEATURES_KEY = "pgFeatures"; // { [feature]: false } for the improvements switched off
  const OPEN_KEY = "pgDockOpen";
  const LEFT_KEY = "pgLeftCollapsed";
  const crest = (id) => `https://api.promiedos.com.ar/images/team/${id}/1`;
  const norm = (s) =>
    (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  /* ---------- helpers ---------- */

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  const ago = (date) => {
    const mins = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
    if (mins < 60) return `hace ${mins} min`;
    if (mins < 1440) return `hace ${Math.round(mins / 60)} h`;
    return `hace ${Math.round(mins / 1440)} d`;
  };

  // Preferences (main club, clubs per league, "no, gracias" answers, switches) live
  // in chrome.storage.sync, so they follow the user's Google account across every
  // Chrome signed in with it (when Chrome sync is on; otherwise sync behaves like
  // local). Per-device UI state (panel open, left menu, focused crest) stays local.
  // The user can turn this off in the settings card (SYNC_FLAG, kept locally).
  const SYNC_KEYS = [STORE_KEY, LEAGUE_KEY, DISMISS_KEY, FEATURES_KEY];
  const SYNC_FLAG = "pgSyncOn";
  const syncAvailable = () => !!chrome.storage.sync;
  const prefsArea = () => (state.sync && syncAvailable() ? chrome.storage.sync : chrome.storage.local);
  const areaGet = (area, keys) => new Promise((res) => area.get(keys, (r) => res(r || {})));
  // Resolves with an error message (e.g. quota exceeded) or null.
  const areaSet = (area, items) =>
    new Promise((res) => area.set(items, () => res(chrome.runtime.lastError ? chrome.runtime.lastError.message : null)));

  const store = {
    get: () => areaGet(prefsArea(), STORE_KEY).then((r) => r[STORE_KEY] || null),
    set: (team) => saveToPrefs({ [STORE_KEY]: team }),
    clear: () => prefsArea().remove(STORE_KEY),
    getMap: (key) => areaGet(prefsArea(), key).then((r) => (r[key] && typeof r[key] === "object" ? r[key] : {})),
    setMap: (key, map) => saveToPrefs({ [key]: map }),
  };

  async function saveToPrefs(items) {
    const err = await areaSet(prefsArea(), items);
    state.syncError = err;
    if (typeof renderSettings === "function") renderSettings();
  }

  // Curated official-site links (socials.json), served by the background worker.
  function loadSocials() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "pg-socials" }, (res) =>
          resolve(chrome.runtime.lastError || !res?.ok ? null : res.data?.teams || null),
        );
      } catch {
        resolve(null);
      }
    });
  }

  /* ---------- data model (from __NEXT_DATA__) ---------- */

  function readPageData() {
    try {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      const data = JSON.parse(raw).props.pageProps.data;
      // League pages: /league/<slug>/<id> (tables) and /league/<slug>/<id>/equipos
      // (teams and stats). Both carry `league`; only the first has `tables_groups`.
      if (!data?.league) return null;
      // __NEXT_DATA__ goes stale after client-side navigation to another league.
      const parts = location.pathname.split("/").filter(Boolean);
      const urlId = parts[0] === "league" ? parts[2] : parts.pop();
      if (data.league.id && urlId !== data.league.id) return null;
      return data;
    } catch {
      return null;
    }
  }

  // Match pages (/game/<slug>/<id>): the game, with its form and head-to-head data.
  function readGameData() {
    try {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      const game = JSON.parse(raw).props.pageProps.initialData?.game;
      const parts = location.pathname.split("/").filter(Boolean);
      return parts[0] === "game" && game?.id === parts[2] ? game : null;
    } catch {
      return null;
    }
  }

  const num = (v) => (v === undefined || v === "" ? NaN : Number(v));

  function buildModel(data) {
    const teams = new Map();
    const tables = [];
    // The /equipos tab has no standings, only the league's team list.
    (data.teams || []).forEach((entry) => entry?.team?.id && teams.set(entry.team.id, entry.team));
    Object.values(data.tables_groups || {}).forEach((group) => {
      const list = Array.isArray(group.tables) ? group.tables : Object.values(group.tables || {});
      list.forEach((t) => {
        const rows = (t.table?.rows || [])
          .filter((r) => r.entity?.type === 1)
          .map((r) => {
            const v = {};
            r.values.forEach((x) => (v[x.key] = x.value));
            const goals = /^(\d+):(\d+)$/.exec(String(v.Goals ?? ""));
            const gf = goals ? Number(goals[1]) : NaN;
            const gc = goals ? Number(goals[2]) : NaN;
            return {
              pos: r.num,
              team: r.entity.object,
              pts: num(v.Points),
              gp: num(v.GamePlayed),
              w: num(v.GamesWon),
              d: num(v.GamesEven),
              l: num(v.GamesLost),
              gf,
              gc,
              trend: v["{trend}"] || [],
            };
          });
        if (!rows.length) return;
        rows.forEach((r) => teams.set(r.team.id, r.team));
        const parts = [...new Set([group.name, t.name].filter(Boolean))];
        tables.push({ label: parts.join(" · ") || "Tabla", rows });
      });
    });
    const playerTables = Object.values(data.players_statistics?.tables || {});
    return { teams, tables, playerTables };
  }

  function teamStats(model, teamId) {
    const out = [];
    for (const t of model.tables) {
      const row = t.rows.find((r) => r.team.id === teamId);
      if (!row) continue;
      const hasGoals = Number.isFinite(row.gf) && Number.isFinite(row.gc);
      const rank = (fn, asc) => {
        const sorted = [...t.rows].sort((a, b) => (asc ? fn(a) - fn(b) : fn(b) - fn(a)));
        return sorted.findIndex((r) => r.team.id === teamId) + 1;
      };
      out.push({
        label: t.label,
        row,
        total: t.rows.length,
        efficiency: row.gp ? (row.pts / (row.gp * 3)) * 100 : NaN,
        ppg: row.gp ? row.pts / row.gp : NaN,
        gfpg: hasGoals && row.gp ? row.gf / row.gp : NaN,
        gcpg: hasGoals && row.gp ? row.gc / row.gp : NaN,
        attackRank: hasGoals ? rank((r) => r.gf, false) : null,
        defenseRank: hasGoals ? rank((r) => r.gc, true) : null,
        leaders: hasGoals ? leaders(t.rows) : null,
      });
    }
    return out;
  }

  function leaders(rows) {
    const best = (fn, asc) => [...rows].sort((a, b) => (asc ? fn(a) - fn(b) : fn(b) - fn(a)))[0];
    const a = best((r) => r.gf, false);
    const d = best((r) => r.gc, true);
    const w = best((r) => r.w, false);
    const dr = best((r) => r.d, false);
    return [
      ["Mejor ataque", a.team.short_name, `${a.gf} goles`],
      ["Mejor defensa", d.team.short_name, `${d.gc} en contra`],
      ["Más victorias", w.team.short_name, `${w.w}`],
      ["Más empates", dr.team.short_name, `${dr.d}`],
    ];
  }

  function playerHighlights(model, teamId) {
    const out = [];
    for (const table of model.playerTables) {
      for (const row of table.rows || []) {
        const p = row.entity?.object;
        if (p?.team_id === teamId) {
          out.push({ stat: table.name, rank: row.num, name: p.sname || p.name, value: row.values?.[0]?.value });
        }
      }
    }
    return out;
  }

  /* ---------- highlight in the page ---------- */

  function applyHighlight(team) {
    document.querySelectorAll(".pg-fav-row").forEach((n) => n.classList.remove("pg-fav-row"));
    document.querySelectorAll(".pg-fav-match").forEach((n) => n.classList.remove("pg-fav-match"));
    document.querySelectorAll(".pg-fav-card").forEach((n) => n.classList.remove("pg-fav-card"));
    if (!team || !feat("highlight")) return;
    const names = new Set([norm(team.name), norm(team.short_name)]);

    document.querySelectorAll('tr[class*="row_row"]').forEach((tr) => {
      for (const n of tr.querySelectorAll("*")) {
        if (n.children.length === 0 && names.has(norm(n.textContent))) {
          tr.classList.add("pg-fav-row");
          break;
        }
      }
    });
    document.querySelectorAll('a[class*="item_item"]').forEach((a) => {
      const hit = [...a.querySelectorAll(".comand-name__title")].some((n) =>
        names.has(norm(n.textContent)),
      );
      if (hit) a.classList.add("pg-fav-match");
    });
    // "Equipos y estadísticas" tab: the club's card in the teams grid.
    document.querySelectorAll('[class*="equipos_block"]').forEach((card) => {
      const hit = [...card.querySelectorAll(".comand-name__title")].some((n) => names.has(norm(n.textContent)));
      if (hit) card.classList.add("pg-fav-card");
    });
  }

  /* ---------- news ---------- */

  function fetchNews(teamName) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "pg-news", query: `"${teamName}"` }, (res) => {
          if (chrome.runtime.lastError || !res?.ok) return resolve(null);
          const doc = new DOMParser().parseFromString(res.xml, "text/xml");
          // The feed is relevance-ordered, not chronological: sort newest first, then take 6.
          const dated = (i) => new Date(i.querySelector("pubDate")?.textContent || 0).getTime() || 0;
          const items = [...doc.querySelectorAll("item")].sort((a, b) => dated(b) - dated(a)).slice(0, 6).map((i) => {
            const source = i.querySelector("source")?.textContent || "";
            let title = i.querySelector("title")?.textContent || "";
            if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
            return {
              title,
              source,
              link: i.querySelector("link")?.textContent || "",
              date: new Date(i.querySelector("pubDate")?.textContent || Date.now()),
            };
          });
          resolve(items);
        });
      } catch {
        resolve(null);
      }
    });
  }

  /* ---------- widget UI (shadow DOM keeps site CSS out) ---------- */

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    /* Right-docked bar: a slim handle that expands into a full-height side panel.
       --side-w is set from JS so the page padding and the panel stay in sync. */
    .dock { position: fixed; top: var(--bar-h, 0px); right: 0; height: calc(100vh - var(--bar-h, 0px)); z-index: 2147483000; display: flex; align-items: center;
      pointer-events: none; --side-w: 380px; }
    .dock > * { pointer-events: auto; }
    .handle { width: 34px; padding: 14px 0; display: flex; flex-direction: column; align-items: center; gap: 10px;
      background: #b6f26b; color: #07130e; border: 0; border-radius: 12px 0 0 12px; font-weight: 700; font-size: 13px;
      cursor: pointer; box-shadow: -4px 0 18px rgba(0,0,0,.35); }
    .handle img { width: 22px; height: 22px; object-fit: contain; }
    .vlabel { writing-mode: vertical-rl; transform: rotate(180deg); letter-spacing: .04em; white-space: nowrap; }
    .chev { font-size: 16px; line-height: 1; transition: transform .2s; }
    .dock[data-open="true"] .chev { transform: rotate(180deg); }
    .side { align-self: stretch; width: 0; overflow: hidden; background: #0e211a; color: #e8f1ec; transition: width .22s ease; }
    .dock[data-open="true"] .side { width: var(--side-w); border-left: 1px solid rgba(255,255,255,.14); box-shadow: -10px 0 40px rgba(0,0,0,.5); }
    .side-inner { width: var(--side-w); height: 100%; overflow: auto; padding: 16px; font-size: 13px; scrollbar-width: thin; }
    h3 { margin: 0 0 10px; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #8aa399; font-weight: 700; }
    section { margin-top: 16px; }
    input { width: 100%; background: #12291f; border: 1px solid rgba(255,255,255,.16); border-radius: 10px; color: inherit;
      padding: 10px 12px; font-size: 14px; outline: none; }
    input:focus { border-color: #b6f26b; }
    .sugg { margin-top: 6px; max-height: 190px; overflow: auto; border-radius: 10px; scrollbar-width: thin; }
    .sugg button { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; color: inherit; border: 0;
      padding: 8px 10px; text-align: left; cursor: pointer; border-radius: 8px; font-size: 13px; }
    .sugg button:hover, .sugg button:focus { background: rgba(182,242,107,.12); outline: none; }
    .sugg img, .hero img { width: 26px; height: 26px; object-fit: contain; }
    .hero { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
    .hero img { width: 44px; height: 44px; }
    .hero b { font-size: 17px; display: block; }
    .hero span { color: #8aa399; font-size: 12px; }
    .link { background: none; border: 0; color: #b6f26b; cursor: pointer; font-size: 12px; padding: 0; }
    .acts { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .ask { background: rgba(182,242,107,.1); border: 1px solid rgba(182,242,107,.4); border-radius: 12px; padding: 12px; }
    .ask p { margin: 6px 0 10px; color: #c5d6cc; line-height: 1.4; }
    .btns { display: flex; gap: 8px; }
    .btn { flex: 1; padding: 8px; border-radius: 10px; border: 1px solid rgba(182,242,107,.45); background: transparent;
      color: #b6f26b; font-weight: 700; cursor: pointer; }
    .btn.primary { background: #b6f26b; color: #07130e; }
    .socials { display: flex; flex-wrap: wrap; gap: 6px; }
    .socials a { padding: 5px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); color: #e8f1ec;
      text-decoration: none; font-size: 12px; font-weight: 600; }
    .socials a:hover { border-color: #b6f26b; color: #b6f26b; }
    .note { margin: 8px 0 0; font-size: 10.5px; color: #8aa399; }
    .dock[hidden], .lhandle[hidden], .sgear[hidden], .spop[hidden] { display: none; }

    /* Settings: gear buttons and the switch card */
    .hgear, .sgear { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; cursor: pointer;
      border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.07); color: #e8f1ec; font-size: 17px; line-height: 1; }
    .hgear:hover, .sgear:hover { border-color: #b6f26b; color: #b6f26b; }
    .sgear { position: fixed; left: 10px; bottom: 10px; z-index: 2147483000; background: #0e211a; }
    .spop { position: fixed; top: calc(var(--bar-h, 0px) + 10px); right: calc(var(--dock-off, 0px) + 12px); z-index: 2147483500;
      width: min(430px, calc(100vw - 24px)); max-height: calc(100vh - var(--bar-h, 0px) - 24px); overflow: auto; padding: 14px 16px;
      background: #0e211a; color: #e8f1ec; border: 1px solid rgba(182,242,107,.35); border-radius: 16px; font-size: 13px;
      box-shadow: 0 20px 50px rgba(0,0,0,.6); scrollbar-width: thin; }
    .shead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .slist { list-style: none; margin: 0; padding: 0; }
    .srow { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 9px 0;
      border-bottom: 1px solid rgba(255,255,255,.07); }
    .stxt b { display: block; font-size: 13px; }
    .stxt small { display: block; margin-top: 2px; color: #8aa399; font-size: 11px; line-height: 1.3; }
    .sctl { display: flex; align-items: center; gap: 8px; flex: none; }
    .sw { position: relative; flex: none; width: 46px; height: 26px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
      background: #3a4a43; transition: background .2s; }
    .sw.on { background: #2fb457; }
    .sw .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
      transition: transform .2s; }
    .sw.on .knob { transform: translateX(20px); }
    .sstate { min-width: 78px; font-size: 11px; font-weight: 700; }
    .sstate.on { color: #b6f26b; }
    .sstate.off { color: #8aa399; }
    .sfoot { display: flex; justify-content: space-between; margin-top: 10px; }
    /* Welcome (first run) */
    .wback { position: fixed; inset: 0; z-index: 2147483700; display: grid; place-items: center; padding: 16px;
      background: radial-gradient(900px 500px at 50% 0%, rgba(182,242,107,.14), transparent 60%), rgba(3,10,7,.82);
      backdrop-filter: blur(4px); }
    .wback[hidden] { display: none; }
    .wcard { position: relative; width: min(640px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 32px 28px 22px;
      text-align: center; color: #e8f1ec; background: linear-gradient(180deg, #14301f, #0a1a12);
      border: 1px solid rgba(182,242,107,.4); border-radius: 24px; box-shadow: 0 30px 90px rgba(0,0,0,.7);
      animation: wpop .35s ease both; scrollbar-width: thin; }
    @keyframes wpop { from { opacity: 0; transform: translateY(14px) scale(.98); } }
    @media (prefers-reduced-motion: reduce) { .wcard { animation: none; } }
    .wskip { position: absolute; top: 14px; right: 18px; }
    .wcard h2 { margin: 6px 0 6px; font-size: 24px; letter-spacing: -.01em; }
    .wlead { margin: 0 auto 16px; max-width: 480px; color: #c5d6cc; font-size: 14px; line-height: 1.5; }
    .whint { margin: 10px 0 0; color: #8aa399; font-size: 12px; }
    .wlogo { width: 76px; height: 76px; margin: 0 auto 10px; border-radius: 22px; display: grid; place-items: center;
      font-size: 44px; font-weight: 800; color: #b6f26b; border: 5px solid #b6f26b; box-shadow: 0 0 30px rgba(182,242,107,.35); }
    .wperks { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 4px 0 22px; }
    .wperks span { padding: 7px 14px; border-radius: 999px; background: rgba(182,242,107,.12); border: 1px solid rgba(182,242,107,.3);
      font-size: 13px; font-weight: 600; }
    .wpicker input { margin-bottom: 10px; }
    .wgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 10px; max-height: 300px; overflow: auto;
      padding: 4px; scrollbar-width: thin; }
    .wteam { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 6px 9px; cursor: pointer; color: #e8f1ec;
      background: #0e211a; border: 2px solid rgba(255,255,255,.08); border-radius: 14px; font-size: 12px; font-weight: 600;
      transition: transform .15s, border-color .15s, background .15s; }
    .wteam[hidden] { display: none; }
    .wteam img { width: 46px; height: 46px; object-fit: contain;
      filter: drop-shadow(0 0 .6px rgba(255,255,255,.9)) drop-shadow(0 2px 4px rgba(0,0,0,.5)); }
    .wteam:hover { transform: translateY(-2px); border-color: rgba(182,242,107,.6); }
    .wteam.on { border-color: #b6f26b; background: rgba(182,242,107,.16); box-shadow: 0 0 0 3px rgba(182,242,107,.25); }
    .wnav { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 18px; }
    .wnav.one { justify-content: center; }
    .wbtn { padding: 11px 22px; border-radius: 999px; cursor: pointer; font-weight: 800; font-size: 14px; color: #b6f26b;
      background: transparent; border: 1px solid rgba(182,242,107,.5); }
    .wbtn.primary { background: #b6f26b; color: #07130e; border-color: #b6f26b; }
    .wbtn:disabled { opacity: .35; cursor: not-allowed; }
    .wdots { display: flex; justify-content: center; gap: 7px; margin-top: 16px; }
    .wdots i { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.2); }
    .wdots i.on { background: #b6f26b; width: 22px; border-radius: 6px; }
    .wcrests { display: flex; justify-content: center; align-items: flex-end; gap: 14px; margin-bottom: 6px; }
    .wcrests img { width: 56px; height: 56px; object-fit: contain; opacity: .9;
      filter: drop-shadow(0 0 1px rgba(255,255,255,.9)) drop-shadow(0 6px 10px rgba(0,0,0,.5)); }
    .wcrests img.big { width: 110px; height: 110px; opacity: 1; }
    .coffeebox { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 12px; padding-top: 12px;
      border-top: 1px solid rgba(255,255,255,.07); }
    .coffeebox small { color: #8aa399; font-size: 11px; text-align: center; }
    .coffeetitle { display: inline-block; padding: 8px 18px; border-radius: 999px; background: #ffc61a; color: #07130e;
      font-weight: 800; font-size: 13px; box-shadow: 0 4px 14px rgba(255,198,26,.25); }
    a.coffeelink { text-decoration: none; cursor: pointer; transition: filter .15s, transform .15s; }
    a.coffeelink:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .coffeeacc { font-size: 12px; color: #c5d6cc; }
    .coffeeacc code { padding: 2px 8px; border-radius: 6px; background: #12291f; color: #ffc61a; font-weight: 700; user-select: all; }
    .coffeebtns { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .copy { padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,198,26,.6); background: transparent; color: #ffc61a;
      font-weight: 700; font-size: 12px; cursor: pointer; text-decoration: none; }
    .copy:hover { background: rgba(255,198,26,.14); }
    .syncrow { margin-bottom: 4px; padding-bottom: 12px; border-bottom: 1px solid rgba(182,242,107,.35); }
    .stxt small.err { color: #ff8a8d; }
    .sw:disabled { opacity: .4; cursor: not-allowed; }

    /* Crests in the top bar: grey except the active club; colour on hover */
    .hcrest img { transition: filter .15s; }
    .hmine.gray .hcrest:not(.on) { border-color: rgba(255,255,255,.1); }
    .hmine.gray .hcrest:not(.on) img {
      filter: grayscale(1) opacity(.65) drop-shadow(0 0 .6px rgba(255,255,255,.6)); }
    .hmine.gray .hcrest:not(.on):hover { border-color: rgba(255,255,255,.4); }
    .hmine.gray .hcrest:not(.on):hover img {
      filter: drop-shadow(0 0 .6px rgba(255,255,255,.9)) drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
    .hmine { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .hcrest { position: relative; flex: none; width: 38px; height: 38px; padding: 3px; border-radius: 50%; cursor: pointer;
      border: 2px solid rgba(255,255,255,.18); background: rgba(255,255,255,.07); display: grid; place-items: center;
      transition: transform .15s, border-color .15s; }
    .hcrest img { width: 100%; height: 100%; object-fit: contain;
      filter: drop-shadow(0 0 .6px rgba(255,255,255,.9)) drop-shadow(0 1px 2px rgba(0,0,0,.55)); }
    .hcrest:hover { transform: scale(1.1); }
    .hcrest.on { border-color: #b6f26b; box-shadow: 0 0 0 3px rgba(182,242,107,.3); }
    .hcrest .star { position: absolute; right: -4px; top: -5px; font-size: 11px; font-style: normal; color: #b6f26b; text-shadow: 0 0 3px #000; }
    .mine { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
    .mine button { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 6px; border-radius: 999px; cursor: pointer;
      border: 1px solid rgba(255,255,255,.18); background: transparent; color: #e8f1ec; font-size: 12px; font-weight: 600; text-align: left; }
    .mine button.on { border-color: #b6f26b; background: rgba(182,242,107,.14); }
    .mine img { width: 24px; height: 24px; object-fit: contain; }
    .mine small { display: block; color: #8aa399; font-size: 10px; font-weight: 500; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .stat { background: #12291f; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 8px 10px; }
    .stat b { display: block; font-size: 16px; }
    .stat span { color: #8aa399; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; }
    .form { display: flex; gap: 4px; margin-top: 10px; }
    .form i { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-style: normal; font-weight: 700; font-size: 11px; color: #fff; }
    .form .w { background: #2fb457; } .form .d { background: #6b7c74; } .form .l { background: #e5484d; }
    ul { list-style: none; margin: 0; padding: 0; }
    li.row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
    li.row span:last-child { color: #8aa399; white-space: nowrap; }
    a.news { display: block; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.07); color: #e8f1ec; text-decoration: none; line-height: 1.35; }
    a.news:hover { color: #b6f26b; }
    a.news small { display: block; color: #8aa399; margin-top: 2px; font-size: 11px; }
    .muted { color: #8aa399; }
    .display { margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.08); color: #8aa399; font-size: 10.5px; line-height: 1.5; }
    .lhandle { position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 2147483000; width: 34px; padding: 14px 0;
      display: flex; flex-direction: column; align-items: center; gap: 10px; background: #b6f26b; color: #07130e; border: 0;
      border-radius: 0 12px 12px 0; font-weight: 700; font-size: 13px; cursor: pointer; box-shadow: 4px 0 18px rgba(0,0,0,.35); }
    /* Both side handles share size and vertical position (centered, same height). */
    .handle, .lhandle { height: 140px; justify-content: center; }
    .hstrip { position: fixed; display: flex; align-items: center; justify-content: space-between; gap: 16px;
      pointer-events: none; z-index: 2147482000; }
    .hstrip[hidden] { display: none; }
    .hstrip > * { pointer-events: auto; }
    /* Top bar sections: [site logo] | LIGA ........ MI EQUIPO + position/points */
    .hleague { display: flex; align-items: center; gap: 12px; min-width: 0; padding-left: 24px; height: 60%;
      border-left: 1px solid rgba(255,255,255,.18); color: #e8f1ec; white-space: nowrap; }
    .hleague img { width: 28px; height: 28px; object-fit: contain; flex: none; }
    .lbl { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
    .lbl small { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #8aa399; }
    .lbl b { font-size: 16px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; }
    .hleague b { text-transform: uppercase; letter-spacing: -.01em; }
    .hteam { display: flex; align-items: center; gap: 10px; flex: none; background: rgba(182,242,107,.12); color: #e8f1ec;
      border: 1px solid rgba(182,242,107,.45); border-radius: 12px; padding: 5px 12px 5px 8px; cursor: pointer; white-space: nowrap; text-align: left; }
    .hteam:hover { background: rgba(182,242,107,.22); }
    .hteam img { width: 30px; height: 30px; object-fit: contain; }
    .hteam .ball { font-size: 22px; }
    .hteam .lbl small { color: #b6f26b; }
    .chip { background: #b6f26b; color: #07130e; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 800; }
    .lhandle[data-collapsed="true"] .chev { transform: rotate(180deg); }
    .lhandle:not([data-collapsed="true"]) .chev { transform: none; }
    /* Phones: the dock becomes a pill with a bottom sheet above it. */
    @media (max-width: 767.98px) {
      .dock { top: auto; bottom: 10px; right: 10px; height: auto; flex-direction: column-reverse; align-items: flex-end; }
      .handle { width: auto; flex-direction: row; padding: 10px 16px; border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
      .vlabel { writing-mode: horizontal-tb; transform: none; }
      .chev { transform: rotate(-90deg); }
      .dock[data-open="true"] .chev { transform: rotate(90deg); }
      .dock[data-open="false"] .side { display: none; }
      .side, .dock[data-open="true"] .side { width: calc(100vw - 20px); margin-bottom: 8px; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; }
      .side-inner { width: 100%; max-height: 72vh; height: auto; }
      .grid { grid-template-columns: repeat(2, 1fr); }
      .lhandle { display: none; }
      .handle { height: auto; }
      .hstrip { display: none; }
      .spop { top: auto; bottom: 62px; left: 8px; right: 8px; width: auto; max-height: 70vh; }
    }
    @media (min-width: 1920px) { .side-inner { font-size: 14px; } .handle { font-size: 14px; } }
    @media (min-width: 2560px) { .side-inner { font-size: 16px; } .handle { font-size: 16px; } }
    .go { margin-top: 10px; width: 100%; background: rgba(182,242,107,.12); color: #b6f26b; border: 1px solid rgba(182,242,107,.35);
      border-radius: 10px; padding: 8px; font-weight: 600; cursor: pointer; }

    /* Next match: chip, card, result rows, history */
    .mpill[hidden], .fab[hidden], .fabs[hidden] { display: none; }
    .mpill { display: flex; align-items: center; gap: 8px; flex: none; background: rgba(255,255,255,.07); color: #e8f1ec;
      border: 1px solid rgba(255,255,255,.2); border-radius: 12px; padding: 4px 12px; cursor: pointer; white-space: nowrap; text-align: left; }
    .mpill:hover { border-color: #b6f26b; }
    .mpill .mtxt { display: flex; flex-direction: column; line-height: 1.15; }
    .mpill small { font-size: 9.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8aa399; }
    .mpill b { font-size: 14px; font-weight: 800; }
    .mpill .clock { font-size: 18px; }
    .mpill.live { border-color: #e5484d; background: rgba(229,72,77,.14); }
    .mpill.live small { color: #ff8a8d; }
    .mpill.float { position: fixed; top: calc(var(--bar-h, 0px) + 10px); right: calc(var(--pg-dock-w, 0px) + 12px); z-index: 2147482500;
      background: #0e211a; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
    .mpill.float[data-dock="true"] { display: none; }
    .scn { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.07); }
    .scn i { flex: none; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-style: normal;
      font-weight: 700; font-size: 11px; color: #fff; }
    .scn .w { background: #2fb457; } .scn .d { background: #6b7c74; } .scn .l { background: #e5484d; }
    .scnt b { display: block; font-size: 13px; }
    .scnt small { display: block; margin-top: 2px; color: #8aa399; font-size: 11px; }
    .calbar[hidden] { display: none; }
    .calbar { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 2147482500;
      display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: #0e211a;
      border: 1px solid rgba(182,242,107,.35); box-shadow: 0 8px 24px rgba(0,0,0,.45); }
    .calbar .fab { box-shadow: none; white-space: nowrap; }
    .calbar .fab.on { background: rgba(182,242,107,.16); border-color: #b6f26b; color: #b6f26b; }
    .calbar .fab:disabled { opacity: .5; cursor: not-allowed; }
    .calsel { max-width: 200px; padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.22);
      background: #12291f; color: #e8f1ec; font-size: 12px; font-weight: 700; cursor: pointer; }
    .calcount { color: #8aa399; font-size: 11px; font-weight: 700; white-space: nowrap; padding: 0 6px; }
    @media (max-width: 767.98px) {
      .calbar { top: auto; bottom: 62px; left: 8px; right: 8px; transform: none; flex-wrap: wrap; border-radius: 16px; }
    }
    .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: #e5484d; animation: pgpulse 1.4s infinite; }
    @keyframes pgpulse { 0% { box-shadow: 0 0 0 0 rgba(229,72,77,.6); } 70%, 100% { box-shadow: 0 0 0 7px rgba(229,72,77,0); } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .fabs { position: fixed; left: 54px; bottom: 10px; z-index: 2147483000; display: flex; gap: 8px; }
    .fab { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; cursor: pointer; font-size: 12px;
      font-weight: 700; color: #e8f1ec; background: #0e211a; border: 1px solid rgba(255,255,255,.22); box-shadow: 0 8px 24px rgba(0,0,0,.45); }
    .fab:hover { border-color: #b6f26b; }
    .livebtn.on { background: #e5484d; border-color: #e5484d; color: #fff; }
    .livebtn.on .dot { background: #fff; animation: none; }
    a.gcard { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; background: #12291f;
      border: 1px solid rgba(255,255,255,.08); color: #e8f1ec; text-decoration: none; }
    a.gcard:hover { border-color: #b6f26b; }
    a.gcard.live { border-color: #e5484d; }
    a.gcard img { width: 38px; height: 38px; object-fit: contain; flex: none; }
    a.gcard > div { min-width: 0; flex: 1; }
    a.gcard b { display: block; font-size: 14px; }
    a.gcard small { color: #8aa399; font-size: 11px; }
    a.gcard .gright { flex: none; text-align: right; }
    a.gcard .gright b { font-size: 18px; color: #b6f26b; white-space: nowrap; }
    a.gcard.live .gright b { color: #ff8a8d; }
    a.rrow { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.07);
      color: #e8f1ec; text-decoration: none; font-size: 12.5px; }
    a.rrow:hover { color: #b6f26b; }
    a.rrow i { flex: none; width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; font-style: normal;
      font-weight: 700; font-size: 11px; color: #fff; }
    a.rrow .w, .form .w { background: #2fb457; } a.rrow .d { background: #6b7c74; } a.rrow .l { background: #e5484d; }
    a.rrow .sc { margin-left: auto; font-weight: 700; white-space: nowrap; }
    .hist { margin-top: 0; padding-bottom: 14px; border-bottom: 1px solid rgba(182,242,107,.35); }
    h3.sub { margin-top: 14px; }
    .hvs { display: flex; align-items: center; justify-content: center; gap: 10px; text-align: center; }
    .hvs img { width: 34px; height: 34px; object-fit: contain; flex: none; }
    .tvline { margin: 10px 0 0; padding: 8px 10px; border-radius: 10px; line-height: 1.4; background: rgba(182,242,107,.1);
      border: 1px solid rgba(182,242,107,.3); }
    .frow { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    .frow img { width: 24px; height: 24px; object-fit: contain; }
    .frow .n { flex: 1; font-weight: 600; }
    .frow .form { margin-top: 0; }
    .h2h { display: flex; height: 10px; border-radius: 6px; overflow: hidden; margin: 6px 0 4px; background: #12291f; }
    .h2h .a { background: #b6f26b; } .h2h .x { background: #6b7c74; } .h2h .b { background: #4cc9f0; }
    .h2hlab { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; color: #8aa399; }
    @media (max-width: 767.98px) {
      .mpill.float { top: auto; bottom: 62px; right: 10px; }
      .fabs { left: 54px; bottom: 10px; }
    }
  `;

  const state = {
    fav: null, // team shown in the bar: the league's own pick, else the main team
    favSource: null, // "league" | "main" | null
    main: null,
    leagueId: null,
    leagueFavs: {},
    dismissed: {},
    focusId: null,
    features: {},
    sync: true, // preferences stored in the Google account (chrome.storage.sync)
    syncError: null,
    needsLeaguePick: false, // main team isn't in this league and nothing was chosen/declined yet
    picking: false,
    socials: null,
    model: null,
    data: null,
    game: null, // match shown on /game/ pages (for the history section)
    liveOnly: false,
    cal: { mine: false, league: "all", extras: true }, // /calendario filters (kept in CAL_KEY)
    open: false,
    leftCollapsed: false,
    newsCache: new Map(),
  };

  // The favorite for the league being viewed. A club picked for this league wins;
  // otherwise the main team applies. If the main team doesn't play here and the
  // user hasn't answered yet, the panel asks whether to pick a club for this league.
  // Every club the user follows: the main team first, then the clubs picked for
  // specific leagues. Each carries the league it was picked in (see pickedClub).
  function myClubs() {
    const list = [];
    const seen = new Set();
    const add = (club, kind) => {
      if (club?.id && !seen.has(club.id)) {
        seen.add(club.id);
        list.push({ ...club, kind });
      }
    };
    add(state.main, "main");
    Object.values(state.leagueFavs).forEach((club) => add(club, "league"));
    return list;
  }

  function resolveFav() {
    const L = state.leagueId;
    const leagueFav = L ? state.leagueFavs[L] : null;
    const mainPlays = !!state.main && !!state.model?.teams.has(state.main.id);
    // A crest the user clicked wins, as long as that club plays in this league.
    const focused = state.focusId
      ? myClubs().find((c) => c.id === state.focusId && state.model?.teams.has(c.id))
      : null;
    if (focused) {
      state.fav = focused;
      state.favSource = focused.kind;
    } else if (mainPlays) {
      // The main club plays here: it stays the active one even if a "simpatizante"
      // was also picked in this league (that one is reachable from its crest).
      state.fav = state.main;
      state.favSource = "main";
    } else if (leagueFav?.id) {
      state.fav = leagueFav;
      state.favSource = "league";
    } else if (state.main) {
      state.fav = state.main;
      state.favSource = "main";
    } else if (!L && myClubs()[0]) {
      // Outside a league (home, team and match pages) with only league picks: use the first.
      state.fav = myClubs()[0];
      state.favSource = myClubs()[0].kind;
    } else {
      state.fav = null;
      state.favSource = null;
    }
    state.needsLeaguePick = !!(L && state.model && state.main && !leagueFav?.id && !mainPlays && !state.dismissed[L]);
  }
  const HANDLE_W = 34;
  const sideWidth = (vw) => (vw >= 2560 ? 520 : vw >= 1920 ? 440 : 380);
  let dock, handle, lhandle, hstrip, hLeague, hTeam, hMine, hGear, sgear, spop, panel, displayEl, shadow;
  let mpill, fabs, livebtn, histbtn, calbar;

  function mount() {
    const host = el("div", { id: "pg-host" });
    shadow = host.attachShadow({ mode: "open" });
    handle = el("button", { class: "handle", "aria-label": "Mi equipo", onclick: toggle });
    // panel holds the re-rendered content, displayEl the live screen/window
    // readout (published by layout.js).
    panel = el("div");
    displayEl = el("div", { class: "display" });
    const settingsLink = el("button", { class: "link", text: "⚙ Mejoras (activar / desactivar)", onclick: toggleSettings });
    const side = el("aside", { class: "side" }, [
      el("div", { class: "side-inner" }, [panel, el("p", {}, [settingsLink]), displayEl]),
    ]);
    dock = el("div", { class: "dock", "data-open": "false" }, [handle, side]);
    // Mirror image of the dock: collapses the site's own left menu.
    lhandle = el("button", { class: "lhandle", onclick: toggleLeft }, [
      el("span", { class: "vlabel", text: "Menú" }),
      el("span", { class: "chev", text: "‹" }),
    ]);
    // Header strip: league + favorite team on the same line as the site logo.
    hLeague = el("div", { class: "hleague" });
    // With the side panel switched off the pill has nothing to open: show the switches.
    hTeam = el("button", {
      class: "hteam",
      onclick: () => (feat("dock") ? !state.open && toggle() : toggleSettings()),
    });
    hMine = el("div", { class: "hmine" });
    hGear = el("button", { class: "hgear", title: "Ajustes de mejoras", "aria-label": "Ajustes de mejoras", text: "⚙", onclick: toggleSettings });
    hstrip = el("div", { class: "hstrip", hidden: "" }, [hLeague, hMine]);

    // Settings: a gear next to my clubs in the top bar and, whenever that bar isn't
    // visible (phones, non-league pages, bar switched off), a fixed gear in the
    // corner so the switches are always reachable.
    sgear = el("button", { class: "sgear", title: "Ajustes de mejoras", "aria-label": "Ajustes de mejoras", text: "⚙", onclick: toggleSettings });
    spop = el("div", { class: "spop", role: "dialog", "aria-label": "Ajustes de mejoras", hidden: "" });
    wback = el("div", { class: "wback", hidden: "" });
    // Next-match chip (moves into the top bar when that is visible) and the corner
    // buttons: live-only filter and, on match pages, a shortcut to the history.
    mpill = el("button", { class: "mpill float", hidden: "", onclick: onPill });
    livebtn = el("button", {
      class: "fab livebtn",
      hidden: "",
      onclick: () => ((state.liveOnly = !state.liveOnly), syncLive()),
    });
    histbtn = el("button", {
      class: "fab histbtn",
      hidden: "",
      text: "📊 Historial del partido",
      onclick: toggle,
    });
    fabs = el("div", { class: "fabs", hidden: "" }, [livebtn, histbtn]);
    calbar = el("div", { class: "calbar", hidden: "", role: "group", "aria-label": "Filtros del calendario" });
    shadow.append(el("style", { text: CSS }), dock, lhandle, hstrip, sgear, spop, wback, mpill, fabs, calbar);

    document.documentElement.append(host);
    renderDisplayInfo(window.__pgLayout);
    document.addEventListener("pg-layout", (e) => {
      renderDisplayInfo(e.detail);
      syncDock();
      syncLeft();
      renderStrip();
    });
    // Close the settings with Escape or a click anywhere outside the extension UI.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !wback.hidden) closeOnboarding({ openPanel: !state.main });
      else if (e.key === "Escape" && !spop.hidden) spop.hidden = true;
    });
    document.addEventListener("mousedown", (e) => {
      if (!spop.hidden && !e.composedPath().includes(host)) spop.hidden = true;
    });
    // The header's width animates with the page padding; follow it.
    const header = document.querySelector("header");
    if (header) new ResizeObserver(positionStrip).observe(header);
  }

  // The league title and the favorite team are drawn over the site header,
  // right after its logo, so logo, league and team share one line. The
  // original title block is hidden by CSS while the strip is on (>= 768px,
  // league pages only). Position comes from the real header's geometry.
  function renderStrip() {
    if (!hstrip) return;
    const league = state.data?.league;
    const on = feat("strip") && !!league && window.innerWidth >= 768 && !!document.querySelector(".header__logo");
    hstrip.hidden = !on;
    sgear.hidden = on; // the bar carries its own gear when it is visible
    document.documentElement.dataset.pgStrip = on ? "on" : "off";
    if (!on) {
      floatPill();
      return;
    }
    mpill.classList.remove("float");
    const label = (caption, text) =>
      el("div", { class: "lbl" }, [el("small", { text: caption }), el("b", { text: text })]);

    hLeague.replaceChildren(
      el("img", { src: `https://api.promiedos.com.ar/images/league/${league.id}/1`, alt: "" }),
      label("Liga", league.name),
    );

    const top = state.fav && state.model ? teamStats(state.model, state.fav.id)[0] : null;
    if (state.needsLeaguePick) {
      // The main team isn't in this league: invite the user to pick a club here.
      hTeam.replaceChildren(el("span", { class: "ball", text: "⚽" }), label("Esta liga", "Elegí tu club"));
    } else {
      // replaceChildren would print a literal "null": drop the empty slots first.
      hTeam.replaceChildren(
        ...[
          state.fav ? null : el("span", { class: "ball", text: "⚽" }),
          label(
            state.favSource === "league" ? "Mi club en esta liga" : "Mi equipo",
            state.fav ? state.fav.name : "Elegí tu equipo",
          ),
          top ? el("span", { class: "chip", text: `${top.row.pos}º` }) : null,
          top ? el("span", { class: "chip", text: `${top.row.pts} pts` }) : null,
        ].filter(Boolean),
      );
    }
    hTeam.title = "Abrir mi equipo";

    // One crest per club I follow (main team marked with a star). Clicking one
    // shows that club's stats and, if it plays elsewhere, takes me to its league.
    const crests = myClubs().map((club) =>
      el(
        "button",
        {
          class: `hcrest${club.id === state.fav?.id ? " on" : ""}`,
          title: `${club.name}${club.league?.name ? ` · ${club.league.name}` : ""}`,
          "aria-label": `Ver ${club.name}`,
          onclick: () => goToClub(club),
        },
        [el("img", { src: crest(club.id), alt: "" }), club.kind === "main" ? el("i", { class: "star", text: "★" }) : null],
      ),
    );
    // Grey crests except the active one; hover shows colour (see .gray in the CSS).
    hMine.classList.toggle("gray", feat("gray"));
    hMine.replaceChildren(...crests, hTeam, mpill, hGear);
    positionStrip();
  }

  // Clicking one of my clubs shows its stats in the side panel. If the club plays
  // in the league on screen that's all; otherwise we go to the league it plays in
  // (the focus and the open panel are remembered across the page load).
  function goToClub(club) {
    state.focusId = club.id;
    const openPanel = feat("dock");
    if (openPanel) state.open = true;
    chrome.storage.local.set({ [FOCUS_KEY]: club.id, ...(openPanel ? { [OPEN_KEY]: true } : {}) });
    if (state.model?.teams.has(club.id)) {
      state.picking = false;
      resolveFav();
      refresh();
      syncDock();
      return;
    }
    const lg = club.league;
    const path = lg?.id && lg?.url_name ? `/league/${lg.url_name}/${lg.id}` : null;
    if (path) location.assign(`${location.origin}${path}`);
  }

  function positionStrip() {
    if (!hstrip || hstrip.hidden) return;
    const header = document.querySelector("header");
    const logo = document.querySelector(".header__logo");
    const box = document.querySelector(".header__container");
    if (!header || !logo || !box) return;
    const h = header.getBoundingClientRect();
    const l = logo.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const padR = parseFloat(getComputedStyle(box).paddingRight) || 0;
    hstrip.style.top = `${h.top}px`;
    hstrip.style.height = `${h.height}px`;
    hstrip.style.left = `${l.right + 24}px`;
    hstrip.style.width = `${Math.max(0, b.right - padR - (l.right + 24))}px`;
  }

  // The site's left menu is hidden by CSS keyed on html[data-pg-left]; below
  // 768px it is the off-canvas phone menu, so the handle is not shown there.
  function syncLeft() {
    if (!lhandle) return;
    const on = feat("leftmenu");
    const docked = on && window.innerWidth >= 768;
    const collapsed = on && state.leftCollapsed; // switched off: the site's menu is always shown
    lhandle.hidden = !on;
    lhandle.dataset.collapsed = String(collapsed);
    lhandle.setAttribute("aria-expanded", String(!collapsed));
    lhandle.setAttribute("aria-label", collapsed ? "Mostrar menú lateral" : "Ocultar menú lateral");
    const root = document.documentElement;
    root.dataset.pgLeft = collapsed ? "collapsed" : "open";
    root.style.setProperty("--pg-left-w", `${docked ? HANDLE_W : 0}px`);
  }

  function toggleLeft() {
    state.leftCollapsed = !state.leftCollapsed;
    chrome.storage.local.set({ [LEFT_KEY]: state.leftCollapsed });
    syncLeft();
    syncDock(); // the room left for a pushed panel changed
  }

  // Keeps the dock, the --side-w variable and the page's right padding in sync.
  // The page is only pushed aside when the remaining width still fits the
  // two-column layout (>= 1201px); otherwise the panel overlays the content.
  function syncDock() {
    if (!dock) return;
    const on = feat("dock");
    const vw = window.innerWidth;
    const side = sideWidth(vw);
    const docked = on && vw >= 768;
    const open = on && state.open;
    const pushed = docked && open && vw - 2 * HANDLE_W - side >= 1201;
    dock.hidden = !on;
    dock.dataset.open = String(open);
    handle.setAttribute("aria-expanded", String(open));
    dock.style.setProperty("--side-w", `${side}px`);
    // Start the side panel below the sticky top bar so it never covers it.
    const bar = vw >= 768 ? document.querySelector("header")?.getBoundingClientRect().height || 0 : 0;
    dock.style.setProperty("--bar-h", `${on ? bar : 0}px`);
    const root = document.documentElement;
    root.dataset.pgDock = open ? "open" : "closed";
    root.style.setProperty("--pg-dock-w", `${docked ? HANDLE_W + (pushed ? side : 0) : 0}px`);
    // The settings card sits under the bar and beside the dock, never over it.
    spop.style.setProperty("--bar-h", `${bar}px`);
    mpill.style.setProperty("--bar-h", `${bar}px`);
    mpill.dataset.dock = String(open); // the open panel already shows the same match
    calbar.style.setProperty("--bar-h", `${bar}px`);
    spop.style.setProperty("--dock-off", `${docked ? HANDLE_W + (open ? side : 0) : 0}px`);
  }

  /* ---------- settings: on/off switches for every improvement ---------- */

  const FEATURES = [
    { key: "theme", label: "Tema oscuro y tablas modernas", hint: "Colores, tablas, tarjetas y cabecera rediseñados." },
    { key: "ads", label: "Ocultar publicidad", hint: "Quita los banners publicitarios." },
    { key: "layout", label: "Diseño adaptable", hint: "Se acomoda a la pantalla: tablas en columnas y partidos siempre a la vista." },
    { key: "crests", label: "Escudos mejorados", hint: "Borde claro y sombra para que se vean bien, y efecto al pasar el mouse." },
    { key: "strip", label: "Barra superior con liga y mis clubes", hint: "La liga y los escudos de tus clubes en la cabecera." },
    { key: "gray", label: "Escudos en gris, salvo el activo", hint: "Solo el club elegido va a color; los demás se colorean al pasar el mouse." },
    { key: "highlight", label: "Resaltar mi equipo", hint: "Marca a tu club en las tablas y en los partidos." },
    { key: "dock", label: "Panel “Mi equipo”", hint: "Barra lateral derecha con estadísticas, redes y noticias." },
    { key: "news", label: "Noticias del club", hint: "Notas de la semana dentro del panel." },
    { key: "socials", label: "Redes oficiales", hint: "Enlaces oficiales del club dentro del panel." },
    { key: "leftmenu", label: "Minimizar el menú izquierdo", hint: "Botón para ocultar el menú lateral del sitio." },
    { key: "match", label: "Próximo partido de mi equipo", hint: "Cuenta regresiva, rival y últimos resultados de tu club, en cualquier página." },
    { key: "live", label: "Filtro “Solo en vivo”", hint: "Botón para mostrar solo los partidos que se están jugando." },
    { key: "scenarios", label: "Simulador “¿Qué pasa si…?”", hint: "Cómo queda tu equipo en la tabla si gana, empata o pierde su próximo partido." },
    { key: "calendar", label: "Filtros del calendario", hint: "En el calendario: solo tus equipos, una liga o sin cumpleaños." },
    { key: "history", label: "Historial del partido", hint: "En cada partido: últimos resultados, antecedentes entre ambos y dónde verlo." },
  ];

  // Only disabled features are stored (state.features[key] === false).
  function feat(key) {
    return state.features[key] !== false;
  }

  function applyOffAttr() {
    const off = FEATURES.filter((f) => !feat(f.key)).map((f) => f.key);
    document.documentElement.dataset.pgOff = off.join(" ");
  }

  // Re-applies everything that depends on the switches, live, without a reload.
  function applyFeatures() {
    applyOffAttr();
    refresh(); // launcher, top bar, highlight, panel
    syncDock();
    syncLeft();
    renderSettings();
  }

  function setFeature(key, value) {
    if (value) delete state.features[key];
    else state.features[key] = false;
    store.setMap(FEATURES_KEY, state.features);
    applyFeatures();
  }

  function setAllFeatures(value) {
    state.features = value ? {} : Object.fromEntries(FEATURES.map((f) => [f.key, false]));
    store.setMap(FEATURES_KEY, state.features);
    applyFeatures();
  }

  // Copies text on a user click; the button label confirms it. The alias stays
  // visible as text too, so it can be selected by hand if the clipboard is blocked.
  async function copyWithFeedback(button, text, doneLabel) {
    const original = button.textContent;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // Older/blocked clipboard API: try the legacy command from a hidden field.
      const field = document.createElement("textarea");
      field.value = text;
      field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      shadow.append(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      field.remove();
    }
    button.textContent = copied ? doneLabel : "Seleccioná y copiá";
    setTimeout(() => (button.textContent = original), 1800);
  }

  function coffeeBox() {
    const hasUrl = typeof DONATE.url === "string" && DONATE.url.startsWith("https://");
    if (!DONATE.alias && !hasUrl) return null;
    const copyBtn = (label, value, done) => {
      const b = el("button", { class: "copy", text: label });
      b.addEventListener("click", () => copyWithFeedback(b, value, done));
      return b;
    };
    // With a payment link the whole yellow button is one click; the alias/CVU copy
    // buttons stay below as the alternative for people who prefer to transfer.
    const title = hasUrl
      ? el("a", { class: "coffeetitle coffeelink", href: DONATE.url, target: "_blank", rel: "noopener noreferrer", text: "☕ Invitame un café" })
      : el("b", { class: "coffeetitle", text: "☕ Invitame un café" });
    return el("div", { class: "coffeebox" }, [
      title,
      el("small", { text: "Si la extensión te sirve, podés apoyar su desarrollo. Es opcional." }),
      DONATE.alias
        ? el("div", { class: "coffeeacc" }, [
            el("span", { text: `${hasUrl ? "O transferí por " : ""}${DONATE.service} · alias ` }),
            el("code", { text: DONATE.alias }),
          ])
        : null,
      el("div", { class: "coffeebtns" }, [
        DONATE.alias ? copyBtn("Copiar alias", DONATE.alias, "¡Alias copiado!") : null,
        DONATE.cvu ? copyBtn("Copiar CVU", DONATE.cvu, "¡CVU copiado!") : null,
      ]),
    ]);
  }

  function toggleSettings() {
    spop.hidden = !spop.hidden;
    if (!spop.hidden) renderSettings();
  }

  function renderSettings() {
    if (!spop) return;
    const row = (f) => {
      const on = feat(f.key);
      const sw = el("button", {
        class: `sw${on ? " on" : ""}`,
        role: "switch",
        "aria-checked": String(on),
        "aria-label": f.label,
        onclick: () => setFeature(f.key, !feat(f.key)),
      }, [el("span", { class: "knob" })]);
      return el("li", { class: "srow" }, [
        el("div", { class: "stxt" }, [el("b", { text: f.label }), el("small", { text: f.hint })]),
        el("div", { class: "sctl" }, [sw, el("span", { class: `sstate ${on ? "on" : "off"}`, text: on ? "Activada" : "Desactivada" })]),
      ]);
    };
    // Where preferences are kept: the Google account (chrome.storage.sync) or only here.
    const canSync = syncAvailable();
    const syncOn = state.sync && canSync;
    const syncSwitch = el("button", {
      class: `sw${syncOn ? " on" : ""}`,
      role: "switch",
      "aria-checked": String(syncOn),
      "aria-label": "Guardar mis preferencias en mi cuenta de Google",
      onclick: () => setSync(!state.sync),
    }, [el("span", { class: "knob" })]);
    if (!canSync) syncSwitch.disabled = true;
    const syncRow = el("div", { class: "srow syncrow" }, [
      el("div", { class: "stxt" }, [
        el("b", { text: "Guardar mis preferencias en mi cuenta de Google" }),
        el("small", {
          text: !canSync
            ? "No disponible en este navegador."
            : syncOn
              ? "Tus clubes y ajustes te siguen en cada Chrome donde inicies sesión (con la sincronización de Chrome activada)."
              : "Se guardan solo en este navegador.",
        }),
        state.syncError ? el("small", { class: "err", text: `No se pudo sincronizar: ${state.syncError}` }) : null,
      ]),
      el("div", { class: "sctl" }, [syncSwitch, el("span", { class: `sstate ${syncOn ? "on" : "off"}`, text: syncOn ? "Activada" : "Desactivada" })]),
    ]);
    spop.replaceChildren(
      el("div", { class: "shead" }, [
        el("b", { text: "Mejoras de la extensión" }),
        el("button", { class: "link", text: "Cerrar", onclick: () => (spop.hidden = true) }),
      ]),
      syncRow,
      el("ul", { class: "slist" }, FEATURES.map(row)),
      el("div", { class: "sfoot" }, [
        el("button", { class: "link", text: "Activar todas", onclick: () => setAllFeatures(true) }),
        state.model?.teams.size
          ? el("button", { class: "link", text: "Ver bienvenida", onclick: () => ((spop.hidden = true), startOnboarding()) })
          : null,
        el("button", { class: "link", text: "Desactivar todas", onclick: () => setAllFeatures(false) }),
      ]),
      coffeeBox(),
    );
  }

  function renderDisplayInfo(i) {
    if (!i || !displayEl) return;
    displayEl.textContent =
      `Pantalla ${i.screen.w}×${i.screen.h} @${i.dpr}x · ` +
      `Ventana ${i.window.w}×${i.window.h}${i.maximized ? " (maximizada)" : ""} · ` +
      `Vista ${i.viewport.w}×${i.viewport.h} · ${i.tier.toUpperCase()} · ${i.input === "touch" ? "táctil" : "mouse"}`;
  }

  function toggle() {
    state.open = !state.open;
    chrome.storage.local.set({ [OPEN_KEY]: state.open });
    syncDock();
    syncLive();
  }

  function renderLauncher() {
    handle.replaceChildren(
      state.fav ? el("img", { src: crest(state.fav.id), alt: "" }) : el("span", { text: "⚽" }),
      el("span", { class: "vlabel", text: state.fav ? state.fav.short_name || state.fav.name : "Mi equipo" }),
      el("span", { class: "chev", text: "‹" }),
    );
  }

  function statBox(value, label) {
    return el("div", { class: "stat" }, [el("b", { text: value }), el("span", { text: label })]);
  }
  const f1 = (n) => (Number.isFinite(n) ? n.toFixed(2) : "–");

  function renderSearch() {
    const input = el("input", { type: "search", placeholder: "Buscá tu equipo…", "aria-label": "Buscar equipo" });
    const sugg = el("div", { class: "sugg" });
    const teams = state.model ? [...state.model.teams.values()].sort((a, b) => a.name.localeCompare(b.name)) : [];

    const draw = () => {
      const q = norm(input.value);
      const matches = teams
        .filter((t) => !q || norm(t.name).includes(q) || norm(t.short_name).includes(q))
        .slice(0, 30);
      sugg.replaceChildren(
        ...matches.map((t) =>
          el("button", { onclick: () => selectTeam(t) }, [
            el("img", { src: crest(t.id), alt: "" }),
            el("span", { text: t.name }),
          ]),
        ),
      );
      if (!matches.length) sugg.append(el("div", { class: "muted", text: "Sin resultados" }));
    };
    input.addEventListener("input", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sugg.querySelector("button")?.click();
    });
    draw();
    return el("section", {}, [input, sugg]);
  }

  /* ---------- my matches: next game, countdown, live filter, history ---------- */

  const GAMES_TTL = 10 * 60 * 1000;
  const LIVE_TTL = 60 * 1000;
  const gamesCache = new Map(); // club id -> { at, data }
  const gamesPending = new Map();

  function pagePropsFrom(html) {
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    try {
      return m ? JSON.parse(m[1]).props.pageProps : null;
    } catch {
      return null;
    }
  }

  // Same-origin page fetch: the site's own data, nothing leaves promiedos.com.ar.
  async function fetchPageProps(path) {
    try {
      const res = await fetch(path, { credentials: "omit" });
      return res.ok ? pagePropsFrom(await res.text()) : null;
    } catch {
      return null;
    }
  }

  // "20-10-2026 21:30" is Argentina time (UTC-3, no DST).
  function parseStart(s) {
    const m = /^(\d\d)-(\d\d)-(\d{4}) (\d\d):(\d\d)/.exec(s || "");
    return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`) : null;
  }

  function normGame(g, clubId) {
    if (!g?.id || !Array.isArray(g.teams)) return null;
    const home = g.teams[0]?.id === clubId;
    const sc = Array.isArray(g.scores) ? g.scores : null;
    return {
      id: g.id,
      url: g.url_name,
      opp: g.teams.find((t) => t.id !== clubId) || g.teams[1],
      home,
      at: parseStart(g.start_time),
      live: g.status?.enum === 2,
      done: g.status?.enum === 3,
      minute: g.game_time_to_display || g.status?.name || "",
      mine: sc ? (home ? sc[0] : sc[1]) : null,
      theirs: sc ? (home ? sc[1] : sc[0]) : null,
      round: g.stage_round_name || "",
    };
  }

  // The club's schedule from its own team page: upcoming (soonest first) and
  // played (latest first). Cached, and refreshed every minute while a game is live.
  function loadTeamGames(club) {
    const hit = gamesCache.get(club.id);
    const ttl = hit?.data?.next.some((g) => g.live) ? LIVE_TTL : GAMES_TTL;
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
    if (gamesPending.has(club.id)) return gamesPending.get(club.id);
    const url = `/team/${encodeURIComponent(club.url_name || "equipo")}/${encodeURIComponent(club.id)}`;
    const p = fetchPageProps(url).then((props) => {
      const games = props?.data?.games;
      const rows = (part) => (games?.[part]?.rows || []).map((r) => normGame(r.game, club.id)).filter((g) => g?.at);
      const data = games ? { next: rows("next").sort((a, b) => a.at - b.at), last: rows("last").sort((a, b) => b.at - a.at) } : null;
      // A failed lookup is retried after a minute instead of waiting out the TTL.
      gamesCache.set(club.id, { at: data ? Date.now() : Date.now() - GAMES_TTL + 60000, data });
      gamesPending.delete(club.id);
      return data;
    });
    gamesPending.set(club.id, p);
    return p;
  }

  const nextOf = (data) => data?.next.find((g) => g.live) || data?.next.find((g) => !g.done) || null;
  const shortName = (t) => t?.short_name || t?.name || "";
  const resultOf = (g) => (g.mine > g.theirs ? "w" : g.mine < g.theirs ? "l" : "d");
  const RESULT_LETTER = { w: "V", d: "E", l: "D" };
  const dateShort = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

  function whenLabel(d) {
    const now = new Date();
    const hm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
    if (d.toDateString() === now.toDateString()) return `Hoy ${hm}`;
    if (d.toDateString() === new Date(now.getTime() + 864e5).toDateString()) return `Mañana ${hm}`;
    return `${d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" })} ${hm}`;
  }

  function countdownText(ms) {
    if (ms <= 0) return "¡Ya empieza!";
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${Math.max(1, m)} min`;
  }

  const gameHref = (g) => `/game/${g.url}/${g.id}`;

  // Compact chip with the next match of the active club. Lives in the top bar when
  // that is visible and floats in the corner everywhere else (home, team, game pages).
  async function renderPill() {
    if (!mpill) return;
    const club = state.fav;
    if (!feat("match") || !club) {
      mpill.hidden = true;
      return;
    }
    const data = await loadTeamGames(club);
    if (state.fav?.id !== club.id) return;
    const g = nextOf(data);
    if (!g) {
      mpill.hidden = true;
      return;
    }
    const opp = shortName(g.opp);
    mpill.hidden = false;
    mpill.classList.toggle("live", g.live);
    mpill.title = `${club.name} vs ${g.opp.name}`;
    mpill.replaceChildren(
      g.live ? el("span", { class: "dot" }) : el("span", { class: "clock", text: "⏱" }),
      el("span", { class: "mtxt" }, [
        el("small", { text: g.live ? `En vivo · ${g.minute}` : `${whenLabel(g.at)} · vs ${opp}` }),
        g.live
          ? el("b", { text: `${shortName(club)} ${g.mine ?? 0}-${g.theirs ?? 0} ${opp}` })
          : el("b", { class: "cd", "data-at": String(g.at.getTime()), text: countdownText(g.at - Date.now()) }),
      ]),
    );
  }

  function onPill() {
    if (feat("dock")) {
      if (!state.open) toggle();
      return;
    }
    const g = nextOf(gamesCache.get(state.fav?.id)?.data);
    if (g) location.assign(gameHref(g));
  }

  function floatPill() {
    if (!mpill) return;
    mpill.classList.add("float");
    if (mpill.parentNode !== shadow) shadow.append(mpill);
  }

  let tickCount = 0;
  let lastKickoffRefresh = 0;
  function tick() {
    if (!shadow) return;
    let kickoff = false;
    shadow.querySelectorAll("[data-at]").forEach((n) => {
      const ms = Number(n.dataset.at) - Date.now();
      n.textContent = countdownText(ms);
      if (ms <= 0) kickoff = true;
    });
    // At kickoff the schedule changes (the game turns live): refetch once a minute.
    if (kickoff && Date.now() - lastKickoffRefresh > 60000) {
      lastKickoffRefresh = Date.now();
      gamesCache.clear();
      renderPill();
    } else if (++tickCount % 3 === 0) {
      renderPill(); // cached; only goes to the network while a game is live
    }
  }

  function gameCard(g) {
    return el("a", { class: `gcard${g.live ? " live" : ""}`, href: gameHref(g) }, [
      el("img", { src: crest(g.opp.id), alt: "" }),
      el("div", {}, [
        el("b", { text: g.opp.name }),
        el("small", { text: `${g.home ? "Local" : "Visitante"}${g.round ? ` · ${g.round}` : ""}` }),
      ]),
      el("div", { class: "gright" }, [
        g.live
          ? el("b", { text: `${g.mine ?? 0}-${g.theirs ?? 0}` })
          : el("b", { class: "cd", "data-at": String(g.at.getTime()), text: countdownText(g.at - Date.now()) }),
        el("small", { text: g.live ? `En vivo · ${g.minute}` : whenLabel(g.at) }),
      ]),
    ]);
  }

  function resultRow(g) {
    const r = resultOf(g);
    return el("a", { class: "rrow", href: gameHref(g) }, [
      el("i", { class: r, text: RESULT_LETTER[r] }),
      el("span", { text: `${dateShort(g.at)} · ${g.home ? "vs" : "en"} ${shortName(g.opp)}` }),
      el("span", { class: "sc", text: `${g.mine}-${g.theirs}` }),
    ]);
  }

  // Next game with countdown, the games after it and the last five results.
  function matchSection(club) {
    const box = el("div", { class: "mbox" });
    const next = el("section", {}, [el("h3", { text: "Próximo partido" }), el("p", { class: "muted", text: "Cargando…" })]);
    box.append(next);
    loadTeamGames(club).then((data) => {
      const g = nextOf(data);
      next.replaceChildren(el("h3", { text: g?.live ? "En vivo ahora" : "Próximo partido" }));
      if (g) next.append(gameCard(g));
      else next.append(el("p", { class: "muted", text: data ? "No hay partidos programados." : "No pude traer los partidos ahora." }));
      const later = (data?.next || []).filter((x) => x !== g && !x.done).slice(0, 3);
      if (later.length) {
        later.forEach((x) =>
          next.append(
            el("a", { class: "rrow", href: gameHref(x) }, [
              el("span", { class: "muted", text: dateShort(x.at) }),
              el("span", { text: `${x.home ? "vs" : "en"} ${shortName(x.opp)}` }),
              el("span", { class: "sc muted", text: whenLabel(x.at).split(" ").pop() }),
            ]),
          ),
        );
      }
      const last = (data?.last || []).slice(0, 5);
      if (last.length) box.append(el("section", {}, [el("h3", { text: "Últimos partidos" }), ...last.map(resultRow)]));
    });
    return box;
  }

  // Match page: what the site dropped from view but still ships in its data —
  // recent form of both teams, head-to-head record and TV channels.
  const FORM_CLASS = { 1: "w", 2: "d", 0: "l" };
  const FORM_LETTER = { 1: "V", 2: "E", 0: "D" };

  function formRow(team, results) {
    return el("div", { class: "frow" }, [
      el("img", { src: crest(team.id), alt: "" }),
      el("span", { class: "n", text: shortName(team) }),
      el(
        "div",
        { class: "form" },
        (results || []).slice(0, 5).map((x) => el("i", { class: FORM_CLASS[x] || "l", text: FORM_LETTER[x] ?? "–" })),
      ),
    ]);
  }

  function historySection(gm) {
    const [home, away] = gm.teams || [];
    if (!home || !away) return null;
    const sec = el("section", { class: "hist" }, [
      el("h3", { text: "Historial del partido" }),
      el("div", { class: "hvs" }, [
        el("img", { src: crest(home.id), alt: "" }),
        el("b", { text: `${shortName(home)} vs ${shortName(away)}` }),
        el("img", { src: crest(away.id), alt: "" }),
      ]),
    ]);
    const tv = (gm.game_info || []).find((r) => /tv/i.test(r.name) && r.value);
    if (tv) sec.append(el("p", { class: "tvline", text: `📺 Dónde verlo: ${tv.value}` }));
    (gm.game_info || [])
      .filter((r) => /estadio|árbitro|arbitro/i.test(r.name) && r.value)
      .forEach((r) => sec.append(el("p", { class: "note", text: `${r.name}: ${r.value}` })));

    if (gm.recent_form) {
      sec.append(
        el("h3", { class: "sub", text: "Últimos 5 partidos (el más reciente primero)" }),
        formRow(home, gm.recent_form.home),
        formRow(away, gm.recent_form.away),
      );
    }

    const h = gm.head_to_head;
    const played = (h?.games || []).filter((x) => x.status?.enum === 3 && Array.isArray(x.scores));
    if (played.length) {
      const total = (h.home_wins || 0) + (h.draws || 0) + (h.away_wins || 0) || 1;
      const seg = (cls, n) => el("span", { class: cls, style: `width:${(100 * (n || 0)) / total}%`, title: String(n || 0) });
      sec.append(
        el("h3", { class: "sub", text: `Antecedentes (últimos ${played.length})` }),
        el("div", { class: "h2h" }, [seg("a", h.home_wins), seg("x", h.draws), seg("b", h.away_wins)]),
        el("div", { class: "h2hlab" }, [
          el("span", { text: `${shortName(home)} ${h.home_wins || 0}` }),
          el("span", { text: `Empates ${h.draws || 0}` }),
          el("span", { text: `${shortName(away)} ${h.away_wins || 0}` }),
        ]),
      );
      played.slice(0, 5).forEach((x) => {
        const [a, b] = x.teams;
        const d = parseStart(x.start_time);
        sec.append(
          el("a", { class: "rrow", href: `/game/${x.url_name}/${x.id}` }, [
            el("span", { class: "muted", text: d ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "" }),
            el("span", { text: `${shortName(a)} ${x.scores[0]}-${x.scores[1]} ${shortName(b)}` }),
            el("span", { class: "sc muted", text: x.league?.name?.replace(/^Liga Profesional.*/, "LPF") || "" }),
          ]),
        );
      });
    }
    return sec;
  }

  // "Solo en vivo": hides every game row that isn't being played, and the league
  // blocks left empty. Live rows carry the site's own time_live element.
  const gameLinks = () => [...document.querySelectorAll('a[href^="/game/"]')];
  const isLiveLink = (a) => !!a.querySelector('[class*="time_live"]');

  function syncLive() {
    if (!livebtn) return;
    const links = gameLinks();
    const show = feat("live") && links.length > 0;
    const live = links.filter(isLiveLink);
    const on = show && state.liveOnly;
    document.querySelectorAll(".pg-nolive").forEach((n) => n.classList.remove("pg-nolive"));
    if (on) {
      links.filter((a) => !isLiveLink(a)).forEach((a) => {
        let top = a;
        for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
          const inside = p.querySelectorAll('a[href^="/game/"]');
          if (inside.length === links.length && live.length) break; // the whole page, keep it
          if (![...inside].every((x) => !isLiveLink(x))) break;
          top = p;
        }
        top.classList.add("pg-nolive");
      });
    }
    document.documentElement.dataset.pgLiveOnly = on ? "on" : "off";
    livebtn.hidden = !show;
    livebtn.classList.toggle("on", on);
    const count = live.length;
    livebtn.replaceChildren(
      el("span", { class: "dot" }),
      el("span", {
        text: on
          ? count
            ? `Solo en vivo (${count}) · ver todos`
            : "Sin partidos en vivo · ver todos"
          : count
            ? `Solo en vivo (${count})`
            : "Solo en vivo",
      }),
    );
    histbtn.hidden = !(state.game && feat("history") && !state.open);
    fabs.hidden = livebtn.hidden && histbtn.hidden;
  }

  // Calendar (/calendario): filter the week by my clubs, by league, and hide the
  // birthdays and anniversaries. Group = a league label plus its games; rows are
  // hidden with .pg-calhide (see content.css).
  const CAL_KEY = "pgCal";
  const onCalendar = () => location.pathname.replace(/\/$/, "") === "/calendario";
  let calSig = "";

  function setCal(patch) {
    Object.assign(state.cal, patch);
    chrome.storage.local.set({ [CAL_KEY]: state.cal });
    calSig = "";
    syncCalendar();
  }

  function syncCalendar() {
    if (!calbar) return;
    document.querySelectorAll(".pg-calhide").forEach((n) => n.classList.remove("pg-calhide"));
    const on = feat("calendar") && onCalendar();
    calbar.hidden = !on;
    if (!on) return;

    const groups = [...document.querySelectorAll('[class*="calendario-item_content"] [class*="label_block"]')].map((label) => ({
      group: label.parentElement,
      name: label.textContent.trim(),
      extra: /cumplea|aniversario/i.test(label.textContent),
    }));
    const leagues = [...new Set(groups.filter((g) => !g.extra).map((g) => g.name))].sort((a, b) => a.localeCompare(b));
    const cal = state.cal;
    const league = leagues.includes(cal.league) ? cal.league : "all"; // not on this week's calendar: show all
    const mine = new Set(myClubs().map((c) => c.url_name).filter(Boolean));
    const isMine = (tile) => (tile.getAttribute("href") || "").split("/")[2]?.split("-vs-").some((s) => mine.has(s));

    let shown = 0;
    groups.forEach(({ group, name, extra }) => {
      let hide = extra ? !cal.extras || (cal.mine && mine.size > 0) || league !== "all" : league !== "all" && name !== league;
      if (!hide && !extra) {
        const tiles = [...group.querySelectorAll('a[href^="/game/"]')];
        if (cal.mine && mine.size) tiles.filter((t) => !isMine(t)).forEach((t) => t.classList.add("pg-calhide"));
        const visible = tiles.filter((t) => !t.classList.contains("pg-calhide")).length;
        hide = visible === 0;
        shown += visible;
      }
      if (hide) group.classList.add("pg-calhide");
    });

    // Rebuild the bar only when something it shows changed (keeps an open select alive).
    const sig = [leagues.join("|"), cal.mine, league, cal.extras, mine.size, shown].join(";");
    if (sig === calSig) return;
    calSig = sig;
    const toggle = (label, active, onclick, disabled) => {
      const b = el("button", { class: `fab${active ? " on" : ""}`, "aria-pressed": String(active), text: label, onclick });
      if (disabled) b.disabled = true;
      return b;
    };
    const select = el(
      "select",
      { class: "calsel", "aria-label": "Filtrar por liga", onchange: (e) => setCal({ league: e.target.value }) },
      [el("option", { value: "all", text: "Todas las ligas" }), ...leagues.map((l) => el("option", { value: l, text: l }))],
    );
    select.value = league;
    calbar.replaceChildren(
      toggle(mine.size ? "⭐ Solo mis equipos" : "⭐ Elegí un equipo primero", cal.mine && mine.size > 0, () => setCal({ mine: !cal.mine }), !mine.size),
      select,
      toggle("🎂 Cumpleaños", cal.extras, () => setCal({ extras: !cal.extras })),
      el("span", { class: "calcount", text: `${shown} ${shown === 1 ? "partido" : "partidos"}` }),
    );
  }

  // "What if": the table after my next league game ends in a win, a draw or a loss,
  // by points only (tie-breakers aren't simulated). A league game is one called
  // "Fecha N" against a club of the same table; cups use other round names.
  function projectScenarios(rows, myId, oppId) {
    const me = rows.find((r) => r.team.id === myId);
    const opp = rows.find((r) => r.team.id === oppId);
    if (!me || !opp) return null;
    const below = rows.find((r) => r.pos === me.pos + 1);
    const standing = (pts) => {
      const mine = pts.get(myId);
      let better = 0;
      let tied = 0;
      pts.forEach((p, id) => {
        if (id === myId) return;
        if (p > mine) better++;
        else if (p === mine) tied++;
      });
      return { pts: mine, pos: better + 1, tied };
    };
    const base = new Map(rows.map((r) => [r.team.id, r.pts]));
    return [
      { key: "w", letter: "V", label: "Si ganás", mine: 3, theirs: 0 },
      { key: "d", letter: "E", label: "Si empatás", mine: 1, theirs: 1 },
      { key: "l", letter: "D", label: "Si perdés", mine: 0, theirs: 3 },
    ].map((o) => {
      const pts = new Map(base);
      pts.set(myId, base.get(myId) + o.mine);
      pts.set(oppId, base.get(oppId) + o.theirs);
      const out = { ...o, now: standing(pts), belowTeam: null, ifBelow: null };
      // The club right under me also wins: only meaningful when it isn't my rival.
      if (below && below.team.id !== oppId) {
        const alt = new Map(pts);
        alt.set(below.team.id, alt.get(below.team.id) + 3);
        out.belowTeam = below.team;
        out.ifBelow = standing(alt);
      }
      return out;
    });
  }

  const standingLabel = (s) => `${s.pos}º${s.tied ? ` (igualado con ${s.tied})` : ""}`;

  function scenarioSection(s, team) {
    const rows = state.model?.tables.find((t) => t.label === s.label)?.rows;
    const sec = el("section", {}, [el("h3", { text: "¿Qué pasa si…?" }), el("p", { class: "muted", text: "Calculando…" })]);
    if (!rows) return null;
    loadTeamGames(team).then((data) => {
      const g = data?.next.find((x) => !x.done && /^Fecha \d+/i.test(x.round) && rows.some((r) => r.team.id === x.opp?.id));
      const result = g && projectScenarios(rows, team.id, g.opp.id);
      if (!result) {
        sec.remove();
        return;
      }
      sec.replaceChildren(
        el("h3", { text: "¿Qué pasa si…?" }),
        el("p", { class: "muted", text: `${g.round} · ${g.home ? "vs" : "en"} ${g.opp.name}` }),
        ...result.map((o) =>
          el("div", { class: "scn" }, [
            el("i", { class: o.key, text: o.letter }),
            el("span", { class: "scnt" }, [
              el("b", { text: `${o.label}: ${o.now.pts} pts · ${standingLabel(o.now)}` }),
              o.ifBelow ? el("small", { text: `Si ${shortName(o.belowTeam)} también gana: ${standingLabel(o.ifBelow)}` }) : null,
            ]),
          ]),
        ),
        el("p", { class: "note", text: "Estimación por puntos; no incluye desempates ni otros resultados de la fecha." }),
      );
    });
    return sec;
  }

  async function renderPanel() {
    panel.replaceChildren();
    const league = state.data?.league;
    if (state.game && feat("history")) {
      const hist = historySection(state.game);
      if (hist) panel.append(hist);
    }
    if (!state.model) {
      // Home, team and match pages carry no league data, but the club is still known.
      const club = state.fav;
      if (!club) {
        panel.append(
          el("h3", { text: "Elegí tu equipo" }),
          el("p", { class: "muted", text: "Entrá a una liga y elegí tu club: lo vas a ver acá en todas las páginas." }),
          el("button", { class: "go", text: "Ir a la Liga Profesional", onclick: () => location.assign("/league/liga-profesional/hc") }),
        );
        return;
      }
      const lg = club.league;
      panel.append(
        el("div", { class: "hero" }, [
          el("img", { src: crest(club.id), alt: "" }),
          el("div", {}, [el("b", { text: club.name }), el("span", { text: "Tu equipo" })]),
          el("div", { class: "acts" }, [
            el("button", {
              class: "link",
              text: "Cambiar",
              onclick: () => location.assign(`/league/${lg?.url_name || "liga-profesional"}/${lg?.id || "hc"}`),
            }),
          ]),
        ]),
      );
      if (feat("match")) panel.append(matchSection(club));
      const socials = feat("socials") ? socialsSection(club) : null;
      if (socials) panel.append(socials);
      await appendNews(club);
      return;
    }
    const clubs = myClubs();
    if (clubs.length > 1 && !state.picking) {
      panel.append(
        el(
          "div",
          { class: "mine" },
          clubs.map((club) =>
            el("button", { class: club.id === state.fav?.id ? "on" : "", onclick: () => goToClub(club) }, [
              el("img", { src: crest(club.id), alt: "" }),
              el("span", {}, [
                el("span", { text: `${club.kind === "main" ? "★ " : ""}${club.short_name || club.name}` }),
                club.league?.name ? el("small", { text: club.league.name }) : null,
              ]),
            ]),
          ),
        ),
      );
    }
    if (state.picking || !state.fav) {
      // With a main team already set, this is a pick for this league only.
      const forLeague = !!state.main && !!league;
      panel.append(el("h3", { text: forLeague ? `Elegí un club de ${league.name}` : "Elegí tu equipo" }));
      if (forLeague) panel.append(el("p", { class: "muted", text: "Lo vamos a recordar solo para esta liga." }));
      panel.append(renderSearch());
      if (state.picking && state.fav) {
        panel.append(
          el("button", { class: "link", text: "Cancelar", onclick: () => ((state.picking = false), renderPanel()) }),
        );
      }
      return;
    }
    const team = state.fav;
    const fromLeague = state.favSource === "league";
    panel.append(
      el("div", { class: "hero" }, [
        el("img", { src: crest(team.id), alt: "" }),
        el("div", {}, [
          el("b", { text: team.name }),
          el("span", { text: fromLeague ? `Tu club en ${league?.name || "esta liga"}` : "Tu equipo" }),
        ]),
        el("div", { class: "acts" }, [
          el("button", { class: "link", onclick: changeTeam, text: "Cambiar" }),
          fromLeague ? el("button", { class: "link", onclick: removeLeagueFav, text: "Quitar" }) : null,
        ]),
      ]),
    );

    if (feat("match")) panel.append(matchSection(team));
    const stats = teamStats(state.model, team.id);
    if (state.needsLeaguePick) {
      panel.append(
        el("section", { class: "ask" }, [
          el("b", { text: `${team.short_name || team.name} no juega en ${league?.name || "esta liga"}` }),
          el("p", { text: "¿Querés elegir un club que te simpatice en esta liga? Lo vamos a recordar para esta liga." }),
          el("div", { class: "btns" }, [
            el("button", { class: "btn primary", onclick: startLeaguePick, text: "Elegir club" }),
            el("button", { class: "btn", onclick: dismissLeaguePick, text: "No, gracias" }),
          ]),
        ]),
      );
    } else if (!stats.length && state.model.teams.has(team.id)) {
      // On the league's "Equipos y estadísticas" tab: the club is here but the page
      // carries no standings. Point to the tab that has them.
      const lg = state.data?.league;
      panel.append(
        el("p", { class: "muted", text: "La posición y los puntos se ven en la pestaña “Fixture y tablas”." }),
        el("button", {
          class: "link",
          text: "Ir a Fixture y tablas",
          onclick: () => location.assign(`${location.origin}/league/${lg.url_name}/${lg.id}`),
        }),
      );
    } else if (!stats.length) {
      panel.append(
        el("p", { class: "muted", text: "Este club no juega en esta liga. Igual te dejo las noticias." }),
        el("button", { class: "link", onclick: startLeaguePick, text: "Elegir un club de esta liga" }),
      );
    }
    stats.forEach((s, i) => {
      const r = s.row;
      const sec = el("section", {}, [
        el("h3", { text: `${s.label} · ${r.pos}º de ${s.total}` }),
        el("div", { class: "grid" }, [
          statBox(r.pts, "Puntos"),
          statBox(r.gp, "Jugados"),
          statBox(`${r.w}-${r.d}-${r.l}`, "G-E-P"),
          statBox(Number.isFinite(r.gf) ? `${r.gf}:${r.gc}` : "–", "Goles"),
          statBox(Number.isFinite(s.efficiency) ? `${s.efficiency.toFixed(0)}%` : "–", "Efectividad"),
          statBox(f1(s.ppg), "Pts / partido"),
          statBox(f1(s.gfpg), "Goles a favor / PJ"),
          statBox(f1(s.gcpg), "Goles en contra / PJ"),
          statBox(s.attackRank ? `${s.attackRank}º / ${s.defenseRank}º` : "–", "Ataque / defensa"),
        ]),
        el(
          "div",
          { class: "form" },
          r.trend.slice(-5).map((x) =>
            el("i", { class: x === 1 ? "w" : x === 2 ? "d" : "l", text: x === 1 ? "V" : x === 2 ? "E" : "D" }),
          ),
        ),
      ]);
      panel.append(sec);
      if (i === 0) {
        panel.append(el("button", { class: "go", onclick: scrollToTeam, text: "Ir a mi equipo en la tabla" }));
        const what = feat("scenarios") ? scenarioSection(s, team) : null;
        if (what) panel.append(what);
        if (s.leaders) {
          panel.append(
            el("section", {}, [
              el("h3", { text: "Líderes de la tabla" }),
              el(
                "ul",
                {},
                s.leaders.map(([k, team, v]) =>
                  el("li", { class: "row" }, [el("span", { text: `${k}: ${team}` }), el("span", { text: v })]),
                ),
              ),
            ]),
          );
        }
      }
    });

    const socials = feat("socials") ? socialsSection(team) : null;
    if (socials) panel.append(socials);

    const players = playerHighlights(state.model, team.id);
    if (players.length) {
      panel.append(
        el("section", {}, [
          el("h3", { text: "Tus jugadores en los rankings" }),
          el(
            "ul",
            {},
            players.map((p) =>
              el("li", { class: "row" }, [
                el("span", { text: `${p.name} · ${p.stat}` }),
                el("span", { text: `#${p.rank} (${p.value})` }),
              ]),
            ),
          ),
        ]),
      );
    }

    await appendNews(team);
  }

  async function appendNews(team) {
    if (!feat("news")) return;
    const newsBox = el("section", {}, [el("h3", { text: "Noticias de la semana" }), el("p", { class: "muted", text: "Cargando…" })]);
    panel.append(newsBox);
    const news = await loadNews(team);
    newsBox.replaceChildren(el("h3", { text: "Noticias de la semana" }));
    if (!news?.length) {
      newsBox.append(el("p", { class: "muted", text: "No pude traer noticias ahora." }));
    } else {
      news.forEach((n) => {
        // Link text is external data: textContent only, and only http(s) hrefs.
        if (!/^https?:\/\//.test(n.link)) return;
        newsBox.append(
          el("a", { class: "news", href: n.link, target: "_blank", rel: "noopener noreferrer" }, [
            el("span", { text: n.title }),
            el("small", { text: `${n.source} · ${ago(n.date)}` }),
          ]),
        );
      });
    }
  }

  // Official links from socials.json. Only https URLs are rendered; clubs that
  // aren't in the file (other leagues) simply get no section.
  function socialsSection(team) {
    const entry = state.socials?.[team.id];
    if (!entry) return null;
    const NETWORKS = [
      ["ig", "Instagram"],
      ["x", "X"],
      ["fb", "Facebook"],
      ["yt", "YouTube"],
      ["tt", "TikTok"],
    ];
    const ok = (u) => typeof u === "string" && u.startsWith("https://");
    const handle = (u) => `@${new URL(u).pathname.split("/").filter(Boolean).pop().replace(/^@/, "")}`;
    const site = ok(entry.site) ? [["Sitio oficial", entry.site]] : [];
    const nets = [];
    for (const [key, name] of NETWORKS) {
      const urls = (entry[key] || []).filter(ok);
      urls.forEach((u) => nets.push([urls.length > 1 ? `${name} ${handle(u)}` : name, u]));
    }
    const chips = [...site, ...nets].map(([text, href]) =>
      el("a", { href, target: "_blank", rel: "noopener noreferrer", text }),
    );
    return el("section", {}, [
      el("h3", { text: "Redes oficiales" }),
      chips.length ? el("div", { class: "socials" }, chips) : null,
      el("p", {
        class: "note",
        text: nets.length
          ? "Enlaces tomados del sitio oficial del club."
          : "El sitio oficial del club no publica redes sociales.",
      }),
    ]);
  }

  async function loadNews(team) {
    if (!state.newsCache.has(team.id)) state.newsCache.set(team.id, await fetchNews(team.name));
    return state.newsCache.get(team.id);
  }

  function scrollToTeam() {
    document.querySelector("tr.pg-fav-row")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // What gets stored for a club: identity plus the league it was picked in, so a
  // crest click can take the user back to the stats and the league it plays in.
  function pickedClub(team) {
    const lg = state.data?.league;
    return {
      id: team.id,
      name: team.name,
      short_name: team.short_name,
      url_name: team.url_name,
      league: lg ? { id: lg.id, name: lg.name, url_name: lg.url_name } : null,
    };
  }

  // role: "hincha" sets the main club, "simpatizante" a club for this league only,
  // "auto" (the side-panel search) decides from the current state.
  function selectTeam(team, role = "auto") {
    const picked = pickedClub(team);
    state.focusId = picked.id;
    chrome.storage.local.set({ [FOCUS_KEY]: picked.id });
    const mainPlaysHere = !!state.main && !!state.model?.teams.has(state.main.id);
    const asMain = role === "hincha" || (role === "auto" && (!state.main || mainPlaysHere));
    if (asMain) {
      // First pick, or changing the main team from a league where it plays.
      state.main = picked;
      store.set(picked);
    } else {
      // The main team isn't in this league: remember a club for this league only.
      state.leagueFavs[state.leagueId] = picked;
      store.setMap(LEAGUE_KEY, state.leagueFavs);
      delete state.dismissed[state.leagueId];
      store.setMap(DISMISS_KEY, state.dismissed);
    }
    state.picking = false;
    resolveFav();
    refresh();
  }

  function changeTeam() {
    if (state.favSource === "league") {
      for (const [key, club] of Object.entries(state.leagueFavs)) {
        if (club.id === state.fav?.id) delete state.leagueFavs[key];
      }
      store.setMap(LEAGUE_KEY, state.leagueFavs);
    } else {
      state.main = null;
      store.clear();
    }
    state.focusId = null;
    state.picking = true;
    resolveFav();
    refresh();
  }

  // "No, gracias": stop asking in this league (can still be chosen from the panel).
  function dismissLeaguePick() {
    state.dismissed[state.leagueId] = true;
    store.setMap(DISMISS_KEY, state.dismissed);
    resolveFav();
    refresh();
  }

  // Drops the club chosen for this league and stops asking again here.
  function removeLeagueFav() {
    for (const [key, club] of Object.entries(state.leagueFavs)) {
      if (club.id === state.fav?.id) delete state.leagueFavs[key];
    }
    state.focusId = null;
    state.dismissed[state.leagueId] = true;
    store.setMap(LEAGUE_KEY, state.leagueFavs);
    store.setMap(DISMISS_KEY, state.dismissed);
    resolveFav();
    refresh();
  }

  function startLeaguePick() {
    state.picking = true;
    renderPanel();
  }

  function refresh() {
    renderLauncher();
    renderStrip();
    applyHighlight(state.fav);
    renderPanel();
    renderPill();
    syncLive();
    syncCalendar();
  }

  /* ---------- welcome: first-run onboarding ---------- */

  // Shown once, on a league page, to someone with no club yet: welcome → "hincha"
  // (main club) → optional "simpatizante" → done. ONBOARD_KEY is kept per browser.
  const ONBOARD_KEY = "pgOnboarded";
  const onboard = { step: 0, hincha: null, simp: null };
  let wback;

  function startOnboarding() {
    if (!state.model?.teams.size) return;
    Object.assign(onboard, { step: 0, hincha: null, simp: null });
    wback.hidden = false;
    renderOnboarding();
  }

  function closeOnboarding({ openPanel = false } = {}) {
    wback.hidden = true;
    chrome.storage.local.set({ [ONBOARD_KEY]: true });
    if (openPanel && feat("dock")) {
      state.open = true;
      chrome.storage.local.set({ [OPEN_KEY]: true });
      syncDock();
    }
  }

  function finishOnboarding() {
    if (onboard.hincha) selectTeam(onboard.hincha, "hincha");
    if (onboard.simp) selectTeam(onboard.simp, "simpatizante");
    // The hincha club stays the active one; the simpatizante is one click away.
    if (onboard.hincha) {
      state.focusId = onboard.hincha.id;
      chrome.storage.local.set({ [FOCUS_KEY]: onboard.hincha.id });
      resolveFav();
      refresh();
    }
    onboard.step = 3;
    chrome.storage.local.set({ [ONBOARD_KEY]: true });
    renderOnboarding();
  }

  // Grid of crests with a search box; `onPick` runs on click, selection is marked in place.
  function crestPicker(teams, selectedId, onPick) {
    const input = el("input", { type: "search", placeholder: "Buscar club…", "aria-label": "Buscar club" });
    const buttons = teams.map((t) => {
      const b = el("button", { class: `wteam${t.id === selectedId ? " on" : ""}`, title: t.name }, [
        el("img", { src: crest(t.id), alt: "" }),
        el("span", { text: t.short_name || t.name }),
      ]);
      b.addEventListener("click", () => {
        buttons.forEach(([, other]) => other.classList.remove("on"));
        b.classList.add("on");
        onPick(t);
      });
      return [t, b];
    });
    input.addEventListener("input", () => {
      const q = norm(input.value);
      buttons.forEach(([t, b]) => {
        b.hidden = !!q && !norm(t.name).includes(q) && !norm(t.short_name).includes(q);
      });
    });
    return el("div", { class: "wpicker" }, [input, el("div", { class: "wgrid" }, buttons.map(([, b]) => b))]);
  }

  function renderOnboarding() {
    const lg = state.data?.league;
    const teams = [...state.model.teams.values()].sort((a, b) => a.name.localeCompare(b.name));
    const dots = el("div", { class: "wdots", "aria-hidden": "true" }, [0, 1, 2, 3].map((i) => el("i", { class: i === onboard.step ? "on" : "" })));
    const skip = el("button", { class: "link wskip", text: "Saltar", onclick: () => closeOnboarding({ openPanel: !state.main }) });
    const primary = (text, onclick) => el("button", { class: "wbtn primary", text, onclick });
    const ghost = (text, onclick) => el("button", { class: "wbtn", text, onclick });
    const go = (step) => () => {
      onboard.step = step;
      renderOnboarding();
    };
    let body;

    if (onboard.step === 0) {
      body = [
        el("div", { class: "wlogo", text: "G" }),
        el("h2", { text: "¡Bienvenido a Glow para Promiedos!" }),
        el("p", { class: "wlead", text: "Hacé de Promiedos tu cancha: tu club primero y todo lo demás sin ruido." }),
        el("div", { class: "wperks" }, [
          el("span", { text: "⭐ Tu club en la barra" }),
          el("span", { text: "📊 Estadísticas y noticias" }),
          el("span", { text: "🌙 Tema oscuro" }),
        ]),
        el("div", { class: "wnav one" }, [primary("Empezar", go(1))]),
      ];
    } else if (onboard.step === 1) {
      const next = primary("Siguiente", go(2));
      next.disabled = !onboard.hincha;
      body = [
        el("h2", { text: "¿De qué club sos hincha?" }),
        el("p", { class: "wlead", text: `Elegí tu club del alma en ${lg?.name || "esta liga"}. Va a ser tu club principal y lo vas a ver siempre arriba.` }),
        crestPicker(teams, onboard.hincha?.id, (t) => {
          onboard.hincha = t;
          if (onboard.simp?.id === t.id) onboard.simp = null;
          next.disabled = false;
        }),
        el("p", { class: "whint", text: "¿Tu club juega en otra liga? Abrí esa liga más tarde y te lo vamos a preguntar ahí." }),
        el("div", { class: "wnav" }, [ghost("Atrás", go(0)), next]),
      ];
    } else if (onboard.step === 2) {
      const others = teams.filter((t) => t.id !== onboard.hincha?.id);
      const done = primary("Listo", finishOnboarding);
      done.disabled = !onboard.simp;
      body = [
        el("h2", { text: "¿Simpatizás con otro club?" }),
        el("p", { class: "wlead", text: "Es opcional. Sumá un club que te caiga bien y lo seguís con un toque desde la barra de arriba." }),
        crestPicker(others, onboard.simp?.id, (t) => {
          onboard.simp = t;
          done.disabled = false;
        }),
        el("div", { class: "wnav" }, [
          ghost("Atrás", go(1)),
          ghost("No, gracias", () => {
            onboard.simp = null;
            finishOnboarding();
          }),
          done,
        ]),
      ];
    } else {
      body = [
        el("div", { class: "wcrests" }, [
          onboard.hincha ? el("img", { class: "big", src: crest(onboard.hincha.id), alt: "" }) : null,
          onboard.simp ? el("img", { src: crest(onboard.simp.id), alt: "" }) : null,
        ]),
        el("h2", { text: onboard.hincha ? `¡Listo, ${onboard.hincha.short_name || onboard.hincha.name}!` : "¡Listo!" }),
        el("p", { class: "wlead", text: "Tocá su escudo en la barra de arriba para ver posición, goles y noticias. Con ⚙ prendés o apagás cada mejora." }),
        el("div", { class: "wnav one" }, [primary("Ver mi equipo", () => closeOnboarding({ openPanel: true }))]),
      ];
    }

    wback.replaceChildren(
      el("div", { class: "wcard", role: "dialog", "aria-modal": "true", "aria-label": "Bienvenida a Glow para Promiedos" }, [
        onboard.step < 3 ? skip : null,
        ...body,
        dots,
      ]),
    );
    wback.querySelector(".wbtn.primary:not([disabled]), .wteam, .wpicker input")?.focus({ preventScroll: true });
  }

  /* ---------- preferences storage (Google account sync) ---------- */

  const prefsSnapshot = () => JSON.stringify([state.main, state.leagueFavs, state.dismissed, state.features]);

  async function loadPrefs() {
    state.main = await store.get();
    state.leagueFavs = await store.getMap(LEAGUE_KEY);
    state.dismissed = await store.getMap(DISMISS_KEY);
    state.features = await store.getMap(FEATURES_KEY);
  }

  async function initPrefsStorage() {
    const flag = (await areaGet(chrome.storage.local, SYNC_FLAG))[SYNC_FLAG];
    state.sync = flag !== false && syncAvailable();
    if (!state.sync) return;
    // First run after the update, or a device that has local choices the account
    // doesn't know yet: lift them into the account (never overwriting what it has).
    const [inSync, inLocal] = await Promise.all([
      areaGet(chrome.storage.sync, SYNC_KEYS),
      areaGet(chrome.storage.local, SYNC_KEYS),
    ]);
    const lift = Object.fromEntries(SYNC_KEYS.filter((k) => !(k in inSync) && k in inLocal).map((k) => [k, inLocal[k]]));
    if (!Object.keys(lift).length) return;
    const err = await areaSet(chrome.storage.sync, lift);
    if (err) {
      state.syncError = err;
      state.sync = false; // e.g. quota exceeded: keep working locally
    } else {
      chrome.storage.local.remove(Object.keys(lift));
    }
  }

  // Switch from the settings card. Turning sync on keeps whatever the account
  // already has (another device may hold newer choices); turning it off copies the
  // account's values to this browser so nothing is lost.
  async function setSync(on) {
    if (on === state.sync || (on && !syncAvailable())) return;
    const from = prefsArea();
    const to = on ? chrome.storage.sync : chrome.storage.local;
    const [source, target] = await Promise.all([areaGet(from, SYNC_KEYS), areaGet(to, SYNC_KEYS)]);
    const copy = Object.fromEntries(Object.entries(source).filter(([k]) => !on || !(k in target)));
    const err = Object.keys(copy).length ? await areaSet(to, copy) : null;
    if (err) {
      state.syncError = err;
      renderSettings();
      return;
    }
    state.sync = on;
    state.syncError = null;
    chrome.storage.local.set({ [SYNC_FLAG]: on });
    await loadPrefs();
    resolveFav();
    applyFeatures();
  }

  /* ---------- boot ---------- */

  async function init() {
    state.data = readPageData();
    state.model = state.data ? buildModel(state.data) : null;
    state.game = readGameData();
    const savedCal = await new Promise((res) => chrome.storage.local.get(CAL_KEY, (r) => res(r[CAL_KEY])));
    if (savedCal && typeof savedCal === "object") Object.assign(state.cal, savedCal);
    await initPrefsStorage();
    await loadPrefs();
    state.leagueId = state.data?.league?.id || null;
    state.socials = await loadSocials();
    state.focusId = await new Promise((res) => chrome.storage.local.get(FOCUS_KEY, (r) => res(r[FOCUS_KEY] || null)));
    // Clubs saved before the league was recorded: fill it in when we're on a league
    // where they play, so their crest can take the user back here later.
    const here = state.data?.league;
    const fill = (club) => {
      const t = club && state.model?.teams.get(club.id);
      if (!t || club.league || !here) return false;
      club.league = { id: here.id, name: here.name, url_name: here.url_name };
      club.url_name = club.url_name || t.url_name;
      return true;
    };
    if (fill(state.main)) store.set(state.main);
    if (Object.values(state.leagueFavs).map(fill).some(Boolean)) store.setMap(LEAGUE_KEY, state.leagueFavs);
    resolveFav();
    // First visit (no stored choice): open the bar only if there's no team yet,
    // so the search is discoverable; afterwards respect the user's last choice.
    // When the main team isn't in this league the bar opens to ask about it.
    const saved = await new Promise((res) => chrome.storage.local.get(OPEN_KEY, (r) => res(r[OPEN_KEY])));
    state.open = state.needsLeaguePick ? true : typeof saved === "boolean" ? saved : !state.fav;
    state.leftCollapsed = await new Promise((res) =>
      chrome.storage.local.get(LEFT_KEY, (r) => res(r[LEFT_KEY] === true)),
    );
    applyOffAttr();
    mount();
    applyFeatures(); // renders the bar, panel, left handle and the switches

    // First run on a league page, with no club chosen yet: welcome and guide the choice.
    const onboarded = await new Promise((res) => chrome.storage.local.get(ONBOARD_KEY, (r) => res(r[ONBOARD_KEY] === true)));
    if (!onboarded && !state.main && state.model?.teams.size) {
      state.open = false; // the welcome replaces the auto-opened side panel
      syncDock();
      startOnboarding();
    }

    // Another Chrome signed in with the same Google account changed a preference:
    // pick it up live. Our own writes land here too; they're skipped when nothing differs.
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== (state.sync ? "sync" : "local")) return;
      if (!SYNC_KEYS.some((k) => k in changes)) return;
      const before = prefsSnapshot();
      await loadPrefs();
      if (prefsSnapshot() === before) return;
      resolveFav();
      applyFeatures();
    });

    // React re-renders rows and cards; re-apply the highlight (debounced).
    // Only childList is observed so toggling our own classes can't loop.
    let t;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        applyHighlight(state.fav);
        syncLive();
        syncCalendar();
      }, 150);
    }).observe(document.getElementById("__next") || document.body, { childList: true, subtree: true });

    // The site is a single-page app: moving between home, leagues and matches does
    // not reload the page (and __NEXT_DATA__ goes stale), so follow the URL and
    // fetch the data of the page we landed on.
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      onRoute();
    }, 700);
    setInterval(tick, 20000);
  }

  async function onRoute() {
    const path = location.pathname;
    const parts = path.split("/").filter(Boolean);
    let data = null;
    let game = null;
    if (parts[0] === "league" && parts[2]) {
      const props = await fetchPageProps(path);
      data = props?.data?.league?.id === parts[2] ? props.data : null;
    } else if (parts[0] === "game" && parts[2]) {
      const game0 = (await fetchPageProps(path))?.initialData?.game;
      game = game0?.id === parts[2] ? game0 : null;
    }
    if (location.pathname !== path) return; // navigated again while fetching
    state.data = data;
    state.model = data ? buildModel(data) : null;
    state.game = game;
    state.leagueId = data?.league?.id || null;
    state.picking = false;
    resolveFav();
    refresh();
    syncDock();
  }

  init();
})();
