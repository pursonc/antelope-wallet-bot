import { APIClient, PrivateKey, PublicKey } from "@wharfkit/antelope";
import { Session } from "@wharfkit/session";
import { WalletPluginPrivateKey } from "@wharfkit/wallet-plugin-privatekey";
import crypto from "crypto";
import { runQuery, getQuery } from "./db";
import {selectFastestEndpoint } from "./utils";
import { fork } from "child_process";
import path from "path";
import { RAMLimitOrderMessage } from "./types";


// Ensure the createClient function uses node-fetch
async function createClient() {
  const fastestEndpoint = await selectFastestEndpoint();
    const client = new APIClient({
    url: fastestEndpoint,
    });
    return client;
}

const clientPromise = createClient();
const sessionStore: {
  [userId: number]: { privateKey: string; expiresAt: number };
} = {};

export async function generateEosAccountName(): Promise<string> {
  const characters = "abcdefghijklmnopqrstuvwxyz12345";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

export function generateEosKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const privateKey = PrivateKey.generate("K1"); // Using 'K1' curve
  const publicKey = privateKey.toPublic().toString();
  const lPubKey = PublicKey.from(publicKey);
  return {
    privateKey: privateKey.toWif(),
    publicKey: lPubKey.toLegacyString(),
  };
}

function generateKeyFromPassword(password: string): Buffer {
  return crypto.createHash("sha256").update(password).digest();
}

export function encrypt(text: string, password: string): string {
  const key = generateKeyFromPassword(password);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string, password: string): string {
  try {
     const key = generateKeyFromPassword(password);
     const textParts = text.split(":");
     const iv = Buffer.from(textParts.shift()!, "hex");
     const encryptedText = Buffer.from(textParts.join(":"), "hex");
     const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
     let decrypted = decipher.update(encryptedText);
     decrypted = Buffer.concat([decrypted, decipher.final()]);
     return decrypted.toString();
  } catch (error) {
    console.error("Error decrypting text:", error);
    return "";
  }
 
}

export async function getSessionExpirationTime(userId: number): Promise<{
  days: number;
  hours: number;
  minutes: number;
  timestamp: number;
}> {
  const user = await getQuery(
    "SELECT session_expiration FROM users WHERE user_id = ?",
    [userId]
  );

  if (!user || !user.session_expiration) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      timestamp: 0,
    };
  }
  const sessionExpiration = new Date(user.session_expiration).getTime() / 1000; // Convert to seconds
  const currentTime = Math.floor(new Date().getTime() / 1000); // Current time in seconds
  const remainingTime = sessionExpiration - currentTime;

  if (remainingTime <= 0) {
    return {
      days: 0,
      hours: 0,
      minutes: 0,
      timestamp: 0,
    };
  }
  // console.log(`currentTime ${currentTime} remainingTime ${remainingTime}`);

  const days = Math.floor(remainingTime / (24 * 3600));
  const hours = Math.floor((remainingTime % (24 * 3600)) / 3600);
  const minutes = Math.floor((remainingTime % 3600) / 60);

  // console.log(
  //   `Session expires in ${days} days, ${hours} hours, ${minutes} minutes`
  // );
  return {
    days,
    hours,
    minutes,
    timestamp: sessionExpiration,
  };
}



export async function authorizeUser(
  userId: number,
  password: string,
  duration: number
) {
  const expirationTimestamp = Date.now() + duration * 60 * 60 * 1000;
  const expirationDate = new Date(expirationTimestamp);
  await runQuery(
    "UPDATE users SET session_password = ?, session_expiration = ? WHERE user_id = ?",
    [encrypt(password, password), expirationDate.toISOString(), userId]
  );
  const user = await getQuery(
    "SELECT eos_account_name, eos_public_key, eos_private_key, session_expiration FROM users WHERE user_id = ?",
    [userId]
  );
  const decrypedPrivate = decrypt(user.eos_private_key, password);
  sessionStore[userId] = {
    privateKey: decrypedPrivate,
    expiresAt: expirationTimestamp,
  };
  console.log(`User ${userId} authorized until ${expirationDate}`);
}

export async function isSessionActive(userId: number): Promise<boolean> {
  const session = sessionStore[userId];
  const user = await getQuery(
    "SELECT session_expiration FROM users WHERE user_id = ?",
    [userId]
  );
  if (!user || !user.session_expiration || !session || session.expiresAt <= Date.now()) return false;
  return new Date(user.session_expiration) > new Date();
}


