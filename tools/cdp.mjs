// Drives a real (headless) Edge with the unpacked extension loaded, over the
// DevTools protocol: collects console errors, seeds chrome.storage from the
// extension's own isolated world, and saves exact-size screenshots.
//   node cdp.mjs <extensionDir> <outDir> [scenario ...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const [EXT, OUT, ...wanted] = process.argv.slice(2);
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "pg-edge-"));
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(EDGE, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  "--no-first-run", "--disable-gpu", "about:blank",
], { stdio: "ignore", detached: false });

async function waitForPort() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(500); }
  }
  throw new Error("browser did not start");
}

let ws, nextId = 1;
const pending = new Map();
const events = [];
const contexts = new Map(); // id -> { name, origin }
const errors = [];

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

function onMessage(raw) {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    return m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
  events.push(m);
  if (m.method === "Runtime.executionContextCreated") contexts.set(m.params.context.id, m.params.context);
  if (m.method === "Runtime.executionContextsCleared") contexts.clear();
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`EXC ${d.text} ${d.exception?.description?.split("\n")[0] || ""} @${d.url || ""}:${d.lineNumber}`);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    errors.push(`log ${m.params.entry.source}: ${m.params.entry.text.slice(0, 160)} ${m.params.entry.url || ""}`);
  }
}

const ev = async (expression, contextId) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
  if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
};
const extContext = () => [...contexts.entries()].find(([, c]) => c.origin?.startsWith("chrome-extension://") && c.auxData?.type === "isolated")?.[0];

async function go(url, settle = 4500) {
  events.length = 0;
  await send("Page.navigate", { url });
  for (let i = 0; i < 40 && !events.some((e) => e.method === "Page.loadEventFired"); i++) await sleep(250);
  await sleep(settle);
}

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, name + ".png");
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return file;
}

const shadow = (js) => ev(`(() => { const sh = document.getElementById('pg-host')?.shadowRoot; if (!sh) return 'NO-HOST'; ${js} })()`);

const BASE = "https://www.promiedos.com.ar";
const BOCA = { id: "igg", name: "Boca Juniors", short_name: "Boca Jrs.", url_name: "boca-juniors", league: { id: "hc", name: "Liga Profesional Argentina", url_name: "liga-profesional" } };
const FERRO = { id: "hcbi", name: "Ferro Carril Oeste", short_name: "Ferro", url_name: "ferro-carril-oeste", league: { id: "ebj", name: "Primera Nacional", url_name: "primera-nacional" } };

async function seed(items, area = "sync") {
  const id = extContext();
  if (!id) throw new Error("extension context not found");
  await ev(`new Promise((r) => chrome.storage.${area}.set(${JSON.stringify(items)}, r))`, id);
}
async function clearAll() {
  const id = extContext();
  if (!id) return;
  await ev(`Promise.all([new Promise((r) => chrome.storage.sync.clear(r)), new Promise((r) => chrome.storage.local.clear(r))])`, id);
}

