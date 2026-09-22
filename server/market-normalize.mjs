export function normalizeLiveMarket(provider, item) {
  if (provider === "kalshi") {
    const value = Number(item?.yes_price ?? item?.last_price ?? item?.yes_ask);
    return { id:String(item?.ticker||item?.event_ticker||"unknown"), title:item?.title||item?.subtitle||"Untitled market", probability:Number.isFinite(value)?(value>1?value/100:value):null, provider, sourceUrl:"https://kalshi.com/" };
  }
  if (provider === "polymarket") {
    let prices=item?.outcomePrices; try { if(typeof prices==="string") prices=JSON.parse(prices); } catch { prices=null; }
    const value=Array.isArray(prices)?Number(prices[0]):Number(item?.bestAsk);
    return { id:String(item?.id||item?.conditionId||"unknown"), title:item?.question||item?.title||"Untitled market", probability:Number.isFinite(value)?value:null, provider, sourceUrl:item?.url||"https://polymarket.com/" };
  }
  const value=Number(item?.probability);
  return { id:String(item?.id||"unknown"), title:item?.question||item?.text||"Untitled market", probability:Number.isFinite(value)?value:null, provider:"manifold", sourceUrl:item?.url||"https://manifold.markets/" };
}
