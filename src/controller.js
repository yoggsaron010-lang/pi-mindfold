import { MouseRegion, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
  patchAggregateViewport, recordAggregateViewportRegion, releaseAggregateViewportRegion,
  resetAggregateViewportOwner, restoreAggregateViewport, toggleAggregateViewportRun,
} from "../vendor/pi-tool-explain/aggregate-viewport.ts";
import { messages } from "./locale.js";
import { installRenderBridge } from "./render-bridge.js";

export class CompactController {
  assistants = new Set();
  tools = new Set();
  nested = new Map();
  instances = new Map();
  definitions = new Map();
  runs = new Map();
  anchors = new Map();
  constructor(store) { this.store = store; }

  attach(ctx) {
    this.ctx = ctx;
    if (ctx.mode !== "tui") return;
    this.theme = ctx.ui.theme;
    if (!this.disposeRender) {
      patchAggregateViewport();
      this.disposeRender = installRenderBridge(this);
    }
    ctx.ui.setWidget("mindfold", (tui, theme) => {
      this.tui = tui;
      this.theme = theme;
      const control = {
        render: (width) => {
          const group = this.store.selected ?? this.store.current;
          const label = group?.expanded ? "[Expanded]" : "[Collapse]";
          const index = this.store.groups.indexOf(group);
          const navigation = this.store.groups.length > 1 ? `  ‹ ${index + 1}/${this.store.groups.length} ›` : "";
          const text = `${theme.fg("accent", label)}${theme.fg("muted", `${navigation}  Ctrl+Alt+T`)}`;
          return [truncateToWidth(text, Math.max(0, width), "")];
        },
        invalidate() {},
      };
      return new MouseRegion(control, (event) => {
        if (event.button !== "left" || !["press", "release", "click"].includes(event.type)) return;
        const group = this.store.selected ?? this.store.current;
        const labelWidth = visibleWidth(group?.expanded ? "[Expanded]" : "[Collapse]");
        let action;
        if (event.x < labelWidth) action = () => this.toggle();
        else if (this.store.groups.length > 1 && event.x >= labelWidth + 2) {
          const index = this.store.groups.indexOf(group);
          const nav = `‹ ${index + 1}/${this.store.groups.length} ›`;
          if (event.x === labelWidth + 2) action = () => this.select(-1);
          else if (event.x === labelWidth + 2 + visibleWidth(nav) - 1) action = () => this.select(1);
        }
        if (!action) return;
        // Claim the press so repeated clicks are not interpreted as word selection.
        if (event.type === "click") action();
        return { handled: true };
      });
    }, { placement: "aboveEditor" });
    for (const call of this.store.calls.values()) {
      if (call.parent) { this.startNested(call); this.updateNested(call); }
    }
    this.changed();
  }

  record(component, group, width, height) {
    if (height === 0 || width <= 0) { releaseAggregateViewportRegion(component); return; }
    let run = this.runs.get(group);
    if (!run) {
      run = {
        owner: this, id: String(group.id), isValid: () => this.store.groups.includes(group),
        isExpanded: () => group.expanded, label: () => messages(this.store.language).dialogue(group.id),
        toggle: () => { group.expanded = !group.expanded; this.store.selected = group; this.changed(); },
      };
      this.runs.set(group, run);
    }
    this.anchors.set(group, component);
    recordAggregateViewportRegion(component, { run, width, height, titleRow: 0 });
  }

  toggle(expanded) {
    const group = this.store.selected ?? this.store.current;
    if (!group || (expanded !== undefined && group.expanded === expanded)) return;
    const run = this.runs.get(group);
    const anchor = this.anchors.get(group);
    if (run && anchor) toggleAggregateViewportRun(anchor, run);
    else { group.expanded = !group.expanded; this.changed(); }
  }

  select(direction) {
    const index = this.store.groups.indexOf(this.store.selected ?? this.store.current);
    this.store.selected = this.store.groups[Math.max(0, Math.min(this.store.groups.length - 1, index + direction))];
    this.changed();
  }

  changed() {
    // Native updates and our render keys invalidate content when needed. Rebuilding
    // every historical Markdown component for each streamed token is quadratic.
    this.tui?.requestRender();
  }

  resolveTool(call) {
    const existing = this.instances.get(call.id);
    if (existing) return existing;
    if (!this.tui) return undefined;
    const definition = this.definitions.get(call.name)?.definition;
    const component = new ToolExecutionComponent(call.name, call.id, call.args ?? {}, {}, definition, this.tui, this.ctx.cwd);
    if (call.started) { component.setArgsComplete(); component.markExecutionStarted(); }
    if (call.result) component.updateResult({ ...call.result, isError: call.isError }, call.partial);
    this.instances.set(call.id, component);
    return component;
  }

  startNested(call) {
    if (!call.parent || !this.tui) return;
    const component = this.resolveTool(call);
    this.nested.set(call.id, component);
  }

  updateNested(call) {
    const component = call && this.nested.get(call.id);
    if (component && call.result) component.updateResult({ ...call.result, isError: call.isError }, call.partial);
  }

  clear() {
    resetAggregateViewportOwner(this);
    this.assistants.clear();
    this.tools.clear();
    this.nested.clear();
    this.instances.clear();
    this.runs.clear();
    this.anchors.clear();
  }

  dispose() {
    this.disposeRender?.();
    this.disposeRender = undefined;
    this.clear();
    restoreAggregateViewport();
    if (this.ctx?.mode === "tui") this.ctx.ui.setWidget("mindfold", undefined);
    this.tui = undefined;
  }
}
