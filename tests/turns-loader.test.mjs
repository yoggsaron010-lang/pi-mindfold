import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const clean = (lines) => lines.join("\n").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("the real extension loader restores user previews and saved turn titles before and after reload", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "mindfold-turns-loader-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const settingsManager = SettingsManager.inMemory();
  const sessionManager = SessionManager.inMemory(directory);
  sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "检查项目配置" }], timestamp: 1 });
  sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "完成" }], stopReason: "stop", timestamp: 2 });
  sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "Check tests" }], timestamp: 3 });
  sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop", timestamp: 4 });
  sessionManager.appendCustomEntry("mindfold.turn-intent", { summary: "Verify automated tests" });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [fileURLToPath(new URL("../index.js", import.meta.url))],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, settingsManager, resourceLoader, sessionManager });
  const theme = { fg: (_color, text) => text, italic: (text) => text };
  const tui = { requestRender() {} };
  const errors = [];
  let widget;
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { theme, setWidget(_key, factory) { widget = factory?.(tui, theme); } }, onError: (error) => errors.push(error) });
    for (let pass = 0; pass < 2; pass++) {
      if (pass) await session.reload();
      await session.prompt("/mindfold turns");
      const output = clean(widget.render(80));
      assert.match(output, /检查项目配置/);
      assert.match(output, /Verify automated tests/);
      assert.doesNotMatch(output, /未命名请求|Untitled request/);
      await session.prompt("/mindfold turns");
    }
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
