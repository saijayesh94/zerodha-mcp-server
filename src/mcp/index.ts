import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";


// Create an MCP server
const server = new McpServer({
  name: "demo-server",
  version: "1.0.0"
});

export {
  server
}