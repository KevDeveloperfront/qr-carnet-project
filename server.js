// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const basicAuth = require('basic-auth');
const fs = require('fs');
const puppeteer = require('puppeteer');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'changeme';
const BASE_URL = process.env.BASE_URL || '';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB init
const dbFile = path.join(__dirname, 'data', 'db.sqlite');
const dbExists = fs.existsSync(dbFile);
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS fichas (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    rango TEXT,
    comando TEXT,
    tipo_sangre TEXT,
    alergias TEXT,
    condiciones_medicas TEXT,
    contactos TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Basic Auth middleware for admin routes
function requireAdmin(req, res, next) {
  const user = basicAuth(req);
  if (!user || user.name !== ADMIN_USER || user.pass !== ADMIN_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required.');
  }
  next();
}

// Serve static public files (admin UI is static and protected via middleware where needed)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Admin pages (static) - protect these routes
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: create ficha (protected)
app.post('/api/fichas', requireAdmin, (req, res) => {
  const { nombre, rango, comando, tipo_sangre, alergias, condiciones, contactos } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'nombre is required' });

  const id = 'fc_' + nanoid(10);
  const alergiasStr = Array.isArray(alergias) ? JSON.stringify(alergias) : (alergias ? JSON.stringify(alergias.toString().split(',').map(s => s.trim()).filter(Boolean)) : JSON.stringify([]));
  const contactosStr = Array.isArray(contactos) ? JSON.stringify(contactos) : (contactos ? JSON.stringify(contactos.toString().split('\n').map(s => s.trim()).filter(Boolean)) : JSON.stringify([]));

  db.run(`INSERT INTO fichas (id, nombre, rango, comando, tipo_sangre, alergias, condiciones_medicas, contactos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, nombre, rango || '', comando || '', tipo_sangre || '', alergiasStr, condiciones || '', contactosStr],
    function(err) {
      if (err) {
        console.error('DB insert error', err);
        return res.status(500).json({ error: 'DB error' });
      }
      // Return id and public URL for the QR
      const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
      res.json({ id, url: `${origin}/qr/${id}` });
    });
});

// Public API: get ficha JSON (for debug)
app.get('/api/fichas/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM fichas WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    if (!row) return res.status(404).json({ error: 'Not found' });

    // parse JSON fields
    try {
      const parsed = {
        id: row.id,
        nombre: row.nombre,
        rango: row.rango,
        comando: row.comando,
        tipo_sangre: row.tipo_sangre,
        alergias: JSON.parse(row.alergias || '[]'),
        condiciones_medicas: row.condiciones_medicas,
        contactos: JSON.parse(row.contactos || '[]'),
        created_at: row.created_at
      };
      res.json(parsed);
    } catch (e) {
      res.status(500).json({ error: 'Error parsing data' });
    }
  });
});

// Public page: render profile (simple server-side render)
app.get('/qr/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM fichas WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).send('DB error');
    if (!row) return res.status(404).send('<h2>Ficha no encontrada</h2>');

    // parse fields for template
    let alergias = [];
    let contactos = [];
    try {
      alergias = JSON.parse(row.alergias || '[]');
    } catch (e) { alergias = []; }
    try {
      contactos = JSON.parse(row.contactos || '[]');
    } catch (e) { contactos = []; }

    // Render minimal HTML using template file
    const tpl = fs.readFileSync(path.join(__dirname, 'templates', 'profile.html'), 'utf8');
    const html = tpl
      .replaceAll('{{id}}', row.id)
      .replaceAll('{{nombre}}', escapeHtml(row.nombre))
      .replaceAll('{{rango}}', escapeHtml(row.rango || ''))
      .replaceAll('{{comando}}', escapeHtml(row.comando || ''))
      .replaceAll('{{tipo_sangre}}', escapeHtml(row.tipo_sangre || '—'))
      .replaceAll('{{alergias}}', escapeHtml(alergias.join(', ') || '—'))
      .replaceAll('{{condiciones}}', escapeHtml(row.condiciones_medicas || '—'))
      .replaceAll('{{contactos}}', escapeHtml(contactos.join('\n') || '—'))
      .replaceAll('{{BASE_URL}}', BASE_URL || `${req.protocol}://${req.get('host')}`);

    res.send(html);
  });
});

// PDF generation endpoint using Puppeteer (render the same /qr/:id and print to PDF)
app.get('/qr/:id/pdf', async (req, res) => {
  const id = req.params.id;
  // locate URL to render
  const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/qr/${id}`;
  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox','--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    });
    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length,
      'Content-Disposition': `attachment; filename="${id}.pdf"`
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Puppeteer error', err);
    res.status(500).send('Error generating PDF');
  }
});

// Serve root - redirect to admin (or info)
app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// helper to escape HTML - simple
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function (m) {
    return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m];
  });
}
