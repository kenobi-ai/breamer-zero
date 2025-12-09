# breamer-zero

Always-on CDP (Chrome DevTools Protocol) server via WSS for remote browser automation.

Run a persistent Chrome browser on any Mac, expose it via Cloudflare Tunnel, and connect from anywhere using Puppeteer.

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy env and configure your tunnel hostname
cp .env.example .env

# Run the server
pnpm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TUNNEL_HOSTNAME` | ✅ | - | Your Cloudflare Tunnel hostname (e.g., `browser.yourdomain.com`) |
| `PORT` | ❌ | `3000` | HTTP server port |
| `CHROME_DEBUG_PORT` | ❌ | `9222` | Chrome remote debugging port |
| `HEADLESS` | ❌ | `false` | Run Chrome in headless mode |

## Cloudflare Tunnel Setup

You need to expose **both** the HTTP server (for `/cdp` endpoint) and Chrome's debug port (for WebSocket connections).

### Option 1: Two Separate Tunnels

```bash
# Terminal 1: Tunnel for HTTP API
cloudflared tunnel --url http://localhost:3000

# Terminal 2: Tunnel for Chrome WebSocket
cloudflared tunnel --url http://localhost:9222
```

Then set `TUNNEL_HOSTNAME` to the Chrome tunnel hostname (the one pointing to 9222).

### Option 2: Single Tunnel with Config (Recommended)

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: your-tunnel-id
credentials-file: /path/to/credentials.json

ingress:
  - hostname: browser.yourdomain.com
    path: /cdp
    service: http://localhost:3000
  - hostname: browser.yourdomain.com
    path: /devtools/*
    service: http://localhost:9222
  - hostname: browser.yourdomain.com
    service: http://localhost:9222
  - service: http_status:404
```

Then run:

```bash
cloudflared tunnel run your-tunnel-name
```

## API Endpoints

### `GET /`

Service info and available endpoints.

### `GET /health`

Health check with browser connection status.

```json
{
  "status": "healthy",
  "browser": { "connected": true, "debugPort": 9222 },
  "tunnel": { "hostname": "browser.yourdomain.com" }
}
```

### `GET /cdp`

Get the WebSocket endpoint for browser connection.

```json
{
  "wsEndpoint": "wss://browser.yourdomain.com/devtools/browser/abc123",
  "path": "/devtools/browser/abc123"
}
```

## Connecting from a Client

```typescript
import puppeteer from "puppeteer"

// Fetch the CDP endpoint
const res = await fetch("https://browser.yourdomain.com/cdp")
const { wsEndpoint } = await res.json()

// Connect to the remote browser
const browser = await puppeteer.connect({
  browserWSEndpoint: wsEndpoint,
  defaultViewport: null,
})

// Use it!
const page = await browser.newPage()
await page.goto("https://example.com")
```

## Running as a Service (macOS)

Create a LaunchAgent for auto-start:

```bash
cat > ~/Library/LaunchAgents/com.breamer-zero.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.breamer-zero</string>
  <key>WorkingDirectory</key>
  <string>/path/to/breamer-zero</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/pnpm</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/breamer-zero.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/breamer-zero.err</string>
</dict>
</plist>
EOF

# Load it
launchctl load ~/Library/LaunchAgents/com.breamer-zero.plist
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR MAC (breamer-zero)                     │
│  ┌─────────────────┐       ┌──────────────────────────────────┐ │
│  │   Hono Server   │       │           Chrome                 │ │
│  │   (port 3000)   │───────│   (debug port 9222)              │ │
│  │                 │       │                                  │ │
│  │  GET /cdp ──────┼───────▶ browser.wsEndpoint()             │ │
│  └────────┬────────┘       └──────────────┬───────────────────┘ │
│           │                               │                     │
└───────────┼───────────────────────────────┼─────────────────────┘
            │                               │
            ▼                               ▼
┌───────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE TUNNEL                          │
│                                                               │
│   browser.yourdomain.com/cdp ──▶ localhost:3000              │
│   browser.yourdomain.com/devtools/* ──▶ localhost:9222       │
│                                                               │
└───────────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────┐
│                     REMOTE CLIENT                             │
│                                                               │
│   1. GET /cdp → receives wsEndpoint                          │
│   2. puppeteer.connect({ browserWSEndpoint })                │
│   3. 🎉 Full browser control via WebSocket                   │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

## License

ISC

