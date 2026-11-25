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
import type { DiffRange, FileDiff, SemanticChange, SemanticDiff } from "@reinss/core";
import {
  IconCopy,
  IconFileMinus,
  IconFilePencil,
  IconFilePlus,
  IconFileSymlink,
  IconSearch,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { CodeViewer } from "./CodeViewer.js";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface DiffViewerProps {
  range: DiffRange;
  height?: number;
  files?: string[];
  fill?: boolean;
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

const NOISE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "avif",
  "heic",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "tar",
  "rar",
  "7z",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "webm",
  "avi",
  "map",
]);

function isNoiseFile(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  const extension = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return NOISE_EXTENSIONS.has(extension);
}

function FileStatusIcon({ status }: { status: FileDiff["status"] }) {
  switch (status) {
    case "added":
      return <IconFilePlus size={14} color="var(--mantine-color-green-6)" />;
    case "deleted":
      return <IconFileMinus size={14} color="var(--mantine-color-red-6)" />;
    case "renamed":
      return <IconFileSymlink size={14} color="var(--mantine-color-blue-6)" />;
    case "copied":
      return <IconCopy size={14} color="var(--mantine-color-blue-6)" />;
    default:
      return <IconFilePencil size={14} color="var(--mantine-color-yellow-7)" />;
  }
}

