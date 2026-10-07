# Use The Data Driver with Claude or ChatGPT

The Data Driver exposes public, read-only Formula 1 data through MCP. The hosted Streamable HTTP endpoint is:

```text
https://thedatadriver.app/api/mcp
```

No account or key is required. The server offers 19 F1 tools plus `search` and `fetch`. Each F1 response includes its public API URL, source, licence, and any published availability reason. `search` returns IDs for published races and drivers; `fetch` returns a citable document for an ID. Responses are bounded, so a truncated list is marked as such.

## Claude

For an individual Claude Pro or Max account, open **Customize → Connectors → + Add → Add custom connector**. Enter the URL above and choose **No sign in**. On Team and Enterprise plans, an owner adds it first in **Organization settings → Connectors → Add → Custom → Web**; members can then enable it. See [Claude’s current connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp). In Claude Code, add the hosted server with:

```bash
claude mcp add --transport http the-data-driver https://thedatadriver.app/api/mcp
```

For Claude Desktop or Claude Code using a local checkout, install dependencies and run the stdio server:

```bash
npm install
npm run mcp:stdio
```

For a Desktop configuration, point a stdio MCP server at Node with this repository's absolute `scripts/mcp-stdio.mjs` path as its argument. In Claude Code, an example is:

```bash
claude mcp add the-data-driver -- node /absolute/path/to/the-data-driver-lab/scripts/mcp-stdio.mjs
```

## ChatGPT

In ChatGPT, enable **Developer mode**, then open **Settings → Apps → Create** (or **Workspace settings → Apps → Create**, depending on your permissions). Enter the hosted URL, choose no authentication, scan tools, and create the app. Workspace admins may need to enable developer mode first. See [OpenAI’s current setup guide](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt). The `search` and `fetch` tools return ChatGPT’s documented structured result format and source URLs. Availability depends on your plan and workspace settings.

## Example questions

- “What is the next published F1 race? Cite the calendar source.”
- “Find the 2026 Italian Grand Prix, then show the official race classification if published.”
- “Compare the 2026 drivers' standings for two drivers, with source links.”
- “What historical OpenF1 weather data is available for a completed race? Label it as non-official.”

## Limits and licences

The service is read-only, public and rate limited. A single call can return a shortened result; use a narrower query if needed. Upstream data can be unavailable or late, and the server does not fill gaps. Official results and standings are taken from official sources through the public API. Historical OpenF1 enrichment is non-official, attributed to [OpenF1](https://openf1.org/) and subject to [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), including its non-commercial terms. Cite the `source.api_url` or the `fetch` URL in answers. No OAuth or write tools are offered.
