import { test } from "node:test";
import assert from "node:assert/strict";
import { IntentDecorator, intentFor } from "../src/intent.js";
import { hostModule } from "./host-modules.mjs";
import { assertCodemodeMcpContract } from "./codemode-contract.mjs";
const { createCodemodeToolDefinition } = await hostModule("./extensions/codemode/tool.js");
const { resolveGrammarConstrainedSampling } = await import("@earendil-works/pi-ai/api/constrained-sampling");

test("codemode keeps grammar sampling and MCP schema identity while obtaining Chinese intent from a source comment", () => {
  const tool = createCodemodeToolDefinition();
  const schema = tool.parameters;
  const grammar = tool.constrainedSampling;
  const reachesTools = tool.reachesTools;
  const decorator = new IntentDecorator();
  try {
    decorator.decorate(tool);
    assert.doesNotThrow(() => resolveGrammarConstrainedSampling(tool, true));
    assert.equal(tool.parameters, schema);
    assertCodemodeMcpContract(tool);
    assert.equal(tool.reachesTools, reachesTools);
    assert.equal(tool.constrainedSampling, grammar);
    assert.match(tool.promptGuidelines.join("\n"), /意图/);
    assert.equal(intentFor({ code: '// 意图：检查文件与测试结果\ntext("ok");' }, "codemode"), "检查文件与测试结果");
    assert.equal(intentFor({ code: '// @options: {"timeout_ms":60000}\n// 意图：批量检查文件\ntext("ok");' }, "codemode"), "批量检查文件");
  } finally { decorator.restore(); }
  assert.equal(tool.parameters, schema);
});

test("other grammar tools keep their sole input property instead of gaining a second required field", () => {
  const tool = { name: "grammar_custom", parameters: { type: "object", properties: { source: { type: "string" } }, required: ["source"] }, constrainedSampling: { type: "grammar", variants: { openai_regex: ".*" } }, execute() {} };
  const decorator = new IntentDecorator();
  try {
    decorator.decorate(tool);
    assert.doesNotThrow(() => resolveGrammarConstrainedSampling(tool, true));
  } finally { decorator.restore(); }
});
