import sqlite3 from "sqlite3";

// Open the database
const db = new sqlite3.Database("./user_data.db", (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to the SQLite database.");
  }
});

// Ensure the 'users' table is created on startup
db.run(
  `
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        eos_account_name TEXT,
        eos_public_key TEXT,
        eos_private_key TEXT,
        permission_name TEXT,
        session_password TEXT,
        session_expiration INTEGER
    )
`,
  (err) => {
    if (err) {
      console.error("Error creating table:", err.message);
    } else {
      console.log("Users table created or already exists.");
    }
  }
);

// Ensure the 'account_orders' table is created on startup
db.run(
  `
    CREATE TABLE IF NOT EXISTS account_orders (
        order_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        eos_account_name TEXT,
        eos_public_key TEXT,
        eos_private_key TEXT,
        activated BOOLEAN DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
    )
`,
  (err) => {
    if (err) {
      console.error("Error creating table:", err.message);
    } else {
      console.log("Account orders table created or already exists.");
    }
  }
);

// Ensure the 'ram_orders' table is created on startup
db.run(
  `
    CREATE TABLE IF NOT EXISTS ram_orders (
        order_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        eos_account_name TEXT,
        ram_bytes INTEGER,
        price_per_kb REAL,
        order_status TEXT DEFAULT 'pending',
        order_date TEXT,
        trigger_date TEXT,
        transaction_id TEXT,
        failure_reason TEXT,
        FOREIGN KEY(user_id) REFERENCES users(user_id)
    )
  `,
  (err) => {
    if (err) {
      console.error("Error creating table:", err.message);
    } else {
      console.log("RAM Orders table created or already exists.");
    }
  }
);


// Function to get multiple rows
export function runQuery(query: string, params: any[] = []): Promise<any> {
  // console.log("Query:", query, params);
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows);
    });
  });
}

// Function to get a single row
export function getQuery(query: string, params: any[] = []): Promise<any> {
  //  console.log("Query:", query, params);
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row);
    });
  });
}


export default db;
