import { Badge, Group, Text } from "@mantine/core";
import type { RepoStatus as RepoStatusType } from "@reins/core";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface RepoStatusProps {
  compact?: boolean;
}

export function RepoStatus({ compact = false }: RepoStatusProps) {
  const { client } = useReins();
  const state = useAsync(() => client.call<RepoStatusType>("status"), []);

  if (state.loading) {
    return (
      <Text size="sm" c="dimmed">
        Checking repository…
      </Text>
    );
  }
  if (state.error) {
    return (
      <Text size="sm" c="red">
        {state.error.message}
      </Text>
    );
  }
  if (!state.data) return null;
  const status = state.data;

  return (
    <Group gap="xs" wrap="wrap">
      <span className={`reins-dot state-${status.graph.state}`} aria-hidden="true" />
      <Text fw={650} size="sm">
        {status.repo.name}
      </Text>
      <Badge size="xs" variant="light" color={status.graph.state === "ready" ? "green" : "orange"}>
        {status.graph.state}
      </Badge>
      <Text size="xs" c="dimmed">
        {status.graph.nodes ?? 0} nodes
      </Text>
      <Text size="xs" c="dimmed">
        Trail {status.trail.version ?? "missing"}
      </Text>
      {status.git.head ? (
        <Text size="xs" c="dimmed" ff="monospace">
          {status.git.head.slice(0, 8)}
        </Text>
      ) : null}
      {status.git.dirty ? (
        <Badge size="xs" variant="light" color="yellow">
          dirty
        </Badge>
      ) : null}
      {!compact ? (
        <>
          <Text size="xs" c="dimmed">
            {status.knowledge.notes} notes
          </Text>
          <Text size="xs" c="dimmed">
            {status.surfaces.count} surfaces
          </Text>
        </>
      ) : null}
      {status.graph.message ? (
        <Text size="xs" c="orange">
          {status.graph.message}
        </Text>
      ) : null}
    </Group>
  );
}
