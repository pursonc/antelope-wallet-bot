import TelegramBot, { Message, CallbackQuery } from "node-telegram-bot-api";
import dotenv from "dotenv";
import { runQuery, getQuery } from "./db";
import { isAllowed } from "./rateLimiter";
import { getEosPrice } from "./utils";
import { createEosAccount, importEosAccount, decrypt } from "./eos";

// Load environment variables
dotenv.config();

const BOT_TOKEN = process.env.YOUR_TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("No Telegram Bot Token found in environment variables");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg: Message) => {
  const userId = msg.from!.id;
  const username = msg.from!.username;
  const firstName = msg.from!.first_name;
  const lastName = msg.from!.last_name;

  try {
    await runQuery(
      "INSERT OR IGNORE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)",
      [userId, username, firstName, lastName]
    );

    const { allowed, waitTime } = isAllowed(userId);
    if (allowed) {
      const eosPrice = await getEosPrice();
      bot.sendMessage(
        msg.chat.id,
        `EOS Bot: Your Gateway to EOS 🤖\n\n🔹 EOS: $${eosPrice}\n\nCreate your first wallet at /wallets`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🐵 Profile", callback_data: "profile" }],
              [{ text: "💳 Wallets", callback_data: "wallets" }],
              [{ text: "📦 Transfer EOS", callback_data: "transfer_eos" }],
            ],
          },
        }
      );
    } else {
      bot.sendMessage(
        msg.chat.id,
        `Rate limit exceeded. Please try again after ${
          waitTime / 1000
        } seconds.`
      );
    }
  } catch (error) {
    console.error("Database error:", error);
  }
});

bot.on("callback_query", async (callbackQuery: CallbackQuery) => {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;

  try {
    switch (callbackQuery.data) {
      case "wallets":
        const user = await getQuery(
          "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
          [userId]
        );
        let message = "Please Create Account or Import Account.";
        let inlineKeyboard = [
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
        ];
        if (user) {
          const { eos_account_name, eos_public_key, eos_private_key } = user;
          if (eos_account_name && eos_public_key && eos_private_key) {
            message = `🔹 EOS Account Name: ${eos_account_name}\n🔹 EOS Public Key: ${eos_public_key}\n🔹 EOS Private Key: 🔒`;
            inlineKeyboard.unshift([
              { text: "Show Private Key", callback_data: "show_private_key" },
            ]);
          }
        }

        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
        break;

      case "show_private_key":
        const userWithPrivateKey = await getQuery(
          "SELECT eos_private_key FROM users WHERE user_id = ?",
          [userId]
        );
        if (userWithPrivateKey && userWithPrivateKey.eos_private_key) {
          const privateKey = decrypt(
            userWithPrivateKey.eos_private_key,
            userId
          );
          bot.editMessageText(`🔹 EOS Private Key: ${privateKey}`, {
            chat_id: chatId,
            message_id: callbackQuery.message?.message_id,
            reply_markup: {
              inline_keyboard: [[{ text: "Return", callback_data: "wallets" }]],
            },
          });
        } else {
          bot.editMessageText("🔹 EOS Private Key: Not set", {
            chat_id: chatId,
            message_id: callbackQuery.message?.message_id,
            reply_markup: {
              inline_keyboard: [[{ text: "Return", callback_data: "wallets" }]],
            },
          });
        }
        break;

      case "import_account":
        bot.sendMessage(chatId!, "Please enter your EOS private key:");
        bot.once("message", async (msg: Message) => {
              const chatId = msg.chat.id;
              const userId = msg.from!.id;

              if (!msg.text) {
                bot.sendMessage(chatId, "Please provide your EOS private key.");
                return;
              }
              await importEosAccount(bot, chatId, userId, msg.text.trim());
        });
        break;

      case "create_account_contract":
        // const contractMessage = await createEosAccount(userId, "contract");
        // bot.editMessageText(contractMessage, {
        //   chat_id: chatId,
        //   message_id: callbackQuery.message?.message_id,
        // });
        break;

      case "create_account_auto":
        // const autoMessage = await createEosAccount(userId, "auto");
        // bot.editMessageText(autoMessage, {
        //   chat_id: chatId,
        //   message_id: callbackQuery.message?.message_id,
        // });
        break;

      default:
        bot.sendMessage(chatId!, "Unknown command.");
        break;
    }
  } catch (error) {
    console.error("Database error:", error);
  }
});
