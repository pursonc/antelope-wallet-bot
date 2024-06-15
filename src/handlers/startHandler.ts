import { Message } from "node-telegram-bot-api";
import { runQuery } from "../db";
import { isAllowed } from "../rateLimiter";
import { getEosPrice, getEosRamPrice } from "../utils";
import { START_MENU } from "../menu";
import bot from "../bot";

export async function handleStart(msg: Message) {
  const userId = msg.from!.id;
  const username = msg.from!.username;
  const firstName = msg.from!.first_name;
  const lastName = msg.from!.last_name;
  const chatType = msg.chat.type;
 const chatId = msg.chat.id;

if (chatType === "group" || chatType === "supergroup") {
  bot.sendMessage(
    chatId,
    "This bot does not support group operations. Please use the bot in a private chat."
  );
  return;
}  

  try {
    await runQuery(
      "INSERT OR IGNORE INTO users (user_id, username, first_name, last_name) VALUES (?, ?, ?, ?)",
      [userId, username, firstName, lastName]
    );

    const { allowed, waitTime } = isAllowed(userId);
    if (allowed) {
      const eosPrice = await getEosPrice();
      const eosRamPrice = await getEosRamPrice();
      let welcomeMessage = `
        EOS Bot: Your Gateway to EOS 🤖

🔹 EOS: $${eosPrice}
🔹 RAM: ${eosRamPrice} EOS/kb
🔹 [TG Group](https://t.me/+FW4raomd1aY1YWI1) | [GitHub](https://github.com/pursonchen/eos-wallet-bot)`;

      bot.sendMessage(chatId, welcomeMessage, {
        disable_web_page_preview: true,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: START_MENU,
        },
      });
    } else {
      bot.sendMessage(
        chatId,
        `Rate limit exceeded. Please try again after ${
          waitTime / 1000
        } seconds.`
      );
    }
  } catch (error: unknown) {
    console.error("Database error:", error);
  }
}
