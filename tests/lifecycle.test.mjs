import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ToolExecutionComponent, createReadToolDefinition, initTheme } from "@earendil-works/pi-coding-agent";
import mindfold from "../index.js";

const clean = (lines) => lines.join("\n").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("real session.reload rebuilds history before session_start without losing calls or intent; compaction clears old navigation", async () => {
  initTheme("dark", false);
  const directory = mkdtempSync(join(tmpdir(), "compact-lifecycle-"));
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(directory);
  const args = { path: "before-reload.txt", displaySummary: "检查重载前的历史" };
  sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "first request" }], timestamp: 1 });
  sessionManager.appendMessage({ role: "assistant", timestamp: 2, stopReason: "toolUse", content: [{ type: "toolCall", id: "history", name: "read", arguments: args }] });
  sessionManager.appendMessage({ role: "toolResult", timestamp: 3, toolCallId: "history", toolName: "read", content: [{ type: "text", text: "RELOAD_HISTORY_OUTPUT" }], isError: false });
  sessionManager.appendMessage({ role: "assistant", timestamp: 4, stopReason: "stop", content: [{ type: "text", text: "first done" }] });
  sessionManager.appendCustomEntry("mindfold.turn-intent", { summary: "检查重载前的历史工具" });
  const retainedUser = sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "second request" }], timestamp: 5 });
  sessionManager.appendMessage({ role: "assistant", timestamp: 6, stopReason: "stop", content: [{ type: "text", text: "second done" }] });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [mindfold] });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, settingsManager, resourceLoader, sessionManager });
  const tui = { requestRender() {} };
  const theme = { fg: (_color, text) => text, italic: (text) => text };
  const notices = [], errors = [];
  let widget;
  const uiContext = { theme, notify(message) { notices.push(message); }, setWidget(_key, factory) { widget = factory?.(tui, theme); } };
  try {
    await session.bindExtensions({ mode: "tui", uiContext, onError: (error) => errors.push(error) });
    let historical;
    await session.reload({ beforeSessionStart() {
      // The bridge is intentionally not installed at this point, just like the TUI.
      historical = new ToolExecutionComponent("read", "history", args, {}, createReadToolDefinition(directory), tui, directory);
      historical.updateResult({ content: [{ type: "text", text: "RELOAD_HISTORY_OUTPUT" }], isError: false });
    } });
    assert.match(clean(historical.render(80)), /↳ 检查重载前的历史/);
    await session.prompt("/mindfold turns");
    assert.match(clean(widget.render(80)), /检查重载前的历史工具/);
    assert.match(clean(widget.render(80)), /second request/);
    await session.prompt("/mindfold turns");
    await session.prompt("/mindfold prev");
    await session.prompt("/mindfold expand");
    assert.match(clean(historical.render(80)), /RELOAD_HISTORY_OUTPUT/);
    assert.match(clean(widget.render(80)), /\[Expanded\]/);
    await session.prompt("/mindfold status");
    assert.match(notices.at(-1), /2 次对话/);
    sessionManager.appendCompaction("summary of first request", retainedUser, 100);
    await session.extensionRunner.emit({ type: "session_compact", reason: "manual", willRetry: false });
    await session.prompt("/mindfold status");
    assert.match(notices.at(-1), /1 次对话/);
    assert.doesNotMatch(clean(widget.render(80)), /2\/2|1\/2/);
    await session.prompt("/mindfold turns");
    assert.match(clean(widget.render(80)), /second request/);
    assert.doesNotMatch(clean(widget.render(80)), /检查重载前的历史工具/);
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
