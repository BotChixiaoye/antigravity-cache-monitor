#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(PLUGIN_ROOT, "config.json");
const APP_HTML_PATH = path.join(PLUGIN_ROOT, "ui", "app.html");
const APP_URI = "ui://cache-hit-monitor/app.html";

function parseDataDir() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--data-dir=")) return arg.slice("--data-dir=".length);
    if (arg.startsWith("--data_dir=")) return arg.slice("--data_dir=".length);
  }
  return (
    process.env.PLUGIN_DATA ||
    path.join(os.homedir(), ".gemini", "antigravity", "plugin_data", "cache-hit-monitor")
  );
}

const DATA_DIR = parseDataDir();

const DEFAULT_CONFIG = {
  geminiContextWindows: [
    { prefix: "gemini-4-neon", limit: 512000 },
    { prefix: "gemini-4-carbon", limit: 1000000 },
    { prefix: "gemini-4-argon", limit: 1000000 },
    { prefix: "gemini-4-hydrogen", limit: 1000000 },
    { prefix: "gemini-3", limit: 1000000 },
    { prefix: "gemini-2.5", limit: 1000000 },
  ],
  cacheDropThreshold: 0.5,
  cacheExpiryGapSeconds: 300,
  contextWarnRatio: 0.75,
};

const TOOL_LABELS = {
  run_command: "终端",
  read_file: "读文件",
  edit_file: "编辑",
  write_file: "写文件",
  search_web: "搜索",
  search_marketplace: "搜市场",
  invoke_subagent: "子代理",
  send_message: "子代理",
  manage_task: "任务",
  call_mcp_tool: "MCP",
  update_steps: "进度",
  update_focus: "进度",
  ask_question: "提问",
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // fallback to default
  }
  return DEFAULT_CONFIG;
}

function lookupContextLimit(modelName, cfg) {
  if (!modelName) return null;
  const lowered = String(modelName).toLowerCase();
  for (const entry of cfg.geminiContextWindows || []) {
    const prefix = String(entry.prefix || "").toLowerCase();
    const limit = Number(entry.limit);
    if (prefix && lowered.startsWith(prefix) && Number.isFinite(limit) && limit > 0) {
      return limit;
    }
  }
  return null;
}

function fmtTok(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(seconds) {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)}h`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(1)}m`;
  return `${Math.round(seconds)}s`;
}

function parseTs(iso) {
  if (!iso || typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

function extractUserPrompt(content) {
  if (!content || typeof content !== "string") return "";
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  const raw = match ? match[1] : content;
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 22) return oneLine;
  return `${oneLine.slice(0, 22)}…`;
}

function summarizeAction(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return { actionLabel: "回复", isReply: true };
  }
  const names = toolCalls
    .map((t) => (t && typeof t.name === "string" ? t.name : ""))
    .filter(Boolean);
  if (names.length === 0) {
    return { actionLabel: "工具", isReply: false };
  }
  // Ignore pure UI bookkeeping tools if paired with a substantive tool
  const substantive = names.filter((n) => n !== "update_steps" && n !== "update_focus");
  const effective = substantive.length > 0 ? substantive : names;

  const mapped = effective.map((n) => TOOL_LABELS[n] || n.replace(/_/g, " "));
  const unique = [...new Set(mapped)];

  if (unique.length === 1) {
    const label = unique[0];
    return {
      actionLabel: effective.length > 1 ? `${label}×${effective.length}` : label,
      isReply: false,
    };
  }
  return {
    actionLabel: `${unique[0]}+${unique[1]}`,
    isReply: false,
  };
}

function objectiveDropFacts(curr, prev, gapThresholdSec) {
  if (!prev) return [];
  const facts = [];
  const currTs = parseTs(curr.createdAt);
  const prevTs = parseTs(prev.createdAt);
  if (currTs !== null && prevTs !== null) {
    const gap = currTs - prevTs;
    if (gap >= gapThresholdSec) facts.push(`距上次 ${fmtDuration(gap)}`);
  }
  if (curr.model && prev.model && curr.model !== prev.model) {
    facts.push("模型切换");
  }
  if (prev.isCompactionStep) {
    facts.push("上下文压缩");
  } else if (prev.totalInput > 0 && curr.totalInput < prev.totalInput * 0.85) {
    facts.push("上下文缩减");
  }
  return facts;
}

function readActiveRecord() {
  const activeFile = path.join(DATA_DIR, "active.json");
  try {
    if (fs.existsSync(activeFile)) {
      return JSON.parse(fs.readFileSync(activeFile, "utf-8"));
    }
  } catch {
    // ignore
  }
  return null;
}

