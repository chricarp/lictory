// PR evidence (screenshots, recordings) belongs on the pull request, not in the
// repository. Reject media committed outside the directories that ship it.
import { execFileSync } from "node:child_process";

const media = /\.(png|jpe?g|gif|webp|mp4|mov|webm)$/i;
const allowed = ["public/", "src/app/", "tests/", ".agents/skills/"];

const offenders = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => media.test(file))
  .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));

if (offenders.length) {
  console.error(
    "Media files outside the directories that ship them. Attach PR evidence to the pull request instead of committing it:\n" +
      offenders.join("\n"),
  );
  process.exit(1);
}
