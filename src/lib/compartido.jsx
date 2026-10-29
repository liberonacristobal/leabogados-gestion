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

// Redondeo que CUADRA: redondea las partes de modo que sumen el total redondeado (resto mayor). Para mostrar cascadas
// (Facturado + Subarriendo + … = Ingresos) sin que la suma visible falle por 1. paso = unidad de redondeo (1 UF, 0,1 M…).
// fijos = índices que se redondean normal (la cifra que también se ve en otra tarjeta, p. ej. Facturado o Margen): el ajuste cae en las demás.
export function redondearPartes(partes, paso=1, fijos=[]){
  const v=partes.map(x=>(Number(x)||0)/paso), tot=Math.round(v.reduce((a,x)=>a+x,0))
  const fx=new Set(fijos.filter(i=>v.some((_,j)=>j!==i&&!fijos.includes(j)&&v[j]!==0)))   // si no hay a quién cargarle el ajuste, nadie queda fijo
  const out=v.map((x,i)=>fx.has(i)?Math.round(x):Math.floor(x)); let falta=tot-out.reduce((a,x)=>a+x,0)
  const ord=v.map((x,i)=>[x-Math.floor(x),i]).filter(([,i])=>!fx.has(i)&&v[i]!==0).sort((a,b)=>b[0]-a[0])
  for(let k=0;falta!==0&&ord.length;k=(k+1)%ord.length){ const i=ord[k][1]; if(falta>0){ out[i]++; falta-- } else { out[i]--; falta++ } }
  return out.map(x=>x*paso)
}

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
  try{ await supabase.from('activity_log').insert({ user_email:_actorBitacora, action, table_name:tabla, record_id:uuid, detail:detalle==null?null:JSON.stringify(completo?detalle:resumenBitacora(detalle)) }) }catch(_){}
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

// === CALCULO DE VENTA: unica fuente de verdad (modulo) === v2
// Recurrentes mensuales ACTIVAS se proyectan x12. No-recurrentes tal cual.
// Lo usan Dashboard y SalesView para que los totales NUNCA difieran.
export const esRecurrente = s => s.cobro_type==='mensual' && s.status==='Activo'

// Subarrendamiento (ingreso por arriendo, NO honorarios): se factura y programa como una venta,
// pero NO cuenta en "Vendido del año" ni en las metas de venta. Se excluye en todos los agregados de Vendido/áreas.
// Vive en Colaboradores (ficha del colaborador), no en Ventas ni en Clientes.
// Marcador: cobro_config.subarriendo === true (el area de sales es un enum acotado; no se toca).
export const esSubarriendo = s => s?.cobro_config?.subarriendo===true || (s?.area||'')==='Subarriendo'

export const ventaUF = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP'){ const clp=(parseFloat(s.amount_clp)||0); const uref=(s.uf_value>0?s.uf_value:ufRef); return uref ? (clp*factor)/uref : 0 }   // UF histórica de la venta (congelada); ufRef es solo respaldo
  return (parseFloat(s.amount_uf)||0)*factor
}

export const ventaCLP = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP') return (parseFloat(s.amount_clp)||0)*factor
  const clp = s.amount_clp || (s.amount_uf&&s.uf_value>0?Math.round(s.amount_uf*s.uf_value):Math.round((parseFloat(s.amount_uf)||0)*ufRef))
  return (clp||0)*factor
}

// Costo de terceros (reparto) de una venta en UF, anualizado si es recurrente. Fuente única del costo → margen de contribución = ventaUF − costoVentaUF.
export const costoVentaUF = (s, ufRef) => { const u=(parseFloat(s?.uf_value)>0?parseFloat(s.uf_value):ufRef)   // costo pactado en pesos → UF de la venta (congelada), no la de hoy
  return ((parseFloat(s?.cost_uf)||0)*(esRecurrente(s)?12:1)) + (s?.moneda==='CLP'&&s?.cost_clp&&u>0 ? (parseFloat(s.cost_clp)||0)/u*(esRecurrente(s)?12:1) : 0) }

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

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
export function RendicionModal({client, entityIds, expenses, clientEntities, sales=[], rendiciones=[], onClose, onRendicionComplete, setExpenses, currentUserName, onEnviar, editRend=null, setRendiciones, billing=[], setBilling, asPage=false, preSel=false, navBorr=null, onRevisada=null}) {
  const esEdicion = !!editRend
  const isDesktop = useIsDesktop()
  // Lo que se está armando se guarda en el equipo a cada cambio: si se sale (Volver, otra pestaña, se cierra la app) se recupera al volver.
  const wipKey = `fd_rend_wip_${client.id}__${currentUserName||'x'}`   // por persona: en un equipo compartido cada uno ve solo lo suyo
  const wip0 = useMemo(()=>{ if(editRend||preSel) return null; try{ const w=JSON.parse(localStorage.getItem(wipKey)||localStorage.getItem(`fd_rend_wip_${client.id}`)||'null'); if(!w||Date.now()-(w.at||0)>14*86400000) return null
      const pend=new Set((expenses||[]).filter(e=>e.client_id===client.id&&e.type==='gasto'&&!e.client_rendered_at&&!e.deleted_at).map(e=>String(e.id)))
      const ids=(w.sel||[]).filter(id=>pend.has(String(id))); return ids.length?{...w,sel:ids}:null }catch(_){ return null } },[])   // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState(()=> editRend ? new Set((expenses||[]).filter(e=>String(e.client_render_id)===String(editRend.id)).map(e=>e.id)) : new Set(wip0?wip0.sel:[]))
  const [wipRec, setWipRec] = useState(!!wip0)   // se recuperó una selección sin guardar
  const [saving, setSaving] = useState(false)
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [contacts, setContacts] = useState([])
  const [atencion, setAtencion] = useState(editRend?.dirigido_a||wip0?.atencion||'')
  const [prefilled, setPrefilled] = useState(false)   // "Dirigido a" precargado de rendición anterior
  const [limpiandoIA, setLimpiandoIA] = useState(false)
  const [editDet, setEditDet] = useState(null)   // detalle de un gasto en edición {id, v}: tocar el texto lo corrige a mano (mismo campo que «Mejorar descripciones con IA»)
  const [atencionEmail, setAtencionEmail] = useState(editRend?.dirigido_email||'')
  const [showSub, setShowSub] = useState(!!(editRend&&editRend.subproject))
  const [showFiltroFecha, setShowFiltroFecha] = useState(false)
  // «Ya la rendí por fuera»: registra una rendición hecha por correo o Drive (no envía nada) para que esos gastos dejen de figurar por rendir.
  const [extOpen,setExtOpen] = useState(false)
  const [extFecha,setExtFecha] = useState(()=>isoLocal(Date.now()))
  const [extLink,setExtLink] = useState('')

  // Movimientos del cliente, acotados a la(s) razón(es) social(es) seleccionada(s).
  // Con 1 RS todo pertenece a esa RS (incl. sin entity_id); sin selección/sin RS, todos.
  const entsCli = (clientEntities||[]).filter(e=>e.client_id===client.id)
  const singleRS = entsCli.length<=1
  // RS de la rendición: 1 RS → automática; varias → la elige el emisor (acota los gastos a esa RS).
  const [selEnt,setSelEnt] = useState(()=> { if(editRend?.entity_id) return editRend.entity_id; if(entsCli.length===1) return entsCli[0].id; if(entityIds&&entityIds[0]) return entityIds[0]
    // Varias RS: abre en la que tiene más gastos por rendir (no en la primera de la lista, que puede no tener ninguno).
    const n={}; (expenses||[]).forEach(e=>{ if(e.client_id===client.id&&e.type==='gasto'&&!e.client_rendered_at&&e.entity_id) n[e.entity_id]=(n[e.entity_id]||0)+1 })
    const top=Object.keys(n).sort((a,b)=>n[b]-n[a])[0]; return top || (entsCli[0]&&entsCli[0].id) || null })
  // Proyecto y subproyecto de la rendición (el emisor elige; el proyecto FILTRA los gastos al crear; al editar es solo metadata).
  // Proyectos que se muestran (desplegable con varios a la vez; vacío = todos). `proyecto` = el único elegido, con la semántica de antes
  // (filtra, y a los gastos sin proyecto les asigna ese al rendir).
  const [proyF,setProyF] = useState(()=>{ const p=editRend?.project||wip0?.proyecto||''; return new Set(p?[p]:[]) })
  const proyecto = proyF.size===1&&!proyF.has('__sin__') ? [...proyF][0] : ''
  const setProyecto = p => setProyF(new Set(p?[p]:[]))
  const [proyOpen,setProyOpen] = useState(false)   // desplegable de proyectos abierto
  const [subproyecto,setSubproyecto] = useState(editRend?.subproject||wip0?.subproyecto||'')
  useEffect(()=>{ if(esEdicion) return; try{ localStorage.removeItem(`fd_rend_wip_${client.id}`); if(selected.size) localStorage.setItem(wipKey,JSON.stringify({sel:[...selected],proyecto,subproyecto,atencion,at:Date.now()})); else localStorage.removeItem(wipKey) }catch(_){} },[selected,proyecto,subproyecto,atencion])   // eslint-disable-line react-hooks/exhaustive-deps
  const headEnt = entsCli.length===1 ? entsCli[0] : (entsCli.find(e=>e.id===selEnt)||null)
  // Multi-RS: al elegir una RS se incluyen sus gastos Y los SIN razón social (ej. notaría sin RS) — no deben quedar fuera de la rendición.
  const inScope = e => singleRS ? true : (selEnt ? (e.entity_id===selEnt || !e.entity_id) : true)
  const allMovs = expenses.filter(e=>e.client_id===client.id && inScope(e))
  // Comprobantes de respaldo: qué gastos del cliente tienen adjuntos (para referenciarlos en el PDF).
  const [conRespaldo,setConRespaldo] = useState(new Set())
  useEffect(()=>{
    const ids=allMovs.filter(e=>e.type==='gasto').map(e=>e.id); if(!ids.length){ setConRespaldo(new Set()); return }
    let alive=true
    supabase.from('expense_attachments').select('expense_id').in('expense_id',ids).then(({data})=>{ if(alive) setConRespaldo(new Set((data||[]).map(r=>String(r.expense_id)))) },()=>{})
    return ()=>{alive=false}
  },[client.id,selEnt])
  // Rendir un fondo: con 2+ fondos se elige primero qué se rinde (gastos o un fondo). El reparto dice qué gastos cubrió cada fondo.
  const repF = useMemo(()=>repartoFondos(expenses, client.id),[expenses,client.id])
  const fondosRS = repF.fondos.filter(x=>inScope(x.f))
  const verModoFondo = !esEdicion && !navBorr && fondosRS.length>=2
  const [modoR,setModoR] = useState(editRend?.fondo_id?'fondo':'gastos')
  const [fondoSel,setFondoSel] = useState(editRend?.fondo_id||null)
  const [addSinFondo,setAddSinFondo] = useState(false)
  const enFondo = !!fondoSel && modoR==='fondo' && (esEdicion?!!editRend?.fondo_id:verModoFondo)
  const fondoObj = enFondo ? ((expenses||[]).find(e=>String(e.id)===String(fondoSel))||null) : null
  const _fondoRend = rendicionFondo(expenses, client.id, singleRS?null:selEnt, esEdicion?editRend.id:null, null, enFondo?fondoSel:null)
  const fondosDisp = _fondoRend.totFondos
  const saldoActual = _fondoRend.saldo
  // Correlativo por cliente: se cuenta solo sobre las rendiciones ENVIADAS (correlativo grabado). Tentativo = max + 1.
  const rendsCliEnv = (rendiciones||[]).filter(r=>String(r.client_id)===String(client.id) && r.correlativo && !r.anulada_at)
  const nextCorr = corrSiguiente(rendiciones, client.id)
  const previasN = rendsCliEnv.length

  // Proyecto = VENTA: los proyectos del cliente vienen de sus ventas/propuestas (sales.title) y de los
  // proyectos ya escritos en gastos pendientes. Se combinan; sugerido = el de más gastos, o si no hay, la venta.
  const gastosPend = allMovs.filter(e=>e.type==='gasto' && !e.client_rendered_at)
  const proyConteo = {}; gastosPend.forEach(e=>{ const p=e.project||''; if(p) proyConteo[p]=(proyConteo[p]||0)+1 })
  const ventasProy = (sales||[]).filter(s=>String(s.client_id)===String(client.id) && s.title && !['Rechazada','Borrador'].includes(s.status) && (singleRS || !s.entity_id || String(s.entity_id)===String(selEnt)))
  const proyToSale = {}; ventasProy.forEach(s=>{ if(!(s.title in proyToSale)) proyToSale[s.title]=s.id })
  const proyVentas = [...new Set(ventasProy.map(s=>s.title))]
  const proyectosDisp = [...new Set([...Object.keys(proyConteo), ...proyVentas])].sort((a,b)=>(proyConteo[b]||0)-(proyConteo[a]||0))
  const cntProy = {}; gastosPend.filter(e=>!e.no_descuenta_saldo&&!e.apertura_id&&e.category!=='Apertura').forEach(e=>{ const k=e.project||(sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title||''; const c=cntProy[k]||(cntProy[k]={n:0,m:0}); c.n++; c.m+=Number(e.amount)||0; const t=cntProy.__todos||(cntProy.__todos={n:0,m:0}); t.n++; t.m+=Number(e.amount)||0 })
  const proyectoSugerido = Object.keys(proyConteo).sort((a,b)=>proyConteo[b]-proyConteo[a])[0] || proyVentas[0] || ''
  // Default automático: SOLO un proyecto que tenga gastos disponibles; nunca un título de venta sin gastos (ocultaría todo). Si no hay, "Todos".
  // Un solo proyecto con gastos → ese (los sin proyecto lo toman al rendir); varios → «Todos», agrupados por proyecto.
  const proyectoDefault = Object.keys(proyConteo).length===1 ? Object.keys(proyConteo)[0] : ''
  // Al cambiar de RS (o al abrir), preseleccionar solo si hay un proyecto con gastos; si no, dejar "Todos" para no esconder nada.
  useEffect(()=>{ if(esEdicion) return; setProyecto(proyectosDisp.includes(proyecto)?proyecto:(preSel?'':proyectoDefault)) }, [selEnt])   // borrador preparado: todos sus gastos de la RS, sin acotar a un trabajo

  // Gastos disponibles para rendir (no rendidos aun), acotados al proyecto elegido.
  // Un gasto pertenece al proyecto si tiene esa glosa de proyecto O está vinculado a su venta (sale_id).
  // Posibles duplicados del cliente (misma regla que caja chica): se comparan con todos sus gastos, también los ya rendidos.
  const dupRend = posiblesDuplicadosGastos(allMovs.filter(e=>e.type==='gasto'))
  const keyP = e => e.project || (sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title || ''
  // Chips del gasto (proyecto y fondo): se corrigen tocándolos, sin marcar ni desmarcar el gasto.
  const chipSty = warn => ({fontSize:9.5,fontWeight:700,color:warn?C.soonText:C.accent,background:warn?C.soonBg:C.bgSoft,border:`1px dashed ${warn?C.soonText:C.done}`,borderRadius:20,padding:'1px 6px',maxWidth:'100%',cursor:'pointer',fontFamily:'inherit'})
  const _stop = ev => ev.stopPropagation()
  const disponibles = allMovs.filter(e=>{
    if(e.type!=='gasto') return false
    const mine = esEdicion && String(e.client_render_id)===String(editRend.id)   // gasto que YA está en esta rendición: siempre visible (pre-marcado)
    if(e.no_descuenta_saldo && !mine) return false   // gasto histórico no se rinde
    if((e.apertura_id || e.category==='Apertura') && !mine) return false   // resumido en el saldo de apertura: no se rinde
    if(e.client_rendered_at && !mine) return false   // gastos de OTRA rendición no entran
    if(!mine && enFondo){   // rendir un fondo: los gastos que le tocan en el reparto (+ los sin fondo, si se pidió agregarlos)
      const d=repF.deGasto[e.id]; if(!(d&&String(d)===String(fondoSel)) && !(addSinFondo&&d==null)) return false }
    else if(!mine){   // los filtros de proyecto/fecha solo acotan los candidatos a AGREGAR, nunca esconden los propios
      if(proyecto){ const sid=proyToSale[proyecto]; const ok=!e.project || (e.project||'')===proyecto || (sid && String(e.sale_id)===String(sid)); if(!ok) return false }
      else if(proyF.size){ const k=keyP(e); if(k ? !proyF.has(k) : !proyF.has('__sin__')) return false }
      if(fDesde && e.date && e.date < fDesde) return false
      if(fHasta && e.date && e.date > fHasta) return false
    }
    return true
  }).sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)

  const totalSel = disponibles.filter(e=>selected.has(e.id)).reduce((a,e)=>a+(e.amount||0),0)
  const saldoTrasRendicion = saldoActual - totalSel
  const fondosList = _fondoRend.fondos

  // "Dirigido a": precargar del valor guardado de rendiciones anteriores del cliente (tabla contacts)
  useEffect(()=>{
    let alive=true
    supabase.from('contacts').select('*').eq('client_id',client.id).order('created_at').then(({data})=>{
      if(!alive||!data) return
      setContacts(data)
      if(!esEdicion && data[0]?.nombre){ setAtencion(data[0].nombre); setPrefilled(true) }
      if(!esEdicion && data[0]?.email){ setAtencionEmail(data[0].email) }
    })
    return ()=>{alive=false}
  },[client.id])
  // Guarda el "Dirigido a" para reutilizarlo (insert si no hay contacto, update si cambió)
  const guardarDirigido = async()=>{
    const v=(atencion||'').trim(); if(!v) return
    if(contacts[0]){ if(contacts[0].nombre!==v){ const {error}=await supabase.from('contacts').update({nombre:v}).eq('id',contacts[0].id); if(error){ appAlert('No se pudo guardar el contacto: '+error.message); return } setContacts(p=>p.map((c,i)=>i===0?{...c,nombre:v}:c)) } }
    else { const {data}=await supabase.from('contacts').insert({client_id:client.id,nombre:v}).select().single(); if(data) setContacts([data]) }
  }

  const toggleAll = () => {
    if(gastosSel.length===disponibles.length) setSelected(new Set())
    else setSelected(new Set(disponibles.map(e=>e.id)))
  }
  const toggleOne = id => setSelected(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const CATS = CAT_COLORS

  const gastosSel = disponibles.filter(e=>selected.has(e.id))
  // Rendir cuentas exige proyecto: si algún gasto marcado no lo tiene, hay que elegirlo (se le asigna al rendir, con su venta).
  const nSinProyR = gastosSel.filter(e=>!e.sale_id&&!e.project).length
  // Rendir un fondo: los gastos sin proyecto toman el del fondo; si el fondo tampoco tiene, se le asigna arriba.
  const proyFondo = enFondo ? (fondoObj?.project||'') : ''
  const faltaProyR = enFondo ? (nSinProyR>0 && !proyFondo) : (!proyecto && nSinProyR>0)
  const puedeRendir = gastosSel.length>0 && !faltaProyR
  // Borrador preparado (Rendir a cliente › Borradores): abre con todos sus gastos disponibles ya marcados, una sola vez.
  const _preHecho = useRef(false)
  useEffect(()=>{ if(!preSel||esEdicion||_preHecho.current||!disponibles.length) return; _preHecho.current=true; setSelected(new Set(disponibles.map(e=>e.id))) },[preSel,disponibles.length])   // eslint-disable-line react-hooks/exhaustive-deps
  const proyPatch = e => { const pr=enFondo?proyFondo:proyecto, sid=proyToSale[pr]; return pr ? {...(!e.project?{project:pr}:{}), ...(sid&&!e.sale_id?{sale_id:sid}:{})} : {} }

  // IA: profesionaliza las descripciones de los gastos seleccionados (expande abreviaciones legales, corrige tildes). Guarda el resultado.
  const guardarDetalle = async()=>{ const d=editDet; if(!d) return; setEditDet(null)
    const e=(expenses||[]).find(x=>x.id===d.id); const v=String(d.v||'').trim(); if(!e||!v||v===(e.concept||'')) return
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,concept:v}:x))
    if(DEMO) return
    const {error}=await supabase.from('expenses').update({concept:v}).eq('id',e.id)
    if(error){ if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,concept:e.concept}:x)); appAlert('No se pudo guardar el detalle: '+error.message); return }
    logActividad('gastos.detalle_editado',{tabla:'expenses',id:e.id,detalle:{cliente:client?.name,title:'Detalle del gasto corregido en la rendición',antes:e.concept||'',despues:v}}) }
  // Correcciones en la misma página (quedan en el gasto o fondo y en la bitácora): proyecto de un gasto, fondo de un gasto, proyecto de un fondo.
  const _patchMov = async(e, patch, accion, title, antes, despues) => {
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
    if(DEMO) return true
    const {error}=await supabase.from('expenses').update(patch).eq('id',e.id)
    if(error){ const back={}; Object.keys(patch).forEach(k=>{ back[k]=e[k]??null }); if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...back}:x)); appAlert('No se pudo guardar: '+error.message); return false }
    logActividad(accion,{tabla:'expenses',id:e.id,detalle:{cliente:client?.name,title,antes,despues,monto:Math.round(Number(e.amount)||0)}}); return true }
  const asignarProyGasto = (e,p) => { if((e.project||'')===(p||'')) return; const sid=p?(proyToSale[p]||null):null
    return _patchMov(e,{project:p||null, sale_id:sid}, 'gastos.proyecto_editado', 'Proyecto del gasto corregido en la rendición', keyP(e)||'Sin proyecto', p||'Sin proyecto') }
  const asignarProyFondo = (f,p) => { if(!f||(f.project||'')===(p||'')) return; const sid=p?(proyToSale[p]||null):null
    return _patchMov(f,{project:p||null, sale_id:sid}, 'fondos.proyecto_asignado', 'Proyecto del fondo asignado en la rendición', f.project||'Sin proyecto', p||'Sin proyecto') }
  const fondoTxt = f => f ? `Fondo ${fmtFechaDMY(f.date)}${f.project?` · ${f.project}`:''}` : 'Sin fondo'
  const moverAFondo = (e,fid) => { const prev=repF.deGasto[e.id]||null; if(String(prev||'')===String(fid||'')&&String(e.reembolso_fondo_id||'')===String(fid||'')) return
    const fA=(expenses||[]).find(x=>String(x.id)===String(prev)), fB=(expenses||[]).find(x=>String(x.id)===String(fid))
    if(enFondo&&String(fid||'')!==String(fondoSel)) setSelected(p=>{ const n=new Set(p); n.delete(e.id); return n })
    return _patchMov(e,{reembolso_fondo_id:fid||null}, 'gastos.fondo_movido', fid?'Gasto movido a otro fondo':'Gasto vuelve al reparto automático de fondos', fondoTxt(fA), fid?fondoTxt(fB):'Según la regla') }
  const mejorarDescripcionesIA = async()=>{
    const sel = disponibles.filter(e=>selected.has(e.id))
    if(!sel.length) return
    setLimpiandoIA(true)
    const lista = sel.map((e,i)=>`${i+1}. "${e.concept||''}"`).join('\n')
    const prompt = `Eres asistente de una firma de abogados chilena. Profesionaliza estas descripciones de GASTOS para una rendición al cliente: corrige ortografía y tildes ("notaria"→"Notaría", "inscripcion"→"Inscripción"), capitaliza bien y EXPANDE abreviaciones legales chilenas ("EP"→"Escritura Pública", "CV"→"Compraventa", "CCV"→"Copia con Vigencia", "GP"→"Gravámenes y Prohibiciones", "D.O."→"Diario Oficial", "+K"→"Empresa en un Día", "CBR"→"Conservador de Bienes Raíces", "CBRS"→"Conservador de Bienes Raíces de Santiago"). Mantén el significado; si ya está correcta, devuélvela igual. NO inventes datos. Responde SOLO un array JSON sin markdown: [{"i":1,"concepto":"..."}]\n\nDESCRIPCIONES:\n${lista}`
    try{
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:1500,messages:[{role:'user',content:prompt}]})
      const raw = (data.content?.[0]?.text||'[]').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      const arr = JSON.parse(raw)
      const updates = []
      ;(Array.isArray(arr)?arr:[]).forEach(o=>{ const e=sel[(o.i||0)-1]; if(e && o.concepto && o.concepto.trim() && o.concepto!==e.concept){ updates.push({id:e.id, concepto:o.concepto.trim()}) } })
      if(!updates.length){ appAlert('Las descripciones ya estaban claras.'); setLimpiandoIA(false); return }
      for(const u of updates){ await supabase.from('expenses').update({concept:u.concepto}).eq('id',u.id) }
      if(setExpenses) setExpenses(p=>p.map(e=>{ const u=updates.find(x=>x.id===e.id); return u?{...e,concept:u.concepto}:e }))
      logEvent('rendicion','limpiar_descripciones',{n:updates.length},currentUserName)
      appAlert(`${updates.length} descripción(es) mejorada(s).`)
    }catch(e){ appAlert('Error al mejorar con IA: '+(e?.message||e)) }
    setLimpiandoIA(false)
  }
  const generatePDFContent = (atencionVal) => {
    const ent = headEnt
    const razon = ent?.name || client.name || '\u2014'
    const rut = ent?.rut || client.rut || ''
    const fechaEmision = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const fechas = [...gastosSel, ...fondosList].map(e=>e.date).filter(Boolean).sort()
    const mesAno = d => new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'})
    const dia = d => new Date(d+'T12:00').toLocaleDateString('es-CL')
    let periodo='\u2014'
    if(fechas.length){ const ini=fechas[0], fin=fechas[fechas.length-1]; periodo = mesAno(ini)===mesAno(fin) ? mesAno(ini) : `${dia(ini)} \u2013 ${dia(fin)}` }
    // Rendiciones anteriores de este fondo (la tanda actual a\u00fan no est\u00e1 rendida \u2192 queda fuera).
    const {previas, rendidoAntes} = _fondoRend
    return rendicionDocHtml({ razon, rut, periodo, fechaEmision, dirigidoA: atencionVal||null, gastos: gastosSel.map(e=>({...e,respaldo:conRespaldo.has(String(e.id))})), fondos: fondosList, totGastos: totalSel, totFondos: fondosDisp, rendidoAntes, rendicionesPrevias: previas, correlativo: nextCorr, project: proyecto||null, subproject: (subproyecto||'').trim()||null, grupos: rendGruposProyecto({expenses, clientId:client.id, scopeEntId:singleRS?null:selEnt, gastos:gastosSel.map(e=>({...e,...proyPatch(e)})), sales, clientEntities}) })
  }

  // ── Trabajos (= proyectos) de la rendición. Separar por trabajo solo si TODO fondo del cliente tiene trabajo asignado
  // (si no, no hay cómo saber a cuál va cada peso sin inventarlo).
  const keyT = e => e.project || (sales||[]).find(s=>String(s.id)===String(e.sale_id))?.title || ''
  const proyPatchT = (e,t) => t ? {...(!e.project?{project:t}:{}), ...(proyToSale[t]&&!e.sale_id?{sale_id:proyToSale[t]}:{})} : {}
  const scopeEnt = singleRS?null:selEnt
  const fSinT = fondosSinTrabajo(expenses, client.id, scopeEnt)
  const trabajosSel = [...new Set(gastosSel.map(e=>keyT({...e,...proyPatch(e)})).filter(Boolean))]
  const multiT = !esEdicion && !enFondo && trabajosSel.length>=2
  const puedeSeparar = multiT && fSinT===0
  const trabajosCli = new Set(allMovs.map(e=>e.project||'').filter(Boolean))
  // Un solo trabajo de un cliente que tiene varios: los fondos y el saldo son los de ESE trabajo (no los del cliente completo).
  const porTrabajoUno = !esEdicion && !enFondo && trabajosSel.length===1 && fSinT===0 && trabajosCli.size>=2
  const [modo,setModo] = useState('junto')   // 'junto' | 'sep1' (separadas, un correo) | 'sepN' (un correo cada una)
  useEffect(()=>{ if(DEMO) return; let on=true; supabase.from('learnings').select('value').eq('kind','rendicion_modo').eq('key',String(client.id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(on&&['junto','sep1','sepN'].includes(data?.value)) setModo(data.value) },()=>{}); return ()=>{on=false} },[client.id])
  const elegirModo = m => { setModo(m); if(!DEMO) setLearningKV('rendicion_modo',String(client.id),m).catch(()=>{}) }
  const modoEf = puedeSeparar ? modo : 'junto'
  const cifrasT = t => { const f=rendicionFondo(expenses, client.id, scopeEnt, esEdicion?editRend.id:null, t); const gs=gastosSel.filter(e=>keyT({...e,...proyPatch(e)})===t); const tg=gs.reduce((a,e)=>a+(e.amount||0),0); return {t, f, gs, tg, saldo:f.totFondos-f.rendido-tg} }
  const porT = (multiT||porTrabajoUno) ? trabajosSel.map(cifrasT) : []
  const periodoDe = gs => { const _fs=gs.map(e=>e.date).filter(Boolean).sort(); const _ma=d=>new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'}); const _di=d=>fmtFechaDMY(d); return _fs.length ? (_ma(_fs[0])===_ma(_fs[_fs.length-1]) ? _ma(_fs[0]) : `${_di(_fs[0])} – ${_di(_fs[_fs.length-1])}`) : new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'}) }
  // Una sola forma de crear la rendición (borrador, vista previa del correo, separadas): registra la fila, marca los gastos y la devuelve con sus gastos.
  const crearRendicion = async(gs, {proyectoR, porTrabajo, fondoId=null, proyFila}) => {
    const renderId = crypto.randomUUID(), now = new Date().toISOString()
    const tot = gs.reduce((a,e)=>a+(e.amount||0),0)
    const otNums = [...new Set(gs.map(e=>e.ot_number).filter(Boolean))].join(', ')
    const fila = { id:renderId, user_name:currentUserName||'admin', client_id:client.id, periodo:periodoDe(gs), total:tot, n_gastos:gs.length, n_clientes:1, tipo:'cliente',
      entity_id:selEnt||null, project:(proyFila!==undefined?proyFila:proyectoR)||null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, dirigido_email:atencionEmail||null, ot_numbers:otNums||null, por_trabajo:!!porTrabajo, ...(fondoId?{fondo_id:fondoId}:{}) }
    const {error:rendErr} = await supabase.from('rendiciones').insert(fila)
    if(rendErr) throw new Error('No se pudo registrar la rendición: '+rendErr.message)
    let falloMarca = 0; const marcados=[]
    // Rendición de un fondo: cada gasto queda ligado a ese fondo (el reparto ya no lo mueve aunque entren fondos nuevos).
    for(const e of gs){ const patch={client_rendered_at:now, client_render_id:renderId, ...(proyectoR?proyPatchT(e,proyectoR):proyPatch(e)), ...(fondoId?{reembolso_fondo_id:fondoId}:{})}; const {data:upd,error}=await supabase.from('expenses').update(patch).eq('id',e.id).is('client_rendered_at',null).select('id'); if(error||(!DEMO&&!(upd||[]).length)){ falloMarca++; continue } marcados.push({...e,...patch}) }
    if(!marcados.length){ await supabase.from('rendiciones').delete().eq('id',renderId); throw new Error('ningún gasto quedó en la rendición (ya estaban en otra). No se guardó nada.') }   // nunca una rendición vacía
    if(falloMarca>0){ appAlert(`Atención: ${falloMarca} de ${gs.length} gasto(s) no se marcaron: ya estaban en otra rendición o no se pudieron guardar. Quedan fuera de esta.`); const tot2=marcados.reduce((a,e)=>a+(e.amount||0),0); await supabase.from('rendiciones').update({total:tot2,n_gastos:marcados.length}).eq('id',renderId); fila.total=tot2; fila.n_gastos=marcados.length }
    if(setExpenses) setExpenses(p=>p.map(e=>{ const m=marcados.find(x=>x.id===e.id); return m?{...e,...m}:e }))
    const rendObj = {...fila, created_at:now, correlativo:null}
    if(onRendicionComplete) onRendicionComplete(rendObj)
    return {...rendObj, _gastos:marcados}
  }
  // Rendición(es) en vista previa: nada se registra hasta «Guardar borrador» o «Enviar» (ahí corre _crear).
  const virtuales = () => {
    const base = {id:null, _virtual:true, client_id:client.id, tipo:'cliente', entity_id:selEnt||null, fondo_id:enFondo?fondoSel:null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, dirigido_email:atencionEmail||null, user_name:currentUserName||'admin', created_at:new Date().toISOString()}
    if(enFondo){ const gs=gastosSel.map(e=>({...e,...proyPatch(e),reembolso_fondo_id:fondoSel})); const pf=proyFondo||(trabajosSel.length===1?trabajosSel[0]:null)||null; return [{...base, _gastos:gs, project:pf, por_trabajo:false, periodo:periodoDe(gs), total:totalSel, n_gastos:gs.length, correlativo:nextCorr, _crear:()=>crearRendicion(gastosSel,{proyectoR:null, porTrabajo:false, fondoId:fondoSel, proyFila:pf})}] }
    if(modoEf==='junto'){ const gs=gastosSel.map(e=>({...e,...proyPatch(e)})); const pt=porTrabajoUno; const pj=proyecto||(pt||trabajosSel.length===1?trabajosSel[0]:null)||null; return [{...base, _gastos:gs, project:pj, por_trabajo:pt, periodo:periodoDe(gs), total:totalSel, n_gastos:gs.length, correlativo:nextCorr, _crear:()=>crearRendicion(gastosSel,{proyectoR:proyecto||(pt?trabajosSel[0]:null), porTrabajo:pt, proyFila:pj})}] }
    return porT.map((o,i)=>{ const gs=o.gs.map(e=>({...e,...proyPatchT(e,o.t)})); return {...base, _gastos:gs, project:o.t, por_trabajo:true, periodo:periodoDe(gs), total:o.tg, n_gastos:gs.length, correlativo:nextCorr+i, _crear:()=>crearRendicion(o.gs,{proyectoR:o.t, porTrabajo:true})} })
  }
  // «Una por proyecto en un correo» (sep1): el grupo queda en rendiciones.correo para que Borradores y el envío conjunto las manden en un solo correo.
  const agruparSep1 = async hechas => {
    if(enFondo||modoEf!=='sep1'||hechas.length<2) return
    const correo={modo:'sep1', grupo:hechas.map(x=>x.id), agrupado_at:new Date().toISOString()}
    const {error}=await supabase.from('rendiciones').update({correo}).in('id',correo.grupo)
    if(error) throw new Error('las rendiciones quedaron guardadas, pero no como un solo correo: '+error.message)
    if(setRendiciones) setRendiciones(p=>p.map(x=>correo.grupo.includes(x.id)?{...x,correo}:x))
  }
  const verPdfVirtual = v => { const w=window.open('','_blank'); if(!w){ appAlert('El navegador bloqueó la ventana del PDF. Permite ventanas emergentes para esta página.'); return } w.document.write(rendicionPdfHtml(v, client, expenses, clientEntities, conRespaldo)); w.document.close() }
  const handleGenerar = async(accion='pdf') => {
    if(!gastosSel.length||faltaProyR) return
    const vs = virtuales()
    // Ver PDF es solo revisar: no registra nada.
    if(accion==='pdf'){ verPdfVirtual(vs[0]); return }
    // Eligió separar por proyecto pero hay un fondo sin proyecto: no guardar en silencio como una sola rendición.
    if(!enFondo&&multiT&&modo!=='junto'&&!puedeSeparar){ appAlert('Para separar por proyecto, primero elige el proyecto del fondo en «Antes de separar», o elige «Una rendición».'); return }
    if(accion==='correo'){   // paso 2: el correo, todavía sin registrar nada
      await guardarDirigido()
      if(!onEnviar) return
      _salida.current=true   // va al correo: no es salir sin guardar
      if(modoEf==='sep1') onEnviar({...vs[0], _hermanas:vs.slice(1)})
      else if(modoEf==='sepN') onEnviar({...vs[0], _cola:vs.slice(1)})
      else onEnviar(vs[0])
      return
    }
    // Guardar borrador: registra la(s) rendición(es) sin enviar nada.
    setSaving(true)
    try{
      const hechas=[]; for(const v of vs) hechas.push(await v._crear())
      await agruparSep1(hechas)
      _salida.current=true
      await guardarDirigido()
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:hechas[0]?.id,detalle:{cliente:client.name,title:`Borrador guardado${hechas.length>1?` (${hechas.length} rendiciones por trabajo)`:''}`,monto:Math.round(hechas.reduce((a,x)=>a+(x.total||0),0))}})
      setSelected(new Set())
      if(onRevisada) onRevisada()
      else { appAlert(hechas.length>1?`${hechas.length} borradores guardados. Los encuentras en Rendir a cliente › Borradores.`:'Borrador guardado. Lo encuentras en Rendir a cliente › Borradores.'); onClose&&onClose() }
    }catch(e){ appAlert('Error: '+e.message) }
    setSaving(false)
  }
  // Salir con gastos marcados sin guardar (Volver, otra pestaña, siguiente cliente): queda guardada sola como borrador,
  // a nombre de quien la armaba, para no perder el trabajo. Ir al correo o guardar/registrar no cuenta como salir.
  const _salida = useRef(false)
  const _autoBorr = useRef(null)
  _autoBorr.current = (!esEdicion && gastosSel.length>0 && !faltaProyR && !saving && !(!enFondo&&multiT&&modo!=='junto'&&!puedeSeparar)) ? async()=>{
    try{ const vs=virtuales(); const hechas=[]; for(const v of vs) hechas.push(await v._crear())
      await agruparSep1(hechas)
      try{ localStorage.removeItem(wipKey); localStorage.removeItem(`fd_rend_wip_${client.id}`) }catch(_){}
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:hechas[0]?.id,detalle:{cliente:client.name,title:'Borrador guardado al salir de la rendición',monto:Math.round(hechas.reduce((a,x)=>a+(x.total||0),0))}})
    }catch(_){ /* queda la selección guardada en el equipo y se recupera al volver */ } } : null
  // Solo en un desmontaje real: el doble montaje de prueba de React (desarrollo) vuelve a montar antes del setTimeout.
  const _montado = useRef(false)
  useEffect(()=>{ _montado.current=true; return ()=>{ _montado.current=false; const f=_autoBorr.current; setTimeout(()=>{ if(!_montado.current&&!_salida.current&&f) f() },0) } },[])   // eslint-disable-line react-hooks/exhaustive-deps
  const handleExterna = async() => {
    if(!gastosSel.length||faltaProyR||!extFecha) return
    setSaving(true)
    try {
      const renderId = crypto.randomUUID()
      const enviadaAt = new Date(extFecha+'T12:00:00').toISOString()
      const _fs = gastosSel.map(e=>e.date).filter(Boolean).sort()
      const periodoSel = _fs.length ? `${fmtFechaDMY(_fs[0])} – ${fmtFechaDMY(_fs[_fs.length-1])}` : fmtFechaDMY(extFecha)
      const {data:mx}=await supabase.from('rendiciones').select('correlativo').eq('client_id',client.id).is('anulada_at',null).not('correlativo','is',null).order('correlativo',{ascending:false}).limit(1).maybeSingle()   // misma regla que corrSiguiente: las anuladas no cuentan
      const corr=((mx&&mx.correlativo)||0)+1
      const row={id:renderId,user_name:currentUserName||'admin',client_id:client.id,periodo:periodoSel,total:totalSel,n_gastos:gastosSel.length,n_clientes:1,tipo:'cliente',
        entity_id:selEnt||null,project:proyecto||null,subproject:(subproyecto||'').trim()||null,dirigido_a:(atencion||'').trim()||null,
        created_at:enviadaAt,sent_at:enviadaAt,correlativo:corr,estado_envio:'externa',comprobante_url:(extLink||'').trim()||null}
      const {error:rErr}=await supabase.from('rendiciones').insert(row)
      if(rErr) throw new Error('No se pudo registrar la rendición: '+rErr.message)
      // Solo cuentan los gastos que de verdad quedaron marcados (uno ya rendido en otra rendición no se toca): la fila guarda ese total.
      const marcados=[]
      for(const e of gastosSel){ const {data:upd,error}=await supabase.from('expenses').update({client_rendered_at:enviadaAt,client_render_id:renderId,...proyPatch(e)}).eq('id',e.id).is('client_rendered_at',null).select('id'); if(!error&&(DEMO||(upd||[]).length)) marcados.push(e) }
      const falla=gastosSel.length-marcados.length
      if(!marcados.length){ await supabase.from('rendiciones').delete().eq('id',renderId); throw new Error('ningún gasto quedó marcado (ya estaban en otra rendición). No se registró nada.') }
      if(falla>0){ const tot2=marcados.reduce((a,e)=>a+(e.amount||0),0); row.total=tot2; row.n_gastos=marcados.length; await supabase.from('rendiciones').update({total:tot2,n_gastos:marcados.length}).eq('id',renderId); appAlert(`Atención: ${falla} de ${gastosSel.length} gasto(s) ya estaban en otra rendición y no se incluyeron.`) }
      if(setExpenses) setExpenses(p=>p.map(e=>marcados.find(g=>g.id===e.id)?{...e,client_rendered_at:enviadaAt,client_render_id:renderId,...proyPatch(e)}:e))
      if(setRendiciones) setRendiciones(p=>[row,...(p||[])])
      logActividad('rendicion.externa_registrada',{tabla:'rendiciones',id:renderId,detalle:{cliente:client.name,title:`Rendición N° ${corr} hecha fuera de la app (${fmtFechaDMY(extFecha)})`,monto:Math.round(totalSel),n_gastos:gastosSel.length}})
      setSelected(new Set()); setExtOpen(false); setExtLink('')
      appAlert(`Rendición N° ${corr} registrada como hecha fuera de la app (${row.n_gastos} gasto${row.n_gastos!==1?'s':''}, ${fmt(row.total)}). No se envió nada.`)
      onClose&&onClose()
    } catch(e) { appAlert('Error: '+e.message) }
    setSaving(false)
  }

  // EDITAR en sitio: actualiza la MISMA rendición (mismo id/correlativo/fecha), agrega/quita gastos, re-marca y ajusta el reembolso. No la anula ni crea otra.
  const handleGuardarEdicion = async() => {
    if(!esEdicion || !gastosSel.length || faltaProyR) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const prevIds = new Set((expenses||[]).filter(e=>String(e.client_render_id)===String(editRend.id)).map(e=>String(e.id)))
      const selIds = new Set(gastosSel.map(e=>String(e.id)))
      const toAdd = gastosSel.filter(e=>!prevIds.has(String(e.id)))
      const toRemove = (expenses||[]).filter(e=>prevIds.has(String(e.id)) && !selIds.has(String(e.id)))
      const otNums = [...new Set(gastosSel.map(e=>e.ot_number).filter(Boolean))].join(', ')
      const patch = {total:totalSel, n_gastos:gastosSel.length, entity_id:selEnt||null, project:proyecto||null, subproject:(subproyecto||'').trim()||null, dirigido_a:(atencion||'').trim()||null, ot_numbers:otNums||null}
      // El texto del correo guardado nombra el saldo y lo rendido de antes: se borra para que se vuelva a armar con las cifras nuevas (los destinatarios quedan).
      if(!editRend.sent_at&&(editRend.correo?.cuerpo||editRend.correo?.asunto)){ const {asunto:_a,cuerpo:_c,...resto}=editRend.correo; patch.correo={...resto, texto_borrado_at:now} }
      const {error:re} = await supabase.from('rendiciones').update(patch).eq('id',editRend.id)
      if(re) throw new Error('No se pudo actualizar la rendición: '+re.message)
      const _lig = editRend.fondo_id ? {reembolso_fondo_id:editRend.fondo_id} : {}
      logActividad(editRend.sent_at?'rendicion.editada':'rendicion.borrador_editado',{tabla:'rendiciones',id:editRend.id,detalle:{cliente:client.name,title:editRend.sent_at?`Rendición N° ${editRend.correlativo||'—'} editada`:'Borrador de rendición editado',monto:Math.round(totalSel),antes:{total:editRend.total,n_gastos:editRend.n_gastos},despues:{total:totalSel,n_gastos:gastosSel.length},agregados:toAdd.map(e=>({id:e.id,concepto:e.concept,monto:e.amount})),quitados:toRemove.map(e=>({id:e.id,concepto:e.concept,monto:e.amount}))},completo:true})
      for(const e of toAdd){ await supabase.from('expenses').update({client_rendered_at:now, client_render_id:editRend.id, ...proyPatch(e), ..._lig}).eq('id',e.id) }
      for(const e of toRemove){ await supabase.from('expenses').update({client_rendered_at:null, client_render_id:null}).eq('id',e.id) }
      // Ajustar el cobro de reembolso vinculado (si existe y no está anulado) al nuevo total
      let reembAjust=null
      const reemb=(billing||[]).find(b=>b.billing_type==='reembolso'&&b.status!=='Anulada'&&(b.notes||'').includes('Rendición ID '+editRend.id))
      if(reemb && reemb.amount!==totalSel){ const {error:be}=await supabase.from('billing').update({amount:totalSel}).eq('id',reemb.id); if(!be) reembAjust={id:reemb.id} }
      if(setExpenses) setExpenses(p=>p.map(e=>{
        if(toAdd.find(x=>x.id===e.id)) return {...e,client_rendered_at:now,client_render_id:editRend.id,...proyPatch(e),..._lig}
        if(toRemove.find(x=>x.id===e.id)) return {...e,client_rendered_at:null,client_render_id:null}
        return e
      }))
      if(setRendiciones) setRendiciones(p=>p.map(r=>r.id===editRend.id?{...r,...patch}:r))
      if(reembAjust&&setBilling) setBilling(p=>p.map(b=>b.id===reembAjust.id?{...b,amount:totalSel}:b))
      await guardarDirigido()
      onClose&&onClose()
    } catch(e){ appAlert('Error: '+e.message) }
    setSaving(false)
  }

  const lblG = {fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5,marginBottom:2}
  const fK = fondosDisp>0?{c:C.normal,bg:C.greenBg}:fondosDisp===0?{c:C.soon,bg:'#FEF6EE'}:{c:C.overdue,bg:C.overdueBg}
  const sK = saldoActual>0?{c:C.normal,bg:C.greenBg}:{c:C.overdue,bg:C.overdueBg}

  // ── Cada bloque se define UNA vez (misma lógica/estado); solo cambia el ARREGLO por isDesktop.
  // Desktop = maestro-detalle: izquierda la lista de gastos (el trabajo), derecha el "documento" que se arma
  // (continuidad + razón social + proyecto + KPIs + resumen + acciones). Móvil = apilado en el orden de hoy.
  const bContinuidad = (
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:12,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
        <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{esEdicion?<>Editando rendición{editRend.correlativo?` N° ${editRend.correlativo}`:''}<span style={{fontSize:10,fontWeight:500,color:C.textSoft}}> · no la anula</span></>:<>{modoEf!=='junto'&&porT.length>1?`Serán la ${porT.map((o,i)=>`N° ${nextCorr+i}`).join(' y ')}`:`Será la N° ${nextCorr}`}<span style={{fontSize:10,fontWeight:500,color:C.textSoft}}> · se confirma al enviar</span></>}</span>
        <span style={{fontSize:11,color:C.muted,textAlign:'right'}}>{previasN>0?`${previasN} enviada${previasN!==1?'s':''} · saldo actual ${fmtN(saldoActual)}`:'Primera rendición de este cliente'}</span>
      </div>
  )
  {/* Razón social: 1 → fija; varias → la elige el emisor (acota los gastos) */}
  const bRS = entsCli.length>0&&(()=>{
        const flBox = {background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',marginBottom:8}
        const flLbl = {fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const flInp = {width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.accent,fontWeight:600,padding:0,height:22,appearance:'none'}
        return (
        <div style={flBox}>
          <div style={flLbl}>Razón social</div>
          {entsCli.length===1
            ? <div style={{fontSize:13,fontWeight:600,color:C.text}}>{entsCli[0].name}{entsCli[0].rut?<span style={{fontSize:11,fontWeight:400,color:C.textSoft}}> · {entsCli[0].rut}</span>:''}</div>
            : <select value={selEnt||''} onChange={e=>setSelEnt(e.target.value||null)} style={flInp}>{entsCli.map(en=><option key={en.id} value={en.id}>{en.name}{en.rut?` · ${fmtRutCL(en.rut)}`:''}</option>)}</select>}
        </div>
        )
      })()
  {/* Proyecto + Dirigido a + Subproyecto */}
  const bProyecto = (()=>{
        const flBox = on => ({background:C.bgSoft,border:`0.5px solid ${on?C.accent:C.border}`,borderRadius:8,padding:'6px 11px'})
        const flLbl = {fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const flInp = {width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}
        const sug = contacts.filter(c=>c.email)
        return (<>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:6}}>
          {enFondo
            ? <div style={flBox(false)}><div style={flLbl}>Proyecto del fondo{faltaProyR?' *':''}</div><div style={{fontSize:13,color:proyFondo?C.text:C.soonText,minHeight:22,display:'flex',alignItems:'center'}}>{proyFondo||'Sin proyecto'}</div></div>
            : proyectosDisp.length>0
            ? <div onClick={()=>setProyOpen(v=>!v)} style={{...flBox(proyF.size>0),...(faltaProyR?{border:`0.5px solid ${C.overdue}`}:{}),position:'relative',cursor:'pointer'}}>
                <div style={flLbl}>Proyectos{faltaProyR?' *':''}</div>
                <div style={{fontSize:13,color:C.text,minHeight:22,display:'flex',alignItems:'center',gap:6}}><span style={{flex:1,minWidth:0}}>{proyF.size===0?'Todos':proyF.size===1?(proyF.has('__sin__')?'Sin proyecto':[...proyF][0]):`${proyF.size} proyectos`}</span><Gl n={proyOpen?'chevU':'chevD'}/></div>
                {proyOpen&&<>
                  <div onClick={ev=>{ev.stopPropagation();setProyOpen(false)}} style={{position:'fixed',inset:0,zIndex:29}}/>
                  <div onClick={ev=>ev.stopPropagation()} style={{position:'absolute',top:'calc(100% + 4px)',left:0,zIndex:30,width:isDesktop?340:'calc(200% + 8px)',maxWidth:'calc(100vw - 32px)',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 22px rgba(0,60,80,.14)',padding:5}}>
                    {[{k:'',t:'Todos los proyectos'},...proyectosDisp.map(p=>({k:p,t:p})),...(cntProy['']?[{k:'__sin__',t:'Sin proyecto'}]:[])].map(o=>{ const on=o.k?proyF.has(o.k):proyF.size===0, c=o.k==='__sin__'?cntProy['']:o.k?cntProy[o.k]:cntProy.__todos
                      return <div key={o.k||'todos'} onClick={()=>{ if(!o.k){ setProyF(new Set()); return } setProyF(p=>{ const n=new Set(p); n.has(o.k)?n.delete(o.k):n.add(o.k); return n }) }} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 8px',borderRadius:7,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
                        <span style={{width:15,height:15,borderRadius:4,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<SIcon n='check' s={10} c='#fff'/>}</span>
                        <span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:on?700:500,color:o.k==='__sin__'?C.soonText:C.accent}}>{o.t}</span>
                        <span style={{fontSize:11,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{c?`${c.n} · ${fmtN(c.m)}`:'0'}</span>
                      </div> })}
                  </div>
                </>}
              </div>
            : <div style={{...flBox(!!proyecto),...(faltaProyR?{border:`0.5px solid ${C.overdue}`}:{})}}><div style={flLbl}>Proyecto{faltaProyR?' *':''}</div><input value={proyecto} onChange={e=>setProyecto(e.target.value)} placeholder={faltaProyR?'Escribe el trabajo':'Opcional'} style={flInp}/></div>}
          <div style={flBox(false)}>
            <div style={flLbl}>Dirigido a</div>
            <input value={atencion} onChange={e=>{setAtencion(e.target.value);setAtencionEmail('');setPrefilled(false)}} placeholder='Persona (opcional)' style={flInp}/>
          </div>
        </div>
        {!enFondo&&proyF.size===0&&nSinProyR>0&&proyectoSugerido&&<div style={{marginBottom:6}}><button onClick={()=>setProyecto(proyectoSugerido)} style={{fontSize:10,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer'}}>Sugerido: {proyectoSugerido}</button></div>}
        {sug.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,alignItems:'center',marginBottom:8}}><span style={{fontSize:9,color:C.textSoft}}>Sugeridos:</span>{sug.map(c=><button key={c.id} onClick={()=>{setAtencion(c.nombre||c.email);setAtencionEmail(c.email||'');setPrefilled(false)}} style={{fontSize:10,border:`0.5px solid ${C.border}`,color:C.muted,background:'none',borderRadius:14,padding:'2px 9px',cursor:'pointer'}}>{c.nombre?c.nombre+' · ':''}{c.email}</button>)}</div>}
        {gastosPend.length===0 && <div style={{fontSize:10,color:C.soon,marginBottom:8}}>Esta razón social aún no tiene gastos por rendir{proyVentas.length>0?` (el proyecto viene de la venta)`:'. Cambia de razón social o ingresa gastos primero'}.</div>}
        {!showSub && !subproyecto && <div onClick={()=>setShowSub(true)} style={{fontSize:11,color:C.azulInfo,cursor:'pointer',marginBottom:12,width:'fit-content'}}>+ Subproyecto</div>}
        {(showSub||subproyecto)&&<div style={{...flBox(false),marginBottom:12}}>
          <div style={flLbl}>Subproyecto <span style={{textTransform:'none',fontWeight:400}}>(opcional)</span></div>
          <input value={subproyecto} onChange={e=>setSubproyecto(e.target.value)} placeholder='—' list='rend-subproy' style={flInp}/>
          <datalist id='rend-subproy'>{[...new Set((rendiciones||[]).filter(r=>String(r.client_id)===String(client.id)&&r.subproject).map(r=>r.subproject))].map(s=><option key={s} value={s}/>)}</datalist>
        </div>}
        </>)
      })()
  // Cifras de la rendición en UNA tarjeta, filas con el monto a la derecha (antes 3 tarjetas + un resumen aparte): lo seleccionado, fondos, ya rendido y el saldo que resulta.
  const lnR=(l,v,col,big)=><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,padding:'3px 0'}}><span style={{fontSize:12,color:big?col:C.muted,fontWeight:big?700:400}}>{l}</span><span style={{fontSize:big?15:12.5,fontWeight:700,color:col||C.text,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>
  const segBtn = (k,t,sub,on,dis) => <button key={k} type='button' disabled={dis} onClick={()=>elegirModo(k)} style={{flex:1,minWidth:0,border:'none',borderLeft:k!=='junto'?`1px solid ${C.border}`:'none',padding:'7px 4px',background:on?C.accent:C.surface,color:on?'#fff':(dis?C.done:C.muted),cursor:dis?'not-allowed':'pointer',fontFamily:'inherit',lineHeight:1.25}}><div style={{fontSize:11.5,fontWeight:600}}>{t}</div><div style={{fontSize:10,opacity:.85}}>{sub}</div></button>
  const bModo = multiT && (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 13px',marginBottom:12}}>
        <div style={{...SEC_LBL,marginBottom:6}}>Cómo se envía · {trabajosSel.length} proyectos</div>
        {[['junto','Una rendición','1 PDF con todo'],['sep1','Una por proyecto',`${trabajosSel.length} PDF en un correo`],['sepN','Una por proyecto','un correo cada una']].map(([k,t,sub])=>{ const on=modo===k||(k==='junto'&&!['sep1','sepN'].includes(modo))
          return <div key={k} onClick={()=>elegirModo(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 8px',borderRadius:8,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
            <span style={{width:15,height:15,borderRadius:'50%',border:on?`5px solid ${C.accent}`:`1.5px solid ${C.done}`,flexShrink:0,boxSizing:'border-box'}}/>
            <span style={{fontSize:12.5,fontWeight:on?700:500,color:on?C.accent:C.text,whiteSpace:'nowrap'}}>{t}</span><span style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap'}}>{sub}</span>
          </div> })}
        {modo!=='junto'&&!puedeSeparar&&(()=>{ const sinP=fondosRS.filter(x=>!(x.f.project||'').trim())
          const sugDe=x=>{ const c={}; x.gastos.forEach(g=>{ const k=keyP(g); if(k) c[k]=(c[k]||0)+1 }); return Object.keys(c).sort((a,b)=>c[b]-c[a])[0]||'' }
          return <div style={{borderTop:`1px solid ${C.track}`,marginTop:8,paddingTop:8}}>
            <div style={{...SEC_LBL,color:C.soonText,marginBottom:4}}>Antes de separar</div>
            <div style={{fontSize:11.5,color:C.textSoft,marginBottom:6}}>{sinP.length===1?'Este fondo no tiene proyecto: elige a cuál va.':`Estos ${sinP.length} fondos no tienen proyecto: elige a cuál va cada uno.`}</div>
            {sinP.map(x=>{ const sg=sugDe(x); return <div key={x.f.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'4px 0',flexWrap:'wrap'}}>
              <span style={{fontSize:12,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>Fondo {fmtFechaDMY(x.f.date)} · {fmtN(x.f.amount)}</span>
              <span style={{display:'inline-flex',gap:6,alignItems:'center'}}>
                {sg&&<button type='button' onClick={()=>asignarProyFondo(x.f,sg)} style={{fontSize:10.5,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>Sugerido: {sg}</button>}
                <select value='' onChange={ev=>{ if(ev.target.value) asignarProyFondo(x.f,ev.target.value) }} style={{...chipSty(true),fontSize:11}}><option value=''>Elegir proyecto</option>{proyectosDisp.map(p=><option key={p} value={p}>{p}</option>)}</select>
              </span>
            </div> })}
          </div> })()}
        <div style={{marginTop:8}}>{porT.map((o,i)=><div key={o.t} style={{borderTop:`1px solid ${C.track}`,padding:'7px 0 3px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}><span style={{fontSize:12.5,fontWeight:700,color:C.accent,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{modoEf!=='junto'?`N° ${nextCorr+i} · `:''}{o.t}</span><span style={{fontSize:12.5,fontWeight:700,color:o.saldo<0?C.overdueText:C.greenText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{o.saldo<0?'−':'+'}{fmtN(Math.abs(o.saldo))}</span></div>
          <div style={{fontSize:11.5,color:C.textSoft,display:'flex',justifyContent:'space-between',gap:8}}><span>fondos {fmtN(o.f.totFondos)}{o.f.rendido?` · ya rendido ${fmtN(o.f.rendido)}`:''} · {o.gs.length} gasto{o.gs.length!==1?'s':''} {fmtN(o.tg)}</span>{modoEf!=='junto'&&<button type='button' onClick={()=>verPdfVirtual(virtuales()[i])} style={{fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Ver PDF</button>}</div>
        </div>)}</div>
      </div>
  )
  const _uno = porTrabajoUno&&porT[0]
  // ── Qué se rinde (solo con 2+ fondos): gastos (por proyecto) o un fondo entregado (lo que cubrió).
  const pendFondo = x => x.gastos.filter(g=>g.type==='gasto'&&!g.client_rendered_at&&inScope(g))
  const elegirFondo = x => { setModoR('fondo'); setFondoSel(x.f.id); setAddSinFondo(false); setWipRec(false); setSelected(new Set(pendFondo(x).map(g=>g.id))) }
  const totPendG = (cntProy.__todos||{n:0,m:0})
  const totFondosRS = fondosRS.reduce((a,x)=>a+(Number(x.f.amount)||0),0)
  const cardModo = (k,ic,bg,col,t,sub,der,on,onClick) => <div key={k} onClick={onClick} style={{display:'flex',alignItems:'center',gap:isDesktop?10:8,background:C.surface,border:`1px solid ${on?C.accent:C.border}`,boxShadow:on?`inset 0 0 0 1px ${C.accent}`:'none',borderRadius:12,padding:isDesktop?'11px 13px':'9px 10px',cursor:'pointer',minWidth:0}}>
      <span style={{width:isDesktop?34:28,height:isDesktop?34:28,borderRadius:9,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={isDesktop?17:15} c={col}/></span>
      <span style={{minWidth:0,flex:1}}><span style={{display:'block',fontSize:isDesktop?13.5:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{t}</span><span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap'}}>{isDesktop?sub:der}</span></span>
      {isDesktop&&<span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{der}</span>}
    </div>
  const bElegir = verModoFondo && (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:isDesktop?10:8,marginBottom:14}}>
        {cardModo('g','receipt',C.azulBg,C.accent,'Rendir gastos','Marcar gastos por rendir, por proyecto',`${totPendG.n} · ${fmtN(totPendG.m)}`,!enFondo,()=>{ if(enFondo){ setModoR('gastos'); setFondoSel(null); setSelected(new Set()) } })}
        {cardModo('f','tFavor',C.greenBg,C.greenText,'Rendir un fondo','Elegir el fondo y rendir lo que cubrió',`${fondosRS.length} · ${fmtN(totFondosRS)}`,enFondo,()=>{ if(!enFondo){ const x=fondosRS.find(y=>pendFondo(y).length)||fondosRS[fondosRS.length-1]; if(x) elegirFondo(x) } })}
      </div>)
  const bFondos = enFondo && (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:6,marginBottom:12}}>
        <div style={{...SEC_LBL,padding:'4px 6px 6px'}}>Fondos entregados</div>
        {fondosRS.map((x,i)=>{ const on=String(x.f.id)===String(fondoSel), np=pendFondo(x).length
          return <div key={x.f.id} onClick={()=>!on&&!esEdicion&&elegirFondo(x)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 10px',borderTop:i&&!on?`1px solid ${C.track}`:'1px solid transparent',background:on?C.azulBg:'transparent',borderRadius:8,cursor:on?'default':'pointer'}}>
            <span style={{width:15,height:15,borderRadius:'50%',border:on?`5px solid ${C.accent}`:`1.5px solid ${C.done}`,flexShrink:0,boxSizing:'border-box'}}/>
            <span style={{flex:1,minWidth:0}}>
              {x.f.project
                ? <span style={{display:'block',fontSize:12.5,fontWeight:on?700:500,color:C.accent}}>{x.f.project}</span>
                : <select value='' onClick={_stop} onChange={ev=>{ _stop(ev); if(ev.target.value) asignarProyFondo(x.f,ev.target.value) }} style={{...chipSty(true),fontSize:11}}><option value=''>Asignar proyecto</option>{proyectosDisp.map(p=><option key={p} value={p}>{p}</option>)}</select>}
              <span style={{display:'block',fontSize:10.5,color:C.textSoft,marginTop:1}}>{fmtFechaDMY(x.f.date)} · {np?`${np} gasto${np!==1?'s':''} por rendir`:'sin gastos por rendir'}</span>
            </span>
            <span style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <span style={{display:'block',fontSize:13,fontWeight:700,color:C.text}}>{fmtN(x.f.amount)}</span>
              <span style={{fontSize:10.5,color:x.quedan<0?C.overdueText:C.textSoft}}>{x.quedan<0?`excedido ${fmtN(-x.quedan)}`:`queda ${fmtN(x.quedan)}`}</span>
            </span>
          </div> })}
      </div>)
  // Cuadratura del cliente con el reparto (fuente única): Σ fondos − gastos = saldo de la ficha. Si alguna vez no calza, se avisa.
  const _fgC = fgCliente(expenses, client.id), _cuadra = Math.round(_fgC.saldo)===Math.round(repF.saldo)
  const bCuadra = verModoFondo && (
      <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,color:C.textSoft,padding:'8px 12px',background:C.bgSoft,borderRadius:9,marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontVariantNumeric:'tabular-nums'}}>Fondos <b style={{color:C.text}}>{fmtN(_fgC.fondos)}</b> − gastos <b style={{color:C.text}}>{fmtN(_fgC.gastos)}</b> = <b style={{color:C.text}}>{fmtSaldoG(_fgC.saldo)}</b></span>
        <span style={{fontWeight:700,color:_cuadra?C.greenText:C.overdueText}}>{_cuadra?'igual a la ficha':`no cuadra con la ficha (${fmtSaldoG(repF.saldo)})`}</span>
      </div>)
  const bKPIs = (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 13px',marginBottom:12}}>
        <div style={{...lblG,marginBottom:4}}>{enFondo?`Este fondo · ${fmtFechaDMY(fondoObj?.date)}`:_uno?`Este trabajo · ${_uno.t}`:'Esta rendición'}</div>
        {lnR(`${gastosSel.length} gasto${gastosSel.length!==1?'s':''} seleccionado${gastosSel.length!==1?'s':''}`, fmtN(totalSel), gastosSel.length?C.text:C.muted)}
        {lnR(enFondo?'Fondo entregado':_uno?'Fondos de este trabajo':'Fondos', fmtN(_uno?_uno.f.totFondos:fondosDisp))}
        {lnR(enFondo?'Ya rendido de este fondo':'Ya rendido', fmtN(_uno?_uno.f.rendido:_fondoRend.rendido))}
        {(()=>{ const sal=_uno?_uno.saldo:saldoTrasRendicion; return <div style={{borderTop:`1px solid ${C.track}`,marginTop:4,paddingTop:5}}>{lnR(sal<0?'Saldo a cargo del cliente':'Saldo a favor del cliente', fmtN(Math.abs(sal)), sal<0?C.overdueText:C.greenText, true)}</div> })()}
        {_uno&&fondosDisp>_uno.f.totFondos&&<div style={{fontSize:11.5,color:C.textSoft,marginTop:4}}>Otros {fmtN(fondosDisp-_uno.f.totFondos)} en fondos del cliente están asignados a otro trabajo.</div>}
      </div>
  )
  const nDupR = disponibles.filter(e=>dupRend.has(e.id)).length
  // Chips del gasto: su proyecto y su fondo, ambos se corrigen tocándolos (no marcan ni desmarcan el gasto).
  const chipsG = e => { const k=keyP(e), opts=[...new Set([...(k?[k]:[]),...proyectosDisp])], dF=repF.deGasto[e.id]||''
    return (<>
      {(opts.length>0)&&<select value={k} onClick={_stop} onChange={ev=>{ _stop(ev); asignarProyGasto(e,ev.target.value) }} title='Proyecto del gasto' style={chipSty(!k)}>{!k&&<option value=''>Sin proyecto</option>}{opts.map(o=><option key={o} value={o}>{o}</option>)}</select>}
      {fondosRS.length>=2&&<select value={dF} onClick={_stop} onChange={ev=>{ _stop(ev); const v=ev.target.value; moverAFondo(e,v&&v!=='__auto'?v:null) }} title='Fondo que cubre el gasto' style={chipSty(!dF)}>{!dF?<option value=''>Sin fondo</option>:e.reembolso_fondo_id?<option value='__auto'>Reparto automático</option>:null}{fondosRS.map(x=><option key={x.f.id} value={x.f.id}>{`Fondo ${fmtFechaDMY(x.f.date)} · ${fmtN(x.f.amount)}`}</option>)}</select>}
    </>) }
  // Lista agrupada por proyecto cuando se ven varios (Todos o varios marcados); «Sin proyecto» al final.
  const gruposL = (()=>{ if(enFondo||proyecto) return null; const m=new Map(); disponibles.forEach(e=>{ const k=keyP(e); if(!m.has(k)) m.set(k,[]); m.get(k).push(e) })
    if(m.size<2) return null; const ordK=k=>k?(proyectosDisp.indexOf(k)<0?999:proyectosDisp.indexOf(k)):1e6
    return [...m.entries()].sort((a,b)=>ordK(a[0])-ordK(b[0])).map(([k,gs])=>({k,gs,tot:gs.reduce((a,e)=>a+(Number(e.amount)||0),0)})) })()
  const toggleGrupo = gr => setSelected(p=>{ const n=new Set(p), todos=gr.gs.every(e=>n.has(e.id)); gr.gs.forEach(e=>todos?n.delete(e.id):n.add(e.id)); return n })
  const asignarTodosSin = async(gs,pr) => { for(const e of gs){ await asignarProyGasto(e,pr) } }
  const filaG = e => {
    const isSel=selected.has(e.id)
    const catBg=CATS[e.category]||CATS['Otro']
    return (
      <div key={e.id} onClick={()=>toggleOne(e.id)}
        style={{background:isSel?C.azulBg:'#fff',borderRadius:8,padding:'8px 10px',marginBottom:5,
          border:`1px solid ${isSel?C.accent:C.border}`,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${isSel?C.accent:C.done}`,
          background:isSel?C.accent:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
          {isSel&&<span style={{color:'#fff',fontSize:10}}><Gl n='tick'/></span>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          {editDet?.id===e.id
            ? <input autoFocus value={editDet.v} onFocus={ev=>ev.target.select()} onClick={ev=>ev.stopPropagation()} onChange={ev=>setEditDet({id:e.id,v:ev.target.value})} onBlur={guardarDetalle}
                onKeyDown={ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.currentTarget.blur() } else if(ev.key==='Escape'){ ev.preventDefault(); setEditDet(null) } }}
                style={{width:'100%',boxSizing:'border-box',fontSize:12,fontWeight:500,color:C.text,border:`1px solid ${C.accent}`,borderRadius:6,padding:'4px 6px',outline:'none',background:'#fff',fontFamily:'inherit'}}/>
            : <div onClick={ev=>{ ev.stopPropagation(); setEditDet({id:e.id,v:e.concept||''}) }} title='Editar el detalle' style={{fontSize:12,fontWeight:500,color:C.text,cursor:'text',textDecoration:'underline dotted',textDecorationColor:C.border,textUnderlineOffset:3}}>{e.concept||'—'}</div>}
          <div style={{fontSize:10,color:C.muted,marginTop:1,display:'flex',flexWrap:'wrap',gap:'3px 5px',alignItems:'center'}}>
            {e.date&&<span>{fmtFechaDMY(e.date)}</span>}
            {e.category&&<span style={{padding:'2px 8px',borderRadius:20,background:catBg,color:C.muted,fontWeight:700,fontSize:9.5,whiteSpace:'nowrap'}}>{e.category}</span>}
            {chipsG(e)}
            {dupRend.has(e.id)&&(()=>{ const r=dupRend.get(e.id); return <span title={`Mismo monto y fecha que «${r.concept||'—'}»${r.client_rendered_at?' (ya rendido)':''}`} style={{padding:'2px 8px',borderRadius:20,background:C.overdueBg,color:C.overdueText,fontWeight:700,fontSize:9.5,whiteSpace:'nowrap'}}>{r.client_rendered_at?'Posible duplicado · ya rendido':'Posible duplicado'}</span> })()}
          </div>
        </div>
        <div style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtN(e.amount)}</div>
      </div>
    )
  }
  const bLista = (<>
      {!isDesktop&&nDupR>0&&<div style={{fontSize:11.5,fontWeight:700,color:C.overdueText,marginBottom:6}}>{nDupR} posible{nDupR!==1?'s':''} duplicado{nDupR!==1?'s':''}</div>}
      {wipRec&&gastosSel.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,background:C.azulBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>
        <span style={{flex:1,minWidth:0,fontSize:11.5,color:C.accent,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Selección recuperada · {gastosSel.length} gasto{gastosSel.length!==1?'s':''}</span>
        <button onClick={()=>{ setSelected(new Set()); setWipRec(false) }} style={{fontSize:11.5,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0}}>Descartar</button>
      </div>}
      {enFondo&&(()=>{ const nSin=repF.sinFondo.filter(g=>g.type==='gasto'&&!g.client_rendered_at&&inScope(g)).length
        return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:6}}>
          <span style={{fontSize:11,color:C.muted}}>Gastos del fondo del {fmtFechaDMY(fondoObj?.date)}</span>
          {nSin>0&&<button onClick={()=>setAddSinFondo(v=>!v)} style={{fontSize:10.5,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:700,whiteSpace:'nowrap'}}>{addSinFondo?'Ocultar los sin fondo':`Agregar gastos sin fondo (${nSin})`}</button>}
        </div> })()}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:11,color:C.muted}}>{disponibles.length} gastos disponibles{isDesktop&&nDupR>0&&<b style={{color:C.overdueText,fontWeight:700}}> · {nDupR} posible{nDupR!==1?'s':''} duplicado{nDupR!==1?'s':''}</b>}</span>
          {!enFondo&&<button onClick={()=>setShowFiltroFecha(v=>!v)} style={{fontSize:10,color:(fDesde||fHasta)?C.accent:C.azulInfo,background:'none',border:'none',cursor:'pointer'}}>Filtrar por fecha{(fDesde||fHasta)?' ·':''} {showFiltroFecha?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
        </div>
        {disponibles.length>0&&<button onClick={toggleAll} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
          {disponibles.length&&gastosSel.length===disponibles.length?'Desmarcar todo':'Seleccionar todo'}
        </button>}
      </div>
      {showFiltroFecha&&!enFondo&&<div style={{display:'flex',gap:6,marginBottom:8,alignItems:'center'}}>
        <input type='date' value={fDesde} onChange={e=>setFDesde(e.target.value)} style={{flex:1,padding:'5px 8px',borderRadius:6,border:`0.5px solid ${C.border}`,fontSize:11,outline:'none'}}/>
        <span style={{fontSize:11,color:C.muted}}>→</span>
        <input type='date' value={fHasta} onChange={e=>setFHasta(e.target.value)} style={{flex:1,padding:'5px 8px',borderRadius:6,border:`0.5px solid ${C.border}`,fontSize:11,outline:'none'}}/>
        {(fDesde||fHasta)&&<button onClick={()=>{setFDesde('');setFHasta('')}} style={{fontSize:10,color:C.muted,background:'none',border:'none',cursor:'pointer'}}><Gl n='x'/></button>}
      </div>}
      {disponibles.length===0&&(gastosPend.length>0&&(proyF.size>0||fDesde||fHasta)
        ? <div style={{textAlign:'center',padding:20,fontSize:12,color:C.muted}}>
            Hay {gastosPend.length} gasto{gastosPend.length!==1?'s':''} pendiente{gastosPend.length!==1?'s':''} de rendir, pero el filtro los está ocultando.
            <button onClick={()=>{setProyecto('');setFDesde('');setFHasta('')}} style={{display:'block',margin:'8px auto 0',fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:20,padding:'5px 12px',cursor:'pointer'}}>Ver todos los proyectos</button>
          </div>
        : <div style={{color:C.muted,textAlign:'center',padding:20,fontSize:12}}>No hay gastos pendientes de rendir</div>)}
      <div style={{maxHeight:isDesktop?'calc(100vh - 320px)':(gruposL?460:280),overflowY:'auto',marginBottom:12}}>
        {gruposL ? gruposL.map(gr=>(<Fragment key={gr.k||'__sin__'}>
            <div onClick={()=>toggleGrupo(gr)} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,margin:'10px 2px 5px',cursor:'pointer'}}>
              <span style={{fontSize:10.5,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:gr.k?C.accent:C.soonText,minWidth:0}}>{gr.k||'Sin proyecto'}</span>
              <span style={{fontSize:11.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{gr.gs.length} · {fmtN(gr.tot)}</span>
            </div>
            {!gr.k&&proyectoSugerido&&<button onClick={()=>asignarTodosSin(gr.gs,proyectoSugerido)} style={{fontSize:10.5,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',margin:'0 0 6px 2px'}}>Asignar {gr.gs.length===1?'a':'los '+gr.gs.length+' a'} {proyectoSugerido}</button>}
            {gr.gs.map(filaG)}
          </Fragment>)) : disponibles.map(filaG)}
      </div>
  </>)
  const bResumen = null
  const bIA = selected.size>0&&<button onClick={mejorarDescripcionesIA} disabled={limpiandoIA} style={{...chipBtn('soft'),width:'100%',marginBottom:8,opacity:limpiandoIA?.6:1}}>{limpiandoIA?'Mejorando descripciones…':'Mejorar descripciones con IA'}</button>
  const bExterna = !esEdicion&&(extOpen
        ? <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8,padding:'8px 10px',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10}}>
            <span style={{fontSize:12,color:C.muted}}>Rendida por fuera el</span>
            <input type='date' value={extFecha} onChange={e=>setExtFecha(e.target.value)} style={{fontSize:12,padding:'5px 7px',border:`1px solid ${C.border}`,borderRadius:7,color:C.text}}/>
            <input value={extLink} onChange={e=>setExtLink(e.target.value)} placeholder='Enlace al correo (opcional)' style={{flex:'1 1 160px',minWidth:0,fontSize:12,padding:'5px 8px',border:`1px solid ${C.border}`,borderRadius:7,color:C.text}}/>
            <button disabled={!puedeRendir||saving||!extFecha} onClick={handleExterna} style={{fontSize:12,fontWeight:700,padding:'6px 12px',borderRadius:8,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',cursor:puedeRendir?'pointer':'not-allowed'}}>{saving?'…':'Registrar'}</button>
            <button onClick={()=>setExtOpen(false)} style={{fontSize:12,background:'none',border:'none',color:C.textSoft,cursor:'pointer'}}>Cancelar</button>
          </div>
        : <button onClick={()=>setExtOpen(true)} disabled={!puedeRendir} style={{marginTop:8,background:'none',border:'none',padding:0,color:puedeRendir?C.accent:C.done,fontSize:12,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed'}}>Ya la rendí por fuera de la app</button>)
  const bBotones = navBorr&&!esEdicion ? (<>
      {faltaProyR&&<div style={{fontSize:11.5,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>{nSinProyR===1?'1 gasto seleccionado no tiene proyecto':`${nSinProyR} gastos seleccionados no tienen proyecto`}: elige a cuál van para poder rendir.</div>}
      <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('borrador')}
        style={{width:'100%',padding:'11px 14px',borderRadius:10,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',fontSize:13.5,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
        {saving?'Guardando…':(navBorr.i<navBorr.n-1?'Guardar borrador y continuar':'Guardar borrador')}
      </button>
      <div style={{display:'flex',gap:8,marginTop:8}}>
        {modoEf==='junto'&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('pdf')} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Ver PDF</button>}
        <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('correo')} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Continuar al correo →</button>
      </div>
      {bExterna}
  </>) : (<>
      {faltaProyR&&<div style={{fontSize:11.5,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>{nSinProyR===1?'1 gasto seleccionado no tiene proyecto':`${nSinProyR} gastos seleccionados no tienen proyecto`}: elige a cuál van para poder rendir.</div>}
      <div style={{display:'flex',gap:8}}>
        {!asPage&&<button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
        {esEdicion ? (
          <button disabled={!puedeRendir||saving} onClick={handleGuardarEdicion}
            style={{flex:3,padding:'9px 14px',borderRadius:10,border:'none',background:puedeRendir?C.accent:C.done,color:'#fff',fontSize:13,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
            {saving?'Guardando…':'Guardar cambios'}
          </button>
        ) : (<>
        {modoEf==='junto'&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('pdf')}
          style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:'#fff',color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:600,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
          Ver PDF
        </button>}
        <button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('borrador')}
          style={{flex:1.2,padding:'9px 10px',borderRadius:10,border:'none',background:C.azulBg,color:puedeRendir?C.accent:C.done,fontSize:13,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed',whiteSpace:'nowrap'}}>
          {saving?'Guardando…':'Guardar borrador'}
        </button>
        </>)}
      </div>
      {!esEdicion&&<button disabled={!puedeRendir||saving} onClick={()=>handleGenerar('correo')}
        style={{width:'100%',marginTop:10,padding:'11px 14px',borderRadius:10,border:'none',background:puedeRendir?C.normal:C.done,color:'#fff',fontSize:13.5,fontWeight:700,cursor:puedeRendir?'pointer':'not-allowed'}}>
        Continuar al correo →
      </button>}
      {bExterna}
  </>)

  // Recorrer los borradores preparados sin volver a la lista (escritorio: arriba a la derecha · celular: al pie).
  const _navBtn = (dir,dis) => <button onClick={ev=>{ ev.stopPropagation(); if(!saving) (dir<0?navBorr.onPrev:navBorr.onNext)() }} disabled={dis||saving} aria-label={dir<0?'Anterior':'Siguiente'} style={{width:26,height:26,borderRadius:13,border:`1px solid ${C.border}`,background:C.surface,color:dis?C.done:C.accent,display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:dis?'default':'pointer',padding:0,flexShrink:0}}><Gl n={dir<0?'chevL':'chevron'}/></button>
  const bNav = navBorr&&!esEdicion&&(isDesktop
    ? <span style={{display:'inline-flex',alignItems:'center',gap:8,fontSize:12,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 4px 3px 12px',whiteSpace:'nowrap'}}>Borrador <b style={{color:C.accent}}>{navBorr.i+1} de {navBorr.n}</b>{_navBtn(-1,navBorr.i<=0)}{_navBtn(1,navBorr.i>=navBorr.n-1)}</span>
    : <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:12,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'6px 8px'}}>
        <span onClick={()=>!saving&&navBorr.i>0&&navBorr.onPrev()} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:navBorr.i>0?C.accent:C.done,cursor:'pointer'}}>{_navBtn(-1,navBorr.i<=0)}Anterior</span>
        <span style={{fontSize:12,color:C.muted,whiteSpace:'nowrap'}}>Borrador <b style={{color:C.accent}}>{navBorr.i+1} de {navBorr.n}</b></span>
        <span onClick={()=>!saving&&navBorr.i<navBorr.n-1&&navBorr.onNext()} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:navBorr.i<navBorr.n-1?C.accent:C.done,cursor:'pointer'}}>Siguiente{_navBtn(1,navBorr.i>=navBorr.n-1)}</span>
      </div>)
  // Desktop: maestro-detalle (lista | documento). Móvil: apilado en el orden de hoy. Misma JSX, dos arreglos.
  return isDesktop ? (
    <div>
      {!esEdicion&&(bNav?<div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}><PasosRend paso={1}/>{bNav}</div>:<PasosRend paso={1}/>)}
      {bElegir}
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.55fr) minmax(0,1fr)',gap:22,alignItems:'start'}}>
        <div style={{minWidth:0}}>{bFondos}{bLista}</div>
        <div style={{minWidth:0}}>{bContinuidad}{bRS}{bProyecto}{bModo}{bKPIs}{bCuadra}{bResumen}{bIA}{bBotones}</div>
      </div>
    </div>
  ) : (
    <div>
      {!esEdicion&&<PasosRend paso={1}/>}
      {bElegir}{bContinuidad}{bFondos}{bRS}{bProyecto}{bKPIs}{bLista}{bModo}{bCuadra}{bResumen}{bIA}{bBotones}{bNav}
    </div>
  )
}

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

// Popup de correo para enviar una rendición al cliente (mailto + marca sent_at)
// Correo de DEVOLUCIÓN de fondos: mismo motor/formato que la rendición (logo, firma, destinatarios desde
// contactos + CC aprendido), pero adjuntando el COMPROBANTE de transferencia en vez del PDF de rendición.
export function DevolucionEmailModal({client, rend, rendN, amount, fecha, user, onClose, setRendiciones, asPage=false}){
  const isDesktop=useIsDesktop()
  const myEmail=(user?.email||'').toLowerCase()
  const EMAIL_BY_NAME=equipoPorNombre()
  const toEmail=x=>{ if(!x) return null; const s=String(x).trim(); return s.includes('@')?s.toLowerCase():(EMAIL_BY_NAME[s]||null) }
  const corr=rend?.correlativo||rendN||''
  const [para,setPara]=useState(rend?.dirigido_email||client?.email||'')
  const [cc,setCc]=useState([])
  const [ccInput,setCcInput]=useState('')
  const [studioOn,setStudioOn]=useState(true)
  const studioEmails=useMemo(()=>{ const set=new Set(); const resp=toEmail(client?.abogado_responsable); if(resp) set.add(resp); set.delete(myEmail); return [...set] },[client?.abogado_responsable,myEmail])
  const [fichaContacts,setFichaContacts]=useState([])
  const [firma,setFirma]=useState(firmaDefault(myEmail)||{nombre:user?.name||'',cargo:'Abogado',telefono:''})
  const [comp,setComp]=useState(null)   // comprobante: {name,mime,b64}
  const [sending,setSending]=useState(false)
  const asunto=`Devolución de fondos${corr?` · Rendición N° ${corr}`:''} — ${client?.name||''}`
  const [body,setBody]=useState(`Estimado ${(client?.name||'').split(' ')[0]},\n\nEspero que estés muy bien. Como complemento a la Rendición N° ${corr} que te enviamos, te confirmamos la devolución del saldo a favor por ${fmt(amount)}, correspondiente a los fondos no utilizados de dicha rendición.\n\nLa transferencia se realizó con fecha ${fmtFechaDMY(fecha)}. Adjuntamos el comprobante para tu registro.\n\nQuedamos atentos a cualquier consulta.\n\nSaludos cordiales,`)
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email').eq('client_id',client.id).then(({data})=>{ if(alive) setFichaContacts((data||[]).filter(c=>c.email)) },()=>{})
    // "Para" = el destinatario real de la rendición (dirigido_email; si no, el último "Para" aprendido del cliente).
    if(!rend?.dirigido_email) supabase.from('learnings').select('value').eq('kind','rendicion_para').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value) setPara(p=>(!p||p===(client?.email||''))?String(data.value).trim():p) },()=>{})
    supabase.from('learnings').select('value').eq('kind','rendicion_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(prev=>[...new Set([...prev,...ems])]) } },()=>{})
    return ()=>{alive=false}
  },[client?.id])
  useEffect(()=>{ if(!myEmail) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ setFirma(prev=>({...prev,...JSON.parse(data.value)})) }catch(_){} } },()=>{})
    return ()=>{alive=false}
  },[myEmail])
  const addCc=em=>{ const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(p=>[...p,e]); setCcInput('') }
  const removeCc=em=>setCc(p=>p.filter(x=>x!==em))
  const onFile=ev=>{ const f=ev.target.files&&ev.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>setComp({name:f.name,mime:f.type||'application/octet-stream',b64:String(rd.result).replace(/^data:[^,]+,/,'')}); rd.readAsDataURL(f) }
  const buildHtml=(text,useCid=true)=>{
    const A='#003C50',A4='#E4E8EB',MUTED='#537281',BG='#F7F9FA'
    const logoW=useCid?'cid:lealogow':`${location.origin}${BRAND.logo.blanco}`
    const logoC=useCid?'cid:lealogoc':`${location.origin}${BRAND.logo.color}`
    const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    let out='',box=[]
    const flush=()=>{ if(box.length){ out+=`<div style="background-color:${BG};border:1px solid ${A4};border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;line-height:1.8">${box.map(l=>{ const i=l.indexOf(':'); return i>0?`<div><span style="color:${MUTED}">${esc(l.slice(0,i))}:</span> <strong style="color:${A}">${esc(l.slice(i+1).trim())}</strong></div>`:`<div>${esc(l)}</div>` }).join('')}</div>`; box=[] } }
    String(text).split('\n').forEach(l=>{ if(/^\s{2,}\S/.test(l)) box.push(l.trim()); else { flush(); out+= l.trim()?`<p style="margin:0 0 10px">${esc(l)}</p>`:'' } }); flush()
    return `<div style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td bgcolor="${A}" style="background-color:${A};padding:18px 24px"><table width="100%"><tbody><tr><td style="vertical-align:middle"><img src="${logoW}" alt="${BRAND.nombre}" style="height:26px;display:block"/></td><td style="text-align:right;vertical-align:middle;color:#fff;font-size:12px;font-weight:600">Devolución de fondos${corr?` · Rendición N° ${corr}`:''}</td></tr></tbody></table></td></tr></tbody></table><div style="padding:24px;border:1px solid ${A4};border-top:none">${out}${firmaCorreoHtml(firma,logoC,'es')}</div></div>`
  }
  const enviar=async()=>{
    if(!para.trim()){ appAlert('Falta el destinatario (Para).'); return }
    if(!comp && !await appConfirm('No adjuntaste el comprobante de transferencia. ¿Enviar igual?')) return
    setSending(true)
    const _strip=u=>String(u||'').replace(/^data:[^,]+,/,'')
    const logosInline=[{cid:'lealogow',b64:_strip(logoBlanco),mime:'image/png'},{cid:'lealogoc',b64:_strip(logoColor),mime:'image/png'}]
    const ccStr=[...cc,...(studioOn?studioEmails:[])].filter(e=>e&&e.toLowerCase()!==(para||'').trim().toLowerCase()).join(', ')
    const atts=comp?[{base64:comp.b64,name:comp.name,mime:comp.mime}]:[]
    let sent=false,err=null,via=null
    try{ const token=await driveToken(); if(token){ await sendGmailWithPdf(token,{to:para.trim(),cc:ccStr,subject:asunto,bodyText:body,bodyHtml:buildHtml(body,true),inlineImages:logosInline,attachments:atts}); sent=true; via='usuario' } }catch(e){ err=e }
    if(!sent){
      if(!await appConfirm(MAIL_OFICINA_CONFIRM)){ setSending(false); avisoNoEnviado('La devolución de fondos'); return }
      try{ await sendMailServer({to:para.trim(),cc:ccStr,subject:asunto,html:buildHtml(body,false),text:body,attachments:atts}); sent=true; via='oficina' }catch(e2){ err=e2 }
    }
    setSending(false)
    if(sent){ try{ if(cc.length) await setLearningKV('rendicion_cc',String(client.id),cc.join(', ')) }catch(_){} try{ if((para||'').trim()) await setLearningKV('rendicion_para',String(client.id),para.trim()) }catch(_){}
      // Registrar el envío de la devolución en la rendición → chip "Devolución enviada" en el historial.
      try{ if(rend?.id){ const now=new Date().toISOString(); if(!okDB(await supabase.from('rendiciones').update({devolucion_at:now}).eq('id',rend.id),'registrar el envío de la devolución')) throw new Error('devolucion'); setRendiciones&&setRendiciones(p=>p.map(x=>x.id===rend.id?{...x,devolucion_at:now}:x)) } }catch(_){}
      appAlert(txtEnviado(via,{que:'Aviso de devolución de fondos', para:[para.trim(),...cc].filter(Boolean).join(', ')})+(comp?'\nCon el comprobante adjunto.':''))
      onClose&&onClose() }
    else avisoNoEnviado('La devolución de fondos', err?.message||String(err||''))
  }
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const flabel={fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase',marginBottom:6,display:'block'}
  const sugCc=fichaContacts.filter(c=>c.email&&c.email.toLowerCase()!==(para||'').toLowerCase()&&!cc.includes(c.email.toLowerCase()))
  const _body = (<>
        {!rend&&<div style={{fontSize:11,color:C.soonText,background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:8,padding:'8px 10px',marginBottom:12}}>No encontré la rendición de este cliente para sacar el destinatario — agrégalo a mano abajo.</div>}
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:20,alignItems:'start'}:undefined}>
        <div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Para</label>
          <input value={para} onChange={e=>setPara(e.target.value)} placeholder='correo@cliente.cl' style={inp}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>CC</label>
          {(()=>{ const ccVis=cc.filter(e=>e&&e.toLowerCase()!==(para||'').trim().toLowerCase()); return ccVis.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:6}}>
            {ccVis.map(e=><span key={e} style={{display:'inline-flex',alignItems:'center',gap:5,background:C.azulBg,color:C.accent,borderRadius:16,padding:'3px 7px 3px 10px',fontSize:12}}>{e}<button onClick={()=>removeCc(e)} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}><Gl n='x'/></button></span>)}
          </div> })()}
          <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addCc(ccInput) } }} onBlur={()=>ccInput.trim()&&addCc(ccInput)} placeholder='Agregar correo y Enter' style={inp}/>
          {sugCc.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>{sugCc.slice(0,6).map(c=><button key={c.email} onClick={()=>addCc(c.email)} style={{fontSize:11,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,borderRadius:16,padding:'3px 10px',cursor:'pointer'}}>+ {c.nombre||c.email}</button>)}</div>}
          {studioEmails.length>0&&<label style={{display:'flex',gap:7,alignItems:'center',marginTop:8,fontSize:11,color:C.muted,cursor:'pointer'}}><input type='checkbox' checked={studioOn} onChange={e=>setStudioOn(e.target.checked)}/>Copia a la oficina ({studioEmails.join(', ')})</label>}
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Comprobante de transferencia</label>
          {comp?(
            <div style={{display:'flex',alignItems:'center',gap:8,background:C.greenBg,borderRadius:8,padding:'9px 11px'}}>
              <span style={{fontSize:12,color:C.greenText,fontWeight:600,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><Gl n='tick'/> {comp.name}</span>
              <button onClick={()=>setComp(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:12}}>Quitar</button>
            </div>
          ):(
            <label style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,border:`1px dashed ${C.muted}`,borderRadius:8,padding:'12px',cursor:'pointer',color:C.accent,fontSize:12,fontWeight:600}}>
              <input type='file' accept='image/*,application/pdf' onChange={onFile} style={{display:'none'}}/>
              + Adjuntar comprobante (PDF o imagen)
            </label>
          )}
        </div>
        <div style={{marginBottom:12}}>
          <label style={flabel}>Mensaje</label>
          <textarea value={body} onChange={e=>setBody(e.target.value)} style={{width:'100%',minHeight:150,border:`0.5px solid ${C.border}`,borderRadius:10,fontSize:13,padding:'10px 11px',color:C.text,outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box',lineHeight:1.5}}/>
        </div>
        {!isDesktop&&<details style={{marginBottom:14}}><summary style={{fontSize:11,color:C.muted,cursor:'pointer'}}>Vista previa del correo</summary><div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,maxHeight:300,overflowY:'auto',marginTop:8,background:'#fff'}} dangerouslySetInnerHTML={{__html:buildHtml(body,false)}}/></details>}
        </div>
        {isDesktop&&<div><label style={flabel}>Vista previa del correo</label><div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,maxHeight:'62vh',overflowY:'auto',background:'#fff'}} dangerouslySetInnerHTML={{__html:buildHtml(body,false)}}/></div>}
        </div>
        <div style={{display:'flex',gap:8,marginTop:14}}>
          {!asPage&&<button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
          <button disabled={sending||!para.trim()} onClick={enviar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:para.trim()?'pointer':'not-allowed',opacity:(sending||!para.trim())?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{sending?<Spin/>:null}{sending?'Enviando...':'Enviar devolución'}</button>
        </div>
      </>)
  const _page = _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={isDesktop?960:720} title={<><span style={{color:C.accent}}>Enviar devolución</span>{client&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose} closeOnBackdrop={false}>{_body}</Modal>)
}

export function RendicionEmailModal({r, client, user, expenses, clientEntities=[], sales=[], setExpenses=null, onSent, onClose, onPatch, onNext, asPage=false}) {
  const isDesktop = useIsDesktop()
  // Varias rendiciones en un mismo correo (separadas por trabajo): r es la primera y r._hermanas las demás.
  const _todas = [r, ...((r&&r._hermanas)||[])]
  const _multi = _todas.length>1
  const _borr = (r?.correo&&(r.correo.asunto||r.correo.cuerpo||r.correo.para))?r.correo:null   // borrador guardado: se retoma (el que solo agrupa no trae nada)
  // El texto (asunto/cuerpo) solo vale si es del mismo tipo de correo: si la hermana se eliminó, el texto que nombra dos rendiciones no sirve.
  const _txt = _borr && ((_borr.modo==='sep1')===_multi) ? _borr : null
  const det = gastosDeRend(r, expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
  const [attachSet,setAttachSet] = useState(new Set())   // gastos de esta rendición con comprobante de respaldo
  useEffect(()=>{ const ids=det.map(e=>e.id); if(!ids.length) return; let alive=true; supabase.from('expense_attachments').select('expense_id').in('expense_id',ids).then(({data})=>{ if(alive) setAttachSet(new Set((data||[]).map(x=>String(x.expense_id)))) },()=>{}); return ()=>{alive=false} },[r.id])
  // Saldo del fondo con la MISMA fuente única que el PDF y el modal: fondos − gastos ya rendidos (de la RS).
  // Negativo = el cliente debe al Estudio → se incluyen los datos bancarios.
  // 1 RS: todo el cliente (incl. fondos sin entity_id) pertenece a esa RS; solo se acota con 2+ RS.
  const entId = ((clientEntities||[]).filter(e=>e.client_id===r.client_id).length>1) ? (det.find(e=>e.entity_id)||{}).entity_id : null
  const _trab = r.por_trabajo ? (r.project||'') : null
  const _rs0 = fondoDeRend(r, expenses, clientEntities)
  // Vista previa sin guardar: los gastos aún no están marcados como rendidos → se descuentan aquí (misma cifra que tendrá al guardarse).
  const _rs = r._virtual ? {..._rs0, rendido:_rs0.rendido+det.reduce((a,e)=>a+(e.amount||0),0), saldo:_rs0.saldo-det.reduce((a,e)=>a+(e.amount||0),0)} : _rs0
  const saldoCliente = _rs.saldo
  const totFondosCli = _rs.totFondos
  const debeCliente = saldoCliente < 0
  // 2+ proyectos: el correo los nombra y explica la imputación de saldos (misma fuente que el PDF).
  const _grp = (_trab!=null||r.fondo_id) ? null : rendGruposProyecto({expenses, clientId:r.client_id, scopeEntId:entId, gastos:det, excludeRenderId:r.id, clientEntities})
  // Saldo de cada rendición del correo (por trabajo cuando corresponde; en la vista previa se descuentan sus gastos).
  const saldoDeR = x => { const g=gastosDeRend(x, expenses); const f=rendicionFondo(expenses, x.client_id, entId, null, x.por_trabajo?(x.project||''):null, x.fondo_id||null); const sg=g.reduce((a,e)=>a+(e.amount||0),0); return x._virtual ? f.saldo-sg : f.saldo }
  const _saldosM = _multi ? _todas.map(x=>({x, saldo:saldoDeR(x), trabajo:x.project||'sin trabajo', corr:x.correlativo})) : null
  // Trabajos con saldos de distinto signo en el mismo correo: por defecto se pide el NETO (el saldo a favor de uno abona al que debe y al
  // enviar queda registrada la imputación); «Devolver el saldo a favor» cobra lo adeudado y devuelve aparte. Se recuerda por cliente.
  const _debM = (_saldosM||[]).reduce((a,o)=>a+(o.saldo<0?-o.saldo:0),0), _favM = (_saldosM||[]).reduce((a,o)=>a+(o.saldo>0?o.saldo:0),0)
  const _netoAplica = _multi && _debM>=1 && _favM>=1
  const [devolverFav,setDevolverFav] = useState(!!_borr?.devolver_favor)
  const _persona = esPersona(client?.name)
  // Trato del correo: tú / usted (una persona) · ustedes (empresa o varios). Se aprende por cliente (learnings trato_cliente).
  const [trato,setTrato] = useState(_borr?.trato||(_persona?'tu':'ustedes'))
  const T = { tu:{esp:'estés',adj:'Te adjuntamos tu',enc:'encontrarás',su:'tu',le:'te',pref:'prefieres',selo:'te lo'}, usted:{esp:'esté',adj:'Le adjuntamos su',enc:'encontrará',su:'su',le:'le',pref:'prefiere',selo:'se lo'}, ustedes:{esp:'estén',adj:'Les adjuntamos su',enc:'encontrarán',su:'su',le:'les',pref:'prefieren',selo:'se lo'} }[trato]
  // Fondos adicionales en el mismo correo (ej. falta plata para lo que viene): suma al saldo a cargo o se descuenta del saldo a favor.
  const [adicRaw,setAdic] = useState({monto:'',motivo:''})
  const adic = {...adicRaw, on:(parseInt(adicRaw.monto)||0)>0}   // sin interruptor: si hay monto, se pide
  // Sugerencia con datos reales (no inventada): el último fondo que mandó este cliente.
  const ultFondo = (expenses||[]).filter(e=>e.type==='fondo'&&e.client_id===r.client_id&&!e.deleted_at&&(e.amount||0)>0).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null
  const [para,setPara] = useState(_borr?.para || r?._carry?.para || r?.dirigido_email || client?.email || '')
  // Cc: gente del cliente (con chips, aprendida y editable) + copia al estudio (responsable + quienes cargaron los gastos).
  const EMAIL_BY_NAME = equipoPorNombre()
  const toEmail = x => { if(!x) return null; const s=String(x).trim(); return s.includes('@')?s.toLowerCase():(EMAIL_BY_NAME[s]||null) }
  const myEmail = (user?.email||'').toLowerCase()
  const studioEmails = useMemo(()=>{ const set=new Set(); const resp=toEmail(client?.abogado_responsable); if(resp) set.add(resp); det.forEach(e=>{ const em=toEmail(e.created_by); if(em) set.add(em) }); if(BRAND.casillaAgente) set.add(BRAND.casillaAgente); set.delete(myEmail); return [...set] },[client?.abogado_responsable, det, myEmail])
  const [studioOn,setStudioOn] = useState(_borr?.studioOn!==false && r?._carry?.studioOn!==false)
  const [cc,setCc] = useState(Array.isArray(_borr?.cc)?_borr.cc:(r?._carry?.cc||[]))
  const [ccInput,setCcInput] = useState('')
  const [fichaContacts,setFichaContacts] = useState([])
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email').eq('client_id',client.id).then(({data})=>{ if(alive) setFichaContacts((data||[]).filter(c=>c.email)) },()=>{})
    supabase.from('learnings').select('value').eq('kind','rendicion_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(prev=>[...new Set([...prev,...ems])]) } },()=>{})
    return ()=>{alive=false}
  },[client?.id])
  useEffect(()=>{ let alive=true
    supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ const ff=JSON.parse(data.value); setFirma(prev=>({...prev,...ff})) }catch(_){} } },()=>{})
    return ()=>{alive=false}
  },[myEmail])
  const addCc = em => { const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(prev=>[...prev,e]); setCcInput('') }
  // Sugerencias desde el correo: solo la primera vez (cliente sin destinatarios guardados). Después, se mantiene lo definido;
  // las sugerencias quedan detrás de un enlace y se buscan solo si se piden.
  const [verSug,setVerSug] = useState(false)
  const [sugMail,setSugMail] = useState(null)
  const [primeraVez,setPrimeraVez] = useState(false)
  useEffect(()=>{ if(DEMO||!r?.client_id||_borr) return; let on=true
    supabase.from('learnings').select('value').eq('kind','rendicion_para').eq('key',String(r.client_id)).maybeSingle().then(({data})=>{ if(on&&!data?.value){ setPrimeraVez(true); setVerSug(true) } },()=>{})
    return ()=>{on=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(!verSug||sugMail!==null||DEMO) return; let on=true
    ;(async()=>{ try{ const token=await driveToken(); if(!token){ if(on) setSugMail([]); return }
      const terms=[client?.name, ...(clientEntities||[]).filter(x=>x.client_id===r.client_id).map(x=>x.name), ...fichaContacts.map(c=>c.email)]
      const out=await gmailParticipantesCliente(token, terms); if(on) setSugMail(out) }catch(_){ if(on) setSugMail([]) } })()
    return ()=>{on=false} },[verSug])   // eslint-disable-line react-hooks/exhaustive-deps
  const motivoSug = x => `${x.rol==='escribio'?'Escribió':x.rol==='recibio'?'Le escribimos':'Estuvo en copia'} el ${fmtFechaDMY(x.last)}${x.subj?`: «${x.subj.length>48?x.subj.slice(0,48)+'…':x.subj}»`:''}`
  const ponerPara = em => { const e=String(em).toLowerCase(); if(para.trim()&&para.trim().toLowerCase()!==e) setCc(p=>[...new Set([...p,para.trim().toLowerCase()])].filter(x=>x!==e)); else setCc(p=>p.filter(x=>x!==e)); setPara(e) }
  const removeCc = em => setCc(prev=>prev.filter(x=>x!==em))
  const asuntoMulti = lang => lang==='en' ? `Expense Reports ${_todas.map(x=>`No. ${x.correlativo||'?'}`).join(' and ')} — ${client?.name||''}` : `Rendiciones de gastos ${_todas.map(x=>`N° ${x.correlativo||'?'}`).join(' y ')} — ${client?.name||''}`
  const [asunto,setAsunto] = useState(_txt?.asunto || (_multi ? asuntoMulti('es') : `Rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''} — ${r.project||client?.name||''}`))
  const [lang,setLang] = useState(_borr?.lang||r?._carry?.lang||'es')
  const [firma,setFirma] = useState(firmaDefault(user?.email) || {nombre:user?.name||'', cargo:'Abogado', telefono:''})
  const [showFirma,setShowFirma] = useState(false)
  const [sending,setSending] = useState(false)
  const buildHTML = () => {
    const A='#003C50',A2='#537281',A4='#E4E8EB'
    const rows = det.map(e=>`<tr><td style="padding:5px 8px;border-bottom:1px solid ${A4};white-space:nowrap">${fmtFechaDMY(e.date)}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${RENDCAT(e.category)}${e.subcategory?': '+glosaCliente(e.subcategory):''}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${glosaCliente(e.concept)||'—'}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4};text-align:right;color:#E24B4A;white-space:nowrap">-${fmtN(e.amount)}</td></tr>`).join('')
    return `<div style="font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;font-size:13px"><div style="background:${A};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:700">Rendición de gastos</div><div style="font-size:11px;opacity:.85;margin-top:2px">${client?.name||''} · ${r.periodo}</div></div><img src="${logoBlanco}" alt="${BRAND.nombre}" style="height:28px;display:block"/></div><table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="background:${A4}"><th style="text-align:left;padding:6px 8px">Fecha</th><th style="text-align:left;padding:6px 8px">Categoría</th><th style="text-align:left;padding:6px 8px">Descripción</th><th style="text-align:right;padding:6px 8px">Monto</th></tr></thead><tbody>${rows}</tbody><tfoot><tr style="font-weight:700"><td colspan="3" style="padding:8px;border-top:2px solid ${A2}">TOTAL RENDIDO</td><td style="padding:8px;border-top:2px solid ${A2};text-align:right;color:#E24B4A">-${fmtN(r.total)}</td></tr></tfoot></table><div style="margin-top:14px;font-size:12px">Atentamente,<br/><strong>${user?.name||''}</strong><br/>${BRAND.nombre}</div></div>`
  }
  // Envuelve el texto del correo (lo que el usuario ve/edita) en HTML con la marca del estudio,
  // para que no llegue plano. Las líneas indentadas (datos de cuenta) se muestran en una caja.
  const buildEmailHtml = (text, lang='es', useCid=false) => {
    const A='#003C50', A4='#E4E8EB', MUTED='#537281', BG='#F7F9FA'
    const logoW = useCid?'cid:lealogow':`${location.origin}${BRAND.logo.blanco}`
    const logoC = useCid?'cid:lealogoc':`${location.origin}${BRAND.logo.color}`
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const lines = cuentaEnRecuadro(text).split('\n')
    let out='', box=[]
    const flush=()=>{ if(box.length){ out+=`<div style="background-color:${BG};border:1px solid ${A4};border-radius:8px;padding:12px 16px;margin:12px 0;font-size:13px;line-height:1.8">${box.map(l=>{ const i=l.indexOf(':'); return i>0?`<div><span style="color:${MUTED}">${esc(l.slice(0,i))}:</span> <strong style="color:${A}">${esc(l.slice(i+1).trim())}</strong></div>`:`<div>${esc(l)}</div>` }).join('')}</div>`; box=[] } }
    lines.forEach(l=>{ if(/^\s{2,}\S/.test(l)) box.push(l.trim()); else { flush(); out+= l.trim()? `<p style="margin:0 0 10px">${esc(l)}</p>` : '' } })
    flush()
    return `<div style="font-family:'DM Sans',Arial,Helvetica,sans-serif;color:#3D3D3D;font-size:14px;line-height:1.6;max-width:600px;margin:0 auto"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody><tr><td bgcolor="${A}" style="background-color:${A};padding:18px 24px"><table width="100%"><tbody><tr><td style="vertical-align:middle"><img src="${logoW}" alt="${BRAND.nombre}" style="height:24px;display:block"/></td><td style="text-align:right;vertical-align:middle;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;padding-left:12px">${_multi?(lang==='en'?`Expense Reports No. ${_todas.map(x=>x.correlativo||'?').join(' and ')}`:`Rendiciones N° ${_todas.map(x=>x.correlativo||'?').join(' y ')}`):`${lang==='en'?'Expense Report':'Rendición de gastos'}${r.correlativo?`${lang==='en'?' No. ':' N° '}${r.correlativo}`:''}`}</td></tr></tbody></table></td></tr></tbody></table><div style="padding:24px;border:1px solid ${A4};border-top:none">${out}${firmaCorreoHtml(firma, logoC, lang)}</div></div>`
  }
  // Correo con varias rendiciones (una por trabajo): nombra cada N° con su trabajo y saldo; se transfiere la suma de lo que queda a cargo.
  const cuerpoMulti = (lang='es') => {
    const Y = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0, mot = adic.motivo.trim() ? ` (${adic.motivo.trim()})` : ''
    const deb = _debM, favs=(_saldosM||[]).filter(o=>o.saldo>0), debs=(_saldosM||[]).filter(o=>o.saldo<0), fav=_favM
    const neto = _netoAplica && !devolverFav
    const tot = neto ? deb + Y - fav : deb + Y
    const yL = a => a.length<2 ? (a[0]||'') : `${a.slice(0,-1).join(', ')} ${lang==='en'?'and':'y'} ${a[a.length-1]}`
    const refN = (arr, en) => en ? (arr.length>1?`reports No. ${yL(arr.map(o=>o.corr||'?'))}`:`report No. ${arr[0]?.corr||'?'}`) : (arr.length>1?`de las rendiciones N° ${yL(arr.map(o=>o.corr||'?'))}`:`de la rendición N° ${arr[0]?.corr||'?'}`)
    if(lang==='en'){
      const cuentaE = `\n  ${BRAND.nombreLegal}\n  Tax ID (RUT): ${fmtRutCL(BRAND.rut)}\n  Bank: ${BRAND.pago.gastos.banco}\n  Checking account: ${BRAND.pago.gastos.cuentaFmt}\n  Confirmation to: ${BRAND.pago.gastos.email}`
      const lineas = (_saldosM||[]).map(o=>`• No. ${o.corr||'?'} · ${o.trabajo}: ${o.saldo<0?`balance payable ${fmtN(-o.saldo)}`:o.saldo>0?`balance in your favor ${fmtN(o.saldo)}`:'no balance'}`).join('\n')
      const adE = Y?` (including an additional fund of ${fmtN(Y)} for the upcoming steps)`:''
      let cierre
      if(neto) cierre = tot>0 ? (Y&&fav>deb ? `\n\nFor the upcoming steps we request an additional fund of ${fmtN(Y)}. After deducting the balance in your favor from ${refN(favs,true)}, which covers the balance payable on ${refN(debs,true)}, we kindly ask you to transfer ${fmtN(tot)} to the account of:${cuentaE}` : `\n\nAfter deducting the balance in your favor from ${refN(favs,true)}, we kindly ask you to transfer ${fmtN(tot)}${adE} to the account of:${cuentaE}`)
        : `\n\nThe balance in your favor from ${refN(favs,true)} covers the balance payable on ${refN(debs,true)}${Y?` and the additional fund of ${fmtN(Y)} for the upcoming steps`:''}, so no transfer is needed.${tot<0?` A balance of ${fmtN(-tot)} remains in your favor; please let us know whether you prefer to keep it as a fund or to have it refunded.`:''}`
      else cierre = (tot>0?`\n\nWe kindly ask you to transfer ${fmtN(tot)}${adE} to the account of:${cuentaE}`:'')
        + (favs.length?(_netoAplica?`\n\nFor the balance in your favor on ${refN(favs,true)} (${fmtN(fav)}), please let us know the bank account to which you would like it refunded.`:`\n\nPlease let us know whether you prefer to keep the balance in your favor as a fund or to have it refunded.`):'')
      return `${saludoCliEn(client?.name)},\n\nI hope you are doing well. Please find attached your expense reports, one per matter:\n\n${lineas}\n\nThe attached documents contain an itemized breakdown of each disbursement.${cierre}\n\nWe remain at your disposal for any questions.\n\nKind regards,`
    }
    const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  RUT: ${fmtRutCL(BRAND.rut)}\n  Banco: ${BRAND.pago.gastos.banco}\n  Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}\n  Comprobante a: ${BRAND.pago.gastos.email}`
    const lineas = (_saldosM||[]).map(o=>`• N° ${o.corr||'?'} · ${o.trabajo}: ${o.saldo<0?`saldo a ${T.su} cargo de ${fmtN(-o.saldo)}`:o.saldo>0?`saldo a ${T.su} favor de ${fmtN(o.saldo)}`:'sin saldo pendiente'}`).join('\n')
    const Le = T.le[0].toUpperCase()+T.le.slice(1)
    const adT = Y?`un total de ${fmtN(tot)}, que incluye fondos adicionales por ${fmtN(Y)}${mot} para los próximos trámites,`:fmtN(tot)
    let cierre
    if(neto) cierre = tot>0 ? (Y&&fav>deb ? `\n\nPara los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}. Descontado el saldo a ${T.su} favor ${refN(favs)}, que cubre el saldo a ${T.su} cargo ${refN(debs)}, ${T.le} agradeceremos transferir ${fmtN(tot)} a la cuenta de:${cuentaLEA}` : `\n\nDescontado el saldo a ${T.su} favor ${refN(favs)}, ${T.le} agradeceremos transferir ${adT} a la cuenta de:${cuentaLEA}`)
      : `\n\nEl saldo a ${T.su} favor ${refN(favs)} cubre el saldo a ${T.su} cargo ${refN(debs)}${Y?` y los fondos adicionales por ${fmtN(Y)}${mot} para los próximos trámites`:''}, por lo que no es necesario transferir.${tot<0?` Queda un saldo a ${T.su} favor de ${fmtN(-tot)}; ${T.le} agradeceremos indicarnos si ${T.pref} mantenerlo como fondo o que ${T.selo} devolvamos.`:''}`
    else cierre = (tot>0 ? `\n\n${Le} agradeceremos transferir ${adT}${_netoAplica&&debs.length===1?` (saldo ${refN(debs)})`:''} a la cuenta de:${cuentaLEA}` : '')
      + (favs.length ? (_netoAplica ? `\n\nPor el saldo a ${T.su} favor ${refN(favs)} (${fmtN(fav)}), ${T.le} agradeceremos indicarnos la cuenta corriente a la que ${T.pref} que ${T.selo} devolvamos.`
        : `\n\nPor el saldo a ${T.su} favor, ${T.le} agradeceremos indicarnos si ${T.pref} mantenerlo como fondo o que ${T.selo} devolvamos.`) : '')
    return `${saludoCli(client?.name)}:\n\nEspero que ${T.esp} muy bien. ${T.adj}s rendiciones de gastos, una por trabajo:\n\n${lineas}\n\nEn los documentos adjuntos ${T.enc} el detalle de cada desembolso.${cierre}\n\nQuedamos atentos a cualquier consulta.\n\nSaludos cordiales,`
  }
  const saludoCliEn = name => esPersona(name) ? `Dear ${(name||'').trim().split(/\s+/)[0]}` : 'Dear Sir or Madam'
  const asuntoFor = lang => { if(_multi) return asuntoMulti(lang); const label = r.project || client?.name || ''; return lang==='en' ? `Expense Report${r.correlativo?` No. ${r.correlativo}`:''} — ${label}` : `Rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''} — ${label}` }
  const cuerpoCorreo = (lang='es') => {
    if(_multi) return cuerpoMulti(lang)
    const abs = fmtN(Math.abs(saldoCliente))
    if(lang==='en'){
      const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  Tax ID (RUT): ${fmtRutCL(BRAND.rut)}\n  Bank: ${BRAND.pago.gastos.banco}\n  Checking account: ${BRAND.pago.gastos.cuentaFmt}\n  Confirmation to: ${BRAND.pago.gastos.email}`
      let cierre = ''
      if(saldoCliente < 0){
        cierre = `\n\nThis report results in a balance of ${abs} payable by you, which we kindly ask you to transfer to the account of:${cuentaLEA}`
      } else if(saldoCliente > 0){
        cierre = `\n\nThe funds received amounted to ${fmtN(totFondosCli)} and the reported expenses total ${fmtN(_rs.rendido)}, leaving a balance of ${abs} in your favor. Please let us know the bank account to which you would like the surplus refunded, by writing to ${BRAND.pago.honorarios.email}.`
      }
      const Ye = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0
      if(Ye) cierre += `\n\nFor the upcoming steps we also request an additional fund of ${fmtN(Ye)}.`
      return `${saludoCliEn(client?.name)},

I hope you are doing well. Please find attached your expense report${r.correlativo?` No. ${r.correlativo}`:''}${r.project?` for the ${r.project} project${r.subproject?` (${r.subproject})`:''}`:''}. The attached document contains an itemized breakdown of each disbursement.${cierre}

We remain at your disposal for any questions.

Kind regards,`
    }
    const cuentaLEA = `\n  ${BRAND.nombreLegal}\n  RUT: ${fmtRutCL(BRAND.rut)}\n  Banco: ${BRAND.pago.gastos.banco}\n  Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}\n  Comprobante a: ${BRAND.pago.gastos.email}`
    const Y = adic.on ? Math.max(0, parseInt(adic.monto)||0) : 0, sal = Math.abs(saldoCliente), mot = adic.motivo.trim() ? ` (${adic.motivo.trim()})` : ''
    let cierre = ''
    if(saldoCliente < 0){
      cierre = Y ? `\n\nDe esta rendición resulta un saldo a ${T.su} cargo de ${abs}. Además, para los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}, por lo que ${T.le} agradeceremos transferir un total de ${fmtN(sal+Y)} a la cuenta de:${cuentaLEA}`
        : `\n\nDe esta rendición resulta un saldo a ${T.su} cargo de ${abs}, que ${T.le} agradeceremos transferir a la cuenta de:${cuentaLEA}`
    } else if(saldoCliente > 0){
      cierre = Y ? `\n\nEl fondo recibido fue de ${fmtN(totFondosCli)} y los gastos rendidos suman ${fmtN(_rs.rendido)}, resultando un saldo a ${T.su} favor de ${abs}. Para los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}; ${Y>sal?`descontado ${T.su} saldo a favor, ${T.le} agradeceremos transferir ${fmtN(Y-sal)} a la cuenta de:${cuentaLEA}`:`${T.su} saldo a favor los cubre, por lo que lo mantendremos como fondo para esos trámites.`}`
        : `\n\nEl fondo recibido fue de ${fmtN(totFondosCli)} y los gastos rendidos suman ${fmtN(_rs.rendido)}, resultando un saldo a ${T.su} favor de ${abs}. ${T.le[0].toUpperCase()+T.le.slice(1)} agradeceremos indicarnos la cuenta corriente a la que ${T.pref} que ${T.le} devolvamos el excedente, escribiéndonos a ${BRAND.pago.honorarios.email}.`
    } else if(Y){
      cierre = `\n\nPara los próximos trámites${mot} solicitamos fondos adicionales por ${fmtN(Y)}, que ${T.le} agradeceremos transferir a la cuenta de:${cuentaLEA}`
    }
    const listaY = a => a.length<2 ? (a[0]||'') : `${a.slice(0,-1).join(', ')} y ${a[a.length-1]}`
    const proyTxt = _grp ? `, que incluye ${_grp.grupos.length} trabajos: ${listaY(_grp.grupos.map(x=>x.proyecto||'sin trabajo asignado'))}` : (r.project?` del trabajo ${r.project}${r.subproject?` (${r.subproject})`:''}`:'')
    const fav = _grp ? _grp.grupos.filter(x=>x.saldo>0) : [], cub = _grp ? _grp.grupos.filter(x=>x.saldo<0) : []
    const imputTxt = fav.length&&cub.length ? ` El saldo a ${T.su} favor de ${listaY(fav.map(x=>`${x.proyecto} (${fmtN(x.saldo)})`))} se abonó a ${listaY(cub.map(x=>x.proyecto))}.` : ''
    return `${saludoCli(client?.name)}:

Espero que ${T.esp} muy bien. ${T.adj} rendición de gastos${r.correlativo?` N° ${r.correlativo}`:''}${proyTxt}. En el documento adjunto ${T.enc} el detalle de cada desembolso.${imputTxt}${cierre}

Quedamos atentos a cualquier consulta.

Saludos cordiales,`
  }
  const bodyTocadoR=useRef(!!_txt?.cuerpo); const learnedTplR=useRef({})
  const _rendSign=()=> saldoCliente<0?'d':saldoCliente>0?'f':'0'   // la base se separa por signo del saldo: el cierre cambia (a cargo / a favor)
  const keyR=lg=>`${r.client_id}:${_rendSign()}:${lg}`
  // Tokeniza TODO lo variable (correlativo, proyecto, saldo, fondos, rendido) para reusar tu redacción SIN congelar cifras.
  const _rendPairs=(lg)=>[['{correlativo}', r.correlativo!=null?(lg==='en'?`No. ${r.correlativo}`:`N° ${r.correlativo}`):''],['{proyecto}', r.project||''],['{subproyecto}', r.subproject?` (${r.subproject})`:''],['{saldo}', fmtN(Math.abs(saldoCliente))],['{fondos}', fmtN(totFondosCli)],['{rendido}', fmtN(_rs.rendido)]]
  const _tokR=(t,lg)=>{ let s=String(t); for(const [tok,val] of _rendPairs(lg)){ if(val&&String(val).length>=2) s=s.split(val).join(tok) } return s }
  const _untokR=(t,lg)=>{ let s=String(t); for(const [tok,val] of _rendPairs(lg)){ s=s.split(tok).join(val) } return s }
  const [body,setBody] = useState(()=>_txt?.cuerpo || cuerpoCorreo(_borr?.lang||'es'))
  const aplicarBaseR=lg=>{ const tpl=_multi?null:learnedTplR.current[lg]; setBody(tpl?_untokR(tpl,lg):cuerpoCorreo(lg)) }
  useEffect(()=>{ setAsunto(asuntoFor(lang)); if(!bodyTocadoR.current) aplicarBaseR(lang) },[lang])
  const _tratoIni = useRef(true)
  useEffect(()=>{ if(_tratoIni.current){ _tratoIni.current=false; return } bodyTocadoR.current=false; setBody(cuerpoCorreo(lang)) },[trato])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(DEMO||!r?.client_id) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','trato_cliente').eq('key',String(r.client_id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&['tu','usted','ustedes'].includes(data?.value)&&data.value!==trato) setTrato(data.value) },()=>{})
    return ()=>{alive=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegirTrato = t => { setTrato(t); if(!DEMO&&r?.client_id) setLearningKV('trato_cliente',String(r.client_id),t).catch(()=>{}) }
  useEffect(()=>{ if(DEMO||!r?.client_id||!_netoAplica||_borr?.devolver_favor!=null) return; let alive=true
    supabase.from('learnings').select('value').eq('kind','rendicion_neto').eq('key',String(r.client_id)).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data?.value==='devolver') setDevolverFav(true) },()=>{})
    return ()=>{alive=false} },[r?.client_id])   // eslint-disable-line react-hooks/exhaustive-deps
  const _devIni = useRef(true)
  useEffect(()=>{ if(_devIni.current){ _devIni.current=false; return } if(!bodyTocadoR.current) setBody(cuerpoCorreo(lang)) },[devolverFav])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegirDevolver = v => { bodyTocadoR.current=false; setDevolverFav(v); if(!DEMO&&r?.client_id) setLearningKV('rendicion_neto',String(r.client_id),v?'devolver':'neto').catch(()=>{}) }
  useEffect(()=>{ if(!bodyTocadoR.current) setBody(adic.on||_multi?cuerpoCorreo(lang):(learnedTplR.current[lang]?_untokR(learnedTplR.current[lang],lang):cuerpoCorreo(lang))) },[adic.on,adic.monto,adic.motivo])   // eslint-disable-line
  // Carga tu última redacción (cliente + signo de saldo + idioma) y la aplica con las cifras de ESTA rendición.
  useEffect(()=>{ if(!r?.client_id||_multi) return; let alive=true
    ;['es','en'].forEach(lg=>{ supabase.from('learnings').select('value').eq('kind','rendicion_msg').eq('key',keyR(lg)).maybeSingle().then(({data})=>{ if(!alive||!data?.value) return; learnedTplR.current[lg]=data.value; if(lg===lang&&!bodyTocadoR.current) setBody(_untokR(data.value,lg)) },()=>{}) })
    return ()=>{alive=false} },[r?.client_id])
  const [aiBusy,setAiBusy] = useState(false)
  // La IA redacta el correo, pero las CIFRAS y los DATOS DE CUENTA van fijos (se le pasan y se le prohíbe cambiarlos).
  const redactarIA = async()=>{
    setAiBusy(true)
    const terminado = client?.status==='Terminado'
    const cierreTipo = saldoCliente<0?'falta_fondos':(saldoCliente>0?'a_favor_devolver':'cubierto')
    const facts = { saludo: (lang==='en'?saludoCliEn(client?.name):saludoCli(client?.name)), cliente: client?.name, correlativo: r.correlativo||null, proyecto: r.project||null, subproyecto: r.subproject||null, total_rendido: r.total, fondos_recibidos: totFondosCli, gastos_rendidos: _rs.rendido, saldo: saldoCliente, tipo_cierre: cierreTipo, remitente: user?.name||'', cuenta_LEA: cierreTipo==='falta_fondos'?{titular:BRAND.nombreLegal,rut:BRAND.rut,banco:BRAND.pago.gastos.banco,cuenta_corriente:BRAND.pago.gastos.cuentaFmt,correo:BRAND.pago.gastos.email}:null }
    const EN = lang==='en'
    const prompt = EN ? `You are an assistant at the Chilean law firm ${BRAND.nombre}. Write a SHORT email (max 6 lines) in professional English to send to a client together with the attached PDF of their expense report. HARD RULES: use the EXACT greeting "${saludoCliEn(client?.name)},"; do NOT invent or change any figures or bank details, use ONLY the ones provided (verbatim); mention that the breakdown is in the attached document; if there is a "proyecto", mention it naturally in the first sentence; do NOT list the expenses one by one; do NOT mention any period or date range. Based on "tipo_cierre": falta_fondos → ask to transfer the balance payable to the indicated account (include the bank details verbatim; end the sentence with "to the account of:" and put the account block below with "${BRAND.nombreLegal}" as the FIRST line (no label), then Tax ID, bank, account and confirmation, one per line; do NOT name the firm inside the paragraph; the words "Account holder" or "To" as a heading are FORBIDDEN); a_favor_devolver → mention that the funds received were "fondos_recibidos" and the reported expenses "gastos_rendidos", leaving a balance of "saldo" in their favor, and ask them to indicate the bank account to refund the surplus (to contacto@leabogados.cl); cubierto → do not mention any balance. Close with "Kind regards," and the sender. Return ONLY the email text, no subject, no markdown. Data:\n${JSON.stringify(facts,null,2)}` : `Eres asistente de la firma de abogados chilena ${BRAND.nombre}. Redacta un CORREO BREVE (máx 6 líneas) para enviar a un cliente junto al PDF adjunto de su rendición de gastos. Español de Chile, cordial y profesional. REGLAS DURAS: usa el saludo EXACTO "${saludoCli(client?.name)}:"; la primera frase es EXACTA "Espero que ${T.esp} muy bien."; trata al destinatario de ${trato==='tu'?'TÚ (te, tu, encontrarás)':trato==='usted'?'USTED (le, su, encontrará)':'USTEDES (les, su, encontrarán)'} de forma pareja en todo el correo, sin mezclar; NO inventes ni cambies cifras ni datos de cuenta, usa SOLO los que te paso (textualmente); menciona que el detalle está en el documento adjunto; si hay "proyecto", menciónalo de forma natural en la primera frase; NO listes los gastos uno a uno; NO menciones período ni rango de fechas. Según "tipo_cierre": falta_fondos → pide transferir el saldo a su cargo a la cuenta indicada (incluye los datos de cuenta tal cual; la frase termina en "a la cuenta de:" y debajo va el bloque de datos con "${BRAND.nombreLegal}" como PRIMERA línea (sin etiqueta) y luego RUT, banco, cuenta y comprobante, cada uno en su línea; NO nombres la oficina dentro del párrafo; PROHIBIDO usar las palabras "Destinatario" o "Titular"); a_favor_devolver → menciona que el fondo recibido fue "fondos_recibidos" y los gastos rendidos "gastos_rendidos", resultando un saldo a su favor de "saldo"; pide que indique la cuenta corriente a la que devolverle el excedente (a contacto@leabogados.cl); cubierto → no menciones saldo. Cierra con "Saludos cordiales," y el remitente. Devuelve SOLO el texto del correo, sin asunto ni markdown. Datos:\n${JSON.stringify(facts,null,2)}`
    try{
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:600,messages:[{role:'user',content:prompt}]})
      const txt = (data.content?.[0]?.text||'').trim()
      if(!txt) throw new Error('respuesta vacía')
      bodyTocadoR.current=true; setBody(txt); logEvent('rendicion','correo_ia',{client_id:r.client_id},user?.name)
    }catch(e){ appAlert('Error al redactar con IA: '+(e?.message||e)) }
    setAiBusy(false)
  }
  const verPDF = (x=r) => {
    const w=window.open('','_blank'); if(!w){ appAlert('Permite las ventanas emergentes para ver el PDF.'); return }
    w.document.write(rendicionPdfHtml(x, client, expenses, clientEntities, attachSet, lang))   // diseño rico A (mismo que "Ver PDF" del historial)
    w.document.close()
  }
  // La vista previa no registra nada: recién al guardar o enviar se crea(n) la(s) rendición(es) y se marcan sus gastos.
  const persistir = async() => { const out=[]; for(const x of _todas){ out.push(x._virtual ? await x._crear() : x) } return out }
  const _modoCorreo = _multi ? 'sep1' : (r._cola?.length ? 'sepN' : 'junto')
  const correoDatos = (extra, saved) => ({para:para.trim(), cc, asunto, cuerpo:body, trato, lang, studioOn, adic:adicRaw, por:user?.name||null, modo:_modoCorreo, grupo:(saved||[]).map(x=>x.id), devolver_favor:_netoAplica?devolverFav:null, ...extra})
  const guardarBorrador = async() => {
    setSending(true)
    try{
      const saved = await persistir()
      const correo = correoDatos({guardado_at:new Date().toISOString()}, saved)
      for(const x of saved){ const {error}=await supabase.from('rendiciones').update({correo}).eq('id',x.id); if(error) throw error; onPatch&&onPatch(x.id,{correo}) }
      // Un correo por rendición: las que esperan su turno también quedan como borrador (cada una con su propio correo después).
      for(const x of (r._cola||[])){ if(x._virtual) await x._crear() }
      logActividad('rendicion.borrador_guardado',{tabla:'rendiciones',id:saved[0]?.id,detalle:{cliente:client?.name,title:`Borrador guardado${saved.length>1?` (${saved.length} rendiciones)`:''}`,monto:Math.round(saved.reduce((a,x)=>a+(x.total||0),0))}})
      appAlert('Borrador guardado. Lo encuentras en Rendir a cliente › Borradores.')
      onClose()
    }catch(e){ appAlert('No se pudo guardar el borrador: '+(e?.message||e)) }
    setSending(false)
  }
  const enviar = async() => {
    if(!para.trim()){ appAlert('Falta el email del cliente.'); return }
    const texto = cuentaEnRecuadro(body)
    const firmaTxt = firma.nombre ? [firma.nombre, firma.cargo, firma.telefono, BRAND.direccionFirma, BRAND.ciudad+' - Chile', 'www.'+BRAND.web].filter(Boolean).join('\n') : ''
    const textoFull = firmaTxt ? texto+'\n\n'+firmaTxt : texto
    const _stripD = u=>String(u||'').replace(/^data:[^,]+,/,'')
    const logosInline = [{cid:'lealogow',b64:_stripD(logoBlanco),mime:'image/png'},{cid:'lealogoc',b64:_stripD(logoColor),mime:'image/png'}]
    const ccStr = [...cc, ...(studioOn?studioEmails:[])].filter(Boolean).join(', ')
    setSending(true)
    try{
      const saved = await persistir()
      // Número de cada rendición ANTES de armar los PDF: máximo ya usado por otra rendición del cliente + 1, en orden.
      const ids = saved.map(x=>x.id)
      const {data:mx}=await supabase.from('rendiciones').select('correlativo').eq('client_id',r.client_id).not('id','in',`(${ids.join(',')})`).is('anulada_at',null).not('correlativo','is',null).order('correlativo',{ascending:false}).limit(1).maybeSingle()
      let libre=((mx&&mx.correlativo)||0)+1
      const conNum = saved.map(x=>{ if(x.sent_at&&x.correlativo) return x   // reenvío: el cliente ya tiene ese N°, no se renumera
        const c=(x.correlativo&&x.correlativo>=libre)?x.correlativo:libre; libre=c+1; return {...x, correlativo:c} })
      const nombrePdf = x => `${lang==='en'?'Expense Report':'Rendicion'}${conNum.length>1?` ${x.correlativo}`:''} ${(client?.name||'').replace(/[^\w\s-]/g,'')} ${x.project||''}`.trim()+'.pdf'
      const armarAdjuntos = async()=>{ const out=[]; for(const x of conNum){ out.push({base64:await rendicionPdfBase64(x, client, expenses, clientEntities, user, attachSet, lang), name:nombrePdf(x), mime:'application/pdf'}) } return out }
      // Envío directo con PDF adjunto vía Gmail API (si el token tiene el scope gmail.send)
      let conAdjunto = false
      let sendErr = null, viaRend = null
      const token = await driveToken()
      if(token){
        try{
          await sendGmailWithPdf(token, {to:para.trim(), cc:ccStr, subject:asunto, bodyText:textoFull, bodyHtml:buildEmailHtml(texto, lang, true), inlineImages:logosInline, attachments:await armarAdjuntos()})
          conAdjunto = true; viaRend = 'usuario'
        }catch(err){ sendErr = err /* sin scope gmail.send (403) u otro: caemos al fallback */ }
      }
      if(!conAdjunto){
        // No se pudo desde el correo del usuario. NO se manda solo desde otra cuenta: se pregunta.
        // Si acepta → oficina. Si NO (o la oficina falla) → se descarga el PDF y se abre Gmail para enviarlo a mano DESDE SU correo.
        const usarOficina = await appConfirm(MAIL_OFICINA_CONFIRM)
        let irAManual = !usarOficina
        if(usarOficina){
          try{
            await sendMailServer({to:para.trim(), cc:ccStr, subject:asunto, html:buildEmailHtml(texto, lang), text:textoFull, attachments:await armarAdjuntos()})
            conAdjunto = true; viaRend = 'oficina'
          }catch(srvErr){ irAManual = true; sendErr = sendErr || srvErr }
        }
        if(irAManual && !conAdjunto){
          // Sale desde TU correo: descargamos el PDF y abrimos Gmail para que lo adjuntes a mano.
          appAlert('Para enviarlo desde tu correo: descargamos el PDF y abrimos Gmail para que lo adjuntes.\n(O cierra sesión y vuelve a entrar para enviarlo automático desde tu cuenta.)')
          try{
            for(const at of await armarAdjuntos()){
              const bytes = Uint8Array.from(atob(at.base64), c=>c.charCodeAt(0))
              const url = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))
              const a = document.createElement('a'); a.href=url; a.download = at.name
              document.body.appendChild(a); a.click(); a.remove()
              setTimeout(()=>URL.revokeObjectURL(url), 5000)
            }
          }catch(_){ verPDF() }
          const gmailUrl=`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para.trim())}&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(textoFull)}`
          const win=window.open(gmailUrl,'_blank')
          if(!win) window.location.href=`mailto:${para.trim()}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(textoFull)}`
          // Envío a mano: la app no sabe si el correo salió. Se registra como enviada solo cuando el usuario lo confirma; si no, queda como borrador.
          const confirmado = await appConfirm('¿Enviaste el correo al cliente con el PDF adjunto?\n\nSi aún no, responde que no: la rendición queda como borrador (sin número) y la envías después desde Rendiciones.')
          if(!confirmado){ setSending(false); appAlert(`La rendición NO se envió: queda como borrador, sin número, en Rendir a cliente › Borradores.\n\n${TXT_REINGRESO()}`); return }
        }
      }
      const now = new Date().toISOString()
      // El correlativo se GRABA al confirmar el envío (no al generar): un borrador no consume número.
      const correoEnv = correoDatos({enviado_at:now}, conNum)
      for(const x of conNum){
        const {error:seErr}=await supabase.from('rendiciones').update({sent_at:now, correlativo:x.correlativo, dirigido_email:(para||'').trim()||x.dirigido_email||null, correo:correoEnv}).eq('id',x.id)
        if(seErr){ console.error('No se pudo marcar la rendición como enviada:',seErr.message); appAlert(`El correo salió, pero la app no pudo marcar la rendición N° ${x.correlativo} como enviada (${seErr.message}). Avísale a soporte para que quede registrada.`) }
        else { onSent && onSent(x.id, now, x.correlativo); onPatch && onPatch(x.id,{correo:correoEnv, dirigido_email:(para||'').trim()||null}) }
      }
      // Neto: el saldo a favor de un trabajo queda imputado al que debe (con bitácora; se deshace uniendo el fondo en Gastos › Editar fondo).
      if(_netoAplica && !devolverFav){ try{
        const res=await imputarSaldosTrabajos({expenses, clientId:r.client_id, saldos:_todas.map((x,i)=>({trabajo:x.project||'', saldo:(_saldosM[i]||{}).saldo||0, corr:conNum[i]?.correlativo})), sales, user, ref:conNum.map(x=>x.correlativo).join(' y '), cliente:client?.name})
        if(setExpenses&&(res.cambios.length||res.nuevos.length)) setExpenses(p=>[...p.map(e=>{ const c=res.cambios.find(z=>z.id===e.id); return c?{...e,...c.patch}:e }),...res.nuevos])
        if(res.faltan>=1) appAlert(`El correo salió. La imputación entre trabajos quedó incompleta: ${fmt(res.faltan)} sin registrar${res.motivo?` (${res.motivo})`:''}. Regístrala en Gastos › Editar fondo › Repartir entre proyectos.`)
      }catch(e){ appAlert('El correo salió, pero no se pudo registrar la imputación entre trabajos: '+(e?.message||e)+'. Regístrala en Gastos › Editar fondo › Repartir entre proyectos.') } }
      const corr = conNum.map(x=>x.correlativo).join(' y ')
      try{ if(cc.length){ await supabase.from('learnings').delete().eq('kind','rendicion_cc').eq('key',String(r.client_id)); await supabase.from('learnings').insert({kind:'rendicion_cc',key:String(r.client_id),value:cc.join(', '),meta:{}}) } }catch(_){}
      // Recordar el destinatario "Para" de la rendición → lo reusa la devolución (que va al mismo).
      try{ if((para||'').trim()){ await supabase.from('learnings').delete().eq('kind','rendicion_para').eq('key',String(r.client_id)); await supabase.from('learnings').insert({kind:'rendicion_para',key:String(r.client_id),value:para.trim(),meta:{}}) } }catch(_){}
      try{ if(r.client_id && !adic.on && !_multi) await setLearningKV('rendicion_msg', keyR(lang), _tokR(body,lang)) }catch(_){}
      // Fondos adicionales pedidos en la rendición: quedan en el historial de solicitudes (cruce con el depósito, avisos).
      // Lo que la rendición le pide transferir queda como solicitud de fondos (seguimiento hasta el depósito): saldo a su cargo + fondos
      // adicionales; con saldo a favor, solo lo adicional que exceda ese saldo. Se cierra sola cuando entra el depósito (Rendir a cliente).
      { const _Y=adic.on?Math.max(0,parseInt(adic.monto)||0):0, _sal=Math.abs(saldoCliente)
        const pedido=Math.round(_multi ? Math.max(0, _debM+_Y-(_netoAplica&&!devolverFav?_favM:0)) : (saldoCliente<0 ? _sal+_Y : (saldoCliente>0 ? Math.max(0,_Y-_sal) : _Y)))
        if(pedido>0){ try{
          // Reenviar no duplica el pedido: si el cliente ya tiene una solicitud abierta (sin depósito), se actualiza esa.
          // Se reusa solo una solicitud abierta, del cliente en general (sin venta) y aún sin depósito; una ya cubierta no se pisa.
          const {data:abiertas}=await supabase.from('fund_requests').select('*').eq('client_id',r.client_id).is('recibido_at',null).is('sale_id',null).order('enviada_at',{ascending:false}).limit(5)
          const abierta=(abiertas||[]).find(q=>estadoSolicitud(q,expenses).k!=='rec')||null
          const {error:frErr}= abierta?.id
            ? await supabase.from('fund_requests').update({ monto:pedido, asunto, para:para.trim(), cc:ccStr, enviada_por:user?.name||null, enviada_at:new Date().toISOString() }).eq('id',abierta.id)
            : await supabase.from('fund_requests').insert({ client_id:r.client_id||null, monto:pedido, asunto, para:para.trim(), cc:ccStr, enviada_por:user?.name||null, n_adjuntos:1 })
          if(frErr) console.error('fund_requests',frErr.message); else logActividad('fondos.solicitud_enviada',{tabla:'clients',id:r.client_id,detalle:{cliente:client?.name,title:`Pedido en la rendición${corr?` N° ${corr}`:''}`,monto:pedido}}) }catch(_){} } }   // la base de la próxima rendición de este cliente (mismo signo de saldo, idioma) = esta
      try{ if(firma.nombre||firma.cargo||firma.telefono||firma.correo){ await supabase.from('learnings').delete().eq('kind','firma_correo').eq('key',myEmail); await supabase.from('learnings').insert({kind:'firma_correo',key:myEmail,value:JSON.stringify(firma),meta:{}}) } }catch(_){}
      const _paraTxt=[para.trim(),...cc].filter(Boolean).join(', ')
      appAlert(conAdjunto
        ? txtEnviado(viaRend,{que:conNum.length>1?`Rendiciones N° ${corr}`:`Rendición${corr?` N° ${corr}`:''}`, g:conNum.length>1?'as':'a', para:_paraTxt})+(conNum.length>1?' Con sus PDF adjuntos.':' Con el PDF adjunto.')
        : `Rendición${corr?` N° ${corr}`:''} registrada como enviada desde tu correo (envío manual) a ${_paraTxt}.`)
      // Separadas en correos distintos: sigue con la próxima rendición de la cola.
      // Mismo cliente: el destinatario, la copia y el idioma elegidos pasan al correo siguiente.
      if(r._cola?.length && onNext){ const [sig,...resto]=r._cola; onNext({...sig, _cola:resto, ...(String(sig.client_id)===String(r.client_id)?{_carry:{para,cc,lang,studioOn}}:{})}) } else onClose()
    }catch(e){ appAlert('Error: '+e.message) }
    setSending(false)
  }
  const _body = (<>
      <PasosRend paso={2}/>
      {!para.trim() && <div style={{padding:'8px 10px',borderRadius:8,background:'#FEF6EE',border:'1px solid #F5E2CC',color:C.soon,fontSize:12,marginBottom:12}}>Falta el destinatario. Escríbelo abajo o complétalo en la ficha del cliente.</div>}
      <div style={{fontSize:11,color:C.textSoft,marginBottom:10}}>De <span style={{color:C.muted}}>{user?.email||''}</span></div>
      {/* Destinatarios: un solo bloque con chips (Para = principal navy, Cc = copias azules). Si Para está vacío, lo que escribes/eliges entra como Para. */}
      {(()=>{
        const flLbl={fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}
        const addOne = em => { const e=String(em||'').trim(); if(!e) return; if(!para.trim()) setPara(e); else addCc(e); setCcInput('') }
        const sug=fichaContacts.filter(c=>(c.email||'').toLowerCase()!==(para||'').toLowerCase()&&!cc.includes((c.email||'').toLowerCase()))
        return (
        <div style={{marginBottom:12}}>
          <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'7px 9px'}}>
            <div style={{...flLbl,marginBottom:5}}>Destinatarios</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,alignItems:'center'}}>
              {para.trim()&&<span style={{display:'inline-flex',alignItems:'center',gap:5,background:C.accent,color:'#fff',borderRadius:16,padding:'3px 7px 3px 9px',fontSize:12}}><span style={{fontSize:9,opacity:.65,fontWeight:600,letterSpacing:.5}}>PARA</span>{para}<button onClick={()=>setPara('')} aria-label='Quitar' style={{background:'none',border:'none',color:'#fff',cursor:'pointer',fontSize:14,lineHeight:1,padding:0,opacity:.8}}><Gl n='x'/></button></span>}
              {cc.map(em=><span key={em} style={{display:'inline-flex',alignItems:'center',gap:5,background:C.azulBg,color:C.accent,borderRadius:16,padding:'3px 6px 3px 8px',fontSize:12}}><span style={{fontSize:9,color:C.azulInfo,fontWeight:600,letterSpacing:.5}}>CC</span>{em}<button onClick={()=>removeCc(em)} aria-label='Quitar' style={{background:'none',border:'none',color:C.azulInfo,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}><Gl n='x'/></button></span>)}
              <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if((e.key==='Enter'||e.key===',')&&ccInput.trim()){ e.preventDefault(); addOne(ccInput) } }} onBlur={()=>ccInput.trim()&&addOne(ccInput)} placeholder={para.trim()?'+ agregar copia…':'correo del cliente…'} style={{flex:1,minWidth:130,border:'none',outline:'none',fontSize:13,color:C.text,background:'none'}}/>
            </div>
          </div>
          {sug.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>
            {sug.map(c=><button key={c.email} onClick={()=>addOne(c.email)} style={{fontSize:11,border:`0.5px solid ${C.border}`,color:C.muted,background:'none',borderRadius:16,padding:'3px 10px',cursor:'pointer'}}>+ {c.nombre?c.nombre+' · ':''}{c.email}</button>)}
          </div>}
          {!DEMO&&(verSug
            ? <div style={{marginTop:8,border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 11px',background:C.surface}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><span style={{...SEC_LBL}}>Sugeridos desde tu correo</span>{!primeraVez&&<button onClick={()=>setVerSug(false)} style={{fontSize:11,color:C.textSoft,background:'none',border:'none',cursor:'pointer'}}>Ocultar</button>}</div>
                {sugMail===null&&<div style={{fontSize:12,color:C.textSoft,padding:'6px 0'}}>Buscando en tu correo…</div>}
                {sugMail&&!sugMail.length&&<div style={{fontSize:12,color:C.textSoft,padding:'6px 0'}}>No encontré correos con este cliente.</div>}
                {(sugMail||[]).map(x=>{ const esPara=(para||'').toLowerCase()===x.email, esCc=cc.includes(x.email); return (
                  <div key={x.email} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:`1px solid ${C.track}`}}>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.name||x.email}{x.name&&<span style={{fontWeight:400,color:C.textSoft}}> · {x.email}</span>}</div>
                      <div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{motivoSug(x)}</div></div>
                    <button onClick={()=>ponerPara(x.email)} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'3px 10px',border:`1px solid ${esPara?C.accent:C.border}`,background:esPara?C.azulBg:C.surface,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Para</button>
                    <button onClick={()=>esCc?removeCc(x.email):addCc(x.email)} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'3px 10px',border:`1px solid ${esCc?C.accent:C.border}`,background:esCc?C.azulBg:C.surface,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>CC</button>
                  </div>) })}
                {primeraVez&&<div style={{fontSize:11,color:C.textSoft,marginTop:4}}>Solo esta vez: lo que elijas queda guardado para las próximas rendiciones de este cliente.</div>}
              </div>
            : <button onClick={()=>setVerSug(true)} style={{marginTop:6,fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Ver sugerencias del correo</button>)}
          {studioEmails.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}><Switch on={studioOn} onToggle={()=>setStudioOn(v=>!v)}/><span style={{fontSize:12,color:C.text}}>Copia a la oficina <span style={{color:C.textSoft}}>({studioEmails.join(', ')})</span></span></div>}
        </div>
        )
      })()}
      <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',marginBottom:12}}>
        <div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>Asunto</div>
        <input value={asunto} onChange={e=>setAsunto(e.target.value)} style={{width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}}/>
      </div>
      {_netoAplica&&(()=>{ const net=_debM-_favM
        const fila=(k,l,v,col,b)=>(<div key={k} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) auto',columnGap:10,alignItems:'baseline',padding:b?'7px 0 2px':'4px 0',borderTop:b?`1px solid ${C.border}`:'none',marginTop:b?3:0,fontSize:13}}><div style={{minWidth:0}}>{l}</div><span style={{fontWeight:b?700:600,color:col,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(v)}</span></div>)
        const est=t=><span style={isDesktop?{marginLeft:8,fontSize:11.5,color:C.textSoft}:{display:'block',fontSize:11.5,color:C.textSoft}}>{t}</span>
        return (<div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'8px 11px',marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:600,color:C.accent,marginBottom:2}}>Saldos de los trabajos</div>
          {(_saldosM||[]).filter(o=>Math.abs(o.saldo)>=1).map((o,i)=>fila(i,<><span>N° {o.corr||'?'} · {o.trabajo}</span>{est(o.saldo<0?'A su cargo':'A su favor')}</>,Math.abs(o.saldo),o.saldo<0?C.overdueText:C.greenText))}
          {devolverFav
            ? <>{fila('t',<span style={{fontWeight:700,color:C.accent}}>A transferir</span>,_debM,C.text,true)}{fila('d',<span style={{color:C.muted}}>A devolver al cliente</span>,_favM,C.greenText)}</>
            : (net>0 ? fila('t',<span style={{fontWeight:700,color:C.accent}}>A transferir (neto)</span>,net,C.text,true) : fila('t',<span style={{fontWeight:700,color:C.accent}}>Queda a su favor</span>,-net,C.greenText,true))}
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:8}}><Switch on={devolverFav} onToggle={()=>elegirDevolver(!devolverFav)}/><span style={{fontSize:12.5,color:C.text}}>Devolver el saldo a favor</span></div>
        </div>) })()}
      <div style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'8px 11px',marginBottom:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:12.5,fontWeight:600,color:C.accent}}>Fondos adicionales</span>
          {ultFondo&&!adic.on&&<button type='button' onClick={()=>setAdic(p=>({...p,monto:String(Math.round(ultFondo.amount))}))} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:20,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>Último fondo {fmt(ultFondo.amount)}</button>}
          {adic.on&&<span style={{marginLeft:'auto',fontSize:11.5,color:C.muted,whiteSpace:'nowrap'}}>{_multi?`a transferir ${fmt(Math.max(0,_debM+(parseInt(adic.monto)||0)-(_netoAplica&&!devolverFav?_favM:0)))}`:saldoCliente<0?`total a transferir ${fmt(Math.abs(saldoCliente)+(parseInt(adic.monto)||0))}`:saldoCliente>0?`a transferir ${fmt(Math.max(0,(parseInt(adic.monto)||0)-saldoCliente))}`:''}</span>}
        </div>
        {<div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
          <span style={{display:'flex',alignItems:'center',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',width:150}}><span style={{fontSize:13,color:C.muted,padding:'0 2px 0 10px'}}>$</span><input value={adic.monto?Number(adic.monto).toLocaleString('es-CL'):''} onChange={e=>setAdic(p=>({...p,monto:e.target.value.replace(/\D/g,'')}))} inputMode='numeric' placeholder='Monto' style={{border:'none',outline:'none',fontSize:13,padding:'8px 8px 8px 2px',width:'100%',background:'none'}}/></span>
          <input value={adic.motivo} onChange={e=>setAdic(p=>({...p,motivo:e.target.value}))} placeholder='Para qué (opcional)' style={{flex:'1 1 180px',minWidth:0,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'8px 10px',outline:'none'}}/>
        </div>}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6,marginBottom:4}}>
        <Lbl>Mensaje</Lbl>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
          {lang==='es'&&<div style={{display:'inline-flex',border:`0.5px solid ${C.border}`,borderRadius:14,overflow:'hidden'}}>
            {[['tu','Tú'],['usted','Usted'],['ustedes','Ustedes']].map(([k,l])=><button key={k} onClick={()=>elegirTrato(k)} style={{fontSize:10,fontWeight:600,padding:'4px 10px',border:'none',cursor:'pointer',background:trato===k?C.accent:'transparent',color:trato===k?'#fff':C.muted}}>{l}</button>)}
          </div>}
          <div style={{display:'inline-flex',border:`0.5px solid ${C.border}`,borderRadius:14,overflow:'hidden'}}>
            {['es','en'].map(l=><button key={l} onClick={()=>setLang(l)} style={{fontSize:10,fontWeight:600,padding:'4px 10px',border:'none',cursor:'pointer',background:lang===l?C.accent:'transparent',color:lang===l?'#fff':C.muted}}>{l.toUpperCase()}</button>)}
          </div>
          <button onClick={redactarIA} disabled={aiBusy} style={{...chipBtn('soft'),height:24,opacity:aiBusy?.6:1}}>{aiBusy?(lang==='en'?'Writing…':'Redactando…'):(lang==='en'?'Draft with AI':'Redactar con IA')}</button>
        </div>
      </div>
      <textarea value={body} onChange={e=>{bodyTocadoR.current=true; setBody(e.target.value)}} rows={8} style={{width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'10px 12px',fontSize:13,lineHeight:1.5,color:C.text,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',marginBottom:6}}/>
      <div style={{fontSize:10,color:C.textSoft,marginBottom:12}}>Las cifras y los datos de cuenta van fijos; la IA solo redacta. Revisa antes de enviar.</div>
      <div style={{marginBottom:12}}>
        <button onClick={()=>setShowFirma(v=>!v)} style={{fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Mi firma {showFirma?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
        {showFirma&&<><div style={{marginTop:8,display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          {[['nombre','Nombre'],['cargo','Cargo'],['telefono','Teléfono']].map(([k,lbl])=>(
            <div key={k} style={{background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px'}}>
              <div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>{lbl}</div>
              <input value={firma[k]||''} onChange={e=>setFirma(f=>({...f,[k]:e.target.value}))} style={{width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:0,height:22}}/>
            </div>
          ))}
        </div><div style={{fontSize:10,color:C.textSoft,marginTop:6}}>Se guarda para tus próximos correos. El correo incluye el logo de {BRAND.nombre}.</div></>}
      </div>
      {!(asPage&&isDesktop)&&<details style={{marginBottom:14}} open><summary style={{fontSize:11,color:C.muted,cursor:'pointer'}}>Vista previa del correo</summary><div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12,maxHeight:300,overflowY:'auto',marginTop:8,background:'#fff'}} dangerouslySetInnerHTML={{__html:buildEmailHtml(body, lang)}}/></details>}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {!asPage&&<button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
        {_todas.map((x,i)=><button key={i} onClick={()=>verPDF(x)} style={{flex:1,padding:'9px 10px',borderRadius:10,border:`1px solid ${C.border}`,background:C.surface,color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{_multi?`PDF N° ${x.correlativo||i+1}`:'Ver PDF'}</button>)}
        <button onClick={guardarBorrador} disabled={sending} style={{flex:(!isDesktop&&_multi)?'1 1 100%':1.3,padding:'9px 10px',borderRadius:10,border:'none',background:C.azulBg,color:C.accent,fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',opacity:sending?.6:1}}>Guardar borrador</button>
      </div>
      <button onClick={enviar} disabled={sending||!para.trim()} style={{width:'100%',marginTop:10,padding:'11px 14px',borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13.5,fontWeight:700,cursor:'pointer',opacity:(sending||!para.trim())?.6:1}}>{sending?'Enviando...':(_multi?`Enviar en un correo · ${_todas.length} PDF`:(r._cola?.length?(r._cola[0]._cliName&&String(r._cola[0].client_id)!==String(r.client_id)?`Enviar y seguir con ${r._cola[0]._cliName}`:`Enviar y seguir con la N° ${r._cola[0].correlativo||'siguiente'}`):'Enviar'))}</button>
      </>)
  const _page = (asPage&&isDesktop) ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,460px)',gap:22,alignItems:'start'}}><div style={{minWidth:0}}>{_body}</div><div style={{position:'sticky',top:72}}><div style={{...SEC_LBL,marginBottom:6}}>Vista previa del correo</div><div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:12,background:'#fff',maxHeight:'calc(100vh - 170px)',overflowY:'auto'}} dangerouslySetInnerHTML={{__html:buildEmailHtml(body, lang)}}/></div></div> : _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={isDesktop?780:640} title={<><span style={{color:C.accent}}>Enviar rendición</span>{client?.name&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose} closeOnBackdrop={false}>{_body}</Modal>)
}

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

export async function rendicionPdfBase64(r, client, expenses, clientEntities, user, attachSet, lang='es'){
  const EN = lang==='en'
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const doc = new jsPDF({unit:'pt', format:'letter'})
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  // Datos: MISMA fuente que el "Ver PDF" (rendicionPdfHtml) para que ambos coincidan.
  const gastos = gastosDeRend(r, expenses).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))).map(e=>attachSet?({...e,respaldo:attachSet.has(String(e.id))}):e)
  const entsClient = (clientEntities||[]).filter(x=>x.client_id===(client&&client.id))
  const gEnt = (gastos.find(e=>e.entity_id)||{}).entity_id
  const scopeEntId = entsClient.length>1 ? gEnt : null
  const ent = entsClient.length===1 ? entsClient[0] : (gEnt ? (clientEntities||[]).find(x=>x.id===gEnt) : null)
  const trab = r.por_trabajo ? (r.project||'') : null
  const { fondos, totFondos, previas, rendidoAntes } = rendicionFondo(expenses, client&&client.id, scopeEntId, r.id, trab, r.fondo_id||null)
  const grp = (trab!=null||r.fondo_id) ? null : rendGruposProyecto({expenses, clientId:client&&client.id, scopeEntId, gastos, excludeRenderId:r.id, clientEntities})
  const razon = (ent&&ent.name) || (client&&client.name) || '—'
  const rut = (ent&&ent.rut) || (client&&client.rut) || ''
  const totGastos = gastos.reduce((a,e)=>a+(e.amount||0),0)
  const saldo = totFondos - rendidoAntes - totGastos
  const fechaEmision = r.created_at ? new Date(r.created_at).toLocaleDateString(EN?'en-GB':'es-CL',{day:'2-digit',month:'long',year:'numeric'}) : ''
  const T = EN
    ? {reportNo:'Report No.',issued:'Issued',exp:n=>`${n} expense${n!==1?'s':''}`,attn:'Attn',project:'PROJECT',funds:'Funds received',expPeriod:'Expenses (period)',balFavor:'Balance in your favor',balPending:'Outstanding balance',date:'DATE',concept:'DESCRIPTION',category:'CATEGORY',amount:'AMOUNT',totalExp:'Total expenses',fundsSection:'FUNDS RECEIVED',noFunds:'No funds recorded',fundSummary:'FUND SUMMARY',received:'Funds received',prev:'Report',thisRep:'This report',avail:'Available balance',due:'Balance due',footer:'Expense report'}
    : {reportNo:'Rendición N°',issued:'Emisión',exp:n=>`${n} gasto${n!==1?'s':''}`,attn:'Dirigido a',project:'PROYECTO',funds:'Fondos recibidos',expPeriod:'Gastos del período',balFavor:'Saldo a favor',balPending:'Saldo pendiente',date:'FECHA',concept:'CONCEPTO',category:'CATEGORÍA',amount:'MONTO',totalExp:'Total gastos',fundsSection:'FONDOS RECIBIDOS',noFunds:'Sin fondos registrados',fundSummary:'RESUMEN DEL FONDO',received:'Fondos recibidos',prev:'Rendición',thisRep:'Esta rendición',avail:'Saldo disponible',due:'Saldo a su cargo',footer:'Rendición de gastos'}
  const M=40, cNavy=[0,60,80], cMuted=[83,114,129], cTxt=[61,61,61], cA3=[153,171,180], cGreen=[15,110,86], cRed=[163,45,45], cGray=[228,232,235]
  const cMonto = W-M, cCat = W-196
  // ===== Header navy =====
  doc.setFillColor(0,60,80); doc.rect(0,0,W,76,'F')
  try{ doc.addImage(logoBlanco, 'PNG', M, 25, 170, 26) }catch(_){ doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.text('LIBERONA ESCALA', M, 40) }
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text(String(razon).slice(0,42), W-M, 36, {align:'right'})
  if(rut){ doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(153,171,180); doc.text(rut, W-M, 52, {align:'right'}) }
  // ===== Franja meta =====
  doc.setFillColor(237,240,243); doc.rect(0,76,W,24,'F'); doc.setTextColor(61,61,61); doc.setFontSize(9)
  let mx=M
  if(r.correlativo){ doc.setFont('helvetica','bold'); const s=`${T.reportNo} ${r.correlativo}`; doc.text(s, mx, 91); mx+=doc.getTextWidth(s)+14 }
  doc.setFont('helvetica','normal')
  const mA=`${T.issued}: ${fechaEmision}`; doc.text(mA, mx, 91); mx+=doc.getTextWidth(mA)+14
  doc.text(T.exp(gastos.length), mx, 91)
  if(r.dirigido_a){ doc.setFont('helvetica','bold'); doc.text(`${T.attn}: ${r.dirigido_a}`, W-M, 91, {align:'right'}) }
  // ===== KPIs =====
  let y=120; const bw=(W-2*M-12)/3, bh=44
  const kcard=(i,lbl,val,bg,fg)=>{ const x=M+i*(bw+6); doc.setFillColor(bg[0],bg[1],bg[2]); doc.roundedRect(x,y,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); const lc=fg[0]===255?[255,255,255]:[153,171,180]; doc.setTextColor(lc[0],lc[1],lc[2]); doc.text(lbl.toUpperCase(), x+10, y+17); doc.setFontSize(13); doc.setTextColor(fg[0],fg[1],fg[2]); doc.text(val, x+10, y+35) }
  const sPos=saldo>=0
  kcard(0,T.funds,fmtN(totFondos),[245,247,249],cGreen)
  kcard(1,T.expPeriod,fmtN(totGastos),[245,247,249],cTxt)
  kcard(2,sPos?T.balFavor:T.balPending,(saldo<0?'-':'')+fmtN(Math.abs(saldo)),sPos?[225,245,238]:[252,235,235],sPos?cGreen:cRed)
  y+=bh+20
  const ensure=(n)=>{ if(y > H-70-n){ doc.addPage(); y=56 } }
  const filaG=e=>{
    ensure(24)
    const ot=e.ot_number?(String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number):''
    const seg2 = !!(ot||e.respaldo)
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61)
    doc.text(fmtFechaDMY(e.date), M, y)
    doc.text((glosaCliente(e.concept)||'—').slice(0,40), M+72, y)
    doc.setFontSize(8.5); doc.setTextColor(83,114,129); doc.text(RENDCAT(e.category).slice(0,24), cCat, y)
    doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtN(e.amount), cMonto, y, {align:'right'})
    if(seg2){ let sx=M+72; doc.setFont('helvetica','bold'); doc.setFontSize(7.5)
      if(ot){ doc.setTextColor(24,95,165); doc.text(ot, sx, y+11); sx+=doc.getTextWidth(ot)+10 }
      if(e.respaldo){ doc.setTextColor(15,110,86); doc.text(EN?'✓ receipt':'✓ respaldo', sx, y+11) }
    }
    y += seg2?23:18
  }
  if(!grp){
  // ===== Proyecto =====
  if(r.project){ doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(83,114,129); doc.text(T.project, M, y); doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(61,61,61); doc.text(String(r.project+(r.subproject?` · ${r.subproject}`:'')).slice(0,70), M+58, y); y+=20 }
  // ===== Tabla gastos =====
  doc.setTextColor(83,114,129); doc.setFont('helvetica','bold'); doc.setFontSize(8)
  doc.text(T.date, M, y); doc.text(T.concept, M+72, y); doc.text(T.category, cCat, y); doc.text(T.amount, cMonto, y, {align:'right'})
  y+=7; doc.setDrawColor(228,232,235); doc.setLineWidth(1); doc.line(M,y,W-M,y); y+=16
  gastos.forEach(filaG)
  y+=2; doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(M,y,W-M,y); y+=16
  doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(61,61,61); doc.text(T.totalExp, M, y); doc.text(fmtN(totGastos), cMonto, y, {align:'right'}); y+=28
  // ===== Fondos recibidos =====
  ensure(40); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(0,60,80); doc.text(T.fundsSection, M, y); y+=16
  if(fondos.length){ fondos.forEach(f=>{ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtFechaDMY(f.date), M, y); doc.text(String(f.concept||T.received).slice(0,52), M+72, y); doc.setFont('helvetica','bold'); doc.setTextColor(15,110,86); doc.text(fmtN(f.amount), cMonto, y, {align:'right'}); y+=16 }) }
  else { doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(83,114,129); doc.text(T.noFunds, M, y); y+=16 }
  y+=10
  // ===== Resumen del fondo (si hay rendiciones previas) =====
  if(previas&&previas.length){
    const boxH = 36 + (previas.length+2)*15 + 16
    ensure(boxH+10); doc.setFillColor(0,60,80); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setTextColor(153,171,180); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(T.fundSummary, M+16, yy); yy+=17
    const lrow=(lbl,val,neg)=>{ doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(153,171,180); doc.text(lbl, M+16, yy); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.text((neg?'-':'')+fmtN(val), W-M-16, yy, {align:'right'}); yy+=15 }
    lrow(T.received, totFondos)
    previas.forEach(pp=>lrow(`${T.prev} ${pp.fecha?fmtFechaDMY(String(pp.fecha).slice(0,10)):''}`, pp.total, true))
    lrow(T.thisRep, totGastos, true)
    yy+=3; doc.setDrawColor(90,110,125); doc.setLineWidth(0.5); doc.line(M+16,yy-9,W-M-16,yy-9)
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(T.avail, M+16, yy+4); doc.text((saldo<0?'-':'')+fmtN(saldo), W-M-16, yy+4, {align:'right'})
    y += boxH+14
  }
  } else {
    // 2+ proyectos: bloque por proyecto (razón social, gastos, fondos, rendido antes, saldo) + imputación de saldos.
    const L=EN?{proj:'PROJECT',exp:'Project expenses',prev:'Previously reported',fav:'Balance in favor of the project',due:'Balance to cover',imp:'SUMMARY BY PROJECT · BALANCE ALLOCATION',others:'Other funds and previous reports',note:'Balances in favor are applied to the balances to cover',tot:sPos?T.balFavor:T.balPending}:{proj:'PROYECTO',exp:'Gastos del proyecto',prev:'Rendido anteriormente',fav:'Saldo a favor del proyecto',due:'Saldo por cubrir del proyecto',imp:'RESUMEN POR PROYECTO · IMPUTACIÓN DE SALDOS',others:'Otros fondos y rendiciones anteriores',note:'Los saldos a favor se imputan a los saldos por cubrir',tot:sPos?T.balFavor:T.balPending}
    const sgn=v=>(v<0?'-':v>0?'+':'')+fmtN(Math.abs(v))
    grp.grupos.forEach((x,i)=>{
      ensure(80)
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(83,114,129); doc.text(`${L.proj} ${i+1}`, M, y)
      if(x.ent){ doc.setFontSize(8.5); doc.setTextColor(61,61,61); doc.text(String(x.ent.name).slice(0,52), W-M, y, {align:'right'}) }
      y+=13; doc.setFont('helvetica','bold'); doc.setFontSize(11.5); doc.setTextColor(0,60,80); doc.text(String(x.proyecto||'—').slice(0,58), M, y)
      if(x.ent&&x.ent.rut){ doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(83,114,129); doc.text(fmtRutCL(x.ent.rut), W-M, y, {align:'right'}) }
      y+=7; doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(M,y,W-M,y); y+=14
      doc.setTextColor(83,114,129); doc.setFont('helvetica','bold'); doc.setFontSize(8)
      doc.text(T.date, M, y); doc.text(T.concept, M+72, y); doc.text(T.category, cCat, y); doc.text(T.amount, cMonto, y, {align:'right'}); y+=16
      x.gastos.forEach(filaG)
      y+=2; doc.setDrawColor(228,232,235); doc.setLineWidth(0.8); doc.line(M,y,W-M,y); y+=14
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(L.exp, M, y); doc.text(fmtN(x.totGastos), cMonto, y, {align:'right'}); y+=18
      if(x.fondos.length){ ensure(30); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(0,60,80); doc.text(T.fundsSection, M, y); y+=14
        x.fondos.forEach(fo=>{ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(fmtFechaDMY(fo.date), M, y); doc.text(String(fo.concept||T.received).slice(0,52), M+72, y); doc.setFont('helvetica','bold'); doc.setTextColor(15,110,86); doc.text(fmtN(fo.amount), cMonto, y, {align:'right'}); y+=16 }) }
      if(x.previo){ ensure(16); doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(83,114,129); doc.text(L.prev, M, y); doc.text('-'+fmtN(x.previo), cMonto, y, {align:'right'}); y+=16 }
      ensure(26); const neg=x.saldo<0; doc.setFillColor(neg?252:225,neg?235:245,neg?235:238); doc.roundedRect(M,y-4,W-2*M,22,4,4,'F')
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(neg?163:15,neg?45:110,neg?45:86); doc.text(neg?L.due:L.fav, M+10, y+11); doc.text(sgn(x.saldo), W-M-10, y+11, {align:'right'}); y+=36
    })
    const mixto=grp.grupos.some(x=>x.saldo>0)&&grp.grupos.some(x=>x.saldo<0)
    const nL=grp.grupos.length+(Math.round(grp.otros)?1:0)+(mixto?1:0)
    const boxH=36+nL*15+20
    ensure(boxH+10); doc.setFillColor(0,60,80); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setTextColor(153,171,180); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(L.imp, M+16, yy); yy+=17
    const lrow=(lbl,val,muted)=>{ doc.setFont('helvetica',muted?'normal':'bold'); doc.setFontSize(9.5); doc.setTextColor(muted?153:255,muted?171:255,muted?180:255); doc.text(String(lbl).slice(0,62), M+16, yy); if(val) doc.text(val, W-M-16, yy, {align:'right'}); yy+=15 }
    grp.grupos.forEach(x=>lrow(x.proyecto||'—', sgn(x.saldo)))
    if(Math.round(grp.otros)) lrow(L.others, sgn(grp.otros))
    if(mixto) lrow(L.note, '', true)
    yy+=3; doc.setDrawColor(90,110,125); doc.setLineWidth(0.5); doc.line(M+16,yy-9,W-M-16,yy-9)
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(L.tot, M+16, yy+4); doc.text((saldo<0?'-':'')+fmtN(Math.abs(saldo)), W-M-16, yy+4, {align:'right'})
    y += boxH+14
  }
  // ===== Saldo a su cargo (si el cliente debe) =====
  if(saldo<0){
    const rows = EN?[`Account holder: ${BRAND.nombreLegalCorto}`,`Tax ID (RUT): ${fmtRutCL(BRAND.rut)}`,`Bank: ${BRAND.pago.gastos.banco}`,`Checking account: ${BRAND.pago.gastos.cuentaFmt}`,`Confirmation: ${BRAND.pago.gastos.email}`]:[`Titular: ${BRAND.nombreLegalCorto}`,`RUT: ${fmtRutCL(BRAND.rut)}`,`Banco: ${BRAND.pago.gastos.banco}`,`Cuenta Corriente: ${BRAND.pago.gastos.cuentaFmt}`,`Confirmación: ${BRAND.pago.gastos.email}`]
    const boxH = 30 + rows.length*15
    ensure(boxH+10); doc.setFillColor(252,235,235); doc.roundedRect(M,y,W-2*M,boxH,6,6,'F')
    let yy=y+20; doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(`${T.due}: ${fmtN(Math.abs(saldo))}`, M+16, yy); yy+=17
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(83,114,129); rows.forEach(l=>{ doc.text(l, M+16, yy); yy+=15 })
    y += boxH+14
  }
  // ===== Footer =====
  const fy=H-28; doc.setDrawColor(228,232,235); doc.setLineWidth(0.5); doc.line(M,fy-12,W-M,fy-12)
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(83,114,129)
  doc.text(`${BRAND.direccion} · ${BRAND.web}`, M, fy)
  doc.text(T.footer, W-M, fy, {align:'right'})
  return doc.output('datauristring').split(',')[1]
}

// PDF de la liquidación de caja chica (jsPDF) → base64. Agrupado por cliente, mismo estilo que la rendición.
export async function liquidacionPdfBase64({me, periodo, gastos, clients, titulo, resumen, anexo}){
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const doc = new jsPDF({unit:'pt', format:'letter'})
  const W = doc.internal.pageSize.getWidth()
  const _tit = titulo || 'Liquidación de caja chica'
  const total = (gastos||[]).reduce((a,e)=>a+(e.amount||0),0)
  const porCliente = {}
  ;(gastos||[]).forEach(e=>{ const cn=(clients||[]).find(c=>c.id===e.client_id)?.name||'Sin cliente'; (porCliente[cn]=porCliente[cn]||[]).push(e) })
  doc.setFillColor(0,60,80); doc.rect(0,0,W,74,'F')
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16)
  doc.text(_tit, 40, 34)
  doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text(`${me||''} · ${periodo||''}`, 40, 54)
  // Logo del estudio (BRAND, mismo que la rendición al cliente y los correos). Si no carga, cae al nombre en texto.
  let logoOk=false
  try{ const r=await fetch(BRAND.logo.blanco); const bl=await r.blob(); const dataUrl=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(bl) }); const im=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=dataUrl }); const lh=22, lw=im.naturalWidth&&im.naturalHeight?im.naturalWidth/im.naturalHeight*lh:140; doc.addImage(dataUrl,'PNG',W-40-lw,37-lh/2,lw,lh); logoOk=true }catch(_){}
  if(!logoOk){ doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(String(BRAND.nombre||'').toUpperCase(), W-40, 44, {align:'right'}) }
  const bw=(W-80-12)/3, by=86, bh=42
  const kcard=(i,lbl,val)=>{ const x=40+i*(bw+6); doc.setFillColor(245,247,249); doc.roundedRect(x,by,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(153,171,180); doc.text(lbl.toUpperCase(), x+10, by+16); doc.setFontSize(13); doc.setTextColor(61,61,61); doc.text(val, x+10, by+34) }
  kcard(0,'N° de gastos', String((gastos||[]).length))
  kcard(1,'Clientes', String(Object.keys(porCliente).length))
  kcard(2,'Total a rendir', fmtN(total))
  let y=160
  // Segunda fila (estado de la caja): Fondo recibido · Gastado · Saldo / Cubierto — a reembolsar (lo que el miembro puso de su bolsillo).
  if(resumen){
    const by2=by+bh+8
    const k2=(i,lbl,val,rojo)=>{ const x=40+i*(bw+6); doc.setFillColor(rojo?252:245,rojo?235:247,rojo?235:249); doc.roundedRect(x,by2,bw,bh,4,4,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(rojo?163:153,rojo?45:171,rojo?45:180); doc.text(lbl.toUpperCase(), x+10, by2+15); doc.setFontSize(12); doc.setTextColor(rojo?163:0,rojo?45:60,rojo?45:80); doc.text(val, x+10, by2+32) }
    const cub=Math.max(0,-(resumen.saldo||0))
    k2(0,'Fondo recibido', fmtN(resumen.fondo))
    k2(1,'Gastado', fmtN(resumen.gastado))
    if(cub>0) k2(2,`Cubierto por ${String(me||'').split(' ')[0]} — a reembolsar`, fmtN(cub), true); else k2(2,'Saldo de caja', fmtN(resumen.saldo))
    y=by2+bh+32
  }
  Object.entries(porCliente).forEach(([cn,gs])=>{
    const tot=gs.reduce((a,e)=>a+(e.amount||0),0)
    if(y>690){ doc.addPage(); y=60 }
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(0,60,80)
    doc.text(`${String(cn).slice(0,50)} — ${fmtN(tot)}`, 40, y); y+=8
    doc.setDrawColor(0,60,80); doc.setLineWidth(1.2); doc.line(40,y,W-40,y); y+=18
    gs.forEach(e=>{
      if(y>700){ doc.addPage(); y=60 }
      doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61)
      doc.text(fmtFechaDMY(e.date), 40, y)
      doc.text((String(e.concept||'—')+(e.ot_number?` · ${e.ot_number}`:'')).slice(0,52), 130, y)
      doc.setFontSize(8.5); doc.setTextColor(83,114,129)
      doc.text(String(e.category||'Otro').slice(0,20), 130, y+11)
      doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.setTextColor(226,75,74)
      doc.text('-'+fmtN(e.amount), W-40, y, {align:'right'})
      y+=26
    })
    y+=6
  })
  if(y>700){ doc.addPage(); y=60 }
  doc.setDrawColor(83,114,129); doc.setLineWidth(1.5); doc.line(40,y,W-40,y); y+=20
  doc.setTextColor(61,61,61); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('TOTAL LIQUIDACIÓN', 40, y)
  doc.setTextColor(226,75,74); doc.text('-'+fmtN(total), W-40, y, {align:'right'})
  y+=30; doc.setTextColor(61,61,61); doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text('Atentamente,', 40, y); y+=15
  doc.setFont('helvetica','bold'); doc.text(me||'', 40, y); y+=14
  doc.setFont('helvetica','normal'); doc.text(BRAND.nombre, 40, y)
  // Anexo (anexoCajaChica): por categoría, caja chica por mes con su promedio y clientes con más gasto en 6 meses.
  if(anexo&&(anexo.categorias||[]).length){
    doc.addPage(); doc.setFillColor(0,60,80); doc.rect(0,0,W,52,'F'); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(14)
    doc.text(`Anexo · ${me||''}`, 40, 32); let ay=86
    const tabla=(tit,filas,pie)=>{ if(ay>660){ doc.addPage(); ay=60 }
      doc.setFont('helvetica','bold'); doc.setFontSize(10.5); doc.setTextColor(0,60,80); doc.text(tit.toUpperCase(), 40, ay); ay+=7
      doc.setDrawColor(0,60,80); doc.setLineWidth(1); doc.line(40,ay,W-40,ay); ay+=16
      filas.forEach(([a,b,c])=>{ if(ay>720){ doc.addPage(); ay=60 }
        doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(61,61,61); doc.text(String(a).slice(0,56), 40, ay)
        doc.setTextColor(83,114,129); doc.text(String(b), W-170, ay, {align:'right'})
        doc.setFont('helvetica','bold'); doc.setTextColor(61,61,61); doc.text(String(c), W-40, ay, {align:'right'}); ay+=17 })
      if(pie){ doc.setDrawColor(228,232,235); doc.line(40,ay-8,W-40,ay-8); doc.setFont('helvetica','bold'); doc.setTextColor(61,61,61); doc.text(pie[0], 40, ay+4); doc.text(pie[1], W-40, ay+4, {align:'right'}); ay+=20 }
      ay+=14 }
    const g=n=>`${n} gasto${n!==1?'s':''}`
    tabla('Por categoría · esta liquidación', anexo.categorias.map(x=>[x.cat, g(x.n), fmtN(x.total)]))
    tabla('Caja chica por mes', anexo.porMes.map(x=>[x.etiqueta, g(x.n), fmtN(x.total)]), ['Promedio mensual', fmtN(anexo.promedio)])
    if((anexo.clientes||[]).length) tabla('Clientes con más gasto · 6 meses', anexo.clientes.map(x=>[x.name, g(x.n), fmtN(x.total)]))
  }
  return doc.output('datauristring').split(',')[1]
}

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
  }catch(_){}
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
  try{ await aprenderVenta('venta_factura',clave,saleId); if(sugerida&&String(sugerida)!==String(saleId)) await aprenderVenta('venta_factura_no',clave,sugerida) }catch(_){}
  const folio=folioN(f.invoice_no)||f.invoice_no
  const motivo=`Factura N° ${folio} asignada a «${venta||'la venta'}»${ids.length?` · reemplaza ${ids.length} cuota${ids.length!==1?'s':''}`:''}`
  try{ await supabase.from('agente_bandeja').update({estado:'registrado',motivo,resuelto_at:now}).eq('tipo','factura_sin_venta').eq('estado','pendiente').eq('propuesta->>billing_id',String(f.id)) }catch(_){}
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

// Tab "Contacto" de la ficha (reutilizado admin/limited): identificación + datos de
// contacto (edición inline en clients) + personas de contacto (CRUD en tabla contacts)
// Documentos del cliente en Drive (piezas 2+3): vincula la carpeta (auto por nombre, 1:1) y lista/abre sus archivos vía la edge function `drive`.
export function DocumentosDrive({client, onCount, onPick}){
  const [folder,setFolder] = useState(undefined)   // undefined=cargando · null=sin vincular · {id,name}=vinculada (raíz)
  const [path,setPath] = useState([])              // navegación: [{id,name}] desde la raíz
  const [items,setItems] = useState(null)          // contenido del nivel actual (subcarpetas + archivos)
  const FOLDER='application/vnd.google-apps.folder'
  const [busy,setBusy] = useState(false)
  const [err,setErr] = useState(null)
  const [q,setQ] = useState('')
  const [cand,setCand] = useState(null)
  const msg = (e)=>{ const m=e?.message||''; return /No hay conexión|No autorizado|GOOGLE_OAUTH|configurar|Failed to fetch|NetworkError|Error 40|Error 50/i.test(m) ? 'No se pudo conectar con Drive. Si aún no lo activaste: menú ☰ (admin) → “Conectar Drive (permanente)”.' : (m||'No se pudo leer Drive.') }
  const cargarNivel = async(fid, reportar)=>{
    setBusy(true); setErr(null)
    try{
      const data = await driveCall({action:'search', q:`'${fid}' in parents and trashed=false`, pageSize:100})
      const fs=(data.files||[]).slice().sort((a,b)=>{ const af=a.mimeType===FOLDER,bf=b.mimeType===FOLDER; if(af!==bf) return af?-1:1; return (a.name||'').localeCompare(b.name||'') })
      setItems(fs); if(reportar) onCount&&onCount(fs.length)
    }catch(e){ setErr(msg(e)); setItems(null) }
    setBusy(false)
  }
  const entrarRaiz = (f)=>{ setFolder({id:f.id,name:f.name}); setPath([{id:f.id,name:f.name}]); cargarNivel(f.id, true) }
  const entrarSub = (f)=>{ setPath(p=>[...p,{id:f.id,name:f.name}]); cargarNivel(f.id) }
  const irNivel = (i)=>{ const nueva=path.slice(0,i+1); setPath(nueva); cargarNivel(nueva[nueva.length-1].id) }
  const vincular = async(f)=>{
    // Una sola carpeta por cliente: la de la ficha (clients.drive_folder_id), que usan también los agentes; client_drive queda de respaldo.
    try{ await supabase.from('clients').update({drive_folder_id:f.id,updated_at:new Date().toISOString()}).eq('id',client.id) }catch(_){}
    try{ await supabase.from('client_drive').upsert({client_id:String(client.id), folder_id:f.id, folder_name:f.name, updated_at:new Date().toISOString()},{onConflict:'client_id'}) }catch(_){}
    setCand(null); entrarRaiz(f)
  }
  const autoVincular = async()=>{
    setBusy(true); setErr(null)
    try{
      const nm=(client.name||'').replace(/['\\]/g,' ').trim(); if(!nm){ setBusy(false); return }
      const data = await driveCall({action:'search', q:`mimeType='application/vnd.google-apps.folder' and name='${nm}' and trashed=false`, pageSize:5})
      const fs=data.files||[]
      if(fs.length===1) await vincular(fs[0])
      else if(fs.length>1) setCand(fs)
    }catch(e){ setErr(msg(e)) }
    setBusy(false)
  }
  const buscarCarpeta = async()=>{
    if(!q.trim()||busy) return
    setBusy(true); setErr(null)
    try{
      const data = await driveCall({action:'search', q:`mimeType='application/vnd.google-apps.folder' and name contains '${q.replace(/['\\]/g,' ').trim()}' and trashed=false`, pageSize:10})
      setCand(data.files||[])
    }catch(e){ setErr(msg(e)) }
    setBusy(false)
  }
  useEffect(()=>{ let alive=true
    ;(async()=>{
      setFolder(undefined); setItems(null); setPath([]); setErr(null); setCand(null); setQ('')
      try{
        if(client.drive_folder_id){ entrarRaiz({id:client.drive_folder_id,name:client.name}); return }   // carpeta de la ficha (fuente única)
        const {data} = await supabase.from('client_drive').select('folder_id,folder_name').eq('client_id',String(client.id)).maybeSingle()
        if(!alive) return
        if(data&&data.folder_id) entrarRaiz({id:data.folder_id,name:data.folder_name})
        else { setFolder(null); autoVincular() }
      }catch(_){ if(alive) setFolder(null) }
    })()
    return ()=>{ alive=false }
  },[client.id])
  const abrir = (f)=>{ try{ window.open('https://drive.google.com/open?id='+f.id,'_blank','noopener') }catch(_){} }
  const inp={width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px',fontSize:12,color:C.text,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
  return (
    <div>
      {folder&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
        <div style={{fontSize:11,color:C.muted,display:'flex',flexWrap:'wrap',alignItems:'center',gap:3,minWidth:0}}>
          {path.map((p,i)=>(<span key={p.id} style={{display:'inline-flex',alignItems:'center',gap:3}}>
            {i>0&&<span style={{color:C.textSoft}}><Gl n='chevron'/></span>}
            <span onClick={i<path.length-1?()=>irNivel(i):undefined} style={{color:i<path.length-1?C.azulInfo:C.text,fontWeight:i===path.length-1?700:400,cursor:i<path.length-1?'pointer':'default',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</span>
          </span>))}
        </div>
        <button type='button' onClick={()=>{setFolder(null);setItems(null);setPath([]);setCand(null)}} style={{fontSize:10,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0}}>Cambiar</button>
      </div>}
      {busy&&<div style={{fontSize:11,color:C.muted}}>Cargando…</div>}
      {err&&<div style={{fontSize:11,color:C.overdueText,marginBottom:6}}>{err}</div>}
      {folder&&items&&items.length>0&&<div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:280,overflowY:'auto'}}>
        {items.map(f=>{ const esCarpeta=f.mimeType===FOLDER; return (
          <button key={f.id} type='button' onClick={()=>esCarpeta?entrarSub(f):(onPick?onPick(f):abrir(f))} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:esCarpeta?C.bgSoft:'#fff',cursor:'pointer',textAlign:'left'}}>
            <SIcon n={esCarpeta?'building':'file'} s={14} c={esCarpeta?C.muted:C.accent}/>
            <span style={{flex:1,minWidth:0,fontSize:12,color:esCarpeta?C.text:C.accent,fontWeight:esCarpeta?600:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
            <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{esCarpeta?<Gl n='chevron'/>:(f.modifiedTime?fmtFechaDMY(isoLocal(f.modifiedTime)):'')}</span>
          </button>
        )})}
      </div>}
      {folder&&items&&items.length===0&&!busy&&<div style={{fontSize:11,color:C.muted}}>Carpeta vacía.</div>}
      {!folder&&!busy&&cand&&cand.length>0&&<div>
        <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Elige la carpeta de este cliente:</div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>{cand.map(f=>(<button key={f.id} type='button' onClick={()=>vincular(f)} style={{...inp,textAlign:'left',cursor:'pointer',fontWeight:600,color:C.accent}}>{f.name}</button>))}</div>
      </div>}
      {!folder&&!busy&&(!cand||cand.length===0)&&!err&&<div>
        <div style={{fontSize:11,color:C.muted,marginBottom:6}}>No vinculada aún. Busca la carpeta en tu Drive:</div>
        <div style={{display:'flex',gap:6}}>
          <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();buscarCarpeta()}}} placeholder={client.name||'Nombre de la carpeta'} style={inp}/>
          <button type='button' onClick={buscarCarpeta} disabled={busy} style={{fontSize:12,fontWeight:600,color:'#fff',background:C.muted,border:'none',borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Buscar</button>
        </div>
      </div>}
    </div>
  )
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

export function ContactoTab({client, entities, onSaveFields, clientBilling=[], onOpenFinanciero}) {
  const isDesktop = useIsDesktop()   // desktop: formulario a ancho cómodo centrado (no estirado a toda la pantalla)
  const fields = ['rut']
  const fromClient = () => fields.reduce((o,k)=>{o[k]=client[k]||'';return o},{})
  const [form,setForm] = useState(fromClient())
  const [savingF,setSavingF] = useState(false)
  useEffect(()=>{ setForm(fromClient()) },[client.id]) // recargar al cambiar de cliente

  const dirty = fields.some(k=>(form[k]||'')!==(client[k]||''))
  const set = (k,v)=>setForm(f=>({...f,[k]:v}))
  const [sec,setSec] = useState(()=>isDesktop?{id:true,rs:true,personas:true,dest:true}:{})   // móvil: colapsadas; escritorio: abiertas (Drive se abre a pedido: evita una llamada por ficha)
  const tog = k => setSec(s=>({...s,[k]:!s[k]}))
  const [docCount,setDocCount] = useState(null)   // nº de documentos del cliente en Drive (para el resumen de la sección)
  const guardar = async ()=>{
    setSavingF(true)
    try{ await onSaveFields(client.id, form) }catch(e){/* avisado en handler */}
    setSavingF(false)
  }

  // ── Personas de contacto ──
  const [contacts,setContacts] = useState([])
  const [loadingC,setLoadingC] = useState(true)
  const [showAdd,setShowAdd] = useState(false)
  const [edit,setEdit] = useState(null)
  const [cForm,setCForm] = useState({nombre:'',cargo:'',email:'',telefono:''})
  const [savingC,setSavingC] = useState(false)
  useEffect(()=>{
    let alive=true; setLoadingC(true)
    supabase.from('contacts').select('*').eq('client_id',client.id).order('created_at')
      .then(({data,error})=>{ if(alive){ if(!error) setContacts(data||[]); setLoadingC(false) } })
    return ()=>{alive=false}
  },[client.id])
  const resetC = ()=>{ setCForm({nombre:'',cargo:'',email:'',telefono:''}); setShowAdd(false); setEdit(null) }
  const startEdit = (c)=>{ setEdit(c); setCForm({nombre:c.nombre||'',cargo:c.cargo||'',email:c.email||'',telefono:c.telefono||''}); setShowAdd(true) }
  const guardarContacto = async ()=>{
    if(!cForm.nombre.trim()) return
    setSavingC(true)
    try{
      if(edit){
        const {data,error}=await supabase.from('contacts').update({...cForm,nombre:cForm.nombre.trim()}).eq('id',edit.id).select().single()
        if(error)throw error; setContacts(p=>p.map(x=>x.id===data.id?data:x))
      }else{
        const {data,error}=await supabase.from('contacts').insert({client_id:client.id,...cForm,nombre:cForm.nombre.trim()}).select().single()
        if(error)throw error; setContacts(p=>[...p,data])
      }
      resetC()
    }catch(e){appAlert('Error: '+e.message)}
    setSavingC(false)
  }
  const eliminarContacto = async (c)=>{
    if(!await appConfirm(`¿Eliminar a ${c.nombre}?`)) return
    const {error}=await supabase.from('contacts').delete().eq('id',c.id)
    if(error){appAlert('Error: '+error.message);return}
    setContacts(p=>p.filter(x=>x.id!==c.id))
  }
  const togglePrincipal = async (c)=>{ const nv=!c.principal; setContacts(p=>p.map(x=>x.id===c.id?{...x,principal:nv}:x)); const {error}=await supabase.from('contacts').update({principal:nv}).eq('id',c.id); if(error){appAlert('Error: '+error.message); setContacts(p=>p.map(x=>x.id===c.id?{...x,principal:!nv}:x))} }
  const initials = (n)=> (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()

  const inp = {width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const lbl = {fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,marginBottom:4,display:'block'}
  const card = {marginBottom:16,padding:'14px 16px',borderRadius:12,background:C.card,border:`1px solid ${C.border}`}
  const sTitle = (t)=>(<div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:10}}>{t}</div>)
  // función (no componente) para no remontar el input y perder el foco al tipear
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )

  const _card = kids => <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{kids}</div>
  const sId = (
        <IconSection icon='id' title='Identificación' summary={client.rut||'sin RUT'} open={sec.id} onToggle={()=>tog('id')}>
          <div style={{display:'grid',gap:10,paddingTop:4}}>
            <div>
              <label style={lbl}>Nombre cliente</label>
              <input value={client.name||'—'} disabled style={{...inp,background:C.bgSoft,color:C.muted}}/>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>Para cambiarlo, usa "Editar".</div>
            </div>
            {field('RUT','rut','12.345.678-9')}
          </div>
          {dirty&&(
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button onClick={()=>setForm(fromClient())} disabled={savingF} style={{flex:1,padding:'9px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Descartar</button>
              <button onClick={guardar} disabled={savingF} style={{flex:2,padding:'9px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:savingF?.6:1}}>{savingF?'Guardando...':'Guardar cambios'}</button>
            </div>
          )}
        </IconSection>
  )
  const sRs = (entities&&entities.length>0&&(
          <IconSection icon='building' title='Razones sociales facturadas' summary={entities.length} open={sec.rs} onToggle={()=>tog('rs')}>
            <div style={{paddingTop:4}}>
              {entities.map(e=>{
                const nFac=(clientBilling||[]).filter(b=>!b.deleted_at&&b.invoice_no&&(String(b.entity_id)===String(e.id)||(e.rut&&crNormRut(b.receptor_rut||'')===crNormRut(e.rut)))).length
                return (
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`0.5px solid ${C.bgWarm}`}}>
                  <span onClick={onOpenFinanciero?()=>onOpenFinanciero():undefined} title={onOpenFinanciero?'Ver sus facturas en Financiero':undefined} style={{fontSize:12,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenFinanciero?'pointer':'inherit'}}>{rsDisplay(e.name)||'—'}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    {nFac>0&&onOpenFinanciero&&<span onClick={()=>onOpenFinanciero()} style={{fontSize:10,fontWeight:700,color:C.accent,background:C.azulBg,borderRadius:20,padding:'2px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>{nFac} factura{nFac!==1?'s':''} →</span>}
                    <Copyable text={e.rut} title='Copiar RUT'><span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{fmtRutCL(e.rut)}</span></Copyable>
                  </div>
                </div>
              )})}
            </div>
          </IconSection>
        ))
  const sPer = (
        <IconSection icon='users' title='Personas de contacto' summary={loadingC?'…':(contacts.length||'—')} open={sec.personas} onToggle={()=>tog('personas')}>
          <div style={{paddingTop:4}}>
            {!showAdd&&<button onClick={()=>{setEdit(null);setCForm({nombre:'',cargo:'',email:'',telefono:''});setShowAdd(true)}} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:6}}>+ Agregar</button>}
            {loadingC&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Cargando...</div>}
            {!loadingC&&contacts.length===0&&!showAdd&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Sin contactos.</div>}
            {[...contacts].sort((a,b)=>(b.principal?1:0)-(a.principal?1:0)).map(c=>(
              <div key={c.id} style={{display:'flex',gap:10,alignItems:'center',padding:'9px 0',borderBottom:`0.5px solid ${C.bgWarm}`}}>
                <button onClick={()=>togglePrincipal(c)} title={c.principal?'Principal':'Marcar principal'} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,lineHeight:1,color:c.principal?C.soon:'#CBD5DB',flexShrink:0,padding:0}}>{c.principal?'★':'☆'}</button>
                <div style={{width:34,height:34,borderRadius:'50%',background:C.azulBg,color:C.accent,fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{initials(c.nombre)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.nombre}{c.principal&&<span style={{fontSize:9,fontWeight:700,color:C.soonText,background:C.soonBg,padding:'1px 7px',borderRadius:20,marginLeft:5,textTransform:'uppercase',letterSpacing:.3}}>Principal</span>}{c.cargo&&<span style={{fontSize:11,fontWeight:400,color:C.muted}}> · {c.cargo}</span>}</div>
                  <div style={{fontSize:11,color:C.muted,display:'flex',gap:8,flexWrap:'wrap'}}>
                    {c.email&&<a href={`mailto:${c.email}`} style={{color:C.accent,textDecoration:'none'}}>{c.email}</a>}
                    {c.telefono&&<Copyable text={c.telefono} title='Copiar teléfono'>{c.telefono}</Copyable>}
                  </div>
                </div>
                <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,padding:4}}>Editar</button>
                <button onClick={()=>eliminarContacto(c)} style={{background:'none',border:'none',color:C.overdue,cursor:'pointer',fontSize:13,padding:4}}>Eliminar</button>
              </div>
            ))}
            {showAdd&&(
              <div style={{marginTop:10,padding:'12px',borderRadius:10,background:C.bgSoft,border:`1px solid ${C.border}`}}>
                <div style={{display:'grid',gap:8}}>
                  <input autoFocus value={cForm.nombre} onChange={e=>setCForm(f=>({...f,nombre:e.target.value}))} placeholder="Nombre *" style={inp}/>
                  <input value={cForm.cargo} onChange={e=>setCForm(f=>({...f,cargo:e.target.value}))} placeholder="Cargo" style={inp}/>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <input value={cForm.email} onChange={e=>setCForm(f=>({...f,email:e.target.value}))} placeholder="Email" style={inp}/>
                    <input value={cForm.telefono} onChange={e=>setCForm(f=>({...f,telefono:e.target.value}))} placeholder="Teléfono" style={inp}/>
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:2}}>
                    <button onClick={resetC} disabled={savingC} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                    <button onClick={guardarContacto} disabled={savingC||!cForm.nombre.trim()} style={{flex:2,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',opacity:(savingC||!cForm.nombre.trim())?.6:1}}>{savingC?'Guardando...':(edit?'Guardar':'Agregar')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </IconSection>
  )
  const sDest = (
        <IconSection icon='mail' title='Destinatario de facturas' summary={(()=>{const p=contacts.find(c=>c.principal)||contacts[0];return p?(p.nombre||'').split(/\s+/)[0]:'—'})()} open={sec.dest} onToggle={()=>tog('dest')}>
          <DestinatarioFacturasCard client={client} contacts={contacts} embedded/>
        </IconSection>
  )
  const sDocs = (
        <IconSection icon='file' title='Documentos (Drive)' summary={docCount==null?null:docCount} open={sec.docs} onToggle={()=>tog('docs')} last>
          <DocumentosDrive client={client} onCount={setDocCount}/>
        </IconSection>
  )
  // Escritorio: dos columnas con las secciones abiertas (aprovecha el ancho). Móvil: una tarjeta en acordeón (igual que antes).
  return (
    <div style={{padding:'16px 20px 60px',maxWidth:isDesktop?1100:undefined,margin:isDesktop?'0 auto':undefined,...(isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}:{})}}>
      {isDesktop ? <>{_card(<>{sId}{sRs}{sDest}</>)}{_card(<>{sPer}{sDocs}</>)}</> : _card(<>{sId}{sRs}{sPer}{sDest}{sDocs}</>)}
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
  const saveTo=async v=>{ setTo(v); if(!client?.id) return; try{ if(v.trim()) await setLearningKV('factura_to',String(client.id),v.trim()); else await supabase.from('learnings').delete().eq('kind','factura_to').eq('key',String(client.id)); flash() }catch(_){} }
  const saveCc=async arr=>{ setCc(arr); if(!client?.id) return; try{ if(arr.length) await setLearningKV('factura_cc',String(client.id),arr.join(',')); else await supabase.from('learnings').delete().eq('kind','factura_cc').eq('key',String(client.id)); flash() }catch(_){} }
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

// Pestaña "Estado de cuenta" (ex Documentos): vista unificada y trazable del cliente. Lee conciliacion +
// cartola_movimientos para el sello "verificado en banco" y enlazar cada pago con su movimiento bancario.
export function EstadoCuentaTab({client, clientBilling=[], sales=[], anticipos=[], expenses=[], tasks=[], clientEntities=[], onEditExpense, onEditBilling, onOpenSale, onOpenConciliacion, onAjuste, onRendicion, onAsociarTrabajo}){
  const isDesktop = useIsDesktop()   // desktop: ancho acotado y centrado (no estirado a toda la pantalla)
  const aprVenta = useAprendidosVenta(), iaVenta = useIaVenta()
  const [sec,setSec]=useState({})   // secciones-icono (Honorarios/Fondos/Movimientos/Anticipos), colapsadas por defecto
  const secT=k=>setSec(s=>({...s,[k]:!s[k]}))
  const [conc,setConc]=useState([]); const [movs,setMovs]=useState([]); const [loading,setLoading]=useState(true)
  const [det,setDet]=useState(null); const [detG,setDetG]=useState(null)
  const [ord,setOrd]=useState('fecha')
  const [openRS,setOpenRS]=useState({})   // razones sociales desplegadas (por defecto plegadas)
  const [ultAsig,setUltAsig]=useState(null)   // último proyecto/RS asignado: {ids, n, undo} — "deshacer" en línea
  const asignar = onAsociarTrabajo ? async(lote,...r)=>{ const undo=await onAsociarTrabajo(lote,...r); if(undo) setUltAsig({ids:new Set(lote.map(x=>x.id)), n:lote.length, monto:lote.reduce((a,x)=>a+Math.abs(x.amount||0),0), undo}) } : null
  const deshacerAsig = async()=>{ const u=ultAsig; setUltAsig(null); if(u) await u.undo() }
  const [openProy,setOpenProy]=useState(null)  // proyecto/grupo "Por proyecto" desplegado (key o '_')
  const [porProyOpen,setPorProyOpen]=useState(false)   // el bloque "Por proyecto" arranca oculto
  const [openGrp,setOpenGrp]=useState({Activas:true})  // grupos de estado: Activas visible, Terminadas/Otras plegadas
  const [movOrd,setMovOrd]=useState('desc')    // orden por fecha en Movimientos: 'desc' | 'asc'
  const [fgOrd,setFgOrd]=useState('desc')      // orden por fecha en Fondos y gastos: 'desc' | 'asc'
  const [fgSinPR,setFgSinPR]=useState(false)   // filtro "Sin proyecto o RS"
  const [corrG,setCorrG]=useState(null)        // gasto cuyo proyecto/RS se está corrigiendo: {id, sale, ent}
  const [detMov,setDetMov]=useState(null)      // movimiento con detalle expandido en Movimientos
  const [movF,setMovF]=useState('todos')       // filtro Movimientos: todos|abonos|cargos|sin
  const _MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const mesAA=iso=>{const dp=String(iso||'').slice(0,10).split('-');return dp.length>=3?`${_MES[parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''}
  const dCol=iso=>{const dp=String(iso||'').slice(0,10).split('-');return {dia:dp.length>=3?dp[2]:'—',sub:dp.length>=3?`${_MES[parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''}}
  useEffect(()=>{ let ok=true; setLoading(true); (async()=>{
    const [a,b]=await Promise.all([
      selectAll(()=>supabase.from('conciliacion').select('*').order('id')),
      supabase.from('cartola_movimientos').select('id,fecha,monto,n_operacion,rol_cuenta,tipo,es_interno,categoria,descripcion').eq('cliente_id',client.id),
    ])
    if(ok){ setConc(a.data||[]); setMovs(b.data||[]); setLoading(false) }
  })(); return ()=>{ok=false} },[client.id])
  const ventaById=useMemo(()=>{const m={};sales.forEach(s=>m[s.id]=s);return m},[sales])
  const concByFac=useMemo(()=>{const m={};conc.forEach(c=>{if(c.factura_id)m[c.factura_id]=c});return m},[conc])
  const aplicadoByFac=useMemo(()=>{const m={};conc.forEach(c=>{if(c.factura_id&&c.tipo_destino==='factura')m[c.factura_id]=(m[c.factura_id]||0)+(c.monto_aplicado||0)});return m},[conc])
  const cartolaHastaEC=useMemo(()=>{let mx='';for(const x of movs){const f=String(x.fecha||'').slice(0,10);if(f>mx)mx=f}return mx||null},[movs])
  const movById=useMemo(()=>{const m={};movs.forEach(x=>m[x.id]=x);return m},[movs])
  const facturas=useMemo(()=>clientBilling.filter(b=>!b.deleted_at&&b.status!=='Anulada'&&b.billing_type!=='reembolso'&&b.status!=='Programada'),[clientBilling])
  const facturado=facturas.reduce((s,b)=>s+montoFactura(b),0)   // autoridad DTE
  const pagadoTot=facturas.reduce((s,b)=>s+cobradoBill(b),0)   // incluye parciales (banco o paid_amount); fuente única, coincide con Financiero/Resumen
  const porCobrar=porCobrarBills(clientBilling)
  const fg=fgCliente(expenses,client.id)
  const aFavor=(anticipos||[]).filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
  const hoy=new Date();hoy.setHours(0,0,0,0)
  const aging=due=>{if(!due)return null;const d=Math.round((new Date(due+'T12:00')-hoy)/86400000);if(d<0)return{t:`vencida ${-d}d`,c:C.overdueText};if(d<=7)return{t:`vence ${d}d`,c:C.soon};return{t:'al día',c:C.greenText}}
  const grupos=useMemo(()=>{const g={};facturas.forEach(b=>{const rs=b.receptor_name||client.name||'—';(g[rs]=g[rs]||[]).push(b)})
    const cmp=ord==='monto'?(x,y)=>(y.amount||0)-(x.amount||0):ord==='proyecto'?(x,y)=>((ventaById[x.sale_id]?.title||x.concept||'zzz')).localeCompare(ventaById[y.sale_id]?.title||y.concept||'zzz')||((x.issued_at||'')<(y.issued_at||'')?1:-1):(x,y)=>(x.issued_at||'')<(y.issued_at||'')?1:-1
    Object.values(g).forEach(a=>a.sort(cmp));return g},[facturas,ord,ventaById])
  const porProy=useMemo(()=>{const p={};facturas.forEach(b=>{const v=ventaById[b.sale_id];const k=b.sale_id||'_';const o=p[k]||(p[k]={key:k,sale_id:b.sale_id||null,venta:v||null,titulo:v?.title||'Sin proyecto',area:v?.area||'',year:v?.year||null,status:v?.status||null,fact:0,pag:0,facs:[]});o.fact+=montoFactura(b);o.pag+=cobradoBill(b);o.facs.push(b)});Object.values(p).forEach(o=>o.facs.sort((x,y)=>(x.issued_at||'')<(y.issued_at||'')?1:-1));return Object.values(p)},[facturas,ventaById])
  const kpi=(label,val,sub,col,corner)=>(<div style={{background:C.bgSoft,borderRadius:8,padding:'8px 9px',position:'relative'}}>{corner}<div style={{...SEC_LBL}}>{label}</div><div style={{fontSize:13,fontWeight:600,color:col}}>{fmt(val)}</div><div style={{fontSize:9,color:C.textSoft,lineHeight:1.3}}>{sub}</div></div>)
  const Hdr=({icon,title,purpose,summary,sumCol,k})=>(<div onClick={()=>secT(k)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 13px',cursor:'pointer',borderBottom:`0.5px solid ${C.bgWarm}`,background:sec[k]?C.bgPanel:'transparent'}}><SIcon n={icon} s={18} c={C.muted}/><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{title}</div>{purpose&&<div style={{fontSize:10,color:C.muted,fontWeight:500,marginTop:1}}>{purpose}</div>}</div>{summary!=null&&<span style={{fontSize:11,color:sumCol||C.muted,fontWeight:sumCol&&sumCol!==C.muted?700:400,whiteSpace:'nowrap'}}>{summary}</span>}<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:sec[k]?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg></div>)
  return (<div style={{padding:'14px 20px 40px',maxWidth:isDesktop?900:undefined,margin:isDesktop?'0 auto':undefined}}>
    {/* Banda accionable: lo único que de verdad importa en una cuenta donde casi solo entra plata — lo que falta conciliar */}
    {(()=>{ const movBase=movs.filter(m=>!m.es_interno); const sinC=movBase.filter(m=>!conc.find(x=>x.movimiento_id===m.id)); if(!sinC.length) return null; const tot=sinC.reduce((s,m)=>s+(m.monto||0),0); return (
      <div onClick={()=>{ if(!sec.movs)secT('movs'); setMovF('sin') }} style={{display:'flex',alignItems:'center',gap:10,background:C.ambarBg,border:'0.5px solid #EFD9A8',borderRadius:12,padding:'10px 12px',marginBottom:12,cursor:'pointer'}}>
        <SIcon n='alert' s={17} c={C.soonText}/>
        <span style={{flex:1,fontSize:12,fontWeight:700,color:C.soonText}}>{sinC.length} movimiento{sinC.length!==1?'s':''} sin conciliar</span>
        <span style={{fontSize:13,fontWeight:700,color:C.soonText}}>{fmt(tot)}</span>
        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.soon} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M9 6l6 6-6 6'/></svg>
      </div>
    )})()}
    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
    {loading&&<div style={{fontSize:11,color:C.muted,padding:'10px 12px'}}>Cargando…</div>}
    <div style={{...SEC_LBL,padding:'11px 13px 6px'}}>General · la cartola</div>
    {Hdr({icon:'exchange',title:'Movimientos bancarios',k:'movs',summary:`${movs.filter(m=>!m.es_interno).length} mov`})}
    {sec.movs&&(()=>{ const base=movs.filter(m=>!m.es_interno)
      const totAb=base.filter(m=>m.tipo==='abono').reduce((s,m)=>s+(m.monto||0),0); const totCa=base.filter(m=>m.tipo==='cargo').reduce((s,m)=>s+(m.monto||0),0)
      const sinN=base.filter(m=>!conc.find(x=>x.movimiento_id===m.id)).length
      let lista=base; if(movF==='abonos')lista=lista.filter(m=>m.tipo==='abono'); else if(movF==='cargos')lista=lista.filter(m=>m.tipo==='cargo'); else if(movF==='sin')lista=lista.filter(m=>!conc.find(x=>x.movimiento_id===m.id))
      lista=lista.slice().sort((a,b)=>{ const r=(a.fecha||'')<(b.fecha||'')?1:-1; return movOrd==='desc'?r:-r })
      const chip=(v,l,n,dgr)=>(<span key={v} onClick={()=>setMovF(v)} style={{fontSize:10,padding:'3px 9px',borderRadius:20,cursor:'pointer',whiteSpace:'nowrap',...(movF===v?{background:dgr?C.overdueText:C.accent,color:'#fff',fontWeight:600,border:'1px solid transparent'}:{border:`1px solid ${dgr?'#F7C1C1':C.border}`,color:dgr?C.overdueText:C.muted})}}>{l}{n!=null?` ${n}`:''}</span>)
      return (<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
        <div><div style={{fontSize:13,fontWeight:600,color:C.accent}}>Movimientos bancarios</div><div style={{fontSize:10,color:C.textSoft}}>{base.length} mov · <span style={{color:C.greenText}}>+{fmt(totAb)}</span>{totCa>0?<> · <span style={{color:C.overdueText}}>−{fmt(totCa)}</span></>:''}</div></div>
        <button onClick={()=>setMovOrd(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Fecha {movOrd==='desc'?'↓':'↑'}</button>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>{chip('todos','Todos',base.length)}{chip('abonos','Abonos')}{chip('cargos','Cargos')}{sinN>0&&chip('sin','Sin conciliar',sinN,true)}</div>
      {lista.length===0&&<div style={{fontSize:11,color:C.muted}}>Sin movimientos.</div>}
      {lista.map(m=>{ const c=conc.find(x=>x.movimiento_id===m.id); const open=detMov===m.id; const dest=c?(c.tipo_destino==='fondo'?'→ Fondo':c.tipo_destino==='anticipo'?'→ Anticipo':c.tipo_destino==='gasto'?(m.tipo==='cargo'?'→ Gasto por cuenta del cliente':'→ Reembolso gastos'):(()=>{const f=clientBilling.find(b=>b.id===c.factura_id);return f?`→ Factura N° ${folioN(f.invoice_no)||'—'}`:'→ por resolver · re-conciliar'})()):'sin conciliar'; const d=dCol(m.fecha); const cta=m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'; return (
        <div key={m.id}>
          <div onClick={()=>setDetMov(open?null:m.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:open?'none':'1px solid #F1F1F1',cursor:'pointer'}}>
            <div style={{width:44,flexShrink:0,textAlign:'center',lineHeight:1.1}}><div style={{fontSize:13,fontWeight:600,color:C.accent}}>{d.dia}</div><div style={{fontSize:9,color:C.textSoft}}>{d.sub}</div></div>
            <div style={{flex:1,minWidth:0}}><div style={{marginBottom:2}}><span style={{fontSize:9.5,fontWeight:700,background:m.rol_cuenta==='gastos'?C.ambarBg:C.azulBg,color:m.rol_cuenta==='gastos'?C.soonText:C.accent,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{m.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'}</span></div><div style={{fontSize:11,color:c?C.muted:C.soon,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dest}</div></div>
            <b style={{color:m.tipo==='abono'?C.greenText:C.overdueText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{m.tipo==='abono'?'+':'−'}{fmt(m.monto)}</b>
            <span style={{color:C.textSoft,fontSize:16,lineHeight:1,flexShrink:0,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </div>
          {open&&<div style={{padding:'8px 10px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.7,margin:'0 0 6px'}}>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Cuenta: <b style={{color:C.text}}>{cta}</b></span><span>Tipo: <b style={{color:C.text}}>{m.tipo==='abono'?'Abono':'Cargo'}</b></span>{m.n_operacion&&<span>N° op.: <b style={{color:C.text}}>{m.n_operacion}</b></span>}</div>
            {m.descripcion&&<div>Glosa: <b style={{color:C.text}}>{m.descripcion}</b></div>}
            <div style={{marginTop:4,paddingTop:4,borderTop:`1px solid #E4E8EB`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><span style={{color:c?C.text:C.soon}}>{c?<>{dest} <span style={{color:C.greenText,fontWeight:600}}><Gl n='tick'/> conciliado</span></>:'sin conciliar'}</span>{onOpenConciliacion&&<span onClick={(ev)=>{ev.stopPropagation();onOpenConciliacion(m.id)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>ver en Conciliación ↗</span>}</div>
          </div>}
        </div>) })}
    </div>) })()}
    <div style={{fontSize:9,color:C.textSoft,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',padding:'13px 13px 6px',borderTop:`0.5px solid ${C.bgWarm}`}}>Específico · por categoría de pago</div>
    {Hdr({icon:'file',title:'Honorarios',k:'honorarios',summary:`${facturas.length} factura${facturas.length!==1?'s':''}`})}
    {sec.honorarios&&<div style={{padding:'2px 13px 12px'}}>
      {porProy.length>0&&(()=>{
        const tile=p=>{ const open=openProy===p.key; const falta=(p.fact||0)-(p.pag||0); return (
          <div key={p.key}>
            <div onClick={()=>setOpenProy(open?null:p.key)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:`1px solid #F1F1F1`,cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.titulo}</div><div style={{display:'flex',gap:6,alignItems:'center',marginTop:2}}>{p.area&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:p.area==='Corporativo'?C.azulBg:C.bgWarm,color:p.area==='Corporativo'?C.accent:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{p.area}</span>}<span style={{fontSize:10,color:C.textSoft}}>{p.year?`${p.year} · `:''}{p.facs.length} factura{p.facs.length!==1?'s':''}</span></div></div>
              <div style={{textAlign:'right',whiteSpace:'nowrap'}}><div style={{fontSize:13,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{fmt(p.fact)}</div><div style={{fontSize:10,color:falta>0?C.overdue:C.greenText}}>{falta>0?`falta ${fmt(falta)}`:'pagado'}</div></div>
              <span style={{color:C.textSoft,fontSize:16,lineHeight:1,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            </div>
            {open&&<div style={{padding:'2px 0 6px'}}>{p.facs.map(b=>{ const pagada=b.status==='Pagado'; return (
              <div key={b.id} onClick={()=>onOpenSale&&p.venta&&onOpenSale(p.venta)} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0 4px 12px',fontSize:11,cursor:onOpenSale&&p.venta?'pointer':'default'}}>
                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||'—'} <span style={{color:C.textSoft}}>· {mesAA(b.issued_at)}</span></span>
                {(()=>{ const e=estadoFacturaLabel(b,aplicadoByFac[b.id]||0,cartolaHastaEC); return <span style={{fontSize:9,fontWeight:600,color:(e&&e.fg)||C.soon}}>{(e&&e.short)||(pagada?'Pagada':'pend.')}</span> })()}
                <span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',textAlign:'right',minWidth:84}}>{fmt(b.amount)}</span>
              </div>) })}</div>}
          </div>) }
        const grpA=porProy.filter(p=>p.sale_id&&p.status==='Activo'); const grpT=porProy.filter(p=>p.sale_id&&p.status&&p.status!=='Activo'); const grpO=porProy.filter(p=>p.sale_id&&!p.status); const sinP=porProy.find(p=>!p.sale_id)
        const grupos2=[['Activas',grpA],['Terminadas',grpT],['Otras',grpO]].filter(([_,it])=>it.length)
        const totFact=porProy.reduce((s,p)=>s+(p.fact||0),0); const totPend=porProy.reduce((s,p)=>s+((p.fact||0)-(p.pag||0)),0)
        return (<div style={{background:C.bgPanel,border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 11px 8px',marginBottom:10}}>
          <div onClick={()=>setPorProyOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',cursor:'pointer'}}>
            <span style={{fontSize:14,color:C.textSoft,lineHeight:1,transform:porProyOpen?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            <span style={{flex:1,fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>Por proyecto</span>
            <span style={{fontSize:10,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(totFact)}{totPend>0?<span style={{color:C.accent}}> · por cobrar {fmt(totPend)}</span>:''}</span>
          </div>
          {porProyOpen&&<>
          {grupos2.map(([label,items])=>{ const go=!!openGrp[label]; return (<div key={label} style={{marginBottom:2}}>
            <div onClick={()=>setOpenGrp(p=>({...p,[label]:!p[label]}))} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}><span style={{fontSize:12,color:C.textSoft,lineHeight:1,transform:go?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span><span style={{flex:1,fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3}}>{label}</span><span style={{fontSize:10,color:C.textSoft,fontVariantNumeric:'tabular-nums'}}>{items.length} · {fmt(items.reduce((s,p)=>s+p.fact,0))}</span></div>
            {go&&items.map(tile)}
          </div>) })}
          {sinP&&(()=>{ const open=openProy==='_'; return (<div style={{borderTop:`1px solid ${C.border}`,marginTop:4}}>
            <div onClick={()=>setOpenProy(open?null:'_')} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0 8px',cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:500,color:C.overdueText}}>Sin proyecto</div><div style={{fontSize:10,color:C.textSoft,marginTop:2}}>{sinP.facs.length} factura{sinP.facs.length!==1?'s':''} · toca para asignar proyecto</div></div>
              <div style={{fontSize:13,fontWeight:600,textAlign:'right',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(sinP.fact)}</div>
            </div>
            {open&&<div style={{padding:'2px 0 6px'}}>{sinP.facs.map(b=>(
              <div key={b.id} onClick={()=>onEditBilling&&onEditBilling(b)} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0 5px 12px',fontSize:11,cursor:onEditBilling?'pointer':'default',borderBottom:`1px solid #F1F1F1`}}>
                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||'—'} <span style={{color:C.textSoft}}>· {mesAA(b.issued_at)}</span>{onEditBilling&&<span style={{color:C.azulInfo,fontWeight:600}}> · asignar venta</span>}</span>
                <span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',textAlign:'right',minWidth:84}}>{fmt(b.amount)}</span>
              </div>))}</div>}
          </div>) })()}
          </>}
        </div>) })()}
      <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:9,fontSize:11,color:C.muted}}>
        <span>Ordenar</span>
        {[['fecha','Fecha'],['proyecto','Proyecto'],['monto','Monto']].map(([v,l])=>(
          <span key={v} onClick={()=>setOrd(v)} style={{padding:'3px 9px',borderRadius:8,border:`1px solid ${ord===v?C.accent:C.border}`,color:ord===v?C.accent:C.muted,fontWeight:ord===v?600:400,cursor:'pointer'}}>{l}</span>
        ))}
      </div>
      {Object.keys(grupos).length===0&&<div style={{fontSize:11,color:C.muted}}>Sin facturas.</div>}
      {Object.entries(grupos).map(([rs,fs])=>{ const abierta=!!openRS[rs]; const rut=(fs.find(b=>b.receptor_rut)||{}).receptor_rut||(clientEntities.find(en=>en.name===rs)||{}).rut||''; const pend=porCobrarBills(fs); return (<div key={rs} style={{marginBottom:8}}>
        <div onClick={()=>setOpenRS(p=>({...p,[rs]:!p[rs]}))} style={{display:'flex',alignItems:'center',gap:8,borderBottom:`1px solid ${C.border}`,paddingBottom:4,marginBottom:1,cursor:'pointer'}}>
          <span style={{fontSize:14,color:C.textSoft,lineHeight:1,transform:abierta?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rs}{rut?<span style={{color:C.textSoft,fontWeight:600}}> · {rut}</span>:''}</div></div>
          <span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap'}}>{fs.length} fact.{pend>0?<span style={{color:C.overdue}}> · por cobrar {fmt(pend)}</span>:''}</span>
        </div>
        {abierta&&fs.map(b=>{ const open=det===b.id; const pagada=b.status==='Pagado'; const ag=!pagada?aging(b.due):null; const c=concByFac[b.id]; const mv=c?movById[c.movimiento_id]:null; const v=ventaById[b.sale_id]
          const dp=String(b.issued_at||'').slice(0,10).split('-'); const dia=dp.length>=3?dp[2]:'—'; const sub=dp.length>=3?`${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][parseInt(dp[1])-1]||''} ${dp[0].slice(2)}`:''
          const estB=pagada?estadoFacturaLabel(b,aplicadoByFac[b.id]||0,cartolaHastaEC):null; const eCol=pagada?((estB&&estB.fg)||C.greenText):(ag?ag.c:C.soon); const eBg=pagada?((estB&&estB.bg)||C.greenBg):(eCol===C.overdueText?C.overdueBg:eCol===C.greenText?C.greenBg:C.azulBg); return (
          <div key={b.id}>
            <div onClick={()=>setDet(open?null:b.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',cursor:'pointer',borderBottom:open?'none':`1px solid ${C.border}`}}>
              {diaGrande(b.issued_at)}
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b>Factura N° {folioN(b.invoice_no)||'—'}</b> <span style={{color:C.muted}}>· {b.concept||'—'}</span></div><div style={{marginTop:3}}><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:eBg,color:eCol,whiteSpace:'nowrap'}}>{pagada?((estB&&estB.short)||'Pagada'):(ag?ag.t:'pendiente')}</span></div></div>
              <div style={{fontSize:13,fontWeight:600,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount)}</div>
            </div>
            {open&&<div style={{padding:'7px 9px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.6,margin:'2px 0 5px'}}>
              <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Tipo: <b style={{color:C.text}}>{b.billing_type||'honorarios'}</b></span><span>Emisión: <b style={{color:C.text}}>{fmtFechaDMY(b.issued_at)}</b></span>{b.due&&<span>Vence: <b style={{color:C.text}}>{fmtFechaDMY(b.due)}</b></span>}</div>
              <div>Monto: <b style={{color:C.text}}>{fmt(montoFactura(b))}</b> · {pagada?((estB&&estB.label)||'Pagada'):`Saldo ${fmt(saldoBill(b))}`}</div>
              {v&&<div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Venta / proyecto</span>{onOpenSale&&<span onClick={(ev)=>{ev.stopPropagation();onOpenSale(v)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver venta ↗</span>}</div><div onClick={onOpenSale?(ev)=>{ev.stopPropagation();onOpenSale(v)}:undefined} style={{color:C.text,cursor:onOpenSale?'pointer':'default'}}><b>{v.title}</b>{v.area?` · ${v.area}`:''}{v.responsible?` · ${v.responsible}`:''}{v.status?` · ${v.status}`:''}</div></div>}
              {pagada&&<div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Pago</span>{c&&onOpenConciliacion&&<span onClick={(ev)=>{ev.stopPropagation();onOpenConciliacion(c.movimiento_id)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver movimiento ↗</span>}</div>
                {c?<div onClick={onOpenConciliacion?(ev)=>{ev.stopPropagation();onOpenConciliacion(c.movimiento_id)}:undefined} style={{color:C.text,cursor:onOpenConciliacion?'pointer':'default'}}>Transferencia <b>{fmt(c.monto_aplicado)}</b>{mv?` · ${fmtFechaDMY(mv.fecha)} · ${mv.rol_cuenta==='gastos'?'Cta. Gastos':'Cta. Honorarios'}${mv.n_operacion?` · N° op. ${mv.n_operacion}`:''}`:''} <span style={{color:C.greenText,fontWeight:600}}><Gl n='tick'/> verificado en banco</span></div>
                  :<div style={{color:C.soon}}>Marcada pagada a mano — sin movimiento bancario enlazado</div>}
              </div>}
            </div>}
          </div>) })}
      </div>) })}
    </div>}
    {Hdr({icon:'wallet',title:'Fondos y gastos',k:'fondos',summary:`saldo ${fmtSaldoG(fg.saldo)}`,sumCol:fg.saldo<0?C.overdue:C.normal})}
    {sec.fondos&&(()=>{ const _sf=(a,b)=>{ const r=(a.date||'')<(b.date||'')?1:-1; return fgOrd==='desc'?r:-r }; const fondos=expenses.filter(e=>e.client_id===client.id&&e.type==='fondo').sort(_sf); const gastos=expenses.filter(e=>e.client_id===client.id&&e.type==='gasto').sort(_sf)
      const faltaPR = e => !e.no_descuenta_saldo && e.category!=='Apertura' && cuentaEnSaldo(e) && (!e.sale_id || (!e.entity_id && (clientEntities||[]).length>0))
      const nPR = onAsociarTrabajo ? [...fondos,...gastos].filter(faltaPR).length : 0
      const fondosV = fgSinPR ? fondos.filter(faltaPR) : fondos, gastosV = fgSinPR ? gastos.filter(faltaPR) : gastos
      const fila=(e,signo,col)=>{ const open=detG===e.id; const v=ventaById[e.sale_id]; const isDev=signo>0&&((e.amount||0)<0||/^\s*devoluci/i.test(e.concept||'')); return (
        <div key={e.id} style={{borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>setDetG(open?null:e.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',cursor:'pointer'}}>
            {diaGrande(e.date)}
            <div style={{flex:1,minWidth:0}}>
              {/* Fila limpia (regla sutil): tipo o categoría + OT con su sello de pagada; caja chica, banco y rendición quedan en el detalle (recorridoGasto). */}
              {(signo>0||e.category||e.ot_number||e.client_rendered_at)?<div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2,flexWrap:'wrap'}}>{signo>0?<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:isDev?C.azulBg:C.greenBg,color:isDev?C.azulInfo:C.greenText,fontWeight:700,whiteSpace:'nowrap'}}>{isDev?'Devolución':'Fondo'}</span>:(e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.bgWarm,color:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{e.category}</span>)}{signo<0&&otConSello(e)}{signo<0&&e.client_rendered_at&&<span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10.5,color:C.textSoft,whiteSpace:'nowrap'}}><CheckMini s={10}/>Rendido {fmtFechaDMY(e.client_rendered_at)}</span>}</div>:null}
              <div style={{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||e.category||(signo>0?(isDev?'Devolución':'Fondo'):'Gasto')}</div>
            </div>
            <div style={{fontSize:13,fontWeight:600,textAlign:'right',whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',color:isDev?C.muted:col,flexShrink:0}}>{isDev?'−'+fmt(Math.abs(e.amount)):(signo>0?'+':'−')+fmt(e.amount)}</div>
            <span style={{color:C.textSoft,fontSize:16,lineHeight:1,flexShrink:0,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </div>
          {open&&<div style={{padding:'8px 10px',background:C.bgSoft,borderRadius:6,fontSize:11,color:C.muted,lineHeight:1.6,margin:'0 0 7px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:3}}><span style={{fontSize:12,color:C.text,fontWeight:600,minWidth:0}}>{e.concept||e.category||(signo>0?(isDev?'Devolución':'Fondo recibido'):'Gasto')}</span>{onEditExpense&&<span onClick={(ev)=>{ev.stopPropagation();onEditExpense(e)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer',flexShrink:0}}>editar gasto ↗</span>}</div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap'}}><span>Tipo: <b style={{color:C.text}}>{signo>0?(isDev?'Devolución':'Fondo recibido'):'Gasto'}</b></span><span>Fecha: <b style={{color:C.text}}>{fmtFechaDMY(e.date)}</b></span><span>Monto: <b style={{color:isDev?C.muted:col}}>{isDev?'−'+fmt(Math.abs(e.amount)):fmt(e.amount)}</b></span>{e.category&&<span>Categoría: <b style={{color:C.text}}>{e.category}</b></span>}</div>
            <div style={{marginTop:5,paddingTop:5,borderTop:`1px solid #E4E8EB`}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}><span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>Venta / proyecto · razón social</span><span style={{display:'flex',gap:10,flexShrink:0}}>{v&&onOpenSale&&<span onClick={(ev)=>{ev.stopPropagation();onOpenSale(v)}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>ver venta ↗</span>}{ultAsig?.ids.has(e.id)&&ultAsig.n===1&&<span onClick={(ev)=>{ev.stopPropagation();deshacerAsig()}} style={{fontSize:10,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>deshacer</span>}</span></div>
              {(()=>{ const entName=id=>{ const en=(clientEntities||[]).find(x=>String(x.id)===String(id)); return en?en.name:'Razón social asignada' }
                const txtProy = v?<><b>{v.title}</b>{e.subproject?<b>{` · ${e.subproject}`}</b>:null}{v.area?` · ${v.area}`:''}{v.responsible?` · ${v.responsible}`:''}{v.status?` · ${v.status}`:''}</>:(e.project?<b>{e.project}{e.subproject?` · ${e.subproject}`:''}</b>:null)
                // Corregir: el dato mismo se toca → selectores con lo actual → Confirmar (con "antes" a la vista). Deshacer queda en línea.
                if(onAsociarTrabajo&&corrG?.id===e.id){ const vs=(sales||[]).filter(s=>String(s.client_id)===String(e.client_id)&&(VENTA_REAL(s)||String(s.id)===String(e.sale_id))); const ents=clientEntities||[]
                  const cambia = String(corrG.sale||'')!==String(e.sale_id||'') || String(corrG.ent||'')!==String(e.entity_id||'')
                  const sel={flex:'1 1 170px',minWidth:0,fontSize:12,padding:'6px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text}
                  const confirmar=async()=>{ if(!cambia) return; if(e.client_rendered_at&&!(await appConfirm(`Este movimiento ya se rindió al cliente el ${fmtFechaDMY(e.client_rendered_at)} con el proyecto anterior. ¿Cambiarlo igual?`))) return; await asignar([e], corrG.sale||'', corrG.ent||'', '', {forzar:true}); setCorrG(null) }
                  return <div onClick={ev=>ev.stopPropagation()} style={{marginTop:4}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {vs.length>0&&<select value={corrG.sale||''} onChange={ev=>setCorrG(c=>({...c,sale:ev.target.value}))} aria-label='Proyecto' style={sel}><option value=''>Proyecto…</option>{vs.map(x=><option key={x.id} value={x.id}>{x.title}{x.status!=='Activo'?` (${String(x.status||'').toLowerCase()})`:''}</option>)}</select>}
                      {ents.length>0&&<select value={corrG.ent||''} onChange={ev=>setCorrG(c=>({...c,ent:ev.target.value}))} aria-label='Razón social' style={sel}><option value=''>Razón social…</option>{ents.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginTop:6,flexWrap:'wrap'}}>
                      <span style={{flex:1,minWidth:0,fontSize:10.5,color:C.muted}}>antes: {[v?.title||e.project||'sin proyecto', e.entity_id?entName(e.entity_id):'sin razón social'].join(' · ')}</span>
                      <span onClick={()=>setCorrG(null)} style={{fontSize:11,color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>cancelar</span>
                      <button disabled={!cambia} onClick={confirmar} style={{fontSize:12,fontWeight:700,borderRadius:8,padding:'6px 12px',border:'none',background:cambia?C.accent:C.done,color:C.surface,cursor:cambia?'pointer':'default'}}>Confirmar</button>
                    </div></div> }
                const tap = (cont)=> <div onClick={(ev)=>{ev.stopPropagation();setCorrG({id:e.id,sale:e.sale_id||'',ent:e.entity_id||''})}} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,border:`1px dashed ${C.border}`,borderRadius:8,padding:'5px 8px',marginTop:4,cursor:'pointer',color:C.text}}><span style={{minWidth:0}}>{cont}</span><span style={{color:C.textSoft,flexShrink:0}}>⌄</span></div>
                return <>
                  {txtProy&&(onAsociarTrabajo ? tap(txtProy) : <div onClick={v&&onOpenSale?(ev)=>{ev.stopPropagation();onOpenSale(v)}:undefined} style={{color:C.text,cursor:v&&onOpenSale?'pointer':'default'}}>{txtProy}</div>)}
                  {!txtProy&&!onAsociarTrabajo&&<div style={{color:C.overdue}}>Sin proyecto asignado</div>}
                  {e.entity_id&&onAsociarTrabajo&&tap(<span style={{color:C.muted}}>{entName(e.entity_id)}</span>)}
                </> })()}
              {ultAsig?.ids.has(e.id)&&ultAsig.n>1&&<div style={{display:'flex',alignItems:'baseline',gap:8,background:C.greenBg,color:C.greenText,borderRadius:8,padding:'7px 10px',marginTop:5,fontSize:12}}><span>Asignados {ultAsig.n} · {fmt(ultAsig.monto)}</span><span onClick={(ev)=>{ev.stopPropagation();deshacerAsig()}} style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>deshacer</span></div>}
              {onAsociarTrabajo&&corrG?.id!==e.id&&(!v||!e.entity_id)&&<AsignarProyectoRS e={e} otros={sinProy.filter(x=>x.type===e.type)} ventas={(sales||[]).filter(s=>String(s.client_id)===String(e.client_id)&&VENTA_REAL(s))} ents={clientEntities||[]} subs={subproyectosCliente(e.client_id,tasks,expenses)} ctx={{aprendidos:aprVenta,hermanos:expenses,ia:iaVenta}} onAsignar={asignar}/>}
              {((e.entity_id&&!onAsociarTrabajo)||!onAsociarTrabajo||(!e.entity_id&&!(clientEntities||[]).length))&&<div style={{color:e.entity_id?C.muted:C.overdue,marginTop:1}}>{e.entity_id?(()=>{const ent=(clientEntities||[]).find(x=>String(x.id)===String(e.entity_id));return ent?ent.name:'Razón social asignada'})():'Sin razón social asignada'}</div>}</div>
            {/* Pago / depósito: de dónde viene o a dónde fue la plata (banco, notaría, caja chica, rendición, fondo que lo cubre). Cada enlace lleva al dato. */}
            {(()=>{ const links=recorridoGasto(e,{conc,movById,expenses}).map(p=>({k:p.k, t:p.t, d:[p.fecha?fmtFechaDMY(p.fecha):null, p.d].filter(Boolean).join(' · '), on:p.mov&&onOpenConciliacion?()=>onOpenConciliacion(p.mov):p.fondo?()=>setDetG(p.fondo):null}))
              if(!links.length) return null
              return <div style={{marginTop:5,paddingTop:5,borderTop:`1px solid ${C.border}`}}>
                <span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase'}}>{signo>0?'Depósito':'Pago'}</span>
                {links.map(l=><div key={l.k} onClick={l.on?(ev)=>{ev.stopPropagation();l.on()}:undefined} style={{display:'flex',gap:6,alignItems:'baseline',color:C.text,cursor:l.on?'pointer':'default'}}><b>{l.t}</b><span style={{color:C.muted}}>{l.d}</span>{l.on&&<span style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600,flexShrink:0}}>Ver <Gl n='chevron'/></span>}</div>)}
              </div> })()}
            {(e.created_by||e.notas)&&<div style={{marginTop:3}}>{e.created_by?`Registrado por ${e.created_by}`:''}{e.notas?` · ${e.notas}`:''}</div>}
          </div>}
        </div>) }
      const sinProy=[...fondos,...gastos].filter(e=>!e.sale_id&&!e.no_descuenta_saldo&&e.category!=='Apertura'&&cuentaEnSaldo(e)).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1)
      return (<div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:8}}>
        <div style={{fontSize:11,color:C.muted}}>Fondos {fmt(fg.fondos)} − Gastos {fmt(fg.gastos)} = <b style={{color:fg.saldo<0?C.overdueText:C.greenText}}>{fmtSaldoG(fg.saldo)}</b></div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          {(nPR>0||fgSinPR)&&<button onClick={()=>setFgSinPR(x=>!x)} style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:999,border:`1px solid ${fgSinPR?C.accent:C.border}`,background:fgSinPR?C.accent:'#fff',color:fgSinPR?C.surface:C.text,cursor:'pointer',whiteSpace:'nowrap'}}>Sin proyecto o RS · {nPR}{fgSinPR?<>{" "}<Gl n='x'/></>:''}</button>}
          <button onClick={()=>setFgOrd(o=>o==='desc'?'asc':'desc')} title='Ordenar por fecha' style={{fontSize:11,fontWeight:600,padding:'4px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Fecha {fgOrd==='desc'?'↓':'↑'}</button>
        </div>
      </div>
      {onRendicion&&(()=>{ const pr=gastosPorRendirCli(expenses,client.id); if(!pr.length) return null; const m=pr.reduce((t,e)=>t+(Number(e.amount)||0),0); return <div style={{display:'flex',alignItems:'center',gap:10,background:C.greenBg,borderRadius:10,padding:'7px 8px 7px 13px',marginBottom:10}}><span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:600,color:C.greenText,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Por rendir · {pr.length} gasto{pr.length!==1?'s':''}</span><b style={{color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(m)}</b><ActBtn variant='success' onClick={onRendicion}>Rendir</ActBtn></div> })()}
      <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',marginBottom:2}}>Fondos recibidos</div>
      {fondosV.length===0&&<div style={{fontSize:11,color:C.muted}}>—</div>}
      {fondosV.map(e=>fila(e,1,C.greenText))}
      <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',margin:'8px 0 2px'}}>Gastos</div>
      {gastosV.length===0&&<div style={{fontSize:11,color:C.muted}}>—</div>}
      {gastosV.map(e=>fila(e,-1,C.overdueText))}
      <BitacoraLista plano prefijo={`clientes.${client.id}.`} autor='Administración' limite={50}/>
    </div>) })()}
    {Hdr({icon:'clock',title:'Anticipos',k:'adelantos',summary:anticipos.length?`${anticipos.length}`:'sin anticipos'})}
    {sec.adelantos&&<div style={{padding:'2px 13px 12px'}}>
      {(anticipos||[]).length===0&&<div style={{fontSize:11,color:C.muted}}>Sin adelantos.</div>}
      {(anticipos||[]).slice().sort((a,b)=>(a.fecha||'')<(b.fecha||'')?1:-1).map(a=>{ const bill=(clientBilling||[]).find(b=>String(b.id)===String(a.billing_id)); const clickable=a.estado!=='disponible'&&bill&&onEditBilling; return (<div key={a.id} onClick={clickable?()=>onEditBilling(bill):undefined} title={clickable?`Ver factura N° ${folioN(bill.invoice_no)||'—'}`:undefined} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'4px 0',borderBottom:'1px solid #F1F1F1',cursor:clickable?'pointer':'default'}}><span>{(a.nota||'Anticipo').slice(0,30)} <span style={{color:C.textSoft}}>· {fmtFechaDMY(a.fecha)}</span></span><span style={{textAlign:'right'}}><b style={{color:C.greenText}}>{fmt(a.monto)}</b> <span style={{fontSize:9,color:a.estado==='disponible'?C.greenText:C.done}}>{a.estado}</span>{clickable?<span style={{color:C.textSoft,marginLeft:4}}><Gl n='chevron'/></span>:''}</span></div>) })}
    </div>}
    </div>
  </div>)
}

export const subproyectosCliente = (clientId, tasks=[], expenses=[]) => [...new Set([...(tasks||[]),...(expenses||[])].filter(x=>String(x.client_id)===String(clientId)&&x.subproject).map(x=>x.subproject.trim()))].sort((a,b)=>a.localeCompare(b,'es'))

// otros: los demás movimientos del cliente sin proyecto. Al elegir el proyecto se listan (por descripción) para sumarlos al mismo.
export function AsignarProyectoRS({e, items, otros=[], ventas=[], ents=[], subs=[], ctx={}, onAsignar}){
  const [marc,setMarc] = useState(()=>new Set())
  const lote = items || (e ? [e] : [])
  const faltaV = lote.some(x=>!x.sale_id), faltaRS = ents.length>0 && lote.some(x=>!x.entity_id)
  const sug = e ? sugerirVentaGasto(e, ventas, ctx) : {venta: ventas.length===1 ? ventas[0] : (ventas.filter(s=>s.status==='Activo').length===1 ? ventas.find(s=>s.status==='Activo') : null)}
  const [v,setV] = useState(sug.venta?String(sug.venta.id):'')
  const rsDeV = id => { const s=ventas.find(x=>String(x.id)===String(id)); return s&&s.entity_id&&ents.some(en=>String(en.id)===String(s.entity_id)) ? String(s.entity_id) : (ents.length===1 ? String(ents[0].id) : '') }
  const [rs,setRs] = useState(rsDeV(v))
  const [sub,setSub] = useState('')
  const vSel = ventas.find(x=>String(x.id)===String(v))
  const pideSub = faltaV && esPermanente(vSel)
  if(!faltaV && !faltaRS) return null
  const sel = {flex:'1 1 170px',minWidth:0,fontSize:12,padding:'6px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text}
  const ok = (faltaV&&v) || (faltaRS&&rs)
  const lista = e && faltaV && v ? otros.filter(x=>x.id!==e.id) : []
  const extra = lista.filter(x=>marc.has(x.id))
  const todoLote = [...lote, ...extra]
  const asig = ()=>{ const rsX = faltaRS ? rs : (extra.some(x=>!x.entity_id) ? rsDeV(v) : ''); onAsignar(todoLote, faltaV?v:'', rsX, pideSub?sub.trim():''); setMarc(new Set()) }
  const btn = <button disabled={!ok} onClick={asig} style={{fontSize:12,fontWeight:700,borderRadius:8,padding:'6px 12px',border:'none',background:ok?C.accent:C.done,color:C.surface,cursor:ok?'pointer':'default',whiteSpace:'nowrap'}}>{todoLote.length>1?(items?`Asignar a los ${todoLote.length}`:`Asignar ${todoLote.length} · ${fmt(todoLote.reduce((a,x)=>a+Math.abs(x.amount||0),0))}`):'Asignar'}</button>
  const ck = on => <span style={{width:15,height:15,borderRadius:4,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'transparent',color:C.surface,fontSize:10,display:'grid',placeItems:'center',flexShrink:0,marginTop:1}}>{on?<Gl n='tick'/>:''}</span>
  if(lista.length) return (
    <div onClick={ev=>ev.stopPropagation()} style={{marginTop:5}}>
      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
        {ventas.length>0&&<select value={v} onChange={ev=>{ setV(ev.target.value); const r=rsDeV(ev.target.value); if(r) setRs(r) }} aria-label='Proyecto' style={sel}>
          <option value=''>Proyecto…</option>
          {ventas.map(s=><option key={s.id} value={s.id}>{s.title}{s.status!=='Activo'?` (${s.status.toLowerCase()})`:''}</option>)}
        </select>}
        {pideSub&&<><input value={sub} onChange={ev=>setSub(ev.target.value)} list='asig-subproy' placeholder='Subproyecto…' aria-label='Subproyecto' style={sel}/><datalist id='asig-subproy'>{subs.map(x=><option key={x} value={x}/>)}</datalist></>}
        {faltaRS&&<select value={rs} onChange={ev=>setRs(ev.target.value)} aria-label='Razón social' style={sel}>
          <option value=''>Razón social…</option>
          {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
        </select>}
        {faltaV&&sug.venta&&String(sug.venta.id)===String(v)&&sug.porque&&<div style={{flexBasis:'100%',fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={sug.porque}>Sugerido · {sug.porque}</div>}
      </div>
      <div style={{marginTop:7,paddingTop:7,borderTop:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginBottom:2}}><b style={{fontSize:11.5,color:C.text}}>Otros sin proyecto · ¿van a este mismo?</b><span onClick={()=>setMarc(extra.length===lista.length?new Set():new Set(lista.map(x=>x.id)))} style={{fontSize:11,color:C.azulInfo,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{extra.length===lista.length?'Desmarcar':'Marcar todos'}</span></div>
        {lista.map(x=>{ const on=marc.has(x.id); const ot=x.ot_number?(String(x.ot_number).toUpperCase().startsWith('OT')?x.ot_number:'OT-'+x.ot_number):null
          return <div key={x.id} onClick={()=>setMarc(s=>{ const n=new Set(s); n.has(x.id)?n.delete(x.id):n.add(x.id); return n })} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.border}`,cursor:'pointer'}}>
            {ck(on)}
            <span style={{flex:1,minWidth:0,display:'grid',gap:1}}><span style={{fontSize:12,color:C.text,lineHeight:1.35}}>{String(x.concept||x.category||'Sin descripción').replace(/^gastos notariales\s*[—–-]\s*/i,'')}</span><span style={{fontSize:10.5,color:C.muted}}>{[fmtFechaDMY(x.date),ot].filter(Boolean).join(' · ')}</span></span>
            <span style={{fontSize:12,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(Math.abs(x.amount||0))}</span>
          </div> })}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>{btn}</div>
      </div>
    </div>)
  return (
    <div onClick={ev=>ev.stopPropagation()} style={{display:'flex',gap:6,alignItems:'center',marginTop:5,flexWrap:'wrap'}}>
      {faltaV&&ventas.length>0&&<select value={v} onChange={ev=>{ setV(ev.target.value); const r=rsDeV(ev.target.value); if(r) setRs(r) }} aria-label='Proyecto' style={sel}>
        <option value=''>Proyecto…</option>
        {ventas.map(s=><option key={s.id} value={s.id}>{s.title}{s.status!=='Activo'?` (${s.status.toLowerCase()})`:''}</option>)}
      </select>}
      {pideSub&&<><input value={sub} onChange={ev=>setSub(ev.target.value)} list='asig-subproy' placeholder='Subproyecto…' aria-label='Subproyecto' style={sel}/><datalist id='asig-subproy'>{subs.map(x=><option key={x} value={x}/>)}</datalist></>}
      {faltaRS&&<select value={rs} onChange={ev=>setRs(ev.target.value)} aria-label='Razón social' style={sel}>
        <option value=''>Razón social…</option>
        {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
      </select>}
      {btn}
      {faltaV&&sug.venta&&String(sug.venta.id)===String(v)&&sug.porque&&<div style={{flexBasis:'100%',fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={sug.porque}>Sugerido · {sug.porque}</div>}
    </div>)
}

// COTEJO por venta: cuota programada del trabajo ENFRENTADA a la factura emitida asociada, y las facturas al
// mismo RUT sin asociar (huérfanas). Solo LEE el cruce (planDeVenta + cuota N/M); el único write es asociar a mano
// una huérfana a un hueco → reusa onReplaceProgramada (handleReplaceProgramada: soft-delete + replaced_by_id + undo).
// NO toca los motores de conciliación. Desktop = dos columnas enfrentadas; móvil = par apilado.
export const _MES_AB = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

export function CotejoVenta({sale, saleBills=[], orphans=[], isDesktop, client=null, entities=[], nested=false, sinMetricas=false, onOpenFactura, onAssociate}){
  const [pickFor,setPickFor] = useState(null)   // orphan.id en modo "elige cuota" (móvil / sin drag)
  const [hover,setHover] = useState(null)        // prog.id resaltada (elegida con «Asociar»)
  // Arrastrar una factura sin asociar a su cuota (mouse o dedo: useArrastre). En el celular sigue también «Asociar».
  const grupoArr = 'cotejo-'+(sale?.id||'')
  const arrF = useArrastre({grupo:grupoArr, onSoltar:(oid,progId)=>{ setPickFor(null); setHover(null); onAssociate&&onAssociate(progId,oid) }})
  const [view,setView] = useState(()=>{ try{ return localStorage.getItem('cotejo_view')||'linea' }catch(_){ return 'linea' } })
  const setViewP = v => { setView(v); try{ localStorage.setItem('cotejo_view',v) }catch(_){} }
  const useTable = isDesktop && view==='tabla'

  const plan = planDeVenta(sale)
  const hoy = isoLocal(new Date())
  // Vencimiento EFECTIVO: una programada de un mes ya pasado rodó al mes en curso (fuente única rolledDueMap).
  const rollMap = rolledDueMap(saleBills, hoy)
  const effDue = b => rollMap.get(String(b.id)) || b.due || b.issued_at
  const emit = b => !!b.invoice_no
  // Orden FIFO: por nº de cuota (1→10); sin nº, por vencimiento efectivo. Arregla el 2,1,4,3 (empates de fecha).
  const cnN = b => { const cn=cuotaNMof(b.concept); return cn?cn.n:9999 }
  const cuotas = (saleBills||[]).filter(b=>!b.deleted_at && b.status!=='Anulada' && b.billing_type!=='reembolso')
    .slice().sort((a,b)=> (cnN(a)-cnN(b)) || String(effDue(a)||'').localeCompare(String(effDue(b)||'')))
  const huecos = cuotas.filter(b=> !b.invoice_no)   // cuotas por emitir = destinos de asociación
  const olvidadas = cuotasOlvidadas(saleBills)      // saltadas (una emitida posterior las dejó atrás)
  const olvidadasSet = new Set(olvidadas.map(b=>String(b.id)))
  const mmm = d => { const s=String(d||''); return s.length>=7 ? `${_MES_AB[+s.slice(5,7)-1]} ${s.slice(2,4)}` : '' }
  const etiqueta = b => { const cn=cuotaNMof(b.concept); if(cn) return `Cuota ${cn.n}/${cn.tot}`; const per=concPeriodoOf(b.concept); if(per) return mmm(per+'-01'); return mmm(effDue(b))||'Cobro' }
  const estTxt = b => ({Pagado:'pagada',Pendiente:'pendiente',Vencido:'vencida',Anticipada:'anticipada'}[b.status]||'emitida')
  const estCol = b => ({Pagado:C.greenText,Pendiente:C.soonText,Vencido:C.overdueText,Anticipada:C.accent}[b.status]||C.greenText)
  const doAssoc = async (progId, orphanId) => { setPickFor(null); setHover(null); if(onAssociate) await onAssociate(progId, orphanId) }

  // Razón social + RUT a quien se factura (un cliente puede tener varias RS: se ordenan por RS, no por cliente).
  const nr = r => String(r||'').replace(/[.\s-]/g,'').toUpperCase()
  const entOf = b => { if(b.entity_id){ const e=entities.find(x=>String(x.id)===String(b.entity_id)); if(e) return e } const r=nr(b.receptor_rut); if(r){ const e=entities.find(x=>nr(x.rut)===r); if(e) return e } return null }
  const rutOf = b => { const e=entOf(b); return (e&&e.rut)?String(e.rut).trim():String(b.receptor_rut||'').trim() }
  const rsList = []; { const seen=new Set(); cuotas.forEach(b=>{ const e=entOf(b); const key=e?('e'+e.id):('r'+nr(b.receptor_rut)); if((e||b.receptor_rut)&&!seen.has(key)){ seen.add(key); rsList.push({name:e?e.name:(b.receptor_name||'Sin razón social'), rut:e?e.rut:b.receptor_rut}) } }) }

  const planN = plan.length
  const nTot = planN || cuotas.length
  const uf = (sale.amount_uf||0)*(sale.cobro_type==='mensual'?12:1)
  const nEmit = cuotas.filter(emit).length, nHueco = huecos.length
  const cobrado = cuotas.reduce((a,b)=>a+cobradoBill(b),0)
  const porEmitir = huecos.reduce((a,b)=>a+(b.amount||0),0)

  const dmy = iso => fmtFechaDMY(iso) || '—'
  const rutTxt = b => { const r=rutOf(b); return r||'' }

  // ── Celdas de la línea de tiempo ──
  const celdaCuota = (b) => { const olv=olvidadasSet.has(String(b.id))
    return (<div style={{background:emit(b)?'#fff':(olv?'#FCEBEB':(C.soonBg||'#FFFBF0')),border:`1px solid ${emit(b)?C.border:(olv?C.overdueText:(C.soon||'#EBD9AE'))}`,borderRadius:10,padding:'8px 10px'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,color:C.text,fontWeight:600}}>{etiqueta(b)}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount||0)}</span></div>
      <div style={{fontSize:10.5,color:olv?C.overdueText:C.muted,marginTop:2}}>{emit(b)?`Vence ${dmy(b.due)}`:`Vence ${dmy(effDue(b))}`}{olv?' · sin facturar':''}</div>
    </div>) }
  const celdaFactura = (b) => emit(b) ? (
    <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',cursor:onOpenFactura?'pointer':'default'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}><span style={{fontSize:12.5,color:C.accent,fontWeight:700}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span><span style={{fontSize:12.5,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(b)||b.amount||0)}</span></div>
      <div style={{fontSize:10.5,color:C.muted,marginTop:2,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}><span style={{color:estCol(b),fontWeight:600}}>{estTxt(b)}</span><span>Emitida {dmy(b.issued_at)}</span>{rutTxt(b)&&<span>· {rutTxt(b)}</span>}<span style={{color:C.textSoft,marginLeft:'auto'}}><Gl n='chevron'/></span></div>
    </div>
  ) : (
    <div data-soltar={b.id} data-soltar-grupo={grupoArr}
      style={{border:`1.5px dashed ${(hover===b.id||arrF.sobre===String(b.id))?C.accent:(C.soon||'#EBD9AE')}`,background:(hover===b.id||arrF.sobre===String(b.id))?(C.azulBg||'#EAF0F3'):'transparent',borderRadius:10,padding:'8px 10px',display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',transition:'background .1s'}}>
      <span style={{fontSize:12,color:C.soonText}}>por emitir</span>
      {orphans.length>0&&<span style={{fontSize:10.5,color:C.muted}}>{isDesktop?'arrastra aquí':''}</span>}
    </div>
  )

  return (
    <div style={{border:nested?'none':`1px solid ${C.border}`,borderRadius:nested?0:12,padding:nested?'6px 0 0':'12px 13px',marginBottom:nested?0:9,background:nested?'transparent':'#fff'}}>
      {/* Encabezado: proyecto + cliente + razón social + RUT + métricas */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
        <div style={{minWidth:0}}>
          {!nested&&<div style={{fontSize:14.5,fontWeight:700,color:C.text}}>{sale.title}</div>}
          {client&&<div style={{fontSize:11.5,color:C.muted,marginTop:1}}>Cliente <b style={{color:C.text,fontWeight:600}}>{client.name}</b>{rsList.length?' · facturado a':''}</div>}
          {rsList.length>0&&<div style={{display:'inline-flex',alignItems:'center',gap:6,background:C.azulBg||'#EAF0F3',color:C.accent,borderRadius:8,padding:'3px 9px',fontSize:12,fontWeight:600,marginTop:6}}>{rsDisplay?rsDisplay(rsList[0].name):rsList[0].name}{rsList[0].rut&&<span style={{color:C.muted,fontWeight:500}}>· {rsList[0].rut}</span>}{rsList.length>1&&<span style={{color:C.muted,fontWeight:500}}>+{rsList.length-1}</span>}</div>}
        </div>
        {isDesktop&&<div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:9,overflow:'hidden',flexShrink:0}}>
          {[['linea','Línea'],['tabla','Tabla']].map(([v,l])=><button key={v} onClick={()=>setViewP(v)} style={{border:'none',background:view===v?C.accent:'#fff',color:view===v?'#fff':C.muted,fontSize:11.5,fontWeight:600,padding:'6px 13px',cursor:'pointer'}}>{l}</button>)}
        </div>}
      </div>
      {!sinMetricas&&<div style={{display:'flex',gap:16,marginTop:10,flexWrap:'wrap'}}>
        <div style={{fontSize:10.5,color:C.muted}}>Plan<div style={{fontSize:13,fontWeight:700,color:C.text}}>{nTot} cuota{nTot!==1?'s':''}{uf>0?` · ${fmtUF(uf)}`:''}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Cobrado<div style={{fontSize:13,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(cobrado)}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Facturado<div style={{fontSize:13,fontWeight:700,color:C.text}}>{nEmit} de {nTot}</div></div>
        <div style={{fontSize:10.5,color:C.muted}}>Por emitir<div style={{fontSize:13,fontWeight:700,color:nHueco?C.soonText:C.muted,fontVariantNumeric:'tabular-nums'}}>{nHueco?fmtShort(porEmitir):'$0'}</div></div>
      </div>}

      {/* AVISO: cuota(s) que quedaron sin facturar (una cuota posterior las dejó atrás) */}
      {olvidadas.length>0 && (()=>{ const o=olvidadas.slice().sort((a,b)=>cnN(a)-cnN(b))[0]
        return (<div onClick={()=>onOpenFactura&&onOpenFactura(o)} style={{marginTop:11,display:'flex',alignItems:'center',gap:9,background:'#FCEBEB',border:`1px solid ${C.overdueText}`,borderRadius:10,padding:'9px 11px',cursor:onOpenFactura?'pointer':'default'}}>
          <SIcon n='alert' s={16} c={C.overdueText}/>
          <div style={{flex:1,minWidth:0,fontSize:12,color:C.overdueText}}><b style={{fontWeight:700}}>{olvidadas.length} cuota{olvidadas.length!==1?'s':''} sin facturar.</b> Se emitió una posterior y quedó atrás la {etiqueta(o)} (venció {dmy(o.due)}). {onOpenFactura?<>Facturar ahora{" "}<Gl n='chevron'/></>:''}</div>
        </div>) })()}

      <div style={{marginTop:11}}>
      {useTable ? (
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'26px 1.1fr 92px 1.1fr 96px 92px',gap:'0 12px',...TH_BAND,padding:'8px 10px'}}>
            <span>#</span><span>Cuota / vence</span><span style={{textAlign:'right'}}>Programado</span><span>Factura</span><span>RUT</span><span style={{textAlign:'right'}}>Emitido</span>
          </div>
          {cuotas.map((b,i)=>{ const olv=olvidadasSet.has(String(b.id))
            return (<div key={b.id} onClick={()=>emit(b)&&onOpenFactura&&onOpenFactura(b)} style={{display:'grid',gridTemplateColumns:'26px 1.1fr 92px 1.1fr 96px 92px',gap:'0 12px',alignItems:'center',padding:'9px 10px',borderTop:`1px solid ${C.border}`,background:emit(b)?'#fff':(olv?'#FEF4F4':'#FEFDF9'),cursor:emit(b)&&onOpenFactura?'pointer':'default',fontSize:12}}>
              <span style={{color:C.muted}}>{cuotaNMof(b.concept)?.n||i+1}</span>
              <span><span style={{fontWeight:600,color:C.text}}>{etiqueta(b)}</span><span style={{display:'block',fontSize:10.5,color:olv?C.overdueText:C.muted}}>{dmy(emit(b)?b.due:effDue(b))}{olv?' · sin facturar':''}</span></span>
              <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.text}}>{fmt(b.amount||0)}</span>
              <span>{emit(b)?<><span style={{fontWeight:700,color:C.accent}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span> <span style={{color:estCol(b),fontSize:11}}>{estTxt(b)}</span><span style={{display:'block',fontSize:10,color:C.muted}}>Emitida {dmy(b.issued_at)}</span></>:<span style={{color:C.soonText,fontWeight:600}}>Por emitir</span>}</span>
              <span style={{fontSize:11,color:C.muted}}>{rutTxt(b)||'—'}</span>
              <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:emit(b)?C.text:C.muted,fontWeight:emit(b)?600:400}}>{emit(b)?fmt(montoFactura(b)||b.amount||0):'—'}</span>
            </div>) })}
        </div>
      ) : isDesktop ? (
        <div style={{display:'grid',gridTemplateColumns:'1fr 24px 1fr',gap:'0 8px',alignItems:'center'}}>
          <div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,padding:'0 2px 4px'}}>PROGRAMADO</div><div/><div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,padding:'0 2px 4px'}}>EMITIDO</div>
          {cuotas.map(b=>(<Fragment key={b.id}>
            <div style={{marginBottom:8}}>{celdaCuota(b)}</div>
            <div style={{display:'flex',justifyContent:'center',marginBottom:8,color:emit(b)?C.greenText:(C.soon||'#C9A94A')}}>{emit(b)?<SIcon n='check' s={14} c={C.greenText}/>:<span style={{fontSize:13,color:C.soonText}}>·</span>}</div>
            <div style={{marginBottom:8}}>{celdaFactura(b)}</div>
          </Fragment>))}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {cuotas.map(b=>{ const olv=olvidadasSet.has(String(b.id))
            return (<div key={b.id} style={{border:`1px solid ${emit(b)?C.border:(olv?C.overdueText:(C.soon||'#EBD9AE'))}`,borderRadius:11,overflow:'hidden'}}>
            <div style={{padding:'8px 10px',background:emit(b)?'#fff':(olv?'#FCEBEB':(C.soonBg||'#FFFBF0'))}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,fontWeight:600,color:C.text}}>{etiqueta(b)}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount||0)}</span></div>
              <div style={{fontSize:10.5,color:olv?C.overdueText:C.muted,marginTop:2}}>Vence {dmy(emit(b)?b.due:effDue(b))}{olv?' · sin facturar':''}</div>
            </div>
            {emit(b)
              ? <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{padding:'8px 10px 8px 18px',borderTop:`1px solid ${C.border}`}}><div style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:12,color:C.muted}}>↳</span><span style={{flex:1,fontSize:12,color:C.accent,fontWeight:700}}>Factura N° {folioN(b.invoice_no)||b.invoice_no}</span><span style={{fontSize:12,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(b)||b.amount||0)}</span></div><div style={{fontSize:10.5,color:C.muted,marginTop:2,paddingLeft:19,display:'flex',gap:6,flexWrap:'wrap'}}><span style={{color:estCol(b),fontWeight:600}}>{estTxt(b)}</span><span>Emitida {dmy(b.issued_at)}</span>{rutTxt(b)&&<span>· {rutTxt(b)}</span>}</div></div>
              : <div style={{padding:'8px 10px 8px 18px',display:'flex',alignItems:'center',gap:7,borderTop:`1px dashed ${C.soon||'#EBD9AE'}`}}><span style={{fontSize:12,color:C.soonText}}>↳</span><span style={{flex:1,fontSize:12,color:C.soonText}}>por emitir · hueco</span></div>}
          </div>) })}
        </div>
      )}
      </div>
      {planN>0 && cuotas.length<planN && <div style={{fontSize:10.5,color:C.muted,marginTop:6}}>El plan tiene {planN} cuotas; faltan {planN-cuotas.length} por generar.</div>}

      {orphans.length>0 && (()=>{ const fifo=huecoFIFO(saleBills)
        return (<div style={{marginTop:11,borderTop:`1px solid ${C.border}`,paddingTop:9}}>
          <div style={{fontSize:9.5,color:C.muted,letterSpacing:.4,fontWeight:700,marginBottom:6}}>MISMO RUT · SIN ASOCIAR · {orphans.length}</div>
          {orphans.map(o=>{ const sug = fifo || huecos.find(h=>Math.abs((h.amount||0)-(montoFactura(o)||o.amount||0))/Math.max(1,h.amount||1)<0.03)
            const dnd = huecos.length>0 ? arrF.props(o.id, `Factura N° ${folioN(o.invoice_no)||o.invoice_no}`) : null
            return (<div key={o.id} onPointerDown={dnd?.onPointerDown}
              style={{...(dnd?.style||{}),border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',marginBottom:6,background:'#fff',cursor:isDesktop&&huecos.length?'grab':'default'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {isDesktop&&huecos.length>0&&<span style={{color:C.muted,fontSize:14}}>⠿</span>}
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>Factura N° {folioN(o.invoice_no)||o.invoice_no}<span style={{fontWeight:400,color:C.muted}}> · emitida {dmy(o.issued_at||o.due)}</span></div>{sug&&<div style={{fontSize:10.5,color:C.accent}}>llena el hueco más antiguo · {etiqueta(sug)}</div>}</div>
                <div style={{fontSize:12.5,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montoFactura(o)||o.amount||0)}</div>
                {huecos.length>0&&!isDesktop&&<button onClick={()=>setPickFor(pickFor===o.id?null:o.id)} style={{fontSize:11.5,color:C.accent,border:`1px solid ${C.accent}`,borderRadius:16,padding:'3px 10px',background:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Asociar</button>}
              </div>
              {pickFor===o.id && (
                <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{fontSize:10.5,color:C.muted}}>Asociar a la cuota:</div>
                  {huecos.map(h=>(<button key={h.id} onClick={()=>doAssoc(h.id,o.id)} style={{textAlign:'left',border:`1px solid ${sug&&sug.id===h.id?C.accent:C.border}`,background:sug&&sug.id===h.id?(C.azulBg||'#EAF0F3'):'#fff',borderRadius:9,padding:'7px 10px',cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8}}><span style={{fontSize:12.5,color:C.text}}>{etiqueta(h)}{sug&&sug.id===h.id?' · más antigua':''}</span><span style={{fontSize:12.5,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(h.amount||0)}</span></button>))}
                </div>
              )}
            </div>) })}
          <div style={{fontSize:10,color:C.muted,marginTop:2}}>Facturas de este RUT sin venta. Asociar enlaza la factura a la cuota más antigua (reversible) sin tocar la conciliación.</div>
        </div>) })()}
    </div>
  )
}

export function FinancieroTab({client, clientBilling, entities, sales=[], anticipos=[], billing=[], respaldoMap, cartolaHasta=null, onNuevoAnticipo, onSaveFields, onEditBilling, onAddBilling, onAddSale, onConciliar, onOpenConciliacion, onAssignSeries, onStatusChange, onReplaceProgramada, onOpenSale}) {
  const isDesktop = useIsDesktop()   // desktop: ancho acotado y centrado (no estirado a toda la pantalla)
  const causasCli = useCausas({clientId:client.id})   // causas en Cortes de cada venta (agente causas-tablas)
  const propsCli = usePropiedades({clientId:client.id})   // roles de avalúo de cada venta (tabla propiedades)
  // Cockpit de facturas: TODAS las del cliente — buscador + tabs por año + agrupación Proyecto → Razón social → Factura con orden por fecha.
  // Tocar una factura abre el editor BillingForm (editar/marcar pagada/anular/eliminar) → cambios se propagan a toda la app.
  const all = (clientBilling||[]).filter(b=>!b.deleted_at)
  const real = all.filter(b=>b.billing_type!=='reembolso')
  const facturado = real.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)   // montoFactura = autoridad del DTE (no el amount programado)
  const cobrado = real.reduce((a,b)=>a+cobradoBill(b),0)   // incluye abonos parciales (fuente única cobradoBill)
  const porCobrar = porCobrarBills(real)
  const programado = real.filter(b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)).reduce((a,b)=>a+(b.amount||0),0)
  const overdueTot = real.filter(b=>b.invoice_no&&b.status==='Vencido').reduce((a,b)=>a+saldoBill(b),0)

  const clientSales = (sales||[]).filter(s=>String(s.client_id)===String(client.id))
  const saleTitle = id => clientSales.find(s=>String(s.id)===String(id))?.title || null
  // Cotejo cuota↔factura anidado dentro de cada proyecto (huérfanas del mismo RUT + asociar FIFO reversible).
  const [cjOpen,setCjOpen] = useState(()=>new Set())
  const toggleCj = id => setCjOpen(p=>{ const n=new Set(p); n.has(String(id))?n.delete(String(id)):n.add(String(id)); return n })
  const cotejoSinVenta = all.filter(b=> b.invoice_no && b.status!=='Anulada' && !['reembolso','comision','externo','subarriendo'].includes(b.billing_type) && !b.sale_id)
  const cotejoOrphansFor = s => cotejoSinVenta.filter(b=> !s.entity_id || !b.entity_id || String(b.entity_id)===String(s.entity_id))
  const cotejoAsociar = async (progId, orphanId) => {
    const o=(billing||[]).find(b=>String(b.id)===String(orphanId)); const h=(billing||[]).find(b=>String(b.id)===String(progId)); if(!o||!h) return
    if(!await appConfirm(`¿Asociar la factura N° ${folioN(o.invoice_no)||o.invoice_no} (${fmt(montoFactura(o)||o.amount||0)}) a la cuota "${(cuotaNMof(h.concept)?`Cuota ${cuotaNMof(h.concept).n}/${cuotaNMof(h.concept).tot}`:'programada')}"? La cuota queda cubierta y la factura se enlaza a la venta. Reversible.`)) return
    await onReplaceProgramada(h.id, o.id)
  }
  const kpiDate = b => b.status==='Programada'?(b.due||b.issued_at):(b.status==='Pagado'?(b.paid_at||b.issued_at):(b.issued_at||b.due))
  const anioDe = b => (kpiDate(b)||'').slice(0,4)
  const aniosList = [...new Set(all.map(anioDe).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
  const projCounts = {}; all.forEach(b=>{ const k=b.sale_id?String(b.sale_id):'sin'; projCounts[k]=(projCounts[k]||0)+1 })

  const [q,setQ] = useState('')
  // Jerarquía Año → Proyecto → Factura (cockpit v2). Año sincronizado con Facturación (localStorage 'fac_year').
  const pickYear = () => { try{ const g=localStorage.getItem('fac_year'); if(g && aniosList.includes(g)) return g }catch(e){} return aniosList[0]||'' }
  const [selYear,setSelYear] = useState(pickYear)
  const setYearSync = y => { setSelYear(y); try{ localStorage.setItem('fac_year', y||'') }catch(e){} }
  const [openProj,setOpenProj] = useState(()=>new Set())
  const [subRSOpen,setSubRSOpen] = useState({})   // colapso por RS dentro de un proyecto (key: saleId|rsKey); default abierto si tiene deuda
  const [facDir,setFacDir] = useState('desc')   // orden por fecha de las facturas: 'desc' (nueva→antigua) | 'asc'
  const [detFac,setDetFac] = useState(()=>new Set())   // facturas con detalle/movimiento bancario expandido
  const [ficRs,setFicRs] = useState('all')   // filtro por razón social en la ficha (rsKey | 'all')
  const [ficEst,setFicEst] = useState({})   // colapso de los acordeones por estado en la ficha
  const [vSec,setVSec] = useState({})   // colapso de las secciones-icono de Ventas (Proyectos/Facturas), colapsadas por defecto
  const [svOpen,setSvOpen] = useState(null)   // factura sin venta con la asignación desplegada
  const sinVentaF = all.filter(b=>catSinClienteVenta(b)==='vta')   // misma regla que Facturación › Por clasificar
  const vtog = k => setVSec(s=>({...s,[k]:!s[k]}))
  const [facEje,setFacEje] = useState('estado')   // eje de la sección Facturas: 'estado' | 'anio' | 'proyecto'
  const [fConc,setFConc] = useState([]); const [fMovs,setFMovs] = useState([])   // conciliación del cliente para ver el movimiento de una factura conciliada
  useEffect(()=>{ if(!client?.id) return; let ok=true; Promise.all([selectAll(()=>supabase.from('conciliacion').select('factura_id,movimiento_id,tipo_destino,monto_aplicado').order('id')), selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,n_operacion,descripcion').eq('cliente_id',client.id).order('id'))]).then(([a,b])=>{ if(ok){ setFConc(a.data||[]); setFMovs(b.data||[]) } }).catch(()=>{}); return ()=>{ ok=false } },[client?.id])
  const fConcByFac = useMemo(()=>{ const m={}; fConc.forEach(c=>{ if(c.factura_id&&c.tipo_destino==='factura') (m[c.factura_id]=m[c.factura_id]||[]).push(c) }); return m },[fConc])
  const fMovById = useMemo(()=>{ const m={}; fMovs.forEach(x=>m[x.id]=x); return m },[fMovs])
  const toggleDet = id => setDetFac(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  useEffect(()=>{ setSelYear(pickYear()) },[client.id])
  const toggleProj = id => setOpenProj(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  // Al abrir un año, expandir solo los proyectos con algo vencido (lo accionable visible sin clics).
  useEffect(()=>{ const ov=new Set(); (clientBilling||[]).forEach(b=>{ if(!b.deleted_at && b.sale_id && b.status==='Vencido' && (kpiDate(b)||'').slice(0,4)===selYear) ov.add(String(b.sale_id)) }); setOpenProj(ov) },[selYear,client.id])
  const sugSaleFor = (b,list) => { // ✦ venta probable por coincidencia de glosa base con el título (dentro de las ventas del año)
    if(!b?.concept) return null; const k=serieKey(b.concept); if(!k) return null
    const w=new Set(k.split(' ').filter(x=>x.length>3)); let best=null,sc=0
    ;(list||clientSales).forEach(s=>{ const n=serieKey(s.title).split(' ').filter(x=>x.length>3).filter(x=>w.has(x)).length; if(n>sc){sc=n;best=s} })
    return sc>0?best:null
  }
  const recordarCobro = b => recordarCobroFactura(b, client)
  const borde = b => estadoCobro(b).color

  const fields = ['abogado_responsable','notas_internas']
  const fromClient = () => fields.reduce((o,k)=>{o[k]=client[k]||'';return o},{})
  const [form,setForm] = useState(fromClient())
  const [savingF,setSavingF] = useState(false)
  useEffect(()=>{ setForm(fromClient()) },[client.id])
  const dirty = fields.some(k=>(form[k]||'')!==(client[k]||''))
  const set = (k,v)=>setForm(f=>({...f,[k]:v}))
  const guardar = async ()=>{ setSavingF(true); try{ await onSaveFields(client.id, form) }catch(e){} setSavingF(false) }

  const inp = {width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const lbl = {fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,marginBottom:4,display:'block'}
  const card = {marginBottom:16,padding:'14px 16px',borderRadius:12,background:C.card,border:`1px solid ${C.border}`}
  const sTitle = (t)=>(<div style={{...SEC_LBL,marginBottom:10}}>{t}</div>)
  const VHdr = ({icon,iconCol,title,purpose,summary,sumCol,k}) => (<div onClick={()=>vtog(k)} style={{display:'flex',alignItems:'center',gap:11,padding:'12px 13px',cursor:'pointer',background:vSec[k]?'#F7F9FA':'#fff'}}>
    <SIcon n={icon} s={18} c={iconCol||C.muted}/>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:vSec[k]?700:600,color:vSec[k]?C.accent:C.text}}>{title}</div>{purpose&&<div style={{fontSize:10,color:C.muted,fontWeight:500,marginTop:1}}>{purpose}</div>}</div>
    {summary!=null&&<span style={{fontSize:11,color:sumCol||C.muted,fontWeight:sumCol&&sumCol!==C.muted?700:400,whiteSpace:'nowrap'}}>{summary}</span>}
    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:vSec[k]?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
  </div>)
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )

  return (
    <div style={{padding:'16px 20px 60px',maxWidth:isDesktop?900:undefined,margin:isDesktop?'0 auto':undefined}}>
      {/* La foto (Vendido/Facturado/Cobrado/Por cobrar) vive en el embudo del Resumen — no se repite acá. Ventas = proyectos + facturas + anticipos. */}


      {/* Proyectos (icono-sección colapsada): Vigentes + Terminados, con barra de cobro (facturado→cobrado) */}
      {(()=>{
        const activas = clientSales.filter(s=>s.status==='Activo')
        const terminadas = clientSales.filter(s=>s.status==='Terminado')
        if(!activas.length && !terminadas.length) return null
        const projCard = s => {
          const sb=clientBilling.filter(b=>!b.deleted_at&&b.sale_id===s.id)
          const fac=sb.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)
          const cob=sb.reduce((a,b)=>a+cobradoBill(b),0)   // incluye parciales; fuente única
          const pen=porCobrarBills(sb)
          const uf=(s.amount_uf||0)*(s.cobro_type==='mensual'?12:1)
          const ai={Corporativo:'building',Tributario:'file',Laboral:'users'}[s.area]||'briefcase'
          const pct=fac>0?Math.min(100,Math.round(cob/fac*100)):0
          const hasBills=sb.length>0; const open=cjOpen.has(String(s.id)); const olvN=cuotasOlvidadas(sb).length
          return (<div key={s.id} style={{background:'#fff',border:`0.5px solid ${olvN?C.overdueText:C.border}`,borderRadius:12,marginBottom:7,overflow:'hidden'}}>
            <div onClick={()=>toggleCj(s.id)} style={{padding:'10px 12px',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:9}}>
                <SIcon n={ai} s={19} c={C.muted}/>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div><div style={{fontSize:10,color:olvN?C.overdueText:C.muted}}>{uf>0?fmtUF(uf):''}{s.year?` · ${s.year}`:''}{olvN?` · ${olvN} sin facturar`:''}{(()=>{ const n=(causasCli.rows||[]).filter(c=>String(c.sale_id||'')===String(s.id)).length; return n?` · ${n} causa${n!==1?'s':''}`:'' })()}</div></div>
                <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:8,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,whiteSpace:'nowrap'}}>Por cobrar</div><div style={{fontSize:15,fontWeight:800,color:pen>0?C.accent:C.greenText,lineHeight:1,marginTop:1}}>{pen>0?fmtShort(pen):'$0'}</div></div>
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .12s'}}><path d='M6 9l6 6 6-6'/></svg>
              </div>
              {fac>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:8}}><span style={{fontSize:10,color:C.muted}}>Facturado <b style={{color:C.text}}>{fmtShort(fac)}</b> · Cobrado <b style={{color:C.text}}>{fmtShort(cob)}</b></span><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:pct>=80?C.greenBg:C.soonBg,color:pct>=80?C.greenText:C.soonText,whiteSpace:'nowrap'}}>{pct}% cobrado</span></div>}
            </div>
            {open&&<div style={{padding:'0 11px 11px'}}>
              {hasBills&&<CotejoVenta sale={s} saleBills={sb} orphans={onReplaceProgramada?cotejoOrphansFor(s):[]} isDesktop={isDesktop} client={client} entities={entities} nested onOpenFactura={onEditBilling} onAssociate={onReplaceProgramada?cotejoAsociar:undefined}/>}
              <CausasVenta client={client} sale={s} isDesktop={isDesktop} causas={causasCli}/>
              <PropiedadesVenta client={client} sale={s} isDesktop={isDesktop} props={propsCli}/>
              {onOpenSale&&<div style={{textAlign:'right',marginTop:2}}><span onClick={(e)=>{e.stopPropagation();onOpenSale(s)}} style={{fontSize:11,color:C.accent,fontWeight:600,cursor:'pointer'}}>Abrir venta <Gl n='chevron'/></span></div>}
            </div>}
          </div>)
        }
        return (<div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
          {VHdr({icon:'briefcase',title:'Proyectos',purpose:'cuánto falta cobrar',k:'proyectos',summary:`${activas.length} vigente${activas.length!==1?'s':''} · ${terminadas.length} terminado${terminadas.length!==1?'s':''}`})}
          {/* Facturas del cliente sin venta: aviso siempre visible (aunque Proyectos esté colapsado) con la misma asignación de Por clasificar. */}
          {sinVentaF.map(b=>{ const op=svOpen===b.id; return <div key={b.id} style={{padding:'0 13px 10px'}}>
            <div onClick={()=>setSvOpen(op?null:b.id)} style={{display:'flex',alignItems:'center',gap:8,background:C.azulBg,borderRadius:10,padding:'9px 11px',cursor:'pointer',minWidth:0}}>
              <span style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)||b.invoice_no} sin venta</span>
              {isDesktop&&<span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap'}}>· {fmtFechaDMY(b.issued_at)}</span>}
              <span style={{marginLeft:'auto',fontSize:12.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</span>
              <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:op?'rotate(180deg)':'none'}}><path d='M6 9l6 6 6-6'/></svg>
            </div>
            {op&&<AsignarVentaFactura factura={b} sales={sales} billing={billing} onHecho={()=>setSvOpen(null)}/>}
          </div> })}
          {vSec.proyectos&&<div style={{padding:'6px 13px 12px'}}>
            {onAddSale&&<button onClick={onAddSale} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:9}}>+ Venta</button>}
            {activas.length===0&&terminadas.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 2px 6px'}}>Sin ventas registradas.</div>}
            {activas.length>0&&<><div style={{...SEC_LBL,margin:'2px 2px 7px'}}>Vigentes · {activas.length}</div>
            {activas.map(projCard)}</>}
            {terminadas.length>0&&<><div style={{...SEC_LBL,margin:'10px 2px 7px'}}>Terminados · {terminadas.length}</div>
            {terminadas.map(projCard)}</>}
          </div>}
        </div>)
      })()}

      {/* Facturas (icono-sección colapsada): el cockpit Año → Proyecto → Factura va dentro */}
      <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
        {VHdr({icon:'file',title:'Facturas',k:'facturas',summary:porCobrar>0?`${fmt(porCobrar)} por cobrar`:(real.filter(esFacturada).length?`${real.filter(esFacturada).length} emitidas`:'sin facturas'),sumCol:porCobrar>0?C.accent:undefined})}
        {vSec.facturas&&<div style={{padding:'10px 13px 13px'}}>
        <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',marginBottom:9}}>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            {onConciliar&&<span onClick={()=>onConciliar()} style={{fontSize:11,color:C.greenText,fontWeight:600,cursor:'pointer'}}>Conciliar</span>}
            <span onClick={()=>onAddBilling&&onAddBilling()} style={{fontSize:11,color:C.accent,fontWeight:600,cursor:'pointer'}}>+ Nueva factura</span>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',marginBottom:9}}>
          <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.4'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar Factura N°, concepto, monto…' style={{flex:1,border:'none',background:'transparent',fontSize:13,color:C.text,outline:'none'}}/>
          {q&&<span onClick={()=>setQ('')} style={{fontSize:14,color:C.muted,cursor:'pointer',lineHeight:1}}><Gl n='x'/></span>}
        </div>
        {aniosList.length>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginBottom:11}}>
          <div style={{display:'flex',gap:6,overflowX:'auto',scrollbarWidth:'none'}}>
            {aniosList.map(y=>(<span key={y} onClick={()=>setYearSync(y)} style={{flexShrink:0,fontSize:12,fontWeight:600,borderRadius:8,padding:'5px 13px',cursor:'pointer',background:selYear===y?C.accent:'#fff',color:selYear===y?'#fff':C.muted,border:`1px solid ${selYear===y?C.accent:C.border}`}}>{y}</span>))}
          </div>
          <div style={{display:'flex',gap:7,alignItems:'center',flexShrink:0,fontSize:10}}>
            <span style={{color:C.textSoft}}>Fecha</span>
            {[['desc','↓ Nueva'],['asc','↑ Antigua']].map(([v,l])=><span key={v} onClick={()=>setFacDir(v)} style={{fontWeight:facDir===v?700:600,color:facDir===v?C.accent:C.muted,cursor:'pointer'}}>{l}</span>)}
          </div>
        </div>}
        {(()=>{
          if(!aniosList.length) return <div style={{fontSize:12,color:C.muted,padding:'8px 2px'}}>Este cliente no tiene facturas todavía.</div>
          const matchQ = b => { if(!q.trim()) return true; const s=q.toLowerCase().trim(); return `${b.concept||''} ${folioN(b.invoice_no)} ${b.amount||''} ${fmtFechaDMY(kpiDate(b))} ${saleTitle(b.sale_id)||''}`.toLowerCase().includes(s) }
          const yf = all.filter(b=>anioDe(b)===selYear && matchQ(b) && b.billing_type!=='nota_credito')   // las notas de crédito no van sueltas: se muestran anidadas bajo la factura que anulan
          // histYear: las emitidas históricas (≤2025) no exigen proyecto asignado (lo usa needsProj más abajo).
          const histYear = (parseInt(selYear)||9999) <= 2025
          const lblFolio = b => b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:(b.concept||'—')
          const rutOf=b=>{ if(b.entity_id){ const e=entities.find(x=>String(x.id)===String(b.entity_id)); if(e&&e.rut) return String(e.rut).trim() } return String(b.receptor_rut||'').trim() }
          const rsKeyOf=b=>{ const r=rutOf(b); return r?('rut:'+r):(b.receptor_name?('n:'+String(b.receptor_name).trim().toLowerCase()):'sin') }
          const rsNameOf=b=>{ const r=rutOf(b); const e=entities.find(x=>String(x.id)===String(b.entity_id))||entities.find(x=>x.rut&&String(x.rut).trim()===r); if(e) return e.name+(e.rut?(' · '+e.rut):''); return b.receptor_name?(b.receptor_name+(r?(' · '+r):'')):'Sin razón social' }
          const rsShort=b=>{ const r=rutOf(b); const e=entities.find(x=>String(x.id)===String(b.entity_id))||entities.find(x=>x.rut&&String(x.rut).trim()===r); if(e?.name) return rsDisplay(e.name); return b.receptor_name?rsDisplay(b.receptor_name):null }
          // Descargar copia PDF (con timbre) de una factura emitida — se regenera del DTE guardado, no depende de Drive. Siempre disponible.
          const verFacturaPdf = async(b)=>{ try{ const doc=splitSetDTE(b.dte_xml)[0]||b.dte_xml; const r=await facturaDtePdfBase64(doc); const bin=atob(r.base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); descargarPdfU8(u8, facturaNombreArchivo(r)) }catch(e){ appAlert('No se pudo generar el PDF: '+(e.message||e)) } }
          const renderFactura = (b,assignable)=>{
            const proj=b.sale_id?saleTitle(b.sale_id):null; const rsNm=rsShort(b)
            // Asignable a CUALQUIER proyecto del cliente (un proyecto puede cruzar años y razones sociales).
            const ventasAsig = clientSales
            const sug = assignable?sugSaleFor(b,ventasAsig):null
            const conciliada = b.status==='Pagado' && (fConcByFac[b.id]||[]).length>0
            const detOpen = detFac.has(b.id)
            const e = estadoFacturaLabel(b,(respaldoMap&&respaldoMap[b.id])||0,cartolaHasta)
            const pend = ['Pendiente','Vencido'].includes(b.status)
            return (
              <div key={b.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:5}}>
                <div onClick={()=> conciliada ? toggleDet(b.id) : (onEditBilling&&onEditBilling(b))} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer'}}>
                  {bigDate(kpiDate(b))}
                  <SIcon n={estadoCobro(b).icon} s={15} c={borde(b)}/>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lblFolio(b)}{['reembolso','comision','externo'].includes(b.billing_type)&&<span style={{fontSize:9,color:C.muted,marginLeft:5}}>{tipoFacturaLbl(b)}</span>}</div>
                    {b.invoice_no&&<div style={{fontSize:10,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>}
                    {(proj||rsNm)&&<div style={{fontSize:9,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{proj||''}{proj&&rsNm?' · ':''}{rsNm&&<b style={{fontWeight:600}}>{rsNm}</b>}</div>}
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    {(()=>{ const sal=saldoBill(b); const parcial=(b.paid_amount||0)>0&&!['Pagado','Anulada'].includes(b.status); return parcial
                      ? <><div style={{fontSize:9,color:C.textSoft}}>Saldo</div><div style={{fontSize:14,fontWeight:700,color:C.overdueText,lineHeight:1.05}}>{fmt(sal)}</div><div style={{fontSize:9,color:C.textSoft,marginTop:1}}>Abonado {fmt(b.paid_amount)} de {fmt(b.amount)}</div></>
                      : <div style={{fontSize:13,fontWeight:600,color:esVencidaB(b)?C.overdueText:(pend?C.accent:C.text)}}>{fmt(b.amount)}</div> })()}
                    {pend&&<ActBtn variant='softNavy' onClick={(ev)=>{ev.stopPropagation();recordarCobro(b)}} style={{marginTop:5}}>Recordar</ActBtn>}
                    {b.invoice_no&&b.dte_xml&&<button onClick={(ev)=>{ev.stopPropagation();verFacturaPdf(b)}} title='Descargar copia PDF (con timbre)' style={{marginTop:5,display:'block',marginLeft:'auto',fontSize:10,fontWeight:700,color:C.tealText,background:'#fff',border:`0.5px solid ${C.tealText}`,borderRadius:7,padding:'3px 10px',cursor:'pointer'}}>PDF ↓</button>}
                  </div>
                </div>
                {(b.anulada_por||'').startsWith('Nota de crédito')&&<div style={{marginTop:6,marginLeft:49,fontSize:10,lineHeight:1.4,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',background:'#FFFBF4',border:'1px solid #EAD9B8',borderRadius:8,padding:'6px 9px'}}>
                  <span style={{fontSize:9,fontWeight:800,color:C.soonText,background:C.soonBg,borderRadius:4,padding:'2px 6px',textTransform:'uppercase',letterSpacing:.3,flexShrink:0}}>NC</span>
                  <span style={{color:C.text,minWidth:0}}>{b.anulada_por} anula esta factura{b.reemplazada_por_billing_id&&(()=>{ const rp=(billing||[]).find(x=>x.id===b.reemplazada_por_billing_id); return rp?<> · reemplazada por <b style={{color:C.accent,fontWeight:700}}>Factura N° {folioN(rp.invoice_no)}</b>{String(rp.client_id)!==String(client.id)&&(rsShort(rp)||rp.receptor_name)?` · ${rsShort(rp)||rp.receptor_name}`:''}</>:null })()}</span>
                  <span style={{marginLeft:'auto',fontWeight:800,color:C.overdueText,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>− {fmt(b.amount)}</span>
                  <span style={{fontSize:10,color:C.greenText,fontWeight:700,flexShrink:0}}>saldo $0</span>
                </div>}
                {(()=>{ const orig=(billing||[]).find(x=>x.reemplazada_por_billing_id===b.id); return orig?<div style={{marginTop:6,marginLeft:49,fontSize:10,color:C.muted,lineHeight:1.4}}>Reemplaza a <b style={{color:C.accent,fontWeight:600}}>Factura N° {folioN(orig.invoice_no)}</b>{String(orig.client_id)!==String(client.id)&&(rsShort(orig)||orig.receptor_name)?` · ${rsShort(orig)||orig.receptor_name}`:''}</div>:null })()}
                {e&&<div style={{marginTop:6,marginLeft:49}}><EstadoFacturaChip b={b} respaldoMap={respaldoMap} cartolaHasta={cartolaHasta} chevron={conciliada}/></div>}
                {conciliada&&detOpen&&(()=>{ const cs=fConcByFac[b.id]||[]; const mv=fMovById[cs[0]?.movimiento_id]; return (
                  <div style={{marginTop:8,marginLeft:49,background:'#F0F7F4',border:`1px solid #CFE9DD`,borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.4,marginBottom:4}}>Movimiento bancario</div>
                    {mv ? <>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>Fecha</span><span style={{color:C.text,fontWeight:600}}>{fmtFechaDMY(mv.fecha)}</span></div>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>Monto</span><span style={{color:C.text,fontWeight:600}}>{fmt(mv.monto)}</span></div>
                      {mv.n_operacion&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'1px 0'}}><span style={{color:C.muted}}>N° operación</span><span style={{color:C.text,fontWeight:600}}>{mv.n_operacion}</span></div>}
                      {mv.descripcion&&<div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.4}}>{String(mv.descripcion).slice(0,90)}</div>}
                    </> : <div style={{fontSize:11,color:C.muted}}>Conciliada (movimiento en otra cuenta o sin detalle local).</div>}
                    <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:6}}>
                      {onEditBilling&&<span onClick={()=>onEditBilling(b)} style={{fontSize:10,fontWeight:600,color:C.muted,cursor:'pointer'}}>Editar</span>}
                      {(onOpenConciliacion&&cs[0]?.movimiento_id)
                        ? <span onClick={()=>onOpenConciliacion(cs[0].movimiento_id)} style={{fontSize:10,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Ver este movimiento →</span>
                        : (onConciliar&&<span onClick={()=>onConciliar()} style={{fontSize:10,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Ver en conciliación →</span>)}
                    </div>
                  </div>
                )})()}
                {assignable&&<div style={{display:'flex',gap:6,alignItems:'center',marginTop:7,flexWrap:'wrap',marginLeft:49}}>
                  {sug&&<button onClick={()=>onAssignSeries&&onAssignSeries(sug.id,[b.id])} style={{fontSize:10,background:C.greenBg,color:C.greenText,border:'none',borderRadius:8,padding:'3px 10px',fontWeight:600,cursor:'pointer'}}><Sparkle/> {sug.title}</button>}
                  {ventasAsig.length>0
                    ? <select defaultValue='' onChange={e=>{ if(e.target.value&&onAssignSeries) onAssignSeries(e.target.value,[b.id]) }} style={{fontSize:10,padding:'3px 8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted}}>
                        <option value=''>+ Asignar a proyecto…</option>
                        {ventasAsig.map(s=><option key={s.id} value={s.id}>{s.title}{s.year?` · ${s.year}`:''}</option>)}
                      </select>
                    : <span style={{fontSize:10,color:C.muted}}>Este cliente no tiene proyectos</span>}
                </div>}
              </div>
            )
          }
          const nada = !yf.length
          return (<>
            {nada&&<div style={{fontSize:12,color:C.muted,padding:'8px 2px'}}>Sin facturas en {selYear}{q?' con esa búsqueda':''}.</div>}
            {!nada&&(()=>{
              // Ficha al mismo patrón que Facturación: filtro por razón social + acordeones por estado (Por cobrar [aging] / Por facturar / Cobradas / Anuladas). Proyecto y RS en cada factura; máximo detalle al tocar.
              const rsMap={}; yf.forEach(b=>{ const k=rsKeyOf(b); if(!rsMap[k]) rsMap[k]={k,name:rsShort(b)||rsNameOf(b)} })
              const rsArr=Object.values(rsMap)
              const facturas = ficRs==='all'?yf:yf.filter(b=>rsKeyOf(b)===ficRs)
              const byDir=arr=>[...arr].sort((a,b)=> facDir==='asc'?(kpiDate(a)||'').localeCompare(kpiDate(b)||''):(kpiDate(b)||'').localeCompare(kpiDate(a)||''))
              const agingAsc=arr=>[...arr].sort((a,b)=>(a.due||a.issued_at||'').localeCompare(b.due||b.issued_at||''))
              const needsProj=b=>!b.sale_id && !(histYear&&b.invoice_no&&b.issued_at&&b.issued_at<='2025-12-31')
              const ESTADOS=[
                ['Por cobrar', b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status), ESTADO_COBRO.porCobrar, saldoBill, agingAsc, true],
                ['Por facturar', b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status), ESTADO_COBRO.porFacturar, b=>b.amount||0, agingAsc, false],
                ['Pagadas', b=>['Pagado','Anticipada'].includes(b.status), ESTADO_COBRO.cobrado, b=>b.amount||0, byDir, false],
                ['Anuladas', b=>b.status==='Anulada', ESTADO_COBRO.anulada, b=>b.amount||0, byDir, false],
              ]
              return (<>
                {rsArr.length>=2&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
                  {[{k:'all',name:'Todas las RS'},...rsArr].map(r=>{ const on=ficRs===r.k; return <span key={r.k} onClick={()=>setFicRs(r.k)} style={{fontSize:9,fontWeight:600,borderRadius:20,padding:'3px 9px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,whiteSpace:'nowrap'}}>{r.name}</span> })}
                </div>}
                {ESTADOS.map(([lbl,pred,tok,money,ord,defOpen])=>{
                  const gr=facturas.filter(pred); if(!gr.length) return null
                  const isOpen=ficEst[lbl]!==undefined?ficEst[lbl]:defOpen
                  const subT=gr.reduce((a,b)=>a+money(b),0)
                  return (<div key={lbl} style={{marginBottom:7}}>
                    <div onClick={()=>setFicEst(p=>({...p,[lbl]:!isOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:4}}>
                      <span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><SIcon n={tok.icon||'file'} s={15} c={tok.text}/><span style={{fontSize:10,fontWeight:700,background:tok.bg,color:tok.text,borderRadius:14,padding:'2px 10px',textTransform:'uppercase',letterSpacing:.4}}>{lbl} · {gr.length} {isOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span></span>
                      <span style={{fontSize:12,fontWeight:700,color:tok.text}}>{fmt(subT)}</span>
                    </div>
                    {isOpen&&ord(gr).map(b=>renderFactura(b,needsProj(b)))}
                  </div>)
                })}
              </>)
            })()}
          </>)
        })()}
        </div>}
      </div>

      {/* Anticipos (icono-sección colapsada, igual que Proyectos/Facturas): el monto disponible es el protagonista en el header */}
      {(()=>{
        const antDisp = anticipos.filter(a=>a.estado==='disponible')
        const totalDisp = antDisp.reduce((s,a)=>s+(a.monto||0),0)
        const antSorted = [...anticipos].sort((a,b)=>((a.estado==='disponible'?0:1)-(b.estado==='disponible'?0:1))||(b.fecha||'').localeCompare(a.fecha||''))
        const fmtF = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
        const summary = totalDisp>0 ? fmt(totalDisp) : (anticipos.length ? 'sin disponibles' : 'sin anticipos')
        return (
          <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
            {VHdr({icon:'wallet',title:'Anticipos',k:'anticipos',summary,sumCol:totalDisp>0?C.normal:undefined})}
            {vSec.anticipos&&<div style={{padding:'8px 13px 12px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:antSorted.length?6:0}}>
                {antDisp.length>0
                  ? <span style={{fontSize:11,fontWeight:600,color:C.soonText,background:C.soonBg,padding:'2px 9px',borderRadius:20}}>{antDisp.length} por facturar</span>
                  : <span/>}
                <button onClick={()=>onNuevoAnticipo&&onNuevoAnticipo()} style={{height:24,padding:'0 12px',borderRadius:8,background:'#fff',color:C.accent,border:`0.5px solid ${C.border}`,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Registrar</button>
              </div>
              {antSorted.length===0
                ? <div style={{fontSize:12,color:C.textSoft,padding:'4px 0 2px'}}>Sin anticipos aún.</div>
                : antSorted.map((a,i)=>{ const disp=a.estado==='disponible'; const bill=billing.find(b=>String(b.id)===String(a.billing_id)); const folio=bill?.invoice_no; const clickable=!disp&&bill&&onEditBilling; return (
                  <div key={a.id} onClick={clickable?()=>onEditBilling(bill):undefined} style={{display:'flex',gap:12,alignItems:'center',padding:'11px 0',borderTop:i?`0.5px solid ${C.border}`:'none',cursor:clickable?'pointer':'default'}}>
                    <div style={{width:36,height:36,borderRadius:10,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:disp?C.greenBg:C.bgSoft}}>
                      {disp
                        ? <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.normal} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/></svg>
                        : <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:500,color:C.text}}>{fmt(a.monto)}</div>
                      <div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtF(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}{a.nota?` · ${a.nota}`:''}</div>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      {!disp&&folio&&<span style={{fontSize:11,color:C.muted,textDecoration:'underline'}}>Factura N° {folio}</span>}
                      <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:disp?C.greenBg:C.bgSoft,color:disp?C.greenText:C.done,whiteSpace:'nowrap'}}>{disp?'Disponible':'Consumido'}</span>
                    </div>
                  </div>
                )})}
            </div>}
          </div>
        )
      })()}
    </div>
  )
}

// Re-adjunta el PDF con timbre de una factura: se regenera al vuelo desde su DTE (por regla, toda factura tiene XML).
// Recordar cobro de UNA factura (FUENTE ÚNICA ficha › Financiero y «Por cobrar a mis clientes»): sale desde la cuenta del usuario,
// con el PDF de la factura y la nota guardada del cliente. `cc` opcional (el abogado limitado copia a la oficina).
export async function recordarCobroFactura(b, client, {cc=null}={}){
  const to=(client.email||'').trim()
  if(!to){ appAlert('El cliente no tiene correo en su ficha. Agrégalo para poder recordar el cobro.'); return }
  let nota=''; try{ const {data}=await supabase.from('learnings').select('value').eq('kind','recordatorio_nota').eq('key',String(client.id)).maybeSingle(); nota=data?.value||'' }catch(_){}
  const r=recordatorioCobro(b, nota)   // incluye la nota guardada de este cliente
  if(!await appConfirm(`¿Enviar recordatorio de cobro a ${to} por ${r.folio} (${r.monto})? Se adjunta el PDF de la factura.`)) return
  try{ const ad=await facturaPdfAdjunto(b); const via=await enviarComoUsuario({to, cc, subject:r.subject, html:r.html, text:r.text, attachments:ad?[ad]:null}); if(via){ try{ await setLearningKV('factura_recordado',String(b.id),new Date().toISOString()) }catch(_){}; appAlert(txtEnviado(via,{que:'Recordatorio',para:to})) } }
  catch(e){ appAlert('No se pudo enviar el recordatorio: '+e.message) }
}

// Foto del cliente (Resumen de la ficha): 5 KPI + Por rendir + Vencidas + Próximas tareas. Fuente única para la ficha de admin y la del responsable limitado.
export function FotoCliente({client, sales=[], billing=[], expenses=[], tasks=[], setFtab, onRendicion, onEditExpense, onEditBilling, onEditTask, onAddTask}){
  const isDesktop = useIsDesktop()
  const ufState = useUF()
  const ufRef = ufState.uf || sales.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  const clientSales = sales.filter(s=>s.client_id===client.id&&s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada'&&!esSubarriendo(s))
  const clientBilling = billing.filter(b=>b.client_id===client.id)
  const clientTasks = tasks.filter(t=>t.client_id===client.id&&t.status!=='Terminado')
  // Vendido UF: misma fuente que Dashboard/Ventas (recurrentes x12, CLP convertido a UF)
  const vendidoUF = clientSales.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const facturado = clientBilling.filter(esFacturada).reduce((a,b)=>a+montoFactura(b),0)   // autoridad DTE
  const cobrado = clientBilling.filter(b=>!b.deleted_at&&b.billing_type!=='reembolso').reduce((a,b)=>a+cobradoBill(b),0)   // incluye parciales; fuente única
  const porCobrar = clientBilling.filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrarBills(clientBilling)   // fuente única (mismo helper que Financiero/lista/Dashboard)
  // Saldo del cliente: fuente única (fgCliente) — mismo criterio (todo lo no-fondo es gasto) que la lista de Gastos y el Dashboard.
  const {fondos, gastos, saldo:saldoFondos} = fgCliente(expenses, client.id)
  const porRendir = gastosPorRendirCli(expenses, client.id).sort((a,b)=>(a.date||'')<(b.date||'')?-1:1)
  const porRendirTot = porRendir.reduce((a,e)=>a+(Number(e.amount)||0),0)
  // Embudo del cliente: cifras a UNA décima (resumen escaneable; el detalle de las filas va en fmt completo).
  const fmtM1 = fmtShort
  const ufM1 = n => n>0 ? `UF ${Math.round(n).toLocaleString('es-CL')}` : '—'   // KPI hero: UF redonda (sin ",0" colgando)
  const nVencFicha = porCobrar.filter(b=>esVencidaB(b)&&saldoBill(b)>0).length   // vencida con saldo: una factura Vencido ya abonada entera no se debe
  // Secciones del Resumen: todas parten plegadas (una línea con su cifra) y se despliegan al tocar.
  const [abiertas,setAbiertas] = useState(()=>new Set())
  const alt = k => setAbiertas(x=>{ const n=new Set(x); n.has(k)?n.delete(k):n.add(k); return n })
  const [elegir,setElegir] = useState(false)
  const propsCal = usePropiedades({clientId:client.id}), causasCal = useCausas({clientId:client.id}), calCli = useCalCliente(client.id)
  const cal = useMemo(()=>calendarioCliente({props:propsCal.rows||[], causas:causasCal.rows||[], ...(calCli.f||{}), dj:calCli.dj}),[propsCal.rows,causasCal.rows,calCli.f,calCli.dj])
  return (<>
        {/* FOTO: 5 tarjetas KPI individuales (Vendido·Facturado·Cobrado·Por cobrar·Fondos) + 2 tarjetas accionables (Vencidas·Próximas tareas). Sin duplicar: el detalle vive en las pestañas. */}
        {(()=>{
          const kc=(l,v,sub,col,go)=>(<div onClick={go?()=>setFtab(go):undefined} className={go?'lf-kpi':undefined} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',cursor:go?'pointer':'default'}}>
            <div style={{...SEC_LBL}}>{l}</div>
            <div style={{fontSize:17,fontWeight:800,color:col,marginTop:4,letterSpacing:-.3,fontVariantNumeric:'tabular-nums'}}>{v}</div>
            <div style={{fontSize:9,color:C.muted,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
          </div>)
          const nFact=clientBilling.filter(esFacturada).length
          const _MAf=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
          const dcol=iso=>{const p=String(iso||'').slice(0,10).split('-');return p.length>=3?{dd:p[2],mm:_MAf[+p[1]-1]||''}:null}
          const venc=porCobrar.filter(b=>esVencidaB(b)&&saldoBill(b)>0).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
          const vencTot=venc.reduce((s,b)=>s+saldoBill(b),0)
          const dvenc=b=>{const dl=daysLeft(b.due);return dl!=null&&dl<0?-dl:0}
          const tks=[...clientTasks].sort((a,b)=>String(a.due||'zzzz').localeCompare(String(b.due||'zzzz'))).slice(0,3)
          return (<>
          <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(5,1fr)':'repeat(2,1fr)',gap:10,marginBottom:14}}>
            {kc('Vendido', ufM1(vendidoUF), `${clientSales.length} venta${clientSales.length!==1?'s':''}`, C.accent, 'financiero')}
            {kc('Facturado', fmtM1(facturado), `${nFact} factura${nFact!==1?'s':''}`, C.accent, 'documentos')}
            {kc('Cobrado', fmtM1(cobrado), 'histórico', C.greenText, 'documentos')}
            {kc('Por cobrar', totalPorCobrar>0?fmtM1(totalPorCobrar):'$0', nVencFicha>0?`${nVencFicha} vencida${nVencFicha!==1?'s':''}`:'saldo vivo', totalPorCobrar>0?(nVencFicha>0?C.overdueText:C.accent):C.muted, 'financiero')}
            {kc('Fondos', fmtM1(saldoFondos), porRendir.length>0?`${porRendir.length} por rendir ›`:saldoFondos<0?'por reponer':'disponibles', saldoFondos<0?C.overdueText:C.tealText, 'documentos')}
          </div>
          {(()=>{
            const sec=(k,icn,ibg,icol,t,sub,val,vcol,body,borde)=>{ const ab=abiertas.has(k)&&!!body
              return <div key={k} style={{background:C.surface,border:`1px solid ${borde||C.border}`,borderRadius:12,overflow:'hidden',minWidth:0}}>
                <div onClick={body?()=>alt(k):undefined} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderBottom:ab?`1px solid ${C.bgSoft}`:'none',cursor:body?'pointer':'default'}}>
                  <span style={{width:28,height:28,borderRadius:8,background:ibg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={icn} s={15} c={icol}/></span>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{t}</div><div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>
                  {val!=null&&<span style={{fontSize:13,fontWeight:800,color:vcol||C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{val}</span>}
                  {body&&<span style={{color:C.done,fontSize:13,flexShrink:0,display:'inline-flex',transform:ab?'rotate(180deg)':'none',transition:'transform .12s'}}><Gl n='chevD'/></span>}
                </div>{ab&&body}</div> }
            const fila=(key,on,izq,centro,der)=><div key={key} onClick={on} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:on?'pointer':'default',fontSize:12}}>{izq}<div style={{flex:1,minWidth:0}}>{centro}</div>{der}</div>
            const pie=(txt,col,on)=><div onClick={on} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700,color:col,cursor:on?'pointer':'default'}}>{txt} <Gl n='chevron'/></div>
            const tt=(a,b)=><><div style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a}</div>{b&&<div style={{fontSize:10,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b}</div>}</>
            const sRend=porRendir.length>0&&onRendicion&&sec('rend','wallet',C.greenBg,C.greenText,'Por rendir al cliente',`${porRendir.length} gasto${porRendir.length!==1?'s':''}${porRendir[0]?.date?` · desde ${fmtFechaDMY(porRendir[0].date)}`:''}`,fmt(porRendirTot),C.greenText,<>
              {porRendir.slice(0,3).map(e=>fila(e.id,onEditExpense?()=>onEditExpense(e):undefined,null,<div style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||e.category||'Gasto'}</div>,<><span style={{fontSize:10,color:C.muted,flexShrink:0}}>{fmtFechaDMY(e.date)}</span><span style={{fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0,minWidth:72,textAlign:'right'}}>{fmt(e.amount)}</span></>))}
              {porRendir.length>3&&pie(`Ver los ${porRendir.length} en Cartola`,C.greenText,()=>setFtab('documentos'))}
              <div style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`}}><ActBtn variant='success' full onClick={()=>onRendicion(client)}>Rendir</ActBtn></div></>,C.greenText)
            const sVenc=venc.length>0
              ? sec('venc','file',C.overdueBg,C.overdueText,'Vencidas',`${venc.length} factura${venc.length!==1?'s':''} · a cobrar ya`,fmt(vencTot),C.overdueText,<>
                  {venc.slice(0,3).map(b=>fila(b.id,onEditBilling?()=>onEditBilling(b):undefined,diaGrande(b.issued_at||b.due,C.overdueText),tt(b.concept||'Factura',`${b.invoice_no?`Factura N° ${folioN(b.invoice_no)||b.invoice_no} · `:''}${dvenc(b)} d`),<span style={{fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(saldoBill(b))}</span>))}
                  {pie('Cobrar · ir a Ventas',C.overdueText,()=>setFtab('financiero'))}</>)
              : sec('venc','check',C.greenBg,C.greenText,'Vencidas','al día · sin facturas vencidas',null,null,null)
            const nTV=clientTasks.filter(t=>t.due&&String(t.due).slice(0,10)<isoLocal(Date.now())).length
            const sTar=sec('tar','check',C.azulBg,C.accent,'Próximas tareas',`pendiente${clientTasks.length!==1?'s':''}${nTV?` · ${nTV} vencida${nTV!==1?'s':''}`:''}`,String(clientTasks.length),C.accent,<>
              {tks.length===0?<div style={{padding:'12px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Sin tareas pendientes.</div>
                :tks.map(t=>fila(t.id,onEditTask?()=>onEditTask(t):undefined,<span style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0}}/>,tt(t.title,`${taskAssignees(t).join(', ')||'—'}${t.due?` · vence ${fmtFechaDMY(t.due)}`:''}`),null))}
              {onAddTask&&<div onClick={()=>onAddTask()} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>+ Nueva tarea</div>}</>)
            const goCal=g=>g==='financiero'?()=>setFtab('financiero'):undefined
            const chipD=f=>{ const d=_diasA(cal.hoy,f), pr=d<=31; return <span style={{fontSize:10.5,fontWeight:700,borderRadius:10,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0,background:d<0?C.overdueBg:pr?C.soonBg:C.track,color:d<0?C.overdueText:pr?C.soonText:C.muted}}>{d<0?'Vencido':d===0?'Hoy':`En ${d} día${d===1?'':'s'}`}</span> }
            const sCal=sec('cal','cal',C.azulBg,C.accent,'Calendario',cal.items.length?`en ${CAL_CLI_DIAS} días · próximo ${fmtFechaDMY(cal.items[0].fecha)}`:`en ${CAL_CLI_DIAS} días`,String(cal.items.length),C.accent,<>
              {cal.items.length?cal.items.map((x,i)=>x.porConfirmar
                ? <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12}}>{diaGrande(x.fecha,x.vencido?C.overdueText:undefined)}
                    <div style={{flex:1,minWidth:0}}><div style={{fontWeight:600,color:C.text}}>{x.t}</div><div style={{fontSize:10,color:C.muted,overflowWrap:'anywhere'}}>{x.s}</div>
                      <div style={{display:'flex',gap:6,marginTop:6,alignItems:'center'}}><span style={{fontSize:10.5,fontWeight:700,borderRadius:10,padding:'2px 8px',background:C.soonBg,color:C.soonText,whiteSpace:'nowrap'}}>Por confirmar</span><span style={{flex:1}}/>
                        <button onClick={()=>calCli.resolverPlazoDoc(x.porConfirmar,true)} style={{fontSize:11,fontWeight:700,border:'none',borderRadius:8,padding:'4px 10px',background:C.accent,color:'#fff',cursor:'pointer',fontFamily:'inherit'}}>Confirmar</button>
                        <button onClick={()=>calCli.resolverPlazoDoc(x.porConfirmar,false)} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 10px',background:C.surface,color:C.muted,cursor:'pointer',fontFamily:'inherit'}}>Descartar</button></div></div></div>
                : fila(i,goCal(x.go),diaGrande(x.fecha,x.vencido?C.overdueText:undefined),tt(x.t,x.s),chipD(x.fecha)))
                :<div style={{padding:'10px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:700,color:C.greenText}}>Sin vencimientos en {CAL_CLI_DIAS} días</div>}
              {cal.noRev>0&&fila('nor',()=>setFtab('financiero'),<span style={{width:7,height:7,borderRadius:'50%',background:C.overdue,flexShrink:0}}/>,<span style={{color:C.overdueText,fontSize:11.5,fontWeight:600}}>{cal.noRev} causa{cal.noRev!==1?'s':''} sin revisar · falló la última revisión</span>,<span style={{fontSize:11,fontWeight:700,color:C.azulInfo,flexShrink:0}}>Ver <Gl n='chevron'/></span>)}
              {cal.seguimiento>0&&fila('seg',()=>setFtab('financiero'),<span style={{width:7,height:7,borderRadius:'50%',background:C.done,flexShrink:0}}/>,<span style={{color:C.text,fontSize:11.5}}>{cal.seguimiento} causa{cal.seguimiento!==1?'s':''} en seguimiento · sin tabla</span>,<span style={{fontSize:11,fontWeight:700,color:C.azulInfo,flexShrink:0}}>Ver <Gl n='chevron'/></span>)}
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700}}><span style={{color:C.muted,fontWeight:600,flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Obligaciones tributarias · {cal.oblTxt||'por definir'}</span><span onClick={()=>setElegir(v=>!v)} style={{color:C.azulInfo,cursor:'pointer',flexShrink:0}}>{elegir?'Listo':'Elegir'}</span></div>
              {elegir&&<div style={{display:'flex',flexWrap:'wrap',gap:6,padding:'10px 14px',borderTop:`1px solid ${C.bgSoft}`}}>{OBL_CLIENTE.map(([tp,fo,lb])=>{ const on=cal.elegidas.some(o=>o.tipo===tp&&String(o.formulario||'')===String(fo||''))
                return <span key={lb} onClick={()=>calCli.alternar(tp,fo,lb)} style={{fontSize:11.5,fontWeight:600,border:`1px solid ${on?C.accent:C.border}`,borderRadius:14,padding:'4px 10px',background:on?C.accent:C.surface,color:on?'#fff':C.muted,cursor:'pointer',whiteSpace:'nowrap'}}>{lb}</span> })}</div>}</>)
            // Escritorio: dos columnas (Por rendir · Próximas tareas | Vencidas · Calendario); celular: una columna en ese orden.
            const col=xs=><div style={{display:'flex',flexDirection:'column',gap:12,minWidth:0}}>{xs.filter(Boolean)}</div>
            return isDesktop
              ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:12,marginBottom:8,alignItems:'start'}}>{col(sRend?[sRend,sTar]:[sVenc,sTar])}{col(sRend?[sVenc,sCal]:[sCal])}</div>
              : <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:8}}>{[sRend,sVenc,sTar,sCal].filter(Boolean)}</div>
          })()}
          </>)
        })()}
  </>)
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

// Una causa: resumen + acciones + seguimiento (bitácora) detrás de su botón. En celular parte plegada (una línea) y se abre al tocar.
export function CausaFila({c, isDesktop, cliente=null, onCambio, user}){
  const D=isDesktop
  const [op,setOp]=useState(D), [verSeg,setVerSeg]=useState(false), [seg,setSeg]=useState(null), [busy,setBusy]=useState(false), [edit,setEdit]=useState(false), [rol,setRol]=useState(c.rol||'')
  const [e0,eCol,eBg]=_estadoCausa(c)
  const cargarSeg=()=>{ if(DEMO){ setSeg([{id:'s1',revisado_at:'2026-10-23T19:40:00Z',origen:'manual',resultado:'Sin tabla: la búsqueda por causa no trae programación.'}]); return }
    supabase.from('causas_seguimiento').select('*').eq('causa_id',c.id).order('revisado_at',{ascending:false}).limit(40).then(({data})=>setSeg(data||[]),()=>setSeg([])) }
  const toggleSeg=()=>{ if(!verSeg&&seg===null) cargarSeg(); setVerSeg(v=>!v) }
  const revisar=async()=>{ if(busy) return; setBusy(true)
    try{ if(DEMO){ appAlert('Revisión hecha (demo): sin cambios en la tabla.'); return }
      const {data,error}=await supabase.functions.invoke('causas-tablas',{body:{causa_id:c.id}})
      if(error||data?.error) throw new Error(data?.error||error?.message||'sin respuesta')
      const t=(data.en_tabla||[])[0]
      appAlert(data.errores?.length?`No se pudo revisar: ${data.errores[0].error}`:t?`En tabla: ${t.sala||''}${t.numero?`, N° ${t.numero}`:''}, ${fmtFechaDMY(t.fecha)}.${(data.avisos||[]).length?((data.avisos[0].enviado)?` Aviso enviado a ${[...data.avisos[0].para,...(data.avisos[0].cc||[])].join(', ')} desde la casilla de la oficina.`:` El aviso NO se envió (${data.avisos[0].motivo}).`):''}`:'No está en la tabla de hoy. Quedó en el seguimiento.')
      onCambio&&onCambio(); if(seg!==null) cargarSeg()
    }catch(err){ appAlert('No se pudo revisar la causa: '+(err.message||err)+'\n\nSi el agente aún no está activo, la revisión automática empieza al activarlo.') }
    finally{ setBusy(false) } }
  const guardar=async(patch,log)=>{ setBusy(true)
    try{ if(!DEMO){ const {error}=await supabase.from('causas').update({...patch,updated_at:new Date().toISOString()}).eq('id',c.id); if(error) throw error }
      logActividad(log,{tabla:'causas',id:c.id,detalle:{title:`${_rolTxt({...c,...patch})} · ${_corteCorta(c.corte_nombre)}`,antes:Object.fromEntries(Object.keys(patch).map(k=>[k,c[k]??null])),cliente:cliente||null}})
      onCambio&&onCambio({...c,...patch}) }catch(err){ appAlert('No se pudo guardar: '+(err.message||err)) }
    setBusy(false) }
  const confirmar=()=>{ if(!/^\d+$/.test(String(rol||''))){ setEdit(true); appAlert('Completa el rol de la causa antes de confirmarla.'); return } guardar({estado:'activa',rol:String(rol)},'causas.confirmada') }
  const ab={fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}
  const predio=String(c.origen||'').split(' · ')[0].trim()   // antecedente de primera instancia o predio (p. ej. «Tira Larga»)
  const detalle=[cliente, _rolTxt(c), predio||null, _libroLegible(c.libro_nombre), _corteCorta(c.corte_nombre), c.ultima_tabla?.sala&&c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())?`${c.ultima_tabla.sala}${c.ultima_tabla.numero?` · N° ${c.ultima_tabla.numero}`:''}${c.ultima_tabla.viendo?` · se está viendo el N° ${c.ultima_tabla.viendo}`:''}`:null, c.abogado].filter(Boolean).flatMap((x,i)=>i?[' · ',x]:[x]).map((x,i)=><Fragment key={i}>{x}</Fragment>)   // cliente puede venir como enlace (nodo): se intercala, no se une como texto
  const chip=<span style={{fontSize:11,fontWeight:600,color:eCol,background:eBg,borderRadius:12,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>{e0}</span>
  return (<div style={{borderTop:`1px solid ${C.track}`}}>
    <div onClick={D?undefined:()=>setOp(v=>!v)} style={{display:'flex',alignItems:'center',gap:10,padding:D?'10px 14px':'10px 12px',cursor:D?'default':'pointer'}}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13.5,fontWeight:600,color:C.text,...(D?{}:{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}}>{c.caratula||'Sin carátula'}</div>
        <div style={{fontSize:12,color:C.textSoft,marginTop:1}}>{D?detalle:[_rolTxt(c),predio].filter(Boolean).join(' · ')}</div>
      </div>
      {chip}
      {D?<div style={{display:'flex',gap:12,flexShrink:0}}>{c.estado==='por_confirmar'?<button onClick={confirmar} disabled={busy} style={ab}>Confirmar</button>:<button onClick={revisar} disabled={busy} style={ab}>{busy?'Revisando…':'Revisar ahora'}</button>}<button onClick={toggleSeg} style={ab}>{verSeg?'Ocultar seguimiento':'Seguimiento'}</button><button onClick={()=>setEdit(v=>!v)} style={{...ab,color:C.muted}}>Editar</button></div>
        :<span style={{color:C.done,fontSize:12,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {op&&<div style={{padding:D?'0 14px 10px':'0 12px 12px'}}>
      {!D&&<><div style={{fontSize:12,color:C.textSoft}}>{[_libroLegible(c.libro_nombre),_corteCorta(c.corte_nombre),c.abogado].filter(Boolean).join(' · ')}</div>{c.ultima_tabla?.sala&&c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())&&<div style={{fontSize:12,color:C.text,marginTop:2}}>{[c.ultima_tabla.sala,c.ultima_tabla.numero?`N° ${c.ultima_tabla.numero}`:'',c.ultima_tabla.viendo?`se está viendo el N° ${c.ultima_tabla.viendo}`:''].filter(Boolean).join(' · ')}</div>}
        <div style={{display:'flex',gap:14,marginTop:8,flexWrap:'wrap'}}>{c.estado==='por_confirmar'?<button onClick={confirmar} disabled={busy} style={ab}>Confirmar</button>:<button onClick={revisar} disabled={busy} style={ab}>{busy?'Revisando…':'Revisar ahora'}</button>}<button onClick={toggleSeg} style={ab}>Seguimiento</button><button onClick={()=>setEdit(v=>!v)} style={{...ab,color:C.muted}}>Editar</button></div></>}
      {edit&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
        <input value={rol} onChange={ev=>setRol(ev.target.value.replace(/\D/g,''))} placeholder='Rol' inputMode='numeric' style={{width:90,fontSize:13,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 9px',outline:'none'}}/>
        <span style={{fontSize:12.5,color:C.textSoft}}>-{c.anio}</span>
        <button disabled={busy||!rol} onClick={()=>{ guardar({rol:String(rol)},'causas.editada'); setEdit(false) }} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'7px 12px',cursor:'pointer',opacity:!rol?.5:1}}>Guardar</button>
        <button disabled={busy} onClick={async()=>{ if(await appConfirm('¿Dar por terminada esta causa? Deja de revisarse en las tablas.')){ guardar({estado:'terminada'},'causas.terminada') } }} style={{...ab,color:C.muted}}>Terminar causa</button>
      </div>}
      {verSeg&&<div style={{marginTop:8,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px'}}>
        <div style={{...SEC_LBL,fontSize:10,marginBottom:4}}>Seguimiento</div>
        {seg===null?<div style={{fontSize:12,color:C.textSoft}}>Cargando…</div>:!seg.length?<div style={{fontSize:12,color:C.textSoft}}>Sin revisiones todavía.</div>
          :seg.map(x=><div key={x.id} style={{display:'flex',flexDirection:D?'row':'column',gap:D?10:1,fontSize:12,padding:'3px 0'}}><span style={{color:C.textSoft,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmtFechaDMY(isoLocal(x.revisado_at))} {new Date(x.revisado_at).toTimeString().slice(0,5)}</span><span style={{minWidth:0}}><b style={{color:C.accent,fontWeight:600}}>{x.origen==='agente'?'Revisión automática':'Revisión manual'}</b> · {x.resultado}</span></div>)}
        <div style={{fontSize:11.5,color:C.textSoft,marginTop:5}}>Programación de Salas 3 veces al día · Monitor de Salas el día de la vista</div>
      </div>}
    </div>}
  </div>)
}

// Causas de una venta (Ficha › Ventas): lista + «+ Causa». En celular el bloque parte plegado en una línea con su resumen.
export function CausasVenta({client, sale, isDesktop, user, causas}){
  const D=isDesktop
  const {rows,setRows,recargar}=causas
  const [abierto,setAbierto]=useState(D), [nueva,setNueva]=useState(false), [busy,setBusy]=useState(false)
  const [f,setF]=useState({corte:'',libro:'',rol:'',anio:String(new Date().getFullYear()),caratula:'',abogado:sale.responsible||client.abogado_responsable||''})
  if(rows===null) return null
  const mias=rows.filter(c=>String(c.sale_id||'')===String(sale.id))
  const esSup=f.corte==='6050000'
  const listo=f.corte&&(esSup||f.libro)&&/^\d+$/.test(f.rol)&&/^\d{4}$/.test(f.anio)
  const guardar=async()=>{ if(!listo||busy) return; setBusy(true)
    try{ const corte=CORTES_PJUD.find(x=>x[0]===f.corte), libro=LIBROS_PJUD.find(x=>x[0]===f.libro)
      const row={client_id:client.id, sale_id:sale.id, abogado:f.abogado||null, instancia:esSup?'suprema':'apelaciones', corte_codigo:f.corte, corte_nombre:corte[1], libro_codigo:esSup?null:f.libro, libro_nombre:esSup?null:libro?.[1]||null, rol:String(Number(f.rol)), anio:Number(f.anio), caratula:f.caratula.trim()||null, estado:'activa', fuente:'manual', created_by:user?.name||null}
      let nuevo={...row,id:'demo-cz-'+Date.now()}
      if(!DEMO){ const {data,error}=await supabase.from('causas').insert(row).select().single(); if(error) throw new Error(/causas_unica|duplicate/.test(error.message)?'Esa causa ya está registrada.':error.message); nuevo=data }
      logActividad('causas.agregada',{tabla:'causas',id:nuevo.id,detalle:{title:`${_rolTxt(nuevo)} · ${_corteCorta(nuevo.corte_nombre)}`,cliente:client.name,venta:sale.title}})
      setRows(p=>[...(p||[]),nuevo]); setNueva(false); setF(x=>({...x,rol:'',caratula:''}))
      if(!DEMO){ const {data}=await supabase.functions.invoke('causas-tablas',{body:{causa_id:nuevo.id}}).catch(()=>({data:null})); const t=(data?.en_tabla||[])[0]; recargar(); appAlert(data?.ok?(t?`Causa guardada. Está en tabla: ${t.sala||''}${t.numero?`, N° ${t.numero}`:''}, ${fmtFechaDMY(t.fecha)}.`:'Causa guardada. Hoy no está en tabla; se revisa en los próximos horarios.'):'Causa guardada. Se revisa en los próximos horarios.') }
    }catch(err){ appAlert('No se pudo guardar la causa: '+(err.message||err)) }
    setBusy(false) }
  const fld=(label,el,st)=><label style={{display:'block',background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 10px',minWidth:0,...st}}><span style={{display:'block',fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.5}}>{label}</span>{el}</label>
  const inS={width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:'2px 0',minWidth:0}
  const nPc=mias.filter(c=>c.estado==='por_confirmar').length, nTab=mias.filter(c=>c.ultima_tabla?.fecha>=isoLocal(new Date().toISOString())).length
  const resumen=[nTab?`${nTab} en tabla`:null,nPc?`${nPc} por confirmar`:null].filter(Boolean).join(' · ')
  return (<div style={{marginTop:10,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:C.surface}} onClick={ev=>ev.stopPropagation()}>
    <div onClick={D?undefined:()=>setAbierto(v=>!v)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgPanel,cursor:D?'default':'pointer'}}>
      <span style={{...SEC_LBL,fontSize:10.5,flex:1}}>Causas{mias.length?` · ${mias.length}`:''}</span>
      {resumen&&<span style={{fontSize:11,fontWeight:600,color:nTab?C.accent:C.textSoft,background:nTab?C.azulBg:C.track,borderRadius:12,padding:'2px 8px',whiteSpace:'nowrap'}}>{resumen}</span>}
      {D?<button onClick={()=>setNueva(v=>!v)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Causa</button>
        :<span style={{color:C.done,fontSize:12,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {abierto&&<>
      {mias.map(c=><CausaFila key={c.id} c={c} isDesktop={D} user={user} onCambio={x=>x?setRows(p=>p.map(y=>y.id===x.id?x:y).filter(y=>y.estado!=='terminada')):recargar()}/>)}
      {!mias.length&&!nueva&&<div style={{fontSize:12,color:C.textSoft,padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>Sin causas en esta venta.</div>}
      {!D&&!nueva&&<div style={{padding:'9px 12px',borderTop:`1px solid ${C.track}`}}><button onClick={()=>setNueva(true)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Causa</button></div>}
      {nueva&&<div style={{borderTop:`1px solid ${C.track}`,padding:'11px 12px'}}>
        <div style={{...SEC_LBL,fontSize:10,marginBottom:8}}>Agregar causa a esta venta</div>
        <div style={{display:'grid',gridTemplateColumns:D?'minmax(0,1.6fr) minmax(0,1.3fr) minmax(0,.7fr) minmax(0,.6fr)':'1fr 1fr',gap:8}}>
          {fld('Corte',<select value={f.corte} onChange={ev=>setF(x=>({...x,corte:ev.target.value}))} style={inS}><option value=''>Elige la Corte</option>{CORTES_PJUD.map(([k,n])=><option key={k} value={k}>{n}</option>)}</select>,D?null:{gridColumn:'1 / -1'})}
          {!esSup&&fld('Libro',<select value={f.libro} onChange={ev=>setF(x=>({...x,libro:ev.target.value}))} style={inS}><option value=''>Elige el libro</option>{LIBROS_PJUD.map(([k,n])=><option key={k} value={k}>{_libroLegible(n)}</option>)}</select>,D?null:{gridColumn:'1 / -1'})}
          {fld('Rol',<input value={f.rol} onChange={ev=>setF(x=>({...x,rol:ev.target.value.replace(/\D/g,'')}))} inputMode='numeric' style={inS}/>,esSup&&D?{gridColumn:'span 2'}:null)}
          {fld('Año',<input value={f.anio} onChange={ev=>setF(x=>({...x,anio:ev.target.value.replace(/\D/g,'').slice(0,4)}))} inputMode='numeric' style={inS}/>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:D?'minmax(0,3fr) minmax(0,1fr) auto':'1fr',gap:8,marginTop:8,alignItems:'stretch'}}>
          {fld('Carátula',<input value={f.caratula} onChange={ev=>setF(x=>({...x,caratula:ev.target.value}))} style={inS}/>)}
          {fld('Abogado',<select value={f.abogado} onChange={ev=>setF(x=>({...x,abogado:ev.target.value}))} style={inS}><option value=''>—</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(n=><option key={n} value={n}>{n}</option>)}</select>)}
          <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:D?'flex-start':'flex-end'}}>
            <button onClick={()=>setNueva(false)} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
            <button disabled={!listo||busy} onClick={guardar} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'9px 13px',cursor:listo?'pointer':'default',opacity:listo&&!busy?1:.5,whiteSpace:'nowrap'}}>{busy?'Guardando…':'Guardar y revisar'}</button>
          </div>
        </div>
      </div>}
    </>}
  </div>)
}

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

export function PropiedadesVenta({client, sale, isDesktop, props}){
  const D=isDesktop
  const {rows,setRows}=props
  const [abierto,setAbierto]=useState(D), [q,setQ]=useState(''), [prop,setProp]=useState(''), [ab,setAb]=useState(()=>new Set()), [det,setDet]=useState(null), [todos,setTodos]=useState(()=>new Set())
  const [nuevo,setNuevo]=useState(false), [f,setF]=useState({comuna:'',rol:'',nombre:'',propietario:''}), [busy,setBusy]=useState(false)
  if(rows===null) return null
  const mias=rows.filter(p=>String(p.sale_id||'')===String(sale.id))
  if(!mias.length) return null
  const propietarios=[...new Set(mias.map(p=>p.propietario).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'))
  const qq=_normTxt(q)
  const lista=mias.filter(p=>(!prop||p.propietario===prop)&&(!qq||_normTxt(`${p.rol} ${p.lote||''} ${p.nombre||''} ${p.direccion||''} ${p.propietario||''} ${p.propietario_actual||''}`).includes(qq)))
  const hayFiltro=!!(qq||prop)
  const suma=(xs,k)=>xs.reduce((a,x)=>a+(Number(x[k])||0),0)
  const toggle=(set,k)=>set(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  // Grupos: comuna; si la comuna tiene muchos roles, se parte por destino (lo sin destino queda en «Otros roles de <comuna>»).
  const comunas={}; lista.forEach(p=>{ (comunas[p.comuna]=comunas[p.comuna]||[]).push(p) })
  const ordenC=Object.keys(comunas).sort((a,b)=>comunas[b].length-comunas[a].length||a.localeCompare(b,'es'))
  const subgrupos=(c,xs)=>{ if(xs.length<=12) return [[`${c}`,xs.slice().sort(_ordRol),false]]
    const g=_GRUPO_DESTINO.map(([d,t])=>[t,xs.filter(p=>p.destino===d)])
    g.push(['Sin propiedad en el SII',xs.filter(p=>p.estado_sii)])
    const usados=new Set(g.flatMap(x=>x[1]))
    g.push([`Otros roles de ${c}`,xs.filter(p=>!usados.has(p))])
    return g.filter(x=>x[1].length).map(([t,ys])=>[t,ys.slice().sort((a,b)=>(Number(b.deuda_contribuciones)||0)-(Number(a.deuda_contribuciones)||0)||_ordRol(a,b)),true]) }
  const monto=xs=>{ const d=suma(xs,'deuda_contribuciones'), a=suma(xs,'avaluo_fiscal')
    return <span style={{fontSize:12.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{a>0?fmtShort(a):''}{a>0&&d>0?' · ':''}{d>0&&<span style={{color:C.soonText}}>{fmtShort(d)} deuda</span>}</span> }
  const fila=(p,i)=>{ const op=det===p.id
    const sub=[p.lote?`Lote ${p.lote}`:null, _nomProp(p.propietario)||null, p.destino||(p.estado_sii?'Sin propiedad en el SII':null), D&&p.superficie_m2?`${Number(p.superficie_m2).toLocaleString('es-CL',{maximumFractionDigits:2})} m²`:null, D&&p.arrendado?'arrendado':null].filter(Boolean).join(' · ')
    const der=Number(p.deuda_contribuciones)>0?[fmtShort(p.deuda_contribuciones),'deuda',C.soonText]:Number(p.avaluo_fiscal)>0?[fmtShort(p.avaluo_fiscal),'avalúo',C.text]:null
    const dato=(l,v)=><div style={{minWidth:0}}><div style={{fontSize:11,color:C.textSoft}}>{l}</div><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{v||'—'}</div></div>
    return <div key={p.id}>
      <div onClick={()=>setDet(op?null:p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:D?'8px 12px 8px 30px':'8px 12px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{p.rol}{p.nombre?` · ${p.nombre}`:''}</div>
          <div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>{!p.nombre&&p.direccion?`${p.direccion} · `:''}{sub}</div></div>
        {der&&<div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:12.5,fontWeight:600,color:der[2],fontVariantNumeric:'tabular-nums'}}>{der[0]}</div><div style={{fontSize:11,color:C.textSoft}}>{der[1]}</div></div>}
      </div>
      {op&&<div style={{background:C.bgSoft,borderTop:`1px solid ${C.track}`,padding:D?'8px 12px 10px 30px':'8px 12px 10px',display:'grid',gridTemplateColumns:D?'repeat(3,minmax(0,1fr))':'1fr 1fr',gap:'8px 16px'}}>
        {dato('Inscripción',p.inscripcion_fojas?`Fs ${p.inscripcion_fojas} N° ${p.inscripcion_numero||'—'}${p.inscripcion_anio?` ${p.inscripcion_anio}`:''}`:null)}
        {dato('Propietario actual',_nomProp(p.propietario_actual))}
        {dato('Superficie',p.superficie_m2?`${Number(p.superficie_m2).toLocaleString('es-CL',{maximumFractionDigits:2})} m²`:null)}
        {dato('Avalúo fiscal',Number(p.avaluo_fiscal)>0?fmt(p.avaluo_fiscal):null)}
        {dato('Avalúo afecto',p.avaluo_afecto!=null?fmt(p.avaluo_afecto):null)}
        {dato('% de derecho',p.porcentaje_derecho!=null?`${Number(p.porcentaje_derecho).toLocaleString('es-CL')}%`:null)}
        {dato('Arriendo',p.arrendado?'Arrendado':null)}
        {dato('Deuda informada',Number(p.deuda_contribuciones)>0?fmt(p.deuda_contribuciones):null)}
        {dato('Origen',String(p.fuente||'').split(' · ').slice(-1)[0]||null)}
        {p.notas&&<div style={{gridColumn:'1 / -1',fontSize:12,color:C.muted}}>{p.notas}</div>}
      </div>}
    </div> }
  const grupo=(k,t,xs,nivel)=>{ const op=hayFiltro||ab.has(k), lim=todos.has(k)?xs.length:8
    return <div key={k} style={{borderTop:`1px solid ${C.track}`}}>
      <div onClick={()=>!hayFiltro&&toggle(setAb,k)} style={{display:'flex',alignItems:'center',gap:8,padding:nivel&&D?'10px 12px 10px 30px':'10px 12px',background:nivel?C.bgSoft:undefined,cursor:'pointer'}}>
        <span style={{fontSize:12,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
        <span style={{fontSize:nivel?13:13.5,fontWeight:700,color:nivel?C.text:C.accent,flex:1,minWidth:0}}>{t}</span>
        <span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap'}}>{xs.length} rol{xs.length!==1?'es':''}</span>
        {D&&monto(xs)}
      </div>
      {op&&<>{xs.slice(0,lim).map(fila)}{xs.length>lim&&<div style={{padding:D?'8px 12px 10px 30px':'8px 12px 10px',borderTop:`1px solid ${C.track}`}}><button onClick={()=>toggle(setTodos,k)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Ver los {xs.length}</button></div>}</>}
    </div> }
  const exportar=async()=>{ try{ const XLSX=await loadXLSXStyle()
    const data=lista.slice().sort((a,b)=>a.comuna.localeCompare(b.comuna,'es')||_ordRol(a,b)).map(p=>[p.comuna,p.rol,p.lote||'',p.nombre||p.direccion||'',p.destino||(p.estado_sii?'Sin propiedad en el SII':''),_nomProp(p.propietario),_nomProp(p.propietario_actual),p.inscripcion_fojas?`Fs ${p.inscripcion_fojas} N° ${p.inscripcion_numero||''} ${p.inscripcion_anio||''}`:'',Number(p.superficie_m2)||'',Number(p.avaluo_fiscal)||'',Number(p.deuda_contribuciones)||'',p.arrendado?'Sí':''])
    const ws=XLSX.utils.aoa_to_sheet([[`Roles · ${client.name} · ${sale.title}`],[],['Comuna','Rol','Lote','Nombre o dirección','Destino','Propietario','Propietario actual','Inscripción','Superficie m²','Avalúo fiscal','Deuda informada','Arrendado'],...data])
    ws['!cols']=[{wch:12},{wch:10},{wch:6},{wch:34},{wch:22},{wch:34},{wch:30},{wch:22},{wch:12},{wch:15},{wch:15},{wch:10}]
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Roles'); XLSX.writeFile(wb,`Roles ${client.name}.xlsx`) }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const listo=f.comuna.trim()&&/^\d+-\d+$/.test(f.rol.trim())
  const guardar=async()=>{ if(!listo||busy) return; setBusy(true)
    try{ const row={client_id:client.id,sale_id:sale.id,comuna:f.comuna.trim(),rol:f.rol.trim(),nombre:f.nombre.trim()||null,propietario:f.propietario.trim()||null,fuente:`Agregado a mano · ${isoLocal(new Date().toISOString())}`}
      let n={...row,id:'demo-pr-'+Date.now()}
      if(!DEMO){ const {data,error}=await supabase.from('propiedades').insert(row).select().single(); if(error) throw new Error(/duplicate|unique/.test(error.message)?'Ese rol ya está registrado para este cliente.':error.message); n=data }
      logActividad('propiedades.agregada',{tabla:'propiedades',id:n.id,detalle:{title:`Rol ${n.comuna} ${n.rol}`,cliente:client.name,venta:sale.title}})
      setRows(p=>[...(p||[]),n]); setNuevo(false); setF(x=>({...x,rol:'',nombre:''}))
    }catch(err){ appAlert('No se pudo guardar el rol: '+(err.message||err)) }
    setBusy(false) }
  const inS={width:'100%',border:'none',background:'none',outline:'none',fontSize:13,color:C.text,padding:'2px 0',minWidth:0}
  const fld=(label,el)=><label style={{display:'block',background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 10px',minWidth:0}}><span style={{display:'block',fontSize:8,color:C.textSoft,textTransform:'uppercase',letterSpacing:.4,fontWeight:700}}>{label}</span>{el}</label>
  const selSty={fontSize:12.5,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 8px',minWidth:0,maxWidth:D?220:'100%'}
  return (<div style={{marginTop:10,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:C.surface}} onClick={ev=>ev.stopPropagation()}>
    <div onClick={()=>setAbierto(v=>!v)} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgPanel,cursor:'pointer'}}>
      <span style={{...SEC_LBL,fontSize:10.5}}>Roles · {mias.length}</span>
      {D&&<span style={{fontSize:12,color:C.textSoft,flex:1}}>{[suma(mias,'avaluo_fiscal')>0?`${fmtShort(suma(mias,'avaluo_fiscal'))} avalúo`:null,suma(mias,'deuda_contribuciones')>0?`${fmtShort(suma(mias,'deuda_contribuciones'))} deuda`:null].filter(Boolean).join(' · ')}</span>}
      {!D&&<span style={{flex:1}}/>}
      {abierto&&D?<button onClick={ev=>{ev.stopPropagation();setNuevo(v=>!v)}} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Rol</button>
        :<span style={{color:C.done,fontSize:12,transform:abierto?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
    </div>
    {abierto&&<>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>
        <div style={{flex:D?'1 1 220px':'1 1 100%',display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',minWidth:0}}>
          <SIcon n='search' s={14} c={C.done}/>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder={D?'Buscar rol, lote, dirección o propietario':'Buscar rol o propietario'} style={{border:'none',background:'none',outline:'none',fontSize:12.5,color:C.text,width:'100%',minWidth:0}}/>
        </div>
        {propietarios.length>1&&<select value={prop} onChange={e=>setProp(e.target.value)} style={selSty}><option value=''>Todos los propietarios</option>{propietarios.map(x=><option key={x} value={x}>{_nomProp(x)}</option>)}</select>}
        {D&&<button onClick={exportar} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Excel</button>}
        {!D&&<button onClick={()=>setNuevo(v=>!v)} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>+ Rol</button>}
      </div>
      {nuevo&&<div style={{borderTop:`1px solid ${C.track}`,padding:'10px 12px',display:'grid',gridTemplateColumns:D?'minmax(0,1fr) minmax(0,.7fr) minmax(0,1.3fr) minmax(0,1.3fr) auto':'1fr 1fr',gap:8,alignItems:'stretch'}}>
        {fld('Comuna',<input value={f.comuna} onChange={e=>setF(x=>({...x,comuna:e.target.value}))} style={inS}/>)}
        {fld('Rol',<input value={f.rol} onChange={e=>setF(x=>({...x,rol:e.target.value.replace(/[^\d-]/g,'')}))} placeholder='1100-60' inputMode='numeric' style={inS}/>)}
        {fld('Nombre o dirección',<input value={f.nombre} onChange={e=>setF(x=>({...x,nombre:e.target.value}))} style={inS}/>)}
        {fld('Propietario',<input value={f.propietario} onChange={e=>setF(x=>({...x,propietario:e.target.value}))} list={`prop-${sale.id}`} style={inS}/>)}
        <datalist id={`prop-${sale.id}`}>{propietarios.map(x=><option key={x} value={x}/>)}</datalist>
        <div style={{display:'flex',gap:8,alignItems:'center',justifyContent:'flex-end',gridColumn:D?undefined:'1 / -1'}}>
          <button onClick={()=>setNuevo(false)} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
          <button disabled={!listo||busy} onClick={guardar} style={{fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',padding:'9px 13px',cursor:listo?'pointer':'default',opacity:listo&&!busy?1:.5,whiteSpace:'nowrap'}}>{busy?'Guardando…':'Guardar'}</button>
        </div>
      </div>}
      {ordenC.map(c=>{ const xs=comunas[c], sg=subgrupos(c,xs); const op=hayFiltro||ab.has('c:'+c)
        if(sg.length===1&&!sg[0][2]) return grupo('c:'+c,c,sg[0][1],0)
        return <div key={c} style={{borderTop:`1px solid ${C.track}`}}>
          <div onClick={()=>!hayFiltro&&toggle(setAb,'c:'+c)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer'}}>
            <span style={{fontSize:12,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            <span style={{fontSize:13.5,fontWeight:700,color:C.accent,flex:1,minWidth:0}}>{c}</span>
            <span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap'}}>{xs.length} roles</span>{D&&monto(xs)}
          </div>
          {op&&sg.map(([t,ys])=>grupo(`g:${c}:${t}`,t,ys,1))}
        </div> })}
      {!lista.length&&<div style={{fontSize:12,color:C.textSoft,padding:'10px 12px',borderTop:`1px solid ${C.track}`}}>Ningún rol con esos filtros.</div>}
    </>}
  </div>)
}

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
  {g:'Cobro · hoy',k:'pfat',l:'Por facturar atrasado',ls:'Por facturar',f:'$',per:'hoy'},
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

// Vista Por socio (Facturación › Por socio e Inteligencia › Socios): Resumen · Comparativo · Datos. Render aprobado 19-10-2026 (ABU5j4gotedSVCZJkE9kG2).
export function PorSocioVista({billing=[],sales=[],clients=[],anticipos=[],terceros=[],expenses=[],fantasmaIds=null,tabIni='res',onOpenClientFicha,onIrBanco,onIrBilling,onIrCobranza,onIrProveedores,onIrSubarriendo}){
  const isDesk=useIsDesktop()
  const [fu,setFu]=usePorSocioFuentes()
  const ufState=useUF(); const ufRef=ufState.uf||UF_FALLBACK
  const noEmitir=useNoEmitirSet()
  const bill=useMemo(()=>(fantasmaIds&&fantasmaIds.size)?(billing||[]).filter(b=>!fantasmaIds.has(String(b.id))):billing,[billing,fantasmaIds])
  const ufFechas=useUFFechas(bill)
  const COLS=ADMIN_NAMES.concat([SIN_SOCIO])
  const tinta={[ADMIN_NAMES[0]]:C.accent,[ADMIN_NAMES[1]]:C.tealText,[SIN_SOCIO]:C.soonText,Oficina:C.greenText}
  const _now=new Date(); const curYM=`${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}`
  const [tab,setTab]=useState(tabIni)
  const [ym,setYm]=useState(curYM)
  const [vista,setVista]=useState('ytd')
  const [ps,setPs0]=useState(()=>_lsGet('porsocio_ps',false)); const setPs=v=>{ setPs0(v); _lsSet('porsocio_ps',v) }
  const [sec,setSec]=useState({f:false,c:false})
  const [open,setOpen]=useState(null)
  const [verTodo,setVerTodo]=useState(false)
  const [mm,setMm]=useState('c')
  const [rev,setRev]=useState(null)
  const [kpis,setKpis0]=useState(()=>{ const v=_lsGet('porsocio_kpis',PS_KPI_DEF); return (Array.isArray(v)?v:PS_KPI_DEF).map(k=>({fneto:'fac',ext:'cext'})[k]||k).filter((k,i,a)=>PS_KPIS.some(x=>x.k===k)&&a.indexOf(k)===i) }); const setKpis=v=>{ setKpis0(v); _lsSet('porsocio_kpis',v) }
  const [pick,setPick]=useState(false)
  const [kopen,setKopen]=useState(null)
  const [dat,setDat]=useState({sec:'f',con:'pre',soc:null,q:'',ord:'f',lim:40})
  const [fondoExtra,setFondoExtra]=useState({})
  const [ligando,setLigando]=useState(null)
  const shift=n=>{ const [yy,mo]=ym.split('-').map(Number); const d=new Date(yy,mo-1+n,1); const nym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; if(nym<=curYM){ setYm(nym); setOpen(null); setKopen(null) } }
  const y=Number(ym.slice(0,4)), mo=Number(ym.slice(5,7))
  const MN=MES_L, mesLbl=`${MN[mo-1].charAt(0).toUpperCase()+MN[mo-1].slice(1)}`
  const perLbl=p=>p==='mes'?`${mesLbl} ${y}`:(mo===1?`enero ${y}`:`ene–${MES_C[mo-1]} ${y}`)
  const inPer=(d,p)=>{ const s=String(d||'').slice(0,7); return p==='mes'?s===ym:(s>=`${y}-01`&&s<=ym) }
  const saleById=useMemo(()=>{const m={};(sales||[]).forEach(s=>{ if(s) m[String(s.id)]=s });return m},[sales])
  const cliById=useMemo(()=>{const m={};(clients||[]).forEach(c=>{ if(c) m[String(c.id)]=c });return m},[clients])
  const billById=useMemo(()=>{const m={};(billing||[]).forEach(b=>{ if(b) m[String(b.id)]=b });return m},[billing])
  const ctx={saleById,cliById,ov:fu.ov}
  const P=useMemo(()=>partidasPorSocio({billing,sales,clients,anticipos,terceros,expenses,ic:fu.ic,ia:fu.ia,ov:fu.ov,fondoExtra}),[billing,sales,clients,anticipos,terceros,expenses,fu,fondoExtra])
  const V=useMemo(()=>vendidoPorSocio(sales,clients,ufRef,y),[sales,clients,ufRef,y])
  // «Sin socio» dice de quién es: los abogados no socios dueños de sus partidas del año (venta.responsible → abogado del cliente).
  const sinAbos=useMemo(()=>{ const set=new Set(); P.forEach(r=>{ if(r.soc!==SIN_SOCIO||r.k==='sub'||!String(r.d).startsWith(String(y))) return; const b=r.bid&&billById[String(r.bid)], sv=b&&b.sale_id&&saleById[String(b.sale_id)], a=(sv&&sv.responsible)||cliById[String(r.cid)]?.abogado_responsable; if(a&&!ADMIN_NAMES.includes(a)) set.add(a) }); return [...set].sort() },[P,y,billById,saleById,cliById])
  const Ls=c=>c!==SIN_SOCIO?c:sinAbos.length===1?sinAbos[0]:sinAbos.length?'Otros':SIN_SOCIO   // encabezados angostos
  const L=c=>c!==SIN_SOCIO?c:!sinAbos.length?SIN_SOCIO:sinAbos.length===1?`${SIN_SOCIO} · ${sinAbos[0]}`:'Otros abogados'
  const F=useMemo(()=>flujoCajaProyectado({billing:bill,sales,anticipos,noEmitir,ufFechas}),[bill,sales,anticipos,noEmitir,ufFechas])
  const sumP=(s,k,soc,p)=>P.reduce((a,r)=>a+((r.s===s&&(k==null||(Array.isArray(k)?k.includes(r.k):r.k===k))&&(!soc||r.soc===soc)&&inPer(r.d,p))?r.m:0),0)
  const vend=(soc,p)=>V.reduce((a,x)=>a+((!soc||x.soc===soc)&&(p==='mes'?x.ym===ym:x.ym<=ym)?x.m:0),0)
  // [Vendido, Facturado, Cobrado propio, Comisiones pagadas, Comisiones percibidas, Ingreso real, Subarriendo (aparte)]
  const KF=['emit','cext','reemb','nc'], KC=['fac','ant','reemb'], KI=[...KC,'com','perc']
  const card6=(soc,p)=>{ const fac=sumP('f',KF,soc,p), cp=sumP('c',KC,soc,p), com=-sumP('c','com',soc,p), pe=sumP('c','perc',soc,p); return [vend(soc,p),fac,cp,com,pe,cp-com+pe,sumP('c','sub',soc,p)] }
  const P$=v=>(v<0?'−':'')+fmt(Math.abs(Math.round(v)))
  const FMT=v=>isDesk?P$(v):fmtMillLR(v)
  const nm=cid=>cliById[String(cid)]?.name||'Sin cliente'
  const irA=it=>{ if(it.mov&&onIrBanco) return onIrBanco(it.mov); if(it.k==='com'&&onIrProveedores) return onIrProveedores(); if(it.k==='sub'&&onIrSubarriendo) return onIrSubarriendo(); if(it.cid&&onOpenClientFicha) return onOpenClientFicha(it.cid) }
  const irDatos=(soc,i,p)=>{ setVista(p); if(i===0){ setTab('cmp'); return } setDat(d=>({...d,sec:i===1?'f':'c',con:[null,'pre','cp','com','perc','pre','sub'][i],soc,lim:40})); setTab('dat') }
  const lista=(items,tit)=>{ const tot=items.reduce((a,x)=>a+x.m,0), shown=verTodo?items:items.slice(0,8)
    return <div style={{background:C.bgSoft}}>
      <div style={{display:'flex',justifyContent:'space-between',padding:isDesk?'7px 16px':'7px 10px',...SEC_LBL,fontWeight:800}}><span>{tit} · {items.length}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{P$(tot)}</span></div>
      {shown.map((x,j)=><div key={j} onClick={()=>irA(x)} className='er-c' style={{display:'flex',alignItems:'center',gap:10,padding:isDesk?'7px 16px':'7px 10px',borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>
        {diaGrande(x.d)}
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(x.cid)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[x.doc,isDesk?x.det:(x.doc?null:x.det)].filter(Boolean).join(' · ')}</div></div>
        <span style={{fontSize:12.5,fontWeight:800,color:x.m<0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(x.m)}</span><span style={{color:C.textSoft}}><Gl n='chevron'/></span></div>)}
      {items.length>8&&<div onClick={()=>setVerTodo(v=>!v)} style={{textAlign:'center',padding:8,fontSize:11.5,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>{verTodo?'Ver menos':`Ver las ${items.length}`}</div>}
    </div> }

  // ── Tarjetas: Oficina arriba, socios abajo · Octubre y Acumulado · pesos exactos (cuadran en toda dirección)
  const pcY=(()=>{ const v=COLS.map(s=>card6(s,'ytd')[5]), t=v.reduce((a,x)=>a+x,0); return t>0?redondearPartes(v.map(x=>x/t*100),1):v.map(()=>0) })()
  const filasCard=[['ref','Vendido',0],['ref','Facturado',1],['sep','Cobrado propio',2],['','− Com. pagadas',3],['','+ Com. percibidas',4],['res','= Ingreso real',5]]
  const tdC=(v,i,soc,p,col,big)=>{ const on=Math.abs(v)>=1; return <td onClick={on?()=>irDatos(soc,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'4px 0 4px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:big?(isDesk?19:13.5):i===5?13.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none'}}>{on?P$(v):'—'}</td> }
  const cardSocio=(soc,col)=>{ const m=card6(soc,'mes'), a=card6(soc,'ytd'), pc=soc?pcY[COLS.indexOf(soc)]:0, filas=soc?filasCard:[...filasCard,['apt','Subarriendo',6]]
    return <div key={soc||'of'} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:isDesk?'12px 16px 10px':'11px 12px 8px',minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col,flexShrink:0}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>{soc?L(soc):'Oficina'} <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted,whiteSpace:'nowrap'}}>{soc?`${pc}% del ingreso real${isDesk?' del año':''}`:'ingreso real del año'}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup><col style={{width:'40%'}}/><col style={{width:'28%'}}/><col style={{width:'32%'}}/></colgroup>
        <thead><tr><th/>{[mesLbl,'Acumulado'].map(h=><th key={h} style={{fontSize:9.5,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'4px 0 4px 8px',color:C.muted,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{filas.map(([cl,l,i])=><tr key={i}><td style={{fontSize:i===5?12.5:12,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.muted,padding:'4px 0',borderTop:i===5?`1.5px solid ${col}`:i===2?`1px solid ${C.border}`:i===6?`1px dashed ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{tdC(m[i],i,soc,'mes',col,!soc&&i===5)}{tdC(a[i],i,soc,'ytd',col,!soc&&i===5)}</tr>)}</tbody></table></div> }
  const cardOficinaAncha=()=>{ const m=card6(null,'mes'), a=card6(null,'ytd'), col=C.greenText, socsPc=COLS.map((s,i)=>`${L(s)} ${pcY[i]}%`).join(' · ')
    const hdr=['Vendido','Facturado','Cobrado propio','− Com. pagadas','+ Com. percibidas','= Ingreso real','Subarriendo · aparte'], wH=['12%','11%','12%','12%','12%','12%','15%','14%']
    return <div style={{gridColumn:'1/-1',background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 16px 10px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}><span style={{width:9,height:9,borderRadius:'50%',background:col}}/><span onClick={()=>{ setTab('res'); setPs(true); setSec({f:true,c:true}) }} style={{fontSize:11,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:col,cursor:'pointer'}}>Oficina <Gl n='chevron'/></span><span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:C.muted}}>{socsPc} del ingreso real del año</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{wH.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr><th/>{hdr.map((h,i)=><th key={h} style={{fontSize:9.5,fontWeight:800,letterSpacing:.4,textTransform:'uppercase',textAlign:'right',padding:'6px 0 6px 8px',color:i===6?C.done:C.muted,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{[[mesLbl,m,'mes'],[`Acumulado ${y}`,a,'ytd']].map(([l,v,p],r)=><tr key={p}><td style={{fontSize:13,fontWeight:600,color:C.muted,padding:'6px 0',borderTop:r?`1px solid ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</td>{v.map((x,i)=>{ const on=Math.abs(x)>=1; return <td key={i} onClick={on?()=>irDatos(null,i,p):undefined} className={on?'er-c':undefined} style={{textAlign:'right',padding:'6px 0 6px 8px',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',cursor:on?'pointer':'default',fontSize:i===5?19:14,fontWeight:i===5?800:600,color:i===6?C.done:i===5?col:i<2?C.textSoft:C.text,borderTop:r?`1px solid ${C.border}`:'none'}}>{on?P$(x):'—'}</td> })}</tr>)}</tbody></table></div> }

  // ── Composición (plegada) y mes a mes: escritorio en pesos; celular en $M con cada columna cuadrada (redondearPartes)
  // Fila sin clave = subtotal (suma de las filas anteriores); el subarriendo va aparte, debajo, sin sumar.
  const FF=[['emit','','Facturas emitidas','Emitidas'],['cext','+','Comisión de externos','Com. externos'],['reemb','−','Reembolsos de gastos','Reembolsos'],['nc','−','Notas de crédito','NC']]
  const FC=[['fac','','Cobrado de facturas','De facturas'],['ant','+','Anticipos','Anticipos'],['reemb','−','Reembolsos de gastos','Reembolsos'],[null,'=','Cobrado propio','Cobrado propio'],['com','−','Comisiones pagadas','Com. pagadas'],['perc','+','Comisiones percibidas','Percibidas']]
  const colsT=ps?(isDesk?[null,...COLS]:COLS):[null]
  const th={fontSize:isDesk?10:9,fontWeight:800,letterSpacing:.3,textTransform:'uppercase',padding:isDesk?'8px 12px':'8px 5px',textAlign:'right',whiteSpace:'nowrap',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}
  const td={padding:isDesk?'8px 12px':'8px 5px',borderTop:`1px solid ${C.border}`,fontSize:isDesk?(ps?12:12.5):11.5,whiteSpace:'nowrap',textAlign:'right',fontVariantNumeric:'tabular-nums'}
  const sgn={display:'inline-block',width:isDesk?13:10,textAlign:'center',fontWeight:700,color:C.muted}
  const wCols=n=>n===1?['60%','40%']:n===3?['34%','22%','22%','22%']:['24%','19%','19%','19%','19%']
  const valsCol=(s,keys,soc,p)=>{ const a=keys.map(k=>sumP(s,k,soc,p)); return isDesk?a:redondearPartes(a,1e5) }
  const Comp=()=>{ const p=vista
    const seccion=(s,lab,rows,netLab,aparte)=>{ const ab=sec[s], keys=rows.filter(r=>r[0]).map(r=>r[0]), cv=colsT.map(soc=>valsCol(s,keys,soc,p)); let ri=0
      const apV=aparte?colsT.map(soc=>sumP(s,aparte,soc,p)):null, apO=aparte&&open&&open.s===s&&open.k===aparte
      return <Fragment key={s}>
        <tr onClick={()=>setSec(x=>({...x,[s]:!x[s]}))} style={{cursor:'pointer'}}><td colSpan={colsT.length+1} style={{padding:isDesk?'12px 16px 5px':'11px 8px 5px',...SEC_LBL,fontWeight:800,borderTop:`1px solid ${C.border}`}}>{lab} <span style={{color:C.textSoft,display:'inline-block'}}><ChevAb open={ab}/></span></td></tr>
        {ab&&rows.map(([k,sg,lg,sh])=>{ if(!k){ const sv=cv.map(a=>a.slice(0,ri).reduce((x,v)=>x+v,0)); return <tr key={lg}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.accent,fontWeight:700,background:C.bgSoft}}><span style={{...sgn,color:C.accent}}>{sg}</span>{ps&&isDesk?sh:(isDesk?lg:sh)}</td>{sv.map((v,j)=><td key={j} style={{...td,fontWeight:700,color:C.accent,background:C.bgSoft,paddingRight:j===sv.length-1?(isDesk?16:8):undefined}}>{FMT(v)}</td>)}</tr> }
          const i=ri++; if(cv.every(a=>Math.abs(a[i])<1)) return null; const isO=open&&open.s===s&&open.k===k
          return <Fragment key={k}><tr>
            <td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.muted,fontWeight:600}}><span style={sgn}>{sg}</span>{ps&&isDesk?sh:(isDesk?lg:sh)}</td>
            {cv.map((a,j)=>{ const v=Math.abs(a[i]), soc=colsT[j], sel=isO&&open.soc===soc; return <td key={j} onClick={v>=1?()=>{ setVerTodo(false); setOpen(o=>(o&&o.s===s&&o.k===k&&o.soc===soc)?null:{s,k,soc}) }:undefined} style={{...td,fontWeight:soc===null&&ps?800:700,color:v>=1?(soc===null&&ps?C.accent:C.text):C.done,cursor:v>=1?'pointer':'default',background:sel?C.azulBg:undefined,paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{v>=1?FMT(v):'—'}</td> })}
          </tr>{isO&&<tr><td colSpan={colsT.length+1} style={{padding:0}}>{lista(P.filter(r=>r.s===s&&r.k===k&&(!open.soc||r.soc===open.soc)&&inPer(r.d,p)).sort((a,b)=>Math.abs(b.m)-Math.abs(a.m)),`${open.soc?L(open.soc):'Oficina'} · ${lg}`)}</td></tr>}</Fragment> })}
        <tr onClick={s==='f'?onIrBilling:onIrCobranza} style={{cursor:'pointer'}}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}><span style={{...sgn,color:C.accent}}>=</span>{netLab} <Gl n='chevron'/></td>
          {cv.map((a,j)=>{ const n=a.reduce((x,v)=>x+v,0); return <td key={j} style={{...td,fontWeight:800,fontSize:isDesk?(ps?12.5:14):12.5,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{FMT(n)}</td> })}</tr>
        {apV&&apV.some(v=>Math.abs(v)>=1)&&<><tr><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.done,fontWeight:600,borderTop:`1px dashed ${C.border}`}}><span style={sgn}/>{isDesk?'Subarriendo · aparte':'Subarriendo'}</td>
          {apV.map((v,j)=>{ const soc=colsT[j]; return <td key={j} onClick={Math.abs(v)>=1?()=>{ setVerTodo(false); setOpen(o=>(o&&o.s===s&&o.k===aparte&&o.soc===soc)?null:{s,k:aparte,soc}) }:undefined} style={{...td,color:C.done,fontWeight:600,borderTop:`1px dashed ${C.border}`,cursor:Math.abs(v)>=1?'pointer':'default',background:apO&&open.soc===soc?C.azulBg:undefined,paddingRight:j===apV.length-1?(isDesk?16:8):undefined}}>{Math.abs(v)>=1?FMT(v):'—'}</td> })}</tr>
          {apO&&<tr><td colSpan={colsT.length+1} style={{padding:0}}>{lista(P.filter(r=>r.s===s&&r.k===aparte&&(!open.soc||r.soc===open.soc)&&inPer(r.d,p)).sort((a,b)=>Math.abs(b.m)-Math.abs(a.m)),`${open.soc?L(open.soc):'Oficina'} · Subarriendo`)}</td></tr>}</>}
      </Fragment> }
    return <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{wCols(colsT.length).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
      <thead><tr><th style={{...th,textAlign:'left'}}/>{colsT.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===colsT.length-1?(isDesk?16:8):undefined}}>{c?Ls(c):'Oficina'}</th>)}</tr></thead>
      <tbody>{seccion('f','Facturado',FF,'Facturado')}{seccion('c','Cobrado',FC,'Ingreso real','sub')}</tbody></table> }
  const MesAMes=()=>{ const s=mm, nMes=mo
    const ks=s==='c'?KI:KF
    const cv=colsT.map(soc=>{ const a=Array.from({length:nMes},(_,i)=>P.reduce((x,r)=>x+((r.s===s&&ks.includes(r.k)&&(!soc||r.soc===soc)&&String(r.d).startsWith(`${y}-${String(i+1).padStart(2,'0')}`))?r.m:0),0)); return isDesk?a:redondearPartes(a,1e5) })
    const socIdx=colsT.map((c,j)=>c?j:-1).filter(j=>j>=0)
    return <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{(colsT.length===1?['60%','40%']:colsT.length===3?['28%','24%','24%','24%']:['24%','19%','19%','19%','19%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
      <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Mes</th>{colsT.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===colsT.length-1?(isDesk?16:8):undefined}}>{c?Ls(c):'Oficina'}</th>)}</tr></thead>
      <tbody>{Array.from({length:nMes},(_,k)=>nMes-1-k).map(i=>{ const vs=cv.map(a=>a[i]); const a0=socIdx.length>1?vs[socIdx[0]]:null, a1=socIdx.length>1?vs[socIdx[1]]:null, mx=a0==null?-1:(a0>=a1?socIdx[0]:socIdx[1]); const ymI=`${y}-${String(i+1).padStart(2,'0')}`, sel=vista==='mes'&&ym===ymI
        return <tr key={i} onClick={()=>{ setYm(ymI); setVista('mes'); setOpen(null) }} className='er-c' style={{cursor:'pointer',background:sel?C.azulBg:undefined}}><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,color:C.accent,fontWeight:700}}>{isDesk?mesTitulo(new Date(y,i,15)).split(' ')[0]:MES_C[i]}</td>
          {vs.map((v,j)=><td key={j} style={{...td,fontWeight:colsT[j]===null?800:700,color:Math.abs(v)<1?C.done:colsT[j]===null?C.accent:(j===mx?tinta[colsT[j]]:C.text),paddingRight:j===vs.length-1?(isDesk?16:8):undefined}}>{Math.abs(v)>=1?FMT(v):'—'}</td>)}</tr> })}
        <tr><td style={{...td,textAlign:'left',paddingLeft:isDesk?16:8,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}>{y}</td>{cv.map((a,j)=><td key={j} style={{...td,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===cv.length-1?(isDesk?16:8):undefined}}>{FMT(a.reduce((x,v)=>x+v,0))}</td>)}</tr>
      </tbody></table> }

  // ── Para revisar (compuerta → aprende → no vuelve a preguntar)
  const fondoEnFac=useMemo(()=>{ const m={}; (expenses||[]).forEach(e=>{ const inv=fondoExtra[String(e?.id)]||e?.invoice_id; if(e&&!e.deleted_at&&e.type==='fondo'&&inv) m[String(inv)]=true }); return m },[expenses,fondoExtra])
  // Gasto dentro de una factura de honorarios: la factura menciona un gasto Y el cliente tiene un fondo sin depósito propio
  // (sin conciliación) dentro de ±31 días de la emisión o el pago y menor que la factura → esa plata vino dentro de la factura.
  // Si el fondo entró en su propia transferencia (conciliado), la factura es honorario puro y no se marca.
  const fondoCand=useMemo(()=>{ const m={}; const dd=(a,b)=>Math.abs(new Date(String(a).slice(0,10))-new Date(String(b).slice(0,10)))/864e5
    ;(billing||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||b.billing_type!=='honorarios'||b.status==='Anulada'||String(b.issued_at||'').slice(0,4)!==String(y)) return
      if(!PS_RX_GASTO.test(String(b.concept||'')+' '+String((String(b.dte_xml||'').match(/<NmbItem>(.*?)<\/NmbItem>/)||[])[1]||''))) return
      const mf=montoFactura(b)||Number(b.amount)||0
      const fs=(expenses||[]).filter(e=>e&&!e.deleted_at&&e.type==='fondo'&&String(e.client_id)===String(b.client_id)&&!e.invoice_id&&!fondoExtra[String(e.id)]&&!fu.gc.has(String(e.id))&&(Number(e.amount)||0)<mf&&[b.issued_at,b.paid_at].some(x=>x&&dd(x,e.date)<=31))
      if(fs.length) m[String(b.id)]=fs })
    return m },[billing,expenses,y,fondoExtra,fu.gc])
  const revTram=useMemo(()=>(billing||[]).filter(b=>b&&fondoCand[String(b.id)]&&!fondoEnFac[String(b.id)]&&!fu.hok.has(String(b.id))),[billing,fondoCand,fondoEnFac,fu.hok])
  const revCuo=useMemo(()=>(billing||[]).filter(b=>b&&!b.deleted_at&&!b.invoice_no&&b.issued_at&&!['Programada','Anulada'].includes(b.status)&&b.billing_type!=='reembolso'),[billing])
  const revBda=useMemo(()=>(billing||[]).filter(b=>b&&!b.deleted_at&&b.invoice_no&&b.status!=='Anulada'&&(b.billing_type==='comision'||(b.sale_id&&/^comisi/i.test(String(saleById[String(b.sale_id)]?.title||''))))&&!fu.ov[String(b.id)]),[billing,saleById,fu.ov])
  const esHonorario=async b=>{ setFu(f=>({...f,hok:new Set([...f.hok,String(b.id)])})); if(!DEMO){ await setLearningKV('honorario_sin_gasto',b.id,'1'); logActividad('honorario_sin_gasto',{tabla:'billing',id:b.id,detalle:b}) } }
  const ligar=async(b,e)=>{ setFondoExtra(x=>({...x,[String(e.id)]:b.id})); setLigando(null); if(!DEMO){ const {error}=await supabase.from('expenses').update({invoice_id:b.id}).eq('id',e.id).is('invoice_id',null); if(error){ appAlert('No se pudo ligar el gasto: '+error.message); return } logActividad('fondo_ligado_factura',{tabla:'expenses',id:e.id,detalle:{invoice_no:b.invoice_no,monto:e.amount}}) } }
  const asignar=async(b,soc)=>{ setFu(f=>({...f,ov:{...f.ov,[String(b.id)]:soc}})); if(!DEMO){ await setLearningKV('socio_factura',b.id,soc); logActividad('socio_factura',{tabla:'billing',id:b.id,detalle:{invoice_no:b.invoice_no,persona:soc}}) } }
  const revTile=(k,ic,ibg,icol,lab,val,vcol)=>{ const on=rev===k; return <div key={k} onClick={()=>setRev(r=>r===k?null:k)} style={{background:C.card,border:`1px solid ${on?C.accent:C.border}`,borderRadius:10,padding:isDesk?'10px 16px':'10px 12px',display:'flex',gap:10,alignItems:'center',cursor:'pointer',minWidth:0}}>
      <span style={{width:28,height:28,borderRadius:8,background:ibg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={15} c={icol}/></span>
      <div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lab}</div><div style={{fontSize:15,fontWeight:800,color:vcol,fontVariantNumeric:'tabular-nums'}}>{val}</div></div><span style={{color:C.textSoft}}><ChevAb open={on}/></span></div> }
  const grupoSocio=(arr,fn)=>COLS.map(soc=>{ const its=arr.filter(b=>socioDe(b,ctx)===soc); if(!its.length) return null; return <Fragment key={soc}><div style={{display:'flex',justifyContent:'space-between',padding:isDesk?'8px 16px':'8px 10px',fontSize:11,fontWeight:800,color:C.accent,borderTop:`1px solid ${C.border}`}}><span>{L(soc)} · {its.length}</span><span style={{fontVariantNumeric:'tabular-nums'}}>{P$(its.reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0))}</span></div>{its.map(fn)}</Fragment> })
  const filaRev=(b,der,sub)=><div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:isDesk?'7px 16px':'7px 10px',borderTop:`1px solid ${C.border}`}}>
      {diaGrande(b.issued_at)}
      <div onClick={()=>b.client_id&&onOpenClientFicha&&onOpenClientFicha(b.client_id)} style={{flex:1,minWidth:0,cursor:'pointer'}}><div style={{fontSize:12.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(b.client_id)}</div><div style={{fontSize:10.5,color:C.textSoft,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.invoice_no?`F${folioN(b.invoice_no)}`:b.status}{sub?` · ${sub}`:(isDesk&&b.concept?` · ${b.concept}`:'')}</div></div>
      <span style={{fontSize:12.5,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{P$(montoFactura(b)||b.amount||0)}</span>{der}</div>
  const btn=(t,on,prim)=><button onClick={e=>{ e.stopPropagation(); on() }} style={{fontSize:11,fontWeight:700,borderRadius:8,padding:'4px 9px',border:`1px solid ${prim?C.accent:C.border}`,background:prim?C.accent:C.card,color:prim?'#fff':C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>{t}</button>
  const revDet=()=>{ if(!rev) return null
    const caja=(t,body)=><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginTop:8}}><div style={{padding:isDesk?'11px 16px':'10px 10px',borderBottom:`1px solid ${C.border}`,...SEC_LBL,fontWeight:800}}>{t}</div>{body}</div>
    if(rev==='tram') return caja(isDesk?'Facturas de honorarios con señales de gasto y sin gasto ligado':'Gastos dentro de honorarios',revTram.length?grupoSocio(revTram,b=><Fragment key={b.id}>{filaRev(b,<span style={{display:'flex',gap:6}}>{btn(isDesk?'Es honorario':'Honorario',()=>esHonorario(b))}{btn(isDesk?'Ligar gasto':'Gasto',()=>setLigando(l=>l===b.id?null:b.id),true)}</span>,(()=>{ const e=(fondoCand[String(b.id)]||[])[0]; return e?`fondo sin depósito ${P$(e.amount)} del ${fmtFechaDMY(e.date)}`:null })())}
        {ligando===b.id&&(()=>{ const fs=fondoCand[String(b.id)]||[]; return <div style={{background:C.bgSoft,padding:isDesk?'6px 16px 10px':'6px 10px 10px'}}>{fs.length?fs.map(e=><div key={e.id} onClick={()=>ligar(b,e)} className='er-c' style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 8px',borderRadius:8,cursor:'pointer',fontSize:12}}><span style={{color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaDMY(e.date)} · {e.concept||'Fondo'}</span><b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{P$(e.amount)}</b></div>):<div style={{fontSize:12,color:C.muted,padding:'4px 8px'}}>Este cliente no tiene fondos sin ligar. Regístralo en su ficha › Gastos.</div>}</div> })()}</Fragment>):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='cuo') return caja(isDesk?'Cuotas con fecha de emisión y sin factura':'Cuotas sin factura',revCuo.length?grupoSocio(revCuo,b=>filaRev(b,<span style={{color:C.textSoft}}><Gl n='chevron'/></span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Sin pendientes.</div>)
    if(rev==='bda') return caja(isDesk?'Comisiones que nos pagan: ¿de qué socio es el cliente?':'Comisiones por asignar',revBda.length?revBda.map(b=>filaRev(b,<span style={{display:'flex',gap:6}}>{ADMIN_NAMES.map(sn=>btn(sn,()=>asignar(b,sn)))}</span>)):<div style={{padding:14,fontSize:12,color:C.muted}}>Al día: todas tienen socio.</div>)
    return null }
  const sumB=a=>a.reduce((x,b)=>x+(montoFactura(b)||b.amount||0),0)
  const ParaRevisar=()=><><div style={{...SEC_LBL,fontWeight:800,margin:'16px 2px 8px'}}>Para revisar</div>
    <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8}}>
      {revTile('tram','alert',C.ambarBg,C.soonText,`Gastos dentro de honorarios · ${revTram.length}`,revTram.length?fmtMillLR(sumB(revTram)):'Al día',revTram.length?C.soonText:C.greenText)}
      {revTile('cuo','file',C.azulBg,C.azulInfo,`Cuotas con fecha sin factura · ${revCuo.length}`,revCuo.length?fmtMillLR(sumB(revCuo)):'Al día',revCuo.length?C.azulInfo:C.greenText)}
      {revTile('bda','users',C.greenBg,C.greenText,revBda.length?`Comisiones por asignar · ${revBda.length}`:'Comisiones por asignar',revBda.length?fmtMillLR(sumB(revBda)):'Al día',revBda.length?C.soonText:C.greenText)}
    </div>{revDet()}</>

  // ── Comparativo («+ Agregar indicador»)
  const KV=useMemo(()=>{ const o={}; const z=()=>({[ADMIN_NAMES[0]]:0,[ADMIN_NAMES[1]]:0,[SIN_SOCIO]:0}); const add=(k,soc,v,it)=>{ (o[k]=o[k]||{v:z(),n:z(),it:[]}); o[k].v[soc]+=v; o[k].n[soc]++; if(it) o[k].it.push({...it,soc}) }
    ;(bill||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||!['Pendiente','Vencido'].includes(b.status)||['reembolso','nota_credito'].includes(b.billing_type)) return; const sv=saldoBill(b); if(!(sv>0)) return; const soc=socioDe(b,ctx), it={d:b.issued_at,cid:b.client_id,doc:`F${folioN(b.invoice_no)}`,det:b.concept||'',m:sv}
      add('pcob',soc,sv,it); if(b.status==='Vencido') add('venc',soc,sv,it) })
    ;(F.fuera||[]).forEach(x=>{ const b=billById[String(x.id)]; if(!b) return; const soc=socioDe(b,ctx); add(x.tipo==='duda'?'moro':'pfat',soc,x.m,{d:b.issued_at||b.due,cid:b.client_id,doc:b.invoice_no?`F${folioN(b.invoice_no)}`:'',det:b.concept||'',m:x.m}) })
    const porCli={}; (expenses||[]).forEach(e=>{ if(!e||e.deleted_at||!e.client_id) return; porCli[String(e.client_id)]=true })
    Object.keys(porCli).forEach(cid=>{ const c=cliById[cid]; if(!c||/^liberona escala/i.test(String(c.name||''))) return; const s0=fgCliente(expenses,c.id).saldo; const soc=socioNorm(c.abogado_responsable); const it={d:null,cid:c.id,doc:'',det:'saldo de gastos',m:s0}
      if(s0<-1) add('deuda',soc,-s0,{...it,m:-s0}); else if(s0>1) add('favor',soc,s0,it) })
    return o },[bill,F,billById,expenses,cliById,fu.ov,saleById])
  const kpiVal=(k,soc,p)=>{ const z=v=>v||0
    if(k==='vend') return vend(soc,p)
    if(k==='fac') return sumP('f',KF,soc,p)
    if(k==='ireal') return sumP('c',KI,soc,p)
    if(k==='compag') return -sumP('c','com',soc,p)
    if(k==='comfac') return -sumP('f','com',soc,p)
    if(k==='cext') return sumP('f','cext',soc,p)
    if(k==='perc') return sumP('c','perc',soc,p)
    if(k==='reemb') return -sumP('f','reemb',soc,p)
    if(['pcob','venc','moro','pfat','deuda','favor'].includes(k)){ const o=KV[k]; return o?(soc?z(o.v[soc]):Object.values(o.v).reduce((a,v)=>a+v,0)):0 }
    const its=V.filter(x=>(!soc||x.soc===soc)&&(p==='mes'?x.ym===ym:x.ym<=ym))
    if(k==='nven') return its.length
    if(k==='tick') return its.length?its.reduce((a,x)=>a+x.m,0)/its.length:null
    if(k==='cact') return new Set(its.map(x=>String(x.s.client_id))).size
    const ss=(sales||[]).filter(s=>s&&!s.deleted_at&&!esSubarriendo(s)&&(!soc||socioDeVenta(s,{cliById})===soc))
    if(k==='conv'){ const g=ss.filter(s=>s.activated_at).length, r=ss.filter(s=>s.status==='Rechazada').length; return (g+r)?g/(g+r)*100:null }
    if(k==='pipe') return ss.filter(s=>s.status==='Propuesta').length
    if(k==='mrr') return ss.filter(s=>esRecurrente(s)).reduce((a,s)=>a+ventaCLP(s,ufRef)/12,0)
    if(k==='comp') return (bill||[]).filter(b=>b&&!b.deleted_at&&b.status==='Programada'&&Number(String(b.due||'').slice(0,4))>y&&(!soc||socioDe(b,ctx)===soc)).reduce((a,b)=>a+(montoFactura(b)||b.amount||0),0)
    if(k==='dso'){ const ps2=(billing||[]).filter(b=>b&&!b.deleted_at&&b.status==='Pagado'&&b.paid_at&&b.issued_at&&b.invoice_no&&inPer(b.paid_at,p)&&!['reembolso','nota_credito'].includes(b.billing_type)&&(!soc||socioDe(b,ctx)===soc)).map(b=>(new Date(b.paid_at)-new Date(b.issued_at))/864e5).filter(d=>d>=0&&d<400); return ps2.length?Math.round(ps2.reduce((a,d)=>a+d,0)/ps2.length):null }
    return null }
  const fK=(v,f)=>v==null?'—':f==='$'?(Math.abs(v)<1?'—':FMT(v)):f==='%'?`${Math.round(v)}%`:f==='d'?`${v} d`:String(Math.round(v))
  const Comparativo=()=>{ const p=vista, cs=isDesk?[null,...COLS]:COLS, w=cs.length===3?['34%','22%','22%','22%']:['28%','18%','18%','18%','18%']
    const orden=kpis.slice().sort((a,b)=>PS_KPIS.findIndex(x=>x.k===a)-PS_KPIS.findIndex(x=>x.k===b)); let g=null
    return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px 10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>{isDesk?'Comparativo entre socios':'Comparativo'} · {perLbl(p)}</span><button onClick={()=>setPick(v=>!v)} style={{marginLeft:'auto',fontSize:11,fontWeight:700,border:`1px solid ${C.azulBd}`,background:C.azulBg,color:C.accent,borderRadius:14,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{isDesk?'+ Agregar indicador':'+ Agregar'}</button></div>
      {pick&&<div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(3,minmax(0,1fr))':'1fr 1fr',gap:'6px 14px',padding:isDesk?'10px 16px':'10px',borderBottom:`1px solid ${C.border}`}}>
        {PS_KPIS.map((K,i)=>{ const nuevo=i===0||PS_KPIS[i-1].g!==K.g, on=kpis.includes(K.k); return <Fragment key={K.k}>{nuevo&&<div style={{gridColumn:'1/-1',...SEC_LBL,fontWeight:800,margin:'6px 0 2px'}}>{K.g}</div>}<button onClick={()=>setKpis(on?kpis.filter(x=>x!==K.k):[...kpis,K.k])} style={{textAlign:'left',fontSize:12,fontWeight:600,color:C.accent,background:on?C.azulBg:C.bgSoft,border:0,borderRadius:8,padding:'6px 10px',cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{on?'✓ ':'+ '}{K.l}</button></Fragment> })}</div>}
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}><colgroup>{w.map((x,i)=><col key={i} style={{width:x}}/>)}</colgroup>
        <thead><tr><th style={{...th,textAlign:'left',paddingLeft:isDesk?16:8}}>Indicador</th>{cs.map((c,j)=><th key={j} style={{...th,color:tinta[c||'Oficina'],paddingRight:j===cs.length-1?(isDesk?16:8):undefined}}>{c?(isDesk?L(c):Ls(c)):'Oficina'}</th>)}</tr></thead>
        <tbody>{orden.map(k=>{ const K=PS_KPIS.find(x=>x.k===k); if(!K) return null; const cap=K.g!==g; g=K.g; const ko=kopen&&kopen.k===k
          const vals=cs.map(soc=>kpiVal(k,soc,p))
          const its=KV[k]?.it||null
          return <Fragment key={k}>
            {cap&&<tr><td colSpan={cs.length+1} style={{padding:isDesk?'12px 16px 5px':'11px 8px 5px',...SEC_LBL,fontWeight:800,borderTop:`1px solid ${C.border}`}}>{K.g}{K.per==='flujo'?` · ${perLbl(p)}`:''}</td></tr>}
            <tr><td style={{...td,textAlign:'left',paddingLeft:K.sub?(isDesk?30:18):(isDesk?16:8),color:C.muted,fontWeight:K.sub?500:600}}>{isDesk?K.l:K.ls}<span onClick={()=>setKpis(kpis.filter(x=>x!==k))} style={{color:C.done,cursor:'pointer',marginLeft:6,fontWeight:700}}>×</span></td>
              {vals.map((v,j)=>{ const soc=cs[j], clic=v!=null&&(its||['fac','ireal','compag','comfac','cext','perc','reemb'].includes(k)); const sel=ko&&kopen.soc===soc
                return <td key={j} onClick={clic?()=>{ if(its){ setVerTodo(false); setKopen(o=>(o&&o.k===k&&o.soc===soc)?null:{k,soc}) } else { setDat(d=>({...d,sec:['fac','comfac','cext','reemb'].includes(k)?'f':'c',con:{compag:'com',comfac:'com',cext:'cext',perc:'perc',reemb:'reemb'}[k]||'pre',soc,lim:40})); setTab('dat') } }:undefined} style={{...td,fontWeight:soc===null?800:700,color:soc===null?C.accent:C.text,cursor:clic?'pointer':'default',background:sel?C.azulBg:undefined,paddingRight:j===vals.length-1?(isDesk?16:8):undefined}}>{fK(v,K.f)}{isDesk&&its&&soc&&KV[k]?.n[soc]?<span style={{fontSize:10,color:C.textSoft,fontWeight:600,marginLeft:4}}>{KV[k].n[soc]}</span>:null}</td> })}</tr>
            {ko&&its&&<tr><td colSpan={cs.length+1} style={{padding:0}}>{lista(its.filter(x=>!kopen.soc||x.soc===kopen.soc).sort((a,b)=>b.m-a.m),`${kopen.soc?L(kopen.soc):'Oficina'} · ${K.l}`)}</td></tr>}
          </Fragment> })}</tbody></table></div> }

  // ── Datos crudos (partidas reales, monto en la columna de su socio)
  const CON={f:{emit:'Facturas emitidas',cext:'Comisión de externos',reemb:'Reembolsos de gastos',nc:'Notas de crédito',com:'Comisiones de lo facturado',sub:'Subarriendo · aparte'},c:{fac:'Cobrado de facturas',ant:'Anticipos',reemb:'Reembolsos de gastos',com:'Comisiones pagadas',perc:'Comisiones percibidas',sub:'Subarriendo · aparte'}}
  const SECL={f:'Facturado',c:'Cobrado'}
  const Datos=()=>{ const p=vista, base=P.filter(r=>r.s===dat.sec&&inPer(r.d,p)&&(!dat.soc||r.soc===dat.soc)), presentes=[...new Set(base.map(r=>r.k))], q=_normTxt(dat.q||'')
    const grupo=dat.con==='pre'?(dat.sec==='f'?KF:KI):dat.con==='cp'?KC:[dat.con]
    let L=base.filter(r=>grupo.includes(r.k)&&(!q||_normTxt(nm(r.cid)).includes(q)||String(r.doc||'').toLowerCase().includes(q)))
    L.sort((a,b)=>dat.ord==='m'?Math.abs(b.m)-Math.abs(a.m):String(b.d).localeCompare(String(a.d)))
    const T={}; COLS.forEach(c=>T[c]=0); L.forEach(r=>T[r.soc]+=r.m)
    const chip=(on,t,f)=><button key={t} onClick={f} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'4px 10px',border:0,cursor:'pointer',background:on?C.accent:C.bgSoft,color:on?'#fff':C.muted,whiteSpace:'nowrap'}}>{t}</button>
    const tdD={padding:isDesk?'7px 10px':'7px 6px',borderTop:`1px solid ${C.border}`,fontSize:isDesk?12:11,whiteSpace:'nowrap',textAlign:'right',fontVariantNumeric:'tabular-nums',overflow:'hidden',textOverflow:'ellipsis'}
    return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800}}>{SECL[dat.sec]} · partidas · {perLbl(p)}</span></div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',padding:isDesk?'8px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`,fontSize:11.5,fontWeight:700}}>{COLS.map(c=><span key={c} style={{color:tinta[c],fontVariantNumeric:'tabular-nums'}}>{L(c)} {P$(T[c])}</span>)}<span style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>· Oficina {P$(COLS.reduce((a,c)=>a+T[c],0))}</span></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',padding:isDesk?'10px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`}}>
        {chip(dat.sec==='f','Facturado',()=>setDat(d=>({...d,sec:'f',con:'pre',lim:40})))}{chip(dat.sec==='c','Cobrado',()=>setDat(d=>({...d,sec:'c',con:'pre',lim:40})))}
        <span style={{width:6}}/>{[[null,'Todos'],...COLS.map(c=>[c,L(c)])].map(([k,l])=>chip(dat.soc===k,l,()=>setDat(d=>({...d,soc:k,lim:40}))))}
        <input value={dat.q} onChange={e=>setDat(d=>({...d,q:e.target.value,lim:40}))} placeholder='Buscar cliente o folio' style={{flex:1,minWidth:isDesk?160:'100%',maxWidth:isDesk?260:'none',marginLeft:isDesk?'auto':0,fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px',color:C.text}}/></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',padding:isDesk?'10px 16px':'8px 10px',borderBottom:`1px solid ${C.border}`}}>
        {chip(dat.con==='pre',dat.sec==='f'?'Facturado':'Ingreso real',()=>setDat(d=>({...d,con:'pre',lim:40})))}{dat.sec==='c'&&chip(dat.con==='cp','Cobrado propio',()=>setDat(d=>({...d,con:'cp',lim:40})))}
        {Object.entries(CON[dat.sec]).filter(([k])=>presentes.includes(k)).map(([k,l])=>chip(dat.con===k,l,()=>setDat(d=>({...d,con:k,lim:40}))))}
        <span style={{marginLeft:'auto',display:'inline-flex',gap:4}}>{chip(dat.ord==='f','Fecha',()=>setDat(d=>({...d,ord:'f'})))}{chip(dat.ord==='m','Monto',()=>setDat(d=>({...d,ord:'m'})))}</span></div>
      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
        <colgroup>{(isDesk?['10%','22%','8%','21%','13%','13%','13%']:['66%','34%']).map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
        <thead><tr>{(isDesk?['Fecha','Cliente','Folio','Concepto']:['Cliente']).map((h,i)=><th key={h} style={{...th,textAlign:'left',paddingLeft:i===0?(isDesk?16:10):undefined}}>{h}</th>)}{(isDesk?COLS:['Monto']).map((c,j,arr)=><th key={c} style={{...th,color:tinta[c]||C.accent,paddingRight:j===arr.length-1?(isDesk?16:10):undefined}}>{COLS.includes(c)?L(c):c}</th>)}</tr></thead>
        <tbody>{L.slice(0,dat.lim).map((r,i)=><tr key={i} onClick={()=>irA(r)} className='er-c' style={{cursor:'pointer'}}>
          {isDesk?<><td style={{...tdD,textAlign:'left',paddingLeft:16,color:C.muted}}>{fmtFechaDMY(r.d)}</td>
          <td style={{...tdD,textAlign:'left',color:C.accent,fontWeight:700}} title={nm(r.cid)}>{nm(r.cid)}</td></>
          :<td style={{...tdD,textAlign:'left',paddingLeft:10,whiteSpace:'normal'}}><div style={{color:C.accent,fontWeight:700,fontSize:11.5,lineHeight:1.25,overflowWrap:'anywhere'}}>{nm(r.cid)}</div><div style={{color:C.textSoft,fontSize:10.5,fontWeight:600,whiteSpace:'nowrap'}}>{fmtFechaDMY(r.d)}{r.doc?` · ${r.doc}`:''}</div></td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.muted}}>{r.doc||'—'}</td>}
          {isDesk&&<td style={{...tdD,textAlign:'left',color:C.textSoft}} title={r.det}>{CON[r.s][r.k]}</td>}
          {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,color:c===r.soc?(r.m<0?C.overdueText:C.text):C.done,paddingRight:j===COLS.length-1?16:undefined}}>{c===r.soc?P$(r.m):'·'}</td>)
            :<td style={{...tdD,paddingRight:10,verticalAlign:'top',color:r.m<0?C.overdueText:C.text}}><span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:tinta[r.soc],marginRight:5}}/>{P$(r.m)}</td>}
        </tr>)}
          <tr><td colSpan={isDesk?4:1} style={{...tdD,textAlign:'left',paddingLeft:isDesk?16:10,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4'}}>Total · {L.length} partidas</td>
            {isDesk?COLS.map((c,j)=><td key={c} style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:j===COLS.length-1?16:undefined}}>{P$(T[c])}</td>)
              :<td style={{...tdD,fontWeight:800,color:C.accent,borderTop:`1.5px solid ${C.accent}`,background:'#EDF1F4',paddingRight:10}}>{P$(COLS.reduce((a,c)=>a+T[c],0))}</td>}</tr></tbody></table>
      {L.length>dat.lim&&<div onClick={()=>setDat(d=>({...d,lim:d.lim+40}))} style={{textAlign:'center',padding:10,fontSize:12,fontWeight:700,color:C.azulInfo,borderTop:`1px solid ${C.border}`,cursor:'pointer'}}>Ver {Math.min(40,L.length-dat.lim)} más de {L.length}</div>}
    </div> }

  const exportar=()=>{ try{
    const rows=[['Fecha','Socio','Sección','Concepto','Cliente','Folio','Detalle','Monto']]
    P.filter(r=>inPer(r.d,'ytd')).sort((a,b)=>String(a.d).localeCompare(String(b.d))).forEach(r=>rows.push([fmtFechaDMY(r.d),L(r.soc),SECL[r.s],CON[r.s][r.k],nm(r.cid),r.doc,r.det,Math.round(r.m)]))
    const csv=rows.map(r=>r.map(c=>{const s=String(c==null?'':c);return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(';')).join('\n')
    const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`por_socio_${ym}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000)
  }catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) } }

  const seg=(opts,val,set)=><span style={{display:'inline-flex',background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:2,flex:isDesk?'none':(opts.length>2?'1 1 100%':'none')}}>{opts.map(([k,l])=><button key={k} onClick={()=>set(k)} style={{flex:isDesk?'none':1,fontSize:12,fontWeight:700,border:0,borderRadius:14,padding:'5px 13px',cursor:'pointer',background:val===k?C.accent:'transparent',color:val===k?'#fff':C.muted}}>{l}</button>)}</span>
  const nb=(dis,on,ch)=><button disabled={dis} onClick={on} style={{width:30,height:30,borderRadius:9,border:`1px solid ${C.border}`,background:C.card,color:C.accent,cursor:dis?'default':'pointer',opacity:dis?.35:1}}><Gl n={ch}/></button>
  if(!fu.ok) return <div style={{padding:24,fontSize:13,color:C.muted}}>Cargando…</div>
  return (<div>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',margin:'0 0 14px'}}>
      {seg([['res','Resumen'],['cmp','Comparativo'],['dat','Datos']],tab,setTab)}
      {seg([['mes','Mes'],['ytd','Año']],vista,v=>{ setVista(v); setOpen(null); setKopen(null) })}
      <span style={{display:'inline-flex',alignItems:'center',gap:6,marginLeft:isDesk?'auto':0}}>{nb(false,()=>shift(-1),'chevL')}<span style={{minWidth:isDesk?124:96,textAlign:'center',fontSize:13.5,fontWeight:700,color:C.text}}>{perLbl(vista)}</span>{nb(ym===curYM,()=>shift(1),'chevron')}</span>
      <button onClick={exportar} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer',whiteSpace:'nowrap',marginLeft:isDesk?0:'auto'}}>{isDesk?'Exportar ↓':'↓'}</button>
    </div>
    <div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(3,minmax(0,1fr))':'1fr',gap:isDesk?12:8}}>
      {isDesk?cardOficinaAncha():cardSocio(null,C.greenText)}
      {COLS.map(c=>cardSocio(c,tinta[c]))}
    </div>
    {tab==='res'&&<div style={{display:'grid',gridTemplateColumns:isDesk?'repeat(2,minmax(0,1fr))':'1fr',gap:isDesk?12:8,marginTop:16,alignItems:'start'}}>
      <div style={{minWidth:0}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Composición · {perLbl(vista)}</span><button onClick={()=>setPs(!ps)} style={{marginLeft:'auto',fontSize:11,fontWeight:700,border:`1px solid ${ps?C.azulBd:C.border}`,background:ps?C.azulBg:C.card,color:C.accent,borderRadius:14,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{ps?'Cerrar por socio':'Abrir por socio'}</button></div>
          {Comp()}
        </div>
        {ParaRevisar()}
      </div>
      <div style={{minWidth:0}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:isDesk?'11px 16px':'10px',borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL,fontWeight:800,whiteSpace:'nowrap'}}>Mes a mes {y}</span><span style={{marginLeft:'auto',display:'inline-flex',background:C.bgSoft,borderRadius:12,padding:2}}>{[['c','Ingreso real'],['f','Facturado']].map(([k,l])=><button key={k} onClick={()=>setMm(k)} style={{fontSize:10.5,fontWeight:700,border:0,borderRadius:10,padding:'3px 9px',cursor:'pointer',background:mm===k?C.card:'transparent',color:mm===k?C.accent:C.muted,boxShadow:mm===k?`0 0 0 1px ${C.border}`:'none',whiteSpace:'nowrap'}}>{l}</button>)}</span></div>
          {MesAMes()}
        </div>
      </div>
    </div>}
    {tab==='cmp'&&<div style={{marginTop:16}}>{Comparativo()}</div>}
    {tab==='dat'&&<div style={{marginTop:16}}>{Datos()}</div>}
  </div>)
}

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

