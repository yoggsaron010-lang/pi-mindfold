# pi-mindfold

收起冗长的思考与工具记录，直接找到你需要的回答。

[![npm version](https://img.shields.io/npm/v/pi-mindfold.svg)](https://www.npmjs.com/package/pi-mindfold)
[![Pi compatibility](https://img.shields.io/badge/Pi-1.0.0%20%7C%201.3.0-blue.svg)](./COMPATIBILITY.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

[English](./README.md) · [功能](#功能) · [安装与运行](#安装与运行) · [操作速查](#操作速查)

Mindfold 是 [Pi Coding Agent](https://github.com/earendil-works/pi) 的对话展示插件。它将长思考和连续工具输出折叠为当前活动，显示这一步的执行目的，让回答正文更容易阅读。对话变长后，还可以通过 **Turns 轮次目录**，按请求目的找到以前的回答。

## 看看实际效果

### Collapse：只关注当前活动

思考标签与工具卡片随执行进度相互替换，之前的活动自动收起，助手正文保持可见。

<p align="center">
  <img src="./assets/demo-collapse.gif" alt="Collapse 演示：思考与工具卡片依次替换，最终回答正文保持可见" width="960">
</p>

### Turns：按请求目的找回回答

打开 **Turn History**，选择一条请求摘要，直接跳到对应轮次的回答。

<p align="center">
  <img src="./assets/demo-turns.gif" alt="Turns 演示：展开请求目录，在三个历史轮次的正文之间跳转" width="960">
</p>

## 功能

- **单一活动焦点**：显示当前思考或最新开始的工具，以及一句简短的执行目的。
- **正文清晰可读**：收起之前的思考与工具卡片，保留助手回答。
- **按需展开完整记录**：查看本轮实际收到的思考、工具结果和嵌套工具调用。
- **展开即看输出**：默认定位本轮末尾，点击 `↑` 回到思考或工具开始处。
- **请求目录**：按用户目的浏览历史轮次，直接跳到对应回答。
- **自动切换意图语言**：中文输入使用中文意图，其他语言输入使用英文意图。
- **会话恢复**：重载或恢复会话后，继续查看已保存的摘要与工具记录。
- **不增加模型请求**：在正常回答和工具调用中生成意图标签。

## 安装与运行

### 1. 安装插件

需要 Node.js **22.19 或更新版本**，以及可正常运行的 [Pi CLI](https://github.com/earendil-works/pi#readme)。Mindfold 已在 Pi **1.0.0** 和 **1.3.0** 上测试，面向同一进程中只有一个活动会话的 CLI 使用方式。

```sh
pi install npm:pi-mindfold
```

这会安装 **npm 上已发布的版本**。如需运行本地工作目录中的功能，改为在该目录安装：

```sh
cd pi-mindfold
pi install .
```

也可以直接安装 GitHub 版本：

```sh
pi install git:github.com/yoggsaron010-lang/pi-mindfold
```

选择一种安装来源，避免 Pi 同时加载多份 Mindfold。

### 2. 启动 Pi

```sh
pi
```

如果 Pi 已经在运行，输入 `/reload` 加载插件。若同时升级了 Pi 本身，需要退出后重新启动。继续使用你已配置好的 Pi 模型连接，Mindfold 不需要额外的 API Key。

使用鼠标按钮、Turns 目录和自动滚动定位时，需要 Pi 的 **fullscreen 模式**。如需切换，在 `~/.pi/agent/settings.json` 中设置 `"tuiMode": "fullscreen"` 后重启 Pi；Windows 上该文件位于 `%USERPROFILE%\.pi\agent\settings.json`。普通终端模式可用快捷键和命令折叠、展开，滚动由终端管理。

### 3. 发送请求

例如，在 Pi 输入：

```text
检查这个项目，并说明如何运行测试。
```

输入框上方会显示控制栏：

```text
[Collapse]  ‹ 1/3 ›  [Turns]  Ctrl+Alt+T
```

`1/3` 表示当前选中第 1 轮，共有 3 轮可浏览。一轮包含一次用户请求及完成该请求所需的工具执行过程。

## 使用方法

### 在 Collapse 模式下跟踪进度

新请求默认折叠。思考开始时显示 `Thinking`，模型提供公开的进度标签后，会更新为：

```text
Thinking — 检查测试配置
```

工具开始时，替换为工具卡片及其意图：

```text
read package.json
  ↳ 确认测试命令
```

并行工具以最新开始的一项为当前活动，较早工具晚返回时不会抢回显示位置。请求完成后移除思考占位，保留最后一个工具卡片与助手正文。

模型未提供进度标签时保持 `Thinking`；工具未提供意图时显示简短的默认说明。

### 展开记录，回看本轮开始

点击 `[Collapse]` 或按 `Ctrl+Alt+T`，展开选中轮次的记录：

```text
[Expanded] ↑  ‹ 1/3 ›  [Turns]  Ctrl+Alt+T
```

展开后定位到**该轮末尾**，方便直接阅读输出。点击 `↑` 回到最早的思考或工具开始处。再次折叠时，尽量保持正在阅读的正文位置；如果正在看思考或工具，则回到本轮末尾。输入框保留焦点。

展开能显示 Pi 实际收到的思考与工具输出。工具已截断的内容，或模型未返回的内容，无法恢复。

### 用 Turns 浏览请求目录

点击 `[Turns]` 或输入 `/mindfold turns`，目录会向上展开。每行显示轮次编号和一句用户目的摘要。

- 点击条目，或用 `↑` / `↓` 选择后按 `Enter`，跳到对应回答。
- 使用鼠标滚轮浏览，目录一次最多显示 8 条。
- `●` 标记当前选中的轮次，`Esc` 关闭目录。
- 直接打字会关闭目录并继续在输入框输入。

新轮次的摘要由模型在正常回答中生成。旧轮次或没有摘要的回答，显示用户原消息的简短预览。摘要会消耗少量输出 token，不额外调用模型。

浏览相邻轮次时，也可以点击 `‹` 或 `›`。箭头和目录条目都会跳到**该轮正文开头**，保留该轮原有的展开或折叠状态。目录只包含当前会话分支及上下文压缩后保留的轮次。

## 操作速查

| 操作 | 按钮或快捷键 | 命令 |
|---|---|---|
| 切换选中轮次的显示状态 | `[Collapse]` / `[Expanded]`、`Ctrl+Alt+T` | `/mindfold toggle` |
| 展开并查看本轮末尾 | 点击 `[Collapse]` | `/mindfold expand` |
| 折叠选中轮次 | 点击 `[Expanded]` | `/mindfold collapse` |
| 回到本轮开始 | `[Expanded]` 右侧 `↑` | `/mindfold start` |
| 跳到上一轮或下一轮正文 | `‹` / `›` | `/mindfold prev`、`/mindfold next` |
| 打开或关闭请求目录 | `[Turns]` | `/mindfold turns` |
| 查看插件状态 | — | `/mindfold status` |

单独输入 `/mindfold` 也可切换显示状态，`/compact-thinking` 是兼容别名。

## 恢复、备份与卸载

按 Pi 原有方式恢复会话，Mindfold 会恢复可用的轮次标题与已保存的工具记录。复制或备份会话文件时，**同时保留旁边的 `.mindfold/` 文件夹**，较大的工具显示记录保存在其中。

卸载时使用安装时的同一来源，随后执行 `/reload` 或重启 Pi：

```sh
pi remove npm:pi-mindfold
```

GitHub 安装使用 `pi remove git:github.com/yoggsaron010-lang/pi-mindfold`；本地安装则传入对应目录路径。已有会话记录仍保留在磁盘中。

## 文档与贡献

详见[兼容性说明](./COMPATIBILITY.md)、[验证记录](./VERIFICATION.md)和 [Pi 文档](https://github.com/earendil-works/pi#readme)。遇到问题可提交 [GitHub Issue](https://github.com/yoggsaron010-lang/pi-mindfold/issues)，也欢迎通过 Pull Request 改进项目。

验证本地修改时，需要 Node.js 22.19+ 和已安装的 Pi：

```sh
npm test
npm run check
```

测试会自动查找 Pi 的 managed 安装。使用其他安装布局时，先将 `COMPACT_PI_ROOT` 设置为本机 `@earendil-works/pi-coding-agent` 包所在目录，再运行 `npm test`。

## 致谢与许可

感谢 [@Nyarlathoteppppp](https://github.com/Nyarlathoteppppp) 及 [pi-tool-explain](https://github.com/Nyarlathoteppppp/pi-tool-explain) 提供 Mindfold 使用的意图与展示代码。上游工作还包括 [MasuRii 的 pi-tool-display](https://github.com/MasuRii) 和 [Mert Deveci 的 pi-tool-display-summary](https://github.com/mertdeveci5)，完整许可说明见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

本项目采用 [MIT License](./LICENSE)。
