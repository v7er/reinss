import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import type { AiSettings, LocalAiProvider } from "@reinss/core";
import { useCallback, useEffect, useState } from "react";
import { useReins } from "./context.js";
import { useAsync } from "./useAsync.js";

export interface AiSettingsPanelProps {
  onSaved?: (settings: AiSettings) => void;
}

export function AiSettingsPanel({ onSaved }: AiSettingsPanelProps) {
  const { client } = useReins();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsState = useAsync(() => client.call<AiSettings>("aiSettings"), []);
  const discoverState = useAsync(() => client.call<LocalAiProvider[]>("discoverAi"), []);

  const applySettings = useCallback((settings: AiSettings | null | undefined) => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setProvider(settings.provider);
    setModel(settings.model);
    setBaseUrl(settings.baseUrl ?? "");
  }, []);
  useEffect(() => {
    applySettings(settingsState.data);
  }, [applySettings, settingsState.data]);

  const providers = discoverState.data ?? [];
  const selectedProvider = providers.find((item) => item.baseUrl === baseUrl) ?? null;
  const models = selectedProvider?.models ?? [];

  const chooseProvider = (item: LocalAiProvider) => {
    setBaseUrl(item.baseUrl);
    setProvider(item.label);
    setModel(item.models[0] ?? null);
    setEnabled(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await client.call<AiSettings>("saveAiSettings", {
        enabled,
        provider,
        model,
        baseUrl: baseUrl.trim() || null,
      });
      applySettings(next);
      setSaved(true);
      onSaved?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (settingsState.loading && !settingsState.data) {
    return (
      <Group gap="sm">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading AI settings…
        </Text>
      </Group>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Stack gap={2}>
          <Text fw={600}>Local AI</Text>
          <Text size="xs" c="dimmed">
            Discovery probes Ollama, LM Studio, llama.cpp, vLLM, and text-generation-webui on this
            machine. Nothing leaves the machine unless you point the base URL elsewhere.
          </Text>
        </Stack>
        <Badge variant="light" color={enabled ? "green" : "gray"}>
          {enabled ? "on" : "off"}
        </Badge>
      </Group>

      <Group justify="space-between">
        <Text size="sm" fw={550}>
          Found on this machine
        </Text>
        <Button
          size="compact-xs"
          variant="default"
          loading={discoverState.loading}
          onClick={() => discoverState.reload()}
        >
          Discover again
        </Button>
      </Group>

      {providers.length === 0 && !discoverState.loading ? (
        <Alert color="gray" variant="light">
          No local model server found. Start Ollama or LM Studio, then discover again. You can also
          paste an OpenAI-compatible base URL below.
        </Alert>
      ) : (
        <Stack gap={4}>
          {providers.map((item) => (
            <UnstyledButton
              key={item.baseUrl}
              className="reins-row"
              aria-current={item.baseUrl === baseUrl}
              onClick={() => chooseProvider(item)}
            >
              <span className="reins-row-main">
                <Text span fw={600} size="sm">
                  {item.label}
                </Text>{" "}
                <Text span size="xs" c="dimmed" ff="monospace">
                  {item.baseUrl}
                </Text>
              </span>
              <span className="reins-row-meta">{item.models.length} models</span>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      <Divider />

      <Group grow align="flex-end" gap="sm">
        <TextInput
          label="Base URL"
          placeholder="http://127.0.0.1:11434/v1"
          value={baseUrl}
          onChange={(event) => {
            setBaseUrl(event.currentTarget.value);
            setSaved(false);
          }}
          ff="monospace"
          size="xs"
        />
        {models.length > 0 ? (
          <Select
            label="Model"
            placeholder="Choose a model"
            data={models}
            value={model}
            onChange={(value) => {
              setModel(value);
              setSaved(false);
            }}
            searchable
            clearable
            size="xs"
          />
        ) : (
          <TextInput
            label="Model"
            placeholder="llama3.2"
            value={model ?? ""}
            onChange={(event) => {
              setModel(event.currentTarget.value || null);
              setSaved(false);
            }}
            size="xs"
          />
        )}
      </Group>

      <Group gap="sm">
        <TextInput
          label="Provider label"
          placeholder="Ollama"
          value={provider ?? ""}
          onChange={(event) => {
            setProvider(event.currentTarget.value || null);
            setSaved(false);
          }}
          size="xs"
          style={{ flex: 1 }}
        />
        <Switch
          label="Enable AI drafting"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.currentTarget.checked);
            setSaved(false);
          }}
        />
      </Group>

      {settingsState.data && !settingsState.data.local && enabled ? (
        <Alert color="yellow" variant="light">
          Remote endpoint. Set <code>REINS_LLM_API_KEY</code> in the environment before drafting;
          the key is never written to the repository.
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" variant="light">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert color="green" variant="light">
          Saved to .reins/config.json
        </Alert>
      ) : null}

      <Group justify="flex-end">
        <Button size="compact-sm" variant="default" onClick={() => discoverState.reload()}>
          Rescan
        </Button>
        <Button size="compact-sm" loading={saving} onClick={() => void save()}>
          Save AI settings
        </Button>
      </Group>

      <Paper withBorder radius="md" p="sm">
        <Text size="xs" c="dimmed">
          The key comes from <code>REINS_LLM_API_KEY</code> or <code>OPENAI_API_KEY</code>. Local
          endpoints need no key. Settings are stored in <code>.reins/config.json</code>.
        </Text>
      </Paper>
    </Stack>
  );
}
