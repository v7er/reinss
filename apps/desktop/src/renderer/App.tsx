import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Container,
  Group,
  Kbd,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { Spotlight, type SpotlightActionData, spotlight } from "@mantine/spotlight";
import type {
  BootstrapResult,
  CheckReport,
  DiffRange,
  FileDiff,
  GitBranches,
  GitCommitRefs,
  GitGraphCommit,
  GitMergeResult,
  GitReview,
  GitReviews,
  GitStatus,
  GitSync,
  GitSyncRef,
  GraphNode,
  GraphSlice,
  NavigationTarget,
  RepoStatus as RepoStatusType,
  SemanticDiff,
  SurfacePage,
  SymbolHit,
} from "@reinss/core";
import {
  CodeViewer,
  DiffViewer,
  GitRefs,
  GitTreeViewer,
  GraphView,
  KnowledgeBoard,
  LANE_COLORS,
  layoutGitTree,
  ReinsProvider,
  ReviewWorkspace,
  SurfaceExplorer,
  ThemeToggle,
  useAsync,
  useReins,
} from "@reinss/ui";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook,
  IconCheck,
  IconChevronRight,
  IconCommand,
  IconCopy,
  IconFolder,
  IconGitBranch,
  IconGitCompare,
  IconGitMerge,
  IconGitPullRequest,
  IconHome,
  IconLayoutDashboard,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconTag,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIcon from "./assets/app-icon.png";
import {
  closeRepository,
  createTauriClient,
  openRepository,
  startupRepository,
  startupTheme,
  startupTool,
} from "./client.js";
import { tailPath } from "./path.js";

type ToolId = "status" | "git" | "surfaces" | "knowledge" | "review";
type GitTab = "changes" | "history" | "reviews" | "refs";
type SurfaceTab = "entry" | "flow" | "graph";
type KnowledgeTab = "notes" | "check";
type SyncState = "idle" | "syncing" | "synced" | "error";

const RECENT_KEY = "reins.recentTools";
const REPOS_KEY = "reins.recentRepos";
const GIT_FETCH_KEY = "reins.gitAutoFetch";
const GIT_FETCH_INTERVAL_KEY = "reins.gitFetchInterval";
const GIT_FETCH_INTERVALS = [30_000, 60_000, 300_000];

