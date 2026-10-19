import { messageKey } from "./activity-store.js";
import { normalizeDisplaySummary } from "../vendor/pi-tool-explain/display-summary.js";
import { readTurnIntent, userPromptText } from "./turn-intent.js";

/** Backfill directory metadata without rebuilding live groups, tools or views. */
export function hydrateTurnTitles(store, entries) {
  let pendingPrompt, pendingSummary, previous;
  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "mindfold.turn-intent") {
      const summary = normalizeDisplaySummary(entry.data?.summary);
      if (pendingPrompt !== undefined) pendingSummary = summary;
      else if (previous && !previous.intentSummary && summary) previous.intentSummary = summary;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message?.role === "user") {
      pendingPrompt ??= userPromptText(message.content);
      continue;
    }
    if (message?.role !== "assistant") continue;
    const group = store.messages.get(messageKey(message));
    if (!group) continue;
    // Match assistant identities, not list indices: branch changes and retained
    // compaction ranges can start in the middle of a request.
    if (!group.prompt && pendingPrompt) group.prompt = pendingPrompt;
    const summary = pendingSummary ?? readTurnIntent(message, { complete: true }).summary;
    if (!group.intentSummary && summary) group.intentSummary = summary;
    pendingPrompt = pendingSummary = undefined;
    previous = group;
  }
  if (pendingPrompt && store.current && !store.current.settled && !store.current.prompt) store.current.prompt = pendingPrompt;
}
