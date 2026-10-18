import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { messages, resolveLanguage } from "./locale.js";

export const INLINE_PAYLOAD_BYTES = 64 * 1024;
export const SIDECAR_DIR = ".mindfold";
export const LEGACY_SIDECAR_DIR = ".compact-thinking";

function digest(text) { return createHash("sha256").update(text).digest("hex"); }

/** Store display data only. Large payloads go to a content-addressed sidecar,
 * retaining full output without repeating structuredContent in session JSONL. */
export function saveDisplayPayload(data, directory) {
  const json = JSON.stringify(data);
  if (!directory || Buffer.byteLength(json) <= INLINE_PAYLOAD_BYTES) return data;
  const hash = digest(json);
  const storage = join(directory, SIDECAR_DIR);
  try {
    mkdirSync(storage, { recursive: true });
    const path = join(storage, `${hash}.json`);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, json, "utf8");
    renameSync(temporary, path);
    return { phase: data.phase, toolCallId: data.toolCallId, parentToolCallId: data.parentToolCallId, toolName: data.toolName,
      displayPayload: { path, sha256: hash } };
  } catch {
    // Display persistence must not break a tool. Keep the full inline data when
    // a sidecar directory is read-only or unavailable.
    return data;
  }
}

/** Sidecars are content-addressed, so the session directory plus the hash locates
 * them even after the session folder is moved. The recorded absolute path is a
 * last resort for records written before the session directory was known. */
function sidecarCandidates(payload, directory) {
  const name = `${payload.sha256}.json`;
  const local = directory ? [join(directory, SIDECAR_DIR, name), join(directory, LEGACY_SIDECAR_DIR, name)] : [];
  return [...new Set([...local, payload.path].filter((path) => typeof path === "string"))];
}

export function loadDisplayPayload(data, directory, language = resolveLanguage()) {
  if (!data?.displayPayload) return data;
  try {
    for (const path of sidecarCandidates(data.displayPayload, directory)) {
      let json;
      try { json = readFileSync(path, "utf8"); } catch { continue; }
      if (digest(json) === data.displayPayload.sha256) return JSON.parse(json);
    }
    throw new Error("display payload is missing or fails its checksum");
  } catch {
    return { ...data, missingDisplayPayload: true,
      args: { displaySummary: messages(language).missingPayloadIntent },
      result: { content: [{ type: "text", text: "Saved display data is missing or damaged. Restore the session's .mindfold sidecar directory." }] }, isError: true };
  }
}

export function toolStartReceipt(event) {
  return {
    toolCallId: event.toolCallId, toolName: event.toolName,
    ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId, args: event.args } : {}),
  };
}

export function nestedResultReceipt(event) {
  return {
    phase: "end", toolCallId: event.toolCallId, parentToolCallId: event.parentToolCallId,
    toolName: event.toolName, isError: event.isError === true,
    result: event.result ? { content: event.result.content, details: event.result.details } : undefined,
  };
}