const scenarios = {
  async smoke() {
    await go(`${BASE}/league/liga-profesional/hc`);
    return {
      extContext: !!extContext(),
      host: await ev("!!document.getElementById('pg-host')"),
      off: await ev("document.documentElement.dataset.pgOff ?? null"),
      tier: await ev("document.documentElement.dataset.pgTier"),
      dock: await shadow("return sh.querySelector('.dock').dataset.open"),
      picker: await shadow("return sh.querySelector('h3')?.innerText || null"),
      sugg: await shadow("return sh.querySelectorAll('.sugg button').length"),
    };
  },
  async seeded() {
    await go(`${BASE}/league/liga-profesional/hc`, 1500);
    await clearAll();
    await seed({ pgFavTeam: BOCA, pgLeagueFavs: { ebj: FERRO } });
    await seed({ pgDockOpen: true, pgFocus: "igg" }, "local");
    await go(`${BASE}/league/liga-profesional/hc`);
    const out = {
      pill: await shadow("return sh.querySelector('.hteam').innerText.replace(/\\n/g,' / ')"),
      crests: await shadow("return [...sh.querySelectorAll('.hcrest')].map(b => b.title + (b.classList.contains('on') ? ' *on' : ''))"),
      favRows: await ev("document.querySelectorAll('tr.pg-fav-row').length"),
      panel: await shadow("return sh.querySelector('.hero')?.innerText.replace(/\\n/g,' / ')"),
      socials: await shadow("return [...sh.querySelectorAll('.socials a')].map(a => a.innerText).join(', ')"),
      news: await shadow("return sh.querySelectorAll('a.news').length"),
      title: await ev("getComputedStyle(document.querySelector('[class*=\"title_block\"]')).display"),
      bg: await ev("getComputedStyle(document.body).backgroundColor"),
    };
    out.shot = await shot("01-liga-panel");
    return out;
  },
  async settings() {
    await shadow("sh.querySelector('.hgear').click(); return 1");
    await sleep(700);
    const out = { switches: await shadow("return sh.querySelectorAll('.sw').length"), sync: await shadow("return sh.querySelector('.syncrow').innerText.replace(/\\n/g,' | ')") };
    out.shot = await shot("02-ajustes");
    await shadow("sh.querySelector('.spop .link').click(); return 1");
    return out;
  },
  async welcome() {
    await go(`${BASE}/league/liga-profesional/hc`, 1500);
    await clearAll();
    await go(`${BASE}/league/liga-profesional/hc`);
    const click = (sel, text) => shadow(`const els = [...sh.querySelectorAll(${JSON.stringify(sel)})]; const b = els.find(e => !${JSON.stringify(text || "")} || e.innerText.includes(${JSON.stringify(text || "")})); if (!b) return 'MISSING ' + ${JSON.stringify(sel + " " + (text || ""))}; b.click(); return 'ok'`);
    const out = { visible: await shadow("return !sh.querySelector('.wback').hidden"), dock: await shadow("return sh.querySelector('.dock').dataset.open") };
    out.s0 = await shadow("return sh.querySelector('.wcard').innerText.replace(/\\n/g,' | ')");
    await shot("w0-bienvenida");
    out.c0 = await click(".wbtn.primary", "Empezar"); await sleep(400);
    out.s1 = await shadow("return sh.querySelector('.wcard h2').innerText + ' / teams=' + sh.querySelectorAll('.wteam').length + ' / nextDisabled=' + sh.querySelector('.wbtn.primary').disabled");
    out.pickBoca = await click(".wteam", "Boca"); await sleep(300);
    out.s1b = await shadow("return 'nextDisabled=' + sh.querySelector('.wbtn.primary').disabled + ' on=' + sh.querySelector('.wteam.on')?.innerText");
    await shot("w1-hincha");
    out.c1 = await click(".wbtn.primary", "Siguiente"); await sleep(400);
    out.s2 = await shadow("return sh.querySelector('.wcard h2').innerText + ' / teams=' + sh.querySelectorAll('.wteam').length + ' / hasBoca=' + [...sh.querySelectorAll('.wteam')].some(b => b.innerText.includes('Boca'))");
    out.pickRiver = await click(".wteam", "River"); await sleep(300);
    await shot("w2-simpatizante");
    out.c2 = await click(".wbtn.primary", "Listo"); await sleep(1200);
    out.s3 = await shadow("return sh.querySelector('.wcard h2').innerText");
    await shot("w3-listo");
    out.c3 = await click(".wbtn.primary", "Ver mi equipo"); await sleep(1500);
    out.after = {
      wbackHidden: await shadow("return sh.querySelector('.wback').hidden"),
      crests: await shadow("return [...sh.querySelectorAll('.hcrest')].map(b => b.title + (b.classList.contains('on') ? ' *on' : ''))"),
      pill: await shadow("return sh.querySelector('.hteam').innerText.replace(/\\n/g,' / ')"),
      dock: await shadow("return sh.querySelector('.dock').dataset.open"),
    };
    out.shot = await shot("w4-resultado");
    // It must not come back on reload
    await go(`${BASE}/league/liga-profesional/hc`);
    out.reload = { welcomeAgain: await shadow("return !sh.querySelector('.wback').hidden") };
    return out;
  },
  async pnsocials() {
    const FERRO_MAIN = { ...FERRO };
    await go(`${BASE}/league/primera-nacional/ebj`, 1500);
    await clearAll();
    await seed({ pgFavTeam: FERRO_MAIN });
    await seed({ pgDockOpen: true, pgOnboarded: true }, "local");
    await go(`${BASE}/league/primera-nacional/ebj`);
    const out = {
      hero: await shadow("return sh.querySelector('.hero')?.innerText.replace(/\\n/g,' / ')"),
      socials: await shadow("return [...sh.querySelectorAll('.socials a')].map(a => a.innerText + ' -> ' + a.getAttribute('href'))"),
      note: await shadow("return sh.querySelector('.note')?.innerText"),
    };
    out.shot = await shot("06-primera-nacional");
    return out;
  },
  async coffee() {
    await shadow("sh.querySelector('.hgear').click(); return 1");
    await sleep(500);
    const out = await shadow(`const box = sh.querySelector('.coffeebox'); sh.querySelector('.spop').scrollTop = 99999;
      if (!box) return null;
      const btns = [...box.querySelectorAll('.copy')].map((b) => b.innerText);
      const first = box.querySelector('.copy'); first.click();
      const link = box.querySelector('a.coffeelink');
      return new Promise((r) => setTimeout(() => r({ text: box.innerText.replace(/\\n/g, ' | '), btns, afterClick: first.innerText,
        link: link ? { href: link.href, target: link.target, rel: link.rel } : null }), 300));`);
    await sleep(300);
    const file = await shot("05-cafe");
    await shadow("sh.querySelector('.spop .link').click(); return 1");
    return { button: out, file };
  },
  async equipos() {
    await go(`${BASE}/league/liga-profesional/hc/equipos`);
    const out = {
      host: await ev("!!document.getElementById('pg-host')"),
      dock: await shadow("return sh.querySelector('.panel, .side-inner')?.innerText.slice(0,160).replace(/\\n/g,' / ')"),
      favCard: await ev("document.querySelectorAll('.pg-fav-card').length"),
      grid: await ev("getComputedStyle(document.querySelector('[class*=\"stats_items\"]')).gridTemplateColumns"),
    };
    await ev("document.querySelector('[class*=\"equipos_items\"]')?.scrollIntoView({block:'start'}); window.scrollBy(0,-80)");
    await sleep(500);
    out.shot = await shot("03-equipos");
    return out;
  },
  async leftmenu() {
    await go(`${BASE}/league/liga-profesional/hc`);
    await shadow("sh.querySelector('.handle').click(); return 1"); // close the panel
    await sleep(400);
    await shadow("sh.querySelector('.lhandle').click(); return 1"); // collapse left menu
    await sleep(900);
    const out = { left: await ev("document.documentElement.dataset.pgLeft") };
    out.shot = await shot("04-menu-minimizado");
    return out;
  },
  async prompt() {
    await go(`${BASE}/league/primera-nacional/ebj`);
    return {
      ask: await shadow("return sh.querySelector('.ask')?.innerText.replace(/\\n/g,' / ') || null"),
      pill: await shadow("return sh.querySelector('.hteam').innerText.replace(/\\n/g,' / ')"),
    };
  },
  async icons() {
    const sizes = [16, 32, 48, 128];
    const draw = `(size) => { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
      g.beginPath(); g.roundRect(0, 0, size, size, size * 0.22); const gr = g.createLinearGradient(0, 0, size, size);
      gr.addColorStop(0, '#1f4a35'); gr.addColorStop(1, '#07130e'); g.fillStyle = gr; g.fill();
      g.lineWidth = size * 0.07; g.strokeStyle = '#b6f26b'; g.beginPath(); g.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#b6f26b'; g.font = '800 ' + (size * 0.5) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('G', size / 2, size / 2 + size * 0.04); return c.toDataURL('image/png'); }`;
    fs.mkdirSync(path.join(EXT, "icons"), { recursive: true });
    for (const s of sizes) {
      const url = await ev(`(${draw})(${s})`);
      fs.writeFileSync(path.join(EXT, "icons", `icon${s}.png`), Buffer.from(url.split(",")[1], "base64"));
    }
    // Small promo tile 440x280
    const tile = await ev(`(() => { const c = document.createElement('canvas'); c.width = 440; c.height = 280; const g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 440, 280); gr.addColorStop(0, '#1f4a35'); gr.addColorStop(1, '#07130e'); g.fillStyle = gr; g.fillRect(0, 0, 440, 280);
      g.fillStyle = 'rgba(182,242,107,.10)'; g.beginPath(); g.arc(380, 40, 150, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#b6f26b'; g.lineWidth = 9; g.beginPath(); g.arc(88, 100, 44, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#b6f26b'; g.font = '800 56px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('G', 88, 104);
      g.textAlign = 'left'; g.fillStyle = '#e8f1ec'; g.font = '800 38px Arial'; g.fillText('Glow para', 160, 84); g.fillText('Promiedos', 160, 128);
      g.font = '500 20px Arial'; g.fillStyle = '#b6f26b'; g.fillText('Tu club primero. Sin publicidad.', 36, 200);
      g.font = '500 15px Arial'; g.fillStyle = '#8aa399'; g.fillText('Extensión no oficial · Tema oscuro · Mis clubes', 36, 240);
      return c.toDataURL('image/png'); })()`);
    fs.mkdirSync(path.join(OUT), { recursive: true });
    fs.writeFileSync(path.join(OUT, "promo-440x280.png"), Buffer.from(tile.split(",")[1], "base64"));
    return { icons: sizes.map((s) => `icons/icon${s}.png`), tile: "promo-440x280.png" };
  },
};

try {
  const version = await waitForPort();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => onMessage(e.data);
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  console.log("browser:", version.Browser);
  const report = {};
  for (const name of wanted.length ? wanted : Object.keys(scenarios)) {
    errors.length = 0;
    try {
      report[name] = await scenarios[name]();
    } catch (e) {
      report[name] = { FAILED: String(e) };
    }
    report[name + ":errors"] = [...new Set(errors)].slice(0, 12);
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  try { await send("Browser.close"); } catch {}
  setTimeout(() => { try { proc.kill(); } catch {} process.exit(0); }, 1500);
}
