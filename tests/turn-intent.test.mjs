import { test } from "node:test";
import assert from "node:assert/strict";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { ActivityStore } from "../src/activity-store.js";
import { CompactController } from "../src/controller.js";
import { compactAssistantContent } from "../src/thinking-intent.js";
import { readTurnIntent, turnIntentGuideline, turnLabel } from "../src/turn-intent.js";

const message = (value, content = []) => ({ role: "assistant", timestamp: 1, content: [...content, { type: "text", text: value }] });

test("turn summaries use explicit public leading lines, wait for completion and exclude reasoning", () => {
  assert.equal(readTurnIntent(message("Turn intent: Inspect configuration\n")).summary, "Inspect configuration");
  assert.equal(readTurnIntent(message("用户目的：检查配置\n")).summary, "检查配置");
  assert.equal(readTurnIntent(message("用户目的：检查配置"), { complete: true }).summary, "检查配置");
  for (const prefix of ["T", "Turn intent:", "Turn intent: Inspect", "用户目", "用户目的：检查"]) {
    assert.equal(readTurnIntent(message(prefix)).pending, true);
    assert.equal(readTurnIntent(message(prefix)).summary, undefined);
  }
  assert.equal(readTurnIntent(message("# Example\nTurn intent: not metadata\n")).summary, undefined);
  assert.equal(readTurnIntent(message("```\n用户目的：引用\n```\n")).summary, undefined);
  assert.equal(readTurnIntent({ content: [{ type: "thinking", thinking: "Turn intent: PRIVATE\n" }] }).summary, undefined);
  assert.equal(readTurnIntent(message("Turn intent: \x1b[31mInspect\x1b[0m\tconfig\n")).summary, "Inspect config");
  assert.ok(readTurnIntent(message(`Turn intent: ${"a".repeat(200)}\n`)).summary.length <= 96);
  assert.match(turnIntentGuideline("en"), /Once per user request/);
  assert.match(turnIntentGuideline("zh-CN"), /用户目的/);
});

test("metadata and activity lines disappear only from compact projection while the full body survives", () => {
  initTheme("dark", false);
  const store = new ActivityStore();
  const controller = new CompactController(store);
  const theme = { fg: (_color, text) => text, italic: (text) => text };
  controller.attach({ mode: "tui", cwd: process.cwd(), ui: { theme, setWidget(_key, factory) { factory?.({ requestRender() {} }, theme); } } });
  try {
    store.begin();
    store.user({ content: "请检查配置" });
    const original = message("用户目的：检查项目配置\n\n# 正文\n\n结果完整保留", [{ type: "thinking", thinking: "PRIVATE" }]);
    store.assistant(original, true, true);
    store.text(original, { complete: true, finished: true });
    store.settle();
    const component = new AssistantMessageComponent(original);
    const collapsed = component.render(80).join("\n");
    assert.doesNotMatch(collapsed, /用户目的：|PRIVATE/);
    assert.match(collapsed, /结果完整保留/);
    assert.equal(turnLabel(store.current), "检查项目配置");
    store.current.expanded = true;
    const expanded = component.render(80).join("\n");
    assert.match(expanded, /用户目的：检查项目配置/);
    assert.match(expanded, /PRIVATE/);
    assert.equal(original.content[1].text, "用户目的：检查项目配置\n\n# 正文\n\n结果完整保留");
    const status = message("Turn intent: Inspect config\nActivity intent: Read files\n");
    const summaryRange = readTurnIntent(status).range;
    const clean = compactAssistantContent(status, { start: summaryRange.end, end: status.content[0].text.length }, summaryRange);
    assert.equal(clean[0].text, "");
  } finally { controller.dispose(); }
});

test("historical turns use user previews and stored summaries stay attached to their branch", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "first\nrequest", timestamp: 1 } },
    { type: "message", message: { ...message("Done"), timestamp: 2, stopReason: "stop" } },
    { type: "custom", customType: "mindfold.turn-intent", data: { summary: "Inspect configuration" } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "第二轮原文" }], timestamp: 3 } },
    { type: "message", message: { ...message("完成"), timestamp: 4, stopReason: "stop" } },
  ];
  const store = new ActivityStore({ languageMode: "auto" });
  store.restore(entries);
  assert.deepEqual(store.groups.map(turnLabel), ["Inspect configuration", "第二轮原文"]);
  store.restore(entries.slice(0, 2));
  assert.equal(turnLabel(store.current), "first request");
  assert.equal(turnLabel({ prompt: "\x1b[31mTitle\x1b[0m\nline" }), "Title line");
});

test("opening Turns backfills legacy live groups from the current session without rebuilding navigation", () => {
  const entries = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "检查配置" }], timestamp: 10 } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Progress" }], stopReason: "toolUse", timestamp: 11 } },
    { type: "message", message: { role: "user", content: "追加说明", timestamp: 12 } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "完成" }], stopReason: "stop", timestamp: 13 } },
    { type: "message", message: { role: "user", content: "Check tests", timestamp: 14 } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: 15 } },
    { type: "custom", customType: "mindfold.turn-intent", data: { summary: "Verify automated tests" } },
  ];
  const store = new ActivityStore();
  for (const entry of entries) {
    if (entry.message?.role !== "assistant") continue;
    if (!store.current || store.current.settled) store.begin();
    store.assistant(entry.message);
    if (entry.message.stopReason === "stop") store.settle();
  }
  assert.deepEqual(store.groups.map(turnLabel), ["未命名请求", "未命名请求"]);
  const groups = store.groups.slice(), mapping = [...store.messages];
  groups[0].expanded = true;
  store.selected = groups[0];
  const controller = new CompactController(store);
  const theme = { fg: (_color, text) => text, italic: (text) => text };
  controller.attach({ mode: "tui", cwd: process.cwd(), sessionManager: { buildContextEntries() { return entries; } },
    ui: { theme, setWidget(_key, factory) { factory?.({ requestRender() {} }, theme); } },
  });
  try {
    controller.directory.toggle();
    assert.deepEqual(store.groups.map(turnLabel), ["检查配置", "Verify automated tests"]);
    assert.deepEqual(store.groups, groups);
    assert.deepEqual([...store.messages], mapping);
    assert.equal(store.selected, groups[0]);
    assert.equal(groups[0].expanded, true);
    assert.match(controller.directory.render(80).join("\n"), /检查配置/);
  } finally { controller.dispose(); }
});
