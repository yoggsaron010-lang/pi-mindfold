import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent, createAgentSession, createCodemodeExtension, DefaultResourceLoader, initTheme, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import mindfold from "../index.js";
import { ActivityStore } from "../src/activity-store.js";
import { LANGUAGE_ENV } from "../src/locale.js";
import { assertCodemodeMcpContract } from "./codemode-contract.mjs";

const model = { id: "auto-language-test", name: "Local test", provider: "openai", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const response = (timestamp, content, stopReason) => ({ role: "assistant", timestamp, content, stopReason, api: model.api, provider: model.provider, model: model.id, usage });
const clean = (lines) => lines.join("\n").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

test("automatic language follows each SDK request across tool loops and history replay", async (t) => {
  const previous = process.env[LANGUAGE_ENV];
  delete process.env[LANGUAGE_ENV];
  t.after(() => {
    if (previous === undefined) delete process.env[LANGUAGE_ENV];
    else process.env[LANGUAGE_ENV] = previous;
  });
  initTheme("dark", false);
  const directory = mkdtempSync(join(tmpdir(), "mindfold-auto-language-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const seen = [], errors = [], frames = [];
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["echo_status", "codemode"], compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [mindfold, createCodemodeExtension(), (pi) => pi.registerTool({
      name: "echo_status", label: "echo_status", description: "Echo fixture", parameters: Type.Object({ value: Type.String() }),
      async execute(_id, args) { seen.push(args); return { content: [{ type: "text", text: args.value }], details: undefined }; },
    })],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, settingsManager, resourceLoader, model, sessionManager: SessionManager.inMemory(directory) });
  let component, inference = 0;
  try {
    const tui = { requestRender() {} };
    const theme = { fg: (_color, value) => value, italic: (value) => value };
    await session.bindExtensions({ mode: "tui", uiContext: { theme, setWidget(_key, factory) { factory?.(tui, theme); } }, onError: (error) => errors.push(error) });
    await session.modelRuntime.setRuntimeApiKey("openai", "local-test-placeholder");
    session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") component = new AssistantMessageComponent(event.message);
      if ((event.type === "message_update" || event.type === "message_end") && event.message.role === "assistant") component.updateContent(event.message, event.type === "message_update");
      if (component && event.type === "message_update") frames.push(clean(component.render(80)));
    });
    const scenarios = [
      ["Check configuration", "en"], ["检查配置", "zh-CN"], ["Vérifiez la configuration", "en"],
      ["請檢查設定", "zh-CN"], ["設定を確認してください", "en"], ["检查 src/index.js", "zh-CN"],
    ];
    for (const [prompt, language] of scenarios) {
      const english = language === "en";
      const summary = english ? "Inspect project configuration" : "检查项目配置";
      const status = `${english ? "Turn intent: " : "用户目的："}${summary}\n${english ? "Activity intent: Check configuration\n" : "活动意图：检查配置\n"}`;
      const start = inference;
      frames.length = 0;
      session.agent.streamFunction = () => {
        inference++;
        const tool = session.getAllTools().find((entry) => entry.name === "echo_status");
        const codemode = session.getAllTools().find((entry) => entry.name === "codemode");
        assert.match(tool.parameters.properties.displaySummary.description, english ? /Write it in English/ : /Simplified Chinese/);
        assertCodemodeMcpContract(codemode);
        assert.match(codemode.promptGuidelines.at(-1), english ? /\/\/ Intent:/ : /\/\/ 意图：/);
        assert.ok(session.systemPrompt.includes(english ? "Activity intent:" : "活动意图："));
        assert.ok(!session.systemPrompt.includes(english ? "活动意图：" : "Activity intent:"));
        assert.ok(!session.systemPrompt.includes(english ? "Write displaySummary in Simplified Chinese" : "Write it in English"));
        const stream = new AssistantMessageEventStream();
        const timestamp = inference;
        queueMicrotask(() => {
          stream.push({ type: "start", partial: response(timestamp, [], "toolUse") });
          if (inference === start + 1) {
            const block = { type: "text", text: status };
            const partial = response(timestamp, [block], "toolUse");
            stream.push({ type: "text_delta", contentIndex: 0, delta: status, partial });
            stream.push({ type: "text_end", contentIndex: 0, content: status, partial });
            stream.push({ type: "done", reason: "toolUse", message: response(timestamp, [block, { type: "toolCall", id: `tool-${timestamp}`, name: "echo_status", arguments: { value: prompt } }], "toolUse") });
          } else {
            stream.push({ type: "done", reason: "stop", message: response(timestamp, [{ type: "text", text: "Done" }], "stop") });
          }
          stream.end();
        });
        return stream;
      };
      await session.prompt(prompt);
      assert.equal(inference - start, 2, JSON.stringify({ errors, lastMessage: session.messages.at(-1) }));
      assert.ok(frames.some((frame) => frame.trim() === (english ? "Thinking — Check configuration" : "Thinking — 检查配置")));
      assert.ok(frames.every((frame) => !frame.includes("Turn intent:") && !frame.includes("用户目的：")));
      const saved = session.sessionManager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === "mindfold.turn-intent");
      assert.equal(saved.at(-1).data.summary, summary);
      assert.equal(saved.length, seen.length);
      const result = session.messages.filter((message) => message.role === "toolResult").at(-1);
      assert.equal(result.isError, false);
      const call = session.messages.filter((message) => message.role === "assistant" && message.stopReason === "toolUse").at(-1).content.find((block) => block.type === "toolCall");
      assert.equal(call.arguments.displaySummary, english ? "Run echo_status" : "运行 echo_status");
    }
    const restored = new ActivityStore({ languageMode: "auto" });
    restored.restore(session.sessionManager.getBranch());
    assert.deepEqual(restored.groups.map((group) => group.language), scenarios.map(([, language]) => language));
    assert.deepEqual(restored.groups.map((group) => group.intentSummary), scenarios.map(([, language]) => language === "en" ? "Inspect project configuration" : "检查项目配置"));
    assert.deepEqual(seen, scenarios.map(([prompt]) => ({ value: prompt })));
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
