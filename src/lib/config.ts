/** Server-side API base shared by the Data Lab and its proxy. */
export const DEFAULT_API_BASE = "https://api.thedatadriver.app";

export function apiBase(): string {
  const configured = process.env.API_URL || process.env.TDD_API_BASE ||
    process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_TDD_API_BASE || DEFAULT_API_BASE;
  return configured.replace(/\/+$/, "");
}
