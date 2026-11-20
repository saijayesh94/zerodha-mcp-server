import { server } from "./mcp/index";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerAccountTools } from "./tools/account";
import { registerMarketTools } from "./tools/market";
import { registerOrderTools } from "./tools/orders";

registerAccountTools(server);
registerMarketTools(server);
registerOrderTools(server);

server.registerPrompt(
  "daily-portfolio-review",
  {
    title: "Daily portfolio review",
    description: "Summarise today's portfolio performance and flag positions that need attention.",
    argsSchema: { focus: z.string().optional().describe("Optional stock or theme to focus on") },
  },
  ({ focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            "Review my portfolio for today. Call portfolio-summary, then get-quote for the top movers. " +
            "Give me total and day P&L, the best and worst performers, and any holding down more than 5% that has no stop-loss GTT (check list-gtts)." +
            (focus ? ` Focus especially on: ${focus}.` : ""),
        },
      },
    ],
  }),
);

(async () => {
  await server.connect(new StdioServerTransport());
  console.error("[kite-mcp] server ready on stdio");
})();
