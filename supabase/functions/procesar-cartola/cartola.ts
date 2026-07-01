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
  const m = String(raw || '').match(/(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/)
  if (!m) return null
  const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : null
  return { d: m[1].padStart(2, '0'), mm: m[2].padStart(2, '0'), y }
}
function anioDesdeGlosa(desc: unknown) {
  const m = String(desc || '').match(/\b\d{1,2}[-/]\d{1,2}[-/](\d{4})\b/)
  return m ? m[1] : null
}

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

const RUT_RE = String.raw`(\d{1,3}(?:\.?\d{3})+-?[\dkK])`
const reAbono = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT_RE}`, 'i')
const reCCA = new RegExp(`originador Rut:?\\s*${RUT_RE}\\s*Nombre:?\\s*(.+?)\\s*(?:\\(N\\.?Ref|$)`, 'i')
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT_RE}`, 'i')

function extraerContraparte(desc: string) {
  let m
  if ((m = desc.match(reAbono))) return { nombre: _flat(m[1]) || null, rut: _flat(m[2]) || null }
  if ((m = desc.match(reCCA))) return { rut: _flat(m[1]) || null, nombre: _flat(m[2]) || null }
  if ((m = desc.match(reTransf))) return { nombre: _flat(m[1]) || null, rut: _flat(m[2]) || null }
  return { rut: null, nombre: null }
}
function detectarInterno(desc: string, rut: string | null) {
  const d = _norm(desc)
  if (d.includes('cuentas propias')) return true
  if (rut && esRutPropio(rut)) return true
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
    const anio = anioDesdeGlosa(desc) || (fp && fp.y) || anioFallback
    const fecha = fp ? `${anio}-${fp.mm}-${fp.d}` : `${anio}-01-01`
    const cp = extraerContraparte(desc)
    let rut = cp.rut ? formatRut(cp.rut) : null, nombre = cp.nombre
    const interno = detectarInterno(desc, rut)
    if (interno) { rut = null; nombre = etiquetaInterno(desc, tipo, cuenta) }
    const n_operacion = _flat(iDoc >= 0 ? row[iDoc] : '') || null
    const mov = { cuenta, rol_cuenta: rol, fecha, tipo, rut_contraparte: rut, nombre_contraparte: nombre, monto, n_operacion, descripcion: desc, es_interno: interno, hash: '' }
    mov.hash = hashMovimiento(mov)
    movimientos.push(mov)
  }
  return { cuenta, rol_cuenta: rol, anio: anioFallback, filename, totalAbonos, totalCargos, movimientos }
}
