import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import mindfold from "../index.js";
import { ActivityStore } from "../src/activity-store.js";
import { assertCodemodeMcpContract } from "./codemode-contract.mjs";
const { resolveGrammarConstrainedSampling } = await import("@earendil-works/pi-ai/api/constrained-sampling");

const model = {
  id: "compact-test", name: "Compact test model", api: "openai-completions", provider: "openai",
  baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function response(content, stopReason, timestamp) {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, content, stopReason, usage, timestamp };
}
function scripted(responses) {
  return () => {
    const stream = new AssistantMessageEventStream();
    const message = responses.shift();
    assert.ok(message, "unexpected extra inference request");
    queueMicrotask(() => {
      stream.push({ type: "start", partial: { ...message, content: [] } });
      stream.push({ type: "done", reason: message.stopReason, message });
      stream.end();
    });
    return stream;
  };
}

test("real host registry decorates built-ins, extensions, SDK tools, codemode and late registrations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "compact-sdk-"));
  const fixture = join(directory, "fixture.txt");
  writeFileSync(fixture, "fixture content", "utf8");
  const seen = [];
  let extensionApi;
  const echo = (name) => ({
    name, label: name, description: "Echo test value", parameters: Type.Object({ value: Type.String() }, { additionalProperties: false }),
    async execute(_id, args) { seen.push({ name, args }); return { content: [{ type: "text", text: args.value }], details: { value: args.value }, structuredContent: { raw: "x".repeat(100000) } }; },
  });
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["read", "edit", "write", "grep", "find", "ls", "codemode", "echo_custom", "sdk_echo"] });
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true,
    extensionFactories: [mindfold, createCodemodeExtension(), (pi) => { extensionApi = pi; pi.registerTool(echo("echo_custom")); }],
  });
  await resourceLoader.reload();
  const errors = resourceLoader.getExtensions().errors;
  assert.deepEqual(errors, []);
  const { session } = await createAgentSession({ cwd: directory, agentDir: directory, model, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(directory), customTools: [echo("sdk_echo")] });
  try {
    await session.bindExtensions({});
    await session.modelRuntime.setRuntimeApiKey("openai", "local-test-placeholder");
    for (const tool of session.getAllTools()) {
      if (tool.name === "codemode") {
        assertCodemodeMcpContract(tool);
        assert.doesNotThrow(() => resolveGrammarConstrainedSampling(session.agent.state.tools.find((entry) => entry.name === tool.name), true));
        continue;
      }
      assert.ok(tool.parameters.properties.displaySummary, `missing intent: ${tool.name}`);
      assert.ok(tool.parameters.required.includes("displaySummary"), `optional intent: ${tool.name}`);
    }
    extensionApi.registerTool(echo("late_mcp_lookup"));
    assert.ok(session.getAllTools().find((tool) => tool.name === "late_mcp_lookup").parameters.properties.displaySummary);
    session.agent.streamFunction = scripted([
      response([
        { type: "thinking", thinking: "Inspect the fixture then check custom arguments" },
        { type: "toolCall", id: "read-fixture", name: "read", arguments: { path: fixture, displaySummary: "检查测试文件内容" } },
        { type: "toolCall", id: "echo", name: "echo_custom", arguments: { value: "direct", displaySummary: "验证自定义工具参数" } },
        { type: "toolCall", id: "sdk", name: "sdk_echo", arguments: { value: "sdk", displaySummary: "验证 SDK 工具接入" } },
      ], "toolUse", 1),
      response([
        { type: "toolCall", id: "script", name: "codemode", arguments: {
          code: '// 意图：验证脚本内工具调用与兜底\nconst a = await tools.echo_custom({value:"nested", displaySummary:"验证嵌套中文意图"}); text(a); const b = await tools.echo_custom({value:"fallback"}); text(b);',
        } },
      ], "toolUse", 2),
      response([{ type: "text", text: "完成" }], "stop", 3),
    ]);
    const events = [];
    const unsubscribe = session.subscribe((event) => events.push(event));
    await session.prompt("Run local tool integration checks");
    unsubscribe();
    const results = session.messages.filter((message) => message.role === "toolResult");
    assert.ok(results.length >= 4);
    for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.content));
    assert.deepEqual(seen.map((entry) => entry.args), [{ value: "direct" }, { value: "sdk" }, { value: "nested" }, { value: "fallback" }]);
    const nestedStarts = events.filter((event) => event.type === "tool_execution_start" && event.parentToolCallId);
    assert.equal(nestedStarts.length, 2);
    assert.equal(nestedStarts[0].args.displaySummary, "验证嵌套中文意图");
    assert.ok(nestedStarts[1].args.displaySummary);
    assert.ok(events.some((event) => event.type === "agent_settled"));
    const branch = session.sessionManager.getBranch();
    const saved = branch.filter((entry) => entry.type === "custom" && (entry.customType === "mindfold.nested" || entry.customType === "compact-thinking.nested"));
    assert.equal(saved.length, 2);
    assert.ok(saved.every((entry) => !("structuredContent" in entry.data.result)));
    const starts = branch.filter((entry) => entry.type === "custom" && (entry.customType === "mindfold.tool-start" || entry.customType === "compact-thinking.tool-start"));
    assert.equal(starts.length, 6);
    assert.ok(starts.filter((entry) => !entry.data.parentToolCallId).every((entry) => !("args" in entry.data)));
    const restored = new ActivityStore();
    restored.restore(branch);
    assert.equal(restored.groups.length, 1);
    assert.equal(restored.calls.get(nestedStarts[0].toolCallId).result.content[0].text, "nested");
    assert.equal(restored.calls.get(nestedStarts[1].toolCallId).result.content[0].text, "fallback");
  } finally {
    await session.extensionRunner?.emit?.({ type: "session_shutdown" });
    session.dispose();
  }
});
