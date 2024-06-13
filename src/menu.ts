export const START_MENU = [
  [{ text: "🐵 Profile", callback_data: "profile" }],
  [{ text: "👛 Wallets", callback_data: "wallets" }],
  [{ text: "❌ Close", callback_data: "close" }],
];


export const WALLET_MENU_WITH_ACCOUNT = [
  [{ text: "💠 Buy RAM", callback_data: "buy_ram" }],
  [{ text: "⏳ Create Buy RAM Limit Order", callback_data: "ram_order" }],
  [{ text: "💸 Transfer EOS", callback_data: "transfer_eos" }],
  [{ text: "🗑️ Delete Account", callback_data: "delete" }],
  [{ text: "❌ Close", callback_data: "close" }],
];


export const WALLET_MENU_NO_ACCOUNT = [
  [{ text: "🔑 Import Account", callback_data: "import_account" }],
  [
    {
      text: "💁🏻‍♂️ Create Account (Contract)",
      callback_data: "create_account_contract",
    },
  ],
  [{ text: "❌ Close", callback_data: "close" }],
];
