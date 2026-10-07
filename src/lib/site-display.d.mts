export interface RoundLike {
  round?: number | null;
  official_round?: number | null;
}

/** internal round → official round (null = cancelled / not an official round). */
export type OfficialRoundMap = Record<number, number | null>;

export declare function buildOfficialRoundMap(
  calendar: readonly RoundLike[] | null | undefined,
): OfficialRoundMap;
export declare const OFFICIAL_ROUND_BASIS: "formula1.com-chronological-v2";
export declare function hasTrustedOfficialRounds(
  meta: { official_round_basis?: unknown } | null | undefined,
): boolean;
export declare function withTrustedOfficialRounds<T>(
  data: T,
  meta: { official_round_basis?: unknown } | null | undefined,
): T;
export declare function resolveOfficialRound(race: RoundLike | null | undefined): number | null;
export declare function formatOfficialRound(
  officialRound: number | null | undefined,
  options?: { pad?: boolean },
): string | null;
export declare function officialRoundLabel(
  race: RoundLike | null | undefined,
  options?: { pad?: boolean },
): string | null;
export declare function sortRacesChronologically<T extends RoundLike & { date?: string | null }>(
  races: readonly T[] | null | undefined,
): T[];
export declare function latestChronologicalRound(
  history: readonly RoundLike[] | null | undefined,
): number | undefined;
export declare function remapArticleRoundText(
  text: string,
  slug: string | null | undefined,
  map?: OfficialRoundMap | null,
): string;

export interface BinaryCardLike {
  type: string;
  title: string;
}
export declare function mapSettledBinaryIndices<T extends BinaryCardLike>(
  scoredCards: readonly T[] | null | undefined,
  unscoredCards: readonly BinaryCardLike[] | null | undefined,
): { index: number; type: string; title: string }[];

export declare function officialShortRaceName(name: string | null | undefined): string | null;
export declare function raceLocationLabel(name: string | null | undefined): string;
export declare function raceCountryCode(name: string | null | undefined): string | null;
export declare function raceCardLabel(
  name: string | null | undefined,
  circuitCountry: string | null | undefined,
): { short: string | null; full: string | null };

export declare function formatBoundedProbability(
  probability: number | null | undefined,
  options?: { settled?: boolean; digits?: number },
): string | null;
export declare function isTitleClinched(
  leaderPoints: number,
  secondPoints: number,
  remainingRaces: readonly { maxPoints: number }[] | null | undefined,
): boolean;
export declare function titleSettledFlags(
  points: readonly number[] | null | undefined,
  remainingRaces: readonly { maxPoints: number }[] | null | undefined,
): boolean[];

export declare function trackRecordOutcome(
  race: Record<string, unknown> | null | undefined,
  key: "top1_correct" | "top3_correct" | "beats_grid",
): boolean | null;

export declare function dedupeSectionLines(content: string | null | undefined): string;
export declare function countWords(text: string | null | undefined): number;
export declare function estimateReadingMinutes(
  parts: readonly (string | null | undefined)[] | null | undefined,
  wordsPerMinute?: number,
): number;
