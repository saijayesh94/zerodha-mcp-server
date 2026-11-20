import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as kite from "../api/zerodha";
import { ok, safe, READ_ONLY } from "./helpers";

const { round } = kite;

export function registerAccountTools(server: McpServer) {
  server.registerTool(
    "login",
    {
      title: "Login URL",
      description:
        "Returns the Kite login URL. Use when the user wants to log in or when a tool reports an expired session. After logging in, the user pastes the request_token from the redirect URL into update-session-access.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async () => ok({ login_url: kite.loginAccount(), next_step: "Log in, then call update-session-access with the request_token from the redirect URL." })),
  );

  server.registerTool(
    "update-session-access",
    {
      title: "Update session token",
      description: "Exchanges the request_token from the Kite login redirect for an access token, so the other tools can trade.",
      inputSchema: { token: z.string().min(6).describe("request_token from the login redirect URL") },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    safe(async ({ token }) => ok(await kite.updateSession(token))),
  );

  server.registerTool(
    "profile-info",
    {
      title: "Profile info",
      description: "Gets the logged-in user's Kite profile: name, user id, enabled exchanges and products.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const p = await kite.getProfile();
      return ok({
        user_id: p.user_id,
        user_name: p.user_name,
        email: p.email,
        broker: p.broker,
        exchanges: p.exchanges,
        products: p.products,
        order_types: p.order_types,
      });
    }),
  );

  server.registerTool(
    "get-funds",
    {
      title: "Funds & margins",
      description: "Available cash, opening balance and margin used, for the equity and commodity segments.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const m = await kite.getMargins();
      const seg = (s: any) =>
        s && {
          available_cash: round(s.available?.live_balance ?? s.net),
          opening_balance: round(s.available?.opening_balance ?? 0),
          collateral: round(s.available?.collateral ?? 0),
          margin_used: round(s.utilised?.debits ?? 0),
        };
      return ok({ equity: seg(m.equity), commodity: seg(m.commodity) });
    }),
  );

  server.registerTool(
    "get-holdings",
    {
      title: "Holdings",
      description: "Long-term holdings with quantity, average price, last price, P&L and today's change for each stock.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const rows = (await kite.getHoldings()).map((h) => ({
        symbol: h.tradingsymbol,
        exchange: h.exchange,
        quantity: h.quantity + (h.t1_quantity ?? 0),
        average_price: round(h.average_price),
        last_price: round(h.last_price),
        invested: round(h.average_price * (h.quantity + (h.t1_quantity ?? 0))),
        pnl: round(h.pnl),
        pnl_pct: round(((h.last_price - h.average_price) / h.average_price) * 100),
        day_change_pct: round(h.day_change_percentage ?? 0),
      }));
      return ok(rows.length ? rows : "No holdings.");
    }),
  );

  server.registerTool(
    "get-positions",
    {
      title: "Positions",
      description: "Open intraday and carry-forward positions with live P&L.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const { net } = await kite.getPositions();
      const rows = net
        .filter((p) => p.quantity !== 0 || p.pnl !== 0)
        .map((p) => ({
          symbol: p.tradingsymbol,
          exchange: p.exchange,
          product: p.product,
          quantity: p.quantity,
          average_price: round(p.average_price),
          last_price: round(p.last_price),
          pnl: round(p.pnl),
        }));
      return ok(rows.length ? rows : "No open positions.");
    }),
  );

  server.registerTool(
    "portfolio-summary",
    {
      title: "Portfolio summary",
      description:
        "One-call overview: invested amount, current value, total and day P&L, best and worst performers, open positions P&L and available cash. Use this for questions like 'how is my portfolio doing?'.",
      inputSchema: { top: z.number().int().min(1).max(10).default(3).describe("How many gainers/losers to list") },
      annotations: READ_ONLY,
    },
    safe(async ({ top }) => {
      const [holdings, positions, margins] = await Promise.all([kite.getHoldings(), kite.getPositions(), kite.getMargins()]);
      let invested = 0, current = 0, dayPnl = 0;
      const perf = holdings.map((h) => {
        const qty = h.quantity + (h.t1_quantity ?? 0);
        invested += h.average_price * qty;
        current += h.last_price * qty;
        dayPnl += (h.last_price - (h.close_price || h.last_price)) * qty;
        return { symbol: h.tradingsymbol, pnl: round(h.pnl), pnl_pct: round(((h.last_price - h.average_price) / h.average_price) * 100) };
      });
      perf.sort((a, b) => b.pnl_pct - a.pnl_pct);
      const positionsPnl = positions.net.reduce((s, p) => s + (p.pnl ?? 0), 0);
      return ok({
        holdings_count: holdings.length,
        invested: round(invested),
        current_value: round(current),
        total_pnl: round(current - invested),
        total_pnl_pct: invested ? round(((current - invested) / invested) * 100) : 0,
        day_pnl: round(dayPnl),
        day_pnl_pct: current ? round((dayPnl / (current - dayPnl)) * 100) : 0,
        top_gainers: perf.slice(0, top),
        top_losers: perf.slice(-top).reverse().filter((p) => p.pnl_pct < 0),
        open_positions_pnl: round(positionsPnl),
        available_cash: round(margins.equity?.available?.live_balance ?? margins.equity?.net ?? 0),
      });
    }),
  );
}
