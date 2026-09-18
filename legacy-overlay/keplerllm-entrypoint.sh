#!/bin/bash
set -euo pipefail

readonly upstream_entrypoint="/usr/local/bin/docker-entrypoint.sh"
readonly runtime_env="/app/server/.env"
readonly storage_dir="${STORAGE_DIR:-/app/server/storage}"
readonly persistent_env="${storage_dir}/.env"
readonly runtime_config="/app/server/public/keplerllm-config.js"
readonly model_display_name="${KEPLERLLM_MODEL_DISPLAY_NAME:-Kepler AI}"

echo "[KeplerLLM] Persistent AnythingLLM UI configuration: ${persistent_env}"
echo "[KeplerLLM] Model display name: ${model_display_name}"

mkdir -p "$storage_dir"

if [ ! -e "$persistent_env" ]; then
  if [ -f "$runtime_env" ] && [ ! -L "$runtime_env" ]; then
    cp "$runtime_env" "$persistent_env"
    echo "[KeplerLLM] Seeded persistent .env from the upstream image."
  else
    : > "$persistent_env"
    echo "[KeplerLLM] Created persistent .env."
  fi
fi

if [ ! -w "$persistent_env" ]; then
  echo "[KeplerLLM] ERROR: ${persistent_env} is not writable by $(id -u):$(id -g)." >&2
  exit 1
fi

rm -f "$runtime_env"
ln -s "$persistent_env" "$runtime_env"

MODEL_DISPLAY_NAME="$model_display_name" RUNTIME_CONFIG="$runtime_config" node <<'NODE'
const fs = require("node:fs");

const configPath = process.env.RUNTIME_CONFIG;
const modelDisplayName = process.env.MODEL_DISPLAY_NAME;
const config = `window.__KEPLERLLM_CONFIG__ = Object.freeze(${JSON.stringify({ modelDisplayName })});\n`;

fs.writeFileSync(configPath, config, { encoding: "utf8", mode: 0o644 });
NODE

exec /bin/bash "$upstream_entrypoint"
