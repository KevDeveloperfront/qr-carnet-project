require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const basicAuth = require('basic-auth');
const { nanoid } = require('nanoid');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const BASE_URL = process.env.BASE_URL || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =======================
   DATABASE BOOTSTRAP
======================= */

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.sqlite');

// 1️⃣ Asegurar carpeta
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error('❌ No se pudo crear data/', err);
  process.exit(1);
}

// 2️⃣ Abrir DB con flags explícitos
const db = new sqlite3.Database(
  DB_FILE,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error('❌ SQLITE_CANTOPEN', err);
      process.exit(1); // ⛔ NO seguimos sin DB
    }
    console.log('✅ SQLite conectado:', DB_FILE);
  }
);

// 3️⃣ Inicializar esquema
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS fichas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      rango TEXT,
      comando TEXT,
      tipo_sangre TEXT,
      alergias TEXT,
      condiciones_medicas TEXT,
      contactos TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

/* =======================
   AUTH
======================= */

function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== ADMIN_USER || user.pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  next();
}

/* =======================
   ROUTES
======================= */

app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/fichas', requireAdmin, (req, res) => {
  const { nombre, rango, comando, tipo_sangre, alergias, condiciones, contactos } = req.body;
  if (!nombre?.trim()) {
    return res.status(400).json({ error: 'nombre is required' });
  }

  const id = 'fc_' + nanoid(10);
  const alergiasStr = JSON.stringify(
    Array.isArray(alergias) ? alergias : (alergias || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  const contactosStr = JSON.stringify(
    Array.isArray(contactos) ? contactos : (contactos || '').split('\n').map(s => s.trim()).filter(Boolean)
  );

  db.run(
    `INSERT INTO fichas VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, nombre, rango || '', comando || '', tipo_sangre || '', alergiasStr, condiciones || '', contactosStr],
    (err) => {
      if (err) {
        console.error('DB insert error', err);
        return res.status(500).json({ error: 'DB error' });
      }
      const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
      res.json({ id, url: `${origin}/qr/${id}` });
    }
  );
});

app.get('/qr/:id', (req, res) => {
  db.get('SELECT * FROM fichas WHERE id = ?', [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).send('Ficha no encontrada');
    res.json(row);
  });
});

/* =======================
   SERVER
======================= */

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
