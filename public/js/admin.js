// public/js/admin.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  const crearBtn = document.getElementById('crear');
  const resetBtn = document.getElementById('reset');
  const qrContainer = document.getElementById('qr');
  const result = document.getElementById('result');
  let qrcode = null;

  function collect() {
    const fd = new FormData(form);
    const obj = {};
    for (const [k,v] of fd.entries()) {
      obj[k] = v ? v.toString().trim() : '';
    }
    return obj;
  }

  async function createFicha() {
    const data = collect();
    if (!data.nombre) { alert('Nombre requerido'); return; }

    const payload = {
      nombre: data.nombre,
      rango: data.rango,
      comando: data.comando,
      tipo_sangre: data.tipo_sangre,
      alergias: data.alergias,
      condiciones: data.condiciones,
      contactos: data.contactos
    };

    try {
      const res = await fetch('/api/fichas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const txt = await res.text();
        alert('Error: ' + txt);
        return;
      }
      const json = await res.json();
      const url = json.url || `${location.origin}/qr/${json.id}`;

      result.textContent = `ID: ${json.id}\nURL: ${url}`;

      // generar qr en cliente
      qrContainer.innerHTML = '';
      qrcode = new QRCode(qrContainer, { text: url, width: 200, height: 200 });
    } catch (err) {
      console.error(err);
      alert('Error guardando ficha');
    }
  }

  crearBtn.addEventListener('click', createFicha);
  resetBtn.addEventListener('click', () => {
    form.reset();
    qrContainer.innerHTML = '';
    result.textContent = '';
  });
});
