// Captures the raw material for social posts with a real (headless) Edge:
//   stills:  before.png (site without the extension), after.png (with it), 2x pixel density
//   frames:  welcome/ and panel/ PNG sequences + a durations list for ffmpeg
//   node media.mjs <extensionDir> <outDir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [EXT, OUT] = process.argv.slice(2);
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "https://www.promiedos.com.ar";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const BOCA = { id: "igg", name: "Boca Juniors", short_name: "Boca Jrs.", url_name: "boca-juniors", league: { id: "hc", name: "Liga Profesional Argentina", url_name: "liga-profesional" } };
const RIVER = { id: "igi", name: "River Plate", short_name: "River", url_name: "river-plate", league: { id: "hc", name: "Liga Profesional Argentina", url_name: "liga-profesional" } };

async function session({ extension, port, width, height, dpr }, fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pg-media-"));
  const args = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"];
  if (extension) args.unshift(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);
  const proc = spawn(EDGE, args, { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(500); } }
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 1;
  const pending = new Map();
  const events = [];
  const contexts = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    events.push(m);
    if (m.method === "Runtime.executionContextCreated") contexts.set(m.params.context.id, m.params.context);
    if (m.method === "Runtime.executionContextsCleared") contexts.clear();
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  const ev = async (expression, contextId) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const api = {
    ev,
    async go(url, settle = 4500) {
      events.length = 0;
      await send("Page.navigate", { url });
      for (let i = 0; i < 40 && !events.some((e) => e.method === "Page.loadEventFired"); i++) await sleep(250);
      await sleep(settle);
    },
    async shot(file) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    shadow: (js) => ev(`(() => { const sh = document.getElementById('pg-host')?.shadowRoot; if (!sh) return 'NO-HOST'; ${js} })()`),
    async storage(area, items) {
      const ctx = [...contexts.entries()].find(([, c]) => c.origin?.startsWith("chrome-extension://") && c.auxData?.type === "isolated")?.[0];
      if (!ctx) throw new Error("extension context not found");
      await ev(`new Promise((r) => chrome.storage.${area}.set(${JSON.stringify(items)}, r))`, ctx);
    },
    async clearStorage() {
      const ctx = [...contexts.entries()].find(([, c]) => c.origin?.startsWith("chrome-extension://") && c.auxData?.type === "isolated")?.[0];
      if (ctx) await ev(`Promise.all([new Promise((r) => chrome.storage.sync.clear(r)), new Promise((r) => chrome.storage.local.clear(r))])`, ctx);
    },
    click: (sel, text = "") => api.shadow(`const b = [...sh.querySelectorAll(${JSON.stringify(sel)})].find(e => !${JSON.stringify(text)} || e.innerText.includes(${JSON.stringify(text)})); if (!b) return 'MISSING ${sel}'; b.click(); return 'ok'`),
    sleep,
  };
  try { return await fn(api); } finally {
    try { await send("Browser.close"); } catch {}
    setTimeout(() => { try { proc.kill(); } catch {} }, 1500);
  }
}

const liga = `${BASE}/league/liga-profesional/hc`;
const report = {};
const ONLY = process.env.ONLY || "";
const want = (k) => !ONLY || ONLY === k;

// 1. BEFORE: the real site, no extension, 2x.
if (want("before")) await session({ extension: false, port: 9601, width: 1280, height: 800, dpr: 2 }, async (b) => {
  await b.go(liga, 5000);
  // The promo images should not show the site's third-party betting banner: hide just that frame.
  const css = 'iframe[src*="adsage"], div:not([class]):not([id]):has(> iframe[src*="adsage"]), div:not([class]):not([id]):has(> div:not([class]) > iframe[src*="adsage"]) { display: none !important; }';
  await b.ev(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(css)}; document.head.append(s); })()`);
  await b.sleep(600);
  await b.shot(path.join(OUT, "before.png"));
  report.before = "ok";
});

// 2. AFTER (with the extension, seeded) + frame sequences.
if (want("frames")) await session({ extension: true, port: 9602, width: 1280, height: 720, dpr: 1 }, async (b) => {
  await b.go(liga, 1500);
  // Welcome sequence: fresh profile -> first-run welcome.
  await b.clearStorage();
  await b.go(liga, 5000);
  const W = path.join(OUT, "welcome");
  const seq = [];
  const frame = async (name, hold) => { await b.sleep(450); await b.shot(path.join(W, name + ".png")); seq.push([name, hold]); };
  await frame("w0", 2.0);
  await b.click(".wbtn.primary", "Empezar"); await frame("w1", 1.4);
  await b.click(".wteam", "Boca"); await frame("w2", 1.4);
  await b.click(".wbtn.primary", "Siguiente"); await frame("w3", 1.2);
  await b.click(".wteam", "River"); await frame("w4", 1.4);
  await b.click(".wbtn.primary", "Listo"); await b.sleep(900); await frame("w5", 2.0);
  await b.click(".wbtn.primary", "Ver mi equipo"); await b.sleep(900); await frame("w6", 3.0);
  fs.writeFileSync(path.join(W, "list.json"), JSON.stringify(seq));
  report.welcome = seq.length;

  // Panel sequence: seeded, panel closed first, then opened by clicking the crest.
  await b.storage("sync", { pgFavTeam: BOCA, pgLeagueFavs: { hc: RIVER } });
  await b.storage("local", { pgOnboarded: true, pgDockOpen: false, pgFocus: "igg" });
  await b.go(liga, 5000);
  const P = path.join(OUT, "panel");
  const pseq = [];
  const pframe = async (name, hold) => { await b.sleep(500); await b.shot(path.join(P, name + ".png")); pseq.push([name, hold]); };
  await pframe("p0", 1.8);
  await b.click(".hcrest.on"); await b.sleep(800); await pframe("p1", 1.8);
  for (const [i, y] of [[2, 380], [3, 820], [4, 1300]]) {
    await b.shadow(`sh.querySelector('.side-inner').scrollTo({ top: ${y} }); return 1`);
    await pframe("p" + i, 1.6);
  }
  await b.shadow("sh.querySelector('.side-inner').scrollTo({ top: 0 }); sh.querySelector('.hgear').click(); return 1");
  await pframe("p5", 2.4);
  fs.writeFileSync(path.join(P, "list.json"), JSON.stringify(pseq));
  report.panel = pseq.length;

  // AFTER still (2x): reload at high density with the panel open.
  await b.shadow("sh.querySelector('.spop .link').click(); return 1");
});

if (want("after")) await session({ extension: true, port: 9603, width: 1280, height: 800, dpr: 2 }, async (b) => {
  await b.go(liga, 1500);
  await b.clearStorage();
  await b.storage("sync", { pgFavTeam: BOCA, pgLeagueFavs: { hc: RIVER } });
  await b.storage("local", { pgOnboarded: true, pgDockOpen: true, pgFocus: "igg" });
  await b.go(liga, 5500);
  await b.shot(path.join(OUT, "after.png"));
  report.after = "ok";
});

console.log(JSON.stringify(report));
setTimeout(() => process.exit(0), 2000);
