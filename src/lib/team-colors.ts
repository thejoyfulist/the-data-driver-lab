/**
 * Team colours — the single source for every team colour on the site.
 *
 * Keys are the official 2026 team names from NOMENCLATURE.md (formula1.com
 * display names). Historical API spellings resolve through TEAM_NAME_ALIASES;
 * an alias only maps a colour to the same racing entrant under an earlier name,
 * it never renames the team in the UI (the API value is always displayed).
 *
 * `color` is the brand fill used for bars, lines and dots. Text drawn in a
 * team colour must go through `readableTeamColor`, which lightens the fill
 * until it reaches WCAG AA (4.5:1) on the Lab's lightest dark surface.
 */

export const OFFICIAL_TEAM_NAMES = [
  "Mercedes",
  "Ferrari",
  "McLaren",
  "Red Bull Racing",
  "Racing Bulls",
  "Alpine",
  "Haas F1 Team",
  "Audi",
  "Williams",
  "Aston Martin",
  "Cadillac",
] as const;

export type OfficialTeamName = (typeof OFFICIAL_TEAM_NAMES)[number];

export const TEAM_COLORS: Record<OfficialTeamName, string> = {
  Mercedes: "#27F4D2",
  Ferrari: "#E8002D",
  McLaren: "#FF8000",
  "Red Bull Racing": "#3671C6",
  "Racing Bulls": "#6692FF",
  Alpine: "#00A1E8",
  "Haas F1 Team": "#DEE1E2",
  Audi: "#FF2D00",
  Williams: "#1868DB",
  "Aston Martin": "#229971",
  Cadillac: "#AAAAAD",
};

/** Earlier API spellings of the same entrants (colour lookup only). */
const TEAM_NAME_ALIASES: Record<string, OfficialTeamName> = {
  "red bull": "Red Bull Racing",
  "oracle red bull racing": "Red Bull Racing",
  haas: "Haas F1 Team",
  "moneygram haas f1 team": "Haas F1 Team",
  rb: "Racing Bulls",
  "rb f1 team": "Racing Bulls",
  "visa cash app rb": "Racing Bulls",
  "visa cash app racing bulls": "Racing Bulls",
  "kick sauber": "Audi",
  "stake f1 team kick sauber": "Audi",
  "audi f1 team": "Audi",
  "mclaren f1 team": "McLaren",
  "scuderia ferrari": "Ferrari",
  "scuderia ferrari hp": "Ferrari",
  "mercedes-amg petronas f1 team": "Mercedes",
  "bwt alpine f1 team": "Alpine",
  "williams racing": "Williams",
  "aston martin aramco f1 team": "Aston Martin",
  "cadillac f1 team": "Cadillac",
};

/** Neutral fill for teams outside the current grid (never a guessed brand colour). */
export const UNKNOWN_TEAM_COLOR = "#8D98A7";

/**
 * Background the readable variants are computed against: the lightest
 * surface a team-coloured label sits on (selected row on a card, about
 * white/6 over the `dark` page), so the 4.5:1 floor holds everywhere.
 */
export const LAB_BACKGROUND = "#1A1D22";

function normalizeTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const OFFICIAL_BY_NORMALIZED = new Map<string, OfficialTeamName>(
  OFFICIAL_TEAM_NAMES.map((name) => [normalizeTeamName(name), name]),
);

/** Resolve an API team name to its official 2026 key, or null when unknown. */
export function resolveOfficialTeam(name: string | null | undefined): OfficialTeamName | null {
  if (!name) return null;
  const key = normalizeTeamName(name);
  return OFFICIAL_BY_NORMALIZED.get(key) ?? TEAM_NAME_ALIASES[key] ?? null;
}

/** Brand fill for a team (bars, lines, dots). */
export function teamColor(name: string | null | undefined): string {
  const team = resolveOfficialTeam(name);
  return team ? TEAM_COLORS[team] : UNKNOWN_TEAM_COLOR;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `hex` towards white until it reaches `minimum` contrast on `background`. */
export function ensureContrast(hex: string, background = LAB_BACKGROUND, minimum = 4.5): string {
  const base = parseHex(hex);
  for (let step = 0; step <= 20; step += 1) {
    const t = step / 20;
    const mixed = base.map((c) => c + (255 - c) * t) as [number, number, number];
    const candidate = toHex(mixed);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return "#FFFFFF";
}

/** Team colour safe for text on the dark Lab surfaces (≥ 4.5:1). */
export function readableTeamColor(name: string | null | undefined): string {
  return ensureContrast(teamColor(name));
}
