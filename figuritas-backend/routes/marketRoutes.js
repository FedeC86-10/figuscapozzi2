const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const router = express.Router();

// GET /api/market - Listar publicaciones activas
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const { albumId } = req.query;
    let query = `
      SELECT p.id, p.usuario_id, p.created_at, p.expires_at, p.status,
             u.username as owner_username,
             json_agg(json_build_object('tipo', ip.tipo, 'figurita_id', ip.figurita_id, 'cantidad', ip.cantidad, 'monedas', ip.monedas)) as items
      FROM publicaciones_mercado p
      JOIN usuarios u ON p.usuario_id = u.id
      JOIN items_publicacion ip ON p.id = ip.publicacion_id
      WHERE p.status = 'open' AND (p.expires_at IS NULL OR p.expires_at > NOW())
        AND p.usuario_id != $1
    `;
    const params = [req.user.userId];
    let paramIndex = 2;
    if (albumId) {
      query += ` AND EXISTS (
        SELECT 1 FROM items_publicacion ip2
        JOIN figuritas f ON ip2.figurita_id = f.id
        WHERE ip2.publicacion_id = p.id AND f.album_id = $${paramIndex}
      )`;
      params.push(albumId);
      paramIndex++;
    }
    query += ` GROUP BY p.id, u.username ORDER BY p.created_at DESC`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/market - Crear publicación
