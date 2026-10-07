import test from "node:test";
import assert from "node:assert/strict";

import { isAllowedProxyPath } from "../src/lib/proxy-allowlist.mjs";

const split = (path) => path.split("/");

test("allows every read endpoint the Lab consumes", () => {
  for (const path of [
    "v1/f1/calendar/2026",
    "v1/f1/calendar/next",
    "v1/f1/circuits",
    "v1/f1/standings/drivers/2026",
    "v1/f1/standings/constructors/2025",
    "v1/f1/races/2026/13/results",
    "v1/f1/races/2026/13/qualifying",
    "v1/f1/races/2026/13/fastest-laps",
    "v1/f1/races/2026/13/pitstops",
    "v1/f1/races/2026/13/safety-cars",
    "v1/f1/races/2026/13/incidents",
    "v1/f1/races/2026/13/weather",
    "v1/f1/races/2026/13/ingestion-readiness",
    "v1/f1/races/2026/13/laps/4",
    "v1/f1/races/2026/13/telemetry/81",
    "v1/f1/races/2026/13/practice/FP1/best",
    "v1/f1/predictions/race/2026/13",
    "v1/f1/predictions/qualifying/2026/13",
    "v1/f1/drivers/4/head-to-head/81",
  ]) {
    assert.equal(isAllowedProxyPath("GET", split(path)), true, path);
  }
});

test("allows the grounded chat as the only POST", () => {
  assert.equal(isAllowedProxyPath("POST", split("v1/f1/chat")), true);
  assert.equal(isAllowedProxyPath("GET", split("v1/f1/chat")), false);
  assert.equal(isAllowedProxyPath("POST", split("v1/f1/standings/drivers/2026")), false);
});

test("refuses unknown paths, traversal, encoded separators and other methods", () => {
  for (const segments of [
    [],
    split("v1/admin/users"),
    split("v1/f1/races/2026/13/../../../health"),
    split("v1/f1/races/2026/13/practice/FP4/best"),
    split("v1/f1/drivers/4/head-to-head/81/extra"),
    ["v1", "f1", "circuits%2F..%2Fadmin"],
    ["v1", "f1", "circuits", ""],
    ["v1", "f1", "calendar", "2026?x=1"],
  ]) {
    assert.equal(isAllowedProxyPath("GET", segments), false, segments.join("/"));
  }
  assert.equal(isAllowedProxyPath("DELETE", split("v1/f1/circuits")), false);
  assert.equal(isAllowedProxyPath("PUT", split("v1/f1/chat")), false);
});
