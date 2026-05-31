const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { getUserByUsername, createUser } = require('../services/userService');
const { formatValidationErrors } = require('../utils/helpers');

const router = express.Router();

router.post('/register', [
  body('username').isLength({ min: 3 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: formatValidationErrors(errors) });
  }
  try {
    const { username, email, password } = req.body;
    const existing = await getUserByUsername(username);
    if (existing) return res.status(400).json({ error: 'El usuario ya existe' });
    const user = await createUser(username, email, password);
    await db.query(
      `INSERT INTO actividad (usuario_id, tipo, descripcion) VALUES ($1, $2, $3)`,
      [user.id, 'registration', `Usuario ${username} se registró`]
    );
    res.status(201).json({ message: 'Usuario registrado', user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        coins: user.coins,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;