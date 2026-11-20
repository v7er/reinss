import { Badge, Group, Paper, ScrollArea, Stack, Text, UnstyledButton } from "@mantine/core";
import type { DiffRange, NoteSummary, SemanticDiff } from "@reins/core";
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

  return (
    <div className="reins-review" style={{ minHeight: height }}>
      <section className="reins-review-main">
        <DiffViewer range={range} height={height} />
      </section>
      <aside className="reins-review-side">
        <Paper withBorder radius="lg" p="md">
          <Stack gap="sm">
            <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.06em" }}>
              Graph context
            </Text>
            {firstSymbol ? (
              <GraphView root={{ symbolId: firstSymbol }} direction="both" depth={1} height={260} />
            ) : (
              <Text size="sm" c="dimmed">
                Select a change with a symbol to see its graph.
              </Text>
            )}
          </Stack>
        </Paper>
        <Paper withBorder radius="lg" p="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text
                size="xs"
                tt="uppercase"
                c="dimmed"
                fw={600}
                style={{ letterSpacing: "0.06em" }}
              >
                Knowledge
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {notes.data?.length ?? 0}
              </Badge>
            </Group>
            <ScrollArea h={220} type="auto">
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
        </Paper>
      </aside>
    </div>
  );
}
