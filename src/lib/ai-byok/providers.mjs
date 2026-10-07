/**
 * "AI — your own key" providers. Pure metadata and checks (no SDK import), so
 * the Lab can render the settings form and `node --test` can cover the rules.
 *
 * The browser calls the provider directly. A base URL is accepted only when
 * it cannot send the key to The Data Driver: HTTPS (or plain HTTP on the
 * local machine for Ollama), no credentials in the URL, no public IP literal,
 * never this site's host and never a thedatadriver.app host, whatever its
 * spelling (case, trailing dot, %2e, IDNA). On a page, the endpoint must also
 * be in the CSP connect-src list (aiConnectOrigins).
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

/**
 * Extra origins a self-hosted Lab allows for its own OpenAI-compatible
 * endpoints (space-separated, build time). The site's CSP and the settings
 * check read the same list, so an endpoint outside it is refused in the form
 * instead of failing in the browser.
 */
export const AI_CONNECT_SRC_ENV = "NEXT_PUBLIC_TDD_AI_CONNECT_SRC";

/** Registrable domains of The Data Driver: a key must never reach them. */
const TDD_DOMAINS = ["thedatadriver.app", "thedatadriver.com"];

/**
 * Canonical form of a URL host for comparisons: lower case, percent-decoded,
 * IDNA (punycode) and without trailing dots, so "API.THEDATADRIVER.APP.",
 * "api%2ethedatadriver%2eapp" and "api.thedatadriver。app" all compare equal
 * to "api.thedatadriver.app". Returns null when the host is not valid.
 * @param {string} hostname
 */
export function normaliseHost(hostname) {
  let host = String(hostname ?? "").trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith("[")) return host;
  try {
    host = decodeURIComponent(host);
  } catch {
    return null;
  }
  try {
    // The WHATWG host parser applies IDNA mapping (full-width dots and
    // letters, upper case) and punycode; only trailing dots remain.
    host = new URL(`http://${host.replace(/[\u3002\uff0e\uff61]/g, ".")}/`).hostname;
  } catch {
    return null;
  }
  return host.replace(/\.+$/, "") || null;
}

/** True for a host that is (or resolves to) this machine. */
export function isLoopbackHost(host) {
  if (!host) return false;
  return host === "localhost" || host.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "0.0.0.0" || host === "[::1]" || host === "[::]" || /^\[::ffff:(7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/.test(host);
}

/** True for thedatadriver.app (or a former TDD domain) and any subdomain. */
export function isTddHost(host) {
  return Boolean(host) && TDD_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

const isIpLiteral = (host) => host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
const effectivePort = (url) => url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");

/**
 * Origins a page of this site may call for "AI — your own key": the fixed
 * providers, a local Ollama and the self-hoster's extra list.
 * @param {string | undefined} [extra] value of NEXT_PUBLIC_TDD_AI_CONNECT_SRC
 */
export function aiConnectOrigins(extra = process.env.NEXT_PUBLIC_TDD_AI_CONNECT_SRC) {
  return [...new Set([...PROVIDER_CONNECT_ORIGINS, ...parseConnectOrigins(extra)])];
}

/**
 * Parse the extra origin list. Throws on an invalid entry so a bad build
 * setting fails the build instead of silently widening the CSP.
 * @param {string | undefined} value
 */
export function parseConnectOrigins(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean).map((entry) => {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`${AI_CONNECT_SRC_ENV}: ${entry} is not a URL.`);
    }
    const host = normaliseHost(url.hostname);
    if (url.username || url.password) throw new Error(`${AI_CONNECT_SRC_ENV}: ${entry} must not carry credentials.`);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(host))) {
      throw new Error(`${AI_CONNECT_SRC_ENV}: ${entry} must use HTTPS (HTTP only for localhost).`);
    }
    if (isTddHost(host)) throw new Error(`${AI_CONNECT_SRC_ENV}: ${entry} is a The Data Driver host.`);
    return url.origin;
  });
}

export function isProviderId(value) {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

const RELAY_ERROR = "The Data Driver does not relay AI requests: use your provider's own URL.";

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
  const host = normaliseHost(url.hostname);
  if (!host) return { ok: false, error: "Enter a full URL, e.g. http://localhost:11434/v1." };
  const local = isLoopbackHost(host);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    return { ok: false, error: "Use HTTPS (plain HTTP is accepted only for localhost)." };
  }
  if (isTddHost(host)) return { ok: false, error: RELAY_ERROR };
  if (isIpLiteral(host) && !local) return { ok: false, error: "Use the provider's host name, not an IP address." };
  if (pageOrigin) {
    let page = null;
    try {
      page = new URL(pageOrigin);
    } catch {
      page = null;
    }
    const pageHost = page ? normaliseHost(page.hostname) : null;
    // This site's host (any port), or this machine under any of its names
    // on the page's port (a local Ollama on another port stays allowed).
    const samePlace = pageHost && (local
      ? isLoopbackHost(pageHost) && effectivePort(page) === effectivePort(url)
      : pageHost === host);
    if (samePlace) return { ok: false, error: "This site does not relay AI requests: use your provider's own URL." };
  }
  if (url.search || url.hash) return { ok: false, error: "Remove the query string from the URL." };
  return { ok: true, url: url.toString().replace(/\/+$/, "") };
}

/**
 * Settings ready to run, or the first problem to show next to the form.
 * `allowedOrigins` (the page's CSP connect-src list, see aiConnectOrigins)
 * refuses an endpoint the browser would block anyway, with a clear message.
 * @param {{ provider?: string, model?: string, baseURL?: string, apiKey?: string }} settings
 * @param {{ pageOrigin?: string, allowedOrigins?: string[] }} [options]
 */
export function checkSettings(settings, { pageOrigin, allowedOrigins } = {}) {
  if (!isProviderId(settings?.provider)) return { ok: false, error: "Choose a provider." };
  const provider = PROVIDERS[settings.provider];
  const model = String(settings.model ?? "").trim();
  if (!model || model.length > 200) return { ok: false, error: "Enter a model name." };
  const apiKey = String(settings.apiKey ?? "").trim();
  if (provider.keyRequired && !apiKey) return { ok: false, error: `Enter your ${provider.label} API key.` };
  const base = validateBaseURL(provider.editableBaseURL ? settings.baseURL || provider.baseURL : provider.baseURL, { pageOrigin });
  if (!base.ok) return base;
  if (allowedOrigins && !allowedOrigins.includes(new URL(base.url).origin)) {
    return {
      ok: false,
      error: `This site connects only to the listed providers and to Ollama on ${PROVIDER_CONNECT_ORIGINS.filter((origin) => origin.startsWith("http:")).join(" or ")}. For another endpoint, run the open-source Data Lab and allow it there.`,
    };
  }
  return { ok: true, value: { provider: settings.provider, model, baseURL: base.url, apiKey } };
}
