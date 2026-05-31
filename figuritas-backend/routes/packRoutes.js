const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { openPack } = require('../services/packService');
const router = express.Router();

router.post('/open', authenticateToken, async (req, res, next) => {
  try {
    const { albumId } = req.body;
    if (!albumId) return res.status(400).json({ error: 'albumId es requerido' });
    // Obtener configuración del álbum (precio y cantidad de figuritas)
    const albumConfig = await db.query(
      `SELECT id, name FROM albumes WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
      [albumId]
    );
    if (albumConfig.rows.length === 0) return res.status(404).json({ error: 'Álbum no disponible' });
    // Las reglas del paquete vienen de la configuración global (por ahora fijas)
    const eco = await db.query(`SELECT precioSobre, figSobre FROM configuracion WHERE id = 1`);
    let precio = 50, cantidad = 3;
    if (eco.rows.length) {
      precio = eco.rows[0].preciosobre;
      cantidad = eco.rows[0].figsobre;
    }
    const result = await openPack(req.user.userId, albumId, cantidad, precio);
    res.json({ stickers: result.stickers, newCoins: result.newCoins });
  } catch (err) {
    next(err);
  }
});

module.exports = router;