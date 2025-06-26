import {server} from './mcp/index';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { number, z } from "zod";
import { placeOrder,getProfile, cancelorder, loginAccount, updateSession } from './api/zerodha';

server.registerTool(
  "buy-stock", 
  {
    title: "Buy stock",
    description: "it buys a stock from my  zerodha account",
    inputSchema: {stockSym: z.string(), qty:z.number()}
  },
  async ({stockSym, qty}) => {
   const data = await placeOrder(stockSym,"BUY",qty);
  return {
        content: [{ type: "text", text: String(data) }]
      };
  },
)

// server.tool(
//   "Buy a stock", 
//   {
//     title: "Buy stock",
//     description: "it buys a stock from my  zerodha account",
//     inputSchema: {stockSym: z.string(), qty:z.number()}
//   },
//   async ({stockSym, qty}) => {
//    placeOrder(stockSym,"BUY",qty)
//     return {
//           content: [{ type: "text", text: "Stock has been Bought" }]
//         };
//   },
// )

server.registerTool(
  "sell-stock", 
  {
    title: "Buy stock",
    description: "it buys a stock from my  zerodha account",
    inputSchema: {stockSym: z.string(), qty:z.number()}
  },
  async ({stockSym, qty}) => {
   const data = await placeOrder(stockSym,"SELL",qty);
  return {
        content: [{ type: "text", text: String(data) }]
      };
  },
)

server.registerTool(
  "profile-info",
  {
    title:"Profile Info",
    description: "it gets my zerodha profile info"
  },
  async () => {
    const data = await getProfile()
    return {
        content: [{ type: "text", text: String(data) }]
      };
  }
)

server.registerTool(
  "cancel-order",
  {
    title:"cancel order",
    description: "it can cells the order that are places at amo",
    inputSchema: {id:z.string()||z.number()}
  },
  async ({id}) => {
    const data = await cancelorder(id)
    return {
        content: [{ type: "text", text: String(data) }]
      };
  }
)

server.registerTool(
  "login",
  {
    title:"login",
    description:"when even the user say he need to login it return an login url"
  },
  async () =>{
    const url = await loginAccount()
    return {
      content: [{type:'text',text: String(url)}]
    }
  }
)

server.registerTool(
  "update-session-access",
  {
    title: "Update Session Token",
    description:"updates the session token when expired",
    inputSchema: {token:z.string()}
  },
  async ({token})=>{
    const data = await updateSession(token)
    return {
      content : [{type:'text',text: String(data)}]
    }
  }
)


const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();