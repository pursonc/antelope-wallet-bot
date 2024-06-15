import TelegramBot, { CallbackQuery } from "node-telegram-bot-api";
import dotenv from "dotenv";
import {
  handleStart,
  handleSelectAccount,
  handleRAMOrderPage,
  handleWallets,
  handleImportAccount,
  handleCreateAccountContract,
  handleAccountOrderStatus,
  handleAccountOrders,
  handleActivateAccount,
  handleDeleteAccount,
  handleViewAccountOrders,
  handleProfile,
  handleTransferEOS,
  handleBuyRAM,
  handleClose,
  handleRAMOrder,
  handleViewRAMOrders,
  handleClearRAMOrders,
  handleConfirmDeleteAccount,
  handleAuthorizeUser,
  handleConfirmAuthorization,
  handleDeleteAccountOrders,
  handlePaymentFailure,
  handlePaymentSuccess,
  handleStripePayment,
  handleOxaPayPaymentSuccess
} from "./handlers";

import { RAMLimitOrderResultMessage, RAMLimitOrderMessage, xaPayCallbackResultMessage } from "./types";
import net from "net";
import { buyRamBytes } from "./eos";
import { runQuery } from "./db";
import { handleOxaPayPayment } from "./handlers/callbackQueryHandler";
const SOCKET_PORT = 9527;

// Load environment variables
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("No Telegram Bot Token found in environment variables");
}
const PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN;
if (!PROVIDER_TOKEN) {
  console.log("No Stripe provider token from BotFather");
}
const XAPAY_API_KEY = process.env.XAPAY_API_KEY;
if (!XAPAY_API_KEY) {
  console.log("No 0xaPay token ");
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("Bot server started...");

bot.onText(/\/start/, handleStart);

bot.on("callback_query", async (callbackQuery: CallbackQuery) => {
  const chatId = callbackQuery.message?.chat.id;
  const userId = callbackQuery.from.id;
  if (callbackQuery.data && callbackQuery.data.startsWith("select_account:")) {
     await handleSelectAccount(callbackQuery);
  }

  if (callbackQuery.data && callbackQuery.data.startsWith("view_ram_orders:")) {
     await handleRAMOrderPage(callbackQuery);
  }

  if (callbackQuery.data && callbackQuery.data?.startsWith("authorize:")) {
    await handleConfirmAuthorization(callbackQuery);
    return;
  }

  if (callbackQuery.data === "authorize_user") {
    await handleAuthorizeUser(callbackQuery);
    return;
  }

  try {
    switch (callbackQuery.data) {
      case "wallets":
        await handleWallets(callbackQuery);
        break;

      case "import_account":
        await handleImportAccount(callbackQuery);
        break;

      case "create_account_contract":
        await handleCreateAccountContract(callbackQuery);
        break;

      case "orders":
        await handleAccountOrders(callbackQuery);
        break;

      case "activate_account":
        await handleActivateAccount(callbackQuery);
        break;

      case "delete_order":
        await handleDeleteAccountOrders(callbackQuery);
        break;

      case "view_order":
        await handleViewAccountOrders(callbackQuery);
        break;

      case "profile":
        await handleProfile(callbackQuery);
        break;

      case "order_status":
        await handleAccountOrderStatus(callbackQuery);
        break;

      case "transfer_eos":
        await handleTransferEOS(callbackQuery);
        break;

      case "buy_ram":
        await handleBuyRAM(callbackQuery);
        break;

      case "delete":
        await handleDeleteAccount(callbackQuery);
        break;

      case "confirm_delete_account":
        await handleConfirmDeleteAccount(callbackQuery);
        break;

      case "close":
        await handleClose(callbackQuery);
        break;

      case "ram_order":
        await handleRAMOrder(callbackQuery);
        break;

      case "view_ram_orders":
        await handleViewRAMOrders(callbackQuery);
        break;

      case "clear_ram_orders":
        await handleClearRAMOrders(callbackQuery);
        break;

      case "pay_for_account_by_card":
        await handleStripePayment(callbackQuery, PROVIDER_TOKEN, BOT_TOKEN);
        break;

      case "pay_for_account_by_crypto":
        await handleOxaPayPayment(callbackQuery, XAPAY_API_KEY);
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
  if (String(error).indexOf("EFATAL") > -1) {
    setTimeout(() => {
      bot.startPolling(); // Restart polling
    }, 5000); // Retry after 5 seconds
  }
});

bot.on("pre_checkout_query", (query) => {
  bot.answerPreCheckoutQuery(query.id, true);
});

bot.on("successful_payment", async (msg: any) => {
  await handlePaymentSuccess(msg.successful_payment.invoice_payload);
});

bot.on("payment_failed", async (msg) => {
  await handlePaymentFailure(msg.failed_payment.invoice_payload);
});

export default bot;

// Create a TCP server for RAM limit order & 0xapay callbacks
const server = net.createServer((socket) => {
  try {
    socket.on("data", async (data) => {
      const message: RAMLimitOrderMessage = JSON.parse(data.toString());

      if (message.type === "buyRamBytes") {
        const { userId, recipient, bytes, orderId } = message;
        try {
          const result = await buyRamBytes(userId, recipient, bytes);

          const response: RAMLimitOrderResultMessage = {
            type: "buyRamBytesResult",
            result,
            orderId,
          };

          socket.write(JSON.stringify(response));
        } catch (error: unknown) {
          let failureReason = "Unknown error";
          if (error instanceof Error) {
            failureReason = error.message;
          }
          await runQuery(
            "UPDATE ram_orders SET order_status = 'failed', trigger_date = datetime('now'), failure_reason = ? WHERE order_id = ?",
            [failureReason, orderId]
          );
        }
      } else if (message.type === "0xaPayCallback") {
        // console.log(message);
        const { userId } = message;
        try {
          const payments = await runQuery(
            "SELECT track_id, pay_link FROM payments WHERE user_id = ? AND status != 'succeeded' ORDER BY id DESC LIMIT 1",
            [userId]
          );

          if (payments.length === 0) {
            bot.sendMessage(userId, `Payment Invalid.`);
          }

          // Query payment information using the trackId
          const response = await fetch(
            `https://api.oxapay.com/merchants/inquiry`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                merchant: XAPAY_API_KEY,
                trackId: payments[0].track_id,
              }),
            }
          );
          const result = await response.json();

          if (result.status == "Paid") {
            await runQuery(
              "UPDATE payments SET status = 'succeeded' WHERE user_id = ?",
              [userId]
            );
            await handleOxaPayPaymentSuccess(userId, XAPAY_API_KEY);
          } else if (result.status == "New" || result.status == "Waiting") {
            bot.sendMessage(
              userId,
              `Please complete your payment by clicking the link below:\n${payments.pay_link}`,
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "Complete Payment", url: payments.pay_link }],
                  ],
                },
              }
            );
          } else {
            bot.sendMessage(userId, `Payment ${result.status}.`);
          }

          const cb_response: xaPayCallbackResultMessage = {
            type: "0xaPayCallbackResult",
            result: result.status,
          };

          socket.write(JSON.stringify(cb_response));
        } catch (error: unknown) {
          let failureReason = "Unknown error";
          if (error instanceof Error) {
            failureReason = error.message;
          }
        }
      }
    });
  } catch (error) {
    let failureReason = "Unknown error";
    if (error instanceof Error) {
      failureReason = error.message;
      console.log(failureReason);
    }
  }
  


  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

server.listen(SOCKET_PORT, "0.0.0.0", () => {
  console.log("EOS socket is listening on port " + SOCKET_PORT);
});


