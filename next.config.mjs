import { aiConnectOrigins } from "./src/lib/ai-byok/providers.mjs";

const apiOrigin = (process.env.NEXT_PUBLIC_TDD_API_BASE || "https://api.thedatadriver.app").replace(/\/+$/, "");

// "AI — your own key" calls the visitor's provider from the browser: the fixed
// providers and a local Ollama are allowed. A self-hosted Lab can allow its own
// OpenAI-compatible endpoints with NEXT_PUBLIC_TDD_AI_CONNECT_SRC
// (space-separated origins; an invalid entry or a The Data Driver host fails
// the build). The AI settings form reads the same list. See docs/AI.md.
const connectSources = ["'self'", apiOrigin, ...aiConnectOrigins()];

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
