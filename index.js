import { ActivityStore } from "./src/activity-store.js";
import { CompactController } from "./src/controller.js";
import { IntentDecorator } from "./src/intent.js";
import { installRegistryBridge } from "./src/registry-bridge.js";
import { nestedResultReceipt, saveDisplayPayload, toolStartReceipt } from "./src/activity-journal.js";
import { addPublicActivityGuideline } from "./src/thinking-intent.js";
import { messages, resolveLanguage } from "./src/locale.js";

export default function mindfold(pi) {
  const language = resolveLanguage();
  const text = messages(language);
  const store = new ActivityStore({ language });
  const controller = new CompactController(store);
  const decorator = new IntentDecorator({ language });
  const disposeRegistry = installRegistryBridge(decorator, (registry) => { controller.definitions = registry ?? new Map(); });

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
    if (!store.current || store.current.settled) store.begin();
    addPublicActivityGuideline(event, language);
  });
  pi.on("message_start", (event) => {
    if (event.message.role === "user" && store.current?.finalResponse) store.begin();
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
  pi.on("session_shutdown", () => { controller.dispose(); disposeRegistry(); });

  pi.registerShortcut("ctrl+alt+t", {
    description: text.shortcut,
    handler: () => controller.toggle(),
  });
  const commandHandler = async (args, ctx) => {
    const action = args.trim() || "toggle";
    if (action === "status") {
      ctx.ui.notify(text.status(store.groups.length, decorator.originals.size, [...decorator.skipped]), "info");
    } else if (["toggle", "expand", "collapse"].includes(action)) {
      controller.toggle(action === "toggle" ? undefined : action === "expand");
    } else if (action === "prev" || action === "next") controller.select(action === "prev" ? -1 : 1);
    else ctx.ui.notify(text.usage, "warning");
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
