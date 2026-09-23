const { checkParity } = require("../../../scripts/check-prisma-parity.cjs");

// KeplerLLM fork: the SQLite and PostgreSQL Prisma schemas must stay
// model-compatible. Only the datasource provider (and provider-specific header
// comments) may differ. This pins the dual-backend contract so an upstream
// merge cannot silently drift one schema.
describe("Prisma SQLite/PostgreSQL schema parity", () => {
  it("keeps generator and model definitions in sync", () => {
    const result = checkParity();
    if (!result.equal) {
      const aLines = result.sqliteNorm.split("\n");
      const bLines = result.pgNorm.split("\n");
      const max = Math.max(aLines.length, bLines.length);
      let firstDiff = -1;
      for (let i = 0; i < max; i += 1) {
        if (aLines[i] !== bLines[i]) {
          firstDiff = i;
          break;
        }
      }
      throw new Error(
        `Prisma schemas drifted (sqlite ${result.sqliteHash} vs postgres ${result.pgHash}). ` +
          `First difference at normalized line ${firstDiff + 1}: ` +
          `sqlite=${JSON.stringify(aLines[firstDiff])} postgres=${JSON.stringify(bLines[firstDiff])}. ` +
          `Keep server/prisma/schema.prisma and server/prisma/postgresql/schema.prisma model-compatible.`
      );
    }
    expect(result.equal).toBe(true);
  });
});
