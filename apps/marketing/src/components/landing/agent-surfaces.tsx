import { Check, GitPullRequest, MousePointer2 } from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";

/*
 * One workspace action reached three ways. The three surfaces converge on the
 * same capability, the same permission check and the same history entry,
 * which is how the platform is built (see docs/internals/capabilities.md).
 * Illustrative only: identifiers are elided rather than invented.
 */
export function AgentSurfaces() {
  return (
    <figure
      className="agent-surfaces"
      aria-label="Opening a pull request from the app, from Litto and from an agent over MCP runs the same capability"
    >
      <div className="as-panes">
        <section className="as-pane" aria-label="In the app">
          <p className="as-pane-label">
            <MousePointer2 aria-hidden /> In the app
          </p>
          <div className="as-card">
            <p className="as-field-label">Title</p>
            <p className="as-field">Retry policy</p>
            <p className="as-refs">
              <code>retry-policy</code> → <code>main</code>
            </p>
            <span className="as-button">
              <GitPullRequest aria-hidden /> Open pull request
            </span>
          </div>
        </section>

        <section className="as-pane" aria-label="Ask Litto">
          <p className="as-pane-label">
            <IntelligenceMark /> Ask Litto
          </p>
          <div className="as-card as-chat">
            <p className="as-bubble">
              Open a pull request for retry-policy and ask QA to review it
            </p>
            <p className="as-activity">
              <Check aria-hidden /> Opened pull request
            </p>
            <p className="as-activity">
              <Check aria-hidden /> Requested QA review
            </p>
          </div>
        </section>

        <section className="as-pane" aria-label="Your agent over MCP">
          <p className="as-pane-label">
            <span className="as-prompt" aria-hidden>
              &gt;_
            </span>{" "}
            Your agent, over MCP
          </p>
          <pre className="as-card as-code">
            <code>
              <span className="as-dim">→ tools/call</span> createPullRequest
              {"\n"}
              {"  "}
              <span className="as-dim">title</span> {`"Retry policy"`}
              {"\n"}
              {"  "}
              <span className="as-dim">sourceId</span> …{"\n"}
              {"  "}
              <span className="as-dim">targetId</span> …{"\n"}
              <span className="as-ok">← opened</span>
            </code>
          </pre>
        </section>
      </div>

      <svg
        className="as-join"
        viewBox="0 0 300 48"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M50 0 C50 28 150 20 150 48"
          vectorEffect="non-scaling-stroke"
        />
        <path d="M150 0 V48" vectorEffect="non-scaling-stroke" />
        <path
          d="M250 0 C250 28 150 20 150 48"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <figcaption className="as-capability">
        <span>
          <small>Capability</small>
          <code>createPullRequest</code>
        </span>
        <span>
          <small>Permission check</small>
          Same rules as the person
        </span>
        <span>
          <small>History</small>
          Who acted, and from where
        </span>
      </figcaption>
    </figure>
  );
}
