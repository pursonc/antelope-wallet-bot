import { getEosRamPrice} from "./utils";
import { runQuery  } from "./db";
import { buyRamBytes } from "./eos";


async function processRamOrders() {
  console.log("Checking RAM orders...");
  try {
    const eosRamPrice = await getEosRamPrice();

    const orders = await runQuery(
      "SELECT * FROM ram_orders WHERE order_status = 'pending' AND price_per_kb >= ?",
      [eosRamPrice]
    );

    for (const order of orders) {
      try {
        const result = await buyRamBytes(
          order.user_id,
          order.eos_account_name,
          order.ram_bytes
        );
        console.log(result.resolved?.transaction.id);
        const transactionId = result.resolved?.transaction.id;
        await runQuery(
          "UPDATE ram_orders SET order_status = 'success', trigger_date = datetime('now'), transaction_id = ? WHERE order_id = ?",
          [transactionId, order.order_id]
        );
      } catch (error: unknown) {
        let failureReason = "Unknown error";
        if (error instanceof Error) {
          failureReason = error.message;
        }
        await runQuery(
          "UPDATE ram_orders SET order_status = 'failed', trigger_date = datetime('now'), failure_reason = ? WHERE order_id = ?",
          [failureReason, order.order_id]
        );
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
