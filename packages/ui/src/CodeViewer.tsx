import { javascript } from "@codemirror/lang-javascript";
import { EditorView, lineNumbers } from "@codemirror/view";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import type { DiffHunk } from "@reinss/core";
import { IconCheck, IconCopy, IconX } from "@tabler/icons-react";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { type ReactNode, useState } from "react";

export interface CodeViewerProps {
  path: string;
  language?: string;
  source?: string;
  hunks?: DiffHunk[];
  height?: string;
  startLine?: number;
  actions?: ReactNode;
  onClose?: () => void;
  degraded?: boolean;
  degradedReason?: string;
}

const paperCodeTheme = EditorView.theme({
  "&": { backgroundColor: "var(--reins-surface)", color: "var(--reins-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--reins-surface)",
    color: "var(--reins-muted)",
    borderRight: "1px solid var(--reins-hairline)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--reins-paper-2) 55%, transparent)",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--reins-paper-2)" },
});

export function CodeViewer({
  path,
  language,
  source,
  hunks = [],
  height = "60vh",
  startLine = 1,
  actions,
  onClose,
  degraded,
  degradedReason,
}: CodeViewerProps) {
  const [view, setView] = useState<"changes" | "file">("changes");
  const [copied, setCopied] = useState(false);
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const activeView = view === "changes" && hunks.length > 0 ? "changes" : "file";

  const copy = async () => {
    if (!source) return;
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="reins-code">
      <Group justify="space-between" px="sm" py={6} className="reins-code-head">
        <Group gap="xs">
          <Text size="xs" ff="monospace">
            {path}
          </Text>
          {language ? (
            <Badge size="xs" variant="light" color="gray">
              {language}
            </Badge>
          ) : null}
        </Group>
        <Group gap="xs">
          {hunks.length > 0 ? (
            <SegmentedControl
              size="xs"
              value={activeView}
              onChange={(value) => setView(value as "changes" | "file")}
              data={[
                { label: "Changes", value: "changes" },
                { label: "File", value: "file" },
              ]}
            />
          ) : null}
          <Tooltip label={copied ? "Copied" : "Copy code"} position="left">
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="Copy code"
              onClick={() => void copy()}
              disabled={!source}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
          {actions}
          {onClose ? (
            <Tooltip label="Close code" position="left">
              <ActionIcon size="sm" variant="subtle" aria-label="Close code" onClick={onClose}>
                <IconX size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Group>
      {degraded ? (
        <Alert
          color="gray"
          variant="light"
          m="sm"
          title={hunks.length > 0 ? "Line diff only" : "No code preview"}
        >
          {degradedReason === "unsupported-language"
            ? `${language ?? "This language"} is not supported by the structural viewer yet.`
            : `This file could not be parsed: ${degradedReason ?? "unknown reason"}.`}
        </Alert>
      ) : null}
      {activeView === "changes" ? (
        <div className="reins-hunks reins-code-body" style={{ height, overflow: "auto" }}>
          {hunks.map((hunk) => (
            <div
              key={`${hunk.oldStart}-${hunk.newStart}-${hunk.oldLines}-${hunk.newLines}`}
              className="reins-hunk"
            >
              <div className="reins-hunk-head">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </div>
              {hunk.lines.map((line) => (
                <div
                  key={`${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}`}
                  className={`reins-hunk-line is-${line.kind}`}
                >
                  <span className="reins-hunk-num">{line.oldLine ?? ""}</span>
                  <span className="reins-hunk-num">{line.newLine ?? ""}</span>
                  <span className="reins-hunk-mark">
                    {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
                  </span>
                  <span className="reins-hunk-text">{line.text || " "}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : source ? (
        <div className="reins-code-body" style={{ height, overflow: "auto" }}>
          <CodeMirror
            value={source}
            theme={computed === "dark" ? githubDark : githubLight}
            extensions={[
              javascript({ jsx: true, typescript: true }),
              lineNumbers({
                formatNumber: (lineNo) => String(lineNo + startLine - 1),
              }),
              ...(computed === "dark" ? [] : [paperCodeTheme]),
            ]}
            editable={false}
            className="reins-code-editor"
            basicSetup={{
              lineNumbers: false,
              foldGutter: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
            }}
          />
        </div>
      ) : (
        <Text size="sm" c="dimmed" p="md">
          Empty file.
        </Text>
      )}
    </div>
  );
}
