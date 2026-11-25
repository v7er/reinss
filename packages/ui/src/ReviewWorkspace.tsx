import { Badge, Group, ScrollArea, Stack, Tabs, Text, UnstyledButton } from "@mantine/core";
import type { DiffRange, NoteSummary, SemanticDiff } from "@reinss/core";
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
  const notes = useAsync(() => client.call<NoteSummary[]>("listNotes", { limit: 20 }), []);

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
              Notes
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {notes.data?.length ?? 0}
            </Badge>
          </Group>
          <ScrollArea h={contentHeight - 32} type="auto">
            <Stack gap={0}>
              {(notes.data ?? []).map((note) => (
                <UnstyledButton
                  key={note.id}
                  className="reins-row"
                  onClick={() => onNavigate?.({ type: "note", id: note.id })}
                >
                  <span className="reins-row-main">{note.title}</span>
                  <span className="reins-row-meta">
                    {note.type} · {note.status}
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
