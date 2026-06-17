// Parseo de cartolas BICE (.xlsx) para el módulo de Conciliación bancaria — Fase 1.
// Lógica pura (sin UI ni red): recibe el AOA (array de filas) de una hoja y devuelve los
// movimientos normalizados + metadatos de la cartola. El componente hace la lectura con SheetJS.

export const RUT_PROPIO = '77.700.387-9'
export const CUENTAS = [
  { rol: 'honorarios', num: '40383', codigo: '403', etiqueta: '01-40383-4' },
  { rol: 'gastos',     num: '38392', codigo: '138', etiqueta: '01-38392-2' },
]

// RUT a solo dígitos + K mayúscula (sin puntos ni guion). '' si vacío.
export const normRut = r => String(r||'').toUpperCase().replace(/[^0-9K]/g,'')
export const esRutPropio = r => normRut(r) === normRut(RUT_PROPIO)

// Rol de la cuenta a partir de cualquier texto que la contenga (con/sin prefijo 01, guiones).
export function rolDeCuenta(raw){
  const d = String(raw||'').replace(/\D/g,'')
  if(!d) return null
  return CUENTAS.find(c => d.includes(c.num)) || null
}

const _flat = s => String(s==null?'':s).trim()
const _norm = s => _flat(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')

// Monto CLP entero. Soporta "1.234.567", "1.234.567,00", números, vacío/"-".
export function parseMonto(v){
  if(v==null) return 0
  if(typeof v==='number') return Math.round(Math.abs(v))
  let s = String(v).trim()
  if(!s || s==='-') return 0
  s = s.replace(/\s/g,'')
  if(s.includes(',')) s = s.split(',')[0]      // parte entera si trae decimales
  s = s.replace(/\./g,'').replace(/[^\d]/g,'')
  const n = parseInt(s,10)
  return isNaN(n) ? 0 : n
}

// "DD-MM" / "DD/MM" / "DD-MM-YYYY". Devuelve {d,mm,y?} o null.
function parseDDMM(raw){
  const m = String(raw||'').match(/(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/)
  if(!m) return null
  let y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : null
  return { d: m[1].padStart(2,'0'), mm: m[2].padStart(2,'0'), y }
}
// Año desde una fecha completa dentro de la glosa (dd/mm/yyyy o dd-mm-yyyy).
function anioDesdeGlosa(desc){
  const m = String(desc||'').match(/\b\d{1,2}[-/]\d{1,2}[-/](\d{4})\b/)
  return m ? m[1] : null
}

// Hash estable (cyrb53) para dedup idempotente.
function cyrb53(str){
  let h1=0xdeadbeef, h2=0x41c6ce57
  for(let i=0;i<str.length;i++){ const ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677) }
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909)
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909)
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(36)
}
export function hashMovimiento(m){
  return cyrb53(`${m.cuenta}|${m.fecha}|${m.tipo}|${m.monto}|${m.rut_contraparte||''}|${m.n_operacion||''}|${m.descripcion}`)
}

// Regex de extracción (validados en el prompt).
const RUT_RE = String.raw`(\d{1,3}(?:\.\d{3})*-[\dkK])`
const reAbono  = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT_RE}`, 'i')
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT_RE}`, 'i')

// Detecta traspaso entre cuentas propias: glosa "cuentas propias" o contraparte = RUT propio.
function detectarInterno(desc, rut){
  const d = _norm(desc)
  if(d.includes('cuentas propias')) return true
  if(rut && esRutPropio(rut)) return true
  return false
}
// Etiqueta del traspaso interno según la cuenta contraparte detectada en la glosa.
function etiquetaInterno(desc, tipo){
  // "...desde cuenta N 01-38392-2 hacia cuenta N 01-40383-4..."
  const cuentas = (String(desc).match(/\d{2}-?\d{4,5}-?[\dkK]/g)||[]).map(rolDeCuenta).filter(Boolean)
  const contra = cuentas.find(Boolean)
  const cod = contra ? contra.codigo : ''
  return tipo==='abono' ? `Traspaso interno abono cta. ${cod}` : `Traspaso interno cargo cta. ${cod}`
}

