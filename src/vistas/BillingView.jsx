// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { supabase, selectAll, connectDrive, upsertBilling, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { normRut as crNormRut } from '../cartola.js'
import { periodoDeTexto, candidatasProgramadas, unaSerie, serieYaFacturadaEnMes } from '../../supabase/functions/_shared/facturacionReglas.js'
import { trabajosSinFacturar, cuotasSinEmitir, recibidoACuenta } from '../../supabase/functions/_shared/ventasReglas.js'
import { BRAND, C, CUENTA_HONORARIOS, Gl, SEC_LBL, SIcon, _normTxt, appAlert, appConfirm, fmt, fmtFechaDMY, fmtN, fmtRutCL, folioN, personChip, useIsDesktop } from '../lib/base.jsx'
import { ADMIN_NAMES, ActBtn, AsignarClienteInline, AsignarVentaFactura, CORREO_DESPEDIDA, CUENTA_GASTOS_DEFAULT, Copyable, CubrirCuotasModal, DATOS_PAGO_HTML, DATOS_PAGO_TXT, DriveAuthError, ESTADO_COBRO, EstadoFacturaChip, FacturarBloqueModal, FlujoPagina, Inp, MESES, MESES_ABR, MESES_LG, MES_C, Modal, NOMBRE_CLI, PageHeader, Sparkle, TH_BAND, TIPOS_FACTURA, WHO_LIST, _correoToP, _respaldoCache, acusePagoEmail, aprenderRS, bigDate, catSinClienteVenta, chipBtn, claudeCall, cobradoBill, cuentaHtml, cuentaTxt, cuotasCubiertasVenta, currentMonth, currentYear, daysLeft, driveCarpetaFacturacion, driveToken, driveUpload, dteMontoTotal, dueFromIssued, enviarComoUsuario, esCorreoOficina, esPersona, esRecurrente, esSubarriendo, esVencidaB, estadoCobro, estadoFacturaLabel, fInp, facturaCorreoBody, facturaCorreoHtml, facturaCorreoShell, facturaDtePdfBase64, facturaGlosaPartes, facturaPdfAdjunto, facturaRespaldo, fetchUF, firmaDefault, fmtDate, fmtFechaHora, fmtMill, fmtShort, fmtUF, logActividad, logEvent, matchProgEmitidas, mejorVenta, modoEnvioLote, montoFactura, okDB, parseDteFactura, reconcileProgramada, recordatorioCobro, resolverClienteSII, restoreScroll, rolledDueMap, rsDeFactura, rsDisplay, rsLabel, saldoBill, saludoCli, setLearningKV, splitSetDTE, tipoFactura, tipoFacturaLbl, titleCase, txtEnviado, txtNoEnviado, txtResumenEnvio, ufFechaCache, useNoEmitirSet, usePersisted, usePersistedState, useUF, venceBill, ventaNombre, verFacturaPdf, viewMemGuardar, viewMemLeer, registrarError } from '../lib/compartido.jsx'

// Fuente única: estado de una fila del import → categoría corta (para conteos por archivo y batch). No duplicar este mapa.
export const CAT_IMPORT = {programada:'prog',nueva:'new',nota_credito:'nc',nc_hecha:'nc',adjuntada:'dup',duplicada:'dup',creada:'cre',registrada:'reg',sin_respaldo:'sinpdf',error:'err',sin_dte:'err',sin_factura:'err'}

export const catImport = e => CAT_IMPORT[e]||'otro'

export function RespaldoBadge({b, respaldoMap, cartolaHasta}){
  const r = facturaRespaldo(b, respaldoMap, cartolaHasta)
  if(!r) return null
  return <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:r.bg,color:r.fg,whiteSpace:'nowrap',display:'inline-block'}}>{r.label}</span>
}

// N° de cuota desde la glosa (las cuotas viven embebidas en el concepto, ej. "Título — Cuota 1/3"). Vacío si no aplica.
export function parseCuota(concept){
  if(!concept) return ''
  const m = concept.match(/cuota\s*(\d+)\s*\/\s*(\d+)/i); if(m) return `${m[1]}/${m[2]}`
  const m2 = concept.match(/cuota\s*(\d+)/i); if(m2) return m2[1]
  const m3 = concept.match(/(\d+)\s*\/\s*(\d+)/); if(m3) return `${m3[1]}/${m3[2]}`
  return ''
}

// Pill de filtro (segmentos tipo Todas/Proveedores/Anticipos): borde, acento al activo
export const filterPill = (active) => ({flex:'0 0 auto',padding:'6px 12px',borderRadius:20,border:`1px solid ${active?C.accent:C.border}`,background:active?C.azulBg:'transparent',color:active?C.accent:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'})

export function ChecklistFacturacion({sinRegN=0, billing, fantasmaIds=new Set(), clients, clientEntities=[], sales=[], anticipos=[], onFacturarAdelantos, onEmitir, onStatusChange, respaldoMap={}, cartolaHasta=null, onOpenClientFicha, onConciliar, onEdit, onEnviar, onEnviarVarias, onUnsend, onAssignSeries, onCotejar, onCargarXML, onReplaceProgramada}) {
  // Razón social a la que se emitió la factura — fuente única a nivel módulo (rsDeFactura).
  const rsDe = b => rsDeFactura(b, clientEntities)
  const abrirCli = (e,b) => { if(!onOpenClientFicha||!b.client_id) return; e.stopPropagation(); onOpenClientFicha(b.client_id) }
  const now = new Date()
  const [year,setYear] = useState(()=>viewMemLeer('checklist')?.year||String(now.getFullYear()))
  const [month,setMonth] = useState(()=>viewMemLeer('checklist')?.month||String(now.getMonth()+1).padStart(2,'0'))
  const [mesesEmitOpen,setMesesEmitOpen] = useState(()=>new Set())   // meses de "Emitidas" abiertos (colapsadas por defecto)
  const [aniosEmitOpen,setAniosEmitOpen] = useState(()=>new Set())   // años de "Emitidas" abiertos (colapsados por defecto)
  const [factOpen,setFactOpen] = useState(()=>new Set())             // facturas emitidas con acciones desplegadas
  const [emitExp,setEmitExp] = useState(()=>new Set())               // programadas con la comparación "ya emitida" desplegada
  const [checklistTab,setChecklistTab] = useState(()=>viewMemLeer('checklist')?.checklistTab??null)
  useEffect(()=>{ viewMemGuardar('checklist',{year,month,checklistTab}) },[year,month,checklistTab])              // acordeón: null | 'emitir' | 'enviar' | 'adelantos'
  const [adelSel,setAdelSel] = useState(()=>new Set())               // adelantos marcados (ids de anticipo) para facturar
  const [adelOpen,setAdelOpen] = useState(()=>new Set())             // clientes desplegados en el panel de adelantos
  const [enviadasOpen,setEnviadasOpen] = useState(false)             // pie "ya enviadas este mes" desplegado (auditar cargadas = por enviar + ya enviadas)
  const isDesktop = useIsDesktop()   // escritorio: Emitir y Enviar lado a lado (render aprobado 2026-10-08)
  const [qMes,setQMes] = useState('')                                // buscador: cliente, N°, RUT o concepto (filtra Emitir y Enviar)
  const [expEnviar,setExpEnviar] = useState(()=>new Set())           // filas de "Por enviar" con el detalle desplegado (Ver PDF, destinatario, glosa)
  const [factTo,setFactTo] = useState({})                            // client_id → destinatario recordado (learnings factura_to) para saber a quién irá
  const [busy,setBusy] = useState(null)
  const [desc,setDesc] = useState(false)
  const [emitSel,setEmitSel] = useState(()=>new Set())   // cuotas seleccionadas (ids) para facturar/descargar en lote
  const [emitBulk,setEmitBulk] = useState(false)         // emisión en lote en curso
  const toggleSel = id => setEmitSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const ufState = useUF()
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const EMIT = ['Pendiente','Vencido','Propuesta']
  // REGLA: una factura solo está EMITIDA si tiene folio/número (aparece en el SII). Sin folio NUNCA es emitida.
  const esEmitida = b => !!(b.invoice_no||b.folio)
  const mesKey = `${year}-${month}`

  // Corrimiento: una Programada de un mes ya pasado rueda al mes en curso (fuente única rolledDueMap). Puro, no muta.
  const refMonth = new Date().toISOString().slice(0,10).slice(0,7)
  const rollMap = useMemo(()=> rolledDueMap(billing, new Date().toISOString().slice(0,10)), [billing])
  const dueEff = b => rollMap.get(String(b.id)) || b.due   // vencimiento efectivo (rodado si aplica)
  const items = useMemo(()=> billing
    .filter(b=> { const d=rollMap.get(String(b.id))||b.due; return d && d.startsWith(mesKey) && (b.status==='Programada'||EMIT.includes(b.status)) })
    .sort((a,b)=>{ const da=rollMap.get(String(a.id))||a.due||'', db=rollMap.get(String(b.id))||b.due||''; return da>db?1:-1 })
  ,[billing,mesKey,rollMap])
  // FIFO SIN SALTOS: por cada venta, SOLO su cuota más antigua sin emitir (y las hermanas del MISMO devengo, p.ej. 2 tramos 50/50)
  // puede estar "por emitir". Las cuotas posteriores de la misma venta ESPERAN su turno: no se puede cobrar la cuota 4 si no se
  // ha emitido la 2 (si hay un hueco, es el hueco el que sale). Las cuotas sin venta (sale_id null) no tienen secuencia → pasan igual.
  const fifoAllowed = useMemo(()=>{
    const bySale={}
    billing.forEach(b=>{ if(b.deleted_at||esEmitida(b)||b.billing_type==='reembolso'||b.status==='Anulada'||!b.sale_id) return; if(fantasmaIds&&fantasmaIds.has(String(b.id))) return; (bySale[String(b.sale_id)]=bySale[String(b.sale_id)]||[]).push(b) })
    const allow=new Set()
    Object.values(bySale).forEach(arr=>{ arr.sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))); const first=arr[0].due; arr.forEach(b=>{ if(b.due===first) allow.add(String(b.id)) }) })
    return allow
  },[billing,fantasmaIds])
  // "A emitir" con criterio HONESTO: cada cuota con su VENCIMIENTO REAL (nunca rodado a este mes). Incluye el mes en curso
  // Y lo atrasado (devengo <= fin del mes). Sin FIFO: se muestran vigente + atrasadas del cliente para que NO se pare su facturación.
  const refStart = `${mesKey}-01`
  const refEnd = `${mesKey}-${String(new Date(Number(mesKey.slice(0,4)), Number(mesKey.slice(5,7)), 0).getDate()).padStart(2,'0')}`
  const dReal = b => String(b.due||b.issued_at||'').slice(0,10)
  const _qMes=_normTxt(qMes.trim()), _qMesD=qMes.replace(/[^0-9kK]/g,'').toLowerCase()
  const matchQ = b => !_qMes || _normTxt(clients.find(x=>x.id===b.client_id)?.name).includes(_qMes) || _normTxt(b.concept).includes(_qMes) || _normTxt(rsDe(b)).includes(_qMes) || (_qMesD.length>=3&&String(folioN(b.invoice_no)||'').includes(_qMesD)) || (_qMesD.length>=4&&String(b.receptor_rut||'').replace(/[^0-9kK]/g,'').toLowerCase().includes(_qMesD))
  // Misma regla que el radar «Cuotas vencidas sin facturar» (cuotasSinEmitir): lo atrasado es lo del radar (venta activa que ya
  // factura, dentro de la vida de la app, no cubierta por lo facturado, no marcada «No corresponde»); lo del mes, sin ventas
  // terminadas, ni marcadas «No corresponde», ni cubiertas. Antes contaba todo lo programado vencido (cuotas de 2025 y silenciadas).
  const noEmitirCk=useNoEmitirSet()
  const ckFuera=useMemo(()=>{ const cub=cuotasCubiertasVenta(billing,sales), st={}; (sales||[]).forEach(s=>{ if(!s.deleted_at) st[String(s.id)]=s.status })
    return b=>(b.sale_id&&st[String(b.sale_id)]&&st[String(b.sale_id)]!=='Activo')||(noEmitirCk&&noEmitirCk.has(String(b.id)))||!!cub.get(String(b.id))?.total },[billing,sales,noEmitirCk])
  const ckAtrasadas=useMemo(()=>new Set(cuotasSinEmitir({billing,sales,uf:ufFechaCache()||{},noEmitir:noEmitirCk||new Set(),hasta:refStart}).map(b=>String(b.id))),[billing,sales,noEmitirCk,refStart])
  const porEmitir = billing.filter(b=> matchQ(b) && !b.deleted_at && b.status==='Programada' && !esEmitida(b) && b.billing_type!=='reembolso' && b.billing_type!=='nota_credito' && !(fantasmaIds&&fantasmaIds.has(String(b.id))) && dReal(b) && dReal(b)<=refEnd
    && (dReal(b)>=refStart ? !ckFuera(b) : ckAtrasadas.has(String(b.id))))
  const yaEmitidasFantasma = billing.filter(b=> !b.deleted_at && b.status==='Programada' && fantasmaIds&&fantasmaIds.has(String(b.id)) && dReal(b) && dReal(b)<=refEnd)
  const esMesB = b => dReal(b)>=refStart   // devengo del mes en curso (el <=refEnd ya está garantizado por porEmitir)
  const mmmDe = ym => { const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; const p=String(ym||'').split('-'); return p.length>=2?`${M[+p[1]-1]} ${p[0].slice(2)}`:'' }
  // Fila de "Por emitir" (reusada por "Vienen de meses anteriores" y "De este mes"). moved=cuota rodada → muestra la traza.
  const filaEmitir = (b, kind='mes') => { const c=clients.find(x=>x.id===b.client_id); const rs=rsDe(b); const tw=onReplaceProgramada?emitidaTwin(b):null; const exp=emitExp.has(b.id); const col = kind==='atrasada'?C.overdueText:(kind==='espera'?C.tealText:C.text); const tag = kind==='atrasada'?{t:'atrasada',bg:C.overdueBg,fg:C.overdueText}:(kind==='espera'?{t:'en espera · anticipo',bg:C.tealBg,fg:C.tealText}:null); return (
    <div key={b.id} style={{borderBottom:`1px solid ${C.border}`,background:'#fff'}}>
      <div onClick={tw?()=>setEmitExp(s=>{ const n=new Set(s); n.has(b.id)?n.delete(b.id):n.add(b.id); return n }):(onEdit?()=>onEdit(b):undefined)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:(tw||onEdit)?'pointer':'default'}}>
        <input type='checkbox' checked={emitSel.has(b.id)} onClick={e=>e.stopPropagation()} onChange={()=>toggleSel(b.id)} style={{width:16,height:16,accentColor:C.accent,cursor:'pointer',flexShrink:0}} aria-label='Seleccionar cuota'/>
        {bigDate(b.due||b.issued_at)}
        <div style={{flex:1,minWidth:0}}>
          <div onClick={e=>abrirCli(e,b)} style={{fontSize:13,fontWeight:600,color:onOpenClientFicha&&b.client_id?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenClientFicha&&b.client_id?'pointer':'default'}}>{c?.name||'Sin cliente'}{rs&&rs!==c?.name?<span style={{fontWeight:400,color:C.muted}}> · {rsDisplay(rs)}</span>:''}{tag&&<span style={{fontSize:9.5,fontWeight:700,color:tag.fg,background:tag.bg,borderRadius:20,padding:'2px 8px',marginLeft:6,whiteSpace:'nowrap'}}>{tag.t}</span>}</div>
          <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||'(sin concepto)'}</div>
        </div>
        {tw&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>Ya emitida · N° {folioN(tw.invoice_no)||tw.invoice_no} {exp?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>}
        <div style={{fontSize:13,fontWeight:600,color:col,flexShrink:0,textAlign:'right'}}>{fmt(b.amount)}</div>
      </div>
      {tw&&exp&&(()=>{ const dif=Math.abs((tw.amount||0)-(b.amount||0)); return (
        <div style={{padding:'2px 12px 11px',background:C.bgSoft}}>
          <div style={{display:'flex',gap:12,padding:'4px 0 6px'}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:9,fontWeight:700,color:C.soon,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>Programada</div>
              <div style={{fontSize:12,fontWeight:600,color:C.text}}>{fmt(b.amount)}</div>
              <div style={{fontSize:11,color:C.muted}}>Devengo {b.due?fmtDate(b.due):'—'}</div>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>Emitida (en el SII)</div>
              <div style={{fontSize:12,fontWeight:600,color:C.text}}>Factura N° {folioN(tw.invoice_no)||tw.invoice_no} · {fmt(tw.amount)}</div>
              <div style={{fontSize:11,color:C.muted}}>{fmtDate(tw.issued_at||tw.due)} · mismo RUT/RS</div>
            </div>
          </div>
          <div style={{fontSize:11,color:dif>0?C.soonText:C.done,marginBottom:8}}>{dif>0?`Diferencia ${fmt(dif)} — variación de UF entre programación y emisión`:'Mismo monto'}</div>
          <button onClick={()=>{ setEmitExp(s=>{const n=new Set(s);n.delete(b.id);return n}); onReplaceProgramada(b.id,tw.id) }} style={{height:24,width:'100%',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:600,cursor:'pointer'}}>Conciliar · retirar la programada</button>
        </div>
      )})()}
    </div>
  )}
  // Anticipo disponible por cliente (saldo a favor) — para marcar en el grupo que tiene plata adentro (revisar antes de emitir a ciegas).
  const antByClient = useMemo(()=>{ const m={}; (anticipos||[]).forEach(a=>{ if(a.estado==='disponible'&&a.client_id) m[String(a.client_id)]=(m[String(a.client_id)]||0)+(a.monto||0) }); return m },[anticipos])
  // 3 grupos honestos: (1) A facturar este mes = clientes con algo de este mes (se muestran vigente + sus atrasadas, para no "parar"
  // su facturación). (2) Atrasadas = vencidas de clientes SIN nada este mes y SIN anticipo (plata NO entró → por cobrar).
  // (3) En espera = vencidas de clientes SIN nada este mes pero CON anticipo (plata YA recibida → solo falta emitir, o nunca).
  const antDe = b => antByClient[String(b.client_id)]||0
  const clientesConMes = new Set(porEmitir.filter(esMesB).map(b=>String(b.client_id)))
  const g1 = porEmitir.filter(b=> clientesConMes.has(String(b.client_id)))
  const g2 = porEmitir.filter(b=> !clientesConMes.has(String(b.client_id)) && !esMesB(b) && antDe(b)===0)
  const g3 = porEmitir.filter(b=> !clientesConMes.has(String(b.client_id)) && !esMesB(b) && antDe(b)>0)
  const totMes = porEmitir.filter(esMesB).reduce((a,b)=>a+(b.amount||0),0)
  const totAtr = porEmitir.filter(b=>!esMesB(b)&&antDe(b)===0).reduce((a,b)=>a+(b.amount||0),0)
  const totEsp = porEmitir.filter(b=>!esMesB(b)&&antDe(b)>0).reduce((a,b)=>a+(b.amount||0),0)
  const nMes = porEmitir.filter(esMesB).length
  const porEmitirTotal = totMes
  // Encabezado de grupo-cliente: nombre clickeable + badge anticipo + subtotal (omitido si una sola fila → cero cifras duplicadas).
  const gheadRow = (g, badge, sub) => (
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px 5px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
      <span onClick={()=>{ if(onOpenClientFicha&&g.cid) onOpenClientFicha(g.cid) }} style={{fontSize:12.5,fontWeight:700,color:onOpenClientFicha&&g.cid?C.accent:C.text,cursor:onOpenClientFicha&&g.cid?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}</span>
      {badge>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.tealText,background:C.tealBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>anticipo {fmt(badge)}</span>}
      {sub!=null&&<span style={{marginLeft:'auto',fontSize:12.5,fontWeight:700,color:C.accent,flexShrink:0}}>{fmt(sub)}</span>}
    </div>
  )
  const grupaCli = list => { const m=new Map(); list.forEach(b=>{ const k=b.client_id?String(b.client_id):('sin-'+b.id); if(!m.has(k)) m.set(k,{cid:b.client_id,name:(clients.find(c=>String(c.id)===String(b.client_id))?.name)||'Sin cliente',rows:[]}); m.get(k).rows.push(b) }); return [...m.values()] }
  // Sección 1: por cliente, vigente (de este mes) primero + atrasadas debajo (marcadas atrasada/en espera). Subtotal = solo vigente.
  const renderMes = list => grupaCli(list).map(g=>{ g.ant=antByClient[String(g.cid)]||0; g.vig=g.rows.filter(esMesB).sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))); g.atr=g.rows.filter(b=>!esMesB(b)).sort((a,b)=>String(b.due||'').localeCompare(String(a.due||''))); return g })
    .sort((a,b)=>a.name.localeCompare(b.name,'es'))
    .map(g=>(<div key={'m'+(g.cid||g.rows[0].id)}>{gheadRow(g,g.ant,g.vig.length>1?g.vig.reduce((a,b)=>a+(b.amount||0),0):null)}{g.vig.map(b=>filaEmitir(b,'mes'))}{g.atr.map(b=>filaEmitir(b, g.ant>0?'espera':'atrasada'))}</div>))
  // Secciones 2 y 3: por cliente (lo más nuevo arriba), filas nueva→vieja; subtotal = todas (omitido si una sola).
  const renderAtr = (list, kind) => grupaCli(list).map(g=>{ g.rows=g.rows.sort((a,b)=>String(b.due||'').localeCompare(String(a.due||''))); g.newest=g.rows[0]?.due||''; g.ant=antByClient[String(g.cid)]||0; return g })
    .sort((a,b)=> b.newest>a.newest?1:(b.newest<a.newest?-1:0))
    .map(g=>(<div key={kind+(g.cid||g.rows[0].id)}>{gheadRow(g,kind==='espera'?g.ant:0,g.rows.length>1?g.rows.reduce((a,b)=>a+(b.amount||0),0):null)}{g.rows.map(b=>filaEmitir(b,kind))}</div>))
  // Agrupa una lista de "por emitir" por CLIENTE. orden 'alfa' (de este mes) | 'reciente' (atrasadas: la más nueva arriba).
  const agrupaCli = (list, orden) => {
    const m=new Map()
    list.forEach(b=>{ const k=b.client_id?String(b.client_id):('sin-'+b.id); if(!m.has(k)) m.set(k,{cid:b.client_id, name:(clients.find(c=>String(c.id)===String(b.client_id))?.name)||'Sin cliente', rows:[]}); m.get(k).rows.push(b) })
    const arr=[...m.values()].map(g=>({...g, total:g.rows.reduce((a,b)=>a+(b.amount||0),0), newest:g.rows.reduce((mx,b)=>{const d=b.due||b.issued_at||'';return d>mx?d:mx},''), ant:antByClient[String(g.cid)]||0 }))
    arr.forEach(g=>g.rows.sort((a,b)=>String(dueEff(a)||a.due||'').localeCompare(String(dueEff(b)||b.due||''))))
    if(orden==='alfa') arr.sort((a,b)=>a.name.localeCompare(b.name,'es'))
    else arr.sort((a,b)=> b.newest>a.newest?1:(b.newest<a.newest?-1:0))
    return arr
  }
  // Render de un grupo-cliente: encabezado (nombre clickeable + nº + badge anticipo + subtotal) y debajo sus cuotas (filaEmitir).
  const renderGrupos = (list, orden) => agrupaCli(list,orden).map(g=>(
    <div key={'g'+(g.cid||g.rows[0].id)}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px 5px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>
        <span onClick={()=>{ if(onOpenClientFicha&&g.cid) onOpenClientFicha(g.cid) }} style={{fontSize:12.5,fontWeight:700,color:onOpenClientFicha&&g.cid?C.accent:C.text,cursor:onOpenClientFicha&&g.cid?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}</span>
        {g.rows.length>1&&<span style={{fontSize:10,color:C.muted,flexShrink:0}}>{g.rows.length} cuotas</span>}
        {g.ant>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.tealText,background:C.tealBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>anticipo {fmt(g.ant)}</span>}
        {g.rows.length>1&&<span style={{marginLeft:'auto',fontSize:12.5,fontWeight:700,color:C.accent,flexShrink:0}}>{fmt(g.total)}</span>}
      </div>
      {g.rows.map(filaEmitir)}
    </div>
  ))
  const cargadasXml = billing.filter(b=>!b.deleted_at && b.dte_xml && String(b.issued_at||'').startsWith(mesKey)).length   // respaldadas por XML este mes (trazabilidad de la carga)
  // Por enviar al cliente: emitidas con respaldo (XML/PDF) que aún no se envían por correo, del mes de emisión seleccionado.
  const porEnviar = billing.filter(b=> matchQ(b) && !b.deleted_at && esEmitida(b) && b.dte_xml && !b.email_sent_at && !b.sent_at && (b.status==='Pendiente'||b.status==='Vencido') && String(b.issued_at||'').startsWith(mesKey))   // misma regla que sinEnviar (impaga): una pagada ya no se manda 'para que paguen'
    .sort((a,b)=>String(b.issued_at||b.due||'').localeCompare(String(a.issued_at||a.due||'')))
  const porEnviarTotal = porEnviar.reduce((a,b)=>a+montoFactura(b),0)
  // Emitidas del mes SIN XML: no se pueden enviar (falta el archivo) pero NO deben quedar invisibles → se avisan con su folio.
  const emitidasSinXml = billing.filter(b=> !b.deleted_at && esEmitida(b) && !b.dte_xml && !b.email_sent_at && String(b.issued_at||'').startsWith(mesKey))
    .sort((a,b)=>String(b.issued_at||'').localeCompare(String(a.issued_at||'')))
  // Ya enviadas de las cargadas por XML este mes (con correo despachado) → explica por qué "Por enviar" < "Cargadas": las ya despachadas salen.
  const enviadasXmlMes = billing.filter(b=> !b.deleted_at && esEmitida(b) && b.dte_xml && b.email_sent_at && String(b.issued_at||'').startsWith(mesKey))
    .sort((a,b)=>String(b.email_sent_at||'').localeCompare(String(a.email_sent_at||'')))
  // Agrupa por cliente: unsent = por enviar; sent = ya enviadas ESTE MES del mismo cliente (para poder mandarlas juntas o deshacer el envío).
  // client_id null → cada una su grupo. Un cliente con 2+ facturas (contando las ya enviadas) muestra encabezado "Enviar juntas".
  const porEnviarGrupos = (()=>{ const m=new Map()
    porEnviar.forEach(b=>{ const k=b.client_id?String(b.client_id):('sin-'+b.id); if(!m.has(k)) m.set(k,{cid:b.client_id,unsent:[],sent:[]}); m.get(k).unsent.push(b) })
    enviadasXmlMes.forEach(b=>{ const k=b.client_id?String(b.client_id):null; if(k&&m.has(k)) m.get(k).sent.push(b) })   // adjunta las ya enviadas SOLO a clientes que tienen pendientes
    return [...m.values()] })()
  const enviadasEnGrupo = new Set(porEnviarGrupos.flatMap(g=>g.sent.map(b=>b.id)))   // las ya enviadas que se muestran dentro de un grupo → no repetir en el pie
  const enviadasSueltas = enviadasXmlMes.filter(b=>!enviadasEnGrupo.has(b.id))         // el pie audita solo las de clientes ya 100% enviados
  useEffect(()=>{ const ids=[...new Set(porEnviar.map(b=>b.client_id).filter(Boolean).map(String))]; if(!ids.length){ setFactTo({}); return } let alive=true
    supabase.from('learnings').select('key,value').eq('kind','factura_to').in('key',ids).order('updated_at',{ascending:true}).then(({data})=>{ if(!alive) return; const mm={}; (data||[]).forEach(r=>{ mm[String(r.key)]=String(r.value||'').trim() }); setFactTo(mm) },()=>{})
    return ()=>{alive=false} },[porEnviar.map(b=>b.id).join(',')])
  // Emitidas (con folio): archivo AGRUPADO POR AÑO → MES, todas, colapsado por defecto — no solo el mes seleccionado.
  // Emitidas: agrupar y ordenar por FECHA DE EMISIÓN (issued_at), no por vencimiento — así una factura emitida en julio
  // con vencimiento en agosto NO aparece bajo agosto. Orden nuevo→antiguo dentro de cada mes (regla de listas).
  const fecEmis = b => b.issued_at || b.due || ''
  const emitidasPorAnio = (()=>{
    const g={}
    billing.filter(b=>!b.deleted_at&&esEmitida(b)&&fecEmis(b)).forEach(b=>{ const d=fecEmis(b); const y=d.slice(0,4), mk=d.slice(0,7); (g[y]=g[y]||{}); (g[y][mk]=g[y][mk]||[]).push(b) })
    return Object.entries(g).sort((a,z)=>a[0]>z[0]?-1:1).map(([y,months])=>{ const flat=Object.values(months).flat(); return { y, months:Object.entries(months).sort((a,z)=>a[0]>z[0]?-1:1).map(([mk,fs])=>[mk, fs.slice().sort((a,b)=>(fecEmis(b)||'').localeCompare(fecEmis(a)||''))]), total:flat.reduce((a,b)=>a+montoFactura(b),0), n:flat.length } })
  })()

  // "Ya emitida" (programada cuyo gemelo emitido ya existe) — FUENTE ÚNICA compartida (matchProgEmitidas), misma que el
  // conteo de duplicados de Facturación y el panel Conciliar → los tres siempre coinciden.
  const _twins = useMemo(()=>{ const m=new Map(); matchProgEmitidas(billing,clients,clientEntities).forEach(x=>m.set(String(x.prog.id),x.real)); return m }, [billing,clients,clientEntities])
  const emitidaTwin = p => _twins.get(String(p.id))||null

  const toggle = async(b) => {
    setBusy(b.id)
    try{ if(esEmitida(b)) await onStatusChange(b.id,'Programada'); else await onEmitir(b) }
    catch(e){ appAlert('Error: '+(e.message||e)) }
    setBusy(null)
  }

  // RS + RUT para export/listas: reusa rsDeFactura (nombre) y cruza entidad/ficha + lo YA FACTURADO al cliente para el RUT
  // (la herramienta APRENDE de la historia). Ej.: Grupo Avanza no trae RS en la programada pero sí en su Factura 231.
  const rsRutExport = b => {
    const c = clients.find(x=>x.id===b.client_id)
    const ents = (clientEntities||[]).filter(e=>e.client_id===b.client_id)
    const entById = b.entity_id ? ents.find(e=>e.id===b.entity_id) : null
    let name = rsDeFactura(b, clientEntities) || ''
    let rut = [b.receptor_rut, entById&&entById.rut, ents.length===1&&ents[0].rut, ents.find(e=>e.rut&&String(e.rut).trim())?.rut, c&&c.rut].map(x=>(x||'').toString().trim()).find(Boolean) || ''
    if(!name || !rut){   // cruce a lo ya facturado al cliente (la factura emitida más reciente con receptor)
      const prev = (billing||[]).filter(x=>!x.deleted_at && x.client_id===b.client_id && x.invoice_no && (x.receptor_rut||x.receptor_name))
        .sort((a,d)=>String(d.issued_at||d.due||'').localeCompare(String(a.issued_at||a.due||'')))[0]
      if(prev){ if(!name) name=prev.receptor_name||''; if(!rut) rut=(prev.receptor_rut||'').toString().trim() }
    }
    if(!name) name = c?.name||''
    return { name: rsDisplay(name)||name||'', rut }
  }
  // Orden de export: alfabético por cliente (cada cliente con sus facturas juntas), luego por devengo.
  const byCliente = (a,b) => { const na=(clients.find(c=>c.id===a.client_id)?.name||'zzz').toLowerCase(), nb=(clients.find(c=>c.id===b.client_id)?.name||'zzz').toLowerCase(); return na.localeCompare(nb,'es') || String(a.due||'').localeCompare(String(b.due||'')) }
  const descargarExcel = async() => {
    // Arrastre: Programadas sin folio (no emitidas) con devengo ANTERIOR al mes seleccionado = lo que quedó sin facturar en meses previos.
    const atrasadas = billing
      .filter(b=> !b.deleted_at && !esEmitida(b) && b.billing_type!=='reembolso' && b.due && b.due < `${mesKey}-01` && (b.status==='Programada'||EMIT.includes(b.status)))
      .sort((a,b)=>(a.due||'')>(b.due||'')?1:-1)
    if(porEmitir.length===0 && atrasadas.length===0){ appAlert('No hay facturas por emitir ni arrastre de meses anteriores.'); return }
    setDesc(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const ufHoy = ufState.uf || null
      const ufNota = ufHoy!=null ? `Monto hoy ($) · UF ${Math.round(ufHoy).toLocaleString('es-CL')}` : 'Monto hoy ($)'
      const header=['Responsable','Cliente','Razón social','RUT','Concepto','Cuota','UF',ufNota,'Devengo de la cuota']
      // Fuente única de fila (misma que "↓ Programadas"): reusada por ambas hojas para que no divergan.
      const rowOf = b => {
        const c=clients.find(x=>x.id===b.client_id)
        const venta=(sales||[]).find(v=>v.id===b.sale_id)
        const resp=venta?.responsible||c?.abogado_responsable||''
        const esCLP=venta?.moneda==='CLP'
        const ufVal=venta?.uf_value||null
        const ufEq=(!esCLP&&ufVal)?(b.amount/ufVal):null
        const montoHoy=esCLP?(b.amount||0):((ufEq&&ufHoy)?Math.round(ufEq*ufHoy):null)
        // N° de cuota / total: posición de esta cuota entre las de su venta (por devengo). Vacío si la venta tiene una sola.
        const cuotasSale = b.sale_id ? billing.filter(x=>!x.deleted_at && x.sale_id===b.sale_id && x.billing_type!=='reembolso' && x.status!=='Anulada').sort((x,y)=>String(x.due||x.issued_at||'').localeCompare(String(y.due||y.issued_at||''))) : []
        const cidx = cuotasSale.findIndex(x=>String(x.id)===String(b.id))
        const cuotaLbl = (cuotasSale.length>1 && cidx>=0) ? `${cidx+1}/${cuotasSale.length}` : ''
        const {name:rsName, rut:rsRut} = rsRutExport(b)
        return [resp, c?.name||'Sin cliente', rsName, rsRut, b.concept||'', cuotaLbl, esCLP?'—':(ufEq?Number(ufEq.toFixed(2)):''), montoHoy??'', b.due||'']
      }
      const cols=[{wch:16},{wch:26},{wch:30},{wch:14},{wch:34},{wch:8},{wch:10},{wch:20},{wch:16}]
      // Hoja formateada: ordenada por cliente, header congelado, filtro, y números con miles/decimales (legible al abrir).
      const fmtSheet = arr => { const rows=[...arr].sort(byCliente).map(rowOf); const ws=XLSX.utils.aoa_to_sheet([header,...rows]); ws['!cols']=cols; ws['!autofilter']={ref:`A1:I${rows.length+1}`}; ws['!views']=[{state:'frozen',ySplit:1}]; const rng=XLSX.utils.decode_range(ws['!ref']); for(let r=1;r<=rng.e.r;r++){ const u=ws[XLSX.utils.encode_cell({r,c:6})]; if(u&&u.t==='n')u.z='0.00'; const m=ws[XLSX.utils.encode_cell({r,c:7})]; if(m&&m.t==='n')m.z='#,##0' } return ws }
      const wb=XLSX.utils.book_new()
      const vigentes = porEmitir.filter(esMesB)   // hoja "Facturar" = solo lo de este mes; lo atrasado va en la 2ª hoja
      if(vigentes.length) XLSX.utils.book_append_sheet(wb,fmtSheet(vigentes),'Facturar')
      if(atrasadas.length) XLSX.utils.book_append_sheet(wb,fmtSheet(atrasadas),'No facturadas (meses ant.)')
      XLSX.writeFile(wb,`Facturar_${mesKey}.xlsx`)
    }catch(e){ appAlert('Error al generar Excel: '+e.message) }
    setDesc(false)
  }

  // Facturar en lote: emite (marca emitida) las cuotas seleccionadas, con confirmación. Reversible (desmarcar una a una).
  const facturarSel = async() => {
    const sel = porEmitir.filter(b=>emitSel.has(b.id)); if(!sel.length) return
    const tot = sel.reduce((a,b)=>a+(b.amount||0),0)
    const ok = await appConfirm(`Vas a FACTURAR ${sel.length} cuota${sel.length!==1?'s':''} (${fmt(tot)}). Se marcan como emitidas. ¿Continuar?`); if(!ok) return
    setEmitBulk(true)
    try{ for(const b of sel){ try{ await onEmitir(b) }catch(_){} } setEmitSel(new Set()) } finally{ setEmitBulk(false) }
  }
  // Descargar en lote: Excel solo con las cuotas seleccionadas (columnas base).
  const descargarSel = async() => {
    const sel = porEmitir.filter(b=>emitSel.has(b.id)); if(!sel.length) return
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const ufHoy = ufState.uf || null
      const ufNota = ufHoy!=null ? `Monto hoy ($) · UF ${Math.round(ufHoy).toLocaleString('es-CL')}` : 'Monto hoy ($)'
      const header=['Cliente','Razón social','RUT','Concepto','UF (original)',ufNota,'Devengo']
      const rowOf = b => {
        const c=clients.find(x=>x.id===b.client_id)
        const venta=(sales||[]).find(v=>v.id===b.sale_id)
        const esCLP=venta?.moneda==='CLP'; const ufVal=venta?.uf_value||null
        const ufEq=(!esCLP&&ufVal)?(b.amount/ufVal):null                                   // UF original de la cuota (congelada al crearla)
        const montoHoy=esCLP?(b.amount||0):((ufEq&&ufHoy)?Math.round(ufEq*ufHoy):null)       // conversión a la UF de hoy
        const {name:rsName, rut:rsRut} = rsRutExport(b)
        return [c?.name||'Sin cliente', rsName, rsRut, b.concept||'', esCLP?'—':(ufEq?Number(ufEq.toFixed(2)):''), montoHoy??'', b.due||'']
      }
      const rows=[...sel].sort(byCliente).map(rowOf)   // alfabético por cliente, facturas juntas
      const ws=XLSX.utils.aoa_to_sheet([header,...rows]); ws['!cols']=[{wch:26},{wch:30},{wch:14},{wch:38},{wch:12},{wch:20},{wch:14}]
      ws['!autofilter']={ref:`A1:G${rows.length+1}`}; ws['!views']=[{state:'frozen',ySplit:1}]
      { const rng=XLSX.utils.decode_range(ws['!ref']); for(let r=1;r<=rng.e.r;r++){ const u=ws[XLSX.utils.encode_cell({r,c:4})]; if(u&&u.t==='n')u.z='0.00'; const m=ws[XLSX.utils.encode_cell({r,c:5})]; if(m&&m.t==='n')m.z='#,##0' } }
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Seleccionadas'); XLSX.writeFile(wb,`Facturar_seleccionadas_${mesKey}.xlsx`)
    }catch(e){ appAlert('Error al generar Excel: '+e.message) }
  }
  const years=[...new Set(billing.map(b=>b.due?.slice(0,4)).filter(Boolean))]
  if(!years.includes(String(now.getFullYear()))) years.push(String(now.getFullYear()))
  years.sort((a,b)=>b-a)
  const selStyle = {padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:12,outline:'none'}

  const toggleExp = id => setExpEnviar(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  // Fila de una factura en "Por enviar" — tappable para desplegar detalle (Ver PDF, destinatario, glosa). sent=ya enviada (chip + deshacer).
  const filaFactura = (b, {compact=false, sent=false}={}) => {
    const c=clients.find(x=>x.id===b.client_id); const rs=rsDe(b); const open=expEnviar.has(b.id); const dest=factTo[String(b.client_id)]||''
    return (
      <div key={b.id} style={{background: sent?C.bgSoft:'#fff', borderTop: compact?`1px solid ${C.border}`:undefined}}>
        <div onClick={()=>toggleExp(b.id)} style={{display:'flex',gap:11,alignItems:'center',padding: compact?'9px 12px 9px 14px':'10px 12px',cursor:'pointer'}}>
          {bigDate(b.issued_at||b.due,C.accent)}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
              <span style={{fontSize:compact?12.5:13,fontWeight:600,color:C.text}}>Factura N° {folioN(b.invoice_no)||b.folio||'—'}</span>
              {sent&&<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Enviada {String(b.email_sent_at||'').slice(0,10).split('-').reverse().slice(0,2).join('-')}</span>}
            </div>
            <div onClick={e=>abrirCli(e,b)} style={{fontSize:compact?10.5:11,color:onOpenClientFicha&&b.client_id?C.accent:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenClientFicha&&b.client_id?'pointer':'default'}}>{compact?'':`${c?.name||'Sin cliente'} · `}{rs?rsDisplay(rs):(c?.name||'')}{(rs&&rs.rut)||b.receptor_rut?` · ${(rs&&rs.rut)||b.receptor_rut}`:''}</div>
          </div>
          <div style={{textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
            <div style={{fontSize:compact?12.5:13,fontWeight:600,color:C.text}}>{fmt(montoFactura(b))}</div>
            <div style={{display:'flex',gap:6}}>{b.dte_xml&&<button onClick={e=>{e.stopPropagation();verFacturaPdf(b)}} title='Descargar el PDF con timbre' style={{background:'#fff',color:C.accent,border:`1px solid ${C.border}`,borderRadius:8,padding: compact?'3px 9px':'5px 10px',fontSize: compact?10.5:11.5,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>PDF</button>}{onEnviar&&<button onClick={e=>{e.stopPropagation(); onEnviar(b)}} style={{background: sent?'#fff':C.accent,color: sent?C.accent:'#fff',border: sent?`1px solid ${C.accent}`:'none',borderRadius:8,padding: compact?'3px 11px':'5px 12px',fontSize: compact?10.5:11.5,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{sent?'Reenviar':'Enviar'}</button>}</div>
          </div>
          <span style={{fontSize:12,color:C.muted,flexShrink:0}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
        </div>
        {open&&(()=>{
          const dte = b.dte_xml?parseDteFactura(b.dte_xml):null
          const items = (dte&&dte.items&&dte.items.length)?dte.items:[{dsc:b.concept||'',nmb:'',mnt:montoFactura(b)}]
          const tot = dte?dte.total:montoFactura(b)
          const recRs = dte?.rznR || (rs?rsDisplay(rs):'') || b.receptor_name || (c?.name||'')
          const recRut = dte?.rutR || (rs&&rs.rut) || b.receptor_rut || ''
          const row = (l,v) => <div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11}}><span style={{color:C.muted}}>{l}</span><span style={{color:C.text,textAlign:'right',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span></div>
          return (
          <div style={{padding: compact?'0 12px 11px 14px':'0 12px 11px', display:'flex',flexDirection:'column',gap:9}}>
            {/* Ficha inline de la factura (datos del DTE = del SII). El PDF real con timbre va en "Ver PDF con timbre". */}
            <div style={{border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
              <div style={{background:C.accent,padding:'8px 11px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{color:'#fff',fontSize:11,fontWeight:600}}>Factura electrónica exenta</span>
                <span style={{color:C.onNavyLabel,fontSize:11}}>N° {folioN(b.invoice_no)||b.folio||'—'}</span>
              </div>
              <div style={{padding:'9px 11px',display:'flex',flexDirection:'column',gap:6,background:'#fff'}}>
                {row('Emisor', `${dte?.rznE||BRAND.nombre}${dte?.rutE?` · ${dte.rutE}`:''}`)}
                {row('Receptor', `${recRs||'—'}${recRut?` · ${recRut}`:''}`)}
                {row('Emisión', fmtFechaDMY(b.issued_at||b.due))}
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:7}}>
                  <div style={{...SEC_LBL,marginBottom:4}}>Detalle</div>
                  {items.map((it,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,color:C.text,marginBottom:i<items.length-1?3:0}}><span style={{flex:1,minWidth:0}}>{it.dsc||it.nmb||'Servicios prestados'}</span><span style={{fontWeight:600,whiteSpace:'nowrap'}}>{fmt(it.mnt)}</span></div>)}
                </div>
                <div style={{display:'flex',justifyContent:'space-between',borderTop:`1px solid ${C.border}`,paddingTop:7}}><span style={{fontSize:12,fontWeight:600,color:C.accent}}>Total exento</span><span style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmt(tot)}</span></div>
              </div>
            </div>
            <div style={{fontSize:10,color:C.muted}}>Se enviará a {dest?<b style={{color:C.accent}}>{dest}</b>:<span style={{color:C.soonText}}>Lo eliges al enviar</span>}{sent?<span style={{color:C.greenText}}> · enviado el {fmtFechaDMY(b.email_sent_at)}</span>:''}</div>
            {/* Venta asociada (para el registro): muestra la vinculada o un selector para vincularla en el flujo. */}
            <div style={{fontSize:10,color:C.muted,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>Venta:{(()=>{ const linked=(sales||[]).find(s=>String(s.id)===String(b.client_id?b.sale_id:null)); if(linked&&ventaNombre(linked)) return <b style={{color:C.text}}>{ventaNombre(linked)}</b>; const cs=(sales||[]).filter(s=>String(s.client_id)===String(b.client_id)&&ventaNombre(s)); if(!onAssignSeries||!cs.length) return <span style={{color:C.soonText}}>Sin venta asociada{cs.length?'':' · el cliente no tiene ventas'}</span>; return <select defaultValue='' onChange={e=>{ if(e.target.value) onAssignSeries(e.target.value,[b.id]) }} style={{fontSize:11,padding:'3px 7px',borderRadius:8,border:`1px solid ${C.soon}`,background:'#fff',color:C.text}}><option value=''>Vincular a venta…</option>{cs.map(s=><option key={s.id} value={s.id}>{ventaNombre(s)}{s.year?` · ${s.year}`:''}</option>)}</select> })()}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              <ActBtn variant='ghost' onClick={()=>verFacturaPdf(b)}>Ver PDF con timbre</ActBtn>
              {onOpenClientFicha&&b.client_id&&<ActBtn variant='ghost' onClick={()=>onOpenClientFicha(b.client_id)}>Ver ficha</ActBtn>}
              {onEdit&&<ActBtn variant='ghost' onClick={()=>onEdit(b)}>Editar</ActBtn>}
              {sent&&onUnsend&&<button onClick={()=>onUnsend(b)} style={{fontSize:11,fontWeight:600,color:C.soonText,background:'#fff',border:`1px solid ${C.soon}`,borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Marcar no enviada</button>}
            </div>
          </div>
        )})()}
      </div>
    )
  }

  // Adelantos por facturar: anticipos aún sin facturar (sin billing_id, monto>0), agrupados por cliente y ordenados por monto.
  const adelFact = (anticipos||[]).filter(a=>!a.billing_id&&(a.monto||0)>0)
  const adelClientes = (()=>{ const m=new Map()
    adelFact.forEach(a=>{ const c=(clients||[]).find(x=>String(x.id)===String(a.client_id))||(clients||[]).find(x=>String(x.id)===String((sales||[]).find(s=>String(s.id)===String(a.sale_id))?.client_id)); const k=c?String(c.id):('sin-'+a.id); if(!m.has(k)) m.set(k,{key:k,name:c?.name||'Sin cliente',cid:c?.id||null,items:[]}); m.get(k).items.push(a) })
    return [...m.values()].map(g=>({...g,total:g.items.reduce((s,a)=>s+(a.monto||0),0)})).sort((a,b)=>b.total-a.total)
  })()
  const adelSelItems = adelFact.filter(a=>adelSel.has(a.id))
  const adelSelTotal = adelSelItems.reduce((s,a)=>s+(a.monto||0),0)
  const toggleAdel = id => setAdelSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAdelCliente = g => setAdelSel(p=>{ const n=new Set(p); const all=g.items.every(a=>n.has(a.id)); g.items.forEach(a=>all?n.delete(a.id):n.add(a.id)); return n })
  const toggleAdelOpen = k => setAdelOpen(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
  const confirmarAdel = async () => { if(!adelSelItems.length) return; await onFacturarAdelantos?.([...adelSel]); setAdelSel(new Set()); setChecklistTab(null) }
  const chkBox = on => <span style={{width:19,height:19,borderRadius:6,flexShrink:0,...(on?{background:C.accent,display:'inline-flex',alignItems:'center',justifyContent:'center'}:{border:`1.5px solid ${C.done}`,background:'#fff',display:'inline-block'})}}>{on&&<svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>}</span>
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
        <div style={{flex:'1 1 220px',display:'flex',alignItems:'center',gap:7,background:'#fff',border:`${qMes?1.5:1}px solid ${qMes?C.accent:C.border}`,borderRadius:9,padding:'0 10px',minWidth:0}}>
          <SIcon n='search' s={13} c={C.muted}/>
          <input value={qMes} onChange={e=>setQMes(e.target.value)} placeholder='Buscar cliente, N° o RUT…' style={{flex:1,minWidth:0,border:'none',outline:'none',background:'none',fontSize:12.5,color:C.text,padding:'8px 0'}}/>
          {qMes&&<span onClick={()=>setQMes('')} style={{fontSize:11,color:C.muted,cursor:'pointer',fontWeight:600}}>Limpiar</span>}
        </div>
      </div>

      {/* NÚCLEO: Emitir + Enviar (las dos acciones que mueven plata hacia el cobro). En escritorio las dos listas van abiertas lado a lado (sus encabezados reemplazan estas tarjetas). */}
      {!isDesktop&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,marginBottom:11}}>
        <button onClick={()=>setChecklistTab(t=>t==='emitir'?null:'emitir')} title='Programadas del mes por emitir al SII' style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8,background:checklistTab==='emitir'?C.overdueBg:'#fff',border:`1.5px solid ${checklistTab==='emitir'?C.overdueText:C.border}`,borderRadius:14,padding:'13px 14px',cursor:'pointer',textAlign:'left'}}>
          <span style={{width:34,height:34,borderRadius:9,background:C.overdueBg,display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.overdueText} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='M12 18v-6M9 15l3-3 3 3'/></svg></span>
          <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Emitir programadas</div><div style={{fontSize:10,color:C.muted}}>para este mes</div></div>
          <div style={{display:'flex',alignItems:'baseline',gap:7}}><span style={{fontSize:20,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmtShort(totMes)}</span><span style={{fontSize:11,color:C.muted,fontWeight:600}}>{nMes} fact.</span></div>
        </button>
        <button onClick={()=>setChecklistTab(t=>t==='enviar'?null:'enviar')} title='Emitidas con respaldo que aún no envías al cliente' style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:8,background:checklistTab==='enviar'?C.azulBg:'#fff',border:`1.5px solid ${checklistTab==='enviar'?C.accent:C.border}`,borderRadius:14,padding:'13px 14px',cursor:'pointer',textAlign:'left'}}>
          <span style={{width:34,height:34,borderRadius:9,background:C.azulBg,display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z'/></svg></span>
          <div><div style={{fontSize:13,fontWeight:700,color:C.text}}>Enviar facturas</div><div style={{fontSize:10,color:C.muted}}>al cliente · para que paguen</div></div>
          <div style={{display:'flex',alignItems:'baseline',gap:7}}><span style={{fontSize:20,fontWeight:800,color:porEnviar.length?C.accent:C.done,fontVariantNumeric:'tabular-nums'}}>{porEnviar.length}</span><span style={{fontSize:11,color:C.muted,fontWeight:600}}>{porEnviar.length?'listas':'nada por enviar'}</span></div>
        </button>
      </div>}

      {/* SOPORTE: facturar adelantos · cotejar SII · cargar XML */}
      <div style={{...SEC_LBL,margin:'0 2px 7px'}}>Soporte</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:checklistTab==='adelantos'?8:12}}>
        {onFacturarAdelantos&&adelFact.length>0&&(
          <button onClick={()=>setChecklistTab(t=>t==='adelantos'?null:'adelantos')} title='Convierte anticipos ya recibidos en facturas del mes' style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:3,background:checklistTab==='adelantos'?C.azulBg:'#fff',border:`1px solid ${checklistTab==='adelantos'?C.azulInfo:C.border}`,borderRadius:11,padding:'9px 10px',cursor:'pointer',textAlign:'left'}}>
            <div style={{fontSize:11.5,fontWeight:700,color:C.text}}>Facturar adelantos</div><div style={{fontSize:9,color:C.muted}}>anticipos → factura</div><div style={{fontSize:14,fontWeight:800,color:C.azulInfo,marginTop:2}}>{adelFact.length}</div>
          </button>
        )}
        {onCotejar&&(
          <button onClick={onCotejar} title='Trae lo emitido del SII y lo calza con las programadas' style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:3,background:'#fff',border:`1px solid ${C.border}`,borderRadius:11,padding:'9px 10px',cursor:'pointer',textAlign:'left'}}>
            <div style={{fontSize:11.5,fontWeight:700,color:C.text}}>Cotejar con el SII</div><div style={{fontSize:9,color:C.muted}}>emitidas vs SII</div><div style={{fontSize:14,fontWeight:800,color:C.soonText,marginTop:2}}><Gl n='chevron'/></div>
          </button>
        )}
        {onCargarXML&&(
          <button onClick={onCargarXML} title='Carga lo emitido en el SII (XML, Excel, PDF, Drive) y registra lo que falte' style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:3,background:'#fff',border:`1px solid ${(sinRegN+emitidasSinXml.length)>0?C.soonText:C.border}`,borderRadius:11,padding:'9px 10px',cursor:'pointer',textAlign:'left'}}>
            {/* El número es lo PENDIENTE (sin registrar + sin XML), no las que ya tienen XML (ese "27" confundía). 0 → sin número. */}
            <div style={{fontSize:11.5,fontWeight:700,color:C.text}}>Cargar del SII</div><div style={{fontSize:9,color:C.muted}}>por cargar</div><div style={{fontSize:14,fontWeight:800,color:(sinRegN+emitidasSinXml.length)>0?C.soonText:C.done,marginTop:2}}>{(sinRegN+emitidasSinXml.length)>0?(sinRegN+emitidasSinXml.length):<Gl n='chevron'/>}</div>
          </button>
        )}
      </div>
      {checklistTab==='adelantos'&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:12}}>
          <div style={{padding:'2px 13px 6px'}}>
            {adelClientes.map(g=>{ const allSel=g.items.every(a=>adelSel.has(a.id)); const nSel=g.items.filter(a=>adelSel.has(a.id)).length; const open=adelOpen.has(g.key); return (
              <div key={g.key} style={{borderBottom:`1px solid ${C.bgSoft}`}}>
                <div style={{display:'flex',alignItems:'center',gap:11,padding:'11px 0'}}>
                  <span onClick={e=>{e.stopPropagation();toggleAdelCliente(g)}} style={{cursor:'pointer',display:'inline-flex'}}>{chkBox(allSel)}</span>
                  <span onClick={()=>toggleAdelOpen(g.key)} style={{display:'flex',alignItems:'center',flex:1,minWidth:0,cursor:'pointer',gap:8}}>
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(90deg)':'none'}}><polyline points='9 18 15 12 9 6'/></svg>
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:'block',fontSize:14,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{g.name}</span>
                      <span style={{display:'block',fontSize:11,color:C.muted}}>{nSel>0&&!allSel?`${nSel} de ${g.items.length} seleccionados`:`${g.items.length} adelanto${g.items.length!==1?'s':''}`}</span>
                    </span>
                  </span>
                  <span style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{fmt(g.total)}</span>
                </div>
                {open&&<div style={{paddingLeft:31,paddingBottom:6}}>
                  {g.items.map(a=>{ const on=adelSel.has(a.id); return (
                    <div key={a.id} onClick={()=>toggleAdel(a.id)} style={{display:'flex',alignItems:'center',gap:11,padding:'7px 0',cursor:'pointer'}}>
                      {chkBox(on)}
                      <span style={{flex:1,minWidth:0,fontSize:13,color:on?C.text:C.muted}}>Anticipo{a.created_at?` ${fmtFechaDMY(a.created_at)}`:''} · disponible</span>
                      <span style={{fontSize:13,fontWeight:500,color:on?C.text:C.muted,whiteSpace:'nowrap'}}>{fmt(a.monto||0)}</span>
                    </div>
                  )})}
                </div>}
              </div>
            )})}
          </div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'11px 14px',background:C.accent}}>
            <span style={{fontSize:13,fontWeight:600,color:'#fff'}}>{adelSelItems.length} seleccionado{adelSelItems.length!==1?'s':''}{adelSelItems.length?` · ${fmt(adelSelTotal)}`:''}</span>
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              {adelSelItems.length>0&&<span onClick={()=>setAdelSel(new Set())} style={{fontSize:12,color:'#B9C7CE',cursor:'pointer'}}>Limpiar</span>}
              <button onClick={confirmarAdel} disabled={!adelSelItems.length} style={{fontSize:13,fontWeight:600,color:adelSelItems.length?C.accent:'#7FA0AD',background:adelSelItems.length?'#fff':'#2C5766',border:'none',borderRadius:8,padding:'7px 16px',cursor:adelSelItems.length?'pointer':'default'}}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* (acciones núcleo Emitir/Enviar + Soporte movidas arriba — jerarquía C) */}

      {/* Acordeón · Por emitir (escritorio: columna izquierda, siempre abierta) */}
      <div style={isDesktop?{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:16,alignItems:'start',marginBottom:12}:undefined}>
      {(isDesktop||checklistTab==='emitir')&&(<div style={{minWidth:0}}>
      {isDesktop&&<div style={{display:'flex',alignItems:'baseline',gap:8,padding:'10px 13px',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:9}}><span style={{fontSize:13,fontWeight:700,color:C.text}}>Emitir programadas</span><span style={{fontSize:11,color:C.muted}}>para este mes · {nMes}</span><span style={{marginLeft:'auto',fontSize:15,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmt(totMes)}</span></div>}
      <div style={{display:'flex',alignItems:'stretch',gap:6,margin:'0 2px 9px',flexWrap:'wrap'}}>
        <div style={{flex:'1 1 150px',background:C.greenBg,border:'1px solid #CDE8D8',borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:9,fontWeight:800,color:C.greenText,textTransform:'uppercase',letterSpacing:.4}}>A facturar este mes</div><div style={{fontSize:14,fontWeight:800,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(totMes)}</div><div style={{fontSize:9.5,color:C.muted,fontWeight:600}}>{nMes} cuota{nMes!==1?'s':''}</div></div>
        <div style={{flex:'1 1 110px',background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:9,fontWeight:800,color:C.overdueText,textTransform:'uppercase',letterSpacing:.4}}>Atrasado</div><div style={{fontSize:14,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmt(totAtr)}</div><div style={{fontSize:9.5,color:C.muted,fontWeight:600}}>plata no entró</div></div>
        <div style={{flex:'1 1 110px',background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:9,fontWeight:800,color:C.tealText,textTransform:'uppercase',letterSpacing:.4}}>En espera</div><div style={{fontSize:14,fontWeight:800,color:C.tealText,fontVariantNumeric:'tabular-nums'}}>{fmt(totEsp)}</div><div style={{fontSize:9.5,color:C.muted,fontWeight:600}}>anticipo recibido</div></div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',margin:'0 2px 8px'}}>
        <button onClick={descargarExcel} disabled={desc} style={{fontSize:10,fontWeight:600,color:C.accent,background:'none',border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 11px',cursor:desc?'default':'pointer',whiteSpace:'nowrap'}}>{desc?'…':'↓ Descargar mes'}</button>
      </div>
      {emitSel.size>0&&(()=>{ const sel=porEmitir.filter(b=>emitSel.has(b.id)); const tot=sel.reduce((a,b)=>a+(b.amount||0),0); return (
        <div style={{display:'flex',alignItems:'center',gap:9,background:C.accent,borderRadius:10,padding:'9px 12px',marginBottom:11,flexWrap:'wrap'}}>
          <div style={{color:'#fff',fontSize:12.5,fontWeight:700}}>{sel.length} seleccionada{sel.length!==1?'s':''} · {fmt(tot)}</div>
          <button onClick={()=>setEmitSel(new Set())} style={{marginLeft:'auto',background:'transparent',border:'none',color:C.textSoft,fontSize:11,cursor:'pointer'}}>Limpiar</button>
          <button onClick={descargarSel} style={{background:'#fff',color:C.accent,border:'none',borderRadius:8,padding:'6px 13px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Descargar</button>
          <button onClick={facturarSel} disabled={emitBulk} style={{background:C.greenText,color:'#fff',border:'none',borderRadius:8,padding:'6px 13px',fontSize:12,fontWeight:700,cursor:emitBulk?'default':'pointer'}}>{emitBulk?'Facturando…':'Facturar'}</button>
        </div>
      )})()}
      {/* 1 · A FACTURAR ESTE MES — por cliente; vigente + atrasadas del mismo cliente (no se para su facturación) */}
      {g1.length>0&&<div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.4,margin:'0 2px 5px',display:'flex',alignItems:'center',gap:6}}><SIcon n='check' s={12} c={C.greenText}/>A facturar este mes · {nMes}</div>}
      {g1.length>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:12}}>{renderMes(g1)}</div>}
      {/* 2 · ATRASADAS — vencidas, plata NO entró; de la más nueva a la más vieja */}
      {g2.length>0&&<div style={{fontSize:10,fontWeight:700,color:C.overdueText,textTransform:'uppercase',letterSpacing:.4,margin:'0 2px 5px',display:'flex',alignItems:'center',gap:6}}><SIcon n='clock' s={12} c={C.overdueText}/>Atrasadas · {g2.length} · plata no entró</div>}
      {g2.length>0&&<div style={{border:`1px solid ${C.overdueText}33`,borderRadius:10,overflow:'hidden',marginBottom:12}}>{renderAtr(g2,'atrasada')}</div>}
      {/* 3 · EN ESPERA · con anticipo — plata YA recibida; solo falta emitir, o nunca */}
      {g3.length>0&&<div style={{fontSize:10,fontWeight:700,color:C.tealText,textTransform:'uppercase',letterSpacing:.4,margin:'0 2px 5px',display:'flex',alignItems:'center',gap:6}}><SIcon n='clock' s={12} c={C.tealText}/>En espera · con anticipo · {g3.length} · plata ya recibida</div>}
      {g3.length>0&&<div style={{border:`1px solid ${C.tealText}33`,borderRadius:10,overflow:'hidden',marginBottom:12}}>{renderAtr(g3,'espera')}</div>}
      {porEmitir.length===0&&<div style={{color:C.greenText,textAlign:'center',padding:22,fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:12}}><SIcon n='check' s={15} c={C.greenText}/>Todo emitido este mes</div>}
      {yaEmitidasFantasma.length>0&&<div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px',marginBottom:12,fontSize:11,color:C.muted,lineHeight:1.45}}><b style={{color:C.greenText}}>{yaEmitidasFantasma.length} cuota{yaEmitidasFantasma.length!==1?'s':''} ya emitida{yaEmitidasFantasma.length!==1?'s':''}</b> se excluye{yaEmitidasFantasma.length!==1?'n':''} de este listado (el motor las cruzó con su factura real). Retíralas en <b>Revisión de datos</b>.</div>}
      </div>)}

      {/* Acordeón · Por enviar al cliente — emitidas con respaldo, sin correo. Estilo aprobado: día grande + Factura N° + RS·RUT + Enviar navy bajo el monto. */}
      {(isDesktop||checklistTab==='enviar')&&(
        <div style={{marginBottom:12,minWidth:0}}>
          {isDesktop
            ? <div style={{display:'flex',alignItems:'baseline',gap:8,padding:'10px 13px',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,marginBottom:9}}><span style={{fontSize:13,fontWeight:700,color:C.text}}>Enviar facturas</span><span style={{fontSize:11,color:C.muted}}>al cliente · {porEnviar.length}</span><span style={{marginLeft:'auto',fontSize:15,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmt(porEnviarTotal)}</span></div>
            : <div style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.4,margin:'0 2px 6px'}}>Por enviar al cliente · {porEnviar.length}{porEnviar.length?` · ${fmt(porEnviarTotal)}`:''}</div>}
          {emitidasSinXml.length>0&&<div style={{background:C.soonBg,border:`1px solid ${C.soon}`,borderRadius:10,padding:'8px 11px',marginBottom:8,fontSize:11,color:C.soonText,lineHeight:1.45}}><b>{emitidasSinXml.length} emitida{emitidasSinXml.length!==1?'s':''} sin XML</b> — no se {emitidasSinXml.length!==1?'pueden':'puede'} enviar hasta cargar su XML (botón "Cargar XML"): {emitidasSinXml.slice(0,8).map(b=>'N° '+folioN(b.invoice_no)).join(' · ')}{emitidasSinXml.length>8?'…':''}</div>}
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            {porEnviar.length===0&&<div style={{color:C.greenText,textAlign:'center',padding:22,fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><SIcon n='check' s={15} c={C.greenText}/>Todas enviadas</div>}
            {porEnviarGrupos.map((g,gi)=>{ const top=gi>0?{borderTop:`1px solid ${C.border}`}:{}
              // 1 pendiente y ninguna ya enviada del cliente → fila simple. Si no → tarjeta de cliente con "Enviar juntas".
              if(g.unsent.length===1 && g.sent.length===0){ return <div key={g.unsent[0].id} style={{...top}}>{filaFactura(g.unsent[0],{})}</div> }
              const cid=g.cid; const c=clients.find(x=>x.id===cid); const tot=g.unsent.reduce((a,b)=>a+montoFactura(b),0); return (
                <div key={'g'+(cid||g.unsent[0].id)} style={{...top}}>
                  <div style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',background:C.azulBg}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div onClick={e=>abrirCli(e,g.unsent[0])} style={{...NOMBRE_CLI,cursor:onOpenClientFicha&&cid?'pointer':'default'}}>{c?.name||'Sin cliente'}{(()=>{ const rs=rsDe(g.unsent[0]); return rs&&rs!==c?.name ? <span style={{fontWeight:400,color:C.muted}}> · {rsDisplay(rs)}</span> : null })()}</div>
                      <div style={{fontSize:10,color:C.azulInfo}}>{g.unsent.length} por enviar · {fmt(tot)}{g.sent.length?` · ${g.sent.length} ya enviada${g.sent.length>1?'s':''}`:''}</div>
                    </div>
                    {onEnviarVarias&&g.unsent.length>1&&<button onClick={()=>onEnviarVarias(g.unsent)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'6px 12px',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Enviar juntas</button>}
                  </div>
                  {g.unsent.map(b=>filaFactura(b,{compact:true}))}
                  {g.sent.map(b=>filaFactura(b,{compact:true,sent:true}))}
                </div>
              )
            })}
          </div>
          {/* Pie auditable: ya enviadas de clientes 100% enviados (las de clientes con pendientes se muestran en su grupo). */}
          {enviadasSueltas.length>0&&(
            <div style={{marginTop:6}}>
              <div onClick={()=>setEnviadasOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:11,color:C.muted,padding:'2px 2px'}}>
                <span style={{color:C.greenText,fontWeight:600,display:'inline-flex',alignItems:'center',gap:5}}><SIcon n='check' s={13} c={C.greenText}/>{enviadasSueltas.length} ya enviada{enviadasSueltas.length>1?'s':''} este mes</span>
                <span>· cargadas por XML = por enviar + enviadas</span>
                <span style={{marginLeft:'auto'}}>{enviadasOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
              </div>
              {enviadasOpen&&(
                <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginTop:4}}>
                  {enviadasSueltas.map(b=>{ const c=clients.find(x=>x.id===b.client_id); const rs=rsDe(b); return (
                    <div key={b.id} style={{display:'flex',gap:11,alignItems:'center',padding:'10px 12px',borderBottom:`1px solid ${C.border}`,background:C.bgSoft}}>
                      {bigDate(b.issued_at||b.due,C.accent)}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}><span style={{fontSize:13,fontWeight:600,color:C.text}}>Factura N° {folioN(b.invoice_no)||b.folio||'—'}</span><span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Enviada {String(b.email_sent_at||'').slice(0,10).split('-').reverse().slice(0,2).join('-')}</span></div>
                        <div onClick={e=>abrirCli(e,b)} style={{fontSize:11,color:onOpenClientFicha&&b.client_id?C.accent:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenClientFicha&&b.client_id?'pointer':'default'}}>{c?.name||'Sin cliente'}{rs?<span style={{color:C.muted}}> · {rsDisplay(rs)}</span>:''}</div>
                      </div>
                      <div style={{textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt(montoFactura(b))}</div>
                        <div style={{display:'flex',gap:6}}>
                          {onUnsend&&<button onClick={()=>onUnsend(b)} title='Deshacer el envío (fue una prueba) → vuelve a Por enviar' style={{background:'#fff',color:C.muted,border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 10px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>No enviada</button>}
                          {onEnviar&&<button onClick={()=>onEnviar(b)} style={{background:'#fff',color:C.accent,border:`1px solid ${C.accent}`,borderRadius:8,padding:'4px 11px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Reenviar</button>}
                        </div>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Emitidas — con folio (aparecen en el SII), COLAPSADAS POR AÑO → MES. Al abrir una factura: conciliar, asignar RS, enviar. */}
      {emitidasPorAnio.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.4,margin:'0 2px 6px'}}>Emitidas · por año</div>
          {emitidasPorAnio.map(({y,months,total,n})=>{ const yOpen=aniosEmitOpen.has(y); return (
            <div key={y} style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:6}}>
              <div onClick={()=>setAniosEmitOpen(s=>{ const nn=new Set(s); nn.has(y)?nn.delete(y):nn.add(y); return nn })} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer',background:C.greenBg}}>
                <span style={{fontSize:12,fontWeight:700,color:C.greenText,flex:1}}>{y} · {n} · {fmt(total)}</span>
                <span style={{fontSize:12,color:C.greenText}}>{yOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
              </div>
              {yOpen&&months.map(([mk,fs])=>{ const mOpen=mesesEmitOpen.has(mk); const mm=mk.slice(5,7); const mtot=fs.reduce((a,b)=>a+(b.amount||0),0); return (
                <div key={mk} style={{borderTop:`1px solid ${C.border}`}}>
                  <div onClick={()=>setMesesEmitOpen(s=>{ const nn=new Set(s); nn.has(mk)?nn.delete(mk):nn.add(mk); return nn })} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px 8px 20px',cursor:'pointer',background:C.bgSoft}}>
                    <span style={{fontSize:11,fontWeight:600,color:C.text,flex:1}}>{MESES[parseInt(mm,10)-1]||mm} · {fs.length} · {fmt(mtot)}</span>
                    <span style={{fontSize:11,color:C.muted}}>{mOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
                  </div>
                  {mOpen&&fs.map(b=>{ const c=clients.find(x=>x.id===b.client_id); const abonado=Math.max(b.paid_amount||0,respaldoMap[b.id]||0); const est=estadoFacturaLabel(b,abonado,cartolaHasta); const rs=rsDe(b); const fo=factOpen.has(b.id); const needConc=est&&['sin','sinpago','parcial'].includes(est.key); const parcial=est&&est.key==='parcial'; const saldoB=parcial?Math.max(0,(b.amount||0)-abonado):(b.amount||0); return (
                    <div key={b.id} style={{borderTop:`1px solid ${C.border}`,background:'#fff'}}>
                      <div onClick={()=>setFactOpen(s=>{ const nn=new Set(s); nn.has(b.id)?nn.delete(b.id):nn.add(b.id); return nn })} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px 9px 14px',cursor:'pointer'}}>
                        {bigDate(fecEmis(b),C.greenText)}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{...NOMBRE_CLI}}>{c?.name||'Sin cliente'} <span style={{fontWeight:400,color:C.muted}}>· Factura N° {folioN(b.invoice_no)||b.folio||'—'}</span></div>
                          <div style={{fontSize:10,color:C.grisText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rs?<span style={{color:C.muted}}>{rsDisplay(rs)}</span>:<span style={{color:C.soonText}}>Sin razón social</span>} · {b.concept||'—'}</div>
                        </div>
                        <EstadoFacturaChip b={b} aplicado={abonado} cartolaHasta={cartolaHasta} style={{fontSize:9,padding:'2px 8px',borderRadius:8,flexShrink:0}}/>
                        <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:12,color:parcial?C.soonText:C.muted,fontWeight:parcial?600:400}}>{fmt(saldoB)}</div>{parcial&&<div style={{fontSize:9,color:C.textSoft,whiteSpace:'nowrap'}}>saldo · de {fmt(b.amount)}</div>}</div>
                      </div>
                      {fo&&(
                        <div style={{padding:'2px 12px 10px 20px'}}>
                          {/* Traza de la factura: emitida · correo (con fecha de envío) · estado de cobro */}
                          <div style={{background:C.bgSoft,borderRadius:8,padding:'7px 10px',marginBottom:8,fontSize:11,color:C.muted,display:'flex',flexDirection:'column',gap:2}}>
                            <div>Emitida <b style={{color:C.text}}>{fmtFechaDMY(b.issued_at)}</b>{b.dte_xml?<span style={{color:C.greenText}}> · PDF con timbre</span>:''}</div>
                            <div>Correo: {b.email_sent_at?<b style={{color:C.greenText,display:'inline-flex',alignItems:'center',gap:4,verticalAlign:'middle'}}><SIcon n='check' s={12} c={C.greenText}/>enviado el {fmtFechaDMY(b.email_sent_at)}</b>:<span style={{color:C.soonText}}>Sin enviar</span>}</div>
                            <div>Cobro: <b style={{color:(est&&est.fg)||C.muted}}>{(est&&est.label)||b.status}</b></div>
                          </div>
                          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                            {onEnviar&&<button onClick={()=>onEnviar(b)} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>{b.email_sent_at?'Reenviar correo':'Enviar al cliente'}</button>}
                            {!rs&&onEdit&&<ActBtn variant='softAmber' onClick={()=>onEdit(b)}>Asignar razón social</ActBtn>}
                            {onEdit&&<ActBtn variant='ghost' onClick={()=>onEdit(b)}>Editar · ver PDF</ActBtn>}
                            {onOpenClientFicha&&b.client_id&&<button onClick={()=>onOpenClientFicha(b.client_id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Ver ficha</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                </div>
              )})}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}

// Modal de sincronización con el SII — Fase 1: lee el Registro de Ventas y
// concilia Programadas -> Pendientes vía la Edge Function sii-sync (solo admin).
// Tres puntos pulsantes mientras el SII responde
export function SiiDots(){
  const [a,setA] = useState(0)
  useEffect(()=>{ const id=setInterval(()=>setA(x=>(x+1)%3),280); return ()=>clearInterval(id) },[])
  return <div style={{display:'flex',gap:6,justifyContent:'center',padding:'22px 20px'}}>{[0,1,2].map(i=>(<div key={i} style={{width:7,height:7,borderRadius:'50%',background:C.accent,opacity:a===i?1:.15,transition:'opacity .15s'}}/>))}</div>
}

// FUENTE ÚNICA: resuelve el cliente de una factura del SII por RUT→nombre (vínculos aprendidos primero, luego clientes).
// La usan tanto SiiSyncModal como handleIngresarSII (antes divergían en normalización y prioridad → podían asignar clientes distintos).
// Modal "¿de qué mes es esta tanda?" (carga de XML): mes + año. def = 'AAAA-MM' preseleccionado (mes del servicio = vencido). onPick(valor|null).
export function MesTandaModal({def,onPick}){
  const MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const ok=def&&/^\d{4}-\d{2}$/.test(def)
  const dy=ok?+def.slice(0,4):new Date().getFullYear(), dm=ok?+def.slice(5,7)-1:0
  const [y,setY]=useState(dy); const [m,setM]=useState(dm)
  const years=[dy+1,dy,dy-1,dy-2]
  const cap=s=>s.charAt(0).toUpperCase()+s.slice(1)
  const selSty={fontSize:14,color:C.text,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 11px',background:C.surface,cursor:'pointer'}
  return <Modal hideHeader maxWidth={360} onClose={()=>onPick(null)}>
    <div style={{padding:'18px 18px 18px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:15}}>
        <span style={{width:34,height:34,borderRadius:10,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg viewBox='0 0 24 24' width='18' height='18' style={{fill:'none',stroke:C.accent,strokeWidth:2,strokeLinecap:'round',strokeLinejoin:'round'}}><rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/></svg></span>
        <div style={{minWidth:0}}><div style={{fontSize:15,fontWeight:600,color:C.accent,lineHeight:1.2}}>¿De qué mes es esta tanda?</div><div style={{fontSize:11,color:C.muted,marginTop:2}}>El mes del servicio.</div></div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <select value={m} onChange={e=>setM(+e.target.value)} style={{...selSty,flex:1}}>{MES.map((mm,i)=><option key={i} value={i}>{cap(mm)}</option>)}</select>
        <select value={y} onChange={e=>setY(+e.target.value)} style={{...selSty,width:92}}>{years.map(yy=><option key={yy} value={yy}>{yy}</option>)}</select>
      </div>
      <div style={{display:'flex',gap:8,marginTop:16}}>
        <button onClick={()=>onPick(null)} style={{flex:1,fontSize:13,fontWeight:600,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 0',color:C.muted,cursor:'pointer'}}>Cancelar</button>
        <button onClick={()=>onPick(`${y}-${String(m+1).padStart(2,'0')}`)} style={{flex:1.3,fontSize:13,fontWeight:600,background:C.accent,border:'none',borderRadius:10,padding:'10px 0',color:'#fff',cursor:'pointer'}}>Guardar</button>
      </div>
    </div>
  </Modal>
}

// Parser único de un DTE del import (Documento XML) → todos los campos que usa la carga, extraídos en UN solo lugar (misma regex de siempre).
// No repetir estas extracciones inline en procesarRespaldoSII. total = MntTotal, cae a MntExe (exenta).
export function parseDTE(d){
  const s=String(d||'')
  const one=re=>((s.match(re)||[])[1]||'')
  const nmb=one(/<NmbItem>([^<]+)<\/NmbItem>/), dsc=one(/<DscItem>([^<]+)<\/DscItem>/)
  const refB=(s.match(/<Referencia>[\s\S]*?<\/Referencia>/)||[''])[0]
  return {
    tipo:+one(/<TipoDTE>(\d+)<\/TipoDTE>/)||null,
    folio:one(/<Folio>([^<]+)<\/Folio>/).trim(),
    fecha:one(/<FchEmis>([^<]+)<\/FchEmis>/)||null,
    rut:one(/<RUTRecep>([^<]+)<\/RUTRecep>/)||null,
    receptor:one(/<RznSocRecep>([^<]+)<\/RznSocRecep>/)||null,
    total:+(one(/<MntTotal>(\d+)<\/MntTotal>/)||one(/<MntExe>(\d+)<\/MntExe>/)||0),
    nmb, dsc, glosa:[nmb,dsc].filter(Boolean).join(' — ').trim(),
    ref:{ folio:((refB.match(/<FolioRef>([^<]+)<\/FolioRef>/)||[])[1]||'').trim(), cod:+((refB.match(/<CodRef>(\d+)<\/CodRef>/)||[])[1]||0)||null, razon:(refB.match(/<RazonRef>([^<]+)<\/RazonRef>/)||[])[1]||'' }
  }
}

// Valor de learnings config (kind 'config'), leído una vez por sesión. Ej.: sii_emision_etapa (paso de la puesta en marcha de la emisión).
export const _cfgValP={}

export function useConfigValor(key){
  const [v,setV]=useState(null)
  useEffect(()=>{ if(DEMO) return; if(!_cfgValP[key]) _cfgValP[key]=supabase.from('learnings').select('value').eq('kind','config').eq('key',key).order('updated_at',{ascending:false}).limit(1).then(({data})=>data?.[0]?.value??null,()=>null)
    let on=true; _cfgValP[key].then(x=>{ if(on) setV(x) }); return ()=>{on=false} },[key])
  return v
}

// Fila del historial de cargas del SII: fecha, quién, mes de la tanda, totales, y despliegue por archivo.
export function CargaHistRow({b}){
  const [open,setOpen]=useState(false)
  const c=b.counts||{}
  const LAB={prog:'programadas',new:'nuevas',dup:'ya cargadas',reg:'registradas',nc:'NC',cre:'agregadas',err:'con problema'}
  const parts=['prog','new','dup','reg','nc','cre','err'].filter(k=>c[k]).map(k=>`${c[k]} ${LAB[k]}`)
  const fecha=fmtFechaHora(b.created_at)
  const M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const mi=b.period&&/^\d{4}-\d{2}$/.test(b.period)?+b.period.slice(5,7)-1:null
  const per=mi!=null?`${M[mi].charAt(0).toUpperCase()+M[mi].slice(1)} ${b.period.slice(0,4)}`:null
  const nf=(b.files?.length)||0
  const regTarget=(c.prog||0)+(c.new||0)   // facturas que se podían registrar (programadas + nuevas)
  return <div style={{padding:'12px 2px',borderTop:`1px solid ${C.bgSoft}`}}>
    <div onClick={()=>nf&&setOpen(o=>!o)} style={{cursor:nf?'pointer':'default'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
        <span style={{fontSize:13,fontWeight:600,color:C.accent}}>{fecha}<span style={{marginLeft:7,fontSize:9.5,fontWeight:700,color:C.muted,background:C.bgSoft,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{({xml:'XML',excel:'Excel',pdf:'PDF',drive:'Drive',registro:'Registro'})[b.tipo]||'XML'}</span></span>
        {per&&<span style={{fontSize:9.5,fontWeight:700,color:C.azulInfo,background:C.azulBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{per}</span>}
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:1}}>{b.created_by||'—'}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:5}}><b style={{color:C.text}}>{nf} archivo{nf!==1?'s':''} · {b.docs_total} doc</b>{parts.length?` — ${parts.join(' · ')}`:''}{b.skipped>0?` · ${b.skipped} omitida${b.skipped!==1?'s':''}`:''}{nf?<span style={{color:C.azulInfo,fontWeight:600}}> · {open?'ocultar':'ver'}</span>:null}</div>
      {regTarget>0&&<div style={{fontSize:11,fontWeight:600,marginTop:3,color:(b.registered||0)>=regTarget?C.greenText:C.muted}}>Registró {b.registered||0} de {regTarget}{(b.registered||0)>=regTarget?<>{" "}<Gl n='tick'/></>:''}</div>}
    </div>
    {open&&(b.files||[]).map((f,i)=><div key={i} style={{fontSize:11,color:C.muted,marginTop:6,paddingLeft:10,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.name} · {f.total} doc{f.skipped>0?` · ${f.skipped} omitida${f.skipped!==1?'s':''}`:''}</div>)}
  </div>
}

// Señales de período en una glosa/concepto: mes (0-11), año y N° de cuota. Sirve para calzar la factura del SII con SU cuota
// programada por lo que DICE ("Asesoría permanente julio 2026", "Cuota 7/12"), no solo por monto/fecha (que fallan con cuotas viejas sin registrar).
// UF que menciona la glosa de un DTE ("Equivalente a 37,3 UF", "(30 UF)", "45,83 UF") → número. Sirve para crear la venta EN UF desde la factura.
export const ufDeGlosa = g => { const m=String(g||'').match(/(\d[\d.,]*)\s*UF\b/i); if(!m) return null; let s=m[1]; if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); const n=parseFloat(s); return n>0?n:null }
// Puntúa cuánto calza el MES de servicio de la glosa (gmes) con una candidata. Prioriza la convención "mes vencido" de la firma
// (servicio = vencimiento − 1), luego el N° de cuota, y deja el mes directo como señal débil. Evita que cuotas de meses contiguos empaten.

export function SiiSyncModal({onClose,onRefresh,clients=[],clientEntities=[],billing=[],initialMes,onOpenClientFicha,asPage=false}) {
  const isDesktop = useIsDesktop()
  const hoy = new Date()
  const [mes,setMes] = useState((/^\d{4}-\d{2}$/.test(initialMes||'')?initialMes:`${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}`))
  const [loading,setLoading] = useState(false)
  const [result,setResult] = useState(null)
  const [error,setError] = useState('')
  const [lastSync,setLastSync] = useState(()=>{ try{ return localStorage.getItem('sii_lastsync') }catch(_){ return null } })
  // "hace X" desde el último cotejo exitoso (cualquier mes)
  const desdeTxt = ts => { if(!ts) return null; const min=Math.round((Date.now()-new Date(ts).getTime())/60000); if(min<1) return 'recién'; if(min<60) return `hace ${min} min`; const h=Math.round(min/60); if(h<24) return `hace ${h} h`; const d=Math.round(h/24); return `hace ${d} día${d!==1?'s':''}` }
  const [ingresando,setIngresando] = useState(null)        // folio en curso
  const [ingresadas,setIngresadas] = useState(()=>({}))    // folio -> {cliente|null}
  const [yaOpen,setYaOpen] = useState(false)
  const [autoOpen,setAutoOpen] = useState(false)   // "se cargaron solas" colapsado por defecto
  const [recoExp,setRecoExp] = useState(()=>new Set())   // folios con la comparación En el SII ↔ Tu cliente abierta
  const [ambShowAll,setAmbShowAll] = useState(()=>new Set())   // "Elige la factura": ver TODAS las candidatas aunque una calce el mes (por defecto solo la del mes correcto)
  const [corrExp,setCorrExp] = useState(()=>new Set())   // billingIds con la comparación En el SII ↔ Tu factura (folio) abierta
  const [yy,mm] = mes.split('-').map(Number)
  const mesLabel = `${MESES_ABR[mm-1]} ${yy}`
  const mesLargo = `${MESES_LG[mm-1]} ${yy}`
  const cambiarMes = d => { const dt=new Date(yy,mm-1+d,1); setMes(`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`) }

  // "96713940-8" -> "96.713.940-8" (solo formato visual)
  const fmtRut = r => { if(!r) return ''; const [n,dv]=String(r).replace(/\./g,'').split('-'); return n? n.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(dv!==undefined?'-'+dv:'') : String(r) }
  // Fuente única compartida con handleIngresarSII (RUT→nombre en vínculos, luego clientes).
  const resolverCliente = (rut,nombre) => resolverClienteSII(rut,nombre,clients,clientEntities)
  // Crea el cobro en billing desde la factura del SII. Si reconoce el cliente, vincula
  // y aprende el RUT para siempre; si no, lo deja sin cliente para asignarlo en Facturacion.
  const ingresarHuerfana = async(it, clienteIdForzado) => {
    if(ingresando||ingresadas[it.folio]) return                       // A2: anti doble-click / re-entrada (guard síncrono)
    const dup=(billing||[]).find(b=>String(b.invoice_no)===String(it.folio)&&!b.deleted_at)   // A1: dedupe cliente-side (no depende de una constraint UNIQUE en la DB)
    if(dup){ setIngresadas(p=>({...p,[it.folio]:{cliente:(clients.find(c=>String(c.id)===String(dup.client_id))||{}).name||null}})); return }
    setIngresando(it.folio); setError('')
    try{
      const cli = clienteIdForzado ? (clients.find(c=>String(c.id)===String(clienteIdForzado))||null) : resolverCliente(it.rut,it.receptor)
      await upsertBilling({
        client_id: cli?.id||null,
        concept: 'Honorarios',
        receptor_name: it.receptor||null,
        receptor_rut: it.rut||null,
        amount: it.monto,
        status: 'Pendiente',
        invoice_no: String(it.folio),
        issued_at: isoFecha(it.fechaEmision)||it.fechaEmision,   // normaliza DD/MM/YYYY→ISO: sin esto Postgres (datestyle MDY) puede leer 08/07 como 7-ago
        due: dueFromIssued(isoFecha(it.fechaEmision)||it.fechaEmision),
        billing_type: 'honorarios',
        sii_tipo_dte: it.tipoDte||null,
        sii_synced_at: new Date().toISOString(),
        notes: null,
      })
      if(cli){
        await reconcileProgramada(cli.id, it.monto, isoFecha(it.fechaEmision)||it.fechaEmision)   // A3: fecha ISO (no cruda) para la ventana ±45d
        // M5: no pisar el nombre bueno de una RS ya existente con el crudo del SII (ignoreDuplicates: solo crea el vínculo si el RUT es nuevo)
        if(it.rut) await supabase.from('client_entities').upsert({client_id:cli.id,rut:it.rut,name:it.receptor||null},{onConflict:'rut',ignoreDuplicates:true})
      }
      setIngresadas(p=>({...p,[it.folio]:{cliente:cli?.name||null}}))
      if(onRefresh) await onRefresh()
    }catch(e){
      setError(e.message?.includes('duplicate')?`Factura N° ${it.folio} ya estaba registrada`:`No se pudo ingresar Factura N° ${it.folio}: ${e.message}`)
    }
    setIngresando(null)
  }
  // "Asignar todas" ingresa SOLO las que reconoce el cliente por RUT (las que no, se eligen a mano fila por fila — no se crean sin cliente en bulk).
  const ingresarTodas = async() => { for(const it of (result?.sinMatch||[])){ if(!ingresadas[it.folio] && resolverCliente(it.rut,it.receptor)) await ingresarHuerfana(it) } }

  const [corrigiendo,setCorrigiendo] = useState(null)        // billingId en curso
  const [corregidas,setCorregidas] = useState(()=>({}))      // billingId -> true
  // Asigna el folio real del SII a una venta ya emitida que tenia folio manual o sin folio.
  const aplicarCorreccion = async(it) => {
    if(corrigiendo||corregidas[it.billingId]) return                 // guard anti doble-click
    // El folio del SII ya está en OTRA factura tuya (constraint unique) -> es un duplicado, no un folio faltante.
    // Avisar claro y derivar a "Limpiar duplicados" en vez del error crudo de base de datos.
    const dueno = (billing||[]).find(b=> String(b.id)!==String(it.billingId) && !b.deleted_at && folioN(b.invoice_no) && String(folioN(b.invoice_no))===String(folioN(it.folio)))
    if(dueno){
      const cli = clients.find(c=>String(c.id)===String(dueno.client_id))
      setError(`El folio N° ${it.folio} ya está en otra factura tuya${cli?` (${cli.name})`:''}. Es un duplicado: revísalo en "Limpiar duplicados" y deja una sola.`)
      return
    }
    setCorrigiendo(it.billingId); setError('')
    try{
      const {error} = await supabase.from('billing').update({
        invoice_no: String(it.folio),
        issued_at: isoFecha(it.fechaEmision)||it.fechaEmision,        // A4: fecha ISO (no cruda), igual que las otras rutas
        ...(Number(it.monto)>0?{amount:Math.round(Number(it.monto))}:{}),   // el monto REAL es el del SII (it.monto), no el programado — evita el desfase saldo/conciliación
        sii_tipo_dte: it.tipoDte||null,
        sii_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', it.billingId)
      if(error) throw error
      setCorregidas(p=>({...p,[it.billingId]:true}))
      if(onRefresh) await onRefresh()
    }catch(e){
      const dup = e.code==='23505' || /duplicate key|invoice_no_unique/i.test(String(e.message||''))
      setError(dup
        ? `El folio N° ${it.folio} ya existe en otra factura tuya (puede estar retirada). Es un duplicado: revísalo en "Limpiar duplicados" o repón la factura correcta.`
        : `No se pudo corregir Factura N° ${it.folio}: ${e.message}`)
    }
    setCorrigiendo(null)
  }

  // Revisión manual (ambiguas): mostrar los candidatos y dejar ELEGIR cuál es. Al elegir, asigna el folio del SII
  // a esa cuota (Programada → Pendiente; o corrige el folio si ya estaba emitida).
  const [ambExp,setAmbExp] = useState(()=>new Set())          // folios de ambiguas expandidas
  const [ambDone,setAmbDone] = useState(()=>({}))             // folio -> cliente elegido
  const [ambBusy,setAmbBusy] = useState(null)                 // folio en curso
  const isoFecha = d => { if(!d) return ''; const s=String(d); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); const m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m?`${m[3]}-${m[2]}-${m[1]}`:'' }
  const elegirAmbigua = async(it,cand) => {
    if(ambBusy||ambDone[it.folio]) return                             // guard anti doble-click
    setAmbBusy(it.folio); setError('')
    try{
      const patch = { invoice_no:String(it.folio), issued_at:isoFecha(it.fechaEmision)||it.fechaEmision, ...(Number(it.monto)>0?{amount:Math.round(Number(it.monto))}:{}), sii_tipo_dte:it.tipoDte||null, sii_synced_at:new Date().toISOString(), updated_at:new Date().toISOString() }   // amount = monto REAL del SII (no el programado)
      if(cand.estado==='Programada') patch.status='Pendiente'
      const {error} = await supabase.from('billing').update(patch).eq('id', cand.id)
      if(error) throw error
      setAmbDone(p=>({...p,[it.folio]:cand.cliente||'—'}))
      if(onRefresh) await onRefresh()
    }catch(e){ setError(`No se pudo asignar Factura N° ${it.folio}: ${e.message}`) }
    setAmbBusy(null)
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
      const ts=new Date().toISOString(); setLastSync(ts); try{ localStorage.setItem('sii_lastsync',ts); localStorage.setItem('sii_lastsync_'+mes,ts) }catch(_){}
      // Persistir el mes en el espejo (sii_cargas_docs) + auto-enlazar. Antes 'Sincronizar' solo cotejaba en vivo y el mes
      // no quedaba guardado, dejando huecos en el cuadre con SII (p.ej. julio). Read-only sobre el SII; idempotente.
      try{ await llamar({action:'sync-ventas-rcv',periodo:mes}); await supabase.rpc('link_sii_billing') }catch(_){}
      if(data.actualizadas?.length&&onRefresh) await onRefresh()
    }catch(e){ setError(msgErr(e)) }
    setLoading(false)
  }
  // Auto-cotejo al abrir: si el mes en curso no se ha cotejado HOY, corre una vez (mismo camino que el botón; el
  // motor solo aplica calces únicos de alta confianza). Delibera la apertura del modal = intención de cotejar.
  useEffect(()=>{ try{ const k='sii_lastsync_'+mes; const prev=localStorage.getItem(k); const hoyISO=new Date().toISOString().slice(0,10); if(!prev||prev.slice(0,10)!==hoyISO){ sincronizar() } }catch(_){} },[])   // eslint-disable-line
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
  // Portal al body (igual que Modal, ver createPortal en su def): sin esto el overlay queda ATRAPADO en el contexto de apilamiento
  // del header sticky (z:10) de Facturación y el apphead (z:20) lo tapa, pese a su z:200 (body{zoom} desktop convierte a body en el contexto).
  // Página (asPage): el encabezado lo pone FlujoPagina; sin capa propia.
  const _inner = (
      <div style={asPage?{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}:{background:'#fff',maxWidth:isDesktop?960:'100%',width:'100%',margin:'0 auto',minHeight:'100%',boxShadow:isDesktop?'0 0 40px rgba(0,0,0,.06)':'none'}}>
        {!asPage&&        <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 20px',borderBottom:'0.5px solid #E4E8EB',position:'sticky',top:0,background:'#fff',zIndex:2}}>
          <button onClick={onClose} style={{border:'none',background:'none',color:C.accent,cursor:'pointer',display:'flex',alignItems:'center',gap:5,fontSize:14,fontWeight:600,padding:0}}>
            <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>
            {isDesktop&&'Volver'}
          </button>
          <span style={{fontSize:16,fontWeight:700,color:C.accent}}>Cuadrar con SII</span>
        </div>}
        <div style={{display:'flex',gap:10,padding:'14px 20px',borderBottom:'0.5px solid #E4E8EB'}}>
          <div style={{display:'flex',border:'0.5px solid #E4E8EB',borderRadius:8,overflow:'hidden',flex:1,height:36}}>
            <button onClick={()=>cambiarMes(-1)} style={{width:32,border:'none',background:'none',color:C.muted,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg></button>
            <span style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:500,color:C.text}}>{mesLabel}</span>
            <button onClick={()=>cambiarMes(1)} style={{width:32,border:'none',background:'none',color:C.muted,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='9 18 15 12 9 6'/></svg></button>
          </div>
          <button onClick={sincronizar} disabled={loading} style={{height:36,padding:'0 18px',background:loading?C.done:C.accent,color:'#fff',border:'none',borderRadius:8,fontSize:13,fontWeight:500,cursor:loading?'default':'pointer',whiteSpace:'nowrap'}}>{loading?'Consultando…':'Sincronizar'}</button>
        </div>
        {/* Sello: cuándo fue el último cotejo + cuántas programadas hay por emitir este mes en la app (foto del cotejo) */}
        {(()=>{ const porEmitir=(billing||[]).filter(b=>b.status==='Programada'&&!b.deleted_at&&String(b.due||'').startsWith(mes)); const ds=desdeTxt(lastSync); return (
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 20px',borderBottom:'0.5px solid #E4E8EB',background:C.bgSoft}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:ds?C.normal:C.done,flexShrink:0}}/>
            <span style={{fontSize:11,color:C.muted}}>{ds?`Cuadrado con el SII · ${ds}`:'Sin cuadrar aún'}</span>
            {porEmitir.length>0&&<span style={{fontSize:11,color:C.soonText,marginLeft:'auto',whiteSpace:'nowrap'}}>{porEmitir.length} por emitir este mes</span>}
          </div>
        )})()}
        {error&&<div style={{padding:'10px 20px',fontSize:12,color:C.overdue,background:C.overdueBg}}>{error}</div>}
        {result&&!loading&&(()=>{ const auto=(result.actualizadas?.length||0); const porResolver=(result.corregirFolio||[]).filter(it=>!corregidas[it.billingId]).length+(result.ambiguas||[]).filter(it=>!ambDone[it.folio]).length+(result.sinMatch||[]).filter(it=>!ingresadas[it.folio]).length; return (   /* baja a medida que resuelves en la sesión (M2) */
          <div style={{padding:'14px 20px',borderBottom:'0.5px solid #E4E8EB'}}>
            {(()=>{ const emit=result.totalSII||0; const cuad=Math.max(0,emit-porResolver); return <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div style={{border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',textAlign:'center',background:'#F3F0F8'}}>
                  <div style={{...SEC_LBL}}>Emitido en SII</div>
                  <div style={{fontSize:22,fontWeight:700,color:C.accent,marginTop:3,lineHeight:1}}>{emit}</div>
                </div>
                <div style={{border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',textAlign:'center'}}>
                  <div style={{...SEC_LBL}}>Cargado</div>
                  <div style={{fontSize:22,fontWeight:700,color:C.accent,marginTop:3,lineHeight:1}}>{cuad}</div>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div style={{borderRadius:12,padding:'10px 12px',background:porResolver>0?C.soonBg:C.bgSoft,border:`1px solid ${porResolver>0?'#F0E4B8':C.border}`}}>
                  <div style={{fontSize:9,fontWeight:700,color:porResolver>0?C.soonText:C.done,textTransform:'uppercase',letterSpacing:.3}}>Por cargar</div>
                  <div style={{fontSize:18,fontWeight:700,color:porResolver>0?C.soonText:C.done,marginTop:2,lineHeight:1}}>{porResolver}</div>
                  <div style={{fontSize:9,color:C.muted,marginTop:1}}>emitidas, sin cargar</div>
                </div>
                <div style={{borderRadius:12,padding:'10px 12px',background:C.greenBg,border:'1px solid #CFE9DD'}}>
                  <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>Cuadradas</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.greenText,marginTop:2,lineHeight:1}}>{cuad}</div>
                  <div style={{fontSize:9,color:C.greenText,marginTop:1}}>{auto>0?`${auto} se cargaron solas`:'emitido = cargado'}</div>
                </div>
              </div>
            </> })()}
          </div>
        )})()}
        {loading&&<SiiDots/>}
        {/* Ya cuadrado hoy pero sin cotejo en vivo esta sesión: evita la página vacía — muestra la foto del mes desde datos locales. */}
        {!result&&!loading&&!error&&(()=>{ const emitidasMes=(billing||[]).filter(b=>b.invoice_no&&!b.deleted_at&&b.status!=='Anulada'&&!['reembolso','nota_credito'].includes(b.billing_type||'')&&String(b.issued_at||'').startsWith(mes)).length; const porEmitir=(billing||[]).filter(b=>b.status==='Programada'&&!b.deleted_at&&String(b.due||'').startsWith(mes)).length; return (
          <div style={{padding:'44px 20px',textAlign:'center'}}>
            <div style={{width:46,height:46,borderRadius:'50%',background:C.greenBg,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:11}}><CheckVerde/></div>
            <div style={{fontSize:15,fontWeight:700,color:C.greenText}}>Cuadrado con el SII</div>
            <div style={{fontSize:12,color:C.muted,marginTop:5}}>{emitidasMes} factura{emitidasMes!==1?'s':''} de {mesLabel} cargada{emitidasMes!==1?'s':''}{porEmitir>0?` · ${porEmitir} por emitir`:''}</div>
            <button onClick={sincronizar} style={{marginTop:14,height:24,padding:'0 16px',background:'#fff',color:C.accent,border:`1px solid ${C.border}`,borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'}}>Volver a cotejar</button>
          </div>) })()}
        {result&&!loading&&<>
          {vacio
            ? <div style={{display:'flex',gap:12,padding:'16px 20px',alignItems:'center'}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:C.greenBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><CheckVerde/></div>
                <div>
                  <div style={{fontSize:13,fontWeight:500,color:C.normal}}>{mesLargo} al día</div>
                  <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>{reg.length} factura{reg.length!==1?'s':''} ya registrada{reg.length!==1?'s':''}</div>
                </div>
              </div>
            : (()=>{
                const orphans=result.sinMatch||[]
                const reco=orphans.filter(it=>resolverCliente(it.rut,it.receptor)||ingresadas[it.folio])   // reconocidas por RUT o ya asignadas a mano
                const noReco=orphans.filter(it=>!resolverCliente(it.rut,it.receptor)&&!ingresadas[it.folio])
                const nReco=reco.filter(it=>!ingresadas[it.folio]).length
                const dmy=s=>{ const x=isoFecha(s); return x?x.split('-').reverse().join('/'):'' }
                return <>
                {/* 1. Confirma el cliente — reconocidas por RUT: ves a quién va antes de asignar */}
                {reco.length>0&&<>
                  <Hdr label='Confirma el cliente' color={C.greenText} bg='#E1F5EE' border='#9FE1CB' right={nReco>1&&<button onClick={async()=>{ if(await appConfirm(`Cargar ${nReco} facturas del SII a tu facturación (cliente reconocido por RUT). ¿Seguir?`)) ingresarTodas() }} style={{height:24,padding:'0 12px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:11,fontWeight:500,cursor:'pointer'}}>Cargar las {nReco}</button>}/>
                  {reco.map((it,i)=>{ const ya=ingresadas[it.folio]; const cli=ya?null:resolverCliente(it.rut,it.receptor); const exp=recoExp.has(it.folio); return (
                    <div key={i} style={{borderBottom:'0.5px solid #E4E8EB'}}>
                      <div onClick={()=>!ya&&setRecoExp(s=>{ const n=new Set(s); n.has(it.folio)?n.delete(it.folio):n.add(it.folio); return n })} style={{display:'flex',alignItems:'center',padding:'11px 20px',cursor:ya?'default':'pointer'}}>
                        {bigDate(isoFecha(it.fechaEmision),C.muted)}
                        <div style={{minWidth:0,flex:1,marginLeft:4}}>
                          <div style={{fontSize:12,fontWeight:500,color:C.text,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||'—'}</div>
                          <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>Factura N° {it.folio} · {fmt(it.monto)}</div>
                        </div>
                        {ya
                          ? <span style={{fontSize:11,fontWeight:600,color:ya.cliente?C.greenText:C.soonText,whiteSpace:'nowrap'}}>{ya.cliente?`✓ ${ya.cliente}`:'Cargada'}</span>
                          : <span style={{fontSize:11,color:C.greenText,fontWeight:600,whiteSpace:'nowrap',flexShrink:0}}>{cli?.name} {exp?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>}
                      </div>
                      {exp&&!ya&&<div style={{padding:'2px 20px 11px',background:C.bgSoft}}>
                        <div style={{display:'flex',gap:12,padding:'4px 0 8px'}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>En el SII</div>
                            <div style={{fontSize:11,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||'—'}</div>
                            <div style={{fontSize:11,color:C.muted}}>{fmtRut(it.rut)}</div>
                            <div style={{fontSize:11,color:C.muted}}>N° {it.folio} · {fmt(it.monto)}</div>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>Se carga a</div>
                            <div style={{fontSize:11,fontWeight:600,color:onOpenClientFicha?C.accent:C.text,cursor:onOpenClientFicha?'pointer':'default',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} onClick={onOpenClientFicha?()=>{onOpenClientFicha(cli.id);onClose&&onClose()}:undefined}>{cli?.name}{onOpenClientFicha?<>{" "}<Gl n='chevron'/></>:''}</div>
                            <div style={{fontSize:11,color:C.greenText}}><Gl n='tick'/> mismo RUT</div>
                          </div>
                        </div>
                        <button onClick={()=>ingresarHuerfana(it)} disabled={ingresando===it.folio} style={{height:24,width:'100%',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:600,cursor:'pointer',opacity:ingresando===it.folio?.5:1}}>{ingresando===it.folio?'Cargando…':`Cargar a ${cli?.name}`}</button>
                      </div>}
                    </div>
                  )})}
                </>}
                {/* 2. Dime el cliente — no reconocidas: buscador inline */}
                {noReco.length>0&&<>
                  <Hdr label='Dime el cliente' color='#C77F18' bg='#FFFBF0' border='#F0E4B8'/>
                  {noReco.map((it,i)=><Fila key={i}>
                    {bigDate(isoFecha(it.fechaEmision),C.muted)}
                    <div style={{minWidth:0,marginLeft:4,flex:1}}>
                      <div style={{fontSize:12,fontWeight:500,color:C.text,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||'—'}</div>
                      <div style={{fontSize:11,color:C.textSoft,marginTop:1,marginBottom:6}}>Factura N° {it.folio}{it.rut?` · ${fmtRut(it.rut)}`:''} · {fmt(it.monto)}</div>
                      <AsignarClienteInline bill={{folio:it.folio}} clients={clients} onAssign={(_,cid)=>ingresarHuerfana(it,cid)} label='Elegir cliente' placeholder='Buscar cliente…'/>
                    </div>
                  </Fila>)}
                </>}
                {/* 3. Elige la factura — varias candidatas: comparación con lo del SII */}
                {result.ambiguas?.length>0&&<>
                  <Hdr label='Elige la factura correcta' color='#537281' bg='#EEF1F4'/>
                  {result.ambiguas.map((it,i)=>{ const exp=ambExp.has(it.folio); const done=ambDone[it.folio]; const cands=(()=>{
                        const raw=(it.candidatos||[]).filter(c=>!c.folio)
                        // EXPANDIR por venta: incluir TODAS las cuotas SIN emitir de la venta de cada candidata → para no saltar la 2/3
                        // (los candidatos del motor mezclan período+vencidas y pueden omitir la del medio). Ordenadas por N° de cuota.
                        const saleIds=new Set(raw.map(c=>{ const b=(billing||[]).find(x=>String(x.id)===String(c.id)); return b&&b.sale_id }).filter(Boolean))
                        let pool=raw
                        if(saleIds.size){ const extra=(billing||[]).filter(b=>!b.deleted_at&&saleIds.has(b.sale_id)&&!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)).map(b=>({id:b.id,cliente:(clients.find(c=>String(c.id)===String(b.client_id))||{}).name||'—',concepto:b.concept,monto:b.amount,estado:b.status})); pool=[...raw,...extra] }
                        const byId=new Map(); pool.forEach(c=>{ if(!byId.has(String(c.id))) byId.set(String(c.id),c) })
                        const cuN=c=>{ const m=String(c.concepto||'').match(/(\d+)\s*(?:\/|-|de)\s*(\d+)/); return m?+m[1]:99 }
                        const uniq=[...byId.values()].sort((a,b)=>cuN(a)-cuN(b))
                        const seen=new Map(); uniq.forEach(c=>{ const k=`${c.cliente}|${c.concepto}|${c.monto}`; if(seen.has(k)){ const s=seen.get(k); s._dups++; if(c.estado==='Programada'&&s.estado!=='Programada'){ s.id=c.id; s.estado=c.estado } } else seen.set(k,{...c,_dups:1}) })
                        const list=[...seen.values()]
                        // REGLA (FIFO): al asignar un folio del SII a una cuota, SIEMPRE la MÁS ANTIGUA sin pagar, no la del mismo mes de emisión.
                        // Las mensuales se emiten con desfase variable (mes vencido, atrasos: p.ej. "junio 26" se emitió en agosto), así que el mes
                        // de emisión NO indica la cuota; el orden de emisión sí. Se ordena por período (vencimiento, o mes del concepto) ascendente.
                        const perC=c=>{ const bb=(billing||[]).find(x=>String(x.id)===String(c.id)); if(bb&&bb.due) return String(bb.due); const p=periodoDeTexto(c.concepto||''); if(p.mes!=null){ const y=p.anio!=null?(p.anio<100?2000+p.anio:p.anio):9999; return `${y}-${String(p.mes+1).padStart(2,'0')}-01` } return '9999-12-31' }
                        list.forEach(c=>{ c._per=perC(c) })
                        list.sort((a,b)=> String(a._per).localeCompare(String(b._per)) || (cuN(a)-cuN(b)))
                        return list
                      })(); return (   /* candidatos = cuotas sin emitir de la venta, ordenadas de la MÁS ANTIGUA a la más nueva (FIFO) */
                    <div key={i} style={{borderBottom:'0.5px solid #E4E8EB'}}>
                      <div onClick={()=>!done&&setAmbExp(s=>{ const n=new Set(s); n.has(it.folio)?n.delete(it.folio):n.add(it.folio); return n })} style={{display:'flex',alignItems:'center',padding:'11px 20px',cursor:done?'default':'pointer'}}>
                        {bigDate(isoFecha(it.fechaEmision),C.muted)}
                        <div style={{minWidth:0,flex:1,marginLeft:4}}>
                          <div style={{fontSize:12,fontWeight:500,color:C.text,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||`Factura N° ${it.folio}`}</div>
                          <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>Factura N° {it.folio}{it.rut?` · ${fmtRut(it.rut)}`:''} · {fmt(it.monto)}</div>
                        </div>
                        {done ? <span style={{fontSize:11,fontWeight:500,color:C.normal,whiteSpace:'nowrap'}}>Asignada</span>
                          : <span style={{fontSize:11,color:cands.length?C.accent:C.soonText,fontWeight:600,whiteSpace:'nowrap'}}>{cands.length?`${cands.length} candidata${cands.length!==1?'s':''}`:'sin candidatas'} {exp?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>}
                      </div>
                      {exp&&!done&&<div style={{padding:'2px 20px 10px',background:C.bgSoft}}>
                        <div style={{fontSize:11,color:C.muted,padding:'7px 0',lineHeight:1.5}}><span style={{fontWeight:700,color:C.accent}}>Del SII:</span> {fmt(it.monto)} · {dmy(it.fechaEmision)}{it.rut?` · ${fmtRut(it.rut)}`:''}{it.receptor?` · ${it.receptor}`:''}</div>
                        {cands.length===0&&(()=>{ const c=resolverCliente(it.rut,it.receptor); return (   /* M1: salida real (no mandar a una sección donde el ítem no existe) */
                          <div style={{padding:'7px 0 2px',borderTop:'0.5px solid #E4E8EB'}}>
                            <div style={{fontSize:11,color:C.soonText,marginBottom:6}}>Las coincidencias ya están emitidas con su folio. Cárgala como factura nueva:</div>
                            {c
                              ? <button onClick={async()=>{ await ingresarHuerfana(it); setAmbDone(p=>({...p,[it.folio]:c.name})) }} disabled={ambBusy===it.folio||ingresando===it.folio} style={{height:24,padding:'0 13px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:11,fontWeight:600,cursor:'pointer',opacity:(ingresando===it.folio)?.5:1}}>Cargar a {c.name}</button>
                              : <AsignarClienteInline bill={{folio:it.folio}} clients={clients} onAssign={async(_,cid)=>{ await ingresarHuerfana(it,cid); const cc=clients.find(x=>String(x.id)===String(cid)); setAmbDone(p=>({...p,[it.folio]:cc?.name||'—'})) }} label='Elegir cliente' placeholder='Buscar cliente…'/>}
                          </div>
                        ) })()}
                        {(()=>{ const showAll=ambShowAll.has(it.folio); const visibles=(cands.length>1&&!showAll)?cands.slice(0,1):cands; return (<>
                          {cands.length>1&&!showAll&&<div style={{fontSize:11,color:C.greenText,padding:'5px 0',lineHeight:1.4}}>Se propone la cuota <b>más antigua sin pagar</b> (las facturas se emiten en orden, mes vencido). Revisa antes de asignar.</div>}
                          {visibles.map((cand,j)=>{ const exacto=Number(cand.monto)===Number(it.monto); const primera=cand===cands[0]; return (
                          <div key={j} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderTop:'0.5px solid #E4E8EB'}}>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cand.cliente}</div>
                              <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cand.concepto||'—'} · {cand.estado}{cand.folio?` · N° ${cand.folio}`:''}{cand._dups>1?` · ${cand._dups} programadas iguales`:''}</div>
                            </div>
                            <div style={{textAlign:'right',flexShrink:0}}>
                              <div style={{fontSize:12,fontWeight:600,color:exacto?C.greenText:C.muted,whiteSpace:'nowrap'}}>{fmt(cand.monto)}</div>
                              {primera&&<div style={{fontSize:9,fontWeight:700,color:C.greenText}}>Más antigua sin pagar</div>}
                            </div>
                            <button onClick={()=>elegirAmbigua(it,cand)} disabled={ambBusy===it.folio} style={{height:24,padding:'0 13px',borderRadius:8,background:primera?C.accent:'#fff',color:primera?'#fff':C.accent,border:primera?'none':`1px solid ${C.border}`,fontSize:11,fontWeight:600,cursor:'pointer',flexShrink:0,opacity:ambBusy===it.folio?.5:1}}>{ambBusy===it.folio?'…':'Elegir'}</button>
                          </div>
                          )})}
                          {cands.length>1&&<button onClick={()=>setAmbShowAll(s=>{ const n=new Set(s); n.has(it.folio)?n.delete(it.folio):n.add(it.folio); return n })} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',padding:'6px 0',textDecoration:'underline'}}>{showAll?'Ver solo la más antigua':`Ver todas las cuotas (${cands.length})`}</button>}
                        </>) })()}
                      </div>}
                    </div>
                  )})}
                </>}
                {/* 4. Ponerle el folio del SII a una factura que está en tu sistema SIN número — comparación En el SII ↔ Tu factura */}
                {result.corregirFolio?.length>0&&<>
                  <Hdr label='Ponerle el folio del SII' color={C.accent} bg='#EEF4F7'/>
                  {result.corregirFolio.map((it,i)=>{ const ya=corregidas[it.billingId]; const exp=corrExp.has(it.billingId); return (
                    <div key={i} style={{borderBottom:'0.5px solid #E4E8EB'}}>
                      <div onClick={()=>!ya&&setCorrExp(s=>{ const n=new Set(s); n.has(it.billingId)?n.delete(it.billingId):n.add(it.billingId); return n })} style={{display:'flex',alignItems:'center',padding:'11px 20px',cursor:ya?'default':'pointer'}}>
                        {bigDate(isoFecha(it.fechaEmision),C.muted)}
                        <div style={{minWidth:0,flex:1,marginLeft:4}}>
                          <div style={{fontSize:12,fontWeight:500,color:C.text,textTransform:'uppercase',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor||it.cliente||'—'}</div>
                          <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>Tu factura {it.folioActual?`N° ${it.folioActual}`:'sin folio'} · {fmt(it.montoApp||it.monto)}</div>
                        </div>
                        {ya?<span style={{fontSize:11,fontWeight:600,color:C.greenText,whiteSpace:'nowrap'}}><Gl n='tick'/> N° {it.folio}</span>:<span style={{fontSize:11,color:C.accent,fontWeight:600,whiteSpace:'nowrap',flexShrink:0}}>N° {it.folio} {exp?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>}
                      </div>
                      {exp&&!ya&&<div style={{padding:'2px 20px 11px',background:C.bgSoft}}>
                        <div style={{display:'flex',gap:12,padding:'4px 0 8px'}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>En el SII</div>
                            <div style={{fontSize:12,fontWeight:600,color:C.text}}>N° {it.folio} · {fmt(it.monto)}</div>
                            <div style={{fontSize:11,color:C.muted}}>{dmy(it.fechaEmision)}{it.rut?` · ${fmtRut(it.rut)}`:''}</div>
                            {it.receptor&&<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.receptor}</div>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.3,marginBottom:2}}>Tu factura</div>
                            <div style={{fontSize:12,fontWeight:600,color:C.text}}>{it.folioActual?`N° ${it.folioActual}`:'sin folio'} · {fmt(it.montoApp||it.monto)}</div>
                            <div style={{fontSize:11,color:C.muted}}>{it.estado||'—'}</div>
                            {it.concepto&&<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.concepto}</div>}
                          </div>
                        </div>
                        <button onClick={()=>aplicarCorreccion(it)} disabled={corrigiendo===it.billingId} style={{height:24,width:'100%',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:600,cursor:'pointer',opacity:corrigiendo===it.billingId?.5:1}}>{corrigiendo===it.billingId?'…':(it.folioActual?`Cambiar el folio a N° ${it.folio}`:`Poner el folio N° ${it.folio} a tu factura`)}</button>
                      </div>}
                    </div>
                  ) })}
                </>}
                {/* 5. Se cargaron solas (automático) — colapsado */}
                {result.actualizadas?.length>0&&<>
                  <div onClick={()=>setAutoOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 20px',cursor:'pointer',borderBottom:autoOpen?'0.5px solid #E4E8EB':'none'}}>
                    <span style={{fontSize:11,fontWeight:600,color:C.greenText,textTransform:'uppercase',letterSpacing:'0.05em'}}>Se cargaron solas · {result.actualizadas.length}</span>
                    <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{transform:autoOpen?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points='6 9 12 15 18 9'/></svg>
                  </div>
                  {autoOpen&&result.actualizadas.map((it,i)=><Fila key={i}>{bigDate(isoFecha(it.fechaEmision),C.normal)}<div style={{minWidth:0,flex:1,marginLeft:4}}><div style={{fontSize:12,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.cliente}</div><div style={{fontSize:11,color:C.textSoft,marginTop:1}}>Factura N° {it.folio}</div></div><span style={{fontSize:13,fontWeight:500,color:C.text,marginLeft:'auto',marginRight:8,whiteSpace:'nowrap'}}>{fmt(it.monto)}</span><CheckVerde/></Fila>)}
                </>}
                {result.errores?.length>0&&<>
                  <Hdr label='Errores' color={C.overdue} bg='#FCEBEB'/>
                  {result.errores.map((it,i)=><Fila key={i}><span style={{fontSize:12,color:C.text}}>Factura N° {it.folio}</span><span style={{fontSize:11,color:C.overdue,marginLeft:'auto'}}>{it.error}</span></Fila>)}
                </>}
                </>
              })()}
          {reg.length>0&&<>
            <div onClick={()=>setYaOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 20px',cursor:'pointer'}}>
              <span style={{fontSize:11,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:'0.05em'}}>Ya registradas</span>
              <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{transform:yaOpen?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points='6 9 12 15 18 9'/></svg>
            </div>
            {yaOpen&&reg.map((it,i)=>{ const cli=resolverCliente(it.rut,it.receptor); return (
              <div key={i} style={{padding:'10px 20px',borderBottom:'0.5px solid #E4E8EB',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cli?.name||it.receptor||'—'}</div>
                  <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>{it.receptor||''}{it.rut?` · ${fmtRut(it.rut)}`:''}</div>
                  <div style={{fontSize:11,color:C.textSoft}}>Factura N° {it.folio}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
                  <span style={{fontSize:12,fontWeight:500,color:C.muted,whiteSpace:'nowrap'}}>{fmt(it.monto)}</span>
                  <CheckVerde/>
                </div>
              </div>
            )})}
          </>}
        </>}
      </div>
  )
  return asPage ? _inner : createPortal(
    <div style={{position:'fixed',top:0,right:0,bottom:0,left:isDesktop?212:0,background:C.bg,zIndex:200,overflowY:'auto'}}>{_inner}</div>
  , document.body)
}

// Confirmación DETALLADA de "depurar cobradas": lista cada factura saldada (cliente, folio, monto, estado,
// emisión, pago y por qué quedó en $0), clickeable a la factura, con selección individual antes de marcar pagadas.
export function DepurarCobradasModal({rows=[], clients=[], respaldoMap={}, onOpenFactura, onConfirm, onClose}){
  const [sel,setSel] = useState(()=>new Set(rows.map(r=>r.id)))
  const toggle = id => setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const cn = id => (clients||[]).find(c=>String(c.id)===String(id))?.name || '—'
  const fdmy = d => d ? fmtFechaDMY(d) : '—'
  const fpago = b => b.paid_at||b.payment_date||b.reconciled_at||null
  const evidencia = b => { const resp=respaldoMap[b.id]||0, ab=b.paid_amount||0; if(resp>=(b.amount||0)&&resp>0) return `Conciliada con el banco · ${fmt(resp)}`; if(ab>0) return `Abonos imputados · ${fmt(ab)}`; return 'Saldo $0 (sin movimiento)' }
  const selRows = rows.filter(r=>sel.has(r.id))
  const totalSel = selRows.reduce((a,r)=>a+(r.amount||0),0)
  return (<>
    <div style={{fontSize:12,color:C.muted,marginBottom:10,lineHeight:1.4}}>{rows.length} factura{rows.length!==1?'s':''} con saldo $0 sigue{rows.length!==1?'n':''} marcada{rows.length!==1?'s':''} vencida/pendiente. Revisa y elige cuáles marcar como pagadas. Toca una para verla.</div>
    <div style={{maxHeight:'50vh',overflowY:'auto',margin:'0 -2px'}}>
      {rows.map((b,i)=>{ const on=sel.has(b.id); const venc=b.status==='Vencido'; return (
        <div key={b.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'11px 2px',borderTop:i?`1px solid ${C.border}`:'none'}}>
          <span onClick={()=>toggle(b.id)} style={{width:20,height:20,borderRadius:6,flexShrink:0,marginTop:1,cursor:'pointer',background:on?C.normal:'#fff',border:on?'none':`1.5px solid ${C.done}`,display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12,fontWeight:700}}>{on?<Gl n='tick'/>:''}</span>
          <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{flex:1,minWidth:0,cursor:'pointer'}}>
            <div style={{...NOMBRE_CLI}}>{cn(b.client_id)} <span style={{fontSize:11,color:C.textSoft,fontWeight:500}}>· Factura N° {folioN(b.invoice_no)}</span></div>
            <div style={{fontSize:11,color:C.greenText,marginTop:2,display:'flex',alignItems:'center',gap:5}}><span style={{width:6,height:6,borderRadius:'50%',background:C.normal,flexShrink:0}}/>{evidencia(b)}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:3}}>Emitida {fdmy(b.issued_at)} · Pago {fdmy(fpago(b))}</div>
          </div>
          <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{textAlign:'right',flexShrink:0,cursor:'pointer'}}>
            <div style={{fontSize:14,fontWeight:800,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount)}</div>
            <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',marginTop:3,display:'inline-block',background:venc?C.overdueBg:C.soonBg,color:venc?C.overdueText:C.soonText,whiteSpace:'nowrap'}}>{venc?'Vencida':'Pendiente'}</span>
            <div style={{fontSize:10,color:C.accent,fontWeight:600,marginTop:2}}>ver <Gl n='chevron'/></div>
          </div>
        </div>
      )})}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8,marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
      <span style={{fontSize:10,color:C.grisText,marginRight:'auto'}}>Reversible · Deshacer</span>
      <button onClick={onClose} style={{fontSize:13,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 14px',cursor:'pointer'}}>Cancelar</button>
      <button disabled={!selRows.length} onClick={()=>onConfirm(selRows)} style={{fontSize:13,fontWeight:700,color:'#fff',background:selRows.length?C.normal:C.done,border:'none',borderRadius:10,padding:'9px 15px',cursor:selRows.length?'pointer':'default'}}>Marcar {selRows.length} pagada{selRows.length!==1?'s':''} · {fmtShort(totalSel)}</button>
    </div>
  </>)
}

// ─── CIERRE DE MES ────────────────────────────────────────────────────────────
// Vista viva (sin tabla nueva): cruza las facturas realmente emitidas del mes con la conciliación
// bancaria (esté o no realizada). Reusa el matcher read-only `pagosDe` (RUT + monto exacto) y el
// `respaldoMap` (conciliación formal). Permite navegar cualquier mes pasado y comparar la tendencia.
export const CIERRE_EST = {
  cobrada:   { label:'Pagada',        color:C.greenText,   bg:C.greenBg,   dot:C.normal },
  detectado: { label:'Por conciliar', color:C.soonText,    bg:C.soonBg,    dot:C.soon },
  sinpago:   { label:'Por cobrar',    color:C.overdueText, bg:C.overdueBg, dot:C.overdue },
  porcobrar: { label:'Por cobrar',    color:C.accent,      bg:C.azulBg,    dot:C.accent },   // pseudo-filtro: detectado + sinpago (todo lo que tiene saldo)
}

export function CierreMesModal({ billing=[], clients=[], sales=[], respaldoMap={}, abonos=[], pagosDe, onConciliarPago, onRecordar, onRecordarTanda, recordadoMap={}, diasDesde, onOpenClientFicha, onOpenFactura, onOpenConciliacion, mesInicial }) {
  const MESNOM=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const hoyKey = new Date().toISOString().slice(0,7)
  const hoyISO = new Date().toISOString().slice(0,10)
  // El cierre por defecto es el MES ANTERIOR: es el que ya cerramos (facturas emitidas) y donde deben reflejarse los pagos. En agosto → julio.
  const prevKey = (()=>{ const n=new Date(); const p=new Date(n.getFullYear(),n.getMonth()-1,1); return `${p.getFullYear()}-${String(p.getMonth()+1).padStart(2,'0')}` })()
  const [mes,setMes] = useState(mesInicial && /^\d{4}-\d{2}$/.test(mesInicial) ? mesInicial : prevKey)
  const [modo,setModo] = useState('mes')      // 'mes' | 'acum' (acumulado del año hasta el mes elegido)
  const [resp,setResp] = useState(null)       // abogado responsable (null = todos)
  const [estFiltro,setEstFiltro] = useState('porcobrar')   // tarjeta-acordeón activa: 'porcobrar' | 'cobrada' | 'vencido' | 'sinid' | null
  const [expand,setExpand] = useState(null)   // factura.id con detalle abierto
  const [busyId,setBusyId] = useState(null)
  const [sinIdOpen,setSinIdOpen] = useState(false)   // banner "pagos sin identificar" desplegado
  const [grpOpen,setGrpOpen] = useState({})   // acordeón por cliente en la lista (key = client_id)
  const isDesktop = useIsDesktop()   // escritorio: 2 columnas (resumen + tendencia) y la lista como tabla ancha

  const respBySale = useMemo(()=>Object.fromEntries((sales||[]).map(s=>[String(s.id),s.responsible||null])),[sales])
  const respByClient = useMemo(()=>Object.fromEntries((clients||[]).map(c=>[String(c.id),c.abogado_responsable||null])),[clients])
  const respDe = b => (b.sale_id&&respBySale[String(b.sale_id)])||respByClient[String(b.client_id)]||null
  const esEmit = b => !!(b.invoice_no||b.folio)
  const emisKey = b => String(b.issued_at||b.date||b.created_at||'').slice(0,7)
  const clientNom = id => (clients.find(c=>String(c.id)===String(id))?.name)||'Sin cliente'

  const emitidasAll = useMemo(()=> (billing||[]).filter(b=>!b.deleted_at && esEmit(b) && b.status!=='Anulada' && b.billing_type!=='reembolso'), [billing])
  const respList = useMemo(()=>{ const s=new Set(); emitidasAll.forEach(b=>{ const r=respDe(b); if(r) s.add(r) }); return [...s].sort((a,b)=>a.localeCompare(b,'es')) },[emitidasAll,respBySale,respByClient])

  // Cifras consistentes: monto = verdad del DTE; abonado = lo respaldado en banco o el pago registrado; saldo = monto − abonado.
  const abonadoDe = b => Math.max(Number(b.paid_amount)||0, Number(respaldoMap[b.id])||0)
  const montoDe = b => montoFactura(b)
  const saldoDe = saldoBill   // fuente única (idéntico: montoFactura − max(paid_amount, respaldo); respaldoMap puebla _respaldoCache)
  const tieneRespaldo = b => (Number(respaldoMap[b.id])||0) >= montoDe(b)*0.99

  const mesYear = mes.slice(0,4)
  const enPeriodo = k => modo==='mes' ? k===mes : (!!k && k.slice(0,4)===mesYear && k<=mes)

  const filas = useMemo(()=> emitidasAll
    .filter(b=> enPeriodo(emisKey(b)) && (!resp || respDe(b)===resp))
    .map(b=>{ const monto=montoDe(b), saldo=saldoDe(b), cobrado=Math.max(0,monto-saldo)
      let est; if(saldo<=0) est='cobrada'; else { const pg=pagosDe?pagosDe(b):[]; est=(pg&&pg.length>0)?'detectado':'sinpago' }
      return {b, monto, saldo, cobrado, est, resp:respDe(b), pagos: est==='detectado'&&pagosDe?pagosDe(b):[]} })
    .sort((a,z)=> (a.est==='detectado'?0:a.est==='sinpago'?1:2)-(z.est==='detectado'?0:z.est==='sinpago'?1:2) || z.monto-a.monto)
  , [emitidasAll, mes, modo, resp, respaldoMap, abonos])   // eslint-disable-line

  const tot = useMemo(()=>{ let emi=0,cob=0,pen=0,nC=0,nD=0,nS=0,mC=0,mD=0,mS=0,nV=0,mV=0
    filas.forEach(f=>{ emi+=f.monto; cob+=f.cobrado; pen+=f.saldo
      if(f.est==='cobrada'){nC++;mC+=f.monto} else if(f.est==='detectado'){nD++;mD+=f.saldo} else {nS++;mS+=f.saldo}
      if(f.saldo>0 && f.b.due && f.b.due<hoyISO){nV++;mV+=f.saldo} })   // Vencido = subconjunto de Por cobrar (anidado en la foto)
    return {emi,cob,pen,tasa:emi>0?cob/emi:0,nC,nD,nS,mC,mD,mS,nV,mV} },[filas])

  // Pagos del banco del período que no calzan con ninguna factura pendiente → plata recibida sin identificar.
  const matchedAbonos = useMemo(()=>{ const s=new Set(); emitidasAll.forEach(b=>{ if(saldoDe(b)>0){ (pagosDe?pagosDe(b):[]).forEach(({m})=>s.add(String(m.id))) } }); return s },[emitidasAll,abonos,respaldoMap])   // eslint-disable-line
  const sinIdentificar = useMemo(()=> (abonos||[]).filter(m=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); return m.estado!=='conciliado' && resto>0 && enPeriodo(String(m.fecha||'').slice(0,7)) && !matchedAbonos.has(String(m.id)) }), [abonos,matchedAbonos,mes,modo])   // eslint-disable-line
  const totSinId = sinIdentificar.reduce((a,m)=>a+((m.monto||0)-(m.monto_conciliado||0)),0)

  // Tendencia: tasa de cobro de los últimos 6 meses (para comparar).
  const trend = useMemo(()=>{ const out=[]; const [y,m]=mes.split('-').map(Number)
    for(let i=5;i>=0;i--){ let yy=y, mm=m-i; while(mm<=0){mm+=12;yy--}; const k=`${yy}-${String(mm).padStart(2,'0')}`
      const fs=emitidasAll.filter(b=> emisKey(b)===k && (!resp||respDe(b)===resp))
      const emi=fs.reduce((a,b)=>a+montoDe(b),0), cob=fs.reduce((a,b)=>a+Math.max(0,montoDe(b)-saldoDe(b)),0)
      out.push({k, mesN:MESNOM[mm-1].slice(0,3), emi, cob, pen:emi-cob, tasa:emi>0?cob/emi:0, act:k===mes}) }
    return out }, [mes,emitidasAll,resp,respaldoMap])   // eslint-disable-line
  const prev=trend[4], cur=trend[5]

  const shiftMes = d => { const [y,m]=mes.split('-').map(Number); let mm=m+d, yy=y; while(mm<=0){mm+=12;yy--} while(mm>12){mm-=12;yy++}; setMes(`${yy}-${String(mm).padStart(2,'0')}`); setExpand(null) }   // mantiene la tarjeta activa (estFiltro) al cambiar de mes: sin resetearla, la lista persiste y el ancho no colapsa
  const mesLabel = `${MESNOM[+mes.slice(5,7)-1]} ${mes.slice(0,4)}`
  const pct = x => `${Math.round(x*100)}%`
  const deltaTxt = (a,b)=>{ if(!b) return a>0?'nuevo':''; const d=Math.round((a-b)/b*100); return <><Gl n={d>=0?'arrowUp':'arrowDown'}/> {Math.abs(d)}%</> }
  const deltaCol = (a,b,inv)=>{ if(a===b) return C.done; const up=a>b; return (inv?!up:up)?C.greenText:C.overdueText }

  const visibles = estFiltro==='porcobrar' ? filas.filter(f=>f.est==='detectado'||f.est==='sinpago')
    : estFiltro==='vencido' ? filas.filter(f=>f.saldo>0&&f.b.due&&f.b.due<hoyISO)
    : (estFiltro ? filas.filter(f=>f.est===estFiltro) : filas)
  const vencidasSinPago = filas.filter(f=>f.est==='sinpago' && f.b.due && f.b.due < hoyISO)
  const puedeSig = mes < hoyKey

  const enlazar = async(f)=>{ if(busyId||!f.pagos.length) return; setBusyId(f.b.id); try{ await onConciliarPago(f.pagos[0].m, f.b) }catch(_){}; setBusyId(null); setExpand(null) }


  const dfmt = d => { const s=fmtDate(d); return s||'—' }

  return (<div style={{width:'100%',maxWidth:isDesktop?1100:660,margin:'0 auto'}}>
    {/* Navegador de mes + modo */}
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
      <div style={{display:'flex',alignItems:'center',gap:6,flex:1}}>
        <button onClick={()=>shiftMes(-1)} style={{width:30,height:30,borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:16,cursor:'pointer',lineHeight:1}}><Gl n='chevL'/></button>
        <div style={{fontSize:16,fontWeight:800,color:C.accent,minWidth:0}}>{mesLabel}</div>
        <button onClick={()=>puedeSig&&shiftMes(1)} disabled={!puedeSig} style={{width:30,height:30,borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:puedeSig?C.muted:C.border,fontSize:16,cursor:puedeSig?'pointer':'default',lineHeight:1}}><Gl n='chevron'/></button>
      </div>
      <div style={{display:'flex',background:C.bgSoft,borderRadius:10,padding:2}}>
        {[['mes','Mes'],['acum','Acumulado']].map(([v,l])=><button key={v} onClick={()=>setModo(v)} style={{fontSize:12,fontWeight:700,padding:'5px 11px',borderRadius:8,border:'none',cursor:'pointer',background:modo===v?'#fff':'transparent',color:modo===v?C.accent:C.muted,boxShadow:modo===v?'0 1px 2px rgba(0,0,0,.06)':'none'}}>{l}</button>)}
      </div>
    </div>

    {/* Filtro por abogado responsable */}
    {respList.length>1&&<div style={{display:'flex',gap:5,overflowX:'auto',marginBottom:10,paddingBottom:2}}>
      {[[null,'Todos'],...respList.map(r=>[r,r])].map(([v,l])=>{ const on=resp===v; const pc=v?personChip(v):null
        return <button key={v||'all'} onClick={()=>setResp(v)} style={{flexShrink:0,fontSize:11,fontWeight:600,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`1px solid ${on?(pc?pc.color:C.accent):C.border}`,background:on?(pc?pc.bg:C.azulBg):'#fff',color:on?(pc?pc.color:C.accent):C.muted,whiteSpace:'nowrap'}}>{l}</button> })}
    </div>}

    {/* Emitido (hero) + 4 tarjetas-acordeón: Pagado · Por cobrar · Sin identificar · Vencidas. Al tocar una se despliega SU listado abajo (estFiltro). Wording unificado: Pagado / Por cobrar (facturas del cliente = plata que entra). */}
    <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:9}}>
      <div style={{...SEC_LBL}}>{modo==='mes'?`Emitido · ${mesLabel}`:`Emitido acumulado ${mesYear} (a ${MESNOM[+mes.slice(5,7)-1].toLowerCase()})`}</div>
      <div style={{display:'flex',alignItems:'baseline',gap:9,marginTop:4}}><div style={{fontSize:25,fontWeight:800,color:C.accent,letterSpacing:-.6}}>{fmt(tot.emi)}</div><div style={{fontSize:11,color:C.muted,fontWeight:600}}>{filas.length} factura{filas.length!==1?'s':''}</div></div>
    </div>
    {(()=>{
      const card=(k,ic,icC,bg,lbl,n,nC,sub)=>{ const active=estFiltro===k; return (
        <div onClick={()=>setEstFiltro(active?null:k)} style={{background:'#fff',border:`1px solid ${active?C.accent:C.border}`,boxShadow:active?`0 0 0 1px ${C.accent}`:'none',borderRadius:12,padding:'10px 12px',cursor:'pointer'}}>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <span style={{width:28,height:28,borderRadius:8,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={ic} s={16} c={icC}/></span>
            <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:icC,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{lbl}</span>
            <span style={{marginLeft:'auto',color:C.textSoft,fontSize:12,transform:active?'rotate(90deg)':'none',transition:'transform .12s'}}><Gl n='chevron'/></span>
          </div>
          <div style={{fontSize:17,fontWeight:800,letterSpacing:-.3,color:nC,marginTop:6,fontVariantNumeric:'tabular-nums'}}>{n}</div>
          <div style={{fontSize:9,color:C.textSoft,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
        </div>) }
      return (<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:9}}>
        {card('cobrada','check',C.greenText,C.greenBg,'Pagado',fmt(tot.cob),C.greenText,`${tot.nC} factura${tot.nC!==1?'s':''} · ${pct(tot.tasa)}`)}
        {card('porcobrar','file',C.accent,C.azulBg,'Por cobrar',fmt(tot.pen),C.accent,`${tot.nD+tot.nS} facturas`)}
        {card('sinid','exchange',C.soonText,C.ambarBg,'Sin identificar',fmt(totSinId),C.soonText,`${sinIdentificar.length} pago${sinIdentificar.length!==1?'s':''} del banco`)}
        {card('vencido','alert',C.overdueText,C.overdueBg,'Vencidas',String(tot.nV),C.overdueText,`${fmtShort(tot.mV)} · recordar`)}
      </div>)
    })()}

    {/* Panel de "Sin identificar": abonos del banco sin cruzar (se muestra al tocar esa tarjeta) */}
    {estFiltro==='sinid'&&<div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:9}}>
      {sinIdentificar.length===0
        ? <div style={{fontSize:12,color:C.muted,padding:'16px',textAlign:'center'}}>Sin pagos del banco por identificar.</div>
        : <div style={{padding:'8px 12px',display:'flex',flexDirection:'column',gap:6}}>
            {sinIdentificar.slice(0,12).map(m=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); return (
              <div key={m.id} style={{borderTop:`1px solid ${C.bgSoft}`,paddingTop:6}}>
                <div style={{fontSize:13,fontWeight:700,color:C.greenText}}>+{fmt(resto)} <span style={{color:C.textSoft,fontWeight:400,fontSize:10}}>· {fmtDate(m.fecha)}</span></div>
                <div style={{fontSize:11,color:C.text,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.nombre_contraparte||'Sin remitente en la glosa'}{m.rut_contraparte?` · ${m.rut_contraparte}`:''}</div>
              </div>) })}
            {sinIdentificar.length>12&&<div style={{fontSize:10,color:C.soonText,textAlign:'center'}}>Y {sinIdentificar.length-12} más</div>}
            {onOpenConciliacion&&<button onClick={onOpenConciliacion} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.done}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',alignSelf:'center',marginTop:2}}>Revisar en Conciliación <Gl n='chevron'/></button>}
          </div>}
    </div>}

    {/* Tanda de recordatorios: sobre la lista de vencidas */}
    {estFiltro==='vencido'&&vencidasSinPago.length>0&&onRecordarTanda&&<div style={{display:'flex',alignItems:'center',gap:9,background:C.overdueBg,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
      <div style={{flex:1,fontSize:12,fontWeight:600,color:C.overdueText}}>{vencidasSinPago.length} vencida{vencidasSinPago.length!==1?'s':''} sin pago</div>
      <button onClick={()=>onRecordarTanda(vencidasSinPago.map(f=>f.b))} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.done}`,borderRadius:8,padding:'6px 12px',cursor:'pointer',flexShrink:0}}>Recordar a {vencidasSinPago.length} <Gl n='chevron'/></button>
    </div>}

    {/* Lista de facturas: solo cuando hay una tarjeta de facturas activa (no sinid, no null) */}
    {estFiltro&&estFiltro!=='sinid'&&(()=>{
      const emptyEl = <div style={{textAlign:'center',color:C.muted,fontSize:13,padding:'22px 0'}}>No hay facturas emitidas {modo==='mes'?`en ${mesLabel.toLowerCase()}`:`en ${mesYear}`}{resp?` de ${resp}`:''}.</div>
      const filaEl = (f,inGroup)=>{ const e=CIERRE_EST[f.est]; const abierto=expand===f.b.id; const rd=diasDesde?diasDesde(recordadoMap[String(f.b.id)]):null; const rec=rd!=null&&rd<=2
        const dep=f.est==='detectado'&&f.pagos[0]?f.pagos[0].m:null; const depMonto=dep?((dep.monto||0)-(dep.monto_conciliado||0)):0
        const rn=r=>String(r||'').replace(/[.\s-]/g,'').toUpperCase(); const rutMatch=!!(dep&&f.b.receptor_rut&&dep.rut_contraparte&&rn(dep.rut_contraparte)===rn(f.b.receptor_rut)); const montoExacto=!!(dep&&depMonto===f.monto)
        const mult=(f.pagos||[]).length>1
        // Conciliar en un toque (el motor al revés): aparece SOLO si el banco tiene un abono que calza, y NO cuando el detalle está abierto (ahí ya se ve la comparación completa). Un toque → conciliarPago, que muestra TODO y confirma antes de aplicar.
        const sugInline = dep&&!abierto ? (
          <div onClick={ev=>ev.stopPropagation()} style={{display:'flex',alignItems:'center',gap:10,background:C.greenBg,border:'1px solid #CFE9DD',borderRadius:10,padding:'7px 11px',margin:isDesktop?'0 14px 9px':'8px 9px 9px'}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,letterSpacing:.3}}>PAGO DEL BANCO QUE CALZA{rutMatch?' · MISMO RUT':montoExacto?' · MISMO MONTO':''}</div><div style={{fontSize:12,color:C.text,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{fmtDate(dep.fecha)} · <b>{fmt(depMonto)}</b>{dep.nombre_contraparte?` · ${dep.nombre_contraparte}`:''}{mult?` · +${f.pagos.length-1} más`:dep.n_operacion?` · Op ${dep.n_operacion}`:''}</div></div>
            <button onClick={()=>mult?setExpand(f.b.id):enlazar(f)} disabled={busyId===f.b.id} style={{fontSize:12,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'7px 15px',cursor:busyId===f.b.id?'default':'pointer',flexShrink:0,opacity:busyId===f.b.id?.6:1}}>{busyId===f.b.id?'Conciliando…':mult?`Ver ${f.pagos.length}`:'Conciliar'}</button>
          </div>) : null
        // Detalle expandible — idéntico en móvil y escritorio (fechas + calce del depósito + acciones).
        const detalleInner = (<>
            <div style={{display:'flex',flexWrap:'wrap',gap:'2px 14px',fontSize:11,color:C.muted,margin:'8px 0 9px'}}>
              <span>Emitida <span style={{color:C.text,fontWeight:600}}>{dfmt(f.b.issued_at)}</span></span>
              <span>Enviada {f.b.email_sent_at?<span style={{color:C.text,fontWeight:600}}>{dfmt(f.b.email_sent_at)}</span>:'—'}</span>
              <span>Pagada {(f.b.paid_at||f.b.payment_date)?<span style={{color:C.text,fontWeight:600}}>{dfmt(f.b.paid_at||f.b.payment_date)}</span>:'—'}</span>
            </div>
            {f.est==='detectado'&&dep&&<div style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:9}}>
              <div style={{display:'flex'}}>
                <div style={{flex:1,padding:'8px 10px'}}><div style={{...SEC_LBL}}>El depósito</div><div style={{fontSize:13,fontWeight:700,color:C.greenText,marginTop:1}}>+{fmt(depMonto)}</div><div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmtDate(dep.fecha)}{dep.nombre_contraparte?` · ${dep.nombre_contraparte}`:''}</div></div>
                <div style={{flex:1,padding:'8px 10px',borderLeft:`1px solid ${C.bgSoft}`}}><div style={{...SEC_LBL}}>La factura</div><div style={{fontSize:13,fontWeight:700,color:C.accent,marginTop:1}}>N° {folioN(f.b.invoice_no)||'—'}</div><div style={{fontSize:10,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmt(f.monto)}{f.b.concept?` · ${f.b.concept}`:''}</div></div>
              </div>
              {(rutMatch||montoExacto)&&<div style={{display:'flex',gap:12,padding:'6px 10px',background:C.bgSoft}}>{rutMatch&&<span style={{fontSize:10,color:C.greenText}}><Gl n='tick'/> Mismo RUT</span>}{montoExacto&&<span style={{fontSize:10,color:C.greenText}}><Gl n='tick'/> Monto exacto</span>}</div>}
            </div>}
            {f.saldo>0&&f.est!=='detectado'&&<div style={{fontSize:11,color:C.muted,marginBottom:8}}>Saldo por cobrar <span style={{color:C.overdueText,fontWeight:600}}>{fmt(f.saldo)}</span></div>}
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {f.est==='detectado'&&<button onClick={()=>enlazar(f)} disabled={busyId===f.b.id} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 16px',cursor:'pointer',opacity:busyId===f.b.id?.6:1}}>{busyId===f.b.id?'Conciliando…':'Conciliar'}</button>}
              {f.est==='sinpago'&&onRecordar&&<button onClick={()=>onRecordar(f.b)} style={{fontSize:11,fontWeight:600,color:rec?C.done:C.accent,background:'#fff',border:`1px solid ${rec?C.border:C.done}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>{rec?<>Recordado{" "}<Gl n='tick'/></>:<>Recordar cobro{" "}<Gl n='chevron'/></>}</button>}
              <button onClick={()=>onOpenFactura&&onOpenFactura(f.b)} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Abrir factura <Gl n='chevron'/></button>
            </div>
        </>)
        if(isDesktop) return (
          <div key={f.b.id} style={{borderBottom:`1px solid ${C.bgSoft}`}}>
            <div onClick={()=>setExpand(abierto?null:f.b.id)} style={{display:'grid',gridTemplateColumns:inGroup?'1fr 96px 104px 104px 104px 92px':'1fr 58px 96px 104px 104px 104px 92px',gap:10,alignItems:'center',padding:'10px 14px',cursor:'pointer'}}>
              {inGroup
                ? <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>N° {folioN(f.b.invoice_no)||folioN(f.b.folio)}</div>{f.b.concept&&<div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{f.b.concept}</div>}</div>
                : <>
                    <div onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(f.b.client_id)}} style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer',minWidth:0}}>{clientNom(f.b.client_id)}</div>
                    <span style={{fontSize:11,color:C.muted}}>{folioN(f.b.invoice_no)||folioN(f.b.folio)}</span>
                  </>}
              <span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.resp||'—'}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.text,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(f.monto)}</span>
              <span style={{fontSize:12,fontWeight:600,color:f.cobrado>0?C.greenText:C.done,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{f.cobrado>0?fmt(f.cobrado):'—'}</span>
              <span style={{fontSize:13,fontWeight:700,color:f.saldo>0?C.text:C.greenText,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{f.saldo>0?fmt(f.saldo):'$0'}</span>
              <span style={{textAlign:'right'}}><span style={{fontSize:9.5,fontWeight:700,color:e.color,background:e.bg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{e.label}</span></span>
            </div>
            {sugInline}
            {abierto&&<div style={{padding:'0 14px 12px 17px'}}>{detalleInner}</div>}
          </div>
        )
        return (
          <div key={f.b.id} style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            <div onClick={()=>setExpand(abierto?null:f.b.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 11px',cursor:'pointer'}}>
              <div style={{flex:1,minWidth:0}}>
                {inGroup
                  ? <><div style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>N° {folioN(f.b.invoice_no)||folioN(f.b.folio)}</div>{f.b.concept&&<div style={{fontSize:10,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.b.concept}{f.resp?` · ${f.resp}`:''}</div>}</>
                  : <>
                      <div onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(f.b.client_id)}} style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer'}}>{clientNom(f.b.client_id)}</div>
                      <div style={{fontSize:10,color:C.textSoft,marginTop:1}}>N° {folioN(f.b.invoice_no)||folioN(f.b.folio)}{f.resp?` · ${f.resp}`:''}</div>
                    </>}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{fmt(f.monto)}</div>
                <div style={{fontSize:10,color:e.color,marginTop:1}}><span style={{width:5,height:5,borderRadius:'50%',background:e.dot,display:'inline-block',marginRight:4,verticalAlign:1}}/>{e.label}{f.est==='cobrada'&&!tieneRespaldo(f.b)?' · sin respaldo':''}</div>
              </div>
              <span style={{fontSize:12,color:C.textSoft}}>{abierto?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
            </div>
            {sugInline}
            {abierto&&<div style={{padding:'0 11px 10px',borderTop:`1px solid ${C.bgSoft}`}}>{detalleInner}</div>}
          </div>
        )
      }
      if(visibles.length===0) return emptyEl
      // Agrupado por cliente (protagonista): grupos ordenados por saldo desc; dentro, el orden ya viene (detectado→sinpago→cobrada, monto desc). Reusa filaEl(f,true).
      const grupos = Object.values(visibles.reduce((acc,f)=>{ const k=String(f.b.client_id||'sc'); if(!acc[k]) acc[k]={cid:f.b.client_id,nom:clientNom(f.b.client_id),fs:[],saldo:0,cob:0,nDet:0}; const g=acc[k]; g.fs.push(f); g.saldo+=f.saldo; g.cob+=f.cobrado; if(f.est==='detectado')g.nDet++; return acc },{})).sort((a,z)=>z.saldo-a.saldo)
      const grpEl = g=>{ const key=String(g.cid||'sc'); const solo=g.fs.length===1; const open=grpOpen[key]!==undefined?grpOpen[key]:(solo||g.nDet>0)
        return (<div key={key} style={{borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>setGrpOpen(p=>({...p,[key]:!open}))} style={{display:'flex',alignItems:'center',gap:11,padding:'11px 14px',cursor:'pointer',background:C.bgSoft}}>
            <span style={{color:C.textSoft,fontSize:12,width:10,flexShrink:0}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
            <span style={{width:30,height:30,borderRadius:10,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='user' s={16} c={C.accent}/></span>
            <div onClick={ev=>{ev.stopPropagation();g.cid&&onOpenClientFicha&&onOpenClientFicha(g.cid)}} style={{minWidth:0,flex:1,cursor:g.cid?'pointer':'default'}}><div style={{fontSize:14,fontWeight:800,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.nom}</div></div>
            <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:14,fontWeight:800,color:g.saldo>0?C.text:C.greenText,fontVariantNumeric:'tabular-nums'}}>{g.saldo>0?fmt(g.saldo):'$0'}</div><div style={{fontSize:10,color:C.muted}}>{g.nDet>0&&<span style={{color:C.greenText,fontWeight:600}}>{g.nDet} listo{g.nDet!==1?'s':''} · </span>}{g.fs.length} factura{g.fs.length!==1?'s':''}</div>{g.cob>0&&g.saldo>0&&<div style={{fontSize:10,color:C.greenText,fontWeight:600,marginTop:1}}>cobrado {fmt(g.cob)}</div>}</div>
          </div>
          {open&&g.fs.map(f=>filaEl(f,true))}
        </div>) }
      return (
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          {isDesktop&&<div style={{display:'grid',gridTemplateColumns:'1fr 96px 104px 104px 104px 92px',gap:10,padding:'9px 14px',borderBottom:`1px solid ${C.border}`,fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.4}}>
            <span>Factura · glosa</span><span>Resp.</span><span style={{textAlign:'right'}}>Emitido</span><span style={{textAlign:'right'}}>Cobrado</span><span style={{textAlign:'right'}}>Saldo</span><span style={{textAlign:'right'}}>Estado</span>
          </div>}
          {grupos.map(grpEl)}
        </div>
      )
    })()}

    {/* Historial y comparación */}
    <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginTop:10}}>
      <div style={{...SEC_LBL,marginBottom:10}}>Historial y comparación</div>
      {cur&&prev&&<div style={{display:'flex',gap:7,marginBottom:12}}>
        {[['Emitido',cur.emi,prev.emi,false],['Pagado',cur.cob,prev.cob,false],['Por cobrar',cur.pen,prev.pen,true]].map(([l,a,b,inv])=>
          <div key={l} style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 9px'}}>
            <div style={{...SEC_LBL}}>{l}</div>
            <div style={{fontSize:15,fontWeight:700,color:C.text,letterSpacing:-.2}}>{fmtShort(a)}</div>
            <div style={{fontSize:10,fontWeight:700,color:deltaCol(a,b,inv),marginTop:1}}>{deltaTxt(a,b)} <span style={{color:C.textSoft,fontWeight:600}}>vs {prev.mesN}</span></div>
          </div>)}
      </div>}
      <div style={{display:'grid',gridTemplateColumns:`repeat(${trend.length||1},minmax(0,1fr))`,gap:6}}>
        {trend.map(t=><div key={t.k} onClick={()=>{setMes(t.k);setExpand(null);setEstFiltro(null)}} style={{cursor:'pointer',border:`1px solid ${t.act?C.accent:C.border}`,background:t.act?C.azulBg:C.surface,borderRadius:9,padding:'7px 4px',textAlign:'center',minWidth:0}}>
          <div style={{fontSize:10,color:t.act?C.accent:C.muted,fontWeight:t.act?800:600}}>{t.mesN}</div>
          <div style={{fontSize:14,fontWeight:800,color:t.emi>0?(t.act?C.accent:C.greenText):C.done,fontVariantNumeric:'tabular-nums',marginTop:1}}>{t.emi>0?pct(t.tasa):'—'}</div>
        </div>)}
      </div>
      <div style={{fontSize:11,color:C.muted,marginTop:8}}>Tasa de cobro de cada mes (pagado ÷ emitido). Toca un mes para abrir su cierre.</div>
    </div>
  </div>)
}

// useBillingModel: capa de MODELO de Facturacion (estado + datos derivados + acciones), extraida de BillingView para
// habilitar dos presentaciones (movil/desktop) sobre la MISMA logica. Traslado verbatim: no cambia ninguna formula.
export function useBillingModel({billing,clients,sales,clientEntities,user,setBilling,anticipos=[],terceros=[],respaldoMap={},cartolaHasta=null,onNuevoAnticipo,onProveedores,onConciliarTerceros,onCubrirCuotas,onDescubrirCuotas,onDeshacerConsumo,onFusionarAnticipos,onAbrirAnticipo,onFacturarBloque,onStatusChange,onRevertirPago,onReactivar,onDelete,onAdd,onEdit,onImport,onImportExcel,onUpload,onAssignClient,onEmitir,onAnular,onSetVentaAnio,onReprocesarSinAnio,onAssignSeries,onDepurarCobradas,onRefresh,onConciliar,onOpenClientFicha,onReplaceProgramada,onIngresarSII,onCrearVentaRapida,onFacturaTercero,proveedores=[],onSaveProveedor,onIrConciliacion,intent,onIntentDone}) {
  const [siiOpen,setSiiOpen] = useState(false)
  const [depurarRows,setDepurarRows] = useState(null)   // facturas saldadas a confirmar (modal detallado)
  const [cubrirAnt,setCubrirAnt] = useState(null)   // anticipo en flujo "cubrir cuotas"
  const [facturarAnt,setFacturarAnt] = useState(null)   // anticipo en flujo "emitir factura del bloque"
  const [filter,setFilter] = useState(()=>viewMemLeer('billing')?.filter||'resumen')
  useEffect(()=>{ if(DEMO||!user) return; logEvent('vista','billing:'+filter,{},user?.name||user?.email) },[filter])   // eslint-disable-line
  // Deep-link desde los accesos directos del Inicio: abre el cotejo SII o el checklist "Facturas del mes"
  const [cotejoMes,setCotejoMes] = useState(null)   // mes con el que abrir el cotejo (para buscar facturas antiguas del mes de un pago)
  const [cierreOpen,setCierreOpen] = useState(()=>!!viewMemLeer('billing')?.cierreOpen)
  useEffect(()=>{ if(!intent) return; if(intent==='cotejo'||String(intent).startsWith('cotejo:')){ const mm=String(intent).split(':')[1]||null; setCotejoMes(/^\d{4}-\d{2}$/.test(mm||'')?mm:null); setSiiOpen(true) } else if(intent==='checklist') setFilter('checklist'); else if(intent==='sinemitir') setFilter('sinemitir'); else if(intent==='sinfacturar') setFilter('sinfacturar'); else if(intent==='porcompletar') setFilter('porcompletar'); else if(intent==='cierre') setCierreOpen(true); else if(intent==='sii') setSiiPageOpen(true); else if(intent==='sinregistrar') setTimeout(()=>cargarSinRegistrar(),0); onIntentDone&&onIntentDone() },[intent])   // eslint-disable-line
  useEffect(()=>{ contarSinRegistrar() },[])   // badge del hub: cargas sin registrar // eslint-disable-line
  const {uf:ufHoy} = useUF()
  const [estSel,setEstSel] = useState(()=>new Set())   // multi-select de estado en la vista Por cliente; vacío = todos
  const isDesktop = useIsDesktop()   // Fase 3: en desktop, la lista de facturas se alinea como tabla
  const [agingF,setAgingF] = useState('')   // filtro por tramo de antigüedad de vencimiento ('1-30'|'31-60'|'61-90'|'90'); '' = todos. Lo setean los chips de "Vencido por antigüedad" de la foto.
  const [groupOpen,setGroupOpen] = usePersistedState('bill_grp',{})   // colapso por grupo (Pagadas/Anuladas cerrados por defecto)
  const [rsSel,setRsSel] = useState({})   // filtro por razón social dentro de cada cliente: clientId → entityId | 'all'
  // Navegación por estado: todas las KPI cards / tabs de estado llevan al MISMO acordeón "Por cliente" filtrado por ese estado (vistas coherentes, no listas viejas distintas).
  const ESTADO_MAP={emitidas:['Pendiente','Vencido'],programadas:['Programada'],vencido:['Vencido'],pagado:['Pagado'],anuladas:['Anulada']}
  const irAEstado = fl => { setFilter('clientes'); setEstSel(new Set(ESTADO_MAP[fl]||[])); setAgingF('') }
  const irAEstadoAging = tr => { setFilter('clientes'); setEstSel(new Set(['Vencido'])); setAgingF(tr) }   // drill de un tramo de antigüedad → lista Vencidas filtrada por ese tramo
  const estadoActivo = fl => filter==='clientes' && [...estSel].sort().join(',')===(ESTADO_MAP[fl]||[]).slice().sort().join(',') && estSel.size>0
  const [impOpen,setImpOpen] = useState(false)
  const respaldoRef = useRef(null)
  const [procResp,setProcResp] = useState(false)
  const [respaldoRes,setRespaldoRes] = useState(null)   // listado de resultados del último cargue de XML (por factura)
  const [respaldoFiles,setRespaldoFiles] = useState(null)  // resumen por archivo subido (fase intermedia)
  const [respaldoAt,setRespaldoAt] = useState(null)        // fecha/hora de la carga actual (trazabilidad)
  const [respaldoBatchId,setRespaldoBatchId] = useState(null)  // id del batch de la carga actual (para ligar las facturas registradas)
  const batchIdRef = useRef(null)              // id del batch de la sesión; se crea al PRIMER registro (no en el preview)
  const respaldoSummaryRef = useRef(null)      // resumen del preview (period/files/counts) para crear el batch al registrar
  const [cargasHist,setCargasHist] = useState(null)        // historial de cargas del SII (modal); null = cerrado
  const [mesTandaReq,setMesTandaReq] = useState(null)   // {def, resolve} del modal "¿de qué mes es esta tanda?" (promesa)
  const [xmlHub,setXmlHub] = useState(()=>!!viewMemLeer('billing')?.xmlHub)            // hub "Cargar XML": Cargar archivo · Cargadas sin registrar · Historial
  const [sinRegN,setSinRegN] = useState(0)
  const [sinRegDocs,setSinRegDocs] = useState([])   // las emitidas en el SII sin registrar (folios) — para la página Cargar del SII              // cuántas cargas quedaron sin registrar (badge del hub)
  const [siiSinCli,setSiiSinCli] = useState([])         // docs del SII sin cliente resuelto → se muestran en "Sin cliente" de la vista sin cliente/venta
  const [cargandoStage,setCargandoStage] = useState(false)
  // Fuente ÚNICA del match doc→programada (la usan la carga y la lista persistente). Devuelve la mejor candidata y todas.
  const matchProgramada = (cliId, monto, fecha, glosa, progUsadas)=>{
    if(!cliId || !(monto>0)) return {progId:null, progCand:[]}
    const cand=candidatasProgramadas(billing, cliId, monto, fecha, glosa)   // regla única (_shared/facturacionReglas.js)
    const pick = cand.find(c=>!(progUsadas&&progUsadas.has(c.id))) || null
    if(pick&&progUsadas) progUsadas.add(pick.id)
    const progCand = cand.map(c=>({id:c.id, due:c.due||c.issued_at||null, concept:c.concept||'', amount:c.amount||0, sale_id:c.sale_id||null, s:c._s}))
    return {progId:pick?.id||null, progCand}
  }
  // «Comisión por facturar» abierta del cliente (cobrada sin folio) más cercana en fecha a la factura (≤60 días), aunque el monto no calce exacto.
  const comPorFacturarDe = (cliId, fecha) => { if(!cliId) return null
    const dd=x=>{ const d=x.paid_at||x.due; return (d&&fecha)?Math.abs((new Date(d)-new Date(fecha))/86400000):0 }
    return (billing||[]).filter(x=>!x.deleted_at&&!x.invoice_no&&x.billing_type==='comision'&&x.status==='Anticipada'&&String(x.client_id)===String(cliId)&&dd(x)<=60).sort((a,b)=>dd(a)-dd(b))[0]||null }
  // Marca una carga (staging) como registrada/descartada por folio — al pasar de "sin registrar" a factura real. Silencioso.
  const marcarStaged = async(folio, estado='registrada', billingId=null)=>{ if(!folio) return; try{ await supabase.from('sii_cargas_docs').update({estado, billing_id:billingId||null, updated_at:new Date().toISOString()}).eq('folio',String(folio)).eq('estado','sin_registrar') }catch(e){registrarError({origen:'accion',vista:'sii_cargas_docs',err:e})} }
  // Cuántas cargas quedaron sin registrar (badge del hub). Tolera que la tabla aún no exista.
  const contarSinRegistrar = async()=>{ try{
      if(DEMO){ setSinRegN(0); setSiiSinCli([]); return }
      const {data}=await supabase.from('sii_cargas_docs').select('id,folio,receptor_rut,receptor_name,monto,fecha_emision,tipo_dte,glosa,client_id,doc_json').eq('estado','sin_registrar')
      const docs=data||[]; setSinRegN(docs.length); setSinRegDocs(docs)
      // Las emitidas en el SII cuyo RUT NO resuelve cliente = las "sin cliente" reales → se muestran en la vista para asignar/crear acá (shape de item para reusar crearDesdeXML).
      const orph=docs.filter(s=>!(s.client_id||resolverClienteSII(s.receptor_rut,s.receptor_name,clients,clientEntities)?.id))
        .map(s=>({ _stageId:s.id, receptor_rut:s.receptor_rut||'', receptor_name:s.receptor_name||'', monto:s.monto, folio:s.folio, fecha:s.fecha_emision, glosa:s.glosa, clienteId:null,
                   row:{folio:s.folio, rut:s.receptor_rut, receptor:s.receptor_name, monto:s.monto, fechaEmision:s.fecha_emision, tipoDte:s.tipo_dte, concepto:s.glosa}, doc:s.doc_json?.doc||null }))
      setSiiSinCli(orph)
    }catch(_){ setSinRegN(0); setSiiSinCli([]) } }
  // Sube uno o VARIOS "Archivo Respaldo" (SetDTE XML de MIPYME): por cada factura genera el PDF (logo+timbre), lo sube a
  // la carpeta de facturación en Drive y lo adjunta a la ficha. Devuelve un LISTADO de resultados factura por factura.
  // Sube/enlaza el PDF-respaldo de una factura YA registrada a Drive (idempotente). Fuente única: la usan la carga de XML y el reintento.
  // Si falla (p. ej. token de Drive 401), la factura igual quedó registrada — lo único que falta es este respaldo.
  const adjuntarRespaldoDrive = async(token, b, d, periodoISO)=>{
    const folioM = b.invoice_no
    const rzn=(d&&(d.match(/<RznSocRecep>([^<]+)<\/RznSocRecep>/)||[])[1])||b.receptor_name||''
    const fname='Factura '+folioM+' - '+String(rzn).replace(/[\/\\:*?"<>|]/g,'').slice(0,45)+'.pdf'
    const fEmis=(d&&(d.match(/<FchEmis>([^<]+)<\/FchEmis>/)||[])[1])||b.issued_at||''
    const carpeta=await driveCarpetaFacturacion(token, periodoISO||fEmis)   // carpeta real por año/mes de la emisión
    try{ await supabase.from('billing_attachments').delete().eq('billing_id',b.id).eq('uploaded_by','Respaldo SII') }catch(e){registrarError({origen:'accion',vista:'billing_attachments',err:e})}
    const yaEnDrive = await driveBuscarEnCarpeta(token, carpeta, fname)   // dedup real contra Drive: si ya está, enlaza (no re-sube)
    let fileId, url, nombre=fname, subido=false
    if(yaEnDrive.length){ fileId=yaEnDrive[0].id; url=yaEnDrive[0].webViewLink||null }
    else { const r = await facturaDtePdfBase64(d); const bin = atob(r.base64); const u8 = new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i); const up = await driveUpload(token, carpeta, new File([u8], fname, {type:'application/pdf'}), fname); fileId=up.id; url=up.webViewLink||null; nombre=up.name||fname; subido=true }
    const { error:iErr } = await supabase.from('billing_attachments').insert({ billing_id:b.id, drive_file_id:fileId, name:nombre, url, uploaded_by:'Respaldo SII' })
    if(iErr) throw new Error('subió a Drive pero no se pudo adjuntar a la factura: '+iErr.message)
    return { url, subido }
  }
  const procesarRespaldoSII = async(fileList)=>{
    const files=[...(fileList||[])].filter(f=>/\.xml$/i.test(f.name||'')||/xml/i.test(f.type||''))
    if(!files.length){ appAlert('Sube el o los "Archivo Respaldo" (.xml) de MIPYME.'); return }
    const leerXml=async(f)=>{ const buf=await f.arrayBuffer(); const enc=((new TextDecoder('ascii').decode(buf.slice(0,200)).match(/encoding=["']([^"']+)["']/i)||[])[1]||'utf-8').toLowerCase(); return new TextDecoder(/8859|latin|1252/.test(enc)?'iso-8859-1':'utf-8').decode(buf) }
    // Preguntar a qué mes corresponde la tanda. Default inteligente: si la emisión cae en los primeros días del mes, la
    // tanda es del mes ANTERIOR (se termina de emitir a inicio del siguiente). TODAS las facturas de la carga van a ese mes.
    let periodoISO=null
    try{
      const d0=splitSetDTE(await leerXml(files[0]))[0]||''; const f0=(d0.match(/<FchEmis>([^<]+)<\/FchEmis>/)||[])[1]||''
      const def=(()=>{ const s=String(f0||''); if(!/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,7); let [y,m,dd]=s.slice(0,10).split('-').map(Number); if(dd<=5){ m--; if(m<1){m=12;y--} } return `${y}-${String(m).padStart(2,'0')}` })()
      const p=await new Promise(resolve=>setMesTandaReq({def,resolve}))
      if(p===null) return
      periodoISO = /^\d{4}-\d{2}$/.test(String(p||'').trim()) ? String(p).trim()+'-01' : (def?def+'-01':null)
    }catch(_){}
    // La app anticipa: si ya cargaste esa tanda (mismo período en sii_import_batches), avisa antes de reprocesar (evita recargas ciegas).
    if(periodoISO){ try{ const per=String(periodoISO).slice(0,7); const {data}=await supabase.from('sii_import_batches').select('id,created_at').eq('period',per).order('created_at',{ascending:false}).limit(1); if(data&&data[0]){ let n=0; try{ const {count}=await supabase.from('billing').select('id',{count:'exact',head:true}).eq('import_batch_id',data[0].id).is('deleted_at',null); n=count||0 }catch(_){} const M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']; const ml=`${M[+per.slice(5,7)-1]} ${per.slice(0,4)}`; if(!(await appConfirm({title:`Ya registraste ${ml}`, message:(n?`Tienes ${n} factura${n!==1?'s':''} de ${ml} ya registradas (el ${fmtFechaDMY(data[0].created_at)}).`:`Ya registraste ${ml} (el ${fmtFechaDMY(data[0].created_at)}).`)+`\n\nSubir el XML otra vez NO duplica nada: las ya registradas se saltan solas y en pantalla solo quedarán las que aún falten por registrar.`, confirmText:'Subir igual', cancelText:'Cancelar'}))) return } }catch(_){} }
    setProcResp(true); setRespaldoRes(null)
    try{
      const token = await driveToken()
      if(!token){ if(await appConfirm('Para guardar los respaldos en Drive necesitas conectarlo. ¿Conectar ahora?')) connectDrive(); setProcResp(false); return }
      const res=[]
      const progUsadas=new Set()   // programadas ya tomadas por otra factura de este lote (no reusar en el match FIFO)
      const seenDoc=new Set()      // folio+tipo ya vistos en el lote (dedup: mismo DTE repetido en 2 archivos o archivo cargado 2 veces)
      const fileStats=[]           // resumen por archivo (fase intermedia): nombre, total de DTE, repetidos omitidos
      for(const file of files){
        let docs=[]; try{ docs=splitSetDTE(await leerXml(file)) }catch(_){ try{ docs=splitSetDTE(await file.text()) }catch(__){} }
        if(!docs.length){ res.push({archivo:file.name, estado:'sin_dte'}); fileStats.push({name:file.name,total:0,skipped:0}); continue }
        const _start=res.length; let _skip=0
        for(const d of docs){
          const P = parseDTE(d)   // fuente única de los campos del DTE
          const folioM = P.folio
          // NOTA DE CRÉDITO (TipoDTE 61): no es factura. Lee la <Referencia> (a qué factura aplica y si la anula), busca esa factura y un reemplazo probable, y va a su propia sección — se resuelve con compuerta (anular + vincular).
          const _tipoNC = P.tipo
          const _dk=(_tipoNC||'?')+':'+folioM
          if(folioM && seenDoc.has(_dk)){ _skip++; continue }   // dedup: no listar dos veces el mismo folio+tipo
          if(folioM) seenDoc.add(_dk)
          if(_tipoNC===61){
            const folioRef=P.ref.folio, codRef=P.ref.cod, razonRef=P.ref.razon
            const ncMonto=P.total, ncFecha=P.fecha, ncRut=P.rut, ncRecep=P.receptor, ncConcepto=P.nmb
            const fac=(billing||[]).find(x=>!x.deleted_at&&x.invoice_no&&folioN(x.invoice_no)===folioN(folioRef))
            const repl=fac?(billing||[]).find(x=>!x.deleted_at&&x.invoice_no&&folioN(x.invoice_no)!==folioN(folioRef)&&x.status!=='Anulada'&&x.billing_type!=='nota_credito'&&Math.round(x.amount||0)===ncMonto&&_normTxt(x.concept||'')===_normTxt(ncConcepto)):null
            const yaReg=(billing||[]).some(x=>!x.deleted_at&&x.billing_type==='nota_credito'&&folioN(x.invoice_no)===folioN(folioM))
            res.push({estado:yaReg?'nc_hecha':'nota_credito', ncFolio:folioM, ncFecha, monto:ncMonto, receptor:ncRecep, rut:ncRut, codRef, razonRef,
              facId:fac?.id||null, facFolio:folioRef, facStatus:fac?.status||null,
              facCliente:fac?((clients||[]).find(c=>String(c.id)===String(fac.client_id))?.name||fac.receptor_name||''):null,
              replId:repl?.id||null, replFolio:repl?folioN(repl.invoice_no):null, replCliente:repl?((clients||[]).find(c=>String(c.id)===String(repl.client_id))?.name||repl.receptor_name||''):null,
              doc:d})
            continue
          }
          const b = (billing||[]).find(x=> !x.deleted_at && folioN(x.invoice_no)===folioN(folioM))
          const cli = b ? ((clients||[]).find(c=>String(c.id)===String(b.client_id))?.name||b.receptor_name||'—') : null
          if(!b){
            const tipoDte=P.tipo, fecha=P.fecha, rut=P.rut, receptor=P.receptor, monto=P.total, nmb=P.nmb, dsc=P.dsc
            const glosa=P.glosa   // lo que DICE la factura del SII (descripción del servicio)
            const concepto=nmb||'Honorarios'
            const cli=resolverClienteSII(rut, receptor, clients, clientEntities)   // cliente ya conocido por RUT/RS (no pedir asignar)
            // ¿Calza con una PROGRAMADA del cliente? Candidatas = pendientes (sin folio) del cliente, monto ±6%, vencimiento a ≤120 días de la emisión (cota).
            // Se ordenan por cuánto CALZA LA GLOSA del DTE con el período de cada cuota (mes/cuota); a igualdad, FIFO (más antigua). Así una cuota vieja sin registrar no roba el match de un mes reciente.
            const {progId:pickId, progCand} = matchProgramada(cli?.id, monto, fecha, glosa, progUsadas)
            res.push({folio:folioM||'?', estado:pickId?'programada':'nueva', cliente:cli?.name||receptor, clienteId:cli?.id||null, progId:pickId, progCand, glosa, monto, fecha, row:{folio:folioM, rut, receptor, monto, fechaEmision:fecha, tipoDte, concepto}, doc:d})
            continue
          }
          // La factura YA existe (b). Paso 1: refresca el DTE en la factura (registra/corrige monto+XML+tipo). Esto NO depende de Drive.
          const td=P.tipo
          const dteTot=P.total
          const fixAmt = dteTot&&Math.round(dteTot)!==Math.round(b.amount||0) ? {amount:dteTot} : {}
          try{ await supabase.from('billing').update({dte_xml:d,...fixAmt,...(td?{sii_tipo_dte:td}:{}),updated_at:new Date().toISOString()}).eq('id',b.id); if(setBilling) setBilling(p=>p.map(x=>x.id===b.id?{...x,dte_xml:d,...(fixAmt.amount!=null?{amount:dteTot}:{}),...(td?{sii_tipo_dte:td}:{})}:x)) }catch(e){registrarError({origen:'accion',vista:'billing',err:e})}
          // Paso 2: respaldo (PDF a Drive) vía helper único. Si falla, la factura IGUAL quedó registrada — solo falta el respaldo (no es error de la factura).
          try{
            const { url, subido } = await adjuntarRespaldoDrive(token, b, d, periodoISO)
            res.push({folio:folioM, cliente:cli, monto:b.amount, estado:subido?'adjuntada':'duplicada', url})
          }catch(e){ res.push({folio:folioM, cliente:cli, billingId:b.id, estado:'sin_respaldo', drive:(e instanceof DriveAuthError||e?.code===401), msg:e.message||String(e), doc:d}) }
        }
        for(let k=_start;k<res.length;k++){ if(!res[k].archivo) res[k].archivo=file.name }
        fileStats.push({name:file.name, total:docs.length, skipped:_skip})
      }
      // Trazabilidad: guarda la carga como evento (fecha, quién, mes de la tanda, archivos + conteos) para el historial.
      const _cat=catImport
      const filesDetail=fileStats.map(f=>{ const its=res.filter(r=>r.archivo===f.name); const c={}; its.forEach(r=>{ const k=_cat(r.estado); c[k]=(c[k]||0)+1 }); return {name:f.name,total:f.total,skipped:f.skipped,counts:c} })
      const totalCounts={}; res.forEach(r=>{ const k=_cat(r.estado); totalCounts[k]=(totalCounts[k]||0)+1 })
      setRespaldoAt(new Date().toISOString())
      // El batch (trazabilidad) NO se escribe en el preview: solo al REGISTRAR de verdad (ensureBatch). Previsualizar no deja rastro ni dispara "ya cargaste".
      batchIdRef.current=null; setRespaldoBatchId(null)
      respaldoSummaryRef.current={ period:(periodoISO?String(periodoISO).slice(0,7):null), files:filesDetail, counts:totalCounts, docs_total:fileStats.reduce((a,f)=>a+(f.total||0),0), skipped:fileStats.reduce((a,f)=>a+(f.skipped||0),0) }
      setRespaldoFiles(fileStats)
      setRespaldoRes(res)
      // PERSISTIR lo cargado sin registrar (programada/nueva) → puedes salir y retomar. Llave folio+tipo (no duplica).
      // Solo entran las que NO están aún en billing; las ya registradas van por la rama de arriba (adjuntada).
      try{
        const stage=res.filter(r=>(r.estado==='programada'||r.estado==='nueva')&&r.row&&r.row.folio).map(r=>({
          folio:String(r.row.folio), tipo_dte:r.row.tipoDte||33, fecha_emision:r.fecha||null,
          receptor_rut:r.row.rut||null, receptor_name:r.row.receptor||null, monto:Math.round(r.monto||0),
          glosa:r.glosa||null, doc_json:{doc:r.doc, row:r.row}, client_id:r.clienteId||null,
          estado:'sin_registrar', created_by:user?.name||null, updated_at:new Date().toISOString() }))
        if(stage.length){ await supabase.from('sii_cargas_docs').upsert(stage,{onConflict:'folio,tipo_dte'}); contarSinRegistrar() }
      }catch(e){registrarError({origen:'accion',vista:'sii_cargas_docs',err:e})}
      onRefresh&&onRefresh()
    }catch(e){ if(e instanceof DriveAuthError||e?.code===401){ appAlert('Tu acceso a Drive expiró. Reconéctalo e intenta de nuevo.'); connectDrive() } else appAlert('Error en el respaldo: '+(e.message||e)) }
    setProcResp(false)
  }
  // Reabre lo cargado sin registrar (persistente): reconstruye las filas y REFRESCA el match contra las programadas de hoy.
  const cargarSinRegistrar = async()=>{
    setCargandoStage(true)
    try{
      const {data,error}=await supabase.from('sii_cargas_docs').select('*').eq('estado','sin_registrar').order('created_at',{ascending:false})
      if(error) throw error
      const usadas=new Set(); const rows=[]
      for(const s of (data||[])){
        const ya=(billing||[]).find(x=>!x.deleted_at&&x.invoice_no&&folioN(x.invoice_no)===folioN(s.folio))
        if(ya){
          // La factura YA tiene folio (ej. viene de un adelanto): enlaza y, si le falta el XML, ADJÚNTASELO
          // (antes solo enlazaba y el XML quedaba huérfano → la factura no aparecía en "Por enviar").
          if(!ya.dte_xml && s.doc_json?.doc){ try{ await supabase.from('billing').update({dte_xml:s.doc_json.doc, updated_at:new Date().toISOString()}).eq('id',ya.id); if(setBilling) setBilling(p=>p.map(b=>b.id===ya.id?{...b,dte_xml:s.doc_json.doc}:b)) }catch(e){registrarError({origen:'accion',vista:'billing',err:e})} }
          marcarStaged(s.folio,'registrada',ya.id); continue
        }
        const row=s.doc_json?.row || {folio:s.folio, rut:s.receptor_rut, receptor:s.receptor_name, monto:s.monto, fechaEmision:s.fecha_emision, tipoDte:s.tipo_dte, concepto:s.glosa}
        const cliId=s.client_id || resolverClienteSII(row.rut,row.receptor,clients,clientEntities)?.id || null
        const {progId,progCand}=matchProgramada(cliId, s.monto, s.fecha_emision, s.glosa, usadas)
        const cliName=(clients||[]).find(c=>String(c.id)===String(cliId))?.name || row.receptor
        rows.push({folio:s.folio, estado:progId?'programada':'nueva', cliente:cliName, clienteId:cliId, progId, progCand, glosa:s.glosa, monto:s.monto, fecha:s.fecha_emision, row, doc:s.doc_json?.doc||null, _stageId:s.id})
      }
      setRespaldoFiles(null); respaldoSummaryRef.current={tipo:'registro'}; batchIdRef.current=null; setRespaldoBatchId(null)
      setRespaldoRes(rows); setXmlHub(false)
      // CERO TOQUE por RUT: TODA factura del SII cuyo RUT resolvió el cliente DEBE quedar registrada — no es opcional
      // (si no, un DTE emitido queda "nuevo"/invisible para Cobranza y los totales). Dos casos:
      //  1) Programada de calce único → se consume (registrarProg).
      //  2) Sin cuota que calce → se CREA la factura igual; si el cliente tiene UNA venta activa, se asocia por RUT (si no, factura sin venta, reclasificable a tercero después).
      // Solo queda a mano lo REALMENTE ambiguo: RUT sin resolver, o programada con varias candidatas. Todo reversible desde la factura.
      let autoOk=0
      // FIFO recurrente: si TODAS las candidatas son la MISMA serie (mismo sale_id), no hay ambigüedad real →
      // consumir la MÁS ANTIGUA sin facturar (regla "siempre la más antigua, nunca saltarse"), automático.
      // Solo se mantiene la compuerta cuando las candidatas son de VENTAS distintas (ahí sí: ¿cuál proyecto?).
      // Regla compartida: si la venta ya tiene una factura emitida ese mes, la cuota que toca (mes atrasado o adelantado) la elige una persona.
      const yaEnMes = it => { const pc=(it.progCand||[]).find(c=>String(c.id)===String(it.progId))||(it.progCand||[])[0]; return serieYaFacturadaEnMes((billing||[]).filter(b=>String(b.client_id)===String(it.clienteId)), pc?.sale_id, it.fecha, it.folio) }
      for(const it of rows.filter(r=>r.estado==='programada' && r.clienteId && ((r.progCand||[]).length<=1 || unaSerie(r.progCand)) && !yaEnMes(r))){
        try{
          if((it.progCand||[]).length>1){ const old=[...it.progCand].sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))[0]; if(old?.id) it.progId=old.id }   // varias cuotas iguales de la misma serie → la más antigua (FIFO)
          await registrarProg(it); autoOk++; setRespaldoRes(p=>(p||[]).map(r=>r===it?{...r,estado:'registrada',_auto:true}:r))
        }catch(_){}
      }
      for(const it of rows.filter(r=>r.estado==='nueva' && r.clienteId)){
        try{ const vac=(sales||[]).filter(s=>!s.deleted_at&&String(s.client_id)===String(it.clienteId)&&s.status==='Activo'&&!esSubarriendo(s)); const saleId=vac.length===1?vac[0].id:null   // el subarriendo NO es una venta de honorarios: nunca se asocia por descarte (caso F454)
          const fac=await onIngresarSII({...it.row, doc:it.doc, ...(saleId?{sale_id:saleId}:{}), import_batch_id:(await ensureBatch())}, it.clienteId)
          if(fac?.id){ marcarStaged(it.row?.folio,'registrada',fac.id); autoOk++; setRespaldoRes(p=>(p||[]).map(r=>r===it?{...r,estado:'creada',_auto:true}:r)) } }catch(_){}
      }
      if(autoOk){ onRefresh&&onRefresh(); appAlert(`${autoOk} factura${autoOk!==1?'s':''} registrada${autoOk!==1?'s':''} automáticamente por RUT. Solo queda a mano lo que el RUT no pudo cruzar.`) }
      contarSinRegistrar()
      if(!rows.length) appAlert('No hay cargas sin registrar. Todo lo cargado ya está registrado.')
    }catch(e){ appAlert('No se pudo abrir lo cargado sin registrar. ¿Corriste el SQL de sii_cargas_docs? '+(e.message||'')) }
    setCargandoStage(false)
  }
  const abrirHistCargas = async () => { setCargasHist('loading'); try{ const {data}=await supabase.from('sii_import_batches').select('*').order('created_at',{ascending:false}).limit(60); const batches=data||[]; const ids=batches.map(b=>b.id).filter(Boolean); const reg={}; if(ids.length){ try{ const {data:bl}=await supabase.from('billing').select('import_batch_id').is('deleted_at',null).in('import_batch_id',ids); (bl||[]).forEach(r=>{ if(r.import_batch_id) reg[r.import_batch_id]=(reg[r.import_batch_id]||0)+1 }) }catch(_){} } setCargasHist(batches.map(b=>({...b, registered:reg[b.id]||0}))) }catch(_){ setCargasHist([]) } }
  const [creandoFac,setCreandoFac] = useState(null)   // folio en curso al crear una factura huérfana desde el XML
  const [crearCli,setCrearCli] = useState({})         // folio -> client_id elegido a mano para la huérfana
  // Crea en el sistema una factura que se emitió en el SII pero no estaba en la app (huérfana), desde su DTE del XML:
  // reusa onIngresarSII (fuente única). Cliente: el que elijas a mano (crearCli), o si no, lo resuelve por RUT.
  // Crea el batch de trazabilidad la PRIMERA vez que registras algo de esta carga (idempotente vía ref). El preview no lo crea.
  const ensureBatch = async () => {
    if(batchIdRef.current) return batchIdRef.current
    const s=respaldoSummaryRef.current||{}
    try{ const {data}=await supabase.from('sii_import_batches').insert({ created_by:user?.name||null, period:s.period||null, docs_total:s.docs_total||0, skipped:s.skipped||0, files:s.files||[], counts:s.counts||{}, tipo:s.tipo||'xml' }).select('id').single(); batchIdRef.current=data?.id||null }catch(e){registrarError({origen:'accion',vista:'sii_import_batches',err:e})}
    setRespaldoBatchId(batchIdRef.current)
    return batchIdRef.current
  }
  const crearDesdeXML = async(item, idx, saleId=null, tipo=null)=>{
    if(!onIngresarSII||creandoFac) return
    const clienteId = crearCli[item.row.folio]||item.clienteId||null   // usa el cliente ya resuelto por RUT si no elegiste otro
    const cliNom = clienteId ? ((clients||[]).find(c=>String(c.id)===String(clienteId))?.name||'') : ''
    const ventaNom = saleId ? ((sales||[]).find(s=>String(s.id)===String(saleId))?.title||'') : ''
    const cAnt = tipo==='comision' ? comPorFacturarDe(clienteId, item.row.fechaEmision||item.fecha) : null
    if(cAnt&&!await appConfirm(`Hay una comisión por facturar de este cliente: depósito del ${fmtFechaDMY(cAnt.paid_at||cAnt.due)} por ${fmt(cAnt.amount)}. Si esta factura es de ese depósito, usa «Es la comisión por facturar…».\n\n¿Registrarla como OTRA comisión?`)) return
    if(!await appConfirm(`¿Registrar la Factura N° ${item.row.folio} · ${item.row.receptor||'—'} · ${fmt(item.row.monto)}${cliNom?`\nCliente: ${cliNom}`:''}${ventaNom?`\nVenta: ${ventaNom}`:''}?\nYa está emitida en el SII.`)) return
    setCreandoFac(item.row.folio)
    try{
      const fac = await onIngresarSII({...item.row, doc:item.doc, ...(saleId?{sale_id:saleId}:{}), import_batch_id:(await ensureBatch())}, clienteId)   // crea el batch al registrar (no en el preview) + liga la factura (a la venta existente si se pasó saleId)
      if(fac?.id){ try{ const token=await driveToken(); if(token){ const carpeta=await driveCarpetaFacturacion(token, item.row.fechaEmision||''); const r=await facturaDtePdfBase64(item.doc); const fname='Factura '+r.folio+' - '+String(r.rznR||'').replace(/[\/\\:*?"<>|]/g,'').slice(0,45)+'.pdf'; const yaEnDrive=await driveBuscarEnCarpeta(token,carpeta,fname); let fileId,url2; if(yaEnDrive.length){fileId=yaEnDrive[0].id;url2=yaEnDrive[0].webViewLink||null}else{const bin=atob(r.base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); const up=await driveUpload(token,carpeta,new File([u8],fname,{type:'application/pdf'}),fname); fileId=up.id;url2=up.webViewLink||null} await supabase.from('billing_attachments').delete().eq('billing_id',fac.id).eq('uploaded_by','Respaldo SII'); await supabase.from('billing_attachments').insert({billing_id:fac.id,drive_file_id:fileId,name:fname,url:url2,uploaded_by:'Respaldo SII'}) } }catch(e){registrarError({origen:'accion',vista:'billing_attachments',err:e})} }
      const cliName=fac?.client_id?((clients||[]).find(c=>String(c.id)===String(fac.client_id))?.name||item.row.receptor):item.row.receptor
      setRespaldoRes(p=>(p||[]).map(r=>r===item?{...r,estado:'creada',cliente:cliName,monto:item.row.monto,sinCliente:!fac?.client_id,_fac:fac}:r))   // por IDENTIDAD (no por índice): idx venía del grupo 'nuevas', no del array completo → marcaba la fila equivocada y la registrada se quedaba NUEVA. _fac = la factura creada (para el link "Ver factura")
      if(fac?.id) marcarStaged(item.row.folio,'registrada',fac.id)
      // Tipo elegido al cargar (Comisión o Gastos): queda clasificada de una vez; el socio de la comisión se asigna en Por socio › Comisiones por asignar.
      if(fac?.id&&['comision','reembolso'].includes(tipo)){ const {error:te}=await supabase.from('billing').update({billing_type:tipo,updated_at:new Date().toISOString()}).eq('id',fac.id); if(!te){ setBilling&&setBilling(p=>p.map(x=>x.id===fac.id?{...x,billing_type:tipo}:x)); logActividad('facturacion.tipo_al_cargar',{tabla:'billing',id:fac.id,detalle:{invoice_no:item.row.folio,tipo}}) } }
    }catch(e){ appAlert('No se pudo crear la factura: '+(e.message||e)) }
    setCreandoFac(null)
  }
  const [ncConfirm,setNcConfirm] = useState(null)   // {item,idx} de la nota de crédito en confirmación de anulación
  const [ncVincular,setNcVincular] = useState(true) // check "vincular la factura que la reemplaza"
  const [ncBusy,setNcBusy] = useState(false)
  // Compuerta de nota de crédito: anula la factura referenciada (si existe) + registra la NC como documento (billing_type='nota_credito', status Anulada = excluida de toda cifra; queda para el libro por sii_tipo_dte=61) + vincula el reemplazo si lo confirmas.
  const anularPorNC = async(item, idx, vincular)=>{
    setNcBusy(true)
    try{
      await ensureBatch()   // registrar una NC también cuenta como commit de la carga (trazabilidad)
      const now=new Date().toISOString()
      const facCli=(billing||[]).find(x=>x.id===item.facId)
      if(item.facId){
        const patch={ status:'Anulada', anulada_at:now, anulada_por:`Nota de crédito N° ${item.ncFolio}`, updated_at:now, ...(vincular&&item.replId?{reemplazada_por_billing_id:item.replId}:{}) }
        const { error:e1 } = await supabase.from('billing').update(patch).eq('id',item.facId)
        if(e1) throw e1
        setBilling&&setBilling(p=>p.map(x=>x.id===item.facId?{...x,...patch}:x))
      }
      const ncRow={ client_id:facCli?.client_id||null, concept:`Nota de crédito — anula Factura N° ${item.facFolio}`, receptor_name:item.receptor||null, receptor_rut:item.rut||null, amount:Math.round(item.monto||0), status:'Anulada', invoice_no:String(item.ncFolio), issued_at:item.ncFecha||null, billing_type:'nota_credito', sii_tipo_dte:61, dte_xml:item.doc||null, nc_ref_billing_id:item.facId||null, sii_synced_at:now }
      const { data:ins, error:e2 } = await supabase.from('billing').insert(ncRow).select().single()
      if(e2) throw e2
      if(setBilling&&ins) setBilling(p=>[...p, ins])
      // Enlaza el DTE de la NC (sii_cargas_docs) a su fila recién creada → deja de figurar "sin enlazar".
      if(item.siiId&&ins?.id){ try{ await supabase.from('sii_cargas_docs').update({billing_id:ins.id}).eq('id',item.siiId) }catch(e){registrarError({origen:'accion',vista:'sii_cargas_docs',err:e})} }
      setRespaldoRes(p=>(p||[]).map(r=>r===item?{...r,estado:'nc_hecha'}:r))
      setNcConfirm(null); onRefresh&&onRefresh()
    }catch(e){ appAlert('No se pudo anular / registrar la nota de crédito: '+(e.message||e)) }
    setNcBusy(false)
  }
  const [regBusy,setRegBusy] = useState(null)       // progId en curso, o 'lote'
  const [regReview,setRegReview] = useState(null)   // items 'programada' en revisión antes de registrar en lote
  const [respaldoRetry,setRespaldoRetry] = useState(null)   // reintento de subir a Drive los respaldos que fallaron (factura ya registrada)
  // Reintenta subir a Drive el PDF-respaldo de las facturas que quedaron 'sin_respaldo' (ya registradas; solo falló Drive).
  const reintentarRespaldos = async(items)=>{
    if(!items||!items.length) return
    setRespaldoRetry('go')
    try{
      const token = await driveToken()
      if(!token){ if(await appConfirm('Para guardar los respaldos en Drive necesitas conectarlo. ¿Conectar ahora?')) connectDrive(); return }
      let ok=0
      for(const it of items){
        const b=(billing||[]).find(x=>String(x.id)===String(it.billingId)) || {id:it.billingId, invoice_no:it.folio, receptor_name:it.cliente}
        const d=it.doc || b.dte_xml
        if(!d) continue
        try{ await adjuntarRespaldoDrive(token, b, d, null); ok++; setRespaldoRes(p=>(p||[]).map(r=>r===it?{...r,estado:'adjuntada',drive:undefined,msg:undefined}:r)) }
        catch(e){ const auth=(e instanceof DriveAuthError||e?.code===401); setRespaldoRes(p=>(p||[]).map(r=>r===it?{...r,drive:auth,msg:e.message||String(e)}:r)); if(auth){ appAlert('Tu acceso a Drive expiró. Reconéctalo e intenta de nuevo.'); connectDrive(); break } }
      }
      if(ok) appAlert(`${ok} respaldo${ok!==1?'s':''} guardado${ok!==1?'s':''} en Drive.`)
    } finally { setRespaldoRetry(null); onRefresh&&onRefresh() }
  }
  // Backfill: respalda en Drive TODAS las facturas emitidas (con DTE) que aún no tienen copia guardada. El PDF se regenera del DTE. Idempotente (adjuntarRespaldoDrive dedup contra Drive).
  const [backfillBusy,setBackfillBusy] = useState(false)
  // Respalda TODAS las facturas emitidas en Drive, en la carpeta del MES FACTURADO (emisión − 1, convención del estudio).
  // Dos pasadas: (1) sube las que no tienen copia; (2) reubica las ya respaldadas que quedaron en la carpeta del mes de
  // EMISIÓN (lógica vieja) a la del mes facturado. El fileId/webViewLink no cambian al mover → no hay que tocar billing_attachments.
  const backfillRespaldos = async()=>{
    if(backfillBusy) return
    let att=[]
    try{ const {data}=await supabase.from('billing_attachments').select('billing_id,drive_file_id'); att=data||[] }catch(_){}
    const conResp=new Set(att.map(a=>String(a.billing_id)))
    const attByBill={}; att.forEach(a=>{ if(a.drive_file_id){ (attByBill[String(a.billing_id)]||(attByBill[String(a.billing_id)]=[])).push(a.drive_file_id) } })
    const emitidas=(billing||[]).filter(b=>b&&!b.deleted_at&&b.dte_xml&&b.invoice_no)
    const faltan=emitidas.filter(b=>!conResp.has(String(b.id)))
    const yaResp=emitidas.filter(b=>attByBill[String(b.id)])   // con archivo real en Drive → revisar/mover de carpeta
    if(!faltan.length && !yaResp.length){ appAlert('No hay facturas emitidas para respaldar.'); return }
    const partes=[faltan.length?`${faltan.length} sin copia (se suben)`:'', yaResp.length?`${yaResp.length} por revisar que estén en la carpeta del mes facturado`:''].filter(Boolean).join(' · ')
    if(!await appConfirm(`${partes}. ¿Continuar? Puede tardar un poco.`)) return
    const token=await driveToken(); if(!token){ if(await appConfirm('Para guardar en Drive necesitas conectarlo. ¿Conectar ahora?')) connectDrive(); return }
    const fEmisDe = b => { if(/^\d{4}-\d{2}/.test(String(b.issued_at||''))) return b.issued_at; const m=String(b.dte_xml||'').match(/<FchEmis>([^<]+)<\/FchEmis>/); return m?m[1]:'' }
    setBackfillBusy(true); let ok=0,err=0,mov=0
    for(const b of faltan){ try{ const d=splitSetDTE(b.dte_xml)[0]||b.dte_xml; await adjuntarRespaldoDrive(token,b,d,fEmisDe(b)||null); ok++ }
      catch(e){ err++; if(e instanceof DriveAuthError||e?.code===401){ appAlert('Tu acceso a Drive expiró. Reconéctalo e intenta de nuevo.'); connectDrive(); setBackfillBusy(false); onRefresh&&onRefresh(); return } } }
    for(const b of yaResp){ try{ const dest=await driveCarpetaFacturacion(token, fEmisDe(b)||''); for(const fid of attByBill[String(b.id)]){ if(await driveMover(token, fid, dest)) mov++ } }
      catch(e){ if(e instanceof DriveAuthError||e?.code===401){ appAlert('Tu acceso a Drive expiró. Reconéctalo e intenta de nuevo.'); connectDrive(); break } err++ } }
    setBackfillBusy(false); onRefresh&&onRefresh()
    appAlert(`${ok} copia${ok!==1?'s':''} nueva${ok!==1?'s':''} · ${mov} reubicada${mov!==1?'s':''} al mes facturado${err?` · ${err} con error (reintenta)`:''}.`)
  }
  const [progPick,setProgPick] = useState(null)     // item cuya selección de programada (alternativas) está abierta
  const [secOpen,setSecOpen] = useState({})         // secciones desplegadas del modal de carga (programadas van replegadas por defecto)
  const [crearVentaFor,setCrearVentaFor] = useState(null)   // item (nueva) cuyo panel "Crear venta" está abierto
  const [cvForm,setCvForm] = useState({title:'',ufVal:'',area:'Corporativo',responsible:''})   // form del panel Crear venta
  const [cvBusy,setCvBusy] = useState(false)
  const [terceroFor,setTerceroFor] = useState(null)   // item (nueva) cuyo panel "De un externo" está abierto
  const [queCorr,setQueCorr] = useState(null)          // item (nueva) cuyo chooser "¿A qué corresponde?" está abierto
  const [tvProv,setTvProv] = useState('')             // proveedor externo elegido en el panel
  const [tvNuevo,setTvNuevo] = useState('')           // nombre para crear un externo al vuelo
  const [tvBusy,setTvBusy] = useState(false)
  const [tvPct,setTvPct] = useState('')               // % que RETENEMOS de la factura del externo (el resto = cuenta por pagar)
  const [comisionTercMap,setComisionTercMap] = useState({})   // proveedor_id -> % de comisión aprendido (ej. Rodrigo = 15)
  useEffect(()=>{ if(typeof DEMO!=='undefined'&&DEMO) return; supabase.from('learnings').select('key,value').eq('kind','tercero_comision_pct').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ const v=parseFloat(r.value); if(r.key&&!isNaN(v)) m[String(r.key)]=v }); setComisionTercMap(m) },()=>{}) },[])   // % aprendido por externo
  // Registrar una programada como emitida: le pone folio + DTE + estado (Por cobrar) sobre la MISMA fila (no duplica). Monto = MntTotal del DTE (valor real emitido). Conserva su vencimiento planificado.
  const registrarProg = async(item)=>{
    if(!item.progId) throw new Error('sin programada')
    const bid=await ensureBatch()   // crea el batch al registrar (no en el preview)
    const now=new Date().toISOString()
    const dteTot=item.doc?dteMontoTotal(item.doc):null
    const isoF=(s=>{ const t=String(s||''); if(/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0,10); const m=t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m?`${m[3]}-${m[2]}-${m[1]}`:t })(item.row.fechaEmision||item.fecha)
    // El plazo corre desde la emisión: al emitir por match de DTE, recalcula el due (si no, la programada conserva su due planificado viejo y nace "vencida").
    // Cuota ya pagada por adelantado (Anticipada: p. ej. el arriendo que entró antes de facturarse): al llegar su factura queda PAGADA
    // con la fecha del anticipo, no "por cobrar" (si no, se cobraría dos veces).
    const progRow=(billing||[]).find(x=>String(x.id)===String(item.progId))
    const antPrev=progRow?.status==='Anticipada'&&progRow.prepaid_anticipo_id ? (anticipos||[]).find(a=>String(a.id)===String(progRow.prepaid_anticipo_id)) : null
    // Comisión por facturar (cobrada antes de emitir): conserva la fecha del depósito.
    const pagoAnt=progRow?.status==='Anticipada' ? { status:'Pagado', paid:true, paid_at:antPrev?.fecha||progRow?.paid_at||isoF||null } : null
    const patch={ invoice_no:String(item.row.folio), status:'Pendiente', issued_at:isoF||null, ...(isoF?{due:dueFromIssued(isoF)}:{}), dte_xml:item.doc||null, sii_tipo_dte:item.row.tipoDte||34, sii_synced_at:now, updated_at:now, ...(dteTot!=null?{amount:dteTot}:{}), ...(bid?{import_batch_id:bid}:{}) }
    if(pagoAnt) Object.assign(patch,pagoAnt)
    // Comisión por facturar con monto distinto al del SII: manda el DTE. Factura mayor → queda el resto por cobrar; menor → el sobrante del depósito vuelve a «por conciliar».
    let ajusteCom=null
    if(pagoAnt&&progRow?.billing_type==='comision'&&dteTot!=null&&!DEMO){
      const {data:cs}=await supabase.from('conciliacion').select('id,movimiento_id,monto_aplicado').eq('factura_id',item.progId)
      const aplic=(cs||[]).reduce((a,c)=>a+(Number(c.monto_aplicado)||0),0)
      if(dteTot>aplic+1){ Object.assign(patch,{status:'Pendiente', paid:false, paid_at:null, paid_amount:aplic}); ajusteCom={tipo:'falta', dif:dteTot-aplic} }
      else if(dteTot<aplic-1&&(cs||[]).length===1){ const c=cs[0], dif=aplic-dteTot
        const {error:ce}=await supabase.from('conciliacion').update({monto_aplicado:dteTot}).eq('id',c.id); if(ce) throw ce
        const {data:mv}=await supabase.from('cartola_movimientos').select('monto_conciliado').eq('id',c.movimiento_id).maybeSingle()
        const mc=Math.max(0,(Number(mv?.monto_conciliado)||0)-dif)
        const {error:me}=await supabase.from('cartola_movimientos').update({monto_conciliado:mc, estado:mc>0?'parcial':'pendiente'}).eq('id',c.movimiento_id); if(me) throw me
        ajusteCom={tipo:'sobra', dif} }
    }
    const { error } = await supabase.from('billing').update(patch).eq('id',item.progId)
    if(error) throw error
    if(ajusteCom){ logActividad('facturacion.comision_monto_distinto',{tabla:'billing',id:item.progId,detalle:{folio:String(item.row.folio),title:ajusteCom.tipo==='falta'?'Comisión: la factura es mayor que el depósito (resto por cobrar)':'Comisión: el depósito es mayor que la factura (sobrante por conciliar)',monto:ajusteCom.dif}})
      appAlert(ajusteCom.tipo==='falta'?`La Factura N° ${item.row.folio} es ${fmt(ajusteCom.dif)} mayor que el depósito: esa diferencia queda por cobrar.`:`El depósito era ${fmt(ajusteCom.dif)} mayor que la Factura N° ${item.row.folio}: esa diferencia queda por conciliar en Banco.`) }
    setBilling&&setBilling(p=>p.map(x=>x.id===item.progId?{...x,...patch}:x))
    marcarStaged(item.row.folio,'registrada',item.progId)   // sale de "Cargadas sin registrar"
  }
  const doRegistrar = async(item)=>{ setRegBusy(item.progId); try{ await registrarProg(item); setRespaldoRes(p=>(p||[]).map(r=>r===item?{...r,estado:'registrada'}:r)) }catch(e){ appAlert('No se pudo registrar: '+(e.message||e)) } setRegBusy(null); onRefresh&&onRefresh() }
  const doRegistrarLote = async(items)=>{ setRegBusy('lote'); let ok=0; for(const it of items){ try{ await registrarProg(it); ok++; setRespaldoRes(p=>(p||[]).map(r=>r===it?{...r,estado:'registrada'}:r)) }catch(_){} } setRegBusy(null); setRegReview(null); onRefresh&&onRefresh(); appAlert(`${ok} de ${items.length} factura${items.length!==1?'s':''} registrada${ok!==1?'s':''}.`) }
  // Panel "Crear venta" desde una nueva: abre con todo auto-llenado (glosa → título/UF; área+abogado heredados del cliente).
  const abrirCrearVenta = (item)=>{ const glosa=item.glosa||item.row?.concepto||''; const uf=ufDeGlosa(glosa); const cid=item.clienteId; const lastV=cid?(sales||[]).filter(s=>!s.deleted_at&&String(s.client_id)===String(cid)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]:null; setCvForm({ title:(glosa.split('—')[0].trim()||glosa||'Servicio'), ufVal:uf?String(uf):'', area:lastV?.area||'Corporativo', responsible:lastV?.responsible||user?.name||'' }); setCrearVentaFor(item) }
  const doCrearVenta = async(item)=>{ if(!onCrearVentaRapida) return; setCvBusy(true); try{ const res=await onCrearVentaRapida(item,{ title:cvForm.title, ufVal:parseFloat(String(cvForm.ufVal).replace(',','.'))||null, area:cvForm.area, responsible:cvForm.responsible||null }); if(res){ setRespaldoRes(p=>(p||[]).map(r=>r===item?{...r,estado:'creada',cliente:(clients||[]).find(c=>String(c.id)===String(res.factura?.client_id))?.name||item.cliente}:r)); if(res.factura?.id) marcarStaged(item.row?.folio,'registrada',res.factura.id); setCrearVentaFor(null) } }catch(e){ appAlert('No se pudo crear la venta: '+(e.message||e)) } setCvBusy(false); onRefresh&&onRefresh() }
  const abrirTercero = (item)=>{ setTvProv(''); setTvNuevo(''); setTvPct(''); setCrearVentaFor(null); setTerceroFor(item) }
  // Al elegir el externo, pre-carga el % que RETENEMOS aprendido para él (ej. Rodrigo = 15). Editable.
  const elegirTercero = (pid)=>{ setTvProv(pid); if(pid){ setTvNuevo(''); const p=comisionTercMap[String(pid)]; if(p!=null) setTvPct(String(p)) } }
  const doTercero = async(item)=>{ if(!onFacturaTercero) return; setTvBusy(true); try{ let pid=tvProv; if(!pid&&tvNuevo.trim()&&onSaveProveedor){ const np=await onSaveProveedor({nombre:tvNuevo.trim()}); if(np) pid=np.id } if(!pid){ appAlert('Elige el externo o escribe su nombre.'); setTvBusy(false); return } const pct=Math.max(0,Math.min(100,parseFloat(String(tvPct).replace(',','.'))||0)); const res=await onFacturaTercero(item,{proveedorId:pid,comisionPct:pct}); if(res){ if(pct>0) setComisionTercMap(m=>({...m,[String(pid)]:pct})); setRespaldoRes(p=>(p||[]).map(r=>r===item?{...r,estado:'tercero',proveedorNombre:res.proveedor?.razon_social||res.proveedor?.nombre||''}:r)); if(res.factura?.id) marcarStaged(item.row?.folio,'registrada',res.factura.id); setTerceroFor(null) } }catch(e){ appAlert('No se pudo registrar la factura del externo: '+(e.message||e)) } setTvBusy(false); onRefresh&&onRefresh() }
  const [moreOpen,setMoreOpen] = useState(false)   // menú ⋯ (Resumen/Proveedores/Anticipos/Sin año)
  const [siiPageOpen,setSiiPageOpen] = useState(false)   // Facturación electrónica: tarjeta de entrada → página (modal)
  const [saludCobranza,setSaludCobranza] = useState(false)   // panel de salud de cobranza (DSO, tasa, morosidad, top deudores)
  const [recOpen,setRecOpen] = useState(()=>new Set())   // "Por recordar": clientes con su grupo expandido (default colapsado)
  const [recPreview,setRecPreview] = useState(null)   // {b,to,r} → modal de vista previa del recordatorio de cobro
  const [siiPanel,setSiiPanel] = useState(null)    // panel del módulo Emisión electrónica SII: null | 'set' | 'libro'
  const [siiBusy,setSiiBusy] = useState(false)
  // Llamada a la edge function sii-sync (emisión/certificación). Reusa el token de sesión.
  const siiCall = async(body)=>{
    const {data:{session}}=await supabase.auth.getSession()
    if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
    const res=await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-sync',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey},body:JSON.stringify(body)})
    const d=await res.json().catch(()=>({})); if(!res.ok) throw new Error(d.error||('Error '+res.status)); return d
  }
  const siiProbar = async()=>{ setSiiBusy(true); try{ const d=await siiCall({action:'test-auth'}); const e=await siiCall({action:'test-auth',uso:'emision'}); appAlert(`Conexión con el SII correcta.\nLectura: ${d.ambiente} · Emisión: ${e.ambiente}`) }catch(e){ appAlert('No se pudo conectar al SII: '+e.message) } setSiiBusy(false) }
  // Intercambio de información (certificación): el SII entrega un EnvioDTE; la app devuelve las tres respuestas firmadas para subirlas al portal.
  const siiIntercambio = async(file)=>{ if(!file) return; setSiiBusy(true)
    try{ const xml=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result||'')); r.onerror=()=>rej(new Error('No se pudo leer el archivo.')); r.readAsText(file,'ISO-8859-1') })
      const d=await siiCall({action:'intercambio', envioXml:xml, nombreArchivo:file.name, contacto:{nombre:user?.name||'', mail:user?.email||''}})
      siiDescargarXml(d.recepcion,'respuesta_recepcion.xml'); siiDescargarXml(d.resultado,'respuesta_resultado.xml'); siiDescargarXml(d.recibos,'recibos_ley_19983.xml')
      appAlert(`Respuestas del intercambio listas: ${d.docs.length} documento(s) de ${d.emisor}${d.ajenos?` · ${d.ajenos} con otro RUT receptor (respondidos como rechazados)`:''}.\nSe descargaron 3 archivos: acuse de recibo, aprobación comercial y recibo Ley 19.983. Súbelos en el portal de certificación del SII.`) }
    catch(e){ appAlert('No se pudo armar el intercambio: '+e.message) }
    setSiiBusy(false) }
  const siiVerificarEstados = async()=>{ setSiiBusy(true); try{ const d=await siiCall({action:'verificar-estados'}); appAlert(`Estados verificados en el SII:\n${d.revisados} revisado(s) · ${d.cambiados} actualizado(s)${d.rechazadas?`\n${d.rechazadas} rechazada(s) — revisa tu correo`:''}.`); if(d.cambiados&&onRefresh) await onRefresh() }catch(e){ appAlert('No se pudo verificar estados: '+e.message) } setSiiBusy(false) }
  const siiResumenSemanal = async()=>{ setSiiBusy(true); try{ const d=await siiCall({action:'resumen-semanal'}); appAlert(`Resumen semanal enviado a los admins.\nEmitidas (7d): ${d.emitidasSemana} · Por cobrar: $${(d.porCobrar||0).toLocaleString('es-CL')} · Vencido: $${(d.vencido||0).toLocaleString('es-CL')}.`) }catch(e){ appAlert('No se pudo enviar el resumen: '+e.message) } setSiiBusy(false) }
  // TRAÍDO HISTÓRICO DEL SII (solo lectura). Recorre 2025-01 → 2026-06 (un mes antes del 1er pago
  // hasta antes del sello directo del SII) llamando la acción read-only 'sync-ventas-rcv', que espeja
  // el RCV (facturas + notas de crédito) en sii_cargas_docs con estado 'rcv_historico' SIN tocar billing.
  const [siiHistProg,setSiiHistProg] = useState(null)   // progreso: {mes,i,total,guardadas,nc,docs,done?,errores?}
  const siiTraerHistorico = async()=>{
    if(siiBusy) return
    const meses=[]; let y=2025,m=1; while(y<2026||(y===2026&&m<=6)){ meses.push(`${y}-${String(m).padStart(2,'0')}`); m++; if(m>12){m=1;y++} }
    setSiiBusy(true); let guardadas=0,nc=0,docs=0; const errores=[]
    for(let i=0;i<meses.length;i++){ const mes=meses[i]; setSiiHistProg({mes,i:i+1,total:meses.length,guardadas,nc,docs})
      try{ const d=await siiCall({action:'sync-ventas-rcv',periodo:mes}); guardadas+=(d.guardadas||0); nc+=(d.notasCredito||0); docs+=(d.totalSII||0) }
      catch(e){ errores.push(`${mes}: ${e.message||e}`) } }
    setSiiHistProg({i:meses.length,total:meses.length,guardadas,nc,docs,done:true,errores}); setSiiBusy(false)
    appAlert(`Histórico del SII traído (solo lectura):\n${docs} documento(s) del SII · ${guardadas} nuevo(s) guardado(s) · ${nc} nota(s) de crédito.${errores.length?`\n\nMeses con error (${errores.length}):\n`+errores.join('\n'):''}`)
  }
  // #4 · Detector de NOTAS DE CRÉDITO del RCV por resolver: NC 61 espejadas en sii_cargas_docs cuya factura referida (detFolioDocRef) SIGUE VIVA (no anulada) y aún no tiene su fila NC en billing. Van a la MISMA compuerta (anularPorNC) — nunca anula sola.
  const [ncResolver,setNcResolver] = useState(null)   // null = sin cargar; [] = ninguna por resolver
  const cargarNCResolver = async()=>{
    try{
      const { data, error } = await supabase.from('sii_cargas_docs').select('id,folio,tipo_dte,fecha_emision,receptor_rut,receptor_name,monto,doc_json,billing_id').eq('tipo_dte','61')
      if(error) throw error
      const norm=r=>String(r||'').replace(/\D/g,'')
      const out=[]
      for(const d of (data||[])){
        if(d.billing_id) continue   // ya enlazada
        const ref = d.doc_json?.detFolioDocRef || (Array.isArray(d.doc_json?.referencias)&&d.doc_json.referencias[0]?.folioRef) || null
        let fac=null, inferido=false
        if(ref){ const fn=norm(ref); fac=(billing||[]).find(b=>!b.deleted_at && b.billing_type!=='nota_credito' && norm(b.invoice_no)===fn) }
        if(!fac){
          // Fallback: el RCV no trae la referencia → calce por RUT + monto EXACTO. Solo si hay UN candidato vivo (nunca ambiguo).
          const rn=norm(d.receptor_rut), mn=Math.round(Number(d.monto)||0)
          const cand = (rn&&mn) ? (billing||[]).filter(b=>!b.deleted_at && b.billing_type!=='nota_credito' && b.invoice_no && b.status!=='Anulada' && norm(b.receptor_rut)===rn && Math.round(Number(b.amount)||0)===mn) : []
          if(cand.length===1){ fac=cand[0]; inferido=true }
        }
        if(!fac || fac.status==='Anulada') continue   // sin factura viva referida → nada que resolver
        if((billing||[]).some(b=>b.billing_type==='nota_credito' && !b.deleted_at && norm(b.invoice_no)===norm(d.folio))) continue   // ya registrada
        const cli=clients.find(c=>String(c.id)===String(fac.client_id))
        out.push({ ncFolio:d.folio, ncFecha:d.fecha_emision, monto:d.monto, receptor:d.receptor_name, rut:d.receptor_rut, siiId:d.id, inferido,
          facId:fac.id, facFolio:folioN(fac.invoice_no)||fac.invoice_no, facStatus:fac.status, facCliente:cli?.name||fac.receptor_name||null, replId:null, replFolio:null, replCliente:null, doc:null })
      }
      setNcResolver(out)
    }catch(_){ setNcResolver([]) }
  }
  useEffect(()=>{ if(siiPageOpen) cargarNCResolver() },[siiPageOpen, billing])   // eslint-disable-line
  const [foliosEstado,setFoliosEstado] = useState(null)   // [{tipoDte,disponibles}] folios CAF disponibles (para la alerta de folios bajos)
  useEffect(()=>{ let on=true; siiCall({action:'folios-estado'}).then(d=>{ if(on&&Array.isArray(d?.folios)) setFoliosEstado(d.folios) }).catch(()=>{}); return ()=>{on=false} },[])
  const [siiLog,setSiiLog] = useState(null)   // historial de emisión (tabla dte_log)
  const cargarSiiLog = async()=>{ setSiiLog(null); setSiiPanel('log'); try{ const {data}=await supabase.from('dte_log').select('*').order('created_at',{ascending:false}).limit(60); setSiiLog(data||[]) }catch(_){ setSiiLog([]) } }
  const [siiSetJson,setSiiSetJson] = useState('')   // casos del set de pruebas (JSON array de facturas que asigna el SII)
  const [siiPeriodo,setSiiPeriodo] = useState('')   // período del Libro de Ventas (YYYY-MM)
  const [siiResult,setSiiResult] = useState(null)
  const SII_SET_SAMPLE = JSON.stringify([
    {tipoDte:34,receptor:{rut:'66666666-6',rs:'CLIENTE DE PRUEBA SII',giro:'Servicios',dir:'Calle 123',comuna:'Santiago'},items:[{nombre:'Servicio profesional',monto:100000}]},
    {tipoDte:61,exenta:true,receptor:{rut:'66666666-6',rs:'CLIENTE DE PRUEBA SII'},items:[{nombre:'Anula factura',monto:100000}],referencias:[{tpoDocRef:34,folioRef:1,fchRef:new Date().toISOString().slice(0,10),codRef:1,razonRef:'Anula factura de prueba'}]},
  ],null,2)
  const siiEmitirSet = async(dryRun)=>{ setSiiBusy(true); setSiiResult(null); try{ const facturas=JSON.parse(siiSetJson||'[]'); if(!Array.isArray(facturas)||!facturas.length) throw new Error('Pega el set de casos (un array JSON de facturas).'); const d=await siiCall({action:'emitir-set',facturas,dryRun}); setSiiResult(d) }catch(e){ setSiiResult({error:e.message}) } setSiiBusy(false) }
  const siiLibro = async()=>{ setSiiBusy(true); setSiiResult(null); try{ if(!/^\d{4}-\d{2}$/.test(siiPeriodo)) throw new Error('Período en formato AAAA-MM (ej. 2026-07).'); const det=(billing||[]).filter(b=>b.dte_track_id&&(b.dte_emitido_at||'').slice(0,7)===siiPeriodo&&!b.deleted_at).map(b=>{ const ent=(clientEntities||[]).find(e=>String(e.id)===String(b.entity_id)); return {tpoDoc:34,nroDoc:Number(b.folio)||0,fchDoc:(b.issued_at||'').slice(0,10),rutDoc:ent?.rut||b.receptor_rut||'',rznSoc:ent?.name||b.receptor_name||'',mntExe:Math.round(b.amount||0),mntTotal:Math.round(b.amount||0)} }); const d=await siiCall({action:'libro-ventas',periodo:siiPeriodo,detalle:det}); setSiiResult({...d,nDet:det.length}) }catch(e){ setSiiResult({error:e.message}) } setSiiBusy(false) }
  // Los XML para el SII se declaran ISO-8859-1: se bajan con esos bytes (un byte por carácter), no en UTF-8.
  const siiDescargarXml = (xml,name)=>{ try{ const s=String(xml||''), b=new Uint8Array(s.length); for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i); b[i]=c<256?c:63 } const url=URL.createObjectURL(new Blob([/ISO-8859-1/i.test(s.slice(0,80))?b:s],{type:'application/xml'})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),30000) }catch(_){} }
  // Bandeja de envío: facturas emitidas que aún no se mandaron por correo al cliente.
  const [bandejaEnvio,setBandejaEnvio] = useState(()=>!!viewMemLeer('billing')?.bandejaEnvio)
  useEffect(()=>{ viewMemGuardar('billing',{filter,cierreOpen,xmlHub,bandejaEnvio}) },[filter,cierreOpen,xmlHub,bandejaEnvio])
  const [masivoSaldo,setMasivoSaldo] = useState(false)   // en el envío masivo: incluir el recordatorio de saldo pendiente (opcional, off por defecto)
  const [factToMap,setFactToMap] = useState({})   // client_id → correo aprendido (learnings factura_to), para mostrar a quién va
  const abrirBandeja = async()=>{ setBandejaEnvio(true); try{ const {data}=await supabase.from('learnings').select('key,value').eq('kind','factura_to'); const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=r.value }); setFactToMap(m) }catch(_){} }
  const [envioMasivoBusy,setEnvioMasivoBusy] = useState(false)
  // Envío masivo (etapa 2): manda, desde la cuenta de oficina, las facturas por enviar que YA tienen destinatario recordado (factura_to).
  // PDF automático desde el DTE emitido; plantilla por defecto (sin pulir con IA, una a una). Las sin correo se omiten (van a mano).
  const enviarTodas = async()=>{
    const porEnviar=(billing||[]).filter(b=>!b.deleted_at&&sinEnviar(b))
    const conDest=porEnviar.filter(b=>factToMap[String(b.client_id)])
    const sinDest=porEnviar.length-conDest.length
    if(!conDest.length){ appAlert('Ninguna factura por enviar tiene un destinatario recordado todavía.\nEnvíalas una a una: ahí eliges el correo y la app lo aprende para la próxima.'); return }
    // Modo del lote: si hay acceso a Gmail → desde TU correo; si no, se pregunta antes de usar la oficina (o se cancela).
    const _tok = await driveToken()
    let batchModo = _tok ? 'usuario' : null
    if(!batchModo){
      if(!await appConfirm(`No se pudo preparar el envío desde tu correo: tu acceso a Gmail expiró.\nPara que salgan desde TU correo: cierra sesión y vuelve a entrar con tu cuenta @${BRAND.emailDominio}.\n\n¿Enviar las ${conDest.length} desde la cuenta de oficina en su lugar?${sinDest?`\n(${sinDest} se omiten sin correo recordado.)`:''}\n(Cancelar = no enviar)`)) return
      batchModo='oficina'
    } else if(!await appConfirm(`Enviar ${conDest.length} factura(s) desde TU correo a su destinatario recordado.${sinDest?`\n${sinDest} se omiten (sin correo recordado).`:''}\n\n¿Continuar?`)) return
    setEnvioMasivoBusy(true)
    const firma=firmaDefault(user?.email)||{nombre:user?.name||'',cargo:'Abogado',telefono:''}
    let ok=0, err=0
    for(const b of conDest){
      try{
        const dest=factToMap[String(b.client_id)]
        const sale=mejorVenta(b, sales, b.client_id)
        const saldoTxt = masivoSaldo ? saldoPendienteMsg(b.client_id, [String(b.id)], billing, 'es') : ''
        const body = facturaCorreoBody(b, sale, 'es', true) + (saldoTxt?`\n\n${saldoTxt}`:'') + `\n\n${CORREO_DESPEDIDA('es')}`
        const html=facturaCorreoHtml(body, firma, false)
        const folio=folioN(b.invoice_no||'')||b.invoice_no||''
        let pdf=null; if(b.dte_xml){ try{ const doc=splitSetDTE(b.dte_xml)[0]; if(doc) pdf=await facturaDtePdfBase64(doc) }catch(_){} }
        const via=await enviarComoUsuario({to:dest, subject:`Factura ${folio}`, html, text:body, ...(pdf?{pdfBase64:pdf.base64, pdfName:`Factura ${folio}.pdf`}:{})}, batchModo)
        if(via===null){ err++; continue }
        const at=new Date().toISOString()
        try{ okDB(await supabase.from('billing').update({email_sent_at:at}).eq('id',b.id),'marcar la factura como enviada') }catch(e){registrarError({origen:'accion',vista:'billing',err:e})}
        setBilling&&setBilling(p=>p.map(x=>x.id===b.id?{...x,email_sent_at:at}:x))
        ok++
      }catch(_){ err++ }
    }
    setEnvioMasivoBusy(false)
    appAlert(txtResumenEnvio({ok, no:err, via:batchModo, que:ok===1?'factura':'facturas', g:'a'})+(sinDest?`\n(${sinDest} sin correo recordado, omitida${sinDest!==1?'s':''}.)`:''))
  }
  // Deshacer un envío (ej. una prueba): limpia email_sent_at → la factura vuelve a "Por enviar". Reversible (vuelves a Enviar cuando quieras).
  const onUnsendFactura = async (b) => {
    const cli=clients.find(c=>String(c.id)===String(b.client_id))
    if(!await appConfirm(`¿Marcar la Factura N° ${folioN(b.invoice_no)||b.folio||''} como NO enviada?\nVuelve a "Por enviar"${cli?.name?` (${cli.name})`:''}. Útil si el envío fue una prueba.`)) return
    try{ okDB(await supabase.from('billing').update({email_sent_at:null}).eq('id',b.id),'marcar la factura como no enviada') }catch(e){registrarError({origen:'accion',vista:'billing',err:e})}
    setBilling&&setBilling(p=>p.map(x=>x.id===b.id?{...x,email_sent_at:null}:x))
  }
  // Año GLOBAL de Facturación (resumen + interiores + Ficha lo leen). '' = Todos. Persistido en localStorage.
  const [fYear,setFYear] = useState(()=>{ try{ const v=localStorage.getItem('fac_year'); return v!=null?v:String(currentYear) }catch(e){ return String(currentYear) } })
  useEffect(()=>{ try{ localStorage.setItem('fac_year', fYear||'') }catch(e){} },[fYear])
  const [fMonth,setFMonth] = useState('')
  const [showMeses,setShowMeses] = useState(false)
  const [showBuscar,setShowBuscar] = useState(false)
  const [q,setQ] = useState('')
  const [payingId,setPayingId] = useState(null)
  const [expandBill,setExpandBill] = useState(null)
  const [pagando,setPagando] = useState(false)
  const [payDate,setPayDate] = useState('')
  const [inclTerceros,setInclTerceros] = useState(true)   // al pagar la factura ancla: ¿el pago incluyó los terceros?
  const [payMonto,setPayMonto] = useState('')   // monto a registrar; si < saldo deja la factura Pendiente con abono (paid_amount)
  const fmtDMY = fmtFechaDMY   // delega al helper global (evita la copia local divergente)
  const [openClients,setOpenClients] = useState(()=>new Set())
  const toggleClient = id => setOpenClients(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const collapseAll = () => setOpenClients(new Set())
  const [pcOrden,setPcOrden] = useState('cliente')   // vista "Facturas sin cliente / venta": orden (cliente A-Z / fecha / folio ↑↓)
  const [pcConfirm,setPcConfirm] = useState(null)    // confirmación inline antes de aplicar una asignación (no desaparece sin OK)
  // Radar "Cuotas vencidas sin facturar": programadas de meses cerrados que no se emitieron. noEmitirSet = las que el usuario marcó "no corresponde" (aprende y deja de marcarlas).
  const [noEmitirSet,setNoEmitirSet] = useState(()=>new Set())
  useEffect(()=>{ if(typeof DEMO!=='undefined'&&DEMO) return; supabase.from('learnings').select('key').eq('kind','cuota_no_emitir').then(({data})=>{ setNoEmitirSet(new Set((data||[]).map(r=>String(r.key)))) },()=>{}) },[])
  const marcarNoEmitir = async(bill)=>{ setNoEmitirSet(p=>new Set([...p,String(bill.id)])); if(typeof DEMO==='undefined'||!DEMO){ try{ await setLearningKV('cuota_no_emitir',String(bill.id),'1') }catch(e){registrarError({origen:'accion',vista:'cuota_no_emitir',err:e})} } }
  const [siiBuscaFor,setSiiBuscaFor] = useState(null)   // {id, hechos, total} mientras "Buscar en SII" sincroniza el período de una cuota del radar
  // Trabajos sin facturar (regla única trabajosSinFacturar, _shared/ventasReglas.js; la usa también el correo de pendientes):
  // decidirTrabajo guarda la respuesta (learnings trabajo_sin_facturar) y el trabajo deja de aparecer aquí y en el correo.
  const [tsfDecididos,setTsfDecididos] = useState(()=>new Set())
  useEffect(()=>{ if(typeof DEMO!=='undefined'&&DEMO) return; supabase.from('learnings').select('key').eq('kind','trabajo_sin_facturar').then(({data})=>{ setTsfDecididos(new Set((data||[]).map(r=>String(r.key)))) },()=>{}) },[])
  const ufTsf = useUF().uf || 0
  const trabajosSF = useMemo(()=>trabajosSinFacturar({ sales, billing, uf: ufFechaCache()||{}, ufHoy: ufTsf, hoy: new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}), noEmitir: noEmitirSet, decididos: tsfDecididos }),[sales,billing,ufTsf,noEmitirSet,tsfDecididos])
  const decidirTrabajo = async(sale, estado, motivo)=>{ setTsfDecididos(p=>new Set([...p,String(sale.id)])); if(typeof DEMO==='undefined'||!DEMO){ try{ await setLearningKV('trabajo_sin_facturar',String(sale.id),JSON.stringify({estado,motivo,fecha:new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}),quien:user?.email||null})); logActividad('facturacion.trabajo_sin_facturar',{tabla:'sales',id:sale.id,detalle:{title:`${sale.title||'Trabajo'} · ${motivo}`}}) }catch(e){registrarError({origen:'accion',vista:'trabajo_sin_facturar',err:e})} } }
  const [selected,setSelected] = useState(()=>new Set())
  const toggleSel = id => setSelected(prev=>{const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n})
  const clearSel = () => setSelected(new Set())
  const MONTHS = MES_C
  // Rediseño tab Emitidas: dos acordeones maestros (cerrados por defecto)
  const [openPendiente,setOpenPendiente] = useState(false)
  const [openPorFacturar,setOpenPorFacturar] = useState(false)
  const [selExcel,setSelExcel] = useState(()=>new Set())   // filas marcadas para el Excel (Bloque 2)
  const [emitiendo,setEmitiendo] = useState(null)          // id de la programada en flujo "Ya emitida"
  const [emitEnt,setEmitEnt] = useState('')                // entity_id elegido en "Ya emitida"
  const [descExcel,setDescExcel] = useState(false)

  const bb = billing.filter(b=>b.billing_type!=='reembolso')   // Facturación excluye reembolsos de gastos
  // Año de venta de una factura: de la venta asociada (sale_id → sales.year) o el año asignado a mano (sale_year).
  const [anioPickFor,setAnioPickFor] = useState(null)
  const [ventaBusca,setVentaBusca] = useState('')          // buscador del selector de venta (cola "Sin año")
  const [verCerradas,setVerCerradas] = useState(false)     // mostrar también ventas cerradas en el selector
  const [reprocBusy,setReprocBusy] = useState(false)
  const [anioLearned,setAnioLearned] = useState({})   // client_id → año aprendido (sugerencia)
  useEffect(()=>{ supabase.from('learnings').select('key,value').eq('kind','venta_anio_cliente').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[r.key]=Number(r.value) }); setAnioLearned(m) },()=>{}) },[])
  const saleYrById = useMemo(()=>{ const m={}; sales.forEach(s=>{ if(s.year!=null) m[String(s.id)]=s.year }); return m },[sales])
  // Año de venta ESTRICTO (single source, igual que Inicio/ProyeccionDetalle): venta enlazada (sale_id→sales.year) o año a mano (sale_year); NADA de respaldo por issued_at (eso enmascaraba facturas sin enlazar y desalineaba Inicio vs Facturación).
  const anioVentaDe = b => (b.sale_id&&saleYrById[String(b.sale_id)]!=null)?saleYrById[String(b.sale_id)]:(b.sale_year!=null?b.sale_year:null)
  const sinAnio = useMemo(()=> bb.filter(b=>b.status==='Pagado'&&!['comision','externo','subarriendo'].includes(b.billing_type)&&anioVentaDe(b)==null).sort((a,b)=>new Date(b.paid_at||0)-new Date(a.paid_at||0)),[bb,saleYrById])
  const yearBtns = useMemo(()=>{ const ys=sales.map(s=>s.year).filter(Boolean); return [...new Set([currentYear,currentYear-1,currentYear-2,currentYear-3,...ys])].sort((a,b)=>b-a).slice(0,6) },[sales])
  // Cuentas por pagar a proveedores ancladas a cada factura (terceros_pagos.billing_id)
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
    else if(filter==='vencido') r = r.filter(b=>b.status==='Vencido')
    else if(filter==='pagado') r = r.filter(b=>b.status==='Pagado')
    else if(filter==='terceros') r = r.filter(b=>tercerosByBilling.has(b.id))
    else if(filter==='rechazadas') r = r.filter(b=>/rech/i.test(b.dte_estado||''))   // deep-link del banner "DTE rechazadas por el SII"
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
    return Object.values(byClient).sort((a,b)=>(a.client?.name||'').localeCompare(b.client?.name||'','es'))
  },[filtered,clients])

  // KPIs acotados al año/mes del filtro. Cada estado usa su fecha relevante: Programada→vencimiento, Pagado→pago, resto→emisión.
  const matchYM = dateStr => { if(!fYear&&!fMonth) return true; if(!dateStr) return false; if(fYear&&String(dateStr).slice(0,4)!==fYear) return false; if(fMonth&&String(dateStr).slice(5,7)!==fMonth) return false; return true }
  const kpiDate = b => b.status==='Programada'?b.due:(b.status==='Pagado'?(b.paid_at||b.issued_at):b.issued_at)
  // UF en vivo: una programada en UF muestra su CLP recalculado al valor UF del día (display, no toca DB).
  // La UF pactada de la cuota se recupera de su CLP guardado y el uf_value de la venta al generarse.
  const ufInfoDe = b => {
    if(b?.status!=='Programada' || !b.sale_id || !ufHoy) return null
    const s=(sales||[]).find(x=>String(x.id)===String(b.sale_id))
    if(!s || s.moneda==='CLP' || !s.uf_value) return null
    const uf=(b.amount||0)/s.uf_value
    if(!uf) return null
    return { uf, clpHoy: Math.round(uf*ufHoy) }
  }
  // "Ya facturadas" (duplicados): facturas SIN folio cuya factura emitida REAL ya existe (mismo cliente, cuota N/M o período, monto ±tolerancia). Inflan el "por facturar"; se vinculan a su factura emitida.
  const yaFacturadasIds = useMemo(()=> new Set(matchProgEmitidas(bb,clients,clientEntities).map(m=>String(m.prog.id))), [bb,clients,clientEntities])   // fuente única (detector compartido)
  // KPIs — MISMA fuente que el landing: Por cobrar = total cuentas por cobrar (emitidas con saldo, NO depende del año); Por facturar = sin folio real (excluye las ya facturadas).
  const pending=bb.filter(b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status)).reduce((s,b)=>s+saldoBill(b),0)
  const overdue=bb.filter(b=>b.invoice_no&&(b.status==='Vencido'||(b.status==='Pendiente'&&esVencidaB(b)))).reduce((s,b)=>s+saldoBill(b),0)   // mismo criterio que la lista (estadoReal) y Cobranza: status Vencido o emisión+30 ya pasada
  const paid=bb.filter(b=>cobradoBill(b)>0&&matchYM(kpiDate(b))).reduce((s,b)=>s+cobradoBill(b),0)   // incluye parciales (fuente única cobradoBill)
  const programado=bb.filter(b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)&&!yaFacturadasIds.has(b.id)&&matchYM(kpiDate(b))).reduce((s,b)=>s+(b.amount||0),0)
  // Contadores por nº de documentos para las tabs
  const nEmitidas=bb.filter(b=>['Pendiente','Vencido','Propuesta'].includes(b.status)).length
  const nProgramadas=bb.filter(b=>b.status==='Programada').length
  const nPagadas=bb.filter(b=>b.status==='Pagado').length
  const years=[...new Set(bb.flatMap(b=>[b.issued_at?.slice(0,4),b.due?.slice(0,4)]).filter(Boolean))].sort((a,b)=>b-a)

  const confirmPago = async() => {
    if(pagando) return   // evita doble submit
    const pb = billing.find(b=>String(b.id)===String(payingId))||{}
    const total=pb.amount||0, ya=pb.paid_amount||0
    const monto=Math.max(0, parseInt(String(payMonto).replace(/[^\d]/g,''))||0)
    if(monto<=0){ appAlert('Ingresa un monto mayor a 0.'); return }
    setPagando(true)
    if(ya+monto>=total){   // pago completo → Pagado (limpia abono parcial)
      const pend = (terceros||[]).filter(t=>String(t.billing_id)===String(payingId)&&t.estado==='pendiente')
      await onStatusChange(payingId,'Pagado',payDate,{paid_amount:null})
      if(pend.length&&inclTerceros&&onConciliarTerceros) await onConciliarTerceros(payingId)
    } else {   // abono parcial → la factura sigue en su estado, con saldo (paid_amount acumulado)
      await onStatusChange(payingId, pb.status, undefined, {paid_amount: ya+monto})
    }
    setPagando(false); setPayingId(null)
  }
  const [facturaEmail,setFacturaEmail] = useState(null)   // factura cuya ventana de "Enviar por correo" está abierta
  const [facturasEmail,setFacturasEmail] = useState(null)   // VARIAS facturas del mismo cliente en un correo (Enviar juntas)
  const [soloSinEnviar,setSoloSinEnviar] = useState(false)   // filtro: solo facturas emitidas que aún no se envían por correo
  const esEmitida = b => b.invoice_no && b.status!=='Programada' && b.status!=='Anulada'
  // "Por enviar" = SOLO facturas EMITIDAS POR LA APP (tienen dte_track_id) que aún no se mandaron por correo.
  // Las facturas históricas (emitidas/enviadas fuera de la app, sin dte_track_id) YA fueron enviadas a sus clientes —
  // nunca cuentan como pendientes de envío (regla del usuario: nada del histórico pendiente).
  // REGLA ÚNICA "por enviar" (2026-10-08, verificada en prod): emitida con folio + XML del SII + sin correo registrado + impaga.
  // Antes exigía dte_track_id (solo facturas emitidas DESDE la app): en prod ninguna lo tiene → la bandeja daba siempre 0.
  // La lista de "Facturas del mes" (porEnviar) usa este mismo criterio, filtrado por mes de emisión.
  const sinEnviar = b => esEmitida(b) && !!b.dte_xml && !b.email_sent_at && !b.sent_at && (b.status==='Pendiente'||b.status==='Vencido')
  // Estado de envío por correo de una factura emitida: null si no aplica; si no, {txt,col}.
  // Solo marcamos si ya se envió por la app (email_sent_at). Nunca "Sin enviar" (las facturas ya se enviaron fuera de la app; sería engañoso).
  const envioBadge = b => { if(!esEmitida(b)||!b.email_sent_at) return null; const d=Math.floor((Date.now()-new Date(b.email_sent_at).getTime())/86400000); return {txt:d>0?`Enviada · ${d}d`:'Enviada',col:C.greenText} }
  const [cobranzaOpen,setCobranzaOpen] = useState(false)
  const venceG = venceBill      // fuente única de fecha de vencimiento
  const esVencidaG = esVencidaB  // fuente única de "está vencida"
  // Memoria de recordatorios enviados (sin columna nueva): learnings factura_recordado, key=factura.id → fecha ISO del último recordatorio.
  const [recordadoMap,setRecordadoMap] = useState({})
  const [recNotaMap,setRecNotaMap] = useState({})   // client_id → nota libre para el recordatorio de cobro (persistente)
  const [recNota,setRecNota] = useState('')         // nota en edición en la vista previa del recordatorio
  useEffect(()=>{ let alive=true; supabase.from('learnings').select('key,value').eq('kind','factura_recordado').order('updated_at',{ascending:true}).then(({data})=>{ if(alive&&data){ const m={}; data.forEach(r=>{ m[r.key]=r.value }); setRecordadoMap(m) } },()=>{}); return ()=>{alive=false} },[])
  useEffect(()=>{ let alive=true; supabase.from('learnings').select('key,value').eq('kind','recordatorio_nota').order('updated_at',{ascending:true}).then(({data})=>{ if(alive&&data){ const m={}; data.forEach(r=>{ if(r.value) m[r.key]=r.value }); setRecNotaMap(m) } },()=>{}); return ()=>{alive=false} },[])
  const diasDesde = iso => iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null
  // "Buscar pago": trae los abonos del banco (cartola) a Facturación para conciliar cada factura desde aquí. Reusa el calce exacto (monto = saldo, TOL=0) + el RUT del receptor; la marca-pagada va por onStatusChange (probada).
  const nrG = crNormRut   // normalizador único de RUT
  const efClientIdG = b => b.client_id || (b.receptor_rut ? (clientEntities.find(e=>nrG(e.rut)===nrG(b.receptor_rut))?.client_id) : null) || null
  const [abonos,setAbonos] = useState([])
  useEffect(()=>{ if(DEMO){ setAbonos((demoData.cartola_movimientos||[]).filter(m=>m.tipo==='abono'&&!m.es_interno)); return } let alive=true; selectAll(()=>supabase.from('cartola_movimientos').select('*').eq('tipo','abono').neq('es_interno',true).order('fecha',{ascending:false}).order('id')).then(({data})=>{ if(alive&&data) setAbonos(data) },()=>{}); return ()=>{alive=false} },[])
  // Detalle de conciliación por factura (factura_id → movimiento + monto aplicado), para mostrar los abonos bajo cada factura.
  const [concFac,setConcFac] = useState([])
  useEffect(()=>{ let alive=true; selectAll(()=>supabase.from('conciliacion').select('factura_id,movimiento_id,monto_aplicado').eq('tipo_destino','factura').order('id')).then(({data})=>{ if(alive&&data) setConcFac(data) },()=>{}); return ()=>{alive=false} },[])
  const abonosDe = b => concFac.filter(c=>String(c.factura_id)===String(b.id)).map(c=>({c, m:abonos.find(a=>String(a.id)===String(c.movimiento_id))})).filter(x=>x.m)
  const [pagosFor,setPagosFor] = useState(null)   // factura.id cuyo "Buscar pago" está abierto
  const [pagoBusy,setPagoBusy] = useState(false)
  const [otraFor,setOtraFor] = useState(null)     // abono.id cuyo selector "Otra factura" está abierto
  const [otraQ,setOtraQ] = useState('')
  // Otras facturas para conciliar un abono: TODAS las del cliente (o mismo RUT) que NO estén pagadas-conciliadas (saldo>0).
  // Orden: mismo RUT del receptor → misma RS → emitida antes del pago y más cercana (criterio fecha/rut/rs).
  const otrasFacturas = (m) => {
    const rut=nrG(m.rut_contraparte), q=otraQ.trim().toLowerCase()
    const mCli=m.cliente_id?String(m.cliente_id):null
    return (bb||[]).filter(b=>!b.deleted_at && esEmitida(b) && saldoBill(b)>0 && ((mCli&&String(efClientIdG(b))===mCli) || (rut&&nrG(b.receptor_rut)===rut)))
      .filter(b=>!q || (`factura ${folioN(b.invoice_no)} ${b.concept||''} ${b.receptor_name||''}`).toLowerCase().includes(q))
      .map(b=>{ const rutM=!!(rut&&nrG(b.receptor_rut)===rut); const rsM=!!(m.nombre_contraparte&&b.receptor_name&&_normTxt(b.receptor_name)===_normTxt(m.nombre_contraparte)); const before=!!(b.issued_at&&b.issued_at<=m.fecha); const prox=Math.abs((new Date(b.issued_at||0).getTime()-new Date(m.fecha||0).getTime())/86400000); const exacto=saldoBill(b)===((m.monto||0)-(m.monto_conciliado||0)); return {b,rutM,rsM,before,prox,exacto} })
      .sort((a,z)=> (z.exacto?1:0)-(a.exacto?1:0) || (z.rutM?1:0)-(a.rutM?1:0) || (z.rsM?1:0)-(a.rsM?1:0) || (z.before?1:0)-(a.before?1:0) || a.prox-z.prox)
      .slice(0,25)
  }
  // Abonos del banco que CALZAN exacto con el saldo de la factura, del mismo cliente o RUT del receptor, no conciliados.
  const pagosDe = b => { const cid=efClientIdG(b); const rut=nrG(b.receptor_rut); const saldo=saldoBill(b)
    return abonos.filter(m=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); if(m.estado==='conciliado'||resto<=0) return false
        const mrut=nrG(m.rut_contraparte); const mc=cid&&String(m.cliente_id)===String(cid); const mr=!!rut&&!!mrut&&mrut===rut
        // Si ABONO y FACTURA tienen RUT, exige que COINCIDA (misma RS); no basta el mismo cliente. Si a alguno le falta el RUT, cae a cliente.
        const match = (rut&&mrut) ? mr : mc
        return match && resto===saldo })
      .map(m=>({m, rut:!!(rut&&nrG(m.rut_contraparte)===rut)}))
      .sort((a,z)=>(z.rut?1:0)-(a.rut?1:0)||String(z.m.fecha||'').localeCompare(String(a.m.fecha||''))) }
  // Sugerencia por IDENTIDAD del pagador (mismo RUT/RS o cliente), aunque el MONTO no calce exacto (eso ya lo da pagosDe). Es solo sugerencia para revisar (parcial / otra factura) — nunca concilia sola.
  const pagosRutSugeridos = b => { const cid=efClientIdG(b); const rut=nrG(b.receptor_rut); const saldo=saldoBill(b); if(saldo<=0) return []
    return abonos.filter(m=>{ const resto=(m.monto||0)-(m.monto_conciliado||0); if(m.estado==='conciliado'||resto<=0) return false
        const mrut=nrG(m.rut_contraparte); const mr=!!rut&&!!mrut&&mrut===rut; const mc=!!cid&&String(m.cliente_id)===String(cid)
        const match = (rut&&mrut) ? mr : mc   // misma lógica de identidad que pagosDe
        return match && resto!==saldo })       // excluye el calce exacto (ese ya es el verde)
      .map(m=>({m, rut:!!(rut&&nrG(m.rut_contraparte)===rut)}))
      .sort((a,z)=>(z.rut?1:0)-(a.rut?1:0)||String(z.m.fecha||'').localeCompare(String(a.m.fecha||''))) }
  // Concilia un abono con una factura (calce exacto = pago total): inserta la conciliación + marca el movimiento + deja la factura pagada (onStatusChange).
  const conciliarPago = async(m, b) => {
    if(pagoBusy) return
    const saldo=saldoBill(b)
    const resto=(m.monto||0)-(m.monto_conciliado||0)
    const aplicado=Math.min(resto,saldo)
    if(aplicado<=0){ appAlert('Ese movimiento ya no tiene saldo por imputar.'); return }
    const cubre=aplicado>=saldo   // el abono cubre TODO el saldo de la factura → queda pagada; si no, es pago parcial
    // "Mostrar todo antes de conciliar" (directriz del usuario): el confirm despliega el detalle COMPLETO — factura+cliente+glosa+saldo y el movimiento del banco (fecha, monto, quién pagó, RUT, n° operación) — nunca concilia a ciegas.
    const cli=clients.find(c=>String(c.id)===String(b.client_id))?.name||b.receptor_name||'cliente'
    const rn=r=>String(r||'').replace(/[.\s-]/g,'').toUpperCase()
    const rutOk=!!(b.receptor_rut&&m.rut_contraparte&&rn(b.receptor_rut)===rn(m.rut_contraparte))
    const detalle=`FACTURA N° ${folioN(b.invoice_no)} · ${cli}${b.concept?`\n${b.concept}`:''}\nSaldo por cobrar: ${fmt(saldo)}\n\nPAGO DEL BANCO:\n${fmtDate(m.fecha)} · ${fmt(m.monto)}${m.nombre_contraparte?` · ${m.nombre_contraparte}`:''}${m.rut_contraparte?`\nRUT ${m.rut_contraparte}`:''}${m.n_operacion?` · Op ${m.n_operacion}`:''}${resto!==(m.monto||0)?`\nDisponible por imputar: ${fmt(resto)}`:''}${rutOk?'\n✓ Mismo RUT que la factura':''}\n\n`
    const msg = cubre
      ? detalle+`¿Conciliar? La factura quedará PAGADA y enlazada a este movimiento del banco.`
      : detalle+`El pago disponible (${fmt(resto)}) es MENOR que el saldo (${fmt(saldo)}).\n¿Imputar ${fmt(aplicado)} como pago PARCIAL? La factura seguirá pendiente con saldo ${fmt(saldo-aplicado)}.`
    if(!await appConfirm(msg)) return
    setPagoBusy(true)
    try{
      const ins=await supabase.from('conciliacion').insert({movimiento_id:m.id,tipo_destino:'factura',factura_id:b.id,monto_aplicado:aplicado,origen:'manual',marco_pago:cubre}).select().single()
      if(ins.error) throw ins.error
      if(ins.data?.id && user?.email){ try{ supabase.from('conciliacion').update({created_by:user.email}).eq('id',ins.data.id).then(()=>{},()=>{}) }catch(e){registrarError({origen:'accion',vista:'conciliacion',err:e})} }   // auditoría: quién concilió (resiliente si la columna no existe) — alinea con persistPagoFactura/marcaQuien
      setConcFac(p=>[...p,{factura_id:b.id,movimiento_id:m.id,monto_aplicado:aplicado}])   // refleja el saldo nuevo en vivo
      const movAplicado=(m.monto_conciliado||0)+aplicado
      const estado=((m.monto||0)-movAplicado)<=0?'conciliado':'parcial'
      await supabase.from('cartola_movimientos').update({estado,monto_conciliado:movAplicado}).eq('id',m.id)
      setAbonos(p=>p.map(x=>x.id===m.id?{...x,estado,monto_conciliado:movAplicado}:x))
      if(cubre) await onStatusChange(b.id,'Pagado',m.fecha,{paid:true,paid_amount:(b.amount||0),payment_method:'Transferencia',payment_ref:m.n_operacion||null,payment_date:m.fecha,reconciled_at:new Date().toISOString()},{skipRespaldoWarn:true})   // marca pagada + metadata (paid/paid_amount/payment_method/ref/reconciled_at) igual que la Conciliación (persistPagoFactura). SOLO si el abono cubre el saldo; en parcial la factura sigue pendiente (respaldo refleja el saldo). skip: ya estamos conciliando
      setPagosFor(null); setOtraFor(null)
      appAlert(cubre?'Pago conciliado. La factura quedó pagada y enlazada al movimiento del banco.':'Pago parcial imputado. La factura mantiene su saldo restante.')
    }catch(e){ appAlert('No se pudo conciliar: '+(e.message||e)) }
    setPagoBusy(false)
  }
  // #8 Calce cercano por DIFERENCIA DE UF (programación vs emisión): en una venta en UF la cuota se PROGRAMA con el uf_value de la venta (queda en b.amount) y se EMITE a la UF del día (queda en el DTE = montoFactura). El cliente suele pagar el monto PROGRAMADO → el abono queda unos pesos MENOR que el saldo (el DTE), y ese faltante ES la variación de UF. La tolerancia NO es un % inventado: la calculamos de la propia factura (gapUF) y solo aceptamos si el faltante observado calza con ella (margen de redondeo).
  const gapUF = b => { const dte=montoFactura(b); const prog=b.amount||0; return (b.dte_xml && dte>prog) ? (dte-prog) : 0 }   // diferencia UF prog→emisión, probada por la factura; 0 en CLP / sin DTE / DTE≤programado (se auto-restringe a UF)
  const esCalceCercano = (m,b) => { const g=gapUF(b); if(g<=0) return 0; const saldo=saldoBill(b); if(saldo<=0) return 0
    const rut=nrG(b.receptor_rut); const mrut=nrG(m.rut_contraparte); if(!rut||!mrut||mrut!==rut) return 0
    const resto=(m.monto||0)-(m.monto_conciliado||0); if(resto<=0) return 0
    const shortfall=saldo-resto; if(shortfall<=0) return 0
    const tol=Math.max(1000, Math.round(saldo*0.001))   // solo redondeo: el cliente paga la proforma (monto programado) redondeada al peso
    return Math.abs(shortfall-g)<=tol ? shortfall : 0 }  // el faltante coincide con la diferencia de UF que la factura misma prueba → devuelve lo que se saldará
  const calcesCercanos = b => abonos.filter(m=>m.estado!=='conciliado'&&esCalceCercano(m,b)>0).map(m=>({m,dif:esCalceCercano(m,b)})).sort((a,z)=>a.dif-z.dif)
  // Concilia un calce cercano: el abono SALDA la factura (queda Pagada) y la diferencia (variación de UF) NO queda como saldo pendiente. Con compuerta (detalle completo) y reversible (Deshacer conciliación).
  const conciliarCalceCercano = async(m,b) => {
    if(pagoBusy) return
    const saldo=saldoBill(b); const resto=(m.monto||0)-(m.monto_conciliado||0); const dif=saldo-resto; const prog=b.amount||0; const dte=montoFactura(b)
    if(resto<=0||dif<=0){ appAlert('Este movimiento ya no calza como diferencia de UF.'); return }
    const cli=clients.find(c=>String(c.id)===String(b.client_id))?.name||b.receptor_name||'cliente'
    const pct=saldo>0?(dif/saldo*100):0
    const detalle=`FACTURA N° ${folioN(b.invoice_no)} · ${cli}${b.concept?`\n${b.concept}`:''}\nEmitido (DTE): ${fmt(dte)}\nProgramado: ${fmt(prog)}\n\nPAGO DEL BANCO:\n${fmtDate(m.fecha)} · ${fmt(m.monto)}${m.nombre_contraparte?` · ${m.nombre_contraparte}`:''}${m.rut_contraparte?`\nRUT ${m.rut_contraparte}`:''}${m.n_operacion?` · Op ${m.n_operacion}`:''}\n\nEl cliente pagó el monto PROGRAMADO. La diferencia de ${fmt(dif)} (${pct.toFixed(1)}%) es por la variación de la UF entre la programación de la cuota y la emisión de la factura.\n\n¿Conciliar? La factura quedará SALDADA; los ${fmt(dif)} se registran como diferencia de UF, no como saldo pendiente.`
    if(!await appConfirm(detalle)) return
    setPagoBusy(true)
    try{
      const ins=await supabase.from('conciliacion').insert({movimiento_id:m.id,tipo_destino:'factura',factura_id:b.id,monto_aplicado:resto,origen:'manual',marco_pago:true}).select().single()
      if(ins.error) throw ins.error
      if(ins.data?.id && user?.email){ try{ supabase.from('conciliacion').update({created_by:user.email}).eq('id',ins.data.id).then(()=>{},()=>{}) }catch(e){registrarError({origen:'accion',vista:'conciliacion',err:e})} }
      setConcFac(p=>[...p,{factura_id:b.id,movimiento_id:m.id,monto_aplicado:resto}])
      const movAplicado=(m.monto_conciliado||0)+resto
      await supabase.from('cartola_movimientos').update({estado:'conciliado',monto_conciliado:movAplicado}).eq('id',m.id)
      setAbonos(p=>p.map(x=>x.id===m.id?{...x,estado:'conciliado',monto_conciliado:movAplicado}:x))
      await onStatusChange(b.id,'Pagado',m.fecha,{paid:true,paid_amount:resto,payment_method:'Transferencia',payment_ref:m.n_operacion||null,payment_date:m.fecha,reconciled_at:new Date().toISOString()},{skipRespaldoWarn:true})   // paid_amount = lo que realmente llegó al banco (monto programado); saldoBill devuelve 0 con status Pagado → factura saldada, la diferencia de UF no queda como saldo
      setPagosFor(null); setOtraFor(null)
      appAlert(`Conciliado. La factura quedó saldada; ${fmt(dif)} se registró como diferencia de UF.`)
    }catch(e){ appAlert('No se pudo conciliar: '+(e.message||e)) }
    setPagoBusy(false)
  }
  const [calcesOpen,setCalcesOpen] = useState(true)
  // Calces sugeridos: para cada factura pendiente/vencida, los abonos que calzan exacto. 1:1 inequívoco → "limpio" (se concilia de un toque); ambiguo (un abono ↔ 2+ facturas o una factura ↔ 2+ abonos) → "revisar" (eliges).
  const calcesSugeridos = useMemo(()=>{
    // Pool: TODA factura emitida con saldo>0 (= cualquier estado MENOS pagada-conciliada, que tiene saldo 0), excepto anuladas.
    const pend = bb.filter(b=>!b.deleted_at && esEmitida(b) && b.status!=='Anulada' && saldoBill(b)>0)
    const pairs0=[]; pend.forEach(b=>{ pagosDe(b).forEach(({m,rut})=> pairs0.push({factura:b, abono:m, rut})) })
    // Prioridad MISMA RS: si un abono tiene algún cruce con el mismo RUT del receptor, descarta los de otra RS del mismo cliente.
    const abonoConRut={}; pairs0.forEach(p=>{ if(p.rut) abonoConRut[p.abono.id]=true })
    const pairs = pairs0.filter(p=> !abonoConRut[p.abono.id] || p.rut)
    const facPorAbono={}, aboPorFac={}
    pairs.forEach(p=>{ (facPorAbono[p.abono.id]=facPorAbono[p.abono.id]||new Set()).add(String(p.factura.id)); (aboPorFac[p.factura.id]=aboPorFac[p.factura.id]||new Set()).add(String(p.abono.id)) })
    const clean=[], revMap={}
    pairs.forEach(p=>{ const amb = facPorAbono[p.abono.id].size>1 || aboPorFac[p.factura.id].size>1
      if(amb){ const r=revMap[p.abono.id]=revMap[p.abono.id]||{abono:p.abono,facturas:[]}; if(!r.facturas.some(f=>String(f.id)===String(p.factura.id))) r.facturas.push(p.factura) }
      else clean.push(p) })
    clean.sort((a,z)=> (z.rut?1:0)-(a.rut?1:0) || (esVencidaG(z.factura)?1:0)-(esVencidaG(a.factura)?1:0) || String(z.abono.fecha||'').localeCompare(String(a.abono.fecha||'')) )
    // Facturas "en disputa": una misma factura calza con 2+ abonos → solo uno puede pagarla. Se avisa para no doble-conciliar.
    const contested = new Set(Object.keys(aboPorFac).filter(fid=>aboPorFac[fid].size>1))
    return {clean, revisar:Object.values(revMap), contested}
  },[bb, abonos, clientEntities])
  // Facturas con un pago del banco DETECTADO pero aún sin conciliar → estado "Por conciliar" (mismo concepto que el Cierre de mes).
  // Se usa para NO ofrecer "Recordar cobro" a quien YA pagó (solo falta conciliar), y para resaltar la acción de conciliar.
  const porConciliarIds = useMemo(()=>{ const s=new Set(); calcesSugeridos.clean.forEach(({factura})=>s.add(String(factura.id))); calcesSugeridos.revisar.forEach(r=>r.facturas.forEach(f=>s.add(String(f.id)))); return s },[calcesSugeridos])
  // Estado de cuenta: correo al cliente con TODAS sus facturas pendientes + total adeudado (práctica estándar de cobranza). Compuerta de confirmación.
  const estadoCuentaEnviar = async(cli)=>{
    if(!cli) return
    const pend=(billing||[]).filter(b=>!b.deleted_at&&String(b.client_id)===String(cli.id)&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&saldoBill(b)>0).sort((a,b)=>(a.due||'')<(b.due||'')?-1:1)
    if(!pend.length){ appAlert(`${cli.name} no tiene facturas pendientes.`); return }
    let to=(cli.email||'').trim()
    try{ const {data:lt}=await supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(cli.id)).maybeSingle(); if(lt?.value) to=String(lt.value).trim() }catch(_){}
    if(!to){ appAlert('El cliente no tiene correo (ni en la ficha ni recordado). Agrégalo para enviar el estado de cuenta.'); return }
    const total=pend.reduce((s,b)=>s+saldoBill(b),0)
    if(!await appConfirm(`¿Enviar el estado de cuenta de ${cli.name} a ${to}?\n${pend.length} factura(s) pendiente(s) · total ${fmt(total)}`)) return
    const filas=pend.map(b=>`<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">N° ${folioN(b.invoice_no)||b.invoice_no}</td><td style="padding:6px 8px;border-bottom:1px solid #eee">${b.due?fmtFechaDMY(b.due):'—'}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">$${saldoBill(b).toLocaleString('es-CL')}</td></tr>`).join('')
    const html=`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e4e8eb;border-radius:12px;overflow:hidden"><div style="background:#003C50;padding:18px;text-align:center"><img src="${location.origin}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="26" style="height:26px"/></div><div style="padding:22px;color:#1a1a1a;font-size:14px;line-height:1.6">Estimados,<br><br>Espero que estén muy bien. Les compartimos el estado de cuenta con las facturas pendientes a la fecha:<br><br><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #003C50">Factura</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #003C50">Vence</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #003C50">Saldo</th></tr></thead><tbody>${filas}</tbody><tfoot><tr><td colspan="2" style="padding:8px 8px;font-weight:bold">Total adeudado</td><td style="padding:8px 8px;text-align:right;font-weight:bold;color:#003C50">$${total.toLocaleString('es-CL')}</td></tr></tfoot></table><br>${DATOS_PAGO_HTML}Quedamos atentos a su confirmación.<br><br>Saludos cordiales,<br><b>${BRAND.nombre}</b></div></div>`
    const text=`Estado de cuenta — ${cli.name}\n\n${pend.map(b=>`N° ${folioN(b.invoice_no)||b.invoice_no} · vence ${b.due?fmtFechaDMY(b.due):'—'} · $${saldoBill(b).toLocaleString('es-CL')}`).join('\n')}\n\nTotal adeudado: ${fmt(total)}\n\n${DATOS_PAGO_TXT}\n\nSaludos cordiales,\n${BRAND.nombre}`
    try{ const via=await enviarComoUsuario({to, subject:`Estado de cuenta — ${BRAND.nombre}`, html, text}); if(via) appAlert(txtEnviado(via,{que:'Estado de cuenta',para:to})) }catch(e){ appAlert('No se pudo enviar: '+(e.message||e)) }
  }
  // Recordar cobro desde la Facturación global: correo al cliente (busca su email por client_id) con compuerta de confirmación.
  // Resuelve el correo del cliente igual que los envíos de facturas: ficha → correo aprendido (factura_to) → contactos.
  const resolverCorreoCliente = async(clientId, cl)=>{ let to=(cl?.email||'').trim()
    if(!to){ try{ const {data}=await supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(clientId)).maybeSingle(); if(data?.value) to=String(data.value).split(/[,;]/)[0].trim() }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
    if(!to){ try{ const {data}=await supabase.from('contacts').select('email,principal').eq('client_id',clientId); const c=(data||[]).find(x=>x.principal&&x.email)||(data||[]).find(x=>x.email); if(c) to=String(c.email).trim() }catch(e){registrarError({origen:'accion',vista:'contacts',err:e})} }
    return to }
  const recordarCobro = async(b)=>{
    const cl=clients.find(c=>String(c.id)===String(b.client_id))
    const to=await resolverCorreoCliente(b.client_id, cl)
    if(!to){ appAlert('El cliente no tiene correo (ni en la ficha, ni aprendido de facturas, ni en contactos). Agrégalo para recordar el cobro.'); return }
    setRecNota(recNotaMap[String(b.client_id)]||'')   // precarga la nota guardada de este cliente
    setRecPreview({b, to})   // la vista previa arma el correo en vivo con la nota (editable)
  }
  // Envía el recordatorio ya previsualizado (desde el modal de vista previa). La nota se guarda por cliente.
  const enviarRecordatorio = async({b, to, nota})=>{
    const r=recordatorioCobro(b, nota)
    try{ const ad=await facturaPdfAdjunto(b); const via=await enviarComoUsuario({to, subject:r.subject, html:r.html, text:r.text, attachments:ad?[ad]:null}); if(via){ const at=new Date().toISOString(); try{ await setLearningKV('factura_recordado',String(b.id),at); setRecordadoMap(m=>({...m,[String(b.id)]:at})) }catch(e){registrarError({origen:'accion',vista:'recordatorio_nota',err:e})}; const cid=String(b.client_id||''); if(cid){ try{ await setLearningKV('recordatorio_nota',cid,String(nota||'')); setRecNotaMap(m=>({...m,[cid]:String(nota||'')})) }catch(e){registrarError({origen:'accion',vista:'recordatorio_nota',err:e})} }; setRecPreview(null); appAlert(txtEnviado(via,{que:`Recordatorio (${r.nivel})`,para:to})) } }
    catch(e){ appAlert('No se pudo enviar el recordatorio: '+e.message) }
  }
  // Recordatorio de cobro por TANDA (desde el Cierre de mes): una sola compuerta que lista los destinatarios;
  // envía secuencialmente desde tu cuenta (mismo generador que el individual). Correos SIEMPRE desde el usuario.
  const recordarCobroTanda = async(facturas)=>{
    const dest = (facturas||[]).map(b=>{ const cl=clients.find(c=>String(c.id)===String(b.client_id)); const to=(cl?.email||'').trim(); return to?{b,to,name:cl?.name||'Cliente',r:recordatorioCobro(b, recNotaMap[String(b.client_id)]||'')}:null }).filter(Boolean)
    const sinCorreo = (facturas||[]).length - dest.length
    if(!dest.length){ appAlert('Ninguna de estas facturas tiene correo del cliente en la ficha para recordar.'); return }
    if(!await appConfirm(`¿Enviar ${dest.length} recordatorio${dest.length!==1?'s':''} de cobro desde tu cuenta?\n\n${dest.slice(0,8).map(d=>`· ${d.name} — ${d.r.folio}`).join('\n')}${dest.length>8?`\n… y ${dest.length-8} más`:''}${sinCorreo>0?`\n\n(${sinCorreo} sin correo se omiten.)`:''}`)) return
    const modo=await modoEnvioLote(dest.length)
    if(modo==='cancelar'){ appAlert(txtResumenEnvio({ok:0,no:dest.length,que:'recordatorios'})); return }
    let ok=0
    for(const d of dest){ try{ const ad=await facturaPdfAdjunto(d.b); const via=await enviarComoUsuario({to:d.to, subject:d.r.subject, html:d.r.html, text:d.r.text, attachments:ad?[ad]:null}, modo); if(via){ ok++; const at=new Date().toISOString(); try{ await setLearningKV('factura_recordado',String(d.b.id),at) }catch(e){registrarError({origen:'accion',vista:'factura_recordado',err:e})}; setRecordadoMap(m=>({...m,[String(d.b.id)]:at})) } }catch(e){registrarError({origen:'accion',vista:'factura_recordado',err:e})} }
    appAlert(txtResumenEnvio({ok, no:dest.length-ok, via:modo, que:ok===1?'recordatorio':'recordatorios'})+(sinCorreo>0?`\n(${sinCorreo} sin correo en la ficha, omitido${sinCorreo!==1?'s':''}.)`:''))
  }
  // Acuse de pago: confirma al cliente que recibimos el pago de una factura ya pagada/conciliada.
  const acuseCobro = async(b)=>{
    const cl=clients.find(c=>String(c.id)===String(b.client_id))
    const to=(cl?.email||'').trim()
    if(!to){ appAlert('El cliente no tiene correo en su ficha. Agrégalo para poder enviar el acuse.'); return }
    const folio=b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'la factura'
    const monto='$'+(b.amount||0).toLocaleString('es-CL')
    if(!await appConfirm(`¿Enviar acuse de pago a ${to} por ${folio} (${monto})?`)) return
    try{ const via=await acusePagoEmail(to,{folio,monto,fecha:b.paid_at?fmtFechaDMY(b.paid_at):''}); if(via) appAlert(txtEnviado(via,{que:'Acuse de pago',para:to})) }
    catch(e){ appAlert('No se pudo enviar el acuse: '+e.message) }
  }
  const emitirConRS = async(b) => { const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id); const ent=b.entity_id?ents.find(e=>e.id===b.entity_id):(ents.length===1?ents[0]:null); await onEmitir(b, ent||null) }
  const marcarEmitida = async(b) => { const ui=ufInfoDe(b); const msg=ui?`Emitir por ${fmtUF(ui.uf)} = ${fmt(ui.clpHoy)} (UF de hoy).\n¿Confirmas? Pasará a Pendiente de cobro.`:'¿Confirmas que la factura ya se emitió? Pasará a Pendiente de cobro.'; if(await appConfirm(msg)) await emitirConRS(b) }
  const marcarEmitidasBulk = async() => { const ids=[...selected]; if(!ids.length) return; if(!await appConfirm(`¿Marcar ${ids.length} factura(s) como emitidas? Pasarán a Pendiente de cobro.`)) return; for(const id of ids){ const b=progMes.find(x=>x.id===id); if(b) await emitirConRS(b) } clearSel() }

  const [descargando,setDescargando] = useState(false)
  const descargarProgramadas = async() => {
    if(filtered.length===0){ appAlert('No hay programadas en el filtro actual.'); return }
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
    }catch(e){ appAlert('Error al generar Excel: '+e.message) }
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
    if(!sel.length){ appAlert('Marca al menos una fila para exportar.'); return }
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
    }catch(e){ appAlert('Error al generar Excel: '+e.message) }
    setDescExcel(false)
  }

  // "Ya emitida" (respaldo manual): convierte la programada en emitida + asigna razón social
  const confirmarEmitida = async(b) => {
    const ents=(clientEntities||[]).filter(e=>e.client_id===b.client_id)
    const ent = emitEnt ? ents.find(e=>e.id===emitEnt) : (ents.length===1?ents[0]:null)
    const ui=ufInfoDe(b); if(ui && !await appConfirm(`Emitir por ${fmtUF(ui.uf)} = ${fmt(ui.clpHoy)} (UF de hoy)?`)) return
    await onEmitir(b, ent||null)
    setEmitiendo(null); setEmitEnt('')
  }

  // Render de un grupo cliente→razón social (reutilizado por el Bloque 1 y por las otras tabs)
  const renderClientGroup = ({client,byEntity}) => {
    const allBills = Object.values(byEntity).flat()
    const clientTotal = allBills.reduce((a,b)=>a+montoFactura(b),0)   // DTE, no amount (fuente única; subtotal = Σ filas)
    const nDocs = allBills.length
    const vencidoMonto = allBills.filter(b=>b.status==='Vencido').reduce((a,b)=>a+saldoBill(b),0)
    const isOpen = openClients.has(client.id)
    return (
      <div key={client.id} style={{marginBottom:isOpen?16:8}}>
        <button onClick={()=>toggleClient(client.id)} style={{width:'100%',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isOpen?6:0,paddingBottom:4,borderBottom:`2px solid ${C.accent}`,background:'none',border:'none',borderBottomColor:C.accent,cursor:'pointer',textAlign:'left'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            <span style={{fontSize:12,color:C.accent,transform:isOpen?'rotate(90deg)':'none',transition:'transform .15s',display:'inline-block',flexShrink:0}}><Gl n='chevron'/></span>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{onOpenClientFicha?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(client.id)}} style={{cursor:'pointer'}}>{client.name}</span>:client.name}</div>
              {(()=>{ const rs=rsLabel(client.id,clients,clientEntities); return (rs.name!==client.name&&!rs.multi)?<div style={{fontSize:10,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rsDisplay(rs.name)}{rs.rut?` · ${fmtRutCL(rs.rut)}`:''}</div>:null })()}
              {!isOpen&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{nDocs} doc{nDocs!==1?'s':''}{vencidoMonto>0&&<span style={{color:C.overdue,fontWeight:700}}> · {fmt(vencidoMonto)} vencido</span>}</div>}
            </div>
          </div>
          <div style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0,marginLeft:8}}>{fmt(clientTotal)}</div>
        </button>
        {isOpen&&Object.entries(byEntity).map(([ename,bills])=>(
          <div key={ename} style={{marginBottom:10,marginLeft:8}}>
            {ename!=='—'&&<div style={{fontSize:11,fontWeight:600,color:C.muted,marginBottom:4,display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{width:4,height:4,borderRadius:'50%',background:C.muted,display:'inline-block'}}/>
                {ename}
              </div>
              <span style={{fontSize:11,fontWeight:700,color:C.muted}}>{fmt(bills.reduce((a,b)=>a+montoFactura(b),0))}</span>
            </div>}
            {bills.map(b=>{
              const prog=b.status==='Programada', anulada=b.status==='Anulada', pagado=b.status==='Pagado', anticipada=b.status==='Anticipada'
              const dl=daysLeft(b.due)
              const dEmis=b.issued_at?Math.max(0,Math.round((Date.now()-new Date(b.issued_at+'T12:00').getTime())/86400000)):null
              const semCol=(pagado||anticipada)?C.muted:(dl==null?C.muted:dl<0?C.overdue:dl<=7?C.soon:C.normal)
              const diasMini=(!pagado&&!anticipada&&dl!=null)?(dl<0?`${Math.abs(dl)}d`:dl<=7?`${dl}d`:''):''
              const exp=expandBill===b.id
              return (
              <div key={b.id} style={{background:C.card,borderRadius:10,marginBottom:6,border:`1px solid ${C.border}`,overflow:'hidden'}}>
                <div onClick={()=>setExpandBill(exp?null:b.id)} style={{display:'flex',gap:9,alignItems:'center',padding:'10px 12px',cursor:'pointer'}}>
                  {prog&&<input type='checkbox' checked={selected.has(b.id)} onClick={e=>e.stopPropagation()} onChange={()=>toggleSel(b.id)} style={{flexShrink:0,cursor:'pointer'}}/>}
                  {bigDate(kpiDate(b))}
                  <SIcon n={estadoCobro(b).icon} s={15} c={semCol}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',textDecoration:anulada?'line-through':'none'}}>{b.concept||'—'}{['reembolso','comision','externo'].includes(b.billing_type)&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.bgSoft,color:(TIPOS_FACTURA.find(x=>x.k===b.billing_type)||{}).col||C.muted,fontWeight:700,marginLeft:6,whiteSpace:'nowrap'}}>{tipoFacturaLbl(b)}</span>}{anticipada&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.greenBg,color:C.greenText,fontWeight:700,marginLeft:6,whiteSpace:'nowrap'}}>Anticipada</span>}{tercerosByBilling.has(b.id)&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.accent,fontWeight:700,marginLeft:6,whiteSpace:'nowrap'}}>Proveedores</span>}</div>
                    <div style={{fontSize:11,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{prog?'Programada':`Factura N° ${folioN(b.invoice_no)||'—'}`}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:(dl!=null&&dl<0&&!pagado&&!anticipada)?C.overdue:C.text,whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</div>
                    {diasMini&&<div style={{fontSize:10,fontWeight:600,color:semCol,marginTop:1}}>{diasMini}</div>}
                  </div>
                </div>
                {(()=>{ const r=facturaRespaldo(b,respaldoMap,cartolaHasta); return r?<div style={{padding:'0 12px 9px 61px'}}><RespaldoBadge b={b} respaldoMap={respaldoMap} cartolaHasta={cartolaHasta}/></div>:null })()}
                {exp&&<><div onClick={e=>e.stopPropagation()} style={{padding:'8px 12px',borderTop:`1px solid ${C.border}`,fontSize:11,color:C.muted,lineHeight:1.6}}>
                  <div>Concepto: <b style={{color:C.text}}>{b.concept||'—'}</b></div>
                  {b.receptor_name&&<div>Razón social: <b style={{color:C.text}}>{b.receptor_name}</b>{b.receptor_rut?` · ${fmtRutCL(b.receptor_rut)}`:''}</div>}
                  <div>Emisión: {b.issued_at?fmtFechaDMY(b.issued_at):'—'}{b.due?` · vence ${fmtFechaDMY(b.due)}`:''}{pagado&&b.paid_at?` · pagada ${fmtFechaDMY(b.paid_at)}`:''}</div>
                  <div>Monto: {fmt(montoFactura(b))}{!pagado&&!anulada&&!prog?` · saldo ${fmt(saldoBill(b))}`:''}</div>
                  {pagado&&(()=>{ const ap=respaldoMap[b.id]||0; const col=ap>=(b.amount||0)&&ap>0?C.greenText:ap>0?C.soonText:C.overdueText; return <div>Respaldo banco: <b style={{color:col}}>{ap>0?`${fmt(ap)}${ap<(b.amount||0)?` de ${fmt(b.amount)}`:''}`:'sin movimiento (marcada a mano)'}</b></div> })()}
                </div>
                <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'0 12px 9px'}}>
                  {client.id==='__none__'&&onAssignClient&&!prog&&<AsignarClienteInline bill={b} clients={clients} onAssign={onAssignClient}/>}
                  {prog ? (
                    <button onClick={()=>marcarEmitida(b)} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Ya emitida</button>
                  ):(!anulada&&!pagado&&!anticipada)?(
                    <button onClick={()=>onConciliar&&onConciliar(client)} title='El pago se registra conciliándolo contra el banco' style={{fontSize:11,fontWeight:600,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Buscar pago</button>
                  ):(pagado&&onRevertirPago)?(
                    <button onClick={async()=>{ if(await appConfirm('¿Marcar esta factura como NO pagada? Vuelve a Pendiente y se borra la fecha de pago.')) onRevertirPago(b)}} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 12px',cursor:'pointer'}}>Deshacer pago</button>
                  ):(anulada&&onReactivar)&&(
                    <ActBtn variant='ghost' onClick={async()=>{ if(await appConfirm('¿Reactivar esta factura anulada? Vuelve a su estado previo y se borra el registro de baja.')) onReactivar(b)}}>Reactivar</ActBtn>
                  )}
                  <ActBtn variant='ghost' onClick={()=>onEdit(b)}>Editar</ActBtn>
                </div></>}
              </div>
              )
            })}
          </div>
        ))}
      </div>
    )
  }
  return { comPorFacturarDe, siiOpen, setSiiOpen, depurarRows, setDepurarRows, cubrirAnt, setCubrirAnt, facturarAnt, setFacturarAnt, filter, setFilter, cotejoMes, setCotejoMes, cierreOpen, setCierreOpen, ufHoy, estSel, setEstSel, isDesktop, agingF, setAgingF, groupOpen, setGroupOpen, rsSel, setRsSel, ESTADO_MAP, irAEstado, irAEstadoAging, estadoActivo, impOpen, setImpOpen, respaldoRef, procResp, setProcResp, respaldoRes, setRespaldoRes, respaldoFiles, setRespaldoFiles, respaldoAt, setRespaldoAt, respaldoBatchId, setRespaldoBatchId, batchIdRef, respaldoSummaryRef, cargasHist, setCargasHist, mesTandaReq, setMesTandaReq, xmlHub, setXmlHub, sinRegN, setSinRegN, sinRegDocs, cargandoStage, setCargandoStage, matchProgramada, marcarStaged, contarSinRegistrar, procesarRespaldoSII, cargarSinRegistrar, abrirHistCargas, creandoFac, setCreandoFac, crearCli, setCrearCli, ensureBatch, crearDesdeXML, ncConfirm, setNcConfirm, ncVincular, setNcVincular, ncBusy, setNcBusy, anularPorNC, regBusy, setRegBusy, regReview, setRegReview, respaldoRetry, reintentarRespaldos, backfillRespaldos, backfillBusy, progPick, setProgPick, secOpen, setSecOpen, crearVentaFor, setCrearVentaFor, cvForm, setCvForm, cvBusy, setCvBusy, terceroFor, setTerceroFor, queCorr, setQueCorr, tvProv, setTvProv, tvNuevo, setTvNuevo, tvBusy, setTvBusy, tvPct, setTvPct, comisionTercMap, setComisionTercMap, registrarProg, doRegistrar, doRegistrarLote, abrirCrearVenta, doCrearVenta, abrirTercero, elegirTercero, doTercero, moreOpen, setMoreOpen, siiPageOpen, setSiiPageOpen, saludCobranza, setSaludCobranza, recOpen, setRecOpen, siiPanel, setSiiPanel, siiBusy, setSiiBusy, siiCall, siiProbar, siiVerificarEstados, siiResumenSemanal, siiTraerHistorico, siiHistProg, ncResolver, cargarNCResolver, foliosEstado, setFoliosEstado, siiLog, setSiiLog, cargarSiiLog, siiSetJson, setSiiSetJson, siiPeriodo, setSiiPeriodo, siiResult, setSiiResult, SII_SET_SAMPLE, siiEmitirSet, siiLibro, siiDescargarXml, siiIntercambio, bandejaEnvio, setBandejaEnvio, masivoSaldo, setMasivoSaldo, factToMap, setFactToMap, abrirBandeja, envioMasivoBusy, setEnvioMasivoBusy, enviarTodas, onUnsendFactura, fYear, setFYear, fMonth, setFMonth, showMeses, setShowMeses, showBuscar, setShowBuscar, q, setQ, payingId, setPayingId, expandBill, setExpandBill, pagando, setPagando, payDate, setPayDate, inclTerceros, setInclTerceros, payMonto, setPayMonto, fmtDMY, openClients, setOpenClients, toggleClient, collapseAll, selected, setSelected, toggleSel, clearSel, MONTHS, openPendiente, setOpenPendiente, openPorFacturar, setOpenPorFacturar, selExcel, setSelExcel, emitiendo, setEmitiendo, emitEnt, setEmitEnt, descExcel, setDescExcel, bb, anioPickFor, setAnioPickFor, ventaBusca, setVentaBusca, verCerradas, setVerCerradas, pcOrden, setPcOrden, pcConfirm, setPcConfirm, noEmitirSet, marcarNoEmitir, trabajosSF, decidirTrabajo, siiBuscaFor, setSiiBuscaFor, reprocBusy, setReprocBusy, anioLearned, setAnioLearned, saleYrById, anioVentaDe, sinAnio, yearBtns, tercerosByBilling, isProg, dateField, filtered, grouped, matchYM, kpiDate, ufInfoDe, yaFacturadasIds, pending, overdue, paid, programado, nEmitidas, nProgramadas, nPagadas, years, confirmPago, facturaEmail, setFacturaEmail, facturasEmail, setFacturasEmail, soloSinEnviar, setSoloSinEnviar, esEmitida, sinEnviar, envioBadge, cobranzaOpen, setCobranzaOpen, venceG, esVencidaG, recordadoMap, setRecordadoMap, recNota, setRecNota, recNotaMap, diasDesde, nrG, efClientIdG, abonos, setAbonos, concFac, setConcFac, abonosDe, pagosFor, setPagosFor, pagoBusy, setPagoBusy, otraFor, setOtraFor, otraQ, setOtraQ, otrasFacturas, pagosDe, pagosRutSugeridos, conciliarPago, esCalceCercano, calcesCercanos, conciliarCalceCercano, calcesOpen, setCalcesOpen, calcesSugeridos, porConciliarIds, estadoCuentaEnviar, recordarCobro, recordarCobroTanda, acuseCobro, recPreview, setRecPreview, enviarRecordatorio, emitirConRS, marcarEmitida, marcarEmitidasBulk, descargando, setDescargando, descargarProgramadas, emitidasTotal, mesKey, progMes, progMesTotal, progIds, toggleExcel, allExcel, resolveRS, descargarPorFacturar, confirmarEmitida, renderClientGroup, siiSinCli }
}

export function BillingView({billing,fantasmaIds=new Set(),clients,sales,clientEntities,user,setBilling,anticipos=[],terceros=[],respaldoMap={},cartolaHasta=null,onNuevoAnticipo,onProveedores,onConciliarTerceros,onCubrirCuotas,onDescubrirCuotas,onDeshacerConsumo,onFusionarAnticipos,onAbrirAnticipo,onFacturarBloque,onFacturarAdelantos,onStatusChange,onRevertirPago,onReactivar,onDelete,onAdd,onEdit,onImport,onImportExcel,onUpload,onAssignClient,onEmitir,onAnular,onSetVentaAnio,onReprocesarSinAnio,onAssignSeries,onDepurarCobradas,onRefresh,onConciliar,onOpenClientFicha,onReplaceProgramada,onIngresarSII,onCrearVentaRapida,onFacturaTercero,onReclasificarTercero,onBuscarSII,proveedores=[],onSaveProveedor,onIrConciliacion,onOpenPorSocio,onIrCobranza,onConsumeAnticipos,onCrearVentaForm,intent,onIntentDone}) {
  const { comPorFacturarDe, siiOpen, setSiiOpen, depurarRows, setDepurarRows, cubrirAnt, setCubrirAnt, facturarAnt, setFacturarAnt, filter, setFilter, cotejoMes, setCotejoMes, cierreOpen, setCierreOpen, ufHoy, estSel, setEstSel, isDesktop, agingF, setAgingF, groupOpen, setGroupOpen, rsSel, setRsSel, ESTADO_MAP, irAEstado, irAEstadoAging, estadoActivo, impOpen, setImpOpen, respaldoRef, procResp, setProcResp, respaldoRes, setRespaldoRes, respaldoFiles, setRespaldoFiles, respaldoAt, setRespaldoAt, respaldoBatchId, setRespaldoBatchId, batchIdRef, respaldoSummaryRef, cargasHist, setCargasHist, mesTandaReq, setMesTandaReq, xmlHub, setXmlHub, sinRegN, setSinRegN, sinRegDocs, cargandoStage, setCargandoStage, matchProgramada, marcarStaged, contarSinRegistrar, procesarRespaldoSII, cargarSinRegistrar, abrirHistCargas, creandoFac, setCreandoFac, crearCli, setCrearCli, ensureBatch, crearDesdeXML, ncConfirm, setNcConfirm, ncVincular, setNcVincular, ncBusy, setNcBusy, anularPorNC, regBusy, setRegBusy, regReview, setRegReview, respaldoRetry, reintentarRespaldos, backfillRespaldos, backfillBusy, progPick, setProgPick, secOpen, setSecOpen, crearVentaFor, setCrearVentaFor, cvForm, setCvForm, cvBusy, setCvBusy, terceroFor, setTerceroFor, queCorr, setQueCorr, tvProv, setTvProv, tvNuevo, setTvNuevo, tvBusy, setTvBusy, tvPct, setTvPct, comisionTercMap, setComisionTercMap, registrarProg, doRegistrar, doRegistrarLote, abrirCrearVenta, doCrearVenta, abrirTercero, elegirTercero, doTercero, moreOpen, setMoreOpen, siiPageOpen, setSiiPageOpen, saludCobranza, setSaludCobranza, recOpen, setRecOpen, siiPanel, setSiiPanel, siiBusy, setSiiBusy, siiCall, siiProbar, siiVerificarEstados, siiResumenSemanal, siiTraerHistorico, siiHistProg, ncResolver, cargarNCResolver, foliosEstado, setFoliosEstado, siiLog, setSiiLog, cargarSiiLog, siiSetJson, setSiiSetJson, siiPeriodo, setSiiPeriodo, siiResult, setSiiResult, SII_SET_SAMPLE, siiEmitirSet, siiLibro, siiDescargarXml, siiIntercambio, bandejaEnvio, setBandejaEnvio, masivoSaldo, setMasivoSaldo, factToMap, setFactToMap, abrirBandeja, envioMasivoBusy, setEnvioMasivoBusy, enviarTodas, onUnsendFactura, fYear, setFYear, fMonth, setFMonth, showMeses, setShowMeses, showBuscar, setShowBuscar, q, setQ, payingId, setPayingId, expandBill, setExpandBill, pagando, setPagando, payDate, setPayDate, inclTerceros, setInclTerceros, payMonto, setPayMonto, fmtDMY, openClients, setOpenClients, toggleClient, collapseAll, selected, setSelected, toggleSel, clearSel, MONTHS, openPendiente, setOpenPendiente, openPorFacturar, setOpenPorFacturar, selExcel, setSelExcel, emitiendo, setEmitiendo, emitEnt, setEmitEnt, descExcel, setDescExcel, bb, anioPickFor, setAnioPickFor, ventaBusca, setVentaBusca, verCerradas, setVerCerradas, pcOrden, setPcOrden, pcConfirm, setPcConfirm, noEmitirSet, marcarNoEmitir, trabajosSF, decidirTrabajo, siiBuscaFor, setSiiBuscaFor, reprocBusy, setReprocBusy, anioLearned, setAnioLearned, saleYrById, anioVentaDe, sinAnio, yearBtns, tercerosByBilling, isProg, dateField, filtered, grouped, matchYM, kpiDate, ufInfoDe, yaFacturadasIds, pending, overdue, paid, programado, nEmitidas, nProgramadas, nPagadas, years, confirmPago, facturaEmail, setFacturaEmail, facturasEmail, setFacturasEmail, soloSinEnviar, setSoloSinEnviar, esEmitida, sinEnviar, envioBadge, cobranzaOpen, setCobranzaOpen, venceG, esVencidaG, recordadoMap, setRecordadoMap, recNota, setRecNota, recNotaMap, diasDesde, nrG, efClientIdG, abonos, setAbonos, concFac, setConcFac, abonosDe, pagosFor, setPagosFor, pagoBusy, setPagoBusy, otraFor, setOtraFor, otraQ, setOtraQ, otrasFacturas, pagosDe, pagosRutSugeridos, conciliarPago, esCalceCercano, calcesCercanos, conciliarCalceCercano, calcesOpen, setCalcesOpen, calcesSugeridos, porConciliarIds, estadoCuentaEnviar, recordarCobro, recordarCobroTanda, acuseCobro, recPreview, setRecPreview, enviarRecordatorio, emitirConRS, marcarEmitida, marcarEmitidasBulk, descargando, setDescargando, descargarProgramadas, emitidasTotal, mesKey, progMes, progMesTotal, progIds, toggleExcel, allExcel, resolveRS, descargarPorFacturar, confirmarEmitida, renderClientGroup, siiSinCli } = useBillingModel({ billing, clients, sales, clientEntities, user, setBilling, anticipos, terceros, respaldoMap, cartolaHasta, onNuevoAnticipo, onProveedores, onConciliarTerceros, onCubrirCuotas, onDescubrirCuotas, onDeshacerConsumo, onFusionarAnticipos, onAbrirAnticipo, onFacturarBloque, onStatusChange, onRevertirPago, onReactivar, onDelete, onAdd, onEdit, onImport, onImportExcel, onUpload, onAssignClient, onEmitir, onAnular, onSetVentaAnio, onReprocesarSinAnio, onAssignSeries, onDepurarCobradas, onRefresh, onConciliar, onOpenClientFicha, onReplaceProgramada, onIngresarSII, onCrearVentaRapida, onFacturaTercero, proveedores, onSaveProveedor, onIrConciliacion, intent, onIntentDone })
  const etapaEmision = Number(useConfigValor('sii_emision_etapa'))||1   // paso actual de la puesta en marcha (0 = certificado, ya hecho)
  // Página "Cargar del SII": bitácora (sii_import_batches) e inventario de lo sin registrar se cargan al abrirla. Estado propio (no reusa cargasHist, que abre el modal de historial).
  const [histPage,setHistPage]=useState(null)
  useEffect(()=>{ if(!xmlHub) return; contarSinRegistrar(); setHistPage('loading')
    if(DEMO){ setHistPage([]); return }
    supabase.from('sii_import_batches').select('*').order('created_at',{ascending:false}).limit(40).then(({data})=>setHistPage(data||[])).catch(()=>setHistPage([]))
  },[xmlHub])   // eslint-disable-line
  const [tblSort,setTblSort] = usePersisted('fd_bill_tblsort',{col:'fecha',dir:'desc'})   // Desktop "Todas": orden de la tabla, recordado entre sesiones
  const [ordPC,setOrdPC] = useState({k:'nombre',dir:1})   // Por cliente (escritorio): columna de orden
  const [tipoFL,setTipoFL] = useState('')   // listado de facturas: filtro por tipo ('' = todos)
  const [comSoc,setComSoc] = useState('')   // Por clasificar › Comisión: socio que la generó
  const [comOrig,setComOrig] = useState('')   // Por clasificar › Comisión: quién o qué la generó
  const [porRevOpen,setPorRevOpen] = useState(false)   // hub: tarjeta "Por revisar" desplegada

  const xmlHubPage = xmlHub ? (()=>{
          const sinXml=billing.filter(b=>!b.deleted_at && esEmitida(b) && !b.dte_xml && !b.email_sent_at && String(b.issued_at||'').startsWith(mesKey))
          const conXml=billing.filter(b=>!b.deleted_at && b.dte_xml && String(b.issued_at||'').startsWith(mesKey)).length
          const pend=(sinRegN||0)+sinXml.length
          const svg=d=><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>{d}</svg>
          const fila=(icon,ic,titulo,sub,onClick,right)=>(
            <div onClick={onClick} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderTop:`0.5px solid ${C.bgSoft}`,cursor:'pointer'}}>
              <span style={{width:36,height:36,borderRadius:10,background:ic.bg,color:ic.fg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:12,fontWeight:800}}>{icon}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:600,color:C.accent}}>{titulo}</div><div style={{fontSize:11,color:C.muted}}>{sub}</div></div>
              {right||<span style={{color:C.textSoft,fontSize:18,flexShrink:0}}><Gl n='chevron'/></span>}
            </div>)
          const chip=(txt,onClick)=><span key={txt} onClick={e=>{e.stopPropagation();onClick&&onClick()}} style={{display:'inline-block',fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:6,padding:'2px 7px',margin:'3px 4px 0 0',background:C.card,color:C.text,cursor:'pointer'}}>{txt}</span>
          const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'4px 14px 8px'}
          return (<div>
            <PageHeader origen='Facturas del mes' onBack={()=>setXmlHub(false)} titulo='Cargar del SII'/>
            <div style={{display:'flex',flexDirection:isDesktop?'row':'column',alignItems:'flex-start',gap:isDesktop?18:12,padding:isDesktop?'18px 28px 40px':'14px 16px 40px',maxWidth:isDesktop?1120:640,margin:'0 auto'}}>
              <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:12,width:'100%'}}>
                {pend>0
                  ? <div style={{background:C.soonBg,borderRadius:12,padding:'14px 16px'}}><div style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5}}>Por cargar</div><div style={{fontSize:26,fontWeight:800,color:C.soonText,letterSpacing:-.5,fontVariantNumeric:'tabular-nums'}}>{pend}</div><div style={{fontSize:11.5,color:C.soonText}}>{sinRegN>0?`${sinRegN} emitida${sinRegN!==1?'s':''} en el SII sin registrar`:''}{sinRegN>0&&sinXml.length>0?' · ':''}{sinXml.length>0?`${sinXml.length} emitida${sinXml.length!==1?'s':''} sin XML`:''}</div></div>
                  : <div style={{background:C.greenBg,borderRadius:12,padding:'14px 16px'}}><div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5}}>Por cargar</div><div style={{fontSize:20,fontWeight:800,color:C.greenText}}>Todo cargado</div><div style={{fontSize:11.5,color:C.greenText}}>{conXml} factura{conXml!==1?'s':''} de este mes con XML</div></div>}
                {pend>0&&<div style={card}>
                  {sinRegN>0&&<>
                    {fila(String(sinRegN),{bg:C.soonBg,fg:C.soonText},'Emitidas en el SII sin registrar','Están en el SII y no en el sistema — cárgalas para registrarlas',()=>{ if(cargandoStage) return; cargarSinRegistrar() },<span style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Cargarlas <Gl n='chevron'/></span>)}
                    <div style={{padding:'0 0 8px 48px'}}>{(sinRegDocs||[]).slice(0,12).map(d=>chip(`N° ${d.folio}${d.receptor_name?' · '+String(d.receptor_name).slice(0,22):''}${d.monto?' · '+fmt(d.monto):''}`,()=>{ if(cargandoStage) return; cargarSinRegistrar() }))}{(sinRegDocs||[]).length>12&&<span style={{fontSize:11,color:C.muted}}> +{(sinRegDocs||[]).length-12}</span>}</div>
                  </>}
                  {sinXml.length>0&&<>
                    {fila(String(sinXml.length),{bg:C.overdueBg,fg:C.overdueText},'Emitidas sin XML este mes','No se pueden enviar hasta cargar su XML',()=>{ respaldoRef.current&&respaldoRef.current.click() },<span style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Cargar XML <Gl n='chevron'/></span>)}
                    <div style={{padding:'0 0 4px 48px'}}>{sinXml.slice(0,12).map(b=>chip(`N° ${folioN(b.invoice_no)}`,()=>onEdit&&onEdit(b)))}{sinXml.length>12&&<span style={{fontSize:11,color:C.muted}}> +{sinXml.length-12}</span>}</div>
                  </>}
                </div>}
                <div style={card}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0 2px'}}><span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Historial de cargas</span>{pend>0&&conXml>0&&<span style={{fontSize:11,color:C.muted}}>{conXml} de este mes con XML</span>}</div>
                  {histPage==null||histPage==='loading'
                    ? <div style={{padding:'14px 0',color:C.muted,fontSize:12}}>Cargando…</div>
                    : histPage.length===0 ? <div style={{padding:'14px 0',color:C.muted,fontSize:12}}>Aún no hay cargas registradas.</div>
                    : histPage.map(b=><CargaHistRow key={b.id} b={b}/>)}
                </div>
              </div>
              <div style={isDesktop?{width:380,flexShrink:0}:{width:'100%'}}>
                <div style={card}>
                  <div style={{...SEC_LBL,padding:'8px 0 2px'}}>Cargar</div>
                  {fila(svg(<><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'/></>),{bg:C.accent,fg:'#fff'},'Cargar XML','El respaldo .xml del SII (uno o varios)',()=>{ respaldoRef.current&&respaldoRef.current.click() })}
                  {onImportExcel&&fila(svg(<><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='m9 15 2 2 4-4'/></>),{bg:C.tealBg,fg:C.tealText},'Importar Excel','El detalle .xls / .xlsx del SII (o una planilla)',()=>{ onImportExcel() })}
                  {onUpload&&fila(svg(<><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/></>),{bg:C.overdueBg,fg:C.overdueText},'Cargar PDF','El PDF de la factura',()=>{ onUpload() })}
                  {onImport&&fila(svg(<><path d='M22 12.5V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/></>),{bg:C.azulBg,fg:C.accent},'Desde Drive','Importar facturas de Drive',()=>{ onImport() })}
                  <div style={{fontSize:11.5,color:C.muted,padding:'8px 0 4px'}}>Lo cargado queda guardado aunque salgas. Lo registras cuando quieras.</div>
                </div>
              </div>
            </div>
          </div>) })() : null
  const cierrePage = cierreOpen ? <FlujoPagina origen='Facturación' titulo='Cierre de mes' onBack={()=>setCierreOpen(false)} maxW={1180}><CierreMesModal billing={billing} clients={clients} sales={sales} respaldoMap={respaldoMap} abonos={abonos} pagosDe={pagosDe} onConciliarPago={conciliarPago} onRecordar={recordarCobro} onRecordarTanda={recordarCobroTanda} recordadoMap={recordadoMap} diasDesde={diasDesde} onOpenClientFicha={onOpenClientFicha} onOpenFactura={b=>onEdit&&onEdit(b)} onOpenConciliacion={()=>{setCierreOpen(false);onIrConciliacion&&onIrConciliacion()}}/></FlujoPagina> : null
  // Facturas por enviar = PÁGINA (antes modal). Foto + tabla (escritorio) / lista (móvil) con la cifra a la derecha + historial de envíos (bitácora en billing: email_sent_at/sent_to/sent_by).
  const porEnviarPage = bandejaEnvio ? (()=>{ const porEnviar=(billing||[]).filter(b=>!b.deleted_at&&sinEnviar(b)); const contactoDe=b=>factToMap[String(b.client_id)]||null
    const tot=porEnviar.reduce((a,b)=>a+(montoFactura(b)||0),0)
    const enviadas=(billing||[]).filter(b=>!b.deleted_at&&(b.email_sent_at||b.sent_at)).sort((x,y)=>String(y.email_sent_at||y.sent_at).localeCompare(String(x.email_sent_at||x.sent_at))).slice(0,15)
    const cliN=b=>clients.find(c=>String(c.id)===String(b.client_id))?.name||'—'
    const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'4px 14px 8px'}
    const enviarBtn=b=><button onClick={()=>setFacturaEmail(b)} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer',flexShrink:0}}>Enviar</button>
    return <FlujoPagina origen='Facturación' titulo='Facturas por enviar' onBack={()=>setBandejaEnvio(false)} maxW={1120}>
      <div style={{display:'flex',flexDirection:isDesktop?'row':'column',alignItems:'flex-start',gap:isDesktop?18:12}}>
        <div style={{flex:1,minWidth:0,width:'100%',display:'flex',flexDirection:'column',gap:12}}>
          {porEnviar.length>0
            ? <div style={{background:C.soonBg,borderRadius:12,padding:'12px 14px'}}><div style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5}}>Por enviar al cliente</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:24,fontWeight:800,color:C.soonText,letterSpacing:-.4}}>{porEnviar.length}</span><span style={{fontSize:20,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span></div><div style={{fontSize:11.5,color:C.soonText}}>Emitidas que aún no se mandan al cliente · adjunta el PDF</div></div>
            : <div style={{background:C.greenBg,borderRadius:12,padding:'12px 14px'}}><div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5}}>Por enviar al cliente</div><div style={{fontSize:20,fontWeight:800,color:C.greenText}}>Todo enviado</div></div>}
          {porEnviar.length>0&&<label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',padding:'9px 11px',background:C.bgSoft,borderRadius:9}}><input type='checkbox' checked={masivoSaldo} onChange={e=>setMasivoSaldo(e.target.checked)} style={{cursor:'pointer',marginTop:1,flexShrink:0}}/><span style={{fontSize:11.5,color:C.text,lineHeight:1.4}}>Recordar saldo pendiente<span style={{color:C.muted}}> — si el cliente tiene otra factura por cobrar, se agrega al correo la línea con el detalle (factura completa o saldo parcial).</span></span></label>}
          {porEnviar.length>0&&<div style={card}>
            {isDesktop
              ? <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}><thead><tr>{['Factura','Cliente','Para','Monto',''].map((h,i)=><th key={i} style={{...TH_BAND,textAlign:i>=3?'right':'left',padding:'8px 8px 6px',borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
                  <tbody>{porEnviar.map(b=>{ const dest=contactoDe(b); return <tr key={b.id}>
                    <td onClick={()=>onEdit&&onEdit(b)} style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,fontWeight:600,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>N° {folioN(b.invoice_no)||b.invoice_no||'—'}</td>
                    <td onClick={()=>onOpenClientFicha&&onOpenClientFicha(b.client_id)} style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,cursor:'pointer'}}>{cliN(b)}</td>
                    <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,color:dest?C.muted:C.overdueText,fontSize:11.5}}>{dest||'sin correo — lo eliges al enviar'}</td>
                    <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,textAlign:'right',fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</td>
                    <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,textAlign:'right'}}>{enviarBtn(b)}</td></tr> })}</tbody></table>
              : porEnviar.map((b,i)=>{ const dest=contactoDe(b); return <div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderTop:i?`0.5px solid ${C.bgSoft}`:'none'}}>
                  <div onClick={()=>onEdit&&onEdit(b)} style={{flex:1,minWidth:0,cursor:'pointer'}}><div style={{fontSize:12.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>N° {folioN(b.invoice_no)||b.invoice_no||'—'} · {cliN(b)}</div><div style={{fontSize:10.5,color:dest?C.muted:C.overdueText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dest||'sin correo — lo eliges al enviar'}</div></div>
                  <span style={{fontSize:12.5,fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</span>{enviarBtn(b)}</div> })}
            <div style={{display:'flex',alignItems:'center',gap:8,paddingTop:10}}><span style={{fontSize:11,color:C.muted,flex:1,minWidth:0}}>{porEnviar.length} por enviar{(()=>{ const c=porEnviar.filter(b=>factToMap[String(b.client_id)]).length; return c?` · ${c} con correo recordado`:'' })()}</span><button disabled={envioMasivoBusy} onClick={enviarTodas} style={{fontSize:12.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:10,padding:'9px 14px',cursor:'pointer',opacity:envioMasivoBusy?.6:1}}>{envioMasivoBusy?'Enviando…':'Enviar todas'}</button></div>
          </div>}
        </div>
        <div style={isDesktop?{width:360,flexShrink:0}:{width:'100%'}}>
          <div style={card}><div style={{...SEC_LBL,padding:'8px 0 2px'}}>Enviadas · historial</div>
            {enviadas.length===0?<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Aún no hay envíos registrados.</div>
             :enviadas.map((b,i)=><div key={b.id} onClick={()=>onEdit&&onEdit(b)} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 0',borderTop:i?`0.5px solid ${C.bgSoft}`:'none',cursor:'pointer'}}>
               <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>N° {folioN(b.invoice_no)||'—'} · {cliN(b)}</div><div style={{fontSize:10.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaHora(b.email_sent_at||b.sent_at)}{b.sent_to?` · a ${b.sent_to}`:''}{b.sent_by?` · ${b.sent_by}`:''}</div></div>
               <span style={{fontSize:12,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(montoFactura(b))}</span></div>)}
          </div>
        </div>
      </div>
    </FlujoPagina> })() : null
  // Flujos de Facturación = PÁGINAS (antes ventanas): mismo patrón que Cierre de mes. Volver deja la vista tal cual (lista, filtro, factura desplegada).
  const origenFact = bandejaEnvio?'Facturas por enviar':xmlHub?'Cargar XML':filter==='checklist'?'Facturas del mes':filter==='anticipos'?'Anticipos':filter==='clientes'?'Por cliente':filter==='all'?'Facturas':'Facturación'
  const emailPage = (facturasEmail&&facturasEmail.length>0)||facturaEmail ? (()=>{ const lista=(facturasEmail&&facturasEmail.length>0)?facturasEmail:null; const f0=lista?lista[0]:facturaEmail; const cli=clients.find(c=>String(c.id)===String(f0.client_id)); const cerrar=()=>{ if(lista) setFacturasEmail(null); else setFacturaEmail(null) }
    return <FlujoPagina origen={origenFact} titulo={lista?'Enviar facturas':'Enviar factura'} ctx={[lista?`${lista.length} facturas`:(f0.invoice_no?`N° ${folioN(f0.invoice_no)}`:null), cli?.name].filter(Boolean).join(' · ')||null} onBack={cerrar} maxW={1120}>
      <FacturaEmailModal asPage factura={f0} facturas={lista||undefined} sales={sales} client={cli} sale={(sales||[]).find(s=>String(s.id)===String(f0.sale_id))} user={user} billing={billing} onSent={(id,at)=>setBilling&&setBilling(p=>p.map(b=>b.id===id?{...b,email_sent_at:at}:b))} onClose={cerrar}/>
    </FlujoPagina> })() : null
  const recPage = recPreview ? (()=>{ const rPrev=recordatorioCobro(recPreview.b, recNota); const cli=clients.find(c=>String(c.id)===String(recPreview.b.client_id))
    return <FlujoPagina origen={origenFact} titulo='Recordatorio de cobro' ctx={[recPreview.b.invoice_no?`N° ${folioN(recPreview.b.invoice_no)}`:null, cli?.name].filter(Boolean).join(' · ')||null} onBack={()=>setRecPreview(null)} maxW={1120}>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1fr) minmax(0,1.2fr)':'1fr',gap:isDesktop?20:12,alignItems:'start'}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
          <div style={{fontSize:12,color:C.muted,marginBottom:10,lineHeight:1.6}}><b style={{color:C.text}}>Para:</b> {recPreview.to}<br/><b style={{color:C.text}}>Nivel:</b> {rPrev.nivel}<br/><b style={{color:C.text}}>Asunto:</b> {rPrev.subject}</div>
          <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.textSoft,marginBottom:5}}>Nota para este cliente · opcional</div>
          <textarea value={recNota} onChange={e=>setRecNota(e.target.value)} rows={3} placeholder='Ej. Cualquier consulta sobre esta factura, con gusto les ayudamos. ¡Gracias!' style={{width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:12.5,lineHeight:1.5,color:C.text,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',marginBottom:5}}/>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:12}}>Va dentro del correo y se recuerda para este cliente. Las cifras del cobro se arman solas.</div>
          <ActBtn variant='primary' size='lg' full onClick={()=>enviarRecordatorio({b:recPreview.b, to:recPreview.to, nota:recNota})}>Enviar recordatorio</ActBtn>
        </div>
        <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:'#fff'}}><div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5,padding:'9px 12px',borderBottom:`1px solid ${C.bgSoft}`}}>Vista previa</div><div style={{padding:12}} dangerouslySetInnerHTML={{__html:rPrev.html}}/></div>
      </div>
    </FlujoPagina> })() : null
  const cargasPage = cargasHist!==null ? <FlujoPagina origen={origenFact} titulo='Cargas del SII' onBack={()=>setCargasHist(null)} maxW={720}>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'4px 14px'}}>
        {cargasHist==='loading'
          ? <div style={{padding:'22px 0',textAlign:'center',color:C.muted,fontSize:12}}>Cargando…</div>
          : cargasHist.length===0
            ? <div style={{padding:'22px 0',textAlign:'center',color:C.muted,fontSize:12}}>Aún no hay cargas registradas.</div>
            : cargasHist.map(b=><CargaHistRow key={b.id} b={b}/>)}
      </div>
    </FlujoPagina> : null
  const depurarPage = depurarRows ? <FlujoPagina origen={origenFact} titulo='Marcar como pagadas' ctx={`${depurarRows.length} factura${depurarRows.length!==1?'s':''}`} onBack={()=>setDepurarRows(null)} maxW={860}>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}><DepurarCobradasModal rows={depurarRows} clients={clients} respaldoMap={respaldoMap} onOpenFactura={b=>{setDepurarRows(null);onEdit&&onEdit(b)}} onClose={()=>setDepurarRows(null)} onConfirm={(sel)=>{ onDepurarCobradas(sel); setDepurarRows(null) }}/></div>
    </FlujoPagina> : null
  const cubrirPage = cubrirAnt ? <FlujoPagina origen={origenFact} titulo='Cubrir cuotas con anticipo' ctx={clients.find(c=>String(c.id)===String(cubrirAnt.client_id))?.name||null} onBack={()=>setCubrirAnt(null)} maxW={640}>
      <CubrirCuotasModal asPage anticipo={cubrirAnt} sales={sales} billing={billing} clients={clients} onConfirm={ids=>{onCubrirCuotas&&onCubrirCuotas(cubrirAnt.id,ids);setCubrirAnt(null)}} onClose={()=>setCubrirAnt(null)}/>
    </FlujoPagina> : null
  const facturarPage = facturarAnt ? <FlujoPagina origen={origenFact} titulo='Facturar anticipo en bloque' ctx={clients.find(c=>String(c.id)===String(facturarAnt.client_id))?.name||null} onBack={()=>setFacturarAnt(null)} maxW={640}>
      <FacturarBloqueModal asPage anticipo={facturarAnt} billing={billing} sales={sales} clients={clients} onConfirm={d=>onFacturarBloque&&onFacturarBloque(facturarAnt,d)} onClose={()=>setFacturarAnt(null)}/>
    </FlujoPagina> : null
  const siiCotejoPage = siiOpen ? <FlujoPagina origen={siiPageOpen?'Facturación electrónica':origenFact} titulo='Cuadrar con SII' onBack={()=>{setSiiOpen(false);setCotejoMes(null)}} maxW={1000}>
      <SiiSyncModal asPage onClose={()=>{setSiiOpen(false);setCotejoMes(null)}} onRefresh={onRefresh} clients={clients} clientEntities={clientEntities} billing={billing} initialMes={cotejoMes} onOpenClientFicha={onOpenClientFicha}/>
    </FlujoPagina> : null
  const regPage = regReview ? (()=>{ const items=regReview; const total=items.reduce((a,r)=>a+(r.monto||0),0)
    return <FlujoPagina origen={origenFact} titulo={`Registrar ${items.length} factura${items.length!==1?'s':''}`} onBack={()=>!regBusy&&setRegReview(null)} maxW={720}>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:10}}><div style={{flex:1,fontSize:12,color:C.muted,lineHeight:1.5}}>El SII ya las emitió. Esto las <b style={{color:C.text}}>registra en tu sistema</b> (pasan de programadas a por cobrar) — no las vuelve a emitir.</div><b style={{fontSize:15,color:C.accent,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(total)}</b></div>
        <div style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          {items.map((r,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1fr auto',columnGap:10,padding:'9px 11px',borderTop:i?`0.5px solid ${C.bgSoft}`:'none'}}>
            <div style={{minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.cliente||'—'}</div><div style={{fontSize:10.5,color:C.muted}}>Factura N° {r.folio}{r.fecha?` · ${fmtFechaDMY(r.fecha)}`:''}</div></div>
            <span style={{fontSize:12.5,fontWeight:700,color:C.text,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(r.monto)}</span>
          </div>)}
        </div>
        <div style={{marginTop:12}}><ActBtn variant='primary' size='lg' full disabled={!!regBusy} onClick={()=>doRegistrarLote(items)}>{regBusy==='lote'?'Registrando…':`Registrar ${items.length}`}</ActBtn></div>
      </div>
    </FlujoPagina> })() : null
  const billingPage = emailPage || recPage || depurarPage || cubrirPage || facturarPage || siiCotejoPage || regPage || cargasPage || cierrePage || porEnviarPage || xmlHubPage
  const _pgKey = [!!facturaEmail,!!(facturasEmail&&facturasEmail.length),!!recPreview,!!depurarRows,!!cubrirAnt,!!facturarAnt,!!siiOpen,!!regReview,cargasHist!==null].join('')
  useEffect(()=>{ if(cierreOpen||bandejaEnvio||xmlHub||/true/.test(_pgKey)) restoreScroll({w:0,d:0}) },[cierreOpen,bandejaEnvio,xmlHub,_pgKey])
  return (
    <div>
      {billingPage}
      <div style={billingPage?{display:'none'}:undefined}>
      <div style={{padding:'20px 20px 0',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:8}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Facturación</div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            {filter==='checklist'&&<button onClick={()=>{setFilter('resumen');clearSel&&clearSel()}} title='Volver al resumen' style={chipBtn('primary')}><Gl n='chevL'/> Volver</button>}
            {filter==='resumen'&&<button onClick={()=>{setFilter('clientes');clearSel&&clearSel()}} title='Detalle por cliente' style={{height:24,display:'inline-flex',alignItems:'center',gap:5,padding:'0 11px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',border:'0.5px solid '+C.accent,background:'#fff',color:C.accent}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'><path d='M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'/><circle cx='12' cy='12' r='3'/></svg>Por cliente</button>}
            {(isProg||estadoActivo('programadas'))&&<button onClick={descargarProgramadas} disabled={descargando} style={{...chipBtn('soft'),opacity:descargando?.6:1}}>{descargando?'Generando...':'↓ Programadas'}</button>}
            <div style={{position:'relative'}}>
              <input ref={respaldoRef} type='file' accept='.xml,text/xml' multiple style={{position:'absolute',width:1,height:1,opacity:0,pointerEvents:'none'}} onChange={e=>{ const fs=[...(e.target.files||[])]; e.target.value=''; procesarRespaldoSII(fs) }}/>
              {mesTandaReq&&<MesTandaModal def={mesTandaReq.def} onPick={v=>{ mesTandaReq.resolve(v); setMesTandaReq(null) }}/>}
              {respaldoRes&&(()=>{
                const g=k=>respaldoRes.filter(r=>r.estado===k)
                const prog=g('programada'), nuevas=g('nueva'), reg=g('registrada'), nc=[...g('nota_credito'),...g('nc_hecha')]
                const adj=g('adjuntada'),dup=g('duplicada'),cre=g('creada'),sinpdf=g('sin_respaldo'),err=[...g('error'),...g('sin_dte'),...g('sin_factura')]
                const STY={adjuntada:{t:'Adjuntada',c:C.greenText,bg:C.greenBg},creada:{t:'Agregada',c:C.greenText,bg:C.greenBg},duplicada:{t:'Ya tenía respaldo',c:C.muted,bg:C.bgSoft},sin_respaldo:{t:'Registrada · falta respaldo',c:C.soonText,bg:C.soonBg},error:{t:'Error',c:C.overdueText,bg:C.overdueBg},sin_dte:{t:'Archivo sin DTE',c:C.overdueText,bg:C.overdueBg},sin_factura:{t:'Sin factura',c:C.soonText,bg:C.soonBg}}
                const row=(r,i)=>{ const s=STY[r.estado]||STY.error; return (
                  <div key={i} style={{padding:'7px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.folio?`N° ${r.folio}`:r.archivo||'—'}{r.cliente?<span style={{fontWeight:400,color:C.muted}}> · {r.cliente}</span>:''}{r.monto?<span style={{fontWeight:400,color:C.muted}}> · {fmt(r.monto)}</span>:''}</div>
                        {r.msg&&r.estado!=='sin_respaldo'&&<div style={{fontSize:10,color:C.overdueText}}>{r.msg}</div>}
                        {r.estado==='sin_respaldo'&&<div style={{fontSize:10,color:C.soonText}}>{r.drive?'Se cayó la conexión con Drive al subir el PDF.':'No se pudo subir el PDF-respaldo.'} La factura ya quedó registrada.</div>}
                        {r.estado==='creada'&&r.sinCliente&&<div style={{fontSize:10,color:C.soonText}}>Sin cliente — asígnalo en la factura.</div>}
                      </div>
                      {r._fac&&onEdit&&<button onClick={()=>onEdit(r._fac)} style={{fontSize:10,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer',flexShrink:0,padding:0}}>Ver factura <Gl n='chevron'/></button>}
                      {r.url&&<a href={r.url} target='_blank' rel='noreferrer' style={{fontSize:10,color:C.accent,textDecoration:'none',flexShrink:0}}>Ver PDF ↗</a>}
                      <span style={{fontSize:9.5,fontWeight:700,color:s.c,background:s.bg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{s.t}</span>
                    </div>
                  </div>) }
                // Asigna un cliente a una fila 'nueva' sin resolver Y APRENDE: crea la RS (RUT del receptor) bajo ese cliente para que la próxima carga se resuelva sola.
                const asignarClienteImport=async(row,cid)=>{ const cli=(clients||[]).find(c=>String(c.id)===String(cid)); setRespaldoRes(p=>(p||[]).map(x=>x===row?{...x,clienteId:cid,cliente:cli?.name||x.cliente}:x)); await aprenderRS(cid, row?.row?.rut, row?.row?.receptor, clientEntities) }
                const progRowR=(r,i)=>{ const done=r.estado==='registrada'; const isProg=r.estado==='programada'; const cands=r.progCand||[]; const sel=cands.find(c=>c.id===r.progId); const many=isProg&&cands.length>1; const open=progPick===r; const noCli=!r.clienteId&&r.estado==='nueva'; const cliDisp=r.clienteId?(r.cliente||'—'):titleCase(r.cliente||r.row?.receptor||'—'); const rsDisp=r.row?.receptor?titleCase(r.row.receptor):''; const showRS=rsDisp&&_normTxt(rsDisp)!==_normTxt(cliDisp); return (
                  <div key={'p'+i} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'10px 0'}}>
                    <div onClick={()=>{ const bb2=r.progId&&(billing||[]).find(x=>x.id===r.progId); if(bb2&&onEdit) onEdit(bb2) }} style={{display:'grid',gridTemplateColumns:'1fr auto',columnGap:12,alignItems:'start',cursor:r.progId?'pointer':'default'}}>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{cliDisp}</div>
                        {showRS&&<div style={{fontSize:11,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{rsDisp}</div>}
                        <div style={{fontSize:10,color:C.muted,marginTop:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>Factura N° {r.folio}{r.fecha?` · ${fmtFechaDMY(r.fecha)}`:''}<span style={{fontSize:8,fontWeight:600,borderRadius:4,padding:'2px 6px',textTransform:'uppercase',letterSpacing:.3,background:isProg?C.bgWarm:C.soonBg,color:isProg?C.muted:C.soonText}}>{isProg?'Programada':'Nueva'}</span></div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
                        <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(r.monto)}</span>
                        {done
                          ? <span style={{fontSize:9,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:8,padding:'6px 12px'}}>Registrada</span>
                          : r.estado==='creada'
                            ? <span style={{fontSize:9,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:8,padding:'6px 12px'}}>Venta + factura <Gl n='tick'/></span>
                          : r.estado==='tercero'
                            ? <span style={{fontSize:9,fontWeight:700,color:C.tealText,background:C.tealBg,borderRadius:8,padding:'6px 12px',whiteSpace:'nowrap'}}>De {r.proveedorNombre||'externo'} <Gl n='tick'/></span>
                          : isProg
                            ? <button disabled={!!regBusy} onClick={e=>{e.stopPropagation();doRegistrar(r)}} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer',background:C.azulBg,color:C.accent,whiteSpace:'nowrap'}}>{regBusy===r.progId?'…':'Registrar'}</button>
                            : r.clienteId
                              ? <button disabled={cvBusy||tvBusy||creandoFac===r.row.folio} onClick={e=>{e.stopPropagation(); const abierto=(queCorr===r||crearVentaFor===r||terceroFor===r); setQueCorr(abierto?null:r); setCrearVentaFor(null); setTerceroFor(null)}} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer',background:C.accent,color:'#fff',whiteSpace:'nowrap'}}>{(queCorr===r||crearVentaFor===r||terceroFor===r)?'Cerrar':<>Registrar{" "}<Gl n='chevD'/></>}</button>
                              : <button disabled={creandoFac===r.row.folio||!onIngresarSII} onClick={e=>{e.stopPropagation();crearDesdeXML(r,i)}} style={{fontSize:11,fontWeight:600,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer',background:C.soonBg,color:C.soonText,whiteSpace:'nowrap'}}>{creandoFac===r.row.folio?'…':'Agregar factura'}</button>}
                      </div>
                    </div>
                    {isProg&&sel
                      ? <div style={{fontSize:10,color:C.muted,marginTop:5}}>{r.glosa&&<span style={{fontStyle:'italic'}}>{r.glosa} </span>}→ {sel.concept||(sel.due?`Vence ${fmtFechaDMY(sel.due)}`:'cuota')}{many&&<> · <span onClick={e=>{e.stopPropagation();setProgPick(open?null:r)}} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>Cambiar ({cands.length})</span></>}</div>
                      : r.glosa?<div style={{fontSize:10,color:C.muted,marginTop:5,fontStyle:'italic',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.glosa}</div>:null}
                    {noCli&&<div style={{marginTop:7}}><AsignarClienteInline bill={r} clients={clients} onAssign={asignarClienteImport} label='Asignar cliente' placeholder='Buscar cliente por nombre o RUT…'/></div>}
                    {queCorr===r&&(()=>{ const opt=(icon,titulo,sub,onClick,tint)=>(
                      <div onClick={e=>{e.stopPropagation();onClick()}} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
                        <span style={{width:30,height:30,borderRadius:8,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,background:tint.bg,color:tint.fg}}>{icon}</span>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.accent}}>{titulo}</div><div style={{fontSize:10,color:C.muted}}>{sub}</div></div>
                        <span style={{color:C.textSoft,fontSize:15,flexShrink:0}}><Gl n='chevron'/></span>
                      </div>)
                      // Ventas ACTIVAS del cliente reconocido POR RUT → ofrecer asociar (no duplicar). Si hay una sola, es la opción recomendada.
                      const ventasCli=(sales||[]).filter(s=>!s.deleted_at&&String(s.client_id)===String(r.clienteId)&&s.status==='Activo')
                      return <div onClick={e=>e.stopPropagation()} style={{marginTop:9,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                        <div style={{...SEC_LBL,padding:'9px 12px 3px'}}>¿A qué corresponde esta factura?</div>
                        {(()=>{ const ca=comPorFacturarDe(r.clienteId, r.row?.fechaEmision||r.fecha); if(!ca) return null
                          return opt('%',`Es la comisión por facturar del ${fmtFechaDMY(ca.paid_at||ca.due)}`,`depósito ${fmt(ca.amount)}${Math.abs((ca.amount||0)-(r.monto||0))>1?` · la factura es ${fmt(r.monto||0)}`:''} · le pone el folio, no la duplica`,async()=>{ setQueCorr(null); setRegBusy(ca.id); try{ await registrarProg({...r, progId:ca.id}); setRespaldoRes(p=>(p||[]).map(x=>x===r?{...x,estado:'registrada',progId:ca.id}:x)) }catch(e){ appAlert('No se pudo registrar: '+(e.message||e)) } setRegBusy(null); onRefresh&&onRefresh() },{bg:C.tealBg,fg:C.tealText}) })()}
                        {ventasCli.slice(0,4).map(s=>opt('◆',`Asociar a «${s.title||'Venta'}»`, ventasCli.length===1?'reconocida por RUT · no duplica la venta':'venta activa del cliente',()=>{setQueCorr(null);crearDesdeXML(r,i,s.id)},{bg:C.greenBg,fg:C.greenText}))}
                        {opt('◆',ventasCli.length?'Otra venta nueva':'Una venta nuestra','Abre el formato de venta (lee la propuesta del Drive)',()=>{setQueCorr(null);onCrearVentaForm&&onCrearVentaForm(r)},{bg:C.azulBg,fg:C.accent})}
                        {opt('%','Una comisión que nos pagan','Otro estudio nos paga por un cliente derivado · sin venta',()=>{setQueCorr(null);crearDesdeXML(r,i,null,'comision')},{bg:C.tealBg,fg:C.tealText})}
                        {opt('▤','Respaldo de un reembolso de gastos','No es ingreso · abona a los gastos del cliente',()=>{setQueCorr(null);crearDesdeXML(r,i,null,'reembolso')},{bg:C.azulBg,fg:C.azulInfo})}
                        {opt('▤','Solo la factura','Sin venta asociada · se clasifica después',()=>{setQueCorr(null);crearDesdeXML(r,i)},{bg:C.bgSoft,fg:C.muted})}
                        {opt('⇆','El ingreso es de un externo','La cobramos nosotros, pero la plata es de otro',()=>{setQueCorr(null);abrirTercero(r)},{bg:C.tealBg,fg:C.tealText})}
                      </div> })()}
                    {crearVentaFor===r&&(()=>{ const AREAS=[...new Set(['Corporativo','Tributario','Laboral','Sucesorio','Otro',...(sales||[]).map(s=>s.area).filter(Boolean)])]; const ABOGS=[...new Set([...WHO_LIST,...(sales||[]).map(s=>s.responsible),...(clients||[]).map(c=>c.abogado_responsable)].map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')); /* desde los datos (antes lista fija): quien entre al equipo aparece solo */ const ufN=parseFloat(String(cvForm.ufVal).replace(',','.'))||0; return (
                      <div onClick={e=>e.stopPropagation()} style={{marginTop:9,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.3,marginBottom:8}}>Nueva venta · {cliDisp}</div>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Título</span>
                          <input value={cvForm.title} onChange={e=>setCvForm(f=>({...f,title:e.target.value}))} style={{flex:1,fontSize:12,color:C.text,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}/>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:9}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Monto</span>
                          <span style={{flex:1,fontSize:12,fontWeight:600,color:C.text}}>{ufN>0?`${ufN.toLocaleString('es-CL',{maximumFractionDigits:2})} UF · ${fmt(r.monto)}`:fmt(r.monto)}</span>
                          <span style={{fontSize:9,color:C.greenText,fontWeight:600}}>de la glosa</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:8}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Área</span>
                          {AREAS.map(a=>{ const on=cvForm.area===a; return <button key={a} onClick={()=>setCvForm(f=>({...f,area:a}))} style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'3px 9px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.bg,color:on?C.accent:C.muted}}>{a}</button> })}
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:11}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Abogado</span>
                          {ABOGS.map(a=>{ const on=cvForm.responsible===a; return <button key={a} onClick={()=>setCvForm(f=>({...f,responsible:a}))} style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'3px 9px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.bg,color:on?C.accent:C.muted}}>{a}</button> })}
                        </div>
                        <button disabled={cvBusy||!cvForm.title.trim()} onClick={()=>doCrearVenta(r)} style={{width:'100%',background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'9px 0',fontSize:12,fontWeight:600,cursor:cvBusy?'default':'pointer',opacity:cvBusy?.6:1}}>{cvBusy?'Creando…':'Crear venta y registrar factura'}</button>
                      </div>) })()}
                    {terceroFor===r&&(()=>{ const provs=[...(proveedores||[])].sort((a,b)=>((a.razon_social||a.nombre||'')).localeCompare(b.razon_social||b.nombre||'','es')); const provElegido=provs.find(p=>String(p.id)===String(tvProv)); const nombreDest=provElegido?(provElegido.razon_social||provElegido.nombre):(tvNuevo.trim()||'el externo'); const total=r.monto||0; const pct=Math.max(0,Math.min(100,parseFloat(String(tvPct).replace(',','.'))||0)); const comision=pct>0?Math.round(total*pct/100):0; const payable=total-comision; const aprendido=tvProv&&comisionTercMap[String(tvProv)]!=null; return (
                      <div onClick={e=>e.stopPropagation()} style={{marginTop:9,background:C.tealBg,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:C.tealText,textTransform:'uppercase',letterSpacing:.3,marginBottom:3}}>Ingreso de un externo</div>
                        <div style={{fontSize:11,color:C.muted,marginBottom:9,lineHeight:1.4}}>{pct>0?<>La cobras tú ({fmt(total)}): retienes <b style={{color:C.greenText}}>{fmt(comision)}</b> ({pct}%, comisión recibida) y <b style={{color:C.tealText}}>{fmt(payable)}</b> es de {nombreDest} → cuenta por pagar.</>:<>La factura queda registrada (la cobras tú), pero {fmt(total)} es de este externo → se crea una cuenta por pagar. No cuenta en tus metas.</>}</div>
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:7,flexWrap:'wrap'}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Externo</span>
                          {provs.length>0&&<select value={tvProv} onChange={e=>elegirTercero(e.target.value)} style={{flex:'1 1 150px',minWidth:0,fontSize:12,color:C.text,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}>
                            <option value=''>Elegir…</option>
                            {provs.map(p=><option key={p.id} value={p.id}>{p.razon_social||p.nombre}</option>)}
                          </select>}
                        </div>
                        {!tvProv&&<div style={{display:'flex',alignItems:'center',gap:6,marginBottom:9}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>{provs.length>0?'o nuevo':'Nombre'}</span>
                          <input value={tvNuevo} onChange={e=>setTvNuevo(e.target.value)} placeholder='Nombre del externo (ej. Rodrigo Díaz)' style={{flex:1,fontSize:12,color:C.text,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}/>
                        </div>}
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:9,flexWrap:'wrap'}}>
                          <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Retienes</span>
                          <input value={tvPct} onChange={e=>setTvPct(e.target.value.replace(/[^\d.,]/g,''))} inputMode='decimal' placeholder='0' style={{width:58,textAlign:'right',fontSize:12,fontWeight:700,color:C.text,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}/>
                          <span style={{fontSize:13,fontWeight:700,color:C.tealText}}>%</span>
                          {aprendido&&<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}><Gl n='tick'/> aprendido de {nombreDest}</span>}
                        </div>
                        <button disabled={tvBusy||(!tvProv&&!tvNuevo.trim())} onClick={()=>doTercero(r)} style={{width:'100%',background:C.tealText,color:'#fff',border:'none',borderRadius:8,padding:'9px 0',fontSize:12,fontWeight:600,cursor:tvBusy?'default':'pointer',opacity:(tvBusy||(!tvProv&&!tvNuevo.trim()))?.6:1}}>{tvBusy?'Registrando…':(pct>0?`Registrar · retienes ${fmt(comision)}, pasas ${fmt(payable)}`:`Registrar y pasar a ${nombreDest}`)}</button>
                      </div>) })()}
                    {many&&open&&<div style={{marginTop:6,border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                      {cands.map((c,ci)=>{ const on2=c.id===r.progId; return <div key={c.id} onClick={()=>{ setRespaldoRes(p=>(p||[]).map(x=>x===r?{...x,progId:c.id}:x)); setProgPick(null) }} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',borderTop:ci?`0.5px solid ${C.bgSoft}`:'none',cursor:'pointer'}}>
                        <span style={{width:15,height:15,borderRadius:'50%',border:`1.5px solid ${on2?C.accent:'#C7D0D5'}`,flexShrink:0,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on2&&<span style={{width:8,height:8,borderRadius:'50%',background:C.accent}}/>}</span>
                        <span style={{flex:1,fontSize:12,color:C.text}}>Vence {c.due?fmtFechaDMY(c.due):'—'}{c.concept?` · ${c.concept}`:''}</span>
                        <span style={{fontSize:11,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(c.amount)}</span>
                      </div> })}
                    </div>}
                  </div>) }
                const ncRowR=(r,i)=>(
                  <div key={'nc'+i} style={{padding:'10px 0',borderTop:`1px solid ${C.bgSoft}`}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{r.facCliente||r.receptor||'—'}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>N° {r.ncFolio}{r.ncFecha?` · ${fmtFechaDMY(r.ncFecha)}`:''} · anula Factura N° {r.facFolio}{r.facStatus?` · ${r.facStatus}`:' · no está en el sistema'} · {fmt(r.monto)}<span style={{fontSize:8,fontWeight:600,color:C.coralText,background:'#FAECE7',borderRadius:4,padding:'2px 6px',textTransform:'uppercase',letterSpacing:.3}}>Nota de crédito</span></div>
                    {r.replFolio&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>Reemplazo probable: <b style={{color:C.accent}}>Factura N° {r.replFolio}{r.replCliente?` · ${r.replCliente}`:''}</b></div>}
                    <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                      {r.estado==='nc_hecha'
                        ? <span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Anulada · registrada</span>
                        : r.facId
                          ? <button onClick={()=>{setNcVincular(!!r.replId);setNcConfirm({item:r})}} style={{fontSize:11,fontWeight:600,color:C.overdueText,background:C.overdueBg,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Anular N° {r.facFolio}</button>
                          : <button disabled={ncBusy} onClick={()=>anularPorNC(r,i,false)} style={{fontSize:11,fontWeight:600,color:C.soonText,background:C.soonBg,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Solo registrar</button>}
                    </div>
                  </div>)
                const hdr=(t,c)=><div style={{fontSize:9,fontWeight:700,color:c,textTransform:'uppercase',letterSpacing:.3,margin:'12px 2px 2px'}}>{t}</div>
                // Sección colapsable: encabezado tocable + cuerpo replegado por defecto (las listas largas no abruman al abrir).
                const CATKEYS={prog:['prog'],new:['nuevas'],dup:['adj','dup'],reg:['reg'],nc:['nc'],cre:['cre'],sinpdf:['sinpdf'],err:['err']}
                const goSec=(cat)=>{ const ks=CATKEYS[cat]||[cat]; ks.forEach(k=>setSecOpen(p=>({...p,[k]:true}))); setTimeout(()=>{ for(const k of ks){ const el=document.getElementById('imp-sec-'+k); if(el){ el.scrollIntoView({behavior:'smooth',block:'start'}); break } } },70) }
                const sec=(key,t,c,items,rowFn,def=false)=>{ if(!items.length) return null; const open=secOpen[key]??def; return <div key={key} id={'imp-sec-'+key}><div onClick={()=>setSecOpen(p=>({...p,[key]:!open}))} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',margin:'12px 2px 2px'}}><span style={{fontSize:9,color:c,transform:open?'rotate(90deg)':'none',transition:'transform .12s'}}><Gl n='chevron'/></span><span style={{fontSize:9,fontWeight:700,color:c,textTransform:'uppercase',letterSpacing:.3}}>{t}</span></div>{open&&items.map(rowFn)}</div> }
                return createPortal(
                  <div style={{position:'fixed',left:0,right:0,top:0,bottom:'calc(56px + env(safe-area-inset-bottom,0px))',background:C.bg,zIndex:100,display:'flex',flexDirection:'column'}}>
                  <div style={{display:'flex',alignItems:'center',gap:12,padding:'calc(env(safe-area-inset-top,0px) + 14px) 16px 12px',borderBottom:`1px solid ${C.border}`,background:C.surface,flexShrink:0}}>
                    <button onClick={async()=>{ const pend=(prog||[]).length+(nuevas||[]).length; if(pend>0 && !(await appConfirm({title:`Quedan ${pend} carga${pend!==1?'s':''} sin registrar`, message:'Se guardan en “Cargar XML › Cargadas sin registrar”. No se registran ni entran en tus cifras hasta completarlas, y no se duplican.', confirmText:'Guardar y salir', cancelText:'Volver a la carga'}))) return; setRespaldoRes(null); contarSinRegistrar() }} style={chipBtn('primary')}><Gl n='chevL'/> Volver</button>
                    <span style={{fontSize:15,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.3}}>Cargar XML del SII · {respaldoRes.length}</span>
                  </div>
                  <div style={{flex:1,overflowY:'auto',WebkitOverflowScrolling:'touch'}}>
                  <div style={{maxWidth:600,margin:'0 auto',padding:'14px 16px 34px'}}>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10,background:C.bgSoft,borderRadius:8,padding:'7px 10px'}}><b style={{color:C.text}}>Lo cargado queda guardado aunque salgas.</b> Se registra en las fichas cuando tú quieras.</div>
                  <div style={{display:'flex',gap:8,marginBottom:10}}>
                    <div onClick={()=>goSec('prog')} style={{flex:1,background:C.bgWarm,borderRadius:10,padding:'8px 10px',cursor:'pointer'}}><div style={{fontSize:18,fontWeight:800,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{prog.length+reg.length}</div><div style={{...SEC_LBL}}>Programadas</div></div>
                    <div onClick={()=>goSec('nc')} style={{flex:1,background:'#FAECE7',borderRadius:10,padding:'8px 10px',cursor:'pointer'}}><div style={{fontSize:18,fontWeight:800,color:C.coralText,fontVariantNumeric:'tabular-nums'}}>{nc.length}</div><div style={{fontSize:9,fontWeight:600,color:C.coralText,textTransform:'uppercase',letterSpacing:.3}}>Nota de crédito</div></div>
                    <div onClick={()=>goSec('new')} style={{flex:1,background:C.soonBg,borderRadius:10,padding:'8px 10px',cursor:'pointer'}}><div style={{fontSize:18,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{nuevas.length}</div><div style={{fontSize:9,fontWeight:600,color:C.soonText,textTransform:'uppercase',letterSpacing:.3}}>Nuevas</div></div>
                  </div>
                  {respaldoFiles&&respaldoFiles.length>1&&(()=>{
                    const catOf=catImport
                    const PILL={prog:['programadas',C.bgWarm,C.muted],new:['nuevas',C.soonBg,C.soonText],dup:['ya cargadas',C.greenBg,C.greenText],reg:['registradas',C.greenBg,C.greenText],nc:['nota de crédito','#FAECE7',C.coralText],cre:['agregadas',C.greenBg,C.greenText],sinpdf:['falta respaldo',C.soonBg,C.soonText],err:['con problema',C.overdueBg,C.overdueText]}
                    const order=['prog','new','dup','reg','nc','cre','sinpdf','err']
                    const totDocs=respaldoFiles.reduce((a,f)=>a+(f.total||0),0), totSkip=respaldoFiles.reduce((a,f)=>a+(f.skipped||0),0)
                    return <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:12}}>
                      <div style={{padding:'10px 13px 8px',borderBottom:`1px solid ${C.bgSoft}`}}>
                        {respaldoAt&&<div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.5}}>Cargado {fmtFechaHora(respaldoAt)}</div>}
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginTop:respaldoAt?3:0}}>
                          <span style={{fontSize:11,color:C.muted}}>{respaldoFiles.length} archivos · {totDocs} documentos</span>
                          {totSkip>0&&<span style={{fontSize:10,color:C.muted,flexShrink:0}}>{totSkip} repetido{totSkip!==1?'s':''} omitido{totSkip!==1?'s':''}</span>}
                        </div>
                      </div>
                      {respaldoFiles.map((f,fi)=>{ const items=(respaldoRes||[]).filter(r=>r.archivo===f.name); const counts={}; items.forEach(r=>{ const k=catOf(r.estado); counts[k]=(counts[k]||0)+1 }); return (
                        <div key={f.name} style={{padding:'10px 12px',borderTop:fi?`1px solid ${C.bgSoft}`:'none'}}>
                          <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.name}</span><span style={{marginLeft:'auto',fontSize:10,color:C.muted,fontWeight:600,flexShrink:0}}>{f.total} doc</span></div>
                          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:6}}>{order.filter(k=>counts[k]).map(k=>{ const p=PILL[k]; return <span key={k} onClick={()=>goSec(k)} style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'2px 9px',background:p[1],color:p[2],cursor:'pointer'}}>{counts[k]} {p[0]}</span> })}{f.skipped>0&&<span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.bgSoft,color:C.muted,whiteSpace:'nowrap'}}>{f.skipped} repetida{f.skipped!==1?'s':''}</span>}</div>
                        </div>) })}
                    </div> })()}
                  {prog.length>0&&<button onClick={()=>setRegReview(prog)} style={{width:'100%',fontSize:13,fontWeight:600,color:C.accent,background:C.azulBg,border:`1px solid #B5D4F4`,borderRadius:8,padding:'9px 0',cursor:'pointer'}}>Registrar las {prog.length} emitidas</button>}
                  {sec('prog',`Programadas · ${prog.length}`,C.muted,prog,progRowR,false)}
                  {sec('nuevas',`Nuevas · ${nuevas.length}`,C.soonText,nuevas,progRowR,true)}
                  {nc.length>0&&<div id='imp-sec-nc'>{hdr(`Notas de crédito · ${nc.length}`,C.coralText)}{nc.map(ncRowR)}</div>}
                  {sec('reg',`Registradas · ${reg.length}`,C.greenText,reg,progRowR,false)}
                  {sec('adj',`Adjuntadas al Drive · ${adj.length}`,C.greenText,adj,row,false)}
                  {sec('dup',`Ya tenían respaldo · ${dup.length}`,C.muted,dup,row,false)}
                  {sec('cre',`Agregadas · ${cre.length}`,C.greenText,cre,row,false)}
                  {sinpdf.length>0&&<div id='imp-sec-sinpdf'>{hdr(`Registradas · falta respaldo en Drive · ${sinpdf.length}`,C.soonText)}
                    <div style={{fontSize:11,color:C.muted,margin:'2px 2px 7px',lineHeight:1.45}}>Estas facturas <b style={{color:C.text}}>ya quedaron registradas</b> (en tus cifras y por cobrar). Solo no se pudo guardar su PDF-respaldo en Drive porque se cayó la conexión. Reintenta cuando quieras — no se duplica nada.</div>
                    {sinpdf.map(row)}
                    <button disabled={!!respaldoRetry} onClick={()=>reintentarRespaldos(sinpdf)} style={{width:'100%',marginTop:8,fontSize:12,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'9px 0',cursor:respaldoRetry?'default':'pointer',opacity:respaldoRetry?.6:1}}>{respaldoRetry?'Reintentando…':`Reintentar respaldo en Drive · ${sinpdf.length}`}</button>
                  </div>}
                  {err.length>0&&<div id='imp-sec-err'>{hdr(`Con problema · ${err.length}`,C.overdueText)}{err.map(row)}</div>}
                  </div>
                  </div>
                  </div>, document.body) })()}
              {ncConfirm&&(()=>{ const it=ncConfirm.item; return (
                <div style={{position:'fixed',inset:0,zIndex:9999,background:C.bgSoft,overflowY:'auto'}}>
                  <div style={{maxWidth:560,margin:'0 auto',padding:'20px 16px 44px'}}>
                    <button onClick={()=>!ncBusy&&setNcConfirm(null)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',color:C.muted,cursor:ncBusy?'default':'pointer',fontSize:13,fontWeight:700,padding:0,marginBottom:14}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M19 12H5'/><path d='m12 19-7-7 7-7'/></svg>Volver</button>
                    <h1 style={{fontSize:21,fontWeight:800,color:C.accent,letterSpacing:-.5,margin:'0 0 14px'}}>¿Anular la Factura N° {it.facFolio}?</h1>
                    <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:14,padding:'15px 16px'}}>
                      <div style={{fontSize:13.5,color:C.text,lineHeight:1.55}}>{it.facCliente||it.receptor||'—'} · <b style={{fontVariantNumeric:'tabular-nums'}}>{fmt(it.monto)}</b>. Queda <b>Anulada</b> y sale del por cobrar. Reversible.{it.inferido?' Calce por RUT + monto exacto — confirma que es la factura correcta.':''}</div>
                      {it.replId&&<div onClick={()=>setNcVincular(v=>!v)} style={{display:'flex',gap:9,alignItems:'flex-start',marginTop:13,background:C.bgSoft,border:`0.5px solid ${C.border}`,borderRadius:10,padding:'10px 11px',cursor:'pointer'}}>
                        <span style={{width:17,height:17,borderRadius:6,flexShrink:0,marginTop:1,background:ncVincular?C.accent:'#fff',border:`1px solid ${ncVincular?C.accent:C.border}`,display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{ncVincular&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>}</span>
                        <div><div style={{fontSize:12,fontWeight:600,color:C.text}}>Vincular la Factura N° {it.replFolio} como su reemplazo</div><div style={{fontSize:10,color:C.muted,marginTop:1,lineHeight:1.4}}>{it.replCliente||''} · solo deja la trazabilidad, no mueve dinero.</div></div>
                      </div>}
                    </div>
                    <div style={{display:'flex',gap:9,marginTop:16}}>
                      <button disabled={ncBusy} onClick={()=>setNcConfirm(null)} style={{flex:1,fontSize:13,fontWeight:700,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 0',cursor:'pointer'}}>Cancelar</button>
                      <button disabled={ncBusy} onClick={()=>anularPorNC(it,0,it.replId?ncVincular:false)} style={{flex:1,fontSize:13,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:10,padding:'12px 0',cursor:ncBusy?'default':'pointer',opacity:ncBusy?.6:1}}>{ncBusy?'Anulando…':'Anular'}</button>
                    </div>
                  </div>
                </div>
              )})()}
            </div>
          </div>
        </div>

        {filter!=='anticipos'&&filter!=='checklist'&&filter!=='sinanio'&&filter!=='resumen'&&filter!=='terceros'&&filter!=='rechazadas'&&filter!=='porcompletar'&&filter!=='sinemitir'&&(()=>{
          const lista=bb.filter(b=>!b.deleted_at&&esEmitida(b)&&b.email_sent_at&&saldoBill(b)>0&&!['Pagado','Anulada','Anticipada'].includes(b.status))
            .map(b=>({b,dias:Math.floor((Date.now()-new Date(b.email_sent_at).getTime())/86400000),venc:esVencidaG(b)}))
            .sort((a,z)=>((z.venc?1:0)-(a.venc?1:0))||(z.dias-a.dias))   // vencidas primero (lo urgente), luego por días desde el envío
          if(!lista.length) return null
          const tot=lista.reduce((a,x)=>a+saldoBill(x.b),0)
          return (<div style={{background:C.overdueBg,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:9}}>
            <div onClick={()=>setCobranzaOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.overdue} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><path d='M10 5a2 2 0 0 1 4 0c4 1 4 5 4 7l1 3H5l1-3c0-2 0-6 4-7'/><path d='M9 18a3 3 0 0 0 6 0'/></svg>
              <span style={{fontSize:13,fontWeight:700,color:C.coralText,flex:1}}>{lista.length} {lista.length===1?'factura enviada sin pago':'facturas enviadas sin pago'} · {fmt(tot)}</span>
              <span style={{fontSize:10,color:C.muted}}>{cobranzaOpen?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
            </div>
            {cobranzaOpen&&<div style={{marginTop:8,display:'flex',flexDirection:'column',gap:6}}>
              {lista.map(({b,dias,venc})=>{ const cl=clients.find(x=>x.id===b.client_id); return (
                <div key={b.id} onClick={()=>onOpenClientFicha&&b.client_id&&onOpenClientFicha(b.client_id)} style={{display:'flex',alignItems:'center',gap:9,paddingTop:6,borderTop:`0.5px solid ${C.border}`,cursor:onOpenClientFicha?'pointer':'default'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cl?.name||b.receptor_name||'Sin cliente'}{b.invoice_no?` · Factura N° ${folioN(b.invoice_no)}`:''}</div><div style={{fontSize:10,color:venc?C.coralText:C.muted}}>{dias===0?'Enviada hoy':`Enviada hace ${dias}d`}{venc?' · vencida':''} · {fmt(saldoBill(b))}{recordadoMap[String(b.id)]&&<span style={{color:C.grisText}}> · {diasDesde(recordadoMap[String(b.id)])===0?'recordado hoy':`recordado hace ${diasDesde(recordadoMap[String(b.id)])}d`}</span>}</div></div>
                  {(()=>{ const rd=diasDesde(recordadoMap[String(b.id)]); const reciente=rd!=null&&rd<=2; return <ActBtn variant={reciente?'softMuted':'softNavy'} onClick={(e)=>{e.stopPropagation();recordarCobro(b)}} style={{flexShrink:0}}>{reciente?'Recordar otra vez':'Recordar'}</ActBtn> })()}
                </div>
              )})}
            </div>}
          </div>)
        })()}
        {filter!=='anticipos'&&filter!=='checklist'&&filter!=='sinanio'&&filter!=='resumen'&&filter!=='terceros'&&filter!=='rechazadas'&&filter!=='porcompletar'&&filter!=='sinemitir'&&(calcesSugeridos.clean.length>0||calcesSugeridos.revisar.length>0)&&(
          <div style={{background:C.greenBg,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:9}}>
            <div onClick={()=>setCalcesOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.normal} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0}}><path d='M9 12l2 2 4-4'/><circle cx='12' cy='12' r='9'/></svg>
              <span style={{fontSize:13,fontWeight:700,color:C.greenText,flex:1}}>{calcesSugeridos.clean.length} {calcesSugeridos.clean.length===1?'pago del banco listo para conciliar':'pagos del banco listos para conciliar'}{calcesSugeridos.revisar.length>0?` · ${calcesSugeridos.revisar.length} a revisar`:''}</span>
              <span style={{fontSize:10,color:C.muted}}>{calcesOpen?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
            </div>
            {calcesOpen&&<div style={{marginTop:8}}>
              {calcesSugeridos.clean.map(({factura:f,abono:m,rut})=>{
                const cl=clients.find(c=>String(c.id)===String(m.cliente_id))||clients.find(c=>String(c.id)===String(efClientIdG(f))); const cliName=cl?.name||f.receptor_name||m.nombre_contraparte||'—'
                const rol=(m.rol_cuenta==='gastos'?'GASTOS':'HONORARIOS')
                const rRut=f.receptor_rut||''; const rN=f.receptor_name||(rRut?clientEntities.find(e=>nrG(e.rut)===nrG(rRut))?.name:'')||''
                const sameRut=!!rRut&&!!m.rut_contraparte&&nrG(rRut)===nrG(m.rut_contraparte)
                return (
                <div key={`${f.id}-${m.id}`} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:9}}>
                    <span style={{fontSize:14,fontWeight:600,color:C.accent,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cliName}</span>
                    <span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>1:1{rut?<>{" "}· RUT{" "}<Gl n='tick'/></>:''}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    <div style={{background:C.bgSoft,borderRadius:10,padding:'8px 9px',minWidth:0,overflow:'hidden'}}>
                      <div style={{fontSize:9,fontWeight:700,color:C.azulInfo,marginBottom:4,letterSpacing:'.2px'}}>ABONO · {rol}</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.accent}}>{fmt(m.monto)}</div>
                      <div style={{fontSize:11,color:C.text,margin:'1px 0 3px'}}>{fmtDate(m.fecha)}</div>
                      <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.nombre_contraparte||'—'}</div>
                      <div style={{fontSize:10,color:C.muted}}>{m.rut_contraparte||''}</div>
                    </div>
                    <div style={{background:C.bgSoft,borderRadius:10,padding:'8px 9px',minWidth:0,overflow:'hidden'}}>
                      <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:4,letterSpacing:'.2px'}}>FACTURA N° {folioN(f.invoice_no)}</div>
                      <div style={{fontSize:14,fontWeight:600,color:C.accent}}>{fmt(saldoBill(f))}</div>
                      <div style={{fontSize:11,color:C.text,margin:'1px 0 3px'}}>{fmtDate(f.issued_at)}</div>
                      <div style={{fontSize:10,fontWeight:sameRut?600:400,color:sameRut?C.greenText:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rN||'sin RS'}</div>
                      <div style={{fontSize:10,fontWeight:sameRut?600:400,color:sameRut?C.greenText:C.muted}}>{rRut||''}</div>
                      {f.concept&&<div style={{fontSize:9,color:C.grisText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:3}}>{f.concept}</div>}
                    </div>
                  </div>
                  <div style={{display:'flex',justifyContent:'flex-end',marginTop:7}}>
                    <button disabled={pagoBusy} onClick={()=>conciliarPago(m,f)} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 15px',cursor:pagoBusy?'default':'pointer'}}>Conciliar</button>
                  </div>
                </div>
              )})}
              {calcesSugeridos.revisar.length>0&&<div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:C.soonText,marginBottom:6,display:'flex',alignItems:'center',gap:5}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.soon} strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12' y2='17'/></svg>Revisar · no se concilian solos</div>
                {calcesSugeridos.revisar.map(({abono:m,facturas})=>{
                  const cliName=clients.find(c=>String(c.id)===String(m.cliente_id))?.name||m.nombre_contraparte||'—'
                  const rol=(m.rol_cuenta==='gastos'?'GASTOS':'HONORARIOS')
                  return (
                  <div key={m.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
                    <div style={{fontSize:14,fontWeight:600,color:C.accent,marginBottom:2}}>{cliName}</div>
                    <div style={{fontSize:10,color:C.muted,marginBottom:9}}>Mismo monto en {facturas.length} facturas · <b style={{color:C.accent}}>se sugiere la más antigua</b> (se cobra primero lo más viejo)</div>
                    {[...facturas].sort((a,b)=>String(a.issued_at||a.due||'').localeCompare(String(b.issued_at||b.due||''))).map((f,fi)=>{
                      const esFifo=fi===0   // la más antigua = sugerida (FIFO): se salda primero lo que lleva más tiempo pendiente
                      const rRut=f.receptor_rut||''
                      const rN=f.receptor_name||(rRut?clientEntities.find(e=>nrG(e.rut)===nrG(rRut))?.name:'')||''
                      const sameRut=!!rRut&&!!m.rut_contraparte&&nrG(rRut)===nrG(m.rut_contraparte)
                      const contested=calcesSugeridos.contested.has(String(f.id))
                      return (<div key={f.id} style={{marginBottom:9}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                          <div style={{background:C.bgSoft,borderRadius:10,padding:'8px 9px',minWidth:0,overflow:'hidden'}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.azulInfo,marginBottom:4,letterSpacing:'.2px'}}>ABONO · {rol}</div>
                            <div style={{fontSize:14,fontWeight:600,color:C.accent}}>{fmt(m.monto)}</div>
                            <div style={{fontSize:11,color:C.text,margin:'1px 0 3px'}}>{fmtDate(m.fecha)}</div>
                            <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.nombre_contraparte||'—'}</div>
                            <div style={{fontSize:10,color:C.muted}}>{m.rut_contraparte||''}</div>
                          </div>
                          <div style={{background:esFifo?C.greenBg:C.bgSoft,borderRadius:10,padding:'8px 9px',minWidth:0,overflow:'hidden',border:esFifo?`1px solid ${C.normal}`:((rRut&&!sameRut)?`1px solid ${C.soon}`:'1px solid transparent')}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.muted,marginBottom:4,letterSpacing:'.2px',display:'flex',alignItems:'center',gap:5}}>FACTURA N° {folioN(f.invoice_no)}{esFifo&&<span style={{fontSize:8,fontWeight:800,color:C.greenText,background:'#fff',borderRadius:20,padding:'1px 6px'}}>más antigua · sugerida</span>}</div>
                            <div style={{fontSize:14,fontWeight:600,color:C.accent}}>{fmt(saldoBill(f))}</div>
                            <div style={{fontSize:11,color:C.text,margin:'1px 0 3px'}}>{fmtDate(f.issued_at)}</div>
                            <div style={{fontSize:10,fontWeight:sameRut?600:400,color:sameRut?C.greenText:(rRut?C.soonText:C.muted),overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rN||'sin RS'}</div>
                            <div style={{fontSize:10,fontWeight:sameRut?600:400,color:sameRut?C.greenText:C.muted}}>{rRut||''}</div>
                            {f.concept&&<div style={{fontSize:9,color:C.grisText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:3}}>{f.concept}</div>}
                          </div>
                        </div>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:7,gap:8}}>
                          {contested?<span style={{fontSize:9,fontWeight:600,color:C.coralText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>Otro abono también la reclama</span>:<span/>}
                          <button disabled={pagoBusy} onClick={()=>conciliarPago(m,f)} style={{fontSize:11,fontWeight:esFifo?800:600,color:'#fff',background:esFifo?C.normal:C.accent,border:'none',borderRadius:8,padding:'6px 14px',cursor:pagoBusy?'default':'pointer',flexShrink:0}}>Conciliar{esFifo?' (sugerida)':''}</button>
                        </div>
                      </div>)})}
                    {otraFor!==m.id
                      ? <div style={{borderTop:`1px solid ${C.border}`,paddingTop:7}}><button onClick={()=>{setOtraFor(m.id);setOtraQ('')}} style={{fontSize:10,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:0}}>Otra factura <Gl n='chevD'/></button></div>
                      : <div style={{marginTop:4,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
                          <input value={otraQ} onChange={e=>setOtraQ(e.target.value)} placeholder='Buscar factura del cliente…' style={{width:'100%',boxSizing:'border-box',fontSize:10,padding:'4px 7px',borderRadius:6,border:`1px solid ${C.border}`,marginBottom:5}}/>
                          {(()=>{ const lst=otrasFacturas(m); if(!lst.length) return <div style={{fontSize:9,color:C.muted,padding:'2px 0'}}>Sin otras facturas con saldo de este cliente.</div>
                            return lst.map(({b:f,rutM,rsM,exacto})=>{ const cliName=clients.find(c=>String(c.id)===String(efClientIdG(f)))?.name||''; const rN=f.receptor_name||''
                              return (<div key={f.id} style={{display:'flex',alignItems:'center',gap:8,background:'#fff',borderRadius:8,padding:'5px 8px',marginBottom:3}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:10,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(f.invoice_no)} · {f.concept||'—'}</div>
                                  <div style={{fontSize:9,color:exacto?C.greenText:C.muted}}>Emitida {fmtDate(f.issued_at)} · saldo {fmt(saldoBill(f))}{exacto?' · calza exacto':' · monto distinto'}</div>
                                  <div style={{fontSize:9,color:C.grisText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cliName||rN||'—'}{rutM?' · mismo RUT':rsM?' · misma RS':''}{rN&&cliName&&_normTxt(rN)!==_normTxt(cliName)?` · a ${rN}`:''}</div>
                                </div>
                                <button disabled={pagoBusy} onClick={()=>conciliarPago(m,f)} style={{fontSize:9,color:exacto?'#fff':C.accent,background:exacto?C.tealText:'#fff',border:`0.5px solid ${exacto?C.tealText:C.border}`,borderRadius:20,padding:'3px 9px',fontWeight:600,cursor:pagoBusy?'default':'pointer',whiteSpace:'nowrap',flexShrink:0}}>{exacto?'Conciliar':'Parcial'}</button>
                              </div>) }) })()}
                          <button onClick={()=>setOtraFor(null)} style={{fontSize:9,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:'3px 0'}}>Cerrar</button>
                        </div>}
                  </div>
                )})}
              </div>}
            </div>}
          </div>
        )}
        {filter!=='resumen'&&<div style={{display:'flex',alignItems:'center',gap:8,marginBottom:9,flexWrap:'wrap'}}>
          <span onClick={()=>{setFilter('resumen');clearSel()}} title='Volver al resumen' style={{fontSize:16,color:C.accent,cursor:'pointer',flexShrink:0,lineHeight:1}}><Gl n='chevL'/></span>
          {filter==='rechazadas'
            ? <span style={{fontSize:11,fontWeight:700,padding:'5px 13px',borderRadius:20,background:C.overdueBg,color:C.overdueText,flexShrink:0}}>DTE rechazadas</span>
            : filter==='sinemitir'
            ? <span style={{fontSize:11,fontWeight:700,padding:'5px 13px',borderRadius:20,background:C.soonBg,color:C.soonText,flexShrink:0}}>Cuotas vencidas sin facturar</span>
            : filter==='sinfacturar'
            ? <span style={{fontSize:11,fontWeight:700,padding:'5px 13px',borderRadius:20,background:C.soonBg,color:C.soonText,flexShrink:0}}>Trabajos sin facturar</span>
            : filter==='porcompletar'
            ? <span style={{fontSize:11,fontWeight:700,padding:'5px 13px',borderRadius:20,background:C.overdueBg,color:C.overdueText,flexShrink:0}}>Por clasificar</span>
            : <div style={{display:'inline-flex',background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden',flexShrink:0}}>
            {[['clientes','Por cliente'],['all','Todas']].map(([v,l])=><span key={v} onClick={()=>{setFilter(v);clearSel();setSoloSinEnviar(false)}} style={{fontSize:11,fontWeight:600,padding:'5px 13px',cursor:'pointer',background:filter===v?C.accent:'transparent',color:filter===v?'#fff':C.muted}}>{l}</span>)}
          </div>}
          <select value={fYear} onChange={e=>{setFYear(e.target.value); if(!e.target.value)setFMonth('')}} style={{fontSize:11,fontWeight:600,border:`1px solid ${fYear?C.accent:C.border}`,borderRadius:20,padding:'5px 9px',background:fYear?C.azulBg:'#fff',color:fYear?C.accent:C.muted,cursor:'pointer',flexShrink:0,appearance:'none'}}>
            <option value=''>Todos los años</option>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {(filter==='clientes'||filter==='all')&&(()=>{
            // Estado = filtro desplegable con su cifra (reemplaza las mini tarjetas y los chips). Cifras: las mismas de la foto (pending/overdue/programado/paid).
            const key=Object.keys(ESTADO_MAP).find(k=>ESTADO_MAP[k].slice().sort().join(',')===[...estSel].sort().join(','))||''
            const yl=fYear?` ${fYear}`:''
            const opts=[['','Todos los estados'],['vencido',`Vencidas · ${fmtMill(overdue)}`],['emitidas',`Por cobrar · ${fmtMill(pending)}`],['programadas',`Por facturar${yl} · ${fmtMill(programado)}`],['pagado',`Pagadas${yl} · ${fmtMill(paid)}`],['anuladas','Anuladas']]
            const on=key!==''||!!agingF, ven=key==='vencido'||!!agingF
            return <select value={agingF?'aging':key} onChange={e=>{setEstSel(new Set(ESTADO_MAP[e.target.value]||[]));setAgingF('')}} style={{fontSize:11,fontWeight:600,border:`1px solid ${on?(ven?C.overdueText:C.accent):C.border}`,borderRadius:20,padding:'5px 9px',background:on?(ven?C.overdueBg:C.azulBg):'#fff',color:on?(ven?C.overdueText:C.accent):C.muted,cursor:'pointer',flexShrink:0,appearance:'none',maxWidth:'100%'}}>
              {agingF&&<option value='aging'>Vencidas {({'1-30':'1–30 días','31-60':'31–60 días','61-90':'61–90 días','90':'+90 días'})[agingF]||agingF}</option>}
              {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          })()}
          <div style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:10,flexShrink:0}}>
            {filter!=='porcompletar'&&<button onClick={()=>setShowBuscar(s=>!s)} title='Buscar' style={{display:'inline-flex',alignItems:'center',background:'none',border:'none',cursor:'pointer',color:(q||showBuscar)?C.accent:C.muted,padding:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg></button>}
            <div style={{position:'relative'}}>
              <span onClick={()=>setMoreOpen(o=>!o)} title='Más' style={{fontSize:20,color:C.muted,cursor:'pointer',letterSpacing:1,lineHeight:1}}>⋯</span>
              {moreOpen&&<><div onClick={()=>setMoreOpen(false)} style={{position:'fixed',inset:0,zIndex:90}}/><div style={{position:'absolute',top:26,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',zIndex:100,minWidth:160,overflow:'hidden'}}>
                {[['resumen','Resumen'],['terceros','Proveedores'],['anticipos','Anticipos'],['sinanio',sinAnio.length?`Sin año · ${sinAnio.length}`:'Sin año']].map(([v,l])=><div key={v} onClick={()=>{setMoreOpen(false);setFilter(v);clearSel()}} style={{padding:'10px 12px',fontSize:13,color:filter===v?C.accent:C.text,fontWeight:filter===v?600:400,cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{l}</div>)}
                <div onClick={()=>{if(!backfillBusy){setMoreOpen(false);backfillRespaldos()}}} title='Genera y sube a Drive el PDF de las facturas emitidas que aún no tienen copia' style={{padding:'10px 12px',fontSize:13,color:C.tealText,fontWeight:600,cursor:backfillBusy?'default':'pointer'}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{backfillBusy?'Respaldando en Drive…':'Respaldar facturas en Drive'}</div>
              </div></>}
            </div>
          </div>
        </div>}
        {filter==='anticipos'&&<AnticiposPanel anticipos={anticipos} clients={clients} clientEntities={clientEntities} billing={billing} sales={sales} onNuevo={onNuevoAnticipo} onCubrir={setCubrirAnt} onDescubrir={onDescubrirCuotas} onDeshacerConsumo={onDeshacerConsumo} onFacturar={setFacturarAnt} onFusionar={onFusionarAnticipos} onAbrir={onAbrirAnticipo} onConsume={onConsumeAnticipos} onOpenClientFicha={onOpenClientFicha} onOpenFactura={onEdit}/>}
        {filter!=='checklist'&&filter!=='anticipos'&&filter!=='sinanio'&&filter!=='resumen'&&<>
        {showBuscar&&filter!=='porcompletar'&&(
          <div style={{display:'flex',gap:6,marginBottom:6}}>
            <Inp autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente, N° factura...' style={{flex:1,marginBottom:0,padding:'7px 11px',fontSize:13}}/>
            <button onClick={()=>setShowBuscar(false)} style={{flexShrink:0,padding:'0 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Listo</button>
          </div>
        )}
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

      {payingId&&(()=>{ const pb=billing.find(b=>String(b.id)===String(payingId))||{}; const _cl=clients.find(c=>String(c.id)===String(pb.client_id)); return (
        <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#fff',borderRadius:16,width:'min(90vw, 340px)',overflow:'hidden'}}>
            <div style={{padding:'18px 20px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:14,fontWeight:600}}><span style={{color:C.accent}}>Registrar pago</span>{_cl&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 6px'}}>|</span><span style={{color:C.muted}}>{_cl.name}</span></>}{(()=>{ const rs=rsLabel(pb.client_id,clients,clientEntities,pb.entity_id); return (rs.name&&rs.name!==_cl?.name)||rs.rut ? <span style={{color:C.muted,fontWeight:400,fontSize:11}}> · {rsDisplay(rs.name)}{rs.rut?` · ${fmtRutCL(rs.rut)}`:''}</span> : null })()}</span>
              <button onClick={()=>setPayingId(null)} style={{width:28,height:24,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
              </button>
            </div>
            <div style={{padding:'12px 20px 16px',borderBottom:`0.5px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,color:C.textSoft}}>Saldo{pb.invoice_no?<> · <Copyable text={String(folioN(pb.invoice_no)||pb.invoice_no)} title='Copiar folio' style={{color:C.textSoft,fontWeight:600}}>Factura N° {folioN(pb.invoice_no)||pb.invoice_no}</Copyable></>:''}</div>
                <div style={{fontSize:26,fontWeight:500,color:C.text,letterSpacing:'-.5px'}}>{fmt(Math.max(0,(pb.amount||0)-(pb.paid_amount||0)))}</div>
                <div style={{fontSize:12,color:C.textSoft,marginTop:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pb.concept||'—'}{pb.invoice_no?` · Factura N° ${folioN(pb.invoice_no)}`:''}{(pb.paid_amount||0)>0?` · ya abonado ${fmt(pb.paid_amount)}`:''}</div>
              </div>
              <div style={{width:40,height:40,borderRadius:12,background:C.greenBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
              </div>
            </div>
            <div style={{padding:'14px 20px 0'}}>
              <label style={{fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',marginBottom:6,display:'block'}}>MONTO A REGISTRAR</label>
              <input inputMode='numeric' value={payMonto} onChange={e=>setPayMonto(e.target.value.replace(/[^\d]/g,''))} style={{width:'100%',border:`1.5px solid ${C.accent}`,borderRadius:8,fontSize:15,fontWeight:600,padding:'9px 11px',color:C.accent,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
              {(()=>{ const total=pb.amount||0, ya=pb.paid_amount||0, saldo=Math.max(0,total-ya); const monto=parseInt(String(payMonto).replace(/[^\d]/g,''))||0; return (monto>0&&ya+monto<total)?<div style={{fontSize:11,color:C.soonText,background:C.soonBg,borderRadius:8,padding:'5px 9px',marginTop:6}}>Abono — queda <b>{fmt(saldo-monto)}</b> de saldo (sigue Pendiente)</div>:null })()}
            </div>
            <div style={{padding:'14px 20px 10px'}}>
              <label style={{fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',marginBottom:6,display:'block'}}>FECHA DE PAGO</label>
              <input type='date' value={payDate} onChange={e=>setPayDate(e.target.value)} style={{width:'100%',border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'10px 11px',color:C.text,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
            </div>
            {(()=>{ const pend=(terceros||[]).filter(t=>String(t.billing_id)===String(payingId)&&t.estado==='pendiente'); if(!pend.length) return null
              const tot=pend.reduce((a,t)=>a+(t.monto||0),0)
              const nombres=pend.map(t=>t.proveedor||'proveedor').filter((v,i,a)=>a.indexOf(v)===i).join(', ')
              return (
                <div style={{margin:'4px 20px 0',padding:'10px 12px',background:C.azulBg,borderRadius:10}}>
                  <div onClick={()=>setInclTerceros(v=>!v)} style={{display:'flex',alignItems:'flex-start',gap:9,cursor:'pointer'}}>
                    <span style={{width:18,height:18,borderRadius:6,border:`1.5px solid ${inclTerceros?C.accent:C.border}`,background:inclTerceros?C.accent:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                      {inclTerceros&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:C.accent}}>El pago incluyó lo de proveedores</div>
                      <div style={{fontSize:11,color:C.muted,marginTop:2,lineHeight:1.4}}>{nombres} · {fmt(tot)} → pasa{pend.length>1?'n':''} a <strong>Por cobrar</strong>.</div>
                    </div>
                  </div>
                </div>
              )
            })()}
            <div style={{padding:'14px 20px 20px',display:'flex',gap:8}}>
              <button onClick={()=>setPayingId(null)} style={{flex:1,height:44,borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:500,cursor:'pointer'}}>Cancelar</button>
              <button onClick={confirmPago} disabled={pagando} style={{flex:2,height:44,borderRadius:8,border:'none',background:C.greenText,color:'#fff',fontSize:13,fontWeight:500,cursor:pagando?'default':'pointer',opacity:pagando?.6:1}}>{pagando?'Guardando…':(()=>{ const total=pb.amount||0, ya=pb.paid_amount||0; const monto=parseInt(String(payMonto).replace(/[^\d]/g,''))||0; return (monto>0&&ya+monto<total)?'Confirmar abono':'Confirmar pago' })()}</button>
            </div>
          </div>
        </div>
      )})()}

      <div style={{padding:'10px 20px 100px'}}>
        {filter==='resumen' ? (()=>{
          const hoy=new Date().toISOString().slice(0,10)
          const pend=bb.filter(b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status))
          const dias=b=>b.due?Math.round((new Date(hoy)-new Date(b.due))/86400000):0
          const porCobrar=pend.reduce((a,b)=>a+saldoBill(b),0)
          const inResYear=(dateStr)=> !fYear || String(dateStr||'').slice(0,4)===fYear
          const cobAll=bb.filter(b=>cobradoBill(b)>0&&!['nota_credito','subarriendo'].includes(b.billing_type||'')&&inResYear(b.status==='Pagado'?(b.paid_at||b.issued_at):b.issued_at)).reduce((a,b)=>a+cobradoBill(b),0)   // honorarios cobrado (parciales incl.); excluye reembolso (bb), NC y subarriendo — no son ingreso
          const progAll=bb.filter(b=>b.status==='Programada'&&inResYear(b.due)).reduce((a,b)=>a+(b.amount||0),0)
          // "Por facturar" = todo sin folio (no pagado/anulado). Se separa: real (falta emitir) vs ya facturadas (duplicado, su factura emitida ya existe → vincular).
          const porFactBucket=bb.filter(b=>!b.deleted_at&&!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)&&inResYear(b.due))
          const yaFactTot=porFactBucket.filter(b=>yaFacturadasIds.has(b.id)).reduce((a,b)=>a+(b.amount||0),0)
          const porFacturarRealTot=porFactBucket.filter(b=>!yaFacturadasIds.has(b.id)).reduce((a,b)=>a+(b.amount||0),0)
          const resYears=[...new Set(bb.map(b=>String(b.paid_at||b.issued_at||b.due||'').slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a))
          const antDisp=(anticipos||[]).filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
          const provPorPagar=(terceros||[]).filter(t=>t.estado!=='pagado').reduce((s,t)=>s+(t.monto||0),0)
          const go=f=>{setFilter(f);clearSel&&clearSel()}
          return (<div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:4,marginBottom:8}}>
              {[['','Total'],...resYears.slice(0,3).map(y=>[y,y])].map(([v,l])=><span key={v||'t'} onClick={()=>setFYear(v)} style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'3px 10px',cursor:'pointer',border:`1px solid ${fYear===v?C.accent:C.border}`,background:fYear===v?C.azulBg:'#fff',color:fYear===v?C.accent:C.muted}}>{l}</span>)}
            </div>
            <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'14px 15px',marginBottom:7}}>
              <div style={{...SEC_LBL,marginBottom:12}}>Ciclo de la factura</div>
              <div style={{display:'flex',alignItems:'stretch'}}>
                <div onClick={()=>irAEstado('programadas')} style={{flex:1,textAlign:'center',cursor:'pointer'}}>
                  <SIcon n='clock' s={19} c={C.muted}/>
                  <div style={{...SEC_LBL,marginTop:4}}>Por facturar</div>
                  <div style={{fontSize:16,fontWeight:800,color:C.muted,marginTop:1}}>{fmtShort(porFacturarRealTot)}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',color:'#C7D2D7',fontSize:15,paddingTop:14}}>→</div>
                <div onClick={()=>irAEstado('emitidas')} style={{flex:1,textAlign:'center',cursor:'pointer'}}>
                  <SIcon n='file' s={19} c={C.accent}/>
                  <div style={{fontSize:9,color:C.accent,textTransform:'uppercase',letterSpacing:.3,marginTop:4,fontWeight:600}}>Por cobrar</div>
                  <div style={{fontSize:16,fontWeight:800,color:C.accent,marginTop:1}}>{fmtShort(porCobrar)}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',color:'#C7D2D7',fontSize:15,paddingTop:14}}>→</div>
                <div onClick={()=>irAEstado('pagado')} style={{flex:1,textAlign:'center',cursor:'pointer'}}>
                  <SIcon n='check' s={19} c={C.normal}/>
                  <div style={{fontSize:9,color:C.greenText,textTransform:'uppercase',letterSpacing:.3,marginTop:4,fontWeight:600}}>Pagado</div>
                  <div style={{fontSize:16,fontWeight:800,color:C.greenText,marginTop:1}}>{fmtShort(cobAll)}</div>
                </div>
              </div>
            </div>
            {/* Bloque del mes (rediseño 2026-08-04, pedido del usuario). Fila 1 = 2 tiles con TONO propio y mes como KICKER (cabe en meses largos): Cierre AZUL (reporte del mes anterior) + Facturas por emitir VERDE (pendiente del mes actual), $ como cifra. Fila(s) 2+ = tiles chicos uniformes: Anticipos disponibles + Ver cobranza fijos; higiene condicional (Ya emitidas·vincular, Pagadas sin marcar, Sin año). Reemplaza Cierre/Facturas-del-mes/duplicados/cobradas-sin-marcar/chips (Proveedores fuera). */}
            {(()=>{
              const MN=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
              const _now=new Date()
              const _pm=new Date(_now.getFullYear(),_now.getMonth()-1,1)
              const cmK=`${_pm.getFullYear()}-${String(_pm.getMonth()+1).padStart(2,'0')}`
              const cap=s=>s.charAt(0).toUpperCase()+s.slice(1)
              const emi=bb.filter(b=>!b.deleted_at&&(b.invoice_no||b.folio)&&b.status!=='Anulada'&&b.billing_type!=='reembolso'&&String(b.issued_at||b.date||'').slice(0,7)===cmK)
              const mo=b=>montoFactura(b); const ab=b=>Math.max(Number(b.paid_amount)||0,Number(respaldoMap[b.id])||0); const sa=b=>b.status==='Pagado'?0:Math.max(0,mo(b)-ab(b))
              const tEmi=emi.reduce((a,b)=>a+mo(b),0), tCob=emi.reduce((a,b)=>a+Math.max(0,mo(b)-sa(b)),0), tasa=tEmi>0?Math.round(tCob/tEmi*100):0
              const mesAct=_now.toISOString().slice(0,7)
              const pemMes=(billing||[]).filter(b=>!b.deleted_at&&b.status==='Programada'&&String(b.due||'').startsWith(mesAct))
              const pemN=pemMes.length, pemTot=pemMes.reduce((a,b)=>a+(b.amount||0),0)
              const dupN=yaFacturadasIds.size
              const cob=(billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.invoice_no&&['Vencido','Pendiente'].includes(b.status)&&(b.amount||0)>0&&saldoBill(b)===0)
              const rech=(billing||[]).filter(b=>!b.deleted_at&&/rech/i.test(b.dte_estado||''))
              const porEnviar=(billing||[]).filter(b=>!b.deleted_at&&sinEnviar(b))
              const kick={fontSize:9,fontWeight:700,letterSpacing:.6,textTransform:'uppercase',color:C.muted,marginBottom:2}
              // Solo "a mano": plata disponible + ir a Cobranza (su vista propia). La higiene bajó a "Por revisar".
              const minis=[
                {k:'Anticipos disponibles', v:antDisp>0?fmtShort(antDisp):'—', dot:antDisp>0?'#EF9F27':null, col:antDisp>0?C.accent:C.done, on:()=>go('anticipos')},
                {k:'Cobranza', v:'Ver cobranza →', nav:true, col:C.accent, on:()=>onIrCobranza&&onIrCobranza()},
              ]
              // "Por revisar": acciones de higiene (antes KPIs falsos / alertas sueltas). Cada una lleva a su lugar real.
              // Radar "Cuotas vencidas sin facturar": programadas de meses CERRADOS (antes del actual), dentro de la vida de la app (2026-06-06), de ventas Activas, que no marcaste "no corresponde". Candidatas a emitir, por revisar.
              const _m1=`${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-01`
              const sinEmitirCands=cuotasSinEmitir({billing,sales,uf:ufFechaCache()||{},noEmitir:noEmitirSet,hasta:_m1})
              const sinEmitirN=sinEmitirCands.length
              const _emitBasePC=b=>!b.deleted_at&&(b.invoice_no||b.folio)&&b.status!=='Anulada'&&b.billing_type!=='reembolso'
              // Alerta: DTE emitidos EN la app (issued>=2026-06-09) sin el XML firmado — para que no se acumulen sin que nadie los vea (histórico pre-app excluido).
              const facSinXmlN=(billing||[]).filter(b=>_emitBasePC(b)&&!b.dte_xml&&String(b.issued_at||'').slice(0,10)>='2026-06-09').length
              const revisar=[
                facSinXmlN>0&&{k:'DTE emitidos sin XML', s:'emitidas en el SII sin el XML firmado · completar', n:facSinXmlN, col:C.soonText, on:()=>go('checklist')},
                sinEmitirN>0&&{k:'Cuotas vencidas sin facturar', s:'programadas de meses cerrados · por revisar', n:sinEmitirN, col:C.soonText, on:()=>go('sinemitir')},
                trabajosSF.length>0&&{k:'Trabajos sin facturar', s:'sin factura hace más de 60 días · por revisar', n:trabajosSF.length, col:C.soonText, on:()=>go('sinfacturar')},
                rech.length>0&&{k:'DTE rechazadas por el SII', s:'revisar y volver a emitir', n:rech.length, col:C.overdueText, on:()=>go('rechazadas')},
                dupN>0&&{k:'Ya emitidas · vincular', s:'enlazar emitidas ↔ programadas · en el Cotejo con SII', n:dupN, col:C.soonText, on:()=>setSiiOpen(true)},
                porEnviar.length>0&&{k:'Por enviar al cliente', s:'emitidas sin mandar por correo', n:porEnviar.length, col:C.accent, on:abrirBandeja},
                (cob.length>0&&onDepurarCobradas)&&{k:'Pagadas sin marcar', s:'cobradas que no quedaron marcadas', n:cob.length, col:C.greenText, on:()=>setDepurarRows(cob)},
                sinAnio.length>0&&{k:'Sin año', s:'facturas sin año de venta', n:sinAnio.length, col:C.soonText, on:()=>go('sinanio')},
              ].filter(Boolean)
              const revTotal=revisar.reduce((a,r)=>a+(r.n||0),0)
              // "Facturas sin cliente / venta": la MISMA lista de su vista (catSinClienteVenta + docs del SII sin cliente reconocido).
              const porCompletarN=(billing||[]).filter(b=>catSinClienteVenta(b,tercerosByBilling)).length+(siiSinCli||[]).length
              const mesTop={fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}
              const mesN={fontSize:12,fontWeight:500,letterSpacing:.4,textTransform:'uppercase',marginTop:1}
              const money={fontSize:23,fontWeight:800,letterSpacing:-.6,marginTop:6,fontVariantNumeric:'tabular-nums',lineHeight:1}
              // Tarjeta de acceso uniforme: icono + titular MAYÚSCULAS + sub, y valor/badge/chevron a la derecha.
              const accCard=(sqbg,stroke,pathEl,titulo,sub,onClick,opts={})=>(
                <div onClick={onClick} style={{background:opts.cardBg||'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'10px 12px',cursor:'pointer',minHeight:66,height:'100%',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'center',gap:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{width:28,height:28,borderRadius:8,background:sqbg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={stroke} strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'>{pathEl}</svg></span>
                    {opts.value?<span style={{marginLeft:'auto',fontSize:14,fontWeight:800,color:opts.valCol||C.text,fontVariantNumeric:'tabular-nums',display:'flex',alignItems:'center',gap:5}}>{opts.dot&&<span style={{width:6,height:6,borderRadius:'50%',background:opts.dot}}/>}{opts.value}</span>
                      :opts.badge!=null?<span style={{marginLeft:'auto',fontSize:15,fontWeight:800,color:opts.badgeCol||C.overdueText}}>{opts.badge}</span>
                      :<span style={{marginLeft:'auto',color:C.textSoft,fontSize:12}}><Gl n='chevron'/></span>}
                  </div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:opts.titCol||C.text,lineHeight:1.3}}>{titulo}</div>
                  <div style={{fontSize:10,color:opts.subCol||C.done,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
                </div>)
              const P=d=><path d={d}/>
              return (
              <div style={{display:'flex',flexDirection:'column',gap:9,marginBottom:8}}>
                {/* EL MES */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <div onClick={()=>setCierreOpen(true)} style={{background:C.azulBg,border:'1px solid #D3E3F3',borderRadius:12,padding:'10px 12px',cursor:'pointer',position:'relative',minHeight:96}}>
                    <span style={{position:'absolute',top:9,right:11,color:'#7FA6BE',fontSize:13}}><Gl n='chevron'/></span>
                    <span style={{width:26,height:26,borderRadius:8,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:7}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/><path d='M9 16l2 2 4-4'/></svg></span>
                    <div style={{...mesTop,color:C.accent}}>Cierre de mes</div>
                    <div style={{...mesN,color:C.accent}}>{MN[_pm.getMonth()].toUpperCase()}</div>
                    {emi.length>0?<><div style={{...money,color:C.accent}}>{fmtShort(tCob)}</div><div style={{fontSize:10,color:'#3E6472',marginTop:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>pagado de {fmtShort(tEmi)} facturado · {tasa}%</div></>:<div style={{fontSize:11,color:'#3E6472',marginTop:6}}>Quién pagó y quién no</div>}
                  </div>
                  <div onClick={()=>{setFilter('checklist');clearSel&&clearSel()}} style={{background:C.greenBg,border:'1px solid #C4E7D9',borderRadius:12,padding:'10px 12px',cursor:'pointer',position:'relative',minHeight:96}}>
                    <span style={{position:'absolute',top:9,right:11,color:'#7FC4A9',fontSize:13}}><Gl n='chevron'/></span>
                    <span style={{width:26,height:26,borderRadius:8,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:7}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/></svg></span>
                    <div style={{...mesTop,color:C.greenText}}>Facturación del mes</div>
                    <div style={{...mesN,color:C.greenText}}>{MN[_now.getMonth()].toUpperCase()}</div>
                    <div style={{...money,color:C.greenText}}>{fmtShort(pemTot)}</div>
                    <div style={{fontSize:10,color:'#3E7360',marginTop:4}}>{pemN} factura{pemN!==1?'s':''} por emitir</div>
                  </div>
                </div>
                {/* ACCESOS: tarjetas iguales. Orden pedido 2026-10-02: la tarjeta roja "Facturas sin cliente / venta" ocupa el lugar de "Por socio" (arriba-izq, lo más visible); Por socio baja al espacio libre (abajo-der). */}
                {/* POR REVISAR = una tarjeta del grid (mismo formato que las demás); al tocarla, sus acciones se despliegan bajo las tarjetas. */}
                {(()=>{ const tarjetas=[
                  revisar.length>0&&accCard('#fff',C.overdueText,P('M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01'),'Por revisar',`${revisar.length} ${revisar.length===1?'acción':'acciones'} · ${porRevOpen?'ocultar':'ver'}`,()=>setPorRevOpen(o=>!o),{badge:revTotal,badgeCol:C.soonText,titCol:C.text}),
                  porCompletarN>0&&accCard('#fff',C.overdueText,P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 11v4M12 18h.01'),'Por clasificar','Sin cliente, sin venta o sin tipo',()=>go('porcompletar'),{badge:porCompletarN,badgeCol:C.overdueText,cardBg:C.overdueBg,titCol:C.overdueText,subCol:C.overdueText}),
                  accCard(C.soonBg,C.soonText,P('M3 6h17a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13M17 13h.01'),'Anticipos disponibles','a favor de clientes',()=>go('anticipos'),{value:antDisp>0?fmtShort(antDisp):'—',valCol:antDisp>0?C.soonText:C.done,dot:antDisp>0?'#EF9F27':null}),
                  onIrCobranza&&accCard(C.greenBg,C.greenText,P('M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0'),'Cobranza','Por cobrar · recordatorios de pago',()=>onIrCobranza()),
                  onOpenPorSocio&&accCard(C.azulBg,C.accent,P('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.1a4 4 0 0 1 0 7.7'),'Por socio','Facturado y caja · mes/año',onOpenPorSocio),
                  ].filter(Boolean); const nCol=isDesktop?tarjetas.length:2
                  return <div style={{display:'grid',gridTemplateColumns:`repeat(${nCol},minmax(0,1fr))`,gap:8}}>{tarjetas.map((t,i)=><div key={i} style={{minWidth:0,gridColumn:(!isDesktop&&i===tarjetas.length-1&&tarjetas.length%2)?'1 / -1':undefined}}>{t}</div>)}</div> })()}
                {porRevOpen&&revisar.length>0&&<div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                  {revisar.map((r,i)=><div key={i} onClick={r.on} className='lf-row' style={{display:'flex',alignItems:'center',gap:11,padding:'10px 13px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:'pointer'}}>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.k}</div><div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.s}</div></div>
                    <span style={{fontSize:15,fontWeight:800,color:r.col,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{r.n}</span>
                    <SIcon n='chevron' s={13} c={C.done}/>
                  </div>)}
                </div>}
              </div>
            )})()}
            {/* DTE rechazadas · Por enviar · Ya emitidas·vincular · Pagadas sin marcar · Sin año → ahora en la tira "Por revisar" (arriba). Cobranza → su vista. Proveedores fuera. */}
            {(()=>{
              const emitidas=(billing||[]).filter(b=>b.dte_track_id&&!b.deleted_at).sort((a,b)=>(b.dte_emitido_at||'')>(a.dte_emitido_at||'')?1:-1)
              const enProd=emitidas.some(b=>b.dte_ambiente==='prod')
              const Btn=(label,on,primary)=><button onClick={on} disabled={siiBusy} style={{fontSize:12,fontWeight:600,color:primary?'#fff':C.accent,background:primary?C.accent:'#fff',border:primary?'none':`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',cursor:'pointer',opacity:siiBusy?.6:1}}>{label}</button>
              const siiIcon=<svg width='19' height='19' viewBox='0 0 24 24' fill='none' stroke={enProd?C.greenText:C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6M9 13h6M9 17h4'/></svg>
              const estTxt=enProd?'Producción':etapaEmision<=1?'Sin postular':'En certificación'
              const siiSub=enProd?`${emitidas.length} emitida${emitidas.length!==1?'s':''} al SII`:'Directo desde la app'
              return (<>
                <div style={{marginTop:14}}>
                  <div style={{...SEC_LBL,margin:'2px 2px 7px'}}>Facturación electrónica</div>
                  <div onClick={()=>setSiiPageOpen(true)} style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'13px 15px',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                    <span style={{width:34,height:34,borderRadius:10,background:enProd?C.greenBg:C.azulBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{siiIcon}</span>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Emisión SII</div><div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{siiSub}</div></div>
                    <span style={{fontSize:9.5,fontWeight:700,background:enProd?C.greenBg:C.ambarBg,color:enProd?C.greenText:C.soonText,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{estTxt}</span>
                    <span style={{color:C.textSoft,fontSize:16,flexShrink:0}}><Gl n='chevron'/></span>
                  </div>
                </div>
                {siiPageOpen&&!billingPage&&createPortal(<div style={{position:'fixed',top:0,right:0,bottom:0,left:isDesktop?212:0,zIndex:200,background:C.bg,overflowY:'auto'}}>
                  <PageHeader origen='Facturación' onBack={()=>setSiiPageOpen(false)} titulo='Facturación electrónica' right={isDesktop?<span style={{fontSize:10,fontWeight:700,background:enProd?C.greenBg:C.ambarBg,color:enProd?C.greenText:C.soonText,borderRadius:20,padding:'3px 11px',whiteSpace:'nowrap'}}>{estTxt}</span>:null}/>
                  <div style={{maxWidth:isDesktop?900:560,margin:'0 auto',padding:'16px 16px 60px'}}>
                    <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,alignItems:'start'}:{display:'flex',flexDirection:'column',gap:9}}>
                      {/* Estado + folios */}
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{width:32,height:32,borderRadius:10,background:enProd?C.greenBg:C.azulBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{siiIcon}</span>
                          <div style={{flex:1,minWidth:0}}><div style={{...SEC_LBL}}>Emisión SII</div><div style={{fontSize:14,fontWeight:800,color:C.accent}}>{enProd?'Conectado':estTxt}</div></div>
                        </div>
                        <div style={{fontSize:11,color:C.muted,marginTop:6}}>{siiSub}</div>
                        {(()=>{ const f34=(foliosEstado||[]).find(x=>x.tipoDte===34); if(!f34) return null; const bajo=f34.disponibles<=5; return (
                          <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:bajo?C.overdueText:C.muted,marginTop:8}}>
                            <span style={{width:6,height:6,borderRadius:'50%',background:bajo?C.overdue:C.normal,flexShrink:0}}/>
                            {f34.disponibles} folio{f34.disponibles!==1?'s':''} disponible{f34.disponibles!==1?'s':''} (factura 34){bajo&&<b style={{color:C.overdueText}}> · solicita un nuevo CAF</b>}
                          </div>
                        ) })()}
                      </div>
                      {/* Emitidas (prod) / Puesta en marcha (cert) */}
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px'}}>
                      {enProd?(<>
                        <div style={{...SEC_LBL,marginBottom:6}}>Últimas emitidas</div>
                        {emitidas.slice(0,3).map((b,i)=>{ const cli=clients.find(c=>String(c.id)===String(b.client_id)); const ok=/acept/i.test(b.dte_estado||''); return (
                          <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderTop:i?`0.5px solid #F2F4F6`:'none'}}>
                            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>Factura N° {b.folio||folioN(b.invoice_no)||'—'} · {cli?.name||'—'}</div><div style={{fontSize:10,color:C.muted,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>Emitida {fmtFechaDMY(b.dte_emitido_at||b.issued_at)} · <span style={{color:b.email_sent_at?C.muted:C.overdueText,fontWeight:b.email_sent_at?400:700}}>{b.email_sent_at?`enviada ${fmtFechaDMY(b.email_sent_at)}`:'sin enviar'}</span> · {fmt(b.amount)}</div></div>
                            <span style={{fontSize:9.5,color:ok?C.greenText:C.soonText,background:ok?C.greenBg:C.ambarBg,borderRadius:20,padding:'2px 8px',flexShrink:0,fontWeight:700,whiteSpace:'nowrap'}}>{ok?'Aceptada':'Enviada'}</span>
                          </div>) })}
                        {!emitidas.length&&<div style={{fontSize:11,color:C.muted}}>Aún no emites facturas.</div>}
                      </>):(<>
                        <div style={{...SEC_LBL,marginBottom:8}}>Puesta en marcha</div>
                        {['Certificado digital','Postulación como facturador propio','Set de pruebas y folios de certificación','Set de pruebas aprobado','Simulación e intercambio de información','Declaración de cumplimiento y autorización','Folios de producción · emitir desde la app'].map((t,i,arr)=>{ const st=i<etapaEmision?'ok':i===etapaEmision?'now':'next'; return (
                          <div key={i} style={{display:'flex',alignItems:'center',gap:9,marginBottom:i<arr.length-1?7:0}}>
                            {st==='ok'?<span style={{width:16,height:16,borderRadius:'50%',background:C.greenText,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg></span>
                             :st==='now'?<span style={{width:16,height:16,borderRadius:'50%',border:`2px solid ${C.soon}`,background:C.ambarBg,flexShrink:0}}/>
                             :<span style={{width:16,height:16,borderRadius:'50%',border:`2px solid ${C.border}`,flexShrink:0}}/>}
                            <span style={{fontSize:12,color:st==='now'?C.text:st==='ok'?C.muted:C.done,fontWeight:st==='now'?600:400}}>{t}</span>
                          </div>) })}
                      </>)}
                      </div>
                      {/* Acciones */}
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',...(isDesktop?{gridColumn:'1 / -1'}:{})}}>
                        <div style={{...SEC_LBL,marginBottom:8}}>Acciones</div>
                        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{enProd
                          ? <>{Btn('Ver facturas',()=>{setSiiPageOpen(false);go('clientes')},true)}{Btn('Verificar estados',siiVerificarEstados)}{Btn('Enviar resumen',siiResumenSemanal)}{Btn('Probar conexión',siiProbar)}{Btn('Historial',cargarSiiLog)}</>
                          : <>{Btn('Probar conexión',siiProbar,true)}{Btn('Set de pruebas',()=>{setSiiResult(null);if(!siiSetJson)setSiiSetJson(SII_SET_SAMPLE);setSiiPanel('set')})}{Btn('Libro de ventas',()=>{setSiiResult(null);setSiiPanel('libro')})}<label style={{fontSize:12,fontWeight:600,color:C.accent,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',cursor:siiBusy?'default':'pointer',opacity:siiBusy?.6:1}}>Intercambio<input type='file' accept='.xml,text/xml' disabled={siiBusy} onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; siiIntercambio(f) }} style={{display:'none'}}/></label>{Btn('Historial',cargarSiiLog)}</>}</div>
                      </div>
                      {/* Histórico SII + pareo */}
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',...(isDesktop?{gridColumn:'1 / -1'}:{})}}>
                        <div style={{...SEC_LBL,marginBottom:6}}>Fuente de la verdad · histórico SII (solo lectura)</div>
                        <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Trae del SII las facturas y notas de crédito de <b>2025-01 a 2026-06</b> como espejo para el cuadre. No toca facturación ni cambia nada.</div>
                        {siiHistProg&&!siiHistProg.done&&<div style={{fontSize:11,color:C.accent,background:C.azulBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>Trayendo {siiHistProg.mes}… ({siiHistProg.i}/{siiHistProg.total})</div>}
                        <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{Btn(siiBusy?'Trayendo del SII…':'Traer histórico del SII (2025-01 → 2026-06)',siiTraerHistorico)}</div>
                        {siiHistProg?.done&&(()=>{ const docs=siiHistProg.docs||0, nuevas=siiHistProg.guardadas||0, ncN=siiHistProg.nc||0, pareadas=Math.max(0,docs-nuevas); return (
                          <div style={{marginTop:11}}>
                            <div style={{...SEC_LBL,marginBottom:6}}>Resultado · qué se parea con el sistema</div>
                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:7}}>
                              <div style={{background:C.greenBg,border:'1px solid #CFE9DD',borderRadius:10,padding:'9px 10px'}}><div style={{fontSize:17,fontWeight:800,color:C.greenText}}>{pareadas}</div><div style={{fontSize:9,color:C.greenText,fontWeight:600}}>pareadas · ya en el sistema</div></div>
                              <div style={{background:C.ambarBg,border:'1px solid #EBD9AE',borderRadius:10,padding:'9px 10px'}}><div style={{fontSize:17,fontWeight:800,color:C.soonText}}>{nuevas}</div><div style={{fontSize:9,color:C.soonText,fontWeight:600}}>sin parear · nuevas</div></div>
                              <div style={{background:'#FAECE7',border:'1px solid #F1DDD2',borderRadius:10,padding:'9px 10px'}}><div style={{fontSize:17,fontWeight:800,color:C.coralText}}>{ncN}</div><div style={{fontSize:9,color:C.coralText,fontWeight:600}}>notas de crédito</div></div>
                            </div>
                            <div style={{fontSize:11,color:C.muted,marginTop:7}}>De <b style={{color:C.text}}>{docs} documento{docs!==1?'s':''} del SII</b>: {pareadas} ya están en tus facturas{nuevas?`, ${nuevas} no calzan con ninguna`:''}.{siiHistProg.errores?.length?` · ${siiHistProg.errores.length} mes(es) con error`:''}</div>
                            {nuevas>0&&<button onClick={()=>{setSiiPageOpen(false);go('clientes')}} style={{marginTop:8,fontSize:11,fontWeight:700,color:'#fff',background:C.soonText,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Ver las {nuevas} sin parear →</button>}
                          </div>
                        ) })()}
                      </div>
                      {/* #4 · Notas de crédito del RCV por resolver → misma compuerta (ncConfirm/anularPorNC) */}
                      <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',...(isDesktop?{gridColumn:'1 / -1'}:{})}}>
                        <div style={{...SEC_LBL,marginBottom:6}}>Notas de crédito del SII</div>
                        {(()=>{ const items=ncResolver||[]
                          if(ncResolver==null) return <div style={{fontSize:11,color:C.muted}}>Revisando…</div>
                          if(!items.length) return <div style={{fontSize:11,color:C.muted}}>Sin notas de crédito por resolver — las del SII ya están imputadas a su factura.</div>
                          return (<>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                              <span style={{width:26,height:26,borderRadius:8,background:'#FAECE7',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='file' s={14} c={C.coralText}/></span>
                              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.coralText}}>{items.length} por resolver</div><div style={{fontSize:10,color:C.muted}}>anulan una factura que sigue viva — confirma la anulación</div></div>
                            </div>
                            {items.map(it=>(
                              <div key={it.ncFolio} style={{border:`0.5px solid ${C.border}`,borderRadius:10,padding:'8px 10px',marginBottom:6}}>
                                <div style={{fontSize:12,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{it.facCliente||it.receptor||'—'}</div>
                                <div style={{fontSize:11,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>NC N° {it.ncFolio}{it.ncFecha?` · ${fmtFechaDMY(it.ncFecha)}`:''} · {fmt(it.monto)} · anula Factura N° {it.facFolio} ({it.facStatus}){it.inferido?' · calce por RUT+monto':''}</div>
                                <div style={{marginTop:7}}><button onClick={()=>{setNcVincular(!!it.replId);setNcConfirm({item:it})}} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer'}}>Revisar y anular <Gl n='chevron'/></button></div>
                              </div>
                            ))}
                          </>) })()}
                      </div>
                    </div>
                  </div>
                </div>, document.body)}
              </>)
            })()}
          </div>)
        })()
        : filter==='clientes' ? (()=>{
          const hoy=new Date().toISOString().slice(0,10)
          const addDays=(d,n)=>{ if(!d) return ''; const x=new Date(d+'T00:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10) }
          const venceDe=b=> venceBill(b)   // fuente única del vencimiento (emisión + 30), igual que Cobranza y la ficha
          // Vencida DERIVADA con el helper único (esVencidaB), igual que Cobranza y la ficha.
          const estadoReal=b=> (b.status==='Pendiente' && esVencidaB(b)) ? 'Vencido' : b.status
          const diasVencC=b=>{ const v=venceDe(b); if(!v) return null; return Math.round((new Date(hoy)-new Date(v+'T00:00:00'))/86400000) }
          const bucketC=b=>{ const d=diasVencC(b); if(d==null||d<=0) return 'aldia'; if(d<=30) return '1-30'; if(d<=60) return '31-60'; if(d<=90) return '61-90'; return '90' }
          const matchEst=b=>{ if(agingF && bucketC(b)!==agingF) return false; if(estSel.size===0) return true; const er=estadoReal(b); return estSel.has(er)||(estSel.has('Pagado')&&er==='Anticipada') }
          let rows=bb.filter(b=>!b.deleted_at)
          if(fYear) rows=rows.filter(b=>(b.issued_at||b.due||'').slice(0,4)===fYear)
          const pasaQ=b=>{ const c=clients.find(x=>x.id===b.client_id); const qq=_normTxt(q.trim()), qd=q.replace(/[^0-9kK]/g,'').toLowerCase(); return _normTxt(c?.name).includes(qq) || _normTxt(b.concept).includes(qq) || (qd.length>=3&&String(folioN(b.invoice_no)||'').includes(qd)) || (qd.length>=4&&String(b.receptor_rut||'').replace(/[^0-9kK]/g,'').toLowerCase().includes(qd)) }   // el placeholder promete N° de factura: nombre, concepto, N° y RUT
          if(q.trim()) rows=rows.filter(pasaQ)
          if(soloSinEnviar) rows=rows.filter(sinEnviar)
          // Cifras por cliente con las MISMAS reglas que las tarjetas de arriba (pending/programado/paid), sobre todas las facturas
          // (el año entra por matchYM como en las tarjetas) → el total de cada columna = su tarjeta.
          let rowsAll=bb.filter(b=>!b.deleted_at); if(q.trim()) rowsAll=rowsAll.filter(pasaQ); if(soloSinEnviar) rowsAll=rowsAll.filter(sinEnviar)
          // Cruce de información: una factura del SII/PDF trae el RUT del receptor. Si falta el link explícito (entity_id/client_id), se resuelve por ese RUT contra las razones sociales conocidas (client_entities). Así muestra a quién pertenece sin reasignar a mano.
          const nr=r=>String(r||'').replace(/[.\s-]/g,'').toUpperCase()
          const efEntity=b=>{ if(b.entity_id){ const e=clientEntities.find(x=>String(x.id)===String(b.entity_id)); if(e) return e } if(b.receptor_rut){ const k=nr(b.receptor_rut); if(k){ const e=clientEntities.find(x=>nr(x.rut)===k); if(e) return e } } return null }
          const efClientId=b=> b.client_id || efEntity(b)?.client_id || null
          const byC={}; rows.forEach(b=>{ const cid=efClientId(b)||'__none__'; (byC[cid]=byC[cid]||[]).push(b) })
          const byCAll={}; rowsAll.forEach(b=>{ const cid=efClientId(b)||'__none__'; (byCAll[cid]=byCAll[cid]||[]).push(b) })
          const metCid=cid=>{ const v=byCAll[cid]||[]; return {pc:v.filter(b=>b.invoice_no&&['Pendiente','Vencido'].includes(b.status)).reduce((a,b)=>a+saldoBill(b),0), ve:v.filter(b=>b.invoice_no&&(b.status==='Vencido'||(b.status==='Pendiente'&&esVencidaB(b)))).reduce((a,b)=>a+saldoBill(b),0), pf:v.filter(b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)&&!yaFacturadasIds.has(b.id)&&matchYM(kpiDate(b))).reduce((a,b)=>a+(b.amount||0),0), co:v.filter(b=>cobradoBill(b)>0&&matchYM(kpiDate(b))).reduce((a,b)=>a+cobradoBill(b),0)} }
          const sinFiltroEst=estSel.size===0&&!agingF
          const _cids=new Set([...Object.keys(byC), ...(sinFiltroEst?Object.keys(byCAll).filter(cid=>{ const m=metCid(cid); return m.pc>0||m.pf>0||m.co>0 }):[])])
          const list=[..._cids].map(cid=>({c:clients.find(x=>x.id===cid)||{id:cid,name:'Sin cliente'},arr:byC[cid]||[]})).sort((a,b)=>(a.c.name||'').localeCompare(b.c.name||'','es'))
          if(!list.length) return <div style={{color:C.muted,textAlign:'center',padding:30}}>Sin facturas con estos filtros.</div>
          const fila=(b,conciliable,cli)=>{ const er=estadoReal(b); const est=estadoCobro(b,{yaFact:conciliable}); const col=est.color; const ui=ufInfoDe(b); const porConciliar=['Pendiente','Vencido'].includes(er)&&porConciliarIds.has(String(b.id)); const rsN=(()=>{ const e=efEntity(b); if(e?.name) return rsDisplay(e.name); if(b.receptor_name) return rsDisplay(b.receptor_name); if(cli&&cli.id){ const rl=rsLabel(cli.id,clients,clientEntities); if(rl.multi) return 'Sin razón social'; if(rl.name&&rl.name!==cli.name) return rsDisplay(rl.name) } return null })(); const dl=daysLeft(venceDe(b)||b.due); const diasMini=(er!=='Pagado'&&er!=='Anticipada'&&dl!=null)?(dl<0?`${Math.abs(dl)}d`:dl<=7?`${dl}d`:''):''; const exp=expandBill===b.id; return (
            <div key={b.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,marginBottom:5,overflow:'hidden'}}>
              <div onClick={()=>setExpandBill(exp?null:b.id)} style={{display:isDesktop?'grid':'flex',gridTemplateColumns:isDesktop?'62px 20px minmax(0,1fr) 180px':undefined,justifyContent:isDesktop?undefined:'space-between',alignItems:'center',gap:isDesktop?14:8,padding:isDesktop?'9px 14px':'7px 10px',cursor:'pointer'}}>
                {bigDate(kpiDate(b))}
                <SIcon n={est.icon} s={15} c={col}/>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><span style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{b.invoice_no?<Copyable text={String(folioN(b.invoice_no))} title='Copiar folio' style={{color:C.text,fontWeight:600}}>Factura N° {folioN(b.invoice_no)}</Copyable>:(b.concept||'—')}{rsN&&<span style={{color:C.muted,fontWeight:500}}> · {rsN}</span>}</span>{porConciliar&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0}}>Por conciliar</span>}</div>
                  <div style={{fontSize:9,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.invoice_no?(b.concept||'—'):''}{ui?`${b.invoice_no?' · ':''}${fmtUF(ui.uf)}`:''}{(()=>{const e=envioBadge(b);return e?<span style={{color:e.col,fontWeight:600}}> · {e.txt}</span>:null})()}{conciliable&&!b.invoice_no&&<span style={{color:C.soonText,fontWeight:700}}> · ya facturada</span>}</div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>{(()=>{ const hayAb=saldoBill(b)<(b.amount||0)&&!['Pagado','Anulada'].includes(b.status); return <><div style={{fontSize:13,fontWeight:600,color:hayAb?(er==='Vencido'?C.overdueText:C.accent):C.text}}>{fmt(hayAb?saldoBill(b):(b.status==='Programada'?(ui?ui.clpHoy:b.amount):montoFactura(b)))}</div>{hayAb&&<div style={{fontSize:9,color:C.muted}}>de {fmt(b.status==='Programada'?(ui?ui.clpHoy:b.amount):montoFactura(b))}</div>}</> })()}{diasMini&&<div style={{fontSize:9,fontWeight:600,color:col}}>{diasMini}</div>}</div>
              </div>
              {exp&&<div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:6,flexWrap:'wrap',padding:'0 10px 8px'}}>
                {!porConciliar&&['Pendiente','Vencido'].includes(er)&&(()=>{ const rd=diasDesde(recordadoMap[String(b.id)]); const rec=rd!=null&&rd<=2; return <ActBtn variant={rec?'softMuted':'softNavy'} onClick={()=>recordarCobro(b)} title={rd!=null?(rd===0?'Recordado hoy':`Recordado hace ${rd}d`):''}>{rec?'Recordar otra vez':'Recordar'}</ActBtn> })()}
                {!b.invoice_no&&conciliable&&<ActBtn variant='softAmber' onClick={()=>onConciliar&&onConciliar(cli)}>Vincular factura emitida</ActBtn>}
                {onEdit&&<ActBtn variant='ghost' onClick={()=>onEdit(b)}>Editar</ActBtn>}
                {b.invoice_no&&b.status!=='Programada'&&b.status!=='Anulada'&&<ActBtn variant='primary' onClick={()=>setFacturaEmail(b)}>{b.email_sent_at?'Reenviar':'Enviar'}</ActBtn>}
                {(b.status==='Pagado'||b.status==='Anticipada')&&<ActBtn variant='softGreen' onClick={()=>acuseCobro(b)}>Acuse</ActBtn>}
                {['Pendiente','Vencido'].includes(er)&&<ActBtn variant={porConciliar?'success':'ghost'} onClick={()=>setPagosFor(pagosFor===b.id?null:b.id)}>{porConciliar?'Conciliar pago':'Buscar pago'}</ActBtn>}
                {(()=>{ const abs=abonosDe(b); return abs.length>0?<div style={{width:'100%',marginTop:6,background:C.greenBg,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,marginBottom:4,letterSpacing:.3}}>ABONOS CONCILIADOS (BANCO)</div>{abs.map(({c,m})=><div key={c.movimiento_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,fontSize:10,padding:'2px 0'}}><span style={{color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(m.fecha)} · {m.nombre_contraparte||'Banco'}{m.n_operacion?` · Op ${m.n_operacion}`:''}</span><span style={{color:C.greenText,fontWeight:700,whiteSpace:'nowrap'}}>−{fmt(c.monto_aplicado)}</span></div>)}<div style={{display:'flex',justifyContent:'space-between',marginTop:4,paddingTop:4,borderTop:`0.5px solid ${C.normal}`,fontSize:10,fontWeight:700,color:C.text}}><span>Saldo</span><span>{fmt(saldoBill(b))}</span></div></div>:null })()}
                {porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const ps=pagosDe(b); if(!ps.length) return null; const top=ps[0]; const mult=ps.length>1; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.greenBg,border:`1px solid ${C.normal}`,borderRadius:10,padding:'7px 10px'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,letterSpacing:.3}}>{top.rut?'PAGO SUGERIDO · MISMO RUT':'PAGO SUGERIDO · MISMO MONTO'}</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · {top.m.nombre_contraparte||'Banco'}{mult?` · +${ps.length-1} más`:''}</div></div>
                  <ActBtn variant='success' disabled={pagoBusy} onClick={()=> mult?setPagosFor(b.id):conciliarPago(top.m,b)} style={{flexShrink:0}}>{mult?'Ver':'Conciliar'}</ActBtn>
                </div>) })()}
                {!porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const cc=calcesCercanos(b); if(!cc.length) return null; const top=cc[0]; const saldo=saldoBill(b); const pct=saldo>0?(top.dif/saldo*100):0; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.tealBg,border:`1px solid ${C.tealText}`,borderRadius:10,padding:'7px 10px'}}>
                  <SIcon n='check' s={15} c={C.tealText}/>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.tealText,letterSpacing:.3}}>DIFERENCIA DE UF · MISMO RUT</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · pagó lo programado · dif {fmt(top.dif)} (~{pct.toFixed(1)}%) por UF</div></div>
                  <button disabled={pagoBusy} onClick={()=>setPagosFor(b.id)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',flexShrink:0}}>Revisar</button>
                </div>) })()}
                {!porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const pr=pagosRutSugeridos(b).filter(x=>!esCalceCercano(x.m,b)); if(!pr.length) return null; const top=pr[0]; const mult=pr.length>1; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.tealBg,border:`1px solid ${C.tealText}44`,borderRadius:10,padding:'7px 10px'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.tealText,letterSpacing:.3}}>PAGO DEL MISMO RUT SIN CONCILIAR</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · {top.m.nombre_contraparte||'Banco'} — {mult?`${pr.length} abonos · revisar`:'no calza el total · revisar'}</div></div>
                  <button disabled={pagoBusy} onClick={()=>setPagosFor(b.id)} style={{fontSize:11,fontWeight:700,color:C.tealText,background:'#fff',border:`1px solid ${C.tealText}66`,borderRadius:8,padding:'6px 13px',cursor:'pointer',flexShrink:0}}>Revisar</button>
                </div>) })()}
                {pagosFor===b.id&&(()=>{ const ps0=pagosDe(b); const ps=ps0.length?ps0:pagosRutSugeridos(b); const loose=ps0.length===0&&ps.length>0; return (<div style={{width:'100%',marginTop:6,background:C.tealBg,borderRadius:10,padding:'8px 10px'}}>
                  {ps.length===0
                    ? <div style={{fontSize:10,color:C.tealText}}>Sin pagos del banco que calcen con {fmt(saldoBill(b))}. {onConciliar&&<span onClick={()=>onConciliar(clients.find(c=>String(c.id)===String(efClientIdG(b))))} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>Ver en Conciliación →</span>}</div>
                    : <><div style={{fontSize:9,color:C.tealText,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,marginBottom:5}}>{loose?'Pagos del mismo RUT/RS · revisa el monto':`Pagos del banco que calzan · ${fmt(saldoBill(b))}`}</div>
                      {ps.map(({m,rut})=>{ const cc=esCalceCercano(m,b); return (<div key={m.id} style={{display:'flex',alignItems:'center',gap:8,background:'#fff',border:`1px solid ${cc?C.tealText:(rut?C.normal:C.border)}`,borderRadius:8,padding:'7px 9px',marginBottom:5}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:cc?C.tealText:(loose?C.soonText:(rut?C.greenText:C.soonText))}}>{cc?`DIFERENCIA DE UF · dif ${fmt(cc)}`:(loose?(rut?'MISMO RUT · monto distinto':'MISMO CLIENTE · monto distinto'):(rut?'CALCE EXACTO · mismo RUT':'MISMO MONTO'))}</div><div style={{fontSize:11,color:C.text,marginTop:2}}>{fmtDate(m.fecha)} · <b>{fmt(m.monto)}</b>{cc?<span style={{color:C.tealText}}> · programado {fmt(b.amount||0)} → emitido {fmt(montoFactura(b))}</span>:null}</div><div style={{fontSize:9,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.nombre_contraparte||'—'}{m.rut_contraparte?` · ${m.rut_contraparte}`:''}{m.n_operacion?` · Op ${m.n_operacion}`:''}</div></div>
                        {cc?<button disabled={pagoBusy} onClick={()=>conciliarCalceCercano(m,b)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'7px 11px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Conciliar (queda saldada)</button>:<ActBtn variant='success' disabled={pagoBusy} onClick={()=>conciliarPago(m,b)} style={{flexShrink:0}}>Conciliar pago</ActBtn>}
                      </div>)})}</>}
                </div>)})()}
              </div>}
            </div>
          )}
          const porCobrarTot=rows.filter(b=>['Pendiente','Vencido'].includes(estadoReal(b))).reduce((a,b)=>a+saldoBill(b),0)
          const vencidoTot=rows.filter(b=>estadoReal(b)==='Vencido').reduce((a,b)=>a+saldoBill(b),0)
          return (<div>
            {(()=>{
              // Vista por cliente: clientes COLAPSADOS (solo nombre + total). Al abrir → filtro por razón social + acordeones por estado (Por cobrar [vencidas primero] / Por facturar / Cobradas / Anuladas), cada factura con su RS. Aging contable: vencida más antigua primero.
              const montoDe=b=>{ if(b.status==='Programada'){ const ui=ufInfoDe(b); if(ui) return ui.clpHoy; return b.amount||0 } return montoFactura(b) }
              const esCobrar=b=>b.invoice_no&&['Pendiente','Vencido'].includes(estadoReal(b))
              const esFacturar=b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)
              const oldKey=b=>venceDe(b)||b.due||b.issued_at||'2999-12-31'
              const ESTADOS=[
                ['Por cobrar', esCobrar, ESTADO_COBRO.porCobrar.color, saldoBill, (a,b)=>oldKey(a).localeCompare(oldKey(b)), true],
                ['Por facturar', esFacturar, ESTADO_COBRO.porFacturar.color, montoDe, (a,b)=>(a.due||a.issued_at||'').localeCompare(b.due||b.issued_at||''), false],
                ['Pagadas', b=>['Pagado','Anticipada'].includes(b.status), ESTADO_COBRO.cobrado.color, b=>b.amount||0, (a,b)=>(b.paid_at||b.issued_at||'').localeCompare(a.paid_at||a.issued_at||''), false],
                ['Anuladas', b=>b.status==='Anulada', ESTADO_COBRO.anulada.color, b=>b.amount||0, ()=>0, false],
              ]
              // UNA cifra por columna (antes el monto de la fila era por cobrar, o por facturar, o cobrado, según el cliente, sin rótulo).
              const visN=({arr})=>arr.filter(matchEst).length
              const metC=x=>({...metCid(x.c.id), n:(visN(x)>0||sinFiltroEst)?1:0})
              const listO = ordPC.k==='nombre' ? (ordPC.dir===1?list:[...list].reverse()) : [...list].sort((x,y)=>((metC(x)[ordPC.k]-metC(y)[ordPC.k])*ordPC.dir)||(x.c.name||'').localeCompare(y.c.name||'','es'))
              const totPC = list.reduce((t,x)=>{ if(!visN(x)&&!sinFiltroEst) return t; const m=metCid(x.c.id); t.pc+=m.pc; t.pf+=m.pf; t.co+=m.co; t.ve+=m.ve; t.n++; return t },{pc:0,pf:0,co:0,ve:0,n:0})
              const W=136
              const cards=listO.map(({c,arr})=>{
                const visible=arr.filter(matchEst)
                if(!visible.length&&!sinFiltroEst) return null
                const cOpen=openClients.has(c.id)
                const porCobrar=visible.filter(esCobrar).reduce((a,b)=>a+saldoBill(b),0)
                const porFacturar=visible.filter(esFacturar).reduce((a,b)=>a+montoDe(b),0)
                const cobrado=visible.filter(b=>['Pagado','Anticipada'].includes(b.status)).reduce((a,b)=>a+cobradoBill(b),0)   // filtro "Pagadas": muestra lo cobrado, no saldo $0
                const _mc=metCid(c.id), vencC=_mc.ve
                const rsMap={}; visible.forEach(b=>{ const e=efEntity(b); const id=e?String(e.id):'sin'; if(!rsMap[id]) rsMap[id]={id,name:e?rsDisplay(e.name):(b.receptor_name?rsDisplay(b.receptor_name):'Sin razón social')} })
                const rsArr=Object.values(rsMap)
                const rsActiva=rsSel[c.id]||'all'
                const facturas=rsActiva==='all'?visible:visible.filter(b=>{ const e=efEntity(b); return (e?String(e.id):'sin')===rsActiva })
                const rsHead=rsLabel(c.id,clients,clientEntities)
                return (<div key={c.id} style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:7}}>
                  <div onClick={()=>toggleClient(c.id)} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                    <span style={{color:C.textSoft,fontSize:12,width:9,flexShrink:0}}>{cOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
                    <span style={{width:30,height:30,borderRadius:10,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='user' s={16} c={C.accent}/></span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><span onClick={onOpenClientFicha&&c.id&&c.id!=='__none__'?(e=>{e.stopPropagation();onOpenClientFicha(c.id)}):undefined} title={onOpenClientFicha&&c.id&&c.id!=='__none__'?'Ver ficha del cliente':undefined} style={{cursor:onOpenClientFicha&&c.id&&c.id!=='__none__'?'pointer':'inherit'}}>{c.name}</span></div>
                      {(rsHead.multi||(rsHead.name&&_normTxt(rsHead.name)!==_normTxt(c.name)))&&<div style={{fontSize:10,color:rsHead.multi?C.soonText:C.muted,fontWeight:rsHead.multi?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1}}>{rsHead.multi?`${rsHead.multi} razones sociales`:`${rsDisplay(rsHead.name)}${rsHead.rut?` · ${fmtRutCL(rsHead.rut)}`:''}`}</div>}
                      {!isDesktop&&(_mc.pf>0||_mc.co>0)&&<div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginTop:1}}>{[_mc.pf>0?`por facturar ${fmtMill(_mc.pf)}`:'',_mc.co>0?`cobrado ${fmtMill(_mc.co)}`:''].filter(Boolean).join(' · ')}</div>}
                    </div>
                    {isDesktop ? (<>
                      <div style={{width:W,textAlign:'right',flexShrink:0,fontSize:13,fontWeight:700,color:_mc.pc>0?C.text:C.done,fontVariantNumeric:'tabular-nums'}}>{_mc.pc>0?fmtMill(_mc.pc):'—'}</div>
                      <div style={{width:W,textAlign:'right',flexShrink:0,fontSize:13,fontWeight:vencC>0?700:400,color:vencC>0?C.overdueText:C.done,fontVariantNumeric:'tabular-nums'}}>{vencC>0?fmtMill(vencC):'—'}</div>
                      <div style={{width:W,textAlign:'right',flexShrink:0,fontSize:13,fontWeight:_mc.pf>0?600:400,color:_mc.pf>0?C.muted:C.done,fontVariantNumeric:'tabular-nums'}}>{_mc.pf>0?fmtMill(_mc.pf):'—'}</div>
                      <div style={{width:W,textAlign:'right',flexShrink:0,fontSize:13,fontWeight:_mc.co>0?700:400,color:_mc.co>0?C.greenText:C.done,fontVariantNumeric:'tabular-nums'}}>{_mc.co>0?fmtMill(_mc.co):'—'}</div>
                    </>) : (
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:_mc.pc>0?C.text:C.done,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{_mc.pc>0?fmtMill(_mc.pc):'—'}</div>
                        <div style={{fontSize:9.5,fontWeight:700,color:_mc.pc>0?(vencC>0?C.overdueText:C.accent):C.muted}}>{_mc.pc>0?(vencC>0?'vencido':'por cobrar'):'al día'}</div>
                      </div>)}
                  </div>
                  {cOpen&&<div style={{marginTop:8}}>
                    {rsArr.length>=2&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:8}}>
                      {[{id:'all',name:'Todas las RS'},...rsArr].map(r=>{ const on=rsActiva===r.id; return <span key={r.id} onClick={()=>setRsSel(p=>({...p,[c.id]:r.id}))} style={{fontSize:9,fontWeight:600,borderRadius:20,padding:'3px 9px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,whiteSpace:'nowrap'}}>{r.name}</span> })}
                    </div>}
                    {ESTADOS.map(([lbl,pred,col,money,srt,defOpen])=>{
                      const gr=facturas.filter(pred).sort(srt); if(!gr.length) return null
                      const key=`${c.id}|${lbl}`; const isOpen=groupOpen[key]!==undefined?groupOpen[key]:defOpen
                      const sub=gr.reduce((a,b)=>a+money(b),0); const _ec=Object.values(ESTADO_COBRO).find(x=>x.color===col)||{bg:C.bgWarm,text:C.grisText}
                      return (<div key={key} style={{marginBottom:6}}>
                        <div onClick={()=>setGroupOpen(p=>({...p,[key]:!isOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',marginBottom:4}}>
                          <span style={{display:'flex',alignItems:'center',gap:6,minWidth:0}}><SIcon n={_ec.icon||'file'} s={15} c={_ec.text}/><span style={{fontSize:10,fontWeight:700,background:_ec.bg,color:_ec.text,borderRadius:14,padding:'2px 9px',textTransform:'uppercase',letterSpacing:.4}}>{lbl} · {gr.length} {isOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span></span>
                          <span style={{fontSize:11,fontWeight:700,color:_ec.text}}>{fmtMill(sub)}</span>
                        </div>
                        {isOpen&&gr.map(b=>fila(b,yaFacturadasIds.has(b.id),c))}
                      </div>)
                    })}
                  </div>}
                </div>)
              }).filter(Boolean)
               if(!cards.length) return <div style={{color:C.muted,textAlign:'center',padding:30}}>Sin facturas con estos filtros.</div>
               if(!isDesktop) return cards
               const hcP=(k,l)=>{ const on=ordPC.k===k; return <span onClick={()=>setOrdPC(o=>o.k===k?{k,dir:-o.dir}:{k,dir:k==='nombre'?1:-1})} style={{width:k==='nombre'?undefined:W,flex:k==='nombre'?1:undefined,textAlign:k==='nombre'?'left':'right',flexShrink:0,whiteSpace:'nowrap',cursor:'pointer',userSelect:'none',color:on?C.accent:C.muted}}>{l}{on?(ordPC.dir===1?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>):''}</span> }
               return (<>
                 <div style={{display:'flex',gap:10,padding:'0 13px 6px 62px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:.4}}>{hcP('nombre','Cliente')}{hcP('pc','Por cobrar')}{hcP('ve','Vencido')}{hcP('pf',`Por facturar${fYear?' '+fYear:''}`)}{hcP('co',`Cobrado${fYear?' '+fYear:''}`)}</div>
                 {cards}
                 <div style={{display:'flex',gap:10,alignItems:'baseline',padding:'10px 13px 4px 62px',fontSize:12.5,fontWeight:700,borderTop:`1px solid ${C.border}`,marginTop:4}}>
                   <span style={{flex:1}}>{totPC.n} cliente{totPC.n!==1?'s':''}</span>
                   <span style={{width:W,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtMill(totPC.pc)}</span>
                   <span style={{width:W,textAlign:'right',fontVariantNumeric:'tabular-nums',color:totPC.ve>0?C.overdueText:C.done}}>{totPC.ve>0?fmtMill(totPC.ve):'—'}</span>
                   <span style={{width:W,textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.muted}}>{fmtMill(totPC.pf)}</span>
                   <span style={{width:W,textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.greenText}}>{fmtMill(totPC.co)}</span>
                 </div>
               </>)
            })()}</div>)
        })()
        : filter==='anticipos' ? null
        : filter==='checklist' ? (
          <ChecklistFacturacion sinRegN={sinRegN} billing={billing} fantasmaIds={fantasmaIds} clients={clients} clientEntities={clientEntities} sales={sales} anticipos={anticipos} onFacturarAdelantos={onFacturarAdelantos} onEmitir={onEmitir} onStatusChange={onStatusChange} respaldoMap={respaldoMap} cartolaHasta={cartolaHasta} onOpenClientFicha={onOpenClientFicha} onConciliar={onConciliar} onEdit={onEdit} onEnviar={b=>setFacturaEmail(b)} onEnviarVarias={arr=>setFacturasEmail(arr)} onUnsend={onUnsendFactura} onAssignSeries={onAssignSeries} onCotejar={()=>setSiiOpen(true)} onCargarXML={()=>{contarSinRegistrar();setXmlHub(true)}} onReplaceProgramada={onReplaceProgramada}/>
        ) : filter==='sinanio' ? (() => {
          const cs = (primary)=>({height:26,padding:'0 11px',borderRadius:20,border:`0.5px solid ${primary?C.muted:C.border}`,background:'#fff',color:primary?C.accent:C.muted,fontSize:11,fontWeight:primary?600:500,cursor:'pointer',whiteSpace:'nowrap'})
          return (<>
            <div style={{fontSize:12,color:C.muted,marginBottom:10,lineHeight:1.5}}>Facturas pagadas sin enlazar a su venta — asigna la venta o el año (se aprende por cliente).</div>
            {sinAnio.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Todas las facturas pagadas tienen su año de venta.</div>}
            {sinAnio.map(b=>{
              const c=clients.find(x=>x.id===b.client_id)
              // si la factura documenta abonos anteriores, el año sugerido es el del primer abono (la venta es de cuando pagó)
              const pp=(anticipos||[]).filter(a=>String(a.billing_id)===String(b.id)&&a.fecha).map(a=>String(a.fecha)).sort()[0]
              const sug=(pp&&b.issued_at&&pp.slice(0,4)<String(b.issued_at).slice(0,4))?+pp.slice(0,4):(b.client_id?anioLearned[String(b.client_id)]:null)
              const clientSales=b.client_id?sales.filter(s=>String(s.client_id)===String(b.client_id)):[]
              return (
                <div key={b.id} style={{padding:'10px 0',borderBottom:`0.5px solid ${C.border}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:9}}>
                    <SIcon n='clock' s={15} c={C.done}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{...NOMBRE_CLI}}>{c?.name||b.receptor_name||'Sin cliente'}</div>
                      <div style={{fontSize:11,color:C.textSoft,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.invoice_no?`Factura N° ${folioN(b.invoice_no)} · `:''}pagada {fmtDMY(b.paid_at)}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(b.amount)}</span>
                  </div>
                  <div style={{marginTop:7,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                    {sug!=null&&<button onClick={()=>onSetVentaAnio&&onSetVentaAnio(b,{sale_year:sug})} style={cs(true)}>{sug} <Sparkle/></button>}
                    {clientSales.length>0&&<button onClick={()=>setAnioPickFor(anioPickFor===b.id?null:b.id)} style={cs()}>Asociar venta</button>}
                    <span style={{fontSize:11,color:C.textSoft}}>año:</span>
                    {yearBtns.map(y=><button key={y} onClick={()=>onSetVentaAnio&&onSetVentaAnio(b,{sale_year:y})} style={cs()}>{y}</button>)}
                    <select value='' onChange={e=>{ const n=parseInt(e.target.value); if(n) onSetVentaAnio&&onSetVentaAnio(b,{sale_year:n}) }} style={{...cs(),appearance:'auto'}} title='Otro año'><option value=''>Otro año</option>{Array.from({length:new Date().getFullYear()-2014},(_,i)=>new Date().getFullYear()+1-i).filter(y=>!yearBtns.includes(y)).map(y=><option key={y} value={y}>{y}</option>)}</select>
                  </div>
                  {anioPickFor===b.id&&clientSales.length>0&&(()=>{
                    const abiertas=clientSales.filter(s=>s.status==='Activo')
                    const base=(verCerradas||!abiertas.length)?clientSales:abiertas   // por defecto solo abiertas (Activo); si no hay, todas
                    const q=ventaBusca.trim().toLowerCase()
                    const list=[...base].filter(s=>!q||`${s.title||''} ${s.year||''}`.toLowerCase().includes(q)).sort((a,b)=>(b.year||0)-(a.year||0))
                    const nCerr=clientSales.filter(s=>s.status!=='Activo').length
                    return (
                    <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:5}}>
                      {clientSales.length>4&&<input value={ventaBusca} onChange={e=>setVentaBusca(e.target.value)} placeholder='Buscar proyecto…' style={{padding:'6px 9px',borderRadius:8,border:`0.5px solid ${C.border}`,fontSize:12,outline:'none'}}/>}
                      {list.map(s=>(
                        <button key={s.id} onClick={()=>{onSetVentaAnio&&onSetVentaAnio(b,{sale_id:s.id});setAnioPickFor(null);setVentaBusca('');setVerCerradas(false)}} style={{textAlign:'left',padding:'7px 10px',borderRadius:8,border:`0.5px solid ${C.border}`,background:C.bgSoft,fontSize:12,color:C.text,cursor:'pointer',display:'flex',justifyContent:'space-between',gap:8}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title||'Venta'}</span><span style={{color:C.textSoft,flexShrink:0}}>{s.year}{s.status!=='Activo'?' · cerrada':''}</span></button>
                      ))}
                      {!verCerradas&&abiertas.length>0&&nCerr>0&&<button onClick={()=>setVerCerradas(true)} style={{fontSize:11,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',textAlign:'left',padding:'2px 0'}}>Ver también cerradas ({nCerr}) →</button>}
                    </div>
                    )
                  })()}
                </div>
              )
            })}
          </>)
        })() : filter==='sinemitir' ? (()=>{
          // Radar "Cuotas vencidas sin facturar": programadas de meses cerrados, venta Activa, dentro de la app, no silenciadas. Candidatas por revisar (no fuga confirmada). Compuerta: Emitir (abre la factura → emite) · No corresponde (aprende y silencia).
          const now=new Date(); const m1=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
          const saleById={}; (sales||[]).forEach(s=>{ saleById[String(s.id)]=s })
          const MN3=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
          const mesLbl=d=>{ const m=String(d||'').slice(0,7).match(/^(\d{4})-(\d\d)$/); return m?`${MN3[+m[2]-1]} ${m[1].slice(2)}`:'' }
          const cands=cuotasSinEmitir({billing,sales,uf:ufFechaCache()||{},noEmitir:noEmitirSet,hasta:m1})
          const recib=recibidoACuenta(cands,anticipos,sales)
          const byCli={}; cands.forEach(b=>{ const k=String(b.client_id||'—'); (byCli[k]=byCli[k]||[]).push(b) })
          const keys=Object.keys(byCli).sort((a,b)=>{ const na=(clients||[]).find(c=>String(c.id)===a)?.name||''; const nb=(clients||[]).find(c=>String(c.id)===b)?.name||''; return na.localeCompare(nb,'es') })
          keys.forEach(k=>byCli[k].sort((x,y)=>String(x.due).localeCompare(String(y.due))))
          // "Buscar en SII": sincroniza el mes de la cuota (reusa onBuscarSII/handleBuscarSII, que auto-enlaza los calces únicos). Si la factura ya existía, queda enlazada y sale del radar; si aparece como emitida sin cargar, el usuario la carga.
          const buscarSII=async(b)=>{ if(!onBuscarSII||siiBuscaFor) return; const mes=String(b.due).slice(0,7); setSiiBuscaFor({id:b.id}); try{ const r=await onBuscarSII([mes],(h,t)=>setSiiBuscaFor({id:b.id,hechos:h,total:t})); onRefresh&&onRefresh(); const ap=r?.aplicadas||0, hu=r?.huerfanas||0; appAlert(ap>0?`SII sincronizado (${mes}): ${ap} factura${ap!==1?'s':''} quedó enlazada y salió del radar.`:(hu>0?`SII sincronizado (${mes}): hay ${hu} emitida${hu!==1?'s':''} en el SII sin cargar. Ábrela en "SII sin cargar" para registrarla.`:`SII sincronizado (${mes}): no apareció un DTE que calce — probablemente falta emitirla.`)) }catch(e){ appAlert('No se pudo buscar en el SII: '+(e?.message||e)) } setSiiBuscaFor(null) }
          return (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{fontSize:11.5,color:C.muted,lineHeight:1.5,margin:'0 2px'}}>Cuotas de meses ya cerrados que la app tiene como <b style={{color:C.text}}>Programadas</b> (no emitidas). <b style={{color:C.text}}>Por revisar</b> — no todas son un error: algunas pueden ser intencionales o ya emitidas en un período sin sincronizar. Usa <b style={{color:C.text}}>“Buscar en SII”</b> para confirmar si ya existe.</div>
            {cands.length===0&&<div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Nada por revisar — las cuotas de meses cerrados están emitidas o resueltas.</div>}
            {keys.map(k=>{ const gi=byCli[k]; const cli=(clients||[]).find(c=>String(c.id)===k); const tot=gi.reduce((a,b)=>a+(b.amount||0),0); const open=openClients.has(k); const nMeses=new Set(gi.map(b=>String(b.due).slice(0,7))).size; return (
              <div key={k}>
                <div onClick={()=>toggleClient(k)} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'8px 2px 7px'}}>
                  <span style={{fontSize:10,color:C.textSoft,transform:open?'rotate(90deg)':'none',transition:'transform .12s',flexShrink:0}}><Gl n='chevron'/></span>
                  <span style={{...NOMBRE_CLI,minWidth:0}}>{cli?.name||gi[0].receptor_name||'Sin cliente'}</span>
                  <span style={{fontSize:11,color:C.textSoft,flexShrink:0}}>· {gi.length}</span>
                  {nMeses>1&&<span style={{fontSize:9,fontWeight:700,background:C.overdueBg,color:C.overdueText,borderRadius:20,padding:'2px 8px',textTransform:'uppercase',letterSpacing:.2,flexShrink:0}}>{nMeses} meses</span>}
                  <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(tot)}</span>
                </div>
                {open&&<div style={{border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:'#fff'}}>
                  {gi.map((b,i)=>{ const s=saleById[String(b.sale_id)]; return (
                    <div key={b.id} style={{borderTop:i>0?`0.5px solid ${C.border}`:'none',padding:'10px 12px'}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12.5,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s?.title||b.concept||'Cuota'}</div>
                          <div style={{fontSize:10.5,color:C.overdueText,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Vencía {mesLbl(b.due)} · sin emitir{recib.get(String(b.id))?<span style={{color:C.muted}}> · {fmt(recib.get(String(b.id)))} ya recibido</span>:null}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(b.amount||0)}</div>
                      </div>
                      <div style={{display:'flex',gap:7,marginTop:8,flexWrap:'wrap'}}>
                        <button onClick={()=>onEdit&&onEdit(b)} style={{fontSize:11,fontWeight:700,border:'none',borderRadius:7,padding:'5px 12px',background:C.accent,color:'#fff',cursor:'pointer'}}>Emitir →</button>
                        {onBuscarSII&&<button disabled={!!siiBuscaFor} onClick={()=>buscarSII(b)} style={{fontSize:11,fontWeight:600,borderRadius:7,padding:'5px 11px',border:`1px solid ${C.azulInfo}`,background:'#fff',color:C.azulInfo,cursor:siiBuscaFor?'default':'pointer',opacity:siiBuscaFor&&siiBuscaFor.id!==b.id?.5:1}}>{siiBuscaFor&&siiBuscaFor.id===b.id?(siiBuscaFor.total?`Buscando ${siiBuscaFor.hechos||0}/${siiBuscaFor.total}…`:'Buscando…'):'Buscar en SII'}</button>}
                        <button onClick={()=>marcarNoEmitir(b)} style={{fontSize:11,fontWeight:600,borderRadius:7,padding:'5px 11px',border:`1px solid ${C.border}`,background:'#fff',color:C.muted,cursor:'pointer'}}>No corresponde</button>
                      </div>
                    </div>) })}
                </div>}
              </div>) })}
          </div>)
        })() : filter==='sinfacturar' ? (()=>{
          // Trabajos sin facturar (trabajosSinFacturar): ventas que ya facturan, sin factura hace más de 60 días y con parte del plan
          // sin cuota que lo explique. Compuerta: Emitir la cuota antigua · Ver ficha · Se factura al finalizar / No corresponde (aprende).
          const fDMY=d=>fmtFechaDMY(String(d||'').slice(0,10))
          const byCli={}; trabajosSF.forEach(x=>{ const k=String(x.s.client_id||'—'); (byCli[k]=byCli[k]||[]).push(x) })
          const keys=Object.keys(byCli).sort((a,b)=>{ const na=(clients||[]).find(c=>String(c.id)===a)?.name||''; const nb=(clients||[]).find(c=>String(c.id)===b)?.name||''; return na.localeCompare(nb,'es') })
          const btn={fontSize:11,fontWeight:600,borderRadius:7,padding:'5px 11px',border:`1px solid ${C.border}`,background:'#fff',color:C.muted,cursor:'pointer'}
          return (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {trabajosSF.length===0&&<div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Sin trabajos por facturar.</div>}
            {keys.map(k=>{ const gi=byCli[k]; const cli=(clients||[]).find(c=>String(c.id)===k); const tot=gi.reduce((a,x)=>a+x.monto,0); const open=openClients.has(k); return (
              <div key={k}>
                <div onClick={()=>toggleClient(k)} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'8px 2px 7px'}}>
                  <span style={{fontSize:10,color:C.textSoft,transform:open?'rotate(90deg)':'none',transition:'transform .12s',flexShrink:0}}><Gl n='chevron'/></span>
                  <span style={{...NOMBRE_CLI,minWidth:0}}>{cli?.name||'Sin cliente'}</span>
                  <span style={{fontSize:11,color:C.textSoft,flexShrink:0}}>· {gi.length}</span>
                  <span style={{marginLeft:'auto',fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(tot)}</span>
                </div>
                {open&&<div style={{border:`0.5px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:'#fff'}}>
                  {gi.map((x,i)=>{ const v0=x.viejas[0]; const det=x.viejas.length?`${x.viejas.length===1?'Cuota programada':`${x.viejas.length} cuotas programadas`} al ${fDMY(v0.due)}, sin emitir`:`Saldo ${x.enUF?`${x.sinCuota.toFixed(2).replace('.',',')} UF`:fmt(x.sinCuota)} sin cuota`; return (
                    <div key={x.s.id} style={{borderTop:i>0?`0.5px solid ${C.border}`:'none',padding:'10px 12px'}}>
                      <div style={{display:'flex',alignItems:'baseline',gap:10}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12.5,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.s.title||'Trabajo'}</div>
                          <div style={{fontSize:10.5,color:C.soonText,marginTop:1}}>Última factura {fDMY(x.ult)} · {x.dias} días</div>
                          <div style={{fontSize:10.5,color:C.textSoft,marginTop:1}}>{det}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(x.monto)}</div>
                      </div>
                      <div style={{display:'flex',gap:7,marginTop:8,flexWrap:'wrap'}}>
                        {v0&&<button onClick={()=>onEdit&&onEdit(v0)} style={{fontSize:11,fontWeight:700,border:'none',borderRadius:7,padding:'5px 12px',background:C.accent,color:'#fff',cursor:'pointer'}}>Emitir →</button>}
                        {onOpenClientFicha&&<button onClick={()=>onOpenClientFicha(x.s.client_id)} style={{...btn,borderColor:C.azulInfo,color:C.azulInfo}}>Ver ficha</button>}
                        <button onClick={()=>decidirTrabajo(x.s,'al_finalizar','Se factura al finalizar')} style={btn}>Se factura al finalizar</button>
                        <button onClick={()=>decidirTrabajo(x.s,'no_corresponde','No corresponde')} style={btn}>No corresponde</button>
                      </div>
                    </div>) })}
                </div>}
              </div>) })}
          </div>)
        })() : filter==='porcompletar' ? (()=>{
          // Vista "Facturas por completar": facturas emitidas con algo pendiente, en 3 categorías (sin cliente · falta venta · datos por completar).
          // Una tarjeta por factura; orden y buscador arriba; toda asignación se confirma antes de aplicar (no desaparece sin OK). Reusa cargarSinRegistrar y aprende.
          const _emitBase=b=>!b.deleted_at&&(b.invoice_no||b.folio)&&b.status!=='Anulada'&&b.billing_type!=='reembolso'
          const APP_XML='2026-06-09'
          const _q=(q||'').trim().toLowerCase()
          const _yr=fYear?String(fYear):''
          const nomDe=b=>(clients||[]).find(c=>String(c.id)===String(b.client_id))?.name||b.receptor_name||''
          const fmtRut=r=>{ if(!r) return ''; const [n,dv]=String(r).replace(/\./g,'').split('-'); return n? n.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(dv!==undefined?'-'+dv:'') : String(r) }
          const fDMY=d=>{ const m=String(d||'').slice(0,10).match(/^(\d{4})-(\d\d)-(\d\d)$/); return m?`${m[3]}-${m[2]}-${m[1]}`:'' }
          const faltaXml=b=>!b.dte_xml&&String(b.issued_at||'').slice(0,10)>=APP_XML
          const faltaRS=b=>!b.entity_id
          const matchTxt=(nm,folio,rut)=>!_q||`${folio||''} ${nm||''} ${rut||''}`.toLowerCase().includes(_q)
          const matchYrD=d=>!_yr||String(d||'').slice(0,4)===_yr
          // categoría primaria de una factura (una sola, para no duplicar entre secciones)
          const catDe=b=>catSinClienteVenta(b,tercerosByBilling)
          // entradas unificadas: billing + docs del SII sin cliente (siiSinCli)
          const entries=[]
          ;(billing||[]).forEach(b=>{ const cat=catDe(b); if(!cat) return; const nm=nomDe(b); const rut=b.receptor_rut||''; if(!matchTxt(nm,folioN(b.invoice_no||b.folio),rut)||!matchYrD(b.issued_at||b.due)) return
            const chips=[]; if(cat==='vta'){ if(b.status==='Pagado')chips.push('pagada'); else if(b.status==='Vencido')chips.push('vencida') } if(cat==='dat'){ if(faltaXml(b))chips.push('falta XML'); if(faltaRS(b))chips.push('falta razón social') }
            entries.push({id:'b'+b.id, src:'bill', b, cat, nm, rut, folio:folioN(b.invoice_no||b.folio), fecha:b.issued_at||b.date||b.due||'', glosa:b.concept||'', monto:montoFactura(b), chips}) })
          ;(siiSinCli||[]).forEach(d=>{ const nm=d.receptor_name||''; const rut=d.receptor_rut||''; if(!matchTxt(nm,folioN(d.folio),rut)||!matchYrD(d.fecha)) return
            entries.push({id:'s'+(d._stageId||d.folio), src:'sii', d, cat:'cli', nm:titleCase(nm), rut, folio:folioN(d.folio), fecha:d.fecha||'', glosa:d.glosa||'', monto:d.monto||0, chips:[]}) })
          const _num=f=>parseInt(String(f||'').replace(/\D/g,''),10)||0
          const sortE=arr=>{ const a=[...arr]; if(pcOrden==='cliente')a.sort((x,y)=>(x.nm||'~').localeCompare(y.nm||'~','es')); else if(pcOrden==='foliodesc')a.sort((x,y)=>_num(y.folio)-_num(x.folio)); else if(pcOrden==='folioasc')a.sort((x,y)=>_num(x.folio)-_num(y.folio)); else a.sort((x,y)=>String(y.fecha||'').localeCompare(String(x.fecha||''))); return a }
          const cliE=sortE(entries.filter(e=>e.cat==='cli'))
          const vtaE=sortE(entries.filter(e=>e.cat==='vta'))
          const datE=sortE(entries.filter(e=>e.cat==='dat'))
          const totMonto=entries.reduce((a,e)=>a+(e.monto||0),0)
          const fmtMon=n=>{ const a=Math.abs(n||0); return a>=1e6?'$'+(n/1e6).toFixed(1).replace('.',',')+'M':fmt(Math.round(n||0)) }
          const TINT={cli:{bg:C.overdueBg,dot:C.overdueText},vta:{bg:C.azulBg,dot:C.azulInfo},dat:{bg:C.soonBg,dot:C.soonText}}
          const sugCliente=(nm,rut)=>resolverClienteSII(rut,nm,clients,clientEntities)||null
          // Adjunta el XML firmado que YA está en la cola del SII (sii_cargas_docs.doc_json.doc) a la factura. El sync del RCV solo trae metadata, NO el XML.
          const adjuntarXmlCola=async(facs)=>{
            try{
              const folios=[...new Set(facs.map(b=>folioN(b.invoice_no||b.folio)).filter(Boolean))]
              const {data,error}=await supabase.from('sii_cargas_docs').select('folio,doc_json').in('folio',folios)
              if(error) throw error
              const xmlByFolio={}; (data||[]).forEach(d=>{ const f=String(d.folio||'').replace(/\D/g,''); const doc=d.doc_json?.doc; if(f&&doc&&!xmlByFolio[f]) xmlByFolio[f]=doc })
              let ok=0; const faltan=[]
              for(const b of facs){ const f=String(b.invoice_no||b.folio||'').replace(/\D/g,''); const xml=xmlByFolio[f]
                if(xml){ const {error:e2}=await supabase.from('billing').update({dte_xml:xml,updated_at:new Date().toISOString()}).eq('id',b.id); if(!e2){ setBilling&&setBilling(p=>p.map(x=>x.id===b.id?{...x,dte_xml:xml}:x)); ok++ } }
                else faltan.push(folioN(b.invoice_no||b.folio)) }
              onRefresh&&onRefresh()
              appAlert(`${ok} XML adjuntado${ok!==1?'s':''} desde la cola del SII.${faltan.length?`\n\n${faltan.length} no está${faltan.length!==1?'n':''} en la cola — hay que bajarla${faltan.length!==1?'s':''} del SII: N° ${faltan.join(', ')}.`:''}`)
            }catch(e){ appAlert('No se pudo adjuntar el XML: '+(e.message||e)) }
          }
          // Panel "De un externo" (reclasifica una factura YA registrada): elige el externo + % que retienes; el resto es cuenta por pagar.
          const extPanel=(b)=>{ const provs=[...(proveedores||[])].sort((a,z)=>((a.razon_social||a.nombre||'')).localeCompare(z.razon_social||z.nombre||'','es')); const provEl=provs.find(p=>String(p.id)===String(tvProv)); const nombreDest=provEl?(provEl.razon_social||provEl.nombre):(tvNuevo.trim()||'el externo'); const total=montoFactura(b); const pct=Math.max(0,Math.min(100,parseFloat(String(tvPct).replace(',','.'))||0)); const comision=pct>0?Math.round(total*pct/100):0; const payable=total-comision; const aprendido=tvProv&&comisionTercMap[String(tvProv)]!=null; const doExt=async()=>{ let pid=tvProv; if(!pid&&tvNuevo.trim()&&onSaveProveedor){ const np=await onSaveProveedor({nombre:tvNuevo.trim()}); if(np) pid=np.id } if(!pid){ appAlert('Elige el externo o escribe su nombre.'); return } const res=onReclasificarTercero&&await onReclasificarTercero(b,{proveedorId:pid,comisionPct:pct}); if(res){ if(pct>0)setComisionTercMap(m=>({...m,[String(pid)]:pct})); setAnioPickFor(null); onRefresh&&onRefresh() } }; return (
            <div style={{marginTop:10,background:C.tealBg,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
              <div style={{fontSize:10,fontWeight:700,color:C.tealText,textTransform:'uppercase',letterSpacing:.3,marginBottom:5}}>De un externo · la cobras tú, la plata es de otro</div>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:7,flexWrap:'wrap'}}>
                <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Externo</span>
                {provs.length>0&&<select value={tvProv} onChange={e=>elegirTercero(e.target.value)} style={{flex:'1 1 150px',minWidth:0,fontSize:12,color:C.text,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}><option value=''>Elegir…</option>{provs.map(p=><option key={p.id} value={p.id}>{p.razon_social||p.nombre}</option>)}</select>}
              </div>
              {!tvProv&&<div style={{display:'flex',alignItems:'center',gap:6,marginBottom:7}}><span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>{provs.length>0?'o nuevo':'Nombre'}</span><input value={tvNuevo} onChange={e=>setTvNuevo(e.target.value)} placeholder='Nombre del externo (ej. Rodrigo Díaz)' style={{flex:1,fontSize:12,color:C.text,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}/></div>}
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                <span style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,width:56,flexShrink:0}}>Retienes</span>
                <input value={tvPct} onChange={e=>setTvPct(e.target.value.replace(/[^\d.,]/g,''))} inputMode='decimal' placeholder='0' style={{width:58,textAlign:'right',fontSize:12,fontWeight:700,color:C.text,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}/>
                <span style={{fontSize:13,fontWeight:700,color:C.tealText}}>%</span>
                {aprendido&&<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}><Gl n='tick'/> aprendido</span>}
              </div>
              {pct>0&&<div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.4}}>Tu comisión <b style={{color:C.greenText}}>{fmt(comision)}</b> · para {nombreDest} <b style={{color:C.tealText}}>{fmt(payable)}</b> (de {fmt(total)})</div>}
              <button disabled={!tvProv&&!tvNuevo.trim()} onClick={doExt} style={{width:'100%',background:C.tealText,color:'#fff',border:'none',borderRadius:8,padding:'9px 0',fontSize:12,fontWeight:700,cursor:'pointer',opacity:(!tvProv&&!tvNuevo.trim())?.6:1}}>{pct>0?`Registrar · retienes ${fmt(comision)}`:`Pasar todo a ${nombreDest}`}</button>
            </div>) }
          // Confirmación inline + acciones (toda asignación pasa por aquí antes de aplicarse)
          const limpiar=()=>{ setPcConfirm(null); setAnioPickFor(null); setVentaBusca(''); setVerCerradas(false) }
          const pedir=(e,label,run)=>{ setAnioPickFor(null); setPcConfirm({_eid:e.id,label,run}) }
          const doAssignCli=(e,cid)=>{ const nm=(clients||[]).find(c=>String(c.id)===String(cid))?.name||'ese cliente'; pedir(e,`Asignar a ${nm}${e.src==='sii'?' — se registra':''}.`,async()=>{ if(e.src==='sii'){ await crearDesdeXML({...e.d,clienteId:cid},0); setRespaldoRes&&setRespaldoRes(p=>Array.isArray(p)&&!p.length?null:p); contarSinRegistrar() } else { onAssignClient&&await onAssignClient(e.b,cid) } limpiar(); onRefresh&&onRefresh() }) }
          const doSinCli=(e)=>pedir(e,'Agregar sin cliente — se registra sin asignar.',async()=>{ await crearDesdeXML({...e.d,clienteId:null},0); setRespaldoRes&&setRespaldoRes(p=>Array.isArray(p)&&!p.length?null:p); contarSinRegistrar(); limpiar() })
          // Marcar una factura "sin venta" como REEMBOLSO de gastos (no es ingreso): reusa billing_type='reembolso', la única palanca que la saca de por-cobrar/cobrado. Sale de "Falta venta" (_emitBase excluye reembolso).
          const doReembolso=(e)=>pedir(e,'Marcar como reembolso de gastos.',async()=>{ try{ await supabase.from('billing').update({billing_type:'reembolso',updated_at:new Date().toISOString()}).eq('id',e.b.id); logActividad('facturacion.marcar_reembolso',{tabla:'billing',id:e.b.id,detalle:{invoice_no:e.b.invoice_no,amount:e.b.amount,client_id:e.b.client_id}}); setBilling&&setBilling(p=>p.map(x=>x.id===e.b.id?{...x,billing_type:'reembolso'}:x)) }catch(err){ appAlert('No se pudo marcar como reembolso: '+(err.message||err)) } limpiar(); onRefresh&&onRefresh() })
          const doRS=(e,entId)=>{ const ent=(clientEntities||[]).find(x=>String(x.id)===String(entId)); pedir(e,`Asignar razón social ${ent?.name||''}.`,async()=>{ if(ent){ await supabase.from('billing').update({entity_id:entId,receptor_name:ent.name,receptor_rut:ent.rut||e.b.receptor_rut||null,updated_at:new Date().toISOString()}).eq('id',e.b.id); setBilling&&setBilling(p=>p.map(x=>x.id===e.b.id?{...x,entity_id:entId,receptor_name:ent.name,receptor_rut:ent.rut||x.receptor_rut}:x)) } limpiar(); onRefresh&&onRefresh() }) }
          const doXml=(e)=>pedir(e,'Adjuntar el XML firmado que está en la cola del SII.',async()=>{ await adjuntarXmlCola([e.b]); limpiar() })
          const sub={fontSize:10,fontWeight:600,color:C.muted,cursor:'pointer',whiteSpace:'nowrap'}
          // Si no es de honorarios (la venta se asigna arriba con AsignarVentaFactura): Gastos · Comisión → socio y origen · Por externo → externo y %.
          // Sugerencia aprendida por cliente: el tipo de sus facturas anteriores (BDA → Comisión, Geslog → Por externo).
          const tipoPrevio=cid=>{ const ts=(billing||[]).filter(x=>!x.deleted_at&&x.status!=='Anulada'&&String(x.client_id)===String(cid)&&['comision','externo'].includes(x.billing_type)); if(!ts.length) return null; const c={}; ts.forEach(x=>{ c[x.billing_type]=(c[x.billing_type]||0)+1 }); return Object.keys(c).sort((a,z)=>c[z]-c[a])[0] }
          const tipoChips=(e,b,{ventaOpen,extOpen})=>{ const comOpen=anioPickFor===('com:'+b.id), sug=tipoPrevio(b.client_id)
            const ch=(k,lbl,on,fn,col)=><span key={k} onClick={fn} style={{fontSize:11.5,fontWeight:on?700:600,borderRadius:20,padding:'4px 11px',border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:C.surface,color:on?'#fff':C.accent,cursor:'pointer',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',gap:6}}><span style={{width:7,height:7,borderRadius:'50%',background:on?'#fff':col}}/>{lbl}</span>
            return <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center',marginTop:10}}>
              {ch('g','Es de gastos',false,()=>doReembolso(e),C.azulInfo)}
              {ch('c','Es comisión',comOpen,()=>{ if(comOpen){ setAnioPickFor(null); return } setComSoc(''); setComOrig(''); setAnioPickFor('com:'+b.id) },C.tealText)}
              {onReclasificarTercero&&ch('x','Es de un externo',extOpen,()=>{setAnioPickFor(extOpen?null:('ext:'+b.id));setTvProv('');setTvNuevo('');setTvPct('')},C.soonText)}
              {sug&&<span style={{fontSize:10,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>sugerido: {sug==='comision'?'Comisión':'Por externo'}</span>}
            </div> }
          // Comisión: queda billing_type='comision', con su origen (texto) y el socio que la generó (learnings socio_factura, fuente de Por socio).
          const comPanel=(e,b)=>{ const ok=!!comSoc
            const doCom=()=>pedir(e,`Marcar como comisión de ${comSoc}${comOrig.trim()?` · ${comOrig.trim()}`:''}.`,async()=>{ try{
                const {error}=await supabase.from('billing').update({billing_type:'comision',comision_origen:comOrig.trim()||null,updated_at:new Date().toISOString()}).eq('id',b.id); if(error) throw error
                if(!DEMO) await setLearningKV('socio_factura',b.id,comSoc)
                setBilling&&setBilling(p=>p.map(x=>x.id===b.id?{...x,billing_type:'comision',comision_origen:comOrig.trim()||null}:x))
                logActividad('facturacion.tipo_comision',{tabla:'billing',id:b.id,detalle:{invoice_no:b.invoice_no,amount:b.amount,socio:comSoc,origen:comOrig.trim()||null,antes:b.billing_type}})
                limpiar(); onRefresh&&onRefresh() }catch(err){ appAlert('No se pudo marcar como comisión: '+(err.message||err)) } })
            const fl={fontSize:9,fontWeight:700,letterSpacing:.5,textTransform:'uppercase',color:C.textSoft}
            return <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap',alignItems:'flex-end'}}>
              <label style={{display:'flex',flexDirection:'column',gap:3,flex:'1 1 160px',minWidth:0}}><span style={fl}>Quién la generó</span><input value={comOrig} onChange={ev=>setComOrig(ev.target.value)} placeholder='Cliente derivado o asunto' style={{fontSize:12,padding:'7px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text,outline:'none',minWidth:0}}/></label>
              <label style={{display:'flex',flexDirection:'column',gap:3}}><span style={fl}>Socio</span><select value={comSoc} onChange={ev=>setComSoc(ev.target.value)} style={{fontSize:12,padding:'7px 9px',borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text}}><option value=''>Elegir</option>{ADMIN_NAMES.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
              <button disabled={!ok} onClick={doCom} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:ok?C.accent:C.done,border:'none',borderRadius:8,padding:'8px 14px',cursor:ok?'pointer':'not-allowed',whiteSpace:'nowrap'}}>Marcar comisión</button>
            </div> }
          const entryCard=(e)=>{ const t=TINT[e.cat]; const b=e.b; const cid=b?b.client_id:null
            const assignOpen=anioPickFor===('cli:'+e.id); const ventaOpen=b&&anioPickFor===b.id; const extOpen=b&&anioPickFor===('ext:'+b.id); const rsOpen=anioPickFor===('rs:'+e.id)
            const confirming=pcConfirm&&pcConfirm._eid===e.id
            const sc=e.cat==='cli'?sugCliente(e.nm,e.rut):null
            const ents=(e.cat==='dat'&&cid)?(clientEntities||[]).filter(x=>String(x.client_id)===String(cid)):[]
            let primLabel='', primAction=null, subEl=null
            if(e.cat==='cli'){ primLabel='Asignar cliente'; primAction=()=>setAnioPickFor(assignOpen?null:('cli:'+e.id)); if(e.src==='sii') subEl=<span onClick={()=>doSinCli(e)} style={sub}>o sin cliente</span> }
            else if(e.cat==='vta'){ primLabel=null; primAction=null; subEl=null }   // el primer paso es el tipo (chips abajo)
            else { if(faltaXml(b)){ primLabel='Adjuntar XML'; primAction=()=>doXml(e) } else { primLabel='Asignar RS'; primAction=()=>setAnioPickFor(rsOpen?null:('rs:'+e.id)) } }
            return <div key={e.id} style={{background:t.bg,border:`1px solid ${C.border}`,borderRadius:13,padding:'12px 13px',marginBottom:9}}>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div onClick={()=>cid&&onOpenClientFicha&&onOpenClientFicha(cid)} style={{fontSize:13.5,fontWeight:700,color:C.accent,lineHeight:1.25,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:cid?'pointer':'default'}}>{e.nm||'Sin razón social'}</div>
                  {e.rut&&<div style={{fontSize:10.5,color:C.muted,marginTop:3}}><b style={{color:C.textSoft,fontWeight:700}}>RUT</b> {fmtRut(e.rut)}</div>}
                  <div style={{fontSize:10.5,color:C.muted,marginTop:7,display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontVariantNumeric:'tabular-nums'}}>N° {e.folio}{e.fecha?` · ${fDMY(e.fecha)}`:''}</span>
                    {e.chips.map((ch,ci)=><span key={ci} style={{fontSize:8.5,fontWeight:700,letterSpacing:.2,textTransform:'uppercase',borderRadius:5,padding:'2px 6px',background:'#fff',color:C.muted}}>{ch}</span>)}
                  </div>
                  {e.glosa&&<div onClick={()=>b&&onEdit&&onEdit(b)} style={{fontSize:11.5,color:C.text,marginTop:4,lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:b?'pointer':'default'}}>{e.glosa}</div>}
                </div>
                <div style={{flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:9,minWidth:84}}>
                  <div style={{fontSize:13.5,fontWeight:800,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(e.monto)}</div>
                  {primLabel&&<button onClick={primAction} style={{fontSize:10.5,fontWeight:700,border:`1px solid ${C.accent}`,color:C.accent,background:'transparent',borderRadius:8,padding:'6px 11px',whiteSpace:'nowrap',cursor:'pointer'}}>{primLabel}</button>}
                  {subEl}
                </div>
              </div>
              {sc&&!confirming&&<div style={{fontSize:11,color:C.muted,marginTop:10}}>Se parece a <b style={{color:C.accent}}>{sc.name}</b> <span onClick={()=>doAssignCli(e,sc.id)} style={{color:C.accent,fontWeight:700,cursor:'pointer',marginLeft:3,whiteSpace:'nowrap'}}>· Sí, es <Gl n='chevron'/></span></div>}
              {assignOpen&&<div style={{marginTop:10}}><AsignarClienteInline bill={e.src==='sii'?{receptor_rut:e.rut,receptor_name:e.nm}:e.b} clients={clients} onAssign={(_,cid2)=>doAssignCli(e,cid2)} label='Asignar cliente' placeholder='Buscar cliente por nombre o RUT…'/></div>}
              {e.cat==='vta'&&b&&<AsignarVentaFactura factura={b} sales={sales} billing={billing} onHecho={()=>{ onRefresh&&onRefresh() }}/>}
              {e.cat==='vta'&&b&&tipoChips(e,b,{ventaOpen,extOpen})}
              {extOpen&&extPanel(b)}
              {b&&anioPickFor===('com:'+b.id)&&comPanel(e,b)}
              {rsOpen&&<div style={{marginTop:10}}>{ents.length?<select defaultValue='' onChange={ev=>{ if(ev.target.value) doRS(e,ev.target.value) }} style={{width:'100%',fontSize:11.5,padding:'8px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.text}}><option value=''>Asignar razón social…</option>{ents.map(en=><option key={en.id} value={en.id}>{en.name}{en.rut?` · ${fmtRut(en.rut)}`:''}</option>)}</select>:<div style={{fontSize:10.5,color:C.muted}}>Sin razones sociales en la ficha · <span onClick={()=>onEdit&&onEdit(b)} style={{color:C.azulInfo,fontWeight:700,cursor:'pointer'}}>abrir factura</span></div>}</div>}
              {confirming&&<div style={{marginTop:11,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:10,padding:'11px 13px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                <div style={{flex:'1 1 150px',minWidth:0,fontSize:12,color:C.text,lineHeight:1.4}}>{pcConfirm.label}</div>
                <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0,marginLeft:'auto'}}>
                  <button onClick={()=>setPcConfirm(null)} style={{fontSize:11.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Cancelar</button>
                  <button onClick={()=>{ const r=pcConfirm.run; r&&r() }} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer'}}>Confirmar</button>
                </div>
              </div>}
            </div>
          }
          const catSection=(cat,label,arr)=>{ if(!arr.length) return null; const t=TINT[cat]; const tot=arr.reduce((a,e)=>a+(e.monto||0),0); return (
            <div style={{marginTop:6}}>
              <div style={{display:'flex',alignItems:'center',gap:7,margin:'0 2px 9px'}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:t.dot,flexShrink:0}}/>
                <span style={{fontSize:10.5,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',color:C.muted}}>{label}</span>
                <span style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:C.textSoft}}>{arr.length} · {fmtMon(tot)}</span>
              </div>
              {arr.map(entryCard)}
            </div>) }
          return (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <div style={{flex:1,display:'flex',alignItems:'center',gap:8,border:`1px solid ${C.border}`,borderRadius:11,padding:'8px 11px',background:C.bgSoft,minWidth:0}}>
                <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.4' strokeLinecap='round'><circle cx='11' cy='11' r='7'/><line x1='21' y1='21' x2='16.5' y2='16.5'/></svg>
                <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente, N° factura, RUT…' style={{border:'none',background:'transparent',outline:'none',fontSize:12.5,color:C.text,width:'100%'}}/>
              </div>
              <select value={pcOrden} onChange={e=>setPcOrden(e.target.value)} style={{fontSize:12,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:11,padding:'8px 10px',background:C.bgSoft,color:C.accent,cursor:'pointer',flexShrink:0}}>
                <option value='cliente'>Cliente (A–Z)</option>
                <option value='fecha'>Fecha · nuevas</option>
                <option value='foliodesc'>Folio ↓</option>
                <option value='folioasc'>Folio ↑</option>
              </select>
            </div>
            <div style={{fontSize:11.5,color:C.muted,lineHeight:1.5,margin:'-4px 2px 0'}}>{entries.length} factura{entries.length!==1?'s':''} por clasificar · <b style={{color:C.accent}}>{fmtMon(totMonto)}</b></div>
            {sinRegN>0&&<div onClick={()=>cargarSinRegistrar()} style={{display:'flex',alignItems:'center',gap:10,background:C.azulBg,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'12px 14px',cursor:'pointer'}}>
              <span style={{width:30,height:30,borderRadius:9,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3'/></svg></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{sinRegN} emitida{sinRegN!==1?'s':''} en el SII sin cargar</div><div style={{fontSize:11,color:C.muted}}>Cárgalas para registrarlas en el sistema</div></div>
              <span style={{color:C.accent,fontSize:16,flexShrink:0}}><Gl n='chevron'/></span>
            </div>}
            {(()=>{ const pf=(billing||[]).filter(b=>!b.deleted_at&&b.billing_type==='comision'&&!b.invoice_no&&b.status==='Anticipada'); if(!pf.length) return null; const tot=pf.reduce((a,b)=>a+(Number(b.amount)||0),0)
              return <div style={{background:C.tealBg,border:`0.5px solid ${C.border}`,borderRadius:12,padding:'11px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'baseline'}}><span style={{fontSize:13,fontWeight:700,color:C.tealText}}>{pf.length} comisi{pf.length!==1?'ones':'ón'} por facturar</span><span style={{fontSize:13,fontWeight:700,color:C.tealText,fontVariantNumeric:'tabular-nums'}}>{fmtMon(tot)}</span></div>
                <div style={{fontSize:11,color:C.muted,margin:'2px 0 6px'}}>Ya se cobraron. Al cargar su factura del SII por el mismo monto se cruzan solas.</div>
                {pf.map(b=>{ const cn=(clients||[]).find(c=>String(c.id)===String(b.client_id))?.name||'—'; return <div key={b.id} onClick={()=>onEdit&&onEdit(b)} style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:12,padding:'4px 0',borderTop:`1px solid ${C.border}`,cursor:'pointer'}}><span style={{minWidth:0,color:C.text}}><b style={{color:C.accent}}>{cn}</b> · {fDMY(String(b.paid_at||'').slice(0,10))}{b.comision_origen?` · ${b.comision_origen}`:''}</span><span style={{fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(b.amount)}</span></div> })}
              </div> })()}
            {entries.length===0&&sinRegN===0&&<div style={{textAlign:'center',padding:40,color:C.muted,fontSize:13}}>Todo al día — no hay facturas por completar.</div>}
            {catSection('cli','Sin cliente',cliE)}
            {catSection('vta','Falta venta',vtaE)}
          </div>)
})() : filter==='all' ? (()=>{
          const hoy=new Date().toISOString().slice(0,10)
          const addDays=(d,n)=>{ if(!d) return ''; const x=new Date(d+'T00:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10) }
          const venceDe=b=> venceBill(b)   // fuente única del vencimiento (emisión + 30), igual que Cobranza y la ficha
          const estadoReal=b=> (b.status==='Pendiente' && esVencidaB(b)) ? 'Vencido' : b.status
          const diasVencC=b=>{ const v=venceDe(b); if(!v) return null; return Math.round((new Date(hoy)-new Date(v+'T00:00:00'))/86400000) }
          const bucketC=b=>{ const d=diasVencC(b); if(d==null||d<=0) return 'aldia'; if(d<=30) return '1-30'; if(d<=60) return '31-60'; if(d<=90) return '61-90'; return '90' }
          const matchEst=b=>{ if(agingF && bucketC(b)!==agingF) return false; if(estSel.size===0) return true; const er=estadoReal(b); return estSel.has(er)||(estSel.has('Pagado')&&er==='Anticipada') }
          let rows=bb.filter(b=>!b.deleted_at)
          if(fYear) rows=rows.filter(b=>(b.issued_at||b.due||'').slice(0,4)===fYear)
          if(q.trim()) rows=rows.filter(b=>{ const cl=clients.find(x=>x.id===b.client_id); const s=q.toLowerCase(); return (cl?.name||'').toLowerCase().includes(s)||(b.concept||'').toLowerCase().includes(s)||folioN(b.invoice_no).toLowerCase().includes(s) })
          rows=rows.filter(matchEst)
          if(tipoFL) rows=rows.filter(b=>tipoFactura(b)===tipoFL)
          const tiposEn=[...new Set(bb.filter(b=>!b.deleted_at).map(tipoFactura))]
          if(soloSinEnviar) rows=rows.filter(sinEnviar)
          const montoDe=b=>{ if(b.status==='Programada'){ const ui=ufInfoDe(b); if(ui) return ui.clpHoy; return b.amount||0 } return montoFactura(b) }
          const mesC=d=>(d||'').slice(0,7); const conc=new Set()
          bb.filter(b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status)&&!b.deleted_at).forEach(p=>{ const a=p.amount||0; if(!a) return; const pm=mesC(p.due||p.issued_at); const reals=bb.filter(r=>!r.deleted_at&&r.issued_at&&r.invoice_no&&r.status!=='Anulada'&&String(r.client_id)===String(p.client_id)); const hit=reals.some(r=>{ const dM=Math.abs((r.amount||0)-a)/a; if(dM>0.15) return false; const rm=mesC(r.due||r.issued_at); if(!pm||!rm) return false; const d=(parseInt(pm.slice(0,4))*12+parseInt(pm.slice(5,7)))-(parseInt(rm.slice(0,4))*12+parseInt(rm.slice(5,7))); return Math.abs(d)<=1 }); if(hit) conc.add(p.id) })
          const GR=[['Vencidas',b=>b.invoice_no&&estadoReal(b)==='Vencido',ESTADO_COBRO.vencido.color,(a,b)=>(venceDe(a)||'').localeCompare(venceDe(b)||'')],['Por cobrar',b=>b.invoice_no&&estadoReal(b)==='Pendiente',ESTADO_COBRO.porCobrar.color,(a,b)=>(venceDe(a)||'').localeCompare(venceDe(b)||'')],['Por facturar',b=>!b.invoice_no&&!['Pagado','Anulada','Anticipada'].includes(b.status),ESTADO_COBRO.porFacturar.color,(a,b)=>(a.due||'').localeCompare(b.due||'')],['Pagadas',b=>['Pagado','Anticipada'].includes(b.status),ESTADO_COBRO.cobrado.color,(a,b)=>(b.paid_at||b.issued_at||'').localeCompare(a.paid_at||a.issued_at||'')],['Anuladas',b=>b.status==='Anulada',ESTADO_COBRO.anulada.color,()=>0]]
          const defC=lbl=>lbl==='Pagadas'||lbl==='Anuladas'
          // Desktop: orden de tabla por columna (Fecha/Cliente/Monto). Reemplaza el orden por defecto del grupo solo en escritorio.
          const colValT=(b)=>{ const c=tblSort.col; if(c==='cliente') return ((clients.find(x=>x.id===b.client_id)?.name)||b.receptor_name||'~').toLowerCase(); if(c==='resp') return (clients.find(x=>x.id===b.client_id)?.abogado_responsable||'~~').toLowerCase(); if(c==='monto') return (['Vencido','Pendiente'].includes(estadoReal(b))?saldoBill(b):montoDe(b))||0; if(c==='vence') return venceDe(b)||''; return kpiDate(b)||'' }
          const cmpT=(a,b)=>{ const va=colValT(a),vb=colValT(b); const r=(typeof va==='number')?(va-vb):String(va).localeCompare(String(vb),'es'); return tblSort.dir==='desc'?-r:r }
          const hCell=(col,label,align)=>{ const on=tblSort.col===col; return <span onClick={()=>setTblSort(s=>({col,dir:s.col===col?(s.dir==='asc'?'desc':'asc'):(col==='cliente'?'asc':'desc')}))} title='Ordenar' style={{display:'inline-flex',alignItems:'center',gap:3,cursor:'pointer',fontSize:9,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',color:on?C.accent:C.muted,userSelect:'none'}}>{label}{on?<span style={{fontSize:8}}>{tblSort.dir==='asc'?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>:''}</span> }
          const filaAll=b=>{ const er=estadoReal(b); const est=estadoCobro(b,{yaFact:conc.has(b.id)}); const col=est.color; const porConciliar=['Pendiente','Vencido'].includes(er)&&porConciliarIds.has(String(b.id)); const cl=clients.find(x=>x.id===b.client_id); const rs=rsLabel(b.client_id,clients,clientEntities,b.entity_id); const ui=ufInfoDe(b); const dl=daysLeft(venceDe(b)||b.due); const diasMini=(er!=='Pagado'&&er!=='Anticipada'&&dl!=null)?(dl<0?`${Math.abs(dl)}d`:dl<=7?`${dl}d`:''):''; const exp=expandBill===b.id; return (
            <div key={b.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,marginBottom:5,overflow:'hidden'}}>
              <div onClick={()=>setExpandBill(exp?null:b.id)} style={{display:isDesktop?'grid':'flex',gridTemplateColumns:isDesktop?'62px 20px minmax(0,1fr) 96px 92px 150px':undefined,justifyContent:isDesktop?undefined:'space-between',alignItems:'center',gap:isDesktop?14:8,padding:isDesktop?'9px 14px':'7px 10px',cursor:'pointer'}}>
                {bigDate(kpiDate(b))}
                <SIcon n={est.icon} s={15} c={col}/>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{...NOMBRE_CLI}}>{cl&&onOpenClientFicha?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(cl.id)}} style={{color:C.accent,cursor:'pointer'}}>{cl.name}</span>:(cl?.name||b.receptor_name||'Sin cliente')}{cl&&rs.name&&rs.name!==cl?.name?<span style={{fontWeight:400,color:C.muted}}> · {rsDisplay(rs.name)}</span>:''}{!cl&&b.receptor_name?<span style={{marginLeft:6,fontSize:9.5,fontWeight:700,background:C.soonBg,color:C.soonText,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Sin vincular</span>:''}</div>
                  <div style={{fontSize:9,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:(b.concept||'—')}{b.invoice_no&&b.concept?` · ${b.concept}`:''}{(()=>{const e=envioBadge(b);return e?<span style={{color:e.col,fontWeight:600}}> · {e.txt}</span>:null})()}{porConciliar&&<span style={{color:C.soonText,fontWeight:700}}> · Por conciliar</span>}</div>
                </div>
                {isDesktop&&(()=>{ const rp=cl?.abogado_responsable; if(!rp) return <div style={{fontSize:11,color:C.textSoft}}>—</div>; const pc=personChip(rp); return <div style={{minWidth:0,overflow:'hidden'}}><span style={{fontSize:11,fontWeight:700,color:pc.color,whiteSpace:'nowrap',display:'inline-block',maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis'}}>{rp}</span></div> })()}
                {isDesktop&&(()=>{ const v=venceDe(b); if(['Pagado','Anticipada','Anulada'].includes(b.status)||!v) return <div style={{textAlign:'right',fontSize:11,color:C.textSoft}}>—</div>; return <div style={{textAlign:'right'}}><div style={{fontSize:11,fontWeight:600,color:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{fmtFechaDMY(v)}</div>{diasMini&&<div style={{fontSize:9,fontWeight:600,color:col}}>{diasMini}</div>}</div> })()}
                <div style={{textAlign:'right',flexShrink:0}}>{(()=>{ const hayAb=saldoBill(b)<(b.amount||0)&&!['Pagado','Anulada'].includes(b.status); return <><div style={{fontSize:13,fontWeight:600,color:hayAb?(er==='Vencido'?C.overdueText:C.accent):C.text}}>{fmt(hayAb?saldoBill(b):(b.status==='Programada'?(ui?ui.clpHoy:b.amount):montoFactura(b)))}</div>{hayAb&&<div style={{fontSize:9,color:C.muted}}>de {fmt(b.status==='Programada'?(ui?ui.clpHoy:b.amount):montoFactura(b))}</div>}</> })()}{!isDesktop&&diasMini&&<div style={{fontSize:9,fontWeight:600,color:col}}>{diasMini}</div>}</div>
              </div>
              {exp&&<div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:6,flexWrap:'wrap',padding:'0 10px 8px'}}>
                {!porConciliar&&['Pendiente','Vencido'].includes(er)&&(()=>{ const rd=diasDesde(recordadoMap[String(b.id)]); const rec=rd!=null&&rd<=2; return <ActBtn variant={rec?'softMuted':'softNavy'} onClick={()=>recordarCobro(b)} title={rd!=null?(rd===0?'Recordado hoy':`Recordado hace ${rd}d`):''}>{rec?'Recordar otra vez':'Recordar'}</ActBtn> })()}
                {!b.invoice_no&&conc.has(b.id)&&<ActBtn variant='softAmber' onClick={()=>onConciliar&&onConciliar(cl)}>Vincular factura emitida</ActBtn>}
                {onEdit&&<ActBtn variant='ghost' onClick={()=>onEdit(b)}>Editar</ActBtn>}
                {b.invoice_no&&b.status!=='Programada'&&b.status!=='Anulada'&&<ActBtn variant='primary' onClick={()=>setFacturaEmail(b)}>{b.email_sent_at?'Reenviar':'Enviar'}</ActBtn>}
                {(b.status==='Pagado'||b.status==='Anticipada')&&<ActBtn variant='softGreen' onClick={()=>acuseCobro(b)}>Acuse</ActBtn>}
                {['Pendiente','Vencido'].includes(er)&&<ActBtn variant={porConciliar?'success':'ghost'} onClick={()=>setPagosFor(pagosFor===b.id?null:b.id)}>{porConciliar?'Conciliar pago':'Buscar pago'}</ActBtn>}
                {(()=>{ const abs=abonosDe(b); return abs.length>0?<div style={{width:'100%',marginTop:6,background:C.greenBg,borderRadius:10,padding:'7px 10px'}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,marginBottom:4,letterSpacing:.3}}>ABONOS CONCILIADOS (BANCO)</div>{abs.map(({c,m})=><div key={c.movimiento_id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,fontSize:10,padding:'2px 0'}}><span style={{color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(m.fecha)} · {m.nombre_contraparte||'Banco'}{m.n_operacion?` · Op ${m.n_operacion}`:''}</span><span style={{color:C.greenText,fontWeight:700,whiteSpace:'nowrap'}}>−{fmt(c.monto_aplicado)}</span></div>)}<div style={{display:'flex',justifyContent:'space-between',marginTop:4,paddingTop:4,borderTop:`0.5px solid ${C.normal}`,fontSize:10,fontWeight:700,color:C.text}}><span>Saldo</span><span>{fmt(saldoBill(b))}</span></div></div>:null })()}
                {porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const ps=pagosDe(b); if(!ps.length) return null; const top=ps[0]; const mult=ps.length>1; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.greenBg,border:`1px solid ${C.normal}`,borderRadius:10,padding:'7px 10px'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,letterSpacing:.3}}>{top.rut?'PAGO SUGERIDO · MISMO RUT':'PAGO SUGERIDO · MISMO MONTO'}</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · {top.m.nombre_contraparte||'Banco'}{mult?` · +${ps.length-1} más`:''}</div></div>
                  <ActBtn variant='success' disabled={pagoBusy} onClick={()=> mult?setPagosFor(b.id):conciliarPago(top.m,b)} style={{flexShrink:0}}>{mult?'Ver':'Conciliar'}</ActBtn>
                </div>) })()}
                {!porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const cc=calcesCercanos(b); if(!cc.length) return null; const top=cc[0]; const saldo=saldoBill(b); const pct=saldo>0?(top.dif/saldo*100):0; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.tealBg,border:`1px solid ${C.tealText}`,borderRadius:10,padding:'7px 10px'}}>
                  <SIcon n='check' s={15} c={C.tealText}/>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.tealText,letterSpacing:.3}}>DIFERENCIA DE UF · MISMO RUT</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · pagó lo programado · dif {fmt(top.dif)} (~{pct.toFixed(1)}%) por UF</div></div>
                  <button disabled={pagoBusy} onClick={()=>setPagosFor(b.id)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer',flexShrink:0}}>Revisar</button>
                </div>) })()}
                {!porConciliar&&pagosFor!==b.id&&['Pendiente','Vencido'].includes(er)&&(()=>{ const pr=pagosRutSugeridos(b).filter(x=>!esCalceCercano(x.m,b)); if(!pr.length) return null; const top=pr[0]; const mult=pr.length>1; return (<div style={{width:'100%',marginTop:6,display:'flex',alignItems:'center',gap:8,background:C.tealBg,border:`1px solid ${C.tealText}44`,borderRadius:10,padding:'7px 10px'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:C.tealText,letterSpacing:.3}}>PAGO DEL MISMO RUT SIN CONCILIAR</div><div style={{fontSize:11,color:C.text,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDate(top.m.fecha)} · <b>{fmt(top.m.monto)}</b> · {top.m.nombre_contraparte||'Banco'} — {mult?`${pr.length} abonos · revisar`:'no calza el total · revisar'}</div></div>
                  <button disabled={pagoBusy} onClick={()=>setPagosFor(b.id)} style={{fontSize:11,fontWeight:700,color:C.tealText,background:'#fff',border:`1px solid ${C.tealText}66`,borderRadius:8,padding:'6px 13px',cursor:'pointer',flexShrink:0}}>Revisar</button>
                </div>) })()}
                {pagosFor===b.id&&(()=>{ const ps0=pagosDe(b); const ps=ps0.length?ps0:pagosRutSugeridos(b); const loose=ps0.length===0&&ps.length>0; return (<div style={{width:'100%',marginTop:6,background:C.tealBg,borderRadius:10,padding:'8px 10px'}}>
                  {ps.length===0
                    ? <div style={{fontSize:10,color:C.tealText}}>Sin pagos del banco que calcen con {fmt(saldoBill(b))}. {onConciliar&&<span onClick={()=>onConciliar(clients.find(c=>String(c.id)===String(efClientIdG(b))))} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>Ver en Conciliación →</span>}</div>
                    : <><div style={{fontSize:9,color:C.tealText,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,marginBottom:5}}>{loose?'Pagos del mismo RUT/RS · revisa el monto':`Pagos del banco que calzan · ${fmt(saldoBill(b))}`}</div>
                      {ps.map(({m,rut})=>{ const cc=esCalceCercano(m,b); return (<div key={m.id} style={{display:'flex',alignItems:'center',gap:8,background:'#fff',border:`1px solid ${cc?C.tealText:(rut?C.normal:C.border)}`,borderRadius:8,padding:'7px 9px',marginBottom:5}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:9,fontWeight:700,color:cc?C.tealText:(loose?C.soonText:(rut?C.greenText:C.soonText))}}>{cc?`DIFERENCIA DE UF · dif ${fmt(cc)}`:(loose?(rut?'MISMO RUT · monto distinto':'MISMO CLIENTE · monto distinto'):(rut?'CALCE EXACTO · mismo RUT':'MISMO MONTO'))}</div><div style={{fontSize:11,color:C.text,marginTop:2}}>{fmtDate(m.fecha)} · <b>{fmt(m.monto)}</b>{cc?<span style={{color:C.tealText}}> · programado {fmt(b.amount||0)} → emitido {fmt(montoFactura(b))}</span>:null}</div><div style={{fontSize:9,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.nombre_contraparte||'—'}{m.rut_contraparte?` · ${m.rut_contraparte}`:''}{m.n_operacion?` · Op ${m.n_operacion}`:''}</div></div>
                        {cc?<button disabled={pagoBusy} onClick={()=>conciliarCalceCercano(m,b)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.tealText,border:'none',borderRadius:8,padding:'7px 11px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Conciliar (queda saldada)</button>:<ActBtn variant='success' disabled={pagoBusy} onClick={()=>conciliarPago(m,b)} style={{flexShrink:0}}>Conciliar pago</ActBtn>}
                      </div>)})}</>}
                </div>)})()}
              </div>}
            </div>
          )}
          return (<div>
            {tiposEn.length>1&&<div style={{display:'flex',justifyContent:'flex-end',marginBottom:6}}><select value={tipoFL} onChange={e=>setTipoFL(e.target.value)} style={{fontSize:12,fontWeight:600,color:C.accent,border:`1px solid ${C.border}`,background:C.surface,borderRadius:9,padding:'6px 9px'}}><option value=''>Tipo: todos</option>{TIPOS_FACTURA.filter(t=>tiposEn.includes(t.k)).map(t=><option key={t.k} value={t.k}>{t.t}</option>)}</select></div>}
            {rows.length===0&&<div style={{color:C.muted,textAlign:'center',padding:30}}>Sin facturas con estos filtros.</div>}
            {isDesktop&&rows.length>0&&<div style={{display:'grid',gridTemplateColumns:'62px 20px minmax(0,1fr) 96px 92px 150px',gap:14,padding:'2px 14px 6px',borderBottom:`1px solid ${C.border}`,marginBottom:2,alignItems:'center'}}>
              {hCell('fecha','Fecha')}
              <span></span>
              {hCell('cliente','Cliente · documento')}
              {hCell('resp','Responsable')}
              <div style={{display:'flex',justifyContent:'flex-end'}}>{hCell('vence','Vence','right')}</div>
              <div style={{display:'flex',justifyContent:'flex-end'}}>{hCell('monto','Monto','right')}</div>
            </div>}
            {GR.map(([lbl,pred,col,srt])=>{ const gr=rows.filter(pred).sort(isDesktop?cmpT:srt); if(!gr.length) return null; const key=`all|${lbl}`; const isOpen=groupOpen[key]!==undefined?groupOpen[key]:!defC(lbl); const sub=gr.reduce((a,b)=>a+(['Vencidas','Por cobrar'].includes(lbl)?saldoBill(b):montoDe(b)),0); const _ec=Object.values(ESTADO_COBRO).find(x=>x.color===col)||{bg:C.bgWarm,text:C.grisText}; const ch={bg:_ec.bg,fg:_ec.text}; return (
              <div key={key} style={{marginBottom:4}}>
                <div onClick={()=>setGroupOpen(p=>({...p,[key]:!isOpen}))} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',margin:'8px 0 5px'}}>
                  <span style={{fontSize:10,fontWeight:700,background:ch.bg,color:ch.fg,borderRadius:14,padding:'2px 9px',textTransform:'uppercase',letterSpacing:.4}}>{lbl} · {gr.length} {isOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
                  <span style={{fontSize:10,fontWeight:700,background:ch.bg,color:ch.fg,borderRadius:14,padding:'2px 9px'}}>{fmtMill(sub)}</span>
                </div>
                {isOpen&&gr.map(filaAll)}
              </div>
            )})}
          </div>)
        })() : (
          <>
            {filtered.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>{isProg?'Sin facturas programadas':filter==='terceros'?'Sin facturas con costos de proveedores':'Sin cobros'}</div>}
            {grouped.map(renderClientGroup)}
          </>
        )}
      </div>
      {/* FAB "Nueva factura" retirado a pedido del usuario (alta manual de cobros queda en la ficha del cliente → Financiero) */}
      {siiPanel&&(
        <div onClick={()=>setSiiPanel(null)} style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,padding:16,maxWidth:540,width:'100%',maxHeight:'85vh',overflowY:'auto',boxShadow:'0 8px 40px rgba(0,0,0,.18)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
              <div style={{fontSize:15,fontWeight:600,color:C.text}}>{siiPanel==='set'?'Set de pruebas · SII':siiPanel==='libro'?'Libro de ventas':'Historial de emisión'}</div>
              <button onClick={()=>setSiiPanel(null)} style={{background:'none',border:'none',color:C.muted,fontSize:20,lineHeight:1,cursor:'pointer'}}><Gl n='x'/></button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginBottom:13}}>{siiPanel==='log'?'Cada emisión registrada — folio, estado y errores (incluye folios perdidos)':'Ambiente certificación · prueba con vista previa antes de enviar'}</div>
            {siiPanel==='log'?(
              siiLog===null?<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'22px 0'}}>Cargando…</div>
              :siiLog.length===0?<div style={{fontSize:12,color:C.muted,textAlign:'center',padding:'22px 0'}}>Sin emisiones registradas todavía.</div>
              :<div style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
                {siiLog.map((l,i)=>{ const err=l.estado==='error'||l.error; const acep=/acep/i.test(l.estado||''); return (
                  <div key={l.id||i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 12px',borderTop:i?`0.5px solid #F2F4F6`:'none'}}>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:C.text}}>DTE {l.tipo_dte} · Factura N° {l.folio||'—'}</div>
                      <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{String(l.created_at||'').slice(0,16).replace('T',' ')}{l.created_by?` · ${l.created_by}`:''}{l.error?` · ${l.error}`:''}</div>
                    </div>
                    <span style={{fontSize:9.5,fontWeight:700,flexShrink:0,color:err?C.overdueText:acep?C.greenText:C.soonText,background:err?C.overdueBg:acep?C.greenBg:C.ambarBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{err?'error':acep?'aceptada':(l.estado||'enviado')}</span>
                  </div>) })}
              </div>
            ):siiPanel==='set'?(<>
              <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Casos del set (JSON). Pega los que asigne el SII; viene un ejemplo (factura 34 + nota de crédito 61 que la anula).</div>
              <textarea value={siiSetJson} onChange={e=>setSiiSetJson(e.target.value)} spellCheck={false} style={{width:'100%',minHeight:170,boxSizing:'border-box',fontFamily:'monospace',fontSize:11,border:`1px solid ${C.border}`,borderRadius:8,padding:10,color:C.text,resize:'vertical'}}/>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button disabled={siiBusy} onClick={()=>siiEmitirSet(true)} style={{flex:1,fontSize:13,fontWeight:600,color:C.accent,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'9px',cursor:'pointer',opacity:siiBusy?.6:1}}>Vista previa (XML)</button>
                <button disabled={siiBusy} onClick={async()=>{ if(await appConfirm('¿Emitir el set al SII (ambiente certificación)?')) siiEmitirSet(false) }} style={{flex:1,fontSize:13,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'9px',cursor:'pointer',opacity:siiBusy?.6:1}}>Emitir set al SII</button>
              </div>
            </>):(<>
              <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Genera el Libro de Ventas del período con las facturas ya emitidas en él.</div>
              <input value={siiPeriodo} onChange={e=>setSiiPeriodo(e.target.value)} placeholder='AAAA-MM (ej. 2026-07)' style={{width:'100%',boxSizing:'border-box',height:38,border:`1px solid ${C.border}`,borderRadius:8,padding:'0 12px',fontSize:13,color:C.text}}/>
              <button disabled={siiBusy} onClick={siiLibro} style={{width:'100%',marginTop:10,fontSize:13,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'9px',cursor:'pointer',opacity:siiBusy?.6:1}}>Generar libro</button>
            </>)}
            {siiResult&&(
              <div style={{marginTop:13,background:siiResult.error?C.overdueBg:C.bgSoft,borderRadius:8,padding:'10px 12px'}}>
                {siiResult.error?<div style={{fontSize:12,color:C.overdueText}}>{siiResult.error}</div>:(<>
                  <div style={{fontSize:12,color:C.text,fontWeight:600,marginBottom:siiResult.docs?5:0}}>{siiResult.dryRun?'Vista previa lista (no se envió)':siiResult.trackId?`Enviado al SII · TrackID ${siiResult.trackId}`:`Libro generado${siiResult.nDet!=null?` · ${siiResult.nDet} documento(s)`:''}`}</div>
                  {siiResult.docs&&<div style={{fontSize:11,color:C.muted,marginBottom:6}}>{siiResult.docs.map(d=>`${d.docId} · $${(d.total||0).toLocaleString('es-CL')}`).join('  ·  ')}</div>}
                  {(siiResult.envioXml||siiResult.libroXml)&&<button onClick={()=>siiDescargarXml(siiResult.envioXml||siiResult.libroXml, siiResult.libroXml?'libro_ventas.xml':'set_dte.xml')} style={{fontSize:12,fontWeight:600,color:C.accent,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Descargar XML</button>}
                </>)}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

// Detalle comparativo antes de fusionar dos anticipos duplicados — para no fusionar a ciegas.
export function FusionAnticiposModal({bank, manual, clients=[], sales=[], clientEntities=[], onConfirm, onClose}){
  const fmtCLP0 = n => fmt(Number(n)||0)   // unificado al fmt global (signo -$ y redondeo correctos)
  const cliName = clients.find(c=>String(c.id)===String(bank.client_id))?.name||'Cliente'
  const esBanco = a => /conciliaci[oó]n/i.test(a.nota||'')
  const proyDe = a => a.proyecto || sales.find(s=>String(s.id)===String(a.sale_id))?.title || '—'
  const rsDe = a => clientEntities.find(x=>String(x.id)===String(a.entity_id))?.name || '—'
  const resProyTxt = bank.proyecto || manual.proyecto || sales.find(s=>String(s.id)===String(bank.sale_id||manual.sale_id))?.title || '—'
  const resRSTxt = clientEntities.find(x=>String(x.id)===String(bank.entity_id||manual.entity_id))?.name || '—'
  const card = (a,keep)=>(
    <div style={{flex:1,minWidth:0,border:`1px solid ${keep?C.normal:C.border}`,borderRadius:10,padding:'10px 12px',background:keep?C.greenBg:'#fff'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:6,marginBottom:6}}>
        <span style={{fontSize:9,fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',color:keep?C.greenText:C.overdueText}}>{keep?'Se conserva':'Se elimina'}</span>
        <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:esBanco(a)?C.azulBg:C.border,color:esBanco(a)?C.accent:C.grisText,whiteSpace:'nowrap'}}>{esBanco(a)?'Verificado en banco':'Manual'}</span>
      </div>
      <div style={{fontSize:15,fontWeight:700,color:C.text}}>{fmtCLP0(a.monto)}</div>
      <div style={{fontSize:11,color:C.muted,marginTop:1}}>{fmtFechaDMY(a.fecha)}</div>
      <div style={{marginTop:7,fontSize:11,color:C.muted,lineHeight:1.55}}>
        <div><span style={{color:C.textSoft}}>Proyecto:</span> {proyDe(a)}</div>
        <div><span style={{color:C.textSoft}}>RS:</span> {rsDe(a)}</div>
      </div>
    </div>
  )
  return (
    <Modal title={<><span style={{color:C.accent}}>Fusionar anticipos</span><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{cliName}</span></>} onClose={onClose} closeOnBackdrop={false}>
      <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'stretch'}}>{card(bank,true)}{card(manual,false)}</div>
      <div style={{background:C.bgSoft,borderRadius:10,padding:'10px 12px',marginBottom:14}}>
        <div style={{...SEC_LBL,marginBottom:6}}>Queda un solo anticipo</div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:14,fontWeight:700,color:C.text}}>{fmtCLP0(bank.monto)}</span><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.accent,whiteSpace:'nowrap'}}>Verificado en banco</span></div>
        <div style={{fontSize:11,color:C.muted,marginTop:6,lineHeight:1.55}}>Proyecto: {resProyTxt} · RS: {resRSTxt}</div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button onClick={()=>{onConfirm();onClose()}} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Fusionar</button>
      </div>
    </Modal>
  )
}

export function AnticiposPanel({anticipos=[],clients=[],clientEntities=[],billing=[],sales=[],onNuevo,onCubrir,onDescubrir,onDeshacerConsumo,onFacturar,onFusionar,onAbrir,onConsume,onOpenClientFicha,onOpenFactura}) {
  const [fusionPair,setFusionPair] = useState(null)
  const [fil,setFil] = useState('disponible')
  const [expCli,setExpCli] = useState(null)   // cliente con su detalle de anticipos desplegado (plegado por defecto: la lista es muy larga)
  const [sel,setSel] = useState(()=>new Set())   // anticipos marcados (multi-imputar a una factura en un paso)
  const [pickCid,setPickCid] = useState(null)    // cliente cuyo selector de factura está abierto
  const [pickFac,setPickFac] = useState(null)    // factura elegida en el selector
  const [impBusy,setImpBusy] = useState(false)
  const fmtCLP0 = n => fmt(Number(n)||0)   // unificado al fmt global (signo -$ y redondeo correctos)
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
  const fmtD = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
  const flabel = {fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase'}
  return (
    <div>
      <div style={{display:'flex',border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
        <div style={{flex:1,padding:'14px 16px'}}>
          <div style={flabel}>Disponible</div>
          <div style={{fontSize:22,fontWeight:500,letterSpacing:'-.5px',color:C.normal,marginTop:3}}>{fmtCLP0(totalDisp)}</div>
          <div style={{fontSize:11,color:C.textSoft,marginTop:2}}>en {nClientesDisp} cliente{nClientesDisp!==1?'s':''}</div>
        </div>
        <div style={{flex:1,padding:'14px 16px',borderLeft:`0.5px solid ${C.border}`}}>
          <div style={flabel}>Consumido</div>
          <div style={{fontSize:22,fontWeight:500,letterSpacing:'-.5px',color:C.muted,marginTop:3}}>{fmtCLP0(totalCons)}</div>
          <div style={{fontSize:11,color:C.textSoft,marginTop:2}}>Histórico total</div>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{display:'flex',gap:6}}>
          {[['disponible','Disponibles'],['consumido','Consumidos'],['todos','Todos']].map(([v,l])=>(
            <button key={v} onClick={()=>setFil(v)} style={filterPill(fil===v)}>{l}</button>
          ))}
        </div>
        <button onClick={()=>onNuevo&&onNuevo()} style={{padding:'6px 14px',borderRadius:20,background:C.greenText,color:'#fff',border:'none',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>+ Anticipo</button>
      </div>
      {lista.length===0&&<div style={{textAlign:'center',color:C.textSoft,fontSize:13,padding:30}}>No hay anticipos {fil==='disponible'?'disponibles':fil==='consumido'?'consumidos':'registrados'}</div>}
      {Object.keys(grupos).map(cid=>{
        const arr=grupos[cid]
        const totCli=arr.filter(a=>a.estado==='disponible').reduce((s,a)=>s+(a.monto||0),0)
        const rs=arr.map(rsName).find(Boolean)||''
        return (
          <div key={cid} style={{border:`0.5px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:8}}>
            <div onClick={()=>setExpCli(o=>o===cid?null:cid)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:C.bgSoft,padding:'8px 14px',borderBottom:expCli===cid?`0.5px solid ${C.border}`:'none',cursor:'pointer',gap:10}}>
              <div style={{minWidth:0}}><div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(cid)}} style={{fontSize:12,fontWeight:600,color:C.accent,cursor:onOpenClientFicha?'pointer':'default'}}>{cliName(cid)}</div>{rs&&<div style={{fontSize:11,color:C.textSoft}}>{rs}</div>}<div style={{fontSize:10,color:C.textSoft,marginTop:1}}>{arr.length} anticipo{arr.length!==1?'s':''}</div></div>
              <div style={{textAlign:'right',display:'flex',alignItems:'center',gap:8}}><div><div style={flabel}>Disponible</div><div style={{fontSize:14,fontWeight:600,color:C.normal}}>{fmtCLP0(totCli)}</div></div><span style={{fontSize:12,color:C.accent}}>{expCli===cid?<Gl n='chevD'/>:<Gl n='chevron'/>}</span></div>
            </div>
            {expCli===cid&&(()=>{ const disp=arr.filter(a=>a.estado==='disponible'); const pairs=[]
              for(let i=0;i<disp.length;i++) for(let j=i+1;j<disp.length;j++){ const a=disp[i],b=disp[j]; const dd=Math.abs((new Date(a.fecha+'T12:00')-new Date(b.fecha+'T12:00'))/86400000); if((a.monto||0)===(b.monto||0)&&dd<=7) pairs.push([a,b]) }
              if(!pairs.length) return null
              return pairs.map(([x,y],k)=>{ const bank=/conciliaci[oó]n/i.test(x.nota||'')?x:(/conciliaci[oó]n/i.test(y.nota||'')?y:x); const manual=bank===x?y:x; const distintos=bank!==manual; return (
                <div key={'dup'+k} style={{background:C.ambarBg,borderBottom:`0.5px solid ${C.border}`,padding:'8px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
                  <div style={{fontSize:11,color:C.soonText,lineHeight:1.4,minWidth:0}}><b>Posible anticipo duplicado:</b> {fmtCLP0(x.monto)} en {fmtD(x.fecha)} y {fmtD(y.fecha)}.{distintos?' Al fusionar se conserva el verificado en banco con el proyecto del manual.':''}</div>
                  {onFusionar&&<button onClick={()=>setFusionPair({bank,manual})} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 11px',cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>Fusionar</button>}
                </div>
              )}) })()}
            {expCli===cid&&arr.map(a=>{ const disp=a.estado==='disponible'; const folio=folioDe(a); const cubreCuotas=billing.some(b=>String(b.prepaid_anticipo_id)===String(a.id)); return (
              <div key={a.id} style={{padding:'10px 14px',borderBottom:`0.5px solid ${C.border}`,background:sel.has(a.id)?C.azulBg:undefined}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                {disp&&onConsume&&<span onClick={e=>{e.stopPropagation();setSel(s=>{const n=new Set(s);n.has(a.id)?n.delete(a.id):n.add(a.id);return n})}} title='Seleccionar para imputar a una factura' style={{width:19,height:19,borderRadius:6,border:`2px solid ${sel.has(a.id)?C.accent:C.done}`,background:sel.has(a.id)?C.accent:'#fff',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}>{sel.has(a.id)&&<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>}</span>}
                <div onClick={()=>onAbrir&&onAbrir(a)} style={{flex:1,minWidth:0,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,cursor:onAbrir?'pointer':'default'}}>
                  {bigDate(a.fecha)}<div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text}}>{a.proyecto||'Anticipo'}</div>{a.nota&&<div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.nota}</div>}</div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      {!disp&&folio&&<span onClick={e=>{e.stopPropagation();const bf=billing.find(b=>String(b.id)===String(a.billing_id));bf&&onOpenFactura&&onOpenFactura(bf)}} style={{fontSize:11,color:C.muted,textDecoration:'underline',cursor:onOpenFactura?'pointer':'default'}}>Factura N° {folio}</span>}
                      <span style={{fontSize:9.5,fontWeight:700,letterSpacing:'.03em',padding:'2px 8px',borderRadius:20,background:disp?C.greenBg:cubreCuotas?C.azulBg:C.bgSoft,color:disp?C.greenText:cubreCuotas?C.accent:C.done,whiteSpace:'nowrap'}}>{disp?'DISPONIBLE':cubreCuotas?'EN CUOTAS':'CONSUMIDO'}</span>
                      <span style={{fontSize:13,fontWeight:600,color:disp?C.normal:C.muted}}>{fmtCLP0(a.monto)}</span>
                    </div>
                    {disp&&onAbrir&&<button onClick={e=>{e.stopPropagation();onAbrir(a)}} style={{fontSize:10,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:20,padding:'1px 11px',cursor:'pointer',lineHeight:1.6}}>Asignar</button>}
                  </div>
                </div>
                </div>
                {!disp&&cubreCuotas&&(()=>{ const cu=(billing||[]).filter(b=>String(b.prepaid_anticipo_id)===String(a.id)); if(!cu.length) return null; return (
                  <div style={{marginTop:7,background:C.bgPanel,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'6px 9px'}}>
                    <div style={{...SEC_LBL,marginBottom:3}}>Cubre {cu.length} cuota{cu.length!==1?'s':''}</div>
                    {cu.map(b=><div key={b.id} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11,padding:'2px 0'}}><span style={{color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.concept||(b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'Cuota')}</span><span style={{color:C.muted,fontWeight:600,flexShrink:0}}>{fmtCLP0(b.amount)}</span></div>)}
                  </div>
                )})()}
                {!disp&&cubreCuotas&&(
                  <div style={{display:'flex',gap:7,marginTop:7,flexWrap:'wrap'}}>
                    {!a.billing_id&&onFacturar&&<button onClick={()=>onFacturar(a)} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Emitir una factura</button>}
                    {onDescubrir&&<button onClick={()=>onDescubrir(a.id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Deshacer cobertura</button>}
                  </div>
                )}
                {!disp&&!cubreCuotas&&a.billing_id&&onDeshacerConsumo&&(
                  <div style={{display:'flex',gap:7,marginTop:7}}>
                    <button onClick={async()=>{ if(await appConfirm('¿Deshacer este anticipo? Vuelve a Disponible y, si no hay otro que la cubra, la factura vuelve a Pendiente.')) onDeshacerConsumo(a) }} style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 11px',cursor:'pointer'}}>Deshacer</button>
                  </div>
                )}
              </div>
            )})}
            {expCli===cid&&onConsume&&(()=>{ const selIds=arr.filter(a=>a.estado==='disponible'&&sel.has(a.id)).map(a=>a.id); if(!selIds.length) return null; const selMonto=arr.filter(a=>selIds.includes(a.id)).reduce((s,a)=>s+(a.monto||0),0)
              const facs=(billing||[]).filter(b=>!b.deleted_at&&String(b.client_id)===String(cid)&&b.invoice_no&&['Pendiente','Vencido'].includes(b.status)&&saldoBill(b)>0).sort((a,b)=>String(b.issued_at||b.due||'').localeCompare(String(a.issued_at||a.due||'')))
              return (<div style={{borderTop:`1px solid ${C.border}`,background:C.bgSoft,padding:'10px 12px'}} onClick={e=>e.stopPropagation()}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,fontWeight:700,color:C.accent}}>{selIds.length} anticipo{selIds.length!==1?'s':''} · {fmtCLP0(selMonto)}</span>
                  {pickCid!==cid && <button onClick={()=>{setPickCid(cid);setPickFac(null)}} style={{fontSize:12,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Imputar a una factura →</button>}
                </div>
                {pickCid===cid&&(facs.length? <div style={{marginTop:9}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:'.03em',marginBottom:5}}>Elige la factura</div>
                  {facs.map(b=>{ const on=String(pickFac)===String(b.id); return (
                    <div key={b.id} onClick={()=>setPickFac(b.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,cursor:'pointer',background:on?C.azulBg:'#fff',border:`1px solid ${on?C.accent:C.border}`,marginBottom:5}}>
                      <span style={{width:16,height:16,borderRadius:'50%',flexShrink:0,border:`2px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff'}}/>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>Factura N° {folioN(b.invoice_no)||'—'}</div><div style={{fontSize:10,color:C.muted}}>{b.issued_at?`emitida ${fmtD(b.issued_at)} · `:''}saldo {fmtCLP0(saldoBill(b))}</div></div>
                      <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{fmtCLP0(saldoBill(b))}</span>
                    </div>) })}
                  <button disabled={!pickFac||impBusy} onClick={async()=>{ if(!await appConfirm(`¿Imputar ${selIds.length} anticipo${selIds.length!==1?'s':''} (${fmtCLP0(selMonto)}) a la Factura N° ${folioN((facs.find(b=>String(b.id)===String(pickFac))||{}).invoice_no)}? La factura queda pagada por conciliación bancaria (la plata ya entró a caja con la transferencia).`)) return; setImpBusy(true); try{ await onConsume(selIds,pickFac); setSel(new Set()); setPickCid(null); setPickFac(null) }finally{ setImpBusy(false) } }} style={{width:'100%',marginTop:4,background:pickFac?C.accent:C.done,color:'#fff',border:'none',borderRadius:10,padding:'10px',fontSize:13,fontWeight:700,cursor:pickFac?'pointer':'default'}}>{impBusy?'Imputando…':`Imputar ${selIds.length} anticipo${selIds.length!==1?'s':''} (${fmtCLP0(selMonto)})`}</button>
                  <button onClick={()=>setPickCid(null)} style={{width:'100%',marginTop:6,background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
                </div> : <div style={{marginTop:9,fontSize:11,color:C.muted}}>Este cliente no tiene facturas pendientes con saldo. Emite una factura primero.</div>)}
              </div>) })()}
          </div>
        )
      })}
      {fusionPair&&<FusionAnticiposModal bank={fusionPair.bank} manual={fusionPair.manual} clients={clients} sales={sales} clientEntities={clientEntities} onConfirm={()=>onFusionar&&onFusionar(fusionPair.bank,fusionPair.manual)} onClose={()=>setFusionPair(null)}/>}
    </div>
  )
}

// Glosa PLANA para el asunto: "Proyecto — Pago 1 de 10".
export function facturaGlosa(factura, sale){
  const {relacion, detalle} = facturaGlosaPartes(factura, sale)
  return (relacion + (detalle ? ` — ${detalle}` : '')).trim()
}

// Cuerpo para VARIAS facturas del mismo cliente en UN correo: una sola frase que engloba (folios + cuotas + proyecto + total),
// ordenada de la más antigua a la más nueva, calzando con la cuota de cada DTE. saleOf(f) resuelve la venta de cada factura.
export function facturaCorreoBodyMulti(list, saleOf, lang, amountOf, sinCierre=false){
  const arr = [...list].sort((a,b)=> String(a.issued_at||a.due||'').localeCompare(String(b.issued_at||b.due||'')) || String(folioN(a.invoice_no||'')).localeCompare(String(folioN(b.invoice_no||'')),undefined,{numeric:true}))
  const rows = arr.map(f=>{ const p=facturaGlosaPartes(f, saleOf?saleOf(f):null); const m=String(p.detalle||'').match(/(\d+)\s*(?:de|\/)\s*\d+/i)||String(p.detalle||'').match(/(?:pago|cuota)\s+(\d+)/i); return { folio: folioN(f.invoice_no||'')||f.invoice_no||'', relacion:p.relacion, esProyecto:p.esProyecto, cuotaN:m?m[1]:null, amount: amountOf?amountOf(f):(f.amount||0) } })
  const total = rows.reduce((a,r)=>a+r.amount,0)
  const listJoin = (a, y) => a.length<=1 ? (a[0]||'') : a.slice(0,-1).join(', ')+` ${y} `+a[a.length-1]
  const foliosStr = 'N° '+listJoin(rows.map(r=>r.folio), lang==='en'?'and':'y')
  const nums = rows.map(r=>r.cuotaN)
  const rels = [...new Set(rows.filter(r=>r.esProyecto&&r.relacion).map(r=>r.relacion))]
  const cierre = sinCierre?'':`\n\n${CORREO_DESPEDIDA(lang)}`
  if(lang==='en'){
    const pagos = nums.every(Boolean) ? `, corresponding to payments ${listJoin(nums,'and')}` : ''
    const rel = rels.length===1 ? ` of our professional services in connection with ${rels[0]}` : ' of our professional services'
    return `We are pleased to attach invoices ${foliosStr}${pagos}${rel}, for a total of ${fmtN(total)}.${cierre}`
  }
  const pagos = nums.every(Boolean) ? `, correspondientes a los pagos ${listJoin(nums,'y')}` : ''
  const rel = rels.length===1 ? ` de nuestros servicios profesionales en relación a ${rels[0]}` : ' de nuestros servicios profesionales'
  return `Espero que estén muy bien. Adjuntamos las facturas ${foliosStr}${pagos}${rel}, por un total de ${fmtN(total)}.${cierre}`
}

// Recordatorio de saldo pendiente: las OTRAS facturas Pendiente/Vencido del mismo cliente (excluye las que van en ESTE correo).
// FUENTE ÚNICA (modal de factura + envío masivo). Distingue factura completa vs saldo parcial. Devuelve '' si no hay nada pendiente.
export function saldoPendienteMsg(clientId, excludeIds, billing, lang){
  const ex = excludeIds instanceof Set ? excludeIds : new Set((excludeIds||[]).map(String))
  const otras = (billing||[]).filter(b=>String(b.client_id)===String(clientId||'') && !ex.has(String(b.id)) && !b.deleted_at && (b.billing_type||'')!=='reembolso' && ['Pendiente','Vencido'].includes(b.status)).map(b=>({b,saldo:saldoBill(b)})).filter(x=>x.saldo>0).sort((a,z)=>String(a.b.due||'').localeCompare(String(z.b.due||'')))
  if(!otras.length) return ''
  const total = otras.reduce((a,x)=>a+x.saldo,0)
  const totalDe = b => (b.dte_xml?dteMontoTotal(b.dte_xml):null) ?? (b.amount||0)
  const esParcial = x => x.saldo < Math.round(totalDe(x.b)) - 1   // saldo menor al total emitido = pago parcial
  const fol = x => `N° ${folioN(x.b.invoice_no)||x.b.invoice_no||'—'}`
  if(otras.length===1){
    const x=otras[0], parc=esParcial(x), m=fmtN(x.saldo)
    if(lang==='en') return parc
      ? `We would also like to note that, according to our records, an outstanding balance of ${m} on invoice ${fol(x)} remains pending. If it has already been paid, please disregard this note.`
      : `We would also like to note that, according to our records, invoice ${fol(x)} for ${m} remains outstanding. If it has already been paid, please disregard this note.`
    return parc
      ? `Aprovechamos de comentarles que, según nuestros registros, aún figura pendiente de pago un saldo de ${m} de la factura ${fol(x)}. Si ya fue pagado, por favor omitan este comentario.`
      : `Aprovechamos de comentarles que, según nuestros registros, la factura ${fol(x)} por ${m} aún figura pendiente de pago. Si ya fue pagada, por favor omitan este comentario.`
  }
  const listaEs = otras.map(x=>`${fol(x)} por ${fmtN(x.saldo)}${esParcial(x)?' (saldo)':''}`).join(', ')
  const listaEn = otras.map(x=>`${fol(x)} for ${fmtN(x.saldo)}${esParcial(x)?' (balance)':''}`).join(', ')
  if(lang==='en') return `We would also like to note that, according to our records, the following remain outstanding: ${listaEn}, totaling ${fmtN(total)}. If they have already been paid, please disregard this note.`
  return `Aprovechamos de comentarles que, según nuestros registros, aún figuran pendientes de pago: ${listaEs}, por un total de ${fmtN(total)}. Si ya fueron pagadas, por favor omitan este comentario.`
}

export function FacturaEmailModal({factura, facturas, sales=[], client, user, sale, billing=[], onSent, onClose, asPage=false}) {
  const myEmail=(user?.email||'').toLowerCase()
  const listF=(facturas&&facturas.length)?facturas:[factura]   // 1 o VARIAS facturas del MISMO cliente en un solo correo
  const multi=listF.length>1
  // Venta/proyecto MÁS ROBUSTO por factura: la vinculada, o la del cliente si no hay vínculo directo.
  const saleR=mejorVenta(factura, sales, client?.id) || sale
  const saleOf=f=>mejorVenta(f, sales, f.client_id||client?.id) || (String(f.id)===String(factura.id)?saleR:null)
  // genBody usa amountOf (monto real del DTE cuando ya se generó el PDF; si no, el del sistema). Solo se llama en efectos (amountOf ya existe).
  const genBody=lg=> multi ? facturaCorreoBodyMulti(listF, saleOf, lg, amountOf, true) : facturaCorreoBody({...factura,amount:amountOf(factura)}, saleR, lg, true)   // sinCierre: la despedida la agrega cuerpoFull al final
  const folio=folioN(factura.invoice_no||'')||factura.invoice_no||''
  const foliosMulti=listF.map(f=>folioN(f.invoice_no||'')||f.invoice_no||'').filter(Boolean)
  const concept=(factura.concept||'').trim()
  const proyecto=ventaNombre(saleR)   // nombre de la venta/proyecto (más robusto: vinculada o la del cliente) = descripción real del servicio
  const esRecurrente=/cuota\s*\d+\s*\/\s*\d+/i.test(concept)||/mensual|recurrente/i.test(concept)
  // En recurrentes el concepto es "Cuota 3/12" (no le sirve al cliente) → usar el proyecto; en puntuales el concepto suele ser la glosa real.
  const glosa=esRecurrente?(proyecto||concept):(concept||proyecto)
  const [para,setPara]=useState(client?.email||'')
  const [cc,setCc]=useState([]); const [ccInput,setCcInput]=useState('')
  const [contacts,setContacts]=useState([])
  const [firma,setFirma]=useState(firmaDefault(myEmail)||{nombre:user?.name||'',cargo:'Abogado',telefono:''})
  const glosaFac=facturaGlosa(factura, saleR)   // misma glosa que el cuerpo (proyecto o glosa de la factura, sin "cuota N/M")
  const [asunto,setAsunto]=useState(multi ? `Facturas N° ${foliosMulti.join(' y ')} | ${client?.name||''}` : `Factura ${folio}${glosaFac?` | ${glosaFac}`:(client?.name?` | ${client.name}`:'')}`)   // número | glosa de la factura (separador | en el asunto, por pedido del usuario)
  const [lang,setLang]=useState('es')   // idioma del correo: 'es' | 'en'
  const [body,setBody]=useState(multi ? facturaCorreoBodyMulti(listF, saleOf, 'es', undefined, true) : facturaCorreoBody(factura, saleR, 'es', true))
  const [saludo,setSaludo]=useState('Estimados,')     // saludo del correo (se adapta a hombre/mujer/varios/idioma)
  const [saludoAuto,setSaludoAuto]=useState(true)      // mientras no lo edites a mano, se recalcula solo
  const [pdf,setPdf]=useState(null)
  const [pdfErr,setPdfErr]=useState(null)   // por qué no se pudo auto-generar el PDF del DTE (para no fallar en silencio)
  const [atts,setAtts]=useState([])   // adjuntos cuando es multi (un PDF por factura)
  const [extras,setExtras]=useState([])   // documentos adicionales que adjunta el usuario (cualquier tipo), se envían JUNTO a la factura
  const [dteTotals,setDteTotals]=useState(()=>{ const m={}; listF.forEach(f=>{ if(f.dte_xml){ const t=dteMontoTotal(f.dte_xml); if(t!=null) m[f.id]=t } }); return m })   // id factura → MntTotal REAL del DTE (autoridad = el DTE); prima sobre amount del sistema (programado)
  const amountOf=f=>{ const t=dteTotals[f?.id]; return (t!=null)?t:(f?.amount||0) }
  // Aprender la frase editada: se guarda como PLANTILLA con tokens {folios}/{total} (lo que cambia entre envíos), por cliente + (una|varias) + idioma.
  // Al reabrir para ese cliente, se reexpande con los folios/total actuales → tu redacción se reusa siempre con las cifras correctas.
  const learnedTpl=useRef({})
  const _listJoin=(a,y)=>a.length<=1?(a[0]||''):a.slice(0,-1).join(', ')+` ${y} `+a[a.length-1]
  const _dynFolios=lg=> multi ? 'N° '+_listJoin([...listF].sort((a,b)=> String(a.issued_at||a.due||'').localeCompare(String(b.issued_at||b.due||'')) || String(folioN(a.invoice_no||'')).localeCompare(String(folioN(b.invoice_no||'')),undefined,{numeric:true})).map(f=>folioN(f.invoice_no||'')||f.invoice_no||''), lg==='en'?'and':'y') : ('N° '+folio)
  const _dynTotal=()=> fmtN(listF.reduce((a,f)=>a+amountOf(f),0))
  const _dynPeriodo=()=> multi ? '' : String((facturaGlosaPartes(factura, saleR)||{}).detalle||'')   // mes/cuota de ESTA factura ("Septiembre 2026", "Pago 7 de 10"): variable, NO se congela
  // La base se guarda por cliente + PROYECTO (una cuota nueva del mismo proyecto reusa tu última redacción; otro proyecto tiene la suya). Multi queda a nivel cliente.
  const msgKey=lg=> multi ? `${client?.id}:n:${lg}` : `${client?.id}:p${saleR?.id||'0'}:${lg}`
  const _tok=(t,lg)=>{ let s=String(t).split(_dynFolios(lg)).join('{folios}').split(_dynTotal()).join('{total}'); const per=_dynPeriodo(); if(per&&per.length>=4) s=s.split(per).join('{periodo}'); return s }
  const _untok=(t,lg)=>{ let s=String(t).split('{folios}').join(_dynFolios(lg)).split('{total}').join(_dynTotal()); const per=_dynPeriodo(); return s.split('{periodo}').join(per) }
  const applyDefaultBody=lg=>{ const tpl=learnedTpl.current[lg]; setBody(tpl?_untok(tpl,lg):genBody(lg)) }
  // Abre el PDF (base64) en una pestaña para previsualizarlo antes de enviar.
  const verPdf=(base64,nombre)=>{ try{ const bin=atob(base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); const url=URL.createObjectURL(new Blob([u8],{type:'application/pdf'})); window.open(url,'_blank'); setTimeout(()=>URL.revokeObjectURL(url),60000) }catch(_){ appAlert('No se pudo abrir el PDF.') } }
  const [incPago,setIncPago]=useState(false)   // incluir datos de transferencia en el correo
  const [recordarSaldo,setRecordarSaldo]=useState(false)   // recordar otro saldo pendiente del cliente (opcional)
  const [pedirFondo,setPedirFondo]=useState(false)   // solicitar por primera vez la provisión de un fondo por rendir
  const [fondoMonto,setFondoMonto]=useState('')      // monto sugerido del fondo (opcional)
  const [ctaGastos,setCtaGastos]=useState(CUENTA_GASTOS_DEFAULT)   // datos de la cuenta destinada a gastos (editable, se recuerda)
  const [saldoMsg,setSaldoMsg]=useState('')          // texto EDITABLE del recordatorio de saldo (se regenera solo hasta que lo tocas)
  const [fondoMsg,setFondoMsg]=useState('')          // texto EDITABLE de la solicitud de fondo
  const saldoTocado=useRef(false); const fondoTocado=useRef(false)
  const [sending,setSending]=useState(false)
  const bodyTocado=useRef(false)
  // Saldo pendiente del cliente en OTRAS facturas (excluye esta, reembolsos y ya pagadas). Fuente única saldoBill.
  // Facturas del cliente con saldo pendiente (excluye esta/estas, reembolsos y ya pagadas). El sistema SÍ sabe cuáles son → se citan por folio.
  const otrasPendientes = useMemo(()=> (billing||[]).filter(b=>String(b.client_id)===String(client?.id||'') && !listF.some(f=>String(f.id)===String(b.id)) && !b.deleted_at && (b.billing_type||'')!=='reembolso' && ['Pendiente','Vencido'].includes(b.status)).map(b=>({b,saldo:saldoBill(b)})).filter(x=>x.saldo>0).sort((a,z)=>String(a.b.due||'').localeCompare(String(z.b.due||''))), [billing,client,factura,facturas])
  const otroSaldo = otrasPendientes.reduce((a,x)=>a+x.saldo,0)
  const saludoEnDe = name => esPersona(name) ? `Dear ${(name||'').trim().split(/\s+/)[0]}` : 'Dear Sir or Madam'
  // Nombre del destinatario (el contacto que calza con "Para", o el cliente). Con eso, si hay varios y el idioma, arma el saludo.
  const destNombre = useMemo(()=>{ const c=(contacts||[]).find(x=>(x.email||'').toLowerCase()===(para||'').toLowerCase()); return (c&&c.nombre)||client?.name||'' },[contacts,para,client])
  useEffect(()=>{ if(!saludoAuto) return; const multi=cc.length>0; setSaludo(lang==='en' ? (multi?'Dear Sir or Madam,':saludoEnDe(destNombre)+',') : (multi?'Estimados,':saludoCli(destNombre)+',')) },[saludoAuto,cc.length,destNombre,lang])
  // Al cambiar de idioma, regenera el cuerpo con la plantilla del idioma (salvo que lo hayas editado a mano).
  useEffect(()=>{ if(!bodyTocado.current) applyDefaultBody(lang) },[lang])
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email,principal').eq('client_id',client.id).then(({data})=>{ if(alive) setContacts((data||[]).filter(c=>c.email)) },()=>{})
    supabase.from('learnings').select('value').eq('kind','factura_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(p=>[...new Set([...p,...ems])]) } },()=>{})
    supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data&&data.value) setPara(String(data.value).trim()) },()=>{})   // destinatario de facturas aprendido (prima sobre client.email)
    return ()=>{alive=false} },[client?.id])
  useEffect(()=>{ let alive=true; supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ setFirma(p=>({...p,...JSON.parse(data.value)})) }catch(_){} } },()=>{}); return ()=>{alive=false} },[myEmail])
  useEffect(()=>{ let alive=true; supabase.from('learnings').select('value').eq('kind','cuenta_gastos').eq('key','estudio').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data&&data.value){ try{ setCtaGastos(p=>({...p,...JSON.parse(data.value)})) }catch(_){} } },()=>{}); return ()=>{alive=false} },[])   // cuenta de gastos recordada (la ingresas una vez)
  const addCc=em=>{ const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(p=>[...p,e]); setCcInput('') }
  const removeCc=em=>setCc(p=>p.filter(x=>x!==em))
  const onFile=f=>{ if(!f) return; const r=new FileReader(); r.onload=()=>{ const b=String(r.result||'').split(',')[1]||''; setPdf({name:f.name,base64:b}) }; r.readAsDataURL(f) }
  // Documentos adicionales: cualquier tipo (contrato, mandato, comprobante, etc.). Se acumulan y viajan como adjuntos del correo, junto al PDF del DTE.
  const MAX_ADJ=18*1024*1024   // ~18 MB en total (headroom bajo el límite de 25 MB de Gmail)
  const onExtras=fileList=>{ const files=Array.from(fileList||[]); files.forEach(f=>{ const r=new FileReader(); r.onload=()=>{ const b=String(r.result||'').split(',')[1]||''; setExtras(p=>{ if(p.some(x=>x.name===f.name&&x.size===f.size)) return p; if(p.reduce((a,x)=>a+(x.size||0),0)+f.size>MAX_ADJ){ appAlert(`"${f.name}" no cabe: los adjuntos adicionales superan ~18 MB en total.`); return p } return [...p,{name:f.name,base64:b,mime:f.type||'application/octet-stream',size:f.size}] }) }; r.readAsDataURL(f) }) }
  const removeExtra=(name,size)=>setExtras(p=>p.filter(x=>!(x.name===name&&x.size===size)))
  const fmtBytes=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB'
  // Si la factura se emitió por el SII (tiene dte_xml), adjunta el PDF oficial con timbre automáticamente. (solo modo individual)
  useEffect(()=>{ if(multi||!factura?.dte_xml) return; let alive=true; (async()=>{ try{ const doc=splitSetDTE(factura.dte_xml)[0]; if(!doc){ if(alive) setPdfErr('El XML guardado no contiene el documento (<Documento>). Vuelve a cargar el XML del SII.'); return } const r=await facturaDtePdfBase64(doc); if(alive){ setPdf({name:`Factura ${folio||r.folio}.pdf`,base64:r.base64,auto:true}); setPdfErr(null); if(r.total!=null) setDteTotals(m=>({...m,[factura.id]:r.total})) } }catch(e){ if(alive) setPdfErr(e.message||'No se pudo generar el PDF del DTE.') } })(); return ()=>{alive=false} },[])
  // Multi: genera el PDF con timbre de CADA factura, los adjunta todos y guarda su total real.
  useEffect(()=>{ if(!multi) return; let alive=true; (async()=>{ const out=[]; const tot={}; for(const f of listF){ if(!f.dte_xml) continue; try{ const doc=splitSetDTE(f.dte_xml)[0]; if(!doc) continue; const r=await facturaDtePdfBase64(doc); out.push({id:f.id,base64:r.base64,name:`Factura ${folioN(f.invoice_no)||r.folio}.pdf`,mime:'application/pdf'}); if(r.total!=null) tot[f.id]=r.total }catch(_){} } if(alive){ setAtts(out); setDteTotals(m=>({...m,...tot})) } })(); return ()=>{alive=false} },[])
  // Cuando llega el monto real del DTE, regenera el cuerpo (salvo que lo hayas editado a mano) para que el correo coincida con el PDF.
  useEffect(()=>{ if(!bodyTocado.current) applyDefaultBody(lang) },[dteTotals])
  // Carga la plantilla aprendida del cliente (una|varias · idioma) y, si no la editaste, la aplica con los folios/total actuales.
  useEffect(()=>{ if(!client?.id) return; let alive=true
    ;['es','en'].forEach(lg=>{ supabase.from('learnings').select('value').eq('kind','factura_msg').eq('key',msgKey(lg)).maybeSingle().then(({data})=>{ if(!alive||!data?.value) return; learnedTpl.current[lg]=data.value; if(lg===lang&&!bodyTocado.current) setBody(_untok(data.value,lg)) },()=>{}) })
    return ()=>{alive=false} },[client?.id])
  const [iaBusy,setIaBusy]=useState(false)
  // ✦ Redactar con IA: pule SOLO la prosa (glosa cruda → frase natural). Folio y monto van como dato exacto, la IA no los altera. Sin vencimiento.
  const redactarIA=async()=>{ setIaBusy(true)
    try{
      const prompt = lang==='en'
        ? `You are an assistant at a Chilean law firm (${BRAND.nombre}). Write the BODY of a formal, cordial email (professional English) to send an invoice to a client.\nEXACT data, do not alter or round:\n- Invoice No.: ${folio}\n- Amount: ${fmtN(amountOf(factura))}\n- Project/service: ${proyecto||'—'}\n- Detail/concept: ${concept||'—'}${esRecurrente?'\n- It is a RECURRING service (monthly fee): describe it as the advisory/service of the project for the period, NEVER as "installment N/M".':''}\nRules: state the invoice number and amount verbatim; describe the service from the project and concept, naturally and professionally; do NOT mention due dates or payment terms; do NOT include a greeting (no "Dear …"), a signature, or a closing line (the closing is added separately). Return ONLY the 1-2 paragraphs of the message body.`
        : `Eres asistente de un estudio de abogados chileno (${BRAND.nombre}). Redacta el CUERPO de un correo formal y cordial (trato "ustedes", español de Chile) para enviarle una factura a un cliente.\nDatos EXACTOS, respétalos sin alterar ni redondear:\n- Factura N°: ${folio}\n- Monto: ${fmtN(amountOf(factura))}\n- Proyecto/servicio: ${proyecto||'—'}\n- Detalle/concepto: ${concept||'—'}${esRecurrente?'\n- Es un servicio RECURRENTE (cuota/mensualidad): descríbelo como la asesoría/servicio del proyecto correspondiente al período, NUNCA como "cuota N/M".':''}\nReglas: nombra el N° de factura y el monto tal cual; describe el servicio a partir del proyecto y el concepto, de forma natural y profesional (no copies literal una glosa abreviada); NO menciones vencimiento ni plazos de pago; NO incluyas saludo (nada de "Estimados…"), firma NI despedida (la despedida se agrega aparte). Devuelve SOLO el cuerpo (1 o 2 párrafos del mensaje).`
      const data=await claudeCall({model:'claude-opus-4-8',max_tokens:400,messages:[{role:'user',content:prompt}]})
      const txt=(data.content?.[0]?.text||'').trim()
      if(txt){ bodyTocado.current=true; setBody(txt) }
    }catch(e){ appAlert('No se pudo redactar: '+(e?.message||e)) }
    setIaBusy(false) }
  // Texto por defecto del recordatorio de saldo (sin salto inicial). Cita las facturas pendientes por folio.
  const genSaldoMsg=(lg)=> otroSaldo>0 ? saldoPendienteMsg(client?.id, new Set(listF.map(f=>String(f.id))), billing, lg) : ''
  const genFondoMsg=(lg)=> lg==='en'
    ? `Additionally, we request an expense fund (fondo por rendir)${fondoMonto?` of ${fmtN(+fondoMonto||0)}`:''}, intended for notarial and other related expenses, which will be duly accounted for. You may transfer to the account below.`
    : `Asimismo, solicitamos la provisión de un fondo por rendir${fondoMonto?` por ${fmtN(+fondoMonto||0)}`:''}, destinado a gastos notariales, entre otros, el cual será debidamente rendido. Puede transferir a la cuenta indicada a continuación.`
  // Regeneran el texto por defecto mientras no lo edites a mano (saldoTocado/fondoTocado).
  useEffect(()=>{ if(!saldoTocado.current) setSaldoMsg(genSaldoMsg(lang)) },[lang,otroSaldo,otrasPendientes.length])
  useEffect(()=>{ if(!fondoTocado.current) setFondoMsg(genFondoMsg(lang)) },[lang,fondoMonto])
  // Encabezados de los recuadros de cuenta + la mención al incluir la cuenta de honorarios (se envía por primera vez).
  const H_PAGO = lang==='en'?'Account for the invoice payment':'Cuenta para el pago de la factura'
  const H_FONDO = lang==='en'?'Account for the expense fund':'Cuenta para el fondo de gastos'
  const pagoFrase = () => lang==='en'
    ? 'For the payment of our fees, you may transfer to the current account below.'
    : 'Para el pago de nuestros honorarios, puede transferir a la cuenta corriente que se indica a continuación.'
  // Segmentos del cuerpo EN ORDEN: mensaje, (recordatorio), (frase pago + cuenta honorarios), (frase fondo + cuenta gastos), despedida.
  // Cada segmento es texto {t} o un recuadro HTML {h}. Así cada cuenta va JUSTO DESPUÉS de su frase, y la despedida al final.
  const segmentos = () => {
    const s = [{t:body}]
    if(recordarSaldo && otroSaldo>0 && saldoMsg.trim()) s.push({t:saldoMsg.trim()})
    if(incPago){ s.push({t:pagoFrase()}); s.push({t:cuentaTxt(H_PAGO,CUENTA_HONORARIOS), h:cuentaHtml(H_PAGO,CUENTA_HONORARIOS)}) }
    if(pedirFondo){ if(fondoMsg.trim()) s.push({t:fondoMsg.trim()}); s.push({t:cuentaTxt(H_FONDO,ctaGastos), h:cuentaHtml(H_FONDO,ctaGastos,true)}) }
    s.push({t:CORREO_DESPEDIDA(lang)})
    return s
  }
  const _saludosCierre = lang==='en'?'Best regards,':'Saludos,'
  const cuerpoFull=()=>`${saludo}\n\n${segmentos().map(x=>x.t).join('\n\n')}\n\n${_saludosCierre}\n${firma?.nombre||user?.name||''}`   // texto plano: cierra con Saludos, + nombre
  const buildHtml=()=>facturaCorreoShell(`${_correoToP(saludo)}${segmentos().map(x=>x.h?x.h:_correoToP(x.t)).join('')}${_correoToP(_saludosCierre)}`, firma, lang)   // HTML: 'Saludos,' y debajo la firma (que trae el nombre)
  const enviar=async()=>{
    if(!para.trim()){ appAlert('Falta el destinatario.'); return }
    setSending(true)
    try{
      const baseAdj = multi ? atts.map(a=>({base64:a.base64,name:a.name,mime:a.mime})) : (pdf?[{base64:pdf.base64,name:pdf.name,mime:'application/pdf'}]:[])
      const adjuntos = [...baseAdj, ...extras.map(a=>({base64:a.base64,name:a.name,mime:a.mime}))]   // factura(s) + documentos adicionales
      const bodyTxt=cuerpoFull()   // ya incluye las cuentas (segmentos), en el orden correcto
      if(pedirFondo){ try{ await setLearningKV('cuenta_gastos','estudio',JSON.stringify(ctaGastos)) }catch(e){registrarError({origen:'accion',vista:'cuenta_gastos',err:e})} }   // recuerda la cuenta de gastos ingresada
      // La factura sale SIEMPRE desde el correo del usuario. Si su Gmail venció, NO cae a la oficina: se le pide reentrar y reintentar (control sobre el remitente).
      const via = await enviarComoUsuario({to:para.trim(),cc:cc.join(','),subject:asunto,html:buildHtml(),text:bodyTxt,attachments:adjuntos, soloUsuario:true, que:'La factura'})
      if(via==='reauth'){ setSending(false); return }   // el aviso «NO se envió» + reingreso lo da enviarComoUsuario
      if(via===null){ setSending(false); return }
      const viaServer = via==='oficina'
      if(cc.length) try{ await setLearningKV('factura_cc',String(client.id),cc.join(',')) }catch(e){registrarError({origen:'accion',vista:'factura_cc',err:e})}
      if(para.trim()&&client?.id) try{ await setLearningKV('factura_to',String(client.id),para.trim()) }catch(e){registrarError({origen:'accion',vista:'factura_to',err:e})}   // aprende el destinatario de facturas de este cliente
      if(client?.id) try{ await setLearningKV('factura_msg',msgKey(lang),_tok(body,lang)) }catch(e){registrarError({origen:'accion',vista:'factura_msg',err:e})}   // la base del próximo envío = este (último enviado), por cliente+proyecto; tokens {folios}/{total}/{periodo} se refrescan
      // Guarda a los destinatarios (Para + CC) como PERSONAS del cliente si son nuevos, para que queden en la ficha
      // (no repetir: la app aprende quién recibe facturas). No pisa contactos existentes.
      if(client?.id){ try{
        const yaMails=new Set((contacts||[]).map(c=>(c.email||'').toLowerCase()))
        const nuevos=[para.trim(),...cc].map(e=>e.trim()).filter(e=>e&&e.includes('@')&&!esCorreoOficina(e)&&!yaMails.has(e.toLowerCase()))
        const dedup=[...new Set(nuevos.map(e=>e.toLowerCase()))]
        if(dedup.length){ const {data:ins}=await supabase.from('contacts').insert(dedup.map(e=>({client_id:client.id,nombre:e.split('@')[0],email:e}))).select(); if(ins) setContacts(p=>[...p,...ins]) }
      }catch(e){registrarError({origen:'accion',vista:'contacts',err:e})} }
      const at=new Date().toISOString()
      for(const f of listF){ try{ okDB(await supabase.from('billing').update({email_sent_at:at}).eq('id',f.id),'marcar la factura como enviada') }catch(e){registrarError({origen:'accion',vista:'billing',err:e})}; onSent&&onSent(f.id,at) }
      appAlert(txtEnviado(via,{que:multi?`${listF.length} facturas`:'Factura', g:multi?'as':'a', para:[para.trim(),...cc].filter(Boolean).join(', ')})); onClose()
    }catch(e){ appAlert(txtNoEnviado('La factura', e.message||String(e))) }
    setSending(false)
  }
  const fInp={width:'100%',padding:'9px 11px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,boxSizing:'border-box'}
  const lbl={fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}
  const isDesktop = useIsDesktop()   // escritorio: dos columnas (redacción | panel de envío); móvil: una sola columna (idéntico)
  const _body = (<>
    <div style={{display:'grid',gridTemplateColumns:isDesktop?'1.35fr 1fr':'1fr',gap:isDesktop?20:10,alignItems:'start'}}>
      <div style={{display:'flex',flexDirection:'column',gap:10,minWidth:0}}>
      <div><div style={lbl}>PARA</div><input value={para} onChange={e=>setPara(e.target.value)} placeholder='correo@cliente.cl' style={fInp}/>
        {contacts.length>0&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:5}}>{[...contacts].sort((a,b)=>{ const ta=(a.email||'').toLowerCase()===(para||'').toLowerCase(), tb=(b.email||'').toLowerCase()===(para||'').toLowerCase(); return (tb-ta)||((b.principal?1:0)-(a.principal?1:0)) }).map(c=>{ const isTo=(c.email||'').toLowerCase()===(para||'').toLowerCase(); return <button key={c.email} type='button' title={c.email} onClick={()=>{ if(isTo) return; if(!para.trim()) setPara(c.email); else addCc(c.email) }} style={{fontSize:10,border:isTo?`0.5px solid ${C.accent}`:`0.5px solid ${C.border}`,background:isTo?C.accent:'#fff',color:isTo?'#fff':C.accent,borderRadius:20,padding:'2px 9px',cursor:isTo?'default':'pointer'}}>{isTo?<><Gl n='tick'/>{" "}</>:''}{c.nombre||c.email}</button> })}</div>}
      </div>
      <div><div style={lbl}>CC</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>{cc.map(e=><span key={e} style={{fontSize:10,background:C.azulBg,color:C.accent,borderRadius:20,padding:'2px 4px 2px 9px',display:'inline-flex',alignItems:'center'}}>{e}<button type='button' onClick={()=>removeCc(e)} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontWeight:700,padding:'0 4px'}}><Gl n='x'/></button></span>)}
          <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addCc(ccInput) } }} onBlur={()=>addCc(ccInput)} placeholder='+ correo' style={{flex:1,minWidth:90,padding:'6px 8px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/></div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <span style={{fontSize:10,color:C.muted,fontWeight:600}}>IDIOMA</span>
        <span style={{display:'inline-flex',borderRadius:20,overflow:'hidden',background:C.bgSoft}}>{[['es','Español'],['en','English']].map(([v,l])=><button key={v} type='button' onClick={()=>setLang(v)} style={{fontSize:11,fontWeight:600,padding:'3px 13px',border:'none',cursor:'pointer',background:lang===v?C.accent:'transparent',color:lang===v?'#fff':C.muted}}>{l}</button>)}</span>
      </div>
      <div><div style={lbl}>ASUNTO</div><input value={asunto} onChange={e=>setAsunto(e.target.value)} style={fInp}/></div>
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3,gap:8}}>
          <span style={{fontSize:10,color:C.muted,fontWeight:600}}>SALUDO</span>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{(()=>{ const n1=(destNombre||'').trim().split(/\s+/)[0]; const opt=lang==='en'?[[n1?`Dear ${n1}`:'Dear', n1?`Dear ${n1},`:'Dear,'],['Sir/Madam','Dear Sir or Madam,']]:[['Estimado', n1?`Estimado ${n1},`:'Estimado,'],['Estimada', n1?`Estimada ${n1},`:'Estimada,'],['Estimados','Estimados,'],['Estimadas','Estimadas,']]; return opt.map(([l,v])=><button key={l} type='button' onClick={()=>{setSaludoAuto(false);setSaludo(v)}} style={{fontSize:10,fontWeight:600,borderRadius:20,padding:'2px 9px',border:'none',cursor:'pointer',background:saludo===v?C.accent:C.bgSoft,color:saludo===v?'#fff':C.muted}}>{l}</button>) })()}</div>
        </div>
        <input value={saludo} onChange={e=>{setSaludoAuto(false);setSaludo(e.target.value)}} style={fInp}/>
      </div>
      <div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:3}}>
          <span style={{fontSize:10,color:C.muted,fontWeight:600}}>MENSAJE</span>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button type='button' onClick={()=>{ bodyTocado.current=false; setBody(genBody(lang)) }} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>↺ texto sugerido</button>
            {!multi&&<button type='button' disabled={iaBusy} onClick={redactarIA} style={{fontSize:10,color:C.coralText,background:C.ambarBg,border:'none',borderRadius:20,padding:'3px 10px',fontWeight:600,cursor:iaBusy?'default':'pointer'}}>{iaBusy?'Redactando…':<><Sparkle/> Redactar con IA</>}</button>}
          </div>
        </div>
        <textarea value={body} onChange={e=>{bodyTocado.current=true;setBody(e.target.value)}} rows={11} style={{...fInp,minHeight:isDesktop?280:210,lineHeight:1.6,resize:'vertical',fontFamily:'inherit'}}/>
      </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10,minWidth:0}}>
      <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type='checkbox' checked={incPago} onChange={e=>setIncPago(e.target.checked)} style={{cursor:'pointer'}}/><span style={{fontSize:12,color:C.text}}>{lang==='en'?'Include payment (bank transfer) details':'Incluir datos de pago (transferencia)'}</span></label>
      {otroSaldo>0&&<div>
        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type='checkbox' checked={recordarSaldo} onChange={e=>setRecordarSaldo(e.target.checked)} style={{cursor:'pointer'}}/><span style={{fontSize:12,color:C.text}}>{lang==='en'?`Remind outstanding balance (${otrasPendientes.length} invoice${otrasPendientes.length>1?'s':''} · ${fmtN(otroSaldo)})`:`Recordar saldo pendiente (${otrasPendientes.length} factura${otrasPendientes.length>1?'s':''} · ${fmtN(otroSaldo)})`}</span></label>
        {recordarSaldo&&<div style={{marginTop:5}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}><span style={{fontSize:10,color:C.muted}}>Puedes editar este texto</span>{saldoTocado.current&&<button type='button' onClick={()=>{saldoTocado.current=false;setSaldoMsg(genSaldoMsg(lang))}} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>↺ texto por defecto</button>}</div>
          <textarea value={saldoMsg} onChange={e=>{saldoTocado.current=true;setSaldoMsg(e.target.value)}} rows={3} style={{...fInp,fontSize:12,resize:'vertical',fontFamily:'inherit'}}/>
        </div>}
      </div>}
      <div>
        <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type='checkbox' checked={pedirFondo} onChange={e=>setPedirFondo(e.target.checked)} style={{cursor:'pointer'}}/><span style={{fontSize:12,color:C.text}}>{lang==='en'?'Request an expense fund (fondo por rendir)':'Solicitar provisión de fondo por rendir'}</span></label>
        {pedirFondo&&(()=>{ const up=(k,v)=>setCtaGastos(p=>({...p,[k]:v})); const gi={...fInp,padding:'7px 9px',fontSize:12}; return (
          <div style={{marginTop:7,padding:'10px 11px',background:C.ambarBg,border:`1px solid ${C.soon}`,borderRadius:10,display:'flex',flexDirection:'column',gap:7}}>
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}><span style={{fontSize:10,color:C.soonText,fontWeight:600}}>Texto de la solicitud (editable)</span>{fondoTocado.current&&<button type='button' onClick={()=>{fondoTocado.current=false;setFondoMsg(genFondoMsg(lang))}} style={{fontSize:10,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>↺ por defecto</button>}</div>
              <textarea value={fondoMsg} onChange={e=>{fondoTocado.current=true;setFondoMsg(e.target.value)}} rows={2} style={{...gi,width:'100%',boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}}/>
            </div>
            <div style={{fontSize:10,color:C.soonText,fontWeight:600}}>Cuenta destinada a gastos (se recuerda para la próxima)</div>
            <div style={{display:'flex',gap:7}}>
              <input value={ctaGastos.banco} onChange={e=>up('banco',e.target.value)} placeholder='Banco' style={{...gi,flex:1}}/>
              <input value={ctaGastos.cuenta} onChange={e=>up('cuenta',e.target.value)} placeholder='N° cuenta corriente' style={{...gi,flex:1}}/>
            </div>
            <div style={{display:'flex',gap:7}}>
              <input value={ctaGastos.razon} onChange={e=>up('razon',e.target.value)} placeholder='Razón social' style={{...gi,flex:2}}/>
              <input value={ctaGastos.rut} onChange={e=>up('rut',e.target.value)} placeholder='RUT' style={{...gi,flex:1}}/>
            </div>
            <div style={{display:'flex',gap:7}}>
              <input value={ctaGastos.email} onChange={e=>up('email',e.target.value)} placeholder='Email confirmación' style={{...gi,flex:2}}/>
              <input value={fondoMonto} onChange={e=>setFondoMonto(e.target.value.replace(/[^\d]/g,''))} placeholder='Monto (opcional)' inputMode='numeric' style={{...gi,flex:1}}/>
            </div>
          </div>
        )})()}
      </div>
      <div><div style={lbl}>{multi?`PDF DE LAS ${listF.length} FACTURAS (DTE con timbre)`:'PDF DE LA FACTURA (DTE con timbre)'}</div>
        {multi
          ? (atts.length?<div style={{display:'flex',flexWrap:'wrap',gap:6}}>{atts.map(a=><button key={a.name} type='button' onClick={()=>verPdf(a.base64,a.name)} title='Ver PDF' style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:11,color:C.greenText,background:C.greenBg,border:'none',borderRadius:8,padding:'5px 9px',cursor:'pointer'}}><span style={{fontWeight:600}}><Gl n='tick'/></span> {a.name} <span style={{color:C.accent,fontWeight:600}}>· Ver</span></button>)}</div>:<div style={{fontSize:11,color:C.muted}}>Generando los PDF con timbre…</div>)
          : (pdf? <div style={{display:'flex',alignItems:'center',gap:10,fontSize:12,flexWrap:'wrap'}}><span style={{color:C.greenText,fontWeight:600}}><Gl n='tick'/> {pdf.name}</span>{pdf.base64&&<button type='button' onClick={()=>verPdf(pdf.base64,pdf.name)} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:8,padding:'3px 11px',cursor:'pointer'}}>Ver PDF</button>}<button type='button' onClick={()=>setPdf(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer'}}>Quitar</button></div>
              : <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:C.accent,border:`1px dashed ${C.border}`,borderRadius:8,padding:'8px 12px',cursor:'pointer'}}>↑ Adjuntar PDF<input type='file' accept='application/pdf' onChange={e=>onFile(e.target.files?.[0])} style={{display:'none'}}/></label>)}
        {multi?<div style={{fontSize:9,color:C.greenText,marginTop:3}}>Un PDF por factura, con timbre, adjuntados automáticamente. Toca uno para verlo.</div>:pdf?.auto?<div style={{fontSize:9,color:C.greenText,marginTop:3}}>PDF oficial del DTE, adjuntado automáticamente.</div>:(!pdf&&pdfErr)?<div style={{fontSize:9,color:C.overdueText,marginTop:3}}>No pude generar el PDF con timbre: {pdfErr} Puedes adjuntarlo a mano.</div>:!factura?.dte_xml&&<div style={{fontSize:9,color:C.muted,marginTop:3}}>Adjunta el PDF de la factura.</div>}
      </div>
      <div><div style={lbl}>DOCUMENTOS ADICIONALES <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:C.muted}}>· opcional</span></div>
        {extras.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:6}}>{extras.map(a=><span key={a.name+a.size} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,color:C.accent,background:C.azulBg,borderRadius:8,padding:'5px 9px'}}>{a.name}{a.size?<span style={{color:C.muted}}>· {fmtBytes(a.size)}</span>:null}<button type='button' onClick={()=>removeExtra(a.name,a.size)} aria-label='Quitar' style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontWeight:700,padding:0,lineHeight:1,fontSize:14}}><Gl n='x'/></button></span>)}</div>}
        <label style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:12,color:C.accent,border:`1px dashed ${C.border}`,borderRadius:8,padding:'8px 12px',cursor:'pointer'}}>+ Adjuntar documento<input type='file' multiple onChange={e=>{onExtras(e.target.files); e.target.value=''}} style={{display:'none'}}/></label>
        <div style={{fontSize:9,color:C.muted,marginTop:3}}>Se envían junto a la factura (PDF, imágenes, Word, Excel).</div>
      </div>
      {/* Vista previa del correo — REPLEGADA por defecto (se abre a demanda); en vivo con cada opción. */}
      <details>
        <summary style={{...lbl,display:'flex',alignItems:'center',gap:6,cursor:'pointer',listStyle:'none'}}>VISTA PREVIA DEL CORREO <span style={{fontWeight:400,textTransform:'none',letterSpacing:0,color:C.muted}}><Gl n='chevD'/> tocar para ver</span>{(incPago||recordarSaldo||pedirFondo)&&<span style={{fontWeight:600,color:C.greenText}}>· en vivo</span>}</summary>
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,maxHeight:320,overflowY:'auto',background:C.bgSoft,padding:8,marginTop:6}}>
          <div style={{background:'#fff',borderRadius:6}} dangerouslySetInnerHTML={{__html:buildHtml()}}/>
        </div>
      </details>
      <button disabled={sending||!para.trim()} onClick={enviar} style={{marginTop:4,padding:11,borderRadius:10,border:'none',background:(!para.trim())?C.done:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:(!para.trim())?'default':'pointer'}}>{sending?(lang==='en'?'Sending…':'Enviando…'):(lang==='en'?(multi?`Send ${listF.length} invoices`:'Send invoice'):(multi?`Enviar las ${listF.length} facturas`:'Enviar factura'))}</button>
      </div>
    </div>
  </>)
  if(asPage) return _body   // página: el encabezado lo pone FlujoPagina ('‹ origen | Enviar factura | cliente')
  return (<Modal fullscreen fsMaxWidth={isDesktop?1080:880} title={<><span style={{color:C.accent}}>Enviar {multi?'facturas':'factura'}</span>{client?.name&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}{multi?` · ${listF.length}`:''}</span></>}</>} onClose={onClose}>{_body}</Modal>)
}

// Busca por nombre exacto dentro de una carpeta de Drive (con el token del usuario, misma vista que driveUpload).
// Sirve para deduplicar de verdad: si el archivo NO está (lo borraste), se vuelve a subir; si está, no se duplica.
export async function driveBuscarEnCarpeta(token, folderId, name){
  const q=encodeURIComponent(`name='${String(name).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' and '${folderId}' in parents and trashed=false`)
  const r=await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok) return []
  const d=await r.json().catch(()=>({})); return d.files||[]
}

// Mueve un archivo de Drive a otra carpeta (quita TODOS sus padres actuales y agrega el destino). Idempotente:
// si el único padre ya es el destino devuelve false (no hace nada). El fileId y su webViewLink NO cambian al mover.
export async function driveMover(token, fileId, destFolderId){
  if(!fileId||!destFolderId) return false
  const g=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,{headers:{Authorization:'Bearer '+token}})
  if(g.status===401) throw new DriveAuthError()
  if(!g.ok) throw new Error('Drive leer carpeta '+g.status)
  const parents=((await g.json()).parents)||[]
  if(parents.length===1 && parents[0]===destFolderId) return false
  const rm=parents.join(',')
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${destFolderId}${rm?`&removeParents=${encodeURIComponent(rm)}`:''}&fields=id&supportsAllDrives=true`,{
    method:'PATCH', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, body:'{}'
  })
  if(r.status===401) throw new DriveAuthError()
  if(!r.ok) throw new Error('Drive mover '+r.status)
  return true
}

