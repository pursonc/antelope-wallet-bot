import { Message, CallbackQuery } from "node-telegram-bot-api";
import { runQuery, getQuery } from "../db";
import {
  getEosAccountInfo,
  getEosBalance,
  convertToBytes,
  checkEosAccountExists,
  sendWalletOptions,
  getEosRamPrice,
  getEosPrice,
} from "../utils";
import {
  importEosAccount,
  decrypt,
  generateEosAccountName,
  transferEos,
  buyRam,
  buyRamBytes,
  generateEosKeyPair,
  encrypt,
  authorizeUser,
  getSessionExpirationTime,
  getSessionPrivateKey,
  isSessionActive,
  createEosAccount,
} from "../eos";
import {
  WALLET_MENU_NO_ACCOUNT,
  WALLET_MENU_WITH_ACCOUNT,
  START_MENU,
} from "../menu";
import bot from "../bot";
import { PAYMENT_TYPES } from "../types";


export async function handleSelectAccount(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
  const [_, accountName, permissionName] = callbackQuery.data!.split(":");

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

export async function handleRAMOrderPage(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
  const pageSize = 5; // 每页显示的订单数
  const currentPage = parseInt(callbackQuery.data!.split(":")[1]) || 1;
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

export async function handleWallets(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;

  const user = await getQuery(
    "SELECT eos_account_name, eos_public_key, eos_private_key, session_expiration FROM users WHERE user_id = ?",
    [userId]
  );

  let message = "Please Create Account or Import Account.";
  let inlineKeyboard: { text: string; callback_data: string }[][] = [];

  if (
    user &&
    user.eos_account_name &&
    user.eos_public_key &&
    user.eos_private_key
  ) {
    const {
      eos_account_name,
      eos_public_key,
      eos_private_key,
      session_expiration,
    } = user;

    const sessionExpirationTime = await getSessionExpirationTime(userId);
    const {days, hours, minutes, timestamp} = sessionExpirationTime;

    // console.log("sessionExpirationTime", sessionExpirationTime);

    const currentTime = Math.floor(new Date().getTime() / 1000); // Current time in seconds
    const privateKey = await getSessionPrivateKey(userId);
    if (session_expiration && timestamp > currentTime && privateKey) {
      // Session is still valid, no need to unlock
      const eosBalance = await getEosBalance(eos_account_name);

      message = `🔹 Account Name: <code>${eos_account_name}</code>\n🔹 Public Key: <code>${eos_public_key}</code>\n🔹 Private Key(Plz Backup❗️): <span class="tg-spoiler">${privateKey}</span>\n🔹 Balance: ${eosBalance} EOS\n`;
      if (days || hours || minutes) {
        message += `🔹 Session Expire in ${days && `${days} days`} ${
          hours && `${hours} hours`
        } ${minutes && `${minutes} minutes`}`;
      }
      inlineKeyboard = WALLET_MENU_WITH_ACCOUNT;

          const ramOrders = await runQuery(
            "SELECT * FROM ram_orders WHERE user_id = ?",
            [userId]
          );
          if (ramOrders) {
            if (Array.isArray(ramOrders) && ramOrders.length > 0) {
              const hasViewRAMOrders = inlineKeyboard.some((row) =>
                row.some((button) => button.callback_data === "view_ram_orders")
              );
              if (!hasViewRAMOrders) {
                inlineKeyboard.unshift([
                  { text: "📜 RAM Orders", callback_data: "view_ram_orders" },
                ]);
              }
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
    } else {
      // Session expired or not set, ask for password to unlock
      
      bot.sendMessage(
        chatId!,
        "🔐Please enter your password to unlock:"
      );
      bot.once("message", async (msg: Message) => {
        const password = msg.text!;

        const decryptedPrivateKey = decrypt(eos_private_key, password);
        if (!decryptedPrivateKey) {
          message = "🙅 Incorrect password. Please try again.";
          inlineKeyboard = START_MENU;
        } else {
          const eosBalance = await getEosBalance(eos_account_name);
          await authorizeUser(userId, password, 1);
          message = `<b>Unlock Wallet then buy RAM or transfer. </b>\n\n🔹 Account Name: <code>${eos_account_name}</code>\n🔹 Public Key: <code>${eos_public_key}</code>\n🔹 Private Key(Plz Backup❗️): <span class="tg-spoiler">${decryptedPrivateKey}</span>\n🔹 Balance: ${eosBalance} EOS\n`;
          inlineKeyboard = WALLET_MENU_WITH_ACCOUNT;
        const ramOrders = await runQuery(
        "SELECT * FROM ram_orders WHERE user_id = ?",
        [userId]
        );
        if (ramOrders) {
        if (Array.isArray(ramOrders) && ramOrders.length > 0) {
            const hasViewRAMOrders = inlineKeyboard.some((row) =>
            row.some(
                (button) => button.callback_data === "view_ram_orders"
            )
            );
            if (!hasViewRAMOrders) {
            inlineKeyboard.unshift([
                {
                text: "📜 RAM Orders",
                callback_data: "view_ram_orders",
                },
            ]);
            }
        }
        }
        }

        bot.sendMessage(chatId!, message, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        });
      });
    }
  } else {
    const order = await getQuery(
      "SELECT eos_account_name FROM account_orders WHERE user_id = ?",
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
       
        const hasCreateAccoutByCard = inlineKeyboard.some((row) =>
          row.some(
            (button) => button.callback_data === "pay_for_account_by_card"
          )
        );
        if (!hasCreateAccoutByCard && process.env.PAYMENT_PROVIDER_TOKEN) {
          inlineKeyboard.unshift([
            {
              text: "💳 Create Account (Credit Card)",
              callback_data: "pay_for_account_by_card",
            },
          ]);
        }

        const hasCreateAccoutByCrypto = inlineKeyboard.some((row) =>
          row.some(
            (button) => button.callback_data === "pay_for_account_by_crypto"
          )
        );
        if (!hasCreateAccoutByCrypto && process.env.XAPAY_API_KEY) {
          inlineKeyboard.unshift([
            {
              text: "🟠 Create Account (Crypto)",
              callback_data: "pay_for_account_by_crypto",
            },
          ]);
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
  }
}



export async function handleImportAccount(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;

  bot.sendMessage(chatId!, "🔑Please enter your EOS private key:");
  bot.once("message", async (msg: Message) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!msg.text) {
      bot.sendMessage(chatId, "Please provide your EOS private key.");
      return;
    }
    const eosPrivateKey = msg.text;

    bot.sendMessage(
      chatId,
      "🔐Please enter an encryption password(>= 8 characters):"
    );
    bot.once("message", async (msg: Message) => {
      const password = msg.text;
      if (!password || password.length < 8) {
        bot.sendMessage(
          chatId,
          "Invalid password. Please provide an encryption password.(>= 8 characters)"
        );
         
      }

      try {
        const { publicKey, encryptedPrivateKey, accounts } =
          await importEosAccount(eosPrivateKey, password!);

        if (accounts.length === 1) {
          const { accountName, permissionName } = accounts[0];

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
        bot.sendMessage(chatId, `Error importing EOS account: ${errorMessage}`);
        sendWalletOptions(bot, chatId, "Returning to wallet options...");
      }
    });
  });
}

export async function handleCreateAccountContract(
  callbackQuery: CallbackQuery
) {
  const chatId = callbackQuery.message?.chat.id;
  const userId = callbackQuery.from.id;

  // Ask user for a password to encrypt the private key
  bot.sendMessage(
    chatId!,
    "🔐Please enter a password to encrypt your private key(>= 8 characters):"
  );

  bot.once("message", async (msg) => {
    const password = msg.text;

    try {
      let eosAccountName = "";

        while (true) {
            eosAccountName = await generateEosAccountName();
            let accountExists = await checkEosAccountExists(eosAccountName);
            if (!accountExists) {
                break;
            }
        }

      const { privateKey, publicKey } = generateEosKeyPair();
      await runQuery(
        "INSERT INTO account_orders (user_id, eos_account_name, eos_public_key, eos_private_key) VALUES (?, ?, ?, ?)",
        [userId, eosAccountName, publicKey, encrypt(privateKey, password!)]
      );

      const contractMessage = `<b>EOS Account Order</b>\n\nCreate Account Name: <code>${eosAccountName}</code>\n\nCreation Steps:\n1. Transfer 4 EOS to the following account: \n\n <code>signupeoseos</code> \n\n with the memo: \n<code>${eosAccountName}-${publicKey}</code>\n\n2. After transfer is complete, wait for 1 minute and then click the activation button below.\n\n⚠️ Note: The bot does not charge any fee during the creation process. If the account creation fails and leads to asset loss, the bot cannot help you recover assets.\n\nPlease complete the registration order as soon as possible. Once the account name is taken, the EOS cannot be refunded.`;

      bot.sendMessage(chatId!, contractMessage, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Activate", callback_data: "activate_account" }],
            [{ text: "↔️ Wallet", callback_data: "wallets" }],
          ],
        },
      });
    } catch (error) {
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      bot.sendMessage(chatId!, `Error creating EOS account: ${errorMessage}`);
    }
  });
}

export async function handleAccountOrders(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
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
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
  }
}

