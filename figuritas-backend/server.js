require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

// Importar rutas
const authRoutes = require('./routes/authRoutes');
const albumRoutes = require('./routes/albumRoutes');
const stickerRoutes = require('./routes/stickerRoutes');
const packRoutes = require('./routes/packRoutes');
const marketRoutes = require('./routes/marketRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const configRoutes = require('./routes/configRoutes');
const probabilitiesRoutes = require('./routes/probabilitiesRoutes');

// Middleware error handler
const errorHandler = require('./middleware/errorHandler');

// Configurar conexión a PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20, // max conexiones simultáneas
  idleTimeoutMillis: 30000,
});

// Probar conexión
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error conectando a la base de datos:', err.stack);
  } else {
    console.log('✅ Conectado a PostgreSQL');
    release();
  }
});

// Guardar pool en objeto global para usar en otros módulos
global.db = pool;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // para imágenes en base64

// Ruta de salud
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Montar rutas
app.use('/api/auth', authRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/stickers', stickerRoutes);
app.use('/api/pack', packRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/config', configRoutes);
app.use('/api/probabilities', probabilitiesRoutes);

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});