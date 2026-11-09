import { Popover, Picker } from "@lictory/ui/popover";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Lock,
  Mic,
  Server,
  Sparkles,
} from "lucide-react";
import {
  aiFieldLabels,
  secretFields,
  textProviderIds,
  textProviders,
  transcriptionProviderIds,
  transcriptionProviders,
  type AiField,
  type TextProvider,
  type TranscriptionProvider,
} from "@lictory/core/contracts/ai-provider";
import { Button } from "@lictory/ui/button";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import { SettingsSectionSkeleton } from "@lictory/ui/skeleton";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  adminRequest,
  useAdminResource,
  type AiCheckReport,
  type AiSettingsView,
  type Described,
} from "@lictory/platform/components/admin/admin-api";

// The installation's AI providers, for instance administrators: one for
// text (reviews, proposal intake, Litto) and one for dictation. The server
// keeps the keys; this form only ever sends new ones and sees whether each
// is set. When the server's environment configures AI, the settings are
// shown read-only with the variables that set them.

type Part = "text" | "transcription";
type Values = Partial<Record<AiField, string>> & { provider: string };
type Form = {
  text: Values | null;
  // "default": live OpenAI dictation when text goes to OpenAI, else off.
  transcription: Values | "default" | null;
  timeoutSeconds: string;
};

const editableFields: AiField[] = [
  "model",
  "baseUrl",
  "apiKey",
  "region",
  "project",
  "location",
  "accessKeyId",
  "secretAccessKey",
  "tenantId",
  "clientId",
  "clientSecret",
  "structuredOutput",
];
const isSecret = (f: AiField) => secretFields.includes(f);

const specOf = (part: Part, provider: string) =>
  part === "text"
    ? (textProviders as Record<string, TextProvider>)[provider]
    : (transcriptionProviders as Record<string, TranscriptionProvider>)[
        provider
      ];

function fromStored(
  stored: Record<string, string | boolean> | null | undefined,
): Values | null {
  if (!stored) return null;
  const values: Values = { provider: String(stored.provider) };
  for (const f of editableFields)
    if (!isSecret(f) && typeof stored[f] === "string") values[f] = stored[f];
  return values;
}

// What the server needs: secrets only when typed (or "" to remove one).
function toInput(form: Form, removed: Set<string>) {
  const part = (name: Part, values: Values | null) => {
    if (!values) return null;
    const out: Record<string, string> = { provider: values.provider };
    for (const f of editableFields) {
      const v = values[f]?.trim();
      if (isSecret(f)) {
        if (v) out[f] = v;
        else if (removed.has(`${name}.${f}`)) out[f] = "";
      } else if (v) out[f] = v;
    }
    return out;
  };
  const timeout = form.timeoutSeconds.trim();
  return {
    text: part("text", form.text),
    transcription:
      form.transcription === "default"
        ? "default"
        : part("transcription", form.transcription),
    // Empty: back to the default. Checked before sending (timeoutProblem).
    timeoutSeconds: timeout ? Number(timeout) : null,
  };
}

function timeoutProblem(value: string) {
  const v = value.trim();
  if (!v) return "";
  const n = Number(v);
  return /^\d+$/.test(v) && n >= 30 && n <= 480
    ? ""
    : "The timeout is a whole number of seconds from 30 to 480, or empty for the default (240).";
}

// Whether the server maps host.docker.internal (LICTORY_HOST_MODEL_SERVER).
const HostModelServer = createContext(false);

const looksLocal = (url: string | undefined) =>
  !!url && /\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/i.test(url);

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Try again.";

export function AiSettings() {
  const { data, error, reload } = useAdminResource<AiSettingsView>("/ai");
  // Outlives the form, which starts over from each saved version.
  const [saved, setSaved] = useState("");
  if (error && !data) return <InlineError>{error}</InlineError>;
  if (!data) return <SettingsSectionSkeleton />;
  return data.editable ? (
    <HostModelServer.Provider value={data.hostModelServer}>
      <AiSettingsForm
        key={data.stored?.version ?? 0}
        view={data}
        saved={saved}
        onSaved={(message) => {
          setSaved(message);
          reload();
        }}
      />
    </HostModelServer.Provider>
  ) : (
    <AiSettingsReadOnly view={data} />
  );
}