export async function handleActivateAccount(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
  const order = await getQuery(
    "SELECT eos_account_name, eos_public_key, eos_private_key FROM account_orders WHERE user_id = ? AND activated = 0",
    [userId]
  );
  if (order) {
    const { eos_account_name, eos_public_key, eos_private_key } = order;
    const accountExists = await checkEosAccountExists(order.eos_account_name);
    if (accountExists) {
      await runQuery(
        "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ?, permission_name = ? WHERE user_id = ?",
        [eos_account_name, eos_public_key, eos_private_key, "active", userId]
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
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
  }
}

export async function handleAuthorizeUser(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  const userId = callbackQuery.from.id;

  bot.sendMessage(
    chatId!,
    "⚠️The bot will be authorized to execute some transactions with your private key temporarily. Such as executing the limit order. \n\n🔐Please enter your password to authorize:"
  );

  bot.once("message", async (msg) => {
    const password = msg.text;

    const user = await getQuery(
      "SELECT eos_private_key FROM users WHERE user_id = ?",
      [userId]
    );

    if (user) {
      const decryptedPrivateKey = decrypt(user.eos_private_key, password!);
      if (!decryptedPrivateKey) {
        bot.sendMessage(chatId!, "🙅 Incorrect password. Please try again.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "↔️ Wallet", callback_data: "wallets" }],
            ],
          },
        });
      } else {
        bot.sendMessage(chatId!, "Select authorization duration:", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "1 hour", callback_data: `authorize:1:${password}` },
                { text: "6 hours", callback_data: `authorize:6:${password}` },
                { text: "12 hours", callback_data: `authorize:12:${password}` },
              ],
              [
                { text: "1 day", callback_data: `authorize:24:${password}` },
                { text: "3 days", callback_data: `authorize:72:${password}` },
                { text: "7 days", callback_data: `authorize:168:${password}` },
              ],
            ],
          },
        });
      }
    } else {
      bot.sendMessage(chatId!, "No account found for authorization.", {
        reply_markup: {
          inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
        },
      });
    }
  });
}


