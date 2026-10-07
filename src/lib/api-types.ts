// Types matching the API response shapes

export interface APIPrediction {
  rank: number;
  driver_id: number;
  driver_code: string;
  driver_name: string;
  probability: number;
  p_win: number;
  p_podium: number;
  p_points?: number;
  p_dnf?: number;
  e_position: number;
  e_points: number;
  /** P1..P20 classified-position mass. The missing row mass is DNF. */
  position_distribution?: number[];
}

export interface APIRacePredictions {
  race: string;
  round: number;
  /** formula1.com round; optional (rule 31). */
  official_round?: number | null;
  year: number;
  date: string;
  status: string;
  model_version: string;
  circuit: {
    name: string;
    city: string;
    country: string;
  } | null;
  predictions: APIPrediction[];
}

export interface APITrackRecordRace {
  race_id: number;
  race_name: string;
  season: number;
  round: number;
  /** formula1.com round; optional until every endpoint exposes it (rule 31). */
  official_round?: number | null;
  brier_score: number;
  log_loss?: number;
  grid_baseline: number;
  beats_grid: boolean;
  top1_correct: boolean;
  top3_correct: boolean;
  top3_overlap: number;
  predicted_winner: string;
  actual_winner: string;
  n_predictions: number;
  /** model_version tag; contains "backfill" when reconstructed is true. */
  model_version?: string | null;
  /** True when this round was generated post-hoc via walk-forward backfill
   * (app.ml.backfill_2026), not a genuine pre-race live prediction. */
  reconstructed?: boolean;
}

export interface APITrackRecord {
  total_scored: number;
  n_races_scored: number;
  brier_score: number | null;
  skill_score?: number | null;
  log_loss?: number | null;
  top1_accuracy?: number | null;
  top3_accuracy?: number | null;
  brier_decomposition?: {
    reliability: number;
    resolution: number;
    uncertainty: number;
  } | null;
  baselines: {
    grid: { brier: number; skill_score: number };
    championship: { brier: number; skill_score: number };
    random: { brier: number; skill_score: number };
    // Legacy fields for backwards compat
    vs_grid_pct?: number;
    beats_grid?: boolean;
    [key: string]: unknown;
  } | null;
  sharpness?: {
    mean_favourite_prob: number;
    per_race: number[];
    trend: string;
  } | null;
  calibration: {
    bin_lower: number;
    bin_upper: number;
    mean_predicted: number;
    mean_actual: number;
    count: number;
  }[];
  history: APITrackRecordRace[];
  backtest: {
    races: number;
    years: string;
    brier: number;
    spearman: number;
    beats_grid: boolean;
    calibration?: {
      mean_predicted: number;
      mean_actual: number;
      count: number;
    }[];
  } | null;
  // Headline numbers above (brier_score, n_races_scored, calibration,
  // sharpness) are live-only by construction — a walk-forward-backfilled
  // round never moves them. These two blocks give the reconstructed-only and
  // reconstructed+live views, always labeled as such; never silently blend
  // "combined" into the headline fields.
  reconstructed?: { brier_score: number | null; n_races_scored: number };
  combined?: { brier_score: number | null; n_races_scored: number };
  // Coverage: how many completed races have been scored vs how many exist to
  // score. n_races_scored alone has no denominator — a race can be
  // "completed" with zero predictions ever generated (missed scheduler
  // window) and there was no way to tell from the old shape. Series-agnostic
  // naming (scored/total, not "races_scored") so this isn't F1-specific.
  coverage?: { scored: number; total: number };
  // ISO timestamp of the most recent scoring run behind this response, or
  // null if nothing is scored yet. Not the request time — the data's actual
  // freshness, so the frontend can show "as of <date>" instead of implying
  // this is always live-computed.
  generated_at?: string | null;
  message?: string;
}

export interface APIDriverStanding {
  position: number;
  driver_id: number;
  driver_code: string;
  first_name: string;
  last_name: string;
  team_name: string;
  points: number;
  wins: number;
}

export interface APIConstructorStanding {
  position: number;
  team_id: number;
  team_name: string;
  points: number;
  wins: number;
}

export interface APICalendarRace {
  round: number;
  /** formula1.com round; null for a cancelled race. Optional (rule 31). */
  official_round?: number | null;
  name: string;
  date: string;
  time: string | null;
  is_sprint: boolean;
  status: string;
  circuit: {
    name: string;
    city: string;
    country: string;
  } | null;
}

export interface APIDriverHeadToHead {
  driver1: {
    id: number;
    code: string;
    first_name: string;
    last_name: string;
  };
  driver2: {
    id: number;
    code: string;
    first_name: string;
    last_name: string;
  };
  race_h2h: { driver1_wins: number; driver2_wins: number; total: number };
  season_race_h2h: { driver1_wins: number; driver2_wins: number; total: number };
  quali_h2h: { driver1_wins: number; driver2_wins: number; total: number };
  prediction: {
    round: number;
    p_driver1_ahead: number;
    driver1_expected_pos: number | null;
    driver2_expected_pos: number | null;
  } | null;
}
