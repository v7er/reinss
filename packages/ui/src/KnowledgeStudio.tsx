import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type {
  CoverageItem,
  CoverageState,
  KnowledgeAiResult,
  KnowledgeBootstrapResult,
  KnowledgeCommentThread,
  KnowledgeNode,
  KnowledgeQueryResult,
  KnowledgeSaveResult,
  KnowledgeTree,
  KnowledgeTreeNode,
  NodeType,
} from "@reinss/core";
import { knowledgeTemplateIds } from "@reinss/core";
import { type CSSProperties, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface KnowledgeStudioProps {
  height?: number;
}

const typeColor: Record<NodeType, string> = {
  spec: "blue",
  decision: "grape",
  constraint: "orange",
  howto: "teal",
  question: "yellow",
};

const coverageColor: Record<CoverageState, string> = {
  covered: "green",
  stale: "yellow",
  orphan: "orange",
  unmapped: "gray",
  invalid: "red",
};

const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const panel: CSSProperties = { display: "flex", flexDirection: "column", minHeight: 0 };
const nodeTypes: NodeType[] = ["spec", "decision", "constraint", "howto", "question"];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface NodeGroup {
  path: string;
  coverage: CoverageState | null;
  nodes: KnowledgeTreeNode[];
}

function groupNodes(tree: KnowledgeTree | null): NodeGroup[] {
  if (!tree) return [];
  const buckets = new Map<string, KnowledgeTreeNode[]>();
  for (const item of tree.nodes) {
    const list = buckets.get(item.component) ?? [];
    list.push(item);
    buckets.set(item.component, list);
  }
  const result: NodeGroup[] = [];
  for (const component of tree.components) {
    const nodes = buckets.get(component.path) ?? [];
    buckets.delete(component.path);
    if (nodes.length > 0) {
      result.push({ path: component.path, coverage: component.coverage, nodes });
    }
  }
  for (const [path, nodes] of buckets) result.push({ path, coverage: null, nodes });
  return result;
}

function CoverageDot({ state }: { state: CoverageState }) {
  const label = `Coverage: ${state}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ color: `var(--mantine-color-${coverageColor[state]}-6)`, fontSize: 12 }}
    >
      ●
    </span>
  );
}

function TypeBadge({ type }: { type: NodeType }) {
  return (
    <Badge size="xs" variant="light" color={typeColor[type]} radius="sm">
      {type}
    </Badge>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <Group gap="sm">
      <Loader size="sm" />
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

export function KnowledgeStudio({ height = 560 }: KnowledgeStudioProps) {
  const { client } = useReins();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [draft, setDraft] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: "spec" as NodeType,
    component: "",
    body: "",
  });
  const [saved, setSaved] = useState<KnowledgeSaveResult | null>(null);
  const [acceptTo, setAcceptTo] = useState("");
  const [savingNode, setSavingNode] = useState(false);
  const [initOpen, setInitOpen] = useState(false);
  const [initTemplate, setInitTemplate] = useState<string>("default");
  const [initCode, setInitCode] = useState(true);
  const [initAi, setInitAi] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [initPreview, setInitPreview] = useState<string | null>(null);
  const [initResult, setInitResult] = useState<string | null>(null);
  const treeState = useAsync(() => client.call<KnowledgeTree>("knowledgeTree"), []);
  const coverageState = useAsync(() => client.call<CoverageItem[]>("knowledgeCoverage"), []);
  const nodeState = useAsync(
    () =>
      selected
        ? client.call<KnowledgeNode>("knowledgeNode", { address: selected })
        : Promise.resolve(null),
    [selected],
  );
  const commentsState = useAsync(
    () =>
      selected
        ? client.call<KnowledgeCommentThread>("knowledgeComments", { address: selected })
        : Promise.resolve(null),
    [selected],
  );
  const searchState = useAsync(
    () =>
      submitted
        ? client.call<KnowledgeQueryResult>("searchKnowledge", { query: submitted, limit: 10 })
        : Promise.resolve(null),
    [submitted],
  );

  const tree = treeState.data;
  const node = nodeState.data;
  const coverage = coverageState.data;
  const groups = groupNodes(tree);
  const defaultComponent = `components/${tree?.components[0]?.name ?? "product"}`;
  const canSave = Boolean(form.title.trim() && form.body.trim() && form.component.trim());
  const errorMessage =
    treeState.error?.message ??
    coverageState.error?.message ??
    nodeState.error?.message ??
    commentsState.error?.message ??
    searchState.error?.message ??
    actionError;

  const reload = () => {
    treeState.reload();
    coverageState.reload();
    nodeState.reload();
    commentsState.reload();
  };

  const createTemplate = async () => {
    setCreating(true);
    setActionError(null);
    try {
      await client.call<{ created: string[] }>("initKnowledge");
      treeState.reload();
      coverageState.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const setType = (value: string | null) => value && setForm({ ...form, type: value as NodeType });

  const change =
    (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.currentTarget.value }));

  const run = (action: () => Promise<KnowledgeSaveResult>, done?: () => void) => {
    setSavingNode(true);
    setActionError(null);
    action()
      .then((result) => {
        setSaved(result);
        treeState.reload();
        setSelected(result.address);
        done?.();
      })
      .catch((err: unknown) => setActionError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSavingNode(false));
  };

  const openForm = () => {
    setForm({ ...form, title: "", body: "", component: defaultComponent });
    setFormOpen(true);
  };

  const saveNode = () => {
    if (!tree?.template) return;
    run(
      () =>
        client.call<KnowledgeSaveResult>("saveKnowledgeNode", {
          address: `${form.component}/${slugify(form.title)}`,
          ...form,
        }),
      () => setFormOpen(false),
    );
  };

  const acceptNode = () => {
    if (!node) return;
    const component = node.component === "inbox" ? acceptTo.trim() : node.component;
    run(
      () =>
        client.call<KnowledgeSaveResult>("acceptKnowledgeNode", {
          address: node.address,
          component,
        }),
      () => {
        setAcceptTo("");
        commentsState.reload();
      },
    );
  };

  const addComment = async () => {
    const body = draft.trim();
    if (!selected || !body) return;
    setSaving(true);
    setCommentError(null);
    try {
      await client.call<KnowledgeCommentThread>("addKnowledgeComment", { address: selected, body });
      setDraft("");
      commentsState.reload();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runInit = async (write: boolean) => {
    setInitBusy(true);
    setActionError(null);
    setInitPreview(null);
    setInitResult(null);
    try {
      await client.call<{ created: string[]; kept: boolean }>("initKnowledge", {
        template: initTemplate,
      });
      if (initAi) {
        const ai = await client.call<KnowledgeAiResult>("aiKnowledgeInit", { write });
        if (!write) {
          setInitPreview(
            `Prompt ${ai.promptChars} chars for model ${ai.model}.\n\n${ai.prompt.slice(0, 1_500)}`,
          );
        } else {
          setInitResult(
            `${ai.drafts.length} drafts, ${ai.written.length} written, ${ai.skipped.length} skipped.`,
          );
          reload();
        }
        return;
      }
      if (!initCode) {
        setInitResult("Template ready. Turn on code scan to create component nodes.");
        reload();
        return;
      }
      const plan = await client.call<KnowledgeBootstrapResult>("bootstrapKnowledge", { write });
      if (!write) {
        setInitPreview(
          `Plan: ${plan.components.length} components, ${plan.skipped.length} skipped.${
            plan.truncated ? " Truncated by the cap." : ""
          }`,
        );
      } else {
        setInitResult(`${plan.written.length} files written.`);
        reload();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setInitBusy(false);
    }
  };

  return (
    <Stack gap="sm" h={height}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <form
          style={{ flex: 1, maxWidth: 520 }}
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <Group gap="xs" wrap="nowrap">
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search knowledge"
              aria-label="Search knowledge"
              radius="xl"
              style={{ flex: 1 }}
            />
            <Button type="submit" size="compact-sm" variant="default">
              Search
            </Button>
          </Group>
        </form>
        <Group gap="xs">
          <Button size="compact-sm" variant="default" onClick={() => setInitOpen(true)}>
            Initialize
          </Button>
          {tree?.template && (
            <Button size="compact-sm" variant="default" onClick={openForm}>
              New node
            </Button>
          )}
          <Button size="compact-sm" variant="default" onClick={reload}>
            Recheck
          </Button>
        </Group>
      </Group>

      {searchState.data && (
        <Text size="xs" c="dimmed">
          {searchState.data.filter.reason} · {searchState.data.total} matches ·{" "}
          {searchState.data.tookMs} ms
        </Text>
      )}
      {errorMessage && (
        <Alert color="red" variant="light">
          {errorMessage}
        </Alert>
      )}
      {saved && (
        <Paper withBorder radius="lg" p="xs">
          <Text size="xs" c="dimmed" mb={4}>
            {saved.address}
          </Text>
          <Code block data-language="diff" style={{ maxHeight: 120, overflow: "auto" }}>
            {saved.diff}
          </Code>
        </Paper>
      )}
      {treeState.loading && !tree && <Loading label="Loading knowledge…" />}

      {tree && tree.template === null && (
        <Paper withBorder radius="lg" p="lg" style={{ flex: 1 }}>
          <Stack gap="sm" align="flex-start">
            <Text fw={600}>No knowledge template yet.</Text>
            <Text size="sm" c="dimmed">
              Knowledge Studio reads `.reins/knowledge/template.md`. Create the template before
              adding specs, decisions, or constraints.
            </Text>
            <Button size="compact-sm" loading={creating} onClick={createTemplate}>
              Create template
            </Button>
          </Stack>
        </Paper>
      )}

      {tree && tree.template !== null && (
        <div
          style={{
            display: "grid",
            flex: 1,
            gap: 12,
            gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1.4fr)",
            minHeight: 0,
          }}
        >
          <Paper withBorder radius="lg" p="xs" style={panel}>
            <Text size="xs" tt="uppercase" c="dimmed" fw={600} px={6} pb={4}>
              {submitted ? "Results" : "Components"}
            </Text>
            <ScrollArea style={{ flex: 1 }} type="auto">
              {submitted ? (
                <Stack gap={0}>
                  {searchState.loading && <Loading label="Searching…" />}
                  {searchState.data?.items.map((hit) => (
                    <UnstyledButton
                      key={hit.address}
                      className="reins-row"
                      aria-current={selected === hit.address}
                      onClick={() => setSelected(hit.address)}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={{ ...ellipsis, fontWeight: 550 }}>
                          <TypeBadge type={hit.type} /> {hit.title}
                        </span>
                        <Text size="xs" c="dimmed" style={ellipsis}>
                          {hit.excerpt}
                        </Text>
                      </span>
                      <span className="reins-row-meta">{hit.score.toFixed(2)}</span>
                    </UnstyledButton>
                  ))}
                  {searchState.data?.items.length === 0 && (
                    <Text size="sm" c="dimmed" p="sm">
                      No matches.
                    </Text>
                  )}
                </Stack>
              ) : (
                <Stack gap="md">
                  {groups.map((group) => (
                    <Stack key={group.path} gap={2}>
                      <Group gap="xs" px={6}>
                        {group.coverage && <CoverageDot state={group.coverage} />}
                        <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
                          {group.path || "(root)"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {group.nodes.length}
                        </Text>
                      </Group>
                      {group.nodes.map((item) => (
                        <UnstyledButton
                          key={item.address}
                          className="reins-row"
                          aria-current={selected === item.address}
                          onClick={() => setSelected(item.address)}
                        >
                          <span className="reins-row-main">
                            <TypeBadge type={item.type} /> {item.title}
                            {item.source === "openspec" ? " · openspec" : ""}
                          </span>
                          <span className="reins-row-meta" style={{ alignItems: "center" }}>
                            {group.coverage && <CoverageDot state={group.coverage} />}{" "}
                            {item.layer ?? "no layer"}
                          </span>
                        </UnstyledButton>
                      ))}
                    </Stack>
                  ))}
                  {groups.length === 0 && (
                    <Text size="sm" c="dimmed" p="sm">
                      No knowledge nodes yet.
                    </Text>
                  )}
                </Stack>
              )}
            </ScrollArea>
          </Paper>

          <Paper withBorder radius="lg" style={panel}>
            <ScrollArea style={{ flex: 1 }} type="auto" p="md">
              {nodeState.loading && !node && <Loading label="Loading node…" />}
              {node ? (
                <Stack gap="sm">
                  <Text fw={650} size="lg">
                    {node.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    <Code>{node.address}</Code> · <Code>{node.path}</Code> · {node.component} ·{" "}
                    {node.layer ?? "no layer"} · {node.type} · {node.status} · {node.updated} ·{" "}
                    {node.backlinkCount} backlinks · Guidance:{" "}
                    {node.guidance.length > 0 ? node.guidance.join(", ") : "none"}
                  </Text>
                  {node.status === "proposed" && node.source === "reins" && (
                    <Group gap="xs" align="flex-end">
                      {node.component === "inbox" && (
                        <TextInput
                          size="xs"
                          label="Destination component"
                          value={acceptTo}
                          onChange={(event) => setAcceptTo(event.currentTarget.value)}
                          style={{ flex: 1 }}
                        />
                      )}
                      <Button
                        size="compact-sm"
                        loading={savingNode}
                        disabled={node.component === "inbox" && !acceptTo.trim()}
                        onClick={acceptNode}
                      >
                        Accept
                      </Button>
                    </Group>
                  )}
                  <Divider />
                  <div className="reins-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{node.body}</ReactMarkdown>
                  </div>
                  <Divider label="Comments" labelPosition="left" />
                  {commentsState.data && (
                    <Stack gap="xs">
                      {!commentsState.data.refAvailable && (
                        <Text size="xs" c="dimmed">
                          Git notes ref is absent. Comments may not persist.
                        </Text>
                      )}
                      {commentsState.data.comments.length === 0 && (
                        <Text size="xs" c="dimmed">
                          No comments yet.
                        </Text>
                      )}
                      {commentsState.data.comments.map((comment) => (
                        <Text key={comment.id} size="sm" style={{ whiteSpace: "pre-wrap" }}>
                          <Text span size="xs" c="dimmed">
                            {comment.author} · {comment.at}
                            {comment.resolved ? " · resolved " : " "}
                          </Text>
                          {comment.body}
                        </Text>
                      ))}
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.currentTarget.value)}
                        placeholder="Add a comment"
                        aria-label="Add a comment"
                        autosize
                        minRows={2}
                        maxRows={4}
                      />
                      {commentError && (
                        <Text size="xs" c="red">
                          {commentError}
                        </Text>
                      )}
                      <Group justify="flex-end">
                        <Button
                          size="compact-sm"
                          loading={saving}
                          disabled={!draft.trim()}
                          onClick={addComment}
                        >
                          Add comment
                        </Button>
                      </Group>
                    </Stack>
                  )}
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  Select a node to read it.
                </Text>
              )}
            </ScrollArea>
          </Paper>
        </div>
      )}

      {tree && (
        <Paper withBorder radius="lg" p="xs">
          <Group justify="space-between" mb={4}>
            <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
              Coverage
            </Text>
            <Text size="xs" c="dimmed">
              {coverage?.length ?? 0} findings
            </Text>
          </Group>
          <ScrollArea.Autosize mah={120} type="auto">
            <Stack gap={4}>
              {coverage?.map((item, index) => (
                <Text key={`${item.component}-${item.address ?? index}`} size="xs">
                  <Badge
                    size="xs"
                    variant="light"
                    color={coverageColor[item.state]}
                    radius="sm"
                    mr={6}
                  >
                    {item.state}
                  </Badge>
                  <Text span fw={600}>
                    {item.component}
                  </Text>{" "}
                  · {item.message} ·{" "}
                  <Text span c="dimmed">
                    {item.fix}
                  </Text>
                </Text>
              ))}
              {coverage?.length === 0 && (
                <Text size="xs" c="dimmed">
                  No coverage findings.
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Paper>
      )}

      <Modal
        opened={initOpen}
        onClose={() => setInitOpen(false)}
        title="Initialize knowledge"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Select
            label="Template"
            data={[...knowledgeTemplateIds]}
            value={initTemplate}
            onChange={(value) => value && setInitTemplate(value)}
          />
          <Switch
            label="Scan code with Trail"
            description="Creates one proposed node per component."
            checked={initCode}
            onChange={(event) => setInitCode(event.currentTarget.checked)}
          />
          <Switch
            label="Draft with AI"
            description="Uses the model in Settings. Writes proposed nodes only."
            checked={initAi}
            onChange={(event) => setInitAi(event.currentTarget.checked)}
          />
          {initPreview && (
            <Code block style={{ maxHeight: 180, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {initPreview}
            </Code>
          )}
          {initResult && (
            <Alert color="green" variant="light">
              {initResult}
            </Alert>
          )}
          {actionError && (
            <Alert color="red" variant="light">
              {actionError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              size="compact-sm"
              variant="default"
              loading={initBusy}
              onClick={() => void runInit(false)}
            >
              Preview
            </Button>
            <Button size="compact-sm" loading={initBusy} onClick={() => void runInit(true)}>
              Initialize
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={formOpen} onClose={() => setFormOpen(false)} title="New node" centered>
        <Stack gap="sm">
          <TextInput label="Title" value={form.title} onChange={change("title")} />
          <Select label="Type" data={nodeTypes} value={form.type} onChange={setType} />
          <TextInput label="Component" value={form.component} onChange={change("component")} />
          <Textarea label="Body" autosize minRows={4} value={form.body} onChange={change("body")} />
          {actionError && (
            <Alert color="red" variant="light">
              {actionError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button loading={savingNode} disabled={!canSave} onClick={saveNode}>
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
