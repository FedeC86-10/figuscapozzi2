// Obtener inventario de un usuario con detalles de figurita
async function getUserInventory(userId) {
  const result = await db.query(
    `SELECT i.figurita_id, i.cantidad, i.first_acquired_at,
            f.global_number, f.name, f.rareza, f.is_brillante, f.image_url,
            a.name as album_name, a.id as album_id
     FROM inventario_items i
     JOIN figuritas f ON i.figurita_id = f.id
     JOIN albumes a ON f.album_id = a.id
     WHERE i.usuario_id = $1 AND f.deleted_at IS NULL AND a.deleted_at IS NULL
     ORDER BY a.display_order, f.global_number`,
    [userId]
  );
  return result.rows;
}

// Obtener cantidad de una figurita específica (con versión)
async function getFiguritaCount(userId, figuritaId) {
  const result = await db.query(
    `SELECT cantidad, version FROM inventario_items 
     WHERE usuario_id = $1 AND figurita_id = $2`,
    [userId, figuritaId]
  );
  if (result.rows.length === 0) return { cantidad: 0, version: null };
  return { cantidad: result.rows[0].cantidad, version: result.rows[0].version };
}

// Añadir o incrementar copias (usado al abrir paquetes)
async function addCopies(userId, figuritaId, cantidad) {
  await db.query('BEGIN');
  try {
    const existing = await db.query(
      `SELECT id, cantidad, version FROM inventario_items 
       WHERE usuario_id = $1 AND figurita_id = $2 FOR UPDATE`,
      [userId, figuritaId]
    );
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO inventario_items (usuario_id, figurita_id, cantidad) 
         VALUES ($1, $2, $3)`,
        [userId, figuritaId, cantidad]
      );
    } else {
      const newCantidad = existing.rows[0].cantidad + cantidad;
      await db.query(
        `UPDATE inventario_items 
         SET cantidad = $1, version = version + 1 
         WHERE id = $2 AND version = $3`,
        [newCantidad, existing.rows[0].id, existing.rows[0].version]
      );
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

// Reducir copias (usado al aceptar intercambios) - con control de concurrencia
async function removeCopies(userId, figuritaId, cantidad) {
  let success = false;
  let retries = 3;
  while (!success && retries > 0) {
    const { cantidad: currentCantidad, version } = await getFiguritaCount(userId, figuritaId);
    if (currentCantidad < cantidad) throw new Error('No hay suficientes copias');
    const newCantidad = currentCantidad - cantidad;
    let result;
    if (newCantidad === 0) {
      result = await db.query(
        `DELETE FROM inventario_items 
         WHERE usuario_id = $1 AND figurita_id = $2 AND version = $3`,
        [userId, figuritaId, version]
      );
    } else {
      result = await db.query(
        `UPDATE inventario_items 
         SET cantidad = $1, version = version + 1 
         WHERE usuario_id = $2 AND figurita_id = $3 AND version = $4`,
        [newCantidad, userId, figuritaId, version]
      );
    }
    if (result.rowCount > 0) success = true;
    else retries--;
  }
  if (!success) throw new Error('Conflicto de concurrencia al actualizar inventario');
}

// Verificar si el usuario tiene suficientes copias (múltiples figuritas)
async function checkSufficientCopies(userId, items) {
  for (const item of items) {
    if (item.figurita_id) {
      const { cantidad } = await getFiguritaCount(userId, item.figurita_id);
      if (cantidad < item.cantidad) return false;
    }
  }
  return true;
}

module.exports = { getUserInventory, getFiguritaCount, addCopies, removeCopies, checkSufficientCopies };