const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// GET /api/trades
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { sent, received } = req.query;
    const userId = req.user.userId;
    let query = `
      SELECT t.*,
             u_from.username as from_username,
             u_to.username as to_username
      FROM trades t
      LEFT JOIN usuarios u_from ON t.fromId = u_from.id
      LEFT JOIN usuarios u_to ON t.toId = u_to.id
      WHERE 1=1
    `;
    const params = [];
    if (sent === 'true') {
      query += ` AND t.fromId = $1`;
      params.push(userId);
    } else if (received === 'true') {
      query += ` AND t.toId = $1`;
      params.push(userId);
    } else {
      query += ` AND (t.fromId = $1 OR t.toId = $1)`;
      params.push(userId);
    }
    query += ` ORDER BY t.createdAt DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/trades/:id/respond
router.post('/:id/respond', authenticateToken, async (req, res, next) => {
  const client = await db.connect();
  try {
    const tradeId = req.params.id;
    const userId = req.user.userId;
    const { action, counterOffer, message } = req.body;
    await client.query('BEGIN');
    const tradeRes = await client.query(`SELECT * FROM trades WHERE id = $1 FOR UPDATE`, [tradeId]);
    if (tradeRes.rows.length === 0) throw new Error('Intercambio no encontrado');
    const trade = tradeRes.rows[0];
    if (trade.status !== 'Pendiente') throw new Error('Esta oferta ya no está disponible');
    
    if (action === 'accept') {
      // Validar y transferir (similar a acceptPublication)
      // (Aquí iría la misma lógica que en acceptPublication, pero con las tablas trades)
      // Por simplicidad, puedes reutilizar la misma lógica llamando a una función compartida.
      // Para no duplicar, te recomiendo extraer la lógica a un servicio común.
      // Por ahora, asumiremos que se implementa la transferencia.
      await client.query(`UPDATE trades SET status = 'Aceptada' WHERE id = $1`, [tradeId]);
      // Registrar actividad...
    } else if (action === 'reject') {
      await client.query(`UPDATE trades SET status = 'Rechazada' WHERE id = $1`, [tradeId]);
    } else if (action === 'counter') {
      await client.query(`UPDATE trades SET status = 'Contraoferta', msg = $1 WHERE id = $2`, [message, tradeId]);
    }
    await client.query('COMMIT');
    res.json({ success: true, trade: { ...trade, status: action === 'accept' ? 'Aceptada' : action === 'reject' ? 'Rechazada' : 'Contraoferta' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;