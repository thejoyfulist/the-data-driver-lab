export type ProviderId = "anthropic" | "openai" | "openrouter" | "groq" | "ollama" | "custom";

export interface ProviderInfo {
  label: string;
  baseURL: string;
  keyRequired: boolean;
  editableBaseURL: boolean;
  models: string[];
  keyHint: string;
}

export interface AiSettings {
  provider?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
}

export interface CheckedSettings {
  provider: ProviderId;
  model: string;
  baseURL: string;
  apiKey: string;
}

export declare const PROVIDERS: Record<ProviderId, ProviderInfo>;
export declare const PROVIDER_IDS: ProviderId[];
export declare const PROVIDER_CONNECT_ORIGINS: string[];
export declare function isProviderId(value: unknown): value is ProviderId;
export declare function validateBaseURL(value: string, options?: { pageOrigin?: string }): { ok: true; url: string } | { ok: false; error: string };
export declare function checkSettings(settings: AiSettings, options?: { pageOrigin?: string }): { ok: true; value: CheckedSettings } | { ok: false; error: string };
