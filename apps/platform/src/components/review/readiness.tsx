import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { CircleCheck, CircleDashed } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { relativeTime } from "@lictory/core/lib/work-items";
import type { ReadinessCheck } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { SectionLabel } from "@lictory/ui/primitives";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Evidence, not a percentage: each check states what it verified and, when it
// fails, what would make it pass.
export function Readiness() {
  const { readiness, item, project, type } = useItem();
  const { directory, organization } = useWorkspace();
  const checks = readiness?.checks ?? [];
  const passed = checks.filter((c) => c.passed).length;
  const latest = directory.readiness.find((r) => r.projectId === project.id);
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Readiness</SectionLabel>
        {checks.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              passed === checks.length
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {passed} / {checks.length} checks
          </span>
        )}
      </div>
      {!readiness ? (
        <p className="text-[13px] text-muted-foreground">Evaluating…</p>
      ) : checks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          The Definition of Ready of {type.name} items has no check that applies
          here, so this item cannot become ready.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <CheckRow key={c.key} check={c} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {item.refinementState === "ready"
          ? "All checks pass for this revision. The specification is ready for delivery; readiness does not accept, schedule or start the work."
          : "The specification becomes Ready automatically when every check passes."}
      </p>
      {checks.find((check) => !check.passed && !check.signOff)?.detail && (
        <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-relaxed">
          <span className="font-medium">Next concern:</span>{" "}
          {checks.find((check) => !check.passed && !check.signOff)?.detail}
        </p>
      )}
      {readiness?.pinned && latest && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Kept on Definition of Ready{" "}
          {readiness.policyRevisionNumber
            ? `version ${readiness.policyRevisionNumber}`
            : "defaults"}{" "}
          because it was ready or done when the rules changed. It moves to{" "}
          <Link
            href={paths.projectSettings(
              organization.slug,
              project.key,
              "readiness",
            )}
            className="underline underline-offset-2 hover:text-foreground"
          >
            version {latest.number}
          </Link>{" "}
          if it stops being ready or done.
        </p>
      )}
    </section>
  );
}

function CheckRow({ check }: { check: ReadinessCheck }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5">
      {check.passed ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn(!check.passed && "text-foreground")}>{check.label}</p>
        {!check.passed && check.detail && (
          <p className="text-xs text-muted-foreground">{check.detail}</p>
        )}
        {check.signOff && <SignOff check={check} />}
      </div>
    </li>
  );
}

// Manual checks are confirmed by a person for the current revision; the
// server decides who may sign off, this only hides controls that would fail.
function SignOff({ check }: { check: ReadinessCheck }) {
  const {
    item,
    base,
    readOnly,
    userId,
    memberName,
    disciplineName,
    mutateConfirmed,
  } = useItem();
  const { directory } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const signOff = check.signOff!;
  const eligible = directory.disciplines.some(
    (d) =>
      d.projectId === item.projectId &&
      !d.archivedAt &&
      d.userIds.includes(userId) &&
      (signOff.disciplineIds.length === 0 ||
        signOff.disciplineIds.includes(d.id)),
  );
  const who = signOff.disciplineIds.length
    ? signOff.disciplineIds.map(disciplineName).join(" or ")
    : "anyone with a discipline in this project";
  const run = async (signedOff: boolean) => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed({
        type: "signOffReadinessCheck",
        ...base,
        checkId: check.key,
        signedOff,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The sign-off was not saved.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-1 space-y-1">
      {signOff.signedOffBy ? (
        <p className="text-xs text-muted-foreground">
          Signed off by {memberName(signOff.signedOffBy)}
          {signOff.signedOffAt && ` · ${relativeTime(signOff.signedOffAt)}`}
        </p>
      ) : (
        !eligible && (
          <p className="text-xs text-muted-foreground">Signed off by {who}.</p>
        )
      )}
      {eligible && !readOnly && (
        <Button
          size="sm"
          variant={signOff.signedOffBy ? "ghost" : "outline"}
          disabled={pending}
          onClick={() => void run(!signOff.signedOffBy)}
        >
          {signOff.signedOffBy ? "Withdraw sign-off" : "Sign off"}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
