import {
  capabilitiesOf,
  type Discipline,
} from "@lictory/core/contracts/protocol";

const list = (words: string[], joiner: "and" | "or") =>
  words.length < 2
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${joiner} ${words.at(-1)}`;

// What a person does in a project, said from the disciplines they hold
// there: the same capabilities the server checks, in words. A newly invited
// teammate reads it where an empty list would otherwise say nothing.
export function placeInProject(
  disciplines: Discipline[],
  userId: string,
  projectId: string,
) {
  const active = disciplines.filter(
    (d) => d.projectId === projectId && !d.archivedAt,
  );
  const mine = active
    .filter((d) => d.userIds.includes(userId))
    .map((d) => d.name);
  const can = capabilitiesOf(disciplines, userId, projectId);
  const writers = active
    .filter((d) => d.capabilities.editSpecifications)
    .map((d) => d.name);
  const does = [
    can.editSpecifications && "write proposals and specifications",
    can.review && "review specifications",
    can.requestReviews && "request reviews",
    can.changeProperties && "plan and move work",
  ].filter((part): part is string => Boolean(part));
  return {
    disciplines: mine,
    canPropose: can.editSpecifications,
    // "As Engineering you review specifications and plan and move work."
    sentence: mine.length
      ? `As ${list(mine, "and")} you ${does.length ? list(does, "and") : "read and discuss the work"}.`
      : "",
    // Why there is no "New proposal" for this person, and who writes them.
    whyNoProposal: can.editSpecifications
      ? ""
      : writers.length
        ? `${list(writers, "or")} writes proposals.`
        : "No discipline here edits specifications yet. A project administrator sets that in Settings → Disciplines.",
  };
}
