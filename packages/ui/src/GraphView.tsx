import {
  Background,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import dagre from "dagre";
import { useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { GraphRequest, GraphSlice } from "@reinss/core";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

type SymbolNodeData = {
  label: string;
  path: string;
  line: number;
  kind: string;
  depth: number;
};

function SymbolNode({ data }: NodeProps<Node<SymbolNodeData>>) {
  return (
    <div className={`reins-node reins-node-${data.kind}`} title={`${data.path}:${data.line}`}>
      <Handle type="target" position={Position.Top} />
      <div className="reins-node-name">{data.label}</div>
      <div className="reins-node-path">
        {data.path}:{data.line}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { symbol: SymbolNode };

function layout(slice: GraphSlice): { nodes: Node<SymbolNodeData>[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 64, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of slice.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of slice.edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  const nodes: Node<SymbolNodeData>[] = slice.nodes.map((node) => {
    const position = graph.node(node.id) as { x?: number; y?: number } | undefined;
    return {
      id: node.id,
      type: "symbol",
      position: {
        x: (position?.x ?? 0) - NODE_WIDTH / 2,
        y: (position?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: {
        label: node.name,
        path: node.path,
        line: node.startLine,
        kind: node.kind,
        depth: node.depth,
      },
    };
  });

  const edges: Edge[] = slice.edges.map((edge) => ({
    id: `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
    animated: false,
    style: { stroke: "var(--reins-hairline-strong)" },
  }));

  return { nodes, edges };
}

export interface GraphViewProps {
  root?: GraphRequest["root"];
  data?: GraphSlice;
  direction?: "in" | "out" | "both";
  depth?: number;
  maxNodes?: number;
  height?: number;
  showModeSwitch?: boolean;
}

export function GraphView({
  root,
  data,
  direction = "in",
  depth = 1,
  maxNodes = 500,
  height = 520,
  showModeSwitch = true,
}: GraphViewProps) {
  const { client, onNavigate } = useReins();
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const request: GraphRequest | null = root ? { root, direction, depth, maxNodes } : null;
  const state = useAsync(
    () =>
      data
        ? Promise.resolve(data)
        : request
          ? client.call<GraphSlice>("graph", request)
          : Promise.resolve(null),
    [data, JSON.stringify(root ?? null), direction, depth, maxNodes],
  );

  const graph = useMemo(
    () => (state.data ? layout(state.data) : { nodes: [], edges: [] }),
    [state.data],
  );

  if (state.loading) {
    return (
      <Paper p="md">
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading graph…
          </Text>
        </Group>
      </Paper>
    );
  }
  if (state.error) {
    if ((state.error as Error & { code?: string }).code === "SYMBOL_NOT_FOUND") {
      return (
        <Text size="sm" c="dimmed">
          No graph context for this symbol. Rebuild the graph after adding files.
        </Text>
      );
    }
    return (
      <Alert color="red" variant="light" title="Graph unavailable">
        {state.error.message}
      </Alert>
    );
  }
  if (!state.data) return null;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {state.data.nodes.length} nodes · depth {state.data.effectiveDepth} ·{" "}
            {state.data.direction}
          </Text>
          {state.data.truncated ? (
            <Badge size="xs" color="yellow" variant="light">
              truncated
            </Badge>
          ) : null}
          {!state.data.revision.inSync ? (
            <Badge size="xs" color="orange" variant="light">
              stale
            </Badge>
          ) : null}
        </Group>
        {showModeSwitch ? (
          <SegmentedControl
            size="xs"
            radius="xl"
            value={mode}
            onChange={(value) => setMode(value as "graph" | "list")}
            data={[
              { label: "Graph", value: "graph" },
              { label: "List", value: "list" },
            ]}
          />
        ) : null}
      </Group>
      {mode === "graph" ? (
        <Paper withBorder radius="lg" p={0} className="reins-canvas" style={{ height }}>
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.2}
            maxZoom={1.8}
            onNodeClick={(_, node) => onNavigate?.({ type: "symbol", id: node.id })}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </Paper>
      ) : (
        <ScrollArea h={height} type="auto">
          <Stack gap={0}>
            {state.data.nodes.map((node) => (
              <UnstyledButton
                key={node.id}
                className="reins-row"
                onClick={() => onNavigate?.({ type: "symbol", id: node.id })}
              >
                <span className="reins-row-main">{node.name}</span>
                <span className="reins-row-meta">
                  {node.path}:{node.startLine}
                </span>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}
