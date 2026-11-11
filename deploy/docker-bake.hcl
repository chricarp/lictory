# Builds every Lictory production image from one source checkout.
#
#   REGISTRY=ghcr.io/acme VERSION=1.5.0 GIT_SHA=$(git rev-parse HEAD) \
#   docker buildx bake -f deploy/docker-bake.hcl --push --metadata-file build.json
#
# The default images carry no domain or analytics settings: the API reads them
# from its environment at runtime, so the same image runs on any hostname.
# Only the optional marketing website (`marketing` target) embeds its origin:
# set SITE_URL to build it. Tags: <version> and
# sha-<git sha>-<channel>; deploy by digest.
#
# Every image index carries BuildKit attestations: an SPDX SBOM and a
# mode=max SLSA provenance (build arguments, source and base images; the
# images take no build secrets). Release workflows also sign each digest
# (docs/operations/releases.md#signatures-and-attestations).

variable "REGISTRY" { default = "ghcr.io/lictory" }
variable "VERSION" { default = "0.0.0" }
variable "GIT_SHA" { default = "unknown" }
variable "CHANNEL" { default = "local" }
variable "SOURCE_URL" { default = "" }
# Website-only build settings (the `marketing` target).
variable "SITE_URL" { default = "" }
variable "POSTHOG_PROJECT_TOKEN" { default = "" }
variable "POSTHOG_HOST" { default = "" }
variable "PREVIOUS_PROXY_IMAGE" { default = "no-previous-assets" }
variable "PLATFORMS" { default = "linux/amd64,linux/arm64" }
# Optional registry namespace for BuildKit caches, e.g. ghcr.io/acme/lictory-cache.
variable "CACHE_REGISTRY" { default = "" }
variable "CACHE_SCOPE" { default = "local" }
variable "TAG_SUFFIX" { default = "" }

group "default" {
  targets = ["api", "proxy", "migrate", "ops"]
}

target "_common" {
  context    = "."
  dockerfile = "Dockerfile"
  platforms  = split(",", PLATFORMS)
  attest     = ["type=sbom", "type=provenance,mode=max"]
  args = {
    APP_VERSION          = VERSION
    PREVIOUS_PROXY_IMAGE = PREVIOUS_PROXY_IMAGE
  }
  labels = {
    "org.opencontainers.image.version"  = VERSION
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.source"   = SOURCE_URL
    "com.lictory.channel"               = CHANNEL
  }
}

function "cache_from" {
  params = [name]
  result = CACHE_REGISTRY == "" ? [] : ["type=registry,ref=${CACHE_REGISTRY}:${name}-${CACHE_SCOPE}"]
}

function "cache_to" {
  params = [name]
  result = CACHE_REGISTRY == "" ? [] : ["type=registry,ref=${CACHE_REGISTRY}:${name}-${CACHE_SCOPE},mode=max"]
}

function "tags" {
  params = [name]
  result = [
    "${REGISTRY}/lictory-${name}:${VERSION}${TAG_SUFFIX}",
    "${REGISTRY}/lictory-${name}:sha-${GIT_SHA}-${CHANNEL}${TAG_SUFFIX}",
  ]
}

target "api" {
  inherits = ["_common"]
  target   = "api"
  tags     = tags("api")
  cache-from = cache_from("api")
  cache-to   = cache_to("api")
}

target "marketing" {
  inherits = ["_common"]
  target   = "marketing"
  args = {
    SITE_URL                          = SITE_URL
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = POSTHOG_PROJECT_TOKEN
    NEXT_PUBLIC_POSTHOG_HOST          = POSTHOG_HOST
  }
  tags     = tags("marketing")
  cache-from = cache_from("marketing")
  cache-to   = cache_to("marketing")
}

target "proxy" {
  inherits = ["_common"]
  target   = "proxy"
  tags     = tags("proxy")
  cache-from = cache_from("proxy")
  cache-to   = cache_to("proxy")
}

target "migrate" {
  inherits = ["_common"]
  target   = "migrate"
  tags     = tags("migrate")
  cache-from = cache_from("migrate")
  cache-to   = cache_to("migrate")
}

target "ops" {
  inherits = ["_common"]
  target   = "ops"
  tags     = tags("ops")
  cache-from = cache_from("ops")
  cache-to   = cache_to("ops")
}
