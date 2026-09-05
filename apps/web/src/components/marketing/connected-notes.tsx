"use client";

import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  GRAPH_CENTER,
  GRAPH_EDGES,
  GRAPH_NODES,
  type GraphNode,
} from "./content";
import {
  Container,
  EASE,
  Eyebrow,
  Heading,
  InViewGroup,
  KIND_ICON,
  Lede,
  Reveal,
} from "./primitives";

const ALL_EDGES: Array<[string, string]> = [
  ...GRAPH_NODES.map((n) => [GRAPH_CENTER.id, n.id] as [string, string]),
  ...GRAPH_EDGES,
];

const NODE_BY_ID = new Map<string, GraphNode>(
  [GRAPH_CENTER, ...GRAPH_NODES].map((n) => [n.id, n]),
);

function neighbours(id: string) {
  const set = new Set<string>([id]);
  for (const [a, b] of ALL_EDGES) {
    if (a === id) set.add(b);
    if (b === id) set.add(a);
  }
  return set;
}

function NodeCard({
  node,
  center = false,
  dimmed,
  onFocus,
  onBlur,
  className,
  style,
}: {
  node: GraphNode;
  center?: boolean;
  dimmed: boolean;
  onFocus: () => void;
  onBlur: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Icon = KIND_ICON[node.kind];
  return (
    <button
      type="button"
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={`${node.label}, ${node.detail}`}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-canvas text-left transition-[opacity,transform,border-color,box-shadow] duration-300 will-change-transform hover:-translate-y-0.5",
        center
          ? "border-[rgb(var(--ember)/0.45)] px-4 py-3.5 shadow-[0_1px_2px_rgb(15_20_25/0.05),0_16px_48px_-16px_rgb(0_82_204/0.35)]"
          : "border-hairline px-3 py-2.5 shadow-[0_1px_2px_rgb(15_20_25/0.04),0_12px_32px_-16px_rgb(15_20_25/0.12)] hover:border-hairline-strong",
        dimmed && "opacity-35",
        className,
      )}
      style={style}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md",
          center
            ? "size-9 bg-ember text-white"
            : "size-8 border border-hairline bg-canvas-raised text-ember",
        )}
      >
        <Icon className={center ? "size-4.5" : "size-4"} aria-hidden />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-medium leading-tight",
            center ? "text-[0.9375rem]" : "text-sm",
          )}
        >
          {node.label}
        </span>
        <span className="block text-[0.75rem] text-subtle">{node.detail}</span>
      </span>
    </button>
  );
}

export function ConnectedNotes() {
  const reduce = useReducedMotion();
  const [focus, setFocus] = React.useState<string | null>(null);
  const lit = focus ? neighbours(focus) : null;
  const isDimmed = (id: string) => (lit ? !lit.has(id) : false);

  return (
    <section className="border-t border-hairline py-28 sm:py-36">
      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
          <Reveal className="min-w-0 lg:col-span-4">
            <Eyebrow>It gets smarter as it fills</Eyebrow>
            <Heading className="mt-4">
              Your information doesn&apos;t live in folders. It lives in
              context.
            </Heading>
            <Lede className="mt-6 text-base leading-7 sm:text-lg sm:leading-8">
              Every person, place, date and topic Lictory recognises becomes a
              thread. Notes that share a thread find each other — so one health
              check quietly gathers the blood tests, the appointment, the
              prescription and the pharmacy run around it.
            </Lede>
            <p className="mt-6 text-sm text-subtle">
              Hover or focus a note to see what it&apos;s connected to.
            </p>
          </Reveal>

          <Reveal className="min-w-0 lg:col-span-8" delay={0.1}>
            {/* Wide: spatial constellation */}
            <InViewGroup className="relative hidden aspect-[16/10] w-full md:block">
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 size-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {ALL_EDGES.map(([a, b], i) => {
                  const na = NODE_BY_ID.get(a);
                  const nb = NODE_BY_ID.get(b);
                  if (!na || !nb) return null;
                  const on = lit ? lit.has(a) && lit.has(b) : true;
                  const strong = focus && on;
                  return (
                    <line
                      key={`${a}-${b}`}
                      x1={na.x}
                      y1={na.y}
                      x2={nb.x}
                      y2={nb.y}
                      pathLength={1}
                      className="draw-line"
                      stroke={
                        strong
                          ? "rgb(var(--ember) / 0.8)"
                          : on
                            ? "rgb(var(--ember) / 0.32)"
                            : "rgb(var(--hairline) / 0.12)"
                      }
                      strokeWidth={strong ? 1.75 : 1.25}
                      vectorEffect="non-scaling-stroke"
                      style={{
                        transitionDelay: `${i * 90}ms`,
                        transitionProperty: "stroke-dashoffset, stroke",
                      }}
                    />
                  );
                })}
              </svg>

              {[GRAPH_CENTER, ...GRAPH_NODES].map((n, i) => (
                <motion.div
                  key={n.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${n.x}%`, top: `${n.y}%` }}
                  initial={reduce ? false : { opacity: 0, scale: 0.94 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: "-15% 0px" }}
                  transition={{
                    duration: 0.6,
                    delay: 0.1 + i * 0.08,
                    ease: EASE,
                  }}
                >
                  <NodeCard
                    node={n}
                    center={n.id === GRAPH_CENTER.id}
                    dimmed={isDimmed(n.id)}
                    onFocus={() => setFocus(n.id)}
                    onBlur={() => setFocus(null)}
                    className="max-w-[16rem]"
                  />
                </motion.div>
              ))}
            </InViewGroup>

            {/* Narrow: a spine with the same relationships */}
            <div className="md:hidden">
              <NodeCard
                node={GRAPH_CENTER}
                center
                dimmed={false}
                onFocus={() => setFocus(GRAPH_CENTER.id)}
                onBlur={() => setFocus(null)}
                className="w-full"
              />
              <ul className="relative mt-3 space-y-3 pl-6">
                <span
                  aria-hidden
                  className="absolute bottom-6 left-[0.6875rem] top-0 w-px bg-[rgb(var(--ember)/0.35)]"
                />
                {GRAPH_NODES.map((n) => (
                  <li key={n.id} className="relative">
                    <span
                      aria-hidden
                      className="absolute -left-[1.0625rem] top-1/2 h-px w-4 bg-[rgb(var(--ember)/0.35)]"
                    />
                    <NodeCard
                      node={n}
                      dimmed={isDimmed(n.id)}
                      onFocus={() => setFocus(n.id)}
                      onBlur={() => setFocus(null)}
                      className="w-full"
                    />
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
