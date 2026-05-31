const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Listar álbumes activos (público)
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, cover_url, pack_url, status, display_order
       FROM albumes
       WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY display_order`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener un álbum con sus secciones y figuritas (público)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const albumResult = await db.query(
      `SELECT id, name, description, cover_url, pack_url, status, display_order
       FROM albumes WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (albumResult.rows.length === 0) return res.status(404).json({ error: 'Álbum no encontrado' });
    const album = albumResult.rows[0];
    // Secciones
    const secciones = await db.query(
      `SELECT id, name, order_index FROM secciones WHERE album_id = $1 ORDER BY order_index`,
      [id]
    );
    // Figuritas (solo activas)
    const figuritas = await db.query(
      `SELECT id, global_number, name, description, image_url, rareza, is_brillante, seccion_id
       FROM figuritas WHERE album_id = $1 AND active = true AND deleted_at IS NULL
       ORDER BY global_number`,
      [id]
    );
    album.secciones = secciones.rows;
    album.figuritas = figuritas.rows;
    res.json(album);
  } catch (err) {
    next(err);
  }
});

module.exports = router;