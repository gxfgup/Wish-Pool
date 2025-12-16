const path = require('path');
const sqlite3 = require('sqlite3');

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb(db, { deadlineMsDefault }) {
  await run(db, 'PRAGMA foreign_keys = ON');

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS wishes (
      user_id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      modified_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS assignments (
      giver_user_id INTEGER PRIMARY KEY,
      receiver_user_id INTEGER NOT NULL UNIQUE,
      cycle_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(giver_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  );

  const now = Date.now();
  await ensureConfig(db, 'maxWishes', '50');
  await ensureConfig(db, 'deadlineTs', String(now + deadlineMsDefault));
  await ensureConfig(db, 'assigned', '0');
  await ensureConfig(db, 'cycleId', '1');
}

async function ensureConfig(db, key, value) {
  const row = await get(db, 'SELECT value FROM config WHERE key = ?', [key]);
  if (row) return;
  await run(db, 'INSERT INTO config(key, value) VALUES(?, ?)', [key, value]);
}

async function getConfig(db) {
  const rows = await all(db, 'SELECT key, value FROM config');
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return {
    maxWishes: Number(obj.maxWishes || 50),
    deadlineTs: Number(obj.deadlineTs || 0),
    assigned: Number(obj.assigned || 0),
    cycleId: Number(obj.cycleId || 1)
  };
}

async function setConfig(db, patch) {
  const keys = Object.keys(patch);
  for (const key of keys) {
    await run(db, 'INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(patch[key])]);
  }
}

async function withTransaction(db, fn) {
  await run(db, 'BEGIN');
  try {
    const res = await fn();
    await run(db, 'COMMIT');
    return res;
  } catch (e) {
    try {
      await run(db, 'ROLLBACK');
    } catch (_) {
      // ignore
    }
    throw e;
  }
}

module.exports = {
  openDb,
  run,
  get,
  all,
  initDb,
  getConfig,
  setConfig,
  withTransaction
};
