/**
 * db/init-db.js
 * Creates (or resets) the SQLite database from schema.sql.
 *
 * Usage:
 *   node db/init-db.js           -- create/open DB, apply schema
 *   node db/init-db.js --reset   -- drop and recreate (CAUTION: destroys all data)
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = path.join(__dirname, 'capacity.db');
const SQL_PATH  = path.join(__dirname, 'schema.sql');

const reset = process.argv.includes('--reset');

if (reset && existsSync(DB_PATH)) {
  console.log('⚠️  --reset flag detected. Deleting existing database...');
  unlinkSync(DB_PATH);
}

const db = new Database(DB_PATH);

const schema = readFileSync(SQL_PATH, 'utf8');

// Execute the entire schema (CREATE TABLE IF NOT EXISTS is idempotent)
db.exec(schema);

db.close();

console.log(`✅  Database ready at: ${DB_PATH}`);
