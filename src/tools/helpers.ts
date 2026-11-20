import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Successful tool result: pretty JSON (or plain text) the model can read. */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

/** Error result the model can see and explain, instead of a crashed call. */
export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Wraps a tool handler: Kite API errors become readable tool errors, and an
 * expired session tells the model to run the `login` tool.
 */
export function safe<A>(handler: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await handler(args);
    } catch (err: any) {
      const type = err?.error_type ?? err?.name ?? "Error";
      const message = err?.message ?? String(err);
      // stderr only: stdout carries the MCP protocol.
      console.error(`[kite-mcp] ${type}: ${message}`);
      if (type === "TokenException") {
        return fail("Kite session expired or missing. Run the `login` tool, then `update-session-access` with the request token.");
      }
      return fail(`${type}: ${message}`);
    }
  };
}

export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const TRADING = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
