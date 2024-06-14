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
  handleStripePayment
} from "./handlers";


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
        await handleStripePayment(callbackQuery, PROVIDER_TOKEN, BOT_TOKEN);
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
