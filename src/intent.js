import { getDisplaySummary, hasDisplaySummaryParameter, normalizeDisplaySummary, withDisplaySummary } from "../vendor/pi-tool-explain/display-summary.js";
import { messages, resolveLanguage } from "./locale.js";

export function fallbackIntent(name, language = resolveLanguage()) {
  const text = messages(language);
  return text.toolLabels[name] ?? text.runTool(name);
}

/** Reuse upstream schema, sanitization, preparation and execute wrappers. */
export class IntentDecorator {
  originals = new Map();
  skipped = new Set();
  constructor({ language = resolveLanguage() } = {}) { this.language = language; }

  decorate(tool) {
    if (!tool || this.originals.has(tool) || typeof tool.execute !== "function") return tool;
    // Grammar tools can only have one required string input. Pi's MCP extension
    // also identifies codemode by its exact schema object, so preserve both.
    if (tool.constrainedSampling?.type === "grammar") {
      if (tool.name === "codemode") {
        const before = new Map([["promptGuidelines", Object.getOwnPropertyDescriptor(tool, "promptGuidelines")]]);
        tool.promptGuidelines = [...(tool.promptGuidelines ?? []), messages(this.language).codemodeGuideline];
        this.originals.set(tool, { before, after: new Map([["promptGuidelines", tool.promptGuidelines]]) });
      } else this.skipped.add(tool.name);
      return tool;
    }
    // A pre-existing field belongs to that tool; never silently strip its semantics.
    if (hasDisplaySummaryParameter(tool.parameters)) { this.skipped.add(tool.name); return tool; }
    if (!tool.parameters || (tool.parameters.type && tool.parameters.type !== "object") || tool.parameters.anyOf || tool.parameters.oneOf || tool.parameters.allOf) {
      this.skipped.add(tool.name);
      return tool;
    }
    const wrapped = withDisplaySummary(tool, {
      language: this.language, required: true, maxLength: 96,
      fallback: () => fallbackIntent(tool.name, this.language),
    });
    const keys = ["parameters", "promptGuidelines", "prepareArguments", "execute", "renderCall"];
    const before = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(tool, key)]));
    for (const key of keys) if (key in wrapped) tool[key] = wrapped[key];
    this.originals.set(tool, { before, after: new Map(keys.map((key) => [key, tool[key]])) });
    return tool;
  }

  restore() {
    for (const [tool, { before, after }] of this.originals) {
      for (const [key, descriptor] of before) {
        if (tool[key] !== after.get(key)) continue;
        if (descriptor) Object.defineProperty(tool, key, descriptor);
        else delete tool[key];
      }
    }
    this.originals.clear();
    this.skipped.clear();
  }
}

export function intentFor(args, name, language = resolveLanguage()) {
  const summary = getDisplaySummary(args);
  if (summary) return summary;
  if (name === "codemode" && typeof args?.code === "string") {
    // Only accept the leading intent comment, never an arbitrary string inside code.
    const match = /^\s*(?:\/\/\s*@options:[^\r\n]*\r?\n)?\s*\/\/\s*(?:意图[：:]|intent:)\s*([^\r\n]+)/iu.exec(args.code);
    const intent = normalizeDisplaySummary(match?.[1]);
    if (intent) return intent;
  }
  return fallbackIntent(name, language);
}
