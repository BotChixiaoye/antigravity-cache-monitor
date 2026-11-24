# Cache Hit Monitor for Antigravity

简体中文 | [English](./README.en.md)

这是一个**很简单、很克制的小工具**，只做一件事：在 **Google Antigravity** 右侧边栏实时看清真实的 **Prompt Cache 缓存命中率**、**上下文窗口水位**和**上下文压缩（`CHECKPOINT`）情况**。

- **纯本地、不存在数据泄漏风险**：代码里**零网络请求**、无遥测上报、无需 API Key，只读本机 Antigravity 日志，绝不上传任何对话内容，也不会往模型上下文里塞任何消息。
- **轻量、克制、敢装**：运行时仅依赖 1 个包（`@modelcontextprotocol/sdk`），核心代码只有几百行，花几分钟就能通读源码，放心装在本地。
- **对 macOS 友好**：在 **macOS** 上原生开发并实测通过，开箱即用（Linux 同理；Windows 需确保 `python3` 在 `PATH` 中）。
- **顺便也是个不错的插件范例**：完整演示了 Antigravity `aux_pane` 右侧边栏 MCP App + `app-only` 轮询工具 + 静默 `PostInvocation` Hook 的组合实现。

<!-- 可选：后续可补充右侧面板截图，例如 ![Cache Monitor](./assets/screenshot.png) -->

## 核心原则与功能

- **零上下文侵入、不破坏缓存**：独立挂载于 Antigravity 右侧边栏（`+` -> `Cache Monitor`）；数据轮询走对模型不可见的 `app-only` MCP 工具，后台静默 `PostInvocation` Hook 仅在本地记录当前活跃会话路径并恒返回 `{}`，不额外消耗任何模型 token。
- **100% 真实日志数据**：直接解析本地 `transcript_full.jsonl` 中的服务端真实字段（`input_tokens`、`cache_read_tokens`、`output_tokens`、`model`、`created_at`、`tool_calls`、`CHECKPOINT`），不做字符估算，不做粗略归因，不虚构累计节省数字。
- **严谨上下文水位**：仅对已核实官方上限的 Gemini 系列模型显示进度条与百分比（`Gemini 4 Neon` 为 `512k`，`Carbon/Argon/Hydrogen` 与 `Gemini 3/2.5` 为 `1M`），默认在 `75%` 高水位时提示压缩；其它模型仅展示真实绝对 token 数，不猜测分母。
- **原生适配上下文压缩**：同时支持手动 `/compact`（独立压缩轮）与任务中途自动触发的 `CHECKPOINT` 压缩（嵌在对应步骤中）；既保留压缩摘要调用本身的真实缓存命中率，也在压缩后下一次调用返回时准确回填 `压缩前 → 压缩后` 的真实 token 变化（未发下一句前标注待更新，不估算）。
- **紧凑轮次明细**：自动跟随当前活跃会话，展示最近 10 轮对话；点击任意一轮可展开查看每一步的工具动作、命中率、命中/总输入比与时间戳。

## 环境要求

- [Google Antigravity](https://antigravity.google)（支持 MCP App 侧边栏的桌面端 / IDE）
- Node.js 18+
- Python 3（供静默 `PostInvocation` Hook 使用）

## 安装方法

1. 将仓库克隆到 Antigravity 的全局插件目录：

```bash
git clone https://github.com/BotChixiaoye/antigravity-cache-monitor.git ~/.gemini/config/plugins/cache-hit-monitor
cd ~/.gemini/config/plugins/cache-hit-monitor
```

2. 安装运行时依赖（仅 `@modelcontextprotocol/sdk` 一个依赖）：

```bash
npm install --omit=dev
```

*（仓库已内置预构建的 `ui/app.html`。如果你修改了 `ui-src/`，可执行 `npm install && npm run build:ui` 重新构建。）*

3. 在 Antigravity 中重载插件（或重启 Antigravity）。
4. 点击右侧边栏 `+` -> **Cache Monitor** 即可打开；面板每 2.5 秒自动轮询本地日志并跟随当前会话。

## 自定义配置

编辑 [`config.json`](./config.json) 即可修改模型上下文上限或提醒阈值：

```json
{
  "geminiContextWindows": [
    { "prefix": "gemini-4-neon", "limit": 512000 },
    { "prefix": "gemini-4-carbon", "limit": 1000000 },
    { "prefix": "gemini-4-argon", "limit": 1000000 },
    { "prefix": "gemini-4-hydrogen", "limit": 1000000 },
    { "prefix": "gemini-3", "limit": 1000000 },
    { "prefix": "gemini-2.5", "limit": 1000000 }
  ],
  "cacheDropThreshold": 0.5,
  "cacheExpiryGapSeconds": 300,
  "contextWarnRatio": 0.75
}
```

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `geminiContextWindows` | Gemini 系列模型前缀匹配与上下文上限（tokens） | 见上表 |
| `cacheDropThreshold` | 单轮缓存命中率低于该阈值时，展示客观降级事实标签 | `0.5` |
| `cacheExpiryGapSeconds` | 缓存骤降时，若距上次调用间隔超过该秒数则标注间隔时长 | `300` |
| `contextWarnRatio` | 上下文水位警戒比例，达到后提示运行 `/compact` | `0.75` |

## 工作原理

```text
Antigravity ──(PostInvocation hook)──▶ scripts/track_active.py ──▶ ${PLUGIN_DATA}/active.json
                                                                           │
Antigravity 右侧边栏 (ui/app.html) ◀──(app-only MCP 轮询)──▶ server/index.mjs ──▶ transcript_full.jsonl
```

- **纯本地运行**：无联网请求、无遥测上报、无需任何 API Key。
- **兼容性说明**：本插件依赖当前版本 Antigravity 的本地 `transcript_full.jsonl` 日志结构（`USER_INPUT`、`PLANNER_RESPONSE`、`CHECKPOINT`）。若后续官方调整本地日志字段格式，需同步适配 `server/index.mjs`。

## 本地开发与构建

```bash
npm install
npm run build:ui
```

修改 `server/index.mjs` 或重新构建 `ui/app.html` 后，在 Antigravity 中重载该 MCP 服务并重新打开 **Cache Monitor** 面板即可生效。

## 开源协议

[MIT](./LICENSE)
