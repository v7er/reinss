import { MantineProvider } from "@mantine/core";
import type { NavigationTarget, ReinsClient } from "@reinss/core";
import { type ReactNode, useEffect, useState } from "react";
import { ReinsContext } from "./context.js";
import { reinsTheme } from "./theme.js";

export interface ReinsProviderProps {
  client: ReinsClient;
  theme?: "light" | "dark" | "system";
  version?: number;
  onNavigate?: (target: NavigationTarget) => void;
  children: ReactNode;
}

export function ReinsProvider({
  client,
  theme = "light",
  version = 0,
  onNavigate,
  children,
}: ReinsProviderProps) {
  const [eventVersion, setEventVersion] = useState(0);

  useEffect(() => {
    if (!client.subscribe) return;
    return client.subscribe(() => setEventVersion((value) => value + 1));
  }, [client]);

  const dataVersion = version + eventVersion;

  return (
    <MantineProvider theme={reinsTheme} defaultColorScheme={theme === "system" ? "auto" : theme}>
      <ReinsContext.Provider
        value={{ client, theme, dataVersion, ...(onNavigate ? { onNavigate } : {}) }}
      >
        <div className="reins-root">{children}</div>
      </ReinsContext.Provider>
    </MantineProvider>
  );
}
