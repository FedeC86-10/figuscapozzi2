const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/user/me - Obtener perfil del usuario autenticado (con inventario y monedas)
router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.userId; // Extraído del token por el middleware

    // Obtener datos básicos del usuario (sin password_hash)
    const userResult = await db.query(
      `SELECT id, username, email, coins, role, created_at
       FROM usuarios
       WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];

    // Obtener inventario detallado (figuritas que posee, con copias)
    const inventoryResult = await db.query(
      `SELECT 
          i.figurita_id,
          i.cantidad,
          i.first_acquired_at,
          f.global_number,
          f.name as figurita_nombre,
          f.rareza,
          f.is_brillante,
          f.image_url,
          a.name as album_nombre,
          a.id as album_id
       FROM inventario_items i
       JOIN figuritas f ON i.figurita_id = f.id
       JOIN albumes a ON f.album_id = a.id
       WHERE i.usuario_id = $1 AND f.deleted_at IS NULL AND a.deleted_at IS NULL
       ORDER BY a.display_order, f.global_number`,
      [userId]
    );

    user.inventory = inventoryResult.rows;

    res.json(user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;