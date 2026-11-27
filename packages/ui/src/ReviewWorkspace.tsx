import { Badge, Group, ScrollArea, Stack, Tabs, Text, UnstyledButton } from "@mantine/core";
import type { DiffRange, KnowledgeTree, SemanticDiff } from "@reinss/core";
import { useReins } from "./context.js";
import { DiffViewer } from "./DiffViewer.js";
import { GraphView } from "./GraphView.js";
import { useAsync } from "./useAsync.js";

export interface ReviewWorkspaceProps {
  range: DiffRange;
  height?: number;
}

export function ReviewWorkspace({ range, height = 640 }: ReviewWorkspaceProps) {
  const { client, onNavigate } = useReins();
  const diff = useAsync(
    () => client.call<SemanticDiff>("diff", { range }),
    [JSON.stringify(range)],
  );
  const tree = useAsync(() => client.call<KnowledgeTree>("knowledgeTree"), []);
  const nodes = (tree.data?.nodes ?? []).filter(
    (node) => node.source === "reins" && node.status === "accepted",
  );

  const firstSymbol =
    diff.data?.files
      .filter((file) => !file.path.startsWith(".trail/"))
      .flatMap((file) => file.changes)
      .find((change) => change.symbol.id)?.symbol.id ?? null;

  const contentHeight = Math.max(240, height - 48);

  return (
    <Tabs defaultValue="files" keepMounted={false}>
      <Tabs.List>
        <Tabs.Tab value="files">Files</Tabs.Tab>
        <Tabs.Tab value="graph">Graph</Tabs.Tab>
        <Tabs.Tab value="knowledge">Knowledge</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="files" pt="sm">
        <DiffViewer range={range} height={contentHeight} fill />
      </Tabs.Panel>
      <Tabs.Panel value="graph" pt="sm">
        {firstSymbol ? (
          <GraphView
            root={{ symbolId: firstSymbol }}
            direction="both"
            depth={1}
            height={contentHeight}
          />
        ) : (
          <Text size="sm" c="dimmed">
            Select a change with a symbol to see its graph.
          </Text>
        )}
      </Tabs.Panel>
      <Tabs.Panel value="knowledge" pt="sm">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Nodes
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {nodes.length}
            </Badge>
          </Group>
          <ScrollArea h={contentHeight - 32} type="auto">
            <Stack gap={0}>
              {nodes.map((node) => (
                <UnstyledButton
                  key={node.address}
                  className="reins-row"
                  onClick={() => onNavigate?.({ type: "node", id: node.address })}
                >
                  <span className="reins-row-main">{node.title}</span>
                  <span className="reins-row-meta">
                    {node.type} · {node.status}
                  </span>
                </UnstyledButton>
              ))}
            </Stack>
          </ScrollArea>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}
