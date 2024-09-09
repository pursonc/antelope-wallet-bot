# TELEGRAM Antelope WALLET BOT 🤖️
### The current private key encryption scheme is very weak and only suitable for small-capital testing. Welcome to submit PR.

[Telegram Group](https://t.me/+FW4raomd1aY1YWI1) | [Antelope WALLET BOT](https://t.me/Antelope_wallet_bot)

## Features
### Security Model

- The private key is stored in the local database in the form of a keystore and can only be unlocked by the user.
- The keyless transaction period is a minimum of 1 hour and a maximum of 7 days.
- TBD: Establish a risk fund account to compensate users in case of asset loss, with the source of funds coming from users buying accounts, community donations, and the author himself.
- The code is open-source, and a bug bounty program is established.

### Resource Sharing

- Use the Wharf Resorce Provider
- TODO: The author provides an Antelope account to create new accounts and co-sign each transaction for the user, sharing CPU and NET resources.
- TODO: When users operate the wallet to transfer funds, buy RAM, or purchase accounts, an action is taken to power up the author's Antelope account. The more people use it, the more resources are available to the overall wallet users.

### Wallet Features

- Provides options to purchase Antelope accounts via credit card or cryptocurrency.
- Provides a RAM order book purchase function.




## Set UP


1. Apply the telegram bot key from [@BotFather](https://t.me/BotFather)

```js
// .env

TELEGRAM_BOT_TOKEN=your-telegram-bot-token

```
2. Set up Node.js Enviroment

 - Nodejs v20.11.0
 - [Wharfkit](https://wharfkit.com/)

3. Apply Payment Provider And bind [@BotFather](https://t.me/BotFather) (optional)

    Supported Payment Providers:
- [Stripe](https://stripe.com/)
- [Smart Glocal](https://smart-glocal.com/)
- [Unlimint](https://www.unlimint.com/)
- [Tranzzo](https://tranzzo.com/)
- [Paykassma](https://paykassma.com/telegram)
- [YooMoney](https://yoomoney.ru/)
- [Sberbank](https://www.sberbank.ru/)
- [PSB](https://www.psbank.ru/Business/Acquiring/Internet)
- [Bank 131](https://developer.131.ru/ru/)
- [Payme](https://payme.uz/)
- [CLICK](http://click.uz/)
- [LiqPay](https://www.liqpay.ua/uk/)
- [LeoGaming](https://leogaming.net/ua/telegram)
- [Cascad](https://cascad.com/)
- [Portmone](https://www.portmone.com.ua/)
- [Paymega](https://paymega.io/)
- [ECOMMPAY](https://ecommpay.com/)
- [PayMaster](https://info.paymaster.ru/)
- [Global Pay UZ](https://gate.global.uz/)
- [iPay88](https://ipay88.com.kh/)
- [PayBox.money](https://paybox.money/)
- [Freedom Pay](https://freedompay.money/)
- [bill_line](https://billline.net/)
- [Chapa](https://chapa.co/)

more infomation about telegram payment : https://core.telegram.org/bots/payments



```js
// .env

PAYMENT_PROVIDER_TOKEN=your-payment-gateway-token-or-key

```

4. Apply [OxaPay](https://oxapay.com/) For Crypto Payment  (optional)
```js
// .env

XAPAY_API_KEY=your-0xapay-key
XAPAY_CALLBACK_URL=https://your-callback-server

```
5. Start the bot
```
yarn
 
yarn build 
yarn start  && yarn start-ram-order-processor 
&& yarn start-0xapay-callback

```

## Others

```
# delete the db files in history
git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch useruser_data.db' --prune-empty --tag-name-filter cat -- --all

git reflog expire --expire=now --all
git gc --prune=now --aggressive

git push --force --all

```
