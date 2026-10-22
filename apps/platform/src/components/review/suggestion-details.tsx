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
      <div>
        <h3 className="text-sm font-semibold">Proposal details</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Give reviewers a quick summary and the context behind the change.
        </p>
      </div>
      <label
        className="block space-y-1.5 text-xs font-medium"
        htmlFor="suggestion-title"
      >
        Title
        <input
          id="suggestion-title"
          autoFocus
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          maxLength={120}
          placeholder="e.g. Define timeout and retry behavior"
          className="h-10 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
      </label>
      <label
        className="block space-y-1.5 text-xs font-medium"
        htmlFor="suggestion-description"
      >
        Description
        <textarea
          id="suggestion-description"
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          maxLength={10_000}
          rows={5}
          placeholder="Why is this change needed? What should reviewers pay attention to?"
          className="min-h-32 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm leading-relaxed font-normal outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20"
        />
        <span className="block text-xs font-normal text-muted-foreground">
          Explain why this change is needed. Both fields are required.
        </span>
      </label>
    </div>
  );
}
