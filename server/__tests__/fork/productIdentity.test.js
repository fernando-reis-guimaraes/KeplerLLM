const fs = require("fs");
const path = require("path");

// KeplerLLM fork: user-visible product text must say KeplerLLM while every
// technical contract (identifiers, paths, keys, routes, tokens, URLs)
// stays on the upstream values. These guards pin the rebrand surface so an
// upstream merge cannot silently reintroduce the old brand where users see it.

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BRAND = "AnythingLLM";

function readRepoFile(...segments) {
  return fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf8");
}

function listFilesRecursive(dir, extension = ".js") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(full, extension));
    else if (entry.name.endsWith(extension)) files.push(full);
  }
  return files;
}

describe("KeplerLLM product identity in user-visible text", () => {
  it("has no upstream brand left in frontend translation values", () => {
    const localesDir = path.join(REPO_ROOT, "frontend", "src", "locales");
    const offenders = listFilesRecursive(localesDir).filter((file) =>
      fs.readFileSync(file, "utf8").includes(BRAND)
    );
    expect(offenders).toEqual([]);
  });

  it("titles the browser tab and PWA manifest as KeplerLLM", () => {
    const indexHtml = readRepoFile("frontend", "index.html");
    expect(indexHtml).toMatch(/<title>KeplerLLM \|/);
    expect(indexHtml).not.toContain(BRAND);

    const manifest = JSON.parse(
      readRepoFile("frontend", "public", "manifest.json")
    );
    expect(manifest.name).toBe("KeplerLLM");
    expect(manifest.short_name).toBe("KeplerLLM");
  });

  it("defaults server-rendered page metadata to KeplerLLM", () => {
    const metaGenerator = readRepoFile(
      "server",
      "utils",
      "boot",
      "MetaGenerator.js"
    );
    expect(metaGenerator).toContain('name: "KeplerLLM"');
    expect(metaGenerator).not.toContain(
      "AnythingLLM | Your personal LLM trained on anything"
    );
  });

  it("defaults the embed widget text to KeplerLLM", () => {
    const scriptAttributes = readRepoFile(
      "embed",
      "src",
      "hooks",
      "useScriptAttributes.js"
    );
    expect(scriptAttributes).toContain("Powered by KeplerLLM");
    expect(scriptAttributes).toContain("KeplerLLM Chat Assistant");
  });

  it("titles the developer API documentation as KeplerLLM", () => {
    const openapi = JSON.parse(
      readRepoFile("server", "swagger", "openapi.json")
    );
    expect(openapi.info.title).toBe("KeplerLLM Developer API");
  });

  it("points external product links at KeplerLLM properties", () => {
    const paths = readRepoFile("frontend", "src", "utils", "paths.js");
    expect(paths).toContain('"https://github.com/ultra-mega-apps"');
    expect(paths).toContain('"https://wa.me/13025505015"');
    expect(paths).toContain('"https://ultra-mega-apps.com');
    expect(paths).not.toContain("discord.com/invite");
    expect(paths).not.toContain("mintplexlabs.com");
    expect(paths).not.toContain("Mintplex-Labs");

    const footer = readRepoFile(
      "frontend",
      "src",
      "components",
      "Footer",
      "index.jsx"
    );
    expect(footer).toContain("paths.whatsapp()");
    expect(footer).not.toContain("paths.discord()");
  });
});
