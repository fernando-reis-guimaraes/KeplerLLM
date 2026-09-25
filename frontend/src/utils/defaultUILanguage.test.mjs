import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLICIT_LANGUAGE_KEY,
  normalizeLanguageTag,
  resolveSupportedLanguage,
  resolveInitialLanguage,
  resolveEffectiveLanguage,
  readExplicitLanguage,
  writeExplicitLanguage,
  readRuntimeDefaultLanguage,
  createKeplerllmExplicitDetector,
  createKeplerllmDefaultDetector,
} from "./defaultUILanguage.js";
import { resources } from "../locales/resources.js";

const SUPPORTED = ["en", "pt", "es", "fr"];

// Minimal localStorage-shaped fake holding raw string values by key.
function memoryStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    snapshot: () => ({ ...store }),
  };
}

describe("explicit preference vs automatically cached i18nextLng", () => {
  it("auto-cached i18nextLng must not override the runtime default", () => {
    const storage = memoryStorage({ i18nextLng: "en" });
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "pt" },
      browserLanguage: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");
  });

  it("explicit user choice overrides the runtime default", () => {
    const storage = memoryStorage({
      i18nextLng: "en",
      [EXPLICIT_LANGUAGE_KEY]: "es",
    });
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "pt" },
      browserLanguage: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("runtime default may change between deployments", () => {
    const storage = memoryStorage({ i18nextLng: "pt" });
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "en" },
      browserLanguage: "pt",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "en");
  });

  it("explicit user preference survives runtime default changes", () => {
    const storage = memoryStorage({ [EXPLICIT_LANGUAGE_KEY]: "pt" });
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "en" },
      browserLanguage: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");
  });

  it("no runtime default preserves browser detection", () => {
    const storage = memoryStorage();
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: {},
      browserLanguage: "es",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("invalid explicit preference is ignored safely", () => {
    const storage = memoryStorage({ [EXPLICIT_LANGUAGE_KEY]: "xx" });
    assert.equal(readExplicitLanguage(SUPPORTED, storage), null);
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "pt" },
      browserLanguage: "es",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");

    const withoutDefault = resolveEffectiveLanguage({
      storage,
      runtimeConfig: {},
      browserLanguage: "es",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(withoutDefault, "es");

    const fallbackOnly = resolveEffectiveLanguage({
      storage,
      runtimeConfig: {},
      browserLanguage: "xx",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(fallbackOnly, "en");
  });
});

describe("manual selection persistence", () => {
  it("writes only a validated manually selected language", () => {
    const storage = memoryStorage({ i18nextLng: "en" });
    assert.equal(writeExplicitLanguage("es", SUPPORTED, storage), true);
    assert.equal(storage.snapshot()[EXPLICIT_LANGUAGE_KEY], "es");
    // The generic i18next cache is left untouched by the explicit write.
    assert.equal(storage.snapshot().i18nextLng, "en");
  });

  it("refuses to persist invalid selections", () => {
    const storage = memoryStorage();
    assert.equal(writeExplicitLanguage("xx", SUPPORTED, storage), false);
    assert.equal(writeExplicitLanguage("<script>", SUPPORTED, storage), false);
    assert.equal(writeExplicitLanguage("", SUPPORTED, storage), false);
    assert.deepEqual(storage.snapshot(), {});
  });

  it("a persisted manual selection wins on the next visit", () => {
    const storage = memoryStorage({ i18nextLng: "en" });
    writeExplicitLanguage("es", SUPPORTED, storage);
    const resolved = resolveEffectiveLanguage({
      storage,
      runtimeConfig: { defaultUILanguage: "pt" },
      browserLanguage: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });
});

describe("defaultUILanguage precedence (pure resolver)", () => {
  it("unset variable preserves existing behavior (browser detection wins)", () => {
    const resolved = resolveInitialLanguage({
      explicitLanguage: null,
      runtimeDefault: null,
      detectedLanguage: "es",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("DEFAULT_UI_LANGUAGE=pt defaults to Portuguese", () => {
    const resolved = resolveInitialLanguage({
      explicitLanguage: null,
      runtimeDefault: "pt",
      detectedLanguage: "en",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");
  });

  it("explicit saved user preference overrides the env default", () => {
    const resolved = resolveInitialLanguage({
      explicitLanguage: "es",
      runtimeDefault: "pt",
      detectedLanguage: "en",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("unsupported env value is ignored safely", () => {
    const resolved = resolveInitialLanguage({
      explicitLanguage: null,
      runtimeDefault: "xx",
      detectedLanguage: "es",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");

    const fallbackOnly = resolveInitialLanguage({
      explicitLanguage: null,
      runtimeDefault: "xx",
      detectedLanguage: null,
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(fallbackOnly, "en");
  });

  it("English fallback still works", () => {
    const resolved = resolveInitialLanguage({
      explicitLanguage: null,
      runtimeDefault: null,
      detectedLanguage: "xx",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "en");
  });
});

describe("defaultUILanguage validation", () => {
  it("validates against the locale keys exported by resources.js", () => {
    assert.ok(Object.keys(resources).includes("en"));
    assert.ok(Object.keys(resources).includes("pt"));
    assert.equal(resolveSupportedLanguage("pt", Object.keys(resources)), "pt");
    assert.equal(resolveSupportedLanguage("xx", Object.keys(resources)), null);
  });

  it("pt selects the existing Brazilian Portuguese translation key", () => {
    const keys = Object.keys(resources);
    assert.ok(keys.includes("pt"));
    assert.equal(
      readRuntimeDefaultLanguage(keys, { defaultUILanguage: "pt" }),
      "pt"
    );
  });

  it("normalizes input without breaking locale naming", () => {
    assert.equal(normalizeLanguageTag(" PT "), "pt");
    assert.equal(normalizeLanguageTag("pt_BR"), "pt-br");
    assert.equal(
      resolveSupportedLanguage("pt_BR", Object.keys(resources)),
      "pt"
    );
    assert.equal(
      resolveSupportedLanguage("pt-BR", Object.keys(resources)),
      "pt"
    );
    assert.equal(resolveSupportedLanguage("", SUPPORTED), null);
    assert.equal(resolveSupportedLanguage("<script>", SUPPORTED), null);
  });

  it("reads the runtime default from window.__KEPLERLLM_CONFIG__", () => {
    const original = globalThis.__KEPLERLLM_CONFIG__;
    try {
      globalThis.__KEPLERLLM_CONFIG__ = { defaultUILanguage: "pt" };
      assert.equal(readRuntimeDefaultLanguage(SUPPORTED), "pt");
      globalThis.__KEPLERLLM_CONFIG__ = {};
      assert.equal(readRuntimeDefaultLanguage(SUPPORTED), null);
    } finally {
      if (original === undefined) delete globalThis.__KEPLERLLM_CONFIG__;
      else globalThis.__KEPLERLLM_CONFIG__ = original;
    }
  });

  it("custom detectors resolve explicit preference and runtime default", () => {
    const storage = memoryStorage({ [EXPLICIT_LANGUAGE_KEY]: "es" });
    const originalStorage = globalThis.localStorage;
    try {
      Object.defineProperty(globalThis, "localStorage", {
        value: storage,
        configurable: true,
      });
      const explicit = createKeplerllmExplicitDetector(SUPPORTED);
      assert.equal(explicit.lookup(), "es");

      const originalConfig = globalThis.__KEPLERLLM_CONFIG__;
      globalThis.__KEPLERLLM_CONFIG__ = { defaultUILanguage: "pt" };
      try {
        const runtimeDefault = createKeplerllmDefaultDetector(SUPPORTED);
        assert.equal(runtimeDefault.lookup(), "pt");
      } finally {
        if (originalConfig === undefined)
          delete globalThis.__KEPLERLLM_CONFIG__;
        else globalThis.__KEPLERLLM_CONFIG__ = originalConfig;
      }
    } finally {
      if (originalStorage === undefined) delete globalThis.localStorage;
      else
        Object.defineProperty(globalThis, "localStorage", {
          value: originalStorage,
          configurable: true,
        });
    }

    const emptyDetector = createKeplerllmExplicitDetector(SUPPORTED);
    assert.equal(emptyDetector.lookup(), undefined);
  });
});
