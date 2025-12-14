// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const basicAuth = require('basic-auth');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const BASE_URL = process.env.BASE_URL || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   DATABASE INITIALIZATION
   ========================= */

// Paths ABSOLUTOS y controlados
const DATA_DIR = path.resolve(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.sqlite');

// Asegurar directorio
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Abrir SQLite con flags CORRECTOS
const db = new sqlite3.Database(
  DB_FILE,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
  (err) => {
    if (err) {
      console.error('❌ SQLITE OPEN ERROR:', err);
      process.exit(1); // ❗ aborta si no hay DB
    } else {
      console.log('✅ SQLite conectado:', DB_FILE);
    }
  }
);

// Crear tabla
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

/* =========================
   AUTH MIDDLEWARE
   ========================= */

function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== ADMIN_USER || user.pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  next();
}

/* =========================
   STATIC FILES
   ========================= */

app.use('/public', express.static(path.join(__dirname, 'public')));

/* =========================
   ROUTES
   ========================= */

// Admin UI
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Crear ficha
app.post('/api/fichas', requireAdmin, (req, res) => {
  const { nombre, rango, comando, tipo_sangre, alergias, condiciones, contactos } = req.body;
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'nombre is required' });
  }

  const id = 'fc_' + nanoid(10);
  const alergiasStr = JSON.stringify(
    Array.isArray(alergias)
      ? alergias
      : alergias
        ? alergias.toString().split(',').map(s => s.trim()).filter(Boolean)
        : []
  );

  const contactosStr = JSON.stringify(
    Array.isArray(contactos)
      ? contactos
      : contactos
        ? contactos.toString().split('\n').map(s => s.trim()).filter(Boolean)
        : []
  );

  db.run(
    `INSERT INTO fichas 
     (id, nombre, rango, comando, tipo_sangre, alergias, condiciones_medicas, contactos)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      nombre,
      rango || '',
      comando || '',
      tipo_sangre || '',
      alergiasStr,
      condiciones || '',
      contactosStr
    ],
    (err) => {
      if (err) {
        console.error('DB INSERT ERROR:', err);
        return res.status(500).json({ error: 'DB error' });
      }

      const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
      res.json({ id, url: `${origin}/qr/${id}` });
    }
  );
});

// API pública
app.get('/api/fichas/:id', (req, res) => {
  db.get('SELECT * FROM fichas WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'Not found' });

    res.json({
      id: row.id,
      nombre: row.nombre,
      rango: row.rango,
      comando: row.comando,
      tipo_sangre: row.tipo_sangre,
      alergias: JSON.parse(row.alergias || '[]'),
      condiciones_medicas: row.condiciones_medicas,
      contactos: JSON.parse(row.contactos || '[]'),
      created_at: row.created_at
    });
  });
});

// Render ficha
app.get('/qr/:id', (req, res) => {
  db.get('SELECT * FROM fichas WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).send('DB error');
    if (!row) return res.status(404).send('<h2>Ficha no encontrada</h2>');

    const tpl = fs.readFileSync(
      path.join(__dirname, 'templates', 'profile.html'),
      'utf8'
    );

    const html = tpl
      .replaceAll('{{id}}', row.id)
      .replaceAll('{{nombre}}', escapeHtml(row.nombre))
      .replaceAll('{{rango}}', escapeHtml(row.rango || ''))
      .replaceAll('{{comando}}', escapeHtml(row.comando || ''))
      .replaceAll('{{tipo_sangre}}', escapeHtml(row.tipo_sangre || '—'))
      .replaceAll('{{alergias}}', escapeHtml(JSON.parse(row.alergias || '[]').join(', ') || '—'))
      .replaceAll('{{condiciones}}', escapeHtml(row.condiciones_medicas || '—'))
      .replaceAll('{{contactos}}', escapeHtml(JSON.parse(row.contactos || '[]').join('\n') || '—'))
      .replaceAll('{{BASE_URL}}', BASE_URL || `${req.protocol}://${req.get('host')}`);

    res.send(html);
  });
});

// PDF
app.get('/qr/:id/pdf', async (req, res) => {
  const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/qr/${req.params.id}`;

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${req.params.id}.pdf"`
    });

    res.send(pdf);
  } catch (err) {
    console.error('PDF ERROR:', err);
    res.status(500).send('Error generating PDF');
  }
});

// Root
app.get('/', (_, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});

/* =========================
   UTILS
   ========================= */

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])
  );
}