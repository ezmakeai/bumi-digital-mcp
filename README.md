# Bumi Digital MCP Server

[![npm](https://img.shields.io/npm/v/bumi-digital-mcp)](https://www.npmjs.com/package/bumi-digital-mcp)

Model Context Protocol (MCP) server for [Bumi Digital](https://bumi.digital) — generate AI images, videos, audio, and upscale media directly from MCP-compatible AI assistants (Claude Desktop, ChatGPT, Cursor, Trae, and others).

This server is a thin wrapper over the Bumi Digital public REST API v1. All business logic (credits, refunds, storage, webhooks) is enforced by the API — nothing is duplicated here.

## Features

- **11 tools** covering the full Bumi Digital API surface
- **Dual transport**: stdio (local) and Streamable HTTP (remote/hosted)
- **Per-request auth** in HTTP mode — one deployment serves many users, each with their own API key
- **Stateless HTTP** — no session storage required, scales horizontally
- **Docker-ready** — Dockerfile included for Coolify/VPS deployment

## Tools

| Tool | Description |
|---|---|
| `generate_image` | Generate images (text-to-image, image-to-image) |
| `generate_video` | Generate videos (text-to-video, image-to-video, motion control, avatar, lipsync) |
| `generate_audio` | Generate audio (music, speech/TTS, lipsync) |
| `upscale_image` | Upscale images to higher resolution |
| `upscale_video` | Upscale videos to higher resolution |
| `list_models` | List available AI models by type |
| `get_models_pricing` | List models with credit pricing and full input schemas |
| `check_credits` | Check current credit balance |
| `get_generation_status` | Poll status/result of an async generation |
| `list_generations` | Generation history with filters and pagination |
| `upload_file` | Upload image/video/audio (via `source_url` or base64) for use as generation input |

Generation endpoints may return `status: "completed"` immediately or `"processing"` for async results — poll with `get_generation_status` until `completed`/`failed`. Credits are deducted upfront and refunded automatically on failure.

## Getting an API Key

1. Sign in to [bumi.digital](https://bumi.digital)
2. Go to Settings → API Keys
3. Create a key — it starts with `bd_`

## Usage

### Option A: stdio (local MCP client)

Install instantly via `npx` — no cloning or building required. Add to your MCP client config (Claude Desktop, Cursor, Trae, etc.):

```json
{
  "mcpServers": {
    "bumi-digital": {
      "command": "npx",
      "args": ["-y", "bumi-digital-mcp"],
      "env": { "BUMI_API_KEY": "bd_xxx" }
    }
  }
}
```

<details>
<summary>Alternative: run from source</summary>

```bash
git clone https://github.com/ezmakeai/bumi-digital-mcp.git
cd bumi-digital-mcp
npm install
npm run build
```

```json
{
  "mcpServers": {
    "bumi-digital": {
      "command": "node",
      "args": ["/path/to/bumi-digital-mcp/dist/index.js"],
      "env": { "BUMI_API_KEY": "bd_xxx" }
    }
  }
}
```

</details>

### Option B: Remote MCP (hosted via HTTP)

Run the server:

```bash
node dist/index.js --http
# or: MCP_TRANSPORT=http node dist/index.js
```

Client config — no installation needed, just the URL:

```json
{
  "mcpServers": {
    "bumi-digital": {
      "url": "https://mcp.bumi.digital/mcp",
      "headers": {
        "Authorization": "Bearer bd_your_api_key_here"
      }
    }
  }
}
```

Endpoints:
- `POST /mcp` — MCP protocol (Streamable HTTP)
- `GET /health` — health check, returns `{ "ok": true }`

In HTTP mode the API key is resolved per request, in this priority order:
1. `?api_key=bd_...` query parameter (for clients without custom headers, e.g. ChatGPT)
2. `Authorization: Bearer bd_...` header
3. `BUMI_API_KEY` environment variable (fallback)

### Option C: ChatGPT connector (Developer Mode)

ChatGPT connectors do not support custom headers — only OAuth or no authentication. Pass your API key as a query parameter instead:

- **Server URL**: `https://mcp.bumi.digital/mcp?api_key=bd_your_api_key_here`
- **Authentication**: None (no OAuth)

The server reads `api_key` from the query string first, then falls back to the `Authorization` header.

> Note: keys in URLs may appear in server/proxy logs. Prefer the `Authorization` header (Option B) when your client supports it.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BUMI_API_KEY` | — | API key for stdio mode. In HTTP mode this is only a fallback — clients normally pass their own key via header or `?api_key=` |
| `BUMI_BASE_URL` | `https://bumi.digital` | Bumi Digital API base URL. Set to `http://localhost:3000` for local development |
| `PORT` | `3100` | HTTP listen port (HTTP mode only) |
| `MCP_TRANSPORT` | — | Set to `http` to force HTTP mode without the `--http` flag |

## Self-Hosting (Optional)

If you operate your own Bumi Digital instance, this server can be self-hosted in HTTP mode. A `Dockerfile` is included — it builds the project and serves `/mcp` on `PORT` (default `3100`). Point your MCP clients to `https://your-domain/mcp` with `Authorization: Bearer bd_...`.

## Development

```bash
npm install
npm run build        # compile TypeScript
npm run start        # HTTP mode on PORT (default 3100)
npm run start:stdio  # stdio mode (local MCP clients)
```

Requires Node.js >= 18.

## License

MIT