function readRecent(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function writeRecent(key: string, value: string[]): void {
  localStorage.setItem(key, JSON.stringify(value.slice(0, 8)));
}

function repoLabel(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function rememberRepo(root: string | null | undefined): string[] {
  if (!root) return readRecent(REPOS_KEY);
  const next = [root, ...readRecent(REPOS_KEY).filter((item) => item !== root)];
  writeRecent(REPOS_KEY, next);
  return next;
}

function forgetRepo(root: string): string[] {
  const next = readRecent(REPOS_KEY).filter((item) => item !== root);
  writeRecent(REPOS_KEY, next);
  return next;
}

function ToolIcon({ id, size = 16 }: { id: ToolId; size?: number }) {
  switch (id) {
    case "git":
      return <IconGitCompare size={size} />;
    case "surfaces":
      return <IconRoute size={size} />;
    case "knowledge":
      return <IconBook size={size} />;
    default:
      return <IconLayoutDashboard size={size} />;
  }
}

const TOOLS: Array<{ id: ToolId; label: string; description: string }> = [
  { id: "status", label: "Home", description: "Quick actions" },
  {
    id: "git",
    label: "Git",
    description: "Changes, history, reviews, and refs",
  },
  { id: "surfaces", label: "Surfaces", description: "Entry points, flow, and call graph" },
  { id: "knowledge", label: "Knowledge", description: "Notes, constraints, and check" },
];

function ToolPage({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <Stack gap="lg">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <Tooltip label="Back" position="top">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            radius="xl"
            aria-label="Back"
            onClick={onBack}
          >
            <IconArrowLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <Stack gap={4}>
          <Title order={2} size="h2" fw={650}>
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        </Stack>
      </Group>
      {children}
    </Stack>
  );
}

function GraphTool({ initial }: { initial: { symbolId: string } | null }) {
  const { client } = useReins();
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState<{ symbolId: string } | null>(initial);
  const search = useAsync(
    () =>
      query.trim()
        ? client.call<SymbolHit[]>("searchSymbols", { query, limit: 8 })
        : Promise.resolve([]),
    [query],
  );
  const samples = useAsync(
    () =>
      !root && !query.trim()
        ? client.call<SymbolHit[]>("listSymbols", { limit: 20 })
        : Promise.resolve([]),
    [root, query],
  );
  const rows = query.trim() ? (search.data ?? []) : (samples.data ?? []);
  const loading = query.trim() ? search.loading : samples.loading;

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search a symbol, then pick a root"
          aria-label="Search symbols"
          radius="xl"
          leftSection={<IconSearch size={16} />}
          style={{ flex: 1, maxWidth: 480 }}
        />
        {root ? (
          <Button variant="subtle" size="compact-sm" onClick={() => setRoot(null)}>
            Clear root
          </Button>
        ) : null}
      </Group>
      {!root ? (
        <Paper withBorder radius="lg" p={4}>
          <ScrollArea h={420} type="auto">
            <Stack gap={0}>
              {rows.map((hit) => (
                <UnstyledButton
                  key={`${hit.id}-${hit.path}-${hit.startLine}`}
                  className="reins-row"
                  onClick={() => hit.id && setRoot({ symbolId: hit.id })}
                >
                  <span className="reins-row-main">{hit.name}</span>
                  <span className="reins-row-meta">
                    {hit.path}:{hit.startLine ?? 1}
                  </span>
                </UnstyledButton>
              ))}
              {!loading && rows.length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  {query.trim()
                    ? "No symbols. Check the graph status first."
                    : "No graph nodes yet. Build the graph first."}
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Paper>
      ) : (
        <GraphView root={root} direction="both" depth={2} height={560} />
      )}
    </Stack>
  );
}

function nodeChange(node: GraphNode, changed: Map<string, FileDiff>): FileDiff | null {
  const file = changed.get(node.path);
  if (!file) return null;
  if (file.status === "added" || file.status === "deleted") return file;
  const touched = file.hunks.some((hunk) =>
    hunk.lines.some(
      (line) =>
        line.newLine !== null && line.newLine >= node.startLine && line.newLine <= node.endLine,
    ),
  );
  return touched ? file : null;
}

function symbolSlice(
  text: string | undefined,
  startLine: number,
  endLine: number,
  kind: GraphNode["kind"],
): { text: string; startLine: number } | null {
  if (!text) return null;
  const lines = text.split("\n");
  const hasSpan = kind !== "module" && kind !== "file" && endLine >= startLine && endLine > 0;
  const start = hasSpan ? Math.max(1, startLine) : Math.max(1, startLine - 10);
  const end = hasSpan ? Math.min(lines.length, endLine) : Math.min(lines.length, startLine + 10);
  return { text: lines.slice(start - 1, end).join("\n"), startLine: start };
}

function FlowTool({ target, onTarget }: { target: string; onTarget: (value: string) => void }) {
  const { client } = useReins();
  const [input, setInput] = useState(target);
  const [changedOnly, setChangedOnly] = useState(false);
  const [view, setView] = useState<"file" | "graph">("file");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modalPath, setModalPath] = useState<string | null>(null);
  useEffect(() => setInput(target), [target]);

  const state = useAsync(
    () => (target ? client.call<GraphSlice>("flow", { target, depth: 3 }) : Promise.resolve(null)),
    [target],
  );
  const samples = useAsync(
    () =>
      !target && !changedOnly
        ? client.call<SymbolHit[]>("listSymbols", { limit: 20 })
        : Promise.resolve([]),
    [target, changedOnly],
  );
  const changed = useAsync(
    () =>
      !target && changedOnly
        ? client.call<SurfacePage>("listSurfaces", {
            changed: true,
            range: { mode: "working" },
            limit: 500,
          })
        : Promise.resolve(null),
    [target, changedOnly],
  );
  const diff = useAsync(
    () =>
      target && changedOnly
        ? client.call<SemanticDiff>("diff", { range: { mode: "working" } })
        : Promise.resolve(null),
    [target, changedOnly],
  );

  const nodes = useMemo(() => state.data?.nodes ?? [], [state.data]);
  const paths = useMemo(() => [...new Set(nodes.map((node) => node.path))], [nodes]);
  const neededPaths = useMemo(() => {
    const next = new Set<string>();
    for (const node of nodes) if (expanded.has(node.id)) next.add(node.path);
    if (modalPath) next.add(modalPath);
    return [...next];
  }, [nodes, expanded, modalPath]);
  const sources = useAsync(
    () =>
      neededPaths.length > 0
        ? Promise.all(
            neededPaths.map((path) =>
              client
                .call<{ path: string; text: string }>("readFile", { path })
                .catch(() => ({ path, text: "" })),
            ),
          )
        : Promise.resolve([]),
    [neededPaths.join("|")],
  );
  const sourceMap = useMemo(
    () => new Map((sources.data ?? []).map((source) => [source.path, source.text])),
    [sources.data],
  );
  const changedFiles = useMemo(
    () => new Map((diff.data?.files ?? []).map((file) => [file.path, file])),
    [diff.data],
  );
  const flowChanged = paths.filter((path) => changedFiles.has(path));
  const allExpanded = nodes.length > 0 && nodes.every((node) => expanded.has(node.id));

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(nodes.map((node) => node.id)));
  };

  const toggleNode = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Route, surface ID, or symbol ID"
          aria-label="Flow target"
          radius="xl"
          leftSection={<IconRoute size={16} />}
          style={{ flex: 1, maxWidth: 480 }}
        />
        <Button radius="xl" onClick={() => onTarget(input)}>
          Trace
        </Button>
        <Switch
          size="sm"
          checked={changedOnly}
          onChange={(event) => setChangedOnly(event.currentTarget.checked)}
          label="Changed only"
        />
        {view === "file" ? (
          <Switch size="sm" checked={allExpanded} onChange={toggleAll} label="Expand all code" />
        ) : null}
        <SegmentedControl
          size="xs"
          radius="xl"
          value={view}
          onChange={(value) => setView(value as "file" | "graph")}
          data={[
            { label: "File", value: "file" },
            { label: "Graph", value: "graph" },
          ]}
        />
      </Group>
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Tracing…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        (state.error as Error & { code?: string }).code === "SURFACE_UNTRACEABLE" ? (
          <Alert color="yellow" variant="light" title="Cannot trace this OpenAPI surface">
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {state.error.message}
            </Text>
          </Alert>
        ) : (
          <Alert color="red" variant="light">
            {state.error.message}
          </Alert>
        )
      ) : null}
      {!target && changedOnly ? (
        <Paper withBorder radius="lg" p={4}>
          <ScrollArea h={420} type="auto">
            <Stack gap={0}>
              {(changed.data?.items ?? []).map((surface) => (
                <UnstyledButton
                  key={`${surface.id}-${surface.file}-${surface.line}`}
                  className="reins-row"
                  onClick={() => onTarget(surface.id)}
                >
                  <span className="reins-row-main">
                    {surface.method ? `${surface.method} ` : ""}
                    {surface.route ?? surface.label}
                    <Badge size="xs" ml={8} variant="light" color="yellow">
                      {surface.change?.status ?? "changed"}
                    </Badge>
                  </span>
                  <span className="reins-row-meta">
                    {surface.file}:{surface.line}
                  </span>
                </UnstyledButton>
              ))}
              {!changed.loading && (changed.data?.items ?? []).length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  No entry points changed in the working tree.
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Paper>
      ) : null}
      {!target && !changedOnly ? (
        <Paper withBorder radius="lg" p={4}>
          <ScrollArea h={420} type="auto">
            <Stack gap={0}>
              {(samples.data ?? []).map((hit) => (
                <UnstyledButton
                  key={`${hit.id}-${hit.path}-${hit.startLine}`}
                  className="reins-row"
                  onClick={() => hit.id && onTarget(hit.id)}
                >
                  <span className="reins-row-main">{hit.name}</span>
                  <span className="reins-row-meta">
                    {hit.path}:{hit.startLine ?? 1}
                  </span>
                </UnstyledButton>
              ))}
              {!samples.loading && (samples.data ?? []).length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  No graph nodes yet. Build the graph first.
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
        </Paper>
      ) : null}
      {view === "graph" && state.data ? (
        <GraphView data={state.data} showModeSwitch={false} height={560} />
      ) : null}
      {view === "file" && state.data ? (
        <Paper withBorder radius="lg" p={4}>
          <Stack gap={0}>
            {nodes.map((node) => {
              const change = nodeChange(node, changedFiles);
              const isOpen = expanded.has(node.id);
              const slice = symbolSlice(
                sourceMap.get(node.path),
                node.startLine,
                node.endLine,
                node.kind,
              );
              return (
                <div key={node.id}>
                  <div className="reins-flow-row">
                    <UnstyledButton
                      className="reins-row"
                      onClick={() => toggleNode(node.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="reins-row-main" style={{ paddingLeft: node.depth * 16 }}>
                        <IconChevronRight
                          size={14}
                          style={{
                            transform: isOpen ? "rotate(90deg)" : undefined,
                            transition: "transform 120ms ease",
                          }}
                        />
                        {node.name}
                        {change ? (
                          <Badge size="xs" ml={8} variant="light" color="yellow">
                            {change.status}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="reins-row-meta">
                        {node.path}:{node.startLine}
                      </span>
                    </UnstyledButton>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => setModalPath(node.path)}
                    >
                      View file
                    </Button>
                  </div>
                  {isOpen ? (
                    <CodeViewer
                      path={node.path}
                      source={slice?.text}
                      startLine={slice?.startLine}
                      height="auto"
                      onClose={() => toggleNode(node.id)}
                    />
                  ) : null}
                </div>
              );
            })}
          </Stack>
        </Paper>
      ) : null}
      {target && changedOnly && flowChanged.length > 0 ? (
        <DiffViewer range={{ mode: "working" }} files={flowChanged} height={360} />
      ) : null}
      <Modal
        opened={modalPath !== null}
        onClose={() => setModalPath(null)}
        title={modalPath}
        size="min(1100px, 92vw)"
        centered
        radius="lg"
      >
        {modalPath ? (
          <CodeViewer path={modalPath} source={sourceMap.get(modalPath)} height="80vh" />
        ) : null}
      </Modal>
    </Stack>
  );
}

function CheckTool() {
  const { client } = useReins();
  const state = useAsync(() => client.call<CheckReport>("check", { scope: "knowledge+code" }), []);
  return (
    <Stack gap="md">
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Checking knowledge and code links…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data ? (
        <>
          <Group>
            <Badge size="lg" variant="light" color={state.data.ok ? "green" : "red"}>
              {state.data.ok ? "Check passed" : "Check failed"}
            </Badge>
            <Text size="sm" c="dimmed">
              {state.data.summary.error} errors · {state.data.summary.warning} warnings
            </Text>
          </Group>
          <Paper withBorder radius="lg" p={4}>
            <ScrollArea h={420} type="auto">
              <Stack gap={0}>
                {state.data.items.map((item) => (
                  <div key={`${item.code}-${item.message}`} className="reins-row">
                    <span className="reins-row-main">
                      <Badge
                        size="xs"
                        variant="light"
                        color={item.severity === "error" ? "red" : "yellow"}
                      >
                        {item.severity}
                      </Badge>{" "}
                      {item.message}
                    </span>
                    <span className="reins-row-meta">{item.path ?? item.noteId ?? ""}</span>
                  </div>
                ))}
              </Stack>
            </ScrollArea>
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}

function GitChanges({ onChanged }: { onChanged: () => void }) {
  const { client } = useReins();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useAsync(() => client.call<GitStatus>("gitStatus"), []);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      state.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const files = state.data?.files ?? [];
  const staged = files.filter((file) => file.staged).length;

  return (
    <Stack gap="md">
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Reading Git status…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : null}
      <Paper withBorder radius="lg" p={4}>
        <ScrollArea h={320} type="auto">
          <Stack gap={0}>
            {files.map((file) => (
              <Group key={file.path} gap="xs" wrap="nowrap" className="reins-row">
                <Badge
                  size="xs"
                  variant="light"
                  color={file.conflicted ? "red" : file.untracked ? "gray" : "blue"}
                >
                  {file.conflicted
                    ? "conflict"
                    : file.untracked
                      ? "new"
                      : `${file.index}${file.worktree}`}
                </Badge>
                <Text size="sm" style={{ flex: 1 }} truncate>
                  {file.path}
                </Text>
                {file.additions !== null ? (
                  <Text size="xs" c="dimmed">
                    +{file.additions} -{file.deletions ?? 0}
                  </Text>
                ) : null}
                {file.staged ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={busy}
                    onClick={() =>
                      void act(() => client.call("gitUnstage", { paths: [file.path] }))
                    }
                  >
                    Unstage
                  </Button>
                ) : (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={busy || file.conflicted}
                    onClick={() => void act(() => client.call("gitStage", { paths: [file.path] }))}
                  >
                    Stage
                  </Button>
                )}
              </Group>
            ))}
            {!state.loading && files.length === 0 ? (
              <Text size="sm" c="dimmed" p="md">
                Working tree clean.
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
      </Paper>
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          placeholder="Commit message"
          aria-label="Commit message"
          radius="xl"
          style={{ flex: 1 }}
        />
        <Button
          radius="xl"
          disabled={busy || !message.trim() || staged === 0}
          onClick={() =>
            void act(async () => {
              await client.call("gitCommit", { message });
              setMessage("");
            })
          }
        >
          Commit {staged > 0 ? `(${staged})` : ""}
        </Button>
      </Group>
    </Stack>
  );
}

function GitHistory({ onOpen }: { onOpen: (hash: string) => void }) {
  const { client } = useReins();
  const state = useAsync(() => client.call<GitGraphCommit[]>("gitGraph", { limit: 300 }), []);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedCommit = state.data?.find((commit) => commit.hash === selected) ?? null;
  const rootRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [rootHeight, setRootHeight] = useState(0);
  const [treeHeight, setTreeHeight] = useState(480);

  useEffect(() => {
    const update = () => {
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      setRootHeight(Math.max(320, window.innerHeight - top - 140));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const element = treeRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.contentRect.height ?? 0;
      if (height > 0) setTreeHeight(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Stack gap="sm" ref={rootRef} style={{ height: rootHeight || undefined }}>
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Reading history…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          {state.data?.length ?? 0} commits
        </Text>
        <Text size="xs" c="dimmed">
          {state.data?.filter((commit) => commit.parents.length > 1).length ?? 0} merges
        </Text>
      </Group>
      <div ref={treeRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <GitTreeViewer
          commits={state.data ?? []}
          height={treeHeight}
          selected={selected}
          onSelect={(commit) => setSelected(commit.hash)}
          onOpen={(commit) => onOpen(commit.hash)}
        />
      </div>
      {selectedCommit ? (
        <Paper withBorder radius="lg" p="md">
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {selectedCommit.subject}
              </Text>
              <Text size="xs" c="dimmed">
                {selectedCommit.shortHash} · {selectedCommit.author} ·{" "}
                {selectedCommit.date.slice(0, 10)}
                {selectedCommit.parents.length > 1
                  ? ` · merge of ${selectedCommit.parents.length}`
                  : ""}
              </Text>
              {selectedCommit.refs.length > 0 ? (
                <Group gap={4}>
                  {selectedCommit.refs.map((ref) => (
                    <Badge key={ref} size="xs" variant="light" color="gray">
                      {ref}
                    </Badge>
                  ))}
                </Group>
              ) : null}
            </Stack>
            <Button size="compact-sm" onClick={() => onOpen(selectedCommit.hash)}>
              Review diff
            </Button>
          </Group>
        </Paper>
      ) : (
        <Text size="xs" c="dimmed">
          Select a commit to inspect it. Double-click or press Enter to review its diff.
        </Text>
      )}
    </Stack>
  );
}

function reviewRange(review: GitReview): DiffRange | null {
  return review.base && review.head
    ? { mode: "range", base: review.base, head: review.head }
    : null;
}

function GitReviewList({ onReview }: { onReview: (range: DiffRange) => void }) {
  const { client } = useReins();
  const state = useAsync(() => client.call<GitReviews>("gitReviews"), []);
  const reviews = state.data?.reviews ?? [];

  return (
    <Stack gap="md">
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Reading git-appraise reviews…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data && !state.data.available ? (
        <Alert color="gray" variant="light">
          No git-appraise reviews detected. Reviews appear here when the repository has
          <code> refs/notes/devtools/reviews</code>.
        </Alert>
      ) : null}
      {reviews.map((review) => {
        const range = reviewRange(review);
        return (
          <Paper key={review.revision} withBorder radius="lg" p="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Stack gap={4} style={{ minWidth: 0 }}>
                <Group gap="xs">
                  <Badge
                    size="xs"
                    variant="light"
                    color={review.submitted ? "gray" : review.resolved ? "green" : "orange"}
                  >
                    {review.submitted ? "submitted" : review.resolved ? "accepted" : "open"}
                  </Badge>
                  {review.needsReview ? (
                    <Badge size="xs" variant="light" color="orange">
                      needs review
                    </Badge>
                  ) : null}
                  <Text size="xs" c="dimmed" ff="monospace">
                    {review.shortRevision}
                  </Text>
                </Group>
                <Text size="sm" fw={600} truncate>
                  {review.description || "(no description)"}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {review.requester || "unknown"} → {review.targetRef ?? "abandoned"}
                  {review.reviewers.length > 0
                    ? ` · reviewers: ${review.reviewers.join(", ")}`
                    : ""}
                  {review.comments > 0 ? ` · ${review.comments} comments` : ""}
                </Text>
              </Stack>
              <Button size="compact-sm" disabled={!range} onClick={() => range && onReview(range)}>
                Review diff
              </Button>
            </Group>
          </Paper>
        );
      })}
      {state.data?.available && reviews.length === 0 ? (
        <Text size="sm" c="dimmed">
          No reviews yet.
        </Text>
      ) : null}
    </Stack>
  );
}

function syncRefLabel(ref: GitSyncRef): string {
  if (ref.state === "behind") return `behind ${ref.behind}`;
  if (ref.state === "ahead") return `ahead ${ref.ahead}`;
  if (ref.state === "diverged") return `diverged ${ref.ahead}/${ref.behind}`;
  if (ref.state === "new") return `new on ${ref.remote}`;
  return `updated on ${ref.remote}`;
}

interface GitConfirm {
  title: string;
  message: string;
  action: () => Promise<unknown>;
}

function GitTool({
  tab,
  onTab,
  onReview,
}: {
  tab: GitTab;
  onTab: (tab: GitTab) => void;
  onReview: (range: DiffRange) => void;
}) {
  const { client } = useReins();
  const status = useAsync(() => client.call<GitStatus>("gitStatus"), []);
  const [sync, setSync] = useState<GitSync | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [acting, setActing] = useState(false);
  const [confirm, setConfirm] = useState<GitConfirm | null>(null);
  const [autoFetch, setAutoFetch] = useState(() => localStorage.getItem(GIT_FETCH_KEY) === "1");
  const [interval, setIntervalMs] = useState(() => {
    const stored = Number(localStorage.getItem(GIT_FETCH_INTERVAL_KEY));
    return GIT_FETCH_INTERVALS.includes(stored) ? stored : 60_000;
  });
  const fetchingRef = useRef(false);
  const reloadStatus = status.reload;

  const runSync = useCallback(
    async (tags = false) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      setFetching(true);
      setSyncError(null);
      try {
        setSync(await client.call<GitSync>("gitSync", tags ? { tags: true } : undefined));
        reloadStatus();
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : String(err));
      } finally {
        fetchingRef.current = false;
        setFetching(false);
      }
    },
    [client, reloadStatus],
  );

  useEffect(() => {
    if (!autoFetch) return;
    void runSync();
    const id = window.setInterval(() => void runSync(), interval);
    return () => window.clearInterval(id);
  }, [autoFetch, interval, runSync]);

  const toggleAutoFetch = (checked: boolean) => {
    setAutoFetch(checked);
    localStorage.setItem(GIT_FETCH_KEY, checked ? "1" : "0");
  };

  const changeInterval = (value: string | null) => {
    if (!value) return;
    const next = Number(value);
    setIntervalMs(next);
    localStorage.setItem(GIT_FETCH_INTERVAL_KEY, String(next));
  };

  const act = async (action: () => Promise<unknown>) => {
    setActing(true);
    setSyncError(null);
    try {
      await action();
      await runSync(true);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(false);
    }
  };

  const askRebase = (ref: GitSyncRef) =>
    setConfirm({
      title: "Rebase branch",
      message: `Check out and rebase ${ref.name} onto ${ref.upstream ?? "its upstream"}? This rewrites local commits. Conflicts leave the repository mid-rebase.`,
      action: () =>
        client.call<GitStatus>("gitRebase", {
          branch: ref.name,
          ...(ref.upstream ? { upstream: ref.upstream } : {}),
        }),
    });

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="xs" wrap="wrap">
        <Group gap="xs">
          <Switch
            size="xs"
            label="Auto fetch"
            checked={autoFetch}
            onChange={(event) => toggleAutoFetch(event.currentTarget.checked)}
          />
          <Select
            size="xs"
            w={80}
            aria-label="Fetch interval"
            value={String(interval)}
            onChange={changeInterval}
            allowDeselect={false}
            disabled={!autoFetch}
            data={[
              { value: "30000", label: "30s" },
              { value: "60000", label: "1m" },
              { value: "300000", label: "5m" },
            ]}
          />
          <Tooltip label="Fetch all remotes now" position="bottom">
            <ActionIcon
              variant="subtle"
              aria-label="Fetch all remotes"
              loading={fetching}
              onClick={() => void runSync(true)}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Group gap="xs">
          <Badge variant="light" color="gray" radius="xl">
            {status.data?.branch ?? "detached"}
          </Badge>
          {status.data?.ahead ? (
            <Badge size="xs" variant="light" color="green">
              ahead {status.data.ahead}
            </Badge>
          ) : null}
          {status.data?.behind ? (
            <Badge size="xs" variant="light" color="orange">
              behind {status.data.behind}
            </Badge>
          ) : null}
        </Group>
      </Group>
      {syncError ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setSyncError(null)}>
          {syncError}
        </Alert>
      ) : null}
      {sync && sync.refs.length > 0 ? (
        <Alert
          color="yellow"
          variant="outline"
          title="Refs out of sync"
          icon={<IconAlertTriangle size={16} />}
        >
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              These refs differ from their remote.
            </Text>
            {sync.refs.slice(0, 8).map((ref) => (
              <Group key={`${ref.kind}:${ref.remote}:${ref.name}`} gap="xs" wrap="nowrap">
                <Badge size="xs" variant="light" color={ref.kind === "branch" ? "blue" : "orange"}>
                  {ref.kind}
                </Badge>
                <Text size="sm" truncate style={{ flex: 1 }}>
                  {ref.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {syncRefLabel(ref)}
                </Text>
                {ref.kind === "branch" ? (
                  ref.state === "ahead" ? (
                    <Button
                      size="compact-xs"
                      variant="light"
                      disabled={acting || fetching}
                      onClick={() =>
                        void act(() => client.call<GitStatus>("gitPush", { branch: ref.name }))
                      }
                    >
                      Push
                    </Button>
                  ) : (
                    <Button
                      size="compact-xs"
                      variant="light"
                      color="yellow"
                      disabled={acting || fetching}
                      onClick={() => askRebase(ref)}
                    >
                      Rebase
                    </Button>
                  )
                ) : (
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={acting || fetching}
                    onClick={() => void runSync(true)}
                  >
                    Fetch
                  </Button>
                )}
              </Group>
            ))}
            {sync.refs.length > 8 ? (
              <Text size="xs" c="dimmed">
                +{sync.refs.length - 8} more
              </Text>
            ) : null}
          </Stack>
        </Alert>
      ) : null}
      <Tabs value={tab} onChange={(value) => value && onTab(value as GitTab)}>
        <Tabs.List>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
          <Tabs.Tab value="reviews">Reviews</Tabs.Tab>
          <Tabs.Tab value="refs">Refs</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="changes" pt="md">
          <GitChanges onChanged={reloadStatus} />
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <GitHistory onOpen={(hash) => onReview({ mode: "commit", hash })} />
        </Tabs.Panel>
        <Tabs.Panel value="reviews" pt="md">
          <GitReviewList onReview={onReview} />
        </Tabs.Panel>
        <Tabs.Panel value="refs" pt="md">
          <GitRefs onChanged={reloadStatus} />
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        centered
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm">{confirm?.message}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              color="yellow"
              disabled={acting}
              onClick={() => {
                const action = confirm?.action;
                setConfirm(null);
                if (action) void act(action);
              }}
            >
              Rebase
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

const TIMELINE_COL = 150;
const TIMELINE_LANE = 14;
const TIMELINE_DOT = 8;

function CommitTimeline({
  commits,
  current,
  onOpen,
}: {
  commits: GitGraphCommit[];
  current: string;
  onOpen: (hash: string) => void;
}) {
  const layout = layoutGitTree(commits);
  const count = layout.rows.length;
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setMeasured(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const width = measured > 0 ? measured : count * TIMELINE_COL;
  const col = count > 0 ? width / count : TIMELINE_COL;
  const height = Math.max(1, layout.laneCount) * TIMELINE_LANE + 8;
  const x = (row: number) => (count - 1 - row) * col + TIMELINE_DOT;
  const y = (lane: number) => lane * TIMELINE_LANE + TIMELINE_LANE / 2 + 4;

  const related = useMemo(() => {
    const set = new Set<number>();
    const currentRow = layout.rows.findIndex((row) => row.commit.hash === current);
    if (currentRow < 0) return set;
    const queue = [currentRow];
    while (queue.length > 0) {
      const row = queue.pop();
      if (row === undefined || set.has(row)) continue;
      set.add(row);
      const commit = layout.rows[row]?.commit;
      if (!commit) continue;
      for (const parent of commit.parents) {
        const index = layout.rows.findIndex((item) => item.commit.hash === parent);
        if (index >= 0) queue.push(index);
      }
      for (const edge of layout.edges) {
        if (edge.toRow === row) queue.push(edge.fromRow);
      }
    }
    return set;
  }, [layout, current]);

  return (
    <div ref={ref} className="reins-timeline" style={{ width: "100%" }}>
      <svg
        width={width}
        height={height}
        className="reins-timeline-graph"
        role="img"
        aria-label="Commit graph"
      >
        <title>Commit graph</title>
        {layout.edges.map((edge) => {
          const color = LANE_COLORS[edge.fromLane % LANE_COLORS.length];
          const key = `${edge.fromRow}-${edge.toRow}-${edge.fromLane}-${edge.toLane}`;
          if (edge.toRow >= count) {
            return (
              <line
                key={key}
                x1={x(edge.fromRow)}
                y1={y(edge.fromLane)}
                x2={0}
                y2={y(edge.fromLane)}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.25}
              />
            );
          }
          const x1 = x(edge.fromRow);
          const y1 = y(edge.fromLane);
          const x2 = x(edge.toRow);
          const y2 = y(edge.toLane);
          const mid = (x1 + x2) / 2;
          const relatedEdge = related.has(edge.fromRow) && related.has(edge.toRow);
          return (
            <path
              key={key}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              opacity={relatedEdge ? 1 : 0.25}
            />
          );
        })}
        {layout.rows.map((row) => {
          const color = LANE_COLORS[row.lane % LANE_COLORS.length];
          const active = row.commit.hash === current;
          return (
            <g key={row.commit.hash} opacity={active || related.has(row.row) ? 1 : 0.35}>
              {active ? (
                <>
                  <circle cx={x(row.row)} cy={y(row.lane)} r={10} fill={color} opacity={0.16} />
                  <circle
                    className="reins-timeline-pulse"
                    cx={x(row.row)}
                    cy={y(row.lane)}
                    r={5.5}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                  />
                  <circle
                    className="reins-timeline-pulse is-delay"
                    cx={x(row.row)}
                    cy={y(row.lane)}
                    r={5.5}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.5}
                  />
                </>
              ) : null}
              {row.commit.parents.length > 1 ? (
                <circle
                  cx={x(row.row)}
                  cy={y(row.lane)}
                  r={7}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  opacity={0.45}
                />
              ) : null}
              <circle
                cx={x(row.row)}
                cy={y(row.lane)}
                r={active ? 6 : 4}
                fill={active ? color : "var(--mantine-color-body)"}
                stroke={color}
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      <div className="reins-timeline-labels">
        {[...layout.rows].reverse().map((row) => (
          <UnstyledButton
            key={row.commit.hash}
            className={`reins-timeline-label ${row.commit.hash === current ? "is-active" : ""}`}
            style={{ width: col }}
            onClick={() => onOpen(row.commit.hash)}
            title={row.commit.subject}
          >
            <span className="reins-timeline-subject">{row.commit.subject}</span>
            <span className="reins-timeline-meta">
              {row.commit.shortHash} · {row.commit.author}
            </span>
            <span className="reins-timeline-date">{row.commit.date.slice(0, 10)}</span>
            {row.commit.refs.length > 0 ? (
              <span className="reins-timeline-refs">
                {row.commit.refs.slice(0, 2).map((ref) => (
                  <span key={ref} className="reins-timeline-ref">
                    {ref}
                  </span>
                ))}
              </span>
            ) : null}
          </UnstyledButton>
        ))}
      </div>
    </div>
  );
}

function RefGroup({ icon, label, items }: { icon: ReactNode; label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Group gap={4} wrap="wrap">
      <Group gap={3} wrap="nowrap">
        {icon}
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </Group>
      {items.map((item) => (
        <Badge key={item} size="xs" variant="light" color="gray">
          {item}
        </Badge>
      ))}
    </Group>
  );
}

function MergePreview({
  source,
  target,
  targetHead,
}: {
  source: GitGraphCommit;
  target: string;
  targetHead: string | null;
}) {
  const width = 320;
  const height = 92;
  const yTarget = 28;
  const ySource = 66;
  const xTarget = 268;
  const xSource = 96;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Merge ${source.shortHash} into ${target}`}
    >
      <line
        x1={16}
        y1={yTarget}
        x2={xTarget}
        y2={yTarget}
        stroke="var(--mantine-color-gray-5)"
        strokeWidth={2}
      />
      <circle
        cx={xTarget}
        cy={yTarget}
        r={5}
        fill="var(--mantine-color-body)"
        stroke="var(--reins-accent)"
        strokeWidth={2}
      />
      <path
        d={`M${xSource},${ySource} C${xSource + 50},${ySource} ${xTarget - 50},${yTarget} ${xTarget},${yTarget}`}
        fill="none"
        stroke="var(--reins-accent)"
        strokeWidth={2}
      />
      <circle cx={xSource} cy={ySource} r={5} fill="var(--reins-accent)" />
      <text x={16} y={yTarget - 10} fontSize={11} fill="var(--mantine-color-dimmed)">
        {target}
      </text>
      <text
        x={xTarget - 8}
        y={yTarget + 4}
        fontSize={11}
        textAnchor="end"
        fill="var(--mantine-color-dimmed)"
      >
        {targetHead?.slice(0, 7) ?? ""}
      </text>
      <text x={xSource + 10} y={ySource + 4} fontSize={11} fill="var(--mantine-color-text)">
        {source.shortHash}
      </text>
    </svg>
  );
}

function CommitDetail({ hash, onOpen }: { hash: string; onOpen: (hash: string) => void }) {
  const { client } = useReins();
  const state = useAsync(() => client.call<GitGraphCommit[]>("gitGraph", { limit: 300 }), []);
  const refs = useAsync(() => client.call<GitCommitRefs>("gitCommitRefs", { hash }), [hash]);
  const branches = useAsync(() => client.call<GitBranches>("gitBranches"), []);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const commits = state.data ?? [];
  const index = commits.findIndex((commit) => commit.hash === hash);
  const commit = index >= 0 ? commits[index] : null;
  if (!commit) return null;
  const start = Math.max(0, Math.min(index - 3, commits.length - 6));
  const around = commits.slice(start, start + 6);

  const localBranches = branches.data?.local ?? [];
  const mainBranch = refs.data?.defaultBranch ?? branches.data?.current ?? null;
  const mergedToMain = mainBranch ? (refs.data?.mergedInto.includes(mainBranch) ?? false) : false;
  const targetName = target ?? mainBranch ?? localBranches[0]?.name ?? null;
  const targetHead = localBranches.find((branch) => branch.name === targetName)?.head ?? null;

  const openMerge = () => {
    setTarget(mainBranch ?? localBranches[0]?.name ?? null);
    setError(null);
    setNotice(null);
    setMergeOpen(true);
  };

  const confirmMerge = async () => {
    if (!targetName) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.call<GitMergeResult>("gitMerge", {
        source: commit.hash,
        target: targetName,
      });
      setNotice(result.message || `Merged ${commit.shortHash} into ${targetName}.`);
      refs.reload();
      state.reload();
      branches.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Paper withBorder radius="lg" p="sm">
        <Stack gap={6}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" fw={600} truncate style={{ minWidth: 0 }}>
              {commit.subject}
            </Text>
            <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
              {commit.refs.includes("HEAD") ? (
                <Badge size="xs" variant="light" color="blue">
                  head
                </Badge>
              ) : null}
              {mergedToMain ? (
                <Badge size="xs" variant="light" color="green">
                  merged
                </Badge>
              ) : null}
              {commit.parents.length > 1 ? (
                <Badge size="xs" variant="light" color="grape">
                  merge
                </Badge>
              ) : null}
            </Group>
          </Group>
          <Text size="xs" c="dimmed">
            {commit.shortHash} · {commit.author} · {commit.date.slice(0, 16).replace("T", " ")}
          </Text>
          <Group gap="md" wrap="wrap">
            <RefGroup
              icon={<IconGitBranch size={12} />}
              label="branches"
              items={refs.data?.branches ?? []}
            />
            <RefGroup icon={<IconTag size={12} />} label="tags" items={refs.data?.tags ?? []} />
            <RefGroup
              icon={<IconFolder size={12} />}
              label="worktrees"
              items={(refs.data?.worktrees ?? []).map(
                (worktree) => worktree.branch ?? tailPath(worktree.path),
              )}
            />
          </Group>
          <ScrollArea type="auto" scrollbars="x">
            <CommitTimeline commits={around} current={hash} onOpen={onOpen} />
          </ScrollArea>
          <Group justify="flex-end" gap="xs">
            {!mergedToMain ? (
              <Button
                size="compact-sm"
                leftSection={<IconGitMerge size={14} />}
                onClick={openMerge}
              >
                Merge
              </Button>
            ) : null}
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<IconCopy size={14} />}
              onClick={() => void navigator.clipboard.writeText(commit.hash)}
            >
              Copy hash
            </Button>
          </Group>
        </Stack>
      </Paper>
      <Modal opened={mergeOpen} onClose={() => setMergeOpen(false)} title="Merge commit" centered>
        <Stack gap="sm">
          <Text size="sm">
            Merge{" "}
            <Text span size="sm" ff="monospace">
              {commit.shortHash}
            </Text>{" "}
            into
          </Text>
          <Select
            label="Target branch"
            data={localBranches.map((branch) => branch.name)}
            value={targetName}
            onChange={setTarget}
            searchable
            allowDeselect={false}
          />
          <MergePreview source={commit} target={targetName ?? "?"} targetHead={targetHead} />
          <Text size="xs" c="dimmed">
            This checks out {targetName ?? "the target branch"} and creates a merge commit. The
            working tree must be clean.
          </Text>
          {error ? (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          ) : null}
          {notice ? (
            <Alert color="green" variant="light">
              {notice}
            </Alert>
          ) : null}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setMergeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void confirmMerge()}
              loading={busy}
              disabled={!targetName || Boolean(notice)}
            >
              Merge
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

function ReviewPage({ range, onRange }: { range: DiffRange; onRange: (range: DiffRange) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(640);
  const [bodyHeight, setBodyHeight] = useState(600);

  useEffect(() => {
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(420, window.innerHeight - top - 140));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.height ?? 0;
      if (next > 0) setBodyHeight(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ height }}>
      <Stack gap="sm" style={{ height: "100%" }}>
        {range.mode === "commit" ? (
          <CommitDetail hash={range.hash} onOpen={(hash) => onRange({ mode: "commit", hash })} />
        ) : null}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0 }}>
          <ReviewWorkspace range={range} height={bodyHeight} />
        </div>
      </Stack>
    </div>
  );
}

function SurfacesTool({
  tab,
  onTab,
  flowTarget,
  onFlowTarget,
  graphRoot,
}: {
  tab: SurfaceTab;
  onTab: (tab: SurfaceTab) => void;
  flowTarget: string;
  onFlowTarget: (value: string) => void;
  graphRoot: { symbolId: string } | null;
}) {
  return (
    <Tabs value={tab} onChange={(value) => value && onTab(value as SurfaceTab)}>
      <Tabs.List>
        <Tabs.Tab value="entry">Entry points</Tabs.Tab>
        <Tabs.Tab value="flow">Flow</Tabs.Tab>
        <Tabs.Tab value="graph">Graph</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="entry" pt="md">
        <SurfaceExplorer height={560} />
      </Tabs.Panel>
      <Tabs.Panel value="flow" pt="md">
        <FlowTool target={flowTarget} onTarget={onFlowTarget} />
      </Tabs.Panel>
      <Tabs.Panel value="graph" pt="md">
        <GraphTool key={graphRoot?.symbolId ?? "none"} initial={graphRoot} />
      </Tabs.Panel>
    </Tabs>
  );
}

function KnowledgeTool({ tab, onTab }: { tab: KnowledgeTab; onTab: (tab: KnowledgeTab) => void }) {
  return (
    <Tabs value={tab} onChange={(value) => value && onTab(value as KnowledgeTab)}>
      <Tabs.List>
        <Tabs.Tab value="notes">Notes</Tabs.Tab>
        <Tabs.Tab value="check">Check</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="notes" pt="md">
        <KnowledgeBoard height={560} />
      </Tabs.Panel>
      <Tabs.Panel value="check" pt="md">
        <CheckTool />
      </Tabs.Panel>
    </Tabs>
  );
}

function HomeTool({
  repo,
  recent,
  onSelect,
  onReview,
  onOpenReviews,
}: {
  repo: RepoStatusType["repo"];
  recent: string[];
  onSelect: (tool: ToolId) => void;
  onReview: (range: DiffRange) => void;
  onOpenReviews: () => void;
}) {
  const { client } = useReins();
  const reviews = useAsync(() => client.call<GitReviews>("gitReviews"), []);
  const needsReview = (reviews.data?.reviews ?? []).filter((review) => review.needsReview);
  const shownReviews = needsReview.slice(0, 5);
  const ordered = [
    ...recent
      .map((id) => TOOLS.find((tool) => tool.id === id))
      .filter((tool): tool is (typeof TOOLS)[number] => tool !== undefined && tool.id !== "status"),
    ...TOOLS.filter((tool) => tool.id !== "status" && !recent.includes(tool.id)),
  ];

  return (
    <Stack gap="lg" maw={620} mx="auto" py="xl">
      <Group gap="md" align="flex-start" wrap="nowrap">
        <img
          src={appIcon}
          alt=""
          width={64}
          height={64}
          style={{ borderRadius: 16, flexShrink: 0 }}
        />
        <Stack gap={2} style={{ minWidth: 0 }} pt={2}>
          <Title
            order={2}
            size="h2"
            fw={650}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {repo.name}
          </Title>
          <Text size="xs" c="dimmed" ff="monospace" truncate title={repo.root ?? repo.name}>
            cwd: {tailPath(repo.root ?? repo.name)}
          </Text>
          <Text size="sm" c="dimmed">
            Code structure, intent, and review.
          </Text>
        </Stack>
      </Group>
      <Paper withBorder radius="lg" p={4}>
        {ordered.map((tool) => (
          <UnstyledButton key={tool.id} className="reins-row" onClick={() => onSelect(tool.id)}>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="blue" size="md" radius="md">
                <ToolIcon id={tool.id} size={16} />
              </ThemeIcon>
              <Stack gap={0}>
                <span className="reins-row-main">{tool.label}</span>
                <Text size="xs" c="dimmed">
                  {tool.description}
                </Text>
              </Stack>
            </Group>
            <IconChevronRight size={14} />
          </UnstyledButton>
        ))}
      </Paper>
      {needsReview.length > 0 ? (
        <Stack gap="xs">
          <Group justify="space-between">
            <Group gap="xs">
              <IconGitPullRequest size={14} />
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                Reviews needing you
              </Text>
            </Group>
            <Badge size="xs" variant="light" color="orange">
              {needsReview.length}
            </Badge>
          </Group>
          <Paper withBorder radius="lg" p={4}>
            {shownReviews.map((review) => {
              const range = reviewRange(review);
              return (
                <UnstyledButton
                  key={review.revision}
                  className="reins-row"
                  disabled={!range}
                  onClick={() => range && onReview(range)}
                >
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon variant="light" color="orange" size="md" radius="md">
                      <IconGitPullRequest size={16} />
                    </ThemeIcon>
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <span className="reins-row-main">
                        {review.description || review.shortRevision}
                      </span>
                      <Text size="xs" c="dimmed" truncate>
                        {review.requester || "unknown"} → {review.targetRef ?? "abandoned"}
                      </Text>
                    </Stack>
                  </Group>
                  <IconChevronRight size={14} />
                </UnstyledButton>
              );
            })}
            {needsReview.length > shownReviews.length ? (
              <UnstyledButton className="reins-row" onClick={onOpenReviews}>
                <Text size="xs" c="dimmed">
                  {needsReview.length - shownReviews.length} more in Git → Reviews
                </Text>
                <IconChevronRight size={14} />
              </UnstyledButton>
            ) : null}
          </Paper>
        </Stack>
      ) : null}
      <Group justify="center" gap="xs">
        <Kbd>⌘K</Kbd>
        <Text size="xs" c="dimmed">
          to search
        </Text>
      </Group>
    </Stack>
  );
}

function FloatingControls({
  onHome,
  onCommand,
  onSync,
  syncState,
}: {
  onHome: () => void;
  onCommand: () => void;
  onSync: () => void;
  syncState: SyncState;
}) {
  const syncLabel =
    syncState === "syncing"
      ? "Syncing with Reins…"
      : syncState === "synced"
        ? "Synced"
        : syncState === "error"
          ? "Sync failed"
          : "Refresh all";
  return (
    <Paper className="app-controls" radius="xl" shadow="lg" withBorder>
      <Group gap={2} p={4}>
        <Tooltip label="Home" position="top">
          <ActionIcon size="lg" radius="xl" variant="subtle" aria-label="Home" onClick={onHome}>
            <IconHome size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Command palette" position="top">
          <ActionIcon
            size="lg"
            radius="xl"
            variant="subtle"
            aria-label="Command palette"
            onClick={onCommand}
          >
            <IconCommand size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={syncLabel} position="top">
          <ActionIcon
            size="lg"
            radius="xl"
            variant="subtle"
            aria-label="Refresh all"
            aria-busy={syncState === "syncing"}
            color={syncState === "synced" ? "green" : syncState === "error" ? "red" : undefined}
            disabled={syncState === "syncing"}
            onClick={onSync}
          >
            {syncState === "syncing" ? (
              <Loader size={16} />
            ) : syncState === "synced" ? (
              <IconCheck size={18} />
            ) : syncState === "error" ? (
              <IconAlertTriangle size={18} />
            ) : (
              <IconRefresh size={18} />
            )}
          </ActionIcon>
        </Tooltip>
        <ThemeToggle />
      </Group>
    </Paper>
  );
}

function Workspace({
  repo,
  onStatus,
  onClose,
}: {
  repo: RepoStatusType["repo"];
  onStatus: (value: RepoStatusType) => void;
  onClose: () => void;
}) {
  const { client } = useReins();
  const [active, setActive] = useState<ToolId>("status");
  const [history, setHistory] = useState<ToolId[]>([]);
  const [recent, setRecent] = useState<string[]>(() => readRecent(RECENT_KEY));
  const [graphRoot, setGraphRoot] = useState<{ symbolId: string } | null>(null);
  const [flowTarget, setFlowTarget] = useState("");
  const [gitTab, setGitTab] = useState<GitTab>("changes");
  const [surfaceTab, setSurfaceTab] = useState<SurfaceTab>("entry");
  const [knowledgeTab, setKnowledgeTab] = useState<KnowledgeTab>("notes");
  const [gitRange, setGitRange] = useState<DiffRange>({ mode: "working" });
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncVersion, setSyncVersion] = useState(0);
  const syncTimer = useRef<number | null>(null);
  const syncingRef = useRef(false);

  useEffect(
    () => () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    },
    [],
  );

  const syncAll = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncState("syncing");
    try {
      const next = await client.call<RepoStatusType>("refreshGraph", { force: true });
      onStatus(next);
      setSyncVersion((value) => value + 1);
      setSyncState("synced");
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => setSyncState("idle"), 2000);
    } catch (err) {
      setSyncState("error");
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      syncingRef.current = false;
    }
  }, [client, onStatus]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset tool state when the repository changes
  useEffect(() => {
    setGraphRoot(null);
    setFlowTarget("");
    setGitTab("changes");
    setSurfaceTab("entry");
    setKnowledgeTab("notes");
  }, [repo.root]);

  const openSwitcher = useCallback(() => {
    setRepos(readRecent(REPOS_KEY));
    setSwitchError(null);
    setSwitcherOpen(true);
  }, []);

  const removeRepo = async (path: string) => {
    setRepos(forgetRepo(path));
    if (path === repo.root) {
      try {
        await closeRepository();
      } finally {
        onClose();
      }
    }
  };

  const switchRepo = async (path?: string) => {
    setSwitchError(null);
    const response = await openRepository(path);
    if (!response) return;
    if (!response.ok || !response.data) {
      setSwitchError(response.error?.message ?? "Could not open repository.");
      return;
    }
    setRepos(rememberRepo(response.data.repo.root ?? response.data.repo.name));
    setSwitcherOpen(false);
    onStatus(response.data);
  };

  useHotkeys([["mod + K", () => spotlight.open()]]);

  useEffect(() => {
    void startupTool().then((tool) => {
      if (tool && ["status", "git", "surfaces", "knowledge"].includes(tool)) {
        setActive(tool as ToolId);
      }
    });
  }, []);

  const select = useCallback(
    (tool: ToolId) => {
      if (tool !== active) setHistory((current) => [...current, active]);
      setActive(tool);
      setRecent((current) => {
        const next = [tool, ...current.filter((item) => item !== tool)];
        writeRecent(RECENT_KEY, next);
        return next;
      });
    },
    [active],
  );

  const goBack = useCallback(() => {
    const previous = history[history.length - 1] ?? "status";
    setHistory((current) => current.slice(0, -1));
    setActive(previous);
  }, [history]);

  const openReview = useCallback(
    (range: DiffRange) => {
      setGitRange(range);
      setHistory((current) => [...current, active]);
      setActive("review");
    },
    [active],
  );

  const onNavigate = useCallback(
    (target: NavigationTarget) => {
      if (target.type === "symbol" && target.id) {
        setGraphRoot({ symbolId: target.id });
        setSurfaceTab("graph");
        select("surfaces");
      } else if (target.type === "surface" && target.id) {
        setFlowTarget(target.id);
        setSurfaceTab("flow");
        select("surfaces");
      } else if (target.type === "note") {
        setKnowledgeTab("notes");
        select("knowledge");
      } else if (target.type === "diff") {
        openReview(target.range ?? { mode: "working" });
      }
    },
    [openReview, select],
  );

  const actions = useMemo<SpotlightActionData[]>(() => {
    const recentActions: SpotlightActionData[] = recent
      .map((id) => TOOLS.find((tool) => tool.id === id))
      .filter((tool): tool is (typeof TOOLS)[number] => Boolean(tool))
      .map((tool) => ({
        id: `recent-${tool.id}`,
        label: tool.label,
        description: tool.description,
        group: "Recent",
        keywords: [tool.id, "recent"],
        leftSection: <ToolIcon id={tool.id} />,
        onClick: () => select(tool.id),
      }));
    const toolActions: SpotlightActionData[] = TOOLS.filter(
      (tool) => !recent.includes(tool.id),
    ).map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
      group: "Tools",
      keywords: [tool.id],
      leftSection: <ToolIcon id={tool.id} />,
      onClick: () => select(tool.id),
    }));
    return [
      ...recentActions,
      ...toolActions,
      {
        id: "repos",
        label: "Repositories",
        description: "List opened and saved repositories",
        group: "Repository",
        keywords: ["repos", "repositories", "recent", "saved", "opened", "switch", "list"],
        leftSection: <IconFolder size={16} />,
        onClick: openSwitcher,
      },
      {
        id: "bootstrap",
        label: "Initialize repository",
        description: "Create .reins config, knowledge folders, graph, and surfaces",
        group: "Repository",
        keywords: ["init", "setup", "bootstrap", "reinss", "start"],
        leftSection: <IconWand size={16} />,
        onClick: () => {
          setNotice("Initializing repository…");
          void client
            .call<BootstrapResult>("bootstrap")
            .then((result) => {
              onStatus(result.status);
              setNotice(
                `Initialized: ${result.created.length} paths created, graph ${result.graphBuilt ? "built" : "ready"}, ${result.surfaces} surfaces.`,
              );
            })
            .catch((err: unknown) => {
              setNotice(err instanceof Error ? err.message : String(err));
            });
        },
      },
      {
        id: "refresh",
        label: "Refresh all",
        description: "Rebuild the graph and reload every view from Reins",
        group: "Repository",
        keywords: ["build", "trail", "refresh", "sync", "reload"],
        leftSection: <IconRefresh size={16} />,
        onClick: () => void syncAll(),
      },
      {
        id: "open",
        label: "Open repository…",
        description: "Choose a folder",
        group: "Repository",
        keywords: ["open", "folder", "repo"],
        leftSection: <IconFolder size={16} />,
        onClick: () => {
          void openRepository().then((response) => {
            if (response?.ok && response.data) onStatus(response.data);
          });
        },
      },
    ];
  }, [client, onStatus, openSwitcher, recent, select, syncAll]);

  return (
    <ReinsProvider client={client} onNavigate={onNavigate} version={syncVersion}>
      <Box className="app-shell">
        <Box className="app-main">
          <Container size={1120} px="lg" py="xl">
            {notice ? (
              <Alert
                color="blue"
                variant="light"
                mb="md"
                withCloseButton
                onClose={() => setNotice(null)}
              >
                {notice}
              </Alert>
            ) : null}
            {active === "status" ? (
              <HomeTool
                repo={repo}
                recent={recent}
                onSelect={select}
                onReview={openReview}
                onOpenReviews={() => {
                  setGitTab("reviews");
                  select("git");
                }}
              />
            ) : null}
            {active === "git" ? (
              <ToolPage
                onBack={goBack}
                title="Git"
                description="Changes, history, reviews, and refs in one place."
              >
                <GitTool key={repo.root} tab={gitTab} onTab={setGitTab} onReview={openReview} />
              </ToolPage>
            ) : null}
            {active === "review" ? (
              <ToolPage
                onBack={goBack}
                title="Review"
                description={
                  gitRange.mode === "commit"
                    ? `Commit ${gitRange.hash.slice(0, 8)}`
                    : gitRange.mode === "range"
                      ? `Review ${gitRange.base.slice(0, 8)}..${gitRange.head.slice(0, 8)}`
                      : "Working tree review"
                }
              >
                <ReviewPage range={gitRange} onRange={setGitRange} />
              </ToolPage>
            ) : null}
            {active === "surfaces" ? (
              <ToolPage
                onBack={goBack}
                title="Surfaces"
                description="Entry points grouped by component, with flow and call graph."
              >
                <SurfacesTool
                  tab={surfaceTab}
                  onTab={setSurfaceTab}
                  flowTarget={flowTarget}
                  onFlowTarget={setFlowTarget}
                  graphRoot={graphRoot}
                />
              </ToolPage>
            ) : null}
            {active === "knowledge" ? (
              <ToolPage
                onBack={goBack}
                title="Knowledge"
                description="Notes, constraints, and the check that keeps them honest."
              >
                <KnowledgeTool tab={knowledgeTab} onTab={setKnowledgeTab} />
              </ToolPage>
            ) : null}
          </Container>
        </Box>

        <Box component="footer" className="app-footer">
          <Tooltip label={repo.root ?? repo.name} position="top" openDelay={250}>
            <UnstyledButton
              className="app-footer-repo"
              onClick={openSwitcher}
              aria-label="Switch repository"
            >
              <Group gap="xs" wrap="nowrap">
                <IconFolder size={14} />
                <Text size="xs" fw={600}>
                  {repo.name}
                </Text>
              </Group>
            </UnstyledButton>
          </Tooltip>
        </Box>

        <Modal
          opened={switcherOpen}
          onClose={() => setSwitcherOpen(false)}
          title="Repositories"
          centered
          radius="lg"
        >
          <Stack gap="sm">
            {repos.length === 0 ? (
              <Text size="sm" c="dimmed">
                No repositories yet.
              </Text>
            ) : null}
            {repos.map((path) => (
              <Group key={path} gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                <UnstyledButton
                  className="reins-row"
                  style={{ flex: 1, width: "auto", minWidth: 0 }}
                  onClick={() => void switchRepo(path)}
                >
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <IconFolder size={16} style={{ flexShrink: 0 }} />
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <span className="reins-row-main">{repoLabel(path)}</span>
                      <Text size="xs" c="dimmed" ff="monospace" truncate title={path}>
                        {tailPath(path)}
                      </Text>
                    </Stack>
                  </Group>
                  {path === repo.root ? (
                    <Badge size="xs" variant="light" style={{ flexShrink: 0 }}>
                      Current
                    </Badge>
                  ) : (
                    <IconChevronRight size={14} style={{ flexShrink: 0 }} />
                  )}
                </UnstyledButton>
                <Tooltip label="Remove from recent" position="left">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove ${repoLabel(path)} from recent`}
                    onClick={() => void removeRepo(path)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
            {switchError ? (
              <Alert color="red" variant="light">
                {switchError}
              </Alert>
            ) : null}
            <Button
              variant="light"
              leftSection={<IconPlus size={16} />}
              onClick={() => void switchRepo()}
            >
              Open repo
            </Button>
          </Stack>
        </Modal>

        <FloatingControls
          onHome={() => select("status")}
          onCommand={() => spotlight.open()}
          onSync={() => void syncAll()}
          syncState={syncState}
        />

        <Spotlight
          actions={actions}
          nothingFound="Nothing found"
          highlightQuery
          limit={8}
          radius="lg"
          shadow="xl"
          classNames={{ content: "app-palette" }}
          overlayProps={{ backgroundOpacity: 0.35, blur: 8 }}
          searchProps={{
            placeholder: "Open a tool, symbol, route, or note",
            leftSection: <IconSearch size={16} />,
          }}
        />
      </Box>
    </ReinsProvider>
  );
}

function Launcher({ onOpen }: { onOpen: (status: RepoStatusType) => void }) {
  const [repos, setRepos] = useState<string[]>(() => readRecent(REPOS_KEY));
  const [error, setError] = useState<string | null>(null);

  const remove = (path: string) => {
    setRepos(forgetRepo(path));
  };

  const open = async (path?: string) => {
    setError(null);
    const response = await openRepository(path);
    if (!response) return;
    if (!response.ok) {
      setError(response.error?.message ?? "Could not open repository.");
      return;
    }
    const status = response.data as RepoStatusType;
    const next = rememberRepo(status.repo.root ?? status.repo.name);
    setRepos(next);
    onOpen(status);
  };

  useHotkeys([["mod + K", () => spotlight.open()]]);

  const actions: SpotlightActionData[] = [
    {
      id: "open",
      label: "Open repository…",
      description: "Choose a folder",
      group: "Repository",
      leftSection: <IconFolder size={18} />,
      onClick: () => void open(),
    },
    ...repos.map((repo) => ({
      id: `repo-${repo}`,
      label: repoLabel(repo),
      description: repo,
      group: "Recent",
      leftSection: <IconFolder size={18} />,
      onClick: () => void open(repo),
    })),
  ];

  return (
    <Center mih="100vh" px="lg">
      <Stack w={560} maw="100%" gap="md">
        {repos.length > 0 ? (
          <Paper withBorder radius="lg" p="sm">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="xs" py={4}>
              Recent
            </Text>
            {repos.map((repo) => (
              <Group key={repo} gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                <UnstyledButton
                  className="reins-row"
                  style={{ flex: 1, width: "auto", minWidth: 0 }}
                  onClick={() => void open(repo)}
                >
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <IconFolder size={16} style={{ flexShrink: 0 }} />
                    <span className="reins-row-main">{repoLabel(repo)}</span>
                  </Group>
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text size="xs" c="dimmed" ff="monospace" truncate title={repo}>
                      {tailPath(repo)}
                    </Text>
                    <IconChevronRight size={14} style={{ flexShrink: 0 }} />
                  </Group>
                </UnstyledButton>
                <Tooltip label="Remove from recent" position="left">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove ${repoLabel(repo)} from recent`}
                    onClick={() => remove(repo)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Paper>
        ) : (
          <Text size="sm" c="dimmed" ta="center">
            No recent repositories.
          </Text>
        )}

        {error ? (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        ) : null}

        <Group justify="center" gap="xs">
          <Kbd>⌘K</Kbd>
          <Text size="xs" c="dimmed">
            to open a repository
          </Text>
        </Group>
      </Stack>

      <Spotlight
        actions={actions}
        nothingFound="Nothing found"
        highlightQuery
        limit={8}
        radius="lg"
        shadow="xl"
        classNames={{ content: "app-palette" }}
        overlayProps={{ backgroundOpacity: 0.35, blur: 8 }}
        searchProps={{
          leftSection: <IconSearch size={18} />,
          placeholder: "Open a repository",
        }}
      />
    </Center>
  );
}

function ThemeBootstrap() {
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    void startupTheme().then((theme) => {
      if (theme === "light" || theme === "dark") setColorScheme(theme);
    });
  }, [setColorScheme]);
  return null;
}

export function App() {
  const client = useMemo(() => createTauriClient(), []);
  const [status, setStatus] = useState<RepoStatusType | null>(null);

  useEffect(() => {
    void startupRepository().then((path) => {
      if (!path) return;
      void openRepository(path).then((response) => {
        if (response?.ok && response.data) {
          rememberRepo(response.data.repo.root ?? response.data.repo.name);
          setStatus(response.data);
        }
      });
    });
  }, []);

  return (
    <ReinsProvider client={client} theme="light">
      <ThemeBootstrap />
      {status ? (
        <Workspace repo={status.repo} onStatus={setStatus} onClose={() => setStatus(null)} />
      ) : (
        <Launcher onOpen={setStatus} />
      )}
    </ReinsProvider>
  );
}
