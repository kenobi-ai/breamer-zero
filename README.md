# breamer-zero

<p align="center">
  <img src="./assets/breamer-zero-logo.jpg" alt="breamer-zero logo: a bream wearing pink browser goggles" width="560">
</p>

Always-on Chrome DevTools Protocol access for remote browser automation.

Run Chrome on a host you control, expose it through Cloudflare Tunnel or another reverse proxy, and connect from anywhere with Puppeteer over WSS. The server gives clients a stable `/cdp` endpoint while Chrome stays close to the machine doing the actual browsing.

## What It Does

- Starts a persistent system Chrome/Chromium instance with remote debugging enabled.
- Serves a small Hono API for health checks and CDP endpoint discovery.
- Rewrites Chrome's local `ws://127.0.0.1:9222/...` endpoint into your public `wss://...` tunnel hostname.
- Tracks basic runtime metrics for pages, navigations, console errors, and browser health.
- Runs with Bun, including local dev, production start, dependency locking, and package builds.
- Ships a clean npm package entry through `dist/index.js` plus TypeScript declarations.

## Runtime Model

```text
remote client
    |
    | GET https://breamer.example.com/cdp
    v
Hono API on :3000
    |
    | reads Chrome's local CDP endpoint
    v
Chrome remote debugging on :9222
    |
    | returns wss://browser.example.com/devtools/browser/...
    v
remote client connects directly to Chrome over WSS
```

You can run the API and Chrome on a VM, a small bare-metal box, or any host that already has Chrome or Chromium installed.

## Requirements

- Bun 1.3 or newer.
- A host with Chrome, Chromium, or Edge already installed.
- `CHROME_EXECUTABLE_PATH` when the browser is not in one of the common install paths.
- A tunnel or reverse proxy that can route one public hostname to the API and one public hostname or path to Chrome's debug port.

## Quick Start

```bash
bun install
cp .env.example .env
```

Edit `.env`:

```bash
TUNNEL_HOSTNAME=breamer.example.com
BROWSER_HOSTNAME=browser.example.com
```

Set `CHROME_EXECUTABLE_PATH` if autodiscovery will not find your browser:

```bash
CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome
```

Run it:

```bash
bun start
```

For local iteration:

