import { getDisplaySummary, normalizeDisplaySummary } from "../vendor/pi-tool-explain/display-summary.js";
import { loadDisplayPayload } from "./activity-journal.js";
import { assistantPublicText, readPublicActivity } from "./thinking-intent.js";
import { readTurnIntent, userPromptText } from "./turn-intent.js";
import { requestLanguage, resolveLanguage } from "./locale.js";

const messageKeys = new WeakMap();
function fallbackMessageKey(message) {
  const call = message?.content?.find((block) => block.type === "toolCall");
  return message?.timestamp !== undefined ? `assistant:${message.timestamp}` : call ? `call:${call.id}` : undefined;
}
export function messageKey(message) {
  if (message?.role !== "assistant") return undefined;
  return messageKeys.get(message) ?? fallbackMessageKey(message);
}

/** A user request can contain multiple model turns and concurrent tool batches. */
export class ActivityStore {
  groups = [];
  messages = new Map();
  calls = new Map();
  current;
  selected;
  sequence = 0;
  messageSequence = 0;
  activeMessage;
  constructor({ language = resolveLanguage(), languageMode = language } = {}) {
    this.language = language;
    this.languageMode = languageMode;
  }

  reset() {
    this.groups = [];
    this.messages.clear();
    this.calls.clear();
    this.current = this.selected = undefined;
    this.sequence = 0;
    this.messageSequence = 0;
    this.activeMessage = undefined;
  }

  begin() {
    const group = { id: ++this.sequence, language: this.language, expanded: false, settled: false, calls: [], declared: [], activity: undefined, lastTool: undefined };
    this.groups.push(group);
    this.current = this.selected = group;
    return group;
  }

  user(message) {
    if (!this.current || this.current.settled) this.begin();
    this.current.prompt ??= userPromptText(message.content);
  }

  assistant(message, streaming = false, newMessage = false) {
    if (message?.role !== "assistant") return;
    const group = this.current ?? this.begin();
    const base = fallbackMessageKey(message);
    let key = !newMessage && messageKeys.get(message);
    const active = this.activeMessage;
    if (!key && !newMessage && active?.group === group && (active.base === base || !base)) key = active.key;
    if (!key) {
      key = base ?? `message:${group.id}:${++this.messageSequence}`;
      if (this.messages.has(key)) key = `${key}:${group.id}:${++this.messageSequence}`;
    }
    messageKeys.set(message, key);
    const boundGroup = this.messages.get(key) ?? group;
    this.messages.set(key, boundGroup);
    this.activeMessage = { key, base, group: boundGroup };
    return this.updateAssistant(message, streaming, key, boundGroup);
  }

  updateAssistant(message, streaming, key, group) {
    for (const block of message.content ?? []) {
      if (block.type !== "toolCall") continue;
      if (!this.calls.has(block.id)) {
        this.calls.set(block.id, { id: block.id, name: block.name, args: block.arguments, group, batch: key, started: false });
      } else {
        this.calls.get(block.id).args = block.arguments;
      }
      if (!group.declared.includes(block.id)) group.declared.push(block.id);
    }
    if (streaming && (group.activity?.kind !== "thinking" || group.activity.key !== key)) {
      group.activity = { kind: "thinking", key };
      group.thinkingTextOffset = 0;
      group.thinkingStatusRange = undefined;
    }
    this.finishPending(message);
    return group;
  }

  startThinking(message) {
    const group = this.assistant(message);
    if (!group) return;
    group.activity = { kind: "thinking", key: messageKey(message) };
    group.thinkingTextOffset = assistantPublicText(message).length;
    group.thinkingStatusRange = undefined;
  }

  text(message, { complete = false, finished = false } = {}) {
    const key = messageKey(message);
    const group = this.messages.get(key);
    if (!group) return;
    const label = readTurnIntent(message, { complete });
    if (label.summary && !group.intentSummary) group.intentSummary = label.summary;
    if (group.activity?.kind !== "thinking" || group.activity.key !== key) return;
    if (label.pending) { group.thinkingStatusRange = label.range; return; }
    const offset = Math.max(group.thinkingTextOffset ?? 0, label.range?.end ?? 0);
    const status = readPublicActivity(message, { offset, complete, language: group.language });
    if (!finished && (status.kind === "empty" || status.kind === "pending" || status.kind === "status")) {
      group.thinkingStatusRange = status.range;
      if (status.kind === "status") group.activity.intent = status.intent;
      return;
    }
    group.activity = group.lastVisibleTool ? { kind: "tool", id: group.lastVisibleTool } : undefined;
    group.thinkingStatusRange = undefined;
  }

