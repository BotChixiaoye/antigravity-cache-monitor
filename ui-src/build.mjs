import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const result = await build({
  entryPoints: [path.join(__dirname, "app.ts")],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2022"],
  write: false,
});

const jsCode = result.outputFiles[0].text;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cache Monitor</title>
<style>
  :root {
    color-scheme: light dark;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--color-background-primary, #111827);
    color: var(--color-text-primary, #f3f4f6);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: 13px;
    line-height: 1.45;
  }
  #app {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }
  .title {
    font-weight: 600;
    font-size: 14px;
  }
  .model-pill {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--color-background-secondary, rgba(148,163,184,0.14));
    color: var(--color-text-secondary, #9ca3af);
    border: 1px solid var(--color-border-primary, rgba(148,163,184,0.22));
    max-width: 170px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn {
    background: var(--color-background-secondary, rgba(148,163,184,0.14));
    color: var(--color-text-primary, #f3f4f6);
    border: 1px solid var(--color-border-primary, rgba(148,163,184,0.25));
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn:hover {
    background: var(--color-background-tertiary, rgba(148,163,184,0.24));
  }
  .card {
    background: var(--color-background-secondary, rgba(148,163,184,0.08));
    border: 1px solid var(--color-border-primary, rgba(148,163,184,0.2));
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    color: var(--color-text-secondary, #9ca3af);
  }
  .metric-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .metric-hero {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .metric-hero.good { color: var(--color-text-success, #22c55e); }
  .metric-hero.warn { color: var(--color-text-warning, #f59e0b); }
  .metric-hero.bad  { color: var(--color-text-danger, #ef4444); }
  .metric-hero.neutral { color: var(--color-text-primary, #f3f4f6); font-size: 18px; }
  .metric-big {
    font-size: 18px;
    font-weight: 700;
  }
  .metric-sub {
    font-size: 12px;
    font-weight: 400;
    color: var(--color-text-secondary, #9ca3af);
  }
  .metric-detail {
    font-size: 12px;
    color: var(--color-text-secondary, #9ca3af);
  }
  .pct-tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--color-background-tertiary, rgba(148,163,184,0.16));
    color: var(--color-text-secondary, #9ca3af);
  }
  .pct-tag.tag-warn {
    background: var(--color-background-warning, rgba(245,158,11,0.18));
    color: var(--color-text-warning, #f59e0b);
  }
  .bar-track {
    width: 100%;
    height: 7px;
    border-radius: 999px;
    background: var(--color-background-tertiary, rgba(148,163,184,0.2));
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--color-text-info, #38bdf8);
    transition: width 0.25s ease;
  }
  .bar-fill.warn {
    background: var(--color-text-warning, #f59e0b);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .chip-warn {
    background: var(--color-background-warning, rgba(245,158,11,0.18));
    color: var(--color-text-warning, #f59e0b);
    border: 1px solid var(--color-border-warning, rgba(245,158,11,0.35));
  }
  .chip-compact {
    background: var(--color-background-info, rgba(56,189,248,0.14));
    color: var(--color-text-info, #0284c7);
    border: 1px solid var(--color-border-info, rgba(56,189,248,0.32));
  }
  .compact-mini {
    font-size: 11px;
    flex-shrink: 0;
  }
  .step-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .step-compact {
    font-size: 10px;
    padding-left: 17px;
    color: var(--color-text-info, #0284c7);
  }
  .hint-warn {
    font-size: 11px;
    color: var(--color-text-warning, #f59e0b);
  }
  .hint-warn code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--color-background-tertiary, rgba(148,163,184,0.2));
  }

  /* Grouped turns list */
  .turns-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .turn-item {
    border: 1px solid transparent;
    border-radius: 7px;
    overflow: hidden;
  }
  .turn-item.open {
    border-color: var(--color-border-primary, rgba(148,163,184,0.2));
    background: var(--color-background-primary, rgba(0,0,0,0.03));
  }
  .turn-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 6px;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    border-radius: 6px;
  }
  .turn-head:hover {
    background: var(--color-background-tertiary, rgba(148,163,184,0.12));
  }
  .chev {
    font-size: 10px;
    color: var(--color-text-secondary, #9ca3af);
    width: 10px;
    flex-shrink: 0;
  }
  .turn-num {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--color-background-tertiary, rgba(148,163,184,0.16));
    color: var(--color-text-secondary, #9ca3af);
    flex-shrink: 0;
  }
  .turn-prompt {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  .turn-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    flex-shrink: 0;
  }
  .turn-cnt {
    font-size: 10px;
  }
  .turn-time {
    font-size: 10px;
  }
  .turn-steps {
    padding: 4px 8px 6px 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-top: 1px solid var(--color-border-primary, rgba(148,163,184,0.14));
  }
  .step-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
    padding: 2px 0;
  }
  .step-left {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .step-seq {
    font-size: 10px;
    width: 12px;
    flex-shrink: 0;
  }
  .act-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--color-background-tertiary, rgba(148,163,184,0.18));
    color: var(--color-text-primary, #f3f4f6);
    white-space: nowrap;
    max-width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .act-badge.act-reply {
    background: var(--color-background-info, rgba(56,189,248,0.16));
    color: var(--color-text-info, #0284c7);
    font-weight: 600;
  }
  .act-badge.act-compact {
    background: rgba(168, 85, 247, 0.16);
    color: #9333ea;
    font-weight: 600;
  }
  @media (prefers-color-scheme: dark) {
    .act-badge.act-compact {
      background: rgba(192, 132, 252, 0.18);
      color: #c084fc;
    }
  }
  .compact-range {
    font-size: 11px;
    color: var(--color-text-info, #0284c7);
    font-weight: 500;
  }
  .step-right {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }
  .step-tok {
    font-size: 10px;
  }
  .step-time {
    font-size: 10px;
  }
  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .muted { color: var(--color-text-secondary, #9ca3af); }
  .text-good { color: var(--color-text-success, #22c55e); font-weight: 600; }
  .text-warn { color: var(--color-text-warning, #f59e0b); font-weight: 600; }
  .text-bad  { color: var(--color-text-danger, #ef4444); font-weight: 600; }
  .empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--color-text-secondary, #9ca3af);
  }
</style>
</head>
<body>
<div id="app"></div>
<script type="module">${jsCode}</script>
</body>
</html>
`;

const outDir = path.join(rootDir, "ui");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "app.html");
fs.writeFileSync(outPath, html, "utf-8");
console.log(`Built ${outPath} (${Buffer.byteLength(html, "utf-8")} bytes)`);
