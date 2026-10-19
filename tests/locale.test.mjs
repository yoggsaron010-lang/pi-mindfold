import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent, createAgentSession, DefaultResourceLoader, initTheme, SessionManager, SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import mindfold from "../index.js";
import { requestLanguage, resolveLanguage, resolveLanguageMode, LANGUAGE_ENV } from "../src/locale.js";
import { IntentDecorator, fallbackIntent, intentFor } from "../src/intent.js";
import { addPublicActivityGuideline, PUBLIC_ACTIVITY_GUIDELINE, readPublicActivity } from "../src/thinking-intent.js";
import { INLINE_PAYLOAD_BYTES, loadDisplayPayload, nestedResultReceipt, saveDisplayPayload } from "../src/activity-journal.js";
import { hostModule } from "./host-modules.mjs";
const { createCodemodeToolDefinition } = await hostModule("./extensions/codemode/tool.js");

const text = (value) => ({ role: "assistant", content: [{ type: "text", text: value }] });

test("PI_MINDFOLD_LANG selects English and anything else keeps the Simplified Chinese default", (t) => {
  const previous = process.env[LANGUAGE_ENV];
  t.after(() => {
    if (previous === undefined) delete process.env[LANGUAGE_ENV];
    else process.env[LANGUAGE_ENV] = previous;
  });
  delete process.env[LANGUAGE_ENV];
  assert.equal(resolveLanguage(), "zh-CN");
  assert.equal(resolveLanguage(undefined), "zh-CN");
  process.env[LANGUAGE_ENV] = "en";
  assert.equal(resolveLanguage(), "en");
  assert.equal(resolveLanguage(undefined), "en");
  assert.equal(resolveLanguage("zh-CN"), "zh-CN");
  assert.equal(resolveLanguage(""), "zh-CN");
  assert.equal(resolveLanguage("fr"), "zh-CN");
  assert.equal(resolveLanguage("zh"), "zh-CN");
  for (const value of ["en", "EN", " en-US ", "en_GB"]) assert.equal(resolveLanguage(value), "en");
});

test("automatic intent language uses Chinese for Chinese input and English for other languages", () => {
  for (const prompt of ["检查配置", "請檢查設定", "请检查 src/index.js", "𠮷字测试"]) assert.equal(requestLanguage(prompt), "zh-CN");
  for (const prompt of ["Check configuration", "Vérifiez la configuration", "Проверьте настройки", "設定を確認してください", "설정을 확인하세요", "123 ✅"]) assert.equal(requestLanguage(prompt), "en");
  assert.equal(requestLanguage("", "auto", "en"), "en");
  assert.equal(requestLanguage(undefined, "auto", "zh-CN"), "zh-CN");
  assert.equal(requestLanguage("检查配置", "en"), "en");
  assert.equal(requestLanguage("Check configuration", "zh-CN"), "zh-CN");
  for (const value of ["", "auto", "fr"]) assert.equal(resolveLanguageMode(value), "auto");
  assert.equal(resolveLanguageMode("EN_us"), "en");
  assert.equal(resolveLanguageMode("zh-CN"), "zh-CN");
});

