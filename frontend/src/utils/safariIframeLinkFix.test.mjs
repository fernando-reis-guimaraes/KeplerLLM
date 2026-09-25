import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isSafariWebKit,
  isEmbedded,
  isEligibleAnchor,
  isEligibleMouseUpEvent,
  shouldEnableSafariIframeLinkFix,
  initSafariIframeLinkFix,
  __resetSafariIframeLinkFixForTests,
} from "./safariIframeLinkFix.js";

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
const SAFARI_VENDOR = "Apple Computer, Inc.";
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CHROME_VENDOR = "Google Inc.";
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const FIREFOX_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0";
const ORIGIN = "https://kepler.example.com";

function makeDocument() {
  const listeners = { mouseup: [], click: [] };
  const doc = {
    listeners,
    addCalls: 0,
    addEventListener(type, fn) {
      this.addCalls += 1;
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      const idx = listeners[type].indexOf(fn);
      if (idx !== -1) listeners[type].splice(idx, 1);
    },
    dispatch(type, event) {
      for (const fn of [...listeners[type]]) fn(event);
    },
  };
  return doc;
}

function makeAnchor({
  href = "/workspace/abc",
  target = null,
  download = false,
  connected = true,
  origin = ORIGIN,
  onClick = null,
} = {}) {
  const attrs = {};
  if (href !== null && href !== undefined) attrs.href = href;
  if (target !== null && target !== undefined) attrs.target = target;
  if (download) attrs.download = "";
  const anchor = {
    tagName: "A",
    isConnected: connected,
    clickCount: 0,
    getAttribute(name) {
      return name in attrs ? attrs[name] : null;
    },
    hasAttribute(name) {
      return name in attrs;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
    closest(selector) {
      if (selector === "a[href]" && "href" in attrs) return this;
      return null;
    },
    click() {
      this.clickCount += 1;
      if (onClick) onClick();
    },
    __origin: origin,
  };
  return anchor;
}

function makeChildOf(anchor) {
  return {
    closest(selector) {
      if (selector === "a[href]") return anchor;
      return null;
    },
  };
}

function makeWindow({
  doc,
  embedded = true,
  userAgent = SAFARI_UA,
  vendor = SAFARI_VENDOR,
}) {
  const win = {
    location: { origin: ORIGIN, href: `${ORIGIN}/` },
    navigator: { userAgent, vendor },
    document: doc,
    __KEPLERLLM_CONFIG__: { safariIframeLinkFix: true },
  };
  win.self = win;
  win.top = embedded ? {} : win;
  return win;
}

function makeScheduler() {
  const tasks = [];
  return {
    tasks,
    schedule(fn) {
      tasks.push(fn);
      return tasks.length - 1;
    },
    cancelSchedule(id) {
      tasks[id] = null;
    },
    flush() {
      const pending = tasks.splice(0, tasks.length);
      for (const fn of pending) if (fn) fn();
    },
    pendingCount() {
      return tasks.filter(Boolean).length;
    },
  };
}

function mouseUpEvent(target, overrides = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    ...overrides,
  };
}

beforeEach(() => {
  __resetSafariIframeLinkFixForTests();
});

describe("isSafariWebKit detection", () => {
  it("detects desktop Safari", () => {
    assert.equal(
      isSafariWebKit({ userAgent: SAFARI_UA, vendor: SAFARI_VENDOR }),
      true
    );
  });

  it("does not classify Chrome/Edge/Firefox as Safari", () => {
    assert.equal(
      isSafariWebKit({ userAgent: CHROME_UA, vendor: CHROME_VENDOR }),
      false
    );
    assert.equal(
      isSafariWebKit({ userAgent: EDGE_UA, vendor: "Google Inc." }),
      false
    );
    assert.equal(isSafariWebKit({ userAgent: FIREFOX_UA, vendor: "" }), false);
  });
});

