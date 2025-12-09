import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import puppeteer, { Browser } from "puppeteer";
import { env } from "./env";
import { logger } from "./logger";

const app = new Hono();

app.use("*", cors());

app.use("*", async (c, next) => {
  const start = performance.now();
  await next();
  const duration = performance.now() - start;
  logger.request(c.req.method, c.req.path, c.res.status, duration);
});

// Browser instance - launched once, kept alive
let browser: Browser | null = null;

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
      "--remote-debugging-address=0.0.0.0",

      // Production stability
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-software-rasterizer",
      `--js-flags=--max-old-space-size=${env.CHROME_HEAP_SIZE_MB}`,
      "--disable-features=TranslateUI",
      "--disable-breakpad",
      "--disable-component-update",
    ],
  });

  browser.on("disconnected", () => {
    logger.browser("disconnected");
    browser = null;
  });

  logger.success("Browser ready");
  logger.browser("wsEndpoint", browser.wsEndpoint());

  return browser;
}

app.get("/", (c) => {
  return c.text("please pay your bill");
});

app.get("/health", async (c) => {
  const isConnected = browser?.connected ?? false;
  const pages = browser ? await browser.pages() : [];

  return c.json({
    status: isConnected ? "healthy" : "degraded",
    browser: {
      connected: isConnected,
      debugPort: env.CHROME_DEBUG_PORT,
      openPages: pages.length,
    },
    tunnel: env.TUNNEL_HOSTNAME,
  });
});

// CDP endpoint - BROWSER_HOSTNAME routes directly to Chrome :9222
app.get("/cdp", async (c) => {
  try {
    const b = await ensureBrowser();
    const localEndpoint = b.wsEndpoint();
    // Replace local address with browser tunnel hostname
    const tunnelEndpoint = localEndpoint.replace(
      `ws://127.0.0.1:${env.CHROME_DEBUG_PORT}`,
      `wss://${env.BROWSER_HOSTNAME}`
    );

    logger.ws("endpoint requested", tunnelEndpoint);

    return c.json({
      wsEndpoint: tunnelEndpoint,
      path: new URL(localEndpoint).pathname,
    });
  } catch (err) {
    logger.error("Failed to get CDP endpoint", err);
    return c.json({ error: "Failed to get browser endpoint" }, 500);
  }
});

async function shutdown() {
  logger.warn("Shutting down...");
  if (browser) {
    await browser.close();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Banner
console.log(`
  ╔════════════════════════════════════════════╗
  ║          ⚡ BREAMER-ZERO ⚡                 ║
  ╠════════════════════════════════════════════╣
  ║  HTTP      http://localhost:${String(env.PORT).padEnd(18)}║
  ║  Chrome    localhost:${String(env.CHROME_DEBUG_PORT).padEnd(22)}║
  ║  API       ${env.TUNNEL_HOSTNAME.slice(0, 30).padEnd(30)} ║
  ║  Browser   ${env.BROWSER_HOSTNAME.slice(0, 30).padEnd(30)} ║
  ╚════════════════════════════════════════════╝
`);

ensureBrowser().catch((err) => logger.error("Failed to launch browser", err));

serve({ fetch: app.fetch, port: env.PORT });

logger.success(`Server listening on http://localhost:${env.PORT}`);
