"use client";

import { useEffect, useRef, useState } from "react";

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

/** Spread end-of-line labels so they never overlap (minimum gap in px). */
export function spreadLabels<T extends { y: number }>(labels: T[], gap: number, min: number, max: number): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + gap };
  }
  const overflow = (sorted.at(-1)?.y ?? 0) - max;
  if (overflow > 0) {
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const limit = i === sorted.length - 1 ? max : sorted[i + 1].y - gap;
      sorted[i] = { ...sorted[i], y: Math.max(min, Math.min(sorted[i].y, limit)) };
    }
  }
  return sorted;
}
