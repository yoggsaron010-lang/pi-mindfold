import { ActivityStore } from "./src/activity-store.js";
import { CompactController } from "./src/controller.js";
import { IntentDecorator } from "./src/intent.js";
import { installRegistryBridge } from "./src/registry-bridge.js";
import { nestedResultReceipt, saveDisplayPayload, toolStartReceipt } from "./src/activity-journal.js";
import { addPublicActivityGuideline } from "./src/thinking-intent.js";
import { turnIntentGuideline } from "./src/turn-intent.js";
import { messages, requestLanguage, resolveLanguage, resolveLanguageMode } from "./src/locale.js";

export default function mindfold(pi) {
  const mode = resolveLanguageMode();
  const language = resolveLanguage();
  const text = messages(language);
  const store = new ActivityStore({ language, languageMode: mode });
  const controller = new CompactController(store);
  const decorator = new IntentDecorator({ language });
  const registryBridge = installRegistryBridge(decorator, (registry) => { controller.definitions = registry ?? new Map(); });

  const restore = (_event, ctx) => {
    controller.clear();
    store.restore(ctx.sessionManager.buildContextEntries(), ctx.sessionManager.getSessionDir());
    controller.attach(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_compact", (_event, ctx) => {
    const active = store.current && !store.current.settled;
    restore(_event, ctx);
    if (active && store.current) store.current.settled = false;
  });
  pi.on("before_agent_start", (event) => {
    const next = requestLanguage(event.prompt, mode, store.language);
    const changed = next !== decorator.language;
    const replacements = decorator.setLanguage(next);
    if (changed) {
      registryBridge.refresh();
      // The event holds a snapshot taken before the registry refresh. Update only
      // our guidelines so earlier handlers' other prompt edits remain intact.
      for (const guidelines of Object.values(event.systemPromptOptions?.toolGuidelines ?? {})) {
        for (let i = 0; i < guidelines.length; i++) guidelines[i] = replacements.get(guidelines[i]) ?? guidelines[i];
      }
    }
    store.language = next;
    if (!store.current || store.current.settled) store.begin();
    store.current.language = next;
    if (typeof event.prompt === "string") store.current.prompt ??= event.prompt;
    addPublicActivityGuideline(event, next);
    if (event.systemPromptOptions && !store.current.intentSummary) {
      const guideline = turnIntentGuideline(next);
      if (!event.systemPromptOptions.promptGuidelines.includes(guideline)) event.systemPromptOptions.promptGuidelines.push(guideline);
    }
  });
  pi.on("message_start", (event) => {
    if (event.message.role === "user") {
      if (store.current?.finalResponse) store.begin();
      store.user(event.message);
    }
    if (event.message.role === "assistant") store.assistant(event.message, true, true);
    controller.changed();
  });
  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const type = event.assistantMessageEvent.type;
    if (type === "thinking_start") store.startThinking(event.message);
    else store.assistant(event.message, type === "thinking_delta");
    if (type === "text_start" || type === "text_delta" || type === "text_end") {
      store.text(event.message, { complete: type === "text_end" });
    }
    controller.changed();
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      const group = store.assistant(event.message);
      const finished = ["stop", "aborted", "error", "length"].includes(event.message.stopReason);
      store.text(event.message, { complete: true, finished });
      if (group?.intentSummary && !group.savedIntentSummary) {
        pi.appendEntry("mindfold.turn-intent", { summary: group.intentSummary });
        group.savedIntentSummary = true;
      }
      if (finished && group) group.finalResponse = true;
    }
    controller.changed();
  });
  pi.on("tool_execution_start", (event, ctx) => {
    const call = store.startTool(event);
    pi.appendEntry("mindfold.tool-start", saveDisplayPayload(toolStartReceipt(event), ctx.sessionManager.getSessionDir()));
    controller.startNested(call);
    controller.changed();
  });
  pi.on("tool_execution_update", (event) => {
    controller.updateNested(store.result(event, true));
    controller.changed();
  });
  pi.on("tool_execution_end", (event, ctx) => {
    if (event.parentToolCallId) pi.appendEntry("mindfold.nested", saveDisplayPayload(nestedResultReceipt(event), ctx.sessionManager.getSessionDir()));
    controller.updateNested(store.result(event));
    controller.changed();
  });
  // agent_end is a low-level boundary; recovery/queued continuations can follow.
  pi.on("agent_settled", () => { store.settle(); controller.changed(); });
  pi.on("session_shutdown", () => { controller.dispose(); registryBridge.dispose(); });

  pi.registerShortcut("ctrl+alt+t", {
    description: text.shortcut,
    handler: () => controller.toggle(),
  });
  const commandHandler = async (args, ctx) => {
    const action = args.trim() || "toggle";
    if (action === "status") {
      ctx.ui.notify(messages(store.language).status(store.groups.length, decorator.originals.size, [...decorator.skipped]), "info");
    } else if (["toggle", "expand", "collapse"].includes(action)) {
      controller.toggle(action === "toggle" ? undefined : action === "expand");
    } else if (action === "start") controller.start();
    else if (action === "turns") controller.directory.toggle();
    else if (action === "prev" || action === "next") controller.select(action === "prev" ? -1 : 1);
    else ctx.ui.notify(messages(store.language).usage, "warning");
  };

  pi.registerCommand("mindfold", {
    description: text.command,
    handler: commandHandler,
  });
  pi.registerCommand("compact-thinking", {
    description: text.alias,
    handler: commandHandler,
  });
}
