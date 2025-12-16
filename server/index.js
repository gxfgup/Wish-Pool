const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { openDb, initDb, run, get, all, getConfig, setConfig, withTransaction } = require('./db');
const { authMiddleware, adminMiddleware } = require('./auth');
const { derangement } = require('./derangement');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wishpool.sqlite');

const DEADLINE_MS_DEFAULT = 72 * 60 * 60 * 1000;
const USER_SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 6 * 60 * 60 * 1000;
const ADMIN_PASSWORD = 'Wishpool';

async function main() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  const db = openDb(DB_PATH);
  await initDb(db, { deadlineMsDefault: DEADLINE_MS_DEFAULT });

  function ok(res, payload) {
    return res.json(payload);
  }

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { phone, password } = req.body || {};
      if (!/^\d{11}$/.test(String(phone || ''))) return res.status(400).json({ error: 'INVALID_PHONE' });
      if (!/^\d{4}$/.test(String(password || ''))) return res.status(400).json({ error: 'INVALID_PASSWORD' });

      const existing = await get(db, 'SELECT id FROM users WHERE phone = ?', [phone]);
      if (existing) return res.status(409).json({ error: 'PHONE_EXISTS' });

      const password_hash = await bcrypt.hash(password, 10);
      const now = Date.now();
      const r = await run(db, 'INSERT INTO users(phone, password_hash, created_at) VALUES(?, ?, ?)', [phone, password_hash, now]);
      return ok(res, { userId: r.lastID });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { phone, password } = req.body || {};
      const user = await get(db, 'SELECT id, password_hash FROM users WHERE phone = ?', [phone]);
      if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      const okPw = await bcrypt.compare(String(password || ''), user.password_hash);
      if (!okPw) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

      const token = uuidv4();
      const now = Date.now();
      await run(db, 'INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)', [token, user.id, now, now + USER_SESSION_MS]);
      return ok(res, { token });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/auth/logout', authMiddleware.bind(null, db), async (req, res) => {
    try {
      await run(db, 'DELETE FROM sessions WHERE token = ?', [req.user.token]);
      return ok(res, { ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/me', authMiddleware.bind(null, db), async (req, res) => {
    return ok(res, { id: req.user.id, phone: req.user.phone });
  });

  app.get('/api/status', async (req, res) => {
    try {
      const cfg = await getConfig(db);
      const row = await get(db, 'SELECT COUNT(*) AS c FROM wishes');
      return ok(res, {
        totalWishes: Number(row.c || 0),
        maxWishes: cfg.maxWishes,
        deadlineTs: cfg.deadlineTs,
        assigned: cfg.assigned,
        nowTs: Date.now()
      });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/wish/me', authMiddleware.bind(null, db), async (req, res) => {
    try {
      const cfg = await getConfig(db);
      const now = Date.now();
      const wish = await get(db, 'SELECT text, modified_count, updated_at FROM wishes WHERE user_id = ?', [req.user.id]);
      const canEdit = Boolean(wish) && cfg.assigned === 0 && now < cfg.deadlineTs && Number(wish.modified_count || 0) < 1;
      const canCreate = !wish && cfg.assigned === 0 && now < cfg.deadlineTs;
      return ok(res, {
        wish: wish ? { text: wish.text, modifiedCount: wish.modified_count, updatedAt: wish.updated_at } : null,
        canEdit,
        canCreate
      });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/wish', authMiddleware.bind(null, db), async (req, res) => {
    try {
      const cfg = await getConfig(db);
      const now = Date.now();
      if (cfg.assigned !== 0) return res.status(400).json({ error: 'ALREADY_ASSIGNED' });
      if (now >= cfg.deadlineTs) return res.status(400).json({ error: 'DEADLINE_PASSED' });

      const text = String((req.body || {}).text || '').trim();
      if (!text) return res.status(400).json({ error: 'EMPTY_WISH' });
      if (text.length > 200) return res.status(400).json({ error: 'WISH_TOO_LONG' });

      const existing = await get(db, 'SELECT user_id, modified_count FROM wishes WHERE user_id = ?', [req.user.id]);

      if (!existing) {
        const countRow = await get(db, 'SELECT COUNT(*) AS c FROM wishes');
        if (Number(countRow.c || 0) >= cfg.maxWishes) return res.status(400).json({ error: 'POOL_FULL' });
        await run(db, 'INSERT INTO wishes(user_id, text, modified_count, created_at, updated_at) VALUES(?, ?, 0, ?, ?)', [req.user.id, text, now, now]);
        return ok(res, { ok: true, mode: 'created' });
      }

      if (Number(existing.modified_count || 0) >= 1) return res.status(400).json({ error: 'EDIT_LIMIT_REACHED' });

      await run(db, 'UPDATE wishes SET text = ?, modified_count = modified_count + 1, updated_at = ? WHERE user_id = ?', [text, now, req.user.id]);
      return ok(res, { ok: true, mode: 'updated' });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/reveal', authMiddleware.bind(null, db), async (req, res) => {
    try {
      const cfg = await getConfig(db);
      if (cfg.assigned !== 1) return res.status(400).json({ error: 'NOT_ASSIGNED' });

      const row = await get(
        db,
        `SELECT a.receiver_user_id AS receiverId, w.text AS wishText
         FROM assignments a
         JOIN wishes w ON w.user_id = a.receiver_user_id
         WHERE a.giver_user_id = ? AND a.cycle_id = ?`,
        [req.user.id, cfg.cycleId]
      );

      if (!row) return res.status(404).json({ error: 'NO_ASSIGNMENT' });
      return ok(res, { wishText: row.wishText });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/login', async (req, res) => {
    try {
      const { password } = req.body || {};
      if (String(password || '') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'ADMIN_INVALID_PASSWORD' });

      const token = uuidv4();
      const now = Date.now();
      await run(db, 'INSERT INTO admin_sessions(token, created_at, expires_at) VALUES(?, ?, ?)', [token, now, now + ADMIN_SESSION_MS]);
      return ok(res, { token });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/admin/status', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      const cfg = await getConfig(db);
      const users = await get(db, 'SELECT COUNT(*) AS c FROM users');
      const wishes = await get(db, 'SELECT COUNT(*) AS c FROM wishes');
      const assignments = await get(db, 'SELECT COUNT(*) AS c FROM assignments');
      return ok(res, {
        config: cfg,
        counts: {
          users: Number(users.c || 0),
          wishes: Number(wishes.c || 0),
          assignments: Number(assignments.c || 0)
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/config', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      const patch = {};
      if (req.body && req.body.maxWishes !== undefined) {
        const v = Number(req.body.maxWishes);
        if (!Number.isFinite(v) || v < 2 || v > 500) return res.status(400).json({ error: 'INVALID_MAX_WISHES' });
        patch.maxWishes = String(Math.floor(v));
      }
      if (req.body && req.body.deadlineTs !== undefined) {
        const v = Number(req.body.deadlineTs);
        if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: 'INVALID_DEADLINE' });
        patch.deadlineTs = String(Math.floor(v));
      }
      await setConfig(db, patch);
      return ok(res, { ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/assign', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      const cfg = await getConfig(db);
      const usersWithWishes = await all(db, 'SELECT user_id FROM wishes ORDER BY user_id');
      const ids = usersWithWishes.map((r) => r.user_id);
      const perm = derangement(ids);
      if (!perm) return res.status(400).json({ error: 'NOT_ENOUGH_WISHES' });

      await withTransaction(db, async () => {
        await run(db, 'DELETE FROM assignments');
        const now = Date.now();
        for (let i = 0; i < ids.length; i++) {
          await run(
            db,
            'INSERT INTO assignments(giver_user_id, receiver_user_id, cycle_id, created_at) VALUES(?, ?, ?, ?)',
            [ids[i], perm[i], cfg.cycleId, now]
          );
        }
        await setConfig(db, { assigned: '1' });
      });

      return ok(res, { ok: true, assignedCount: ids.length });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/reset-pool', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      await withTransaction(db, async () => {
        const cfg = await getConfig(db);
        await run(db, 'DELETE FROM wishes');
        await run(db, 'DELETE FROM assignments');
        const now = Date.now();
        await setConfig(db, {
          assigned: '0',
          deadlineTs: String(now + DEADLINE_MS_DEFAULT),
          cycleId: String(cfg.cycleId + 1)
        });
      });
      return ok(res, { ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.post('/api/admin/reset-db', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      await withTransaction(db, async () => {
        await run(db, 'DELETE FROM assignments');
        await run(db, 'DELETE FROM wishes');
        await run(db, 'DELETE FROM sessions');
        await run(db, 'DELETE FROM users');
        await run(db, 'DELETE FROM admin_sessions');
        const now = Date.now();
        await setConfig(db, {
          maxWishes: '50',
          assigned: '0',
          cycleId: '1',
          deadlineTs: String(now + DEADLINE_MS_DEFAULT)
        });
      });
      return ok(res, { ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('/api/admin/export', adminMiddleware.bind(null, db), async (req, res) => {
    try {
      const rows = await all(
        db,
        `SELECT
          u.phone AS phone,
          w.text AS wish,
          gu.phone AS giver_phone,
          ru.phone AS receiver_phone,
          rw.text AS receiver_wish
        FROM wishes w
        JOIN users u ON u.id = w.user_id
        LEFT JOIN assignments a ON a.giver_user_id = u.id
        LEFT JOIN users gu ON gu.id = a.giver_user_id
        LEFT JOIN users ru ON ru.id = a.receiver_user_id
        LEFT JOIN wishes rw ON rw.user_id = a.receiver_user_id
        ORDER BY u.id`
      );

      const esc = (s) => {
        const v = String(s ?? '');
        if (v.includes('"') || v.includes(',') || v.includes('\n') || v.includes('\r')) return '"' + v.replace(/"/g, '""') + '"';
        return v;
      };

      const header = ['phone', 'wish', 'giver_phone', 'receiver_phone', 'receiver_wish'];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push([r.phone, r.wish, r.giver_phone, r.receiver_phone, r.receiver_wish].map(esc).join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="wishpool_export.csv"');
      return res.send(lines.join('\n'));
    } catch (e) {
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Wishing Well running on http://0.0.0.0:${PORT}`);
    console.log(`DB: ${DB_PATH}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
