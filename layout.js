// Detects screen resolution, window size and input type, and publishes them
// on <html> so CSS (and the widget) can adapt. Runs at document_start to avoid
// a layout flash.
(() => {
  const root = document.documentElement;
  const TIERS = [
    [480, "xs"],
    [768, "sm"],
    [1024, "md"],
    [1440, "lg"],
    [1920, "xl"],
    [2560, "xxl"],
  ];

  function measure() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { width: sw, height: sh, availWidth: aw, availHeight: ah } = window.screen;
    const tier = (TIERS.find(([max]) => vw < max) || [0, "uw"])[1];

    // A window is "maximized" when it fills the usable screen area (a few px
    // of slack for borders). outerWidth can be 0 in embedded views, so fall
    // back to the viewport in that case.
    const ow = window.outerWidth || vw;
    const oh = window.outerHeight || vh;
    const maximized = ow >= aw - 16 && oh >= ah - 16;

    const info = {
      tier,
      viewport: { w: vw, h: vh },
      window: { w: ow, h: oh },
      screen: { w: sw, h: sh, availW: aw, availH: ah },
      dpr: window.devicePixelRatio || 1,
      maximized,
      orientation: vw >= vh ? "landscape" : "portrait",
      input: window.matchMedia("(pointer: coarse)").matches ? "touch" : "mouse",
    };

    root.dataset.pgTier = info.tier;
    root.dataset.pgMaximized = String(info.maximized);
    root.dataset.pgOrient = info.orientation;
    root.dataset.pgInput = info.input;
    root.style.setProperty("--pg-vw", `${vw}px`);
    root.style.setProperty("--pg-vh", `${vh}px`);
    root.style.setProperty("--pg-screen-w", `${sw}px`);
    root.style.setProperty("--pg-screen-h", `${sh}px`);

    window.__pgLayout = info;
    document.dispatchEvent(new CustomEvent("pg-layout", { detail: info }));
  }

  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(measure);
  };

  // Switched-off improvements (settings card): applied before first paint so a
  // disabled look never flashes. content.js keeps this attribute up to date.
  // The switches live in the Google account (storage.sync) unless the user turned
  // that off (pgSyncOn === false, kept locally); fall back to local data that
  // hasn't been lifted into the account yet.
  try {
    chrome.storage.local.get(["pgSyncOn", "pgFeatures"], (local) => {
      const apply = (stored) => {
        const features = stored || {};
        root.dataset.pgOff = Object.keys(features)
          .filter((k) => features[k] === false)
          .join(" ");
      };
      if (local?.pgSyncOn === false || !chrome.storage.sync) return apply(local?.pgFeatures);
      chrome.storage.sync.get("pgFeatures", (synced) => apply(synced?.pgFeatures ?? local?.pgFeatures));
    });
  } catch {
    // storage unavailable: leave everything on
  }

  measure();
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  // Moving the window to another monitor changes DPR without a resize.
  window
    .matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener("change", schedule);
})();