export async function handleConfirmAuthorization(callbackQuery: CallbackQuery) {
  const [_, duration, password] = callbackQuery.data!.split(":");
  const userId = callbackQuery.from.id;
  try {
    await authorizeUser(userId, password, Number(duration));
    bot.sendMessage(
      callbackQuery.message!.chat.id,
      `✅Authorized for ${duration} hour(s).`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
        },
      }
    );
  } catch (error: unknown) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    bot.sendMessage(
      callbackQuery.message!.chat.id,
      `Error authorizing user: ${errorMessage}`
    );
  }
}

export async function handleDeleteAccountOrders(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
  await runQuery(
    "DELETE FROM account_orders WHERE user_id = ? AND activated = 0",
    [userId]
  );
  bot.sendMessage(chatId!, "Your account order has been deleted.", {
    reply_markup: {
      inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
    },
  });
}

export async function handleViewAccountOrders(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;

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
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
  }
}

export async function handleProfile(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
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
        inline_keyboard: [
          [{ text: "⬅️ Return wallets list", callback_data: "wallets" }],
          [{ text: "❌ Close", callback_data: "close" }],
        ],
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
}

export async function handleAccountOrderStatus(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
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
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
  }
}

export async function handleTransferEOS(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  const userId = callbackQuery.from.id;
  const isUnlock = await isSessionActive(userId);

    if (!isUnlock) {
      bot.editMessageText("Unlock Wallet to Transfer. ", {
        chat_id: chatId,
        message_id: callbackQuery.message?.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
        },
      });
      return;
    }
