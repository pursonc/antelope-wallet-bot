import TelegramBot, { Message, CallbackQuery } from "node-telegram-bot-api";
import dotenv from "dotenv";
import { runQuery, getQuery } from "./db";
import { isAllowed } from "./rateLimiter";
import { getEosPrice, getEosRamPrice, sendWalletOptions, getEosAccountInfo } from "./utils";
import { importEosAccount, decrypt, createEosAccount } from "./eos";
import { START_MENU, WALLET_MENU } from "./menu";

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
      const eosRamPrice = await getEosRamPrice();
      let welcomeMessage = `EOS Bot: Your Gateway to EOS 🤖\n\n🔹 EOS: $${eosPrice}\n🔹 RAM: ${eosRamPrice} EOS/kb`;

      bot.sendMessage(
        msg.chat.id,
        welcomeMessage,
        {
          reply_markup: {
            inline_keyboard: START_MENU,
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
  } catch (error: unknown) {
    console.error("Database error:", error);
  }
});

bot.on("callback_query", async (callbackQuery: CallbackQuery) => {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;

  if (callbackQuery.data && callbackQuery.data.startsWith("select_account:")) {
    const userId = callbackQuery.from.id;
    const chatId = callbackQuery.message?.chat.id;
    const [_, accountName, permissionName] = callbackQuery.data.split(":");

    try {
      // Retrieve user information
      const user = await getQuery(
        "SELECT eos_public_key FROM users WHERE user_id = ?",
        [userId]
      );
      const { eos_public_key } = user;

      await runQuery(
        "UPDATE users SET eos_account_name = ?, permission_name = ? WHERE user_id = ?",
        [accountName, permissionName, userId]
      );

      bot.sendMessage(
        chatId!,
        `Account imported successfully.\n\n🔹 Account Name: ${accountName}\n🔹 Public Key: ${eos_public_key}\n🔹 Permission: ${permissionName}`
      );
    } catch (error: unknown) {
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      bot.sendMessage(chatId!, `Error importing EOS account: ${errorMessage}`);
      sendWalletOptions(bot, chatId!, "Returning to wallet options...");
    }
  }

  try {
    switch (callbackQuery.data) {
      case "wallets":
        const user = await getQuery(
          "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
          [userId]
        );
        let message = "Please Create Account or Import Account.";
        let inlineKeyboard = WALLET_MENU;
        if (user) {
          const { eos_account_name, eos_public_key, eos_private_key } = user;
          if (eos_account_name && eos_public_key && eos_private_key) {
             const privateKey = decrypt(
               eos_private_key,
               userId
             );
            message = `🔹 Account Name: <code>${eos_account_name}</code>\n🔹 Public Key: <code>${eos_public_key}</code>\n🔹 Private Key: <span class="tg-spoiler">${privateKey}</span>`;
            inlineKeyboard = [[{ text: "❌ Close", callback_data: "close" }]];

          }
        }

        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
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
          try {
            const { publicKey, encryptedPrivateKey, accounts } =
              await importEosAccount(msg.text, userId);

            if (accounts.length === 1) {
              const { accountName, permissionName } = accounts[0];

              await runQuery(
                "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ?, permission_name = ? WHERE user_id = ?",
                [
                  accountName,
                  publicKey,
                  encryptedPrivateKey,
                  permissionName,
                  userId,
                ]
              );

              bot.sendMessage(
                chatId,
                `Account imported successfully.\n\n🔹 EOS Account Name: ${accountName}\n🔹 EOS Public Key: ${publicKey}\n🔹 Permission: ${permissionName}`,
                {
                  reply_markup: {
                    inline_keyboard: START_MENU,
                  },
                }
              );
            } else {
              await runQuery(
                "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ?, permission_name = ? WHERE user_id = ?",
                ["-", publicKey, encryptedPrivateKey, "-", userId]
              );
              const inlineKeyboard = accounts.map((account) => [
                {
                  text: `${account.accountName} (${account.permissionName})`,
                  callback_data: `select_account:${account.accountName}:${account.permissionName}`,
                },
              ]);

              bot.sendMessage(
                chatId,
                "Multiple accounts found. Please select one:",
                {
                  reply_markup: {
                    inline_keyboard: inlineKeyboard,
                  },
                }
              );
            }
          } catch (error: unknown) {
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
              errorMessage = error.message;
            }
            bot.sendMessage(
              chatId,
              `Error importing EOS account: ${errorMessage}`
            );
            sendWalletOptions(bot, chatId, "Returning to wallet options...");
          }
        });
        break;

      case "create_account_contract":
        await createEosAccount(bot, chatId!, userId, "contract");
        break;

      case "create_account_auto":
        await createEosAccount(bot, chatId!, userId, "auto");
        break;

      case "profile":
        const profileUser = await getQuery(
          "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
          [userId]
        );
        if (
          profileUser &&
          profileUser.eos_account_name &&
          profileUser.eos_public_key
        ) {
          const { eos_account_name } = profileUser;
          const {
            ramUsage,
            ramQuota,
            netUsageUsed,
            netUsageMax,
            cpuUsageUsed,
            cpuUsageMax,
          } = await getEosAccountInfo(eos_account_name);

          // Convert RAM usage to appropriate unit
          let ramUsageStr, ramQuotaStr;
          if (ramUsage < 1024) {
            ramUsageStr = `${ramUsage.toFixed(2)} Bytes`;
          } else if (ramUsage < 1024 * 1024) {
            ramUsageStr = `${(ramUsage / 1024).toFixed(2)} KB`;
          } else if (ramUsage < 1024 * 1024 * 1024) {
            ramUsageStr = `${(ramUsage / (1024 * 1024)).toFixed(2)} MB`;
          } else {
            ramUsageStr = `${(ramUsage / (1024 * 1024 * 1024)).toFixed(2)} GB`;
          }

          if (ramQuota < 1024) {
            ramQuotaStr = `${ramQuota.toFixed(2)} Bytes`;
          } else if (ramQuota < 1024 * 1024) {
            ramQuotaStr = `${(ramQuota / 1024).toFixed(2)} KB`;
          } else if (ramQuota < 1024 * 1024 * 1024) {
            ramQuotaStr = `${(ramQuota / (1024 * 1024)).toFixed(2)} MB`;
          } else {
            ramQuotaStr = `${(ramQuota / (1024 * 1024 * 1024)).toFixed(2)} GB`;
          }

          // Convert NET usage to appropriate unit
          let netUsageUsedStr, netUsageMaxStr;
          if (netUsageUsed < 1024) {
            netUsageUsedStr = `${netUsageUsed.toFixed(2)} Bytes`;
          } else if (netUsageUsed < 1024 * 1024) {
            netUsageUsedStr = `${(netUsageUsed / 1024).toFixed(2)} KB`;
          } else {
            netUsageUsedStr = `${(netUsageUsed / (1024 * 1024)).toFixed(2)} MB`;
          }

          if (netUsageMax < 1024) {
            netUsageMaxStr = `${netUsageMax.toFixed(2)} Bytes`;
          } else if (netUsageMax < 1024 * 1024) {
            netUsageMaxStr = `${(netUsageMax / 1024).toFixed(2)} KB`;
          } else {
            netUsageMaxStr = `${(netUsageMax / (1024 * 1024)).toFixed(2)} MB`;
          }

          // Convert CPU usage to appropriate unit
          let cpuUsageUsedStr, cpuUsageMaxStr;
          if (cpuUsageUsed < 1000) {
            cpuUsageUsedStr = `${cpuUsageUsed.toFixed(2)} us`;
          } else if (cpuUsageUsed < 1000 * 1000) {
            cpuUsageUsedStr = `${(cpuUsageUsed / 1000).toFixed(2)} ms`;
          } else {
            cpuUsageUsedStr = `${(cpuUsageUsed / (1000 * 1000)).toFixed(2)} s`;
          }

          if (cpuUsageMax < 1000) {
            cpuUsageMaxStr = `${cpuUsageMax.toFixed(2)} us`;
          } else if (cpuUsageMax < 1000 * 1000) {
            cpuUsageMaxStr = `${(cpuUsageMax / 1000).toFixed(2)} ms`;
          } else {
            cpuUsageMaxStr = `${(cpuUsageMax / (1000 * 1000)).toFixed(2)} s`;
          }

          const profileMessage = `🔹 Account Name: <code>${eos_account_name}</code>\n🔹 RAM: ${ramUsageStr} / ${ramQuotaStr}\n🔹 NET: ${netUsageUsedStr} / ${netUsageMaxStr}\n🔹 CPU: ${cpuUsageUsedStr} / ${cpuUsageMaxStr}`;
          

          bot.editMessageText(profileMessage, {
            chat_id: chatId,
            message_id: callbackQuery.message?.message_id,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]],
            },
          });
        } else {
          bot.editMessageText("Please Create or Import an EOS account.", {
            chat_id: chatId,
            message_id: callbackQuery.message?.message_id,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Return wallets list", callback_data: "wallets" }],
                [{ text: "❌ Close", callback_data: "close" }],
              ],
            },
          });
        }
        break;

      case "delete":
        await runQuery(
          "UPDATE users SET eos_account_name = NULL, eos_public_key = NULL, eos_private_key = NULL, permission_name = NULL WHERE user_id = ?",
          [userId]
        );
        bot.editMessageText("Your EOS account information has been deleted.", {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              
              [{ text: "❌ Close", callback_data: "close" }],
            ],
          },
        });
        break;

      case "close":
        try {
          await bot.deleteMessage(chatId!, callbackQuery.message?.message_id!);
        } catch (error) {
          console.error("Error deleting message:", error);
          bot.sendMessage(
            chatId!,
            "Failed to delete the message. It may have already been deleted."
          );
        }
        break;

      default:
        bot.sendMessage(chatId!, "Unknown command.");
        break;
    }
  } catch (error) {
    console.error("Database error:", error);
  }
});

// Error handling for ECONNRESET and other network issues
bot.on("polling_error", (error) => {
  // Implement retry logic or other error handling here
  if (String(error).indexOf("EFATAL") > -1) {
    setTimeout(() => {
      bot.startPolling(); // Restart polling
    }, 5000); // Retry after 5 seconds
  }
});