function Current({
  text,
  dictation,
}: {
  text: Described;
  dictation: Described;
}) {
  return (
    <div className="divide-y divide-border text-[13px]">
      {(
        [
          ["Language model", text, Sparkles],
          ["Dictation", dictation, Mic],
        ] as const
      ).map(([label, d, Icon]) => (
        <div
          key={label}
          className="grid gap-1 px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4"
        >
          <p className="flex items-center gap-2 text-muted-foreground">
            <Icon aria-hidden className="size-4" strokeWidth={1.75} />
            {label}
          </p>
          {d.state === "configured" ? (
            <div>
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {d.label}
                <Badge tone="neutral">
                  {d.hosting === "self-hosted" ? "Self-hosted" : "Cloud"}
                </Badge>
                {d.mode && (
                  <Badge tone="neutral">
                    {d.mode === "realtime" ? "Live" : "Recorded clips"}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 leading-5 text-muted-foreground">
                <span className="font-mono text-xs">
                  {d.model || "default model"}
                </span>{" "}
                · <span className="font-mono text-xs">{d.endpoint}</span>
                {d.authenticated ? ` · key from ${d.keySetting}` : " · no key"}
              </p>
            </div>
          ) : (
            <p className="font-medium">
              {d.state === "invalid" ? "Misconfigured" : "Off"}
              {d.state === "invalid" && (
                <span className="mt-0.5 block leading-5 font-normal text-muted-foreground">
                  {d.problems.join(" ")}
                </span>
              )}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function AiSettingsReadOnly({ view }: { view: AiSettingsView }) {
  return (
    <>
      <SettingsSection
        id="ai-provider"
        icon={<Lock />}
        title="AI providers"
        description={
          view.source === "environment"
            ? "Set in the server's environment, which takes precedence over this console."
            : "The operator turned off AI configuration in this console (LICTORY_AI_CONSOLE=false)."
        }
        action={<CheckButton />}
        footer={
          <>
            Change them on the server:{" "}
            <code className="font-mono">sudo lictory ai setup</code> or{" "}
            <code className="font-mono">
              sudo lictory config set LICTORY_AI_…
            </code>
            . Remove every LICTORY_AI_* and OPENAI_API_KEY setting to manage
            them here instead.
          </>
        }
      >
        <Current text={view.text} dictation={view.dictation} />
        <Notices view={view} />
      </SettingsSection>
      <CheckResult />
    </>
  );
}

function Notices({ view }: { view: AiSettingsView }) {
  if (!view.problems.length && !view.warnings.length) return null;
  return (
    <div className="space-y-2 border-t border-border px-5 py-3" role="status">
      {[...view.problems, ...view.warnings].map((text) => (
        <p
          key={text}
          className="flex gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-[13px] leading-5"
        >
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-amber-600"
          />
          {text}
        </p>
      ))}
    </div>
  );
}

// The check of what is configured now, shared by both views.
let lastReport: { report?: AiCheckReport; error?: string } = {};
const listeners = new Set<() => void>();
function useLastReport() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);
  return lastReport;
}
function publish(next: typeof lastReport) {
  lastReport = next;
  listeners.forEach((l) => l());
}

function CheckButton({ label = "Check connection" }: { label?: string }) {
  const [checking, setChecking] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={checking}
      onClick={async () => {
        setChecking(true);
        try {
          publish({
            report: await adminRequest<AiCheckReport>("/ai/check", {
              method: "POST",
              body: {},
            }),
          });
        } catch (e) {
          publish({ error: message(e) });
        } finally {
          setChecking(false);
        }
      }}
    >
      {checking ? "Checking…" : label}
    </Button>
  );
}

function CheckResult({ report: given }: { report?: AiCheckReport }) {
  const last = useLastReport();
  const report = given ?? last.report;
  if (!report && !last.error) return null;
  return (
    <div
      className="space-y-2 rounded-xl bg-card px-5 py-4 text-[13px] shadow-(--shadow-border)"
      role="status"
      aria-label="Connection check"
    >
      {!given && <InlineError>{last.error}</InlineError>}
      {report && <Report report={report} />}
    </div>
  );
}

const checkNames: Record<string, string> = {
  "structured-output": "Structured output",
  "streamed-tool-call": "Streamed tool call",
  "tool-result": "Answer after a tool result",
  dictation: "Dictation",
};

function Report({ report }: { report: AiCheckReport }) {
  const checks = [...report.text.checks, ...report.dictation.checks];
  const problems = [...report.text.problems, ...report.dictation.problems];
  return (
    <>
      {problems.map((p) => (
        <p key={p} className="text-destructive">
          {p}
        </p>
      ))}
      {checks.map((c) => (
        <p key={c.id} className="flex gap-2">
          {c.ok ? (
            <CircleCheck
              aria-label="Passed"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
          ) : (
            <CircleAlert
              aria-label="Failed"
              className="mt-0.5 size-4 shrink-0 text-amber-600"
            />
          )}
          <span>
            <span className="font-medium">{checkNames[c.id] ?? c.id}</span>{" "}
            <span className="text-muted-foreground">
              ({(c.ms / 1000).toFixed(1)} s, for {c.needs})
            </span>
            : {c.detail}
          </span>
        </p>
      ))}
      <p className="text-muted-foreground">
        {report.ok
          ? "These providers work with Lictory Intelligence. The check uses synthetic content; it does not measure quality."
          : report.text.state === "configured"
            ? "Some Lictory Intelligence features will fail with these settings."
            : "No language model is configured: Lictory Intelligence is off."}
      </p>
    </>
  );
}

function AiSettingsForm({
  view,
  saved,
  onSaved,
}: {
  view: AiSettingsView;
  saved: string;
  onSaved: (message: string) => void;
}) {
  const initial = useMemo<Form>(
    () => ({
      text: fromStored(view.stored?.text),
      transcription:
        view.stored?.transcription === "default" || !view.stored
          ? "default"
          : fromStored(view.stored.transcription),
      timeoutSeconds: view.stored?.timeoutSeconds
        ? String(view.stored.timeoutSeconds)
        : "",
    }),
    [view],
  );
  const [form, setForm] = useState<Form>(initial);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(saved);
  const [report, setReport] = useState<AiCheckReport>();

  const storedSet = (part: Part, field: AiField) => {
    const stored = view.stored?.[part];
    const current = form[part];
    return (
      typeof stored === "object" &&
      stored !== null &&
      typeof current === "object" &&
      current !== null &&
      stored.provider === current.provider &&
      stored[`${field}Set`] === true &&
      !removed.has(`${part}.${field}`)
    );
  };
  const update = (part: Part, values: Values | null | "default") => {
    setForm((f) => ({ ...f, [part]: values }));
    setDone("");
    setReport(undefined);
  };

  const run = async (kind: "test" | "save") => {
    setBusy(kind);
    setError("");
    setDone("");
    const invalid = timeoutProblem(form.timeoutSeconds);
    if (invalid) {
      setError(invalid);
      setBusy(null);
      return;
    }
    try {
      const body = toInput(form, removed);
      if (kind === "test")
        setReport(
          await adminRequest<AiCheckReport>("/ai/test", {
            method: "POST",
            body,
          }),
        );
      else {
        await adminRequest("/ai", { method: "PUT", body });
        onSaved(
          "Saved. The API and workers use these settings within seconds; organizations see the new provider in their settings.",
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingsSection
        id="ai-provider"
        icon={<Sparkles />}
        title="Language model"
        description="Reviews, proposal intake and Litto use it once an organization turns Lictory Intelligence on. Requests go only to this provider; there is no fallback."
      >
        <ProviderEditor
          part="text"
          values={form.text}
          onChange={(v) => update("text", v)}
          storedSet={(f) => storedSet("text", f)}
          onRemove={(f) => setRemoved((r) => new Set(r).add(`text.${f}`))}
        />
      </SettingsSection>
      <SettingsSection
        id="ai-dictation"
        icon={<Mic />}
        title="Dictation"
        description="Speech to text in the Litto composer. Live dictation streams from the browser to OpenAI; every other provider receives short clips through this server, which keeps nothing."
      >
        <DictationEditor
          form={form}
          onChange={(v) => update("transcription", v)}
          storedSet={(f) => storedSet("transcription", f)}
          onRemove={(f) =>
            setRemoved((r) => new Set(r).add(`transcription.${f}`))
          }
        />
      </SettingsSection>
      <SettingsSection
        id="ai-advanced"
        icon={<Server />}
        title="Requests"
        description="How long one structured call may take, retries included. Raise it for slow self-hosted hardware."
      >
        <SettingsBody className="text-[13px]">
          <label className="block max-w-xs">
            <span className="font-medium">Timeout (seconds)</span>
            <Input
              inputMode="numeric"
              className="mt-1.5 h-9 rounded-lg text-sm"
              placeholder="240"
              value={form.timeoutSeconds}
              onChange={(e) =>
                setForm((f) => ({ ...f, timeoutSeconds: e.target.value }))
              }
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              30 to 480. Review runs end a minute later.
            </span>
          </label>
        </SettingsBody>
      </SettingsSection>
      <div className="sticky bottom-0 z-10 -mx-1 space-y-3 rounded-xl bg-background/95 px-1 py-3 backdrop-blur">
        <InlineError>{error}</InlineError>
        {done && (
          <p className="flex gap-2 text-[13px] text-success" role="status">
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
            {done}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void run("save")} disabled={busy !== null}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void run("test")}
            disabled={busy !== null || !form.text}
          >
            {busy === "test" ? "Testing…" : "Test before saving"}
          </Button>
          <CheckButton label="Check what is saved" />
          {view.stored?.updatedAt && (
            <span className="text-xs text-muted-foreground">
              Saved {new Date(view.stored.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>
      {report && (
        <div
          className="space-y-2 rounded-xl bg-card px-5 py-4 text-[13px] shadow-(--shadow-border)"
          role="status"
          aria-label="Test result"
        >
          <Report report={report} />
        </div>
      )}
      <CheckResult />
      <Notices view={view} />
    </>
  );
}

function ProviderSelect({
  part,
  value,
  onChange,
  extra,
}: {
  part: Part;
  value: string;
  onChange: (provider: string) => void;
  extra?: ReactNode;
}) {
  const ids =
    part === "text"
      ? (textProviderIds as readonly string[])
      : (transcriptionProviderIds as readonly string[]);
  const groups = (["cloud", "self-hosted"] as const).map((hosting) => ({
    hosting,
    ids: ids.filter((id) => specOf(part, id)?.hosting === hosting),
  }));
  return (
    <DropdownSelect
      aria-label={
        part === "text" ? "Language model provider" : "Dictation provider"
      }
      className="mt-1.5 w-full max-w-sm"
      value={value}
      onValueChange={onChange}
    >
      {extra}
      {groups.map((g) =>
        g.ids.map((id) => (
          <DropdownSelectOption key={id} value={id}>
            {specOf(part, id)!.label}
            {g.hosting === "self-hosted" ? " · self-hosted" : ""}
          </DropdownSelectOption>
        )),
      )}
    </DropdownSelect>
  );
}

function ProviderEditor({
  part,
  values,
  onChange,
  storedSet,
  onRemove,
}: {
  part: Part;
  values: Values | null;
  onChange: (values: Values | null) => void;
  storedSet: (field: AiField) => boolean;
  onRemove: (field: AiField) => void;
}) {
  return (
    <SettingsBody className="space-y-4 text-[13px]">
      <div>
        <span className="block font-medium">Provider</span>
        <ProviderSelect
          part={part}
          value={values?.provider ?? "none"}
          onChange={(provider) =>
            onChange(provider === "none" ? null : { provider })
          }
          extra={
            <DropdownSelectOption value="none">
              None (Lictory Intelligence off)
            </DropdownSelectOption>
          }
        />
      </div>
      {values && (
        <Fields
          part={part}
          values={values}
          onChange={onChange}
          storedSet={storedSet}
          onRemove={onRemove}
        />
      )}
    </SettingsBody>
  );
}

function DictationEditor({
  form,
  onChange,
  storedSet,
  onRemove,
}: {
  form: Form;
  onChange: (values: Values | null | "default") => void;
  storedSet: (field: AiField) => boolean;
  onRemove: (field: AiField) => void;
}) {
  const value =
    form.transcription === "default"
      ? "default"
      : (form.transcription?.provider ?? "none");
  const textVendor = form.text
    ? specOf("text", form.text.provider)?.vendor
    : undefined;
  const values =
    typeof form.transcription === "object" ? form.transcription : null;
  // Self-hosted servers are separate machines: they share nothing.
  const shared =
    values &&
    textVendor !== "self-hosted" &&
    specOf("transcription", values.provider)?.vendor === textVendor;
  return (
    <SettingsBody className="space-y-4 text-[13px]">
      <div>
        <span className="block font-medium">Provider</span>
        <ProviderSelect
          part="transcription"
          value={value}
          onChange={(provider) =>
            onChange(
              provider === "none"
                ? null
                : provider === "default"
                  ? "default"
                  : { provider },
            )
          }
          extra={
            <>
              <DropdownSelectOption value="default">
                Automatic (live OpenAI when text uses OpenAI)
              </DropdownSelectOption>
              <DropdownSelectOption value="none">Off</DropdownSelectOption>
            </>
          }
        />
      </div>
      {values && (
        <>
          {shared && (
            <p className="text-muted-foreground">
              Same vendor as the language model: empty fields use its key and
              settings.
            </p>
          )}
          <Fields
            part="transcription"
            values={values}
            onChange={(v) => onChange(v)}
            storedSet={storedSet}
            onRemove={onRemove}
            optionalKey={Boolean(shared)}
          />
        </>
      )}
    </SettingsBody>
  );
}

function Fields({
  part,
  values,
  onChange,
  storedSet,
  onRemove,
  optionalKey,
}: {
  part: Part;
  values: Values;
  onChange: (values: Values) => void;
  storedSet: (field: AiField) => boolean;
  onRemove: (field: AiField) => void;
  optionalKey?: boolean;
}) {
  const hostModelServer = useContext(HostModelServer);
  const spec = specOf(part, values.provider);
  if (!spec) return null;
  const id = `${part}-${values.provider}`;
  const set = (field: AiField, value: string) =>
    onChange({ ...values, [field]: value });
  return (
    <>
      {(spec.note ?? spec.keysUrl) && (
        <p className="leading-5 text-muted-foreground">
          {spec.note}{" "}
          {spec.keysUrl && (
            <a
              className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
              href={spec.keysUrl}
              target="_blank"
              rel="noreferrer"
            >
              Get a key
              <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {editableFields
          .filter((f) => spec.fields[f])
          .map((f) => {
            const need =
              optionalKey && f === "apiKey" ? "optional" : spec.fields[f];
            const label = `${aiFieldLabels[f]}${need === "optional" ? " (optional)" : ""}`;
            if (f === "structuredOutput")
              return (
                <div key={f}>
                  <span className="font-medium">{label}</span>
                  <DropdownSelect
                    aria-label={aiFieldLabels[f]}
                    className="mt-1.5 w-full"
                    value={values[f] ?? "json-schema"}
                    onValueChange={(v) => set(f, v)}
                  >
                    <DropdownSelectOption value="json-schema">
                      JSON schema (response_format)
                    </DropdownSelectOption>
                    <DropdownSelectOption value="json-object">
                      JSON mode, schema in the instructions
                    </DropdownSelectOption>
                  </DropdownSelect>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    JSON mode for servers or models that ignore JSON schemas.
                  </span>
                </div>
              );
            const secret = isSecret(f);
            const stored = secret && storedSet(f);
            const wide = f === "apiKey" || f === "baseUrl";
            return (
              <div key={f} className={wide ? "sm:col-span-2" : undefined}>
                <span className="flex items-center gap-2 font-medium">
                  <label htmlFor={`${id}-${f}`}>{label}</label>
                  {stored && (
                    <>
                      <Badge tone="neutral">Stored</Badge>
                      <button
                        type="button"
                        aria-label={`Remove the stored ${aiFieldLabels[f].replace(/^[A-Z][a-z]/, (c) => c.toLowerCase())}`}
                        className="text-xs font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => onRemove(f)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </span>
                <Input
                  id={`${id}-${f}`}
                  className="mt-1.5 h-9 rounded-lg font-mono text-sm"
                  type={secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={
                    stored
                      ? "Stored. Type a new value to replace it."
                      : f === "baseUrl"
                        ? (spec.defaultBaseUrl ?? "https://…")
                        : f === "model"
                          ? (spec.defaultModel ?? spec.models[0] ?? "")
                          : f === "region"
                            ? "us-east-1"
                            : f === "location"
                              ? "us-central1"
                              : f === "apiKey" && spec.vendor === "google-cloud"
                                ? "API key, or a service account key's JSON"
                                : ""
                  }
                  value={values[f] ?? ""}
                  onChange={(e) => set(f, e.target.value)}
                />
                {f === "model" && (
                  <>
                    <Popover
                      width={280}
                      trigger={(props) => (
                        <Button
                          {...props}
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="mt-1"
                        >
                          Choose a suggested model
                        </Button>
                      )}
                    >
                      <Picker
                        title="Suggested models"
                        searchable
                        options={spec.models.map((m) => ({
                          value: m,
                          label: m,
                        }))}
                        value={values[f] ?? ""}
                        onSelect={(value) => set(f, value)}
                      />
                    </Popover>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {spec.modelHint}
                    </span>
                  </>
                )}
                {f === "baseUrl" &&
                  !hostModelServer &&
                  (values.baseUrl ?? spec.defaultBaseUrl ?? "").includes(
                    "host.docker.internal",
                  ) && (
                    <span className="mt-1 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <CircleAlert
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0"
                      />
                      <span>
                        A server on this machine: set{" "}
                        <code className="font-mono">
                          LICTORY_HOST_MODEL_SERVER=true
                        </code>{" "}
                        on the server first (
                        <code className="font-mono">
                          sudo lictory config set LICTORY_HOST_MODEL_SERVER=true
                        </code>
                        ), and let the model server listen on 0.0.0.0.
                      </span>
                    </span>
                  )}
                {f === "baseUrl" && looksLocal(values.baseUrl) && (
                  <span className="mt-1 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <CircleAlert
                      aria-hidden
                      className="mt-0.5 size-3.5 shrink-0"
                    />
                    Inside a container, localhost is the container itself. For a
                    server on the same machine use host.docker.internal.
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </>
  );
}
