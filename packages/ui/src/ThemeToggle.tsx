import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = computed === "dark" ? "light" : "dark";

  return (
    <Tooltip label={`Switch to ${next} theme`} position="right">
      <ActionIcon
        className={className}
        size="lg"
        radius="xl"
        variant="default"
        aria-label={`Switch to ${next} theme`}
        onClick={() => setColorScheme(next)}
      >
        {computed === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
