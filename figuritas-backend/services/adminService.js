const { addCoins } = require('./userService');

// Crear álbum
async function createAlbum(data) {
  const { name, description, cover_url, pack_url, status, display_order } = data;
  const result = await db.query(
    `INSERT INTO albumes (name, description, cover_url, pack_url, status, display_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, description, cover_url, pack_url, status, display_order]
  );
  return result.rows[0];
}

// Actualizar álbum
async function updateAlbum(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (fields.length === 0) throw new Error('No hay datos para actualizar');
  values.push(id);
  const query = `UPDATE albumes SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  return result.rows[0];
}

// Eliminar álbum (soft delete)
async function deleteAlbum(id) {
  await db.query(`UPDATE albumes SET deleted_at = NOW() WHERE id = $1`, [id]);
}

// Crear sección
async function createSeccion(albumId, name, order_index) {
  const result = await db.query(
    `INSERT INTO secciones (album_id, name, order_index) VALUES ($1, $2, $3) RETURNING *`,
    [albumId, name, order_index]
  );
  return result.rows[0];
}

// Crear figurita
async function createFigurita(data) {
  const { album_id, seccion_id, global_number, name, description, image_url, rareza, is_brillante } = data;
  const result = await db.query(
    `INSERT INTO figuritas (album_id, seccion_id, global_number, name, description, image_url, rareza, is_brillante)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [album_id, seccion_id, global_number, name, description, image_url, rareza, is_brillante]
  );
  return result.rows[0];
}

// Actualizar figurita
async function updateFigurita(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
  }
  if (fields.length === 0) throw new Error('No hay datos para actualizar');
  values.push(id);
  const query = `UPDATE figuritas SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
  const result = await db.query(query, values);
  return result.rows[0];
}

// Eliminar figurita (soft delete)
async function deleteFigurita(id) {
  await db.query(`UPDATE figuritas SET deleted_at = NOW() WHERE id = $1`, [id]);
}

// Configurar probabilidades (globales o por álbum)
async function setProbabilities(albumId, probs) {
  await db.query('BEGIN');
  try {
    if (albumId) {
      await db.query(`DELETE FROM probabilidades_rareza WHERE album_id = $1`, [albumId]);
    } else {
      await db.query(`DELETE FROM probabilidades_rareza WHERE album_id IS NULL`);
    }
    for (const [rareza, porcentaje] of Object.entries(probs)) {
      await db.query(
        `INSERT INTO probabilidades_rareza (album_id, rareza, porcentaje) VALUES ($1, $2, $3)`,
        [albumId || null, rareza, porcentaje]
      );
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

// Otorgar monedas a usuario
async function grantCoins(userId, amount, motivo) {
  await addCoins(userId, amount, false);
  await db.query(
    `INSERT INTO actividad (usuario_id, tipo, descripcion, metadata)
     VALUES ($1, 'coins_granted', $2, $3)`,
    [userId, motivo, JSON.stringify({ amount })]
  );
}

module.exports = {
  createAlbum,
  updateAlbum,
  deleteAlbum,
  createSeccion,
  createFigurita,
  updateFigurita,
  deleteFigurita,
  setProbabilities,
  grantCoins
};