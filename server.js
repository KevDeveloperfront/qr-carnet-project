require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const basicAuth = require('basic-auth');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const BASE_URL = process.env.BASE_URL || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👉 MOTOR DE VISTAS (HTML)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/* =======================
   DATABASE
======================= */

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new sqlite3.Database(DB_FILE);
console.log('✅ SQLite conectado:', DB_FILE);

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

/* =======================
   AUTH
======================= */

function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== ADMIN_USER || user.pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Auth required');
  }
  next();
}

/* =======================
   STATIC
======================= */

app.use('/public', express.static(path.join(__dirname, 'public')));

/* =======================
   ADMIN
======================= */

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =======================
   API (JSON)
======================= */

app.post('/api/fichas', requireAdmin, (req, res) => {
  const { nombre, rango } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const id = 'fc_' + nanoid(10);

  db.run(
    `INSERT INTO fichas (id, nombre, rango) VALUES (?, ?, ?)`,
    [id, nombre, rango || ''],
    () => {
      const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
      res.json({ id, url: `${origin}/qr/${id}` });
    }
  );
});

app.get('/api/fichas/:id', (req, res) => {
  db.get(
    'SELECT * FROM fichas WHERE id = ?',
    [req.params.id],
    (err, row) => {
      if (!row) return res.status(404).json({ error: 'No encontrada' });
      res.json(row);
    }
  );
});

/* =======================
   HTML PÚBLICO (QR)
======================= */

app.get('/qr/:id', (req, res) => {
  db.get(
    'SELECT * FROM fichas WHERE id = ?',
    [req.params.id],
    (err, ficha) => {
      if (!ficha) return res.status(404).send('Ficha no encontrada');
      res.render('qr', { ficha });
    }
  );
});

/* =======================
   SERVER
======================= */

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
