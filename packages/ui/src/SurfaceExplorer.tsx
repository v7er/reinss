import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { Component, Surface, SurfacePage } from "@reinss/core";
import { IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface SurfaceExplorerProps {
  kind?: Surface["kind"];
  framework?: string;
  height?: number;
}

const kindColor: Record<Component["kind"], string> = {
  webapp: "blue",
  mobile: "grape",
  backoffice: "orange",
  core: "teal",
  cli: "cyan",
  service: "indigo",
  library: "gray",
  unknown: "gray",
};

export function SurfaceExplorer({ kind, framework, height = 520 }: SurfaceExplorerProps) {
  const { client, onNavigate } = useReins();
  const [query, setQuery] = useState("");
  const [component, setComponent] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(false);
  const [openapiOnly, setOpenapiOnly] = useState(false);
  const state = useAsync(
    () =>
      client.call<SurfacePage>("listSurfaces", {
        ...(kind ? { kind } : {}),
        ...(framework ? { framework } : {}),
        ...(query ? { query } : {}),
        ...(component ? { component } : {}),
        ...(changedOnly ? { changed: true } : {}),
        ...(openapiOnly ? { evidence: "openapi" } : {}),
        range: { mode: "working" },
        limit: 500,
      }),
    [kind, framework, query, component, changedOnly, openapiOnly],
  );

  const componentOptions = useMemo(() => {
    const components = state.data?.components ?? [];
    const kinds = [...new Set(components.map((item) => item.kind))];
    return [
      {
        group: "Kind",
        items: kinds.map((item) => ({ value: item, label: item })),
      },
      {
        group: "Component",
        items: components.map((item) => ({
          value: item.id,
          label: `${item.name} (${item.kind})`,
        })),
      },
    ];
  }, [state.data]);

  const groups = useMemo(() => {
    const data = state.data;
    if (!data) return [];
    const buckets = new Map<string, Surface[]>();
    for (const surface of data.items) {
      const list = buckets.get(surface.componentId) ?? [];
      list.push(surface);
      buckets.set(surface.componentId, list);
    }
    return data.components
      .filter((component) => buckets.has(component.id))
      .map((component) => ({ component, surfaces: buckets.get(component.id) ?? [] }));
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
          leftSection={<IconSearch size={16} />}
          style={{ flex: 1, maxWidth: 420 }}
        />
        <Group gap="md">
          <Select
            value={component}
            onChange={setComponent}
            data={componentOptions}
            placeholder="All components"
            aria-label="Filter by component"
            clearable
            searchable
            radius="xl"
            style={{ width: 220 }}
          />
          <Switch
            size="sm"
            checked={changedOnly}
            onChange={(event) => setChangedOnly(event.currentTarget.checked)}
            label="Changed only"
          />
          <Switch
            size="sm"
            checked={openapiOnly}
            onChange={(event) => setOpenapiOnly(event.currentTarget.checked)}
            label="OpenAPI only"
          />
          <Badge variant="light" color="gray" radius="xl">
            {state.data?.total ?? 0} surfaces
          </Badge>
        </Group>
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
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap="lg">
          {groups.map(({ component, surfaces }) => (
            <Stack key={component.id} gap={4}>
              <Group gap="xs">
                <Text
                  size="xs"
                  tt="uppercase"
                  c="dimmed"
                  fw={600}
                  style={{ letterSpacing: "0.06em" }}
                >
                  {component.name}
                </Text>
                <Badge size="xs" variant="light" color={kindColor[component.kind]}>
                  {component.kind}
                </Badge>
                <Text size="xs" c="dimmed">
                  {surfaces.length}
                </Text>
                {component.changed ? (
                  <Badge size="xs" variant="filled" color="yellow">
                    changed
                  </Badge>
                ) : null}
              </Group>
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
                      {surface.change ? (
                        <Badge
                          size="xs"
                          ml={8}
                          variant="light"
                          color={surface.change.touched ? "yellow" : "gray"}
                        >
                          {surface.change.touched ? "changed" : "file"}
                        </Badge>
                      ) : null}
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
              {changedOnly
                ? "No surfaces changed in the working tree."
                : "No surfaces found. Try a repository with Express, Hono, Next.js, React Router, Commander, or FastAPI."}
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
