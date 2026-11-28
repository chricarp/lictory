import { Component, type ComponentProps, type ReactNode } from "react";
import { Panel } from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";

// Home's cards are `Panel`s and their rows `ListRow`s, like every other list;
// these names stay for the modules that registered cards with them.
export function HomePanel(props: ComponentProps<typeof Panel>) {
  return <Panel {...props} />;
}

// One row of a Home card: what it is, why it is here, and when it changed.
export function HomeRow({
  href,
  icon,
  title,
  reason,
  meta,
  time,
}: {
  href: string;
  icon?: ReactNode;
  title: ReactNode;
  // Why this row is on Home ("Review requested").
  reason?: ReactNode;
  // Where it belongs (an identifier, a space).
  meta?: ReactNode;
  time?: string;
}) {
  return (
    <ListRow
      href={href}
      leading={icon}
      identifier={meta}
      title={title}
      meta={reason}
      time={time}
    />
  );
}

// A module's card failing never takes Home down with it.
export class HomeCardBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <HomePanel
          title={this.props.name}
          empty="This card could not be shown. Reload the page to try again."
        />
      );
    return this.props.children;
  }
}
