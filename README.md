# pi-mindfold

[简体中文](./README.zh-CN.md)

> A sleek, intent-aware interaction plugin for [Pi Coding Agent](https://github.com/earendil-works/pi) (tested on Pi 1.0.0 and 1.3.0).  
> Collapses lengthy reasoning streams and stacked tool outputs into a **single active focus**, displays model-written intent in real-time, and provides one-click lossless expansion for full execution history.

[![npm version](https://img.shields.io/npm/v/pi-mindfold.svg)](https://www.npmjs.com/package/pi-mindfold)
[![Pi Compatibility](https://img.shields.io/badge/pi-1.0.0%20--%201.3.0-success.svg)](COMPATIBILITY.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The Problem

When using coding agents with deep reasoning models:
1. **Endless Thinking Scrolls**: Reasoning chains can span dozens or hundreds of lines, repeatedly pushing conversational context off-screen.
2. **Tool Output Stacking**: Sequential calls to `ls`, `read`, `grep`, and `edit` stack raw execution blocks vertically, burying the final assistant reply.
3. **Black-box Tool Execution**: Native collapsed tool displays show only raw commands and truncated output, providing no immediate clarity on *why* a tool is being invoked.

---

## Key Features

- **Single Active Focus (Default Collapsed Mode)**
  - **Thinking Phase**: Hidden thoughts are collapsed into a clean italic label:
    - Initial state: `Thinking`
    - When the model emits a public progress line: `Thinking — 核对重载恢复逻辑` (updated dynamically; see [Intent language](#intent-language)).
  - **Tool Phase**: Immediately replaces the thinking placeholder with the active tool card and its human-readable intent:
    ```text
    read src/index.ts
      ↳ 检查模块导出与路由声明
    ```
  - **Parallel Concurrency**: Tracks execution order by actual start time. Late-finishing sibling calls never revert or scramble the current active display.
  - **Clean Finalization**: Automatically removes the `Thinking` placeholder upon reply completion. If tools were run, the last tool card and its intent remain pinned without cluttering the chat; otherwise, no empty placeholder is left behind.
  - **Pristine Markdown Output**: Assistant markdown text always remains visible in the main chat viewport.

- **One-Click Lossless Expansion (`[Expanded]` Mode)**
  - A responsive toggle button is pinned directly above the input editor:
    ```text
    [Collapse]  ‹ 2/2 ›  Ctrl+Alt+T
    > 
    ```
  - Clicking the button or pressing `Ctrl+Alt+T` restores the complete chronological timeline: all raw reasoning blocks, every tool invocation, full tool outputs, and child `codemode` executions.
  - **Viewport & Focus Preservation**: In Pi's fullscreen TUI, toggling expansion anchors your scroll position to the current dialogue header without stealing text input focus.

- **Zero-Extra-Inference Intent Engine**
  - Adapts the `displaySummary` convention from [pi-tool-explain](https://github.com/Nyarlathoteppppp/pi-tool-explain). The current model writes intent directly inside its normal tool call payload.
  - **No secondary model calls, no separate API keys, and no added latency.**
  - Strips intent fields before forwarding parameters to actual tool implementations, preserving clean argument semantics.
  - Preserves native OpenAI Grammar Constrained Sampling and host tool-reachability contracts for `codemode`, extracting top-level intent from a leading `// 意图：...` (or `// Intent: ...`) source comment.

- **Session Persistence & Large-Payload Sidecar**
  - Session `/reload`, `/resume`, and `/fork` seamlessly restore intents and nested tool hierarchies.
  - Outputs exceeding 64 KB are automatically saved to a content-addressed `.mindfold/` sidecar folder inside the session directory, with SHA-256 integrity verification, keeping `.jsonl` session files lightweight and fast. Keep `.mindfold/` together with the session files when backing up or moving sessions.

### Intent language

Intents default to **Simplified Chinese** (`zh-CN`). To get English intents, set `PI_MINDFOLD_LANG=en` in the environment **before starting Pi**:

```bash
# macOS / Linux (add to ~/.zshrc or ~/.bashrc to keep it)
export PI_MINDFOLD_LANG=en
pi
```

```powershell
# Windows PowerShell (use `setx PI_MINDFOLD_LANG en` to keep it)
$env:PI_MINDFOLD_LANG = "en"
pi
```

| | `zh-CN` (default) | `en` |
|---|---|---|
| Tool `displaySummary` | `检查模块导出与路由声明` | `Inspect module exports and route declarations` |
| Public progress line | `活动意图：核对重载恢复逻辑` | `Activity intent: Verify reload recovery logic` |
| codemode comment | `// 意图：批量检查入口文件` | `// Intent: Batch check entry files` |
| Fallback when the model omits an intent | `读取文件` | `Read file` |
| `/mindfold status`, command and shortcut descriptions | Chinese | English |

`en`, `en-US`, `en_GB` and similar values select English; any other value keeps `zh-CN`. The language is read once when the extension loads, so restart Pi after changing it (`/reload` keeps the old process environment). Intents already recorded in a session stay in the language they were written in. Both `// 意图：` and `// Intent:` codemode comments are recognised in either mode. See [README.zh-CN.md](./README.zh-CN.md) for Chinese documentation.

---

## Visual Comparison

### Collapsed Mode (Default)

> *In collapsed mode, prior reasoning and previous tool runs are folded into a single active focus. Only the latest invoked tool card and its real-time intent are displayed above the prompt.*

<p align="center">
  <img src="./assets/demo-collapsed.png" alt="Collapsed Mode - Single Active Focus" width="850" />
</p>

### Expanded Mode (After toggle)

> *Clicking `[Collapse]` (or pressing `Ctrl+Alt+T`) restores the entire chronological execution history: all raw thinking steps, sequential tool invocations, and full terminal outputs.*

<p align="center">
  <img src="./assets/demo-expanded.png" alt="Expanded Mode - Full Historical Replay" width="850" />
</p>

---

## Installation

### From npm

```bash
pi install npm:pi-mindfold
```

### From GitHub Repository

```bash
pi install git:github.com/yoggsaron010-lang/pi-mindfold
```

Then reload Pi:

```text
/reload
```

*(Or restart Pi if you recently upgraded the host Pi binary).*

### Local Installation

Clone this repository and install from the local directory:

```bash
git clone https://github.com/yoggsaron010-lang/pi-mindfold.git
cd pi-mindfold
pi install .
```

To remove, pass the same source you installed from:

```bash
pi remove npm:pi-mindfold
# or: pi remove git:github.com/yoggsaron010-lang/pi-mindfold
# or: pi remove /absolute/path/to/pi-mindfold
```

---

## Controls & Usage

| Trigger | Action |
|---|---|
| Click `[Collapse]` / `[Expanded]` | Toggle collapsed/expanded state for the selected dialogue |
| `Ctrl+Alt+T` | Keyboard shortcut to toggle state (works in both fullscreen and regular modes) |
| Click `‹` / `›` | Navigate to previous / next dialogue turns |
| `/mindfold` or `/mindfold toggle` | Slash command to toggle current turn |
| `/mindfold expand` | Expand current turn history |
| `/mindfold collapse` | Collapse current turn to active item |
| `/mindfold prev` / `/mindfold next` | Switch selected dialogue turn |
| `/mindfold status` | Inspect decorated tools, turn count, and schemas retaining original parameters |

> **Note on Command Names**: Pi provides a built-in `/compact` command for manual context summarization. This plugin registers as `/mindfold` (with `/compact-thinking` retained as an alias) to avoid collisions.

---

## Supported Tools

The intent engine automatically intercepts and decorates tools defining standard object parameter schemas:

- **Built-in Tools**: `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`
- **Shell & Scripting**: `nushell` / `nu`, `codemode` (supports leading intent comments and nested child tools)
- **Web & Search**: `web_search`, `google_search`, `fetch_content`, `get_search_content`, `source_check`
- **Task & Media**: `todo`, `generate_image`, `image_generate`
- **Custom & MCP Tools**: All registered MCP servers and SDK-defined tools

Tools that already define their own `displaySummary` or use non-object parameter schemas retain their exact original contracts.

---

## Compatibility & Verification

Tested and validated on Windows and POSIX environments against official Pi distributions:

| Host Version | Automated Suite | Interactive TUI | Notes |
|---|---|---|---|
| **Pi 1.3.0** | **All passed** | Fullscreen mouse + focus verified | Active official release; supports `reachesTools` |
| **Pi 1.0.0** | **All passed** | Fullscreen mouse + focus verified | Backward compatible |

The tests import the real Pi host modules instead of a second copy. They locate Pi's managed install (`~/.pi/agent/install/current-version`) automatically; for a global npm or Homebrew install, point `COMPACT_PI_ROOT` at the `@earendil-works/pi-coding-agent` package directory:

```bash
COMPACT_PI_ROOT="$(npm root -g)/@earendil-works/pi-coding-agent" npm test
npm run check
```

Detailed test evidence and lifecycle benchmarks are documented in [COMPATIBILITY.md](./COMPATIBILITY.md) and [VERIFICATION.md](./VERIFICATION.md).

### Known limitations

- One active Pi session per process. Running several SDK `AgentSession`s concurrently in one process is not supported.
- Sessions recorded before start receipts existed (pre-0.1.1) cannot reconstruct the exact start order of parallel tool calls; they still load.

---

## Contributors & Third-Party Attributions

- Special thanks to [@Nyarlathoteppppp](https://github.com/Nyarlathoteppppp) for the original [pi-tool-explain](https://github.com/Nyarlathoteppppp/pi-tool-explain) intent and display mechanics.
- Upstream contributors: [MasuRii](https://github.com/MasuRii) (`pi-tool-display`) and [Mert Deveci](https://github.com/mertdeveci5) (`pi-tool-display-summary`).

All vendored licenses and attribution notices are strictly preserved under `vendor/pi-tool-explain/` and [THIRD_PARTY.md](./THIRD_PARTY.md).

This project is licensed under the [MIT License](./LICENSE).
