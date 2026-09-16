ARG ANYTHINGLLM_VERSION=1.16.1

FROM --platform=$BUILDPLATFORM node:18-slim AS frontend-build
ARG ANYTHINGLLM_VERSION

RUN apt-get update && \
    apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch "v${ANYTHINGLLM_VERSION}" \
    https://github.com/Mintplex-Labs/anything-llm.git .

COPY apply-keplerllm-branding.mjs /tmp/apply-keplerllm-branding.mjs
RUN node /tmp/apply-keplerllm-branding.mjs

WORKDIR /src/frontend
RUN yarn install --network-timeout 100000 && yarn cache clean
RUN yarn build

FROM mintplexlabs/anythingllm:${ANYTHINGLLM_VERSION}

USER root
RUN rm -rf /app/server/public && \
    mkdir -p /app/server/public && \
    chown anythingllm:anythingllm /app/server/public
COPY --chown=anythingllm:anythingllm --from=frontend-build /src/frontend/dist /app/server/public
COPY keplerllm-entrypoint.sh /usr/local/bin/keplerllm-entrypoint.sh
RUN chmod 0755 /usr/local/bin/keplerllm-entrypoint.sh

USER anythingllm
ENTRYPOINT ["/bin/bash", "/usr/local/bin/keplerllm-entrypoint.sh"]
