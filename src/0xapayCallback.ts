import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import net from "net";
import { xaPayCallbackMessage } from "./types";

const app = express();
const PORT = 3000;
const client = new net.Socket();

app.use(bodyParser.json());

app.post("/oxaPayCallback", async (req: Request, res: Response) => {
  const userId = req.query.userId;
  console.log("Received 0xaPayCallback for user:", userId);

  if(!userId) return res.status(400).send("User ID is required.");

  try {
    
    client.connect(9527, "localhost", () => {
      console.log("Connected to Socket server");

      client.on("data", async (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "0xaPayCallbackResult") {
          console.log(`Received 0xaPayCallback result:`, message.result);
          if (message.result == "succeeded")
            res.status(200).send("Payment processed successfully.");
        }
      });

      client.on("error", (err) => {
        console.error("Client connection error:", err);
        res.status(400).send(`Client connection error:${err}`);
      });

      const message: xaPayCallbackMessage = {
        type: "0xaPayCallback",
        userId: Number(userId),
      };

      client.write(JSON.stringify(message));
    });
  } catch (error) {
    res.status(400).send("Payment failed or pending." + error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Callback server running on port ${PORT}`);
});
