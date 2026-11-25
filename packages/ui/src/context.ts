import type { NavigationTarget, ReinsClient } from "@reinss/core";
import { createContext, useContext } from "react";

export interface ReinsContextValue {
  client: ReinsClient;
  theme: "light" | "dark" | "system";
  dataVersion: number;
  onNavigate?: (target: NavigationTarget) => void;
}

export const ReinsContext = createContext<ReinsContextValue | null>(null);

export function useReins(): ReinsContextValue {
  const value = useContext(ReinsContext);
  if (!value) throw new Error("Reins components must be wrapped in <ReinsProvider>.");
  return value;
}
