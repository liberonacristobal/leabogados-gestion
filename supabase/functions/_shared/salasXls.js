// Programación de salas que el Poder Judicial envía por correo (suscripción de Programación de Salas): un Excel por Corte con las
// tablas ordinarias confirmadas de la semana siguiente. Funciones puras, con prueba en tests/salas-xls.test.mjs; la lectura del
// archivo (SheetJS) la hace la edge causas-tablas y entrega aquí las filas como arreglo de arreglos.
const nl = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const SUPREMA = '6050000';

// «02/11/2026» → «2026-11-02»; una fecha que no existe en el calendario → null.
export function fechaISO(txt) {
  const m = String(txt ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(y, mo - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === mo - 1 && f.getUTCDate() === d ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
}

const ORD = { 1: 'Primera', 2: 'Segunda', 3: 'Tercera', 4: 'Cuarta', 5: 'Quinta', 6: 'Sexta', 7: 'Séptima', 8: 'Octava' };
export const nombreSala = (n) => { const k = Number(n); return k >= 1 && ORD[k] ? `${ORD[k]} Sala` : String(n || '').trim() ? `Sala ${String(n).trim()}` : ''; };

// Filas del Excel (primera hoja, con encabezado). Las columnas se buscan por su nombre: la Suprema trae «Glosa Recurso» de más (la
// materia en palabras; su «Tipo Recurso» es un código), por eso el recurso une las dos.
// Se descartan las filas sin fecha válida o sin rol. Solo tablas ordinarias (las extraordinarias no vienen en este correo).
export function leerTablaSalas(aoa) {
  const filas = Array.isArray(aoa) ? aoa : [];
  const cab = (filas[0] || []).map((x) => nl(x));
  const col = (n) => cab.indexOf(n);
  const iCorte = col('corte'), iFecha = col('fecha'), iSala = col('sala'), iTipoTabla = col('tipo de tabla'), iRec = col('tipo recurso'),
    iGlosa = col('glosa recurso'), iCar = col('caratulado'), iRol = col('rol'), iEra = col('era');
  if ([iCorte, iFecha, iSala, iRol, iEra, iCar].some((i) => i < 0)) return { ok: false, motivo: 'el archivo no trae las columnas esperadas', filas: [] };
  const out = [];
  for (const f of filas.slice(1)) {
    const fecha = fechaISO(f[iFecha]);
    const rol = String(f[iRol] ?? '').trim().replace(/^0+/, ''), anio = String(f[iEra] ?? '').trim();
    if (!fecha || !rol || !/^\d{4}$/.test(anio)) continue;
    out.push({ corte: String(f[iCorte] || '').trim(), fecha, sala: String(f[iSala] || '').trim(), tabla: String(iTipoTabla >= 0 ? f[iTipoTabla] : '').trim(),
      recurso: [iGlosa >= 0 ? f[iGlosa] : '', iRec >= 0 ? f[iRec] : ''].map((x) => String(x || '').trim()).filter(Boolean).join(' '), caratulado: String(f[iCar] || '').trim(), rol, anio });
  }
  return { ok: true, filas: out };
}

// Causas nuestras que aparecen en esas filas, con la forma que ya entiende la revisión de Programación de Salas de causas-tablas
// ({causa_id, filas:[{fecha, sala, numero, caratula, ingreso}]}). Misma regla que el Monitor (buscarEnSala): mismo rol y año, en la misma
// Corte y, en las de Apelaciones, la misma materia que su libro o una palabra de la carátula (el rol se repite en cada libro). En la
// Corte Suprema el rol es único en el año. El N° de la tabla no viene en el archivo y no se inventa.
export function cruzarSalas(filas, causas) {
  const out = [];
  for (const c of causas || []) {
    const suprema = c.instancia === 'suprema' || String(c.corte_codigo) === SUPREMA;
    const rolTxt = String(Number(c.rol)), anio = String(c.anio);
    const lib = nl(c.libro_nombre).replace(/[^a-z ]/g, '').split(' ').find((w) => w.length > 3)?.slice(0, 6) || '';
    const pal = new Set(nl(c.caratula).replace(/[^a-z ]/g, ' ').split(' ').filter((w) => w.length >= 5));
    const hits = (filas || []).filter((f) => {
      if (f.rol !== rolTxt || f.anio !== anio) return false;
      if (suprema ? !/suprema/.test(nl(f.corte)) : nl(f.corte) !== nl(c.corte_nombre)) return false;
      if (suprema) return true;
      const libOk = !!lib && nl(f.recurso).includes(lib);
      const carOk = nl(f.caratulado).replace(/[^a-z ]/g, ' ').split(' ').some((w) => pal.has(w));
      return libOk || carOk || (!lib && !pal.size);
    });
    if (hits.length) out.push({ causa_id: c.id, filas: hits.map((f) => ({ fecha: f.fecha, sala: nombreSala(f.sala), numero: '', caratula: f.caratulado, ingreso: '' })) });
  }
  return out;
}
