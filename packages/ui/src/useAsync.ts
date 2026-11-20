import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ReinsContext } from "./context.js";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const version = useContext(ReinsContext)?.dataVersion ?? 0;
  const hasData = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: caller supplies the dependency list
  useEffect(() => {
    let cancelled = false;
    if (!hasData.current) setLoading(true);
    setError(null);
    load()
      .then((value) => {
        if (cancelled) return;
        hasData.current = true;
        setData(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, version]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}