router.post('/', authenticateToken, async (req, res, next) => {
  const client = await db.connect();
  try {
    const { offered, wanted, expiresAt } = req.body;
    if (!offered || offered.length === 0) throw new Error('Debes ofrecer al menos una figurita');
    const hasFigurita = offered.some(item => item.figurita_id);
    if (!hasFigurita) throw new Error('No se puede ofrecer solo monedas');

    // Validar inventario suficiente (considerando otras ofertas activas)
    const activeOffers = await client.query(
      `SELECT ip.figurita_id, SUM(ip.cantidad) as total
       FROM publicaciones_mercado p
       JOIN items_publicacion ip ON p.id = ip.publicacion_id
       WHERE p.usuario_id = $1 AND p.status = 'open' AND ip.tipo = 'offers' AND ip.figurita_id IS NOT NULL
       GROUP BY ip.figurita_id`,
      [req.user.userId]
    );
    const offeredMap = new Map();
    for (const row of activeOffers.rows) {
      offeredMap.set(row.figurita_id, parseInt(row.total));
    }
    for (const item of offered) {
      if (!item.figurita_id) continue;
      const currentQty = offeredMap.get(item.figurita_id) || 0;
      const inventory = await client.query(
        `SELECT cantidad FROM inventario_items WHERE usuario_id = $1 AND figurita_id = $2`,
        [req.user.userId, item.figurita_id]
      );
      const available = inventory.rows.length ? inventory.rows[0].cantidad : 0;
      if (available < currentQty + item.cantidad) {
        throw new Error(`No tienes suficientes copias de la figurita ${item.figurita_id}`);
      }
    }

    await client.query('BEGIN');
    const pubResult = await client.query(
      `INSERT INTO publicaciones_mercado (usuario_id, expires_at) VALUES ($1, $2) RETURNING id`,
      [req.user.userId, expiresAt || null]
    );
    const publicationId = pubResult.rows[0].id;
    for (const item of offered) {
      await client.query(
        `INSERT INTO items_publicacion (publicacion_id, tipo, figurita_id, cantidad)
         VALUES ($1, 'offers', $2, $3)`,
        [publicationId, item.figurita_id, item.cantidad]
      );
    }
    for (const item of wanted) {
      if (item.monedas !== undefined) {
        await client.query(
          `INSERT INTO items_publicacion (publicacion_id, tipo, monedas, cantidad)
           VALUES ($1, 'wants', $2, 1)`,
          [publicationId, item.monedas]
        );
      } else if (item.figurita_id) {
        await client.query(
          `INSERT INTO items_publicacion (publicacion_id, tipo, figurita_id, cantidad)
           VALUES ($1, 'wants', $2, $3)`,
          [publicationId, item.figurita_id, item.cantidad]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ publicationId });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/market/:id/accept - Aceptar publicación
router.post('/:id/accept', authenticateToken, async (req, res, next) => {
  const client = await db.connect();
  try {
    const publicationId = req.params.id;
    const acceptingUserId = req.user.userId;
    await client.query('BEGIN');
    const pubResult = await client.query(
      `SELECT id, usuario_id, status, version FROM publicaciones_mercado WHERE id = $1 FOR UPDATE`,
      [publicationId]
    );
    if (pubResult.rows.length === 0) throw new Error('Publicación no encontrada');
    const publication = pubResult.rows[0];
    if (publication.status !== 'open') throw new Error('La publicación ya no está disponible');
    if (publication.usuario_id === acceptingUserId) throw new Error('No puedes aceptar tu propia publicación');

    const items = await client.query(
      `SELECT tipo, figurita_id, cantidad, monedas FROM items_publicacion WHERE publicacion_id = $1`,
      [publicationId]
    );
    const offered = items.rows.filter(i => i.tipo === 'offers');
    const wanted = items.rows.filter(i => i.tipo === 'wants');
    const monedasSolicitadas = wanted.find(i => i.monedas !== null)?.monedas || 0;

    // Verificar que el aceptante tenga lo que el publicante pide
    const aceptanteOfrece = wanted.filter(i => i.figurita_id).map(i => ({ figurita_id: i.figurita_id, cantidad: i.cantidad }));
    for (const item of aceptanteOfrece) {
      const count = await client.query(
        `SELECT cantidad FROM inventario_items WHERE usuario_id = $1 AND figurita_id = $2 FOR UPDATE`,
        [acceptingUserId, item.figurita_id]
      );
      const available = count.rows.length ? count.rows[0].cantidad : 0;
      if (available < item.cantidad) throw new Error(`No tienes suficientes copias de la figurita ${item.figurita_id}`);
    }
    // Verificar monedas del aceptante
    const userCoins = await client.query(`SELECT coins FROM usuarios WHERE id = $1 FOR UPDATE`, [acceptingUserId]);
    if (userCoins.rows[0].coins < monedasSolicitadas) throw new Error('No tienes suficientes monedas');
    // Verificar que el publicante aún tenga lo que ofrece
    const publicanteOfrece = offered.map(i => ({ figurita_id: i.figurita_id, cantidad: i.cantidad }));
    for (const item of publicanteOfrece) {
      const count = await client.query(
        `SELECT cantidad FROM inventario_items WHERE usuario_id = $1 AND figurita_id = $2 FOR UPDATE`,
        [publication.usuario_id, item.figurita_id]
      );
      const available = count.rows.length ? count.rows[0].cantidad : 0;
      if (available < item.cantidad) throw new Error(`El ofertante ya no tiene suficientes copias de ${item.figurita_id}`);
    }

    // Realizar transferencias
    for (const item of aceptanteOfrece) {
      await client.query(
        `UPDATE inventario_items SET cantidad = cantidad - $1, version = version + 1
         WHERE usuario_id = $2 AND figurita_id = $3 AND cantidad >= $1`,
        [item.cantidad, acceptingUserId, item.figurita_id]
      );
      // Añadir al publicante
      await client.query(
        `INSERT INTO inventario_items (usuario_id, figurita_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id, figurita_id)
         DO UPDATE SET cantidad = inventario_items.cantidad + EXCLUDED.cantidad, version = inventario_items.version + 1`,
        [publication.usuario_id, item.figurita_id, item.cantidad]
      );
    }
    for (const item of publicanteOfrece) {
      await client.query(
        `UPDATE inventario_items SET cantidad = cantidad - $1, version = version + 1
         WHERE usuario_id = $2 AND figurita_id = $3 AND cantidad >= $1`,
        [item.cantidad, publication.usuario_id, item.figurita_id]
      );
      await client.query(
        `INSERT INTO inventario_items (usuario_id, figurita_id, cantidad)
         VALUES ($1, $2, $3)
         ON CONFLICT (usuario_id, figurita_id)
         DO UPDATE SET cantidad = inventario_items.cantidad + EXCLUDED.cantidad, version = inventario_items.version + 1`,
        [acceptingUserId, item.figurita_id, item.cantidad]
      );
    }
    if (monedasSolicitadas > 0) {
      await client.query(`UPDATE usuarios SET coins = coins - $1 WHERE id = $2 AND coins >= $1`, [monedasSolicitadas, acceptingUserId]);
      await client.query(`UPDATE usuarios SET coins = coins + $1 WHERE id = $2`, [monedasSolicitadas, publication.usuario_id]);
    }

    // Registrar intercambio
    const snapshot = {
      publicationId,
      items: items.rows,
      participantes: [publication.usuario_id, acceptingUserId]
    };
    await client.query(
      `INSERT INTO intercambios (usuario_a_id, usuario_b_id, snapshot) VALUES ($1, $2, $3)`,
      [publication.usuario_id, acceptingUserId, JSON.stringify(snapshot)]
    );
    await client.query(
      `UPDATE publicaciones_mercado SET status = 'accepted', version = version + 1 WHERE id = $1 AND version = $2`,
      [publicationId, publication.version]
    );
    await client.query(
      `INSERT INTO actividad (usuario_id, tipo, descripcion, metadata) VALUES
       ($1, 'trade_completed', 'Intercambio completado', $2),
       ($3, 'trade_completed', 'Intercambio completado', $2)`,
      [publication.usuario_id, JSON.stringify(snapshot), acceptingUserId]
    );
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