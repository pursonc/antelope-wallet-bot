export type RAMLimitOrderMessage = {
  type: "buyRamBytes";
  userId: number;
  recipient: string;
  bytes: number;
  orderId: number;
};

export type RAMLimitOrderResultMessage = {
  type: "buyRamBytesResult";
  result: any;
  orderId: number;
};

export const PAYMENT_TYPES = ["credit", "crypto"];