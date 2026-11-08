"use client";

import { ChevronDown, Server } from "lucide-react";

import { Stage } from "@lictory/marketing/vendor/stageshow/stage";
import type { Act } from "@lictory/marketing/vendor/stageshow/act";
import type { Layout } from "@lictory/marketing/vendor/stageshow/looks";
import { Window } from "@lictory/marketing/vendor/stageshow/window";
import { Check } from "@lictory/marketing/vendor/stageshow/parts/Check";
import { Field as KitField } from "@lictory/marketing/vendor/stageshow/controls/Field";
import { States } from "@lictory/marketing/vendor/stageshow/motion/States";
import { Collapse } from "@lictory/marketing/vendor/stageshow/motion/Collapse";
import {
  SceneFrame,
  useSiteTheme,
} from "@lictory/marketing/components/landing/scenes/scene-frame";
import "./models-scene.css";

/*
 * Your models: the AI provider is the company's choice.
 *
 * Story (how it feels to configure): an instance administrator opens the
 * provider list in the admin console, where cloud providers and self-hosted
 * servers sit side by side, and picks Ollama. The endpoint fills in for a
 * server on the same machine, the model is typed, a self-hosted Whisper
 * server takes dictation, and Test before saving checks every feature with
 * synthetic content. Saved, organizations see that their content goes to a
 * model server the company runs. Plays once and rests on the saved result.
 *
 * Real strings: the provider names, the self-hosted endpoint, the model, the
 * four checks (ai/check.ts) and the organization's "Sent to" line.
 */

type S = {
  beat: number;
  open: boolean;
  hover: number;
  model: string;
  checks: number;
};

const CLOUD = [
  "OpenAI",
  "Anthropic",
  "Google Gemini",
  "Azure OpenAI",
  "Amazon Bedrock",
  "Mistral AI",
];
const SELF_HOSTED = ["Ollama", "vLLM", "LM Studio"];
const OLLAMA = CLOUD.length;
const MODEL = "qwen3:32b";
const CHECKS = [
  "Structured output",
  "Streamed tool call",
  "Answer after a tool result",
  "Dictation",
];

const initial: S = { beat: 0, open: false, hover: -1, model: "", checks: 0 };
const DONE = 5;
const poster: S = {
  beat: DONE,
  open: false,
  hover: -1,
  model: MODEL,
  checks: CHECKS.length,
};

async function script(a: Act<S>) {
  const compact = a.layout === "compact";
  await a.wait(700);
  a.mark("choose");
  if (!compact) {
    await a.move("provider");
    await a.click();
  }
  a.put({ open: !compact });
  if (!compact) {
    await a.wait(350);
    // Past the cloud providers to the self-hosted ones.
    for (const i of [1, 3, OLLAMA]) {
      a.put({ hover: i });
      await a.move(`option-${i}`, { duration: i === OLLAMA ? 420 : 260 });
    }
    await a.wait(200);
    await a.click();
  }
  await a.set({ open: false, hover: -1, beat: 1 });
  await a.wait(500);
  a.mark("model");
  if (!compact) await a.click("model");
  await a.type("model", MODEL, { interval: 55 });
  await a.wait(350);
  a.put({ beat: 2 });
  await a.wait(500);
  a.mark("test");
  if (!compact) await a.click({ at: "test", x: 0.86, y: 0.7 });
  a.put({ beat: 3 });
  await a.stagger(
    CHECKS,
    async (_, i) => {
      await a.wait(260 + i * 260);
      a.put({ checks: i + 1 });
    },
    0,
  );
  await a.wait(500);
  if (!compact) await a.click({ at: "save", x: 0.82, y: 0.7 });
  a.put({ beat: 4 });
  await a.wait(450);
  a.put({ beat: DONE });
  if (!compact) await a.move({ at: "rest", x: 0.5, y: 0.5 });
  await a.wait(2600);
}

function ProviderMenu({ s }: { s: S }) {
  const option = (label: string, i: number, hosted: boolean) => (
    <span
      key={label}
      className="md-option"
      data-target={`option-${i}`}
      data-hover={s.hover === i || undefined}
    >
      {label}
      {hosted ? <span className="md-tag">Self-hosted</span> : null}
    </span>
  );
  return (
    <div className="md-menu" data-open={s.open || undefined} aria-hidden>
      <span className="md-group">Cloud</span>
      {CLOUD.map((label, i) => option(label, i, false))}
      <span className="md-group">Self-hosted</span>
      {SELF_HOSTED.map((label, i) => option(label, OLLAMA + i, true))}
    </div>
  );
}

function Field({
  label,
  children,
  target,
}: {
  label: string;
  children: React.ReactNode;
  target?: string;
}) {
  return (
    <div className="md-field">
      <span className="md-label">{label}</span>
      <span className="md-input" data-target={target}>
        {children}
      </span>
    </div>
  );
}

