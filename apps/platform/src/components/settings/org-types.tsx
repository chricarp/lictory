import { useState } from "react";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Archive, ArchiveRestore, Plus, Shapes } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { labelColorClasses, typeLevels } from "@lictory/core/lib/work-items";
import {
  labelColors,
  type Command,
  type LabelColor,
  type WorkItemType,
} from "@lictory/core/contracts/protocol";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import { Input } from "@lictory/ui/input";
import { Popover } from "@lictory/ui/popover";
import { Tooltip } from "@lictory/ui/tooltip";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";

const icons: WorkItemType["icon"][] = [
  "epic",
  "story",
  "task",
  "bug",
  "subtask",
  "spike",
  "chore",
];
// Indexed by level (`typeLevels`): a parent sits strictly above its children.
const levelLabel = [
  "Subtask level",
  "Task level",
  "Story level",
  "Epic level",
  "Initiative level",
];

// The organization's type registry. Each project chooses which of these
// types it uses.
export function OrganizationTypes() {
  const { delivery, isAdmin, directory, mutate } = useWorkspace();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<
    Pick<WorkItemType, "name" | "icon" | "color" | "level" | "hasSpecification">
  >({
    name: "",
    icon: "task",
    color: "blue",
    level: typeLevels.task,
    hasSpecification: false,
  });
  const run = async (command: Command) => {
    setError(undefined);
    try {
      await mutate(command);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
    }
  };
  const types = [...delivery.types.values()].sort(
    (a, b) => b.level - a.level || a.position - b.position,
  );
  const active = new Set(
    directory.projects.filter((p) => !p.archivedAt).map((p) => p.id),
  );
  const usedBy = (typeId: string) =>
    directory.projectTypes.filter(
      (t) => t.typeId === typeId && active.has(t.projectId),
    ).length;
  return (
    <>
      <SettingsSection
        id="types"
        icon={<Shapes />}
        title="Work item types"
        description="Levels order the hierarchy: a parent sits above its children (Epic above Story, Story above Task and Bug, those above Subtask). The level is chosen when a type is added. Types with a specification are refined and reviewed; others are plain work. Each project chooses which of these types it uses in its workflow settings."
        action={
          isAdmin && !creating ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" /> Add type
            </Button>
          ) : undefined
        }
      >
        <SettingsList isEmpty={types.length === 0} empty="No types.">
          {types.map((t) => {
            const projects = usedBy(t.id);
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
              >
                <TypeIcon type={t} />
                <span
                  className={cn(
                    "flex-1 font-medium",
                    t.archivedAt && "text-muted-foreground line-through",
                  )}
                >
                  {t.name}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {projects === 0
                    ? "No projects"
                    : `${projects} project${projects === 1 ? "" : "s"}`}
                </span>
                <span className="w-24 text-xs text-muted-foreground">
                  {levelLabel[t.level]}
                </span>
                <label
                  htmlFor={`type-specification-${t.id}`}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Checkbox
                    id={`type-specification-${t.id}`}
                    disabled={!isAdmin}
                    checked={t.hasSpecification}
                    onCheckedChange={(checked) =>
                      void run({
                        type: "updateType",
                        typeId: t.id,
                        hasSpecification: checked === true,
                      })
                    }
                  />
                  Specification
                </label>
                {isAdmin && (
                  <Tooltip label={t.archivedAt ? "Restore" : "Archive"}>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={
                        t.archivedAt
                          ? `Restore type ${t.name}`
                          : `Archive type ${t.name}`
                      }
                      onClick={() =>
                        void run({
                          type: "updateType",
                          typeId: t.id,
                          archived: !t.archivedAt,
                        })
                      }
                    >
                      {t.archivedAt ? (
                        <ArchiveRestore className="size-3.5" />
                      ) : (
                        <Archive className="size-3.5" />
                      )}
                    </Button>
                  </Tooltip>
                )}
              </div>
            );
          })}
        </SettingsList>
        {creating && (
          <form
            className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim()) return;
              void run({
                type: "createType",
                typeId: crypto.randomUUID(),
                ...draft,
                name: draft.name.trim(),
              });
              setCreating(false);
              setDraft({ ...draft, name: "" });
            }}
          >
            <Popover
              width={180}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label="Icon and color"
                  className="grid size-8 place-items-center rounded-md hover:bg-muted"
                >
                  <TypeIcon type={{ ...draft, name: draft.name || "Type" }} />
                </button>
              )}
            >
              <div className="space-y-1 p-2">
                <RadioGroup<WorkItemType["icon"]>
                  aria-label="Icon"
                  value={draft.icon}
                  onValueChange={(icon) => {
                    if (icon) setDraft({ ...draft, icon });
                  }}
                  className="grid grid-cols-7 gap-1"
                >
                  {icons.map((icon) => (
                    <Radio
                      key={icon}
                      value={icon}
                      aria-label={icon}
                      className="grid size-7 cursor-default place-items-center rounded hover:bg-muted data-checked:bg-muted"
                    >
                      <TypeIcon
                        type={{ icon, color: draft.color, name: icon }}
                      />
                    </Radio>
                  ))}
                </RadioGroup>
                <RadioGroup<LabelColor>
                  aria-label="Color"
                  value={draft.color}
                  onValueChange={(color) => {
                    if (color) setDraft({ ...draft, color });
                  }}
                  className="grid grid-cols-7 gap-1"
                >
                  {labelColors.map((color) => (
                    <Radio
                      key={color}
                      value={color}
                      aria-label={color}
                      className="grid size-7 cursor-default place-items-center rounded hover:bg-muted data-checked:bg-muted"
                    >
                      <span
                        className={cn(
                          "size-3 rounded-full",
                          labelColorClasses[color].dot,
                        )}
                      />
                    </Radio>
                  ))}
                </RadioGroup>
              </div>
            </Popover>
            <Input
              autoFocus
              className="h-8 w-44 text-sm"
              placeholder="Type name, e.g. Spike"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-label="Type name"
            />
            <DropdownSelect
              className="w-36"
              value={draft.level}
              onValueChange={(value) =>
                setDraft({ ...draft, level: Number(value) })
              }
              aria-label="Level"
            >
              {levelLabel.map((l, i) => (
                <DropdownSelectOption key={l} value={i}>
                  {l}
                </DropdownSelectOption>
              ))}
            </DropdownSelect>
            <label
              htmlFor="new-type-specification"
              className="flex items-center gap-1.5 text-xs"
            >
              <Checkbox
                id="new-type-specification"
                checked={draft.hasSpecification}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, hasSpecification: checked === true })
                }
              />
              Specification
            </label>
            <Button size="sm" type="submit" disabled={!draft.name.trim()}>
              Create
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
          </form>
        )}
        {error && (
          <div className="border-t px-5 py-3">
            <InlineError>{error}</InlineError>
          </div>
        )}
      </SettingsSection>
      {!isAdmin && (
        <ReadOnlyNotice>
          Only organization administrators change the type registry.
        </ReadOnlyNotice>
      )}
    </>
  );
}
