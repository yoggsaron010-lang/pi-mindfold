export const DEFAULT_LANGUAGE = "zh-CN";
export const LANGUAGE_ENV = "PI_MINDFOLD_LANG";

/** Explicit environment settings override automatic selection for each request. */
export function resolveLanguageMode(value = process.env[LANGUAGE_ENV]) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/^en(?:[-_]|$)/u.test(normalized)) return "en";
  if (/^zh(?:[-_]|$)/u.test(normalized)) return "zh-CN";
  return "auto";
}

export function requestLanguage(prompt, mode = "auto", previous = DEFAULT_LANGUAGE) {
  if (mode !== "auto") return mode;
  if (typeof prompt !== "string" || !prompt.trim()) return previous;
  // Kana and Hangul distinguish common Japanese/Korean text that also uses Han.
  const chinese = /\p{Script=Han}/u.test(prompt) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(prompt);
  return chinese ? "zh-CN" : "en";
}

/** Initial UI language before a user request selects the automatic language. */
export function resolveLanguage(value = process.env[LANGUAGE_ENV]) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "en" || normalized.startsWith("en-") || normalized.startsWith("en_")) return "en";
  return DEFAULT_LANGUAGE;
}

const zh = {
  toolLabels: {
    read: "读取文件", edit: "更新文件", write: "写入文件", grep: "搜索文件内容", find: "查找匹配文件", ls: "列出目录内容",
    bash: "执行命令", powershell: "执行 PowerShell 命令", nu: "执行 Nushell 命令", nushell: "执行 Nushell 命令",
    codemode: "执行批量工具脚本", web_search: "搜索网页资料", google_search: "检索最新资料", fetch_content: "读取网页内容",
    get_search_content: "读取检索结果", source_check: "核查资料来源", mcp: "调用外部工具", todo: "更新任务进度",
  },
  runTool: (name) => `运行 ${name}`,
  codemodeGuideline: 'Start every codemode script with "// 意图：简短中文目的" (after an optional // @options: line). Describe why the script is needed in Simplified Chinese; never include secrets. Nested tools whose schema defines displaySummary must still include it.',
  activityGuideline: 'When providing a brief public progress update for a work phase, start that assistant text with its own plain-text line "活动意图：简短中文目的". Use Simplified Chinese, at most 96 characters, and no secrets. This is a public activity description, not reasoning or a request to disclose hidden thought. Provide at most one such line per phase when you can; do not prepend it to a final-only answer or replace the requested answer with a status line. The UI can show Thinking until a public description arrives.',
  missingPayloadIntent: "原始显示数据不可用",
  dialogue: (id) => `对话 ${id}`,
  shortcut: "展开或折叠当前对话的思考与工具记录",
  command: "思考与工具显示：toggle / expand / collapse / prev / next / turns / start / status",
  alias: "思考与工具显示（/mindfold 别名）：toggle / expand / collapse / prev / next / turns / start / status",
  usage: "用法：/mindfold [toggle|expand|collapse|prev|next|turns|start|status]",
  status: (groups, tools, skipped) => `Mindfold：${groups} 次对话，${tools} 个工具已启用中文意图${skipped.length ? `；保留原参数约定：${skipped.join(", ")}` : ""}`,
};

const en = {
  toolLabels: {
    read: "Read file", edit: "Update file", write: "Write file", grep: "Search file contents", find: "Find matching files", ls: "List directory",
    bash: "Run command", powershell: "Run PowerShell command", nu: "Run Nushell command", nushell: "Run Nushell command",
    codemode: "Run batch tool script", web_search: "Search the web", google_search: "Look up current information", fetch_content: "Read web page",
    get_search_content: "Read search results", source_check: "Check sources", mcp: "Call external tool", todo: "Update task progress",
  },
  runTool: (name) => `Run ${name}`,
  codemodeGuideline: 'Start every codemode script with "// Intent: short purpose in English" (after an optional // @options: line). Describe why the script is needed in English; never include secrets. Nested tools whose schema defines displaySummary must still include it.',
  activityGuideline: 'When providing a brief public progress update for a work phase, start that assistant text with its own plain-text line "Activity intent: short purpose in English". Use English, at most 96 characters, and no secrets. This is a public activity description, not reasoning or a request to disclose hidden thought. Provide at most one such line per phase when you can; do not prepend it to a final-only answer or replace the requested answer with a status line. The UI can show Thinking until a public description arrives.',
  missingPayloadIntent: "Saved display data unavailable",
  dialogue: (id) => `Dialogue ${id}`,
  shortcut: "Expand or collapse thinking and tool history for the current dialogue",
  command: "Thinking and tool display: toggle / expand / collapse / prev / next / turns / start / status",
  alias: "Thinking and tool display (alias of /mindfold): toggle / expand / collapse / prev / next / turns / start / status",
  usage: "Usage: /mindfold [toggle|expand|collapse|prev|next|turns|start|status]",
  status: (groups, tools, skipped) => `Mindfold: ${groups} dialogue(s), ${tools} tool(s) with English intent${skipped.length ? `; original parameter contracts kept: ${skipped.join(", ")}` : ""}`,
};

export function messages(language = resolveLanguage()) { return language === "en" ? en : zh; }
