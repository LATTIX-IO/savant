/**
 * What a live evaluation can't exercise. The live run is a chat-only
 * execution: the model gets the skill's instructions (and small reference
 * files) but can't run its scripts, call tools or MCP servers, or reach the
 * network. Skills that depend on those score lower for reasons that aren't
 * about instruction quality, so the UI shows these alongside the score.
 */

const EXECUTABLE = /\.(py|sh|bash|js|mjs|cjs|ts|ps1|rb|go|rs)$/i;
const TOOLING = /\b(mcp|model context protocol|tool call|function call|playwright|puppeteer|browser automation|web search|fetch the url|curl |npx |pip install|npm install|uv run|python3? [\w/.-]+\.py|bash [\w/.-]+\.sh|api key|oauth|access token)\b/i;
const MEDIA = /\b(image|screenshot|pdf|docx|pptx|xlsx|video|audio|canvas|svg|figma)\b/i;

export type EvalLimitation = { code: "SCRIPTS" | "TOOLS" | "MEDIA" | "REFERENCES_TRUNCATED"; message: string };

export function executionLimitations(input: { skillMd: string; files: ReadonlyArray<{ path: string; size?: number }>; referencesIncluded?: number; referencesOmitted?: number }): EvalLimitation[] {
  const limitations: EvalLimitation[] = [];
  const scripts = input.files.filter((file) => EXECUTABLE.test(file.path));
  if (scripts.length > 0) {
    limitations.push({ code: "SCRIPTS", message: `Ships ${scripts.length} script${scripts.length === 1 ? "" : "s"} the live run can't execute; outputs describe those steps rather than perform them.` });
  }
  if (TOOLING.test(input.skillMd)) {
    limitations.push({ code: "TOOLS", message: "Expects tools, MCP servers, installs or network access that a chat-only run doesn't have." });
  }
  if (MEDIA.test(input.skillMd)) {
    limitations.push({ code: "MEDIA", message: "Works with files or media (documents, images, designs) that the run can only describe in text." });
  }
  if ((input.referencesOmitted ?? 0) > 0) {
    limitations.push({ code: "REFERENCES_TRUNCATED", message: `${input.referencesOmitted} reference file${input.referencesOmitted === 1 ? " was" : "s were"} too large to include in the run's context.` });
  }
  return limitations;
}

/** SKILL.md plus small reference documents, as the skill's context for a live run. */
export function liveRunInstructions(skillMd: string, files: ReadonlyArray<{ path: string; content: string }>, budget = 16_000): { instructions: string; included: number; omitted: number } {
  const references = files.filter((file) => file.path !== "SKILL.md" && /\.(md|markdown|txt|ya?ml|json|csv)$/i.test(file.path) && !/^LICENSE/i.test(file.path.split("/").at(-1) ?? ""));
  let remaining = budget;
  const parts = [skillMd];
  let included = 0;
  for (const file of references.sort((left, right) => left.content.length - right.content.length)) {
    if (file.content.length > remaining) continue;
    parts.push(`\n\n<reference path="${file.path}">\n${file.content}\n</reference>`);
    remaining -= file.content.length;
    included += 1;
  }
  return { instructions: parts.join(""), included, omitted: references.length - included };
}