// Parsea el AOA de una hoja de cartola BICE. Devuelve metadatos + movimientos.
export function parseCartola(aoa, { filename='' } = {}){
  const rows = (aoa||[]).map(r => Array.isArray(r) ? r : [r])
  // --- Cuenta / rol ---
  let cuenta='', rol=null
  for(let i=0;i<Math.min(25,rows.length) && !cuenta;i++){
    for(const cell of rows[i]){
      const t=_flat(cell)
      const r=rolDeCuenta(t)
      if(r && t.replace(/\D/g,'').length>=5){ cuenta = r.etiqueta; rol = r.rol; break }
    }
  }
  // --- Período (para inferir año) ---
  let periodoDesde=null, periodoHasta=null
  for(let i=0;i<Math.min(25,rows.length);i++){
    const line = rows[i].map(_flat).join(' ')
    const ld = _norm(line)
    if(ld.includes('desde')){ const f=parseDDMM(line); if(f&&f.y) periodoDesde=f }
    if(ld.includes('hasta')){ const f=parseDDMM(line); if(f&&f.y) periodoHasta=f }
  }
  const anioFallback = (periodoHasta?.y) || (periodoDesde?.y) || String(new Date().getFullYear())
  // --- Totales del "Resumen del Período" (verificación) ---
  let totalAbonos=null, totalCargos=null
  for(let i=0;i<rows.length;i++){
    const cells = rows[i].map(_flat)
    const join = _norm(cells.join(' '))
    if(totalAbonos==null && join.includes('total') && join.includes('abono')){
      const nums = cells.map(parseMonto).filter(n=>n>0); if(nums.length) totalAbonos = Math.max(...nums)
    }
    if(totalCargos==null && join.includes('total') && join.includes('cargo')){
      const nums = cells.map(parseMonto).filter(n=>n>0); if(nums.length) totalCargos = Math.max(...nums)
    }
  }
  // --- Fila de encabezado (contiene "Descripción" y "Abonos") ---
  let hIdx=-1
  for(let i=0;i<rows.length;i++){
    const cells = rows[i].map(_norm)
    if(cells.some(c=>c.includes('descrip')) && cells.some(c=>c.includes('abono'))){ hIdx=i; break }
  }
  if(hIdx<0) return { cuenta, rol_cuenta:rol, anio:anioFallback, totalAbonos, totalCargos, movimientos:[], error:'No se encontró la fila de encabezados (Descripción/Abonos).' }
  const header = rows[hIdx].map(_norm)
  const col = (...keys) => header.findIndex(h => keys.some(k=>h.includes(k)))
  const iFecha = col('fecha'), iDoc = col('documento','n° doc','nro doc','docto','doc'), iDesc = col('descrip'), iCargo = col('cargo'), iAbono = col('abono')

  const movimientos=[]
  let lastFecha=null
  for(let i=hIdx+1;i<rows.length;i++){
    const row=rows[i]
    const desc=_flat(iDesc>=0?row[iDesc]:'')
    if(!desc) break                                  // primera fila con Descripción vacía → fin
    if(_norm(desc).includes('saldo inicial')) continue
    // Fecha (forward-fill cuando viene "-" o vacía)
    const fRaw=_flat(iFecha>=0?row[iFecha]:'')
    if(fRaw && fRaw!=='-'){ const p=parseDDMM(fRaw); if(p) lastFecha=p }
    const fp = lastFecha
    const cargo=parseMonto(iCargo>=0?row[iCargo]:0)
    const abono=parseMonto(iAbono>=0?row[iAbono]:0)
    if(cargo===0 && abono===0) continue
    const tipo = abono>0 ? 'abono' : 'cargo'
    const monto = abono>0 ? abono : cargo
    // Año: glosa > fecha de fila > período
    const anio = anioDesdeGlosa(desc) || (fp&&fp.y) || anioFallback
    const fecha = fp ? `${anio}-${fp.mm}-${fp.d}` : `${anio}-01-01`
    // RUT / nombre
    let rut=null, nombre=null
    const m = tipo==='abono' ? desc.match(reAbono) : desc.match(reTransf)
    if(m){ nombre=_flat(m[1])||null; rut=_flat(m[2])||null }
    // Interno
    const interno = detectarInterno(desc, rut)
    if(interno){ rut=null; nombre=etiquetaInterno(desc, tipo) }
    const n_operacion = _flat(iDoc>=0?row[iDoc]:'') || null
    const mov = { cuenta, rol_cuenta:rol, fecha, tipo, rut_contraparte:rut, nombre_contraparte:nombre, monto, n_operacion, descripcion:desc, es_interno:interno }
    mov.hash = hashMovimiento(mov)
    movimientos.push(mov)
  }
  return { cuenta, rol_cuenta:rol, anio:anioFallback, filename, totalAbonos, totalCargos, movimientos }
}
