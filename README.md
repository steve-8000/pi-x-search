# pi-x-search

Senpi/Pi extension that exposes xAI's built-in X Search tool as LLM-callable
`x_search` and `x_search_deep` tools.

## Install

```bash
senpi install git:github.com/steve-8000/pi-x-search
```

Then reload Senpi or start a new session.

## Auth

The package registers the `xai-oauth` login provider when Senpi loads the
extension. The tool uses Senpi's credentials and never logs tokens.

Credential priority:

1. `xai-oauth` — xAI Grok OAuth / SuperGrok subscription
2. `xai` — `XAI_API_KEY`

Login with subscription credentials:

```bash
senpi
/login
# choose xAI Grok OAuth
```

For package consumers that need the login module directly:

```ts
import { loginXaiOAuth, refreshXaiOAuthToken, xaiOAuthProvider } from "pi-x-search/xai-oauth";
```

Or configure an API key for the `xai` provider.

## Tools

### `x_search`

Tool name: `x_search`

Parameters:

- `query` — search query
- `allowed_x_handles` — optional allow-list of X handles, without or with `@`
- `excluded_x_handles` — optional block-list of X handles
- `from_date` / `to_date` — optional date filters, passed through to xAI
- `enable_image_understanding` / `enable_video_understanding` — optional xAI search flags
- `return_full_text` — ask xAI to return the complete original post text verbatim instead of a summary

`allowed_x_handles` and `excluded_x_handles` cannot be used together.

Example:

```json
{
  "query": "https://x.com/xai/status/123",
  "return_full_text": true
}
```

### `x_search_deep`

Tool name: `x_search_deep`

Use this for long X posts or threads where a normal `x_search` response may be
truncated. The tool first asks xAI for the post's character count, then requests
the original text in character ranges and merges the chunks.

By default, `x_search_deep` writes the reconstructed text to a Markdown file
instead of returning the whole text inline. This avoids large tool-response
truncation in Senpi.

Parameters:

- `query` — preferably a direct X status URL
- `allowed_x_handles` / `excluded_x_handles` — optional handle filters; cannot be combined
- `from_date` / `to_date` — optional date filters
- `enable_image_understanding` / `enable_video_understanding` — optional xAI search flags
- `chunk_size` — characters per chunk; default `900`, min `200`, max `2000`
- `max_chunks` — maximum chunks to request; default `12`, max `50`
- `overlap_chars` — optional overlap between chunks; default `0`, max `200`
- `output_mode` — `"file"` or `"inline"`; default `"file"`
- `output_path` — optional Markdown output path for file mode

File-mode example:

```json
{
  "query": "https://x.com/FourPillarsFP/status/2056555742468182228",
  "output_mode": "file",
  "output_path": "/Users/steve/x-posts/fourpillars.md",
  "chunk_size": 900,
  "max_chunks": 12
}
```

If `output_path` is omitted, file mode writes to:

```text
./x-search-deep-results/{status_id}.md
```

Inline mode is still available for smaller posts or tests:

```json
{
  "query": "https://x.com/xai/status/123",
  "output_mode": "inline",
  "chunk_size": 900,
  "max_chunks": 5
}
```

Check `complete` and `warnings` before treating `full_text` or the Markdown file
as authoritative.

## Defaults

- Model: `grok-4.3`
- Endpoint: `https://api.x.ai/v1/responses`
- Request storage: `store: false`

Environment overrides:

```bash
PI_X_SEARCH_MODEL=grok-4.3
PI_X_SEARCH_BASE_URL=https://api.x.ai/v1
PI_X_SEARCH_TIMEOUT_MS=180000
PI_X_SEARCH_RETRIES=2
PI_X_SEARCH_DEEP_OUTPUT_DIR=./x-search-deep-results
```

## Development

```bash
npm install
npm run verify
```
