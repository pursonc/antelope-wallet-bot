import { getEosRamPrice} from "./utils";
import { runQuery  } from "./db";

import { RAMLimitOrderResultMessage } from "./types";


async function processRamOrders() {
  process.on("message", async (message: RAMLimitOrderResultMessage) => {
    if (message.type === "buyRamBytesResult") {
      console.log(`Received buyRamBytes result:`, message.result);
               
      const transactionId = message.result.resolved?.transaction.id;
      await runQuery(
        "UPDATE ram_orders SET order_status = 'success', trigger_date = datetime('now'), transaction_id = ? WHERE order_id = ?",
        [transactionId, message.orderId]
      );
    }
  });
  try {
    const eosRamPrice = await getEosRamPrice();

    const orders = await runQuery(
      "SELECT * FROM ram_orders WHERE order_status = 'pending' AND price_per_kb >= ?",
      [eosRamPrice]
    );

    for (const order of orders) {
        if (process.send) {
        process.send({
          type: "buyRamBytes",
          userId: order.user_id,
          recipient: order.eos_account_name,
          bytes: order.ram_bytes,
        });
      } else {
        console.error("process.send is undefined. Cannot send message.");
      }
       
    }
  } catch (error) {
    console.error("Error checking RAM prices:", error);
  }
}

// Set interval to process RAM orders every minute
setInterval(async () => {
  await processRamOrders();
}, 60000);