const message = `
Enter Addresses with Amounts and memo(optional). The address and amount are separated by commas.\n\n
&lt;receiver&gt;, &lt;amount&gt;, &lt;memo&gt;\n\n
<b>Example (Click to Copy):</b>\n
1. <code>replace_account,0.001</code>\n
2. <code>replace_account,1,ThisIsTheMemo</code>\n
3. <code>replace_account,3.45,This_is_The_memo</code>\n
("_" will be replaced with space)
`;

  bot.sendMessage(
    chatId!,
    message,
    { parse_mode: "HTML" }
  );
  bot.once("message", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!msg.text) {
      bot.sendMessage(chatId, "Please provide the address and amount.");
      return;
    }

    const [recipient, amount, ...memoParts] = msg.text.split(",");
    const memo = memoParts.join(",").replace(/_/g, " ") || "";

    try {
      const result = await transferEos(userId, recipient, Number(amount), memo);
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
          inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
        },
        parse_mode: "Markdown",
      });
    }
  });
}

export async function handleBuyRAM(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  const eosRamPrice = await getEosRamPrice();
  const userId = callbackQuery.from.id;
  const isUnlock = await isSessionActive(userId);


  if (!isUnlock) {
     bot.editMessageText("Unlock Wallet then buy RAM. ", {
       chat_id: chatId,
       message_id: callbackQuery.message?.message_id,
       reply_markup: {
         inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
       },
     });
     return;
  }

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
          inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
        },
        parse_mode: "Markdown",
      });
    }
  });
}

export async function handleDeleteAccount(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;

    bot.editMessageText("Are you sure you want to delete your EOS account?", {
      chat_id: chatId,
      message_id: callbackQuery.message?.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Yes, delete", callback_data: "confirm_delete_account" }],
          [{ text: "No, go back", callback_data: "wallets" }],
        ],
      },
    });
  
}

export async function handleConfirmDeleteAccount(callbackQuery: CallbackQuery) {
     const userId = callbackQuery.from.id;
     const chatId = callbackQuery.message?.chat.id;
    await runQuery(
      "UPDATE users SET eos_account_name = NULL, eos_public_key = NULL, eos_private_key = NULL, permission_name = NULL WHERE user_id = ?",
      [userId]
    );
    await runQuery("DELETE FROM ram_orders WHERE user_id = ?", [userId]);
    await runQuery("DELETE FROM payments WHERE user_id = ?", [userId]);

    bot.editMessageText("Your EOS account information has been deleted.", {
      chat_id: chatId,
      message_id: callbackQuery.message?.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]],
      },
    });
}

export async function handleClose(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  try {
    await bot.deleteMessage(chatId!, callbackQuery.message?.message_id!);
  } catch (error) {
    console.error("Error deleting message:", error);
    bot.sendMessage(
      chatId!,
      "Failed to delete the message. It may have already been deleted."
    );
  }
}

export async function handleRAMOrder(callbackQuery: CallbackQuery) {
  const chatId = callbackQuery.message?.chat.id;
  const ramPrice = await getEosRamPrice();
  const userId = callbackQuery.from.id;
  const isUnlock = await isSessionActive(userId);

  if (!isUnlock) {
    bot.editMessageText("Unlock Wallet then buy RAM. ", {
      chat_id: chatId,
      message_id: callbackQuery.message?.message_id,
      reply_markup: {
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
    return;
  }
  bot.sendMessage(
    chatId!,
    `RAM Price:${ramPrice} EOS/kb \n\nPlease make sure to create a Session Key that is long enough on the wallet page.\n\n Enter RAM order details in the format: \n\n&lt;receiver&gt;,&lt;ram_amount(EOS or bytes)&gt;,&lt;price_per_kb(EOS)&gt;\n\n<b>Example (Click to Copy):</b>\n1.<code>replace_account,1024bytes,0.01</code>\n2.<code>replace_account,1kb,0.01</code>\n3.<code>replace_account,1mb,0.01</code>\n4.<code>replace_account,1gb,0.01</code>`,
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
        inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
      },
    });
  });
}
export async function handleViewRAMOrders(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
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
}

export async function handleClearRAMOrders(callbackQuery: CallbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message?.chat.id;
  await runQuery("DELETE FROM ram_orders WHERE user_id = ?", [userId]);
  bot.sendMessage(chatId!, "All your RAM orders have been cleared.", {
    reply_markup: {
      inline_keyboard: [[{ text: "↔️ Wallet", callback_data: "wallets" }]],
    },
  });
}


