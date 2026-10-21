import { useCallback, useEffect, useRef, useState } from "react";
import { filterValue } from "./domain";

export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{
    data?: T;
    loading: boolean;
    error?: unknown;
  }>({ loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    loader(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      },
      (error) => {
        if (!controller.signal.aborted) setState({ loading: false, error });
      },
    );
    return () => controller.abort();
  }, [loader, revision]);
  return {
    ...state,
    reload,
    setData: (data: T) => setState({ data, loading: false }),
    updateData: (update: (data: T | undefined) => T | undefined) =>
      setState((current) => ({ ...current, data: update(current.data) })),
  };
}

/** The URL holds list state so refresh, links and browser Back retain filters. */
export function useFilters(keys: string[], defaultSort: string) {
  const read = () => {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(
      keys.map((key) => [
        key,
        filterValue(key, params.get(key) || "", defaultSort),
      ]),
    );
  };
  const [values, setValues] = useState(read);
  const latest = useRef(values);
  latest.current = values;
  useEffect(() => {
    const changed = () => setValues(read());
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
    // The list's allowed keys and default sort are fixed for its mounted lifetime.
  }, []);
  const update = useCallback(
    (patch: Record<string, string>, replace = false) => {
      const next = {
        ...latest.current,
        ...patch,
        ...("offset" in patch ? {} : { offset: "" }),
      };
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(next))
        if (value && !(key === "sort" && value === defaultSort))
          params.set(key, value);
      window.history[replace ? "replaceState" : "pushState"](
        {},
        "",
        `${window.location.pathname}${params.size ? `?${params}` : ""}`,
      );
      latest.current = next;
      setValues(next);
    },
    [defaultSort],
  );
  return [values, update] as const;
}

export function useSearch(value: string, update: (value: string) => void) {
  const [query, setQuery] = useState(value);
  useEffect(() => setQuery(value), [value]);
  useEffect(() => {
    if (query === value) return;
    const timer = setTimeout(() => update(query.trim().slice(0, 200)), 350);
    return () => clearTimeout(timer);
  }, [query, value, update]);
  return [query, setQuery] as const;
}
