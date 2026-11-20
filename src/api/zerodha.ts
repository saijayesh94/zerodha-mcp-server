import path from "path";
import dotenv from "dotenv";
import { KiteConnect } from "kiteconnect";

// Load .env from the project root (src/api or build/api -> ../../.env), so it
// works no matter which directory the MCP client starts the server from.
// No console output here: stdout is the MCP stdio channel.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

const apiKey = requireEnv("KITE_API_KEY");
const apiSecret = requireEnv("KITE_API_SECRET");
let accessToken = process.env.KITE_ACCESS_TOKEN ?? "";

/** Hard cap on a single order's value (INR). 0 or unset = no cap. */
export const MAX_ORDER_VALUE = Number(process.env.MAX_ORDER_VALUE ?? 0) || 0;

// The SDK's typings are stricter than the REST API they wrap; we validate
// inputs with zod at the tool boundary and keep the client loosely typed here.
const kc: any = new KiteConnect({ api_key: apiKey });
if (accessToken) kc.setAccessToken(accessToken);

export type Exchange = "NSE" | "BSE" | "NFO" | "BFO" | "MCX" | "CDS";
export type Product = "CNC" | "MIS" | "NRML";
export type OrderType = "MARKET" | "LIMIT" | "SL" | "SL-M";
export type Side = "BUY" | "SELL";
export type Variety = "regular" | "amo" | "co" | "iceberg";

export interface OrderInput {
  symbol: string;
  exchange: Exchange;
  side: Side;
  quantity: number;
  product: Product;
  orderType: OrderType;
  price?: number;
  triggerPrice?: number;
}

/* ------------------------------------------------------------------ auth */

export function loginAccount(): string {
  return kc.getLoginURL();
}

export async function updateSession(requestToken: string) {
  const session = await kc.generateSession(requestToken, apiSecret);
  accessToken = session.access_token;
  kc.setAccessToken(accessToken);
  return { message: "Session updated", user_id: session.user_id, user_name: session.user_name };
}

/* --------------------------------------------------------------- account */

export const getProfile = () => kc.getProfile();
export const getMargins = () => kc.getMargins();

/* ------------------------------------------------------------- portfolio */

export const getHoldings = (): Promise<any[]> => kc.getHoldings();
export const getPositions = (): Promise<{ net: any[]; day: any[] }> => kc.getPositions();

/* ----------------------------------------------------------- market data */

export const instrumentKey = (symbol: string, exchange: Exchange = "NSE") =>
  `${exchange}:${symbol.trim().toUpperCase()}`;

export const getQuote = (keys: string[]) => kc.getQuote(keys);
export const getLTP = (keys: string[]): Promise<Record<string, { instrument_token: number; last_price: number }>> =>
  kc.getLTP(keys);

export async function getDailyCandles(symbol: string, exchange: Exchange, days: number) {
  const key = instrumentKey(symbol, exchange);
  const ltp = await getLTP([key]);
  if (!ltp[key]) throw new Error(`Unknown instrument ${key}`);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const candles: any[] = await kc.getHistoricalData(ltp[key].instrument_token, "day", from, to);
  return { key, lastPrice: ltp[key].last_price, candles };
}

/* ---------------------------------------------------------------- orders */

/** NSE/BSE cash session: Mon–Fri 09:15–15:30 IST. Outside it, orders go as AMO. */
export function isMarketOpen(now = new Date()): boolean {
  const ist = new Date(now.getTime() + (5.5 * 60 + now.getTimezoneOffset()) * 60_000);
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}

function toKiteParams(o: OrderInput) {
  return {
    exchange: o.exchange,
    tradingsymbol: o.symbol.toUpperCase(),
    transaction_type: o.side,
    quantity: o.quantity,
    product: o.product,
    order_type: o.orderType,
    ...(o.price !== undefined ? { price: o.price } : {}),
    ...(o.triggerPrice !== undefined ? { trigger_price: o.triggerPrice } : {}),
  };
}

export async function previewOrder(o: OrderInput, variety: Variety) {
  const [margins, funds] = await Promise.all([
    kc.orderMargins([{ ...toKiteParams(o), variety }], "compact"),
    kc.getMargins("equity"),
  ]);
  const m = margins[0];
  const available = funds.available?.live_balance ?? funds.net;
  return {
    instrument: instrumentKey(o.symbol, o.exchange),
    side: o.side,
    quantity: o.quantity,
    variety,
    required_margin: round(m.total),
    charges: round(m.charges?.total ?? 0),
    available_cash: round(available),
    sufficient_funds: available >= m.total,
  };
}

export async function placeOrder(o: OrderInput, variety: Variety) {
  const res = await kc.placeOrder(variety, toKiteParams(o));
  return { order_id: res.order_id, variety };
}

export const getOrders = (): Promise<any[]> => kc.getOrders();
export const getOrderHistory = (orderId: string): Promise<any[]> => kc.getOrderHistory(orderId);
export const getTrades = (): Promise<any[]> => kc.getTrades();

/** Kite needs the order's variety to modify/cancel it; look it up instead of guessing. */
async function varietyOf(orderId: string): Promise<Variety> {
  const order = (await getOrders()).find((x) => String(x.order_id) === orderId);
  if (!order) throw new Error(`Order ${orderId} not found in today's order book`);
  return order.variety;
}

export async function modifyOrder(
  orderId: string,
  changes: { quantity?: number; price?: number; triggerPrice?: number; orderType?: OrderType },
) {
  const variety = await varietyOf(orderId);
  const res = await kc.modifyOrder(variety, orderId, {
    ...(changes.quantity !== undefined ? { quantity: changes.quantity } : {}),
    ...(changes.price !== undefined ? { price: changes.price } : {}),
    ...(changes.triggerPrice !== undefined ? { trigger_price: changes.triggerPrice } : {}),
    ...(changes.orderType ? { order_type: changes.orderType } : {}),
  });
  return { order_id: res.order_id, variety, modified: true };
}

export async function cancelOrder(orderId: string) {
  const variety = await varietyOf(orderId);
  const res = await kc.cancelOrder(variety, orderId);
  return { order_id: res.order_id, variety, cancelled: true };
}

/* ------------------------------------------------------------------- GTT */

export async function createGtt(input: {
  symbol: string;
  exchange: Exchange;
  side: Side;
  quantity: number;
  triggerPrice: number;
  limitPrice?: number;
  product: Product;
}) {
  const key = instrumentKey(input.symbol, input.exchange);
  const ltp = await getLTP([key]);
  if (!ltp[key]) throw new Error(`Unknown instrument ${key}`);
  const res = await kc.placeGTT({
    trigger_type: "single",
    tradingsymbol: input.symbol.toUpperCase(),
    exchange: input.exchange,
    trigger_values: [input.triggerPrice],
    last_price: ltp[key].last_price,
    orders: [
      {
        transaction_type: input.side,
        quantity: input.quantity,
        product: input.product,
        order_type: "LIMIT",
        price: input.limitPrice ?? input.triggerPrice,
      },
    ],
  });
  return { trigger_id: res.trigger_id, instrument: key, last_price: ltp[key].last_price };
}

export const getGtts = (): Promise<any[]> => kc.getGTTs();
export const deleteGtt = (id: number) => kc.deleteGTT(id);

/* ----------------------------------------------------------------- utils */

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
