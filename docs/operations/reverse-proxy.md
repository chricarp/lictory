# Existing reverse proxy, internal CA and plain HTTP

The bundled gateway (`proxy`, Caddy) is always the entry point of a Lictory
environment: it routes the API, server-sent events, AI streams, Zero's
WebSocket and the SPA's assets, applies the security headers and request size
limits, and checks the WebSocket `Origin`. What varies is what sits in front of
it and who terminates TLS:

| Setup                                  | TLS terminated by        | Settings                                                       |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| Standalone (default)                   | The gateway, public ACME | `APP_HOST`, `ACME_EMAIL`                                       |
| Internal CA (ACME or Caddy's own CA)   | The gateway              | `CADDY_GLOBAL_OPTIONS`                                         |
| Existing reverse proxy or ingress      | Your proxy               | `PROXY_SCHEME=http`, `PLATFORM_URL`, bindings, trusted proxies |
| Plain HTTP (evaluation on `localhost`) | Nobody                   | `PROXY_SCHEME=http`, `PLATFORM_URL=http://…`                   |

One environment serves one origin: `PLATFORM_URL`, the address users type,
scheme included (default `https://<PUBLIC_APP_HOST or APP_HOST>`). The API
uses it for sign-in, links in email and the same-origin check of
cookie-authenticated writes; the gateway accepts Zero WebSocket upgrades only
from it. It must be an origin: lowercase, no path, no trailing slash
(`deploy.sh` refuses anything else).

**Subpath hosting is not supported.** Lictory must own the root of its host
(`https://lictory.example.com/`, not `https://example.com/lictory/`): the SPA,
the API (`/api`), Zero (`/zero`) and the relay (`/relay`) all live at fixed
root paths. Use a dedicated host name.

## Behind an existing reverse proxy or ingress

Run the gateway as plain HTTP on a private address and let your proxy
terminate TLS with your certificates:

```sh
# <root>/<environment>/.env
APP_HOST=lictory.example.com            # the Host header your proxy forwards
PLATFORM_URL=https://lictory.example.com
PROXY_SCHEME=http
HTTP_PORT=8080                           # deploy.sh verifies through this port
HTTP_BINDING=127.0.0.1:8080:80           # or a private address your proxy reaches
HTTPS_BINDING=127.0.0.1:8443:443         # unused, but kept off the public 443
CADDY_TRUSTED_PROXIES=172.18.0.1         # the peer address the gateway sees (below)
ACME_EMAIL=ops@example.com               # required by Compose, unused over HTTP
```

Requirements for the proxy in front:

- **Host.** Forward the original `Host` (the gateway serves `APP_HOST` only).
- **WebSockets.** `/zero/*` upgrades to a WebSocket. Pass `Upgrade` and
  `Connection` through and keep the browser's `Origin` header unchanged.
- **No buffering.** `/api/events` (server-sent events, up to 240 s), AI chat
  streams and `/relay/*` stream their responses: disable response buffering
  (at least for `/api/` and `/relay/`).
- **Timeouts.** At least 300 s for reading responses and for idle
  connections: WebSockets stay open, AI streams can take minutes.
- **Bodies.** Allow 12 MB request bodies; the gateway enforces the exact
  per-route limits (2 MB by default, 10 MB for file relays).
- **Client address.** Append the connecting client to `X-Forwarded-For`, or
  overwrite it. Set `CADDY_TRUSTED_PROXIES` to the address(es) your proxy
  connects from as the gateway sees them, and include any further proxy hop
  in the chain (a load balancer in front of nginx). The gateway resolves the
  client from right to left and forwards exactly one address to the API, which
  rate-limits sign-in per address. Untrusted peers are treated as the client,
  so a forgotten setting makes every user share one rate limit; never trust
  all private ranges.

With the proxy on the same host connecting to a port published on
`127.0.0.1`, Docker delivers the connection from the gateway network's
bridge address, not `127.0.0.1`. Find it with
`docker network inspect lictory-<environment>_edge --format '{{(index .IPAM.Config 0).Gateway}}'`
and confirm in the gateway's access log (`lictory-compose <env> logs proxy`,
field `client_ip`) that your own address appears, and that two clients get
independent sign-in limits.

The gateway keeps sending HSTS and the other security headers; your proxy
should not strip them. Do not publish the API, zero-cache or PostgreSQL
directly: only the gateway.

### nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

upstream lictory {
    server 127.0.0.1:8080;
    keepalive 16;
}

