import fetch from "node-fetch";
import TelegramBot from "node-telegram-bot-api";
import { START_MENU } from "./menu";

let eosPriceCache: { price: number; timestamp: number } | null = null;
let eosRamPriceCache: { price: number; timestamp: number } | null = null;

// List of API endpoints
const apiEndpoints = [
  "https://eos.greymass.com",
  "https://api.main.alohaeos.com",
  "https://eospush.mytokenpocket.vip",
  "https://eospush.tokenpocket.pro",
];

// Function to measure response time
async function measureResponseTime(url: string): Promise<number> {
    const start = Date.now();
    try {
        const response = await fetch(`${url}/v1/chain/get_info`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        await response.json();
        return Date.now() - start;
    } catch (error) {
        return Number.MAX_SAFE_INTEGER; // Return a high value on error
    }
}

// Function to select the fastest API endpoint
export async function selectFastestEndpoint(): Promise<string> {
    try {
        const responseTimes = await Promise.all(apiEndpoints.map(url => measureResponseTime(url)));
        const fastestIndex = responseTimes.indexOf(Math.min(...responseTimes));
        return apiEndpoints[fastestIndex];
    } catch (error) {
        console.error("Error selecting fastest endpoint:", error);
        return apiEndpoints[0]; // Default to the first endpoint in case of an error
    }
}

async function fetchWithRetry(
  urls: string[],
  options: any = {},
  retries: number = 3,
  backoff: number = 3000
): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    for (const url of urls) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          throw new Error(
            `Network response was not ok: ${response.statusText}`
          );
        }
        return await response.json();
      } catch (error) {
        console.warn(`Attempt ${attempt} failed for ${url}.`);
      }
    }
    if (attempt < retries) {
      console.warn(`Retrying in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    } else {
      console.error(`All ${retries} attempts failed.`);
      throw new Error("Failed to fetch data from all URLs.");
    }
  }
}

export async function getEosPrice(): Promise<number> {
  const now = Date.now();
  if (eosPriceCache && now - eosPriceCache.timestamp < 60000) {
    return eosPriceCache.price;
  }

  const urls = [
    "https://api.binance.com/api/v3/ticker/price?symbol=EOSUSDT",
    "https://api.kraken.com/0/public/Ticker?pair=EOSUSDT",
    "https://api.coinbase.com/v2/prices/EOS-USD/spot",
  ];

  const data = await fetchWithRetry(urls);
  let price: number;

  if (data.price) {
    price = parseFloat(data.price);
  } else if (data.result?.XXBTZEUR?.c?.[0]) {
    price = parseFloat(data.result.XXBTZEUR.c[0]);
  } else if (data.data?.amount) {
    price = parseFloat(data.data.amount);
  } else {
    throw new Error("Failed to parse EOS price.");
  }

  eosPriceCache = { price, timestamp: now };
  return price;
}

export async function getEosRamPrice(): Promise<number> {
  const now = Date.now();
  if (eosRamPriceCache && now - eosRamPriceCache.timestamp < 60000) {
    return eosRamPriceCache.price;
  }
 const fastestEndpoint = await selectFastestEndpoint();
  const response = await fetch(`${fastestEndpoint}/v1/chain/get_table_rows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      json: true,
      code: "eosio",
      scope: "eosio",
      table: "rammarket",
      limit: 1,
    }),
  });
  const data = await response.json();
  if (!data || !data.rows || data.rows.length === 0) {
    throw new Error("No RAM market data found.");
  }
  const rows = data.rows[0];
  const base = parseFloat(rows.base.balance.split(" ")[0]);
  const quote = parseFloat(rows.quote.balance.split(" ")[0]);
  const price = ((quote / base) * 1024).toFixed(4);  // EOS per KB

 eosRamPriceCache = { price: parseFloat(price), timestamp: now };
 return parseFloat(price);
}

// Function to get EOS account info
export async function getEosAccountInfo(accountName: string): Promise<{ ramUsage: number, ramQuota: number, netUsageUsed: number, netUsageMax: number, cpuUsageUsed: number, cpuUsageMax: number }> {
  const fastestEndpoint = await selectFastestEndpoint();
  const response = await fetch(`${fastestEndpoint}/v1/chain/get_account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_name: accountName }),
  });
  const data = await response.json();
  if (!data) {
    throw new Error("No account data found.");
  }

  const ramUsage = data.ram_usage;
  const ramQuota = data.ram_quota;
  const netUsageUsed = data.net_limit.used;
  const netUsageMax = data.net_limit.max;
  const cpuUsageUsed = data.cpu_limit.used;
  const cpuUsageMax = data.cpu_limit.max;

  return { ramUsage, ramQuota, netUsageUsed, netUsageMax, cpuUsageUsed, cpuUsageMax };
}

// Helper function to send wallet options
export function sendWalletOptions(
  bot: TelegramBot,
  chatId: number,
  message: string
) {
  bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: START_MENU,
    },
  });
}
