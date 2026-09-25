const {
  DEFAULT_MODEL_DISPLAY_NAME,
  resolveModelDisplayName,
  resolveDefaultUILanguage,
  resolveHideToolsButton,
  resolveHideCreateAgentButton,
  resolveHideEditWorkspaceButton,
  resolveHideUploadDocumentButton,
  resolveVisibilityFlags,
  keplerllmConfigScript,
} = require("../../../utils/boot/keplerllmConfig");

describe("resolveModelDisplayName (KeplerLLM product model label)", () => {
  it("returns the default product label when the variable is unset", () => {
    expect(resolveModelDisplayName({})).toBe("Kepler AI");
    expect(resolveModelDisplayName()).toBe(
      process.env.KEPLERLLM_MODEL_DISPLAY_NAME ?? DEFAULT_MODEL_DISPLAY_NAME
    );
  });

  it("honors an operator-provided label", () => {
    expect(
      resolveModelDisplayName({ KEPLERLLM_MODEL_DISPLAY_NAME: "Acme Chat" })
    ).toBe("Acme Chat");
  });

  it("falls back to upstream resolution on empty overrides", () => {
    expect(resolveModelDisplayName({ KEPLERLLM_MODEL_DISPLAY_NAME: "" })).toBe(
      ""
    );
    expect(
      resolveModelDisplayName({ KEPLERLLM_MODEL_DISPLAY_NAME: "   " })
    ).toBe("");
  });

  it("trims surrounding whitespace from the label", () => {
    expect(
      resolveModelDisplayName({ KEPLERLLM_MODEL_DISPLAY_NAME: "  Kepler  " })
    ).toBe("Kepler");
  });
});

describe("keplerllmConfigScript (MetaGenerator boot script)", () => {
  function payloadOf(script) {
    return script.replace(
      /^<script>window\.__KEPLERLLM_CONFIG__=(.*);<\/script>$/,
      "$1"
    );
  }

  it("embeds the default label without rebuilding", () => {
    const script = keplerllmConfigScript({});
    expect(JSON.parse(payloadOf(script))).toEqual({
      modelDisplayName: "Kepler AI",
      defaultUILanguage: null,
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
  });

  it("embeds the operator override", () => {
    const script = keplerllmConfigScript({
      KEPLERLLM_MODEL_DISPLAY_NAME: "Acme Chat",
    });
    expect(JSON.parse(payloadOf(script))).toEqual({
      modelDisplayName: "Acme Chat",
      defaultUILanguage: null,
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
  });

  it("escapes markup so a label cannot break out of the script element", () => {
    const script = keplerllmConfigScript({
      KEPLERLLM_MODEL_DISPLAY_NAME: '</script><script>alert("x")</script>',
    });
    // Only the element's own closing tag may appear literally.
    expect(script.split("</script").length - 1).toBe(1);
    // The payload round-trips through JSON with the original value intact.
    expect(JSON.parse(payloadOf(script)).modelDisplayName).toBe(
      '</script><script>alert("x")</script>'
    );
  });

  it("embeds the runtime default UI language without rebuilding", () => {
    const script = keplerllmConfigScript({ DEFAULT_UI_LANGUAGE: "pt" });
    expect(JSON.parse(payloadOf(script))).toEqual({
      modelDisplayName: "Kepler AI",
      defaultUILanguage: "pt",
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
  });

  it("exposes only the safe language tag and no other environment values", () => {
    const script = keplerllmConfigScript({
      DEFAULT_UI_LANGUAGE: "pt",
      JWT_SECRET: "super-secret",
      OPEN_AI_KEY: "sk-secret",
    });
    const payload = JSON.parse(payloadOf(script));
    expect(payload).toEqual({
      modelDisplayName: "Kepler AI",
      defaultUILanguage: "pt",
      hideToolsButton: false,
      hideCreateAgentButton: false,
      hideEditWorkspaceButton: false,
      hideUploadDocumentButton: false,
    });
    expect(JSON.stringify(payload)).not.toContain("super-secret");
    expect(JSON.stringify(payload)).not.toContain("sk-secret");
  });
});

describe("resolveDefaultUILanguage (KeplerLLM default UI language)", () => {
  it("returns null when the variable is unset or empty", () => {
    expect(resolveDefaultUILanguage({})).toBe(null);
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "" })).toBe(null);
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "   " })).toBe(
      null
    );
  });

  it("normalizes the tag without a hardcoded language list", () => {
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "pt" })).toBe("pt");
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: " PT " })).toBe(
      "pt"
    );
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "pt_BR" })).toBe(
      "pt-br"
    );
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "zh_TW" })).toBe(
      "zh-tw"
    );
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "EN" })).toBe("en");
  });

  it("rejects malformed values safely", () => {
    expect(
      resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "<script>" })
    ).toBe(null);
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "pt!" })).toBe(
      null
    );
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: 12345 })).toBe(
      null
    );
  });
});

