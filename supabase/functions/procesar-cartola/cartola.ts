// Parser de cartolas BICE — COPIA de src/cartola.js para la Edge Function (Deno).
// Lógica pura (sin UI ni red). Si cambias src/cartola.js, actualiza también este archivo.

export const RUT_PROPIO = '77.700.387-9'
export const CUENTAS = [
  { rol: 'honorarios', num: '1403834', codigo: '403', etiqueta: '01-40383-4' },
  { rol: 'gastos',     num: '1383922', codigo: '138', etiqueta: '01-38392-2' },
]

export const normRut = (r: unknown) => String(r || '').toUpperCase().replace(/[^0-9K]/g, '')
export const esRutPropio = (r: unknown) => normRut(r) === normRut(RUT_PROPIO)

export function formatRut(rut: unknown) {
  const n = normRut(rut); if (n.length < 2) return (rut as string) || null
  const dv = n.slice(-1), body = n.slice(0, -1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`
}
export function rutValido(rut: unknown) {
  const n = normRut(rut); if (n.length < 2) return false
  const dv = n.slice(-1), body = n.slice(0, -1)
  if (!/^\d+$/.test(body)) return false
  let sum = 0, mul = 2
  for (let i = body.length - 1; i >= 0; i--) { sum += parseInt(body[i], 10) * mul; mul = mul === 7 ? 2 : mul + 1 }
  const r = 11 - (sum % 11); const dvc = r === 11 ? '0' : r === 10 ? 'K' : String(r)
  return dvc === dv
}
export function rolDeCuenta(raw: unknown) {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return null
  return CUENTAS.find(c => d.includes(c.num)) || null
}

const _flat = (s: unknown) => String(s == null ? '' : s).trim()
const _norm = (s: unknown) => _flat(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function parseMonto(v: unknown) {
  if (v == null) return 0
  if (typeof v === 'number') return Math.round(Math.abs(v))
  let s = String(v).trim().replace(/\s/g, '')
  if (!s || s === '-') return 0
  s = s.replace(/[.,]\d{1,2}$/, '')
  s = s.replace(/[^\d]/g, '')
  const n = parseInt(s, 10)
  return isNaN(n) ? 0 : n
}

function parseDDMM(raw: unknown) {
  // "Consulta de movimientos" de BICE trae la fecha como yyyymmdd ("20261009"), sin separadores.
  const c = String(raw || '').trim().match(/^(20\d{2})(\d{2})(\d{2})$/)
  if (c) return { d: c[3], mm: c[2], y: c[1] as string | null }
  const m = String(raw || '').match(/(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/)
  if (!m) return null
  const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : null
  return { d: m[1].padStart(2, '0'), mm: m[2].padStart(2, '0'), y }
}
// Fecha COMPLETA de la glosa: dd-mm-yyyy / dd/mm/yyyy o ISO yyyy-mm-dd ("Transferencia de CLIENTE … el 2026-09-07 a las 00:24").
// Igual que src/cartola.js. Sin esto, una fila sin fecha de columna caía al 1-ene (7 traspasos sept-2026, auditoría 2026-10-13).
export function fechaDesdeGlosa(desc: unknown) {
  const s = String(desc || '')
  let m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/)
  if (m) return { d: m[1].padStart(2, '0'), mm: m[2].padStart(2, '0'), y: m[3] }
  m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (m) return { d: m[3].padStart(2, '0'), mm: m[2].padStart(2, '0'), y: m[1] }
  return null
}
function anioDesdeGlosa(desc: unknown) { const f = fechaDesdeGlosa(desc); return f ? f.y : null }

function cyrb53(str: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
// deno-lint-ignore no-explicit-any
export function hashMovimiento(m: any) {
  return cyrb53(`${m.cuenta}|${m.fecha}|${m.tipo}|${m.monto}|${m.rut_contraparte || ''}|${m.n_operacion || ''}|${m.descripcion}`)
}
// Huella de la transferencia: fecha y hora REAL de la glosa ("el 19-06-2026 a las 18:17:32"). Igual que src/cartola.js:
// la misma transferencia puede llegar con otra fecha contable y sin n° de operación → cuenta|tipo|monto|fecha-hora de la glosa|contraparte
// (cuenta o RUT: dos retiros iguales al mismo minuto a socios distintos no son el mismo movimiento).
// deno-lint-ignore no-explicit-any
export function huellaGlosa(m: any) {
  const s = String(m?.descripcion || '').replace(/\s+/g, '')
  // Fecha con '-' (transferencias a terceros) o '/' (abonos y traspasos entre cuentas propias).
  let g = s.match(/el(\d{2})[-/](\d{2})[-/](\d{4})alas(\d{2}):(\d{2})/i)
  if (!g) { const i = s.match(/el(\d{4})-(\d{2})-(\d{2})alas(\d{2}):(\d{2})/i); if (i) g = [i[0], i[3], i[2], i[1], i[4], i[5]] as unknown as RegExpMatchArray }   // formato ISO
  if (!g) return null
  const contra = (s.match(/acuenta(\d{4,})/i) || [])[1] || ((s.match(/haciacuentaN?°?([\d-]{6,})/i) || [])[1] || '').replace(/\D/g, '') || normRut((s.match(/Rut:?(\d{1,3}(?:\.?\d{3})+-?[\dkK])/i) || [])[1])
  if (!contra) return null
  return `${m.cuenta}|${m.tipo}|${Math.round(Number(m.monto) || 0)}|${g[3]}-${g[2]}-${g[1]} ${g[4]}:${g[5]}|${contra}`
}

const RUT_RE = String.raw`(\d{1,3}(?:\.?\d{3})+-?[\dkK])`
const reAbono = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT_RE}`, 'i')
const reCCA = new RegExp(`originador Rut:?\\s*${RUT_RE}\\s*Nombre:?\\s*(.+?)\\s*(?:\\(N\\.?Ref|$)`, 'i')
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT_RE}`, 'i')
// Formato D — "Transferencia de ORIGEN Rut R1 desde Banco X a DESTINO Rut R2 a Cuenta Corriente de Banco Y": contraparte = DESTINO en un cargo, ORIGEN en un abono.
const reTransfDe = new RegExp(`^\\s*Transferencia de (.+?)\\s+Rut\\s*${RUT_RE}\\s+desde\\s+.+?\\s+a\\s+(.+?)\\s+Rut\\s*${RUT_RE}\\s+a\\s+Cuenta`, 'i')

function extraerContraparte(desc: string, tipo: string) {
  let m
  if ((m = desc.match(reAbono))) return { nombre: _flat(m[1]) || null, rut: _flat(m[2]) || null }
  if ((m = desc.match(reCCA))) return { rut: _flat(m[1]) || null, nombre: _flat(m[2]) || null }
  if ((m = desc.match(reTransf))) {
    const nombre = _flat(m[1]) || null, rut = _flat(m[2]) || null
    // "Transf. a terceros a cuenta <nuestra>, Liberona Escala, Rut <nuestro>": el banco enmascara al pagador (un tercero con cuenta BICE) mostrando NUESTROS datos → contraparte desconocida, no somos nosotros.
    if ((rut && esRutPropio(rut)) || /liberona escala|quad ases/.test(_norm(nombre))) return { nombre: null, rut: null }
    return { nombre, rut }
  }
  if ((m = desc.match(reTransfDe))) {
    const lado = tipo === 'abono' ? { nombre: _flat(m[1]), rut: _flat(m[2]) } : { nombre: _flat(m[3]), rut: _flat(m[4]) }
    if (!lado.rut || esRutPropio(lado.rut) || /liberona escala|quad ases/.test(_norm(lado.nombre))) return { nombre: null, rut: null }
    return { nombre: lado.nombre || null, rut: lado.rut }
  }
  return { rut: null, nombre: null }
}
function detectarInterno(desc: string, _rut: string | null) {
  const d = _norm(desc)
  // Traspaso ENTRE NUESTRAS cuentas: el banco lo declara "cuentas propias", o el REMITENTE es el propio estudio
  // (de LIBERONA ESCALA ... a LIBERONA ESCALA / de QUAD ASES).
  // NO basta con que el RUT de la glosa sea el nuestro: cuando un tercero con cuenta BICE nos paga, el banco
  // ENMASCARA al pagador y muestra NUESTRO nombre/RUT ("Transf. a terceros a cuenta <nuestra>, Liberona Escala,
  // Rut 77.700.387-9" o "de CLIENTE ... a BENEFICIARIO Rut 77.700.387-9"). Eso es un pago de TERCERO, no interno.
  if (d.includes('cuentas propias')) return true
  if (/transferencia de\s+liberona escala/.test(d) && /a\s+liberona escala/.test(d)) return true
  if (/transferencia de\s+quad ases/.test(d)) return true
  return false
}
function etiquetaInterno(desc: string, tipo: string, cuentaPropia: string) {
  const found = (String(desc).match(/\d{2}-?\d{4,5}-?[\dkK]/g) || []).map(rolDeCuenta).filter(Boolean)
  const propiaRol = rolDeCuenta(cuentaPropia)?.rol
  const contra = found.find(c => c!.rol !== propiaRol) || found.find(Boolean)
  const et = contra ? contra.etiqueta : ''
  return tipo === 'abono' ? `Traspaso interno · abono desde cuenta ${et}` : `Traspaso interno · cargo hacia cuenta ${et}`
}

// deno-lint-ignore no-explicit-any
export function parseCartola(aoa: any[], { filename = '' }: { filename?: string } = {}) {
  const rows = (aoa || []).map(r => Array.isArray(r) ? r : [r])
  let cuenta = '', rol: string | null = null
  for (let i = 0; i < Math.min(25, rows.length) && !cuenta; i++) {
    for (const cell of rows[i]) {
      const t = _flat(cell); const r = rolDeCuenta(t)
      if (r && t.replace(/\D/g, '').length >= 5) { cuenta = r.etiqueta; rol = r.rol; break }
    }
  }
  let anioFallback: string | null = null
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const ym = rows[i].map(_flat).join(' ').match(/\b(20\d{2})\b/g)
    if (ym) anioFallback = ym[ym.length - 1]
  }
  anioFallback = anioFallback || String(new Date().getFullYear())
  // Última fecha completa del encabezado (= "Hasta"): respaldo cuando una fila no trae fecha (antes caía al 1-ene).
  let fechaHeader: { d: string; mm: string; y: string } | null = null
  // Solo filas ANTES de la tabla de movimientos (si no, toma la fecha de la glosa de algún movimiento).
  const _hdr = rows.findIndex(r => { const c = r.map(_norm); return c.some((x: string) => x.includes('descrip')) && c.some((x: string) => x.includes('abono')) })
  for (let i = 0; i < Math.min(_hdr >= 0 ? _hdr : 25, rows.length); i++) { for (const cell of rows[i]) { const f = fechaDesdeGlosa(_flat(cell)); if (f) fechaHeader = f } }
  // Saldos del período (si vienen): saldo inicial + abonos − cargos = saldo final, y encadenan cartolas de la misma cuenta.
  // Se buscan en TODA la hoja: en la cartola BICE vienen al final, en el «Resumen del período» (filas ~51–52).
  const saldoDe = (rx: RegExp) => {
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].map(_norm); const k = cells.findIndex((c: string) => rx.test(c)); if (k < 0) continue
      const v = parseMonto((rows[i + 1] || [])[k]) || parseMonto(rows[i].slice(k + 1).find((x: unknown) => parseMonto(x) > 0)); if (v) return v
    }
    return null
  }
  const saldoInicial = saldoDe(/^saldo inicial/), saldoFinal = saldoDe(/^saldo (final|contable)/)
  let totalAbonos: number | null = null, totalCargos: number | null = null
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(_norm)
    const ci = cells.findIndex((c: string) => c.includes('total') && c.includes('cargo'))
    const ai = cells.findIndex((c: string) => c.includes('total') && c.includes('abono'))
    if (ci >= 0 && ai >= 0) {
      const val = rows[i + 1] || []
      let vc = parseMonto(val[ci]), va = parseMonto(val[ai])
      if (!vc && !va) { vc = parseMonto(rows[i][ci]); va = parseMonto(rows[i][ai]) }
      totalCargos = vc; totalAbonos = va; break
    }
  }
  let hIdx = -1
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(_norm)
    if (cells.some((c: string) => c.includes('descrip')) && cells.some((c: string) => c.includes('abono'))) { hIdx = i; break }
  }
  if (hIdx < 0) return { cuenta, rol_cuenta: rol, anio: anioFallback, totalAbonos, totalCargos, movimientos: [], error: 'No se encontró la fila de encabezados (Descripción/Abonos).' }
  const header = rows[hIdx].map(_norm)
  const col = (...keys: string[]) => header.findIndex((h: string) => keys.some(k => h.includes(k)))
  const iFecha = col('fecha'), iDoc = col('documento', 'n° doc', 'nro doc', 'docto', 'doc'), iDesc = col('descrip'), iCargo = col('cargo'), iAbono = col('abono')

  // deno-lint-ignore no-explicit-any
  const movimientos: any[] = []
  let lastFecha: { d: string; mm: string; y: string | null } | null = null
  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const desc = _flat(iDesc >= 0 ? row[iDesc] : '')
    if (!desc) break
    if (_norm(desc).includes('saldo inicial')) continue
    const fRaw = _flat(iFecha >= 0 ? row[iFecha] : '')
    if (fRaw && fRaw !== '-') { const p = parseDDMM(fRaw); if (p) lastFecha = p }
    const fp = lastFecha
    const cargo = parseMonto(iCargo >= 0 ? row[iCargo] : 0)
    const abono = parseMonto(iAbono >= 0 ? row[iAbono] : 0)
    if (cargo === 0 && abono === 0) continue
    const tipo = abono > 0 ? 'abono' : 'cargo'
    const monto = abono > 0 ? abono : cargo
    // Fecha: columna (forward-fill) > fecha completa de la glosa > "Hasta" del encabezado > 1-ene (último recurso).
    const dm = fp || fechaDesdeGlosa(desc) || fechaHeader
    const anio = anioDesdeGlosa(desc) || (dm && dm.y) || anioFallback
    const fecha = dm ? `${anio}-${dm.mm}-${dm.d}` : `${anio}-01-01`
    const cp = extraerContraparte(desc, tipo)
    let rut = cp.rut ? formatRut(cp.rut) : null, nombre = cp.nombre
    const interno = detectarInterno(desc, rut)
    if (interno) { rut = null; nombre = etiquetaInterno(desc, tipo, cuenta) }
    const n_operacion = _flat(iDoc >= 0 ? row[iDoc] : '') || null
    const mov = { cuenta, rol_cuenta: rol, fecha, tipo, rut_contraparte: rut, nombre_contraparte: nombre, monto, n_operacion, descripcion: desc, es_interno: interno, hash: '' }
    mov.hash = hashMovimiento(mov)
    movimientos.push(mov)
  }
  // «Hasta» del encabezado = el banco cubre hasta ese día aunque no haya movimientos (la cobertura no sale del último movimiento).
  const fechaHasta = fechaHeader ? `${fechaHeader.y}-${fechaHeader.mm}-${fechaHeader.d}` : null
  return { cuenta, rol_cuenta: rol, anio: anioFallback, filename, totalAbonos, totalCargos, saldoInicial, saldoFinal, fechaHasta, movimientos }
}
