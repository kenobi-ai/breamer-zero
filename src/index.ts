import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import puppeteer, { Browser, CDPSession, Page } from "puppeteer";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "./env";
import { logger } from "./logger";

const app = new Hono();

// Enable CORS for cross-origin requests
app.use("*", cors());

// Request logging middleware
app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const duration = performance.now() - start;
  logger.request(c.req.method, c.req.path, c.res.status, duration);
});

// Browser instance - launched once, kept alive
let browser: Browser | null = null;
let cdpSession: CDPSession | null = null;

// Page timeout tracking - auto-close pages after PAGE_TIMEOUT_MS
const pageTimeouts = new Map<Page, NodeJS.Timeout>();

function schedulePageTimeout(page: Page) {
  // Clear any existing timeout for this page
  const existing = pageTimeouts.get(page);
  if (existing) {
    clearTimeout(existing);
  }

  const timeout = setTimeout(async () => {
    if (!page.isClosed()) {
      const url = page.url();
      logger.warn(
        `Page timeout (${env.PAGE_TIMEOUT_MS / 1000}s) - closing: ${url.slice(
          0,
          60
        )}`
      );
      try {
        await page.close();
      } catch (_) {
        // Page might already be closed
      }
    }
    pageTimeouts.delete(page);
  }, env.PAGE_TIMEOUT_MS);

  pageTimeouts.set(page, timeout);
}

function clearPageTimeout(page: Page) {
  const timeout = pageTimeouts.get(page);
  if (timeout) {
    clearTimeout(timeout);
    pageTimeouts.delete(page);
  }
}

async function setupCDPLogging(b: Browser) {
  try {
    // Get a CDP session from the browser target
    const browserTarget = b.target();
    cdpSession = await browserTarget.createCDPSession();

    // Log network events at browser level
    await cdpSession.send("Target.setDiscoverTargets", { discover: true });

    cdpSession.on("Target.targetCreated", (event) => {
      logger.target("created", event.targetInfo.type, event.targetInfo.url);
    });

    cdpSession.on("Target.targetDestroyed", (event) => {
      logger.target("destroyed", "unknown", event.targetId);
    });

    cdpSession.on("Target.targetInfoChanged", (event) => {
      logger.target("changed", event.targetInfo.type, event.targetInfo.url);
    });

    // Listen for page-level events on each new page
    b.on("targetcreated", async (target) => {
      const type = target.type();
      const url = target.url();

      if (type === "page") {
        try {
          const page = await target.page();
          if (!page) return;

          // Schedule auto-close timeout for this page
          schedulePageTimeout(page);

          // Clean up timeout when page closes
          page.once("close", () => {
            clearPageTimeout(page);
          });

          const pageSession = await page.createCDPSession();

          // Enable network domain
          await pageSession.send("Network.enable");

          // Log network requests
          pageSession.on("Network.requestWillBeSent", (params) => {
            logger.cdp(
              "request",
              `${params.request.method} ${params.request.url.slice(0, 80)}`
            );
          });

          pageSession.on("Network.responseReceived", (params) => {
            const status = params.response.status;
            const url = params.response.url.slice(0, 60);
            logger.cdp("response", `${status} ${url}`);
          });

          pageSession.on("Network.loadingFailed", (params) => {
            logger.cdp("failed", params.errorText);
          });

          // Log page navigation
          page.on("framenavigated", (frame) => {
            if (frame === page.mainFrame()) {
              logger.page("navigated", frame.url());
            }
          });

          page.on("load", () => {
            logger.page("loaded", page.url());
          });

          page.on("domcontentloaded", () => {
            logger.page("DOMContentLoaded", page.url());
          });

          // Log console messages from pages
          page.on("console", (msg) => {
            const type = msg.type();
            const text = msg.text().slice(0, 100);
            if (type === "error") {
              logger.cdp("console.error", text);
            } else if (type === "warn") {
              logger.cdp("console.warn", text);
            } else if (env.HEADLESS) {
              // Only log regular console in headless mode (less noise when visible)
              logger.cdp(`console.${type}`, text);
            }
          });

          // Log page errors
          page.on("pageerror", (err) => {
            const message = err instanceof Error ? err.message : String(err);
            logger.cdp("pageerror", message);
          });
        } catch (_) {
          // Page might close before we can attach
        }
      }
    });

    logger.success("CDP event logging enabled");
  } catch (err) {
    logger.warn("Could not set up full CDP logging");
    logger.error("CDP setup error", err);
  }
}