  startTool(event) {
    const previous = this.calls.get(event.toolCallId);
    const parent = event.parentToolCallId && this.calls.get(event.parentToolCallId);
    const group = previous?.group ?? parent?.group ?? this.current ?? this.begin();
    const call = previous ?? { id: event.toolCallId, group };
    Object.assign(call, { name: event.toolName ?? previous?.name, args: event.args ?? previous?.args, parent: event.parentToolCallId ?? previous?.parent, started: true });
    call.batch ??= parent?.batch ?? call.id;
    this.calls.set(call.id, call);
    if (!group.calls.includes(call.id)) {
      group.calls.push(call.id);
      group.lastTool = call.id;
      group.lastVisibleTool = call.id;
      group.activity = { kind: "tool", id: call.id };
    }
    return call;
  }

  result(event, partial = false) {
    const call = this.calls.get(event.toolCallId);
    if (call) {
      call.result = partial ? event.partialResult : event.result;
      call.partial = partial;
      call.isError = !partial && event.isError === true;
    }
    // Completion order must never change the most recently started activity.
    return call;
  }

  /** Include streamed/queued calls in expanded history without pretending they ran. */
  batchCalls(call) {
    const group = call.group;
    const ordered = group.calls.map((id) => this.calls.get(id)).filter((entry) => entry?.batch === call.batch);
    const pending = group.declared.map((id) => this.calls.get(id)).filter((entry) => entry?.batch === call.batch && !entry.started);
    return [...ordered, ...pending];
  }

  finishPending(message) {
    const group = this.messages.get(messageKey(message));
    if (!group) return;
    const failed = ["aborted", "error", "length"].includes(message.stopReason);
    if (!failed) return;
    const error = message.errorMessage || (message.stopReason === "aborted" ? "Operation aborted" : message.stopReason === "length" ? "Response was truncated before completion." : "Unknown error");
    for (const id of group.declared) {
      const call = this.calls.get(id);
      if (!call || call.started || call.batch !== messageKey(message)) continue;
      call.failedBeforeStart = true;
      call.result = { content: [{ type: "text", text: error }] };
      call.isError = true;
      group.activity = { kind: "tool", id };
      group.lastVisibleTool = id;
    }
  }

  settle() {
    if (!this.current) return;
    this.current.settled = true;
    this.current.thinkingStatusRange = undefined;
    const last = this.current.lastVisibleTool;
    this.current.activity = last ? { kind: "tool", id: last } : undefined;
  }

  rootCall(id) {
    let call = this.calls.get(id);
    const visited = new Set();
    while (call?.parent && !visited.has(call.id)) {
      visited.add(call.id);
      const parent = this.calls.get(call.parent);
      if (!parent) break;
      call = parent;
    }
    return call;
  }

  summary(id) {
    return getDisplaySummary(this.calls.get(id)?.args);
  }

  restore(entries, sessionDirectory) {
    this.reset();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === "mindfold.turn-intent") {
        const group = this.current;
        const summary = normalizeDisplaySummary(entry.data?.summary);
        if (group && summary) {
          group.intentSummary = summary;
          group.savedIntentSummary = true;
        }
        continue;
      }
      if (entry.type === "custom" && (entry.customType === "mindfold.tool-start" || entry.customType === "compact-thinking.tool-start")) {
        this.startTool(loadDisplayPayload(entry.data, sessionDirectory, this.language));
        continue;
      }
      if (entry.type === "custom" && (entry.customType === "mindfold.nested" || entry.customType === "compact-thinking.nested")) {
        const data = loadDisplayPayload(entry.data, sessionDirectory, this.language);
        if (data?.phase === "start") {
          // Legacy sessions did not save top-level starts. Infer only the parent;
          // completion order cannot reconstruct a missing parallel start order.
          const parent = this.calls.get(data.parentToolCallId);
          if (parent && !parent.started) this.startTool({ toolCallId: parent.id });
          this.startTool(data);
        } else if (data?.phase === "end") this.result(data);
        continue;
      }
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message.role === "user") {
        if (!this.current || this.current.settled) {
          const prompt = userPromptText(message.content);
          this.language = requestLanguage(prompt, this.languageMode, this.language);
          this.begin();
        }
        this.user(message);
      } else if (message.role === "assistant") {
        const group = this.assistant(message, false, true);
        this.text(message, { complete: true });
        this.finishPending(message);
        if (group && ["stop", "aborted", "error", "length"].includes(message.stopReason)) this.settle();
      } else if (message.role === "toolResult") {
        const call = this.calls.get(message.toolCallId);
        if (call && !call.started) this.startTool({ toolCallId: call.id });
        this.result({ toolCallId: message.toolCallId, result: { content: message.content, details: message.details }, isError: message.isError });
      }
    }
    this.settle();
  }
}