describe("safariIframeLinkFix activation", () => {
  it("1. feature flag disabled -> workaround does nothing", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: false },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    assert.equal(doc.listeners.mouseup.length, 0);
    assert.equal(doc.listeners.click.length, 0);
  });

  it("2. top-level Safari -> workaround does nothing", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc, embedded: false });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    assert.equal(doc.listeners.mouseup.length, 0);
    // Even a mouseup must not schedule anything.
    const anchor = makeAnchor({});
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 0);
    assert.equal(anchor.clickCount, 0);
  });

  it("3. embedded non-Safari browser -> workaround does nothing", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc, embedded: true });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: CHROME_UA,
      vendor: CHROME_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    assert.equal(doc.listeners.mouseup.length, 0);
  });

  it("isEmbedded uses only cross-origin-safe identity comparison", () => {
    const doc = makeDocument();
    const embedded = makeWindow({ doc, embedded: true });
    const topLevel = makeWindow({ doc, embedded: false });
    assert.equal(isEmbedded(embedded), true);
    assert.equal(isEmbedded(topLevel), false);
  });

  it("shouldEnableSafariIframeLinkFix requires flag + embedded + Safari", () => {
    const embedded = makeWindow({ doc: makeDocument(), embedded: true });
    const topLevel = makeWindow({ doc: makeDocument(), embedded: false });
    assert.equal(
      shouldEnableSafariIframeLinkFix({
        config: { safariIframeLinkFix: true },
        window: embedded,
        userAgent: SAFARI_UA,
        vendor: SAFARI_VENDOR,
      }),
      true
    );
    assert.equal(
      shouldEnableSafariIframeLinkFix({
        config: { safariIframeLinkFix: false },
        window: embedded,
        userAgent: SAFARI_UA,
        vendor: SAFARI_VENDOR,
      }),
      false
    );
    assert.equal(
      shouldEnableSafariIframeLinkFix({
        config: { safariIframeLinkFix: true },
        window: topLevel,
        userAgent: SAFARI_UA,
        vendor: SAFARI_VENDOR,
      }),
      false
    );
    assert.equal(
      shouldEnableSafariIframeLinkFix({
        config: { safariIframeLinkFix: true },
        window: embedded,
        userAgent: CHROME_UA,
        vendor: CHROME_VENDOR,
      }),
      false
    );
  });
});

