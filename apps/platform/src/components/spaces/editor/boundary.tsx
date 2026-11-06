import { Component, type ErrorInfo, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@lictory/ui/button";

// Keeps a failure of the page surface (its code failing to load, an editor
// error) inside the page: the header, tree and navigation stay usable and
// the reader can try again.
export class SurfaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("The page content failed to render.", error, info);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3 text-[13px]"
      >
        <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
        <p className="min-w-0 flex-1 basis-56">
          This page’s content could not be shown. Try again, or reload the page.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => this.setState({ failed: false })}
        >
          Try again
        </Button>
      </div>
    );
  }
}
