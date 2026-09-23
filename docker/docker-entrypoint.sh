#!/bin/bash

# Check if STORAGE_DIR is set
if [ -z "$STORAGE_DIR" ]; then
    echo "================================================================"
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo ""
    echo "Not setting this will result in data loss on container restart since"
    echo "the application will not have a persistent storage location."
    echo "It can also result in weird errors in various parts of the application."
    echo ""
    echo "Please run the container with the official docker command at"
    echo "https://docs.anythingllm.com/installation-docker/quickstart"
    echo ""
    echo "⚠️  ⚠️  ⚠️  WARNING: STORAGE_DIR environment variable is not set! ⚠️  ⚠️  ⚠️"
    echo "================================================================"
fi

{
  cd /app/server/ &&
    # Disable Prisma CLI telemetry (https://www.prisma.io/docs/orm/tools/prisma-cli#how-to-opt-out-of-data-collection)
    export CHECKPOINT_DISABLE=1 &&
    # KeplerLLM: dynamic database backend selection.
    # SQLite remains the default when DATABASE_URL is unset or empty.
    # When DATABASE_URL is set it must be a PostgreSQL URI; otherwise startup fails fast
    # without falling back to SQLite. Never log DATABASE_URL itself to avoid leaking credentials.
    PRISMA_SCHEMA="./prisma/schema.prisma" &&
    if [ -z "${DATABASE_URL:-}" ]; then
      PRISMA_SCHEMA="./prisma/schema.prisma" &&
      echo "Database backend: SQLite" &&
      echo "SQLite database: /app/server/storage/anythingllm.db";
    else
      case "$DATABASE_URL" in
        postgresql://*|postgres://*)
          PRISMA_SCHEMA="./prisma/postgresql/schema.prisma" &&
          echo "Database backend: PostgreSQL";;
        *)
          echo "ERROR: Invalid DATABASE_URL. Expected a PostgreSQL URI starting with postgresql:// or postgres://." >&2 &&
          echo "Database backend selection failed. Not falling back to SQLite." >&2 &&
          exit 1;;
      esac;
    fi &&
    npx prisma generate --schema="$PRISMA_SCHEMA" &&
    npx prisma migrate deploy --schema="$PRISMA_SCHEMA" &&
    node /app/server/index.js
} &
{ node /app/collector/index.js; } &
wait -n
exit $?