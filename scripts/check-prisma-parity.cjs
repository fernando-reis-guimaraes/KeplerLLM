const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// KeplerLLM: guard against silent drift between the SQLite and PostgreSQL
// Prisma schemas. Both files must define the same generator and models; only
// the datasource provider (and provider-specific header comments) may differ.
const SQLITE_SCHEMA = path.resolve(
  __dirname,
  "..",
  "server",
  "prisma",
  "schema.prisma"
);
const PG_SCHEMA = path.resolve(
  __dirname,
  "..",
  "server",
  "prisma",
  "postgresql",
  "schema.prisma"
);

const PROVIDER_KEYWORDS = [
  "sqlite",
  "postgres",
  "database_url",
  "anythingllm.db",
  "prisma:setup",
  "uncomment",
  "swapping",
  "datasource",
  ".env",
];

function stripDatasourceBlocks(content) {
  // Remove active `datasource db { ... }` blocks. Prisma datasource blocks do
  // not nest, so a non-greedy match up to the first closing brace is enough.
  return content.replace(/datasource\s+db\s*\{[^}]*\}/gs, "");
}

function isProviderSpecificComment(trimmedLine) {
  const lower = trimmedLine.toLowerCase();
  return PROVIDER_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function normalizeSchema(content) {
  const withoutDatasource = stripDatasourceBlocks(content);
  const lines = withoutDatasource.split(/\r?\n/);

  let firstModelIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith("model ") ||
      trimmed.startsWith("enum ") ||
      trimmed.startsWith("view ")
    );
  });
  if (firstModelIndex === -1) firstModelIndex = lines.length;

  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const isFullLineComment = trimmed.startsWith("//");

    if (i < firstModelIndex) {
      // Header area (generator + old swap instructions + commented datasource).
      // Drop every full-line comment so header wording differences cannot hide
      // model drift and cannot cause false mismatches either.
      if (isFullLineComment) continue;
    } else if (isFullLineComment && isProviderSpecificComment(trimmed)) {
      continue;
    }

    kept.push(line.replace(/[ \t]+$/g, ""));
  }

  // Deterministic blank-line handling: collapse runs of blanks, trim edges.
  const collapsed = [];
  let prevBlank = false;
  for (const line of kept) {
    const isBlank = line.trim() === "";
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }
  while (collapsed.length > 0 && collapsed[0].trim() === "") collapsed.shift();
  while (
    collapsed.length > 0 &&
    collapsed[collapsed.length - 1].trim() === ""
  )
    collapsed.pop();

  return `${collapsed.join("\n")}\n`;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function diffPreview(aLines, bLines, context = 3) {
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i += 1) {
    if (aLines[i] !== bLines[i]) {
      const start = Math.max(0, i - context);
      const end = Math.min(max, i + context + 1);
      const out = [];
      out.push(`First difference at normalized line ${i + 1}:`);
      for (let j = start; j < end; j += 1) {
        const marker = j === i ? ">>" : "  ";
        out.push(
          `${marker} sqlite:${j + 1}:${aLines[j] === undefined ? "<missing>" : JSON.stringify(aLines[j])}`
        );
        out.push(
          `${marker} postgres:${j + 1}:${bLines[j] === undefined ? "<missing>" : JSON.stringify(bLines[j])}`
        );
      }
      return out.join("\n");
    }
  }
  return "No line differences found (length mismatch only).";
}

function checkParity(sqlitePath = SQLITE_SCHEMA, pgPath = PG_SCHEMA) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite schema not found: ${sqlitePath}`);
  }
  if (!fs.existsSync(pgPath)) {
    throw new Error(`PostgreSQL schema not found: ${pgPath}`);
  }
  const sqliteRaw = fs.readFileSync(sqlitePath, "utf8");
  const pgRaw = fs.readFileSync(pgPath, "utf8");
  const sqliteNorm = normalizeSchema(sqliteRaw);
  const pgNorm = normalizeSchema(pgRaw);
  const sqliteHash = sha256(sqliteNorm);
  const pgHash = sha256(pgNorm);
  const equal = sqliteNorm === pgNorm;
  return {
    equal,
    sqlitePath,
    pgPath,
    sqliteHash,
    pgHash,
    sqliteNorm,
    pgNorm,
  };
}

function main() {
  let result;
  try {
    result = checkParity();
  } catch (error) {
    console.error(`Prisma schema parity check failed: ${error.message}`);
    process.exit(1);
  }

  if (result.equal) {
    console.log("Prisma schema parity: OK");
    console.log(`SQLite: ${result.sqlitePath}`);
    console.log(`PostgreSQL: ${result.pgPath}`);
    console.log(`Normalized sha256: ${result.sqliteHash}`);
    return;
  }

  console.error("Prisma schema parity: FAILED");
  console.error(`SQLite schema: ${result.sqlitePath} (sha256 ${result.sqliteHash})`);
  console.error(`PostgreSQL schema: ${result.pgPath} (sha256 ${result.pgHash})`);
  console.error(
    "The generator/model definitions differ after ignoring the datasource block and provider-specific comments."
  );
  console.error(
    "Keep server/prisma/schema.prisma and server/prisma/postgresql/schema.prisma model-compatible."
  );
  console.error(
    diffPreview(
      result.sqliteNorm.split("\n"),
      result.pgNorm.split("\n")
    )
  );
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SQLITE_SCHEMA,
  PG_SCHEMA,
  normalizeSchema,
  stripDatasourceBlocks,
  checkParity,
};
