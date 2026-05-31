const { checkSufficientCopies, removeCopies, addCopies } = require('./inventoryService');
const { addCoins } = require('./userService');

// Crear una publicación (oferta pública)
async function createPublication(userId, offeredItems, wantedItems, expiresAt = null) {
  // offeredItems: array de { figurita_id, cantidad } – al menos un elemento con figurita_id
  // wantedItems: array de { figurita_id, cantidad } o { monedas: cantidad } (solo un elemento de monedas opcional)
  // Validar que no se ofrezcan solo monedas
  if (!offeredItems || offeredItems.length === 0) throw new Error('Debe ofrecer al menos una figurita');
  const hasFigurita = offeredItems.some(item => item.figurita_id);
  if (!hasFigurita) throw new Error('No se puede ofrecer solo monedas');

  // Validar que el usuario tenga suficientes copias de lo que ofrece (sumando todas sus publicaciones activas)
  // 1. Sumar cantidades ofrecidas en otras publicaciones activas del mismo usuario
  const otherOffers = await db.query(
    `SELECT ip.figurita_id, SUM(ip.cantidad) as total
     FROM publicaciones_mercado p
     JOIN items_publicacion ip ON p.id = ip.publicacion_id
     WHERE p.usuario_id = $1 AND p.status = 'open' AND ip.tipo = 'offers' AND ip.figurita_id IS NOT NULL
     GROUP BY ip.figurita_id`,
    [userId]
  );
  const otherMap = {};
  for (const row of otherOffers.rows) {
    otherMap[row.figurita_id] = parseInt(row.total);
  }
  // 2. Sumar lo que se quiere ofrecer ahora
  const needed = {};
  for (const item of offeredItems) {
    if (!item.figurita_id) continue;
    needed[item.figurita_id] = (needed[item.figurita_id] || 0) + item.cantidad;
  }
  // 3. Verificar contra inventario
  for (const [figuritaId, totalNeeded] of Object.entries(needed)) {
    const inv = await db.query(
      `SELECT cantidad FROM inventario_items WHERE usuario_id = $1 AND figurita_id = $2`,
      [userId, figuritaId]
    );
    const available = inv.rows.length ? inv.rows[0].cantidad : 0;
    const alreadyOffered = otherMap[figuritaId] || 0;
    if (available < alreadyOffered + totalNeeded) {
      throw new Error(`No tienes suficientes copias de la figurita ${figuritaId}`);
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Insertar publicación
    const pubResult = await client.query(
      `INSERT INTO publicaciones_mercado (usuario_id, expires_at) VALUES ($1, $2) RETURNING id`,
      [userId, expiresAt || null]
    );
    const publicationId = pubResult.rows[0].id;

    // Insertar ítems ofrecidos
    for (const item of offeredItems) {
      await client.query(
        `INSERT INTO items_publicacion (publicacion_id, tipo, figurita_id, cantidad)
         VALUES ($1, 'offers', $2, $3)`,
        [publicationId, item.figurita_id, item.cantidad]
      );
    }
    // Insertar ítems solicitados
    for (const item of wantedItems) {
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
    return { publicationId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Aceptar una publicación (realizar intercambio)
async function acceptPublication(publicationId, acceptingUserId) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Obtener publicación con bloqueo para evitar doble aceptación
    const pubResult = await client.query(
      `SELECT id, usuario_id, status, version FROM publicaciones_mercado 
       WHERE id = $1 FOR UPDATE`,
      [publicationId]
    );
    if (pubResult.rows.length === 0) throw new Error('Publicación no encontrada');
    const publication = pubResult.rows[0];
    if (publication.status !== 'open') throw new Error('La publicación ya no está disponible');
    if (publication.usuario_id === acceptingUserId) throw new Error('No puedes aceptar tu propia publicación');

    // Obtener ítems de la publicación
    const items = await client.query(
      `SELECT tipo, figurita_id, cantidad, monedas FROM items_publicacion WHERE publicacion_id = $1`,
      [publicationId]
    );
    const offered = items.rows.filter(i => i.tipo === 'offers');
    const wanted = items.rows.filter(i => i.tipo === 'wants');
    const monedasSolicitadas = wanted.find(i => i.monedas !== null)?.monedas || 0;

    // Verificar que el aceptante tenga suficientes copias de lo que ofrece (wanted, porque el aceptante da lo que el publicante pide)
    const aceptanteOfrece = wanted.filter(i => i.figurita_id).map(i => ({ figurita_id: i.figurita_id, cantidad: i.cantidad }));
    if (!await checkSufficientCopies(acceptingUserId, aceptanteOfrece)) {
      throw new Error('No tienes suficientes copias de las figuritas solicitadas');
    }
    // Verificar monedas del aceptante
    const userCoinsResult = await client.query(
      `SELECT coins FROM usuarios WHERE id = $1 FOR UPDATE`,
      [acceptingUserId]
    );
    if (userCoinsResult.rows[0].coins < monedasSolicitadas) throw new Error('No tienes suficientes monedas');

    // Verificar que el publicante aún tenga lo que ofrece
    const publicanteOfrece = offered.map(i => ({ figurita_id: i.figurita_id, cantidad: i.cantidad }));
    if (!await checkSufficientCopies(publication.usuario_id, publicanteOfrece)) {
      throw new Error('El ofertante ya no tiene las figuritas que ofrecía');
    }

    // Realizar transferencias:
    // 1. El aceptante da las figuritas que el publicante quería
    for (const item of aceptanteOfrece) {
      await removeCopies(acceptingUserId, item.figurita_id, item.cantidad);
      await addCopies(publication.usuario_id, item.figurita_id, item.cantidad);
    }
    // 2. El publicante da las figuritas que ofrecía
    for (const item of publicanteOfrece) {
      await removeCopies(publication.usuario_id, item.figurita_id, item.cantidad);
      await addCopies(acceptingUserId, item.figurita_id, item.cantidad);
    }
    // 3. Transferir monedas (si las hay)
    if (monedasSolicitadas > 0) {
      await addCoins(acceptingUserId, -monedasSolicitadas, false);
      await addCoins(publication.usuario_id, monedasSolicitadas, true);
    }

    // Registrar intercambio
    const snapshot = {
      publicationId,
      fecha: new Date(),
      items: items.rows,
      participantes: [publication.usuario_id, acceptingUserId]
    };
    await client.query(
      `INSERT INTO intercambios (usuario_a_id, usuario_b_id, snapshot) VALUES ($1, $2, $3)`,
      [publication.usuario_id, acceptingUserId, JSON.stringify(snapshot)]
    );

    // Marcar publicación como aceptada
    await client.query(
      `UPDATE publicaciones_mercado SET status = 'accepted', version = version + 1 WHERE id = $1 AND version = $2`,
      [publicationId, publication.version]
    );

    // Registrar actividad
    await client.query(
      `INSERT INTO actividad (usuario_id, tipo, descripcion, metadata) VALUES 
       ($1, 'trade_completed', 'Intercambio completado', $2),
       ($3, 'trade_completed', 'Intercambio completado', $2)`,
      [publication.usuario_id, JSON.stringify(snapshot), acceptingUserId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Listar publicaciones activas con filtros
async function listPublications(filters = {}) {
  let query = `
    SELECT p.id, p.usuario_id, p.created_at, p.expires_at,
           u.username as owner_username,
           json_agg(json_build_object('tipo', ip.tipo, 'figurita_id', ip.figurita_id, 'cantidad', ip.cantidad, 'monedas', ip.monedas)) as items
    FROM publicaciones_mercado p
    JOIN usuarios u ON p.usuario_id = u.id
    JOIN items_publicacion ip ON p.id = ip.publicacion_id
    WHERE p.status = 'open' AND (p.expires_at IS NULL OR p.expires_at > NOW())
  `;
  const params = [];
  let paramIndex = 1;
  if (filters.usuarioId) {
    query += ` AND p.usuario_id = $${paramIndex}`;
    params.push(filters.usuarioId);
    paramIndex++;
  }
  if (filters.figuritaId) {
    query += ` AND EXISTS (
      SELECT 1 FROM items_publicacion ip2 
      WHERE ip2.publicacion_id = p.id AND ip2.tipo = 'offers' AND ip2.figurita_id = $${paramIndex}
    )`;
    params.push(filters.figuritaId);
    paramIndex++;
  }
  query += ` GROUP BY p.id, u.username ORDER BY p.created_at DESC`;
  const result = await db.query(query, params);
  return result.rows;
}

module.exports = { createPublication, acceptPublication, listPublications };