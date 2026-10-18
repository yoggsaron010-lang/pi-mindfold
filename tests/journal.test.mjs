import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveDisplayPayload, loadDisplayPayload, nestedResultReceipt, toolStartReceipt, INLINE_PAYLOAD_BYTES } from "../src/activity-journal.js";
import { ActivityStore } from "../src/activity-store.js";

test("nested journal excludes structuredContent and usage without changing visible content", () => {
  const content = [{ type: "text", text: "visible output" }];
  const receipt = nestedResultReceipt({ toolCallId: "a/1", parentToolCallId: "a", toolName: "mcp_large", result: { content, details: { format: "text" }, structuredContent: { raw: "x".repeat(100000) }, usage: { output: 100 } }, isError: false });
  assert.deepEqual(receipt.result, { content, details: { format: "text" } });
  assert.ok(JSON.stringify(receipt).length < 500);
  assert.deepEqual(toolStartReceipt({ toolCallId: "a", toolName: "codemode", args: { code: "large source" } }), { toolCallId: "a", toolName: "codemode" });
});

test("unavailable sidecar storage falls back to complete inline data", () => {
  const directory = mkdtempSync(join(tmpdir(), "compact-no-storage-"));
  try {
    const file = join(directory, "not-a-directory");
    writeFileSync(file, "fixture");
    const data = { phase: "end", toolCallId: "a/1", result: { content: [{ type: "text", text: "x".repeat(INLINE_PAYLOAD_BYTES + 1) }] } };
    assert.equal(saveDisplayPayload(data, file), data);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("oversized nested output is stored losslessly outside JSONL and replayed in full", () => {
  const directory = mkdtempSync(join(tmpdir(), "compact-journal-"));
  try {
    const output = "中文完整输出\n".repeat(INLINE_PAYLOAD_BYTES);
    const receipt = nestedResultReceipt({ toolCallId: "a/1", parentToolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: output }], details: { line: 1 } } });
    const saved = saveDisplayPayload(receipt, directory);
    assert.ok(JSON.stringify(saved).length < 1000);
    assert.deepEqual(loadDisplayPayload(saved), receipt);
    const store = new ActivityStore();
    store.restore([
      { type: "message", message: { role: "user", content: "request" } },
      { type: "message", message: { role: "assistant", timestamp: 1, stopReason: "toolUse", content: [{ type: "toolCall", id: "a", name: "codemode", arguments: {} }] } },
      { type: "custom", customType: "compact-thinking.tool-start", data: { toolCallId: "a", toolName: "codemode" } },
      { type: "custom", customType: "compact-thinking.tool-start", data: { toolCallId: "a/1", toolName: "read", parentToolCallId: "a", args: { path: "large" } } },
      { type: "custom", customType: "compact-thinking.nested", data: saved },
    ]);
    assert.equal(store.calls.get("a/1").result.content[0].text, output);
    rmSync(saved.displayPayload.path);
    const unavailable = loadDisplayPayload(saved);
    assert.equal(unavailable.toolCallId, "a/1");
    assert.match(unavailable.result.content[0].text, /missing or damaged/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("sidecars are found relative to the session directory after the session folder moves", () => {
  const root = mkdtempSync(join(tmpdir(), "mindfold-move-"));
  try {
    const before = join(root, "before");
    const after = join(root, "after");
    const receipt = nestedResultReceipt({ toolCallId: "a/1", parentToolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "x".repeat(INLINE_PAYLOAD_BYTES + 1) }], details: {} } });
    const saved = saveDisplayPayload(receipt, before);
    renameSync(before, after);
    assert.match(loadDisplayPayload(saved).result.content[0].text, /missing or damaged/);
    assert.deepEqual(loadDisplayPayload(saved, after), receipt);
    const store = new ActivityStore();
    store.restore([
      { type: "message", message: { role: "user", content: "request" } },
      { type: "message", message: { role: "assistant", timestamp: 1, stopReason: "toolUse", content: [{ type: "toolCall", id: "a", name: "codemode", arguments: {} }] } },
      { type: "custom", customType: "mindfold.tool-start", data: { toolCallId: "a", toolName: "codemode" } },
      { type: "custom", customType: "mindfold.tool-start", data: { toolCallId: "a/1", toolName: "read", parentToolCallId: "a", args: { path: "large" } } },
      { type: "custom", customType: "mindfold.nested", data: saved },
    ], after);
    assert.equal(store.calls.get("a/1").result.content[0].text, receipt.result.content[0].text);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
