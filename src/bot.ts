import { Telegraf, Context, Markup } from "telegraf";
import fetch from "node-fetch";
import { config } from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// 加载环境变量
config();

const BOT_TOKEN = process.env.YOUR_TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("No Telegram Bot Token found in environment variables");
}

const bot = new Telegraf(BOT_TOKEN);

const dbPromise = open({
  filename: "user_data.db",
  driver: sqlite3.Database,
});

interface RateLimiter {
  [key: string]: number[];
}

const rateLimiter: RateLimiter = {};
const MAX_REQUESTS = 5;
const PERIOD = 60 * 1000; // 1 minute in milliseconds

function isAllowed(userId: number): { allowed: boolean; waitTime: number } {
  const now = Date.now();
  if (!rateLimiter[userId]) {
    rateLimiter[userId] = [now];
    return { allowed: true, waitTime: 0 };
  }
  rateLimiter[userId] = rateLimiter[userId].filter(
    (timestamp) => now - timestamp < PERIOD
  );
  if (rateLimiter[userId].length < MAX_REQUESTS) {
    rateLimiter[userId].push(now);
    return { allowed: true, waitTime: 0 };
  }
  const nextAllowedTime = rateLimiter[userId][0] + PERIOD - now;
  return { allowed: false, waitTime: nextAllowedTime };
}

function generateKeyFromUserId(userId: number): string {
  return crypto
    .createHash("sha256")
    .update(userId.toString())
    .digest("base64")
    .slice(0, 32);
}

function encrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(key, "base64"),
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    Buffer.from(key, "base64"),
    iv
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

async function generateEosAccountName(): Promise<string> {
  const characters = "abcdefghijklmnopqrstuvwxyz12345";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

bot.start(async (ctx: Context) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username;
  const firstName = ctx.from!.first_name;
  const lastName = ctx.from!.last_name;

  const db = await dbPromise;
  await db.run(
    "INSERT OR IGNORE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)",
    [userId, username, firstName, lastName]
  );

  const { allowed, waitTime } = isAllowed(userId);
  if (allowed) {
    ctx.reply(
      "SolTradingBot: Your Gateway to Solana DeFi 🤖\nTelegram | Twitter | Website\n\n🔹 EOS: $3.00\n\nCreate your first wallet at /wallets",
      Markup.inlineKeyboard([
        [Markup.button.callback("🐵 Profile", "profile")],
        [Markup.button.callback("💳 Wallets", "wallets")],
        [Markup.button.callback("📦 Transfer EOS", "transfer_eos")],
      ])
    );
  } else {
    ctx.reply(
      `Rate limit exceeded. Please try again after ${waitTime / 1000} seconds.`
    );
  }
});

bot.action("wallets", async (ctx: Context) => {
  const userId = ctx.from!.id;

  const db = await dbPromise;
  const user = await db.get(
    "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
    [userId]
  );

  let message = "Please Create Account or Import Account.";
  if (user) {
    const { eos_account_name, eos_public_key, eos_private_key } = user;
    if (eos_account_name && eos_public_key && eos_private_key) {
      message = `🔹 EOS Account Name: ${eos_account_name}\n🔹 EOS Public Key: ${eos_public_key}\n🔹 EOS Private Key: 🔒`;
    }
  }

  ctx.editMessageText(
    message,
    Markup.inlineKeyboard([
      [Markup.button.callback("Show Private Key", "show_private_key")],
      [
        Markup.button.callback(
          "Create Account (Contract)",
          "create_account_contract"
        ),
      ],
      [Markup.button.callback("Create Account (Auto)", "create_account_auto")],
      [Markup.button.callback("Import Account", "import_account")],
    ])
  );
});

bot.action("show_private_key", async (ctx: Context) => {
  const userId = ctx.from!.id;

  const db = await dbPromise;
  const user = await db.get(
    "SELECT eos_private_key FROM users WHERE user_id = ?",
    [userId]
  );

  if (user && user.eos_private_key) {
    const privateKey = decrypt(user.eos_private_key, userId);
    ctx.editMessageText(`🔹 EOS Private Key: ${privateKey}`);
  } else {
    ctx.editMessageText("🔹 EOS Private Key: Not set");
  }
});

bot.action("import_account", (ctx: Context) => {
  ctx.reply("Please enter your EOS private key:");
  ctx.session.waiting_for_private_key = true;
});

bot.action("create_account_contract", async (ctx: Context) => {
  const eosAccountName = await generateEosAccountName();
  ctx.editMessageText(
    `To create an EOS account, transfer the required amount to the following contract with the specified memo:\nContract: example_contract\nMemo: ${eosAccountName}`
  );
});

bot.action("create_account_auto", async (ctx: Context) => {
  const userId = ctx.from!.id;

  const eosAccountName = await generateEosAccountName();
  const { eos_private_key, eos_public_key } = await wharfkit.create_keys(); // 假设 wharfkit 提供生成密钥的功能

  const encryptedPrivateKey = encrypt(eos_private_key, userId);
  const db = await dbPromise;
  await db.run(
    "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
    [eosAccountName, eos_public_key, encryptedPrivateKey, userId]
  );

  ctx.editMessageText(
    `Account created successfully!\n\n🔹 EOS Account Name: ${eosAccountName}\n🔹 EOS Public Key: ${eos_public_key}`
  );
});

bot.on("text", async (ctx: Context) => {
  const userId = ctx.from!.id;

  if (ctx.session.waiting_for_private_key) {
    const eosPrivateKey = ctx.message!.text!;
    const encryptedPrivateKey = encrypt(eosPrivateKey, userId);

    const { eos_account_name, eos_public_key } =
      await wharfkit.import_account_from_private_key(eosPrivateKey); // 假设 wharfkit 提供从私钥导入账户的功能

    const db = await dbPromise;
    await db.run(
      "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
      [eos_account_name, eos_public_key, encryptedPrivateKey, userId]
    );

    ctx.reply("Account imported successfully.");
    ctx.session.waiting_for_private_key = false;
  }
});

(async () => {
  const db = await dbPromise;
  await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            last_name TEXT,
            eos_account_name TEXT,
            eos_public_key TEXT,
            eos_private_key TEXT
        )
    `);
})();

bot.launch();
console.log("Bot is running...");
