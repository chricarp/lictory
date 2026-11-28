import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";

export function SuggestionDetailsFields({
  title,
  description,
  onTitleChange,
  onDescriptionChange,
}: {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">Proposal details</h3>
      <label
        className="block space-y-1.5 text-xs font-medium"
        htmlFor="suggestion-title"
      >
        Title
        <Input
          id="suggestion-title"
          autoFocus
          value={title}
          onValueChange={(value) => onTitleChange(value)}
          maxLength={120}
          placeholder="e.g. Define timeout and retry behavior"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-normal outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 touch:text-base"
        />
      </label>
      <label
        className="block space-y-1.5 text-xs font-medium"
        htmlFor="suggestion-description"
      >
        Description
        <Textarea
          id="suggestion-description"
          value={description}
          onValueChange={(value) => onDescriptionChange(value)}
          maxLength={10_000}
          rows={5}
          placeholder="Why is this change needed? What should reviewers pay attention to?"
          className="min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed font-normal outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 touch:text-base"
        />
        <span className="block text-xs font-normal text-muted-foreground">
          Both fields are required.
        </span>
      </label>
    </div>
  );
}
