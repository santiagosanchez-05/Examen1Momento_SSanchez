const express = require('express');
const { Pool, types } = require('pg');

types.setTypeParser(1082, (valor) => valor);

const app = express();
app.use(express.json());

const API_PORT = Number(process.env.API_PORT) || 3000;
const TOLERANCIA_MIN = Number(process.env.TOLERANCIA_MIN) || 0;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => console.error('Conexión con la BD perdida:', err.message));

const COLUMNAS = `
  id, codigo_empleado, nombre_empleado, fecha,
  to_char(hora_ingreso_programada, 'HH24:MI') AS hora_ingreso_programada,
  to_char(hora_ingreso_real,       'HH24:MI') AS hora_ingreso_real,
  to_char(hora_salida_programada,  'HH24:MI') AS hora_salida_programada,
  to_char(hora_salida_real,        'HH24:MI') AS hora_salida_real,
  estado, observacion`;

const REGEX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_ID = /^\d+$/;

const vacio = (v) => v === undefined || v === null || String(v).trim() === '';
const aMinutos = (hora) => {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
};
const fechaValida = (f) => REGEX_FECHA.test(f) && !isNaN(Date.parse(f));

function validar(b) {
  const errores = [];

  if (vacio(b.codigo_empleado)) errores.push('codigo_empleado es obligatorio');
  if (vacio(b.nombre_empleado)) errores.push('nombre_empleado es obligatorio');
  if (vacio(b.fecha)) errores.push('fecha es obligatoria');
  else if (!fechaValida(b.fecha)) errores.push('fecha debe tener formato YYYY-MM-DD');

  for (const campo of ['hora_ingreso_programada', 'hora_salida_programada']) {
    if (vacio(b[campo])) errores.push(`${campo} es obligatoria`);
    else if (!REGEX_HORA.test(b[campo])) errores.push(`${campo} debe tener formato HH:MM`);
  }
  for (const campo of ['hora_ingreso_real', 'hora_salida_real']) {
    if (!vacio(b[campo]) && !REGEX_HORA.test(b[campo])) errores.push(`${campo} debe tener formato HH:MM`);
  }
  if (errores.length > 0) return errores;

  if (aMinutos(b.hora_salida_programada) < aMinutos(b.hora_ingreso_programada)) {
    errores.push('La hora de salida programada no puede ser anterior a la de ingreso programada');
  }
  if (!vacio(b.hora_ingreso_real) && !vacio(b.hora_salida_real) &&
      aMinutos(b.hora_salida_real) < aMinutos(b.hora_ingreso_real)) {
    errores.push('La hora de salida real no puede ser anterior a la hora de ingreso real');
  }
  if (!vacio(b.observacion) && String(b.observacion).length > 255) {
    errores.push('observacion admite máximo 255 caracteres');
  }
  return errores;
}


function calcularEstado(b) {
  if (vacio(b.hora_ingreso_real) || vacio(b.hora_salida_real)) return 'INCOMPLETO';
  const minutosTarde = aMinutos(b.hora_ingreso_real) - aMinutos(b.hora_ingreso_programada);
  if (minutosTarde > TOLERANCIA_MIN) return 'ATRASO';
  if (aMinutos(b.hora_salida_real) < aMinutos(b.hora_salida_programada)) return 'SALIDA_ANTICIPADA';
  return 'PUNTUAL';
}


function valores(b) {
  return [
    String(b.codigo_empleado).trim().toUpperCase(),
    String(b.nombre_empleado).trim(),
    b.fecha,
    b.hora_ingreso_programada,
    vacio(b.hora_ingreso_real) ? null : b.hora_ingreso_real,
    b.hora_salida_programada,
    vacio(b.hora_salida_real) ? null : b.hora_salida_real,
    calcularEstado(b),
    vacio(b.observacion) ? null : String(b.observacion).trim(),
  ];
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(500).json({ status: 'error', database: 'no disponible' });
  }
});


app.get('/api/marcaciones', async (req, res) => {
  const { empleado, fecha } = req.query;
  const condiciones = [];
  const params = [];

  if (!vacio(empleado)) {
    params.push(String(empleado).trim().toUpperCase());
    condiciones.push(`codigo_empleado = $${params.length}`);
  }
  if (!vacio(fecha)) {
    if (!fechaValida(fecha)) return res.status(400).json({ error: 'fecha debe tener formato YYYY-MM-DD' });
    params.push(fecha);
    condiciones.push(`fecha = $${params.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  try {
    const result = await pool.query(`SELECT ${COLUMNAS} FROM marcaciones ${where} ORDER BY fecha DESC, id DESC`, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar marcaciones' });
  }
});

app.get('/api/marcaciones/:id', async (req, res) => {
  if (!REGEX_ID.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const result = await pool.query(`SELECT ${COLUMNAS} FROM marcaciones WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Marcación no encontrada' });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar la marcación' });
  }
});

app.post('/api/marcaciones', async (req, res) => {
  const errores = validar(req.body);
  if (errores.length > 0) return res.status(400).json({ errores });
  try {
    const result = await pool.query(
      `INSERT INTO marcaciones (codigo_empleado, nombre_empleado, fecha,
         hora_ingreso_programada, hora_ingreso_real, hora_salida_programada, hora_salida_real,
         estado, observacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUMNAS}`,
      valores(req.body)
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear la marcación' });
  }
});

app.put('/api/marcaciones/:id', async (req, res) => {
  if (!REGEX_ID.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  const errores = validar(req.body);
  if (errores.length > 0) return res.status(400).json({ errores });
  try {
    const result = await pool.query(
      `UPDATE marcaciones SET
         codigo_empleado = $1, nombre_empleado = $2, fecha = $3,
         hora_ingreso_programada = $4, hora_ingreso_real = $5,
         hora_salida_programada = $6, hora_salida_real = $7,
         estado = $8, observacion = $9
       WHERE id = $10
       RETURNING ${COLUMNAS}`,
      [...valores(req.body), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Marcación no encontrada' });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la marcación' });
  }
});

app.delete('/api/marcaciones/:id', async (req, res) => {
  if (!REGEX_ID.test(req.params.id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const result = await pool.query('DELETE FROM marcaciones WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Marcación no encontrada' });
    res.status(200).json({ mensaje: 'Marcación eliminada', id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar la marcación' });
  }
});


app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));


app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});


async function startServer() {
  const maxRetries = 10;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      app.listen(API_PORT, () => console.log(`API escuchando en el puerto ${API_PORT}`));
      return;
    } catch (err) {
      console.log(`Esperando a la base de datos (${process.env.DB_HOST})... intento ${i}/${maxRetries}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  console.error('No se pudo conectar a la base de datos.');
  process.exit(1);
}

startServer();