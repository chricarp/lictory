import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { illustrationScenes } from "@lictory/ui/illustrations/catalog";
import {
  compose,
  isKeys,
  paintClass,
  paints,
  sample,
  type Composition,
  type Node,
  type Paint,
  type Track,
} from "@lictory/ui/illustrations/lottie";

const scenes = await Promise.all(
  Object.entries(illustrationScenes).map(
    async ([kind, load]) => [kind, (await load()).scene] as const,
  ),
);

type Animated = { label: string; track: Track<never>; turns?: boolean };

/** Every animated property in a scene, with a label naming where it is. */
function animated(nodes: Node[], path = ""): Animated[] {
  return nodes.flatMap((node, index): Animated[] => {
    const at = `${path}/${node.name ?? node.type}[${index}]`;
    const tracks: [string, unknown, boolean?][] = [];
    if (node.type === "group") {
      const t = node.transform ?? {};
      tracks.push(
        ["offset", t.offset],
        ["scale", t.scale],
        ["rotation", t.rotation, true],
        ["opacity", t.opacity],
      );
    } else {
      tracks.push(
        ["fillOpacity", node.fillOpacity],
        ["strokeOpacity", node.stroke?.opacity],
        ["dashOffset", node.stroke?.dashOffset],
        ["trimStart", node.trim?.start],
        ["trimEnd", node.trim?.end],
        ...node.geometry.map(
          (g, k) =>
            [`geometry${k}`, g.type === "path" ? g.path : g.size] as [
              string,
              unknown,
            ],
        ),
      );
    }
    const own = tracks
      .filter(
        ([, track]) => track !== undefined && isKeys(track as Track<unknown>),
      )
      .map(([name, track, turns]) => ({
        label: `${at}.${name}`,
        track: track as Track<never>,
        turns,
      }));
    return node.type === "group"
      ? [...own, ...animated(node.children, at)]
      : own;
  });
}

function pose(scene: Composition, frame: number) {
  return animated(scene.children).map(({ label, track, turns }) => ({
    label,
    value: sample(track, frame).map(
      (v) => Math.round((turns ? ((v % 360) + 360) % 360 : v) * 100) / 100 + 0,
    ),
  }));
}

void test("every illustration kind loads a scene with intro and reaction markers", () => {
  assert.deepEqual(
    scenes.map(([kind]) => kind),
    Object.keys(illustrationScenes),
  );
  for (const [kind, scene] of scenes) {
    const animation = compose(scene);
    assert.equal(animation.op, scene.intro + scene.react, kind);
    assert.deepEqual(
      animation.markers.map((m) => [m.cm, m.tm, m.dr]),
      [
        ["intro", 0, scene.intro],
        ["react", scene.intro, scene.react],
      ],
      kind,
    );
    assert.ok(animated(scene.children).length > 0, `${kind} moves`);
  }
});

void test("the intro ends and the reaction starts and ends on the same resting pose", () => {
  // The player stops a segment on its last whole frame. Hovering again later
  // restarts the reaction from the resting frame, so any difference would show
  // as a jump.
  for (const [kind, scene] of scenes) {
    const rest = pose(scene, scene.intro);
    for (const frame of [
      scene.intro - 1,
      scene.intro + scene.react - 1,
      scene.intro + scene.react,
    ])
      assert.deepEqual(pose(scene, frame), rest, `${kind} at frame ${frame}`);
  }
});

void test("the reaction visibly moves something", () => {
  for (const [kind, scene] of scenes) {
    const rest = JSON.stringify(pose(scene, scene.intro));
    const moving = Array.from(
      { length: scene.react },
      (_, k) => scene.intro + k,
    ).some((frame) => JSON.stringify(pose(scene, frame)) !== rest);
    assert.ok(moving, kind);
  }
});

void test("every paint role takes its color from the theme stylesheet", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  for (const paint of Object.keys(paints) as Paint[]) {
    const property = paints[paint].kind;
    const rule = new RegExp(
      `\\.state-illustration \\.${paintClass(paint)} \\{\\s*${property}: var\\(|\\.state-illustration \\.${paintClass(paint)} \\{\\s*${property}: color-mix\\(`,
    );
    assert.match(css, rule, paint);
  }
  // Every class the animations carry is one of those roles.
  const used = new Set(
    scenes.flatMap(([, scene]) =>
      [...JSON.stringify(compose(scene)).matchAll(/"cl":"([^"]+)"/g)].map(
        (m) => m[1]!,
      ),
    ),
  );
  assert.deepEqual(
    [...used].filter(
      (c) => !(Object.keys(paints) as Paint[]).some((p) => paintClass(p) === c),
    ),
    [],
  );
});
