import type { z } from "zod";

export type F1SourceKind = "official" | "openf1_enrichment" | "forecast" | "derived";

export interface F1ToolSource {
  name: string;
  kind: F1SourceKind;
  licence: string | null;
  attribution: string | null;
  api_url: string;
  fetched_at: string | null;
}

export interface F1ToolResult {
  tool: string;
  ok: boolean;
  data?: Record<string, unknown> | null;
  availability?: string;
  reason?: string;
  empty?: boolean;
  note?: string;
  truncated?: { shown: number; total: number };
  error?: { status: number | null; message: string };
  source?: F1ToolSource;
}

export interface F1ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  kind: F1SourceKind;
  path: (input: Record<string, unknown>) => string;
  shape: (data: unknown, input: Record<string, unknown>) => Record<string, unknown>;
}

export type F1Fetcher = (path: string) => Promise<{ status: number; body: unknown }>;

export interface F1ToolRunner {
  call(name: string, input: unknown): Promise<F1ToolResult>;
  tools: F1ToolDefinition[];
}

export declare const DEFAULT_PUBLIC_API_ORIGIN: string;
export declare const MAX_RESULT_CHARS: number;
export declare const F1_TOOLS: F1ToolDefinition[];
export declare function formatMs(ms: number | null | undefined): string | null;
export declare function describeProvenance(meta: unknown, kind: F1SourceKind, apiUrl: string): F1ToolSource;
export declare function availabilityOf(data: unknown): { availability?: string; reason?: string };
export declare function boundRows<T>(rows: T[] | unknown, max: number): { rows: T[]; truncated?: { shown: number; total: number } };
export declare function fitResult(result: F1ToolResult, maxChars?: number): F1ToolResult;
export declare function createProxyFetcher(base?: string, timeoutMs?: number): F1Fetcher;
export declare function createHttpFetcher(apiBase?: string, timeoutMs?: number): F1Fetcher;
export declare function createSnapshotFetcher(snapshot: Record<string, { status: number; body: unknown }>): F1Fetcher;
export declare function createF1ToolRunner(options: { fetchJson: F1Fetcher; publicOrigin?: string }): F1ToolRunner;
export declare function toolJsonSchemas(): { name: string; title: string; description: string; inputSchema: Record<string, unknown> }[];
