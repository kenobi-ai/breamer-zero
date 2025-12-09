import { z } from "zod";

const envSchema = z.object({
  /**
   * Your Cloudflare Tunnel hostname (e.g., browser.yourdomain.com)
   * This is what external clients will use to connect
   */
  TUNNEL_HOSTNAME: z.string().min(1),

  /**
   * Port for the Hono HTTP server (default: 3000)
   */
  PORT: z.coerce.number().default(3000),

  /**
   * Fixed Chrome remote debugging port (default: 9222)
   */
  CHROME_DEBUG_PORT: z.coerce.number().default(9222),

  /**
   * Whether to run Chrome headless (default: false for debugging visibility)
   */
  HEADLESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v): boolean => v === "true"),

  /**
   * Max time a page can stay open before auto-closing (default: 2 minutes)
   * In milliseconds
   */
  PAGE_TIMEOUT_MS: z.coerce.number().default(2 * 60 * 1000),
});

export const env = envSchema.parse({
  TUNNEL_HOSTNAME: process.env.TUNNEL_HOSTNAME,
  PORT: process.env.PORT,
  CHROME_DEBUG_PORT: process.env.CHROME_DEBUG_PORT,
  HEADLESS: process.env.HEADLESS,
  PAGE_TIMEOUT_MS: process.env.PAGE_TIMEOUT_MS,
});
