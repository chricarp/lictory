# Development container: Node 24 with the exact Bun release from package.json,
# paired the same way as the production Dockerfile. Docker (for compose.yaml's
# services) comes from the docker-in-docker feature in devcontainer.json.
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS bun

FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie@sha256:2015e2c863cb1e608bc0876860dd063cdb9e3d9a02dca63d1c2fce8fad02d088
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
