import sqlite3 from "sqlite3";
import { open } from "sqlite";

export const dbPromise = open({
  filename: "user_data.db",
  driver: sqlite3.Database,
});
