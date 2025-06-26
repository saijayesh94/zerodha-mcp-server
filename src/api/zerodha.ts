import { KiteConnect } from "kiteconnect";

const apiKey = "6uz0z40cbflrjx5l";
const apiSecret = "7hzgpy99v9dlzna8itpjfik1amaffnnt";
let requestToken = "X6S3tuGyDTOp0OO3WojJAF6cQl7geX5Z";
let accessToken = "RKSl4duL6FN2NvcRPlNikEbaLdHzoj30"

const kc = new KiteConnect({ api_key: apiKey });

// console.log(kc.getLoginURL())



// init()

async function cancelorder(id:string|number) {
  try {
   const data =  await kc.cancelOrder("amo",id)
   if(data){
     return String(data)
   }else{
    return "order could not be cancled"
   }
  } catch (error) {
    console.error(error)
  }
}



async function generateSession() {
  try {
    const response = await kc.generateSession(requestToken, apiSecret);
    accessToken = response.access_token;
    // console.log("Session generated:", response);
    if(accessToken){
      return {
        message:"accessToken Updated Sucessfully",
        response
      }
    }else{
      return {
        message:"accessToken not Updated",
        response: null
      }
    }
  } catch (err) {
    console.error("Error generating session:", err);
  }
}

async function getProfile() {
  try {
    kc.setAccessToken(accessToken);
    const profile = await kc.getProfile();
    if(profile){
      return String(profile)
    }else{
      return "could not get the profile info"
    }
  } catch (err) {
    console.error("Error getting profile:", err);
  }
}

async function placeOrder(tradesymbol:string, type:"BUY"|"SELL", qty:number) {
  try{
    kc.setAccessToken(accessToken);
    const order = await kc.placeOrder("amo", {
      exchange:"NSE",
      tradingsymbol: tradesymbol,
      transaction_type: type,
      quantity: qty,
      product: "CNC",
      order_type: "MARKET",
    })
    return order
  }catch(err){
    console.log("Error placing order",err)
  }
}

async function loginAccount() {
  try{
     const url =  kc.getLoginURL()
     if(url){
       return url
     }
     else{
      return "conuldn't get the url"
     }
  }catch(err){
    console.log("conuldn't get the url");
  }
}

async function updateRequestToken(token:string) {
  if(token){
    requestToken = token
    return {
      requestToken,
      message:"requestToken updated"
    }
  }
  else{
    return{
      requestToken: null,
      message:"requestToken not upated"
    } 
  }
}


async function updateSession(token:string) {
  try {
    await updateRequestToken(token);
    const data = await generateSession();
    if(data?.response?.access_token){
      return "access token updated"
    }else{
      return "could not update access token"
    }
  } catch (err) {
    console.error(err);
  }
}

export  {
  getProfile,
  placeOrder,
  generateSession,
  loginAccount,
  updateRequestToken,
  cancelorder,
  updateSession
}
