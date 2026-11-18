import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { Spotlight, type SpotlightActionData, spotlight } from "@mantine/spotlight";
import type {
  CheckReport,
  GraphSlice,
  NavigationTarget,
  RepoStatus as RepoStatusType,
  SymbolHit,
} from "@reins/core";
import {
  DiffViewer,
  GraphView,
  KnowledgeBoard,
  ReinsProvider,
  RepoStatus,
  ReviewWorkspace,
  SurfaceExplorer,
  useAsync,
  useReins,
} from "@reins/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createTauriClient, openRepository } from "./client.js";

type ToolId = "status" | "graph" | "surfaces" | "diff" | "knowledge" | "review" | "flow" | "check";

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

  return (
    <Stack gap="md">
      <Group>
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search a symbol, then pick a root"
          aria-label="Search symbols"
          radius="xl"
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
              {(search.data ?? []).map((hit) => (
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
              {query && !search.loading && (search.data ?? []).length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  No symbols. Check the graph status first.
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

function FlowTool({ target, onTarget }: { target: string; onTarget: (value: string) => void }) {
  const { client } = useReins();
  const [input, setInput] = useState(target);
  useEffect(() => setInput(target), [target]);
  const state = useAsync(
    () => (target ? client.call<GraphSlice>("flow", { target, depth: 3 }) : Promise.resolve(null)),
    [target],
  );
  return (
    <Stack gap="md">
      <Group>
        <TextInput
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Route, surface ID, or symbol ID"
          aria-label="Flow target"
          radius="xl"
          style={{ flex: 1, maxWidth: 480 }}
        />
        <Button radius="xl" onClick={() => onTarget(input)}>
          Trace
        </Button>
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
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data ? (
        <Paper withBorder radius="lg" p={4}>
          <ScrollArea h={420} type="auto">
            <Stack gap={0}>
              {state.data.nodes.map((node) => (
                <div key={node.id} className="reins-row">
                  <span className="reins-row-main" style={{ paddingLeft: node.depth * 16 }}>
                    {node.name}
                  </span>
                  <span className="reins-row-meta">
                    {node.path}:{node.startLine}
                  </span>
                </div>
              ))}
            </Stack>
          </ScrollArea>
        </Paper>
      ) : null}
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

function StatusTool({ status }: { status: RepoStatusType }) {
  return (
    <Stack gap="lg">
      <RepoStatus />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <Paper withBorder radius="lg" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Graph
          </Text>
          <Text fw={650} mt={4}>
            {status.graph.state}
          </Text>
          <Text size="sm" c="dimmed">
            {status.graph.nodes ?? 0} nodes
          </Text>
          <Text size="sm" c="dimmed">
            Trail {status.trail.version ?? "missing"}
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Git
          </Text>
          <Text fw={650} mt={4} ff="monospace">
            {status.git.head?.slice(0, 12) ?? "no repository"}
          </Text>
          <Text size="sm" c="dimmed">
            {status.git.branch ?? ""}
          </Text>
          <Text size="sm" c="dimmed">
            {status.git.dirty ? "working tree dirty" : "clean"}
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Knowledge
          </Text>
          <Text fw={650} mt={4}>
            {status.knowledge.notes} notes
          </Text>
          <Text size="sm" c="dimmed">
            {status.knowledge.proposed} proposed
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Surfaces
          </Text>
          <Text fw={650} mt={4}>
            {status.surfaces.count}
          </Text>
          <Text size="sm" c="dimmed">
            {status.surfaces.stale ? "cache stale" : "cache fresh"}
          </Text>
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}

function Workspace({
  status,
  onStatus,
}: {
  status: RepoStatusType;
  onStatus: (value: RepoStatusType) => void;
}) {
  const { client } = useReins();
  const [active, setActive] = useState<ToolId>("status");
  const [recent, setRecent] = useState<string[]>(() => readRecent(RECENT_KEY));
  const [graphRoot, setGraphRoot] = useState<{ symbolId: string } | null>(null);
  const [flowTarget, setFlowTarget] = useState("");

  useHotkeys([["mod + K", () => spotlight.open()]]);

  const select = useCallback((tool: ToolId) => {
    setActive(tool);
    setRecent((current) => {
      const next = [tool, ...current.filter((item) => item !== tool)];
      writeRecent(RECENT_KEY, next);
      return next;
    });
  }, []);

  const onNavigate = useCallback(
    (target: NavigationTarget) => {
      if (target.type === "symbol" && target.id) {
        setGraphRoot({ symbolId: target.id });
        select("graph");
      } else if (target.type === "surface" && target.id) {
        setFlowTarget(target.id);
        select("flow");
      } else if (target.type === "note") {
        select("knowledge");
      } else if (target.type === "diff") {
        select("review");
      }
    },
    [select],
  );

  const actions = useMemo<SpotlightActionData[]>(() => {
    const tools: Array<{ id: ToolId; label: string; description: string }> = [
      { id: "status", label: "Repository status", description: "Graph, Trail, Git, knowledge" },
      { id: "graph", label: "Graph explorer", description: "Callers and callees" },
      { id: "surfaces", label: "Surfaces", description: "Routes, pages, commands" },
      { id: "diff", label: "Semantic diff", description: "Working tree" },
      { id: "knowledge", label: "Knowledge board", description: "Decisions and constraints" },
      { id: "review", label: "Review workspace", description: "Diff, graph, knowledge" },
      { id: "flow", label: "Trace a flow", description: "Route to handler" },
      { id: "check", label: "Check knowledge and links", description: "Constraints" },
    ];
    const recentActions: SpotlightActionData[] = recent
      .map((id) => tools.find((tool) => tool.id === id))
      .filter((tool): tool is (typeof tools)[number] => Boolean(tool))
      .map((tool) => ({
        id: `recent-${tool.id}`,
        label: tool.label,
        description: tool.description,
        group: "Recent",
        keywords: [tool.id, "recent"],
        onClick: () => select(tool.id),
      }));
    const toolActions: SpotlightActionData[] = tools
      .filter((tool) => !recent.includes(tool.id))
      .map((tool) => ({
        id: tool.id,
        label: tool.label,
        description: tool.description,
        group: "Tools",
        keywords: [tool.id],
        onClick: () => select(tool.id),
      }));
    return [
      ...recentActions,
      ...toolActions,
      {
        id: "refresh",
        label: "Rebuild graph",
        description: "Run trail build",
        group: "Repository",
        keywords: ["build", "trail", "refresh"],
        onClick: () => {
          void client.call<RepoStatusType>("refreshGraph", { force: true }).then(onStatus);
        },
      },
      {
        id: "open",
        label: "Open repository…",
        description: "Choose a folder",
        group: "Repository",
        keywords: ["open", "folder", "repo"],
        onClick: () => {
          void openRepository().then((response) => {
            if (response?.ok && response.data) onStatus(response.data);
          });
        },
      },
    ];
  }, [client, onStatus, recent, select]);

  return (
    <ReinsProvider client={client} onNavigate={onNavigate}>
      <Box className="app-shell">
        <Box className="app-main">
          <Container size={1180} px="lg" py="xl">
            {active === "status" ? <StatusTool status={status} /> : null}
            {active === "graph" ? (
              <GraphTool key={graphRoot?.symbolId ?? "none"} initial={graphRoot} />
            ) : null}
            {active === "surfaces" ? <SurfaceExplorer height={600} /> : null}
            {active === "diff" ? <DiffViewer range={{ mode: "working" }} height={600} /> : null}
            {active === "knowledge" ? <KnowledgeBoard height={600} /> : null}
            {active === "review" ? (
              <ReviewWorkspace range={{ mode: "working" }} height={600} />
            ) : null}
            {active === "flow" ? <FlowTool target={flowTarget} onTarget={setFlowTarget} /> : null}
            {active === "check" ? <CheckTool /> : null}
          </Container>
        </Box>

        <Spotlight
          actions={actions}
          nothingFound="Nothing found"
          highlightQuery
          limit={8}
          radius="lg"
          shadow="xl"
          overlayProps={{ backgroundOpacity: 0.35, blur: 8 }}
          searchProps={{
            placeholder: "Open a tool, symbol, route, or note",
            leftSection: <Text size="xs">⌘K</Text>,
          }}
        />
      </Box>
    </ReinsProvider>
  );
}

function Launcher({ onOpen }: { onOpen: (status: RepoStatusType) => void }) {
  const [repos, setRepos] = useState<string[]>(() => readRecent(REPOS_KEY));
  const [error, setError] = useState<string | null>(null);

  const open = async (path?: string) => {
    setError(null);
    const response = await openRepository(path);
    if (!response) return;
    if (!response.ok) {
      setError(response.error?.message ?? "Could not open repository.");
      return;
    }
    const status = response.data as RepoStatusType;
    const next = [
      status.repo.root ?? status.repo.name,
      ...repos.filter((item) => item !== status.repo.root),
    ];
    writeRecent(REPOS_KEY, next);
    setRepos(next);
    onOpen(status);
  };

  return (
    <Center mih="100vh" px="lg">
      <Paper withBorder radius="lg" shadow="lg" p="xl" w={560} maw="100%">
        <Stack gap="lg">
          <Group gap="sm">
            <span className="app-mark" aria-hidden="true" />
            <Title order={1} size="h2" fw={650}>
              reins
            </Title>
          </Group>
          <Text c="dimmed" size="sm">
            Structure, intent, and review in one local workspace. Open a repository with a Trail
            graph.
          </Text>
          <Button radius="xl" size="md" onClick={() => void open()} w="fit-content">
            Open repository
          </Button>
          {error ? (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          ) : null}
          {repos.length > 0 ? (
            <Stack gap={4}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Recent
              </Text>
              <Paper withBorder radius="lg" p={4}>
                {repos.map((repo) => (
                  <UnstyledButton key={repo} className="reins-row" onClick={() => void open(repo)}>
                    <span className="reins-row-main">{repo.split("/").pop()}</span>
                    <span className="reins-row-meta">{repo}</span>
                  </UnstyledButton>
                ))}
              </Paper>
            </Stack>
          ) : null}
          <Text size="xs" c="dimmed">
            Requires Trail 0.28 or newer. Reins never installs it or builds a graph without asking.
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}

export function App() {
  const client = useMemo(() => createTauriClient(), []);
  const [status, setStatus] = useState<RepoStatusType | null>(null);

  return (
    <ReinsProvider client={client} theme="system">
      {status ? (
        <Workspace status={status} onStatus={setStatus} />
      ) : (
        <Launcher onOpen={setStatus} />
      )}
    </ReinsProvider>
  );
}
