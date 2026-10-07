/**
 * "AI — your own key" providers. Pure metadata and checks (no SDK import), so
 * the Lab can render the settings form and `node --test` can cover the rules.
 *
 * The browser calls the provider directly. A base URL is accepted only when
 * it cannot send the key to The Data Driver: HTTPS (or plain HTTP on the
 * local machine for Ollama), no credentials in the URL, never this site's
 * origin and never a thedatadriver.app host.
 */

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    keyRequired: true,
    editableBaseURL: false,
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5"],
    keyHint: "sk-ant-…",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    keyRequired: true,
    editableBaseURL: false,
    models: ["gpt-5", "gpt-5-mini"],
    keyHint: "sk-…",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    keyRequired: true,
    editableBaseURL: false,
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5-mini"],
    keyHint: "sk-or-…",
  },
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    keyRequired: true,
    editableBaseURL: false,
    models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"],
    keyHint: "gsk_…",
  },
  ollama: {
    label: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    keyRequired: false,
    editableBaseURL: true,
    models: ["qwen3", "llama3.1"],
    keyHint: "Not needed",
  },
  custom: {
    label: "OpenAI-compatible endpoint",
    baseURL: "",
    keyRequired: false,
    editableBaseURL: true,
    models: [],
    keyHint: "If the endpoint needs one",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Origins the site's CSP `connect-src` allows for the fixed providers. */
export const PROVIDER_CONNECT_ORIGINS = [
  "https://api.anthropic.com",
  "https://api.openai.com",
  "https://openrouter.ai",
  "https://api.groq.com",
  "http://localhost:11434",
  "http://127.0.0.1:11434",
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isProviderId(value) {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

/**
 * @param {string} value base URL typed by the user
 * @param {{ pageOrigin?: string }} [options]
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function validateBaseURL(value, { pageOrigin } = {}) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return { ok: false, error: "Enter a full URL, e.g. http://localhost:11434/v1." };
  }
  if (url.username || url.password) return { ok: false, error: "Remove the user name or password from the URL." };
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, error: "Use HTTPS (plain HTTP is accepted only for localhost)." };
  }
  const host = url.hostname.toLowerCase();
  if (host === "thedatadriver.app" || host.endsWith(".thedatadriver.app")) {
    return { ok: false, error: "The Data Driver does not relay AI requests: use your provider's own URL." };
  }
  if (pageOrigin && url.origin === pageOrigin) {
    return { ok: false, error: "This site does not relay AI requests: use your provider's own URL." };
  }
  if (url.search || url.hash) return { ok: false, error: "Remove the query string from the URL." };
  return { ok: true, url: url.toString().replace(/\/+$/, "") };
}

/**
 * Settings ready to run, or the first problem to show next to the form.
 * @param {{ provider?: string, model?: string, baseURL?: string, apiKey?: string }} settings
 */
export function checkSettings(settings, { pageOrigin } = {}) {
  if (!isProviderId(settings?.provider)) return { ok: false, error: "Choose a provider." };
  const provider = PROVIDERS[settings.provider];
  const model = String(settings.model ?? "").trim();
  if (!model || model.length > 200) return { ok: false, error: "Enter a model name." };
  const apiKey = String(settings.apiKey ?? "").trim();
  if (provider.keyRequired && !apiKey) return { ok: false, error: `Enter your ${provider.label} API key.` };
  const base = validateBaseURL(provider.editableBaseURL ? settings.baseURL || provider.baseURL : provider.baseURL, { pageOrigin });
  if (!base.ok) return base;
  return { ok: true, value: { provider: settings.provider, model, baseURL: base.url, apiKey } };
}
