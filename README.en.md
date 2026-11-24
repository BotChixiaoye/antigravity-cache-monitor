# Cache Hit Monitor for Antigravity

[简体中文](./README.md) | English

A **simple, focused little tool** for **Google Antigravity** — it does one thing in the right side pane: shows your real **Prompt Cache hit rate**, **context window usage**, and **compaction (`CHECKPOINT`) status**.

- **Zero data leakage / 100% local**: Makes **zero network requests**, collects no telemetry, requires no API keys, and never uploads or injects your conversation data anywhere.
- **Lightweight, restrained, easy to audit**: Just 1 runtime dependency (`@modelcontextprotocol/sdk`) and a few hundred lines of readable code you can review in minutes.
- **macOS-friendly**: Built and tested natively on **macOS** out of the box (also works on Linux; on Windows, ensure `python3` is available in `PATH`).
- **A practical plugin starter example**: Cleanly demonstrates how to combine an Antigravity `aux_pane` MCP App, an `app-only` polling tool, and a silent `PostInvocation` hook.

> Note: The side-pane UI labels are currently in Simplified Chinese.

<!-- Optional: add a screenshot later, e.g. ![Cache Monitor](./assets/screenshot.png) -->

## Key Features & Principles

- **Zero Context Intrusion & Zero Cache Busting**: Runs in Antigravity's right side pane (`aux_pane` -> `Cache Monitor`). Data polling uses an `app-only` MCP tool invisible to the model, and the background `PostInvocation` hook only records the active transcript path locally and always returns `{}`.
- **100% Ground-Truth Metrics**: Reads server-reported fields directly from local `transcript_full.jsonl` (`input_tokens`, `cache_read_tokens`, `output_tokens`, `model`, `created_at`, `tool_calls`, `CHECKPOINT`). No character-based token estimation, no rough composition attribution, and no synthetic counters.
- **Honest Context Limits**: Displays context bar & percentage only for verified Gemini model limits (`gemini-4-neon*`: `512k`; `gemini-4-carbon/argon/hydrogen`, `gemini-3*`, `gemini-2.5*`: `1M`), warning at `75%`. For all other models, displays the exact absolute token count only.
- **Compaction-Aware**: Recognizes both standalone `/compact` turns and mid-turn automatic `CHECKPOINT` compactions—preserving the compaction call's real cache hit rate and displaying the exact `before → after` context drop once the next model response arrives (never estimated beforehand).
- **Compact Grouped Timeline**: Shows the latest 10 turns auto-following the active conversation; click any turn to expand step-by-step tool actions, cache hit rates, token ratios, and timestamps.

## Requirements

- [Google Antigravity](https://antigravity.google) (desktop app / IDE with MCP App side-pane support)
- Node.js 18+
- Python 3 (used by the silent `PostInvocation` hook)

## Installation

1. Clone this repository into Antigravity's global plugins directory:

```bash
git clone https://github.com/BotChixiaoye/antigravity-cache-monitor.git ~/.gemini/config/plugins/cache-hit-monitor
cd ~/.gemini/config/plugins/cache-hit-monitor
```

2. Install the runtime dependency (`@modelcontextprotocol/sdk`):

```bash
npm install --omit=dev
```

*(A prebuilt `ui/app.html` bundle is included. If you modify `ui-src/`, install dev dependencies and rebuild with `npm install && npm run build:ui`.)*

3. Enable/reload plugins in Antigravity (or restart Antigravity).
4. Open the right side pane (`+` -> **Cache Monitor**). It polls local logs every 2.5s and automatically follows your active conversation.

## Configuration

Edit [`config.json`](./config.json) to adjust model limits or alert thresholds:

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

| Field | Description | Default |
| --- | --- | --- |
| `geminiContextWindows` | Prefix-matched context window limits (tokens) for Gemini models | See above |
| `cacheDropThreshold` | Turn hit rate below which drop-fact badges are highlighted | `0.5` |
| `cacheExpiryGapSeconds` | Idle gap (seconds) surfaced as an objective fact on cache drop | `300` |
| `contextWarnRatio` | Context window ratio that triggers the high-waterline `/compact` hint | `0.75` |

## How It Works

```text
Antigravity ──(PostInvocation hook)──▶ scripts/track_active.py ──▶ ${PLUGIN_DATA}/active.json
                                                                           │
Antigravity Side Pane (ui/app.html) ◀──(app-only MCP poll)──▶ server/index.mjs ──▶ transcript_full.jsonl
```

- **Local-only**: No network calls, no telemetry, no external API keys.
- **Compatibility note**: This plugin parses Antigravity's local `transcript_full.jsonl` schema (`USER_INPUT`, `PLANNER_RESPONSE`, `CHECKPOINT`). If a future Antigravity release changes local transcript fields, `server/index.mjs` may need an update.

## Development

```bash
npm install
npm run build:ui
```

After changing `server/index.mjs` or rebuilding `ui/app.html`, reload the MCP server / reopen the **Cache Monitor** pane in Antigravity.

## License

[MIT](./LICENSE)
