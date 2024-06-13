import { APIClient, PrivateKey, PublicKey } from "@wharfkit/antelope";
import { Session } from "@wharfkit/session";
import { WalletPluginPrivateKey } from "@wharfkit/wallet-plugin-privatekey";
import crypto from "crypto";
import { runQuery, getQuery } from "./db";
import TelegramBot from "node-telegram-bot-api";
import { sendWalletOptions, selectFastestEndpoint } from "./utils";



// Ensure the createClient function uses node-fetch
async function createClient() {
  const fastestEndpoint = await selectFastestEndpoint();
    const client = new APIClient({
    url: fastestEndpoint,
    });
    return client;
}

const clientPromise = createClient();

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

function generateKeyFromUserId(userId: number): Buffer {
  return crypto.createHash("sha256").update(userId.toString()).digest();
}

export function encrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text: string, userId: number): string {
  const key = generateKeyFromUserId(userId);
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift()!, "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export async function createEosAccount(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  method: "contract" | "auto"
) {
  try {
    const eosAccountName = await generateEosAccountName();
    if (method === "contract") {
      bot.sendMessage(
        chatId,
        `To create an EOS account, transfer the required amount to the following contract with the specified memo:\nContract: example_contract\nMemo: ${eosAccountName}`
      );
      return;
    } else {
      const { privateKey, publicKey } = generateEosKeyPair();
      const encryptedPrivateKey = encrypt(privateKey, userId);
      await runQuery(
        "UPDATE users SET eos_account_name = ?, eos_public_key = ?, eos_private_key = ? WHERE user_id = ?",
        [eosAccountName, publicKey, encryptedPrivateKey, userId]
      );
      bot.sendMessage(
        chatId,
        `Account created successfully!\n\n🔹 EOS Account Name: ${eosAccountName}\n🔹 EOS Public Key: ${publicKey}`
      );
    }
  } catch (error) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    bot.sendMessage(chatId, `Error creating EOS account: ${errorMessage}`);
    sendWalletOptions(bot, chatId, "Returning to wallet options...");
  }
}

export async function importEosAccount(eosPrivateKey: string, userId: number) {
  try {
    const privateKey = PrivateKey.from(eosPrivateKey);
    const publicKey = privateKey.toPublic().toString();
    const encryptedPrivateKey = encrypt(eosPrivateKey, userId);

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

    return { publicKey, encryptedPrivateKey, accounts };
  } catch (error: unknown) {
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    }
   throw new Error("Error importing EOS account: ${errorMessage}");

  }
}

 

export async function transferEos(
  userId: number,
  recipient: string,
  amount: number,
  memo: string
): Promise<any> {
  const user = await getQuery(
    "SELECT eos_private_key, permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );
  const privateKey = decrypt(user.eos_private_key, userId);
  

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
  const user = await getQuery(
    "SELECT eos_private_key, permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );
  const privateKey = decrypt(user.eos_private_key, userId);

  const session = new Session({
    chain: {
      id: "aca376f206b8fc25a6ed44dbdc66547c36c6c33e3a119ffbeaef943642f0e906",
      url: "https://eos.greymass.com",
    },
    actor: user.eos_account_name,
    permission: user.permission_name,
    walletPlugin: new WalletPluginPrivateKey(privateKey),
  });
console.log(`bytes: ${bytes}`)
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
  const user = await getQuery(
    "SELECT eos_private_key, permission_name, eos_account_name FROM users WHERE user_id = ?",
    [userId]
  );
  const privateKey = decrypt(user.eos_private_key, userId);

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

