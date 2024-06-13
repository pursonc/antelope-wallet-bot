import TelegramBot, { Message, CallbackQuery } from "node-telegram-bot-api";
import dotenv from "dotenv";
import { runQuery, getQuery } from "./db";
import { isAllowed } from "./rateLimiter";
import { getEosPrice, getEosRamPrice, sendWalletOptions, getEosAccountInfo, getEosBalance, convertToBytes, checkEosAccountExists } from "./utils";
import {
  importEosAccount,
  decrypt,
  generateEosAccountName,
  transferEos,
  buyRam,
  buyRamBytes,
  generateEosKeyPair,
  encrypt,
} from "./eos";
import { START_MENU, WALLET_MENU_NO_ACCOUNT, WALLET_MENU_WITH_ACCOUNT } from "./menu";

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
      let welcomeMessage = `*EOS Bot: Your Gateway to EOS 🤖*\n\n🔹 EOS: $${eosPrice}\n🔹 RAM: ${eosRamPrice} EOS/kb\n\n[Github](https://github.com/pursonchen/eos-mummmy-bot)`;

      bot.sendMessage(msg.chat.id, welcomeMessage, {
        reply_markup: {
          inline_keyboard: START_MENU,
        },
        parse_mode: "Markdown",
      });
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
        `Account imported successfully.\n\n🔹 Account Name: ${accountName}\n🔹 Public Key: ${eos_public_key}\n🔹 Permission: ${permissionName}`,
        {
          reply_markup: {
            inline_keyboard: START_MENU,
          },
        }
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

  if (callbackQuery.data && callbackQuery.data.startsWith("view_ram_orders:")) {
    const pageSize = 5; // 每页显示的订单数
    const currentPage = parseInt(callbackQuery.data.split(":")[1]) || 1;
    const offset = (currentPage - 1) * pageSize;

    const ramOrdersList = await runQuery(
      "SELECT * FROM ram_orders WHERE user_id = ? ORDER BY order_date DESC LIMIT ? OFFSET ?",
      [userId, pageSize, offset]
    );

    const totalOrders = await getQuery(
      "SELECT COUNT(*) as count FROM ram_orders WHERE user_id = ?",
      [userId]
    );

    const totalPages = Math.ceil(totalOrders.count / pageSize);

    let orderMessage = `Your RAM Orders ${offset + ramOrdersList.length}/${
      totalOrders.count
    }:\n\n`;
    if (ramOrdersList && ramOrdersList.length > 0) {
      const ordersArray = Array.isArray(ramOrdersList)
        ? ramOrdersList
        : [ramOrdersList];
      ordersArray.forEach((order) => {
        orderMessage += `🔹 Account Name: ${order.eos_account_name}\n🔹 RAM Amount: ${order.ram_bytes} bytes\n🔹 Price per KB: ${order.price_per_kb} EOS\n🔹 Status: ${order.order_status}\n🔹 Order Date(UTC): ${order.order_date}\n`;
        if (order.order_status === "success") {
          orderMessage += `🔹 Transaction ID: ${order.transaction_id}\n`;
        } else if (order.order_status === "failed") {
          orderMessage += `🔹 Failure Reason: ${order.failure_reason}\n`;
        }
        orderMessage += "\n";
      });
    } else {
      orderMessage += "No RAM orders found.";
    }

    const inlineKeyboardOrder = [
      [{ text: "↔️ Wallet", callback_data: "wallets" }],
    ];

    if (currentPage > 1) {
      inlineKeyboardOrder.unshift([
        {
          text: "⬅️ Previous",
          callback_data: `view_ram_orders:${currentPage - 1}`,
        },
      ]);
    }

    if (currentPage < totalPages) {
      inlineKeyboardOrder.unshift([
        {
          text: "➡️ Next",
          callback_data: `view_ram_orders:${currentPage + 1}`,
        },
      ]);
    }

    inlineKeyboardOrder.unshift([
      { text: "Clear Orders", callback_data: "clear_ram_orders" },
    ]);

    bot.sendMessage(chatId!, orderMessage, {
      reply_markup: {
        inline_keyboard: inlineKeyboardOrder,
      },
    });
  }
  try {
    switch (callbackQuery.data) {
      case "wallets":
        const user = await getQuery(
          "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
          [userId]
        );
        let message = "Please Create Account or Import Account.";
        let inlineKeyboard;
        const ramOrders = await runQuery(
          "SELECT * FROM ram_orders WHERE user_id = ?",
          [userId]
        );

        if (
          user &&
          user.eos_account_name &&
          user.eos_public_key &&
          user.eos_private_key
        ) {
          const { eos_account_name, eos_public_key, eos_private_key } = user;
          const privateKey = decrypt(eos_private_key, userId);
          const eosBalance = await getEosBalance(eos_account_name);
          message = `🔹 Account Name: <code>${eos_account_name}</code>\n🔹 Public Key: <code>${eos_public_key}</code>\n🔹 Private Key(backup 1st): <span class="tg-spoiler">${privateKey}</span>\n🔹 Balance: ${eosBalance} EOS`;

          inlineKeyboard = WALLET_MENU_WITH_ACCOUNT;
          if (ramOrders && ramOrders.length > 0) {
            const existingRamOrdersButton = inlineKeyboard.find(
              (button) => button[0].callback_data === "view_ram_orders"
            );
            if (!existingRamOrdersButton) {
              inlineKeyboard.unshift([
                { text: "📜 My RAM Limit Orders", callback_data: "view_ram_orders" },
              ]);
            }
          }
        } else {
          const order = await getQuery(
            "SELECT eos_account_name FROM account_orders WHERE user_id = ? AND activated = 0",
            [userId]
          );
          if (order) {
            message = `You have an ongoing order for account: <code>${order.eos_account_name}</code>`;
            inlineKeyboard = [
              [{ text: "View Order", callback_data: "view_order" }],
              [{ text: "❌ Close", callback_data: "close" }],
            ];
          } else {
            inlineKeyboard = WALLET_MENU_NO_ACCOUNT;
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
              // console.log(accountName);
              await runQuery(
                "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ?, permission_name = ? WHERE user_id = ?",
                [
                  `${accountName}`,
                  publicKey,
                  encryptedPrivateKey,
                  `${permissionName}`,
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
        const eosAccountName = await generateEosAccountName();
        const accountExists = await checkEosAccountExists(eosAccountName);

        if (accountExists) {
          bot.sendMessage(
            chatId!,
            "Generated account already exists. Please try again."
          );
          return;
        }

        const { privateKey, publicKey } = generateEosKeyPair();
        await runQuery(
          "INSERT INTO account_orders (user_id, eos_account_name, eos_public_key, eos_private_key) VALUES (?, ?, ?, ?)",
          [userId, eosAccountName, publicKey, encrypt(privateKey, userId)]
        );

        const contractMessage = `<b>EOS Account Order</b>\n\nCreate Account Name: <code>${eosAccountName}</code>\n\nCreation Steps:\n1. Transfer 4 EOS to the following account: \n\n <code>signupeoseos</code> \n\n with the memo: \n<code>${eosAccountName}-${publicKey}</code>\n\n2. After transfer is complete, wait for 1 minute and then click the activation button below.\n\n⚠️ Note: The bot does not charge any fee during the creation process. If the account creation fails and leads to asset loss, The bot cannot help you recover assets.\n\nPlease complete the registration order as soon as possible. Once the account name is taken, the EOS cannot be refunded.`;

        bot.sendMessage(chatId!, contractMessage, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "Activate", callback_data: "activate_account" }],
              [{ text: "↔️ Wallet", callback_data: "wallets" }],
            ],
          },
        });
        break;
      case "orders":
        const pendingOrder = await getQuery(
          "SELECT eos_account_name, public_key FROM orders WHERE user_id = ?",
          [userId]
        );
        if (pendingOrder) {
          const { eos_account_name, public_key } = pendingOrder;
          const activateMessage = `Your pending account creation order:\n\n🔹 Account Name: <code>${eos_account_name}</code>\n🔹 Public Key: <code>${public_key}</code>\n\nPlease activate the account creation process.`;

          bot.editMessageText(activateMessage, {
            chat_id: chatId,
            message_id: callbackQuery.message?.message_id,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Activate Account",
                    callback_data: "activate_account",
                  },
                ],
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        } else {
          bot.sendMessage(chatId!, "No pending orders found.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        }
        break;

      case "activate_account":
        const order = await getQuery(
          "SELECT eos_account_name, eos_public_key, eos_private_key FROM account_orders WHERE user_id = ? AND activated = 0",
          [userId]
        );
        if (order) {
          const { eos_account_name, eos_public_key, eos_private_key } = order;
          const accountExists = await checkEosAccountExists(
            order.eos_account_name
          );
          if (accountExists) {
            await runQuery(
              "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ?, permission_name = ? WHERE user_id = ?",
              [
                eos_account_name,
                eos_public_key,
                eos_private_key,
                "active",
                userId,
              ]
            );
            await runQuery(
              "UPDATE account_orders SET activated = 1 WHERE order_id = ?",
              [order.order_id]
            );

            bot.sendMessage(
              chatId!,
              `Account activated successfully!\n\n🔹 Account Name: ${order.eos_account_name}\n🔹 Public Key: ${order.eos_public_key}`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "↔️ Wallet", callback_data: "wallets" }],
                  ],
                },
              }
            );
          } else {
            bot.sendMessage(
              chatId!,
              `Account activation failed. The account ${order.eos_account_name} does not exist yet.`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "↔️ Wallet", callback_data: "wallets" }],
                  ],
                },
              }
            );
          }
        } else {
          bot.sendMessage(chatId!, "No pending orders found.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        }
        break;

      case "delete_order":
        await runQuery(
          "DELETE FROM account_orders WHERE user_id = ? AND activated = 0",
          [userId]
        );
        bot.sendMessage(chatId!, "Your account order has been deleted.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "↔️ Wallet", callback_data: "wallets" }],
            ],
          },
        });
        break;
      case "view_order":
        const orderDetails = await getQuery(
          "SELECT eos_account_name, eos_public_key FROM account_orders WHERE user_id = ? AND activated = 0",
          [userId]
        );
        if (orderDetails) {
          const { eos_account_name, eos_public_key } = orderDetails;
          const contractMessage = `<b>EOS Account Order</b>\n\nCreate Account Name: <code>${eos_account_name}</code>\n\nCreation Steps:\n1. Transfer 4 EOS to the following contract: \n\n <code>signupeoseos</code> \n\n with the memo: \n<code>${eos_account_name}-${eos_public_key}</code>\n\n2. After transfer is complete, wait for 1 minute and then click the activation button below.\n\n⚠️ Note: The bot does not charge any fee during the creation process. If the account creation fails and leads to asset loss, TokenPocket cannot help you recover assets.\n\nPlease complete the registration order as soon as possible. Once the account name is taken, the EOS cannot be refunded.`;

          bot.sendMessage(chatId!, contractMessage, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "❌ Delete Order", callback_data: "delete_order" }],
                [{ text: "Activate", callback_data: "activate_account" }],
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        } else {
          bot.sendMessage(chatId!, "No pending order found.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        }
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
      case "order_status":
        const order_book = await getQuery(
          "SELECT eos_account_name FROM account_orders WHERE user_id = ? AND activated = 0",
          [userId]
        );

        if (order_book) {
          const { eos_account_name } = order_book;
          const message = `Pending account order:\n🔹 Account Name: <code>${eos_account_name}</code>\n\nPlease complete the account creation and then click 'Activate'.`;

          bot.sendMessage(chatId!, message, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🔄 Activate", callback_data: "activate_account" }],
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        } else {
          bot.sendMessage(chatId!, "No pending account orders found.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        }
        break;

      case "transfer_eos":
        bot.sendMessage(
          chatId!,
          "Enter Addresses with Amounts and memo(optional). The address and amount are separated by commas.\n\n&lt;receiver&gt;,&lt;amount&gt;,&lt;memo&gt;\n\n<b>Example (Click to Copy):</b>\n1.<code>replace_account,0.001</code>\n2.<code>replace_account,1,ThisIsTheMemo</code>\n3.<code>replace_account,3.45,This_is_The_memo</code>\n<i>(_ will be replaced with space)</i>",
          { parse_mode: "HTML" }
        );
        bot.once("message", async (msg: Message) => {
          const chatId = msg.chat.id;
          const userId = msg.from!.id;

          if (!msg.text) {
            bot.sendMessage(chatId, "Please provide the address and amount.");
            return;
          }

          const [recipient, amount, ...memoParts] = msg.text.split(",");
          const memo = memoParts.join(",").replace(/_/g, " ") || "";

          try {
            const result = await transferEos(
              userId,
              recipient,
              Number(amount),
              memo
            );
            const transactionId = result.resolved?.transaction.id;
            const transactionLink = `https://bloks.io/transaction/${transactionId}`;
            bot.sendMessage(
              chatId,
              `Successfully transferred ${amount} EOS to ${recipient}${
                memo ? ` with memo: ${memo}` : ""
              }.\n\n[View Transaction](${transactionLink})`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "↔️ Wallet", callback_data: "wallets" }],
                  ],
                },
                parse_mode: "Markdown",
              }
            );
          } catch (error: unknown) {
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
              if (
                error.message.toLowerCase().includes("cpu") ||
                error.message.toLowerCase().includes("net")
              ) {
                const user = await getQuery(
                  "SELECT eos_account_name, eos_public_key, eos_private_key FROM users WHERE user_id = ?",
                  [userId]
                );
                error.message += `\n\nYour account resources are insufficient. Please visit [this website](https://eospowerup.io/free) and enter your account ${user.eos_account_name} to get free resources, or add [this Telegram bot](https://t.me/eospowerupbot) to get assistance.`;
              }
              errorMessage = error.message;
            }
            bot.sendMessage(chatId, `Error transferring EOS: ${errorMessage}`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "↔️ Wallet", callback_data: "wallets" }],
                ],
              },
              parse_mode: "Markdown",
            });
          }
        });
        break;

      case "buy_ram":
        const eosRamPrice = await getEosRamPrice();
        bot.sendMessage(
          chatId!,
          `RAM price: ${eosRamPrice} EOS/kb\n\nEnter Addresses with Amounts (supports bytes or EOS amount)\nThe address and amount are separated by commas.\n\n&lt;receiver&gt;,&lt;ram_bytes&gt; or &lt;ram_of_eos_price&gt;\n\n<b>Example (Click to Copy):</b>\n1.<code>replace_account,1024bytes</code>\n2.<code>replace_account,1.2kb</code>\n3.<code>replace_account,1mb</code>\n4.<code>replace_account,2.1gb</code>\n5.<code>replace_account,1EOS</code>\n6.<code>replace_account,3.45EOS</code>`,
          { parse_mode: "HTML" }
        );
        bot.once("message", async (msg: Message) => {
          const chatId = msg.chat.id;
          const userId = msg.from!.id;

          if (!msg.text) {
            bot.sendMessage(chatId, "Please provide the required information.");
            return;
          }

          const [recipient, amount] = msg.text.split(",");
          const amountValue = parseFloat(amount);

          try {
            if (
              amount.toLowerCase().includes("bytes") ||
              amount.toLowerCase().includes("kb") ||
              amount.toLowerCase().includes("mb") ||
              amount.toLowerCase().includes("gb")
            ) {
              const bytes = convertToBytes(amount);
              const result = await buyRamBytes(userId, recipient, bytes);
              bot.sendMessage(
                chatId,
                `RAM bought successfully!\nTransaction ID: https://bloks.io/transaction/${result.resolved?.transaction.id}`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "↔️ Wallet", callback_data: "wallets" }],
                    ],
                  },
                }
              );
            } else if (amount.toLowerCase().includes("eos")) {
              const eosAmount = amountValue;
              const result = await buyRam(userId, recipient, eosAmount);
              bot.sendMessage(
                chatId,
                `RAM bought successfully!\nTransaction ID: https://bloks.io/transaction/${result.resolved?.transaction.id}`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [{ text: "↔️ Wallet", callback_data: "wallets" }],
                    ],
                  },
                }
              );
            } else {
              bot.sendMessage(
                chatId,
                "Invalid amount format. Please use bytes, kb, mb, gb, or EOS."
              );
            }
          } catch (error: unknown) {
            let errorMessage = "Unknown error";
            if (error instanceof Error) {
              if (
                error.message.toLowerCase().includes("cpu") ||
                error.message.toLowerCase().includes("net")
              ) {
                const user = await getQuery(
                  "SELECT eos_account_name FROM users WHERE user_id = ?",
                  [userId]
                );
                error.message += `\n\nYour account resources are insufficient. Please visit [this website](https://eospowerup.io/free) and enter your account ${user.eos_account_name} to get free resources, or add [this Telegram bot](https://t.me/eospowerupbot) to get assistance.`;
              }
              errorMessage = error.message;
            }
            bot.sendMessage(chatId, `Error buying RAM: ${errorMessage}`, {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "↔️ Wallet", callback_data: "wallets" }],
                ],
              },
              parse_mode: "Markdown",
            });
          }
        });
        break;

      case "delete":
        await runQuery(
          "UPDATE users SET eos_account_name = NULL, eos_public_key = NULL, eos_private_key = NULL, permission_name = NULL WHERE user_id = ?",
          [userId]
        );
        await runQuery(
          "DELETE from ram_orders WHERE user_id = ?",
          [userId]
        );
        bot.editMessageText("Your EOS account information has been deleted.", {
          chat_id: chatId,
          message_id: callbackQuery.message?.message_id,
          reply_markup: {
            inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]],
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

      case "ram_order":
        const ramPrice = await getEosRamPrice();
       bot.sendMessage(
         chatId!,
         `RAM Price:${ramPrice} EOS/kb \n\n Enter RAM order details in the format: \n\n&lt;receiver&gt;,&lt;ram_amount(EOS or bytes)&lt;,&lt;price_per_kb(EOS)&lt;\n\n<b>Example (Click to Copy):</b>\n1.<code>replace_account,1024bytes,0.01</code>\n2.<code>replace_account,1kb,0.01</code>\n3.<code>replace_account,1mb,0.01</code>\n4.<code>replace_account,1gb,0.01</code>`,
         { parse_mode: "HTML" }
       );
        bot.once("message", async (msg: Message) => {
          const chatId = msg.chat.id;
          const userId = msg.from!.id;

          if (!msg.text) {
            bot.sendMessage(chatId, "Please provide the RAM order details.");
            return;
          }

          const [accountName, ramAmount, pricePerKb] = msg.text.split(",");
          const ramBytes = convertToBytes(ramAmount);
          const price = parseFloat(pricePerKb);

          const existingOrders = await runQuery(
            "SELECT COUNT(*) AS order_count FROM ram_orders WHERE user_id = ? AND order_status = 'pending'",
            [userId]
          );

          if (existingOrders.order_count >= 5) {
            bot.sendMessage(
              chatId,
              "You have reached the maximum limit of 5 pending RAM orders."
            );
            return;
          }

          await runQuery(
            "INSERT INTO ram_orders (user_id, eos_account_name, ram_bytes, price_per_kb, order_status, order_date) VALUES (?, ?, ?, ?, 'pending', datetime('now'))",
            [userId, accountName, ramBytes, price]
          );

          bot.sendMessage(chatId, "RAM order created successfully.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "↔️ Wallet", callback_data: "wallets" }],
              ],
            },
          });
        });
        break;

      case "view_ram_orders":
        const pageSize = 5; // 每页显示的订单数
        const currentPage = 1;
        const offset = (currentPage - 1) * pageSize;

        const ramOrdersList = await runQuery(
          "SELECT * FROM ram_orders WHERE user_id = ? ORDER BY order_date DESC LIMIT ? OFFSET ?",
          [userId, pageSize, offset]
        );

        const totalOrders = await getQuery(
          "SELECT COUNT(*) as count FROM ram_orders WHERE user_id = ?",
          [userId]
        );

        const totalPages = Math.ceil(totalOrders.count / pageSize);

        let orderMessage = `Your RAM Orders ${offset + ramOrdersList.length}/${
          totalOrders.count
        }:\n\n`;
        if (ramOrdersList && ramOrdersList.length > 0) {
          const ordersArray = Array.isArray(ramOrdersList)
            ? ramOrdersList
            : [ramOrdersList];
          ordersArray.forEach((order) => {
            orderMessage += `🔹 Account Name: ${order.eos_account_name}\n🔹 RAM Amount: ${order.ram_bytes} bytes\n🔹 Price per KB: ${order.price_per_kb} EOS\n🔹 Status: ${order.order_status}\n🔹 Order Date(UTC): ${order.order_date}\n`;
            if (order.order_status === "success") {
              orderMessage += `🔹 Transaction ID: ${order.transaction_id}\n`;
            } else if (order.order_status === "failed") {
              orderMessage += `🔹 Failure Reason: ${order.failure_reason}\n`;
            }
            orderMessage += "\n";
          });
        } else {
          orderMessage += "No RAM orders found.";
        }

        const inlineKeyboardOrder = [
          [{ text: "↔️ Wallet", callback_data: "wallets" }],
        ];

        if (currentPage > 1) {
          inlineKeyboardOrder.unshift([
            {
              text: "⬅️ Previous",
              callback_data: `view_ram_orders:${currentPage - 1}`,
            },
          ]);
        }

        if (currentPage < totalPages) {
          inlineKeyboardOrder.unshift([
            {
              text: "➡️ Next",
              callback_data: `view_ram_orders:${currentPage + 1}`,
            },
          ]);
        }

        inlineKeyboardOrder.unshift([
          { text: "Clear Orders", callback_data: "clear_ram_orders" },
        ]);

        bot.sendMessage(chatId!, orderMessage, {
          reply_markup: {
            inline_keyboard: inlineKeyboardOrder,
          },
        });
        break;

      case "clear_ram_orders":
        await runQuery("DELETE FROM ram_orders WHERE user_id = ?", [userId]);
        bot.sendMessage(chatId!, "All your RAM orders have been cleared.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "↔️ Wallet", callback_data: "wallets" }],
            ],
          },
        });
        break;

      default:
        if (
          callbackQuery.data &&
          !callbackQuery.data.startsWith("select_account:") &&
          !callbackQuery.data.startsWith("view_ram_orders:")
        ) {
          bot.sendMessage(chatId!, "Unknown command" + callbackQuery.data);
        }

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