describe("safariIframeLinkFix fallback behavior", () => {
  it("4. embedded Safari + internal anchor + mouseup + NO native click -> exactly one anchor.click()", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    assert.equal(doc.listeners.mouseup.length, 1);
    const anchor = makeAnchor({ href: "/workspace/abc" });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 1);
    sched.flush();
    assert.equal(anchor.clickCount, 1);
  });

  it("5. native click before fallback timer -> zero synthetic clicks", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/workspace/abc" });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 1);
    // Native click arrives for the same anchor before the next task.
    doc.dispatch("click", { target: anchor });
    assert.equal(sched.pendingCount(), 0);
    sched.flush();
    assert.equal(anchor.clickCount, 0);
  });

  it("6. modifier keys -> no fallback", () => {
    for (const modifiers of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const doc = makeDocument();
      const win = makeWindow({ doc });
      const sched = makeScheduler();
      __resetSafariIframeLinkFixForTests();
      initSafariIframeLinkFix({
        window: win,
        document: doc,
        config: { safariIframeLinkFix: true },
        userAgent: SAFARI_UA,
        vendor: SAFARI_VENDOR,
        schedule: sched.schedule,
        cancelSchedule: sched.cancelSchedule,
      });
      const anchor = makeAnchor({ href: "/workspace/abc" });
      doc.dispatch("mouseup", mouseUpEvent(anchor, modifiers));
      assert.equal(sched.pendingCount(), 0);
      sched.flush();
      assert.equal(anchor.clickCount, 0);
    }
  });

  it("7. middle/right button -> no fallback", () => {
    for (const button of [1, 2]) {
      const doc = makeDocument();
      const win = makeWindow({ doc });
      const sched = makeScheduler();
      __resetSafariIframeLinkFixForTests();
      initSafariIframeLinkFix({
        window: win,
        document: doc,
        config: { safariIframeLinkFix: true },
        userAgent: SAFARI_UA,
        vendor: SAFARI_VENDOR,
        schedule: sched.schedule,
        cancelSchedule: sched.cancelSchedule,
      });
      const anchor = makeAnchor({ href: "/workspace/abc" });
      doc.dispatch("mouseup", mouseUpEvent(anchor, { button }));
      assert.equal(sched.pendingCount(), 0);
      sched.flush();
      assert.equal(anchor.clickCount, 0);
    }
  });

  it("8. external URL -> no fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "https://external.example.com/page" });
    assert.equal(
      isEligibleAnchor(anchor, {
        origin: ORIGIN,
        baseHref: `${ORIGIN}/`,
      }),
      false
    );
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 0);
    sched.flush();
    assert.equal(anchor.clickCount, 0);
  });

  it("mailto/tel/javascript URLs -> no fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    for (const href of [
      "mailto:someone@example.com",
      "tel:+123456789",
      "javascript:void(0)",
    ]) {
      const anchor = makeAnchor({ href });
      assert.equal(
        isEligibleAnchor(anchor, { origin: ORIGIN, baseHref: `${ORIGIN}/` }),
        false
      );
      doc.dispatch("mouseup", mouseUpEvent(anchor));
    }
    assert.equal(sched.pendingCount(), 0);
  });

  it("9. _blank -> no fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/workspace/abc", target: "_blank" });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 0);
    sched.flush();
    assert.equal(anchor.clickCount, 0);
  });

  it("10. download -> no fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/file.pdf", download: true });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 0);
    sched.flush();
    assert.equal(anchor.clickCount, 0);
  });

  it("11. anchor removed before fallback fires -> no fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/workspace/abc", connected: true });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 1);
    anchor.isConnected = false;
    sched.flush();
    assert.equal(anchor.clickCount, 0);
  });

  it("12. repeated initialization -> listeners installed only once", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    const cleanupA = initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const addCallsAfterFirst = doc.addCalls;
    const cleanupB = initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    assert.equal(cleanupA, cleanupB);
    assert.equal(doc.addCalls, addCallsAfterFirst);
    assert.equal(doc.listeners.mouseup.length, 1);
    assert.equal(doc.listeners.click.length, 1);
    // Cleanup removes listeners so re-init works.
    cleanupA();
    assert.equal(doc.listeners.mouseup.length, 0);
  });

  it("13. synthetic anchor.click() must not recursively schedule another fallback", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    let clickDispatched = 0;
    const anchor = makeAnchor({
      href: "/workspace/abc",
      onClick: () => {
        // Real browsers synchronously dispatch a click event from
        // anchor.click(). It must only cancel (already cleared) state, never
        // schedule a new fallback.
        clickDispatched += 1;
        doc.dispatch("click", { target: anchor });
      },
    });
    doc.dispatch("mouseup", mouseUpEvent(anchor));
    assert.equal(sched.pendingCount(), 1);
    sched.flush();
    assert.equal(anchor.clickCount, 1);
    assert.equal(clickDispatched, 1);
    assert.equal(sched.pendingCount(), 0);
    // No extra mouseup was involved, so no second navigation.
    sched.flush();
    assert.equal(anchor.clickCount, 1);
  });

  it("finds anchors via event.target.closest (child clicks)", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/workspace/abc" });
    const child = makeChildOf(anchor);
    doc.dispatch("mouseup", mouseUpEvent(child));
    assert.equal(sched.pendingCount(), 1);
    sched.flush();
    assert.equal(anchor.clickCount, 1);
  });

  it("does not preventDefault the physical mouseup", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    const anchor = makeAnchor({ href: "/workspace/abc" });
    let prevented = false;
    const event = mouseUpEvent(anchor);
    event.preventDefault = () => {
      prevented = true;
    };
    doc.dispatch("mouseup", event);
    assert.equal(prevented, false);
  });

  it("ignores non-anchor targets and defaultPrevented mouseup", () => {
    const doc = makeDocument();
    const win = makeWindow({ doc });
    const sched = makeScheduler();
    initSafariIframeLinkFix({
      window: win,
      document: doc,
      config: { safariIframeLinkFix: true },
      userAgent: SAFARI_UA,
      vendor: SAFARI_VENDOR,
      schedule: sched.schedule,
      cancelSchedule: sched.cancelSchedule,
    });
    doc.dispatch("mouseup", mouseUpEvent({ closest: () => null }));
    doc.dispatch(
      "mouseup",
      mouseUpEvent(makeAnchor({ href: "/workspace/abc" }), {
        defaultPrevented: true,
      })
    );
    assert.equal(sched.pendingCount(), 0);
    assert.equal(
      isEligibleMouseUpEvent({ button: 0, defaultPrevented: true }),
      false
    );
  });
});
