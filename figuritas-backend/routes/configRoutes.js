const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// GET /api/config - Obtener configuración global
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(`SELECT preciosobre, figsobre, monedasIniciales, recompensa FROM configuracion WHERE id = 1`);
    if (result.rows.length === 0) {
      // Insertar valores por defecto
      await db.query(`INSERT INTO configuracion (id, preciosobre, figsobre, monedasIniciales, recompensa) VALUES (1, 50, 3, 500, 300)`);
      return res.json({ preciosobre: 50, figsobre: 3, monedasIniciales: 500, recompensa: 300 });
    }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/config - Guardar configuración (solo admin)
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { monedasIniciales, precioSobre, figSobre, recompensa } = req.body;
    await db.query(`
      UPDATE configuracion
      SET preciosobre = COALESCE($1, preciosobre),
          figsobre = COALESCE($2, figsobre),
          monedasIniciales = COALESCE($3, monedasIniciales),
          recompensa = COALESCE($4, recompensa)
      WHERE id = 1
    `, [precioSobre, figSobre, monedasIniciales, recompensa]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;