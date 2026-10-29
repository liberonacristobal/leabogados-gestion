// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as SD from '../../supabase/functions/_shared/saludDatos.js'
import { LOGO_FACTURA_B64 } from '../assets/logoFacturaB64'
import { supabase, selectAll, getDriveToken, DEMO, alFalloDeEscritura } from '../supabase'
import { demoData } from '../demoData'
import { normRut as crNormRut } from '../cartola.js'
import { tasaBHE } from '../../supabase/functions/_shared/comisionesReglas.js'
import { ultimoDiaHabilMesEmision as _udhme } from '../../supabase/functions/_shared/facturacionReglas.js'
import { fgCliente } from '../../supabase/functions/_shared/gastosReglas.js'
import { desescaparXml } from '../../supabase/functions/_shared/xmlTexto.js'
import { BRAND, C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, appConfirm, diaGrande, fmt, fmtFechaDMY, fmtN, fmtRutCL, folioN, isoLocal, useIsDesktop } from './base.jsx'
import { VENTA_REAL } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { Fragment } from 'react'
import { cuentaEnSaldo } from '../../supabase/functions/_shared/gastosReglas.js'
import logoBlanco from '../le-logo-blanco.png'
import { Spin } from './base.jsx'
import { sugerirVentas, cuotasQueReemplaza, claveVentaFactura } from '../../supabase/functions/_shared/facturacionReglas.js'
import { coberturaVenta, cuotasCubiertasVenta as _cuotasCubiertasVenta } from '../../supabase/functions/_shared/ventasReglas.js'
import { CUENTA_HONORARIOS } from './base.jsx'
import { sugerirVentaGasto } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { trabajosDetenidos } from '../../supabase/functions/_shared/ventasReglas.js'
import { f29Estimado } from '../../supabase/functions/_shared/f29Reglas.js'
import { CAL_CL, CONTRIB_CUOTAS, ymMas as _ymMas, finDeMes as _finDeMes, diasA as _diasA, crearCalendario, djFecha as _djFecha } from '../../supabase/functions/_shared/calendarioReglas.js'
import { gastosPorRendirCli } from '../../supabase/functions/_shared/gastosReglas.js'
import { ventasFacturando, trabajosSinFacturar } from '../../supabase/functions/_shared/ventasReglas.js'
import { connectDrive } from '../supabase'
import { estadoComision } from '../../supabase/functions/_shared/comisionesReglas.js'
import { esRecurrente, esSubarriendo, ventaUF, ventaCLP, costoVentaUF, redondearPartes } from './cifras.js'
export { esRecurrente, esSubarriendo, ventaUF, ventaCLP, costoVentaUF, redondearPartes }

export const { dteMontoTotal, montoFactura } = SD

// Lectores de PDF y Word: se cargan la primera vez que se lee un documento (no en la apertura de la app; pesan cerca de 1 MB).
export let _pdfjsP=null

export const cargarPdfjs=()=> _pdfjsP || (_pdfjsP=Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker?url')]).then(([lib,w])=>{ lib.GlobalWorkerOptions.workerSrc=w.default; return lib }).catch(e=>{ _pdfjsP=null; throw e }))

// LA CLAVE ANÓNIMA NO IDENTIFICA A NADIE: viaja en este mismo paquete. Las
// funciones que mandan correo desde la cuenta del estudio exigen la sesión de
// una persona del estudio, así que va el token de la sesión y la clave anónima
// queda solo como `apikey`, que es lo que el enrutador necesita.
export async function tokenSesion(){
  const {data:{session}} = await supabase.auth.getSession()
  return session?.access_token || ''
}

// Único puente a Claude. La API key NO vive en el front (sería pública en el bundle):
// vive como secreto en la edge function claude-proxy, que valida el JWT del equipo.
// Devuelve el JSON de Anthropic tal cual (el llamador lee data.content[0].text).
export async function driveCall(body){   // puente a la edge function `drive` (acceso permanente vía refresh token)
  const {data:{session}} = await supabase.auth.getSession()
  if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
  const resp = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/drive',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey},
    body:JSON.stringify(body)
  })
  const data = await resp.json().catch(()=>({}))
  if(!resp.ok) throw new Error(data.error||('Error '+resp.status))
  return data
}

export async function claudeCall(body){
  const {data:{session}} = await supabase.auth.getSession()
  if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
  const resp = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/claude-proxy',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey},
    body:JSON.stringify(body)
  })
  const data = await resp.json().catch(()=>({}))
  if(!resp.ok) throw new Error(data.error||('Error '+resp.status))
  return data
}

export const fmtUF = n => n ? `UF ${Number(n).toLocaleString('es-CL',{minimumFractionDigits:0,maximumFractionDigits:2})}` : '—'

// CLP abreviado para KPIs ($216,2M / $30K). Conserva el signo.
// Millones con 1 decimal ($40,8M); bajo $1M, 2 decimales ($0,73M). Tarjetas y resúmenes (regla «número en $M»).
export const fmtMill = n => { const a=Math.abs(Number(n)||0), s=n<0?'−':''; if(!a) return '$0'; const v=a>=1e6?Math.round(a/1e5)/10:Math.round(a/1e4)/100; return s+'$'+v.toFixed(a>=1e6?1:2).replace('.',',')+'M' }   // redondeo en enteros: 605.000 → $0,61M

// Cifra corta (subtítulos, chips, KPIs): $M con 1 decimal; bajo $1M, $0,XXM (regla «número en $M», 2026-10-15). Bajo $1.000, pesos.
export const fmtShort = n => { const a=Math.abs(n||0), s=n<0?'−':''; if(a>=1000) return s+fmtMill(a); return s+fmt(a) }

// UF de respaldo (CLP) cuando no hay valor UF del día (ufHoy) ni congelado en la venta (uf_value).
// Fuente única — nunca hardcodear 40000 suelto en una conversión (divergiría si cambia el respaldo).
export const UF_FALLBACK = 40000

// Categoría legible para rendiciones (documento al cliente). Abreviaturas internas → nombre completo.
export const RENDCAT = c => c==='CBR'?'Conservador de Bienes Raíces':(c==='Notaria'||c==='Notaría')?BRAND.notaria:(c||'Otro')

export const fmtFechaHora = d => d ? `${fmtFechaDMY(d)} · ${new Date(d).toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',hour12:false})}` : '—'

export const fmtDate = d => fmtFechaDMY(d)   // formato oficial único: 13-06-2026 (DD-MM-AAAA con guiones) en toda la app

// Días en texto, plural correcto: 1 día · 72 días. Fuente única para etiquetas de tiempo relativo (no abreviar a "72 d"/"72d").
export const nDias = n => { const d=Math.abs(Math.round(Number(n)||0)); return d+' día'+(d===1?'':'s') }

// Encabezado de tabla / grupo (auditoría visual punto 12): franja gris clara con etiqueta azul en mayúscula.
export const TH_BAND = {background:C.bgSoft,color:C.accent,fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.5}

export const NOMBRE_CLI = {fontSize:14,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}

// ISO local (aaaa-mm-dd) de un timestamp, para pasarlo a diaGrande sin desfase UTC.
// Meses (auditoría visual 2026-10-15, punto 10): un solo juego. Abreviado 'sep' (no 'sept' del sistema); título 'Septiembre 2026'.
export const MES_L = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export const MES_C = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

export const mesTitulo = d => { const x=d instanceof Date?d:new Date(d); if(isNaN(x)) return ''; const m=MES_L[x.getMonth()]; return m.charAt(0).toUpperCase()+m.slice(1)+' '+x.getFullYear() }

export const bigDate = (d,col) => diaGrande(d,col)   // un solo formato de fecha grande (el de Banco, 2026-10-09): día 18 + "mmm aa"

// Saldo de una factura = lo que falta cobrar. FUENTE ÚNICA: lo abonado = el mayor entre paid_amount (campo de la factura) y los abonos CONCILIADOS del banco (_respaldoCache, suma de conciliacion.monto_aplicado). Así nunca cuenta doble ni ignora un abono que el banco ya respaldó. Pagada/Anulada = 0.
export let _respaldoCache = {}

export const setRespaldoCache = m => { _respaldoCache = m || {} }

// El total de la factura es la AUTORIDAD del DTE (montoFactura lee el MntTotal real del XML; cae a amount si no hay XML).
// Nunca usar b.amount suelto para el saldo: el amount es el monto PROGRAMADO (UF estimada) y diverge del emitido real.
export const saldoBill = b => { if(!b || ['Pagado','Anulada'].includes(b.status)) return 0; const abonado = Math.max(b.paid_amount||0, _respaldoCache[b.id]||0); return Math.max(0,montoFactura(b)-abonado) }

// Lo COBRADO de una factura = plata efectivamente recibida. FUENTE ÚNICA del "cobrado" del cliente (Financiero, Resumen y Estado de cuenta deben coincidir).
// Pagada = monto completo (DTE); parcial (Pendiente/Vencido con abono) = lo abonado, tope el monto; Anulada = 0. Mismo abonado que saldoBill (banco o paid_amount) → cobrado + saldo = monto.
export const cobradoBill = b => { if(!b || b.status==='Anulada') return 0; if(b.status==='Pagado') return montoFactura(b); const abonado = Math.max(b.paid_amount||0, _respaldoCache[b.id]||0); return Math.min(montoFactura(b), abonado) }

// Por cobrar de un conjunto de facturas — FUENTE ÚNICA del "por cobrar" del cliente (lista, ficha Resumen y Financiero deben coincidir). Solo cuentas por cobrar REALES: emitidas con folio, Pendiente/Vencido, saldo pendiente (saldoBill). Excluye sin-folio (eso es "por facturar"), anticipadas, anuladas y reembolsos.
export const porCobrarBills = bills => (bills||[]).filter(b=>b && !b.deleted_at && !['reembolso','nota_credito'].includes(b.billing_type) && b.invoice_no && ['Pendiente','Vencido'].includes(b.status)).reduce((s,b)=>s+saldoBill(b),0)

// CANON DE COLOR POR ESTADO DE COBRO — fuente única (un color por estado, sin duplicados ni hex sueltos). Cada estado: {label, color (línea/borde/cifra), bg (fondo de badge), text (texto sobre bg)}.
export const ESTADO_COBRO = {
  vencido:     {label:'Vencido',      color:C.overdue,  bg:C.overdueBg, text:C.overdueText, icon:'alert'},
  porCobrar:   {label:'Por cobrar',   color:C.accent,   bg:C.azulBg,    text:C.accent,      icon:'file'},
  porFacturar: {label:'Por facturar', color:C.muted,    bg:C.bgWarm,    text:C.muted,       icon:'clock'},
  yaFacturada: {label:'Ya facturada', color:C.soon,     bg:C.ambarBg,   text:C.soonText,    icon:'alert'},
  cobrado:     {label:'Cobrado',      color:C.normal,   bg:C.greenBg,   text:C.greenText,   icon:'check'},
  anticipada:  {label:'Anticipada',   color:C.azulInfo, bg:C.azulBg,    text:C.azulInfo,    icon:'clock'},
  anulada:     {label:'Anulada',      color:C.textSoft,     bg:C.bgWarm,    text:C.grisText,    icon:'x'},
}

// Vencimiento canónico de una factura emitida: SIEMPRE emisión + 30 días (plazo estándar), ignorando el `due` guardado.
// Regla universal: una cuota emitida en "mes vencido" (con due = día 1 del período) NO debe nacer vencida; el plazo corre desde la emisión.
// Sin issued_at (p.ej. programadas) cae al due programado. FUENTE ÚNICA (esVencidaB, Cierre, proyecciones).
export const venceBill = b => { if(b?.issued_at){ const x=new Date(b.issued_at+'T00:00:00'); x.setDate(x.getDate()+30); return x.toISOString().slice(0,10) } return b?.due||'' }

// Vencida = emitida impaga cuyo vencimiento (emisión+30) ya pasó. Deriva del cálculo, no del status guardado (así un `due` viejo no la rompe).
export const esVencidaB = b => { if(!b||['Pagado','Anulada','Programada','Pausada'].includes(b.status)) return false; const v=venceBill(b); return !!v && v < new Date().toISOString().slice(0,10) }

// Deriva el estado de cobro (folio + saldo + vencimiento + status) y devuelve su token de color. opts.yaFact = la sin-folio cuya factura emitida ya existe (duplicada), que la vista detecta y pasa.
export const estadoCobro = (b, opts={}) => {
  if(!b) return ESTADO_COBRO.porCobrar
  if(b.status==='Anulada') return ESTADO_COBRO.anulada
  if(b.status==='Anticipada') return ESTADO_COBRO.anticipada
  if(b.status==='Pagado' || saldoBill(b)<=0) return ESTADO_COBRO.cobrado
  if(!b.invoice_no) return opts.yaFact ? ESTADO_COBRO.yaFacturada : ESTADO_COBRO.porFacturar
  return esVencidaB(b) ? ESTADO_COBRO.vencido : ESTADO_COBRO.porCobrar
}

// Ícono de tarjeta KPI: cuadrito blanco (o gris claro sobre tarjeta blanca) con el ícono en el color del estado.
export const KpiIco = ({n,c,soft}) => <span style={{width:28,height:28,borderRadius:8,background:soft?C.bgSoft:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={n} s={16} c={c}/></span>

// Chispa (sugerido/aprendido/IA): reemplaza el glifo ✦ por un SVG nítido y consistente en toda plataforma. fill=currentColor → hereda el color del texto/botón donde va.
export const Sparkle = ({s=11,c}) => <svg width={s} height={s} viewBox='0 0 24 24' fill={c||'currentColor'} style={{display:'inline-block',verticalAlign:'-1px',flexShrink:0}} aria-hidden='true'><path d='M12 2l2.2 6.2L20.5 10l-6.3 2.1L12 18l-2.2-5.9L3.5 10l6.3-1.8z'/></svg>

// La cartola/conciliación bancaria solo tiene movimientos desde esta fecha; pagos anteriores se ingresaron a mano (no hay banco que los respalde).
export const RESPALDO_CUTOFF = '2025-02-06'

// Estado de respaldo bancario de una factura PAGADA — fuente ÚNICA del badge "verificada/pendiente/sin conciliación".
// respaldoMap: {billing_id → suma de monto_aplicado en conciliacion}; cartolaHasta: última fecha de cartola cargada (YYYY-MM-DD).
export function facturaRespaldo(b, respaldoMap={}, cartolaHasta=null){
  if(!b || b.status!=='Pagado' || b.deleted_at) return null
  if((b.billing_type||'')==='reembolso') return null
  const monto = montoFactura(b)   // autoridad DTE, no el amount programado
  const aplicado = respaldoMap[b.id]||0
  if(monto>0 && aplicado>=monto) return {key:'verificada', label:'Pagada y conciliada', short:'Conciliada', bg:C.azulBg, fg:C.accent}
  if(aplicado>0) return {key:'parcial', label:`Pagada · parcial · falta ${fmt(monto-aplicado)}`, short:'Parcial', bg:C.ambarBg, fg:C.soonText}
  const fechaPago = String(b.paid_at||b.issued_at||'').slice(0,10)
  if(fechaPago && fechaPago < RESPALDO_CUTOFF) return {key:'manual', label:'Pagada (histórica)', short:'Histórica', bg:C.border, fg:C.grisText}
  if(cartolaHasta && fechaPago && fechaPago > cartolaHasta) return {key:'pendiente', label:'Pagada · pendiente cartola', short:'Pend. cartola', bg:C.greenBg, fg:C.greenText}
  return {key:'sin', label:'Pagada sin conciliar', short:'Sin conciliar', bg:C.overdueBg, fg:C.overdueText}
}

// Estado unificado para mostrar (cualquier status, no solo Pagada) — fuente única del rótulo en Conciliación/Facturación/ficha.
export function estadoFacturaLabel(b, aplicado=0, cartolaHasta=null){
  if(!b) return null
  const r = facturaRespaldo(b, {[b.id]:aplicado}, cartolaHasta)
  if(r) return r
  if(b.status==='Anulada') return {key:'anulada', label:'Anulada', short:'Anulada', bg:C.border, fg:C.grisText}
  if(b.status==='Anticipada') return {key:'anticipada', label:'Anticipada', short:'Anticipada', bg:C.greenBg, fg:C.greenText}
  if(b.status==='Programada') return {key:'programada', label:'Programada', short:'Programada', bg:C.border, fg:C.muted}
  if(['Pendiente','Vencido'].includes(b.status)){
    const monto = montoFactura(b)   // autoridad DTE
    // 100% respaldada por el banco pero aún no marcada Pagada → NO es "Sin pago": coincide con estadoCobro (saldada). Evita el contradictorio "Cobrado"(estadoCobro) vs "Sin pago"(aquí) en la misma factura.
    if(monto>0 && aplicado>=monto) return {key:'verificada', label:'Pagada y conciliada', short:'Conciliada', bg:C.azulBg, fg:C.accent}
    // Parcial: hay abono/conciliación (aplicado) pero no cubre el total → mostrar el saldo pendiente, no "Sin pago".
    if(aplicado>0 && aplicado<monto) return {key:'parcial', label:`Abonada · falta ${fmt(monto-aplicado)}`, short:'Parcial', bg:C.ambarBg, fg:C.soonText}
    return {key:'sinpago', label:'Sin pago', short:'Sin pago', bg:C.soonBg, fg:C.soonText}
  }
  return {key:'otro', label:b.status||'', short:b.status||'', bg:C.border, fg:C.muted}
}

// CATÁLOGO ÚNICO de botones de acción — una sola geometría (radio 8 · 5×12 · 11px), color = jerarquía.
// Relleno para lo principal (navy=navegar/enviar, verde=confirmar plata), tinte para secundarias (por naturaleza), contorno para lo neutro.
// NO cambia textos, solo estilo. Reemplaza los botones de acción inline dispersos (Recordar/Conciliar/Editar/Enviar/Acuse/Vincular) que hoy tienen radios y colores mezclados.
export const _ACT_VARIANT = {
  primary:  {background:C.accent,  color:'#fff',        border:'none'},
  success:  {background:C.normal,  color:'#fff',        border:'none'},
  softNavy: {background:C.azulBg,  color:C.accent,      border:'none'},
  softGreen:{background:C.greenBg, color:C.greenText,   border:'none'},
  softAmber:{background:C.soonBg,  color:C.soonText,    border:`1px solid ${C.soon}`},
  softMuted:{background:C.bgWarm,  color:C.grisText,    border:'none'},
  ghost:    {background:'#fff',    color:C.muted,       border:`1px solid ${C.border}`},
}

export function ActBtn({variant='ghost', size='md', onClick, disabled=false, title, children, full=false, style={}}){
  const v = _ACT_VARIANT[variant] || _ACT_VARIANT.ghost
  // UN solo botón para la app (2026-10-08): md = acción en fila (34px, 12.5px) · lg = acción principal de un panel/pie (38px, 13px).
  const sz = size==='lg' ? {fontSize:13,minHeight:38,padding:'0 15px'} : {fontSize:12.5,minHeight:34,padding:'0 13px'}
  return <button onClick={onClick} disabled={disabled} title={title} style={{fontWeight:600,borderRadius:8,lineHeight:1.15,cursor:disabled?'default':'pointer',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,opacity:disabled?.55:1,...(full?{width:'100%'}:{}),...sz,...v,...style}}>{children}</button>
}

// Buscador ÚNICO (lupa · campo · Limpiar · acción opcional a la derecha). Borde marcado cuando hay texto.
export function Buscador({value, onChange, placeholder='Buscar…', right=null, autoFocus=false, style={}}){
  const on=!!String(value||'').trim()
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,background:C.surface,border:`${on?1.5:1}px solid ${on?C.accent:C.border}`,borderRadius:10,padding:'0 11px',...style}}>
      <SIcon n='search' s={14} c={C.muted}/>
      <input autoFocus={autoFocus} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{flex:1,minWidth:0,border:'none',outline:'none',background:'none',fontSize:13,color:C.text,padding:'10px 0'}}/>
      {on&&<button onClick={()=>onChange('')} style={{border:'none',background:'none',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer',minHeight:30,padding:'0 2px'}}>Limpiar</button>}
      {right}
    </div>)
}

export const daysLeft = d => { if(!d) return null; return Math.round((new Date(d+'T12:00') - new Date()) / 86400000) }

// Feriados de Chile (fuente: api.boostr.cl / apis.digital.gob.cl). Se cargan al iniciar y se cachean; si la API no responde,
// el cálculo del día hábil cae a solo fin de semana (comportamiento anterior, seguro).
export const FERIADOS_CL = new Set()   // 'YYYY-MM-DD'
const _calCL = crearCalendario(FERIADOS_CL)   // fechas legales compartidas con la sincronización de Google Calendar
export const _esDiaHabil = _calCL.esDiaHabil, _habilDesde = _calCL.habilDesde, venceCalTrib = _calCL.venceCalTrib
export { CAL_CL, CONTRIB_CUOTAS, _ymMas, _finDeMes, _diasA, _djFecha }


// Vencimiento de pago = ÚLTIMO DÍA HÁBIL del mes de emisión si se emite dentro de los primeros 10 días;
// si se emite después del día 10, salta al último día hábil del mes SIGUIENTE. Día hábil = ni fin de semana ni feriado (Chile).
export function ultimoDiaHabilMesEmision(iso){ return _udhme(iso, _esDiaHabil) }

export function dueFromIssued(iso){ return ultimoDiaHabilMesEmision(iso) }

export const cuotaNMof = c => { const m=String(c||'').match(/(\d+)\s*(?:\/|-|de)\s*(\d+)/); return m?{n:+m[1],tot:+m[2]}:null }

// UF por FECHA (cache persistente) — para calzar montos con la UF del día de emisión. Fuente: tabla `indicadores` (CMF, la
// alimenta el agente indicadores cada día; 2022→ comparada día a día con mindicador sin diferencias); mindicador solo si la tabla
// no trae ese año. Se baja por AÑO y se guarda date→uf en localStorage.
export async function ufDeTabla(desde, hasta){
  try{ const {data,error}=await supabase.from('indicadores').select('fecha,valor').eq('codigo','uf').gte('fecha',desde).lte('fecha',hasta).order('fecha').limit(1000)
    if(error||!data?.length) return null; const m={}; data.forEach(r=>{ const v=Number(r.valor); if(v>0) m[String(r.fecha).slice(0,10)]=v }); return m }catch(_){ return null } }

export const _UF_FECHA_KEY='fd_uf_fecha'

export const ufFechaCache=()=>{ try{ return JSON.parse(localStorage.getItem(_UF_FECHA_KEY)||'{}') }catch(_){ return {} } }

// UF del DÍA de un movimiento (fuente única para pasar pesos a UF sin inflar ni achicar: cada peso con la UF del día en que ocurrió).
// Si ese día no está en la serie, usa el día publicado más cercano hacia atrás (hasta 10 días); si no hay nada, la UF de respaldo.
export function ufDelDia(ufMap, iso, fallback){
  const d0=String(iso||'').slice(0,10); if(!ufMap||d0.length<10) return fallback
  if(ufMap[d0]>0) return ufMap[d0]
  const d=new Date(d0+'T12:00'); if(isNaN(d)) return fallback
  for(let i=1;i<=10;i++){ d.setDate(d.getDate()-1); const v=ufMap[isoLocal(d)]; if(v>0) return v }
  return fallback
}

// Fecha para montos MENSUALES sin día propio (planilla de costos): último día del mes; el mes en curso, hoy.
export const finMesOHoy = ym => { const hoy=isoLocal(Date.now()); if(String(ym)===hoy.slice(0,7)) return hoy; const [Y,M]=String(ym).split('-').map(Number); return isoLocal(new Date(Y,M,0)) }

// Formato de una cifra ya redondeada a $0,1M (cascadas que cuadran): bajo $1M va con UN decimal ($0,2M), no dos ($0,18M),
// porque esa es su precisión real dentro de la suma. Sobre $1M = fmtMill.
export const fmtMillLR = n => { const a=Math.abs(Number(n)||0), s=n<0?'−':''; if(!a) return '$0'; if(a>=1e6) return s+fmtMill(a); return s+'$'+(Math.round(a/1e5)/10).toFixed(1).replace('.',',')+'M' }

// Normalizador ÚNICO de nombres de cliente (mismo criterio que el edge function clientes-drive-sync): minúsculas + sin acentos + espacios colapsados. Anti-duplicados.
export const nrmCliente = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim()

// La app aprende: cada decisión se guarda como conocimiento reutilizable (learnings) + registro de fricción (usage_events).
// En modo demo el cliente Supabase es inerte, así que esto no-opera solo (no toca base real).
// Aprendizaje nuevo: si ya existe la misma clave con el mismo valor y detalle, solo suma un uso y refresca la fecha (no repite la fila);
// un valor distinto sí se agrega (el último gana en los lectores, y costo_oficina admite valores en conflicto a propósito).
export const learnPut = async (kind,key,value,meta) => { try{
  const k=String(key), v=value!=null?String(value):null, m=meta||{}
  const {data}=await supabase.from('learnings').select('id,hits,value,meta').eq('kind',kind).eq('key',k).limit(50)
  const igual=(data||[]).find(r=>(r.value??null)===v && JSON.stringify(r.meta||{})===JSON.stringify(m))
  if(igual) await supabase.from('learnings').update({hits:(igual.hits||0)+1,updated_at:new Date().toISOString()}).eq('id',igual.id)
  else await supabase.from('learnings').insert({kind,key:k,value:v,meta:m})
}catch(e){} }

// Escritura que la base rechaza llega como {error} (no lanza): se registra y se avisa en el diálogo de siempre, para que nadie crea que quedó guardado.
export const okDB = (r, que) => { if(r && r.error){ registrarError({ origen:'accion', vista:que, err:r.error }); appAlert(`No se pudo ${que}: ${r.error.message||'error de la base'}.`); return false } return true }

// Valor SINGLETON en learnings (config, interruptores): update si existe, insert si no. NO usar upsert
// onConflict:'kind,key' — la tabla admite (kind,key) duplicados a propósito y ese upsert falla en silencio.
export async function setLearningKV(kind,key,value){
  const v = value==null?null:String(value)
  const {data} = await supabase.from('learnings').select('id').eq('kind',kind).eq('key',String(key)).limit(1)
  // Actualiza TODAS las filas de la clave y marca updated_at: los lectores ordenan por updated_at (gana lo último).
  if(data&&data.length) await supabase.from('learnings').update({value:v,updated_at:new Date().toISOString()}).eq('kind',kind).eq('key',String(key))
  else await supabase.from('learnings').insert({kind,key:String(key),value:v})
}

export const logEvent = (area,action,detail,user) => { try{ supabase.from('usage_events').insert({area,action,detail:detail||{},user_name:user||null}).then(()=>{},()=>{}) }catch(e){} }

// Razón social a mostrar en encabezados: si se pasa entityId se usa esa RS; con 1 RS, esa; si hay varias o ninguna,
// el nombre del cliente (con conteo de RS si aplica). Devuelve {name, rut, multi}.
export const rsLabel = (clientId, clients, clientEntities, entityId) => {
  const ents = (clientEntities||[]).filter(e=>String(e.client_id)===String(clientId))
  if(entityId){ const e=ents.find(x=>String(x.id)===String(entityId)); if(e) return {name:e.name, rut:e.rut||'', multi:0} }
  if(ents.length===1) return {name:ents[0].name, rut:ents[0].rut||'', multi:0}
  const c = (clients||[]).find(x=>String(x.id)===String(clientId))
  return {name:c?.name||'Cliente', rut:c?.rut||'', multi:ents.length>1?ents.length:0}
}

// Razón social del SII en MAYÚSCULAS SOLO para mostrar (el dato crudo NUNCA se toca; PDF/export legal usan la RS tal cual).
export const rsDisplay = s => s ? String(s).trim().toUpperCase() : s

// Primitivo reutilizable: copia `text` al portapapeles al tocar, con feedback "copiado ✓" inline (sin toast global).
export function Copyable({text, children, title='Copiar', style}){
  const [done,setDone] = useState(false)
  const copy = e => { if(e&&e.stopPropagation) e.stopPropagation(); const v=String(text??'').trim(); if(!v) return; try{ navigator.clipboard?.writeText(v) }catch(_){}; setDone(true); setTimeout(()=>setDone(false),1200) }
  return <span onClick={copy} title={title} style={{cursor:'pointer',...style}}>{children}{done&&<span style={{marginLeft:5,fontSize:9,fontWeight:600,color:C.greenText,whiteSpace:'nowrap'}}>copiado <Gl n='tick'/></span>}</span>
}

// Chip de acción para cabeceras de pestaña (estilo aprobado: tintado suave, sin borde, redondeado). variant: soft|primary|green
export const chipBtn = (variant='soft') => ({height:24,padding:'0 12px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',whiteSpace:'nowrap',gap:5,boxSizing:'border-box',
  ...({
    soft:{background:C.bgSoft,color:C.muted,border:'0.5px solid #E4E8EB'},
    primary:{background:C.accent,color:'#fff',border:'none'},
    green:{background:C.greenBg,color:C.greenText,border:'0.5px solid #CFE9DD'},
    greenSolid:{background:C.normal,color:'#fff',border:'none'},
  }[variant]||{})})

export const currentYear = new Date().getFullYear()

// Iniciales nombre+apellido de cada responsable (mismas de su correo)
export const INICIALES_RESP = {'Cristóbal':'CL','Erasmo':'EE','Martín':'MC','Martina':'MP','Rodrigo':'RD'}

// Responsables de una tarea: usa assignees (multi); si no hay, cae a who (tareas antiguas).
export const taskAssignees = t => (t && t.assignees && t.assignees.length) ? t.assignees : (t && t.who ? [t.who] : [])

// Gastos VARIOS de oficina del mes (fuente única): cargos del cliente interno que NO están en la planilla (sueldos/previsión/arriendo/ggcc/contadora/honorarios), NO son estructurales (retiros/comisiones/proveedores) y NO son trámites rembolsables al cliente (notaría/CBR/registro civil/archivo judicial/diario oficial). Entran al resultado como egreso operativo. Decidido con el usuario 2026-10-05.
// Gastos varios de oficina: cargos del cliente interno que NO están ya en la planilla de costos (sueldos, previsión, PPM, contadora,
// arriendo, gastos comunes, honorarios), ni retiros/comisiones, ni trámites reembolsables. 2026-10-15: se excluyen también
// «Leyes sociales», «Remuneraciones» y el PPM (Impuestos y patentes › PPM), que la conciliación del banco empezó a registrar y se contaban dos veces.
// 2026-10-17: de «Arriendo y espacio» solo se excluye arriendo/GGCC (vienen de la planilla); la limpieza sí es gasto vario.
export const _GV_EXCL = new Set(['Sueldos','Retiros','Comisiones','Proveedores','Bono','Contadora','Arriendo','Gastos comunes','Honorarios','Notaria','Notaría','CBR','Registro Civil','Archivo Judicial','Diario Oficial','Leyes sociales','Remuneraciones'])

export function gastosVariosOfiItems(expenses, clients, ym){
  const ofi=(clients||[]).find(c=>c&&(c.is_internal||/liberona\s+escala/i.test(c.name||'')))
  if(!ofi) return []
  return (expenses||[]).filter(e=>e&&!e.deleted_at&&e.type==='gasto'&&String(e.client_id)===String(ofi.id)&&String(e.date||'').startsWith(ym)&&!_GV_EXCL.has(String(e.category||''))&&!(String(e.category||'')==='Impuestos y patentes'&&/ppm/i.test(String(e.subcategory||'')))&&!(String(e.category||'')==='Arriendo y espacio'&&!/limpieza|aseo/i.test(String(e.subcategory||''))))
}

// Contadora pagada en el banco en el mes (incluye extras como la Operación Renta, que la planilla no trae).
export function contadoraBancoItems(expenses, clients, ym){
  const ofi=(clients||[]).find(c=>c&&(c.is_internal||/liberona\s+escala/i.test(c.name||'')))
  if(!ofi) return []
  return (expenses||[]).filter(e=>e&&!e.deleted_at&&e.type==='gasto'&&String(e.client_id)===String(ofi.id)&&String(e.date||'').startsWith(ym)&&(String(e.category||'')==='Contadora'||/contador/i.test(String(e.subcategory||''))))
}

export const tipoFactura = b => { const t=b&&b.billing_type; return ['reembolso','comision','externo','subarriendo','nota_credito'].includes(t) ? t : 'honorarios' }

// Factura de ingreso del estudio (lo que antes era solo billing_type==='honorarios'): honorarios + comisiones + por externo.
// Por externo cuenta solo su parte (montoFactura − monto_terceros) donde corresponde; gastos, subarriendo y notas de crédito, no.
export const esFacIngreso = b => !!b && ['honorarios','comision','externo'].includes(tipoFactura(b))

// ── BITÁCORA GENERAL (activity_log): toda acción relevante deja registro consultable (regla "bitácora siempre").
// action = 'area.verbo' (p.ej. 'revision.retirar_cuota', 'fondos.pedido_enviado'); detalle = objeto chico (se guarda como JSON).
export let _actorBitacora = null

export function setActorBitacora(email){ _actorBitacora = email||null }

export function resumenBitacora(x){
  if(x==null||typeof x!=='object') return x
  if(Array.isArray(x)) return x.slice(0,10).map(resumenBitacora)
  const o={}; ['id','folio','invoice_no','title','concept','name','client_id','monto','amount','persona','rut'].forEach(k=>{ if(x[k]!=null) o[k]=x[k] })
  return Object.keys(o).length?o:'[obj]'
}

// completo: guarda el detalle tal cual (respaldos antes de borrar/editar); si no, solo el resumen chico.
export async function logActividad(action, {tabla=null, id=null, detalle=null, completo=false}={}){
  if(DEMO) return
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id||''))?String(id):null
  try{ await supabase.from('activity_log').insert({ user_email:_actorBitacora, action, table_name:tabla, record_id:uuid, detail:detalle==null?null:JSON.stringify(completo?detalle:resumenBitacora(detalle)) }) }catch(e){registrarError({origen:'accion',vista:'activity_log',err:e})}
}

// Equipo del estudio (tabla miembros): nombre ↔ correo principal, solo del estudio de quien entró. Fuente única para todo lo
// que va a una persona del equipo por su nombre (avisos de tareas, pedir fondos, rendiciones, cc internos). Se carga al entrar
// (cargarEquipo); EQUIPO_RESPALDO solo cubre mientras carga o si la consulta falla, para no dejar un aviso sin destinatario.
export const EQUIPO_RESPALDO = {'Cristóbal':'cl@leabogados.cl','Erasmo':'ee@leabogados.cl','Martín':'mc@leabogados.cl','Martina':'mp@leabogados.cl','Rodrigo':'rd@leabogados.cl'}

export let _equipo = null

export function cargarEquipo(miEmail){
  if(DEMO||_equipo) return Promise.resolve(_equipo)
  return Promise.resolve(supabase.from('miembros').select('email,nombre,principal,estudio_id,nombre_completo,cargo,telefono')).then(({data})=>{
    const filas=(data||[]).filter(r=>r.email), mia=filas.find(r=>String(r.email).toLowerCase()===String(miEmail||'').toLowerCase())
    const est=mia?.estudio_id, pn={}, pe={}, firma={}
    filas.filter(r=>!est||r.estudio_id===est).forEach(r=>{ const em=String(r.email).toLowerCase(), n=String(r.nombre||'').split(' (')[0]; if(!n) return; pe[em]=n; if(r.principal!==false&&!pn[n]) pn[n]=em
      if(r.nombre_completo||r.cargo||r.telefono) firma[em]={nombre:r.nombre_completo||n,cargo:r.cargo||'',telefono:r.telefono||''} })
    _equipo={pn,pe,firma}; return _equipo }).catch(()=>null)
}

export const equipoPorNombre = () => ({...EQUIPO_RESPALDO, ...(_equipo?.pn||{})})

// Nombres de los miembros del estudio por email (de `miembros`, no cableados). Cacheado por sesión.
export let _nombresMiembrosCache=null, _nombresMiembrosP=null

export function nombresMiembros(){
  if(_nombresMiembrosCache) return Promise.resolve(_nombresMiembrosCache)
  if(DEMO) return Promise.resolve({})
  if(!_nombresMiembrosP) _nombresMiembrosP=supabase.from('miembros').select('email,nombre').then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.email) m[String(r.email).toLowerCase()]=String(r.nombre||'').split(' (')[0]||r.email }); _nombresMiembrosCache=m; return m }).catch(()=>({}))
  return _nombresMiembrosP
}

// Lista de la bitácora para un área (prefijo de action). Cada fila: qué · detalle · quién · cuándo.
// plano: modo "Historial" al pie de una lista (plegado, texto completo, autor neutro, sin monto; si no hay registros no se muestra).
export function BitacoraLista({prefijo, titulo='Historial', etiquetas={}, limite=20, vacio='Aún no hay registros.', plano=false, autor=null}){
  const [rows,setRows]=useState(null)
  const [abierto,setAbierto]=useState(false)
  useEffect(()=>{ let vivo=true; if(DEMO){ setRows((demoData.historial||[]).filter(r=>String(r.action).startsWith(prefijo))); return }
    supabase.from('activity_log').select('id,action,detail,user_email,created_at').like('action',prefijo+'%').order('created_at',{ascending:false}).limit(limite)
      .then(({data})=>{ if(vivo) setRows(data||[]) }).catch(()=>{ if(vivo) setRows([]) })
    return ()=>{ vivo=false } },[prefijo,limite])
  const [nombres,setNombres]=useState(_nombresMiembrosCache||{})
  useEffect(()=>{ nombresMiembros().then(m=>setNombres(m)) },[])
  const quien=e=>nombres[String(e||'').toLowerCase()]||(String(e||'').split('@')[0]||'—')
  const det=d=>{ try{ const o=JSON.parse(d); if(o==null) return ''; if(typeof o!=='object') return String(o); const a=Array.isArray(o)?o:[o]; return a.map(x=>typeof x==='object'&&x?[x.folio||x.invoice_no?`N° ${folioN(x.folio||x.invoice_no)}`:null,x.texto||x.title||x.concept||x.name||x.persona||null].filter(Boolean).join(' · '):String(x)).filter(Boolean).join(' · ') }catch(_){ return String(d||'') } }
  if(plano){ if(!rows||!rows.length) return null
    return (
      <div style={{borderTop:`1px solid ${C.border}`,marginTop:4}}>
        <div onClick={()=>setAbierto(v=>!v)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',cursor:'pointer'}}>
          <span style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>{titulo}</span>
          <span style={{color:C.textSoft,fontSize:16,lineHeight:1,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
        </div>
        {abierto&&<div style={{display:'grid',gap:6,paddingBottom:8}}>{rows.map(r=><div key={r.id} style={{background:C.bgSoft,borderRadius:8,padding:'8px 10px'}}>
          <div style={{fontSize:11,color:C.muted,fontWeight:600}}>{fmtFechaDMY(String(r.created_at||'').slice(0,10))} · {autor||quien(r.user_email)}</div>
          <div style={{fontSize:12,color:C.text,lineHeight:1.5}}>{det(r.detail)}</div>
        </div>)}</div>}
      </div>) }
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px 6px'}}>
      <div style={{...SEC_LBL,marginBottom:2}}>{titulo}</div>
      {rows===null?<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Cargando…</div>
       :rows.length===0?<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>{vacio}</div>
       :rows.map((r,i)=><div key={r.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 0',borderTop:i?`0.5px solid ${C.bgSoft}`:'none'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{etiquetas[r.action]||r.action}</div>{det(r.detail)&&<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{det(r.detail)}</div>}</div>
          <div style={{textAlign:'right',flexShrink:0}}>{(()=>{ try{ const o=JSON.parse(r.detail); const m=o&&!Array.isArray(o)&&typeof o==='object'?(o.monto??o.amount):(Array.isArray(o)?o.reduce((a,x)=>a+(Number(x?.monto??x?.amount)||0),0)||null:null); return m!=null?<div style={{fontSize:12.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(m)}</div>:null }catch(_){ return null } })()}<div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{fmtFechaHora(r.created_at)}</div><div style={{fontSize:10.5,color:C.textSoft}}>{quien(r.user_email)}</div></div>
        </div>)}
    </div>)
}

// Fuente única para "fondos − gastos" de un cliente. Siempre con guarda ||0 (nunca NaN).
export const saldoCliente = (expenses, clientId) => fgCliente(expenses, clientId).saldo

// "Ver PDF" desde el historial: arma los datos de una rendición YA registrada y usa la fuente única.
// Firma de correo por defecto de cada persona: de la tabla miembros (nombre_completo, cargo, telefono; cargarEquipo). El respaldo
// solo cubre mientras carga y no guarda teléfonos en el código.
export const FIRMA_RESPALDO = {
  'cl@leabogados.cl':{nombre:'Cristóbal Liberona',cargo:'Socio',telefono:''},
  'ee@leabogados.cl':{nombre:'Erasmo Escala',cargo:'Socio',telefono:''},
  'mc@leabogados.cl':{nombre:'Martín Campero Mantelli',cargo:'Abogado',telefono:''},
  'mp@leabogados.cl':{nombre:'Martina Pérez Giuras',cargo:'Procuradora',telefono:''}
}

export const firmaDefault = email => { const e=String(email||'').toLowerCase(); return _equipo?.firma?.[e] || FIRMA_RESPALDO[e] }

export const Inp = (p) => <input {...p} style={{width:'100%',height:36,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box',outline:'none',...p.style}}/>

export const Lbl = ({children}) => <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.7,marginBottom:2}}>{children}</div>

export const Fld = ({label,children,mb}) => <div className='fld' style={{marginBottom:mb??8}}><Lbl>{label}</Lbl>{children}</div>

export const Modal = ({title,onClose,children,closeOnBackdrop=true,titleRight,hideHeader=false,fullscreen=false,fullscreenOnMobile=false,footer=null,maxWidth=520,fsMaxWidth=720,topmost=false}) => {
  // iPhone-first: `fullscreenOnMobile` hace pantalla completa bajo 600px (header fijo, cuerpo con scroll propio, footer anclado con safe-area).
  // `footer` (opcional) es una barra inferior anclada FUERA del scroll — para inputs/acciones que no deben quedar tapados por el teclado.
  const [mob,setMob] = useState(()=> typeof window!=='undefined' && window.innerWidth < 600)
  useEffect(()=>{ if(!fullscreenOnMobile) return; const h=()=>setMob(window.innerWidth<600); window.addEventListener('resize',h); return ()=>window.removeEventListener('resize',h) },[fullscreenOnMobile])
  const fs = fullscreen || (fullscreenOnMobile && mob)
  const flex = fs || !!footer   // layout en columna: header / cuerpo scroll / footer anclado
  const node = (
  <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:topmost?900:(fs?600:200),display:'flex',alignItems:fs?'stretch':'center',justifyContent:'center',padding:fs?0:16}} onClick={e=>e.target===e.currentTarget&&closeOnBackdrop&&onClose()}>
    <div className={fs?'modal-fs':undefined} style={{background:C.surface,borderRadius:fs?0:16,width:'100%',maxWidth:fs?'none':maxWidth,maxHeight:fs?'100%':'90vh',height:fs?'100%':'auto',display:flex?'flex':'block',flexDirection:flex?'column':undefined,overflowY:flex?'hidden':'auto',boxShadow:fs?'none':'0 20px 60px rgba(0,0,0,.18)',border:fs?'none':`1px solid ${C.border}`,paddingBottom:(fs||flex)?0:(hideHeader?0:24)}}>
      {!hideHeader&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:fs?'calc(env(safe-area-inset-top,0px) + 16px) 18px 14px':'18px 20px 14px',borderBottom:`1px solid ${C.border}`,position:flex?'static':'sticky',top:0,background:C.surface,zIndex:1,flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
          {fs&&<button onClick={onClose} aria-label='Volver' style={{display:'inline-flex',alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',padding:'6px 8px 6px 0',marginLeft:-2,flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>}
          <span style={{fontSize:16,fontWeight:600,color:C.accent,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{title}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
          {titleRight}
          {!fs&&<button onClick={onClose} aria-label='Cerrar' style={{background:'none',border:'none',color:C.muted,fontSize:22,cursor:'pointer',lineHeight:1,width:44,height:44,display:'flex',alignItems:'center',justifyContent:'center',marginRight:-10}}><Gl n='x'/></button>}
        </div>
      </div>}
      <div style={{flex:flex?1:undefined,minHeight:flex?0:undefined,overflowY:flex?'auto':'visible',overflowX:fs?'hidden':undefined,padding:hideHeader?'0':(fs?(footer?'14px 16px':'14px 16px calc(env(safe-area-inset-bottom,0px) + 32px)'):'18px 20px'),maxWidth:(fs&&!hideHeader)?fsMaxWidth:'none',margin:(fs&&!hideHeader)?'0 auto':'0',width:(fs&&!hideHeader)?'100%':undefined,boxSizing:'border-box'}}>{children}</div>
      {footer&&<div style={{flexShrink:0,borderTop:`1px solid ${C.border}`,background:C.surface,padding:fs?'10px 16px calc(env(safe-area-inset-bottom,0px) + 14px)':'12px 16px',maxWidth:fs?fsMaxWidth:'none',margin:fs?'0 auto':'0',width:'100%',boxSizing:'border-box'}}>{footer}</div>}
    </div>
  </div>
  )
  return createPortal(node, document.body)   // SIEMPRE al body: evita que un modal abierto desde una vista portada (Cargar XML) quede detrás
}

// Registro de errores en producción (tabla app_errores, admin la ve en Revisión de datos): vista, mensaje, pila y versión; nunca
// datos de la pantalla. Una vez por mensaje y vista en cada sesión (un error en un render que se repite no inunda la tabla).
export const BUILD_VERSION = typeof __BUILD__!=='undefined' ? __BUILD__ : 'local'

export const _errVistos = new Set()

export const _ERR_RUIDO = /ResizeObserver loop|Failed to fetch|Load failed|NetworkError|AbortError|The operation was aborted|cancelad/i

export async function registrarError({origen='global', vista, err, stack}){
  try{
    const mensaje = String(err?.message || err || 'Error sin mensaje').slice(0,500)
    if(DEMO || _ERR_RUIDO.test(mensaje)) return
    const clave = `${vista||''}|${mensaje}`
    if(_errVistos.has(clave) || _errVistos.size>=20) return
    _errVistos.add(clave)
    let usuario = null; try{ usuario = (await supabase.auth.getSession())?.data?.session?.user?.email || null }catch(_){}
    if(!usuario) return   // sin sesión la tabla no acepta el registro
    await supabase.from('app_errores').insert({ usuario, vista: vista||null, origen, mensaje,
      stack: String(stack || err?.stack || '').slice(0,4000), version: BUILD_VERSION,
      url: String(location.pathname+location.search).slice(0,300), dispositivo: String(navigator.userAgent||'').slice(0,300) })
  }catch(_){}
}
alFalloDeEscritura(({metodo,tabla,status,cuerpo})=>registrarError({ origen:'escritura', vista:tabla, err:`${metodo} ${tabla} → ${status}: ${cuerpo}` }))   // escrituras que la base rechaza
if(typeof window!=='undefined' && !window.__errHook){ window.__errHook=true
  window.addEventListener('error', e=>registrarError({origen:'global', err:e.error||e.message}))
  window.addEventListener('unhandledrejection', e=>registrarError({origen:'promesa', err:e.reason}))
}

// Comisiones a terceros de UNA venta — FUENTE ÚNICA. Si la venta tiene comisiones registradas (terceros_pagos, sin las de
// facturas anuladas/borradas) son la verdad; si no tiene ninguna, se usa el "Costo prov." pactado como proyección.
// Devuelve {clp, real, filas}. "Queda para la oficina" = honorario (o lo facturado) − clp.
export const comisionesVenta = (s, terceros=[], billing=[], ufRef=0) => {
  const fuera = new Set((billing||[]).filter(b=>b&&(b.status==='Anulada'||b.deleted_at)).map(b=>String(b.id)))
  const filas = (terceros||[]).filter(t=>t&&s&&String(t.sale_id)===String(s.id)&&!(t.billing_id&&fuera.has(String(t.billing_id))))
  if(filas.length){
    const clp=filas.reduce((a,t)=>a+(Number(t.monto)||0),0)
    // Venta MENSUAL: el honorario cuenta 12 meses (ventaUF ×12) → el costo también. Los meses aún sin comisión se proyectan
    // con la última comisión mensual registrada. `clp` = solo lo registrado (para lo facturado); `anual` = registrado + proyectado (para el neto de la venta).
    let proy=0
    if(esRecurrente(s)){
      const fecha=t=>{ const b=(billing||[]).find(x=>String(x.id)===String(t.billing_id)); return String(b?.issued_at||t.created_at||'') }
      const ult=[...filas].sort((a,b)=>fecha(b).localeCompare(fecha(a)))[0]
      proy=Math.max(0,12-filas.length)*(Number(ult?.monto)||0)
    }
    return { clp, real:true, filas, proy, anual:clp+proy }
  }
  const clp0=Math.round(costoVentaUF(s,ufRef)*(ufRef||0))
  return { clp:clp0, real:false, filas:[], proy:0, anual:clp0 }
}

// ─── UF EN VIVO (fuente única) ────────────────────────────────────────────────
// Valor UF del día: tabla `indicadores` (CMF) y, si no está, mindicador.cl; con caché diario en localStorage.
// fetchUF() es el ÚNICO punto que lo consulta; nadie más debe hacerlo directo.
export const UF_CACHE_KEY = 'uf_cache_v1'

export const ufTodayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export const readUFCache = () => { try{ const c=JSON.parse(localStorage.getItem(UF_CACHE_KEY)||'null'); if(c&&typeof c.value==='number'&&c.date) return c }catch(_){} return null }

// Estado de UI que SOBREVIVE al desmontaje de la vista (store de módulo): para restaurar el acordeón/drill abierto al volver de un cross-link. Drop-in de useState.
export const _uiStore = {}

export function usePersistedState(key, def){ const [v,setV]=useState(()=> key in _uiStore ? _uiStore[key] : (typeof def==='function'?def():def)); const set=useCallback(nv=>setV(prev=>{ const val=typeof nv==='function'?nv(prev):nv; _uiStore[key]=val; return val }),[key]); return [v,set] }

export const writeUFCache = (date,value) => { try{ localStorage.setItem(UF_CACHE_KEY, JSON.stringify({date,value})) }catch(_){} }

// Devuelve {value,date,isToday}. Usa caché si es de hoy; si no, llama a la API y cachea;
// si la API falla, cae al último valor cacheado (aunque sea viejo); si no hay, {value:null}.
export async function fetchUF(){
  const today = ufTodayISO()
  const cache = readUFCache()
  if(cache && cache.date===today) return {value:cache.value, date:today, isToday:true}
  const t = await ufDeTabla(today, today)
  if(t?.[today]>0){ writeUFCache(today, t[today]); return {value:t[today], date:today, isToday:true} }
  try{
    const r = await fetch('https://mindicador.cl/api/uf')
    const j = await r.json()
    const v = j?.serie?.[0]?.valor
    if(typeof v==='number' && v>0){ writeUFCache(today, v); return {value:v, date:today, isToday:true} }
  }catch(_){}
  if(cache) return {value:cache.value, date:cache.date, isToday:false}
  return {value:null, date:null, isToday:false}
}

// Hook: devuelve {uf, asOf, isToday, loading}. Inicializa con el caché (muestra valor previo
// al instante) y refresca con fetchUF() una vez por montaje (la API se toca máx. 1 vez al día).
export function useUF(){
  const [state,setState] = useState(()=>{
    const c = readUFCache(); const today = ufTodayISO()
    if(c) return {uf:c.value, asOf:c.date, isToday:c.date===today, loading:c.date!==today}
    return {uf:null, asOf:null, isToday:false, loading:true}
  })
  useEffect(()=>{ let ok=true; fetchUF().then(r=>{ if(ok) setState({uf:r.value, asOf:r.date, isToday:r.isToday, loading:false}) }); return ()=>{ok=false} },[])
  return state
}

export function AsignarClienteInline({bill,clients,onAssign,label='Asignar cliente',placeholder='Buscar cliente…'}) {
  const [open,setOpen] = useState(false)
  const [q,setQ] = useState('')
  const wrapRef = useRef(null)
  const [pos,setPos] = useState(null)
  const matches = useMemo(()=>{ if(!q.trim()) return []; const t=q.toLowerCase(); return (clients||[]).filter(c=>_normTxt(c.name).includes(_normTxt(q))||(c.rut||'').toLowerCase().includes(t)).sort((a,b)=>(a.name||'').localeCompare(b.name||'','es')).slice(0,8) },[q,clients])
  // El dropdown va por PORTAL con position:fixed para no quedar recortado por contenedores con overflow (listas/modales).
  // body{zoom:1.18} (desktop) escala también al elemento fixed dentro de body → dividir las coords por el zoom aplicado
  // para que caiga JUSTO debajo del input (antes aparecía desplazado "en otro lugar").
  useEffect(()=>{ if(open&&wrapRef.current){ const r=wrapRef.current.getBoundingClientRect(); const z=parseFloat(getComputedStyle(document.body).zoom)||1; setPos({top:(r.bottom+4)/z,left:r.left/z,width:Math.max(r.width,200)/z}) } },[open,q,matches.length])
  if(!open) return (
    <button onClick={()=>setOpen(true)} style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{label}</button>
  )
  return (
    <div ref={wrapRef} style={{position:'relative',minWidth:180}}>
      <input autoFocus value={q} onChange={e=>setQ(e.target.value)} onBlur={()=>setTimeout(()=>setOpen(false),180)} placeholder={placeholder} style={{width:'100%',padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:12,boxSizing:'border-box',outline:'none'}}/>
      {open&&q.trim()&&pos&&createPortal(
        <div style={{position:'fixed',top:pos.top,left:pos.left,width:pos.width,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 6px 22px rgba(0,0,0,.18)',zIndex:99999,maxHeight:240,overflowY:'auto'}}>
          {matches.length>0 ? matches.map(c=>(
            <div key={c.id} onMouseDown={()=>{onAssign(bill,c.id);setOpen(false);setQ('')}} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
              <div style={{fontWeight:500}}>{c.name}</div>
              {c.rut&&<div style={{fontSize:10,color:C.muted}}>{fmtRutCL(c.rut)}</div>}
            </div>
          )) : <div style={{padding:'8px 12px',fontSize:12,color:C.muted}}>Sin clientes que calcen con «{q}»</div>}
        </div>, document.body)}
    </div>
  )
}

// ── Retiros a socios: distribución de utilidades (cliente interno, categoría 'Retiros'). Identifica al socio por `subcategory` (la clasificación manual, puesta al conciliar "Retiros › X") y, si no hay, por el RUT/nombre en la glosa. NO es costo de oficina; vive en la página Socios. ──
// Config de socios TENANT-AWARE: se llena de `miembros` (es_socio=true) del estudio al cargar; fallback = LEA, para no romper nada antes de que llegue la query. Vendible: ningún socio/RUT cableado en la lógica.
export let SOCIOS_CFG = [
  {nombre:'Cristóbal', rut:'15.621.320-9'},
  {nombre:'Erasmo',    rut:'15.371.733-8'},
]

// Equipo (no-socios con RUT) — también tenant-aware desde `miembros`; fallback LEA. Alimenta el tagger de conciliación (EQUIPO_RUT).
export let EQUIPO_CFG = [
  {nombre:'Martín',  rut:'19.889.733-7'},
  {nombre:'Martina', rut:'21.138.928-1'},
]

export const _norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim()

export function setSociosCfg(list){ const c=(list||[]).filter(s=>s&&s.nombre); if(c.length) SOCIOS_CFG=c }

export function setEquipoCfg(list){ EQUIPO_CFG=(list||[]).filter(s=>s&&s.nombre&&s.rut) }

// ── RESULTADO DEL MES — FUENTE ÚNICA (página Estado de resultados + tarjeta del Inicio). Regla acordada 2026-10-15:
// ingresos = facturación propia del SII emitida en el mes (sin facturas de externos ni de subarriendo, − notas de crédito) + subarriendo
//            + % retenido de las facturas de externos emitidas en el mes;
// egresos  = costos de operación del mes (planilla real SIN PPM; sin planilla, presupuesto sin PPM) + gastos varios + comisiones PAGADAS en el mes (bruto).
// El PPM va aparte (anticipo del impuesto anual). Un mes es provisorio hasta que la planilla lo cierra (15 del mes siguiente).
export const esPPMcosto = r => String(r?.categoria||'')==='Impuestos y patentes' && /ppm/i.test(String(r?.item||''))

// Remuneraciones REALES del mes desde el banco: gastos «Sueldos»/«Bono» de la oficina asignados al MES TRABAJADO
// (se pagan a fin de mes o los primeros días del siguiente: hasta el día 10 cuenta para el mes anterior).
// Quien emite boleta (miembros.paga_con_boleta) cuesta el BRUTO = líquido transferido ÷ (1 − tasa de retención del año).
export function remuneracionesBancoMes(expenses, clients, ym, boleta){
  const ofi=(clients||[]).find(c=>c&&(c.is_internal||/liberona\s+escala/i.test(c.name||''))); if(!ofi) return {total:0,items:[]}
  const items=[]
  ;(expenses||[]).forEach(e=>{ if(!e||e.deleted_at||e.type!=='gasto'||String(e.client_id)!==String(ofi.id)) return
    if(!['Sueldos','Bono'].includes(String(e.category||''))) return
    const d=String(e.date||'').slice(0,10); if(d.length<10) return
    const dia=Number(d.slice(8,10)); const mesTrab = dia<=10 ? _ymPrev(d.slice(0,7)) : d.slice(0,7)
    if(mesTrab!==ym) return
    const liq=Number(e.amount)||0, bol=boleta&&boleta.has(_normTxt(e.subcategory||''))
    items.push({e, persona:e.subcategory||'', liquido:liq, costo:bol?Math.round(liq/(1-tasaBHE(d))):liq, boleta:!!bol}) })
  return {total:items.reduce((a,x)=>a+x.costo,0), items}
}

// UF (2026-10-18): cada partida se convierte con la UF del DÍA en que ocurrió (ufDelDia sobre ufd = serie de mindicador):
// facturas y NC por emisión, comisiones por pago, gastos del banco por su fecha y la planilla mensual al cierre del mes (finMesOHoy).
// Sin serie (ufd null) todo cae a ufFb = UF de hoy, igual que antes. Los pesos no cambian.
export function resultadoMes(fu, {billing=[], terceros=[], costosOfiRows=[], expenses=[], clients=[], ufd=null, ufFb=0}, ym){
  const u=iso=>ufDelDia(ufd, iso, ufFb||UF_FALLBACK), ufFin=u(finMesOHoy(ym))
  const bById={}; (billing||[]).forEach(b=>{ if(b) bById[String(b.id)]=b })
  const extIds=new Set((terceros||[]).filter(t=>t&&t.comision_pct!=null&&t.billing_id).map(t=>String(t.billing_id)))
  let fac=0, subFac=0, facUF=0, subFacUF=0; const facDocs=[], sinReg=[]
  // Sin carga del SII (otro estudio, o demo): las facturas emitidas en la app son la fuente.
  const docsSrc = (fu?.sii||[]).length ? fu.sii : (billing||[]).filter(b=>b&&!b.deleted_at&&b.invoice_no&&b.status!=='Anulada'&&(esFacIngreso(b)||b.billing_type==='subarriendo')).map(b=>({tipo_dte:34,monto:montoFactura(b),fecha_emision:b.issued_at,folio:folioN(b.invoice_no),receptor_name:b.receptor_name||'',billing_id:b.id}))
  ;docsSrc.filter(d=>String(d.fecha_emision||'').startsWith(ym)).forEach(d=>{ const t=Number(d.tipo_dte), m=Number(d.monto)||0, b=bById[String(d.billing_id)]
    if(t===61){ fac-=m; facUF-=m/u(d.fecha_emision); facDocs.push({...d,b,nc:true}); return }
    if(t!==33&&t!==34) return
    if(extIds.has(String(d.billing_id))) return
    if(b&&b.billing_type==='reembolso') return   // gasto facturado al cliente: nunca es ingreso
    if(b&&b.billing_type==='subarriendo'){ subFac+=m; subFacUF+=m/u(d.fecha_emision); return }
    fac+=m; facUF+=m/u(d.fecha_emision); facDocs.push({...d,b}); if(!d.billing_id) sinReg.push(d) })
  const [Y,Mo]=String(ym).split('-').map(Number)
  const row=(fu?.plan||[]).find(r=>Number(r.anio)===Y&&Number(r.mes)===Mo)
  const n=k=>Number(row?.[k])||0
  // Subarriendo del mes: la planilla manda (una factura puede cubrir varios meses, p. ej. F321 marzo–abril); sin planilla, lo facturado.
  const sub = n('subarriendo')>0 ? n('subarriendo') : subFac
  const subUF = n('subarriendo')>0 ? n('subarriendo')/ufFin : subFacUF
  const rexItems=(terceros||[]).filter(t=>t&&Number(t.comision_monto)>0&&t.billing_id).map(t=>({t,b:bById[String(t.billing_id)]})).filter(x=>x.b&&!x.b.deleted_at&&x.b.status!=='Anulada'&&String(x.b.issued_at||'').startsWith(ym))
  const rex=rexItems.reduce((a,x)=>a+(Number(x.t.comision_monto)||0),0)
  const rexUF=rexItems.reduce((a,x)=>a+(Number(x.t.comision_monto)||0)/u(x.b.issued_at),0)
  const eff=r=>(r.desde&&ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto
  // Remuneraciones: lo pagado en el banco para ese mes; si aún no hay pagos (mes en curso), la planilla.
  const remB=remuneracionesBancoMes(expenses,clients,ym,fu?.boleta), remEst=!(remB.total>0)
  const rem = remB.total>0 ? remB.total : (n('sueldos')+n('honorarios'))
  const remUF = remB.total>0 ? remB.items.reduce((a,x)=>a+x.costo/u(x.e.date),0) : rem/ufFin
  const conItems=contadoraBancoItems(expenses,clients,ym), conB=conItems.reduce((a,e)=>a+(Number(e.amount)||0),0)
  const conUF = conB>0 ? conItems.reduce((a,e)=>a+(Number(e.amount)||0)/u(e.date),0) : n('contadora')/ufFin
  const pla=v=>[v, v/ufFin]   // monto mensual de la planilla → UF del cierre del mes
  let cosLines = row ? [['rem','Remuneraciones',rem,remUF],['cot','Cotizaciones',...pla(n('cotizaciones'))],['arr','Arriendo y GGCC',...pla(n('arriendo')+n('gastos_comunes'))],['con','Contadora',conB>0?conB:n('contadora'),conUF],['otr','Otros costos',...pla(n('otros_costos'))]]
    : [['pre','Presupuesto de oficina',...pla((costosOfiRows||[]).filter(r=>!esPPMcosto(r)).reduce((a,r)=>a+(Number(eff(r))||0)*(r.es_ingreso?-1:1),0))]]
  const ppm = row ? n('ppm') : (costosOfiRows||[]).filter(esPPMcosto).reduce((a,r)=>a+(Number(eff(r))||0),0)
  const gvItems=gastosVariosOfiItems(expenses,clients,ym), gv=gvItems.reduce((a,e)=>a+(Number(e.amount)||0),0)
  const gvUF=gvItems.reduce((a,e)=>a+(Number(e.amount)||0)/u(e.date),0)
  cosLines=[...cosLines,['gv','Gastos varios',gv,gvUF]].filter(x=>x[2]!==0).map(([k,l,m,mUF])=>({k,l,m,mUF}))
  const cos=cosLines.reduce((a,x)=>a+x.m,0), cosUF=cosLines.reduce((a,x)=>a+x.mUF,0)
  const byP={}; (terceros||[]).filter(t=>t&&t.comision_pct==null&&t.estado==='pagado'&&String(t.pagado_at||'').startsWith(ym)).forEach(t=>{ const k=String(t.proveedor_id||t.proveedor||'x'); if(!byP[k]) byP[k]={pid:t.proveedor_id,nombre:t.proveedor||'Colaborador',m:0,ts:[]}; byP[k].m+=Number(t.monto)||0; byP[k].ts.push(t) })
  const comList=Object.values(byP).sort((a,b)=>b.m-a.m), com=comList.reduce((a,x)=>a+x.m,0)
  const comUF=comList.reduce((a,x)=>a+x.ts.reduce((s,t)=>s+(Number(t.monto)||0)/u(t.pagado_at),0),0)
  const ing=fac+sub+rex, res=ing-cos-com, ingUF=facUF+subUF+rexUF, resUF=ingUF-cosUF-comUF
  return {ym,fac,sub,rex,rexItems,ing,cosLines,cos,gv,gvItems,com,comList,res,facUF,subUF,rexUF,ingUF,cosUF,comUF,resUF,margen:margenPct(res,ing),ppm,rem:row?rem:0,remEst,remItems:remB.items,estimado:!!row?.estimado,cerrado:!!row?.cerrado,cerradoAt:row?.cerrado_at||null,conPlanilla:!!row,facDocs,sinReg}
}

// Fuentes del resultado (ventas del SII + planilla de costos reales), cargadas una vez por sesión y compartidas por la página y el Inicio.
export let _fuentesRes=null, _fuentesResP=null

export function useFuentesResultado(){
  const [f,setF]=useState(()=>_fuentesRes||{sii:[],plan:[],boleta:new Set()})
  useEffect(()=>{ if(DEMO) return; if(_fuentesRes){ setF(_fuentesRes); return }
    if(!_fuentesResP) _fuentesResP=Promise.all([selectAll(()=>supabase.from('sii_cargas_docs').select('tipo_dte,monto,fecha_emision,folio,receptor_name,billing_id').order('id')),supabase.from('oficina_costos_mensual').select('*'),supabase.from('miembros').select('nombre').eq('paga_con_boleta',true)])
      .then(([a,b,c])=>{ _fuentesRes={sii:a?.data||[],plan:b?.data||[],boleta:new Set((c?.data||[]).map(x=>_normTxt(x.nombre)))}; return _fuentesRes }).catch(()=>{ _fuentesResP=null; return {sii:[],plan:[],boleta:new Set()} })
    let v=true; _fuentesResP.then(x=>{ if(v) setF(x) }); return ()=>{v=false} },[])
  return f
}

export const _ymPrev = ym => { const [Y,M]=String(ym).split('-').map(Number); const d=new Date(Y,M-2,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }

// Tono por margen (comparativa mensual): pérdida rojo · bajo ámbar · medio verde suave · bueno verde · muy bueno verde intenso.
// Margen % (fuente única): sin ingresos, o con una pérdida mayor que los ingresos (p. ej. −1.623 % en un mes casi sin facturar), no informa → null («—»).
export const margenPct = (res, ing) => { const i=Number(ing)||0; if(!(i>0)) return null; const m=(Number(res)||0)/i*100; return m<-100?null:m }

export function resolverClienteSII(rut, nombre, clients=[], clientEntities=[]){
  // Cruce TOTAL por RUT (llave única): el RUT SIEMPRE gana; el nombre es solo fallback si el RUT no resolvió.
  // Normalizador ÚNICO de la app (crNormRut: mayúscula, solo dígitos+K) → tolera puntos/guión/espacios internos y formatos mixtos.
  const k = crNormRut(rut)
  if(k){ const ce=clientEntities.find(e=>crNormRut(e.rut)===k); const c=ce&&clients.find(c=>String(c.id)===String(ce.client_id)); if(c) return c }   // RUT ↔ razón social
  if(k){ const c=clients.find(c=>crNormRut(c.rut)===k); if(c) return c }                                                                             // RUT ↔ cliente
  // Fallback por NOMBRE con el normalizador robusto (NFD + colapsa espacios + trim), no toLowerCase a secas:
  // tolera acentos/espacios/mayúsculas ("Comercial  Andes SPA" ↔ "comercial andes spa") → no vuelve a pedir asignar lo ya conocido.
  const nn=nrmCliente(nombre)
  if(nn){ const ce=clientEntities.find(e=>e.name&&nrmCliente(e.name)===nn); const c=ce&&clients.find(c=>String(c.id)===String(ce.client_id)); if(c) return c }
  if(nn){ const c=clients.find(c=>c.name&&nrmCliente(c.name)===nn); if(c) return c }
  return null
}

// useExpensesModel: capa de MODELO de Gastos (estado + datos derivados + acciones), extraida de ExpensesView para
// habilitar presentaciones movil/desktop sobre la MISMA logica. Traslado verbatim: no cambia ninguna formula.
// Volver al LUGAR EXACTO de Gastos tras abrir un gasto como página (la vista se desmonta al saltar): se guarda la sub-vista antes del salto
// y se lee al volver a montar (una sola vez: el efecto de ExpensesView la borra). Caduca a los 30 min.
// Notaría · OT que "no son nuestras": se guardan COMPLETAS y para siempre en `notaria_no_nuestras` (una fila por N° de OT, con
// cargas e historial). Regla del usuario 2026-10-08: en notaría nunca se pierde información. canonOtNN = forma única del N° de OT.
// Saldo con signo canónico: −$265.000 (no '$-265.000').
export const fmtSaldoG = v => (Number(v)<0?'−':'')+fmt(Math.abs(Number(v)||0))

// Volver al LUGAR EXACTO tras una página (factura, tarea…): la vista de origen se desmonta al saltar. Cada vista guarda su sub-estado en
// memoria (_viewMem) y, si se vuelve a montar justo después de un 'volver' (handleBackOrigin marca _volviendoAt), lo retoma. Abrirla de nuevo
// desde la barra NO lo retoma (pasaron más de 4 s desde el último 'volver').
export const _viewMem={}; let _volviendoAt=0

export function marcarVolviendo(){ _volviendoAt=Date.now() }   // handleBackOrigin marca el regreso (un import no puede reasignar la variable)

export const viewMemLeer = k => (Date.now()-_volviendoAt<4000) ? (_viewMem[k]||null) : null

export const viewMemGuardar = (k,v) => { _viewMem[k]=v }

// Editar/Nuevo cliente como PÁGINA navegable (no modal): header "‹ Volver" + ClientForm centrado.
// Móvil = columna única (idéntico al form de antes); escritorio = ClientForm en 2 columnas (ancho mayor).
// ─── PÁGINAS (no modales): Tarea y Gasto ─────────────────────────────────────
// Molde de EditClientePage: header sticky "‹ {origen} | Título | Cliente" + cuerpo en columna (escritorio: columna 680 + lateral 340).
// Reusan los formularios tal cual; solo se oculta su cabecera propia (.pg-form .qt-head) porque el header lo pone la página.
export function PageHeader({origen,onBack,titulo,ctx,right,style}){
  return (
    <div style={{padding:'14px 16px 10px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`,...style}}>
      <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
        <BackBtn origen={origen} onBack={onBack}/>
        <span style={{color:C.textSoft,fontWeight:400}}>|</span>
        <span style={{fontSize:16,fontWeight:800,color:C.accent,flexShrink:0}}>{titulo}</span>
        {ctx&&<><span style={{color:C.textSoft,fontWeight:400}}>|</span><span style={{fontSize:13,color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ctx}</span></>}
        {right&&<span style={{marginLeft:'auto',flexShrink:0}}>{right}</span>}
      </div>
    </div>
  )
}

// Flecha de volver: botón cuadrado con chevrón (blanco de toque cómodo) + origen. Una sola forma en toda la app.
export function BackBtn({origen,onBack}){
  return (
    <span onClick={onBack} style={{display:'inline-flex',alignItems:'center',gap:7,cursor:'pointer',flexShrink:0}}>
      <span style={{width:30,height:30,borderRadius:9,border:`1px solid ${C.border}`,background:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',color:C.accent,fontSize:15,lineHeight:1}}><Gl n='chevL'/></span>
      {origen&&<span style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{origen}</span>}
    </span>)
}

export function FlujoPagina({origen,titulo,ctx,onBack,maxW=1060,children}){
  const isDesktop=useIsDesktop()
  return (
    <div>
      <PageHeader origen={origen} onBack={onBack} titulo={titulo} ctx={ctx}/>
      <div style={{padding:isDesktop?'18px 28px 48px':'14px 16px 48px',maxWidth:isDesktop?maxW:640,margin:'0 auto'}}>{children}</div>
    </div>
  )
}

// ─── PARSER + DRIVE IMPORTER (sin cambios) ───────────────────────────────────
export const MESES={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}

export async function driveGet(token,url){
  const fullUrl=url+(url.includes('?')?'&':'?')+'supportsAllDrives=true&includeItemsFromAllDrives=true'
  const r=await fetch(fullUrl,{headers:{Authorization:'Bearer '+token}})
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive API error '+r.status)
  return r.json()
}

// Error de token de Drive vencido/ausente → gatilla reconexión
export class DriveAuthError extends Error { constructor(){ super('drive_auth'); this.code=401 } }

// Token de Drive: localStorage → sesión
export async function driveToken(){
  let t=localStorage.getItem('drive_token')
  if(!t){ try{ t=await getDriveToken() }catch(_){} }
  return t||null
}

// ── GMAIL API: enviar rendición con PDF adjunto. Requiere el scope gmail.send en el login
//    (agregar a supabase.js cuando esté habilitado en Google Cloud Console). Sin ese scope,
//    la API devuelve 403 y el modal cae al fallback de Gmail compose (sin adjunto). ──
// PDF de la rendición (jsPDF) → base64 sin el prefijo dataURL
// ── Representación impresa (PDF) de una factura electrónica desde su DTE XML (diseño validado) ──
export let _bwipP=null

export function _loadBwip(){
  if(typeof window!=='undefined' && window.bwipjs) return Promise.resolve(window.bwipjs)
  if(_bwipP) return _bwipP
  _bwipP=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/bwip-js@4.5.1/dist/bwip-js-min.js'; s.onload=()=>res(window.bwipjs); s.onerror=()=>rej(new Error('No se pudo cargar bwip-js (PDF417)')); document.head.appendChild(s) })
  return _bwipP
}

// Recibe el string de UN <Documento> (factura exenta tipo 34). Devuelve {base64,folio,rznR,rutR,total}.
// Representación impresa del DTE (Res. Ex. SII 18/2003, mod. 22/2016): recuadro con RUT, nombre del documento con «electrónica» y N°;
// timbre PDF417 de 2×4,5 a 4×9 cm a más de 200 ppp; «Timbre Electrónico SII», la resolución que autoriza al emisor y
// «Verifique documento: www.sii.cl». opts.cedible = copia cedible con acuse de recibo (Ley 19.983). opts.resol = {nro, anio}.
export const NOMBRE_DTE={33:['FACTURA','ELECTRÓNICA'],34:['FACTURA NO AFECTA O','EXENTA ELECTRÓNICA'],56:['NOTA DE DÉBITO','ELECTRÓNICA'],61:['NOTA DE CRÉDITO','ELECTRÓNICA']}

export const NOMBRE_DTE_CORTO={33:'Factura',34:'Factura exenta',56:'Nota de débito',61:'Nota de crédito'}

export async function facturaDtePdfBase64(docXml, opts={}){
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const bwip = await _loadBwip()
  // Los textos del XML vienen escapados («A &amp; B»): se imprimen como los lee el cliente (regla única desescaparXml).
  const g=(t,s=docXml)=>{ const m=s.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>')); return m?desescaparXml(m[1].trim()):'' }
  const ted=(docXml.match(/<TED[\s\S]*?<\/TED>/)||[''])[0]
  const idDoc=(docXml.match(/<IdDoc>[\s\S]*?<\/IdDoc>/)||[''])[0], emi=(docXml.match(/<Emisor>[\s\S]*?<\/Emisor>/)||[''])[0], rec=(docXml.match(/<Receptor>[\s\S]*?<\/Receptor>/)||[''])[0], tot=(docXml.match(/<Totales>[\s\S]*?<\/Totales>/)||[''])[0]
  const detalles=[...docXml.matchAll(/<Detalle>[\s\S]*?<\/Detalle>/g)].map(m=>m[0])
  const refs=[...docXml.matchAll(/<Referencia>[\s\S]*?<\/Referencia>/g)].map(m=>({tipo:g('TpoDocRef',m[0]), folio:g('FolioRef',m[0]), fch:g('FchRef',m[0]), razon:g('RazonRef',m[0])}))
  const tipoD=+g('TipoDTE',idDoc)||34, resol=opts.resol||_resolDoc.get(docXml)||BRAND.siiResol||{nro:'99',anio:'2014'}
  const D={ folio:g('Folio',idDoc), fch:g('FchEmis',idDoc), fma:g('FmaPago',idDoc), rutE:g('RUTEmisor',emi),
    rutR:g('RUTRecep',rec), rznR:g('RznSocRecep',rec), giroR:g('GiroRecep',rec), dirR:g('DirRecep',rec), cmnaR:g('CmnaRecep',rec), ciuR:g('CiudadRecep',rec),
    exe:+g('MntExe',tot), total:+g('MntTotal',tot),
    items:detalles.map(d=>({nmb:g('NmbItem',d), dsc:g('DscItem',d), qty:g('QtyItem',d), prc:+g('PrcItem',d), mnt:+g('MontoItem',d)})) }
  const fmtRut=r=>{ const a=String(r||'').split('-'); return (a[0]||'').replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(a[1]?'-'+a[1]:'') }
  const fmtN=n=>(n||0).toLocaleString('es-CL')
  const MES=['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const fchL=iso=>{ const a=String(iso||'').split('-'); return a.length<3?'':`${+a[2]} de ${String(MES[+a[1]]||'').toLowerCase()} de ${a[0]}` }
  const fma={'1':'Contado','2':'Crédito','3':'Sin costo'}[D.fma]||''
  const logo=LOGO_FACTURA_B64
  const NAVY=[0,60,80], GRAF=[61,61,61], MUT=[83,114,129], BORD=[210,216,221], RED=[192,11,11], REDLT=[196,125,125]
  const cv=document.createElement('canvas'); bwip.toCanvas(cv,{ bcid:'pdf417', text:ted, scale:4, eclevel:5, includetext:false }); const bc=cv.toDataURL('image/png')
  // Tamaño legal del timbre: alto 20–40 mm y ancho 45–90 mm, manteniendo la proporción del símbolo.
  const rat=cv.height/cv.width||0.35; let tw=62, th=tw*rat; if(th<20){ th=20; tw=Math.min(90,th/rat) } if(th>40){ th=40; tw=Math.max(45,th/rat) }
  const p=new jsPDF({unit:'mm',format:'letter',compress:true}); const W=215.9, M=15
  p.setDrawColor(...BORD); p.setLineWidth(0.4); p.roundedRect(11,12,W-22,261,2.5,2.5)
  p.addImage(logo,'PNG',M,16,80,20.8)
  const bw=54, bx=W-M-bw, by=16, bh=32
  p.setDrawColor(...RED); p.setLineWidth(0.8); p.roundedRect(bx,by,bw,bh,2,2)
  p.setTextColor(...RED); p.setFont('helvetica','bold')
  p.setFontSize(11); p.text('R.U.T. '+fmtRut(D.rutE),bx+bw/2,by+6.5,{align:'center'})
  const nom=NOMBRE_DTE[tipoD]||NOMBRE_DTE[34]; p.setFontSize(9); p.text(nom[0],bx+bw/2,by+13,{align:'center'}); p.text(nom[1],bx+bw/2,by+17,{align:'center'})
  p.setFontSize(16.5); p.text('N° '+D.folio,bx+bw/2,by+25,{align:'center'})
  p.setFont('helvetica','normal'); p.setFontSize(6.5); p.setTextColor(...REDLT); p.text(BRAND.siiUnidad||'S.I.I. - SANTIAGO ORIENTE',bx+bw/2,by+30,{align:'center'})
  const fy=by+bh+6; p.setFont('helvetica','normal'); p.setFontSize(8); p.setTextColor(...MUT)
  // Fecha alineada al borde derecho del recuadro del folio (un mes largo no se sale de la hoja).
  const flw=p.getTextWidth('Fecha de emisión:  '); p.setFont('helvetica','bold'); const fvw=p.getTextWidth(fchL(D.fch)); const fx=Math.max(M,bx+bw-flw-fvw)
  p.setFont('helvetica','normal'); p.text('Fecha de emisión:',fx,fy); p.setFont('helvetica','bold'); p.setTextColor(...GRAF); p.text(fchL(D.fch),fx+flw,fy)
  let ye=43; p.setFontSize(8.5)
  // Datos del emisor a la izquierda, sin entrar al recuadro del folio: un texto largo (dirección) pasa a una segunda línea.
  const inl=(lab,val,vcol)=>{ p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text(lab,M,ye); const w=p.getTextWidth(lab+'  '); p.setFont('helvetica','normal'); p.setTextColor(...(vcol||GRAF)); const ls=p.splitTextToSize(String(val||''),bx-4-(M+w)); ls.forEach((l,i)=>p.text(l,M+w,ye+i*3.9)); ye+=4.7+(ls.length-1)*3.9 }
  // Datos del emisor: los del DTE (lo que el SII recibió); el texto de la app solo si el XML no los trae.
  const giroE=g('GiroEmis',emi)||'Prestación de servicios y asesorías profesionales', dirE=[g('DirOrigen',emi),g('CmnaOrigen',emi)].filter(Boolean).join(', ')||BRAND.direccionCalle
  inl('Giro:',giroE)
  inl('Dirección:',dirE)
  p.setFontSize(8.5)
  p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text('Email:',M,ye); let cx=M+p.getTextWidth('Email:  ')
  const mailE=g('CorreoEmisor',emi)||BRAND.pago.honorarios.email
  p.setFont('helvetica','normal'); p.setTextColor(...GRAF); p.text(mailE,cx,ye); cx+=p.getTextWidth(mailE)
  p.setTextColor(...MUT); p.text('     ·     ',cx,ye); cx+=p.getTextWidth('     ·     ')
  p.setFont('helvetica','bold'); p.setTextColor(...NAVY); p.text('Teléfono:',cx,ye); cx+=p.getTextWidth('Teléfono:  ')
  const telX=g('Telefono',emi), telE=/^9\d{8}$/.test(telX)?'+56'+telX:(telX||BRAND.telefonoFactura||BRAND.telefono)
  p.setFont('helvetica','normal'); p.setTextColor(...GRAF); p.text(telE,cx,ye); ye=Math.max(ye+6,by+bh+10)
  p.setFont('helvetica','bold'); p.setFontSize(9); p.setTextColor(...NAVY); p.text('VENTA DEL GIRO',M,ye)
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,ye+5,W-M,ye+5)
  // Receptor: la razón social y la dirección largas pasan a varias líneas y el recuadro crece (antes se montaban sobre el RUT).
  p.setFontSize(8.5); const rznL=p.splitTextToSize(String(D.rznR||''),150), dirL=p.splitTextToSize(String(D.dirR||''),150), extra=(rznL.length-1+Math.max(0,dirL.length-1))*4.2
  let y=ye+9; const rh=32+extra
  p.setFillColor(247,249,250); p.setDrawColor(...BORD); p.setLineWidth(0.3); p.roundedRect(M,y,W-2*M,rh,1.5,1.5,'FD')
  const VX=M+30; let yr=y+7
  const lbl=(t,x,yy)=>{ p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.text(t,x,yy) }
  const val=(t,x,yy,mw)=>{ p.setTextColor(...GRAF); p.setFont('helvetica','normal'); p.text(t,x,yy,mw?{maxWidth:mw}:undefined) }
  lbl('Señor(es):',M+3,yr); rznL.forEach((l,i)=>val(l,VX,yr+i*4.2)); yr+=5.4+(rznL.length-1)*4.2
  lbl('R.U.T.:',M+3,yr); val(fmtRut(D.rutR),VX,yr); yr+=5.4
  lbl('Giro:',M+3,yr); val(D.giroR,VX,yr,150); yr+=5.4
  lbl('Dirección:',M+3,yr); dirL.forEach((l,i)=>val(l,VX,yr+i*4.2)); yr+=5.4+Math.max(0,dirL.length-1)*4.2
  lbl('Comuna:',M+3,yr); val(D.cmnaR,VX,yr); lbl('Ciudad:',M+98,yr); val(D.ciuR,M+114,yr)
  y+=rh+9
  p.setFillColor(...NAVY); p.rect(M,y,W-2*M,7.5,'F'); p.setTextColor(255,255,255); p.setFont('helvetica','bold'); p.setFontSize(8)
  const cD=M+3, cQ=128, cP=158, cV=W-M-3
  p.text('DESCRIPCIÓN',cD,y+5); p.text('CANT.',cQ,y+5,{align:'center'}); p.text('PRECIO UNIT.',cP,y+5,{align:'right'}); p.text('VALOR',cV,y+5,{align:'right'})
  y+=7.5
  D.items.forEach(it=>{ y+=5.5; p.setTextColor(...GRAF); p.setFont('helvetica','bold'); p.setFontSize(8.5); p.text(String(it.nmb||''),cD,y)
    p.text(String(+it.qty||''),cQ,y,{align:'center'}); p.setFont('helvetica','normal'); p.text(it.prc?fmtN(it.prc):'',cP,y,{align:'right'}); p.text(fmtN(it.mnt),cV,y,{align:'right'})
    if(it.dsc){ p.setFontSize(7.5); p.setTextColor(...MUT); String(it.dsc).split('\n').forEach(l=>{ y+=3.6; p.text(l,cD+1,y) }) } y+=2.5 })
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,y,W-M,y)
  y+=6; p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.setFontSize(8.5); p.text('Forma de pago: ',M,y); p.setTextColor(...GRAF); p.setFont('helvetica','normal'); p.text(fma,M+24,y)
  // Referencias (notas de crédito y débito): el documento que modifican.
  if(refs.length){ y+=6; p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.text('Referencias:',M,y); p.setTextColor(...GRAF); p.setFont('helvetica','normal')
    refs.forEach((r,i)=>{ const f=String(r.fch||'').split('-'); p.text(`${NOMBRE_DTE_CORTO[+r.tipo]||('Documento '+r.tipo)} N° ${r.folio}${f.length===3?` del ${f[2]}-${f[1]}-${f[0]}`:''}${r.razon?` · ${r.razon}`:''}`,M+20,y+i*4.5) }); y+=(refs.length-1)*4.5 }
  const ty=232
  // Copia cedible (Ley 19.983): acuse de recibo sobre el timbre y la leyenda CEDIBLE.
  if(opts.cedible){ const ay=ty-36; p.setDrawColor(...BORD); p.setLineWidth(0.3); p.rect(M,ay,W-2*M,26)
    p.setFontSize(8); p.setTextColor(...NAVY); p.setFont('helvetica','bold'); p.text('ACUSE DE RECIBO',M+3,ay+5)
    p.setFont('helvetica','normal'); p.setTextColor(...GRAF); [['Nombre:',M+3,ay+11],['R.U.T.:',M+100,ay+11],['Fecha:',M+3,ay+17],['Recinto:',M+60,ay+17],['Firma:',M+130,ay+17]].forEach(([t,x,yy])=>{ p.text(t,x,yy); p.line(x+p.getTextWidth(t)+1.5,yy+0.6,x+(t==='Nombre:'?90:t==='R.U.T.:'?80:t==='Firma:'?50:65),yy+0.6) })
    p.setFontSize(6.5); p.setTextColor(...MUT); p.text('El acuse de recibo que se declara en este acto, de acuerdo a lo dispuesto en la letra b) del Art. 4, y la letra c) del Art. 5 de la Ley 19.983, acredita que la entrega de mercaderías o servicio(s) prestado(s) ha(n) sido recibido(s).',M+3,ay+22,{maxWidth:W-2*M-6}) }
  p.setDrawColor(...BORD); p.setLineWidth(0.3); p.line(M,ty-8,W-M,ty-8)
  p.addImage(bc,'PNG',M,ty,tw,th)
  p.setTextColor(...MUT); p.setFont('helvetica','normal'); p.setFontSize(7)
  p.text('Timbre Electrónico SII',M,ty+th+3.5); p.text(`Res. ${resol.nro} de ${resol.anio} · Verifique documento: www.sii.cl`,M,ty+th+6.8)
  p.setFontSize(9); p.setTextColor(...GRAF); p.setFont('helvetica','normal')
  p.text('Impuesto adicional',138,ty+1); p.text('$ '+fmtN(0),W-M,ty+1,{align:'right'})
  p.text('Monto exento',138,ty+7.5); p.text('$ '+fmtN(D.exe),W-M,ty+7.5,{align:'right'})
  p.setDrawColor(...NAVY); p.setLineWidth(0.5); p.line(138,ty+10.5,W-M,ty+10.5)
  p.setFont('helvetica','bold'); p.setFontSize(12); p.setTextColor(...NAVY); p.text('TOTAL',138,ty+16.5); p.text('$ '+fmtN(D.total),W-M,ty+16.5,{align:'right'})
  if(opts.cedible){ p.setFont('helvetica','bold'); p.setFontSize(11); p.setTextColor(...RED); p.text('CEDIBLE',W-M,ty+th+6.8,{align:'right'}) }
  p.setTextColor(...MUT); p.setFont('helvetica','normal'); p.setFontSize(7); p.text(BRAND.web,W/2,270,{align:'center'})
  return { base64: p.output('datauristring').split(',')[1], folio:D.folio, rznR:D.rznR, rutR:D.rutR, total:D.total }
}

// Parte un SetDTE/EnvioDTE en sus <Documento> individuales.
// Documentos de un sobre. Recuerda la resolución del SII de su Carátula (NroResol/FchResol), que va bajo el timbre del PDF.
export const _resolDoc=new Map()

export function splitSetDTE(xml){ const s=String(xml||''), car=(s.match(/<Caratula[\s\S]*?<\/Caratula>/)||[''])[0], nro=(car.match(/<NroResol>(\d+)<\/NroResol>/)||[])[1], anio=(car.match(/<FchResol>(\d{4})/)||[])[1]
  const docs=[...s.matchAll(/<Documento[\s\S]*?<\/Documento>/g)].map(m=>m[0]); if(nro!=null&&anio) docs.forEach(d=>_resolDoc.set(d,{nro,anio})); return docs }

// xlsx-js-style: fork de SheetJS que SÍ escribe estilos de celda (colores, bordes, moneda). El xlsx plano no.
export async function loadXLSXStyle(){ const m=await import('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/+esm'); return m.utils?m:(m.default||m) }

// REGLA (usuario): los correos SIEMPRE salen desde el correo del usuario. Si su acceso a Gmail venció o no tiene el permiso,
// NO se manda a escondidas desde otra cuenta: se pregunta y se explica cómo dejarlo saliendo desde el suyo (reingresar).
export const MAIL_OFICINA_CONFIRM = `El correo no salió desde tu cuenta: el acceso de la app a tu Gmail expiró o no está disponible.\n\nPara que salga desde tu cuenta: cierra sesión en la app, vuelve a entrar con tu cuenta @${BRAND.emailDominio} y reintenta.\n\n¿Enviarlo ahora desde la cuenta de la oficina?\n(Cancelar = no se envía)`

// Confirmación de envío (fuente única de los textos): siempre se sabe si el correo salió, desde qué cuenta y a quién; y si no salió, qué hacer.
export const TXT_REINGRESO = () => `Cierra sesión en la app, vuelve a entrar con tu cuenta @${BRAND.emailDominio} y reintenta el envío.`

export const txtEnviado = (via, {que='Correo', g='o', para, verbo='enviad'}={}) => `${que} ${verbo}${g}${para?` a ${para}`:''} desde ${via==='oficina'?'la cuenta de la oficina':'tu cuenta'}.`   // g: o · a · os · as

export const txtNoEnviado = (que, detalle) => `${que?`${que}: el`:'El'} correo NO se envió.\n\n${TXT_REINGRESO()}${detalle?`\n\nDetalle: ${detalle}`:''}`

export function avisoNoEnviado(que, detalle){ appAlert(txtNoEnviado(que, detalle)) }

// Envía desde el Gmail del usuario; si falla, PREGUNTA antes de usar la oficina. Devuelve 'usuario' | 'oficina' | null (cancelado, no se envió).
// Para envíos masivos pasa modo pre-decidido en `batch` ('usuario'|'oficina'|'cancelar') para no preguntar por cada correo.
// Convierte los logos del correo (header blanco + firma color) en imágenes INLINE (CID), para que se muestren
// SIEMPRE aunque el cliente bloquee imágenes externas (Gmail lo hace por defecto). Devuelve el html con
// src="cid:..." + la lista inlineImages [{cid,b64,mime}]. Si algo falla, deja ese logo con su URL remota.
export async function incrustarLogosCorreo(html, existing){
  const imgs = Array.isArray(existing) ? [...existing] : []
  if(!html || typeof fetch==='undefined') return { html, inlineImages: imgs.length?imgs:null }
  const defs = [ [BRAND.logo.blanco,'lea-logo-blanco'], [BRAND.logo.color,'lea-logo-color'], [BRAND.logo.full,'lea-logo-full'] ]
  let out = html
  for(const [path,cid] of defs){
    if(!path || !out.includes(path)) continue
    const urls = [ `${location.origin}${path}`, `${BRAND.logoUrl}${path}` ]   // según cómo se armó el src
    if(!urls.some(u=>out.includes(u))) continue
    try{
      const blob = await (await fetch(`${location.origin}${path}`)).blob()
      const b64 = await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onloadend=()=>res(String(fr.result||'').split(',')[1]||''); fr.onerror=rej; fr.readAsDataURL(blob) })
      if(!b64) continue
      urls.forEach(u=>{ out = out.split(u).join(`cid:${cid}`) })
      imgs.push({ cid, b64, mime: blob.type||'image/png' })
    }catch(_){ /* sin conexión al asset: se queda con la URL remota */ }
  }
  return { html: out, inlineImages: imgs.length?imgs:null }
}

export async function enviarComoUsuario(opts, batch){
  // Gmail = logo INLINE (CID) para que se vea siempre; el preview en la app y el SMTP de oficina siguen con URL.
  const emb = await incrustarLogosCorreo(opts.html, opts.inlineImages)
  const gmail = {to:opts.to, cc:opts.cc, subject:opts.subject, bodyText:opts.text, bodyHtml:emb.html, pdfBase64:opts.pdfBase64, pdfName:opts.pdfName, attachments:opts.attachments, inlineImages:emb.inlineImages}
  const server = {to:opts.to, cc:opts.cc, subject:opts.subject, html:opts.html, text:opts.text, pdfBase64:opts.pdfBase64, pdfName:opts.pdfName, attachments:opts.attachments}
  if(batch==='oficina'){ await sendMailServer(server); return 'oficina' }
  if(batch==='cancelar'){ return null }
  // Envío individual sin salir: se avisa SIEMPRE que no salió y qué hacer (salvo que el llamador lo informe con su propio texto: opts.sinAviso).
  // En lote (batch) el llamador resume al final (txtResumenEnvio).
  let gErr=null
  try{ const token=await driveToken(); if(token){ await sendGmailWithPdf(token, gmail); return 'usuario' } }catch(e){ gErr=e }
  const detalle = gErr && !/Gmail API 40[13]/.test(String(gErr.message||'')) ? String(gErr.message||gErr) : null   // 401/403 = acceso expirado (lo cubre el aviso de reingreso)
  const noSalio = r => { if(!batch&&!opts.sinAviso) avisoNoEnviado(opts.que, detalle); return r }
  if(opts.soloUsuario) return noSalio('reauth')   // facturas: NO caer a la oficina automáticamente; reingresar y reintentar desde tu correo
  if(batch==='usuario') return null   // en masivo modo-usuario, si falla uno no preguntamos: se omite (el resumen lo cuenta)
  if(!await appConfirm(MAIL_OFICINA_CONFIRM)) return noSalio(null)
  await sendMailServer(server); return 'oficina'
}

// Envío desde la CUENTA DE OFICINA vía edge function (SMTP). Se usa SOLO cuando el usuario aceptó (ver enviarComoUsuario).
export async function sendMailServer({to, cc, subject, html, text, pdfBase64, pdfName, attachments}){
  // El SMTP del servidor (denomailer) trata un string "a@x, b@x" como UNA dirección y rebota
  // ("not a valid RFC 5321 address"). Mandar los destinatarios SIEMPRE como array de correos.
  const arr = v => v==null||v==='' ? null : (Array.isArray(v)?v:String(v).split(/[,;]+/).map(s=>s.trim()).filter(Boolean))
  const res = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notify-task',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(await tokenSesion()),'apikey':supabase.supabaseKey},
    body:JSON.stringify({mail:{to:arr(to), cc:arr(cc), subject, html:html||null, text:text||null, pdfBase64:pdfBase64||null, pdfName:pdfName||null, attachments:attachments||null}})
  })
  if(!res.ok){ let m=''; try{ m=(await res.json()).error||'' }catch(_){} throw new Error('Servidor '+res.status+(m?': '+m:'')) }
  return true
}

// Construye el MIME multipart y lo envía con la API de Gmail
export async function sendGmailWithPdf(token, {to, cc, subject, bodyText, bodyHtml, pdfBase64, pdfName, attachments, inlineImages}){
  // RFC 2045: el base64 debe ir en líneas ≤76. Una sola línea larga (HTML/PDF reales) la trunca el SMTP
  // de reenvío → cuerpo y adjunto corruptos. wrap76 corta cada bloque en líneas de 76 con CRLF.
  const wrap76 = s => String(s||'').replace(/[\r\n]/g,'').replace(/(.{76})/g,'$1\r\n').trim()
  const b64 = s => wrap76(btoa(unescape(encodeURIComponent(s))))
  // Adjuntos: lista [{base64,name,mime}]. Compat: pdfBase64/pdfName = un adjunto PDF.
  const atts = (attachments&&attachments.length) ? attachments : (pdfBase64?[{base64:pdfBase64,name:pdfName||'documento.pdf',mime:'application/pdf'}]:[])
  const boundary = 'lea_'+Date.now()
  const alt = 'alt_'+Date.now()
  // multipart/mixed → [ multipart/alternative → (text/plain, text/html) , adjuntos… ]
  // Imágenes inline (cid): el HTML las referencia con src="cid:xxx"; van en un multipart/related que envuelve el alternative.
  const rel = 'rel_'+Date.now()
  const inlineParts = (inlineImages||[]).flatMap(im=>[
    `--${rel}`, `Content-Type: ${im.mime||'image/png'}`, 'Content-Transfer-Encoding: base64', `Content-ID: <${im.cid}>`, `Content-Disposition: inline; filename="${im.cid}.png"`, '', wrap76(im.b64), ''
  ])
  const altBlock = [
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(bodyText), '',
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(bodyHtml), '',
    `--${alt}--`, ''
  ]
  const cuerpo = !bodyHtml ? [
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(bodyText), ''
  ] : (inlineImages&&inlineImages.length) ? [
    `--${boundary}`, `Content-Type: multipart/related; boundary="${rel}"`, '',
    `--${rel}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    ...altBlock,
    ...inlineParts,
    `--${rel}--`, ''
  ] : [
    `--${boundary}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    ...altBlock
  ]
  const attParts = atts.flatMap(a=>[
    `--${boundary}`, `Content-Type: ${a.mime||'application/octet-stream'}; name="${a.name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${a.name}"`, '', wrap76(a.base64), ''
  ])
  const mime = [
    `To: ${to}`, ...(cc?[`Cc: ${cc}`]:[]), `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    ...cuerpo,
    ...attParts,
    `--${boundary}--`
  ].join('\r\n')
  const raw = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body: JSON.stringify({raw})
  })
  if(!res.ok){ const err=new Error('Gmail API '+res.status); err.code=res.status; throw err }
  return res.json()
}

// ── DETECCIÓN ÚNICA de "programada ya emitida" (fantasma/duplicada). Fuente única para: el conteo de duplicados
//    (Facturación), el inline "Ya emitida" (Facturas del mes) y el panel de resolución (Conciliar). Así los 3 nunca divergen.
//    Une DOS criterios: (a) por cuota/período del concepto (recurrentes de la app, tolera corrida de UF) y
//    (b) por RUT/RS + monto ±5% + fecha ±60d (facturas traídas del SII con concepto genérico "Honorarios"). FIFO 1:1.
export const _MESMAP_G = {enero:1,ene:1,febrero:2,feb:2,marzo:3,mar:3,abril:4,abr:4,mayo:5,may:5,junio:6,jun:6,julio:7,jul:7,agosto:8,ago:8,septiembre:9,sept:9,sep:9,octubre:10,oct:10,noviembre:11,nov:11,diciembre:12,dic:12}

export const concPeriodoOf = c => { const s=(c||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,''); let m=s.match(/\b(20\d{2})[-\/](0?[1-9]|1[0-2])\b/); if(m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`; m=s.match(/\b(0?[1-9]|1[0-2])[-\/](20\d{2})\b/); if(m) return `${m[2]}-${String(+m[1]).padStart(2,'0')}`; const ym=s.match(/\b(20\d{2})\b/); for(const k of Object.keys(_MESMAP_G)){ const mm=s.match(new RegExp('\\b'+k+'\\b\\.?\\s*(20\\d{2}|\\d{2})?')); if(mm){ let y=mm[1]||(ym&&ym[1]); if(!y) continue; if(String(y).length===2) y='20'+y; return `${y}-${String(_MESMAP_G[k]).padStart(2,'0')}` } } return null }

export const ADMIN_NAMES = ['Cristóbal','Erasmo']

// CATÁLOGO de Costos de Oficina (presupuesto de la firma): 9 categorías con su desglose. Reconstruido del Presupuesto 2026.
// Parametrizable por estudio (regla de oro): las personas van como MONTO dentro de Socios/Abogados/etc., no cableadas como subcategoría.
export const CATS_OFICINA_CAT = [
  { g:'Remuneraciones',          subs:['Socios','Abogados','Procurador','Abogado junior','Contadora','Aumentos y bonos'] },
  { g:'Leyes sociales',          subs:['Cotizaciones','Mutual / cesantía','Gratificación'] },
  { g:'Impuestos y patentes',    subs:['PPM','Patente municipal','Otros tributarios'] },
  { g:'Arriendo y espacio',      subs:['Arriendo','Gastos comunes','Limpieza','Subarriendo'] },
  { g:'Servicios y tecnología',  subs:['Cuentas (luz/agua/gas)','Internet','Telefonía','Google Workspace','ChatGPT','Software legal','FirmDesk','Respaldo / ciberseguridad'] },
  { g:'Insumos de oficina',      subs:['Agua y bebidas','Café y supermercado','Artículos de oficina','Insumos tecnológicos'] },
  { g:'Movilización y operación',subs:['Transporte / Uber','Tarjeta BIP','Estacionamiento','Varios'] },
  { g:'Desarrollo de negocio',   subs:['Membresías','Regalos','Comidas y eventos','Almuerzos con clientes'] },
  { g:'Seguros y contingencias', subs:['RC profesional','Seguro oficina','Provisión incobrables'] },
]

export const CATS_OFICINA_NUEVAS = CATS_OFICINA_CAT.map(c=>c.g)

// Mapeo de las categorías VIEJAS a las 9 nuevas (para no perder los gastos ya clasificados). Las no listadas quedan igual.
export const CAT_OFICINA_ALIAS = {
  'Sueldos':'Remuneraciones','Bono':'Remuneraciones','Retiros':'Remuneraciones','Contadora':'Remuneraciones',
  'Arriendo':'Arriendo y espacio','Gastos comunes':'Arriendo y espacio',
  'Servicios':'Servicios y tecnología','Software':'Servicios y tecnología',
  'Compras':'Insumos de oficina',
}

export const catOficinaNueva = c => CAT_OFICINA_ALIAS[String(c||'').trim()] || c

// Calce caja chica ↔ transferencia del banco. FUENTE ÚNICA: panel "Revisión de caja chica", registro del miembro (enlace al instante)
// y, en espejo, el edge caja-chica-sweep. Regla del usuario (2026-10-09): MISMO MONTO y transferencia el MISMO DÍA de la caja o el
// ANTERIOR = la misma caja → se enlaza sola (si hay varias iguales se aparean en orden: son equivalentes). Excepción de seguridad:
// si el monto coincide con un sueldo/bono ya conciliado a esa persona, se confirma (no se enlaza solo). Todo lo demás se PROPONE:
// monto exacto a ±3 días · monto distinto (la caja debe ser lo transferido) · dos cajas = una transferencia · una caja = dos transferencias.
// movs: cargos de cartola_movimientos. conciliados: Set de movimiento_id con fila en `conciliacion`. sueldos: {persona:Set(montos)}.
export const _ccDia = d => String(d||'').slice(0,10)

// Glosa BICE de una transferencia: "...a cuenta 94087392 B.Santande, Nombre, Rut X, el 22-09-2026 a las 13:21:33". Trae la fecha/hora REAL
// de la transferencia (el movimiento puede contabilizarse al día hábil siguiente) y la cuenta de destino. Si no viene, null.
export function _glosaTransf(desc){ const t=String(desc||''); const f=t.match(/\bel (\d{2})-(\d{2})-(\d{4})/); const h=t.match(/a las (\d{1,2}:\d{2})/); const c=t.match(/a cuenta (\d{3,})/)
  return { fecha:f?`${f[3]}-${f[2]}-${f[1]}`:null, hora:h?h[1]:null, cuenta:c?c[1].slice(-4):null } }

export const _ccFechas = m => { const g=_glosaTransf(m?.descripcion).fecha; return [...new Set([_ccDia(m?.fecha),g].filter(Boolean))] }   // fecha contable + fecha real de la glosa

export const _ccDias = (a,b) => Math.round((new Date(_ccDia(a)+'T00:00')-new Date(_ccDia(b)+'T00:00'))/86400000)   // a − b, en días

// Caja chica marcada "[ajuste]" en la nota: movimiento contable de la caja (p.ej. un reembolso pagado dos veces) que NO tiene transferencia;
// no se cruza con el banco ni aparece como "sin transferencia". Cuenta igual en el saldo.
export const _ccEsAjuste = p => /\[ajuste\]/i.test(String(p?.notes||''))

export function calceCajaChica(petty, movs, {equipo, conciliados=new Set(), sueldos={}, hoy}={}){
  const porRut={}; (equipo||EQUIPO_CFG||[]).forEach(s=>{ const k=_rutK(s.rut); if(k) porRut[k]=s.nombre })
  const nombres=new Set(Object.values(porRut).map(_norm))
  const quien = m => porRut[_rutK(m.rut_contraparte)]
  const monto = x => Math.round(Math.abs(Number(x?.amount??x?.monto)||0))
  const ligados=new Set((petty||[]).map(p=>p.movimiento_id).filter(Boolean).map(String))
  const cajas=(petty||[]).filter(p=>!p.movimiento_id&&monto(p)>0&&p.delivered_at&&nombres.has(_norm(p.user_name))&&!String(p.notes||'').includes('mov:')&&!_ccEsAjuste(p))
    .sort((a,b)=>_ccDia(a.delivered_at).localeCompare(_ccDia(b.delivered_at)))
  const cargos=(movs||[]).filter(m=>m.tipo==='cargo'&&!m.es_interno&&quien(m)&&!ligados.has(String(m.id))&&!conciliados.has(String(m.id))&&!['conciliado','parcial','interno'].includes(String(m.estado||'')))
    .sort((a,b)=>_ccDia(a.fecha).localeCompare(_ccDia(b.fecha)))
  const usadosM=new Set(), usadosP=new Set(), auto=[], sugeridos=[]
  const esSueldo = (persona,mt) => !!sueldos[_norm(persona)]?.has(mt)
  const dist = (m,p) => Math.min(..._ccFechas(m).map(f=>Math.abs(_ccDias(f,p.delivered_at))))
  const libres = (p,dMax=3) => cargos.filter(m=>!usadosM.has(m.id)&&_norm(quien(m))===_norm(p.user_name)&&dist(m,p)<=dMax)
  // 1) Automático: mismo monto, transferencia el mismo día o el anterior.
  cajas.forEach(p=>{ const c=libres(p,1).find(m=>monto(m)===monto(p)&&_ccFechas(m).some(f=>[0,-1].includes(_ccDias(f,p.delivered_at)))); if(!c) return
    usadosM.add(c.id); usadosP.add(p.id)
    if(esSueldo(p.user_name,monto(c))) sugeridos.push({tipo:'exacto',cajas:[p],cargos:[c],motivo:'mismo monto que su sueldo · confirma'})
    else auto.push({petty:p,cargo:c}) })
  // 2) Monto exacto a ±3 días.
  cajas.filter(p=>!usadosP.has(p.id)).forEach(p=>{ const c=libres(p).find(m=>monto(m)===monto(p)); if(!c) return
    usadosM.add(c.id); usadosP.add(p.id); const d=_ccDias(_glosaTransf(c.descripcion).fecha||c.fecha,p.delivered_at)
    sugeridos.push({tipo:'exacto',cajas:[p],cargos:[c],motivo:`transferencia ${Math.abs(d)} día${Math.abs(d)===1?'':'s'} ${d<0?'antes':'después'}`}) })
  // 3) Dos cajas = una transferencia (±3 días, suma exacta).
  cajas.filter(p=>!usadosP.has(p.id)).forEach((p,i,arr)=>{ if(usadosP.has(p.id)) return
    for(const q of arr.slice(i+1)){ if(usadosP.has(q.id)||_norm(q.user_name)!==_norm(p.user_name)||Math.abs(_ccDias(q.delivered_at,p.delivered_at))>3) continue
      const c=libres(p).find(m=>monto(m)===monto(p)+monto(q)); if(!c) continue
      usadosM.add(c.id); usadosP.add(p.id); usadosP.add(q.id); sugeridos.push({tipo:'fusionar',cajas:[p,q],cargos:[c],motivo:'dos cajas suman esta transferencia'}); return } })
  // 4) Una caja = dos transferencias (±3 días, suma exacta).
  cajas.filter(p=>!usadosP.has(p.id)).forEach(p=>{ const ls=libres(p)
    for(let i=0;i<ls.length;i++) for(let j=i+1;j<ls.length;j++) if(monto(ls[i])+monto(ls[j])===monto(p)&&!usadosP.has(p.id)){
      usadosM.add(ls[i].id); usadosM.add(ls[j].id); usadosP.add(p.id); sugeridos.push({tipo:'dividir',cajas:[p],cargos:[ls[i],ls[j]],motivo:'la caja llegó en dos transferencias'}) } })
  // 5) Monto distinto (±30%, ±3 días): la caja se ajusta a lo transferido (la diferencia suele ser lo que el miembro cubrió de su bolsillo).
  cajas.filter(p=>!usadosP.has(p.id)).forEach(p=>{ const c=libres(p).filter(m=>Math.abs(monto(m)-monto(p))<=0.3*Math.max(monto(m),monto(p))).sort((a,b)=>Math.abs(monto(a)-monto(p))-Math.abs(monto(b)-monto(p)))[0]; if(!c) return
    usadosM.add(c.id); usadosP.add(p.id); const dif=monto(c)-monto(p)
    sugeridos.push({tipo:'ajustar',cajas:[p],cargos:[c],motivo:`se transfirió ${dif>0?'más':'menos'} (${dif>0?'+':'−'}${fmtN(Math.abs(dif))}) · la caja queda en lo transferido`}) })
  const h=hoy||new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})
  const cajasSinTransf=cajas.filter(p=>!usadosP.has(p.id)).map(p=>({petty:p,dias:_ccDias(h,p.delivered_at)}))
  // Transferencias sin caja: solo las de los últimos 60 días (lo antiguo sin conciliar es historia, no un pendiente del miembro).
  const transfSinCaja=cargos.filter(m=>!usadosM.has(m.id)&&_ccDias(h,m.fecha)<=60).map(m=>({cargo:m,persona:quien(m),dias:_ccDias(h,m.fecha),esCaja:m.categoria==='Caja chica',posibleSueldo:esSueldo(quien(m),monto(m))}))
  return { auto, sugeridos, cajasSinTransf, transfSinCaja }
}

export const MESES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export const _rutK = s => String(s||'').replace(/[^0-9kK]/g,'').toLowerCase()

// Proyecto que hereda un fondo/gasto creado por la app (conciliación, carga masiva) SOLO si no hay duda: el de la factura,
// el que viene escrito y calza con una venta, o la única venta / única activa del cliente. Con duda queda sin proyecto y se asigna en la ficha.
export function proyectoSeguro(clientId, sales, {saleId=null, titulo=null}={}){
  if(!clientId) return {}
  const vs=(sales||[]).filter(s=>String(s.client_id)===String(clientId)&&VENTA_REAL(s))
  let v = saleId ? vs.find(s=>String(s.id)===String(saleId)) : null
  if(!v && titulo){ const t=String(titulo).trim().toLowerCase(); v=vs.find(s=>(s.title||'').trim().toLowerCase()===t) || null; if(!v) return {} }   // proyecto escrito que no es una venta: se respeta tal cual
  if(!v){ const act=vs.filter(s=>s.status==='Activo'); v = vs.length===1 ? vs[0] : (act.length===1 ? act[0] : null) }
  return v ? {sale_id:v.id, project:v.title} : {}
}

export const CATS_LEGALES = ['notaria','cbr','diario oficial','registro civil','fondo','otro']

// Acuse de pago: confirma al cliente que recibimos el pago de una factura (al conciliar el abono). Formato oficina, vía la cuenta del estudio.
export async function acusePagoEmail(to, {folio, monto, fecha}){
  const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const texto=`Estimados,\n\nEspero que estén muy bien. Confirmamos la recepción del pago de ${folio} por ${monto}${fecha?`, con fecha ${fecha}`:''}. Agradecemos su pago.\n\nSaludos cordiales,\n${BRAND.nombre}`
  const html=`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e4e8eb;border-radius:12px;overflow:hidden"><div style="background:#003C50;padding:18px;text-align:center"><img src="${BRAND.logoUrl}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="26" style="height:26px"/></div><div style="padding:22px;color:#1a1a1a;font-size:14px;line-height:1.6">Estimados,<br><br>Espero que estén muy bien. Confirmamos la recepción del pago de <b>${esc(folio)}</b> por <b>${esc(monto)}</b>${fecha?`, con fecha <b>${esc(fecha)}</b>`:''}. Agradecemos su pago.<br><br>Saludos cordiales,<br><b>${BRAND.nombre}</b></div><div style="padding:14px 22px;border-top:1px solid #eee;font-size:11px;color:#999">${BRAND.dominio}</div></div>`
  return enviarComoUsuario({to, subject:`Confirmación de pago — ${folio}`, html, text:texto})
}

// dteMontoTotal / montoFactura (monto REAL = MntTotal del DTE; sin XML, el programado) viven en _shared/saludDatos.js.
// Glosa legible de una factura: los ítems de su DTE (lo que vio el cliente); sin XML, el concepto.
export function glosaFactura(b){ const p=b?.dte_xml?parseDteFactura(b.dte_xml):null; const it=(p?.items||[]).map(i=>[i.nmb,i.dsc].filter(Boolean).join(' · ')).filter(Boolean); return it.length?it.join(' + '):(b?.concept||'') }

// Parser LIVIANO del DTE (sin jsPDF/timbre): datos para la ficha inline de previsualización. Devuelve null si no hay DTE.
export function parseDteFactura(dteXml){
  const doc = splitSetDTE(dteXml||'')[0] || dteXml || ''
  if(!doc) return null
  const g=(t,s=doc)=>{ const m=s.match(new RegExp('<'+t+'>([\\s\\S]*?)</'+t+'>')); return m?m[1].trim():'' }
  const idDoc=(doc.match(/<IdDoc>[\s\S]*?<\/IdDoc>/)||[''])[0], emi=(doc.match(/<Emisor>[\s\S]*?<\/Emisor>/)||[''])[0], rec=(doc.match(/<Receptor>[\s\S]*?<\/Receptor>/)||[''])[0], tot=(doc.match(/<Totales>[\s\S]*?<\/Totales>/)||[''])[0]
  const detalles=[...doc.matchAll(/<Detalle>[\s\S]*?<\/Detalle>/g)].map(m=>m[0])
  return {
    folio:g('Folio',idDoc), fch:g('FchEmis',idDoc),
    rutE:g('RUTEmisor',emi), rznE:g('RznSoc',emi),
    rutR:g('RUTRecep',rec), rznR:g('RznSocRecep',rec),
    exe:+g('MntExe',tot)||0, total:+g('MntTotal',tot)||0,
    items:detalles.map(d=>({ nmb:g('NmbItem',d), dsc:g('DscItem',d), mnt:+g('MontoItem',d)||0 }))
  }
}

// Extrae el texto plano de un mensaje de Gmail (formato full). Prioriza text/plain; si no, quita el HTML.
export function extraerTextoGmail(msg){
  const dec = s => { try{ return decodeURIComponent(escape(atob(String(s||'').replace(/-/g,'+').replace(/_/g,'/')))) }catch(_){ try{ return atob(String(s||'').replace(/-/g,'+').replace(/_/g,'/')) }catch(e){ return '' } } }
  const walk = (p,mime) => { if(!p) return ''; if(p.mimeType===mime && p.body?.data) return dec(p.body.data); if(p.parts) return p.parts.map(x=>walk(x,mime)).join(' '); return '' }
  let t = walk(msg?.payload,'text/plain')
  if(!t.trim()){ t = walk(msg?.payload,'text/html').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ') }
  return t.replace(/\r?\n/g,' ').replace(/&nbsp;/g,' ').trim()
}

export const logoColor = "data:image/png;base64,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"

// Correo del propio equipo (dominio de la oficina): nunca se aprende como contacto de un cliente.
export const esCorreoOficina = e => String(e||'').trim().toLowerCase().endsWith('@'+String(BRAND.emailDominio||'').toLowerCase())

// Datos de la cuenta en el correo: el titular va DENTRO del recuadro (primera línea), nunca en la frase. Si el texto (redactado
// por la IA, editado o reutilizado de un correo anterior) dice «…a la cuenta de <titular>:», el titular pasa al recuadro.
export const cuentaEnRecuadro = txt => { const n=String(BRAND.nombreLegal||''); if(!n) return String(txt||'')
  const esc=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return String(txt||'').replace(new RegExp(`(cuenta|account)( de| of)? ${esc}:[ \\t]*\\n([ \\t]{2,})`,'gi'), (m,a,b,ind)=>`${a}${b||''}:\n${ind}${n}\n${ind}`) }
BRAND.logoUrl = 'https://' + BRAND.dominio         // base ABSOLUTA para logos en correos (deriva del dominio, no se cablea)

// Glosa que ve el cliente (rendición, correo, PDF): el nombre de la app de transporte se lee como "Movilización" (más sobrio).
export const glosaCliente = t => String(t||'').replace(/\b(uber|cabify|didi)\b/gi,'Movilización')

export const mesCorto = d => { const x=d instanceof Date?d:new Date(d); return isNaN(x)?'':MES_C[x.getMonth()] }

// Posibles duplicados de gastos — REGLA ÚNICA (caja chica y rendición a cliente): mismo monto y misma fecha con glosa
// parecida (o igual), o la misma OT de notaría. Devuelve Map id → gasto con que se repite (el más antiguo del grupo no se marca).
export function posiblesDuplicadosGastos(gastos){
  const out=new Map(), grupos={}
  ;(gastos||[]).forEach(e=>{ if(!e||e.deleted_at||!Number(e.amount)) return; const k=`${Math.round(Number(e.amount))}|${e.date||''}`; (grupos[k]||(grupos[k]=[])).push(e) })
  Object.values(grupos).forEach(g=>{ if(g.length<2) return; const ord=[...g].sort((a,b)=>String(a.created_at||a.id).localeCompare(String(b.created_at||b.id)))
    for(let i=1;i<ord.length;i++){ const b=ord[i]; const a=ord.slice(0,i).find(x=>gastosParecidos(x,b)); if(a) out.set(b.id,a) } })
  return out
}

// Dos gastos del mismo monto y día son el MISMO solo si nada los distingue: OT distintas o números de registro/operación
// distintos en la glosa (p. ej. tasas INAPI por marcas diferentes) = gastos distintos, aunque el texto sea casi igual.
export const _numsGlosa = t => new Set((String(t||'').match(/\d[\d.\-]{2,}\d/g)||[]).map(x=>x.replace(/\D/g,'')).filter(x=>x.length>=4))

export function gastosParecidos(x,b){
  if(x.ot_number&&b.ot_number) return String(x.ot_number).replace(/\D/g,'')===String(b.ot_number).replace(/\D/g,'')
  const ca=x.concept||'', cb=b.concept||''; if(!ca||!cb) return false
  const na=_numsGlosa(ca), nb=_numsGlosa(cb); if(na.size&&nb.size&&![...na].some(n=>nb.has(n))) return false
  if(_normTxt(ca)===_normTxt(cb)||simTexto(ca,cb)>=0.55) return true
  const wa=_normTxt(ca).split(' ').filter(w=>w.length>2), wb=new Set(_normTxt(cb).split(' ').filter(w=>w.length>2)), wa2=new Set(wa)
  const [corto,largo]=wa2.size<=wb.size?[wa2,wb]:[wb,wa2]; return corto.size>=3&&[...corto].every(w=>largo.has(w))
}

export const simTexto = (a,b) => { const A=new Set(_normTxt(a).split(' ').filter(w=>w.length>2)), B=new Set(_normTxt(b).split(' ').filter(w=>w.length>2)); if(!A.size||!B.size) return 0; let i=0; A.forEach(w=>{ if(B.has(w)) i++ }); return i/(A.size+B.size-i) }

export const NOTA_DIRIGIDO='Silvana y Mildred'   // contactos en la notaría (saludo de las consultas por OT no reconocidas)

// Razón social del SII (suele venir en MAYÚSCULAS) → Title Case para mostrar, sin tocar el dato (canon nombres).
export const titleCase = s => { if(!s) return s; return String(s).trim().toLowerCase().replace(/(^|[\s.\-'/(])([a-záéíóúñü])/g, (_,p,c)=>p+c.toUpperCase()).replace(/\b(Y|De|Del|La|Las|Los|E|En)\b/g, m=>m.toLowerCase()) }

// Trato al cliente: a personas se les dice "Estimado [nombre de pila]" (sin señor/señora ni apellido); a empresas "Estimados".
export const _ES_EMPRESA = /\b(spa|s\.?p\.?a|ltda|limitada|s\.?a\.?|eirl|e\.?i\.?r\.?l|inversiones|comercial|constructora|sociedad|holding|inmobiliaria|servicios|grupo|asociados|abogados|consultores|ingenier|transportes|agricola|agrícola|clinica|clínica|tech|spa\.|cia)\b/i

export const esPersona = name => { const n=(name||'').trim(); if(!n) return false; if(_ES_EMPRESA.test(n)) return false; const w=n.split(/\s+/); return w.length>=2 && w.length<=4 && !/\d/.test(n) }

// Género por el nombre de pila para "Estimado"/"Estimada" (heurística: termina en 'a' = mujer, salvo excepciones).
export const _NOMBRES_F = new Set(['carmen','isabel','beatriz','raquel','mercedes','soledad','pilar','ines','belen','estrella','flor','luz','paz','rocio','dolores','consuelo','montserrat','maribel','noelia','ester','esther','ruth','judith','sol','nieves'])

export const _NOMBRES_M = new Set(['elias','tobias','jeremias','nicolas','tomas','matias','lucas','jonas','bautista','cosme','josemaria','agustin'])

export const generoF = name => { const n=_normTxt((name||'').trim().split(/\s+/)[0]); if(!n) return false; if(_NOMBRES_F.has(n)) return true; if(_NOMBRES_M.has(n)) return false; return n.endsWith('a') }

export const saludoCli = name => esPersona(name) ? `${generoF(name)?'Estimada':'Estimado'} ${(name||'').trim().split(/\s+/)[0]}` : 'Estimados'

// Buscador de cabecera con lupa (píldora tintada)
export function ChipSearch({value,onChange,placeholder='Buscar...',autoFocus,style}){
  return (
    <div style={{display:'flex',alignItems:'center',gap:8,height:32,background:C.bgSoft,borderRadius:20,padding:'0 14px',boxSizing:'border-box',...style}}>
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>
      <input value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus} style={{flex:1,minWidth:0,border:'none',background:'transparent',outline:'none',fontSize:13,color:C.text}}/>
    </div>
  )
}

// Píldora de persona para filtrar por abogado (Banco «Abogados», Cobranza): tinte de su color; seleccionada = borde de su color.
export const pillPersonaSty = (pc,on) => ({fontSize:11,borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:'pointer',border:`1px solid ${on?pc.color:'transparent'}`,background:pc.bg,color:pc.color,whiteSpace:'nowrap'})

// Colores de categoría de gasto — FUENTE ÚNICA (antes duplicado 5× inline). CBR beige es el único fuera de token de C.
export const CAT_COLORS = {'Notaria':C.azulBg,'CBR':'#F2E9DE','Diario Oficial':C.bgWarm,'Registro Civil':C.ambarBg,'Movilización':C.tealBg,'Archivo Judicial':C.bgPanel,'Fondo':C.greenBg,'Otro':C.bgSoft}

// Costos ESTRUCTURALES de la oficina (fijos: sueldos/arriendo/servicios/compras — normalmente vienen de la conciliación bancaria). El resto de categorías = GESTIÓN (operativo: notaría/CBR/movilización/archivo judicial/otros, gralmente de clientes; movilización siempre nuestra).
export const CATS_OFICINA_ESTRUCTURAL = ['Sueldos','Bono','Retiros','Arriendo','Gastos comunes','Contadora','Tarjeta de crédito','Servicios','Software','Proveedores','Comisiones','Compras']

// Un gasto de oficina es de GESTIÓN si su categoría NO es estructural (criterio por CATEGORÍA, determinista — no por quién lo cargó).
export const esGestionGasto = g => !CATS_OFICINA_ESTRUCTURAL.includes(String(g?.category||'').trim())

export const SUBCATS_OFICINA = Object.fromEntries(CATS_OFICINA_CAT.map(c=>[c.g,c.subs]))

// Saldo disponible de caja chica del usuario = fondos entregados − TODOS sus gastos (liquidados o no).
// Liquidar es neutro para el saldo: el gasto ya descontó la plata; solo un fondo nuevo lo sube.
// Queda en $0 si fondos=gastos, o en el remanente si hubo diferencia. NO excluir los liquidados:
// si se excluyen, el saldo sube artificialmente al liquidar (los fondos seguirían sumando completos).
// Fuente única: la usan CajaChicaView ("Mi caja"), el panel Gestión del Dashboard y el KPI de Tareas.
// Excluye los gastos con paid_by_client=true (los pagó el cliente directo: se rinden pero no salen de la caja chica del usuario).
export const saldoCajaChica = (pettyCash, expenses, userName) => {
  if(!userName) return 0
  const entregado = (pettyCash||[]).filter(p=>p.user_name===userName).reduce((a,p)=>a+(p.amount||0),0)
  const gastado = (expenses||[]).filter(e=>e.type==='gasto'&&e.created_by===userName&&!e.paid_by_client).reduce((a,e)=>a+(e.amount||0),0)
  return entregado - gastado
}

// Avisos de caja chica por persona (FUENTE ÚNICA: la misma fórmula de saldoCajaChica que ve el miembro y que usa el correo diario).
// 'negativo' = puso plata de su bolsillo (la oficina le debe); 'baja' = saldo en o bajo el umbral del estudio. Personas = quienes han recibido alguna caja.
export const alertasCajaChica = (pettyCash, expenses, umbral=BRAND.cajaChicaUmbral) => {
  const personas=[...new Set((pettyCash||[]).map(p=>p.user_name).filter(Boolean))]
  return personas.map(persona=>{ const saldo=saldoCajaChica(pettyCash,expenses,persona); return {persona, saldo, tipo: saldo<0?'negativo':(saldo<=(umbral||0)?'baja':null)} })
    .filter(a=>a.tipo).sort((a,b)=>a.saldo-b.saldo)
}

// Solicitud de fondos ↔ depósito (FUENTE ÚNICA: Solicitar fondos y Rendir a cliente). Depósito = fondo del cliente con fecha ≥ la
// solicitud (si la solicitud trae monto, el más parecido ±2%). Una solicitud ya cerrada (recibido_at) no se vuelve a evaluar.
// Correlativo de rendición a cliente (FUENTE ÚNICA): solo cuentan las que ya tienen número (enviadas o rendidas por fuera, no anuladas).
// Un borrador no tiene número: se lo da el envío. Tentativo = máximo + 1.
export function corrSiguiente(rendiciones, clientId){ return Math.max(0, ...(rendiciones||[]).filter(r=>String(r.client_id)===String(clientId)&&r.correlativo&&!r.anulada_at).map(r=>r.correlativo||0)) + 1 }

export function depositoDeSolicitud(r, expenses){
  const desde=String(r?.enviada_at||'').slice(0,10)
  // Solo depósitos reales (monto > 0; una devolución es un fondo negativo) y, si la solicitud es de un trabajo, del mismo trabajo o sin trabajo.
  const fs=(expenses||[]).filter(e=>e.type==='fondo'&&!e.deleted_at&&(Number(e.amount)||0)>0&&String(e.client_id)===String(r?.client_id)&&String(e.date||e.created_at||'').slice(0,10)>=desde&&(!r?.sale_id||!e.sale_id||String(e.sale_id)===String(r.sale_id)))
    .sort((a,b)=>String(a.date||a.created_at).localeCompare(String(b.date||b.created_at)))
  if(!fs.length) return null
  if(!(r.monto>0)) return fs[0]
  const m=fs.find(e=>Math.abs((e.amount||0)-r.monto)<=Math.max(1000,r.monto*0.02)); if(m) return m
  // Pagado en partes (límite diario de transferencia): se cierra cuando lo depositado desde la solicitud cubre lo pedido. Un abono menor NO la cierra.
  let acum=0; for(const e of fs){ acum+=Number(e.amount)||0; if(acum>=r.monto-Math.max(1000,r.monto*0.02)) return e }
  return null
}

export function estadoSolicitud(r, expenses){
  if(r?.recibido_at) return {k:'rec',dep:null,dias:0}
  const dep=depositoDeSolicitud(r,expenses); if(dep) return {k:'rec',dep,dias:0}
  const dias=Math.max(0,Math.floor((Date.now()-new Date(r?.enviada_at||Date.now()).getTime())/86400000))
  return {k:dias>=7?'sin':'env',dias}
}

// Check mínimo en SVG (marcas sutiles: sello de OT pagada, rendido). Nunca el carácter ✓.
export const CheckMini = ({s=9,c}) => <svg width={s} height={s} viewBox='0 0 24 24' fill='none' stroke={c||'currentColor'} strokeWidth='3.2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}} aria-hidden='true'><polyline points='20 6 9 17 4 12'/></svg>

// OT de notaría con su sello (sutil): check verde chico si ya se le pagó a la notaría; sin sello = por pagar. Una sola marca para la ficha de Gastos y la de Clientes.
export const otConSello = (e, onClick) => { if(!e?.ot_number) return null; const ot=String(e.ot_number).toUpperCase().startsWith('OT')?String(e.ot_number):`OT ${e.ot_number}`; const pag=!!e.notaria_liquidado_at
  return <span onClick={onClick?(ev=>{ev.stopPropagation();onClick(e)}):undefined} title={pag?`Pagada a la notaría el ${fmtFechaDMY(e.notaria_liquidado_at)}`:'Aún no pagada a la notaría'} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,color:C.muted,cursor:onClick?'pointer':'default',whiteSpace:'nowrap'}}>{pag&&<span style={{width:13,height:13,borderRadius:'50%',border:`1.3px solid ${C.greenText}`,display:'inline-flex',alignItems:'center',justifyContent:'center',boxSizing:'border-box'}}><CheckMini s={8} c={C.greenText}/></span>}{ot}</span> }

// FUENTE ÚNICA del fondo de un cliente para RENDICIONES (armar tanda, correo, Ver PDF y PDF adjunto usan ESTA).
// saldo = fondos recibidos − gastos YA RENDIDOS. Los no rendidos aún no descuentan. Mismas reglas que fgCliente:
// fuera lo resumido en una apertura y los gastos históricos (no_descuenta_saldo) no descuentan.
// Alcance: scopeEntId null = todo el cliente; con RS = esa RS + los movimientos sin RS (notaría sin RS no queda fuera).
// excludeRenderId deja fuera de "rendiciones previas" la rendición que se está mostrando.
// Rendición con 2+ proyectos (FUENTE ÚNICA de su desglose): un bloque por proyecto con sus fondos, lo rendido antes y los gastos
// de esta rendición. Mismo universo y reglas que rendicionFondo → Σ saldos de los bloques + «otros» = saldo de la rendición.
// «otros» = proyectos sin gastos en esta rendición (fondos o rendiciones previas de otros trabajos). null si hay 0-1 proyecto.
export function rendGruposProyecto({expenses, clientId, scopeEntId=null, gastos=[], excludeRenderId=null, sales=[], clientEntities=[]}){
  const tit=id=>(sales||[]).find(s=>String(s.id)===String(id))?.title
  const key=e=>e.project||tit(e.sale_id)||''
  if(new Set(gastos.map(key).filter(Boolean)).size<2) return null
  const propios=new Set(gastos.map(e=>String(e.id)))
  const g={}; const G=k=>g[k]||(g[k]={proyecto:k,gastos:[],fondos:[],previo:0})
  gastos.forEach(e=>G(key(e)).gastos.push(e))
  ;(expenses||[]).filter(e=>e.client_id===clientId && cuentaEnSaldo(e) && (!scopeEntId || e.entity_id===scopeEntId || !e.entity_id)).forEach(e=>{
    if(propios.has(String(e.id))) return
    if(e.type==='fondo') G(key(e)).fondos.push(e)
    else if(!e.no_descuenta_saldo && e.client_rendered_at && e.client_render_id && e.client_render_id!==excludeRenderId) G(key(e)).previo+=(e.amount||0)
  })
  const entDe=x=>{ const v=(sales||[]).find(s=>String(s.client_id)===String(clientId)&&s.title===x.proyecto); const id=v?.entity_id||(x.gastos.find(e=>e.entity_id)||{}).entity_id; return id?((clientEntities||[]).find(c=>c.id===id)||null):null }
  const todos=Object.values(g).map(x=>{ const totFondos=x.fondos.reduce((a,e)=>a+(e.amount||0),0), totGastos=x.gastos.reduce((a,e)=>a+(e.amount||0),0)
    return {...x, fondos:x.fondos.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))), totFondos, totGastos, saldo:totFondos-x.previo-totGastos, ent:entDe(x)} })
  return {grupos:todos.filter(x=>x.gastos.length), otros:todos.filter(x=>!x.gastos.length).reduce((a,x)=>a+x.saldo,0)}
}

// Reparto de los gastos de un cliente entre sus fondos (FUENTE ÚNICA: Rendir un fondo, mover gastos de fondo, Salud de datos).
// Cada gasto queda en UN lugar: el fondo asignado a mano (reembolso_fondo_id) o, si no, el fondo de su mismo proyecto, el de su misma
// razón social o el más antiguo con saldo; sin saldo en ningún fondo → «Sin fondo» (lo que falta pedir). Una devolución (fondo negativo)
// consume como un gasto. Mismas reglas que fgCliente, así que Σ(fondo − sus gastos) − sin fondo = saldo del cliente, siempre.
export function repartoFondos(expenses, clientId){
  const movs=(expenses||[]).filter(e=>e.client_id===clientId && cuentaEnSaldo(e))
  const ord=(a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.created_at||'').localeCompare(String(b.created_at||''))
  const fondos=movs.filter(e=>e.type==='fondo'&&(Number(e.amount)||0)>0).sort(ord).map(f=>({f, quedan:Number(f.amount)||0, gastos:[]}))
  const consumos=movs.filter(e=>(e.type!=='fondo'&&!e.no_descuenta_saldo)||(e.type==='fondo'&&(Number(e.amount)||0)<0)).sort(ord)
  const sinFondo=[], deGasto={}
  consumos.forEach(g=>{ const m=Math.abs(Number(g.amount)||0)
    let b=g.reembolso_fondo_id?fondos.find(x=>String(x.f.id)===String(g.reembolso_fondo_id)):null
    if(!b){ const vivos=fondos.filter(x=>x.quedan>0), rsOk=x=>!x.f.entity_id||!g.entity_id||x.f.entity_id===g.entity_id
      b=(g.project&&vivos.find(x=>x.f.project===g.project&&rsOk(x)))||(g.entity_id&&vivos.find(x=>x.f.entity_id===g.entity_id))||vivos.find(rsOk)||null }
    if(b){ b.gastos.push(g); b.quedan-=m; deGasto[g.id]=b.f.id } else { sinFondo.push(g); deGasto[g.id]=null } })
  const totSin=sinFondo.reduce((a,g)=>a+Math.abs(Number(g.amount)||0),0)
  return {fondos, sinFondo, totSin, deGasto, saldo:fondos.reduce((a,x)=>a+x.quedan,0)-totSin}
}

// trabajo (= proyecto): si viene, fondos, gastos y rendiciones previas se acotan a ese proyecto (rendición por trabajo).
// fondoId: rendición de UN fondo → el fondo y los gastos que le tocan en el reparto (repartoFondos).
export function rendicionFondo(expenses, clientId, scopeEntId=null, excludeRenderId=null, trabajo=null, fondoId=null){
  const _b=fondoId?repartoFondos(expenses, clientId).fondos.find(x=>String(x.f.id)===String(fondoId)):null
  const movs=fondoId ? (_b?[_b.f,..._b.gastos]:[]) : (expenses||[]).filter(e=>e.client_id===clientId && cuentaEnSaldo(e) && (!scopeEntId || e.entity_id===scopeEntId || !e.entity_id) && (trabajo==null || (e.project||'')===trabajo))
  const fondos=movs.filter(e=>e.type==='fondo').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
  const totFondos=fondos.reduce((a,e)=>a+(e.amount||0),0)
  const descuentan=movs.filter(e=>!(e.type==='gasto'&&e.no_descuenta_saldo))
  // excludeRenderId: la rendición que se está editando no cuenta como «ya rendido» (si no, sus gastos se restarían dos veces).
  const rendido=descuentan.filter(e=>e.type==='gasto'&&e.client_rendered_at&&!(excludeRenderId&&String(e.client_render_id)===String(excludeRenderId))).reduce((a,e)=>a+(e.amount||0),0)
  const {previas, rendidoAntes}=rendicionesPreviasDe(descuentan, excludeRenderId)
  return {fondos, totFondos, rendido, saldo:totFondos-rendido, previas, rendidoAntes}
}

// Fondos del cliente sin trabajo asignado: si hay, no se puede separar la rendición por trabajo sin inventar a cuál van.
export function fondosSinTrabajo(expenses, clientId, scopeEntId=null){
  return (expenses||[]).filter(e=>e.client_id===clientId && e.type==='fondo' && cuentaEnSaldo(e) && (Number(e.amount)||0)>0 && (!scopeEntId || e.entity_id===scopeEntId || !e.entity_id) && !(e.project||'').trim()).reduce((a,e)=>a+(e.amount||0),0)
}

// Imputación entre trabajos (rendición separada que pide el NETO): el saldo a favor de un trabajo abona al trabajo que debe.
// Se registra moviendo esa parte del fondo del trabajo a favor al trabajo deudor (mismo mecanismo que «Repartir entre proyectos»:
// la parte nueva lleva fondo_origen_id y su parte de la conciliación), así el saldo del cliente no cambia y cada trabajo parte bien
// en su próxima rendición. Fondos conciliados en partes con el banco no se tocan (quedan en «faltan»). Devuelve cambios para el estado.
export async function imputarSaldosTrabajos({expenses, clientId, saldos, sales=[], user, ref, cliente}){
  const norm=x=>String(x||'').trim().toLowerCase()
  const sid=pr=>(sales||[]).find(sv=>String(sv.client_id)===String(clientId)&&norm(sv.title)===norm(pr))?.id||null
  const debe=saldos.filter(o=>o.saldo<=-1&&o.trabajo).map(o=>({...o,q:Math.round(-o.saldo)}))
  const fav=saldos.filter(o=>o.saldo>=1&&o.trabajo).map(o=>({...o,q:Math.round(o.saldo)}))
  const pares=[]; for(const f of fav){ for(const d of debe){ const m=Math.min(f.q,d.q); if(m<1) continue; pares.push({desde:f.trabajo,hacia:d.trabajo,monto:m,corrDesde:f.corr,corrHacia:d.corr}); f.q-=m; d.q-=m } }
  const cambios=[], nuevos=[], hechos=[]; let faltan=0, motivo=''
  const usados={}
  for(const pa of pares){
    let resta=pa.monto
    const fondos=(expenses||[]).filter(e=>String(e.client_id)===String(clientId)&&e.type==='fondo'&&!e.deleted_at&&cuentaEnSaldo(e)&&(Number(e.amount)||0)>0&&(e.project||'')===pa.desde)
      .map(e=>({...e,amount:(Number(e.amount)||0)-(usados[e.id]||0)})).filter(e=>e.amount>=1)
      .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')))
    for(const f of fondos){ if(resta<1) break
      const toma=Math.min(resta, Math.round(f.amount)), nota=`Imputado desde el trabajo ${pa.desde} · Rendiciones N° ${ref}`
      try{
        const {data:conc,error:ce}=DEMO?{data:[]}:await supabase.from('conciliacion').select('*').eq('gasto_id',f.id); if(ce) throw ce
        if((conc||[]).length>1||((conc||[])[0]&&Math.round(Number(conc[0].monto_aplicado))!==Math.round(Number(f.amount)))){ motivo='un fondo está conciliado en partes con el banco'; continue }
        const notas=[f.notas,nota].filter(Boolean).join(' · ')
        if(toma>=Math.round(f.amount)){
          const patch={project:pa.hacia, sale_id:sid(pa.hacia), notas}
          if(!DEMO){ const {error}=await supabase.from('expenses').update(patch).eq('id',f.id); if(error) throw error }
          cambios.push({id:f.id,patch}); hechos.push({fondo:f.id,monto:toma,antes:{project:f.project||null,sale_id:f.sale_id||null,notas:f.notas||null},entero:true})
        } else {
          const row={client_id:f.client_id, entity_id:f.entity_id||null, type:'fondo', concept:f.concept, category:f.category||'Fondo', date:f.date, created_by:f.created_by||user?.name||null, notas, estudio_id:f.estudio_id||undefined, fondo_origen_id:f.id,
            invoice_id:f.invoice_id||null, no_descuenta_saldo:!!f.no_descuenta_saldo, subproject:null, amount:toma, project:pa.hacia, sale_id:sid(pa.hacia)}
          let nuevo={...row,id:'demo-f-'+Date.now()+nuevos.length,created_at:new Date().toISOString()}, concN=null
          if(!DEMO){
            const {data,error}=await supabase.from('expenses').insert(row).select().single(); if(error) throw error; nuevo=data
            try{
              if(conc&&conc[0]){ const c=conc[0]; const {data:cn,error:e2}=await supabase.from('conciliacion').insert({movimiento_id:c.movimiento_id, tipo_destino:c.tipo_destino, gasto_id:data.id, monto_aplicado:toma, origen:c.origen, created_by:user?.name||null, ...(c.estudio_id?{estudio_id:c.estudio_id}:{})}).select('id').single(); if(e2) throw e2; concN=cn.id
                const {error:e3}=await supabase.from('conciliacion').update({monto_aplicado:Math.round(Number(c.monto_aplicado))-toma}).eq('id',c.id); if(e3) throw e3 }
              const {error:e4}=await supabase.from('expenses').update({amount:Math.round(f.amount)-toma}).eq('id',f.id); if(e4) throw e4
            }catch(e){ if(concN) await supabase.from('conciliacion').delete().eq('id',concN); if(conc&&conc[0]) await supabase.from('conciliacion').update({monto_aplicado:conc[0].monto_aplicado}).eq('id',conc[0].id); await supabase.from('expenses').delete().eq('id',data.id); throw e }
          }
          nuevos.push(nuevo); cambios.push({id:f.id,patch:{amount:Math.round(f.amount)-toma}}); hechos.push({fondo:f.id,nuevo:nuevo.id,monto:toma,entero:false})
        }
        usados[f.id]=(usados[f.id]||0)+toma; resta-=toma
      }catch(e){ motivo=e?.message||String(e); break }
    }
    if(resta>=1) faltan+=resta
  }
  if(hechos.length) logActividad('rendicion.saldo_imputado',{tabla:'clients',id:clientId,detalle:{cliente,title:`Saldo a favor imputado entre trabajos · Rendiciones N° ${ref}`,monto:hechos.reduce((a,h)=>a+h.monto,0),pares,hechos,faltan},completo:true})
  return {cambios, nuevos, faltan, motivo, pares}
}

// Gastos de una rendición: los guardados (client_render_id) o, en la vista previa sin guardar, los que trae la rendición.
export const gastosDeRend = (r, expenses) => (r&&r._gastos) ? r._gastos : (expenses||[]).filter(e=>e.client_render_id===r?.id)

// Fondo de una rendición guardada (misma regla que su correo y su PDF): con 2+ RS se acota a la RS de sus gastos; por trabajo, a su trabajo.
export const fondoDeRend = (r, expenses, clientEntities) => { const det=gastosDeRend(r,expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))); const entId=((clientEntities||[]).filter(e=>e.client_id===r.client_id).length>1)?(det.find(e=>e.entity_id)||{}).entity_id:null; return rendicionFondo(expenses, r.client_id, entId, null, r.por_trabajo?(r.project||''):null, r.fondo_id||null) }

// Rendiciones ANTERIORES (para el desglose "Resumen del fondo"): agrupa gastos ya rendidos por rendición,
// excluyendo la actual. Recibe movimientos ya acotados a la RS. Devuelve [{total,fecha}] y la suma.
export function rendicionesPreviasDe(scopedMovs, excludeRenderId){
  const grupos={}
  ;(scopedMovs||[]).forEach(e=>{ if(e.type==='gasto'&&e.client_rendered_at&&e.client_render_id&&e.client_render_id!==excludeRenderId){ const g=grupos[e.client_render_id]||(grupos[e.client_render_id]={total:0,fecha:e.client_rendered_at}); g.total+=(e.amount||0); if((e.client_rendered_at||'')<(g.fecha||'')) g.fecha=e.client_rendered_at } })
  const previas=Object.values(grupos).sort((a,b)=>(a.fecha||'')>(b.fecha||'')?1:-1)
  return {previas, rendidoAntes:previas.reduce((a,g)=>a+g.total,0)}
}

// Al anular una rendición, su cobro de reembolso queda huérfano (sigue cobrable). Lo anula (reversible, no lo borra).
// Devuelve los reembolsos anulados para refrescar estado local y avisar.
export async function anularReembolsoDeRendicion(r, billing){
  const reembolsos=(billing||[]).filter(b=>b.billing_type==='reembolso'&&b.status!=='Anulada'&&(b.notes||'').includes(`Rendición ID ${r.id}`))
  if(reembolsos.length){ const {error}=await supabase.from('billing').update({status:'Anulada'}).in('id',reembolsos.map(b=>b.id)); if(error) throw error }
  return reembolsos
}

export function rendicionDocHtml({ razon, rut, periodo, fechaEmision, dirigidoA, gastos, fondos, totGastos, totFondos, rendidoAntes=0, rendicionesPrevias=[], correlativo=null, project=null, subproject=null, lang='es', grupos=null }){
  const A='#003C50', GRAY='#E4E8EB', MUTED='#537281', AZUL3='#99ABB4', TXT='#3D3D3D'
  const EN = lang==='en'
  const T = EN ? {title:'Expense Report',outstanding:`Outstanding balance — transfer to ${BRAND.nombre}`,company:'Company',rut:'Tax ID (RUT)',bank:'Bank',account:'Checking account',confEmail:'Confirmation email',fundSummary:'Fund summary',reportPrev:'Report',previous:'previous',fundsReceived:'Funds received',thisReport:'This report',availBalance:'Available balance',expPeriod:'Expenses (period)',balFavor:'Balance in your favor',balPending:'Outstanding balance',project:'Project',reportNo:'Report No.',period:'Period',issued:'Issued',attn:'Attn',date:'Date',concept:'Description',category:'Category',amount:'Amount',totalExp:'Total expenses',noFunds:'No funds recorded',fundsSection:'Funds received',footerDoc:'Expense report',printBtn:'Print / Save PDF',receiptBadge:'✓ receipt',fundDefault:'Funds received',expW:n=>`${n} expense${n!==1?'s':''}`,withReceipt:(a,b)=>`${a} of ${b} with supporting receipts (available upon request).`}
    : {title:'Rendición de gastos',outstanding:`Saldo pendiente — transferir a ${BRAND.nombre}`,company:'Razón social',rut:'RUT',bank:'Banco',account:'N° cuenta corriente',confEmail:'Email confirmación',fundSummary:'Resumen del fondo',reportPrev:'Rendición',previous:'anterior',fundsReceived:'Fondos recibidos',thisReport:'Esta rendición',availBalance:'Saldo disponible',expPeriod:'Gastos del período',balFavor:'Saldo a favor',balPending:'Saldo pendiente',project:'Proyecto',reportNo:'Rendición N°',period:'Período',issued:'Emisión',attn:'Dirigido a',date:'Fecha',concept:'Concepto',category:'Categoría',amount:'Monto',totalExp:'Total gastos',noFunds:'Sin fondos registrados',fundsSection:'Fondos recibidos',footerDoc:'Rendición de gastos',printBtn:'Imprimir / Guardar PDF',receiptBadge:'✓ respaldo',fundDefault:'Fondo recibido',expW:n=>`${n} gasto${n!==1?'s':''}`,withReceipt:(a,b)=>`${a} de ${b} con comprobante de respaldo (disponibles a solicitud).`}
  // Saldo disponible = fondos recibidos − rendido en tandas anteriores − esta rendición.
  const saldo = totFondos - rendidoAntes - totGastos
  const badge = (cat)=>{ const c=(cat||'').toLowerCase(); let bg='#E4E8EB',fg=MUTED; if(c.includes('notar')){bg='#E6F1FB';fg=A} else if(c.includes('transp')){bg='#E1F5EE';fg=C.greenText} return `<span style='display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:600;background:${bg};color:${fg}'>${RENDCAT(cat)}</span>` }
  const filaGasto = e=>`<tr><td style='white-space:nowrap'>${fmtFechaDMY(e.date)}</td><td>${glosaCliente(e.concept)||'—'}${e.ot_number?` <span style='font-size:8px;font-weight:700;color:#185FA5;white-space:nowrap'>${String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number}</span>`:''}${e.respaldo?` <span style='font-size:8px;font-weight:700;color:#0F6E56;background:#E1F5EE;padding:1px 5px;border-radius:4px;white-space:nowrap'>${T.receiptBadge}</span>`:''}</td><td>${badge(e.category)}</td><td style='text-align:right;font-weight:600;white-space:nowrap'>${fmtN(e.amount)}</td></tr>`
  const filasGastos = gastos.map(filaGasto).join('')
  const conRespaldoN = gastos.filter(e=>e.respaldo).length
  const filasFondos = fondos.length ? fondos.map(e=>`<tr><td style='width:90px;white-space:nowrap'>${fmtFechaDMY(e.date)}</td><td>${e.concept||T.fundDefault}</td><td style='text-align:right;font-weight:600;color:#0F6E56'>${fmtN(e.amount)}</td></tr>`).join('') : `<tr><td colspan='3' style='color:${MUTED};text-align:center;padding:10px'>${T.noFunds}</td></tr>`
  let saldoBox=''
  // Solo para saldo EN CONTRA: datos de la cuenta de LEA (útil tenerlos en el documento). La ACCIÓN (devolver / queda
  // para próximos trabajos / transferir) la define el CORREO según el estado del cliente — el PDF no la repite para no contradecir.
  if(saldo<0){ const row=(l,v)=>`<div style='display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1D4D4;font-size:10px'><span style='color:${MUTED}'>${l}</span><span style='font-weight:600;color:${TXT}'>${v}</span></div>`; saldoBox=`<div class='saldo-box' style='border:1px solid #F7C1C1;background:#FCEBEB;border-radius:8px;padding:14px 18px;margin-top:18px'><div style='font-size:11px;font-weight:700;color:${TXT};margin-bottom:10px'>${T.outstanding}</div>${row(T.company,BRAND.nombreLegal)}${row(T.rut,BRAND.rut)}${row(T.bank,BRAND.pago.gastos.banco)}${row(T.account,BRAND.pago.gastos.cuentaFmt)}${row(T.confEmail,BRAND.pago.gastos.email)}</div>` }
  const sep='border-left:1px solid #B9C2C8;margin-left:12px;padding-left:12px'
  // Recuadro "Resumen del fondo": ledger auditable — fondos − (rendiciones previas) − esta rendición = saldo.
  const lrow=(l,v,neg)=>`<div style='display:flex;justify-content:space-between;align-items:baseline;padding:4px 0'><span style='font-size:10px;color:${AZUL3}'>${l}</span><span style='font-size:12px;font-weight:600;color:#fff;white-space:nowrap'>${neg?'−':''}${v}</span></div>`
  const filasPrevias = (rendicionesPrevias||[]).map(p=>lrow(`${T.reportPrev} ${p.fecha?fmtFechaDMY(String(p.fecha).slice(0,10)):T.previous}`, fmtN(p.total), true)).join('')
  const resumenBox=`<div style='background:${A};border-radius:8px;padding:14px 18px;margin-top:18px;color:#fff'><div style='font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${AZUL3};margin-bottom:8px'>${T.fundSummary}${razon?` · ${razon}`:''}</div>${lrow(T.fundsReceived, fmtN(totFondos))}${filasPrevias}${lrow(T.thisReport, fmtN(totGastos), true)}<div style='display:flex;justify-content:space-between;align-items:baseline;padding:9px 0 0;margin-top:6px;border-top:1px solid rgba(255,255,255,.22)'><span style='font-size:11px;font-weight:700;color:#fff'>${T.availBalance}</span><span style='font-size:15px;font-weight:700;color:#fff;white-space:nowrap'>${saldo<0?'−':''}${fmtN(saldo)}</span></div></div>`
  // Cabecera ejecutiva (diseño A): 3 cifras clave arriba — Fondos · Gastos del período · Saldo (destacado).
  const saldoPos = saldo>=0
  const kpiCard = (l,v,bg,fg)=>`<div style='background:${bg};padding:12px 16px;flex:1'><div style='font-size:8px;font-weight:600;color:${fg==='#fff'?'rgba(255,255,255,.7)':AZUL3};text-transform:uppercase;letter-spacing:.4px'>${l}</div><div style='font-size:17px;font-weight:700;color:${fg};margin-top:2px;white-space:nowrap'>${v}</div></div>`
  const kpiRow = `<div style='display:flex;gap:1px;background:${GRAY}'>${kpiCard(T.fundsReceived,fmtN(totFondos),'#fff','#0F6E56')}${kpiCard(T.expPeriod,fmtN(totGastos),'#fff',TXT)}${kpiCard(saldoPos?T.balFavor:T.balPending,(saldo<0?'−':'')+fmtN(Math.abs(saldo)),saldoPos?C.greenBg:C.overdueBg,saldoPos?C.greenText:C.overdueText)}</div>`
  const proyTxt = project ? `${project}${subproject?` · ${subproject}`:''}` : ''
  const proyBar = proyTxt ? `<div style='background:#fff;padding:7px 26px;border-bottom:1px solid ${GRAY};font-size:10px;color:${TXT}'><span style='color:${MUTED};font-weight:600;text-transform:uppercase;letter-spacing:.4px;font-size:9px'>${T.project}</span><span style='margin-left:10px;font-weight:600'>${proyTxt}</span></div>` : ''
  const cuerpoUno = `${proyBar}<div style='padding:20px 26px 0'><table><thead><tr><th>${T.date}</th><th>${T.concept}</th><th>${T.category}</th><th style='text-align:right'>${T.amount}</th></tr></thead><tbody>${filasGastos}</tbody></table><div style='display:flex;justify-content:space-between;padding:8px 10px;border-top:1.5px solid ${A};font-weight:700;font-size:11px'><span>${T.totalExp}</span><span>${fmtN(totGastos)}</span></div>${conRespaldoN>0?`<div style='font-size:9px;color:${MUTED};padding:3px 10px 0'>${T.withReceipt(conRespaldoN,gastos.length)}</div>`:''}<div style='font-size:10px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px'>${T.fundsSection}</div><table><tbody>${filasFondos}</tbody></table>${rendicionesPrevias.length?resumenBox:''}${saldoBox}</div>`
  // 2+ proyectos: un bloque por proyecto (razón social, gastos, fondos, rendido antes, saldo) + imputación de saldos al final.
  const cuerpoGrupos = grupos ? (()=>{ const L=EN?{exp:'Project expenses',prev:'Previously reported',fav:'Balance in favor of the project',due:'Balance to cover',imp:'Summary by project · balance allocation',others:'Other funds and previous reports',note:'Balances in favor are applied to the balances to cover',tot:saldo<0?T.balPending:T.balFavor,proj:'Project'}:{exp:'Gastos del proyecto',prev:'Rendido anteriormente',fav:'Saldo a favor del proyecto',due:'Saldo por cubrir del proyecto',imp:'Resumen por proyecto · imputación de saldos',others:'Otros fondos y rendiciones anteriores',note:'Los saldos a favor se imputan a los saldos por cubrir',tot:saldo<0?T.balPending:T.balFavor,proj:'Proyecto'}
      const sgn=v=>(v<0?'−':v>0?'+':'')+fmtN(Math.abs(v))
      const bloques=grupos.grupos.map((x,i)=>`<div style='margin-bottom:20px;page-break-inside:auto'><div style='display:flex;justify-content:space-between;align-items:flex-end;gap:10px;border-bottom:1.5px solid ${A};padding-bottom:6px;margin-bottom:2px'><div><div style='font-size:8.5px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:.5px'>${L.proj} ${i+1}</div><div style='font-size:12.5px;font-weight:700;color:${A}'>${x.proyecto||'—'}</div></div>${x.ent?`<div style='text-align:right;font-size:9.5px;font-weight:600'>${x.ent.name}${x.ent.rut?`<div style='color:${MUTED};font-weight:400'>${fmtRutCL(x.ent.rut)}</div>`:''}</div>`:''}</div><table><thead><tr><th>${T.date}</th><th>${T.concept}</th><th>${T.category}</th><th style='text-align:right'>${T.amount}</th></tr></thead><tbody>${x.gastos.map(filaGasto).join('')}</tbody></table><div style='display:flex;justify-content:space-between;padding:7px 10px;font-weight:700;font-size:10.5px;border-top:1px solid ${GRAY}'><span>${L.exp}</span><span>${fmtN(x.totGastos)}</span></div>${x.fondos.length?`<div style='font-size:9px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.5px;margin:8px 0 2px'>${T.fundsSection}</div><table><tbody>${x.fondos.map(e=>`<tr><td style='width:90px;white-space:nowrap'>${fmtFechaDMY(e.date)}</td><td>${e.concept||T.fundDefault}</td><td style='text-align:right;font-weight:600;color:#0F6E56'>${fmtN(e.amount)}</td></tr>`).join('')}</tbody></table>`:''}${x.previo?`<div style='display:flex;justify-content:space-between;padding:6px 10px;font-size:10px;color:${MUTED}'><span>${L.prev}</span><span>−${fmtN(x.previo)}</span></div>`:''}<div style='display:flex;justify-content:space-between;padding:8px 10px;border-radius:6px;margin-top:6px;font-weight:700;font-size:11px;background:${x.saldo<0?'#FCEBEB':'#E1F5EE'};color:${x.saldo<0?'#A32D2D':'#0F6E56'}'><span>${x.saldo<0?L.due:L.fav}</span><span>${sgn(x.saldo)}</span></div></div>`).join('')
      const mixto=grupos.grupos.some(x=>x.saldo>0)&&grupos.grupos.some(x=>x.saldo<0)
      const rr=(l,v,st='')=>`<div style='display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10.5px;${st}'><span>${l}</span><span style='white-space:nowrap;font-weight:600'>${v}</span></div>`
      const imp=`<div style='background:${A};border-radius:8px;padding:13px 18px;color:#fff;margin-top:4px;page-break-inside:avoid'><div style='font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${AZUL3};margin-bottom:6px'>${L.imp}</div>${grupos.grupos.map(x=>rr(x.proyecto||'—',sgn(x.saldo))).join('')}${Math.round(grupos.otros)?rr(L.others,sgn(grupos.otros)):''}${mixto?`<div style='font-size:9.5px;color:${AZUL3};padding:2px 0 4px'>${L.note}</div>`:''}<div style='display:flex;justify-content:space-between;padding:8px 0 0;margin-top:4px;border-top:1px solid rgba(255,255,255,.22);font-weight:700;font-size:13px'><span>${L.tot}</span><span style='white-space:nowrap'>${saldo<0?'−':''}${fmtN(Math.abs(saldo))}</span></div></div>`
      return `<div style='padding:20px 26px 0'>${bloques}${imp}${saldoBox}</div>` })() : ''
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'><title>${T.title} — ${razon}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Helvetica,Arial,sans-serif;color:${TXT};font-size:10px;background:#fff}.page{max-width:816px;margin:0 auto;padding-bottom:36px}@page{size:letter portrait;margin:14mm 14mm}table{width:100%;border-collapse:collapse;font-size:10px}thead th{padding:7px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:1px solid ${GRAY}}tbody td{padding:7px 10px;border-bottom:1px solid #EFF1F3}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}.saldo-box{page-break-inside:avoid}tr{page-break-inside:avoid}}</style></head><body><div class='page'><div style='background:${A};padding:20px 26px;display:flex;justify-content:space-between;align-items:center'><img src='${logoBlanco}' alt='${BRAND.nombre}' style='height:30px;display:block'/><div style='text-align:right'><div style='font-size:14px;font-weight:700;color:#fff'>${razon}</div>${rut?`<div style='font-size:11px;color:${AZUL3};margin-top:2px'>${rut}</div>`:''}</div></div><div style='background:${GRAY};padding:8px 26px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:${TXT}'><div style='display:flex;align-items:center'>${correlativo?`<span style='font-weight:700'>${T.reportNo} ${correlativo}</span>`:''}<span style='${correlativo?sep:"font-weight:700"}'>${T.issued}: ${fechaEmision}</span><span style='${sep}'>${T.expW(gastos.length)}</span></div>${dirigidoA?`<div style='font-weight:600'>${T.attn}: ${dirigidoA}</div>`:''}</div>${kpiRow}${grupos?cuerpoGrupos:cuerpoUno}<div style='display:flex;justify-content:space-between;padding:14px 26px 0;margin-top:22px;border-top:1px solid ${GRAY};font-size:9px;color:${MUTED}'><span>${BRAND.direccionCalle} · ${BRAND.ciudad} · ${BRAND.web}</span><span>${T.footerDoc}</span></div></div><button class='print-btn no-print' onclick='window.print()'>${T.printBtn}</button></body></html>`
}

export function firmaCorreoHtml(f, logoSrc, lang){
  if(!f || !(f.nombre||f.cargo||f.telefono)) return ''
  const MUTED='#537281', TXT='#3D3D3D'
  const CARGO_EN={Socio:'Partner',Socia:'Partner',Abogado:'Attorney',Abogada:'Attorney',Procurador:'Paralegal',Procuradora:'Paralegal'}
  const cargo = lang==='en' ? (CARGO_EN[f.cargo]||f.cargo) : f.cargo
  return `<table cellpadding="0" cellspacing="0" style="margin-top:22px;max-width:100%"><tbody><tr><td style="vertical-align:middle;padding-right:16px"><img src="${logoSrc}" alt="${BRAND.nombre}" width="150" style="display:block;width:150px;max-width:100%;height:auto;border:0;outline:none"/></td><td style="vertical-align:middle;border-left:1px solid #B9C2C8;padding-left:16px">${f.nombre?`<div style="font-size:13px;font-weight:700;color:${TXT};text-transform:uppercase;letter-spacing:.3px;line-height:1.35">${f.nombre}</div>`:''}${cargo?`<div style="font-size:11px;color:${MUTED};line-height:1.5">${cargo}</div>`:''}${f.telefono?`<div style="font-size:11px;color:${MUTED};margin-top:10px;line-height:1.5">${f.telefono}</div>`:''}<div style="font-size:11px;color:${MUTED};line-height:1.5">${BRAND.direccionFirma}</div><div style="font-size:11px;color:${MUTED};line-height:1.5">${BRAND.ciudad} - Chile</div><a href="https://${BRAND.web}" style="font-size:11px;color:#5E8088;text-decoration:none;display:inline-block;line-height:1.5">www.${BRAND.web}</a></td></tr></tbody></table>`
}

export function rendicionPdfHtml(r, client, expenses, clientEntities, attachSet, lang='es'){
  const gastos = gastosDeRend(r, expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(e=>attachSet?({...e,respaldo:attachSet.has(String(e.id))}):e)
  const _entsC = (clientEntities||[]).filter(x=>x.client_id===(client&&client.id))
  const _gEnt = (gastos.find(e=>e.entity_id)||{}).entity_id
  // Scope del saldo: con 1 RS = todo el cliente (incl. fondos sin entity_id); con 2+ RS se acota a la RS de los gastos.
  const entId = _entsC.length>1 ? _gEnt : null
  const ent = _entsC.length===1 ? _entsC[0] : (_gEnt ? (clientEntities||[]).find(x=>x.id===_gEnt) : null)
  const trab = r.por_trabajo ? (r.project||'') : null
  const {fondos, totFondos, previas, rendidoAntes} = rendicionFondo(expenses, client&&client.id, entId, r.id, trab, r.fondo_id||null)
  return rendicionDocHtml({
    razon: (ent&&ent.name) || (client&&client.name) || '—',
    rut: (ent&&ent.rut) || (client&&client.rut) || '',
    periodo: r.periodo || '',
    fechaEmision: r.created_at ? new Date(r.created_at).toLocaleDateString(lang==='en'?'en-GB':'es-CL',{day:'2-digit',month:'long',year:'numeric'}) : '',
    dirigidoA: r.dirigido_a || null,
    gastos, fondos,
    totGastos: gastos.reduce((a,e)=>a+(e.amount||0),0),
    totFondos,
    rendidoAntes, rendicionesPrevias: previas, correlativo: r.correlativo,
    project: r.project || null, subproject: r.subproject || null,
    lang,
    grupos: (trab!=null||r.fondo_id) ? null : rendGruposProyecto({expenses, clientId:client&&client.id, scopeEntId:entId, gastos, excludeRenderId:r.id, clientEntities}),
  })
}

export const Switch = ({on,onToggle,disabled}) => (
  <button type='button' disabled={disabled} onClick={disabled?undefined:onToggle} style={{width:34,height:20,borderRadius:10,border:'none',background:on?C.normal:C.toggleOff,position:'relative',cursor:disabled?'not-allowed':'pointer',padding:0,flexShrink:0,transition:'background .15s',opacity:disabled?.7:1}}>
    <span style={{position:'absolute',top:2,left:on?16:2,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
  </button>
)

export function usePersisted(key, initial){
  const [v,setV] = useState(()=>{ try{ const s=localStorage.getItem(key); return s!=null?JSON.parse(s):initial }catch(_){ return initial } })
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(v)) }catch(_){} },[key,v])
  return [v,setV]
}

// Fuente única para APRENDER una RS: vincula el RUT del receptor a un cliente (client_entities) con dedup consistente.
// Devuelve la fila creada, o null si ya existía esa RS / no había cliente / falló. Úsalo en todo "asignar/aprende" (no repetir el insert).
export async function aprenderRS(clientId, rut, name, clientEntities=[]){
  if(!clientId) return null
  const norm=s=>(s||'').replace(/[.\s-]/g,'').toUpperCase(); const nr=norm(rut); const nm=(name||'').trim().toLowerCase()
  // Con RUT: dedup por RUT (global — un RUT pertenece a UN cliente, evita el RUT en dos fichas). Sin RUT: dedup por nombre dentro del mismo cliente.
  const dup = nr ? (clientEntities||[]).some(e=>norm(e.rut)===nr)
                 : (nm && (clientEntities||[]).some(e=>String(e.client_id)===String(clientId)&&(e.name||'').trim().toLowerCase()===nm))
  if(dup) return null
  try{ const {data}=await supabase.from('client_entities').insert({client_id:clientId, name:name||null, rut:rut||null}).select().single(); return data||null }catch(_){ return null }
}

// ── BANDEJA DEL AGENTE (Oficina) — correos que el agente de administración (edge agente-correo) cruzó con la base.
// pendiente = propone y alguien confirma · registrado/espera/resuelto = ya calza con la app (nunca se registra dos veces)
// · sospechoso = cambio de cuenta o pedido de transferir · sin_accion/descartado = informativos. Las partes suman el total.
// Al abrir, la propia página confirma lo que ya se hizo por otra vía (depósito conciliado, liquidación cargada) y lo cierra sola.
export const _DEMO_BANDEJA = [
  {id:'dbh1',gmail_id:'doc:pedir_boleta:demo',recibido_at:'2026-10-24T12:00:00Z',de:'RUT 15.111.222-3',de_nombre:'Felipe Rojas Mena',asunto:'Boleta de honorarios por pedir · Felipe Rojas Mena',tipo:'boleta_honorarios',estado:'pendiente',motivo:'Comisión pagada sin boleta',propuesta:{accion:'pedir_boleta',titulo:'Pedir la boleta de honorarios',nombre:'Felipe Rojas Mena',para:'frojas@correo.cl',tasa:0.1525,lineas:[{tercero_id:'t1',trabajo:'Estudio de títulos',factura:'512',pago_cliente:'2026-09-28',pagado_at:'2026-09-30',bruto:412979,retencion:62979,liquido:350000}]},evidencia:[{texto:'Transferido el 30-09-2026 · Factura N° 512',monto:350000},{texto:'Retención',monto:62979},{texto:'Bruto de la boleta',monto:412979}]},
  {id:'dbh2',gmail_id:'doc:definir_documento:demo',recibido_at:'2026-10-24T12:00:00Z',de:'RUT 16.333.444-5',de_nombre:'Tomás Herrera',asunto:'Documento por definir · Tomás Herrera',tipo:'boleta_honorarios',estado:'pendiente',motivo:'Comisión pagada sin boleta ni factura · ¿boleta o factura?',propuesta:{accion:'definir_documento',titulo:'Definir el documento de la comisión',nombre:'Tomás Herrera',lineas:[]},evidencia:[{texto:'Transferido el 01-07-2026 · Factura N° 471',monto:500000},{texto:'Transferido el 02-07-2026 · Factura N° 471',monto:2500000}]},
  {id:'d1',recibido_at:'2026-10-20T10:05:57Z',de:'genesis.garcia@sbschile.com',de_nombre:'Génesis Garcia',asunto:'Re: Solicitud de fondos por rendir Proyecto Villarica',cuerpo:'Adjunto comprobante de pago solicitado.\n\nEl lun, 19 oct 2026 a las 16:01, Erasmo Escala (<ee@leabogados.cl>) escribió:\n> ... por un total de $1.200.000.-',adjuntos:[{nombre:'Comprobante Operación Express.pdf',mime:'application/pdf'}],tipo:'comprobante',cliente_nombre:'Alejandro Lee',abogado:'Erasmo',estado:'pendiente',motivo:'Por recibir · cartola al 19-10-2026',propuesta:{accion:'registrar_solicitud',titulo:'Registrar la solicitud de fondos',montos:[1200000],montos_cand:[1200000]},evidencia:[{texto:'Solicitud citada en el correo',monto:1200000,fuente:'correo'}]},
  {id:'ds1',gmail_id:'venta:491-34',recibido_at:'2026-10-20T12:00:00Z',de:'OLIVER SPA',de_nombre:'OLIVER SPA',asunto:'Factura N° 491 registrada sin venta',tipo:'factura_sin_venta',cliente_id:'c3',estado:'pendiente',motivo:'Diferencia $700',propuesta:{accion:'asignar_venta',titulo:'Asignar a «Reorganización»',folio:'491',billing_id:'demo-b491',sale_id:'demo-s1',venta:'Reorganización',cuotas:['demo-q1','demo-q2']},evidencia:[{texto:'Factura N° 491 del 20-10-2026',monto:1634180,fuente:'SII'},{texto:'2 cuotas programadas',monto:1634880,fuente:'App'}]},
  {id:'dr1',recibido_at:'2026-10-20T15:17:28Z',de:'usuario@notariarapanui.cl',de_nombre:'Notaría Rapa Nui',asunto:'RE: Consulta solicitud de documentos',tipo:'respaldo_gasto',cliente_nombre:'Notaría Rapa Nui',estado:'pendiente',motivo:'2 gastos por el mismo monto',adjuntos:[{nombre:'4677 BOLETA CERTIFICADO DE VIGENCIA.pdf',mime:'application/pdf'}],propuesta:{accion:'adjuntar_respaldo',titulo:'Adjuntar el respaldo al gasto',path:'demo/boleta.pdf',nombre:'4677 BOLETA CERTIFICADO DE VIGENCIA.pdf',candidatos:[{id:'e-demo-1',fecha:'2026-10-20',monto:20000,cliente:'Viñedos del Maipo Ltda',concepto:'Certificado de vigencia'},{id:'e-demo-2',fecha:'2026-10-09',monto:20000,cliente:'Comercial Andes SpA',concepto:'Gastos notariales'}]},evidencia:[{texto:'Monto del documento',monto:20000,fuente:'PDF'}]},
  {id:'df1',gmail_id:'fondo:demo-av1',recibido_at:'2026-10-20T10:07:00Z',de:'Inversiones Ríofrío Ltda',de_nombre:'Inversiones Ríofrío Ltda',asunto:'Fondo por registrar',tipo:'fondo_por_registrar',cliente_id:'c2',estado:'pendiente',motivo:'El mensaje de la transferencia indica un fondo',propuesta:{accion:'registrar_fondo',titulo:'Registrar el fondo',monto:1200000,fecha:'2026-10-20',proyecto:'Reorganización societaria',concepto:null,fuente:'mensaje',movimiento_id:null,aviso_gmail:'demo-av1'},evidencia:[{texto:'Transferencia de Inversiones Ríofrío Ltda · «provisión reorganización»',monto:1200000,fuente:'Banco de Chile'}]},
  {id:'df2',gmail_id:'fondo:demo-av2',recibido_at:'2026-10-20T10:04:00Z',de:'Inversiones Ríofrío Ltda',de_nombre:'Inversiones Ríofrío Ltda',asunto:'Fondo por registrar',tipo:'fondo_por_registrar',cliente_id:'c2',estado:'pendiente',motivo:'El mensaje de la transferencia indica un fondo',propuesta:{accion:'registrar_fondo',titulo:'Registrar el fondo',monto:1200000,fecha:'2026-10-20',proyecto:'Due diligence adquisición',concepto:null,fuente:'mensaje',movimiento_id:null,aviso_gmail:'demo-av2'},evidencia:[{texto:'Transferencia de Inversiones Ríofrío Ltda · «viáticos due diligence»',monto:1200000,fuente:'Banco de Chile'}]},
  {id:'d2',recibido_at:'2026-10-18T00:35:16Z',de:'ccoquelet@gmail.com',de_nombre:'Catalina Coquelet',asunto:'Re: Reserva sitio El Maqui',cuerpo:'Hola Cristobal,\nAdjunto promesa firmada\nSaludos',adjuntos:[{nombre:'Promesa firmada.pdf',mime:'application/pdf'}],tipo:'pedido_cliente',cliente_nombre:'Catalina Coquelett',abogado:'Cristóbal',estado:'pendiente',motivo:'Cliente reconocido por el nombre',propuesta:{accion:'crear_tarea',titulo:'Crear tarea a Cristóbal: Revisar la promesa firmada',tarea:'Revisar la promesa firmada',asignado:'Cristóbal',aprender_email:'ccoquelet@gmail.com'},evidencia:[]},
  {id:'d3',recibido_at:'2026-10-13T20:20:20Z',de:'sdelgado@notarialascar.cl',de_nombre:'Silvana Delgado',asunto:'RE: Liquidación gastos notaría',cuerpo:'Envío deuda y número de cuenta.',adjuntos:[{nombre:'LIBERONA ESCALA ABOGADOS.xlsx',mime:'application/vnd.ms-excel'}],tipo:'cuenta_bancaria',estado:'pendiente',motivo:'Liquidación cargada el 15-10-2026',propuesta:{accion:'guardar_cuenta',titulo:'Guardar la cuenta de la notaría como conocida',dominio:'notarialascar.cl',cuenta:'206659341',banco:'Itaú',rut:'8.215.914-2'},evidencia:[{texto:'Cuenta de la notaría · Itaú',valor:'206659341',fuente:'correo'},{texto:'RUT titular',valor:'8.215.914-2',fuente:'correo'}]},
  {id:'d4',recibido_at:'2026-10-14T19:29:07Z',de:'julio.cisterna@ludipek.com',de_nombre:'Julio Cisterna',asunto:'RE: Solicitud de fondo por rendir',cuerpo:'',adjuntos:[],tipo:'comprobante',cliente_nombre:'Juan Pablo Martinez',abogado:'Cristóbal',estado:'registrado',motivo:'Depósito del 15-10-2026 ya conciliado',propuesta:{},evidencia:[{texto:'Depósito 15-10-2026',monto:500000,fuente:'cartola'}]},
  {id:'d5',recibido_at:'2026-10-09T14:29:00Z',de:'adquisiciones@bastro.cl',de_nombre:'Bastro',asunto:'COMPROBANTE DE PAGO',cuerpo:'',adjuntos:[],tipo:'comprobante',cliente_nombre:'Eduardo Barra',abogado:'Erasmo',estado:'registrado',motivo:'Depósito del 09-10-2026 ya conciliado',propuesta:{},evidencia:[{texto:'Depósito 09-10-2026',monto:1369907,fuente:'cartola'}]},
  {id:'d6',recibido_at:'2026-10-16T12:00:00Z',de:'noticias@legalnews.cl',de_nombre:'Legal News',asunto:'Boletín semanal',cuerpo:'',adjuntos:[],tipo:'spam',estado:'sin_accion',motivo:'Publicidad o notificación',propuesta:{},evidencia:[]},
]

// Fondo por registrar (conciliacion-auto lo propone desde el aviso del banco o la cartola, con señal de fondo): una persona
// lo confirma desde Gastos › Revisar o la Bandeja. Nunca dos veces: si el depósito ya se concilió en Banco, solo se cierra; si
// el cliente ya tiene un fondo igual sin respaldo del banco (±10 días), se vincula ese en vez de crear otro. Con el movimiento
// del banco a la vista, el fondo queda conciliado en el mismo paso; si aún no llega la cartola, lo concilia el agente al llegar.
export async function registrarFondoPropuesto(r, {proyecto, yo, sales, expenses, onFondo}={}){
  const p=r.propuesta||{}, cid=r.cliente_id, monto=Math.round(Number(p.monto)||0), fecha=String(p.fecha||r.recibido_at||'').slice(0,10)
  if(!cid||!monto||!fecha) throw new Error('Falta el cliente, el monto o la fecha.')
  const cierre={resuelto_por:yo,resuelto_at:new Date().toISOString()}
  const ps=proyecto?proyectoSeguro(cid,sales,{titulo:proyecto}):{}
  const fondoBase={client_id:cid, ...(ps.project?ps:proyecto?{project:proyecto}:{}), type:'fondo', amount:monto, date:fecha,
    concept:(p.concepto||`Provisión de fondos${proyecto?` · ${proyecto}`:''}`).slice(0,200), category:'Fondo', created_by:yo}
  if(DEMO){ const data={...fondoBase,id:'demo-f-'+Date.now(),created_at:new Date().toISOString()}; onFondo&&onFondo(data); return {estado:'registrado',motivo:`Fondo registrado por ${yo}`,...cierre,propuesta:{...p,proyecto,fondo_id:data.id}} }
  // Reclamar la propuesta: si dos personas la registran a la vez, solo una sigue (la otra ve el estado nuevo).
  const {data:mia}=await supabase.from('agente_bandeja').update({estado:'procesando'}).eq('id',r.id).eq('estado','pendiente').select('id')
  if(!mia?.length){ const {data:act}=await supabase.from('agente_bandeja').select('estado,motivo').eq('id',r.id).single(); return {estado:act?.estado||'registrado',motivo:act?.motivo||null} }
  let fondo=null, creado=false
  try{
    // Movimiento del depósito: el de la propuesta o, si nació del aviso, el que ese aviso ya tenga unido.
    let movId=p.movimiento_id||null
    if(!movId&&p.aviso_gmail){ const {data:av}=await supabase.from('avisos_banco').select('movimiento_id').eq('gmail_id',p.aviso_gmail).maybeSingle(); movId=av?.movimiento_id||null }
    let mov=null
    if(movId){ const {data:m}=await supabase.from('cartola_movimientos').select('id,estado,monto,monto_conciliado,fecha').eq('id',movId).single(); mov=m||null
      if(mov&&(mov.estado!=='pendiente'||Number(mov.monto_conciliado)>0)){ const c={estado:'registrado',motivo:'El depósito ya está conciliado en Banco',...cierre}; await supabase.from('agente_bandeja').update(c).eq('id',r.id); return c } }
    // Fondos del cliente por ese monto (±10 días) en la BASE (no en lo cargado en pantalla, que puede estar atrasado).
    const d=x=>new Date(new Date(fecha+'T12:00').getTime()+x*86400000).toISOString().slice(0,10)
    const {data:iguales}=await supabase.from('expenses').select('id,amount,date,concept,project').eq('type','fondo').eq('client_id',cid).eq('amount',monto).is('deleted_at',null).gte('date',d(-10)).lte('date',d(10))
    const ids=(iguales||[]).map(x=>x.id)
    const {data:lig}=ids.length?await supabase.from('conciliacion').select('gasto_id').eq('tipo_destino','fondo').in('gasto_id',ids):{data:[]}
    const ligSet=new Set((lig||[]).map(x=>String(x.gasto_id)))
    // Sin movimiento a la vista y con un fondo igual YA conciliado al banco: ese es el de este depósito (lo registró otra vía).
    if(!mov&&(iguales||[]).some(x=>ligSet.has(String(x.id)))){ const c={estado:'registrado',motivo:'El fondo ya está registrado y conciliado en Banco',...cierre}; await supabase.from('agente_bandeja').update(c).eq('id',r.id); return c }
    fondo=(iguales||[]).find(x=>!ligSet.has(String(x.id)))||null
    const vinculado=!!fondo
    if(!fondo){ const {data,error}=await supabase.from('expenses').insert(fondoBase).select().single(); if(error) throw error; fondo=data; creado=true; onFondo&&onFondo(data) }
    let sinConciliar=false
    if(mov){ const ic=await supabase.from('conciliacion').insert({movimiento_id:mov.id,tipo_destino:'fondo',gasto_id:fondo.id,monto_aplicado:monto,origen:'manual'}).select().single()
      if(ic.error) sinConciliar=true
      else{ const total=Number(mov.monto)||monto; const {error:me}=await supabase.from('cartola_movimientos').update({estado:monto>=total?'conciliado':'parcial',monto_conciliado:monto}).eq('id',mov.id); if(me){ await supabase.from('conciliacion').delete().eq('id',ic.data.id); sinConciliar=true } } }
    if(p.solicitud_id) await supabase.from('fund_requests').update({recibido_at:new Date(fecha+'T12:00').toISOString(),movimiento_id:mov?.id||null,estado:'recibida'}).eq('id',p.solicitud_id).is('recibido_at',null)
    const c={estado:'registrado',motivo:`${vinculado?'Fondo vinculado':'Fondo registrado'} por ${yo}${sinConciliar?' · el depósito no quedó conciliado: concílialo en Banco':''}`,...cierre,propuesta:{...p,proyecto:proyecto||null,fondo_id:fondo.id}}
    await supabase.from('agente_bandeja').update(c).eq('id',r.id)
    logActividad('fondos.registrado_desde_banco',{tabla:'expenses',id:fondo.id,detalle:{title:`${vinculado?'Fondo vinculado':'Fondo registrado'}: ${fmt(monto)} del ${fmtFechaDMY(fecha)}${proyecto?` · ${proyecto}`:''}`,bandeja:r.id,movimiento:mov?.id||null}})
    if(sinConciliar) appAlert(`El fondo quedó registrado, pero el depósito no quedó conciliado. Concílialo en Banco.`)
    return c
  }catch(e){
    // Sin fondo creado: la propuesta vuelve a pendiente. Con el fondo ya creado, se cierra igual (el fondo existe) y se informa.
    if(!creado) await supabase.from('agente_bandeja').update({estado:'pendiente'}).eq('id',r.id)
    else await supabase.from('agente_bandeja').update({estado:'registrado',motivo:`Fondo registrado por ${yo} · revisar en Banco`,...cierre,propuesta:{...p,fondo_id:fondo?.id||null}}).eq('id',r.id)
    throw e
  }
}

export const _diasEntre = (a,b) => { const x=String(a||'').slice(0,10), y=String(b||'').slice(0,10); if(!x||!y) return null; return Math.round((new Date(y+'T12:00')-new Date(x+'T12:00'))/864e5) }

// Paso a paso de la rendición: 1 gastos y saldo → 2 correo y envío (mismo indicador en las dos páginas).
export const PasosRend = ({paso}) => (<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
  {[[1,'Gastos y saldo'],[2,'Correo y envío']].map(([n,l],i)=>(<Fragment key={n}>{i>0&&<span style={{color:C.done}}>→</span>}<span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:paso===n?C.accent:C.muted,whiteSpace:'nowrap'}}><span style={{width:20,height:20,borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,background:paso===n?C.accent:C.track,color:paso===n?'#fff':C.muted}}>{n}</span>{l}</span></Fragment>))}
</div>)

export const _mesLabelOf = m => { const [y,mm]=m.split('-'); const nm=['','ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][parseInt(mm)]||mm; return `${nm} ${y}` }

// Lunes de la semana en curso (dd del corte semanal de los borradores preparados).
export function lunesSemanaISO(){ const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return isoLocal(d.getTime()) }

// Clientes con gastos por rendir (FUENTE ÚNICA: Inicio y página Rendir a cliente): sin la oficina, sin gastos de $0 y sin clientes terminados.
export const _esOfiCliR = c => !!c&&(c.is_internal||/liberona\s+escala/i.test(c.name||''))

export const canonOtNN = o => { const s=String(o||'').trim().toUpperCase(); if(!s||s==='S/OT') return ''; const d=s.replace(/\D/g,''); return d?'OT-'+d:s }

export const _fechaISO = f => { if(!f) return null; if(f instanceof Date) return isNaN(f)?null:f.toISOString().slice(0,10); const t=String(f).slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:null }

// Categorías que casi siempre son de un cliente: cargadas a la oficina, se pregunta antes de guardar.
// Trámites (CBR, notaría, RC, archivo, DO): la glosa tiene que decir de qué es — inmueble, sociedad o persona.
// Genérica = solo palabras de trámite y el nombre del CBR/notaría («1 Copia con Vigencia», «3 certificados de dominio vigente»).
export const _GEN_DET = new Set('certificado certificados cert certs copia copias solicitud solicitar pedido varios varias diversos vigente vigentes vigencia vigencias sin no dominio dominios hipoteca hipotecas gravamen gravamenes prohibicion prohibiciones litigio litigios inscripcion inscripciones incripcion reinscripcion inscrito inscritos anotacion anotaciones nota notas margen marginal marginales estudio titulo titulos inmueble inmuebles propiedad propiedades registro reg comercio civil archivo judicial diario oficial publicacion extracto autorizada autorizadas autorizado simple escritura escrituras publica ep documento documentos tramite tramites gasto gastos pago pagos saldo diferencia caratula cbr conservador bienes raices notaria notarial notariales poder poderes mandato sociedad sociedades constitucion modificacion transformacion rectificacion ampliacion duplicado posesion efectiva pe capital acreditacion certificacion firma firmas sii impuesto alzamiento usufructo carta certificada matrimonio nacimiento defuncion santiago stgo para de del la las el los y e o u por con en a al un una uno dos tres cuatro cinco seis siete ocho nueve diez sb otros otras rc do vehiculos vehiculo patentes'.split(' '))

export const glosaSinDetalle = concept => { let n=_normTxt(concept); if(!n) return true
  n=n.replace(/\b(cbr|conservador|notaria)( de)? [a-z]+( [a-z]+)?/g,' ')
  return !n.split(' ').some(w=>w.length>=3&&!/^\d+$/.test(w)&&!_GEN_DET.has(w)) }

export const CATS_DE_CLIENTE = new Set(['Notaria','CBR','Diario Oficial','Registro Civil','Archivo Judicial'])

// Tarjeta de acceso de los hubs (Gastos, Notaría, Rendiciones, Revisar): una sola forma en toda la app — ícono a la izquierda, texto a la derecha.
// sM = subtítulo corto para el celular (todo en 1 línea, sin «…»).
// ── MOVILIZACIÓN (control de Uber y traslados) ─────────────────────────────────────────────
// Fuente única: gastos categoría Movilización. persona=null → todo el equipo (admin, desde Revisar); persona='Martina' → solo lo
// suyo (Caja chica de cada uno). Cargo: oficina (cliente interno) · cliente · personal. «Sin motivo» = consulta pendiente.
export const _NOM_MAIL = {cl:'Cristóbal',ee:'Erasmo',mc:'Martín',mp:'Martina',rd:'Rodrigo'}

export const nombreCargador = s => { const v=String(s||'').trim(); if(!v) return 'Sin registro'; if(v.includes('@')) return _NOM_MAIL[v.split('@')[0]]||v; return v }

export const MovIcon = ({s=16,c}) => <svg width={s} height={s} viewBox='0 0 24 24' fill='none' stroke={c||C.muted} strokeWidth='1.7' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><path d='M5 17h14l-1.5-6h-11z'/><circle cx='8' cy='18' r='1.6'/><circle cx='16' cy='18' r='1.6'/><path d='M7 11l1.5-4h7l1.5 4'/></svg>

export function movilizacionDatos(expenses, clients, {persona=null, anio=null, excluir=null}={}){
  const ofi=new Set((clients||[]).filter(c=>c.is_internal||/liberona\s+escala/i.test(c.name||'')).map(c=>String(c.id)))
  const movs=(expenses||[]).filter(e=>e.type==='gasto'&&!e.deleted_at&&e.category==='Movilización'&&(!anio||String(e.date||'').slice(0,4)===String(anio))&&(!persona||nombreCargador(e.created_by)===persona)&&!(excluir&&excluir.includes(nombreCargador(e.created_by))))
    .map(e=>({...e, _p:nombreCargador(e.created_by), _cargo:e.personal_de?'per':(e.client_id&&ofi.has(String(e.client_id))?'ofi':(e.client_id?'cli':'ofi')), _sin:e.revision_estado==='consultar'}))
    .sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
  const dup=new Set(); movs.forEach((a,i)=>movs.slice(i+1).forEach(b=>{ if(a._p===b._p&&a.date&&a.date===b.date&&Math.abs((a.amount||0)-(b.amount||0))<=200&&String(a.client_id)===String(b.client_id)){ dup.add(a.id); dup.add(b.id) } }))
  const sum=l=>l.reduce((t,e)=>t+(e.amount||0),0)
  const agr=l=>({n:l.length, tot:sum(l), ofi:sum(l.filter(e=>e._cargo==='ofi')), cli:sum(l.filter(e=>e._cargo==='cli')), per:sum(l.filter(e=>e._cargo==='per')), sin:l.filter(e=>e._sin).length})
  const porMes={}; movs.forEach(e=>{ const k=String(e.date||'').slice(0,7)||'sin fecha'; (porMes[k]=porMes[k]||[]).push(e) })
  const porPersona={}; movs.forEach(e=>{ (porPersona[e._p]=porPersona[e._p]||[]).push(e) })
  return {movs, tot:agr(movs), sinMotivo:movs.filter(e=>e._sin), duplicados:movs.filter(e=>dup.has(e.id)), meses:Object.keys(porMes).sort().reverse().map(k=>({k, movs:porMes[k], ...agr(porMes[k])})), personas:Object.keys(porPersona).map(k=>({k, movs:porPersona[k], ...agr(porPersona[k])})).sort((a,b)=>b.tot-a.tot)}
}

// excluir: revisor no admin (miembros.revisa_gastos) ve al equipo sin los admins; puedeEditar: lo ajeno queda solo lectura.
export function MovilizacionView({expenses, clients, persona=null, isAdmin=false, excluir=null, puedeEditar=null, onBack, origen='Volver', onEdit}){
  const isDesktop=useIsDesktop()
  const anios=[...new Set((expenses||[]).filter(e=>e.category==='Movilización'&&e.date).map(e=>String(e.date).slice(0,4)))].sort().reverse()
  const [anio,setAnio]=useState(anios[0]||String(new Date().getFullYear()))
  const [per,setPer]=useState(persona)
  const [abierto,setAbierto]=useState(null)   // mes desplegado | 'sin' | 'dup'
  const d=movilizacionDatos(expenses, clients, {persona:per, anio, excluir})
  const todos=isAdmin&&!persona ? movilizacionDatos(expenses, clients, {anio, excluir}).personas.map(x=>x.k) : []
  const editable=e=>!!onEdit&&(!puedeEditar||puedeEditar(e))
  const cliN=id=>(clients||[]).find(c=>String(c.id)===String(id))?.name
  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}
  const num={fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}
  const pill=(on)=>({fontSize:11.5,fontWeight:600,border:`1px solid ${on?C.azulTenueOn||C.border:C.border}`,borderRadius:20,padding:'3px 10px',background:on?C.azulBg:C.card,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'})
  const exportar=async()=>{ try{ const XLSX=await loadXLSXStyle()
    const CG={ofi:'Oficina',cli:'Cliente',per:'Personal'}
    const rows=d.movs.map(e=>[e.date?fmtFechaDMY(e.date):'', e._p, e.subcategory||'', e.concept||'', e._cargo==='cli'?(cliN(e.client_id)||''):(e.personal_de?`Personal ${e.personal_de}`:'Oficina'), e.project||'', CG[e._cargo], e.amount||0, e._sin?'Falta el motivo':''])
    const ws=XLSX.utils.aoa_to_sheet([[`Movilización ${anio}${per?` · ${per}`:''}`],[],['Fecha','Persona','Medio','Glosa','Cliente','Proyecto','Cargado a','Monto','Pendiente'],...rows,[],['Total','','','','','','',d.tot.tot]])
    ws['!cols']=[{wch:11},{wch:12},{wch:13},{wch:60},{wch:26},{wch:28},{wch:11},{wch:11},{wch:16}]
    Object.keys(ws).forEach(k=>{ if(/^H\d+$/.test(k)&&typeof ws[k].v==='number'){ ws[k].z='"$"#,##0' } })
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Movilización'); XLSX.writeFile(wb,`Movilizacion ${anio}${per?` ${per}`:''}.xlsx`) }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const fila=e=>(<div key={e.id} onClick={()=>editable(e)&&onEdit(e)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.track}`,cursor:editable(e)?'pointer':'default'}}>
    {diaGrande(e.date)}
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'}</div>
      <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[!per&&e._p, e.subcategory, e._cargo==='cli'?cliN(e.client_id):(e._cargo==='per'?'Personal':'Oficina')].filter(Boolean).join(' · ')}{e._sin&&<b style={{color:C.soonText}}> · falta el motivo</b>}</div></div>
    <span style={{...num,fontSize:13.5,fontWeight:700,color:C.text}}>{fmt(e.amount)}</span></div>)
  const desglose=x=>[`Oficina ${fmt(x.ofi)}`,`Clientes ${fmt(x.cli)}`,x.per?`Personal ${fmt(x.per)}`:null].filter(Boolean).join(' · ')
  const prom=x=>x.n?fmt(Math.round(x.tot/x.n)):'—'
  const alerta=(k,t,sub,lista)=>(<div style={{...card,minWidth:0,overflow:'hidden'}}><div onClick={()=>setAbierto(abierto===k?null:k)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',cursor:'pointer'}}>
    <span style={{width:30,height:30,borderRadius:8,background:C.soonBg,display:'grid',placeItems:'center',color:C.soonText,fontWeight:700,flexShrink:0}}>!</span>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t}</div><div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>
    <span style={{color:C.textSoft}}><Gl n={abierto===k?'chevU':'chevD'}/></span></div>
    {abierto===k&&lista.map(fila)}</div>)
  return (<FlujoPagina origen={origen} titulo='Movilización' ctx={per||(isAdmin?'todo el equipo':null)} onBack={onBack} maxW={1100}>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginBottom:12}}>
      <select value={anio} onChange={e=>{setAnio(e.target.value);setAbierto(null)}} style={{...pill(true),outline:'none'}}>{(anios.length?anios:[anio]).map(y=><option key={y} value={y}>{y}</option>)}</select>
      {todos.length>1&&<>{[null,...todos].map(p=><span key={p||'todos'} onClick={()=>{setPer(p);setAbierto(null)}} style={pill(per===p)}>{p||'Todos'}</span>)}</>}
      <span onClick={exportar} title='Descargar Excel' style={{marginLeft:'auto',...pill(false),display:'inline-flex',alignItems:'center',gap:5}}><SIcon n='download' s={13} c={C.accent}/>Excel</span>
    </div>
    <div style={{...card,padding:'14px 16px'}}>
      <div style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Movilización {anio}</div>
      <div style={{fontSize:isDesktop?30:26,fontWeight:700,color:C.accent,...num,letterSpacing:-.5}}>{fmt(d.tot.tot)}</div>
      <div style={{fontSize:12.5,color:C.muted}}>{d.tot.n} viaje{d.tot.n!==1?'s':''} · promedio {prom(d.tot)} por viaje</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:1,background:C.border,borderRadius:8,overflow:'hidden',marginTop:10}}>
        {[['A la oficina',d.tot.ofi],['A clientes',d.tot.cli],['Personales',d.tot.per]].map(([l,v])=><div key={l} style={{background:C.bgSoft,padding:'8px 11px',minWidth:0}}><div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap'}}>{l}</div><div style={{fontSize:isDesktop?15:13.5,fontWeight:700,color:C.text,...num}}>{fmt(v)}</div><div style={{fontSize:10.5,color:C.textSoft}}>{d.tot.tot?Math.round(v*100/d.tot.tot):0}%</div></div>)}
      </div>
    </div>
    {(d.sinMotivo.length>0||d.duplicados.length>0)&&<div style={{display:'grid',gridTemplateColumns:isDesktop&&d.sinMotivo.length&&d.duplicados.length?'minmax(0,1fr) minmax(0,1fr)':'minmax(0,1fr)',gap:10,marginTop:10,alignItems:'start'}}>
      {d.sinMotivo.length>0&&alerta('sin',`${d.sinMotivo.length} viaje${d.sinMotivo.length!==1?'s':''} sin motivo`,`${fmt(d.sinMotivo.reduce((t,e)=>t+(e.amount||0),0))} · completa desde, hasta y motivo`,d.sinMotivo)}
      {d.duplicados.length>0&&alerta('dup',`${d.duplicados.length} posibles duplicados`,'mismo día, monto y cliente · revisa en Uber',d.duplicados)}
    </div>}
    <div style={{display:'grid',gridTemplateColumns:isDesktop&&!per?'minmax(0,1.3fr) minmax(0,1fr)':'minmax(0,1fr)',gap:14,marginTop:14,alignItems:'start'}}>
      <div style={{minWidth:0}}><div style={{...SEC_LBL,margin:'0 2px 6px'}}>Por mes</div><div style={{...card,overflow:'hidden'}}>{d.meses.map((m,i)=>(<div key={m.k} style={{borderTop:i?`1px solid ${C.track}`:'none'}}>
        <div onClick={()=>setAbierto(abierto===m.k?null:m.k)} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',cursor:'pointer'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{m.k==='sin fecha'?'Sin fecha':mesTitulo(m.k+'-15')}</div><div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.n} viaje{m.n!==1?'s':''} · prom. {prom(m)}{m.sin?<b style={{color:C.soonText}}> · {m.sin} sin motivo</b>:''}</div><div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{desglose(m)}</div></div>
          <span style={{...num,fontSize:14,fontWeight:700,color:C.text}}>{fmt(m.tot)}</span><span style={{color:C.textSoft}}><Gl n={abierto===m.k?'chevU':'chevD'}/></span></div>
        {abierto===m.k&&m.movs.map(fila)}</div>))}{!d.meses.length&&<div style={{padding:22,textAlign:'center',fontSize:13,color:C.muted}}>Sin movilización registrada en {anio}.</div>}</div></div>
      {!per&&d.personas.length>0&&<div style={{minWidth:0}}><div style={{...SEC_LBL,margin:'0 2px 6px'}}>Por persona</div><div style={{...card,overflow:'hidden'}}>{d.personas.map((x,i)=>(
        <div key={x.k} onClick={()=>todos.length>1&&setPer(x.k)} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',borderTop:i?`1px solid ${C.track}`:'none',cursor:todos.length>1?'pointer':'default'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{x.k}</div><div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.n} viaje{x.n!==1?'s':''} · prom. {prom(x)}{x.sin?<b style={{color:C.soonText}}> · {x.sin} sin motivo</b>:''}</div><div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{desglose(x)}</div></div>
          <span style={{...num,fontSize:14,fontWeight:700,color:C.text}}>{fmt(x.tot)}</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>))}</div></div>}
    </div>
  </FlujoPagina>)
}

export function HubTile({ic,icNode,t,s,sM,sCol,col,bg,cardBg,cardBd,tCol,onClick}){
  const D=useIsDesktop()
  return (
    <div onClick={onClick} style={{cursor:onClick?'pointer':'default',background:cardBg||C.surface,border:`1px solid ${cardBd||C.border}`,borderRadius:12,padding:D?'12px 14px':'10px 11px',display:'flex',alignItems:'center',gap:D?12:9,minWidth:0}}>
      <span style={{width:D?34:30,height:D?34:30,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{icNode||<SIcon n={ic} s={D?17:15} c={col}/>}</span>
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:D?14.5:13,fontWeight:600,color:tCol||C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t}</div>
        <div style={{fontSize:D?12:11,color:sCol||C.muted,fontWeight:sCol?600:400,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{D?s:(sM||s)}</div>
      </div>
    </div>)
}

export const FACTURACION_ROOT='1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'

// ── DRIVE: escritura de adjuntos (carpeta compartida "Respaldo Gastos APP") ──────
export const ADJUNTOS_ROOT='1iuWqAB9UNZfDSqj5MSeTTngPaplzBTEH'

// Envío en lote: se decide UNA vez desde qué cuenta salen todos (tu correo; sin acceso a Gmail, se pregunta por la oficina) → batch de enviarComoUsuario.
export async function modoEnvioLote(n){ if(await driveToken()) return 'usuario'
  return await appConfirm(`No hay acceso a tu Gmail para enviar ${n===1?'el correo':`los ${n} correos`} desde tu cuenta.\n\n${TXT_REINGRESO()}\n\n¿Enviar${n===1?'lo':'los'} ahora desde la cuenta de la oficina?\n(Cancelar = no se envía ninguno)`) ? 'oficina' : 'cancelar' }

// Resumen de un envío en lote: cuántos salieron, desde qué cuenta, y qué hacer con los que no.
export const txtResumenEnvio = ({ok=0, no=0, via=null, que='correos', g='o'}={}) => `${ok} ${que} enviad${g}${ok!==1?'s':''}${ok&&via?` desde ${via==='oficina'?'la cuenta de la oficina':'tu cuenta'}`:''}.${no?`\n${no} NO se enviaron.\n\n${TXT_REINGRESO()}`:''}`

// Busca subcarpeta por nombre dentro de parentId; si no existe, la crea. Devuelve su id.
export async function driveFindOrCreateFolder(token, parentId, name){
  const q=encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g,"\\'")}' and trashed=false`)
  const res=await driveGet(token,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)
  if(res.files&&res.files.length) return res.files[0].id
  const r=await fetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({name, mimeType:'application/vnd.google-apps.folder', parents:[parentId]})
  })
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive crear carpeta '+r.status)
  return (await r.json()).id
}

// Devuelve {tareas,gastos} ids de subcarpetas, con caché en localStorage.
export async function driveAdjuntosFolders(token){
  let tareas=localStorage.getItem('drive_folder_tareas')
  let gastos=localStorage.getItem('drive_folder_gastos')
  if(!tareas){ tareas=await driveFindOrCreateFolder(token,ADJUNTOS_ROOT,'Tareas'); localStorage.setItem('drive_folder_tareas',tareas) }
  if(!gastos){ gastos=await driveFindOrCreateFolder(token,ADJUNTOS_ROOT,'Gastos'); localStorage.setItem('drive_folder_gastos',gastos) }
  let facturas=localStorage.getItem('drive_folder_facturas_beta2')
  if(!facturas){ facturas=await driveFindOrCreateFolder(token,FACTURACION_ROOT,'BETA — Respaldos automáticos (en pruebas)'); localStorage.setItem('drive_folder_facturas_beta2',facturas) }
  return {tareas,gastos,facturas}
}

// Sube un File con upload resumable (aguanta 15 MB). Devuelve {id,name,webViewLink}.
export async function driveUpload(token, folderId, file, name){
  const init=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink&supportsAllDrives=true',{
    method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':file.type||'application/octet-stream','X-Upload-Content-Length':String(file.size)},
    body:JSON.stringify({name, parents:[folderId]})
  })
  if(init.status===401) throw new DriveAuthError()
  if(!init.ok) throw new Error('Drive init subida '+init.status)
  const uploadUrl=init.headers.get('Location')
  if(!uploadUrl) throw new Error('No se pudo iniciar la subida a Drive')
  const put=await fetch(uploadUrl,{method:'PUT',headers:{'Content-Type':file.type||'application/octet-stream'},body:file})
  if(put.status===401) throw new DriveAuthError()
  if(!put.ok) throw new Error('Drive subida '+put.status)
  return put.json()
}

export const ME_DOMAIN = BRAND.web

// Destinatarios sugeridos para la rendición: quién ha escrito o recibido correos sobre este cliente (solo encabezados, nunca el cuerpo).
export const _addrsMail = h => (h||'').split(',').map(x=>x.trim()).map(x=>{ const m=x.match(/^(.*?)<(.+?)>$/); return m?{name:m[1].replace(/["']/g,'').trim(), email:m[2].trim().toLowerCase()}:{name:'', email:x.toLowerCase()} }).filter(x=>x.email.includes('@'))

export async function gmailParticipantesCliente(token, terms, cap=40){
  const ts=[...new Set((terms||[]).filter(Boolean).map(t=>String(t).trim()).filter(t=>t.length>=4))].slice(0,8)
  if(!ts.length) return []
  const q=encodeURIComponent(`(${ts.map(t=>t.includes('@')?t:`"${t.replace(/"/g,'')}"`).join(' OR ')}) newer_than:18m`)
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${cap}`,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok) return []
  const ids=((await r.json()).messages||[]).map(m=>m.id)
  const agg={}
  const meta=async id=>{ try{
    const x=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`,{headers:{Authorization:'Bearer '+token}})
    if(!x.ok) return; const j=await x.json(); const H={}; (j.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
    const ds=j.internalDate?isoLocal(parseInt(j.internalDate)):'', subj=H['subject']||''
    const from=_addrsMail(H['from'])[0], nuestro=!!from&&(from.email.split('@')[1]||'')===ME_DOMAIN
    const add=(p,rol)=>{ const dom=p.email.split('@')[1]||''; if(!dom||dom===ME_DOMAIN) return
      if(/no-?reply|noreply|notif|mailer-daemon|newsletter|bounce|postmaster|sii\.cl|notaria|conservador/i.test(p.email)) return
      const a=agg[p.email]||(agg[p.email]={email:p.email,name:'',n:0,last:'',subj:'',rol:''}); a.n++
      if(p.name&&p.name.length>a.name.length) a.name=p.name
      if(ds>=a.last){ a.last=ds; a.subj=subj; a.rol=rol } }
    if(from) add(from,'escribio')
    ;[..._addrsMail(H['to']),..._addrsMail(H['cc'])].forEach(p=>add(p, nuestro?'recibio':'copia'))
  }catch(_){} }
  for(let i=0;i<ids.length;i+=6) await Promise.all(ids.slice(i,i+6).map(meta))
  return Object.values(agg).sort((a,b)=>b.n-a.n||String(b.last).localeCompare(String(a.last))).slice(0,6)
}

// Buscador de cliente (escribe para filtrar) — para asignar contactos sin cliente claro.
export function ClientePicker({clients=[], onPick}){
  const [q,setQ]=useState(''); const [open,setOpen]=useState(false)
  const matches = q.trim()? clients.filter(c=>_normTxt(c.name).includes(_normTxt(q))).slice(0,8):[]
  return (
    <div style={{position:'relative',marginTop:4}}>
      <input value={q} onChange={e=>{setQ(e.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)} placeholder='Buscar cliente…' style={{width:'100%',maxWidth:240,height:32,border:`1px solid ${C.border}`,borderRadius:8,padding:'0 10px',fontSize:12,color:C.text,background:C.bgSoft,colorScheme:'light',WebkitTextFillColor:C.text,outline:'none',boxSizing:'border-box'}}/>
      {open&&matches.length>0&&(
        <div style={{position:'absolute',top:'100%',left:0,width:240,maxWidth:'100%',background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:60,marginTop:3,maxHeight:200,overflowY:'auto'}}>
          {matches.map(c=>(<div key={c.id} onMouseDown={()=>{onPick(c.id);setQ('');setOpen(false)}} style={{padding:'8px 11px',fontSize:12,color:C.text,cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{c.name}</div>))}
        </div>
      )}
    </div>
  )
}

// Días para vencer sobre la FUENTE ÚNICA de vencimiento (venceBill = emisión+30). >0 faltan, <0 vencida hace N. Cobranza/recordatorios DEBEN usar esto (no daysLeft(due) crudo, que rompe si el due quedó viejo tras emitir tarde).
export const daysLeftB = b => daysLeft(venceBill(b))

// CHIP ÚNICO del estado de una factura para MOSTRAR — fuente única visual. Deriva de estadoFacturaLabel (que ya concuerda con estadoCobro: nunca "Cobrado" y "Sin pago" a la vez).
// Pasa `respaldoMap` (usa b.id) o `aplicado` directo. `short` usa la etiqueta corta; `chevron` agrega ' ›' cuando la fila despliega detalle.
export function EstadoFacturaChip({b, aplicado=0, respaldoMap=null, cartolaHasta=null, short=false, chevron=false, style={}}){
  const ap = respaldoMap ? (respaldoMap[b?.id]||0) : aplicado
  const e = estadoFacturaLabel(b, ap, cartolaHasta)
  if(!e) return null
  return <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:e.bg,color:e.fg,whiteSpace:'nowrap',display:'inline-block',...style}}>{short?e.short:e.label}{chevron?<>{" "}<Gl n='chevron'/></>:''}</span>
}

export async function cargarFeriadosCL(){
  const ys=[currentYear-1,currentYear,currentYear+1]
  const _add = d => { if(typeof d==='string' && /^\d{4}-\d{2}-\d{2}/.test(d)) FERIADOS_CL.add(d.slice(0,10)) }
  for(const y of ys){
    let ok=false
    for(const url of [`https://api.boostr.cl/feriados/${y}.json`, `https://apis.digital.gob.cl/fl/feriados/${y}`]){
      try{ const r=await fetch(url); if(!r.ok) continue; const j=await r.json(); const arr=Array.isArray(j)?j:(j.data||j.feriados||[]); if(!Array.isArray(arr)||!arr.length) continue; arr.forEach(f=>_add(typeof f==='string'?f:(f.fecha||f.date))); ok=true; break }catch(_){}
    }
    if(!ok){/* sin feriados de ese año: el helper usará solo fin de semana */}
  }
}

// Al cargar/emitir una factura: si existe EXACTAMENTE UNA programada equivalente del mismo cliente,
// monto con TOLERANCIA (±5%) y vencimiento dentro de la ventana, se elimina para no duplicar en "Por facturar".
// La tolerancia es clave para las recurrentes en UF: la programada se genera al UF de la venta y la factura
// real se emite al UF del mes → casi nunca calzan al peso. Sin tolerancia, cada mes quedaba un duplicado.
// Criterio conservador: si hay 0 o >1 candidatas (empate temporal), no toca nada (queda el botón manual "Ya emitida").
// Ordinal de cuota sin total ("cuota 1", "cobro 2", "pago 3"): identifica la cuota DENTRO de una misma venta cuando el concepto no trae "N/M".
export const cuotaOrdOf = c => { const m=String(c||'').toLowerCase().match(/\b(?:cuota|cobro|pago)\s*n?[°º]?\s*(\d{1,2})\b/); return m?+m[1]:null }

export async function reconcileProgramada(clientId, amount, issuedAt){
  try{
    if(!clientId || !amount || !issuedAt) return
    const {data} = await supabase.from('billing').select('id,due,amount').eq('client_id',clientId).eq('status','Programada')
    if(!data || !data.length) return
    // Monto con tolerancia ±5% (piso $1.000) + due dentro de ±45 días de la emisión: evita borrar una programada
    // lejana de otra venta del mismo cliente. La ventana temporal + el candado de empate hacen seguro el match difuso.
    const tol = Math.max(amount*0.05, 1000)
    const cands = data.filter(b=> b.due && Math.abs((b.amount||0)-amount) <= tol && Math.abs(new Date(b.due)-new Date(issuedAt))/86400000 <= 45)
      .map(b=>({...b, d:Math.abs(new Date(b.due)-new Date(issuedAt))/86400000})).sort((a,b)=>a.d-b.d)
    if(!cands.length) return
    // Empate temporal: si dos candidatas quedan casi igual de cerca (±7 días), es ambiguo → no tocar nada (queda el botón manual "Ya emitida").
    if(cands[1] && (cands[1].d - cands[0].d) <= 7) return
    // Soft-delete (no borrado físico) para que sea reversible desde la Papelera si reconcilió la cuota equivocada.
    // Deja registrado QUÉ factura la reemplaza (replaced_by_id): así el trigger de la base le pasa sus comisiones de proveedores.
    let realId=null
    try{ const {data:r}=await supabase.from('billing').select('id,amount').eq('client_id',clientId).is('deleted_at',null).neq('status','Programada').eq('issued_at',String(issuedAt).slice(0,10)).order('created_at',{ascending:false}).limit(5)
      realId=(r||[]).find(x=>Math.abs((Number(x.amount)||0)-amount)<=1)?.id||null }catch(_){}
    await supabase.from('billing').update({deleted_at:new Date().toISOString(),...(realId?{replaced_by_id:realId}:{})}).eq('id',cands[0].id)
  }catch(e){registrarError({origen:'accion',vista:'billing',err:e})}
}

export function rutsDeFactura(b, clients=[], clientEntities=[]){ const nr=r=>(r||'').toString().replace(/[.\s-]/g,'').toUpperCase(); const s=new Set(); const add=r=>{const n=nr(r);if(n)s.add(n)}; add(b.receptor_rut); const e=clientEntities.find(x=>String(x.id)===String(b.entity_id)); if(e)add(e.rut); const c=clients.find(x=>String(x.id)===String(b.client_id)); if(c)add(c.rut); clientEntities.filter(x=>String(x.client_id)===String(b.client_id)).forEach(x=>add(x.rut)); return s }

export function matchProgEmitidas(billing=[], clients=[], clientEntities=[], opts={}){
  const noSet = opts.noSet||new Set()
  const act = (billing||[]).filter(b=>!b.deleted_at && b.status!=='Anulada')
  // Nº de cuotas vivas por venta: dos cuotas DISTINTAS de la misma venta se parecen en monto (hermanas) → el match por RUT/monto
  // suelto las confunde (ej. la 2ª cuota con la factura de la 1ª). Para una venta de >1 cuota, el monto solo NO identifica cuota.
  const cuotasPorVenta={}; act.forEach(b=>{ if(b.sale_id) cuotasPorVenta[String(b.sale_id)]=(cuotasPorVenta[String(b.sale_id)]||0)+1 })
  const emisAll = act.filter(b=> b.issued_at && b.status!=='Programada' && (b.billing_type||'')!=='reembolso' && /\d/.test(String(b.invoice_no||'').replace(/^factura\s*/i,'')))
    .map(x=>({x,cu:cuotaNMof(x.concept),per:concPeriodoOf(x.concept),ruts:rutsDeFactura(x,clients,clientEntities),t:new Date((x.issued_at||x.due||'')+'T12:00').getTime()}))
  const progs = act.filter(b=>b.status==='Programada'&&b.amount&&(b.billing_type||'')!=='reembolso')
    .map(p=>({p,cu:cuotaNMof(p.concept),per:concPeriodoOf(p.concept),ruts:rutsDeFactura(p,clients,clientEntities),pt:p.due?new Date(p.due+'T12:00').getTime():null}))
    .sort((a,b)=>(a.p.due||a.p.issued_at||'').localeCompare(b.p.due||b.p.issued_at||''))
  const usados=new Set(); const out=[]
  progs.forEach(({p,cu,per,ruts,pt})=>{ const a=p.amount||0; if(!a) return; let best=null,bestRank=null
    // CHEQUEO PREVIO (clientes recurrentes): una programada recurrente (mensual/permanente o con período en el concepto) se
    // factura IGUAL o MUY PARECIDA mes a mes → el match POR MONTO no puede distinguir el mes (ligaba una programada de julio con
    // la factura de mayo/junio). Para ellas se PROHÍBE la rama por RUT/monto: solo período (YYYY-MM) o cuota N/M identifican el mes.
    // Doble red: además si hay más de una emitida de monto similar, también es ambiguo.
    const esRecurrente = !!per || !!cu || /\bmensual\b|\bpermanente\b/i.test(String(p.concept||''))   // secuencia (período, cuota N/M o mensual/permanente) → nunca automático (orden/mes lo pone el humano en el cotejo)
    const similar = emisAll.filter(e => (String(e.x.client_id)===String(p.client_id)||[...e.ruts].some(r=>ruts.has(r))) && a>0 && Math.abs((e.x.amount||0)-a)/a<=0.05)
    // RECURRENTE (mensual/permanente/con período) o AMBIGUO (>1 factura similar) → NUNCA se auto-empareja: no se puede saber el
    // mes con certeza (mes vencido + montos iguales mes a mes + etiquetas desfasadas). Se resuelve a mano en el cotejo del SII
    // (que acota por período). Aquí NO generamos "Ya emitida" para evitar ligar julio con mayo/junio (caso Daniel Abragan).
    if(esRecurrente || similar.length>1) return
    for(const e of emisAll){ if(usados.has(e.x.id)||noSet.has(`${p.id}|${e.x.id}`)) continue
      const sameCli=String(e.x.client_id)===String(p.client_id); const rutMatch=[...e.ruts].some(r=>ruts.has(r)); if(!sameCli&&!rutMatch) continue
      const dMonto=Math.abs((e.x.amount||0)-a)/a; const sameCu=!!(cu&&e.cu&&cu.n===e.cu.n), samePer=!!(per&&e.per&&per===e.per); const dias=(pt&&e.t)?Math.abs(e.t-pt)/86400000:999
      // Solo llegan aquí las NO recurrentes y únicas: cuota N/M (mismo período o ≤75d), período exacto, o RUT/monto con ventana ≤45d.
      // Mismo-venta con plan de >1 cuota: PROHIBIR el match por RUT/monto suelto (son cuotas hermanas de monto parecido).
      // Solo período o cuota N/M pueden emparejarlas dentro de una misma venta (un verdadero duplicado trae esa etiqueta).
      const sameSaleMulti = p.sale_id && String(e.x.sale_id)===String(p.sale_id) && (cuotasPorVenta[String(p.sale_id)]||0)>1
      const okCu=sameCu&&dMonto<=0.25&&(samePer||dias<=75), okPer=samePer&&dMonto<=0.06, okRut=(rutMatch||sameCli)&&dMonto<=0.05&&dias<=45&&!sameSaleMulti
      // Misma venta + mismo ordinal ('Cobro 1' ↔ 'cuota 1') + monto ±6%: es su factura aunque el concepto no traiga 'N/M'.
      const oP=cuotaOrdOf(p.concept), oE=cuotaOrdOf(e.x.concept), okOrd=!!(p.sale_id&&String(e.x.sale_id)===String(p.sale_id)&&oP&&oE&&oP===oE&&dMonto<=0.06)
      if(!okCu&&!okPer&&!okRut&&!okOrd) continue
      const rank=[okCu?0:1, okPer?0:1, dMonto, dias]
      if(!best||rank[0]<bestRank[0]||(rank[0]===bestRank[0]&&(rank[1]<bestRank[1]||(rank[1]===bestRank[1]&&(rank[2]<bestRank[2]||(rank[2]===bestRank[2]&&rank[3]<bestRank[3])))))){ best=e; bestRank=rank } }
    if(best){ usados.add(best.x.id); const dM=Math.abs((best.x.amount||0)-a)/a; const raz=[]
      if(cu&&best.cu&&cu.n===best.cu.n) raz.push(`cuota ${cu.n}${cu.tot?'/'+cu.tot:''}`); else if(per&&best.per&&per===best.per) raz.push(`período ${per.slice(5)}-${per.slice(0,4)}`); else if(cuotaOrdOf(p.concept)&&cuotaOrdOf(p.concept)===cuotaOrdOf(best.x.concept)) raz.push(`cuota ${cuotaOrdOf(p.concept)} de la misma venta`); else raz.push('mismo RUT/RS')
      raz.push(dM<0.01?'mismo monto':`dif ${(dM*100).toFixed(1).replace(/\.0$/,'')}% (UF)`)
      out.push({prog:p, real:best.x, razones:raz}) } })
  return out
}

// ─── Corrimiento automático de cuotas Programadas no facturadas ───
// Una cuota Programada (sin folio) cuyo mes de devengo ya PASÓ sin emitirse rueda al mes de facturación en curso,
// preservando el día pactado. Dentro de una misma venta NO puede haber dos cuotas el mismo mes: si chocan, la de
// más atrás empuja a la siguiente (una por mes, en cascada). También salta los meses ya ocupados por emitidas.
// Cálculo PURO — no muta la base; la fecha real se estampa recién al emitir (handleEmitirProgramada). refISO = hoy.
// Devuelve Map<billing.id, dueEfectivoISO> SOLO de las cuotas que efectivamente se movieron.
export function rolledDueMap(billing, refISO){
  const ref = String(refISO||new Date().toISOString().slice(0,10)).slice(0,7)   // YYYY-MM del mes de corte (hoy)
  const out = new Map()
  const bySale = new Map()
  ;(billing||[]).forEach(b=>{
    if(!b || b.deleted_at || b.billing_type==='reembolso') return
    const sid = b.sale_id ? String(b.sale_id) : ('solo:'+b.id)
    const arr = bySale.get(sid); if(arr) arr.push(b); else bySale.set(sid,[b])
  })
  const monthOf = b => String(b.due||b.issued_at||'').slice(0,7)
  const dayOf = b => Number(String(b.due||b.issued_at||'').slice(8,10))||1
  const addMonths = (ym,n)=>{ const p=ym.split('-'); let y=+p[0], m=(+p[1]-1)+n; y+=Math.floor(m/12); m=((m%12)+12)%12; return `${y}-${String(m+1).padStart(2,'0')}` }
  const clampDue = (ym, day) => { const p=ym.split('-'); const last=new Date(+p[0], +p[1], 0).getDate(); return `${ym}-${String(Math.min(day||1,last)).padStart(2,'0')}` }
  for(const [,arr] of bySale){
    const emitida = b => !!(b.invoice_no||b.folio)
    const progs = arr.filter(b=> b.status==='Programada' && !emitida(b) && monthOf(b))
    for(const b of progs){
      // SOLO las ATRASADAS (mes de devengo ya pasado) ruedan al mes de corte, para que aparezcan a emitir.
      // Las de ESTE mes o futuras respetan su fecha pactada — NO se empujan hacia adelante. (La vieja cascada
      // "una por mes" escondía las 2ª cuotas del mismo mes y las atrasadas, rodándolas a meses futuros.)
      if(monthOf(b) < ref) out.set(String(b.id), clampDue(ref, dayOf(b)))
    }
  }
  return out
}

// Razón social a la que se emitió una factura (FUENTE ÚNICA, canon factura-rs-cruce-rut):
// entity_id → cruce por receptor_rut ↔ client_entities → receptor_name del DTE → única RS del cliente.
// Reutilizado por Facturación (ChecklistFacturacion) y Cobranza para no duplicar la lógica.
export const rsDeFactura = (b, clientEntities=[]) => {
  if(!b) return null
  if(b.entity_id){ const e=(clientEntities||[]).find(x=>String(x.id)===String(b.entity_id)); if(e) return e.name }
  if(b.receptor_rut){ const k=crNormRut(b.receptor_rut); if(k){ const e=(clientEntities||[]).find(x=>crNormRut(x.rut)===k); if(e) return e.name } }
  if(b.receptor_name) return b.receptor_name
  const ents=(clientEntities||[]).filter(e=>String(e.client_id)===String(b.client_id))
  if(ents.length===1) return ents[0].name
  return null
}

export const currentMonth = new Date().getMonth()+1
cargarFeriadosCL().catch(()=>{})   // carga los feriados de Chile (para el "último día hábil" del vencimiento); no bloquea

// Facturado SII (DEVENGADO) de un período: SOLO facturas con DTE real (dte_xml not null) — el único facturado que reconoce el SII.
// ym con 7 chars = un mes (AAAA-MM); con 4 = un año (AAAA). Fuente única del ingreso devengado (protagonista de Oficina · Estado de resultados).
// Tipo de factura (FUENTE ÚNICA): honorarios (de una venta) · reembolso = «Gastos» (respaldo de un reembolso, no es ingreso) ·
// comision (comisión que otro estudio nos paga: 100% nuestra, sin venta; socio = el que la generó) · externo (facturamos por un
// externo y retenemos un %; nuestro ingreso = amount − monto_terceros) · subarriendo (Oficina) · nota_credito.
export const TIPOS_FACTURA = [
  {k:'honorarios', t:'Honorarios', col:C.accent},
  {k:'reembolso', t:'Gastos', col:C.azulInfo},
  {k:'comision', t:'Comisión', col:C.tealText},
  {k:'externo', t:'Por externo', col:C.soonText},
  {k:'subarriendo', t:'Subarriendo', col:C.grisText},
]

export const tipoFacturaLbl = b => (TIPOS_FACTURA.find(x=>x.k===tipoFactura(b))||{t:'Nota de crédito'}).t

export const fInp = {width:'100%',border:'none',background:'none',outline:'none',fontSize:14,color:C.text,padding:0,height:24,boxSizing:'border-box'}

export const WHO_LIST = ['Cristóbal','Martín','Martina','Erasmo']

export const restoreScroll = (s) => { try{ window.scrollTo(0, s?.w||0); const d=document.getElementById('main-scroll'); if(d) d.scrollTop=s?.d||0 }catch(_){} }

// Checklist de facturación del mes: lista de programadas + emitidas con vencimiento en el mes elegido.
// Marcar = emitir (Programada -> Pendiente); desmarcar = volver a Programada. KPIs en vivo.
// Factura emitida SIN CLIENTE ('cli') o SIN VENTA ('vta') — FUENTE ÚNICA de la tarjeta "Facturas sin cliente / venta" y de su vista.
// Solo la vida de la app (desde 2026-06-06): lo anterior es histórico y se resuelve una vez, no queda pendiente para siempre.
export function catSinClienteVenta(b, tercerosByBilling){
  if(!b||b.deleted_at||!(b.invoice_no||b.folio)||b.status==='Anulada'||b.billing_type==='reembolso') return null
  if(String(b.issued_at||b.due||'').slice(0,10)<'2026-06-06') return null
  if(!b.client_id) return 'cli'
  // Comisión, por externo y subarriendo no van con venta: ya están clasificadas.
  if(!b.sale_id&&!['comision','externo','subarriendo','nota_credito'].includes(b.billing_type)&&!(tercerosByBilling&&tercerosByBilling.has(b.id))&&['Pendiente','Vencido','Pagado'].includes(b.status)) return 'vta'
  return null
}

export const MESES_LG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// ── Venta de una factura sin venta: UNA sola forma de asignarla (Bandeja, Facturación › Por clasificar y ficha del cliente).
// Asignar = la factura toma la venta (y su razón social si no tenía); cada cuota elegida queda reemplazada por ella (soft-delete
// + replaced_by_id: el trigger le pasa sus comisiones; reversible desde la Papelera). Libera las cuotas cubiertas provisoriamente
// (cuota_no_emitir «cubierta:<factura>»), cierra la propuesta de la Bandeja y APRENDE: learnings venta_factura (clave → venta,
// hits = confirmaciones) y venta_factura_no (la venta sugerida que no correspondía). Con 2 confirmaciones y cuotas que calzan,
// facturas-sii-registrar la asigna sola. Todo cambio de billing avisa a la app para recargar (avisarBillingCambio).
export const _billingCambio=new Set()

export const avisarBillingCambio=()=>{ _billingCambio.forEach(f=>{ try{ f() }catch(_){} }) }

export let _ventaAprP=null

export function useVentaAprendida(){
  const [m,setM]=useState(()=>({si:{},no:{}}))
  useEffect(()=>{ if(DEMO) return; if(!_ventaAprP) _ventaAprP=supabase.from('learnings').select('kind,key,hits').in('kind',['venta_factura','venta_factura_no']).then(({data})=>{ const o={si:{},no:{}}
      ;(data||[]).forEach(r=>{ const i=String(r.key).lastIndexOf('>'); if(i<0) return; const cl=r.key.slice(0,i), sid=r.key.slice(i+1), t=r.kind==='venta_factura'?o.si:o.no; (t[cl]=t[cl]||{})[sid]=Math.max(Number(r.hits)||1,1) }); return o },()=>({si:{},no:{}}))
    let v=true; _ventaAprP.then(x=>{ if(v) setM(x) }); return ()=>{v=false} },[])
  return m
}

export async function aprenderVenta(kind,clave,saleId){
  if(DEMO||!clave||!saleId) return
  const key=`${clave}>${saleId}`
  const {data}=await supabase.from('learnings').select('id,hits').eq('kind',kind).eq('key',key).limit(1)
  if(data&&data.length) await supabase.from('learnings').update({hits:(Number(data[0].hits)||1)+1,value:String(saleId),updated_at:new Date().toISOString()}).eq('id',data[0].id)
  else await supabase.from('learnings').insert({kind,key,value:String(saleId),hits:1})
  _ventaAprP=null
}

export async function asignarVentaFactura({facturaId, saleId, cuotaIds=[], sugerida=null, venta=''}){
  if(!facturaId||!saleId) throw new Error('Falta la factura o la venta.')
  const ids=(cuotaIds||[]).map(String)
  if(DEMO) return {folio:null}
  const [{data:f},{data:cs}]=await Promise.all([supabase.from('billing').select('id,client_id,sale_id,entity_id,deleted_at,status,invoice_no,concept,receptor_rut').eq('id',facturaId).maybeSingle(), ids.length?supabase.from('billing').select('id,sale_id,entity_id,status,deleted_at,invoice_no').in('id',ids):Promise.resolve({data:[]})])
  if(!f||f.deleted_at||f.status==='Anulada') throw new Error('La factura ya no está vigente.')
  if(f.sale_id&&String(f.sale_id)!==String(saleId)) throw new Error('La factura ya tiene otra venta asignada.')
  const vivas=(cs||[]).filter(c=>!c.deleted_at&&c.status==='Programada'&&!c.invoice_no&&String(c.sale_id)===String(saleId))
  if(vivas.length!==ids.length) throw new Error('Alguna de las cuotas ya no está programada en esa venta. Vuelve a elegirlas.')
  const now=new Date().toISOString()
  const ent=f.entity_id||vivas.find(c=>c.entity_id)?.entity_id||null
  const {error:e1}=await supabase.from('billing').update({sale_id:saleId,...(ent&&!f.entity_id?{entity_id:ent}:{}),updated_at:now}).eq('id',f.id); if(e1) throw e1
  if(ids.length){ const {error:e2}=await supabase.from('billing').update({deleted_at:now,replaced_by_id:f.id}).in('id',ids); if(e2) throw e2 }
  await supabase.from('learnings').delete().eq('kind','cuota_no_emitir').eq('value',`cubierta:${f.id}`)
  const clave=claveVentaFactura(f)
  try{ await aprenderVenta('venta_factura',clave,saleId); if(sugerida&&String(sugerida)!==String(saleId)) await aprenderVenta('venta_factura_no',clave,sugerida) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
  const folio=folioN(f.invoice_no)||f.invoice_no
  const motivo=`Factura N° ${folio} asignada a «${venta||'la venta'}»${ids.length?` · reemplaza ${ids.length} cuota${ids.length!==1?'s':''}`:''}`
  try{ await supabase.from('agente_bandeja').update({estado:'registrado',motivo,resuelto_at:now}).eq('tipo','factura_sin_venta').eq('estado','pendiente').eq('propuesta->>billing_id',String(f.id)) }catch(e){registrarError({origen:'accion',vista:'agente_bandeja',err:e})}
  logActividad('facturacion.venta_asignada',{tabla:'billing',id:f.id,detalle:{title:motivo,venta:saleId,cuotas:ids}})
  avisarBillingCambio()
  return {folio,motivo}
}

// Asignar la venta de UNA factura sin venta: sugerida arriba (lo aprendido o las cuotas que suman su monto), las demás ventas
// del cliente con su contexto, y al elegir una se marcan las cuotas que reemplaza (editables). Confirmación en línea.
export function AsignarVentaFactura({factura, sales=[], billing=[], onHecho}){
  const apr=useVentaAprendida()
  const [elegida,setElegida]=useState(null), [sel,setSel]=useState(()=>new Set()), [conf,setConf]=useState(null), [busy,setBusy]=useState(false), [verOtras,setVerOtras]=useState(false), [verCerr,setVerCerr]=useState(false)
  const monto=Math.abs(montoFactura(factura)||Number(factura.amount)||0)
  const clave=claveVentaFactura(factura)
  const sugs=useMemo(()=>sugerirVentas({factura:{...factura,amount:monto},sales,billing,aprendidas:apr.si[clave]||{},rechazadas:Object.keys(apr.no[clave]||{})}),[factura,sales,billing,apr,clave,monto])
  const top=sugs[0]&&!sugs[0].rechazada&&(sugs[0].motivo==='aprendida'||(sugs[0].motivo==='cuotas'&&sugs[0].cuotas.length))?sugs[0]:null
  const uf=ufFechaCache()||{}
  const etq=b=>{ const c=cuotaNMof(b.concept); return `${c?`Cuota ${c.n}/${c.tot}`:'Cuota'} · vence ${fmtFechaDMY(b.due)}` }
  const contexto=g=>{ const bs=(billing||[]).filter(b=>b&&!b.deleted_at&&String(b.sale_id)===String(g.sale.id)); const cv=coberturaVenta(g.sale,bs,uf); const partes=[]
    if(g.mismaRS) partes.push('Misma razón social')
    if(g.progs.length){ const m0=Number(g.progs[0].amount)||0; partes.push(g.progs.every(x=>Number(x.amount)===m0)?`${g.progs.length} cuota${g.progs.length!==1?'s':''} de ${fmt(m0)} por facturar`:`${g.progs.length} cuotas por facturar`) }
    else if(cv&&cv.ok&&cv.plan-cv.usado>(cv.enUF?0.5:1000)) partes.push(`por facturar ${cv.enUF?fmtUF(Math.round((cv.plan-cv.usado)*10)/10):fmt(cv.plan-cv.usado)} · sin cuotas programadas`)
    else partes.push('sin cuotas programadas')
    return partes.join(' · ') }
  const elegir=g=>{ setElegida(g); setSel(new Set(cuotasQueReemplaza(g.progs,monto).cuotas.map(c=>String(c.id)))); setConf(null) }
  const ejecutar=async(g,ids)=>{ setBusy(true)
    try{ const r=await asignarVentaFactura({facturaId:factura.id,saleId:g.sale.id,cuotaIds:ids,sugerida:top?.sale.id||null,venta:g.sale.title})
      onHecho&&onHecho({sale:g.sale,cuotaIds:ids,motivo:r?.motivo}) }
    catch(e){ appAlert('No se pudo asignar: '+(e.message||e)) }
    setBusy(false); setConf(null) }
  const pedir=(g,ids)=>setConf({g,ids,label:`Asignar la factura N° ${folioN(factura.invoice_no)||factura.invoice_no} a «${g.sale.title}»${ids.length?` y reemplazar ${ids.length} cuota${ids.length!==1?'s':''}`:' sin reemplazar cuotas'}.`})
  const lnS={display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginTop:5}, lnL={color:C.textSoft,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}, lnV={color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',fontWeight:700}
  const bS={fontSize:12.5,fontWeight:600,color:C.accent,background:'none',border:'none',padding:'7px 8px',cursor:'pointer'}, bP={fontSize:12.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:9,padding:'7px 14px',cursor:'pointer',whiteSpace:'nowrap'}
  const difTxt=d=>d?`Diferencia ${fmt(Math.abs(d))}`:'Mismo monto'
  const confirmBox=conf&&<div style={{marginTop:10,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
    <div style={{flex:'1 1 160px',minWidth:0,fontSize:12,color:C.text,lineHeight:1.4}}>{conf.label}</div>
    <div style={{display:'flex',gap:6,marginLeft:'auto'}}><button disabled={busy} onClick={()=>setConf(null)} style={bS}>Cancelar</button><button disabled={busy} onClick={()=>ejecutar(conf.g,conf.ids)} style={{...bP,opacity:busy?.6:1}}>{busy?'Guardando…':'Confirmar'}</button></div></div>
  const otras=sugs.filter(g=>g!==top)
  // Ventas cerradas del cliente: solo a pedido (una factura tardía de un trabajo ya terminado). Mismo cálculo de cuotas.
  const cerradas=useMemo(()=>{ const cs=(sales||[]).filter(x=>x&&!x.deleted_at&&String(x.client_id)===String(factura.client_id)&&x.status!=='Activo'); return cs.length?sugerirVentas({factura:{...factura,amount:monto},sales:cs.map(x=>({...x,status:'Activo'})),billing}).map(g=>({...g,sale:{...g.sale,status:cs.find(x=>x.id===g.sale.id)?.status},motivo:null})):[] },[factura,sales,billing,monto])
  const filaVenta=g=><div key={g.sale.id} onClick={()=>elegir(g)} style={{display:'flex',alignItems:'center',gap:10,background:'#fff',border:`1px solid ${C.border}`,borderRadius:9,padding:'8px 10px',cursor:'pointer'}}>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.sale.title}{g.sale.status&&g.sale.status!=='Activo'?<span style={{fontWeight:500,color:C.textSoft}}> · cerrada</span>:null}</div><div style={{fontSize:11,color:C.textSoft,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{contexto(g)}</div></div>
    <span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>Elegir</span></div>
  const linkCerr=cerradas.length>0&&!verCerr&&<span onClick={()=>setVerCerr(true)} style={{fontSize:11,color:C.azulInfo,fontWeight:600,cursor:'pointer',padding:'2px 0'}}>Ver también cerradas ({cerradas.length})</span>
  if(!sugs.length&&!verCerr) return <div onClick={e=>e.stopPropagation()} style={{fontSize:11.5,color:C.muted,marginTop:10,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><span>Este cliente no tiene ventas activas. Abre su ficha para crear una.</span>{linkCerr}</div>
  return <div onClick={e=>e.stopPropagation()}>
    {top&&!elegida&&<div style={{marginTop:10,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:11,padding:'10px 12px'}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.greenText,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}><span style={{background:C.greenBg,borderRadius:20,padding:'1px 8px'}}>Sugerida</span>{top.motivo==='aprendida'?'asignada antes a esta venta':`${top.cuotas.length} cuota${top.cuotas.length!==1?'s':''} ${top.cuotas.length!==1?'suman':'calza con'} el monto`}</div>
      <div style={{fontSize:13.5,fontWeight:700,color:C.accent,marginTop:4}}>{top.sale.title}</div>
      {top.cuotas.map(c=><div key={c.id} style={lnS}><span style={lnL}>{etq(c)}</span><b style={lnV}>{fmt(c.amount)}</b></div>)}
      {top.cuotas.length>0&&<div style={{fontSize:11,color:C.textSoft,marginTop:5}}>{difTxt(top.dif)}</div>}
      {!conf&&<div style={{display:'flex',justifyContent:'flex-end',gap:6,marginTop:9,flexWrap:'wrap'}}><button onClick={()=>setVerOtras(v=>!v)} style={bS}>Otra venta</button><button onClick={()=>pedir(top,top.cuotas.map(c=>String(c.id)))} style={bP}>Asignar</button></div>}
      {confirmBox}
    </div>}
    {(!top||verOtras||verCerr)&&!elegida&&<div style={{marginTop:9,borderTop:top?`1px solid ${C.border}`:'none',paddingTop:top?9:0,display:'flex',flexDirection:'column',gap:6}}>
      {(top?otras:sugs).map(filaVenta)}
      {verCerr&&cerradas.map(filaVenta)}
      {linkCerr}
    </div>}
    {elegida&&(()=>{ const ids=[...sel], suma=elegida.progs.filter(c=>sel.has(String(c.id))).reduce((a,c)=>a+(Number(c.amount)||0),0)
      return <div style={{marginTop:10,background:'#fff',border:`1px solid ${C.border}`,borderRadius:11,padding:'10px 12px'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{flex:1,minWidth:0,fontSize:13.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{elegida.sale.title}</div><span onClick={()=>{setElegida(null);setConf(null)}} style={{fontSize:11.5,color:C.accent,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Cambiar</span></div>
        {elegida.progs.length?<div style={{marginTop:6}}>{[...elegida.progs].sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))).map((c,i)=>{ const on=sel.has(String(c.id))
          return <div key={c.id} onClick={()=>setSel(p=>{ const n=new Set(p); on?n.delete(String(c.id)):n.add(String(c.id)); return n })} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'6px 2px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <span style={{width:16,height:16,borderRadius:4,border:`1.5px solid ${on?C.accent:C.muted}`,background:on?C.accent:'#fff',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,flexShrink:0}}>{on?'✓':''}</span>
            <span style={{flex:1,minWidth:0,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{etq(c)}</span><span style={{fontVariantNumeric:'tabular-nums',color:C.text,fontWeight:600}}>{fmt(c.amount)}</span></div> })}
          <div style={{...lnS,borderTop:`1px solid ${C.border}`,paddingTop:6,marginTop:4}}><span style={lnL}>Cuotas marcadas</span><b style={lnV}>{fmt(suma)}</b></div>
          {ids.length>0&&<div style={{fontSize:11,color:C.textSoft,marginTop:5}}>{difTxt(Math.round(suma-monto))}</div>}
        </div>:<div style={{fontSize:11.5,color:C.textSoft,marginTop:5}}>{contexto(elegida)}</div>}
        {!conf&&<div style={{display:'flex',justifyContent:'flex-end',gap:6,marginTop:9,flexWrap:'wrap'}}>{ids.length>0&&<button onClick={()=>pedir(elegida,[])} style={bS}>Sin reemplazar cuotas</button>}<button onClick={()=>pedir(elegida,ids)} style={bP}>{ids.length?`Asignar y reemplazar ${ids.length} cuota${ids.length!==1?'s':''}`:'Asignar'}</button></div>}
        {confirmBox}
      </div> })()}
  </div>
}

// Cuotas marcadas «No corresponde» (learnings cuota_no_emitir): la misma marca que silencia el radar de Facturación.
export let _noEmitirP=null

export function useNoEmitirSet(){
  const [s,setS]=useState(()=>new Set())
  useEffect(()=>{ if(DEMO) return; if(!_noEmitirP) _noEmitirP=supabase.from('learnings').select('key').eq('kind','cuota_no_emitir').then(({data})=>new Set((data||[]).map(r=>String(r.key))),()=>new Set())
    let v=true; _noEmitirP.then(x=>{ if(v) setS(x) }); return ()=>{v=false} },[])
  return s
}

// Flujo de caja proyectado, semana a semana: entra (cobros esperados + programadas) vs sale (costos de oficina + proveedores). Marca la semana apretada.
// FLUJO DE CAJA PROYECTADO POR CLIENTE — fuente única de la página Flujo de caja y de la tarjeta de Inicio (aprobado 09-10-2026).
// · Ritmo del cliente = mediana de días emisión→pago de sus últimas 12 facturas pagadas (0..365); con <3 pagadas, la mediana del estudio (último año).
// · Emitida pendiente: entra en emisión + ritmo (o esta semana si ya pasó). Si lleva más de FLUJO_DUDA_DIAS sobre su ritmo → «en duda», fuera del flujo.
// · Programada: si vencía en un mes anterior al actual → «sin emitir», fuera del flujo; si no, entra en max(vencimiento, hoy) + ritmo.
// · Comisión por pagar: cuota ya pagada → esta semana; ligada a una cuota → la misma semana de su cuota (fuera, si su cuota está fuera);
//   sin cuota pero con venta → repartida entre las cuotas pendientes de esa venta; sin nada → «sin cuota» (aviso para asignarla).
// · Oficina = presupuesto mensual (costosOficinaMes) ÷ 4,33 por semana.
// Cuotas programadas que YA están cubiertas por su propia venta (fuente única para el flujo y el radar «sin facturar»).
// Por venta activa: lo facturado (DTE emitidos de la venta) + cuotas anticipadas + programadas abiertas no puede superar el
// total acordado. Si lo supera, el exceso cubre las programadas más antiguas (FIFO): ya se facturaron con otro texto,
// otra fecha u otro plan. Cubierta ≥ 80% de la cuota → cubierta entera (diferencia de UF o de plan). En UF se convierte con
// la UF del día de cada documento (caché de mindicador); sin UF disponible no se infiere nada (no se esconde plata).
// Lo facturado de UNA venta medido en la moneda de su honorario (UF con la UF del día de cada documento). Fuente única para
// «cuotas cubiertas» (flujo/radar) y «cuotas sin generar» (Revisión): ambos comparan MONTOS contra el plan, nunca cuántas filas hay.
// null = no aplica (recurrente, sin plan) · ok:false = falta la UF de alguna fecha (no se infiere nada).
// La regla vive en _shared/ventasReglas.js (la usan también el resumen del lunes y el cierre de mes); aquí, con la UF en caché.
export const cuotasCubiertasVenta=(billing=[], sales=[], ufFechas=null)=>_cuotasCubiertasVenta(billing, sales, ufFechas||ufFechaCache()||{})

// ─── ANTICIPOS PANEL (tab Anticipos en Facturación, PP-15) ────────────────────
// Emitir una sola factura por el bloque de cuotas que cubrió un anticipo.
export function FacturarBloqueModal({anticipo,billing=[],sales=[],clients=[],onConfirm,onClose,asPage=false}) {
  const hoy = new Date().toISOString().slice(0,10)
  const [invoiceNo,setInvoiceNo] = useState('')
  const [issued,setIssued] = useState(hoy)
  const [busy,setBusy] = useState(false)
  const cliente = clients.find(c=>String(c.id)===String(anticipo.client_id))
  const cuotas = (billing||[]).filter(b=>String(b.prepaid_anticipo_id)===String(anticipo.id))
  const monto = cuotas.reduce((a,b)=>a+(b.amount||0),0)
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
  const fl={fontSize:10,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5,display:'block'}
  return (
    <div style={asPage?undefined:{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={asPage?undefined:(e=>e.target===e.currentTarget&&onClose())}>
      <div style={asPage?{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,width:'100%',maxWidth:560,margin:'0 auto',padding:18}:{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,padding:18,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        {!asPage&&<div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:3}}>Emitir una factura por el bloque</div>}
        <div style={{fontSize:12,color:C.textSoft,marginBottom:12}}>{cliente?.name||'Cliente'} · {cuotas.length} cuota{cuotas.length!==1?'s':''} anticipada{cuotas.length!==1?'s':''}</div>
        <div style={{textAlign:'center',fontSize:26,fontWeight:600,letterSpacing:'-.5px',color:C.text,marginBottom:14}}>{fmt(monto)}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <div><span style={fl}>N° Factura</span><input value={invoiceNo} onChange={e=>setInvoiceNo(e.target.value)} placeholder='367...' style={inp}/></div>
          <div><span style={fl}>Fecha emisión</span><input type='date' value={issued} onChange={e=>setIssued(e.target.value)} style={inp}/></div>
        </div>
        <div style={{fontSize:11,color:C.muted,marginBottom:14,lineHeight:1.4}}>Crea <strong style={{color:C.text}}>1 factura Pagada</strong> por el total con el anticipo; las cuotas quedan de referencia.</div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={busy} onClick={async()=>{ setBusy(true); const r=await onConfirm({invoice_no:invoiceNo.trim()||null,issued_at:issued}); setBusy(false); if(r) onClose() }} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:busy?'default':'pointer',opacity:busy?.6:1}}>{busy?'Emitiendo...':'Emitir factura'}</button>
        </div>
      </div>
    </div>
  )
}

// Cubrir cuotas programadas con un anticipo. Sugiere por monto (consume desde la 1ª) y se puede ajustar a mano.
export function CubrirCuotasModal({anticipo,sales=[],billing=[],clients=[],onConfirm,onClose,asPage=false}) {
  const cliente = clients.find(c=>String(c.id)===String(anticipo.client_id))
  const fmtDMY = fmtFechaDMY   // delega al helper global (evita la copia local divergente)
  const cuotas = (billing||[]).filter(b=>b.status==='Programada'&&b.billing_type!=='reembolso'&&(anticipo.sale_id?String(b.sale_id)===String(anticipo.sale_id):String(b.client_id)===String(anticipo.client_id)))
    .sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
  const autoSel = () => { const ids=new Set(); let acc=0; const m=anticipo.monto||0; for(const c of cuotas){ if(acc>=m) break; ids.add(c.id); acc+=c.amount||0 } return ids }
  const [sel,setSel] = useState(autoSel)
  const toggle = id => setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const sumSel = cuotas.filter(c=>sel.has(c.id)).reduce((a,c)=>a+(c.amount||0),0)
  const venta = sales.find(s=>String(s.id)===String(anticipo.sale_id))
  return (
    <div style={asPage?undefined:{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={asPage?undefined:(e=>e.target===e.currentTarget&&onClose())}>
      <div style={asPage?{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,width:'100%',maxWidth:560,margin:'0 auto'}:{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        <div style={{display:'flex',alignItems:'center',gap:9,padding:'16px 18px',borderBottom:`0.5px solid ${C.border}`}}>
          <div style={{minWidth:0}}>
            {!asPage&&<div style={{fontSize:16,fontWeight:600,color:C.text}}>Cubrir cuotas con anticipo</div>}
            <div style={{fontSize:12,color:C.textSoft}}>{cliente?.name||'Cliente'}{venta?.title?` · ${venta.title}`:''} · anticipo {fmt(anticipo.monto)}</div>
          </div>
          {!asPage&&<button onClick={onClose} style={{marginLeft:'auto',width:28,height:24,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
          </button>}
        </div>
        <div style={{padding:'14px 18px'}}>
          {cuotas.length===0?(
            <div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'20px 0'}}>No hay cuotas programadas {anticipo.sale_id?'en este proyecto':'de este cliente'} para cubrir.</div>
          ):(<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:10,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>Cuotas programadas</span>
              <button onClick={()=>setSel(autoSel())} style={{fontSize:11,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer'}}>Sugerir por monto</button>
            </div>
            <div style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:12}}>
              {cuotas.map(c=>{ const on=sel.has(c.id); return (
                <div key={c.id} onClick={()=>toggle(c.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:`0.5px solid ${C.border}`,background:on?C.greenBg:'#fff',cursor:'pointer'}}>
                  <span style={{width:16,height:16,borderRadius:4,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:on?`1.5px solid ${C.accent}`:`1.5px solid ${C.border}`,background:on?C.accent:'#fff'}}>
                    {on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                  </span>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.concept||'Cuota'}</div><div style={{fontSize:11,color:C.textSoft}}>Vence {fmtDMY(c.due)}</div></div>
                  <span style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(c.amount)}</span>
                </div>
              )})}
            </div>
            {(()=>{ const exc=sumSel>(anticipo.monto||0); const left=(anticipo.monto||0)-sumSel; return (
              <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Cubre <b style={{color:C.text}}>{fmt(sumSel)}</b> de {fmt(anticipo.monto)}{exc?<span style={{color:C.overdue}}> · excede el anticipo en {fmt(-left)} (quita cuotas)</span>:left>0&&sel.size>0?<span style={{color:C.normal}}> · el saldo de {fmt(left)} queda disponible</span>:null}</div>
            )})()}
          </>)}
          <div style={{display:'flex',gap:8}}>
            <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
            <button disabled={sel.size===0||sumSel>(anticipo.monto||0)} onClick={()=>onConfirm([...sel])} style={{flex:2,height:44,borderRadius:10,border:'none',background:(sel.size&&sumSel<=(anticipo.monto||0))?C.accent:C.done,color:'#fff',fontSize:13,fontWeight:600,cursor:(sel.size&&sumSel<=(anticipo.monto||0))?'pointer':'default'}}>Cubrir {sel.size>0?`${sel.size} cuota${sel.size!==1?'s':''}`:''}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const CUENTA_GASTOS_DEFAULT = { razon:BRAND.nombreLegal, rut:BRAND.rut, banco:BRAND.pago.gastos.banco, cuenta:BRAND.pago.gastos.cuenta, email:BRAND.pago.gastos.email }

// Recuadro de una cuenta bancaria (texto + HTML) con encabezado libre. ambar=true → estilo cuenta de gastos.
export const cuentaTxt = (header, cta) => `${header}:\n  ${cta.razon}\n  RUT: ${fmtRutCL(cta.rut)}\n  ${cta.banco} · Cuenta corriente ${cta.cuenta}\n  Confirmación a: ${cta.email}`

export const cuentaHtml = (header, cta, ambar=false) => `<div style="margin:14px 0;padding:12px 16px;background:${ambar?'#FAEEDA':'#F7F9FA'};border:1px solid ${ambar?'#F0C784':'#E4E8EB'};border-radius:8px;font-size:13px;line-height:1.7"><div style="color:${ambar?'#854F0B':'#537281'};font-weight:600;margin-bottom:3px">${header}</div><div>${cta.razon}</div><div><span style="color:#537281">RUT:</span> <b>${fmtRutCL(cta.rut)}</b></div><div><span style="color:#537281">${cta.banco} · Cuenta corriente:</span> <b>${cta.cuenta}</b></div><div><span style="color:#537281">Confirmación a:</span> ${cta.email}</div></div>`

// DATOS_PAGO (honorarios, header genérico) — usado por recordatorio de cobro y estado de cuenta. El correo de factura usa su propio header.
export const DATOS_PAGO_TXT = cuentaTxt('Datos para el pago (transferencia)', CUENTA_HONORARIOS)

export const DATOS_PAGO_HTML = cuentaHtml('Datos para el pago (transferencia)', CUENTA_HONORARIOS)

// Envío de una factura por correo. Reusa el motor de la rendición (driveToken + sendGmailWithPdf + firma).
// Plantilla genérica auto-rellenada + destinatarios de la ficha (contactos) + CC aprendido. PDF a mano por ahora (con la emisión DTE saldrá solo).
// Contenido del recordatorio de cobro — FUENTE ÚNICA (Facturación y ficha). Secuencia escalada (dunning) por días de mora:
// amable (al día) → firme (vencida ≤30d) → final (vencida >30d, anuncia gestiones de cobranza).
// Correo de recordatorio de cobro (FUENTE ÚNICA). `bs` = una factura o un arreglo (correo COMBINADO por cliente).
// Tono ÚNICO y amable (sin rojos), firmado por Administración con logo + pie de firma (mismo cascarón que las facturas).
// `nivel` se conserva solo para la cadencia y los mensajes del llamador; el TEXTO no escala nunca.
export function recordatorioCobro(bs, nota){
  const arr=(Array.isArray(bs)?bs:[bs]).filter(Boolean)
  const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const fm=n=>'$'+Math.round(n||0).toLocaleString('es-CL')
  const items=arr.map(b=>{ const _v=venceBill(b); const dl=daysLeftB(b)
    return { b, folio:folioN(b.invoice_no)||b.invoice_no||'—', monto:saldoBill(b)||b.amount||0, venc:_v?fmtFechaDMY(_v):'', diasVenc:(dl!=null&&dl<0)?-dl:0, concept:(b.concept||'').trim() } })
  const multi=items.length>1
  const total=items.reduce((a,x)=>a+x.monto,0)
  const maxDias=items.reduce((m,x)=>Math.max(m,x.diasVenc),0)
  const nivel=maxDias<=0?'amable':maxDias<=30?'firme':'final'   // solo cadencia/mensajes; el texto es amable siempre
  const fol=items.map(x=>`N° ${x.folio}`)
  const folStr=fol.length<=1?(fol[0]||'la factura'):fol.slice(0,-1).join(', ')+' y '+fol[fol.length-1]
  // Apertura amable: "hacer seguimiento" al pago pendiente (sin presumir olvido; frase retirada por pedido del usuario 2026-10-02).
  const aperturaHtml=multi
    ? `Espero que estén muy bien. Nos permitimos hacer seguimiento a los pagos pendientes de las <b>Facturas ${esc(folStr)}</b>, por un total de <b>${fm(total)}</b>, que a la fecha se encuentran pendientes.`
    : `Espero que estén muy bien. Nos permitimos hacer seguimiento al pago de la <b>Factura ${esc(fol[0])}</b> por <b>${fm(total)}</b>, que a la fecha se encuentra pendiente.`
  const aperturaTxt=multi
    ? `Espero que estén muy bien. Nos permitimos hacer seguimiento a los pagos pendientes de las Facturas ${folStr}, por un total de ${fm(total)}, que a la fecha se encuentran pendientes.`
    : `Espero que estén muy bien. Nos permitimos hacer seguimiento al pago de la Factura ${fol[0]} por ${fm(total)}, que a la fecha se encuentra pendiente.`
  // Tabla de facturas SOLO en combinado (folio · concepto · vence · monto). Sin rojos: paleta navy/gris.
  const tabla=multi
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #003C50;color:#537281;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px">Factura</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #003C50;color:#537281;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px">Vence</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #003C50;color:#537281;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px">Monto</th></tr></thead><tbody>${items.map(x=>`<tr><td style="padding:7px 8px;border-bottom:1px solid #E4E8EB">N° ${esc(x.folio)}${x.concept?`<div style="font-size:11px;color:#537281">${esc(x.concept)}</div>`:''}</td><td style="padding:7px 8px;border-bottom:1px solid #E4E8EB;color:#537281">${x.venc||'—'}</td><td style="padding:7px 8px;border-bottom:1px solid #E4E8EB;text-align:right;font-variant-numeric:tabular-nums">${fm(x.monto)}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2" style="padding:8px;font-weight:700">Total pendiente</td><td style="padding:8px;text-align:right;font-weight:700;color:#003C50;font-variant-numeric:tabular-nums">${fm(total)}</td></tr></tfoot></table>`
    : ''
  const cierre='Les agradeceremos gestionar su pago.'
  const despedida='Si ya realizaron el pago, por favor omitan este mensaje. Quedamos atentos a su confirmación. Muchas gracias.'
  // Nota libre por cliente (opcional): se antepone a la tabla; las cifras del cobro siguen generándose frescas.
  const notaTrim=String(nota||'').trim()
  const notaHtml=notaTrim?`<div style="font-size:14px;color:#3D3D3D;line-height:1.65;margin:0 0 14px">${esc(notaTrim).replace(/\n/g,'<br>')}</div>`:''
  const notaTxt=notaTrim?`\n\n${notaTrim}`:''
  const inner=`<div style="font-size:14px;color:#1a1a1a;margin:0 0 14px">Estimados,</div><div style="font-size:14px;color:#3D3D3D;line-height:1.65;margin:0 0 14px">${aperturaHtml}</div>${notaHtml}${tabla}<div style="font-size:14px;color:#3D3D3D;line-height:1.65;margin:0 0 4px">${cierre}</div>${DATOS_PAGO_HTML}<div style="font-size:13px;color:#537281;line-height:1.6;margin:14px 0 0">${despedida}</div><div style="font-size:14px;color:#3D3D3D;margin:16px 0 0">Saludos cordiales,</div>`
  const html=facturaCorreoShell(inner, {nombre:'Administración', cargo:BRAND.nombre}, 'es')
  const tablaTxt=multi ? '\n\n'+items.map(x=>`• N° ${x.folio}${x.concept?` (${x.concept})`:''} · vence ${x.venc||'—'} · ${fm(x.monto)}`).join('\n')+`\nTotal pendiente: ${fm(total)}` : ''
  const text=`Estimados,\n\n${aperturaTxt}${notaTxt}${tablaTxt}\n\n${cierre}\n\n${DATOS_PAGO_TXT}\n\n${despedida}\n\nSaludos cordiales,\nAdministración`
  const subject=multi?`Recordatorio de pago — Facturas ${folStr}`:`Recordatorio de pago — Factura ${fol[0]}`
  return { nivel, folio:multi?`Facturas ${folStr}`:`Factura ${fol[0]}`, monto:fm(total), subject, html, text, items }
}

export async function facturaPdfAdjunto(b){
  try{ const doc=splitSetDTE(b?.dte_xml||'')[0]; if(!doc) return null
    const r=await facturaDtePdfBase64(doc)
    return { base64:r.base64, name:`Factura ${folioN(b.invoice_no)||r.folio||''}.pdf`, mime:'application/pdf' }
  }catch(_){ return null }
}

// Genera el PDF con timbre de una factura (desde su DTE) y lo abre en una pestaña para revisarlo.
// Nombre canónico del archivo de factura: IDÉNTICO al que se guarda en Drive (ver subirFacturaADrive/adjuntarRespaldoDrive),
// para que descargar desde la ficha no obligue a renombrar. "Factura N° - Cliente.pdf".
export function facturaNombreArchivo(r){ const rz=String(r?.rznR||'').replace(/[\/\\:*?"<>|]/g,'').replace(/\s+/g,' ').trim().slice(0,45); return 'Factura '+(r?.folio||'')+(rz?' - '+rz:'')+'.pdf' }

export function descargarPdfU8(u8,nombre){ const url=URL.createObjectURL(new Blob([u8],{type:'application/pdf'})); const a=document.createElement('a'); a.href=url; a.download=nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000) }

export async function verFacturaPdf(b){
  try{
    const doc=splitSetDTE(b?.dte_xml||'')[0]
    if(!doc){ appAlert('Esta factura no tiene XML del SII para generar el PDF.'); return }
    const r=await facturaDtePdfBase64(doc)
    const bin=atob(r.base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i)
    descargarPdfU8(u8, facturaNombreArchivo(r))
  }catch(e){ appAlert('No se pudo abrir el PDF.') }
}

// Resuelve la MEJOR venta/proyecto para una factura: la vinculada (sale_id); si no, la única venta del cliente (o su única Activa).
// Así la glosa siempre muestra lo más robusto disponible aunque la factura no esté vinculada a su venta.
export const ventaNombre = s => (s?.title||s?.name||'').trim()   // el nombre del proyecto de la venta vive en `title` (SaleForm), con `name` de respaldo

export function mejorVenta(factura, sales, clientId){
  const list = sales||[]
  const direct = factura?.sale_id!=null ? list.find(s=>String(s.id)===String(factura.sale_id)) : null
  if(direct && ventaNombre(direct)) return direct
  const cs = list.filter(s=>String(s.client_id)===String(clientId||'') && ventaNombre(s))
  if(cs.length===1) return cs[0]
  if(cs.length>1){
    // Varias ventas: la Activa más reciente; si ninguna Activa, la más reciente con nombre (mejor traer de más, el usuario recorta/edita).
    const rec = a => String(a.created_at||a.date||a.year||'')
    const act = cs.filter(s=>s.status==='Activo').sort((a,b)=>rec(b).localeCompare(rec(a)))
    return (act[0] || [...cs].sort((a,b)=>rec(b).localeCompare(rec(a)))[0]) || null
  }
  return direct || null
}

// Contenido del correo de factura — FUENTE ÚNICA (la usan el modal individual y el envío masivo).
// Glosa = [proyecto · si el ítem es genérico] + descripción del DTE (NmbItem + DscItem sin la base UF) + [— cuota para trazabilidad].
// En el peor caso trae de más (editable); nunca menos. El DTE es lo que ve el cliente en el PDF.
export const _RX_CUOTA = /(cuota\s*\d+\s*\/\s*\d+|pago\s+\d+\s+de\s+\d+)/i

// Etiqueta de pago BREVE que calza en "...correspondiente {al/a la} {etiqueta} de nuestros servicios..." (ej. "Pago inicial", "Anticipo").
// Una DESCRIPCIÓN del servicio ("Asesoría legal permanente...") NO es etiqueta de pago → no se incrusta como detalle (el servicio se describe por el proyecto); así se evita "al Asesoría legal permanente sociedad de nuestros servicios...".
export const _esPagoLabel = s => { const t=(s||'').trim(); return !!t && t.length<=22 && /^(cuota|pago|anticipo|abono|retainer)\b/i.test(t) }

// Descompone la glosa en {relacion, detalle}: relacion = el servicio/proyecto (para "en relación a …"); detalle = SOLO la cuota/pago ("Pago 1 de 10").
export function facturaGlosaPartes(factura, sale){
  const proyecto=ventaNombre(sale)
  const dte = factura?.dte_xml ? parseDteFactura(factura.dte_xml) : null
  const item = dte&&dte.items&&dte.items[0]
  const nmb = (item?.nmb||'').trim()
  // Detalle del DTE (DscItem) sin la línea de UF (base de cálculo interna): "Pago 1 de 10", "Pago inicial", etc.
  const dscDet = String(item?.dsc||'').replace(/\bUF\s*[\d.,]+/ig,'').replace(/[\r\n]+/g,' ').replace(/\s{2,}/g,' ').replace(/^[—\-·|,\s]+|[—\-·|,\s]+$/g,'').trim()
  let nombre, detalle
  if(nmb){
    const cn = nmb.match(_RX_CUOTA)
    nombre = nmb.replace(/\s*[—\-·|:]?\s*(cuota\s*\d+\s*\/\s*\d+|pago\s+\d+\s+de\s+\d+)\s*$/i,'').trim()   // ítem sin la cuota inline
    // detalle = SOLO la cuota/pago (del DscItem, del NmbItem o del concepto), normalizada a "Pago N de M"; nunca una descripción larga del servicio (eso va en relacion/proyecto) → evita "al Asesoría legal permanente sociedad…".
    const cuotaRaw = (dscDet.match(_RX_CUOTA) || cn || (factura.concept||'').match(_RX_CUOTA) || [])[0] || ''
    const nm = cuotaRaw.match(/(\d+)\D+(\d+)/)
    detalle = nm ? `Pago ${nm[1]} de ${nm[2]}` : (_esPagoLabel(dscDet)?dscDet:'')
  } else {
    const concept=(factura.concept||'').trim()
    const cn = concept.match(_RX_CUOTA); const nm = cn?cn[0].match(/(\d+)\D+(\d+)/):null
    detalle = nm ? `Pago ${nm[1]} de ${nm[2]}` : ''
    nombre = concept.replace(/\s*[—\-·|:]?\s*(cuota\s*\d+\s*\/\s*\d+|pago\s+\d+\s+de\s+\d+)\s*$/i,'').trim()
  }
  if(detalle) detalle = detalle.charAt(0).toUpperCase()+detalle.slice(1)
  // Ítem genérico ("Servicios legales", "Honorarios", "Asesoría") no describe → usar el PROYECTO en su lugar (se descarta el genérico).
  const esGenerico = !nombre || /^(honorarios(\s+profesionales)?|servicios(\s+legales|\s+profesionales)?|asesor[ií]a(\s+legal|\s+jur[ií]dica)?|factura)\.?$/i.test(nombre)
  let relacion = nombre, esProyecto = false
  if(esGenerico && proyecto){ relacion = proyecto; esProyecto = true }   // el proyecto reemplaza al ítem genérico
  else if(!nombre){ relacion = proyecto; esProyecto = !!proyecto }
  return { relacion:(relacion||'').trim(), detalle:(detalle||'').trim(), esProyecto }
}

// despedida = SIEMPRE va al final del correo (después de los bloques insertados). Con sinCierre no la incluye el cuerpo (el modal la agrega al final).
export const CORREO_DESPEDIDA = lang => lang==='en'?'We remain at your disposal for any questions.':'Quedamos atentos a sus comentarios.'

export function facturaCorreoBody(factura, sale, lang, sinCierre=false){
  const folio=folioN(factura.invoice_no||'')||factura.invoice_no||''
  const {relacion, detalle, esProyecto} = facturaGlosaPartes(factura, sale)
  const cierre = sinCierre?'':`\n\n${CORREO_DESPEDIDA(lang)}`
  // Redacción: "correspondiente al {Pago X} de nuestros servicios profesionales en relación al proyecto {nombre}".
  if(lang==='en'){
    const desc = detalle ? `the ${detalle} of our professional services` : 'our professional services'
    const rel = relacion ? (esProyecto ? ` in connection with the ${relacion} project` : ` in connection with ${relacion}`) : ''
    return `We are pleased to attach invoice No. ${folio}, corresponding to ${desc}${rel}, in the amount of ${fmtN(factura.amount)}.${cierre}`
  }
  const artDet = /^cuota/i.test(detalle)?'a la':'al'   // "al Pago 1 de 10" / "a la Cuota 1/2"
  const desc = detalle ? `${artDet} ${detalle} de nuestros servicios profesionales` : 'a nuestros servicios profesionales'
  const rel = relacion ? (esProyecto ? ` en relación al proyecto ${relacion}` : ` en relación a ${relacion}`) : ''
  return `Espero que estén muy bien. Adjuntamos la factura N° ${folio}, correspondiente ${desc}${rel}, por ${fmtN(factura.amount)}.${cierre}`
}

// Convierte texto (con \n) en párrafos <p> escapados. Fuente única para armar cuerpos de correo.
export const _correoToP = txt => String(txt).split('\n').map(l=>l.trim()?`<p style="margin:0 0 10px">${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`:'').join('')

// Cascarón del correo del estudio: header navy con logo + contenido (ya en HTML) + firma. innerHtml es el cuerpo ya armado.
export function facturaCorreoShell(innerHtml, firma, lang='es'){
  return `<div style="font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%"><tbody><tr><td bgcolor="#003C50" style="background-color:#003C50;padding:18px 24px"><img src="${location.origin}${BRAND.logo.blanco}" alt="${BRAND.nombre}" style="height:26px;display:block"/></td></tr></tbody></table><div style="padding:24px;border:1px solid #E4E8EB;border-top:none">${innerHtml}${firmaCorreoHtml(firma,`${location.origin}${BRAND.logo.color}`,lang)}</div></div>`
}

export function facturaCorreoHtml(body, firma, incPago, lang='es', fondoHtml=''){
  return facturaCorreoShell(`${_correoToP(body)}${incPago?DATOS_PAGO_HTML:''}${fondoHtml||''}`, firma, lang)
}

// Carpeta destino de una factura en Drive: raíz de Facturación → Año → Mes (según la fecha de emisión). Crea las que
// falten y cachea el id por año-mes (evita re-buscar). Reemplaza a la carpeta única "BETA" de pruebas.
export async function driveCarpetaFacturacion(token, isoDate){
  const MES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  // Convención del estudio: se factura el MES VENCIDO (emito en octubre → período facturado = septiembre; y así todos los meses).
  // La carpeta usa el MES FACTURADO = emisión − 1 mes (enero → diciembre del año anterior). Así "Factura emitida 15-sep" cae en "08. Agosto".
  const s=String(isoDate||'')
  let y='Sin fecha', mi=0
  if(/^\d{4}-\d{2}/.test(s)){ let yy=+s.slice(0,4), mm=+s.slice(5,7)-1; if(mm<1){ mm=12; yy-=1 } y=String(yy); mi=mm }
  const mes=(mi>=1&&mi<=12)?MES[mi-1]:''
  const nombreAnio=`Facturación ${y}`                                    // carpeta del año (del mes facturado)
  const nombreMes = mes?`${String(mi).padStart(2,'0')}. ${mes} ${y}`:y   // "08. Agosto 2026" (con cero → ordena bien)
  const ckey='drive_fact_v2_'+nombreAnio+'/'+nombreMes
  let cached=null; try{ cached=localStorage.getItem(ckey) }catch(_){}
  if(cached) return cached
  const anio=await driveFindOrCreateFolder(token, FACTURACION_ROOT, nombreAnio)   // Facturación → "Facturación 2026" → "06. Junio 2026"
  const dest=await driveFindOrCreateFolder(token, anio, nombreMes)
  try{ localStorage.setItem(ckey, dest) }catch(_){}
  return dest
}

export const cargarMammoth=()=> import('mammoth').then(m=>m.default||m)

// ─── Persistencia liviana por-vista (Parte B): recuerda orden/filtro entre sesiones vía localStorage. Tolera modo privado / storage bloqueado. ──
// ─── Arrastrar (mouse y dedo): fuente única para mover objetos en la app ──
// Con mouse arrastra al moverse 6 px; con el dedo, al mantener presionado 400 ms (antes de eso el dedo desplaza la página).
// El destino se marca con data-soltar="<valor>" (y opcional data-soltar-grupo para no mezclar arrastres). Mientras arrastra, una
// copia con `etiqueta` sigue al puntero y el destino bajo él queda resaltado (`sobre`). Cerca del borde la página se desplaza sola.
// El arrastre nativo del navegador (draggable) no funciona en el iPhone: por eso todo arrastre nuevo usa esto.
export function useArrastre({grupo='', onSoltar}){
  const [arr,setArr]=useState(null)         // { item } mientras arrastra
  const [sobre,setSobre]=useState(null)     // valor data-soltar bajo el puntero
  const st=useRef(null)
  const fin=useRef(null)
  useEffect(()=>()=>{ fin.current&&fin.current() },[])
  const props=useCallback((item,etiqueta)=>({
    onPointerDown:e=>{
      if(e.button>0 || e.target.closest?.('button,input,select,textarea,a,[data-no-arrastre]')) return   // en un botón o casilla no se arrastra
      const tactil=e.pointerType!=='mouse', x0=e.clientX, y0=e.clientY, el=e.currentTarget
      let activo=false, ghost=null, timer=null, raf=null, ult={x:x0,y:y0}, destino=null
      const sinTexto=document.body.style.userSelect
      const destinoEn=(x,y)=>{ const t=document.elementFromPoint(x,y)?.closest('[data-soltar]'); if(!t) return null; if((t.dataset.soltarGrupo||'')!==grupo) return null; return t.dataset.soltar }
      const mover=(x,y)=>{ ult={x,y}; if(ghost){ ghost.style.transform=`translate(${x+12}px,${y-18}px)` } destino=destinoEn(x,y); setSobre(destino) }
      const auto=()=>{ if(!activo) return; const m=70, v=ult.y<m?-(m-ult.y)/3:ult.y>window.innerHeight-m?(ult.y-(window.innerHeight-m))/3:0
        if(v){ const sc=document.getElementById('main-scroll'); if(sc&&sc.scrollHeight>sc.clientHeight) sc.scrollTop+=v; else window.scrollBy(0,v); destino=destinoEn(ult.x,ult.y); setSobre(destino) }
        raf=requestAnimationFrame(auto) }
      const empezar=()=>{ activo=true; document.body.style.userSelect='none'
        try{ navigator.vibrate&&navigator.vibrate(12) }catch(_){}
        ghost=document.createElement('div'); ghost.textContent=etiqueta||''
        Object.assign(ghost.style,{position:'fixed',left:0,top:0,zIndex:9999,pointerEvents:'none',padding:'6px 12px',borderRadius:'20px',background:C.accent,color:'#fff',fontSize:'12px',fontWeight:'700',fontFamily:'inherit',whiteSpace:'nowrap',maxWidth:'240px',overflow:'hidden',textOverflow:'ellipsis',boxShadow:'0 6px 18px rgba(0,60,80,.28)'})
        document.body.appendChild(ghost); el.style.opacity='.45'; setArr({item}); mover(ult.x,ult.y); raf=requestAnimationFrame(auto) }
      const onMove=ev=>{ const dx=ev.clientX-x0, dy=ev.clientY-y0
        if(!activo){ if(tactil){ if(Math.hypot(dx,dy)>10) limpiar() } else if(Math.hypot(dx,dy)>6) empezar(); return }
        mover(ev.clientX,ev.clientY) }
      const onTouchMove=ev=>{ if(activo) ev.preventDefault() }   // con el objeto tomado, el dedo ya no desplaza la página
      const onUp=()=>{ const d=activo?destino:null, eraActivo=activo; limpiar()
        if(eraActivo){ const tragar=ev=>{ ev.stopPropagation(); ev.preventDefault() }; window.addEventListener('click',tragar,{capture:true,once:true}); setTimeout(()=>window.removeEventListener('click',tragar,{capture:true}),350) }
        if(d!=null&&onSoltar) onSoltar(item,d) }
      const onCtx=ev=>{ if(tactil) ev.preventDefault() }   // el menú del iPhone al mantener presionado
      const limpiar=()=>{ clearTimeout(timer); cancelAnimationFrame(raf); activo=false; ghost&&ghost.remove(); ghost=null; el.style.opacity=''
        document.body.style.userSelect=sinTexto
        window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp); window.removeEventListener('pointercancel',onCancel)
        document.removeEventListener('touchmove',onTouchMove); el.removeEventListener('contextmenu',onCtx); setArr(null); setSobre(null); fin.current=null }
      const onCancel=()=>{ if(!activo) limpiar() }
      window.addEventListener('pointermove',onMove); window.addEventListener('pointerup',onUp); window.addEventListener('pointercancel',onCancel)
      document.addEventListener('touchmove',onTouchMove,{passive:false}); el.addEventListener('contextmenu',onCtx)
      if(tactil) timer=setTimeout(empezar,400)
      fin.current=limpiar
    },
    style:{touchAction:'manipulation',WebkitTouchCallout:'none',WebkitUserSelect:'none',userSelect:'none'},
  }),[grupo,onSoltar])
  return { props, arrastrando:arr?.item??null, sobre }
}

// Proyecto y razón social de un gasto/fondo (o de varios a la vez): muestra solo lo que falta, con lo sugerido preseleccionado.
// Proyecto: sugerirVentaGasto. Razón social: la de ese proyecto, o la única del cliente. Se puede dejar uno de los dos en blanco.
// Asesoría permanente (cobro mensual): sus gastos llevan subproyecto, igual que sus tareas. Sugerencias = los ya usados por el cliente.
export const esPermanente = v => !!v && v.cobro_type==='mensual'

// Carpetas-biblioteca de precedentes en el Drive del estudio (por tipo de documento). El OAuth de Drive ya está concedido (driveToken).
export const PREC_FOLDERS = { propuesta:'1MQg9_q0l20mjB-LftuYQywTE4T81Kxf3', memo:'1le4boJMW43HsTL0tHHnBsRwjzOc7leH0', informe:'1ETnlJmL324pgaTc6OFlFeKzYGmrCJ3mj', presentacion:'1EHLBt7bqVFvTXk6KHsrHuzR7Ic7bClG0', plan:'1le4boJMW43HsTL0tHHnBsRwjzOc7leH0' }

export async function leerDriveTextoSA(file){   // lee un archivo de Drive a texto vía la conexión PERMANENTE (edge function `drive`); base64 → mammoth/pdfjs
  const d = await driveCall({action:'download', fileId:file.id, mimeType:file.mimeType})
  const bin = atob(d.base64||''); const buf = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i)
  const isGDoc = file.mimeType==='application/vnd.google-apps.document'
  if(!isGDoc && (file.mimeType==='application/pdf'||(file.name||'').toLowerCase().endsWith('.pdf'))){
    const pdf = await (await cargarPdfjs()).getDocument({data:buf}).promise
    let text=''; for(let i=1;i<=pdf.numPages;i++){ const p=await pdf.getPage(i); const c=await p.getTextContent(); text+=c.items.map(it=>it.str||'').join(' ')+'\n' }
    return text
  }
  const r = await (await cargarMammoth()).extractRawText({arrayBuffer:buf.buffer}); return r.value||''
}

export const CART_DOT = { rojo:'#E24B4A', ambar:'#EF9F27', verde:'#1D9E75' }   // semáforo (eje nuevo: salud del proyecto)

export const SEÑAL_COL = { pago:C.greenText, factura:C.azulInfo, anticipo:C.azulInfo, tarea:'#854F0B', gasto:'#537281', plan:'#537281', genesis:'#003C50', nota:'#99ABB4' }

// Una factura está EMITIDA solo si tiene folio y no es Programada/Anulada. Una cuota Programada NO es "emitida"
// (bug real: se marcaba issued_at de programadas como "Factura emitida" a clientes sin facturar).
export const facturaEmitida = b => !!b && !!b.invoice_no && b.status!=='Programada' && b.status!=='Anulada' && b.billing_type!=='reembolso'

// FUENTE ÚNICA del movimiento de un proyecto (la usan Cartera y el strip "Mis proyectos" del Inicio).
// Barre eventos REALES (pagos, facturas EMITIDAS, tareas, anticipos, gastos) + un resumen del plan de cobro → última señal + score 30d + eventos (ref clickeable).
export const carteraMovimiento = (p, { billing=[], tasks=[], anticipos=[], expenses=[], hitos=[] }={}) => {
  const _d = iso => iso==null?null:Math.round((Date.now()-new Date(String(iso).slice(0,10)+'T12:00').getTime())/86400000)
  const cid = String(p.cliente_id||''); const sid = p.sale_id?String(p.sale_id):null
  const evs = []; const linkCli = x => cid && String(x)===cid
  const mine = x => linkCli(x.client_id) || (sid&&String(x.sale_id)===sid)
  const push=(fecha,tipo,texto,peso,ref)=>{ if(!fecha) return; const iso=String(fecha).slice(0,10); if(iso.length<10) return; evs.push({iso,tipo,texto,peso,ref:ref||null}) }
  const fichaRef = { kind:'ficha', id:p.cliente_id }
  const bMine = billing.filter(b=>!b.deleted_at && b.billing_type!=='reembolso' && mine(b))
  bMine.forEach(b=>{
    if(b.paid_at && b.status==='Pagado'){ push(b.paid_at,'pago',`Pago recibido${b.amount?` · ${fmt(b.amount)}`:''}`,5,fichaRef); return }   // un pago cuenta aunque no tenga folio
    if(facturaEmitida(b)) push(b.issued_at||b.due,'factura',`Factura emitida${b.invoice_no?` N° ${b.invoice_no}`:''}`,3,fichaRef)   // "emitida" exige folio (una Programada NO lo es)
  })
  // Resumen del plan de cobro: UN evento por las cuotas Programadas (no 8 "facturas" falsas).
  const prog = bMine.filter(b=>b.status==='Programada')
  if(prog.length){ const fecha=prog.map(b=>b.issued_at||b.due).filter(Boolean).sort()[0]; push(fecha,'plan',`Plan de cobro · ${prog.length} cuota${prog.length!==1?'s':''} por facturar`,1,null) }
  tasks.forEach(t=>{ const linked=(String(t.project_id||'')===String(p.id)) || (!t.project_id && linkCli(t.client_id)); if(!linked) return
    if(t.completed_at) push(t.completed_at,'tarea','Tarea terminada',2,{kind:'task',id:t.id})
    else push(t.created_at,'tarea','Tarea nueva',2,{kind:'task',id:t.id}) })
  anticipos.forEach(a=>{ if(!linkCli(a.client_id)) return; push(a.fecha,'anticipo',`Anticipo recibido${a.monto?` · ${fmt(a.monto)}`:''}`,3,fichaRef) })
  expenses.forEach(e=>{ if(!linkCli(e.client_id)) return; push(e.rendered_at||e.date||e.created_at,'gasto','Movimiento de gastos',1,fichaRef) })
  // Avanzar el PLAN también es movimiento (integración): un paso completado (fecha) y la última edición del plan (created_at del paso más nuevo).
  const hMine = hitos.filter(h=>String(h.proyecto_id)===String(p.id))
  hMine.forEach(h=>{ if(h.hecho && h.fecha) push(h.fecha,'plan',`Paso completado${h.titulo?` · ${h.titulo}`:''}`,3,null) })
  const ultPaso = hMine.map(h=>String(h.created_at||'').slice(0,10)).filter(f=>f.length>=10).sort().slice(-1)[0]
  if(ultPaso) push(ultPaso,'plan','Plan actualizado',1,null)
  if(p.created_at) push(p.created_at,'genesis','Proyecto iniciado',0,null)   // ancla del inicio de la línea de tiempo
  if(!evs.length && p.ultima_actividad) push(p.ultima_actividad,'nota','Actualización manual',1)
  if(!evs.length) return { ultima:null, dias:null, score:0, eventos:[] }
  evs.sort((a,b)=>b.iso.localeCompare(a.iso))
  const score = evs.reduce((s,e)=>{ const d=_d(e.iso); if(d==null||d<0||d>30) return s; const rec=d<=3?1:d<=7?.7:d<=14?.4:.2; return s+e.peso*rec },0)
  const ultReal = evs.find(e=>e.tipo!=='genesis') || evs[0]   // la última "señal" no debería ser el génesis
  return { ultima:ultReal, dias:_d(ultReal.iso), score, eventos:evs.slice(0,40) }
}

export const cartDias = iso => iso ? Math.floor((Date.now()-new Date(iso+'T00:00').getTime())/86400000) : null

export const cartDiasPlazo = iso => iso ? Math.ceil((new Date(iso+'T00:00').getTime()-Date.now())/86400000) : null

// Fecha destacada (día grande + "mes año") — formato estándar de listas. col opcional (urgencia).
// Día grande de LISTAS (formato que eligió el usuario en Banco, 2026-10-09): día 18px + "mmm aa". Fuente única para Abonos, Cargos y caja chica.
// Nombre del cliente como título de fila/tarjeta (auditoría visual 2026-10-15): 14/700 azul y COMPLETO (baja de línea, nunca se corta).
// Etiqueta de sección / KPI (auditoría visual 2026-10-15, punto 9): mayúscula chica 10/700 azul, una sola definición.
// Título de pantalla del menú (auditoría visual punto 2): 20/600 grafito. Las subpáginas usan PageHeader "‹ origen | título".
export const TIT_PAG = {fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}

export const isAssignee = (t,name) => !!name && taskAssignees(t).includes(name)

// Valor mensual de la asesoría en UF (fuente única): pesos → UF del primer día hábil del año (ufAnioEff).
export const ventaUFmesDe = (s, ufAnioEff) => s?.moneda==='CLP' ? (parseFloat(s?.amount_clp)||0)/(ufAnioEff||UF_FALLBACK) : (parseFloat(s?.amount_uf)||0)

// Margen real de un cliente permanente (fuente única): ingreso (honorario×meses) − costo (horas×costo cargado). Úsalo en Horas y en la alerta del dueño.
export function margenDeSale(sale, horas, costoHora={}, overheadHora=0, mesesYTD=1, ufHoy=0, ufAnioEff=0, anio, terceros=[], billing=[]){
  anio = anio || String(new Date().getFullYear())
  // Comisiones del año de esta venta (terceros_pagos por la fecha de su factura; sin factura, por la fecha de pago) — rebajan el margen.
  const issuedBy={}; (billing||[]).forEach(b=>{ if(b&&!b.deleted_at&&b.status!=='Anulada') issuedBy[String(b.id)]=String(b.issued_at||b.due||'') })
  const comisCLP=Math.round((terceros||[]).filter(t=>t&&String(t.sale_id)===String(sale.id)&&String(t.billing_id?(issuedBy[String(t.billing_id)]||''):(t.pagado_at||'')).slice(0,4)===anio).reduce((a,t)=>a+(Number(t.monto)||0),0))
  const feeUF=ventaUFmesDe(sale, ufAnioEff); const ingCLP=Math.round(feeUF*mesesYTD*ufHoy)
  let costoCLP=0, faltaCosto=false
  ;(horas||[]).forEach(h=>{ if(String(h.client_id)!==String(sale.client_id)||String(h.fecha||'').slice(0,4)!==anio) return; const c=Number(costoHora[h.user_name]); if(!(h.user_name in costoHora)||!c){ faltaCosto=true } costoCLP += (Number(h.horas)||0)*((c||0)+overheadHora) })
  costoCLP=Math.round(costoCLP); const margen=ingCLP-costoCLP-comisCLP; const pct=ingCLP>0?Math.round(margen/ingCLP*100):0
  // costoCLP = horas + comisiones, para que paga − cuesta = margen en toda vista; el desglose va en costoHorasCLP/comisCLP.
  return { cid:sale.client_id, ingCLP, costoCLP:costoCLP+comisCLP, costoHorasCLP:costoCLP, comisCLP, margen, pct, sinIng:feeUF<=0, faltaCosto }
}

// Revisión de datos: la app caza sus propios descuadres desde los datos ya cargados (sin queries). Detector — te lleva al dato, no toca cifras.
// Trabajos activos sin movimiento (regla única ventasReglas.trabajosDetenidos): lee las horas y las decisiones «Sigue activo»
// (learnings trabajo_activo_ok) una vez y calcula en vivo. Lo usan Revisión de datos y Cobranza, con la misma cifra que el auditor nocturno.
export function useTrabajosDetenidos({sales=[],billing=[],expenses=[],tasks=[]}){
  const [horasAct,setHorasAct]=useState([]), [activosOk,setActivosOk]=useState({}), [pagosCli,setPagosCli]=useState([])
  useEffect(()=>{ if(DEMO) return; let v=true
    Promise.all([supabase.from('horas').select('client_id,fecha'),supabase.from('learnings').select('key,value').eq('kind','trabajo_activo_ok'),
      selectAll(()=>supabase.from('cartola_movimientos').select('cliente_id,fecha').eq('tipo','abono').not('cliente_id','is',null).order('id'))])
      .then(([h,l,p])=>{ if(!v) return; setHorasAct(h.data||[]); setActivosOk(Object.fromEntries((l.data||[]).map(r=>[String(r.key),String(r.value||'')]))); setPagosCli((p.data||[]).map(m=>({client_id:m.cliente_id,fecha:m.fecha}))) },()=>{})
    return ()=>{v=false} },[])
  const hoyCL=new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})
  return useMemo(()=>trabajosDetenidos({sales,billing,expenses,tasks,horas:horasAct,pagos:pagosCli,uf:ufFechaCache()||{},hoy:hoyCL,decididos:activosOk}),[sales,billing,expenses,tasks,horasAct,pagosCli,activosOk,hoyCL])
}

// Sección colapsable con icono — patrón único de la ficha (colapsada por defecto, una línea con resumen; se despliega el detalle).
export const IconSection = ({icon, iconColor, title, summary, summaryColor, open, onToggle, last, children}) => (
  <div style={{borderBottom:last?'none':`0.5px solid ${C.bgWarm}`, background:open?C.bgPanel:'transparent'}}>
    <div onClick={onToggle} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer'}}>
      <SIcon n={icon} s={17} c={iconColor||C.muted}/>
      <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{title}</span>
      {summary!=null&&<span style={{fontSize:11,color:summaryColor||C.muted,fontWeight:summaryColor&&summaryColor!==C.muted?600:400,whiteSpace:'nowrap',flexShrink:0}}>{summary}</span>}
      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
    </div>
    {open&&<div style={{padding:'0 12px 12px 39px'}}>{children}</div>}
  </div>
)

export const urgency = (due,status) => {
  if(['Completado','Pagado','Archivado','Anulado'].includes(status)) return 'done'
  const d = daysLeft(due); if(d===null) return 'normal'
  if(d<0) return 'overdue'; if(d<=5) return 'urgent'; if(d<=14) return 'soon'; return 'normal'
}

// Guardapelos de año: un <input type=date> puede aceptar un año de 2 dígitos ("26" → "0026") y corromper toda la cadena
// de cuotas (ej. cobroInicio "0026-09-09" → la venta no genera programadas). Expande cualquier año < 1000 a 20YY.
export const anio4ISO = iso => { const s=String(iso||''); const m=s.match(/^(\d{1,4})-(\d{2})-(\d{2})/); if(!m) return iso; let y=+m[1]; if(y<100) y=2000+y; else if(y<1000) y=2000+(y%100); return `${String(y).padStart(4,'0')}-${m[2]}-${m[3]}${s.slice(m[0].length)}` }

export const urgencyColor = (due,status) => ({overdue:C.overdue,urgent:C.urgent,soon:C.soon,normal:C.normal,done:C.done})[urgency(due,status)]||C.muted

// PLAN de cuotas de una venta desde cobro_config, en UF (verdad de terreno, no intuición). Devuelve
// [{idx, montoUF, ym}] para planes de nº FIJO de cuotas (cuotas/personalizada/porcentaje); [] para mensual
// (recurrente, se cruza por período), hora, o config incompleta. Es la fuente del guardarraíl de conteo.
export function planDeVenta(sale){
  if(!sale) return []
  const cfg=sale.cobro_config||{}; const totalUF=Number(sale.amount_uf)||0; const t=sale.cobro_type
  const ymOf=iso=>String(anio4ISO(iso)||'').slice(0,7)
  // 1ª cuota nunca antes del inicio: si el inicio trae día >1 (ej. 30/09) la serie arranca el mes SIGUIENTE (coherente con mesISO del SaleForm).
  const ymAdd=(ini,i)=>{ const a=String(anio4ISO(ini)||''); const md=a.match(/^(\d{4})-(\d{2})-(\d{2})/); const m=a.match(/^(\d{4})-(\d{2})/); if(!m) return null; const off=(md&&+md[3]>1)?1:0; let y=+m[1], mm=(+m[2]-1)+i+off; y+=Math.floor(mm/12); mm=((mm%12)+12)%12; return `${y}-${String(mm+1).padStart(2,'0')}` }
  const out=[]
  if(t==='personalizada' && Array.isArray(cfg.cuotasCustom)){
    cfg.cuotasCustom.forEach(c=>{ const uf=parseFloat(String(c.monto).replace(',','.'))||0; const ym=ymOf(c.fecha); if(uf>0 && /^\d{4}-\d{2}$/.test(ym)) out.push({idx:out.length+1, montoUF:uf, ym}) })
  } else if(t==='cuotas' && cfg.cobroInicio && totalUF>0){
    const n=Number(cfg.nCuotas)||0; if(n<=0) return []
    if(cfg.cuotaDist){ const distUF=parseFloat(String(cfg.cuotaDistMonto).replace(',','.'))||0; const restUF=n>1?(totalUF-distUF)/(n-1):totalUF; const pos=cfg.cuotaDistPos==='ultima'?n:1
      for(let i=1;i<=n;i++){ const ym=ymAdd(cfg.cobroInicio,i-1); if(ym) out.push({idx:i, montoUF: i===pos?distUF:restUF, ym}) } }
    else { const per=totalUF/n; for(let i=1;i<=n;i++){ const ym=ymAdd(cfg.cobroInicio,i-1); if(ym) out.push({idx:i, montoUF:per, ym}) } }
  } else if(t==='porcentaje' && Array.isArray(cfg.tramos) && totalUF>0){
    cfg.tramos.forEach(tr=>{ const pct=Number(tr.pct)||0; const ym=ymOf(tr.fecha); if(pct>0 && /^\d{4}-\d{2}$/.test(ym)) out.push({idx:out.length+1, montoUF:totalUF*pct/100, ym}) })
  }
  return out
}

// Fuente única de "Facturado": cuota emitida (con issued_at), que no sea reembolso ni esté anulada o solo programada.
export const esFacturada = b => !!b?.issued_at && b.billing_type!=='reembolso' && b.status!=='Anulada' && b.status!=='Programada'

// ─── FIFO de cuotas: facturar/asociar SIEMPRE la más antigua, sin dejar huecos ───
// huecoFIFO: la programada sin emitir de MENOR nº de cuota (o menor vencimiento) de una venta.
// Fuente única para: la sugerencia del cotejo al asociar una huérfana, y el orden de emisión.
export function huecoFIFO(saleBills=[]){
  const abiertas=(saleBills||[]).filter(b=> b && !b.deleted_at && b.status==='Programada' && !b.invoice_no && (b.billing_type||'')!=='reembolso')
  if(!abiertas.length) return null
  const key=b=>{ const cn=cuotaNMof(b.concept); return cn?cn.n:9999 }
  return abiertas.slice().sort((a,b)=> (key(a)-key(b)) || String(a.due||'').localeCompare(String(b.due||'')))[0]
}

// ventasFacturando, coberturaVenta y trabajosSinFacturar viven en _shared/ventasReglas.js (los usa también pendientes-semanal).
// cuotasOlvidadas: programadas SIN emitir que quedaron ATRÁS de una cuota ya emitida de la misma venta
// (el caso "cobré la 2ª sin la 1ª" — señal casi segura de un salto). Secundario: sin nº, por mes de devengo
// anterior a una emitida. Alimenta el aviso en el cotejo y el correo del día 6. PURO, read-only.
export function cuotasOlvidadas(saleBills=[]){
  const bills=(saleBills||[]).filter(b=> b && !b.deleted_at && (b.billing_type||'')!=='reembolso' && b.status!=='Anulada')
  const emit=bills.filter(b=> b.invoice_no)
  if(!emit.length) return []
  const cn=b=>{ const x=cuotaNMof(b.concept); return x?x.n:null }
  const emitNs=emit.map(cn).filter(n=>n!=null)
  const maxEmitN=emitNs.length?Math.max(...emitNs):-1
  // Señal secundaria por el PERÍODO de la GLOSA (concPeriodoOf), no por la fecha de vencimiento del billing:
  // la glosa distingue "julio" de "agosto" (Eugenia = olvido real), pero un concepto sin mes ("Cobro 8", "Honorarios")
  // no entra → evita falsos positivos de numeraciones enredadas (Alejandro/Javier).
  const emitPers=emit.map(b=>concPeriodoOf(b.concept)).filter(Boolean)
  const maxEmitPer=emitPers.length?emitPers.slice().sort().slice(-1)[0]:''
  return bills.filter(b=>{
    if(b.invoice_no || b.status!=='Programada') return false
    const n=cn(b)
    if(n!=null && maxEmitN>=0) return n<maxEmitN                 // "Cuota N/M": una cuota POSTERIOR ya emitida → ésta quedó atrás
    const p=concPeriodoOf(b.concept)
    return !!(p && maxEmitPer && p<maxEmitPer)                   // por glosa: un mes POSTERIOR ya emitido (saltó éste)
  })
}

// Levenshtein → similitud 0..1 para pescar typos que el norm no ve ("Migdley" vs "Midgley").
export function _lev(a,b){ a=a||''; b=b||''; const m=a.length,n=b.length; if(!m) return n; if(!n) return m; let prev=Array.from({length:n+1},(_,j)=>j),cur=new Array(n+1); for(let i=1;i<=m;i++){ cur[0]=i; for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)) } [prev,cur]=[cur,prev] } return prev[n] }

// Detecta grupos de clientes con nombres DUPLICADOS o MUY SIMILARES → alerta para fusionar y evitar fichas/carpetas repetidas.
// Reglas (regla de oro "nunca duplicar"): (a) mismo nombre normalizado = idéntico; (b) todos los tokens de uno están
// contenidos en el otro (ej. "Marcela Bravo" ⊂ "Marcela Bravo Puldain") = muy similar; (c) mismo nº de tokens + typo
// (distancia de edición ≤2) = posible typo ("Midgley"/"Migdley"). Agrupa por componentes (3+ fichas = un solo grupo).
// Devuelve [{tipo:'exacto'|'contenido'|'typo', clientes:[...] }] ordenado (idénticos primero). Excluye internos/ocasionales.
export function detectarClientesDuplicados(clients=[]){
  const info = (clients||[]).filter(c=>c&&c.name&&!c.deleted_at&&!c.is_internal&&!c.is_occasional)
    .map(c=>{ const n=_normTxt(c.name); return {c,n,toks:n.split(' ').filter(w=>w.length>1)} })
    .filter(x=>x.n)
  const uf=info.map((_,i)=>i); const find=x=>{ while(uf[x]!==x){ uf[x]=uf[uf[x]]; x=uf[x] } return x }; const union=(a,b)=>{ uf[find(a)]=find(b) }
  const pares=[]
  for(let i=0;i<info.length;i++) for(let j=i+1;j<info.length;j++){
    const A=info[i], B=info[j]; let tipo=null
    if(A.n===B.n) tipo='exacto'
    else { const short=A.toks.length<=B.toks.length?A:B, long=A.toks.length<=B.toks.length?B:A
      if(short.toks.length>=2 && short.toks.every(t=>long.toks.includes(t))) tipo='contenido'
      else if(A.toks.length===B.toks.length && Math.min(A.n.length,B.n.length)>=6 && _lev(A.n,B.n)<=2) tipo='typo' }
    if(tipo){ union(i,j); pares.push([i,j,tipo]) }
  }
  const comp={}; info.forEach((_,i)=>{ const r=find(i); (comp[r]=comp[r]||[]).push(i) })
  const rank={exacto:0,contenido:1,typo:2}
  const grupos=Object.values(comp).filter(g=>g.length>=2).map(idxs=>{
    const tipos=pares.filter(([a,b])=>idxs.includes(a)&&idxs.includes(b)).map(x=>x[2])
    const tipo=tipos.includes('exacto')?'exacto':tipos.includes('contenido')?'contenido':'typo'
    return {tipo, clientes: idxs.map(i=>info[i].c)}
  })
  grupos.sort((a,b)=> (rank[a.tipo]-rank[b.tipo]) || (b.clientes.length-a.clientes.length))
  return grupos
}

// Clave de glosa para aprender gasto→proyecto: palabras significativas (≥4) ordenadas, así "Certificado dominio CBR" matchea independiente del orden.
// Clave de SERIE de facturas: glosa base sin "cuota N/M", "N/M", meses, años → para agrupar hermanas (1/3, 2/3, 3/3; o las mensuales) y no dejarlas huérfanas.
export const _MESES_SERIE = /\b(ene(ro)?|feb(rero)?|mar(zo)?|abr(il)?|may(o)?|jun(io)?|jul(io)?|ago(sto)?|sept?(iembre)?|oct(ubre)?|nov(iembre)?|dic(iembre)?|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi

export const serieKey = concept => String(concept||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  .replace(/cuota\s*\d+\s*(?:\/|-|de)\s*\d+/g,' ')
  .replace(/\b\d+\s*[\/-]\s*\d+\b/g,' ')
  .replace(/[—–-]/g,' ').replace(_MESES_SERIE,' ')
  .replace(/\b20\d{2}\b/g,' ').replace(/\b\d{2}\b/g,' ')
  .replace(/\b(pago|mensual|cuota)\b/g,' ')
  .replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()

// Botón de Drive: solo el logo, sin recuadro
export const driveBtn = {border:'none',background:'transparent',cursor:'pointer',padding:4,display:'inline-flex',alignItems:'center',justifyContent:'center'}

export const ddItem = { padding:'9px 14px', fontSize:13, color:C.text, cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderRadius:6, margin:'0 4px' }

// Recorrido de un gasto o fondo (FUENTE ÚNICA): de dónde vino o a dónde fue la plata — banco, liquidación de notaría, caja chica, rendición al
// cliente, fondo que lo cubre. Lo usan la ficha de Clientes (Fondos y gastos) y el detalle del gasto. Cada paso trae su referencia para enlazar.
export function recorridoGasto(e,{conc=[],movById={},expenses=[]}={}){
  const fondo=e?.type==='fondo', pasos=[]
  ;(conc||[]).filter(x=>String(x.gasto_id)===String(e.id)).forEach(c=>{ const mv=movById[c.movimiento_id]; pasos.push({k:'b'+c.movimiento_id, t:fondo?'Depósito del banco':'Pagado desde el banco', fecha:mv?.fecha||null, d:[fmt(c.monto_aplicado), mv?.nombre_contraparte||null].filter(Boolean).join(' · '), mov:c.movimiento_id}) })
  if(e.notaria_liquidado_at) pasos.push({k:'n', t:'Pagado a la notaría', fecha:e.notaria_liquidado_at, d:'liquidación de notaría', render:e.notaria_render_id||null})
  if(e.rendered_at) pasos.push({k:'cc', t:'Liquidado en caja chica', fecha:e.rendered_at, d:e.created_by||'', render:e.render_id||null})
  if(e.client_rendered_at) pasos.push({k:'r', t:'Rendido al cliente', fecha:e.client_rendered_at, d:'', render:e.client_render_id||null})
  if(e.reembolso_fondo_id){ const f=(expenses||[]).find(x=>String(x.id)===String(e.reembolso_fondo_id)); pasos.push({k:'f', t:'Cubierto con el fondo', fecha:f?.date||null, d:f?fmt(f.amount):'', fondo:f?.id||null}) }
  return pasos
}

// Aporte de UN movimiento al saldo del cliente (fondo suma; gasto resta salvo histórico). FUENTE ÚNICA de la fórmula neta
// que antes se repetía inline en el Dashboard y la lista de Clientes. Equivale a sumar esto = fgCliente().saldo.
export const saldoDelta = e => !cuentaEnSaldo(e) ? 0 : e.type==='fondo' ? (e.amount||0) : (e.no_descuenta_saldo ? 0 : -(e.amount||0))

export const DriveIcon = ({size=14}) => <svg width={size} height={size} viewBox='0 0 87.3 78' xmlns='http://www.w3.org/2000/svg'><path d='m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z' fill='#0066da'/><path d='m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z' fill='#00ac47'/><path d='m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z' fill='#ea4335'/><path d='m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z' fill='#00832d'/><path d='m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z' fill='#2684fc'/><path d='m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z' fill='#ffba00'/></svg>

// TRABAJO DE CADA GASTO: el vínculo real es expenses.sale_id (project es solo el texto). Ventas candidatas = ventas reales del
// cliente (no Propuesta/Rechazada/Borrador). Fuente única de la sugerencia: se vincula sola solo cuando no hay duda (aprendido,
// única venta, única activa); lo demás se propone y se confirma. La razón social de la venta es la de FACTURACIÓN (puede no ser la
// del requirente de la OT), por eso no es automática.
// Lo aprendido gasto→trabajo (learnings gasto_proyecto), cargado una vez para toda la app; aprenderVentaGasto lo suma al momento.
export let _aprVenta=null, _aprVentaProm=null

export function useAprendidosVenta(){
  const [a,setA]=useState(_aprVenta||[])
  useEffect(()=>{ if(DEMO) return; let v=true
    if(!_aprVentaProm) _aprVentaProm=selectAll(()=>supabase.from('learnings').select('key,value,meta').eq('kind','gasto_proyecto').order('id')).then(r=>{ _aprVenta=(r&&r.data)||[]; return _aprVenta },()=>[])
    _aprVentaProm.then(x=>{ if(v) setA(x) }); return ()=>{ v=false } },[])
  return a
}

// Propuestas de la revisión semanal con IA (edge gastos-trabajo-ia, learnings gasto_venta_ia): { id del gasto: {sale_id, evidencia} }.
export let _iaVenta=null, _iaVentaProm=null

export function useIaVenta(){
  const [m,setM]=useState(_iaVenta||{})
  useEffect(()=>{ if(DEMO) return; let v=true
    if(!_iaVentaProm) _iaVentaProm=selectAll(()=>supabase.from('learnings').select('key,value,meta').eq('kind','gasto_venta_ia').order('id')).then(r=>{ const o={}; ((r&&r.data)||[]).forEach(x=>{ o[String(x.key)]={sale_id:x.value,...(x.meta||{})} }); _iaVenta=o; return o },()=>({}))
    _iaVentaProm.then(x=>{ if(v) setM(x) }); return ()=>{ v=false } },[])
  return m
}

// Retención de boleta ↔ F29: va en el F29 del MES DE LA BOLETA (período P, cód. 151) y se paga en P+1 con el PPM
// (gasto 'Impuestos y patentes › PPM', concepto "IVA/PPM MM-AAAA"). Pagada = existe ese pago, sin marcar nada a mano.
// La fuente de verdad es el cód. 151 del F29 (SII); no se infiere nada del texto del concepto (falso positivo Delpino 09-2025).
export const periodoF29 = e => { const m=String(e?.concept||'').match(/(\d{2})-(\d{4})/); if(m) return `${m[2]}-${m[1]}`
  const d=String(e?.date||'').slice(0,7); if(!/^\d{4}-\d{2}$/.test(d)) return ''; const [y,mm]=d.split('-').map(Number), x=new Date(y,mm-2,1); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}` }

// ── CALENDARIO TRIBUTARIO DEL ESTUDIO (FUENTE ÚNICA: página Oficina › Calendario tributario, tarjeta de Oficina y aviso del Inicio).
// Módulo Chile: plazos legales; si el día cae en fin de semana o feriado, pasa al hábil siguiente (art. 10 del Código Tributario).
// Qué obligaciones tiene el estudio = tabla obligaciones_tributarias (client_id null); DJ con su fecha = sii_dj_vencimientos (resolución
// del SII del año); presentadas = obligaciones_cumplidas. F29 y cotizaciones se dan por pagadas con el gasto del período (periodoF29),
// y se cuadran contra el correo «VALORES» de la contadora (learnings valores_contadora, key = período AAAA-MM).




export const _mesNom = ym => { const N=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']; const [Y,M]=String(ym).split('-'); return `${N[+M-1]||''} ${Y}` }


// Vencimiento del pago del período `per` (se paga el mes siguiente).

// Montos «$12.345» escritos en el concepto del pago (retenciones de boletas que van en el costo de cada boleta).
export const _montosConcepto = s => [...String(s||'').matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g)].reduce((a,m)=>a+Number(m[1].replace(/\./g,'')),0)

export const _pagosDe = (expenses, cat, sub, per) => (expenses||[]).filter(e=>!e.deleted_at&&e.category===cat&&e.subcategory===sub&&periodoF29(e)===per)

export const _pagoCal = (expenses, tipo, per) => { const l=tipo==='F29'?_pagosDe(expenses,'Impuestos y patentes','PPM',per):_pagosDe(expenses,'Leyes sociales','Cotizaciones',per)
  if(!l.length) return null
  return {monto:l.reduce((a,e)=>a+(Number(e.amount)||0),0), fecha:l.map(e=>String(e.date||'').slice(0,10)).sort().pop(), concepto:l.map(e=>e.concept||'').filter(Boolean).join(' · '), ids:l.map(e=>e.id)} }

// Vencimiento de una DJ del estudio: la fila de la resolución cuyo detalle más se parece al de la obligación (1948 tiene una fecha por tipo de sociedad).

export function calendarioEstudio({obl=[], dj=[], valores={}, declarados={}, cumplidas=[], expenses=[], docs=[], boletas=[], hoy}={}){
  hoy = hoy || isoLocal(Date.now())
  const ym=hoy.slice(0,7), tiene=new Set((obl||[]).filter(o=>o.activo!==false&&!o.client_id).map(o=>o.tipo))
  const cumpl=new Map((cumplidas||[]).filter(c=>!c.client_id).map(c=>[c.clave,c]))
  const vKeys=Object.keys(valores||{}).sort()
  const ciclo = per => { const v=valores[per]||null, cot=_pagoCal(expenses,'COT',per), f29=_pagoCal(expenses,'F29',per)
    const cuadre=(tipo,inf,pag)=>{ const b={tipo,inf,pag}; if(!pag) return {...b,k:'pend'}; if(inf==null) return {...b,k:'sinv'}
      const dif=Math.round(inf-pag.monto); if(Math.abs(dif)<1) return {...b,k:'ok',dif:0}
      return {...b, k:Math.abs(_montosConcepto(pag.concepto)-dif)<1?'expl':'dif', dif} }
    const cq=[tiene.has('COT')&&cuadre('COT',v?.cotizaciones,cot), tiene.has('F29')&&cuadre('F29',v?.ppm,f29)].filter(Boolean)
    const k = cq.some(x=>x.k==='pend')?'pend':cq.some(x=>x.k==='dif')?'dif':cq.some(x=>x.k==='sinv')?'sinv':cq.some(x=>x.k==='expl')?'expl':'ok'
    return {per, mes:_ymMas(per,1), v, cot:{vence:venceCalTrib('COT',per), pago:cot, cuadre:cuadre('COT',v?.cotizaciones,cot)}, f29:{vence:venceCalTrib('F29',per), pago:f29, cuadre:cuadre('F29',v?.ppm,f29)}, cuadra:{k, partes:cq}} }
  const perAct=_ymMas(ym,-1), ciclos=[ciclo(perAct), ciclo(ym)]
  // Alertas SOLO por excepción (los recordatorios los hace la contadora).
  const alertas=[]
  ;[_ymMas(perAct,-1), perAct].forEach(per=>{ const c=per===perAct?ciclos[0]:ciclo(per), lbl=_mesNom(per)
    if(per===perAct&&!c.v&&+hoy.slice(8,10)>CAL_CL.valoresHasta) alertas.push({sev:1, t:`Sin correo de valores de la contadora · ${lbl}`, fecha:null})
    ;[['F29','F29',c.f29],['COT','Cotizaciones',c.cot]].forEach(([tp,nm,x])=>{ if(!tiene.has(tp)||x.pago) return; const d=_diasA(hoy,x.vence)
      if(d<0) alertas.push({sev:0, t:`${nm} de ${lbl} sin pago registrado · venció el ${fmtFechaDMY(x.vence)}`, fecha:x.vence})
      else if(d<=CAL_CL.avisoDias) alertas.push({sev:1, t:`${nm} de ${lbl} sin pago registrado · vence el ${fmtFechaDMY(x.vence)}`, fecha:x.vence}) })
    c.cuadra.partes.filter(p=>p.k==='dif').forEach(p=>alertas.push({sev:1, t:`${p.tipo==='F29'?'F29':'Cotizaciones'} de ${lbl}: pagado ${fmt(p.pag.monto)} · informado ${fmt(p.inf)}`, fecha:p.pag.fecha})) })
  // DJ y F22: vencimientos del año tributario en curso y el siguiente; presentada = marcada en obligaciones_cumplidas.
  const anuales=[]
  ;(obl||[]).filter(o=>o.activo!==false&&!o.client_id&&o.tipo==='DJ').forEach(o=>{ const at=[+ym.slice(0,4),+ym.slice(0,4)+1]
    at.forEach(a=>{ const r=_djFecha(o,(dj||[]).filter(x=>+x.anio_tributario===a)); if(r) anuales.push({tipo:'DJ', clave:`DJ-${o.formulario}-${a}`, fecha:_habilDesde(r.fecha), t:`DJ ${o.formulario}`, s:o.detalle||'', at:a, fuente:r.fuente||''}) }) })
  if(tiene.has('F22')) [+ym.slice(0,4),+ym.slice(0,4)+1].forEach(a=>anuales.push({tipo:'F22', clave:`F22-${a}`, fecha:_habilDesde(`${a}-${String(CAL_CL.F22.mes).padStart(2,'0')}-${CAL_CL.F22.dia}`), t:`F22 · Renta AT ${a}`, s:'', at:a}))
  anuales.forEach(x=>{ x.hecha=cumpl.get(x.clave)||null; if(x.hecha) return; const d=_diasA(hoy,x.fecha)
    if(d<0&&d>=-60) alertas.push({sev:0, t:`${x.t} sin marcar como presentada · venció el ${fmtFechaDMY(x.fecha)}`, fecha:x.fecha})
    else if(d>=0&&d<=10) alertas.push({sev:1, t:`${x.t} vence el ${fmtFechaDMY(x.fecha)}`, fecha:x.fecha}) })
  // Pagos de patente: el mayor del mes y solo si no es un derecho menor (≥ 50 % del mayor pago de patente del año).
  const patPagos=(expenses||[]).filter(e=>!e.deleted_at&&e.category==='Impuestos y patentes'&&e.subcategory==='Patente municipal'&&String(e.date||'')>=_ymMas(ym,-12))
  const patMax=Math.max(0,...patPagos.map(e=>Number(e.amount)||0)), patDe=m=>patPagos.filter(e=>String(e.date||'').slice(0,7)===m&&(Number(e.amount)||0)>=patMax*.5).sort((a,b)=>b.amount-a.amount)[0]||null
  const multas=(expenses||[]).filter(e=>!e.deleted_at&&e.category==='Impuestos y patentes'&&e.subcategory==='Multas')
  const multaDe=(m,re)=>multas.find(e=>String(e.date||'').slice(0,7)===m&&re.test(String(e.concept||'')))||null
  // El año: columnas = mes de pago, desde 2 meses atrás hasta 9 adelante.
  const cols=Array.from({length:12},(_,i)=>_ymMas(ym,i-2))
  const prox={}   // fila → primera columna pendiente (se muestra «Vence»)
  const cel=(fila,m,c)=>{ if(c.k==='pe'&&prox[fila]==null){ prox[fila]=m; return {...c, t:'Vence', s:c.dia+(c.extra?` · ${c.extra}`:''), k:_diasA(hoy,c.fecha)<=31?'pr':'pe'} } return c.k==='pe'?{...c, t:c.dia, s:c.extra||''}:c }
  const filas=[]
  if(tiene.has('F29')) filas.push({k:'F29', t:'F29 · IVA/PPM', celdas:cols.map(m=>{ const per=_ymMas(m,-1), p=_pagoCal(expenses,'F29',per), ve=venceCalTrib('F29',per), mu=multaDe(m,/f29|iva/i)
    const det={tipo:'F29', titulo:`F29 · período ${_mesNom(per)}`, per, vence:ve, inf:valores[per]?.ppm, pago:p, multa:mu}
    if(p) return {k:'ok', t:'Pagado', s:fmtFechaDMY(p.fecha).slice(0,5), det}
    if(ve<hoy) return {k:'ve', t:'Sin pago', s:`vencía ${ve.slice(8,10)}`, det}
    return cel('F29',m,{k:'pe', dia:ve.slice(8,10), fecha:ve, det}) })})
  if(tiene.has('COT')) filas.push({k:'COT', t:'Cotizaciones', celdas:cols.map(m=>{ const per=_ymMas(m,-1), p=_pagoCal(expenses,'COT',per), ve=venceCalTrib('COT',per)
    const det={tipo:'COT', titulo:`Cotizaciones · período ${_mesNom(per)}`, per, vence:ve, inf:valores[per]?.cotizaciones, pago:p}
    if(p) return {k:'ok', t:'Pagado', s:fmtFechaDMY(p.fecha).slice(0,5), det}
    if(ve<hoy) return {k:'ve', t:'Sin pago', s:`vencía ${ve.slice(8,10)}`, det}
    return cel('COT',m,{k:'pe', dia:ve.slice(8,10), fecha:ve, det}) })})
  if(tiene.has('DJ')) filas.push({k:'DJ', t:'Declaraciones juradas', celdas:cols.map(m=>{ const l=anuales.filter(x=>x.tipo==='DJ'&&x.fecha.slice(0,7)===m), mu=multaDe(m,/declaraci/i)
    const det={tipo:'DJ', titulo:`Declaraciones juradas · ${_mesNom(m)}`, items:l, multa:mu}
    if(mu) return {k:'ve', t:'Multa', s:fmtFechaDMY(mu.date).slice(0,5), det}
    if(!l.length) return {k:'na', det:null}
    if(l.every(x=>x.hecha)) return {k:'ok', t:'Presentadas', s:`${l.length} DJ`, det}
    const f=l.map(x=>x.fecha).sort()[0]; if(f<hoy) return {k:'ve', t:'Sin marcar', s:`${l.filter(x=>!x.hecha).length} DJ`, det}
    return cel('DJ',m,{k:'pe', dia:f.slice(8,10), extra:`${l.length} DJ`, fecha:f, det}) })})
  if(tiene.has('F22')) filas.push({k:'F22', t:'F22 · Renta', celdas:cols.map(m=>{ const x=anuales.find(a=>a.tipo==='F22'&&a.fecha.slice(0,7)===m); if(!x) return {k:'na', det:null}
    const det={tipo:'F22', titulo:x.t, items:[x]}
    if(x.hecha) return {k:'ok', t:'Presentado', s:fmtFechaDMY(x.hecha.cumplido_at).slice(0,5), det}
    if(x.fecha<hoy) return {k:'ve', t:'Sin marcar', s:'', det}
    return cel('F22',m,{k:'pe', dia:x.fecha.slice(8,10), fecha:x.fecha, det}) })})
  if(tiene.has('PATENTE')) filas.push({k:'PATENTE', t:'Patente municipal', celdas:cols.map(m=>{ const p=patDe(m), vence=CAL_CL.PATENTE.meses.includes(+m.slice(5,7))
    const det={tipo:'PATENTE', titulo:`Patente municipal · ${_mesNom(m)}`, pagoPat:p, vence:vence?_finDeMes(m):null}
    if(p) return {k:'ok', t:'Pagada', s:fmtFechaDMY(p.date).slice(0,5), det}
    if(!vence||_finDeMes(m)<hoy) return {k:'na', det:null}
    return cel('PATENTE',m,{k:'pe', dia:_finDeMes(m).slice(8,10), fecha:_finDeMes(m), det}) })})
  // Próximos pagos: el primer ciclo sin F29 pagado; monto informado por la contadora o, si aún no llega, promedio de los 3 últimos informados.
  const cicloProx=ciclos.find(c=>!c.f29.pago)||ciclo(_ymMas(ym,1))
  const prev3=vKeys.filter(k=>k<cicloProx.per).slice(-3).map(k=>valores[k])
  const prom=f=>prev3.length?prev3.reduce((a,x)=>a+(Number(x?.[f])||0),0)/prev3.length:null
  const vp=valores[cicloProx.per]
  // F29: informado por la contadora; si no ha llegado, estimado del mes cerrado (f29Reglas); con el mes abierto, se calcula al cierre.
  const f29E=cicloProx.per<ym?f29Estimado({per:cicloProx.per, docs, boletas, valores, declarados}):null
  const f29Prox=vp?{t:'F29 · IVA/PPM', monto:vp.ppm, est:false, estF29:f29E?.completo?f29E.total:null, vence:cicloProx.f29.vence}
    :f29E?.completo?{t:'F29 · IVA/PPM', monto:f29E.total, est:'cerrado', f29:f29E, vence:cicloProx.f29.vence}
    :{t:'F29 · IVA/PPM', monto:null, est:'abierto', calcula:_habilDesde(`${_ymMas(cicloProx.per,1)}-01`), vence:cicloProx.f29.vence}
  const proximos=[tiene.has('COT')&&!cicloProx.cot.pago&&{t:'Cotizaciones', monto:vp?vp.cotizaciones:prom('cotizaciones'), est:!vp, vence:cicloProx.cot.vence},
    tiene.has('F29')&&f29Prox,
    (vp?.contadora||prev3.length)&&{t:'Honorario contadora', monto:vp?vp.contadora:(prev3[prev3.length-1]?.contadora||null), est:!vp, vence:null}].filter(x=>x&&(x.monto>0||x.est==='abierto'))
  // Ajustes: los 3 últimos períodos con diferencia explicada (retenciones de boletas en el concepto del pago).
  const ajustes=vKeys.slice(-4).reverse().flatMap(per=>(per===perAct?ciclos[0]:ciclo(per)).cuadra.partes.filter(p=>p.k==='expl').map(p=>({...p, per}))).slice(0,3)
  // F29 de los últimos 12 meses pagados dentro de plazo.
  const ult=Array.from({length:12},(_,i)=>_ymMas(perAct,-i)).map(per=>({per,p:_pagoCal(expenses,'F29',per)})).filter(x=>x.p)
  const enPlazo={n:ult.filter(x=>x.p.fecha<=venceCalTrib('F29',x.per)).length, de:ult.length}
  // Vencimientos próximos (lista del celular y del Inicio).
  const venc=[]
  ciclos.forEach(c=>{ const lbl=_mesNom(c.per)
    if(tiene.has('COT')&&!c.cot.pago) venc.push({fecha:c.cot.vence, t:`Cotizaciones de ${lbl.split(' ')[0]}`, s:'', k:'COT'})
    if(tiene.has('F29')&&!c.f29.pago) venc.push({fecha:c.f29.vence, t:`F29 de ${lbl.split(' ')[0]}`, s:'Pago en el SII', k:'F29'}) })
  anuales.filter(x=>!x.hecha&&x.fecha>=hoy).forEach(x=>venc.push({fecha:x.fecha, t:x.t, s:x.s, k:x.tipo, clave:x.clave}))
  if(tiene.has('PATENTE')){ const m=cols.find(m=>CAL_CL.PATENTE.meses.includes(+m.slice(5,7))&&_finDeMes(m)>=hoy); if(m) venc.push({fecha:_finDeMes(m), t:'Patente municipal', s:'Fecha según la municipalidad', k:'PATENTE'}) }
  // DJ del mismo día en una sola fila.
  const vencs=[]; venc.sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(x=>{ const g=x.k==='DJ'&&vencs.find(y=>y.k==='DJ'&&y.fecha===x.fecha)
    if(g){ g.forms.push(x.t.replace('DJ ','')); g.t=`Declaraciones juradas ${g.forms.join(' · ')}`; g.s='' } else vencs.push(x.k==='DJ'?{...x, forms:[x.t.replace('DJ ','')]}:{...x}) })
  return {hoy, ciclos, alertas:alertas.sort((a,b)=>a.sev-b.sev), proximos, cicloProx, ajustes, enPlazo, anio:{cols, filas}, vencimientos:vencs} }

// ── CALENDARIO DE UN CLIENTE (Ficha › Resumen › Calendario): lo que ya tiene fecha en la app para ese cliente en los próximos 60 días.
// Contribuciones de sus roles (tabla propiedades; cuotas 30-04/06/09/11 al hábil siguiente), publicación de extractos en el Diario
// Oficial (do_publicacion.vence), causas en tabla (causas.ultima_tabla), plazos de contratos (tabla plazos; los de tipo 'tabla' ya
// salen de la causa) y las obligaciones tributarias elegidas para el cliente (obligaciones_tributarias con client_id), con las
// mismas fechas legales del calendario del estudio (CAL_CL, venceCalTrib, _djFecha).
export const CAL_CLI_DIAS = 60


export const OBL_CLIENTE = [['F29',null,'F29 mensual'],['F22',null,'F22 anual'],['DJ','1879','DJ 1879 · retenciones de honorarios'],['DJ','1887','DJ 1887 · sueldos'],['DJ','1948','DJ 1948 · retiros de socios'],['PATENTE',null,'Patente municipal']]

export function calendarioCliente({hoy, props=[], causas=[], docs=[], plazos=[], obl=[], dj=[], lect=[]}={}){
  hoy = hoy || isoLocal(Date.now())
  const hasta=isoLocal(new Date(new Date(hoy+'T12:00').getTime()+CAL_CLI_DIAS*864e5)), Y=+hoy.slice(0,4), items=[]
  const dentro=f=>f&&f<=hasta, push=x=>{ if(dentro(x.fecha)) items.push({...x, vencido:x.fecha<hoy}) }
  if(props.length){ const conD=props.filter(p=>Number(p.deuda_contribuciones)>0), deuda=conD.reduce((a,p)=>a+Number(p.deuda_contribuciones),0)
    const prox=[Y,Y+1].flatMap(y=>CONTRIB_CUOTAS.map(([mm,n])=>({f:_habilDesde(`${y}-${mm}-30`),n}))).find(x=>x.f>=hoy)
    if(prox) push({fecha:prox.f, t:`Contribuciones · ${prox.n} cuota`, s:`${props.length} rol${props.length===1?'':'es'}${deuda?` · deuda ${fmtMill(deuda)} en ${conD.length} rol${conD.length===1?'':'es'}`:''}`, go:'financiero'}) }
  ;(docs||[]).filter(d=>['pendiente','plazo_vencido'].includes(d.do_estado)&&d.do_publicacion?.vence).forEach(d=>push({fecha:String(d.do_publicacion.vence).slice(0,10), t:'Publicación del extracto', s:`Diario Oficial · ${d.do_estado==='plazo_vencido'?'plazo vencido':'plazo de 60 días'}`, go:'notaria'}))
  const activas=(causas||[]).filter(c=>c.estado==='activa'), enTabla=activas.filter(c=>c.ultima_tabla?.fecha&&c.ultima_tabla.fecha>=hoy)
  enTabla.forEach(c=>push({fecha:c.ultima_tabla.fecha, t:`Vista en tabla · Rol ${c.rol}-${c.anio}`, s:[String(c.corte_nombre||'').replace(/^Corte de Apelaciones de /,'C.A. de '),c.ultima_tabla.sala,c.ultima_tabla.numero?`N° ${c.ultima_tabla.numero}`:''].filter(Boolean).join(' · '), go:'financiero'}))
  ;(plazos||[]).filter(p=>p.estado!=='cumplido'&&p.tipo!=='tabla'&&p.fecha).forEach(p=>push({fecha:String(p.fecha).slice(0,10), t:p.titulo||'Plazo', s:p.descripcion||'Plazo del contrato', go:'plazos'}))
  // Plazos que el Lector de documentos encontró en la carpeta del cliente: quedan «por confirmar» hasta que una persona los
  // confirme (pasan a la tabla plazos y salen de aquí) o los descarte. Los sin fecha exacta no van al calendario.
  ;(lect||[]).forEach(l=>(Array.isArray(l.plazos)?l.plazos:[]).forEach((p,i)=>{ if(p.estado==='propuesto'&&p.fecha) push({fecha:p.fecha, t:p.titulo, s:`En documento · ${l.nombre||'Drive'}`, porConfirmar:{lect:l, idx:i}}) }))
  const elegidas=(obl||[]).filter(o=>o.activo!==false)
  elegidas.forEach(o=>{ if(o.tipo==='F29'){ const ym=hoy.slice(0,7); let per=_ymMas(ym,-1); if(venceCalTrib('F29',per)<hoy) per=ym; push({fecha:venceCalTrib('F29',per), t:`F29 de ${_mesNom(per).split(' ')[0]}`, s:'Obligación tributaria'}) }
    else if(o.tipo==='F22'){ let f=_habilDesde(`${Y}-04-30`); if(f<hoy) f=_habilDesde(`${Y+1}-04-30`); push({fecha:f, t:`F22 · Renta AT ${f.slice(0,4)}`, s:'Obligación tributaria'}) }
    else if(o.tipo==='DJ'){ const r=[Y,Y+1].map(a=>_djFecha(o,(dj||[]).filter(x=>+x.anio_tributario===a))).filter(Boolean).map(r=>_habilDesde(r.fecha)).find(f=>f>=hoy); if(r) push({fecha:r, t:`DJ ${o.formulario}`, s:'Obligación tributaria'}) }
    else if(o.tipo==='PATENTE'){ const m=Array.from({length:8},(_,i)=>_ymMas(hoy.slice(0,7),i)).find(m=>CAL_CL.PATENTE.meses.includes(+m.slice(5,7))&&_finDeMes(m)>=hoy); if(m) push({fecha:_finDeMes(m), t:'Patente municipal', s:'Fecha según la municipalidad'}) } })
  items.sort((a,b)=>a.fecha.localeCompare(b.fecha))
  const noRev=activas.filter(c=>c.ultima_error&&!enTabla.includes(c)).length
  return {items, hoy, seguimiento:activas.length-enTabla.length-noRev, noRev, elegidas, oblTxt:elegidas.map(o=>o.tipo==='DJ'?`DJ ${o.formulario}`:o.tipo==='PATENTE'?'Patente':o.tipo).join(' · ')} }

// Lo que el calendario de un cliente lee de la base (la ficha y Counsel AI usan la misma lectura).
export async function cargarFuentesCalCliente(clientId){
  const [d,p,o,l]=await Promise.all([supabase.from('documentos_notaria').select('id,do_estado,do_publicacion').eq('cliente_id',clientId).in('do_estado',['pendiente','plazo_vencido']),
    supabase.from('plazos').select('*').eq('client_id',clientId), supabase.from('obligaciones_tributarias').select('*').eq('client_id',clientId),
    supabase.from('documentos_lectura').select('id,drive_file_id,nombre,plazos').eq('client_id',clientId).not('plazos','is',null)])
  return {docs:d.data||[], plazos:p.data||[], obl:o.data||[], lect:l.data||[]}
}
// Calendario completo de un cliente para Counsel AI: mismas fuentes y misma función que la ficha (calendarioCliente).
export async function calendarioDeCliente(clientId){
  if(DEMO) return calendarioCliente({props:_DEMO_PROPIEDADES.filter(p=>p.client_id===clientId), causas:_DEMO_CAUSAS.filter(c=>c.client_id===clientId), docs:[], plazos:[], obl:[], dj:[], lect:[]})
  const [pr,ca,f,tr]=await Promise.all([supabase.from('propiedades').select('*').eq('client_id',clientId).limit(2000), supabase.from('causas').select('*').neq('estado','terminada').eq('client_id',clientId), cargarFuentesCalCliente(clientId), cargarCalTrib()])
  return calendarioCliente({props:pr.data||[], causas:ca.data||[], ...f, dj:tr?.dj||[]})
}
// Causas activas (de un cliente o de todos) con su última revisión, para Counsel AI.
export async function causasActivas(clientId=null){
  if(DEMO) return _DEMO_CAUSAS.filter(c=>!clientId||c.client_id===clientId)
  let q=supabase.from('causas').select('*').neq('estado','terminada').order('created_at',{ascending:true})
  if(clientId) q=q.eq('client_id',clientId)
  return (await q).data||[]
}
// Fuentes del calendario del cliente que no trae la ficha: extractos por publicar, plazos y obligaciones elegidas (+ DJ del estudio).
export function useCalCliente(clientId){
  const [f,setF]=useState(null), [dj,setDj]=useState([])
  useEffect(()=>{ let v=true; cargarCalTrib().then(x=>{ if(v) setDj(x.dj||[]) })
    if(DEMO){ const f40=isoLocal(Date.now()+40*864e5)   // ejemplo inventado: un plazo que el lector encontró en un contrato
      setF({docs:[], plazos:[], obl:[], lect:[{id:'dl1',drive_file_id:'demo-arriendo',nombre:'Contrato de arriendo bodega.pdf',plazos:[{titulo:'Término del arriendo',fecha:f40,cita:'El presente contrato tendrá una duración de un año a contar de su firma.',estado:'propuesto'}]}]}); return ()=>{ v=false } }
    cargarFuentesCalCliente(clientId).then(r=>{ if(v) setF(r) },()=>{ if(v) setF({docs:[], plazos:[], obl:[], lect:[]}) })
    return ()=>{ v=false } },[clientId])
  // Elegir/quitar una obligación tributaria del cliente (queda guardada: no se vuelve a preguntar).
  const alternar=useCallback(async(tipo,formulario,detalle)=>{ const ex=(f?.obl||[]).find(o=>o.tipo===tipo&&String(o.formulario||'')===String(formulario||''))
    const nuevo=ex?{...ex,activo:ex.activo===false}:{client_id:clientId,tipo,formulario,detalle,activo:true}
    setF(x=>({...x, obl:ex?x.obl.map(o=>o===ex?nuevo:o):[...x.obl,nuevo]}))
    if(DEMO) return
    const {data,error}=ex?.id?await supabase.from('obligaciones_tributarias').update({activo:nuevo.activo}).eq('id',ex.id).select().single():await supabase.from('obligaciones_tributarias').insert({client_id:clientId,tipo,formulario,detalle,activo:true}).select().single()
    if(error){ setF(x=>({...x, obl:ex?x.obl.map(o=>o===nuevo?ex:o):x.obl.filter(o=>o!==nuevo)})); appAlert('No se pudo guardar: '+error.message); return }
    setF(x=>({...x, obl:x.obl.map(o=>o===nuevo?data:o)}))
    logActividad(nuevo.activo?'calendario.obligacion_cliente':'calendario.obligacion_cliente_quitada',{tabla:'clients',id:clientId,detalle:{title:`${detalle||tipo} ${nuevo.activo?'elegida':'quitada'} para el cliente`}}) },[clientId,f])
  // Plazo encontrado en un documento: confirmar = pasa a la tabla plazos (con la cita como descripción); descartar = no vuelve a salir.
  const resolverPlazoDoc=useCallback(async({lect,idx},confirmar)=>{ const p=(lect.plazos||[])[idx]; if(!p) return
    let plazoId=null
    if(confirmar&&!DEMO){ const {data,error}=await supabase.from('plazos').insert({client_id:clientId,titulo:p.titulo,descripcion:p.cita||p.descripcion||null,tipo:'plazo',fecha:p.fecha,estado:'pendiente',fuente:'documento',file_id:lect.drive_file_id}).select('*').single()
      if(error){ appAlert('No se pudo confirmar el plazo: '+error.message); return } plazoId=data.id; setF(x=>({...x, plazos:[...(x.plazos||[]),data]})) }
    if(confirmar&&DEMO) setF(x=>({...x, plazos:[...(x.plazos||[]),{id:'demo-'+Date.now(),client_id:clientId,titulo:p.titulo,descripcion:p.cita,tipo:'plazo',fecha:p.fecha,estado:'pendiente',fuente:'documento'}]}))
    const nuevos=(lect.plazos||[]).map((q,j)=>j===idx?{...q,estado:confirmar?'confirmado':'descartado',...(plazoId?{plazo_id:plazoId}:{})}:q)
    if(!DEMO){ const {error}=await supabase.from('documentos_lectura').update({plazos:nuevos}).eq('id',lect.id); if(error){ appAlert('No se pudo guardar: '+error.message); return } }
    setF(x=>({...x, lect:(x.lect||[]).map(l=>l.id===lect.id?{...l,plazos:nuevos}:l)}))
    logActividad(confirmar?'documentos.plazo_confirmado':'documentos.plazo_descartado',{tabla:'clients',id:clientId,detalle:{title:`Plazo ${confirmar?'confirmado':'descartado'} del documento «${lect.nombre||''}»: ${p.titulo}${p.fecha?` · ${fmtFechaDMY(p.fecha)}`:''}`}}) },[clientId])
  return {f, dj, alternar, resolverPlazoDoc} }

// Fuentes del calendario (se leen una vez por sesión; `recargarCalTrib` al marcar una presentada).
export let _calTribP=null

export const _DEMO_CALTRIB = (()=>{ const ym=isoLocal(Date.now()).slice(0,7), y=+ym.slice(0,4), valores={}, pagos=[], docs=[], boletas=[]
  for(let i=0;i<6;i++){ const per=_ymMas(ym,-i-1), c=1800000+i*15000, p=700000+i*40000
    valores[per]={mes:per, cotizaciones:c, ppm:p, contadora:45000}
    docs.push({tipo_dte:34, fecha_emision:`${per}-20`, monto:28000000+i*1500000}); boletas.push({fecha:`${per}-10`, retencion:60000+i*5000})
    pagos.push({id:'dct'+i, category:'Leyes sociales', subcategory:'Cotizaciones', date:`${_ymMas(per,1)}-12`, amount:c, concept:`Cotizaciones sueldos ${per.slice(5,7)}-${per.slice(0,4)}`},
      {id:'dpp'+i, category:'Impuestos y patentes', subcategory:'PPM', date:`${_ymMas(per,1)}-12`, amount:i===1?p-21500:p, concept:`IVA/PPM ${per.slice(5,7)}-${per.slice(0,4)}${i===1?' (retención boleta N° 12 $21.500 va en el costo de su boleta)':''}`}) }
  pagos.push({id:'dpat', category:'Impuestos y patentes', subcategory:'Patente municipal', date:`${_ymMas(ym,-1)}-10`, amount:290000, concept:'Patente municipal'})
  const obl=['F29','COT','F22','PATENTE'].map(t=>({tipo:t, activo:true, client_id:null})).concat([['1879','Retenciones de honorarios'],['1887','Sueldos']].map(([f,d])=>({tipo:'DJ', formulario:f, detalle:d, activo:true, client_id:null})))
  const dj=[y,y+1].flatMap(a=>[{anio_tributario:a, formulario:'1879', detalle:'', fecha:`${a}-03-15`},{anio_tributario:a, formulario:'1887', detalle:'', fecha:`${a}-03-15`}])
  return {obl, dj, valores, cumplidas:[], pagos, docs, boletas} })()

export function cargarCalTrib(){
  if(DEMO) return Promise.resolve(_DEMO_CALTRIB)
  if(!_calTribP){ const y=new Date().getFullYear()
    _calTribP=Promise.all([supabase.from('obligaciones_tributarias').select('*').is('client_id',null), supabase.from('sii_dj_vencimientos').select('*').in('anio_tributario',[y,y+1]),
      supabase.from('learnings').select('key,value').eq('kind','valores_contadora'), supabase.from('obligaciones_cumplidas').select('*').is('client_id',null),
      supabase.from('sii_novedades').select('url').eq('tipo','resolucion').ilike('titulo','%vencimiento%declaraciones juradas%').order('fecha',{ascending:false}).limit(1),
      // F29 estimado de mes cerrado (f29Reglas): facturas del Registro de Ventas y boletas recibidas de los últimos 4 meses.
      supabase.from('sii_cargas_docs').select('tipo_dte,fecha_emision,monto').gte('fecha_emision',`${_ymMas(isoLocal(Date.now()).slice(0,7),-4)}-01`),
      supabase.from('boletas_honorarios').select('fecha,retencion,estado').gte('fecha',`${_ymMas(isoLocal(Date.now()).slice(0,7),-4)}-01`),
      // F29 declarados (leídos del SII; solo administradores): tasa del PPM e impuesto único del mes anterior.
      supabase.from('f29_declarados').select('periodo,tasa_ppm,impuesto_unico,total').order('periodo',{ascending:false}).limit(12)])
      .then(([o,d,v,c,u,sd,bh,fd])=>{ const valores={}, declarados={}; (fd?.data||[]).forEach(r=>{ declarados[r.periodo]=r }); (v.data||[]).forEach(r=>{ try{ const x=JSON.parse(r.value); if(x&&/^\d{4}-\d{2}$/.test(r.key)) valores[r.key]=x }catch(_){} })
        return {obl:o.data||[], dj:d.data||[], valores, declarados, cumplidas:c.data||[], pagos:[], docs:sd.data||[], boletas:bh.data||[], urlSII:u?.data?.[0]?.url||null} })
      .catch(()=>{ _calTribP=null; return {obl:[], dj:[], valores:{}, cumplidas:[], pagos:[], docs:[], boletas:[]} }) }
  return _calTribP }

export function useCalTrib(expenses){
  const [f,setF]=useState(null), [n,setN]=useState(0)
  useEffect(()=>{ let v=true; cargarCalTrib().then(x=>{ if(v) setF(x) }); return ()=>{ v=false } },[n])
  const recargar=useCallback(()=>{ _calTribP=null; setN(x=>x+1) },[])
  const cal=useMemo(()=>f?calendarioEstudio({...f, expenses:f.pagos.length?[...(expenses||[]).filter(e=>!['Impuestos y patentes','Leyes sociales'].includes(e.category)),...f.pagos]:expenses}):null,[f,expenses])
  return {cal, recargar, urlSII:f?.urlSII||null} }

// Barra de tabs de la ficha de cliente (reutilizada por admin y limited; bloquea según rol)
export function FichaTabs({tab,setTab,role}){
  const all=[['resumen','Resumen','grid'],['contacto','Contacto','id'],['financiero','Ventas','briefcase'],['documentos','Cartola','receipt']]
  // El limited solo ve Resumen y Contacto (Financiero/Documentos no se renderizan)
  const tabs = role==='admin' ? all : all.filter(([id])=>id==='resumen'||id==='contacto')
  return (
    <div style={{display:'flex',gap:6,marginTop:10}}>
      {tabs.map(([id,label,icon])=>{ const on=tab===id; return (
        <button key={id} onClick={()=>setTab(id)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,padding:'8px 2px',borderRadius:10,border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:'#fff',cursor:'pointer'}}>
          <SIcon n={icon} s={17} c={on?'#fff':C.muted}/>
          <span style={{fontSize:10,fontWeight:on?700:600,color:on?'#fff':C.muted,whiteSpace:'nowrap'}}>{label}</span>
        </button>
      )})}
    </div>
  )
}

// "Destinatario de facturas" de la ficha: fija el Para (1 contacto) + CC del cliente, auto-guardado en learnings
// (factura_to / factura_cc) — el mismo dato que el modal de envío aprende y reusa. Así se puede fijar sin mandar una factura.
export function DestinatarioFacturasCard({client, contacts=[], embedded=false}){
  const [to,setTo]=useState('')
  const [cc,setCc]=useState([])
  const [ccInput,setCcInput]=useState('')
  const [saved,setSaved]=useState(false)
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('learnings').select('kind,value').in('kind',['factura_to','factura_cc']).eq('key',String(client.id)).then(({data})=>{ if(!alive) return; (data||[]).forEach(r=>{ if(r.kind==='factura_to') setTo(String(r.value||'').trim()); if(r.kind==='factura_cc') setCc(String(r.value||'').split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean)) }) },()=>{})
    return ()=>{alive=false} },[client?.id])
  const flash=()=>{ setSaved(true); setTimeout(()=>setSaved(false),1500) }
  const saveTo=async v=>{ setTo(v); if(!client?.id) return; try{ if(v.trim()) await setLearningKV('factura_to',String(client.id),v.trim()); else await supabase.from('learnings').delete().eq('kind','factura_to').eq('key',String(client.id)); flash() }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
  const saveCc=async arr=>{ setCc(arr); if(!client?.id) return; try{ if(arr.length) await setLearningKV('factura_cc',String(client.id),arr.join(',')); else await supabase.from('learnings').delete().eq('kind','factura_cc').eq('key',String(client.id)); flash() }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
  const addCc=em=>{ const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(to||'').toLowerCase()) saveCc([...cc,e]); setCcInput('') }
  const conEmail=(contacts||[]).filter(c=>c.email)
  const inpS={width:'100%',padding:'9px 11px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,background:'#fff',boxSizing:'border-box'}
  return (<div style={embedded?{}:{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginTop:12}}>
    {!embedded&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
      <div style={{...SEC_LBL,flex:1}}>Destinatario de facturas</div>
      {saved&&<span style={{fontSize:10,color:C.greenText,fontWeight:600}}>guardado <Gl n='tick'/></span>}
      <span style={{fontSize:9.5,color:C.muted,background:C.bgWarm,borderRadius:20,padding:'2px 8px',fontWeight:700,whiteSpace:'nowrap'}}>Se aprende del envío</span>
    </div>}
    <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>Para {embedded&&saved&&<span style={{color:C.greenText}}>· guardado <Gl n='tick'/></span>}</div>
    {conEmail.length>0
      ? <select value={to} onChange={e=>saveTo(e.target.value)} style={inpS}>
          <option value=''>— Elegir contacto —</option>
          {conEmail.map(c=><option key={c.id||c.email} value={c.email}>{c.nombre?`${c.nombre} · ${c.email}`:c.email}</option>)}
          {to&&!conEmail.some(c=>(c.email||'').toLowerCase()===to.toLowerCase())&&<option value={to}>{to}</option>}
        </select>
      : <input value={to} onChange={e=>setTo(e.target.value)} onBlur={()=>saveTo(to)} placeholder='correo@cliente.cl' style={inpS}/>}
    <div style={{fontSize:10,color:C.muted,fontWeight:600,margin:'12px 0 5px'}}>En copia (CC)</div>
    <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
      {cc.map(e=><span key={e} style={{fontSize:10,background:C.azulBg,color:C.accent,borderRadius:20,padding:'2px 4px 2px 9px',display:'inline-flex',alignItems:'center'}}>{e}<button type='button' onClick={()=>saveCc(cc.filter(x=>x!==e))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontWeight:700,padding:'0 4px'}}><Gl n='x'/></button></span>)}
      <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addCc(ccInput) } }} onBlur={()=>addCc(ccInput)} placeholder='+ correo' style={{flex:1,minWidth:90,padding:'6px 8px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/>
    </div>
    {conEmail.filter(c=>(c.email||'').toLowerCase()!==(to||'').toLowerCase()&&!cc.includes((c.email||'').toLowerCase())).length>0&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:6}}>{conEmail.filter(c=>(c.email||'').toLowerCase()!==(to||'').toLowerCase()&&!cc.includes((c.email||'').toLowerCase())).map(c=><button key={c.id||c.email} type='button' onClick={()=>addCc(c.email)} style={{fontSize:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.accent,borderRadius:20,padding:'2px 9px',cursor:'pointer'}}>+ {c.nombre||c.email}</button>)}</div>}
  </div>)
}

export const subproyectosCliente = (clientId, tasks=[], expenses=[]) => [...new Set([...(tasks||[]),...(expenses||[])].filter(x=>String(x.client_id)===String(clientId)&&x.subproject).map(x=>x.subproject.trim()))].sort((a,b)=>a.localeCompare(b,'es'))

// COTEJO por venta: cuota programada del trabajo ENFRENTADA a la factura emitida asociada, y las facturas al
// mismo RUT sin asociar (huérfanas). Solo LEE el cruce (planDeVenta + cuota N/M); el único write es asociar a mano
// una huérfana a un hueco → reusa onReplaceProgramada (handleReplaceProgramada: soft-delete + replaced_by_id + undo).
// NO toca los motores de conciliación. Desktop = dos columnas enfrentadas; móvil = par apilado.
export const _MES_AB = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

// Re-adjunta el PDF con timbre de una factura: se regenera al vuelo desde su DTE (por regla, toda factura tiene XML).
// Recordar cobro de UNA factura (FUENTE ÚNICA ficha › Financiero y «Por cobrar a mis clientes»): sale desde la cuenta del usuario,
// con el PDF de la factura y la nota guardada del cliente. `cc` opcional (el abogado limitado copia a la oficina).
export async function recordarCobroFactura(b, client, {cc=null}={}){
  const to=(client.email||'').trim()
  if(!to){ appAlert('El cliente no tiene correo en su ficha. Agrégalo para poder recordar el cobro.'); return }
  let nota=''; try{ const {data}=await supabase.from('learnings').select('value').eq('kind','recordatorio_nota').eq('key',String(client.id)).maybeSingle(); nota=data?.value||'' }catch(_){}
  const r=recordatorioCobro(b, nota)   // incluye la nota guardada de este cliente
  if(!await appConfirm(`¿Enviar recordatorio de cobro a ${to} por ${r.folio} (${r.monto})? Se adjunta el PDF de la factura.`)) return
  try{ const ad=await facturaPdfAdjunto(b); const via=await enviarComoUsuario({to, cc, subject:r.subject, html:r.html, text:r.text, attachments:ad?[ad]:null}); if(via){ try{ await setLearningKV('factura_recordado',String(b.id),new Date().toISOString()) }catch(e){registrarError({origen:'accion',vista:'factura_recordado',err:e})}; appAlert(txtEnviado(via,{que:'Recordatorio',para:to})) } }
  catch(e){ appAlert('No se pudo enviar el recordatorio: '+e.message) }
}

// ─── REVISIÓN IA DE GMAIL → CONTACTOS DE CLIENTES ─────────────────────────────
// Lee el Gmail corporativo (scope gmail.readonly), extrae participantes externos, los asocia a clientes
// (dominio conocido → directo; ambiguos → IA Opus) y propone agregarlos a la ficha. Compuerta humana.
// Privacidad: a la IA solo van encabezados (De/Para/CC/Asunto) y dominio, nunca el cuerpo.
// ─── CAUSAS EN TABLA (agente causas-tablas) ─────────────────────────────────────────────────────────────────────
// Causas del estudio en Cortes de Apelaciones y Corte Suprema. Se agregan en Ficha › Ventas › la venta respectiva; Clientes › Causas
// es la vista de todas. El agente lee el Monitor de Salas público (salas.pjud.cl; días hábiles 08:00–15:45, y cada 15 minutos la sala donde hoy hay una causa) y avisa
// por correo desde la casilla de la oficina al abogado, con copia al dueño del cliente y a los no socios. Cada revisión queda en
// causas_seguimiento (botón «Seguimiento»).
export const CORTES_PJUD = [['2011001','Corte de Apelaciones de Arica'],['2101002','Corte de Apelaciones de Iquique'],['2301003','Corte de Apelaciones de Antofagasta'],['2401004','Corte de Apelaciones de Copiapó'],['2501005','Corte de Apelaciones de La Serena'],['3101006','Corte de Apelaciones de Valparaíso'],['6051007','Corte de Apelaciones de Santiago'],['6231008','Corte de Apelaciones de San Miguel'],['3351009','Corte de Apelaciones de Rancagua'],['3901010','Corte de Apelaciones de Talca'],['4151011','Corte de Apelaciones de Chillán'],['4551013','Corte de Apelaciones de Concepción'],['4901014','Corte de Apelaciones de Temuco'],['5101015','Corte de Apelaciones de Valdivia'],['5351016','Corte de Apelaciones de Puerto Montt'],['5651017','Corte de Apelaciones de Coyhaique'],['5901018','Corte de Apelaciones de Punta Arenas'],['6050000','Corte Suprema']]

// Libros de las Cortes de Apelaciones (pjud.cl): el número de rol se repite en cada libro, por eso es obligatorio.
export const LIBROS_PJUD = [['28','Civil'],['29','Familia'],['30','Laboral - Cobranza'],['31','Penal'],['32','Contencioso Administrativo'],['33','Tributario Y Aduanero'],['34','Protección'],['35','Amparo'],['36','Policia Local'],['37','Exhorto'],['38','Ley De Navegación'],['39','Ambiental'],['41','Ministro Primera Instancia Y Fuero']]

export const _libroLegible = n => String(n||'').replace(/\bY\b/g,'y').replace(/\bDe\b/g,'de').replace(/Policia/,'Policía')

export const _corteCorta = n => String(n||'').replace('Corte de Apelaciones de ','C.A. ')

export const _rolTxt = c => /^\d+$/.test(String(c.rol||'')) ? `Rol ${c.rol}-${c.anio}` : 'Rol por completar'

export const _DEMO_CAUSAS = [
  { id:'cz1', client_id:'c1', sale_id:'s1', abogado:'Cristóbal', instancia:'apelaciones', corte_codigo:'2501005', corte_nombre:'Corte de Apelaciones de La Serena', libro_codigo:'33', libro_nombre:'Tributario Y Aduanero', rol:'15', anio:2025, caratula:'Demo / SII Dirección Regional La Serena', estado:'activa', ultima_tabla:{sala:'Segunda Sala',numero:'5',fecha:isoLocal(new Date().toISOString()),estado_dia:'En Tabla',viendo:3,fuente:'monitor'}, ultima_fuente:'monitor', avisado_fecha:isoLocal(new Date().toISOString()), ultima_revision_at:'2026-10-23T11:00:00Z' },
  { id:'cz3', client_id:'c1', sale_id:'s1', abogado:'Cristóbal', instancia:'apelaciones', corte_codigo:'2501005', corte_nombre:'Corte de Apelaciones de La Serena', libro_codigo:'33', libro_nombre:'Tributario Y Aduanero', rol:'18', anio:2025, caratula:'Demo Agrícola / SII Dirección Regional La Serena', estado:'activa', ultima_fuente:'monitor', ultima_revision_at:'2026-10-23T11:00:00Z' },
  { id:'cz2', client_id:'c1', sale_id:'s1', abogado:'Erasmo', instancia:'apelaciones', corte_codigo:'6051007', corte_nombre:'Corte de Apelaciones de Santiago', libro_codigo:'34', libro_nombre:'Protección', rol:'', anio:2026, caratula:'Demo con Isapre', estado:'por_confirmar' },
]

export function useCausas({clientId=null}={}){
  const [rows,setRows]=useState(null)
  const cargar=useCallback(()=>{ if(DEMO){ setRows(_DEMO_CAUSAS.filter(c=>!clientId||c.client_id===clientId)); return }
    let q=supabase.from('causas').select('*').neq('estado','terminada').order('created_at',{ascending:true})
    if(clientId) q=q.eq('client_id',clientId)
    q.then(({data})=>setRows(data||[]),()=>setRows([])) },[clientId])
  useEffect(()=>{ cargar() },[cargar])
  return {rows,setRows,recargar:cargar}
}

export const _estadoCausa = c => { const t=c.ultima_tabla, hoy=isoLocal(new Date().toISOString())
  if(c.estado==='por_confirmar') return ['Por confirmar',C.textSoft,C.track]
  if(c.ultima_error) return ['No se pudo revisar',C.overdueText,C.overdueBg]   // la última revisión falló: nunca «Sin tabla» sin confirmar
  if(t?.fecha&&t.fecha>=hoy) return t.fecha===hoy?[`Hoy · ${t.estado_dia||'En tabla'}`,C.soonText,C.soonBg]:[`En tabla · ${fmtFechaDMY(t.fecha)}`,C.accent,C.azulBg]
  // «Sin tabla» = la Programación de Salas lo confirmó en las últimas 36 h (computador de la oficina); si solo hay Monitor, es del día.
  const progOk=c.programacion_at&&Date.now()-new Date(c.programacion_at).getTime()<36*3600e3
  return [progOk||c.ultima_fuente!=='monitor'?'Sin tabla':'Sin tabla hoy',C.textSoft,C.track] }

// Roles de avalúo (tabla propiedades) de una venta, en la ficha del cliente (render FCPbqjEjNk3RsHYSxum8CD aprobado): por comuna y,
// en una comuna con muchos roles, por destino (sitios eriazos, agrícolas, habitacionales, sin propiedad en el SII, otros). Todo
// plegado; cada rol se abre con su detalle. Los cruza el agente tgr-remates (comuna + rol).
export const _DEMO_PROPIEDADES = [
  {id:'pr1',client_id:'c1',sale_id:'s1',comuna:'Linares',rol:'1100-134',lote:'5',nombre:'La Posada LT 5',destino:'Sitio Eriazo',propietario:'Inversiones Demo Limitada',propietario_actual:'Agrícola Demo SpA',inscripcion_fojas:'2027',inscripcion_numero:'2787',inscripcion_anio:1993,superficie_m2:6000,arrendado:true,deuda_contribuciones:1668992,notas:'Deuda neta $1.326.708',fuente:'Planilla demo · Hoja 3'},
  {id:'pr2',client_id:'c1',sale_id:'s1',comuna:'Linares',rol:'1100-135',lote:'6',nombre:'La Posada LT 6',destino:'Sitio Eriazo',propietario:'Inversiones Demo Limitada',superficie_m2:5600,arrendado:true,deuda_contribuciones:1664243,fuente:'Planilla demo · Hoja 3'},
  {id:'pr3',client_id:'c1',sale_id:'s1',comuna:'Linares',rol:'1100-7',lote:'7',nombre:'Fdo El Martillo LT 7',destino:'Agrícola',propietario:'Familia Demo y otros',superficie_m2:6450,arrendado:true,fuente:'Planilla demo · Hoja 3'},
  {id:'pr4',client_id:'c1',sale_id:'s1',comuna:'Linares',rol:'1100-2',lote:'2',estado_sii:'No existe propiedad asociada al rol en TGR ni SII',propietario:'Inversiones Demo Limitada',superficie_m2:6355,fuente:'Planilla demo · Hoja 3'},
  {id:'pr5',client_id:'c1',sale_id:'s1',comuna:'Linares',rol:'196-8',direccion:'INDEPENDENCIA 548',propietario:'Inversiones Demo Limitada',avaluo_fiscal:165457369,avaluo_afecto:165457369,porcentaje_derecho:100,inscripcion_fojas:'1318',inscripcion_numero:'1839',inscripcion_anio:1993,fuente:'Planilla demo · Hoja 1'},
  {id:'pr6',client_id:'c1',sale_id:'s1',comuna:'Las Condes',rol:'210-378',direccion:'NAPOLEON 3310 DP 106',propietario:'Inversiones Demo Limitada',avaluo_fiscal:79756594,porcentaje_derecho:100,fuente:'Planilla demo · Hoja 1'},
]

export function usePropiedades({clientId}){
  const [rows,setRows]=useState(null)
  const cargar=useCallback(()=>{ if(DEMO){ setRows(_DEMO_PROPIEDADES.filter(p=>p.client_id===clientId)); return }
    supabase.from('propiedades').select('*').eq('client_id',clientId).limit(2000).then(({data})=>setRows(data||[]),()=>setRows([])) },[clientId])
  useEffect(()=>{ cargar() },[cargar])
  return {rows,setRows,recargar:cargar}
}

export const _ordRol = (a,b) => { const [a1,a2]=String(a.rol).split('-').map(Number), [b1,b2]=String(b.rol).split('-').map(Number); return (a1-b1)||(a2-b2)||String(a.rol).localeCompare(String(b.rol)) }

export const _nomProp = p => p&&p===p.toUpperCase()?titleCase(p).replace(/\bSpa\b/g,'SpA'):(p||'')

export const _GRUPO_DESTINO = [['Sitio Eriazo','Sitios eriazos'],['Agrícola','Agrícolas'],['Habitacional','Habitacionales']]

// "En mi lista": soy responsable o me delegaron la tarea (los delegados también la ven).
export const enMiLista = (t,name) => isAssignee(t,name) || (!!name && ((t&&t.delegated_to)||[]).includes(name))

// Agregar el vencimiento de una tarea a Google Calendar (evento de día completo): API si hay permiso; si no, link pre-armado (sin scope).
export async function agendarTareaCalendar(t, clients=[]){
    if(!t.due){ appAlert('Esta tarea no tiene fecha de vencimiento.'); return }
    const cl=clients.find(c=>c.id===t.client_id)
    const desc=[cl?('Cliente: '+cl.name):'',t.project?('Proyecto: '+t.project):'',t.assigned_by?('Asignada por '+t.assigned_by):''].filter(Boolean).join('\n')
    const end=new Date(t.due+'T00:00:00'); end.setDate(end.getDate()+1); const endISO=end.toISOString().slice(0,10)
    const dd=t.due.replace(/-/g,''), ddEnd=endISO.replace(/-/g,'')
    const abrirLink=()=>{ const url=`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Tarea: '+(t.title||''))}&dates=${dd}/${ddEnd}&details=${encodeURIComponent(desc)}&ctz=America/Santiago`; window.open(url,'_blank','noopener') }
    const token = await driveToken()
    if(!token){ abrirLink(); return }
    try{
      const body={ summary:'Tarea: '+(t.title||''), description:desc, start:{date:t.due}, end:{date:endISO}, reminders:{useDefault:true} }
      const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
      if(!r.ok){ if(r.status===401||r.status===403){ abrirLink(); return } throw new Error('Calendar '+r.status) }
      appAlert('Agregado a tu Google Calendar para el '+fmtFechaDMY(t.due)+'.')
    }catch(e){ abrirLink() }
  }

export function TaskPreview({task,clients,onEdit,onComplete,onClose}) {
  const [comments,setComments] = useState([])
  // Evidencia del agente (edge tareas-evidencia): lo que pide la tarea ya está en los registros. «No corresponde» no se vuelve a proponer.
  const [evNo,setEvNo] = useState(false)
  const ev = task?.evidencia && !task.evidencia.descartada && !evNo ? task.evidencia : null
  const noCorresponde = async()=>{ const nv={...task.evidencia,descartada:true}
    if(!DEMO){ const {error}=await supabase.from('tasks').update({evidencia:nv}).eq('id',task.id); if(error){ appAlert('No se pudo guardar: '+error.message); return } }
    task.evidencia=nv; setEvNo(true); logActividad('tareas.evidencia_descartada',{tabla:'tasks',id:task.id,detalle:{title:`«${task.title}»: no corresponde (${nv.texto})`}}) }
  const [links,setLinks] = useState([])
  useEffect(()=>{
    if(!task?.id) return
    Promise.all([
      supabase.from('task_comments').select('id,content,user_name,created_at').eq('task_id',task.id).order('created_at',{ascending:false}).then(({data})=>data||[]),
      supabase.from('task_links').select('id,title,url').eq('task_id',task.id).then(({data})=>data||[]),
    ]).then(([c,l])=>{setComments(c);setLinks(l)})
  },[task?.id])

  const client = clients.find(c=>c.id===task.client_id)
  const subs = Array.isArray(task.subtasks)?task.subtasks:[]
  const subsDone = subs.filter(s=>s&&s.done).length
  const d = task.due?daysLeft(task.due):null
  const plazoCol = task.due?urgencyColor(task.due,task.status):C.muted
  const plazoTxt = !task.due ? 'Sin fecha'
    : d<0 ? `${fmtDate(task.due)} · ${Math.abs(d)}d atrasada`
    : d===0 ? `${fmtDate(task.due)} · hoy`
    : `${fmtDate(task.due)} · ${d}d`
  const terminada = task.status==='Terminado'
  const contexto = [client?.name,task.project,task.subproject].filter(Boolean).join(' · ')

  const Row = ({label,children}) => (
    <div style={{marginBottom:12}}>
      <div style={{...SEC_LBL,marginBottom:3}}>{label}</div>
      <div style={{fontSize:13,color:C.text}}>{children}</div>
    </div>
  )

  return (
    <>
      <div style={{fontSize:16,fontWeight:600,color:C.text,lineHeight:1.3,marginBottom:14}}>{task.title}</div>
      {contexto&&<Row label='Cliente · Proyecto'>{contexto}</Row>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Row label='Responsable'>{taskAssignees(task).join(', ')||'—'}</Row>
        {task.assigned_by&&<Row label='Asignó'>{task.assigned_by}</Row>}
      </div>
      {(task.delegated_to||[]).length>0&&(
        <div style={{fontSize:12,color:C.soonText,background:C.ambarBg,borderRadius:8,padding:'8px 11px',margin:'2px 0 10px'}}>
          <span style={{fontWeight:600}}>{task.delegated_by}</span> la delegó a <span style={{fontWeight:600}}>{(task.delegated_to||[]).join(', ')}</span>{task.delegated_due?` · vence ${task.delegated_due}`:''}
          {task.delegated_note&&<div style={{marginTop:4,fontStyle:'italic'}}>"{task.delegated_note}"</div>}
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Row label='Plazo'><span style={{fontWeight:600,color:plazoCol}}>{plazoTxt}</span></Row>
        <Row label='Estado'>{task.status||'—'}</Row>
      </div>
      {terminada&&task.completion_note&&(
        <div style={{background:C.greenBg,borderRadius:8,padding:'10px 12px',margin:'0 0 12px'}}>
          <div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Gestión realizada{task.completion_status?` · ${task.completion_status}`:''}</div>
          <div style={{fontSize:13,color:C.text,lineHeight:1.5,whiteSpace:'pre-wrap'}}>{task.completion_note}</div>
          {task.completed_by&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Reportó {task.completed_by}{task.completed_at?` · ${fmtDate(String(task.completed_at).slice(0,10))}`:''}</div>}
        </div>
      )}
      {!terminada&&ev&&(
        <div style={{background:C.greenBg,borderRadius:8,padding:'10px 12px',margin:'0 0 12px'}}>
          <div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Cumplida según los registros</div>
          <div style={{fontSize:13,color:C.text,lineHeight:1.5}}>{ev.texto}</div>
          <div style={{display:'flex',gap:8,marginTop:8,justifyContent:'flex-end'}}>
            <button onClick={noCorresponde} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',padding:'6px 8px',cursor:'pointer'}}>No corresponde</button>
            <button onClick={()=>onComplete({...task,completion_status:'Completada',completion_note:ev.texto})} style={{fontSize:12.5,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:9,padding:'6px 14px',cursor:'pointer'}}>Marcar cumplida</button>
          </div>
        </div>
      )}
      {subs.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{...SEC_LBL,marginBottom:5}}>Subtareas · {subsDone}/{subs.length}</div>
          {subs.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
              <span style={{width:14,height:14,borderRadius:4,border:`2px solid ${s.done?C.normal:C.done}`,background:s.done?C.normal:'#fff',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{s.done&&<span style={{color:'#fff',fontSize:9}}><Gl n='tick'/></span>}</span>
              <span style={{fontSize:12,color:C.text,textDecoration:s.done?'line-through':'none',opacity:s.done?.6:1}}>{s.text}</span>
            </div>
          ))}
        </div>
      )}
      {comments.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{...SEC_LBL,marginBottom:5}}>Comentarios · {comments.length}</div>
          <div style={{background:C.bgSoft,borderRadius:8,padding:'8px 10px'}}>
            <div style={{fontSize:10,fontWeight:600,color:C.accent,marginBottom:2}}>{comments[0].user_name}</div>
            <div style={{fontSize:12,color:C.text,lineHeight:1.4}}>{comments[0].content}</div>
          </div>
        </div>
      )}
      {links.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{...SEC_LBL,marginBottom:5}}>Archivos · {links.length}</div>
          {links.slice(0,3).map(lk=>(
            <a key={lk.id} href={lk.url} target='_blank' rel='noreferrer' style={{display:'block',fontSize:12,color:C.accent,textDecoration:'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{lk.title||lk.url}</a>
          ))}
        </div>
      )}
      {!terminada&&task.due&&<div style={{marginTop:6}}><ActBtn full onClick={()=>agendarTareaCalendar(task, clients)} style={{color:C.accent}}>Agendar en Google Calendar</ActBtn></div>}
      <div style={{display:'flex',gap:8,marginTop:6}}>
        <button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        {!terminada&&<button onClick={()=>onComplete(task)} style={{flex:1,padding:'9px 14px',borderRadius:10,border:'1px solid #1D9E75',background:C.greenBg,color:C.greenText,fontSize:13,fontWeight:700,cursor:'pointer'}}>Marcar terminada</button>}
        <button onClick={()=>onEdit(task)} style={{flex:1,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Editar</button>
      </div>
    </>
  )
}

// Helper reutilizable (lo usan el modal "Tareas +Gmail" y el hero de Tareas): lee correos NO LEÍDOS
// (asunto + snippet), la IA detecta acciones pendientes y devuelve sugerencias de tarea. Solo encabezados+snippet a la IA.
export async function escanearTareasGmail(clients=[], onProgress){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const q=encodeURIComponent('is:unread -in:spam -in:trash')
  const CAP=120; let ids=[], pageToken=''
  while(ids.length<CAP){
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken?`&pageToken=${pageToken}`:''}`,{headers:{Authorization:'Bearer '+token}})
    if(!r.ok){ const e=new Error('Gmail '+r.status); e.code=r.status; throw e }
    const j=await r.json(); (j.messages||[]).forEach(m=>ids.push(m.id)); pageToken=j.nextPageToken; if(!pageToken) break
  }
  ids=ids.slice(0,CAP)
  if(!ids.length) return []
  const correos=[]; let done=0
  const fetchMeta=async(id)=>{
    try{
      const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,{headers:{Authorization:'Bearer '+token}})
      if(!r.ok) return; const j=await r.json()
      const H={}; (j.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
      const from=H['from']||''; const subj=H['subject']||''
      const m=from.match(/<(.+?)>/); const email=(m?m[1]:from).trim().toLowerCase()
      if(!email.includes('@')) return
      if(/no-?reply|noreply|notif|mailer-daemon|newsletter|bounce|postmaster|@.*(facebook|linkedin|twitter|mailchimp)/.test(email)) return
      correos.push({id, from:email, fromName:(from.replace(/<.+?>/,'').replace(/["']/g,'').trim())||email, subject:subj, snippet:(j.snippet||'')})
    }catch(_){}
    done++; if(onProgress&&done%10===0) onProgress(done,ids.length)
  }
  for(let i=0;i<ids.length;i+=8){ await Promise.all(ids.slice(i,i+8).map(fetchMeta)) }
  if(!correos.length) return []
  const clientList=clients.filter(c=>c.status!=='Terminado').map(c=>({id:c.id,nombre:c.name}))
  const hoyISO=new Date().toISOString().slice(0,10); const out=[]
  for(let i=0;i<correos.length;i+=20){
    const batch=correos.slice(i,i+20); if(onProgress) onProgress(correos.length===0?0:Math.min(correos.length,i),correos.length)
    const prompt=`Eres asistente de un abogado del estudio ${BRAND.nombre}. Te paso CORREOS (remitente, asunto, vista previa) y la lista de CLIENTES. Para cada correo decide si implica una TAREA o acción pendiente PARA MÍ (responder, enviar algo, revisar, gestionar, cumplir un plazo). Si NO es tarea (newsletter, notificación, info sin acción, publicidad), devuélvelo con "task":false. Para los que sí: "title" breve en infinitivo (ej. "Enviar borrador a Cavor"), "client_id" (de la lista o null), "due" (YYYY-MM-DD solo si el correo menciona un plazo concreto, si no null) y "note" (1 frase de contexto). Hoy es ${hoyISO}. Devuelve SOLO un JSON array: [{"id":"...","task":true,"title":"...","client_id":"<id o null>","due":"YYYY-MM-DD|null","note":"..."}]. NUNCA inventes un client_id fuera de la lista.\nCLIENTES:\n${JSON.stringify(clientList)}\nCORREOS:\n${JSON.stringify(batch.map(c=>({id:c.id,de:c.fromName+' <'+c.from+'>',asunto:c.subject,preview:c.snippet})))}`
    try{
      const data=await claudeCall({model:'claude-opus-4-8',max_tokens:2500,messages:[{role:'user',content:prompt}]})
      const arr=JSON.parse((data.content?.[0]?.text||'').replace(/```json|```/g,'').trim())
      arr.forEach(o=>{ if(!o||!o.task) return; const c=batch.find(x=>x.id===o.id); if(!c) return; out.push({...c, title:o.title||c.subject, client_id:(o.client_id&&clients.some(cl=>String(cl.id)===String(o.client_id)))?o.client_id:null, due:(o.due&&/^\d{4}-\d{2}-\d{2}$/.test(o.due))?o.due:null, note:o.note||''}) })
    }catch(_){}
  }
  return out
}

// ─── CAJA CHICA VIEW (limited) ─────────────────────────────────────────────
// Administradores del estudio desde `miembros` (rol admin), UNA dirección por persona: la más corta del dominio del estudio
// (miembros trae alias: cl@ y cristobal.liberona@ y un gmail). Misma regla que la edge caja-chica-alerta. Cacheado por sesión.
export let _adminsEstudioCache=null, _adminsEstudioP=null

export function cargarAdminsEstudio(){
  if(_adminsEstudioCache) return Promise.resolve(_adminsEstudioCache)
  if(!_adminsEstudioP) _adminsEstudioP = Promise.resolve(supabase.from('miembros').select('email,rol,nombre').eq('rol','admin')).then(({data})=>{
    const dom=String(BRAND.dominio||'').toLowerCase().replace(/^.*?@/,'').replace(/^gestion\./,'')
    const por={}; (data||[]).forEach(a=>{ const em=String(a.email||'').toLowerCase(); if(!em.includes('@')) return; const k=String(a.nombre||em).split(' ')[0]; (por[k]=por[k]||[]).push(em) })
    _adminsEstudioCache=Object.entries(por).map(([nombre,ems])=>{ const d=dom?ems.filter(e=>e.endsWith('@'+dom)):[]; return {nombre, email:(d.length?d:ems).sort((x,y)=>x.length-y.length)[0]} })
    return _adminsEstudioCache }).catch(()=>[])
  return _adminsEstudioP
}

// ─── PROVEEDORES (catálogo + ficha de proveedores, costos de terceros) ──────
export const _nRut = r => String(r||'').replace(/[^0-9kK]/g,'').toLowerCase()

// Nombre a mostrar de un proveedor (fuente única; antes copiado en 7 lugares).
export const tituloProv = p => (p?.nombre?.trim()||p?.razon_social?.trim()||'Proveedor')

export const pctBHE = t => `${(t*100).toLocaleString('es-CL',{maximumFractionDigits:2})} %`

export const esBoletaProv = p => p?.documento==='boleta'

// Costo de una comisión nueva de quien emite boleta. % y UF: lo pactado es lo que RECIBE (líquido) → costo = líquido ÷ (1 − tasa).
// Monto fijo ($): se ingresa el costo (bruto) → líquido = bruto × (1 − tasa). Quien factura: monto tal cual.
// Fecha que fija la tasa: la del pago si ya se pagó; si no, el vencimiento, pero nunca una fecha pasada (una cuota atrasada se pagará este año).
export const fechaBHE = (pagadaEn, vence) => { const hoy=new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}); return pagadaEn ? String(pagadaEn).slice(0,10) : (vence&&String(vence).slice(0,10)>hoy ? String(vence).slice(0,10) : hoy) }

// Abre el PDF de una boleta guardada (bucket privado `documentos`, link firmado de 2 min). La ventana se abre antes del await (iPhone).
export const abrirDocumento = async path => { if(!path) return; const w=window.open('','_blank')
  const {data,error}=await supabase.storage.from('documentos').createSignedUrl(path,120)
  if(error||!data?.signedUrl){ w&&w.close(); appAlert('No se pudo abrir el archivo: '+(error?.message||'sin enlace')); return }
  if(w) w.location.href=data.signedUrl; else window.location.href=data.signedUrl }

// Estado de una comisión (FUENTE ÚNICA): 'pagada' (ya se le pagó) · 'por_pagar' (el cliente ya pagó esa cuota) · 'por_devengar' (el cliente aún no la paga).
// Se deriva de la factura del cliente y no solo del flag guardado: si la cuota está Pagada, la comisión queda por pagar aunque el flag
// (que mueve handleConciliarTerceros) no haya alcanzado a cambiar. `b` = la cuota del cliente (billing) o null si la comisión no tiene cuota.
// Una cuota 'Anticipada' (cubierta por un anticipo del cliente, p. ej. Rodrigo Macho que paga sin factura) ya está cobrada → su comisión se debe.
// Saldos de comisiones (fuente única para Inicio, Oficina y Proveedores). Excluye las de cuotas borradas o anuladas.
export function saldoComisiones(terceros=[], billing=[]){
  const byId=new Map((billing||[]).map(b=>[String(b.id),b]))
  const r={pagada:0,porPagar:0,porDevengar:0,total:0,provsPorPagar:new Set(),desfasadas:[],porPagarDesde:null,porPagarAnio:{}}
  ;(terceros||[]).forEach(t=>{ if(!t) return
    const b=t.billing_id?byId.get(String(t.billing_id)):null
    if(t.billing_id&&(!b||b.status==='Anulada'||b.deleted_at)) return
    const m=Number(t.monto)||0, e=estadoComision(t,b)
    r.total+=m
    if(e==='pagada') r.pagada+=m
    else if(e==='por_pagar'){ r.porPagar+=m; r.provsPorPagar.add(String(t.proveedor_id)); if(t.estado!=='por_pagar') r.desfasadas.push(t)
      const d=String(b?.paid_at||'').slice(0,10); if(d&&(!r.porPagarDesde||d<r.porPagarDesde)) r.porPagarDesde=d
      // año en que nació la deuda = cuando pagó el cliente (o se emitió/creó si no hay pago registrado)
      const y=+String(b?.paid_at||b?.issued_at||b?.due||t.created_at||'').slice(0,4); if(y>1990) r.porPagarAnio[y]=(r.porPagarAnio[y]||0)+m }
    else r.porDevengar+=m })
  return r
}

export const _diasDesde = iso => { const s=String(iso||'').slice(0,10); if(!/^\d{4}-\d\d-\d\d$/.test(s)) return null; return Math.round((Date.now()-new Date(s+'T12:00').getTime())/864e5) }

// Correo de la boleta de honorarios a la oficina (miembro del equipo con comisiones): sale desde su cuenta, con la boleta adjunta,
// el detalle de lo que cobra, bruto/retención/líquido y sus datos de pago DENTRO del recuadro. Va a los administradores (miembros).
// Mismo formato de marca que los demás correos de la app (franja con logo, recuadro de datos, firma).
export function correoMarcaHtml(text, titulo, firma, useCid=false){
  const A='#003C50',A4='#E4E8EB',MUTED='#537281',BG='#F7F9FA'
  const logoW=useCid?'cid:lealogow':`${location.origin}${BRAND.logo.blanco}`, logoC=useCid?'cid:lealogoc':`${location.origin}${BRAND.logo.color}`
  const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  let out='', box=[]
  const flush=()=>{ if(box.length){ out+=`<div style="background-color:${BG};border:1px solid ${A4};border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;line-height:1.8">${box.map(l=>{ const i=l.lastIndexOf(': '); return i>0?`<div><span style="color:${MUTED}">${esc(l.slice(0,i))}:</span> <strong style="color:${A}">${esc(l.slice(i+2).trim())}</strong></div>`:`<div>${esc(l)}</div>` }).join('')}</div>`; box=[] } }
  String(text).split('\n').forEach(l=>{ if(/^\s{2,}\S/.test(l)) box.push(l.trim()); else { flush(); out+= l.trim()?`<p style="margin:0 0 10px">${esc(l)}</p>`:'' } }); flush()
  return `<div style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td bgcolor="${A}" style="background-color:${A};padding:18px 24px"><table width="100%"><tbody><tr><td style="vertical-align:middle"><img src="${logoW}" alt="${BRAND.nombre}" style="height:26px;display:block"/></td><td style="text-align:right;vertical-align:middle;color:#fff;font-size:12px;font-weight:600">${esc(titulo)}</td></tr></tbody></table></td></tr></tbody></table><div style="padding:24px;border:1px solid ${A4};border-top:none">${out}${firmaCorreoHtml(firma,logoC,'es')}</div></div>`
}

// Manda un archivo a la papelera de Drive.
export async function driveTrash(token, fileId){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,{
    method:'PATCH',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({trashed:true})
  })
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive papelera '+r.status)
}

// Bloque "Archivos" reutilizable (tareas y gastos). Sube a Drive y registra en `table`.
export function Attachments({table, idField, entityId, ensureEntityId, folderKind, namePrefix, user, onChange, inline}) {
  const [items,setItems] = useState([])
  const [busy,setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(()=>{
    if(!entityId) return
    supabase.from(table).select('*').eq(idField,entityId).order('created_at',{ascending:true}).then(({data})=>setItems(data||[]))
  },[entityId])
  const reconnect = () => { appAlert('Tu acceso a Drive expiró. Te llevo a reconectar Drive; al volver, vuelve a adjuntar el archivo.'); connectDrive() }
  const onPick = async(e) => {
    const file = e.target.files?.[0]; if(!file) return
    e.target.value=''
    if(file.size > 15*1024*1024){ appAlert(`El archivo pesa ${(file.size/1048576).toFixed(1)} MB y supera el límite de 15 MB. Súbelo a Drive manualmente y pega el link como comentario.`); return }
    setBusy(true)
    try{
      // Si no hay id todavía (tarea nueva), se crea silenciosamente antes de subir
      let eid = entityId
      if(!eid && ensureEntityId) eid = await ensureEntityId()
      if(!eid) throw new Error('No se pudo preparar el registro')
      const token = await driveToken()
      if(!token){ reconnect(); return }
      const folders = await driveAdjuntosFolders(token)
      const folderId = folderKind==='tareas'?folders.tareas:folders.gastos
      const fname = `${namePrefix} · ${file.name}`.slice(0,250)
      const up = await driveUpload(token, folderId, file, fname)
      const {data,error} = await supabase.from(table).insert({[idField]:eid, drive_file_id:up.id, name:up.name||fname, url:up.webViewLink||null, uploaded_by:user?.name||null}).select().single()
      if(error) throw error
      setItems(p=>[...p,data]); onChange&&onChange(1, data)
    }catch(err){
      if(err instanceof DriveAuthError || err?.code===401){ reconnect() }
      else appAlert('Error al subir: '+(err.message||err))
    }
    setBusy(false)
  }
  const del = async(a) => {
    if(!await appConfirm(a.storage_path?'¿Quitar este respaldo del gasto?':'¿Eliminar este archivo? Se enviará a la papelera de Drive.')) return
    try{
      if(a.storage_path){ await supabase.from(table).delete().eq('id',a.id); setItems(p=>p.filter(x=>x.id!==a.id)); onChange&&onChange(-1, a); return }
      const token = await driveToken()
      if(token && a.drive_file_id){ try{ await driveTrash(token, a.drive_file_id) }catch(err){ if(err instanceof DriveAuthError){ reconnect(); return } } }
      await supabase.from(table).delete().eq('id',a.id)
      setItems(p=>p.filter(x=>x.id!==a.id)); onChange&&onChange(-1, a)
    }catch(err){ appAlert('Error al eliminar: '+(err.message||err)) }
  }
  const fileRow = a => (
    <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
      <span style={{flexShrink:0}}>Adjunto</span>
      {a.storage_path   // respaldo que adjuntó el agente desde el correo (bucket privado, no Drive)
        ?<><span onClick={()=>abrirDocumento(a.storage_path)} style={{flex:1,fontSize:12,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name||'archivo'}</span>
          <span onClick={()=>abrirDocumento(a.storage_path)} style={{fontSize:10,color:C.muted,cursor:'pointer',flexShrink:0}}>Abrir</span></>
        :<><a href={a.url||'#'} target='_blank' rel='noreferrer' style={{flex:1,fontSize:12,color:C.accent,textDecoration:'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name||'archivo'}</a>
          <a href={a.url||'#'} target='_blank' rel='noreferrer' style={{fontSize:10,color:C.muted,textDecoration:'none',flexShrink:0}}>Abrir</a></>}
      <button onClick={()=>del(a)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,flexShrink:0}}><Gl n='x'/></button>
    </div>
  )
  const icon = busy?<Spin/>:<svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>
  // inline: el ícono se ubica en la misma línea que lo controla el padre (grid); la lista cae full-width debajo.
  if(inline) return (<>
    <input ref={inputRef} type='file' onChange={onPick} style={{display:'none'}}/>
    <button onClick={()=>inputRef.current?.click()} disabled={busy} aria-label='Adjuntar archivo' title='Adjuntar archivo · máx. 15 MB · se guarda en Drive' style={{width:36,height:36,borderRadius:8,border:`1px dashed ${C.border}`,background:'transparent',color:C.accent,cursor:busy?'default':'pointer',opacity:busy?.6:1,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,position:'relative'}}>
      {icon}{items.length>0&&<span style={{position:'absolute',top:-5,right:-5,minWidth:15,height:15,borderRadius:8,background:C.accent,color:'#fff',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 3px'}}>{items.length}</span>}
    </button>
    {items.length>0&&<div style={{gridColumn:'1 / -1',marginTop:2}}>{items.map(fileRow)}</div>}
  </>)
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Archivos {items.length>0&&`(${items.length})`}</div>
      {items.map(fileRow)}
      <input ref={inputRef} type='file' onChange={onPick} style={{display:'none'}}/>
      <button onClick={()=>inputRef.current?.click()} disabled={busy} aria-label='Adjuntar archivo' title='Adjuntar archivo · máx. 15 MB · se guarda en Drive' style={{marginTop:8,width:40,height:44,borderRadius:8,border:`1px dashed ${C.border}`,background:'transparent',color:C.accent,cursor:busy?'default':'pointer',opacity:busy?.6:1,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>
        {icon}
      </button>
    </div>
  )
}

// «Por cobrar a mis clientes» (responsable limitado): FUENTE ÚNICA del acceso en Mi cartera y de su página.
// Mis clientes = los de mis ventas (sales ya llega filtrado a las suyas) o donde soy el abogado responsable. Honorarios = porCobrarBills
// (mismo criterio que la ficha y Cobranza); gastos = saldo en contra de fgCliente.
// Número de cuota desde el concepto de la programada ("Cuota 3/8", "Cobro 2 (17.5 UF)").
export const nCuotaDe = b => { const m=String(b?.concept||'').match(/(?:Cuota|Cobro)\s+(\d+)(?:\s*\/\s*(\d+))?/i); return m?{n:+m[1],de:m[2]?+m[2]:null}:null }

// Gastos del cliente aún no rendidos: fuente única (Gastos, ficha y Cartola).
// Caja chica por liquidar de una persona (FUENTE ÚNICA: Caja chica, Inicio y «Tu semana»): gastos que pagó con SU caja (no los que pagó el cliente o la oficina) y que aún no liquida. Incluye notaría si la pagó con su caja.
export const gastosPorLiquidarCaja = (expenses,persona) => (expenses||[]).filter(e=>e.type==='gasto'&&!e.deleted_at&&!e.rendered_at&&!e.paid_by_client&&e.created_by===persona)

// UF abreviada para KPIs (UF 9.800 / UF 6.309), sin decimales para no recargar.
export const fmtUFk = n => `UF ${Math.round(n||0).toLocaleString('es-CL')}`

// Inicio de una venta (YYYY-MM): el inicio del cobro mensual si está; si no, año/mes de la venta.
export const inicioVentaYM = s => { const mi=String(s?.cobro_config?.mensualInicio||''); return /^\d{4}-\d{2}/.test(mi) ? mi.slice(0,7) : `${s?.year}-${String(s?.month||1).padStart(2,'0')}` }

// ¿La venta cuenta en lo vendido del año y? Su año, y si es MENSUAL y sigue activa, también cada año en que se RENUEVA
// (otros 12 meses desde el aniversario de su inicio), solo cuando el aniversario ya llegó. Fuente única para todo filtro "vendido del año".
export const ventaCuentaEnAnio = (s, y) => {
  if(!s) return false
  if(Number(s.year)===Number(y)) return true
  if(!esRecurrente(s) || Number(y)<=Number(s.year)) return false
  const aniv=`${y}-${inicioVentaYM(s).slice(5,7)}`, hoyYM=new Date().toISOString().slice(0,7)
  return aniv<=hoyYM
}

export async function fetchUFFechas(isos){
  let m=ufFechaCache(); const done=Array.isArray(m.__anios)?m.__anios:[]
  const anios=[...new Set((isos||[]).map(d=>String(d||'').slice(0,4)).filter(y=>/^\d{4}$/.test(y)))]
  // El año en curso se vuelve a bajar si aún no trae la UF de hoy (si no, la serie quedaba congelada en la primera descarga).
  const hoy=isoLocal(Date.now()), yHoy=hoy.slice(0,4)
  for(const y of anios){ if(done.includes(y) && !(y===yHoy && !m[hoy])) continue
    const t=await ufDeTabla(`${y}-01-01`,`${y}-12-31`)
    if(t&&(y!==yHoy||t[hoy])){ Object.assign(m,t); if(!done.includes(y)) done.push(y); continue }
    try{ const r=await fetch(`https://mindicador.cl/api/uf/${y}`); const j=await r.json(); (j&&j.serie||[]).forEach(s=>{ const d=String(s.fecha||'').slice(0,10); if(d&&s.valor>0) m[d]=s.valor }); if(!done.includes(y)) done.push(y) }catch(_){} }
  m.__anios=done; try{ localStorage.setItem(_UF_FECHA_KEY,JSON.stringify(m)) }catch(_){}
  return m
}

// Fuente ÚNICA del total mensual de Costos de Oficina: valor vigente de cada ítem en el mes ym (desde/monto_prev), ingresos restan.
export function costosOficinaMes(rows, ym){ ym = ym || new Date().toISOString().slice(0,7); return (rows||[]).reduce((a,r)=>{ const eff=(r.desde && ym<String(r.desde).slice(0,7))?(r.monto_prev??r.monto):r.monto; return a + (Number(eff)||0)*(r.es_ingreso?-1:1) },0) }

// Flecha de las filas desplegables (Inicio y Proyección).
export const ChevAb = ({open}) => <svg width='9' height='9' viewBox='0 0 10 10' style={{transform:open?'rotate(180deg)':'none',transition:'transform .15s',flexShrink:0}}><path d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/></svg>

// Venta histórica del cliente (Activo+Terminado) en UF — fuente única ventaUF (UF congelada).
export const ventaHistoricaUF = (clientId, sales, ufRef) => (sales||[]).filter(s=>String(s.client_id)===String(clientId)&&['Activo','Terminado'].includes(s.status)&&!s.deleted_at).reduce((a,s)=>a+ventaUF(s,ufRef),0)

// UF por fecha de los documentos (caché de mindicador), para convertir lo facturado a UF con la UF de su día.
export function useUFFechas(billing){
  const [m,setM]=useState(()=>ufFechaCache())
  useEffect(()=>{ if(DEMO) return; const ds=[]; (billing||[]).forEach(b=>{ if(b&&b.issued_at) ds.push(b.issued_at) }); if(!ds.length) return; let v=true; fetchUFFechas(ds).then(x=>{ if(v&&x) setM(x) }).catch(()=>{}); return ()=>{v=false} },[billing])
  return m
}

export const FLUJO_DUDA_DIAS = 30

export function flujoCajaProyectado({ billing=[], terceros=[], costosOfiRows=[], anticipos=[], costoOp=null, sales=null, noEmitir=null, ufFechas=null, semanas=8, hoy=new Date() }){
  const DAY=86400000
  const d0=new Date(hoy); d0.setHours(12,0,0,0)
  const mon=new Date(d0); mon.setDate(d0.getDate()-((d0.getDay()+6)%7))
  const tD=s=>{ const t=new Date(String(s||'').slice(0,10)+'T12:00:00').getTime(); return isNaN(t)?null:t }
  const hoyT=d0.getTime(), monT=mon.getTime()
  const wIdx=t=>t<monT?0:Math.floor((t-monT)/(7*DAY))
  const med=a=>{ if(!a.length) return null; const x=[...a].sort((p,q)=>p-q), m=Math.floor(x.length/2); return x.length%2?x[m]:(x[m-1]+x[m])/2 }
  const curYm=`${d0.getFullYear()}-${String(d0.getMonth()+1).padStart(2,'0')}`
  const vivas=(billing||[]).filter(b=>b&&!b.deleted_at&&b.status!=='Anulada'&&b.billing_type!=='reembolso')
  const pag=vivas.filter(b=>b.status==='Pagado'&&b.paid_at&&b.issued_at&&b.invoice_no).map(b=>({c:String(b.client_id||''),p:tD(b.paid_at),d:Math.round((tD(b.paid_at)-tD(b.issued_at))/DAY)})).filter(x=>x.p&&x.d>=0&&x.d<=365)
  const ritmoEstudio=Math.round(med(pag.filter(x=>x.p>=hoyT-365*DAY).map(x=>x.d))??med(pag.map(x=>x.d))??30)
  const grp={}; pag.forEach(x=>{ (grp[x.c]=grp[x.c]||[]).push(x) })
  const ritmoDe={}, histDe={}
  Object.entries(grp).forEach(([c,a])=>{ const u=a.sort((x,y)=>y.p-x.p).slice(0,12); histDe[c]=u.length; ritmoDe[c]=u.length>=3?Math.round(med(u.map(x=>x.d))):ritmoEstudio })
  const ritmo=c=>ritmoDe[String(c||'')]??ritmoEstudio
  const weeks=Array.from({length:semanas},(_,i)=>{ const ws=new Date(monT+i*7*DAY); return {ini:`${ws.getFullYear()}-${String(ws.getMonth()+1).padStart(2,'0')}-${String(ws.getDate()).padStart(2,'0')}`,entra:0,com:0} })
  const cli={}; const C_=c=>{ const k=String(c||''); return cli[k]||(cli[k]={cid:k,entra:0,duda:0,sin:0,com:0,comFuera:0,antic:0,nVenc:0,ritmo:ritmo(k),hist:histDe[k]||0}) }
  const st={}; const duda={n:0,monto:0,cli:new Set()}, sinE={n:0,monto:0,previas:0}
  const cobros=[]   // cada cobro esperado con su fecha (t), también los que caen después de las 8 semanas → Proyección al 31-12
  // Pagos ya recibidos sin factura (anticipo disponible): esa plata ya entró, así que rebaja las cuotas programadas más antiguas
  // de su venta (o del cliente, si el anticipo no tiene venta). Solo falta emitir la factura. El subarriendo es mensual: un pago sin factura
  // cubre solo la cuota de ESE mes (pago entre 15 días antes y 20 días después de su vencimiento), nunca la de otro mes.
  const cubierto={}; let antTot=0
  // Programadas que no son plata por facturar: venta no activa, marcadas «No corresponde», o ya cubiertas por lo facturado en su venta.
  const saleSt={}; (sales||[]).forEach(x=>{ if(x&&!x.deleted_at) saleSt[String(x.id)]=x.status })
  const cubV=sales?cuotasCubiertasVenta(billing,sales,ufFechas):new Map()
  const fueraProg=b=>(sales&&b.sale_id&&saleSt[String(b.sale_id)]!=='Activo')||(noEmitir&&noEmitir.has(String(b.id)))||cubV.get(String(b.id))?.total
  ;(anticipos||[]).filter(a=>a&&a.estado==='disponible'&&!a.billing_id&&Number(a.monto)>0).sort((x,y)=>String(x.fecha||'').localeCompare(String(y.fecha||''))).forEach(a=>{
    let r=Number(a.monto)
    const fa=new Date(String(a.fecha||'').slice(0,10)+'T12:00:00').getTime()
    const mesOk=b=>{ const d=new Date(String(b.due||'').slice(0,10)+'T12:00:00').getTime(); return !isNaN(fa)&&!isNaN(d)&&fa>=d-15*86400000&&fa<=d+20*86400000 }
    vivas.filter(b=>b.status==='Programada'&&!b.invoice_no&&!fueraProg(b)&&(a.sale_id?String(b.sale_id)===String(a.sale_id):String(b.client_id)===String(a.client_id))&&(b.billing_type==='subarriendo'?mesOk(b):true))
      .sort((x,y)=>String(x.due||'').localeCompare(String(y.due||''))).forEach(b=>{ if(r<1) return; const m=(montoFactura(b)||Number(b.amount)||0)-(cubierto[b.id]||0); if(!(m>0)) return; const u=Math.min(m,r); cubierto[b.id]=(cubierto[b.id]||0)+u; r-=u; antTot+=u }) })
  vivas.forEach(b=>{
    const c=C_(b.client_id)
    if(['Pendiente','Vencido'].includes(b.status)&&b.invoice_no){ const m=saldoBill(b); if(!(m>0)) return
      if(b.status==='Vencido') c.nVenc++
      const base=tD(b.issued_at)??tD(b.due); if(base==null) return
      const esp=base+c.ritmo*DAY
      if(hoyT-esp>FLUJO_DUDA_DIAS*DAY){ st[b.id]={fuera:'duda',m,cid:c.cid}; c.duda+=m; duda.n++; duda.monto+=m; duda.cli.add(c.cid); return }
      const w=wIdx(Math.max(esp,hoyT)); st[b.id]={w,m,cid:c.cid}; cobros.push({b,t:Math.max(esp,hoyT),m,k:'emit'}); if(w<semanas){ weeks[w].entra+=m; c.entra+=m } return }
    if(b.status==='Programada'&&!b.invoice_no){ if(fueraProg(b)) return; const m=(montoFactura(b)||Number(b.amount)||0)-(cubierto[b.id]||0)-(cubV.get(String(b.id))?.m||0); if(cubierto[b.id]) c.antic+=cubierto[b.id]; if(!(m>=1)){ if(cubierto[b.id]) st[b.id]={pagadaAnt:true,cid:c.cid}; return }
      const due=b.due||b.issued_at; const dYm=String(due||'').slice(0,7)
      if(!dYm||dYm<curYm){ st[b.id]={fuera:'sin',m,cid:c.cid}; c.sin+=m; sinE.n++; sinE.monto+=m; if(dYm&&dYm<`${d0.getFullYear()}-06`) sinE.previas++; return }
      const tE=Math.max(tD(due)??hoyT,hoyT)+c.ritmo*DAY, w=wIdx(tE); st[b.id]={w,m,cid:c.cid}; cobros.push({b,t:tE,m,k:'prog'}); if(w<semanas){ weeks[w].entra+=m; c.entra+=m } }
  })
  const bById={}; vivas.forEach(b=>{ bById[String(b.id)]=b })
  const porVenta={}; vivas.forEach(b=>{ if(b.sale_id&&st[b.id]) (porVenta[String(b.sale_id)]=porVenta[String(b.sale_id)]||[]).push(b) })
  let comFuera=0; const cfB={duda:0,sin:0}; const sinCuota=[]
  const aplica=(b,monto)=>{ const s0=st[b.id], c=C_(b.client_id)
    if(b.status==='Pagado'||s0?.pagadaAnt){ weeks[0].com+=monto; c.com+=monto; return }
    if(!s0) return
    if(s0.fuera){ comFuera+=monto; c.comFuera+=monto; cfB[s0.fuera]=(cfB[s0.fuera]||0)+monto; return }
    if(s0.w<semanas){ weeks[s0.w].com+=monto; c.com+=monto } }
  ;(terceros||[]).forEach(t=>{ if(!t||t.estado==='pagado') return; const monto=Number(t.monto)||0; if(!(monto>0)) return
    const b=t.billing_id?bById[String(t.billing_id)]:null
    if(t.billing_id){ if(b) aplica(b,monto); return }
    const ps=t.sale_id?(porVenta[String(t.sale_id)]||[]):[]
    if(!ps.length){ sinCuota.push({prov:t.proveedor||'Colaborador',monto,sale_id:t.sale_id||null}); return }
    const tot=ps.reduce((a,x)=>a+(st[x.id]?.m||0),0)||1
    ps.forEach(x=>aplica(x,monto*(st[x.id]?.m||0)/tot)) })
  // Oficina al costo bruto: los ingresos fijos del presupuesto (subarriendo) ya entran por su propia factura; restarlos aquí los contaba dos veces.
  const oficinaSem=costosOficinaMes((costosOfiRows||[]).filter(r=>!r.es_ingreso))/4.3333
  // Con costo real: cada semana lleva el costo mensual × la parte del calendario de pago que cae en sus días, desde hoy (lo ya pagado no se cuenta).
  const ofDe=i=>{ if(!(costoOp&&costoOp.mensual>0&&costoOp.peso)) return oficinaSem; let v=0
    for(let j=0;j<7;j++){ const d=new Date(monT+(i*7+j)*DAY); if(d.getTime()<hoyT) continue; const D=d.getDate(), last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); const k=D===last?30:(D>=30?null:D); if(k) v+=costoOp.mensual*(costoOp.peso[k]||0) }
    return v }
  let run=0; weeks.forEach((w,i)=>{ w.of=ofDe(i); w.sale=w.of+w.com; run+=w.entra-w.sale; w.run=run })
  const E=weeks.reduce((a,w)=>a+w.entra,0), Cm=weeks.reduce((a,w)=>a+w.com,0), O=weeks.reduce((a,w)=>a+w.of,0)
  const sinCuotaTot=sinCuota.reduce((a,x)=>a+x.monto,0)
  const clientes=Object.values(cli).filter(c=>c.entra||c.duda||c.sin||c.com||c.comFuera).sort((a,b)=>(b.entra-b.com)-(a.entra-a.com)||b.duda-a.duda||b.sin-a.sin)
  const fuera=Object.entries(st).filter(([,x])=>x&&x.fuera).map(([id,x])=>({id,tipo:x.fuera,m:x.m}))   // morosas (duda) y por facturar atrasado (sin), por factura
  return {weeks,cobros,fuera,E,C:Cm,O,costoReal:!!(costoOp&&costoOp.mensual>0&&costoOp.peso),fin:run,ritmoEstudio,antTot,duda:{n:duda.n,monto:duda.monto,nCli:duda.cli.size},sinEmitir:sinE,comFuera,comFueraDuda:cfB.duda,comFueraSin:cfB.sin,sinCuota,sinCuotaTot,clientes}
}

// ─── POR SOCIO · motor único ────────────────────────────────────────────────
// Regla de oro «coherencia de datos entre vistas» (CLAUDE.md): una cifra, una fuente, un dueño. Este motor es la ÚNICA
// fuente de las cifras por socio (Facturación › Por socio e Inteligencia › Socios). Todo sale de partidas reales:
//   Facturado      = facturas emitidas (con folio) + comisión de externos − reembolsos de gastos (− notas de crédito)
//   Cobrado propio = cobrado de facturas + anticipos − reembolsos de gastos
//   Ingreso real   = cobrado propio − comisiones pagadas + comisiones percibidas  (misma cuenta que Inicio)
// Subarriendo («Sin socio») va aparte: no es honorario ni de ningún socio, no suma al Facturado ni al Ingreso real.
// Factura por cuenta de un externo (terceros con comision_pct): solo lo nuestro — 'cext' al emitir, 'perc' al cobrar.
// Caja = conciliacion.monto_aplicado por la fecha del depósito (igual que Inicio). Dueño de cada partida (socioDe): decisión
// guardada (learnings 'socio_factura') → subarriendo = Sin socio → venta.responsible → cliente.abogado_responsable; lo que no es de
// un socio va a «Sin socio». Reembolso dentro de una factura de honorarios = fondos ligados a ella (expenses.invoice_id).
export const SIN_SOCIO = 'Sin socio'

export const socioNorm = r => ADMIN_NAMES.includes(r) ? r : SIN_SOCIO

export const socioDe = (b, {saleById={}, cliById={}, ov={}}={}) => socioNorm((b&&ov[String(b.id)]) || (b&&b.billing_type==='subarriendo'?SIN_SOCIO:null) || (b&&b.sale_id&&saleById[String(b.sale_id)]?.responsible) || (b&&cliById[String(b.client_id)]?.abogado_responsable))

export const socioDeVenta = (s, {cliById={}}={}) => socioNorm((s&&s.responsible) || (s&&cliById[String(s.client_id)]?.abogado_responsable))

export async function _psSelTodo(build){ let all=[], from=0; const SZ=1000; for(let i=0;i<50;i++){ const {data,error}=await build().range(from,from+SZ-1); if(error) throw error; if(!data||!data.length) break; all=all.concat(data); if(data.length<SZ) break; from+=SZ } return all }

// Fuentes que no viven en el estado global de la app: conciliación, abonos del banco y decisiones guardadas.
export function usePorSocioFuentes(){
  const [f,setF]=useState({ic:[],ia:[],ov:{},hok:new Set(),gc:new Set(),ok:false})
  useEffect(()=>{
    if(DEMO){ setF({ic:(demoData.conciliacion||[]).filter(c=>['factura','anticipo'].includes(c.tipo_destino)), ia:(demoData.cartola_movimientos||[]).filter(m=>m.tipo==='abono'&&!m.es_interno), ov:{}, hok:new Set(), gc:new Set((demoData.conciliacion||[]).filter(c=>c.gasto_id).map(c=>String(c.gasto_id))), ok:true}); return }
    let v=true
    Promise.all([
      _psSelTodo(()=>supabase.from('conciliacion').select('id,movimiento_id,factura_id,anticipo_id,tipo_destino,monto_aplicado').in('tipo_destino',['factura','anticipo']).order('id')),
      _psSelTodo(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,cliente_id,categoria').eq('tipo','abono').neq('es_interno',true).order('id')),
      supabase.from('learnings').select('kind,key,value').in('kind',['socio_factura','honorario_sin_gasto']).order('updated_at',{ascending:true}),
      _psSelTodo(()=>supabase.from('conciliacion').select('id,gasto_id').not('gasto_id','is',null).order('id')),
    ]).then(([ic,ia,l,gcs])=>{ if(!v) return; const ov={}, hok=new Set(); (l.data||[]).forEach(r=>{ if(r.kind==='socio_factura'&&r.value) ov[String(r.key)]=r.value; if(r.kind==='honorario_sin_gasto') hok.add(String(r.key)) }); setF({ic,ia,ov,hok,gc:new Set((gcs||[]).map(c=>String(c.gasto_id))),ok:true}) }).catch(()=>{ if(v) setF(p=>({...p,ok:true})) })
    return ()=>{v=false}
  },[])
  return [f,setF]
}

export function partidasPorSocio({billing=[],sales=[],clients=[],anticipos=[],terceros=[],expenses=[],ic=[],ia=[],ov={},fondoExtra={}}){
  const saleById={}; (sales||[]).forEach(s=>{ if(s) saleById[String(s.id)]=s })
  const cliById={}; (clients||[]).forEach(c=>{ if(c) cliById[String(c.id)]=c })
  const billById={}; (billing||[]).forEach(b=>{ if(b) billById[String(b.id)]=b })
  const antById={}; (anticipos||[]).forEach(a=>{ if(a) antById[String(a.id)]=a })
  const movById={}; (ia||[]).forEach(m=>{ if(m) movById[String(m.id)]=m })
  const ctx={saleById,cliById,ov}
  const ext={}; (terceros||[]).forEach(t=>{ if(t&&t.comision_pct!=null&&t.billing_id){ const e=(ext[String(t.billing_id)]=ext[String(t.billing_id)]||{com:0,mto:0}); e.com+=Number(t.comision_monto)||0; e.mto+=Number(t.monto)||0 } })
  const fondoEn={}; (expenses||[]).forEach(e=>{ const inv=fondoExtra[String(e?.id)]||e?.invoice_id; if(e&&!e.deleted_at&&e.type==='fondo'&&inv) fondoEn[String(inv)]=(fondoEn[String(inv)]||0)+(Number(e.amount)||0) })
  const fN=no=>no?`F${folioN(no)}`:''
  const out=[]; const put=(s,k,d,soc,b,m,det,extra={})=>{ if(!(Math.abs(m)>=1)) return; out.push({s,k,d:String(d||'').slice(0,10),soc,cid:b?.client_id||extra.cid||null,doc:fN(b?.invoice_no),det:det||'',m,bid:b?.id||null,...extra}) }
  ;(billing||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||['Anulada','Programada'].includes(b.status)) return
    const soc=socioDe(b,ctx), mf=montoFactura(b), d=b.issued_at
    if(b.billing_type==='subarriendo'){ put('f','sub',d,SIN_SOCIO,b,mf,b.concept); return }
    if(b.billing_type==='nota_credito'){ put('f','nc',d,soc,b,-mf,b.concept); return }
    const x=ext[String(b.id)]
    if(b.billing_type!=='reembolso'&&x&&x.mto){ put('f','cext',d,soc,b,mf-x.mto,b.concept) }
    else { put('f','emit',d,soc,b,mf,b.concept)
      if(b.billing_type==='reembolso') put('f','reemb',d,soc,b,-mf,b.concept)
      else if(fondoEn[String(b.id)]) put('f','reemb',d,soc,b,-Math.min(mf,fondoEn[String(b.id)]),'gasto dentro de honorarios') }
    ;(terceros||[]).forEach(t=>{ if(t&&t.comision_pct==null&&String(t.billing_id||'')===String(b.id)) put('f','com',d,soc,b,-(Number(t.monto)||0),t.proveedor||'Colaborador') })
  })
  ;(ic||[]).forEach(cc=>{ const m=movById[String(cc.movimiento_id)]; if(!m) return; const monto=Number(cc.monto_aplicado)||0; if(monto<=0) return
    if(cc.tipo_destino==='factura'){ const b=billById[String(cc.factura_id)]
      if((b&&b.billing_type==='subarriendo')||m.categoria==='Subarriendo'){ put('c','sub',m.fecha,SIN_SOCIO,b,monto,b?.concept||'subarriendo',{mov:m.id,cid:m.cliente_id}); return }
      const soc=b?socioDe(b,ctx):SIN_SOCIO
      const x=b&&ext[String(b.id)]
      if(b&&b.billing_type!=='reembolso'&&x&&(x.com+x.mto)>0){ put('c','perc',m.fecha,soc,b,monto*x.com/(x.com+x.mto),b.concept,{mov:m.id,cid:m.cliente_id}); return }
      put('c','fac',m.fecha,soc,b,monto,b?.concept,{mov:m.id,cid:m.cliente_id})
      if(b&&b.billing_type==='reembolso') put('c','reemb',m.fecha,soc,b,-monto,b.concept,{mov:m.id})
      else if(b&&fondoEn[String(b.id)]){ const mf=montoFactura(b)||monto; put('c','reemb',m.fecha,soc,b,-monto*Math.min(1,fondoEn[String(b.id)]/mf),'gasto dentro de honorarios',{mov:m.id}) }
    } else { const a=antById[String(cc.anticipo_id)]
      const extra={mov:m.id,cid:a?.client_id||m.cliente_id}
      if(m.categoria==='Subarriendo'){ put('c','sub',m.fecha,SIN_SOCIO,null,monto,'subarriendo sin factura',extra); return }
      put('c','ant',m.fecha,a?socioNorm((a.sale_id&&saleById[String(a.sale_id)]?.responsible)||cliById[String(a.client_id)]?.abogado_responsable):SIN_SOCIO,null,monto,a?.nota||'pago sin factura',extra)
    }
  })
  ;(terceros||[]).forEach(t=>{ if(!t||t.estado!=='pagado'||t.comision_pct!=null) return; const b=t.billing_id&&billById[String(t.billing_id)]
    put('c','com',t.pagado_at,b?socioDe(b,ctx):socioNorm(t.sale_id&&saleById[String(t.sale_id)]?.responsible),b||null,-(Number(t.monto)||0),t.proveedor||'Colaborador',{cid:b?.client_id||(t.sale_id&&saleById[String(t.sale_id)]?.client_id)||null}) })
  return out
}

// Vendido por socio (misma definición que metricasAnio de Inicio: Activo + Terminado, sin subarriendo, renovación anual de recurrentes).
export function vendidoPorSocio(sales=[], clients=[], ufRef=0, y=new Date().getFullYear(), ym=null){
  const cliById={}; (clients||[]).forEach(c=>{ if(c) cliById[String(c.id)]=c })
  const items=[]
  ;(sales||[]).forEach(s=>{ if(!s||s.deleted_at||!['Activo','Terminado'].includes(s.status)||esSubarriendo(s)||!ventaCuentaEnAnio(s,y)) return
    const ini=inicioVentaYM(s), mes=esRecurrente(s)&&Number(s.year)<Number(y)?`${y}-${ini.slice(5,7)}`:ini
    items.push({s, soc:socioDeVenta(s,{cliById}), m:ventaCLP(s,ufRef), ym:mes}) })
  return items
}

// Catálogo del Comparativo («+ Agregar indicador»). per:'flujo' = depende de Mes/Año; 'hoy' = foto viva. f: '$' | 'n' | '%' | 'd'.
export const PS_KPIS=[
  {g:'Ingresos',k:'vend',l:'Vendido',ls:'Vendido',f:'$',per:'flujo'},
  {g:'Ingresos',k:'fac',l:'Facturado',ls:'Facturado',f:'$',per:'flujo'},
  {g:'Ingresos',k:'ireal',l:'Ingreso real',ls:'Ingreso real',f:'$',per:'flujo'},
  {g:'Ingresos',k:'compag',l:'Comisiones pagadas',ls:'Com. pagadas',f:'$',per:'flujo'},
  {g:'Ingresos',k:'comfac',l:'Comisiones de lo facturado',ls:'Com. facturado',f:'$',per:'flujo',extra:1},
  {g:'Ingresos',k:'cext',l:'Comisión de externos',ls:'Com. externos',f:'$',per:'flujo',extra:1},
  {g:'Ingresos',k:'perc',l:'Comisiones percibidas',ls:'Percibidas',f:'$',per:'flujo',extra:1},
  {g:'Ingresos',k:'reemb',l:'Reembolsos de gastos',ls:'Reembolsos',f:'$',per:'flujo',extra:1},
  {g:'Cobro · hoy',k:'pcob',l:'Por cobrar',ls:'Por cobrar',f:'$',per:'hoy'},
  {g:'Cobro · hoy',k:'venc',l:'de eso, vencido',ls:'de eso, vencido',f:'$',per:'hoy',sub:1},
  {g:'Cobro · hoy',k:'moro',l:'de eso, cartera morosa',ls:'de eso, morosa',f:'$',per:'hoy',sub:1},
  {g:'Cobro · hoy',k:'pfat',l:'Por facturar vencido',ls:'Por facturar',f:'$',per:'hoy'},
  {g:'Gastos de clientes · hoy',k:'deuda',l:'Deuda de clientes por gastos',ls:'Deuda gastos',f:'$',per:'hoy'},
  {g:'Gastos de clientes · hoy',k:'favor',l:'Fondos a favor de clientes',ls:'A favor',f:'$',per:'hoy',extra:1},
  {g:'Ventas',k:'nven',l:'N.º de ventas',ls:'N.º ventas',f:'n',per:'flujo',extra:1},
  {g:'Ventas',k:'tick',l:'Ticket promedio',ls:'Ticket',f:'$',per:'flujo',extra:1},
  {g:'Ventas',k:'cact',l:'Clientes con venta',ls:'Clientes',f:'n',per:'flujo',extra:1},
  {g:'Ventas',k:'conv',l:'Conversión de propuestas',ls:'Conversión',f:'%',per:'hoy',extra:1},
  {g:'Ventas',k:'pipe',l:'Propuestas abiertas',ls:'Propuestas',f:'n',per:'hoy',extra:1},
  {g:'Ventas',k:'mrr',l:'Recurrente al mes',ls:'Recurrente',f:'$',per:'hoy',extra:1},
  {g:'Ventas',k:'comp',l:'Comprometido próximo año',ls:'Comprometido',f:'$',per:'hoy',extra:1},
  {g:'Ventas',k:'dso',l:'Días de cobro (DSO)',ls:'DSO',f:'d',per:'flujo',extra:1},
]

export const PS_KPI_DEF=['vend','fac','ireal','compag','pcob','venc','moro','pfat','deuda']

export const _lsGet=(k,d)=>{ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v) }catch(_){ return d } }

export const _lsSet=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)) }catch(_){} }

export const PS_RX_GASTO=/(gasto|reembols|notar|tramitaci|inscrip|conservador|cbr|derechos|provisi|timbre|publicaci|diario oficial)/i

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
export const META_UF = 9800

// Costo de operación REAL para proyectar (fuente única): promedio de los últimos 3 meses cerrados del resultado (costos + PPM)
// y el calendario de pago aprendido del banco: qué parte del gasto del mes sale cada día. Sin planilla o sin pagos → null (se usa el presupuesto).
export function costoOperacionReal(fu, deps, hoy=new Date(), meses=3){
  const ofi=(deps.clients||[]).find(c=>c&&(c.is_internal||/liberona\s+escala/i.test(c.name||''))); if(!ofi) return null
  const yms=[]; for(let i=1;i<=meses;i++){ const d=new Date(hoy.getFullYear(),hoy.getMonth()-i,1); yms.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
  const rs=yms.map(ym=>resultadoMes(fu,deps,ym)).filter(r=>r.conPlanilla)
  if(!rs.length) return null
  const mensual=rs.reduce((a,r)=>a+r.cos+(Number(r.ppm)||0),0)/rs.length
  const NO=new Set(['Retiros','Comisiones','Proveedores','Honorarios','Notaria','Notaría','CBR','Registro Civil','Archivo Judicial','Diario Oficial'])
  const peso={}; let tot=0
  ;(deps.expenses||[]).forEach(e=>{ if(!e||e.deleted_at||e.type!=='gasto'||String(e.client_id)!==String(ofi.id)||NO.has(String(e.category||''))) return
    const f=String(e.date||'').slice(0,10); if(!yms.includes(f.slice(0,7))) return
    const [Y,M,D]=f.split('-').map(Number), last=new Date(Y,M,0).getDate(), k=D===last?30:Math.min(D,29), m=Number(e.amount)||0
    if(m>0){ peso[k]=(peso[k]||0)+m; tot+=m } })
  if(!(tot>0)) return null
  Object.keys(peso).forEach(k=>{ peso[k]/=tot })
  return {mensual, peso, meses:rs.map(r=>r.ym)}
}

// Flujo de caja a 8 semanas: UN solo cálculo para Inicio, Oficina y la página (mismas entradas → misma cifra en todas las vistas).
export function useFlujoCaja({ billing=[], terceros=[], costosOfiRows=[], anticipos=[], expenses=[], clients=[], sales=[], fantasmaIds=null }){
  const fu=useFuentesResultado()
  const bill=useMemo(()=>(fantasmaIds&&fantasmaIds.size)?(billing||[]).filter(b=>!fantasmaIds.has(String(b.id))):billing,[billing,fantasmaIds])
  const noEmitir=useNoEmitirSet(), ufFechas=useUFFechas(bill)
  const costoOp=useMemo(()=>costoOperacionReal(fu,{billing:bill,terceros,costosOfiRows,expenses,clients}),[fu,bill,terceros,costosOfiRows,expenses,clients])
  return useMemo(()=>flujoCajaProyectado({billing:bill,terceros,costosOfiRows,anticipos,costoOp,sales,noEmitir,ufFechas}),[bill,terceros,costosOfiRows,anticipos,costoOp,sales,noEmitir,ufFechas])
}

// Parte de las comisiones por pagar que viene de años anteriores al actual: {monto, txt:'2025' | '2024–2025'} o null.
export const comisPorPagarAnteriores = sc => { const yAct=new Date().getFullYear(); const ys=Object.keys(sc?.porPagarAnio||{}).map(Number).filter(y=>y<yAct).sort(); if(!ys.length) return null
  const monto=ys.reduce((a,y)=>a+(sc.porPagarAnio[y]||0),0); return monto>0?{monto,txt:ys.length>1?`${ys[0]}–${ys[ys.length-1]}`:String(ys[0])}:null }

// Resultado del año tal como lo muestra Inicio (lo publica el Dashboard al calcularlo; Counsel AI lo lee). Un solo cálculo, dos lectores.
export let _resultadoInicio = null
export const publicarResultadoInicio = v => { _resultadoInicio = v }

// RUT: normalizador ÚNICO de toda la app = el de cartola (crNormRut): mayúscula, solo dígitos + K (sin puntos, espacios ni guion).
// Antes esta copia conservaba el guion y usaba minúscula (outlier): fallaba dedupe/match entre "12345678-9" y "123456789".
export const normRut = crNormRut

// Clientes EXISTENTES parecidos a un nombre NUEVO (misma regla que el detector) → alarma que BLOQUEA la creación
// para no duplicar (prevención > fusión). Incluye ocasionales (un dup contra un ocasional también importa); excluye interno y la propia ficha.
export function clientesParecidos(name, clients=[], excludeId=null){
  const n=_normTxt(name); if(!n) return []
  const toks=n.split(' ').filter(w=>w.length>1)
  const out=[]
  for(const c of (clients||[])){
    if(!c||!c.name||c.deleted_at||c.is_internal||(excludeId!=null&&String(c.id)===String(excludeId))) continue
    const cn=_normTxt(c.name); if(!cn) continue
    const ct=cn.split(' ').filter(w=>w.length>1)
    let tipo=null
    if(cn===n) tipo='exacto'
    else { const short=toks.length<=ct.length?toks:ct, long=toks.length<=ct.length?ct:toks
      if(short.length>=2 && short.every(t=>long.includes(t))) tipo='contenido'
      else if(toks.length===ct.length && Math.min(n.length,cn.length)>=6 && _lev(n,cn)<=2) tipo='typo' }
    if(tipo) out.push({cliente:c, tipo})
  }
  const rank={exacto:0,contenido:1,typo:2}
  out.sort((a,b)=>rank[a.tipo]-rank[b.tipo])
  return out
}

export const _tipoDupLbl = t => t==='exacto'?'idéntico':t==='contenido'?'muy similar':'posible typo'

export const Sel = ({value,onChange,options,placeholder,style}) => (
  <select value={value} onChange={onChange} style={{width:'100%',height:36,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box',...style}}>
    {placeholder&&<option value=''>{placeholder}</option>}
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
)

export const Txt = (p) => <textarea {...p} rows={2} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,resize:'none',boxSizing:'border-box',outline:'none'}}/>

// Página genérica para flujos que antes eran modales (Carga masiva, Generar reporte, Redactar con IA, Plazos, Revisión de datos):
// mismo header que Tarea/Gasto y el cuerpo a todo el ancho útil (escritorio) o columna (móvil).
// Página superpuesta: un flujo que se abre desde otra ventana/página (p. ej. Asignar anticipo, la venta) se muestra como PÁGINA
// a pantalla completa ('‹ origen | flujo'), sin tapar la barra lateral en escritorio.
export function PaginaSobre({origen,titulo,ctx,onBack,maxW=640,children}){
  const isDesktop=useIsDesktop()
  return createPortal(<div style={{position:'fixed',top:0,right:0,bottom:0,left:isDesktop?212:0,zIndex:650,background:C.bg,overflowY:'auto'}}><FlujoPagina origen={origen} titulo={titulo} ctx={ctx} onBack={onBack} maxW={maxW}>{children}</FlujoPagina></div>, document.body)
}

// Movilización: el medio va en subcategory (control de Uber) y la glosa se arma "Movilización Desde–Hasta para motivo".
export const MEDIOS_MOV = ['Uber','Cabify','DiDi','Taxi','Carga BIP','Estacionamiento','Bencina / peaje']

// Solo los traslados por app/taxi son excepcionales y exigen trayecto y motivo; la carga BIP (transporte público) no pide más.
export const MEDIO_CON_DETALLE = new Set(['Uber','Cabify','DiDi','Taxi'])

export const medioMovDe = t => { const n=String(t||'').toLowerCase(); return /\buber\b/.test(n)?'Uber':/cabify/.test(n)?'Cabify':/\bdidi\b/.test(n)?'DiDi':/taxi/.test(n)?'Taxi':/metro|\bbip\b|\bbus\b|micro|transporte p/.test(n)?'Carga BIP':/bencina|peaje|\btag\b/.test(n)?'Bencina / peaje':/estacionamiento/.test(n)?'Estacionamiento':'' }

export const glosaMovilizacion = (desde,hasta,motivo) => { const m=String(motivo||'').trim().replace(/^para\s+/i,''); return `Movilización ${String(desde||'').trim()}–${String(hasta||'').trim()}${m?` para ${m}`:''}` }

// Campo con label flotante DENTRO del box (ahorra alto: label chico arriba, valor abajo). Los inputs van borderless (fInp).
export const FloatFld = ({label,children,mb}) => <div style={{marginBottom:mb??8,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 11px'}}><div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5,lineHeight:1.4}}>{label}</div>{children}</div>

// ── GASTOS FORM (tabla de ingreso rápido) ─────────────────────────────────────
export const CATS_GASTO = ['Notaria','CBR','Diario Oficial','Registro Civil','Movilización','Archivo Judicial','Otro']

// Lo aprendido de «¿De qué?» por cliente (key = client_id) o persona (key = p:Nombre): lo más reciente primero.
export function useDeQueAprendido(){
  const [deq,setDeq] = useState({})
  useEffect(()=>{ let on=true
    selectAll(()=>supabase.from('learnings').select('key,value,updated_at,id').eq('kind','gasto_deque').order('updated_at',{ascending:false}).order('id')).then(r=>{ if(!on) return; const m={}
      ;(r?.data||[]).forEach(x=>{ if(!x.key||!x.value) return; const l=m[x.key]=m[x.key]||[]; if(!l.some(v=>_normTxt(v)===_normTxt(x.value))) l.push(x.value) }); setDeq(m) },()=>{})
    return ()=>{on=false} },[])
  const aprender = (scope,valor) => { const v=String(valor||'').trim(); if(!scope||!v) return
    learnPut('gasto_deque',scope,v); setDeq(p=>({...p,[scope]:[v,...(p[scope]||[]).filter(x=>_normTxt(x)!==_normTxt(v))]})) }
  return [deq,aprender]
}

// Chips de «¿De qué?»: lo aprendido para ese cliente/persona + sus razones sociales.
export const deQueOpciones = (deq,scope,clientId,clientEntities) => { const out=[]
  const add=v=>{ const t=String(v||'').trim(); if(t&&!out.some(x=>_normTxt(x)===_normTxt(t))) out.push(t) }
  ;(deq[scope]||[]).forEach(add); if(clientId) (clientEntities||[]).filter(e=>String(e.client_id)===String(clientId)).forEach(e=>add(e.name))
  return out.slice(0,5) }

// Subcategoría de «Otro»: nunca un medio de movilización (un envío o despacho no es un Uber).
export const subOtro = s => { const t=String(s||'').trim(); return t && !MEDIOS_MOV.some(m=>m.toLowerCase()===t.toLowerCase()) ? t : null }

// ── MOTOR DE CONCILIACIÓN (determinista, read-only) ─────────────────────────────────────────────────
// Detecta cuotas Programadas ya SALDADAS (fantasma). PURO — no muta nada. Auto-marca SOLO señales
// INEQUÍVOCAS (análisis, no intuición) — cada emitida cubre UNA sola programada (pool con consumo):
//   1 · MISMO PERÍODO por glosa: cuota y emitida declaran el MISMO mes ("Mensual Mayo" ↔ "mayo 26").
//       Nunca marca un mes realmente saltado (Eugenia julio, BM septiembre). alta.
//   2 · MISMA CUOTA N/M etiquetada: la programada "Cuota k/M" y una emitida "Cuota k/M" (mismo M) → el
//       calendario re-generó una cuota ya emitida. alta.
//   3 · COBERTURA por anticipo consolidado (Agustín: 3 adelantos → 1 factura). alta.
// GUARDARRAÍL DEL PLAN (cobro_config): una venta NUNCA puede tener más fantasmas que (filas vivas − nº de
// cuotas del plan). Si el conteo no lo permite, no se marca — esto solo habría evitado los 3 sub-facturados
// (Luis c2, Del Sante oct, JPM sep) que causó la vieja señal de "mismo vencimiento" (ELIMINADA por frágil:
// una emitida genérica "Honorarios" de una cuota vecina la engañaba). Lo que la deriva de fechas deja
// ambiguo se queda PENDIENTE — jamás se esconde una cuota real; se retira a mano o con futura alineación.
export function conciliarVentasSaldadas(billing=[], sales=[], anticipos=[], conciliacion=[], ufMap={}, fantasmaNo=new Set()){
  const act=(billing||[]).filter(b=>!b.deleted_at && b.status!=='Anulada' && (b.billing_type||'')!=='reembolso')
  const saleById={}; (sales||[]).forEach(s=>{ saleById[String(s.id)]=s })
  const bankFacturaIds=new Set((conciliacion||[]).filter(c=>c.tipo_destino==='factura'&&c.factura_id).map(c=>String(c.factura_id)))
  const bySale={}; act.forEach(b=>{ if(b.sale_id) (bySale[String(b.sale_id)]=bySale[String(b.sale_id)]||[]).push(b) })
  const amtOf=b=>montoFactura(b)||b.amount||0
  const close=(a,b)=>{ const x=amtOf(a),y=amtOf(b); if(!x||!y) return false; return Math.abs(x-y)/Math.max(x,y) < 0.03 }
  const out=[]
  Object.entries(bySale).forEach(([sid,rows])=>{
    const sale=saleById[sid]||null
    const emitidas=rows.filter(b=>b.invoice_no && b.status!=='Programada')
    const progs=rows.filter(b=>b.status==='Programada').sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
    if(!progs.length || !emitidas.length) return
    const emitIds=new Set(emitidas.map(e=>String(e.id)))
    const antIntoEmit=(anticipos||[]).filter(a=>a.estado==='consumido'&&String(a.sale_id||'')===sid&&a.billing_id&&emitIds.has(String(a.billing_id)))
    const pool=emitidas.map(e=>({e, per:concPeriodoOf(e.concept), cn:cuotaNMof(e.concept), used:false}))
    const take=pred=>{ const c=pool.find(x=>!x.used&&pred(x)); if(c){ c.used=true; return c.e } return null }
    const matched=[]; const rest=[]
    progs.forEach(p=>{
      if(fantasmaNo.has(String(p.id))) return   // "es pendiente, no fantasma" → aprendido, nunca re-marcar
      const pPer=concPeriodoOf(p.concept), pCn=cuotaNMof(p.concept)
      let hit=null, via=null
      if(pPer){ hit=take(x=>x.per===pPer && close(x.e,p)); if(hit) via='periodo' }               // 1 · mismo mes en la glosa
      if(!hit && pCn){ hit=take(x=>x.cn && x.cn.n===pCn.n && x.cn.tot===pCn.tot); if(hit) via='cuota' }  // 2 · misma Cuota k/M
      if(hit) matched.push({prog:p, hit, via}); else rest.push(p)
    })
    // 3 · cobertura por anticipo consolidado (una factura respaldada por adelantos cubre lo que resta)
    if(rest.length && antIntoEmit.length){
      const restSum=rest.reduce((s,r)=>s+(amtOf(r)||0),0)
      const big=pool.find(x=>!x.used && antIntoEmit.some(a=>String(a.billing_id)===String(x.e.id)) && amtOf(x.e) >= restSum*0.97)
      if(big){ big.used=true; rest.forEach(r=>matched.push({prog:r, hit:big.e, via:'cobertura'})); rest.length=0 }
    }
    // GUARDARRAÍL DEL PLAN: nunca marcar más que el excedente real (filas vivas − nº de cuotas del plan).
    const planN=planDeVenta(sale).length
    let cap=matched.length
    if(planN>0){ const excedente=Math.max(0,(emitidas.length+progs.length)-planN); cap=Math.min(cap,excedente) }
    const final=matched.slice(0,cap)   // periodo/cuota/cobertura son inequívocos; el cap solo recorta si el plan no da
    final.forEach(({prog,hit,via})=>{
      const razones=[]
      if(via==='periodo') razones.push(`Ya emitida como N° ${folioN(hit.invoice_no)||hit.invoice_no} — mismo período (${concPeriodoOf(hit.concept)})`)
      else if(via==='cuota') razones.push(`Ya emitida como N° ${folioN(hit.invoice_no)||hit.invoice_no} — misma ${(cuotaNMof(prog.concept)||{}).n}/${(cuotaNMof(prog.concept)||{}).tot}`)
      else if(via==='cobertura') razones.push(`Trato facturado como N° ${folioN(hit.invoice_no)||hit.invoice_no} con anticipos consolidados (${fmt(amtOf(hit))})`)
      if(bankFacturaIds.has(String(hit.id))) razones.push('con pago conciliado en el banco')
      out.push({ prog, sale, monto:amtOf(prog)||prog.amount||0, posterior:hit, razones, conf:'alta', via })
    })
  })
  return out.sort((a,b)=>(b.monto||0)-(a.monto||0))
}

// Fecha y hora de Chile en dd-mm-aaaa hh:mm (formato único).
export const fechaHoraCL = iso => { if(!iso) return '—'; const p=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso)); const g=t=>p.find(x=>x.type===t)?.value||''; return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')}` }

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
// Etiqueta legible de cada vista (para "volver a {origen}" y la paleta).
export const TAB_LABELS = {novedades:'Novedades',proponerVenta:'Proponer venta',misComisiones:'Mis comisiones',porCobrarMios:'Cuentas por cobrar',tarea:'Tarea',factura:'Factura',gasto:'Gasto',flujo:'Volver',dashboard:'Inicio',sales:'Ventas',billing:'Facturación',expenses:'Gastos',clients:'Clientes',tasks:'Tareas',conciliacion:'Banco',inteligencia:'Inteligencia',cajachica:'Caja chica',cobranza:'Cobranza',horas:'Horas',repricing:'Repricing',cartera:'Mis proyectos',presupuestoOficina:'Oficina',socios:'Socios',proveedores:'Proveedores',subarriendo:'Subarriendo',resultadoAnio:'Resultado del año',facturasDelMes:'Facturas del mes',estadoResultados:'Estado de resultados',flujoCaja:'Flujo de caja',procesos:'Procesos automáticos',calendarioTrib:'Calendario tributario',bandeja:'Bandeja del agente',miCarga:'Mi carga',editCliente:'Editar cliente',contactos:'Contactos',causas:'Causas'}

export const tonoMargen = m => m==null ? [C.bgSoft,C.muted] : m<0 ? [C.overdueBg,C.overdueText] : m<30 ? [C.soonBg,C.soonText] : m<55 ? [C.greenSoft,C.greenText] : m<70 ? [C.greenBg,C.greenText] : [C.greenDeep,C.greenText]

export const _SOCIO_RET = e => {
  const sc=String(e.subcategory||'').trim(), scN=_norm(sc)
  for(const s of SOCIOS_CFG){ if(scN && scN===_norm(s.nombre)) return s.nombre }
  for(const s of SOCIOS_CFG){ if(scN && scN.includes(_norm(s.nombre))) return s.nombre }
  if(sc && !/^retiros?$/i.test(sc)) return sc
  const g=_norm(e.personal_de||e.description||e.concept||e.src_name), gk=_rutK(e.personal_de||e.description||e.concept||e.src_name)
  for(const s of SOCIOS_CFG){ const rk=_rutK(s.rut); if(rk && (gk.includes(rk)||gk.includes(rk.slice(0,-1)))) return s.nombre }
  for(const s of SOCIOS_CFG){ if(_norm(s.nombre) && g.includes(_norm(s.nombre))) return s.nombre }
  return e.personal_de||'Otro'
}

