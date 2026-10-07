import test from "node:test";
import assert from "node:assert/strict";

import { readBoundedPostBody } from "../src/lib/read-bounded-post-body.mjs";
import { MAX_POST_BYTES } from "../src/lib/proxy-allowlist.mjs";

const bytes = (size) => new Uint8Array(size).fill(65);
const request = (chunks, headers = {}) => ({
  headers: new Headers(headers),
  body: new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  }),
});

test("reads a small chat body", async () => {
  const body = await readBoundedPostBody(request([bytes(3), bytes(2)], { "content-length": "5" }));
  assert.deepEqual(new Uint8Array(body), bytes(5));
});

test("rejects an excessive Content-Length before reading the stream", async () => {
  let read = false;
  const input = {
    headers: new Headers({ "content-length": String(MAX_POST_BYTES + 1) }),
    body: { getReader() { read = true; throw new Error("body read"); } },
  };
  assert.equal(await readBoundedPostBody(input), null);
  assert.equal(read, false);
});

test("rejects an oversized streamed body without Content-Length", async () => {
  const input = request([bytes(MAX_POST_BYTES), bytes(1)]);
  assert.equal(await readBoundedPostBody(input), null);
  assert.equal(input.body.locked, false);
});
