# KeplerLLM

Thin wrapper around `mintplexlabs/anythingllm:latest` that keeps AnythingLLM settings changed through the UI inside the existing persistent storage volume.

## What it changes

AnythingLLM writes UI-managed configuration to `/app/server/.env`. KeplerLLM stores that file at `${STORAGE_DIR}/.env` (normally `/app/server/storage/.env`) and exposes `/app/server/.env` as a symlink to it before starting the original AnythingLLM entrypoint.

This means the deployment only needs the normal named volume mounted at:

```text
/app/server/storage
```

No bind mount or separate file mount for `/app/server/.env` is required.

On the first KeplerLLM boot, if `${STORAGE_DIR}/.env` does not exist, the wrapper seeds it from the `.env` shipped in the upstream AnythingLLM image. Future changes made in the AnythingLLM UI are written through the symlink into the persistent volume.

## Build and publish

`.envrc` sets `IMAGE_TAG` to the current short Git commit hash. `compose.yaml` publishes both that immutable tag and `latest`.

After committing changes, reload `direnv` so `IMAGE_TAG` follows the new `HEAD`:

```bash
direnv reload
docker compose build --push
```

Published images:

```text
cr.umapps.net/umapps/keplerllm:${IMAGE_TAG}
cr.umapps.net/umapps/keplerllm:latest
```

The Compose build pulls the current upstream base image and builds for both `linux/amd64` and `linux/arm64`.

## CapRover

Use:

```text
STORAGE_DIR=/app/server/storage
```

and keep the named volume:

```text
anythingllm-storage -> /app/server/storage
```

Existing AnythingLLM collector volumes can remain unchanged.
