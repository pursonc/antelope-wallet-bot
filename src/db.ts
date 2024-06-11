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
        permission_name TEXT
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

// Function to run queries
export function runQuery(query: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        return reject(err);
      }
      resolve(this);
    });
  });
}

// Function to get a single row
export function getQuery(query: string, params: any[] = []): Promise<any> {
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
