// KeplerLLM fork: temporary Safari/WebKit cross-origin iframe link-click
// compatibility workaround.
//
// Root cause being worked around: when KeplerLLM is embedded in a
// cross-origin iframe in Safari, physical clicks on ordinary `<a>` anchors
// produce `mouseup` but Safari never dispatches the expected `pointerdown` /
// `mousedown` / `click`, so React Router never navigates. The same anchor
// works top-level and `anchor.click()` called programmatically from inside
// the iframe navigates correctly.
//
// This module restores only the missing click, and only when all of the
// following are true:
//   1. runtime config `safariIframeLinkFix === true` (opt-in, default off),
//   2. the app is embedded (`window.self !== window.top`, cross-origin safe),
//   3. the browser is Safari/WebKit (and not Chrome/Edge/Firefox).
//
// Design notes:
// - Event delegation only. No per-`<Link>` changes, no React Router patch,
//   no `navigate()` call, no `history.pushState` patch.
// - On `mouseup` over an eligible internal anchor, schedule a next-task
//   fallback (`setTimeout(..., 0)`). A normal `click` observer cancels the
//   pending fallback for the same anchor, so a healthy native click yields
//   exactly one navigation and a future fixed Safari also yields one.
// - The pending state is cleared before calling `anchor.click()` so the
//   synthetic click cannot recursively schedule another fallback.
// - Never touches `window.top.location`, `window.parent.document`, or other
//   cross-origin-sensitive properties.

export const SAFARI_IFRAME_LINK_FIX_CONFIG_KEY = "safariIframeLinkFix";

// Tokens that prove the engine is NOT Safari, even though the UA may still
// contain a `Safari/` token (e.g. Chrome on desktop ships `Safari/537.36`).
const NON_SAFARI_UA_PATTERN =
  /Chrome|Chromium|CriOS|FxiOS|Firefox|Edg|OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi|Brave/i;

