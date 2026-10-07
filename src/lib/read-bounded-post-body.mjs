import { MAX_POST_BYTES } from "./proxy-allowlist.mjs";

/** Read at most the chat proxy's byte limit, returning null on overflow. */
export async function readBoundedPostBody(request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_POST_BYTES) {
    return null;
  }

  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const buffer = new Uint8Array(MAX_POST_BYTES);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > MAX_POST_BYTES - size) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return buffer.buffer.slice(0, size);
}
