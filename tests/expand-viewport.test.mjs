import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, ToolExecutionComponent, createReadToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, ScrollView, Text, TuiAltScreen, VStack, stripTerminalSequences } from "@earendil-works/pi-tui";
import { ActivityStore } from "../src/activity-store.js";
import { CompactController } from "../src/controller.js";

class Terminal {
  columns = 90; rows = 24; kittyProtocolActive = false;
  start(input, resize) { this.input = input; this.resize = resize; }
  stop() { this.input = this.resize = undefined; }
  async drainInput() {}
  write() {} moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
  click(x, y) { this.input?.(`\x1b[<0;${x + 1};${y + 1}M`); this.input?.(`\x1b[<0;${x + 1};${y + 1}m`); }
}

function harness(t) {
  initTheme("dark", false);
  const terminal = new Terminal();
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true, copyOnSelect: false });
  const store = new ActivityStore(), controller = new CompactController(store);
  const document = new Container(), widgets = new Container(), editor = new Input();
  const theme = { fg: (_color, text) => text, italic: (text) => text };
  controller.attach({ mode: "tui", cwd: process.cwd(), ui: { theme, setWidget(_key, factory) { widgets.clear(); if (factory) widgets.addChild(factory(tui, theme)); } } });
  const scroll = new ScrollView(document, { primary: true, follow: "end" });
  tui.setLayoutRoot(new VStack([
    { component: new Text("HEADER", 0, 0), basis: 1, shrink: 0 },
    { component: scroll, basis: 0, grow: 1, minSize: 1 },
    { component: widgets, shrink: 0 },
    { component: editor, basis: 1, shrink: 0 },
  ]));
  tui.setFocus(editor);
  const paint = () => { tui.renderNow(); tui.renderNow(); };
  const screen = () => tui.getScreenLines().map(stripTerminalSequences);
  t.after(() => { controller.dispose(); tui.stop({ preserveScreen: true }); });
  return { terminal, tui, store, controller, document, editor, scroll, paint, screen };
}

test("historical expansion ends at that turn and collapsing keeps the same body text on screen", (t) => {
  const h = harness(t);
  for (let round = 1; round <= 3; round++) {
    h.store.begin();
    const message = { role: "assistant", timestamp: round, stopReason: "stop", content: [
      { type: "thinking", thinking: Array.from({ length: 50 }, (_, i) => `THOUGHT_${round}_${i}`).join("\n") },
      { type: "text", text: Array.from({ length: 50 }, (_, i) => `BODY_${round}_${i}`).join("\n") },
    ] };
    h.store.assistant(message); h.store.settle();
    h.document.addChild(new AssistantMessageComponent(message));
  }
  h.tui.start(); h.paint();
  h.controller.selectGroup(h.store.groups[0]); h.paint();
  h.controller.toggle(true); h.paint();
  assert.ok(h.screen().some((line) => line.includes("BODY_1_49")));
  assert.ok(h.screen().every((line) => !line.includes("BODY_2_") && !line.includes("BODY_3_")));
  assert.equal(h.store.current, h.store.groups[2]);
  h.controller.selectGroup(h.store.groups[0]); h.paint();
  h.scroll.scrollBy(10); h.paint();
  const before = h.screen()[1];
  assert.match(before, /BODY_1_10/);
  h.controller.toggle(false); h.paint();
  assert.equal(h.screen()[1], before);
  assert.doesNotMatch(h.screen()[h.terminal.rows - 2], /↑/);
  h.controller.toggle(true); h.paint();
  h.terminal.click(h.screen()[h.terminal.rows - 2].indexOf("↑"), h.terminal.rows - 2); h.paint();
  assert.ok(h.screen().some((line) => line.includes("THOUGHT_1_0")));
  assert.equal(h.store.groups[0].expanded, true);
  assert.equal(h.tui.getFocusedComponent(), h.editor);
  h.terminal.columns = 44; h.terminal.rows = 14; h.terminal.resize?.(); h.paint();
  h.controller.toggle(false); h.paint();
  assert.ok(h.screen().some((line) => line.includes("BODY_1_49")), "collapse outside the body falls back to this turn's end");
  h.controller.toggle(true); h.paint();
  assert.ok(h.screen().some((line) => line.includes("BODY_1_49")));
  assert.equal(h.scroll.isFollowingEnd, false);
});

test("expanding an active tool turn shows its latest output and the up arrow reaches its earliest thinking", (t) => {
  const h = harness(t);
  const group = h.store.begin();
  const args = { path: "fixture.txt", displaySummary: "检查执行输出" };
  const message = { role: "assistant", timestamp: 1, stopReason: "toolUse", content: [
    { type: "thinking", thinking: Array.from({ length: 40 }, (_, i) => `ACTIVE_THOUGHT_${i}`).join("\n") },
    { type: "toolCall", id: "active", name: "read", arguments: args },
  ] };
  h.store.assistant(message);
  h.store.startTool({ toolCallId: "active", toolName: "read", args });
  h.document.addChild(new AssistantMessageComponent(message));
  const tool = new ToolExecutionComponent("read", "active", args, {}, createReadToolDefinition(process.cwd()), h.tui, process.cwd());
  tool.setArgsComplete(); tool.markExecutionStarted();
  tool.updateResult({ content: [{ type: "text", text: Array.from({ length: 100 }, (_, i) => `ACTIVE_OUTPUT_${i}`).join("\n") }], isError: false }, true);
  h.document.addChild(tool);
  h.tui.start(); h.paint();
  h.controller.toggle(true); h.paint();
  assert.ok(h.screen().some((line) => line.includes("ACTIVE_OUTPUT_99")));
  assert.equal(group.settled, false);
  h.controller.start(); h.paint();
  assert.ok(h.screen().some((line) => line.includes("ACTIVE_THOUGHT_0")));
  assert.equal(h.tui.getFocusedComponent(), h.editor);
  assert.equal(group.expanded, true);
});
