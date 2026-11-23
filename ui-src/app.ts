import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

interface CompactionInfo {
  fromTokens: number;
  toTokens: number | null;
}

interface StepEntry {
  stepIndex: number;
  seq: number;
  actionLabel: string;
  isReply: boolean;
  isCompactionStep?: boolean;
  model: string;
  createdAt: string | null;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalInput: number;
  hitRate: number;
  compaction: CompactionInfo | null;
}

interface TurnEntry {
  turnNumber: number;
  prompt: string;
  stepCount: number;
  hitRate: number;
  outputTokens: number;
  latestTotalInput: number;
  updatedAt: string | null;
  isCompactionOnly?: boolean;
  compaction: CompactionInfo | null;
  steps: StepEntry[];
}

interface CacheMetrics {
  ok: boolean;
  error?: string;
  conversationId: string | null;
  model: string;
  updatedAt: string | null;
  isFirstStep: boolean;
  turnNumber: number;
  turnSteps: number;
  turnHitRate: number;
  turnOutputTokens: number;
  latestInputTokens: number;
  latestCacheReadTokens: number;
  latestTotalInput: number;
  latestHitRate: number;
  contextLimit: number | null;
  contextRatio: number | null;
  contextWarnRatio: number;
  cacheDropThreshold: number;
  dropFacts: string[];
  currentTurnCompaction?: CompactionInfo | null;
  recentTurns: TurnEntry[];
}

const app = new App({ name: "Cache Hit Monitor", version: "0.3.0" }, {});

let inFlight = false;
let latestMetrics: CacheMetrics | null = null;
let pollTimer: number | null = null;
const expandedTurns = new Set<number>();

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtLimit(n: number): string {
  if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n % 1_000 === 0) return `${n / 1_000}k`;
  return fmtTok(n);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rateToneClass(rate: number, threshold: number, isFirst: boolean): string {
  if (isFirst) return "muted";
  if (rate < threshold) return "text-bad";
  if (rate >= 0.75) return "text-good";
  return "text-warn";
}

