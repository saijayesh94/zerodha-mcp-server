import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as kite from "../api/zerodha";
import { fail, ok, safe, READ_ONLY, TRADING } from "./helpers";
import { exchange } from "./market";

const { round } = kite;

const orderShape = {
  stockSym: z.string().min(1).describe("Trading symbol, e.g. INFY"),
  qty: z.number().int().positive(),
  exchange,
  orderType: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]).default("MARKET"),
  price: z.number().positive().optional().describe("Required for LIMIT and SL orders"),
  triggerPrice: z.number().positive().optional().describe("Required for SL and SL-M orders"),
  product: z.enum(["CNC", "MIS", "NRML"]).default("CNC").describe("CNC = delivery, MIS = intraday, NRML = F&O carry"),
};
type OrderArgs = z.infer<z.ZodObject<typeof orderShape>>;

function toInput(a: OrderArgs, side: kite.Side): kite.OrderInput {
  return {
    symbol: a.stockSym, exchange: a.exchange, side, quantity: a.qty,
    product: a.product, orderType: a.orderType, price: a.price, triggerPrice: a.triggerPrice,
  };
}

/** Validation the exchange would otherwise reject with a vaguer error. */
function checkPrices(a: OrderArgs): string | null {
  if ((a.orderType === "LIMIT" || a.orderType === "SL") && a.price === undefined) return `${a.orderType} orders need a price.`;
  if ((a.orderType === "SL" || a.orderType === "SL-M") && a.triggerPrice === undefined) return `${a.orderType} orders need a triggerPrice.`;
  return null;
}

const autoVariety = (): kite.Variety => (kite.isMarketOpen() ? "regular" : "amo");

async function trade(a: OrderArgs, side: kite.Side) {
  const bad = checkPrices(a);
  if (bad) return fail(bad);
  const key = kite.instrumentKey(a.stockSym, a.exchange);
  const ltp = await kite.getLTP([key]);
  if (!ltp[key]) return fail(`Unknown instrument ${key}.`);
  const value = (a.price ?? ltp[key].last_price) * a.qty;
  if (kite.MAX_ORDER_VALUE && value > kite.MAX_ORDER_VALUE) {
    const inr = (n: number) => `₹${round(n).toLocaleString("en-IN")}`;
    return fail(`Blocked: order value ${inr(value)} is above the MAX_ORDER_VALUE limit of ${inr(kite.MAX_ORDER_VALUE)}.`);
  }
  const variety = autoVariety();
  const res = await kite.placeOrder(toInput(a, side), variety);
  return ok({
    status: "placed",
    ...res,
    instrument: key,
    side,
    quantity: a.qty,
    order_type: a.orderType,
    product: a.product,
    approx_value: round(value),
    note: variety === "amo" ? "Market is closed, so this was placed as an after-market order (AMO)." : undefined,
  });
}

