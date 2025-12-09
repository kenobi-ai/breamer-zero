/**
 * Beautiful console logging with colors and formatting
 */

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  
  // Text colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  
  // Background colors
  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
} as const

type Color = keyof typeof colors

function colorize(text: string, ...colorNames: Color[]): string {
  const colorCodes = colorNames.map((c) => colors[c]).join("")
  return `${colorCodes}${text}${colors.reset}`
}

function timestamp(): string {
  const now = new Date()
  return colorize(
    now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + "." + String(now.getMilliseconds()).padStart(3, "0"),
    "gray"
  )
}

// HTTP method colors
const methodColors: Record<string, Color[]> = {
  GET: ["green"],
  POST: ["yellow"],
  PUT: ["blue"],
  PATCH: ["cyan"],
  DELETE: ["red"],
  OPTIONS: ["gray"],
  HEAD: ["gray"],
}

// Status code colors
function statusColor(status: number): Color[] {
  if (status >= 500) return ["red", "bright"]
  if (status >= 400) return ["yellow"]
  if (status >= 300) return ["cyan"]
  if (status >= 200) return ["green"]
  return ["gray"]
}

// Format duration
function formatDuration(ms: number): string {
  if (ms < 1) return colorize("<1ms", "gray")
  if (ms < 100) return colorize(`${Math.round(ms)}ms`, "green")
  if (ms < 500) return colorize(`${Math.round(ms)}ms`, "yellow")
  return colorize(`${Math.round(ms)}ms`, "red")
}

export const logger = {
  // HTTP request logging
  request(method: string, path: string, status: number, durationMs: number) {
    const methodStr = colorize(method.padEnd(6), ...(methodColors[method] ?? ["white"]))
    const pathStr = colorize(path, "white")
    const statusStr = colorize(String(status), ...statusColor(status))
    const duration = formatDuration(durationMs)
    
    console.log(`${timestamp()} ${methodStr} ${pathStr} ${statusStr} ${duration}`)
  },
  
  // CDP events
  cdp(event: string, data?: unknown) {
    const prefix = colorize("◆ CDP", "magenta", "bright")
    const eventStr = colorize(event, "white")
    
    if (data !== undefined) {
      const dataStr = typeof data === "string" 
        ? data 
        : JSON.stringify(data, null, 0).slice(0, 100)
      console.log(`${timestamp()} ${prefix} ${eventStr} ${colorize(dataStr, "gray")}`)
    } else {
      console.log(`${timestamp()} ${prefix} ${eventStr}`)
    }
  },
  
  // Browser lifecycle events
  browser(event: string, details?: string) {
    const prefix = colorize("🌐 Browser", "cyan", "bright")
    const eventStr = colorize(event, "white")
    const detailsStr = details ? colorize(` ${details}`, "gray") : ""
    
    console.log(`${timestamp()} ${prefix} ${eventStr}${detailsStr}`)
  },
  
  // Page events
  page(event: string, url?: string) {
    const prefix = colorize("📄 Page", "blue", "bright")
    const eventStr = colorize(event, "white")
    const urlStr = url ? colorize(` ${url}`, "gray") : ""
    
    console.log(`${timestamp()} ${prefix} ${eventStr}${urlStr}`)
  },
  
  // Target events (new tabs, workers, etc)
  target(event: string, type: string, url?: string) {
    const prefix = colorize("🎯 Target", "yellow", "bright")
    const eventStr = colorize(event, "white")
    const typeStr = colorize(`[${type}]`, "cyan")
    const urlStr = url ? colorize(` ${url.slice(0, 60)}${url.length > 60 ? "..." : ""}`, "gray") : ""
    
    console.log(`${timestamp()} ${prefix} ${eventStr} ${typeStr}${urlStr}`)
  },
  
  // WebSocket events
  ws(event: string, details?: string) {
    const prefix = colorize("⚡ WS", "green", "bright")
    const eventStr = colorize(event, "white")
    const detailsStr = details ? colorize(` ${details}`, "gray") : ""
    
    console.log(`${timestamp()} ${prefix} ${eventStr}${detailsStr}`)
  },
  
  // General info
  info(message: string) {
    const prefix = colorize("ℹ", "blue")
    console.log(`${timestamp()} ${prefix} ${message}`)
  },
  
  // Success
  success(message: string) {
    const prefix = colorize("✓", "green", "bright")
    console.log(`${timestamp()} ${prefix} ${colorize(message, "green")}`)
  },
  
  // Warning
  warn(message: string) {
    const prefix = colorize("⚠", "yellow", "bright")
    console.log(`${timestamp()} ${prefix} ${colorize(message, "yellow")}`)
  },
  
  // Error
  error(message: string, err?: unknown) {
    const prefix = colorize("✗", "red", "bright")
    console.log(`${timestamp()} ${prefix} ${colorize(message, "red")}`)
    if (err) {
      const errStr = err instanceof Error ? err.message : String(err)
      console.log(`${timestamp()}   ${colorize(errStr, "red", "dim")}`)
    }
  },
  
  // Divider
  divider(char = "─", length = 60) {
    console.log(colorize(char.repeat(length), "gray"))
  },
  
  // Blank line
  blank() {
    console.log()
  },
}

export type Logger = typeof logger

