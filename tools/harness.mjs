// Local test harness: serves static snapshots of Promiedos league pages with the
// extension's content.css / layout.js / content.js injected and a chrome.* shim,
// so the real extension code can be exercised in a normal browser tab. The real
// background.js runs inside the page against a CORS-free proxy route.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const EXT = process.argv[2];
const PORT = 8777;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = {
  "/league/liga-profesional/hc": "https://www.promiedos.com.ar/league/liga-profesional/hc",
  "/league/primera-nacional/ebj": "https://www.promiedos.com.ar/league/primera-nacional/ebj",
};
const PROXY_OK = /^https:\/\/(www\.promiedos\.com\.ar|news\.google\.com)\//;
const cache = {};

const shim = `
<script>
(() => {
  const BASE = "${BASE}";
  const listeners = [];
  const makeArea = (areaName, KEY) => {
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
    const save = (m) => localStorage.setItem(KEY, JSON.stringify(m));
    const fire = (changes) => setTimeout(() => listeners.forEach((f) => f(changes, areaName)), 0);
    return {
      get: (k, cb) => { const m = load(), o = {}; (Array.isArray(k) ? k : [k]).forEach((x) => { if (x in m) o[x] = m[x]; }); cb(o); },
      set: (o, cb) => { const m = load(), ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: m[k], newValue: v }; } save({ ...m, ...o }); fire(ch); cb && cb(); },
      remove: (k) => { const m = load(); (Array.isArray(k) ? k : [k]).forEach((x) => delete m[x]); save(m); },
    };
  };
  const localArea = makeArea("local", "pgHarnessStorage");
  const syncArea = makeArea("sync", "pgHarnessSync");
  const bg = { handler: null };
  const fakeChrome = { runtime: { onMessage: { addListener: (f) => (bg.handler = f) }, getURL: (p) => BASE + "/__ext/" + p } };
  const proxyFetch = (u, o) => (u.startsWith(BASE) ? fetch(u) : fetch(BASE + "/__proxy?u=" + encodeURIComponent(u)));
  const ready = fetch(BASE + "/__ext/background.js").then((r) => r.text()).then((code) => new Function("chrome", "fetch", code)(fakeChrome, proxyFetch));
  window.chrome = {
    storage: { local: localArea, sync: syncArea, onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { lastError: null, sendMessage: (msg, cb) => { ready.then(() => bg.handler(msg, {}, cb)); } },
  };
})();
</script>`;

async function page(url) {
  if (cache[url]) return cache[url];
  let html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  // Keep the data blob and stylesheets; drop every other script so React doesn't hydrate over the test.
  html = html.replace(/<script(?![^>]*id="__NEXT_DATA__")[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<head>/i, '<head><base href="https://www.promiedos.com.ar/">');
  const inject = `<link rel="stylesheet" href="${BASE}/__ext/content.css">` + shim + `<script src="${BASE}/__ext/layout.js"></script>`;
  html = html.replace(/<\/head>/i, inject + "</head>");
  html = html.replace(/<\/body>/i, `<script src="${BASE}/__ext/content.js"></script></body>`);
  return (cache[url] = html);
}

http
  .createServer(async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.url.startsWith("/__ext/")) {
        const f = path.join(EXT, req.url.slice(7).split("?")[0]);
        res.setHeader("Content-Type", f.endsWith(".css") ? "text/css" : f.endsWith(".json") ? "application/json" : "text/javascript");
        return res.end(fs.readFileSync(f));
      }
      if (req.url.startsWith("/__proxy?u=")) {
        const target = decodeURIComponent(req.url.slice("/__proxy?u=".length));
        if (!PROXY_OK.test(target)) { res.statusCode = 403; return res.end("blocked"); }
        const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0" } });
        res.statusCode = r.status;
        return res.end(await r.text());
      }
      const url = PAGES[req.url.split("?")[0]];
      if (!url) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await page(url));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log("harness on " + PORT));
