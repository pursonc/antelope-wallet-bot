import TelegramBot from 'node-telegram-bot-api';
import { config } from 'dotenv';
import { dbPromise } from './db';
import crypto from 'crypto';


// Load environment variables
config();

const BOT_TOKEN = process.env.YOUR_TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
    throw new Error("No Telegram Bot Token found in environment variables");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

interface RateLimiter {
    [key: string]: number[];
}

const rateLimiter: RateLimiter = {};
const MAX_REQUESTS = 5;
const PERIOD = 60 * 1000; // 1 minute in milliseconds

function isAllowed(userId: number): { allowed: boolean, waitTime: number } {
    const now = Date.now();
    if (!rateLimiter[userId]) {
        rateLimiter[userId] = [now];
        return { allowed: true, waitTime: 0 };
    }
    rateLimiter[userId] = rateLimiter[userId].filter(timestamp => now - timestamp < PERIOD);
    if (rateLimiter[userId].length < MAX_REQUESTS) {
        rateLimiter[userId].push(now);
        return { allowed: true, waitTime: 0 };
    }
    const nextAllowedTime = rateLimiter[userId][0] + PERIOD - now;
    return { allowed: false, waitTime: nextAllowedTime };
}

function generateKeyFromUserId(userId: number): string {
    return crypto.createHash('sha256').update(userId.toString()).digest('base64').slice(0, 32);
}

function encrypt(text: string, userId: number): string {
    const key = generateKeyFromUserId(userId);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'base64'), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string, userId: number): string {
    const key = generateKeyFromUserId(userId);
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key, 'base64'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

async function generateEosAccountName(): Promise<string> {
    const characters = 'abcdefghijklmnopqrstuvwxyz12345';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

bot.onText(/\/start/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from!.username;
    const firstName = msg.from!.first_name;
    const lastName = msg.from!.last_name;

    const db = await dbPromise;
    await db.run(
        'INSERT OR IGNORE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
        [userId, username, firstName, lastName]
    );

    const { allowed, waitTime } = isAllowed(userId);
    if (allowed) {
        bot.sendMessage(
            msg.chat.id,
            'SolTradingBot: Your Gateway to Solana DeFi 🤖\nTelegram | Twitter | Website\n\n🔹 EOS: $3.00\n\nCreate your first wallet at /wallets',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🐵 Profile', callback_data: 'profile' }],
                        [{ text: '💳 Wallets', callback_data: 'wallets' }],
                        [{ text: '📦 Transfer EOS', callback_data: 'transfer_eos' }]
                    ]
                }
            }
        );
    } else {
        bot.sendMessage(msg.chat.id, `Rate limit exceeded. Please try again after ${waitTime / 1000} seconds.`);
    }
});

bot.on("callback_query", async (callbackQuery) => {
  const userId = callbackQuery.from.id;
  const db = await dbPromise;
  const chatId = callbackQuery.message?.chat.id;

  switch (callbackQuery.data) {
    case "wallets":
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

      bot.editMessageText(message, {
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Show Private Key", callback_data: "show_private_key" }],
            [
              {
                text: "Create Account (Contract)",
                callback_data: "create_account_contract",
              },
            ],
            [
              {
                text: "Create Account (Auto)",
                callback_data: "create_account_auto",
              },
            ],
            [{ text: "Import Account", callback_data: "import_account" }],
          ],
        },
      });
      break;

    case "show_private_key":
      const userWithPrivateKey = await db.get(
        "SELECT eos_private_key FROM users WHERE user_id = ?",
        [userId]
      );
      if (userWithPrivateKey && userWithPrivateKey.eos_private_key) {
        const privateKey = decrypt(userWithPrivateKey.eos_private_key, userId);
        bot.editMessageText(`🔹 EOS Private Key: ${privateKey}`, {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
        });
      } else {
        bot.editMessageText("🔹 EOS Private Key: Not set", {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
        });
      }
      break;

    case "import_account":
      // bot.sendMessage(chatId!, "Please enter your EOS private key:");
      // bot.once("message", async (msg) => {
      //   if (msg.text) {
      //     const eosPrivateKey = msg.text;
      //     const encryptedPrivateKey = encrypt(eosPrivateKey, userId);

      //     // Assuming wharfkit provides a function to import an account from a private key
      //     const { eos_account_name, eos_public_key } =
      //       await wharfkit.import_account_from_private_key(eosPrivateKey);

      //     // Save account information to the database
      //     await db.run(
      //       "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
      //       [eos_account_name, eos_public_key, encryptedPrivateKey, userId]
      //     );

      //     bot.sendMessage(chatId!, "Account imported successfully.");
      //   }
      // });
      break;

    case "create_account_contract":
      const eosAccountName = await generateEosAccountName();
      bot.editMessageText(
        `To create an EOS account, transfer the required amount to the following contract with the specified memo:\nContract: example_contract\nMemo: ${eosAccountName}`,
        {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
        }
      );
      break;

    case "create_account_auto":
      // const autoEosAccountName = await generateEosAccountName();
      // const { eos_private_key, eos_public_key } = await wharfkit.create_keys(); // 假设 wharfkit 提供生成密钥的功能

      // const encryptedPrivateKey = encrypt(eos_private_key, userId);
      // await db.run(
      //   "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
      //   [autoEosAccountName, eos_public_key, encryptedPrivateKey, userId]
      // );

      // bot.editMessageText(
      //   `Account created successfully!\n\n🔹 EOS Account Name: ${autoEosAccountName}\n🔹 EOS Public Key: ${eos_public_key}`,
      //   {
      //     chat_id: chatId,
      //     message_id: callbackQuery.message?.message_id,
      //   }
      // );
      break;

    default:
      bot.sendMessage(chatId!, "Unknown command.");
      break;
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

bot.on("polling_error", console.error);

console.log("Bot is running...");

