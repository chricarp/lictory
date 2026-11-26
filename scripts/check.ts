// `bun run check`: every static check, in the order that keeps it short.
// The toolchain check stops early on a mismatched machine. Types come next:
// the documentation's typecheck also generates the route and content types
// lint reads. Then lint (typed linting, CPU-bound and the longest step) runs
// beside the remaining checks (formatting, unused code, PR assets and the
// generated references), which need little memory. Nothing is skipped:
// both halves run to the end, and the summary names each step's result and
// time. CI runs the same steps as separate jobs (.github/workflows/ci.yml).
import { spawn } from "node:child_process";

type Result = { name: string; code: number; seconds: number; output: string };

function run(name: string, command: string[], live = false) {
  return new Promise<Result>((resolve) => {
    const start = Date.now();
    const child = spawn(command[0]!, command.slice(1), {
      stdio: live ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const done = (code: number) =>
      resolve({ name, code, seconds: (Date.now() - start) / 1000, output });
    child.on("error", (error) => {
      output += `${error.message}\n`;
      done(1);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

const results: Result[] = [];
const summary = () => {
  console.log("\n━━ bun run check");
  for (const r of results)
    console.log(
      `  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(10)} ${r.seconds.toFixed(0).padStart(4)} s`,
    );
};

for (const [name, command] of [
  ["toolchain", ["bun", "scripts/check-toolchain.ts"]],
  ["types", ["bun", "run", "typecheck"]],
] as const) {
  const result = await run(name, [...command], true);
  results.push(result);
  if (result.code !== 0) {
    summary();
    process.exit(result.code);
  }
}

console.log("Lint and the remaining checks run side by side…");
const side = await Promise.all([
  run("lint", ["bun", "run", "lint"]),
  run("rest", ["bun", "run", "check:rest"]),
]);
for (const result of side) {
  console.log(`\n── ${result.name} (${result.seconds.toFixed(0)} s)`);
  process.stdout.write(result.output);
  results.push(result);
}
summary();
process.exit(side.find((r) => r.code !== 0)?.code ?? 0);