export async function handleStripePayment(callbackQuery: CallbackQuery, provider_token?: string, telegram_bot_token?: string) {
  const chatId = callbackQuery.message?.chat.id!;
  const userId = callbackQuery.from.id;

  try {
    const eosPrice = await getEosPrice();
    const amount = Math.ceil(
      eosPrice * Number(process.env.EOS_ACCOUNT_PRICE) )* 100
     // Convert to cents and round up

    const invoice = {
      chat_id: chatId,
      title: "New EOS Account",
      description: "Payment for services creating a new EOS account",
      payload: JSON.stringify({ userId, amount }), // Payload to identify the payment
      provider_token,
      start_parameter: "start",
      currency: "USD",
      prices: [{ label: "USD", amount }],
      max_tip_amount: 500,
      suggested_tip_amounts: [100, 200, 300, 500],
      photo_url:
        "https://static-btcfx.oss-ap-southeast-1.aliyuncs.com/invoice-cartoon.png",
      photo_width: 512,
      photo_height: 512,
      need_name: false,
      need_phone_number: false,
      need_email: false,
      need_shipping_address: false,
      send_phone_number_to_provider: false,
      send_email_to_provider: false,
      is_flexible: false,
    };

    const response = await fetch(
      `https://api.telegram.org/bot${telegram_bot_token}/sendInvoice`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(invoice),
      }
    );
    

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.description);
    }

    // Save the invoice in the database
    await runQuery(
      "INSERT INTO payments (user_id, amount, status, chat_id, type) VALUES (?, ?, ?, ?, ?)",
      [userId, amount, "pending", chatId, PAYMENT_TYPES[0]]
    );
  } catch (error) {
    console.error("Error creating invoice:", error);
    bot.sendMessage(chatId, "Failed to create invoice. Please try again.");
  }
}

function passwordInvalidRetryCreateAccount(msg: Message, userId: number,  count: number) {
 if (count >= 2) {
    bot.sendMessage(userId, "Create Account Fail. Please contract Admin.");
    return;
 }
    // Listen for the password input
  bot.once("message", async (msg: Message) => {
    const password = msg.text;
    // Validate the password length
    if (password && password.length >= 8) {
      try {
        const result = await createEosAccount(
        userId,
        password,
        Number(process.env.EOS_ACCOUNT_PRICE)!
      );
      bot.sendMessage(
        userId,
        `Account create successfully!\nTransaction ID: https://bloks.io/transaction/${result.resolved?.transaction.id}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Return wallets list", callback_data: "wallets" }],
            ],
          },
        }
      );
      } catch (error: unknown) {
        let errorMessage = "Unknown error";
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        bot.sendMessage(userId!, `Error create EOS account: ${errorMessage}`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Return wallets list", callback_data: "wallets" }],
            ],
          },
        });
        
}
        
    } else {
      bot.sendMessage(
        userId,
        "Password must be at least 8 characters long. Please try again."
      );
        passwordInvalidRetryCreateAccount(msg, userId,  count + 1);
    }
 });
}


export async function handlePaymentSuccess(payload: string) {
  const payment = JSON.parse(payload);
  const { userId, amount } = payment;

  await runQuery(
    "UPDATE payments SET status = 'succeeded' WHERE user_id = ? AND amount = ?",
    [userId, amount]
  );

  bot.sendMessage(
    userId,
    `Payment successful! Please enter an 8-character or longer password to create your EOS account:`
  );
  
  // Listen for the password input
  bot.once("message", async (msg: Message) => {
    const password = msg.text;
    // Validate the password length
    if (password && password.length >= 8) {
        try {
          const result = await createEosAccount(
            userId,
            password,
            Number(process.env.EOS_ACCOUNT_PRICE)!
          );
          bot.sendMessage(
            userId,
            `Account create successfully!\nTransaction ID: https://bloks.io/transaction/${result.resolved?.transaction.id}`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "⬅️ Return wallets list",
                      callback_data: "wallets",
                    },
                  ],
                ],
              },
            }
          );
        } catch (error: unknown) {
          let errorMessage = "Unknown error";
          if (error instanceof Error) {
            errorMessage = error.message;
          }
          bot.sendMessage(
            userId!,
            `Error create EOS account: ${errorMessage}`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "⬅️ Return wallets list",
                      callback_data: "wallets",
                    },
                  ],
                ],
              },
            }
          );
        }
      
    } else {
      bot.sendMessage(
        userId,
        "Password must be at least 8 characters long. Please try again."
      );
      passwordInvalidRetryCreateAccount(msg, userId,  1);
    }
  });
}

