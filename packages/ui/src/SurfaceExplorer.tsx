import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { Surface, SurfacePage } from "@reins/core";
import { useMemo, useState } from "react";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface SurfaceExplorerProps {
  kind?: Surface["kind"];
  framework?: string;
  height?: number;
}

export function SurfaceExplorer({ kind, framework, height = 520 }: SurfaceExplorerProps) {
  const { client, onNavigate } = useReins();
  const [query, setQuery] = useState("");
  const state = useAsync(
    () =>
      client.call<SurfacePage>("listSurfaces", {
        ...(kind ? { kind } : {}),
        ...(framework ? { framework } : {}),
        ...(query ? { query } : {}),
        limit: 500,
      }),
    [kind, framework, query],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Surface[]>();
    for (const surface of state.data?.items ?? []) {
      const key = `${surface.kind} · ${surface.framework}`;
      const list = map.get(key) ?? [];
      list.push(surface);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [state.data]);

  return (
    <Stack gap="sm" h={height}>
      <Group justify="space-between">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Filter routes, pages, commands"
          aria-label="Filter surfaces"
          radius="xl"
          style={{ flex: 1, maxWidth: 420 }}
        />
        <Badge variant="light" color="gray" radius="xl">
          {state.data?.total ?? 0} surfaces
        </Badge>
      </Group>
      {state.loading ? (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Scanning entry points…
          </Text>
        </Group>
      ) : null}
      {state.error ? (
        <Alert color="red" variant="light">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data?.stale ? (
        <Alert color="orange" variant="light">
          Graph may be stale; surfaces are cached.
        </Alert>
      ) : null}
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap="lg">
          {groups.map(([group, surfaces]) => (
            <Stack key={group} gap={4}>
              <Text
                size="xs"
                tt="uppercase"
                c="dimmed"
                fw={600}
                style={{ letterSpacing: "0.06em" }}
              >
                {group}
              </Text>
              <Paper withBorder radius="lg" p={4}>
                {surfaces.map((surface) => (
                  <UnstyledButton
                    key={`${surface.id}-${surface.file}-${surface.line}`}
                    className="reins-row"
                    onClick={() => onNavigate?.({ type: "surface", id: surface.id })}
                  >
                    <span className="reins-row-main">
                      {surface.method ? `${surface.method} ` : ""}
                      {surface.route ?? surface.label}
                    </span>
                    <span className="reins-row-meta">
                      {surface.file}:{surface.line}
                      {surface.symbolName ? ` · ${surface.symbolName}` : ""}
                    </span>
                  </UnstyledButton>
                ))}
              </Paper>
            </Stack>
          ))}
          {state.data && state.data.items.length === 0 ? (
            <Text size="sm" c="dimmed">
              No surfaces found. Try a repository with Express, Hono, Next.js, React Router,
              Commander, or FastAPI.
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