function discoverConversations() {
  const roots = [
    path.join(os.homedir(), ".gemini", "antigravity", "brain"),
    path.join(os.homedir(), ".gemini", "antigravity-ide", "brain"),
    path.join(os.homedir(), ".gemini", "antigravity-cli", "brain"),
  ];
  const found = new Map();

  for (const brainDir of roots) {
    if (!fs.existsSync(brainDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(brainDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const logDir = path.join(brainDir, ent.name, ".system_generated", "logs");
      const fullPath = path.join(logDir, "transcript_full.jsonl");
      const compactPath = path.join(logDir, "transcript.jsonl");
      const chosen = fs.existsSync(fullPath)
        ? fullPath
        : fs.existsSync(compactPath)
          ? compactPath
          : null;
      if (!chosen) continue;
      try {
        const st = fs.statSync(chosen);
        const existing = found.get(ent.name);
        if (!existing || st.mtimeMs > existing.mtimeMs) {
          found.set(ent.name, {
            id: ent.name,
            transcriptPath: chosen,
            mtimeMs: st.mtimeMs,
          });
        }
      } catch {
        // ignore
      }
    }
  }

  const active = readActiveRecord();
  if (active?.conversationId && active?.transcriptPath && fs.existsSync(active.transcriptPath)) {
    try {
      const st = fs.statSync(active.transcriptPath);
      found.set(active.conversationId, {
        id: active.conversationId,
        transcriptPath: active.transcriptPath,
        mtimeMs: Math.max(st.mtimeMs, (active.updatedAt || 0) * 1000),
      });
    } catch {
      // ignore
    }
  }

  return Array.from(found.values())
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12);
}

function parseTranscript(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split(/\r?\n/);
  const planners = [];
  const turns = [];
  let currentTurn = null;
  let turnCounter = 0;
  let sawCompactionMarker = false;
  let pendingCompactionStep = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    const stepIndex = item.step_index;
    if (typeof stepIndex !== "number") continue;

    const stepTypeUpper = String(item.type || "").toUpperCase();
    const isCompactionType =
      stepTypeUpper.includes("COMPACT") ||
      stepTypeUpper.includes("CHECKPOINT") ||
      stepTypeUpper.includes("SUMMARIZ");

    if (item.type === "USER_INPUT") {
      const isExplicit =
        item.source === "USER_EXPLICIT" ||
        (typeof item.content === "string" && item.content.includes("<USER_REQUEST>"));
      if (isExplicit) {
        turnCounter += 1;
        currentTurn = {
          turnNumber: turnCounter,
          prompt: extractUserPrompt(item.content) || `第 ${turnCounter} 轮`,
          steps: [],
        };
        turns.push(currentTurn);
      }
    } else if (isCompactionType) {
      const inputTokens = Number(item.input_tokens || 0);
      const cacheReadTokens = Number(item.cache_read_tokens || 0);
      const outputTokens = Number(item.output_tokens || 0);
      if (inputTokens === 0 && cacheReadTokens === 0 && outputTokens === 0) {
        sawCompactionMarker = true;
        continue;
      }

      if (!currentTurn) {
        turnCounter += 1;
        currentTurn = {
          turnNumber: turnCounter,
          prompt: "上下文压缩",
          steps: [],
        };
        turns.push(currentTurn);
      }

      const totalInput = inputTokens + cacheReadTokens;
      const compaction = {
        fromTokens: totalInput,
        toTokens: null,
      };
      const stepObj = {
        stepIndex,
        seq: currentTurn.steps.length + 1,
        actionLabel: "压缩",
        isReply: false,
        isCompactionStep: true,
        model: String(item.model || ""),
        createdAt: item.created_at || null,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalInput,
        hitRate: totalInput > 0 ? cacheReadTokens / totalInput : 0,
        compaction,
      };
      planners.push(stepObj);
      currentTurn.steps.push(stepObj);
      pendingCompactionStep = stepObj;
      sawCompactionMarker = false;
    } else if (item.type === "PLANNER_RESPONSE") {
      const inputTokens = Number(item.input_tokens || 0);
      const cacheReadTokens = Number(item.cache_read_tokens || 0);
      const outputTokens = Number(item.output_tokens || 0);
      if (inputTokens === 0 && cacheReadTokens === 0 && outputTokens === 0) continue;

      if (!currentTurn) {
        turnCounter += 1;
        currentTurn = {
          turnNumber: turnCounter,
          prompt: `第 ${turnCounter} 轮`,
          steps: [],
        };
        turns.push(currentTurn);
      }

      const totalInput = inputTokens + cacheReadTokens;
      const prevPlanner = planners.length > 0 ? planners[planners.length - 1] : null;
      let compaction = null;
      if (pendingCompactionStep && pendingCompactionStep.compaction) {
        // Backfill the true post-compaction context size onto the CHECKPOINT step itself
        pendingCompactionStep.compaction.toTokens = totalInput;
        pendingCompactionStep = null;
      } else if (prevPlanner && prevPlanner.totalInput > 0 && totalInput < prevPlanner.totalInput) {
        const dropAbs = prevPlanner.totalInput - totalInput;
        const dropRatio = dropAbs / prevPlanner.totalInput;
        if (sawCompactionMarker || (dropRatio >= 0.2 && dropAbs >= 10_000)) {
          compaction = {
            fromTokens: prevPlanner.totalInput,
            toTokens: totalInput,
          };
        }
      }
      sawCompactionMarker = false;

      const { actionLabel, isReply } = summarizeAction(item.tool_calls);
      const stepObj = {
        stepIndex,
        seq: currentTurn.steps.length + 1,
        actionLabel,
        isReply,
        isCompactionStep: false,
        model: String(item.model || ""),
        createdAt: item.created_at || null,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalInput,
        hitRate: totalInput > 0 ? cacheReadTokens / totalInput : 0,
        compaction,
      };
      planners.push(stepObj);
      currentTurn.steps.push(stepObj);
    }
  }

  const nonEmptyTurns = turns.filter((t) => t.steps.length > 0).map((t) => {
    const sumIn = t.steps.reduce((acc, s) => acc + s.inputTokens, 0);
    const sumCache = t.steps.reduce((acc, s) => acc + s.cacheReadTokens, 0);
    const sumOut = t.steps.reduce((acc, s) => acc + s.outputTokens, 0);
    const sumTotal = sumIn + sumCache;
    const last = t.steps[t.steps.length - 1];
    const compactedSteps = t.steps.filter((s) => s.compaction !== null);
    const turnCompaction =
      compactedSteps.length > 0 ? compactedSteps[compactedSteps.length - 1].compaction : null;
    const isCompactionOnly = t.steps.every((s) => s.isCompactionStep);
    return {
      turnNumber: t.turnNumber,
      prompt: t.prompt,
      stepCount: t.steps.length,
      hitRate: sumTotal > 0 ? sumCache / sumTotal : 0,
      outputTokens: sumOut,
      latestTotalInput: last.totalInput,
      updatedAt: last.createdAt,
      isCompactionOnly,
      compaction: turnCompaction,
      steps: t.steps,
    };
  });

  return { planners, turns: nonEmptyTurns };
}

