const fs = require("fs");

// KeplerLLM fork: default workspace bootstrap must complete BEFORE the
// HTTP/HTTPS listening socket becomes available, and invalid bootstrap
// configuration must fail before the port is advertised. These tests verify
// that ordering with the boot module's dependencies mocked out.

jest.mock("../../../models/telemetry", () => ({
  Telemetry: { flush: jest.fn() },
}));
jest.mock("../../../utils/BackgroundWorkers", () => ({
  BackgroundService: jest.fn().mockImplementation(() => ({ boot: jest.fn() })),
}));
jest.mock("../../../utils/EncryptionManager", () => ({
  EncryptionManager: jest.fn(),
}));
jest.mock("../../../utils/comKey", () => ({
  CommunicationKey: jest.fn(),
}));
jest.mock("../../../utils/telemetry", () => jest.fn());
jest.mock("../../../utils/boot/eagerLoadContextWindows", () => jest.fn());
jest.mock("../../../utils/boot/markOnboarded", () => jest.fn());
jest.mock("../../../utils/PushNotifications", () => ({
  PushNotifications: { setupPushNotificationService: jest.fn() },
}));
jest.mock("../../../utils/telegramBot", () => ({
  TelegramBotService: { bootIfActive: jest.fn() },
}));
jest.mock("../../../utils/boot/defaultWorkspace", () => ({
  bootstrapDefaultWorkspace: jest.fn(),
}));
jest.mock("https", () => ({
  createServer: jest.fn(),
}));
jest.mock("@mintplex-labs/express-ws", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const {
  bootstrapDefaultWorkspace,
} = require("../../../utils/boot/defaultWorkspace");
const { bootHTTP, bootSSL } = require("../../../utils/boot/index");
const markOnboarded = require("../../../utils/boot/markOnboarded");
const https = require("https");

const BOOTSTRAP_SENTINEL = new Error("__bootstrap_exit__");

let savedKeyPath;
let savedCertPath;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  savedKeyPath = process.env.HTTPS_KEY_PATH;
  savedCertPath = process.env.HTTPS_CERT_PATH;
  process.env.HTTPS_KEY_PATH = "/tmp/keplerllm-fake-key.pem";
  process.env.HTTPS_CERT_PATH = "/tmp/keplerllm-fake-cert.pem";
});

afterEach(() => {
  if (savedKeyPath === undefined) delete process.env.HTTPS_KEY_PATH;
  else process.env.HTTPS_KEY_PATH = savedKeyPath;
  if (savedCertPath === undefined) delete process.env.HTTPS_CERT_PATH;
  else process.env.HTTPS_CERT_PATH = savedCertPath;
  jest.restoreAllMocks();
});

function fakeHttpApp(order) {
  return {
    listen: jest.fn(( _port, onReady) => {
      order.push("listen");
      return { on: jest.fn() };
    }),
  };
}

describe("boot ordering: default workspace bootstrap runs pre-listen", () => {
  it("bootHTTP awaits bootstrap before app.listen", async () => {
    const order = [];
    bootstrapDefaultWorkspace.mockImplementation(async () => {
      order.push("bootstrap");
      return { bootstrapped: false, reason: "disabled" };
    });
    const app = fakeHttpApp(order);

    await bootHTTP(app, 3123);

    expect(order).toEqual(["bootstrap", "listen"]);
    expect(bootstrapDefaultWorkspace).toHaveBeenCalledTimes(1);
    expect(app.listen).toHaveBeenCalledTimes(1);
  });

  it("bootHTTP still runs post-listen boot steps in the ready callback", async () => {
    bootstrapDefaultWorkspace.mockResolvedValue({
      bootstrapped: false,
      reason: "disabled",
    });
    let onReady;
    const app = {
      listen: jest.fn(( _port, cb) => {
        onReady = cb;
        return { on: jest.fn() };
      }),
    };

    await bootHTTP(app, 3123);
    await onReady();

    expect(markOnboarded).toHaveBeenCalledTimes(1);
  });

  it("bootHTTP never listens when bootstrap fails", async () => {
    bootstrapDefaultWorkspace.mockRejectedValue(
      new Error("[KeplerLLM] DEFAULT_WORKSPACE_NAME is required")
    );
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw BOOTSTRAP_SENTINEL;
      });
    const app = fakeHttpApp([]);

    await expect(bootHTTP(app, 3123)).rejects.toBe(BOOTSTRAP_SENTINEL);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(app.listen).not.toHaveBeenCalled();
  });

  it("bootSSL awaits bootstrap before the HTTPS server listens", async () => {
    const order = [];
    bootstrapDefaultWorkspace.mockImplementation(async () => {
      order.push("bootstrap");
      return { bootstrapped: false, reason: "disabled" };
    });
    jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("fake-pem"));
    const httpsServer = {
      listen: jest.fn(( _port, _onReady) => {
        order.push("listen");
        return { on: jest.fn() };
      }),
    };
    https.createServer.mockReturnValue(httpsServer);

    await bootSSL({}, 3443);

    expect(order).toEqual(["bootstrap", "listen"]);
    expect(https.createServer).toHaveBeenCalledTimes(1);
    expect(httpsServer.listen).toHaveBeenCalledTimes(1);
  });

  it("bootSSL never listens when bootstrap fails", async () => {
    bootstrapDefaultWorkspace.mockRejectedValue(
      new Error("[KeplerLLM] DEFAULT_WORKSPACE_NAME is required")
    );
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw BOOTSTRAP_SENTINEL;
      });
    jest.spyOn(fs, "readFileSync").mockReturnValue(Buffer.from("fake-pem"));
    https.createServer.mockReturnValue({
      listen: jest.fn(() => ({ on: jest.fn() })),
    });

    await expect(bootSSL({}, 3443)).rejects.toBe(BOOTSTRAP_SENTINEL);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(https.createServer).not.toHaveBeenCalled();
  });
});
