import { Text, useComputedColorScheme } from "@mantine/core";
import type { GitGraphCommit } from "@reinss/core";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { type GitTreeLayout, layoutGitTree } from "./gitTree.js";

const ROW_HEIGHT = 34;
const LANE_WIDTH = 18;
const GRAPH_LEFT = 16;
const TEXT_GAP = 14;
const TOP_PADDING = 8;
export const LANE_COLORS = [
  "#1f5f8b",
  "#2f9e44",
  "#e8590c",
  "#9c36b5",
  "#c2255c",
  "#0c8599",
  "#5f3dc4",
  "#a61e4d",
];

export interface GitTreeViewerProps {
  commits: GitGraphCommit[];
  height?: number;
  selected?: string | null;
  onSelect?: (commit: GitGraphCommit) => void;
  onOpen?: (commit: GitGraphCommit) => void;
}

interface DrawOptions {
  width: number;
  height: number;
  dpr: number;
  scrollTop: number;
  selected: string | null;
  hover: number | null;
  scheme: "light" | "dark";
  colors: {
    ink: string;
    dimmed: string;
    hairline: string;
    soft: string;
    surface: string;
    accent: string;
  };
}

function laneX(lane: number): number {
  return GRAPH_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
}

function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  color: string,
): void {
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, width, 16, 8);
  else ctx.rect(x, y, width, 16);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillText(label, x + 5, y + 11.5);
}

function refColor(ref: string, accent: string): string {
  if (ref === "HEAD") return accent;
  if (ref.startsWith("tag: ")) return "#e8590c";
  if (ref.includes("/")) return "#868e96";
  return "#1f5f8b";
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  layout: GitTreeLayout,
  options: DrawOptions,
): void {
  const { width, height, dpr, scrollTop, selected, hover, colors } = options;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(0, -scrollTop);

  const contentWidth = width;
  const first = Math.max(0, Math.floor((scrollTop - TOP_PADDING) / ROW_HEIGHT) - 1);
  const last = Math.min(
    layout.rows.length,
    Math.ceil((scrollTop + height - TOP_PADDING) / ROW_HEIGHT) + 1,
  );

  ctx.lineWidth = 1.5;
  for (const edge of layout.edges) {
    const fromX = laneX(edge.fromLane);
    const fromY = TOP_PADDING + edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    const toX = laneX(edge.toLane);
    const toY = TOP_PADDING + edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    ctx.strokeStyle = LANE_COLORS[edge.fromLane % LANE_COLORS.length] ?? colors.hairline;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    if (fromX === toX) {
      ctx.lineTo(toX, toY);
    } else {
      const mid = (fromY + toY) / 2;
      ctx.bezierCurveTo(fromX, mid, toX, mid, toX, toY);
    }
    ctx.stroke();
  }

  for (let index = first; index < last; index += 1) {
    const row = layout.rows[index];
    if (!row) continue;
    const y = TOP_PADDING + row.row * ROW_HEIGHT;
    if (row.commit.hash === selected || index === hover) {
      ctx.globalAlpha = row.commit.hash === selected ? 0.55 : 0.3;
      ctx.fillStyle = colors.soft;
      ctx.fillRect(0, y, contentWidth, ROW_HEIGHT);
      ctx.globalAlpha = 1;
    }

    const color = LANE_COLORS[row.lane % LANE_COLORS.length] ?? colors.accent;
    const dotX = laneX(row.lane);
    const dotY = y + ROW_HEIGHT / 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (row.commit.parents.length > 1) {
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const textX = GRAPH_LEFT + layout.laneCount * LANE_WIDTH + TEXT_GAP;
    const refs = row.commit.refs.slice(0, 3);
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Monaco, monospace';
    const refWidths = refs.map((ref) => {
      const label = ref.startsWith("tag: ") ? ref.slice(5) : ref;
      return ctx.measureText(label).width + 10;
    });
    const refsWidth = refWidths.reduce((total, item) => total + item + 4, 0);
    const subjectWidth = Math.max(40, contentWidth - textX - refsWidth - 16);

    ctx.fillStyle = colors.ink;
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "SF Pro Text", Arial, sans-serif';
    ctx.fillText(truncate(ctx, row.commit.subject, subjectWidth), textX, y + 14);
    ctx.fillStyle = colors.dimmed;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Monaco, monospace';
    ctx.fillText(
      `${row.commit.shortHash} · ${row.commit.author} · ${row.commit.date.slice(0, 10)}`,
      textX,
      y + 27,
    );

    let refX = contentWidth - 12 - refsWidth;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Monaco, monospace';
    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      const ref = refs[refIndex] ?? "";
      const label = ref.startsWith("tag: ") ? ref.slice(5) : ref;
      const pillWidth = refWidths[refIndex] ?? 0;
      pill(ctx, refX, y + 8, pillWidth, label, refColor(ref, colors.accent));
      refX += pillWidth + 4;
    }
  }

  ctx.restore();
}

