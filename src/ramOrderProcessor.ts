import { getEosRamPrice} from "./utils";
import { runQuery  } from "./db";
import net from "net";
import { RAMLimitOrderMessage } from "./types";


// Function to process RAM orders
async function processRamOrders() {
  const client = new net.Socket();

  client.connect(9527, "localhost", () => {
    console.log("Connected to EOS server");

    client.on("data", async (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "buyRamBytesResult") {
        console.log(`Received buyRamBytes result:`, message.result);

        const transactionId = message.result.resolved?.transaction.id;
        await runQuery(
          "UPDATE ram_orders SET order_status = 'success', trigger_date = datetime('now'), transaction_id = ? WHERE order_id = ?",
          [transactionId, message.orderId]
        );
      }
    });

    client.on("error", (err) => {
      console.error("Client connection error:", err);
    });
  });

  try {
    const eosRamPrice = await getEosRamPrice();

    const orders = await runQuery(
      "SELECT * FROM ram_orders WHERE order_status = 'pending' AND price_per_kb >= ?",
      [eosRamPrice]
    );

    for (const order of orders) {
      const message: RAMLimitOrderMessage = {
        type: "buyRamBytes",
        userId: order.user_id,
        recipient: order.eos_account_name,
        bytes: order.ram_bytes,
        orderId: order.order_id,
      };

      client.write(JSON.stringify(message));
    }
  } catch (error) {
    console.error("Error checking RAM prices:", error);
  }
}

// Set interval to process RAM orders every minute
setInterval(async () => {
  await processRamOrders();
}, 60000);
