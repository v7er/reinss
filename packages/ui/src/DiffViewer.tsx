import { javascript } from "@codemirror/lang-javascript";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { DiffRange, FileDiff, SemanticChange, SemanticDiff } from "@reins/core";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface DiffViewerProps {
  range: DiffRange;
  height?: number;
}

function operationLabel(change: SemanticChange): string {
  const name = change.symbol.name;
  if (change.kind === "moved") {
    return `moved ${name}${change.flags.renamed ? ` (renamed from ${change.detail?.renamedFrom ?? "?"})` : ""}`;
  }
  if (change.kind === "renamed") return `renamed ${change.detail?.renamedFrom ?? "?"} to ${name}`;
  if (change.kind === "reformatted") return `reformatted ${name}`;
  if (change.kind === "extracted") return `extracted ${name}`;
  if (change.kind === "inlined") return `inlined ${name}`;
  return `${change.kind} ${name}`;
}

export function DiffViewer({ range, height = 560 }: DiffViewerProps) {
  const { client } = useReins();
  const state = useAsync(
    () => client.call<SemanticDiff>("diff", { range }),
    [JSON.stringify(range)],
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");

  const file: FileDiff | null = useMemo(() => {
    if (!state.data) return null;
    return (
      state.data.files.find((item) => item.path === selectedFile) ?? state.data.files[0] ?? null
    );
  }, [state.data, selectedFile]);

  const change = useMemo(() => {
    if (!file) return null;
    return file.changes.find((item) => item.id === selectedChange) ?? file.changes[0] ?? null;
  }, [file, selectedChange]);

  useEffect(() => {
    if (!file) {
      setSource("");
      return;
    }
    let alive = true;
    client
      .call<{ path: string; text: string }>("readFile", { path: file.path })
      .then((result) => {
        if (alive) setSource(result.text);
      })
      .catch(() => {
        if (alive) setSource("");
      });
    return () => {
      alive = false;
    };
  }, [client, file]);

  if (state.loading) {
    return (
      <Paper p="md">
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Computing structural diff…
          </Text>
        </Group>
      </Paper>
    );
  }
  if (state.error) {
    return (
      <Alert color="red" variant="light" title="Diff unavailable">
        {state.error.message}
      </Alert>
    );
  }
  if (!state.data) return null;

  return (
    <div className="reins-diff" style={{ minHeight: height }}>
      <ScrollArea className="reins-diff-files" type="auto">
        <Stack gap={2}>
          {state.data.files.map((item) => (
            <UnstyledButton
              key={item.path}
              className={`reins-diff-file ${item.path === file?.path ? "is-active" : ""}`}
              onClick={() => {
                setSelectedFile(item.path);
                setSelectedChange(null);
              }}
            >
              <span>{item.path}</span>
              <Badge size="xs" variant="light" color="gray">
                {item.changes.length}
              </Badge>
            </UnstyledButton>
          ))}
          {state.data.files.length === 0 ? (
            <Text size="sm" c="dimmed">
              No changes.
            </Text>
          ) : null}
        </Stack>
      </ScrollArea>
      <div className="reins-diff-main">
        {file ? (
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                {file.path}
              </Text>
              <Group gap="xs">
                <Badge size="xs" variant="light" color="gray">
                  {file.status}
                </Badge>
                <Text size="xs" c="dimmed">
                  {file.language}
                  {file.degraded ? ` · degraded: ${file.degradedReason}` : ""}
                </Text>
              </Group>
            </Group>
            <ScrollArea h={180} type="auto">
              <Stack gap={0}>
                {file.changes.map((item) => (
                  <UnstyledButton
                    key={item.id}
                    className={`reins-op ${item.id === change?.id ? "is-active" : ""}`}
                    onClick={() => setSelectedChange(item.id)}
                  >
                    <span className={`reins-op-kind kind-${item.kind}`}>{item.kind}</span>
                    <span>{operationLabel(item)}</span>
                    <span className="reins-row-meta">
                      {item.to?.path ?? item.from?.path}:
                      {item.to?.startLine ?? item.from?.startLine}
                    </span>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea>
            {change ? (
              <Paper withBorder radius="lg" p="sm">
                <Group gap="lg" wrap="wrap">
                  <Text size="xs" c="dimmed">
                    before{" "}
                    <Text span size="xs" ff="monospace">
                      {change.from
                        ? `${change.from.path}:${change.from.startLine}-${change.from.endLine}`
                        : "none"}
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    after{" "}
                    <Text span size="xs" ff="monospace">
                      {change.to
                        ? `${change.to.path}:${change.to.startLine}-${change.to.endLine}`
                        : "none"}
                    </Text>
                  </Text>
                  <Badge size="xs" variant="light" color="blue">
                    {change.confidence}
                  </Badge>
                  {change.detail?.reason ? (
                    <Text size="xs" c="dimmed">
                      {change.detail.reason}
                    </Text>
                  ) : null}
                </Group>
              </Paper>
            ) : null}
            <Paper withBorder radius="lg" p={0} className="reins-code">
              <CodeMirror
                value={source}
                height={`${Math.max(height - 260, 220)}px`}
                extensions={[javascript({ jsx: true, typescript: true })]}
                editable={false}
                basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
              />
            </Paper>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Select a file.
          </Text>
        )}
      </div>
    </div>
  );
}
