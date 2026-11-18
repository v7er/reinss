import { MantineProvider } from "@mantine/core";
import type { NavigationTarget, ReinsClient } from "@reins/core";
import type { ReactNode } from "react";
import { ReinsContext } from "./context.js";
import { reinsTheme } from "./theme.js";

export interface ReinsProviderProps {
  client: ReinsClient;
  theme?: "light" | "dark" | "system";
  onNavigate?: (target: NavigationTarget) => void;
  children: ReactNode;
}

export function ReinsProvider({
  client,
  theme = "system",
  onNavigate,
  children,
}: ReinsProviderProps) {
  return (
    <MantineProvider theme={reinsTheme} defaultColorScheme={theme === "system" ? "auto" : theme}>
      <ReinsContext.Provider value={{ client, theme, ...(onNavigate ? { onNavigate } : {}) }}>
        <div className="reins-root">{children}</div>
      </ReinsContext.Provider>
    </MantineProvider>
  );
}
