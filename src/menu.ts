export const START_MENU = [
              [{ text: "🐵 Profile", callback_data: "profile" }],
              [{ text: "💳 Wallets", callback_data: "wallets" }],
              [{ text: "📦 Transfer EOS", callback_data: "transfer_eos" }],
              [{ text: "❌ Close", callback_data: "close" }],
            ];

export const WALLET_MENU = [
  [{ text: "Import Account", callback_data: "import_account" }],
  [
    {
      text: "Create Account (Contract)",
      callback_data: "create_account_contract",
    },
  ],
  [
    {
      text: "Create Account (Auto)",
      callback_data: "create_account_auto",
    },
  ],
];