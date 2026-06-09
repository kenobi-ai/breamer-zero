import { z } from "zod";

const optionalEnvString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const envSchema = z.object({
  /**
   * Cloudflare Tunnel hostname for HTTP API (e.g., breamer.yourdomain.com)
   */
  TUNNEL_HOSTNAME: z.string().min(1),

  /**
   * Cloudflare Tunnel hostname for Chrome WebSocket (e.g., browser.yourdomain.com)
   * This routes directly to Chrome's debug port (9222)
   */
  BROWSER_HOSTNAME: z.string().min(1),

  /**
   * Port for the Hono HTTP server (default: 3000)
   */
  PORT: z.coerce.number().default(3000),

  /**
   * Fixed Chrome remote debugging port (default: 9222)
   */
  CHROME_DEBUG_PORT: z.coerce.number().default(9222),

  /**
   * Whether to run Chrome headless (default: true for server infra)
   */
  HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v): boolean => v === "true"),

  /**
   * Optional Chrome/Chromium executable path. Leave unset to check common
   * system install paths.
   */
  CHROME_EXECUTABLE_PATH: optionalEnvString,

  /**
   * Optional profile directory for persistent cookies/session state.
   */
  CHROME_USER_DATA_DIR: optionalEnvString,

  /**
   * Chrome V8 heap size limit in MB (default: 512)
   * Lower this if you're seeing OOM crashes
   */
  CHROME_HEAP_SIZE_MB: z.coerce.number().default(512),

  /**
   * Include --no-sandbox flags. This is usually required in restricted runtimes
   * unless the host is configured for Chrome sandboxing.
   */
  CHROME_NO_SANDBOX: z
    .enum(["true", "false"])
    .default("true")
    .transform((v): boolean => v === "true"),

  /**
   * Additional whitespace-separated Chrome flags.
   */
  CHROME_EXTRA_ARGS: z
    .string()
    .default("")
    .transform((value): string[] => value.split(/\s+/).filter(Boolean)),
});

export const env = envSchema.parse({
  TUNNEL_HOSTNAME: process.env.TUNNEL_HOSTNAME,
  BROWSER_HOSTNAME: process.env.BROWSER_HOSTNAME,
  PORT: process.env.PORT,
  CHROME_DEBUG_PORT: process.env.CHROME_DEBUG_PORT,
  HEADLESS: process.env.HEADLESS,
  CHROME_EXECUTABLE_PATH: process.env.CHROME_EXECUTABLE_PATH,
  CHROME_USER_DATA_DIR: process.env.CHROME_USER_DATA_DIR,
  CHROME_HEAP_SIZE_MB: process.env.CHROME_HEAP_SIZE_MB,
  CHROME_NO_SANDBOX: process.env.CHROME_NO_SANDBOX,
  CHROME_EXTRA_ARGS: process.env.CHROME_EXTRA_ARGS,
});
