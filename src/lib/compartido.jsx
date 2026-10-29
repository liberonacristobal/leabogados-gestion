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

export const _esDiaHabil = dt => { const w=dt.getDay(); if(w===0||w===6) return false; const s=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`; return !FERIADOS_CL.has(s) }

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

