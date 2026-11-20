import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Create an MCP server
const server = new McpServer(
  { name: "kite-trading-mcp", version: "2.0.0" },
  {
    instructions:
      "Tools for a Zerodha Kite trading account. Read tools (portfolio, quotes, orders) are safe to call freely. " +
      "Before buy-stock or sell-stock, restate the order (symbol, side, quantity, type) and prefer calling preview-order first. " +
      "If a tool reports an expired session, call login and ask the user for the request_token.",
  },
);

export { server };