function render(data: CacheMetrics | null): void {
  const root = document.getElementById("app");
  if (!root) return;

  if (!data) {
    root.innerHTML = `<div class="empty">正在读取当前会话缓存数据…</div>`;
    return;
  }

  if (!data.ok) {
    root.innerHTML = `
      <div class="header">
        <div class="title">⚡ Cache Monitor</div>
        <button id="btn-refresh" class="btn">刷新</button>
      </div>
      <div class="empty">${esc(data.error || "暂无可用会话日志")}</div>
    `;
    bindEvents();
    return;
  }

  let rateClass = "good";
  let rateLabel = `${(data.turnHitRate * 100).toFixed(1)}%`;
  if (data.isFirstStep) {
    rateClass = "neutral";
    rateLabel = "首次请求";
  } else if (data.turnHitRate < data.cacheDropThreshold) {
    rateClass = "bad";
  } else if (data.turnHitRate < 0.75) {
    rateClass = "warn";
  }

  const factsHtml =
    !data.isFirstStep && data.turnHitRate < data.cacheDropThreshold && data.dropFacts.length > 0
      ? `<div class="chips">${data.dropFacts
          .map((f) => `<span class="chip chip-warn">${esc(f)}</span>`)
          .join("")}</div>`
      : "";

  let ctxHtml = "";
  if (data.contextLimit !== null && data.contextRatio !== null) {
    const pct = Math.min(100, Math.max(0, data.contextRatio * 100));
    const isWarn = data.contextRatio >= data.contextWarnRatio;
    const barClass = isWarn ? "bar-fill warn" : "bar-fill";
    ctxHtml = `
      <div class="metric-row">
        <div class="metric-big ${isWarn ? "text-warn" : ""}">${fmtTok(data.latestTotalInput)} <span class="metric-sub">/ ${fmtLimit(data.contextLimit)}</span></div>
        <div class="pct-tag ${isWarn ? "tag-warn" : ""}">${(data.contextRatio * 100).toFixed(1)}%</div>
      </div>
      <div class="bar-track"><div class="${barClass}" style="width: ${pct.toFixed(1)}%"></div></div>
      ${isWarn ? `<div class="hint-warn">水位偏高，建议运行 <code>/compact</code> 压缩上下文</div>` : ""}
    `;
  } else {
    ctxHtml = `
      <div class="metric-row">
        <div class="metric-big">${fmtTok(data.latestTotalInput)} <span class="metric-sub">tokens</span></div>
        <div class="pct-tag">绝对值</div>
      </div>
    `;
  }

  const ctxCompactionHtml = data.currentTurnCompaction
    ? `<div class="chips"><span class="chip chip-compact">${
        data.currentTurnCompaction.toTokens !== null
          ? `✂️ 已压缩 ${fmtTok(data.currentTurnCompaction.fromTokens)} → ${fmtTok(data.currentTurnCompaction.toTokens)}`
          : `✂️ 已压缩 ${fmtTok(data.currentTurnCompaction.fromTokens)}（待下轮更新水位）`
      }</span></div>`
    : "";

  // Grouped turns list (click to expand individual model calls inside a turn)
  const turnsHtml = data.recentTurns
    .map((t) => {
      const isOpen = expandedTurns.has(t.turnNumber);
      const isFirstTurnCold = t.turnNumber === 1 && t.stepCount === 1 && t.hitRate === 0;
      const tCls = rateToneClass(t.hitRate, data.cacheDropThreshold, isFirstTurnCold);
      const isCompactOnly = Boolean(t.isCompactionOnly);
      const compactTitle = t.compaction
        ? t.compaction.toTokens !== null
          ? `上下文压缩：${fmtTok(t.compaction.fromTokens)} → ${fmtTok(t.compaction.toTokens)}`
          : `上下文压缩：${fmtTok(t.compaction.fromTokens)}（待下轮更新）`
        : "";
      const turnCompactPill =
        !isCompactOnly && t.compaction
          ? `<span class="compact-mini" title="${esc(compactTitle)}">✂️</span>`
          : "";
      const headMainHtml = isCompactOnly
        ? `<span class="act-badge act-compact">压缩</span><span class="turn-prompt mono compact-range" title="${esc(compactTitle)}">${
            t.compaction && t.compaction.toTokens !== null
              ? `${fmtTok(t.compaction.fromTokens)} → ${fmtTok(t.compaction.toTokens)}`
              : "已压缩（待下轮更新）"
          }</span>`
        : `${turnCompactPill}<span class="turn-prompt" title="${esc(t.prompt)}">${esc(t.prompt)}</span>`;

      const stepsHtml = isOpen
        ? `<div class="turn-steps">
            ${t.steps
              .map((s) => {
                const sCold = t.turnNumber === 1 && s.seq === 1 && s.cacheReadTokens === 0;
                const sCls = rateToneClass(s.hitRate, data.cacheDropThreshold, sCold);
                const badgeCls = s.isCompactionStep
                  ? "act-badge act-compact"
                  : s.isReply
                    ? "act-badge act-reply"
                    : "act-badge";
                let stepCompactHtml = "";
                if (s.compaction) {
                  const summaryPart =
                    s.isCompactionStep && s.outputTokens > 0
                      ? ` · 摘要 ${fmtTok(s.outputTokens)}`
                      : "";
                  const rangeText =
                    s.compaction.toTokens !== null
                      ? `✂️ 压缩 ${fmtTok(s.compaction.fromTokens)} → ${fmtTok(s.compaction.toTokens)}${summaryPart}`
                      : `✂️ 压缩前 ${fmtTok(s.compaction.fromTokens)}（待下轮更新）${summaryPart}`;
                  stepCompactHtml = `<div class="step-compact mono">${rangeText}</div>`;
                }
                return `
                  <div class="step-block">
                    <div class="step-row">
                      <div class="step-left">
                        <span class="step-seq mono muted">${s.seq}</span>
                        <span class="${badgeCls}">${esc(s.actionLabel)}</span>
                      </div>
                      <div class="step-right mono">
                        <span class="${sCls}">${(s.hitRate * 100).toFixed(1)}%</span>
                        <span class="step-tok muted">${fmtTok(s.cacheReadTokens)}/${fmtTok(s.totalInput)}</span>
                        <span class="step-time muted">${fmtTime(s.createdAt)}</span>
                      </div>
                    </div>
                    ${stepCompactHtml}
                  </div>
                `;
              })
              .join("")}
          </div>`
        : "";

      return `
        <div class="turn-item ${isOpen ? "open" : ""}">
          <button class="turn-head" data-turn="${t.turnNumber}" type="button">
            <span class="chev">${isOpen ? "▾" : "▸"}</span>
            <span class="turn-num mono">R${t.turnNumber}</span>
            ${headMainHtml}
            <span class="turn-meta mono">
              <span class="${tCls}">${(t.hitRate * 100).toFixed(1)}%</span>
              <span class="turn-cnt muted">${t.stepCount}次</span>
              <span class="turn-time muted">${fmtTime(t.updatedAt)}</span>
            </span>
          </button>
          ${stepsHtml}
        </div>
      `;
    })
    .join("");

  root.innerHTML = `
    <div class="header">
      <div class="title-wrap">
        <span class="title">⚡ Cache Monitor</span>
        ${data.model ? `<span class="model-pill">${esc(data.model)}</span>` : ""}
      </div>
      <button id="btn-refresh" class="btn" title="立即刷新">刷新</button>
    </div>

    <div class="card">
      <div class="card-label">
        <span>本轮缓存命中 · R${data.turnNumber}</span>
        <span class="muted">${data.turnSteps} 次请求 · 输出 ${fmtTok(data.turnOutputTokens)}</span>
      </div>
      <div class="metric-row">
        <div class="metric-hero ${rateClass}">${rateLabel}</div>
        <div class="metric-detail mono">末次 ${fmtTok(data.latestCacheReadTokens)} / ${fmtTok(data.latestTotalInput)}</div>
      </div>
      ${factsHtml}
    </div>

    <div class="card">
      <div class="card-label">
        <span>当前窗口上下文</span>
        <span class="muted">${data.contextLimit !== null ? "Gemini 已核实上限" : "未设定分母"}</span>
      </div>
      ${ctxHtml}
      ${ctxCompactionHtml}
    </div>

    <div class="card">
      <div class="card-label">
        <span>对话轮次（点击展开明细）</span>
        <span class="muted">${fmtTime(data.updatedAt)}</span>
      </div>
      <div class="turns-list">${turnsHtml}</div>
    </div>
  `;

  bindEvents();
}

