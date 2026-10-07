import { PROVIDER_CONNECT_ORIGINS } from "./src/lib/ai-byok/providers.mjs";

const apiOrigin = (process.env.NEXT_PUBLIC_TDD_API_BASE || "https://api.thedatadriver.app").replace(/\/+$/, "");

// "AI — your own key" calls the visitor's provider from the browser: the fixed
// providers and a local Ollama are allowed. A self-hosted Lab can allow its own
// OpenAI-compatible endpoints (space-separated origins); see docs/AI.md.
const extraAiOrigins = (process.env.NEXT_PUBLIC_TDD_AI_CONNECT_SRC || "")
  .split(/\s+/)
  .filter(Boolean)
  .map((value) => {
    const url = new URL(value);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(`NEXT_PUBLIC_TDD_AI_CONNECT_SRC: ${value} must use HTTPS (HTTP only for localhost).`);
    }
    return url.origin;
  });
const connectSources = ["'self'", apiOrigin, ...PROVIDER_CONNECT_ORIGINS, ...extraAiOrigins];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js inlines its bootstrap scripts; no third-party script is loaded.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src ${[...new Set(connectSources)].join(" ")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the Docker image small (see Dockerfile).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // The Lab is served at /lab on thedatadriver.app; keep shared links working.
    return [{ source: "/lab", destination: "/", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
