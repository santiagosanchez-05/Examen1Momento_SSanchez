const API = '/api/marcaciones';

const form = document.getElementById('form-marcacion');
const tabla = document.getElementById('tabla');
const mensaje = document.getElementById('mensaje');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

async function cargarMarcaciones() {
  try {
    const res = await fetch(API);
    const lista = await res.json();
    if (!res.ok) throw new Error(lista.error || `Error HTTP ${res.status}`);

    tabla.innerHTML = lista.length === 0
      ? '<tr><td colspan="10">Sin registros</td></tr>'
      : lista.map((m) => `
        <tr>
          <td>${esc(m.id)}</td>
          <td>${esc(m.codigo_empleado)}</td>
          <td>${esc(m.nombre_empleado)}</td>
          <td>${esc(m.fecha)}</td>
          <td>${esc(m.hora_ingreso_programada)}</td>
          <td>${esc(m.hora_ingreso_real)}</td>
          <td>${esc(m.hora_salida_programada)}</td>
          <td>${esc(m.hora_salida_real)}</td>
          <td>${esc(m.estado)}</td>
          <td>${esc(m.observacion)}</td>
        </tr>`).join('');
  } catch (err) {
    tabla.innerHTML = '<tr><td colspan="10">No se pudieron cargar los datos</td></tr>';
    mensaje.textContent = `Error: ${err.message}`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.errores ? data.errores.join(', ') : data.error);

    mensaje.textContent = `Marcación #${data.id} registrada. Estado: ${data.estado}`;
    form.reset();
    cargarMarcaciones();
  } catch (err) {
    mensaje.textContent = `Error: ${err.message}`;
  }
});

cargarMarcaciones();
