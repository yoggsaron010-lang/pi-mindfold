import { AgentSession } from "@earendil-works/pi-coding-agent";

const OWNER = Symbol.for("pi-mindfold.registry.v1");

/** Pi 1.0 has no public cross-extension tool decorator. Patch only the registry
 * rebuild boundary so original owners, exposure, settings and renderers survive. */
export function installRegistryBridge(decorator, onRegistry) {
  const prototype = AgentSession.prototype;
  prototype[OWNER]?.dispose();
  const original = prototype._refreshToolRegistry;
  if (typeof original !== "function") throw new Error("pi-mindfold requires Pi 1.0's tool registry adapter.");
  let enabled = true;
  let session;
  const patched = function (...args) {
    session = this;
    if (enabled) {
      for (const tool of this._baseToolDefinitions?.values() ?? []) decorator.decorate(tool);
      for (const tool of this._customTools ?? []) decorator.decorate(tool);
      for (const tool of this._extensionRunner?.getAllRegisteredTools() ?? []) decorator.decorate(tool.definition);
    }
    const result = original.apply(this, args);
    if (enabled) onRegistry(this._toolDefinitions);
    return result;
  };
  const state = {
    refresh() { if (enabled) session?._refreshToolRegistry(); },
    dispose() {
      if (!enabled) return;
      enabled = false;
      session = undefined;
      decorator.restore();
      if (prototype._refreshToolRegistry === patched) prototype._refreshToolRegistry = original;
      if (prototype[OWNER] === state) delete prototype[OWNER];
    },
  };
  prototype._refreshToolRegistry = patched;
  prototype[OWNER] = state;
  return state;
}