describe("resolveVisibilityFlags (KeplerLLM runtime UI visibility)", () => {
  const ALL_FALSE = {
    hideToolsButton: false,
    hideCreateAgentButton: false,
    hideEditWorkspaceButton: false,
    hideUploadDocumentButton: false,
  };

  it("returns all false when all variables are absent", () => {
    expect(resolveVisibilityFlags({})).toEqual(ALL_FALSE);
    expect(resolveHideToolsButton({})).toBe(false);
    expect(resolveHideCreateAgentButton({})).toBe(false);
    expect(resolveHideEditWorkspaceButton({})).toBe(false);
    expect(resolveHideUploadDocumentButton({})).toBe(false);
  });

  it("resolves each variable independently", () => {
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "true" })
    ).toEqual({ ...ALL_FALSE, hideToolsButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideCreateAgentButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideEditWorkspaceButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideUploadDocumentButton: true });
  });

  it("uses strict boolean semantics: only true/1 hide", () => {
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "TRUE" })
    ).toEqual({ ...ALL_FALSE, hideToolsButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: " true " })
    ).toEqual({ ...ALL_FALSE, hideToolsButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideToolsButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "true" })
    ).toEqual({ ...ALL_FALSE, hideCreateAgentButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideEditWorkspaceButton: true });
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: "1" })
    ).toEqual({ ...ALL_FALSE, hideUploadDocumentButton: true });
  });

  it('strict boolean semantics: VARIABLE="false" shows normally', () => {
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "false" })
    ).toEqual(ALL_FALSE);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "false" })
    ).toEqual(ALL_FALSE);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: "false" })
    ).toEqual(ALL_FALSE);
    expect(
      resolveVisibilityFlags({
        KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: "false",
      })
    ).toEqual(ALL_FALSE);
  });

  it('strict boolean semantics: VARIABLE="" shows normally', () => {
    expect(resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: "" })).toEqual(
      ALL_FALSE
    );
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "" })
    ).toEqual(ALL_FALSE);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: "" })
    ).toEqual(ALL_FALSE);
    expect(
      resolveVisibilityFlags({ KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: "" })
    ).toEqual(ALL_FALSE);
  });

  it('strict boolean semantics: "0"/"null"/"yes"/arbitrary values show normally', () => {
    for (const value of ["0", " 0 ", "null", "undefined", "yes", "no", "on", "off", "abc"]) {
      expect(
        resolveVisibilityFlags({ KEPLERLLM_HIDE_TOOLS_BUTTON: value })
      ).toEqual(ALL_FALSE);
      expect(
        resolveVisibilityFlags({ KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: value })
      ).toEqual(ALL_FALSE);
      expect(
        resolveVisibilityFlags({ KEPLERLLM_HIDE_EDIT_WORKSPACE_BUTTON: value })
      ).toEqual(ALL_FALSE);
      expect(
        resolveVisibilityFlags({
          KEPLERLLM_HIDE_UPLOAD_DOCUMENT_BUTTON: value,
        })
      ).toEqual(ALL_FALSE);
    }
  });

  it("ignores unrelated environment variables", () => {
    expect(
      resolveVisibilityFlags({
        JWT_SECRET: "super-secret",
        KEPLERLLM_MODEL_DISPLAY_NAME: "Acme",
        DEFAULT_UI_LANGUAGE: "pt",
        VITE_SOMETHING: "1",
      })
    ).toEqual(ALL_FALSE);
  });

  it("keeps modelDisplayName and defaultUILanguage behavior unchanged", () => {
    expect(resolveModelDisplayName({})).toBe("Kepler AI");
    expect(
      resolveModelDisplayName({ KEPLERLLM_MODEL_DISPLAY_NAME: "Acme Chat" })
    ).toBe("Acme Chat");
    expect(resolveDefaultUILanguage({})).toBe(null);
    expect(resolveDefaultUILanguage({ DEFAULT_UI_LANGUAGE: "pt" })).toBe("pt");
  });

  it("exposes only normalized booleans and no raw env values", () => {
    const script = keplerllmConfigScript({
      KEPLERLLM_HIDE_TOOLS_BUTTON: "super-secret-raw-value",
      KEPLERLLM_HIDE_CREATE_AGENT_BUTTON: "false",
      JWT_SECRET: "super-secret",
    });
    const payload = JSON.parse(
      script.replace(
        /^<script>window\.__KEPLERLLM_CONFIG__=(.*);<\/script>$/,
        "$1"
      )
    );
    expect(payload.hideToolsButton).toBe(false);
    expect(payload.hideCreateAgentButton).toBe(false);
    expect(payload.hideEditWorkspaceButton).toBe(false);
    expect(payload.hideUploadDocumentButton).toBe(false);
    expect(typeof payload.hideToolsButton).toBe("boolean");
    expect(JSON.stringify(payload)).not.toContain("super-secret-raw-value");
    expect(JSON.stringify(payload)).not.toContain("super-secret");
  });

  it("KEPLERLLM_HIDE_TOOLS_BUTTON=false results in hideToolsButton === false", () => {
    const script = keplerllmConfigScript({
      KEPLERLLM_HIDE_TOOLS_BUTTON: "false",
    });
    const payload = JSON.parse(
      script.replace(
        /^<script>window\.__KEPLERLLM_CONFIG__=(.*);<\/script>$/,
        "$1"
      )
    );
    expect(payload.hideToolsButton).toBe(false);
  });
});
