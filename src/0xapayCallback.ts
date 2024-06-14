import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import net from "net";
import { xaPayCallbackMessage } from "./types";



const app = express();
const PORT = 3000;


app.use(bodyParser.json());

app.get("/oxaPayCallback", async (req: Request, res: Response) => {
  const userId = req.query.userId as string;

 try {
    
const client = new net.Socket();
   client.connect(9527, "localhost", () => {
     console.log("Connected to EOS server");

     client.on("data", async (data) => {
       const message = JSON.parse(data.toString());
       if (message.type === "0xaPayCallbackResult") {
         console.log(`Received 0xaPayCallback result:`, message.result);

        //  const transactionId = message.result.resolved?.transaction.id;
        //  await runQuery(
        //    "UPDATE ram_orders SET order_status = 'success', trigger_date = datetime('now'), transaction_id = ? WHERE order_id = ?",
        //    [transactionId, message.orderId]
        //  );
        res.status(200).send("Payment processed successfully.");
       }
     });

     client.on("error", (err) => {
       console.error("Client connection error:", err);
     });

     const message: xaPayCallbackMessage = {
       type: "0xaPayCallback",
       userId: Number(userId),
     };
    
     client.write(JSON.stringify(message));

    });
} catch (error) {
    res.status(400).send("Payment failed or pending."+error);
  }
}

);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Callback server running on port ${PORT}`);
});
