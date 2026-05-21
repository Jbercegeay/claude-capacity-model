/**
 * sqlite-compat.js
 *
 * Thin wrapper around node:sqlite's DatabaseSync that adds the
 * better-sqlite3-compatible .pragma() and .transaction() APIs.
 * This lets us use the built-in Node 24 SQLite module without
 * needing to install the native better-sqlite3 addon.
 */

import { DatabaseSync } from 'node:sqlite';

export class Database extends DatabaseSync {
  /**
   * Execute a PRAGMA statement.
   * Mirrors better-sqlite3's db.pragma('key = value').
   */
  pragma(statement) {
    this.exec(`PRAGMA ${statement}`);
  }

  /**
   * Wrap a function in a BEGIN/COMMIT/ROLLBACK transaction.
   * Mirrors better-sqlite3's db.transaction(fn) — returns a callable.
   */
  transaction(fn) {
    const self = this;
    return function (...args) {
      self.exec('BEGIN');
      try {
        const result = fn(...args);
        self.exec('COMMIT');
        return result;
      } catch (err) {
        self.exec('ROLLBACK');
        throw err;
      }
    };
  }
}
