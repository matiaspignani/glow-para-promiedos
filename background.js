// Service worker. Two jobs for the content script:
// - pg-news:    news RSS for a club (the page's origin can't read news.google.com
//               because of CORS; the worker can thanks to host_permissions).
// - pg-socials: the bundled socials.json (curated official-site links).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "pg-socials") {
    fetch(chrome.runtime.getURL("socials.json"))
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg?.type !== "pg-news" || typeof msg.query !== "string") return;

  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(`${msg.query} fútbol when:7d`) +
    "&hl=es-419&gl=AR&ceid=AR:es-419";

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then((xml) => sendResponse({ ok: true, xml }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // keep the channel open for the async response
});