server {
    listen 443 ssl;
    http2 on;
    server_name lictory.example.com;
    ssl_certificate     /etc/nginx/tls/lictory.example.com.crt;  # your CA's certificate chain
    ssl_certificate_key /etc/nginx/tls/lictory.example.com.key;

    client_max_body_size 12m;

    location / {
        proxy_pass http://lictory;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Server-sent events, AI streams and uploads pass through unbuffered.
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

server {
    listen 80;
    server_name lictory.example.com;
    return 301 https://$host$request_uri;
}
```

### Traefik

Traefik passes WebSockets and `Host` through by default, sets
`X-Forwarded-For` to the connecting client (discarding values sent by clients
outside `forwardedHeaders.trustedIPs`) and does not buffer responses unless a
buffering middleware is added. Raise the
entry point's timeouts (Traefik v3 reads request bodies for at most 60 s and
closes idle connections after 180 s by default):

```yaml
# Static configuration (traefik.yml)
entryPoints:
  websecure:
    address: ":443"
    transport:
      respondingTimeouts:
        readTimeout: 300s
        idleTimeout: 300s
    # Only when a load balancer sits in front of Traefik:
    # forwardedHeaders:
    #   trustedIPs: ["10.0.0.0/24"]
providers:
  file:
    filename: /etc/traefik/lictory.yml
```

```yaml
# Dynamic configuration (/etc/traefik/lictory.yml)
http:
  routers:
    lictory:
      rule: Host(`lictory.example.com`)
      entryPoints: [websecure]
      service: lictory
      tls: {} # certificates from tls.certificates, a resolver or the default store
  services:
    lictory:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:8080
tls:
  certificates:
    - certFile: /etc/traefik/tls/lictory.example.com.crt
      keyFile: /etc/traefik/tls/lictory.example.com.key
```

On Kubernetes or another ingress controller the same rules apply: route the
host to the gateway's HTTP port, allow WebSocket upgrades, turn off response
buffering, and raise read and idle timeouts to 300 s (for ingress-nginx, the
`nginx.ingress.kubernetes.io/` annotations `proxy-buffering: "off"`,
`proxy-read-timeout: "300"`, `proxy-send-timeout: "300"` and
`proxy-body-size: 12m`).

## Internal CA without another proxy

The gateway can obtain certificates from an internal ACME CA (step-ca,
HashiCorp Vault, Active Directory Certificate Services with ACME, Smallstep):

```sh
CADDY_GLOBAL_OPTIONS=acme_ca https://ca.internal.example/acme/acme/directory
```

The CA's own HTTPS endpoint must be trusted by the gateway image (a publicly
trusted certificate); mounting a private root for `acme_ca_root` is not
supported. Without any CA, `CADDY_GLOBAL_OPTIONS=local_certs` makes the gateway
its own CA: export the root certificate from the `caddy_data` volume
(`lictory-compose <environment> exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > lictory-root.crt`)
and distribute it to your users' trust stores. `deploy.sh` accepts the
self-issued certificate when it verifies a release (any non-empty
`CADDY_GLOBAL_OPTIONS` makes its checks skip certificate validation).

To use existing certificate files (a wildcard from your corporate CA), terminate
TLS in a reverse proxy as above; the bundled gateway does not load certificate
files.

## Plain HTTP

For a quick evaluation, a gateway can serve plain HTTP:

```sh
APP_HOST=localhost
PLATFORM_URL=http://localhost:8080
PROXY_SCHEME=http
HTTP_PORT=8080
HTTP_BINDING=127.0.0.1:8080:80
HTTPS_BINDING=127.0.0.1:8443:443
```

Caveats:

- **Cookies are not `Secure`.** With an `http://` `PLATFORM_URL`, Better Auth
  issues session cookies without the `Secure` attribute or `__Secure-` prefix.
  Anyone who can observe the network can read sessions, passwords and every
  document. Use it only on a trusted machine or network.
- **Only `localhost` is a secure context.** Browsers restrict pages served
  over plain HTTP from any other host (a LAN IP or name): `crypto.randomUUID`,
  the clipboard and the microphone are unavailable there, and parts of the
  application that create records in the browser stop working. Reach a LAN
  server over an SSH tunnel to `localhost`, or give it HTTPS with
  `local_certs` (above).
- **Switching later.** Moving the same host name to HTTPS later changes the
  cookie names: users sign in again. The gateway's HSTS header has no effect
  over HTTP, but once the host is served over HTTPS browsers remember it for
  two years.

## After any change

Release or re-activate the environment (`sudo lictory config apply`),
then check: sign-in, live updates between two browsers (Zero WebSocket), a
streamed AI answer or the notifications stream (`/api/events`), an attachment
upload, and the client address in the gateway log.
