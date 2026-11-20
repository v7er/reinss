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
  GitCommit,
  GitStatus,
  GraphNode,
  GraphSlice,
  NavigationTarget,
  RepoStatus as RepoStatusType,
  SemanticDiff,
  SurfacePage,
  SymbolHit,
} from "@reins/core";
import {
  CodeViewer,
  DiffViewer,
  GraphView,
  KnowledgeBoard,
  ReinsProvider,
  ReviewWorkspace,
  SurfaceExplorer,
  ThemeToggle,
  useAsync,
  useReins,
} from "@reins/ui";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook,
  IconCheck,
  IconChevronRight,
  IconCommand,
  IconFolder,
  IconGitCompare,
  IconHome,
  IconLayoutDashboard,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSearch,
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

type ToolId = "status" | "git" | "surfaces" | "knowledge";
type GitTab = "changes" | "diff" | "review" | "history";
type SurfaceTab = "entry" | "flow" | "graph";
type KnowledgeTab = "notes" | "check";
type SyncState = "idle" | "syncing" | "synced" | "error";

const RECENT_KEY = "reins.recentTools";
const REPOS_KEY = "reins.recentRepos";

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
  { id: "git", label: "Git", description: "Changes, semantic diff, and review" },
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
  const firstPath = nodes[0]?.path;
  const expandableNodes = nodes.filter((node) => node.path !== firstPath);
  const allExpanded =
    expandableNodes.length > 0 && expandableNodes.every((node) => expanded.has(node.id));

  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(expandableNodes.map((node) => node.id)));
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
        <Switch size="sm" checked={allExpanded} onChange={toggleAll} label="Expand all code" />
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
      {state.data ? (
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
                      onClick={node.path === firstPath ? undefined : () => toggleNode(node.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="reins-row-main" style={{ paddingLeft: node.depth * 16 }}>
                        {node.path === firstPath ? null : (
                          <IconChevronRight
                            size={14}
                            style={{
                              transform: isOpen ? "rotate(90deg)" : undefined,
                              transition: "transform 120ms ease",
                            }}
                          />
                        )}
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
  const state = useAsync(() => client.call<GitCommit[]>("gitLog", { limit: 50 }), []);
  return (
    <Stack gap="sm">
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
      <Paper withBorder radius="lg" p={4}>
        <ScrollArea h={480} type="auto">
          <Stack gap={0}>
            {(state.data ?? []).map((commit) => (
              <UnstyledButton
                key={commit.hash}
                className="reins-row"
                onClick={() => onOpen(commit.hash)}
              >
                <span className="reins-row-main">
                  <Text span ff="monospace" size="xs" c="dimmed" mr={8}>
                    {commit.shortHash}
                  </Text>
                  {commit.subject}
                </span>
                <span className="reins-row-meta">
                  {commit.author} · {commit.date.slice(0, 10)}
                </span>
              </UnstyledButton>
            ))}
            {!state.loading && (state.data ?? []).length === 0 ? (
              <Text size="sm" c="dimmed" p="md">
                No commits yet.
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

function GitTool({
  range,
  onRange,
  tab,
  onTab,
  onChanged,
}: {
  range: DiffRange;
  onRange: (range: DiffRange) => void;
  tab: GitTab;
  onTab: (tab: GitTab) => void;
  onChanged: () => void;
}) {
  return (
    <Stack gap="md">
      <Group justify="space-between">
        {range.mode === "commit" ? (
          <Group gap="xs">
            <Badge variant="light" color="blue" radius="xl">
              commit {range.hash.slice(0, 8)}
            </Badge>
            <Button size="compact-sm" variant="subtle" onClick={() => onRange({ mode: "working" })}>
              Working tree
            </Button>
          </Group>
        ) : (
          <SegmentedControl
            value={range.mode}
            onChange={(value) =>
              onRange(
                value === "staged"
                  ? { mode: "staged" }
                  : value === "base"
                    ? { mode: "base" }
                    : { mode: "working" },
              )
            }
            data={[
              { label: "Working", value: "working" },
              { label: "Staged", value: "staged" },
              { label: "Base", value: "base" },
            ]}
            radius="xl"
          />
        )}
        <Badge variant="light" color="gray" radius="xl">
          {range.mode}
        </Badge>
      </Group>
      <Tabs value={tab} onChange={(value) => value && onTab(value as GitTab)}>
        <Tabs.List>
          <Tabs.Tab value="changes">Changes</Tabs.Tab>
          <Tabs.Tab value="diff">Diff</Tabs.Tab>
          <Tabs.Tab value="review">Review</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="changes" pt="md">
          <GitChanges onChanged={onChanged} />
        </Tabs.Panel>
        <Tabs.Panel value="diff" pt="md">
          <DiffViewer range={range} height={560} />
        </Tabs.Panel>
        <Tabs.Panel value="review" pt="md">
          <ReviewWorkspace range={range} height={560} />
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <GitHistory
            onOpen={(hash) => {
              onRange({ mode: "commit", hash });
              onTab("diff");
            }}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
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

function HomeTool({ recent, onSelect }: { recent: string[]; onSelect: (tool: ToolId) => void }) {
  const ordered = [
    ...recent
      .map((id) => TOOLS.find((tool) => tool.id === id))
      .filter((tool): tool is (typeof TOOLS)[number] => tool !== undefined && tool.id !== "status"),
    ...TOOLS.filter((tool) => tool.id !== "status" && !recent.includes(tool.id)),
  ];

  return (
    <Stack gap="lg" maw={620} mx="auto" py="xl">
      <Group gap="sm" align="center">
        <img src={appIcon} alt="" width={44} height={44} style={{ borderRadius: 12 }} />
        <Stack gap={0}>
          <Title order={2} size="h2" fw={650}>
            Reins
          </Title>
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

  const openSwitcher = () => {
    setRepos(readRecent(REPOS_KEY));
    setSwitchError(null);
    setSwitcherOpen(true);
  };

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
        setGitTab("review");
        select("git");
      }
    },
    [select],
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
        id: "bootstrap",
        label: "Initialize repository",
        description: "Create .reins config, knowledge folders, graph, and surfaces",
        group: "Repository",
        keywords: ["init", "setup", "bootstrap", "reins", "start"],
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
  }, [client, onStatus, recent, select, syncAll]);

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
            {active === "status" ? <HomeTool recent={recent} onSelect={select} /> : null}
            {active === "git" ? (
              <ToolPage
                onBack={goBack}
                title="Git"
                description="Working tree, semantic diff, and review in one place."
              >
                <GitTool
                  range={gitRange}
                  onRange={setGitRange}
                  tab={gitTab}
                  onTab={setGitTab}
                  onChanged={() => setGitRange((current) => ({ ...current }))}
                />
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
            <Group justify="space-between">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Recent
              </Text>
              <Tooltip label="Add repository" position="left">
                <ActionIcon
                  variant="light"
                  radius="xl"
                  aria-label="Add repository"
                  onClick={() => void switchRepo()}
                >
                  <IconPlus size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {repos.length === 0 ? (
              <Text size="sm" c="dimmed">
                No repositories yet. Add one with +.
              </Text>
            ) : null}
            {repos.map((path) => (
              <Group key={path} gap={4} wrap="nowrap">
                <UnstyledButton
                  className="reins-row"
                  style={{ flex: 1, width: "auto" }}
                  onClick={() => void switchRepo(path)}
                >
                  <Group gap="sm" wrap="nowrap">
                    <IconFolder size={16} />
                    <Stack gap={0}>
                      <span className="reins-row-main">{repoLabel(path)}</span>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {path}
                      </Text>
                    </Stack>
                  </Group>
                  {path === repo.root ? (
                    <Badge size="xs" variant="light">
                      Current
                    </Badge>
                  ) : (
                    <IconChevronRight size={14} />
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
              <Group key={repo} gap={4} wrap="nowrap">
                <UnstyledButton
                  className="reins-row"
                  style={{ flex: 1, width: "auto" }}
                  onClick={() => void open(repo)}
                >
                  <Group gap="sm">
                    <IconFolder size={16} />
                    <span className="reins-row-main">{repoLabel(repo)}</span>
                  </Group>
                  <Group gap="xs">
                    <span className="reins-row-meta">{repo}</span>
                    <IconChevronRight size={14} />
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
