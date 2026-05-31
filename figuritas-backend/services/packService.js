const { addCopies } = require('./inventoryService');
const { addCoins } = require('./userService');

// Obtener probabilidades para un álbum (si no tiene configuración específica, usa la global)
async function getProbabilities(albumId) {
  // Buscar configuración específica del álbum
  let result = await db.query(
    `SELECT rareza, porcentaje FROM probabilidades_rareza WHERE album_id = $1`,
    [albumId]
  );
  if (result.rows.length === 0) {
    // Usar configuración global
    result = await db.query(
      `SELECT rareza, porcentaje FROM probabilidades_rareza WHERE album_id IS NULL`
    );
  }
  const probs = {};
  for (const row of result.rows) {
    probs[row.rareza] = row.porcentaje;
  }
  return probs;
}

// Seleccionar una figurita aleatoria según rareza y álbum
async function getRandomSticker(albumId, probs) {
  // Generar número aleatorio 0-100
  const rand = Math.random() * 100;
  let selectedRareza = null;
  let acum = 0;
  for (const [rareza, pct] of Object.entries(probs)) {
    acum += pct;
    if (rand <= acum) {
      selectedRareza = rareza;
      break;
    }
  }
  if (!selectedRareza) selectedRareza = 'bronce'; // fallback

  // Buscar figuritas activas de ese álbum y rareza
  const result = await db.query(
    `SELECT id FROM figuritas 
     WHERE album_id = $1 AND rareza = $2 AND active = true AND deleted_at IS NULL`,
    [albumId, selectedRareza]
  );
  if (result.rows.length === 0) {
    // Si no hay de esa rareza, tomar cualquier figurita del álbum
    const fallback = await db.query(
      `SELECT id FROM figuritas WHERE album_id = $1 AND active = true AND deleted_at IS NULL`,
      [albumId]
    );
    if (fallback.rows.length === 0) throw new Error('El álbum no tiene figuritas disponibles');
    return fallback.rows[Math.floor(Math.random() * fallback.rows.length)].id;
  }
  const randomIndex = Math.floor(Math.random() * result.rows.length);
  return result.rows[randomIndex].id;
}

// Abrir paquete (compra)
async function openPack(userId, albumId, cantidadFiguritas, precio) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Verificar que el usuario tiene suficientes monedas (usando bloqueo pesimista)
    const userResult = await client.query(
      `SELECT coins, version FROM usuarios WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (userResult.rows.length === 0) throw new Error('Usuario no encontrado');
    const user = userResult.rows[0];
    if (user.coins < precio) throw new Error('Monedas insuficientes');
    // Descontar monedas
    const newCoins = user.coins - precio;
    await client.query(
      `UPDATE usuarios SET coins = $1, version = version + 1 WHERE id = $2 AND version = $3`,
      [newCoins, userId, user.version]
    );

    // Obtener probabilidades del álbum
    const probs = await getProbabilities(albumId);
    // Generar figuritas
    const stickers = [];
    for (let i = 0; i < cantidadFiguritas; i++) {
      const stickerId = await getRandomSticker(albumId, probs);
      stickers.push(stickerId);
      // Añadir al inventario (con bloqueo optimista, pero dentro de la misma transacción)
      const invResult = await client.query(
        `SELECT id, cantidad, version FROM inventario_items 
         WHERE usuario_id = $1 AND figurita_id = $2 FOR UPDATE`,
        [userId, stickerId]
      );
      if (invResult.rows.length === 0) {
        await client.query(
          `INSERT INTO inventario_items (usuario_id, figurita_id, cantidad) VALUES ($1, $2, 1)`,
          [userId, stickerId]
        );
      } else {
        const newCantidad = invResult.rows[0].cantidad + 1;
        await client.query(
          `UPDATE inventario_items SET cantidad = $1, version = version + 1 
           WHERE id = $2 AND version = $3`,
          [newCantidad, invResult.rows[0].id, invResult.rows[0].version]
        );
      }
    }

    // Registrar actividad
    await client.query(
      `INSERT INTO actividad (usuario_id, tipo, descripcion, metadata)
       VALUES ($1, $2, $3, $4)`,
      [userId, 'pack_open', `Abrió un sobre del álbum`, JSON.stringify({ albumId, stickers })]
    );

    await client.query('COMMIT');
    return { stickers, newCoins };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { openPack };