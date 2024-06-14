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

      bot.sendMessage(msg.chat.id, welcomeMessage, {
        reply_markup: {
          inline_keyboard: START_MENU,
        },
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
}