```bash
bun run dev
```

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TUNNEL_HOSTNAME` | Yes | - | Public hostname for the Hono API, for example `breamer.example.com`. |
| `BROWSER_HOSTNAME` | Yes | - | Public hostname that routes to Chrome's debug port, for example `browser.example.com`. |
| `PORT` | No | `3000` | Local Hono API port. |
| `CHROME_DEBUG_PORT` | No | `9222` | Local Chrome remote debugging port. |
| `HEADLESS` | No | `true` | Launch Chrome headless. Set to `false` only when the host has a display. |
| `CHROME_EXECUTABLE_PATH` | No | autodetect | Path to an installed Chrome/Chromium/Edge binary. |
| `CHROME_USER_DATA_DIR` | No | - | Persist Chrome profile data across restarts. |
| `CHROME_HEAP_SIZE_MB` | No | `512` | V8 heap limit passed to Chrome. |
| `CHROME_NO_SANDBOX` | No | `true` | Adds `--no-sandbox` and `--disable-setuid-sandbox`, often needed in restricted runtimes. |
| `CHROME_EXTRA_ARGS` | No | - | Extra whitespace-separated Chrome flags. |

`BROWSER_HOSTNAME` can be the same hostname as `TUNNEL_HOSTNAME` if your proxy routes `/devtools/*` to Chrome and the API paths to the Hono server.

## Browser Discovery

If `CHROME_EXECUTABLE_PATH` is unset, breamer-zero checks common local browser paths.

Linux:

```text
/usr/bin/google-chrome
/usr/bin/google-chrome-stable
/usr/bin/chromium
/usr/bin/chromium-browser
/usr/bin/microsoft-edge
/snap/bin/chromium
```

macOS:

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
/Applications/Chromium.app/Contents/MacOS/Chromium
/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge
```

Windows:

```text
%PROGRAMFILES%\Google\Chrome\Application\chrome.exe
%PROGRAMFILES%\Chromium\Application\chrome.exe
%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe
%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
```

If your host uses a different path, set `CHROME_EXECUTABLE_PATH` explicitly. This repo uses `puppeteer-core`, so it does not download or bundle a browser for you.

## Tunnel Setup

The simplest setup is two public hostnames: one for the API, one for Chrome.

```yaml
tunnel: your-tunnel-id
credentials-file: /path/to/credentials.json

ingress:
  - hostname: breamer.example.com
    service: http://localhost:3000
  - hostname: browser.example.com
    service: http://localhost:9222
  - service: http_status:404
```

Then run:

```bash
cloudflared tunnel run your-tunnel-name
```

Set:

```bash
TUNNEL_HOSTNAME=breamer.example.com
BROWSER_HOSTNAME=browser.example.com
```

Single-host routing also works:

```yaml
ingress:
  - hostname: breamer.example.com
    path: /cdp
    service: http://localhost:3000
  - hostname: breamer.example.com
    path: /health
    service: http://localhost:3000
  - hostname: breamer.example.com
    path: /devtools/*
    service: http://localhost:9222
  - hostname: breamer.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Set both hostnames to the same value:

```bash
TUNNEL_HOSTNAME=breamer.example.com
BROWSER_HOSTNAME=breamer.example.com
```

## API

### `GET /health`

Returns browser status, uptime, page counts, error counts, and tunnel configuration.

```json
{
  "status": "healthy",
  "browser": {
    "connected": true,
    "debugPort": 9222,
    "openPages": 1
  },
  "metrics": {
    "uptimeHuman": "12m 4s",
    "pagesCreated": 3,
    "pagesNavigated": 8,
    "pagesClosed": 2,
    "consoleErrors": 0,
    "pageErrors": 0
  },
  "tunnel": "breamer.example.com",
  "browserHost": "browser.example.com"
}
```

### `GET /cdp`

Launches Chrome if needed and returns the browser WebSocket endpoint.

```json
{
  "wsEndpoint": "wss://browser.example.com/devtools/browser/abc123",
  "path": "/devtools/browser/abc123"
}
```

## Client Usage

```ts
import puppeteer from "puppeteer";

const res = await fetch("https://breamer.example.com/cdp");
const { wsEndpoint } = await res.json();

const browser = await puppeteer.connect({
  browserWSEndpoint: wsEndpoint,
  defaultViewport: null,
});

const page = await browser.newPage();
await page.goto("https://example.com");
```

## Operations

### Build

```bash
bun run build
```

The build uses Bun to bundle `src/index.ts` into `dist/index.js`, then TypeScript emits declaration files. `package.json` points npm consumers at `dist/index.js` and `dist/index.d.ts`.

### Typecheck

```bash
bun run typecheck
```

### Package Dry Run

```bash
npm --cache /tmp/breamer-zero-npm-cache pack --dry-run
```

`prepack` runs the build automatically, so the tarball should contain the bundled entry, declarations, README, logo, and `.env.example`.

## Linux Service

For a long-running VM or bare-metal host, a systemd unit is the straightforward path:

```ini
[Unit]
Description=breamer-zero
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/breamer-zero
EnvironmentFile=/srv/breamer-zero/.env
ExecStart=/usr/local/bin/bun start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Run the service as a dedicated user if the host is shared. If you want Chrome sandboxing instead of `--no-sandbox`, configure the host for it and set `CHROME_NO_SANDBOX=false`.

## Troubleshooting

Check the server:

```bash
curl https://breamer.example.com/health
```

Check CDP discovery:

```bash
curl https://breamer.example.com/cdp
```

If `/cdp` returns an endpoint but Puppeteer cannot connect, the API route is working and the Chrome route is the likely issue. Confirm that `BROWSER_HOSTNAME` routes to `localhost:9222` and that `/devtools/*` is not being sent to the Hono server.

If Chrome refuses to launch, check the process logs, confirm no other process owns `CHROME_DEBUG_PORT`, and set `CHROME_EXECUTABLE_PATH` if the host already provides Chrome.

If Chrome starts but pages crash under load, raise `CHROME_HEAP_SIZE_MB`, add memory to the host or VM, and make sure the runtime has enough shared memory.

## Future Infra Improvements

The next version of the deployment story should stay explicit about browser ownership. Useful improvements would be:

- A container image that can either use a mounted system Chrome or install one in a controlled build step.
- A startup check that reports the detected Chrome executable and version before accepting CDP requests.
- A small `systemd` install script with a dedicated service user and writable profile directory.
- A smoke test that launches Chrome, calls `/cdp`, connects with `puppeteer-core`, opens one page, and shuts down cleanly.
- Optional sandbox hardening docs for hosts where `CHROME_NO_SANDBOX=false` is viable.

## License

ISC
