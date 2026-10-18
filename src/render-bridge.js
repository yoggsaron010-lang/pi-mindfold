import { AssistantMessageComponent, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { messageKey } from "./activity-store.js";
import { intentFor } from "./intent.js";
import { compactAssistantContent } from "./thinking-intent.js";

const OWNER = Symbol.for("pi-mindfold.render.v1");

class IntentCall {
  constructor(native, getSummary, theme) { this.native = native; this.getSummary = getSummary; this.theme = theme; }
  render(width) {
    if (width <= 0) return [];
    return [...this.native.render(width), truncateToWidth(this.theme.fg("muted", `  ↳ ${this.getSummary()}`), width, "…")];
  }
  invalidate() { this.native.invalidate(); }
  handleMouse(event) { return this.native.handleMouse?.(event); }
}

/** Retain the original messages/results; adapt only the visible projection. */
export function installRenderBridge(controller) {
  const assistant = AssistantMessageComponent.prototype;
  assistant[OWNER]?.dispose();
  const tool = ToolExecutionComponent.prototype;
  const patches = [];
  const views = new WeakMap();
  const prepared = new WeakSet();
  const mouseLocked = new WeakSet();
  const nativeUpdate = assistant.updateContent;
  const nativeAssistantRender = assistant.render;
  const nativeSetExpanded = tool.setExpanded;
  const nativeToolRender = tool.render;
  let enabled = true;
  function patch(target, key, make) {
    const original = target[key];
    if (typeof original !== "function") throw new Error(`Unsupported Pi component: ${key}`);
    const replacement = make(original);
    target[key] = replacement;
    patches.push(() => { if (target[key] === replacement) target[key] = original; });
  }
  function groupFor(component) { return controller.store.messages.get(messageKey(component.lastMessage)); }

  patch(assistant, "updateContent", (original) => function (message, streaming = this.isStreaming) {
    if (!enabled || !controller.store.messages.has(messageKey(message))) return original.call(this, message, streaming);
    // The outer component is only a host. Do not construct invisible Markdown on
    // every thinking delta; the native view below is built only when it changes.
    this.lastMessage = message;
    this.isStreaming = streaming;
    this.hasToolCalls = message.content.some((block) => block.type === "toolCall");
    controller.assistants.add(this);
  });
  patch(assistant, "invalidate", (original) => function () {
    views.delete(this);
    return original.call(this);
  });
  patch(assistant, "render", (original) => function (width) {
    if (width <= 0) return [];
    if (!enabled) return original.call(this, width);
    const group = groupFor(this);
    if (!group || !this.lastMessage) return original.call(this, width);
    controller.assistants.add(this);
    const key = messageKey(this.lastMessage);
    const thinking = !group.expanded && group.activity?.kind === "thinking" && group.activity.key === key;
    const content = group.expanded ? this.lastMessage.content : compactAssistantContent(this.lastMessage, thinking ? group.thinkingStatusRange : undefined);
    // Tool arguments are rendered by tool components, not the assistant Markdown.
    const signature = JSON.stringify([content.filter((block) => block.type === "text" || block.type === "thinking"),
      content.some((block) => block.type === "toolCall"), this.lastMessage.stopReason, this.lastMessage.errorMessage, this.isStreaming]);
    let cache = views.get(this);
    if (!cache || cache.signature !== signature || cache.expanded !== group.expanded) {
      const view = new AssistantMessageComponent(undefined, false, this.markdownTheme, "Thinking", this.outputPad, this.markdownTransformers);
      nativeUpdate.call(view, { ...this.lastMessage, content }, this.isStreaming);
      cache = { view, signature, expanded: group.expanded };
      views.set(this, cache);
    }
    const lines = nativeAssistantRender.call(cache.view, width).map((line) => truncateToWidth(line, width, ""));
    this.__compactView = cache.view;
    controller.record(this, group, width, lines.length + (thinking ? 1 : 0));
    if (thinking) {
      const theme = controller.theme;
      const label = theme ? theme.italic(theme.fg("thinkingText", "Thinking")) : "Thinking";
      const intent = group.activity.intent;
      const suffix = intent ? theme ? theme.fg("muted", ` — ${intent}`) : ` — ${intent}` : "";
      return [truncateToWidth(` ${label}${suffix}`, width, "…"), ...lines];
    }
    return lines;
  });
  patch(assistant, "handleMouse", (original) => function (event) {
    // Assistant mouse handlers only toggle local thinking. Links and selection
    // are handled by the TUI; the above-editor control owns thinking visibility.
    if (enabled && groupFor(this)) return undefined;
    return original.call(this, event);
  });

  patch(tool, "updateDisplay", (original) => function (...args) {
    if (enabled && this.toolCallId) controller.instances.set(this.toolCallId, this);
    const result = original.apply(this, args);
    if (enabled) prepared.add(this);
    return result;
  });
  patch(tool, "getCallRenderer", (original) => function () {
    const render = original.call(this);
    if (!enabled || !render) return render;
    const component = this;
    return function (args, theme, context) {
      const previous = context.lastComponent;
      const native = render(args, theme, previous instanceof IntentCall ? { ...context, lastComponent: previous.native } : context);
      return new IntentCall(native, () => intentFor(component.args, component.toolName, controller.store.language), theme);
    };
  });
  patch(tool, "createCallFallback", (original) => function () {
    const native = original.call(this);
    return enabled && controller.theme ? new IntentCall(native, () => intentFor(this.args, this.toolName, controller.store.language), controller.theme) : native;
  });
  patch(tool, "setExpanded", (original) => function (expanded) {
    if (!enabled || !mouseLocked.has(this)) return original.call(this, expanded);
  });
  function renderNative(component, width, expanded) {
    if (!prepared.has(component)) component.updateDisplay();
    if (component.expanded !== expanded) nativeSetExpanded.call(component, expanded);
    return nativeToolRender.call(component, width).map((line) => truncateToWidth(line, width, ""));
  }
  controller.renderNativeTool = renderNative;
  patch(tool, "render", (original) => function (width) {
    if (width <= 0) return [];
    if (!enabled) return original.call(this, width);
    const call = controller.store.calls.get(this.toolCallId);
    if (!call) return original.call(this, width);
    controller.tools.add(this);
    controller.instances.set(call.id, this);
    if (!prepared.has(this)) this.updateDisplay();
    const group = call.group;
    if (group.expanded) {
      const batch = controller.store.batchCalls(call);
      const host = batch.find((entry) => !entry.parent);
      if (host?.id !== call.id) { controller.record(this, group, width, 0); return []; }
      const lines = [];
      this.__compactRenderedTools = [];
      for (const entry of batch) {
        // Pi constructs history before session_start. A later sibling may not
        // have rendered yet; use a native view of its saved data until it does.
        const component = controller.resolveTool(entry);
        if (!component) continue;
        const rendered = renderNative(component, width, true);
        this.__compactRenderedTools.push({ component, offset: lines.length, height: rendered.length });
        lines.push(...rendered);
      }
      controller.record(this, group, width, lines.length);
      return lines;
    }
    const active = group.activity;
    let lines = [];
    if (active?.kind === "tool") {
      if (active.id === call.id) lines = renderNative(this, width, false);
      else {
        const nested = controller.nested.get(active.id);
        if (!call.parent && nested && controller.store.rootCall(active.id)?.id === call.id) lines = renderNative(nested, width, false);
      }
    }
    controller.record(this, group, width, lines.length);
    return lines;
  });
  patch(tool, "handleMouse", (original) => function (event) {
    const call = controller.store.calls.get(this.toolCallId);
    if (!enabled || !call) return original.call(this, event);
    if (!call.group.expanded) return undefined;
    for (const { component, offset, height } of this.__compactRenderedTools ?? []) {
      if (event.y < offset || event.y >= offset + height) continue;
      mouseLocked.add(component);
      try { return original.call(component, { ...event, y: event.y - offset, height }); }
      finally { mouseLocked.delete(component); }
    }
    return undefined;
  });
  const state = {
    dispose() {
      if (!enabled) return;
      enabled = false;
      for (const component of controller.assistants) {
        if (component.lastMessage) nativeUpdate.call(component, component.lastMessage, component.isStreaming);
        delete component.__compactView;
      }
      for (const undo of patches.reverse()) undo();
      // Components survive some runtime replacements. Drop our renderer wrappers.
      for (const component of new Set([...controller.tools, ...controller.instances.values()])) {
        delete component.__compactRenderedTools;
        component.invalidate();
      }
      if (assistant[OWNER] === state) delete assistant[OWNER];
    },
  };
  assistant[OWNER] = state;
  return () => state.dispose();
}