export async function handlePaymentFailure(payload: string) {
  const payment = JSON.parse(payload);
  const { userId, amount } = payment;

  await runQuery(
    "UPDATE payments SET status = 'failed' WHERE user_id = ? AND amount = ?",
    [userId, amount]
  );

  bot.sendMessage(userId, "Your payment failed. Please try again.");
}


export async function handleOxaPayPayment(callbackQuery: CallbackQuery, XAPAY_API_KEY?: string) {

      const chatId = callbackQuery.message?.chat.id!;
      const userId = callbackQuery.from.id;

const eosPrice = await getEosPrice();
  const invoiceAmount = Math.ceil(
    eosPrice * Number(process.env.EOS_ACCOUNT_PRICE)
  ); // EOS price times 4, rounded up

  const paymentRequest = {
    merchant: XAPAY_API_KEY || "sandbox",
    amount: invoiceAmount,
    currency: "USDT",
    lifeTime: 30,
    feePaidByPayer: 1,
    underPaidCover: 0,
    description: "EOS Account Creation",
    callbackUrl: `${process.env.XAPAY_CALLBACK_URL}/oxaPayCallback?userid=${userId}`,
    returnUrl: `https://t.me/eos_wallet_bot`, // Redirect to your Telegram bot after successful payment
  };
 
  console.log("callbackurl", paymentRequest.callbackUrl);
  const response = await fetch("https://api.oxapay.com/merchants/request", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(paymentRequest),
  });

  const paymentData = await response.json();

  const {result, message, trackId, payLink} = paymentData;
  // Save the invoice in the database
  await runQuery(
    "INSERT INTO payments (user_id, amount, status, chat_id, type, track_id, pay_link) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, invoiceAmount, `${result}-${message}`, chatId, PAYMENT_TYPES[1], trackId, payLink]
  );
  

 
  if (result == 100) {
     bot.editMessageText(
       `Please complete your payment by clicking the link below:\n${paymentData.payLink}`,
       {
         chat_id: chatId,
         message_id: callbackQuery.message?.message_id,
         reply_markup: {
           inline_keyboard: [
             [{ text: "Complete Payment", url: paymentData.payLink }],
           ],
         },
       }
     );
    
  } else {
    bot.sendMessage(
      chatId,
      "Failed to initiate payment. Please try again later.",
      {
        reply_markup: {
          inline_keyboard: [[{ text: "❌ Close", callback_data: "close" }]],
        },
      }
    );
  }
}

export async function handleOxaPayPaymentSuccess(userId: number, merchant?: string) {

try {

  const payments = await runQuery(
    "SELECT track_id, status FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 1",
    [userId]
  );
  console.log("payments", payments);
    
  // Check payment status
  if (payments[0].status === "succeeded") {
    bot.sendMessage(
      userId,
      `Payment successful! Please enter an 8-character or longer password to create your EOS account:`
    );

    bot.once("message", async (msg: Message) => {
      const password = msg.text;

      if (password && password.length >= 8) {
        try {
          const result = await createEosAccount(
            userId,
            password,
            Number(process.env.EOS_ACCOUNT_PRICE)!
          );
          bot.sendMessage(
            userId,
            `Account create successfully!\nTransaction ID: https://bloks.io/transaction/${result.resolved?.transaction.id}`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "⬅️ Return wallets list",
                      callback_data: "wallets",
                    },
                  ],
                ],
              },
            }
          );
        } catch (error: unknown) {
          let errorMessage = "Unknown error";
          if (error instanceof Error) {
            errorMessage = error.message;
             
          }
          bot.sendMessage(
            userId!,
            `Error create EOS account: ${errorMessage}`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "⬅️ Return wallets list",
                      callback_data: "wallets",
                    },
                  ],
                ],
              },
            }
          );
        }
      } else {
        bot.sendMessage(
          userId,
          "Password must be at least 8 characters long. Please try again."
        );
        passwordInvalidRetryCreateAccount(msg, userId, 1);
      }
    });
  } else {
    bot.sendMessage(
      userId,
      "Payment not completed. Please complete the payment to proceed."
    );
  }
} catch (error: unknown) {
     let errorMessage = "Unknown error";
     if (error instanceof Error) {
       errorMessage = error.message;
     }
    bot.sendMessage(userId, `Error verifying payment: ${errorMessage}`);
}

  
}