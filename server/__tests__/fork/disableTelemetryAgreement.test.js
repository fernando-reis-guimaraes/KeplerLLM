// KeplerLLM fork: DISABLE_TELEMETRY agreement regression test.
//
// The backend enforcement (Telemetry.client() / setupTelemetry via
// parseBooleanEnv) and the server API representation
// (SystemSettings.currentSettings().DisableTelemetry, consumed by the
// frontend string contract `settings?.DisableTelemetry !== "true"`) must
// always agree: only "true"/"1" (trimmed, case-insensitive) disable
// telemetry. The frontend contract stays a string ("true"/"false").

jest.mock("../../utils/prisma", () => ({
  system_settings: {
    findFirst: jest.fn(async () => null),
    findMany: jest.fn(async () => []),
  },
  users: { count: jest.fn(async () => 0) },
  workspace_documents: { count: jest.fn(async () => 0) },
}));

const { SystemSettings } = require("../../models/systemSettings");
const { Telemetry } = require("../../models/telemetry");

const ENV_VAR = "DISABLE_TELEMETRY";

// Restores the env after fn() completes. Awaits async callbacks so the env
// is still set when their awaits resume (a bare `return fn()` would run the
// restore as soon as the pending promise is returned).
function withEnv(value, fn) {
  const had = ENV_VAR in process.env;
  const saved = process.env[ENV_VAR];
  const restore = () => {
    if (had) process.env[ENV_VAR] = saved;
    else delete process.env[ENV_VAR];
  };
  if (value === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = value;
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (resolved) => {
        restore();
        return resolved;
      },
      (error) => {
        restore();
        throw error;
      }
    );
  }
  restore();
  return result;
}

// Mirrors the frontend contract without importing frontend code:
// settings?.DisableTelemetry !== "true" means telemetry shows as enabled.
function frontendShowsTelemetryEnabled(settings) {
  return settings?.DisableTelemetry !== "true";
}

describe("DISABLE_TELEMETRY enforcement/API agreement", () => {
  it.each([
    [undefined, "false", true],
    ["", "false", true],
    ["false", "false", true],
    ["FALSE", "false", true],
    [" false ", "false", true],
    ["0", "false", true],
    [" 0 ", "false", true],
    ["abc", "false", true],
    ["null", "false", true],
    ["yes", "false", true],
    ["true", "true", false],
    ["TRUE", "true", false],
    [" true ", "true", false],
    ["1", "true", false],
    [" 1 ", "true", false],
  ])(
    "env=%p -> currentSettings %p, enforcement %s",
    async (envValue, expectedApi, enforcementEnabled) => {
      await withEnv(envValue, async () => {
        const settings = await SystemSettings.currentSettings();
        // API representation is the normalized string contract.
        expect(typeof settings.DisableTelemetry).toBe("string");
        expect(settings.DisableTelemetry).toBe(expectedApi);
        // Backend enforcement agrees with the API representation.
        const client = Telemetry.client();
        expect(client !== null).toBe(enforcementEnabled);
        expect(client !== null).toBe(
          frontendShowsTelemetryEnabled(settings)
        );
      });
    }
  );

  it("DISABLE_TELEMETRY=1 disables enforcement and reports \"true\"", async () => {
    await withEnv("1", async () => {
      expect(Telemetry.client()).toBe(null);
      const settings = await SystemSettings.currentSettings();
      expect(settings.DisableTelemetry).toBe("true");
    });
  });

  it("DISABLE_TELEMETRY=TRUE disables enforcement and reports \"true\"", async () => {
    await withEnv("TRUE", async () => {
      expect(Telemetry.client()).toBe(null);
      const settings = await SystemSettings.currentSettings();
      expect(settings.DisableTelemetry).toBe("true");
    });
  });

  it("DISABLE_TELEMETRY=false enables enforcement and reports \"false\"", async () => {
    await withEnv("false", async () => {
      expect(Telemetry.client()).not.toBe(null);
      const settings = await SystemSettings.currentSettings();
      expect(settings.DisableTelemetry).toBe("false");
    });
  });

  it("DISABLE_TELEMETRY=0 enables enforcement and reports \"false\"", async () => {
    await withEnv("0", async () => {
      expect(Telemetry.client()).not.toBe(null);
      const settings = await SystemSettings.currentSettings();
      expect(settings.DisableTelemetry).toBe("false");
    });
  });

  it("DISABLE_TELEMETRY=abc enables enforcement and reports \"false\"", async () => {
    await withEnv("abc", async () => {
      expect(Telemetry.client()).not.toBe(null);
      const settings = await SystemSettings.currentSettings();
      expect(settings.DisableTelemetry).toBe("false");
    });
  });
});
