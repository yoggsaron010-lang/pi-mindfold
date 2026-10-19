import { normalizeDisplaySummary } from "../vendor/pi-tool-explain/display-summary.js";
import { messages, resolveLanguage } from "./locale.js";

const ACTIVITY_MARKERS = {
  "zh-CN": { labels: ["活动意图：", "活动意图:"], pattern: /^\s*活动意图[：:][ \t]*([^\r\n]*)(?:\r?\n|$)/u },
  en: { labels: ["activity intent:"], pattern: /^\s*activity intent:[ \t]*([^\r\n]*)(?:\r?\n|$)/iu },
};
function activityMarker(language) { return ACTIVITY_MARKERS[language] ?? ACTIVITY_MARKERS["zh-CN"]; }

export function publicActivityGuideline(language = resolveLanguage()) { return messages(language).activityGuideline; }

/** Simplified Chinese guideline, kept for callers of the 0.2.x export. */
export const PUBLIC_ACTIVITY_GUIDELINE = messages("zh-CN").activityGuideline;

export function assistantPublicText(message) {
  return (message?.content ?? []).filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n");
}

/** Only explicit public text can supply an activity intent. Never read thinking. */
export function readPublicActivity(message, { offset = 0, complete = false, language = resolveLanguage() } = {}) {
  const source = assistantPublicText(message);
  const text = source.slice(offset);
  if (!text.trim()) return { kind: "empty" };
  const trimmed = text.trimStart().toLowerCase();
  const marker = activityMarker(language);
  if (!complete && marker.labels.some((label) => label.startsWith(trimmed))) {
    return { kind: "pending", range: { start: offset, end: source.length } };
  }
  const match = marker.pattern.exec(text);
  if (!match) return { kind: "body" };
  // Wait for a line terminator or text_end before publishing an unfinished phrase.
  if (!complete && !match[0].endsWith("\n")) {
    return { kind: "pending", range: { start: offset, end: source.length } };
  }
  if (text.slice(match[0].length).trim()) return { kind: "body" };
  const range = { start: offset, end: offset + match[0].length };
  const intent = normalizeDisplaySummary(match[1]);
  if (!intent) return { kind: "pending", range };
  return { kind: "status", intent, range };
}

/** Remove only the active public status line from the compact projection.
 * The original message and expanded transcript retain it verbatim. */
export function compactAssistantContent(message, range, extraRange) {
  let position = 0;
  let textBlocks = 0;
  return (message.content ?? []).filter((block) => block.type !== "thinking").map((block) => {
    if (block.type !== "text" || typeof block.text !== "string") return block;
    if (textBlocks++ > 0) position++; // assistantPublicText joins text blocks with a newline.
    const start = position;
    const end = start + block.text.length;
    position = end;
    const ranges = [range, extraRange].filter((entry) => entry && entry.end > start && entry.start < end)
      .map((entry) => ({ start: Math.max(0, entry.start - start), end: Math.min(block.text.length, entry.end - start) }))
      .sort((a, b) => a.start - b.start);
    if (!ranges.length) return block;
    let result = "", cursor = 0;
    for (const entry of ranges) {
      result += block.text.slice(cursor, Math.max(cursor, entry.start));
      cursor = Math.max(cursor, entry.end);
    }
    return { ...block, text: result + block.text.slice(cursor) };
  });
}

export function addPublicActivityGuideline(event, language = resolveLanguage()) {
  const options = event?.systemPromptOptions;
  if (!options) return;
  const guidelines = options.promptGuidelines ??= [];
  const guideline = publicActivityGuideline(language);
  if (!guidelines.includes(guideline)) guidelines.push(guideline);
}