export async function importEosAccount(
  eosPrivateKey: string,
  password: string
) {
  try {
    if (password.length !== 8) {
      throw new Error("The encryption password must be 8 characters long.");
    }

    const privateKey = PrivateKey.from(eosPrivateKey);
    const publicKey = privateKey.toPublic().toString();
    const lPubKey = PublicKey.from(publicKey);
    const encryptedPrivateKey = encrypt(eosPrivateKey, password);

    // Use WharfKit to get the account name associated with the private key
    const client = await clientPromise;
    const response = await client.v1.chain.get_accounts_by_authorizers({
      keys: [publicKey],
    });

    if (!response || !response.accounts || !response.accounts.length) {
      throw new Error("No account found for this private key.");
    }

    const accounts = response.accounts.map((account) => ({
      accountName: account.account_name,
      permissionName: account.permission_name,
    }));

    return { publicKey: lPubKey.toLegacyString(), encryptedPrivateKey, accounts };
  } catch (error: unknown) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    throw new Error(`Error importing EOS account: ${errorMessage}`);
  }
}

export async function getSessionPrivateKey(userId: number): Promise<string> {
  const session = sessionStore[userId];
  if (!session || session.expiresAt <= Date.now()) {
    await runQuery(
      "UPDATE users SET session_password = ?, session_expiration = ? WHERE user_id = ?",
      ["", "", userId]
    );
    console.log("Session expired or not found.");
    return '';
  }
  return session.privateKey;
}

 

export async function transferEos(
  userId: number,
  recipient: string,
  amount: number,
  memo: string
): Promise<any> {
  if (!isSessionActive(userId)) {
    throw new Error("Session expired. Please reauthorize.");
  }

  const privateKey = await getSessionPrivateKey(userId);

  const user = await getQuery(
    "SELECT permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );

  const session = new Session({
    chain: {
      id: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
      url: "https://eos.greymass.com",
    },
    actor: user.eos_account_name,
    permission: user.permission_name,
    walletPlugin: new WalletPluginPrivateKey(privateKey),
  });

  const actions = [
    {
      account: "eosio.token",
      name: "transfer",
      authorization: [
        {
          actor: user.eos_account_name,
          permission: user.permission_name,
        },
      ],
      data: {
        from: user.eos_account_name,
        to: recipient,
        quantity: `${amount.toFixed(4)} EOS`,
        memo: memo,
      },
    },
  ];

  const result = await session.transact({ actions }, { broadcast: true });
  return result;
}

export async function buyRamBytes(
  userId: number,
  recipient: string,
  bytes: number
): Promise<any> {
  if (!isSessionActive(userId)) {
    throw new Error("Session expired. Please reauthorize.");
  }

  const privateKey = await getSessionPrivateKey(userId);

  const user = await getQuery(
    "SELECT permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );

  const session = new Session({
    chain: {
      id: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
      url: "https://eos.greymass.com",
    },
    actor: user.eos_account_name,
    permission: user.permission_name,
    walletPlugin: new WalletPluginPrivateKey(privateKey),
  });

  const result = await session.transact({
    actions: [
      {
        account: "eosio",
        name: "buyrambytes",
        authorization: [
          {
            actor: user.eos_account_name,
            permission: user.permission_name,
          },
        ],
        data: {
          payer: user.eos_account_name,
          receiver: recipient,
          bytes,
        },
      },
    ],
  });

  return result;
}

export async function buyRam(
  userId: number,
  recipient: string,
  amount: number
): Promise<any> {
  if (!isSessionActive(userId)) {
    throw new Error("Session expired. Please reauthorize.");
  }

  const privateKey = await getSessionPrivateKey(userId);

  const user = await getQuery(
    "SELECT permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );

  const session = new Session({
    chain: {
      id: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
      url: "https://eos.greymass.com",
    },
    actor: user.eos_account_name,
    permission: user.permission_name,
    walletPlugin: new WalletPluginPrivateKey(privateKey),
  });

  const result = await session.transact({
    actions: [
      {
        account: "eosio",
        name: "buyram",
        authorization: [
          {
            actor: user.eos_account_name,
            permission: user.permission_name,
          },
        ],
        data: {
          payer: user.eos_account_name,
          receiver: recipient,
          quant: `${amount.toFixed(4)} EOS`,
        },
      },
    ],
  });

  return result;
}

process.setMaxListeners(20);

// Fork the child process for RAM order processing
const ramOrderProcessor = fork(path.join(__dirname, 'ramOrderProcessor.js'));

// Handle messages from the RAM order processor
ramOrderProcessor.on("message", async (message: RAMLimitOrderMessage) => {
  console.log("Received message from RAM order processor:", message)
  if (message.type === "buyRamBytes") {
    const { userId, recipient, bytes, orderId } = message;
   
    try {
       const result = await buyRamBytes(userId, recipient, bytes);

       ramOrderProcessor.send({ type: "buyRamBytesResult", result, orderId });

    } catch (error: unknown) {

      let failureReason = "Unknown error";
      if (error instanceof Error) {
        failureReason = error.message;
      }
      await runQuery(
        "UPDATE ram_orders SET order_status = 'failed', trigger_date = datetime('now'), failure_reason = ? WHERE order_id = ?",
        [failureReason, orderId]
      );
    }

    
  }
});