test("English fallbacks, schema description and prompt guideline replace the Chinese ones", () => {
  assert.equal(fallbackIntent("read", "en"), "Read file");
  assert.equal(fallbackIntent("custom_tool", "en"), "Run custom_tool");
  assert.equal(fallbackIntent("read", "zh-CN"), "读取文件");
  assert.equal(intentFor({}, "bash", "en"), "Run command");

  const tool = { name: "read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, execute: (_id, args) => args };
  const decorator = new IntentDecorator({ language: "en" });
  try {
    decorator.decorate(tool);
    assert.match(tool.parameters.properties.displaySummary.description, /Write it in English/);
    assert.doesNotMatch(tool.parameters.properties.displaySummary.description, /Simplified Chinese/);
    assert.match(tool.promptGuidelines.join("\n"), /Write it in English/);
    assert.equal(tool.prepareArguments({ path: "a" }).displaySummary, "Read file");
  } finally { decorator.restore(); }
});

test("decorators switch languages without stacking wrappers or changing codemode schemas", () => {
  const parameters = { type: "object", properties: { path: { type: "string" } } };
  const execute = (_id, args) => args;
  const tool = { name: "read", parameters, execute, promptGuidelines: ["Keep original guideline"] };
  const codemode = createCodemodeToolDefinition();
  const grammarSchema = codemode.parameters;
  const decorator = new IntentDecorator({ language: "zh-CN" });
  try {
    decorator.decorate(tool);
    decorator.decorate(codemode);
    for (const language of ["en", "zh-CN", "en"]) {
      decorator.setLanguage(language);
      assert.equal(tool.prepareArguments({ path: "a" }).displaySummary, fallbackIntent("read", language));
      assert.deepEqual(tool.execute("call", { path: "a", displaySummary: "intent" }), { path: "a" });
      assert.equal(tool.promptGuidelines.length, 2);
      assert.equal(codemode.parameters, grammarSchema);
      assert.match(codemode.promptGuidelines.at(-1), language === "en" ? /\/\/ Intent:/ : /\/\/ 意图：/);
    }
  } finally { decorator.restore(); }
  assert.equal(tool.parameters, parameters);
  assert.equal(tool.execute, execute);
  assert.deepEqual(tool.promptGuidelines, ["Keep original guideline"]);
});

test("codemode asks for an English intent comment and either comment form is read back", () => {
  const tool = createCodemodeToolDefinition();
  const decorator = new IntentDecorator({ language: "en" });
  try {
    decorator.decorate(tool);
    const guidelines = tool.promptGuidelines.join("\n");
    assert.match(guidelines, /\/\/ Intent:/);
    assert.doesNotMatch(guidelines, /意图/);
  } finally { decorator.restore(); }
  assert.equal(intentFor({ code: '// Intent: Check files and test results\ntext("ok");' }, "codemode", "en"), "Check files and test results");
  assert.equal(intentFor({ code: '// @options: {"timeout_ms":60000}\n// intent: Batch check\ntext("ok");' }, "codemode", "en"), "Batch check");
  assert.equal(intentFor({ code: '// 意图：批量检查文件\ntext("ok");' }, "codemode", "en"), "批量检查文件");
  assert.equal(intentFor({ code: 'text("// Intent: not a leading comment");' }, "codemode", "en"), "Run batch tool script");
});

test("English public activity lines are parsed only in English mode", () => {
  const complete = { complete: true };
  assert.equal(readPublicActivity(text("Activity intent: Check reload recovery\n"), { language: "en" }).intent, "Check reload recovery");
  assert.equal(readPublicActivity(text("activity INTENT: Inspect config"), { ...complete, language: "en" }).intent, "Inspect config");
  assert.equal(readPublicActivity(text("Activity in"), { language: "en" }).kind, "pending");
  assert.equal(readPublicActivity(text("Activity intent: Check"), { language: "en" }).kind, "pending");
  assert.equal(readPublicActivity(text("活动意图：检查配置\n"), { language: "en" }).kind, "body");
  assert.equal(readPublicActivity(text("Activity intent: Check\n"), { language: "zh-CN" }).kind, "body");
  assert.equal(readPublicActivity(text("Activity intent: Check\n\n# Result\n\nBody"), { language: "en" }).kind, "body");

  const event = { systemPromptOptions: {} };
  addPublicActivityGuideline(event, "en");
  addPublicActivityGuideline(event, "en");
  assert.equal(event.systemPromptOptions.promptGuidelines.length, 1);
  assert.match(event.systemPromptOptions.promptGuidelines[0], /"Activity intent: /);
  assert.ok(!event.systemPromptOptions.promptGuidelines.includes(PUBLIC_ACTIVITY_GUIDELINE));
});

test("a missing sidecar is labelled in the configured language", () => {
  const directory = mkdtempSync(join(tmpdir(), "mindfold-locale-"));
  try {
    const receipt = nestedResultReceipt({ toolCallId: "a/1", parentToolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "x".repeat(INLINE_PAYLOAD_BYTES + 1) }] } });
    const saved = saveDisplayPayload(receipt, directory);
    rmSync(saved.displayPayload.path);
    assert.equal(loadDisplayPayload(saved, directory, "en").args.displaySummary, "Saved display data unavailable");
    assert.equal(loadDisplayPayload(saved, directory, "zh-CN").args.displaySummary, "原始显示数据不可用");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const clean = (lines) => lines.join("\n").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
const model = { id: "locale-local-test", name: "Local test", provider: "openai", api: "openai-completions", baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const response = (timestamp, content, stopReason = "toolUse") => ({ role: "assistant", timestamp, content, stopReason, api: model.api, provider: model.provider, model: model.id, usage });

test("with PI_MINDFOLD_LANG=en the real SDK session uses English prompts, commands and Thinking intent", async () => {
  const previous = process.env[LANGUAGE_ENV];
  process.env[LANGUAGE_ENV] = "en";
  initTheme("dark", false);
  const directory = mkdtempSync(join(tmpdir(), "mindfold-locale-sdk-"));
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["echo_status"], compaction: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({ cwd: directory, agentDir: directory, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [mindfold, (pi) => pi.registerTool({ name: "echo_status", label: "echo_status", description: "Echo fixture", parameters: Type.Object({ value: Type.String() }),
      async execute(_id, args) { return { content: [{ type: "text", text: args.value }], details: undefined }; } })],
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, settingsManager, resourceLoader, model, sessionManager: SessionManager.inMemory(directory) });
  const tui = { requestRender() {} };
  const theme = { fg: (_color, value) => value, italic: (value) => value };
  const errors = [], frames = [], prompts = [];
  let component, calls = 0;
  try {
    await session.bindExtensions({ mode: "tui", uiContext: { theme, setWidget(_key, factory) { factory?.(tui, theme); } }, onError: (error) => errors.push(error) });
    await session.modelRuntime.setRuntimeApiKey("openai", "local-test-placeholder");
    const commands = session.extensionRunner.getRegisteredCommands();
    assert.match(commands.find((command) => command.name === "mindfold").description, /^Thinking and tool display/);
    assert.match(session.getAllTools().find((tool) => tool.name === "echo_status").parameters.properties.displaySummary.description, /English/);
    session.agent.streamFunction = () => {
      calls++;
      prompts.push(session.systemPrompt);
      const stream = new AssistantMessageEventStream();
      queueMicrotask(() => {
        if (calls === 1) {
          const thinking = { type: "thinking", thinking: "PRIVATE_SDK_THINKING" };
          stream.push({ type: "start", partial: response(100, []) });
          stream.push({ type: "thinking_start", contentIndex: 0, partial: response(100, [{ type: "thinking", thinking: "" }]) });
          stream.push({ type: "thinking_delta", contentIndex: 0, delta: thinking.thinking, partial: response(100, [thinking]) });
          stream.push({ type: "text_start", contentIndex: 1, partial: response(100, [thinking, { type: "text", text: "" }]) });
          stream.push({ type: "text_delta", contentIndex: 1, delta: "Activity intent: Check", partial: response(100, [thinking, { type: "text", text: "Activity intent: Check" }]) });
          const status = { type: "text", text: "Activity intent: Check streaming state\n" };
          stream.push({ type: "text_delta", contentIndex: 1, delta: " streaming state\n", partial: response(100, [thinking, status]) });
          stream.push({ type: "text_end", contentIndex: 1, content: status.text, partial: response(100, [thinking, status]) });
          stream.push({ type: "done", reason: "toolUse", message: response(100, [thinking, status, { type: "toolCall", id: "status-tool", name: "echo_status", arguments: { value: "fixture", displaySummary: "Verify tool phase switch" } }]) });
        } else {
          const final = response(101, [{ type: "text", text: "# Done\n\nFull final answer" }], "stop");
          stream.push({ type: "start", partial: response(101, []) });
          stream.push({ type: "text_delta", contentIndex: 0, delta: "# Done\n\nFull final answer", partial: final });
          stream.push({ type: "done", reason: "stop", message: final });
        }
        stream.end();
      });
      return stream;
    };
    session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant") component = new AssistantMessageComponent(event.message);
      if ((event.type === "message_update" || event.type === "message_end") && event.message.role === "assistant") component.updateContent(event.message, event.type === "message_update");
      if (component && ["message_update", "message_end", "tool_execution_start"].includes(event.type)) frames.push(clean(component.render(80)));
    });
    await session.prompt("Inspect the fixture then answer");
    assert.equal(calls, 2);
    assert.ok(frames.some((frame) => frame.trim() === "Thinking — Check streaming state"));
    assert.ok(frames.filter((frame) => frame.includes("Thinking")).every((frame) => !frame.includes("Activity intent:")), "the raw status line is hidden while Thinking shows it");
    assert.match(frames.at(-1), /Full final answer/);
    assert.ok(prompts.every((prompt) => prompt.includes("Activity intent:") && !prompt.includes("活动意图")));
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
    if (previous === undefined) delete process.env[LANGUAGE_ENV];
    else process.env[LANGUAGE_ENV] = previous;
  }
});
