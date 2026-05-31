const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();
router.use(authenticateToken, requireAdmin);

// GET /api/admin/users - Listar usuarios con conteo de inventario
router.get('/users', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.username, u.email, u.coins, u.role, u.created_at,
             (SELECT COUNT(*) FROM inventario_items WHERE usuario_id = u.id) as inventory_count
      FROM usuarios u
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/admin/activity - Listar actividad con filtros
router.get('/activity', async (req, res, next) => {
  try {
    const { limit = 50, type } = req.query;
    let query = `
      SELECT a.id, a.usuario_id, a.tipo, a.descripcion, a.metadata, a.created_at,
             u.username as usuario_username
      FROM actividad a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
    `;
    const params = [];
    if (type) {
      query += ` WHERE a.tipo = $1`;
      params.push(type);
    }
    query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/admin/coins/grant - Otorgar/quitar monedas
router.post('/coins/grant', async (req, res, next) => {
  try {
    const { userId, amount, motivo } = req.body;
    if (!userId || amount === undefined) return res.status(400).json({ error: 'Faltan datos' });
    await db.query('BEGIN');
    const userRes = await db.query(`SELECT coins FROM usuarios WHERE id = $1 FOR UPDATE`, [userId]);
    if (userRes.rows.length === 0) throw new Error('Usuario no encontrado');
    const newCoins = userRes.rows[0].coins + amount;
    if (newCoins < 0) throw new Error('El usuario no puede tener monedas negativas');
    await db.query(`UPDATE usuarios SET coins = $1, version = version + 1 WHERE id = $2`, [newCoins, userId]);
    await db.query(
      `INSERT INTO actividad (usuario_id, tipo, descripcion, metadata) VALUES ($1, 'coins_granted', $2, $3)`,
      [userId, motivo || 'Otorgadas por administrador', JSON.stringify({ amount })]
    );
    await db.query('COMMIT');
    res.json({ success: true, newCoins });
  } catch (err) {
    await db.query('ROLLBACK');
    next(err);
  }
});

module.exports = router;