function computeMetrics(requestedConvId) {
  const cfg = loadConfig();
  const discovered = discoverConversations();
  const active = readActiveRecord();
  const activeId = active?.conversationId || discovered[0]?.id || null;

  let target = null;
  if (requestedConvId) {
    target = discovered.find((c) => c.id === requestedConvId) || null;
  }
  if (!target && activeId) {
    target = discovered.find((c) => c.id === activeId) || null;
  }
  if (!target) {
    target = discovered[0] || null;
  }

  if (!target) {
    return {
      ok: false,
      error: "尚未发现本地会话日志（发一条消息后点击刷新）",
      conversationId: null,
      model: "",
      updatedAt: null,
      isFirstStep: false,
      turnNumber: 0,
      turnSteps: 0,
      turnHitRate: 0,
      turnOutputTokens: 0,
      latestInputTokens: 0,
      latestCacheReadTokens: 0,
      latestTotalInput: 0,
      latestHitRate: 0,
      contextLimit: null,
      contextRatio: null,
      contextWarnRatio: cfg.contextWarnRatio,
      cacheDropThreshold: cfg.cacheDropThreshold,
      dropFacts: [],
      recentTurns: [],
    };
  }

  const { planners, turns } = parseTranscript(target.transcriptPath);
  if (planners.length === 0 || turns.length === 0) {
    return {
      ok: false,
      error: "当前会话尚无模型调用记录",
      conversationId: target.id,
      model: "",
      updatedAt: null,
      isFirstStep: false,
      turnNumber: 0,
      turnSteps: 0,
      turnHitRate: 0,
      turnOutputTokens: 0,
      latestInputTokens: 0,
      latestCacheReadTokens: 0,
      latestTotalInput: 0,
      latestHitRate: 0,
      contextLimit: null,
      contextRatio: null,
      contextWarnRatio: cfg.contextWarnRatio,
      cacheDropThreshold: cfg.cacheDropThreshold,
      dropFacts: [],
      recentTurns: [],
    };
  }

  const latest = planners[planners.length - 1];
  const prev = planners.length >= 2 ? planners[planners.length - 2] : null;
  const currentTurn = turns[turns.length - 1];
  const prevTurn = turns.length >= 2 ? turns[turns.length - 2] : null;

  let latestModel = latest.model;
  if (!latestModel) {
    for (let i = planners.length - 1; i >= 0; i--) {
      if (planners[i].model) {
        latestModel = planners[i].model;
        break;
      }
    }
  }

  const isFirstStep = planners.length === 1 && latest.cacheReadTokens === 0;
  const firstInTurn = currentTurn.steps[0];
  const firstIdx = planners.indexOf(firstInTurn);
  const refPrev = firstIdx > 0 ? planners[firstIdx - 1] : prev;

  const dropFacts =
    !isFirstStep && currentTurn.hitRate < cfg.cacheDropThreshold
      ? objectiveDropFacts(firstInTurn, refPrev, cfg.cacheExpiryGapSeconds)
      : [];

  const contextLimit = lookupContextLimit(latestModel, cfg);
  const contextRatio = contextLimit ? latest.totalInput / contextLimit : null;

  const currentTurnCompaction =
    currentTurn.compaction ||
    (prevTurn && prevTurn.isCompactionOnly && prevTurn.compaction && prevTurn.compaction.toTokens !== null
      ? prevTurn.compaction
      : null);

  return {
    ok: true,
    conversationId: target.id,
    model: latestModel,
    updatedAt: latest.createdAt,
    isFirstStep,
    turnNumber: currentTurn.turnNumber,
    turnSteps: currentTurn.stepCount,
    turnHitRate: currentTurn.hitRate,
    turnOutputTokens: currentTurn.outputTokens,
    latestInputTokens: latest.inputTokens,
    latestCacheReadTokens: latest.cacheReadTokens,
    latestTotalInput: latest.totalInput,
    latestHitRate: latest.hitRate,
    contextLimit,
    contextRatio,
    contextWarnRatio: cfg.contextWarnRatio,
    cacheDropThreshold: cfg.cacheDropThreshold,
    dropFacts,
    currentTurnCompaction,
    recentTurns: turns.slice(-10).reverse(),
  };
}

