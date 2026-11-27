import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import type { GitBranches, GitStatus, GitTag, GitWorktree } from "@reinss/core";
import { IconGitBranch, IconPlus, IconRefresh, IconTag, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

type RefTab = "branches" | "tags" | "worktrees";

interface ConfirmState {
  title: string;
  message: string;
  action: () => Promise<unknown>;
}

export interface GitRefsProps {
  onChanged?: () => void;
}

function tracking(branch: { ahead: number; behind: number; upstream: string | null }): string {
  const parts = [
    branch.upstream ? `→ ${branch.upstream}` : "",
    branch.ahead ? `ahead ${branch.ahead}` : "",
    branch.behind ? `behind ${branch.behind}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

export function GitRefs({ onChanged }: GitRefsProps) {
  const { client } = useReins();
  const [tab, setTab] = useState<RefTab>("branches");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const [branchName, setBranchName] = useState("");
  const [branchStart, setBranchStart] = useState("");
  const [branchCheckout, setBranchCheckout] = useState(true);
  const [tagName, setTagName] = useState("");
  const [tagRef, setTagRef] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [worktreeStart, setWorktreeStart] = useState("");
  const [worktreeCreate, setWorktreeCreate] = useState(true);
  const [worktreeDetach, setWorktreeDetach] = useState(false);

  const branches = useAsync(() => client.call<GitBranches>("gitBranches"), []);
  const tags = useAsync(() => client.call<GitTag[]>("gitTags"), []);
  const worktrees = useAsync(() => client.call<GitWorktree[]>("gitWorktrees"), []);
  const remoteBranches = new Set(
    (branches.data?.remote ?? []).map((branch) => branch.name.split("/").slice(1).join("/")),
  );

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      branches.reload();
      tags.reload();
      worktrees.reload();
      onChanged?.();
      setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const checkout = (name: string, remote: boolean) =>
    run(
      () => client.call<GitStatus>("gitCheckoutBranch", { name, remote }),
      `Checked out ${name}.`,
    );

  const createBranch = () => {
    const name = branchName.trim();
    if (!name) return;
    void run(async () => {
      await client.call<GitStatus>("gitCreateBranch", {
        name,
        ...(branchStart.trim() ? { startPoint: branchStart.trim() } : {}),
        checkout: branchCheckout,
      });
      setBranchName("");
      setBranchStart("");
    }, `Created ${name}.`);
  };

  const createTag = () => {
    const name = tagName.trim();
    if (!name) return;
    void run(async () => {
      await client.call<GitTag[]>("gitCreateTag", {
        name,
        ...(tagRef.trim() ? { ref: tagRef.trim() } : {}),
        ...(tagMessage.trim() ? { message: tagMessage.trim() } : {}),
      });
      setTagName("");
      setTagRef("");
      setTagMessage("");
    }, `Created tag ${name}.`);
  };

  const addWorktree = () => {
    const target = worktreePath.trim();
    if (!target) return;
    void run(async () => {
      await client.call<GitWorktree[]>("gitAddWorktree", {
        path: target,
        ...(worktreeBranch.trim() ? { branch: worktreeBranch.trim() } : {}),
        ...(worktreeCreate ? { createBranch: true } : {}),
        ...(worktreeStart.trim() ? { startPoint: worktreeStart.trim() } : {}),
        ...(worktreeDetach ? { detach: true } : {}),
      });
      setWorktreePath("");
      setWorktreeBranch("");
      setWorktreeStart("");
    }, "Added worktree.");
  };

  const askDeleteBranch = (name: string) =>
    setConfirm({
      title: "Delete branch",
      message: `Delete ${name}? Git refuses if it has unmerged commits unless you force it.`,
      action: () => client.call<GitStatus>("gitDeleteBranch", { name }),
    });

  const askDeleteTag = (name: string) =>
    setConfirm({
      title: "Delete tag",
      message: `Delete tag ${name}? This removes the ref, not the commits.`,
      action: () => client.call<GitTag[]>("gitDeleteTag", { name }),
    });

  const askRemoveWorktree = (path: string) =>
    setConfirm({
      title: "Remove worktree",
      message: `Remove the worktree at ${path}? The branch and commits stay.`,
      action: () => client.call<GitWorktree[]>("gitRemoveWorktree", { path }),
    });

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <SegmentedControl
          value={tab}
          onChange={(value) => setTab(value as RefTab)}
          data={[
            { label: "Branches", value: "branches" },
            { label: "Tags", value: "tags" },
            { label: "Worktrees", value: "worktrees" },
          ]}
          radius="xl"
        />
        <Tooltip label="Reload refs" position="left">
          <ActionIcon
            variant="subtle"
            aria-label="Reload refs"
            disabled={busy}
            onClick={() => {
              branches.reload();
              tags.reload();
              worktrees.reload();
            }}
          >
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {error ? (
        <Alert color="red" variant="light" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert color="green" variant="light" withCloseButton onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}

      {tab === "branches" ? (
        <Stack gap="md">
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Group gap="xs">
                <IconGitBranch size={16} />
                <Text size="sm" fw={600}>
                  Create branch
                </Text>
              </Group>
              <Group align="flex-end" wrap="wrap">
                <TextInput
                  value={branchName}
                  onChange={(event) => setBranchName(event.currentTarget.value)}
                  placeholder="feature/name"
                  aria-label="New branch name"
                  style={{ flex: 1, minWidth: 180 }}
                />
                <TextInput
                  value={branchStart}
                  onChange={(event) => setBranchStart(event.currentTarget.value)}
                  placeholder="start point (optional)"
                  aria-label="Branch start point"
                  style={{ flex: 1, minWidth: 160 }}
                />
                <Checkbox
                  checked={branchCheckout}
                  onChange={(event) => setBranchCheckout(event.currentTarget.checked)}
                  label="Checkout"
                />
                <Button
                  leftSection={<IconPlus size={14} />}
                  disabled={busy || !branchName.trim()}
                  onClick={createBranch}
                >
                  Create
                </Button>
              </Group>
            </Stack>
          </Paper>

          {branches.loading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Reading branches…
              </Text>
            </Group>
          ) : null}
          {branches.error ? (
            <Alert color="red" variant="light">
              {branches.error.message}
            </Alert>
          ) : null}
          <Paper withBorder radius="lg" p={4}>
            <ScrollArea h={360} type="auto">
              <Stack gap={0}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" py={6}>
                  Local
                </Text>
                {(branches.data?.local ?? []).map((branch) => (
                  <Group key={branch.name} gap="xs" wrap="nowrap" className="reins-row">
                    <Badge size="xs" variant="light" color={branch.current ? "blue" : "gray"}>
                      {branch.current ? "current" : "local"}
                    </Badge>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={branch.current ? 650 : 500} truncate>
                        {branch.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {tracking(branch) || branch.subject || branch.head || ""}
                      </Text>
                    </Stack>
                    {!branch.current ? (
                      <>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          disabled={busy}
                          onClick={() => void checkout(branch.name, false)}
                        >
                          Checkout
                        </Button>
                        <Tooltip label="Delete branch" position="left">
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            aria-label={`Delete ${branch.name}`}
                            disabled={busy}
                            onClick={() => askDeleteBranch(branch.name)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </>
                    ) : null}
                  </Group>
                ))}
                {(branches.data?.local ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed" p="md">
                    No local branches.
                  </Text>
                ) : null}

                <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="sm" py={6}>
                  Remote
                </Text>
                {(branches.data?.remote ?? []).map((branch) => (
                  <Group key={branch.name} gap="xs" wrap="nowrap" className="reins-row">
                    <Badge size="xs" variant="light" color="gray">
                      remote
                    </Badge>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {branch.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {branch.subject || branch.head || ""}
                      </Text>
                    </Stack>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={busy}
                      onClick={() => void checkout(branch.name, true)}
                    >
                      Checkout
                    </Button>
                  </Group>
                ))}
                {(branches.data?.remote ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed" p="md">
                    No remote branches.
                  </Text>
                ) : null}
              </Stack>
            </ScrollArea>
          </Paper>
        </Stack>
      ) : null}

      {tab === "tags" ? (
        <Stack gap="md">
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Group gap="xs">
                <IconTag size={16} />
                <Text size="sm" fw={600}>
                  Create tag
                </Text>
              </Group>
              <Group align="flex-end" wrap="wrap">
                <TextInput
                  value={tagName}
                  onChange={(event) => setTagName(event.currentTarget.value)}
                  placeholder="v1.0.0"
                  aria-label="New tag name"
                  style={{ flex: 1, minWidth: 160 }}
                />
                <TextInput
                  value={tagRef}
                  onChange={(event) => setTagRef(event.currentTarget.value)}
                  placeholder="ref (optional)"
                  aria-label="Tag ref"
                  style={{ flex: 1, minWidth: 140 }}
                />
                <TextInput
                  value={tagMessage}
                  onChange={(event) => setTagMessage(event.currentTarget.value)}
                  placeholder="message (optional, annotated)"
                  aria-label="Tag message"
                  style={{ flex: 2, minWidth: 220 }}
                />
                <Button
                  leftSection={<IconPlus size={14} />}
                  disabled={busy || !tagName.trim()}
                  onClick={createTag}
                >
                  Create
                </Button>
              </Group>
            </Stack>
          </Paper>

          {tags.loading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Reading tags…
              </Text>
            </Group>
          ) : null}
          {tags.error ? (
            <Alert color="red" variant="light">
              {tags.error.message}
            </Alert>
          ) : null}
          <Paper withBorder radius="lg" p={4}>
            <ScrollArea h={360} type="auto">
              <Stack gap={0}>
                {(tags.data ?? []).map((tag) => (
                  <Group key={tag.name} gap="xs" wrap="nowrap" className="reins-row">
                    <Badge size="xs" variant="light" color={tag.annotated ? "orange" : "gray"}>
                      {tag.annotated ? "annotated" : "light"}
                    </Badge>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>
                        {tag.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {tag.shortHash} · {tag.date.slice(0, 10)} · {tag.subject}
                      </Text>
                    </Stack>
                    <Tooltip label="Delete tag" position="left">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${tag.name}`}
                        disabled={busy}
                        onClick={() => askDeleteTag(tag.name)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ))}
                {(tags.data ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed" p="md">
                    No tags.
                  </Text>
                ) : null}
              </Stack>
            </ScrollArea>
          </Paper>
        </Stack>
      ) : null}

      {tab === "worktrees" ? (
        <Stack gap="md">
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Text size="sm" fw={600}>
                Add worktree
              </Text>
              <Group align="flex-end" wrap="wrap">
                <TextInput
                  value={worktreePath}
                  onChange={(event) => setWorktreePath(event.currentTarget.value)}
                  placeholder="/absolute/path/to/worktree"
                  aria-label="Worktree path"
                  style={{ flex: 2, minWidth: 240 }}
                />
                <TextInput
                  value={worktreeBranch}
                  onChange={(event) => setWorktreeBranch(event.currentTarget.value)}
                  placeholder="branch"
                  aria-label="Worktree branch"
                  style={{ flex: 1, minWidth: 140 }}
                />
                <TextInput
                  value={worktreeStart}
                  onChange={(event) => setWorktreeStart(event.currentTarget.value)}
                  placeholder="start point (optional)"
                  aria-label="Worktree start point"
                  style={{ flex: 1, minWidth: 160 }}
                />
              </Group>
              <Group gap="lg">
                <Checkbox
                  checked={worktreeCreate}
                  onChange={(event) => {
                    setWorktreeCreate(event.currentTarget.checked);
                    if (event.currentTarget.checked) setWorktreeDetach(false);
                  }}
                  label="Create branch"
                />
                <Checkbox
                  checked={worktreeDetach}
                  onChange={(event) => {
                    setWorktreeDetach(event.currentTarget.checked);
                    if (event.currentTarget.checked) setWorktreeCreate(false);
                  }}
                  label="Detach HEAD"
                />
                <Button
                  leftSection={<IconPlus size={14} />}
                  disabled={
                    busy || !worktreePath.trim() || (worktreeCreate && !worktreeBranch.trim())
                  }
                  onClick={addWorktree}
                >
                  Add
                </Button>
              </Group>
            </Stack>
          </Paper>

          {worktrees.loading ? (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Reading worktrees…
              </Text>
            </Group>
          ) : null}
          {worktrees.error ? (
            <Alert color="red" variant="light">
              {worktrees.error.message}
            </Alert>
          ) : null}
          <Paper withBorder radius="lg" p={4}>
            <ScrollArea h={360} type="auto">
              <Stack gap={0}>
                {(worktrees.data ?? []).map((worktree) => (
                  <Group key={worktree.path} gap="xs" wrap="nowrap" className="reins-row">
                    <Badge size="xs" variant="light" color="gray">
                      worktree
                    </Badge>
                    {worktree.current ? (
                      <Badge size="xs" variant="light" color="blue">
                        current
                      </Badge>
                    ) : worktree.prunable ? (
                      <Badge size="xs" variant="light" color="red">
                        prunable
                      </Badge>
                    ) : null}
                    {worktree.branch && worktree.main ? (
                      <Tooltip
                        label={
                          worktree.branch === worktree.main
                            ? `On ${worktree.main}`
                            : worktree.merged
                              ? `Merged into ${worktree.main}`
                              : `Not merged into ${worktree.main}`
                        }
                      >
                        <Badge
                          size="xs"
                          variant="light"
                          color={worktree.merged ? "green" : "yellow"}
                        >
                          {worktree.branch === worktree.main
                            ? "main"
                            : worktree.merged
                              ? "merged"
                              : "not merged"}
                        </Badge>
                      </Tooltip>
                    ) : null}
                    {worktree.branch && branches.data && !remoteBranches.has(worktree.branch) ? (
                      <Tooltip label="No remote branch with the same name; not compared.">
                        <Badge size="xs" variant="light" color="gray">
                          no remote
                        </Badge>
                      </Tooltip>
                    ) : null}
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate title={worktree.path}>
                        {worktree.path}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {worktree.branch ?? (worktree.detached ? "detached" : "bare")} ·{" "}
                        {worktree.head?.slice(0, 8) ?? "no head"}
                        {worktree.locked ? " · locked" : ""}
                      </Text>
                    </Stack>
                    {!worktree.current ? (
                      <Tooltip label="Remove worktree" position="left">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          aria-label={`Remove ${worktree.path}`}
                          disabled={busy}
                          onClick={() => askRemoveWorktree(worktree.path)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Group>
                ))}
                {(worktrees.data ?? []).length === 0 ? (
                  <Text size="sm" c="dimmed" p="md">
                    No worktrees.
                  </Text>
                ) : null}
              </Stack>
            </ScrollArea>
          </Paper>
        </Stack>
      ) : null}

      <Modal
        opened={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        centered
        radius="lg"
      >
        <Stack gap="md">
          <Text size="sm">{confirm?.message}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              disabled={busy}
              onClick={() => {
                const action = confirm?.action;
                setConfirm(null);
                if (action) void run(action, "Done.");
              }}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
