const express = require('express');
const router = express.Router();

// Listar figuritas con filtros (público)
router.get('/', async (req, res, next) => {
  try {
    const { albumId, rareza } = req.query;
    let query = `
      SELECT f.id, f.global_number, f.name, f.description, f.image_url, f.rareza, f.is_brillante,
             a.name as album_name, a.id as album_id
      FROM figuritas f
      JOIN albumes a ON f.album_id = a.id
      WHERE f.active = true AND f.deleted_at IS NULL AND a.deleted_at IS NULL
    `;
    const params = [];
    if (albumId) {
      params.push(albumId);
      query += ` AND f.album_id = $${params.length}`;
    }
    if (rareza) {
      params.push(rareza);
      query += ` AND f.rareza = $${params.length}`;
    }
    query += ` ORDER BY a.display_order, f.global_number`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Obtener una figurita por ID
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT f.*, a.name as album_name
       FROM figuritas f
       JOIN albumes a ON f.album_id = a.id
       WHERE f.id = $1 AND f.active = true AND f.deleted_at IS NULL`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Figurita no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;