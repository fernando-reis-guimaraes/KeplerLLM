const {
  parseBooleanEnv,
} = require("../../../utils/helpers/parseBooleanEnv");

describe("parseBooleanEnv (shared strict boolean env parser)", () => {
  it("resolves undefined and null to false", () => {
    expect(parseBooleanEnv(undefined)).toBe(false);
    expect(parseBooleanEnv(null)).toBe(false);
  });

  it("resolves boolean inputs directly", () => {
    expect(parseBooleanEnv(false)).toBe(false);
    expect(parseBooleanEnv(true)).toBe(true);
  });

  it("resolves numeric inputs strictly", () => {
    expect(parseBooleanEnv(0)).toBe(false);
    expect(parseBooleanEnv(1)).toBe(true);
  });

  it("resolves the core string allowlist", () => {
    expect(parseBooleanEnv("")).toBe(false);
    expect(parseBooleanEnv("0")).toBe(false);
    expect(parseBooleanEnv("1")).toBe(true);
    expect(parseBooleanEnv("false")).toBe(false);
    expect(parseBooleanEnv("true")).toBe(true);
  });

  it("trims whitespace and compares case-insensitively", () => {
    expect(parseBooleanEnv(" FALSE ")).toBe(false);
    expect(parseBooleanEnv(" TRUE ")).toBe(true);
    expect(parseBooleanEnv(" 0 ")).toBe(false);
    expect(parseBooleanEnv(" 1 ")).toBe(true);
    expect(parseBooleanEnv("TRUE")).toBe(true);
    expect(parseBooleanEnv(" true ")).toBe(true);
  });

  it("resolves every other value to false without throwing", () => {
    expect(parseBooleanEnv("null")).toBe(false);
    expect(parseBooleanEnv("undefined")).toBe(false);
    expect(parseBooleanEnv("yes")).toBe(false);
    expect(parseBooleanEnv("no")).toBe(false);
    expect(parseBooleanEnv("on")).toBe(false);
    expect(parseBooleanEnv("off")).toBe(false);
    expect(parseBooleanEnv("abc")).toBe(false);
    expect(parseBooleanEnv("TRUE-ish")).toBe(false);
    expect(parseBooleanEnv("2")).toBe(false);
    expect(parseBooleanEnv("  ")).toBe(false);
    expect(parseBooleanEnv({})).toBe(false);
    expect(parseBooleanEnv([])).toBe(false);
  });

  it("does not use JavaScript truthiness for 'false'-like strings", () => {
    // Guard against !!value / Boolean(value) implementations where
    // non-empty strings such as "false" are truthy.
    for (const value of ["false", "0", "no", "off", "null", "undefined"]) {
      expect(Boolean(value)).toBe(true);
      expect(parseBooleanEnv(value)).toBe(false);
    }
  });
});