function bindEvents(): void {
  const btn = document.getElementById("btn-refresh");
  if (btn) {
    btn.addEventListener("click", () => {
      void fetchLatest();
    });
  }
  const heads = document.querySelectorAll<HTMLButtonElement>(".turn-head");
  heads.forEach((el) => {
    el.addEventListener("click", () => {
      const num = Number(el.dataset.turn);
      if (!Number.isFinite(num)) return;
      if (expandedTurns.has(num)) expandedTurns.delete(num);
      else expandedTurns.add(num);
      render(latestMetrics);
    });
  });
}

async function fetchLatest(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await app.callServerTool({
      name: "get_cache_metrics",
      arguments: {},
    });
    const sc = (res as { structuredContent?: CacheMetrics }).structuredContent;
    if (sc) {
      latestMetrics = sc;
      render(latestMetrics);
    }
  } catch {
    // Ignore transient poll aborts when view closes/reloads
  } finally {
    inFlight = false;
  }
}

function applyTheme(ctx: ReturnType<typeof app.getHostContext>): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
}

app.ontoolinput = () => {
  if (!latestMetrics) render(null);
};

app.ontoolresult = (result) => {
  const sc = (result as { structuredContent?: CacheMetrics }).structuredContent;
  if (sc) {
    latestMetrics = sc;
    render(latestMetrics);
  }
};

app.onhostcontextchanged = (ctx) => {
  applyTheme(ctx);
};

async function init(): Promise<void> {
  render(null);
  await app.connect();
  applyTheme(app.getHostContext());
  await fetchLatest();
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void fetchLatest();
  }, 2500);
}

void init();
