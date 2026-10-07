import { NextRequest } from "next/server";
import { apiBase } from "@/lib/config";
import { isAllowedProxyPath, MAX_POST_BYTES } from "@/lib/proxy-allowlist.mjs";

// Browser requests stay same-origin: the Lab calls /api/f1/v1/f1/..., this
// route forwards allow-listed read paths (and the grounded chat POST) upstream.

// The grounded chat answers more slowly than the cached read endpoints.
const READ_TIMEOUT_MS = 8_000;
const CHAT_TIMEOUT_MS = 25_000;

function jsonError(status: number, detail: string) {
  return Response.json({ status: "error", detail }, { status });
}

function upstreamUrl(request: NextRequest, path: string[]) {
  const target = new URL(`${apiBase()}/${path.join("/")}`);
  target.search = new URL(request.url).search;
  return target;
}

async function proxy(request: NextRequest, path: string[]) {
  if (!isAllowedProxyPath(request.method, path)) return jsonError(404, "Path not served by the Data Lab proxy.");

  const headers = new Headers({ Accept: "application/json" });
  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_POST_BYTES) return jsonError(413, "Request body too large.");
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(upstreamUrl(request, path), {
      signal: AbortSignal.timeout(request.method === "POST" ? CHAT_TIMEOUT_MS : READ_TIMEOUT_MS),
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (error) {
    console.warn(`Data Lab proxy: upstream unavailable for /${path.join("/")}`, error);
    return jsonError(502, "Upstream API unavailable.");
  }

  const responseHeaders = new Headers();
  const responseContentType = response.headers.get("content-type");
  if (responseContentType) responseHeaders.set("content-type", responseContentType);

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}
