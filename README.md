# pi-x-search

Senpi/Pi extension that exposes xAI's built-in X Search tool as an LLM-callable
`x_search` tool.

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

## Tool

Tool name: `x_search`

Parameters:

- `query` — search query
- `allowed_x_handles` — optional allow-list of X handles, without or with `@`
- `excluded_x_handles` — optional block-list of X handles
- `from_date` / `to_date` — optional date filters, passed through to xAI
- `enable_image_understanding` / `enable_video_understanding` — optional xAI search flags

`allowed_x_handles` and `excluded_x_handles` cannot be used together.

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
```

## Development

```bash
npm install
npm run verify
```
