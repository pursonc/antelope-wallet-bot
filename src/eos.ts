import { APIClient, PrivateKey } from "@wharfkit/antelope";
import fetch from "node-fetch";
import crypto from "crypto";
import { runQuery, getQuery } from "./db";
import TelegramBot from "node-telegram-bot-api";

// Helper function to send wallet options
function sendWalletOptions(bot: TelegramBot, chatId: number, message: string) {
  bot.sendMessage(chatId, message, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🐵 Profile", callback_data: "profile" }],
        [{ text: "💳 Wallets", callback_data: "wallets" }],
        [{ text: "📦 Transfer EOS", callback_data: "transfer_eos" }],
      ],
    },
  });
}

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
async function selectFastestEndpoint(): Promise<string> {
    try {
        const responseTimes = await Promise.all(apiEndpoints.map(url => measureResponseTime(url)));
        const fastestIndex = responseTimes.indexOf(Math.min(...responseTimes));
        return apiEndpoints[fastestIndex];
    } catch (error) {
        console.error("Error selecting fastest endpoint:", error);
        return apiEndpoints[0]; // Default to the first endpoint in case of an error
    }
}

// Ensure the createClient function uses node-fetch
async function createClient() {
  const fastestEndpoint = await selectFastestEndpoint();
  const fetch = (await import("node-fetch")).default;
  return new APIClient({
    url: fastestEndpoint,
    fetch: async (url, options) => {
      const { method, headers, body } = options;
      const response = await fetch(url, {
        method,
        headers,
        body,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        json: async () => response.json(),
        text: async () => response.text(),
      };
    },
  });
}

const clientPromise = createClient();

export async function generateEosAccountName(): Promise<string> {
  const characters = "abcdefghijklmnopqrstuvwxyz12345";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

export function generateEosKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const privateKey = PrivateKey.generate("K1"); // Using 'K1' curve
  const publicKey = privateKey.toPublic().toString();
  return { privateKey: privateKey.toString(), publicKey };
}

function generateKeyFromUserId(userId: number): Buffer {
  return crypto.createHash("sha256").update(userId.toString()).digest();
}

export function encrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export async function createEosAccount(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  method: "contract" | "auto"
) {
  try {
    const eosAccountName = await generateEosAccountName();
    if (method === "contract") {
      bot.sendMessage(
        chatId,
        `To create an EOS account, transfer the required amount to the following contract with the specified memo:\nContract: example_contract\nMemo: ${eosAccountName}`
      );
      return;
    } else {
      const { privateKey, publicKey } = generateEosKeyPair();
      const encryptedPrivateKey = encrypt(privateKey, userId);
      await runQuery(
        "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
        [eosAccountName, publicKey, encryptedPrivateKey, userId]
      );
      bot.sendMessage(
        chatId,
        `Account created successfully!\n\n🔹 EOS Account Name: ${eosAccountName}\n🔹 EOS Public Key: ${publicKey}`
      );
    }
  } catch (error) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    bot.sendMessage(chatId, `Error creating EOS account: ${errorMessage}`);
    sendWalletOptions(bot, chatId, "Returning to wallet options...");
  }
}

export async function importEosAccount(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  eosPrivateKey: string
) {
  try {
    const privateKey = PrivateKey.from(eosPrivateKey);
    const publicKey = privateKey.toPublic().toString();
    const encryptedPrivateKey = encrypt(eosPrivateKey, userId);

    // Use WharfKit to get the account name associated with the private key
    const client = await clientPromise;
    const response = await client.v1.chain.get_accounts_by_authorizers({
      keys: [publicKey],
    });

    if (!response || !response.accounts || !response.accounts.length) {
      throw new Error("No account found for this private key.");
    }

    const eosAccountName = response.accounts[0].account_name;

    await runQuery(
      "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
      [eosAccountName, publicKey, encryptedPrivateKey, userId]
    );

    bot.sendMessage(
      chatId,
      `Account imported successfully.\n\n🔹 EOS Account Name: ${eosAccountName}\n🔹 EOS Public Key: ${publicKey}`
    );
  } catch (error) {
  console.error("Error importing EOS account:", error);
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    bot.sendMessage(chatId, `Error importing EOS account: ${errorMessage}`);
    sendWalletOptions(bot, chatId, "Returning to wallet options...");
  }
}

