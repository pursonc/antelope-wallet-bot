import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { handleOxaPayPaymentSuccess } from "./handlers/callbackQueryHandler";
import dotenv from "dotenv";
// Load environment variables
dotenv.config();
const app = express();
const PORT = 3000;
const XAPAY_API_KEY = process.env.XAPAY_API_KEY;
if (!XAPAY_API_KEY) {
  throw new Error("No 0xaPay token ");
}

app.use(bodyParser.json());

app.post("/oxaPayCallback", async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const { status } = req.body;

  if (status === "paid") {
    await handleOxaPayPaymentSuccess(Number(userId), XAPAY_API_KEY);
    res.status(200).send("Payment processed successfully.");
  } else {
    res.status(400).send("Payment failed or pending.");
  }
});

app.listen(PORT, () => {
  console.log(`Callback server running on port ${PORT}`);
});
