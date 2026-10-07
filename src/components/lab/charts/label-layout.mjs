/**
 * Spread end-of-line labels so they never overlap: push down from the top,
 * pull back from the bottom edge, and when there are more labels than the
 * height can hold at `gap`, space them evenly instead (still no overlap as
 * long as `gap` fits; the legend names every line anyway).
 */
export function spreadLabels(labels, gap, min, max) {
  const sorted = [...labels].sort((a, b) => a.y - b.y).map((label) => ({ ...label, y: Math.max(min, Math.min(label.y, max)) }));
  if (sorted.length < 2) return sorted;
  if ((sorted.length - 1) * gap > max - min) {
    const step = (max - min) / (sorted.length - 1);
    return sorted.map((label, index) => ({ ...label, y: min + index * step }));
  }
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  if (sorted[sorted.length - 1].y > max) {
    sorted[sorted.length - 1].y = max;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      if (sorted[i + 1].y - sorted[i].y < gap) sorted[i].y = sorted[i + 1].y - gap;
    }
  }
  return sorted;
}
