import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as kite from "../api/zerodha";
import { ok, safe, READ_ONLY } from "./helpers";

const { round } = kite;
export const exchange = z.enum(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS"]).default("NSE");

export function registerMarketTools(server: McpServer) {
  server.registerTool(
    "get-quote",
    {
      title: "Live quote",
      description:
        "Live quote for one or more stocks: last price, day open/high/low, previous close, % change and volume. Symbols are trading symbols like INFY or RELIANCE.",
      inputSchema: {
        symbols: z.array(z.string().min(1)).min(1).max(20),
        exchange,
      },
      annotations: READ_ONLY,
    },
    safe(async ({ symbols, exchange }) => {
      const keys = symbols.map((s) => kite.instrumentKey(s, exchange));
      const quotes = await kite.getQuote(keys);
      return ok(
        keys.map((k) => {
          const q = quotes[k];
          if (!q) return { instrument: k, error: "not found" };
          const close = q.ohlc?.close || q.last_price;
          return {
            instrument: k,
            last_price: round(q.last_price),
            change_pct: round(((q.last_price - close) / close) * 100),
            open: q.ohlc?.open,
            high: q.ohlc?.high,
            low: q.ohlc?.low,
            prev_close: close,
            volume: q.volume,
          };
        }),
      );
    }),
  );

  server.registerTool(
    "price-history",
    {
      title: "Price history & trend",
      description:
        "Daily candles for a stock over the last N days, with return %, period high/low, 20-day simple moving average and a simple trend label. Use for 'how has X done this month?'.",
      inputSchema: {
        symbol: z.string().min(1),
        exchange,
        days: z.number().int().min(5).max(365).default(30),
      },
      annotations: READ_ONLY,
    },
    safe(async ({ symbol, exchange, days }) => {
      const { key, lastPrice, candles } = await kite.getDailyCandles(symbol, exchange, days);
      if (!candles.length) return ok(`No candles for ${key} in the last ${days} days.`);
      const closes = candles.map((c) => c.close);
      const first = closes[0], last = closes[closes.length - 1];
      const window = closes.slice(-20);
      const sma20 = window.reduce((a, b) => a + b, 0) / window.length;
      const change = ((last - first) / first) * 100;
      return ok({
        instrument: key,
        days,
        last_price: lastPrice,
        return_pct: round(change),
        period_high: Math.max(...candles.map((c) => c.high)),
        period_low: Math.min(...candles.map((c) => c.low)),
        sma20: round(sma20),
        trend: last > sma20 && change > 0 ? "uptrend" : last < sma20 && change < 0 ? "downtrend" : "sideways",
        closes: candles.map((c) => ({ date: new Date(c.date).toISOString().slice(0, 10), close: c.close })),
      });
    }),
  );
}