const server = new Server(
  { name: "cache-hit-monitor", version: "0.3.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: APP_URI,
      name: "Cache Hit Monitor",
      mimeType: "text/html;profile=mcp-app",
      _meta: { ui: { prefersBorder: false } },
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri !== APP_URI) {
    throw new Error(`Unknown resource: ${req.params.uri}`);
  }
  const html = fs.readFileSync(APP_HTML_PATH, "utf-8");
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: "text/html;profile=mcp-app",
        text: html,
        _meta: { ui: { prefersBorder: false } },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "open_cache_monitor",
      title: "Cache Monitor",
      description: "Open the Cache Hit Monitor side pane.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      _meta: {
        ui: { resourceUri: APP_URI },
        "com.google.antigravity/ui": {
          entrypoints: [{ type: "aux_pane", title: "Cache Monitor" }],
        },
      },
    },
    {
      name: "get_cache_metrics",
      title: "Get Cache Metrics",
      description: "Read latest prompt cache and context metrics from local transcript.",
      inputSchema: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
        },
      },
      _meta: {
        ui: { visibility: ["app"] },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  if (name !== "open_cache_monitor" && name !== "get_cache_metrics") {
    throw new Error(`Unknown tool: ${name}`);
  }
  const convId =
    args && typeof args.conversationId === "string" ? args.conversationId : undefined;
  const metrics = computeMetrics(convId);

  let text = "Cache Monitor opened.";
  if (metrics.ok) {
    const ctxText =
      metrics.contextLimit !== null && metrics.contextRatio !== null
        ? `${fmtTok(metrics.latestTotalInput)}/${fmtTok(metrics.contextLimit)} (${(
            metrics.contextRatio * 100
          ).toFixed(1)}%)`
        : fmtTok(metrics.latestTotalInput);
    text = `Turn ${metrics.turnNumber} | Cache ${(metrics.turnHitRate * 100).toFixed(1)}% | Context ${ctxText}`;
  }

  return {
    content: [{ type: "text", text }],
    structuredContent: metrics,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
