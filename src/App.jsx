import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker
import {
  supabase, signInWithGoogle, signOut, onAuthChange, getSession, getUserInfo,
  getClients, getBilling,
  getClientEntities, upsertClientEntity, deleteClientEntity, getAllEntities,
  getDriveToken, connectDrive, saveDriveToken,
  upsertClient, deleteClient as dbDeleteClient,
  upsertBilling, updateBillingStatus
} from './supabase'
import logoBlanco from './le-logo-blanco.png'

const FONT = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
// Paleta corporativa. soon (#C77F18) = ámbar oficial de aviso: único color cálido permitido,
// para estados Propuesta/Prospecto/Borrador, próximo a vencer y costo de terceros.
const C = {
  bg:'#F5F5F5',surface:'#FFFFFF',card:'#FFFFFF',border:'#E4E8EB',text:'#3D3D3D',muted:'#537281',
  accent:'#003C50',overdue:'#E24B4A',urgent:'#E24B4A',soon:'#C77F18',normal:'#1D9E75',done:'#99ABB4',
}
const fmt = n => new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(n||0)
const fmtUF = n => n ? `UF ${Number(n).toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}` : '—'
// CLP abreviado para KPIs ($216,2M / $30K). Conserva el signo.
const fmtShort = n => { const a=Math.abs(n||0), s=n<0?'-':''; if(a>=1000000) return s+'$'+(a/1000000).toFixed(a>=10000000?0:1).replace('.',',')+'M'; if(a>=1000) return s+'$'+Math.round(a/1000)+'K'; return s+'$'+a.toLocaleString('es-CL') }
// UF abreviada para KPIs (UF 9.800 / UF 6.309), sin decimales para no recargar.
const fmtUFk = n => `UF ${Math.round(n||0).toLocaleString('es-CL')}`
// Categoría legible para rendiciones (documento al cliente). Abreviaturas internas → nombre completo.
const RENDCAT = c => c==='CBR'?'Conservador de Bienes Raíces':(c==='Notaria'||c==='Notaría')?'Notaría Lascar':(c||'Otro')
// Fecha DD-MM-AAAA a partir de un ISO 'AAAA-MM-DD'
const fmtFechaDMY = d => { if(!d) return '—'; const p=String(d).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(d) }
// Monto en CLP en valor absoluto (sin signo): el llamador agrega el +/- cuando corresponde. Fuente única para PDFs/resúmenes.
const fmtN = n => '$' + Math.abs(n||0).toLocaleString('es-CL')
const fmtDate = d => { if(!d) return '—'; return new Date(d+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'short'}) }
const daysLeft = d => { if(!d) return null; return Math.round((new Date(d+'T12:00') - new Date()) / 86400000) }
// Archivo automatico de tareas: una tarea Terminada se considera archivada cuando se completo
// hace mas de DAYS_TO_ARCHIVE dias. Las terminadas sin completed_at (historicas) cuentan como archivadas.
const DAYS_TO_ARCHIVE = 15
const isTaskArchived = t => t.status==='Terminado' && (!t.completed_at || (Date.now()-new Date(t.completed_at).getTime())/86400000 > DAYS_TO_ARCHIVE)
const urgency = (due,status) => {
  if(['Completado','Pagado','Archivado','Anulado'].includes(status)) return 'done'
  const d = daysLeft(due); if(d===null) return 'normal'
  if(d<0) return 'overdue'; if(d<=5) return 'urgent'; if(d<=14) return 'soon'; return 'normal'
}
function normRut(r){ return (r||'').replace(/\s/g,'').replace(/\./g,'').toLowerCase() }
function dueFromIssued(iso){ if(!iso) return null; const d=new Date(iso+'T00:00:00'); d.setDate(d.getDate()+30); return d.toISOString().slice(0,10) }
// N° de cuota desde la glosa (las cuotas viven embebidas en el concepto, ej. "Título — Cuota 1/3"). Vacío si no aplica.
function parseCuota(concept){
  if(!concept) return ''
  const m = concept.match(/cuota\s*(\d+)\s*\/\s*(\d+)/i); if(m) return `${m[1]}/${m[2]}`
  const m2 = concept.match(/cuota\s*(\d+)/i); if(m2) return m2[1]
  const m3 = concept.match(/(\d+)\s*\/\s*(\d+)/); if(m3) return `${m3[1]}/${m3[2]}`
  return ''
}
// Al cargar/emitir una factura: si existe EXACTAMENTE UNA programada equivalente del mismo cliente,
// mismo monto y con vencimiento <= la emisión, se elimina para no duplicar en "Por facturar".
// Criterio conservador: si hay 0 o >1 candidatas, no toca nada (queda el botón manual "Ya emitida").
async function reconcileProgramada(clientId, amount, issuedAt){
  try{
    if(!clientId || !amount) return
    const {data} = await supabase.from('billing').select('id,due').eq('client_id',clientId).eq('amount',amount).eq('status','Programada')
    if(!data || !data.length) return
    // Solo cuotas con due dentro de ±45 días de la emisión: evita borrar una programada lejana
    // de otra venta del mismo cliente que casualmente tiene el mismo monto.
    if(!issuedAt) return
    const cands = data.filter(b=>b.due && Math.abs(new Date(b.due)-new Date(issuedAt))/86400000 <= 45)
    if(!cands.length) return
    const best = cands.reduce((a,b)=> Math.abs(new Date(a.due)-new Date(issuedAt)) <= Math.abs(new Date(b.due)-new Date(issuedAt)) ? a : b)
    await supabase.from('billing').delete().eq('id',best.id)
  }catch(_){}
}
const urgencyColor = (due,status) => ({overdue:C.overdue,urgent:C.urgent,soon:C.soon,normal:C.normal,done:C.done})[urgency(due,status)]||C.muted
const currentYear = new Date().getFullYear()
const currentMonth = new Date().getMonth()+1
const ddItem = { padding:'9px 14px', fontSize:13, color:'#3D3D3D', cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderRadius:6, margin:'0 4px' }
// Iniciales nombre+apellido de cada responsable (mismas de su correo)
const INICIALES_RESP = {'Cristóbal':'CL','Erasmo':'EE','Martín':'MC','Martina':'MP','Rodrigo':'RD'}
// Responsables de una tarea: usa assignees (multi); si no hay, cae a who (tareas antiguas).
const taskAssignees = t => (t && t.assignees && t.assignees.length) ? t.assignees : (t && t.who ? [t.who] : [])
const isAssignee = (t,name) => !!name && taskAssignees(t).includes(name)
// "En mi lista": soy responsable o me delegaron la tarea (los delegados también la ven).
const enMiLista = (t,name) => isAssignee(t,name) || (!!name && ((t&&t.delegated_to)||[]).includes(name))
const ADMIN_NAMES = ['Cristóbal','Erasmo']

// Saldo disponible de caja chica del usuario = fondos entregados − TODOS sus gastos (liquidados o no).
// Liquidar es neutro para el saldo: el gasto ya descontó la plata; solo un fondo nuevo lo sube.
// Queda en $0 si fondos=gastos, o en el remanente si hubo diferencia. NO excluir los liquidados:
// si se excluyen, el saldo sube artificialmente al liquidar (los fondos seguirían sumando completos).
// Fuente única: la usan CajaChicaView ("Mi caja"), el panel Gestión del Dashboard y el KPI de Tareas.
// Excluye los gastos con paid_by_client=true (los pagó el cliente directo: se rinden pero no salen de la caja chica del usuario).
const saldoCajaChica = (pettyCash, expenses, userName) => {
  if(!userName) return 0
  const entregado = (pettyCash||[]).filter(p=>p.user_name===userName).reduce((a,p)=>a+(p.amount||0),0)
  const gastado = (expenses||[]).filter(e=>e.type==='gasto'&&e.created_by===userName&&!e.paid_by_client).reduce((a,e)=>a+(e.amount||0),0)
  return entregado - gastado
}

// Saldos por razón social (entity) de un cliente. Con 1 RS, todo (incl. sin entity_id) va a esa RS.
// Con 2+ RS, los movimientos sin entity_id quedan en un grupo "Sin razón social". total = suma de todo.
function rsBalances(clientId, expenses, entities){
  const ents = entities||[]
  const single = ents.length===1
  const buckets = ents.map(e=>({entity:e,fondos:0,gastos:0}))
  const byId={}; buckets.forEach(b=>byId[b.entity.id]=b)
  const sinRS={entity:null,fondos:0,gastos:0,n:0}
  ;(expenses||[]).filter(e=>e.client_id===clientId).forEach(e=>{
    let b
    if(e.entity_id&&byId[e.entity_id]) b=byId[e.entity_id]
    else if(single&&buckets.length) b=buckets[0]
    else { b=sinRS; sinRS.n++ }
    if(e.type==='fondo') b.fondos+=(e.amount||0); else b.gastos+=(e.amount||0)
  })
  const ws = b=>({...b,saldo:b.fondos-b.gastos})
  const porRS = buckets.map(ws)
  const sin = sinRS.n>0 ? ws(sinRS) : null
  const all = porRS.concat(sin?[sin]:[])
  const tot = all.reduce((a,b)=>({fondos:a.fondos+b.fondos,gastos:a.gastos+b.gastos}),{fondos:0,gastos:0})
  return {porRS, sin, total:{...tot,saldo:tot.fondos-tot.gastos}}
}

// FUENTE ÚNICA del documento de rendición (HTML imprimible). La usan el historial ("Ver PDF")
// y RendicionModal (al enviar), para que ambos PDFs sean idénticos. Recibe datos ya normalizados.
// gastos: [{date,concept,category,amount}] · fondos: [{date,concept,amount}]
function rendicionDocHtml({ razon, rut, periodo, fechaEmision, dirigidoA, gastos, fondos, totGastos, totFondos }){
  const A='#003C50', GRAY='#E4E8EB', MUTED='#537281', AZUL3='#99ABB4', TXT='#3D3D3D'
  const saldo = totFondos - totGastos
  const badge = (cat)=>{ const c=(cat||'').toLowerCase(); let bg='#E4E8EB',fg=MUTED; if(c.includes('notar')){bg='#E6F1FB';fg=A} else if(c.includes('transp')){bg='#E1F5EE';fg='#0F6E56'} return `<span style='display:inline-block;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:600;background:${bg};color:${fg}'>${RENDCAT(cat)}</span>` }
  const filasGastos = gastos.map(e=>`<tr><td style='white-space:nowrap'>${fmtFechaDMY(e.date)}</td><td>${e.concept||'—'}</td><td>${badge(e.category)}</td><td style='text-align:right;font-weight:600;white-space:nowrap'>${fmtN(e.amount)}</td></tr>`).join('')
  const filasFondos = fondos.length ? fondos.map(e=>`<tr><td style='width:90px;white-space:nowrap'>${fmtFechaDMY(e.date)}</td><td>${e.concept||'Fondo recibido'}</td><td style='text-align:right;font-weight:600;color:#0F6E56'>${fmtN(e.amount)}</td></tr>`).join('') : `<tr><td colspan='3' style='color:${MUTED};text-align:center;padding:10px'>Sin fondos registrados</td></tr>`
  let saldoBox=''
  if(saldo<0){ const row=(l,v)=>`<div style='display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1D4D4;font-size:10px'><span style='color:${MUTED}'>${l}</span><span style='font-weight:600;color:${TXT}'>${v}</span></div>`; saldoBox=`<div class='saldo-box' style='border:1px solid #F7C1C1;background:#FCEBEB;border-radius:8px;padding:14px 18px;margin-top:18px'><div style='font-size:11px;font-weight:700;color:${TXT};margin-bottom:10px'>Saldo pendiente — transferir a Liberona Escala</div>${row('Razón social','Liberona Escala Abogados Ltda.')}${row('RUT','77.700.387-9')}${row('Banco','Banco BICE')}${row('N° cuenta corriente','138392-2')}${row('Email confirmación','administracion@leabogados.cl')}</div>` }
  else if(saldo>0){ saldoBox=`<div class='saldo-box' style='border:1px solid #E4E8EB;border-radius:8px;padding:14px 18px;margin-top:18px;font-size:10px;color:${TXT};line-height:1.6'>Le informamos que existe un saldo a su favor de <strong>${fmtN(saldo)}</strong> correspondiente al período ${periodo}. Para proceder con la devolución, le agradeceríamos indicarnos sus datos bancarios a <strong>administracion@leabogados.cl</strong></div>` }
  const sep='border-left:1px solid #B9C2C8;margin-left:12px;padding-left:12px'
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Rendición de gastos — ${razon}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Helvetica,Arial,sans-serif;color:${TXT};font-size:10px;background:#fff}.page{max-width:816px;margin:0 auto;padding-bottom:36px}@page{size:letter portrait;margin:14mm 14mm}table{width:100%;border-collapse:collapse;font-size:10px}thead th{padding:7px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:${MUTED};border-bottom:1px solid ${GRAY}}tbody td{padding:7px 10px;border-bottom:1px solid #EFF1F3}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}.saldo-box{page-break-inside:avoid}tr{page-break-inside:avoid}}</style></head><body><div class='page'><div style='background:${A};padding:20px 26px;display:flex;justify-content:space-between;align-items:center'><img src='${logoBlanco}' alt='Liberona Escala Abogados' style='height:30px;display:block'/><div style='text-align:right'><div style='font-size:14px;font-weight:700;color:#fff'>${razon}</div>${rut?`<div style='font-size:11px;color:${AZUL3};margin-top:2px'>${rut}</div>`:''}</div></div><div style='background:${GRAY};padding:8px 26px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:${TXT}'><div style='display:flex;align-items:center'><span>Período: ${periodo}</span><span style='${sep}'>Emisión: ${fechaEmision}</span><span style='${sep}'>${gastos.length} gasto${gastos.length!==1?'s':''}</span></div>${dirigidoA?`<div style='font-weight:600'>Dirigido a: ${dirigidoA}</div>`:''}</div><div style='padding:20px 26px 0'><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th style='text-align:right'>Monto</th></tr></thead><tbody>${filasGastos}</tbody></table><div style='display:flex;justify-content:space-between;padding:8px 10px;border-top:1.5px solid ${A};font-weight:700;font-size:11px'><span>Total gastos</span><span>${fmtN(totGastos)}</span></div><div style='font-size:10px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.5px;margin:22px 0 8px'>Fondos recibidos</div><table><tbody>${filasFondos}</tbody></table><div style='background:${A};border-radius:8px;padding:14px 18px;margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;color:#fff'><div><div style='font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${AZUL3};margin-bottom:4px'>Fondos recibidos</div><div style='font-size:13px;font-weight:700'>${fmtN(totFondos)}</div></div><div><div style='font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${AZUL3};margin-bottom:4px'>Gastos realizados</div><div style='font-size:13px;font-weight:700'>${fmtN(totGastos)}</div></div><div><div style='font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:${AZUL3};margin-bottom:4px'>Saldo</div><div style='font-size:13px;font-weight:700'>${saldo<0?'-':''}${fmtN(saldo)}</div></div></div>${saldoBox}</div><div style='display:flex;justify-content:space-between;padding:14px 26px 0;margin-top:22px;border-top:1px solid ${GRAY};font-size:9px;color:${MUTED}'><span>Av. Kennedy 7900, Of. 905, Vitacura · Santiago · leabogados.cl</span><span>Rendición de gastos · ${periodo}</span></div></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button></body></html>`
}

// "Ver PDF" desde el historial: arma los datos de una rendición YA registrada y usa la fuente única.
function rendicionPdfHtml(r, client, expenses, clientEntities){
  const gastos = (expenses||[]).filter(e=>e.client_render_id===r.id).sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)
  const fondos = (expenses||[]).filter(e=>e.client_id===(client&&client.id)&&e.type==='fondo').sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)
  const entId = (gastos.find(e=>e.entity_id)||{}).entity_id
  const ent = entId ? (clientEntities||[]).find(x=>x.id===entId) : null
  return rendicionDocHtml({
    razon: (ent&&ent.name) || (client&&client.name) || '—',
    rut: (ent&&ent.rut) || (client&&client.rut) || '',
    periodo: r.periodo || '',
    fechaEmision: r.created_at ? new Date(r.created_at).toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'}) : '',
    dirigidoA: r.dirigido_a || null,
    gastos, fondos,
    totGastos: gastos.reduce((a,e)=>a+(e.amount||0),0),
    totFondos: fondos.reduce((a,e)=>a+(e.amount||0),0),
  })
}

const DaysBadge = ({due,status}) => {
  const u=urgency(due,status); if(u==='done') return null
  const d=daysLeft(due); if(d===null) return null
  const label=d<0?`${Math.abs(d)}d vencido`:d===0?'hoy':`${d}d`
  return <span style={{fontSize:10,fontWeight:600,color:urgencyColor(due,status),whiteSpace:'nowrap'}}>{label}</span>
}
const AreaChip = ({area}) => {
  const bg={Corporativo:'#E3EEF3',Tributario:'#F2E9DE',Laboral:'#F2E9DE',Otro:'#ECECEC'}
  if(!area) return null
  return <span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:bg[area]||'#ECECEC',color:'#537281',fontWeight:600,whiteSpace:'nowrap'}}>{area}</span>
}
const Pill = ({label,bg,color,small}) => <span style={{display:'inline-block',padding:small?'1px 7px':'2px 9px',borderRadius:20,fontSize:small?10:11,fontWeight:600,color:color||'#fff',background:bg||C.accent,whiteSpace:'nowrap'}}>{label}</span>
const Inp = (p) => <input {...p} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',outline:'none',...p.style}}/>
const Sel = ({value,onChange,options,placeholder}) => (
  <select value={value} onChange={onChange} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
    {placeholder&&<option value=''>{placeholder}</option>}
    {options.map(o=><option key={o} value={o}>{o}</option>)}
  </select>
)
const Txt = (p) => <textarea {...p} rows={2} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,resize:'none',boxSizing:'border-box',outline:'none'}}/>
const Lbl = ({children}) => <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.7,marginBottom:5}}>{children}</div>
const Fld = ({label,children,mb}) => <div className='fld' style={{marginBottom:mb??14}}><Lbl>{label}</Lbl>{children}</div>
const Spin = () => <div style={{width:20,height:20,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
const DriveIcon = ({size=14}) => <svg width={size} height={size} viewBox='0 0 87.3 78' xmlns='http://www.w3.org/2000/svg'><path d='m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z' fill='#0066da'/><path d='m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z' fill='#00ac47'/><path d='m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z' fill='#ea4335'/><path d='m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z' fill='#00832d'/><path d='m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z' fill='#2684fc'/><path d='m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z' fill='#ffba00'/></svg>
// Logo de marca FirmDesk. variant: primary (tile azul) | mono (F azul sobre claro) | accent (tile verde)
const FirmDeskMark = ({size=40,variant='primary'}) => {
  const tile = variant==='accent'?'#1D9E75':variant==='mono'?'#FFFFFF':'#003C50'
  const letter = variant==='primary'?'#F2F2F0':variant==='accent'?'#FFFFFF':'#003C50'
  const desk = variant==='accent'?'#003C50':'#1D9E75'
  return (
    <svg width={size} height={size} viewBox='0 0 56 56' xmlns='http://www.w3.org/2000/svg' role='img' aria-label='FirmDesk'>
      <rect x={variant==='mono'?0.5:0} y={variant==='mono'?0.5:0} width={variant==='mono'?55:56} height={variant==='mono'?55:56} rx='15' fill={tile} stroke={variant==='mono'?'#E4E2DD':'none'}/>
      <rect x='20' y='14' width='5' height='25' fill={letter}/>
      <rect x='20' y='14' width='18' height='5' fill={letter}/>
      <rect x='20' y='23.5' width='12' height='5' fill={letter}/>
      <rect x='16' y='40' width='24' height='4' rx='2' fill={desk}/>
    </svg>
  )
}
// Lockup horizontal marca + wordmark FirmDesk
const FirmDeskLockup = ({mark=30,font=19,gap=10}) => (
  <span style={{display:'inline-flex',alignItems:'center',gap}}>
    <FirmDeskMark size={mark}/>
    <span style={{fontFamily:"'Hanken Grotesk',system-ui,sans-serif",fontSize:font,fontWeight:600,letterSpacing:-.5,color:C.accent,lineHeight:1}}>Firm<span style={{color:'#1D9E75'}}>Desk</span></span>
  </span>
)
const Switch = ({on,onToggle,disabled}) => (
  <button type='button' disabled={disabled} onClick={disabled?undefined:onToggle} style={{width:34,height:20,borderRadius:10,border:'none',background:on?'#1D9E75':'#CBD5DB',position:'relative',cursor:disabled?'not-allowed':'pointer',padding:0,flexShrink:0,transition:'background .15s',opacity:disabled?.7:1}}>
    <span style={{position:'absolute',top:2,left:on?16:2,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
  </button>
)
const TrashIcon = ({color}) => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={color||'#537281'} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'/></svg>
)
const BanIcon = ({size=15,color}) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke={color||C.overdue} strokeWidth='2' strokeLinecap='round'><circle cx='12' cy='12' r='9'/><line x1='5.6' y1='5.6' x2='18.4' y2='18.4'/></svg>
)
const Modal = ({title,onClose,children,closeOnBackdrop=true,titleRight,hideHeader=false}) => (
  <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>e.target===e.currentTarget&&closeOnBackdrop&&onClose()}>
    <div style={{background:C.surface,borderRadius:16,width:'100%',maxWidth:520,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.18)',border:`1px solid ${C.border}`,paddingBottom:24}}>
      {!hideHeader&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'18px 20px 14px',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:1}}>
        <span style={{fontSize:16,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>{title}</span>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {titleRight}
          <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1}}>x</button>
        </div>
      </div>}
      <div style={{padding:hideHeader?'0':'18px 20px'}}>{children}</div>
    </div>
  </div>
)

function LoginScreen({loading}) {
  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:32}}>
      <div style={{fontSize:12,color:C.muted,letterSpacing:2.5,textTransform:'uppercase',marginBottom:18}}>Bienvenido a</div>
      <img src="data:image/png;base64,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" alt="Liberona Escala Abogados" style={{width:'100%',maxWidth:300,height:'auto',marginBottom:14}}/>
      <div style={{fontSize:14,color:C.muted,marginBottom:48,letterSpacing:.3}}>FirmDesk | Gestion Oficina</div>
      <button onClick={signInWithGoogle} disabled={loading} style={{display:'flex',alignItems:'center',gap:12,padding:'14px 28px',borderRadius:12,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:14,fontWeight:600,cursor:'pointer',width:'100%',maxWidth:300,justifyContent:'center'}}>
        {loading?<Spin/>:<>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar con Google Workspace
        </>}
      </button>
      <div style={{fontSize:11,color:C.muted,marginTop:16}}>Solo cuentas @leabogados.cl</div>
    </div>
  )
}

const TABS_ADMIN = [
  {id:'dashboard',icon:'house',label:'Inicio'},
  {id:'sales',icon:'tag',label:'Ventas'},
  {id:'billing',icon:'dollar',label:'Facturación'},
  {id:'expenses',icon:'minus',label:'Gastos'},
  {id:'clients',icon:'person',label:'Clientes'},
]
const TABS_LIMITED = [
  {id:'tasks',icon:'check',label:'Tareas'},
  {id:'expenses',icon:'minus',label:'Gastos'},
  {id:'cajachica',icon:'tag',label:'Caja chica'},
  {id:'clients',icon:'person',label:'Clientes'},
]


// ─── CLIENTS VIEW LIMITED ──────────────────────────────────────────────────
// Recuadros de filtro de estado de clientes (Activos / Terminados / Todos) — compartido admin/limited
function ClientStatusTabs({value,onChange,activeN,endedN,prospectoN}){
  return (
    <div style={{display:'flex',gap:6,marginBottom:4}}>
      {[['Activo',`Activos (${activeN})`],['Prospecto',`Prospectos (${prospectoN})`],['Terminado',`Terminados (${endedN})`],['all','Todos']].map(([v,l])=>(
        <button key={v} onClick={()=>onChange(v)} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${value===v?C.accent:C.border}`,background:value===v?'#E6EEF1':'transparent',color:value===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
      ))}
    </div>
  )
}

function ClientsViewLimited({clients,expenses,tasks,clientEntities,rendiciones,onEdit,onAdd,onAddTask,onAddGasto,onAddFondo,onSaveFields,onImportDrive}) {
  const [q,setQ] = useState('')
  const [selected,setSelected] = useState(null)
  const [confirmEdit,setConfirmEdit] = useState(null)
  const [openRend,setOpenRend] = useState(null)
  const [sFilter,setSFilter] = useState('Activo')
  const [ftab,setFtab] = useState('resumen')

  const activeN=clients.filter(c=>!c.is_internal&&(c.status||'Activo')==='Activo').length
  const endedN=clients.filter(c=>!c.is_internal&&c.status==='Terminado').length
  const prospectoN=clients.filter(c=>!c.is_internal&&c.status==='Prospecto').length
  const filtered = clients.filter(c=>{
    if(sFilter==='Activo' && (c.status||'Activo')!=='Activo') return false
    if(sFilter==='Terminado' && c.status!=='Terminado') return false
    if(sFilter==='Prospecto' && c.status!=='Prospecto') return false
    if(q.trim() && !c.name.toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a,b)=>a.name.localeCompare(b.name))

  const ClientRow = ({cl}) => {
    const saldo = (()=>{ let b=0; expenses.forEach(e=>{ if(e.client_id===cl.id) b+=e.type==='fondo'?e.amount:-e.amount }); return b })()
    return (
      <div onClick={()=>{setFtab('resumen');setSelected(cl)}} style={{background:'#fff',borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid #E8E8E8`,cursor:'pointer',borderLeft:`3px solid ${saldo<0?'#E24B4A':'#1D9E75'}`}}
        onMouseEnter={e=>e.currentTarget.style.borderColor='#537281'}
        onMouseLeave={e=>e.currentTarget.style.borderColor='#E8E8E8'}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#3D3D3D'}}>{cl.name}</div>
          <div style={{fontSize:11,fontWeight:600,color:saldo<0?'#E24B4A':'#0F6E56'}}>{saldo!==0?(saldo<0?'-':'+')+'$'+Math.abs(saldo).toLocaleString('es-CL'):''}</div>
        </div>
        {cl.type&&<div style={{fontSize:11,color:'#888',marginTop:2}}>{cl.type}</div>}
      </div>
    )
  }

  const Ficha = ({cl}) => {
    const clientExpenses = expenses.filter(e=>e.client_id===cl.id).sort((a,b)=>b.date>a.date?1:-1)
    const fondos = clientExpenses.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
    const gastos = clientExpenses.filter(e=>e.type!=='fondo').reduce((a,e)=>a+e.amount,0)
    const saldo = fondos - gastos
    const clientTasks = tasks.filter(t=>t.client_id===cl.id&&t.status!=='Terminado')
    const entities = (clientEntities||[]).filter(e=>e.client_id===cl.id)
    const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Registro Civil':'#EDE3F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}

    return (
      <div style={{paddingBottom:100}}>
        <div style={{padding:'16px 20px 12px',position:'sticky',top:0,background:'#F7F8F9',zIndex:10,borderBottom:'1px solid #E8E8E8'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button onClick={()=>setSelected(null)} style={{background:'none',border:'none',color:'#888',cursor:'pointer',fontSize:20,padding:'0 4px 0 0'}}>←</button>
            <div style={{flex:1}}>
              <div style={{fontSize:18,fontWeight:700,color:'#3D3D3D'}}>{cl.name}</div>
              {cl.type&&<div style={{fontSize:11,color:'#888'}}>{cl.type}</div>}
            </div>
            <button onClick={()=>setConfirmEdit(cl)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #E8E8E8',background:'#fff',color:'#3D3D3D',fontSize:12,fontWeight:600,cursor:'pointer'}}>Editar</button>
          </div>
          <FichaTabs tab={ftab} setTab={setFtab} role="limited"/>
        </div>

        <div style={{padding:'16px 20px 0',display:ftab==='resumen'?'block':'none'}}>

          {entities.length>0&&(
            <div style={{marginBottom:16,padding:'10px 14px',borderRadius:10,background:'#F7F7F7',border:'1px solid #E8E8E8'}}>
              <div style={{fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:8}}>Razones sociales facturadas</div>
              {entities.map(e=>(
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:'1px solid #E8E8E8'}}>
                  <div style={{fontSize:12,fontWeight:500,color:'#3D3D3D'}}>{e.name||'—'}</div>
                  <div style={{fontSize:11,color:'#888',fontFamily:'monospace'}}>{e.rut}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Gastos y Fondos</div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>onAddFondo(cl)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #E8E8E8',background:'#fff',color:'#1D9E75',fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Fondo</button>
                <button onClick={()=>onAddGasto(cl)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #537281',background:'transparent',color:'#537281',fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Gasto</button>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
              <div style={{background:'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:10,color:'#888',marginBottom:2}}>FONDOS</div>
                <div style={{fontSize:12,fontWeight:700,color:'#1D9E75'}}>${fondos.toLocaleString('es-CL')}</div>
              </div>
              <div style={{background:'#FBE9E7',borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:10,color:'#888',marginBottom:2}}>GASTOS</div>
                <div style={{fontSize:12,fontWeight:700,color:'#E24B4A'}}>${gastos.toLocaleString('es-CL')}</div>
              </div>
              <div style={{background:saldo<0?'#FBE9E7':'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:10,color:'#888',marginBottom:2}}>SALDO</div>
                <div style={{fontSize:12,fontWeight:700,color:saldo<0?'#E24B4A':'#0F6E56'}}>${saldo.toLocaleString('es-CL')}</div>
              </div>
            </div>
            {clientExpenses.slice(0,8).map(e=>{
              const isFondo=e.type==='fondo'
              const catBg=CATS[e.category]||CATS['Otro']
              return (
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:'1px solid #E8E8E8'}}>
                  <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                    {!isFondo&&e.category&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:catBg,color:'#537281',fontWeight:600,flexShrink:0}}>{e.category}</span>}
                    {isFondo&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#E4F1EA',color:'#1D9E75',fontWeight:600,flexShrink:0}}>Fondo</span>}
                    <span style={{fontSize:12,color:'#3D3D3D',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:600,color:isFondo?'#1D9E75':'#E24B4A',flexShrink:0,marginLeft:8}}>{isFondo?'+':'-'}${e.amount.toLocaleString('es-CL')}</div>
                </div>
              )
            })}
          </div>

          {(()=>{
            const rends=(rendiciones||[]).filter(r=>r.client_id===cl.id&&r.tipo==='cliente').sort((a,b)=>b.created_at>a.created_at?1:-1)
            if(!rends.length) return null
            return (
              <div style={{marginBottom:20}}>
                <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>Rendiciones realizadas</div>
                {rends.map(r=>{
                  const isOpen=openRend===r.id
                  const det=expenses.filter(e=>e.client_render_id===r.id).sort((a,b)=>b.date>a.date?1:-1)
                  return (
                    <div key={r.id} style={{borderBottom:'1px solid #E8E8E8'}}>
                      <div onClick={()=>setOpenRend(isOpen?null:r.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',cursor:'pointer'}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:12,fontWeight:600,color:'#3D3D3D'}}>{r.periodo}</div>
                          <div style={{fontSize:10,color:'#888'}}>{r.n_gastos} gasto{r.n_gastos!==1?'s':''} · {new Date(r.created_at).toLocaleDateString('es-CL')}{r.user_name?` · ${r.user_name}`:''}</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#E24B4A'}}>-${(r.total||0).toLocaleString('es-CL')}</div>
                          <span style={{fontSize:11,color:'#888',transform:isOpen?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}>▾</span>
                        </div>
                      </div>
                      {isOpen&&(
                        <div style={{padding:'2px 0 10px 4px'}}>
                          {det.length===0&&<div style={{fontSize:11,color:'#888',padding:'4px 0'}}>Sin detalle disponible</div>}
                          {det.map(e=>(
                            <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:'1px solid #F0F0F0'}}>
                              <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                                {e.category&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:3,background:CATS[e.category]||CATS['Otro'],color:'#537281',fontWeight:600,flexShrink:0}}>{e.category}</span>}
                                <span style={{fontSize:12,color:'#3D3D3D',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                              </div>
                              <div style={{fontSize:11,color:'#888',flexShrink:0,marginLeft:8}}>{fmtFechaDMY(e.date)}</div>
                              <div style={{fontSize:12,fontWeight:600,color:'#E24B4A',flexShrink:0,marginLeft:8}}>-${(e.amount||0).toLocaleString('es-CL')}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Tareas</div>
              <button onClick={()=>onAddTask(cl)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid #537281',background:'transparent',color:'#537281',fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
            </div>
            {clientTasks.length===0&&<div style={{fontSize:12,color:'#888'}}>Sin tareas activas</div>}
            {clientTasks.map(t=>(
              <div key={t.id} style={{padding:'8px 0',borderBottom:'1px solid #E8E8E8'}}>
                <div style={{fontSize:13,color:'#3D3D3D',fontWeight:500}}>{t.title}</div>
                {t.due&&<div style={{fontSize:11,color:'#888',marginTop:2}}>Vence: {fmtFechaDMY(t.due)}</div>}
              </div>
            ))}
          </div>

        </div>
        {ftab==='contacto'&&<ContactoTab client={cl} entities={entities} onSaveFields={onSaveFields}/>}
      </div>
    )
  }

  if(selected) return (
    <>
      <Ficha cl={selected}/>
      {confirmEdit&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:200,display:'flex',alignItems:'flex-end'}}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:24,width:'100%',boxSizing:'border-box'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#3D3D3D',marginBottom:8}}>Confirmar cambios</div>
            <div style={{fontSize:13,color:'#888',marginBottom:20}}>{'¿'}Confirmas que los datos son correctos y quieres guardar los cambios en el cliente <strong>{confirmEdit.name}</strong>?</div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setConfirmEdit(null)} style={{flex:1,padding:12,borderRadius:10,border:'1px solid #E8E8E8',background:'#fff',color:'#888',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
              <button onClick={()=>{onEdit(confirmEdit);setConfirmEdit(null)}} style={{flex:2,padding:12,borderRadius:10,border:'none',background:'#003C50',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar cambios</button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:'#F7F8F9',zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:'#3D3D3D',fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImportDrive} style={{padding:'6px 12px',borderRadius:8,border:`1px solid #003C50`,background:'transparent',color:'#003C50',fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}><DriveIcon size={13}/>Drive</button>
            <button onClick={onAdd} style={{padding:'6px 14px',borderRadius:8,border:'none',background:'#003C50',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Cliente</button>
          </div>
        </div>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #E8E8E8',background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',marginBottom:8}}/>
        <ClientStatusTabs value={sFilter} onChange={setSFilter} activeN={activeN} endedN={endedN} prospectoN={prospectoN}/>
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:'#888',textAlign:'center',padding:40}}>Sin clientes</div>}
        {filtered.map(cl=><ClientRow key={cl.id} cl={cl}/>)}
      </div>
    </div>
  )
}


// ─── NUEVO CLIENTE LIMITED (con anti-duplicado) ───────────────────────────
function NuevoClienteLimitedForm({clients,onSave,onClose,saving}) {
  const [name,setName] = useState('')
  const [type,setType] = useState('Corporativo')
  const [rut,setRut] = useState('')
  const [showConfirm,setShowConfirm] = useState(false)

  const similares = useMemo(()=>{
    if(name.trim().length<3) return []
    const q = name.trim().toLowerCase()
    return clients.filter(c=>
      c.name.toLowerCase().includes(q) ||
      q.split(' ').some(w=>w.length>2&&c.name.toLowerCase().includes(w))
    ).slice(0,5)
  },[name,clients])

  const handleGuardar = () => {
    if(!name.trim()) return
    if(similares.length>0 && !showConfirm) { setShowConfirm(true); return }
    onSave({name:name.trim(),type,rut:rut.trim()||null,status:'Activo'})
  }

  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:6}}>Nombre del cliente</div>
        <input value={name} onChange={e=>{setName(e.target.value);setShowConfirm(false)}} placeholder='Nombre completo...' autoFocus
          style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid #E8E8E8',background:'#F7F7F7',fontSize:14,boxSizing:'border-box',outline:'none'}}/>
        {similares.length>0&&(
          <div style={{marginTop:8,padding:'10px 12px',borderRadius:8,background:'#FAEEDA',border:'1px solid #C77F18'}}>
            <div style={{fontSize:11,fontWeight:700,color:'#C77F18',marginBottom:6}}>{'\u26a0\ufe0f'} Clientes similares encontrados:</div>
            {similares.map(s=>(
              <div key={s.id} style={{fontSize:12,color:'#C77F18',padding:'2px 0'}}>{s.name}{s.type?` · ${s.type}`:''}</div>
            ))}
            <div style={{fontSize:11,color:'#C77F18',marginTop:6}}>Verifica que no sea un duplicado antes de continuar.</div>
          </div>
        )}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
        <div>
          <div style={{fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:6}}>Tipo</div>
          <select value={type} onChange={e=>setType(e.target.value)}
            style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid #E8E8E8',background:'#F7F7F7',fontSize:13,boxSizing:'border-box'}}>
            {['Corporativo','Tributario','Laboral','Otro'].map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:6}}>RUT (opcional)</div>
          <input value={rut} onChange={e=>setRut(e.target.value)} placeholder='12.345.678-9'
            style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid #E8E8E8',background:'#F7F7F7',fontSize:13,boxSizing:'border-box',outline:'none'}}/>
        </div>
      </div>

      {showConfirm&&(
        <div style={{padding:'12px 14px',borderRadius:8,background:'#FCEBEB',border:'1px solid #E24B4A',marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:'#E24B4A',marginBottom:4}}>{'\u00bf'}Confirmas que este cliente NO es un duplicado?</div>
          <div style={{fontSize:11,color:'#E24B4A'}}>Hay clientes con nombres similares. Si es un cliente nuevo, confirma para continuar.</div>
        </div>
      )}

      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:'1px solid #E8E8E8',background:'#fff',color:'#888',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!name.trim()} onClick={handleGuardar}
          style={{flex:2,padding:11,borderRadius:10,border:'none',background:showConfirm?'#E24B4A':'#003C50',color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:(!name.trim())?.6:1}}>
          {saving?'Guardando...':(showConfirm?'Sí, crear de todas formas':'Guardar cliente')}
        </button>
      </div>
    </div>
  )
}

// ─── CAJA CHICA VIEW (limited) ─────────────────────────────────────────────
function CajaChicaView({expenses,setExpenses,clients,currentUserName,currentUserEmail,pettyCash,setPettyCash,rendiciones,setRendiciones}) {
  const me = currentUserName || ''
  const [tab,setTab] = useState('liquidar') // liquidar | historial | caja
  const [selected,setSelected] = useState(new Set())
  const [saving,setSaving] = useState(false)
  const [openRendicion,setOpenRendicion] = useState(null)
  const [confirmLiq,setConfirmLiq] = useState(false) // popup de confirmación de liquidación
  const [enviarA,setEnviarA] = useState('')
  const [cc,setCc] = useState('')
  const [toast,setToast] = useState(null) // confirmación post-liquidación
  const [openLiquidados,setOpenLiquidados] = useState(false) // historial "Gastos liquidados" (colapsado)
  const [newMonto,setNewMonto] = useState('')
  const [newFecha,setNewFecha] = useState(new Date().toISOString().slice(0,10))
  const [newNota,setNewNota] = useState('')
  const [newDeliveredBy,setNewDeliveredBy] = useState('Cristóbal')
  const [showNuevaCaja,setShowNuevaCaja] = useState(false)
  const [cajaOtra,setCajaOtra] = useState(false)
  const [fDesde,setFDesde] = useState('')
  const [fHasta,setFHasta] = useState('')
  const [fCliente,setFCliente] = useState('')
  const [fCat,setFCat] = useState('')

  // Gastos pendientes de liquidar DEL USUARIO (tipo gasto, no rendidos, created_by = me)
  const misPendientes = expenses.filter(e=>e.type==='gasto'&&!e.rendered_at&&e.created_by===me)
  const pendientes = misPendientes.filter(e=>!fCat||e.category===fCat).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1)
  // "Sin liquidar": total pendiente del usuario, independiente del filtro de categoría
  const sinLiquidar = misPendientes.reduce((a,e)=>a+(e.amount||0),0)

  // Caja actual del usuario
  const miCaja = pettyCash.filter(p=>p.user_name===me)
  const saldoCaja = saldoCajaChica(pettyCash, expenses, me)

  const toggleSelect = id => setSelected(prev=>{
    const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n
  })

  // Selección estable: se arma sobre TODOS los pendientes del usuario (no se pierde al filtrar por categoría)
  const seleccionados = misPendientes.filter(e=>selected.has(e.id))
  const totalSel = seleccionados.reduce((a,e)=>a+(e.amount||0),0)

  const fmtCLP = fmtN
  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Registro Civil':'#EDE3F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}
  // Pills de categoría en PENDIENTES: [valor en DB, etiqueta mostrada]
  const CAT_PILLS = [['','Todos'],['Notaria','Notaria'],['CBR','CBR'],['Diario Oficial','DO'],['Registro Civil','R. Civil'],['Otro','Otro']]
  const catLabel = c => c==='Diario Oficial'?'DO':c==='Registro Civil'?'R. Civil':(c||'Otro')
  const catBadge = c => c==='CBR'?{bg:'#E4E8EB',color:'#003C50'}:(c==='Notaria'||c==='Diario Oficial')?{bg:'#FFF8E1',color:'#B8860B'}:{bg:'#F5F7F9',color:'#537281'}
  // KPI cards (compartidas PENDIENTES/CAJA): mismo formato que Facturación — fondo con tinte de
  // color según el dato, label mayúscula muted, cifra bold del color. El bg se pasa por tarjeta.
  const kpiCard = {flex:1,minWidth:0,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}
  const kpiLbl = {fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,whiteSpace:'nowrap'}
  const kpiVal = {fontSize:15,fontWeight:700,whiteSpace:'nowrap',lineHeight:1.15}
  const kpiSub = {fontSize:8,fontWeight:600,letterSpacing:.4,marginTop:1,textTransform:'uppercase'}

  // Auto-cierre del mensaje de confirmación post-liquidación
  useEffect(()=>{ if(toast){ const t=setTimeout(()=>setToast(null),7000); return ()=>clearTimeout(t) } },[toast])

  const periodoActual = () => new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'})

  const handleLiquidar = async(abrirCorreo=false) => {
    if(!selected.size) return
    setSaving(true)
    try {
      const renderId = crypto.randomUUID()
      const now = new Date().toISOString()
      const periodo = periodoActual()
      const gastosSel = seleccionados
      const totalLiq = gastosSel.reduce((a,e)=>a+(e.amount||0),0)
      const selIds = new Set(gastosSel.map(e=>e.id))
      const clientesIds = [...new Set(gastosSel.map(e=>e.client_id).filter(Boolean))]
      // Registrar la liquidación PRIMERO — si falla, ningún gasto queda marcado
      const {error:rErr} = await supabase.from('rendiciones').insert({ id: renderId, user_name: me, periodo, total: totalLiq, n_gastos: gastosSel.length, n_clientes: clientesIds.length })
      if(rErr) throw rErr
      // Marcar gastos — acumular errores parciales en vez de silenciarlos
      const erroresMarcado = []
      for(const e of gastosSel) {
        const {error} = await supabase.from('expenses').update({ rendered_at: now, render_id: renderId, rendered_by: me }).eq('id',e.id)
        if(error) erroresMarcado.push(e.concept||e.id)
      }
      if(erroresMarcado.length) alert(`Liquidación creada, pero ${erroresMarcado.length} gasto(s) no se marcaron: ${erroresMarcado.join(', ')}.\nPuedes anularla y reintentar.`)
      // Estado local: agregar rendición y marcar gastos (salen de pendientes y entran a liquidados sin recargar)
      setRendiciones(p=>[{id:renderId,user_name:me,periodo,total:totalLiq,n_gastos:gastosSel.length,n_clientes:clientesIds.length,created_at:now},...p])
      if(setExpenses) setExpenses(p=>p.map(e=>selIds.has(e.id)?{...e,rendered_at:now,render_id:renderId,rendered_by:me}:e))
      setSelected(new Set())
      setConfirmLiq(false)
      let correoOk = false
      if(abrirCorreo) {
        const dest = (enviarA||'').trim() || 'ee@leabogados.cl,cl@leabogados.cl'
        const asunto = encodeURIComponent('Liquidación caja chica — ' + me + ' — ' + periodo)
        const lineas = gastosSel.map(e=>{ const cn=clients.find(cl=>cl.id===e.client_id)?.name||'Sin cliente'; return '• '+(e.date||'—')+' · '+(e.concept||'—')+' · '+cn+' · '+(e.category||'Otro')+' · $'+(e.amount||0).toLocaleString('es-CL') }).join('\n')
        const cuerpo = encodeURIComponent(
          'Estimados,\n\nAdjunto el detalle de la liquidación de caja chica.\n\n'
          + 'Responsable: ' + me + '\nPeríodo: ' + periodo + '\nN° de gastos: ' + gastosSel.length + '\n\n'
          + 'Detalle:\n' + lineas + '\n\nTOTAL: $' + totalLiq.toLocaleString('es-CL') + '\n\nQuedo a disposición para cualquier consulta.'
        )
        const ccStr = (cc||'').trim() ? '&cc=' + encodeURIComponent(cc.trim()) : ''
        const mailLink = document.createElement('a')
        mailLink.href = 'mailto:' + dest + '?subject=' + asunto + ccStr + '&body=' + cuerpo
        mailLink.click()
        correoOk = true
      }
      setToast({ n: gastosSel.length, total: totalLiq, correo: correoOk })
    } catch(e) { alert('Error: '+e.message) }
    setSaving(false)
  }

  const handleNuevaCaja = async() => {
    if(!newMonto||isNaN(parseInt(newMonto))) return
    setSaving(true)
    try {
      const {data,error} = await supabase.from('petty_cash').insert({
        user_name: me,
        amount: parseInt(newMonto),
        delivered_at: newFecha,
        delivered_by: newDeliveredBy||null,
        notes: newNota||null
      }).select().single()
      if(error) throw error
      setPettyCash(p=>[data,...p])
      setNewMonto(''); setNewNota('')
      setNewFecha(new Date().toISOString().slice(0,10))
      setShowNuevaCaja(false)
    } catch(e) { alert('Error: '+e.message) }
    setSaving(false)
  }

  const generatePDF = () => {
    const gastosSel = seleccionados
    const now = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const A='#003C50', A2='#537281', A4='#E4E8EB'
    // Agrupar por cliente
    const porCliente = {}
    gastosSel.forEach(e=>{
      const cname = clients.find(cl=>cl.id===e.client_id)?.name||'Sin cliente'
      if(!porCliente[cname]) porCliente[cname]=[]
      porCliente[cname].push(e)
    })
    let html = `<!DOCTYPE html><html><head><meta charset='UTF-8'>
    <title>Liquidación Caja Chica — ${me} — ${now}</title>
    <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'DM Sans',sans-serif;color:#3D3D3D;font-size:11px;padding:0}
    @page{size:letter portrait;margin:16mm 18mm}
    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}
    .header{background:${A};color:#fff;padding:20px 24px;margin-bottom:20px}
    .firma{font-size:16px;font-weight:700;letter-spacing:-.3px}
    .doc-title{font-size:13px;font-weight:600;text-align:right}
    .kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}
    .kpi{background:${A4};border-radius:6px;padding:10px 12px}
    .kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;font-weight:600}
    .kpi-value{font-size:15px;font-weight:700;color:${A}}
    table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px}
    thead tr{background:${A};color:#fff}
    thead th{padding:6px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase}
    tbody tr:nth-child(even){background:${A4}}
    tbody td{padding:6px 10px;border-bottom:1px solid ${A4}}
    tfoot tr{background:${A4};font-weight:700}
    tfoot td{padding:7px 10px;border-top:2px solid ${A2}}
    .section-title{font-size:12px;font-weight:700;color:${A};border-bottom:2px solid ${A};padding-bottom:4px;margin:16px 0 10px}
    .footer{margin-top:24px;padding-top:10px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A2}}
    .print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}
    </style></head><body>
    <div class='header' style='display:flex;justify-content:space-between;align-items:center'>
      <div><div class='firma'>Liberona Escala Abogados</div><div style='font-size:9px;opacity:.7;text-transform:uppercase;margin-top:2px'>leabogados.cl</div></div>
      <div class='doc-title'><div>Liquidación de Caja Chica</div><div style='font-size:11px;opacity:.8;margin-top:2px'>${me} · ${now}</div></div>
    </div>
    <div class='kpi-row'>
      <div class='kpi'><div class='kpi-label'>Número de gastos</div><div class='kpi-value'>${gastosSel.length}</div></div>
      <div class='kpi'><div class='kpi-label'>Clientes</div><div class='kpi-value'>${Object.keys(porCliente).length}</div></div>
      <div class='kpi'><div class='kpi-label'>Total a rendir</div><div class='kpi-value'>${fmtN(totalSel)}</div></div>
    </div>`
    Object.entries(porCliente).forEach(([cname,gastos])=>{
      const tot=gastos.reduce((a,e)=>a+e.amount,0)
      html+=`<div class='section-title'>${cname} — ${fmtN(tot)}</div>
      <table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th style='text-align:right'>Monto</th></tr></thead><tbody>`
      gastos.forEach(e=>{ html+=`<tr><td>${e.date||'—'}</td><td>${e.category||'Otro'}</td><td>${e.concept||'—'}</td><td style='text-align:right;font-weight:600;color:#E24B4A'>-${fmtN(e.amount)}</td></tr>` })
      html+=`</tbody><tfoot><tr><td colspan='3'>TOTAL ${cname.toUpperCase()}</td><td style='text-align:right;color:#E24B4A'>-${fmtN(tot)}</td></tr></tfoot></table>`
    })
    html+=`<div class='footer'><span>Liberona Escala Abogados · leabogados.cl</span><span>${me} · ${now}</span><span>CONFIDENCIAL</span></div>
    <button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button>
    </body></html>`
    const w=window.open('','_blank'); w.document.write(html); w.document.close()
  }

  return (
    <div>
      {/* Confirmación post-liquidación (PASO 3) */}
      {toast&&(
        <div style={{position:'fixed',top:12,left:0,right:0,zIndex:400,display:'flex',justifyContent:'center',padding:'0 16px',pointerEvents:'none'}}>
          <div style={{background:'#fff',border:'1px solid #1D9E75',borderLeft:'4px solid #1D9E75',borderRadius:10,padding:'12px 16px',maxWidth:520,width:'100%',boxShadow:'0 6px 24px rgba(0,0,0,.15)',pointerEvents:'auto',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:'#0F6E56'}}>Liquidación registrada</div>
              <div style={{fontSize:12,color:'#3D3D3D',marginTop:2}}>{toast.n} gasto{toast.n!==1?'s':''} liquidado{toast.n!==1?'s':''} por {fmtCLP(toast.total)}</div>
              {toast.correo&&<div style={{fontSize:11,color:'#C77F18',marginTop:5,fontWeight:600}}>Correo preparado — recuerda enviarlo desde tu cliente de correo</div>}
            </div>
            <button onClick={()=>setToast(null)} style={{background:'none',border:'none',color:'#888',cursor:'pointer',fontSize:18,lineHeight:1,padding:0}}>×</button>
          </div>
        </div>
      )}
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:'#F7F8F9',zIndex:10}}>
        <div style={{fontSize:20,fontWeight:600,color:'#3D3D3D',fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:12}}>Caja Chica</div>
        <div style={{display:'flex',background:'#F2F2F7',borderRadius:10,padding:3}}>
          {[['liquidar','PENDIENTES'],['caja','CAJA']].map(([id,lbl])=>{ const on=tab===id; return (
            <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:'7px 0',borderRadius:8,
              border:on?'0.5px solid rgba(0,0,0,.07)':'0.5px solid transparent',
              background:on?'#fff':'transparent',color:on?'#1a1a1a':'#537281',
              fontSize:11,fontWeight:600,letterSpacing:'.05em',cursor:'pointer'}}>{lbl}</button>
          )})}
        </div>
      </div>

      {tab==='liquidar'&&(
        <div style={{padding:'0 0 130px'}}>
          {/* Resumen: saldo de caja + total sin liquidar */}
          <div style={{display:'flex',gap:8,padding:'2px 14px 10px'}}>
            <div style={{...kpiCard,background:saldoCaja<0?'#FBE9E7':'#E4F1EA'}}>
              <div style={kpiLbl}>Saldo caja</div>
              <div style={{...kpiVal,color:saldoCaja<0?C.overdue:C.normal}}>{fmtCLP(saldoCaja)}</div>
            </div>
            <div style={{...kpiCard,background:'#E3EEF3'}}>
              <div style={kpiLbl}>Sin liquidar</div>
              <div style={{...kpiVal,color:C.accent}}>{fmtCLP(sinLiquidar)}</div>
            </div>
          </div>
          {/* MIS GASTOS + conteo */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'2px 14px 8px'}}>
            <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase'}}>Mis gastos</span>
            <span style={{fontSize:11,color:'#537281'}}>{pendientes.length} gasto{pendientes.length!==1?'s':''}</span>
          </div>
          {/* Pills de categoría */}
          <div style={{display:'flex',gap:6,overflowX:'auto',padding:'0 14px 10px'}}>
            {CAT_PILLS.map(([val,lbl])=>{ const on=fCat===val; return (
              <button key={val||'todos'} onClick={()=>setFCat(val)} style={{height:24,display:'inline-flex',alignItems:'center',padding:'0 11px',borderRadius:20,fontSize:11,whiteSpace:'nowrap',cursor:'pointer',flexShrink:0,
                border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?'#003C50':'#fff',color:on?'#fff':'#537281'}}>{lbl}</button>
            )})}
          </div>
          {/* Filas de gasto */}
          {pendientes.length===0&&<div style={{color:'#99ABB4',textAlign:'center',padding:36,fontSize:13}}>No tienes gastos pendientes de liquidar</div>}
          {pendientes.map(e=>{
            const client=clients.find(cl=>cl.id===e.client_id)
            const isSel=selected.has(e.id)
            const bdg=catBadge(e.category)
            return (
              <div key={e.id} onClick={()=>toggleSelect(e.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderBottom:'0.5px solid #E4E8EB',cursor:'pointer',background:isSel?'#F5F7F9':'transparent'}}>
                <div style={{width:17,height:17,borderRadius:5,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${isSel?'#003C50':'#99ABB4'}`,background:isSel?'#003C50':'transparent'}}>
                  {isSel&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:'#1a1a1a',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'}</div>
                  <div style={{fontSize:10,color:'#99ABB4',marginTop:2}}>{e.created_by||me}{e.date?` · ${fmtFechaDMY(e.date)}`:''}{client?` · ${client.name}`:''}</div>
                </div>
                <div style={{flexShrink:0,marginLeft:8,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                  <span style={{fontSize:13,fontWeight:500,color:'#E24B4A'}}>{fmtCLP(e.amount)}</span>
                  {e.category&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,fontWeight:500,background:bdg.bg,color:bdg.color}}>{catLabel(e.category)}</span>}
                </div>
              </div>
            )
          })}
          {/* Barra inferior de liquidación */}
          {selected.size>0&&(
            <div style={{position:'fixed',left:0,right:0,bottom:'calc(56px + env(safe-area-inset-bottom,0px))',background:'#003C50',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',zIndex:49}}>
              <div>
                <div style={{fontSize:10,color:'rgba(255,255,255,.6)',letterSpacing:'.03em'}}>{selected.size} GASTO{selected.size!==1?'S':''} SELECCIONADO{selected.size!==1?'S':''}</div>
                <div style={{fontSize:16,fontWeight:600,color:'#fff',marginTop:1}}>{fmtCLP(totalSel)}</div>
              </div>
              <button onClick={()=>{ setEnviarA(''); setCc(''); setConfirmLiq(true) }} disabled={saving} style={{height:34,padding:'0 18px',background:'#fff',color:'#003C50',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer'}}>Liquidar</button>
            </div>
          )}
        </div>
      )}

      {tab==='caja'&&(()=>{
        const misRend = rendiciones.filter(r=>r.user_name===me).sort((a,b)=>(b.created_at||'')>(a.created_at||'')?1:-1)
        const totalLiquidado = misRend.reduce((a,r)=>a+(r.total||0),0)
        const cajasOrd = [...miCaja].sort((a,b)=>(b.delivered_at||'')>(a.delivered_at||'')?1:-1)
        const totalRecibido = cajasOrd.reduce((a,p)=>a+(p.amount||0),0)
        const secLbl = {fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase'}
        const totRow = (lbl,val)=>(<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#F5F7F9',borderRadius:8,padding:'8px 11px',marginTop:8}}><span style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.02em',textTransform:'uppercase'}}>{lbl}</span><span style={{fontSize:12,fontWeight:600,color:'#003C50'}}>{fmtCLP(val)}</span></div>)
        const fmtD = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() }catch(e){return iso||'—'} }
        return (
        <div style={{padding:'4px 0 100px'}}>
          {/* KPIs */}
          <div style={{display:'flex',gap:8,padding:'4px 14px 10px'}}>
            <div style={{...kpiCard,background:saldoCaja<0?'#FBE9E7':'#E4F1EA'}}>
              <div style={kpiLbl}>Saldo</div>
              <div style={{...kpiVal,color:saldoCaja<0?C.overdue:C.normal}}>{fmtCLP(saldoCaja)}</div>
              <div style={{...kpiSub,color:saldoCaja<0?C.overdue:C.muted}}>{saldoCaja<0?'Te debemos':'Disponible'}</div>
            </div>
            <div style={{...kpiCard,background:'#E4E8EB'}}>
              <div style={kpiLbl}>Liquidado</div>
              <div style={{...kpiVal,color:C.muted}}>{fmtCLP(totalLiquidado)}</div>
              <div style={{...kpiSub,color:C.muted}}>Histórico</div>
            </div>
          </div>
          {/* CAJAS ENTREGADAS */}
          <div style={{borderTop:'0.5px solid #F5F7F9',padding:'11px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:9}}>
              <span style={secLbl}>Cajas entregadas</span>
              <button onClick={()=>{ setNewMonto(''); setNewNota(''); setNewFecha(new Date().toISOString().slice(0,10)); setNewDeliveredBy('Cristóbal'); setShowNuevaCaja(true) }} style={{height:26,padding:'0 12px',border:'none',borderRadius:8,background:'#003C50',color:'#fff',fontSize:11,fontWeight:500,cursor:'pointer'}}>+ Nueva Caja</button>
            </div>
            {cajasOrd.length===0&&<div style={{fontSize:12,color:'#99ABB4',padding:'4px 0'}}>Aún no hay cajas registradas.</div>}
            {cajasOrd.map((p,i)=>{ const activa=i===0&&!p.rendered_at; return (
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'0.5px solid #F5F7F9'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:'#1a1a1a'}}>{fmtCLP(p.amount)}</div>
                  <div style={{fontSize:10,color:'#99ABB4',marginTop:1}}>Entregado por {p.delivered_by||'—'}{p.delivered_at?` · ${fmtD(p.delivered_at)}`:''}</div>
                </div>
                <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,flexShrink:0,background:activa?'#E1F5EE':'#F5F7F9',color:activa?'#1D9E75':'#99ABB4'}}>{activa?'Activa':'Cerrada'}</span>
              </div>
            )})}
            {cajasOrd.length>0&&totRow('Total recibido',totalRecibido)}
          </div>
          {/* LIQUIDACIONES */}
          <div style={{borderTop:'0.5px solid #E4E8EB',marginTop:4,padding:'11px 14px'}}>
            <div style={{marginBottom:9}}><span style={secLbl}>Liquidaciones</span></div>
            {misRend.length===0&&<div style={{fontSize:12,color:'#99ABB4',padding:'4px 0'}}>Aún no hay liquidaciones.</div>}
            {misRend.map(r=>{
              const isOpen=openRendicion===r.id
              const gastosR=expenses.filter(e=>e.render_id===r.id)
              return (
              <div key={r.id} style={{borderBottom:'0.5px solid #F5F7F9'}}>
                <div onClick={()=>setOpenRendicion(isOpen?null:r.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',cursor:'pointer'}}>
                  <div><div style={{fontSize:12,fontWeight:500,color:'#1a1a1a'}}>{r.periodo}</div><div style={{fontSize:10,color:'#99ABB4',marginTop:1}}>{r.n_gastos} gasto{r.n_gastos!==1?'s':''}</div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:12,fontWeight:500,color:'#537281'}}>{fmtCLP(r.total)}</span>
                    <span style={{fontSize:11,color:'#99ABB4',transform:isOpen?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}>▾</span>
                  </div>
                </div>
                {isOpen&&(
                  <div style={{padding:'2px 0 10px'}}>
                    {gastosR.length===0&&<div style={{fontSize:12,color:'#99ABB4',padding:'4px 0'}}>Sin detalle disponible</div>}
                    {gastosR.map(e=>{ const cl=clients.find(x=>x.id===e.client_id); return (
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,color:'#1a1a1a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                          <div style={{fontSize:10,color:'#99ABB4',marginTop:1}}>{cl?cl.name+' · ':''}{e.date?fmtD(e.date):''}{e.category?' · '+catLabel(e.category):''}</div>
                        </div>
                        <div style={{fontSize:12,fontWeight:500,color:'#E24B4A',flexShrink:0}}>{fmtCLP(e.amount)}</div>
                      </div>
                    )})}
                    <div style={{display:'flex',gap:8,marginTop:10}}>
                      <button onClick={()=>{
                        const now=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
                        const A='#003C50',A2='#537281',A4='#E4E8EB'
                        const porCliente={}
                        gastosR.forEach(e=>{ const cn=clients.find(x=>x.id===e.client_id)?.name||'Sin cliente'; if(!porCliente[cn])porCliente[cn]=[]; porCliente[cn].push(e) })
                        let html=`<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Liquidación — ${r.user_name} — ${r.periodo}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;color:#3D3D3D;font-size:11px}@page{size:letter portrait;margin:16mm 18mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}.header{background:${A};color:#fff;padding:20px 24px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}.firma{font-size:16px;font-weight:700}.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}.kpi{background:${A4};border-radius:6px;padding:10px 12px}.kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;font-weight:600}.kpi-value{font-size:15px;font-weight:700;color:${A}}table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px}thead tr{background:${A};color:#fff}thead th{padding:6px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase}tbody tr:nth-child(even){background:${A4}}tbody td{padding:6px 10px;border-bottom:1px solid ${A4}}tfoot tr{background:${A4};font-weight:700}tfoot td{padding:7px 10px;border-top:2px solid ${A2}}.section-title{font-size:12px;font-weight:700;color:${A};border-bottom:2px solid ${A};padding-bottom:4px;margin:16px 0 10px}.footer{margin-top:24px;padding-top:10px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A2}}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}</style></head><body><div class='header'><div><div class='firma'>Liberona Escala Abogados</div><div style='font-size:9px;opacity:.7;margin-top:2px'>leabogados.cl</div></div><div style='text-align:right'><div style='font-size:13px;font-weight:600'>Liquidación de Caja Chica</div><div style='font-size:11px;opacity:.8;margin-top:2px'>${r.user_name} · ${r.periodo}</div></div></div><div class='kpi-row'><div class='kpi'><div class='kpi-label'>Gastos</div><div class='kpi-value'>${gastosR.length}</div></div><div class='kpi'><div class='kpi-label'>Clientes</div><div class='kpi-value'>${Object.keys(porCliente).length}</div></div><div class='kpi'><div class='kpi-label'>Total</div><div class='kpi-value'>${fmtN(r.total)}</div></div></div>`
                        Object.entries(porCliente).forEach(([cn,gs])=>{ const tot=gs.reduce((a,e)=>a+e.amount,0); html+=`<div class='section-title'>${cn} — ${fmtN(tot)}</div><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th style='text-align:right'>Monto</th></tr></thead><tbody>`; gs.forEach(e=>{ html+=`<tr><td>${e.date||'—'}</td><td>${e.category||'Otro'}</td><td>${e.concept||'—'}</td><td style='text-align:right;font-weight:600;color:#E24B4A'>-${fmtN(e.amount)}</td></tr>` }); html+=`</tbody><tfoot><tr><td colspan='3'>TOTAL ${cn.toUpperCase()}</td><td style='text-align:right;color:#E24B4A'>-${fmtN(tot)}</td></tr></tfoot></table>` })
                        html+=`<div class='footer'><span>Liberona Escala Abogados</span><span>${r.user_name} · ${r.periodo}</span><span>CONFIDENCIAL</span></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / PDF</button></body></html>`
                        const w=window.open('','_blank'); w.document.write(html); w.document.close()
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E4E8EB',background:'#F5F7F9',color:'#003C50',fontSize:11,fontWeight:500,cursor:'pointer'}}>PDF</button>
                      <button onClick={()=>{
                        const a2=encodeURIComponent('Liquidación caja chica — '+r.user_name+' — '+r.periodo)
                        const b2=encodeURIComponent('Estimados,\n\nAdjunto la liquidación de caja chica.\n\nResponsable: '+r.user_name+'\nPeríodo: '+r.periodo+'\nGastos: '+gastosR.length+'\nTotal: $'+r.total.toLocaleString('es-CL'))
                        const mailLink=document.createElement('a'); mailLink.href='mailto:ee@leabogados.cl,cl@leabogados.cl?subject='+a2+'&body='+b2; mailLink.click()
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E4E8EB',background:'#F5F7F9',color:'#537281',fontSize:11,fontWeight:500,cursor:'pointer'}}>Correo</button>
                      <button onClick={async()=>{
                        if(!confirm('¿Anular esta liquidación? Los gastos vuelven a Pendientes.')) return
                        try {
                          await supabase.from('expenses').update({rendered_at:null,render_id:null,rendered_by:null}).eq('render_id',r.id)
                          await supabase.from('rendiciones').delete().eq('id',r.id)
                          if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==r.id))
                          if(setExpenses) setExpenses(p=>p.map(e=>e.render_id===r.id?{...e,rendered_at:null,render_id:null,rendered_by:null}:e))
                          setOpenRendicion(null)
                        } catch(err) { alert('Error: '+err.message) }
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E24B4A',background:'transparent',color:'#E24B4A',fontSize:11,fontWeight:500,cursor:'pointer'}}>Anular</button>
                    </div>
                  </div>
                )}
              </div>
              )
            })}
            {misRend.length>0&&totRow('Total liquidado',totalLiquidado)}
          </div>
        </div>
        )
      })()}

      {/* Modal de liquidación (PP-12 commit 2): detalle compacto + PDF / Correo / Confirmar */}
      {confirmLiq&&(()=>{
        const gastosSel = seleccionados
        const totalLiq = gastosSel.reduce((a,e)=>a+(e.amount||0),0)
        const secBtn = {height:40,borderRadius:8,background:'#F5F7F9',color:'#003C50',border:'0.5px solid #E4E8EB',fontSize:12,fontWeight:500,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}
        return (
          <div onClick={()=>!saving&&setConfirmLiq(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:18,width:'100%',maxWidth:340,maxHeight:'85vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'15px 16px'}}>
                <span style={{fontSize:15,fontWeight:600,color:'#003C50'}}>Liquidar caja chica</span>
                <button onClick={()=>!saving&&setConfirmLiq(false)} style={{background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:0}}>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.5' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
                </button>
              </div>
              <div style={{overflowY:'auto',padding:'0 16px'}}>
                {gastosSel.map(e=>(
                  <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'0.5px solid #E4E8EB'}}>
                    <span style={{fontSize:12,color:'#537281',maxWidth:200,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'}</span>
                    <span style={{fontSize:12,fontWeight:500,color:'#1a1a1a',flexShrink:0}}>{fmtCLP(e.amount)}</span>
                  </div>
                ))}
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#F5F7F9',borderRadius:10,padding:'10px 13px',margin:'12px 16px'}}>
                <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.04em',textTransform:'uppercase'}}>Total · {gastosSel.length} gasto{gastosSel.length!==1?'s':''}</span>
                <span style={{fontSize:15,fontWeight:600,color:'#003C50'}}>{fmtCLP(totalLiq)}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'0 16px 16px'}}>
                <button onClick={generatePDF} disabled={saving} style={secBtn}>
                  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#003C50' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/></svg>PDF
                </button>
                <button onClick={()=>handleLiquidar(true)} disabled={saving} style={secBtn}>
                  <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#003C50' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='5' width='18' height='14' rx='2'/><polyline points='3 7 12 13 21 7'/></svg>Correo
                </button>
                <button onClick={()=>handleLiquidar(false)} disabled={saving} style={{gridColumn:'span 2',height:44,borderRadius:10,background:'#003C50',color:'#fff',border:'none',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:7,opacity:saving?.6:1}}>
                  {saving?<Spin/>:<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}{saving?'Procesando...':'Confirmar liquidación'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal Nueva Caja Chica (PP-12 commit 3) — diseño moderno, sin mensaje amarillo */}
      {showNuevaCaja&&(()=>{
        const hoyISO = new Date().toISOString().slice(0,10)
        const hoySel = !cajaOtra && newFecha===hoyISO
        const lbl = {fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:7}
        const fpill = on => ({fontSize:12,padding:'6px 12px',borderRadius:20,cursor:'pointer',border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?'#E6EEF1':'#fff',color:on?'#003C50':'#537281',fontWeight:on?600:400})
        return (
          <div onClick={()=>!saving&&setShowNuevaCaja(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px 16px'}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:18,width:'100%',maxWidth:360,padding:'18px 20px 20px',maxHeight:'85vh',overflowY:'auto'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <span style={{fontSize:16,fontWeight:600,color:'#003C50'}}>Nueva caja chica <span style={{color:'#99ABB4',fontWeight:400,margin:'0 6px'}}>|</span><span style={{color:'#537281',fontWeight:600}}>{me}</span></span>
                <button onClick={()=>!saving&&setShowNuevaCaja(false)} style={{background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:0}}>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.5' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
                </button>
              </div>

              <div style={{marginBottom:16}}>
                <div style={lbl}>Monto</div>
                <div style={{display:'flex',alignItems:'center',gap:6,background:'#F5F7F9',border:'0.5px solid #E4E8EB',borderRadius:10,padding:'12px 14px'}}>
                  <span style={{fontSize:20,fontWeight:500,color:'#99ABB4'}}>$</span>
                  <input value={newMonto} onChange={e=>setNewMonto(e.target.value.replace(/\D/g,''))} inputMode='numeric' placeholder='0' style={{flex:1,border:'none',background:'none',fontSize:22,fontWeight:600,color:'#1a1a1a',outline:'none',width:'100%'}}/>
                </div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                  {[50000,100000,150000,200000].map(m=>{ const on=String(m)===newMonto; return (
                    <button key={m} onClick={()=>setNewMonto(String(m))} style={fpill(on)}>{fmtCLP(m)}</button>
                  )})}
                </div>
              </div>

              <div style={{marginBottom:16}}>
                <div style={lbl}>Entregado por</div>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  {['Cristóbal','Erasmo'].map(n=>{ const on=newDeliveredBy===n; return (
                    <button key={n} onClick={()=>setNewDeliveredBy(n)} style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:12,fontWeight:on?600:400,padding:'6px 13px 6px 6px',borderRadius:20,border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?'#E6EEF1':'#fff',color:on?'#003C50':'#537281',cursor:'pointer'}}>
                      <span style={{width:24,height:24,borderRadius:'50%',background:on?'#003C50':'#99ABB4',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700}}>{INICIALES_RESP[n]||n.slice(0,2).toUpperCase()}</span>{n}
                    </button>
                  )})}
                </div>
              </div>

              <div style={{marginBottom:16}}>
                <div style={lbl}>Fecha</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  <button onClick={()=>{setNewFecha(hoyISO);setCajaOtra(false)}} style={fpill(hoySel)}>Hoy</button>
                  <button onClick={()=>setCajaOtra(true)} style={fpill(cajaOtra)}>Otra fecha</button>
                  {cajaOtra&&<input type='date' value={newFecha} onChange={e=>setNewFecha(e.target.value)} style={{height:34,border:'0.5px solid #E4E8EB',borderRadius:8,fontSize:12,padding:'0 10px',color:'#1a1a1a',outline:'none'}}/>}
                </div>
              </div>

              <div style={{marginBottom:18}}>
                <div style={lbl}>Nota <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· opcional</span></div>
                <input value={newNota} onChange={e=>setNewNota(e.target.value)} placeholder='Ej: cubre saldo + caja del mes' style={{width:'100%',height:38,border:'0.5px solid #E4E8EB',borderRadius:8,fontSize:13,padding:'0 12px',color:'#1a1a1a',background:'#fff',outline:'none',boxSizing:'border-box'}}/>
              </div>

              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>setShowNuevaCaja(false)} disabled={saving} style={{flex:1,height:44,borderRadius:10,border:'0.5px solid #E4E8EB',background:'#fff',color:'#537281',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                <button onClick={handleNuevaCaja} disabled={saving||!newMonto} style={{flex:2,height:44,borderRadius:10,border:'none',background:'#003C50',color:'#fff',fontSize:13,fontWeight:600,cursor:newMonto?'pointer':'not-allowed',opacity:(saving||!newMonto)?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>{saving?<Spin/>:null}{saving?'Guardando...':'Registrar caja'}</button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function BottomNav({tab,setTab,overdueN,userRole}) {
  const tabs = userRole==='admin' ? TABS_ADMIN : TABS_LIMITED
  const icons = {house:'⌂',tag:'◈',dollar:'$',minus:'⊖',person:'⊙',check:'✓'}
  return (
    <div className='bottomnav' style={{position:'fixed',bottom:0,left:0,right:0,background:C.surface,borderTop:`1px solid ${C.border}`,display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0)'}}>
      <style>{`
        @media(min-width:768px){
          .bottomnav { border-radius: 0; max-width: none; }
          .bottomnav button { padding: 14px 0 12px !important; }
          .bottomnav button span:first-child { font-size: 22px !important; }
          .bottomnav button span:last-child { font-size: 12px !important; }
        }
      `}</style>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:'10px 0 8px',background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3,position:'relative',minWidth:0}}>
          <span style={{fontSize:16,lineHeight:1,color:tab===t.id?C.accent:C.muted}}>{icons[t.icon]}</span>
          <span style={{fontSize:10,color:tab===t.id?C.accent:C.muted,fontWeight:tab===t.id?700:400,whiteSpace:'nowrap'}}>{t.label}</span>
          {t.id==='billing'&&overdueN>0&&<span style={{position:'absolute',top:4,right:'calc(50% - 16px)',background:C.overdue,color:'#fff',borderRadius:10,fontSize:9,fontWeight:700,padding:'1px 5px'}}>{overdueN}</span>}
        </button>
      ))}
    </div>
  )
}

const WHO_LIST = ['Cristóbal','Martín','Martina','Erasmo']

function TasksByPerson({tasks,clients}) {
  const [open,setOpen] = useState(null)
  const active = tasks?.filter(t=>t.status==='Activo')||[]

  return (
    <div>
      {WHO_LIST.map(who=>{
        const mine = active.filter(t=>isAssignee(t,who))
          .sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))
        if(mine.length===0) return null
        const overdueN = mine.filter(t=>urgency(t.due,t.status)==='overdue').length
        const urgentN  = mine.filter(t=>urgency(t.due,t.status)==='urgent').length
        const isOpen = open===who
        return (
          <div key={who} style={{marginBottom:8,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden',background:C.card}}>
            <button onClick={()=>setOpen(isOpen?null:who)} style={{width:'100%',padding:'12px 14px',background:'none',border:'none',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'#E6EEF1',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:C.accent,flexShrink:0}}>
                  {who[0]}
                </div>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{who}</div>
                  <div style={{fontSize:11,color:C.muted}}>{mine.length} tarea{mine.length!==1?'s':''} pendiente{mine.length!==1?'s':''}</div>
                </div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                {overdueN>0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.overdue,borderRadius:10,padding:'2px 7px'}}>{overdueN} venc.</span>}
                {urgentN>0&&overdueN===0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.soon,borderRadius:10,padding:'2px 7px'}}>{urgentN} urgente{urgentN!==1?'s':''}</span>}
                <span style={{fontSize:16,color:C.muted,transform:isOpen?'rotate(180deg)':'none',transition:'transform .2s'}}>▾</span>
              </div>
            </button>
            {isOpen&&(
              <div style={{borderTop:`1px solid ${C.border}`}}>
                {mine.map(t=>{
                  const client=clients.find(c=>c.id===t.client_id)
                  const u=urgency(t.due,t.status)
                  const rowColor = u==='overdue'?'#FBE9E7':u==='urgent'?'#FFF8EC':u==='soon'?'#FFFBF0':'#fff'
                  return (
                    <div key={t.id} style={{padding:'10px 14px',borderBottom:`1px solid ${C.border}`,background:rowColor,display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                      <div style={{flex:1,minWidth:0}}>
                        {/* Línea 1: contexto (cliente · proyecto › subproyecto · días) */}
                        <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:2}}>
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client?.name?.split('/')[0].trim()||'—'}</span>
                          {t.project&&<><span>·</span><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.project}{t.subproject?` › ${t.subproject}`:''}</span></>}
                          {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                        </div>
                        {/* Línea 2: la tarea, en cursiva */}
                        <div style={{fontSize:13,fontWeight:500,fontStyle:'italic',color:C.text}}>{t.title}</div>
                        {/* Línea 3: nota, más tenue */}
                        {t.note&&<div style={{fontSize:11,color:C.muted,opacity:.75,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.note}</div>}
                      </div>
                      {u==='overdue'&&<span style={{fontSize:10,fontWeight:700,color:C.overdue,flexShrink:0}}>VENCIDA</span>}
                      {t.due&&(()=>{ const dd=t.due.replace(/-/g,''); const cal=`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Vence: '+(t.title||'Tarea')+(client?.name?' · '+client.name.split('/')[0].trim():''))}&dates=${dd}T090000/${dd}T091500&ctz=America/Santiago`; return <a href={cal} target='_blank' rel='noopener noreferrer' title='Agregar a Google Calendar' style={{flexShrink:0,fontSize:13,textDecoration:'none',opacity:.6,marginLeft:2}}>Agendar</a> })()}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
const META_UF = 9800
const META_CLP = 400000000

function CashflowProjection({billing, moneda='CLP', ufRef=0}) {
  const [horizon,setHorizon] = useState(6)
  const [openDetalle,setOpenDetalle] = useState(false)
  const [activePoint,setActivePoint] = useState(null)
  const _diasES=['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const _mesesES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const _hoy=new Date()
  const fechaTitulo=`Proyección al ${_diasES[_hoy.getDay()]} ${_hoy.getDate()} de ${_mesesES[_hoy.getMonth()]} de ${_hoy.getFullYear()}`
  const pending = billing.filter(b=>['Pendiente','Vencido'].includes(b.status)&&b.due&&b.billing_type!=='reembolso')
  const programadas = billing.filter(b=>b.status==='Programada'&&b.due&&b.billing_type!=='reembolso')

  const months = useMemo(()=>{
    const result = []
    const now = new Date()
    for(let i=0;i<horizon;i++){
      const d = new Date(now.getFullYear(), now.getMonth()+i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
      const label = d.toLocaleDateString('es-CL',{month:'short',year:'2-digit'})
      const labelFull = d.toLocaleDateString('es-CL',{month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase())
      const emitidoMes = pending.filter(b=>b.due?.startsWith(key)).reduce((a,b)=>a+(b.amount||0),0)
      const overdue = pending.filter(b=>b.due<key.slice(0,7)+'-01'&&i===0).reduce((a,b)=>a+(b.amount||0),0)
      const emitido = i===0?emitidoMes+overdue:emitidoMes
      const programado = programadas.filter(b=>b.due?.startsWith(key)).reduce((a,b)=>a+(b.amount||0),0)
      result.push({key,label,labelFull,emitido,programado,total:emitido+programado,overdue:i===0?overdue:0})
    }
    return result
  },[billing,horizon])

  const maxVal = Math.max(...months.map(m=>m.total),1)
  const totalHorizon = months.reduce((a,m)=>a+m.total,0)
  const totalEmitido = months.reduce((a,m)=>a+m.emitido,0)
  const totalProgramado = months.reduce((a,m)=>a+m.programado,0)
  const fmtKpi = clp => moneda==='UF' ? (ufRef>0?fmtUFk(clp/ufRef):'—') : fmtShort(clp)

  // Geometria del grafico de linea
  const W=470, padX=24, padTop=14, baseY=120, n=months.length
  const xAt = i => n>1 ? padX + i*(W-2*padX)/(n-1) : W/2
  const yAt = m => baseY - (m.total/maxVal)*(baseY-padTop)
  const linePath = months.map((m,i)=>`${i?'L':'M'}${xAt(i).toFixed(1)},${yAt(m).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${xAt(n-1).toFixed(1)},${baseY} L${xAt(0).toFixed(1)},${baseY} Z`

  const tcell = {borderRadius:10,padding:'10px 12px',background:'#F5F7F9',minWidth:0}
  const tlabel = {fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,marginBottom:5}
  const badge = {fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,whiteSpace:'nowrap'}
  return (
    <div style={{padding:'16px 20px 0'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:8,gap:8}}>
        <div>
          <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'0.06em',textTransform:'uppercase'}}>Cash Flow Forecast</div>
          <div style={{fontSize:10,color:'#99ABB4',marginTop:2,textTransform:'uppercase',letterSpacing:.3}}>{fechaTitulo}</div>
        </div>
        <div style={{display:'flex',gap:4,flexShrink:0}}>
          {[[3,'3M'],[6,'6M'],[12,'12M']].map(([v,l])=>(
            <button key={v} onClick={()=>setHorizon(v)} style={{padding:'3px 10px',borderRadius:6,border:`1px solid ${horizon===v?C.accent:C.border}`,background:horizon===v?'#E6EEF1':'transparent',color:horizon===v?C.accent:'#99ABB4',fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>

        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginBottom:12}}>
          <div style={{...tcell,background:'#fff',border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.accent}`}}><div style={tlabel}>Total</div><div style={{fontSize:17,fontWeight:600,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtKpi(totalHorizon)}</div></div>
          <div style={{...tcell,background:'#fff',border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.normal}`}}><div style={tlabel}>Emitido</div><div style={{fontSize:17,fontWeight:600,color:C.normal,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtKpi(totalEmitido)}</div></div>
          <div style={{...tcell,background:'#fff',border:`1px solid ${C.border}`,borderLeft:'3px solid #99ABB4'}}><div style={tlabel}>Programado</div><div style={{fontSize:17,fontWeight:600,color:'#537281',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtKpi(totalProgramado)}</div></div>
        </div>

        <div style={{display:'flex',gap:14,fontSize:10,color:'#537281',marginBottom:4}}>
          <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:'50%',background:C.accent,display:'inline-block'}}/>Emitido</span>
          <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:8,height:8,borderRadius:'50%',background:'#99ABB4',display:'inline-block'}}/>Programado</span>
          <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:14,borderTop:'2px dashed #99ABB4',display:'inline-block'}}/>Hoy</span>
        </div>

        <svg viewBox={`0 0 ${W} 150`} width="100%" style={{display:'block'}}>
          <defs>
            <linearGradient id="cfArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#003C50" stopOpacity="0.20"/>
              <stop offset="100%" stopColor="#003C50" stopOpacity="0.02"/>
            </linearGradient>
          </defs>
          <line x1={xAt(0)} y1="10" x2={xAt(0)} y2={baseY} stroke="#99ABB4" strokeWidth="1" strokeDasharray="3 3"/>
          <text x={xAt(0)+4} y="16" fontSize="9" fill="#99ABB4" fontWeight="600">Hoy</text>
          <path d={areaPath} fill="url(#cfArea)"/>
          <path d={linePath} fill="none" stroke="#003C50" strokeWidth="2" strokeLinejoin="round"/>
          {months.map((m,i)=>(
            <g key={m.key} onMouseEnter={()=>setActivePoint(i)} onMouseLeave={()=>setActivePoint(null)} onClick={()=>setActivePoint(p=>p===i?null:i)} style={{cursor:'pointer'}}>
              <rect x={xAt(i)-16} y="8" width="32" height={baseY} fill="transparent"/>
              <circle cx={xAt(i)} cy={yAt(m)} r={activePoint===i?5.5:4} fill={m.emitido>0?'#003C50':'#99ABB4'} stroke="#fff" strokeWidth={activePoint===i?1.5:0}/>
            </g>
          ))}
          {months.map((m,i)=>(
            <text key={m.key} x={xAt(i)} y={baseY+22} fontSize="9" fill={activePoint===i?'#003C50':'#99ABB4'} fontWeight={activePoint===i?600:400} textAnchor="middle">{m.label}</text>
          ))}
          {activePoint!=null&&(()=>{
            const m=months[activePoint], x=xAt(activePoint), y=yAt(m)
            const txt=fmt(m.total), w=txt.length*6.2+14
            const bx=Math.max(2,Math.min(W-w-2,x-w/2)), by=Math.max(2,y-26)
            return <g pointerEvents="none"><rect x={bx} y={by} width={w} height="18" rx="4" fill="#003C50"/><text x={bx+w/2} y={by+12.5} fontSize="10" fontWeight="600" fill="#fff" textAnchor="middle">{txt}</text></g>
          })()}
        </svg>

        <div onClick={()=>setOpenDetalle(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,color:C.muted,transform:openDetalle?'rotate(90deg)':'none',transition:'transform .15s'}}>▶</span>
          <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Detalle</span>
        </div>
        {openDetalle&&(
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,marginTop:8}}>
            <thead><tr>
              <th style={{textAlign:'left',fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,padding:'6px 4px',borderBottom:`1px solid ${C.border}`}}>Mes</th>
              <th style={{textAlign:'left',fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,padding:'6px 4px',borderBottom:`1px solid ${C.border}`}}>Estado</th>
              <th style={{textAlign:'right',fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,fontWeight:600,padding:'6px 4px',borderBottom:`1px solid ${C.border}`}}>Monto</th>
            </tr></thead>
            <tbody>
              {months.map(m=>{
                const emitNoVenc = m.emitido - m.overdue
                return (
                  <tr key={m.key}>
                    <td style={{padding:'8px 4px',borderBottom:'1px solid #F1F1F1',color:C.text}}>{m.labelFull}</td>
                    <td style={{padding:'8px 4px',borderBottom:'1px solid #F1F1F1'}}>
                      <span style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                        {m.overdue>0&&<span style={{...badge,background:'#FCEBEB',color:'#E24B4A'}}>Vencido</span>}
                        {emitNoVenc>0&&<span style={{...badge,background:'#E4E8EB',color:'#003C50'}}>Emitido</span>}
                        {m.programado>0&&<span style={{...badge,background:'#F1F1F1',color:'#537281'}}>Programado</span>}
                        {m.total===0&&<span style={{fontSize:11,color:'#99ABB4'}}>—</span>}
                      </span>
                    </td>
                    <td style={{padding:'8px 4px',borderBottom:'1px solid #F1F1F1',textAlign:'right',fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{fmt(m.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function PorFacturarMes({billing, moneda='CLP'}) {
  const ufState = useUF()
  const now = new Date()
  const key = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
  const mesLabel = `${now.toLocaleDateString('es-CL',{month:'long'})} ${now.getFullYear()}`.toUpperCase()
  // Mismo universo y criterio que el checklist de Facturacion (single source of truth):
  // anclaje por vencimiento (due) del mes; emitida = status != Programada. Pagadas quedan fuera del universo.
  const EMIT = ['Pendiente','Vencido','Propuesta']
  const delMes = billing.filter(b=> b.due && b.due.startsWith(key) && (b.status==='Programada'||EMIT.includes(b.status)))
  if(delMes.length===0) return null
  const esEmitida = b => b.status!=='Programada'
  const emitidas = delMes.filter(esEmitida)
  const porFacturar = delMes.filter(b=>!esEmitida(b))
  const emitidasCLP = emitidas.reduce((a,b)=>a+(b.amount||0),0)
  const porFacturarCLP = porFacturar.reduce((a,b)=>a+(b.amount||0),0)
  const totalUF = ufState.uf ? (emitidasCLP+porFacturarCLP)/ufState.uf : null
  const totalCLP = emitidasCLP+porFacturarCLP
  const sm = clp => moneda==='UF' ? (ufState.uf?fmtUFk(clp/ufState.uf):'—') : fmtShort(clp)
  const lbl = {fontSize:11,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,marginBottom:8}
  const big = {fontSize:22,fontWeight:600,lineHeight:1,whiteSpace:'nowrap'}
  const unidad = {fontSize:11,color:'#99ABB4'}
  const sub = {fontSize:12,color:C.muted,marginTop:6,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
  const kpi = {minWidth:0,borderRadius:10,padding:'13px 12px'}
  return (
    <div style={{padding:'16px 20px 0'}}>
      <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:8}}>{mesLabel}</div>
      <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>
          <div style={{...kpi,background:'#fff',border:`1px solid ${C.border}`,borderLeft:'3px solid #99ABB4'}}>
            <div style={lbl}>Emitidas</div>
            <div style={{display:'flex',alignItems:'baseline',gap:5}}><span style={{...big,color:C.text}}>{emitidas.length}</span><span style={unidad}>factura{emitidas.length!==1?'s':''}</span></div>
            <div style={sub}>{sm(emitidasCLP)}</div>
          </div>
          <div style={{...kpi,background:'#fff',border:`1px solid ${C.border}`,borderLeft:'3px solid #C77F18'}}>
            <div style={lbl}>Por facturar</div>
            <div style={{display:'flex',alignItems:'baseline',gap:5}}><span style={{...big,color:'#C77F18'}}>{porFacturar.length}</span><span style={unidad}>factura{porFacturar.length!==1?'s':''}</span></div>
            <div style={sub}>{sm(porFacturarCLP)}</div>
          </div>
          <div style={{...kpi,background:'#fff',border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.accent}`}}>
            <div style={lbl}>Total mes</div>
            <div style={{...big,fontSize:17,color:'#003C50',overflow:'hidden',textOverflow:'ellipsis'}}>{sm(totalCLP)}</div>
            <div style={sub}>{delMes.length} factura{delMes.length!==1?'s':''}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VentasPorMes({sales,ufHoy,moneda='CLP'}) {
  const yr = currentYear
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const data = useMemo(()=>{
    const arr = Array.from({length:12},(_,i)=>({mes:MESES[i], uf:0, clp:0}))
    const ufConv = ufHoy || sales.find(s=>s.uf_value)?.uf_value || 40000
    sales.filter(s=>s.year===yr&&s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada').forEach(s=>{
      const esRec = s.cobro_type==='mensual' && s.status==='Activo'
      // Monto mensual de esta venta en UF y CLP
      const uf = s.moneda==='CLP'
        ? (ufConv ? (parseFloat(s.amount_clp)||0)/ufConv : 0)
        : (parseFloat(s.amount_uf)||0)
      const clp = s.moneda==='CLP'
        ? (parseFloat(s.amount_clp)||0)
        : (s.amount_clp||(s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):Math.round((parseFloat(s.amount_uf)||0)*ufConv)))
      if(esRec){
        // recurrente: suma su monto mensual en los 12 meses
        for(let m=0;m<12;m++){ arr[m].uf += uf; arr[m].clp += clp }
      } else {
        const m = (parseInt(s.month)||0)-1
        if(m<0||m>11) return
        arr[m].uf += uf; arr[m].clp += clp
      }
    })
    return arr
  },[sales,ufHoy])
  const val = m => moneda==='UF'? m.uf : m.clp
  const maxVal = Math.max(...data.map(val),1)
  const totalUF = data.reduce((a,m)=>a+m.uf,0)
  const totalCLP = data.reduce((a,m)=>a+m.clp,0)
  // Ingreso recurrente: ventas mensuales recurrentes activas
  const recurrentes = sales.filter(s=>s.cobro_type==='mensual'&&s.status==='Activo')
  const recUF = recurrentes.reduce((a,s)=>{ const uref=ufHoy||s.uf_value||40000; const uf = s.moneda==='CLP' ? (uref?(parseFloat(s.amount_clp)||0)/uref:0) : (parseFloat(s.amount_uf)||0); return a+uf },0)
  const recCLP = recurrentes.reduce((a,s)=>{ const uref=ufHoy||s.uf_value||40000; const clp = s.moneda==='CLP' ? (parseFloat(s.amount_clp)||0) : Math.round((parseFloat(s.amount_uf)||0)*uref); return a+clp },0)
  const [sel,setSel] = useState(null)
  // Formato compacto para la etiqueta sobre cada barra
  const compact = m => {
    const v = val(m)
    if(v===0) return ''
    if(moneda==='UF') return v>=1000? (v/1000).toFixed(v>=10000?0:1)+'k' : Math.round(v).toString()
    if(v>=1000000) return (v/1000000).toFixed(v>=10000000?0:1).replace('.',',')+'M'
    if(v>=1000) return Math.round(v/1000)+'k'
    return Math.round(v).toString()
  }
  if(totalUF===0&&totalCLP===0) return null

  return (
    <div style={{padding:'0 20px 16px'}}>
      <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Ventas por mes {yr}</div>
      <div style={{background:C.card,borderRadius:12,padding:'12px 14px',border:`1px solid ${C.border}`}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10,gap:8}}>
          <div style={{fontSize:11,color:C.muted}}>Total {yr}: <strong style={{color:C.text,fontSize:13}}>{moneda==='UF'?fmtUF(totalUF):fmt(totalCLP)}</strong></div>
          {sel!==null&&data[sel]&&val(data[sel])>0&&(
            <div style={{fontSize:11,color:C.accent,fontWeight:600,textAlign:'right'}}>{MESES[sel]}: {fmtUF(data[sel].uf)} · {fmt(data[sel].clp)}</div>
          )}
        </div>
        <div style={{display:'flex',gap:3,alignItems:'flex-end',height:84}}>
          {data.map((m,i)=>{
            const v = val(m)
            const hoy = new Date().getMonth()
            const activo = sel===i
            return (
              <div key={i} onClick={()=>setSel(s=>s===i?null:i)} onMouseEnter={()=>setSel(i)} onMouseLeave={()=>setSel(null)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2,cursor:v>0?'pointer':'default'}}>
                <div style={{fontSize:8,fontWeight:600,color:activo?C.accent:C.muted,height:11,lineHeight:'11px',whiteSpace:'nowrap'}}>{compact(m)}</div>
                <div style={{width:'100%',background:'#E8EEF0',borderRadius:3,height:46,display:'flex',flexDirection:'column',justifyContent:'flex-end',overflow:'hidden'}}>
                  {v>0&&<div style={{width:'100%',background:activo?C.accent:(i===hoy?C.accent:'#7FA0AD'),opacity:activo?1:.95,height:`${Math.round((v/maxVal)*100)}%`,minHeight:2,borderRadius:3,transition:'background .15s'}}/>}
                </div>
                <div style={{fontSize:8,color:i===hoy?C.accent:C.muted,fontWeight:i===hoy?700:400}}>{m.mes}</div>
              </div>
            )
          })}
        </div>
        {recurrentes.length>0&&(
          <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>Ingreso recurrente</div>
              <div style={{fontSize:10,color:C.muted,marginTop:1}}>{recurrentes.length} asesoría{recurrentes.length!==1?'s':''} permanente{recurrentes.length!==1?'s':''}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:16,fontWeight:600,color:C.normal}}>{moneda==='UF'?fmtUF(recUF):fmt(recCLP)}<span style={{fontSize:10,color:C.muted,fontWeight:500}}> /mes</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// === CALCULO DE VENTA: unica fuente de verdad (modulo) === v2
// Recurrentes mensuales ACTIVAS se proyectan x12. No-recurrentes tal cual.
// Lo usan Dashboard y SalesView para que los totales NUNCA difieran.
const esRecurrente = s => s.cobro_type==='mensual' && s.status==='Activo'
const ventaUF = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP'){ const clp=(parseFloat(s.amount_clp)||0); return ufRef ? (clp*factor)/ufRef : 0 }
  return (parseFloat(s.amount_uf)||0)*factor
}
const ventaCLP = (s, ufRef) => {
  const factor = esRecurrente(s) ? 12 : 1
  if(s.moneda==='CLP') return (parseFloat(s.amount_clp)||0)*factor
  const clp = s.amount_clp || (s.amount_uf&&s.uf_value?Math.round(s.amount_uf*s.uf_value):Math.round((parseFloat(s.amount_uf)||0)*ufRef))
  return (clp||0)*factor
}

// ─── UF EN VIVO (fuente única) ────────────────────────────────────────────────
// Valor UF del día desde mindicador.cl, con caché diario en localStorage.
// fetchUF() es el ÚNICO punto que llama a la API; nadie más debe hacerlo directo.
const UF_CACHE_KEY = 'uf_cache_v1'
const ufTodayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const readUFCache = () => { try{ const c=JSON.parse(localStorage.getItem(UF_CACHE_KEY)||'null'); if(c&&typeof c.value==='number'&&c.date) return c }catch(_){} return null }
const writeUFCache = (date,value) => { try{ localStorage.setItem(UF_CACHE_KEY, JSON.stringify({date,value})) }catch(_){} }
// Devuelve {value,date,isToday}. Usa caché si es de hoy; si no, llama a la API y cachea;
// si la API falla, cae al último valor cacheado (aunque sea viejo); si no hay, {value:null}.
async function fetchUF(){
  const today = ufTodayISO()
  const cache = readUFCache()
  if(cache && cache.date===today) return {value:cache.value, date:today, isToday:true}
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
function useUF(){
  const [state,setState] = useState(()=>{
    const c = readUFCache(); const today = ufTodayISO()
    if(c) return {uf:c.value, asOf:c.date, isToday:c.date===today, loading:c.date!==today}
    return {uf:null, asOf:null, isToday:false, loading:true}
  })
  useEffect(()=>{ let ok=true; fetchUF().then(r=>{ if(ok) setState({uf:r.value, asOf:r.date, isToday:r.isToday, loading:false}) }); return ()=>{ok=false} },[])
  return state
}
// Señal visible y auditable del valor UF usado. Discreta (gris) si es de hoy; naranja con alerta si no.
function UFStamp({uf,isToday,asOf,loading}){
  if(loading && uf==null) return null
  const fmtN = n => '$'+Math.round(n).toLocaleString('es-CL')
  const f = asOf ? new Date(asOf+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'}) : null
  const base = {display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontWeight:600,whiteSpace:'nowrap',borderRadius:6,padding:'2px 7px'}
  if(isToday && uf!=null) return <span style={{...base,color:C.muted,background:'#F2F2F2'}}>UF al {f} · {fmtN(uf)}</span>
  if(uf!=null) return <span style={{...base,color:C.soon,background:'#FEF6EE',border:'1px solid #F5E2CC'}}>UF al {f} · no actualizada</span>
  return <span style={{...base,color:C.soon,background:'#FEF6EE',border:'1px solid #F5E2CC'}}>UF no disponible</span>
}

function DashboardTasks({tasks,clients,onEdit,onComplete,onPreview}) {
  const [sortBy,setSortBy] = useState('encargo')
  const [openPersonas,setOpenPersonas] = useState({})
  const [openTerminadas,setOpenTerminadas] = useState(false)
  const activas = tasks.filter(t=>t.status==='Activo')
  const porPersona = {}
  activas.forEach(t=>{ const ws=taskAssignees(t); (ws.length?ws:['Sin asignar']).forEach(w=>{ (porPersona[w]=porPersona[w]||[]).push(t) }) })
  const nombreCliente = id => clients.find(c=>c.id===id)?.name || ''
  const cmp = (a,b) => {
    if(sortBy==='vencimiento'){
      const da=a.due||'9999-12-31', db=b.due||'9999-12-31'
      return da<db?-1:da>db?1:0
    }
    if(sortBy==='cliente'){
      const na=nombreCliente(a.client_id).toLowerCase(), nb=nombreCliente(b.client_id).toLowerCase()
      return na<nb?-1:na>nb?1:0
    }
    if(sortBy==='alfabetico'){
      const ta=(a.title||'').toLowerCase(), tb=(b.title||'').toLowerCase()
      return ta<tb?-1:ta>tb?1:0
    }
    const ca=a.created_at||'', cb=b.created_at||''
    return ca<cb?-1:ca>cb?1:0
  }
  Object.keys(porPersona).forEach(w=>porPersona[w].sort(cmp))
  const personas = Object.keys(porPersona).sort()
  const fmtInicio = iso => {
    if(!iso) return ''
    try {
      const d = new Date(iso)
      const dd = String(d.getDate()).padStart(2,'0')
      const mm = String(d.getMonth()+1).padStart(2,'0')
      return dd+'/'+mm+'/'+d.getFullYear()
    } catch(e) { return '' }
  }
  const fmtVence = iso => {
    if(!iso) return ''
    try {
      const d = new Date(iso)
      const dd = String(d.getDate()).padStart(2,'0')
      const mm = String(d.getMonth()+1).padStart(2,'0')
      return dd+'/'+mm
    } catch(e) { return '' }
  }
  const avatarColor = name => {
    const map = {
      'Crist\u00f3bal': ['#E6F1FB','#003C50'],
      'Erasmo':          ['#E1F5EE','#0F6E56'],
      'Mart\u00edn':    ['#EAF3DE','#3B6D11'],
      'Martina':         ['#EEEDFE','#534AB7'],
      'Rodrigo':         ['#FAEEDA','#C77F18']
    }
    return map[name] || ['#F1EFE8','#537281']
  }
  const togglePersona = name => setOpenPersonas(prev=>({...prev,[name]:!prev[name]}))
  const badgeStyle = due => {
    const d = daysLeft(due)
    if(d===null) return {bg:'#F1F1F1',col:'#888'}
    if(d<0)  return {bg:'#FCEBEB',col:'#E24B4A'}
    if(d<=1) return {bg:'#FAEEDA',col:'#C77F18'}
    if(d<=7) return {bg:'#FAEEDA',col:'#C77F18'}
    return {bg:'#F1F1F1',col:'#888'}
  }
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Tareas del estudio</div>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{padding:'5px 8px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:11,background:'#F7F7F7',color:C.text}}>
          <option value='encargo'>Orden: fecha de encargo</option>
          <option value='vencimiento'>Orden: fecha de vencimiento</option>
          <option value='cliente'>Orden: cliente</option>
          <option value='alfabetico'>Orden: alfab\u00e9tico</option>
        </select>
      </div>
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'hidden'}}>
      <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',padding:'12px 14px 4px'}}>Activas</div>
      {personas.map(persona=>{
        const [avBg,avColor]=avatarColor(persona)
        const isOpen=!!openPersonas[persona]
        return (
          <div key={persona}>
            <div onClick={()=>togglePersona(persona)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderTop:`1px solid #EEF0F2`,cursor:'pointer',userSelect:'none'}}>
              <div style={{width:24,height:24,borderRadius:'50%',background:avBg,color:avColor,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,flexShrink:0}}>{persona[0]}</div>
              <span style={{fontSize:13,fontWeight:500,color:C.muted}}>{persona}</span>
              <span style={{fontSize:12,color:C.muted,flex:1}}>{' · '}{porPersona[persona].length}</span>
              <span style={{width:7,height:7,border:`solid ${C.muted}`,borderWidth:'0 1.5px 1.5px 0',display:'inline-block',transform:isOpen?'rotate(-135deg)':'rotate(45deg)',transition:'transform .2s',marginBottom:isOpen?-2:2,flexShrink:0}}></span>
            </div>
            {isOpen&&porPersona[persona].map(t=>{
              const client=clients.find(c=>c.id===t.client_id)
              const bs=badgeStyle(t.due)
              return (
                <div key={t.id} onClick={()=>onPreview&&onPreview(t)} style={{borderLeft:`3px solid ${urgencyColor(t.due,t.status)}`,borderTop:`1px solid #F1F3F4`,cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'flex-start',padding:'9px 14px',gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,lineHeight:1.3}}>{t.title}</div>
                      {(client||t.project||t.subproject)&&(
                        <div style={{fontSize:10,color:C.muted,marginTop:3}}>
                          {client&&<span><span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Cliente</span>{' '}{client.name}</span>}
                          {t.project&&<span>{client?' \u00b7 ':''}<span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Proy.</span>{' '}{t.project}</span>}
                          {t.subproject&&<span>{(client||t.project)?' \u00b7 ':''}<span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Sub.</span>{' '}{t.subproject}</span>}
                        </div>
                      )}
                      {t.created_at&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Inicio: {fmtInicio(t.created_at)}</div>}
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
                      <span style={{fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:8,background:bs.bg,color:bs.col,whiteSpace:'nowrap'}}>{t.due?'Vence '+fmtVence(t.due):'Sin vencimiento'}</span>
                      <div style={{display:'flex',gap:4}}>
                        <button onClick={(e)=>{e.stopPropagation();onComplete&&onComplete(t)}} title='Terminada' style={{width:26,height:26,borderRadius:5,border:'1px solid #1D9E75',background:'#E1F5EE',color:'#0F6E56',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,padding:0}}>&#10003;</button>
                        <button onClick={(e)=>{e.stopPropagation();onEdit&&onEdit(t)}} title='Editar' style={{width:26,height:26,borderRadius:5,border:`0.5px solid ${C.border}`,background:'transparent',color:C.muted,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:13,padding:0}}>&#9998;</button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
      {(()=>{
        const termTasks = tasks.filter(t=>t.status==='Terminado')
        if(!termTasks.length) return null
        const porPersonaTerm = {}
        termTasks.forEach(t=>{ const ws=taskAssignees(t); (ws.length?ws:['Sin asignar']).forEach(w=>{ (porPersonaTerm[w]=porPersonaTerm[w]||[]).push(t) }) })
        const personasTerm = Object.keys(porPersonaTerm).sort()
        return (
          <div style={{borderTop:`1px solid ${C.border}`}}>
            <div onClick={()=>setOpenTerminadas(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px',cursor:'pointer',userSelect:'none'}}>
              <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',flex:1}}>Terminadas · {termTasks.length}</span>
              <span style={{width:7,height:7,border:`solid ${C.muted}`,borderWidth:'0 1.5px 1.5px 0',display:'inline-block',transform:openTerminadas?'rotate(-135deg)':'rotate(45deg)',transition:'transform .2s',marginBottom:openTerminadas?-2:2,flexShrink:0}}></span>
            </div>
            {openTerminadas&&personasTerm.map(persona=>{
              const isOpenT=!!openPersonas['__term__'+persona]
              return (
                <div key={persona}>
                  <div onClick={()=>setOpenPersonas(prev=>({...prev,['__term__'+persona]:!prev['__term__'+persona]}))} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderTop:`1px solid #EEF0F2`,cursor:'pointer',userSelect:'none'}}>
                    <div style={{width:24,height:24,borderRadius:'50%',background:'#E8E8E8',color:'#888',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:600,flexShrink:0}}>{persona[0]}</div>
                    <span style={{fontSize:13,fontWeight:500,color:C.muted,flex:1}}>{persona}</span>
                    <span style={{fontSize:12,color:C.muted}}>{' · '}{porPersonaTerm[persona].length}</span>
                    <span style={{width:7,height:7,border:`solid ${C.muted}`,borderWidth:'0 1.5px 1.5px 0',display:'inline-block',transform:isOpenT?'rotate(-135deg)':'rotate(45deg)',transition:'transform .2s',marginBottom:isOpenT?-2:2,flexShrink:0,marginLeft:8}}></span>
                  </div>
                  {isOpenT&&porPersonaTerm[persona].map(t=>{
                    const client=clients.find(cl=>cl.id===t.client_id)
                    return (
                      <div key={t.id} onClick={()=>onPreview&&onPreview(t)} style={{borderLeft:'3px solid #99ABB4',borderTop:`1px solid #F1F3F4`,opacity:.7,cursor:'pointer'}}>
                        <div style={{display:'flex',alignItems:'flex-start',padding:'9px 14px',gap:8}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:500,color:C.muted,lineHeight:1.3,textDecoration:'line-through'}}>{t.title}</div>
                            {(client||t.project)&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>
                              {client&&<span><span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase'}}>Cliente</span>{' '}{client.name}</span>}
                              {t.project&&<span>{client?' · ':''}<span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase'}}>Proy.</span>{' '}{t.project}</span>}
                            </div>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )
      })()}
      </div>
    </div>
  )
}


// Aging de cartera: clasifica las cuentas por cobrar (Pendiente/Vencido) por días de
// vencimiento sobre `due` (la app no tiene due_date/fecha; `due` ya es emisión + 30d).
function computeAgingCartera(billingRows, clientesMap){
  const COL = { current:'#1D9E75', warning:'#B8860B', overdue:'#E24B4A' }
  const BG  = { current:'#E1F5EE', warning:'#FFF8E1', overdue:'#FCEBEB' }
  const LBL = { current:'Al día', warning:'31-60 días', overdue:'Vencido +60' }
  const pend = (billingRows||[]).filter(b=>b.status==='Pendiente'||b.status==='Vencido')
  const diasVenc = b => { const dl=daysLeft(b.due); return dl===null?null:-dl }
  const bucketDe = b => { const dv=diasVenc(b); if(dv===null) return 'current'; if(dv>60) return 'overdue'; if(dv>30) return 'warning'; return 'current' }
  const total = pend.reduce((a,b)=>a+(b.amount||0),0)
  const pct = m => total>0?Math.round(m/total*100):0
  const sumB = k => pend.filter(b=>bucketDe(b)===k).reduce((a,b)=>a+(b.amount||0),0)
  const cur=sumB('current'), war=sumB('warning'), over=sumB('overdue')
  const buckets = { current:{monto:cur,pct:pct(cur)}, warning:{monto:war,pct:pct(war)}, overdue:{monto:over,pct:pct(over)} }

  // Delta: pendiente actual vs total facturado el mes anterior (por created_at)
  const now = new Date()
  const ym = (y,m)=>`${y}-${String(m).padStart(2,'0')}`
  const mesAnt = now.getMonth()===0 ? ym(now.getFullYear()-1,12) : ym(now.getFullYear(),now.getMonth())
  const totMesAnt = (billingRows||[]).filter(b=>(b.created_at||'').startsWith(mesAnt)).reduce((a,b)=>a+(b.amount||0),0)
  const delta = { monto: totMesAnt>0?(total-totMesAnt):0, pct: totMesAnt>0?Math.round((total-totMesAnt)/totMesAnt*100):0 }

  // DSO ponderado por monto
  const dsoRaw = total>0 ? pend.reduce((a,b)=>a+(b.amount||0)*(diasVenc(b)||0),0)/total : 0
  const dso = Math.max(0, Math.round(dsoRaw))

  // Top 5 por cliente, con el tramo más crítico del cliente
  const byClient = {}
  pend.forEach(b=>{
    const cid=b.client_id||'__none__'
    const nombre=(clientesMap&&clientesMap[cid])||b.receptor_name||'Sin cliente'
    if(!byClient[cid]) byClient[cid]={id:cid,nombre,facturas:0,monto:0,rank:0}
    byClient[cid].monto+=(b.amount||0); byClient[cid].facturas+=1
    const k=bucketDe(b), r=k==='overdue'?3:k==='warning'?2:1
    if(r>byClient[cid].rank) byClient[cid].rank=r
  })
  const keyDe = r => r===3?'overdue':r===2?'warning':'current'
  const top5 = Object.values(byClient).sort((a,b)=>b.monto-a.monto).slice(0,5).map(c=>{
    const k=keyDe(c.rank)
    const iniciales=(c.nombre||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
    return { id:c.id, nombre:c.nombre, facturas:c.facturas, monto:c.monto, bucketLabel:LBL[k], bucketColor:COL[k], bucketBg:BG[k], iniciales }
  })
  const mayor = top5[0] || {nombre:'—',monto:0}
  return { total, buckets, delta, dso, mayorExposicion:{nombre:mayor.nombre,monto:mayor.monto}, concentracionTop1Pct: total>0?(mayor.monto/total*100):0, top5 }
}

function Dashboard({sales,billing,clients,clientEntities=[],expenses,tasks,pettyCash,terceros=[],proveedores=[],setTab,user,onPagarTercero,onEditTask,onCompleteTask,onPreviewTask}) {
  const yr = currentYear
  const bb = billing
  const salesYr = sales.filter(s=>s.year===yr&&s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada')
  const ufState = useUF()
  const ufHoy = ufState.uf

  const ufRef = ufHoy || salesYr.find(s=>s.uf_value)?.uf_value || 40000
  // Calculo centralizado: delega a funciones de modulo (single source of truth)
  const esRec = s => esRecurrente(s)
  const ufDeVenta = s => ventaUF(s, ufRef)
  const clpDeVenta = s => ventaCLP(s, ufRef)
  const vendidoBrutoUF = salesYr.reduce((a,s)=>a+ufDeVenta(s),0)
  const costoUF = salesYr.reduce((a,s)=>a+((parseFloat(s.cost_uf)||0)*(esRec(s)?12:1))+(s.moneda==='CLP'&&s.cost_clp&&ufRef>0?((parseFloat(s.cost_clp)||0)/ufRef*(esRec(s)?12:1)):0),0)
  const vendidoNetoUF = vendidoBrutoUF - costoUF
  const vendidoBrutoCLP = Math.round(salesYr.reduce((a,s)=>a+clpDeVenta(s),0))
  const costoCLP = Math.round(costoUF * ufRef)
  const vendidoNetoCLP = vendidoBrutoCLP - costoCLP
  const pctMeta = Math.min(100, Math.round((vendidoNetoUF/META_UF)*100))

  const facturado = bb.filter(b=>b.issued_at?.startsWith(String(yr))&&b.billing_type!=='reembolso'&&!['Programada','Anulada'].includes(b.status)).reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = bb.filter(b=>b.status==='Pagado'&&b.billing_type!=='reembolso'&&(b.paid_at?.startsWith(String(yr))||b.issued_at?.startsWith(String(yr)))).reduce((a,b)=>a+(b.amount||0),0)
  const tasaCobro = facturado>0 ? Math.round((cobrado/facturado)*100) : 0

  const porCobrar = bb.filter(b=>['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrar.reduce((a,b)=>a+(b.amount||0),0)
  const age0_30  = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d>=-30 }).reduce((a,b)=>a+(b.amount||0),0)
  const age31_60 = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-30&&d>=-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const age60p   = porCobrar.filter(b=>{ const d=daysLeft(b.due); return d!==null&&d<-60 }).reduce((a,b)=>a+(b.amount||0),0)
  const top5 = [...porCobrar].sort((a,b)=>(daysLeft(a.due)||0)-(daysLeft(b.due)||0)).slice(0,5)

  const byArea = {}
  salesYr.forEach(s=>{ byArea[s.area]=(byArea[s.area]||0)+ufDeVenta(s) })
  const topAreas = Object.entries(byArea).sort((a,b)=>b[1]-a[1]).slice(0,3)

  const balances = {}
  expenses.forEach(e=>{ balances[e.client_id]=(balances[e.client_id]||0)+(e.type==='fondo'?e.amount:-e.amount) })
  const negatives = clients.filter(c=>!c.is_internal&&balances[c.id]<0)
  const [openCobranza,setOpenCobranza] = useState(false)
  const [openOficina,setOpenOficina] = useState(false)
  const [openPagar,setOpenPagar] = useState(false)
  const [payTercero,setPayTercero] = useState(null)   // cuenta por pagar en el modal Pagar
  const [payFecha,setPayFecha] = useState('')
  const [payRef,setPayRef] = useState('')
  const [payingNow,setPayingNow] = useState(false)
  const [dashMoneda,setDashMoneda] = useState('CLP')   // switch global UF/CLP de los KPIs del dashboard
  const [mesOficina,setMesOficina] = useState(`${currentYear}-${String(currentMonth).padStart(2,'0')}`)

  // --- META anual: metas por año (annual_targets) + selector + histórico ---
  const [targets,setTargets] = useState([])
  const [selYear,setSelYear] = useState(currentYear)
  const [yearMenu,setYearMenu] = useState(false)
  const [histOpen,setHistOpen] = useState(false)
  useEffect(()=>{
    supabase.from('annual_targets').select('*').order('year',{ascending:false}).then(({data})=>{
      const rows = (data&&data.length)?[...data]:[]
      if(!rows.some(t=>t.year===currentYear)) rows.unshift({year:currentYear,target_amount:META_CLP,currency:'CLP'})
      setTargets(rows)
    })
  },[])
  // Métricas de un año desde sales (vendido), misma fórmula que el cálculo central
  const metricasAnio = (year) => {
    const sy = sales.filter(s=>s.year===year&&!['Borrador','Propuesta','Rechazada'].includes(s.status))
    const bruto = Math.round(sy.reduce((a,s)=>a+clpDeVenta(s),0))
    const costo = Math.round(sy.reduce((a,s)=>a+(((parseFloat(s.cost_uf)||0)*(esRec(s)?12:1))*ufRef)+((s.moneda==='CLP'&&s.cost_clp)?((parseFloat(s.cost_clp)||0)*(esRec(s)?12:1)):0),0))
    const neto = bruto - costo
    const meta = Number(targets.find(t=>t.year===year)?.target_amount) || (year===currentYear?META_CLP:0)
    const pct = meta>0 ? Math.round((bruto/meta)*100) : 0
    return {year,bruto,costo,neto,meta,pct}
  }
  const m = metricasAnio(selYear)
  const fmtMon = v => dashMoneda==='UF' ? (ufRef>0?fmtUFk(Math.round(v/ufRef)):'—') : fmtShort(v)
  const aniosDisponibles = [...new Set([currentYear, ...targets.map(t=>t.year)])].sort((a,b)=>b-a)
  const prevM = metricasAnio(selYear-1)
  const tendenciaPP = (targets.some(t=>t.year===selYear-1) && prevM.bruto>0) ? (m.pct - prevM.pct) : null
  const ufFecha = ufState.asOf ? new Date(ufState.asOf+'T12:00').toLocaleDateString('es-CL',{day:'2-digit',month:'2-digit'}) : ''
  const ufTxt = ufState.uf ? `UF ${ufFecha} · $${Math.round(ufState.uf).toLocaleString('es-CL')}` : ''
  const Chev = ({open}) => <svg width='9' height='9' viewBox='0 0 10 10' style={{transform:open?'rotate(180deg)':'none',transition:'transform .15s',flexShrink:0}}><path d='M2 3.5 L5 6.5 L8 3.5' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'/></svg>
  const HistIcon = () => <svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><path d='M3 3v5h5'/><path d='M3.05 13A9 9 0 1 0 6 5.3L3 8'/><path d='M12 7v5l3 2'/></svg>

  // --- Aging de cartera ---
  const clientesMap = useMemo(()=>Object.fromEntries((clients||[]).map(c=>[c.id,c.name])),[clients])
  const [top5Open,setTop5Open] = useState(false)
  const agingData = useMemo(()=>computeAgingCartera(billing.filter(b=>b.billing_type!=='reembolso'), clientesMap),[billing,clientesMap])

  // --- Clientes sin fondos: detalle por cliente ---
  const [expSinFondos,setExpSinFondos] = useState(null)
  const totalNeg = negatives.reduce((a,c)=>a+(balances[c.id]||0),0)
  const maxDeficit = Math.max(1, ...negatives.map(c=>Math.abs(balances[c.id]||0)))
  const iniciales = (name) => (name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()
  const datosCliente = (c) => {
    const evs = expenses.filter(e=>e.client_id===c.id)
    const fondos = evs.filter(e=>e.type==='fondo').reduce((a,e)=>a+(e.amount||0),0)
    const gastos = evs.filter(e=>e.type==='gasto').reduce((a,e)=>a+(e.amount||0),0)
    const movs = [...evs].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,3)
    const rs = clientEntities.filter(e=>e.client_id===c.id)
    return {fondos,gastos,saldo:fondos-gastos,movs,rs}
  }

  return (
    <div>

      {/* Meta anual */}
      <div style={{padding:'0 20px 16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{display:'flex',alignItems:'center',position:'relative'}}>
            <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Revenue target</span>
            <button onClick={()=>setYearMenu(o=>!o)} style={{marginLeft:5,display:'inline-flex',alignItems:'center',gap:3,background:'none',border:'none',padding:0,cursor:'pointer',fontSize:10,fontWeight:600,color:C.accent,textTransform:'uppercase',letterSpacing:'0.06em'}}>{selYear}<span style={{fontSize:9,color:'#99ABB4'}}>{'▾'}</span></button>
            {yearMenu&&(
              <div style={{position:'absolute',left:0,top:'calc(100% + 4px)',background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:20,overflow:'hidden',minWidth:70}}>
                {aniosDisponibles.map(y=>(
                  <button key={y} onClick={()=>{setSelYear(y);setYearMenu(false)}} style={{display:'block',width:'100%',textAlign:'left',padding:'7px 14px',border:'none',background:y===selYear?'#E6EEF1':'#fff',color:y===selYear?C.accent:C.text,fontSize:12,fontWeight:y===selYear?600:500,cursor:'pointer'}}>{y}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:4}}>
            {['UF','CLP'].map(v=>{ const on=dashMoneda===v; return (
              <button key={v} onClick={()=>setDashMoneda(v)} style={{padding:'3px 10px',borderRadius:6,border:on?`1.5px solid ${C.accent}`:'0.5px solid #E4E8EB',background:'#fff',color:on?C.accent:'#537281',fontSize:11,fontWeight:on?600:500,cursor:'pointer'}}>{v}</button>
            )})}
          </div>
        </div>
        <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'hidden'}}>
          {/* Header: 3 columnas */}
          <div style={{display:'flex',alignItems:'stretch',padding:'14px 16px',gap:14}}>
            <div style={{display:'flex',flexDirection:'column',justifyContent:'center',paddingRight:14,borderRight:`1px solid ${C.border}`}}>
              <div style={{fontSize:32,fontWeight:600,color:C.accent,lineHeight:1}}>{m.pct}%</div>
              <div style={{fontSize:12,color:'#537281',marginTop:2}}>completado</div>
            </div>
            <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',gap:5,minWidth:0}}>
              {[['Meta',m.meta,'#1a1a1a'],['Vendido',m.bruto,C.accent],['Restante',Math.max(0,m.meta-m.bruto),'#537281']].map(([l,v,col])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
                  <span style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.3,fontWeight:600}}>{l}</span>
                  <span style={{fontSize:13,fontWeight:500,color:col}}>{fmtMon(v)}</span>
                </div>
              ))}
            </div>
            {tendenciaPP!==null&&(
              <div style={{display:'flex',alignItems:'center',flexShrink:0}}>
                <div style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:10,background:'#E1F5EE',color:'#0F6E56',whiteSpace:'nowrap'}}>{tendenciaPP>=0?'+':''}{tendenciaPP} pp vs {selYear-1}</div>
              </div>
            )}
          </div>
          {/* Barra de progreso */}
          <div style={{height:5,background:'#E4E8EB',overflow:'hidden'}}>
            <div style={{height:'100%',background:C.accent,width:`${Math.min(100,m.pct)}%`,borderRadius:3,transition:'width .5s ease'}}/>
          </div>
          {/* KPIs */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,padding:'12px 16px'}}>
            {[
              ['Bruto',m.bruto,'#1a1a1a','vendido'],
              ['Costo',m.costo,C.overdue,`${m.bruto>0?Math.round(m.costo/m.bruto*100):0}% del bruto`],
              ['Neto',m.neto,'#0F6E56',`margen ${m.bruto>0?Math.round(m.neto/m.bruto*100):0}%`],
            ].map(([l,v,col,sub])=>(
              <div key={l} style={{background:'#f5f7f9',borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.3,fontWeight:600,marginBottom:3}}>{l}</div>
                <div style={{fontSize:16,fontWeight:500,color:col}}>{fmtMon(v)}</div>
                <div style={{fontSize:10,color:'#537281',marginTop:1}}>{sub}</div>
              </div>
            ))}
          </div>
          {/* Trigger años anteriores */}
          <div style={{borderTop:`1px solid ${C.border}`}}>
            <button onClick={()=>setHistOpen(o=>!o)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',width:'100%',padding:'10px 16px',background:'none',border:'none',cursor:'pointer',gap:8}}>
              <span style={{display:'flex',alignItems:'center',gap:6,color:'#99ABB4',fontSize:10,textTransform:'uppercase',letterSpacing:.3,fontWeight:600}}><HistIcon/>Años anteriores</span>
              <span style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,color:'#537281'}}>
                {ufTxt&&<span style={{fontSize:11,fontWeight:600}}>{ufTxt}</span>}
                <Chev open={histOpen}/>
              </span>
            </button>
            {histOpen&&(
              <div style={{padding:'0 16px 14px'}}>
                <div style={{display:'grid',gridTemplateColumns:'42px 1fr auto',gap:10,fontSize:9,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.3,fontWeight:600,paddingBottom:4}}>
                  <span>Año</span><span>Avance</span><span style={{textAlign:'right'}}>Neto · % meta</span>
                </div>
                {aniosDisponibles.map(y=>{ const my=metricasAnio(y); const esActual=y===currentYear; const col=esActual?C.accent:'#537281'; const pctMetaNeto=my.meta>0?Math.round(my.neto/my.meta*100):0
                  return (
                  <div key={y} style={{display:'grid',gridTemplateColumns:'42px 1fr auto',gap:10,alignItems:'center',padding:'7px 0',borderTop:'1px solid #F0F2F4'}}>
                    <span style={{fontSize:12,fontWeight:500,color:col}}>{y}</span>
                    <div style={{height:5,background:'#E4E8EB',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',background:col,width:`${Math.min(100,my.pct)}%`,borderRadius:3}}/></div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:500,color:esActual?C.accent:'#1a1a1a'}}>{fmtMon(my.neto)}</div>
                      <div style={{fontSize:10,color:'#537281'}}>{esActual?`${pctMetaNeto}% · en curso`:`${pctMetaNeto}% meta`}</div>
                    </div>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      </div>

      <VentasPorMes sales={salesYr.length?sales:sales} ufHoy={ufHoy} moneda={dashMoneda}/>
      <CashflowProjection billing={billing} moneda={dashMoneda} ufRef={ufRef}/>

      {/* Facturación */}
      <div style={{padding:'16px 20px 16px'}}>
        <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Facturación {yr}</div>
        <div style={{background:C.card,borderRadius:12,padding:'14px 16px',border:`1px solid ${C.border}`}}>
        {(()=>{
          const terceros = bb.filter(b=>b.issued_at?.startsWith(String(yr))&&b.billing_type!=='reembolso').reduce((a,b)=>a+(Number(b.monto_terceros)||0),0)
          const netoFirma = facturado - terceros
          const tasaCol = tasaCobro>=80?C.normal:tasaCobro>=50?C.soon:C.overdue
          const m = clp => dashMoneda==='UF' ? (ufRef>0?fmtUFk(clp/ufRef):'—') : fmtShort(clp)
          const cell = acc => ({background:'#fff',border:`1px solid ${C.border}`,borderLeft:`3px solid ${acc}`,borderRadius:8,padding:'9px 9px',minWidth:0})
          const clbl = {fontSize:9,color:'#99ABB4',marginBottom:4,textTransform:'uppercase',letterSpacing:.3,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
          const cnum = {fontSize:17,fontWeight:600,whiteSpace:'nowrap'}
          return (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:terceros>0?6:0}}>
                <div style={cell(C.normal)} title={fmt(facturado)}><div style={clbl}>Facturado</div><div style={{...cnum,color:C.normal}}>{m(facturado)}</div></div>
                <div style={cell(C.normal)} title={fmt(cobrado)}><div style={clbl}>Cobrado</div><div style={{...cnum,color:C.normal}}>{m(cobrado)}</div></div>
                <div style={cell(tasaCol)}><div style={clbl}>Tasa cobro</div><div style={{...cnum,color:tasaCol}}>{tasaCobro}%</div></div>
              </div>
              {terceros>0&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                  <div style={cell(C.accent)} title={fmt(netoFirma)}><div style={clbl}>Neto firma</div><div style={{...cnum,color:C.accent}}>{m(netoFirma)}</div></div>
                  <div style={cell('#C77F18')} title={fmt(terceros)}><div style={clbl}>Terceros</div><div style={{...cnum,color:'#C77F18'}}>{m(terceros)}</div></div>
                </div>
              )}
            </>
          )
        })()}
        </div>
      </div>

      {/* Aging de cartera */}
      <div style={{padding:'0 20px'}}>
        <div style={{background:'#fff',border:'0.5px solid #E4E8EB',borderRadius:12,padding:'1rem 1.25rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:11,color:'#99ABB4',fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase'}}>Aging de cartera</div>
              <div style={{fontSize:26,fontWeight:500,color:'#003C50',lineHeight:1.1,marginTop:2}}>{fmt(agingData.total)}</div>
            </div>
            {agingData.delta.monto!==0&&(
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:11,color:'#99ABB4',fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase'}}>vs. mes anterior</div>
                <div style={{fontSize:13,fontWeight:500,color:'#537281',marginTop:2}}>{agingData.delta.monto>0?'+':''}{fmt(agingData.delta.monto)}</div>
              </div>
            )}
          </div>
          <div style={{height:6,borderRadius:3,display:'flex',overflow:'hidden',background:'#E4E8EB',marginBottom:12}}>
            <div style={{width:`${agingData.buckets.current.pct}%`,background:'#1D9E75'}}/>
            <div style={{width:`${agingData.buckets.warning.pct}%`,background:'#B8860B'}}/>
            <div style={{width:`${agingData.buckets.overdue.pct}%`,background:'#E24B4A'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',gap:8,marginBottom:12}}>
            {[['Al día',agingData.buckets.current,'#1D9E75'],['31-60 días',agingData.buckets.warning,'#B8860B'],['+60 días',agingData.buckets.overdue,'#E24B4A']].map(([l,bk,col])=>(
              <div key={l} style={{background:'#F5F7F9',borderRadius:0,borderLeft:`3px solid ${col}`,padding:'10px 12px'}}>
                <div style={{fontSize:11,color:'#99ABB4'}}>{l}</div>
                <div style={{fontSize:13,fontWeight:500,color:bk.monto===0?'#99ABB4':col}}>{fmt(bk.monto)}</div>
                <div style={{fontSize:11,color:'#99ABB4'}}>{bk.pct}%</div>
              </div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',gap:8,marginBottom:14}}>
            <div style={{background:'#F5F7F9',borderRadius:8,padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'#99ABB4'}}>DSO</div>
              <div style={{fontSize:16,fontWeight:500,color:'#003C50'}}>~{Math.round(Math.max(0,agingData.dso))} días</div>
            </div>
            <div style={{background:'#F5F7F9',borderRadius:8,padding:'10px 12px',minWidth:0}}>
              <div style={{fontSize:11,color:'#99ABB4'}}>Mayor exposición</div>
              <div style={{fontSize:13,fontWeight:500,color:'#003C50',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{agingData.mayorExposicion.nombre}</div>
              <div style={{fontSize:11,color:'#537281'}}>{fmt(agingData.mayorExposicion.monto)}</div>
            </div>
            <div style={{background:'#F5F7F9',borderRadius:8,padding:'10px 12px'}}>
              <div style={{fontSize:11,color:'#99ABB4'}}>Concentración top 1</div>
              <div style={{fontSize:16,fontWeight:500,color:'#003C50'}}>{agingData.concentracionTop1Pct.toFixed(1)}%</div>
            </div>
          </div>
          <div style={{borderTop:'0.5px solid #E4E8EB',paddingTop:10}}>
            <button onClick={()=>setTop5Open(o=>!o)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',background:'none',border:'none',padding:'4px 0',cursor:'pointer'}}>
              <span style={{fontSize:11,color:'#99ABB4',fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase'}}>Top 5 clientes</span>
              <span style={{fontSize:14,color:'#99ABB4',transform:top5Open?'rotate(180deg)':'none',transition:'transform .2s'}}>{'▾'}</span>
            </button>
            {top5Open&&agingData.top5.map((c,i)=>(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:i<agingData.top5.length-1?'0.5px solid #E4E8EB':'none'}}>
                <div style={{width:30,height:30,borderRadius:'50%',background:'#E4E8EB',color:'#537281',fontSize:10,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{c.iniciales}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:500,color:'#003C50',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.nombre}</div>
                  <div style={{fontSize:11,color:'#99ABB4'}}>{c.facturas} factura{c.facturas!==1?'s':''}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  <span style={{fontSize:13,fontWeight:500,color:'#003C50'}}>{fmt(c.monto)}</span>
                  <span style={{fontSize:10,padding:'2px 7px',borderRadius:3,background:c.bucketBg,color:c.bucketColor,whiteSpace:'nowrap'}}>{c.bucketLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {negatives.length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Clientes sin fondos</div>
          <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'hidden'}}>
            {/* Header */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'12px 14px',borderBottom:`1px solid ${C.border}`}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:20,fontWeight:600,color:C.overdue,lineHeight:1.1}}>{fmt(totalNeg)}</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{negatives.length} cliente{negatives.length!==1?'s':''} con saldo negativo</div>
              </div>
              <span style={{fontSize:10,fontWeight:600,padding:'3px 9px',borderRadius:10,background:'#FBE9E7',color:C.overdue,whiteSpace:'nowrap',flexShrink:0}}>Requieren fondos</span>
            </div>
            {/* Filas */}
            {negatives.map(c=>{
              const d = datosCliente(c)
              const abierto = expSinFondos===c.id
              const prop = Math.min(100, Math.abs(d.saldo)/maxDeficit*100)
              return (
              <div key={c.id} style={{borderBottom:`1px solid ${C.border}`}}>
                <button onClick={()=>setExpSinFondos(abierto?null:c.id)} style={{display:'flex',alignItems:'center',gap:10,width:'100%',padding:'10px 14px',background:abierto?'#FAFBFC':'none',border:'none',cursor:'pointer',textAlign:'left'}}>
                  <div style={{width:30,height:30,borderRadius:'50%',background:'#FBE9E7',color:C.overdue,fontSize:11,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{iniciales(c.name)}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                    <div style={{height:4,background:'#E4E8EB',borderRadius:2,overflow:'hidden',marginTop:4}}><div style={{height:'100%',background:C.overdue,width:`${prop}%`,borderRadius:2}}/></div>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:C.overdue,flexShrink:0,whiteSpace:'nowrap'}}>{fmt(d.saldo)}</div>
                  <Chev open={abierto}/>
                </button>
                {abierto&&(
                  <div style={{padding:'2px 14px 14px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,marginBottom:12}}>
                      {[['Fondos',fmt(d.fondos),C.normal],['Gastos',fmt(d.gastos),C.text],['Saldo',fmt(d.saldo),C.overdue],['RS',String(d.rs.length||'—'),C.muted]].map(([l,v,col])=>(
                        <div key={l} style={{background:'#f5f7f9',borderRadius:8,padding:'7px 8px'}}>
                          <div style={{fontSize:9,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.3,fontWeight:600,marginBottom:2}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:600,color:col}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:9,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.3,fontWeight:600,marginBottom:5}}>Últimos movimientos</div>
                    {d.movs.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Sin movimientos</div>}
                    {d.movs.map(mv=>(
                      <div key={mv.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'5px 0',borderBottom:`1px solid #F0F2F4`,fontSize:12}}>
                        <span style={{color:C.muted,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{mv.date?fmtFechaDMY(mv.date):'—'}</span>
                        <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{mv.concept||(mv.type==='fondo'?'Fondo':'Gasto')}</span>
                        <span style={{fontWeight:600,color:mv.type==='fondo'?C.normal:C.overdue,flexShrink:0,whiteSpace:'nowrap'}}>{mv.type==='fondo'?'+':'−'}{fmt(mv.amount).replace('-','')}</span>
                      </div>
                    ))}
                    <button onClick={()=>setTab('expenses')} style={{marginTop:12,width:'100%',padding:'9px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Rendir</button>
                  </div>
                )}
              </div>
            )})}
          </div>
        </div>
      )}

      <PorFacturarMes billing={billing} moneda={dashMoneda}/>

      {tasks?.filter(t=>t.status==='Activo'||t.status==='Terminado').length>0&&(
        <div style={{padding:'16px 20px 0'}}>
          <DashboardTasks tasks={tasks} clients={clients} onEdit={onEditTask} onComplete={onCompleteTask} onPreview={onPreviewTask}/>
        </div>
      )}

      {/* Gestión Caja Chica — control del equipo (el Dashboard ya es admin-only) */}
      {(()=>{
        const LIMITED_NAMES=new Set(['Martín','Martina','Rodrigo'])
        const cajaUsers = [...new Set((pettyCash||[]).map(p=>p.user_name).filter(Boolean))].filter(u=>LIMITED_NAMES.has(u)).sort((a,b)=>a.localeCompare(b,'es'))
        if(cajaUsers.length===0) return null
        const money = fmtN
        const filas = cajaUsers.map(u=>{
          const saldo = saldoCajaChica(pettyCash, expenses, u)
          const misGastos = (expenses||[]).filter(e=>e.type==='gasto'&&e.created_by===u)
          const sinLiq = misGastos.filter(e=>!e.rendered_at)
          const sinLiqMonto = sinLiq.reduce((a,e)=>a+(e.amount||0),0)
          const sinLiqNoNotaria = sinLiq.filter(e=>e.category!=='Notaria').length
          const fechas = misGastos.map(e=>e.date).filter(Boolean).sort()
          const ult = fechas.length?fechas[fechas.length-1]:null
          const dl = ult?daysLeft(ult):null
          return {u,saldo,sinLiqMonto,sinLiqN:sinLiq.length,alertaSinLiq:sinLiqNoNotaria>10,ult,alertaUlt:dl!==null&&dl<-7}
        })
        const cols = '1fr 0.85fr 1.1fr 0.78fr'
        const th = {fontSize:9,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.4}
        return (
          <div style={{padding:'16px 20px 0'}}>
            <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Gestión Caja Chica</div>
            <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'hidden'}}>
              <div style={{display:'grid',gridTemplateColumns:cols,gap:6,padding:'8px 12px',borderBottom:`1px solid ${C.border}`,background:'#F5F7F9'}}>
                <div style={th}>Usuario</div>
                <div style={{...th,textAlign:'right'}}>Saldo caja</div>
                <div style={{...th,textAlign:'right'}}>Sin liquidar</div>
                <div style={{...th,textAlign:'right'}}>Últ. gasto</div>
              </div>
              {filas.map((f,i)=>(
                <div key={f.u} style={{display:'grid',gridTemplateColumns:cols,gap:6,padding:'9px 12px',borderBottom:i<filas.length-1?`1px solid ${C.border}`:'none',alignItems:'center'}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.u}</div>
                  <div style={{fontSize:12,fontWeight:600,color:f.saldo<0?C.overdue:C.normal,textAlign:'right',whiteSpace:'nowrap'}}>{f.saldo<0?'-':''}{money(f.saldo)}</div>
                  <div style={{fontSize:11,fontWeight:600,color:f.alertaSinLiq?C.soon:C.text,textAlign:'right',whiteSpace:'nowrap'}}>{f.alertaSinLiq&&<span title='Más de 10 gastos sin liquidar (excl. Notaría)'>(!) </span>}{money(f.sinLiqMonto)} / {f.sinLiqN}</div>
                  <div style={{fontSize:11,fontWeight:600,color:f.alertaUlt?C.soon:C.muted,textAlign:'right',whiteSpace:'nowrap'}}>{f.alertaUlt&&<span title='Más de 7 días sin ingresar un gasto'>(!) </span>}{f.ult?fmtDate(f.ult):'—'}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Costos de oficina del mes (cliente interno) */}
      {(()=>{
        const internalIds = new Set((clients||[]).filter(c=>c.is_internal).map(c=>c.id))
        if(internalIds.size===0) return null
        const gastosOf = (expenses||[]).filter(e=>e.type==='gasto'&&internalIds.has(e.client_id))
        const delMes = gastosOf.filter(e=>e.date?.slice(0,7)===mesOficina).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1)
        const totalMes = delMes.reduce((a,e)=>a+(e.amount||0),0)
        const mesLbl = (()=>{ try{ return new Date(mesOficina+'-01T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase()) }catch(_){ return mesOficina } })()
        return (
          <div style={{padding:'16px 20px 0'}}>
            <button onClick={()=>setOpenOficina(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',padding:0,width:'100%',marginBottom:openOficina?8:0}}>
              <span style={{fontSize:10,color:C.muted,transform:openOficina?'rotate(90deg)':'none',transition:'transform .15s'}}>▸</span>
              <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Costos de oficina del mes</span>
              <span style={{fontSize:12,fontWeight:600,color:C.text,marginLeft:'auto'}}>{fmt(totalMes)}</span>
            </button>
            {openOficina&&(
              <div style={{marginTop:8,background:C.card,borderRadius:12,padding:'12px 14px',border:`1px solid ${C.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
                  <input type='month' value={mesOficina} onChange={e=>setMesOficina(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}/>
                  <span style={{fontSize:12,color:C.muted}}>{delMes.length} gasto{delMes.length!==1?'s':''}</span>
                </div>
                {delMes.length===0&&<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'16px 0'}}>Sin costos de oficina en {mesLbl}</div>}
                {delMes.map(e=>(
                  <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`,gap:8}}>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:13,color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                      <div style={{fontSize:10,color:C.muted,marginTop:1}}>{e.category||'—'}{e.subcategory?`: ${e.subcategory}`:''} · {fmtDate(e.date)}</div>
                    </div>
                    <div style={{fontSize:13,fontWeight:600,color:C.overdue,flexShrink:0}}>{fmt(e.amount)}</div>
                  </div>
                ))}
                {delMes.length>0&&(
                  <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 0',fontSize:13,fontWeight:600,color:C.text}}>
                    <span>Total {mesLbl}</span><span>{fmt(totalMes)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Cuentas por pagar a colaboradores (costos de terceros) */}
      {(()=>{
        if((terceros||[]).length===0) return null
        const provById = id => (proveedores||[]).find(p=>String(p.id)===String(id))
        const tituloProv = p => (p?.razon_social?.trim()||p?.nombre?.trim()||'Colaborador')
        const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
        const fmtDMY = iso => { if(!iso) return '—'; const p=String(iso).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(iso) }
        const porPagarTot = (terceros||[]).filter(t=>t.estado==='por_pagar').reduce((a,t)=>a+(t.monto||0),0)
        const pendienteTot = (terceros||[]).filter(t=>t.estado==='pendiente').reduce((a,t)=>a+(t.monto||0),0)
        const pagadoYr = (terceros||[]).filter(t=>t.estado==='pagado'&&String(t.pagado_at||'').startsWith(String(yr))).reduce((a,t)=>a+(t.monto||0),0)
        const nProvPorPagar = new Set((terceros||[]).filter(t=>t.estado==='por_pagar').map(t=>t.proveedor_id)).size
        // Agrupar lo NO pagado por colaborador; por_pagar primero
        const activos = (terceros||[]).filter(t=>t.estado!=='pagado')
        const byProv = {}
        activos.forEach(t=>{ const k=t.proveedor_id||'__'; if(!byProv[k]) byProv[k]={prov:provById(t.proveedor_id),cuentas:[]}; byProv[k].cuentas.push(t) })
        const grupos = Object.values(byProv).map(g=>({...g, total:g.cuentas.reduce((a,t)=>a+(t.monto||0),0), urgente:g.cuentas.some(t=>t.estado==='por_pagar')}))
          .sort((a,b)=> (b.urgente-a.urgente) || (b.total-a.total))
        const ordCuentas = cs => [...cs].sort((a,b)=> (a.estado==='por_pagar'?0:1)-(b.estado==='por_pagar'?0:1))
        const estPill = est => est==='por_pagar'?{l:'Por pagar',c:C.normal,bg:'#E1F5EE'}:{l:'Pendiente',c:'#B8860B',bg:'#FFF8E1'}
        return (
          <div style={{padding:'16px 20px 0'}}>
            <button onClick={()=>setOpenPagar(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',padding:0,width:'100%',marginBottom:openPagar?10:0}}>
              <span style={{fontSize:10,color:C.muted,transform:openPagar?'rotate(90deg)':'none',transition:'transform .15s'}}>▸</span>
              <span style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Cuentas por pagar a colaboradores</span>
              <span style={{fontSize:13,fontWeight:700,color:porPagarTot>0?C.normal:C.muted,marginLeft:'auto'}}>{fmt(porPagarTot)}</span>
            </button>
            {openPagar&&(
              <div>
                {porPagarTot>0&&(
                  <div style={{display:'flex',alignItems:'center',gap:9,background:'#E1F5EE',borderRadius:10,padding:'10px 12px',marginBottom:12}}>
                    <span style={{width:30,height:30,borderRadius:8,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M22 11.08V12a10 10 0 1 1-5.93-9.14'/><polyline points='22 4 12 14.01 9 11.01'/></svg>
                    </span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:600,color:'#0F6E56'}}>Listo para transferir: {fmt(porPagarTot)}</div>
                      <div style={{fontSize:11,color:C.normal,marginTop:1}}>{nProvPorPagar} colaborador{nProvPorPagar!==1?'es':''} · ya cobraste su factura</div>
                    </div>
                  </div>
                )}
                <div style={{display:'flex',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
                  <div style={{flex:1,padding:'11px 12px'}}><div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.06em'}}>Por pagar</div><div style={{fontSize:17,fontWeight:600,letterSpacing:-.4,marginTop:3,color:C.normal}}>{fmt(porPagarTot)}</div></div>
                  <div style={{flex:1,padding:'11px 12px',borderLeft:`1px solid ${C.border}`}}><div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.06em'}}>Pendiente</div><div style={{fontSize:17,fontWeight:600,letterSpacing:-.4,marginTop:3,color:'#B8860B'}}>{fmt(pendienteTot)}</div></div>
                  <div style={{flex:1,padding:'11px 12px',borderLeft:`1px solid ${C.border}`}}><div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.06em'}}>Pagado {yr}</div><div style={{fontSize:17,fontWeight:600,letterSpacing:-.4,marginTop:3,color:C.muted}}>{fmt(pagadoYr)}</div></div>
                </div>
                {grupos.length===0&&<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'16px 0'}}>No le debes nada a ningún colaborador.</div>}
                {grupos.map((g,gi)=>(
                  <div key={gi} style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 12px',background:C.neutro||'#F5F7F9'}}>
                      <span style={{width:34,height:34,borderRadius:9,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{cIni(tituloProv(g.prov))}</span>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tituloProv(g.prov)}</div>
                        <div style={{fontSize:11,color:'#99ABB4'}}>{g.prov?.razon_social?.trim()?(g.prov.nombre||''):(g.prov?.rut||'')}</div>
                      </div>
                      <div style={{marginLeft:'auto',textAlign:'right'}}>
                        <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.06em'}}>Le debes</div>
                        <div style={{fontSize:14,fontWeight:700,color:C.text}}>{fmt(g.total)}</div>
                      </div>
                    </div>
                    {ordCuentas(g.cuentas).map(t=>{
                      const fac=(billing||[]).find(b=>String(b.id)===String(t.billing_id))
                      const cli=clients.find(c=>String(c.id)===String(fac?.client_id))
                      const venta=(sales||[]).find(s=>String(s.id)===String(t.sale_id))
                      const ori=`${cli?.name||'—'}${venta?.title?` · ${venta.title}`:''}`
                      const pp=t.estado==='por_pagar', pi=estPill(t.estado)
                      const metaFac = fac ? (pp? `F° ${fac.invoice_no||'—'} · cobrada ${fmtDMY(fac.paid_at)}` : `F° ${fac.invoice_no||'—'}${fac.due?` · vence ${fmtDMY(fac.due)}`:''}`) : '—'
                      return (
                        <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderTop:`1px solid ${C.border}`}}>
                          <div style={{minWidth:0,flex:1}}>
                            <div style={{fontSize:12.5,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ori}</div>
                            <div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>{metaFac}</div>
                          </div>
                          <span style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(t.monto)}</span>
                          <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,background:pi.bg,color:pi.c,flexShrink:0,whiteSpace:'nowrap'}}>{pi.l}</span>
                          {pp
                            ? <button onClick={()=>{setPayTercero(t);setPayFecha(new Date().toISOString().slice(0,10));setPayRef('')}} style={{height:30,borderRadius:8,background:C.normal,color:'#fff',border:'none',fontSize:12,fontWeight:600,padding:'0 13px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Pagar</button>
                            : <span style={{fontSize:11,color:'#99ABB4',flexShrink:0,whiteSpace:'nowrap'}}>espera cobro</span>}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {payTercero&&(()=>{
        const prov=(proveedores||[]).find(p=>String(p.id)===String(payTercero.proveedor_id))
        const tituloProv = p => (p?.razon_social?.trim()||p?.nombre?.trim()||'Colaborador')
        const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
        const fac=(billing||[]).find(b=>String(b.id)===String(payTercero.billing_id))
        const cli=clients.find(c=>String(c.id)===String(fac?.client_id))
        const venta=(sales||[]).find(s=>String(s.id)===String(payTercero.sale_id))
        const ori=`${cli?.name||'—'}${venta?.title?` · ${venta.title}`:''}${fac?.invoice_no?` · F° ${fac.invoice_no}`:''}`
        const subtit = prov?.razon_social?.trim() ? `${prov.nombre?`${prov.nombre} · `:''}${prov.rut||''}`.replace(/ · $/,'') : (prov?.rut||'')
        const copiar=()=>{ if(prov?.datos_pago){ navigator.clipboard?.writeText(prov.datos_pago); } }
        const marcar=async()=>{ setPayingNow(true); const r=await onPagarTercero(payTercero.id,{pagado_at:payFecha,referencia:payRef}); setPayingNow(false); if(r) setPayTercero(null) }
        const fl={fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:5,display:'block'}
        const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',color:'#1a1a1a',outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>e.target===e.currentTarget&&setPayTercero(null)}>
            <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,maxHeight:'90vh',overflowY:'auto'}}>
              <div style={{display:'flex',alignItems:'center',gap:11,padding:'16px 18px',borderBottom:`0.5px solid ${C.border}`,position:'sticky',top:0,background:'#fff',zIndex:1}}>
                <span style={{width:42,height:42,borderRadius:11,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,flexShrink:0}}>{cIni(tituloProv(prov))}</span>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:15,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tituloProv(prov)}</div>
                  {subtit&&<div style={{fontSize:11.5,color:'#99ABB4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{subtit}</div>}
                </div>
                <button onClick={()=>setPayTercero(null)} style={{marginLeft:'auto',width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
                  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
                </button>
              </div>
              <div style={{padding:'16px 18px'}}>
                <div style={{textAlign:'center',marginBottom:14}}>
                  <div style={{fontSize:30,fontWeight:600,letterSpacing:-.6,color:C.text}}>{fmt(payTercero.monto)}</div>
                  <div style={{fontSize:12,color:'#99ABB4',marginTop:3}}>Por: {ori}</div>
                </div>
                <div style={{marginBottom:13}}>
                  <span style={fl}>Datos de transferencia</span>
                  {prov?.datos_pago?.trim()?(
                    <div style={{background:'#F5F7F9',border:`0.5px solid ${C.border}`,borderRadius:10,padding:'11px 12px',position:'relative'}}>
                      <button onClick={copiar} style={{position:'absolute',top:9,right:9,fontSize:11,fontWeight:600,color:C.accent,background:'#E6EEF1',border:'none',borderRadius:7,padding:'4px 9px',cursor:'pointer'}}>Copiar</button>
                      <pre style={{fontFamily:'ui-monospace,Menlo,monospace',fontSize:12,color:'#3D3D3D',whiteSpace:'pre-wrap',lineHeight:1.55,margin:0,paddingRight:54}}>{prov.datos_pago}</pre>
                    </div>
                  ):(
                    <div style={{fontSize:12,color:'#99ABB4',background:'#F5F7F9',borderRadius:10,padding:'11px 12px'}}>Este colaborador no tiene datos de pago. Agrégalos en Proveedores.</div>
                  )}
                </div>
                <div style={{marginBottom:13}}>
                  <span style={fl}>Factura del colaborador</span>
                  {user&&<Attachments table='terceros_attachments' idField='terceros_pago_id' entityId={payTercero.id} folderKind='facturas' namePrefix={`${tituloProv(prov)} · ${fac?.invoice_no?`F° ${fac.invoice_no}`:'pago'}`} user={user}/>}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
                  <div><span style={fl}>Fecha de pago</span><input type='date' value={payFecha} onChange={e=>setPayFecha(e.target.value)} style={inp}/></div>
                  <div><span style={fl}>Referencia</span><input value={payRef} onChange={e=>setPayRef(e.target.value)} placeholder='N° transferencia' style={inp}/></div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setPayTercero(null)} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                  <button disabled={payingNow} onClick={marcar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13,fontWeight:600,cursor:payingNow?'default':'pointer',opacity:payingNow?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{payingNow?<Spin/>:null}{payingNow?'Guardando...':'Marcar pagado'}</button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      <div style={{height:20}}/>
    </div>
  )
}


// ─── SALES VIEW ───────────────────────────────────────────────────────────────
function SalesView({sales,clients,onEdit,onAdd,onAddPropuesta,onRechazar,onActivar}) {
  const [fYear,setFYear] = useState(String(currentYear))
  const [fArea,setFArea] = useState('')
  const [fStatus,setFStatus] = useState('Activo')
  const ufState = useUF()
  const ufHoy = ufState.uf
  const ufRef = ufHoy || sales.find(s=>s.uf_value)?.uf_value || 40000
  const filtered = useMemo(()=>{
    let r = sales
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    if(fStatus) r = r.filter(s=>s.status===fStatus)
    return r.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))
  },[sales,fYear,fArea,fStatus])
  const totalUF = filtered.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const totalCLP = Math.round(filtered.reduce((a,s)=>a+ventaCLP(s,ufRef),0))
  const years = [...new Set(sales.map(s=>s.year).filter(Boolean))].sort((a,b)=>b-a)
  if(!years.includes(currentYear)) years.unshift(currentYear)

  // Pipeline KPIs (solo cuando fStatus === 'Propuesta')
  const propuestasFiltradas = useMemo(()=>{
    let r = sales.filter(s=>s.status==='Propuesta')
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r
  },[sales,fYear,fArea])
  const rechazadasFiltradas = useMemo(()=>{
    let r = sales.filter(s=>s.status==='Rechazada')
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r
  },[sales,fYear,fArea])
  const activadasFiltradas = useMemo(()=>{
    let r = sales.filter(s=>s.activated_at)
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r
  },[sales,fYear,fArea])
  const pipelineUF = propuestasFiltradas.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const totalCerradas = activadasFiltradas.length + rechazadasFiltradas.length
  const conversionPct = totalCerradas>0 ? (activadasFiltradas.length/totalCerradas*100) : 0
  const conDesc = activadasFiltradas.filter(s=>s.proposal_amount_uf&&s.amount_uf&&parseFloat(s.proposal_amount_uf)>parseFloat(s.amount_uf))
  const descuentoProm = (()=>{ const v=conDesc.filter(s=>(parseFloat(s.proposal_amount_uf)||0)>0); return v.length? v.reduce((a,s)=>{const p=parseFloat(s.proposal_amount_uf)||0; return a+(p-(parseFloat(s.amount_uf)||0))/p},0)/v.length*100 : 0 })()
  const valorRechazadoUF = rechazadasFiltradas.reduce((a,s)=>a+(parseFloat(s.proposal_amount_uf||s.amount_uf)||0),0)

  const statusPillBg = st => st==='Activo'?C.accent:st==='Propuesta'?'#537281':st==='Borrador'?'#E8CC6A':st==='Rechazada'?C.overdue:st==='Terminado'?C.done:'#C77F18'
  const statusPillColor = st => st==='Borrador'?'#4A3800':undefined

  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Ventas</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onAdd} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>Nueva venta</button>
            <button onClick={onAddPropuesta} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Nueva propuesta</button>
          </div>
        </div>
        <div style={{display:'flex',gap:6,marginBottom:8,marginTop:10,flexWrap:'wrap'}}>
          <select value={fStatus} onChange={e=>setFStatus(e.target.value)} style={{flex:1,minWidth:90,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos</option>
            {['Activo','Propuesta','Borrador','Rechazada','Terminado','Pausado'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select value={fYear} onChange={e=>setFYear(e.target.value)} style={{flex:1,minWidth:70,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fArea} onChange={e=>setFArea(e.target.value)} style={{flex:1,minWidth:100,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todas las areas</option>
            {['Corporativo','Tributario','Laboral','Otro'].map(a=><option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {fStatus==='Propuesta'?(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:4}}>
            <div style={{background:'#E3EEF3',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Pipeline</div>
              <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtUF(pipelineUF)}</div>
            </div>
            <div style={{background:'#F7F7F7',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Pendientes</div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{propuestasFiltradas.length}</div>
            </div>
            <div style={{background:'#F7F7F7',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Conversion</div>
              <div style={{fontSize:13,fontWeight:700,color:C.normal}}>{totalCerradas>0?conversionPct.toFixed(0)+'%':'—'}</div>
              {totalCerradas>0&&<div style={{fontSize:9,color:C.muted}}>{activadasFiltradas.length} act. / {totalCerradas} cerr.</div>}
            </div>
            <div style={{background:'#F7F7F7',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Desc. prom.</div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{conDesc.length>0?descuentoProm.toFixed(1)+'%':'—'}</div>
            </div>
            <div style={{background:'#FEF0F0',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Rechazadas</div>
              <div style={{fontSize:13,fontWeight:700,color:C.overdue}}>{rechazadasFiltradas.length}</div>
            </div>
            <div style={{background:'#FEF0F0',borderRadius:9,padding:'8px 10px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2,textTransform:'uppercase',letterSpacing:.4}}>Val. rechazado</div>
              <div style={{fontSize:13,fontWeight:700,color:C.overdue}}>{fmtUF(valorRechazadoUF)}</div>
            </div>
          </div>
        ):(
          filtered.length>0&&(
            <>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:4}}>
              <div style={{background:'#E3EEF3',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>TOTAL UF</div>
                <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtUF(totalUF)}</div>
              </div>
              <div style={{background:'#EEF3E3',borderRadius:9,padding:'8px 12px',border:`1px solid ${C.border}`}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:2}}>TOTAL CLP</div>
                <div style={{fontSize:13,fontWeight:700,color:C.normal}}>{fmt(totalCLP)}</div>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:4}}><UFStamp {...ufState}/></div>
            </>
          )
        )}
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin ventas en esta categoria</div>}
        {filtered.map(s=>{
          const ufA=ventaUF(s,ufRef), clpA=ventaCLP(s,ufRef), rec=esRecurrente(s)
          const client=clients.find(c=>c.id===s.client_id)
          const isPropuesta = s.status==='Propuesta'
          const diasPendiente = s.created_at ? Math.floor((Date.now()-new Date(s.created_at))/86400000) : 0
          const tardio = isPropuesta && diasPendiente>14
          return (
            <div key={s.id}
              onClick={()=>onEdit(s)}
              style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${tardio?'#C77F18':C.border}`,borderLeft:tardio?`4px solid #C77F18`:undefined,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=tardio?'#C77F18':C.accent}
              onMouseLeave={e=>e.currentTarget.style.borderColor=tardio?'#C77F18':C.border}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:5}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div>
                  <div style={{fontSize:11,color:C.muted}}>{client?.name||'—'}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  {ufA>0&&<div style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtUF(ufA)}{rec?<span style={{fontSize:9,fontWeight:500,color:C.muted}}> /año</span>:null}</div>}
                  {clpA>0&&<div style={{fontSize:11,color:C.muted}}>{fmt(clpA)}</div>}
                  {isPropuesta&&(
                    <div style={{display:'flex',gap:4,justifyContent:'flex-end',marginTop:4}} onClick={e=>e.stopPropagation()}>
                      <span onClick={()=>onRechazar(s)} style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#FDEAEA',color:C.overdue,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Rechazar</span>
                      <span onClick={()=>onActivar(s)} style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#DCF5EC',color:'#0F6E56',fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Activar</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <AreaChip area={s.area}/>
                <span style={{fontSize:10,color:C.muted}}>{s.year}{s.month?' · '+String(s.month).padStart(2,'0'):''}</span>
                {isPropuesta&&<span style={{fontSize:10,color:tardio?'#C77F18':C.muted}}>{diasPendiente}d pendiente</span>}
                <span style={{marginLeft:'auto'}}><Pill label={s.status} bg={statusPillBg(s.status)} color={statusPillColor(s.status)} small/></span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MiniClientForm({onSave,onCancel,defaultStatus='Activo'}) {
  const [f,setF] = useState({name:'',rut:'',type:'Corporativo'})
  const [saving,setSaving] = useState(false)
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const save = async() => {
    if(!f.name.trim()) return
    setSaving(true)
    try {
      const {data,error} = await supabase.from('clients').insert({...f,status:defaultStatus}).select().single()
      if(error) throw error
      onSave(data)
    } catch(e) { alert('Error: '+e.message) }
    setSaving(false)
  }
  return (
    <div style={{background:'#F0F5F7',borderRadius:10,padding:'12px 14px',marginBottom:12,border:`1px solid ${C.accent}`}}>
      <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:10}}>Nuevo cliente</div>
      <Fld label='Nombre'><Inp value={f.name} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...' autoFocus/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Fld label='RUT'><Inp value={f.rut} onChange={e=>up('rut',e.target.value)} placeholder='76.xxx.xxx-x'/></Fld>
        <Fld label='Tipo'><Sel value={f.type} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
      </div>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onCancel} style={{flex:1,padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.name.trim()} onClick={save} style={{flex:2,padding:8,borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>{saving?'Guardando...':'Crear cliente'}</button>
      </div>
    </div>
  )
}

// Reparto del costo de terceros entre colaboradores (cuentas por pagar).
// Cada fila = un colaborador + monto (CLP) + cuota ancla (la factura cuyo pago libera el fee).
// Reparto del costo a colaboradores. Cada fila: proveedor + tipo (% / UF / $) + valor.
// El costo se reparte en las MISMAS cuotas que el cobro (se distribuye al guardar).
// Por defecto el tipo = la unidad de la venta. La reconciliación y los montos se muestran en esa unidad.
function RepartoTerceros({proveedores=[],rows=[],setRows,moneda='UF',ufVal=0,saleTotal=0,costTotal=0}) {
  const titulo = p => (p?.razon_social?.trim()||p?.nombre?.trim()||'Proveedor')
  const provs = [...proveedores].sort((a,b)=>titulo(a).localeCompare(titulo(b),'es'))
  const esUF = moneda!=='CLP'
  const defTipo = esUF ? 'uf' : 'clp'
  const inp={width:'100%',height:36,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 9px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none',fontSize:12}
  const fmtU = v => esUF ? fmtUF(v) : fmt(Math.round(v))
  // Aporte de una fila en la UNIDAD de la venta (UF si la venta es UF; CLP si es CLP).
  const enUnidad = r => {
    const v = parseFloat(r.valor)||0
    if(r.tipo==='pct') return saleTotal*v/100
    if(esUF) return r.tipo==='uf' ? v : (ufVal>0 ? v/ufVal : 0)   // clp sobre venta UF (raro)
    return r.tipo==='uf' ? v*ufVal : v                            // venta CLP
  }
  const suma = rows.reduce((a,r)=>a+enUnidad(r),0)
  const tol = esUF ? 0.01 : 1
  const desc = costTotal>0 ? costTotal-suma : 0
  const cuadra = Math.abs(desc)<=tol
  const hayClpEnUF = esUF && rows.some(r=>r.tipo==='clp' && (parseFloat(r.valor)||0)>0)
  const up=(i,k,v)=>setRows(rows.map((r,j)=>j===i?{...r,[k]:v}:r))
  const addRow=()=>setRows([...rows,{proveedor_id:'',tipo:defTipo,valor:''}])
  const delRow=i=>setRows(rows.filter((_,j)=>j!==i))
  const tipos=[['pct','%'],['uf','UF'],['clp','$']]
  return (
    <div style={{background:'#F7F9FA',border:`1px solid ${C.border}`,borderRadius:10,padding:'11px 12px',marginBottom:14}}>
      <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.6,marginBottom:8}}>¿A quién le pagas?</div>
      {provs.length===0?(
        <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>Aún no tienes colaboradores. Créalos en <strong style={{color:C.accent}}>Facturación → Proveedores</strong> y vuelve a abrir la venta.</div>
      ):(<>
        {rows.length===0&&<div style={{fontSize:12,color:C.muted,marginBottom:8}}>Agrega a quién le pagas parte de este honorario. Se reparte en las mismas cuotas que te pagan a ti.</div>}
        {rows.map((r,i)=>{
          const tipo=r.tipo||defTipo
          return (
          <div key={i} style={{display:'grid',gridTemplateColumns:'1.5fr 1fr 24px',gap:6,marginBottom:7,alignItems:'center'}}>
            <select value={r.proveedor_id||''} onChange={e=>up(i,'proveedor_id',e.target.value)} style={sel}>
              <option value=''>— Colaborador —</option>
              {provs.map(p=><option key={p.id} value={p.id}>{titulo(p)}</option>)}
            </select>
            <div style={{display:'flex',height:36,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',background:'#fff'}}>
              <input type='number' value={r.valor??''} onChange={e=>up(i,'valor',e.target.value)} placeholder={tipo==='pct'?'%':tipo==='uf'?'UF':'$'} style={{flex:1,minWidth:0,border:'none',padding:'0 8px',fontSize:13,color:C.text,outline:'none'}}/>
              <div style={{display:'flex',flexShrink:0}}>
                {tipos.map(([v,l])=>(
                  <button key={v} type='button' onClick={()=>up(i,'tipo',v)} style={{padding:'0 7px',border:'none',borderLeft:`1px solid ${C.border}`,background:tipo===v?C.accent:'#EFF3F5',color:tipo===v?'#fff':C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{l}</button>
                ))}
              </div>
            </div>
            <button type='button' onClick={()=>delRow(i)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0}}>×</button>
          </div>
        )})}
        <button type='button' onClick={addRow} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600,padding:0,marginTop:2}}>+ Agregar colaborador</button>
        {hayClpEnUF&&(
          <div style={{fontSize:11,color:C.muted,background:'#F5F7F9',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'7px 9px',marginTop:9,lineHeight:1.4}}>
            Hay un costo en <strong>pesos fijos</strong> y la venta es en UF: ese monto no se reajusta con la factura. Si quieres que suba junto con la UF, usa <strong>%</strong> o <strong>UF</strong>.
          </div>
        )}
        {rows.length>0&&costTotal>0&&!cuadra&&(
          <div style={{fontSize:11,color:'#B8860B',background:'#FFF8E1',border:'0.5px solid #F0D88A',borderRadius:8,padding:'7px 9px',marginTop:9,lineHeight:1.4}}>
            El reparto suma <strong>{fmtU(suma)}</strong>, pero el costo de terceros es <strong>{fmtU(costTotal)}</strong> ({desc>0?`faltan ${fmtU(desc)}`:`sobran ${fmtU(-desc)}`}).
          </div>
        )}
        {rows.length>0&&costTotal>0&&cuadra&&<div style={{fontSize:11,color:C.normal,marginTop:9}}>Reparto cuadra con el costo de terceros: {fmtU(suma)}.</div>}
      </>)}
    </div>
  )
}

function SaleForm({sale,clients:initialClients,clientEntities,billing,proveedores=[],terceros=[],onSaveTariff,onCambiarFormato,onSave,onClose,onDelete,saving,user,onExposeUpload,onExposeDrive}) {
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const WHO_LIST = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  // Si estamos activando una propuesta, guardar el honorario original antes de que el usuario lo edite
  const _activandoPropuesta = !!(sale?._activandoPropuesta)
  const _propAmountUF = sale?._propAmountUF ?? null
  const _propAmountCLP = sale?._propAmountCLP ?? null
  const [f,setF] = useState(sale ? {...sale, area: sale.area||'Corporativo', status: _activandoPropuesta?'Activo':sale.status} : {client_id:'',title:'',area:'Corporativo',amount_uf:'',cost_uf:'',uf_value:'',year:currentYear,month:currentMonth,status:'Activo',notes:'',responsible:'',cobro_type:'cuotas',entity_id:''})
  const [clients,setClients] = useState(initialClients)
  const [clientQ,setClientQ] = useState('')
  const [showNewClient,setShowNewClient] = useState(false)
  const [selectedClient,setSelectedClient] = useState(initialClients.find(c=>c.id===sale?.client_id)||null)
  const [cobroType,setCobroType] = useState(sale?.cobro_type||'cuotas')
  const [nCuotas,setNCuotas] = useState(sale?.cobro_config?.nCuotas||3)
  const [cobroInicio,setCobroInicio] = useState(sale?.cobro_config?.cobroInicio||'')
  const [tramos,setTramos] = useState(sale?.cobro_config?.tramos||[{id:1,pct:50,fecha:''},{id:2,pct:50,fecha:''}])
  const [cuotasCustom,setCuotasCustom] = useState(sale?.cobro_config?.cuotasCustom||[{id:1,monto:'',fecha:''}])
  const [mensualInicio,setMensualInicio] = useState(sale?.cobro_config?.mensualInicio||'')
  const [costMode,setCostMode] = useState('fijo')
  const [costPct,setCostPct] = useState('')
  const [costSwitch,setCostSwitch] = useState(!!(sale?.cost_uf||sale?.cost_clp))
  // Reparto del costo de terceros entre colaboradores. Para venta existente se ancla por billing_id;
  // para venta nueva por índice de cuota (cuotaIdx), que se resuelve a billing_id al guardar.
  // Reconstruye las filas del reparto agrupando los terceros_pagos por proveedor+tipo+valor
  // (cada fila se reparte en N cuotas, así que varios registros = una fila del formulario).
  const [reparto,setReparto] = useState(()=>{
    const mine=(terceros||[]).filter(t=>String(t.sale_id)===String(sale?.id))
    const g={}
    mine.forEach(t=>{ const k=`${t.proveedor_id}|${t.tipo_costo||''}|${t.valor??''}`; if(!g[k]) g[k]={proveedor_id:t.proveedor_id,tipo:t.tipo_costo||'clp',valor:t.valor??''} })
    return Object.values(g)
  })
  const [tariffs,setTariffs] = useState([])
  useEffect(()=>{ if(!sale?.id) return; supabase.from('sale_tariff_history').select('*').eq('sale_id',sale.id).order('vigente_desde',{ascending:true}).then(({data})=>setTariffs(data||[])) },[sale?.id])
  const fmtMesAno = d => d ? d.slice(5,7)+'/'+d.slice(0,4) : '—'
  const [modCobro,setModCobro] = useState(false)
  const [modMode,setModMode] = useState('ajustar')
  const [newHon,setNewHon] = useState('')
  const [newVig,setNewVig] = useState('')
  const [newCosto,setNewCosto] = useState('')
  const [newCostMode,setNewCostMode] = useState('fijo')
  const [newCostPct,setNewCostPct] = useState('')
  const [newFmt,setNewFmt] = useState('')
  const [newNCuotas,setNewNCuotas] = useState(3)
  const [newCobroInicio,setNewCobroInicio] = useState('')
  const [newCuotasCustom,setNewCuotasCustom] = useState([{id:1,monto:'',fecha:''}])
  const [savingTariff,setSavingTariff] = useState(false)
  const [propuestaStep,setPropuestaStep] = useState(null)
  const [propuestaData,setPropuestaData] = useState(null)
  const [propError,setPropError] = useState('')
  const [propClientMatch,setPropClientMatch] = useState(null)
  const [propClientCandidates,setPropClientCandidates] = useState([])
  const [propSearchQ,setPropSearchQ] = useState('')
  const [propEntitySel,setPropEntitySel] = useState('')
  const [propClientMode,setPropClientMode] = useState('asociar')
  const [propNewClient,setPropNewClient] = useState({name:'',rut:'',razon_social:''})
  const [propCreating,setPropCreating] = useState(false)
  const [propDriveFiles,setPropDriveFiles] = useState([])
  const [propDriveLoading,setPropDriveLoading] = useState(false)
  const [propDriveError,setPropDriveError] = useState('')
  const [aiFields,setAiFields] = useState(new Set())
  const [hasDraft,setHasDraft] = useState(false)
  const [draftTs,setDraftTs] = useState(null)
  const draftTimer = useRef(null)
  const DRAFT_KEY = 'leabogados_sale_draft'
  const {uf: ufHoy} = useUF()
  const [openCondicion,setOpenCondicion] = useState(null)
  useEffect(()=>{ if(onExposeUpload) onExposeUpload(()=>setPropuestaStep('upload')) },[])
  useEffect(()=>{
    if(!onExposeDrive) return
    onExposeDrive(async()=>{
      setPropuestaStep('drive')
      setPropDriveError('')
      setPropDriveLoading(true)
      try {
        const token = await driveToken()
        const PROPUESTAS_FOLDER = '1MQg9_q0l20mjB-LftuYQywTE4T81Kxf3'
        const cutoff = new Date(Date.now()-15*24*60*60*1000).toISOString()
        const q = encodeURIComponent(`'${PROPUESTAS_FOLDER}' in parents and modifiedTime>'${cutoff}' and trashed=false and (mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.google-apps.document')`)
        const data = await driveGet(token,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50`)
        setPropDriveFiles(data.files||[])
      } catch(e) {
        setPropDriveError(e.message||'Error al conectar con Drive')
      }
      setPropDriveLoading(false)
    })
  },[])
  useEffect(()=>{ if(ufHoy && !f.uf_value) up('uf_value', Math.round(ufHoy)) },[ufHoy])
  useEffect(()=>{
    if(sale?.id) return
    try { const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null'); if(d?.ts){setHasDraft(true);setDraftTs(d.ts)} } catch {}
  },[])
  useEffect(()=>{
    if(sale?.id) return
    clearTimeout(draftTimer.current)
    draftTimer.current=setTimeout(()=>{
      localStorage.setItem(DRAFT_KEY,JSON.stringify({f,selectedClient,cobroType,nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio,costMode,costPct,costSwitch,ts:Date.now()}))
    },2000)
    return ()=>clearTimeout(draftTimer.current)
  },[f,selectedClient,cobroType,nCuotas,cobroInicio,mensualInicio,costMode,costPct,costSwitch,tramos,cuotasCustom])
  const resetMod = () => { setModCobro(false); setModMode('ajustar'); setNewHon(''); setNewVig(''); setNewCosto(''); setNewFmt(''); setNewNCuotas(3); setNewCobroInicio(''); setNewCuotasCustom([{id:1,monto:'',fecha:''}]); setNewCostMode('fijo'); setNewCostPct('') }

  const AiBadge = ({field}) => aiFields.has(field) ? <span style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:3,background:'#E4E8EB',color:'#537281',marginLeft:5,verticalAlign:'middle',lineHeight:1}}>IA</span> : null
  const clearDraft = () => { localStorage.removeItem(DRAFT_KEY); setHasDraft(false) }
  const restoreDraft = () => {
    try {
      const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')
      if(d.f) setF(d.f)
      if(d.selectedClient){setSelectedClient(d.selectedClient);setClientQ('')}
      if(d.cobroType) setCobroType(d.cobroType)
      if(d.nCuotas) setNCuotas(d.nCuotas)
      if(d.cobroInicio) setCobroInicio(d.cobroInicio)
      if(d.tramos) setTramos(d.tramos)
      if(d.cuotasCustom) setCuotasCustom(d.cuotasCustom)
      if(d.mensualInicio) setMensualInicio(d.mensualInicio)
      if(d.costMode) setCostMode(d.costMode)
      if(d.costPct) setCostPct(d.costPct)
      if(typeof d.costSwitch==='boolean') setCostSwitch(d.costSwitch)
    } catch {}
    setHasDraft(false)
  }

  const extractFromFile = async (file) => {
    if(file.size > 10*1024*1024) { setPropError('El archivo supera 10 MB.'); return }
    setPropuestaStep('extracting')
    setPropError('')
    try {
      let text = ''
      if(file.name.toLowerCase().endsWith('.pdf')) {
        const arrayBuf = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({data: new Uint8Array(arrayBuf)}).promise
        for(let i=1; i<=pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          text += content.items.map(it=>it.str||'').join(' ') + '\n'
        }
      } else {
        const arrayBuf = await file.arrayBuffer()
        const result = await mammoth.extractRawText({arrayBuffer: arrayBuf})
        text = result.value
      }
      const resp = await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':import.meta.env.VITE_ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:4000,system:`Eres un experto extractor de datos de propuestas y contratos de servicios legales en Chile. Lee TODO el documento y devuelve SOLO un JSON (sin markdown ni backticks) con estos campos. Reglas:
- Si un dato no está explícito pero se infiere con certeza, infiérelo; si no, usa "" o null. No inventes.
- cliente_nombre: cliente/contraparte a quien se dirige la propuesta (persona o empresa).
- cliente_rut: RUT chileno formato 12.345.678-9 si aparece.
- razon_social: razón social facturable si difiere del nombre del cliente.
- contactos: nombres, cargos y/o emails de contactos mencionados (texto).
- area: área legal (Corporativo, Tributario, Laboral, Litigios, Inmobiliario, etc.).
- proyecto: título o descripción breve del encargo.
- moneda: "UF" o "CLP" según en qué se expresan los honorarios.
- honorario_total: monto total SOLO como número (sin símbolos ni separadores de miles; usa punto decimal si hay decimales).
- forma_cobro: cómo se cobra (único, mensual, por cuotas, por etapas, éxito, mixto, etc.).
- n_cuotas: número de cuotas si aplica (entero) o null.
- tipo_honorario_badges: lista de etiquetas como "fijo","variable","éxito","mensual","por hora".
- notas: condiciones relevantes (reajuste, vigencia, gastos, IVA, hitos, etc.).
Devuelve: { cliente_nombre, cliente_rut, razon_social, contactos, area, proyecto, moneda, honorario_total, forma_cobro, n_cuotas, tipo_honorario_badges, notas }`,messages:[{role:'user',content:text.slice(0,40000)}]})
      })
      if(!resp.ok) throw new Error('Error API '+resp.status)
      const apiData = await resp.json()
      const raw = (apiData.content?.[0]?.text || '{}').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      const parsed = JSON.parse(raw)
      setPropuestaData(parsed)
      const nombre = (parsed.cliente_nombre||'').toLowerCase().trim()
      const rut = (parsed.cliente_rut||'').replace(/[.\-]/g,'').trim()
      const tokenize = s => s.toLowerCase().replace(/[^\wáéíóúüñ\s]/g,'').split(/\s+/).filter(w=>w.length>2)
      const countCommon = (a,b) => { const sb=new Set(tokenize(b)); return tokenize(a).filter(w=>sb.has(w)).length }
      let exactMatch = null
      if(rut) exactMatch = clients.find(c=>(c.rut||'').replace(/[.\-]/g,'')=== rut)
      let tokenCandidates = []
      if(!exactMatch && nombre) {
        const scored = clients.map(c=>({c,score:countCommon(nombre,c.name)})).filter(x=>x.score>=2)
        scored.sort((a,b)=>b.score-a.score)
        tokenCandidates = scored.map(x=>x.c)
      }
      const match = exactMatch||(tokenCandidates.length===1?tokenCandidates[0]:null)
      setPropClientMatch(match||null)
      setPropClientCandidates(tokenCandidates.length>1?tokenCandidates:[])
      setPropSearchQ('')
      if(match){
        setPropClientMode('asociar')
        const ents=(clientEntities||[]).filter(e=>e.client_id===match.id)
        setPropEntitySel(ents[0]?.id||'')
      } else if(tokenCandidates.length>1) {
        setPropClientMode('candidatos')
      } else {
        setPropClientMode('crear')
        setPropNewClient({name:parsed.cliente_nombre||'',rut:parsed.cliente_rut||'',razon_social:parsed.razon_social||''})
      }
      setPropuestaStep('asociar')
    } catch(err) {
      setPropError(err.message||'Error al procesar el archivo.')
      setPropuestaStep('upload')
    }
  }

  const applyPropuesta = async () => {
    setPropCreating(true)
    const d = propuestaData
    const filled = new Set()
    try {
      let client = propClientMatch
      if(!client || propClientMode==='crear') {
        const {data:nc,error} = await supabase.from('clients').insert({name:propNewClient.name.trim(),rut:propNewClient.rut.trim()||null,razon_social:propNewClient.razon_social.trim()||null}).select().single()
        if(error) throw error
        client = nc
        setClients(p=>[...p,nc])
      }
      setSelectedClient(client)
      up('client_id',client.id)
      if(propEntitySel) up('entity_id',propEntitySel)
      filled.add('client_id')
      if(d.proyecto){ up('title',d.proyecto); filled.add('title') }
      const AREAS = ['Corporativo','Tributario','Laboral','Otro']
      if(d.area){ const a=AREAS.find(x=>x.toLowerCase()===d.area?.toLowerCase()); if(a){ up('area',a); filled.add('area') } }
      const WHO_MAP = {'cl@leabogados.cl':'Cristóbal','ee@leabogados.cl':'Erasmo','mc@leabogados.cl':'Martín','mp@leabogados.cl':'Martina','rd@leabogados.cl':'Rodrigo'}
      if(user?.email){ const nm=WHO_MAP[user.email]; if(nm){ up('responsible',nm); filled.add('responsible') } }
      if(d.moneda==='CLP'){ up('moneda','CLP'); if(d.honorario_total){ up('amount_clp',String(d.honorario_total)); filled.add('amount_clp') } }
      else if(d.honorario_total){ up('amount_uf',String(d.honorario_total)); filled.add('amount_uf') }
      if(d.forma_cobro){ const MAP={cuotas:'cuotas',mensual:'mensual',porcentaje:'porcentaje',personalizada:'personalizada'}; const mapped=MAP[d.forma_cobro?.toLowerCase()]; if(mapped){ setCobroType(mapped); filled.add('cobro_type') } }
      if(d.n_cuotas){ setNCuotas(parseInt(d.n_cuotas)||3); filled.add('n_cuotas') }
      if(d.notas){ up('notes',d.notas); filled.add('notes') }
      setAiFields(filled)
      setPropuestaStep(null)
      setPropuestaData(null)
    } catch(err) {
      setPropError(err.message||'Error al aplicar la propuesta.')
    }
    setPropCreating(false)
  }

  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const clientMatches = useMemo(()=>{ if(!clientQ.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(clientQ.toLowerCase())).slice(0,6) },[clients,clientQ])
  const clientEntitiesList = useMemo(()=>{ if(!f.client_id) return []; return (clientEntities||[]).filter(e=>e.client_id===f.client_id) },[clientEntities,f.client_id])
  const moneda = f.moneda||'UF'
  const ufVal = parseFloat(f.uf_value)||0
  const amountUF = parseFloat(f.amount_uf)||0
  const montoCLP = parseFloat(f.amount_clp)||0
  const totalCLP = moneda==='CLP' ? montoCLP : amountUF*ufVal
  const costVal = costMode==='pct'
    ? (moneda==='UF' ? amountUF*(parseFloat(costPct)||0)/100 : montoCLP*(parseFloat(costPct)||0)/100)
    : (moneda==='UF' ? parseFloat(f.cost_uf)||0 : parseFloat(f.cost_clp)||0)
  const panelHon = parseFloat(newHon)||0
  const panelCosto = newCostMode==='pct' ? panelHon*(parseFloat(newCostPct)||0)/100 : parseFloat(newCosto)||0

  const generarCobros = () => {
    if(!f.client_id||!totalCLP) return []
    const cobros = []
    if(cobroType==='mensual' && mensualInicio) {
      const [y,m] = mensualInicio.split('-').map(Number); let cy=y, cm=m
      for(let i=0;i<12;i++){ cobros.push({monto:Math.round(totalCLP), fecha:`${cy}-${String(cm).padStart(2,'0')}-01`, label:`Mensual ${MONTHS[cm-1]} ${cy}`}); cm++; if(cm>12){cm=1;cy++} }
    } else if(cobroType==='cuotas' && cobroInicio && nCuotas>0) {
      const mc = Math.round(totalCLP/nCuotas)
      for(let i=0;i<nCuotas;i++) { const d=new Date(cobroInicio+'T12:00'); d.setMonth(d.getMonth()+i); cobros.push({monto:mc, fecha:d.toISOString().slice(0,10), label:`Cuota ${i+1}/${nCuotas}`}) }
    } else if(cobroType==='porcentaje') {
      tramos.forEach(t=>{ if(t.pct&&t.fecha) cobros.push({monto:Math.round(totalCLP*t.pct/100), fecha:t.fecha, label:`${t.pct}%`}) })
    } else if(cobroType==='personalizada') {
      cuotasCustom.forEach((c,i)=>{ if(c.monto&&c.fecha){ const mm=moneda==='CLP'?Math.round(parseFloat(c.monto)||0):Math.round((parseFloat(c.monto)||0)*ufVal); cobros.push({monto:mm, fecha:c.fecha, label:moneda==='CLP'?`Cobro ${i+1}`:`Cobro ${i+1} (${c.monto} UF)`}) } })
    }
    return cobros
  }
  const cobros = generarCobros()

  const handleSave = () => {
    const saveF = {...f}
    if(!costSwitch) { saveF.cost_uf = null; saveF.cost_clp = null }
    else if(costMode==='pct') {
      if(moneda==='UF') saveF.cost_uf = (amountUF*(parseFloat(costPct)||0)/100)||null
      else saveF.cost_clp = (montoCLP*(parseFloat(costPct)||0)/100)||null
    }
    if(_activandoPropuesta) {
      saveF.proposal_amount_uf = _propAmountUF
      saveF.proposal_amount_clp = _propAmountCLP
      saveF.activated_at = new Date().toISOString()
      saveF.status = 'Activo'
    }
    clearDraft()
    onSave({...saveF, cobros, cobro_type:cobroType, cobro_config:{nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio}, _actualizarPago:false, repartoTerceros:reparto})
  }

  const handleSaveDraft = () => {
    const saveF = {...f, status:'Borrador'}
    if(!costSwitch) { saveF.cost_uf = null; saveF.cost_clp = null }
    else if(costMode==='pct') {
      if(moneda==='UF') saveF.cost_uf = (amountUF*(parseFloat(costPct)||0)/100)||null
      else saveF.cost_clp = (montoCLP*(parseFloat(costPct)||0)/100)||null
    }
    clearDraft()
    onSave({...saveF, cobros:[], cobro_type:cobroType, cobro_config:{nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio}, _actualizarPago:false})
  }

  const confirmAndSave = async() => {
    if(modMode==='ajustar') {
      if(!newHon||!newVig){ alert('Completa el nuevo honorario y la fecha de vigencia.'); return }
      setSavingTariff(true)
      const rec = await onSaveTariff(sale, {honorario:panelHon, costo:panelCosto||null, currency:moneda, vigente_desde:newVig+'-01', motivo:null})
      if(rec) {
        setTariffs(p=>[...p,rec])
        const updF = {...f}
        if(moneda==='UF'){updF.amount_uf=newHon;updF.cost_uf=panelCosto||null;updF.cost_clp=null}
        else{updF.amount_clp=newHon;updF.cost_clp=panelCosto||null;updF.cost_uf=null}
        onSave({...updF, cobros, cobro_type:cobroType, cobro_config:{nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio}, _actualizarPago:false})
      }
    } else {
      if(!newFmt||!newVig){ alert('Elige el nuevo formato y la fecha de vigencia.'); return }
      const vigDate=newVig+'-01'
      const baseHon=panelHon||(moneda==='CLP'?montoCLP:amountUF)||0
      const totalC=moneda==='CLP'?baseHon:baseHon*ufVal
      const nuevasCuotas=[]
      if(newFmt==='cuotas'&&newCobroInicio&&newNCuotas>0&&totalC>0){
        const mc=Math.round(totalC/newNCuotas)
        for(let i=0;i<newNCuotas;i++){const d=new Date(newCobroInicio+'T12:00');d.setMonth(d.getMonth()+i);nuevasCuotas.push({due:d.toISOString().slice(0,10),amount:mc,concept:`${sale.title} — Cuota ${i+1}/${newNCuotas}`})}
      } else if(newFmt==='mensual'&&newVig&&totalC>0){
        const [y,m]=newVig.split('-').map(Number);let cy=y,cm=m
        for(let i=0;i<12;i++){nuevasCuotas.push({due:`${cy}-${String(cm).padStart(2,'0')}-01`,amount:Math.round(totalC),concept:`${sale.title} — Mensual ${MONTHS[cm-1]} ${cy}`});cm++;if(cm>12){cm=1;cy++}}
      } else if(newFmt==='personalizada'){
        newCuotasCustom.forEach((c,i)=>{if(c.monto&&c.fecha){const mm=moneda==='CLP'?Math.round(parseFloat(c.monto)||0):Math.round((parseFloat(c.monto)||0)*ufVal);nuevasCuotas.push({due:c.fecha,amount:mm,concept:`${sale.title} — Cobro ${i+1}`})}})
      } else if(newFmt==='unico'&&newVig&&totalC>0){
        nuevasCuotas.push({due:vigDate,amount:Math.round(totalC),concept:`${sale.title} — Pago único`})
      }
      setSavingTariff(true)
      const rec=await onCambiarFormato(sale,{newFmt,newHon:baseHon||null,newCosto:panelCosto||null,vigDate,motivo:null,nuevasCuotas})
      if(rec){ setTariffs(p=>[...p,rec]); onSave({...f,cobros,cobro_type:cobroType,cobro_config:{nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio},_actualizarPago:false}) }
    }
    setSavingTariff(false)
  }

  if(propuestaStep==='drive') return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:7,fontSize:13,fontWeight:600,color:C.text}}><DriveIcon size={16}/>Cargar desde Drive</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropDriveError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {propDriveLoading?(
        <div style={{textAlign:'center',padding:'40px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
          <Spin/>
          <div style={{fontSize:13,color:C.muted}}>Buscando archivos en Drive...</div>
        </div>
      ):propDriveError?(
        <div style={{fontSize:12,color:C.overdue,padding:'12px 0'}}>{propDriveError}</div>
      ):propDriveFiles.length===0?(
        <div style={{fontSize:13,color:C.muted,padding:'24px 0',textAlign:'center'}}>No hay archivos modificados en los ultimos 15 dias</div>
      ):(
        <>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Archivos modificados en los ultimos 15 dias</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:320,overflowY:'auto'}}>
            {propDriveFiles.map(f=>(
              <button key={f.id} type='button' onClick={async()=>{
                setPropuestaStep('extracting')
                try {
                  const token = await driveToken()
                  const isGDoc = f.mimeType==='application/vnd.google-apps.document'
                  const downloadUrl = isGDoc
                    ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`
                    : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`
                  const res = await fetch(downloadUrl,{headers:{Authorization:'Bearer '+token}})
                  const blob = await res.blob()
                  const fname = isGDoc?(f.name.includes('.')?f.name:f.name+'.docx'):(f.name||'archivo.pdf')
                  const file = new File([blob],fname,{type:blob.type})
                  await extractFromFile(file)
                } catch(e) {
                  setPropDriveError(e.message||'Error al descargar el archivo')
                  setPropuestaStep('drive')
                }
              }} style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',textAlign:'left',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div>
                <div style={{fontSize:10,color:C.muted,flexShrink:0}}>{new Date(f.modifiedTime).toLocaleDateString('es-CL',{day:'numeric',month:'short'})}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )

  if(propuestaStep==='upload'||propuestaStep==='extracting') return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Cargar propuesta</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {propuestaStep==='upload'?(
        <>
          <div
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accent}}
            onDragLeave={e=>{e.currentTarget.style.borderColor='#99ABB4'}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#99ABB4';const fi=e.dataTransfer.files[0];if(fi) extractFromFile(fi)}}
            onClick={()=>document.getElementById('prop-file-inp').click()}
            style={{border:'2px dashed #99ABB4',borderRadius:12,padding:'36px 20px',textAlign:'center',cursor:'pointer',transition:'border-color .15s'}}>
            <input id='prop-file-inp' type='file' accept='.pdf,.docx' style={{display:'none'}} onChange={e=>{const fi=e.target.files[0];if(fi) extractFromFile(fi)}}/>
            <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginTop:10}}>Arrastra un PDF o Word aqui</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>o haz clic para seleccionar · max 10 MB</div>
          </div>
          {propError&&<div style={{fontSize:12,color:C.overdue,marginTop:8}}>{propError}</div>}
        </>
      ):(
        <div style={{textAlign:'center',padding:'48px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <Spin/>
          <div style={{fontSize:13,color:C.muted}}>Leyendo propuesta con IA...</div>
        </div>
      )}
    </>
  )

  if(propuestaStep==='asociar'&&propuestaData) return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Propuesta leida</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropuestaData(null);setPropError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {/* Candidatos múltiples */}
      {propClientMode==='candidatos'&&(
        <>
          <Lbl>Varios clientes posibles — elige uno</Lbl>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
            {propClientCandidates.map(c=>(
              <button key={c.id} type='button' onClick={()=>{setPropClientMatch(c);setPropClientMode('asociar');const ents=(clientEntities||[]).filter(e=>e.client_id===c.id);setPropEntitySel(ents[0]?.id||'')}}
                style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',textAlign:'left',cursor:'pointer'}}>
                <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{c.name}</div>
                {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:4}}>
            <button type='button' onClick={()=>{setPropClientMode('buscar');setPropSearchQ('')}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Buscar otro cliente</button>
            <button type='button' onClick={()=>{setPropClientMode('crear');setPropNewClient({name:propuestaData?.cliente_nombre||'',rut:propuestaData?.cliente_rut||'',razon_social:propuestaData?.razon_social||''})}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Crear como Prospecto</button>
          </div>
        </>
      )}
      {/* Cliente detectado con certeza */}
      {(propClientMode==='asociar'||propClientMode==='crear')&&propClientMatch&&(
        <>
          <Lbl>Cliente detectado</Lbl>
          <div style={{padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.accent}`,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{propClientMatch.name}</div>
            {propClientMatch.rut&&<div style={{fontSize:11,color:C.muted}}>{propClientMatch.rut}</div>}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:14}}>
            <button type='button' onClick={()=>setPropClientMode('asociar')}
              style={{flex:1,padding:'10px 0',borderRadius:8,border:`1px solid ${propClientMode==='asociar'?C.accent:C.border}`,background:propClientMode==='asociar'?C.accent:'transparent',color:propClientMode==='asociar'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>
              Asociar a este cliente
            </button>
            <button type='button' onClick={()=>setPropClientMode('crear')}
              style={{flex:1,padding:'10px 0',borderRadius:8,border:`1px solid ${propClientMode==='crear'?C.accent:C.border}`,background:propClientMode==='crear'?C.accent:'transparent',color:propClientMode==='crear'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>
              Crear cliente nuevo
            </button>
          </div>
          {propClientMode==='asociar'&&(()=>{const ents=(clientEntities||[]).filter(e=>e.client_id===propClientMatch.id);if(!ents.length)return null;return(<Fld label='Razon social'><select value={propEntitySel} onChange={e=>setPropEntitySel(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:14,color:C.text,boxSizing:'border-box'}}><option value=''>— Asociar despues —</option>{ents.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}</select></Fld>)})()}
          {propClientMode==='crear'&&(<>
            <Fld label='Nombre'><Inp value={propNewClient.name} onChange={e=>setPropNewClient(p=>({...p,name:e.target.value}))} placeholder='Nombre del cliente'/></Fld>
            <Fld label='RUT'><Inp value={propNewClient.rut} onChange={e=>setPropNewClient(p=>({...p,rut:e.target.value}))} placeholder='12.345.678-9'/></Fld>
            <Fld label='Razon social'><Inp value={propNewClient.razon_social} onChange={e=>setPropNewClient(p=>({...p,razon_social:e.target.value}))} placeholder='Opcional'/></Fld>
          </>)}
        </>
      )}
      {/* Sin match — crear nuevo */}
      {(propClientMode==='crear'||propClientMode==='buscar')&&!propClientMatch&&propClientMode!=='buscar'&&(
        <>
          <Lbl>Cliente no encontrado</Lbl>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <button type='button' onClick={()=>{setPropClientMode('buscar');setPropSearchQ('')}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Buscar otro cliente</button>
          </div>
          <Fld label='Nombre'><Inp value={propNewClient.name} onChange={e=>setPropNewClient(p=>({...p,name:e.target.value}))} placeholder='Nombre del cliente'/></Fld>
          <Fld label='RUT'><Inp value={propNewClient.rut} onChange={e=>setPropNewClient(p=>({...p,rut:e.target.value}))} placeholder='12.345.678-9'/></Fld>
          <Fld label='Razon social'><Inp value={propNewClient.razon_social} onChange={e=>setPropNewClient(p=>({...p,razon_social:e.target.value}))} placeholder='Opcional'/></Fld>
        </>
      )}
      {/* Búsqueda manual */}
      {propClientMode==='buscar'&&(
        <>
          <Lbl>Buscar cliente</Lbl>
          <Inp value={propSearchQ} onChange={e=>setPropSearchQ(e.target.value)} placeholder='Escribe nombre o RUT...' style={{marginBottom:8}}/>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12,maxHeight:180,overflowY:'auto'}}>
            {(propSearchQ.trim().length>=2?clients.filter(c=>c.name.toLowerCase().includes(propSearchQ.toLowerCase())||((c.rut||'').includes(propSearchQ))):clients.slice(0,8)).map(c=>(
              <button key={c.id} type='button' onClick={()=>{setPropClientMatch(c);setPropClientMode('asociar');const ents=(clientEntities||[]).filter(e=>e.client_id===c.id);setPropEntitySel(ents[0]?.id||'')}}
                style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',textAlign:'left',cursor:'pointer'}}>
                <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{c.name}</div>
                {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
              </button>
            ))}
          </div>
          <button type='button' onClick={()=>{setPropClientMode('crear');setPropClientMatch(null);setPropNewClient({name:propuestaData?.cliente_nombre||'',rut:propuestaData?.cliente_rut||'',razon_social:propuestaData?.razon_social||''})}} style={{width:'100%',padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:4}}>Crear como Prospecto</button>
        </>
      )}
      {propError&&<div style={{fontSize:12,color:C.overdue,marginBottom:10}}>{propError}</div>}
      {(propClientMode==='asociar'||propClientMode==='crear')&&(
        <button type='button' disabled={propCreating||(propClientMode==='crear'&&!propNewClient.name.trim())} onClick={applyPropuesta}
          style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:(propCreating||(propClientMode==='crear'&&!propNewClient.name.trim()))?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:4}}>
          {propCreating&&<Spin/>}
          {propCreating?'Aplicando...':'Continuar y pre-llenar formulario'}
        </button>
      )}
    </>
  )

  return (
    <>
      {/* Banner recuperar borrador local */}
      {hasDraft&&!sale?.id&&(
        <div style={{background:'#FFFBF0',border:'1px solid #E8CC6A',borderRadius:8,padding:'9px 12px',marginBottom:14,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:'#7A5C00'}}>Borrador guardado</div>
            {draftTs&&<div style={{fontSize:11,color:'#7A5C00'}}>{new Date(draftTs).toLocaleDateString('es-CL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>}
          </div>
          <div style={{display:'flex',gap:8,flexShrink:0}}>
            <button onClick={clearDraft} style={{background:'none',border:'none',color:'#7A5C00',fontSize:12,cursor:'pointer',fontWeight:600}}>Descartar</button>
            <button onClick={restoreDraft} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'#E8CC6A',color:'#4A3800',fontSize:12,fontWeight:700,cursor:'pointer'}}>Recuperar</button>
          </div>
        </div>
      )}

      {/* 1. Cliente */}
      {!selectedClient ? (
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <div style={{display:'flex',gap:6}}>
              <Inp value={clientQ} onChange={e=>setClientQ(e.target.value)} placeholder='Buscar cliente...' autoFocus style={{flex:1}}/>
              <button onClick={()=>setShowNewClient(true)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>+ Nuevo</button>
            </div>
            {clientMatches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
                {clientMatches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);up('client_id',c.id);setClientQ('')}}
                    style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                    {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>
      ) : (
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,padding:'10px 14px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.accent}`}}>
          <div>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{selectedClient.name}</div>
            {selectedClient.rut&&<div style={{fontSize:11,color:C.muted}}>{selectedClient.rut}</div>}
          </div>
          <button onClick={()=>{setSelectedClient(null);up('client_id','')}} style={{background:'none',border:'none',color:C.muted,fontSize:13,cursor:'pointer'}}>Cambiar</button>
        </div>
      )}
      {showNewClient&&<MiniClientForm defaultStatus={f.status==='Propuesta'?'Prospecto':'Activo'} onSave={c=>{setClients(p=>[...p,c]);setSelectedClient(c);up('client_id',c.id);setShowNewClient(false)}} onCancel={()=>setShowNewClient(false)}/>}
      {showNewClient&&f.status==='Propuesta'&&<div style={{fontSize:11,color:'#7A5C00',background:'#FFFBF0',border:'1px solid #E8CC6A',borderRadius:6,padding:'5px 10px',marginTop:-8,marginBottom:8}}>Se creará como Prospecto. Al activar la propuesta se convertirá en cliente activo.</div>}

      <Fld label={<>Proyecto<AiBadge field='title'/></>}><Inp value={f.title||''} onChange={e=>up('title',e.target.value)} placeholder='Ej: Reorganizacion societaria...'/></Fld>

      {/* 2. Razón social */}
      {f.client_id&&(
        <Fld label='Razón social a facturar'>
          {clientEntitiesList.length>0?(
            <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
              <option value=''>— Asociar después —</option>
              {clientEntitiesList.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
            </select>
          ):(
            <div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Este cliente no tiene razones sociales. Se asociará al emitir la primera factura.</div>
          )}
        </Fld>
      )}

      {/* 3. Área + Responsable */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
        <Fld label={<>Área<AiBadge field='area'/></>}><Sel value={f.area||'Corporativo'} onChange={e=>up('area',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
        <Fld label={<>Responsable<AiBadge field='responsible'/></>}>
          <select value={f.responsible||''} onChange={e=>up('responsible',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            <option value=''>— Seleccionar —</option>
            {WHO_LIST.map(w=><option key={w} value={w}>{w}</option>)}
          </select>
        </Fld>
      </div>

      {/* 4. Estado + Año + Mes */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Propuesta','Borrador','Rechazada','Terminado','Pausado']}/></Fld>
        <Fld label='Año'><Inp type='number' value={f.year||currentYear} onChange={e=>up('year',parseInt(e.target.value))} placeholder={String(currentYear)}/></Fld>
        <Fld label='Mes'>
          <select value={f.month||currentMonth} onChange={e=>up('month',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}>
            {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </Fld>
      </div>

      {/* 5–8. Honorarios, costos, cobro, notas — editable solo en NUEVA VENTA */}
      {!sale?.id&&(<>
        <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.6,marginBottom:6}}>Honorarios<AiBadge field='amount_uf'/><AiBadge field='amount_clp'/></div>
        <div style={{display:'flex',alignItems:'stretch',height:44,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff',marginBottom:14}}>
          <input type='number' step={moneda==='UF'?'0.01':'1'}
            value={moneda==='UF'?f.amount_uf||'':f.amount_clp||''}
            onChange={e=>up(moneda==='UF'?'amount_uf':'amount_clp',e.target.value)}
            placeholder={moneda==='UF'?'0.00':'0'}
            style={{flex:1,border:'none',background:'transparent',padding:'0 14px',fontSize:15,color:C.text,outline:'none',minWidth:0}}
          />
          <div style={{width:1,background:'#EBEBEB',margin:'10px 0',flexShrink:0}}/>
          <div style={{display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0}}>
            <button type='button' onClick={()=>up('moneda','UF')} style={{padding:'2px 6px',border:'none',background:moneda==='UF'?C.accent:'transparent',color:moneda==='UF'?'#fff':C.muted,fontSize:11,fontWeight:700,borderRadius:4,cursor:'pointer',letterSpacing:.3}}>UF</button>
            <button type='button' onClick={()=>up('moneda','CLP')} style={{padding:'2px 6px',border:'none',background:moneda==='CLP'?C.accent:'transparent',color:moneda==='CLP'?'#fff':C.muted,fontSize:11,fontWeight:700,borderRadius:4,cursor:'pointer',letterSpacing:.3}}>CLP</button>
          </div>
          {moneda==='UF'&&<>
            <div style={{width:1,background:'#EBEBEB',margin:'10px 0',flexShrink:0}}/>
            <div style={{display:'flex',alignItems:'center',padding:'0 10px',gap:3,flexShrink:0}}>
              <span style={{fontSize:11,color:C.muted,fontWeight:600}}>$</span>
              <input type='number' value={f.uf_value||''}
                onChange={e=>up('uf_value',e.target.value)}
                placeholder={ufHoy?String(Math.round(ufHoy)):'—'}
                style={{width:58,border:'none',background:'transparent',fontSize:12,color:C.muted,outline:'none'}}
              />
            </div>
          </>}
        </div>

        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:costSwitch?10:14}}>
          <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.6}}>Costos de terceros</div>
          <button type='button' onClick={()=>setCostSwitch(p=>!p)} style={{width:34,height:19,borderRadius:10,border:'none',background:costSwitch?C.accent:'#CBD5DB',position:'relative',cursor:'pointer',padding:0,flexShrink:0,transition:'background .15s'}}>
            <span style={{position:'absolute',top:2,left:costSwitch?16:2,width:15,height:15,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
          </button>
        </div>
        {costSwitch&&(
          <div style={{marginBottom:costMode==='pct'&&costVal>0?4:14}}>
            <div style={{display:'flex',alignItems:'stretch',height:44,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff'}}>
              <input type='number' step={costMode==='pct'?'0.1':'0.01'}
                value={costMode==='pct'?costPct:(moneda==='UF'?f.cost_uf||'':f.cost_clp||'')}
                onChange={e=>{ if(costMode==='pct') setCostPct(e.target.value); else up(moneda==='UF'?'cost_uf':'cost_clp',e.target.value) }}
                placeholder='0.00'
                style={{flex:1,border:'none',background:'transparent',padding:'0 14px',fontSize:15,color:C.text,outline:'none',minWidth:0}}
              />
              <div style={{width:1,background:'#EBEBEB',margin:'10px 0',flexShrink:0}}/>
              <div style={{display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0}}>
                <button type='button' onClick={()=>setCostMode('fijo')} style={{padding:'2px 6px',border:'none',background:costMode==='fijo'?C.accent:'transparent',color:costMode==='fijo'?'#fff':C.muted,fontSize:11,fontWeight:700,borderRadius:4,cursor:'pointer',letterSpacing:.3}}>{moneda}</button>
                <button type='button' onClick={()=>setCostMode('pct')} style={{padding:'2px 6px',border:'none',background:costMode==='pct'?C.accent:'transparent',color:costMode==='pct'?'#fff':C.muted,fontSize:11,fontWeight:700,borderRadius:4,cursor:'pointer',letterSpacing:.3}}>%</button>
              </div>
            </div>
          </div>
        )}
        {costSwitch&&costMode==='pct'&&costVal>0&&<div style={{fontSize:11,color:C.muted,marginBottom:14}}>= {moneda==='UF'?fmtUF(costVal):fmt(Math.round(costVal))}</div>}
        {costSwitch&&<RepartoTerceros proveedores={proveedores} rows={reparto} setRows={setReparto} moneda={moneda} ufVal={ufVal} saleTotal={moneda==='UF'?amountUF:montoCLP} costTotal={costVal}/>}

      </>)}

      {/* 7. Forma de cobro — solo nueva venta */}
      {!sale?.id&&totalCLP>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.6,marginBottom:6}}>Forma de cobro</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginBottom:12}}>
            {[['cuotas','Cuotas mensuales'],['mensual','Mensual recurrente'],['porcentaje','Por porcentaje'],['personalizada','Personalizada']].map(([v,l])=>(
              <button key={v} onClick={()=>setCobroType(v)} style={{padding:'8px 4px',borderRadius:8,border:`2px solid ${cobroType===v?C.accent:C.border}`,background:cobroType===v?'#E6EEF1':'transparent',color:cobroType===v?C.accent:C.muted,fontSize:10,fontWeight:700,cursor:'pointer',textAlign:'center'}}>{l}</button>
            ))}
          </div>
          {cobroType==='mensual'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
                {moneda==='UF'
                  ? <Fld label='Monto mensual UF'><Inp type='number' step='0.01' value={f.amount_uf||''} onChange={e=>up('amount_uf',e.target.value)} placeholder='0.00'/></Fld>
                  : <Fld label='Monto mensual (CLP)'><Inp type='number' value={f.amount_clp||''} onChange={e=>up('amount_clp',e.target.value)} placeholder='Ej: 1500000'/></Fld>}
                <Fld label='Inicio cobro'><Inp type='date' value={mensualInicio} onChange={e=>setMensualInicio(e.target.value)}/></Fld>
              </div>
              {mensualInicio&&totalCLP>0&&<div style={{fontSize:11,color:C.muted}}>Genera <strong style={{color:C.text}}>12 cobros</strong> de <strong style={{color:C.text}}>{fmt(Math.round(totalCLP))}</strong>/mes desde {mensualInicio.slice(0,7)}</div>}
            </div>
          )}
          {cobroType==='cuotas'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:8}}>
                <Fld label='N° cuotas'><Inp type='number' min='1' max='36' value={nCuotas} onChange={e=>setNCuotas(Math.max(1,parseInt(e.target.value)||1))}/></Fld>
                <Fld label='Inicio cobro'><Inp type='date' value={cobroInicio} onChange={e=>setCobroInicio(e.target.value)}/></Fld>
              </div>
              {cobroInicio&&<div style={{fontSize:11,color:C.muted}}>Cuota mensual: <strong style={{color:C.text}}>{fmt(Math.round(totalCLP/nCuotas))}</strong> · Total: {fmt(totalCLP)}</div>}
            </div>
          )}
          {cobroType==='porcentaje'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              {tramos.map((t,i)=>(
                <div key={t.id} style={{display:'grid',gridTemplateColumns:'60px 1fr 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'%':''}><Inp type='number' min='0' max='100' value={t.pct} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,pct:parseInt(e.target.value)||0}:x))}/></Fld>
                  <Fld label={i===0?'Fecha':''}><Inp type='date' value={t.fecha} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,fecha:e.target.value}:x))}/></Fld>
                  {tramos.length>2&&<button onClick={()=>setTramos(p=>p.filter(x=>x.id!==t.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}>×</button>}
                </div>
              ))}
              <button onClick={()=>setTramos(p=>[...p,{id:Date.now(),pct:0,fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar tramo</button>
              <div style={{fontSize:11,color:tramos.reduce((a,t)=>a+t.pct,0)!==100?C.overdue:C.normal,marginTop:4}}>Total: {tramos.reduce((a,t)=>a+t.pct,0)}% {tramos.reduce((a,t)=>a+t.pct,0)!==100?'(debe sumar 100%)':''}</div>
            </div>
          )}
          {cobroType==='personalizada'&&(
            <div style={{background:'#F7F7F7',borderRadius:8,padding:'12px 14px'}}>
              {cuotasCustom.map((c,i)=>(
                <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'Monto':''}>
                    <Inp type='number' step={moneda==='UF'?'0.01':'1'} value={c.monto} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,monto:e.target.value}:x))} placeholder={moneda==='UF'?'0.00':'0'}/>
                  </Fld>
                  <Fld label={i===0?'Fecha':''}>
                    <div>
                      <Inp type='date' value={c.fecha} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,fecha:e.target.value}:x))}/>
                      {moneda==='UF'&&c.monto&&ufVal>0&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmt(Math.round(parseFloat(c.monto)*ufVal))}</div>}
                    </div>
                  </Fld>
                  {cuotasCustom.length>1&&<button onClick={()=>setCuotasCustom(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}>×</button>}
                </div>
              ))}
              <button onClick={()=>setCuotasCustom(p=>[...p,{id:Date.now(),monto:'',fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar cuota</button>
              {cuotasCustom.some(c=>c.monto)&&(
                <div style={{fontSize:11,color:C.muted,marginTop:6}}>
                  {moneda==='UF'
                    ? <>Total: <strong style={{color:C.text}}>{fmtUF(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0))}</strong> = {fmt(Math.round(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0)*ufVal))}</>
                    : <>Total: <strong style={{color:C.text}}>{fmt(cuotasCustom.reduce((a,c)=>a+Math.round(parseFloat(c.monto)||0),0))}</strong></>
                  }
                </div>
              )}
            </div>
          )}
          {cobros.length>0&&(
            <div style={{marginTop:8,padding:'8px 12px',borderRadius:8,background:'#E6EEF1',fontSize:11,color:C.accent}}>
              Se crearán <strong>{cobros.length} cobro{cobros.length!==1?'s':''}</strong> pendientes: {cobros.map(c=>`${c.label} ${fmt(c.monto)} (${fmtFechaDMY(c.fecha)})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* 8. Notas — solo nueva venta */}
      {!sale?.id&&<Fld label={<>Notas<AiBadge field='notes'/></>}><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></Fld>}

      {/* 9. CONDICIONES REGISTRADAS — solo venta guardada */}
      {sale?.id&&(()=>{
        const COBRO_LBL = {cuotas:'Cuotas mensuales',mensual:'Mensual recurrente',porcentaje:'Por porcentaje',personalizada:'Personalizada'}
        const curHon = moneda==='UF' ? (amountUF>0?fmtUF(amountUF):'—') : (montoCLP>0?fmt(montoCLP):'—')
        const curCost = moneda==='UF' ? (parseFloat(f.cost_uf)>0?fmtUF(parseFloat(f.cost_uf)):(costMode==='pct'&&parseFloat(costPct)>0?`${costPct}%`:'—')) : (parseFloat(f.cost_clp)>0?fmt(parseFloat(f.cost_clp)):(costMode==='pct'&&parseFloat(costPct)>0?`${costPct}%`:'—'))
        const curCobro = COBRO_LBL[cobroType]||'—'
        const notasPrev = f.notes ? (f.notes.length>48?f.notes.slice(0,48)+'…':f.notes) : '—'
        const row = (lbl,val,key,isLast) => (
          <div key={key} onClick={()=>setOpenCondicion(openCondicion===key?null:key)}
            style={{display:'flex',alignItems:'center',padding:'10px 12px',borderBottom:isLast?'none':`1px solid ${C.border}`,cursor:'pointer',userSelect:'none'}}>
            <div style={{fontSize:12,color:C.muted,width:118,flexShrink:0}}>{lbl}</div>
            <div style={{flex:1,fontSize:13,fontWeight:500,color:val==='—'?C.muted:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val}</div>
            <span style={{fontSize:16,color:C.muted,flexShrink:0,marginLeft:6,transform:openCondicion===key?'rotate(90deg)':'rotate(0)',transition:'transform .15s'}}>›</span>
          </div>
        )
        return (
          <>
            <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.6,marginTop:8,marginBottom:6}}>Condiciones registradas</div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
              {row('Honorarios',curHon,'honorarios',false)}
              {row('Costos de terceros',curCost,'costos',false)}
              {openCondicion==='costos'&&(
                <div style={{padding:'10px 12px 12px',borderTop:`1px solid ${C.border}`}}>
                  <RepartoTerceros proveedores={proveedores} rows={reparto} setRows={setReparto} moneda={moneda} ufVal={ufVal} saleTotal={moneda==='UF'?amountUF:montoCLP} costTotal={costVal}/>
                  <div style={{fontSize:11,color:C.muted,lineHeight:1.4}}>Se guarda al tocar <strong style={{color:C.text}}>Guardar</strong>. Es comisión de tu honorario; no se le cobra al cliente.</div>
                </div>
              )}
              {row('Forma de cobro',curCobro,'cobro',false)}
              {row('Notas',notasPrev,'notas',true)}
              {openCondicion==='notas'&&(
                <div style={{padding:'8px 12px 12px',borderTop:`1px solid ${C.border}`}}>
                  <Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/>
                </div>
              )}
            </div>
          </>
        )
      })()}

      {/* 10. Actualizar honorarios (solo ventas guardadas) */}
      {sale?.id&&(
        <div style={{marginTop:6,marginBottom:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:modCobro?10:0}}>
            <span style={{fontSize:13,fontWeight:600,color:C.text}}>Actualizar honorarios</span>
            <Switch on={modCobro} onToggle={()=>{ modCobro ? resetMod() : setModCobro(true) }}/>
          </div>
          {modCobro&&(
            <div>
              <div style={{fontSize:12,color:C.muted,background:'#F7F7F7',borderRadius:8,padding:'8px 10px',marginBottom:10,lineHeight:1.4}}>Reemplaza las cuotas programadas. Las ya emitidas y pagadas no se tocan.</div>
              <div style={{display:'flex',gap:0,marginBottom:12,border:`0.5px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
                {['ajustar','cambiar'].map(m=>(
                  <button key={m} onClick={()=>setModMode(m)} style={{flex:1,padding:'8px 6px',border:'none',background:modMode===m?C.accent:'#EFF3F5',color:modMode===m?'#fff':C.muted,fontSize:12,fontWeight:modMode===m?600:400,cursor:'pointer'}}>
                    {m==='ajustar'?'Ajustar monto':'Cambiar formato'}
                  </button>
                ))}
              </div>
              {modMode==='ajustar'&&(
                <>
                  <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'flex-end'}}>
                    <div style={{flex:'0 0 60%',boxSizing:'border-box'}}>
                      <Lbl>Nuevo honorario</Lbl>
                      <div style={{display:'flex',height:40,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
                        <input type='number' step={moneda==='UF'?'0.01':'1'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder={moneda==='UF'?'0.00':'0'}
                          style={{flex:1,border:'none',padding:'0 10px',fontSize:13,background:'#F7F7F7',color:C.text,outline:'none',minWidth:0}} autoFocus/>
                        <select value={moneda} onChange={e=>up('moneda',e.target.value)}
                          style={{width:52,border:'none',borderLeft:`1px solid ${C.border}`,padding:'0 4px',fontSize:12,background:'#EFF3F5',color:C.accent,fontWeight:600,cursor:'pointer',outline:'none'}}>
                          <option value='UF'>UF</option>
                          <option value='CLP'>CLP</option>
                        </select>
                      </div>
                    </div>
                    <div style={{flex:'0 0 calc(40% - 8px)',boxSizing:'border-box'}}>
                      <Lbl>Vigente desde</Lbl>
                      <Inp type='month' value={newVig} onChange={e=>setNewVig(e.target.value)} style={{fontSize:11,padding:'10px 6px'}}/>
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:panelCosto>0?4:10}}>
                    <span style={{fontSize:12,color:C.muted,flexShrink:0}}>Agregar costo</span>
                    <div style={{display:'flex',height:34,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>
                      <button type='button' onClick={()=>setNewCostMode('fijo')} style={{padding:'0 10px',border:'none',background:newCostMode==='fijo'?C.accent:'#EFF3F5',color:newCostMode==='fijo'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{moneda}</button>
                      <button type='button' onClick={()=>setNewCostMode('pct')} style={{padding:'0 10px',border:'none',borderLeft:`1px solid ${C.border}`,background:newCostMode==='pct'?C.accent:'#EFF3F5',color:newCostMode==='pct'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>%</button>
                    </div>
                    <input type='number' step={newCostMode==='pct'?'0.1':'0.01'}
                      value={newCostMode==='pct'?newCostPct:newCosto}
                      onChange={e=>{ if(newCostMode==='pct') setNewCostPct(e.target.value); else setNewCosto(e.target.value) }}
                      placeholder='0'
                      style={{flex:1,padding:'0 10px',height:34,borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,background:'#F7F7F7',color:C.text,outline:'none',minWidth:0,boxSizing:'border-box'}}
                    />
                  </div>
                  {panelHon>0&&panelCosto>0&&<div style={{fontSize:12,color:C.muted,marginBottom:10}}>= {moneda==='UF'?fmtUF(panelCosto):fmt(Math.round(panelCosto))} · neto firma <strong style={{color:C.text}}>{moneda==='UF'?fmtUF(panelHon-panelCosto):fmt(Math.round(panelHon-panelCosto))}</strong></div>}
                  {newVig&&(()=>{const progN=(billing||[]).filter(b=>b.sale_id===sale.id&&b.status==='Programada'&&b.due&&b.due>=newVig+'-01').length;return progN>0?<div style={{fontSize:11,color:'#C77F18',background:'#FFFBF0',border:'0.5px solid #F0D88A',borderRadius:8,padding:'8px 10px',marginBottom:8,lineHeight:1.4}}>Se recalcularán <strong>{progN}</strong> factura{progN!==1?'s':''} programada{progN!==1?'s':''} desde {newVig}.</div>:null})()}
                </>
              )}
              {modMode==='cambiar'&&(
                <>
                  <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.4,marginBottom:8}}>Nuevo formato</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                    {[{k:'mensual',lbl:'Mensual',desc:'Cobro recurrente / mes'},{k:'cuotas',lbl:'Cuotas iguales',desc:'N cuotas de igual valor'},{k:'personalizada',lbl:'Personalizada',desc:'Montos y fechas libres'},{k:'unico',lbl:'Pago único',desc:'Un solo cobro'}].map(({k,lbl,desc})=>(
                      <div key={k} onClick={()=>setNewFmt(k)} style={{padding:'10px 10px 8px',borderRadius:10,border:`0.5px solid ${newFmt===k?C.accent:C.border}`,background:newFmt===k?'#EDF3F5':'transparent',cursor:'pointer'}}>
                        <div style={{fontSize:12,fontWeight:newFmt===k?600:400,color:newFmt===k?C.accent:C.text,marginBottom:2}}>{lbl}</div>
                        <div style={{fontSize:10,color:C.muted,lineHeight:1.3}}>{desc}</div>
                      </div>
                    ))}
                  </div>
                  <Fld label='Vigente desde'><Inp type='month' value={newVig} onChange={e=>setNewVig(e.target.value)}/></Fld>
                  {newFmt==='cuotas'&&(
                    <div style={{background:'#F7F8F9',borderRadius:10,padding:'12px',border:`0.5px solid ${C.border}`,margin:'8px 0'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                        <Fld label='N.° de cuotas'><Inp type='number' value={newNCuotas} onChange={e=>setNewNCuotas(parseInt(e.target.value)||3)} placeholder='3'/></Fld>
                        <Fld label={`Monto total (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                        <Fld label='Primera cuota'><Inp type='month' value={newCobroInicio} onChange={e=>setNewCobroInicio(e.target.value)}/></Fld>
                        <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                      </div>
                      {newHon&&newNCuotas>0&&(()=>{const tot=moneda==='CLP'?parseFloat(newHon)||0:(parseFloat(newHon)||0)*ufVal;const mc=tot>0?Math.round(tot/newNCuotas):0;return mc>0?<div style={{fontSize:11,color:C.muted,background:'#fff',borderRadius:6,padding:'6px 8px',border:`0.5px solid ${C.border}`}}>{newNCuotas} cuotas de <strong style={{color:C.accent}}>{fmt(mc)}</strong></div>:null})()}
                    </div>
                  )}
                  {newFmt==='mensual'&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'8px 0'}}>
                      <Fld label={`Nuevo monto (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                      <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                    </div>
                  )}
                  {newFmt==='personalizada'&&(
                    <div style={{background:'#F7F8F9',borderRadius:10,padding:'12px',border:`0.5px solid ${C.border}`,margin:'8px 0'}}>
                      {newCuotasCustom.map((c,i)=>(
                        <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 28px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                          <Fld label={i===0?`Monto (${moneda})`:''}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={c.monto} onChange={e=>setNewCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,monto:e.target.value}:x))}/></Fld>
                          <Fld label={i===0?'Fecha':''}><Inp type='date' value={c.fecha} onChange={e=>setNewCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,fecha:e.target.value}:x))}/></Fld>
                          {newCuotasCustom.length>1&&<button onClick={()=>setNewCuotasCustom(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}>×</button>}
                        </div>
                      ))}
                      <button onClick={()=>setNewCuotasCustom(p=>[...p,{id:Date.now(),monto:'',fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar cuota</button>
                    </div>
                  )}
                  {newFmt==='unico'&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'8px 0'}}>
                      <Fld label={`Monto (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                      <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                    </div>
                  )}
                  {newVig&&newFmt&&(()=>{const vigDate=newVig+'-01';const progN=(billing||[]).filter(b=>b.sale_id===sale.id&&b.status==='Programada'&&b.due&&b.due>=vigDate).length;return <div style={{fontSize:11,color:'#C77F18',background:'#FFFBF0',border:'0.5px solid #F0D88A',borderRadius:8,padding:'8px 10px',margin:'8px 0',lineHeight:1.4}}>Reemplaza <strong>{progN}</strong> factura{progN!==1?'s':''} programada{progN!==1?'s':''} desde {newVig}. Las emitidas/pagadas no se tocan.</div>})()}
                </>
              )}
            </div>
          )}
          {/* 10. Historial de honorarios */}
          <div style={{marginTop:modCobro?14:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <Lbl>Historial de honorarios</Lbl>
            {tariffs.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Sin historial registrado.</div>}
            {tariffs.map((t,i)=>{
              const vigente=i===tariffs.length-1
              const cur=t.currency||'UF'
              return (
                <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text}}>Desde {fmtMesAno(t.vigente_desde)}</div>
                    {t.motivo&&<div style={{fontSize:10,color:C.muted}}>{t.motivo}</div>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{cur==='CLP'?fmt(t.honorario):fmtUF(t.honorario)}</div>
                      {t.costo>0&&<div style={{fontSize:10,color:C.overdue}}>Costo {cur==='CLP'?fmt(t.costo):fmtUF(t.costo)}</div>}
                    </div>
                    <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,padding:'2px 7px',borderRadius:4,background:vigente?'#E1F5EE':'#F0F0F0',color:vigente?'#0F6E56':C.muted}}>{vigente?'Vigente':'Histórico'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 11. Botones */}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {sale?.id&&<button onClick={()=>onDelete(sale.id)} style={{flex:1,padding:'11px 0',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={modCobro?resetMod:onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        {!sale?.id&&!modCobro&&<button disabled={saving} onClick={handleSaveDraft}
          style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          Borrador
        </button>}
        <button disabled={saving||savingTariff||!f.client_id||!f.title} onClick={modCobro?confirmAndSave:handleSave}
          style={{flex:2,padding:11,borderRadius:10,border:'none',background:_activandoPropuesta?'#1D9E75':C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.title)?.6:1}}>
          {(saving||savingTariff)?<Spin/>:null}{(saving||savingTariff)?'Guardando...':modCobro?'Confirmar y guardar':_activandoPropuesta?'Activar propuesta':'Guardar'}
        </button>
      </div>
    </>
  )
}
function AsignarClienteInline({bill,clients,onAssign,label='Asignar cliente',placeholder='Buscar cliente...'}) {
  const [open,setOpen] = useState(false)
  const [q,setQ] = useState('')
  const matches = useMemo(()=>{ if(!q.trim()) return []; const t=q.toLowerCase(); return clients.filter(c=>c.name.toLowerCase().includes(t)||(c.rut||'').toLowerCase().includes(t)||(c.razon_social||'').toLowerCase().includes(t)).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,6) },[q,clients])
  if(!open) return (
    <button onClick={()=>setOpen(true)} style={{padding:'3px 9px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{label}</button>
  )
  return (
    <div style={{position:'relative',minWidth:180}}>
      <input autoFocus value={q} onChange={e=>setQ(e.target.value)} onBlur={()=>setTimeout(()=>setOpen(false),150)} placeholder={placeholder} style={{width:'100%',padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12,boxSizing:'border-box',outline:'none'}}/>
      {matches.length>0&&(
        <div style={{position:'absolute',top:'100%',right:0,left:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
          {matches.map(c=>(
            <div key={c.id} onMouseDown={()=>{onAssign(bill,c.id);setOpen(false);setQ('')}} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:12}} onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
              <div style={{fontWeight:500}}>{c.name}</div>
              {c.rut&&<div style={{fontSize:10,color:C.muted}}>{c.rut}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Checklist de facturación del mes: lista de programadas + emitidas con vencimiento en el mes elegido.
// Marcar = emitir (Programada -> Pendiente); desmarcar = volver a Programada. KPIs en vivo.
function ChecklistFacturacion({billing, clients, onEmitir, onStatusChange}) {
  const now = new Date()
  const [year,setYear] = useState(String(now.getFullYear()))
  const [month,setMonth] = useState(String(now.getMonth()+1).padStart(2,'0'))
  const [estado,setEstado] = useState('todos') // todos | pendientes | emitidos
  const [busy,setBusy] = useState(null)
  const [desc,setDesc] = useState(false)
  const ufState = useUF()
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const EMIT = ['Pendiente','Vencido','Propuesta']
  const esEmitida = b => b.status!=='Programada'
  const mesKey = `${year}-${month}`

  const items = useMemo(()=> billing
    .filter(b=> b.due && b.due.startsWith(mesKey) && (b.status==='Programada'||EMIT.includes(b.status)))
    .sort((a,b)=>(a.due||'')>(b.due||'')?1:-1)
  ,[billing,mesKey])
  const visibles = items.filter(b=> estado==='todos' ? true : estado==='pendientes' ? !esEmitida(b) : esEmitida(b))

  const porFacturarCLP = items.filter(b=>!esEmitida(b)).reduce((a,b)=>a+(b.amount||0),0)
  const emitidasCLP = items.filter(esEmitida).reduce((a,b)=>a+(b.amount||0),0)
  const totalCLP = porFacturarCLP + emitidasCLP
  const totalUF = ufState.uf ? totalCLP/ufState.uf : null
  const nEmit = items.filter(esEmitida).length
  const nTotal = items.length

  const toggle = async(b) => {
    setBusy(b.id)
    try{ if(esEmitida(b)) await onStatusChange(b.id,'Programada'); else await onEmitir(b) }
    catch(e){ alert('Error: '+(e.message||e)) }
    setBusy(null)
  }

  const descargarExcel = async() => {
    if(items.length===0){ alert('No hay facturas en el mes seleccionado.'); return }
    setDesc(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const header=['Cliente','Concepto','Monto','Estado','Vencimiento']
      const rows=items.map(b=>{ const c=clients.find(x=>x.id===b.client_id); return [c?.name||'Sin cliente', b.concept||'', b.amount||0, esEmitida(b)?'Emitida':'Por facturar', b.due||''] })
      const ws=XLSX.utils.aoa_to_sheet([header,...rows])
      ws['!cols']=[{wch:26},{wch:34},{wch:14},{wch:14},{wch:14}]
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Facturar')
      XLSX.writeFile(wb,`Facturar_${mesKey}.xlsx`)
    }catch(e){ alert('Error al generar Excel: '+e.message) }
    setDesc(false)
  }

  const years=[...new Set(billing.map(b=>b.due?.slice(0,4)).filter(Boolean))]
  if(!years.includes(String(now.getFullYear()))) years.push(String(now.getFullYear()))
  years.sort((a,b)=>b-a)
  const selStyle = {padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12,outline:'none'}

  return (
    <div>
      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:10}}>Facturar en {MESES[parseInt(month,10)-1]} {year}</div>

      {/* Filtros: mes/año + estado */}
      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
        <select value={month} onChange={e=>setMonth(e.target.value)} style={selStyle}>
          {MESES.map((m,i)=><option key={i+1} value={String(i+1).padStart(2,'0')}>{m}</option>)}
        </select>
        <select value={year} onChange={e=>setYear(e.target.value)} style={selStyle}>
          {years.map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          {[['todos','Todos'],['pendientes','Pendientes'],['emitidos','Emitidos']].map(([v,l])=>(
            <button key={v} onClick={()=>setEstado(v)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${estado===v?C.accent:C.border}`,background:estado===v?'#E6EEF1':'transparent',color:estado===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
        <div style={{background:'#FEF6EE',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>Por facturar</div>
          <div style={{fontSize:13,fontWeight:700,color:'#C77F18'}}>{fmt(porFacturarCLP)}</div>
        </div>
        <div style={{background:'#E4F1EA',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>Ya emitidas</div>
          <div style={{fontSize:13,fontWeight:700,color:'#0F6E56'}}>{fmt(emitidasCLP)}</div>
        </div>
        <div style={{background:'#E6EEF1',borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>Total mes (UF)</div>
          <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{totalUF!=null?fmtUF(totalUF):'—'}</div>
          <div style={{marginTop:4}}><UFStamp {...ufState}/></div>
        </div>
      </div>

      {/* Checklist */}
      <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:12}}>
        {visibles.length===0&&<div style={{color:C.muted,textAlign:'center',padding:28,fontSize:12}}>Sin facturas para este filtro</div>}
        {visibles.map(b=>{
          const c=clients.find(x=>x.id===b.client_id)
          const emitida=esEmitida(b)
          return (
            <div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:`1px solid ${C.border}`,background:'#fff',opacity:emitida?.55:1}}>
              <button onClick={()=>toggle(b)} disabled={busy===b.id} title={emitida?'Marcar como no emitida':'Marcar como emitida'}
                style={{width:22,height:22,borderRadius:5,border:`2px solid ${emitida?C.normal:C.border}`,background:emitida?C.normal:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,padding:0}}>
                {emitida&&<span style={{display:'inline-block',width:5,height:9,borderRight:'2px solid #fff',borderBottom:'2px solid #fff',transform:'rotate(45deg)',marginTop:-2}}/>}
              </button>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,textDecoration:emitida?'line-through':'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c?.name||'Sin cliente'}</div>
                <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'(sin concepto)'} · Vence {b.due?fmtDate(b.due):'—'}</div>
              </div>
              <div style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,textDecoration:emitida?'line-through':'none'}}>{fmt(b.amount)}</div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:12,color:C.muted}}>{nEmit} de {nTotal} emitidas</div>
        <button onClick={descargarExcel} disabled={desc} style={{padding:'8px 14px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:desc?'default':'pointer',opacity:desc?.6:1}}>{desc?'Generando...':'Descargar Excel'}</button>
      </div>
    </div>
  )
}

// Modal de sincronización con el SII — Fase 1: lee el Registro de Ventas y
// concilia Programadas -> Pendientes vía la Edge Function sii-sync (solo admin).
// Tres puntos pulsantes mientras el SII responde
function SiiDots(){
  const [a,setA] = useState(0)
  useEffect(()=>{ const id=setInterval(()=>setA(x=>(x+1)%3),280); return ()=>clearInterval(id) },[])
  return <div style={{display:'flex',gap:6,justifyContent:'center',padding:'22px 20px'}}>{[0,1,2].map(i=>(<div key={i} style={{width:7,height:7,borderRadius:'50%',background:'#003C50',opacity:a===i?1:.15,transition:'opacity .15s'}}/>))}</div>
}
const MESES_ABR = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_LG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function SiiSyncModal({onClose,onRefresh,clients=[],clientEntities=[]}) {
  const hoy = new Date()
  const [mes,setMes] = useState(`${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`)
  const [loading,setLoading] = useState(false)
  const [result,setResult] = useState(null)
  const [error,setError] = useState('')
  const [ingresando,setIngresando] = useState(null)        // folio en curso
  const [ingresadas,setIngresadas] = useState(()=>({}))    // folio -> {cliente|null}
  const [yaOpen,setYaOpen] = useState(false)
  const [yy,mm] = mes.split('-').map(Number)
  const mesLabel = `${MESES_ABR[mm-1]} ${yy}`
  const mesLargo = `${MESES_LG[mm-1]} ${yy}`
  const cambiarMes = d => { const dt=new Date(yy,mm-1+d,1); setMes(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`) }

  // Resuelve el cliente de una factura huerfana igual que la carga de PDFs:
  // RUT en vinculos aprendidos -> nombre en vinculos -> RUT en clientes -> nombre en clientes.
  const normRut = r => (r||'').toString().replace(/[.\s]/g,'').replace(/-/g,'').toUpperCase()
  // "96713940-8" -> "96.713.940-8" (solo formato visual)
  const fmtRut = r => { if(!r) return ''; const [n,dv]=String(r).replace(/\./g,'').split('-'); return n? n.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(dv!==undefined?'-'+dv:'') : String(r) }
  const resolverCliente = (rut,nombre) => {
    const nr = normRut(rut)
    if(nr){ const ce=clientEntities.find(e=>normRut(e.rut)===nr); const c=ce&&clients.find(c=>c.id===ce.client_id); if(c) return c }
    if(nombre){ const ce=clientEntities.find(e=>e.name?.toLowerCase()===nombre.toLowerCase()); const c=ce&&clients.find(c=>c.id===ce.client_id); if(c) return c }
    if(nr){ const c=clients.find(c=>normRut(c.rut)===nr); if(c) return c }
    if(nombre){ const c=clients.find(c=>c.name?.toLowerCase()===nombre.toLowerCase()); if(c) return c }
    return null
  }
  // Crea el cobro en billing desde la factura del SII. Si reconoce el cliente, vincula
  // y aprende el RUT para siempre; si no, lo deja sin cliente para asignarlo en Facturacion.
  const ingresarHuerfana = async(it) => {
    setIngresando(it.folio); setError('')
    try{
      const cli = resolverCliente(it.rut,it.receptor)
      await upsertBilling({
        client_id: cli?.id||null,
        concept: 'Honorarios',
        receptor_name: it.receptor||null,
        receptor_rut: it.rut||null,
        amount: it.monto,
        status: 'Pendiente',
        invoice_no: String(it.folio),
        issued_at: it.fechaEmision,
        due: dueFromIssued(it.fechaEmision),
        billing_type: 'honorarios',
        sii_tipo_dte: it.tipoDte||null,
        sii_synced_at: new Date().toISOString(),
        notes: null,
      })
      if(cli){
        await reconcileProgramada(cli.id, it.monto, it.fechaEmision)
        if(it.rut) await supabase.from('client_entities').upsert({client_id:cli.id,rut:it.rut,name:it.receptor||null},{onConflict:'rut'})
      }
      setIngresadas(p=>({...p,[it.folio]:{cliente:cli?.name||null}}))
      if(onRefresh) await onRefresh()
    }catch(e){
      setError(e.message?.includes('duplicate')?`F° ${it.folio} ya estaba registrada`:`No se pudo ingresar F° ${it.folio}: ${e.message}`)
    }
    setIngresando(null)
  }
  const ingresarTodas = async() => { for(const it of (result?.sinMatch||[])){ if(!ingresadas[it.folio]) await ingresarHuerfana(it) } }

  const [corrigiendo,setCorrigiendo] = useState(null)        // billingId en curso
  const [corregidas,setCorregidas] = useState(()=>({}))      // billingId -> true
  // Asigna el folio real del SII a una venta ya emitida que tenia folio manual o sin folio.
  const aplicarCorreccion = async(it) => {
    setCorrigiendo(it.billingId); setError('')
    try{
      const {error} = await supabase.from('billing').update({
        invoice_no: String(it.folio),
        issued_at: it.fechaEmision,
        sii_tipo_dte: it.tipoDte||null,
        sii_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', it.billingId)
      if(error) throw error
      setCorregidas(p=>({...p,[it.billingId]:true}))
      if(onRefresh) await onRefresh()
    }catch(e){ setError(`No se pudo corregir F° ${it.folio}: ${e.message}`) }
    setCorrigiendo(null)
  }

  const llamar = async(body) => {
    const {data:{session}} = await supabase.auth.getSession()
    if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
    const res = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-sync',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey},
      body:JSON.stringify(body)
    })
    const data = await res.json().catch(()=>({}))
    if(!res.ok){ const err=new Error(data.error||('Error '+res.status)); err.detalle=data.detalle||''; throw err }
    return data
  }
  const msgErr = e => e.detalle&&e.detalle!==e.message ? `${e.message} — ${e.detalle}` : e.message
  const sincronizar = async() => {
    setLoading(true); setError(''); setResult(null)
    try{
      const data = await llamar({periodo:mes})
      setResult(data)
      if(data.actualizadas?.length&&onRefresh) await onRefresh()
    }catch(e){ setError(msgErr(e)) }
    setLoading(false)
  }
  const vacio = result&&!result.actualizadas?.length&&!result.corregirFolio?.length&&!result.ambiguas?.length&&!result.sinMatch?.length&&!result.errores?.length
  const reg = result?.yaRegistradas||[]
  const Hdr = ({label,color,bg,border,right}) => (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 20px',background:bg,borderBottom:`0.5px solid ${border||'#E4E8EB'}`}}>
      <span style={{fontSize:11,fontWeight:600,color,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</span>
      {right}
    </div>
  )
  const Fila = ({children}) => <div style={{display:'flex',alignItems:'center',padding:'11px 20px',borderBottom:'0.5px solid #E4E8EB'}}>{children}</div>
  const CheckVerde = () => <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><polyline points='20 6 9 17 4 12'/></svg>
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:14,maxWidth:480,width:'100%',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.18)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'16px 20px',borderBottom:'0.5px solid #E4E8EB',position:'sticky',top:0,background:'#fff',zIndex:1}}>
          <span style={{fontSize:15,fontWeight:500,color:'#1a1a1a'}}>Sincronizar SII</span>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:6,border:'0.5px solid #E4E8EB',background:'none',color:'#537281',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round'><line x1='6' y1='6' x2='18' y2='18'/><line x1='18' y1='6' x2='6' y2='18'/></svg>
          </button>
        </div>
        <div style={{display:'flex',gap:10,padding:'14px 20px',borderBottom:'0.5px solid #E4E8EB'}}>
          <div style={{display:'flex',border:'0.5px solid #E4E8EB',borderRadius:8,overflow:'hidden',flex:1,height:36}}>
            <button onClick={()=>cambiarMes(-1)} style={{width:32,border:'none',background:'none',color:'#537281',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg></button>
            <span style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:500,color:'#1a1a1a'}}>{mesLabel}</span>
            <button onClick={()=>cambiarMes(1)} style={{width:32,border:'none',background:'none',color:'#537281',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='9 18 15 12 9 6'/></svg></button>
          </div>
          <button onClick={sincronizar} disabled={loading} style={{height:36,padding:'0 18px',background:loading?'#99ABB4':'#003C50',color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:500,cursor:loading?'default':'pointer',whiteSpace:'nowrap'}}>{loading?'Consultando…':'Sincronizar'}</button>
        </div>
        {error&&<div style={{padding:'10px 20px',fontSize:12,color:C.overdue,background:'#FCEBEB'}}>{error}</div>}
        {loading&&<SiiDots/>}
        {result&&!loading&&<>
          {vacio
            ? <div style={{display:'flex',gap:12,padding:'16px 20px',alignItems:'center'}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'#E1F5EE',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><CheckVerde/></div>
                <div>
                  <div style={{fontSize:13,fontWeight:500,color:'#1D9E75'}}>{mesLargo} al día</div>
                  <div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>{reg.length} factura{reg.length!==1?'s':''} ya registrada{reg.length!==1?'s':''}</div>
                </div>
              </div>
            : <>
                {result.actualizadas?.length>0&&<>
                  <Hdr label='Conciliadas' color='#0F6E56' bg='#EFFAF5'/>
                  {result.actualizadas.map((it,i)=><Fila key={i}><div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:500,color:'#1a1a1a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.cliente}</div><div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>F° {it.folio}</div></div><span style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginLeft:'auto',marginRight:8,whiteSpace:'nowrap'}}>{fmt(it.monto)}</span><CheckVerde/></Fila>)}
                </>}
                {result.corregirFolio?.length>0&&<>
                  <Hdr label='Corregir folio' color={C.accent} bg='#EEF4F7'/>
                  {result.corregirFolio.map((it,i)=>{ const ya=corregidas[it.billingId]; return <Fila key={i}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:'#1a1a1a',textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||it.cliente||'—'}</div>
                      <div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>{it.folioActual?`F° ${it.folioActual} → ${it.folio}`:`Asignar F° ${it.folio}`}{it.rut?` · ${fmtRut(it.rut)}`:''}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginLeft:'auto',marginRight:12,whiteSpace:'nowrap'}}>{fmt(it.monto)}</span>
                    {ya?<span style={{fontSize:11,fontWeight:500,color:C.normal,whiteSpace:'nowrap'}}>Corregido</span>:<button onClick={()=>aplicarCorreccion(it)} disabled={corrigiendo===it.billingId} style={{height:26,padding:'0 12px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:11,fontWeight:500,cursor:'pointer',flexShrink:0,opacity:corrigiendo===it.billingId?.5:1}}>{corrigiendo===it.billingId?'…':'Corregir'}</button>}
                  </Fila> })}
                </>}
                {result.sinMatch?.length>0&&<>
                  <Hdr label='Ventas no cargadas' color='#B8860B' bg='#FFFBF0' border='#F0E4B8' right={result.sinMatch.length>1&&<button onClick={ingresarTodas} style={{height:26,padding:'0 12px',borderRadius:8,background:'#003C50',color:'#fff',border:'none',fontSize:11,fontWeight:500,cursor:'pointer'}}>+ Asignar todas</button>}/>
                  {result.sinMatch.map((it,i)=>{ const ya=ingresadas[it.folio]; return <Fila key={i}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:'#1a1a1a',textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||'—'}</div>
                      <div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>F° {it.folio}{it.rut?` · ${fmtRut(it.rut)}`:''}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:500,color:'#1a1a1a',marginLeft:'auto',marginRight:12,whiteSpace:'nowrap'}}>{fmt(it.monto)}</span>
                    {ya?<span style={{fontSize:11,fontWeight:500,color:C.normal,whiteSpace:'nowrap'}}>{ya.cliente?'Asignada':'Asigna cliente'}</span>:<button onClick={()=>ingresarHuerfana(it)} disabled={ingresando===it.folio} style={{height:26,padding:'0 12px',borderRadius:8,background:'#537281',color:'#fff',border:'none',fontSize:11,fontWeight:500,cursor:'pointer',flexShrink:0,opacity:ingresando===it.folio?.5:1}}>{ingresando===it.folio?'…':'+ Asignar'}</button>}
                  </Fila> })}
                </>}
                {result.ambiguas?.length>0&&<>
                  <Hdr label='Revisión manual' color='#537281' bg='#EEF1F4'/>
                  {result.ambiguas.map((it,i)=><Fila key={i}><div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:500,color:'#1a1a1a'}}>F° {it.folio} · {it.candidatos?.length} candidatos</div><div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>{fmtRut(it.rut)}</div></div><span style={{fontSize:13,fontWeight:500,color:'#1a1a1a',whiteSpace:'nowrap'}}>{fmt(it.monto)}</span></Fila>)}
                </>}
                {result.errores?.length>0&&<>
                  <Hdr label='Errores' color={C.overdue} bg='#FCEBEB'/>
                  {result.errores.map((it,i)=><Fila key={i}><span style={{fontSize:12,color:'#1a1a1a'}}>F° {it.folio}</span><span style={{fontSize:11,color:C.overdue,marginLeft:'auto'}}>{it.error}</span></Fila>)}
                </>}
              </>}
          {reg.length>0&&<>
            <div onClick={()=>setYaOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 20px',cursor:'pointer'}}>
              <span style={{fontSize:11,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.05em'}}>Ya registradas</span>
              <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{transform:yaOpen?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points='6 9 12 15 18 9'/></svg>
            </div>
            {yaOpen&&reg.map((it,i)=>{ const cli=resolverCliente(it.rut,it.receptor); return (
              <div key={i} style={{padding:'10px 20px',borderBottom:'0.5px solid #E4E8EB',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:'#537281',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cli?.name||it.receptor||'—'}</div>
                  <div style={{fontSize:11,color:'#99ABB4',marginTop:1}}>{it.receptor||''}{it.rut?` · ${fmtRut(it.rut)}`:''}</div>
                  <div style={{fontSize:11,color:'#99ABB4'}}>F° {it.folio}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  <span style={{fontSize:12,fontWeight:500,color:'#537281',whiteSpace:'nowrap'}}>{fmt(it.monto)}</span>
                  <CheckVerde/>
                </div>
              </div>
            )})}
          </>}
        </>}
      </div>
    </div>
  )
}

function BillingView({billing,clients,sales,clientEntities,anticipos=[],terceros=[],onNuevoAnticipo,onProveedores,onConciliarTerceros,onStatusChange,onDelete,onAdd,onEdit,onImport,onUpload,onAssignClient,onEmitir,onAnular,onRefresh}) {
  const [siiOpen,setSiiOpen] = useState(false)
  const [anulando,setAnulando] = useState(null)        // factura en flujo de baja
  const [motivoBaja,setMotivoBaja] = useState('')
  const [obsBaja,setObsBaja] = useState('')
  const MOTIVOS_BAJA = ['Servicio no prestado','Cliente canceló el servicio','Error al programar','Facturado por otro medio','Otro']
  const confirmarBaja = async() => { if(!motivoBaja||!anulando) return; await onAnular(anulando,motivoBaja,obsBaja); setAnulando(null); setMotivoBaja(''); setObsBaja('') }
  const [filter,setFilter] = useState('emitidas')
  const [fYear,setFYear] = useState('')
  const [fMonth,setFMonth] = useState('')
  const [q,setQ] = useState('')
  const [payingId,setPayingId] = useState(null)
  const [payDate,setPayDate] = useState('')
  const [inclTerceros,setInclTerceros] = useState(true)   // al pagar la factura ancla: ¿el pago incluyó los terceros?
  const [menuBill,setMenuBill] = useState(null)   // id de la factura con el menú ⋯ abierto
  useEffect(()=>{ if(!menuBill) return; const h=()=>setMenuBill(null); document.addEventListener('click',h); return ()=>document.removeEventListener('click',h) },[menuBill])
  const fmtDMY = iso => { if(!iso) return '—'; const p=iso.slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:iso }
  const [openClients,setOpenClients] = useState(()=>new Set())
  const toggleClient = id => setOpenClients(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const collapseAll = () => setOpenClients(new Set())
  const [selected,setSelected] = useState(()=>new Set())
  const toggleSel = id => setSelected(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const clearSel = () => setSelected(new Set())
  const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  // Rediseño tab Emitidas: dos acordeones maestros (cerrados por defecto)
  const [openPendiente,setOpenPendiente] = useState(false)
  const [openPorFacturar,setOpenPorFacturar] = useState(false)
  const [selExcel,setSelExcel] = useState(()=>new Set())   // filas marcadas para el Excel (Bloque 2)
  const [emitiendo,setEmitiendo] = useState(null)          // id de la programada en flujo "Ya emitida"
  const [emitEnt,setEmitEnt] = useState('')                // entity_id elegido en "Ya emitida"
  const [descExcel,setDescExcel] = useState(false)

  const bb = billing.filter(b=>b.billing_type!=='reembolso')   // Facturación excluye reembolsos de gastos
  // Cuentas por pagar a colaboradores ancladas a cada factura (terceros_pagos.billing_id)
  const tercerosByBilling = useMemo(()=>{
    const m = new Map()
    for(const t of (terceros||[])){ if(!t.billing_id) continue; if(!m.has(t.billing_id)) m.set(t.billing_id,[]); m.get(t.billing_id).push(t) }
    return m
  },[terceros])
  const isProg = filter==='programadas'
  // En Programadas la fecha relevante es el vencimiento (due); en el resto, la emisión (issued_at)
  const dateField = b => isProg ? b.due : b.issued_at
  const filtered = useMemo(()=>{
    let r = bb
    if(filter==='emitidas') r = r.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status))
    else if(filter==='programadas') r = r.filter(b=>b.status==='Programada')
    else if(filter==='pagado') r = r.filter(b=>b.status==='Pagado')
    else if(filter==='terceros') r = r.filter(b=>tercerosByBilling.has(b.id))
    if(fYear) r = r.filter(b=>dateField(b)?.startsWith(fYear))
    if(fMonth) r = r.filter(b=>dateField(b)?.slice(5,7)===fMonth)
    if(q.trim()) r = r.filter(b=>{
      const c=clients.find(x=>x.id===b.client_id)
      return c?.name.toLowerCase().includes(q.toLowerCase())||b.concept?.toLowerCase().includes(q.toLowerCase())||b.invoice_no?.toLowerCase().includes(q.toLowerCase())||b.receptor_name?.toLowerCase().includes(q.toLowerCase())
    })
    return r.sort((a,b)=> isProg
      ? new Date(a.due||0)-new Date(b.due||0)
      : new Date(b.issued_at||0)-new Date(a.issued_at||0))
  },[bb,filter,fYear,fMonth,q,clients,isProg,tercerosByBilling])

  // Agrupar por cliente → razón social
  const grouped = useMemo(()=>{
    const byClient = {}
    filtered.forEach(b=>{
      const cid = b.client_id||'__none__'
      if(!byClient[cid]) byClient[cid] = {client:clients.find(c=>c.id===cid)||{id:'__none__',name:'Sin cliente'}, byEntity:{}}
      const ename = b.receptor_name||'—'
      if(!byClient[cid].byEntity[ename]) byClient[cid].byEntity[ename] = []
      byClient[cid].byEntity[ename].push(b)
    })
    return Object.values(byClient).sort((a,b)=>a.client.name.localeCompare(b.client.name,'es'))
  },[filtered,clients])

  const pending=bb.filter(b=>b.status==='Pendiente').reduce((s,b)=>s+(b.amount||0),0)
  const overdue=bb.filter(b=>b.status==='Vencido').reduce((s,b)=>s+(b.amount||0),0)
  const paid=bb.filter(b=>b.status==='Pagado').reduce((s,b)=>s+(b.amount||0),0)
  const programado=bb.filter(b=>b.status==='Programada').reduce((s,b)=>s+(b.amount||0),0)
  // Contadores por nº de documentos para las tabs
  const nEmitidas=bb.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status)).length
  const nProgramadas=bb.filter(b=>b.status==='Programada').length
  const nPagadas=bb.filter(b=>b.status==='Pagado').length
  const years=[...new Set(bb.map(b=>b.issued_at?.slice(0,4)).filter(Boolean))].sort((a,b)=>b-a)

  const handleTogglePagado = async(b) => {
    if(b.status==='Pagado') { await onStatusChange(b.id,'Pendiente',null) }
    else { setPayingId(b.id); setPayDate(new Date().toISOString().slice(0,10)); setInclTerceros(true) }
  }
  const confirmPago = async() => {
    const pend = (terceros||[]).filter(t=>String(t.billing_id)===String(payingId)&&t.estado==='pendiente')
    await onStatusChange(payingId,'Pagado',payDate)
    if(pend.length&&inclTerceros&&onConciliarTerceros) await onConciliarTerceros(payingId)
    setPayingId(null)
  }
  // Unificado a "convertir": la cuota programada pasa a emitida (Pendiente de cobro), no se borra.
  const emitirConRS = async(b) => { const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id); const ent=b.entity_id?ents.find(e=>e.id===b.entity_id):(ents.length===1?ents[0]:null); await onEmitir(b, ent||null) }
  const marcarEmitida = async(b) => { if(confirm('¿Confirmas que la factura ya se emitió? Pasará a Pendiente de cobro.')) await emitirConRS(b) }
  const marcarEmitidasBulk = async() => { const ids=[...selected]; if(!ids.length) return; if(!confirm(`¿Marcar ${ids.length} factura(s) como emitidas? Pasarán a Pendiente de cobro.`)) return; for(const id of ids){ const b=progMes.find(x=>x.id===id); if(b) await emitirConRS(b) } clearSel() }

  const [descargando,setDescargando] = useState(false)
  const descargarProgramadas = async() => {
    if(filtered.length===0){ alert('No hay programadas en el filtro actual.'); return }
    setDescargando(true)
    try{
      // UF del día vía el helper único (caché diario). Si falla, cae al último cacheado o sin "Monto hoy".
      const ufInfo = await fetchUF()
      const ufHoy = ufInfo.value
      const ufNota = ufHoy!=null ? `Monto hoy ($) · UF ${Math.round(ufHoy).toLocaleString('es-CL')}${ufInfo.isToday?'':' (no actualizada)'}` : 'Monto hoy ($)'
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const header = ['Cliente','Razón social','RUT','Proyecto','UF','Monto guardado ($)', ufNota,'Vencimiento']
      const rows = filtered.map(b=>{
        const c = clients.find(x=>x.id===b.client_id)
        const venta = (sales||[]).find(v=>v.id===b.sale_id)
        const esCLP = venta?.moneda==='CLP'
        const ufVal = venta?.uf_value || null
        const ufEq = (!esCLP && ufVal) ? (b.amount/ufVal) : null
        const montoHoy = esCLP ? (b.amount||0) : ((ufEq && ufHoy) ? Math.round(ufEq*ufHoy) : null)
        // Razon social + RUT desde client_entities (fuente unica)
        const ents = (clientEntities||[]).filter(e=>e.client_id===b.client_id)
        let rs = null
        if(b.entity_id) rs = ents.find(e=>e.id===b.entity_id) || null
        else if(ents.length===1) rs = ents[0]
        const rsName = rs ? rs.name : (ents.length>1 ? 'definir razón social' : (b.receptor_name||''))
        const rsRut = rs ? (rs.rut||'') : (b.entity_id?'':(ents.length>1?'':(b.receptor_rut||'')))
        return [
          c?.name || 'Sin cliente',
          rsName,
          rsRut,
          venta?.title || b.concept || '',
          esCLP ? '—' : (ufEq ? Number(ufEq.toFixed(2)) : ''),
          b.amount || 0,
          montoHoy ?? '',
          b.due || '',
        ]
      })
      // Fila de totales
      const totalGuardado = rows.reduce((a,r)=>a+(Number(r[5])||0),0)
      const totalHoy = rows.reduce((a,r)=>a+(Number(r[6])||0),0)
      rows.push([])
      rows.push(['','','','TOTAL','', totalGuardado, totalHoy||'', ''])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
      ws['!cols'] = [{wch:24},{wch:26},{wch:14},{wch:30},{wch:10},{wch:16},{wch:18},{wch:14}]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Programadas')
      const mesLbl = fMonth ? `_${MONTHS[parseInt(fMonth)-1]}` : ''
      const anioLbl = fYear ? `_${fYear}` : ''
      XLSX.writeFile(wb, `Programadas${mesLbl}${anioLbl}_${new Date().toISOString().slice(0,10)}.xlsx`)
    }catch(e){ alert('Error al generar Excel: '+e.message) }
    setDescargando(false)
  }

  // ── Bloque 1 (PENDIENTE PAGO): total y conteo desde el mismo `filtered` (single source) ──
  const emitidasTotal = useMemo(()=>filtered.reduce((a,b)=>a+(b.amount||0),0),[filtered])

  // ── Bloque 2 (POR FACTURAR): todas las programadas pendientes; acotables por año/mes (vencimiento) y texto ──
  const mesKey = `${currentYear}-${String(currentMonth).padStart(2,'0')}`
  const progMes = useMemo(()=>{
    let r = bb.filter(b=>b.status==='Programada'&&b.due)
    if(fYear) r = r.filter(b=>b.due?.startsWith(fYear))
    if(fMonth) r = r.filter(b=>b.due?.slice(5,7)===fMonth)
    if(q.trim()) r = r.filter(b=>{
      const c=clients.find(x=>x.id===b.client_id)
      return (c?.name?.toLowerCase().includes(q.toLowerCase()))||(b.receptor_name?.toLowerCase().includes(q.toLowerCase()))
    })
    return r.sort((a,b)=>(a.due||'')>(b.due||'')?1:-1)
  },[bb,fYear,fMonth,q,clients])
  const progMesTotal = useMemo(()=>progMes.reduce((a,b)=>a+(b.amount||0),0),[progMes])
  // Por defecto, todas marcadas; se re-sincroniza si cambia la membresía del mes
  const progIds = progMes.map(b=>b.id).join(',')
  useEffect(()=>{ setSelExcel(new Set()) },[progIds])
  const toggleExcel = id => setSelExcel(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const allExcel = progMes.length>0 && selExcel.size===progMes.length

  // Resuelve razón social + RUT de un cobro (misma lógica que el export de programadas)
  const resolveRS = (b) => {
    const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id)
    let rs=null
    if(b.entity_id) rs=ents.find(e=>e.id===b.entity_id)||null
    else if(ents.length===1) rs=ents[0]
    const name=rs?rs.name:(ents.length>1?'definir razón social':(b.receptor_name||''))
    const rut=rs?(rs.rut||''):(b.receptor_rut||'')
    return {name,rut}
  }

  const descargarPorFacturar = async() => {
    const sel = progMes.filter(b=>selExcel.has(b.id))
    if(!sel.length){ alert('Marca al menos una fila para exportar.'); return }
    setDescExcel(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const ufInfo = await fetchUF()
      const ufActual = ufInfo.value
      const header=['Cliente','Razón social','RUT receptor','Concepto/glosa','Monto neto','Monto UF','Fecha vencimiento','N° cuota']
      const rows=sel.map(b=>{
        const c=clients.find(x=>x.id===b.client_id)
        const venta=(sales||[]).find(v=>v.id===b.sale_id)
        const esCLP=venta?.moneda==='CLP'
        const ufVal=ufActual||null
        const ufEq=(!esCLP&&ufVal)?(b.amount/ufVal):null
        const rs=resolveRS(b)
        return [c?.name||'Sin cliente', rs.name, rs.rut, b.concept||venta?.title||'', b.amount||0, esCLP?'—':(ufEq?Number(ufEq.toFixed(2)):''), b.due||'', parseCuota(b.concept)]
      })
      const totalNeto=rows.reduce((a,r)=>a+(Number(r[4])||0),0)
      rows.push([]); rows.push(['','','','TOTAL', totalNeto,'','',''])
      const ws=XLSX.utils.aoa_to_sheet([header,...rows])
      ws['!cols']=[{wch:24},{wch:26},{wch:14},{wch:32},{wch:14},{wch:10},{wch:14},{wch:9}]
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Por facturar')
      XLSX.writeFile(wb,`Por_facturar_${mesKey}_${new Date().toISOString().slice(0,10)}.xlsx`)
    }catch(e){ alert('Error al generar Excel: '+e.message) }
    setDescExcel(false)
  }

  // "Ya emitida" (respaldo manual): convierte la programada en emitida + asigna razón social
  const confirmarEmitida = async(b) => {
    const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id)
    const ent = emitEnt ? ents.find(e=>e.id===emitEnt) : (ents.length===1?ents[0]:null)
    await onEmitir(b, ent||null)
    setEmitiendo(null); setEmitEnt('')
  }

  // Render de un grupo cliente→razón social (reutilizado por el Bloque 1 y por las otras tabs)
  const renderClientGroup = ({client,byEntity}) => {
    const allBills = Object.values(byEntity).flat()
    const clientTotal = allBills.reduce((a,b)=>a+(b.amount||0),0)
    const nDocs = allBills.length
    const vencidoMonto = allBills.filter(b=>b.status==='Vencido').reduce((a,b)=>a+(b.amount||0),0)
    const isOpen = openClients.has(client.id)
    return (
      <div key={client.id} style={{marginBottom:isOpen?16:8}}>
        <button onClick={()=>toggleClient(client.id)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isOpen?6:0,paddingBottom:4,borderBottom:`2px solid ${C.accent}`,background:'none',border:'none',borderBottomColor:C.accent,cursor:'pointer',textAlign:'left'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            <span style={{fontSize:12,color:C.accent,transform:isOpen?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}>▸</span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client.name}</div>
              {!isOpen&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{nDocs} doc{nDocs!==1?'s':''}{vencidoMonto>0&&<span style={{color:C.overdue,fontWeight:700}}> · {fmt(vencidoMonto)} vencido</span>}</div>}
            </div>
          </div>
          <div style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(clientTotal)}</div>
        </button>
        {isOpen&&Object.entries(byEntity).map(([ename,bills])=>(
          <div key={ename} style={{marginBottom:10,marginLeft:8}}>
            {ename!=='—'&&<div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{width:4,height:4,borderRadius:'50%',background:C.muted,display:'inline-block'}}/>
                {ename}
              </div>
              <span style={{fontSize:11,fontWeight:700,color:C.muted}}>{fmt(bills.reduce((a,b)=>a+(b.amount||0),0))}</span>
            </div>}
            {bills.map(b=>{
              const prog=b.status==='Programada', anulada=b.status==='Anulada', pagado=b.status==='Pagado'
              const dl=daysLeft(b.due)
              const dEmis=b.issued_at?Math.max(0,Math.round((Date.now()-new Date(b.issued_at+'T12:00').getTime())/86400000)):null
              const semCol=pagado?C.muted:(dl==null?C.muted:dl<0?C.overdue:dl<=7?'#B8860B':C.normal)
              const semTxt=prog?(dl!=null?(dl<0?`${Math.abs(dl)} días vencida`:`vence en ${dl} días`):''):((dl!=null&&dl<0)?`${Math.abs(dl)} días vencida`:(dEmis!=null?`${dEmis} días`:''))
              return (
              <div key={b.id} style={{position:'relative',background:C.card,borderRadius:10,padding:'11px 13px',marginBottom:6,border:`1px solid ${C.border}`}}>
                {/* línea 1: concepto + monto */}
                <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  {prog&&<input type='checkbox' checked={selected.has(b.id)} onChange={()=>toggleSel(b.id)} style={{marginTop:3,flexShrink:0,cursor:'pointer'}}/>}
                  <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:500,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',textDecoration:anulada?'line-through':'none'}}>{b.concept||'—'}</div>
                  <div style={{fontSize:15,fontWeight:700,color:(dl!=null&&dl<0&&!pagado)?C.overdue:C.text,whiteSpace:'nowrap',flexShrink:0}}>{fmt(b.amount)}</div>
                </div>
                {/* línea 2: factura n° + fecha */}
                <div style={{fontSize:11,color:'#99ABB4',marginTop:4}}>{prog?`Facturar: ${fmtDMY(b.due)}`:`Factura N° ${b.invoice_no||'—'} · Fecha: ${fmtDMY(b.issued_at)}`}</div>
                {/* línea 3: semáforo + tags | acciones */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,marginTop:7}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',minWidth:0}}>
                    {semTxt&&<span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,color:C.muted}}><span style={{width:8,height:8,borderRadius:'50%',background:semCol,flexShrink:0}}/>{semTxt}</span>}
                    {pagado&&b.paid_at&&<span style={{fontSize:11,fontWeight:600,color:C.normal}}>Pagada {fmtDMY(b.paid_at)}</span>}
                    {b.billing_type==='reembolso'&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:'#F2E9DE',color:'#C77F18',fontWeight:600}}>Reembolso</span>}
                    {anulada&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:'#FBE9E7',color:C.overdue,fontWeight:600}}>Anulada</span>}
                    {tercerosByBilling.has(b.id)&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:10,background:'#E6EEF1',color:C.accent,fontWeight:600}}>Terceros</span>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    {client.id==='__none__'&&onAssignClient&&!prog&&<AsignarClienteInline bill={b} clients={clients} onAssign={onAssignClient}/>}
                    {prog ? (
                      selected.size===0&&<button onClick={()=>marcarEmitida(b)} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#E6EEF1',border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>Ya emitida</button>
                    ):(!anulada&&!pagado)&&(
                      <button onClick={()=>{setPayingId(b.id);setPayDate(new Date().toISOString().slice(0,10));setInclTerceros(true)}} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#E6EEF1',border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>Registrar pago</button>
                    )}
                    <button onClick={(e)=>{e.stopPropagation();setMenuBill(menuBill===b.id?null:b.id)}} style={{width:24,height:24,borderRadius:7,border:`1px solid ${menuBill===b.id?C.accent:C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
                      <svg width='13' height='13' viewBox='0 0 24 24' fill={menuBill===b.id?C.accent:C.muted}><circle cx='5' cy='12' r='2'/><circle cx='12' cy='12' r='2'/><circle cx='19' cy='12' r='2'/></svg>
                    </button>
                  </div>
                </div>
                {menuBill===b.id&&(
                  <div onClick={e=>e.stopPropagation()} style={{position:'absolute',top:'100%',right:13,marginTop:2,width:150,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',padding:'4px 0',zIndex:20}}>
                    <div onClick={()=>{setMenuBill(null);onEdit(b)}} style={{fontSize:13,color:C.text,padding:'9px 13px',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>Editar</div>
                    {!pagado&&!anulada&&onAnular&&<><div style={{height:'0.5px',background:C.border,margin:'2px 0'}}/><div onClick={()=>{setMenuBill(null);setAnulando(b);setMotivoBaja('');setObsBaja('')}} style={{fontSize:13,color:C.overdue,padding:'9px 13px',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='#FEF2F2'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>Anular</div></>}
                  </div>
                )}
              </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Facturación</div>
          <div style={{display:'flex',gap:6}}>
            {isProg&&<button onClick={descargarProgramadas} disabled={descargando} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:descargando?'default':'pointer',opacity:descargando?.6:1}}>{descargando?'Generando...':'↓ Programadas'}</button>}
            <button onClick={onUpload} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↑ PDFs</button>
            <button onClick={onImport} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}><DriveIcon size={13}/>Drive</button>
            <button onClick={()=>setSiiOpen(true)} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↑ SII</button>
            <button onClick={onProveedores} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>Proveedores</button>
          </div>
        </div>
        {siiOpen&&<SiiSyncModal onClose={()=>setSiiOpen(false)} onRefresh={onRefresh} clients={clients} clientEntities={clientEntities}/>}
        {filter!=='anticipos'&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:10}}>
          {[['Por cobrar',fmt(pending),'#E3EEF3',C.accent],['Programado',fmt(programado),'#E4E8EB','#537281'],['Vencido',fmt(overdue),'#FBE9E7',C.overdue],['Cobrado',fmt(paid),'#E4F1EA',C.normal]].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>}
        <div style={{display:'flex',gap:6,marginBottom:8,overflowX:'auto',scrollbarWidth:'none',msOverflowStyle:'none'}}>
          {[['emitidas','Emitidas'],['programadas','Programadas'],['pagado','Pagadas'],['all','Todas'],['terceros','Terceros'],['checklist','Checklist'],['anticipos','Anticipos']].map(([v,l])=>(
            <button key={v} onClick={()=>{setFilter(v);clearSel()}} style={{flex:'1 0 auto',padding:'7px 11px',borderRadius:8,border:`1px solid ${filter===v?C.accent:C.border}`,background:filter===v?'#E6EEF1':'transparent',color:filter===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{l}</button>
          ))}
        </div>
        {filter==='anticipos'&&<AnticiposPanel anticipos={anticipos} clients={clients} clientEntities={clientEntities} billing={billing} onNuevo={onNuevoAnticipo}/>}
        {filter!=='checklist'&&filter!=='anticipos'&&<>
        <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente, razón social, N° factura...' style={{marginBottom:6}}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:4}}>
          <select value={fYear} onChange={e=>setFYear(e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos los años</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select value={fMonth} onChange={e=>setFMonth(e.target.value)} style={{padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
            <option value=''>Todos los meses</option>
            {MONTHS.map((m,i)=><option key={i+1} value={String(i+1).padStart(2,'0')}>{m}</option>)}
          </select>
        </div>
        </>}
        {(openClients.size>0||(isProg&&selected.size>0))&&(
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:6}}>
            {isProg&&selected.size>0&&(
              <button onClick={marcarEmitidasBulk} style={{padding:'4px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>Marcar {selected.size} emitida{selected.size!==1?'s':''}</button>
            )}
            {isProg&&selected.size>0&&(
              <button onClick={clearSel} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>Deseleccionar</button>
            )}
            {openClients.size>0&&(
              <button onClick={collapseAll} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>Colapsar todo</button>
            )}
          </div>
        )}
      </div>

      {anulando&&(
        <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'flex-end',justifyContent:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:520,padding:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:4}}>Dar de baja factura</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{anulando.concept||'—'} · {fmt(anulando.amount)}</div>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:8,background:'#FBE9E7',color:C.overdue,fontSize:12,fontWeight:600,marginBottom:12}}><BanIcon size={15} color={C.overdue}/>Esta acción no se puede deshacer</div>
            <Lbl>Motivo</Lbl>
            <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:12}}>
              {MOTIVOS_BAJA.map(m=>(
                <button key={m} onClick={()=>setMotivoBaja(m)} style={{textAlign:'left',padding:'8px 11px',borderRadius:8,border:`1.5px solid ${motivoBaja===m?C.overdue:C.border}`,background:motivoBaja===m?'#FBE9E7':'transparent',color:motivoBaja===m?C.overdue:C.text,fontSize:12,fontWeight:motivoBaja===m?700:500,cursor:'pointer'}}>{m}</button>
              ))}
            </div>
            <Lbl>Observaciones (opcional)</Lbl>
            <textarea value={obsBaja} onChange={e=>setObsBaja(e.target.value)} rows={2} placeholder='Detalle adicional...' style={{width:'100%',padding:'8px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:13,color:C.text,boxSizing:'border-box',resize:'vertical',marginBottom:14,fontFamily:'inherit'}}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>{setAnulando(null);setMotivoBaja('');setObsBaja('')}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
              <button onClick={confirmarBaja} disabled={!motivoBaja} style={{flex:2,padding:11,borderRadius:10,border:'none',background:motivoBaja?C.overdue:'#ccc',color:'#fff',fontSize:13,fontWeight:700,cursor:motivoBaja?'pointer':'default'}}>Confirmar baja</button>
            </div>
          </div>
        </div>
      )}
      {payingId&&(()=>{ const pb=billing.find(b=>String(b.id)===String(payingId))||{}; return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#fff',borderRadius:16,width:'min(90vw, 340px)',overflow:'hidden'}}>
            <div style={{padding:'18px 20px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:11,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em'}}>CONFIRMAR PAGO</span>
              <button onClick={()=>setPayingId(null)} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
              </button>
            </div>
            <div style={{padding:'12px 20px 16px',borderBottom:`0.5px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:26,fontWeight:500,color:'#1a1a1a',letterSpacing:'-.5px'}}>{fmt(pb.amount)}</div>
                <div style={{fontSize:12,color:'#99ABB4',marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pb.concept||'—'}{pb.invoice_no?` · F° ${pb.invoice_no}`:''}</div>
              </div>
              <div style={{width:40,height:40,borderRadius:12,background:'#E1F5EE',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
              </div>
            </div>
            <div style={{padding:'14px 20px 10px'}}>
              <label style={{fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',marginBottom:6,display:'block'}}>FECHA DE PAGO</label>
              <input type='date' value={payDate} onChange={e=>setPayDate(e.target.value)} style={{width:'100%',border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'10px 11px',color:'#1a1a1a',outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
            </div>
            {(()=>{ const pend=(terceros||[]).filter(t=>String(t.billing_id)===String(payingId)&&t.estado==='pendiente'); if(!pend.length) return null
              const tot=pend.reduce((a,t)=>a+(t.monto||0),0)
              const nombres=pend.map(t=>t.proveedor||'colaborador').filter((v,i,a)=>a.indexOf(v)===i).join(', ')
              return (
                <div style={{margin:'4px 20px 0',padding:'11px 12px',background:'#E6EEF1',borderRadius:10}}>
                  <div onClick={()=>setInclTerceros(v=>!v)} style={{display:'flex',alignItems:'flex-start',gap:9,cursor:'pointer'}}>
                    <span style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${inclTerceros?C.accent:C.border}`,background:inclTerceros?C.accent:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                      {inclTerceros&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:600,color:C.accent}}>El pago incluyó lo de terceros</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.4}}>{nombres} · {fmt(tot)} → pasa{pend.length>1?'n':''} a <strong>Por pagar</strong>.</div>
                    </div>
                  </div>
                </div>
              )
            })()}
            <div style={{padding:'14px 20px 20px',display:'flex',gap:8}}>
              <button onClick={()=>setPayingId(null)} style={{flex:1,height:40,borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancelar</button>
              <button onClick={confirmPago} style={{flex:2,height:40,borderRadius:8,border:'none',background:C.normal,color:'#fff',fontSize:13,fontWeight:500,cursor:'pointer'}}>Confirmar pago</button>
            </div>
          </div>
        </div>
      )})()}

      <div style={{padding:'10px 20px 100px'}}>
        {filter==='checklist' ? (
          <ChecklistFacturacion billing={billing} clients={clients} onEmitir={onEmitir} onStatusChange={onStatusChange}/>
        ) : filter==='emitidas' ? (
          <>
            {/* BLOQUE 1 — PENDIENTE PAGO (acordeón maestro) */}
            <button onClick={()=>setOpenPendiente(o=>!o)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'#F7F8F9',cursor:'pointer',textAlign:'left',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                <span style={{fontSize:12,color:C.accent,transform:openPendiente?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}>▸</span>
                <span style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Pendiente pago</span>
                <span style={{fontSize:11,color:C.muted}}>· {filtered.length} factura{filtered.length!==1?'s':''}</span>
              </div>
              <span style={{fontSize:14,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(emitidasTotal)}</span>
            </button>
            {openPendiente&&(
              <div style={{marginBottom:18}}>
                {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:24}}>Sin cobros pendientes</div>}
                {grouped.map(renderClientGroup)}
              </div>
            )}

            {/* BLOQUE 2 — POR FACTURAR · mes en curso (acordeón) */}
            <button onClick={()=>setOpenPorFacturar(o=>!o)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'#F7F8F9',cursor:'pointer',textAlign:'left',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
                <span style={{fontSize:12,color:C.accent,transform:openPorFacturar?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}>▸</span>
                <span style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Por facturar</span>
                <span style={{fontSize:11,color:C.muted}}>· {progMes.length}</span>
              </div>
              <span style={{fontSize:14,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(progMesTotal)}</span>
            </button>
            {openPorFacturar&&(
              <div>
                {progMes.length===0&&<div style={{color:C.muted,textAlign:'center',padding:24}}>Nada por facturar este mes</div>}
                {progMes.length>0&&(
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <button onClick={()=>setSelExcel(allExcel?new Set():new Set(progMes.map(b=>b.id)))} style={{background:'none',border:'none',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',padding:0}}>{allExcel?'Desmarcar todo':'Marcar todo'}</button>
                    <button onClick={descargarPorFacturar} disabled={descExcel||selExcel.size===0} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:selExcel.size===0?'default':'pointer',opacity:(descExcel||selExcel.size===0)?.6:1}}>{descExcel?'Generando...':`↓ Descargar Excel (${selExcel.size})`}</button>
                  </div>
                )}
                {progMes.map(b=>{
                  const c=clients.find(x=>x.id===b.client_id)
                  const venta=(sales||[]).find(v=>v.id===b.sale_id)
                  const esCLP=venta?.moneda==='CLP'
                  const ufEq=(!esCLP&&venta?.uf_value)?(b.amount/venta.uf_value):null
                  const rs=resolveRS(b)
                  const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id)
                  const checked=selExcel.has(b.id)
                  return (
                    <div key={b.id} style={{background:C.card,borderRadius:10,padding:'10px 12px',marginBottom:6,border:`1px solid ${C.border}`}}>
                      <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                        <input type='checkbox' checked={checked} onChange={()=>toggleExcel(b.id)} style={{marginTop:3,flexShrink:0,cursor:'pointer'}}/>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                            <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c?.name||'Sin cliente'}</div>
                            <div style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0}}>{fmt(b.amount)}</div>
                          </div>
                          {rs.name&&<div style={{fontSize:10,color:C.muted,marginTop:1,textTransform:'uppercase',letterSpacing:.3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rs.name}{rs.rut?` · ${rs.rut}`:''}</div>}
                          <div style={{fontSize:12,color:C.text,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                            <span>{esCLP?'—':(ufEq?`UF ${ufEq.toLocaleString('es-CL',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—')}</span>
                            <span>Vence {fmtDate(b.due)}</span>
                          </div>
                          {emitiendo===b.id ? (
                            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:8}}>
                              {ents.length>1&&(
                                <select value={emitEnt} onChange={e=>setEmitEnt(e.target.value)} style={{padding:'5px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12}}>
                                  <option value=''>— Elegir razón social —</option>
                                  {ents.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
                                </select>
                              )}
                              <button onClick={()=>confirmarEmitida(b)} disabled={ents.length>1&&!emitEnt} style={{padding:'5px 10px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:11,fontWeight:700,cursor:(ents.length>1&&!emitEnt)?'default':'pointer',opacity:(ents.length>1&&!emitEnt)?.6:1}}>Confirmar emitida</button>
                              <button onClick={()=>{setEmitiendo(null);setEmitEnt('')}} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
                            </div>
                          ):(
                            <div style={{marginTop:8}}>
                              <button onClick={()=>{setEmitiendo(b.id);setEmitEnt(b.entity_id||(ents.length===1?ents[0].id:''))}} style={{padding:'4px 10px',borderRadius:20,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:700,cursor:'pointer'}}>Ya emitida</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <>
            {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>{isProg?'Sin facturas programadas':filter==='terceros'?'Sin facturas con costos de terceros':'Sin cobros'}</div>}
            {grouped.map(renderClientGroup)}
          </>
        )}
      </div>
    </div>
  )
}


function BillingForm({bill,clients,clientEntities,anticipos=[],onConsume,onSave,onClose,onDelete,saving,user,onAttachChange}) {
  const [f,setF] = useState(bill||{client_id:'',concept:'',amount:'',monto_terceros:'',status:'Pendiente',invoice_no:'',issued_at:'',due:'',paid_at:'',notes:'',billing_type:'honorarios',receptor_name:'',receptor_rut:''})
  const [clientQuery,setClientQuery] = useState('')
  const [nuevaRS,setNuevaRS] = useState(false)
  const [selAnt,setSelAnt] = useState(new Set())
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const rsList = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  const flabel={fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:5,display:'block'}
  const inp={width:'100%',height:36,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',color:'#1a1a1a',background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none'}
  const txt={width:'100%',height:64,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'8px 11px',color:'#1a1a1a',background:'#fff',outline:'none',resize:'none',fontFamily:'inherit',boxSizing:'border-box'}
  const estados=(()=>{ const base=['Pendiente','Pagado','Anulado']; return (f.status&&!base.includes(f.status))?[f.status,...base]:base })()
  return (
    <>
      <div className='qt-head' style={{display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`0.5px solid ${C.border}`,position:'sticky',top:0,background:'#fff',zIndex:2}}>
        <span style={{fontSize:15,fontWeight:500,color:'#1a1a1a'}}>{bill?.id?'Editar cobro':'Nuevo cobro'}</span>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
        </button>
      </div>
      <div className='qt-body' style={{display:'flex',flexDirection:'column',gap:14}}>
        <div>
          <label style={flabel}>Cliente</label>
          {f.client_id ? (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:36,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'0 11px'}}>
              <span style={{fontSize:13,fontWeight:500,color:'#1a1a1a'}}>{clients.find(c=>String(c.id)===String(f.client_id))?.name||'Cliente'}</span>
              <button type='button' onClick={()=>{up('client_id','');setClientQuery('')}} style={{border:'none',background:'none',color:C.accent,fontSize:12,fontWeight:500,cursor:'pointer'}}>Cambiar</button>
            </div>
          ) : (
            <div>
              <input value={clientQuery} onChange={e=>setClientQuery(e.target.value)} placeholder='Buscar cliente por nombre...' style={inp}/>
              {clientQuery.trim()&&(
                <div style={{maxHeight:180,overflowY:'auto',border:`0.5px solid ${C.border}`,borderRadius:8,marginTop:4,background:'#fff'}}>
                  {clients.filter(c=>c.name.toLowerCase().includes(clientQuery.toLowerCase())).slice(0,30).map(c=>(
                    <div key={c.id} onClick={()=>{up('client_id',c.id);setClientQuery('')}} style={{padding:'9px 11px',fontSize:13,color:'#1a1a1a',cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{c.name}</div>
                  ))}
                  {clients.filter(c=>c.name.toLowerCase().includes(clientQuery.toLowerCase())).length===0&&<div style={{padding:'9px 11px',fontSize:13,color:C.muted}}>Sin resultados</div>}
                </div>
              )}
            </div>
          )}
        </div>

        {bill?.id&&(()=>{
          const antDisp = anticipos.filter(a=>String(a.client_id)===String(f.client_id) && a.estado==='disponible')
          if(antDisp.length===0) return null
          const totalDisp = antDisp.reduce((s,a)=>s+(a.monto||0),0)
          const totalSel = antDisp.filter(a=>selAnt.has(a.id)).reduce((s,a)=>s+(a.monto||0),0)
          const fmtF = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() }catch(e){return iso||'—'} }
          const toggle = id => setSelAnt(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
          const aplicar = () => { const ids=[...selAnt]; if(!ids.length) return; onConsume&&onConsume(ids,bill.id); up('status','Pagado'); setSelAnt(new Set()) }
          return (
            <div>
              <label style={flabel}>Anticipos disponibles</label>
              <div style={{border:'0.5px solid #C8EAD9',borderRadius:10,overflow:'hidden'}}>
                <div style={{background:'#E1F5EE',padding:'10px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <span style={{display:'flex',alignItems:'center',gap:7,fontSize:12,fontWeight:500,color:'#0F6E56'}}>
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2'><circle cx='12' cy='12' r='10'/><line x1='12' y1='16' x2='12' y2='12'/><line x1='12' y1='8' x2='12.01' y2='8'/></svg>
                    Este cliente tiene anticipos sin aplicar
                  </span>
                  <span style={{fontSize:12,fontWeight:600,color:C.normal,flexShrink:0}}>{fmt(totalDisp)}</span>
                </div>
                {antDisp.map(a=>{ const on=selAnt.has(a.id); return (
                  <div key={a.id} onClick={()=>toggle(a.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 13px',borderTop:`0.5px solid ${C.border}`,background:'#fff',cursor:'pointer'}}>
                    <div style={{width:16,height:16,borderRadius:4,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:on?'1.5px solid #003C50':`1.5px solid ${C.border}`,background:on?C.accent:'#fff'}}>
                      {on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </div>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:'#1a1a1a'}}>{fmt(a.monto)}</div><div style={{fontSize:11,color:'#99ABB4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtF(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}{a.nota?` · ${a.nota}`:''}</div></div>
                    <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,flexShrink:0,background:on?'#E1F5EE':'#F5F7F9',color:on?C.normal:'#99ABB4'}}>{on?'Seleccionado':'Disponible'}</span>
                  </div>
                )})}
                <div style={{background:'#F5F7F9',padding:'9px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <span style={{fontSize:11,color:C.muted}}>Aplicar: <b style={{color:'#1a1a1a'}}>{fmt(totalSel)}</b></span>
                  <button onClick={aplicar} disabled={totalSel<=0} style={{height:26,borderRadius:8,background:C.normal,color:'#fff',border:'none',fontSize:11,fontWeight:500,padding:'0 12px',cursor:totalSel>0?'pointer':'not-allowed',opacity:totalSel>0?1:.6}}>Marcar como pagado</button>
                </div>
              </div>
            </div>
          )
        })()}

        <div>
          <label style={flabel}>Tipo de cobro</label>
          <div style={{display:'flex',background:'#F2F2F7',borderRadius:9,padding:3,gap:2}}>
            {[['honorarios','Honorarios'],['reembolso','Reembolso gastos']].map(([v,l])=>{ const on=f.billing_type===v; return (
              <button key={v} type='button' onClick={()=>up('billing_type',v)} style={{flex:1,border:on?'0.5px solid rgba(0,0,0,.08)':'0.5px solid transparent',borderRadius:7,padding:'8px 0',background:on?'#fff':'transparent',color:on?'#1a1a1a':'#537281',fontSize:12,cursor:'pointer'}}>{l}</button>
            )})}
          </div>
        </div>

        <div><label style={flabel}>Concepto</label><input value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Descripción del cobro...' style={inp}/></div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Monto total (CLP)</label><input type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0' style={inp}/></div>
          <div><label style={flabel}>De terceros (CLP)</label><input type='number' value={f.monto_terceros||''} onChange={e=>up('monto_terceros',e.target.value)} placeholder='0' style={inp}/></div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Estado</label><select value={f.status||'Pendiente'} onChange={e=>up('status',e.target.value)} style={sel}>{estados.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label style={flabel}>N° Factura</label><input value={f.invoice_no||''} onChange={e=>up('invoice_no',e.target.value)} placeholder='367...' style={inp}/></div>
        </div>

        {f.client_id&&(
          <div>
            <label style={flabel}>Razón social</label>
            {!nuevaRS&&rsList.length>0?(
              <select value={f.receptor_rut||''} onChange={e=>{
                if(e.target.value==='__nueva__'){setNuevaRS(true);up('receptor_name','');up('receptor_rut','')}
                else{const ce=rsList.find(x=>x.rut===e.target.value);up('receptor_name',ce?.name||'');up('receptor_rut',ce?.rut||'')}
              }} style={sel}>
                <option value=''>— Sin especificar —</option>
                {rsList.map(e=><option key={e.id} value={e.rut||e.name}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
                <option value='__nueva__'>+ Nueva razón social...</option>
              </select>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <input value={f.receptor_name||''} onChange={e=>up('receptor_name',e.target.value)} placeholder='Nombre / razón social' style={inp}/>
                <input value={f.receptor_rut||''} onChange={e=>up('receptor_rut',e.target.value)} placeholder='RUT (76.xxx.xxx-x)' style={inp}/>
                {rsList.length>0&&<button type='button' onClick={()=>{setNuevaRS(false);up('receptor_name','');up('receptor_rut','')}} style={{alignSelf:'flex-start',background:'none',border:'none',color:C.accent,fontSize:12,fontWeight:500,cursor:'pointer'}}>← Elegir de las existentes</button>}
              </div>
            )}
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Emisión</label><input type='date' value={f.issued_at||''} onChange={e=>up('issued_at',e.target.value)} style={inp}/></div>
          <div><label style={flabel}>Vencimiento</label><input type='date' value={f.due||''} onChange={e=>up('due',e.target.value)} style={inp}/></div>
          {f.status==='Pagado'&&<div><label style={flabel}>Fecha de pago</label><input type='date' value={f.paid_at||''} onChange={e=>up('paid_at',e.target.value)} style={inp}/></div>}
        </div>

        <div><label style={flabel}>Notas</label><textarea value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...' style={txt}/></div>

        {bill?.id&&user&&<div><label style={flabel}>Archivos</label><Attachments table='billing_attachments' idField='billing_id' entityId={bill.id} folderKind='facturas' namePrefix={`${clients.find(c=>String(c.id)===String(f.client_id))?.name||''} · ${f.concept||'Cobro'}`} user={user} onChange={onAttachChange}/></div>}
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',padding:'12px 18px',borderTop:`0.5px solid ${C.border}`}}>
        {bill?.id&&<button onClick={()=>onDelete(bill.id)} style={{height:36,padding:'0 14px',borderRadius:8,border:`0.5px solid ${C.overdue}`,background:'#fff',color:C.overdue,fontSize:13,fontWeight:500,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{height:36,padding:'0 16px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:500,cursor:'pointer',marginLeft:'auto'}}>Cancelar</button>
        <button disabled={saving||!f.client_id||!f.concept} onClick={()=>onSave(f)} style={{height:36,padding:'0 18px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.concept)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── ANTICIPO FORM (modal Nuevo anticipo, PP-15) ──────────────────────────────
function AnticipoForm({clients,sales,clientEntities,onSave,onClose,saving,preClient}) {
  const hoy = new Date().toISOString().slice(0,10)
  const [f,setF] = useState({client_id:preClient?.id||'',sale_id:'',proyecto:'',entity_id:'',monto:'',fecha:hoy,nota:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const cliente = clients.find(c=>String(c.id)===String(f.client_id))
  const clientSales = (sales||[]).filter(s=>s.client_id===f.client_id&&s.title)
  const clientEnts = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  const flabel={fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:6,display:'block'}
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:'#1a1a1a',background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none'}
  const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const fmtCLP0 = n => '$'+(parseInt(n)||0).toLocaleString('es-CL')
  const pill = on => ({fontSize:12,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:on?'1px solid #003C50':`0.5px solid ${C.border}`,background:on?'#E6EEF1':'#fff',color:on?C.accent:C.muted,fontWeight:on?600:400})
  const canSave = f.client_id && f.proyecto?.trim() && (parseInt(f.monto)||0)>0
  const guardar = () => onSave({...f, entity_id:f.entity_id||null})
  return (
    <>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 20px 14px',borderBottom:`0.5px solid ${C.border}`}}>
        <span style={{fontSize:16,fontWeight:600,color:C.accent}}>Nuevo anticipo</span>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
        </button>
      </div>
      <div style={{padding:'16px 20px 20px'}}>
        <div style={{marginBottom:13}}>
          <label style={flabel}>Cliente</label>
          {preClient ? (
            <div style={{display:'flex',alignItems:'center',gap:9,height:42,border:`0.5px solid ${C.border}`,borderRadius:10,padding:'0 11px'}}>
              <span style={{width:26,height:26,borderRadius:7,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700}}>{cIni(cliente?.name)}</span>
              <span style={{flex:1,fontSize:13,fontWeight:500,color:'#1a1a1a'}}>{cliente?.name||'Cliente'}</span>
            </div>
          ) : (
            <select value={f.client_id} onChange={e=>{up('client_id',e.target.value);up('sale_id','');up('proyecto','');up('entity_id','')}} style={{...sel,height:42,borderRadius:10}}>
              <option value=''>— Selecciona cliente —</option>
              {[...clients].filter(c=>c.status!=='Terminado').sort((a,b)=>(a.name||'').localeCompare(b.name||'','es')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>

        {f.client_id&&(
          <div style={{marginBottom:13}}>
            <label style={flabel}>Proyecto <span style={{color:C.overdue}}>*</span></label>
            {clientSales.length>0?(
              <select value={f.sale_id||''} onChange={e=>{ const s=clientSales.find(x=>String(x.id)===e.target.value); up('sale_id',s?.id||''); up('proyecto',s?.title||'') }} style={sel}>
                <option value=''>— Selecciona proyecto —</option>
                {clientSales.map(s=><option key={s.id} value={s.id}>{s.title}{s.status==='Propuesta'?' (propuesta)':''}</option>)}
              </select>
            ):(
              <input value={f.proyecto||''} onChange={e=>up('proyecto',e.target.value)} placeholder='Nombre del proyecto...' style={inp}/>
            )}
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1.25fr 1fr 1fr',gap:8,marginBottom:13}}>
          <div>
            <label style={flabel}>Razón social</label>
            {clientEnts.length>0?(
              <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={{...sel,fontSize:12,padding:'0 8px'}}>
                <option value=''>—</option>
                {clientEnts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            ):<div style={{...inp,display:'flex',alignItems:'center',color:'#99ABB4',fontSize:12}}>—</div>}
          </div>
          <div><label style={flabel}>Monto</label><input type='number' value={f.monto} onChange={e=>up('monto',e.target.value)} placeholder='0' style={inp}/></div>
          <div><label style={flabel}>Fecha</label><input type='date' value={f.fecha} onChange={e=>up('fecha',e.target.value)} style={{...inp,fontSize:12,padding:'0 8px'}}/></div>
        </div>

        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:13}}>
          {[100000,300000,500000,1000000].map(m=>(<button key={m} onClick={()=>up('monto',String(m))} style={pill(String(m)===f.monto)}>{fmtCLP0(m)}</button>))}
        </div>

        <div style={{marginBottom:18}}>
          <label style={flabel}>Nota <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· opcional</span></label>
          <textarea value={f.nota} onChange={e=>up('nota',e.target.value)} placeholder='Ej: abono inicial del retainer / provisión de gastos…' style={{width:'100%',minHeight:74,border:`0.5px solid ${C.border}`,borderRadius:10,fontSize:13,padding:'10px 11px',color:'#1a1a1a',outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'}}/>
        </div>

        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={saving||!canSave} onClick={guardar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:canSave?'pointer':'not-allowed',opacity:canSave?1:.6,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{saving?<Spin/>:null}{saving?'Guardando...':'Guardar anticipo'}</button>
        </div>
      </div>
    </>
  )
}

// ─── ANTICIPOS PANEL (tab Anticipos en Facturación, PP-15) ────────────────────
function AnticiposPanel({anticipos=[],clients=[],clientEntities=[],billing=[],onNuevo}) {
  const [fil,setFil] = useState('disponible')
  const fmtCLP0 = n => '$'+(n||0).toLocaleString('es-CL')
  const disponibles = anticipos.filter(a=>a.estado==='disponible')
  const consumidos = anticipos.filter(a=>a.estado==='consumido')
  const totalDisp = disponibles.reduce((s,a)=>s+(a.monto||0),0)
  const totalCons = consumidos.reduce((s,a)=>s+(a.monto||0),0)
  const nClientesDisp = new Set(disponibles.map(a=>a.client_id)).size
  const lista = fil==='disponible'?disponibles:fil==='consumido'?consumidos:anticipos
  const grupos = {}
  lista.forEach(a=>{ (grupos[a.client_id]=grupos[a.client_id]||[]).push(a) })
  const cliName = id => clients.find(c=>String(c.id)===String(id))?.name||'Sin cliente'
  const rsName = a => clientEntities.find(x=>String(x.id)===String(a.entity_id))?.name||''
  const folioDe = a => billing.find(b=>String(b.id)===String(a.billing_id))?.invoice_no
  const fmtD = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() }catch(e){return iso||'—'} }
  const flabel = {fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase'}
  return (
    <div>
      <div style={{display:'flex',border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
        <div style={{flex:1,padding:'14px 16px'}}>
          <div style={flabel}>Disponible</div>
          <div style={{fontSize:22,fontWeight:500,letterSpacing:'-.5px',color:C.normal,marginTop:3}}>{fmtCLP0(totalDisp)}</div>
          <div style={{fontSize:11,color:'#99ABB4',marginTop:2}}>en {nClientesDisp} cliente{nClientesDisp!==1?'s':''}</div>
        </div>
        <div style={{flex:1,padding:'14px 16px',borderLeft:`0.5px solid ${C.border}`}}>
          <div style={flabel}>Consumido</div>
          <div style={{fontSize:22,fontWeight:500,letterSpacing:'-.5px',color:C.muted,marginTop:3}}>{fmtCLP0(totalCons)}</div>
          <div style={{fontSize:11,color:'#99ABB4',marginTop:2}}>histórico total</div>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',gap:6}}>
          {[['disponible','Disponibles'],['consumido','Consumidos'],['todos','Todos']].map(([v,l])=>{ const on=fil===v; return (
            <button key={v} onClick={()=>setFil(v)} style={{height:26,padding:'0 11px',borderRadius:8,fontSize:11,cursor:'pointer',border:on?'none':`0.5px solid ${C.border}`,background:on?C.accent:'#fff',color:on?'#fff':C.muted}}>{l}</button>
          )})}
        </div>
        <button onClick={()=>onNuevo&&onNuevo()} style={{height:30,padding:'0 14px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:500,cursor:'pointer'}}>+ Anticipo</button>
      </div>
      {lista.length===0&&<div style={{textAlign:'center',color:'#99ABB4',fontSize:13,padding:30}}>No hay anticipos {fil==='disponible'?'disponibles':fil==='consumido'?'consumidos':'registrados'}</div>}
      {Object.keys(grupos).map(cid=>{
        const arr=grupos[cid]
        const totCli=arr.filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
        const rs=arr.map(rsName).find(Boolean)||''
        return (
          <div key={cid} style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#F5F7F9',padding:'8px 14px',borderBottom:`0.5px solid ${C.border}`}}>
              <div><div style={{fontSize:12,fontWeight:600,color:C.accent}}>{cliName(cid)}</div>{rs&&<div style={{fontSize:11,color:'#99ABB4'}}>{rs}</div>}</div>
              <div style={{textAlign:'right'}}><div style={flabel}>Disponible</div><div style={{fontSize:14,fontWeight:600,color:C.normal}}>{fmtCLP0(totCli)}</div></div>
            </div>
            {arr.map(a=>{ const disp=a.estado==='disponible'; const folio=folioDe(a); return (
              <div key={a.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'10px 14px',borderBottom:`0.5px solid ${C.border}`}}>
                <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:'#1a1a1a'}}>{fmtD(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}</div>{a.nota&&<div style={{fontSize:11,color:'#99ABB4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.nota}</div>}</div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                  {!disp&&folio&&<span style={{fontSize:11,color:C.muted,textDecoration:'underline'}}>F° {folio}</span>}
                  <span style={{fontSize:13,fontWeight:500,color:disp?C.normal:C.muted}}>{fmtCLP0(a.monto)}</span>
                  <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,background:disp?'#E1F5EE':'#F5F7F9',color:disp?C.normal:'#99ABB4'}}>{disp?'Disponible':'Consumido'}</span>
                </div>
              </div>
            )})}
          </div>
        )
      })}
    </div>
  )
}

// ─── PROVEEDORES (catálogo + ficha de colaboradores, costos de terceros) ──────
function ProveedoresModal({proveedores=[],terceros=[],billing=[],clients=[],onSave,onClose,saving}) {
  const [view,setView] = useState('list')   // list | ficha | form
  const [selId,setSelId] = useState(null)
  const [q,setQ] = useState('')
  const [f,setF] = useState({nombre:'',razon_social:'',rut:'',datos_pago:''})
  const fmt0 = n => '$'+(parseInt(n)||0).toLocaleString('es-CL')
  const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const titulo = p => (p?.razon_social?.trim()||p?.nombre?.trim()||'Proveedor')
  const debeDe = id => terceros.filter(t=>String(t.proveedor_id)===String(id)&&t.estado!=='pagado').reduce((s,t)=>s+(t.monto||0),0)
  const pagadoDe = id => terceros.filter(t=>String(t.proveedor_id)===String(id)&&t.estado==='pagado').reduce((s,t)=>s+(t.monto||0),0)
  const flabel={fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:6,display:'block'}
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:'#1a1a1a',background:'#fff',outline:'none',boxSizing:'border-box'}
  const fmtD = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() }catch(e){return iso||'—'} }

  const lista = [...proveedores].sort((a,b)=>titulo(a).localeCompare(titulo(b),'es'))
  const filtrados = q.trim()
    ? lista.filter(p=>`${p.nombre||''} ${p.razon_social||''} ${p.rut||''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : lista
  const sel = proveedores.find(p=>String(p.id)===String(selId))

  const abrirFicha = id => { setSelId(id); setView('ficha') }
  const abrirNuevo = () => { setF({nombre:'',razon_social:'',rut:'',datos_pago:''}); setView('form') }
  const abrirEditar = p => { setF({id:p.id,nombre:p.nombre||'',razon_social:p.razon_social||'',rut:p.rut||'',datos_pago:p.datos_pago||''}); setView('form') }
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const canSave = f.nombre?.trim()
  const guardar = async () => { const d=await onSave(f); if(d){ setSelId(d.id); setView('ficha') } }

  const headerBack = (titleTxt,onBack) => (
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 20px 14px',borderBottom:`0.5px solid ${C.border}`}}>
      <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
        {onBack&&<button onClick={onBack} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
          <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>
        </button>}
        <span style={{fontSize:16,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titleTxt}</span>
      </div>
      <button onClick={onClose} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
        <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
      </button>
    </div>
  )

  // ── LISTA ──
  if(view==='list') return (
    <>
      {headerBack('Proveedores',null)}
      <div style={{padding:'14px 20px 20px'}}>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar nombre, razón social, RUT...' style={{...inp,flex:1}}/>
          <button onClick={abrirNuevo} style={{height:38,padding:'0 14px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>+ Nuevo</button>
        </div>
        {filtrados.length===0?(
          <div style={{textAlign:'center',padding:'40px 20px',color:'#99ABB4',fontSize:13}}>{q.trim()?'Sin resultados':'Aún no hay proveedores. Agrega el primero.'}</div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:1,border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            {filtrados.map(p=>{
              const debe=debeDe(p.id)
              return (
                <div key={p.id} onClick={()=>abrirFicha(p.id)} style={{display:'flex',alignItems:'center',gap:11,padding:'11px 13px',background:'#fff',cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}>
                  <span style={{width:32,height:32,borderRadius:9,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{cIni(titulo(p))}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:'#1a1a1a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titulo(p)}</div>
                    <div style={{fontSize:11,color:'#99ABB4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.razon_social?.trim()?`Contacto: ${p.nombre||'—'}`:(p.rut||'Sin RUT')}</div>
                  </div>
                  {debe>0&&<span style={{fontSize:12,fontWeight:600,color:C.overdue,flexShrink:0}}>{fmt0(debe)}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )

  // ── FORMULARIO (nuevo/editar) ──
  if(view==='form') return (
    <>
      {headerBack(f.id?'Editar proveedor':'Nuevo proveedor',()=>setView(f.id?'ficha':'list'))}
      <div style={{padding:'16px 20px 20px'}}>
        <div style={{marginBottom:13}}>
          <label style={flabel}>Nombre <span style={{color:C.overdue}}>*</span> <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· persona de contacto</span></label>
          <input value={f.nombre} onChange={e=>up('nombre',e.target.value)} placeholder='Ej: Rodrigo Díaz' style={inp}/>
        </div>
        <div style={{marginBottom:13}}>
          <label style={flabel}>Razón social <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· opcional</span></label>
          <input value={f.razon_social} onChange={e=>up('razon_social',e.target.value)} placeholder='Ej: Díaz & Asociados SpA' style={inp}/>
        </div>
        <div style={{marginBottom:13}}>
          <label style={flabel}>RUT <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· de la razón social</span></label>
          <input value={f.rut} onChange={e=>up('rut',e.target.value)} placeholder='Ej: 76.123.456-7' style={inp}/>
        </div>
        <div style={{marginBottom:18}}>
          <label style={flabel}>Datos de pago <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· para transferencias</span></label>
          <textarea value={f.datos_pago} onChange={e=>up('datos_pago',e.target.value)} placeholder='Banco, tipo de cuenta, N° cuenta, RUT, correo…' style={{width:'100%',minHeight:74,border:`0.5px solid ${C.border}`,borderRadius:10,fontSize:13,padding:'10px 11px',color:'#1a1a1a',outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'}}/>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setView(f.id?'ficha':'list')} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={saving||!canSave} onClick={guardar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:canSave?'pointer':'not-allowed',opacity:canSave?1:.6,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}</button>
        </div>
      </div>
    </>
  )

  // ── FICHA ──
  const debe = sel?debeDe(sel.id):0
  const pagado = sel?pagadoDe(sel.id):0
  const histo = sel?[...terceros].filter(t=>String(t.proveedor_id)===String(sel.id)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))):[]
  const estLbl = {pendiente:['Pendiente','#99ABB4','#F5F7F9'],por_pagar:['Por pagar',C.accent,'#E6EEF1'],pagado:['Pagado',C.normal,'#E1F5EE']}
  return (
    <>
      {headerBack('Ficha de proveedor',()=>setView('list'))}
      <div style={{padding:'16px 20px 20px'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
          <span style={{width:46,height:46,borderRadius:12,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,flexShrink:0}}>{cIni(titulo(sel))}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:17,fontWeight:600,color:'#1a1a1a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titulo(sel)}</div>
            {sel?.razon_social?.trim()&&<div style={{fontSize:12,color:'#99ABB4'}}>Contacto: {sel.nombre||'—'}</div>}
            {sel?.rut&&<div style={{fontSize:12,color:'#99ABB4'}}>{sel.rut}</div>}
          </div>
          <button onClick={()=>abrirEditar(sel)} style={{height:32,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>Editar</button>
        </div>

        <div style={{display:'flex',border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
          <div style={{flex:1,padding:'12px 14px'}}>
            <div style={flabel}>Le debes</div>
            <div style={{fontSize:20,fontWeight:600,color:debe>0?C.overdue:'#1a1a1a',letterSpacing:-.5}}>{fmt0(debe)}</div>
          </div>
          <div style={{flex:1,padding:'12px 14px',borderLeft:`0.5px solid ${C.border}`}}>
            <div style={flabel}>Pagado</div>
            <div style={{fontSize:20,fontWeight:600,color:C.normal,letterSpacing:-.5}}>{fmt0(pagado)}</div>
          </div>
        </div>

        {sel?.datos_pago?.trim()&&(
          <div style={{marginBottom:14}}>
            <div style={flabel}>Datos de pago</div>
            <div style={{background:'#F5F7F9',border:`0.5px solid ${C.border}`,borderRadius:10,padding:'10px 12px',fontSize:12.5,color:'#3D3D3D',whiteSpace:'pre-wrap',lineHeight:1.5}}>{sel.datos_pago}</div>
          </div>
        )}

        <div style={flabel}>Historial de pagos / cobros</div>
        {histo.length===0?(
          <div style={{textAlign:'center',padding:'24px 12px',color:'#99ABB4',fontSize:12.5,background:'#F5F7F9',borderRadius:10}}>Sin movimientos todavía. Aparecerán al asignar costos de terceros en una venta.</div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:1,border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            {histo.map(t=>{
              const fac = billing.find(b=>String(b.id)===String(t.billing_id))
              const cli = clients.find(c=>String(c.id)===String(t.client_id||fac?.client_id))
              const [el,ec,eb] = estLbl[t.estado]||estLbl.pendiente
              return (
                <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'10px 13px',background:'#fff',borderBottom:`0.5px solid ${C.border}`}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cli?.name||'—'}</div>
                    <div style={{fontSize:11,color:'#99ABB4'}}>{fac?.invoice_no?`F° ${fac.invoice_no} · `:''}{t.estado==='pagado'&&t.pagado_at?`Pagado ${fmtD(String(t.pagado_at).slice(0,10))}`:(t.created_at?fmtD(String(t.created_at).slice(0,10)):'')}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    <span style={{fontSize:13,fontWeight:600,color:'#1a1a1a'}}>{fmt0(t.monto)}</span>
                    <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,background:eb,color:ec}}>{el}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ─── EXPENSES VIEW ────────────────────────────────────────────────────────────
function RendicionModal({client, entityIds, expenses, clientEntities, onClose, onRendicionComplete, setExpenses, currentUserName, onEnviar}) {
  const [selected, setSelected] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [contacts, setContacts] = useState([])
  const [atencion, setAtencion] = useState('')
  const [prefilled, setPrefilled] = useState(false)   // "Dirigido a" precargado de rendición anterior

  // Movimientos del cliente, acotados a la(s) razón(es) social(es) seleccionada(s).
  // Con 1 RS todo pertenece a esa RS (incl. sin entity_id); sin selección/sin RS, todos.
  const entsCli = (clientEntities||[]).filter(e=>e.client_id===client.id)
  const singleRS = entsCli.length===1
  const headEnt = (entityIds&&entityIds.length===1) ? entsCli.find(e=>e.id===entityIds[0]) : (singleRS?entsCli[0]:null)
  const inScope = e => (!entityIds||entityIds.length===0) ? true : (singleRS ? true : (!!e.entity_id && entityIds.includes(e.entity_id)))
  const allMovs = expenses.filter(e=>e.client_id===client.id && inScope(e))
  const fondosDisp = allMovs.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
  const gastosYaRend = allMovs.filter(e=>e.type==='gasto'&&e.client_rendered_at).reduce((a,e)=>a+e.amount,0)
  const saldoActual = fondosDisp - gastosYaRend

  // Gastos disponibles para rendir (no rendidos aun)
  const disponibles = allMovs.filter(e=>{
    if(e.type!=='gasto' || e.client_rendered_at) return false
    if(fDesde && e.date && e.date < fDesde) return false
    if(fHasta && e.date && e.date > fHasta) return false
    return true
  }).sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)

  const totalSel = disponibles.filter(e=>selected.has(e.id)).reduce((a,e)=>a+e.amount,0)
  const saldoTrasRendicion = saldoActual - totalSel
  const fondosList = allMovs.filter(e=>e.type==='fondo').sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)

  // "Dirigido a": precargar del valor guardado de rendiciones anteriores del cliente (tabla contacts)
  useEffect(()=>{
    let alive=true
    supabase.from('contacts').select('*').eq('client_id',client.id).order('created_at').then(({data})=>{
      if(!alive||!data) return
      setContacts(data)
      if(data[0]?.nombre){ setAtencion(data[0].nombre); setPrefilled(true) }
    })
    return ()=>{alive=false}
  },[client.id])
  // Guarda el "Dirigido a" para reutilizarlo (insert si no hay contacto, update si cambió)
  const guardarDirigido = async()=>{
    const v=(atencion||'').trim(); if(!v) return
    if(contacts[0]){ if(contacts[0].nombre!==v){ await supabase.from('contacts').update({nombre:v}).eq('id',contacts[0].id); setContacts(p=>p.map((c,i)=>i===0?{...c,nombre:v}:c)) } }
    else { const {data}=await supabase.from('contacts').insert({client_id:client.id,nombre:v}).select().single(); if(data) setContacts([data]) }
  }

  const toggleAll = () => {
    if(selected.size===disponibles.length) setSelected(new Set())
    else setSelected(new Set(disponibles.map(e=>e.id)))
  }
  const toggleOne = id => setSelected(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Otro':'#ECECEC'}

  const gastosSel = disponibles.filter(e=>selected.has(e.id))

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
    return rendicionDocHtml({ razon, rut, periodo, fechaEmision, dirigidoA: atencionVal||null, gastos: gastosSel, fondos: fondosList, totGastos: totalSel, totFondos: fondosDisp })
  }

  const handleGenerar = async(modo='pdf') => {
    if(!gastosSel.length) return
    setSaving(true)
    try {
      const renderId = crypto.randomUUID()
      const now = new Date().toISOString()
      const nowLabel = new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
      // Registrar la rendición PRIMERO: si falla, no marcamos gastos (evita gastos huérfanos)
      const rendUser = currentUserName || 'admin'
      const {error:rendErr} = await supabase.from('rendiciones').insert({
        id: renderId,
        user_name: rendUser,
        client_id: client.id,
        periodo: nowLabel,
        total: totalSel,
        n_gastos: gastosSel.length,
        n_clientes: 1,
        tipo: 'cliente',
        dirigido_a: (atencion||'').trim()||null
      })
      if(rendErr) throw new Error('No se pudo registrar la rendición: '+rendErr.message)
      // Marcar gastos como rendidos, avisando si alguno falla
      let falloMarca = 0
      for(const e of gastosSel) {
        const {error} = await supabase.from('expenses').update({client_rendered_at:now,client_render_id:renderId}).eq('id',e.id)
        if(error) falloMarca++
      }
      if(falloMarca>0) alert(`Atención: ${falloMarca} de ${gastosSel.length} gasto(s) no se marcaron como rendidos. Revísalos antes de enviar al cliente.`)
      // Actualizar estado local
      if(setExpenses) setExpenses(p=>p.map(e=>gastosSel.find(g=>g.id===e.id)?{...e,client_rendered_at:now,client_render_id:renderId}:e))
      const rendObj = {id:renderId,user_name:rendUser,client_id:client.id,periodo:nowLabel,total:totalSel,n_gastos:gastosSel.length,created_at:now,tipo:'cliente',dirigido_a:(atencion||'').trim()||null}
      if(onRendicionComplete) onRendicionComplete(rendObj)
      await guardarDirigido()
      // modo 'pdf': abre el documento imprimible. modo 'enviar': encadena al modal de correo.
      if(modo==='pdf') { const w=window.open('','_blank'); if(w){ w.document.write(generatePDFContent(atencion)); w.document.close() } }
      setSelected(new Set())
      if(modo==='enviar' && onEnviar) onEnviar(rendObj)
    } catch(e) { alert('Error: '+e.message) }
    setSaving(false)
  }

  const lblG = {fontSize:9,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,marginBottom:2}
  const fK = fondosDisp>0?{c:'#1D9E75',bg:'#E4F1EA'}:fondosDisp===0?{c:'#C77F18',bg:'#FEF6EE'}:{c:'#E24B4A',bg:'#FBE9E7'}
  const sK = saldoActual>0?{c:'#1D9E75',bg:'#E4F1EA'}:{c:'#E24B4A',bg:'#FBE9E7'}

  return (
    <div>
      {/* Razón social seleccionada */}
      {headEnt&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>{headEnt.name}</div>
          {headEnt.rut&&<div style={{fontSize:11,color:'#99ABB4'}}>{headEnt.rut}</div>}
        </div>
      )}

      {/* KPIs (rectángulos redondeados, labels grises) */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14}}>
        <div style={{background:fK.bg,borderRadius:10,padding:'10px 12px'}}>
          <div style={lblG}>Fondos</div>
          <div style={{fontSize:13,fontWeight:700,color:fK.c}}>{fmtN(fondosDisp)}</div>
        </div>
        <div style={{background:'#F5F7F9',borderRadius:10,padding:'10px 12px'}}>
          <div style={lblG}>Ya rendido</div>
          <div style={{fontSize:13,fontWeight:700,color:'#537281'}}>{fmtN(gastosYaRend)}</div>
        </div>
        <div style={{background:sK.bg,borderRadius:10,padding:'10px 12px'}}>
          <div style={lblG}>Saldo actual</div>
          <div style={{fontSize:13,fontWeight:700,color:sK.c}}>{fmtN(saldoActual)}</div>
        </div>
      </div>

      {/* Filtro por fecha */}
      <div style={{display:'flex',gap:6,marginBottom:10,alignItems:'center'}}>
        <input type='date' value={fDesde} onChange={e=>setFDesde(e.target.value)}
          style={{flex:1,padding:'5px 8px',borderRadius:6,border:'0.5px solid #D0D5DB',fontSize:11,outline:'none'}}/>
        <span style={{fontSize:11,color:'#888'}}>→</span>
        <input type='date' value={fHasta} onChange={e=>setFHasta(e.target.value)}
          style={{flex:1,padding:'5px 8px',borderRadius:6,border:'0.5px solid #D0D5DB',fontSize:11,outline:'none'}}/>
        {(fDesde||fHasta)&&<button onClick={()=>{setFDesde('');setFHasta('')}} style={{fontSize:10,color:'#888',background:'none',border:'none',cursor:'pointer'}}>×</button>}
      </div>

      {/* Dirigido a: se imprime en la rendición y se guarda para reutilizar en próximas */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:9,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Dirigido a</div>
        <input value={atencion} onChange={e=>{setAtencion(e.target.value);setPrefilled(false)}} placeholder='Nombre de la persona (opcional)'
          style={{width:'100%',padding:'7px 9px',borderRadius:7,border:'1px solid #E8E8E8',fontSize:13,boxSizing:'border-box',outline:'none'}}/>
        {prefilled&&atencion&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Guardado de rendición anterior — puedes editarlo</div>}
      </div>

      {/* Lista de gastos */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
        <div style={{fontSize:11,color:'#537281'}}>{disponibles.length} gastos disponibles para rendir</div>
        {disponibles.length>0&&<button onClick={toggleAll} style={{fontSize:10,color:'#003C50',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
          {selected.size===disponibles.length?'Desmarcar todo':'Seleccionar todo'}
        </button>}
      </div>
      {disponibles.length===0&&<div style={{color:'#888',textAlign:'center',padding:20,fontSize:12}}>No hay gastos pendientes de rendir</div>}
      <div style={{maxHeight:280,overflowY:'auto',marginBottom:12}}>
        {disponibles.map(e=>{
          const isSel=selected.has(e.id)
          const catBg=CATS[e.category]||CATS['Otro']
          return (
            <div key={e.id} onClick={()=>toggleOne(e.id)}
              style={{background:isSel?'#E6F1FB':'#fff',borderRadius:7,padding:'8px 10px',marginBottom:5,
                border:`1px solid ${isSel?'#003C50':'#E8E8E8'}`,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
              <div style={{width:16,height:16,borderRadius:3,border:`2px solid ${isSel?'#003C50':'#ccc'}`,
                background:isSel?'#003C50':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                {isSel&&<span style={{color:'#fff',fontSize:10}}>&#10003;</span>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:500,color:'#3D3D3D'}}>{e.concept||'—'}</div>
                <div style={{fontSize:10,color:'#888',marginTop:1,display:'flex',gap:5,alignItems:'center'}}>
                  {e.date&&<span>{fmtFechaDMY(e.date)}</span>}
                  {e.category&&<span style={{padding:'1px 5px',borderRadius:3,background:catBg,color:'#537281',fontWeight:600,fontSize:9}}>{e.category}</span>}
                </div>
              </div>
              <div style={{fontSize:12,fontWeight:700,color:'#E24B4A',flexShrink:0}}>{fmtN(e.amount)}</div>
            </div>
          )
        })}
      </div>

      {/* Resumen seleccion */}
      {selected.size>0&&(
        <div style={{background:'#F4F6F7',borderRadius:8,padding:'10px 12px',marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
            <span style={{fontSize:11,color:'#537281'}}>{selected.size} gasto{selected.size!==1?'s':''} seleccionado{selected.size!==1?'s':''}</span>
            <span style={{fontSize:13,fontWeight:700,color:'#E24B4A'}}>-{fmtN(totalSel)}</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between'}}>
            <span style={{fontSize:11,color:'#537281'}}>Saldo tras rendición</span>
            <span style={{fontSize:12,fontWeight:600,color:saldoTrasRendicion>=0?'#1D9E75':'#E24B4A'}}>
              {fmtN(saldoTrasRendicion)}{saldoTrasRendicion<0?' (nos deben)':' (a favor cliente)'}
            </span>
          </div>
        </div>
      )}

      {/* Botones */}
      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={!selected.size||saving} onClick={()=>handleGenerar('pdf')}
          style={{flex:1.3,padding:11,borderRadius:10,border:`1px solid ${selected.size?C.accent:'#ccc'}`,background:'#fff',color:selected.size?C.accent:'#ccc',fontSize:13,fontWeight:700,cursor:selected.size?'pointer':'not-allowed'}}>
          {saving?'…':'↓ PDF'}
        </button>
        <button disabled={!selected.size||saving} onClick={()=>handleGenerar('enviar')}
          style={{flex:1.7,padding:11,borderRadius:10,border:'none',background:selected.size?'#1D9E75':'#ccc',color:'#fff',fontSize:13,fontWeight:700,cursor:selected.size?'pointer':'not-allowed'}}>
          {saving?'Generando…':'Enviar al cliente'}
        </button>
      </div>
    </div>
  )
}

// Modal de confirmación para deshacer una carga masiva (elimina sus gastos).
function UndoConfirm({target,undoing,onCancel,onConfirm}) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(16,30,38,.42)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={e=>e.target===e.currentTarget&&onCancel()}>
      <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:340,padding:20,boxShadow:'0 16px 40px rgba(0,0,0,.2)'}}>
        <div style={{fontSize:15.5,fontWeight:600,color:C.text,marginBottom:9,fontFamily:"'DM Sans',sans-serif"}}>Deshacer importación</div>
        <div style={{fontSize:12.5,color:C.muted,lineHeight:1.55,marginBottom:18}}>Se eliminarán los <strong style={{color:C.text}}>{target.count} gasto{target.count!==1?'s':''}</strong> de esta carga. Si editaste alguno después de importar, también se eliminará. Esta acción no se puede revertir.</div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onCancel} style={{flex:1,padding:11,borderRadius:9,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={undoing} onClick={onConfirm} style={{flex:1,padding:11,borderRadius:9,border:'none',background:C.overdue,color:'#fff',fontSize:13,fontWeight:600,cursor:undoing?'default':'pointer',opacity:undoing?.6:1}}>{undoing?'Eliminando…':'Sí, eliminar todo'}</button>
        </div>
      </div>
    </div>
  )
}

function CargaMasivaModal({clients,clientEntities,onSave,onBulkImport,bulkImports=[],onUndoImport,importAliases=[],onLearnAlias,onClose,onClientsUpdate}) {
  const [tipo,setTipo] = useState('gasto') // gasto | fondo
  const [rows,setRows] = useState(null)    // null = sin cargar
  const [fileName,setFileName] = useState('')
  const [cargando,setCargando] = useState(false)
  const [guardando,setGuardando] = useState(false)
  const [resultado,setResultado] = useState(null)   // {imported,dupOmit,sinCliente,sinFecha,batchId}
  const [undoTarget,setUndoTarget] = useState(null)  // {batchId,count} para el modal de confirmación
  const [undoing,setUndoing] = useState(false)
  const fmtFDMY = iso => { if(!iso) return '—'; const p=String(iso).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(iso) }
  const [genPlantilla,setGenPlantilla] = useState(false)
  const [matching,setMatching] = useState(false)        // análisis de matching/IA en curso
  const [matchProg,setMatchProg] = useState(null)       // {done,total} de lotes IA

  const normRut = r => (r||'').toString().replace(/[.\s]/g,'').replace(/-/g,'').toUpperCase()
  // Categorías válidas del sistema (mismas que GastosForm). No se crean nuevas desde el Excel.
  const CAT_OPCIONES = ['Notaria','CBR','Diario Oficial','Registro Civil','Otro']
  const catNorm = s => (s||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
  const canonCat = raw => CAT_OPCIONES.find(c=>catNorm(c)===catNorm(raw)) || 'Otro'
  // Razones sociales (entidades) del cliente
  const entsOf = cid => (clientEntities||[]).filter(e=>e.client_id===cid)
  // Fila lista para cargar: con cliente, sin error y con razón social resuelta (auto si 1, elegida si varias)
  const rowReady = r => !!r.client_id && !r.error && (entsOf(r.client_id).length<=1 || !!r.entity_id)

  // ExcelJS (escritura con estilos/validación/comentarios — SheetJS community no los soporta) cargado por CDN al descargar
  const loadExcelJS = () => new Promise((resolve,reject)=>{
    if(window.ExcelJS) return resolve(window.ExcelJS)
    const s=document.createElement('script')
    s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
    s.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(new Error('ExcelJS no disponible'))
    s.onerror=()=>reject(new Error('No se pudo cargar la librería de Excel'))
    document.head.appendChild(s)
  })

  const descargarPlantilla = async() => {
    setGenPlantilla(true)
    try{
      const ExcelJS = await loadExcelJS()
      const wb = new ExcelJS.Workbook()
      const headFill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFE4E8EB'}}
      const headFont = {bold:true}
      const cats = '"'+CAT_OPCIONES.join(',')+'"'  // solo categorías válidas del sistema
      const estilarHeader = ws => ws.getRow(1).eachCell(c=>{ c.font=headFont; c.fill=headFill })

      // Hoja Gastos
      const g = wb.addWorksheet('Gastos')
      g.columns=[
        {header:'RUT',key:'rut',width:16},
        {header:'Nombre',key:'nombre',width:28},
        {header:'Fecha',key:'fecha',width:13},
        {header:'Monto',key:'monto',width:13},
        {header:'Concepto',key:'concepto',width:32},
        {header:'Categoría',key:'categoria',width:16},
      ]
      g.addRow({rut:'76.123.456-7',nombre:'Inmobiliaria Andes SpA',fecha:new Date(2026,5,3),monto:45000,concepto:'Inscripción en Conservador de Bienes Raíces',categoria:'CBR'})
      g.addRow({rut:'12.345.678-9',nombre:'Juan Pérez Soto',fecha:new Date(2026,5,5),monto:18000,concepto:'Transporte a notaría',categoria:'Otro'})
      g.addRow({rut:'77.700.111-2',nombre:'Comercial Sur Ltda.',fecha:new Date(2026,5,8),monto:30000,concepto:'Escritura notarial',categoria:'Notaria'})
      g.getColumn('fecha').numFmt='dd-mm-yyyy'
      g.getColumn('monto').numFmt='#,##0'
      estilarHeader(g)
      g.getCell('A1').note='Acepta RUT con o sin puntos/guión (ej: 76.123.456-7 o 761234567)'
      g.getCell('D1').note='Monto en pesos, mayor a 0 y sin decimales'
      for(let r=2;r<=200;r++) g.getCell('F'+r).dataValidation={type:'list',allowBlank:true,formulae:[cats]}

      // Hoja Fondos
      const f = wb.addWorksheet('Fondos')
      f.columns=[
        {header:'RUT',key:'rut',width:16},
        {header:'Nombre',key:'nombre',width:28},
        {header:'Fecha',key:'fecha',width:13},
        {header:'Monto',key:'monto',width:13},
        {header:'Concepto',key:'concepto',width:32},
      ]
      f.addRow({rut:'76.123.456-7',nombre:'Inmobiliaria Andes SpA',fecha:new Date(2026,5,1),monto:200000,concepto:'Provisión de fondos para gastos notariales'})
      f.addRow({rut:'77.700.111-2',nombre:'Comercial Sur Ltda.',fecha:new Date(2026,5,2),monto:150000,concepto:'Fondo inicial'})
      f.getColumn('fecha').numFmt='dd-mm-yyyy'
      f.getColumn('monto').numFmt='#,##0'
      estilarHeader(f)
      f.getCell('A1').note='Acepta RUT con o sin puntos/guión'
      f.getCell('D1').note='Monto en pesos, mayor a 0 y sin decimales'

      // Hoja Instrucciones
      const ins = wb.addWorksheet('Instrucciones')
      ins.getColumn(1).width=120
      const txt=[
        ['INSTRUCCIONES — CARGA MASIVA DE GASTOS Y FONDOS',true],
        ['',false],
        ['Columnas obligatorias: RUT (o Nombre) y Monto. Recomendado incluir Fecha.',false],
        ['Columnas opcionales: Concepto y, solo en Gastos, Categoría (si no se indica, se usa "Otro").',false],
        ['',false],
        ['Formato de RUT: con o sin puntos y guión. Ejemplos válidos: 76.123.456-7, 761234567, 76123456-7.',false],
        ['Formato de fecha: dd-mm-yyyy, dd/mm/yyyy o yyyy-mm-dd. Ejemplos: 03-06-2026, 03/06/2026, 2026-06-03. Si se omite, se usa la fecha de carga.',false],
        ['',false],
        ['Cliente: se busca por RUT y, si no hay coincidencia, por Nombre exacto. Las filas sin cliente quedan en AMARILLO en la vista previa para asignarlas a mano antes de cargar.',false],
        ['',false],
        ['Razón social: si el cliente tiene una sola razón social, se asigna automáticamente. Si tiene más de una, deberás elegirla en la vista previa antes de cargar (la fila queda en AMARILLO hasta que la elijas).',false],
        ['',false],
        ['Categoría: solo se pueden usar las categorías del sistema (Notaria, CBR, Diario Oficial, Registro Civil, Otro). No se pueden crear categorías nuevas desde el Excel; si no encaja ninguna, usa "Otro" y detalla en Concepto.',false],
        ['',false],
        ['Monto: número mayor a 0, sin decimales. Las filas con monto menor o igual a 0 (incluidos negativos) se marcan como ERROR (rojo) y NO se cargan.',false],
        ['',false],
        ['Duplicados: el sistema NO deduplica. Si subes el mismo archivo dos veces, los movimientos se cargan dos veces. La vista previa avisa si detecta filas duplicadas (mismo RUT, fecha, monto y concepto), pero igual puedes cargarlas.',false],
        ['',false],
        ['Hoja "Gastos": RUT | Nombre | Fecha | Monto | Concepto | Categoría.',false],
        ['Hoja "Fondos": RUT | Nombre | Fecha | Monto | Concepto.',false],
        ['Al cargar en la app eliges si subes Gastos o Fondos; se lee la hoja correspondiente.',false],
      ]
      txt.forEach((t,i)=>{ const cell=ins.getRow(i+1).getCell(1); cell.value=t[0]; if(t[1]) cell.font={bold:true} })

      const buf=await wb.xlsx.writeBuffer()
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='Plantilla_carga_masiva.xlsx'; a.click(); URL.revokeObjectURL(a.href)
    }catch(e){ alert('Error al generar la plantilla: '+e.message) }
    setGenPlantilla(false)
  }

  // ── MOTOR DE MATCHING (Commit 2) ──────────────────────────────────────────
  // Nivel 1-2: exacto por RUT (cliente o razón social) o por nombre/razón social.
  const exactMatch = (rut,nombre) => {
    const nr = normRut(rut)
    if(nr){
      const c = clients.find(c=>normRut(c.rut)===nr); if(c) return {client:c,method:'rut_exact',entity_id:null}
      const e = (clientEntities||[]).find(e=>normRut(e.rut)===nr); if(e){ const cc=clients.find(c=>c.id===e.client_id); if(cc) return {client:cc,method:'rut_exact',entity_id:e.id} }
    }
    if(nombre){
      const nn = String(nombre).trim().toLowerCase()
      const c = clients.find(c=>c.name?.toLowerCase().trim()===nn || c.razon_social?.toLowerCase().trim()===nn); if(c) return {client:c,method:'name_exact',entity_id:null}
      const e = (clientEntities||[]).find(e=>e.name?.toLowerCase().trim()===nn); if(e){ const cc=clients.find(c=>c.id===e.client_id); if(cc) return {client:cc,method:'name_exact',entity_id:e.id} }
    }
    return {client:null,method:'none',entity_id:null}
  }

  // Memoria aprendida: nombre-crudo normalizado → cliente (de asignaciones manuales previas).
  const aliasMap = useMemo(()=>{ const m=new Map(); (importAliases||[]).forEach(a=>m.set(a.alias_norm,a.client_id)); return m },[importAliases])
  const aliasClient = nombre => { const k=String(nombre||'').toLowerCase().trim(); if(!k) return null; const cid=aliasMap.get(k); return cid?clients.find(c=>String(c.id)===String(cid)):null }

  // Nivel 3: fuzzy por distancia de Levenshtein normalizada contra nombre, razón social y razones sociales (client_entities).
  const STOP = new Set(['de','la','el','los','las','y','del','e','en','spa','ltda','sa','eirl','cia','limitada','sociedad','inversiones','inmobiliaria','comercial','servicios','grupo'])
  const levenshtein = (a,b) => {
    const m=a.length,n=b.length
    const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0))
    for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1])
    return dp[m][n]
  }
  const normName = s => String(s||'').toLowerCase()
    .replace(/\b(spa|s\.p\.a\.?|ltda\.?|limitada|s\.a\.?|y c[ií]a\.?|cia\.?|eirl)\b/gi,'')
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()
  const simil = (a,b) => { const x=normName(a),y=normName(b); if(!x||!y) return 0; const d=levenshtein(x,y); return Math.round((1-d/Math.max(x.length,y.length))*100) }
  const fuzzyScore = (rawName,client) => {
    const rn = normName(rawName); if(!rn) return 0
    const rWords = rn.split(' ').filter(w=>w.length>2&&!STOP.has(w))
    const variants = [client.name, client.razon_social, ...entsOf(client.id).map(e=>e.name)].filter(Boolean)
    let best = 0
    for(const v of variants){
      const nv = normName(v); if(!nv) continue
      let s = simil(rawName,v)
      if(nv.includes(rn)||rn.includes(nv)){ const r=Math.min(rn.length,nv.length)/Math.max(rn.length,nv.length); s += r>=0.7?20:10 }
      const vWords = new Set(nv.split(' ').filter(w=>w.length>2&&!STOP.has(w)))
      if(rWords.some(w=>vWords.has(w))) s += 15
      best = Math.max(best, Math.min(100,s))
    }
    return best
  }
  const candidatos = rawName => clients.map(c=>({c,score:fuzzyScore(rawName,c)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)

  // Nivel 4: lote a Claude (Opus) para nombres sin resolver + corrección de conceptos.
  const aiMatchBatch = async(batch) => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if(!apiKey) return []
    const clientesDB = clients.map(c=>`- ID: ${c.id} | Nombre: "${c.name}" | RUT: ${c.rut||'-'} | RS: "${c.razon_social||''}"`).join('\n')
    const lista = batch.map((r,i)=>`${i+1}. "${r.nombre||r.rut||''}" | concepto: "${r.concepto||''}"`).join('\n')
    const prompt = `Eres un asistente experto para una firma de abogados chilena. Debes hacer match entre nombres de una planilla histórica y clientes del sistema. Los nombres pueden estar abreviados, sin sufijos legales, con errores de tipeo o con distintas capitalizaciones.

CLIENTES REGISTRADOS EN EL SISTEMA:
${clientesDB}

NOMBRES A RESOLVER (con su concepto):
${lista}

El campo cliente de la planilla puede contener indistintamente: el nombre del cliente, la razón social, una mezcla o abreviación, solo apellido o nombre parcial, o el nombre de fantasía/proyecto. Compara contra AMBOS campos (nombre Y razón social) de cada cliente. "Oficina", "Liberona Escala", "interno" → gasto interno de la firma (sin cliente externo, is_internal=true).

TAREA 2 — corrige el concepto de cada fila: ortografía y tildes ("inscripcion"→"Inscripción", "notaria"→"Notaría"), capitalización, y expande abreviaciones legales chilenas ("EP"→"Escritura Pública", "CV"→"Compraventa", "CCV"→"Copia con Vigencia", "GP"→"Gravámenes y Prohibiciones", "D.O."→"Diario Oficial", "+K"→"Empresa en un Día", "CBRS"→"CBR Santiago"). Mantén el significado; si ya está correcto, devuelve el mismo texto.

Responde SOLO con un array JSON sin markdown ni texto adicional:
[{"index":1,"raw_nombre":"...","client_id":"uuid o null","client_nombre":"... o null","confidence":0-100,"reason":"breve","is_internal":true/false,"concepto_corregido":"..."}]`
    try{
      const resp = await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:'claude-opus-4-8',max_tokens:4000,messages:[{role:'user',content:prompt}]})
      })
      const data = await resp.json()
      const raw = (data.content?.[0]?.text||'[]').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    }catch(e){ return [] }
  }

  // Orquesta: fuzzy sync + IA en lotes. Enriquardo cada fila con confidence/method/suggestion/candidates/concepto.
  const runMatching = async(baseRows) => {
    setMatching(true)
    const yield0 = () => new Promise(r=>setTimeout(r,0))
    try{
      const rows = baseRows.map(r=>({...r}))
      await yield0()   // deja que la tabla se pinte antes del trabajo pesado
      // Fuzzy en bloques, cediendo el hilo cada 20 filas para no congelar Safari.
      for(let i=0;i<rows.length;i++){
        const r = rows[i]
        if(r.client_id || (!r.rut && !r.nombre)){ if(!r.client_id){ r.matchMethod='none'; r.confidence=0 } continue }
        const cs = candidatos(r.nombre||r.rut)
        const top = cs[0]
        if(top && top.score>=90){ const ents=entsOf(top.c.id); r.client_id=top.c.id; r.clientName=top.c.name; r.entity_id=ents.length===1?ents[0].id:null; r.matchMethod='name_fuzzy'; r.confidence=top.score }
        else if(top && top.score>=70){ r.suggestion={id:top.c.id,name:top.c.name}; r.confidence=top.score; r.matchMethod='name_fuzzy' }
        else if(top && top.score>=50){ r.candidates=cs.slice(0,3).map(s=>({id:s.c.id,name:s.c.name,score:s.score})); r.confidence=top.score; r.matchMethod='name_fuzzy' }
        else { r._needsAI=true }
        if(i%20===19){ setRows(rows.map(x=>({...x}))); await yield0() }
      }
      setRows(rows.map(r=>({...r})))
      // IA: solo los sin resolver por fuzzy
      const aiRows = rows.filter(r=>r._needsAI)
      if(aiRows.length && import.meta.env.VITE_ANTHROPIC_API_KEY){
        const lotes=[]; for(let i=0;i<aiRows.length;i+=50) lotes.push(aiRows.slice(i,i+50))
        setMatchProg({done:0,total:lotes.length})
        for(let li=0; li<lotes.length; li++){
          const lote = lotes[li]
          const res = await aiMatchBatch(lote)
          res.forEach(o=>{
            const r = lote[(o.index||0)-1]; if(!r) return
            const conf = Number(o.confidence)||0
            if(o.concepto_corregido && o.concepto_corregido.trim() && o.concepto_corregido.trim()!==r.concepto){ r.conceptoOrig=r.concepto; r.concepto=o.concepto_corregido.trim(); r.conceptoFix=true }
            if(o.is_internal){ r.isInternal=true; r.matchMethod='ai'; r.confidence=conf; r.aiReason=o.reason||null; return }
            if(o.client_id && conf>=85){ const c=clients.find(c=>String(c.id)===String(o.client_id)); if(c){ const ents=entsOf(c.id); r.client_id=c.id; r.clientName=c.name; r.entity_id=ents.length===1?ents[0].id:null; r.matchMethod='ai'; r.confidence=conf; r.aiReason=o.reason||null } }
            else if(o.client_id && conf>=65){ const c=clients.find(c=>String(c.id)===String(o.client_id)); if(c){ r.suggestion={id:c.id,name:c.name}; r.confidence=conf; r.matchMethod='ai'; r.aiReason=o.reason||null } }
            else { r.matchMethod='none'; r.confidence=conf; r.aiReason=o.reason||null }
          })
          setRows(rows.map(r=>({...r})))
          setMatchProg({done:li+1,total:lotes.length})
        }
      }
      setRows(rows.map(r=>({...r})))
    }catch(e){ console.error('matching',e) }
    finally{ setMatching(false); setMatchProg(null) }
  }

  // Fecha tolerante: Date nativo, serial Excel, dd.mm.yy(yy), dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd. Vacío → ''.
  const parseFecha = v => {
    if(v===null||v===undefined||v==='') return ''
    if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10)
    // Número serial de Excel (días desde 1899-12-30). Se acepta como número o string puramente numérico.
    if(typeof v==='number' || /^\d{3,6}$/.test(String(v).trim())){
      const n = Number(v)
      if(n>20000 && n<80000){ const d=new Date(Date.UTC(1899,11,30)+n*86400000); if(!isNaN(d)) return d.toISOString().slice(0,10) }
    }
    const str = String(v).trim()
    // dd[.-/]mm[.-/]yy(yy)
    const m = str.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/)
    if(m){ let y=m[3]; if(y.length===2) y='20'+y; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` }
    if(/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0,10)
    return ''   // formato no reconocido → null (no bloquea; Commit 4 importa igual)
  }

  // Monto tolerante: separadores de miles (1.234.567), símbolo $, espacios. Vacío/no numérico → null.
  const parseMonto = v => {
    if(v===null||v===undefined||v==='') return null
    if(typeof v==='number') return Math.round(v)
    const limpio = String(v).replace(/[^\d-]/g,'')   // quita $, puntos de miles, espacios
    if(limpio===''||limpio==='-') return null
    const n = parseInt(limpio,10)
    return isNaN(n) ? null : n
  }

  // Sinónimos de columna (lowercased). El parser reconoce cualquiera de estos encabezados, en cualquier orden.
  const COLALIAS = {
    cliente:   ['cliente','nombre','nombre cliente','razón social','razon social','client'],
    rut:       ['rut','rut cliente'],
    fecha:     ['fecha','fecha gasto','date'],
    concepto:  ['concepto','actividad','descripción','descripcion','detalle','glosa','detail'],
    detalle:   ['detalle proveedor','detalle prov','proveedor detalle'],
    categoria: ['categoría','categoria','tipo','proveedor','category'],
    monto:     ['monto','importe','valor','amount','total'],
    notas:     ['notas','nota','observaciones','observación','observacion','comments'],
    proyecto:  ['proyecto','propuesta','propuesta - proyecto','project'],
  }
  // Mapea un valor de categoría de la planilla a una categoría válida del sistema (mantiene Registro Civil).
  const CAT_SINONIMOS = {
    'notaria':'Notaria','notaría':'Notaria','notario':'Notaria',
    'cbr':'CBR','conservador':'CBR','conservador de bienes raices':'CBR','conservador de bienes raíces':'CBR',
    'diario oficial':'Diario Oficial','d.o.':'Diario Oficial','do':'Diario Oficial',
    'registro civil':'Registro Civil','r. civil':'Registro Civil','rcivil':'Registro Civil',
  }
  const mapCategoria = raw => {
    const k = catNorm(raw)
    if(!k) return 'Otro'
    if(CAT_SINONIMOS[k]) return CAT_SINONIMOS[k]
    return CAT_OPCIONES.find(c=>catNorm(c)===k) || 'Otro'
  }

  const onFile = async(e) => {
    const file = e.target.files?.[0]; if(!file) return
    setFileName(file.name)
    setCargando(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf,{type:'array',cellDates:true})
      // Hoja según el tipo elegido (Gastos/Fondos); si no existe esa hoja, la primera
      const target = tipo==='fondo' ? 'fondos' : 'gastos'
      const sheetName = wb.SheetNames.find(n=>n.toLowerCase().trim()===target) || wb.SheetNames[0]
      const norm = s => String(s??'').toLowerCase().trim()
      // Construye una fila a partir de un getter de campo (sirve para la vía por objeto y la de matriz).
      const buildRow = (getField,idx) => {
        const rut = String(getField('rut')||'').trim()
        const nombre = String(getField('cliente')||'').trim()
        const cBase = String(getField('concepto')||'').trim()
        const cDet  = String(getField('detalle')||'').trim()
        const concepto = cBase&&cDet ? `${cBase} — ${cDet}` : (cBase||cDet)
        const notas = String(getField('notas')||'').trim()
        const proyecto = String(getField('proyecto')||'').trim()
        const fecha = parseFecha(getField('fecha'))
        const monto = parseMonto(getField('monto'))
        if(!rut&&!nombre&&!concepto&&monto==null&&!fecha&&!notas) return null  // fila vacía
        const categoria = tipo==='fondo' ? 'Fondo' : mapCategoria(getField('categoria'))
        const ex = exactMatch(rut,nombre)
        let cli=ex.client, method=ex.method, entId=ex.entity_id
        if(!cli){ const al=aliasClient(nombre); if(al){ cli=al; method='aprendido'; entId=null } }   // memoria aprendida
        const ents=cli?entsOf(cli.id):[]
        let error=null
        if(monto==null) error='Monto vacío o inválido'
        else if(monto<0) error='Monto negativo no permitido'
        else if(monto===0) error='Monto debe ser mayor a 0'
        return {id:idx, rut, nombre, fecha, monto, concepto, notas, proyecto, categoria, client_id:cli?.id||null, clientName:cli?.name||null, entity_id: entId || (ents.length===1?ents[0].id:null), matchMethod: cli?method:undefined, confidence: cli?(method==='name_exact'?95:100):undefined, error, dup:false}
      }
      // VÍA 1 (principal): por objeto, encabezado en la primera fila, columnas por alias. Robusta.
      let parsed = []
      const objs = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{defval:''})
      objs.forEach(o=>{
        const getField = field => { const aliases=COLALIAS[field]||[]; for(const k of Object.keys(o)){ if(aliases.includes(norm(k))) return o[k] } return '' }
        const r = buildRow(getField, parsed.length); if(r) parsed.push(r)
      })
      // VÍA 2 (respaldo): si la vía 1 no obtuvo filas, leer como matriz y detectar encabezado en las 5 primeras filas.
      if(parsed.length===0){
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true})
        const aliasFlat = Object.values(COLALIAS).flat()
        let hIdx=-1, best=0
        for(let i=0;i<Math.min(5,aoa.length);i++){ const score=(aoa[i]||[]).filter(c=>aliasFlat.includes(norm(c))).length; if(score>best){best=score;hIdx=i} }
        const colMap={}
        ;(hIdx>=0?aoa[hIdx]:(aoa[0]||[])).forEach((cell,idx)=>{ const n=norm(cell); for(const [field,aliases] of Object.entries(COLALIAS)){ if(aliases.includes(n)&&colMap[field]===undefined) colMap[field]=idx } })
        let startRow=(hIdx>=0?hIdx:0)+1
        if(!['cliente','rut','monto'].some(f=>colMap[f]!==undefined)){ Object.assign(colMap,{cliente:0,fecha:1,concepto:2,categoria:3,monto:4}); startRow=0 }
        aoa.slice(startRow).forEach(row=>{
          if(!Array.isArray(row)) return
          const getField = field => colMap[field]!==undefined ? row[colMap[field]] : ''
          const r = buildRow(getField, parsed.length); if(r) parsed.push(r)
        })
      }
      if(parsed.length===0){ alert('No se encontraron filas. Revisa que el Excel tenga una columna de Cliente (o RUT) y otra de Monto. Puedes descargar la plantilla modelo como referencia.'); setRows(null); setCargando(false); return }
      // Detección de duplicados dentro del archivo (mismo RUT + fecha + monto + concepto). No bloquea, solo avisa.
      const keyOf = r => `${normRut(r.rut)}|${r.fecha}|${r.monto}|${(r.concepto||'').trim().toLowerCase()}`
      const counts={}
      parsed.forEach(r=>{ const k=keyOf(r); counts[k]=(counts[k]||0)+1 })
      parsed.forEach(r=>{ if(counts[keyOf(r)]>1) r.dup=true })
      setRows(parsed)
      setCargando(false)
      runMatching(parsed)   // enriquece con fuzzy + IA (async, vuelve a setRows)
      return
    }catch(err){ alert('Error al leer el Excel: '+err.message) }
    setCargando(false)
  }

  // Identidad cruda de la fila para propagar: RUT si hay, si no el nombre normalizado.
  const rawKey = r => normRut(r.rut) || String(r.nombre||'').toLowerCase().trim()
  // Asignar cliente a una fila Y a todas las filas iguales (mismo RUT/nombre) que aún no haya
  // resuelto el usuario manualmente — así no se repite el trabajo.
  const asignar = (rowId,clientId) => {
    const c = clients.find(x=>x.id===clientId)
    const ents = entsOf(clientId)
    let srcNombre=null
    setRows(p=>{
      const src = p.find(r=>r.id===rowId)
      srcNombre = src?.nombre || null
      const key = src ? rawKey(src) : null
      const apply = r => ({...r,client_id:clientId,clientName:c?.name||null,entity_id:ents.length===1?ents[0].id:null,suggestion:null,candidates:null,isInternal:false,matchMethod:'manual'})
      return p.map(r=>{
        if(r.id===rowId) return apply(r)
        if(key && rawKey(r)===key && r.matchMethod!=='manual') return apply(r)  // iguales aún no fijados a mano
        return r
      })
    })
    // Aprende: este nombre crudo → este cliente, para que las próximas cargas caigan solas.
    if(onLearnAlias && srcNombre && String(srcNombre).trim()) onLearnAlias(String(srcNombre).toLowerCase().trim(), clientId)
  }
  // Confirma de una vez todas las sugerencias (fuzzy 70-89 / IA 65-84) como cliente asignado.
  const confirmarSugeridos = () => setRows(p=>p.map(r=>{
    if(!r.suggestion) return r
    const c=clients.find(x=>x.id===r.suggestion.id); const ents=entsOf(r.suggestion.id)
    return {...r,client_id:r.suggestion.id,clientName:c?.name||null,entity_id:ents.length===1?ents[0].id:null,suggestion:null,candidates:null,matchMethod:'manual'}
  }))

  // Estado de cada fila para la vista previa. montoBad es ortogonal al match.
  const montoBad = r => r.monto==null || r.monto<=0
  const bucketOf = r => (r.client_id||r.isInternal) ? 'auto' : (r.suggestion ? 'sug' : (r.candidates?.length ? 'rev' : 'man'))
  const listas = (rows||[]).filter(rowReady)
  const sugeridos = (rows||[]).filter(r=>!!r.suggestion)
  const nAuto = (rows||[]).filter(r=>bucketOf(r)==='auto').length
  const nRev = (rows||[]).filter(r=>bucketOf(r)==='rev').length
  const nMan = (rows||[]).filter(r=>bucketOf(r)==='man').length
  const dups = (rows||[]).filter(r=>r.dup)
  const totalMonto = (rows||[]).filter(r=>!r.error).reduce((a,r)=>a+(r.monto||0),0)
  const editarCampo = (rowId,campo,valor) => setRows(p=>p.map(r=>r.id===rowId?{...r,[campo]:valor}:r))

  const guardar = async(incluirTodo=false) => {
    const target = incluirTodo ? (rows||[]) : listas
    if(target.length===0){ alert(incluirTodo?'No hay filas para cargar.':'No hay filas listas para cargar (con cliente y razón social resueltos, sin errores).'); return }
    setGuardando(true)
    try{
      const res = await onBulkImport(target, {tipo, filename:fileName})
      setResultado(res)
    }catch(e){ alert('Error al importar: '+(e.message||e)) }
    setGuardando(false)
  }

  const inS = {padding:'7px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#F7F7F7',color:C.text,boxSizing:'border-box',outline:'none',width:'100%'}

  if(resultado) return (
    <div style={{textAlign:'center',padding:'8px 4px 4px'}}>
      <div style={{width:54,height:54,borderRadius:'50%',background:'#E1F5EE',display:'flex',alignItems:'center',justifyContent:'center',margin:'4px auto 12px'}}>
        <svg width='27' height='27' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
      </div>
      <div style={{fontSize:17,fontWeight:600,color:C.text,marginBottom:12,fontFamily:"'DM Sans',sans-serif"}}>{resultado.imported} {tipo==='fondo'?'fondo(s)':'gasto(s)'} importado(s)</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginBottom:18}}>
        {resultado.sinCliente>0&&<span style={{fontSize:11,color:C.muted,background:'#F5F7F9',borderRadius:20,padding:'4px 11px'}}><b style={{color:C.text}}>{resultado.sinCliente}</b> sin cliente</span>}
        {resultado.sinFecha>0&&<span style={{fontSize:11,color:C.muted,background:'#F5F7F9',borderRadius:20,padding:'4px 11px'}}><b style={{color:C.text}}>{resultado.sinFecha}</b> sin fecha</span>}
        {resultado.dupOmit>0&&<span style={{fontSize:11,color:'#8A5A12',background:'#FBF1DF',borderRadius:20,padding:'4px 11px'}}><b>{resultado.dupOmit}</b> duplicados omitidos</span>}
      </div>
      {resultado.sinCliente>0&&<div style={{fontSize:11.5,color:C.muted,marginBottom:14,lineHeight:1.45}}>Los gastos sin cliente quedaron en <strong style={{color:C.text}}>Gastos → "Sin cliente · por asignar"</strong> para que les asignes cliente cuando puedas.</div>}
      <button onClick={onClose} style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',marginBottom:9}}>Listo</button>
      {resultado.batchId&&resultado.imported>0&&<button onClick={()=>setUndoTarget({batchId:resultado.batchId,count:resultado.imported})} style={{width:'100%',padding:12,borderRadius:10,border:`0.5px solid ${C.overdue}`,background:'#fff',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Deshacer importación</button>}
      {undoTarget&&<UndoConfirm target={undoTarget} undoing={undoing} onCancel={()=>setUndoTarget(null)} onConfirm={async()=>{ setUndoing(true); const ok=await onUndoImport(undoTarget.batchId); setUndoing(false); if(ok){ setUndoTarget(null); onClose() } }}/>}
    </div>
  )

  return (
    <>
      {/* Paso 1: tipo + subir archivo */}
      {!rows&&(
        <>
          <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Sube un Excel con las columnas indicadas. Cada fila debe traer RUT, Nombre, Fecha, Monto, Concepto{tipo==='gasto'?' y Categoría':''}.</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
            {[['gasto','Gastos'],['fondo','Fondos']].map(([v,l])=>(
              <button key={v} type='button' onClick={()=>setTipo(v)} style={{padding:'10px',borderRadius:8,border:`2px solid ${tipo===v?C.accent:C.border}`,background:tipo===v?'#E6EEF1':'transparent',color:tipo===v?C.accent:C.muted,fontSize:13,fontWeight:700,cursor:'pointer'}}>{l}</button>
            ))}
          </div>
          <label style={{display:'block',padding:'24px',borderRadius:10,border:`2px dashed ${C.border}`,textAlign:'center',cursor:'pointer',background:'#FAFBFC'}}>
            <input type='file' accept='.xlsx,.xls' onChange={onFile} style={{display:'none'}}/>
            <div style={{fontSize:13,color:C.accent,fontWeight:600}}>{cargando?'Leyendo...':'Seleccionar archivo Excel'}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>.xlsx o .xls</div>
          </label>
          <div style={{textAlign:'center',marginTop:12}}>
            <button type='button' onClick={descargarPlantilla} disabled={genPlantilla} style={{background:'none',border:'none',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',textDecoration:'underline'}}>
              {genPlantilla?'Generando plantilla...':'Descargar plantilla modelo (.xlsx)'}
            </button>
            <div style={{fontSize:10,color:C.muted,marginTop:3}}>Incluye hojas Gastos, Fondos e Instrucciones con ejemplos</div>
          </div>
          {bulkImports.length>0&&(
            <div style={{marginTop:18,paddingTop:14,borderTop:`0.5px solid ${C.border}`}}>
              <div style={{fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8}}>Importaciones recientes</div>
              <div style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                {bulkImports.map((b,i)=>(
                  <div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:i<bulkImports.length-1?`0.5px solid ${C.border}`:'none'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.filename||'Carga sin nombre'}</div>
                      <div style={{fontSize:10.5,color:'#99ABB4',marginTop:1}}>{fmtFDMY(b.created_at)}{b.created_by?` · ${b.created_by}`:''} · {b.row_count} gasto{b.row_count!==1?'s':''}</div>
                    </div>
                    {b.status==='undone'
                      ? <span style={{fontSize:11,color:'#99ABB4',flexShrink:0}}>Anulada {b.undone_at?fmtFDMY(b.undone_at):''}</span>
                      : <button onClick={()=>setUndoTarget({batchId:b.id,count:b.row_count})} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#E6EEF1',border:'none',borderRadius:7,padding:'5px 11px',cursor:'pointer',flexShrink:0}}>Deshacer</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {undoTarget&&<UndoConfirm target={undoTarget} undoing={undoing} onCancel={()=>setUndoTarget(null)} onConfirm={async()=>{ setUndoing(true); const ok=await onUndoImport(undoTarget.batchId); setUndoing(false); if(ok) setUndoTarget(null) }}/>}
        </>
      )}

      {/* Paso 2: vista previa */}
      {rows&&(
        <>
          <div style={{display:'flex',gap:6,marginBottom:10}}>
            {[['Auto',nAuto,C.normal,'#BFE6D7'],['Sugeridos',sugeridos.length,'#B8860B','#F0D88A'],['Revisar',nRev,C.overdue,'#F3C0C0'],['Manual',nMan,C.muted,C.border]].map(([l,n,col,bd])=>(
              <div key={l} style={{flex:1,border:`1px solid ${bd}`,borderRadius:10,padding:'8px 4px',textAlign:'center'}}>
                <div style={{fontSize:18,fontWeight:700,letterSpacing:-.4,color:col}}>{n}</div>
                <div style={{fontSize:9.5,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,color:col,marginTop:1}}>{l}</div>
              </div>
            ))}
          </div>
          {matching&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:C.accent,background:'#E6EEF1',borderRadius:8,padding:'8px 10px',marginBottom:8}}><Spin/>Analizando {rows.length} filas con IA{matchProg?` · lote ${matchProg.done}/${matchProg.total}`:''}…</div>}
          <div style={{display:'flex',gap:7,marginBottom:10,flexWrap:'wrap'}}>
            <button disabled={sugeridos.length===0} onClick={confirmarSugeridos} style={{flex:'1 1 120px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:sugeridos.length?'pointer':'default',border:'1px solid #F0D88A',background:sugeridos.length?'#FFF8E1':'#FAFBFC',color:'#B8860B',opacity:sugeridos.length?1:.5}}>Confirmar sugeridos ({sugeridos.length})</button>
            <button disabled={guardando||listas.length===0} onClick={()=>guardar(false)} style={{flex:'1 1 120px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:listas.length?'pointer':'default',border:'none',background:C.accent,color:'#fff',opacity:listas.length?1:.5}}>Importar listos ({listas.length})</button>
            <button disabled={guardando||rows.length===0} onClick={()=>{ if(confirm(`Importar las ${rows.length} filas, incluso las sin cliente (quedan sin asignar) y sin monto (como $0)?`)) guardar(true) }} style={{flex:'1 1 110px',padding:'9px 8px',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer',border:`1px solid ${C.border}`,background:'#fff',color:C.accent}}>Importar todo ({rows.length})</button>
          </div>
          {dups.length>0&&<div style={{fontSize:11,color:'#C77F18',background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:8,padding:'8px 10px',marginBottom:8}}>Se detectaron {dups.length} fila(s) duplicada(s) (mismo RUT, fecha, monto y concepto) dentro del archivo.</div>}
          <div style={{maxHeight:360,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:8,marginBottom:12}}>
            {rows.map(r=>{
              const bucket = bucketOf(r)
              const bad = montoBad(r)
              const ents = r.client_id ? entsOf(r.client_id) : []
              const bg = bad?'#FEF2F2':(bucket==='auto'?'#E1F5EE':bucket==='sug'?'#FFF8E1':bucket==='rev'?'#FEF2F2':'#F5F7F9')
              const badge = bad?['Error',C.overdue,'#fff']:(bucket==='auto'?[r.isInternal?'Interno':r.matchMethod==='aprendido'?'Aprendido':'Auto',C.normal,'#fff']:bucket==='sug'?[`Sugerido ${r.confidence||''}%`,'#B8860B','#fff']:bucket==='rev'?[`Revisar ${r.confidence||''}%`,C.overdue,'#fff']:['Sin cliente',C.muted,'#fff'])
              if(r.isInternal&&!bad) badge[1]=C.muted
              return (
                <div key={r.id} style={{padding:'10px 12px',borderBottom:`1px solid ${C.border}`,background:bg,boxShadow:bad?`inset 3px 0 0 ${C.overdue}`:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                    <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color:badge[2],background:badge[1],borderRadius:4,padding:'2px 7px',flexShrink:0,whiteSpace:'nowrap'}}>{badge[0]}</span>
                    <span style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.fecha||'sin fecha'} · {r.rut||r.nombre||'sin RUT'}</span>
                    {r.dup&&<span style={{fontSize:9,fontWeight:600,color:'#C77F18',background:'#FEF6EE',border:'1px solid #F5E2CC',borderRadius:4,padding:'1px 6px',flexShrink:0}}>Duplicada</span>}
                    <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:bad?C.overdue:C.text,flexShrink:0}}>{bad?'$0':fmt(r.monto)}</span>
                  </div>
                  {bad&&<div style={{fontSize:11,color:C.overdue,fontWeight:600,marginBottom:6}}>Sin monto válido — se importa como $0 solo con "Importar todo".</div>}
                  {/* concepto (con corrección de IA si aplica) */}
                  {r.conceptoFix&&r.conceptoOrig&&<div style={{fontSize:11,marginBottom:4}}><span style={{color:C.muted,textDecoration:'line-through',marginRight:6}}>{r.conceptoOrig}</span><span style={{color:C.normal,fontWeight:600}}>{r.concepto}</span><span style={{color:C.muted,marginLeft:6}}>· corregido por IA</span></div>}
                  <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    <input value={r.concepto} onChange={e=>editarCampo(r.id,'concepto',e.target.value)} placeholder='Concepto'
                      style={{flex:'1 1 140px',minWidth:120,padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}/>
                    {tipo==='gasto'&&(
                      <select value={CAT_OPCIONES.includes(r.categoria)?r.categoria:'Otro'} onChange={e=>editarCampo(r.id,'categoria',e.target.value)}
                        style={{flex:'0 0 auto',padding:'6px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}>
                        {CAT_OPCIONES.map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </div>
                  {/* resolución de cliente según estado */}
                  <div style={{marginTop:7}}>
                    {bucket==='auto'&&!r.isInternal&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end',flexWrap:'wrap'}}>
                        <span style={{fontSize:11.5,color:C.normal,fontWeight:600,marginRight:'auto'}}>{r.clientName}</span>
                        {ents.length>1&&(
                          <select value={r.entity_id||''} onChange={e=>editarCampo(r.id,'entity_id',e.target.value||null)} style={{padding:'5px 7px',borderRadius:6,border:`1px solid ${r.entity_id?C.border:C.soon}`,fontSize:11,background:'#fff',color:C.text,outline:'none',maxWidth:170}}>
                            <option value=''>Elegir razón social…</option>
                            {ents.map(en=><option key={en.id} value={en.id}>{en.name}</option>)}
                          </select>
                        )}
                        {ents.length===1&&<span style={{fontSize:10,color:C.muted}}>{ents[0].name}</span>}
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Cambiar'/>
                      </div>
                    )}
                    {bucket==='auto'&&r.isInternal&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end'}}>
                        <span style={{fontSize:11.5,color:C.muted,fontWeight:600,marginRight:'auto'}}>Gasto interno de la firma</span>
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Asignar cliente'/>
                      </div>
                    )}
                    {bucket==='sug'&&(
                      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:11.5,color:C.text,fontWeight:600}}>{r.suggestion.name}</span>
                        {r.aiReason&&<span style={{fontSize:10.5,color:C.muted,fontStyle:'italic',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.aiReason}</span>}
                        <button onClick={()=>asignar(r.id,r.suggestion.id)} style={{marginLeft:'auto',fontSize:12,fontWeight:600,padding:'5px 11px',borderRadius:7,border:'none',background:C.normal,color:'#fff',cursor:'pointer'}}>Confirmar</button>
                        <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Cambiar'/>
                      </div>
                    )}
                    {bucket==='rev'&&(
                      <select value='' onChange={e=>e.target.value&&asignar(r.id,e.target.value)} style={{width:'100%',padding:'7px 9px',borderRadius:7,border:`1px solid ${C.overdue}`,fontSize:12,background:'#fff',color:C.text,outline:'none'}}>
                        <option value=''>Elige el cliente… ({r.candidates.length} candidatos)</option>
                        {r.candidates.map(c=><option key={c.id} value={c.id}>{c.name} ({c.score}%)</option>)}
                      </select>
                    )}
                    {bucket==='man'&&(
                      <AsignarClienteInline bill={{id:r.id}} clients={clients} onAssign={(_,cid)=>asignar(r.id,cid)} label='Buscar cliente por nombre o RUT…'/>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={()=>setRows(null)} style={{width:'100%',padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Volver a subir otro archivo</button>
        </>
      )}
    </>
  )
}

function ExpensesView({expenses,clients,clientEntities,onAdd,onEdit,onAddFondo,onBulk,onAssignRS,onAssignClientToExpense,setExpenses,setRendiciones,rendiciones,currentUserName,currentUser,expenseAttachments,setExpenseAttachments,onRendicionComplete}) {
  const [selectedClient,setSelectedClient] = useState(null)
  const [showOrphans,setShowOrphans] = useState(false)   // bucket "Sin cliente · por asignar"
  const [q,setQ] = useState('')
  const [attachExpense,setAttachExpense] = useState(null)   // gasto cuyo uploader está abierto
  const [rendEntityIds,setRendEntityIds] = useState([])     // ids de RS pre-seleccionadas al rendir
  const [selRS,setSelRS] = useState(()=>new Set())          // RS seleccionadas (vista 2+ RS)
  const [openRS,setOpenRS] = useState(()=>new Set())        // RS expandidas (acordeón 2+ RS)
  const [rendicionClient,setRendicionClient] = useState(null)
  const [showHistorial,setShowHistorial] = useState(false)
  const [emailRend,setEmailRend] = useState(null)
  const [hFiltCliente,setHFiltCliente] = useState('')
  const [hFiltDesde,setHFiltDesde] = useState('')
  const [hFiltHasta,setHFiltHasta] = useState('')
  const [showHistorialFicha,setShowHistorialFicha] = useState(false)   // historial dentro de la ficha del cliente
  const [hFichaDesde,setHFichaDesde] = useState('')
  const [hFichaHasta,setHFichaHasta] = useState('')
  const handleAnularRendicion = async(r) => {
    if(!confirm('\u00bfAnular esta rendici\u00f3n?')) return
    try {
      await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('client_render_id',r.id)
      await supabase.from('rendiciones').delete().eq('id',r.id)
      if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==r.id))
      if(setExpenses) setExpenses(p=>p.map(e=>e.client_render_id===r.id?{...e,client_rendered_at:null,client_render_id:null}:e))
    } catch(e) { alert('Error: '+e.message) }
  }
  // Anula la rendición de UN gasto: lo desvincula y ajusta el total/contador de su rendición (la elimina si queda en 0).
  const anularGastoRendido = async(e, ev) => {
    ev.stopPropagation()
    if(!confirm(`¿Anular la rendición de "${e.concept||'este gasto'}"? Volverá a quedar disponible para rendir.`)) return
    const renderId = e.client_render_id
    try {
      const {error} = await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('id',e.id)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,client_rendered_at:null,client_render_id:null}:x))
      if(renderId){
        const r=(rendiciones||[]).find(x=>x.id===renderId)
        if(r){
          const nuevoN=Math.max(0,(r.n_gastos||0)-1), nuevoTotal=(r.total||0)-(e.amount||0)
          if(nuevoN<=0){ await supabase.from('rendiciones').delete().eq('id',renderId); if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==renderId)) }
          else { await supabase.from('rendiciones').update({total:nuevoTotal,n_gastos:nuevoN}).eq('id',renderId); if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===renderId?{...x,total:nuevoTotal,n_gastos:nuevoN}:x)) }
        }
      }
    } catch(err){ alert('Error: '+err.message) }
  }
  const [asignandoRS,setAsignandoRS] = useState(null) // client_id cuyo selector de RS esta abierto
  const [expandRend,setExpandRend] = useState(null)   // id de la rendición con el detalle desplegado

  const balances = useMemo(()=>{
    const m={}
    expenses.forEach(e=>{
      if(!m[e.client_id]) m[e.client_id]={fondos:0,gastos:0,sinAsignar:0}
      if(e.type==='fondo') m[e.client_id].fondos+=e.amount
      else m[e.client_id].gastos+=e.amount
      if(!e.entity_id) m[e.client_id].sinAsignar+=1
    })
    return m
  },[expenses])

  // Clientes con movimientos, ordenados: negativos primero, luego por nombre
  const clientsWithMovs = useMemo(()=>{
    return clients
      .filter(c=>balances[c.id])
      .sort((a,b)=>{
        const sa=(balances[a.id]?.fondos||0)-(balances[a.id]?.gastos||0)
        const sb=(balances[b.id]?.fondos||0)-(balances[b.id]?.gastos||0)
        if(sa<0&&sb>=0) return -1
        if(sb<0&&sa>=0) return 1
        return a.name.localeCompare(b.name,'es')
      })
  },[clients,balances])

  const filteredClients = useMemo(()=>{
    if(!q.trim()) return clientsWithMovs
    return clientsWithMovs.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
  },[clientsWithMovs,q])

  const filtered = useMemo(()=>{
    if(!selectedClient) return []
    return expenses.filter(e=>e.client_id===selectedClient.id).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0))
  },[expenses,selectedClient])
  // Gastos huérfanos (sin cliente) — provienen de "Importar todo" en carga masiva.
  const orphans = useMemo(()=>(expenses||[]).filter(e=>!e.client_id).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)),[expenses])

  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Registro Civil':'#EDE3F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}

  // Al entrar a un cliente: pre-seleccionar todas sus RS y colapsar el acordeón
  useEffect(()=>{
    setShowHistorialFicha(false); setHFichaDesde(''); setHFichaHasta('')
    if(!selectedClient){ setSelRS(new Set()); setOpenRS(new Set()); return }
    const ids=(clientEntities||[]).filter(x=>x.client_id===selectedClient.id).map(e=>e.id)
    setSelRS(new Set(ids)); setOpenRS(new Set())
  },[selectedClient])

  const clientBalance = selectedClient ? (balances[selectedClient.id]||{}) : null
  const saldo = clientBalance ? clientBalance.fondos - clientBalance.gastos : 0
  const selEnts = selectedClient ? (clientEntities||[]).filter(x=>x.client_id===selectedClient.id) : []
  const rb = selectedClient ? rsBalances(selectedClient.id, expenses, selEnts) : null
  const multiRS = selEnts.length>=2

  // Colores de KPI según reglas (labels siempre gris #99ABB4)
  const cFondos = v => v>0?{c:C.normal,bg:'#E4F1EA'} : v===0?{c:'#C77F18',bg:'#FEF6EE'} : {c:C.overdue,bg:'#FBE9E7'}
  const cSaldo = v => v>0?{c:C.normal,bg:'#E4F1EA'} : {c:C.overdue,bg:'#FBE9E7'}
  const KpiRect = ({label,value,c,bg}) => (
    <div style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
      <div style={{fontSize:10,color:'#99ABB4',marginBottom:3,textTransform:'uppercase',letterSpacing:.4}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:c}}>{value}</div>
    </div>
  )
  const KpiRow = ({bal}) => { const f=cFondos(bal.fondos), s=cSaldo(bal.saldo); return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
      <KpiRect label='Fondos' value={fmt(bal.fondos)} c={f.c} bg={f.bg}/>
      <KpiRect label='Gastos' value={fmt(bal.gastos)} c={C.overdue} bg='#FBE9E7'/>
      <KpiRect label='Saldo actual' value={fmt(bal.saldo)} c={s.c} bg={s.bg}/>
    </div>
  )}

  // Ícono de adjuntos por gasto (CAMBIO 2): clip azul con contador o botón de subida gris
  const AdjuntoIcon = ({e}) => {
    const n=(expenseAttachments||[]).filter(a=>a.expense_id===e.id).length
    return n>0
      ? <button onClick={ev=>{ev.stopPropagation();setAttachExpense(e)}} title={`${n} adjunto(s)`} style={{display:'flex',alignItems:'center',gap:3,padding:'3px 8px',borderRadius:6,border:'1px solid #003C50',background:'#E6F1FB',color:'#003C50',fontSize:11,fontWeight:600,cursor:'pointer',flexShrink:0}}>
          <span style={{width:8,height:11,border:'1.5px solid #003C50',borderRadius:3,display:'inline-block',transform:'rotate(35deg)'}}/>{n}
        </button>
      : <button onClick={ev=>{ev.stopPropagation();setAttachExpense(e)}} title='Adjuntar comprobante' style={{display:'flex',alignItems:'center',justifyContent:'center',width:28,height:28,borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,cursor:'pointer',flexShrink:0,fontSize:13,lineHeight:1}}>↑</button>
  }

  // Fila de movimiento (sin línea de razón social): badge + concepto + fecha; ícono de adjunto solo en gastos
  const renderMov = (e) => {
    const isFondo=e.type==='fondo'
    const catBg=CATS[e.category]||CATS['Otro']
    return (
      <div key={e.id} onClick={()=>onEdit(e)} style={{background:C.card,borderRadius:10,padding:'11px 14px',marginBottom:7,border:`1px solid ${C.border}`,borderLeft:`3px solid ${isFondo?C.normal:C.overdue}`,cursor:'pointer'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2,flexWrap:'wrap'}}>
              {!isFondo&&e.category&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:catBg,color:'#537281',fontWeight:600}}>{e.category}{e.subcategory?`: ${e.subcategory}`:''}</span>}
              {isFondo&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#E4F1EA',color:C.normal,fontWeight:600}}>Fondo</span>}
              {!isFondo&&e.client_rendered_at&&<button onClick={ev=>anularGastoRendido(e,ev)} title='Anular la rendición de este gasto' style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#E4F1EA',color:'#0F6E56',fontWeight:600,border:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>Rendido <span style={{fontWeight:700,fontSize:11,lineHeight:1}}>✕</span></button>}
              {e.project&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:3,background:'#E6EEF1',color:C.accent,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150}}>{e.project}</span>}
            </div>
            <div style={{fontSize:13,color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2}}>{fmtDate(e.date)}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            {!isFondo&&<AdjuntoIcon e={e}/>}
            <div style={{fontSize:14,fontWeight:700,color:isFondo?C.normal:C.overdue}}>{isFondo?'+':'-'}{fmt(e.amount)}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Historial de rendiciones (helpers compartidos lista + ficha) ──
  const HH = {fontSize:10,fontWeight:600,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}
  const estadoBadge = r => r.sent_at
    ? <span style={{fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4,background:'#E1F5EE',color:'#0F6E56',whiteSpace:'nowrap'}}>Enviada</span>
    : <span style={{fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4,background:'#FFF8E1',color:'#C77F18',whiteSpace:'nowrap'}}>Pendiente</span>
  const rsOfRend = r => { const g=expenses.find(e=>e.client_render_id===r.id&&e.entity_id); const ent=g?(clientEntities||[]).find(x=>x.id===g.entity_id):null; return (ent&&ent.name)||'' }
  const verPdfRend = r => { const cl=clients.find(c=>c.id===r.client_id); const w=window.open('','_blank'); if(w){ w.document.write(rendicionPdfHtml(r,cl,expenses,clientEntities)); w.document.close() } }
  const renderRendRow = (r,showClient) => {
    const cl=clients.find(x=>x.id===r.client_id)
    const rs=showClient?'':rsOfRend(r)
    return (
      <div key={r.id} style={{padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
        <div onClick={()=>setExpandRend(expandRend===r.id?null:r.id)} style={{display:'grid',gridTemplateColumns:'1fr 78px 46px 70px',gap:6,alignItems:'start',cursor:'pointer'}}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{showClient?(cl?.name||'Cliente'):r.periodo}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{showClient?`${r.periodo} · `:''}{new Date(r.created_at).toLocaleDateString('es-CL')}{r.user_name?` · ${r.user_name}`:''}{rs?` · ${rs}`:''}</div>
          </div>
          <div style={{textAlign:'right',fontSize:13,fontWeight:700,color:C.overdue}}>-{fmt(r.total)}</div>
          <div style={{textAlign:'center',fontSize:13,color:C.text}}>{r.n_gastos}</div>
          <div style={{textAlign:'right'}}>{estadoBadge(r)}</div>
        </div>
        {expandRend===r.id&&(()=>{
          const gastos=expenses.filter(e=>e.client_render_id===r.id)
          return <div style={{marginTop:8,padding:'8px 11px',background:'#F7F8F9',borderRadius:8}}>
            {gastos.length===0?<div style={{fontSize:11,color:C.muted}}>Sin detalle de gastos.</div>:gastos.map((e,i)=>(
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'5px 0',borderBottom:i<gastos.length-1?`1px solid ${C.border}`:'none',fontSize:12}}>
                <div style={{minWidth:0}}>
                  <div style={{color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{RENDCAT(e.category)}{e.subcategory?': '+e.subcategory:''} · {fmtFechaDMY(e.date)}</div>
                </div>
                <div style={{color:C.overdue,fontWeight:600,whiteSpace:'nowrap'}}>-{fmt(e.amount)}</div>
              </div>
            ))}
          </div>
        })()}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
          <button onClick={()=>handleAnularRendicion(r)} style={{fontSize:10,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:5,padding:'3px 9px',cursor:'pointer'}}>Anular</button>
          <div style={{display:'flex',gap:6}}>
            <button onClick={()=>verPdfRend(r)} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>Ver PDF</button>
            {cl&&<button onClick={()=>setEmailRend(r)} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>{r.sent_at?'Reenviar':'Enviar'}</button>}
          </div>
        </div>
      </div>
    )
  }
  const renderHistorialTable = (rends,showClient) => {
    if(!rends.length) return <div style={{color:C.muted,textAlign:'center',padding:24,fontSize:12}}>Sin rendiciones</div>
    return (<>
      <div style={{display:'grid',gridTemplateColumns:'1fr 78px 46px 70px',gap:6,padding:'0 0 6px',borderBottom:`1px solid ${C.border}`}}>
        <div style={HH}>{showClient?'Cliente / Periodo':'Periodo'}</div>
        <div style={{...HH,textAlign:'right'}}>Monto</div>
        <div style={{...HH,textAlign:'center'}}>Gastos</div>
        <div style={{...HH,textAlign:'right'}}>Estado</div>
      </div>
      {rends.map(r=>renderRendRow(r,showClient))}
    </>)
  }

  // Sección de historial dentro de la ficha del cliente (solo rendiciones del cliente actual)
  const selStyle = {padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:12,boxSizing:'border-box',outline:'none',width:'100%'}
  const fichaHistorial = selectedClient ? (
    <div style={{marginTop:18,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
      <div style={{fontSize:11,fontWeight:500,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:12}}>Historial de rendiciones</div>
      {(()=>{
        const rends=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&r.client_id===selectedClient.id).sort((a,b)=>b.created_at>a.created_at?1:-1)
        return renderHistorialTable(rends,false)
      })()}
    </div>
  ) : null

  return (
    <div>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {(selectedClient||showOrphans)&&(
              <button onClick={()=>{setSelectedClient(null);setShowOrphans(false)}} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:'0 4px 0 0'}}>←</button>
            )}
            <div>
              <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>
                {showOrphans?'Sin cliente · por asignar':selectedClient?selectedClient.name:'Gastos y Fondos'}
              </div>
              {selectedClient&&selEnts.length===1&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>{selEnts[0].name}{selEnts[0].rut?` · ${selEnts[0].rut}`:''}</div>}
            </div>
          </div>
          <div style={{display:'flex',gap:6}}>
            {!selectedClient&&!showOrphans&&<button onClick={onBulk} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Carga masiva</button>}
            <button onClick={()=>selectedClient?onAddFondo(selectedClient):onAddFondo()} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.normal,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Fondo</button>
            <button onClick={()=>selectedClient?onAdd(selectedClient):onAdd()} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Gastos</button>
            {selectedClient&&<button onClick={()=>{setRendEntityIds([]);setRendicionClient(selectedClient)}} style={{padding:'6px 12px',borderRadius:8,border:'none',background:'#1D9E75',color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Rendir</button>}
          </div>
        </div>

        {/* Vista cliente seleccionado: KPIs (totales de todas las RS) */}
        {selectedClient&&rb&&<KpiRow bal={rb.total}/>}

        {/* Vista general: búsqueda */}
        {!selectedClient&&!showOrphans&&(
          <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' style={{marginBottom:4}}/>
        )}
      </div>

      {/* Vista "Sin cliente · por asignar": gastos huérfanos de la carga masiva */}
      {showOrphans&&(
        <div style={{padding:'4px 20px 100px'}}>
          {orphans.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>No quedan gastos sin cliente.</div>}
          {orphans.map(e=>(
            <div key={e.id} style={{background:C.card,borderRadius:10,padding:'11px 13px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.soon}`}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:7}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:1}}>{e.date?fmtFechaDMY(e.date):'sin fecha'} · {e.category||'Otro'}{e.type==='fondo'?' · Fondo':''}</div>
                </div>
                <span style={{fontSize:14,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(e.amount)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'flex-end'}}>
                <AsignarClienteInline bill={{id:e.id}} clients={clients} onAssign={(_,cid)=>onAssignClientToExpense(e.id,cid)} label='Asignar cliente' placeholder='Buscar cliente por nombre o RUT…'/>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vista general: lista de clientes con saldo */}
      {!selectedClient&&!showOrphans&&(
        <div style={{padding:'4px 20px 100px'}}>
          {orphans.length>0&&(
            <div onClick={()=>setShowOrphans(true)} style={{background:'#fff',borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.soon}`,cursor:'pointer',display:'flex',alignItems:'center',gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>Sin cliente · por asignar</div>
                <div style={{fontSize:11,color:C.muted,marginTop:2}}>{orphans.length} gasto{orphans.length!==1?'s':''} importado{orphans.length!==1?'s':''} sin cliente — asígnalos cuando puedas</div>
              </div>
              <span style={{fontSize:13,fontWeight:700,color:C.soon}}>{fmt(orphans.reduce((a,e)=>a+(e.amount||0),0))}</span>
              <span style={{fontSize:16,color:C.muted}}>›</span>
            </div>
          )}
          {filteredClients.length===0&&orphans.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin registros</div>}
          {filteredClients.map(c=>{
            const b=balances[c.id]||{fondos:0,gastos:0}
            const sal=b.fondos-b.gastos
            return (
              <div key={c.id} onClick={()=>setSelectedClient(c)} style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:`3px solid ${sal<0?C.overdue:C.normal}`,cursor:'pointer'}}
                onMouseEnter={x=>x.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.08)'}
                onMouseLeave={x=>x.currentTarget.style.boxShadow='none'}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div style={{fontWeight:600,fontSize:14,color:C.text,marginBottom:4}}>{c.name}</div>
                  <div style={{fontSize:15,fontWeight:700,color:sal<0?C.overdue:C.normal}}>{fmt(sal)}</div>
                </div>
                {(()=>{
                  const ents=(clientEntities||[]).filter(x=>x.client_id===c.id)
                  const rb=rsBalances(c.id, expenses, ents)
                  if(rb.porRS.length===0 && !rb.sin) return (
                    <div style={{display:'flex',gap:16,fontSize:11,color:C.muted}}><span>Fondos: {fmt(b.fondos)}</span><span>Gastos: {fmt(b.gastos)}</span></div>
                  )
                  const totalRS=rb.porRS.length+(rb.sin?1:0)
                  if(totalRS===1){
                    const ent=rb.porRS[0]?rb.porRS[0].entity:null
                    return (<div style={{marginTop:3}}>
                      <span style={{fontSize:12,color:C.muted}}>{ent?ent.name:'Sin razón social'}{ent?.rut?` · ${ent.rut}`:''}</span>
                    </div>)
                  }
                  const linea=(label,saldo,it)=>(
                    <div key={label} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,fontSize:11,padding:'2px 0'}}>
                      <span style={{color:C.muted,fontStyle:it?'italic':'normal',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
                      <span style={{fontWeight:600,color:saldo>0?C.normal:C.overdue,flexShrink:0}}>{fmt(saldo)}</span>
                    </div>
                  )
                  return (<div style={{marginTop:6,paddingTop:6,borderTop:`0.5px solid ${C.border}`}}>
                    {rb.porRS.map(r=>linea(`${r.entity.name}${r.entity.rut?` · ${r.entity.rut}`:''}`, r.saldo, false))}
                    {rb.sin&&linea('Sin razón social', rb.sin.saldo, true)}
                  </div>)
                })()}
                {(()=>{ const rs=(clientEntities||[]).filter(x=>x.client_id===c.id); if(!b.sinAsignar||rs.length===0) return null; return (
                  <div onClick={ev=>ev.stopPropagation()} style={{marginTop:8}}>
                    {asignandoRS===c.id?(
                      <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:11,color:C.muted}}>Asignar a:</span>
                        <select defaultValue='' onChange={ev=>{ if(ev.target.value){ onAssignRS(c.id,ev.target.value); setAsignandoRS(null) } }} style={{padding:'5px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12}}>
                          <option value='' disabled>— Elegir razón social —</option>
                          {rs.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}
                        </select>
                        <button onClick={()=>setAsignandoRS(null)} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
                      </div>
                    ):(
                      <button onClick={()=>setAsignandoRS(c.id)} style={{background:'#F0F4F6',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 10px',fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer'}}>Asignar razón social ({b.sinAsignar})</button>
                    )}
                  </div>
                ) })()}
              </div>
            )
          })}
          <div style={{marginTop:10,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
            <div onClick={()=>setShowHistorial(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
              <span style={{fontSize:11,fontWeight:500,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'0.06em'}}>Historial de rendiciones</span>
              <span style={{fontSize:13,color:'#99ABB4',transform:showHistorial?'rotate(180deg)':'none',transition:'transform .15s'}}>▾</span>
            </div>
            {showHistorial&&(
              <div style={{marginTop:12}}>
                <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                  <select value={hFiltCliente} onChange={e=>setHFiltCliente(e.target.value)} style={{flex:2,minWidth:120,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:12}}>
                    <option value=''>Todos los clientes</option>
                    {clients.map(cl=><option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                  <input type='month' value={hFiltDesde} onChange={e=>setHFiltDesde(e.target.value)} placeholder='Desde' style={{flex:1,minWidth:90,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:12}}/>
                  <input type='month' value={hFiltHasta} onChange={e=>setHFiltHasta(e.target.value)} placeholder='Hasta' style={{flex:1,minWidth:90,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',fontSize:12}}/>
                </div>
                {(()=>{
                  const rends=(rendiciones||[]).filter(r=>{
                    if(r.tipo!=='cliente') return false
                    if(hFiltCliente&&r.client_id!==hFiltCliente) return false
                    if(hFiltDesde&&r.created_at?.slice(0,7)<hFiltDesde) return false
                    if(hFiltHasta&&r.created_at?.slice(0,7)>hFiltHasta) return false
                    return true
                  }).sort((a,b)=>b.created_at>a.created_at?1:-1)
                  return renderHistorialTable(rends,true)
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Vista cliente con 1 razón social (o sin RS): lista de movimientos */}
      {selectedClient&&!multiRS&&(
        <div style={{padding:'4px 20px 130px'}}>
          {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin movimientos</div>}
          {filtered.map(renderMov)}
          {fichaHistorial}
        </div>
      )}
      {/* Vista cliente con 2+ razones sociales: acordeón por RS (checkbox + chevron + saldo) */}
      {selectedClient&&multiRS&&rb&&(
        <div style={{padding:'4px 20px 130px'}}>
          {rb.porRS.concat(rb.sin?[{...rb.sin,entity:{id:'__sin__',name:'Sin razón social',rut:''}}]:[]).map(r=>{
            const eid=r.entity.id, isSin=eid==='__sin__'
            const checked=selRS.has(eid), open=openRS.has(eid)
            const movs=filtered.filter(e=> isSin ? (!e.entity_id||!selEnts.find(x=>x.id===e.entity_id)) : e.entity_id===eid)
            const toggleOpen=()=>setOpenRS(p=>{const n=new Set(p);n.has(eid)?n.delete(eid):n.add(eid);return n})
            return (
              <div key={eid} style={{border:`1px solid ${C.border}`,borderRadius:10,marginBottom:8,overflow:'hidden',background:C.card}}>
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px'}}>
                  {isSin
                    ? <div style={{width:22,flexShrink:0}}/>
                    : <button onClick={()=>setSelRS(p=>{const n=new Set(p);n.has(eid)?n.delete(eid):n.add(eid);return n})} title={checked?'Quitar de la rendición':'Incluir en la rendición'}
                        style={{width:22,height:22,borderRadius:5,border:`2px solid ${checked?'#1D9E75':C.border}`,background:checked?'#1D9E75':'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0,padding:0}}>
                        {checked&&<span style={{display:'inline-block',width:5,height:9,borderRight:'2px solid #fff',borderBottom:'2px solid #fff',transform:'rotate(45deg)',marginTop:-2}}/>}
                      </button>}
                  <div onClick={toggleOpen} style={{flex:1,minWidth:0,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:12,color:C.muted,transform:open?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}>▸</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.entity.name}</div>
                      {r.entity.rut&&<div style={{fontSize:10,color:C.muted}}>{r.entity.rut}</div>}
                    </div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:r.saldo>0?C.normal:C.overdue,flexShrink:0}}>{fmt(r.saldo)}</div>
                </div>
                {open&&<div style={{padding:'2px 12px 12px'}}>
                  {movs.length===0?<div style={{fontSize:12,color:C.muted,padding:'6px 2px'}}>Sin movimientos</div>:movs.map(renderMov)}
                </div>}
              </div>
            )
          })}
          {fichaHistorial}
        </div>
      )}

      {/* Barras inferiores de rendir eliminadas — se usa el botón "↓ Rendir" del encabezado */}

      {attachExpense&&<Modal title={`Adjuntos — ${attachExpense.concept||'Gasto'}`} onClose={()=>setAttachExpense(null)}><Attachments table='expense_attachments' idField='expense_id' entityId={attachExpense.id} folderKind='gastos' namePrefix={`${selectedClient?.name||''} · ${attachExpense.concept||'Gasto'}`} user={currentUser} onChange={(delta,item)=>{ if(setExpenseAttachments) setExpenseAttachments(p=>delta>0?[...p,{id:item.id,expense_id:item.expense_id}]:p.filter(x=>x.id!==item.id)) }}/></Modal>}
      {rendicionClient&&<Modal title={`Rendición — ${rendicionClient.name}`} onClose={()=>{setRendicionClient(null);setRendEntityIds([])}} closeOnBackdrop={false}><RendicionModal client={rendicionClient} entityIds={rendEntityIds} expenses={expenses} clientEntities={clientEntities} onClose={()=>{setRendicionClient(null);setRendEntityIds([])}} setExpenses={setExpenses} onRendicionComplete={onRendicionComplete} currentUserName={currentUserName} onEnviar={r=>{setRendicionClient(null);setRendEntityIds([]);setEmailRend(r)}}/></Modal>}
      {emailRend&&<RendicionEmailModal r={emailRend} client={clients.find(c=>c.id===emailRend.client_id)} user={currentUser} expenses={expenses} onSent={(id,at)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at}:x))} onClose={()=>setEmailRend(null)}/>}
    </div>
  )
}

function FondoForm({clients,expenses,sales,clientEntities,onSave,onClose,saving,preClient}) {
  const hoy = new Date().toISOString().slice(0,10)
  const [selectedClient,setSelectedClient] = useState(preClient||null)
  const [f,setF] = useState({sale_id:'',project:'',entity_id:'',amount:'',date:hoy,concept:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const clientEnts = useMemo(()=>selectedClient?(clientEntities||[]).filter(e=>e.client_id===selectedClient.id):[],[clientEntities,selectedClient])
  const clientSales = useMemo(()=>selectedClient?(sales||[]).filter(s=>s.client_id===selectedClient.id&&s.title):[],[sales,selectedClient])
  useEffect(()=>{ setF(p=>({...p, entity_id: clientEnts.length===1?clientEnts[0].id:(clientEnts.some(e=>e.id===p.entity_id)?p.entity_id:'')})) },[clientEnts])
  const balance = selectedClient ? expenses.reduce((b,e)=> e.client_id===selectedClient.id ? b+(e.type==='fondo'?(e.amount||0):-(e.amount||0)) : b, 0) : null
  const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const fmtCLP0 = n => '$'+(parseInt(n)||0).toLocaleString('es-CL')
  const flabel={fontSize:10,fontWeight:600,color:'#99ABB4',letterSpacing:'.05em',textTransform:'uppercase',marginBottom:6,display:'block'}
  const inp={width:'100%',height:38,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:'#1a1a1a',background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none'}
  const pill = on => ({fontSize:12,padding:'5px 12px',borderRadius:20,cursor:'pointer',border:on?'1px solid #003C50':`0.5px solid ${C.border}`,background:on?'#E6EEF1':'#fff',color:on?C.accent:C.muted,fontWeight:on?600:400})
  const canSave = selectedClient && (parseInt(f.amount)||0)>0 && f.project?.trim() && (clientEnts.length===0 || f.entity_id)
  const guardar = () => onSave({client_id:selectedClient.id,type:'fondo',amount:parseInt(f.amount),concept:f.concept,date:f.date,category:'Fondo',entity_id:f.entity_id||null,project:f.project?.trim()||null,sale_id:f.sale_id||null})
  return (
    <>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 20px 14px',borderBottom:`0.5px solid ${C.border}`}}>
        <span style={{fontSize:16,fontWeight:600,color:C.accent}}>Registrar fondo{selectedClient&&<><span style={{color:C.done,fontWeight:400,margin:'0 6px'}}>|</span><span style={{color:C.muted,fontWeight:600}}>{selectedClient.name}</span></>}</span>
        <button onClick={onClose} style={{width:28,height:28,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
        </button>
      </div>
      <div style={{padding:'16px 20px 20px'}}>
        {!selectedClient ? (
          <div style={{marginBottom:14}}>
            <label style={flabel}>Cliente</label>
            <select value='' onChange={e=>setSelectedClient(clients.find(c=>String(c.id)===e.target.value)||null)} style={{...sel,height:42,borderRadius:10}}>
              <option value=''>— Selecciona cliente —</option>
              {[...clients].filter(c=>c.status!=='Terminado').sort((a,b)=>(a.name||'').localeCompare(b.name||'','es')).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        ) : (
          <>
            <div style={{marginBottom:13}}>
              <label style={flabel}>Cliente</label>
              <div style={{display:'flex',alignItems:'center',gap:9,height:42,border:`0.5px solid ${C.border}`,borderRadius:10,padding:'0 11px'}}>
                <span style={{width:26,height:26,borderRadius:7,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700}}>{cIni(selectedClient.name)}</span>
                <span style={{flex:1,fontSize:13,fontWeight:500,color:'#1a1a1a'}}>{selectedClient.name}</span>
                {balance!==null&&<span style={{fontSize:11,color:balance<0?C.overdue:C.normal}}>Saldo actual {fmt(balance)}</span>}
              </div>
            </div>

            <div style={{marginBottom:13}}>
              <label style={flabel}>Proyecto <span style={{color:C.overdue}}>*</span></label>
              {clientSales.length>0?(
                <select value={f.sale_id||''} onChange={e=>{ const s=clientSales.find(x=>String(x.id)===e.target.value); up('sale_id',s?.id||''); up('project',s?.title||'') }} style={sel}>
                  <option value=''>— Selecciona proyecto —</option>
                  {clientSales.map(s=><option key={s.id} value={s.id}>{s.title}{s.status==='Propuesta'?' (propuesta)':''}</option>)}
                </select>
              ):(
                <input value={f.project||''} onChange={e=>up('project',e.target.value)} placeholder='Nombre del proyecto...' style={inp}/>
              )}
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1.25fr 1fr 1fr',gap:8,marginBottom:13}}>
              <div>
                <label style={flabel}>Razón social{clientEnts.length>0&&<span style={{color:C.overdue}}> *</span>}</label>
                {clientEnts.length>0?(
                  <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={{...sel,fontSize:12,padding:'0 8px'}}>
                    <option value=''>—</option>
                    {clientEnts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                ):<div style={{...inp,display:'flex',alignItems:'center',color:'#99ABB4',fontSize:12}}>—</div>}
              </div>
              <div><label style={flabel}>Monto</label><input type='number' value={f.amount} onChange={e=>up('amount',e.target.value)} placeholder='0' style={inp}/></div>
              <div><label style={flabel}>Fecha</label><input type='date' value={f.date} onChange={e=>up('date',e.target.value)} style={{...inp,fontSize:12,padding:'0 8px'}}/></div>
            </div>

            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:13}}>
              {[100000,300000,500000,1000000].map(m=>(<button key={m} onClick={()=>up('amount',String(m))} style={pill(String(m)===f.amount)}>{fmtCLP0(m)}</button>))}
            </div>

            <div style={{marginBottom:18}}>
              <label style={flabel}>Descripción <span style={{textTransform:'none',letterSpacing:0,color:'#99ABB4'}}>· opcional</span></label>
              <textarea value={f.concept} onChange={e=>up('concept',e.target.value)} placeholder='Ej: provisión de fondos abril…' style={{width:'100%',minHeight:60,border:`0.5px solid ${C.border}`,borderRadius:10,fontSize:13,padding:'10px 11px',color:'#1a1a1a',outline:'none',resize:'vertical',fontFamily:'inherit',boxSizing:'border-box'}}/>
            </div>
          </>
        )}

        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
          <button disabled={saving||!canSave} onClick={guardar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:canSave?'pointer':'not-allowed',opacity:canSave?1:.6,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{saving?<Spin/>:null}{saving?'Guardando...':'Guardar fondo'}</button>
        </div>
      </div>
    </>
  )
}

// ── GASTOS FORM (tabla de ingreso rápido) ─────────────────────────────────────
const CATS_GASTO = ['Notaria','CBR','Diario Oficial','Registro Civil','Otro']
function GastosForm({clients,expenses,clientEntities,tasks,sales,onSave,onClose,preClient}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient||null)
  const hoy = new Date().toISOString().slice(0,10)
  const [rows,setRows] = useState([{id:1,category:'CBR',concept:'',amount:'',date:hoy}])
  const [saving,setSaving] = useState(false)
  const [saved,setSaved] = useState(0)
  const rsList = useMemo(()=>{ if(!selectedClient) return []; return (clientEntities||[]).filter(e=>e.client_id===selectedClient.id) },[clientEntities,selectedClient])
  const [entityId,setEntityId] = useState('')
  const [showRS,setShowRS] = useState(false)
  useEffect(()=>{ setEntityId(rsList[0]?.id||'') },[rsList])   // pre-poblar con la primera RS del cliente
  // Proyecto del lote (autocomplete con los proyectos del cliente: tareas + ventas, igual que QuickTaskForm)
  const [project,setProject] = useState('')
  const [showProjects,setShowProjects] = useState(false)
  const [newProject,setNewProject] = useState(false)
  const clientProjects = useMemo(()=>{
    if(!selectedClient) return []
    const m={}
    ;(tasks||[]).filter(t=>t.client_id===selectedClient.id&&t.project).forEach(t=>{ const d=t.created_at||t.due||''; if(!(t.project in m)||d>m[t.project]) m[t.project]=d })
    ;(sales||[]).filter(s=>s.client_id===selectedClient.id&&s.title).forEach(s=>{ const d=s.created_at||s.date||''; if(!(s.title in m)||d>m[s.title]) m[s.title]=d })
    return Object.keys(m).sort((a,b)=>(m[b]||'').localeCompare(m[a]||''))   // más reciente primero
  },[tasks,sales,selectedClient])
  useEffect(()=>{ setProject(clientProjects[0]||''); setNewProject(false) },[clientProjects])   // pre-poblar con el proyecto más reciente
  const matches = useMemo(()=>{ if(!q.trim()) return []; return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,6) },[clients,q])
  const balance = selectedClient ? (()=>{ let b=0; expenses.forEach(e=>{ if(e.client_id===selectedClient.id) b+=e.type==='fondo'?e.amount:-e.amount }); return b })() : null
  const total = rows.reduce((a,r)=>a+(parseInt(r.amount)||0),0)

  const addRow = () => setRows(p=>[...p,{id:Date.now(),category:'CBR',concept:'',amount:'',date:p[p.length-1]?.date||hoy}])
  const removeRow = id => setRows(p=>p.filter(r=>r.id!==id))
  const updateRow = (id,k,v) => setRows(p=>p.map(r=>r.id===id?{...r,[k]:v}:r))

  const handleKeyDown = (e,rowId,field) => {
    if(e.key==='Enter'||e.key==='Tab') {
      const idx = rows.findIndex(r=>r.id===rowId)
      if(field==='amount' && idx===rows.length-1) { e.preventDefault(); addRow() }
    }
  }

  const saveAll = async() => {
    const valid = rows.filter(r=>r.amount&&parseInt(r.amount)>0)
    if(!valid.length||!selectedClient) return
    setSaving(true)
    let count=0; const errores=[]
    for(const r of valid) {
      try {
        await onSave({client_id:selectedClient.id,type:'gasto',amount:parseInt(r.amount),concept:r.concept,category:r.category,date:r.date||hoy,sale_id:null,entity_id:entityId||null,project:project||null,subcategory:r.category==='Otro'?(r.subcategory?.trim()||null):null,paid_by_client:r.category==='Notaria'?true:!!r.paid_by_client})
        count++
      } catch(e){ errores.push(r.concept||r.category||'Fila') }
    }
    if(errores.length) alert(`${errores.length} gasto(s) no se guardaron: ${errores.join(', ')}`)
    setSaved(count)
    setRows([{id:Date.now(),category:'CBR',concept:'',amount:'',date:hoy}])
    setSaving(false)
  }

  const inS = {padding:'7px 8px',borderRadius:6,border:`1px solid ${C.border}`,fontSize:13,background:'#F7F7F7',color:C.text,boxSizing:'border-box',outline:'none',width:'100%'}

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
        <div style={{minWidth:0}}>
          {selectedClient&&<div style={{fontSize:11,fontWeight:500,color:'#99ABB4',textTransform:'uppercase',letterSpacing:.5,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedClient.name}</div>}
          <div style={{fontSize:16,fontWeight:700,color:'#003C50'}}>Registrar gastos</div>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1,flexShrink:0,marginLeft:12}}>x</button>
      </div>
      {!selectedClient&&(
        <Fld label='Cliente'>
          <div style={{position:'relative'}}>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' autoFocus/>
            {matches.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:220,overflowY:'auto'}}>
                {matches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{setSelectedClient(c);setQ('')}} style={{padding:'10px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Fld>
      )}

      {selectedClient&&(
        <>
          {saved>0&&<div style={{fontSize:12,color:C.normal,marginBottom:8,fontWeight:600}}>{saved} gasto{saved!==1?'s':''} guardado{saved!==1?'s':''}</div>}

          {rsList.length>0&&(
            <div style={{marginBottom:12,position:'relative'}}>
              <button type='button' onClick={()=>setShowRS(s=>!s)} onBlur={()=>setTimeout(()=>setShowRS(false),150)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#f5f7f9',color:C.text,fontSize:14,cursor:'pointer',textAlign:'left'}}>
                <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rsList.find(e=>e.id===entityId)?.name||'Sin asignar'}</span>
                <span style={{color:C.muted,transform:showRS?'rotate(180deg)':'none',transition:'transform .15s',flexShrink:0,marginLeft:8}}>▾</span>
              </button>
              {showRS&&(
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
                  {rsList.map(e=>(
                    <div key={e.id} onMouseDown={()=>{setEntityId(e.id);setShowRS(false)}} style={{padding:'9px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,background:e.id===entityId?'#E6EEF1':'#fff',color:e.id===entityId?C.accent:C.text,fontWeight:e.id===entityId?600:400}}>{e.name}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{marginBottom:12}}>
            <Lbl>Proyecto</Lbl>
            {clientProjects.length===0||newProject?(
              <Inp value={project} onChange={e=>setProject(e.target.value)} placeholder='Nombre del proyecto...' autoFocus={newProject}/>
            ):(
              <div style={{position:'relative'}}>
                <button type='button' onClick={()=>setShowProjects(s=>!s)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#f5f7f9',color:project?C.text:C.muted,fontSize:14,cursor:'pointer',textAlign:'left'}}>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{project||'Selecciona un proyecto'}</span>
                  <span style={{color:C.muted,transform:showProjects?'rotate(180deg)':'none',transition:'transform .15s',flexShrink:0,marginLeft:8}}>▾</span>
                </button>
                {showProjects&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
                    {clientProjects.map((p,i)=>(
                      <div key={i} onMouseDown={()=>{setProject(p);setShowProjects(false)}} style={{padding:'9px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,background:p===project?'#E6EEF1':'#fff',color:p===project?C.accent:C.text,fontWeight:p===project?600:400}}>{p}</div>
                    ))}
                    <div onMouseDown={()=>{setNewProject(true);setProject('');setShowProjects(false)}} style={{padding:'9px 12px',cursor:'pointer',fontSize:13,fontWeight:600,color:C.normal}}>+ Nuevo proyecto...</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Filas de gasto: layout en 2 líneas */}
          <div style={{marginBottom:8}}>
            {rows.map((row,idx)=>(
              <div key={row.id} style={{marginBottom:12,paddingBottom:12,borderBottom:idx<rows.length-1?`1px solid ${C.border}`:'none'}}>
                {/* Línea 1: Tipo | Fecha | Pago Cliente | eliminar */}
                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                  <select value={row.category} onChange={e=>updateRow(row.id,'category',e.target.value)} style={{...inS,fontSize:12,flex:'0 0 100px',width:'auto'}}>
                    {CATS_GASTO.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type='date' value={row.date||hoy} onChange={e=>updateRow(row.id,'date',e.target.value)} style={{...inS,fontSize:11,flex:'0 0 130px',width:'auto'}}/>
                  <label title={row.category==='Notaria'?'Notaría siempre se rinde al cliente y no descuenta tu caja chica':undefined} style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto',cursor:row.category==='Notaria'?'default':'pointer',flexShrink:0}}>
                    <span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>Pago Cliente</span>
                    <Switch on={row.category==='Notaria'||!!row.paid_by_client} disabled={row.category==='Notaria'} onToggle={()=>updateRow(row.id,'paid_by_client',!row.paid_by_client)}/>
                  </label>
                  <button onClick={()=>removeRow(row.id)} title='Eliminar fila' style={{background:'none',border:'none',cursor:'pointer',padding:4,flexShrink:0,display:'flex',alignItems:'center'}}><TrashIcon/></button>
                </div>
                {/* Línea 2: Descripción | Monto */}
                <div style={{display:'flex',gap:6}}>
                  <input value={row.concept} onChange={e=>updateRow(row.id,'concept',e.target.value)} placeholder='Descripción...' style={{...inS,flex:1}} onKeyDown={e=>handleKeyDown(e,row.id,'concept')}/>
                  <input type='number' value={row.amount} onChange={e=>updateRow(row.id,'amount',e.target.value)} placeholder='0' style={{...inS,flex:'0 0 92px',textAlign:'right'}} onKeyDown={e=>handleKeyDown(e,row.id,'amount')} autoFocus={idx===rows.length-1&&idx>0}/>
                </div>
                {row.category==='Otro'&&(
                  <input list='gasto-subcats' value={row.subcategory||''} onChange={e=>updateRow(row.id,'subcategory',e.target.value)} placeholder='Subcategoría (Otro)...' style={{...inS,fontSize:12,marginTop:6}}/>
                )}
              </div>
            ))}
            <datalist id='gasto-subcats'>
              {[...new Set((expenses||[]).filter(e=>e.subcategory).map(e=>e.subcategory))].sort().map(s=><option key={s} value={s}/>)}
            </datalist>
          </div>

          <button onClick={addRow} style={{width:'100%',padding:'8px',borderRadius:8,border:`1px dashed ${C.border}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:12}}>+ Agregar fila</button>

          {total>0&&(
            <div style={{display:'flex',justifyContent:'space-between',padding:'8px 12px',borderRadius:8,background:'#F7F7F7',marginBottom:12}}>
              <span style={{fontSize:13,color:C.muted}}>Total {rows.filter(r=>r.amount).length} gasto{rows.filter(r=>r.amount).length!==1?'s':''}</span>
              <span style={{fontSize:14,fontWeight:700,color:C.overdue}}>-{fmt(total)}</span>
            </div>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        {selectedClient&&<button disabled={saving||!rows.some(r=>r.amount&&parseInt(r.amount)>0)} onClick={saveAll} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:!rows.some(r=>r.amount)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar todo'}
        </button>}
      </div>
    </>
  )
}

// ── EXPENSE EDIT FORM (editar/eliminar registro individual) ───────────────────
function ExpenseEditForm({expense,clients,clientEntities,expenses,onSave,onClose,onDelete,saving,user,onAttachChange}) {
  const [f,setF] = useState({...expense,amount:expense.amount||'',concept:expense.concept||'',category:expense.category||'Otro'})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const client=clients.find(c=>c.id===f.client_id)
  const isFondo=f.type==='fondo'
  const rsList = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  return (
    <>
      <div style={{padding:'8px 14px',borderRadius:8,background:'#F7F7F7',marginBottom:14,fontSize:13,color:C.muted}}>
        Cliente: <span style={{fontWeight:600,color:C.text}}>{client?.name||'—'}</span>
      </div>
      {!isFondo&&(
        <Fld label='Tipo'>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {CATS_GASTO.map(c=>(
              <button key={c} type='button' onClick={()=>up('category',c)} style={{padding:'6px 12px',borderRadius:6,border:`1px solid ${f.category===c?C.accent:C.border}`,background:f.category===c?'#E6EEF1':'transparent',color:f.category===c?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{c}</button>
            ))}
          </div>
        </Fld>
      )}
      {!isFondo&&f.category==='Otro'&&(
        <Fld label='Subcategoría (Otro)'>
          <input list='expense-subcats' value={f.subcategory||''} onChange={e=>up('subcategory',e.target.value)} placeholder='Ej: Aseo, Cafetería, Suscripción...' style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',outline:'none'}}/>
          <datalist id='expense-subcats'>{[...new Set((expenses||[]).filter(e=>e.subcategory).map(e=>e.subcategory))].sort().map(s=><option key={s} value={s}/>)}</datalist>
        </Fld>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Monto (CLP)'><Inp type='number' value={f.amount} onChange={e=>up('amount',e.target.value)}/></Fld>
        <Fld label='Fecha'><Inp type='date' value={f.date||''} onChange={e=>up('date',e.target.value)}/></Fld>
      </div>
      <Fld label='Descripción'><Inp value={f.concept} onChange={e=>up('concept',e.target.value)} placeholder='Descripción...'/></Fld>
      {rsList.length>1&&(
        <Fld label='Razón social'>
          <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value||null)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box'}}><option value=''>— Sin asignar —</option>{rsList.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${e.rut}`:''}</option>)}</select>
        </Fld>
      )}
      {!isFondo&&expense?.id&&(
        <Attachments table='expense_attachments' idField='expense_id' entityId={expense.id} folderKind='gastos'
          namePrefix={`${client?.name||'Sin cliente'} · ${f.concept||'Gasto'}`} user={user} onChange={onAttachChange}/>
      )}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={()=>onDelete(expense.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.amount} onClick={()=>onSave({...f,amount:parseInt(f.amount)||0,subcategory:f.category==='Otro'?(f.subcategory?.trim()||null):null})} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}


// ─── CLIENTS VIEW ─────────────────────────────────────────────────────────────
function QuickTaskForm({clients,sales,tasks,clientEntities,onSave,onDelegate,onClose,saving,preClient,preDue,user,task}) {
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient || (task ? clients.find(c=>c.id===task.client_id)||null : null))
  // preDue: fecha precargada (string 'YYYY-MM-DD') al crear desde el calendario
  const initAssignees = task ? (task.assignees?.length?task.assignees:(task.who?[task.who]:[])) : [user?.name||'Cristóbal']
  const [f,setF] = useState(task
    ? {id:task.id,title:task.title||'',assignees:initAssignees,entity_id:task.entity_id||null,due:task.due||'',status:task.status||'Activo',note:task.note||'',sale_id:task.sale_id||'',project:task.project||'',subproject:task.subproject||'',assigned_by:task.assigned_by}
    : {title:'',assignees:initAssignees,entity_id:null,due:(typeof preDue==='string'?preDue:'')||'',status:'Activo',note:'',sale_id:'',project:'',subproject:''})
  const [showProjects,setShowProjects] = useState(false)
  const [subNew,setSubNew] = useState(false)
  const [showDate,setShowDate] = useState(false)
  const [deleg,setDeleg] = useState(false)        // switch "Delegar"
  const [delegTo,setDelegTo] = useState([])       // a quién se delega (multi)
  const [delegDue,setDelegDue] = useState('')     // nuevo plazo de la delegación
  const [draftId,setDraftId] = useState(null)
  const draftRef = useRef(null)       // id de la tarea borrador (creada al adjuntar en tarea nueva)
  const committedRef = useRef(false)  // true si se guardó vía "Guardar" (no borrar al cerrar)

  // Si el modal se cierra sin guardar y existe un borrador, se elimina (sin huérfanos)
  useEffect(()=>()=>{ if(draftRef.current && !committedRef.current){ supabase.from('tasks').delete().eq('id',draftRef.current) } },[])

  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const WHO = ['Cristóbal','Martín','Erasmo','Rodrigo','Martina']
  const toggleResp = w => setF(p=>{ const a=p.assignees||[]; return {...p, assignees: a.includes(w)?a.filter(x=>x!==w):[...a,w]} })

  // Razones sociales del cliente. Con 1, se asume; con 2+, el usuario elige (principal = la primera).
  const clientEnts = useMemo(()=>(clientEntities||[]).filter(e=>e.client_id===selectedClient?.id),[clientEntities,selectedClient])
  const multiRS = clientEnts.length>1
  // Al elegir/cambiar cliente, fija la RS por defecto (primera) si la actual no aplica.
  useEffect(()=>{
    if(!selectedClient) return
    setF(p=>{ if(p.entity_id&&clientEnts.some(e=>e.id===p.entity_id)) return p; return {...p, entity_id: clientEnts[0]?.id||null} })
  },[selectedClient,clientEnts])

  // Crea la tarea silenciosamente (sin cerrar el modal ni avisar) para habilitar el uploader
  const ensureTaskId = async() => {
    if(task?.id) return task.id
    if(draftRef.current) return draftRef.current
    const asg = f.assignees?.length?f.assignees:[user?.name||'Cristóbal']
    const payload = {title:f.title||'',who:asg[0],assignees:asg,entity_id:f.entity_id||null,due:f.due||null,status:f.status||'Activo',note:f.note||'',sale_id:f.sale_id||null,project:f.project?.trim()||null,subproject:f.subproject?.trim()||null,client_id:selectedClient?.id||null,assigned_by:f.assigned_by||user?.name||null}
    const {data,error} = await supabase.from('tasks').insert(payload).select().single()
    if(error) throw error
    draftRef.current = data.id; setDraftId(data.id)
    return data.id
  }
  const handleGuardar = () => {
    committedRef.current = true
    const asg = f.assignees?.length?f.assignees:[user?.name||'Cristóbal']
    onSave({...f, assignees:asg, who:asg[0], entity_id:f.entity_id||null, id: task?.id||draftRef.current||undefined, client_id:selectedClient.id, project:f.project?.trim()||null, subproject:f.subproject?.trim()||null, _isNew: !task?.id})
  }

  const matches = useMemo(()=>{
    if(!q.trim()) return []
    return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).slice(0,6)
  },[clients,q])

  // Proyectos existentes del cliente: de tareas + de ventas
  const clientProjects = useMemo(()=>{
    if(!selectedClient) return []
    const fromTasks = tasks.filter(t=>t.client_id===selectedClient.id&&t.project).map(t=>t.project)
    const fromSales = sales.filter(s=>s.client_id===selectedClient.id&&s.title).map(s=>s.title)
    return [...new Set([...fromSales,...fromTasks])].sort()
  },[tasks,sales,selectedClient])

  const clientSubprojects = useMemo(()=>{
    if(!selectedClient) return []
    const base = tasks.filter(t=>t.client_id===selectedClient.id&&t.subproject).map(t=>t.subproject)
    return [...new Set([...base, ...(f.subproject?[f.subproject]:[])])].sort()
  },[tasks,selectedClient,f.subproject])

  // Plazos rápidos (fecha local YYYY-MM-DD)
  const di = n => { const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
  const presets = [['Hoy',di(0)],['Mañana',di(1)],['En 7 días',di(7)]]
  const isCustomDue = f.due && !presets.some(p=>p[1]===f.due)

  // Clientes recientes (por última tarea creada) y conteo de tareas activas, para el paso de elección.
  const activosPorCliente = useMemo(()=>{ const m={}; tasks.forEach(t=>{ if(t.status==='Activo'&&t.client_id) m[t.client_id]=(m[t.client_id]||0)+1 }); return m },[tasks])
  const recientes = useMemo(()=>{
    const last={}; tasks.forEach(t=>{ if(t.client_id){ const k=t.created_at||''; if(!last[t.client_id]||k>last[t.client_id]) last[t.client_id]=k } })
    return Object.keys(last).sort((a,b)=>last[b]>last[a]?1:-1).map(id=>clients.find(c=>c.id===id)).filter(Boolean).slice(0,6)
  },[tasks,clients])
  const cIni = name => (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const subt = c => { const n=activosPorCliente[c.id]||0; return n>0?`${n} tarea${n!==1?'s':''} activa${n!==1?'s':''}`:(c.type||'—') }
  const ClientCard = c => (
    <button key={c.id} onClick={()=>{setSelectedClient(c);setQ('')}} style={{textAlign:'left',border:`0.5px solid ${C.border}`,borderRadius:10,padding:11,display:'flex',flexDirection:'column',gap:7,background:'#fff',cursor:'pointer'}}>
      <span style={{width:30,height:30,borderRadius:8,background:C.accent,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{cIni(c.name)}</span>
      <span style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',width:'100%'}}>{c.name}</span>
      <span style={{fontSize:10,color:C.muted}}>{subt(c)}</span>
    </button>
  )

  const selBox = {width:'100%',padding:'9px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none',appearance:'none',cursor:'pointer'}
  const pill = on => ({fontSize:12,fontWeight:on?600:500,padding:'6px 12px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?'#E6EEF1':'#F7F7F7',color:on?C.accent:C.muted,cursor:'pointer'})
  const ReqLabel = ({children}) => <span>{children} <span style={{color:C.overdue}}>*</span></span>

  const canSave = selectedClient && f.title?.trim() && f.project?.trim() && (!multiRS || f.subproject?.trim()) && (f.assignees?.length>0)

  // Roles para el flujo de delegación
  const me = user?.name || ''
  const esEdicion = !!task?.id
  const soyResponsable = esEdicion && isAssignee(task,me)   // el responsable puede editar Y delegar
  const yaDelegada = esEdicion && ((task.delegated_to||[]).length>0)

  // Regla dura: el nuevo plazo no puede exceder el original + 3 días.
  const addDaysISO = (iso,n)=>{ if(!iso) return ''; const [y,m,d]=iso.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` }
  const maxDelegDue = task?.due ? addDaysISO(task.due,3) : ''
  const delegDueOk = !!delegDue && (!maxDelegDue || delegDue<=maxDelegDue)
  const puedeDelegar = deleg && delegTo.length>0 && delegDueOk
  const toggleDelegTo = w => setDelegTo(a=>a.includes(w)?a.filter(x=>x!==w):[...a,w])
  const handleDelegar = () => { committedRef.current=true; onDelegate(task,{to:delegTo,due:delegDue}) }

  const DelegBanner = () => (
    <div style={{fontSize:12,color:'#854F0B',background:'#FAEEDA',borderRadius:8,padding:'9px 11px',marginBottom:14}}>
      <span style={{fontWeight:600}}>{task.delegated_by}</span> la delegó a <span style={{fontWeight:600}}>{(task.delegated_to||[]).join(', ')}</span>{task.delegated_due?` · vence ${task.delegated_due}`:''}
    </div>
  )

  return (
    <>
      <div className='qt-head' style={{display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${C.border}`,position:'sticky',top:0,background:C.surface,zIndex:2}}>
        <span style={{fontSize:16,fontWeight:600,color:C.accent,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>
          {task?'Editar tarea':'Nueva tarea'}
          {selectedClient&&<><span style={{color:C.done,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted,fontWeight:600}}>{selectedClient.name}</span></>}
        </span>
        <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,fontSize:24,cursor:'pointer',lineHeight:1}}>x</button>
      </div>

      <div className='qt-body'>
      {!selectedClient ? (
        <>
          <Fld label='Cliente'>
            <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Escribe para buscar cliente...' autoFocus/>
          </Fld>
          {(()=>{ const lista = q.trim()?matches:recientes; return lista.length>0 ? (
            <>
              {!q.trim()&&<div style={{fontSize:10,fontWeight:600,letterSpacing:.4,textTransform:'uppercase',color:C.muted,marginBottom:8}}>Recientes</div>}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{lista.map(ClientCard)}</div>
            </>
          ) : (
            <div style={{fontSize:13,color:C.muted,padding:'4px 0'}}>{q.trim()?`Sin resultados para "${q}"`:'Aún no hay clientes recientes. Escribe para buscar.'}</div>
          ) })()}
        </>
      ) : (
        <>
          {yaDelegada&&<DelegBanner/>}

          {multiRS ? (
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <Fld label='Razón social'>
                <select value={f.entity_id||''} onChange={e=>up('entity_id',e.target.value)} style={selBox}>
                  {clientEnts.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </Fld>
              <Fld label={<ReqLabel>Proyecto</ReqLabel>}>
                <div style={{position:'relative'}}>
                  <Inp value={f.project||''} onChange={e=>up('project',e.target.value)} onFocus={()=>setShowProjects(true)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} placeholder={clientProjects.length>0?'Elige o escribe...':'Nombre del proyecto...'}/>
                  {showProjects&&clientProjects.length>0&&(
                    <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                      {clientProjects.filter(p=>!f.project||p.toLowerCase().includes(f.project.toLowerCase())).map((p,i)=>(
                        <div key={i} onMouseDown={()=>up('project',p)} style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}} onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{p}</div>
                      ))}
                    </div>
                  )}
                </div>
              </Fld>
            </div>
          ) : (
            <Fld label={<ReqLabel>Proyecto</ReqLabel>}>
              <div style={{position:'relative'}}>
                <Inp value={f.project||''} onChange={e=>up('project',e.target.value)} onFocus={()=>setShowProjects(true)} onBlur={()=>setTimeout(()=>setShowProjects(false),150)} placeholder={clientProjects.length>0?'Elige uno existente o escribe uno nuevo...':'Nombre del proyecto...'}/>
                {showProjects&&clientProjects.length>0&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,marginTop:4,maxHeight:180,overflowY:'auto'}}>
                    {clientProjects.filter(p=>!f.project||p.toLowerCase().includes(f.project.toLowerCase())).map((p,i)=>(
                      <div key={i} onMouseDown={()=>up('project',p)} style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13,color:C.text}} onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{p}</div>
                    ))}
                  </div>
                )}
              </div>
            </Fld>
          )}

          {multiRS&&(
            <Fld label={<ReqLabel>Subproyecto</ReqLabel>}>
              {subNew ? (
                <div style={{display:'flex',gap:6}}>
                  <Inp value={f.subproject||''} onChange={e=>up('subproject',e.target.value)} placeholder='Nombre del subproyecto...' autoFocus/>
                  <button onClick={()=>{up('subproject','');setSubNew(false)}} style={{padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer',flexShrink:0}}>x</button>
                </div>
              ) : (
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {clientSubprojects.map(s=>(<button key={s} onClick={()=>up('subproject',s)} style={pill(f.subproject===s)}>{s}</button>))}
                  <button onClick={()=>{up('subproject','');setSubNew(true)}} style={{fontSize:12,padding:'6px 12px',borderRadius:20,border:`1px dashed ${C.done}`,background:'#fff',color:C.muted,cursor:'pointer'}}>+ Nuevo</button>
                </div>
              )}
            </Fld>
          )}

          <Fld label='Descripción de la tarea'><textarea value={f.title} onChange={e=>up('title',e.target.value)} placeholder='Describe la tarea...' rows={3} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:14,boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}}/></Fld>

          <Fld label='Responsables'>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {WHO.map(w=>{ const on=(f.assignees||[]).includes(w); return (
                <button key={w} onClick={()=>toggleResp(w)} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:on?600:500,padding:'5px 11px 5px 5px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?'#E6EEF1':'#F7F7F7',color:on?C.accent:C.muted,cursor:'pointer'}}>
                  <span style={{width:22,height:22,borderRadius:'50%',background:on?C.accent:C.done,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700}}>{INICIALES_RESP[w]||w.slice(0,2).toUpperCase()}</span>{w}
                </button>
              )})}
            </div>
          </Fld>

          <Fld label='Plazo'>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {presets.map(([lbl,iso])=>(<button key={iso} onClick={()=>{up('due',iso);setShowDate(false)}} style={pill(f.due===iso)}>{lbl}</button>))}
              <button onClick={()=>setShowDate(true)} style={pill(isCustomDue||showDate)}>Otra fecha</button>
              {(showDate||isCustomDue)&&<Inp type='date' value={f.due} onChange={e=>up('due',e.target.value)} style={{width:160}}/>}
            </div>
          </Fld>

          {(task?.id||selectedClient)&&(
            <div style={{marginTop:4}}>
              <Attachments table='task_attachments' idField='task_id' entityId={task?.id||draftId} ensureEntityId={ensureTaskId} folderKind='tareas'
                namePrefix={`${selectedClient?.name||'Sin cliente'} · ${f.title||'Tarea'}`} user={user}/>
            </div>
          )}
          {esEdicion&&soyResponsable&&(
            <>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 0',borderTop:`1px solid ${C.border}`,marginBottom:deleg?12:0}}>
                <div style={{fontSize:13,color:C.accent,fontWeight:500}}>Delegar</div>
                <button onClick={()=>setDeleg(v=>!v)} style={{width:42,height:24,borderRadius:20,background:deleg?C.accent:C.border,position:'relative',border:'none',cursor:'pointer',flexShrink:0,padding:0}}>
                  <span style={{position:'absolute',top:2,left:deleg?20:2,width:20,height:20,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
                </button>
              </div>
              {deleg&&(
                <>
                  <Fld label='Delegar a'>
                    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                      {WHO.filter(w=>w!==me).map(w=>{ const on=delegTo.includes(w); return (
                        <button key={w} onClick={()=>toggleDelegTo(w)} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,fontWeight:on?600:500,padding:'5px 11px 5px 5px',borderRadius:20,border:`1px solid ${on?C.accent:C.border}`,background:on?'#E6EEF1':'#F7F7F7',color:on?C.accent:C.muted,cursor:'pointer'}}>
                          <span style={{width:22,height:22,borderRadius:'50%',background:on?C.accent:C.done,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700}}>{INICIALES_RESP[w]||w.slice(0,2).toUpperCase()}</span>{w}
                        </button>
                      )})}
                    </div>
                  </Fld>
                  <Fld label='Nuevo plazo'>
                    <Inp type='date' value={delegDue} max={maxDelegDue||undefined} onChange={e=>setDelegDue(e.target.value)} style={{width:170}}/>
                    {maxDelegDue&&<div style={{fontSize:11,color:delegDue&&!delegDueOk?C.overdue:C.muted,marginTop:5}}>Máximo {maxDelegDue} (plazo original + 3 días){delegDue&&!delegDueOk?' — excede el límite':''}</div>}
                  </Fld>
                </>
              )}
            </>
          )}
        </>
      )}

      <div style={{display:'flex',gap:8,marginTop:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        {selectedClient&&(deleg ? (
          <button disabled={saving||!puedeDelegar} onClick={handleDelegar}
            style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:puedeDelegar?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:puedeDelegar?1:.6}}>
            {saving?<Spin/>:null}{saving?'Delegando...':'Delegar'}
          </button>
        ) : (
          <button disabled={saving||!canSave} onClick={handleGuardar}
            style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:canSave?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:canSave?1:.6}}>
            {saving?<Spin/>:null}{saving?'Guardando...':(task?'Guardar tarea':'Enviar tarea')}
          </button>
        ))}
      </div>
      </div>
    </>
  )
}

// Barra de tabs de la ficha de cliente (reutilizada por admin y limited; bloquea según rol)
function FichaTabs({tab,setTab,role}){
  const all=[['resumen','Resumen'],['contacto','Contacto'],['financiero','Financiero'],['documentos','Documentos']]
  // El limited solo ve Resumen y Contacto (Financiero/Documentos no se renderizan)
  const tabs = role==='admin' ? all : all.filter(([id])=>id==='resumen'||id==='contacto')
  return (
    <div style={{display:'flex',gap:4,marginTop:10}}>
      {tabs.map(([id,label])=>(
        <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:'7px 4px',borderRadius:8,border:`1px solid ${tab===id?C.accent:C.border}`,background:tab===id?'#E6EEF1':'transparent',color:tab===id?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{label}</button>
      ))}
    </div>
  )
}

// Tab "Contacto" de la ficha (reutilizado admin/limited): identificación + datos de
// contacto (edición inline en clients) + personas de contacto (CRUD en tabla contacts)
function ContactoTab({client, entities, onSaveFields}) {
  const fields = ['rut']
  const fromClient = () => fields.reduce((o,k)=>{o[k]=client[k]||'';return o},{})
  const [form,setForm] = useState(fromClient())
  const [savingF,setSavingF] = useState(false)
  useEffect(()=>{ setForm(fromClient()) },[client.id]) // recargar al cambiar de cliente

  const dirty = fields.some(k=>(form[k]||'')!==(client[k]||''))
  const set = (k,v)=>setForm(f=>({...f,[k]:v}))
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
    }catch(e){alert('Error: '+e.message)}
    setSavingC(false)
  }
  const eliminarContacto = async (c)=>{
    if(!confirm(`¿Eliminar a ${c.nombre}?`)) return
    const {error}=await supabase.from('contacts').delete().eq('id',c.id)
    if(error){alert('Error: '+error.message);return}
    setContacts(p=>p.filter(x=>x.id!==c.id))
  }
  const initials = (n)=> (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()

  const inp = {width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const lbl = {fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.4,marginBottom:4,display:'block'}
  const card = {marginBottom:16,padding:'14px 16px',borderRadius:12,background:C.card,border:`1px solid ${C.border}`}
  const sTitle = (t)=>(<div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:10}}>{t}</div>)
  // función (no componente) para no remontar el input y perder el foco al tipear
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )

  return (
    <div style={{padding:'16px 20px 60px'}}>
      {/* Identificación */}
      <div style={card}>
        {sTitle('Identificación')}
        <div style={{display:'grid',gap:10}}>
          <div>
            <label style={lbl}>Nombre cliente</label>
            <input value={client.name||'—'} disabled style={{...inp,background:'#F2F2F2',color:C.muted}}/>
            <div style={{fontSize:10,color:C.muted,marginTop:3}}>Para cambiarlo, usa "Editar".</div>
          </div>
          {field('RUT','rut','12.345.678-9')}
        </div>
        {entities&&entities.length>0&&(
          <div style={{marginTop:12,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:6}}>Razones sociales facturadas</div>
            {entities.map(e=>(
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',padding:'3px 0'}}>
                <span style={{fontSize:12,color:C.text}}>{e.name||'—'}</span>
                <span style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{e.rut}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {dirty&&(
        <div style={{display:'flex',gap:8,marginBottom:20}}>
          <button onClick={()=>setForm(fromClient())} disabled={savingF} style={{flex:1,padding:'10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Descartar</button>
          <button onClick={guardar} disabled={savingF} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:savingF?.6:1}}>{savingF?'Guardando...':'Guardar cambios'}</button>
        </div>
      )}

      {/* Personas de contacto */}
      <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600}}>Personas de contacto</div>
          {!showAdd&&<button onClick={()=>{setEdit(null);setCForm({nombre:'',cargo:'',email:'',telefono:''});setShowAdd(true)}} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Agregar</button>}
        </div>
        {loadingC&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Cargando...</div>}
        {!loadingC&&contacts.length===0&&!showAdd&&<div style={{fontSize:12,color:C.muted,padding:'6px 0'}}>Sin personas de contacto registradas.</div>}
        {contacts.map(c=>(
          <div key={c.id} style={{display:'flex',gap:10,alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${C.border}`}}>
            <div style={{width:34,height:34,borderRadius:'50%',background:'#E6EEF1',color:C.accent,fontSize:12,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{initials(c.nombre)}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>{c.nombre}{c.cargo&&<span style={{fontSize:11,fontWeight:400,color:C.muted}}> · {c.cargo}</span>}</div>
              <div style={{fontSize:11,color:C.muted,display:'flex',gap:8,flexWrap:'wrap'}}>
                {c.email&&<a href={`mailto:${c.email}`} style={{color:C.accent,textDecoration:'none'}}>{c.email}</a>}
                {c.telefono&&<span>{c.telefono}</span>}
              </div>
            </div>
            <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,padding:4}}>Editar</button>
            <button onClick={()=>eliminarContacto(c)} style={{background:'none',border:'none',color:C.overdue,cursor:'pointer',fontSize:13,padding:4}}>Eliminar</button>
          </div>
        ))}
        {showAdd&&(
          <div style={{marginTop:10,padding:'12px',borderRadius:10,background:'#F7F8F9',border:`1px solid ${C.border}`}}>
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
    </div>
  )
}

// Tab "Financiero" de la ficha (solo admin): KPIs de facturación, historial por año,
// razones sociales, datos de facturación y relación con el estudio (edición inline)
function FinancieroTab({client, clientBilling, entities, anticipos=[], billing=[], onNuevoAnticipo, onSaveFields}) {
  const real = (clientBilling||[]).filter(b=>b.billing_type!=='reembolso')
  const facturado = real.filter(b=>b.issued_at).reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = real.filter(b=>b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
  const porCobrar = real.filter(b=>['Pendiente','Vencido'].includes(b.status)).reduce((a,b)=>a+(b.amount||0),0)

  // Historial de facturación por año (emitidas)
  const emitidas = real.filter(b=>b.issued_at)
  const porAnio = {}
  emitidas.forEach(b=>{ const y=(b.issued_at||'').slice(0,4)||'—'; (porAnio[y]=porAnio[y]||[]).push(b) })
  const anios = Object.keys(porAnio).sort((a,b)=>b.localeCompare(a))

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
  const sTitle = (t)=>(<div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:10}}>{t}</div>)
  const field = (label,k,placeholder)=>(
    <div><label style={lbl}>{label}</label><input value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder||''} style={inp}/></div>
  )
  const STAT = {'Pagado':C.normal,'Pendiente':C.soon,'Vencido':C.overdue,'Programada':C.muted,'Propuesta':C.muted}

  return (
    <div style={{padding:'16px 20px 60px'}}>
      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:16}}>
        {[['Facturado',facturado,C.text],['Cobrado',cobrado,C.normal],['Por cobrar',porCobrar,porCobrar>0?C.soon:C.text]].map(([l,v,col])=>(
          <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.3}}>{l}</div>
            <div style={{fontSize:14,fontWeight:700,color:col}}>{fmt(v)}</div>
          </div>
        ))}
      </div>

      {/* Historial de facturación por año */}
      <div style={card}>
        {sTitle('Historial de facturación')}
        {emitidas.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Sin facturas emitidas.</div>}
        {anios.map(y=>{
          const rows=porAnio[y].slice().sort((a,b)=>(b.issued_at||'').localeCompare(a.issued_at||''))
          const tot=rows.reduce((a,b)=>a+(b.amount||0),0)
          return (
            <div key={y} style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{y}</div>
                <div style={{fontSize:11,color:C.muted}}>{fmt(tot)}</div>
              </div>
              {rows.map(b=>(
                <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>
                    <div style={{fontSize:10,color:C.muted}}>{fmtFechaDMY(b.issued_at)}{b.invoice_no?` · N° ${b.invoice_no}`:''}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text}}>{fmt(b.amount)}</div>
                    <div style={{fontSize:10,fontWeight:600,color:STAT[b.status]||C.muted}}>{b.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* Relación con el estudio */}
      <div style={card}>
        {sTitle('Relación con el estudio')}
        <div style={{display:'grid',gap:10}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <label style={lbl}>Cliente desde</label>
              <input value={client.created_at?new Date(client.created_at).toLocaleDateString('es-CL'):'—'} disabled style={{...inp,background:'#F2F2F2',color:C.muted}}/>
            </div>
            <div>
              <label style={lbl}>Tipo de servicio</label>
              <input value={client.type||'—'} disabled style={{...inp,background:'#F2F2F2',color:C.muted}}/>
            </div>
          </div>
          <div><label style={lbl}>Responsable</label><select value={form.abogado_responsable} onChange={e=>set('abogado_responsable',e.target.value)} style={inp}><option value=''>— Sin asignar —</option>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(a=><option key={a} value={a}>{a}</option>)}</select></div>
          <div>
            <label style={lbl}>Notas internas</label>
            <textarea value={form.notas_internas} onChange={e=>set('notas_internas',e.target.value)} rows={3} placeholder="Solo visibles para administración" style={{...inp,resize:'vertical',fontFamily:'inherit'}}/>
          </div>
        </div>
      </div>

      {dirty&&(
        <div style={{display:'flex',gap:8,marginBottom:20}}>
          <button onClick={()=>setForm(fromClient())} disabled={savingF} style={{flex:1,padding:'10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Descartar</button>
          <button onClick={guardar} disabled={savingF} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:savingF?.6:1}}>{savingF?'Guardando...':'Guardar cambios'}</button>
        </div>
      )}

      {/* Anticipos (PP-15 commit 2) */}
      {(()=>{
        const antDisp = anticipos.filter(a=>a.estado==='disponible')
        const totalDisp = antDisp.reduce((s,a)=>s+(a.monto||0),0)
        const antSorted = [...anticipos].sort((a,b)=>((a.estado==='disponible'?0:1)-(b.estado==='disponible'?0:1))||(b.fecha||'').localeCompare(a.fecha||''))
        const fmtF = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear() }catch(e){return iso||'—'} }
        return (
          <div style={{marginBottom:20}}>
            <div style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.5px',fontWeight:600,marginBottom:10}}>Anticipos</div>
            {antDisp.length>0&&(
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#F5F7F9',borderRadius:10,padding:'14px 16px',marginBottom:12}}>
                <div>
                  <div style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.5px',fontWeight:600}}>Anticipos disponibles</div>
                  <div style={{fontSize:24,fontWeight:500,color:C.normal,marginTop:3}}>{fmt(totalDisp)}</div>
                  <div style={{fontSize:11,color:'#99ABB4',marginTop:2}}>{antDisp.length} pago{antDisp.length!==1?'s':''} pendiente{antDisp.length!==1?'s':''} de facturar</div>
                </div>
                <button onClick={()=>onNuevoAnticipo&&onNuevoAnticipo()} style={{height:30,padding:'0 14px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:500,cursor:'pointer'}}>+ Registrar</button>
              </div>
            )}
            {antSorted.length===0?(
              <div style={{fontSize:12,color:'#99ABB4',padding:'2px 0'}}>Sin anticipos. <span onClick={()=>onNuevoAnticipo&&onNuevoAnticipo()} style={{color:C.accent,cursor:'pointer',fontWeight:600}}>+ Registrar</span></div>
            ):(<>
              <div style={{fontSize:10,color:'#99ABB4',textTransform:'uppercase',letterSpacing:'.4px',fontWeight:600,marginBottom:4}}>Detalle</div>
              {antSorted.map(a=>{ const disp=a.estado==='disponible'; const folio=billing.find(b=>String(b.id)===String(a.billing_id))?.invoice_no; return (
                <div key={a.id} style={{display:'flex',gap:12,alignItems:'center',padding:'11px 0',borderBottom:`0.5px solid ${C.border}`}}>
                  <div style={{width:36,height:36,borderRadius:10,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:disp?'#E1F5EE':'#F5F7F9'}}>
                    {disp
                      ? <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/></svg>
                      : <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:'#1a1a1a'}}>{fmt(a.monto)}</div>
                    <div style={{fontSize:11,color:'#99ABB4',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtF(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}{a.nota?` · ${a.nota}`:''}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    {!disp&&folio&&<span style={{fontSize:11,color:C.muted,textDecoration:'underline'}}>F° {folio}</span>}
                    <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,background:disp?'#E1F5EE':'#F5F7F9',color:disp?C.normal:'#99ABB4'}}>{disp?'Disponible':'Consumido'}</span>
                  </div>
                </div>
              )})}
            </>)}
          </div>
        )
      })()}
    </div>
  )
}

// Popup de correo para enviar una rendición al cliente (mailto + marca sent_at)
function RendicionEmailModal({r, client, user, expenses, onSent, onClose}) {
  const det = (expenses||[]).filter(e=>e.client_render_id===r.id).sort((a,b)=>(a.date||'')>(b.date||'')?1:-1)
  // Saldo del cliente (fondos − gastos). Negativo = el cliente debe al Estudio → se incluyen los datos bancarios.
  const saldoCliente = (expenses||[]).filter(e=>e.client_id===r.client_id).reduce((a,e)=>a+(e.type==='fondo'?(e.amount||0):-(e.amount||0)),0)
  const debeCliente = saldoCliente < 0
  const [para,setPara] = useState(client?.email||'')
  const [asunto,setAsunto] = useState(`Rendición de gastos ${client?.name||''} — ${r.periodo}`)
  const [sending,setSending] = useState(false)
  const buildHTML = () => {
    const A='#003C50',A2='#537281',A4='#E4E8EB'
    const rows = det.map(e=>`<tr><td style="padding:5px 8px;border-bottom:1px solid ${A4};white-space:nowrap">${fmtFechaDMY(e.date)}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${RENDCAT(e.category)}${e.subcategory?': '+e.subcategory:''}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4}">${e.concept||'—'}</td><td style="padding:5px 8px;border-bottom:1px solid ${A4};text-align:right;color:#E24B4A;white-space:nowrap">-${fmtN(e.amount)}</td></tr>`).join('')
    return `<div style="font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;font-size:13px"><div style="background:${A};color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center"><div><div style="font-size:14px;font-weight:700">Rendición de gastos</div><div style="font-size:11px;opacity:.85;margin-top:2px">${client?.name||''} · ${r.periodo}</div></div><img src="${logoBlanco}" alt="Liberona Escala Abogados" style="height:28px;display:block"/></div><table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px"><thead><tr style="background:${A4}"><th style="text-align:left;padding:6px 8px">Fecha</th><th style="text-align:left;padding:6px 8px">Categoría</th><th style="text-align:left;padding:6px 8px">Descripción</th><th style="text-align:right;padding:6px 8px">Monto</th></tr></thead><tbody>${rows}</tbody><tfoot><tr style="font-weight:700"><td colspan="3" style="padding:8px;border-top:2px solid ${A2}">TOTAL RENDIDO</td><td style="padding:8px;border-top:2px solid ${A2};text-align:right;color:#E24B4A">-${fmtN(r.total)}</td></tr></tfoot></table><div style="margin-top:14px;font-size:12px">Atentamente,<br/><strong>${user?.name||''}</strong><br/>Liberona Escala Abogados</div></div>`
  }
  const cuerpoCorreo = () => {
    const lineas = det.map(e=>`• ${fmtFechaDMY(e.date)} · ${RENDCAT(e.category)}${e.subcategory?': '+e.subcategory:''} · ${e.concept||'—'} · -${fmtN(e.amount)}`).join('\n')
    const banco = debeCliente ? `

Producto de esta rendición resulta un saldo a su cargo de ${fmtN(Math.abs(saldoCliente))}. Le agradeceremos efectuar la transferencia a la cuenta que indicamos a continuación, señalando su nombre en el comentario y enviando el comprobante a administracion@leabogados.cl:

  Titular: Liberona Escala Abogados Ltda.
  RUT: 77.700.387-9
  Banco: Banco BICE
  Cuenta Corriente: 138392-2` : ''
    return `Estimado/a ${client?.name||'cliente'}:

Esperando que se encuentre muy bien, le hacemos llegar la rendición de los gastos incurridos durante el período ${r.periodo||''}, en el marco de la gestión encomendada. En el documento adjunto encontrará el respaldo de cada desembolso.

${lineas}

Total rendido: -${fmtN(r.total)}${banco}

Cualquier consulta, quedamos a su entera disposición.

Saludos cordiales,
${user?.name||''}
Liberona Escala Abogados`
  }
  const enviar = async() => {
    if(!para.trim()){ alert('Falta el email del cliente.'); return }
    const texto = cuerpoCorreo()
    setSending(true)
    try{
      // Envío directo con PDF adjunto vía Gmail API (si el token tiene el scope gmail.send)
      let conAdjunto = false
      const token = await driveToken()
      if(token){
        try{
          const pdf = await rendicionPdfBase64(r, client, det, user, debeCliente, Math.abs(saldoCliente))
          await sendGmailWithPdf(token, {to:para.trim(), subject:asunto, bodyText:texto, pdfBase64:pdf, pdfName:`Rendicion ${(client?.name||'').replace(/[^\w\s-]/g,'')} ${r.periodo||''}`.trim()+'.pdf'})
          conAdjunto = true
        }catch(_){ /* sin scope gmail.send (403) u otro: caemos al fallback */ }
      }
      if(!conAdjunto){
        const gmailUrl=`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(para.trim())}&su=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`
        const win=window.open(gmailUrl,'_blank')
        if(!win) window.location.href=`mailto:${para.trim()}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`
      }
      const now = new Date().toISOString()
      await supabase.from('rendiciones').update({sent_at:now}).eq('id',r.id)
      onSent && onSent(r.id, now)
      if(conAdjunto) alert('Rendición enviada al cliente con el PDF adjunto.')
      onClose()
    }catch(e){ alert('Error: '+e.message) }
    setSending(false)
  }
  return (
    <Modal title='Enviar rendición al cliente' onClose={onClose} closeOnBackdrop={false}>
      {!client?.email && <div style={{padding:'8px 10px',borderRadius:8,background:'#FEF6EE',border:'1px solid #F5E2CC',color:'#C77F18',fontSize:12,marginBottom:12}}>El cliente no tiene email en su ficha. Complétalo (botón Editar del cliente) o escríbelo abajo antes de enviar.</div>}
      <Fld label='De'><Inp value={user?.email||''} disabled style={{opacity:.7}}/></Fld>
      <Fld label='Para'><Inp type='email' value={para} onChange={e=>setPara(e.target.value)} placeholder='correo@cliente.cl'/></Fld>
      <Fld label='Asunto'><Inp value={asunto} onChange={e=>setAsunto(e.target.value)}/></Fld>
      <Lbl>Resumen</Lbl>
      <div style={{border:`1px solid ${C.border}`,borderRadius:8,padding:10,maxHeight:240,overflowY:'auto',marginBottom:14}} dangerouslySetInnerHTML={{__html:buildHTML()}}/>
      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button onClick={enviar} disabled={sending||!para.trim()} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:(sending||!para.trim())?.6:1}}>{sending?'Enviando...':'Enviar'}</button>
      </div>
    </Modal>
  )
}

function ClientFicha({client,clients,sales,billing,expenses,tasks,clientEntities,anticipos,onNuevoAnticipo,onEdit,onClose,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onRendicion,rendiciones,onAnularRendicion,user,onRendicionSent,onSaveFields}) {
  const [emailRend,setEmailRend] = useState(null)
  const [ftab,setFtab] = useState('resumen')
  const ufState = useUF()
  const ufRef = ufState.uf || sales.find(s=>s.uf_value)?.uf_value || 40000
  const clientSales = sales.filter(s=>s.client_id===client.id&&s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada')
  const clientBilling = billing.filter(b=>b.client_id===client.id)
  const clientExpenses = expenses.filter(e=>e.client_id===client.id)
  const clientTasks = tasks.filter(t=>t.client_id===client.id&&t.status!=='Terminado')

  // Vendido UF: misma fuente que Dashboard/Ventas (recurrentes x12, CLP convertido a UF)
  const vendidoUF = clientSales.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const facturado = clientBilling.reduce((a,b)=>a+(b.amount||0),0)
  const cobrado = clientBilling.filter(b=>b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
  const porCobrar = clientBilling.filter(b=>['Pendiente','Vencido'].includes(b.status))
  const totalPorCobrar = porCobrar.reduce((a,b)=>a+(b.amount||0),0)
  const fondos = clientExpenses.filter(e=>e.type==='fondo').reduce((a,e)=>a+e.amount,0)
  const gastos = clientExpenses.filter(e=>e.type==='gasto').reduce((a,e)=>a+e.amount,0)
  const saldoFondos = fondos - gastos

  // Tareas agrupadas por proyecto
  const taskGroups = {}
  clientTasks.forEach(t=>{ const k=t.project||'__none__'; if(!taskGroups[k])taskGroups[k]=[]; taskGroups[k].push(t) })

  const CATS = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Registro Civil':'#EDE3F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}

  return (
    <div style={{paddingBottom:100}}>
      {/* Header */}
      <div style={{padding:'20px 20px 12px',position:'sticky',top:0,background:C.bg,zIndex:10,borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:20,lineHeight:1,padding:'0 4px 0 0'}}>←</button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:18,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client.name}</div>
            <div style={{fontSize:11,color:C.muted,display:'flex',alignItems:'center',gap:6}}>
              {client.type}
              {client.status==='Terminado'&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#ECECEC',color:C.muted,fontWeight:600}}>Terminado</span>}
              {client.status==='Prospecto'&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#FFF4E0',color:'#C77F18',fontWeight:600}}>Prospecto</span>}
            </div>
          </div>
          <button onClick={()=>onEdit(client)} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12,fontWeight:600,cursor:'pointer'}}>Editar</button>
        </div>
        <FichaTabs tab={ftab} setTab={setFtab} role="admin"/>
      </div>

      <div style={{padding:'16px 20px 0',display:ftab==='resumen'?'block':'none'}}>

        {/* Razones sociales vinculadas */}
        {(()=>{
          const entities = (clientEntities||[]).filter(e=>e.client_id===client.id)
          if(!entities.length) return null
          return (
            <div style={{marginBottom:16,padding:'10px 14px',borderRadius:10,background:'#F7F7F7',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,textTransform:'uppercase',letterSpacing:.5,fontWeight:600,marginBottom:8}}>Razones sociales facturadas</div>
              {entities.map(e=>(
                <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.text}}>{e.name||'—'}</div>
                  <div style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{e.rut}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* Resumen financiero */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:20}}>
          {[
            ['Vendido',vendidoUF>0?fmtUF(vendidoUF):'—','#E3EEF3',C.accent],
            ['Por cobrar',totalPorCobrar>0?fmt(totalPorCobrar):'$0',totalPorCobrar>0?'#FBE9E7':'#F7F7F7',totalPorCobrar>0?C.overdue:C.muted],
            ['Cobrado',fmt(cobrado),'#E4F1EA',C.normal],
            ['Saldo fondos',fmt(saldoFondos),saldoFondos<0?'#FBE9E7':'#E4F1EA',saldoFondos<0?C.overdue:C.normal],
          ].map(([l,v,bg,col])=>(
            <div key={l} style={{background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,fontWeight:600}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700,color:col}}>{v}</div>
            </div>
          ))}
        </div>

        {/* Ventas */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Ventas</div>
          </div>
          {clientSales.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin ventas registradas</div>}
          {clientSales.map(s=>{
            const saleTasks = clientTasks.filter(t=>t.project===s.title)
            return (
            <div key={s.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div>
                <div style={{display:'flex',gap:6,marginTop:2,alignItems:'center'}}>
                  <AreaChip area={s.area}/>
                  <span style={{fontSize:10,color:C.muted}}>{s.year}</span>
                  <Pill label={s.status} bg={s.status==='Activo'?C.accent:s.status==='Propuesta'?'#537281':s.status==='Borrador'?'#E8CC6A':s.status==='Rechazada'?C.overdue:s.status==='Terminado'?C.done:'#C77F18'} color={s.status==='Borrador'?'#4A3800':undefined} small/>
                  {saleTasks.length>0&&<span style={{fontSize:10,color:C.muted}}>{saleTasks.length} tarea{saleTasks.length!==1?'s':''}</span>}
                </div>
              </div>
              {s.amount_uf>0&&<div style={{fontSize:13,fontWeight:700,color:C.accent,flexShrink:0,marginLeft:12}}>{fmtUF(s.amount_uf)}</div>}
            </div>
          )})}
        </div>

        {/* Cobros pendientes */}
        {porCobrar.length>0&&(
          <div style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>Cobros pendientes</div>
              <button onClick={onAddBilling} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Nuevo</button>
            </div>
            {(()=>{
              const sorted = [...porCobrar].sort((a,b)=>{const ra=(a.receptor_name||'').toLowerCase(),rb=(b.receptor_name||'').toLowerCase();if(ra!==rb)return ra.localeCompare(rb,'es');return new Date(a.issued_at||0)-new Date(b.issued_at||0)})
              const groups = []
              sorted.forEach(b=>{
                const key = b.receptor_name||'Sin razón social'
                const g = groups.find(g=>g.name===key)
                if(g) g.items.push(b)
                else groups.push({name:key, rut:b.receptor_rut||null, items:[b]})
              })
              return groups.map(g=>{
                const sinRS = g.name==='Sin razón social'
                const col = sinRS ? C.soon : C.accent
                return (
                <div key={g.name} style={{marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`2px solid ${col}`}}>
                    <div style={{fontSize:11,fontWeight:700,color:col,textTransform:'uppercase',letterSpacing:.3,display:'flex',alignItems:'center',gap:6}}>{g.name}{g.rut?` · ${g.rut}`:''}{sinRS&&<span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:8,background:'#FEF6EE',color:C.soon,letterSpacing:0}}>asignar</span>}</div>
                    <div style={{fontSize:11,fontWeight:700,color:col}}>{fmt(g.items.reduce((a,b)=>a+(b.amount||0),0))}</div>
                  </div>
                  {g.items.map(b=>(
                    <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontSize:13,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'—'}</div>
                        <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                          <span>{b.invoice_no||'—'}</span>
                          <span>·</span>
                          <DaysBadge due={b.due} status={b.status}/>
                        </div>
                      </div>
                      <div style={{fontSize:13,fontWeight:700,color:b.status==='Vencido'?C.overdue:C.text,flexShrink:0,marginLeft:12}}>{fmt(b.amount)}</div>
                    </div>
                  ))}
                </div>
              )})
            })()}
          </div>
        )}

        {/* Gastos y fondos */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Gastos y Fondos</div>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>onAddFondo(client)} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.normal,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Fondo</button>
              <button onClick={()=>onAddGasto(client)} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Gasto</button>
            </div>
          </div>
          {clientExpenses.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin movimientos</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
            <div style={{background:'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>FONDOS</div>
              <div style={{fontSize:12,fontWeight:700,color:C.normal}}>{fmt(fondos)}</div>
            </div>
            <div style={{background:'#FBE9E7',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>GASTOS</div>
              <div style={{fontSize:12,fontWeight:700,color:C.overdue}}>{fmt(gastos)}</div>
            </div>
            <div style={{background:saldoFondos<0?'#FBE9E7':'#E4F1EA',borderRadius:8,padding:'8px 10px'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:2}}>SALDO</div>
              <div style={{fontSize:12,fontWeight:700,color:saldoFondos<0?C.overdue:C.normal}}>{fmt(saldoFondos)}</div>
            </div>
          </div>
          {clientExpenses.slice(0,5).map(e=>{
            const isFondo=e.type==='fondo'
            const catBg=CATS[e.category]||CATS['Otro']
            return (
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                <div style={{minWidth:0,flex:1,display:'flex',gap:6,alignItems:'center'}}>
                  {!isFondo&&e.category&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:catBg,color:'#537281',fontWeight:600,flexShrink:0}}>{e.category}</span>}
                  {isFondo&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#E4F1EA',color:C.normal,fontWeight:600,flexShrink:0}}>Fondo</span>}
                  {!isFondo&&e.client_rendered_at&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:3,background:'#E4F1EA',color:'#0F6E56',fontWeight:600,flexShrink:0}}>Rendido</span>}
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</span>
                </div>
                <div style={{fontSize:12,fontWeight:600,color:isFondo?C.normal:C.overdue,flexShrink:0,marginLeft:8}}>{isFondo?'+':'-'}{fmt(e.amount)}</div>
              </div>
            )
          })}
          {clientExpenses.length>5&&<div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'8px 0'}}>+{clientExpenses.length-5} más en Gastos y Fondos</div>}
          {clientExpenses.length>0&&(
            <button onClick={()=>onRendicion(client)} style={{marginTop:8,width:'100%',padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ Rendir fondos</button>
          )}
          {(()=>{
            const rends=(rendiciones||[]).filter(r=>r.client_id===client.id&&r.tipo==='cliente').sort((a,b)=>b.created_at>a.created_at?1:-1)
            if(!rends.length) return null
            return (<div style={{marginTop:12}}>
              <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Rendiciones</div>
              {rends.map(r=>(
                <div key={r.id} style={{padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,color:C.text}}>{r.periodo}</div>
                      <div style={{fontSize:10,color:C.muted}}>{r.n_gastos} gasto{r.n_gastos!==1?'s':''} · {new Date(r.created_at).toLocaleDateString('es-CL')}{r.user_name?` · ${r.user_name}`:''}</div>
                      {r.sent_at
                        ? <div style={{fontSize:10,fontWeight:600,color:'#0F6E56',marginTop:2}}>Enviada {new Date(r.sent_at).toLocaleDateString('es-CL')}</div>
                        : <div style={{fontSize:10,fontWeight:600,color:'#C77F18',marginTop:2}}>Pendiente de envío</div>}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.overdue}}>-{fmt(r.total)}</div>
                      {onAnularRendicion&&<button onClick={()=>onAnularRendicion(r)} style={{fontSize:10,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:5,padding:'2px 7px',cursor:'pointer'}}>Anular</button>}
                    </div>
                  </div>
                  <button onClick={()=>setEmailRend(r)} style={{marginTop:6,padding:'4px 10px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>{r.sent_at?'Reenviar al cliente':'Enviar al cliente'}</button>
                </div>
              ))}
            </div>)
          })()}
        </div>

        {/* Proyectos y Tareas */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text}}>Proyectos y Tareas</div>
            <button onClick={onAddTask} style={{padding:'4px 10px',borderRadius:6,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
          </div>
          {clientTasks.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin tareas activas</div>}

          {/* Proyectos nombrados */}
          {Object.keys(taskGroups).filter(k=>k!=='__none__').map(key=>{
            const taskList = taskGroups[key]
            const overdueN = taskList.filter(t=>urgency(t.due,t.status)==='overdue').length
            const urgentN = taskList.filter(t=>urgency(t.due,t.status)==='urgent').length
            return (
              <div key={key} style={{marginBottom:12,borderRadius:10,border:`1px solid ${C.border}`,overflow:'hidden',background:C.card}}>
                <div style={{padding:'10px 14px',background:'#F0F5F7',borderBottom:`1px solid ${C.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>{key}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    {overdueN>0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.overdue,borderRadius:10,padding:'1px 7px'}}>{overdueN} venc.</span>}
                    {urgentN>0&&overdueN===0&&<span style={{fontSize:10,fontWeight:700,color:'#fff',background:C.soon,borderRadius:10,padding:'1px 7px'}}>{urgentN} urg.</span>}
                    <span style={{fontSize:11,color:C.muted}}>{taskList.length} tarea{taskList.length!==1?'s':''}</span>
                  </div>
                </div>
                {taskList.map(t=>(
                  <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'9px 14px',borderBottom:`1px solid ${C.border}`}}>
                    <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                      <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                        <span>{taskAssignees(t).join(', ')||'—'}</span>
                        {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                        {t.note&&<><span>·</span><span style={{fontStyle:'italic',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.note}</span></>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}

          {/* Tareas sin proyecto */}
          {taskGroups['__none__']&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Sin proyecto</div>
              {taskGroups['__none__'].map(t=>(
                <div key={t.id} style={{display:'flex',gap:8,alignItems:'flex-start',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{width:7,height:7,borderRadius:'50%',background:urgencyColor(t.due,t.status),flexShrink:0,marginTop:4}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:C.text,fontWeight:500}}>{t.title}</div>
                    <div style={{fontSize:11,color:C.muted,display:'flex',gap:6,marginTop:2}}>
                      <span>{taskAssignees(t).join(', ')||'—'}</span>
                      {t.due&&<><span>·</span><DaysBadge due={t.due} status={t.status}/></>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
      {ftab==='contacto'&&<ContactoTab client={client} entities={(clientEntities||[]).filter(e=>e.client_id===client.id)} onSaveFields={onSaveFields}/>}
      {ftab==='financiero'&&<FinancieroTab client={client} clientBilling={clientBilling} entities={(clientEntities||[]).filter(e=>e.client_id===client.id)} anticipos={(anticipos||[]).filter(a=>a.client_id===client.id)} billing={billing} onNuevoAnticipo={()=>onNuevoAnticipo&&onNuevoAnticipo(client)} onSaveFields={onSaveFields}/>}
      {ftab==='documentos'&&<div style={{padding:'40px 20px',textAlign:'center'}}><div style={{fontSize:13,color:C.muted}}>Documentos — segunda etapa</div></div>}
      {emailRend&&<RendicionEmailModal r={emailRend} client={client} user={user} expenses={expenses} onSent={onRendicionSent} onClose={()=>setEmailRend(null)}/>}
    </div>
  )
}

function ClientsView({clients,sales,billing,expenses,tasks,clientEntities,anticipos,onNuevoAnticipo,onToggleStatus,onEdit,onAdd,onAddTask,onAddGasto,onAddFondo,onAddSale,onAddBilling,onImportDrive,setExpenses,setRendiciones,rendiciones,user,onSaveFields,onRendicionComplete}) {

  const handleAnularRendicion = async(r) => {
    if(!confirm('\u00bfAnular esta rendici\u00f3n?')) return
    try {
      await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('client_render_id',r.id)
      await supabase.from('rendiciones').delete().eq('id',r.id)
      if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==r.id))
      if(setExpenses) setExpenses(p=>p.map(e=>e.client_render_id===r.id?{...e,client_rendered_at:null,client_render_id:null}:e))
    } catch(e) { alert('Error: '+e.message) }
  }
  const [sFilter,setSFilter] = useState('Activo')
  const [respSel,setRespSel] = useState(()=>new Set())
  const toggleResp = r => setRespSel(p=>{const n=new Set(p);n.has(r)?n.delete(r):n.add(r);return n})
  const [q,setQ] = useState('')
  const [selected,setSelected] = useState(null)
  const [rendicionClient,setRendicionClient] = useState(null)

  // Actualizar selected cuando cambian los datos
  useEffect(()=>{ if(selected) setSelected(clients.find(c=>c.id===selected.id)||null) },[clients])

  const activeN=clients.filter(c=>!c.is_internal&&(c.status||'Activo')==='Activo').length
  const endedN=clients.filter(c=>!c.is_internal&&c.status==='Terminado').length
  const prospectoN=clients.filter(c=>!c.is_internal&&c.status==='Prospecto').length
  // Responsable de un cliente = responsable de su venta más reciente (campo responsible en sales)
  const responsableDe = useMemo(()=>{ const m={}; clients.forEach(c=>{ if(c.abogado_responsable) m[c.id]=c.abogado_responsable }); [...sales].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).forEach(s=>{ if(s.responsible&&s.client_id&&!m[s.client_id]) m[s.client_id]=s.responsible }); return m },[clients,sales])
  const responsables = useMemo(()=>[...new Set(Object.values(responsableDe))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es')),[responsableDe])
  const tareasDe = useMemo(()=>{ const m={}; tasks.forEach(t=>{ if(t.client_id&&t.status!=='Terminado') m[t.client_id]=(m[t.client_id]||0)+1 }); return m },[tasks])
  const cl = useMemo(()=>{
    let base = clients
    if(sFilter==='Activo') base=base.filter(c=>(c.status||'Activo')==='Activo')
    else if(sFilter==='Terminado') base=base.filter(c=>c.status==='Terminado')
    else if(sFilter==='Prospecto') base=base.filter(c=>c.status==='Prospecto')
    if(q.trim()) base=base.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()))
    if(respSel.size>0) base=base.filter(c=>respSel.has(responsableDe[c.id]))
    return [...base].sort((a,b)=>{ const ta=tareasDe[a.id]||0,tb=tareasDe[b.id]||0; if((ta>0)!==(tb>0)) return tb>0?1:-1; return tb-ta })
  },[clients,sFilter,q,respSel,responsableDe,tareasDe])
  const balances = useMemo(()=>{
    const m={}; expenses.forEach(e=>{ m[e.client_id]=(m[e.client_id]||0)+(e.type==='fondo'?e.amount:-e.amount) }); return m
  },[expenses])

  if(selected) return (
    <>
      <ClientFicha
        client={selected}
        onSaveFields={onSaveFields}
        clients={clients}
        sales={sales}
        billing={billing}
        expenses={expenses}
        tasks={tasks}
        clientEntities={clientEntities}
        anticipos={anticipos}
        onNuevoAnticipo={onNuevoAnticipo}
        onEdit={c=>{onEdit(c)}}
        onClose={()=>setSelected(null)}
        onAddTask={()=>onAddTask(selected)}
        onAddGasto={()=>onAddGasto(selected)}
        onAddFondo={()=>onAddFondo(selected)}
        onAddSale={()=>onAddSale(selected)}
        onAddBilling={()=>onAddBilling(selected)}
        onRendicion={c=>setRendicionClient(c)}
        rendiciones={rendiciones}
        onAnularRendicion={handleAnularRendicion}
        user={user}
        onRendicionSent={(id,at)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at}:x))}
      />
      {rendicionClient&&<Modal title={`Rendición — ${rendicionClient.name}`} onClose={()=>setRendicionClient(null)} closeOnBackdrop={false}><RendicionModal client={rendicionClient} expenses={expenses} clientEntities={clientEntities} onClose={()=>setRendicionClient(null)} setExpenses={setExpenses} onRendicionComplete={onRendicionComplete||((r)=>setRendiciones(p=>[r,...p]))} onEnviar={r=>{setRendicionClient(null);setEmailRend(r)}}/></Modal>}
    </>
  )

  return (
    <div>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clientes</div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={onImportDrive} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5}}><DriveIcon size={13}/>Drive</button>
            <button onClick={onAdd} style={{padding:'6px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Cliente</button>
            <button onClick={()=>onAddTask(null)} style={{padding:'6px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Tarea</button>
          </div>
        </div>
        <div style={{fontSize:12,color:C.muted,margin:'4px 0 10px'}}>{cl.length} {cl.length===1?'cliente':'clientes'}</div>
        <Inp value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente...' style={{marginBottom:8}}/>
        {sFilter ? (
          <div style={{display:'flex',gap:6,marginBottom:4,alignItems:'center',flexWrap:'wrap'}}>
            <button onClick={()=>{setSFilter(null);setRespSel(new Set())}} style={{padding:'7px 14px',borderRadius:8,border:`1px solid ${C.accent}`,background:'#E6EEF1',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>{({Activo:'Activos',Prospecto:'Prospectos',Terminado:'Terminados',all:'Todos'})[sFilter]}</button>
            {responsables.map(r=>{ const on=respSel.has(r); return (
              <button key={r} onClick={()=>toggleResp(r)} title={r} style={{minWidth:34,height:30,padding:'0 9px',borderRadius:8,border:`0.5px solid ${on?'#99ABB4':'#E4E8EB'}`,background:on?'#E4E8EB':'#fff',color:on?'#003C50':'#537281',fontSize:12,fontWeight:on?600:500,letterSpacing:'.3px',cursor:'pointer'}}>{INICIALES_RESP[r]||r.slice(0,2).toUpperCase()}</button>
            )})}
          </div>
        ) : (
          <div style={{display:'flex',gap:6,marginBottom:4}}>
            {[['Activo','Activos'],['Prospecto','Prospectos'],['Terminado','Terminados'],['all','Todos']].map(([v,l])=>(
              <button key={v} onClick={()=>{setSFilter(v);setRespSel(new Set())}} style={{flex:1,padding:'7px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {cl.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin clientes</div>}
        {cl.map(c=>{
          const ended=c.status==='Terminado'
          const activeSales=sales.filter(s=>s.client_id===c.id&&s.status==='Activo').length
          const cp=billing.filter(b=>b.client_id===c.id&&['Pendiente','Vencido'].includes(b.status)).reduce((s,b)=>s+(b.amount||0),0)
          const hasOverdue=billing.some(b=>b.client_id===c.id&&b.status==='Vencido')
          const balance=balances[c.id]||0
          const tareasC=tareasDe[c.id]||0
          return (
            <div key={c.id} onClick={()=>setSelected(c)} style={{background:C.card,borderRadius:respSel.size>0&&tareasC>0?'0 10px 10px 0':10,padding:'13px 16px',marginBottom:8,border:`1px solid ${C.border}`,borderLeft:respSel.size>0&&tareasC>0?'2.5px solid #B8860B':`3px solid ${ended?C.done:hasOverdue?C.overdue:C.accent}`,opacity:ended?.7:1,cursor:'pointer'}}
              onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 12px rgba(0,0,0,.09)'}
              onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:4}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.text,marginBottom:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>{c.name}{c.is_internal&&<span style={{fontSize:9,fontWeight:700,color:C.muted,background:'#F0F0F0',borderRadius:4,padding:'1px 6px',textTransform:'uppercase',letterSpacing:.4}}>Interno</span>}{tareasC>0&&<span style={{fontSize:10,fontWeight:600,color:'#B8860B',background:'#FFF8E1',borderRadius:20,padding:'1px 8px'}}>{tareasC} {tareasC===1?'tarea':'tareas'}</span>}</div>
                  <div style={{fontSize:11,color:C.muted}}>{c.type}{c.rut?` · ${c.rut}`:''}</div>
                </div>
                <button onClick={ev=>{ev.stopPropagation();onToggleStatus(c)}} style={{flexShrink:0,padding:'4px 10px',borderRadius:20,border:`1px solid ${ended?C.border:C.normal}`,background:ended?'#ECECEC':'transparent',color:ended?C.muted:C.normal,fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{ended?'Reactivar':'Terminar'}</button>
              </div>
              <div style={{display:'flex',gap:12,fontSize:11,flexWrap:'wrap'}}>
                {!ended&&<span style={{color:C.accent}}>{activeSales} ventas activas</span>}
                {cp>0&&<span style={{color:hasOverdue?C.overdue:C.soon,fontWeight:600}}>{fmt(cp)} por cobrar</span>}
                {balance!==0&&<span style={{color:balance<0?C.overdue:C.normal,fontWeight:600}}>Fondos: {fmt(balance)}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EntitiesEditor({clientId}) {
  const [list,setList]=useState(null)
  const [allEntities,setAll]=useState([])
  const [name,setName]=useState('')
  const [rut,setRut]=useState('')
  const [suggestions,setSugg]=useState([])
  const [showSugg,setShowSugg]=useState(false)
  const [edit,setEdit]=useState(null)
  const [busy,setBusy]=useState(false)
  const sortN=arr=>[...arr].sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))
  useEffect(()=>{
    let ok=true
    getClientEntities(clientId).then(d=>ok&&setList(d)).catch(()=>ok&&setList([]))
    getAllEntities().then(d=>ok&&setAll(d)).catch(()=>{})
    return ()=>{ok=false}
  },[clientId])
  const handleNameChange=val=>{
    setName(val); if(val.trim().length<2){setSugg([]);setShowSugg(false);return}
    const m=allEntities.filter(e=>e.name.toLowerCase().includes(val.toLowerCase())).slice(0,6)
    setSugg(m);setShowSugg(m.length>0)
  }
  const add=async()=>{
    if(!name.trim()) return; setBusy(true)
    try {
      const saved=await upsertClientEntity({client_id:clientId,name:name.trim(),rut:rut.trim()||null})
      setList(p=>sortN([...(p||[]),saved]));setName('');setRut('');setSugg([]);setShowSugg(false)
    } catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }
  const saveEdit=async()=>{
    if(!edit.name.trim()) return; setBusy(true)
    try {
      const saved=await upsertClientEntity({id:edit.id,client_id:clientId,name:edit.name.trim(),rut:edit.rut?.trim()||null})
      setList(p=>sortN(p.map(x=>x.id===saved.id?saved:x)));setEdit(null)
    } catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }
  const del=async id=>{
    if(!confirm('Eliminar?')) return
    try{await deleteClientEntity(id);setList(p=>p.filter(x=>x.id!==id))}catch(e){alert(e.message)}
  }
  const huerfanas = (allEntities||[]).filter(e=>!e.client_id)
  const asignar=async(ent)=>{ setBusy(true); try{ const saved=await upsertClientEntity({id:ent.id,client_id:clientId,name:ent.name,rut:ent.rut}); setList(p=>sortN([...(p||[]),saved])); setAll(p=>p.filter(x=>x.id!==ent.id)) }catch(e){alert('Error: '+e.message)} setBusy(false) }
  const inS={padding:'8px 10px',borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none'}
  const iconBtn=col=>({width:30,height:30,flexShrink:0,borderRadius:7,border:`1px solid ${C.border}`,background:'#fff',color:col,fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'})
  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <Lbl>Razones sociales</Lbl>
      {list===null&&<div style={{fontSize:12,color:C.muted}}>Cargando...</div>}
      {list?.map(e=>(
        <div key={e.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
          {edit?.id===e.id?(
            <>
              <input value={edit.name} onChange={ev=>setEdit({...edit,name:ev.target.value})} style={{...inS,flex:1,minWidth:0}}/>
              <input value={edit.rut||''} onChange={ev=>setEdit({...edit,rut:ev.target.value})} style={{...inS,width:110,flexShrink:0}}/>
              <button onClick={saveEdit} disabled={busy} style={iconBtn(C.normal)}>ok</button>
              <button onClick={()=>setEdit(null)} style={iconBtn(C.muted)}>x</button>
            </>
          ):(
            <>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
                {e.rut&&<div style={{fontSize:11,color:C.muted}}>{e.rut}</div>}
              </div>
              <button onClick={()=>setEdit({id:e.id,name:e.name,rut:e.rut})} style={iconBtn(C.accent)}>ed</button>
              <button onClick={()=>del(e.id)} style={iconBtn(C.overdue)}>x</button>
            </>
          )}
        </div>
      ))}
      {huerfanas.length>0&&(
        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.4,marginBottom:6}}>Sin cliente asignado · {huerfanas.length}</div>
          {huerfanas.map(e=>(
            <div key={e.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.name}</div>
                {e.rut&&<div style={{fontSize:11,color:C.muted}}>{e.rut}</div>}
              </div>
              <button onClick={()=>asignar(e)} disabled={busy} style={{padding:'5px 11px',borderRadius:7,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:busy?'not-allowed':'pointer',flexShrink:0}}>+ Asignar</button>
            </div>
          ))}
        </div>
      )}
      <div style={{marginTop:8}}>
        <div style={{display:'flex',gap:6,position:'relative'}}>
          <div style={{flex:1,minWidth:0,position:'relative'}}>
            <input value={name} onChange={e=>handleNameChange(e.target.value)} onBlur={()=>setTimeout(()=>setShowSugg(false),150)} placeholder='Razon social...' style={{...inS,width:'100%'}}/>
            {showSugg&&suggestions.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:7,boxShadow:'0 4px 16px rgba(0,0,0,.10)',zIndex:100,maxHeight:200,overflowY:'auto',marginTop:2}}>
                {suggestions.map((s,i)=>(
                  <div key={i} onMouseDown={()=>{setName(s.name);setRut(s.rut||'');setSugg([]);setShowSugg(false)}} style={{padding:'8px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{s.name}</div>
                    {s.rut&&<div style={{fontSize:11,color:C.muted}}>{s.rut}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input value={rut} onChange={e=>setRut(e.target.value)} placeholder='RUT' style={{...inS,width:110,flexShrink:0}}/>
          <button onClick={add} disabled={busy||!name.trim()} style={{padding:'0 12px',borderRadius:7,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:name.trim()?'pointer':'not-allowed',opacity:name.trim()?1:.6,flexShrink:0}}>+</button>
        </div>
      </div>
    </div>
  )
}

// ─── CONTACTS EDITOR (colapsable, dentro de la ficha) ─────────────────────────
// Personas de contacto del cliente con CRUD manual y exportación a .vcf (vCard).
// El .vcf es la unica via de llevar contactos a la libreta del iPhone (Safari iOS
// no expone la libreta para importar; ver memoria). Al abrir un .vcf, iOS ofrece
// "Agregar a Contactos".
const vEsc = s => String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')
const vCard = (c,org) => [
  'BEGIN:VCARD','VERSION:3.0',
  `N:${vEsc(c.nombre)};;;;`,`FN:${vEsc(c.nombre)}`,
  org?`ORG:${vEsc(org)}`:null, c.cargo?`TITLE:${vEsc(c.cargo)}`:null,
  c.email?`EMAIL;TYPE=INTERNET:${vEsc(c.email)}`:null,
  c.telefono?`TEL;TYPE=CELL:${vEsc(c.telefono)}`:null,
  'END:VCARD',
].filter(Boolean).join('\r\n')
const descargarVCF = (texto,nombreArchivo) => {
  const blob=new Blob([texto],{type:'text/vcard;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=nombreArchivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function ContactsEditor({clientId,clientName}) {
  const [contacts,setContacts]=useState(null)
  const [open,setOpen]=useState(false)
  const [showAdd,setShowAdd]=useState(false)
  const [edit,setEdit]=useState(null)
  const [cForm,setCForm]=useState({nombre:'',cargo:'',email:'',telefono:''})
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    let ok=true
    supabase.from('contacts').select('*').eq('client_id',clientId).order('created_at')
      .then(({data,error})=>{ if(ok&&!error) setContacts(data||[]); else if(ok) setContacts([]) })
    return ()=>{ok=false}
  },[clientId])
  const reset=()=>{ setCForm({nombre:'',cargo:'',email:'',telefono:''}); setShowAdd(false); setEdit(null) }
  const startEdit=c=>{ setEdit(c); setCForm({nombre:c.nombre||'',cargo:c.cargo||'',email:c.email||'',telefono:c.telefono||''}); setShowAdd(true) }
  const guardar=async()=>{
    if(!cForm.nombre.trim()) return; setBusy(true)
    try{
      if(edit){
        const {data,error}=await supabase.from('contacts').update({...cForm,nombre:cForm.nombre.trim()}).eq('id',edit.id).select().single()
        if(error)throw error; setContacts(p=>p.map(x=>x.id===data.id?data:x))
      }else{
        const {data,error}=await supabase.from('contacts').insert({client_id:clientId,...cForm,nombre:cForm.nombre.trim()}).select().single()
        if(error)throw error; setContacts(p=>[...(p||[]),data])
      }
      reset()
    }catch(e){alert('Error: '+e.message)}
    setBusy(false)
  }
  const eliminar=async c=>{
    if(!confirm(`¿Eliminar a ${c.nombre}?`)) return
    const {error}=await supabase.from('contacts').delete().eq('id',c.id)
    if(error){alert('Error: '+error.message);return}
    setContacts(p=>p.filter(x=>x.id!==c.id))
  }
  const initials=n=>(n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const slug=s=>(s||'contacto').trim().replace(/\s+/g,'-').replace(/[^\w\-]/g,'').toLowerCase()
  const exportarUno=c=>descargarVCF(vCard(c,clientName),`${slug(c.nombre)}.vcf`)
  const exportarTodos=()=>descargarVCF((contacts||[]).map(c=>vCard(c,clientName)).join('\r\n'),`${slug(clientName)}-contactos.vcf`)
  const inp={width:'100%',padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',fontSize:13,boxSizing:'border-box',outline:'none',color:C.text}
  const n=contacts?.length||0
  return (
    <div style={{marginBottom:14,padding:14,borderRadius:10,border:`1px solid ${C.border}`,background:'#FAFAFA'}}>
      <div onClick={()=>setOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
        <Lbl>Contactos{n>0?` · ${n}`:''}</Lbl>
        <span style={{marginLeft:'auto',color:C.muted,fontSize:12,transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}>▸</span>
      </div>
      {open&&(
        <div style={{marginTop:8}}>
          {contacts===null&&<div style={{fontSize:12,color:C.muted}}>Cargando...</div>}
          {contacts!==null&&n===0&&!showAdd&&<div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>Sin contactos registrados.</div>}
          {(contacts||[]).map(c=>(
            <div key={c.id} style={{display:'flex',gap:9,alignItems:'center',padding:'8px 0',borderBottom:`1px solid ${C.border}`}}>
              <div style={{width:32,height:32,borderRadius:'50%',background:'#E6EEF1',color:C.accent,fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{initials(c.nombre)}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.nombre}{c.cargo&&<span style={{fontSize:11,fontWeight:400,color:C.muted}}> · {c.cargo}</span>}</div>
                {(c.email||c.telefono)&&<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{[c.email,c.telefono].filter(Boolean).join(' · ')}</div>}
              </div>
              <button onClick={()=>exportarUno(c)} title='Exportar (.vcf)' style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:11,fontWeight:600,padding:'2px 4px',flexShrink:0}}>Exportar</button>
              <button onClick={()=>startEdit(c)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:11,padding:'2px 4px',flexShrink:0}}>Editar</button>
              <button onClick={()=>eliminar(c)} style={{background:'none',border:'none',color:C.overdue,cursor:'pointer',fontSize:11,padding:'2px 4px',flexShrink:0}}>×</button>
            </div>
          ))}
          {showAdd?(
            <div style={{marginTop:10,padding:12,borderRadius:10,background:'#fff',border:`1px solid ${C.border}`}}>
              <div style={{display:'grid',gap:8}}>
                <input autoFocus value={cForm.nombre} onChange={e=>setCForm(f=>({...f,nombre:e.target.value}))} placeholder='Nombre *' style={inp}/>
                <input value={cForm.cargo} onChange={e=>setCForm(f=>({...f,cargo:e.target.value}))} placeholder='Cargo' style={inp}/>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <input value={cForm.email} onChange={e=>setCForm(f=>({...f,email:e.target.value}))} placeholder='Email' style={inp}/>
                  <input value={cForm.telefono} onChange={e=>setCForm(f=>({...f,telefono:e.target.value}))} placeholder='Teléfono' style={inp}/>
                </div>
                <div style={{display:'flex',gap:8,marginTop:2}}>
                  <button onClick={reset} disabled={busy} style={{flex:1,padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                  <button onClick={guardar} disabled={busy||!cForm.nombre.trim()} style={{flex:2,padding:8,borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',opacity:(busy||!cForm.nombre.trim())?.6:1}}>{busy?'Guardando...':(edit?'Guardar':'Agregar')}</button>
                </div>
              </div>
            </div>
          ):(
            <div style={{display:'flex',gap:8,marginTop:10}}>
              <button onClick={()=>{setEdit(null);setCForm({nombre:'',cargo:'',email:'',telefono:''});setShowAdd(true)}} style={{flex:1,padding:'7px 10px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer'}}>+ Agregar contacto</button>
              {n>1&&<button onClick={exportarTodos} style={{padding:'7px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Exportar todos</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ClientForm({client,onSave,onClose,onDelete,saving,sales}) {
  const [f,setF]=useState(client||{name:'',rut:'',type:'',email:'',phone:'',contact:'',erasmo:false,abogado_responsable:'',status:'Activo',ended_at:'',notes:''})
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const stColor=f.status==='Terminado'?C.overdue:f.status==='Prospecto'?C.soon:C.normal
  const ini=INICIALES_RESP[f.abogado_responsable]
  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
        <div style={{width:48,height:48,flexShrink:0,borderRadius:12,background:C.accent,color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700}}>{(f.name||'?').charAt(0).toUpperCase()}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name?.trim()||'Nuevo cliente'}</div>
          <div style={{display:'flex',gap:6,marginTop:5,flexWrap:'wrap'}}>
            <span style={{fontSize:11,fontWeight:600,color:stColor,background:stColor+'1A',padding:'2px 9px',borderRadius:20}}>{f.status||'Activo'}</span>
            {ini&&<span style={{fontSize:11,fontWeight:600,color:C.muted,background:C.border,padding:'2px 9px',borderRadius:20,letterSpacing:'.3px'}}>{ini}</span>}
            {f.is_internal&&<span style={{fontSize:11,fontWeight:600,color:C.muted,background:C.border,padding:'2px 9px',borderRadius:20}}>Interno</span>}
          </div>
        </div>
      </div>
      <Fld label='Nombre'><Inp value={f.name||''} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='RUT'><Inp value={f.rut||''} onChange={e=>up('rut',e.target.value)} placeholder='76.217.569-K'/></Fld>
        <Fld label='Tipo'><Sel value={f.type||''} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral']} placeholder='— Seleccionar —'/></Fld>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Email'><Inp type='email' value={f.email||''} onChange={e=>up('email',e.target.value)} placeholder='correo@...'/></Fld>
        <Fld label='Telefono'><Inp value={f.phone||''} onChange={e=>up('phone',e.target.value)} placeholder='+56...'/></Fld>
      </div>
      <Fld label='Contacto'><Inp value={f.contact||''} onChange={e=>up('contact',e.target.value)} placeholder='Persona de contacto...'/></Fld>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Prospecto','Terminado']}/></Fld>
        {f.status==='Terminado'&&<Fld label='Fecha termino'><Inp type='date' value={f.ended_at||''} onChange={e=>up('ended_at',e.target.value)}/></Fld>}
      </div>
      <Fld label='Responsable'>
        <Sel value={f.abogado_responsable||''} onChange={e=>up('abogado_responsable',e.target.value)} options={['Cristóbal','Erasmo','Martín','Martina','Rodrigo']} placeholder='— Sin asignar —'/>
      </Fld>
      <Fld label='Interno (gastos de oficina)'>
        <button type='button' onClick={()=>up('is_internal',!f.is_internal)} style={{padding:'9px 14px',borderRadius:8,border:`1px solid ${f.is_internal?C.accent:C.border}`,background:f.is_internal?'#E6EEF1':'transparent',color:f.is_internal?C.accent:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>
          {f.is_internal?'Cliente interno (no cuenta como cliente de negocio)':'Marcar como interno'}
        </button>
      </Fld>
      <Fld label='Notas'><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Contexto relevante...'/></Fld>
      {client?.id?<EntitiesEditor clientId={client.id}/>:<div style={{fontSize:11,color:C.muted,marginBottom:14}}>Guarda el cliente para agregar razones sociales.</div>}
      {client?.id&&<ContactsEditor clientId={client.id} clientName={f.name||client.name}/>}
      <div style={{display:'flex',gap:8,marginTop:4}}>
        {client?.id&&<button onClick={()=>onDelete(client.id)} style={{padding:'11px 14px',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.name?.trim()} onClick={()=>onSave(f)} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:!f.name?.trim()?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
      </div>
    </>
  )
}

// ─── PARSER + DRIVE IMPORTER (sin cambios) ───────────────────────────────────
const MESES={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12}
function parseInvoice(raw) {
  // pdfjs entrega texto plano sin saltos reales
  const t = raw.replace(/\r?\n/g,' ').replace(/\s{2,}/g,' ')
  // DEBUG temporal: ver el texto real extraido
  // Folio
  const folioM = t.match(/N[\xba\xb0o]?\s*(\d{3,7})/)
  const folio = folioM ? folioM[1] : null

  // Receptor
  const receptorM = t.match(/SE[N\u00d1]OR(?:\(ES\))?:?\s*(.+?)\s*R\.?U\.?T\.?:/)
  const cliente = receptorM ? receptorM[1].trim() : null

  // RUT receptor
  const rutZone = t.match(/SE[N\u00d1]OR(?:\(ES\))?:?.+?R\.?U\.?T\.?:?\s*([\d\.]{7,11}\s*[-\u2013]\s*[\dkK])/)
  const rut = rutZone ? rutZone[1].replace(/\s/g,'') : null

  // Fecha
  let issued_at = null
  const fechaM = t.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+de[l]?\s+(\d{4})/i)
  if(fechaM) {
    const dia = parseInt(fechaM[1])
    const mes = MESES[fechaM[2].toLowerCase()]
    const anio = parseInt(fechaM[3])
    if(mes) issued_at = `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`
  }

  // Glosa
  let concepto = null
  const gM = t.match(/Valor\s*[-\u2013]\s*(.+?)\s+1\s+[\d][\d\.]{3,}/)
  if(gM) concepto = gM[1].replace(/\s+/g,' ').trim()
  if(!concepto){const gM2 = t.match(/[-\u2013]\s+([A-Za-z\u00c0-\u00ff].{8,90}?)\s+1\s+[\d][\d\.]{3,}/);if(gM2) concepto = gM2[1].replace(/\s+/g,' ').trim()}

  // Total
  const totalM = t.match(/TOTAL\s*\$?\s*([\d\.]{4,12})/)
  const total = totalM ? parseInt(totalM[1].replace(/\./g,'')) : null

  return { folio, cliente, rut, issued_at, concepto, total }
}
const FACTURACION_ROOT='1GtcDmnq2FpGQlaZRETyOU4Zwf5MfCi7V'
const CLIENTES_ROOT='19JsFeh9icekmXMKyubkbLxfXVujmc3eh'
const CLIENTES_TERMINADOS_ROOT='1_wi0td0ib9QlBLjUvDkr6QzdLn1sPwGX'
async function driveGet(token,url){
  const fullUrl=url+(url.includes('?')?'&':'?')+'supportsAllDrives=true&includeItemsFromAllDrives=true'
  const r=await fetch(fullUrl,{headers:{Authorization:'Bearer '+token}})
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive API error '+r.status)
  return r.json()
}

// ── DRIVE: escritura de adjuntos (carpeta compartida "Respaldo Gastos APP") ──────
const ADJUNTOS_ROOT='1iuWqAB9UNZfDSqj5MSeTTngPaplzBTEH'
// Error de token de Drive vencido/ausente → gatilla reconexión
class DriveAuthError extends Error { constructor(){ super('drive_auth'); this.code=401 } }
// Token de Drive: localStorage → sesión
async function driveToken(){
  let t=localStorage.getItem('drive_token')
  if(!t){ try{ t=await getDriveToken() }catch(_){} }
  return t||null
}

// ── GMAIL API: enviar rendición con PDF adjunto. Requiere el scope gmail.send en el login
//    (agregar a supabase.js cuando esté habilitado en Google Cloud Console). Sin ese scope,
//    la API devuelve 403 y el modal cae al fallback de Gmail compose (sin adjunto). ──
// PDF de la rendición (jsPDF) → base64 sin el prefijo dataURL
async function rendicionPdfBase64(r, client, det, user, debeCliente=false, saldoMonto=0){
  const { jsPDF } = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm')
  const doc = new jsPDF({unit:'pt', format:'letter'})
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(0,60,80); doc.rect(0,0,W,74,'F')
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(16)
  doc.text('Rendición de gastos', 40, 34)
  doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text(`${client?.name||''} · ${r.periodo||''}`, 40, 54)
  doc.setFont('helvetica','bold'); doc.setFontSize(12)
  doc.text('LIBERONA ESCALA ABOGADOS', W-40, 44, {align:'right'})
  let y = 108
  doc.setTextColor(83,114,129); doc.setFont('helvetica','bold'); doc.setFontSize(8.5)
  doc.text('FECHA', 40, y); doc.text('DETALLE', 135, y); doc.text('MONTO', W-40, y, {align:'right'})
  y += 8; doc.setDrawColor(228,232,235); doc.setLineWidth(1); doc.line(40,y,W-40,y); y += 18
  ;(det||[]).forEach(e=>{
    doc.setFont('helvetica','normal'); doc.setFontSize(10.5); doc.setTextColor(61,61,61)
    doc.text(fmtFechaDMY(e.date), 40, y)
    doc.text(String(e.concept||'—').slice(0,46), 135, y)
    doc.setFont('helvetica','bold'); doc.setTextColor(226,75,74)
    doc.text('-'+fmtN(e.amount), W-40, y, {align:'right'})
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(83,114,129)
    doc.text((RENDCAT(e.category)+(e.subcategory?': '+e.subcategory:'')).slice(0,58), 135, y+12)
    y += 27
    if(y > 700){ doc.addPage(); y = 60 }
  })
  doc.setDrawColor(83,114,129); doc.setLineWidth(1.5); doc.line(40,y,W-40,y); y += 20
  doc.setTextColor(61,61,61); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('TOTAL RENDIDO', 40, y)
  doc.setTextColor(226,75,74); doc.text('-'+fmtN(r.total), W-40, y, {align:'right'})
  // Datos bancarios SOLO si el cliente debe al Estudio (saldo a su cargo)
  if(debeCliente){
    y += 36
    doc.setTextColor(61,61,61); doc.setFont('helvetica','bold'); doc.setFontSize(10.5)
    doc.text(`Saldo a su cargo: ${fmtN(saldoMonto)}`, 40, y); y += 18
    doc.setFontSize(9.5); doc.text('Transferir a:', 40, y); y += 15
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(83,114,129)
    ;['Titular: Liberona Escala Abogados Ltda.','RUT: 77.700.387-9','Banco: Banco BICE','Cuenta Corriente: 138392-2','Confirmación: administracion@leabogados.cl'].forEach(l=>{ doc.text(l,40,y); y += 14 })
  }
  y += 22; doc.setTextColor(61,61,61); doc.setFont('helvetica','normal'); doc.setFontSize(10)
  doc.text('Atentamente,', 40, y); y += 15
  doc.setFont('helvetica','bold'); doc.text(user?.name||'', 40, y); y += 14
  doc.setFont('helvetica','normal'); doc.text('Liberona Escala Abogados', 40, y)
  return doc.output('datauristring').split(',')[1]
}
// Construye el MIME multipart y lo envía con la API de Gmail
async function sendGmailWithPdf(token, {to, subject, bodyText, pdfBase64, pdfName}){
  const b64 = s => btoa(unescape(encodeURIComponent(s)))
  const boundary = 'lea_'+Date.now()
  const mime = [
    `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`, 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(bodyText), '',
    `--${boundary}`, `Content-Type: application/pdf; name="${pdfName}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${pdfName}"`, '', pdfBase64, '',
    `--${boundary}--`
  ].join('\r\n')
  const raw = btoa(unescape(encodeURIComponent(mime))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body: JSON.stringify({raw})
  })
  if(!res.ok){ const err=new Error('Gmail API '+res.status); err.code=res.status; throw err }
  return res.json()
}
// Busca subcarpeta por nombre dentro de parentId; si no existe, la crea. Devuelve su id.
async function driveFindOrCreateFolder(token, parentId, name){
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
async function driveAdjuntosFolders(token){
  let tareas=localStorage.getItem('drive_folder_tareas')
  let gastos=localStorage.getItem('drive_folder_gastos')
  if(!tareas){ tareas=await driveFindOrCreateFolder(token,ADJUNTOS_ROOT,'Tareas'); localStorage.setItem('drive_folder_tareas',tareas) }
  if(!gastos){ gastos=await driveFindOrCreateFolder(token,ADJUNTOS_ROOT,'Gastos'); localStorage.setItem('drive_folder_gastos',gastos) }
  return {tareas,gastos}
}
// Sube un File con upload resumable (aguanta 15 MB). Devuelve {id,name,webViewLink}.
async function driveUpload(token, folderId, file, name){
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
// Manda un archivo a la papelera de Drive.
async function driveTrash(token, fileId){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,{
    method:'PATCH',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({trashed:true})
  })
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive papelera '+r.status)
}

// Bloque "Archivos" reutilizable (tareas y gastos). Sube a Drive y registra en `table`.
function Attachments({table, idField, entityId, ensureEntityId, folderKind, namePrefix, user, onChange}) {
  const [items,setItems] = useState([])
  const [busy,setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(()=>{
    if(!entityId) return
    supabase.from(table).select('*').eq(idField,entityId).order('created_at',{ascending:true}).then(({data})=>setItems(data||[]))
  },[entityId])
  const reconnect = () => { alert('Tu acceso a Drive expiró. Te llevo a reconectar Drive; al volver, vuelve a adjuntar el archivo.'); connectDrive() }
  const onPick = async(e) => {
    const file = e.target.files?.[0]; if(!file) return
    e.target.value=''
    if(file.size > 15*1024*1024){ alert(`El archivo pesa ${(file.size/1048576).toFixed(1)} MB y supera el límite de 15 MB. Súbelo a Drive manualmente y pega el link como comentario.`); return }
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
      else alert('Error al subir: '+(err.message||err))
    }
    setBusy(false)
  }
  const del = async(a) => {
    if(!confirm('¿Eliminar este archivo? Se enviará a la papelera de Drive.')) return
    try{
      const token = await driveToken()
      if(token && a.drive_file_id){ try{ await driveTrash(token, a.drive_file_id) }catch(err){ if(err instanceof DriveAuthError){ reconnect(); return } } }
      await supabase.from(table).delete().eq('id',a.id)
      setItems(p=>p.filter(x=>x.id!==a.id)); onChange&&onChange(-1, a)
    }catch(err){ alert('Error al eliminar: '+(err.message||err)) }
  }
  return (
    <div style={{marginBottom:12}}>
      <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>Archivos {items.length>0&&`(${items.length})`}</div>
      {items.map(a=>(
        <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
          <span style={{flexShrink:0}}>Adjunto</span>
          <a href={a.url||'#'} target='_blank' rel='noreferrer' style={{flex:1,fontSize:12,color:C.accent,textDecoration:'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name||'archivo'}</a>
          <a href={a.url||'#'} target='_blank' rel='noreferrer' style={{fontSize:10,color:C.muted,textDecoration:'none',flexShrink:0}}>Abrir</a>
          <button onClick={()=>del(a)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,flexShrink:0}}>×</button>
        </div>
      ))}
      <input ref={inputRef} type='file' onChange={onPick} style={{display:'none'}}/>
      <button onClick={()=>inputRef.current?.click()} disabled={busy} style={{marginTop:8,padding:'7px 12px',borderRadius:8,border:`1px dashed ${C.border}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:busy?'default':'pointer',opacity:busy?.6:1,display:'inline-flex',alignItems:'center',gap:6}}>
        {busy?<Spin/>:<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>}{busy?'Subiendo...':'Adjuntar archivo'}
      </button>
      <div style={{fontSize:10,color:C.muted,marginTop:4}}>Máx. 15 MB · se guarda en Drive (Respaldo Gastos APP)</div>
    </div>
  )
}
function ClienteDriveImporter({clients,onImported,onClose}){
  const [step,setStep]=useState('loading')
  const [token,setToken]=useState(null)
  const [newClients,setNewClients]=useState([])
  const [terminados2024,setTerminados2024]=useState([])
  const [terminados2025,setTerminados2025]=useState([])
  const [selected,setSelected]=useState({})
  const [saving,setSaving]=useState(false)
  const [log,setLog]=useState([])
  const addLog=msg=>setLog(p=>[...p,msg])

  useEffect(()=>{init()},[])

  async function init(){
    setStep('loading')
    let t=localStorage.getItem('drive_token')
    if(!t){try{t=await getDriveToken()}catch(e){}}
    if(!t){setStep('notoken');return}
    setToken(t)
    try{
      // Clientes activos
      const resActivos=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      const activos=(resActivos.files||[]).filter(f=>!f.name.startsWith('1. CLIENTES'))
      const existingNames=clients.map(c=>c.name.toLowerCase().trim())
      const nuevos=activos.filter(f=>!existingNames.includes(f.name.toLowerCase().trim()))
      setNewClients(nuevos)

      // Clientes terminados - buscar subcarpetas 2024 y 2025
      const resTerminados=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${CLIENTES_TERMINADOS_ROOT}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
      const yearFolders=resTerminados.files||[]

      for(const yf of yearFolders){
        const resYear=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${yf.id}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
        const yearClients=(resYear.files||[]).filter(f=>!existingNames.includes(f.name.toLowerCase().trim()))
        if(yf.name.includes('2024')) setTerminados2024(yearClients)
        if(yf.name.includes('2025')) setTerminados2025(yearClients)
      }
      setStep('review')
    }catch(e){setStep('error');addLog('Error: '+e.message)}
  }

  const toggle=(id)=>setSelected(p=>({...p,[id]:!p[id]}))
  const toggleAll=(list)=>{
    const allSelected=list.every(f=>selected[f.id])
    const upd={...selected}
    list.forEach(f=>{upd[f.id]=!allSelected})
    setSelected(upd)
  }

  const saveSelected=async()=>{
    const toImport=[...newClients,...terminados2024,...terminados2025].filter(f=>selected[f.id])
    if(!toImport.length) return
    setSaving(true);setStep('saving')
    let imported=0
    for(const f of toImport){
      const isTerminado=terminados2024.find(x=>x.id===f.id)||terminados2025.find(x=>x.id===f.id)
      const payload={name:f.name,area:isTerminado?'Terminado':''}
      const {error}=await supabase.from('clients').insert(payload)
      if(!error){imported++;addLog(`${f.name}`)}
      else addLog(`Error: ${f.name}: ${error.message}`)
    }
    addLog(`─────────────────`)
    addLog(`${imported} clientes importados`)
    setStep('done')
    onImported()
    setSaving(false)
  }

  const allNew=[...newClients,...terminados2024,...terminados2025]
  const selectedCount=allNew.filter(f=>selected[f.id]).length

  return (
    <div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando con Drive...</p></div>}
      {step==='notoken'&&<div style={{textAlign:'center',padding:20}}><p style={{fontSize:13,marginBottom:16}}>Necesitas autorizar Drive.</p><button onClick={()=>getDriveToken().then(t=>{setToken(t);init()})} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Autorizar Drive</button></div>}
      {step==='error'&&<div style={{padding:20}}>{log.map((l,i)=><div key={i} style={{fontSize:12,color:C.overdue}}>{l}</div>)}</div>}
      {(step==='review'||step==='saving')&&(
        <div>
          {/* Clientes nuevos */}
          {newClients.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>Clientes nuevos ({newClients.length})</div>
                <button onClick={()=>toggleAll(newClients)} style={{fontSize:11,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{newClients.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {newClients.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#E6EEF1':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?C.accent:C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?C.accent:C.border}`,background:selected[f.id]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2024 */}
          {terminados2024.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2024 ({terminados2024.length})</div>
                <button onClick={()=>toggleAll(terminados2024)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2024.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2024.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?'#C77F18':C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?'#C77F18':C.border}`,background:selected[f.id]?'#C77F18':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:'#C77F18',fontWeight:600,marginLeft:'auto'}}>2024</span>
                </div>
              ))}
            </div>
          )}
          {/* Terminados 2025 */}
          {terminados2025.length>0&&(
            <div style={{marginBottom:16}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Terminados 2025 ({terminados2025.length})</div>
                <button onClick={()=>toggleAll(terminados2025)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>{terminados2025.every(f=>selected[f.id])?'Deseleccionar todos':'Seleccionar todos'}</button>
              </div>
              {terminados2025.map(f=>(
                <div key={f.id} onClick={()=>toggle(f.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,marginBottom:4,background:selected[f.id]?'#F7F2EC':'#F7F7F7',cursor:'pointer',border:`1px solid ${selected[f.id]?'#C77F18':C.border}`}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected[f.id]?'#C77F18':C.border}`,background:selected[f.id]?'#C77F18':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {selected[f.id]&&<span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                  </div>
                  <span style={{fontSize:13,color:C.text}}>{f.name}</span>
                  <span style={{fontSize:10,color:'#C77F18',fontWeight:600,marginLeft:'auto'}}>2025</span>
                </div>
              ))}
            </div>
          )}
          {newClients.length===0&&terminados2024.length===0&&terminados2025.length===0&&(
            <div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Todos los clientes de Drive ya están en la app</div>
          )}
          <div style={{display:'flex',gap:8,marginTop:8,position:'sticky',bottom:0,background:C.bg,paddingBottom:8}}>
            <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
            <button onClick={saveSelected} disabled={saving||selectedCount===0} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:selectedCount===0?.5:1}}>
              {saving?'Importando...':`Importar ${selectedCount} cliente${selectedCount!==1?'s':''}`}
            </button>
          </div>
        </div>
      )}
      {step==='done'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:12}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <button onClick={onClose} style={{width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        </div>
      )}
    </div>
  )
}

function DriveImporter({clients,billing,onImported,onClose,clientEntities}){
  const [step,setStep]=useState('init')
  const [token,setToken]=useState(null)
  const [years,setYears]=useState([])
  const [months,setMonths]=useState([])
  const [selYear,setSelYear]=useState(null)
  const [unmatched,setUnmatched]=useState([])
  const [assignments,setAssignments]=useState({})
  const [log,setLog]=useState([])
  const [progress,setProgress]=useState({done:0,total:0})
  const addLog=msg=>setLog(p=>[...p,msg])
  useEffect(()=>{init()},[])
  async function init(){
    setStep('loading')
    let t=localStorage.getItem('drive_token')
    if(!t){try{t=await getDriveToken()}catch(e){}}
    if(!t){setStep('notoken');return}
    setToken(t)
    try{
      const q0=encodeURIComponent(`'${FACTURACION_ROOT}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)
      const res=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q=${q0}&orderBy=name&fields=files(id,name)`)
      setYears(res.files||[]);setStep('selectMonth')
    }catch(e){setStep('error')}
  }
  async function loadMonths(yearId){
    setSelYear(yearId)
    const res=await driveGet(token,`https://www.googleapis.com/drive/v3/files?q='${yearId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&orderBy=name&fields=files(id,name)`)
    setMonths(res.files||[])
  }
  async function importMonth(monthId,monthName){
    setStep('importing');setLog([`Importando ${monthName}...`])
    const t=token
    const res=await driveGet(t,`https://www.googleapis.com/drive/v3/files?q='${monthId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name)`)
    const pdfs=res.files||[];setProgress({done:0,total:pdfs.length});addLog(`${pdfs.length} PDFs encontrados`)
    const results={imported:0,skipped:0,errors:0,rows:[]}
    for(let i=0;i<pdfs.length;i++){
      const pdf=pdfs[i]
      try{
        const binRes=await fetch(`https://www.googleapis.com/drive/v3/files/${pdf.id}?alt=media`,{headers:{Authorization:`Bearer ${t}`}})
        const arrayBuf=await binRes.arrayBuffer()
        let raw=''
        try{
          const pdfDoc=await pdfjsLib.getDocument({data:arrayBuf}).promise
          for(let p=1;p<=pdfDoc.numPages;p++){const page=await pdfDoc.getPage(p);const tc=await page.getTextContent();raw+=tc.items.map(i=>i.str).join(' ')+'\n'}
        }catch(e){raw=new TextDecoder('latin1').decode(arrayBuf)}
        const parsed=parseInvoice(raw)
        const exists=billing.some(b=>b.invoice_no===parsed.folio)
        if(exists){results.skipped++;addLog(`skip ${pdf.name}`);setProgress(p=>({...p,done:p.done+1}));continue}
        let mc=null
        // 1. Buscar en clientEntities por RUT (aprendizaje previo)
        if(parsed.rut){
          const ce=clientEntities.find(e=>normRut(e.rut)===normRut(parsed.rut))
          if(ce) mc=clients.find(c=>c.id===ce.client_id)
        }
        // 2. Buscar en clientEntities por nombre
        if(!mc&&parsed.cliente){
          const ce=clientEntities.find(e=>e.name?.toLowerCase()===parsed.cliente?.toLowerCase())
          if(ce) mc=clients.find(c=>c.id===ce.client_id)
        }
        // 3. Buscar en clients por rut directo
        if(!mc&&parsed.rut)mc=clients.find(c=>normRut(c.rut)===normRut(parsed.rut))
        // 4. Buscar en clients por nombre
        if(!mc&&parsed.cliente)mc=clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())
        if(parsed.folio&&parsed.total){
          if(!mc){
            // Sin cliente: guardar en Supabase sin client_id y agregar a review
            try{
              await upsertBilling({client_id:null,concept:parsed.concepto||'Sin descripción',receptor_name:parsed.cliente||null,receptor_rut:parsed.rut||null,amount:parsed.total,status:'Pendiente',invoice_no:parsed.folio,issued_at:parsed.issued_at,due:dueFromIssued(parsed.issued_at),notes:null})
            }catch(e){
              if(!e.message?.includes('duplicate')) addLog(`error guardando ${pdf.name}: ${e.message}`)
            }
            results.unmatched = results.unmatched||[]
            results.unmatched.push({id:parsed.folio,folio:parsed.folio,rut:parsed.rut,cliente:parsed.cliente,amount:parsed.total,issued_at:parsed.issued_at,concepto:parsed.concepto})
            addLog(`Aviso: ${pdf.name} — sin cliente (${parsed.cliente||'?'})`)
          } else {
            // Con cliente: guardar con client_id y aprendizaje
            try{
              await upsertBilling({client_id:mc.id,concept:parsed.concepto||'Sin descripción',receptor_name:parsed.cliente||null,receptor_rut:parsed.rut||null,amount:parsed.total,status:'Pendiente',invoice_no:parsed.folio,issued_at:parsed.issued_at,due:dueFromIssued(parsed.issued_at),notes:null})
              await reconcileProgramada(mc.id, parsed.total, parsed.issued_at)
              if(parsed.rut){
                await supabase.from('client_entities').upsert({client_id:mc.id,rut:parsed.rut,name:parsed.cliente||null},{onConflict:'rut'})
              }
            }catch(e){
              if(!e.message?.includes('duplicate')) addLog(`error guardando ${pdf.name}: ${e.message}`)
            }
            results.rows.push({...parsed,clientMatch:mc,fileName:pdf.name});results.imported++
            addLog(`ok ${pdf.name} — ${parsed.cliente||'?'} · $${parsed.total?.toLocaleString('es-CL')||'?'}`)
          }
        }
      }catch(e){results.errors++;addLog(`error ${pdf.name}: ${e.message}`)}
      setProgress(p=>({...p,done:p.done+1}))
    }
    addLog('—————————————————————————')
    addLog(`${results.imported} procesadas · ${results.skipped} ya existian · ${results.errors} errores${results.unmatched?.length?` · ${results.unmatched.length} sin cliente`:''}`)
    if(results.unmatched?.length>0){
      setUnmatched(results.unmatched)
      setStep('review')
    } else {
      setStep('done');onImported(results.rows)
    }
  }
  const saveAssignmentsDrive = async() => {
    for(const inv of unmatched){
      const clientId = assignments[inv.id]
      if(!clientId) continue
      await supabase.from('billing').update({client_id:clientId}).eq('invoice_no',inv.folio)
      await reconcileProgramada(clientId, inv.amount, inv.issued_at)
      if(inv.rut){
        await supabase.from('client_entities').upsert({client_id:clientId,rut:inv.rut,name:inv.cliente||null},{onConflict:'rut'})
      } else if(inv.cliente){
        await supabase.from('client_entities').upsert({client_id:clientId,rut:null,name:inv.cliente},{onConflict:'rut'})
      }
    }
    setStep('done');onImported([])
  }

  return (
    <div>
      {step==='loading'&&<div style={{textAlign:'center',padding:20}}><Spin/><p style={{fontSize:13,color:C.muted,marginTop:12}}>Conectando...</p></div>}
      {step==='notoken'&&<div style={{textAlign:'center',padding:20}}><p style={{fontSize:13,marginBottom:16}}>Necesitas autorizar Drive.</p><button onClick={connectDrive} style={{padding:'10px 20px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Autorizar Drive</button></div>}
      {step==='selectMonth'&&(
        <div>
          <p style={{fontSize:13,color:C.muted,marginBottom:12}}>Selecciona año y mes:</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            {years.map(y=><button key={y.id} onClick={()=>loadMonths(y.id)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${selYear===y.id?C.accent:C.border}`,background:selYear===y.id?'#E6EEF1':'#fff',color:selYear===y.id?C.accent:C.text,fontSize:13,fontWeight:600,cursor:'pointer'}}>{y.name}</button>)}
          </div>
          {months.length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{months.map(m=><button key={m.id} onClick={()=>importMonth(m.id,m.name)} style={{padding:'6px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text,fontSize:13,cursor:'pointer'}}>{m.name}</button>)}</div>}
        </div>
      )}
      {step==='review'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:120,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:14}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>Asignar clientes</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Estas facturas no se pudieron asociar automáticamente. Asígnalas una vez y el RUT quedará guardado para siempre.</div>
          {unmatched.map(inv=>(
            <InvoiceClientPicker key={inv.id} inv={inv} clients={clients} assigned={clients.find(c=>c.id===assignments[inv.id])} onAssign={clientId=>setAssignments(p=>({...p,[inv.id]:clientId}))}/>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={()=>{setStep('done');onImported([])}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Omitir</button>
            <button onClick={saveAssignmentsDrive} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar asignaciones</button>
          </div>
        </div>
      )}
      {(step==='importing'||step==='done')&&(
        <div>
          {step==='importing'&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}><Spin/><span style={{fontSize:13,color:C.muted}}>{progress.done}/{progress.total}</span></div>}
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:260,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.6}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          {step==='done'&&<button onClick={onClose} style={{marginTop:14,width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>}
        </div>
      )}
      {step==='error'&&<div style={{color:C.overdue,fontSize:13,textAlign:'center',padding:20}}>Error al conectar con Drive.</div>}
    </div>
  )
}

// ─── PDF UPLOADER ─────────────────────────────────────────────────────────────
function InvoiceClientPicker({inv,clients,assigned,onAssign}) {
  const [q,setQ] = useState('')
  const matches = useMemo(()=>{
    if(!q.trim()) return []
    return clients.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name,'es')).slice(0,6)
  },[q,clients])
  return (
    <div style={{background:C.card,borderRadius:10,padding:'12px 14px',marginBottom:8,border:`1px solid ${assigned?C.accent:C.border}`}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
        <div>
          <div style={{fontSize:13,fontWeight:600,color:C.text}}>Factura N° {inv.folio}</div>
          <div style={{fontSize:11,color:C.muted}}>{inv.cliente||inv.fileName}{inv.rut?` · RUT: ${inv.rut}`:''}</div>
          {inv.concepto&&<div style={{fontSize:11,color:C.muted,fontStyle:'italic'}}>{inv.concepto}</div>}
        </div>
        <div style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(inv.amount)}</div>
      </div>
      {assigned?(
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:8,background:'#E6EEF1',border:`1px solid ${C.accent}`}}>
          <span style={{fontSize:13,fontWeight:600,color:C.accent}}>{assigned.name}</span>
          <button onClick={()=>{onAssign('');setQ('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cambiar</button>
        </div>
      ):(
        <div style={{position:'relative'}}>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Escribe para buscar cliente...'
            style={{width:'100%',padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13,boxSizing:'border-box',outline:'none'}}/>
          {matches.length>0&&(
            <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 16px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
              {matches.map(c=>(
                <div key={c.id} onMouseDown={()=>{onAssign(c.id);setQ('')}}
                  style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                  onMouseEnter={e=>e.currentTarget.style.background='#F0F4F6'}
                  onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                  <div style={{fontWeight:500}}>{c.name}</div>
                  {c.rut&&<div style={{fontSize:11,color:C.muted}}>{c.rut}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PDFUploader({clients,billing,onImported,onClose,onClientsUpdate,clientEntities}) {
  const [step,setStep] = useState('select') // select | processing | review | done
  const [log,setLog] = useState([])
  const [progress,setProgress] = useState({done:0,total:0})
  const [unmatched,setUnmatched] = useState([]) // [{invoiceId, folio, rut, cliente, amount, issued_at, concepto}]
  const [assignments,setAssignments] = useState({}) // {invoiceId: clientId}
  const fileRef = useRef(null)
  const addLog = msg => setLog(p=>[...p,msg])

  const readPdfText = (file) => new Promise((resolve)=>{
    const reader = new FileReader()
    reader.onload = async(e)=>{
      try {
        const typedArr = new Uint8Array(e.target.result)
        const pdfDoc = await pdfjsLib.getDocument({data:typedArr}).promise
        let text = ''
        for(let p=1;p<=pdfDoc.numPages;p++){
          const page = await pdfDoc.getPage(p)
          const tc = await page.getTextContent()
          text += tc.items.map(i=>i.str).join(' ') + '\n'
        }
        resolve(text)
      } catch(err) {
        const r2 = new FileReader()
        r2.onload = e2 => resolve(e2.target.result)
        r2.readAsText(file, 'latin1')
      }
    }
    reader.readAsArrayBuffer(file)
  })

  const processFiles = async(files) => {
    if(!files.length) return
    setStep('processing')
    setLog([`${files.length} archivo${files.length!==1?'s':''} seleccionado${files.length!==1?'s':''}`])
    setProgress({done:0,total:files.length})
    const results = {imported:0,skipped:0,errors:0}
    const pendingReview = []

    for(let i=0;i<files.length;i++){
      const file = files[i]
      try {
        const raw = await readPdfText(file)
        const parsed = parseInvoice(raw)
        // Verificar duplicado en DB directamente (más confiable que el estado en memoria)
        const {data:existing} = await supabase.from('billing').select('id').eq('invoice_no',parsed.folio).maybeSingle()
        if(existing){ results.skipped++; addLog(`Omitido: ${file.name} — ya existe (N° ${parsed.folio})`); setProgress(p=>({...p,done:p.done+1})); continue }

        // Match por RUT: primero en client_entities (aprendizaje previo), luego en clients.rut, luego por nombre
        let matchedClient = null
        if(parsed.rut) {
          const rutClean = parsed.rut.replace(/[.\-\s]/g,'')
          const entity = (clientEntities||[]).find(e=>e.rut.replace(/[.\-\s]/g,'')===rutClean)
          if(entity) matchedClient = clients.find(c=>c.id===entity.client_id)
          if(!matchedClient) matchedClient = clients.find(c=>c.rut&&c.rut.replace(/[.\-\s]/g,'')===rutClean)
        }
        if(!matchedClient&&parsed.cliente) matchedClient = clients.find(c=>c.name?.toLowerCase()===parsed.cliente?.toLowerCase())

        if(parsed.folio&&parsed.total){
          try {
            await upsertBilling({
              client_id: matchedClient?.id||null,
              concept: parsed.concepto||'Sin descripción',
              receptor_name: parsed.cliente||null,
              receptor_rut: parsed.rut||null,
              amount: parsed.total,
              status: 'Pendiente',
              invoice_no: parsed.folio,
              issued_at: parsed.issued_at,
              due: dueFromIssued(parsed.issued_at),
              notes: null,
            })
            if(matchedClient) await reconcileProgramada(matchedClient.id, parsed.total, parsed.issued_at)
            results.imported++
            if(matchedClient){
              addLog(`${file.name} — ${matchedClient.name}${parsed.concepto?' · '+parsed.concepto:''} · ${fmt(parsed.total)}`)
            } else {
              addLog(`Aviso: ${file.name} — ${parsed.cliente||'sin cliente'} · ${fmt(parsed.total)}`)
              if(parsed.folio) pendingReview.push({
                id: parsed.folio,
                folio: parsed.folio,
                rut: parsed.rut,
                cliente: parsed.cliente,
                amount: parsed.total,
                issued_at: parsed.issued_at,
                concepto: parsed.concepto,
                fileName: file.name
              })
            }
          } catch(e){ addLog(`Error: ${file.name} — ${e.message}`) }
        } else {
          addLog(`Aviso: ${file.name} — no se pudo leer (folio: ${parsed.folio||'?'}, monto: ${parsed.total||'?'})`)
        }
      } catch(e){
        results.errors++
        addLog(`Error: ${file.name} — ${e.message}`)
      }
      setProgress(p=>({...p,done:p.done+1}))
    }

    addLog('─────────────────────────')
    addLog(`${results.imported} importadas · ${results.skipped} ya existían · ${results.errors} errores`)

    if(pendingReview.length>0){
      setUnmatched(pendingReview)
      setStep('review')
    } else {
      setStep('done')
      onImported([])
    }
  }

  const saveAssignments = async() => {
    for(const inv of unmatched){
      const clientId = assignments[inv.id]
      if(!clientId) continue
      // Actualizar el cobro con el cliente
      await supabase.from('billing').update({client_id:clientId}).eq('invoice_no',inv.folio)
      await reconcileProgramada(clientId, inv.amount, inv.issued_at)
      // Guardar en client_entities para match automático futuro
      if(inv.rut){
        await supabase.from('client_entities').upsert({client_id:clientId, rut:inv.rut, name:inv.cliente||null},{onConflict:'rut'})
        if(onClientsUpdate) onClientsUpdate()
      }
    }
    setStep('done')
    onImported([])
  }

  return (
    <div>
      {step==='select'&&(
        <div>
          <p style={{fontSize:13,color:C.muted,marginBottom:16,lineHeight:1.5}}>
            Selecciona uno o varios PDFs de facturas. Se importarán automáticamente y se asociarán al cliente por RUT.
          </p>
          <input ref={fileRef} type='file' accept='.pdf,application/pdf' multiple style={{display:'none'}} onChange={e=>processFiles(Array.from(e.target.files))}/>
          <button onClick={()=>fileRef.current?.click()} style={{width:'100%',padding:'14px',borderRadius:10,border:`2px dashed ${C.accent}`,background:'#F0F5F7',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',marginBottom:8}}>
            ↑ Seleccionar PDFs
          </button>
          <p style={{fontSize:11,color:C.muted,textAlign:'center'}}>Puedes seleccionar múltiples archivos a la vez</p>
        </div>
      )}

      {(step==='processing')&&(
        <div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
            <Spin/>
            <span style={{fontSize:13,color:C.muted}}>{progress.done}/{progress.total} archivos procesados…</span>
          </div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
        </div>
      )}

      {step==='review'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:160,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:14}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:4}}>Asignar clientes</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:12}}>Estas facturas no se pudieron asociar automáticamente. Asígnalas una vez y el RUT quedará guardado para siempre.</div>
          {unmatched.map(inv=>(
            <InvoiceClientPicker key={inv.id} inv={inv} clients={clients} assigned={clients.find(c=>c.id===assignments[inv.id])} onAssign={clientId=>setAssignments(p=>({...p,[inv.id]:clientId}))}/>
          ))}
          <div style={{display:'flex',gap:8,marginTop:4}}>
            <button onClick={()=>{setStep('done');onImported([])}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Omitir</button>
            <button onClick={saveAssignments} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Guardar asignaciones</button>
          </div>
        </div>
      )}

      {step==='done'&&(
        <div>
          <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 12px',maxHeight:200,overflowY:'auto',fontSize:12,fontFamily:'monospace',color:C.text,lineHeight:1.7,marginBottom:12}}>
            {log.map((l,i)=><div key={i}>{l}</div>)}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>{setStep('select');setLog([]);setProgress({done:0,total:0});setUnmatched([]);setAssignments({})}} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Subir más</button>
            <button onClick={onClose} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── REPORT BUILDER ──────────────────────────────────────────────────────────
function ReportBuilder({sales,billing,clients,expenses,tasks,onClose}) {
  const [sections,setSections] = useState({ventas:true,cobranza:true,gastos:true,tareas:false})
  const [period,setPeriod] = useState('month')
  const [selYear,setSelYear] = useState(String(currentYear))
  const [selMonth,setSelMonth] = useState(String(currentMonth))
  const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const years=[...new Set([...sales.map(s=>s.year),...billing.map(b=>b.issued_at?.slice(0,4)).filter(Boolean)].filter(Boolean))].sort((a,b)=>b-a)
  if(!years.includes(currentYear)) years.unshift(currentYear)
  const toggle=k=>setSections(p=>({...p,[k]:!p[k]}))
  const getPeriodLabel=()=>period==='year'?`Año ${selYear}`:`${MONTHS[parseInt(selMonth)-1]} ${selYear}`

  const filterByPeriod=(items,dateField)=>items.filter(item=>{
    const d=item[dateField]; if(!d) return false
    if(period==='year') return d.startsWith(selYear)
    return d.startsWith(`${selYear}-${String(selMonth).padStart(2,'0')}`)
  })

  const generatePDF=()=>{
    const label=getPeriodLabel()
    const now=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const A='#003C50', A2='#537281', A3='#99ABB4', A4='#E4E8EB', G='#3D3D3D'
    const fmtN=fmt
    const fmtUFN=fmtUF

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Reporte LE — ${label}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'DM Sans',sans-serif;color:${G};background:#fff;font-size:11px}
  @page{size:letter portrait;margin:18mm 18mm 18mm 18mm}
  @media print{
    .no-print{display:none}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page-break{page-break-before:always}
  }
  .header{background:${A};color:#fff;padding:24px 28px;margin-bottom:24px;border-radius:0}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start}
  .firma-name{font-size:20px;font-weight:700;letter-spacing:-.5px;margin-bottom:2px}
  .firma-sub{font-size:10px;opacity:.75;letter-spacing:.5px;text-transform:uppercase}
  .firma-logo{height:34px;width:auto;display:block;margin-bottom:4px}
  .report-title{text-align:right}
  .report-title h1{font-size:16px;font-weight:600;margin-bottom:4px}
  .report-title p{font-size:10px;opacity:.8}
  .firma-sub-url{font-size:10px;opacity:.7;text-transform:lowercase;margin-top:2px}
  .section{margin-bottom:28px}
  .section-title{font-size:13px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid ${A};padding-bottom:6px;margin-bottom:14px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .kpi{background:${A4};border-radius:6px;padding:12px 14px}
  .kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}
  .kpi-value{font-size:16px;font-weight:700;color:${A}}
  .kpi-sub{font-size:9px;color:${A2};margin-top:2px}
  .progress-bar{height:8px;background:#E8EEF0;border-radius:4px;overflow:hidden;margin:6px 0 2px}
  .progress-fill{height:100%;background:${A};border-radius:4px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  thead tr{background:${A};color:#fff}
  thead th{padding:7px 10px;text-align:left;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.4px}
  tbody tr:nth-child(even){background:${A4}}
  tbody tr:nth-child(odd){background:#fff}
  tbody td{padding:6px 10px;color:${G};border-bottom:1px solid ${A4}}
  tfoot tr{background:${A4};font-weight:700}
  tfoot td{padding:7px 10px;border-top:2px solid ${A3}}
  .badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700}
  .badge-pending{background:#E3EEF3;color:${A}}
  .badge-overdue{background:#FBE9E7;color:#E24B4A}
  .badge-paid{background:#E4F1EA;color:#1D9E75}
  .badge-area{background:${A4};color:${A2}}
  .who-section{margin-bottom:16px}
  .who-title{font-size:11px;font-weight:700;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;padding:4px 0;border-bottom:1px solid ${A4}}
  .footer{margin-top:32px;padding-top:12px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A3}}
  .print-btn{position:fixed;bottom:24px;right:24px;background:${A};color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(0,60,80,.3)}
</style></head><body>`

    // Header
    html+=`<div class="header">
      <div class="header-top">
        <div>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAABbCAYAAACvbftbAAABCGlDQ1BJQ0MgUHJvZmlsZQAAeJxjYGA8wQAELAYMDLl5JUVB7k4KEZFRCuwPGBiBEAwSk4sLGHADoKpv1yBqL+viUYcLcKakFicD6Q9ArFIEtBxopAiQLZIOYWuA2EkQtg2IXV5SUAJkB4DYRSFBzkB2CpCtkY7ETkJiJxcUgdT3ANk2uTmlyQh3M/Ck5oUGA2kOIJZhKGYIYnBncAL5H6IkfxEDg8VXBgbmCQixpJkMDNtbGRgkbiHEVBYwMPC3MDBsO48QQ4RJQWJRIliIBYiZ0tIYGD4tZ2DgjWRgEL7AwMAVDQsIHG5TALvNnSEfCNMZchhSgSKeDHkMyQx6QJYRgwGDIYMZAKbWPz9HbOBQAABHsUlEQVR42u19d5hkVdH+Wx1md8ksURBQRH4SxIiIAUUFJKOCIJIlCoKAEg0EBUwfgkRFBCWpGEByEuQjiQHFT8kgQYIsaZfdnenw/v44VXTN2e6e2923e2Z2Tz3Pfe6E7ntPqKpTuYTk5mhAHUABwJMi8jeSIiLEgMDeR/J9AJYEYO8WAK+KyM2txuS+uyyAdd1cch2ijqUiIte5dxdEpN7lXNcHMN09eyBLre+6RURmxWvqxrYygLf2cy1F5MpoXTpey4zrXUB4Yd39bUMACymu/WyMR9QB7AjgFQBFAPeKyL9JFg1Pexm3W/N3AnhdhA+2/jeLyKt9XKMygI2avPcxEfm/fryXpL1rAwCLuHnXdJ3/LCLP9GvO4wFur98DYJlxov1bReSVrDze9sk+S/ItADYH8G19ZrHJ16oASgCuA3CqfqZmNK/PFADsxznTguY30TG9HsBZbdbe8O8OAMcBGALwRxF5ptl6DApv9Mf3A1jcjd3o9G8i8mQ/acXxzPjd/xSRRwctM+Qwnw9FfMfm8y8ReaTn+bA5XOoY7iAnW9L735qM6TlPNG2+uw0HAz8keQbJhfS9RT1sO53rXzh+sHazNbV9J3nAAMZwqa7jKX5tOlnLDGtd9EyK5Cn6zl7gQZLfbfWeLoUbkLymzTtvITnNcCdvxk1yeov3nqv/H+rXIUjyiRbv/jvJVUgW3AEz2QUs2+vbxpH2392On7ahn0OVdp7U59S6ePeFJLfo8xr7MU/TMZ/d45r9RZ+zY7yXA8Kbot7vazG+f5F8s55FhT7xiBdavPuI8ZAZul1H5Sc7tdnrg/LgeSXVMgwqAMqqpQ960iURqZLcF8BqAOboWEyinJHxUSM6J5tLP0AA7KU/b03ypyJyZJcWmJd0vLUWWmA/wNa0Osbn5gxgLT/lcOATAE4Vke/mZc3SZ9RIvgHApwEcAGAlp83XHC2MBX69VgNwKMltAXwPwGUi8rjhcQ9DflnfU43GVFMrz0Ui8gmSZRGp9MG6Mezw0PZ9Vh8FjSrJowEsDWBuNOeqWlBLIlLXQ2PSaMc97HU/wfhMNeMeFZV+NlAr78pNnpWF39Qdju0IYHuS9wLYRUTuzdMi5Gj+zQB2BbA7gBXcmM1aUcxIE8Yj3qHXviSPAbCxiDw2CKuNo5WDdQ/mRDy5AuAtAKbp3EtuzfOEGQAWdWfIiFr3Zk8iuiuKyAjJD+v+ztE5eJ63LMlp+ntPAlYpQqbSAA/6WGgBgrtsId24ktvIUgfPKbm59Ats4VcAcATJRQH8RkRu7PDwK+o4pQ/rXnfrV4j+ngUKA1jLqmN4KwH4DsllAFwqIneTHBKRkW41Lj2Y10NwUywWvdPjfzUjvcRruwqC++PrJD8mIvf0eFgU3XtK0V6MAHgvybcB+Icdfjnvh6d/W6NCn/a+oK6yRQBMVZqK51wDsJseaPOFizDDXvebz0pGGhrSg+gDAK5WvlzTfSjqVc+wL9JEcC4BeDuAv5O8UER2UqtC10KWKWRK8xsqzZcifl12uJ2V5kuO5k2ofDOAm0meBeC7Kvz0U9AyWpkGYJoqQjGt1AHsQvLwPtJKKTqX633mEXkLqgXdq5UBrKHjn+J4ns3tKACnA+gpPGEiLkqlz8/O46oroZYdoe4P4EqSHxeRSo8uLuY0zoJD/lb/61Yoymsti7qOJbeWhwG4nuS6yuALHRKRMbopGs93rQpXXrAqO5yoOcbR7qrp5xkJn1UASwG4geRlanFhzi4te9/yAG4EsESYKicFY2tmGQEwopbFnVtYcUzp+EIfBMmJDPUc6asVXyhnEFZG1HJ1jQrANUevhYiPtLuKjs7g6Mb43GdJnmuHWDd0ozRfJ7mQxlldqfhjNO/5dSUSFtpdlYjmy06wWAXAiQB+YfFk/XBjK42PkFwewL66jkNNaKUA4EARqc0v8Yp9ElTrCN6A9zllodkZfGqv61iagAvQzziLvN1cdNpZRSXhq0huKiLX9iD5Sk5jfQDAXwC8G8Gl5eFBAC926XYp9WEdvaY7ghDEeSPJjUTkrqxrqfMpqKZ3JYAPRtaY+H22zpdk2JPtI+tObDFdCsBWKmjvAuC/JOs5arVm0VkKwA4icnqesWqDlrFUCP0sgBV1XtJC2Jirwvbd81Ow+xj73C/BuQzgUcXNYjNLh60xyQ+qFWhKdBDRKZkPAvizEzrQxKqyJoB1oj0tuPEMA9hdafcAAHM6oRv9XlGtEr9EcOMxOk/orHee5qUN/xsC8Mkm+FhwcxsG8AkAlwLYTsdR7xOOfgbByl9vQSsEMIvk+iJyxwJCK50drCEMaSqAM531rRmvJ4CPaNLRPd2uZWkBWtsKgD0R4jwE3cVyFPUgOArA2yLCLaPhvz2O5HUtmE4Wge05AF/oYZzGBG4TkadIrgRgfTcW/79CBwKAPfcoAA93Mb9mzPdbAN7gNFpRxjaM4Os/guR2aLjIsgoh1wNYzzEjcda3ov7+CIAjAcwRkd9lYOSX6Nj+R4WCurN+2V6NIGTirasCXjnjuDsRvusAvoFgwq5Ptswdt54lAMc460CzuVYBLIcQ77ZTB3gwGcEsRL9HyHArOqtPXpaxAkI23GPqYm6GN0WSBPA1Fa5GnMXExy/tCeBaEXlyjH1eFsCHAawN4CuORk1gm6L7vKvygwc65H1DIjJXA+ffoeMtNxGuAODvAL4J4BURuSYDjm6r4z0LwWrsx15AcNdVVRD7tYhs00dl5Bi0zno0WlkSwFdIbj2f00ov1sCSE5LZYi0rupa7iciBJKfomdTxCz2M6P18/d8gMyQss+YwHcNwlKXyoFugVswaJDeP5mIwJ8exLkTy4yTn6Ph8Js0wydkk92i3hm68t+j3qu45D+W9ri3+J2PsxV7RWlb1vnqO41uM5I4k6yQrevdr+aqWssBY2XMuI+2d0XgZ/V4nub3Gzb0257Eu99nFSe7W5Ll+3C+R/ElWOnJrfqk+o9Imw6VKci7Jn7qxSw97YBlCS0ZzsX0/Tf8/lDOtn6bviOdaa4IHs1zmW2mSM3mb/7Vur+t6PT2I+WWg/U8r7Xk+ajRa0YSUTLQTPX86yRubZCDWFPdub8fn29D8h0m+0oLmjV42J7lwBzRfisY9neSv29A8Sf6C5FK90qTfJ73eTPI/Dk/a0cqr6trNjVYcj3g02jub9xcHLTP0QHfnN+Gx9QgfK/r7Bcrvu9rPAhYcEJJLaAmAst67ukRktmo/m6uGEEvB03q0DhbzGKdapyoaPNrsf91aPabrM6b0OL6SiLwiIhcB2AGNOCdvYV1IrRdTzFrTgniKCK7B96j1aiTS9EZU6zwPwDYi8nMRmenGURnrcp99WUTOU5fAJfrckWjciwP4MMm3uvH1an2oO0tqGcDOJC/WhIpJUcJAD8S6mt43dpYAb8UpRPMpAVhY8WAa5r9gd68519SNUerjlYX2qbQX/62o9PMbkkPGY8agG+M/RRF5QfnmTRidyWz7vRbJrbLQjP5fSH4EwFVq8S40Ga8A2EJErtQ6cllpvuo++4JenwRweROaH1LvyHYA1leazMN9X9a9+ipCfTxP661oZSEAh6gCWZ9fypv0yHeKCMHt7wDwIbd2nva8R8aC3T8LYA3dz0I3L15QLFhzNVsJOWkWpjn9yUnA/r1fMeLswoL1SF7j7HEvWlmw1s1JaPDID5JPRWvpYcmMmve3I/zxmsoZ8Tt7HbP+/JMmGpHt5QskpyouSE4WLFsj24+e6kQN0oLl5rlNtE+257NJ7q3WiNiiyfmE2beyYFFpYLzo3qwl012dq3qk0e/Qi2XE8FRp4q+RB8Bw4WT97JQxxjqkP/+4Cc+3ny8guVonVrE273tNUGxhyTIryEMkV9XP9WJZtjPi7SSf1znF1qs91VpebcI3Szmed5PagqXGiiLJYyP8sD27Rc/sZv/7a7fzWpAsWP2wiBUB7OEsDEAjU+V4AK9XLSit89hyfhnAhgD+iXlTv2eLyItjCLs1JfIvY3SWjcVInSUinzcm2WtWmtWa0fin3QGcH1ngLFZjSQA7am2sbhidrcM/9LK1sRiVGoBTNABzyiTY65oW590U8wZOAyGm54cAfoPRdfrqAGaT/KTu4XxLU+MZT6fvLiPEGCLC2QKAp3z3gi6eX0eoQzQXo0smmGW2DmANkq9Ti4O0sfZVNS5pD6UD/zzDnQtE5CGSU3oJ+BYR6vdrAOpqybrM0TkcTb4JwA+VxxR75ItTEGouLuWsVTaP60XkHIT6ZL62mWVKbttkDxfEw0XUArU8QlyhxxWzZO2HkKjwSGTJKgBYTS2xyUU4YGbkN2qefcX8VRSxn+tYDzd5AMANGB3cWwcw1VVNL7R5xmERQ/EtPI7XQ1l6LATq31lFcOcWEILObXx0P48A+DHJ3brU/I3Qr1UGYOnxcHNbn+SWGug7NFH32VLpdU5761yKbp4VACeYwIzRJVtqCK6Pg/QZpUQ5/duqiHdZYshFAP6G3pJbgIbb6jCMzpg0AWsTAGsrf21J7xHNx3X+hgFsJSLXqEI1nBPNE4BZo0/A6FIQnubfTvKTOtdSl7RS02d9PuJlNX3nSU7RqETzLyMEu0/F+NS1nGi8p4gQuuMTaqw0zG8BPCci96mCb+ePtewaIvllTTToaC+TgJUPM0qQjxWrgBBrE69vAaFmyTzamHPVrqFMlZF150UAOwF4XoWrXOspqZBVAPAEQlbVLGVwfhxAsGbWe2B2qwI4CcCtaqkyBlAAsCyAy7UG28gEtu7Y3n0QjdpCdjiUAJyjB3gRwD5opFHTHepTSC4OoJIswwOHvMpH2L5fD+AeJzR4YfrJdsKH3t+m9OZ5sMU+fVVEriY5NS+FytG8veMeAIegUcbCW7GWArCU0nyhB1r5AEZXSbdM9YsB3K4/HwLgVTTihiw+7M0APqPWl/KCjLfK9893+2M48zKAi0XkeeUnd6NR381gCMAOJFfw+JcErMFAqQ2BSFqeji1ZrTTjVgVoy/q9AxDKPVgQqB3Oj4rIhQjBw7U+jbsKoCoiPwbwb2VwRsBlPTC21jo93QoGVC384wgBwoy0rKoKWZtoDaOJaOGxeX8HjTZY/lClVu0v6CH2TccQTTBdTw/mpTtldgk6OtzjwOkaQiLK2uix+bu5IXWPv+EUBStGWgfwTd3bZvzAhIWvIDTLrmB0g/CHAPxOhYqRPtJ8RUROBnAoRrvuDLd30eKg1S7w1PD9JDQq6DejFUTr6PesDGAfkisiuOYXOFpRPkjNel1D+aTxlBKAp0TkF2rlrIvIcQjJCkXHd0YAvBPAhua1SALWYDZP1DISa2dUDWw4HQC5MHsq0/Tar68G/h6E/mZVNGKv7HsPD8jSQR3P7hhdCNDe/W4ArzN3aBfPrysznQ3g505bNWZsboHPaCp6YYLRSkmZ/L6qWVfcuEuqgX9F6cUOpPMAPOtoyqxY6wIYSUUU+8bTKgAej+jNBIhVLLaoR95mvSWtF+Nzir9T9P6uZnSieFTRau0b61iHorFeLSL3O6Wtb7xJaf53mDc0QNT6VOuU5nWOVZI7I9RbNAsvnbB7sCmeug/nA3jarYONZz2EmLFu+c5kh6LO/e0I8bC+oLE/H6hB8CWEmL66E2qH9Pf/IbmUxlVnWsskYPWmxRCNps+24CO6rt8UkaedhSVBB4JEhKNzEVxG8/zfYiIQigDG3xMAe45hGcsTH2oAnmlBV3Xk0BCV5DQNAv+qs44ZE7BijStNQFehuHEuFO0HAZxmiQwutvFJNApuViMNfo/ouQny4WclLaXwJf1zNbKoXEByKxEZsWB8K/3QhQVIROQyANsA+ChCTNNxen9nK6FA3zuERm9Rb7WpAjjYykf0Wx5Fo1nwH5wVzePp53qglSJGh0zY+84QkRdcTGMJoQnz9zA6RjOmlQVNWbC+g0uj0Ran5NZ4nvNB8fJ5zFuE1EIxXu1kDEnA6lLL0yyyIdUk6IhrCCFQ7rembaUVy7yuC2HeGCwgBCcu0uarS6J5LNwr+t1BHE7mlnsewazPaO8LULdWrwKoMo5T0Ag+jrOwztQ4pQnF6HSfDtExDkVrc2Z0uNichlXAHqWVAviSWuokWYn7YsVCE4XA/v5rkneQfLMdSor/5U7KnygPFa1P9X8icrSIfF3vM1pZoHR8S7Sg+RcATB2EUquCXlEr2f9K+f8cpfsRxfPPd7H2VeVbX8O8Lb6sqrwXeg0qaHQq8bRyaJ4liiaTzqD3dwH4GEaHGhAh/mpKxFvLAP6KRhcOn8VM5a2ZYxEXNAHLTLpFNQd2dSmiLoLQp8tM5+aSqgP4mYg8A21x0CWT63mcLa4JR2BW9A/BjLsTGoGchtQ3IvSjkyYMugDgp2i07zBGQwCfF5FnSZYHlPpe0PTzJzBvqi8AXOAsNL1Y+EQFj02VoVfd32sIbUm+aYfeBLKO7IDQIBcR3dyDUCT2Na3RCvuJyIlqFTTh0TT0ZQEcMUYm72QVcIp9uiTDPlXUivVLNIKoR5pYVt4L4AGSF2onhrdpcc6aFxb0vYV2eGGf0cKlZb1LC8W2qsrWORjdV9CUmT2smOiABdKVdCyLYLSrs9g5qQgRCpa+sQmt/MMpWXW3Z0URORWhzIBZto1WFgVwvAqdC0ywuza9rimu+LhB8zIdIyJP2Pmg604ReVl59asYHRQvCEVHM8cgLkipzqKLV8uBoBZS4Wr9iOmXEWJDTmoToJnpEO1XQPYE1ZaLag08PtLMLKbqJC1BUO7A7C+Yt+N8v6GqgvF1CNlwb8W8FYNzYRwMp80NJDdD6F1n2YxFxcXNSZ4H4O9aQbs2zvtcQHD/eJqw/T1LRB5vsr8mFB8N4MLIYlFSoWx+42Hs515l7Ftp7z8GwPvVmhL3IzRryo56PU3yNtX+T1IhbcSe1Y523XwnY9+8mgqJ5wK4y50HdiDPjHA5ixFAlBf6zESj7/NF5EGSQxbk7hQvIPRW/VUk2JX0uQuMcOVqte2P4DkwfDWF7AGEpKBR3UM0vqooIpeQ/DqAt7g9rQJYVROJrlXDQDUJWAGGw7rzA11+3zbi4whm3yWcVlHVTZsDYBsVFnrJWptG8n05H8xG8PeLyH97bBAsZibNobp2QUSGSV4I4CNo1CaxdOO5Krhkrb1j85yBUBSx24bZ3Qg+dSW6h0g+iRCgWu3zu24m+S+EDBljBIKQUXmDiCxhFbrHo4Cl0kIFwImqSdechj0E4A6EuJ5mBzB1/34D4EEAq+le2vcPBnCOiDw6EYTInGBKH2n/T6qoFNq50BS3CiJyG8mNAFyte+cbpYs72GsIbVy21esgAGWSFwD4BYAnrbm0p8X5ITbV5iAi/wLwr3aWug5o5SsIFlqjFXOpP4ngoipFwpUX4K6PznVzc+2DUPz0n/MRrbSDosahrgtgKhqt0gxnfysij1j2YBO+UwSwiwrNcJasZQBsT/J/kaH584IkYBUB/Boh8yQP8GbCEoBTAfxGD7xCl8zDnrcCgNv6tA67IrjUij0c/nPzChxXd8CJ0IwbNFxrhtCb65pmZQpWuf0GEbmuQ6tXntaaoRaCaZ7Mre4q4F8DYC004gyqABYjuY+InG2ZSeMpOOiaxHtRauXSUcuA9Xj7BkKmlFlSRC0rh5PcH5O/P6EJLEv3kfbvJLkpgFfGErhVyBpSIWsTAJ9A6JIANDJAC+6qO6VoWf3cF/R6hOTPReSoJnRSRChxMqnrCbaLy+miDpe5GCsON2oAvqW0UmgzhiJCf9Qd0ChbUVAh43CSe44zHxjUXlQ1RvBt7kyAw7fDXUHjZntWI/ky5i2/UUPIFD9R8brtWb8gCVhTEALdjEEUurRsiGMqVYSA9qtE5Ejb3B40MxPa/oEQyPhFAMvp2HvVaM2FmUdF41VIzkQjLqYba2AVwM6qJazq/ld1a7uliNzUpVAyZbzizfRwaoZbudbi0vcUNc7sMoQYNjv8TMg6S61pVw9a2FQtsALg/+k+Vx3PsT3eywnGrWjC8GImGkkLtrc7i8i+88O5oHN6GKFO2FloFI8s5vTsVZWXMCN+jSg/uwPAHSRfQqjAv0pEq2bRKkXWFItJXRXAkVqLiAAeA3CAiDxi+zteFtacLVn1HGhlJYS2LbXofC4itMRBs/2zWDYRmUXyTABbuHPDaGUnEdl1ATjrTeDfBMA67uwzOnhSE2Rmt+GrZYSahqch1Fj0il0dIazho2OdMQtSkPssBH/qw2iYXUtdXEWMLlT2bSdcdd2jK4KFReR0hKJ+i7qNnQhWQCB0k38EwW3zcBfX/Xo/Rpmvr+pt7sEt1c89pUuhhBOMYdcBLEryY07LyoOxV5SxHgPgR07LEoenu+sBMGjN1axpewGYjtGuJTuQHxljflWEUicXIcT3xP0J55L8SJ5rOs6wsIicrYfswnpISg64BwBXqJBayEobJsSrK+UEhBpmP0CouVSKBCyPY6aIGj1XlP+ugZCc8bA2Zt+f5HIu2H1BbetCV/Zn6WhNBcDNCG7XdgkDVbX43opg0fZlXOoAXlULJubXLgguEWIaQqa1D+w33NxHRF5FcCO2ooO6Fnb+BUItPh9XBwDrkvwQGuEyC7yAtbAy8w0RsrzMmlPp8IrhApI3aNuGujKKXhmiOHPvR1WgKXYpENo1Te+9NAQ2Rn2ECqz2N3Z51R0B1HQ/vgfgvSpcFfPqITbeCq7Ob3EAu0XCal6MpYBQ+dyebQoAAXyK5CVq1RuY1VorI1cRSjP4HmBWef4YhEKxxTEOfCumeLhadYpuTacDOESb4s4PFnmLfzpLedWlOdC+rc0eAJa08ggd7GPNNa2viciBCPGSGyG4bWcBeMkJVFas1GfRlh29G8/4sloIblQhq2ZN1Bc06UoF2akIvRX9QV5Do6H782MIBd66NRejXYx1VdYP1/fMt2useLoI5m15Y+uSJZu2phb/WwH82SkKFnO9KIAdx8rMXJAQuQpgUU3L/BCAW9Qc241WHgdOfxShh9ENagavkuwlHZ9KcHNE5CYAN5H8KRr1nroR4Mwf/1hEiJ3OHQg+/tvRCKhklwKDn8ewiCziiGTSBmLq4SXRupUB/AfBLYo8XXXuUHoawRX3AxWoy8pg5gDYHsBfReRbTTKQ+qVJkuR6CPXIFnV0WAJwqYgcq5aR2hjzM7y7U037vg3RiB707xGRW7Nk9kySw7YkIjcDuFkz1JbJgfZ/ICJPdUtbFvqg+HMfgPuU531e33EMgtX9/cqrPM/wFeHF4UIdIXbw3zrPi3UfZbLHZXVAK+a6PxOjk6bsfjWAq7K4+O3/JPdCKHkDp2yNIGS+b6h9GgcenzoAKKoy8EM0eraa+7WsxorrM87dssI/B+Apd8ZZaMxyJJcB8GIrfF3QyjRYCuajJDdEqBdUyyAcmEC1NEIKsrf+WU+4EoLp+woAG5slq1cmYcxQRHbJmYn3Iry8Xpng5gglCayDfJaMPXHWDI9/JWWw54rI/+bBt8bxgCTJ6hjCQt7vNNz+GcmDAbzDaVwWMLsjyZ8BeL7HWMEsYEV2v4FQcdvHX9WcpilZ6UDp9PsIsYk1Z9kpADia5LYAZs8Ph7Pbz5qI7DGBaB+uS4Do+CyWxUIl3ofgCtwawJZNlCk77Awf6oqj+wHYT5XUy3X+83VAdhOaKWO0p6Tq1ryckVYKmi16HEJGIiNaOZzknQBenp8EWeURdc18fQ8aSVM2/zkATlYFphPldTiyhFl869b6vFv03bUFWcDyC1YQEYsH6nQTL1TrwEUIQcU+DqGCEEj/O5K7A3iBZL0XBDZmqBaKPOKwajkcrMO6hjdqHabL0J3r0WdiTkHIzviMEsgdXRK/xehsSvKTAH4zKKuGlYTQ1gxL9GBx6BbqSug7qdb7eozu4beOaq8XKj7V+7QO1kttO4SClD7I1HjOfm2SAVqQgoyoEL6zCm0+c2sTEZnl9mG+4FUTkPZHWbOaHHAFEbkdwO3KK5dWnniw4sE6ToiwedkeDuv/dhaR32rR0dpkEADaKQvtBFpHK5sB+KRTRDyt7O2FrQxg9H4FQjV4n/UJAB8CMEfpb36q7G6lGd4IYHnFpymOB96lWbGShQ5UUS4hVHzfVy2MNYe3dQBv0pINbHUYLYhAF+PU0QGmbRGAEOS2uQoX5octI2QmbI6Q1mxBxyM5MLSJpMmJEuc0jZXaEsAGHVoDV0IoGeGFkGGEdOJzROQtHZQWqDWxXk0DsEROMXGZhTsNOt8ZwRRvmSdsMc5+WM6KWuvmGADnRtaCCoCfknxRRK7qoxtW3LWI08gt9u4sEXm+EwHaAnhF5F6SlyLU9fGCW0VT0M8dbwtmP6xZk0ggrDlBay5C7abz9ALJjwP4FIA9HU0UnZJVBfBJkqeJyAG+uv8YNO+tC+Mx93qP9EKEHp0VNOILBaGw6JMdWpxtD14A8CeEVjG2zhb7uhfJ0+cXWnFN4hfR89f3HbTyIfu5RDR2srckX8Tokg0mUJ8pIue2CnRfUAWsrtNq3WFdEpEr9TC9yCHwNH3ukQjl9ucMwB0zXmCWrOsR4rE6XctXlNGaAGCurBVJ7qzuriy+8iVb/H3GOK3Lf1sQ8JIDeHdFXQlX6rWxw02LHbiM5PoA7okrGefF6PRdJ0Z8xgon/sgdhp0ID6Zxv4pGuwt77hBC49ZzdP6pwfr4C1o+Y9QUs2sAXKMxMt9HaMLr3cemVO1PcqaIHNnEAm010JrBiwM+2I1+9lJeFpcEeFREtm92Buj6WCX47zWhlSEAP3G0Us+4/qZoPUzyl2iECxSdBWYfEfnBfEQrhmNrANgKo5NqiBAHOuTaq2UFi2+9EcCdCBb5mltLIXmCiBzVzFOSmj13YSVQrduaPd8E4F6MTqm1Sto7zOeBmuLSuH0fsXaXfaas2UjPYd6+fYsguAqXQaOad6vDnGpF9FqJ4fXHNSi6PgBGKyoALIqQ9CARgUPH2VcXluJnRUSeA7ANGv3QPMMpAdhVmUG9DzhBhIreq7qDxhj8vxAyBwudvtuYl4gcipANVMJoF+g0kqsrbSbe1h0eF9r1YO2GV2o2aV0Pt6Ie/ner8O8ztGIL1ZrR4Wm0M6IKHTFvv88tcyyXkwWs5MV0AOuqwLguQgzQugiW7La0QnJrFQxiWnkIwKx2BTHbPHhE1+G7aPQnrDtaKZFca36iFRVgf6xr5ZvFlwCcISJ/17I/9U5wGCHpbAaCFXakiZFqa5KrGf0kASu/zYSIPIuQqlxw2rgR/rExg5hfNVYRGdGDfWSMq2I9ypRZHonRxfDMqrEpgNfpoVoYg7l9Aw2zuj0DCH7zUqdp6T0IFjUEM/9uGB1DYYkQXx0U3anWRTRiMGqOIdQAHEDyW5g32aDndYj6DtbdgVkA8AsR+afuSzfCne3j4Y6RGu2tgxDH0o37PwFeK61Ra3blyCtqajmZo8rIHQ5H4Gh4VIN3pfWSuh6/jUbGnaf5wwEsNIgMZOeWWg2NJvVGa3ZvZ1GzBufHRMKi4fVlIvJXhNiibmiFrv5dzfGeKkLx38/OD7RiZT1I7qaGDThBtYzQLP58XetKNzir4Qxn636aAG/ZiWsCWF/PqlISsPJjRiO6uWcD+DuCSddrVM+nVWpNF3r/LULjTUQWqBqAd4zRS5CuJMITGF2d34Sadw0qBkvf8+4W2mYRoV/boKCmjPl4hNTkkmMullFzGIDt80rVdu6GQwCsjIar0Bjd/QC+oxaMXuMSb8Jot4nR3tEINe+qyYrVMe6C5MokNyD5Qb3btW6edKQ4RxF5GSEIfpajX8PVTwD4hMY1vhZPo+Oo6MHpab6q10/UEtfv5sbiBKO10Kj35TP2dmpFK3og741QgLXiDm6r0XiMuhZ7pc9d3LONVqoADkQo/zHZacUE0Leg0e/Uu6ev1LIi0kOojjWW38WdLXAWwdW1Fl89CVg58ybNXmp2YJTS8rRksMZI5gI4AY0sTCOKIoDTzMXQxoo4pFrexU6jABpm9lP0Xf3W0sya9oOImRmxXw3gIUslHtD6mvn/dIS4JQ9DOra9SS6u45Kc3tusoG0NoSL7q+jNfWONWF8BcANGV3YHgnv5sAWlhlKOYLxqd4QagX/Qu12XqzurkCeOqrA0jOYZt2WEpJdR1gTFo1sQqpWXIqtECaEafh39dxNauMhBaISHxALYzDaIbFmwUyPFswbgJMuKzYFW7keIx/Qxj6KKyOGTmVZc38EV0Ci75NtxCUIh4o5DEprga1UVAYnwrYBQDmMRTcaRJGDlq/UtheAaSky9MzCErygjKkSMZhbJ5fxaN3uG/u9ltcoUnJVmBMAbSe6kiF/uEx4M6fP3QUgP9hWEzcX5R42LKg2KoZmbRER+D2A7NIoXwgmcGwB4mx1c3eKwY3RrAjgUjYB2b8HbKycBriAizyAkkcyOGCdVaFx6DLxJ0MIaoPfZiisjis+zSC6L4ALO05LFMc6hehuafx6jkx1MgPgAyQMQ4oxKfaJ50bVYTvHaF1C11l/HAfiPBj/XY1pRa8vXMbqdiymDF+ZIKzMR4ofmuPU069ueY8W6TnxdXWrKx9ZDI2TAYnKfyeNsdm7tewD8MBJW68rvzombficBqzco6+YehOCHraQ17VgjsD5z9zhrhMVWLI/QOsdr2PEzKkpkJyCkJccB8wsD2EmJI/eATvPrk1wIoYP9NIwObheEbMY/OcY6YD2AQwD+6NbYm7dHELIK34GQ/diLpc+sEUu7320vbgZwd5u0+07wpqKH1vkInQnMGmfrOx3AkWO1sUgwj9BSQOhj9x8EC2QRjTIjqwE4VPndUJ+EunlwF80bG1fVsv1lJ2AZrZUQrJg/ADDVtfjJGyxY+lg0sp/FHbgFADPUFV5oQSt7Ali2Ca3c5nhVHrRSFpFLEbqNxLQyFcA3nEdhsp0hxsvOQsNrAbcfR6syVs5BsS1oUd050X6ZULyy4kSyYOVpvUBrV2A1rdCYYH3mvqxac7HJGk/NqFEeHOG0ZSdtAuAKy2bKS1PT51ifx6sRTNSeyKkM7Z8icoXTtgbJgAigqlkwH0OIVauh4dIoIRRFvUHHP7vb5VDm8j2MdveY0vFz1aTzsuDV3J7Xon0vIMRMTEnk1dFBVdSSK89hdHyb9QrdnuSqThjL691zWwgS1oWgqWKj+39opFSZgFNHcI17Ws2L55e1UvoGALaILFAmXN2GUOTYhy34Odd17H7eFod1uYg8niOtmHVqdpMzqYhGfNFkPH8LWvvKGzfMTXgrQkmQEroIbm9xVlnIxQsYnZlZQSg6+ikV6ktJwOptY23TVkAIFo41OzpNPkEbAUCvuxBMueKYegXAZxD6zFXaMAE70K8F8A/Mm749AmBjkleoQNwzQ1FCK6mG+j8IJuq5jqbs/fcA+HQ/K6dnWGPrbTcDwK8jPDUteTpCrZdpXa4FtOH5Rhjdr7OI4Mp5ppt08wzC411oNH82vKkC+AKAVV26eoJsVqwigLgyta3tKgC2VatxoVehRUs2FLQmmy/Ia/jzJIBH2yS6CIDfISTJxDRPhNZQF6swU8qB5kXpqELyvaqUrIhGZW8bUxnAZiLyBEJxaka0Qi2RMNKEVl4E8HjOtGLV8HfVsRYjWtkDocPDyGQStFTQrSv/XRoN74cJPSMi8h804mN75qN6fxDAb6I9B4DFEcoLLWH4kgSs7oUrQ9rjIgZvCy76PyDFZmXRQoYQUq/rGF1uwfrMLYJG7EWzg7YoIq8gFC8sqrBjMKTC2uaqHdZMy+j08NVDwWIqCiTPQajnU48EF+tfdaKaqMe155fFoInIFwGco3/2Aa9xPaFOoKhz+5IKyTWMrgt3j4j8VhldXun+dP2/fhjhjaWeHzuegu1kFLB0f76ERqKJt3RUAXyL5P7mptOadtIhDYnGLVrrnuMivLF09ztE5FY0QjHiw64sIk8jxBeVlObi8e5A8hItD1PVOnyFLnhUWRXBqlqurkOj2CQcPQmA0xB6YjazQFkD9v1VYI1p5T4RuQQ5WrtdcsKLAE6NaOU1mp9kwlUBwYr9XlXqvBXb5vFdV/g473cfEQlXJqx+CsAKGv7SUsASa67aquhcj9d4CXbFHOZVcszlPIS+aL5Wk8UNPA7gom61vD6vf9fFA/u1L2oJuhaNEg3+sN9YRGa1S7F1Fq5fIgSILhQRllnENiF5Ocl36D7WVNAqKONvdRV07004eydCr6/PAXgjRvfFq6gl6EcArjatdwKsc1UL7e2FUJXYx4QVusRT66X2UYTmp1bJ2g65IoB987ZeObyZhZDl5p9vNLeV0eokUziKg7haHMR2OH0WwQ1ScQqiJY6cRvKLJFfV2nZ0z5Wx6EgFlRGSbyJ5CEJ1bF9DyIqJPtYu+0tEhnUeZwC4SmnO41hJn7M9yZ+RfLsKWvWMNC86p7Lyl8W1T+o1CAHqXgi1rMUqQvX1WrN9FZFhAG/S9W1GK3vnkfHWglYqanUrYN6agT9SoaBbGi30+cySJvOpI5SZeIMTsLxSd423POXlDdD3zEQoCWP83vC2BuD/vSbjcDSM6P1H42Hu0/thOoZhvdf0/qB3R7Rg9CC5eTQXg7k5jnUHkj9v8Z5X9b6PaWpjjPcW/XzVzfWh8Ta96n2vaI5Vva/rhMC8LFhFkm8h+cdoLeqKC3vp5woZn/nLFvtTdT//j7onOhnrh0j+IKKZWhMaOr/LNb9Uv1+J7r/0n+vl8Nb79tHzm4HN5TT9zlAzPNZ9+XD0nZpeF/ZLqXJ4806SD7l31vX+ijb8xkRyE7q9vtbtQV1/fmICje8y450taOh5kl/TbgmdPH8R/d6MJjhX74ZfKx5cG50dzWj+BJLrdLEmB5O8042xHo3ZeMDmrfDNlDSSZ0TjMpz9FckpfaaVt5L8p74zfv9n24zdMuYfjc5lW+t9x8HrUSJ5kaN7z8/e3y8jgqOPAyP6MJx4zsYYmwTt909oVlG7Io/dgEns54jIWRn7zOUFQyT/0qNmYOvxLv09TkWvqOXkGgQfbaeVY42wXk/yT/10Bei7nhKRrTtputsPUI1ySETuI3kvQosJa5RssW17iMiPxuqdZU28RWQ7khchxHDZs0xjMxP5wQB2I/kIQuHKk5uY/e33oxDaXqyu2mtF6cXvv73nXBH5nAok1Zw0qNwqaasm/XONFTgr0qQ7HpdaME6JNOKqrsXPXIpzvQ94UxaRv5C8Qa2Jxsdquk8HkrxO3Uc1TFwwDX25PtO+xfw8JyKbtbF0FhAST9ZFKJDbjIaWQsii+wzJVxGyq3Zs4ZIxOvo8gE8rHXleZGOrIQRjv9aYdyz6cQLJlsp3N2tiHbLA9yMB7EHySYQixz/GvLXUDKYh9JktIhQQNjosRutpa/oJ7U/btIm69b8luXfE741WLlar3BCa11XMg1buJXkVQlaoX5sSgINI/gajOz+MBbbGR2mz9bxlBrNsHiYiN0V1BN+o/D2GmWgkOPXDW2ZB7JcoPq/u8KIKYFGSB4vIyeD4wEmxRuykwi85q0WeFqw8oR5p/nX3vptc0K+M4VqJLViDhmeajXPQFiyngRZIfk4tD9XIEvI3kmtmsYaYeT+yZNX1mfUmFppOYSTae//c89vhaQ8WrKvysGA57W+I5BtIPh5pgJktWM7FslmkwZl2/AjJ9TqxPPYwnylNrAvDOo5NPc1NUAvWoOHFLEILyTcrjhj9VyPcH+7y/cMRLVbds85sZTFtR/Pu5+v7QPOVJjy66qxXn9B3t816JLkhyZccnhqtPK7V8wv9tLa6fY2tLiM6jj2a8Zk2FqxBwaedxdzOzpsinLS9/Um7vcjrvNL7kZEF08ZyO8mVC220nFofrjl6H24z9mnoX+++ek7z8NY+q7dRRogh2gwaw9ajVajWx8s0lJkTRn0PGh9F5McIAeq+QXEFoc/cR/VzpTGeRd2DsmrLv3Aahg96LDtcr2fEHV8vxoJaTXP5qYjs6voA5mFtKKhGf3JelizrTyYijwHYEKE6ca2LMVsQ72FoxJ94Lf8azQ4t5hkH0cY6/jWMDti3jKljNEliED0p84B+0n41C+27zNMHFUf2RyNOaASNWJchRxv1jDzYEkLE0ZHV3Po3gNP1AKt2gNN0LqEtEMqm1BwfaUbz7GAvSu5ZVnzVrHLbishvdL2Gx6CVQxCyzXzGWxHALRrQXxxQKZfDmuyZxVBJl7yqH/g6151Zr1ncVKBdB6MLixaVl53s2in1zQuknp8TMW+B64p6O9YsOIT3l5k8+3W1EAopAB4E8JJDbj+urBtdb3Ehp/HbO6pKsP9FSH/fQmu61DsgklbjlQFc3Y6tn9p9EaEgXrwWNQBv0JpY9QwM1/YHIrI9QiHY36PR66wWmffHWg+/93RMt6LPXV2FK0Ejw7RbocrToZm5V49cSXm4DEoi8rC6R8tuTZrxg2YWgzrJ5TG6DpEdas8C+HJOvdSyrtslCKn9duDbAfYehMKQEy3YfSLTvmWeFkTkYRE5AyHN/zYVhAoRbmTFS1+Mk849dRtC3741ReQfLsOwUyWtrkLOFure/D0aDc1jms86Xon2Zkjp5RQAS6twVdQgcbShlWXRCHswWinoefeFAdGKzfsPTkCkcxWeDGB5DeqXNgLyeMkMpqytoC7qiuPHAuB6Efm7OwP6ZRCgCqMlhNCEulM8TGlYZ7xchCe2cDmY6e/OJt95IqOLcKsBz+XrFjTpit9lESTazXVQ8NQYLsL9WnxvvbxdhJH5erU2Y169Exdck7ltTvKcNq6/VlczOF2zilq+rwu30eVN3jO7L6d7cFmU1ex+RZs1P7uJS39I7we1+M5LA3a7TdH7KS3GM72X/emTi/DmcaT95zuhS0/rGtx7bxc01IqOzm3GB3rB6+j37Uhe0sV4m7lu52gG5f5Zx+t4/R5t3KWFAeGeKL2v2Ab/Xt/E7WouwqfHCV+3cy7C5Uje1eJzq/Q7JKHJvm7datAltRgNCizw8BmnwcVWrIKaiac7qdT+1taUq/O5EaHS6kYY3fgxL41T1CT4GXWzPGCL3UqDafMsAHjYzXVQmU5mFXlijLHNUPyoOg2wiO6rfWeyqiC06vg6Qiqz7aFpu7M7fCYdgyiJyJUAriT5bYT03tP1Hcur6b4VvIBGK5k9ATzt9v61ZI0eLVdQPH/QuU0EwCv9SAhRt4pZKs5XK5kPZrZ9f6oJvZqm9hRCoUfbJ8OtA+3wGYB78DWTve6Tx1lg3ro/E8FyBQCPqCZexeAawxsPe7YTunSCREFETiV5MUIHgN0Q+lxWEaqurzrG42YqfRcRWow9KCIPmgDXjeUqA83/kuSvAHxV3Uon6XhXRkhKagcP6Ho9gJAUUxWRR916MMN4bb+fQWi8XI/46eF29vWbVqwmlog8RfISxT+fEMAxXGv36R72K4Dcg/HAmxHK3Vi5jMUArKRrWXD08xOELgSFDs/ibsHLHGcB+Egkc9RSI9R8pFgOugVKgp72ax4XHsm362ERC7r2+9ki8q8mmvagiLmvWu1kqxWVYHwtcK2EfZLfQfOMVKOjC0TkT4Om+WY0SvIDALZtIuC+pkiLyJGtLJATpLZdovkJDDJORT/ZbnOtU3krTWosxEH/guTRzZgm0ng7GX8v+5ADAyj0Y72bzIvhsZlwyzeV7cs6jNeaj4GHLem13fcGZLmaMDg7P9F+l2NnlkM7pqOs3xsnmp9nnt2u2/xAK+NYJJxNWg5N6HXEeBJ3ggQT7LCzQNg4ANZ+r07EQzpBgglGR+UW58qEoyOrPI7WQe+czFaqBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQIEGCBAkSJEiQYFAgaQkSzM9AUgAU4j+LSD3HdxS6pSURqfVhzsWxnq2fyXUdWo2j3XsGMY42+5T7e92cM3+l33P3Y2qGE1nwJScabDpXty91EWHiWgmSgJUgwSQRsCYy0yZZyOuA1YOsLCIj7vehJkLdsPvOkH2+n/MiOaW5fClz9f9lEakMGg/yXP8extaXPWj2bJLlSOGgw5cigCKASl40E+9rMzyI8FGSkJUgCVgJEkxwwUqZN0l+DAAdzs8AcI/9v9dDm+TaAJbXd3REUyJyg45Vejno/cFE8j0AFgNwNIB3A6jpwVkFUAJwM4BTAMwQkb/mKWioNYK6LhsDqAN4K4Dj3DgMagB2B3CLiLxAstgni15BROokVwSwhr63BOBxEbk/x7kLgG0AzMzyccWVp0TkX3ngQBt8WAvA6/Sd5wKY7t4/AmBXAHNF5IY8BR2SJRGpklwcwLoA3gbgGIeHdj8BwN0A/ioiM/qFBwkSJEiQIEcBi+R5nBd+b9p9r9q53i9j9/DtHOZa1PvyJE8jOTfju1/Wzy+R05oX3c9f62AN/kLy605Ay1W4Ilkk+XqS90fvfY7k2+wzObxHdD07gRn6nYXzmr89g+Si+uyXMo7lfP38CiYg9SJc6f1wkrdlfP/dJBfrBx4kSJAgQYJ8hasVSI64a47ebyQ5nWTZPtujgHU+yQrJ2XqvqJAzp8U1rOOo6MHyMMktVRAodDnXJUn+U59X1+fX9B0j0b2mPxvcSXINO9x6FPI+QvIRfW4lmutI9HM8ju/rM6b0si8txrWzvmMOyaruFUl+nWTJ9rIXnFMh61Y370o072aXweMkj+91/g4fFiZ5u3v+SIbL4AGS0/3zOlwHE66Od88cVpqI8bGq17B+7o8kF+nm3QkSJEiQoP8Clgk+lzQ5xI2R79SrFcu95wJ3iHUKVb2/0qXVpExyOZJ/cwJEXa92UHeCmMG7VMgrdjgOE2I2cNazWoYx2Of8AfuDPuHEzCZjqul9mTwOdF27uW59s8BIZHH8RmwN7BAfhtRydavDh6x7YQoASf5DFZRyJ0K/s56d4OZXzYCLnjZvV2tsMQlZCSYzlNISJJhPhaxp+mMBIebGoIwQf/JVkjcCeCbnwFqLMzoUwB/155qjtxqArwB4L4Bp+rcRAEMkvyoix1vsSgZLBUWkoi5Piy2aihD3VADwLICdAczR3+sAlgDwUwBLohGLVEOIxzlZRDbo5FBTQaBOck0AV7vnWWbYCIA7AHzV7YXF33wZwFYA5gKYAqAC4ACSFQBHAKj1GoujB/6iOo5F0IjFg1uTxUm+oD/3Cq/qXF4bAoCXWnxWdD+g764BOJpkRUSOtbXtADcpIiMkbwLwfl3jqW4/XkSIeZvh5j5F8WEF/azh8FoIsXFvVqtUJhpxMWRf1OcX9V0zAOwAwALajS4+BOB4owG9rw/gPSJyua5BisdKkCBBggkgWJl7YsPIQlN1FgvTmBezwyNHC5a5/T4wxne3cm40G+Ov/HMzWgo2jixh9qzPt7I8qKXjsMjSZNf7/PMzWm1KJL/p3m9WqRdJvneM718d7YlZUHbOuhYZ9uc8t9a2VnW3Zn/wuNOjBeuFyDr2krr8ik2uRUheRPJR/XzNWXG+qdaoYsZ3Gz68J8JDm+NX2uBDkeTeJK9tsjabd4IP7pmPR1aprdp89gj32bquwzOJmyVIkCDBxBGuRK/FSP4+Ouhil0SN5Pe6OTwyClgf14MrPlxLei1N8iodi7n1zu1AwDJB8q4mrr4DI2HKv7/g4nS+qgepxQrVSV7TqWCja+7djuaWfUeLMRTd+KeQ3JHk8+6QrZHcpRcBS99ZIPkBkv92gkOMBxUNNN/UWeTyFrCKbax/cIHxI5GwWXLWyqy4eHmEi1WSx7l9aocPK7i9M4Xkr90InyT/EwlYG+rfF22BB8fq5+bqd+aQXChxtQQJEiSYIAKW+zk+SP9M8kGnnddJPq3ZZV3FeowhYG2iB1rZCX52wE1V64V971W9/y6LUOHeu7sGa1tA9SwTrtoFSus4punPF0dB0LNIfjLLoeoO5nX0e3VnEft9FuHVPeNSJ/DUVTBZNquA0WaNtooO+tka1P9i9PfzdU96yZxrJWCV2uxDmeTiqhDU3PrN9gJqRmF7C92HkSZW0Wnt1lFxcirJk926jOg49ulC6H7S4VWd5CEk3xgJeqLKRpHk6rovBvdrBqL0allMkCBBggS9C1hmEdjXMXZzdSxM8tPu8HjNFWMCSc4C1ofH+O6G0Xfmktw644FqQttBkVvtjx1YwMyC8BG1Hnn31KczClg2/5udC87We50sAfP6mbIGNcfwuh4ELEsAuNRlU1ZJPq3//1+XwWZ79pYeLZodCVj+XSTf4lx6Np7bMu6DCVg7RFbAF0hulKUMhSkZJNdT917VBd8f2IWA9YITFm0tnlHX55Qm+Gy4tBfJo6x0SCrXkGAyQ0LeBPOT9UpILgrgCwjB7MOK46cgBMreCOAfCMG0dYQA5GmaSZh3Ne8VSa5E8o16t59XJnkOgHMQgpALCEHfj4nIZRpMPOZYNOD4hejPJT2Qsny/hhAUfROA53UcFsS8TIcHmxXWtPn8CMAjAAo+SN3KIfgLjcKjiwJ4BsB/9Hpcn9cVLugargbgUzqmgr5rbxU2DkQjANvW7Gxr3TMovNUCqEMAngBwpo6lGq1rVpihd0tyeEFErtd9rmXAh5KI3AXg37o2tg7TVYhjhrW3/dwPjaQGuy8H4CgAf1chaiWSi4tIxaq9i8iPROQEEXlpIlTZT5AgQYIkYDU04IOcNcY08K+5z33RafhmKXhndDj0YsHqBEyzf5DkKhrUPKZLTa0Ni5K8MHJz/bmTebh4nIeaxKstPZb1yM3/Sud+oysaOjROuGAWnTuimlu3k1zCWe+ucm5JOutWt0kPHVuw/DqRPDJax+syWrCsPMPpER4+1on727nr7mqSGLJ6FouSw6nlSN4X4fpIkyK4d5PcQ63Ob+jUUpYgwUSG5NtOML8JWUVnjSkDeArAxS7l/fskT3aaPgBM6bWSdxOotND4C258AuBJABuIyNPaImQsjV1EpKa1m3bU53Q9dn1WPM5eLThDTSxKVMvd69C6pZBZXu4WkWN6sGCIuqHqyuNmKy5crJaRhURkNslTAGyKRomExdQddpq+e9DlAbpxU4tawRYG8Hn9s2+yXetEYGyBD1VktPDqWAoi8izJjyBYjVcCsDAaHpO5ui9FhFZOP9a/P0byBgAH6TOGE1dLkASsBAnGV7Ayt8qSAE50B6sA+K2IPOjisxYBcCeA9dwh/zMRWS3noobttHATMGoAlkWoA7SnCgYTodlt3u8XfeaWOt+xYDO16hxPcqQTQceaC5P8HEKtsWEV+F4A8Kzhit7nILgjl1X8WQjAWs5tN5nqL1EFl6l9OicynxW6fiIi/1HrcAGh9ts7EXoSLunGXNO1FwBvUDr4DIB1Sd6HyM2cIMFkghSDlWC+ABVKjnbWk6Iy7cNdXFJRRGYBONIJODWEeKkd1crSqyXLYrtOVYvCAXr/gt4v0neLHlplAJ8jecFYxUUbMgSLAP4L4BI3D7PcdFOFXZrwhV6EzZEWfx9u8/mqXjVdvyMBTOvEAqOfq5F8PYC93DxKAO4XkV/ogT2CEG/0BwDXOQGwCmB9km9SIaw4YDSu9Pj9WLjqFR+sAO2lAJ7uMD6tpFbEERF5VUSOFJFNAGyhdPA7fXYRwXJXVNqpIFi7jlaaTjFYCRIkSDAuansj5Xt5jX/xpQKeILmsLyaqcSaLaoHHuot3uUHT5csdHOhxDNZsffeVreJIdKxvJLmNjrfqsgC/b2PM+N6dojnc5Q7JLOO3DLb7XA0ikjwwYwZgXHvJ5nGWljwoR++5huT/kbxX+yb+w6Xz16OyGlWS6zrBqZP5rOTifqzo6UU+m86VzVjWxWBZ7NL++tlOaz91lUWo41hHS0dU3TiuzogPVs9q32gfH+pw/Wy/bo1iwfb0/8+6D03GWHK/TyX5BpK7uR6atagg7GlZ5p8gQbJgJUjQHyhrnM4RABZ3lhABcISIPKefMc27ICIzMbp9zQiAjwJYT7OZurVclFTj3gzAxiqsTfNZcyJSF5FHReS3AC50mru5C9GB9Wh5/WzBWeLem8VyYZYKLSextI7B3vu0umWyjmNxN/8agH0AvFGtSa/FlYnIx0VkLRF5q4isKSJrI7iM7lTLSN1ZAYtoxOZ0yqd28VY9fdZeOg4bC/X+HICz0Yj/qgP4vlq4qgPAX3MJz0WjbY7oOBbv4Bl1AE9H359O8qMd4EON5NsArIJG9h8ALNlhHFed5H7aLeAwkhsrPtWtLIeIzBWRx0TkPBFZE8AFGN3WqobQvqcTekiQIAlYCRLkbMWaioZLsIbgJvwLgBtU+/Wul4oeFsciuKws2JYAvk1yMT1oemXqlnpesTR0S0XX8QKjyxAUACykMWIc4/3mvroAoc/fkM5xRQA7qWAw1M7qB2BID729ACyFhjtoNrK7ZWz8ByH04LM9IIDv66HPyFpTcJlm00TkaQC3YN6ekdCxdIgKXBihx2HRCdrfADCiwp53cVmG3RloJB4UFC+W7HcNJo1TqimOnumEXEvUOMgJnJkeqWtmdLAkgP10H4baFJ61xIulANyAEJRugvtcADOzxAW67M2jdE2/pdcBWti2KCI1jZHzVeWHRGRnAL9Co0xFEa1dzQkSJEiQoM8HlLl71nbtYszF8kXP9JsIGOba84UQGX9mjPe3KzS6kR+jf65LY782Gvdj2ksuS2FIO8xuc6UGrJjm/tE8W7VGOcp9zyqoX2sVxjuVbJq0ylnHzVmicdgYjoh65vmf/9hsDVu830odnOoKt1Z0Td9u748FC73eom4qX2w1c19Ij49ZW+U4AWMhdU/7sgh1bdjckXtPn/m7CBcrVqYkEm6b4cN+UcHYGsl7slZTd/RwiessMEt/fr/hbTSGgrXEce1yZun94k73IEGCBAkS5GQB0IPlt9HB/N92h5OLe3lTdLCNkDwmi4CTQcDauEWrHPvO5k2aPZ+d9UBxc9gsmrvd9x7j+4dGzZ7tUP2gs2pkFSrKJE9y87G4pxkk123Ti6/gxltrMoeOBCw9vE+LDumfewGsyfem6P1IF79U1V56G2XFhTEErBgHTLiaQvIPUdyRxbFt0EmbGBd/tr7DQ688HDHG9/eI4tCqvklzFnxwuP3jqP4YSV6vcVetGk6vRfIBfa8JuZcnAStBggQJxlfQGo6EBVqvvTGEkzVcI2A7WP7QgZDTrtDoSyT/2+Z60R0+Nv4rrcVLRuHSLA/3u0PRH6r/1YNtfZIf1Pum+vdYuCLJuzuxmjihQvSAnO3az9g+zCT5HMkT9P3rq+DyrI5jpEkT5monQfvOkvlWHUPFHdTfHCtg3SU+3BsFd+/cTjhrsRYzoqD9eov9f8591vbB8OB4jd3rNMje8OH2SGirOnzYQvfgfXr/kLbG8eOwzz8c41rGcSyqgmotKl77vI5hq2gMH9D18IL2MMlvtLJCJ0iQIEGC/glV5l7YSQ9xbwE53dwhbb5vlouvOMtBVauav6uZS6mNgHV+l5XcfTPcOsktO7QeWb+91znhoJ5xHPHn7iK5ZJZq8m0EnA3dM+PDtd387fC/NBI478koYImO+7zIIvlKh+O/zwnbNZJXqKDTiTXv5SZZke1gTrQPJ/ZAE1bRfXEnZM1x+JVlL2zP/qmN0Mud4IOzpH0rem4lY2cDW4vZicslSJAgwfgIWBZz8ytlzK/qYfISyTXHOphdTNDyJP+mjH2mMvdjzfWVUcC63I2h4twjWS47WDK7YlpYLZYm+Vf3zGH3jkp0+XfP1jiuxbt5fxMhZSO1Cnr3Z8W1JvJjGHYH8Fokt9P/zdT7FVkELDcGe7a52XbNGM9ma/hhNx5bn7dnseo5q+gXohiwdrjghY5bSa7trYLdClnOinSXe36lBS4MR/OtKD0s0y0+Oro4keRTkaCVZQw1kttavFbidgkSJEgwOOHKgmTX1LgND2dZfEuHlosYVhvrgHHf353dw0XOcjWl2/VwP29K8mcZ330uyQ1iQaMXq6L7+ZiMYzjPJQQcFf1vmbHG5QSK7aPv3kdyRbN0ZhAKLOD8zug5/84q5Om7Kh3u/w9JnuECvQt50IfeFyd5prqjs8CFJLdohlc9jGExnd/zGcdwCclt9LvJNZhgUkOqL5JgUgpYWmtnVQDvQCM1XQA8JiL/l6WPnTu4349Qc8ha2BDAzdqvTjKmqH8EwDS07rM3z1cQ6hddaYdzLy1BdC5WDwlqEavp+hyPkPpeAvASgJ0Q+tRd5Q5D5tGixz9LBcc6gHUAnODGMBPaR9HNv4BQHmBtNGpS3SgiczPiwscQKplX9B1/F5EnsvYzdM9ZQvGhhlAq4GUR+d8seKB7sDHGbitjOFIVkWvjMeREI6+NV61wK+q6XgBgutuL4wDchVD36/I88cHPRzNKV9Z1PR/AMm4M3wRwezSGYmqRk2Cyw/8H/4l9vSQiUOsAAAAASUVORK5CYII=" alt="Liberona Escala Abogados" class="firma-logo"/>
        </div>
        <div class="report-title">
          <h1>Reporte de Gestión</h1>
          <p>${label} · Generado ${now}</p>
          <p class="firma-sub-url">leabogados.cl</p>
        </div>
      </div>
    </div>`

    // ── VENTAS
    if(sections.ventas){
      const ss=filterByPeriod(sales.filter(s=>s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada').map(s=>({...s,date:`${s.year}-${String(s.month||1).padStart(2,'0')}-01`})),'date')
      const brutoUF=ss.reduce((a,s)=>a+(parseFloat(s.amount_uf)||0),0)
      const costoUF=ss.reduce((a,s)=>a+(parseFloat(s.cost_uf)||0),0)
      const netoUF=brutoUF-costoUF
      const pct=Math.min(100,Math.round((netoUF/9800)*100))
      html+=`<div class="section">
        <div class="section-title">Ventas</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Bruto</div><div class="kpi-value">${fmtUFN(brutoUF)}</div></div>
          <div class="kpi"><div class="kpi-label">Costo terceros</div><div class="kpi-value" style="color:#E24B4A">${costoUF>0?fmtUFN(costoUF):'—'}</div></div>
          <div class="kpi"><div class="kpi-label">Neto</div><div class="kpi-value" style="color:#1D9E75">${fmtUFN(netoUF)}</div></div>
        </div>
        <div style="margin-bottom:16px;padding:10px 14px;background:${A4};border-radius:6px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:10px;font-weight:600;color:${A}">Avance meta anual UF 9.800</span>
            <span style="font-size:13px;font-weight:700;color:${A}">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`
      if(ss.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Área</th><th>Estado</th><th style="text-align:right">UF Bruto</th><th style="text-align:right">UF Costo</th><th style="text-align:right">UF Neto</th></tr></thead><tbody>`
        ss.forEach(s=>{
          const c=clients.find(x=>x.id===s.client_id)
          const neto=(parseFloat(s.amount_uf)||0)-(parseFloat(s.cost_uf)||0)
          html+=`<tr><td>${c?.name||'—'}</td><td>${s.title||'—'}</td><td><span class="badge badge-area">${s.area||'—'}</span></td><td>${s.status||'—'}</td><td style="text-align:right">${fmtUFN(s.amount_uf)}</td><td style="text-align:right;color:#E24B4A">${s.cost_uf>0?fmtUFN(s.cost_uf):'—'}</td><td style="text-align:right;color:#1D9E75;font-weight:600">${fmtUFN(neto)}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="4">TOTAL</td><td style="text-align:right">${fmtUFN(brutoUF)}</td><td style="text-align:right;color:#E24B4A">${fmtUFN(costoUF)}</td><td style="text-align:right;color:#1D9E75">${fmtUFN(netoUF)}</td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin ventas en este período</p>`
      }
      html+=`</div>`
    }

    // ── COBRANZA
    if(sections.cobranza){
      const bb=filterByPeriod(billing,'issued_at').filter(b=>b.billing_type!=='reembolso')
      const pending=bb.filter(b=>b.status==='Pendiente').reduce((a,b)=>a+(b.amount||0),0)
      const overdue=bb.filter(b=>b.status==='Vencido').reduce((a,b)=>a+(b.amount||0),0)
      const paid=bb.filter(b=>b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
      html+=`<div class="section${sections.ventas?' page-break':''}">
        <div class="section-title">Cobranza</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Por cobrar</div><div class="kpi-value">${fmtN(pending)}</div></div>
          <div class="kpi"><div class="kpi-label">Vencido</div><div class="kpi-value" style="color:#E24B4A">${fmtN(overdue)}</div></div>
          <div class="kpi"><div class="kpi-label">Cobrado</div><div class="kpi-value" style="color:#1D9E75">${fmtN(paid)}</div></div>
        </div>`
      if(bb.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Concepto</th><th>N° Factura</th><th>Emisión</th><th>Estado</th><th style="text-align:right">Monto</th><th>Antigüedad</th></tr></thead><tbody>`
        bb.sort((a,b)=>(a.status==='Vencido'?0:1)-(b.status==='Vencido'?0:1)).forEach(b=>{
          const c=clients.find(x=>x.id===b.client_id)
          const dias=b.due?Math.round((new Date()-new Date(b.due+'T12:00'))/86400000):null
          const badgeClass=b.status==='Pagado'?'badge-paid':b.status==='Vencido'?'badge-overdue':'badge-pending'
          const diasStr=dias!==null&&dias>0?`${dias}d vencido`:dias!==null&&dias<0?`${Math.abs(dias)}d restantes`:'—'
          html+=`<tr><td>${c?.name||'—'}</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.concept||'—'}</td><td style="font-family:monospace">${b.invoice_no||'—'}</td><td>${b.issued_at||'—'}</td><td><span class="badge ${badgeClass}">${b.status}</span></td><td style="text-align:right;font-weight:600">${fmtN(b.amount)}</td><td style="color:${dias>0?'#E24B4A':A2}">${diasStr}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="5">TOTAL</td><td style="text-align:right">${fmtN(pending+overdue+paid)}</td><td></td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin cobros en este período</p>`
      }
      html+=`</div>`
    }

    // ── GASTOS
    if(sections.gastos){
      const balances={}
      expenses.forEach(e=>{ if(!balances[e.client_id])balances[e.client_id]={fondos:0,gastos:0}; e.type==='fondo'?balances[e.client_id].fondos+=e.amount:balances[e.client_id].gastos+=e.amount })
      const clientsWithMovs=clients.filter(c=>balances[c.id])
      html+=`<div class="section page-break">
        <div class="section-title">Gastos y Fondos</div>
        <table style="margin-bottom:16px"><thead><tr><th>Cliente</th><th style="text-align:right">Fondos recibidos</th><th style="text-align:right">Gastos realizados</th><th style="text-align:right">Saldo</th></tr></thead><tbody>`
      clientsWithMovs.forEach(c=>{
        const b=balances[c.id]
        const sal=b.fondos-b.gastos
        html+=`<tr><td>${c.name}</td><td style="text-align:right;color:#1D9E75">${fmtN(b.fondos)}</td><td style="text-align:right;color:#E24B4A">${fmtN(b.gastos)}</td><td style="text-align:right;font-weight:700;color:${sal<0?'#E24B4A':'#1D9E75'}">${fmtN(sal)}</td></tr>`
      })
      html+=`</tbody></table></div>`
    }

    // ── TAREAS
    if(sections.tareas){
      const activeTasks=tasks.filter(t=>t.status==='Activo')
      const WHO=['Cristóbal','Martín','Martina','Erasmo','Rodrigo']
      html+=`<div class="section page-break"><div class="section-title">Tareas Activas</div>`
      WHO.forEach(who=>{
        const mine=activeTasks.filter(t=>isAssignee(t,who)).sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))
        if(!mine.length) return
        html+=`<div class="who-section"><div class="who-title">${who} · ${mine.length} tarea${mine.length!==1?'s':''}</div>
        <table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Tarea</th><th>Plazo</th><th>Estado</th></tr></thead><tbody>`
        mine.forEach(t=>{
          const c=clients.find(x=>x.id===t.client_id)
          const u=urgency(t.due,t.status)
          const color=u==='overdue'?'#E24B4A':u==='urgent'?'#C77F18':u==='soon'?'#C77F18':'#1D9E75'
          const dias=t.due?daysLeft(t.due):null
          const diasStr=dias!==null?(dias<0?`${Math.abs(dias)}d vencido`:dias===0?'hoy':`${dias}d`):''
          html+=`<tr><td>${c?.name||'—'}</td><td>${t.project||'—'}</td><td>${t.title}</td><td>${t.due||'—'}</td><td style="color:${color};font-weight:600">${diasStr}</td></tr>`
        })
        html+=`</tbody></table></div>`
      })
      html+=`</div>`
    }

    // Footer
    html+=`<div class="footer"><span>Liberona Escala Abogados · leabogados.cl</span><span>Reporte ${label} · ${now}</span><span>CONFIDENCIAL</span></div>`
    html+=`<button class="print-btn no-print" onclick="window.print()">Imprimir / Guardar PDF</button>`
    html+=`</body></html>`

    const win=window.open('','_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(()=>win.focus(),300)
  }

  const anySelected=Object.values(sections).some(Boolean)

  return (
    <div>
      <div style={{marginBottom:16}}>
        <Lbl>Período</Lbl>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          {[['month','Por mes'],['year','Por año']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${period===v?C.accent:C.border}`,background:period===v?'#E6EEF1':'transparent',color:period===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:period==='month'?'1fr 1fr':'1fr',gap:8}}>
          <select value={selYear} onChange={e=>setSelYear(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {period==='month'&&(
            <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:13}}>
              {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={{marginBottom:20}}>
        <Lbl>Secciones a incluir</Lbl>
        {[
          ['ventas','Ventas','Meta, proyectos, bruto/costo/neto'],
          ['cobranza','Cobranza','Facturas, estado y antigüedad'],
          ['gastos','Gastos y Fondos','Saldos por cliente'],
          ['tareas','Tareas activas','Por responsable con urgencia'],
        ].map(([k,label,desc])=>(
          <div key={k} onClick={()=>toggle(k)} style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 14px',borderRadius:10,border:`1px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?'#E6EEF1':'#fff',marginBottom:8,cursor:'pointer'}}>
            <div style={{width:20,height:20,borderRadius:5,border:`2px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
              {sections[k]&&<span style={{color:'#fff',fontSize:11,fontWeight:700}}>✓</span>}
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:sections[k]?C.accent:C.text}}>{label}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {anySelected&&(
        <div style={{background:'#F7F7F7',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:C.muted}}>
          {Object.entries(sections).filter(([,v])=>v).length} sección{Object.entries(sections).filter(([,v])=>v).length!==1?'es':''} · {getPeriodLabel()} · Tamaño carta vertical
        </div>
      )}

      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={!anySelected} onClick={generatePDF} style={{flex:2,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:!anySelected?.6:1}}>
          Ver reporte
        </button>
      </div>
    </div>
  )
}


// ─── TASKS ONLY VIEW (para usuarios limited) ──────────────────────────────────
function printTasks(tasks, clients, filterLabel) {
  const today = new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
  const rows = tasks.map(t=>{
    const client = clients.find(c=>c.id===t.client_id)
    const due = t.due ? new Date(t.due+'T00:00:00').toLocaleDateString('es-CL',{day:'numeric',month:'short'}) : '—'
    const urgent = t.due && daysLeft(t.due)<0 ? 'color:#E24B4A;font-weight:600' : ''
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:12px">${t.title}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${client?.name||'—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${t.project||'—'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;${urgent}">${due}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:#666">${taskAssignees(t).join(', ')||'—'}</td>
    </tr>`
  }).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Tareas pendientes</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
    body{font-family:'DM Sans',Helvetica,Arial,sans-serif;margin:0;padding:24px;color:#3D3D3D}
    h1{font-size:18px;font-weight:700;color:#003C50;margin:0 0 4px}
    .sub{font-size:11px;color:#999;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}
    thead tr{background:#003C50;color:#fff}
    th{padding:8px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase}
    @media print{body{padding:0}}
  </style></head><body>
  <h1>Tareas pendientes${filterLabel?' — '+filterLabel:''}</h1>
  <div class="sub">Liberona Escala Abogados · ${today} · ${tasks.length} tarea${tasks.length!==1?'s':''}</div>
  <table><thead><tr><th>Tarea</th><th>Cliente</th><th>Proyecto</th><th>Vence</th><th>Responsable</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`
  const w = window.open('','_blank')
  w.document.write(html)
  w.document.close()
}

// Vista previa de solo lectura de una tarea (se abre al click en una tarjeta)
function TaskPreview({task,clients,onEdit,onComplete,onClose}) {
  const [comments,setComments] = useState([])
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
      <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:3}}>{label}</div>
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
        <div style={{fontSize:12,color:'#854F0B',background:'#FAEEDA',borderRadius:8,padding:'8px 11px',margin:'2px 0 10px'}}>
          <span style={{fontWeight:600}}>{task.delegated_by}</span> la delegó a <span style={{fontWeight:600}}>{(task.delegated_to||[]).join(', ')}</span>{task.delegated_due?` · vence ${task.delegated_due}`:''}
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <Row label='Plazo'><span style={{fontWeight:600,color:plazoCol}}>{plazoTxt}</span></Row>
        <Row label='Estado'>{task.status||'—'}</Row>
      </div>
      {subs.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>Subtareas · {subsDone}/{subs.length}</div>
          {subs.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0'}}>
              <span style={{width:14,height:14,borderRadius:3,border:`2px solid ${s.done?'#1D9E75':'#ccc'}`,background:s.done?'#1D9E75':'#fff',flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{s.done&&<span style={{color:'#fff',fontSize:9}}>&#10003;</span>}</span>
              <span style={{fontSize:12,color:C.text,textDecoration:s.done?'line-through':'none',opacity:s.done?.6:1}}>{s.text}</span>
            </div>
          ))}
        </div>
      )}
      {comments.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>Comentarios · {comments.length}</div>
          <div style={{background:'#F7F8F9',borderRadius:7,padding:'8px 10px'}}>
            <div style={{fontSize:10,fontWeight:600,color:C.accent,marginBottom:2}}>{comments[0].user_name}</div>
            <div style={{fontSize:12,color:C.text,lineHeight:1.4}}>{comments[0].content}</div>
          </div>
        </div>
      )}
      {links.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>Archivos · {links.length}</div>
          {links.slice(0,3).map(lk=>(
            <a key={lk.id} href={lk.url} target='_blank' rel='noreferrer' style={{display:'block',fontSize:12,color:C.accent,textDecoration:'none',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{lk.title||lk.url}</a>
          ))}
        </div>
      )}
      <div style={{display:'flex',gap:8,marginTop:6}}>
        <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
        {!terminada&&<button onClick={()=>onComplete(task)} style={{flex:1,padding:11,borderRadius:10,border:'1px solid #1D9E75',background:'#E1F5EE',color:'#0F6E56',fontSize:13,fontWeight:700,cursor:'pointer'}}>Marcar terminada</button>}
        <button onClick={()=>onEdit(task)} style={{flex:1,padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Editar</button>
      </div>
    </>
  )
}

function TasksOnlyView({tasks,clients,sales,expenses,pettyCash,onAddTask,onEdit,onComplete,currentUserName}) {
  const [vistaCalendario,setVistaCalendario] = useState(false)
  const [semanaOffset,setSemanaOffset] = useState(0)
  const hoy = new Date()
  const lunesSemana = new Date(hoy)
  lunesSemana.setDate(hoy.getDate()-((hoy.getDay()+6)%7)+semanaOffset*7)
  lunesSemana.setHours(0,0,0,0)
  const diasSemana = Array.from({length:7},(_,i)=>{ const d=new Date(lunesSemana); d.setDate(lunesSemana.getDate()+i); return d })
  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']
  const fmtISO = d => d.toISOString().slice(0,10)
  const fmtLabel = d => String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')
  const semanaLabel = fmtLabel(diasSemana[0])+' — '+fmtLabel(diasSemana[6])+' '+diasSemana[6].getFullYear()

  const [filterClient,setFilterClient] = useState('')
  const [filterProject,setFilterProject] = useState('')
  const [openTerm,setOpenTerm] = useState(false)
  const [verArchivadas,setVerArchivadas] = useState(false)
  const [openActivas,setOpenActivas] = useState(true)
  const [openAsignadas,setOpenAsignadas] = useState(true)
  const [preview,setPreview] = useState(null)
  // Popup flotante de detalle (hover en desktop / long-press en móvil) sobre las tareas del calendario
  const [hoverTask,setHoverTask] = useState(null)
  const [hoverPos,setHoverPos] = useState({x:0,y:0})
  const hoverTimer = useRef(null)
  const longPressFired = useRef(false)
  const startPress = (t,e) => {
    const p = e.touches?.[0] ? {x:e.touches[0].clientX,y:e.touches[0].clientY} : {x:e.clientX,y:e.clientY}
    hoverTimer.current = setTimeout(()=>{ longPressFired.current=true; setHoverPos(p); setHoverTask(t) }, 380)
  }
  const endPress = () => { clearTimeout(hoverTimer.current); setHoverTask(null) }
  const me = currentUserName || ''
  // Proyectos dependientes del cliente filtrado: solo los del/los cliente(s) que matchean el texto buscado
  const clientIdsFiltro = new Set((filterClient ? clients.filter(c=>c.name?.toLowerCase().includes(filterClient.toLowerCase())) : []).map(c=>c.id))
  const proyectosCliente = filterClient
    ? [...new Set(tasks.filter(t=>clientIdsFiltro.has(t.client_id)&&t.project&&(enMiLista(t,me)||t.assigned_by===me)).map(t=>t.project))].sort()
    : []
  const projDisabled = !filterClient || proyectosCliente.length===0

  // Tareas activas (filtradas) y terminadas recientes
  const base = tasks.filter(t=>{
    if(t.status!=='Activo') return false
    if(filterClient && !clients.find(c=>c.id===t.client_id)?.name?.toLowerCase().includes(filterClient.toLowerCase())) return false
    if(filterProject && t.project!==filterProject) return false
    return true
  })
  const terminadasAll = tasks.filter(t=>{
    if(t.status!=='Terminado') return false
    if(!enMiLista(t,me) && t.assigned_by!==me) return false
    if(filterClient && !clients.find(c=>c.id===t.client_id)?.name?.toLowerCase().includes(filterClient.toLowerCase())) return false
    if(filterProject && t.project!==filterProject) return false
    return true
  })
  const terminadas = terminadasAll.filter(t=>!isTaskArchived(t)).sort((a,b)=>(b.created_at||'')>(a.created_at||'')?1:-1).slice(0,30)
  const archivadas = terminadasAll.filter(t=>isTaskArchived(t)).sort((a,b)=>((b.completed_at||b.created_at||'')>(a.completed_at||a.created_at||'')?1:-1))

  // Mis tareas: las asignadas a mi. Tareas que asigne: yo las cree para otros.
  const mias = base.filter(t=>enMiLista(t,me))
  const asignadas = base.filter(t=>t.assigned_by===me && !enMiLista(t,me))

  // Orden por urgencia: vencimiento más cercano primero, sin fecha al final
  const porUrgencia = arr => [...arr].sort((a,b)=>(daysLeft(a.due)??99999)-(daysLeft(b.due)??99999))

  const fmtVenceShort = iso => { if(!iso) return ''; try{ const d=new Date(iso); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0') }catch(e){return ''} }
  const bsCard = due => { const d=daysLeft(due); if(d===null) return {bg:'#F1F1F1',col:'#888'}; if(d<0) return {bg:'#FCEBEB',col:'#E24B4A'}; if(d<=1) return {bg:'#FAEEDA',col:'#C77F18'}; if(d<=7) return {bg:'#FAEEDA',col:'#C77F18'}; return {bg:'#F1F1F1',col:'#888'} }
  const Card = ({t,showWho,done}) => {
    const client=clients.find(c=>c.id===t.client_id)
    const bs=bsCard(t.due)
    return (
      <div onClick={()=>setPreview(t)} style={{background:C.card,borderRadius:8,marginBottom:5,border:`0.5px solid ${C.border}`,borderLeft:`3px solid ${done?C.muted:urgencyColor(t.due,t.status)}`,overflow:'hidden',opacity:done?.7:1,cursor:'pointer'}}>
        <div style={{display:'flex',alignItems:'flex-start',padding:'9px 11px',gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:600,color:done?C.muted:C.text,lineHeight:1.3,textDecoration:done?'line-through':'none'}}>{t.title}</div>
            {(client||t.project||t.subproject)&&(
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>
                {client&&<span><span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Cliente</span>{' '}{client.name}</span>}
                {t.project&&<span>{client?' \u00b7 ':''}<span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Proy.</span>{' '}{t.project}</span>}
                {t.subproject&&<span>{(client||t.project)?' \u00b7 ':''}<span style={{fontSize:'9px',fontWeight:600,opacity:.65,textTransform:'uppercase',letterSpacing:'.04em'}}>Sub.</span>{' '}{t.subproject}</span>}
              </div>
            )}
            {showWho&&taskAssignees(t).length>0&&<span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:'#E6EEF1',color:C.accent,fontWeight:600,marginTop:3,display:'inline-block'}}>{taskAssignees(t).join(', ')}</span>}
            {(t.delegated_to||[]).length>0&&<div style={{fontSize:10,color:'#854F0B',background:'#FAEEDA',borderRadius:6,padding:'2px 7px',marginTop:4,display:'inline-block'}}>Delegada a {(t.delegated_to||[]).join(', ')}{t.delegated_due?` · vence ${fmtVenceShort(t.delegated_due)}`:''}</div>}
          </div>
          {!done&&(
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
              <span style={{fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:8,background:bs.bg,color:bs.col,whiteSpace:'nowrap'}}>{t.due?'Vence '+fmtVenceShort(t.due):'Sin fecha'}</span>
              <div style={{display:'flex',gap:4}}>
                {onComplete&&<button onClick={(e)=>{e.stopPropagation();onComplete(t)}} title='Terminada' style={{width:26,height:26,borderRadius:5,border:'1px solid #1D9E75',background:'#E1F5EE',color:'#0F6E56',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,padding:0}}>&#10003;</button>}
                <button onClick={(e)=>{e.stopPropagation();onEdit&&onEdit(t)}} title='Editar' style={{width:26,height:26,borderRadius:5,border:`0.5px solid ${C.border}`,background:'transparent',color:C.muted,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:13,padding:0}}>&#9998;</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Título de bloque (Mis tareas / Próximas dos semanas / Mi caja chica): mismo estilo entre sí
  const BloqueTitulo = ({children}) => <div style={{fontSize:11,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>{children}</div>
  // Subtítulo colapsable (Activas / Terminadas / Tareas que asigné): mismo estilo, menor que el de bloque
  const SubHeader = ({label,count,open,onToggle}) => (
    <div onClick={onToggle} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',userSelect:'none',padding:'6px 0',marginBottom:open?6:0}}>
      <span style={{fontSize:12,fontWeight:600,color:C.text,flex:1}}>{label} <span style={{color:C.muted}}>· {count}</span></span>
      <span style={{width:7,height:7,border:`solid ${C.muted}`,borderWidth:'0 1.5px 1.5px 0',display:'inline-block',transform:open?'rotate(-135deg)':'rotate(45deg)',transition:'transform .2s',marginBottom:open?-2:2}}></span>
    </div>
  )

  const totalMias = mias.length
  const primerNombre = (me||'').trim().split(' ')[0]
  const saludo = `¡Hola${primerNombre?`, ${primerNombre}`:''}!`
  const fechaHoy = new Date().toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long'}).replace(/^\w/,c=>c.toUpperCase())

  return (
    <div>
      <div style={{padding:'14px 20px 0'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:4}}>
          <BloqueTitulo>Mis tareas</BloqueTitulo>
          <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
            <input value={filterClient} onChange={e=>{setFilterClient(e.target.value);setFilterProject('')}} placeholder='Buscar cliente...' style={{padding:'4px 7px',borderRadius:7,border:`1px solid ${filterClient?C.accent:C.border}`,fontSize:11,background:filterClient?'#E6EEF1':'#F7F7F7',color:C.text,width:120}}/>
            <select value={filterProject} disabled={projDisabled} onChange={e=>setFilterProject(e.target.value)} style={{padding:'4px 7px',borderRadius:7,border:`1px solid ${filterProject?C.accent:C.border}`,fontSize:11,maxWidth:160,background:projDisabled?'#F0F0F0':(filterProject?'#E6EEF1':'#F7F7F7'),color:projDisabled?C.muted:(filterProject?C.accent:C.text),cursor:projDisabled?'not-allowed':'pointer',opacity:projDisabled?.7:1}}>
              <option value=''>{!filterClient?'Selecciona un cliente':proyectosCliente.length===0?'Sin proyectos':'Todos los proyectos'}</option>
              {proyectosCliente.map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            {(filterProject||filterClient)&&
              <button onClick={()=>{setFilterProject('');setFilterClient('')}} style={{padding:'4px 7px',borderRadius:7,border:`1px solid ${C.border}`,fontSize:11,background:'transparent',color:C.muted,cursor:'pointer'}}>×</button>
            }
            {(archivadas.length>0||verArchivadas)&&
              <button onClick={()=>setVerArchivadas(v=>!v)} style={{padding:'4px 9px',borderRadius:7,border:`1px ${verArchivadas?'solid':'dashed'} ${verArchivadas?C.accent:'#99ABB4'}`,fontSize:11,fontWeight:600,background:verArchivadas?'#E6EEF1':'transparent',color:verArchivadas?C.accent:'#99ABB4',cursor:'pointer'}}>Archivadas ({archivadas.length})</button>
            }
          </div>
        </div>
        {verArchivadas ? (
          <>
            <SubHeader label='Archivadas' count={archivadas.length} open={true} onToggle={()=>setVerArchivadas(false)}/>
            {archivadas.length>0
              ? archivadas.map(t=><div key={t.id} style={{opacity:.6}}><Card t={t} showWho={true} done={true}/></div>)
              : <div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>Sin tareas archivadas con estos filtros</div>}
          </>
        ) : (
          <>
        <SubHeader label='Activas' count={mias.length} open={openActivas} onToggle={()=>setOpenActivas(o=>!o)}/>
        {openActivas&&(mias.length>0
          ? porUrgencia(mias).map(t=><Card key={t.id} t={t} showWho={false}/>)
          : <div style={{fontSize:12,color:C.muted,padding:'2px 0 8px'}}>{filterProject||filterClient?'Sin tareas activas con estos filtros':'No tienes tareas activas'}</div>)}
        {asignadas.length>0&&(
          <>
            <SubHeader label='Tareas que asigné' count={asignadas.length} open={openAsignadas} onToggle={()=>setOpenAsignadas(o=>!o)}/>
            {openAsignadas&&porUrgencia(asignadas).map(t=><Card key={t.id} t={t} showWho={true}/>)}
          </>
        )}
        {terminadas.length>0&&(
          <>
            <SubHeader label='Terminadas' count={terminadas.length} open={openTerm} onToggle={()=>setOpenTerm(o=>!o)}/>
            {openTerm&&terminadas.map(t=><Card key={t.id} t={t} showWho={true} done={true}/>)}
          </>
        )}
          </>
        )}
      </div>
      <div style={{padding:'24px 20px 0'}}>
        <div style={{marginBottom:10}}><BloqueTitulo>Próximas semanas</BloqueTitulo></div>
        {[0,1].map(semIdx=>{
          const lunesSem = new Date(hoy)
          lunesSem.setDate(hoy.getDate()-((hoy.getDay()+6)%7)+semIdx*7)
          lunesSem.setHours(0,0,0,0)
          const dias = Array.from({length:5},(_,i)=>{ const d=new Date(lunesSem); d.setDate(lunesSem.getDate()+i); return d })
          const finSem = new Date(dias[4])
          const tagLabel = String(dias[0].getDate()).padStart(2,'0')+'/'+String(dias[0].getMonth()+1).padStart(2,'0')+' — '+String(finSem.getDate()).padStart(2,'0')+'/'+String(finSem.getMonth()+1).padStart(2,'0')
          return (
            <div key={semIdx} style={{marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:6}}>{semIdx===0?'Esta semana':'Próxima semana'} <span style={{color:C.muted}}>· {tagLabel}</span></div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:4}}>
                {dias.map((dia,i)=>{
                  const iso=fmtISO(dia)
                  const esHoy=iso===fmtISO(hoy)
                  const tareasDelDia=tasks.filter(t=>t.due===iso&&t.status!=='Terminado'&&(enMiLista(t,me)||t.assigned_by===me))
                  return (
                    <div key={i} onClick={()=>onAddTask(iso)} title='Nueva tarea este día' style={{minHeight:90,background:esHoy?'#E6EEF1':'#F7F8F9',borderRadius:8,padding:'5px 6px',border:`1px solid ${esHoy?C.accent:C.border}`,cursor:'pointer'}}>
                      <div style={{fontSize:9,fontWeight:700,color:esHoy?C.accent:C.muted,textTransform:'uppercase'}}>{DIAS[i]}</div>
                      <div style={{fontSize:10,fontWeight:600,color:esHoy?C.accent:C.text,marginBottom:4}}>{String(dia.getDate()).padStart(2,'0')}</div>
                      {tareasDelDia.length===0&&<div style={{fontSize:8,color:'#bbb',fontStyle:'italic'}}>—</div>}
                      {tareasDelDia.map(t=>{
                        const cl=clients.find(x=>x.id===t.client_id)
                        const asignadaPorMi = !isAssignee(t,me) && t.assigned_by===me
                        return (
                          <div key={t.id}
                            onClick={(e)=>{e.stopPropagation(); if(longPressFired.current){longPressFired.current=false;return} setPreview(t)}}
                            onMouseEnter={(e)=>{setHoverPos({x:e.clientX,y:e.clientY});setHoverTask(t)}}
                            onMouseLeave={()=>setHoverTask(null)}
                            onTouchStart={(e)=>startPress(t,e)} onTouchEnd={endPress} onTouchMove={endPress}
                            style={{background:asignadaPorMi?'#F0F9F5':'#fff',borderRadius:4,padding:'3px 5px',marginBottom:3,cursor:'pointer',borderLeft:`2px solid ${asignadaPorMi?'#1D9E75':C.accent}`,boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>
                            <div style={{fontSize:9,fontWeight:600,color:C.text,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',lineHeight:1.2,wordBreak:'break-word'}}>{t.title}</div>
                            {cl&&<div style={{fontSize:8,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cl.name}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div style={{display:'flex',gap:14,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:C.muted}}><span style={{width:9,height:9,borderRadius:2,background:'#fff',border:`2px solid ${C.accent}`,display:'inline-block',flexShrink:0}}/>Asignadas a mí</span>
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:10,color:C.muted}}><span style={{width:9,height:9,borderRadius:2,background:'#F0F9F5',border:'2px solid #1D9E75',display:'inline-block',flexShrink:0}}/>Que yo asigné</span>
        </div>
      </div>
      <div style={{padding:'24px 20px 100px'}}>
        <div style={{marginBottom:10}}><BloqueTitulo>Resumen financiero</BloqueTitulo></div>
        {(()=>{
          const saldo = saldoCajaChica(pettyCash, expenses, me)
          const misGastos = (expenses||[]).filter(e=>e.type==='gasto' && e.created_by===me)
          const porLiquidar = misGastos.filter(e=>!e.rendered_at)
          const totalPorLiquidar = porLiquidar.reduce((a,e)=>a+(e.amount||0),0)
          const ultimos = [...misGastos].sort((a,b)=>{
            const da=a.date||'', db=b.date||''
            if(da!==db) return da<db?1:-1
            return (b.created_at||'')<(a.created_at||'')?-1:1
          }).slice(0,3)
          const fmtCLP = fmtN
          const fmtFecha = iso => { if(!iso) return '—'; try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0') }catch(e){return iso} }
          const CAT_BG = {'Notaria':'#E3EEF3','CBR':'#F2E9DE','Diario Oficial':'#ECE6F5','Registro Civil':'#EDE3F5','Fondo':'#E4F1EA','Otro':'#ECECEC'}
          const GREEN={num:'#1D9E75',bg:'#F0F9F5',bd:'#D4EDE0',label:C.muted}
          const ORANGE={num:'#C77F18',bg:'#FEF6EE',bd:'#F5E2CC',label:'#C77F18'}
          const RED={num:'#E24B4A',bg:'#FDF1F1',bd:'#F2D5D5',label:C.muted}
          const saldoSch = saldo<0 ? RED : saldo<=50000 ? ORANGE : GREEN
          const sinLiqNoNotaria = porLiquidar.filter(e=>e.category!=='Notaria').length
          const liqSch = sinLiqNoNotaria>10 ? RED : ORANGE
          const KPI = ({sch,label,valor,sub}) => (
            <div style={{background:sch.bg,borderRadius:10,padding:'12px 14px',border:`1px solid ${sch.bd}`,borderLeft:`4px solid ${sch.num}`}}>
              <div style={{fontSize:10,fontWeight:600,color:sch.label,textTransform:'uppercase',letterSpacing:.5,marginBottom:5}}>{label}</div>
              <div style={{fontSize:22,fontWeight:700,color:sch.num,lineHeight:1.1}}>{valor}</div>
              <div style={{fontSize:10,color:C.muted,marginTop:3}}>{sub}</div>
            </div>
          )
          return (
            <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                <KPI sch={saldoSch} label='Saldo disponible' valor={`${saldo<0?'-':''}${fmtCLP(saldo)}`} sub='en tu caja'/>
                <KPI sch={liqSch} label='Por liquidar' valor={fmtCLP(totalPorLiquidar)} sub={`${porLiquidar.length} gasto${porLiquidar.length!==1?'s':''}`}/>
              </div>
              {ultimos.length>0&&(
                <>
                  <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:8,marginTop:4}}>Últimos gastos ingresados</div>
                  {ultimos.map(e=>{
                    const cl=clients.find(c=>c.id===e.client_id)
                    return (
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,background:C.card,borderRadius:8,padding:'8px 11px',marginBottom:5,border:`0.5px solid ${C.border}`}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                          <div style={{fontSize:10,color:C.muted,marginTop:2,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                            {cl&&<span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:130}}>{cl.name}</span>}
                            {e.category&&<span style={{padding:'1px 5px',borderRadius:3,background:CAT_BG[e.category]||CAT_BG['Otro'],color:'#537281',fontWeight:600,fontSize:9}}>{e.category}</span>}
                            <span>{fmtFecha(e.date)}</span>
                          </div>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:C.overdue,flexShrink:0}}>{fmtCLP(e.amount)}</div>
                      </div>
                    )
                  })}
                </>
              )}
            </>
          )
        })()}
      </div>
      {hoverTask&&(()=>{
        const cl=clients.find(c=>c.id===hoverTask.client_id)
        const left=Math.max(8,Math.min(hoverPos.x+12, (typeof window!=='undefined'?window.innerWidth:360)-238))
        const top=Math.max(8,Math.min(hoverPos.y+12, (typeof window!=='undefined'?window.innerHeight:640)-200))
        const Row=({l,v})=><div style={{display:'flex',gap:6,marginTop:3}}><span style={{fontSize:10,color:C.muted,minWidth:74,flexShrink:0,textTransform:'uppercase',letterSpacing:.3}}>{l}</span><span style={{fontSize:11,color:C.text,minWidth:0,wordBreak:'break-word'}}>{v}</span></div>
        return (
          <div style={{position:'fixed',left,top,zIndex:300,width:230,background:'#fff',border:'1px solid #E4E8EB',borderRadius:10,boxShadow:'0 8px 28px rgba(0,0,0,.14)',padding:'10px 12px',pointerEvents:'none'}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,lineHeight:1.25,marginBottom:6}}>{hoverTask.title}</div>
            {cl&&<Row l='Cliente' v={cl.name}/>}
            {hoverTask.project&&<Row l='Proyecto' v={hoverTask.project}/>}
            {hoverTask.subproject&&<Row l='Subproyecto' v={hoverTask.subproject}/>}
            <Row l='Responsable' v={taskAssignees(hoverTask).join(', ')||'—'}/>
            <Row l='Vence' v={hoverTask.due?fmtDate(hoverTask.due):'Sin fecha'}/>
            <Row l='Estado' v={hoverTask.status||'—'}/>
          </div>
        )
      })()}
      {preview&&(
        <Modal title='Detalle de tarea' onClose={()=>setPreview(null)}>
          <TaskPreview task={preview} clients={clients} onClose={()=>setPreview(null)}
            onEdit={t=>{setPreview(null);onEdit(t)}}
            onComplete={t=>{onComplete(t);setPreview(null)}}/>
        </Modal>
      )}
    </div>
  )
}
// ─── USERS VIEW (gestión de usuarios para admin) ───────────────────────────────
function UsersView({onClose}) {
  const [users,setUsers] = useState([])
  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)
  const [newEmail,setNewEmail] = useState('')
  const [newName,setNewName] = useState('')
  const [newRole,setNewRole] = useState('limited')

  useEffect(()=>{
    supabase.from('user_roles').select('*').order('name').then(({data})=>{ setUsers(data||[]); setLoading(false) })
  },[])

  const saveRole = async(id,role) => {
    await supabase.from('user_roles').update({role}).eq('id',id)
    setUsers(p=>p.map(u=>u.id===id?{...u,role}:u))
  }

  const addUser = async() => {
    if(!newEmail.trim()) return
    setSaving(true)
    const {data,error} = await supabase.from('user_roles').insert({email:newEmail.trim().toLowerCase(),name:newName.trim()||newEmail.split('@')[0],role:newRole}).select().single()
    if(!error) { setUsers(p=>[...p,data]); setNewEmail(''); setNewName('') }
    else alert('Error: '+error.message)
    setSaving(false)
  }

  const removeUser = async(id) => {
    if(!confirm('¿Eliminar este usuario?')) return
    await supabase.from('user_roles').delete().eq('id',id)
    setUsers(p=>p.filter(u=>u.id!==id))
  }

  return (
    <div>
      {loading?<div style={{textAlign:'center',padding:30}}><Spin/></div>:(
        <>
          <div style={{marginBottom:16}}>
            {users.map(u=>(
              <div key={u.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:C.text}}>{u.name}</div>
                  <div style={{fontSize:11,color:C.muted}}>{u.email}</div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <select value={u.role} onChange={e=>saveRole(u.id,e.target.value)} style={{padding:'5px 8px',borderRadius:6,border:`1px solid ${C.border}`,background:'#F7F7F7',color:C.text,fontSize:12}}>
                    <option value='admin'>Admin</option>
                    <option value='limited'>Limitado</option>
                  </select>
                  <button onClick={()=>removeUser(u.id)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:16}}>×</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{background:'#F7F7F7',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:10}}>Agregar usuario</div>
            <Fld label='Email (@leabogados.cl)'><Inp value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder='nombre@leabogados.cl'/></Fld>
            <Fld label='Nombre'><Inp value={newName} onChange={e=>setNewName(e.target.value)} placeholder='Nombre completo'/></Fld>
            <Fld label='Rol'>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[['admin','Admin (acceso completo)'],['limited','Limitado (solo tareas y gastos)']].map(([v,l])=>(
                  <button key={v} onClick={()=>setNewRole(v)} style={{padding:'8px',borderRadius:8,border:`2px solid ${newRole===v?C.accent:C.border}`,background:newRole===v?'#E6EEF1':'transparent',color:newRole===v?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{l}</button>
                ))}
              </div>
            </Fld>
            <button disabled={saving||!newEmail.trim()} onClick={addUser} style={{width:'100%',padding:11,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',marginTop:8,opacity:!newEmail.trim()?.6:1}}>
              {saving?'Guardando...':'Agregar usuario'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null)
  const [loadingAuth,setLoadingAuth]=useState(true)
  const [user,setUser]=useState(null)
  const [userRole,setUserRole]=useState(null)   // vista actual: 'admin' | 'limited' | null (admin puede previsualizar 'limited')
  const [actualRole,setActualRole]=useState(null) // rol REAL e inmutable de la DB — fuente de verdad para permisos
  const [clients,setClients]=useState([])
  const [sales,setSales]=useState([])
  const [billing,setBilling]=useState([])
  const [expenses,setExpenses]=useState([])
  const [tasks,setTasks]=useState([])
  const [anticipos,setAnticipos]=useState([])
  const [proveedores,setProveedores]=useState([])
  const [terceros,setTerceros]=useState([])   // terceros_pagos (cuentas por pagar)
  const [bulkImports,setBulkImports]=useState([])   // lotes de carga masiva (para deshacer)
  const [importAliases,setImportAliases]=useState([])   // memoria nombre-crudo → cliente (carga masiva aprende)
  const [pettyCash,setPettyCash]=useState([])
  const [rendiciones,setRendiciones]=useState([])
  const [expenseAttachments,setExpenseAttachments]=useState([])
  const [billingAttachments,setBillingAttachments]=useState([])
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [tab,setTab]=useState('dashboard')
  const [modal,setModal]=useState(null)
  const [menuOpen,setMenuOpen]=useState(false)
  useEffect(()=>{ const handler=()=>setMenuOpen(false); document.addEventListener('click',handler); return ()=>document.removeEventListener('click',handler) },[])
  const _hoyHdr = new Date()
  const fechaFull = _hoyHdr.toLocaleDateString('es-CL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).replace(/^\w/,c=>c.toUpperCase())
  const fechaShort = `${_hoyHdr.getDate()} ${MESES_ABR[_hoyHdr.getMonth()].toLowerCase()} ${_hoyHdr.getFullYear()}`
  const saleUploadRef = useRef(null)
  const saleDriveRef = useRef(null)

  const loadUserRole = async(email) => {
    const {data} = await supabase.from('user_roles').select('*').eq('email',email).maybeSingle()
    if(data) {
      setActualRole(data.role)
      setUserRole(data.role)
      if(data.role==='limited') setTab('tasks')
      return data
    }
    await supabase.from('user_roles').insert({email,role:'limited',name:email.split('@')[0]})
    setActualRole('limited')
    setUserRole('limited')
    setTab('tasks')
    return {role:'limited',name:email.split('@')[0]}
  }

  useEffect(()=>{
    getSession().then(({data:{session}})=>{
      setSession(session)
      if(session){ loadUserRole(session.user.email).then(u=>setUser({email:session.user.email,name:u?.name||session.user.email.split('@')[0]})) }
      setLoadingAuth(false)
    })
    const {data:{subscription}}=onAuthChange(async(_,session)=>{
      setSession(session)
      if(session){
        const u = await loadUserRole(session.user.email)
        setUser({email:session.user.email,name:u?.name||session.user.email.split('@')[0]})
        if(session.provider_token)saveDriveToken(session.provider_token)
      } else { setUser(null); setUserRole(null); setActualRole(null) }
    })
    return ()=>subscription.unsubscribe()
  },[])

  // Guard de navegación: en vista limited solo se permiten sus tabs; cualquier otro (dashboard/ventas/
  // facturación) redirige a Tareas. Cubre manipulación de estado/URL y la previsualización de admin.
  useEffect(()=>{
    if(userRole==='limited' && !TABS_LIMITED.some(t=>t.id===tab)) setTab('tasks')
  },[userRole,tab])

  const [clientEntities,setClientEntities] = useState([])

  useEffect(()=>{
    if(!session) return
    setLoading(true)
    Promise.all([
      supabase.from('petty_cash').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      supabase.from('rendiciones').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      getClients(),
      supabase.from('sales').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      getBilling(),
      supabase.from('expenses').select('*').order('date',{ascending:false}).then(({data})=>data||[]),
      supabase.from('tasks').select('*').order('due',{ascending:true,nullsFirst:false}).then(({data})=>data||[]),
      supabase.from('client_entities').select('*').then(({data})=>data||[]),
      supabase.from('expense_attachments').select('id,expense_id').then(({data})=>data||[]),
      supabase.from('billing_attachments').select('id,billing_id').then(({data})=>data||[]),
      supabase.from('anticipos').select('*').order('fecha',{ascending:false}).then(({data})=>data||[]),
      supabase.from('proveedores').select('*').order('nombre').then(({data})=>data||[]),
      supabase.from('terceros_pagos').select('*').order('created_at',{ascending:false}).then(({data})=>data||[]),
      supabase.from('bulk_imports').select('*').order('created_at',{ascending:false}).limit(10).then(({data})=>data||[]),
      supabase.from('import_aliases').select('*').then(({data})=>data||[]),
    ]).then(([pc,rd,c,s,b,e,t,ce,ea,ba,an,pv,tc,bi,ia])=>{setPettyCash(pc);setRendiciones(rd);setClients(c);setSales(s);setBilling(b);setExpenses(e);setTasks(t);setClientEntities(ce);setExpenseAttachments(ea);setBillingAttachments(ba);setAnticipos(an);setProveedores(pv);setTerceros(tc);setBulkImports(bi);setImportAliases(ia)})
      .catch(console.error).finally(()=>setLoading(false))
  },[session])

  const handleSaveSale=useCallback(async(f)=>{
    setSaving(true)
    try{
      const {cobros, cobroType, _actualizarPago, _activandoPropuesta, _propAmountUF, _propAmountCLP, ...saleData} = f
      const entIdRaw = saleData.entity_id || null
      const esCLP = (f.moneda||'UF')==='CLP'
      const p={...saleData,area:saleData.area||'Corporativo',entity_id:entIdRaw,moneda:f.moneda||'UF',amount_uf:esCLP?null:(parseFloat(f.amount_uf)||null),cost_uf:esCLP?null:(parseFloat(f.cost_uf)||null),uf_value:esCLP?null:(parseFloat(f.uf_value)||null),amount_clp:esCLP?(parseFloat(f.amount_clp)||null):(saleData.amount_clp||null),cost_clp:esCLP?(parseFloat(f.cost_clp)||null):null,updated_at:new Date().toISOString()}
      const{data,error}=await supabase.from('sales').upsert(p).select().single()
      if(error)throw error
      setSales(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      // Insertar cuotas (función reutilizable)
      const insertarCuotas = async() => {
        for(const c of cobros){
          await supabase.from('billing').insert({
            client_id:data.client_id,
            sale_id:data.id,
            entity_id:entIdRaw,
            concept:`${data.title} — ${c.label}`,
            amount:c.monto,
            status:'Programada',
            due:c.fecha,
            billing_type:'honorarios',
          })
        }
      }
      // A) Venta NUEVA: crear las cuotas directamente
      if(cobros&&cobros.length>0&&!f.id){
        await insertarCuotas()
      }
      // B) Venta EDITADA con "Actualizar forma de pago": regeneración segura
      if(f.id&&_actualizarPago&&cobros&&cobros.length>0){
        const {data:actuales} = await supabase.from('billing').select('id,invoice_no,status,amount').eq('sale_id',data.id)
        const programadas = (actuales||[]).filter(b=>b.status==='Programada'&&!b.invoice_no)
        const conservadas = (actuales||[]).filter(b=>!(b.status==='Programada'&&!b.invoice_no))
        const nNuevas = cobros.length
        const totalNuevas = cobros.reduce((a,c)=>a+(c.monto||0),0)
        const ok = confirm(
          `Actualizar forma de pago:\n\n`+
          `• Se CONSERVAN ${conservadas.length} cuota(s) ya emitidas/pagadas (no se tocan).\n`+
          `• Se REEMPLAZAN ${programadas.length} cuota(s) programadas por ${nNuevas} nueva(s) (total ${fmt(totalNuevas)}).\n\n`+
          `¿Continuar?`
        )
        if(ok){
          if(programadas.length>0){
            const {error:delErr} = await supabase.from('billing').delete().in('id', programadas.map(b=>b.id))
            if(delErr) throw new Error('No se pudieron eliminar las cuotas programadas anteriores (no se crearon las nuevas para evitar duplicados): '+delErr.message)
          }
          await insertarCuotas()
        }
      }
      // Propagar razón social a las cuotas Programadas de esta venta (crea o edita)
      if(entIdRaw){
        const ent = (clientEntities||[]).find(e=>e.id===entIdRaw)
        await supabase.from('billing').update({
          entity_id:entIdRaw,
          receptor_name:ent?.name||null,
          receptor_rut:ent?.rut||null,
        }).eq('sale_id',data.id).eq('status','Programada')
      }
      const {data:newBilling} = await getBilling()
      if(newBilling) setBilling(newBilling)
      // Reparto a colaboradores (terceros_pagos): comisión de tu honorario, NO toca monto_terceros.
      // Cada fila (proveedor + tipo % / UF / $ + valor) se REPARTE en todas las cuotas de la venta,
      // proporcional al monto de cada cuota. %/UF se calculan como fracción de la cuota real → reajustan con la UF.
      if(Array.isArray(f.repartoTerceros)){
        try{
          const cuotasVenta = (newBilling||[]).filter(b=>String(b.sale_id)===String(data.id)&&b.billing_type!=='reembolso')
            .sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
          const totalCuotas = cuotasVenta.reduce((a,b)=>a+(b.amount||0),0)
          const sUf = parseFloat(data.amount_uf)||0, sUfVal = parseFloat(data.uf_value)||0
          const esCLPventa = (data.moneda||'UF')==='CLP'
          const montoCuota = (row,cuota) => {
            const v = parseFloat(row.valor)||0
            const frac = totalCuotas>0 ? (cuota.amount||0)/totalCuotas : (cuotasVenta.length?1/cuotasVenta.length:0)
            if(row.tipo==='pct') return Math.round((cuota.amount||0)*v/100)
            if(row.tipo==='uf') return (!esCLPventa && sUf>0) ? Math.round((cuota.amount||0)*(v/sUf)) : Math.round(v*sUfVal*frac)
            return Math.round(v*frac)   // clp fijo, repartido proporcional
          }
          const previas = (terceros||[]).filter(t=>String(t.sale_id)===String(data.id))
          const pagadas = new Set(previas.filter(t=>t.estado==='pagado').map(t=>`${t.proveedor_id}|${t.billing_id}`))
          const borrar = previas.filter(t=>t.estado!=='pagado')   // recrea todo lo no pagado
          if(borrar.length) await supabase.from('terceros_pagos').delete().in('id', borrar.map(t=>t.id))
          const nuevos=[]
          for(const row of f.repartoTerceros){
            if(!row.proveedor_id || !((parseFloat(row.valor)||0)>0)) continue
            const prov = proveedores.find(p=>String(p.id)===String(row.proveedor_id))
            for(const cuota of cuotasVenta){
              if(pagadas.has(`${row.proveedor_id}|${cuota.id}`)) continue
              const m = montoCuota(row,cuota); if(m<=0) continue
              nuevos.push({sale_id:data.id, billing_id:cuota.id, proveedor_id:row.proveedor_id,
                proveedor: prov?(prov.razon_social||prov.nombre):null, rut:prov?.rut||null,
                tipo_costo:row.tipo||null, valor:parseFloat(row.valor)||null, monto:m,
                estado: cuota.status==='Pagado'?'por_pagar':'pendiente', created_by:user?.name||null})
            }
          }
          if(nuevos.length) await supabase.from('terceros_pagos').insert(nuevos)
          const {data:nt} = await supabase.from('terceros_pagos').select('*').order('created_at',{ascending:false})
          if(nt) setTerceros(nt)
        }catch(te){ alert('La venta se guardó, pero hubo un problema al guardar el reparto de terceros: '+te.message) }
      }
      // Al activar una propuesta: si el cliente era Prospecto, pasa a Activo automáticamente
      if(_activandoPropuesta && data.client_id) {
        const cliente = clients.find(c=>c.id===data.client_id)
        if(cliente?.status==='Prospecto') {
          await supabase.from('clients').update({status:'Activo',updated_at:new Date().toISOString()}).eq('id',cliente.id)
          setClients(p=>p.map(c=>c.id===cliente.id?{...c,status:'Activo'}:c))
        }
      }
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[clients,clientEntities,terceros,proveedores,user])

  const handleRechazarPropuesta=useCallback(async(s)=>{
    if(!confirm(`¿Marcar como rechazada la propuesta "${s.title}"?`)) return
    const {error}=await supabase.from('sales').update({status:'Rechazada',updated_at:new Date().toISOString()}).eq('id',s.id)
    if(error){alert('Error: '+error.message);return}
    setSales(p=>p.map(x=>x.id===s.id?{...x,status:'Rechazada'}:x))
  },[])

  const handleActivarPropuesta=useCallback((s)=>{
    setModal({type:'sale',data:{...s,_activandoPropuesta:true,_propAmountUF:s.amount_uf??null,_propAmountCLP:s.amount_clp??null}})
  },[])

  // Nuevo tramo de tarifa de una venta + recálculo de las programadas afectadas.
  // Se ESCALA cada cuota programada por la razón (nuevo honorario / honorario anterior). Eso respeta
  // la forma de pago (cuotas, %, personalizada, mensual conservan su distribución) y funciona igual
  // en UF y CLP: la razón no tiene unidades, así que no necesita Valor UF.
  const handleSaveTariff=useCallback(async(sale, t)=>{
    try{
      // Honorario anterior, en la misma moneda que el nuevo: última tarifa previa o el monto base de la venta.
      const {data:prevT} = await supabase.from('sale_tariff_history').select('honorario').eq('sale_id',sale.id).order('vigente_desde',{ascending:false}).limit(1)
      const oldHon = (prevT&&prevT.length)
        ? (parseFloat(prevT[0].honorario)||0)
        : (sale.moneda==='CLP' ? (parseFloat(sale.amount_clp)||0) : (parseFloat(sale.amount_uf)||0))
      const {data,error}=await supabase.from('sale_tariff_history').insert({sale_id:sale.id, honorario:t.honorario, costo:(t.costo??null), currency:t.currency, vigente_desde:t.vigente_desde, motivo:t.motivo||null, created_by:user?.name||null}).select().single()
      if(error)throw error
      // Recalcular SOLO programadas (no emitidas, no pagadas) con vencimiento >= vigente_desde
      const {data:prog} = await supabase.from('billing').select('id,amount').eq('sale_id',sale.id).eq('status','Programada').is('invoice_no',null).gte('due',t.vigente_desde)
      if(prog&&prog.length){
        const nuevoHon = parseFloat(t.honorario)||0
        if(oldHon>0){
          const scale = nuevoHon/oldHon
          let falloRecalc=0
          for(const b of prog){ const {error}=await supabase.from('billing').update({amount:Math.round((b.amount||0)*scale), updated_at:new Date().toISOString()}).eq('id',b.id); if(error) falloRecalc++ }
          if(falloRecalc>0) alert(`Atención: ${falloRecalc} de ${prog.length} cuota(s) programada(s) no se recalcularon. Revísalas.`)
          const {data:nb}=await getBilling(); if(nb) setBilling(nb)
        } else {
          alert('El tramo se guardó, pero no se pudo determinar el honorario anterior; las programadas no se recalcularon. Revísalas manualmente.')
        }
      }
      return data
    }catch(e){ alert('Error: '+e.message); return null }
  },[user])

  const handleCambiarFormato=useCallback(async(sale,{newFmt,newHon,newCosto,vigDate,motivo,nuevasCuotas})=>{
    try{
      const {data:rec,error}=await supabase.from('sale_tariff_history').insert({sale_id:sale.id,honorario:newHon||null,costo:newCosto||null,currency:sale.moneda||'UF',vigente_desde:vigDate,motivo:motivo||(`Cambio a cobro ${newFmt}`),created_by:user?.name||null}).select().single()
      if(error)throw error
      const {error:delFmtErr} = await supabase.from('billing').delete().eq('sale_id',sale.id).eq('status','Programada').is('invoice_no',null).gte('due',vigDate)
      if(delFmtErr) throw new Error('No se pudieron eliminar las cuotas programadas anteriores (no se crearon las nuevas para evitar duplicados): '+delFmtErr.message)
      for(const c of nuevasCuotas){
        const {error:insFmtErr} = await supabase.from('billing').insert({client_id:sale.client_id,sale_id:sale.id,entity_id:sale.entity_id||null,concept:c.concept,amount:c.amount,status:'Programada',due:c.due,billing_type:'honorarios'})
        if(insFmtErr) throw new Error('Error al crear una cuota nueva: '+insFmtErr.message)
      }
      const {data:nb}=await getBilling();if(nb)setBilling(nb)
      return rec
    }catch(e){alert('Error: '+e.message);return null}
  },[user])

  const handleDeleteSale=useCallback(async(id)=>{
    if(!confirm('Eliminar esta venta?')) return
    try{
      // Salvaguarda: avisar si hay facturas emitidas (con folio) asociadas
      const {data:cuotas} = await supabase.from('billing').select('id,invoice_no').eq('sale_id',id)
      const emitidas = (cuotas||[]).filter(b=>b.invoice_no)
      if(emitidas.length>0 && !confirm(`Esta venta tiene ${emitidas.length} factura(s) ya emitida(s). ¿Eliminar la venta y TODAS sus cuotas igual?`)) return
      // Borrar cuotas asociadas y la venta
      await supabase.from('billing').delete().eq('sale_id',id)
      await supabase.from('sales').delete().eq('id',id)
      setBilling(p=>p.filter(b=>b.sale_id!==id))
      setSales(p=>p.filter(x=>x.id!==id))
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleAssignRS=useCallback(async(clientId,entityId)=>{
    try{
      const{data,error}=await supabase.from('expenses').update({entity_id:entityId}).eq('client_id',clientId).is('entity_id',null).select()
      if(error)throw error
      const ids=new Set((data||[]).map(d=>d.id))
      setExpenses(p=>p.map(x=>ids.has(x.id)?{...x,entity_id:entityId}:x))
    }catch(e){alert('Error al asignar razón social: '+e.message)}
  },[])

  const handleSaveExpense=useCallback(async(f)=>{
    setSaving(true)
    try{
      const p={...f,amount:parseInt(f.amount)||0,sale_id:f.sale_id||null}
      // Atribución automática: registra quién ingresó el gasto (solo al crear, nunca al editar)
      if(f.type==='gasto' && !f.id && !p.created_by) p.created_by = user?.name || null
      const{data,error}=await supabase.from('expenses').upsert(p).select().single()
      if(error)throw error
      setExpenses(p=>f.id?p.map(x=>x.id===data.id?data:x):[data,...p])
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[user])

  // Carga masiva (PP-19 commit 4): dedupe vs existentes, registra el lote, inserta en tandas de 100.
  // Devuelve resumen. Cada gasto queda marcado con bulk_import_id para poder deshacer (commit 5).
  const handleBulkImport=useCallback(async(filas,{tipo,filename})=>{
    const keyOf = e => `${e.client_id||''}|${e.amount||0}|${e.date||''}|${(e.concept||'').trim().toLowerCase()}`
    const vistos = new Set((expenses||[]).map(keyOf))
    const batchId = crypto.randomUUID()
    let dupOmit=0, sinCliente=0, sinFecha=0
    const payloads=[]
    for(const r of filas){
      const row = {
        type:tipo, client_id:r.client_id||null, entity_id:r.entity_id||null,
        amount:r.monto||0, concept:r.concepto||'', notas:r.notas||null,
        category: tipo==='fondo'?'Fondo':(r.categoria||'Otro'),
        date:r.fecha||null, project:r.proyecto||null, sale_id:null,
        paid_by_client: tipo!=='fondo'&&r.categoria==='Notaria',
        created_by:user?.name||null, bulk_import_id:batchId,
      }
      const k = keyOf(row)
      if(vistos.has(k)){ dupOmit++; continue }
      vistos.add(k)
      if(!row.client_id) sinCliente++
      if(!row.date) sinFecha++
      payloads.push(row)
    }
    if(payloads.length===0) return {imported:0,dupOmit,sinCliente:0,sinFecha:0,batchId:null,filename}
    const {error:bErr} = await supabase.from('bulk_imports').insert({id:batchId,created_by:user?.name||null,row_count:payloads.length,filename:filename||null})
    if(bErr) throw bErr
    const inserted=[]
    for(let i=0;i<payloads.length;i+=100){
      const {data,error} = await supabase.from('expenses').insert(payloads.slice(i,i+100)).select()
      if(error) throw error
      if(data) inserted.push(...data)
    }
    setExpenses(p=>[...inserted,...p])
    setBulkImports(p=>[{id:batchId,created_at:new Date().toISOString(),created_by:user?.name||null,row_count:inserted.length,filename:filename||null,status:'active'},...p].slice(0,10))
    return {imported:inserted.length, dupOmit, sinCliente, sinFecha, batchId, filename}
  },[expenses,user])

  // Deshacer una carga masiva: elimina sus gastos y marca el lote como anulado.
  const handleUndoImport=useCallback(async(batchId)=>{
    try{
      const {error:dErr} = await supabase.from('expenses').delete().eq('bulk_import_id',batchId)
      if(dErr) throw dErr
      const {error:uErr} = await supabase.from('bulk_imports').update({status:'undone',undone_at:new Date().toISOString(),undone_by:user?.name||null}).eq('id',batchId)
      if(uErr) throw uErr
      setExpenses(p=>p.filter(e=>e.bulk_import_id!==batchId))
      setBulkImports(p=>p.map(b=>b.id===batchId?{...b,status:'undone',undone_at:new Date().toISOString(),undone_by:user?.name||null}:b))
      return true
    }catch(e){ alert('Error al deshacer: '+e.message); return false }
  },[user])

  // Memoria que aprende: guarda nombre-crudo → cliente. La próxima carga con ese nombre cae solo.
  const handleLearnAlias=useCallback(async(aliasNorm,clientId)=>{
    if(!aliasNorm||!clientId) return
    try{
      const {data,error}=await supabase.from('import_aliases').upsert({alias_norm:aliasNorm,client_id:clientId,created_by:user?.name||null},{onConflict:'alias_norm'}).select().single()
      if(error)throw error
      setImportAliases(p=>{ const rest=p.filter(a=>a.alias_norm!==aliasNorm); return [...rest,data] })
    }catch(e){ /* no bloquear la asignación si falla el aprendizaje */ console.error('learnAlias',e) }
  },[user])

  // Asignar (o cambiar) el cliente de un gasto ya guardado — para los huérfanos "Sin cliente".
  const handleAssignClientToExpense=useCallback(async(expenseId,clientId)=>{
    try{
      const {data,error} = await supabase.from('expenses').update({client_id:clientId}).eq('id',expenseId).select().single()
      if(error) throw error
      setExpenses(p=>p.map(e=>e.id===data.id?data:e))
    }catch(e){ alert('Error: '+e.message) }
  },[])

  const handleDeleteExpense=useCallback(async(id)=>{
    const exp=expenses.find(x=>x.id===id)
    const msg=exp?.client_rendered_at
      ?'Este gasto ya fue incluido en una rendición enviada al cliente.\nEliminarlo descuadra el historial y los saldos.\n\n¿Eliminar de todas formas?'
      :'¿Eliminar este registro?'
    if(!confirm(msg)) return
    const {error}=await supabase.from('expenses').delete().eq('id',id)
    if(error){ alert('No se pudo eliminar: '+error.message); return }
    // Si estaba en una rendición, ajustar su total y contador para no descuadrarla
    if(exp?.client_render_id){
      const r=(rendiciones||[]).find(x=>x.id===exp.client_render_id)
      if(r){
        const nuevoTotal=(r.total||0)-(exp.amount||0), nuevoN=Math.max(0,(r.n_gastos||0)-1)
        await supabase.from('rendiciones').update({total:nuevoTotal,n_gastos:nuevoN}).eq('id',r.id)
        setRendiciones(p=>p.map(x=>x.id===r.id?{...x,total:nuevoTotal,n_gastos:nuevoN}:x))
      }
    }
    setExpenses(p=>p.filter(x=>x.id!==id));setModal(null)
  },[expenses,rendiciones])

  const handleSaveTask=useCallback(async(f)=>{
    setSaving(true)
    try{
      // _isNew: marca "tarea nueva" aunque traiga id (caso borrador finalizado al adjuntar archivos)
      const {_isNew, ...rest} = f
      const esNueva = _isNew || !rest.id
      const taskPayload={...rest,sale_id:rest.sale_id||null,client_id:rest.client_id||null}
      // Sella la fecha de termino al completar; la limpia al reabrir. No sobreescribe si ya estaba.
      taskPayload.completed_at = taskPayload.status==='Terminado' ? (taskPayload.completed_at || new Date().toISOString()) : null
      if(esNueva && !taskPayload.assigned_by) taskPayload.assigned_by = user?.name || null
      const{data,error}=await supabase.from('tasks').upsert(taskPayload).select().single()
      if(error)throw error
      setTasks(p=>p.some(x=>x.id===data.id)?p.map(x=>x.id===data.id?data:x):[data,...p])
      // Alerta email solo en tarea NUEVA con quien asignado (incluye borrador finalizado)
      if(esNueva && data.who){
        const client=clients.find(c=>c.id===data.client_id)
        fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notify-task',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+supabase.supabaseKey},
          body:JSON.stringify({task:{...data,client_name:client?.name||''},assignedBy:user?.name||'el estudio'})
        }).catch(()=>{})
      }
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[user])

  // Delegar: el responsable traspasa la tarea a otra(s) persona(s) con un nuevo plazo.
  // NO cambia who/assignees (sigue siendo responsable ante quien la asignó); solo registra
  // delegated_to/by/due/at y avisa por correo a los delegados.
  const handleDelegateTask=useCallback(async(taskObj,{to,due})=>{
    setSaving(true)
    try{
      const patch={ delegated_to:to, delegated_by:user?.name||null, delegated_due:due||null, delegated_at:new Date().toISOString(), updated_at:new Date().toISOString() }
      const{data,error}=await supabase.from('tasks').update(patch).eq('id',taskObj.id).select().single()
      if(error)throw error
      setTasks(p=>p.map(x=>x.id===data.id?data:x))
      const client=clients.find(c=>c.id===data.client_id)
      fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/notify-task',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+supabase.supabaseKey},
        body:JSON.stringify({task:{...data,client_name:client?.name||'',who:(to||[]).join(', ')},assignedBy:user?.name||'el estudio'})
      }).catch(()=>{})
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[user,clients])

  const handleSaveClient=useCallback(async(f)=>{
    setSaving(true)
    try{
      const payload={...f,name:f.name.trim(),updated_at:new Date().toISOString()}
      if(payload.status!=='Terminado')payload.ended_at=null
      else if(!payload.ended_at)payload.ended_at=new Date().toISOString().slice(0,10)
      const saved=await upsertClient(payload)
      setClients(p=>{const next=f.id?p.map(x=>x.id===saved.id?saved:x):[...p,saved];return next.sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))})
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[])

  // Actualiza solo algunos campos del cliente (edición inline desde la ficha, sin abrir el modal)
  const handleUpdateClientFields=useCallback(async(id,patch)=>{
    const { data, error } = await supabase.from('clients').update({...patch,updated_at:new Date().toISOString()}).eq('id',id).select().single()
    if(error){ alert('Error al guardar: '+error.message); throw error }
    setClients(p=>{const next=p.map(x=>x.id===id?data:x);return next.sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))})
    return data
  },[])

  const handleDeleteClient=useCallback(async(id)=>{
    if(!confirm('Eliminar este cliente y todos sus datos?')) return
    try{
      // Salvaguarda: avisar si el cliente tiene facturas emitidas (con folio)
      const {data:cuotas} = await supabase.from('billing').select('id,invoice_no').eq('client_id',id)
      const emitidas = (cuotas||[]).filter(b=>b.invoice_no)
      if(emitidas.length>0 && !confirm(`Este cliente tiene ${emitidas.length} factura(s) ya emitida(s). ¿Eliminar el cliente y TODOS sus datos igual?`)) return
      // Borrar cuotas y ventas del cliente, luego el cliente
      await supabase.from('billing').delete().eq('client_id',id)
      await supabase.from('sales').delete().eq('client_id',id)
      await dbDeleteClient(id)
      setClients(p=>p.filter(x=>x.id!==id));setSales(p=>p.filter(s=>s.client_id!==id))
      setBilling(p=>p.filter(b=>b.client_id!==id));setExpenses(p=>p.filter(e=>e.client_id!==id))
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleSaveBilling=useCallback(async(f)=>{
    setSaving(true)
    try{
      // Limpiar campos virtuales que no van a la DB
      const {clients:_c, erasmo:_e, ...rest} = f
      const payload={...rest,amount:parseInt(f.amount)||0,updated_at:new Date().toISOString()}
      const saved=await upsertBilling(payload)
      setBilling(p=>{
        const wc={...saved,clients:clients.find(c=>c.id===saved.client_id)}
        return f.id?p.map(x=>x.id===saved.id?wc:x):[wc,...p]
      })
      // Aprendizaje universal: si la factura trae razón social, la guarda en el catálogo
      if(saved.client_id && (saved.receptor_name||saved.receptor_rut)){
        const yaExiste=(clientEntities||[]).some(e=>e.client_id===saved.client_id&&((e.rut&&e.rut===saved.receptor_rut)||(e.name?.toLowerCase()===saved.receptor_name?.toLowerCase())))
        if(!yaExiste){
          await supabase.from('client_entities').insert({client_id:saved.client_id,name:saved.receptor_name||null,rut:saved.receptor_rut||null})
          const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[])
          setClientEntities(ce)
        }
      }
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[clients,clientEntities])

  // Anticipos (PP-15): crear un anticipo disponible
  const handleSaveAnticipo=useCallback(async(f)=>{
    setSaving(true)
    try{
      const payload={client_id:f.client_id,monto:parseInt(f.monto)||0,fecha:f.fecha||new Date().toISOString().slice(0,10),nota:f.nota||null,proyecto:f.proyecto||null,sale_id:f.sale_id||null,estado:'disponible',created_by:user?.name||null}
      const {data,error}=await supabase.from('anticipos').insert(payload).select().single()
      if(error)throw error
      setAnticipos(p=>[data,...p])
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
    setSaving(false)
  },[user])

  // Anticipos (PP-15 commit 3): aplicar anticipos a una factura → consumidos + factura Pagada
  const handleConsumeAnticipos=useCallback(async(ids,billingId)=>{
    if(!ids?.length) return
    try{
      const { error } = await supabase.from('anticipos').update({estado:'consumido',billing_id:billingId}).in('id',ids)
      if(error)throw error
      setAnticipos(p=>p.map(a=>ids.includes(a.id)?{...a,estado:'consumido',billing_id:billingId}:a))
      const { data, error:be } = await supabase.from('billing').update({status:'Pagado',updated_at:new Date().toISOString()}).eq('id',billingId).select().single()
      if(be)throw be
      setBilling(p=>p.map(x=>x.id===data.id?{...data,clients:clients.find(c=>c.id===data.client_id)}:x))
    }catch(e){alert('Error: '+e.message)}
  },[clients])

  // Proveedores (PP terceros): crear/editar un proveedor del catálogo
  const handleSaveProveedor=useCallback(async(f)=>{
    setSaving(true)
    try{
      const payload={nombre:f.nombre?.trim()||null,razon_social:f.razon_social?.trim()||null,rut:f.rut?.trim()||null,datos_pago:f.datos_pago?.trim()||null}
      if(f.id){
        const {data,error}=await supabase.from('proveedores').update(payload).eq('id',f.id).select().single()
        if(error)throw error; setProveedores(p=>p.map(x=>x.id===data.id?data:x)); setSaving(false); return data
      }
      const {data,error}=await supabase.from('proveedores').insert(payload).select().single()
      if(error)throw error; setProveedores(p=>[...p,data].sort((a,b)=>(a.nombre||'').localeCompare(b.nombre||'','es'))); setSaving(false); return data
    }catch(e){alert('Error: '+e.message); setSaving(false); return null}
  },[])

  // Conciliación: al cobrar la factura ancla, las cuentas por pagar de esa factura pasan
  // de 'pendiente' (cliente no ha pagado) a 'por_pagar' (ya tienes el fee, falta transferir al colaborador).
  const handleConciliarTerceros=useCallback(async(billingId)=>{
    try{
      const ids=(terceros||[]).filter(t=>String(t.billing_id)===String(billingId)&&t.estado==='pendiente').map(t=>t.id)
      if(!ids.length) return
      const {error}=await supabase.from('terceros_pagos').update({estado:'por_pagar'}).in('id',ids)
      if(error)throw error
      setTerceros(p=>p.map(t=>ids.includes(t.id)?{...t,estado:'por_pagar'}:t))
    }catch(e){alert('La factura se marcó pagada, pero no se pudieron pasar los terceros a Por pagar: '+e.message)}
  },[terceros])

  // Pagar a un colaborador: la cuenta pasa a 'pagado' con fecha y referencia (transferencia manual).
  const handlePagarTercero=useCallback(async(terceroId,{pagado_at,referencia})=>{
    try{
      const {data,error}=await supabase.from('terceros_pagos').update({estado:'pagado',pagado_at:pagado_at||new Date().toISOString().slice(0,10),referencia:referencia||null}).eq('id',terceroId).select().single()
      if(error)throw error
      setTerceros(p=>p.map(t=>t.id===data.id?data:t))
      return data
    }catch(e){alert('Error: '+e.message); return null}
  },[])
  const handleDeleteBilling=useCallback(async(id)=>{
    if(!confirm('¿Eliminar este cobro?')) return
    try{
      await supabase.from('billing').delete().eq('id',id)
      setBilling(p=>p.filter(x=>x.id!==id))
      setModal(null)
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleToggleClientStatus=useCallback(async(client)=>{
    const nuevo = client.status==='Terminado' ? 'Activo' : 'Terminado'
    try{
      const {data,error} = await supabase.from('clients').update({status:nuevo,updated_at:new Date().toISOString()}).eq('id',client.id).select().single()
      if(error) throw error
      setClients(p=>p.map(x=>x.id===client.id?{...x,status:nuevo}:x))
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleAssignClient=useCallback(async(bill,clientId)=>{
    if(!clientId) return
    try{
      // 1. Asignar el cliente a la factura
      await supabase.from('billing').update({client_id:clientId,updated_at:new Date().toISOString()}).eq('id',bill.id)
      setBilling(p=>p.map(x=>x.id===bill.id?{...x,client_id:clientId}:x))
      // 2. Aprender el RUT/razón social ↔ cliente (para que próximas facturas se asocien solas)
      if(bill.receptor_rut||bill.receptor_name){
        const yaExiste=(clientEntities||[]).some(e=>e.client_id===clientId&&((e.rut&&e.rut===bill.receptor_rut)||(e.name?.toLowerCase()===bill.receptor_name?.toLowerCase())))
        if(!yaExiste){
          await supabase.from('client_entities').insert({client_id:clientId,name:bill.receptor_name||null,rut:bill.receptor_rut||null})
          const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[])
          setClientEntities(ce)
        }
      }
    }catch(e){alert('Error: '+e.message)}
  },[clientEntities])

  // Eliminar una o varias cuotas (usado por "Ya emitida"); el confirm lo hace el componente
  const handleDeleteBillingBulk=useCallback(async(ids)=>{
    const arr=Array.isArray(ids)?ids:[ids]
    if(arr.length===0) return
    try{
      await supabase.from('billing').delete().in('id',arr)
      setBilling(p=>p.filter(x=>!arr.includes(x.id)))
    }catch(e){alert('Error: '+e.message)}
  },[])

  const handleStatusChange=useCallback(async(id,status,paid_at)=>{
    const updates={status}
    if(paid_at!==undefined) updates.paid_at=paid_at
    await supabase.from('billing').update(updates).eq('id',id)
    setBilling(p=>p.map(x=>x.id===id?{...x,status,...(paid_at!==undefined?{paid_at}:{})}:x))
  },[])

  // "Ya emitida" (respaldo): convierte una programada en emitida (Pendiente) + asigna razón social
  const handleEmitirProgramada=useCallback(async(bill, entity)=>{
    try{
      const today=new Date().toISOString().slice(0,10)
      const patch={status:'Pendiente', issued_at:bill.issued_at||today, due:bill.due||dueFromIssued(today), updated_at:new Date().toISOString()}
      if(entity){ patch.entity_id=entity.id; patch.receptor_name=entity.name||null; patch.receptor_rut=entity.rut||null }
      await supabase.from('billing').update(patch).eq('id',bill.id)
      setBilling(p=>p.map(x=>x.id===bill.id?{...x,...patch}:x))
    }catch(e){alert('Error: '+e.message)}
  },[])

  // Dar de baja (anular) una factura: registra motivo, quién y cuándo. No se puede deshacer.
  const handleAnularFactura=useCallback(async(bill,motivo,obs)=>{
    try{
      const patch={status:'Anulada', motivo_baja:obs?.trim()?`${motivo} — ${obs.trim()}`:motivo, anulada_por:user?.name||user?.email||null, anulada_at:new Date().toISOString(), updated_at:new Date().toISOString()}
      const {error}=await supabase.from('billing').update(patch).eq('id',bill.id)
      if(error) throw error
      setBilling(p=>p.map(x=>x.id===bill.id?{...x,...patch}:x))
    }catch(e){alert('No se pudo dar de baja: '+e.message)}
  },[user])

  const handleRendicionComplete=useCallback(async(r)=>{
    setRendiciones(p=>[r,...p])
    if(!r.total||r.total<=0) return
    if(!confirm(`Rendición enviada.\n\n¿Crear cobro por reembolso de gastos ($${fmtN(r.total)})?`)) return
    const today=new Date().toISOString().slice(0,10)
    // Razón social del reembolso: la del gasto rendido; si no, la única RS del cliente
    const gEnt=expenses.find(e=>e.client_render_id===r.id&&e.entity_id)
    const entsCli=clientEntities.filter(x=>x.client_id===r.client_id)
    const ent=(gEnt&&clientEntities.find(x=>x.id===gEnt.entity_id))||(entsCli.length===1?entsCli[0]:null)
    const newBill={client_id:r.client_id,entity_id:ent?.id||null,receptor_name:ent?.name||null,receptor_rut:ent?.rut||null,billing_type:'reembolso',concept:`Reembolso gastos ${r.periodo||''}`.trim(),amount:r.total,status:'Pendiente',issued_at:today,due:dueFromIssued(today),notes:`Rendición ID ${r.id} · ${r.n_gastos||0} gasto(s)`}
    const {data,error}=await supabase.from('billing').insert(newBill).select().single()
    if(error){alert('No se pudo crear el cobro: '+error.message);return}
    setBilling(p=>[data,...p])
  },[])

  const overdueN=useMemo(()=>{
    return billing.filter(b=>b.status==='Vencido').length
  },[billing])

  if(loadingAuth) return <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center'}}><Spin/></div>
  if(!session) return <LoginScreen loading={loadingAuth}/>

  return (
    <>
      <link href={FONT} rel='stylesheet'/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        body{background:${C.bg};color:${C.text};font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}
        input,select,textarea{font-family:'DM Sans',sans-serif}
        input:focus,select:focus,textarea:focus{border-color:${C.accent}!important;box-shadow:0 0 0 3px rgba(0,60,80,.10)}
        ::-webkit-scrollbar{width:0;height:0}
        @keyframes spin{to{transform:rotate(360deg)}}
        @media(min-width:680px){
          .shell{max-width:600px;margin:0 auto;box-shadow:0 0 0 1px ${C.border},0 12px 50px rgba(0,0,0,.08);min-height:100vh}
          .fab{right:auto!important;left:50%!important;margin-left:228px}
        }
        .fecha-short{display:none}
        .qt-head{padding:18px 20px 14px}
        .qt-body{padding:16px 20px}
        @media(max-width:560px){
          .fecha-full{display:none} .fecha-short{display:inline}
          .qt-head{padding:13px 15px 10px}
          .qt-body{padding:11px 15px}
          .qt-body .fld{margin-bottom:10px!important}
        }
      `}</style>
      <div className='shell' style={{background:C.bg,minHeight:'100vh',position:'relative'}}>
        <div style={{padding:'52px 20px 14px',position:'sticky',top:0,background:C.bg,zIndex:20}}>
          <div style={{position:'relative'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div style={{fontSize:22,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,lineHeight:1.1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>¡Hola, <span style={{color:C.accent}}>{user?.name?.split(' ')[0]}</span>!</div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                <span className='fecha-full' style={{fontSize:12,fontWeight:500,color:C.accent,whiteSpace:'nowrap'}}>{fechaFull}</span>
                <span className='fecha-short' style={{fontSize:12,fontWeight:500,color:C.accent,whiteSpace:'nowrap'}}>{fechaShort}</span>
                <div style={{width:1,height:18,background:C.border,flexShrink:0}}/>
                <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o)}} style={{width:32,height:32,borderRadius:6,background:'none',border:`0.5px solid ${C.border}`,color:C.muted,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round'><line x1='4' y1='6' x2='20' y2='6'/><line x1='4' y1='12' x2='20' y2='12'/><line x1='4' y1='18' x2='20' y2='18'/></svg>
                </button>
              </div>
            </div>
            {menuOpen&&(
              <div style={{position:'absolute',top:40,right:0,width:210,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:10,padding:'4px 0',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,.1)'}}>
                {userRole==='admin'&&<div style={ddItem} onClick={()=>{setMenuOpen(false);setModal({type:'report'})}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><line x1='9' y1='13' x2='15' y2='13'/><line x1='9' y1='17' x2='13' y2='17'/></svg>
                  Generar reporte
                </div>}
                {userRole==='admin'&&<div style={ddItem} onClick={()=>{setMenuOpen(false);setModal({type:'users'})}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>
                  Gestión de usuarios
                </div>}
                {actualRole==='admin'&&(userRole==='admin'
                  ? <div style={ddItem} onClick={()=>{setMenuOpen(false);setUserRole('limited');setTab('tasks')}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>
                      Vista Team
                    </div>
                  : <div style={ddItem} onClick={()=>{setMenuOpen(false);setUserRole('admin');setTab('dashboard')}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>
                      Vista Admin
                    </div>
                )}
                {tab==='tasks'&&<div style={ddItem} onClick={()=>{setMenuOpen(false);printTasks(tasks.filter(t=>t.status==='Activo'&&enMiLista(t,user?.name)),clients,user?.name)}} onMouseEnter={e=>e.currentTarget.style.background='#F5F7F9'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><polyline points='6 9 6 2 18 2 18 9'/><path d='M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'/><rect x='6' y='14' width='12' height='8'/></svg>
                  Imprimir
                </div>}
                <div style={{height:'0.5px',background:'#E4E8EB',margin:'4px 0'}}/>
                <div style={{...ddItem,color:'#E24B4A'}} onClick={()=>{setMenuOpen(false);signOut()}} onMouseEnter={e=>e.currentTarget.style.background='#FEF2F2'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#E24B4A' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/><polyline points='16 17 21 12 16 7'/><line x1='21' y1='12' x2='9' y2='12'/></svg>
                  Cerrar sesión
                </div>
              </div>
            )}
          </div>
        </div>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'60vh'}}><Spin/></div>
        ):(
          <div style={{paddingBottom:80,overflowY:'auto'}}>
            {tab==='dashboard'&&userRole==='admin'&&<Dashboard sales={sales} billing={billing} clients={clients} clientEntities={clientEntities} expenses={expenses} tasks={tasks} pettyCash={pettyCash} terceros={terceros} proveedores={proveedores} onPagarTercero={handlePagarTercero} setTab={setTab} user={user} onEditTask={t=>setModal({type:'task',data:t})} onCompleteTask={t=>handleSaveTask({...t,status:'Terminado'})} onPreviewTask={t=>setModal({type:'taskPreview',data:t})}/>}
            {tab==='sales'&&userRole==='admin'&&<SalesView sales={sales} clients={clients} onEdit={s=>setModal({type:'sale',data:s})} onAdd={()=>setModal({type:'sale',data:null})} onAddPropuesta={()=>setModal({type:'sale',data:{status:'Propuesta'}})} onRechazar={handleRechazarPropuesta} onActivar={handleActivarPropuesta}/>}
            {tab==='billing'&&userRole==='admin'&&<BillingView billing={billing} clients={clients} sales={sales} clientEntities={clientEntities} anticipos={anticipos} terceros={terceros} onNuevoAnticipo={(preClient)=>setModal({type:'anticipo',data:preClient?{preClient}:null})} onProveedores={()=>setModal({type:'proveedores'})} onConciliarTerceros={handleConciliarTerceros} onAssignClient={handleAssignClient} onStatusChange={handleStatusChange} onDelete={handleDeleteBillingBulk} onAdd={()=>setModal({type:'billing',data:null})} onEdit={b=>setModal({type:'billing',data:b})} onImport={()=>setModal({type:'drive',data:null})} onUpload={()=>setModal({type:'pdfupload',data:null})} onEmitir={handleEmitirProgramada} onAnular={handleAnularFactura} onRefresh={async()=>{const {data:nb}=await getBilling();if(nb)setBilling(nb)}}/>}
            {tab==='tasks'&&<TasksOnlyView tasks={tasks} clients={clients} sales={sales} expenses={expenses} pettyCash={pettyCash} onAddTask={(preDue)=>setModal({type:'task',data:(typeof preDue==='string'&&preDue)?{preDue}:null})} onEdit={t=>setModal({type:'task',data:t})} onComplete={t=>handleSaveTask({...t,status:'Terminado'})} currentUserName={user?.name}/>}
            {tab==='expenses'&&<ExpensesView expenses={expenses} clients={clients} clientEntities={clientEntities} onAdd={(c)=>setModal({type:'gastos',data:c||null})} onEdit={e=>setModal({type:'expenseEdit',data:e})} onAddFondo={(c)=>setModal({type:'fondo',data:c||null})} onBulk={()=>setModal({type:'cargaMasiva',data:null})} onAssignRS={handleAssignRS} onAssignClientToExpense={handleAssignClientToExpense} setExpenses={setExpenses} setRendiciones={setRendiciones} rendiciones={rendiciones} currentUserName={user?.name} currentUser={user} expenseAttachments={expenseAttachments} setExpenseAttachments={setExpenseAttachments} onRendicionComplete={handleRendicionComplete}/>}
            {tab==='cajachica'&&<CajaChicaView expenses={expenses||[]} setExpenses={setExpenses} clients={clients||[]} currentUserName={user?.name} currentUserEmail={user?.email} pettyCash={pettyCash||[]} setPettyCash={setPettyCash||((v)=>{})} rendiciones={rendiciones||[]} setRendiciones={setRendiciones||((v)=>{})}/> }
            {tab==='clients'&&userRole==='limited'&&<ClientsViewLimited clients={clients} expenses={expenses} tasks={tasks} clientEntities={clientEntities} rendiciones={rendiciones} onEdit={c=>setModal({type:'client',data:c})} onAdd={()=>setModal({type:'clientLimited',data:null})} onAddTask={(c)=>setModal({type:'task',data:c?{preClient:c}:null})} onAddGasto={(c)=>setModal({type:'gastos',data:c})} onAddFondo={(c)=>setModal({type:'fondo',data:c})} onSaveFields={handleUpdateClientFields} onImportDrive={()=>setModal({type:'clienteDrive'})}/>}
            {tab==='clients'&&userRole==='admin'&&<ClientsView clients={clients} sales={sales} billing={billing} expenses={expenses} tasks={tasks} clientEntities={clientEntities} anticipos={anticipos} onNuevoAnticipo={(c)=>setModal({type:'anticipo',data:{preClient:c}})} onToggleStatus={handleToggleClientStatus} onEdit={c=>setModal({type:'client',data:c})} onAdd={()=>setModal({type:'client',data:null})} onAddTask={(c)=>setModal({type:'task',data:c?{preClient:c}:null})} onAddGasto={(c)=>setModal({type:'gastos',data:c})} onAddFondo={(c)=>setModal({type:'fondo',data:c})} onAddSale={(c)=>setModal({type:'sale',data:{client_id:c.id}})} onAddBilling={(c)=>setModal({type:'billing',data:{client_id:c.id}})} onImportDrive={()=>setModal({type:'clienteDrive'})} setExpenses={setExpenses} setRendiciones={setRendiciones} rendiciones={rendiciones} user={user} onSaveFields={handleUpdateClientFields} onRendicionComplete={handleRendicionComplete}/>}
          </div>
        )}
        {userRole==='limited'&&tab==='tasks'&&(
          <button className='fab' onClick={()=>setModal({type:'task',data:null})} aria-label='Nueva tarea' style={{position:'fixed',bottom:'calc(70px + env(safe-area-inset-bottom,0px))',right:16,width:52,height:52,borderRadius:'50%',background:C.accent,border:'none',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,boxShadow:'0 6px 18px rgba(0,60,80,.35)',cursor:'pointer'}}>
            <svg width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg>
          </button>
        )}
        <BottomNav tab={tab} setTab={setTab} overdueN={overdueN} userRole={userRole}/>

        {modal?.type==='sale'&&<Modal title={modal.data?._activandoPropuesta?'Activar propuesta':modal.data?.id?(modal.data?.status==='Propuesta'?'Editar propuesta':'Editar venta'):modal.data?.status==='Propuesta'?'Nueva propuesta':'Nueva venta'} onClose={()=>setModal(null)} closeOnBackdrop={false} titleRight={!modal.data?.id&&!modal.data?._activandoPropuesta?<div style={{display:'flex',gap:6}}><button type='button' onClick={()=>saleUploadRef.current?.()} style={{fontSize:11,fontWeight:600,color:C.muted,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>Subir archivo</button><button type='button' onClick={()=>saleDriveRef.current?.()} style={{fontSize:11,fontWeight:600,color:C.muted,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 8px',cursor:'pointer',whiteSpace:'nowrap',display:'flex',alignItems:'center',gap:5}}><DriveIcon size={13}/>Drive</button></div>:null}><SaleForm sale={modal.data?.id?modal.data:{...modal.data}} clients={clients} clientEntities={clientEntities} billing={billing} proveedores={proveedores} terceros={terceros} onSaveTariff={handleSaveTariff} onCambiarFormato={handleCambiarFormato} onSave={handleSaveSale} onClose={()=>setModal(null)} onDelete={handleDeleteSale} saving={saving} user={user} onExposeUpload={fn=>{ saleUploadRef.current=fn }} onExposeDrive={fn=>{ saleDriveRef.current=fn }}/></Modal>}
        {modal?.type==='billing'&&<Modal hideHeader onClose={()=>setModal(null)} closeOnBackdrop={false}><BillingForm bill={modal.data} clients={clients} clientEntities={clientEntities} anticipos={anticipos} onConsume={handleConsumeAnticipos} onSave={handleSaveBilling} onClose={()=>setModal(null)} onDelete={handleDeleteBilling} saving={saving} user={user} onAttachChange={(delta,item)=>setBillingAttachments(p=>delta>0?[...p,{id:item.id,billing_id:item.billing_id}]:p.filter(x=>x.id!==item.id))}/></Modal>}
        {modal?.type==='anticipo'&&<Modal hideHeader onClose={()=>setModal(null)} closeOnBackdrop={false}><AnticipoForm clients={clients} sales={sales} clientEntities={clientEntities} onSave={handleSaveAnticipo} onClose={()=>setModal(null)} saving={saving} preClient={modal.data?.preClient||null}/></Modal>}
        {modal?.type==='proveedores'&&<Modal hideHeader onClose={()=>setModal(null)} closeOnBackdrop={false}><ProveedoresModal proveedores={proveedores} terceros={terceros} billing={billing} clients={clients} onSave={handleSaveProveedor} onClose={()=>setModal(null)} saving={saving}/></Modal>}
        {modal?.type==='gastos'&&(
          <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
            <div style={{background:C.surface,borderRadius:16,width:'100%',maxWidth:520,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.18)',border:`1px solid ${C.border}`,padding:'18px 20px 24px',boxSizing:'border-box'}}>
              <GastosForm clients={clients} expenses={expenses} clientEntities={clientEntities} tasks={tasks} sales={sales} onSave={handleSaveExpense} onClose={()=>setModal(null)} preClient={modal.data||null}/>
            </div>
          </div>
        )}
        {modal?.type==='cargaMasiva'&&<Modal title='Carga masiva' onClose={()=>setModal(null)}><CargaMasivaModal clients={clients} clientEntities={clientEntities} onSave={handleSaveExpense} onBulkImport={handleBulkImport} bulkImports={bulkImports} onUndoImport={handleUndoImport} importAliases={importAliases} onLearnAlias={handleLearnAlias} onClose={()=>setModal(null)} onClientsUpdate={async()=>{const c=await getClients();setClients(c);const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[]);setClientEntities(ce)}}/></Modal>}
        {modal?.type==='clientLimited'&&<Modal title='Nuevo cliente' onClose={()=>setModal(null)} closeOnBackdrop={false}><NuevoClienteLimitedForm clients={clients} onSave={async(f)=>{setSaving(true);try{const{data,error}=await supabase.from('clients').insert({...f}).select().single();if(error)throw error;setClients(p=>[data,...p]);setModal(null)}catch(e){alert('Error al guardar: '+e.message)}setSaving(false)}} onClose={()=>setModal(null)} saving={saving}/></Modal>}
        {modal?.type==='fondo'&&<Modal hideHeader onClose={()=>setModal(null)} closeOnBackdrop={false}><FondoForm clients={clients} expenses={expenses} sales={sales} clientEntities={clientEntities} onSave={async(f)=>{await handleSaveExpense(f);setModal(null)}} onClose={()=>setModal(null)} saving={saving} preClient={modal.data||null}/></Modal>}
        {modal?.type==='expenseEdit'&&<Modal title='Editar registro' onClose={()=>setModal(null)} closeOnBackdrop={false}><ExpenseEditForm expense={modal.data} clients={clients} clientEntities={clientEntities} expenses={expenses} onSave={handleSaveExpense} onClose={()=>setModal(null)} onDelete={handleDeleteExpense} saving={saving} user={user} onAttachChange={(delta,item)=>setExpenseAttachments(p=>delta>0?[...p,{id:item.id,expense_id:item.expense_id}]:p.filter(x=>x.id!==item.id))}/></Modal>}
        {modal?.type==='clienteDrive'&&<Modal title='Importar clientes desde Drive' onClose={()=>setModal(null)}><ClienteDriveImporter clients={clients} onImported={async()=>{const c=await getClients();setClients(c);setModal(null)}} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='pdfupload'&&<Modal title='Subir facturas PDF' onClose={()=>setModal(null)}><PDFUploader clients={clients} billing={billing} clientEntities={clientEntities} onImported={async()=>{const {data:nb}=await getBilling();if(nb)setBilling(nb)}} onClose={()=>setModal(null)} onClientsUpdate={async()=>{const c=await getClients();setClients(c);const ce=await supabase.from('client_entities').select('*').then(({data})=>data||[]);setClientEntities(ce)}}/></Modal>}
        {modal?.type==='drive'&&<Modal title='Importar facturas desde Drive' onClose={()=>setModal(null)}><DriveImporter clients={clients} billing={billing} clientEntities={clientEntities} onImported={async()=>{const {data:nb}=await getBilling();if(nb)setBilling(nb)}} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='users'&&<Modal title='Gestión de usuarios' onClose={()=>setModal(null)}><UsersView onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='report'&&<Modal title='Generar reporte' onClose={()=>setModal(null)}><ReportBuilder sales={sales} billing={billing} clients={clients} expenses={expenses} tasks={tasks} onClose={()=>setModal(null)}/></Modal>}
        {modal?.type==='task'&&<Modal hideHeader onClose={()=>setModal(null)} closeOnBackdrop={false}><QuickTaskForm clients={clients} sales={sales} tasks={tasks} clientEntities={clientEntities} onSave={handleSaveTask} onDelegate={handleDelegateTask} onClose={()=>setModal(null)} saving={saving} preClient={modal.data?.preClient||null} preDue={modal.data?.preDue||null} user={user} task={modal.data?.id?modal.data:null}/></Modal>}
        {modal?.type==='taskPreview'&&<Modal title='Detalle de tarea' onClose={()=>setModal(null)}><TaskPreview task={modal.data} clients={clients} onClose={()=>setModal(null)} onEdit={t=>setModal({type:'task',data:t})} onComplete={t=>{handleSaveTask({...t,status:'Terminado'});setModal(null)}}/></Modal>}
        {modal?.type==='client'&&<Modal title={modal.data?.id?'Editar cliente':'Nuevo cliente'} onClose={()=>setModal(null)} closeOnBackdrop={false}><ClientForm client={modal.data} onSave={handleSaveClient} onClose={()=>setModal(null)} onDelete={handleDeleteClient} saving={saving} sales={sales}/></Modal>}
      </div>
    </>
  )
}
