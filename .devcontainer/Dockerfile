# Development container: Node 24 with the exact Bun release from package.json,
# paired the same way as the production Dockerfile. Docker (for compose.yaml's
# services) comes from the docker-in-docker feature in devcontainer.json.
FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS bun

FROM mcr.microsoft.com/devcontainers/javascript-node:24-trixie@sha256:56a7d5570b644ed88c4ab3529f46bd662d656ebe9e73de06076af91a75fa8f3e
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
