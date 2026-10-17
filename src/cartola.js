// Parseo de cartolas BICE (.xlsx) para el módulo de Conciliación bancaria — Fase 1.
// Lógica pura (sin UI ni red): recibe el AOA (array de filas) de una hoja y devuelve los
// movimientos normalizados + metadatos de la cartola. El componente hace la lectura con SheetJS.

export const RUT_PROPIO = '77.700.387-9'
export const CUENTAS = [
  { rol: 'honorarios', num: '1403834', codigo: '403', etiqueta: '01-40383-4' },
  { rol: 'gastos',     num: '1383922', codigo: '138', etiqueta: '01-38392-2' },
]

// RUT a solo dígitos + K mayúscula (sin puntos ni guion). '' si vacío.
export const normRut = r => String(r||'').toUpperCase().replace(/[^0-9K]/g,'')
export const esRutPropio = r => normRut(r) === normRut(RUT_PROPIO)

// Formatea un RUT a "XX.XXX.XXX-X" (consistencia visual y de almacenamiento).
export function formatRut(rut){
  const n = normRut(rut); if(n.length<2) return rut||null
  const dv = n.slice(-1), body = n.slice(0,-1)
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g,'.')}-${dv}`
}
// Valida el dígito verificador (módulo 11). Detecta RUT mal parseados.
export function rutValido(rut){
  const n = normRut(rut); if(n.length<2) return false
  const dv = n.slice(-1), body = n.slice(0,-1)
  if(!/^\d+$/.test(body)) return false
  let sum=0, mul=2
  for(let i=body.length-1;i>=0;i--){ sum+=parseInt(body[i],10)*mul; mul=mul===7?2:mul+1 }
  const r=11-(sum%11); const dvc = r===11?'0':r===10?'K':String(r)
  return dvc===dv
}

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
  let s = String(v).trim().replace(/\s/g,'')
  if(!s || s==='-') return 0
  s = s.replace(/[.,]\d{1,2}$/,'')   // descarta decimales chilenos al final (",00" / ".00"); CLP es entero
  s = s.replace(/[^\d]/g,'')         // el resto: solo dígitos (los separadores de miles, sea . o ,, se eliminan)
  const n = parseInt(s,10)
  return isNaN(n) ? 0 : n
}

// "DD-MM" / "DD/MM" / "DD-MM-YYYY". Devuelve {d,mm,y?} o null.
function parseDDMM(raw){
  // "Consulta de movimientos" de BICE trae la fecha como yyyymmdd ("20261009"), sin separadores.
  const c = String(raw||'').trim().match(/^(20\d{2})(\d{2})(\d{2})$/)
  if(c) return { d: c[3], mm: c[2], y: c[1] }
  const m = String(raw||'').match(/(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/)
  if(!m) return null
  let y = m[3] ? (m[3].length===2 ? '20'+m[3] : m[3]) : null
  return { d: m[1].padStart(2,'0'), mm: m[2].padStart(2,'0'), y }
}
// Fecha COMPLETA dentro de la glosa, ej. "... desde Itau el 08/07/2026 a las 16:47". BICE usa dos formatos:
// dd-mm-yyyy / dd/mm/yyyy (transferencias y abonos) y yyyy-mm-dd ("Transferencia de CLIENTE … el 2026-09-07 a las 00:24").
// El ISO no se leía: 7 traspasos de sept-2026 quedaron al 1-ene por defecto (auditoría BICE 2026-10-13).
export function fechaDesdeGlosa(desc){
  const s = String(desc||'')
  let m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/)
  if(m) return { d: m[1].padStart(2,'0'), mm: m[2].padStart(2,'0'), y: m[3] }
  m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if(m) return { d: m[3].padStart(2,'0'), mm: m[2].padStart(2,'0'), y: m[1] }
  return null
}
// Misma fecha en 'YYYY-MM-DD' (para cruzar fecha contable vs fecha real al cargar).
export const fechaGlosaISO = desc => { const f=fechaDesdeGlosa(desc); return f?`${f.y}-${f.mm}-${f.d}`:null }
function anioDesdeGlosa(desc){ const f=fechaDesdeGlosa(desc); return f?f.y:null }

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
// Huella de la transferencia: la fecha y hora REAL que trae la glosa ("el 19-06-2026 a las 18:17:32"). La misma transferencia puede
// llegar en dos cargas con distinta fecha contable (19-06 vs 22-06), sin n° de operación y con la glosa cortada por espacios
// (cartola mensual: "a las 18: 17") → se quitan los espacios antes de leer. Lleva la cuenta o RUT de la contraparte: dos retiros
// iguales al mismo minuto a socios distintos (30-06-2025 12:13, $2.000.000 c/u) NO son el mismo movimiento.
export function huellaGlosa(m){
  const s=String(m?.descripcion||'').replace(/\s+/g,'')
  // Fecha con '-' (transferencias a terceros) o '/' (abonos y traspasos entre cuentas propias).
  let g=s.match(/el(\d{2})[-/](\d{2})[-/](\d{4})alas(\d{2}):(\d{2})/i)
  if(!g){ const i=s.match(/el(\d{4})-(\d{2})-(\d{2})alas(\d{2}):(\d{2})/i); if(i) g=[i[0],i[3],i[2],i[1],i[4],i[5]] }   // formato ISO
  if(!g) return null
  const contra=(s.match(/acuenta(\d{4,})/i)||[])[1] || ((s.match(/haciacuentaN?°?([\d-]{6,})/i)||[])[1]||'').replace(/\D/g,'') || normRut((s.match(/Rut:?(\d{1,3}(?:\.?\d{3})+-?[\dkK])/i)||[])[1])
  if(!contra) return null
  return `${m.cuenta}|${m.tipo}|${Math.round(Number(m.monto)||0)}|${g[3]}-${g[2]}-${g[1]} ${g[4]}:${g[5]}|${contra}`
}

// Regex de extracción. RUT flexible: con o sin puntos, con o sin guion, dígito K.
const RUT_RE = String.raw`(\d{1,3}(?:\.?\d{3})+-?[\dkK])`
// Formato A — abono recibido: "Abono por transferencia de NOMBRE Rut RUT ..."
const reAbono  = new RegExp(`Abono por transferencia de (.+?)\\s*Rut\\s*${RUT_RE}`, 'i')
// Formato CCA — pago de proveedores: "... originador Rut: RUT Nombre: NOMBRE (N.Ref ...)" (Rut antes que Nombre)
const reCCA    = new RegExp(`originador Rut:?\\s*${RUT_RE}\\s*Nombre:?\\s*(.+?)\\s*(?:\\(N\\.?Ref|$)`, 'i')
// Formato B — transferencia a/desde tercero: "a cuenta NNN B, NOMBRE, Rut RUT ..."
const reTransf = new RegExp(`a cuenta \\S+ [^,]+,\\s*(.+?),\\s*Rut\\s*${RUT_RE}`, 'i')

// Extrae {rut, nombre} de la glosa probando los formatos en orden (sirve para abonos y cargos).
function extraerContraparte(desc){
  let m
  if((m=desc.match(reAbono)))  return { nombre:_flat(m[1])||null, rut:_flat(m[2])||null }
  if((m=desc.match(reCCA)))    return { rut:_flat(m[1])||null, nombre:_flat(m[2])||null }
  if((m=desc.match(reTransf))){
    const nombre=_flat(m[1])||null, rut=_flat(m[2])||null
    // "Transf. a terceros a cuenta <nuestra>, Liberona Escala, Rut <nuestro>": el banco enmascara al pagador (tercero con cuenta BICE) mostrando NUESTROS datos → contraparte desconocida.
    if((rut&&esRutPropio(rut))||/liberona escala|quad ases/.test(_norm(nombre))) return { nombre:null, rut:null }
    return { nombre, rut }
  }
  return { rut:null, nombre:null }
}

// Interno = traspaso ENTRE NUESTRAS cuentas. LA GLOSA MANDA: "cuentas propias", o el REMITENTE es el estudio
// (de LIBERONA ESCALA ... a LIBERONA ESCALA / de QUAD ASES). NO basta con que el RUT sea el nuestro: cuando un
// tercero con cuenta BICE nos paga, el banco enmascara al pagador mostrando nuestro RUT (eso es pago de tercero).
function detectarInterno(desc, _rut){
  const d = _norm(desc)
  if(d.includes('cuentas propias')) return true
  if(/transferencia de\s+liberona escala/.test(d) && /a\s+liberona escala/.test(d)) return true
  if(/transferencia de\s+quad ases/.test(d)) return true
  return false
}
// Etiqueta del traspaso interno con el número COMPLETO de la cuenta contraparte (la otra cuenta, distinta a la propia).
function etiquetaInterno(desc, tipo, cuentaPropia){
  // "...desde cuenta N 01-38392-2 hacia cuenta N 01-40383-4..."
  const found = (String(desc).match(/\d{2}-?\d{4,5}-?[\dkK]/g)||[]).map(rolDeCuenta).filter(Boolean)
  const propiaRol = rolDeCuenta(cuentaPropia)?.rol
  const contra = found.find(c=>c.rol!==propiaRol) || found.find(Boolean)
  const et = contra ? contra.etiqueta : ''
  return tipo==='abono' ? `Traspaso interno · abono desde cuenta ${et}` : `Traspaso interno · cargo hacia cuenta ${et}`
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
  // --- Año (fallback cuando la fila no trae la fecha completa en la glosa). El banco escribe
  //     el período como "... de 2026"; tomo el último año 20xx visto en el encabezado (= "Hasta"). ---
  let anioFallback=null
  for(let i=0;i<Math.min(25,rows.length);i++){
    const ym = rows[i].map(_flat).join(' ').match(/\b(20\d{2})\b/g)
    if(ym) anioFallback = ym[ym.length-1]
  }
  anioFallback = anioFallback || String(new Date().getFullYear())
  // Última fecha completa del encabezado (= "Hasta" del período): respaldo cuando una fila no trae fecha ni en columna ni en glosa.
  // Antes caía al 1-ene del año, que manda el movimiento a otro mes y descuadra todo.
  // Solo filas ANTES de la tabla de movimientos (si no, toma la fecha de la glosa de algún movimiento).
  let fechaHeader=null
  const _hdr = rows.findIndex(r=>{ const c=r.map(_norm); return c.some(x=>x.includes('descrip')) && c.some(x=>x.includes('abono')) })
  for(let i=0;i<Math.min(_hdr>=0?_hdr:25,rows.length);i++){ for(const cell of rows[i]){ const f=fechaDesdeGlosa(_flat(cell)); if(f) fechaHeader=f } }
  // --- Saldos del período (si la planilla los trae): permiten verificar que no falte ningún movimiento
  //     (saldo inicial + abonos − cargos = saldo final) y encadenar cartolas sucesivas de la misma cuenta. ---
  const saldoDe = rx => { for(let i=0;i<rows.length;i++){ const cells=rows[i].map(_norm); const k=cells.findIndex(c=>rx.test(c)); if(k<0) continue
    const v=parseMonto((rows[i+1]||[])[k]) || parseMonto(rows[i].slice(k+1).find(x=>parseMonto(x)>0)); if(v) return v } return null }
  const saldoInicial = saldoDe(/^saldo inicial/), saldoFinal = saldoDe(/^saldo (final|contable)/)
  // --- Totales del "Resumen del Período": los labels (Total Cargos / Total Abonos) están en una
  //     fila y los valores en la fila siguiente, en la MISMA columna. ---
  let totalAbonos=null, totalCargos=null
  for(let i=0;i<rows.length;i++){
    const cells = rows[i].map(_norm)
    const ci = cells.findIndex(c=>c.includes('total') && c.includes('cargo'))
    const ai = cells.findIndex(c=>c.includes('total') && c.includes('abono'))
    if(ci>=0 && ai>=0){
      const val = rows[i+1] || []
      let vc=parseMonto(val[ci]), va=parseMonto(val[ai])
      if(!vc && !va){ vc=parseMonto(rows[i][ci]); va=parseMonto(rows[i][ai]) } // por si vinieran juntos
      totalCargos=vc; totalAbonos=va; break
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
    // Fecha del movimiento: columna (forward-fill) > fecha COMPLETA en la glosa ("el 08/07/2026") > 1-ene como último recurso.
    // Antes, sin fecha de columna caía al 1-ene aunque la glosa trajera la fecha real (rompía la conciliación por fecha).
    const fg = fechaDesdeGlosa(desc)
    const dm = fp || fg || fechaHeader
    const anio = anioDesdeGlosa(desc) || (dm&&dm.y) || anioFallback
    const fecha = dm ? `${anio}-${dm.mm}-${dm.d}` : `${anio}-01-01`
    const fechaIncierta = !fp && !fg   // sin fecha propia: se tomó la del encabezado (o 1-ene si ni eso) → se avisa al cargar
    // RUT / nombre (mismos formatos para abono y cargo) + detección de interno (incluye auto-transferencia con RUT propio)
    const cp = extraerContraparte(desc)
    let rut = cp.rut ? formatRut(cp.rut) : null, nombre = cp.nombre
    const interno = detectarInterno(desc, rut)
    if(interno){ rut=null; nombre=etiquetaInterno(desc, tipo, cuenta) }
    const n_operacion = _flat(iDoc>=0?row[iDoc]:'') || null
    const mov = { cuenta, rol_cuenta:rol, fecha, tipo, rut_contraparte:rut, nombre_contraparte:nombre, monto, n_operacion, descripcion:desc, es_interno:interno }
    mov.hash = hashMovimiento(mov)
    if(fechaIncierta) Object.defineProperty(mov,'fechaIncierta',{value:true,enumerable:false})   // no viaja a la base
    movimientos.push(mov)
  }
  return { cuenta, rol_cuenta:rol, anio:anioFallback, filename, totalAbonos, totalCargos, saldoInicial, saldoFinal, movimientos }
}