export function DiffViewer({ range, height = 560, files, fill = false }: DiffViewerProps) {
  const { client } = useReins();
  const mainRange: DiffRange = range.mode === "working" ? { mode: "unstaged" } : range;
  const fileFilter = files && files.length > 0 ? { files } : {};
  const state = useAsync(
    () => client.call<SemanticDiff>("diff", { range: mainRange, ...fileFilter }),
    [JSON.stringify(mainRange), files?.join("|")],
  );
  const stagedState = useAsync(
    () =>
      range.mode === "working"
        ? client.call<SemanticDiff>("diff", { range: { mode: "staged" }, ...fileFilter })
        : Promise.resolve(null),
    [range.mode, files?.join("|")],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [source, setSource] = useState<string>("");

  const sections = useMemo(() => {
    if (range.mode !== "working") {
      return state.data
        ? [
            {
              id: range.mode === "staged" ? "staged" : "all",
              label: "Changes",
              files: state.data.files,
            },
          ]
        : [];
    }
    return [
      { id: "staged", label: "Staged", files: stagedState.data?.files ?? [] },
      { id: "unstaged", label: "Working", files: state.data?.files ?? [] },
    ];
  }, [range.mode, state.data, stagedState.data]);

  const hiddenCount = useMemo(
    () =>
      sections.reduce(
        (count, section) => count + section.files.filter((item) => isNoiseFile(item.path)).length,
        0,
      ),
    [sections],
  );

  const visibleSections = useMemo(
    () =>
      sections.map((section) => {
        const needle = fileQuery.trim().toLowerCase();
        return {
          ...section,
          files: (showAll
            ? section.files
            : section.files.filter((item) => !isNoiseFile(item.path))
          ).filter((item) => !needle || item.path.toLowerCase().includes(needle)),
        };
      }),
    [sections, showAll, fileQuery],
  );

  const entries = useMemo(
    () =>
      visibleSections.flatMap((section) =>
        section.files.map((item) => ({ key: `${section.id}:${item.path}`, file: item })),
      ),
    [visibleSections],
  );
  const activeKey =
    entries.find((entry) => entry.key === selectedKey)?.key ?? entries[0]?.key ?? null;
  const file: FileDiff | null = entries.find((entry) => entry.key === activeKey)?.file ?? null;
  const fileRev = activeKey?.startsWith("staged:") ? "staged" : "working";
  const hunks = file?.hunks ?? [];

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
      .call<{ path: string; text: string }>("readFile", { path: file.path, rev: fileRev })
      .then((result) => {
        if (alive) setSource(result.text);
      })
      .catch(() => {
        if (alive) setSource("");
      });
    return () => {
      alive = false;
    };
  }, [client, file, fileRev]);

  if (state.loading || (range.mode === "working" && stagedState.loading)) {
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
  if (state.error ?? stagedState.error) {
    const error = state.error ?? stagedState.error;
    return (
      <Alert color="red" variant="light" title="Diff unavailable">
        {error?.message}
      </Alert>
    );
  }
  if (!state.data) return null;

  return (
    <div className="reins-diff" style={{ minHeight: height }}>
      <div className="reins-diff-files">
        <TextInput
          value={fileQuery}
          onChange={(event) => setFileQuery(event.currentTarget.value)}
          placeholder="Filter files"
          aria-label="Filter files"
          size="xs"
          radius="xl"
          leftSection={<IconSearch size={14} />}
          mb="xs"
        />
        <ScrollArea mah={fill ? Math.max(240, height - 100) : 520} type="auto">
          <Stack gap="md">
            {visibleSections.map((section) => (
              <Stack gap={2} key={section.id}>
                <Group justify="space-between" px="xs" py={4}>
                  <Text
                    size="xs"
                    tt="uppercase"
                    c="dimmed"
                    fw={600}
                    style={{ letterSpacing: "0.06em" }}
                  >
                    {section.label}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {section.files.length}
                  </Badge>
                </Group>
                {section.files.map((item) => {
                  const key = `${section.id}:${item.path}`;
                  return (
                    <UnstyledButton
                      key={key}
                      className={`reins-diff-file ${key === activeKey ? "is-active" : ""}`}
                      onClick={() => {
                        setSelectedKey(key);
                        setSelectedChange(null);
                      }}
                    >
                      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                        <FileStatusIcon status={item.status} />
                        <span className="reins-diff-path">{item.path}</span>
                      </Group>
                      <Badge size="xs" variant="light" color="gray">
                        {item.changes.length}
                      </Badge>
                    </UnstyledButton>
                  );
                })}
                {section.files.length === 0 ? (
                  <Text size="xs" c="dimmed" px="xs" py={4}>
                    None
                  </Text>
                ) : null}
              </Stack>
            ))}
            {fileQuery.trim() && entries.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>
                No files match.
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
        {hiddenCount > 0 ? (
          <UnstyledButton
            className="reins-diff-show-all"
            onClick={() => setShowAll((value) => !value)}
          >
            {showAll ? "Show less" : `Show all (${hiddenCount})`}
          </UnstyledButton>
        ) : null}
      </div>
      <div className="reins-diff-main">
        {file ? (
          <Stack gap="xs">
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text fw={600} size="xs" ff="monospace" truncate style={{ minWidth: 0 }}>
                {file.path}
              </Text>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge size="xs" variant="light" color="gray">
                  {file.status}
                </Badge>
                <Text size="xs" c="dimmed" truncate>
                  {file.language}
                  {file.degraded ? ` · degraded: ${file.degradedReason}` : ""}
                </Text>
              </Group>
            </Group>
            <ScrollArea mah={140} type="auto">
              <Stack gap={0}>
                {file.changes.map((item) => (
                  <UnstyledButton
                    key={item.id}
                    className={`reins-op ${item.id === change?.id ? "is-active" : ""}`}
                    onClick={() => setSelectedChange(item.id)}
                  >
                    <span className={`reins-op-kind kind-${item.kind}`}>{item.kind}</span>
                    <span className="reins-op-label">{operationLabel(item)}</span>
                    <span className="reins-row-meta">
                      {item.to?.path ?? item.from?.path}:
                      {item.to?.startLine ?? item.from?.startLine}
                    </span>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea>
            {change ? (
              <Paper withBorder radius="lg" p="xs">
                <Group gap="md" wrap="wrap">
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
            <CodeViewer
              path={file.path}
              language={file.language}
              source={source}
              hunks={hunks}
              degraded={file.degraded}
              degradedReason={file.degradedReason}
              height={fill ? `${Math.max(200, height - 240)}px` : "70vh"}
            />
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