export function registerOrderTools(server: McpServer) {
  server.registerTool(
    "preview-order",
    {
      title: "Preview order (margin & charges)",
      description:
        "Checks an order before placing it: required margin, estimated charges, available cash and whether funds are sufficient. Does not place anything. Call this before buy-stock/sell-stock when the user asks if they can afford a trade.",
      inputSchema: { ...orderShape, side: z.enum(["BUY", "SELL"]) },
      annotations: READ_ONLY,
    },
    safe(async (a) => {
      const bad = checkPrices(a);
      if (bad) return fail(bad);
      return ok(await kite.previewOrder(toInput(a, a.side), autoVariety()));
    }),
  );

  server.registerTool(
    "buy-stock",
    {
      title: "Buy stock",
      description:
        "Places a BUY order. Defaults to a MARKET delivery (CNC) order on NSE. Outside market hours it is sent as an after-market order (AMO). Respects MAX_ORDER_VALUE.",
      inputSchema: orderShape,
      annotations: TRADING,
    },
    safe((a) => trade(a, "BUY")),
  );

  server.registerTool(
    "sell-stock",
    {
      title: "Sell stock",
      description:
        "Places a SELL order. Defaults to a MARKET delivery (CNC) order on NSE. Outside market hours it is sent as an after-market order (AMO). Respects MAX_ORDER_VALUE.",
      inputSchema: orderShape,
      annotations: TRADING,
    },
    safe((a) => trade(a, "SELL")),
  );

  server.registerTool(
    "list-orders",
    {
      title: "Order book",
      description: "Today's orders with status, filled quantity and average price. Optionally filter by status, e.g. OPEN, COMPLETE, CANCELLED, REJECTED, AMO REQ RECEIVED.",
      inputSchema: { status: z.string().optional() },
      annotations: READ_ONLY,
    },
    safe(async ({ status }) => {
      const rows = (await kite.getOrders())
        .filter((o) => !status || String(o.status).toUpperCase() === status.toUpperCase())
        .map((o) => ({
          order_id: o.order_id,
          time: o.order_timestamp,
          symbol: o.tradingsymbol,
          side: o.transaction_type,
          type: o.order_type,
          variety: o.variety,
          quantity: o.quantity,
          filled: o.filled_quantity,
          price: o.price || undefined,
          average_price: o.average_price || undefined,
          status: o.status,
          message: o.status_message || undefined,
        }));
      return ok(rows.length ? rows : "No orders today.");
    }),
  );

  server.registerTool(
    "order-history",
    {
      title: "Order history",
      description: "Every state an order went through (validation, open, complete, rejected...) with timestamps and reasons.",
      inputSchema: { orderId: z.string().min(1) },
      annotations: READ_ONLY,
    },
    safe(async ({ orderId }) =>
      ok((await kite.getOrderHistory(orderId)).map((s) => ({ time: s.order_timestamp, status: s.status, filled: s.filled_quantity, message: s.status_message || undefined }))),
    ),
  );

  server.registerTool(
    "modify-order",
    {
      title: "Modify order",
      description: "Changes the quantity, price, trigger price or order type of an open or AMO order.",
      inputSchema: {
        orderId: z.string().min(1),
        qty: z.number().int().positive().optional(),
        price: z.number().positive().optional(),
        triggerPrice: z.number().positive().optional(),
        orderType: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]).optional(),
      },
      annotations: TRADING,
    },
    safe(async ({ orderId, qty, price, triggerPrice, orderType }) => {
      if ([qty, price, triggerPrice, orderType].every((v) => v === undefined)) return fail("Nothing to change.");
      return ok(await kite.modifyOrder(orderId, { quantity: qty, price, triggerPrice, orderType }));
    }),
  );

  server.registerTool(
    "cancel-order",
    {
      title: "Cancel order",
      description: "Cancels an open or after-market (AMO) order by its order id. The order's variety is looked up automatically.",
      inputSchema: { id: z.union([z.string(), z.number()]).transform(String) },
      annotations: TRADING,
    },
    safe(async ({ id }) => ok(await kite.cancelOrder(id))),
  );

  server.registerTool(
    "list-trades",
    {
      title: "Trades",
      description: "Today's executed trades (fills) with price and quantity.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const rows = (await kite.getTrades()).map((t) => ({
        trade_id: t.trade_id, order_id: t.order_id, symbol: t.tradingsymbol, side: t.transaction_type,
        quantity: t.quantity, price: t.average_price, time: t.fill_timestamp,
      }));
      return ok(rows.length ? rows : "No trades today.");
    }),
  );

  server.registerTool(
    "create-gtt",
    {
      title: "Create GTT (stop-loss / target)",
      description:
        "Creates a Good-Till-Triggered order: when the price crosses triggerPrice, Kite places a LIMIT order. Use it for stop-losses (SELL below the price) or buy-the-dip / target orders. Valid for up to a year.",
      inputSchema: {
        stockSym: z.string().min(1),
        exchange,
        side: z.enum(["BUY", "SELL"]),
        qty: z.number().int().positive(),
        triggerPrice: z.number().positive(),
        limitPrice: z.number().positive().optional().describe("Defaults to the trigger price"),
        product: z.enum(["CNC", "MIS", "NRML"]).default("CNC"),
      },
      annotations: TRADING,
    },
    safe(async (a) =>
      ok(await kite.createGtt({ symbol: a.stockSym, exchange: a.exchange, side: a.side, quantity: a.qty, triggerPrice: a.triggerPrice, limitPrice: a.limitPrice, product: a.product })),
    ),
  );

  server.registerTool(
    "list-gtts",
    {
      title: "List GTTs",
      description: "Active and past GTT triggers with their trigger price and the order they will place.",
      annotations: READ_ONLY,
    },
    safe(async () => {
      const rows = (await kite.getGtts()).map((g) => ({
        id: g.id, status: g.status, instrument: `${g.condition.exchange}:${g.condition.tradingsymbol}`,
        trigger: g.condition.trigger_values, side: g.orders?.[0]?.transaction_type, quantity: g.orders?.[0]?.quantity,
        limit_price: g.orders?.[0]?.price, created_at: g.created_at,
      }));
      return ok(rows.length ? rows : "No GTTs.");
    }),
  );

  server.registerTool(
    "delete-gtt",
    {
      title: "Delete GTT",
      description: "Deletes a GTT trigger by id.",
      inputSchema: { id: z.number().int().positive() },
      annotations: TRADING,
    },
    safe(async ({ id }) => ok({ deleted: true, ...(await kite.deleteGtt(id)) })),
  );
}
