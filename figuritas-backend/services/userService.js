const bcrypt = require('bcrypt');

async function getUserById(userId) {
  const result = await db.query(
    `SELECT id, username, email, coins, role, created_at 
     FROM usuarios 
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  return result.rows[0];
}

async function getUserByUsername(username) {
  const result = await db.query(
    `SELECT id, username, email, password_hash, coins, role, created_at 
     FROM usuarios 
     WHERE username = $1 AND deleted_at IS NULL`,
    [username]
  );
  return result.rows[0];
}

async function createUser(username, email, password) {
  const hashedPassword = await bcrypt.hash(password, 10);
  const result = await db.query(
    `INSERT INTO usuarios (username, email, password_hash, coins) 
     VALUES ($1, $2, $3, $4) 
     RETURNING id, username, email, coins, role, created_at`,
    [username, email, hashedPassword, 500] // monedas iniciales
  );
  return result.rows[0];
}

async function addCoins(userId, amount, skipCheck = false) {
  let updated = false;
  let retries = 3;
  while (!updated && retries > 0) {
    const user = await getUserById(userId);
    if (!user) throw new Error('Usuario no encontrado');
    if (!skipCheck && user.coins + amount < 0) throw new Error('Saldo insuficiente');
    const newCoins = user.coins + amount;
    const result = await db.query(
      `UPDATE usuarios 
       SET coins = $1, version = version + 1 
       WHERE id = $2 AND version = $3 
       RETURNING coins`,
      [newCoins, userId, user.version]
    );
    if (result.rowCount > 0) updated = true;
    else retries--;
  }
  if (!updated) throw new Error('Conflicto de concurrencia al actualizar monedas');
}

module.exports = { getUserById, getUserByUsername, createUser, addCoins };