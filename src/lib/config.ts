/**
 * Runtime configuration shared by the server components and the API proxy.
 *
 * `TDD_API_BASE` (server only) wins over `NEXT_PUBLIC_TDD_API_BASE`; both
 * default to the public, non-commercial The Data Driver API.
 */

export const DEFAULT_API_BASE = "https://api.thedatadriver.app";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function apiBase(): string {
  const configured = process.env.TDD_API_BASE || process.env.NEXT_PUBLIC_TDD_API_BASE || DEFAULT_API_BASE;
  return trimTrailingSlash(configured);
}

