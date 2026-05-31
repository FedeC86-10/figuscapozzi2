const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// GET /api/probabilities - Obtener probabilidades globales
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`SELECT rareza, porcentaje FROM probabilidades_rareza WHERE album_id IS NULL`);
    const probs = {};
    for (const row of result.rows) {
      probs[row.rareza] = row.porcentaje;
    }
    res.json(probs);
  } catch (err) { next(err); }
});

// POST /api/probabilities - Guardar probabilidades globales (solo admin)
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  const client = await db.connect();
  try {
    const probs = req.body; // { bronce: 60, plata: 25, oro: 12, legendaria: 3 }
    await client.query('BEGIN');
    await client.query(`DELETE FROM probabilidades_rareza WHERE album_id IS NULL`);
    for (const [rareza, porcentaje] of Object.entries(probs)) {
      await client.query(
        `INSERT INTO probabilidades_rareza (album_id, rareza, porcentaje) VALUES (NULL, $1, $2)`,
        [rareza, porcentaje]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;