function ConsoleWindow({ s, layout }: { s: S; layout: Layout }) {
  const chosen = s.beat >= 1;
  return (
    <Window
      title="Admin console · AI providers"
      className="md-win md-win--console"
    >
      <div className="md-console">
        <div className="md-card">
          <div className="md-card-head">
            <span className="md-card-title">Language model</span>
          </div>
          <div className="md-field">
            <span className="md-label">Provider</span>
            <span className="md-select" data-target="provider">
              <States
                align="start"
                value={chosen ? "ollama" : "none"}
                states={{
                  none: (
                    <span className="md-placeholder">Choose a provider</span>
                  ),
                  ollama: (
                    <span className="md-chosen">
                      Ollama <span className="md-tag">Self-hosted</span>
                    </span>
                  ),
                }}
              />
              <ChevronDown aria-hidden className="md-chevron" />
            </span>
          </div>
          {layout === "wide" ? <ProviderMenu s={s} /> : null}
          <Field label="Base URL">
            <States
              align="start"
              value={chosen ? "local" : "none"}
              states={{
                none: <span className="md-placeholder">—</span>,
                local: (
                  <span className="md-mono">
                    http://host.docker.internal:11434/v1
                  </span>
                ),
              }}
            />
          </Field>
          <div className="md-field">
            <span className="md-label">Model</span>
            <KitField
              className="md-kit-field"
              value={s.model}
              placeholder="A model you pulled"
              focused={s.beat === 1}
              box={{ "data-target": "model" }}
            />
          </div>
        </div>
        <div className="md-card md-card--dictation">
          <Field label="Dictation">
            <States
              align="start"
              value={s.beat >= 2 ? "whisper" : "none"}
              states={{
                none: <span className="md-placeholder">Off</span>,
                whisper: (
                  <span className="md-chosen">
                    Speaches (faster-whisper){" "}
                    <span className="md-tag">Self-hosted</span>
                  </span>
                ),
              }}
            />
          </Field>
        </div>
        <div className="md-actions">
          <span className="md-button md-button--primary" data-target="save">
            Save
          </span>
          <span className="md-button" data-target="test">
            Test before saving
          </span>
          <span className="md-saved" data-on={s.beat >= 4 || undefined}>
            Saved
          </span>
        </div>
        <Collapse open={s.beat >= 3} reveal="drop">
          <div className="md-checks">
            {CHECKS.map((label, i) => (
              <span key={label} className="md-check">
                <Check on={s.checks > i} pending={s.checks === i} size={15} />
                {label}
              </span>
            ))}
          </div>
        </Collapse>
      </div>
    </Window>
  );
}

function SentTo({ s }: { s: S }) {
  return (
    <Window
      title="Northwind · Lictory Intelligence"
      className="md-win md-win--org"
    >
      <div className="md-org">
        <span className="md-label">Sent to</span>
        <States
          align="start"
          value={s.beat >= DONE ? "local" : "cloud"}
          states={{
            cloud: <span className="md-placeholder">No AI provider yet</span>,
            local: (
              <span className="md-sent">
                <Server aria-hidden /> A model server run by your company
                (Ollama)
              </span>
            ),
          }}
        />
        <span className="md-label">Model</span>
        <span className="md-mono md-strong">
          {s.beat >= DONE ? MODEL : "—"}
        </span>
        <span className="md-filler" style={{ width: 52 }} />
        <span className="md-filler" style={{ width: 180 }} />
        <span className="md-filler" style={{ width: 40 }} />
        <span className="md-filler" style={{ width: 210 }} />
        <span className="md-filler" style={{ width: 58 }} />
        <span className="md-filler" style={{ width: 150 }} />
      </div>
    </Window>
  );
}

function Scene({ s, layout }: { s: S; layout: Layout }) {
  return (
    <>
      <ConsoleWindow s={s} layout={layout} />
      {layout === "wide" ? <SentTo s={s} /> : null}
      <span className="md-rest" data-target="rest" />
    </>
  );
}

export function ModelsScene() {
  const theme = useSiteTheme();
  return (
    <SceneFrame
      className="models-scene"
      label="In the admin console, an administrator opens the provider list, where OpenAI, Anthropic, Google Gemini, Azure OpenAI, Amazon Bedrock and Mistral sit beside self-hosted Ollama, vLLM and LM Studio, and picks Ollama. The endpoint fills in for a server on the same machine, the model qwen3:32b is typed, a self-hosted Whisper server takes dictation, and Test before saving passes four checks. Saved, the organization sees that its content goes to a model server the company runs."
    >
      {(run) => (
        <Stage<S>
          key={run}
          width={1184}
          height={520}
          compact={{ below: 860, width: 390, height: 430 }}
          initial={initial}
          poster={poster}
          script={script}
          play="once"
          theme={theme}
          cursor={{ at: { at: "rest", x: 0.5, y: 0.5 } }}
          className="lx md"
        >
          {(s, _rect, layout) => <Scene s={s} layout={layout} />}
        </Stage>
      )}
    </SceneFrame>
  );
}
