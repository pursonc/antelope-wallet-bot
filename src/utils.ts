import axios from "axios";

let eosPriceCache: { price: number; timestamp: number } | null = null;

export async function getEosPrice(): Promise<number> {
  const now = Date.now();
  if (eosPriceCache && now - eosPriceCache.timestamp < 60000) {
    return eosPriceCache.price;
  }

const response = await axios.get(
  "https://api.binance.com/api/v3/ticker/price?symbol=EOSUSDT"
);
    const data = response.data as { symbol: string; price: string };
    const price = parseFloat(data.price);

  eosPriceCache = { price, timestamp: now };
  return price;
}
