# AI providers

Lictory Intelligence (item and pull request reviews, proposal intake, Litto and
conversation titles) works with one AI provider per installation, chosen by the
operator in the server's environment. It can be a cloud service or a model your
company runs itself. Without a provider, Lictory Intelligence is off and
everything else works. Each organization still decides, in Settings → Lictory
Intelligence, whether its content may be sent to the provider.

This runbook covers choosing and connecting a provider. How Lictory uses the
model, and the guarantees around it, are in
[Lictory Intelligence](../internals/ai.md#providers). Every setting is listed in
the [configuration reference](./configuration.md).

## What is supported

| `LICTORY_AI_PROVIDER` | For                                                                                        | Protocol                               | Key                               |
| --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | --------------------------------- |
| `openai`              | OpenAI, or an OpenAI Responses gateway                                                     | Responses API                          | Required                          |
| `anthropic`           | Anthropic, or Claude in Azure AI Foundry                                                   | Messages API                           | Required (`x-api-key`)            |
| `azure`               | Azure OpenAI deployments, and Foundry models served through the Responses API (v1)         | Azure OpenAI Responses API (v1)        | Required (`api-key`)              |
| `openai-compatible`   | Self-hosted or private servers: Ollama, vLLM, LM Studio, llama.cpp `llama-server`, LiteLLM | Chat Completions (`/chat/completions`) | Optional (sent as a bearer token) |

What each Lictory feature needs from the model:

| Feature                                                | Needs                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| Item and pull request reviews, proposal intake, titles | JSON that matches a schema                                 |
| Litto                                                  | Streamed tool calls, then an answer after the tool results |
| Dictation in the Litto composer                        | OpenAI's Realtime API (see [dictation](#dictation))        |

OpenAI, Anthropic and Azure OpenAI support all of this with current models.
With an OpenAI-compatible server it depends on the server **and** the model:
many local models do not call tools, or not reliably. Check before you enable
it for your organizations (see [check the connection](#check-the-connection)).

Not supported in this version:

- Microsoft Entra ID (managed identity, bearer tokens) for Azure. Use a key.
  Models that accept only Entra ID cannot be used.
- Azure deployments that serve only Chat Completions. Use one that supports
  the v1 Responses API, or put an OpenAI-compatible gateway in front of it.
- Different providers for different features, or per-organization providers.
- Dictation with any provider other than OpenAI.

## Settings

| Setting                          | Purpose                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `LICTORY_AI_PROVIDER`            | `openai`, `anthropic`, `azure` or `openai-compatible`                            |
| `LICTORY_AI_MODEL`               | Model id; the deployment name with `azure`. Required except with `openai`        |
| `LICTORY_AI_BASE_URL`            | API base URL. Required with `azure` and `openai-compatible`                      |
| `LICTORY_AI_API_KEY`             | The provider's key. Optional only with `openai-compatible`                       |
| `LICTORY_AI_STRUCTURED_OUTPUT`   | `openai-compatible` only: `json-schema` (default) or `json-object`               |
| `LICTORY_AI_TIMEOUT_SECONDS`     | How long one structured call may take, retries included (30 to 480; default 240) |
| `LICTORY_TRANSCRIPTION_PROVIDER` | Dictation: `openai` or `none`                                                    |

Existing installations need no change: with `LICTORY_AI_PROVIDER` unset,
`OPENAI_API_KEY` alone still selects OpenAI (and `OPENAI_BASE_URL` still
applies).

When a provider is selected but incomplete (no key, no model, no URL), the API
and the worker refuse to start and list what is missing. Lictory never falls
back to another provider: if the configured endpoint is down, requests fail
and say which setting to check.

On an installation managed with the `lictory` command, change settings with
`sudo lictory config set KEY=value …`; it restarts the services. Elsewhere, set
them in the API and worker environment and restart both.

## Connect a cloud provider

Replace every `<placeholder>`.

**OpenAI**

```sh
sudo lictory config set LICTORY_AI_PROVIDER=openai LICTORY_AI_API_KEY=<openai-key>
# Optional: LICTORY_AI_MODEL=<model id> (default gpt-6-luna)
```

**Anthropic**

```sh
sudo lictory config set LICTORY_AI_PROVIDER=anthropic \
  LICTORY_AI_API_KEY=<anthropic-key> LICTORY_AI_MODEL=<model id>
```

**Claude in Azure AI Foundry** uses the same Messages API at your resource:

```sh
sudo lictory config set LICTORY_AI_PROVIDER=anthropic \
  LICTORY_AI_BASE_URL=https://<resource>.services.ai.azure.com/anthropic/v1 \
  LICTORY_AI_API_KEY=<foundry-key> LICTORY_AI_MODEL=<deployment name>
```

**Azure OpenAI** (and other Foundry models your resource serves through the
v1 Responses API):

```sh
sudo lictory config set LICTORY_AI_PROVIDER=azure \
  LICTORY_AI_BASE_URL=https://<resource>.openai.azure.com/openai/v1 \
  LICTORY_AI_API_KEY=<azure-key> LICTORY_AI_MODEL=<deployment name>
```

## Connect a self-hosted model

Lictory talks to a self-hosted model through its OpenAI-compatible Chat
Completions API. The model can run on the same machine as Lictory or on a
private server.

### Where is "localhost"?

Lictory's API and worker run in containers. Inside a container, `localhost`
and `127.0.0.1` are the container itself, not the machine. Lictory warns at
startup when `LICTORY_AI_BASE_URL` points there.

- **Same machine:** use `host.docker.internal`. The production Compose file
  maps it to the host on Linux (Docker Desktop defines it already). The model
  server must listen on an address the containers can reach, not only on
  `127.0.0.1`: for Ollama, set `OLLAMA_HOST=0.0.0.0:11434` in its service
  environment. Then let only local containers reach it, for example with a
  firewall rule that blocks the port from outside the machine.
- **Private server:** use its private address or internal DNS name, such as
  `http://10.0.4.20:8000/v1` or `https://inference.corp.internal/v1`. The API
  and worker containers use the `egress` network, so they reach whatever the
  machine itself can reach.
- **Another container in your own Compose project:** use its service name, on
  a network the API and worker share.
- **Without containers** (the API and worker run directly on the machine),
  `localhost` is correct; ignore the warning.

Use `https` for anything that leaves the machine. Lictory warns about plain
`http` to an address that does not look private.

### Ollama

```sh
# On the machine that runs Ollama: listen beyond loopback, give the model
# room for Lictory's prompts, and keep inference local.
OLLAMA_HOST=0.0.0.0:11434
OLLAMA_CONTEXT_LENGTH=32768
OLLAMA_NO_CLOUD=1

# On the Lictory server:
sudo lictory config set LICTORY_AI_PROVIDER=openai-compatible \
  LICTORY_AI_BASE_URL=http://host.docker.internal:11434/v1 \
  LICTORY_AI_MODEL=<model name, as in ollama list>
```

- **Context length.** Ollama's default context window (4096 tokens) is far
  smaller than a review of a real specification; set
  `OLLAMA_CONTEXT_LENGTH` to what your model and memory allow. A window that
  is too small makes reviews miss content or fail.
- **Tools.** Choose a model that supports tool calling, or Litto fails while
  reviews may still work. Ollama reports models without tool support, and the
  check below shows it.
- **Structured output.** Lictory sends `response_format` with a JSON schema.
  If your Ollama version or model does not honor it, set
  `LICTORY_AI_STRUCTURED_OUTPUT=json-object`.
- **Cloud models.** A signed-in Ollama server can run cloud models and send
  your content to Ollama's cloud. `OLLAMA_NO_CLOUD=1` turns that off. Choosing
  `openai-compatible` does not by itself guarantee that content stays on your
  network: what the endpoint does with a request is up to the endpoint.

### vLLM, LM Studio, llama.cpp and gateways

The same settings work for any server with an OpenAI-compatible
`/v1/chat/completions` endpoint:

```sh
sudo lictory config set LICTORY_AI_PROVIDER=openai-compatible \
  LICTORY_AI_BASE_URL=http://<host>:<port>/v1 \
  LICTORY_AI_MODEL=<model id the server serves>
# If the server requires a key (vLLM --api-key, a LiteLLM gateway):
sudo lictory config set LICTORY_AI_API_KEY=<key>
```

- **vLLM** needs tool calling enabled for Litto (`--enable-auto-tool-choice`
  with the `--tool-call-parser` for your model) and supports JSON schemas.
- **llama.cpp** `llama-server` needs `--jinja` for tool calls.
- If the server only supports JSON mode (`response_format: json_object`), set
  `LICTORY_AI_STRUCTURED_OUTPUT=json-object`: the schema is then written into
  the instructions and the answer is still validated.
- Slow hardware: raise `LICTORY_AI_TIMEOUT_SECONDS` (up to 480). A review run
  then ends a minute after it.

## Check the connection

From the server:

```sh
sudo lictory admin ai-check
```

Or in the admin console (`/admin`, instance administrators only): **AI
provider → Check connection**. Both run from the API service, with the same
network as the worker.

The check sends three requests with synthetic content (never organization
data) through Lictory's real code paths and reports each:

1. **Structured output:** a review of a toy item with the real review schema.
2. **Streamed tool call:** what Litto does in each step.
3. **Answer after a tool result:** how Litto continues after a tool ran.

A pass means the provider and model are compatible today. It does not measure
review quality, long-document behavior or how well a model follows
instructions; try a few real reviews before relying on it. The check stores
nothing and runs at most once every ten seconds.

## Dictation

Dictation streams audio from the browser straight to OpenAI's Realtime API,
whatever provider handles text. It is on by default only when text goes to
OpenAI's own API. To offer it with another provider or a gateway, the
operator chooses it explicitly, knowing that audio then goes to OpenAI:

```sh
sudo lictory config set LICTORY_TRANSCRIPTION_PROVIDER=openai OPENAI_API_KEY=<openai-key>
```

`LICTORY_TRANSCRIPTION_PROVIDER=none` turns it off. Without dictation, the
microphone is not shown and the server refuses dictation sessions.

## Privacy

- Content goes only to the configured provider. Members see the provider
  kind and model in Settings → Lictory Intelligence (and whether dictation
  sends audio to OpenAI), never the endpoint or key.
- OpenAI and Azure OpenAI are asked not to store requests (`store: false`).
  Anthropic's retention, and what a self-hosted or gateway endpoint logs, are
  governed by your agreement with that provider or by your own configuration.
- Keys stay in the server environment. They are not logged, not sent to
  browsers and not shown in the admin console, which names only the variable
  that holds the key.
- Changing the provider applies to queued reviews and to later turns of
  existing conversations. Tell organization administrators before you switch,
  since their content will go somewhere else.

## Troubleshooting

| Message                                                                      | What to do                                                                         |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| "…points at localhost, which inside a container is the container itself"     | Use `host.docker.internal` or the server's private address                         |
| "could not reach the AI provider / endpoint"                                 | Check the URL, that the server listens beyond loopback, and firewalls              |
| "rejected the configured credentials"                                        | Check `LICTORY_AI_API_KEY` (or `OPENAI_API_KEY`)                                   |
| "The configured AI model is unavailable" / "Azure deployment is unavailable" | Check `LICTORY_AI_MODEL` (the deployment name with Azure) and the URL              |
| "does not support tool calls"                                                | Choose a model with tool support; reviews can still work                           |
| "does not accept JSON schema output"                                         | `LICTORY_AI_STRUCTURED_OUTPUT=json-object`, or another model                       |
| "longer than the AI model accepts"                                           | Raise the model's context length (`OLLAMA_CONTEXT_LENGTH`, vLLM `--max-model-len`) |
| "did not answer in time"                                                     | Faster hardware or a smaller model, or raise `LICTORY_AI_TIMEOUT_SECONDS`          |
