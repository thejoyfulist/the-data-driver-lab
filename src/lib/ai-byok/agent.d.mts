import type { LanguageModel, TextStreamPart, ToolSet } from "ai";
import type { F1ToolResult, F1ToolRunner } from "../f1-tools/catalogue.mjs";
import type { CheckedSettings } from "./providers.mjs";

export interface AnswerSource {
  api_url: string;
  name: string | null;
  kind: string | null;
  licence: string | null;
}

export declare const MAX_TOOL_STEPS: number;
export declare function buildSystemPrompt(context: { today: string; season: number }): string;
export declare function createLanguageModel(settings: CheckedSettings, options?: { fetch?: typeof fetch }): LanguageModel;
export declare function createAiTools(runner: F1ToolRunner): ToolSet;
export declare function streamGroundedAnswer(options: {
  model: LanguageModel;
  runner: F1ToolRunner;
  question: string;
  today: string;
  season: number;
  abortSignal?: AbortSignal;
  maxSteps?: number;
}): { fullStream: AsyncIterable<TextStreamPart<ToolSet>> };
export declare function collectSources(results: Array<Partial<F1ToolResult> | null | undefined>): AnswerSource[];
export declare function providerLabel(id: string): string;
