const { get, run } = require('./db');

async function authMiddleware(db, req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const now = Date.now();
  const session = await get(
    db,
    `SELECT s.token, s.user_id, s.expires_at, u.phone
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    [token]
  );

  if (!session || session.expires_at <= now) {
    if (session) await run(db, 'DELETE FROM sessions WHERE token = ?', [token]);
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  req.user = { id: session.user_id, phone: session.phone, token: session.token };
  return next();
}

async function adminMiddleware(db, req, res, next) {
  const token = req.headers['x-admin-token'] || null;
  if (!token) return res.status(401).json({ error: 'ADMIN_UNAUTHORIZED' });

  const now = Date.now();
  const row = await get(db, 'SELECT token, expires_at FROM admin_sessions WHERE token = ?', [token]);
  if (!row || row.expires_at <= now) {
    if (row) await run(db, 'DELETE FROM admin_sessions WHERE token = ?', [token]);
    return res.status(401).json({ error: 'ADMIN_UNAUTHORIZED' });
  }

  return next();
}

module.exports = {
  authMiddleware,
  adminMiddleware
};
