# EOS MOMMMY BOT

## 1. Apply the telegram bot key from https://t.me/BotFather


## 2. Set up Node.js Enviroment

Nodejs v20.11.0


```
yarn
 
yarn build && yarn start

# run ramOrderProcessor
yarn start-ram-processor
 
# or 

yarn dev

https://t.me/eos_mommmy_bot
```


## 3. account create contract

https://github.com/cppfuns/signdappplay


## Others

```
# delete the db files in history
git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch useruser_data.db' --prune-empty --tag-name-filter cat -- --all

git reflog expire --expire=now --all
git gc --prune=now --aggressive

git push --force --all

```