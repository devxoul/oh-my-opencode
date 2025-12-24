import { tool } from "@opencode-ai/plugin/tool"
import { DEFAULT_STRATEGY, MAX_OUTPUT_SIZE, MAX_RAW_SIZE, TIMEOUT_MS } from "./constants"
import type { CompactionStrategy } from "./types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenCode/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

function applyStrategy(content: string, _strategy: CompactionStrategy): string {
  return content
}

export const webfetch = tool({
  description:
    "Fetch and process web content with compaction strategies.\n\n" +
    "STRATEGY SELECTION GUIDE:\n" +
    "- 'raw': No processing. Only for small responses (<100KB) when you need exact content.",
  args: {
    url: tool.schema.string().describe("The URL to fetch"),
    strategy: tool.schema
      .enum(["raw"])
      .optional()
      .describe("Compaction strategy (default: raw)."),
  },
  execute: async (args) => {
    const strategy = args.strategy ?? DEFAULT_STRATEGY
    const url = args.url.startsWith("http") ? args.url : `https://${args.url}`

    try {
      const rawContent = await fetchWithTimeout(url, TIMEOUT_MS)
      const originalSize = rawContent.length

      if (strategy === "raw" && originalSize > MAX_RAW_SIZE) {
        return [
          `Error: Response size (${formatBytes(originalSize)}) exceeds raw strategy limit (${formatBytes(MAX_RAW_SIZE)}).`,
          "This will cause token overflow.",
          "",
          "Suggested alternatives:",
          "- Use a different compaction strategy when available",
        ].join("\n")
      }

      let result = applyStrategy(rawContent, strategy)

      let truncated = false
      if (result.length > MAX_OUTPUT_SIZE) {
        result = result.slice(0, MAX_OUTPUT_SIZE)
        truncated = true
      }

      const compactedSize = result.length
      const reduction = ((1 - compactedSize / originalSize) * 100).toFixed(1)

      const header = [
        `URL: ${url}`,
        `Strategy: ${strategy}`,
        `Size: ${formatBytes(originalSize)} → ${formatBytes(compactedSize)} (${reduction}% reduction)`,
        truncated ? `[Output truncated to ${formatBytes(MAX_OUTPUT_SIZE)}]` : "",
        "---",
      ]
        .filter(Boolean)
        .join("\n")

      return `${header}\n\n${result}`
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return `Error: Request timed out after ${TIMEOUT_MS / 1000}s`
        }
        return `Error: ${error.message}`
      }
      return `Error: ${String(error)}`
    }
  },
})
