import { Alert, Badge, Button, Group, Loader, Paper, ScrollArea, Stack, Text } from "@mantine/core";
import type { KnowledgeNote, NoteSummary } from "@reins/core";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface KnowledgeBoardProps {
  height?: number;
  filter?: string;
}

interface Position {
  x: number;
  y: number;
}

export function KnowledgeBoard({ height = 560, filter }: KnowledgeBoardProps) {
  const { client, onNavigate } = useReins();
  const [selected, setSelected] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const state = useAsync(
    () =>
      client.call<NoteSummary[]>("listNotes", { ...(filter ? { query: filter } : {}), limit: 100 }),
    [filter],
  );
  const noteState = useAsync(
    () =>
      selected ? client.call<KnowledgeNote>("getNote", { id: selected }) : Promise.resolve(null),
    [selected],
  );

  const notes = state.data ?? [];
  const layout = useMemo(() => {
    const result: Record<string, Position> = {};
    notes.forEach((note, index) => {
      result[note.id] = positions[note.id] ?? {
        x: 24 + (index % 3) * 260,
        y: 24 + Math.floor(index / 3) * 150,
      };
    });
    return result;
  }, [notes, positions]);

  const onPointerDown = (event: React.PointerEvent, id: string) => {
    const start = layout[id] ?? { x: 0, y: 0 };
    drag.current = { id, dx: event.clientX - start.x, dy: event.clientY - start.y };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag.current) return;
    const { id, dx, dy } = drag.current;
    setPositions((current) => ({
      ...current,
      [id]: { x: Math.max(0, event.clientX - dx), y: Math.max(0, event.clientY - dy) },
    }));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="reins-board" style={{ height }}>
      <div className="reins-board-canvas" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {state.loading ? (
          <Group gap="sm" p="md">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading knowledge…
            </Text>
          </Group>
        ) : null}
        {state.error ? (
          <Alert color="red" variant="light" m="md">
            {state.error.message}
          </Alert>
        ) : null}
        {notes.map((note) => (
          <Paper
            key={note.id}
            component="button"
            withBorder
            radius="lg"
            p="md"
            className={`reins-card ${selected === note.id ? "is-active" : ""}`}
            style={{
              transform: `translate(${layout[note.id]?.x ?? 0}px, ${layout[note.id]?.y ?? 0}px)`,
            }}
            onPointerDown={(event) => onPointerDown(event, note.id)}
            onClick={() => {
              setSelected(note.id);
              onNavigate?.({ type: "note", id: note.id });
            }}
          >
            <Badge size="xs" variant="light" color="blue" radius="sm">
              {note.type}
            </Badge>
            <Text fw={600} size="sm" ta="left">
              {note.title}
            </Text>
            <Text size="xs" c="dimmed" ta="left">
              {note.status} · {note.updated}
            </Text>
          </Paper>
        ))}
        {!state.loading && notes.length === 0 ? (
          <Text size="sm" c="dimmed" p="md">
            No notes yet. Propose one with `reins propose` or the MCP tool.
          </Text>
        ) : null}
      </div>
      {selected ? (
        <aside className="reins-board-detail">
          <Stack gap="sm">
            <Button size="compact-sm" variant="subtle" onClick={() => setSelected(null)}>
              Close
            </Button>
            {noteState.loading ? (
              <Group gap="sm">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  Loading note…
                </Text>
              </Group>
            ) : null}
            {noteState.data ? (
              <ScrollArea type="auto">
                <div className="reins-markdown">
                  <Text fw={650} size="lg">
                    {noteState.data.title}
                  </Text>
                  <Text size="xs" c="dimmed" mb="sm">
                    {noteState.data.type} · {noteState.data.status} · {noteState.data.path}
                  </Text>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{noteState.data.body}</ReactMarkdown>
                </div>
              </ScrollArea>
            ) : null}
          </Stack>
        </aside>
      ) : null}
    </div>
  );
}
