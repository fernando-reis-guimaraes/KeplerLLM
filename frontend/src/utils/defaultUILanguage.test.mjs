import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLanguageTag,
  resolveSupportedLanguage,
  resolveInitialLanguage,
  readRuntimeDefaultLanguage,
  readStoredLanguage,
} from "./defaultUILanguage.js";
import { resources } from "../locales/resources.js";

const SUPPORTED = ["en", "pt", "es", "fr"];

function memoryStorage(value) {
  return {
    getItem: () => value,
  };
}

describe("defaultUILanguage precedence", () => {
  it("unset variable preserves existing behavior (browser detection wins)", () => {
    const resolved = resolveInitialLanguage({
      storedLanguage: null,
      runtimeDefault: null,
      detectedLanguage: "es",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("DEFAULT_UI_LANGUAGE=pt defaults to Portuguese", () => {
    const resolved = resolveInitialLanguage({
      storedLanguage: null,
      runtimeDefault: "pt",
      detectedLanguage: "en",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");
  });

  it("explicit saved user preference overrides the env default", () => {
    const resolved = resolveInitialLanguage({
      storedLanguage: "es",
      runtimeDefault: "pt",
      detectedLanguage: "en",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");
  });

  it("unsupported env value is ignored safely", () => {
    const resolved = resolveInitialLanguage({
      storedLanguage: null,
      runtimeDefault: "xx",
      detectedLanguage: "es",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "es");

    const fallbackOnly = resolveInitialLanguage({
      storedLanguage: null,
      runtimeDefault: "xx",
      detectedLanguage: null,
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(fallbackOnly, "en");
  });

  it("English fallback still works", () => {
    const resolved = resolveInitialLanguage({
      storedLanguage: null,
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

  it("ignores an invalid stored value and falls through to the default", () => {
    const stored = readStoredLanguage(SUPPORTED, memoryStorage("xx"));
    assert.equal(stored, null);
    const resolved = resolveInitialLanguage({
      storedLanguage: stored,
      runtimeDefault: "pt",
      detectedLanguage: "en",
      fallbackLng: "en",
      supportedLanguages: SUPPORTED,
    });
    assert.equal(resolved, "pt");
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
});
