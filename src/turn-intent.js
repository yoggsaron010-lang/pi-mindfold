import { normalizeDisplaySummary } from "../vendor/pi-tool-explain/display-summary.js";

export function userPromptText(content) {
  return typeof content === "string" ? content : (content ?? []).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
}

export function turnIntentGuideline(language) {
  const marker = language === "en" ? "Turn intent: short user goal" : "用户目的：一句话概括用户目标";
  const locale = language === "en" ? "English" : "Simplified Chinese";
  return `Once per user request, start your first public assistant text with a separate plain-text line "${marker}" followed by a blank line. Summarize only the user's explicit goal in one short sentence in ${locale}, at most 96 characters; omit secrets and sensitive identifiers. This is a public navigation label, never hidden reasoning. Then continue the normal progress update or full answer. Place this navigation label before any activity line requested elsewhere. Do not repeat the label after tool calls. Never replace the answer with this label.`;
}

/** Read only an explicit leading public label, including partial streaming prefixes. */
export function readTurnIntent(message, { complete = false } = {}) {
  const text = userPromptText(message?.content);
  const trimmed = text.trimStart().toLowerCase();
  if (!trimmed) return {};
  const labels = ["turn intent:", "用户目的：", "用户目的:"];
  if (!complete && labels.some((label) => label.startsWith(trimmed))) return { pending: true, range: { start: 0, end: text.length } };
  const match = /^\s*(?:Turn intent:|用户目的[：:])[ \t]*([^\r\n]*)(?:\r?\n|$)/iu.exec(text);
  if (!match) return {};
  const range = { start: 0, end: match[0].length };
  if (!complete && !match[0].endsWith("\n")) return { pending: true, range };
  return { summary: normalizeDisplaySummary(match[1]), range };
}

export function expandedTurnContent(message) {
  const { range } = readTurnIntent(message, { complete: true });
  if (!range) return message.content;
  let position = 0, blocks = 0;
  return message.content.flatMap((block) => {
    if (block.type !== "text") return [block];
    if (blocks++ > 0) position++;
    const end = position + block.text.length;
    const split = Math.max(0, Math.min(block.text.length, range.end - position));
    position = end;
    return split > 0 && split < block.text.length
      ? [{ ...block, text: block.text.slice(0, split) }, { ...block, text: block.text.slice(split) }]
      : [block];
  });
}

export function turnLabel(group) {
  return normalizeDisplaySummary(group.intentSummary) ?? normalizeDisplaySummary(group.prompt) ?? (group.language === "en" ? "Untitled request" : "未命名请求");
}