export function GitTreeViewer({
  commits,
  height = 520,
  selected = null,
  onSelect,
  onOpen,
}: GitTreeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height });
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const layout = useMemo(() => layoutGitTree(commits), [commits]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const firstHash = commits[0]?.hash ?? "";
  useEffect(() => {
    if (!firstHash) return;
    scrollRef.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [firstHash]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const width = scrollRef.current?.clientWidth || rect.width || size.width;
    const height = scrollRef.current?.clientHeight || rect.height || size.height;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const styles = getComputedStyle(container);
    const colors = {
      ink:
        styles.getPropertyValue("--mantine-color-text").trim() ||
        (scheme === "dark" ? "#ecece6" : "#111111"),
      dimmed: styles.getPropertyValue("--mantine-color-dimmed").trim() || "#666666",
      hairline: styles.getPropertyValue("--reins-hairline").trim() || "#e6e6e6",
      soft: styles.getPropertyValue("--reins-soft").trim() || "#fff2d0",
      surface: styles.getPropertyValue("--mantine-color-body").trim() || "#fffbf1",
      accent: styles.getPropertyValue("--reins-accent").trim() || "#1f5f8b",
    };
    const frame = requestAnimationFrame(() => {
      try {
        drawTree(ctx, layout, {
          width,
          height,
          dpr,
          scrollTop,
          selected,
          hover,
          scheme,
          colors,
        });
        setDrawError(null);
      } catch (err) {
        setDrawError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [layout, scrollTop, size, selected, hover, scheme]);

  const rowAt = (event: MouseEvent<HTMLElement>): number | null => {
    const element = scrollRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top + element.scrollTop - TOP_PADDING;
    if (x < 0 || x > rect.width) return null;
    const row = Math.floor(y / ROW_HEIGHT);
    return row >= 0 && row < layout.rows.length ? row : null;
  };

  const selectRow = (index: number) => {
    const row = layout.rows[index];
    if (row) onSelect?.(row.commit);
  };

  const move = (delta: number) => {
    if (layout.rows.length === 0) return;
    const current = selected ? layout.rows.findIndex((row) => row.commit.hash === selected) : -1;
    const next = Math.min(Math.max(current < 0 ? 0 : current + delta, 0), layout.rows.length - 1);
    selectRow(next);
    const element = scrollRef.current;
    if (!element) return;
    const top = TOP_PADDING + next * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTo({ top });
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: bottom - element.clientHeight });
    }
  };

  const hovered = hover !== null ? layout.rows[hover] : null;

  if (commits.length === 0) {
    return (
      <div className="reins-git-tree-empty" style={{ height }}>
        <Text size="sm" c="dimmed">
          No commits yet.
        </Text>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="reins-git-tree"
      style={{ height }}
      data-testid="git-tree-viewer"
    >
      <div
        ref={scrollRef}
        className="reins-git-tree-scroll"
        tabIndex={0}
        role="listbox"
        aria-label={`Git history, ${layout.rows.length} commits`}
        title={hovered ? `${hovered.commit.shortHash} ${hovered.commit.subject}` : "Git history"}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onMouseMove={(event) => setHover(rowAt(event))}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const row = rowAt(event);
          if (row !== null) selectRow(row);
        }}
        onDoubleClick={(event) => {
          const row = rowAt(event);
          if (row !== null) {
            const commit = layout.rows[row]?.commit;
            if (commit) onOpen?.(commit);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            selectRow(0);
            scrollRef.current?.scrollTo({ top: 0 });
          } else if (event.key === "End") {
            event.preventDefault();
            selectRow(layout.rows.length - 1);
            scrollRef.current?.scrollTo({ top: TOP_PADDING + layout.rows.length * ROW_HEIGHT });
          } else if (event.key === "Enter" && selected) {
            const commit = layout.rows.find((row) => row.commit.hash === selected)?.commit;
            if (commit) onOpen?.(commit);
          }
        }}
      >
        <div style={{ height: TOP_PADDING + layout.rows.length * ROW_HEIGHT }} />
      </div>
      <canvas ref={canvasRef} className="reins-git-tree-canvas" />
      {drawError ? (
        <div className="reins-git-tree-error">
          <Text size="xs" c="red">
            {drawError}
          </Text>
        </div>
      ) : null}
      <div className="reins-git-tree-hint">Scroll to browse · double-click to review</div>
    </div>
  );
}
