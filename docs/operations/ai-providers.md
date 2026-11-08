# AI providers

Lictory Intelligence uses two kinds of model, each from one provider of your
choice:

- a **language model** for item and pull request reviews, proposal intake,
  Litto and conversation titles;
- optionally, a **speech-to-text model** for dictation in the Litto composer.

Either can be a cloud service or an open-weight model your company runs on
its own hardware. Without a language model, Lictory Intelligence is off and
everything else works. Each organization still decides, in Settings →
Lictory Intelligence, whether its content may be sent.

This runbook covers choosing, connecting and checking providers. How Lictory
uses the model, and the guarantees around it, are in
[Lictory Intelligence](../internals/ai.md#providers).

## Supported providers

### Language models

| Provider (`LICTORY_AI_PROVIDER`)              | Where it runs          | You need                                                                                                                                                                |
| --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI (`openai`)                             | Cloud                  | An API key                                                                                                                                                              |
| Anthropic (`anthropic`)                       | Cloud                  | An API key and a model; also Claude in Azure AI Foundry (base URL `https://<resource>.services.ai.azure.com/anthropic/v1`)                                              |
| Google Gemini (`google`)                      | Cloud                  | A Gemini API key and a model                                                                                                                                            |
| Google Vertex AI (`vertex`)                   | Cloud                  | A model and an API key, a service account key, or the server's own Google Cloud identity with project and location                                                      |
| Azure OpenAI (`azure`)                        | Cloud                  | The resource's v1 URL (`https://<resource>.openai.azure.com/openai/v1`), a deployment, and a key, a Microsoft Entra service principal, or the server's managed identity |
| Amazon Bedrock (`bedrock`)                    | Cloud                  | A region, a model or inference profile, and a Bedrock API key, an access key pair, or the server's own AWS identity                                                     |
| Mistral AI (`mistral`)                        | Cloud                  | An API key and a model                                                                                                                                                  |
| xAI (`xai`)                                   | Cloud                  | An API key and a model                                                                                                                                                  |
| Groq (`groq`)                                 | Cloud                  | An API key and a model (open-weight models)                                                                                                                             |
| DeepSeek (`deepseek`)                         | Cloud                  | An API key and a model                                                                                                                                                  |
| OpenRouter (`openrouter`)                     | Cloud                  | An API key and a model (`vendor/model`)                                                                                                                                 |
| Ollama (`ollama`)                             | Self-hosted            | A model you pulled                                                                                                                                                      |
| vLLM (`vllm`)                                 | Self-hosted            | The model it serves                                                                                                                                                     |
| LM Studio (`lmstudio`)                        | Self-hosted            | The loaded model                                                                                                                                                        |
| llama.cpp server (`llamacpp`)                 | Self-hosted            | Any model name                                                                                                                                                          |
| Other OpenAI-compatible (`openai-compatible`) | Self-hosted or gateway | A base URL with `/chat/completions` and a model (LocalAI, SGLang, TGI, LiteLLM…)                                                                                        |

Every feature needs JSON that matches a schema (reviews, intake, titles) and
Litto needs streamed tool calls. The cloud providers above support both with
current models. With a self-hosted server it depends on the server **and**
the model: choose one that calls tools, and [check](#check-the-connection)
before turning it on for organizations. DeepSeek and servers without JSON
schema support use JSON mode: the schema is written into the instructions
and the answer is still validated.

### Dictation

| Provider (`LICTORY_TRANSCRIPTION_PROVIDER`)   | Where it runs | Mode           | You need                                                                                                                              |
| --------------------------------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Realtime (`openai-realtime`)           | Cloud         | Live           | An OpenAI key                                                                                                                         |
| OpenAI (`openai`)                             | Cloud         | Recorded clips | An OpenAI key                                                                                                                         |
| Azure OpenAI (`azure`)                        | Cloud         | Recorded clips | The resource URL and a deployment; authenticates like Azure for text                                                                  |
| Google Cloud Speech (`vertex`)                | Cloud         | Recorded clips | A service account key or the server's Google Cloud identity, with project and location (express-mode API keys do not work for speech) |
| Groq (`groq`)                                 | Cloud         | Recorded clips | A Groq key (Whisper)                                                                                                                  |
| Deepgram (`deepgram`)                         | Cloud         | Recorded clips | A key                                                                                                                                 |
| ElevenLabs (`elevenlabs`)                     | Cloud         | Recorded clips | A key                                                                                                                                 |
| AssemblyAI (`assemblyai`)                     | Cloud         | Recorded clips | A key                                                                                                                                 |
| Mistral AI (`mistral`)                        | Cloud         | Recorded clips | A key (Voxtral)                                                                                                                       |
| Speaches / faster-whisper (`speaches`)        | Self-hosted   | Recorded clips | A Whisper model the server downloaded                                                                                                 |
| whisper.cpp server (`whisper-cpp`)            | Self-hosted   | Recorded clips | Its URL                                                                                                                               |
| Other OpenAI-compatible (`openai-compatible`) | Self-hosted   | Recorded clips | A base URL with `/audio/transcriptions` (vLLM, LocalAI)                                                                               |

- **Live** (OpenAI Realtime): words appear while people speak. Audio goes
  from the browser straight to OpenAI and never through your server.
- **Recorded clips** (every other provider): the browser cuts speech into
  short clips at each pause (16 kHz WAV, at most 12 seconds) and sends them to
  your server, which sends each to the provider and returns its words. Audio
  is held in memory for one request and never stored or logged. A clip that
  fails is tried once more; if the provider cannot keep up, dictation stops
  and keeps what it transcribed. Each clip may take as long as the request
  timeout (at least 30 seconds, at most 2 minutes), so slow self-hosted
  Whisper servers can be given time.

When dictation uses the same vendor as the language model (OpenAI and
OpenAI, Azure and Azure, Groq and Groq…), fields you leave empty reuse the
language model's key, endpoint (so a gateway in front of the vendor serves
both) and project. Google speech never reuses an express-mode API key. The default (**Automatic**) is
live OpenAI dictation when text goes to OpenAI's own API, otherwise none.

## Three ways to configure

1. **The admin console** (`<your address>/admin/ai`, instance
   administrators): choose providers from a list, fill in what each needs,
   **Test before saving**, **Save**. Keys are stored encrypted and never shown
   again.
2. **`sudo lictory ai setup`** on the server: the same choices and test in the
   terminal, saved to the same place. Keys come from a hidden prompt or from
   `LICTORY_AI_API_KEY` / `LICTORY_TRANSCRIPTION_API_KEY`, never from
   command-line arguments.
3. **Environment variables** (`sudo lictory config set LICTORY_AI_…`):
   reviewed and deployed with the rest of the configuration. When any AI
   variable is set (including the legacy `OPENAI_API_KEY`), the environment
   wins and the console and `lictory ai setup` are read-only.

Existing installations need no change: `OPENAI_API_KEY` alone still selects
OpenAI (with `OPENAI_BASE_URL`, if set) and live dictation. To manage AI in
the console instead, remove the AI variables from `.env`
(`sudo lictory config unset OPENAI_API_KEY …`) and set the provider up again
in the console. `LICTORY_AI_CONSOLE=false` turns console configuration off:
then only the environment configures AI.

Nothing falls back: requests go only to the providers you chose. When one is
unreachable or refuses, the feature fails with a message that names what to
check, and nothing is retried elsewhere.

## In the admin console

1. Open **Admin console → AI providers**.
2. **Language model**: choose the provider. The form shows only what it
   needs, a link to get a key, the model suggestions and notes.
3. **Dictation**: **Automatic**, **Off**, or a provider.
4. **Test before saving** sends synthetic content (never organization data)
   through every feature and shows what passed. Nothing is saved.
5. **Save**. The API and workers use the new settings within ten seconds,
   without a restart, and organizations see the new provider in their
   settings.

Leave a key empty to keep the stored one; **Remove** deletes it. Switching to
another provider never sends the previous provider's key to it. Every change
is recorded in the admin console's **Activity**, without keys.

## In the terminal

```sh
sudo lictory ai setup      # guided: providers, models, keys, test, save
sudo lictory ai status     # what is in use and where it is set
sudo lictory ai check      # the live check of what is saved
sudo lictory ai providers  # every provider id
sudo lictory ai off        # no provider; removes stored keys
```

Without questions (for provisioning scripts), with placeholders:

```sh
LICTORY_AI_API_KEY=<anthropic-key> sudo -E lictory ai setup --yes \
  --provider anthropic --model claude-sonnet-5-5 --dictation none

LICTORY_AI_AZURE_CLIENT_SECRET=<secret> sudo -E lictory ai setup --yes \
  --provider azure --base-url https://<resource>.openai.azure.com/openai/v1 \
  --model <deployment> --tenant-id <tenant> --client-id <client> \
  --dictation azure --dictation-model <whisper-deployment>

sudo lictory ai setup --yes --provider ollama --model qwen3:32b \
  --dictation speaches --dictation-model Systran/faster-whisper-large-v3
```

## With environment variables

Every setting, with its default, is in the
[configuration reference](./configuration.md#ai). Examples with placeholders:

```sh
# Google Gemini
sudo lictory config set LICTORY_AI_PROVIDER=google LICTORY_AI_API_KEY=<key> LICTORY_AI_MODEL=<model>

# Amazon Bedrock with the server's own IAM role (no key)
sudo lictory config set LICTORY_AI_PROVIDER=bedrock LICTORY_AI_REGION=<region> LICTORY_AI_MODEL=<model-or-profile-id>

# Vertex AI with a service account key file's JSON as the key
sudo lictory config set LICTORY_AI_PROVIDER=vertex LICTORY_AI_LOCATION=<location> \
  LICTORY_AI_MODEL=<model> LICTORY_AI_API_KEY="$(cat <service-account.json>)"

# Azure OpenAI with the server's managed identity (no key), and its Whisper
# deployment for dictation; a service principal instead:
# LICTORY_AI_AZURE_TENANT_ID, LICTORY_AI_AZURE_CLIENT_ID, LICTORY_AI_AZURE_CLIENT_SECRET
sudo lictory config set LICTORY_AI_PROVIDER=azure \
  LICTORY_AI_BASE_URL=https://<resource>.openai.azure.com/openai/v1 LICTORY_AI_MODEL=<deployment>

# Azure OpenAI for text, and its Whisper deployment for dictation (same key)
sudo lictory config set LICTORY_AI_PROVIDER=azure LICTORY_AI_API_KEY=<key> \
  LICTORY_AI_BASE_URL=https://<resource>.openai.azure.com/openai/v1 LICTORY_AI_MODEL=<deployment> \
  LICTORY_TRANSCRIPTION_PROVIDER=azure LICTORY_TRANSCRIPTION_MODEL=<whisper-deployment>
```

## Self-hosted models

### Where is "localhost"?

Lictory's API and worker run in containers. Inside a container, `localhost`
is the container itself, not the machine. Lictory warns (at startup and in the
console) when an endpoint points there.

- **On the same machine:** use `host.docker.internal` (the self-hosted
  presets do) and set `LICTORY_HOST_MODEL_SERVER=true`, which maps it to the
  host for the API and worker (`compose.host-models.yaml`). `lictory ai
setup` offers it before testing, and the console warns beside a
  same-machine endpoint until it is set. The model server must listen beyond loopback
  (`0.0.0.0`); keep its port closed to the outside with a firewall.
- **On a private server:** its private address or internal name, such as
  `http://10.0.4.20:8000/v1` or `https://inference.corp.internal/v1`.
- **Another container you run:** its service name on a network the API and
  worker share.

Use `https` for anything that leaves the machine; Lictory warns about plain
`http` to an address that does not look private. Endpoints entered in the
console may be public or private but never link-local or cloud metadata
addresses (where the machine's own credentials live).

### Language models

- **Ollama**: `OLLAMA_HOST=0.0.0.0:11434`, a larger `OLLAMA_CONTEXT_LENGTH`
  (32768 or more: the default 4096 tokens is far smaller than a real
  specification), and `OLLAMA_NO_CLOUD=1` so a signed-in server never sends
  content to Ollama's cloud models. Choose a model that supports tools.
- **vLLM**: `--enable-auto-tool-choice` with the `--tool-call-parser` for
  your model, and `--api-key` if the port is reachable from other machines.
- **LM Studio**: turn on serving on the local network.
- **llama.cpp**: `llama-server --jinja --host 0.0.0.0`.
- A server that ignores JSON schemas: set **Structured output** to JSON mode
  (`LICTORY_AI_STRUCTURED_OUTPUT=json-object`).
- Slow hardware: raise the timeout (console **Requests**, or
  `LICTORY_AI_TIMEOUT_SECONDS`, up to 480 seconds).

### Speech to text

- **Speaches** (faster-whisper, `ghcr.io/speaches-ai/speaches`): its
  OpenAI-compatible `/v1/audio/transcriptions`; set the model to a Whisper
  model it has downloaded, such as `Systran/faster-whisper-large-v3`.
- **whisper.cpp**: `whisper-server --host 0.0.0.0 --inference-path
/v1/audio/transcriptions`; it transcribes with the model it loaded.
- **vLLM** serving a Whisper model, or **LocalAI**: **Other OpenAI-compatible
  endpoint** with its `/v1` URL.

Clips are 16 kHz mono WAV, which every server above reads without ffmpeg.

## Check the connection

**Test before saving** and **Check connection** in the console, and
`lictory ai check` on the server, send synthetic content through Lictory's
real code paths and report each:

1. **Structured output:** a review of a toy item with the real review schema.
2. **Streamed tool call:** what Litto does in each step.
3. **Answer after a tool result:** how Litto continues after a tool ran.
4. **Dictation:** a one-second test tone transcribed by the provider (live
   dictation: a session is issued; no audio is sent).

A pass means the providers and models are compatible today. It does not
measure quality, long documents or how well a model follows instructions;
try a few real reviews before relying on it. Checks store nothing, run one at
a time and at most every ten seconds.

## Privacy and security

- Content goes only to the configured providers. Members see the provider
  and model in Settings → Lictory Intelligence (and how dictation audio
  travels), never endpoints or keys.
- OpenAI and Azure OpenAI are asked not to store requests (`store: false`).
  Other providers' retention, and what a self-hosted server or gateway logs,
  are governed by your agreement with them or your own configuration.
- Keys are encrypted with `DELIVERY_CREDENTIALS_KEY` (set it before storing
  any in production), never logged, never sent to browsers and never shown
  again in the console.
- Only instance administrators change providers; only organization
  administrators decide whether their organization uses them.
- Changing a provider applies to queued reviews and later turns of existing
  conversations. Tell organization administrators before you switch.

## Troubleshooting

| Message                                                                  | What to do                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| "…points at localhost, which inside a container is the container itself" | Use `host.docker.internal` with `LICTORY_HOST_MODEL_SERVER=true`, or the server's private address |
| "could not reach the AI provider / endpoint"                             | Check the URL, that the server listens beyond loopback, and firewalls                             |
| "rejected the configured credentials"                                    | Replace the key (console) or check the variable the message names                                 |
| "The configured AI model is unavailable"                                 | Check the model id (the deployment name with Azure) and the URL                                   |
| "does not support tool calls"                                            | Choose a model with tool support; reviews can still work                                          |
| "does not accept JSON schema output"                                     | Structured output → JSON mode, or another model                                                   |
| "longer than the AI model accepts"                                       | Raise the model's context length (`OLLAMA_CONTEXT_LENGTH`, vLLM `--max-model-len`)                |
| "did not answer in time"                                                 | Faster hardware or a smaller model, or raise the timeout                                          |
| "resolves to a link-local or cloud metadata address"                     | Use the model server's own address                                                                |
| The console is read-only                                                 | The environment sets AI variables; change them there or remove them                               |

## Limitations

- One language model and one dictation provider per installation, not per
  organization or per feature.
- Azure OpenAI deployments must support the v1 Responses API. Microsoft Entra
  ID covers service principals and managed identities (virtual machines,
  AKS nodes, App Service, Container Apps) in the public cloud; workload
  identity federation and sovereign clouds need a key.
- Dictation by recorded clips shows words after each pause, not while
  speaking; live dictation is OpenAI Realtime only.
- No provider was verified live in Lictory's test suite. Contract tests run
  against local fakes of each protocol: OpenAI, Anthropic, Gemini, Azure
  (key and Entra), Bedrock, Mistral, xAI, Groq, DeepSeek, OpenRouter and the
  OpenAI-compatible servers and Vertex AI (express mode) for text; OpenAI,
  Azure, Groq, Mistral, Deepgram, ElevenLabs, AssemblyAI and Whisper servers
  for dictation. Vertex AI with service accounts, Google speech and OpenAI
  Realtime are covered by settings tests only. Run the check with your own keys.
