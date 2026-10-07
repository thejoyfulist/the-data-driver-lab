"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Track an element's width. The initial value is used for the server render
 * (and the no-JavaScript page), then replaced by the measured width.
 */
export function useElementWidth<T extends HTMLElement>(initial = 760) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** "Nice" axis ticks (1, 2, 5 × 10^n steps) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rough = span / Math.max(count, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => span / candidate <= count) ?? magnitude * 10;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-9; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

export { spreadLabels } from "./label-layout.mjs";

// ── Synchronised cursor ─────────────────────────────────────────────────

interface CursorStore {
  values: Record<string, number | null>;
  set: (group: string, x: number | null) => void;
}

const ChartCursorContext = createContext<CursorStore | null>(null);

/**
 * Charts that share an axis (lap, round) inside this provider share one
 * cursor: hovering or arrow-keying one chart moves the cursor in the others.
 */
export function ChartCursorProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, number | null>>({});
  const set = useCallback((group: string, x: number | null) => {
    setValues((current) => (current[group] === x ? current : { ...current, [group]: x }));
  }, []);
  const store = useMemo(() => ({ values, set }), [values, set]);
  return createElement(ChartCursorContext.Provider, { value: store }, children);
}

/** Cursor position for `group`; a chart outside a provider (or without a group) keeps its own. */
export function useChartCursor(group?: string): [number | null, (x: number | null) => void] {
  const store = useContext(ChartCursorContext);
  const [local, setLocal] = useState<number | null>(null);
  const setShared = useCallback((x: number | null) => {
    if (store && group) store.set(group, x);
    else setLocal(x);
  }, [group, store]);
  if (store && group) return [store.values[group] ?? null, setShared];
  return [local, setShared];
}