// Isolated, testable Safari/WebKit check. Must never classify normal desktop
// Chrome/Edge/Firefox as Safari.
export function isSafariWebKit({ userAgent = "", vendor = "" } = {}) {
  const ua = String(userAgent ?? "");
  const vd = String(vendor ?? "");
  if (!ua) return false;
  if (NON_SAFARI_UA_PATTERN.test(ua)) return false;
  if (!/Safari/i.test(ua)) return false;
  if (/Version\//i.test(ua)) return true;
  if (/Apple/i.test(vd)) return true;
  // Safari-token UA without a Chromium/Firefox token (e.g. WKWebView without
  // a Version/ token) is treated as WebKit. Chrome/Edge/Firefox were already
  // excluded above.
  return true;
}

// Cross-origin-safe embedding check. Only compares window identities; never
// reads `window.top.location`, `window.parent.document`, or frame properties.
export function isEmbedded(win = undefined) {
  try {
    const target =
      win ??
      (typeof globalThis !== "undefined"
        ? (globalThis.window ?? globalThis)
        : undefined);
    if (!target) return false;
    return target.self !== target.top;
  } catch {
    return false;
  }
}

function readWindow(win = undefined) {
  if (win !== undefined) return win;
  try {
    if (typeof globalThis !== "undefined")
      return globalThis.window ?? globalThis;
  } catch {
    // ignore and fall through
  }
  return undefined;
}

function readDocument(win, docOverride = undefined) {
  if (docOverride !== undefined) return docOverride;
  try {
    return win?.document;
  } catch {
    return undefined;
  }
}

function readNavigator(win, navOverride = undefined) {
  if (navOverride !== undefined) return navOverride;
  try {
    return win?.navigator;
  } catch {
    return undefined;
  }
}

// Read the runtime config object, injectable for tests. Falls back to
// `window.__KEPLERLLM_CONFIG__` when no override is given.
export function readSafariIframeLinkFixConfig(
  override = undefined,
  win = undefined
) {
  if (override !== undefined) return override ?? {};
  try {
    const target = readWindow(win);
    if (typeof globalThis !== "undefined" && win === undefined) {
      return (
        globalThis.__KEPLERLLM_CONFIG__ ??
        globalThis.window?.__KEPLERLLM_CONFIG__ ??
        target?.__KEPLERLLM_CONFIG__ ??
        {}
      );
    }
    return target?.__KEPLERLLM_CONFIG__ ?? {};
  } catch {
    return {};
  }
}

// Only an explicit `true` boolean enables; anything else disables.
export function isSafariIframeLinkFixEnabled(
  config = undefined,
  win = undefined
) {
  const resolved =
    config !== undefined
      ? config
      : readSafariIframeLinkFixConfig(undefined, win);
  return resolved?.[SAFARI_IFRAME_LINK_FIX_CONFIG_KEY] === true;
}

export function shouldEnableSafariIframeLinkFix({
  config = undefined,
  window: winOverride = undefined,
  userAgent = undefined,
  vendor = undefined,
} = {}) {
  const win = readWindow(winOverride);
  const resolvedConfig =
    config !== undefined
      ? config
      : readSafariIframeLinkFixConfig(undefined, win);
  if (resolvedConfig?.[SAFARI_IFRAME_LINK_FIX_CONFIG_KEY] !== true)
    return false;
  if (!isEmbedded(win)) return false;
  const nav = readNavigator(win);
  const ua =
    userAgent !== undefined
      ? userAgent
      : (nav?.userAgent ?? win?.navigator?.userAgent ?? "");
  const vd =
    vendor !== undefined
      ? vendor
      : (nav?.vendor ?? win?.navigator?.vendor ?? "");
  return isSafariWebKit({ userAgent: ua, vendor: vd });
}

// Physical mouseup must be an unmodified primary-button click.
export function isEligibleMouseUpEvent(event = undefined) {
  if (!event) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return false;
  if (event.defaultPrevented === true) return false;
  return true;
}

function resolveLinkLocation(anchor, { baseHref = undefined } = {}) {
  const rawHref = anchor?.getAttribute?.("href");
  if (rawHref == null) return null;
  if (String(rawHref).trim() === "") return null;
  const base =
    baseHref !== undefined && baseHref !== null ? baseHref : undefined;
  try {
    return base !== undefined ? new URL(rawHref, base) : new URL(rawHref);
  } catch {
    return null;
  }
}

// Only ordinary internal KeplerLLM navigation anchors are eligible. Never
// synthesize navigation for external links, `_blank`, downloads,
// mailto/tel/javascript, modified clicks, or non-anchor controls.
export function isEligibleAnchor(
  anchor = undefined,
  { origin = undefined, baseHref = undefined } = {}
) {
  if (!anchor || typeof anchor.getAttribute !== "function") return false;
  if (typeof anchor.tagName === "string" && anchor.tagName !== "A")
    return false;
  if (typeof anchor.isConnected === "boolean" && anchor.isConnected !== true)
    return false;
  if (
    typeof anchor.hasAttribute === "function" &&
    anchor.hasAttribute("download")
  )
    return false;
  const target = anchor.getAttribute("target");
  if (target != null && String(target).trim() !== "") {
    if (String(target).trim().toLowerCase() !== "_self") return false;
  }
  const url = resolveLinkLocation(anchor, { baseHref });
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (
    origin !== undefined &&
    origin !== null &&
    String(origin) !== "" &&
    url.origin !== String(origin)
  )
    return false;
  return true;
}

function findLinkAnchor(target) {
  try {
    return target?.closest?.("a[href]") ?? null;
  } catch {
    return null;
  }
}

function readOrigin(win) {
  try {
    return win?.location?.origin ?? null;
  } catch {
    return null;
  }
}

function readBaseHref(win) {
  try {
    return win?.location?.href ?? win?.location?.origin ?? undefined;
  } catch {
    return undefined;
  }
}

// One cleanup per document so React StrictMode or repeated imports never
// install duplicate global listeners.
let installedCleanupsByDocument =
  typeof WeakMap !== "undefined" ? new WeakMap() : null;
const installedCleanupsFallback = new Map();

function getInstalledCleanup(doc) {
  try {
    if (installedCleanupsByDocument && doc)
      return installedCleanupsByDocument.get(doc);
  } catch {
    // ignore
  }
  return installedCleanupsFallback.get(doc);
}

function setInstalledCleanup(doc, cleanup) {
  try {
    if (installedCleanupsByDocument && doc) {
      installedCleanupsByDocument.set(doc, cleanup);
      return;
    }
  } catch {
    // ignore
  }
  installedCleanupsFallback.set(doc, cleanup);
}

function deleteInstalledCleanup(doc) {
  try {
    if (installedCleanupsByDocument && doc) {
      installedCleanupsByDocument.delete(doc);
      return;
    }
  } catch {
    // ignore
  }
  installedCleanupsFallback.delete(doc);
}

export function __resetSafariIframeLinkFixForTests() {
  try {
    if (typeof WeakMap !== "undefined")
      installedCleanupsByDocument = new WeakMap();
  } catch {
    // ignore
  }
  installedCleanupsFallback.clear();
}

// Initialize once near application startup (outside React rendering/state).
// Idempotent: repeated calls for the same document return the same cleanup
// without installing duplicate listeners. Returns a cleanup function.
export function initSafariIframeLinkFix({
  window: winOverride = undefined,
  document: docOverride = undefined,
  navigator: navOverride = undefined,
  config = undefined,
  userAgent = undefined,
  vendor = undefined,
  schedule = (fn) => setTimeout(fn, 0),
  cancelSchedule = (id) => clearTimeout(id),
} = {}) {
  const win = readWindow(winOverride);
  const doc = readDocument(win, docOverride);
  if (!win || !doc || typeof doc.addEventListener !== "function")
    return () => {};

  const existing = getInstalledCleanup(doc);
  if (existing) return existing;

  const resolvedConfig =
    config !== undefined
      ? config
      : readSafariIframeLinkFixConfig(undefined, win);
  if (resolvedConfig?.[SAFARI_IFRAME_LINK_FIX_CONFIG_KEY] !== true) {
    const noop = () => {};
    return noop;
  }

  let embedded = false;
  try {
    embedded = win.self !== win.top;
  } catch {
    embedded = false;
  }
  if (!embedded) return () => {};

  const nav = readNavigator(win, navOverride);
  const ua =
    userAgent !== undefined
      ? userAgent
      : (nav?.userAgent ?? win?.navigator?.userAgent ?? "");
  const vd =
    vendor !== undefined
      ? vendor
      : (nav?.vendor ?? win?.navigator?.vendor ?? "");
  if (!isSafariWebKit({ userAgent: ua, vendor: vd })) return () => {};

  const pending = new Map();

  function onMouseUp(event) {
    try {
      if (!isEligibleMouseUpEvent(event)) return;
      const anchor = findLinkAnchor(event?.target);
      if (!anchor) return;
      if (
        !isEligibleAnchor(anchor, {
          origin: readOrigin(win),
          baseHref: readBaseHref(win),
        })
      )
        return;
      if (pending.has(anchor)) {
        try {
          cancelSchedule(pending.get(anchor));
        } catch {
          // ignore
        }
        pending.delete(anchor);
      }
      // Next-task fallback: must not run between native mouseup and a
      // possible native click in the same task (no queueMicrotask).
      const timerId = schedule(() => {
        // Clear first so the synthetic click cannot re-trigger the fallback.
        pending.delete(anchor);
        if (
          !isEligibleAnchor(anchor, {
            origin: readOrigin(win),
            baseHref: readBaseHref(win),
          })
        )
          return;
        try {
          anchor.click();
        } catch {
          // A throwing click handler must not break delegation.
        }
      });
      pending.set(anchor, timerId);
    } catch {
      // Delegation must never break the host page.
    }
  }

  function onClick(event) {
    try {
      const anchor = findLinkAnchor(event?.target);
      if (!anchor) return;
      if (!pending.has(anchor)) return;
      try {
        cancelSchedule(pending.get(anchor));
      } catch {
        // ignore
      }
      pending.delete(anchor);
    } catch {
      // ignore
    }
  }

  try {
    doc.addEventListener("mouseup", onMouseUp);
    doc.addEventListener("click", onClick);
  } catch {
    return () => {};
  }

  const cleanup = () => {
    try {
      doc.removeEventListener("mouseup", onMouseUp);
    } catch {
      // ignore
    }
    try {
      doc.removeEventListener("click", onClick);
    } catch {
      // ignore
    }
    for (const timerId of pending.values()) {
      try {
        cancelSchedule(timerId);
      } catch {
        // ignore
      }
    }
    pending.clear();
    deleteInstalledCleanup(doc);
  };

  setInstalledCleanup(doc, cleanup);
  return cleanup;
}

export default initSafariIframeLinkFix;
