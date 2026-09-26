// KeplerLLM fork: temporary Safari embedded-iframe link-click workaround.
//
// When KeplerLLM runs embedded in Safari, physical clicks on ordinary `<a>`
// anchors can produce `mouseup` without the expected `click`, so React
// Router never navigates. Calling `anchor.click()` programmatically works.
// This module restores only that missing click.
//
// Runtime activation checks embedded state (`window.self !== window.top`)
// with an identity comparison only, so it matches any embedded iframe
// (same- or cross-origin) without touching the parent DOM. The feature is
// intended for the known cross-origin deployment and stays opt-in via
// runtime config `safariIframeLinkFix === true` (default off).

const NON_SAFARI_UA =
  /Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi|Brave/i;

// macOS/iOS Safari UAs carry a `Safari` token plus `Version/` (and Apple
// vendor). Chrome/Edge/Firefox are excluded above even though Chromium UAs
// also contain a `Safari/` token. A `Safari` token alone is not enough.
export function isSafariWebKit({ userAgent = "", vendor = "" } = {}) {
  const ua = String(userAgent ?? "");
  if (!ua || NON_SAFARI_UA.test(ua) || !/Safari/i.test(ua)) return false;
  return /Version\//i.test(ua) || /Apple/i.test(String(vendor ?? ""));
}

function isEligibleAnchor(anchor, win) {
  if (!anchor || typeof anchor.getAttribute !== "function") return false;
  if (anchor.isConnected === false) return false;
  if (anchor.hasAttribute?.("download")) return false;
  const target = anchor.getAttribute("target");
  if (
    target != null &&
    target.trim() !== "" &&
    target.trim().toLowerCase() !== "_self"
  )
    return false;
  const href = anchor.getAttribute("href");
  if (href == null || String(href).trim() === "") return false;
  let url;
  try {
    url = new URL(href, win.location?.href ?? win.location?.origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.origin === win.location?.origin;
}

let installedByDocument = new WeakMap();

export function __resetSafariIframeLinkFixForTests() {
  installedByDocument = new WeakMap();
}

// Delegated mouseup -> next-task fallback -> anchor.click() unless the
// native click for the same anchor cancels it first. Idempotent per
// document; returns a cleanup function.
export function initSafariIframeLinkFix({
  window: win = globalThis.window ?? globalThis,
  document: doc = win?.document,
  config = win?.__KEPLERLLM_CONFIG__,
  userAgent = undefined,
  vendor = undefined,
  schedule = (fn) => setTimeout(fn, 0),
  cancelSchedule = (id) => clearTimeout(id),
} = {}) {
  const noop = () => {};
  if (!win || !doc || typeof doc.addEventListener !== "function") return noop;
  if (installedByDocument.get(doc)) return installedByDocument.get(doc);
  if (config?.safariIframeLinkFix !== true) return noop;
  if (win.self === win.top) return noop;
  const ua = userAgent ?? win.navigator?.userAgent ?? "";
  const vd = vendor ?? win.navigator?.vendor ?? "";
  if (!isSafariWebKit({ userAgent: ua, vendor: vd })) return noop;

  const pending = new Map();

  function onMouseUp(event) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || !isEligibleAnchor(anchor, win)) return;
    if (pending.has(anchor)) cancelSchedule(pending.get(anchor));
    // Next-task fallback (never queueMicrotask: it could run before a
    // native click in the same task).
    pending.set(
      anchor,
      schedule(() => {
        // Clear first so the synthetic click cannot re-trigger the fallback.
        pending.delete(anchor);
        if (!isEligibleAnchor(anchor, win)) return;
        anchor.click();
      })
    );
  }

  function onClick(event) {
    const anchor = event.target?.closest?.("a[href]");
    if (anchor && pending.has(anchor)) {
      cancelSchedule(pending.get(anchor));
      pending.delete(anchor);
    }
  }

  doc.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("click", onClick);

  const cleanup = () => {
    doc.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("click", onClick);
    for (const timerId of pending.values()) cancelSchedule(timerId);
    pending.clear();
    installedByDocument.delete(doc);
  };
  installedByDocument.set(doc, cleanup);
  return cleanup;
}

export default initSafariIframeLinkFix;
