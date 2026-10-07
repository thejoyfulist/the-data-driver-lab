"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchLab, isDeclaredUnavailable, LabAPIError, type LabPayload } from "@/lib/lab-client";

/**
 * Per-page resource cache for Lab views. Server-rendered payloads seed it so
 * the first paint (and the no-JavaScript page) already shows real charts;
 * the browser then fetches only what changes.
 *
 * The cache lives in React state, never in module scope, so nothing is shared
 * between server requests.
 */

export type LabResourceStatus = "loading" | "ready" | "empty" | "error";

export interface LabResource<T> {
  status: LabResourceStatus;
  data: T | null;
  payload: LabPayload<T> | null;
  /** HTTP status when the request failed (0 for network errors). */
  errorStatus: number | null;
}

export type LabSeed = Record<string, LabPayload<unknown> | null>;

interface CacheEntry {
  payload: LabPayload<unknown> | null;
  errorStatus: number | null;
}

interface LabResourceStore {
  entries: Map<string, CacheEntry>;
  inflight: Map<string, Promise<CacheEntry>>;
}

const LabResourceContext = createContext<LabResourceStore | null>(null);

export function LabResourceProvider({ seed, children }: { seed: LabSeed; children: ReactNode }) {
  const [store] = useState<LabResourceStore>(() => ({
    // Failed server fetches are not seeded: the browser retries them.
    entries: new Map(
      Object.entries(seed)
        .filter((entry): entry is [string, LabPayload<unknown>] => entry[1] != null)
        .map(([endpoint, payload]) => [endpoint, { payload, errorStatus: null }]),
    ),
    inflight: new Map(),
  }));
  return <LabResourceContext.Provider value={store}>{children}</LabResourceContext.Provider>;
}

function isEmptyData(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  // `{ availability: "unavailable", reason }`: an explicit "not published".
  return isDeclaredUnavailable(data);
}

function toResource<T>(entry: CacheEntry | undefined, isEmpty: (data: T) => boolean): LabResource<T> {
  if (!entry) return { status: "loading", data: null, payload: null, errorStatus: null };
  if (entry.errorStatus != null && !entry.payload) {
    return { status: "error", data: null, payload: null, errorStatus: entry.errorStatus };
  }
  const payload = entry.payload as LabPayload<T> | null;
  const data = payload?.data ?? null;
  const empty = data == null || isEmptyData(data) || isEmpty(data);
  return { status: empty ? "empty" : "ready", data, payload, errorStatus: null };
}

function loadEntry(store: LabResourceStore, endpoint: string): Promise<CacheEntry> {
  const existing = store.inflight.get(endpoint);
  if (existing) return existing;
  const request = fetchLab<unknown>(endpoint)
    .then((payload): CacheEntry => ({ payload, errorStatus: null }))
    .catch((error: unknown): CacheEntry => ({
      payload: null,
      errorStatus: error instanceof LabAPIError ? error.status : 0,
    }))
    .then((entry) => {
      store.entries.set(endpoint, entry);
      store.inflight.delete(endpoint);
      return entry;
    });
  store.inflight.set(endpoint, request);
  return request;
}

/**
 * Read one endpoint through the shared cache. `null` means "nothing to load"
 * (for example no race selected) and resolves to an empty resource.
 */
export function useLabResource<T>(
  endpoint: string | null,
  isEmpty: (data: T) => boolean = () => false,
): LabResource<T> {
  const store = useContext(LabResourceContext);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!store || endpoint == null || store.entries.has(endpoint)) return;
    let cancelled = false;
    void loadEntry(store, endpoint).then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [endpoint, store]);

  if (endpoint == null) return { status: "empty", data: null, payload: null, errorStatus: null };
  return toResource<T>(store?.entries.get(endpoint), isEmpty);
}

/** Several endpoints at once (e.g. one lap series per selected driver). */
export function useLabResources<T>(endpoints: readonly string[]): Record<string, LabResource<T>> {
  const store = useContext(LabResourceContext);
  const [, setVersion] = useState(0);
  const key = endpoints.join("|");

  useEffect(() => {
    if (!store) return;
    const missing = endpoints.filter((endpoint) => !store.entries.has(endpoint));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map((endpoint) => loadEntry(store, endpoint))).then(() => {
      if (!cancelled) setVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
    // `key` captures the endpoint list; the array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store]);

  return Object.fromEntries(
    endpoints.map((endpoint) => [endpoint, toResource<T>(store?.entries.get(endpoint), () => false)]),
  );
}
