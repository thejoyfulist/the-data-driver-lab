/**
 * Server-side API client for the Data Lab.
 *
 * Fetches the public The Data Driver API (configurable with TDD_API_BASE) and
 * returns null when the API is unavailable, so the page renders an explicit
 * "unavailable" state instead of crashing.
 */

import { withTrustedOfficialRounds } from "@/lib/site-display.mjs";
import { apiBase } from "@/lib/config";

const API_TIMEOUT_MS = 8_000;

export interface APIResponseMeta {
  source: string;
  source_url?: string;
  license?: string;
  license_url?: string;
  attribution?: string;
  adaptation_notice?: string;
  data_fetched_at?: string;
  /** Certifies `official_round` values; see OFFICIAL_ROUND_BASIS. */
  official_round_basis?: string;
  series: string;
  timestamp: string;
  cache_ttl: number;
  total?: number;
  page?: number;
}

export interface APIResponse<T> {
  status: string;
  data: T;
  meta: APIResponseMeta;
}

export interface APIDataWithMeta<T> {
  data: T;
  meta: APIResponseMeta;
}

async function fetchAPIResponse<T>(endpoint: string): Promise<APIDataWithMeta<T> | null> {
  try {
    const res = await fetch(`${apiBase()}${endpoint}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      next: { revalidate: 300 }, // ISR: revalidate every 5 minutes
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(`API ${endpoint}: ${res.status}`);
      return null;
    }

    const json: APIResponse<T> = await res.json();
    // Uncertified official round numbers never leave the API client.
    return { data: withTrustedOfficialRounds(json.data, json.meta), meta: json.meta };
  } catch (error) {
    console.warn(`API ${endpoint}: unavailable`, error);
    return null;
  }
}

/** Fetch an endpoint's `data`, or null when the API is unavailable. */
export async function fetchAPI<T>(endpoint: string): Promise<T | null> {
  return (await fetchAPIResponse<T>(endpoint))?.data ?? null;
}

/** Fetch API data while preserving the server-provided provenance envelope. */
export async function fetchAPIWithMeta<T>(endpoint: string): Promise<APIDataWithMeta<T> | null> {
  return fetchAPIResponse<T>(endpoint);
}
