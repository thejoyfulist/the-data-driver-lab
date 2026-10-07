# API used by the Data Lab

The Lab reads the public, free and non-commercial **The Data Driver API**. The interactive reference
(all endpoints, parameters and examples) is at **<https://thedatadriver.app/api-docs>**.

- Base URL: `https://api.thedatadriver.app`
- Response envelope: `{ "status": "...", "data": ..., "meta": { "source", "series", "timestamp", "cache_ttl", ... } }`
- Provenance: `meta.source`, `meta.license`, `meta.license_url` and `meta.attribution` identify the source of
  each payload. OpenF1-derived payloads carry `"source": "openf1.org"` and `"license": "CC BY-NC-SA 4.0"`.
- No key is required. Rate limits protect the service; cache responses and avoid tight polling loops.

## Endpoints the Lab calls

All are `GET` unless stated. `{season}` is a year, `{round}` the API's internal round key (the Lab
displays formula1.com's official round number when the API certifies it), `{driver}` a numeric driver id.

| Endpoint | Used by |
| --- | --- |
| `/v1/f1/calendar/{season}`, `/v1/f1/calendar/next` | Season and race selectors |
| `/v1/f1/circuits` | Circuit filter |
| `/v1/f1/standings/drivers/{season}` | Field, season comparison |
| `/v1/f1/standings/constructors/{season}` | Constructors |
| `/v1/f1/races/{season}/{round}/results` | Field, championship progression (one request per completed round) |
| `/v1/f1/races/{season}/{round}/qualifying` | Sessions |
| `/v1/f1/races/{season}/{round}/practice/{FP1\|FP2\|FP3}/best` | Sessions |
| `/v1/f1/races/{season}/{round}/laps/{driver}` | Lap-by-lap pace, strategy |
| `/v1/f1/races/{season}/{round}/fastest-laps` | Fastest laps |
| `/v1/f1/races/{season}/{round}/pitstops` | Pit stops and stints |
| `/v1/f1/races/{season}/{round}/safety-cars`, `/incidents`, `/weather` | Race timeline |
| `/v1/f1/races/{season}/{round}/telemetry/{driver}` | Telemetry panel |
| `/v1/f1/races/{season}/{round}/ingestion-readiness` | Data readiness banner |
| `/v1/f1/predictions/race/{season}/{round}` | Field (win probability) |
| `/v1/f1/predictions/qualifying/{season}/{round}` | Sessions (qualifying forecast) |
| `/v1/f1/drivers/{driver}/head-to-head/{driver}?season={season}` | Head-to-head |
| `POST /v1/f1/chat` — body `{ "message": "..." }` | Ask (grounded answers with sources) |

The same list is enforced by the proxy allow-list in `src/lib/proxy-allowlist.mjs`. If you add a view that
needs another endpoint, add it there too, with a unit test in `tests/proxy-allowlist.test.mjs`.

## Example

```bash
curl -s https://api.thedatadriver.app/v1/f1/standings/drivers/2026 | jq '.data[0], .meta'
```

## Licences of the data

See [Data licences](../README.md#data-licences). In short: official classifications come from formula1.com
(attribution); lap, stint, weather, race-control and telemetry enrichment comes from OpenF1 under
CC BY-NC-SA 4.0 (non-commercial, attribution, share-alike).
