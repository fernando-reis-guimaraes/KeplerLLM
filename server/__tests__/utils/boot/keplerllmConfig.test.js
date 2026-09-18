const {
  DEFAULT_MODEL_DISPLAY_NAME,
  resolveModelDisplayName,
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
    });
  });

  it("embeds the operator override", () => {
    const script = keplerllmConfigScript({
      KEPLERLLM_MODEL_DISPLAY_NAME: "Acme Chat",
    });
    expect(JSON.parse(payloadOf(script))).toEqual({
      modelDisplayName: "Acme Chat",
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
});