async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser;
  }

  logger.browser("launching", `headless=${env.HEADLESS}`);

  browser = await puppeteer.launch({
    headless: env.HEADLESS,
    args: [
      `--remote-debugging-port=${env.CHROME_DEBUG_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      // Allow connections from any origin (needed for tunnel)
      "--remote-debugging-address=0.0.0.0",
    ],
  });

  browser.on("disconnected", () => {
    logger.browser("disconnected");
    browser = null;
    cdpSession = null;
  });

  browser.on("targetcreated", (target) => {
    logger.target("created", target.type(), target.url());
  });

  browser.on("targetdestroyed", (target) => {
    logger.target("destroyed", target.type(), target.url());
  });

  // Set up CDP logging
  await setupCDPLogging(browser);

  logger.success("Browser ready");
  logger.browser("wsEndpoint", browser.wsEndpoint());

  return browser;
}

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "breamer-zero",
    description: "CDP proxy server for remote browser automation",
    endpoints: {
      cdp: "/cdp - Get WebSocket endpoint for browser connection",
      health: "/health - Health check with browser status",
      devtools:
        "/devtools/* - WebSocket proxy to Chrome (used by puppeteer.connect)",
    },
  });
});

// Health check with browser status
app.get("/health", async (c) => {
  const isConnected = browser?.connected ?? false;
  const pages = browser ? await browser.pages() : [];

  return c.json({
    status: isConnected ? "healthy" : "degraded",
    browser: {
      connected: isConnected,
      debugPort: env.CHROME_DEBUG_PORT,
      openPages: pages.length,
      trackedTimeouts: pageTimeouts.size,
    },
    config: {
      pageTimeoutMs: env.PAGE_TIMEOUT_MS,
      pageTimeoutSec: env.PAGE_TIMEOUT_MS / 1000,
    },
    tunnel: {
      hostname: env.TUNNEL_HOSTNAME,
    },
  });
});

// CDP endpoint - returns the WebSocket endpoint rewritten for tunnel access
// Now points to THIS server (which proxies to Chrome) instead of Chrome directly
app.get("/cdp", async (c) => {
  try {
    const b = await ensureBrowser();
    const localEndpoint = b.wsEndpoint();
    const path = new URL(localEndpoint).pathname;

    // Point to this server's WebSocket proxy (same host, same port)
    const tunnelEndpoint = `wss://${env.TUNNEL_HOSTNAME}${path}`;

    logger.ws("endpoint requested", tunnelEndpoint);

    return c.json({
      wsEndpoint: tunnelEndpoint,
      path,
    });
  } catch (err) {
    logger.error("Failed to get CDP endpoint", err);
    return c.json(
      {
        error: "Failed to get browser endpoint",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      500
    );
  }
});

// Graceful shutdown
async function shutdown() {
  logger.blank();
  logger.warn("Shutting down...");

  // Clear all page timeouts
  for (const timeout of pageTimeouts.values()) {
    clearTimeout(timeout);
  }
  pageTimeouts.clear();

  if (browser) {
    logger.browser("closing");
    await browser.close();
    browser = null;
  }

  logger.success("Goodbye!");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Startup banner
function printBanner() {
  const c = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    gray: "\x1b[90m",
    bright: "\x1b[1m",
  };

  console.log();
  console.log(
    `${c.cyan}${c.bright}  ╔═══════════════════════════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}${c.yellow}${c.bright}              ⚡ BREAMER-ZERO ⚡                          ${c.reset}${c.cyan}${c.bright}║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}${c.gray}           Always-on CDP Server via WSS                   ${c.reset}${c.cyan}${c.bright}║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ╠═══════════════════════════════════════════════════════════╣${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}  HTTP Server    ${
      c.gray
    }http://localhost:${env.PORT.toString().padEnd(24)}${c.reset}${c.cyan}${
      c.bright
    }║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}  Chrome Debug   ${
      c.gray
    }localhost:${env.CHROME_DEBUG_PORT.toString().padEnd(30)}${c.reset}${
      c.cyan
    }${c.bright}║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}  Tunnel Host    ${
      c.gray
    }${env.TUNNEL_HOSTNAME.padEnd(40).slice(0, 40)}${c.reset}${c.cyan}${
      c.bright
    }║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}  Headless       ${c.gray}${String(
      env.HEADLESS
    ).padEnd(40)}${c.reset}${c.cyan}${c.bright}║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ║${c.reset}  Page Timeout   ${c.gray}${(
      env.PAGE_TIMEOUT_MS / 1000 +
      "s"
    ).padEnd(40)}${c.reset}${c.cyan}${c.bright}║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bright}  ╚═══════════════════════════════════════════════════════════╝${c.reset}`
  );
  console.log();
}

printBanner();
logger.divider();

// Pre-launch browser so it's ready for first request
ensureBrowser().catch((err) => {
  logger.error("Failed to launch browser", err);
});

// Start HTTP server
const server = serve({
  fetch: app.fetch,
  port: env.PORT,
});

// WebSocket proxy server - forwards /devtools/* to Chrome's debug port
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = request.url || "";

  // Only proxy /devtools/* paths
  if (url.startsWith("/devtools/")) {
    logger.ws("upgrade", url);

    wss.handleUpgrade(request, socket, head, (clientWs) => {
      // Connect to Chrome's debug port
      const chromeUrl = `ws://127.0.0.1:${env.CHROME_DEBUG_PORT}${url}`;
      const chromeWs = new WebSocket(chromeUrl);

      let clientClosed = false;
      let chromeClosed = false;

      chromeWs.on("open", () => {
        logger.ws("connected to Chrome", url);
      });

      // Proxy messages: client → Chrome
      clientWs.on("message", (data) => {
        if (chromeWs.readyState === WebSocket.OPEN) {
          chromeWs.send(data);
        }
      });

      // Proxy messages: Chrome → client
      chromeWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      // Handle client close
      clientWs.on("close", (code, reason) => {
        clientClosed = true;
        logger.ws("client disconnected", `${code} ${reason || ""}`);
        if (!chromeClosed && chromeWs.readyState === WebSocket.OPEN) {
          chromeWs.close();
        }
      });

      // Handle Chrome close
      chromeWs.on("close", (code, reason) => {
        chromeClosed = true;
        logger.ws("chrome disconnected", `${code} ${reason || ""}`);
        if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
          clientWs.close();
        }
      });

      // Handle errors
      clientWs.on("error", (err) => {
        logger.error("Client WebSocket error", err);
        if (!chromeClosed) chromeWs.close();
      });

      chromeWs.on("error", (err) => {
        logger.error("Chrome WebSocket error", err);
        if (!clientClosed) clientWs.close();
      });
    });
  } else {
    // Not a devtools path, reject the upgrade
    socket.destroy();
  }
});

logger.success(`Server listening on http://localhost:${env.PORT}`);
logger.info(`WebSocket proxy active on ws://localhost:${env.PORT}/devtools/*`);
logger.divider();
logger.blank();
