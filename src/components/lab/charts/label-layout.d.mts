/** Spread end-of-line labels so they never overlap (minimum gap in px, kept within [min, max]). */
export declare function spreadLabels<T extends { y: number }>(labels: readonly T[], gap: number, min: number, max: number): T[];
