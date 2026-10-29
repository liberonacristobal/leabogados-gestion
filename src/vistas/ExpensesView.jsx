// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { supabase, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { notariaPendientes, disponibleNotaria } from '../../supabase/functions/_shared/notariaReglas.js'
import { sugerenciasDocumento, indiceNombres, rsBonita, repertoriosDoc } from '../../supabase/functions/_shared/notariaDocsReglas.js'
import { cuentaEnSaldo, fgCliente, gastosPorRendirCli, grupoRendir } from '../../supabase/functions/_shared/gastosReglas.js'
import { VENTA_REAL, glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { BRAND, C, Gl, SEC_LBL, SIcon, Spin, _normTxt, appAlert, appConfirm, appPrompt, diaGrande, fmt, fmtFechaDMY, fmtN, fmtRutCL, isoLocal, personChip, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, AsignarClienteInline, BackBtn, BitacoraLista, Buscador, CATS_DE_CLIENTE, CATS_LEGALES, CATS_OFICINA_NUEVAS, CAT_COLORS, CheckMini, ChipSearch, ClientePicker, DevolucionEmailModal, EQUIPO_CFG, FlujoPagina, HubTile, INICIALES_RESP, Inp, KpiIco, MESES, MES_C, Modal, MovIcon, MovilizacionView, NOMBRE_CLI, NOTA_DIRIGIDO, RENDCAT, RendicionEmailModal, RendicionModal, SOCIOS_CFG, SUBCATS_OFICINA, Switch, _DEMO_BANDEJA, _diasEntre, _esOfiCliR, _fechaISO, _mesLabelOf, _nombresMiembrosCache, alertasCajaChica, anularReembolsoDeRendicion, aprenderRS, avisoNoEnviado, bigDate, calceCajaChica, canonOtNN, catOficinaNueva, chipBtn, claudeCall, corrSiguiente, driveAdjuntosFolders, driveCall, driveGet, driveToken, driveUpload, enviarComoUsuario, equipoPorNombre, esCorreoOficina, esGestionGasto, estadoSolicitud, fmtDate, fmtMill, fmtSaldoG, fmtShort, fondoDeRend, glosaSinDetalle, learnPut, liquidacionPdfBase64, loadXLSXStyle, logActividad, lunesSemanaISO, mesCorto, mesTitulo, modoEnvioLote, movilizacionDatos, nombresMiembros, otConSello, pillPersonaSty, registrarFondoPropuesto, rendicionPdfHtml, resolverClienteSII, rsDisplay, rsLabel, saldoCajaChica, saldoCliente, titleCase, txtEnviado, txtResumenEnvio, usePersisted, usePersistedState, viewMemGuardar, viewMemLeer, registrarError } from '../lib/compartido.jsx'

// Igual que fmtDate pero para TIMESTAMPS completos (created_at/sent_at): usa la fecha LOCAL (Chile), no la UTC.
// fmtDate corta el ISO en UTC y correría el día en registros nocturnos; este respeta la hora local.
export const fmtFechaTS = ts => { if(!ts) return '—'; const d=new Date(ts); return isNaN(d)?'—':`${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}` }

// ── Correo a la notaría (liquidación de OT) — builder ÚNICO compartido por enviar y reenviar ──
// `mensaje` = borrador EDITABLE (prosa completa: saludo + intro + a nombre de quién van las boletas + cierre).
// El detalle de OT + total se anexa solo (es el dato, no editable). Así ambos flujos quedan en sync.
export function notaDefaultMsg(periodo, rs, rut){
  return `Estimados,\n\nEspero que estén muy bien. Adjuntamos el comprobante de la transferencia y el listado de las órdenes de trabajo (OT) que estamos pagando, correspondientes a ${periodo}, para que puedan eliminarlas de nuestra deuda. El mismo detalle va a continuación.\n\nLas boletas correspondientes deben emitirse a nombre de ${rs}, RUT ${rut}.\n\nQuedamos atentos a cualquier observación.\nSaludos cordiales,\n${BRAND.nombre}`
}

// Correos a la notaría sin guiones largos (pedido del usuario 19-10-2026): la glosa «X — Y» va como «X · Y».
export const sinRaya = s => String(s||'').replace(/\s*[—–]\s*/g,' · ').replace(/^ · | · $/g,'')

export function notaEmailHtml(mensaje, gs, total, clients){
  const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const prosa=esc(mensaje).replace(/\n/g,'<br>')
  const filas=(gs||[]).map(e=>{ const cn=(clients||[]).find(c=>c.id===e.client_id)?.name||'Sin cliente'; return `<tr><td style="padding:5px 0;font-size:11px;color:#185FA5;font-weight:600;white-space:nowrap">${esc(e.ot_number||'s/OT')}</td><td style="padding:5px 8px;font-size:12px;color:#3D3D3D">${esc(sinRaya(e.concept))} <span style="color:#99ABB4">· ${esc(cn)}</span></td><td style="padding:5px 0;font-size:12px;text-align:right;font-weight:600;white-space:nowrap">$${(e.amount||0).toLocaleString('es-CL')}</td></tr>` }).join('')
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${BRAND.logoUrl}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:14px;color:#3D3D3D;margin:0 0 16px;line-height:1.6">${prosa}</div><table style="width:100%;border-collapse:collapse"><tr style="border-bottom:1px solid #E4E8EB"><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0">OT</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 8px">Detalle</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0;text-align:right">Monto</td></tr>${filas}<tr style="border-top:1.5px solid #537281"><td colspan="2" style="padding:7px 0;font-size:13px;font-weight:bold">Total transferido</td><td style="padding:7px 0;font-size:13px;font-weight:bold;text-align:right">$${(total||0).toLocaleString('es-CL')}</td></tr></table></div><div style="padding:16px 28px;border-top:1px solid #eeeeee;font-size:11px;color:#999999">${BRAND.dominio} · ${BRAND.nombre}</div></div></body></html>`
}

export function notaEmailText(mensaje, gs, total){
  return String(mensaje||'')+'\n\nDETALLE:\n'+(gs||[]).map(e=>`• ${e.ot_number||'s/OT'} · ${sinRaya(e.concept)} · $${(e.amount||0).toLocaleString('es-CL')}`).join('\n')+'\n\nTotal transferido: $'+(total||0).toLocaleString('es-CL')
}

// Anexo de una liquidación de caja chica (decisión del 26-10-2026): estadísticas con lo que la app ya tiene, de manera anexa.
// Gasto de caja chica = la misma regla que saldoCajaChica (gasto cargado por la persona, sin paid_by_client). Meses = los 6
// últimos hasta el de la liquidación; el promedio es sobre los meses con gasto.
export const anexoCajaChica = (expenses, clients, persona, gastosLiq, hasta) => {
  const sum = xs => xs.reduce((a,e)=>a+(Number(e.amount)||0),0)
  const deCaja = (expenses||[]).filter(e=>!e.deleted_at&&e.type==='gasto'&&e.created_by===persona&&!e.paid_by_client)
  const porCat = {}; (gastosLiq||[]).forEach(e=>{ const k=e.category||'Otro'; (porCat[k]=porCat[k]||[]).push(e) })
  const categorias = Object.entries(porCat).map(([cat,xs])=>({cat,n:xs.length,total:sum(xs)})).sort((a,b)=>b.total-a.total)
  const fin = String(hasta||isoLocal(Date.now())).slice(0,7), [y,m] = fin.split('-').map(Number), meses = []
  for(let i=5;i>=0;i--){ const d=new Date(y,m-1-i,1); meses.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`) }
  const mesDe = e => String(e.date||'').slice(0,7)
  const porMes = meses.map(k=>{ const xs=deCaja.filter(e=>mesDe(e)===k); return {mes:k, etiqueta:`${MES_C[Number(k.slice(5,7))-1]} ${k.slice(0,4)}`, n:xs.length, total:sum(xs)} })
  const conGasto = porMes.filter(x=>x.n>0)
  const promedio = conGasto.length ? Math.round(conGasto.reduce((a,x)=>a+x.total,0)/conGasto.length) : 0
  const enVentana = deCaja.filter(e=>mesDe(e)>=meses[0]&&mesDe(e)<=fin)
  const porCli = {}; enVentana.forEach(e=>{ const k=e.client_id||'__sin__'; (porCli[k]=porCli[k]||[]).push(e) })
  const clientes = Object.entries(porCli).map(([k,xs])=>({ id:k==='__sin__'?null:k, name:k==='__sin__'?'Sin cliente':((clients||[]).find(c=>String(c.id)===String(k))?.name||'—'), n:xs.length, total:sum(xs) })).sort((a,b)=>b.total-a.total).slice(0,5)
  return { categorias, porMes, promedio, clientes }
}

// Pedidos de liquidación a la notaría (edge notaria-pedir-liquidacion + agente-correo): cada pedido con su recorrido
// (envío, tarea de seguimiento, seguimiento, respuesta). Fuente única para la tarjeta de Notaría y la vista Pedidos.
export const _PED_ACC=['notaria.pedido_liquidacion','notaria.pedido_liquidacion_fallido','notaria.pedido_sin_respuesta','notaria.seguimiento_liquidacion','notaria.seguimiento_liquidacion_fallido','notaria.respuesta_liquidacion','notaria.aviso_liquidacion','notaria.aviso_liquidacion_fallido']

export function usePedidosNotaria(bulkImports=[]){
  const [rows,setRows]=useState(null), [rev,setRev]=useState(0)
  useEffect(()=>{ let vivo=true; if(DEMO){ setRows((demoData.historial||[]).filter(r=>_PED_ACC.includes(r.action))); return }
    supabase.from('activity_log').select('id,action,detail,user_email,created_at').in('action',_PED_ACC).order('created_at',{ascending:false}).limit(200)
      .then(({data})=>{ if(vivo) setRows(data||[]) }).catch(()=>{ if(vivo) setRows([]) })
    return ()=>{ vivo=false } },[rev])
  const pedidos=useMemo(()=>{ if(!rows) return null
    const j=d=>{ try{ return typeof d==='string'?JSON.parse(d):(d||{}) }catch(_){ return {} } }
    const ev=rows.map(r=>({...r,d:j(r.detail)}))
    return ev.filter(e=>e.action==='notaria.pedido_liquidacion'||e.action==='notaria.pedido_liquidacion_fallido').map(p=>{
      const slot=p.d.slot, mismos=ev.filter(e=>e.d.slot===slot).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))
      const resp=mismos.find(e=>e.action==='notaria.respuesta_liquidacion'), seg=mismos.filter(e=>e.action==='notaria.seguimiento_liquidacion'), sinR=mismos.find(e=>e.action==='notaria.pedido_sin_respuesta')
      const fallo=p.action==='notaria.pedido_liquidacion_fallido'
      // Liquidación cargada = una carga de notaría (bulk_imports) hecha después de la respuesta con Excel.
      const carga=resp&&resp.d.con_excel?(bulkImports||[]).filter(b=>(b.status||'active')==='active'&&(b.resumen?.notaria===true||/notar/i.test(String(b.filename||'')))&&String(b.created_at)>=String(resp.created_at)).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0]||null:null
      const eventos=carga?[...mismos,{id:'c'+carga.id,action:'__carga',created_at:carga.created_at,d:{n:carga.resumen?.cargadas??carga.row_count}}]:mismos
      const estado=fallo?'fallo':carga?'carg':resp?(resp.d.con_excel?'rev':'resp'):sinR?'sin':'env'
      const ultSeg=seg.length?seg[seg.length-1]:null
      return {slot, p, eventos, estado, resp, carga, porSeguir:estado==='sin'&&(!ultSeg||String(ultSeg.created_at)<String(sinR.created_at))}
    }) },[rows,bulkImports])
  return {pedidos, recargar:()=>setRev(v=>v+1)}
}

export const _PED_CHIP={carg:['Cargada',C.greenText,C.greenBg],rev:['Por revisar',C.azulInfo,C.azulBg],resp:['Respondida',C.greenText,C.greenBg],sin:['Sin respuesta',C.soonText,C.soonBg],env:['Enviado',C.azulInfo,C.azulBg],fallo:['No se envió',C.overdueText,C.overdueBg]}

// Notaría › Documentos (edge notaria-documentos): lo que envió la notaría, agrupado por cliente, con su archivo en
// Clientes/<Cliente>/Notaría. «Por clasificar»: una persona elige el cliente y la app lo guarda en su carpeta.
export const _DEMO_DOCS_NOTARIA = [
  { id:'dn1', razon_social:'MI MARKET SpA', recibido_at:'2026-10-14T17:36:00Z', thread_id:'t1', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'RV: 38 Notaria: Documento Firmado (316-2026101413123242)', tipo_documento:'CONSTITUCION DE SOCIEDAD POR ACCIONES', repertorio:'52157', fecha_documento:'2026-10-02', archivo_nombre:'316-2026101413123242.pdf', cliente_id:'c1', ot_number:'497834', estado:'guardado', drive_url:'https://drive.google.com', metodo:'ot_tipo_fecha' },
  { id:'dn2', recibido_at:'2026-10-02T19:29:00Z', thread_id:'t2', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'RV: 38 Notaria: Documento Firmado (316-2026100213213667)', tipo_documento:'AUTORIZACION USO DOMICILIO COMERCIAL', repertorio:null, fecha_documento:'2026-10-02', archivo_nombre:'316-2026100213213667.pdf', cliente_id:'c2', ot_number:'497650', estado:'guardado', drive_url:'https://drive.google.com', metodo:'ot_tipo_fecha' },
  { id:'dn3', recibido_at:'2026-09-29T22:24:00Z', thread_id:'t3', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'Comprobantes de pago Prenda y Escrituras', tipo_documento:null, repertorio:null, fecha_documento:null, archivo_nombre:'Comprobante_359995-2026 REP 52160.pdf', cliente_id:null, ot_number:null, estado:'por_clasificar', motivo:'No se identificó el cliente', drive_url:'https://drive.google.com' },
  { id:'dn5', recibido_at:'2026-09-29T22:24:00Z', thread_id:'t3', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'Comprobantes de pago Prenda y Escrituras', tipo_documento:null, repertorio:null, fecha_documento:null, archivo_nombre:'REP 52161.pdf', cliente_id:null, ot_number:null, estado:'por_clasificar', motivo:'No se identificó el cliente', drive_url:'https://drive.google.com' },
  { id:'dn4', recibido_at:'2026-10-16T15:10:00Z', thread_id:'t4', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'RV: 38 Notaria: Documento Firmado (316-2026101615021131)', tipo_documento:'PROTOCOLIZACION EXTRACTO', repertorio:'53480', fecha_documento:'2026-10-16', archivo_nombre:'316-2026101615021131.pdf', cliente_id:null, ot_number:null, estado:'pendiente_ot', leido_at:'2026-10-16T16:00:00Z', lectura:{acto:'Protocolización de extracto',sociedades:[{razon_social:'Inversiones Demo SpA'}]}, do_estado:'publicado', do_publicacion:{fecha:'2026-10-15',nombre:'INVERSIONES DEMO SpA 77.000.000-0',categoria:'CONSTITUCIÓN',cve:'2886071',url:'https://www.diariooficial.interior.gob.cl/',criterio:'repertorio',repertorio:'42.434/2026',fecha_escritura:'2026-08-17',vence:'2026-10-16',otras:[]} },
  { id:'dn6', recibido_at:'2026-10-20T15:10:00Z', thread_id:'t6', remitente:'Silvana Delgado <sdelgado@notaria.cl>', asunto:'RV: 38 Notaria: Documento Firmado', tipo_documento:'EXTRACTO', repertorio:'54020', fecha_documento:'2026-10-20', archivo_nombre:'316-2610-2010-0000.pdf', cliente_id:'c1', ot_number:null, estado:'guardado', drive_url:'https://drive.google.com', lectura:{acto:'Constitución de sociedad por acciones (extracto)',sociedades:[{razon_social:'Comercial Demo SpA'}]}, do_estado:'pendiente', do_publicacion:{base:'2026-10-20',vence:'2026-12-19',sociedad:'comercial demo spa',repertorio:'54020'} },
]

export function useDocumentosNotaria(){
  const [rows,setRows]=useState(null)
  const cargar=useCallback(()=>{ if(DEMO){ setRows(_DEMO_DOCS_NOTARIA); return }
    supabase.from('documentos_notaria').select('id,gmail_id,thread_id,recibido_at,remitente,asunto,tipo_documento,repertorio,fecha_documento,archivo_nombre,cliente_id,ot_number,estado,motivo,drive_file_id,drive_url,drive_nombre,metodo,razon_social,lectura,sugerencia,leido_at,do_estado,do_publicacion').eq('origen','notaria').neq('estado','duplicado').order('recibido_at',{ascending:false}).limit(2000)
      .then(({data})=>setRows(data||[]),()=>setRows([])) },[])
  useEffect(()=>{ cargar() },[cargar])
  return {rows,recargar:cargar,setRows}
}

export function DocumentosNotariaTile({render}){ const {rows}=useDocumentosNotaria(); return render(rows) }

// Tipo legible (la notaría escribe en mayúsculas y sin tildes). Sin tipo: el nombre del archivo, ordenado.
export const _TILDES = {modificacion:'modificación',division:'división',constitucion:'constitución',protocolizacion:'protocolización',autorizacion:'autorización',cesion:'cesión',declaracion:'declaración',delegacion:'delegación',reduccion:'reducción',publica:'pública',cancelacion:'cancelación',prohibicion:'prohibición',opcion:'opción',devolucion:'devolución',vehiculos:'vehículos',vehiculo:'vehículo',credito:'crédito',creditos:'créditos',transaccion:'transacción',subordinacion:'subordinación',rectificacion:'rectificación',inscripcion:'inscripción',informaticas:'informáticas',instruccion:'instrucción',notificacion:'notificación',liberacion:'liberación',transferencia:'transferencia',sesion:'sesión',accion:'acción',acciones:'acciones',deposito:'depósito',propietario:'propietario',unico:'único',numero:'número'}

export const _tipoDoc = d => {
  const t=String(d.tipo_documento||'').toLowerCase().replace(/\s+/g,' ').trim()
  if(t) { const x=t.split(' ').map(w=>_TILDES[w]||w).join(' ').replace(/\bspa\b/g,'SpA'); return x.charAt(0).toUpperCase()+x.slice(1) }
  let b=String(d.archivo_nombre||'Documento').replace(/\.[a-z0-9]+$/i,'').replace(/_/g,' ').replace(/\s+/g,' ').trim()
  if(/^\d[\d -]*$/.test(b)) return /^\d{6}$/.test(b)?`OT ${b}`:'Documento sin nombre'
  if(b===b.toUpperCase()&&/[A-ZÁÉÍÓÚÑ]{4}/.test(b)) { const x=b.toLowerCase().split(' ').map(w=>_TILDES[w]||w).join(' ').replace(/\bspa\b/g,'SpA').replace(/\s-a-\s/g,' a '); b=x.charAt(0).toUpperCase()+x.slice(1) }
  return b
}

// Clase del documento: firmado (escritura, extracto, protocolización), comprobante de pago, instrucción o documento.
export const _DOC_CLASE = {esc:['Escritura firmada',C.accent,C.azulBg],ext:['Extracto',C.accent,C.azulBg],pro:['Protocolización',C.accent,C.azulBg],com:['Comprobante de pago',C.soonText,C.soonBg],ins:['Instrucción',C.muted,C.track],doc:['Documento',C.muted,C.track]}

export const _claseDoc = d => { const t=_normTxt(d.tipo_documento), a=_normTxt(`${d.archivo_nombre||''} ${d.asunto||''}`)
  if(t) return /extracto/.test(t)&&!/protocolizacion/.test(t)?'ext':/protocolizacion/.test(t)?'pro':'esc'
  if(/comprobante|tgr|pago/.test(a)) return 'com'; if(/instruccion/.test(a)) return 'ins'; return 'doc' }

// Subcategorías de Notaría › Documentos (render VdmsmPmEZLsFKzNPGD7BAQ aprobado): los extractos van aparte, con su publicación en el
// Diario Oficial; las protocolizaciones que no son de extracto van con las escrituras.
export const _DOC_SUB = {esc:['Escrituras y protocolizaciones','file',C.azulBg,C.accent],ext:['Extractos y Diario Oficial','building',C.azulBg,C.accent],com:['Comprobantes de pago','receipt',C.soonBg,C.soonText],otr:['Otros','grid',C.track,C.muted],ult:['Últimos 14 días','clock',C.track,C.muted],por:['Por asignar','alert',C.soonBg,C.soonText]}

export const _conceptoDoc = d => /extracto/.test(_normTxt(d.tipo_documento))?'ext':({esc:'esc',pro:'esc',com:'com'})[_claseDoc(d)]||'otr'

export const _esWord = d => /\.(docx?|rtf|odt)$/i.test(d.archivo_nombre||'')   // la notaría solo registra PDF (decisión del usuario 23-10)

export const _fechaDoc = d => String(d.fecha_documento||isoLocal(d.recibido_at)||'').slice(0,10)

export const _remitente = d => String(d.remitente||'').replace(/<.*>/,'').replace(/"/g,'').trim()

// Publicación en el Diario Oficial (edge diario-oficial, probada por el repertorio de la escritura). Un trámite = la escritura:
// su extracto, su protocolización y las publicaciones repetidas (complementos) van juntos.
export const _sinRut = n => String(n||'').replace(/\s*\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\*?\s*$/,'').trim()

export const _repDO = r => { const x=String(r||'').split('/')[0].replace(/\D/g,''); return x?Number(x).toLocaleString('es-CL'):'' }

export function tramitesDiarioOficial(docs){
  const grupos=new Map(), alias=new Map()
  docs.filter(d=>d.do_estado&&d.do_estado!=='no_aplica'&&d.do_publicacion).forEach(d=>{ const p=d.do_publicacion
    const cves=p.cve?[p.cve,...(p.otras||[]).map(o=>o.cve)]:[]
    const k=cves.map(c=>alias.get(c)).find(Boolean)||(p.cve?`c${p.cve}`:`p${p.sociedad||''}|${p.repertorio||''}`)
    cves.forEach(c=>alias.set(c,k))
    const g=grupos.get(k)||{k,docs:[],pubs:new Map()}; g.docs.push(d)
    if(p.cve){ g.pubs.set(p.cve,{fecha:p.fecha,url:p.url,cve:p.cve}); (p.otras||[]).forEach(o=>g.pubs.set(o.cve,o)) }
    grupos.set(k,g) })
  return [...grupos.values()].map(g=>{ const conPub=g.docs.filter(d=>d.do_estado==='publicado')
    const d0=conPub.find(d=>!g.pubs.size||[...g.pubs.values()].sort((a,b)=>a.fecha.localeCompare(b.fecha))[0].cve===d.do_publicacion.cve)||g.docs[0], p=d0.do_publicacion
    const pub=conPub.length?[...g.pubs.values()].sort((a,b)=>a.fecha.localeCompare(b.fecha))[0]:null
    const fe=[p.fecha_escritura,...g.docs.map(d=>d.lectura?.escritura?.fecha)].find(x=>/^\d{4}-\d{2}-\d{2}/.test(String(x||'')))?.slice(0,10)||null
    const actos=_normTxt(g.docs.map(d=>d.lectura?.acto||d.tipo_documento||'').join(' ')), cat=_normTxt(p.categoria||'')
    const acto=/constituc/.test(cat)?(/divisi/.test(actos)?'Constitución por división':'Constitución'):/modific/.test(cat)?(/divisi/.test(actos)?'División':/fusi/.test(actos)?'Fusión':'Modificación'):/disolu/.test(cat)?'Disolución':cat?p.categoria.charAt(0)+p.categoria.slice(1).toLowerCase():/constituc/.test(actos)?'Constitución':'Modificación'
    const soc=p.nombre?_sinRut(p.nombre):(g.docs[0].lectura?.sociedades||[]).find(x=>_normTxt(x?.razon_social)===_normTxt(p.sociedad))?.razon_social||p.sociedad||''
    return {k:g.k, estado:pub?'publicado':g.docs.some(d=>d.do_estado==='plazo_vencido')?'plazo_vencido':'pendiente', pub, nPub:g.pubs.size, docs:g.docs,
      sociedad:soc.replace(/\bSpA\b/g,'SPA')===soc.toUpperCase()?titleCase(soc).replace(/\bSpa\b/g,'SpA').replace(/\bLtda\b\.?/g,'Ltda.'):rsBonita(soc), acto, rep:_repDO(p.repertorio), fEsc:fe, dias:pub&&fe?_diasEntre(fe,pub.fecha):null, vence:p.vence||null} })
}

export function DocumentosNotaria({isDesktop, clients=[], clientEntities=[], expenses=[], user, onOpenClientFicha, sub=null, setSub=()=>{}}){
  const {rows,recargar,setRows}=useDocumentosNotaria()
  const [q,setQ]=useState(''), [mes,setMes]=useState(''), [abog,setAbog]=useState(''), [agrupar,setAgrupar]=useState('cliente'), [extVista,setExtVista]=useState('docs')
  const [fuera,setFuera]=useState(()=>new Set()), [otro,setOtro]=useState({}), [busy,setBusy]=useState(null), [abiertos,setAbiertos]=useState(()=>new Set()), [envMas,setEnvMas]=useState(()=>new Set()), [nEnv,setNEnv]=useState(12)
  const [doTodos,setDoTodos]=useState(false), [doAb,setDoAb]=useState(null)
  const [aprendidos,setAprendidos]=useState([])
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key,value').eq('kind','notaria_parte').then(({data})=>setAprendidos(data||[]),()=>{}) },[])
  const D=isDesktop
  const nom=id=>clients.find(c=>String(c.id)===String(id))?.name||'—'
  const abogDe=id=>clients.find(c=>String(c.id)===String(id))?.abogado_responsable||''
  const ctx=useMemo(()=>{ if(!rows) return null
    const clasificados=rows.filter(d=>d.cliente_id&&['guardado','asignado'].includes(d.estado))
    const porRut={}; [...clients.map(c=>[c.rut,c.id]),...clientEntities.map(e=>[e.rut,e.client_id])].forEach(([r,id])=>{ const k=String(r||'').replace(/[^0-9kK]/g,'').toUpperCase(); if(k.length>=7&&id) porRut[k]=String(id) })
    return {ots:(expenses||[]).filter(e=>e.ot_number&&!e.deleted_at), usadas:new Set(clasificados.map(d=>String(d.ot_number||'')).filter(Boolean)), indice:indiceNombres(clients,clientEntities,[],aprendidos), clasificados, porRut}
  },[rows,expenses,clients,clientEntities,aprendidos])
  if(rows===null||!ctx) return <div style={{fontSize:12,color:C.muted,padding:'10px 2px'}}>Cargando…</div>
  const vivos=rows.filter(d=>!_esWord(d)&&!['duplicado','descartado'].includes(d.estado))
  const qq=_normTxt(q)
  // pasaBase = buscador y mes (cifras de las tarjetas); pasa = además la subcategoría abierta.
  const pasaBase=d=>(!qq||_normTxt(`${_tipoDoc(d)} ${d.archivo_nombre||''} ${d.asunto||''} ${d.repertorio||''} ${d.ot_number||''} ${d.razon_social||''} ${d.cliente_id?nom(d.cliente_id):''}`).includes(qq))
    &&(!mes||_fechaDoc(d).slice(0,7)===mes)
  const pasa=d=>pasaBase(d)&&(!['esc','ext','com','otr'].includes(sub)||_conceptoDoc(d)===sub)
  const guard=vivos.filter(d=>d.estado==='guardado'), porAsig=vivos.filter(d=>['por_clasificar','pendiente_ot','asignado','error'].includes(d.estado))
  const sugDe=d=>sugerenciasDocumento(d,ctx).sugerencias
  const nConSug=porAsig.filter(d=>sugDe(d).length).length
  const meses=[...new Set(vivos.map(d=>_fechaDoc(d).slice(0,7)).filter(Boolean))].sort().reverse()
  const abogados=[...new Set(guard.map(d=>abogDe(d.cliente_id)).filter(Boolean))].sort()
  // Por asignar por ENVÍO (un correo = una tarjeta con todos sus PDF); la escritura va con su extracto (mismo repertorio).
  const envios={}; porAsig.filter(pasa).forEach(d=>{ const k=d.thread_id||d.gmail_id||d.id; (envios[k]=envios[k]||[]).push(d) })
  // Escritura, extracto y protocolización del mismo repertorio llegan a veces en correos distintos: van en una sola tarjeta.
  { const dueno={}; Object.keys(envios).forEach(k=>{ const reps=[...new Set(envios[k].flatMap(repertoriosDoc))]; const k0=reps.map(r=>dueno[r]).find(x=>x&&envios[x]&&x!==k)
      if(k0){ envios[k0].push(...envios[k]); delete envios[k]; reps.forEach(r=>{ dueno[r]=k0 }) } else reps.forEach(r=>{ if(!dueno[r]) dueno[r]=k }) }) }
  const listaEnv=Object.entries(envios).map(([k,ds])=>{ ds.sort((a,b)=>String(a.repertorio||'').localeCompare(String(b.repertorio||''))||_fechaDoc(a).localeCompare(_fechaDoc(b)))
    const sug=new Map(); ds.forEach(d=>sugDe(d).forEach(s=>{ const x=sug.get(s.client_id)||{...s,n:0}; x.n++; sug.set(s.client_id,x) }))
    return {k,ds,rec:ds.map(d=>d.recibido_at).sort().pop(),sug:[...sug.values()].sort((a,b)=>b.n-a.n)} }).sort((a,b)=>String(b.rec).localeCompare(String(a.rec)))
  const tituloEnv=e=>{ const tipos=[...new Set(e.ds.map(_tipoDoc))]; const as=String(e.ds[0].asunto||'').replace(/^\s*((rv|re|fw|fwd):\s*)+/i,'').trim()
    if(e.ds.every(d=>d.tipo_documento)&&tipos.length===1) return tipos[0]
    if(as&&!/documento firmado/i.test(as)&&!/^\d+$/.test(as.replace(/\W/g,''))) return as
    return tipos.length===1?tipos[0]:`${e.ds.length} documentos` }
  const subEnv=e=>{ const d=e.ds[0], de=_remitente(d)
    if(e.ds.length===1&&d.tipo_documento) return [d.fecha_documento?`Firmada el ${fmtFechaDMY(d.fecha_documento)}`:null, d.repertorio?`Rep ${d.repertorio}`:null, d.ot_number?`OT ${d.ot_number}`:null, de].filter(Boolean).join(' · ')
    const reps=[...new Set(e.ds.map(x=>x.repertorio).filter(Boolean))]
    return [`${e.ds.length} PDF`, reps.length===1&&e.ds.length>1?`mismo repertorio ${reps[0]}`:null, de].filter(Boolean).join(' · ') }
  const asignar=async(e,cid,{aprender=false}={})=>{ const ds=e.ds.filter(d=>!fuera.has(d.id)); if(!cid||!ds.length||busy) return; setBusy(e.k)
    try{
      const ids=ds.map(d=>d.id)
      if(!DEMO){ const {error}=await supabase.from('documentos_notaria').update({cliente_id:cid,estado:'asignado',motivo:null,updated_at:new Date().toISOString()}).in('id',ids); if(error) throw error }
      ds.forEach(d=>logActividad('notaria.documento_asignado',{tabla:'documentos_notaria',id:d.id,detalle:{title:`${_tipoDoc(d)} → ${nom(cid)}`,archivo:d.archivo_nombre,cliente:nom(cid)}}))
      // Lo confirmado a mano se aprende: la razón social que leyó la IA (si es una sola) queda como parte de ese cliente.
      if(aprender&&!DEMO) ds.forEach(d=>{ const so=(d.lectura?.sociedades||[]).filter(x=>x?.razon_social); if(so.length===1){ learnPut('notaria_parte',so[0].razon_social,String(cid)); const rt=String(so[0].rut||'').replace(/[^0-9kK]/g,'').toUpperCase(); if(rt.length>=7) learnPut('notaria_rut',rt,String(cid)) } })
      // El extracto publicado trae la razón social y el RUT de la sociedad: al asignarlo, queda como razón social del cliente.
      if(!DEMO) for(const d of ds){ const pb=d.do_publicacion; if(!pb?.rut||!pb?.nombre) continue
        const nueva=await aprenderRS(cid, fmtRutCL(pb.rut), rsBonita(_sinRut(pb.nombre)), clientEntities)
        if(nueva) logActividad('cliente.rs_aprendida',{tabla:'client_entities',id:nueva.id,detalle:{title:`Razón social ${nueva.name} (${nueva.rut}) aprendida para ${nom(cid)}`,origen:'Diario Oficial',documento:d.id}}) }
      setRows(p=>p.map(x=>ids.includes(x.id)?{...x,cliente_id:cid,estado:DEMO?'guardado':'asignado',drive_url:x.drive_url||(DEMO?'https://drive.google.com':null)}:x))
      if(DEMO){ appAlert(`Guardado en Drive, en la carpeta Notaría de ${nom(cid)} (demo).`); return }
      const {data,error}=await supabase.functions.invoke('notaria-documentos',{body:{}})
      const listos=[...(data?.guardados||[]),...(data?.movidos||[])].filter(x=>ds.some(d=>d.archivo_nombre===x.archivo)).length
      recargar()
      appAlert(listos===ds.length?`Guardado${ds.length>1?`s ${ds.length} documentos`:''} en Drive, en la carpeta Notaría de ${nom(cid)}.`:error||data?.error?`Quedó asignado a ${nom(cid)}; el archivo NO se guardó todavía (${data?.error||error?.message}). Se reintenta en la próxima revisión diaria (10:20).`:`Quedó asignado a ${nom(cid)}; ${listos?`${listos} de ${ds.length} ya están en su carpeta y el resto se guarda`:'se guarda'} en la próxima revisión diaria (10:20).`)
    }catch(err){ appAlert('No se pudo asignar: '+(err.message||err)) }
    setBusy(null) }
  const crearCarpeta=async(e,cid)=>{ const cl=clients.find(c=>String(c.id)===String(cid)); if(!cl||busy) return; setBusy(e.k)
    try{ if(!DEMO){ const res=await driveCall({action:'createFolder', name:(cl.name||'').trim()})
        if(res?.conflict){ setBusy(null); appAlert(`Ya hay ${(res.similar||[]).length>1?'carpetas parecidas':'una carpeta parecida'} a «${cl.name}» en Drive:\n\n${(res.similar||[]).map(x=>`• ${x.name}`).join('\n')}\n\nNo creé otra para no duplicar. Vincúlala desde la ficha del cliente.`); return }
        const fid=res?.folderId||res?.id; if(!fid) throw new Error('Drive no devolvió la carpeta')
        const {error}=await supabase.from('clients').update({drive_folder_id:fid}).eq('id',cl.id); if(error) throw error
        const _nn=_normTxt(cl.name); if(_nn) learnPut('cliente_folder',_nn,String(cl.id)) }
      setBusy(null); await asignar(e,cid)
    }catch(err){ setBusy(null); appAlert('No se pudo crear la carpeta: '+(err.message||err)) } }
  const descartar=async e=>{ const ds=e.ds.filter(d=>!fuera.has(d.id)); if(!ds.length||busy) return; setBusy(e.k)
    try{ const ids=ds.map(d=>d.id)
      if(!DEMO){ const {error}=await supabase.from('documentos_notaria').update({estado:'descartado',motivo:`No es de un cliente · ${user?.name||'Oficina'}`,updated_at:new Date().toISOString()}).in('id',ids); if(error) throw error }
      ds.forEach(d=>logActividad('notaria.documento_descartado',{tabla:'documentos_notaria',id:d.id,detalle:{title:`${_tipoDoc(d)}: no es de un cliente`,archivo:d.archivo_nombre}}))
      setRows(p=>p.map(x=>ids.includes(x.id)?{...x,estado:'descartado'}:x)) }catch(err){ appAlert('No se pudo guardar: '+(err.message||err)) }
    setBusy(null) }
  // Registro de lo guardado: agrupado por cliente, mes o tipo; filtros arriba; exportable.
  const reg=guard.filter(d=>pasa(d)&&(!abog||abogDe(d.cliente_id)===abog)).sort((a,b)=>_fechaDoc(b).localeCompare(_fechaDoc(a)))
  const llave=d=>agrupar==='mes'?_fechaDoc(d).slice(0,7):agrupar==='tipo'?_claseDoc(d):String(d.cliente_id)
  const etq=k=>agrupar==='mes'?(k?mesTitulo(k+'-15T12:00'):'Sin fecha'):agrupar==='tipo'?_DOC_CLASE[k][0]:nom(k)
  const grupos={}; reg.forEach(d=>{ const k=llave(d); (grupos[k]=grupos[k]||[]).push(d) })
  const ordenG=Object.keys(grupos).sort((a,b)=>agrupar==='mes'?b.localeCompare(a):etq(a).localeCompare(etq(b),'es'))
  // Mismo tipo, fecha, repertorio y OT con distinta clave de validación = otra versión que reenvió la notaría (no se borra).
  const versiones={}; guard.forEach(d=>{ const k=`${d.cliente_id}|${d.tipo_documento}|${d.fecha_documento}|${d.repertorio||''}|${d.ot_number||''}`; (versiones[k]=versiones[k]||[]).push(d) })
  const verDe=d=>{ const v=(versiones[`${d.cliente_id}|${d.tipo_documento}|${d.fecha_documento}|${d.repertorio||''}|${d.ot_number||''}`]||[]).slice().sort((a,b)=>String(b.recibido_at).localeCompare(String(a.recibido_at))); return v.length>1&&d.tipo_documento?v.length-v.indexOf(d):0 }
  const exportar=async()=>{ try{ const XLSX=await loadXLSXStyle()
    const data=reg.map(d=>[fmtFechaDMY(_fechaDoc(d)), nom(d.cliente_id), d.razon_social||'', _tipoDoc(d), _DOC_CLASE[_claseDoc(d)][0], d.repertorio||'', d.ot_number||'', abogDe(d.cliente_id), d.drive_url||''])
    const ws=XLSX.utils.aoa_to_sheet([['Documentos de la notaría'],[],['Fecha','Cliente','Razón social','Documento','Clase','Repertorio','OT','Abogado','Drive'],...data])
    ws['!cols']=[{wch:11},{wch:26},{wch:32},{wch:48},{wch:18},{wch:11},{wch:9},{wch:14},{wch:50}]
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Documentos'); XLSX.writeFile(wb,`Documentos de la notaria${mes?` ${mes}`:''}.xlsx`) }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12}
  const chip=k=>{ const [l,c,b]=_DOC_CLASE[k]; return <span key={k} style={{fontSize:11,fontWeight:600,color:c,background:b,borderRadius:12,padding:'2px 8px',whiteSpace:'nowrap'}}>{l}</span> }
  const abrir=d=>d.drive_url?<a href={d.drive_url} target='_blank' rel='noreferrer' onClick={ev=>ev.stopPropagation()} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,textDecoration:'none',flexShrink:0,whiteSpace:'nowrap'}}>Abrir</a>:<span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap',flexShrink:0}}>{D?'Se guarda en Drive en la próxima revisión':'Por guardar'}</span>
  const pill=(on,txt,sub,fn,dis)=><button key={txt+(sub||'')} disabled={dis} onClick={fn} style={{fontSize:12.5,fontWeight:600,borderRadius:9,padding:'7px 11px',border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:C.surface,color:on?'#fff':C.accent,cursor:dis?'default':'pointer',whiteSpace:D?'nowrap':'normal',textAlign:'left',opacity:dis?.6:1,maxWidth:'100%'}}>{txt}{sub&&<span style={{fontWeight:400,opacity:.8}}> · {sub}</span>}</button>
  const selSty={fontSize:12.5,color:C.text,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 8px',minWidth:0,maxWidth:D?190:'100%'}
  const activos=clients.filter(c=>!c.is_internal&&c.status!=='Terminado').sort((a,b)=>String(a.name).localeCompare(String(b.name),'es'))
  const tarjetaEnv=e=>{ const d0=e.ds[0], sinCarpeta=e.ds.find(d=>d.cliente_id&&/carpeta/i.test(d.motivo||'')), asig=e.ds.find(d=>d.estado==='asignado'), mas=envMas.has(e.k), muestra=mas?e.ds:e.ds.slice(0,4), lec=e.ds.find(d=>d.lectura&&!d.lectura.error)?.lectura
    const clases=[...new Set(e.ds.map(_claseDoc))]
    return (<div key={e.k} style={{...card,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'44px minmax(0,1fr)',columnGap:12,padding:D?'12px 14px':'11px 12px'}}>
        {diaGrande(isoLocal(e.rec))}
        <div style={{minWidth:0}}>
          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{tituloEnv(e)}</div>
          <div style={{fontSize:12,color:C.textSoft,marginTop:2}}>{subEnv(e)}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>{clases.map(chip)}</div>
          {lec&&<div style={{fontSize:12,color:C.muted,marginTop:6}}>Leído en el documento: {[lec.acto,(lec.sociedades||[]).map(x=>x.razon_social).filter(Boolean).join(', ')||(lec.comparecientes||[]).map(x=>x.nombre).filter(Boolean).slice(0,3).join(', ')].filter(Boolean).join(' · ')}</div>}
        </div>
        <div style={{gridColumn:D?2:'1 / -1',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:8}}>
          {asig?<span style={{fontSize:12,color:C.textSoft}}>Asignado a {nom(asig.cliente_id)}; se guarda en su carpeta en la próxima revisión.</span>
          :sinCarpeta?<><span style={{fontSize:12,color:C.textSoft}}>{nom(sinCarpeta.cliente_id)}: falta su carpeta en Drive.</span>{pill(true,'Crear carpeta y guardar',null,()=>crearCarpeta(e,sinCarpeta.cliente_id),busy===e.k)}</>
          :<>
            {e.sug.length>0&&<span style={{fontSize:12,color:C.textSoft}}>{e.sug.length>1?'Posibles:':'Sugerido:'}</span>}
            {e.sug.length===0&&<span style={{fontSize:12,color:C.textSoft}}>{e.ds.some(d=>d.leido_at)?'Sin pista en el documento.':'Sin pista; se lee con IA en la próxima revisión.'}</span>}
            {e.sug.map(s=>pill(e.sug.length===1,nom(s.client_id),s.motivo,()=>asignar(e,s.client_id),busy===e.k))}
            {otro[e.k]!=null
              ?<><select value={otro[e.k]} onChange={ev=>setOtro(p=>({...p,[e.k]:ev.target.value}))} style={selSty}><option value=''>Elige el cliente</option>{activos.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>{pill(true,'Guardar en su carpeta',null,()=>asignar(e,otro[e.k],{aprender:true}),!otro[e.k]||busy===e.k)}</>
              :pill(false,'Otro cliente',null,()=>setOtro(p=>({...p,[e.k]:''})),busy===e.k)}
            <button disabled={busy===e.k} onClick={()=>descartar(e)} style={{fontSize:12.5,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:'7px 4px',whiteSpace:'nowrap'}}>No es de un cliente</button>
          </>}
        </div>
      </div>
      <div>{muestra.map(d=><div key={d.id} style={{display:'flex',alignItems:'center',gap:12,padding:D?'8px 14px':'8px 12px',borderTop:`1px solid ${C.track}`}}>
        <input type='checkbox' checked={!fuera.has(d.id)} onChange={()=>setFuera(p=>{ const n=new Set(p); n.has(d.id)?n.delete(d.id):n.add(d.id); return n })} style={{width:16,height:16,margin:D?'0 14px':'0 14px 0 2px',accentColor:C.accent,flexShrink:0}} aria-label='Incluir'/>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{_tipoDoc(d)}</div>
          <div style={{fontSize:11.5,color:C.textSoft}}>{[_DOC_CLASE[_claseDoc(d)][0], d.fecha_documento?fmtFechaDMY(d.fecha_documento):null, !D&&d.repertorio?`Rep ${d.repertorio}`:null].filter(Boolean).join(' · ')}</div></div>
        {D&&d.repertorio&&<span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>Rep {d.repertorio}</span>}
        {abrir(d)}
      </div>)}
      {e.ds.length>4&&<button onClick={()=>setEnvMas(p=>{ const n=new Set(p); n.has(e.k)?n.delete(e.k):n.add(e.k); return n })} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:D?'8px 14px 10px 72px':'8px 12px 10px 44px'}}>{mas?'Ver menos':`Ver los otros ${e.ds.length-4} archivos`}</button>}
      </div>
    </div>) }
  // Una línea tenue en cada extracto: publicado (con su fecha) o por publicar (con el plazo).
  const fNw=iso=><span style={{whiteSpace:'nowrap'}}>{fmtFechaDMY(iso)}</span>
  const lineaDO=d=>d.do_estado==='publicado'&&d.do_publicacion?.fecha?<div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>Publicado en el Diario Oficial el {fNw(d.do_publicacion.fecha)}{d.do_publicacion.url&&<> · <a href={String(d.do_publicacion.url).replace(/^http:/,'https:')} target='_blank' rel='noreferrer' onClick={ev=>ev.stopPropagation()} style={{color:C.azulInfo,fontWeight:600,textDecoration:'none',whiteSpace:'nowrap'}}>{D?'Ver publicación':'Ver'}</a></>}</div>
    :['pendiente','plazo_vencido'].includes(d.do_estado)&&d.do_publicacion?.vence?<div style={{fontSize:11.5,color:d.do_estado==='plazo_vencido'?C.overdueText:C.soonText,marginTop:1}}>{d.do_estado==='plazo_vencido'?<>Sin publicación en el Diario Oficial · plazo vencido el {fNw(d.do_publicacion.vence)}</>:<>Por publicar en el Diario Oficial · plazo {fNw(d.do_publicacion.vence)}</>}</div>:null
  const filaReg=(d,i)=><div key={d.id} onClick={()=>d.drive_url&&window.open(d.drive_url,'_blank','noopener')} style={{display:'flex',alignItems:'center',gap:12,padding:D?'9px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:d.drive_url?'pointer':'default'}}>
    {diaGrande(_fechaDoc(d))}
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13.5,fontWeight:600,color:C.text}}>{_tipoDoc(d)}{verDe(d)>0&&<span style={{fontSize:11,fontWeight:600,color:C.muted,background:C.track,borderRadius:10,padding:'1px 7px',marginLeft:6}}>versión {verDe(d)}</span>}</div>
      <div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>{[agrupar!=='cliente'?<span key='c' onClick={onOpenClientFicha?ev=>{ev.stopPropagation();onOpenClientFicha(d.cliente_id)}:undefined} style={{color:C.accent,fontWeight:600,cursor:'pointer'}}>{nom(d.cliente_id)}</span>:null, d.razon_social&&_normTxt(d.razon_social)!==_normTxt(nom(d.cliente_id))?rsBonita(d.razon_social):null, !D&&d.repertorio?`Rep ${d.repertorio}`:null].filter(Boolean).reduce((a,x,j)=>j?[...a,' · ',x]:[x],[])}</div>
      {lineaDO(d)}
    </div>
    {D&&<span style={{fontSize:12,color:C.textSoft,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>{[d.repertorio?`Rep ${d.repertorio}`:null,d.ot_number?`OT ${d.ot_number}`:null].filter(Boolean).join(' · ')}</span>}
    {abrir(d)}{D&&descargar(d)}
  </div>
  const hayFiltro=!!(qq||mes||abog)
  // Lo último que ENVIÓ la notaría (14 días), con o sin cliente: para revisarlo y descargarlo. Nunca lo que la oficina le manda.
  const desde14=new Date(Date.now()-14*864e5).toISOString()
  const ultimos=vivos.filter(d=>String(d.recibido_at||'')>=desde14&&!esCorreoOficina((String(d.remitente||'').match(/<([^>]+)>/)||[])[1]||d.remitente)&&pasa(d)).sort((a,b)=>String(b.recibido_at).localeCompare(String(a.recibido_at)))
  const descargar=d=>d.drive_file_id?<a href={`https://drive.google.com/uc?export=download&id=${d.drive_file_id}`} target='_blank' rel='noreferrer' onClick={ev=>ev.stopPropagation()} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,textDecoration:'none',flexShrink:0,whiteSpace:'nowrap'}}>Descargar</a>:null
  // Diario Oficial: lo por publicar arriba (vencido primero, luego el plazo más próximo); lo publicado, del más reciente.
  const tram=tramitesDiarioOficial(vivos.filter(pasa))
  const porPub=tram.filter(t=>t.estado!=='publicado').sort((a,b)=>(a.estado==='plazo_vencido'?0:1)-(b.estado==='plazo_vencido'?0:1)||String(a.vence).localeCompare(String(b.vence)))
  const publicados=tram.filter(t=>t.estado==='publicado').sort((a,b)=>b.pub.fecha.localeCompare(a.pub.fecha))
  const filaDO=(t,i)=>{ const ab=doAb===t.k, pend=t.estado!=='publicado', venc=t.estado==='plazo_vencido'
    const plazo=pend&&t.vence?<span style={{fontSize:12,fontWeight:600,color:venc?C.overdueText:C.soonText,whiteSpace:'nowrap'}}>{venc?`Plazo vencido el ${fmtFechaDMY(t.vence)}`:`Por publicar · plazo ${fmtFechaDMY(t.vence)}`}</span>:null
    const sub=[t.acto, t.rep?`Rep ${t.rep}`:null, !D&&t.dias!=null?`día ${t.dias} de 60`:null, D&&t.fEsc?`escritura del ${fmtFechaDMY(t.fEsc)}`:null, t.nPub>1?`${t.nPub} publicaciones`:null, `${t.docs.length} documento${t.docs.length!==1?'s':''}`].filter(Boolean).join(' · ')
    return <div key={t.k} style={{borderTop:i?`1px solid ${C.track}`:'none'}}>
      <div onClick={()=>setDoAb(ab?null:t.k)} style={{display:'flex',alignItems:'center',gap:12,padding:D?'9px 14px':'9px 12px',cursor:'pointer'}}>
        {diaGrande(t.pub?.fecha||_fechaDoc(t.docs[0]))}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13.5,fontWeight:600,color:C.text}}>{t.sociedad}</div>
          <div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>{sub}</div>
          {!D&&plazo&&<div style={{marginTop:1}}>{plazo}</div>}
        </div>
        {D&&(plazo||(t.dias!=null&&<span style={{fontSize:12,fontWeight:t.dias>=50?600:400,color:t.dias>60?C.overdueText:t.dias>=50?C.soonText:C.textSoft,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>Día {t.dias} de 60</span>))}
        {t.pub?.url&&<a href={String(t.pub.url).replace(/^http:/,'https:')} target='_blank' rel='noreferrer' onClick={ev=>ev.stopPropagation()} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,textDecoration:'none',flexShrink:0,whiteSpace:'nowrap'}}>{D?'Ver publicación':'Ver'}</a>}
      </div>
      {ab&&<div style={{background:C.bgSoft,borderTop:`1px solid ${C.track}`,padding:D?'4px 14px 6px 70px':'4px 12px 6px 56px'}}>
        {t.nPub>1&&[...new Map(t.docs.flatMap(d=>[d.do_publicacion,...(d.do_publicacion?.otras||[])]).filter(x=>x?.cve).map(x=>[x.cve,x])).values()].sort((a,b)=>a.fecha.localeCompare(b.fecha)).map(x=><div key={x.cve} style={{display:'flex',alignItems:'center',gap:12,padding:'6px 0'}}>
          <div style={{flex:1,minWidth:0,fontSize:13,color:C.text}}>Publicación del {fmtFechaDMY(x.fecha)}<span style={{fontSize:11.5,color:C.textSoft}}> · CVE {x.cve}</span></div>
          <a href={String(x.url).replace(/^http:/,'https:')} target='_blank' rel='noreferrer' style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,textDecoration:'none',whiteSpace:'nowrap'}}>Ver</a></div>)}
        {t.docs.map(d=><div key={d.id} style={{display:'flex',alignItems:'center',gap:12,padding:'6px 0'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{_tipoDoc(d)}</div>
            <div style={{fontSize:11.5,color:C.textSoft}}>{[fmtFechaDMY(_fechaDoc(d)), d.repertorio?`Rep ${d.repertorio}`:null, d.cliente_id&&d.estado==='guardado'?nom(d.cliente_id):'Por asignar'].filter(Boolean).join(' · ')}</div></div>
          {abrir(d)}{descargar(d)}</div>)}
      </div>}
    </div> }
  const foto=<div style={{...card,display:'grid',gridTemplateColumns:D?'minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr)':'1fr 1fr',overflow:'hidden'}}>
      <div style={{padding:D?'13px 16px':'11px 13px',gridColumn:D?undefined:'1 / -1',borderRight:D?`1px solid ${C.border}`:'none',borderBottom:D?'none':`1px solid ${C.border}`}}>
        {D&&<div style={{...SEC_LBL}}>Documentos de la notaría</div>}
        <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:D?2:0}}><span style={{fontSize:D?27:23,fontWeight:800,color:C.text,letterSpacing:-.5,fontVariantNumeric:'tabular-nums'}}>{vivos.length}</span><span style={{fontSize:12,color:C.muted}}>{D?'':'documentos '}{meses.length?`desde ${fmtFechaDMY(meses[meses.length-1]+'-01')}`:''}</span></div>
      </div>
      {[['guard','En su carpeta',guard.length,C.text,D?'se abren desde la app':null,null],['por','Por asignar',porAsig.length,porAsig.length?C.soonText:C.text,D?`${nConSug} con sugerencia`:null,porAsig.length?()=>setSub('por'):null]].map(([k,l,v,col,s,fn],i)=><div key={k} onClick={fn||undefined} style={{padding:D?'13px 16px':'10px 13px',borderLeft:i&&D?`1px solid ${C.track}`:i?`1px solid ${C.track}`:'none',cursor:fn?'pointer':'default'}}>
        <div style={{...SEC_LBL,whiteSpace:'nowrap'}}>{l}</div><div style={{fontSize:D?20:17,fontWeight:700,color:col,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{v}</div>{s&&<div style={{fontSize:11.5,color:C.textSoft,marginTop:2,whiteSpace:'nowrap'}}>{s}</div>}
      </div>)}
    </div>
  const buscador=<div style={{flex:D?'1 1 240px':'1 1 100%',display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 10px',minWidth:0}}>
      <SIcon n='search' s={14} c={C.done}/>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder={sub?(D?'Buscar cliente, razón social, tipo, repertorio u OT':'Buscar cliente, repertorio u OT'):(D?'Buscar en todos los documentos: cliente, razón social, repertorio u OT':'Buscar en todos los documentos')} style={{border:'none',background:'none',outline:'none',fontSize:12.5,color:C.text,width:'100%',minWidth:0}}/>
    </div>
  const mesSel=<select value={mes} onChange={e=>setMes(e.target.value)} style={selSty}><option value=''>Todos los meses</option>{meses.map(m=><option key={m} value={m}>{mesTitulo(m+'-15T12:00')}</option>)}</select>
  const conRegistro=['esc','ext','com','otr'].includes(sub)&&!(sub==='ext'&&extVista==='do')
  const filtros=<div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
      {buscador}{mesSel}
      {conRegistro&&abogados.length>1&&<select value={abog} onChange={e=>setAbog(e.target.value)} style={selSty}><option value=''>Todos los abogados</option>{abogados.map(a=><option key={a} value={a}>{a}</option>)}</select>}
      {conRegistro&&D&&<span style={{flex:1}}/>}
      {conRegistro&&<div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:16,overflow:'hidden',background:C.surface}}>
        {[['cliente','Cliente'],['mes','Mes'],['tipo','Tipo']].map(([k,l])=><button key={k} onClick={()=>setAgrupar(k)} style={{fontSize:12,fontWeight:600,padding:'6px 11px',border:'none',cursor:'pointer',background:agrupar===k?C.accent:'transparent',color:agrupar===k?'#fff':C.muted}}>{l}</button>)}
      </div>}
      {conRegistro&&D&&<button onClick={exportar} style={{fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Exportar Excel</button>}
    </div>
  // Hub: una tarjeta por subcategoría; las cifras siguen al buscador y al mes. «Por asignar» se abre desde la foto (no se repite).
  if(!sub){
    const base=vivos.filter(pasaBase), mesHoy=String(isoLocal(new Date().toISOString())||'').slice(0,7)
    const nDe=k=>base.filter(d=>_conceptoDoc(d)===k), tramB=tramitesDiarioOficial(base), porPubB=tramB.filter(t=>t.estado!=='publicado').length
    const ult=base.filter(d=>String(d.recibido_at||'')>=desde14&&!esCorreoOficina((String(d.remitente||'').match(/<([^>]+)>/)||[])[1]||d.remitente)).length
    const docsTxt=n=>`${n} documento${n!==1?'s':''}`
    const tiles=['esc','ext','com','otr','ult'].map(k=>{ const [t,ic,bg,col]=_DOC_SUB[k], ds=k==='ult'?[]:nDe(k), n=ds.length, nMes=ds.filter(d=>_fechaDoc(d).slice(0,7)===mesHoy).length
      const s=k==='ult'?`${ult} recibido${ult!==1?'s':''} de la notaría`:k==='ext'?`${docsTxt(n)} · ${tramB.length-porPubB} publicado${tramB.length-porPubB!==1?'s':''} · ${porPubB} por publicar`:`${docsTxt(n)}${!mes&&nMes?` · ${nMes} este mes`:''}`
      return <HubTile key={k} ic={ic} bg={bg} col={col} t={t} s={s} sM={k==='ext'?`${docsTxt(n)} · ${porPubB} por publicar`:undefined} sCol={k==='ext'&&porPubB?C.soonText:undefined} onClick={()=>setSub(k)}/> })
    return (<div style={{display:'flex',flexDirection:'column',gap:12}}>
      {foto}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>{buscador}{mesSel}</div>
      <div style={{display:'grid',gridTemplateColumns:D?'repeat(2,minmax(0,1fr))':'1fr',gap:10}}>{tiles}</div>
    </div>)
  }
  const secUltimos=<div style={{display:'flex',flexDirection:'column',gap:8}}>
      {ultimos.length?<div style={{...card,overflow:'hidden'}}>{ultimos.map((d,i)=><div key={d.id} onClick={()=>d.drive_url&&window.open(d.drive_url,'_blank','noopener')} style={{display:'flex',alignItems:'center',gap:12,padding:D?'9px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:d.drive_url?'pointer':'default'}}>
        {diaGrande(isoLocal(d.recibido_at))}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13.5,fontWeight:600,color:C.text}}>{_tipoDoc(d)}</div>
          <div style={{fontSize:11.5,color:C.textSoft,marginTop:1}}>{[d.cliente_id&&d.estado==='guardado'?<span key='c' onClick={onOpenClientFicha?ev=>{ev.stopPropagation();onOpenClientFicha(d.cliente_id)}:undefined} style={{color:C.accent,fontWeight:600,cursor:'pointer'}}>{nom(d.cliente_id)}</span>:<span key='p' onClick={ev=>{ev.stopPropagation();setSub('por')}} style={{color:C.soonText,fontWeight:600,cursor:'pointer'}}>{d.estado==='asignado'?`Asignado a ${nom(d.cliente_id)}`:'Por asignar'}</span>, d.repertorio?`Rep ${d.repertorio}`:null, D&&d.fecha_documento?`firmada el ${fmtFechaDMY(d.fecha_documento)}`:null].filter(Boolean).reduce((a,x,j)=>j?[...a,' · ',x]:[x],[])}</div>
          {lineaDO(d)}
        </div>
        {abrir(d)}{descargar(d)}
      </div>)}</div>:<div style={{...card,padding:20,textAlign:'center',fontSize:13,color:C.muted}}>La notaría no ha enviado documentos en los últimos 14 días.</div>}
    </div>
  const secDO=<div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{...SEC_LBL,margin:'2px 2px 0'}}>Por publicar · {porPub.length}</div>
      {porPub.length?<div style={{...card,overflow:'hidden'}}>{porPub.map(filaDO)}</div>:<div style={{...card,padding:'12px 14px',fontSize:13,color:C.muted}}>Todos los extractos de la notaría están publicados.</div>}
      <div style={{...SEC_LBL,margin:'6px 2px 0'}}>Publicados · {publicados.length}</div>
      {publicados.length>0&&<div style={{...card,overflow:'hidden'}}>
        {(doTodos||hayFiltro?publicados:publicados.slice(0,12)).map(filaDO)}
        {!doTodos&&!hayFiltro&&publicados.length>12&&<button onClick={()=>setDoTodos(true)} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',borderTop:`1px solid ${C.track}`,cursor:'pointer',padding:D?'9px 14px':'9px 12px',width:'100%',textAlign:'left'}}>Ver los {publicados.length}</button>}
      </div>}
    </div>
  const nEnvDocs=listaEnv.reduce((a,e)=>a+e.ds.length,0)
  const secPorAsig=listaEnv.length>0&&<div style={{display:'flex',flexDirection:'column',gap:10}}>
      <div style={{...SEC_LBL,margin:'2px 2px 0'}}>Por asignar · {nEnvDocs} {D?`documento${nEnvDocs!==1?'s':''} `:''}en {listaEnv.length} envío{listaEnv.length!==1?'s':''}</div>
      {listaEnv.slice(0,nEnv).map(tarjetaEnv)}
      {listaEnv.length>nEnv&&<button onClick={()=>setNEnv(n=>n+20)} style={{alignSelf:'flex-start',fontSize:12.5,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:'2px'}}>Ver {Math.min(20,listaEnv.length-nEnv)} envíos más (quedan {listaEnv.length-nEnv})</button>}
    </div>
  const secRegistro=<div style={{display:'flex',flexDirection:'column',gap:8}}>
      <div style={{...SEC_LBL,margin:'4px 2px 0',display:'flex',justifyContent:'space-between'}}><span>En la carpeta de su cliente · {reg.length}</span>{!D&&reg.length>0&&<button onClick={exportar} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,textTransform:'none',letterSpacing:0}}>Excel</button>}</div>
      {ordenG.map(k=>{ const ds=grupos[k], op=hayFiltro||abiertos.has(k)||ordenG.length<=3; return (
        <div key={k} style={{...card,overflow:'hidden'}}>
          <div onClick={()=>!hayFiltro&&setAbiertos(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })} style={{display:'flex',alignItems:'center',gap:8,padding:D?'11px 14px':'10px 12px',cursor:'pointer'}}>
            <span style={{fontSize:13,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>
            <span style={{fontSize:13.5,fontWeight:700,color:C.accent,flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{etq(k)}</span>
            <span style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap'}}>{ds.length} documento{ds.length!==1?'s':''}</span>
            {agrupar==='cliente'&&onOpenClientFicha&&<button onClick={ev=>{ev.stopPropagation();onOpenClientFicha(k)}} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:'0 0 0 4px'}}>Ficha</button>}
          </div>
          {op&&<div style={{borderTop:`1px solid ${C.track}`}}>{ds.map((d,i)=>filaReg(d,i))}</div>}
        </div>) })}
      {!reg.length&&<div style={{...card,padding:20,textAlign:'center',fontSize:13,color:C.muted}}>{hayFiltro?'Ningún documento con esos filtros.':'Ningún documento en la carpeta de un cliente.'}</div>}
    </div>
  const nExt=vivos.filter(d=>pasaBase(d)&&_conceptoDoc(d)==='ext').length
  return (<div style={{display:'flex',flexDirection:'column',gap:12}}>
    {filtros}
    {sub==='ext'&&<div style={{display:'inline-flex',alignSelf:'flex-start',border:`1px solid ${C.border}`,borderRadius:16,overflow:'hidden',background:C.surface}}>
      {[['docs',`Documentos ${nExt}`],['do',`Diario Oficial ${tram.length}`]].map(([k,l])=><button key={k} onClick={()=>setExtVista(k)} style={{fontSize:12,fontWeight:600,padding:'6px 12px',border:'none',cursor:'pointer',background:extVista===k?C.accent:'transparent',color:extVista===k?'#fff':C.muted}}>{l}</button>)}
    </div>}
    {sub==='ult'&&secUltimos}
    {sub==='por'&&(secPorAsig||<div style={{...card,padding:20,textAlign:'center',fontSize:13,color:C.muted}}>{hayFiltro?'Ningún documento por asignar con esos filtros.':'Todos los documentos de la notaría están en la carpeta de su cliente.'}</div>)}
    {sub==='ext'&&extVista==='do'&&secDO}
    {conRegistro&&secPorAsig}
    {conRegistro&&secRegistro}
  </div>)
}

export function PedidosTile({render, bulkImports}){ const {pedidos}=usePedidosNotaria(bulkImports); return render(pedidos===null?undefined:(pedidos[0]||null)) }

export function PedidosNotaria({isDesktop, bulkImports, onRevisar}){
  const {pedidos,recargar}=usePedidosNotaria(bulkImports)
  const [busy,setBusy]=useState(null)
  const D=isDesktop
  const [nombres,setNombres]=useState(_nombresMiembrosCache||{})
  useEffect(()=>{ nombresMiembros().then(m=>setNombres(m)) },[])
  const nomCc=cc=>{ const ns=(cc||[]).map(e=>String(nombres[String(e).toLowerCase()]||(DEMO?({'mp@leabogados.cl':'Martina','mc@leabogados.cl':'Martín'})[e]:null)||String(e).split('@')[0]).split(' ')[0]); return ns.length>1?`${ns.slice(0,-1).join(', ')} y ${ns[ns.length-1]}`:(ns[0]||'') }
  const hm=ts=>{ const d=new Date(ts); return `${fmtFechaDMY(isoLocal(ts))}${D?` · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:''}` }
  const etiqueta=e=>{ const d=e.d||{}
    if(e.action==='notaria.pedido_liquidacion') return `Enviado desde ${String(d.enviado_desde||'contacto@').split('@')[0]}@`
    if(e.action==='notaria.pedido_liquidacion_fallido') return 'El pedido NO se envió'
    if(e.action==='notaria.pedido_sin_respuesta') return D?(d.title||'Tarea de seguimiento'):'Tarea de seguimiento'
    if(e.action==='notaria.seguimiento_liquidacion') return D?(d.title||'Seguimiento enviado'):'Seguimiento enviado'
    if(e.action==='notaria.seguimiento_liquidacion_fallido') return 'El seguimiento NO se envió'
    if(e.action==='notaria.respuesta_liquidacion') return D?(d.title||'Respuesta de la notaría'):(d.con_excel?'Respuesta con Excel':'Respuesta sin liquidación')
    if(e.action==='notaria.aviso_liquidacion') return D?(d.title||'Aviso y tarea de revisión'):'Tarea de revisión'
    if(e.action==='notaria.aviso_liquidacion_fallido') return 'El aviso NO se envió'
    if(e.action==='__carga') return `Liquidación cargada${d.n!=null?` · ${d.n} OT`:''}`
    return e.action }
  const seguir=async x=>{ if(busy) return; setBusy(x.slot)
    try{ if(DEMO){ appAlert('Seguimiento enviado a la notaría desde contacto@ (demo: no sale ningún correo).'); return }
      const {data,error}=await supabase.functions.invoke('notaria-pedir-liquidacion',{body:{seguimiento:{slot:x.slot}}})
      if(error||!data?.enviado) throw new Error(data?.error||error?.message||'sin respuesta del servidor')
      appAlert(`Seguimiento enviado a ${(data.para||[]).join(', ')}${(data.cc||[]).length?`, con copia a ${data.cc.join(', ')}`:''}, desde ${data.desde}.`)
      recargar()
    }catch(e){ appAlert(`El correo NO se envió.\n\n${e.message||e}`) }
    finally{ setBusy(null) } }
  if(pedidos===null) return <div style={{fontSize:12,color:C.muted,padding:'10px 2px'}}>Cargando…</div>
  const pend=pedidos.filter(x=>x.porSeguir)
  const porRev=pedidos.filter(x=>x.estado==='rev')
  const revisar=x=>{ const d=x.resp?.d||{}; if(!d.path){ appAlert('No encontré el Excel guardado de esa respuesta. Ábrelo desde el correo y cárgalo en Carga masiva › Notaría.'); return } onRevisar&&onRevisar({path:d.path,nombre:d.nombre||'Liquidación notaría.xlsx'}) }
  const btn={fontSize:12.5,fontWeight:700,borderRadius:9,border:'none',background:C.accent,color:'#fff',cursor:'pointer',padding:'9px 14px',whiteSpace:'nowrap',minHeight:38}
  return (<div style={{display:'flex',flexDirection:'column',gap:12}}>
    {porRev.map(x=>{ const f=fmtFechaDMY(isoLocal(x.resp.created_at)), d=x.resp.d||{}, quien=String(d.title||'').replace(/^Respuesta de /,'').split(' · ')[0]
      return D
        ? <div key={'r'+x.slot} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{width:32,height:32,borderRadius:9,background:C.azulBg,color:C.azulInfo,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='mail' s={16} c={C.azulInfo}/></span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{`Liquidación recibida el ${f} · por revisar`}</div><div style={{fontSize:12,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[quien,d.nombre?`«${d.nombre}»`:null].filter(Boolean).join(' · ')}</div></div>
            <button onClick={()=>revisar(x)} style={btn}>Revisar liquidación</button>
          </div>
        : <div key={'r'+x.slot} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 12px',display:'flex',flexDirection:'column',gap:9}}>
            <div><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Liquidación por revisar</div><div style={{fontSize:11.5,color:C.muted}}>{`recibida el ${f}`}</div></div>
            <button onClick={()=>revisar(x)} style={{...btn,width:'100%',padding:'10px'}}>Revisar liquidación</button>
          </div> })}
    {pend.map(x=>{ const f=fmtFechaDMY(isoLocal(x.p.created_at))
      return D
        ? <div key={'s'+x.slot} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',display:'flex',alignItems:'center',gap:12}}>
            <span style={{width:32,height:32,borderRadius:9,background:C.soonBg,color:C.soonText,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='mail' s={16} c={C.soonText}/></span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{`Pedido del ${f} sin respuesta`}</div><div style={{fontSize:12,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{`3 días hábiles${x.p.d.desde?` · desde el ${fmtFechaDMY(x.p.d.desde)}`:''}`}</div></div>
            <button disabled={busy===x.slot} onClick={()=>seguir(x)} style={{...btn,opacity:busy===x.slot?.6:1}}>{busy===x.slot?'Enviando…':'Enviar seguimiento'}</button>
          </div>
        : <div key={'s'+x.slot} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 12px',display:'flex',flexDirection:'column',gap:9}}>
            <div><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Pedido sin respuesta</div><div style={{fontSize:11.5,color:C.muted}}>{`${f} · 3 días hábiles`}</div></div>
            <button disabled={busy===x.slot} onClick={()=>seguir(x)} style={{...btn,width:'100%',padding:'10px',opacity:busy===x.slot?.6:1}}>{busy===x.slot?'Enviando…':'Enviar seguimiento'}</button>
          </div> })}
    <div style={{...SEC_LBL,margin:'4px 2px 0'}}>Pedidos de liquidación</div>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      {!pedidos.length&&<div style={{fontSize:12.5,color:C.muted,padding:'12px 14px'}}>Aún no hay pedidos. Salen los días 15 y 30 (o el día hábil siguiente), desde contacto@ a la notaría.</div>}
      {pedidos.map((x,i)=>{ const [lbl,col,bg]=_PED_CHIP[x.estado]; const d=x.p.d||{}
        return <div key={x.slot+'-'+i} style={{display:'flex',gap:12,padding:D?'12px 14px':'11px 12px',borderTop:i?`1px solid ${C.bgSoft}`:'none',minWidth:0}}>
          {diaGrande(isoLocal(x.p.created_at))}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><div style={{fontSize:13.5,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.desde?`Desde el ${fmtFechaDMY(d.desde)}`:'A la fecha'}</div><span style={{fontSize:10,fontWeight:700,borderRadius:20,padding:'2px 9px',whiteSpace:'nowrap',background:bg,color:col}}>{lbl}</span></div>
            <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{D?`A ${(d.to||[]).join(' y ')}${(d.cc||[]).length?` · copia ${nomCc(d.cc)}`:''}`:`A la notaría${(d.cc||[]).length?` · copia ${nomCc(d.cc)}`:''}`}</div>
            <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:4}}>
              {x.eventos.map(e=><div key={e.id} style={{display:'flex',gap:8,alignItems:'baseline',fontSize:12,color:C.text,minWidth:0}}>
                <span style={{color:C.muted,width:D?128:78,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{hm(e.created_at)}</span>
                <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{etiqueta(e)}</span></div>)}
              {x.estado==='rev'&&<div style={{display:'flex',gap:8,fontSize:12}}><span style={{width:D?128:78,flexShrink:0}}/><span onClick={()=>revisar(x)} style={{fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Revisar liquidación ›</span></div>}
            </div>
          </div>
        </div> })}
    </div>
  </div>)
}

// Saldos por razón social (entity) de un cliente. Con 1 RS, todo (incl. sin entity_id) va a esa RS.
// Con 2+ RS, los movimientos sin entity_id quedan en un grupo "Sin razón social". total = suma de todo.
export function rsBalances(clientId, expenses, entities){
  const ents = entities||[]
  const single = ents.length===1
  const buckets = ents.map(e=>({entity:e,fondos:0,gastos:0}))
  const byId={}; buckets.forEach(b=>byId[b.entity.id]=b)
  const sinRS={entity:null,fondos:0,gastos:0,n:0}
  ;(expenses||[]).filter(e=>e.client_id===clientId&&cuentaEnSaldo(e)).forEach(e=>{
    let b
    if(e.entity_id&&byId[e.entity_id]) b=byId[e.entity_id]
    else if(single&&buckets.length) b=buckets[0]
    else { b=sinRS; sinRS.n++ }
    if(e.type==='fondo') b.fondos+=(e.amount||0); else if(!e.no_descuenta_saldo) b.gastos+=(e.amount||0)   // TODOS los gastos cuentan (notaría incluida); solo excluye no_descuenta_saldo (histórico). Ver auditoría fondos.
  })
  const ws = b=>({...b,saldo:b.fondos-b.gastos})
  const porRS = buckets.map(ws)
  const sin = sinRS.n>0 ? ws(sinRS) : null
  const all = porRS.concat(sin?[sin]:[])
  const tot = all.reduce((a,b)=>({fondos:a.fondos+b.fondos,gastos:a.gastos+b.gastos}),{fondos:0,gastos:0})
  return {porRS, sin, total:{...tot,saldo:tot.fondos-tot.gastos}}
}

// Deuda notaría (escritorio): columnas compartidas por la fila del cliente y sus OT → saldo, queda/déficit y monto caen en la misma vertical.
export const NOTA_GC = '18px minmax(0,1fr) auto'

// Responsable de cada cliente para rendir y pedir fondos: ficha; si no, la venta más reciente (fuente única de Rendir a cliente y sus conteos).
export function respClientes(clients, sales){ const m={}; (clients||[]).forEach(c=>{ if(c.abogado_responsable) m[String(c.id)]=c.abogado_responsable }); [...(sales||[])].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).forEach(s=>{ if(s.responsible&&s.client_id&&!m[String(s.client_id)]) m[String(s.client_id)]=s.responsible }); return m }

// Borrador preparado: gastos por rendir que ya estaban cargados el lunes (fecha local de carga; lo cargado después espera al lunes siguiente).
// Independiente de un borrador guardado: si quedó algo fuera (otra razón social, otro trabajo), se vuelve a preparar.
export const esPreparadoCli = (pr, lunes) => pr.some(e=>{ const d=e.created_at?isoLocal(e.created_at):(e.date||''); return !!d && d<lunes })

// Conteo de borradores (preparados por revisar + armados sin enviar) de un abogado o de todos: tarjetas de Gastos y Rendiciones.
export function conteoBorradores({clients, expenses, rendiciones, sales, persona=null}){
  const resp=respClientes(clients,sales), lunes=lunesSemanaISO(), esOfi=c=>!!c&&(c.is_internal||/liberona\s+escala/i.test(c.name||''))
  const arm=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&!r.sent_at&&!r.anulada_at)
  // Borradores = solo los guardados por una persona; con `persona`, los que hizo ella.
  const nArm=arm.filter(r=>{ const c=(clients||[]).find(x=>String(x.id)===String(r.client_id)); return c&&!esOfi(c)&&(!persona||r.user_name===persona) }).length
  return {prep:0, arm:nArm}
}

// Rendiciones en curso sin guardar en este equipo (la selección que RendicionModal guarda a cada cambio): se listan en Borradores para retomarlas.
export function rendicionesEnCurso(clients, expenses, persona=null){ const out=[]
  try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(!k||!k.startsWith('fd_rend_wip_')) continue
      const w=JSON.parse(localStorage.getItem(k)||'null'); if(!w||Date.now()-(w.at||0)>14*86400000) continue
      const [cid,quien]=k.slice(12).split('__')   // formato antiguo (sin persona): se muestra a todos hasta que venza
      if(quien&&persona&&quien!==persona) continue
      const c=(clients||[]).find(x=>String(x.id)===cid); if(!c||_esOfiCliR(c)) continue
      const ids=new Set((w.sel||[]).map(String)), gs=gastosPorRendirCli(expenses,cid).filter(e=>ids.has(String(e.id))); if(!gs.length) continue
      out.push({c, n:gs.length, m:gs.reduce((a,e)=>a+(Number(e.amount)||0),0), at:w.at, proyecto:w.proyecto||null}) } }catch(_){}
  return out.sort((a,b)=>b.at-a.at) }

export const _GASTOS_VOLVER='fd_gastos_volver'

export const gastosVolverLeer = () => { try{ const v=JSON.parse(sessionStorage.getItem(_GASTOS_VOLVER)||'null'); return v&&Date.now()-(v.t||0)<30*60*1000?v:null }catch(_){ return null } }

// Rendición abierta en Gastos: si la página se recarga (el celular la descarta al cambiar de app, o se recarga la ventana) se vuelve a abrir
// donde estaba. Salir dentro de la app la borra (el desmontaje no ocurre en una recarga).
export const _REND_ABIERTA='fd_rend_abierta'

export const rendAbiertaLeer = () => { try{ const v=JSON.parse(sessionStorage.getItem(_REND_ABIERTA)||'null'); return v&&Date.now()-(v.t||0)<2*3600*1000?v:null }catch(_){ return null } }

export const gastosVolverGuardar = v => { try{ sessionStorage.setItem(_GASTOS_VOLVER,JSON.stringify({...v,t:Date.now()})) }catch(_){} }

export function useExpensesModel({expenses,clients,clientEntities,sales=[],onAdd,onEdit,onAddFondo,onBulk,onAssignRS,onAssignClientToExpense,onMoverAOficina,setExpenses,setRendiciones,rendiciones,currentUserName,currentUser,isAdmin,expenseAttachments,setExpenseAttachments,onRendicionComplete,billing,setBilling,pettyCash=[],onAssignCajaChica,onAssignGastoRS,onToggleClientStatus,onCreateOccasional,onSaveClientFields,onOpenClientFicha,expenseAudit=[],openOfi,onOfiOpened,openGastosOfi,onGastosOfiOpened,costosOfiMes=0,onOpenCostosOfi,bulkImports=[]}) {
  const [catMenu,setCatMenu] = useState(null)   // id del gasto de oficina con el menú de categoría abierto
  const [ofiLente,setOfiLente] = useState('estructural')   // vista oficina: 'estructural' (sueldos/arriendo, admin) | 'gestion' (movilización/trámites, equipo)
  const [ofiMesOpen,setOfiMesOpen] = usePersistedState('ofi_mes',null)   // oficina: meses desplegados en la lista (null = sin tocar → abre solo el más reciente)
  const [selectedClient,setSelectedClient] = useState(()=>{ const vm=viewMemLeer('gastos'); return vm?.selId ? ((clients||[]).find(c=>String(c.id)===String(vm.selId))||null) : null })   // volver al cliente abierto tras abrir un gasto (página)
  // Gatillo desde el Dashboard: abrir directo el cliente-oficina (Costos de oficina) en su lente Estructural.
  useEffect(()=>{ if(openOfi){ const ofi=(clients||[]).find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||'')); if(ofi){ setOfiLente('estructural'); setSelectedClient(ofi) } onOfiOpened&&onOfiOpened() } },[openOfi])
  const [notaMenuOpen,setNotaMenuOpen] = useState(false)   // pill "Gastos notariales" desplegada
  const [verArchivadosG,setVerArchivadosG] = useState(false)  // mostrar clientes Terminados en la lista de Gastos
  const [classifyFor,setClassifyFor] = useState(null)   // gasto importado con el menú de clasificación abierto
  const [rsPickFor,setRsPickFor] = useState(null)        // gasto con el selector de razón social abierto (>3 RS o "cambiar")
  const [movExp,setMovExp] = useState(null)              // id del gasto/fondo expandido (detalle al tocar): muestra OT/carga + acciones + Editar
  const [rendOpen,setRendOpen] = useState(new Set())     // secciones "Rendidos" desplegadas (key '__single__' o entity_id)
  const [gastoOrd,setGastoOrd] = useState('desc')        // orden por fecha de la lista de gastos del cliente
  const [gastoCatF,setGastoCatF] = useState('')          // filtro por categoría de gasto ('' = todas)
  const [gastoPagF,setGastoPagF] = useState('')          // filtro 'Pagado por' en la ficha del cliente ('' = todos)
  const [gastoRsF,setGastoRsF] = useState('')            // filtro por razón social en la ficha del cliente ('' = todas)
  useEffect(()=>{ setGastoPagF(''); setGastoRsF('') },[selectedClient?.id])   // al cambiar de cliente, los filtros de la ficha parten limpios
  const [notaLiqOpen,setNotaLiqOpen] = useState(null)    // liquidación a notaría con el detalle desplegado
  const [notaLiqAdd,setNotaLiqAdd] = useState(null)      // liquidación en modo "añadir gastos"
  const [addSel,setAddSel] = useState(new Set())         // gastos pendientes seleccionados para añadir a la liquidación
  const [addSearch,setAddSearch] = useState('')          // buscador del selector "añadir gastos a notaría"
  const [addOpenCli,setAddOpenCli] = useState(new Set()) // clientes expandidos en el selector "añadir gastos a notaría"
  const [liqDetail,setLiqDetail] = useState(null)        // liquidación de caja chica abierta desde la pill "Liquidado"
  // Personas con caja chica activa = quienes tienen fondos entregados en petty_cash.
  const cajaPersons = useMemo(()=>[...new Set((pettyCash||[]).map(p=>p.user_name).filter(Boolean))],[pettyCash])
  const [showOrphans,setShowOrphans] = useState(false)   // bucket "Sin cliente · por asignar"
  const [q,setQ] = useState('')
  const [saldoFilter,setSaldoFilter] = usePersisted('fd_gastos_saldofilter','todos')   // landing: filtro por tarjeta (neg | pos | todos), recordado entre sesiones
  const [showPersonales,setShowPersonales] = useState(false)   // tarjeta de gastos personales por pagar a la oficina
  const [respFilter,setRespFilter] = useState(null)            // filtro por abogado responsable del cliente (null = todos, '__sin__' = sin responsable)
  const [triageOpen,setTriageOpen] = useState(null)            // id del gasto de oficina cuyo triage de miembros está desplegado
  const [subMenu,setSubMenu] = useState(null)                  // id del gasto cuyo menú de subcategoría (desglose) está abierto
  const [respPickG,setRespPickG] = useState(false)            // asignar responsable del cliente desde el encabezado de Gastos
  const asignarRespG = async(m)=>{ if(!onSaveClientFields||!selectedClient) return; try{ await onSaveClientFields(selectedClient.id,{abogado_responsable:m}); setSelectedClient(c=>c?{...c,abogado_responsable:m}:c); setRespPickG(false) }catch(_){} }
  const [attachExpense,setAttachExpense] = useState(null)   // gasto cuyo uploader está abierto
  const [rendEntityIds,setRendEntityIds] = useState([])     // ids de RS pre-seleccionadas al rendir
  const [selRS,setSelRS] = useState(()=>new Set())          // RS seleccionadas (vista 2+ RS)
  const [openRS,setOpenRS] = useState(()=>new Set())        // RS expandidas (acordeón 2+ RS)
  const [rendicionClient,setRendicionClient] = useState(()=>{ const v=rendAbiertaLeer(); return v?((clients||[]).find(c=>String(c.id)===String(v.cid))||null):null })
  const [rendEdit,setRendEdit] = useState(null)   // rendición en edición (abre RendicionModal en modo edición)
  const [showHistorial,setShowHistorial] = useState(false)
  const [histTab,setHistTab] = useState('clientes')   // historial: 'clientes' (rendiciones) | 'notaria' (liquidaciones)
  const [histSinEnv,setHistSinEnv] = useState(false)   // historial filtrado a rendiciones sin enviar (desde la tarjeta «Sin enviar»)
  const [histOrden,setHistOrden] = useState('nuevo')   // orden por fecha: 'nuevo' (más nuevo primero) | 'antiguo'
  const [emailRend,setEmailRend] = useState(null)
  const [devEmailRend,setDevEmailRend] = useState(null)   // reenviar/enviar el correo de devolución de una rendición
  // Filtros del historial (idénticos en ambas pestañas): buscador + Mes + Año
  const [hQ,setHQ] = useState('')
  const [hMes,setHMes] = useState('')   // '' | '01'..'12'
  const [hAnio,setHAnio] = useState('')  // '' | 'YYYY'
  const [showHistorialFicha,setShowHistorialFicha] = useState(false)   // historial dentro de la ficha del cliente
  const [hFichaDesde,setHFichaDesde] = useState('')
  const [hFichaHasta,setHFichaHasta] = useState('')
  const handleAnularRendicion = async(r) => {
    if(!await appConfirm('\u00bfAnular esta rendici\u00f3n? Queda registrada como ANULADA (con su PDF para auditor\u00eda), los gastos vuelven a estar disponibles para rendir y se anula el cobro de reembolso asociado.')) return
    try {
      const now = new Date().toISOString()
      // Foto del PDF ANTES de liberar los gastos: el registro anulado conserva su detalle aunque los gastos queden libres.
      let pdf = r.pdf_html
      if(!pdf){ try{ const cl=clients.find(c=>c.id===r.client_id); pdf=rendicionPdfHtml(r,cl,expenses,clientEntities) }catch(_){} }
      const {error:ue}=await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('client_render_id',r.id)
      if(ue) throw ue   // si no se liberan los gastos, NO marcar anulada (quedarían inconsistentes)
      const reembolsos=await anularReembolsoDeRendicion(r, billing)
      const patch={anulada_at:now, anulada_por:currentUserName||null}
      if(pdf&&!r.pdf_html) patch.pdf_html=pdf
      const {error:re}=await supabase.from('rendiciones').update(patch).eq('id',r.id)
      if(re) throw re
      logActividad('rendicion.anulada',{tabla:'rendiciones',id:r.id,detalle:{cliente:(clients||[]).find(c=>c.id===r.client_id)?.name,title:r.sent_at?`Rendición${r.correlativo?` N° ${r.correlativo}`:''} anulada`:'Borrador de rendición anulado',monto:Math.round(r.total||0),por:patch.anulada_por,gastos:(expenses||[]).filter(e=>e.client_render_id===r.id).map(e=>e.id)},completo:true})
      if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,...patch}:x))
      if(setExpenses) setExpenses(p=>p.map(e=>e.client_render_id===r.id?{...e,client_rendered_at:null,client_render_id:null}:e))
      if(reembolsos.length&&setBilling){ setBilling(p=>p.map(b=>reembolsos.some(x=>x.id===b.id)?{...b,status:'Anulada'}:b)); appAlert(`También se anuló el cobro de reembolso asociado (${reembolsos.map(b=>fmtN(b.amount)).join(', ')}).`) }
    } catch(e) { appAlert('Error: '+e.message) }
  }
  // Eliminar un BORRADOR (nunca enviado): respaldo completo en bitácora, los gastos vuelven a quedar disponibles y se borra la fila.
  const handleEliminarBorrador = async(r) => {
    if(!r||r.sent_at||r.anulada_at) return false
    const gs=(expenses||[]).filter(e=>e.client_render_id===r.id)
    if(!await appConfirm(`¿Eliminar este borrador de rendición?${gs.length?` ${gs.length===1?'El gasto vuelve':`Los ${gs.length} gastos vuelven`} a quedar disponible${gs.length===1?'':'s'} para rendir.`:''}`)) return false
    try {
      const cl=(clients||[]).find(c=>c.id===r.client_id)
      const {pdf_html:_p,...fila}=r
      await logActividad('rendicion.borrador_eliminado',{tabla:'rendiciones',id:r.id,detalle:{cliente:cl?.name,title:'Borrador de rendición eliminado',monto:Math.round(r.total||0),fila,gastos:gs.map(e=>({id:e.id,concepto:e.concept,monto:e.amount}))},completo:true})
      // Primero la fila, y solo si sigue sin enviar: si alguien la envió entretanto, no se toca nada.
      const {data:del,error:de}=await supabase.from('rendiciones').delete().eq('id',r.id).is('sent_at',null).select('id')
      if(de) throw de
      if(!DEMO&&!(del||[]).length) throw new Error('el borrador ya no está disponible (pudo haberse enviado). Recarga la página.')
      const {error:ue}=await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('client_render_id',r.id)
      if(ue) throw new Error('el borrador se eliminó, pero sus gastos no se liberaron: '+ue.message)
      const reembolsos=await anularReembolsoDeRendicion(r, billing)
      if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==r.id))
      if(setExpenses) setExpenses(p=>p.map(e=>e.client_render_id===r.id?{...e,client_rendered_at:null,client_render_id:null}:e))
      if(reembolsos.length&&setBilling) setBilling(p=>p.map(b=>reembolsos.some(x=>x.id===b.id)?{...b,status:'Anulada'}:b))
      return true
    } catch(e) { appAlert('Error: '+e.message); return false }
  }
  // Anula la rendición de UN gasto: lo desvincula y ajusta el total/contador de su rendición (la elimina si queda en 0).
  const anularGastoRendido = async(e, ev) => {
    ev.stopPropagation()
    if(!await appConfirm(`¿Anular la rendición de "${e.concept||'este gasto'}"? Volverá a quedar disponible para rendir.`)) return
    const renderId = e.client_render_id
    try {
      const {error} = await supabase.from('expenses').update({client_rendered_at:null,client_render_id:null}).eq('id',e.id)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,client_rendered_at:null,client_render_id:null}:x))
      if(renderId){
        const r=(rendiciones||[]).find(x=>x.id===renderId)
        if(r){
          const nuevoN=Math.max(0,(r.n_gastos||0)-1), nuevoTotal=(r.total||0)-(e.amount||0)
          if(nuevoN<=0){
            // Al quedar sin gastos, la rendición se borra → también hay que anular su cobro de reembolso (si lo había), o quedaría huérfano cobrable.
            const reembolsos=await anularReembolsoDeRendicion(r, billing)
            await supabase.from('rendiciones').delete().eq('id',renderId); if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==renderId))
            if(reembolsos.length&&setBilling) setBilling(p=>p.map(b=>reembolsos.some(x=>x.id===b.id)?{...b,status:'Anulada'}:b))
          }
          else { await supabase.from('rendiciones').update({total:nuevoTotal,n_gastos:nuevoN}).eq('id',renderId); if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===renderId?{...x,total:nuevoTotal,n_gastos:nuevoN}:x)) }
        }
      }
    } catch(err){ appAlert('Error: '+err.message) }
  }
  // Marcar un gasto de notaría como pagado a la notaría (sale de "por pagar" y de caja chica). Toggle: vuelve a tocar el badge para deshacer.
  // Bitácora de acciones que cambian el saldo de un cliente (quién, qué gasto, cuánto). Prefijo 'gastos.'.
  const _detG = e => ({title:[e.ot_number?String(e.ot_number):null,e.concept].filter(Boolean).join(' · ')||null, name:(clients||[]).find(c=>String(c.id)===String(e.client_id))?.name||null, monto:e.amount})
  // Consulta pendiente sobre un gasto/fondo: queda en Gastos › Revisar › «Por consultar» hasta que se marque resuelta (revision_estado='consultar', revisado_por = a quién).
  const marcarConsulta = async(e, persona) => {
    const patch = persona ? {revision_estado:'consultar', revisado_por:persona, revisado_at:new Date().toISOString()} : {revision_estado:'consulta_resuelta', revisado_at:new Date().toISOString()}
    try {
      const {error} = await supabase.from('expenses').update(patch).eq('id',e.id)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
      logActividad(persona?'gastos.consulta':'gastos.consulta_resuelta',{tabla:'expenses',id:e.id,detalle:{..._detG(e),persona:persona||e.revisado_por||null}})
    } catch(err){ appAlert('Error: '+err.message) }
  }
  const marcarNotariaPagado = async(e, ev) => {
    ev?.stopPropagation()
    const nuevo = e.notaria_liquidado_at ? null : new Date().toISOString()
    try {
      const {error} = await supabase.from('expenses').update({notaria_liquidado_at:nuevo}).eq('id',e.id)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,notaria_liquidado_at:nuevo}:x))
      logActividad(nuevo?'gastos.notaria_pagado':'gastos.notaria_pagado_deshecho',{tabla:'expenses',id:e.id,detalle:_detG(e)})
    } catch(err){ appAlert('Error: '+err.message) }
  }
  const [estadoFor,setEstadoFor] = useState(null)   // id del gasto con el menú "Estado" abierto
  // Clasifica un gasto antiguo de cliente: histórico (no descuenta el saldo) o descuenta. modo null = deshacer (vuelve al default que sí descuenta).
  const marcarEstado = async(e, modo) => {
    // 'incobrable' = deuda que la oficina asume: sale del saldo del cliente y queda marcada (fecha y quién) para filtrar/sumar.
    const sinInc = {incobrable_at:null, incobrable_by:null}
    const patch = modo==='historico' ? {pagado_cliente_at:new Date().toISOString(), no_descuenta_saldo:true, ...sinInc}
                : modo==='descuenta' ? {pagado_cliente_at:new Date().toISOString(), no_descuenta_saldo:false, ...sinInc}
                : modo==='incobrable' ? {no_descuenta_saldo:true, incobrable_at:new Date().toISOString(), incobrable_by:currentUser?.email||currentUserName||null}
                : {pagado_cliente_at:null, no_descuenta_saldo:false, ...sinInc}
    try {
      const {error} = await supabase.from('expenses').update(patch).eq('id',e.id)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
      logActividad('gastos.estado_'+(modo||'deshecho'),{tabla:'expenses',id:e.id,detalle:_detG(e)})
    } catch(err){ appAlert('Error: '+err.message) }
  }
  // Clasifica en lote los gastos seleccionados en el overlay "Clasificar pagos".
  const clasifBulk = async(modo) => {
    const ids=[...selClasif]; if(!ids.length) return
    const patch = modo==='historico' ? {pagado_cliente_at:new Date().toISOString(), no_descuenta_saldo:true} : {pagado_cliente_at:new Date().toISOString(), no_descuenta_saldo:false}
    try {
      const {error}=await supabase.from('expenses').update(patch).in('id',ids)
      if(error) throw error
      if(setExpenses) setExpenses(p=>p.map(x=>ids.includes(x.id)?{...x,...patch}:x))
      logActividad('gastos.clasificados_'+modo,{tabla:'expenses',detalle:(expenses||[]).filter(x=>ids.includes(x.id)).map(_detG)})
      setSelClasif(new Set())
    } catch(err){ appAlert('Error: '+err.message) }
  }
  const [asignandoRS,setAsignandoRS] = useState(null) // client_id cuyo selector de RS esta abierto
  const [expandRend,setExpandRend] = useState(null)   // id de la rendición con el detalle desplegado

  const balances = useMemo(()=>{
    const m={}
    expenses.forEach(e=>{
      if(!m[e.client_id]) m[e.client_id]={fondos:0,gastos:0,sinAsignar:0}
      if(!cuentaEnSaldo(e)) return   // resumido en el saldo de apertura
      if(e.type==='fondo') m[e.client_id].fondos+=(e.amount||0)
      else if(!e.no_descuenta_saldo) m[e.client_id].gastos+=(e.amount||0)   // saldo = fondos transferidos − gastos realizados. TODOS los gastos cuentan (notaría incluida, la pague quien la pague); solo se excluye no_descuenta_saldo (histórico ya saldado fuera de la app). NO excluir paid_by_client: la notaría es un gasto realizado que consume el fondo o genera deuda del cliente.
      if(!e.entity_id) m[e.client_id].sinAsignar+=1
    })
    return m
  },[expenses])


  // Clientes con movimientos, ordenados: negativos primero, luego por nombre. EXCLUYE la oficina (Liberona Escala /
  // is_internal): sus costos reales (sueldos/arriendo/servicios) viven en la card "Costos de oficina", no en la lista operativa.
  const clientsWithMovs = useMemo(()=>{
    return clients
      .filter(c=>balances[c.id] && !(c.is_internal || /liberona\s+escala/i.test(c.name||'')))
      .sort((a,b)=>{
        const sa=(balances[a.id]?.fondos||0)-(balances[a.id]?.gastos||0)
        const sb=(balances[b.id]?.fondos||0)-(balances[b.id]?.gastos||0)
        if(sa<0&&sb>=0) return -1
        if(sb<0&&sa>=0) return 1
        return (a.name||'').localeCompare(b.name||'','es')
      })
  },[clients,balances])

  const archivadosG = useMemo(()=>clientsWithMovs.filter(c=>c.status==='Terminado').length,[clientsWithMovs])
  const filteredClients = useMemo(()=>{
    let list = verArchivadosG ? clientsWithMovs.filter(c=>c.status==='Terminado') : clientsWithMovs.filter(c=>c.status!=='Terminado')
    if(q.trim()){
      const nq=q.toLowerCase()
      list = list.filter(c=>{
        if(_normTxt(c.name).includes(_normTxt(nq))) return true
        if((c.rut||'').toLowerCase().includes(nq)) return true
        return (clientEntities||[]).some(e=>e.client_id===c.id&&(((e.name||'').toLowerCase().includes(nq))||((e.rut||'').toLowerCase().includes(nq))))
      })
    }
    if(respFilter) list = list.filter(c=> respFilter==='__sin__' ? !c.abogado_responsable : c.abogado_responsable===respFilter)
    return list
  },[clientsWithMovs,q,verArchivadosG,clientEntities,respFilter])

  // Quién pagó cada gasto (filtro y etiqueta de la ficha): la caja chica de quien tiene caja (lo cargó o lo liquidó), la notaría o la oficina.
  const cajaNombres = useMemo(()=>new Set((pettyCash||[]).map(p=>p.user_name).filter(Boolean)),[pettyCash])
  const pagadoPorGasto = e => { if(!e||e.type==='fondo') return 'Fondo'; if(e.rendered_at||cajaNombres.has(e.created_by)) return `Caja chica ${e.created_by||''}`.trim(); if(e.notaria_liquidado_at||e.category==='Notaria') return 'Notaría'; return 'Oficina' }
  const filtered = useMemo(()=>{
    if(!selectedClient) return []
    const ofi = selectedClient.is_internal || /liberona\s+escala/i.test(selectedClient.name||'')
    if(!isAdmin && ofi){   // limited: en la oficina ve SOLO los gastos que él cargó (su lote) o registró
      const mis=new Set((bulkImports||[]).filter(b=>b.created_by===currentUserName).map(b=>String(b.id)))
      return expenses.filter(e=>e.client_id===selectedClient.id && !e.deleted_at && ((e.bulk_import_id&&mis.has(String(e.bulk_import_id)))||e.created_by===currentUserName)).sort((a,b)=> gastoOrd==='asc'?(new Date(a.date||0)-new Date(b.date||0)):(new Date(b.date||0)-new Date(a.date||0)))
    }
    let l = expenses.filter(e=>e.client_id===selectedClient.id)
    if(ofi) l = l.filter(e=> (ofiLente==='gestion')===esGestionGasto(e))   // oficina: lente Estructural ⇄ Gestión (mismo criterio que la foto)
    if(gastoCatF) l = l.filter(e=> gastoCatF==='Fondo' ? e.type==='fondo' : gastoCatF==='__gastos__' ? e.type!=='fondo' : (e.type!=='fondo' && (e.category||'Otro')===gastoCatF))
    if(gastoPagF) l = l.filter(e=> pagadoPorGasto(e)===gastoPagF)
    if(gastoRsF) l = l.filter(e=> String(e.entity_id||'')===String(gastoRsF))
    const _ck=e=>`${String(e.date||'')}|${String(e.created_at||'')}|${String(e.id||'')}`   // mismo día → por orden de registro (igual que el saldo acumulado)
    return l.sort((a,b)=> gastoOrd==='asc' ? _ck(a).localeCompare(_ck(b)) : _ck(b).localeCompare(_ck(a)))
  },[expenses,selectedClient,gastoOrd,gastoCatF,gastoPagF,gastoRsF,isAdmin,ofiLente,bulkImports,currentUserName,cajaNombres])
  // Saldo del cliente DESPUÉS de cada movimiento (orden cronológico; misma regla que fgCliente: fondos suman, gastos que descuentan restan).
  const saldoTras = useMemo(()=>{ const m={}; if(!selectedClient) return m; let s=0
    ;(expenses||[]).filter(e=>e.client_id===selectedClient.id&&!e.deleted_at&&cuentaEnSaldo(e)).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.created_at||'').localeCompare(String(b.created_at||''))||String(a.id||'').localeCompare(String(b.id||''))).forEach(e=>{ if(e.type==='fondo') s+=(e.amount||0); else if(!e.no_descuenta_saldo) s-=(e.amount||0); m[e.id]=s })
    return m },[expenses,selectedClient])
  const gastoCats = useMemo(()=> selectedClient ? [...new Set(expenses.filter(e=>e.client_id===selectedClient.id).map(e=> e.type==='fondo'?'Fondo':(e.category||'Otro')))].sort() : [],[expenses,selectedClient])
  const gastoToolbar = () => {
    const ofiSel = selectedClient && esOficina(selectedClient.id)
    const movibles = selectedClient ? (expenses||[]).filter(e=> String(e.client_id)===String(selectedClient.id) && e.type==='gasto' && !e.deleted_at && !e.client_render_id && !e.render_id && !e.notaria_render_id && (!ofiSel || (ofiLente==='gestion')===esGestionGasto(e))) : []
    const showMover = selectedClient && movibles.length>0   // también la oficina: mover a su cliente los gastos que en realidad son de un cliente (trámites)
    return (<>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8,flexWrap:'wrap'}}>
        <button onClick={()=>setGastoOrd(o=>o==='desc'?'asc':'desc')} title={gastoOrd==='desc'?'Más nuevas primero':'Más antiguas primero'} style={{fontSize:11,fontWeight:600,padding:'5px 11px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>Fecha {gastoOrd==='desc'?'↓':'↑'}</button>
        {gastoCats.length>1&&<select value={gastoCatF==='__gastos__'?'':gastoCatF} onChange={e=>setGastoCatF(e.target.value)} aria-label='Categoría' style={{fontSize:12,padding:'5px 9px',borderRadius:8,border:`1px solid ${gastoCatF&&gastoCatF!=='__gastos__'?C.accent:C.border}`,background:gastoCatF&&gastoCatF!=='__gastos__'?C.azulBg:'#fff',color:gastoCatF&&gastoCatF!=='__gastos__'?C.accent:C.muted}}><option value=''>Todas las categorías</option>{gastoCats.map(c=><option key={c} value={c}>{c}</option>)}</select>}
        {selectedClient&&!ofiSel&&(()=>{ const pags=[...new Set((expenses||[]).filter(e=>String(e.client_id)===String(selectedClient.id)&&e.type!=='fondo'&&!e.deleted_at).map(pagadoPorGasto))].sort(); return pags.length>1&&<select value={gastoPagF} onChange={e=>setGastoPagF(e.target.value)} aria-label='Pagado por' style={{fontSize:12,padding:'5px 9px',borderRadius:8,border:`1px solid ${gastoPagF?C.accent:C.border}`,background:gastoPagF?C.azulBg:'#fff',color:gastoPagF?C.accent:C.muted}}><option value=''>Pagado por</option>{pags.map(x=><option key={x} value={x}>{x}</option>)}</select> })()}
        {selectedClient&&!ofiSel&&selEnts.length>1&&<select value={gastoRsF} onChange={e=>setGastoRsF(e.target.value)} aria-label='Razón social' style={{fontSize:12,padding:'5px 9px',borderRadius:8,border:`1px solid ${gastoRsF?C.accent:C.border}`,background:gastoRsF?C.azulBg:'#fff',color:gastoRsF?C.accent:C.muted,maxWidth:200}}><option value=''>Razón social</option>{selEnts.map(x=><option key={x.id} value={x.id}>{rsDisplay(x.name)}</option>)}</select>}
        {showMover&&<button onClick={()=>{setMovMode(o=>!o);setMovSel(new Set())}} title='Mover gastos a otro cliente' style={{...chipBtn('soft'),fontWeight:500,whiteSpace:'nowrap',marginLeft:'auto'}}>Mover {movMode?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>}
      </div>
      {showMover&&movMode&&(
        <div style={{marginTop:-2,marginBottom:8,background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px'}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:7}}>Marca los gastos que NO son de {selectedClient.name} y muévelos a otro cliente.</div>
          <div style={{display:'flex',flexDirection:'column',gap:7,maxHeight:280,overflowY:'auto'}}>
            {movibles.map(e=>{ const on=movSel.has(e.id); return (
              <div key={e.id} onClick={()=>setMovSel(p=>{const n=new Set(p);n.has(e.id)?n.delete(e.id):n.add(e.id);return n})} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer',fontSize:11}}>
                <span style={{width:16,height:16,borderRadius:4,flexShrink:0,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
                {e.ot_number&&<span style={{color:C.azulInfo,fontWeight:600,flexShrink:0}}>{fmtOt(e.ot_number)}</span>}
                <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{e.concept||'—'}</span>
                <span style={{fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{fmt(e.amount)}</span>
              </div>) })}
          </div>
          {movSel.size>0 && (
            <div style={{marginTop:9,paddingTop:9,borderTop:`0.5px solid ${C.border}`}}>
              <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:5}}>Mover {movSel.size} gasto{movSel.size!==1?'s':''} a:</div>
              <ClientePicker clients={clients.filter(c=>String(c.id)!==String(selectedClient.id))} onPick={async cid=>{ for(const id of [...movSel]){ await onAssignClientToExpense(id,cid) } setMovSel(new Set()); setMovMode(false) }}/>
            </div>
          )}
        </div>
      )}
    </>)
  }
  // Gastos huérfanos (sin cliente) — provienen de "Importar todo" en carga masiva.
  const orphans = useMemo(()=>(expenses||[]).filter(e=>!e.client_id&&!e.personal_de).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)),[expenses])
  // ── Asistente IA de "Sin asignar": resuelve solo el cliente de cada gasto huérfano ──────────
  // Cascada (reusa la infra existente): 1) RUT exacto (resolverClienteSII) · 2) glosa aprendida
  // (learnings gasto_cliente/cargo_cliente, misma llave glosaKey que Caja Chica) · 3) IA para el
  // resto. Auto-asigna lo de ALTA confianza (RUT/glosa aprendida); lo dudoso queda para confirmar.
  // Aprende al aplicar (learnPut gasto_cliente) → compounde con Caja Chica y no vuelve a preguntar.
  const [orfSug,setOrfSug] = useState({})        // {expId:{client_id,name,conf,via}}
  const [orfBusy,setOrfBusy] = useState(false)
  const [orfRan,setOrfRan] = useState(false)
  const [orfAuto,setOrfAuto] = useState({})      // {expId:{name,client_id,concept,amount,via}} asignados esta sesión
  const [orfAutoOpen,setOrfAutoOpen] = useState(false)
  const [orfQ,setOrfQ] = useState('')            // buscador
  const [orfPickFor,setOrfPickFor] = useState(null)  // id con picker manual abierto ("otro")
  const aplicarOrf = async(e,client_id)=>{
    if(!client_id) return
    try{ await onAssignClientToExpense(e.id,client_id) }catch(_){}
    const gk=glosaKey(e.concept||''); if(gk){ try{ learnPut('gasto_cliente',gk,client_id) }catch(_){} }
    setOrfSug(p=>{ const n={...p}; delete n[e.id]; return n }); setOrfPickFor(null)
  }
  const deshacerOrf = async(e)=>{
    try{ await onAssignClientToExpense(e.id,null) }catch(_){}
    setOrfAuto(p=>{ const n={...p}; delete n[e.id]; return n })
  }
  const runOrfAsistente = async()=>{
    setOrfBusy(true); setOrfRan(false)
    try{
      const learned={}
      try{
        const [{data:lg},{data:lc}] = await Promise.all([
          supabase.from('learnings').select('key,value').eq('kind','gasto_cliente').order('updated_at',{ascending:true}),
          supabase.from('learnings').select('key,value').eq('kind','cargo_cliente').order('updated_at',{ascending:true}),
        ])
        ;(lg||[]).forEach(r=>{ if(r.key&&r.value) learned[r.key]=r.value })
        ;(lc||[]).forEach(r=>{ if(r.key&&r.value&&!learned[r.key]) learned[r.key]=r.value })
      }catch(_){}
      const sug={}, needIA=[]
      orphans.forEach(e=>{
        const rut=e.rut||e.receptor_rut||''
        if(rut){ const c=resolverClienteSII(rut,'',clients,clientEntities); if(c&&c.status!=='Terminado'){ sug[e.id]={client_id:c.id,name:c.name,conf:97,via:`RUT ${rut}`}; return } }
        const gk=glosaKey(e.concept||'')
        if(gk&&learned[gk]){ const c=clients.find(x=>String(x.id)===String(learned[gk])); if(c&&c.status!=='Terminado'){ sug[e.id]={client_id:c.id,name:c.name,conf:90,via:'glosa aprendida'}; return } }
        needIA.push(e)
      })
      if(needIA.length){
        const clientList=clients.filter(c=>c.status!=='Terminado').map(c=>({id:c.id,nombre:c.name}))
        const prompt=`Eres asistente contable del estudio ${BRAND.nombre}. Te paso GASTOS sin cliente y la lista de CLIENTES. Para cada gasto sugiere el cliente (id de la lista) más probable según la glosa y el monto. Si no es claro, usa null. Devuelve SOLO un JSON array: [{"id":"<id del gasto>","client_id":"<id o null>"}]. NUNCA inventes un client_id fuera de la lista.\nCLIENTES: ${JSON.stringify(clientList)}\nGASTOS: ${JSON.stringify(needIA.map(e=>({id:e.id,glosa:e.concept||'',monto:e.amount||0,fecha:e.date||''})))}`
        try{
          const j=await claudeCall({model:'claude-opus-4-8',max_tokens:1500,messages:[{role:'user',content:prompt}]})
          const txt=j?.content?.[0]?.text||''; const m=txt.match(/\[[\s\S]*\]/); const arr=m?JSON.parse(m[0]):[]
          arr.forEach(o=>{ const e=needIA.find(x=>String(x.id)===String(o.id)); if(!e||!o.client_id) return; const c=clients.find(x=>String(x.id)===String(o.client_id)); if(!c||c.status==='Terminado') return; sug[e.id]={client_id:c.id,name:c.name,conf:70,via:'IA'} })
        }catch(_){}
      }
      setOrfSug(sug)
      // Auto-asigna lo de ALTA confianza (RUT exacto o glosa ya aprendida) — reversible.
      const altos=orphans.filter(e=>sug[e.id]&&sug[e.id].conf>=90)
      const auto={}
      for(const e of altos){ auto[e.id]={name:sug[e.id].name,client_id:sug[e.id].client_id,concept:e.concept,amount:e.amount,via:sug[e.id].via}; await aplicarOrf(e,sug[e.id].client_id) }
      setOrfAuto(auto)
    }catch(_){}
    setOrfBusy(false); setOrfRan(true)
  }
  // Proactivo: al abrir "Sin cliente · por asignar", el asistente sugiere SOLO (una vez), listo para confirmar —
  // así el usuario no tiene que acordarse de correrlo. Auto-asigna lo de alta confianza y deja lo dudoso a un toque.
  useEffect(()=>{ if(showOrphans && !DEMO && orphans.length>0 && !orfRan && !orfBusy) runOrfAsistente() }, [showOrphans])   // eslint-disable-line
  // Revisión de carga: gastos pegados a un cliente NO activo (Terminado/Prospecto) o a un ocasional → para revisar/corregir.
  const clientById = useMemo(()=>{ const m={}; (clients||[]).forEach(c=>{m[String(c.id)]=c}); return m },[clients])
  const revGroup = items => { const g={}; items.forEach(e=>{ const k=String(e.client_id); (g[k]=g[k]||{c:clientById[k],gastos:[]}).gastos.push(e) }); return Object.values(g).filter(x=>x.c).sort((a,b)=>b.gastos.length-a.gastos.length) }
  const revNoActivo = useMemo(()=>revGroup((expenses||[]).filter(e=>{ if(e.deleted_at||!e.client_id||e.type==='fondo') return false; const c=clientById[String(e.client_id)]; return c && !c.is_internal && !c.is_occasional && c.status && c.status!=='Activo' })),[expenses,clientById])
  const revOcasional = useMemo(()=>revGroup((expenses||[]).filter(e=>{ if(e.deleted_at||e.type==='fondo') return false; const c=clientById[String(e.client_id)]; return c && c.is_occasional })),[expenses,clientById])
  const [revOpen,setRevOpen] = useState(null)
  const [showRevision,setShowRevision] = useState(false)   // panel "Gastos por revisar" (on-demand desde el menú Cargar)
  const [showReasignar,setShowReasignar] = useState(false) // herramienta "Reasignar gastos" (mover gastos de un cliente a otro)
  const [reasignFrom,setReasignFrom] = useState(null)      // cliente origen elegido en Reasignar gastos
  const [revSel,setRevSel] = useState(()=>new Set())       // selección múltiple en "Gastos por revisar" / "Reasignar"
  const toggleSel = id => setRevSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n })
  const [revDupConfirm,setRevDupConfirm] = useState(null)   // confirmación si al mover hay gastos iguales en el destino
  const [showHist,setShowHist] = useState(false)   // historial de reasignaciones (trazabilidad)
  const [showDescuadres,setShowDescuadres] = useState(false)   // worklist de descuadres (desde la card Saldo negativo)
  const [descOpen,setDescOpen] = useState(null)   // cliente expandido en el worklist de descuadres
  const doMove = async (ids,cid)=>{ for(const id of ids){ await onAssignClientToExpense(id,cid) } setRevSel(new Set()); setRevDupConfirm(null) }
  // Mover los seleccionados a un cliente; si el destino ya tiene iguales (monto+descripción+categoría), pide confirmación.
  const revMoverA = (cid)=>{
    const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim()
    const sel=(expenses||[]).filter(e=>revSel.has(e.id))
    const dest=(expenses||[]).filter(e=>!e.deleted_at&&String(e.client_id)===String(cid))
    const dupIds=sel.filter(g=>dest.some(e=>String(e.id)!==String(g.id)&&(e.amount||0)===(g.amount||0)&&norm(e.concept)===norm(g.concept)&&(e.category||'')===(g.category||''))).map(g=>g.id)
    const all=sel.map(g=>g.id)
    if(dupIds.length===0){ doMove(all,cid); return }
    setRevDupConfirm({cid, name:(clients.find(c=>String(c.id)===String(cid))?.name||'el cliente'), dups:dupIds, all, unique:all.filter(id=>!dupIds.includes(id))})
  }   // grupo de revisión abierto: 'na' | 'oc'
  const [revPick,setRevPick] = useState(null)   // id del gasto con buscador de reasignación abierto
  const revN = grp => grp.reduce((a,x)=>a+x.gastos.length,0)

  // ── Liquidación de NOTARÍA (sección dentro de Gastos): gastos categoría Notaria que la oficina paga a la notaría ──
  // Marca propia notaria_render_id (independiente de caja chica y de la rendición al cliente). La preparan los limited; visible para admin.
  const [showNotaria,setShowNotaria] = useState(()=>!!gastosVolverLeer()?.nota||!!viewMemLeer('gastos')?.showNotaria)
  const [showClasificar,setShowClasificar] = useState(false)   // overlay "Clasificar pagos" (histórico/descuenta en lote)
  const [showGastosOficina,setShowGastosOficina] = useState(false)   // vista "Gastos oficina": varios que la oficina absorbe + personales del equipo
  const [showBuscarClientes,setShowBuscarClientes] = useState(()=>!!viewMemLeer('gastos')?.showBuscarClientes) // dentro de Clientes: la lista (buscador + por abogado) vive tras la tarjeta "Buscar clientes"
  const [showRendiciones,setShowRendiciones] = useState(()=>!!viewMemLeer('gastos')?.showRendiciones||!!rendAbiertaLeer()?.sub)   // vista propia "Rendiciones" (hub): 3 tarjetas Rendir · Pendientes · Historial
  const [rendSub,setRendSub] = useState(()=>viewMemLeer('gastos')?.rendSub||rendAbiertaLeer()?.sub||null)
  useEffect(()=>{ try{ if(rendicionClient&&!rendEdit) sessionStorage.setItem(_REND_ABIERTA,JSON.stringify({cid:rendicionClient.id,sub:showRendiciones?rendSub:null,t:Date.now()})); else sessionStorage.removeItem(_REND_ABIERTA) }catch(_){} },[rendicionClient?.id,rendEdit])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{ try{ sessionStorage.removeItem(_REND_ABIERTA) }catch(_){} },[])                    // sub-vista de Rendiciones: null=3 tarjetas · 'rendir' (buscar cliente) · 'pend' (+90 días)
  const [revSub,setRevSub] = useState(null)                      // sub-vista de Gastos por revisar: null=3 tarjetas · 'archivados' · 'ocasionales'
  const [selClasif,setSelClasif] = useState(()=>new Set())
  const [clasifSearch,setClasifSearch] = useState('')
  const [clasifOpen,setClasifOpen] = useState(()=>new Set())
  const [movMode,setMovMode] = useState(false)   // "Mover varios" desplegable en la ficha del cliente
  const [movSel,setMovSel] = useState(()=>new Set())
  const [selNota,setSelNota] = useState(()=>new Set())
  const [excepNota,setExcepNota] = useState(()=>new Set())   // clientes con "Permitir adelanto" activado (excepción explícita)
  const [notaSending,setNotaSending] = useState(false)
  const [reenviando,setReenviando] = useState(null)   // id de la liquidación de notaría que se está reenviando
  const [notaConfirm,setNotaConfirm] = useState(false)
  // Correos por defecto de la notaría (Lascar): se precargan siempre; si el equipo guarda otros, esos mandan.
  const NOTARIA_DEFAULT = 'sdelgado@notarialascar.cl, sdanotaria@gmail.com'
  // El destino de la notaría NUNCA debe ser una dirección @leabogados.cl (el estudio va en Cc). Filtra esas y, si queda vacío, usa el default. Auto-repara valores guardados erróneos (p.ej. tras una prueba).
  const cleanNotaDest = s => String(s||'').split(/[,;]/).map(x=>x.trim()).filter(x=>x.includes('@')&&!/@leabogados\.cl$/i.test(x)).join(', ')
  const [notaEmail,setNotaEmail] = useState(()=>{ try{return cleanNotaDest(localStorage.getItem('notaria_email'))||NOTARIA_DEFAULT}catch(_){return NOTARIA_DEFAULT} })
  // Correo(s) de la notaría: compartido para todo el equipo (no solo este dispositivo). Lo guardado manda sobre el localStorage.
  useEffect(()=>{ supabase.from('learnings').select('value').eq('kind','notaria_email').order('updated_at',{ascending:false}).limit(1).then(({data})=>{ const v=cleanNotaDest(data&&data[0]&&data[0].value); if(v) setNotaEmail(v) },()=>{}) },[])
  const [notaSend,setNotaSend] = useState(null)   // rendición en la PÁGINA "Pagar a la notaría" (o null)
  const [compFile,setCompFile] = useState(null)   // comprobante de transferencia adjunto (File)
  const [notaTab,setNotaTab] = useState(()=>gastosVolverLeer()?.nota||viewMemLeer('gastos')?.notaTab||'hub')
  const [docSub,setDocSub] = useState(null)   // Notaría › Documentos: subcategoría abierta (null = hub de tarjetas)   // sub-hub de Notaría: hub | pend (Deuda) | cobros | pagados | enviar (Pagar a la notaría)
  // Borrador EDITABLE del correo a la notaría (se inicializa al abrir el envío). El detalle de OT + total se anexa solo.
  const [notaMsg,setNotaMsg] = useState('')
  const [notaSubject,setNotaSubject] = useState('')
  const [notaBolRS,setNotaBolRS] = useState('')     // razón social a la que se piden las boletas
  const [notaBolRUT,setNotaBolRUT] = useState('')   // RUT para las boletas
  const [notaBolPick,setNotaBolPick] = useState(false)   // picker de cliente para autocompletar RS/RUT
  const [notaOrigen,setNotaOrigen] = useState(null)   // desde dónde se abrió 'Pagar a la notaría' ('historial' → volver ahí)
  const [notaHistOpen,setNotaHistOpen] = useState(false) // link discreto "ya pagada, sin correo"
  // Abre el ENVÍO como PÁGINA (notaTab='enviar', no modal). Inicializa el borrador (boletas por defecto = el estudio).
  const abrirEnvioNotaria = (r) => {
    if(!r) return
    setCompFile(null); setNotaBolPick(false); setNotaHistOpen(false)
    const gs=(expenses||[]).filter(e=>String(e.notaria_render_id)===String(r.id))
    const periodo=r.periodo||periodoNota(gs)
    const rs=BRAND.nombreLegal, rut=BRAND.rut
    setNotaBolRS(rs); setNotaBolRUT(rut)
    setNotaMsg(notaDefaultMsg(periodo, rs, rut))
    // Boletas a nombre de: si toda la liquidación es de un cliente y la última vez se pidieron a su razón social, se propone esa.
    const cidsB=[...new Set(gs.map(e=>e.client_id).filter(Boolean))]
    if(!DEMO&&cidsB.length===1) supabase.from('learnings').select('value').eq('kind','notaria_boletas').eq('key',String(cidsB[0])).maybeSingle().then(({data})=>{ let v=data?.value; try{ if(typeof v==='string') v=JSON.parse(v) }catch(_){ v=null }
      if(v&&v.rs){ setNotaBolRS(v.rs); setNotaBolRUT(v.rut||''); setNotaMsg(m=>String(m||'').includes(BRAND.nombreLegal)?notaDefaultMsg(periodo, v.rs, v.rut||''):m) } }).catch(()=>{})
    // OT que marcamos como "no nuestras" y siguen sin resolver: el correo de pago lo dice (por eso no se incluyen en la transferencia).
    if(!DEMO) supabase.from('notaria_no_nuestras').select('ot,monto,materia,estado,resolucion').then(({data})=>{
      const pend=(data||[]).filter(x=>x.estado!=='resuelta'&&x.resolucion!=='era_nuestra'); if(!pend.length) return
      const pl=pend.length>1
      const lista=pend.map(x=>`• OT ${String(x.ot).replace(/^OT-?/i,'')}${x.materia?` · ${x.materia}`:''}${Number(x.monto)?` · $${Number(x.monto).toLocaleString('es-CL')}`:''}`).join('\n')
      const p=`\n\nAdemás, en su estado de cuenta aparece${pl?'n las siguientes OT, que no corresponden':' la siguiente OT, que no corresponde'} a trabajos de nuestra oficina, por lo que no ${pl?'las':'la'} incluimos en este pago. Les agradeceremos revisar${pl?'las':'la'}:\n${lista}`
      setNotaMsg(m=>{ if(String(m||'').includes('no corresponde')) return m; const i=String(m||'').indexOf('\n\nQuedamos atentos'); return i>=0?m.slice(0,i)+p+m.slice(i):String(m||'')+p })
    }).catch(()=>{})
    setNotaSubject(`Liquidación de gastos y comprobante de transferencia · ${BRAND.nombre} · ${periodo}`)
    setNotaOrigen(showHistorial?'historial':null); setShowHistorial(false)   // si venía de Historial, el título y el 'volver' lo saben
    setNotaSend(r); setShowNotaria(true); setNotaTab('enviar')
  }
  // Aplica "boletas a nombre de X" reemplazando esa línea en el borrador (si el usuario ya la borró, no la re-inventa).
  const aplicarBoletas = (rs, rut) => {
    setNotaBolRS(rs); setNotaBolRUT(rut)
    setNotaMsg(m=>{ const re=/Las boletas correspondientes deben emitirse a nombre de [^\n]*?, RUT [^\n]*?\./
      const linea=`Las boletas correspondientes deben emitirse a nombre de ${rs}, RUT ${rut}.`
      return re.test(m) ? m.replace(re, linea) : m })
  }
  const [notaResp,setNotaResp] = useState(null)   // filtro de pendientes por abogado responsable del cliente ('__sin__'=sin responsable)
  // Deuda con la notaría = OT (la OT es la fuente de la verdad): un gasto de categoría Notaría sin N° de OT no es deuda con la notaría.
  const notariaPend = useMemo(()=>notariaPendientes(expenses).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1),[expenses])   // regla única _shared/notariaReglas.js
  // Gastos de notaría por $1 (o menos): escrituras/trabajos anulados, solo orden — no se liquidan, se pueden eliminar.
  const notariaAnulados = useMemo(()=>(expenses||[]).filter(e=>e.type!=='fondo'&&e.category==='Notaria'&&!e.notaria_render_id&&(Number(e.amount)||0)<=1).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1),[expenses])
  const [notaAnulOpen,setNotaAnulOpen] = useState(false)
  const eliminarGastoNota = async(e)=>{ if(!await appConfirm('¿Eliminar este gasto anulado? Va a la papelera (reversible).')) return; try{ await supabase.from('expenses').update({deleted_at:new Date().toISOString()}).eq('id',e.id); setExpenses(p=>p.filter(x=>x.id!==e.id)); logActividad('notaria.eliminado',{tabla:'expenses',id:e.id,detalle:{title:[e.ot_number?fmtOt(e.ot_number):null,e.concept].filter(Boolean).join(' · '),monto:e.amount}}) }catch(err){appAlert('Error: '+err.message)} }
  const notaSel = notariaPend.filter(e=>selNota.has(e.id))
  const notaTotal = notaSel.reduce((a,e)=>a+(e.amount||0),0)
  // Disponible REAL para pagar notaría de un cliente = fondo − ya pagado (caja chica + notaría pagada) − reservado para
  // OTROS gastos pendientes del cliente (no la notaría que estás liquidando). Así el fondo se reparte entre todo lo que debe.
  const dispCliente = cid => disponibleNotaria(expenses, cid, { esOficina })   // regla única _shared/notariaReglas.js (la usa también el análisis de la notaría)
  // Mismo criterio que dispCliente, sobre el libro personal (personal_de sin cliente): p. ej. el fondo por rendir que un tercero dejó para un socio.
  // Cuenta personal: un fondo con gastos ligados (reembolso_fondo_id, p. ej. el que deja un tercero para un socio) cubre SOLO esos gastos;
  // el resto se cubre con el saldo propio (fondos de uso general − gastos sin fondo). Misma regla que la página Cuenta personal.
  const _esNotaPendP=e=>e.category==='Notaria'&&/\d/.test(String(e.ot_number||''))&&!e.notaria_render_id&&!e.notaria_liquidado_at
  const cuentaP_ = persona => {
    const mine=(expenses||[]).filter(e=>e.personal_de===persona&&!e.client_id&&!e.deleted_at&&cuentaEnSaldo(e))
    const fondos=mine.filter(e=>e.type==='fondo'&&!e.no_descuenta_saldo), gastos=mine.filter(e=>e.type!=='fondo'&&!e.no_descuenta_saldo)
    const fondoDe=g=>g.reembolso_fondo_id?fondos.find(f=>String(f.id)===String(g.reembolso_fondo_id)):null
    const dedic=new Set(gastos.map(g=>fondoDe(g)?.id).filter(Boolean).map(String))
    return {fondos,gastos,fondoDe,dedic}
  }
  const dispPersona = persona => {
    const {fondos,gastos,fondoDe,dedic}=cuentaP_(persona)
    const fondo=fondos.filter(f=>!dedic.has(String(f.id))).reduce((a,e)=>a+(e.amount||0),0)
    const otros=gastos.filter(g=>!fondoDe(g)&&!_esNotaPendP(g)).reduce((a,e)=>a+(e.amount||0),0)
    return { fondo, otros, disp: Math.max(0, fondo-otros) }
  }
  // Cuánto de las OT `gs` (de una persona) se puede pagar con fondos: las ligadas a un fondo, con lo que le queda a ese fondo; las demás, con el saldo propio.
  const coberturaPersona = (persona, gs) => {
    const {fondos,gastos,fondoDe}=cuentaP_(persona)
    const general=dispPersona(persona).disp
    const quedaF=f=>Math.max(0,(f.amount||0)-gastos.filter(g=>String(g.reembolso_fondo_id)===String(f.id)&&!_esNotaPendP(g)).reduce((a,e)=>a+(e.amount||0),0))
    const grupos=new Map(); (gs||[]).forEach(e=>{ const f=fondoDe(e); const k=f?String(f.id):'__gen__'; if(!grupos.has(k)) grupos.set(k,{disp:f?quedaF(f):general,items:[]}); grupos.get(k).items.push(e) })
    let con=0, disp=0, ap=0; const pagables=[]; const byDate=(a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.ot_number||'').localeCompare(String(b.ot_number||''))
    grupos.forEach(g=>{ const t=g.items.reduce((a,e)=>a+(e.amount||0),0); ap+=t; con+=Math.min(t,g.disp); disp+=g.disp; let used=0; [...g.items].sort(byDate).forEach(e=>{ if(used+(e.amount||0)<=g.disp){ used+=(e.amount||0); pagables.push(e) } }) })
    if(!grupos.has('__gen__')) disp+=general
    return {con, ap, disp, pagables}
  }
  const notaPendTotal = notariaPend.reduce((a,e)=>a+(e.amount||0),0)
  const notaLiquidaciones = useMemo(()=>(rendiciones||[]).filter(r=>r.tipo==='notaria'&&!r.anulada_at).sort((a,b)=>(b.created_at||'')>(a.created_at||'')?1:-1),[rendiciones])
  const toggleNota = id => setSelNota(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const [notaFondos,setNotaFondos] = useState(false)   // por defecto 'Ver todos' (render aprobado 2026-10-08): los sin fondos se ven en rojo y sus OT no se marcan sin 'Oficina cubre la diferencia'
  const [notaPersonaPick,setNotaPersonaPick] = useState(null)
  const PERSONAS_NOTA = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  // Agrupa los pendientes: por cliente (con su saldo de fondos), personales (personal_de) y sin asignar.
  // Incobrables (castigo): la oficina paga la OT a la notaría y no se le cobra al cliente → grupo propio, sin chequeo de fondo del cliente.
  const notaGroups = useMemo(()=>{ const byClient={},personal={},sin=[],asume=[]; notariaPend.forEach(e=>{ if(e.incobrable_at){ asume.push(e); return } if(e.client_id){(byClient[e.client_id]=byClient[e.client_id]||[]).push(e)} else if(e.personal_de){(personal[e.personal_de]=personal[e.personal_de]||[]).push(e)} else sin.push(e) }); return {byClient,personal,sin,asume} },[notariaPend])
  const marcarPersonal = async(e,persona)=>{ const patch={personal_de:persona||null, paid_by_client: persona?false:(e.category==='Notaria')}; try{ await supabase.from('expenses').update(patch).eq('id',e.id); setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x)); setNotaPersonaPick(null); logActividad('notaria.personal',{tabla:'expenses',id:e.id,detalle:{persona:persona||null,title:[e.ot_number?fmtOt(e.ot_number):null,e.concept].filter(Boolean).join(' · '),monto:e.amount}}) }catch(err){appAlert('Error: '+err.message)} }
  // Triage de gasto de oficina (Liberona Escala) → personal de un miembro: lo saca del folder de la oficina y queda como personal.
  const esOficina = cid => { const c=clients.find(x=>String(x.id)===String(cid)); return !!c && (c.is_internal || /liberona\s+escala/i.test(c.name||'')) }
  // Gastos pendientes de rendir al cliente (única fuente, misma def que el botón Rendir): gasto, descuenta saldo, no rendido al cliente.
  const gastosPorRendir = cid => gastosPorRendirCli(expenses,cid)
  // Clientes con gastos sin rendir hace ≥30 días → aviso "Conviene rendir" (la app anticipa, no esperas a acordarte). La oficina queda fuera.
  const rendirPend = useMemo(()=>{
    const hoy=new Date(); hoy.setHours(0,0,0,0)
    return (clients||[]).map(c=>{
      if(esOficina(c.id)) return null
      const por=gastosPorRendir(c.id); if(!por.length) return null
      const oldest=por.reduce((m,e)=>(e.date&&(!m||e.date<m))?e.date:m,null); if(!oldest) return null
      const dias=Math.floor((hoy-new Date(oldest+'T00:00:00'))/86400000); if(dias<30) return null
      return {client:c, n:por.length, monto:por.reduce((a,e)=>a+(e.amount||0),0), dias}
    }).filter(Boolean).sort((a,b)=>b.dias-a.dias)
  },[expenses,clients])
  // Repetir los costos fijos del mes anterior en el mes nuevo (sin re-tipear). created_by = admin → quedan estructurales.
  const [ultRep,setUltRep] = useState(null)   // último "Repetir" (mes + ids creados) para poder Deshacer
  const repetirCostosFijos = async (items, mesISO) => {
    if(!items?.length || !selectedClient) return
    const rows = items.map(it=>({ client_id:selectedClient.id, type:'gasto', amount:Math.round(it.amount||0), concept:it.concept||'Costo de oficina', category:it.category||null, subcategory:it.subcategory||null, date:`${mesISO}-01`, created_by:currentUserName||null }))
    try {
      const { data, error } = await supabase.from('expenses').insert(rows).select()
      if(error){ console.error('repetirCostosFijos',error); return }
      if(data){ setExpenses(p=>[...data, ...p]); setUltRep({mes:mesISO, ids:data.map(d=>d.id), n:data.length}) }
    } catch(err){ console.error('repetirCostosFijos',err) }
  }
  const deshacerRepetir = async () => {
    if(!ultRep?.ids?.length) return
    const ids=ultRep.ids
    try{ await supabase.from('expenses').delete().in('id',ids) }catch(err){ console.error('deshacerRepetir',err) }
    setExpenses(p=>p.filter(x=>!ids.includes(x.id))); setUltRep(null)
  }
  // Catálogo de categorías de oficina que APRENDE: base + las ya usadas en gastos de la oficina (excluye las legales) + ordenadas.
  // Catálogo = las 9 categorías nuevas (CATS_OFICINA_NUEVAS) + las viejas mapeadas + las ya usadas (para no perder datos históricos).
  const catsOficina = useMemo(()=>{ const s=new Set(CATS_OFICINA_NUEVAS); (expenses||[]).forEach(e=>{ if(esOficina(e.client_id)&&e.category&&!CATS_LEGALES.includes(String(e.category).trim().toLowerCase())) s.add(catOficinaNueva(e.category)) }); return [...s] },[expenses,clients])
  const setCatOficina = async(e,cat)=>{ setCatMenu(null); const patch={category:cat}; if(!(SUBCATS_OFICINA[cat]||[]).includes(e.subcategory)) patch.subcategory=null; try{ await supabase.from('expenses').update(patch).eq('id',e.id); setExpenses&&setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x)); const gk=glosaKey(e.concept||''); if(gk&&cat) learnPut('gasto_categoria',gk,cat) }catch(err){ appAlert('No se pudo guardar la categoría: '+err.message) } }
  const setSubcatOficina = async(e,sub)=>{ setSubMenu(null); try{ await supabase.from('expenses').update({subcategory:sub||null}).eq('id',e.id); setExpenses&&setExpenses(p=>p.map(x=>x.id===e.id?{...x,subcategory:sub||null}:x)) }catch(err){ appAlert('No se pudo guardar el desglose: '+err.message) } }
  const triagePersonal = async(e,persona)=>{ if(e.rendered_at||e.client_rendered_at||e.notaria_liquidado_at||e.notaria_render_id){ appAlert('Este gasto ya está en una rendición/liquidación. Desvincúlalo primero antes de marcarlo como personal (si no, el total de esa rendición queda descuadrado).'); return } const patch={personal_de:persona||null, client_id:null, entity_id:null, paid_by_client:false}; try{ const {error}=await supabase.from('expenses').update(patch).eq('id',e.id); if(error) throw error; setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x)); logActividad('gastos.personal',{tabla:'expenses',id:e.id,detalle:{..._detG(e),persona:persona||null}}) }catch(err){appAlert('Error: '+err.message)} }
  // Fila de OT (Deuda notaría). Escritorio: casilla · OT · fecha · trámite · monto · ›. Móvil: trámite arriba, OT · fecha abajo, monto a la derecha.
  // Tocar la fila la marca (como siempre); › abre el gasto. hlq = texto buscado (se resalta).
  const notaRow = (e, bloqueado=false, adelanto=false, hlq='') => { const on=selNota.has(e.id)
    const _n=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
    const hl=t=>{ const q=String(hlq||'').trim(); const tt=String(t||''); if(!q) return tt; const i=_n(tt).indexOf(_n(q)); if(i<0) return tt; return <>{tt.slice(0,i)}<mark style={{background:C.soonBg,color:'inherit',borderRadius:3,padding:'0 1px'}}>{tt.slice(i,i+q.length)}</mark>{tt.slice(i+q.length)}</> }
    const ot=e.ot_number?fmtOt(e.ot_number):'—', fe=e.date?fmtFechaDMY(e.date):'sin fecha'
    const warn=bloqueado?'excede el fondo':adelanto?'adelanto':null
    const D=isDesktop
    return (
    <div key={e.id} onClick={()=>{ if(bloqueado) return; toggleNota(e.id) }} title={bloqueado?'Excede el fondo del cliente · activa "Oficina cubre la diferencia" para pagarlo igual':undefined} style={{display:'grid',gridTemplateColumns:D?NOTA_GC:'18px minmax(0,1fr) auto 32px',columnGap:10,rowGap:1,alignItems:'center',padding:D?'6px 14px':'7px 6px 7px 12px',borderTop:`0.5px solid ${C.border}`,cursor:bloqueado?'not-allowed':'pointer',background:on?C.selBg:'transparent',opacity:bloqueado?.6:1}}>
      <span style={{...(D?{}:{gridRow:'1 / 3'}),width:18,height:18,borderRadius:6,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'transparent',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on?<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>:null}</span>
      {D ? <>
        <div style={{minWidth:0}}><div style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hl(e.concept||'—')}</div><div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b onClick={ev=>{ev.stopPropagation();gastosVolverGuardar({nota:'pend'});onEdit&&onEdit(e)}} title='Abrir el gasto' style={{color:C.azulInfo,fontWeight:700,cursor:'pointer',textDecoration:'underline',textDecorationColor:'rgba(47,111,134,.35)',textUnderlineOffset:2}}>{hl(ot)}</b> · {fe}{warn&&<span style={{color:C.overdueText,fontWeight:600}}> · {warn}</span>}</div></div>
      </> : <>
        <span style={{gridColumn:2,gridRow:1,fontSize:12,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{hl(e.concept||'—')}</span>
        <span style={{gridColumn:2,gridRow:2,fontSize:10.5,color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.azulInfo,fontWeight:700}}>{hl(ot)}</b> · {fe}{warn&&<span style={{color:C.overdueText,fontWeight:600}}> · {warn}</span>}</span>
      </>}
      <span style={{...(D?{}:{gridColumn:3,gridRow:'1 / 3'}),fontSize:12.5,fontWeight:600,color:C.text,textAlign:'right',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(e.amount)}</span>
      {!D&&<button onClick={ev=>{ev.stopPropagation();gastosVolverGuardar({nota:'pend'});onEdit&&onEdit(e)}} title='Abrir el gasto' style={{gridColumn:4,gridRow:'1 / 3',width:32,height:32,border:'none',background:'none',display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}><SIcon n='chevron' s={14} c={C.done}/></button>}
    </div>
  )}
  // ¿la selección incluye gastos de clientes sin fondos? (adelantaríamos plata de la oficina)
  const notaSinFondosSel = notaSel.filter(e=>e.client_id && !e.incobrable_at && saldoCliente(expenses,e.client_id)<0)
  const periodoNota = gs => { const fs=gs.map(e=>e.date).filter(Boolean).sort(); if(!fs.length) return new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'}); const mY=d=>new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'}); return mY(fs[0])===mY(fs[fs.length-1])?mY(fs[0]):`${fmtFechaDMY(fs[0])} – ${fmtFechaDMY(fs[fs.length-1])}` }

  // Liquidar = GUARDAR la liquidación como 'por_enviar' (sin correo). El envío a la notaría es un 2º paso (enviarNotaria).
  const liquidarNotaria = async() => {
    if(!notaSel.length) return
    setNotaSending(true)
    try{
      const renderId=crypto.randomUUID(), now=new Date().toISOString()
      const periodo=periodoNota(notaSel)
      const ot=[...new Set(notaSel.map(e=>e.ot_number).filter(Boolean))].join(', ')
      const ids=notaSel.map(e=>e.id)
      // Otra persona pudo liquidar alguna de estas OT mientras tanto: se revisa en la base antes de crear la liquidación.
      if(!DEMO){ const {data:libres,error:fErr}=await supabase.from('expenses').select('id').in('id',ids).is('notaria_render_id',null); if(fErr) throw fErr
        if((libres||[]).length!==ids.length){ appAlert(`${ids.length-(libres||[]).length} de estas OT ya están en otra liquidación (alguien las liquidó recién). Actualiza la página y vuelve a seleccionar.`); setNotaSending(false); return } }
      const row={id:renderId,user_name:currentUserName,periodo,total:notaTotal,n_gastos:notaSel.length,tipo:'notaria',ot_numbers:ot||null,estado_envio:'por_enviar'}
      const {error:rErr}=await supabase.from('rendiciones').insert(row)
      if(rErr) throw rErr
      // Liquidar = «en liquidación». La OT queda PAGADA recién al enviar el aviso con el comprobante, al marcarla pagada sin correo o al enlazar el cargo del banco.
      const {error:uErr}=await supabase.from('expenses').update({notaria_render_id:renderId}).in('id',ids).is('notaria_render_id',null)
      if(uErr) throw uErr
      setExpenses(p=>p.map(e=>ids.includes(e.id)?{...e,notaria_render_id:renderId}:e))
      if(setRendiciones) setRendiciones(p=>[{...row,created_at:now},...p])
      setSelNota(new Set()); setNotaConfirm(false)
      logActividad('notaria.liquidada',{tabla:'rendiciones',id:renderId,detalle:{title:`${ids.length} OT · ${periodo}`,monto:notaTotal}})
      abrirEnvioNotaria({...row,created_at:now})   // flujo continuo: liquidó → abre la PÁGINA para pagar+avisar
    }catch(e){appAlert('Error al liquidar: '+e.message)}
    setNotaSending(false)
  }
  // Marcar como ya pagados (gastos históricos): registra la liquidación SIN correo (estado_envio='pagado').
  const marcarPagadoNotaria = async() => {
    if(!notaSel.length) return
    if(!await appConfirm(`¿Marcar ${notaSel.length} gasto(s) como ya pagados a la notaría? Salen de pendientes; no se envía correo.`)) return
    try{
      const renderId=crypto.randomUUID(), now=new Date().toISOString()
      const periodo=periodoNota(notaSel), ot=[...new Set(notaSel.map(e=>e.ot_number).filter(Boolean))].join(', ')
      const row={id:renderId,user_name:currentUserName,periodo,total:notaTotal,n_gastos:notaSel.length,tipo:'notaria',ot_numbers:ot||null,estado_envio:'pagado'}
      const {error:rErr}=await supabase.from('rendiciones').insert(row)
      if(rErr) throw rErr
      const ids=notaSel.map(e=>e.id)
      const {error:uErr}=await supabase.from('expenses').update({notaria_render_id:renderId,notaria_liquidado_at:now}).in('id',ids).is('notaria_render_id',null)
      if(uErr) throw uErr
      setExpenses(p=>p.map(e=>ids.includes(e.id)?{...e,notaria_render_id:renderId,notaria_liquidado_at:now}:e))
      if(setRendiciones) setRendiciones(p=>[{...row,created_at:now},...p])
      setSelNota(new Set())
    }catch(e){appAlert('Error: '+e.message)}
  }
  // Estado de envío de una liquidación (compat filas viejas sin estado_envio: con sent_at→enviada, si no→pagado).
  const notaEstado = r => r.estado_envio || (r.sent_at?'enviada':'pagado')
  // Pagada = aviso enviado con comprobante, marcada pagada, o enlazada a su cargo del banco (la prueba del pago) aunque falte el aviso.
  const notaPagada = r => notaEstado(r)!=='por_enviar' || !!r.movimiento_id
  // Paso 2: enviar a la notaría el detalle + el comprobante de transferencia (ya transferiste). Marca 'enviada'.
  const enviarNotaria = async(r) => {
    const dest=cleanNotaDest(notaEmail)||NOTARIA_DEFAULT
    if(!dest){ appAlert('Falta el correo de la notaría.'); return }
    if(!compFile){ appAlert('Adjunta el comprobante de transferencia.'); return }
    setNotaSending(true)
    // CC fijo: todo el estudio en copia, SIEMPRE, menos Rodrigo.
    const ccEstudio=BRAND.ccNotaria||undefined
    try{
      try{ localStorage.setItem('notaria_email',dest) }catch(_){}
      // Aprende el/los correo(s) de la notaría: compartido para todo el equipo (una sola fila en learnings).
      try{ await supabase.from('learnings').delete().eq('kind','notaria_email'); await supabase.from('learnings').insert({kind:'notaria_email',key:'dest',value:dest,meta:{}}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      const gs=(expenses||[]).filter(e=>String(e.notaria_render_id)===String(r.id))
      const total=gs.reduce((a,e)=>a+(e.amount||0),0)
      const periodo=r.periodo||periodoNota(gs)
      // Sube el comprobante a Drive (queda enlazado) y se arma como adjunto base64 para el correo.
      const fileToB64 = f => new Promise((res,rej)=>{ const rd=new FileReader(); rd.onload=()=>res(String(rd.result).split(',')[1]||''); rd.onerror=rej; rd.readAsDataURL(f) })
      const compB64 = await fileToB64(compFile)
      const compMime = compFile.type||'application/octet-stream'
      const compName = (compFile.name||'Comprobante transferencia').replace(/[^\w.\s-]/g,'').trim()
      let comprobanteUrl=null
      try{ const tk=await driveToken(); if(tk){ const folders=await driveAdjuntosFolders(tk); const up=await driveUpload(tk,folders.gastos,compFile,`Comprobante notaría ${periodo} · ${compName}`); comprobanteUrl=up?.webViewLink||null } }catch(_){}
      // Correo: usa el BORRADOR EDITABLE (mensaje + asunto); el detalle de OT + total se anexa solo (builder único).
      const mensaje=(notaMsg||'').trim()||notaDefaultMsg(periodo, notaBolRS||BRAND.nombreLegal, notaBolRUT||BRAND.rut)
      const html=notaEmailHtml(mensaje, gs, total, clients)
      const texto=notaEmailText(mensaje, gs, total)
      const subjectNota=(notaSubject||'').trim()||`Liquidación de gastos y comprobante de transferencia · ${BRAND.nombre} · ${periodo}`
      // Aprende la razón social de las boletas por cliente (si toda la liquidación es de un solo cliente y no es el estudio).
      try{ const cids=[...new Set(gs.map(e=>e.client_id).filter(Boolean))]; if(cids.length===1 && notaBolRS && notaBolRS!==BRAND.nombreLegal){ await supabase.from('learnings').delete().eq('kind','notaria_boletas').eq('key',String(cids[0])); await supabase.from('learnings').insert({kind:'notaria_boletas',key:String(cids[0]),value:JSON.stringify({rs:notaBolRS,rut:notaBolRUT}),meta:{}}) } }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      const fechaLiq=fmtFechaDMY(r.created_at)
      // Detalle a la notaría = Excel formateado. Si por algo falla, cae a PDF para no quedar sin detalle.
      let xls=null; try{ xls=await liquidacionExcelB64({gastos:gs.map(e=>({...e,concept:sinRaya(e.concept)})),clients,titulo:`Liquidación ${BRAND.notaria} al ${fechaLiq}`,sub:`${gs.length} OT · Total $${total.toLocaleString('es-CL')}`}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
      let pdf=null; if(!xls){ try{ pdf=await liquidacionPdfBase64({me:BRAND.nombre,periodo,gastos:gs.map(e=>({...e,concept:sinRaya(e.concept)})),clients,titulo:'Liquidación de gastos · Notaría'}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
      const ext = compMime.includes('pdf')?'pdf':(compMime.includes('png')?'png':(compMime.includes('jpeg')||compMime.includes('jpg')?'jpg':'dat'))
      const adjuntos=[]
      if(xls) adjuntos.push({base64:xls, name:`Liquidacion ${BRAND.notaria.normalize('NFD').replace(/[\u0300-\u036f]/g,'')} al ${fechaLiq}.xlsx`, mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      else if(pdf) adjuntos.push({base64:pdf, name:`Liquidacion ${BRAND.notaria.normalize('NFD').replace(/[\u0300-\u036f]/g,'')} al ${fechaLiq}.pdf`, mime:'application/pdf'})
      adjuntos.push({base64:compB64, name:`Comprobante transferencia.${ext}`, mime:compMime})
      let sent=false
      let viaNota=null, errNota=null
      try{ viaNota=await enviarComoUsuario({to:dest,cc:ccEstudio,subject:subjectNota,html,text:texto,attachments:adjuntos,que:'El aviso a la notaría'}); if(viaNota===null){ setNotaSending(false); return } sent=true }catch(e){ sent=false; errNota=e }
      if(!sent){ avisoNoEnviado('El aviso a la notaría', errNota?.message||null); setNotaSending(false); return }
      const now=new Date().toISOString()
      const correoNota={asunto:subjectNota,cuerpo:mensaje,rs:notaBolRS||BRAND.nombreLegal,rut:notaBolRUT||BRAND.rut,para:dest}
      const {error:sErr}=await supabase.from('rendiciones').update({estado_envio:'enviada',sent_at:now,comprobante_url:comprobanteUrl,correo:correoNota}).eq('id',r.id)
      if(sErr) appAlert('El correo salió, pero no se pudo registrar el envío: '+sErr.message)
      // Transferida con comprobante y avisada = pagada a la notaría.
      await supabase.from('expenses').update({notaria_liquidado_at:now}).eq('notaria_render_id',r.id).is('notaria_liquidado_at',null)
      setExpenses(p=>p.map(e=>String(e.notaria_render_id)===String(r.id)&&!e.notaria_liquidado_at?{...e,notaria_liquidado_at:now}:e))
      if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,estado_envio:'enviada',sent_at:now,comprobante_url:comprobanteUrl,correo:correoNota}:x))
      setNotaSend(null); setCompFile(null)
      appAlert(txtEnviado(viaNota,{que:'Aviso de pago a la notaría', para:dest}))
    }catch(e){appAlert('Error al enviar: '+e.message)}
    setNotaSending(false)
  }
  // Reenvía una liquidación YA enviada: regenera el detalle y recupera el comprobante guardado en Drive. Cualquiera del equipo puede.
  // OJO: el cuerpo (html/texto) debe mantenerse en sync con enviarNotaria.
  const reenviarNotaria = async(r) => {
    const dest=cleanNotaDest(notaEmail)||NOTARIA_DEFAULT
    if(!dest){ appAlert('Falta el correo de la notaría.'); return }
    const gs=(expenses||[]).filter(e=>String(e.notaria_render_id)===String(r.id))
    if(!gs.length){ appAlert('Esta liquidación no tiene gastos vivos para reenviar.'); return }
    const periodo=r.periodo||periodoNota(gs)
    if(!await appConfirm(`¿Reenviar la liquidación (${periodo}) a la notaría?\n${dest}\nCon copia a la oficina.`)) return
    setReenviando(r.id)
    const ccEstudio=BRAND.ccNotaria||undefined
    try{
      const total=gs.reduce((a,e)=>a+(e.amount||0),0)
      const fechaLiq=fmtFechaDMY(r.created_at)
      // Reenvía el mismo mensaje y asunto que se enviaron (con la razón social de las boletas elegida); las filas antiguas sin registro usan el borrador por defecto.
      const mensaje=(r.correo&&r.correo.cuerpo)||notaDefaultMsg(periodo, BRAND.nombreLegal, BRAND.rut)
      const html=notaEmailHtml(mensaje, gs, total, clients)
      const texto=notaEmailText(mensaje, gs, total)
      const subjectNota=(r.correo&&r.correo.asunto)||`Liquidación de gastos y comprobante de transferencia · ${BRAND.nombre} · ${periodo}`
      let xls=null; try{ xls=await liquidacionExcelB64({gastos:gs.map(e=>({...e,concept:sinRaya(e.concept)})),clients,titulo:`Liquidación ${BRAND.notaria} al ${fechaLiq}`,sub:`${gs.length} OT · Total $${total.toLocaleString('es-CL')}`}) }catch(_){}
      let pdf=null; if(!xls){ try{ pdf=await liquidacionPdfBase64({me:BRAND.nombre,periodo,gastos:gs.map(e=>({...e,concept:sinRaya(e.concept)})),clients,titulo:'Liquidación de gastos · Notaría'}) }catch(_){} }
      const adjuntos=[]
      if(xls) adjuntos.push({base64:xls, name:`Liquidacion ${BRAND.notaria.normalize('NFD').replace(/[\u0300-\u036f]/g,'')} al ${fechaLiq}.xlsx`, mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      else if(pdf) adjuntos.push({base64:pdf, name:`Liquidacion ${BRAND.notaria.normalize('NFD').replace(/[\u0300-\u036f]/g,'')} al ${fechaLiq}.pdf`, mime:'application/pdf'})
      // Recupera el comprobante desde Drive (quedó enlazado al enviar). Si no se puede, reenvía solo el detalle.
      let conComp=false
      if(r.comprobante_url){
        const m=String(r.comprobante_url).match(/\/d\/([A-Za-z0-9_-]+)/)||String(r.comprobante_url).match(/[?&]id=([A-Za-z0-9_-]+)/)
        const fid=m&&m[1]
        if(fid){ try{ const tk=await driveToken(); if(tk){ const b=await driveDownloadB64(tk,fid); if(b&&b.base64){ adjuntos.push({base64:b.base64,name:`Comprobante transferencia.${b.ext}`,mime:b.mime}); conComp=true } } }catch(_){} }
      }
      let sent=false
      let viaR=null, errR=null
      try{ viaR=await enviarComoUsuario({to:dest,cc:ccEstudio,subject:subjectNota,html,text:texto,attachments:adjuntos,que:'El reenvío a la notaría'}); if(viaR===null){ setReenviando(null); return } sent=true }catch(e){ sent=false; errR=e }
      if(!sent){ avisoNoEnviado('El reenvío a la notaría', errR?.message||null); setReenviando(null); return }
      appAlert(txtEnviado(viaR,{que:'Liquidación', verbo:'reenviad', g:'a', para:`la notaría (${dest})`})+(conComp?'\nCon el comprobante adjunto.':'\nNo se pudo recuperar el comprobante de Drive: se reenvió solo el detalle.'))
    }catch(e){ appAlert('Error al reenviar: '+e.message) }
    setReenviando(null)
  }
  // Anular (antes BORRABA la liquidación): los gastos vuelven a pendientes y la liquidación queda registrada como anulada (quién/cuándo) + bitácora.
  const deshacerNotaria = async(r) => {
    const est=r.estado_envio||'por_enviar'
    const msg = est==='por_enviar'
      ? '¿Anular esta liquidación de notaría? Las OT vuelven a pendientes.'
      : `Esta liquidación ya se ${est==='pagado'?'pagó':'envió'} a la notaría. Anularla devuelve las ${r.n_gastos||''} OT a pendientes, pero no revierte el pago ni el correo. ¿Anular igual?`
    if(!await appConfirm(msg+(r.movimiento_id?'\n\nEstá enlazada a un cargo del banco: el cargo vuelve a quedar por conciliar.':''))) return
    try{
      // Orden: 1) liberar las OT, 2) anular (suelta el enlace), 3) liberar el cargo del banco. Si algo falla, lo ya hecho queda coherente.
      const {error:ue}=await supabase.from('expenses').update({notaria_render_id:null,notaria_liquidado_at:null}).eq('notaria_render_id',r.id)
      if(ue) throw ue   // si no se liberan los gastos, NO marcar anulada
      setExpenses(p=>p.map(e=>e.notaria_render_id===r.id?{...e,notaria_render_id:null,notaria_liquidado_at:null}:e))
      const now=new Date().toISOString(), patch={anulada_at:now, anulada_por:currentUserName||null, movimiento_id:null}
      const {error:re}=await supabase.from('rendiciones').update(patch).eq('id',r.id)
      if(re) throw re
      if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,...patch}:x))
      // El cargo del banco vuelve a «por conciliar»: si no, quedaría conciliado contra una liquidación anulada y las OT podrían pagarse dos veces.
      if(r.movimiento_id){ const {error:me}=await supabase.from('cartola_movimientos').update({estado:'pendiente',monto_conciliado:0,categoria:null}).eq('id',r.movimiento_id); if(me) throw new Error('la liquidación quedó anulada, pero el cargo del banco no se liberó: desenlázalo en Banco ('+me.message+')') }
      logActividad('notaria.liquidacion_anulada',{tabla:'rendiciones',id:r.id,detalle:{title:`${r.n_gastos||0} OT · ${r.periodo||''}`,monto:r.total}})
    }catch(e){appAlert('Error: '+e.message)}
  }
  const fmtOt = ot => ot?(String(ot).toUpperCase().startsWith('OT')?ot:'OT-'+ot):'—'
  // Excel de una liquidación: OT · descripción · costo (lo que pidió el usuario, en ese orden).
  const descargarExcelNota = async(r) => {
    try{
      const gs=(expenses||[]).filter(e=>String(e.notaria_render_id)===String(r.id))
      if(!gs.length){ appAlert('Esta liquidación no tiene gastos vivos para exportar.'); return }
      const fecha=fmtFechaDMY(r.created_at)||new Date().toISOString().slice(0,10)
      const total=gs.reduce((a,e)=>a+(e.amount||0),0)
      const XLSX=await loadXLSXStyle()
      const ws=buildLiquidacionExcelWS(XLSX,{gastos:gs,clients,titulo:`Liquidación ${BRAND.notaria} al ${fecha}`,sub:`${gs.length} OT · Total $${total.toLocaleString('es-CL')}`})
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Notaría')
      XLSX.writeFile(wb,`Liquidacion ${BRAND.notaria.normalize('NFD').replace(/[\u0300-\u036f]/g,'')} al ${fecha}.xlsx`.replace(/[^\w .-]/g,''))
    }catch(e){ appAlert('No se pudo generar el Excel: '+e.message) }
  }
  // Añadir gastos pendientes a una liquidación ya creada (corrección): los enlaza y suma al total/n_gastos/OT.
  const anadirGastosNota = async(r, ids) => {
    if(!ids.length) return
    if(notaPagada(r)){ appAlert('Esta liquidación ya se envió o se pagó a la notaría: las OT nuevas van en una liquidación nueva.'); return }
    const adds=notariaPend.filter(e=>ids.includes(e.id)); const addTot=adds.reduce((a,e)=>a+(e.amount||0),0)
    const newOts=[...new Set([...(r.ot_numbers?String(r.ot_numbers).split(', '):[]), ...adds.map(e=>e.ot_number).filter(Boolean)])].join(', ')
    try{
      const {error:e1}=await supabase.from('expenses').update({notaria_render_id:r.id}).in('id',ids).is('notaria_render_id',null); if(e1) throw e1
      const {error:e2}=await supabase.from('rendiciones').update({total:(r.total||0)+addTot, n_gastos:(r.n_gastos||0)+ids.length, ot_numbers:newOts||null}).eq('id',r.id); if(e2) throw e2
      setExpenses(p=>p.map(e=>ids.includes(e.id)?{...e,notaria_render_id:r.id}:e))
      if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,total:(x.total||0)+addTot,n_gastos:(x.n_gastos||0)+ids.length,ot_numbers:newOts||null}:x))
      setNotaLiqAdd(null); setAddSel(new Set())
    }catch(e){appAlert('Error al añadir: '+e.message)}
  }

  const CATS = CAT_COLORS

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
  const cFondos = v => v>0?{c:C.normal,bg:C.greenBg} : v===0?{c:C.soon,bg:'#FEF6EE'} : {c:C.overdue,bg:C.overdueBg}
  const cSaldo = v => v>0?{c:C.normal,bg:C.greenBg} : v===0?{c:C.grisText,bg:C.bgWarm} : {c:C.overdue,bg:C.overdueBg}
  const KpiRect = ({label,value,c,bg,onPlus,plusColor,onArrow,arrowColor}) => (
    <div style={{position:'relative',background:bg,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}}>
      <div style={{...SEC_LBL,marginBottom:3}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:c}}>{value}</div>
      {onPlus&&<button onClick={onPlus} aria-label={'Agregar '+label} style={{position:'absolute',top:0,right:0,width:34,height:34,padding:0,border:'none',background:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center'}}><span style={{width:20,height:20,borderRadius:'50%',background:plusColor||C.accent,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg></span></button>}
      {onArrow&&<button onClick={onArrow} aria-label='Devolver saldo a favor' title='Devolver saldo a favor' style={{position:'absolute',top:0,right:0,width:34,height:34,padding:0,border:'none',background:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center'}}><span style={{width:20,height:20,borderRadius:'50%',background:arrowColor||C.normal,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><line x1='5' y1='12' x2='19' y2='12'/><polyline points='13 6 19 12 13 18'/></svg></span></button>}
    </div>
  )
  const KpiRow = ({bal,oficina}) => {
    if(oficina) return (   // Oficina = la firma: no hay "saldo" (siempre cubre); muestra gastos, lo pendiente de liquidar y lo ya pagado
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:8}}>
        <KpiRect label='Gastos de oficina' value={fmt(oficina.total)} c={C.accent} bg={C.azulBg}/>
        <KpiRect label='Por pagar' value={fmt(oficina.porPagar)} c={C.soonText} bg={C.soonBg}/>
        <KpiRect label='Pagado' value={fmt(oficina.pagado)} c={C.greenText} bg={C.greenBg}/>
      </div>
    )
    return (
    <div style={{background:C.accent,borderRadius:12,padding:'10px 14px',marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
        <div style={{minWidth:0}}><div style={{fontSize:9,color:C.onNavyLabel,textTransform:'uppercase',letterSpacing:'.04em'}}>Saldo del cliente</div><div style={{fontSize:23,fontWeight:700,color:bal.saldo<0?C.onNavyRed:'#fff',lineHeight:1.1,fontVariantNumeric:'tabular-nums'}}>{fmtSaldoG(bal.saldo)}</div></div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          {/* Los fondos NO se agregan a mano: entran solo por conciliación bancaria. Solo queda "+ Gasto". */}
          <button onClick={()=>onAdd(selectedClient)} style={{background:C.onNavyBtn,color:'#fff',border:'none',borderRadius:8,padding:'5px 11px',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>+ Gasto</button>
        </div>
      </div>
      <div style={{display:'flex',gap:16,marginTop:6,paddingTop:6,borderTop:`0.5px solid ${C.onNavyLine}`}}>
        <span style={{fontSize:11,color:C.onNavyGreen}}>Fondos <b style={{color:'#fff'}}>{fmt(bal.fondos)}</b></span>
        <span style={{fontSize:11,color:C.onNavyRed}}>Gastos <b style={{color:'#fff'}}>{fmt(bal.gastos)}</b></span>
      </div>
    </div>
  )}

  // Ícono de adjuntos por gasto (CAMBIO 2): clip azul con contador o botón de subida gris
  const AdjuntoIcon = ({e}) => {
    const n=(expenseAttachments||[]).filter(a=>a.expense_id===e.id).length
    return n>0
      ? <button onClick={ev=>{ev.stopPropagation();onEdit&&onEdit(e)}} title={`${n} adjunto(s)`} style={{display:'flex',alignItems:'center',gap:3,padding:'3px 8px',borderRadius:6,border:'1px solid #003C50',background:C.azulBg,color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',flexShrink:0}}>
          <span style={{width:8,height:11,border:'1.5px solid #003C50',borderRadius:4,display:'inline-block',transform:'rotate(35deg)'}}/>{n}
        </button>
      : <button onClick={ev=>{ev.stopPropagation();onEdit&&onEdit(e)}} title='Adjuntar comprobante' style={{display:'flex',alignItems:'center',justifyContent:'center',width:28,height:24,borderRadius:6,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,cursor:'pointer',flexShrink:0,fontSize:13,lineHeight:1}}>↑</button>
  }

  // Fila de movimiento (sin línea de razón social): badge + concepto + fecha; ícono de adjunto solo en gastos
  const renderMov = (e, _i, _a, extra=null, opts={}) => {
    const isFondo=e.type==='fondo'
    const isDev=isFondo&&((e.amount||0)<0||/^\s*devoluci/i.test(e.concept||''))
    const catBg=CATS[e.category]||CATS['Otro']
    const isImported=!!e.bulk_import_id
    const needsClass=isImported&&!isFondo&&e.category!=='Notaria'   // origen interno: caja chica (de quién) vs fondos del cliente
    const stop=ev=>ev.stopPropagation()
    const xBtn={background:'none',border:'none',cursor:'pointer',color:'inherit',fontSize:11,lineHeight:1,padding:'0 0 0 5px',fontWeight:700}
    const chipAdd={height:24,padding:'0 11px',borderRadius:20,border:`0.5px solid ${C.muted}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}
    const chipPerson={height:24,padding:'0 11px',borderRadius:20,border:`0.5px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:500,cursor:'pointer'}
    const icoReloj = ()=><svg width="9" height="11" viewBox="0 0 9 11" style={{verticalAlign:'-1px',flexShrink:0}}><path d="M1 1H8L4.5 5.5L8 10H1L4.5 5.5Z" fill="currentColor"/></svg>
    const icoBaja = ()=><svg width="9" height="10" viewBox="0 0 9 10" style={{verticalAlign:'-1px',flexShrink:0}}><path d="M4.5 1V8.2M4.5 8.2 2.2 5.9M4.5 8.2 6.8 5.9" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
    const chipEstado={fontSize:10,padding:'2px 9px',borderRadius:4,background:C.bgWarm,color:C.grisText,fontWeight:600,cursor:'pointer',border:'none'}
    const showEstado = !isFondo && !e.personal_de && !e.created_by && e.client_id && !esOficina(e.client_id) && isImported && !e.rendered_at && !e.client_rendered_at && !e.pagado_cliente_at && isAdmin
    return (
      <div key={e.id} onClick={()=>{ if(movExp===e.id) return; if(onEdit) onEdit(e); else setMovExp(e.id) }}
        style={{background:C.card,borderRadius:10,padding:'11px 14px',marginBottom:7,border:`1px solid ${C.border}`,cursor:'pointer'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>
          {bigDate(e.date)}
          <div style={{minWidth:0,flex:1}}>
            <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2,flexWrap:'wrap'}}>
              {!isFondo&&e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:catBg,color:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{e.category}{e.subcategory?`: ${e.subcategory}`:''}</span>}
              {!isFondo&&otConSello(e, onEdit?()=>onEdit(e):null)}
              {isFondo&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:isDev?C.azulBg:C.greenBg,color:isDev?C.azulInfo:C.normal,fontWeight:700,whiteSpace:'nowrap'}}>{isDev?'Devolución':'Fondo'}</span>}
              {!isFondo&&e.client_rendered_at&&<button onClick={ev=>anularGastoRendido(e,ev)} title='Anular la rendición de este gasto' style={{fontSize:10.5,padding:0,background:'none',color:C.textSoft,fontWeight:500,border:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4,whiteSpace:'nowrap'}}><CheckMini s={10}/>Rendido {fmtFechaDMY(e.client_rendered_at)} <span style={{fontSize:10,lineHeight:1,opacity:.7}}><Gl n='x'/></span></button>}
              {/* Detalle al desplegar (la fila queda limpia): pagado a la notaría manual (deshacer) y liquidación de caja chica. */}
              {movExp===e.id&&!isFondo&&e.notaria_liquidado_at&&isAdmin&&!e.notaria_render_id&&<button onClick={ev=>{ev.stopPropagation();marcarNotariaPagado(e,ev)}} title='Marcado a mano como pagado a la notaría · tocar para deshacer' style={{fontSize:10.5,padding:0,background:'none',color:C.textSoft,fontWeight:500,border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Pagada a la notaría {fmtFechaDMY(e.notaria_liquidado_at)} <span style={{opacity:.7}}><Gl n='x'/></span></button>}
              {movExp===e.id&&!isFondo&&e.rendered_at&&<button onClick={ev=>{ev.stopPropagation(); const r=(rendiciones||[]).find(x=>String(x.id)===String(e.render_id)); r?setLiqDetail(r):appAlert('No se encontró la liquidación de este gasto.')}} title='Ver la liquidación de caja chica' style={{fontSize:10.5,padding:0,background:'none',color:C.accent,fontWeight:600,border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Liquidación de caja chica <Gl n='chevron'/></button>}
              {movExp===e.id&&e.project&&<span style={{fontSize:10,padding:'1px 7px',borderRadius:4,background:C.azulBg,color:C.accent,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150}}>{e.project}</span>}
              {movExp===e.id&&isImported&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.bgWarm,color:C.grisText,fontWeight:700,whiteSpace:'nowrap'}}>Carga masiva</span>}
              {movExp===e.id&&isAdmin&&(e.revision_estado==='consultar'
                ? <button onClick={ev=>{ev.stopPropagation();marcarConsulta(e,null)}} title='Consulta pendiente · tocar para marcarla resuelta' style={{fontSize:10,padding:'1px 8px',borderRadius:20,background:C.soonBg,color:C.soonText,fontWeight:700,border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Consultar a {e.revisado_por||'equipo'} · resuelta</button>
                : <select value='' onClick={ev=>ev.stopPropagation()} onChange={ev=>{ev.stopPropagation(); if(ev.target.value) marcarConsulta(e,ev.target.value)}} title='Dejar este movimiento en Revisar › Por consultar' style={{fontSize:10,padding:'1px 6px',borderRadius:20,border:`1px solid ${C.border}`,background:C.surface,color:C.muted,fontWeight:600,cursor:'pointer'}}>
                    <option value=''>Consultar a…</option>
                    {[...new Set([...SOCIOS_CFG,...EQUIPO_CFG].map(m=>m.nombre).filter(Boolean))].map(n=><option key={n} value={n}>{n}</option>)}
                  </select>)}
              {movExp===e.id&&(!isFondo&&e.pagado_cliente_at
                ? (isAdmin
                  ? <button onClick={ev=>{ev.stopPropagation();marcarEstado(e,null)}} title='Pagado · tocar para deshacer' style={{fontSize:10,padding:'1px 7px',borderRadius:4,background:e.no_descuenta_saldo?C.bgWarm:C.greenBg,color:e.no_descuenta_saldo?C.grisText:C.greenText,fontWeight:600,border:'none',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>{e.no_descuenta_saldo?icoReloj():icoBaja()} Pagado <span style={{fontWeight:700,fontSize:11,lineHeight:1}}><Gl n='x'/></span></button>
                  : <span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:e.no_descuenta_saldo?C.bgWarm:C.greenBg,color:e.no_descuenta_saldo?C.grisText:C.greenText,fontWeight:700,display:'inline-flex',alignItems:'center',gap:4,whiteSpace:'nowrap'}}>{e.no_descuenta_saldo?icoReloj():icoBaja()} Pagado</span>)
                : (!isFondo||(e.personal_de&&!e.client_id))&&e.no_descuenta_saldo&&!e.incobrable_at&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.bgWarm,color:C.grisText,fontWeight:700,whiteSpace:'nowrap'}}>{e.personal_de&&!e.client_id?'Fuera de la cuenta':'Gasto histórico'}</span>)}
              {e.incobrable_at&&(isAdmin&&!isFondo
                ? <button onClick={ev=>{ev.stopPropagation();marcarEstado(e,null)}} title={`Incobrable desde ${fmtFechaDMY(e.incobrable_at)} · tocar para deshacer`} style={{fontSize:10.5,padding:0,background:'none',color:C.textSoft,fontWeight:500,border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Incobrable · asumido por la oficina <span style={{fontSize:10,lineHeight:1,opacity:.7}}><Gl n='x'/></span></button>
                : <span style={{fontSize:10.5,color:C.textSoft,fontWeight:500,whiteSpace:'nowrap'}}>Incobrable · a cargo de la oficina</span>)}
              {e.personal_de&&!opts.sinPersonal&&(()=>{const pc=personChip(e.personal_de);return <span style={{fontSize:11,fontWeight:700,color:C.muted}}>Personal · <b style={{color:pc.color,fontWeight:700}}>{e.personal_de}</b></span>})()}
            </div>
            <div style={{fontSize:13,color:C.text,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
            {!isFondo&&!e.personal_de&&!esOficina(e.client_id)&&<div style={{fontSize:10,marginTop:2}}>{e.client_id?<span style={{color:C.muted,fontWeight:600}}>{rsDisplay(rsLabel(e.client_id,clients,clientEntities,e.entity_id).name)}</span>:<span style={{color:C.overdue,fontWeight:600}}>Sin cliente</span>}</div>}
            {movExp===e.id&&!isFondo&&!e.personal_de&&esOficina(e.client_id)&&(()=>{ const catOk=e.category&&!CATS_LEGALES.includes(String(e.category).trim().toLowerCase()); return (
              <div style={{marginTop:7,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}} onClick={stop}>
                <div style={{position:'relative'}}>
                  <button onClick={()=>setCatMenu(catMenu===e.id?null:e.id)} style={{fontSize:11,fontWeight:600,color:catOk?C.accent:C.soonText,background:catOk?C.azulBg:C.soonBg,border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>{catOk?e.category:'Sin categoría'} <Gl n='chevD'/></button>
                  {catMenu===e.id&&<><div onClick={()=>setCatMenu(null)} style={{position:'fixed',inset:0,zIndex:90}}/><div style={{position:'absolute',top:28,left:0,zIndex:100,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',minWidth:165,overflow:'hidden',maxHeight:250,overflowY:'auto'}}>{catsOficina.map(c=><div key={c} onClick={()=>setCatOficina(e,c)} style={{padding:'7px 12px',fontSize:12,color:c===e.category?C.accent:C.text,fontWeight:c===e.category?600:400,cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}>{c}</div>)}<div onClick={async()=>{ const nv=await appPrompt('Nueva categoría de oficina:'); if(nv&&nv.trim()) setCatOficina(e,nv.trim()) }} style={{padding:'7px 12px',fontSize:12,color:C.accent,fontWeight:600,cursor:'pointer'}}>+ Nueva categoría…</div></div></>}
                </div>
                {catOk && (SUBCATS_OFICINA[catOficinaNueva(e.category)]||[]).length>0 && <div style={{position:'relative'}}>
                  <button onClick={()=>setSubMenu(subMenu===e.id?null:e.id)} style={{fontSize:11,fontWeight:600,color:e.subcategory?C.accent:C.muted,background:e.subcategory?C.azulBg:C.bgSoft,border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>{e.subcategory||'Desglose'} <Gl n='chevD'/></button>
                  {subMenu===e.id&&<><div onClick={()=>setSubMenu(null)} style={{position:'fixed',inset:0,zIndex:90}}/><div style={{position:'absolute',top:28,left:0,zIndex:100,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:10,boxShadow:'0 8px 24px rgba(0,0,0,.12)',minWidth:160,overflow:'hidden',maxHeight:250,overflowY:'auto'}}>{(SUBCATS_OFICINA[catOficinaNueva(e.category)]||[]).map(s=><div key={s} onClick={()=>setSubcatOficina(e,s)} style={{padding:'7px 12px',fontSize:12,color:s===e.subcategory?C.accent:C.text,fontWeight:s===e.subcategory?600:400,cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}>{s}</div>)}<div onClick={async()=>{ const nv=await appPrompt('Otro desglose:'); if(nv&&nv.trim()) setSubcatOficina(e,nv.trim()) }} style={{padding:'7px 12px',fontSize:12,color:C.accent,fontWeight:600,cursor:'pointer'}}>+ Otro…</div></div></>}
                </div>}
                {triageOpen===e.id ? (
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                    {PERSONAS_NOTA.map(p=>{const pc=personChip(p);return <button key={p} onClick={()=>{triagePersonal(e,p);setTriageOpen(null)}} style={{fontSize:11,borderRadius:20,padding:'3px 11px',fontWeight:600,cursor:'pointer',background:pc.bg,color:pc.color,border:`0.5px solid ${pc.color}33`}}>{p}</button>})}
                    <button onClick={()=>setTriageOpen(null)} style={{fontSize:11,color:C.muted,background:'none',border:'none',cursor:'pointer'}}>Es de la oficina</button>
                  </div>
                ) : (
                  <button onClick={()=>setTriageOpen(e.id)} style={{fontSize:11,fontWeight:600,color:C.grisText,background:C.bgWarm,border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>Personal <Gl n='chevD'/></button>
                )}
              </div>
            ) })()}
            {movExp===e.id&&needsClass&&(
              <div style={{marginTop:6}} onClick={stop}>
                {e.created_by ? (
                  <span style={{display:'inline-flex',alignItems:'center',fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.greenBg,color:C.greenText,fontWeight:700,whiteSpace:'nowrap'}}>Caja chica · {e.created_by}{isAdmin&&<button title='Quitar de caja chica' onClick={()=>onAssignCajaChica&&onAssignCajaChica(e,{clear:true})} style={xBtn}><Gl n='x'/></button>}</span>
                ) : e.paid_by_client ? (
                  <span style={{display:'inline-flex',alignItems:'center',fontSize:9.5,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.accent,fontWeight:700,whiteSpace:'nowrap'}}>Fondos del cliente{isAdmin&&<button title='Deshacer' onClick={()=>onAssignCajaChica&&onAssignCajaChica(e,{clear:true})} style={xBtn}><Gl n='x'/></button>}</span>
                ) : isAdmin ? (
                  <>
                    <button onClick={()=>setClassifyFor(classifyFor===e.id?null:e.id)} style={chipAdd}>+ Clasificar</button>
                    {classifyFor===e.id&&(
                      <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:6,background:C.bgSoft,borderRadius:8,padding:'8px 10px'}}>
                        <span style={{fontSize:10,color:C.textSoft,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>Caja chica de</span>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          {cajaPersons.length===0&&<span style={{fontSize:11,color:C.muted}}>Nadie tiene caja chica activa.</span>}
                          {cajaPersons.map(p=><button key={p} onClick={()=>{onAssignCajaChica&&onAssignCajaChica(e,{person:p});setClassifyFor(null)}} style={chipPerson}>{p}</button>)}
                        </div>
                        <button onClick={()=>{onAssignCajaChica&&onAssignCajaChica(e,{paidByClient:true});setClassifyFor(null)}} style={{...chipPerson,alignSelf:'flex-start'}}>Pagado con fondos del cliente</button>
                      </div>
                    )}
                  </>
                ) : <span style={{fontSize:10,color:C.textSoft}}>Sin clasificar</span>}
              </div>
            )}
            {/* Asignar razón social POR GASTO (solo si el cliente tiene 2+ RS): pills si ≤3, selector si más */}
            {(()=>{
              const rsOpts=(clientEntities||[]).filter(x=>String(x.client_id)===String(selectedClient?.id))
              if(isFondo||rsOpts.length<2||movExp!==e.id) return null
              const open=rsPickFor===e.id
              const rsNm=id=>rsOpts.find(x=>String(x.id)===String(id))?.name||'—'
              const pickBtns=rsOpts.map(r=><button key={r.id} onClick={()=>{onAssignGastoRS&&onAssignGastoRS(e,r.id);setRsPickFor(null)}} style={chipPerson}>{(r.name||'').slice(0,24)}</button>)
              return (
                <div style={{marginTop:6}} onClick={stop}>
                  {e.entity_id&&!open ? (
                    <button onClick={()=>setRsPickFor(e.id)} title='Tocar para cambiar la razón social' style={{display:'inline-flex',alignItems:'center',fontSize:10,padding:'2px 8px',borderRadius:12,background:C.azulBg,color:C.accent,fontWeight:600,border:'none',cursor:'pointer'}}>{rsNm(e.entity_id)}</button>
                  ) : rsOpts.length<=3 ? (
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                      <span style={{fontSize:10,color:C.textSoft,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>Asignar a</span>
                      {pickBtns}
                      {open&&<button onClick={()=>setRsPickFor(null)} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>}
                    </div>
                  ) : !open ? (
                    <button onClick={()=>setRsPickFor(e.id)} style={chipAdd}>Asignar razón social <Gl n='chevD'/></button>
                  ) : (
                    <div style={{marginTop:2,display:'flex',flexDirection:'column',gap:5,background:C.bgSoft,borderRadius:8,padding:'8px 10px'}}>
                      <span style={{fontSize:10,color:C.textSoft,fontWeight:600,textTransform:'uppercase',letterSpacing:.4}}>Asignar razón social</span>
                      {rsOpts.map(r=><button key={r.id} onClick={()=>{onAssignGastoRS&&onAssignGastoRS(e,r.id);setRsPickFor(null)}} style={{textAlign:'left',padding:'7px 10px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',fontSize:12,color:C.text,cursor:'pointer'}}>{r.name}{r.rut?` · ${fmtRutCL(r.rut)}`:''}</button>)}
                      <button onClick={()=>setRsPickFor(null)} style={{background:'none',border:'none',color:C.muted,fontSize:11,cursor:'pointer',alignSelf:'flex-start'}}>Cancelar</button>
                    </div>
                  )}
                </div>
              )
            })()}
            {movExp===e.id&&<div style={{display:'flex',gap:16,alignItems:'center',marginTop:8}}>
              <button onClick={ev=>{ev.stopPropagation();onEdit(e)}} style={{fontSize:11,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0}}>Editar →</button>
              {isAdmin&&!isFondo&&e.client_id&&!esOficina(e.client_id)&&!e.incobrable_at&&!e.client_rendered_at&&<button onClick={ev=>{ev.stopPropagation();marcarEstado(e,'incobrable')}} title='No se le cobrará al cliente: sale de su saldo y lo asume la oficina' style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:0}}>Marcar incobrable</button>}
            </div>}
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:5,flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {!isFondo&&<AdjuntoIcon e={e}/>}
              <div style={{fontSize:14,fontWeight:700,color:isDev?C.muted:isFondo?C.normal:(e.no_descuenta_saldo?C.done:C.overdue),textDecoration:e.no_descuenta_saldo?'line-through':'none'}}>{isDev?'−'+fmt(Math.abs(e.amount)):(isFondo?'+':'-')+fmt(e.amount)}</div>
              <button onClick={ev=>{ev.stopPropagation();setMovExp(p=>p===e.id?null:e.id)}} title={movExp===e.id?'Cerrar':'Más acciones'} aria-label='Más acciones' style={{width:30,height:30,border:'none',background:'none',padding:0,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',transform:movExp===e.id?'rotate(90deg)':'none',transition:'transform .15s'}}><SIcon n='chevron' s={14} c={C.done}/></button>
            </div>
            {e.client_id&&!esOficina(e.client_id)&&saldoTras[e.id]!=null&&<div style={{fontSize:10.5,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',marginTop:-4,paddingRight:30}}>saldo {fmtSaldoG(saldoTras[e.id])}</div>}
            {movExp===e.id&&!isFondo&&e.category==='Notaria'&&!e.ot_number&&!e.notaria_liquidado_at&&!e.notaria_render_id&&!e.rendered_at&&isAdmin&&(
              <button onClick={ev=>{ev.stopPropagation();marcarNotariaPagado(e,ev)}} title='Marcar como pagado a la notaría (sale de "por pagar" y de caja chica)' style={{fontSize:10,padding:'1px 7px',borderRadius:4,border:`0.5px solid ${C.coralText}`,background:'#fff',color:C.coralText,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Marcar pagado</button>
            )}
            {movExp===e.id&&showEstado && (
              <div style={{position:'relative'}} onClick={stop}>
                <button onClick={()=>setEstadoFor(estadoFor===e.id?null:e.id)} style={chipEstado}>Estado <Gl n='chevD'/></button>
                {estadoFor===e.id && <>
                  <div onClick={()=>setEstadoFor(null)} style={{position:'fixed',inset:0,zIndex:90}}/>
                  <div style={{position:'absolute',top:26,right:0,zIndex:100,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,minWidth:188,overflow:'hidden',boxShadow:'0 4px 14px rgba(0,0,0,.1)'}}>
                    <div onClick={()=>{marcarEstado(e,'historico');setEstadoFor(null)}} style={{padding:'8px 11px',borderBottom:`0.5px solid ${C.azulBg}`,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                      <span style={{color:C.grisText,display:'inline-flex'}}>{icoReloj()}</span>
                      <div><div style={{fontSize:12,color:C.grisText,fontWeight:600}}>Histórico</div><div style={{fontSize:10,color:C.muted}}>No descuenta el saldo</div></div>
                    </div>
                    <div onClick={()=>{marcarEstado(e,'descuenta');setEstadoFor(null)}} style={{padding:'8px 11px',cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                      <span style={{color:C.greenText,display:'inline-flex'}}>{icoBaja()}</span>
                      <div><div style={{fontSize:12,color:C.greenText,fontWeight:600}}>Descuenta</div><div style={{fontSize:10,color:C.muted}}>Sí baja el saldo</div></div>
                    </div>
                    {!e.incobrable_at&&<div onClick={()=>{marcarEstado(e,'incobrable');setEstadoFor(null)}} style={{padding:'8px 11px',borderTop:`0.5px solid ${C.azulBg}`,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                      <span style={{color:C.grisText,display:'inline-flex'}}>{icoBaja()}</span>
                      <div><div style={{fontSize:12,color:C.grisText,fontWeight:600}}>Incobrable</div><div style={{fontSize:10,color:C.muted}}>A cargo de la oficina</div></div>
                    </div>}
                  </div>
                </>}
              </div>
            )}
          </div>
        </div>
        {extra}
      </div>
    )
  }

  // ── Historial de rendiciones (helpers compartidos lista + ficha) ──
  const HH = {fontSize:10,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:'0.06em'}
  const estadoBadge = r => r.anulada_at
    ? <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.overdueBg,color:C.overdue,whiteSpace:'nowrap'}}>Anulada</span>
    : r.sent_at
    ? <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.greenBg,color:C.greenText,whiteSpace:'nowrap'}}>Enviada</span>
    : <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.soonBg,color:C.soonText,whiteSpace:'nowrap'}}>Borrador</span>
  const rsOfRend = r => { const g=expenses.find(e=>e.client_render_id===r.id&&e.entity_id); const ent=g?(clientEntities||[]).find(x=>x.id===g.entity_id):null; return (ent&&ent.name)||'' }
  const verPdfRend = r => { const cl=clients.find(c=>c.id===r.client_id); const w=window.open('','_blank'); if(w){ w.document.write(r.pdf_html||rendicionPdfHtml(r,cl,expenses,clientEntities)); w.document.close() } }
  const renderRendRow = (r,showClient,timeline) => {
    const cl=clients.find(x=>x.id===r.client_id)
    const rs=showClient?'':rsOfRend(r)
    return (
      <div key={r.id} style={{padding:'10px 0',borderBottom:`1px solid ${C.border}`,opacity:r.anulada_at?0.6:1}}>
        {(()=>{
          const d=r.created_at?new Date(r.created_at):null
          const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
          const proj = r.project ? (r.subproject?`${r.project} · ${r.subproject}`:r.project) : ''
          return (
          <div onClick={()=>setExpandRend(expandRend===r.id?null:r.id)} style={{display:'flex',gap:13,alignItems:'center',cursor:'pointer'}}>
            <div style={{textAlign:'center',width:40,flexShrink:0}}><div style={{fontSize:17,fontWeight:600,color:C.accent,lineHeight:1}}>{d&&!isNaN(d)?d.getDate():'—'}</div><div style={{fontSize:9,color:C.textSoft,marginTop:2}}>{d&&!isNaN(d)?`${M[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`:''}</div></div>
            <div style={{flex:1,minWidth:0}}>
              {showClient&&<div style={{...NOMBRE_CLI}}>{cl&&onOpenClientFicha?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(cl.id)}} style={{cursor:'pointer'}}>{cl.name}</span>:(cl?.name||'Cliente')}</div>}
              {proj
                ? <span style={{display:'inline-block',fontSize:10,fontWeight:600,color:C.accent,background:C.azulBg,borderRadius:12,padding:'1px 7px',maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',verticalAlign:'middle'}}>{proj}</span>
                : (!showClient&&<span style={{fontSize:13,fontWeight:600,color:C.text}}>Rendición</span>)}
              <div style={{fontSize:11,color:C.textSoft,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.sent_at&&r.correlativo?<b style={{color:C.muted}}>N° {r.correlativo} · </b>:''}{r.user_name||''}{rs?` · ${rs}`:''} · {r.n_gastos} gasto{r.n_gastos!==1?'s':''}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:13,fontWeight:600,color:C.overdue,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>-{fmt(r.total)}</div><div style={{marginTop:3,display:'flex',gap:4,justifyContent:'flex-end',flexWrap:'wrap'}}>{estadoBadge(r)}{r.devolucion_at&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.accent,whiteSpace:'nowrap'}}>Devolución enviada</span>}</div></div>
          </div>
          )
        })()}
        {expandRend===r.id&&(()=>{
          const gastos=expenses.filter(e=>e.client_render_id===r.id)
          return <div style={{marginTop:8,padding:'8px 11px',background:C.bgSoft,borderRadius:8}}>
            {r.ot_numbers&&<div style={{fontSize:10,color:C.azulInfo,fontWeight:600,marginBottom:6,paddingBottom:6,borderBottom:`1px solid ${C.border}`}}>OT incluidas: {r.ot_numbers}</div>}
            {gastos.length===0?<div style={{fontSize:11,color:C.muted}}>{r.anulada_at?'Rendición anulada — usa "Ver PDF" para ver el detalle congelado.':'Sin detalle de gastos.'}</div>:gastos.map((e,i)=>(
              <div key={e.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'5px 0',borderBottom:i<gastos.length-1?`1px solid ${C.border}`:'none',fontSize:12}}>
                <div style={{minWidth:0}}>
                  <div style={{color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}{e.ot_number?<span style={{fontSize:10,color:C.azulInfo,fontWeight:600,marginLeft:5}}>{String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number}</span>:''}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{RENDCAT(e.category)}{e.subcategory?': '+e.subcategory:''} · {fmtFechaDMY(e.date)}</div>
                </div>
                <div style={{color:C.overdue,fontWeight:600,whiteSpace:'nowrap'}}>-{fmt(e.amount)}</div>
              </div>
            ))}
          </div>
        })()}
        {expandRend===r.id&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
          {r.anulada_at
            ? <span style={{fontSize:10,color:C.overdue,fontWeight:600}}>Anulada{r.anulada_por?` · ${r.anulada_por}`:''}</span>
            : <button onClick={()=>handleAnularRendicion(r)} style={{fontSize:10,color:C.overdue,background:'none',border:`1px solid ${C.overdue}`,borderRadius:6,padding:'3px 9px',cursor:'pointer'}}>Anular</button>}
          <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
            {cl&&!r.anulada_at&&<ActBtn variant='ghost' onClick={()=>{setRendEdit(r);setRendEntityIds([]);setRendicionClient(cl)}}>Editar</ActBtn>}
            <ActBtn variant='ghost' onClick={()=>verPdfRend(r)}>Ver PDF</ActBtn>
            {cl&&!r.anulada_at&&<button onClick={()=>setEmailRend(r.correlativo?r:{...r,correlativo:corrSiguiente(rendiciones,r.client_id)})} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'}}>{r.sent_at?'Reenviar rendición':'Enviar rendición'}</button>}
            {cl&&!r.anulada_at&&r.sent_at&&<button onClick={()=>{ const devF=(expenses||[]).find(e=>e.type==='fondo'&&(e.amount||0)<0&&String(e.client_id)===String(r.client_id)&&new RegExp('rendici[oó]n n°\\s*'+(r.correlativo||'?'),'i').test(e.concept||'')); const amt=devF?Math.abs(devF.amount):Math.max(0,saldoCliente(expenses,r.client_id)); setDevEmailRend({rend:r,client:cl,amount:amt,fecha:devF?devF.date:new Date().toISOString().slice(0,10)}) }} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${C.azulInfo}`,background:'#fff',color:C.azulInfo,fontSize:11,fontWeight:600,cursor:'pointer'}}>{r.devolucion_at?'Reenviar devolución':'Enviar devolución'}</button>}
            {cl&&!r.anulada_at&&<button onClick={async()=>{ const now=r.devolucion_at?null:new Date().toISOString(); try{ await supabase.from('rendiciones').update({devolucion_at:now}).eq('id',r.id); if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===r.id?{...x,devolucion_at:now}:x)) }catch(e){ appAlert('No se pudo marcar: '+(e.message||e)) } }} title={r.devolucion_at?'Quitar la marca':'Marcar como enviada sin mandar correo'} style={{padding:'4px 10px',borderRadius:8,border:`1px solid ${r.devolucion_at?C.greenText:C.border}`,background:r.devolucion_at?C.greenBg:'#fff',color:r.devolucion_at?C.greenText:C.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>{r.devolucion_at?'Devolución enviada':'Marcar a mano'}</button>}
          </div>
        </div>}
      </div>
    )
  }
  const renderHistorialTable = (rends,showClient,timeline) => {
    if(!rends.length) return <div style={{color:C.muted,textAlign:'center',padding:24,fontSize:12}}>Sin rendiciones</div>
    const activas = rends.filter(r=>!r.anulada_at)
    const anuladas = rends.filter(r=>r.anulada_at)
    return (<>
      {activas.map(r=>renderRendRow(r,showClient,timeline))}
      {activas.length===0&&<div style={{color:C.muted,textAlign:'center',padding:'14px 0',fontSize:12}}>Sin rendiciones activas</div>}
      {anuladas.length>0&&<details style={{marginTop:2}}>
        <summary style={{fontSize:12,color:C.textSoft,cursor:'pointer',padding:'10px 2px',listStyleType:'none'}}>Anuladas · {anuladas.length}</summary>
        {anuladas.map(r=>renderRendRow(r,showClient,timeline))}
      </details>}
    </>)
  }

  // Exporta el Historial filtrado (tab + Mes/Año/buscador actuales) a CSV. Separador ';' + BOM = abre en Excel Chile.
  const exportHist = () => {
    const okF=r=>{ const ca=r.created_at||''; if(hAnio&&ca.slice(0,4)!==hAnio) return false; if(hMes&&ca.slice(5,7)!==hMes) return false; return true }
    const q=hQ.trim().toLowerCase()
    const esc=v=>{ const s=String(v==null?'':v); return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s }
    let headers, rows, name
    if(histTab==='clientes'){
      const rs=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&okF(r)&&(!q||(clients.find(x=>x.id===r.client_id)?.name||'').toLowerCase().includes(q)))
      headers=['Fecha','Cliente','Razon social','Proyecto','Usuario','N gastos','Estado','Total','Enviada']
      rows=rs.map(r=>{ const cl=clients.find(x=>x.id===r.client_id); const est=r.anulada_at?'Anulada':(r.sent_at?'Enviada':'Por enviar'); return [(r.created_at||'').slice(0,10),cl?.name||'',rsOfRend(r),r.project?(r.subproject?`${r.project} - ${r.subproject}`:r.project):'',r.user_name||'',r.n_gastos||0,est,Math.round(r.total||0),r.sent_at?(r.sent_at||'').slice(0,10):''] })
      name='historial_rendiciones'
    } else {
      const rs=notaLiquidaciones.filter(r=>okF(r)&&(!q||String(r.periodo||'').toLowerCase().includes(q)))
      headers=['Fecha','Periodo','N OT','Estado','Total']
      rows=rs.map(r=>{ const est=notaEstado(r); return [(r.created_at||'').slice(0,10),r.periodo||'',r.n_gastos||0,est==='enviada'?'Enviada':est==='por_enviar'?'Por enviar':'Pagado historico',Math.round(r.total||0)] })
      name='historial_notaria'
    }
    if(!rows.length){ appAlert('No hay registros para exportar con estos filtros.'); return }
    const csv=[headers,...rows].map(r=>r.map(esc).join(';')).join('\n')
    try{ const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const u=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=u; a.download=`${name}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),1000) }catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) }
  }
  // Sección de historial dentro de la ficha del cliente (solo rendiciones del cliente actual)
  const selStyle = {padding:'7px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,boxSizing:'border-box',outline:'none',width:'100%'}
  const fichaHistorial = (()=>{
    if(!selectedClient) return null
    const rends=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&r.client_id===selectedClient.id).sort((a,b)=>b.created_at>a.created_at?1:-1)
    if(!rends.length) return null   // sin rendiciones → no mostrar la sección vacía (ahorra espacio)
    return (
      <div style={{marginTop:18,paddingTop:14,borderTop:`1px solid ${C.border}`}}>
        <div style={{...SEC_LBL,marginBottom:12}}>Historial de rendiciones</div>
        {renderHistorialTable(rends,false)}
      </div>
    )
  })()
  // Separa gastos rendidos al cliente (client_rendered_at) y los muestra en una sección "Rendidos" colapsada (fuera de activos).
  const esRendido = e => e.type!=='fondo' && !!e.client_rendered_at
  // Selector «añadir gastos a notaría» (agrupado por cliente con fondos). Único: se reutiliza en Liquidar Notaría y en Historial.
  const addPicker = (r) => {
                    // Selector agrupado por cliente: solo clientes con fondos disponibles (la oficina se cubre sola), replegados, con buscador.
                    const byCli={}; notariaPend.forEach(e=>{ if(!e.client_id) return; (byCli[e.client_id]=byCli[e.client_id]||[]).push(e) })
                    let grupos=Object.entries(byCli).map(([cid,items])=>{ const {disp,oficina:esOf}=dispCliente(cid); const cli=clients.find(c=>String(c.id)===String(cid)); return { cid, cli, items, total:items.reduce((a,e)=>a+(e.amount||0),0), disp, esOf, fecha:items.reduce((m,e)=>(e.date||'')>m?(e.date||''):m,'') } }).filter(g=> g.esOf || g.disp>0)
                    const q=_normTxt(addSearch)
                    if(q) grupos=grupos.map(g=>{ const cmatch=_normTxt(g.cli?.name).includes(q)||_normTxt(g.cli?.abogado_responsable).includes(q); const items=cmatch?g.items:g.items.filter(e=>_normTxt(e.concept).includes(q)||_normTxt(fmtOt(e.ot_number)).includes(q)); return {...g,items,_open:!cmatch} }).filter(g=>g.items.length>0)
                    grupos.sort((a,b)=>a.fecha<b.fecha?1:-1)
                    const selTot=notariaPend.filter(e=>addSel.has(e.id)).reduce((a,e)=>a+(e.amount||0),0)
                    return (
                    <div style={{marginTop:8,background:C.bgSoft,borderRadius:8,padding:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:20,padding:'0 11px',height:31,marginBottom:9}}>
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>
                        <input value={addSearch} onChange={ev=>setAddSearch(ev.target.value)} placeholder='Buscar cliente, OT o trámite' style={{flex:1,border:'none',background:'none',outline:'none',fontSize:12,color:C.text}}/>
                        {addSearch&&<span onClick={()=>setAddSearch('')} style={{color:C.textSoft,fontSize:16,cursor:'pointer',lineHeight:1}}><Gl n='x'/></span>}
                      </div>
                      {grupos.length===0
                        ? <div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'14px 0'}}>{addSearch?'Sin resultados.':'No hay clientes con fondos disponibles.'}</div>
                        : <>
                          <div style={{fontSize:9,color:C.muted,fontWeight:600,letterSpacing:.3,marginBottom:7}}>{grupos.length} CLIENTE{grupos.length!==1?'S':''} CON FONDOS · TOCA PARA VER SUS GASTOS</div>
                          {grupos.map(g=>{ const open=g._open||addOpenCli.has(g.cid); const cn=g.cli?.name||'Cliente'; const ab=g.cli?.abogado_responsable; return (
                            <div key={g.cid} style={{background:'#fff',border:`0.5px solid ${open?C.done:C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:6}}>
                              <div onClick={()=>setAddOpenCli(p=>{const n=new Set(p);n.has(g.cid)?n.delete(g.cid):n.add(g.cid);return n})} style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:13,fontWeight:600,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{cn}</div>
                                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{ab?ab+' · ':''}{g.items.length} OT · {fmt(g.total)}</div>
                                </div>
                                {g.esOf
                                  ? <div style={{fontSize:11,fontWeight:600,color:C.greenText,flexShrink:0}}>Se cubre sola</div>
                                  : <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:8,color:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>Disponible</div><div style={{fontSize:13,fontWeight:600,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{fmt(g.disp)}</div></div>}
                                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .15s'}}><polyline points='6 9 12 15 18 9'/></svg>
                              </div>
                              {open&&<div style={{marginTop:9,paddingTop:8,borderTop:`0.5px solid ${C.border}`,display:'flex',flexDirection:'column',gap:9}}>
                                {g.items.map(e=>{ const on=addSel.has(e.id); return (
                                  <div key={e.id} onClick={()=>setAddSel(p=>{const n=new Set(p);n.has(e.id)?n.delete(e.id):n.add(e.id);return n})} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer',fontSize:11}}>
                                    <span style={{width:16,height:16,borderRadius:4,flexShrink:0,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
                                    <span style={{color:C.azulInfo,fontWeight:600,width:58,flexShrink:0}}>{fmtOt(e.ot_number)}</span>
                                    <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{e.concept||'—'}</span>
                                    <span style={{fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{fmt(e.amount)}</span>
                                  </div>) })}
                              </div>}
                            </div>
                          )})}
                        </>}
                      <button disabled={addSel.size===0} onClick={()=>anadirGastosNota(r,[...addSel])} style={{width:'100%',marginTop:4,fontSize:13,fontWeight:600,background:addSel.size?C.accent:C.done,color:'#fff',border:'none',borderRadius:10,padding:11,cursor:addSel.size?'pointer':'default'}}>{addSel.size?`Añadir ${addSel.size} OT · ${fmt(selTot)}`:'Selecciona gastos'}</button>
                    </div>) }
  const rendidosBlock = (key,rend) => { if(!rend.length) return null; const open=rendOpen.has(key); const tot=rend.reduce((a,e)=>a+(e.amount||0),0); return (
    <div style={{marginTop:6}}>
      <div onClick={()=>setRendOpen(p=>{const n=new Set(p);n.has(key)?n.delete(key):n.add(key);return n})} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'9px 4px',cursor:'pointer',borderTop:`1px solid ${C.border}`}}>
        <span style={{fontSize:9,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.3}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>} Rendidos · {rend.length}</span>
        <span style={{fontSize:11,color:C.muted,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(tot)}</span>
      </div>
      {open&&rend.map(renderMov)}
    </div>) }
  const gastosClasificar = (expenses||[]).filter(e=> e.type==='gasto' && e.bulk_import_id && e.client_id && !e.personal_de && !e.created_by && !esOficina(e.client_id) && !e.rendered_at && !e.client_rendered_at && !e.pagado_cliente_at && !e.deleted_at)
  const isDesktop = useIsDesktop()   // Fase 3: desktop = 2-panel (lista de clientes izq + detalle/paneles der); movil = columna
  return { handleEliminarBorrador, histSinEnv, setHistSinEnv, marcarConsulta, catMenu, setCatMenu, ofiLente, setOfiLente, ofiMesOpen, setOfiMesOpen, selectedClient, setSelectedClient, notaMenuOpen, setNotaMenuOpen, verArchivadosG, setVerArchivadosG, classifyFor, setClassifyFor, rsPickFor, setRsPickFor, movExp, setMovExp, rendOpen, setRendOpen, gastoOrd, setGastoOrd, gastoCatF, setGastoCatF, gastoPagF, setGastoPagF, gastoRsF, setGastoRsF, saldoTras, pagadoPorGasto, notaLiqOpen, setNotaLiqOpen, notaLiqAdd, setNotaLiqAdd, addSel, setAddSel, addSearch, setAddSearch, addOpenCli, setAddOpenCli, liqDetail, setLiqDetail, cajaPersons, showOrphans, setShowOrphans, orfSug, orfBusy, orfRan, orfAuto, orfAutoOpen, setOrfAutoOpen, orfQ, setOrfQ, orfPickFor, setOrfPickFor, aplicarOrf, deshacerOrf, runOrfAsistente, q, setQ, saldoFilter, setSaldoFilter, showPersonales, setShowPersonales, respFilter, setRespFilter, triageOpen, setTriageOpen, subMenu, setSubMenu, respPickG, setRespPickG, asignarRespG, attachExpense, setAttachExpense, rendEntityIds, setRendEntityIds, selRS, setSelRS, openRS, setOpenRS, rendicionClient, setRendicionClient, rendEdit, setRendEdit, showHistorial, setShowHistorial, histTab, setHistTab, histOrden, setHistOrden, emailRend, setEmailRend, devEmailRend, setDevEmailRend, hQ, setHQ, hMes, setHMes, hAnio, setHAnio, showHistorialFicha, setShowHistorialFicha, hFichaDesde, setHFichaDesde, hFichaHasta, setHFichaHasta, handleAnularRendicion, anularGastoRendido, marcarNotariaPagado, estadoFor, setEstadoFor, marcarEstado, clasifBulk, asignandoRS, setAsignandoRS, expandRend, setExpandRend, balances, clientsWithMovs, archivadosG, filteredClients, filtered, gastoCats, gastoToolbar, orphans, clientById, revGroup, revNoActivo, revOcasional, revOpen, setRevOpen, showRevision, setShowRevision, showReasignar, setShowReasignar, reasignFrom, setReasignFrom, revSel, setRevSel, toggleSel, revDupConfirm, setRevDupConfirm, showHist, setShowHist, showDescuadres, setShowDescuadres, descOpen, setDescOpen, doMove, revMoverA, revPick, setRevPick, revN, showNotaria, setShowNotaria, showClasificar, setShowClasificar, showGastosOficina, setShowGastosOficina, showBuscarClientes, setShowBuscarClientes, showRendiciones, setShowRendiciones, rendSub, setRendSub, revSub, setRevSub, selClasif, setSelClasif, clasifSearch, setClasifSearch, clasifOpen, setClasifOpen, movMode, setMovMode, movSel, setMovSel, selNota, setSelNota, excepNota, setExcepNota, notaSending, setNotaSending, reenviando, setReenviando, notaConfirm, setNotaConfirm, NOTARIA_DEFAULT, cleanNotaDest, notaEmail, setNotaEmail, notaSend, setNotaSend, compFile, setCompFile, notaTab, setNotaTab, docSub, setDocSub, notaMsg, setNotaMsg, notaSubject, setNotaSubject, notaBolRS, setNotaBolRS, notaBolRUT, setNotaBolRUT, notaBolPick, setNotaBolPick, abrirEnvioNotaria, aplicarBoletas, notaResp, setNotaResp, notariaPend, notariaAnulados, notaAnulOpen, setNotaAnulOpen, eliminarGastoNota, notaSel, notaTotal, dispCliente, dispPersona, coberturaPersona, notaPendTotal, notaLiquidaciones, toggleNota, notaFondos, setNotaFondos, notaPersonaPick, setNotaPersonaPick, PERSONAS_NOTA, notaGroups, marcarPersonal, esOficina, gastosPorRendir, rendirPend, ultRep, setUltRep, repetirCostosFijos, deshacerRepetir, catsOficina, setCatOficina, setSubcatOficina, triagePersonal, notaRow, notaSinFondosSel, periodoNota, liquidarNotaria, marcarPagadoNotaria, notaEstado, notaPagada, enviarNotaria, reenviarNotaria, deshacerNotaria, fmtOt, descargarExcelNota, anadirGastosNota, CATS, clientBalance, saldo, selEnts, rb, multiRS, cFondos, cSaldo, KpiRect, KpiRow, AdjuntoIcon, renderMov, HH, estadoBadge, rsOfRend, verPdfRend, renderRendRow, renderHistorialTable, exportHist, selStyle, fichaHistorial, esRendido, addPicker, rendidosBlock, gastosClasificar, isDesktop, notaOrigen, setNotaOrigen }
}

export const ESTADOS_G=[['vigentes','Vigentes'],['inactivos','Inactivos'],['incobrables','Incobrables'],['todos','Todos']]

// ── Rendir a cliente: la lista se ordena por lo que hay que hacer con cada cliente (no por nombre) ──
// Grupos: rendir y pedir (queda en contra) · rendir a favor · rendir en cero · rendición armada sin enviar · esperando depósito
// (todo rendido y en contra: pedir o seguir la solicitud). Lo al día queda fuera. Terminados con pendientes van aparte (cierre).
// Fuentes únicas: gastosPorRendirCli (sin los de $0), saldoCliente, rendiciones (sent_at), fund_requests + estadoSolicitud.
export let _rendirUlt = null   // último cliente abierto desde la lista → al volver se ofrece el siguiente del mismo grupo

export const _RENDIR_G = [
  {k:'pedir', t:'Rendir y pedir', ic:'tCobrar', bg:C.overdueBg, col:C.overdueText, btn:'Rendir y pedir'},
  {k:'favor', t:'A favor', ic:'tFavor', bg:C.greenBg, col:C.greenText, btn:'Rendir'},
  {k:'cero',  t:'En cero', ic:'tCero', bg:C.azulBg, col:C.accent, btn:'Rendir'},
  {k:'env',   t:'Borradores', ic:'mail', bg:C.soonBg, col:C.soonText, btn:'Enviar'},
  {k:'prep',  t:'Borrador preparado', ic:'file', bg:C.soonBg, col:C.soonText, btn:'Revisar'},
  {k:'dep',   t:'Esperando', ic:'tEspera', bg:C.soonBg, col:C.soonText, btn:'Pedir'},
  {k:'envd',  t:'Enviadas', ic:'check', bg:C.greenBg, col:C.greenText, btn:'Ver PDF'},
]

export function RendirClientesPage({grupoInicial=null, abgInicial=null, clients=[], expenses=[], rendiciones=[], clientEntities=[], sales=[], currentUserName, isAdmin, onRendir, onEnviarRend, onVerRend, onEditarRend, onEliminarBorr, detInicial=null, onDetInicialUsado, onSolicitar, onOpenMovBanco, onOpenClientFicha}){
  const D=useIsDesktop()
  const prefKey=`fd_rendir_${currentUserName||'x'}`
  const pref=(()=>{ try{ return JSON.parse(localStorage.getItem(prefKey)||'null')||{} }catch(_){ return {} } })()
  const [g,setG]=useState(grupoInicial||pref.g||'pedir')
  const [abg,setAbg]=useState(abgInicial||pref.abg||null)
  const [ord,setOrd]=useState(pref.ord||'ant')
  const [autor,setAutor]=useState(pref.autor||null)   // Borradores: hechos por (Todos / una persona)
  const [q,setQ]=useState('')
  const [verTerm,setVerTerm]=useState(false)
  const [reqs,setReqs]=useState([])
  const [ult,setUlt]=useState(_rendirUlt)
  const [detR,setDetR]=useState(detInicial)   // rendición abierta (borrador o enviada): su detalle (al volver de editarla, se reabre)
  useEffect(()=>{ if(detInicial&&onDetInicialUsado) onDetInicialUsado() },[])   // solo al montar: se consume una vez
  const [excl,setExcl]=useState(()=>new Set())   // borradores revisados que NO van en el envío conjunto (por defecto van todos)
  const [confEnv,setConfEnv]=useState(false)   // confirmación del envío conjunto
  // Corte semanal: el lunes se preparan los borradores de los clientes que ya tenían gastos por rendir; lo cargado después espera al lunes siguiente.
  const lunesISO=lunesSemanaISO()
  useEffect(()=>{ try{ localStorage.setItem(prefKey,JSON.stringify({g,abg,ord,autor})) }catch(_){} },[g,abg,ord,autor])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{ if(DEMO) return; let on=true
    supabase.from('fund_requests').select('*').order('enviada_at',{ascending:false}).limit(500).then(({data})=>{ if(on) setReqs(data||[]) },()=>{})
    return ()=>{ on=false } },[])
  // Responsable de cada cliente (ficha; si no, la venta más reciente) — misma regla que «Pedir fondos a los abogados».
  const respDe=useMemo(()=>respClientes(clients,sales),[clients,sales])
  const esOfi=c=>!!c&&(c.is_internal||/liberona\s+escala/i.test(c.name||''))
  const filas=useMemo(()=>{
    const conMov=new Set((expenses||[]).filter(e=>!e.deleted_at&&e.client_id).map(e=>String(e.client_id)))
    const rendCli=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&!r.anulada_at)
    return (clients||[]).filter(c=>conMov.has(String(c.id))&&!esOfi(c)).map(c=>{
      const pr=gastosPorRendirCli(expenses,c.id).filter(e=>(Number(e.amount)||0)!==0)
      const n=pr.length, m=pr.reduce((a,e)=>a+(Number(e.amount)||0),0)
      const fechas=pr.map(e=>e.date).filter(Boolean).sort()
      const sinFecha=pr.filter(e=>!e.date).length
      const nRS=new Set(pr.map(e=>e.entity_id).filter(Boolean)).size
      const s=saldoCliente(expenses,c.id)
      const armada=rendCli.filter(r=>String(r.client_id)===String(c.id)&&!r.sent_at).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null
      const ultEnv=rendCli.filter(r=>String(r.client_id)===String(c.id)&&r.sent_at).sort((a,b)=>String(b.sent_at).localeCompare(String(a.sent_at)))[0]||null
      const req=(reqs||[]).filter(r=>String(r.client_id)===String(c.id)).sort((a,b)=>String(b.enviada_at).localeCompare(String(a.enviada_at)))[0]||null
      const reqSt=req?estadoSolicitud(req,expenses):null
      const pedido=req&&reqSt&&reqSt.k!=='rec'?{req,dias:reqSt.dias,vencido:reqSt.k==='sin'}:null
      const prep = esPreparadoCli(pr, lunesISO)
      const grp = grupoRendir({n,s,armada})
      return {c, prep, n, m, desde:fechas[0]||null, sinFecha, nRS, s, armada, ultEnv, pedido, grp, term:c.status==='Terminado', abg:respDe[String(c.id)]||'Sin abogado'}
    })
  },[clients,expenses,rendiciones,reqs,respDe,lunesISO])   // eslint-disable-line react-hooks/exhaustive-deps
  // Depósito recibido → cierra sola la solicitud (recibido_at + movimiento del banco), con su rastro en la bitácora.
  useEffect(()=>{ if(DEMO||!reqs.length) return
    const abiertas=reqs.filter(r=>!r.recibido_at).map(r=>({r,st:estadoSolicitud(r,expenses)})).filter(x=>x.st.k==='rec'&&x.st.dep)
    if(!abiertas.length) return
    ;(async()=>{ for(const {r,st} of abiertas){ let mov=null
        try{ const {data}=await supabase.from('conciliacion').select('movimiento_id').eq('gasto_id',st.dep.id).limit(1).maybeSingle(); mov=data?.movimiento_id||null }catch(_){}
        const recAt=new Date(String(st.dep.date||st.dep.created_at).slice(0,10)+'T12:00:00').toISOString()
        const {error}=await supabase.from('fund_requests').update({recibido_at:recAt,movimiento_id:mov,estado:'recibida'}).eq('id',r.id).is('recibido_at',null)
        if(!error){ setReqs(p=>p.map(x=>x.id===r.id?{...x,recibido_at:recAt,movimiento_id:mov,estado:'recibida'}:x)); const cl=(clients||[]).find(c=>String(c.id)===String(r.client_id))
          logActividad('fondos.deposito_recibido',{tabla:'fund_requests',id:r.id,detalle:{cliente:cl?.name,title:`Depósito recibido ${fmtFechaDMY(st.dep.date)}`,monto:Math.round(st.dep.amount||0)}}) } } })()
  },[reqs,expenses])   // eslint-disable-line react-hooks/exhaustive-deps
  const vivos=filas.filter(f=>!f.term)
  // Borradores: una fila por rendición (un cliente puede tener varios, p. ej. separadas por trabajo).
  const borradores = (rendiciones||[]).filter(r=>r.tipo==='cliente'&&!r.sent_at&&!r.anulada_at).map(r=>{ const c=(clients||[]).find(x=>String(x.id)===String(r.client_id)); return c&&!esOfi(c)?{r,c,abg:respDe[String(c.id)]||'Sin abogado'}:null }).filter(Boolean).sort((a,b)=>String(b.r.created_at||'').localeCompare(String(a.r.created_at||'')))
  const enviadas=useMemo(()=>(rendiciones||[]).filter(r=>r.tipo==='cliente'&&r.sent_at&&!r.anulada_at).map(r=>{ const c=(clients||[]).find(x=>String(x.id)===String(r.client_id)); if(!c||esOfi(c)) return null
      const desde=String(r.sent_at).slice(0,10); const req=(reqs||[]).filter(q=>String(q.client_id)===String(c.id)&&String(q.enviada_at||'').slice(0,10)>=desde).sort((a,b)=>String(a.enviada_at).localeCompare(String(b.enviada_at)))[0]||null
      return {r, c, abg:respDe[String(c.id)]||'Sin abogado', req, st:req?estadoSolicitud(req,expenses):null} }).filter(Boolean).sort((a,b)=>String(b.r.sent_at).localeCompare(String(a.r.sent_at))),[rendiciones,clients,reqs,respDe,expenses])   // eslint-disable-line react-hooks/exhaustive-deps
  const term=filas.filter(f=>f.term&&(f.n>0||Math.abs(f.s)>=1000||f.armada))
  // Se abre en lo del abogado que entra (socio o asociado); «Todos» sigue disponible en las pills.
  // Un abogado que no figura en la lista (p. ej. un asociado sin clientes a su nombre) no filtra: antes escondía sus borradores.
  const _abgValido = a => a==='Todos' || vivos.some(f=>f.abg===a) || borradores.some(x=>x.abg===a) || enviadas.some(x=>x.abg===a)
  const abgDef = abg && _abgValido(abg) ? abg : (g!=='env' && vivos.some(f=>f.abg===currentUserName) ? currentUserName : 'Todos')
  const enAbg = x => abgDef==='Todos'||x.abg===abgDef
  useEffect(()=>{ setConfEnv(false) },[g])   // la confirmación del envío conjunto no reaparece al volver a Borradores
  // Borradores = armados (guardados, ya revisados) + preparados (calculados en vivo, sin guardar: no tocan «por rendir» hasta revisarlos).
  // Borradores = rendiciones guardadas por una persona (autor = user_name); cada uno puede ver solo los suyos.
  const borrTodos = borradores.map(x=>({k:x.r.id, tipo:'arm', r:x.r, c:x.c, abg:x.abg, autor:x.r.user_name||'—', n:x.r.n_gastos||0, m:Number(x.r.total)||0, s:fondoDeRend(x.r,expenses,clientEntities).saldo, at:isoLocal(x.r.created_at)})).sort((a,b)=>(b.m-a.m)||(a.c.name||'').localeCompare(b.c.name||'','es'))
  const autores = [...new Set(borrTodos.map(x=>x.autor))].sort((a,b)=>a.localeCompare(b,'es'))
  const autorDef = autor && (autor==='Todos'||autores.includes(autor)) ? autor : (autores.includes(currentUserName) ? currentUserName : 'Todos')
  const borrItems = borrTodos.filter(x=>autorDef==='Todos'||x.autor===autorDef)
  // Sin guardar: lo que se estaba armando en este equipo (de quien entra) y no alcanzó a quedar como borrador.
  const enCurso = (autorDef==='Todos'||autorDef===currentUserName) ? rendicionesEnCurso(clients,expenses,currentUserName).map(x=>({...x,abg:respDe[String(x.c.id)]||'Sin abogado'})).filter(x=>abgDef==='Todos'||x.abg===abgDef) : []
  const base = verTerm ? term : vivos.filter(f=>f.grp===g)
  const abgs=['Todos',...[...new Set([...vivos.map(f=>f.abg),...(g==='envd'?enviadas.map(x=>x.abg):g==='env'?borrItems.map(x=>x.abg):[])])].filter(a=>a!=='Sin abogado').sort((a,b)=>a.localeCompare(b,'es')),...(vivos.some(f=>f.abg==='Sin abogado')?['Sin abogado']:[])]
  const nrm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  let rows=base.filter(f=>(abgDef==='Todos'||f.abg===abgDef)&&(!q.trim()||nrm(f.c.name).includes(nrm(q.trim()))))
  rows=[...rows].sort((a,b)=> ord==='monto' ? (b.m-a.m)||(a.s-b.s) : ord==='az' ? (a.c.name||'').localeCompare(b.c.name||'','es')
    : ord==='rec' ? String(b.desde||'').localeCompare(String(a.desde||'')) : String(a.desde||'9999').localeCompare(String(b.desde||'9999')))
  const G=_RENDIR_G.find(x=>x.k===g)
  const accion=f=>{ _rendirUlt={id:f.c.id,g:verTerm?'term':g}
    if(f.armada) return onEnviarRend&&onEnviarRend(f.armada)
    if(f.n>0) return onRendir&&onRendir(f.c)
    return onSolicitar&&onSolicitar(f.c,Math.round(Math.abs(Math.min(0,f.s))),f.abg!=='Sin abogado'?f.abg:null) }
  const btnTxt=f=> f.armada?'Enviar' : f.n>0?(f.s<=-1000?'Rendir y pedir':'Rendir') : f.pedido?'Volver a pedir':`Pedir ${fmt(Math.abs(f.s))}`
  const tras=f=> f.s<=-1000?<span style={{color:C.textSoft}}>falta <b style={{color:C.text,fontWeight:600}}>{fmt(Math.abs(f.s))}</b></span> : f.s>=1000?<span style={{color:C.textSoft}}>a favor <b style={{color:C.greenText,fontWeight:600}}>{fmt(f.s)}</b></span> : <span style={{color:C.textSoft}}>queda en $0</span>
  const diasDe=iso=>iso?Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/86400000)):0
  const chips=f=>{ const out=[]
    if(f.armada) out.push({t:`armada hace ${diasDe(f.armada.created_at)} d`,c:C.soonText,bg:C.soonBg})
    if(f.pedido) out.push({t:`pedido ${fmtFechaDMY(isoLocal(f.pedido.req.enviada_at))} · ${f.pedido.dias} d`,c:f.pedido.vencido?C.overdueText:C.soonText,bg:f.pedido.vencido?C.overdueBg:C.soonBg})
    if(f.sinFecha) out.push({t:`${f.sinFecha} sin fecha`,c:C.textSoft,bg:C.bgSoft})
    if(f.nRS>1) out.push({t:`${f.nRS} razones sociales`,c:C.accent,bg:C.azulBg})
    return out }
  const chipEl=(x,i)=><span key={i} style={{fontSize:10,fontWeight:600,color:x.c,background:x.bg,borderRadius:6,padding:'1px 6px',whiteSpace:'nowrap'}}>{x.t}</span>
  const subTxt=f=> f.n>0 ? `${f.n} gasto${f.n!==1?'s':''}${f.desde?` · desde ${fmtFechaDMY(f.desde)}`:''}` : f.armada ? `rendición ${fmt(f.armada.total||0)} armada ${fmtFechaDMY(isoLocal(f.armada.created_at))}` : f.ultEnv ? `rendido ${fmtFechaDMY(isoLocal(f.ultEnv.sent_at))}` : 'sin gastos por rendir'
  const tileSub=k=>{ const a=vivos.filter(f=>f.grp===k&&enAbg(f)); const sum=k==='pedir'||k==='dep'?a.reduce((s,f)=>s+Math.max(0,-f.s),0):a.reduce((s,f)=>s+f.m,0)
    if(k==='envd'){ const d30=isoLocal(Date.now()-30*86400000); return `${enviadas.filter(x=>enAbg(x)&&String(x.r.sent_at).slice(0,10)>=d30).length} en 30 días` }
    return k==='env'?`${a.length} por enviar`:k==='pedir'||k==='dep'?`${a.length} · falta ${fmtMill(sum)}`:`${a.length} · ${fmtMill(sum)}` }
  const exportar=async()=>{ try{ const XLSX=await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
    const head=['Cliente','Abogado','Grupo','Gastos por rendir','Desde','Por rendir','Saldo','Seguimiento']
    const gl=k=>(_RENDIR_G.find(x=>x.k===k)||{}).t||'Al día'
    const data=rows.map(f=>[f.c.name,f.abg,verTerm?'Terminado':gl(f.grp),f.n,f.desde?fmtFechaDMY(f.desde):'',Math.round(f.m),Math.round(f.s),f.pedido?`Pedido ${fmtFechaDMY(isoLocal(f.pedido.req.enviada_at))} (${f.pedido.dias} d)`:f.armada?'Armada sin enviar':''])
    const ws=XLSX.utils.aoa_to_sheet([head,...data]); ws['!cols']=[{wch:30},{wch:12},{wch:24},{wch:10},{wch:12},{wch:14},{wch:14},{wch:26}]
    for(let r=1;r<=data.length;r++){ [5,6].forEach(cc=>{ const cell=ws[XLSX.utils.encode_cell({r,c:cc})]; if(cell&&cell.t==='n') cell.z='#,##0' }) }
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Rendir a cliente'); XLSX.writeFile(wb,`Rendir_a_cliente_${isoLocal(Date.now())}.xlsx`)
  }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const sig = ult && !verTerm ? rows.find(f=>String(f.c.id)!==String(ult.id)) : null
  const ultCli = ult ? (clients||[]).find(c=>String(c.id)===String(ult.id)) : null
  const aldia=vivos.filter(f=>f.grp==='aldia').length
  const sel={fontSize:12,color:C.accent,fontWeight:600,border:`1px solid ${C.border}`,background:C.surface,borderRadius:9,padding:'6px 9px'}
  const verEnv = g==='envd'&&!verTerm, verBorr = g==='env'&&!verTerm, verLista = verEnv||verBorr
  // Abrir el correo de un borrador: si se guardó junto con otras (separadas en un correo), vuelven todas.
  const abrirCorreo = r => { const gr=r.correo?.modo==='sep1'?(r.correo.grupo||[]):[]
    // Mismo orden en que se guardó (el texto del borrador nombra N° 1, N° 2… en ese orden), se abra desde la fila que se abra.
    const grupo=gr.map(id=>id===r.id?r:(rendiciones||[]).find(x=>x.id===id&&!x.sent_at&&!x.anulada_at&&x.correo?.modo==='sep1'&&(x.correo.grupo||[]).includes(r.id))).filter(Boolean)
    onEnviarRend&&onEnviarRend(grupo.length>1?{...grupo[0],_hermanas:grupo.slice(1)}:r) }
  const envRows = verLista ? (verEnv?enviadas:borrItems).filter(x=>(abgDef==='Todos'||x.abg===abgDef)&&(!q.trim()||nrm(x.c.name).includes(nrm(q.trim())))) : []
  const segTxt = x => x.r.estado_envio==='externa' ? {t:'rendida por fuera',c:C.textSoft} : x.st ? (x.st.k==='rec' ? {t:`depósito ${fmtFechaDMY(String(x.req.recibido_at||x.st.dep?.date||'').slice(0,10))}`,c:C.greenText} : {t:`pedido · ${x.st.dias} d`,c:x.st.k==='sin'?C.overdueText:C.soonText}) : {t:'—',c:C.textSoft}
  const envTable = verEnv && (<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      {D ? (<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>{(verBorr?['Cliente','Abogado','Trabajo','Armada','Gastos','Total','Correo','']:['Cliente','Abogado','N°','Enviada','Gastos','Total','Seguimiento','']).map((h,i)=><th key={i} style={{fontSize:10.5,letterSpacing:.6,textTransform:'uppercase',color:C.accent,fontWeight:700,textAlign:i===4||i===5?'right':'left',padding:'9px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{envRows.map((x,i)=>{ const pc=personChip(x.abg); const sg=verBorr?(x.r.correo?.asunto?{t:'guardado',c:C.greenText}:{t:'sin redactar',c:C.textSoft}):segTxt(x); return (
          <tr key={x.r.id} onClick={()=>setDetR(x.r.id)} style={{borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <td style={{padding:'10px 12px'}}><span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,cursor:'pointer'}}>{x.c.name}</span></td>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span style={{fontSize:10.5,fontWeight:600,borderRadius:20,padding:'2px 9px',background:pc.bg,color:pc.color}}>{x.abg}</span></td>
            <td style={{padding:'10px 12px',fontSize:13,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{verBorr?(x.r.project||'—'):(x.r.correlativo?`N° ${x.r.correlativo}`:'—')}</td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap'}}>{fmtFechaDMY(isoLocal(verBorr?x.r.created_at:x.r.sent_at))}</td>
            <td style={{padding:'10px 12px',textAlign:'right',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{x.r.n_gastos||'—'}</td>
            <td style={{padding:'10px 12px',textAlign:'right',fontSize:13,fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(x.r.total||0)}</td>
            <td style={{padding:'10px 12px',fontSize:12.5,whiteSpace:'nowrap',color:sg.c,fontWeight:600}}>{sg.t}</td>
            <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap'}}>{verBorr
              ? <button onClick={ev=>{ev.stopPropagation();abrirCorreo(x.r)}} style={{fontSize:12,fontWeight:700,border:'none',borderRadius:9,padding:'6px 12px',cursor:'pointer',background:C.accent,color:'#fff'}}>Ver correo y enviar</button>
              : onVerRend&&<button onClick={ev=>{ev.stopPropagation();onVerRend(x.r)}} style={{fontSize:12,fontWeight:700,border:'none',borderRadius:9,padding:'6px 12px',cursor:'pointer',background:C.azulBg,color:C.accent}}>Ver PDF</button>}</td>
          </tr>)})}</tbody></table></div>)
      : envRows.map((x,i)=>{ const sg=verBorr?(x.r.correo?.asunto?{t:'correo guardado',c:C.greenText}:{t:'sin redactar',c:C.textSoft}):segTxt(x); return (
          <div key={x.r.id} onClick={()=>setDetR(x.r.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <div style={{flex:1,minWidth:0}}>
              <div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.c.name}</div>
              <div style={{fontSize:11.5,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(verBorr?[x.r.project||null,`armada ${fmtFechaDMY(isoLocal(x.r.created_at))}`,`${x.r.n_gastos||0} gastos`]:[x.r.correlativo?`N° ${x.r.correlativo}`:null,fmtFechaDMY(isoLocal(x.r.sent_at)),`${x.r.n_gastos||0} gastos`]).filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{fmt(x.r.total||0)}</div>
              <div style={{fontSize:11.5,marginTop:2,color:sg.c,fontWeight:600}}>{sg.t}</div>
            </div>
          </div>)})}
      {envRows.length===0&&<div style={{color:C.muted,textAlign:'center',padding:22,fontSize:13}}>{q||abgDef!=='Todos'?'Nada calza con el filtro.':(verBorr?'Sin borradores.':'Sin rendiciones enviadas.')}</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'9px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,color:C.textSoft}}>
        <span><b style={{color:C.text}}>{envRows.length}</b> rendici{envRows.length!==1?'ones':'ón'} · total <b style={{color:C.text}}>{fmt(envRows.reduce((a,x)=>a+(x.r.total||0),0))}</b></span>
        <span>más reciente primero</span>
      </div>
    </div>)
  // ── Borradores: revisar uno a uno (anterior/siguiente), guardarlos y enviar juntos los guardados (cada correo pasa por su página, en cola).
  const armRows = verBorr ? envRows.filter(x=>x.tipo==='arm') : []
  const selArm = armRows.filter(x=>!excl.has(x.r.id))
  const todosSel = armRows.length>0 && selArm.length===armRows.length
  const toggleTodos = () => setExcl(todosSel ? new Set(armRows.map(x=>x.r.id)) : new Set())
  // «Separadas en un correo» (sep1) salen juntas: se marcan y desmarcan como grupo.
  const grupoDe = r => r.correo?.modo==='sep1'&&(r.correo.grupo||[]).length>1 ? r.correo.grupo : [r.id]
  const toggleArm = id => setExcl(p=>{ const r=(rendiciones||[]).find(x=>x.id===id); const ids=r?grupoDe(r):[id]; const n=new Set(p); const quitar=!p.has(id); ids.forEach(i=>quitar?n.add(i):n.delete(i)); return n })
  const retomar = x => { _rendirUlt={id:x.c.id,g:'env'}; onRendir&&onRendir(x.c) }
  const abrirPrep = x => { onRendir&&onRendir(x.c, envRows.filter(y=>y.tipo==='prep').map(y=>y.c.id)) }
  const caja = (on, parcial) => <span style={{width:17,height:17,borderRadius:4,border:`1.5px solid ${on||parcial?C.accent:C.done}`,background:on?C.accent:C.surface,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on?<SIcon n='check' s={11} c='#fff'/>:parcial?<span style={{width:8,height:2,borderRadius:1,background:C.accent}}/>:null}</span>
  const cajaDe = x => <span onClick={ev=>{ev.stopPropagation(); x.tipo==='arm'?toggleArm(x.r.id):abrirPrep(x)}} style={{display:'inline-flex',padding:4,margin:-4,cursor:'pointer'}}>{caja(x.tipo==='arm'&&!excl.has(x.r.id))}</span>
  const cajaTodos = <span onClick={toggleTodos} style={{display:'inline-flex',padding:4,margin:-4,cursor:armRows.length?'pointer':'default'}}>{caja(todosSel, selArm.length>0&&!todosSel)}</span>
  const nRev = armRows.length
  const txtEnviar = () => `Enviar ${colaN} borrador${colaN!==1?'es guardados':' guardado'}`
  // Envío conjunto: cada rendición (o grupo «separadas en un correo») con su N° tentativo y lo que pide; el N° real se fija al enviar.
  const colaEnvio = (()=>{ if(!verBorr) return []; const vistos=new Set(), cuenta={}, out=[]
    selArm.forEach(x=>{ if(vistos.has(x.r.id)) return
      const gr=x.r.correo?.modo==='sep1'?(x.r.correo.grupo||[]).map(id=>id===x.r.id?x.r:(rendiciones||[]).find(y=>y.id===id&&!y.sent_at&&!y.anulada_at&&!vistos.has(y.id)&&!excl.has(y.id)&&y.correo?.modo==='sep1'&&(y.correo.grupo||[]).includes(x.r.id))).filter(Boolean):[]
      const grupo=gr.length>1?gr:[x.r]; grupo.forEach(y=>vistos.add(y.id))
      const cid=String(x.c.id); const base=corrSiguiente(rendiciones,x.c.id)+(cuenta[cid]||0); cuenta[cid]=(cuenta[cid]||0)+grupo.length
      const filasG=grupo.map((y,i)=>({r:y, corr:base+i, pide:confEnv?Math.max(0,-fondoDeRend(y,expenses,clientEntities).saldo):0}))   // el fondo se calcula solo al confirmar
      out.push({c:x.c, filas:filasG}) })
    return out })()
  const colaN = colaEnvio.reduce((a,g)=>a+g.filas.length,0)
  const llaveFondo = (cid,r) => r ? `${cid}|${r.entity_id||''}|${r.fondo_id?'f'+r.fondo_id:r.por_trabajo?(r.project||''):''}` : `${cid}`
  const sumaFalta = items => { const vis=new Map(); items.forEach(([k,v])=>{ if(!vis.has(k)) vis.set(k,Math.max(0,v)) }); return [...vis.values()].reduce((a,v)=>a+v,0) }
  const confirmarEnvio = () => { if(!colaEnvio.length||!onEnviarRend) return
    const items=colaEnvio.map(g=>{ const [p0,...rest]=g.filas; return {...p0.r, correlativo:p0.corr, _cliName:g.c.name, _hermanas:rest.map(f=>({...f.r,correlativo:f.corr}))} })
    setConfEnv(false); onEnviarRend({...items[0], _cola:items.slice(1)}) }
  const cMon = {padding:'10px 12px',textAlign:'right',fontSize:13,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}
  const thSty = (r)=>({fontSize:10.5,letterSpacing:.6,textTransform:'uppercase',color:C.accent,fontWeight:700,textAlign:r?'right':'left',padding:'9px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'})
  const borrTable = verBorr && (<>
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      {D ? (<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr><th style={{...thSty(),width:22}}>{cajaTodos}</th>{['Cliente','Abogado','Hecho por','Armada','Gastos','Por rendir','Saldo',''].map((h,i)=><th key={i} style={thSty(i>=4&&i<=6)}>{h}</th>)}</tr></thead>
        <tbody>{enCurso.map((x,i)=>{ const pc=personChip(x.abg); return (
          <tr key={'w'+x.c.id} onClick={()=>retomar(x)} style={{borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <td style={{padding:'10px 12px',width:22}}/>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,cursor:'pointer'}}>{x.c.name}</span></td>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span style={{fontSize:10.5,fontWeight:600,borderRadius:20,padding:'2px 9px',background:pc.bg,color:pc.color}}>{x.abg}</span></td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap',color:C.text}}>{currentUserName}</td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap'}}>{fmtFechaDMY(isoLocal(x.at))}</td>
            <td style={cMon}>{x.n}</td>
            <td style={{...cMon,fontWeight:700}}>{fmt(x.m)}</td>
            <td style={{...cMon,color:C.soonText,fontWeight:600}}>sin guardar</td>
            <td style={{padding:'10px 12px',textAlign:'right',color:C.textSoft}}><Gl n='chevron'/></td>
          </tr>)})}
        {envRows.map((x,i)=>{ const pc=personChip(x.abg); return (
          <tr key={x.k} onClick={()=>x.tipo==='arm'?setDetR(x.r.id):abrirPrep(x)} style={{borderTop:i||enCurso.length?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <td style={{padding:'10px 12px',width:22}}>{cajaDe(x)}</td>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,cursor:'pointer'}}>{x.c.name}</span></td>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span style={{fontSize:10.5,fontWeight:600,borderRadius:20,padding:'2px 9px',background:pc.bg,color:pc.color}}>{x.abg}</span></td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap',color:C.text}}>{x.autor}</td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap'}}>{fmtFechaDMY(x.at)}</td>
            <td style={cMon}>{x.n||'—'}</td>
            <td style={{...cMon,fontWeight:700}}>{fmt(x.m)}</td>
            <td style={cMon}>{tras(x)}</td>
            <td style={{padding:'10px 12px',textAlign:'right',color:C.textSoft}}><Gl n='chevron'/></td>
          </tr>)})}</tbody></table></div>)
      : (<>
        {enCurso.map(x=>(
          <div key={'w'+x.c.id} onClick={()=>retomar(x)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderBottom:`1px solid ${C.track}`,cursor:'pointer'}}>
            <span style={{width:17,flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.c.name}</div>
              <div style={{fontSize:11.5,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.n} gasto{x.n!==1?'s':''} · {fmtFechaDMY(isoLocal(x.at))}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{fmt(x.m)}</div>
              <div style={{fontSize:11.5,marginTop:2,color:C.soonText,fontWeight:600}}>sin guardar</div>
            </div>
            <span style={{color:C.textSoft}}><Gl n='chevron'/></span>
          </div>))}
        {envRows.length>0&&<div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',background:C.bgSoft}}>{cajaTodos}<span onClick={toggleTodos} style={{flex:1,fontSize:12,fontWeight:600,color:C.accent,cursor:'pointer'}}>Seleccionar todo</span><span style={{fontSize:11.5,color:C.textSoft}}>{nRev} de {envRows.length} guardados</span></div>}
        {envRows.map(x=>(
          <div key={x.k} onClick={()=>x.tipo==='arm'?setDetR(x.r.id):abrirPrep(x)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
            {cajaDe(x)}
            <div style={{flex:1,minWidth:0}}>
              <div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(x.c.id)}} style={{...NOMBRE_CLI,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.c.name}</div>
              <div style={{fontSize:11.5,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.n} gasto{x.n!==1?'s':''} · {x.autor}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{fmt(x.m)}</div>
              <div style={{fontSize:11.5,marginTop:2}}>{tras(x)}</div>
            </div>
            <span style={{color:C.textSoft}}><Gl n='chevron'/></span>
          </div>))}
      </>)}
      {envRows.length===0&&!enCurso.length&&<div style={{color:C.muted,textAlign:'center',padding:22,fontSize:13}}>{q||abgDef!=='Todos'?'Nada calza con el filtro.':'Sin borradores.'}</div>}
      {envRows.length>0&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'9px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,color:C.textSoft}}>
        <span><b style={{color:C.text}}>{envRows.length}</b> borrador{envRows.length!==1?'es':''} · {nRev} guardado{nRev!==1?'s':''}</span>
        <span style={{display:'flex',gap:D?22:0,fontVariantNumeric:'tabular-nums'}}>{D&&<span>{envRows.reduce((a,x)=>a+(x.n||0),0)} gastos</span>}<b style={{color:C.text}}>{fmt(envRows.reduce((a,x)=>a+x.m,0))}</b>{D&&<span>falta <b style={{color:C.text}}>{fmt(sumaFalta(envRows.map(x=>[llaveFondo(x.c.id,x.r),-x.s])))}</b></span>}</span>
      </div>}
    </div>
    {!D&&selArm.length>0&&<button onClick={()=>setConfEnv(true)} style={{width:'100%',marginTop:10,padding:'11px 14px',borderRadius:10,border:'none',background:C.normal,color:'#fff',fontSize:13.5,fontWeight:700,cursor:'pointer'}}>{txtEnviar()}</button>}
  </>)
  // Confirmación del envío conjunto: se lee la lista y los botones quedan al pie, después del total.
  const confPanel = verBorr && confEnv && (<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
    <div style={{padding:'11px 14px 7px',...SEC_LBL}}>Enviar {colaN} rendici{colaN!==1?'ones':'ón'}</div>
    {D ? (<table style={{width:'100%',borderCollapse:'collapse'}}>
      <thead><tr>{['Cliente','N°','Gastos','Por rendir','Fondos por solicitar'].map((h,i)=><th key={i} style={thSty(i>0)}>{h}</th>)}</tr></thead>
      <tbody>{colaEnvio.flatMap(gq=>gq.filas.map(f=>(<tr key={f.r.id} style={{borderTop:`1px solid ${C.track}`}}>
        <td style={{padding:'10px 12px'}}><span style={{...NOMBRE_CLI}}>{gq.c.name}</span>{f.r.project&&gq.filas.length>1&&<span style={{fontSize:11.5,color:C.textSoft}}> · {f.r.project}</span>}</td>
        <td style={cMon}>{f.corr}</td><td style={cMon}>{f.r.n_gastos||0}</td><td style={{...cMon,fontWeight:700}}>{fmt(f.r.total||0)}</td>
        <td style={{...cMon,color:f.pide>0?C.text:C.textSoft}}>{f.pide>0?fmt(f.pide):'—'}</td></tr>)))}</tbody>
      <tfoot><tr style={{background:C.bgSoft,borderTop:`1px solid ${C.border}`}}><td style={{padding:'9px 12px',fontSize:12.5,fontWeight:700,whiteSpace:'nowrap'}}>{colaN} rendici{colaN!==1?'ones':'ón'}{colaEnvio.length!==colaN?` · ${colaEnvio.length} correo${colaEnvio.length!==1?'s':''}`:''}</td><td/>
        <td style={{...cMon,fontWeight:700}}>{colaEnvio.reduce((a,gq)=>a+gq.filas.reduce((b,f)=>b+(f.r.n_gastos||0),0),0)}</td>
        <td style={{...cMon,fontWeight:700}}>{fmt(colaEnvio.reduce((a,gq)=>a+gq.filas.reduce((b,f)=>b+(Number(f.r.total)||0),0),0))}</td>
        <td style={{...cMon,fontWeight:700,color:C.text}}>{(()=>{ const t=sumaFalta(colaEnvio.flatMap(gq=>gq.filas.map(f=>[llaveFondo(gq.c.id,f.r),f.pide]))); return t>0?fmt(t):'—' })()}</td></tr></tfoot>
    </table>) : colaEnvio.flatMap(gq=>gq.filas.map(f=>(<div key={f.r.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderTop:`1px solid ${C.track}`}}>
        <div style={{flex:1,minWidth:0}}><div style={{...NOMBRE_CLI,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{gq.c.name}</div><div style={{fontSize:11.5,color:C.textSoft}}>N° {f.corr} · {f.r.n_gastos||0} gastos</div></div>
        <div style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}><div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{fmt(f.r.total||0)}</div><div style={{fontSize:11.5,color:C.textSoft}}>{f.pide>0?<>solicita <b style={{color:C.text,fontWeight:600}}>{fmt(f.pide)}</b></>:'sin solicitud'}</div></div></div>)))}
    <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:10,padding:'10px 14px',borderTop:`1px solid ${C.border}`,flexDirection:D?'row':'column-reverse'}}>
      <button onClick={()=>setConfEnv(false)} style={{border:'none',background:'none',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',padding:'7px 12px'}}>Volver a borradores</button>
      <button onClick={confirmarEnvio} style={{border:'none',borderRadius:10,background:C.normal,color:'#fff',fontSize:13.5,fontWeight:700,cursor:'pointer',padding:'9px 18px',width:D?'auto':'100%'}}>Confirmar envío</button>
    </div>
  </div>)
  const pillBtn=(a)=>{ const pc=a==='Todos'||a==='Sin abogado'?{bg:C.bgSoft,color:C.accent}:personChip(a); const n=verLista?(verEnv?enviadas:borrItems).filter(x=>a==='Todos'||x.abg===a).length:(verTerm?term:base).filter(f=>a==='Todos'||f.abg===a).length
    return <button key={a} onClick={()=>setAbg(a)} style={pillPersonaSty(pc,abgDef===a)}>{a} {n}</button> }
  if(detR){ const r=(rendiciones||[]).find(x=>x.id===detR)||null
    if(r){ const c=(clients||[]).find(x=>String(x.id)===String(r.client_id)); const gs=(expenses||[]).filter(e=>e.client_render_id===r.id&&!e.deleted_at).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')))
      const sumG=gs.reduce((a,e)=>a+(Number(e.amount)||0),0)
      const desde=String(r.sent_at||r.created_at||'').slice(0,10)
      const req=(reqs||[]).filter(q=>String(q.client_id)===String(r.client_id)&&String(q.enviada_at||'').slice(0,10)>=desde).sort((a,b)=>String(a.enviada_at).localeCompare(String(b.enviada_at)))[0]||null
      const st=req?estadoSolicitud(req,expenses):null
      const est=r.estado_envio==='externa'?{t:'Rendida por fuera de la app',c:C.textSoft,bg:C.bgSoft}:r.sent_at?{t:'Enviada',c:C.greenText,bg:C.greenBg}:{t:'Borrador',c:C.soonText,bg:C.soonBg}
      const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}
      const paso=(ok,t,sub,extra)=>(<div style={{display:'flex',gap:10,alignItems:'flex-start',padding:'7px 0'}}>
        <span style={{width:10,height:10,borderRadius:'50%',marginTop:5,flexShrink:0,background:ok?C.greenText:C.surface,border:`1.5px solid ${ok?C.greenText:C.done}`}}/>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:ok?C.text:C.muted}}>{t}</div>{sub&&<div style={{fontSize:12,color:C.textSoft}}>{sub}</div>}</div>{extra}</div>)
      return (<div>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
          <button onClick={()=>setDetR(null)} style={{display:'inline-flex',alignItems:'center',gap:4,border:'none',background:'none',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer',padding:0}}><Gl n='chevL'/> Volver</button>
          <span onClick={()=>c&&onOpenClientFicha&&onOpenClientFicha(c.id)} style={{...NOMBRE_CLI,fontSize:16,cursor:'pointer'}}>{c?.name||'Cliente'}</span>
          <span style={{fontSize:13,color:C.muted}}>{r.correlativo?`Rendición N° ${r.correlativo}`:'Rendición sin número'}</span>
          <span style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'2px 9px',color:est.c,background:est.bg}}>{est.t}</span>
          <span style={{marginLeft:'auto',display:'flex',gap:8,flexWrap:'wrap'}}>
            {!r.sent_at&&!r.anulada_at&&onEliminarBorr&&<button onClick={async()=>{ if(await onEliminarBorr(r)) setDetR(null) }} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:9,padding:'6px 12px',cursor:'pointer',background:C.surface,color:C.overdue}}>Eliminar borrador</button>}
            {!r.sent_at&&!r.anulada_at&&onEditarRend&&<button onClick={()=>onEditarRend(r)} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:9,padding:'6px 12px',cursor:'pointer',background:C.surface,color:C.accent}}>Editar</button>}
            {onVerRend&&<button onClick={()=>onVerRend(r)} style={{fontSize:12,fontWeight:700,border:`1px solid ${C.border}`,borderRadius:9,padding:'6px 12px',cursor:'pointer',background:C.surface,color:C.accent}}>Ver PDF</button>}
            {onEnviarRend&&r.estado_envio!=='externa'&&<button onClick={()=>abrirCorreo(r)} style={{fontSize:12,fontWeight:700,border:'none',borderRadius:9,padding:'6px 12px',cursor:'pointer',background:r.sent_at?C.azulBg:C.accent,color:r.sent_at?C.accent:'#fff'}}>{r.sent_at?'Ver correo · reenviar':'Ver correo y enviar'}</button>}
          </span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:D?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8,marginBottom:12}}>
          {[['Rendido',fmt(r.total||0),`${r.n_gastos||gs.length} gastos`],['Pedido',req?fmt(req.monto||0):'—',req?(st?.k==='rec'?'depósito recibido':`sin depósito · ${st?.dias||0} d`):'no se pidieron fondos'],['Período',r.periodo||'—',r.project?(r.subproject?`${r.project} · ${r.subproject}`:r.project):'sin proyecto']].map(([l,v,sub])=>(
            <div key={l} style={{...card,padding:'10px 12px',minWidth:0,...(!D&&l==='Período'?{gridColumn:'1 / -1'}:{})}}><div style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}}>{l}</div><div style={{fontSize:D?18:14,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontVariantNumeric:'tabular-nums'}}>{v}</div><div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:D?'minmax(0,1fr) minmax(0,1.6fr)':'minmax(0,1fr)',gap:12,alignItems:'start'}}>
          <div style={{...card,padding:'10px 14px'}}>
            <div style={{...SEC_LBL,marginBottom:4}}>Seguimiento</div>
            {paso(true,'Armada',`${fmtFechaDMY(isoLocal(r.created_at))}${r.user_name?` · ${r.user_name}`:''}`)}
            {paso(!!r.sent_at,r.estado_envio==='externa'?'Rendida por fuera':'Enviada al cliente',r.sent_at?[fmtFechaDMY(isoLocal(r.sent_at)),r.dirigido_email||r.dirigido_a].filter(Boolean).join(' · '):'pendiente',r.comprobante_url?<a href={r.comprobante_url} target='_blank' rel='noreferrer' style={{fontSize:11.5,color:C.azulInfo}}>Correo</a>:null)}
            {paso(!!req,'Fondos pedidos',req?`${fmtFechaDMY(isoLocal(req.enviada_at))} · ${fmt(req.monto||0)}`:'no se pidieron fondos en esta rendición')}
            {req&&paso(st?.k==='rec','Depósito del cliente',st?.k==='rec'?fmtFechaDMY(String(req.recibido_at||st?.dep?.date||'').slice(0,10)):`esperando · ${st?.dias||0} d`,req.movimiento_id&&onOpenMovBanco?<span onClick={()=>onOpenMovBanco(req.movimiento_id)} style={{fontSize:11.5,color:C.azulInfo,cursor:'pointer'}}>Banco</span>:null)}
            {r.ot_numbers&&<div style={{fontSize:11.5,color:C.textSoft,marginTop:6,borderTop:`1px solid ${C.track}`,paddingTop:6}}>OT incluidas: {r.ot_numbers}</div>}
            {r.correo?.asunto&&<details style={{marginTop:6,borderTop:`1px solid ${C.track}`,paddingTop:6}}><summary style={{fontSize:12,fontWeight:600,color:C.accent,cursor:'pointer'}}>{r.correo.enviado_at?'Correo enviado':'Borrador del correo'} · {fmtFechaDMY(isoLocal(r.correo.enviado_at||r.correo.guardado_at))}</summary>
              <div style={{fontSize:11.5,color:C.textSoft,marginTop:4}}>Para: {r.correo.para||'—'}{(r.correo.cc||[]).length?` · CC: ${r.correo.cc.join(', ')}`:''}</div>
              <div style={{fontSize:12,fontWeight:600,color:C.text,marginTop:4}}>{r.correo.asunto}</div>
              <div style={{fontSize:12,color:C.text,whiteSpace:'pre-wrap',marginTop:4,lineHeight:1.5}}>{r.correo.cuerpo}</div></details>}
          </div>
          <div style={{...card,overflow:'hidden'}}>
            <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}><span style={{...SEC_LBL}}>Gastos rendidos · {gs.length}</span>{Math.round(sumG)!==Math.round(r.total||0)&&<span style={{fontSize:11,color:C.soonText,fontWeight:600}}>suman {fmt(sumG)}</span>}</div>
            {gs.map((e,i)=>(<div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderTop:i?`1px solid ${C.track}`:'none'}}>
              {diaGrande(e.date)}
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'}</div>
                <div style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[RENDCAT(e.category),e.ot_number?(String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number):null,e.project].filter(Boolean).join(' · ')}</div></div>
              <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(e.amount)}</span></div>))}
            {!gs.length&&<div style={{padding:18,textAlign:'center',fontSize:12.5,color:C.muted}}>Sin gastos asociados (usa «Ver PDF» para el detalle guardado).</div>}
            <div style={{display:'flex',justifyContent:'space-between',padding:'9px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12.5}}><span style={{color:C.textSoft}}>Total</span><b style={{color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(r.total||0)}</b></div>
          </div>
        </div>
      </div>) } }
  return (<div>
    {!verTerm&&(()=>{ // Ciclo de la rendición (sin título): cada paso se toca y filtra. «Por rendir» se abre en sus 3 tarjetas.
      const enRendir=['pedir','favor','cero'].includes(g)
      // El ciclo sigue al abogado elegido (abre en el que entra): mismas cifras que su lista.
      const enA=enAbg, vA=vivos.filter(enA)
      const nOf=k=>vA.filter(f=>f.grp===k).length
      const falta=vA.filter(f=>['pedir','favor','cero'].includes(f.grp)).reduce((a,f)=>a+Math.max(0,-f.s),0), afavor=vA.filter(f=>['pedir','favor','cero'].includes(f.grp)).reduce((a,f)=>a+Math.max(0,f.s),0)
      const faltaDep=vA.filter(f=>f.grp==='dep').reduce((a,f)=>a+Math.max(0,-f.s),0)
      const pasos=[
        {k:'rendir', t:'Por rendir', tm:'Por rendir', ic:'clock', col:C.accent, v:`${nOf('pedir')+nOf('favor')+nOf('cero')}${D?' clientes':''}`, sub:`falta ${fmtMill(falta)} · a favor ${fmtMill(afavor)}`},
        {k:'env', t:'Borradores', tm:'Borrador', ic:'file', col:C.soonText, v:`${borrItems.filter(enA).length}`, sub:enCurso.length?`guardados · ${enCurso.length} sin guardar`:'guardados'},
        {k:'dep', t:'Esperando depósito', tm:'Espera', ic:'tEspera', col:C.azulInfo, v:D?`${nOf('dep')} · ${fmtMill(faltaDep)}`:`${nOf('dep')}`, sub:'rendido y en contra'},
        {k:'envd', t:'Enviadas', tm:'Enviada', ic:'check', col:C.greenText, v:`${enviadas.filter(enA).length}`, sub:'historial de envíos'},
      ]
      const on=k=>k==='rendir'?enRendir:g===k
      return (<>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:D?'12px 14px':'10px 8px',marginBottom:10,display:'flex',alignItems:'stretch'}}>
        {pasos.map((p,i)=>(<Fragment key={p.k}>{i>0&&<div style={{display:'flex',alignItems:'center',color:'#C7D2D7',fontSize:15,padding:'0 2px'}}>→</div>}
          <div onClick={()=>setG(p.k==='rendir'?(enRendir?g:'pedir'):p.k)} style={{flex:1,minWidth:0,textAlign:'center',cursor:'pointer',borderRadius:10,padding:D?'6px 4px':'5px 2px',background:on(p.k)?C.azulBg:'transparent'}}>
            {D&&<SIcon n={p.ic} s={19} c={p.col}/>}
            <div style={{fontSize:D?9.5:9,fontWeight:700,letterSpacing:.3,textTransform:'uppercase',color:p.col,marginTop:D?4:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{D?p.t:p.tm}</div>
            <div style={{fontSize:D?16:15,fontWeight:800,color:p.col,marginTop:1,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{p.v}</div>
            {D&&<div style={{fontSize:10.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.sub}</div>}
          </div></Fragment>))}
      </div>
      {enRendir&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:D?10:6,marginBottom:12}}>
        {_RENDIR_G.filter(x=>['pedir','favor','cero'].includes(x.k)).map(x=>{ const sel=g===x.k; return (
          <div key={x.k} onClick={()=>setG(x.k)} style={{minWidth:0,cursor:'pointer',background:C.surface,border:`1px solid ${sel?C.accent:C.border}`,boxShadow:sel?`0 0 0 1px ${C.accent}`:'none',borderRadius:12,padding:D?'10px 11px':'9px 7px',display:'flex',alignItems:'center',gap:D?9:6}}>
            <span style={{width:D?30:24,height:D?30:24,borderRadius:D?9:7,background:x.bg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={x.ic} s={D?15:13} c={x.col}/></span>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:sel?C.accent:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{!D&&x.k==='pedir'?'Rendir':x.t}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontVariantNumeric:'tabular-nums'}}>{D?tileSub(x.k):tileSub(x.k).replace('falta ','')}</div>
            </div>
          </div>)})}
      </div>}
      </>) })()}
    {term.length>0&&<div onClick={()=>setVerTerm(v=>!v)} style={{display:'flex',alignItems:'center',gap:9,background:verTerm?C.azulBg:C.soonBg,color:verTerm?C.accent:C.soonText,borderRadius:10,padding:'9px 12px',marginBottom:12,fontSize:12.5,cursor:'pointer'}}>
      <SIcon n={verTerm?'chevron':'alert'} s={15} c={verTerm?C.accent:C.soonText}/>
      <span style={{flex:1,minWidth:0}}>{verTerm?'Volver a los clientes activos':<><b>{term.length} cliente{term.length!==1?'s':''} terminado{term.length!==1?'s':''}</b> con gastos o saldo pendiente</>}</span>
      {!verTerm&&<b style={{whiteSpace:'nowrap'}}>Revisar →</b>}
    </div>}
    {sig&&ultCli&&!verLista&&<div style={{display:'flex',alignItems:'center',gap:9,background:C.greenBg,borderRadius:10,padding:'8px 12px',marginBottom:10,fontSize:12.5,color:C.greenText}}>
      <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Siguiente: <b>{sig.c.name}</b></span>
      <button onClick={()=>accion(sig)} style={{fontSize:12,fontWeight:700,border:'none',borderRadius:8,padding:'5px 11px',background:C.accent,color:'#fff',cursor:'pointer',whiteSpace:'nowrap'}}>{D?`${btnTxt(sig)} →`:'Ir →'}</button>
      <button onClick={()=>{_rendirUlt=null;setUlt(null)}} aria-label='Cerrar' style={{display:'inline-flex',background:'none',border:'none',padding:2,cursor:'pointer'}}><SIcon n='x' s={14} c={C.textSoft}/></button>
    </div>}
    {confPanel || <><div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:10}}>
      <div style={{flex:D?'1 1 220px':'1 1 100%',display:'flex',alignItems:'center',gap:8,background:'#F1F4F6',border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 11px',minWidth:0}}>
        <SIcon n='search' s={15} c={C.muted}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente…' style={{border:'none',background:'none',outline:'none',fontSize:13,color:C.text,width:'100%'}}/></div>
      <div style={{display:'flex',gap:6,flexWrap:D?'wrap':'nowrap',overflowX:D?'visible':'auto',minWidth:0,flex:D?'0 1 auto':'1 1 auto'}}>{abgs.map(pillBtn)}</div>
      {verBorr&&autores.length>0&&<select value={autorDef} onChange={e=>setAutor(e.target.value)} style={sel}><option value='Todos'>Hechos por todos</option>{autores.map(a=><option key={a} value={a}>{a===currentUserName?'Hechos por mí':`Hechos por ${a}`}</option>)}</select>}
      {!verLista&&<select value={ord} onChange={e=>setOrd(e.target.value)} style={sel}><option value='ant'>Más antiguo primero</option><option value='rec'>Más reciente primero</option><option value='monto'>Mayor monto</option><option value='az'>A–Z</option></select>}
      {D&&!verLista&&<button onClick={exportar} style={{...sel,display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer'}}><SIcon n='download' s={14} c={C.accent}/>Excel</button>}
      {D&&verBorr&&selArm.length>0&&<button onClick={()=>setConfEnv(true)} style={{fontSize:13,fontWeight:700,border:'none',borderRadius:10,padding:'8px 16px',cursor:'pointer',background:C.normal,color:'#fff',whiteSpace:'nowrap',marginLeft:'auto'}}>{txtEnviar()}</button>}
    </div>
    {verBorr ? borrTable : verLista ? envTable : <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      {D ? (<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
        <thead><tr>{['Cliente','Abogado','Gastos','Desde','Por rendir','Saldo',''].map((h,i)=><th key={i} style={{fontSize:10.5,letterSpacing:.6,textTransform:'uppercase',color:C.accent,fontWeight:700,textAlign:i>=4?'right':(i===2?'right':'left'),padding:'9px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((f,i)=>{ const pc=personChip(f.abg); const ch=chips(f); return (
          <tr key={f.c.id} onClick={()=>f.armada&&setDetR(f.armada.id)} style={{borderTop:i?`1px solid ${C.track}`:'none',cursor:f.armada?'pointer':'default'}}>
            <td style={{padding:'10px 12px',minWidth:0}}><span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(f.c.id)}} style={{...NOMBRE_CLI,cursor:'pointer'}}>{f.c.name}</span>{ch.length>0&&<span style={{display:'inline-flex',gap:5,marginLeft:8,verticalAlign:1,flexWrap:'wrap'}}>{ch.map(chipEl)}</span>}</td>
            <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span style={{fontSize:10.5,fontWeight:600,borderRadius:20,padding:'2px 9px',background:pc.bg,color:pc.color}}>{f.abg}</span></td>
            <td style={{padding:'10px 12px',textAlign:'right',fontSize:13,fontVariantNumeric:'tabular-nums'}}>{f.n||'—'}</td>
            <td style={{padding:'10px 12px',fontSize:13,whiteSpace:'nowrap',color:C.text}}>{f.n?(f.desde?fmtFechaDMY(f.desde):'sin fecha'):(f.ultEnv?<span style={{color:C.textSoft}}>rendido {fmtFechaDMY(isoLocal(f.ultEnv.sent_at))}</span>:'—')}</td>
            <td style={{padding:'10px 12px',textAlign:'right',fontSize:13,fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{f.n?fmt(f.m):(f.armada?fmt(f.armada.total||0):'—')}</td>
            <td style={{padding:'10px 12px',textAlign:'right',fontSize:13,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{tras(f)}</td>
            <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
              {f.armada&&onVerRend&&<span onClick={ev=>{ev.stopPropagation();onVerRend(f.armada)}} style={{fontSize:11.5,fontWeight:600,color:C.azulInfo,marginRight:10,cursor:'pointer'}}>Ver PDF</span>}
              {f.pedido?.req?.movimiento_id&&onOpenMovBanco&&<span onClick={ev=>{ev.stopPropagation();onOpenMovBanco(f.pedido.req.movimiento_id)}} style={{fontSize:11,color:C.azulInfo,marginRight:8,cursor:'pointer'}}>Banco</span>}
              <button onClick={ev=>{ev.stopPropagation();accion(f)}} style={{fontSize:12,fontWeight:700,border:'none',borderRadius:9,padding:'6px 12px',cursor:'pointer',background:(f.n>0&&f.s<=-1000)||(!f.n&&!f.armada&&!f.pedido)?C.accent:C.azulBg,color:(f.n>0&&f.s<=-1000)||(!f.n&&!f.armada&&!f.pedido)?'#fff':C.accent}}>{btnTxt(f)}</button></td>
          </tr>)})}</tbody></table></div>)
      : rows.map((f,i)=>{ const ch=chips(f); return (
          <div key={f.c.id} onClick={()=>f.armada?setDetR(f.armada.id):accion(f)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
            <div style={{flex:1,minWidth:0}}>
              <div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(f.c.id)}} style={{...NOMBRE_CLI,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.c.name}</div>
              <div style={{fontSize:11.5,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subTxt(f)}</div>
              {ch.length>0&&<div style={{display:'flex',gap:5,marginTop:4,flexWrap:'wrap'}}>{ch.map(chipEl)}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0,fontVariantNumeric:'tabular-nums'}}>
              <div style={{fontSize:13.5,fontWeight:700,color:C.text}}>{f.n?fmt(f.m):(f.armada?fmt(f.armada.total||0):'—')}</div>
              <div style={{fontSize:11.5,marginTop:2}}>{tras(f)}</div>
            </div>
            <span style={{color:C.textSoft}}><Gl n='chevron'/></span>
          </div>)})}
      {rows.length===0&&<div style={{color:C.muted,textAlign:'center',padding:22,fontSize:13}}>{q||abgDef!=='Todos'?'Nada calza con el filtro.':'Nada en este grupo.'}</div>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'9px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,color:C.textSoft}}>
        <span><b style={{color:C.text}}>{rows.length}</b> cliente{rows.length!==1?'s':''} · por rendir <b style={{color:C.text}}>{fmt(rows.reduce((a,f)=>a+f.m,0))}</b></span>
        <span>{verTerm?'Terminados':`${aldia} al día, ocultos`}</span>
      </div>
    </div>}</>}
  </div>)
}

export function ExpensesView({onEntregarCaja,onIrCajaChica,onRevisionCajaChica,onOpenMovBanco,expenses,clients,clientEntities,sales=[],onAdd,onEdit,onAddFondo,onBulk,onAssignRS,onAssignClientToExpense,onMoverAOficina,setExpenses,setRendiciones,rendiciones,currentUserName,currentUser,isAdmin,expenseAttachments,setExpenseAttachments,onRendicionComplete,billing,setBilling,pettyCash=[],onAssignCajaChica,onAssignGastoRS,onToggleClientStatus,onCreateOccasional,onSaveClientFields,onOpenClientFicha,expenseAudit=[],openOfi,onOfiOpened,openGastosOfi,onGastosOfiOpened,costosOfiMes=0,onOpenCostosOfi,onIrConciliacion,bulkImports=[],onUndoImport,navTo,onNavDone,onSolicitarFondos}) {
  const { handleEliminarBorrador, histSinEnv, setHistSinEnv, marcarConsulta, catMenu, setCatMenu, ofiLente, setOfiLente, ofiMesOpen, setOfiMesOpen, selectedClient, setSelectedClient, notaMenuOpen, setNotaMenuOpen, verArchivadosG, setVerArchivadosG, classifyFor, setClassifyFor, rsPickFor, setRsPickFor, movExp, setMovExp, rendOpen, setRendOpen, gastoOrd, setGastoOrd, gastoCatF, setGastoCatF, gastoPagF, setGastoPagF, gastoRsF, setGastoRsF, saldoTras, pagadoPorGasto, notaLiqOpen, setNotaLiqOpen, notaLiqAdd, setNotaLiqAdd, addSel, setAddSel, addSearch, setAddSearch, addOpenCli, setAddOpenCli, liqDetail, setLiqDetail, cajaPersons, showOrphans, setShowOrphans, orfSug, orfBusy, orfRan, orfAuto, orfAutoOpen, setOrfAutoOpen, orfQ, setOrfQ, orfPickFor, setOrfPickFor, aplicarOrf, deshacerOrf, runOrfAsistente, q, setQ, saldoFilter, setSaldoFilter, showPersonales, setShowPersonales, respFilter, setRespFilter, triageOpen, setTriageOpen, subMenu, setSubMenu, respPickG, setRespPickG, asignarRespG, attachExpense, setAttachExpense, rendEntityIds, setRendEntityIds, selRS, setSelRS, openRS, setOpenRS, rendicionClient, setRendicionClient, rendEdit, setRendEdit, showHistorial, setShowHistorial, histTab, setHistTab, histOrden, setHistOrden, emailRend, setEmailRend, devEmailRend, setDevEmailRend, hQ, setHQ, hMes, setHMes, hAnio, setHAnio, showHistorialFicha, setShowHistorialFicha, hFichaDesde, setHFichaDesde, hFichaHasta, setHFichaHasta, handleAnularRendicion, anularGastoRendido, marcarNotariaPagado, estadoFor, setEstadoFor, marcarEstado, clasifBulk, asignandoRS, setAsignandoRS, expandRend, setExpandRend, balances, clientsWithMovs, archivadosG, filteredClients, filtered, gastoCats, gastoToolbar, orphans, clientById, revGroup, revNoActivo, revOcasional, revOpen, setRevOpen, showRevision, setShowRevision, showReasignar, setShowReasignar, reasignFrom, setReasignFrom, revSel, setRevSel, toggleSel, revDupConfirm, setRevDupConfirm, showHist, setShowHist, showDescuadres, setShowDescuadres, descOpen, setDescOpen, doMove, revMoverA, revPick, setRevPick, revN, showNotaria, setShowNotaria, showClasificar, setShowClasificar, showGastosOficina, setShowGastosOficina, showBuscarClientes, setShowBuscarClientes, showRendiciones, setShowRendiciones, rendSub, setRendSub, revSub, setRevSub, selClasif, setSelClasif, clasifSearch, setClasifSearch, clasifOpen, setClasifOpen, movMode, setMovMode, movSel, setMovSel, selNota, setSelNota, excepNota, setExcepNota, notaSending, setNotaSending, reenviando, setReenviando, notaConfirm, setNotaConfirm, NOTARIA_DEFAULT, cleanNotaDest, notaEmail, setNotaEmail, notaSend, setNotaSend, compFile, setCompFile, notaTab, setNotaTab, docSub, setDocSub, notaMsg, setNotaMsg, notaSubject, setNotaSubject, notaBolRS, setNotaBolRS, notaBolRUT, setNotaBolRUT, notaBolPick, setNotaBolPick, abrirEnvioNotaria, aplicarBoletas, notaResp, setNotaResp, notariaPend, notariaAnulados, notaAnulOpen, setNotaAnulOpen, eliminarGastoNota, notaSel, notaTotal, dispCliente, dispPersona, coberturaPersona, notaPendTotal, notaLiquidaciones, toggleNota, notaFondos, setNotaFondos, notaPersonaPick, setNotaPersonaPick, PERSONAS_NOTA, notaGroups, marcarPersonal, esOficina, gastosPorRendir, rendirPend, ultRep, setUltRep, repetirCostosFijos, deshacerRepetir, catsOficina, setCatOficina, setSubcatOficina, triagePersonal, notaRow, notaSinFondosSel, periodoNota, liquidarNotaria, marcarPagadoNotaria, notaEstado, notaPagada, enviarNotaria, reenviarNotaria, deshacerNotaria, fmtOt, descargarExcelNota, anadirGastosNota, CATS, clientBalance, saldo, selEnts, rb, multiRS, cFondos, cSaldo, KpiRect, KpiRow, AdjuntoIcon, renderMov, HH, estadoBadge, rsOfRend, verPdfRend, renderRendRow, renderHistorialTable, exportHist, selStyle, fichaHistorial, esRendido, addPicker, rendidosBlock, gastosClasificar, isDesktop, notaOrigen, setNotaOrigen } = useExpensesModel({ expenses, clients, clientEntities, sales, onAdd, onEdit, onAddFondo, onBulk, onAssignRS, onAssignClientToExpense, onMoverAOficina, setExpenses, setRendiciones, rendiciones, currentUserName, currentUser, isAdmin, expenseAttachments, setExpenseAttachments, onRendicionComplete, billing, setBilling, pettyCash, onAssignCajaChica, onAssignGastoRS, onToggleClientStatus, onCreateOccasional, onSaveClientFields, onOpenClientFicha, expenseAudit, openOfi, onOfiOpened, openGastosOfi, onGastosOfiOpened, costosOfiMes, onOpenCostosOfi, bulkImports })
  const [orfPersona,setOrfPersona] = useState(null)   // gasto sin cliente → selector "Personal de" abierto (id)
  const [rendNav,setRendNav] = useState(null)   // borradores preparados en revisión: {ids, i} (orden de la lista de Rendir a cliente)
  const [rendAbg,setRendAbg] = useState(null)   // abogado con que abre Rendir a cliente (el de la tarjeta que se tocó)
  const _rendCliRef = useRef(null)   // cliente abierto ahora: si se salió mientras se guardaba, no se reabre el siguiente
  // Borradores del abogado que entra (misma fuente que Rendir a cliente): «N borradores por revisar» / «N por enviar» en las tarjetas.
  const misBorr = useMemo(()=>conteoBorradores({clients, expenses, rendiciones, sales, persona:currentUserName}),[clients,expenses,rendiciones,sales,currentUserName])
  const txtBorr = misBorr.arm>0 ? `${misBorr.arm} borrador${misBorr.arm!==1?'es':''} por enviar` : null
  const [showMov,setShowMov] = useState(false)   // Revisar › Movilización
  const [rendDetIni,setRendDetIni] = useState(null)   // al editar un borrador desde su detalle, al volver se reabre ese detalle
  const [rendGrupo,setRendGrupo] = useState(null)   // Rendiciones › Rendir a cliente: grupo con que abre (tarjeta «Esperando depósito» → 'dep')
  const [sinDetTodos,setSinDetTodos] = useState(false)   // Revisar › Sin detalle: ver todos
  // Revisar › Fondos por registrar: depósitos con señal de fondo que el agente propone (agente_bandeja tipo fondo_por_registrar).
  const [fondosReg,setFondosReg] = useState([]), [fondoAb,setFondoAb] = useState(null), [fondoProy,setFondoProy] = useState({}), [fondoBusy,setFondoBusy] = useState(null)
  useEffect(()=>{ let on=true
    if(DEMO){ setFondosReg(_DEMO_BANDEJA.filter(r=>r.tipo==='fondo_por_registrar'&&r.estado==='pendiente')); return }
    supabase.from('agente_bandeja').select('id,gmail_id,recibido_at,de,de_nombre,cliente_id,estado,motivo,propuesta,evidencia').eq('tipo','fondo_por_registrar').eq('estado','pendiente').order('recibido_at',{ascending:false}).limit(100)
      .then(({data})=>{ if(on) setFondosReg(data||[]) },()=>{})
    return ()=>{ on=false } },[])
  const proyectosDe = cid => { const tit=(sales||[]).filter(x=>String(x.client_id)===String(cid)&&VENTA_REAL(x)).map(x=>x.title).filter(Boolean); const k=new Set(tit.map(t=>t.trim().toLowerCase()))
    const ex=[...new Set((expenses||[]).filter(e=>!e.deleted_at&&String(e.client_id)===String(cid)&&e.project&&!k.has(String(e.project).trim().toLowerCase())).map(e=>String(e.project).trim()))]
    return [...new Set(tit), ...ex] }
  const resolverFondo = async(r, registrar) => { setFondoBusy(r.id)
    try{ const yo=currentUserName||'Oficina'
      if(registrar){ const proy=(fondoProy[r.id]!==undefined?fondoProy[r.id]:r.propuesta?.proyecto)||null
        await registrarFondoPropuesto(r,{proyecto:proy,yo,sales,expenses,onFondo:d=>setExpenses&&setExpenses(p=>[d,...(p||[])])}) }
      else{ const c={estado:'descartado',motivo:`No corresponde · ${yo}`,resuelto_por:yo,resuelto_at:new Date().toISOString()}
        if(!DEMO){ const {error}=await supabase.from('agente_bandeja').update(c).eq('id',r.id); if(error) throw error }
        logActividad('fondos.propuesta_descartada',{tabla:'agente_bandeja',id:r.id,detalle:{title:`Fondo por registrar descartado: ${fmt(r.propuesta?.monto)} del ${fmtFechaDMY(r.propuesta?.fecha)}`}}) }
      setFondosReg(p=>p.filter(x=>x.id!==r.id)); setFondoAb(null)
    }catch(e){ appAlert('No se pudo completar: '+(e.message||e)) }
    setFondoBusy(null) }
  // Hub de Gastos: cara de entrada (hero Por cobrar/A favor + 6 tarjetas). Al tocar una tarjeta se navega a la vista existente. Presentación pura — no toca cifras.
  const [hubOpen,setHubOpen] = useState(()=>{ const vm=viewMemLeer('gastos'); return vm ? vm.hubOpen : !(gastosVolverLeer()||rendAbiertaLeer()) })
  // Revisión de gastos cargados a la oficina por el equipo: quién revisa sale de miembros.revisa_gastos (configurable por estudio).
  const [showRevOfi,setShowRevOfi] = useState(false)
  const [showRevisar,setShowRevisar] = useState(()=>!!viewMemLeer('gastos')?.showRevisar)   // página Revisar: Caja chica + Gastos (revisión del equipo)
  const [revCaja,setRevCaja] = useState(false)   // Revisar › Caja chica: cajas del equipo
  const [castSocio,setCastSocio] = useState(null)   // Incobrables › cuenta de castigos: socio elegido (null = todos)
  const [cuentaP,setCuentaP] = useState(null)   // cuenta personal de un miembro abierta (Gastos › Equipo)   // hub de Gastos: avisos (caja chica / revisión) plegados por defecto
  const [miembrosRev,setMiembrosRev] = useState({revisores:[],admins:[]})
  useEffect(()=>{ if(DEMO){ setMiembrosRev({revisores:[{email:'martin@demo',nombre:'Martín'}],admins:[{nombre:'Cristóbal'},{nombre:'Erasmo'}]}); return } let on=true; supabase.from('miembros').select('email,nombre,rol,revisa_gastos').then(({data})=>{ if(!on||!data) return; setMiembrosRev({revisores:data.filter(m=>m.revisa_gastos),admins:data.filter(m=>m.rol==='admin')}) },()=>{}); return ()=>{on=false} },[])
  const revisorNombre = miembrosRev.revisores[0]?.nombre||null
  const soyRevisor = !!currentUser?.email && miembrosRev.revisores.some(m=>String(m.email).toLowerCase()===String(currentUser.email).toLowerCase())
  const revOfiItems = useMemo(()=>{ const adm=new Set(miembrosRev.admins.map(m=>m.nombre).filter(Boolean))
    return (expenses||[]).filter(e=>e.type==='gasto'&&!e.deleted_at&&e.client_id&&e.created_by&&!/@|^audit/i.test(e.created_by)&&!adm.has(e.created_by)&&(!e.revision_estado||e.revision_estado==='nose')&&(()=>{ const c=(clients||[]).find(x=>String(x.id)===String(e.client_id)); return !!c&&(c.is_internal||/liberona\s+escala/i.test(c.name||'')) })())
  },[expenses,clients,miembrosRev])
  // Movilización: el revisor ve la del equipo (sin los admins), solo lectura en lo ajeno; el resto, solo la suya.
  const movPersona = (isAdmin||soyRevisor) ? null : currentUserName
  const movExcluir = (!isAdmin&&soyRevisor) ? miembrosRev.admins.map(m=>m.nombre).filter(Boolean) : null
  const revOfiVis = (isAdmin||soyRevisor) ? revOfiItems : revOfiItems.filter(e=>e.created_by===currentUserName)   // limited: solo lo que cargó
  useEffect(()=>{ try{ sessionStorage.removeItem(_GASTOS_VOLVER) }catch(_){} },[])
  useEffect(()=>{ if(openGastosOfi){ setSelectedClient(null); setHubOpen(false); setShowGastosOficina(true); onGastosOfiOpened&&onGastosOfiOpened() } },[openGastosOfi])   // gatillo desde el módulo Oficina → vista "Gastos oficina" (Varios y personales)
  const [cobrosQ,setCobrosQ] = useState('')                // buscador en Cobros (vista por OT)
  const [qMovG,setQMovG] = useState('')             // buscador dentro de los gastos del cliente abierto
  useEffect(()=>{ setQMovG('') },[selectedClient?.id])
  useEffect(()=>{ viewMemGuardar('gastos',{hubOpen,selId:selectedClient?.id||null,showBuscarClientes,showNotaria,notaTab,showRevisar,showRendiciones,rendSub}) },[hubOpen,selectedClient?.id,showBuscarClientes,showNotaria,notaTab,showRevisar,showRendiciones,rendSub])
  const [noNQ,setNoNQ] = useState('')               // "No son nuestras": buscador
  const [noNOpen,setNoNOpen] = useState(null)        // "No son nuestras": OT con su detalle desplegado
  const [noNResOpen,setNoNResOpen] = useState(false) // "No son nuestras": sección Resueltas desplegada
  const [noNSel,setNoNSel] = useState(()=>new Set())        // "No son nuestras": OT seleccionadas para consultar a la notaría
  const [noNEstado,setNoNEstado] = useState({})             // "No son nuestras": estado por OT (learnings notaria_nonuestra) → 'consultada' | 'resuelta'
  const [noNConsult,setNoNConsult] = useState({})           // fecha de última consulta por OT (para el subtítulo)
  const [noNSending,setNoNSending] = useState(false)        // envío de consulta en curso
  const [notaCliOpen,setNotaCliOpen] = useState(()=>new Set())   // Deuda: acordeones de cliente/persona expandidos (default todos plegados)
  const [pagosOrd,setPagosOrd] = useState('nuevo')               // Pagos realizados: orden por fecha 'nuevo' | 'antiguo'
  const [pagQ,setPagQ] = useState(''), [pagMes,setPagMes] = useState(''), [pagAnio,setPagAnio] = useState('')   // Pagos realizados: buscador + Mes + Año
  const [cobEst,setCobEst] = useState(''), [cobMes,setCobMes] = useState(''), [cobAnio,setCobAnio] = useState('')   // Cobros: estado + Mes + Año
  const [cobOpenM,setCobOpenM] = useState(null)   // Cobros: meses desplegados (null = solo el más reciente)
  const [showCargaPag,setShowCargaPag] = useState(false)         // Carga masiva como PÁGINA (no modal): landing con Subir + cargas recientes
  const [cargaOpen,setCargaOpen] = useState(null)                // lote expandido en la página de Carga masiva
  const [cargaGroup,setCargaGroup] = useState('cliente')         // Carga abierta: agrupar OT por 'cliente' | 'responsable' | 'estado' | 'plana'
  const [cargaQ,setCargaQ] = useState('')                        // Carga abierta: buscador de OT/cliente
  const [deudaGroup,setDeudaGroup] = useState('cliente')         // Deuda notaría: agrupar clientes por 'cliente' | 'responsable' | 'estado'
  const [deudaSort,setDeudaSort] = usePersistedState('deuda_nota_sort',{col:'monto',dir:'desc'})
  const [deudaEstF,setDeudaEstF] = useState(null)        // Deuda: filtro desde el panel (con | adel | pers)
  const [deudaBitOpen,setDeudaBitOpen] = useState(false)  // Deuda: bitácora replegada por defecto   // Deuda: orden de clientes (nombre | monto | saldo | ot), recuerda la elección
  const [notaQ,setNotaQ] = useState('')   // Deuda notaría: buscador (OT, cliente o trámite)
  const [deudaGrpOpen,setDeudaGrpOpen] = useState(()=>new Set()) // Deuda: secciones (responsable/estado) plegadas
  const [cliOrd,setCliOrd] = usePersisted('fd_gastos_cliord','saldo')   // orden de la lista de clientes: saldo | saldoAsc | az | reciente | actividad | nombre (por abogado)
  // Estado del cliente en Gastos: Vigente = saldo distinto de $0 (algo por cobrar o por devolver) · Inactivo = en $0
  // (pedido del usuario 2026-10-13, antes también contaba movimiento ≤120 días) · Incobrable = algún movimiento con incobrable_at.
  const [estadoG,setEstadoG] = usePersisted('fd_gastos_estado','vigentes')   // vigentes | inactivos | incobrables | todos
  const estadoCli = useMemo(()=>{ const inc=new Set()
    ;(expenses||[]).forEach(e=>{ if(!e.deleted_at&&e.incobrable_at) inc.add(String(e.client_id)) })
    return { inc } },[expenses])
  const saldoCliG = c=>(balances[c.id]?.fondos||0)-(balances[c.id]?.gastos||0)
  const esVigenteG = c=> Math.round(saldoCliG(c))!==0
  const pasaEstadoG = (c,est=estadoG)=> est==='todos' ? true : est==='incobrables' ? estadoCli.inc.has(String(c.id)) : est==='inactivos' ? !esVigenteG(c) : esVigenteG(c)
  // Abogado del cliente — MISMA fuente que la ficha de Clientes: abogado_responsable, y si no, el responsable de su venta más reciente.
  const respByClienteFull = useMemo(()=>{ const m={}; (clients||[]).forEach(c=>{ if(c.abogado_responsable) m[String(c.id)]=c.abogado_responsable }); [...(sales||[])].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).forEach(s=>{ if(s.responsible&&s.client_id&&!m[String(s.client_id)]) m[String(s.client_id)]=s.responsible }); return m },[clients,sales])
  // Pedir fondos: clientes que la oficina financia (saldo<0), agrupados por su abogado a cargo, para pedirle provisión.
  const [pedirOpen,setPedirOpen] = useState(false)   // modal "pedir fondos a los abogados"
  const [pedirSent,setPedirSent] = useState({})      // estado de envío por correo de abogado
  const PEDIR_EMAILS=equipoPorNombre()
  const pedirFondosGrupos = useMemo(()=>{
    const saldoDe=c=>(balances[c.id]?.fondos||0)-(balances[c.id]?.gastos||0)
    const neg=(clientsWithMovs||[]).filter(c=>c.status!=='Terminado' && !esOficina(c.id) && saldoDe(c)<0)
    const g={}
    neg.forEach(c=>{ const abg=respByClienteFull[String(c.id)]||null; const email=abg?PEDIR_EMAILS[abg]:null; const key=email||'__sin__'
      const gs=(expenses||[]).filter(e=>String(e.client_id)===String(c.id)&&e.type!=='fondo'&&!e.no_descuenta_saldo&&!e.deleted_at&&cuentaEnSaldo(e)&&e.category!=='Apertura').sort((a,b)=>new Date(b.date||b.created_at||0)-new Date(a.date||a.created_at||0))
      const o=g[key]||(g[key]={abg,email,clientes:[]}); o.clientes.push({id:c.id,name:c.name,deuda:-saldoDe(c),gastos:gs}) })
    Object.values(g).forEach(o=>{ o.clientes.sort((a,b)=>b.deuda-a.deuda); o.total=o.clientes.reduce((a,c)=>a+c.deuda,0) })
    return g
  },[clientsWithMovs,balances,respByClienteFull,expenses])
  const emailPedirFondos=(nombre,clientes)=>{
    const tot=clientes.reduce((a,c)=>a+c.deuda,0)
    const glosa=g=>(g.concept||g.description||g.glosa||g.category||'Gasto'), fecha=g=>String(g.date||g.created_at||'').slice(0,10), monto=g=>Number(g.amount||g.monto||0)
    const filas=clientes.map(c=>{
      const top=c.gastos.slice(0,5).map(g=>`<tr><td style="padding:2px 8px 2px 0;font-size:12px;color:#537281;white-space:nowrap">${fecha(g)}</td><td style="padding:2px 0;font-size:12px;color:#3D3D3D">${glosa(g)}</td><td style="padding:2px 0 2px 8px;font-size:12px;color:#3D3D3D;text-align:right;white-space:nowrap">${fmt(monto(g))}</td></tr>`).join('')
      const resto=c.gastos.length>5?`<div style="font-size:11px;color:#537281;margin-top:3px">+ ${c.gastos.length-5} gasto(s) más</div>`:''
      return `<div style="border:1px solid #E4E8EB;border-radius:9px;padding:12px 14px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:baseline"><b style="color:#003C50;font-size:14px">${c.name}</b><b style="color:#A32D2D;font-size:14px">${fmt(c.deuda)}</b></div><div style="font-size:11px;color:#537281;margin:3px 0 7px">${c.gastos.length} gasto(s) que la oficina adelantó</div><table style="width:100%;border-collapse:collapse">${top}</table>${resto}</div>`
    }).join('')
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#F5F7F9;font-family:Arial,Helvetica,sans-serif;color:#3D3D3D"><div style="max-width:560px;margin:0 auto;padding:22px 16px"><div style="background:#fff;border:1px solid #E4E8EB;border-radius:14px;overflow:hidden"><div style="background:#003C50;color:#fff;padding:16px 20px"><div style="font-size:15px;font-weight:700">${BRAND.nombre}</div><div style="font-size:11px;opacity:.85">Clientes por provisionar</div></div><div style="padding:20px"><div style="font-size:14px;font-weight:600;color:#003C50;margin-bottom:6px">Hola ${nombre},</div><div style="font-size:13px;line-height:1.55;margin-bottom:16px">La oficina adelantó gastos de estos clientes tuyos que <b>no tienen fondos suficientes</b>. Conviene <b>pedirles provisión</b>:</div>${filas}<div style="background:#003C50;color:#fff;border-radius:9px;padding:11px 14px;display:flex;justify-content:space-between;align-items:center;margin:4px 0 16px"><span style="font-size:12px;color:#85B7EB">Total por pedir</span><span style="font-size:18px;font-weight:800">${fmt(tot)}</span></div><a href="https://${BRAND.dominio}" style="display:inline-block;background:#003C50;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:11px 20px;border-radius:9px">Ver en la app</a></div></div><div style="text-align:center;font-size:10px;color:#99ABB4;margin-top:14px">${BRAND.nombre}</div></div></body></html>`
  }
  const enviarPedir1=async(email,grupo,modo)=>{
    const nombre=(grupo.abg||'').split(' ')[0]||grupo.abg||''
    setPedirSent(s=>({...s,[email]:'sending'}))
    try{ const via=await enviarComoUsuario({que:'El aviso de pedir fondos', to:email,subject:`Pedir fondos — ${grupo.clientes.length} cliente${grupo.clientes.length!==1?'s':''} (${fmt(grupo.total)})`,html:emailPedirFondos(nombre,grupo.clientes),text:`Tienes ${grupo.clientes.length} cliente(s) sin fondos por ${fmt(grupo.total)}. Pídeles provisión.`}, modo)
      setPedirSent(s=>({...s,[email]:via?'ok':'skip'}))
      if(via&&!modo) appAlert(txtEnviado(via,{que:'Aviso de pedir fondos', para:`${grupo.abg} (${email})`}))
      if(via) logActividad('fondos.pedido_enviado',{detalle:{persona:grupo.abg,title:`${grupo.clientes.length} cliente${grupo.clientes.length!==1?'s':''} · ${grupo.clientes.slice(0,4).map(c=>c.name).join(', ')}`,monto:Math.round(grupo.total)}})
      return !!via }
    catch(e){ setPedirSent(s=>({...s,[email]:'err'})); if(!modo) avisoNoEnviado('El aviso de pedir fondos', e.message||String(e)); return false }
  }
  const enviarPedirTodos=async()=>{
    const entries=Object.entries(pedirFondosGrupos).filter(([k])=>k!=='__sin__')
    if(!entries.length) return
    if(!await appConfirm(`¿Enviar el aviso de "pedir fondos" a ${entries.length} abogado(s)? Cada uno recibe solo sus clientes.`)) return
    const modo=await modoEnvioLote(entries.length)
    if(modo==='cancelar'){ appAlert(txtResumenEnvio({ok:0,no:entries.length,que:'avisos'})); return }
    let ok=0; for(const [email,grupo] of entries){ if(await enviarPedir1(email,grupo,modo)) ok++ }
    appAlert(txtResumenEnvio({ok, no:entries.length-ok, via:modo, que:ok===1?'aviso':'avisos'}))
  }
  const [liqPend,setLiqPend]=useState(null)   // liquidación de caja chica por abrir (aviso del teléfono), hasta que carguen las liquidaciones
  // Puentes tras cargar notaría: navegar directo a la sub-vista pedida desde la pantalla de resultado (orphans / deuda / rendir).
  useEffect(()=>{ if(!navTo) return
    setShowCargaPag(false); setNotaMenuOpen(false); setSelectedClient(null); setShowHistorial(false); setShowGastosOficina(false); setShowBuscarClientes(false); setShowReasignar(false); setShowRevision(false)
    if(navTo&&navTo.cli){ const c=(clients||[]).find(x=>String(x.id)===String(navTo.cli)); if(c){ setHubOpen(false); if(isDesktop) setShowBuscarClientes(true); setSelectedClient(c) } }
    if(navTo&&navTo.liq) setLiqPend(String(navTo.liq))   // aviso del teléfono de una liquidación de caja chica
    if(navTo==='cajasEquipo'){ setHubOpen(false); setShowRevisar(true); setRevCaja(true) }
    if(navTo==='orphans') setShowOrphans(true)
    else if(navTo==='deuda'){ setShowNotaria(true); setNotaTab('pend') }
    else if(navTo==='rendir'){ setHubOpen(false); setShowRendiciones(true); setRendSub(null) }
    else if(navTo==='rendirCli'){ setHubOpen(false); setShowRendiciones(true); setQ(''); setRendGrupo('env'); setRendAbg('Todos'); setRendSub('rendir') }
    else if(navTo==='rendirPedir'){ setHubOpen(false); setShowRendiciones(true); setQ(''); setRendGrupo('pedir'); setRendAbg('Todos'); setRendSub('rendir') }   // correo de cierre › «Rendir y pedir»   // Inicio › Rendiciones por hacer: directo a Rendir a cliente › Borradores
    onNavDone&&onNavDone()
  },[navTo])
  // Abre la liquidación pedida por el aviso del teléfono apenas están cargadas las liquidaciones.
  useEffect(()=>{ if(!liqPend) return; const r=(rendiciones||[]).find(x=>String(x.id)===liqPend); if(r){ setLiqDetail(r); setLiqPend(null) } },[liqPend,rendiciones])
  // Ledger de cobros de la notaría (fuente única): cada gasto de notaría con su estado (pagada/en liquidación/por pagar) y error (sin cliente/duplicado), agrupado por carga masiva.
  const notaLedger = useMemo(()=>{
    const liqById={}; (notaLiquidaciones||[]).forEach(r=>{ liqById[String(r.id)]=r })
    const all=(expenses||[]).filter(e=>e.category==='Notaria'&&e.type!=='fondo'&&!e.deleted_at)
    const otCount={}; all.forEach(e=>{ const o=String(e.ot_number||'').trim().toLowerCase(); if(o) otCount[o]=(otCount[o]||0)+1 })
    const rows=all.map(e=>{
      const liq=e.notaria_render_id?liqById[String(e.notaria_render_id)]:null
      const estado = (e.notaria_liquidado_at||(liq&&notaEstado(liq)==='pagado')) ? 'pagada' : (liq ? 'enliq' : 'porpagar')
      const o=String(e.ot_number||'').trim().toLowerCase()
      const err = (!e.client_id&&!e.personal_de) ? 'sincliente' : (o&&otCount[o]>1 ? 'dup' : null)
      return { e, estado, err }
    })
    const byBatch={}; rows.forEach(r=>{ const k=r.e.bulk_import_id||'__manual__'; (byBatch[k]=byBatch[k]||[]).push(r) })
    const impById={}; (bulkImports||[]).forEach(b=>{ impById[String(b.id)]=b })
    const cargas=Object.entries(byBatch).map(([k,rs])=>{
      const imp=impById[k]
      const fecha=imp?.created_at || rs.map(r=>r.e.date).filter(Boolean).sort().slice(-1)[0] || null
      return { key:k, filename: imp?.filename || (k==='__manual__'?'Cargas manuales':'Carga '+String(k).slice(0,6)), who: imp?.created_by||null, fecha, rows:rs, total: rs.reduce((a,r)=>a+(r.e.amount||0),0), nErr: rs.filter(r=>r.err).length }
    }).sort((a,b)=>String(b.fecha||'').localeCompare(String(a.fecha||'')))
    return { rows, cargas, total: rows.reduce((a,r)=>a+(r.e.amount||0),0), n: rows.length }
  },[expenses,notaLiquidaciones,bulkImports])
  // "No son nuestras": OT que en la carga marcaste como no reconocidas (OT correctas pero no las paga la oficina).
  // Ya viven persistidas en el resumen de cada carga (bulk_imports.resumen.noNuestras); acá se agregan para poder
  // consultarlas a la notaría cuando quieras, no solo durante la carga. El estado (consultada/resuelta) va en learnings.
  const [noNRows,setNoNRows] = useState([])   // tabla notaria_no_nuestras (fuente: una fila por N° de OT, completa, con cargas e historial)
  useEffect(()=>{ if(DEMO){ setNoNRows(demoData.notariaNoNuestras||[]); return } supabase.from('notaria_no_nuestras').select('*').order('created_at',{ascending:false}).then(({data})=>setNoNRows(data||[])).catch(()=>{}) },[bulkImports])
  const notaNoNuestras = useMemo(()=>{
    const items=[], vistos=new Set()
    ;(noNRows||[]).forEach(r=>{ const k=canonOtNN(r.ot); vistos.add(k)
      items.push({ id:r.id, _row:r, ot:k||r.ot, fecha:r.fecha||null, materia:r.materia||r.motivo||'', requirente:r.requirente||'', concepto:r.concepto||'', subconcepto:r.subconcepto||'', monto:Number(r.monto)||0, estado:r.estado||'pendiente', resolucion:r.resolucion||null, consultadaAt:r.consultada_at||null, resueltaAt:r.resuelta_at||null, cargas:r.cargas||[], historial:r.historial||[], expense_id:r.expense_id||null }) })
    // Respaldo: OT guardadas en el resumen de una carga que aún no están en la tabla (cargas antiguas) → nunca se pierden.
    ;(bulkImports||[]).forEach(b=>{ (b.resumen?.noNuestras||[]).forEach((nn,i)=>{ const k=canonOtNN(nn.ot); if(!k||vistos.has(k)) return; vistos.add(k); const id=`${b.id}#${i}`
      items.push({ id, _snap:{...nn, _batch:{id:b.id,filename:b.filename,created_at:b.created_at,created_by:b.created_by}}, ot:k, fecha:nn.fecha||null, materia:nn.materia||nn.motivo||'', requirente:nn.requirente||nn.nombre||'', concepto:nn.concepto||'', subconcepto:nn.subconcepto||'', monto:Number(nn.monto)||0, estado:noNEstado[id]||'pendiente', resolucion:null, consultadaAt:noNConsult[id]||null, resueltaAt:null, cargas:[{id:b.id,filename:b.filename,fecha:b.created_at}], historial:[], expense_id:null }) }) })
    const ultCarga=x=>String((x.cargas||[]).map(c=>c.fecha).filter(Boolean).sort().slice(-1)[0]||'')
    items.sort((a,b)=>ultCarga(b).localeCompare(ultCarga(a)))
    const sum=a=>a.reduce((t,x)=>t+(x.monto||0),0)
    const activos=items.filter(x=>x.estado!=='resuelta'), resueltas=items.filter(x=>x.estado==='resuelta')
    const pend=activos.filter(x=>x.estado==='pendiente'), cons=activos.filter(x=>x.estado==='consultada')
    return { items, activos, resueltas, n:activos.length, total:sum(activos), nPend:pend.length, nConsult:cons.length, totPend:sum(pend), totCons:sum(cons), totRes:sum(resueltas), totTodo:sum(items),
             ultConsulta: items.map(x=>x.consultadaAt).filter(Boolean).sort().slice(-1)[0]||null }
  },[noNRows,bulkImports,noNEstado,noNConsult])
  // Cambia el estado de una OT "no nuestra" SIN perder nada: actualiza la fila (o la crea desde el respaldo), suma al historial y a la bitácora.
  const noNUpdate = async(item, patch, ev) => {
    const now=new Date().toISOString(), hEv={at:now,por:currentUserName||null,...ev}
    if(DEMO){ setNoNRows(p=>{ const base=item._row||{id:item.id,ot:item.ot,monto:item.monto,materia:item.materia,requirente:item.requirente,cargas:item.cargas,historial:[]}; const nx={...base,...patch,historial:[...(base.historial||[]),hEv]}; return p.some(x=>x.id===nx.id)?p.map(x=>x.id===nx.id?nx:x):[nx,...p] }); return }
    let row=item._row
    if(!row){ const sn=item._snap||{}; const bt=sn._batch||{}
      const {data,error}=await supabase.from('notaria_no_nuestras').insert({ot:item.ot,fecha:_fechaISO(item.fecha),materia:item.materia||null,requirente:item.requirente||null,concepto:item.concepto||null,subconcepto:item.subconcepto||null,monto:item.monto||0,motivo:sn.motivo||null,datos:sn,cargas:item.cargas,historial:[{at:bt.created_at||now,accion:'marcada',por:bt.created_by||null,detalle:'Marcada como no nuestra en la carga'}],created_by:bt.created_by||null}).select().single()
      if(error) throw error; row=data }
    const {data,error}=await supabase.from('notaria_no_nuestras').update({...patch,historial:[...(row.historial||[]),hEv],updated_at:now}).eq('id',row.id).select().single()
    if(error) throw error
    setNoNRows(p=>p.some(x=>x.id===data.id)?p.map(x=>x.id===data.id?data:x):[data,...p])
    logActividad('notaria.nonuestra_'+ev.accion,{tabla:'notaria_no_nuestras',id:data.id,detalle:{title:`${data.ot}${data.materia?` · ${data.materia}`:''}`,monto:Number(data.monto)||0}})
    return data
  }
  // Carga el estado persistido de las "no son nuestras" (learnings notaria_nonuestra: value = "estado|fechaISO").
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key,value').eq('kind','notaria_nonuestra').order('updated_at',{ascending:true}).then(({data})=>{ const est={},at={}; (data||[]).forEach(r=>{ if(!r.key) return; const [e,d]=String(r.value||'').split('|'); if(e) est[r.key]=e; if(d) at[r.key]=d }); setNoNEstado(est); setNoNConsult(at) },()=>{}) },[])
  // Envía a la notaría la consulta por las OT no reconocidas seleccionadas (mismo texto que en la carga). Las marca "consultada".
  const consultarNoNuestras = async(items) => {
    const dest=String(cleanNotaDest(notaEmail)||NOTARIA_DEFAULT).split(/[,;]/).map(x=>x.trim()).filter(x=>x.includes('@')&&!/@leabogados\.cl$/i.test(x)).join(', ')
    if(!dest){ appAlert('Falta el correo de la notaría.'); return }
    if(!items.length){ appAlert('Selecciona al menos una OT para consultar.'); return }
    if(!(await appConfirm(`¿Enviar a la notaría (${dest}) una consulta por ${items.length} OT que no reconocemos, pidiendo detalle? La oficina va en copia.`))) return
    setNoNSending(true)
    try{
      const ccEstudio=BRAND.ccNotaria||undefined
      const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      const otL=r=>{ const o=String(r.ot||'').trim(); return o?(o.toUpperCase().startsWith('OT')?o.toUpperCase():'OT-'+o):'s/OT' }
      const filas=items.map(r=>`<tr><td style="padding:5px 0;font-size:11px;color:#185FA5;font-weight:600;white-space:nowrap">${esc(otL(r))}</td><td style="padding:5px 8px;font-size:12px;color:#3D3D3D">${esc(r.motivo||'—')}${r.nombre?` <span style="color:#99ABB4">· ${esc(r.nombre)}</span>`:''}</td><td style="padding:5px 0;font-size:12px;text-align:right;font-weight:600;white-space:nowrap">$${(r.monto||0).toLocaleString('es-CL')}</td></tr>`).join('')
      const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${BRAND.logoUrl}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:14px;color:#666;margin:0 0 6px">Estimadas ${NOTA_DIRIGIDO},</div><div style="font-size:14px;color:#666;margin:0 0 16px">Espero que estén muy bien. Revisando la liquidación, encontramos las siguientes OT que <b>no logramos reconocer</b> como trabajos de nuestra oficina. ¿Nos podrían dar más detalle (compareciente, materia, a qué corresponden) para poder identificarlas?</div><table style="width:100%;border-collapse:collapse"><tr style="border-bottom:1px solid #E4E8EB"><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0">OT</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 8px">Detalle que tenemos</td><td style="font-size:10px;color:#99ABB4;text-transform:uppercase;padding:4px 0;text-align:right">Monto</td></tr>${filas}</table><div style="font-size:13px;color:#666;margin:16px 0 0">Quedamos atentos.<br><br>Saludos cordiales,<br><b style="color:#1a1a1a">${BRAND.nombre}</b></div></div><div style="padding:16px 28px;border-top:1px solid #eee;font-size:11px;color:#999">${BRAND.dominio} · ${BRAND.nombre}</div></div></body></html>`
      const texto=`Estimadas ${NOTA_DIRIGIDO},\n\nEspero que estén muy bien. Revisando la liquidación, encontramos las siguientes OT que no logramos reconocer como trabajos de nuestra oficina. ¿Nos podrían dar más detalle para identificarlas?\n\n`+items.map(r=>`• ${otL(r)} · ${(r.motivo||'—')}${r.nombre?` · ${r.nombre}`:''} · $${(r.monto||0).toLocaleString('es-CL')}`).join('\n')+'\n\nQuedamos atentos.\nSaludos cordiales,\n'+BRAND.nombre
      const subject=`Consulta sobre OT no reconocidas — ${BRAND.nombre} — ${new Date().toLocaleDateString('es-CL')}`
      const via=await enviarComoUsuario({to:dest,cc:ccEstudio,subject,html,text:texto})
      if(via===null){ setNoNSending(false); return }   // el usuario canceló la autorización de Gmail
      const now=new Date().toISOString()
      for(const it of items){ try{ await noNUpdate(it,{estado:'consultada',consultada_at:now,consultada_por:currentUserName||null},{accion:'consultada',detalle:`Consultada a la notaría (${dest})`}) }catch(e){ console.error('noNUpdate',e) } }
      setNoNSel(new Set())
      appAlert(txtEnviado(via,{que:`Consulta por ${items.length} OT`,g:'a',para:'la notaría'}))
    }catch(e){ appAlert('No se pudo enviar la consulta: '+(e.message||e)) }
    setNoNSending(false)
  }
  // Resolver una OT "no nuestra" (NO se borra: pasa a "Resueltas" con su resolución). 'era_nuestra' crea el gasto de notaría
  // con los datos de la OT (queda en Pagar › "Sin cliente ni persona" para asignarle cliente); 'respondida' solo la cierra.
  const resolverNoNuestra = async(item, resolucion) => {
    try{
      const now=new Date().toISOString(); let expense_id=null
      if(resolucion==='era_nuestra'){
        if(!(await appConfirm(`¿${item.ot} sí era nuestra? Se carga el gasto de notaría por ${fmt(item.monto)} en Pagar › "Sin cliente ni persona", para asignarle cliente.`))) return
        if(!DEMO){ const {data,error}=await supabase.from('expenses').insert({type:'gasto',client_id:null,amount:item.monto||0,concept:item.concepto||item.materia||'Notaría',subconcept:item.subconcepto||null,ot_number:item.ot,requirente:item.requirente||null,materia:item.materia||null,category:'Notaria',date:_fechaISO(item.fecha),paid_by_client:true}).select().single()
          if(error) throw error; expense_id=data.id; setExpenses(p=>[data,...p]) }
      }
      await noNUpdate(item,{estado:'resuelta',resolucion,resuelta_at:now,resuelta_por:currentUserName||null,...(expense_id?{expense_id}:{})},{accion:resolucion==='era_nuestra'?'era_nuestra':'respondida',detalle:resolucion==='era_nuestra'?'Sí era nuestra · gasto cargado en Pagar':'La notaría respondió'})
      setNoNSel(p=>{ const n=new Set(p); n.delete(item.id); return n })
    }catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) }
  }
  const reabrirNoNuestra = async(item) => {
    try{
      if(item.expense_id&&!(await appConfirm('Vuelve a la revisión. El gasto que se cargó en Pagar se mantiene; elimínalo allí si no corresponde.'))) return
      await noNUpdate(item,{estado:item.consultadaAt?'consultada':'pendiente',resolucion:null,resuelta_at:null,resuelta_por:null},{accion:'reabierta',detalle:'Volvió a la revisión'})
    }catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) }
  }
  const csvDownload = (name, rows2d) => { try{ const csv=rows2d.map(r=>r.map(c=>{ const s=String(c==null?'':c); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s }).join(';')).join('\n'); const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href) }catch(err){ appAlert('Error al exportar: '+err.message) } }
  // Parte B (desktop 2-panel): ↑/↓ recorren la lista de clientes (misma que el panel izq), Esc vuelve al dashboard. No dispara si escribes o hay un modal.
  useEffect(()=>{ if(!isDesktop) return
    const h=e=>{
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp'&&e.key!=='Escape') return
      const tg=(e.target?.tagName||'').toLowerCase(); if(tg==='input'||tg==='textarea'||tg==='select'||e.target?.isContentEditable) return
      if(hubOpen||rendicionClient||attachExpense||liqDetail||emailRend||devEmailRend||showNotaria||showHistorial||showOrphans||showClasificar||showRevision) return
      if(e.key==='Escape'){ if(selectedClient){ e.preventDefault(); setSelectedClient(null) } return }
      const saldoDe=c=>(balances[c.id]?.fondos||0)-(balances[c.id]?.gastos||0)
      let list=filteredClients
      if(!q.trim()&&saldoFilter!=='todos') list=list.filter(c=> saldoFilter==='neg'?saldoDe(c)<0:saldoFilter==='cero'?Math.round(saldoDe(c))===0:saldoDe(c)>0)
      list=[...list].sort((a,b)=>(a.name||'').localeCompare(b.name||'','es'))
      if(!list.length) return
      e.preventDefault()
      const cur=selectedClient?list.findIndex(c=>String(c.id)===String(selectedClient.id)):-1
      let ni=e.key==='ArrowDown'?cur+1:cur-1; ni=Math.max(0,Math.min(list.length-1,ni))
      setSelectedClient(list[ni])
    }
    document.addEventListener('keydown',h); return ()=>document.removeEventListener('keydown',h)
  },[isDesktop,hubOpen,selectedClient,filteredClients,balances,saldoFilter,q,rendicionClient,attachExpense,liqDetail,emailRend,devEmailRend,showNotaria,showHistorial,showOrphans,showClasificar,showRevision])
  useEffect(()=>{ if(!isDesktop||!selectedClient) return; try{ document.querySelector('aside [data-cid="'+String(selectedClient.id)+'"]')?.scrollIntoView({block:'nearest'}) }catch(_){} },[selectedClient,isDesktop])
  const pedirModal = pedirOpen&&(()=>{ const groups=Object.entries(pedirFondosGrupos); const conAbg=groups.filter(([k])=>k!=='__sin__').sort((a,b)=>b[1].total-a[1].total); const sin=pedirFondosGrupos['__sin__']; const totalGral=conAbg.reduce((a,[,g])=>a+g.total,0)
    const nCli=conAbg.reduce((a,[,g])=>a+g.clientes.length,0)+(sin?.clientes?.length||0), totAll=totalGral+(sin?.total||0)
    return <FlujoPagina origen='Gastos' titulo='Pedir fondos a los abogados' onBack={()=>setPedirOpen(false)} maxW={1120}>
      <div>
        {totAll>0
          ? <div style={{background:C.soonBg,borderRadius:12,padding:'12px 14px',marginBottom:12}}><div style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5}}>Adelantado por la oficina</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:13,color:C.soonText}}>{nCli} cliente{nCli!==1?'s':''} sin fondos · {conAbg.length} abogado{conAbg.length!==1?'s':''}</span><span style={{fontSize:22,fontWeight:800,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmt(totAll)}</span></div></div>
          : null}
        <div style={{fontSize:13,color:C.muted,lineHeight:1.5,marginBottom:12}}>Cada abogado recibe un correo con SUS clientes sin fondos y el detalle de los gastos que la oficina adelantó. Se envía desde tu correo.</div>
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,alignItems:'start'}:undefined}>
        {conAbg.map(([email,g])=>{ const pc=personChip(g.abg); const st=pedirSent[email]; return (
          <div key={email} style={{border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',marginBottom:10,background:'#fff'}}>
            <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:9}}>
              <span style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'3px 11px',background:pc.bg,color:pc.color,border:`1px solid ${pc.color}33`}}>{g.abg}</span>
              <div style={{flex:1,fontSize:12,color:C.muted}}>{g.clientes.length} cliente{g.clientes.length!==1?'s':''}</div>
              <b style={{fontSize:14,color:C.overdueText}}>{fmt(g.total)}</b>
            </div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {g.clientes.map((c,i)=>(<div key={c.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'7px 11px',borderTop:i?`0.5px solid ${C.border}`:'none'}}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(c.id)} style={{...NOMBRE_CLI,cursor:'pointer'}}>{c.name}</div><div style={{fontSize:11,color:C.muted}}>{c.gastos.length} gasto{c.gastos.length!==1?'s':''}</div></div><b style={{fontSize:13,color:C.overdueText,whiteSpace:'nowrap'}}>{fmt(c.deuda)}</b></div>))}
            </div>
            <button disabled={st==='sending'||st==='ok'} onClick={()=>enviarPedir1(email,g)} style={{width:'100%',border:'none',borderRadius:10,padding:'9px 12px',fontSize:13,fontWeight:700,cursor:st==='ok'?'default':'pointer',background:st==='ok'?C.greenBg:(st==='err'||st==='skip')?C.overdueBg:C.accent,color:st==='ok'?C.greenText:(st==='err'||st==='skip')?C.overdueText:'#fff'}}>{st==='sending'?'Enviando…':st==='ok'?<>Enviado{" "}<Gl n='tick'/></>:st==='err'?'Falló — reintentar':st==='skip'?'No se envió — reintentar':`Enviar a ${(g.abg||'').split(' ')[0]}`}</button>
          </div>
        )})}
        </div>
        {sin&&sin.clientes.length>0&&(
          <div style={{border:`1px dashed ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:10,background:C.bgWarm}}>
            <div style={{fontSize:12,fontWeight:700,color:C.grisText,marginBottom:3}}>{sin.clientes.length} cliente{sin.clientes.length!==1?'s':''} sin abogado — {fmt(sin.total)}</div>
            <div style={{fontSize:11,color:C.muted,lineHeight:1.45}}>Asígnales un abogado a cargo (en la ficha del cliente) para poder avisarle.</div>
          </div>
        )}
        {conAbg.length===0&&(!sin||!sin.clientes.length)&&<div style={{textAlign:'center',fontSize:13,color:C.greenText,padding:'18px 0'}}>Sin clientes por provisionar · todo cuadra.</div>}
        {conAbg.length>1&&(
          <button onClick={enviarPedirTodos} style={{width:'100%',border:`1px solid ${C.accent}`,borderRadius:12,padding:'11px',fontSize:13,fontWeight:700,cursor:'pointer',background:'#fff',color:C.accent,marginTop:2}}>Enviar a todos ({conAbg.length}) · {fmt(totalGral)}</button>
        )}
        <div style={{marginTop:12}}><BitacoraLista prefijo='fondos.' titulo='Pedidos enviados' etiquetas={{'fondos.pedido_enviado':'Pedido de fondos enviado'}} limite={12} vacio='Aún no hay pedidos enviados.'/></div>
      </div>
    </FlujoPagina>
  })()
  // Acciones de la ficha del cliente: tres botones iguales (32 px) — Fondo · Gasto (principal) · Rendir n (solo si hay por rendir).
  // Escritorio: van en la línea del nombre y nunca se encogen ni saltan de línea (lo que cede es el nombre, con "…"). Móvil: fila a todo el ancho.
  const accionesCli = (full) => {
    if(!selectedClient||esOficina(selectedClient.id)) return null
    const por=gastosPorRendir(selectedClient.id), n=por.length, monto=por.reduce((a,e)=>a+(e.amount||0),0)
    // Mismo color que su tarjeta: + Fondo = verde de Fondos, + Gasto = azul de Gastos; Rendir neutro.
    const b=(bg,col,bd)=>({height:32,padding:full?'0 6px':'0 14px',minWidth:full?0:96,flex:full?1:'0 0 auto',borderRadius:9,fontSize:13,fontWeight:600,fontFamily:'inherit',cursor:'pointer',whiteSpace:'nowrap',boxSizing:'border-box',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,border:`1px solid ${bd||bg}`,background:bg,color:col})
    return (<div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0,...(full?{marginTop:8}:{})}}>
      <button type='button' onClick={()=>onIrConciliacion?onIrConciliacion():onAddFondo()} title='Los fondos entran desde la conciliación bancaria' style={b(C.greenBg,C.greenText)}>+ Fondo</button>
      <button type='button' onClick={()=>onAdd(selectedClient)} style={b(C.border,C.accent)}>+ Gasto</button>
      {n>0&&<button type='button' onClick={()=>{setRendEdit(null);setRendEntityIds([]);setRendicionClient(selectedClient)}} title={`Por rendir al cliente: ${n} gasto${n!==1?'s':''} · ${fmt(monto)}`} style={b(C.surface,C.accent,C.border)}>Rendir <span style={{color:C.textSoft}}>{n}</span></button>}
    </div>)
  }
  // Lista de clientes de Gastos (buscador · Por cobrar/A favor/Todos · por abogado · orden). FUENTE ÚNICA: pantalla "Buscar clientes"
  // y columna izquierda en escritorio cuando hay un cliente abierto (lista + detalle lado a lado; arrastrar un gasto a un cliente lo reasigna).
  const renderListaClientes = ({enHub=false}={}) => {
              const baseAll = clientsWithMovs.filter(c=>pasaEstadoG(c))
              const saldoDe = saldoCliG
              const q2=q.trim().toLowerCase(); const nrm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
              const matchC = c => !q2 || nrm(c.name).includes(nrm(q2)) || (clientEntities||[]).some(e=>String(e.client_id)===String(c.id)&&(nrm(e.name).includes(nrm(q2))||String(e.rut||'').replace(/[.\s-]/g,'').includes(q2.replace(/[.\s-]/g,''))))
              const pasaSaldo = (c,k=saldoFilter)=> k==='neg'?saldoDe(c)<0 : k==='pos'?saldoDe(c)>0 : k==='cero'?Math.round(saldoDe(c))===0 : true
              const list = baseAll.filter(matchC).filter(c=>pasaSaldo(c))   // filtro Por cobrar / A favor / En $0 (tiles)
              // Último movimiento por cliente (máx fecha de gasto/fondo no borrado) → orden por fecha + señal de inactividad.
              const lastAct={}; (expenses||[]).forEach(e=>{ if(e.deleted_at)return; const k=String(e.client_id); const d=(e.date||e.created_at||'').slice(0,10); if(d&&(!lastAct[k]||d>lastAct[k])) lastAct[k]=d })
              const diasDe = c=>{ const d=lastAct[String(c.id)]; if(!d) return null; return Math.floor((Date.now()-new Date(d))/86400000) }
              const sortCli = arr => [...arr].sort((a,b)=>{ const la=lastAct[String(a.id)]||'', lb=lastAct[String(b.id)]||''
                if(cliOrd==='saldoAsc') return Math.abs(saldoDe(a))-Math.abs(saldoDe(b))
                if(cliOrd==='az'||cliOrd==='nombre') return (a.name||'').localeCompare(b.name||'','es')
                if(cliOrd==='reciente') return la<lb?1:la>lb?-1:0
                if(cliOrd==='actividad') return la<lb?-1:la>lb?1:0
                return Math.abs(saldoDe(b))-Math.abs(saldoDe(a)) })
              // Desde el inicio de Gastos: en escritorio abre lista + detalle lado a lado; en móvil abre la ficha y "volver" regresa al inicio.
              const pick = c => { setSelectedClient(c); if(enHub&&isDesktop){ setShowBuscarClientes(true); setHubOpen(false) } }
              const row = c => { const sal=saldoDe(c); const colS=sal<0?C.overdueText:(sal>0?C.accent:C.done); const ents=(clientEntities||[]).filter(x=>String(x.client_id)===String(c.id)); const rs=ents.length>1?`${ents.length} razones sociales`:(ents[0]?rsDisplay(ents[0].name):''); const nPR=gastosPorRendir(c.id).length; const dias=diasDe(c); const inact=dias!=null&&dias>=45; const ult=lastAct[String(c.id)]; return (
                <div key={c.id} data-cid={String(c.id)} onClick={()=>pick(c)} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 14px',borderTop:`1px solid ${C.track}`,cursor:'pointer',...(String(selectedClient?.id)===String(c.id)?{background:C.azulBg,boxShadow:`inset 0 0 0 1.5px ${C.accent}`}:{})}}>
                  <span style={{width:30,height:30,borderRadius:9,background:sal<0?C.overdueBg:(sal>0?C.azulBg:C.bgSoft),display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n={sal<0?'arrowDown':'arrowUp'} s={15} c={colS}/></span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...NOMBRE_CLI}}>{c.name}</div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:1,minWidth:0}}>
                      <span style={{fontSize:11,color:inact?C.overdueText:C.done,flexShrink:0}}>{ult?`Últ. movimiento ${fmtFechaDMY(ult)}`:'sin movimientos'}</span>
                      {rs&&<span style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>· {rs}</span>}
                    </div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:colS,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmtSaldoG(sal)}</div>
                    {nPR>0&&<div style={{fontSize:10.5,fontWeight:600,color:C.greenText,whiteSpace:'nowrap'}}>{nPR} por rendir</div>}
                  </div>
                  <span style={{color:C.textSoft,fontSize:18,lineHeight:1,flexShrink:0}}><Gl n='chevron'/></span>
                </div>
              )}
              // Tiles suaves que filtran (Por cobrar / A favor / En $0): conteo de clientes, no montos. Tocar el activo lo suelta (= todos).
              const tiles = [['neg','Por cobrar',C.overdueBg,C.overdueText,'tCobrar'],['pos','A favor',C.azulBg,C.accent,'tFavor'],['cero','En $0',C.surface,C.muted,'tCero']].map(([k,l,bg,col,ic])=>{ const on=saldoFilter===k; const n=baseAll.filter(matchC).filter(c=>pasaSaldo(c,k)).length; return (
                <button key={k} type='button' onClick={()=>setSaldoFilter(on?'todos':k)} aria-pressed={on} style={{textAlign:'left',background:bg,color:col,border:`1.5px solid ${on?col:(k==='cero'?C.border:'transparent')}`,borderRadius:12,padding:'10px 12px',cursor:'pointer',minWidth:0,fontFamily:'inherit',display:'flex',gap:10,alignItems:'center'}}>
                  {isDesktop&&<KpiIco n={ic} c={col} soft={k==='cero'}/>}
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:10,fontWeight:600,letterSpacing:.4,textTransform:'uppercase',opacity:.9,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l}</div>
                    <div style={{fontSize:isDesktop?19:16,fontWeight:700,letterSpacing:-.4,lineHeight:1.2,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{n} <span style={{fontSize:isDesktop?13:12,fontWeight:600}}>cliente{n!==1?'s':''}</span></div>
                  </div>
                </button>) })
              // Cuentas del equipo (lo propio de cada miembro: personal_de sin cliente). Saldo = fondos − gastos, mismo criterio que dispPersona/fgCliente.
              const miembros=(()=>{ const m={}; (expenses||[]).forEach(e=>{ if(e.deleted_at||e.client_id||!e.personal_de) return; if(!isAdmin&&e.personal_de!==currentUserName) return; const o=(m[e.personal_de]=m[e.personal_de]||{p:e.personal_de,fondo:0,gasto:0,n:0,ult:null}); if(cuentaEnSaldo(e)&&!e.no_descuenta_saldo){ if(e.type==='fondo') o.fondo+=(e.amount||0); else o.gasto+=(e.amount||0) } if(e.type!=='fondo') o.n++; const d=String(e.date||'').slice(0,10); if(d&&(!o.ult||d>o.ult)) o.ult=d })
                const qq=_normTxt(q2||''); return Object.values(m).filter(o=>!qq||_normTxt(o.p).includes(qq)).sort((a,b)=>a.p.localeCompare(b.p,'es')) })()
              const rowMiembro = o => { const sal=o.fondo-o.gasto; const colS=sal<0?C.overdueText:(sal>0?C.accent:C.done); const pc=personChip(o.p); return (
                <div key={'m:'+o.p} onClick={()=>setCuentaP(o.p)} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 14px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
                  <span style={{width:30,height:30,borderRadius:9,background:pc.bg,color:pc.color,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{INICIALES_RESP[o.p]||String(o.p)[0]}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...NOMBRE_CLI}}>{o.p}</div>
                    <div style={{fontSize:11,color:C.done,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[isDesktop?'Cuenta personal':null,o.ult?`Últ. movimiento ${fmtFechaDMY(o.ult)}`:null].filter(Boolean).join(' · ')||'Cuenta personal'}</div>
                  </div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:colS,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmtSaldoG(sal)}</div>
                    {sal!==0&&<div style={{fontSize:10.5,fontWeight:600,color:sal<0?C.overdueText:C.greenText,whiteSpace:'nowrap'}}>{sal<0?'debe a la oficina':'a favor'}</div>}
                  </div>
                  <span style={{color:C.textSoft,fontSize:18,lineHeight:1,flexShrink:0}}><Gl n='chevron'/></span>
                </div>) }
              const ESTS = miembros.length ? [...ESTADOS_G.slice(0,3),['equipo','Equipo'],ESTADOS_G[3]] : ESTADOS_G
              const verEquipo = estadoG==='equipo'
              // Cuenta de castigos (solo orden, no afecta retiros): lo que la oficina asumió de cada cliente, a nombre del abogado responsable.
              // Fuente única: gastos marcados Incobrable + ajustes «Incobrable · asumido por la oficina».
              const em2n=Object.fromEntries([...miembrosRev.admins,...miembrosRev.revisores].filter(m=>m.email).map(m=>[String(m.email).toLowerCase(),m.nombre]))
              const castigos = estadoG==='incobrables' ? (expenses||[]).filter(e=>!e.deleted_at&&e.client_id&&((e.type==='gasto'&&e.incobrable_at)||(e.type==='fondo'&&e.category==='Ajuste'&&/incobrable/i.test(e.concept||'')))).map(e=>{ const by=String(e.incobrable_by||e.created_by||''); return {e, socio:respByClienteFull[String(e.client_id)]||'Sin abogado', fecha:String(e.incobrable_at||e.date||'').slice(0,10), fGasto:String(e.date||'').slice(0,10), monto:Number(e.amount)||0, quien:em2n[by.toLowerCase()]||(by.includes('@')?by.split('@')[0]:by)||'—'} }).filter(x=>isAdmin||_normTxt(x.socio)===_normTxt(currentUserName||'')).sort((a,b)=>b.fGasto.localeCompare(a.fGasto)||b.fecha.localeCompare(a.fecha)) : []   // el limitado ve solo los castigos de sus clientes · afuera manda la fecha del gasto; la del castigo va en la línea de abajo
              const castPorSocio = Object.entries(castigos.reduce((m,x)=>{ const o=(m[x.socio]=m[x.socio]||{tot:0,cli:new Set(),n:0}); o.tot+=x.monto; o.cli.add(String(x.e.client_id)); o.n++; return m },{})).sort((a,b)=>b[1].tot-a[1].tot)
              const castVis = castSocio ? castigos.filter(x=>x.socio===castSocio) : castigos
              const castTot = castVis.reduce((a,x)=>a+x.monto,0)
              const exportCast = ()=>{ const esc=v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`; const H=['Fecha gasto','Fecha castigo','Socio','Cliente','Gasto','Monto','Castigó']
                const lines=castVis.map(x=>[x.fGasto?fmtFechaDMY(x.fGasto):'',fmtFechaDMY(x.fecha),x.socio,(clients||[]).find(c=>String(c.id)===String(x.e.client_id))?.name||'',x.e.concept||'',Math.round(x.monto),x.quien].map(esc).join(';'))
                const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\ufeff'+[H.map(esc).join(';'),...lines].join('\n')],{type:'text/csv;charset=utf-8'})); a.download=`castigos${castSocio?'_'+castSocio:''}.csv`; document.body.appendChild(a); a.click(); a.remove() }
              const castBlock = castigos.length>0&&(
                <div style={{marginBottom:12}}>
                  <div style={{...SEC_LBL,margin:'0 2px 6px'}}>Castigos · a cargo de la oficina</div>
                  <div style={{display:'grid',gridTemplateColumns:isDesktop?`repeat(${Math.max(castPorSocio.length,2)},minmax(0,1fr))`:(castPorSocio.length===2?'1fr 1fr':'1fr'),gap:8,marginBottom:8}}>
                    {castPorSocio.map(([soc,o])=>{ const on=castSocio===soc; return <HubTile key={soc} ic='user' bg={personChip(soc).bg||C.azulBg} col={personChip(soc).color||C.accent} t={soc} s={`${fmt(o.tot)} · ${o.cli.size} cliente${o.cli.size!==1?'s':''}`} cardBg={on?C.selBg:undefined} cardBd={on?C.accent:undefined} onClick={()=>setCastSocio(on?null:soc)}/> })}
                  </div>
                  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px'}}>
                      <span style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{castSocio||'Todos'} · {castVis.length}</span>
                      <button type='button' onClick={exportCast} style={{fontSize:11.5,fontWeight:600,color:C.accent,background:'none',border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit'}}>Exportar</button>
                      <span style={{marginLeft:'auto',fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(castTot)}</span>
                    </div>
                    {castVis.map(x=>{ const cn=(clients||[]).find(c=>String(c.id)===String(x.e.client_id))?.name||'—'; return (
                      <div key={x.e.id} onClick={()=>x.e.type==='gasto'&&onEdit&&onEdit(x.e)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:`1px solid ${C.track}`,cursor:x.e.type==='gasto'&&onEdit?'pointer':'default'}}>
                        {diaGrande(x.fGasto)}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><span onClick={ev=>{ if(onOpenClientFicha){ ev.stopPropagation(); onOpenClientFicha(x.e.client_id) } }}>{cn}</span></div>
                          <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{!castSocio&&<b style={{fontWeight:700,color:personChip(x.socio).color||C.muted}}>{x.socio} · </b>}{isDesktop?<>{x.e.type==='fondo'?'Ajuste':(x.e.category||'—')} · </>:null}castigo {fmtFechaDMY(x.fecha)}{isDesktop&&x.e.type!=='fondo'&&x.e.concept?` · ${x.e.concept}`:''}</div>
                        </div>
                        <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?96:0,textAlign:'right'}}>{fmt(x.monto)}</span>
                      </div>) })}
                  </div>
                </div>)
              const ORDS=[['saldo','Saldo: mayor a menor'],['saldoAsc','Saldo: menor a mayor'],['az','Nombre A–Z'],['reciente',isDesktop?'Último movimiento: más nuevo':'Fecha: más nuevo'],['actividad',isDesktop?'Último movimiento: más antiguo':'Fecha: más antiguo'],['nombre','Por abogado']]
              return (<>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginBottom:10}}>{tiles}</div>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                  <div style={{flex:1,minWidth:0}}><ChipSearch value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente, RUT o razón social…' autoFocus={!enHub}/></div>
                </div>
                <div role='tablist' aria-label='Estado del cliente' style={{display:'flex',background:C.track,borderRadius:10,padding:3,gap:2,marginBottom:10}}>
                  {ESTS.map(([k,l])=>{ const on=estadoG===k; const n=k==='equipo'?miembros.length:clientsWithMovs.filter(c=>pasaEstadoG(c,k)).filter(matchC).length; return (
                    <button key={k} type='button' role='tab' aria-selected={on} onClick={()=>setEstadoG(k)} style={{flex:1,minWidth:0,border:'none',borderRadius:8,padding:isDesktop?'6px 4px':'6px 1px',fontSize:isDesktop?12:11,letterSpacing:isDesktop?0:-.2,fontWeight:600,fontFamily:'inherit',cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',background:on?C.surface:'transparent',color:on?C.accent:C.muted,boxShadow:on?'0 1px 2px rgba(0,0,0,.08)':'none'}}>{l} <span style={{fontWeight:500,opacity:.75}}>{n}</span></button>) })}
                </div>
                {!verEquipo&&castBlock}
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px'}}>
                    <span style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap'}}>{verEquipo?'Equipo':(ESTADOS_G.find(x=>x[0]===estadoG)||ESTADOS_G[0])[1]}{!verEquipo&&(saldoFilter==='neg'?' · Por cobrar':saldoFilter==='pos'?' · A favor':saldoFilter==='cero'?' · En $0':'')} · {verEquipo?miembros.length:list.length}</span>
                    <select value={cliOrd} onChange={e=>setCliOrd(e.target.value)} aria-label='Ordenar clientes' style={{marginLeft:'auto',minWidth:0,maxWidth:'62%',fontSize:12,color:C.muted,background:C.bgSoft,border:'none',borderRadius:20,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit'}}>{ORDS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select>
                  </div>
                  {/* Gastos sin cliente: primera fila, en tono de aviso y borde punteado (no es un cliente). No suma en los tiles; desaparece en cero. */}
                  {verEquipo&&miembros.map(rowMiembro)}
                  {!verEquipo&&!q2&&orphans.length>0&&(()=>{ const tot=orphans.reduce((a,e)=>a+(Number(e.amount)||0),0); const desde=orphans.map(e=>String(e.date||'').slice(0,10)).filter(Boolean).sort()[0]
                    return (
                    <div onClick={()=>setShowOrphans(true)} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 14px',borderTop:`1px solid ${C.track}`,cursor:'pointer',background:C.avisoBg}}>
                      <span style={{width:30,height:30,borderRadius:9,background:C.avisoMid,border:`1px dashed ${C.avisoLine}`,boxSizing:'border-box',color:C.avisoText,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,flexShrink:0}}>?</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:C.avisoText}}>Gastos sin cliente</div>
                        <div style={{fontSize:11,color:C.textSoft,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{orphans.length} gasto{orphans.length!==1?'s':''}{desde?` · desde ${fmtFechaDMY(desde)}`:''}</div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:C.avisoText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(tot)}</div>
                        <div style={{fontSize:10.5,fontWeight:600,color:C.textSoft,whiteSpace:'nowrap'}}>por asignar</div>
                      </div>
                      <span style={{color:C.textSoft,fontSize:18,lineHeight:1,flexShrink:0}}><Gl n='chevron'/></span>
                    </div>) })()}
                  {verEquipo ? null : list.length===0
                    ? <div style={{color:C.muted,textAlign:'center',padding:22,fontSize:13,borderTop:`1px solid ${C.track}`}}>Sin clientes.</div>
                    : (q2||cliOrd!=='nombre')
                      ? sortCli(list).map(row)
                      : (()=>{ const grupos={}; list.forEach(c=>{ const k=respByClienteFull[String(c.id)]||'__sin__'; (grupos[k]=grupos[k]||[]).push(c) }); const order=Object.keys(grupos).sort((a,b)=> a==='__sin__'?1:b==='__sin__'?-1:a.localeCompare(b,'es')); return order.map(k=>{ const cs=sortCli(grupos[k]); const suma=cs.reduce((s,c)=>s+saldoDe(c),0); const sin=k==='__sin__'; const pc=sin?{bg:C.bgWarm,color:C.grisText}:personChip(k); return (
                          <details key={k} style={{borderTop:`1px solid ${C.track}`}}>
                            <summary style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',cursor:'pointer',listStyle:'none'}}>
                              <span style={{width:28,height:28,borderRadius:8,background:pc.bg,color:pc.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0}}>{sin?<SIcon n='user' s={15} c={C.grisText}/>:(INICIALES_RESP[k]||String(k)[0])}</span>
                              <span style={{fontSize:13,fontWeight:700,color:C.text}}>{sin?'Sin abogado':k}</span>
                              <span style={{fontSize:11,color:C.muted}}>· {cs.length}</span>
                              <span style={{flex:1}}></span>
                              <span style={{fontSize:14,fontWeight:700,color:suma<0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtSaldoG(suma)}</span>
                              <span style={{display:'inline-flex',marginLeft:4,transform:'rotate(90deg)'}}><SIcon n='chevron' s={12} c={C.done}/></span>
                            </summary>
                            <div>{cs.map(row)}</div>
                          </details>
                        )}) })()
                  }
                </div>
              </>)
  }
  const body = (
    <div style={isDesktop?{maxWidth:showNotaria&&notaTab==='pend'?1320:1040,margin:'0 auto'}:undefined}>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:isDesktop&&selectedClient?'nowrap':'wrap',gap:isDesktop&&selectedClient?16:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>
            {(selectedClient||showOrphans||showNotaria||showHistorial||!hubOpen)&&(
              <button onClick={()=>{
                // Cada flecha devuelve a la vista INMEDIATAMENTE anterior (no al hub salvo que la anterior sea el hub).
                if(selectedClient){setSelectedClient(null);return}                                          // ficha → lista donde estabas
                if(showOrphans){setShowOrphans(false);return}                                                // Sin cliente → Gastos por revisar (showRevision sigue true)
                if(showRevision){ if(revSub){setRevSub(null);setRevSel(new Set());return} setShowRevision(false);return }  // categoría → 3 tarjetas ; 3 tarjetas → Clientes
                if(showReasignar){setShowReasignar(false);setReasignFrom(null);setRevSel(new Set());return}   // → Clientes
                if(showBuscarClientes){setShowBuscarClientes(false);setQ('');return}                          // → Clientes
                if(showRendiciones){ if(rendSub){setRendSub(null);setQ('');return} setShowRendiciones(false);setHubOpen(true);return }   // sub → Rendiciones ; Rendiciones → hub
                if(showCargaPag){setShowCargaPag(false);setHubOpen(true);return}                              // Carga masiva → hub
                if(notaMenuOpen){setNotaMenuOpen(false);setHubOpen(true);return}                              // Cargar → hub
                if(showGastosOficina){setShowGastosOficina(false);setHubOpen(true);return}                    // Gastos oficina → hub
                if(showHistorial){setShowHistorial(false);setShowRendiciones(true);setRendSub(null);return}   // Historial (de rendiciones) → Rendiciones
                if(showNotaria){ if(notaTab==='enviar'){ setNotaSend(null); if(notaOrigen==='historial'){ setNotaOrigen(null); setShowNotaria(false); setNotaTab('hub'); setShowHistorial(true); return } setNotaTab('pagados');return} if(notaTab==='documentos'&&docSub){setDocSub(null);return} if(notaTab!=='hub'){setNotaTab('hub');return} setShowNotaria(false);setHubOpen(true);return }   // enviar → Pagos ; subcategoría → Documentos ; sub → Notaría ; Notaría → hub
                setHubOpen(true)                                                                              // Clientes (default) → hub
              }} style={{background:'none',border:'none',cursor:'pointer',padding:0,display:'inline-flex',alignItems:'center',gap:8}}><BackBtn origen={
                selectedClient?'Gastos':showOrphans?(showRevision?'Revisión':showRevisar?'Revisar':'Gastos'):showRevision?(revSub?'Revisión':'Clientes'):(showReasignar||showBuscarClientes)?'Clientes':showRendiciones?(rendSub?'Rendiciones':'Gastos'):showHistorial?'Rendiciones':showNotaria?(notaTab==='enviar'?'Historial':notaTab==='documentos'&&docSub?'Documentos':notaTab!=='hub'?'Notaría':'Gastos'):'Gastos'}/><span style={{color:C.textSoft,fontWeight:400}}>|</span></button>
            )}
            <div style={{minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',minWidth:0}}>
                <span style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,...(isDesktop&&selectedClient?{minWidth:0,maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}:{})}}>
                  {selectedClient?selectedClient.name:showCargaPag?'Carga masiva':showHistorial?'Historial de rendiciones':showGastosOficina?'Gastos oficina':notaMenuOpen?'Cargar':showRendiciones?(rendSub==='rendir'?'Rendir a cliente':rendSub==='pend'?'Pendientes':'Rendiciones'):showBuscarClientes?'Buscar clientes':showReasignar?'Reasignar gastos':showOrphans?'Sin cliente · por asignar':showRevision?(revSub==='archivados'?'Clientes archivados':revSub==='ocasionales'?'Clientes ocasionales':'Gastos por revisar'):showNotaria?(notaTab==='enviar'?'Pagar a la notaría':notaTab==='cobros'?'Cobros':notaTab==='pagados'?'Historial de pagos':notaTab==='pend'?'Pagar':notaTab==='nonuestras'?'No son nuestras':notaTab==='recordatorios'?'Pedidos':notaTab==='documentos'?(_DOC_SUB[docSub]?.[0]||'Documentos'):'Notaría'):showOrphans?'Sin cliente · por asignar':selectedClient?selectedClient.name:'Clientes'}
                </span>
                {selectedClient&&!esOficina(selectedClient.id)&&onOpenClientFicha&&<span onClick={()=>onOpenClientFicha(selectedClient.id)} title='Ver ficha del cliente' style={{fontSize:11,color:C.accent,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Ver ficha <Gl n='chevron'/></span>}
                {selectedClient&&!esOficina(selectedClient.id)&&(()=>{
                  // Deuda efectiva: plata que la oficina YA desembolsó (caja chica + notaría liquidada) por sobre el fondo del cliente. (La oficina misma no se debe a sí misma → excluida.)
                  const f=expenses.filter(e=>e.client_id===selectedClient.id)
                  const fondos=f.filter(e=>e.type==='fondo').reduce((a,e)=>a+(e.amount||0),0)
                  const pagados=f.filter(e=>e.type!=='fondo'&&!e.no_descuenta_saldo&&!e.paid_by_client&&(e.rendered_at||e.notaria_liquidado_at)).reduce((a,e)=>a+(e.amount||0),0)
                  const porCobrar=Math.max(0,pagados-fondos); if(porCobrar<=0) return null
                  return <span title='La oficina ya pagó esto por sobre el fondo del cliente — deuda efectiva por cobrar' style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:'#FFF3DC',border:'1px solid #FAC775',borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>Adelanto {fmt(porCobrar)} por cobrar</span>
                })()}
                {/* Abogado responsable: chip clickeable para cambiar, o "Asignar abogado" si no tiene (deriva de la venta como la ficha). */}
                {selectedClient&&!esOficina(selectedClient.id)&&(()=>{ const abg=respByClienteFull[String(selectedClient.id)]; const pc=abg?personChip(abg):null; return abg
                  ? <span onClick={()=>setRespPickG(v=>!v)} title='Cambiar abogado responsable' style={{fontSize:10,fontWeight:700,color:pc.color,background:pc.bg,borderRadius:10,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>{abg} <Gl n='chevD'/></span>
                  : <button onClick={()=>setRespPickG(v=>!v)} style={{fontSize:10,fontWeight:700,color:C.overdueText,background:C.overdueBg,border:'none',borderRadius:10,padding:'2px 9px',cursor:'pointer',whiteSpace:'nowrap'}}>+ Asignar abogado</button> })()}
              </div>
              {selectedClient&&respPickG&&!esOficina(selectedClient.id)&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>{['Cristóbal','Erasmo','Martín','Martina','Rodrigo'].map(m=>{const pc=personChip(m);const on=respByClienteFull[String(selectedClient.id)]===m;return <button key={m} onClick={()=>asignarRespG(m)} style={{fontSize:11,borderRadius:20,padding:'3px 11px',fontWeight:600,cursor:'pointer',background:on?pc.color:pc.bg,color:on?'#fff':pc.color,border:`1px solid ${on?pc.color:pc.color+'33'}`}}>{m}</button>})}{selectedClient.abogado_responsable&&<button onClick={()=>asignarRespG(null)} style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer'}}>Quitar</button>}</div>}
              {selectedClient&&selEnts.length===1&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>{onOpenClientFicha&&!esOficina(selectedClient.id)?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(selectedClient.id)}} title='Ver ficha del cliente' style={{color:C.accent,fontWeight:600,cursor:'pointer'}}>{rsDisplay(selEnts[0].name)}</span>:rsDisplay(selEnts[0].name)}{selEnts[0].rut?` · ${selEnts[0].rut}`:''}</div>}
            </div>
          </div>
          {isDesktop&&selectedClient&&accionesCli(false)}
        </div>

        {/* Menú Cargar (sin notaría — la notaría tiene su propio botón) */}
        {!selectedClient&&!showOrphans&&!showNotaria&&notaMenuOpen&&(()=>{
          const opts=[
            {t:'Registrar gasto', s:'ingresar uno a mano', ic:'file', col:C.accent, bg:C.azulBg, go:()=>{setNotaMenuOpen(false);onAdd()}},
            {t:'Fondos', s:'desde conciliación bancaria', ic:'wallet', col:C.greenText, bg:C.greenBg, go:()=>{setNotaMenuOpen(false);onIrConciliacion?onIrConciliacion():onAddFondo()}},
            {t:'Carga masiva', s:'varios con IA', ic:'grid', col:C.tealText, bg:C.tealBg, go:()=>{setNotaMenuOpen(false);setCargaOpen(null);setShowCargaPag(true)}},
            ...(gastosClasificar.length>0?[{t:'Clasificar pagos', s:`histórico o descuenta · ${gastosClasificar.length}`, ic:'exchange', col:C.soonText, bg:C.soonBg, go:()=>{setNotaMenuOpen(false);setShowClasificar(true);setSelClasif(new Set());setClasifSearch('');setClasifOpen(new Set())}}]:[]),
          ]
          return (
            <div style={{display:'grid',gridTemplateColumns:isDesktop?`repeat(${opts.length},1fr)`:'1fr 1fr',gap:8,marginBottom:10}}>
              {opts.map(o=>(
                <div key={o.t} onClick={o.go} style={{cursor:'pointer',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 13px',display:'flex',flexDirection:'column',gap:9}}>
                  <span style={{width:32,height:32,borderRadius:10,background:o.bg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><SIcon n={o.ic} s={17} c={o.col}/></span>
                  <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{o.t}</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>{o.s}</div></div>
                </div>
              ))}
            </div>
          )
        })()}
        {/* Vista cliente seleccionado: KPIs (totales de todas las RS). Oficina = la firma: NO es cliente (sin saldo, sin Rendir/Por pagar) — estado de costos con lente Estructural ⇄ Gestión */}
        {selectedClient&&rb&&(()=>{
          if(esOficina(selectedClient.id)){
            if(!isAdmin) return <div style={{fontSize:12,color:C.muted,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:8,lineHeight:1.5}}>Gastos de oficina que <b style={{color:C.text}}>cargaste tú</b>. No incluye sueldos, arriendo ni gastos de otras personas.</div>   // limited: ficha simple, sin costos de oficina
            return (<div onClick={()=>onOpenCostosOfi&&onOpenCostosOfi()} style={{display:'flex',alignItems:'center',gap:10,background:C.azulBg,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 14px',marginBottom:10,cursor:onOpenCostosOfi?'pointer':'default'}}>
              <span style={{width:30,height:30,borderRadius:8,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='building' s={16} c={C.accent}/></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Costos de oficina · presupuesto vs real</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Ahora en el módulo Oficina — costos, retiros, nómina y resultado</div></div>
              {onOpenCostosOfi&&<span style={{fontSize:11,fontWeight:700,color:C.azulInfo,whiteSpace:'nowrap'}}>Abrir <Gl n='chevron'/></span>}
            </div>)
          }
          // Ficha del cliente: el SALDO es el protagonista; Fondos y Gastos al lado (escritorio, una franja 2:1:1) o debajo (móvil).
          // Tarjetas = rótulo + cifra, sin botones dentro; Fondos/Gastos filtran la lista. Color coherente: fondo tenue + texto del mismo tono, más oscuro.
          const bal=rb.total, neg=bal.saldo<0
          const tile=(k,lbl,val,bg,col,big,note)=>{ const on=!!k&&gastoCatF===k; return (
            <button type='button' onClick={()=>setGastoCatF(k)} style={{textAlign:'left',background:bg,color:col,border:`1.5px solid ${on?col:'transparent'}`,borderRadius:12,padding:big?'11px 15px':'11px 14px',cursor:'pointer',fontFamily:'inherit',minWidth:0,...(big?{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:10,...(isDesktop?{}:{gridColumn:'1 / -1'})}:{})}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:10.5,fontWeight:700,letterSpacing:.6,textTransform:'uppercase',opacity:.85}}>{lbl}</div>
                <div style={{fontSize:big?(isDesktop?30:28):(isDesktop?19:16),fontWeight:700,letterSpacing:big?-.8:-.4,lineHeight:1.15,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{val}</div>
              </div>
              {note&&<div style={{fontSize:11.5,opacity:.8,whiteSpace:'nowrap'}}>{note}</div>}
            </button>) }
          return (<div style={{marginBottom:10}}>
            <div style={{display:'grid',gridTemplateColumns:isDesktop?'2fr 1fr 1fr':'1fr 1fr',gap:isDesktop?10:8}}>
              {tile('','Saldo',fmtSaldoG(bal.saldo),neg?C.overdueBg:C.azulBg,neg?C.overdueText:C.accent,true,neg?'por cobrar':bal.saldo>0?'a favor':'al día')}
              {tile('Fondo','Fondos',fmt(bal.fondos),C.greenBg,C.greenText)}
              {tile('__gastos__','Gastos',fmt(bal.gastos),C.border,C.accent)}
            </div>
            {!isDesktop&&accionesCli(true)}
          </div>)
        })()}

        {/* Vista general: tarjetas-filtro + búsqueda */}
        {!selectedClient&&!showOrphans&&!showNotaria&&!showHistorial&&!showGastosOficina&&!showRendiciones&&!notaMenuOpen&&!showCargaPag&&(()=>{
          const baseAll = clientsWithMovs.filter(c=>pasaEstadoG(c))
          const saldoDe = saldoCliG
          const baseList = respFilter ? baseAll.filter(c=> respFilter==='__sin__' ? !c.abogado_responsable : c.abogado_responsable===respFilter) : baseAll
          const negL=baseList.filter(c=>saldoDe(c)<0), posL=baseList.filter(c=>saldoDe(c)>=0)
          // Por responsable: deuda = suma de saldos negativos de SUS clientes (NO se compensa con los que están a favor). 'a favor' análogo.
          const respList = (()=>{ const m=new Map(); baseAll.forEach(c=>{ const k=c.abogado_responsable||'__sin__'; const o=m.get(k)||{negAmt:0,negN:0,posAmt:0,posN:0}; const s=saldoDe(c); if(s<0){o.negAmt+=s;o.negN++}else{o.posAmt+=s;o.posN++} m.set(k,o) }); return [...m.entries()] })()
          return (<>
            {showRevision&&(()=>{
              const cardBase={cursor:'pointer',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 15px'}
              const iconSq=(ic,bg,col)=><span style={{width:34,height:34,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:10}}><SIcon n={ic} s={18} c={col}/></span>
              // Pie común "Mover a…" (aparece al seleccionar gastos en una categoría)
              const footer = revSel.size>0 ? (
                <div style={{marginTop:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,background:C.azulBg,border:`1px solid ${C.accent}`,borderRadius:10,padding:'10px 12px',flexWrap:'wrap'}}>
                    <span style={{fontSize:12,fontWeight:600,color:C.accent,flex:1,minWidth:70}}>{revSel.size} seleccionado{revSel.size!==1?'s':''}</span>
                    <AsignarClienteInline bill={{}} clients={clients} onAssign={(_,cid)=>revMoverA(cid)} label='Mover a…' placeholder='Buscar cliente…'/>
                    <span onClick={()=>{setRevSel(new Set());setRevDupConfirm(null)}} style={{fontSize:11,fontWeight:600,color:C.muted,cursor:'pointer',flexShrink:0}}>Quitar</span>
                  </div>
                  {revDupConfirm&&(
                    <div style={{marginTop:7,background:C.ambarBg,border:`1px solid ${C.soon}`,borderRadius:10,padding:'10px 12px'}}>
                      <div style={{fontSize:12,color:C.coralText,marginBottom:8,lineHeight:1.45}}><b>{revDupConfirm.dups.length}</b> de los seleccionados ya existe{revDupConfirm.dups.length!==1?'n':''} igual{revDupConfirm.dups.length!==1?'es':''} en <b>{revDupConfirm.name}</b> (mismo monto, descripción y categoría).</div>
                      <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
                        <button onClick={()=>doMove(revDupConfirm.unique,revDupConfirm.cid)} style={{fontSize:11,fontWeight:600,border:'none',background:C.accent,color:'#fff',borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Omitir repetidos · mover {revDupConfirm.unique.length}</button>
                        <button onClick={()=>doMove(revDupConfirm.all,revDupConfirm.cid)} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,background:'#fff',color:C.text,borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Mover igual · {revDupConfirm.all.length}</button>
                        <button onClick={()=>setRevDupConfirm(null)} style={{fontSize:11,fontWeight:600,border:'none',background:'none',color:C.muted,cursor:'pointer'}}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null
              // Lista de una categoría (grupos {c,gastos}); tipo controla el badge y el botón Reactivar
              const lista = (grupos, tipo) => grupos.length===0
                ? <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'20px',textAlign:'center',fontSize:13,color:C.greenText}}>Nada por revisar aquí.</div>
                : <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{grupos.map(({c,gastos})=>(
                    <div key={c.id} style={{borderTop:`0.5px solid ${C.border}`}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 13px',flexWrap:'wrap'}}>
                        <input type='checkbox' checked={gastos.length>0&&gastos.every(e=>revSel.has(e.id))} onChange={()=>{ const all=gastos.every(e=>revSel.has(e.id)); setRevSel(s=>{ const n=new Set(s); gastos.forEach(e=>all?n.delete(e.id):n.add(e.id)); return n }) }} style={{flexShrink:0,cursor:'pointer'}}/>
                        <span onClick={()=>onOpenClientFicha&&onOpenClientFicha(c.id)} style={{...NOMBRE_CLI,cursor:'pointer',minWidth:0}}>{c.name}</span>
                        {tipo==='na'
                          ? <span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{c.status==='Terminado'?'Archivado':c.status}</span>
                          : <span style={{fontSize:9.5,fontWeight:700,color:C.grisText,background:C.bgWarm,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>Ocasional</span>}
                        <span style={{fontSize:11,fontWeight:600,color:C.text,marginLeft:'auto',flexShrink:0}}>{gastos.length} · {fmt(gastos.reduce((a,e)=>a+(e.amount||0),0))}</span>
                        {tipo==='na'&&c.status==='Terminado'&&onToggleClientStatus&&<button onClick={()=>onToggleClientStatus(c)} style={{fontSize:10,fontWeight:600,border:`1px solid ${C.normal}`,background:'#fff',color:C.greenText,borderRadius:8,padding:'3px 9px',cursor:'pointer',flexShrink:0}}>Reactivar</button>}
                      </div>
                      {gastos.map(e=>{ const rendido=!!(e.render_id||e.client_render_id); const sel=revSel.has(e.id); return (
                        <label key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 13px 8px 22px',borderTop:`0.5px solid ${C.track}`,cursor:'pointer',background:sel?C.azulBg:'transparent'}}>
                          <input type='checkbox' checked={sel} onChange={()=>toggleSel(e.id)} style={{flexShrink:0,cursor:'pointer'}}/>
                          <span style={{flex:1,fontSize:12,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rendido&&<span style={{fontSize:8,fontWeight:700,textTransform:'uppercase',background:C.coralText,color:'#fff',borderRadius:20,padding:'1px 5px',marginRight:5}}>Rendido</span>}{e.concept||'—'}</span>
                          <span style={{fontSize:12,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(e.amount)}</span>
                        </label>
                      )})}
                    </div>
                  ))}</div>
              if(revSub==='archivados') return <div style={{marginBottom:10}}>{lista(revNoActivo,'na')}{footer}</div>
              if(revSub==='ocasionales') return <div style={{marginBottom:10}}>{lista(revOcasional,'oc')}{footer}</div>
              const nNa=revN(revNoActivo), nOc=revN(revOcasional)
              const cards=[
                {t:'Sin cliente', n:orphans.length, s:orphans.length?`${orphans.length} por asignar`:'al día', ic:'alert', col:C.overdueText, bg:C.overdueBg, go:()=>setShowOrphans(true)},
                {t:'Clientes archivados', n:nNa, s:nNa?`${nNa} gasto${nNa!==1?'s':''}`:'al día', ic:'clock', col:C.soonText, bg:C.ambarBg, go:()=>{setRevSub('archivados');setRevSel(new Set())}},
                {t:'Clientes ocasionales', n:nOc, s:nOc?`${nOc} gasto${nOc!==1?'s':''}`:'al día', ic:'user', col:C.grisText, bg:C.bgWarm, go:()=>{setRevSub('ocasionales');setRevSel(new Set())}},
              ]
              return <div style={{marginBottom:10,display:'grid',gridTemplateColumns:isDesktop?'repeat(3,1fr)':'1fr 1fr',gap:11}}>{cards.map(c=>(
                <div key={c.t} onClick={c.go} style={cardBase}>{iconSq(c.ic,c.bg,c.col)}<div style={{fontSize:15,fontWeight:700,color:C.text}}>{c.t}</div><div style={{fontSize:12,color:c.n?c.col:C.muted,marginTop:2}}>{c.s}</div></div>
              ))}</div>
            })()}
            {/* ── Reasignar gastos (herramienta: elegir cliente origen → mover sus gastos a otro) ── */}
            {showReasignar&&(
              <div style={{marginBottom:10}}>
                <div style={{background:C.azulBg,border:`1px solid #CFE3F7`,borderRadius:12,padding:'10px 12px',fontSize:12,color:C.azulInfo,marginBottom:11}}>Elige el cliente de origen y marca los gastos a mover a otro cliente.</div>
                {!reasignFrom
                  ? <AsignarClienteInline bill={{}} clients={clientsWithMovs} onAssign={(_,cid)=>{ const c=clients.find(x=>String(x.id)===String(cid)); setReasignFrom(c||null); setRevSel(new Set()) }} label='Elegir cliente de origen' placeholder='Buscar cliente…'/>
                  : (()=>{ const gs=(expenses||[]).filter(e=>String(e.client_id)===String(reasignFrom.id)&&e.type==='gasto'&&!e.deleted_at).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)); const selTot=gs.filter(e=>revSel.has(e.id)).reduce((a,e)=>a+(e.amount||0),0); return (<>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:9}}><span style={{fontSize:14,fontWeight:700,color:C.text}}>{reasignFrom.name}</span><span style={{fontSize:11,color:C.muted}}>· {gs.length} gasto{gs.length!==1?'s':''}</span><span onClick={()=>{setReasignFrom(null);setRevSel(new Set())}} style={{marginLeft:'auto',fontSize:11,fontWeight:600,color:C.azulInfo,cursor:'pointer'}}>Cambiar cliente</span></div>
                      {gs.length===0
                        ? <div style={{color:C.muted,textAlign:'center',padding:18,fontSize:12,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12}}>Este cliente no tiene gastos para mover.</div>
                        : <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{gs.map((e,i)=>{ const sel=revSel.has(e.id); return (
                            <label key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 13px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer',background:sel?C.azulBg:'#fff'}}>
                              <input type='checkbox' checked={sel} onChange={()=>toggleSel(e.id)} style={{cursor:'pointer',flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div><div style={{fontSize:10,color:C.muted}}>{e.date?fmtFechaDMY(e.date):''}{e.category?` · ${e.category}`:''}</div></div>
                              <span style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(e.amount)}</span>
                            </label>
                          )})}</div>}
                      {revSel.size>0&&<div style={{display:'flex',alignItems:'center',gap:10,background:C.azulBg,border:`1px solid ${C.accent}`,borderRadius:10,padding:'10px 12px',marginTop:8,flexWrap:'wrap'}}>
                        <span style={{fontSize:12,fontWeight:600,color:C.accent,flex:1,minWidth:70}}>{revSel.size} gasto{revSel.size!==1?'s':''} · {fmt(selTot)}</span>
                        <AsignarClienteInline bill={{}} clients={clients.filter(c=>String(c.id)!==String(reasignFrom.id))} onAssign={(_,cid)=>doMove([...revSel],cid)} label='Mover a…' placeholder='Buscar cliente…'/>
                        <span onClick={()=>setRevSel(new Set())} style={{fontSize:11,fontWeight:600,color:C.muted,cursor:'pointer',flexShrink:0}}>Quitar</span>
                      </div>}
                    </>)})()
                }
                {expenseAudit.length>0&&(
                  <div style={{marginTop:12,borderTop:`0.5px solid ${C.border}`,paddingTop:9}}>
                    <button onClick={()=>setShowHist(s=>!s)} style={{background:'none',border:'none',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',padding:0}}>Historial de reasignaciones ({expenseAudit.length}) {showHist?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
                    {showHist&&<div style={{marginTop:7,maxHeight:220,overflowY:'auto',border:`1px solid ${C.border}`,borderRadius:10}}>{expenseAudit.slice(0,60).map((a,i)=>{ const fromN=clients.find(c=>String(c.id)===String(a.from_client_id))?.name; const toN=clients.find(c=>String(c.id)===String(a.to_client_id))?.name; return (
                      <div key={a.id||i} style={{padding:'7px 11px',borderTop:i?`0.5px solid ${C.border}`:'none',fontSize:11}}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}><span style={{color:C.text,fontWeight:600,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.concept||'—'}</span><div style={{display:'flex',gap:7,alignItems:'center',flexShrink:0}}><span style={{color:C.text,fontWeight:600}}>{fmt(a.amount)}</span>{a.from_client_id&&onAssignClientToExpense&&<button onClick={()=>onAssignClientToExpense(a.expense_id,a.from_client_id)} style={{fontSize:10,fontWeight:600,border:`1px solid ${C.border}`,background:'#fff',color:C.azulInfo,borderRadius:8,padding:'2px 8px',cursor:'pointer'}}>Deshacer</button>}</div></div>
                        <div style={{color:C.muted,marginTop:1}}>{fromN||'sin cliente'} → <b style={{color:C.text}}>{toN||'sin cliente'}</b> · {String(a.created_at||'').slice(0,10)}{a.moved_by?` · ${a.moved_by}`:''}</div>
                      </div>
                    )})}</div>}
                  </div>
                )}
              </div>
            )}
            {/* ── Default: 2 tarjetas (Reasignar · Gastos por revisar) + lista replegada por abogado ── */}
            {!showRevision&&!showReasignar&&!showDescuadres&&!notaMenuOpen&&!showRendiciones&&(()=>{
              const nRev = orphans.length+revN(revNoActivo)+revN(revOcasional)
              if(showBuscarClientes) return renderListaClientes()
              // Default: 3 tarjetas de navegación (iconos suaves estilo hub: cuadro tinte claro + ícono de color). Sin lista desplegada.
              const cardBase={cursor:'pointer',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 15px'}
              const iconSq=(ic,bg,col)=><span style={{width:34,height:34,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:10}}><SIcon n={ic} s={18} c={col}/></span>
              return (
                <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,1fr)':'1fr 1fr',gap:11}}>
                  <div onClick={()=>{setQ('');setShowBuscarClientes(true)}} style={cardBase}>
                    {iconSq('users',C.azulBg,C.accent)}
                    <div style={{fontSize:15,fontWeight:700,color:C.text}}>Buscar clientes</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>Saldos y ficha · {baseAll.length}</div>
                  </div>
                  <div onClick={()=>{setReasignFrom(null);setRevSel(new Set());setShowReasignar(true)}} style={cardBase}>
                    {iconSq('exchange',C.azulBg,C.accent)}
                    <div style={{fontSize:15,fontWeight:700,color:C.text}}>Reasignar gastos</div>
                    <div style={{fontSize:12,color:C.muted,marginTop:2}}>Cambiar gastos de cliente · historial</div>
                  </div>
                  <div onClick={()=>{setRevSel(new Set());setRevSub(null);setShowRevision(true)}} style={cardBase}>
                    {iconSq('alert',nRev>0?C.soonBg:C.azulBg,nRev>0?C.soonText:C.accent)}
                    <div style={{fontSize:15,fontWeight:700,color:C.text}}>Gastos por revisar</div>
                    <div style={{fontSize:12,color:nRev>0?C.soonText:C.muted,marginTop:2}}>{nRev>0?`${nRev} gasto${nRev!==1?'s':''} · 3 categorías`:'todo en orden'}</div>
                  </div>
                </div>
              )
            })()}
          </>)
        })()}
      </div>

      {/* Vista "Carga masiva" (página, no modal): Subir + cargas recientes como acordeones con fecha canon. La subida/revisión con IA se abre desde aquí (onBulk) */}
      {showCargaPag&&(()=>{
        const D=isDesktop
        const liveBulk = id => (expenses||[]).filter(e=>String(e.bulk_import_id)===String(id)&&!e.deleted_at)
        const estOf = e => (e.notaria_liquidado_at||e.notaria_render_id) ? ['Pagada',C.greenText,C.greenBg] : (e.client_rendered_at||e.client_render_id||e.rendered_at||e.render_id) ? ['Rendida',C.azulInfo,C.azulBg] : ['Cargada',C.muted,C.bgSoft]
        const cnOf = e => clients.find(c=>String(c.id)===String(e.client_id))?.name || (e.personal_de?`Personal · ${e.personal_de}`:'Sin cliente')
        const cargas = (bulkImports||[]).map(b=>{ const gs=liveBulk(b.id); return {...b, gs, total:gs.reduce((a,e)=>a+(e.amount||0),0)} })
        const errSin = cargas.reduce((a,c)=> a + (c.status!=='undone' ? (c.resumen?.error||0) : 0), 0)   // filas con error que quedaron registradas y sin resolver
        const totCarg = cargas.reduce((a,c)=> a + (c.status==='undone' ? 0 : (c.resumen?.cargadas ?? c.gs.length)), 0)
        const exportarHistCSV = () => { const esc=s=>{ const t=String(s==null?'':s); return /[",\n;]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t }
          const head=['OT','Concepto','Cliente','Monto','Estado','Error','Carga','Fecha']; const body=[]
          cargas.forEach(c=>{ const fch=c.created_at?new Date(c.created_at).toLocaleDateString('es-CL'):''
            c.gs.forEach(e=>{ const [lbl]=estOf(e); body.push([fmtOt(e.ot_number)||'s/OT', e.concept||'', cnOf(e), e.amount||0, c.status==='undone'?'Deshecha':lbl, '', c.filename||'', fch]) })
            ;(c.resumen?.erroresDet||[]).forEach(er=> body.push([er.ot||'s/OT', er.nombre||'', '', '', 'Con error · no cargada', er.motivo||'', c.filename||'', fch]))
            ;(c.resumen?.noNuestras||[]).forEach(nn=> body.push([nn.ot||'s/OT', nn.motivo||nn.nombre||'', '', nn.monto||'', 'No es nuestra · no cargada', 'avisar a la notaría', c.filename||'', fch])) })
          const csv=[head,...body].map(r=>r.map(esc).join(';')).join('\n'); const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`historial_cargas_notaria_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href) }
        return (
          <div style={{padding:D?'8px 20px 60px':'6px 12px 40px',maxWidth:D?820:undefined,margin:'0 auto'}}>
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
              <button onClick={()=>onBulk&&onBulk(true)} style={{flex:1,minWidth:180,display:'flex',alignItems:'center',gap:10,background:C.accent,color:'#fff',border:'none',borderRadius:12,padding:'13px 15px',cursor:'pointer',textAlign:'left'}}>
                <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>
                <div><div style={{fontSize:14,fontWeight:700}}>Subir Excel de notaría</div><div style={{fontSize:11,color:'#9FE1CB'}}>lee las OT y propone cliente con IA</div></div>
              </button>
              <button onClick={()=>onBulk&&onBulk(false)} style={{flex:1,minWidth:180,display:'flex',alignItems:'center',gap:10,background:'#fff',color:C.text,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',cursor:'pointer',textAlign:'left'}}>
                <span style={{width:34,height:34,borderRadius:10,background:C.tealBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='grid' s={18} c={C.tealText}/></span>
                <div><div style={{fontSize:14,fontWeight:700,color:C.text}}>Otros gastos</div><div style={{fontSize:11,color:C.muted}}>carga masiva general</div></div>
              </button>
            </div>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:10,marginBottom:9}}>
              <div><div style={{...SEC_LBL}}>Historial de cargas</div>
                {cargas.length>0&&<div style={{fontSize:11,color:C.muted,marginTop:1}}>{cargas.length} carga{cargas.length!==1?'s':''} · {totCarg} cargada{totCarg!==1?'s':''}{errSin>0&&<> · <b style={{color:C.overdueText}}>{errSin} con error sin resolver</b></>}</div>}</div>
              {cargas.length>0&&<button onClick={exportarHistCSV} style={{flexShrink:0,fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 11px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:5}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.accent} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/></svg>Exportar CSV</button>}
            </div>
            {cargas.length===0&&<div style={{color:C.muted,textAlign:'center',padding:28,fontSize:13,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12}}>Aún no hay cargas. Sube un Excel para empezar.</div>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>{cargas.map(c=>{ const open=cargaOpen===c.id; const dd=c.created_at?new Date(c.created_at):null; const dnum=dd?dd.getDate():'—'; const dmon=dd?mesCorto(dd):''; const undone=c.status==='undone'
              const rz=c.resumen; const nErr=undone?0:(rz?.error||0); const nCarg=rz?.cargadas ?? c.gs.length; const nOmit=rz?.omitidas||0; const nNoN=undone?0:((rz?.noNuestras||[]).length)
              const dotCol=undone?C.done:(nErr>0?C.overdue:C.normal); return (
              <div key={c.id} style={{border:`1px solid ${nErr>0?'#F3C9C4':C.border}`,borderRadius:12,overflow:'hidden',opacity:undone?.6:1}}>
                <div onClick={()=>setCargaOpen(open?null:c.id)} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 12px',cursor:'pointer',background:open?C.bgSoft:'#fff'}}>
                  <span title={undone?'Deshecha':nErr>0?'Con errores sin resolver':'Cargada'} style={{width:9,height:9,borderRadius:'50%',background:dotCol,flexShrink:0}}/>
                  {diaGrande(isoLocal(c.created_at))}
                  <div style={{flex:1,minWidth:0,borderLeft:`1px solid ${C.border}`,paddingLeft:11}}><div style={{fontSize:14,fontWeight:700,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.filename||'Carga sin nombre'}</div>
                    <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',marginTop:3}}>
                      {undone?<span style={{fontSize:10,color:C.muted}}>{c.created_by?`${c.created_by} · `:''}deshecha</span>:<>
                        {c.created_by&&<span style={{fontSize:10,color:C.muted}}>{c.created_by}</span>}
                        {nCarg>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.greenText,background:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{nCarg} <Gl n='tick'/></span>}
                        {nErr>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.overdueText,background:C.overdueBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{nErr} error</span>}
                        {nNoN>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.overdueText,background:C.overdueBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{nNoN} no nuestras</span>}
                        {nOmit>0&&<span style={{fontSize:9.5,fontWeight:700,color:C.textSoft,background:C.bgSoft,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{nOmit} ya app</span>}
                      </>}
                    </div></div>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(c.total)}</div>
                  <span style={{fontSize:14,color:C.muted,transform:open?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><Gl n='chevron'/></span>
                </div>
                {open&&<div style={{borderTop:`1px solid ${C.border}`}}>
                  {nErr>0&&(c.resumen?.erroresDet?.length>0)&&<div style={{background:C.overdueBg,borderBottom:`1px solid #F3C9C4`,padding:'10px 12px'}}>
                    <div style={{fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:.4,color:C.overdueText,marginBottom:6}}>{nErr} con error · no se cargaron (quedan registradas)</div>
                    <div style={{border:`1px solid #F3C9C4`,borderRadius:8,overflow:'hidden',background:'#fff'}}>
                      {c.resumen.erroresDet.slice(0,40).map((er,ei)=><div key={ei} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'6px 9px',fontSize:11,borderTop:ei?`0.5px solid ${C.bgSoft}`:'none'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{er.ot&&er.ot!=='s/OT'?`${er.ot} · `:''}{er.nombre||'—'}</span><span style={{color:C.overdueText,flexShrink:0,fontWeight:600}}>{er.motivo}</span></div>)}
                    </div>
                    <button onClick={()=>onBulk&&onBulk(true)} style={{marginTop:9,width:'100%',fontSize:12,fontWeight:700,color:'#fff',background:C.overdue,border:'none',borderRadius:8,padding:'8px 12px',cursor:'pointer'}}>Volver a subir el archivo completo · carga solo lo que falta</button>
                    <div style={{fontSize:10,color:C.overdueText,marginTop:5,lineHeight:1.5}}>La OT es la fuente de la verdad: al re-subir el archivo corregido, las OT ya cargadas se saltan solas y solo entra lo que falta.</div>
                  </div>}
                  {c.gs.length===0&&nErr===0&&<div style={{padding:'12px 13px',fontSize:12,color:C.muted}}>Sin gastos vivos en esta carga.</div>}
                  {c.gs.length>8&&<div style={{display:'flex',alignItems:'center',gap:7,padding:'8px 12px',borderTop:`0.5px solid ${C.border}`,background:C.bgSoft}}>
                    <div style={{flex:1,display:'flex',alignItems:'center',gap:6,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 9px',minWidth:0}}>
                      <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>
                      <input value={cargaQ} onChange={ev=>setCargaQ(ev.target.value)} placeholder='Buscar OT o cliente…' style={{border:'none',background:'none',outline:'none',fontSize:12,width:'100%',color:C.text}}/>
                    </div>
                    <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>
                      {[['cliente','Cliente'],['responsable','Resp.'],['estado','Estado'],['plana','Plana']].map(([k,l])=><button key={k} onClick={()=>setCargaGroup(k)} style={{fontSize:11,fontWeight:700,padding:'4px 8px',border:'none',background:cargaGroup===k?C.accent:'#fff',color:cargaGroup===k?'#fff':C.muted,cursor:'pointer'}}>{l}</button>)}
                    </div>
                  </div>}
                  {c.gs.length>0&&(()=>{
                    const q=cargaQ.trim().toLowerCase()
                    const rws=c.gs.filter(e=>!q||`${e.ot_number||''} ${e.concept||''} ${cnOf(e)}`.toLowerCase().includes(q))
                    const OtRow=(e,showCli)=>{ const [lbl,col,bg]=estOf(e); const dd=e.date?fmtFechaDMY(e.date):'—'; return (
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 13px',borderTop:`0.5px solid ${C.track}`,background:'#fff'}}>
                        <span style={{fontSize:9,color:C.textSoft,width:62,flexShrink:0,fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{dd}</span>
                        <span style={{fontSize:11,fontWeight:700,color:C.azulInfo,width:54,flexShrink:0}}>{fmtOt(e.ot_number)||'s/OT'}</span>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}{showCli?<span style={{color:C.muted}}> · {cnOf(e)}</span>:''}</div></div>
                        <span style={{fontSize:9.5,fontWeight:700,color:col,background:bg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>{lbl}</span>
                        <span style={{fontSize:12,fontWeight:600,color:C.text,flexShrink:0,minWidth:56,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(e.amount)}</span>
                      </div>
                    )}
                    if(cargaGroup==='plana') return <div>{rws.map(e=>OtRow(e,true))}{rws.length===0&&<div style={{padding:'12px 13px',fontSize:12,color:C.muted,textAlign:'center'}}>Nada calza con la búsqueda.</div>}</div>
                    const g={}
                    rws.forEach(e=>{ let key,label,cid=null
                      if(cargaGroup==='cliente'){ cid=e.client_id||null; key=cid?('c'+cid):(e.personal_de?('p'+e.personal_de):'sin'); label=cnOf(e) }
                      else if(cargaGroup==='responsable'){ const cc=clients.find(x=>String(x.id)===String(e.client_id)); label=cc?.abogado_responsable||(e.personal_de?('Personal · '+e.personal_de):'Sin responsable'); key='r'+label }
                      else { label=estOf(e)[0]; key='x'+label }
                      ;(g[key]=g[key]||{label,cid,rows:[]}).rows.push(e) })
                    const entries=Object.values(g).sort((a,b)=>b.rows.reduce((s,e)=>s+(e.amount||0),0)-a.rows.reduce((s,e)=>s+(e.amount||0),0))
                    return <div>{entries.map((gr,gi)=>{ const tot=gr.rows.reduce((s,e)=>s+(e.amount||0),0); return (
                      <div key={gi}>
                        <div style={{display:'flex',alignItems:'center',gap:9,padding:'8px 13px',background:C.bgSoft,borderTop:gi?`1px solid ${C.border}`:'none'}}>
                          <span onClick={gr.cid&&onOpenClientFicha?()=>onOpenClientFicha(gr.cid):undefined} style={{fontSize:13,fontWeight:700,color:C.accent,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:gr.cid&&onOpenClientFicha?'pointer':'default'}}>{gr.label}</span>
                          <span style={{fontSize:10,color:C.textSoft,flexShrink:0}}>{gr.rows.length} OT</span>
                          <span style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span>
                        </div>
                        {gr.rows.map(e=>OtRow(e,cargaGroup!=='cliente'))}
                      </div>
                    )})}{rws.length===0&&<div style={{padding:'12px 13px',fontSize:12,color:C.muted,textAlign:'center'}}>Nada calza con la búsqueda.</div>}</div>
                  })()}
                  {!undone&&c.gs.length>0&&(()=>{ const bloq=c.gs.some(e=>e.notaria_render_id||e.notaria_liquidado_at||e.client_render_id||e.client_rendered_at||e.render_id||e.rendered_at); return (
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft}}>
                      {bloq
                        ? <span style={{fontSize:11,color:C.soonText}}>No se puede deshacer: tiene OT ya liquidadas o rendidas.</span>
                        : <span style={{fontSize:11,color:C.muted}}>Borra los {c.gs.length} gastos de esta carga. Sin descuadres (los saldos se recalculan).</span>}
                      <button disabled={bloq||!onUndoImport} onClick={async()=>{ if(!onUndoImport) return; if(await appConfirm(`¿Deshacer la carga "${c.filename||''}"? Se borran ${c.gs.length} gastos.`)){ const ok=await onUndoImport(c.id); if(ok) setCargaOpen(null) } }} style={{marginLeft:'auto',flexShrink:0,fontSize:11,fontWeight:600,color:bloq?C.done:C.overdueText,background:bloq?C.bgSoft:C.overdueBg,border:bloq?`1px solid ${C.border}`:'none',borderRadius:8,padding:'5px 12px',cursor:bloq?'not-allowed':'pointer',opacity:bloq?.6:1}}>Deshacer carga</button>
                    </div>
                  )})()}
                </div>}
              </div>
            )})}</div>
          </div>
        )
      })()}

      {/* Vista "Rendiciones": 3 tarjetas — Rendir a cliente · Pendientes (+90 días) · Historial */}
      {showRendiciones&&(()=>{
        const pend90=(rendirPend||[]).filter(r=>(r.dias||0)>=90).sort((a,b)=>(b.dias||0)-(a.dias||0))
        const pend90Tot=pend90.reduce((a,r)=>a+(r.monto||0),0)
        const cardBase={cursor:'pointer',background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'14px 15px'}
        const iconSq=(ic,bg,col)=><span style={{width:34,height:34,borderRadius:10,background:bg,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:10}}><SIcon n={ic} s={18} c={col}/></span>
        const wrap=ch=><div style={{padding:isDesktop?'4px 22px 100px':'4px 12px 100px',...(isDesktop?{maxWidth:760,margin:'0 auto'}:{})}}>{ch}</div>
        if(rendSub==='rendir'){
          return <div style={{padding:isDesktop?'4px 22px 100px':'4px 12px 100px',...(isDesktop?{maxWidth:1180,margin:'0 auto'}:{})}}> <RendirClientesPage grupoInicial={rendGrupo} abgInicial={rendAbg} clients={clients} expenses={expenses} rendiciones={rendiciones} clientEntities={clientEntities} sales={sales} currentUserName={currentUserName} isAdmin={isAdmin}
            onRendir={(c,lista)=>{setRendEdit(null);setRendEntityIds([]);setRendNav(lista&&lista.length?{ids:lista,i:Math.max(0,lista.findIndex(id=>String(id)===String(c.id)))}:null);setRendicionClient(c)}} onEnviarRend={r=>{ const base=corrSiguiente(rendiciones,r.client_id); setEmailRend({...(r.correlativo?r:{...r,correlativo:base}), _hermanas:(r._hermanas||[]).map((h,i)=>h.correlativo?h:{...h,correlativo:base+1+i})}) }} onVerRend={verPdfRend}
            onEditarRend={r=>{const c=clients.find(x=>String(x.id)===String(r.client_id)); if(c){setRendDetIni(r.id);setRendEdit(r);setRendEntityIds([]);setRendNav(null);setRendicionClient(c)}}} detInicial={rendDetIni} onDetInicialUsado={()=>setRendDetIni(null)} onEliminarBorr={handleEliminarBorrador}
            onSolicitar={(c,monto,resp)=>onSolicitarFondos&&onSolicitarFondos(c,null,monto||null,resp||null)} onOpenMovBanco={onOpenMovBanco} onOpenClientFicha={onOpenClientFicha}/></div>
        }
        if(rendSub==='pend'){
          return wrap(<>
            <div style={{fontSize:12,color:C.muted,margin:'0 2px 10px'}}>Clientes con gastos sin rendir hace más de 90 días · <b style={{color:C.text}}>{fmt(pend90Tot)}</b></div>
            {pend90.length===0
              ? <div style={{color:C.greenText,textAlign:'center',padding:24,fontSize:13,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12}}>Nada pendiente hace +90 días.</div>
              : <div style={{display:'flex',flexDirection:'column',gap:8}}>{pend90.map(r=>(
                  <div key={r.client.id} onClick={()=>{setRendEdit(null);setRendEntityIds([]);setRendicionClient(r.client)}} style={{display:'flex',alignItems:'center',gap:10,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',cursor:'pointer'}}>
                    <SIcon n='alert' s={17} c={C.soonText}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div onClick={e=>{e.stopPropagation();onOpenClientFicha&&onOpenClientFicha(r.client.id)}} style={{fontSize:13,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:onOpenClientFicha?'pointer':'default'}}>{r.client.name}</div>
                      <div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.n} gasto{r.n!==1?'s':''} sin rendir · más antiguo {r.dias} d</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmt(r.monto)}</div>
                      <div style={{fontSize:10,fontWeight:700,color:C.accent}}>Rendir <Gl n='chevron'/></div>
                    </div>
                  </div>
                ))}</div>}
          </>)
        }
        return wrap(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:isDesktop?12:8}}>
            <HubTile ic='receipt' bg={C.azulBg} col={C.accent} t='Rendir a cliente' s={txtBorr||'rendir, pedir y enviar'} sM={misBorr.arm>0?`${misBorr.arm} borrador${misBorr.arm!==1?'es':''}`:(txtBorr||'rendir y pedir')} onClick={()=>{setQ('');const hay=misBorr.arm>0||rendicionesEnCurso(clients,expenses).length>0;setRendGrupo(hay?'env':null);setRendAbg(null);setRendSub('rendir')}}/>
            <HubTile ic='tEspera' bg={C.soonBg} col={C.soonText} t='Esperando pago' s='fondos pedidos y su seguimiento' sM='fondos pedidos' onClick={()=>{setQ('');setRendGrupo('dep');setRendSub('rendir')}}/>
            <HubTile ic='clock' bg={C.azulBg} col={C.accent} t='Historial' s='rendiciones enviadas' sM='enviadas' onClick={()=>{setShowRendiciones(false);setRendSub(null);setHistTab('clientes');setShowHistorial(true)}}/>
            <HubTile ic='mail' bg={C.soonBg} col={C.soonText} t='Solicitar fondos' s='pedir provisión' onClick={()=>onSolicitarFondos&&onSolicitarFondos()}/>
          </div>
        )
      })()}

      {/* Vista "Gastos oficina": gastos varios que la oficina absorbe + personales del equipo por cobrar */}
      {showGastosOficina&&(()=>{
        const ofi = clients.find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||''))
        const ym = new Date().toISOString().slice(0,7)
        // Limited: solo ve los gastos de oficina que ÉL cargó (su lote de carga masiva) o registró (created_by). Admin ve todos.
        const misLotes = isAdmin ? null : new Set((bulkImports||[]).filter(b=>b.created_by===currentUserName).map(b=>String(b.id)))
        const mioOfi = e => isAdmin || (e.bulk_import_id && misLotes.has(String(e.bulk_import_id))) || e.created_by===currentUserName
        // Gastos varios de oficina: gastos del cliente interno (no fondo, no estructural histórico, no personal).
        const varios = ofi ? (expenses||[]).filter(e=>String(e.client_id)===String(ofi.id)&&e.type==='gasto'&&!e.deleted_at&&!e.personal_de&&!e.no_descuenta_saldo&&mioOfi(e)).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)) : []
        const variosMesTot = varios.filter(e=>(e.date||'').slice(0,7)===ym).reduce((a,e)=>a+(e.amount||0),0)
        // Personales del equipo: fondos por rendir − gastos = saldo por persona (un tercero puede aportar el fondo; el miembro lo rinde).
        const persGastos = (expenses||[]).filter(e=>e.type!=='fondo'&&e.personal_de&&!e.deleted_at&&!e.client_id)
        const persFondos = (expenses||[]).filter(e=>e.type==='fondo'&&e.personal_de&&!e.deleted_at&&!e.client_id)
        const pers = isAdmin ? persGastos : persGastos.filter(e=>e.personal_de===currentUserName)
        const persFon = isAdmin ? persFondos : persFondos.filter(e=>e.personal_de===currentUserName)
        const byP={}; pers.forEach(e=>{(byP[e.personal_de]=byP[e.personal_de]||[]).push(e)})
        const fonByP={}; persFon.forEach(e=>{(fonByP[e.personal_de]=fonByP[e.personal_de]||[]).push(e)})
        const personasP=[...new Set([...Object.keys(byP),...Object.keys(fonByP)])].sort((a,b)=>a.localeCompare(b,'es'))
        const gastosP=p=>(byP[p]||[]).filter(e=>!e.no_descuenta_saldo&&cuentaEnSaldo(e)).reduce((a,e)=>a+(e.amount||0),0)   // mismo criterio que fgCliente y dispPersona
        const fondosP=p=>(fonByP[p]||[]).filter(e=>cuentaEnSaldo(e)&&!e.no_descuenta_saldo).reduce((a,e)=>a+(e.amount||0),0)
        const persTot = pers.reduce((a,e)=>a+(e.amount||0),0)
        return (
        <div style={{padding:'4px 20px 100px',...(isDesktop?{maxWidth:900,margin:'0 auto'}:{})}}>
          {ofi&&varios.length>0&&<div onClick={()=>{setShowGastosOficina(false);setSelectedClient(ofi)}} style={{display:'flex',alignItems:'center',gap:6,marginBottom:12,cursor:'pointer',fontSize:12,fontWeight:600,color:C.accent}}><span style={{width:24,height:24,borderRadius:8,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><SIcon n='building' s={13} c={C.accent}/></span>Ver como ficha de oficina<span style={{color:C.textSoft}}>→</span></div>}
          {(varios.length===0&&personasP.length===0)&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Sin gastos de oficina.</div>}
          {/* Gastos varios oficina */}
          {varios.length>0&&(<>
            <div style={{display:'flex',alignItems:'center',gap:8,margin:'2px 2px 7px'}}>
              <span style={{width:24,height:24,borderRadius:8,background:C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><SIcon n='building' s={14} c={C.accent}/></span>
              <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.4px'}}>Gastos varios oficina{!isAdmin&&<span style={{fontWeight:600,textTransform:'none',letterSpacing:0,color:C.textSoft}}> · los que cargaste tú</span>}</span>
              <span style={{marginLeft:'auto',fontSize:11,color:C.muted}}>Este mes · <b style={{color:C.text}}>{fmt(variosMesTot)}</b></span>
            </div>
            <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:16}}>
              {varios.slice(0,40).map((e,i)=>(
                <div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
                  <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div><div style={{fontSize:10,color:C.muted}}>{e.date?fmtFechaDMY(e.date):''}{e.category?` · ${e.category}`:''}</div></div>
                  <span style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0}}>{fmt(e.amount)}</span>
                </div>
              ))}
              {varios.length>40&&<div style={{fontSize:11,color:C.muted,textAlign:'center',padding:'8px'}}>+{varios.length-40} gastos más</div>}
            </div>
          </>)}
          {/* Personales: saldo por persona = fondos por rendir − gastos */}
          {personasP.length>0&&(<>
            <div style={{display:'flex',alignItems:'center',gap:8,margin:'2px 2px 7px'}}>
              <span style={{width:24,height:24,borderRadius:8,background:C.ambarBg,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><SIcon n='wallet' s={14} c={C.soonText}/></span>
              <span style={{fontSize:11,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:'.4px'}}>Personales</span>
              <span style={{marginLeft:'auto',fontSize:11,color:C.muted}}>saldo = fondos − gastos</span>
            </div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
              {personasP.map((persona,gi)=>{ const pc=personChip(persona); const gs=byP[persona]||[]; const fs=fonByP[persona]||[]; const g=gastosP(persona); const fo=fondosP(persona); const saldo=fo-g; const op=showPersonales===persona; return (
                <div key={persona} style={{borderTop:gi?`1px solid ${C.track}`:'none'}}>
                  <div onClick={()=>setShowPersonales(op?false:persona)} style={{display:'flex',alignItems:'center',gap:8,padding:'11px 14px',cursor:'pointer',background:op?C.bgSoft:'#fff'}}>
                    <span style={{width:26,height:26,borderRadius:8,background:pc.bg,color:pc.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,flexShrink:0}}>{INICIALES_RESP[persona]||String(persona)[0]}</span>
                    <span style={{fontSize:13,fontWeight:700,color:C.text}}>{persona}</span>
                    <span style={{fontSize:10,color:C.muted,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>· {fo>0?`fondo ${fmtShort(fo)} · `:''}{gs.length} gasto{gs.length!==1?'s':''}</span>
                    <span style={{flex:1}}></span>
                    <span style={{textAlign:'right',flexShrink:0}}><span style={{fontSize:14,fontWeight:700,color:saldo>=0?C.greenText:C.overdueText}}>{fmt(saldo)}</span><div style={{fontSize:9,fontWeight:700,color:saldo>=0?C.greenText:C.overdueText}}>{saldo>=0?'disponible':'le debe'}</div></span>
                    <span style={{fontSize:12,color:C.textSoft,marginLeft:2}}>{op?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
                  </div>
                  {op&&<div style={{background:C.bgSoft}}>
                    {fs.map(e=>(
                      <div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 14px 8px 26px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
                        <span style={{fontSize:12,color:C.greenText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{e.concept||'Fondo por rendir'}</span>
                        <span style={{fontSize:13,fontWeight:600,color:C.greenText,flexShrink:0}}>+{fmt(e.amount)}</span>
                      </div>
                    ))}
                    {gs.map(e=>(
                      <div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 14px 8px 26px',borderTop:`1px solid ${C.track}`,cursor:'pointer'}}>
                        <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{e.concept||'—'}{e.ot_number?<span style={{fontSize:9,color:C.azulInfo,fontWeight:700,marginLeft:5}}>{String(e.ot_number).toUpperCase().startsWith('OT')?e.ot_number:'OT-'+e.ot_number}</span>:''}</span>
                        <span style={{fontSize:13,fontWeight:600,color:C.overdueText,flexShrink:0}}>−{fmt(e.amount)}</span>
                      </div>
                    ))}
                    <div style={{display:'flex',justifyContent:'space-between',gap:8,padding:'9px 14px 9px 26px',borderTop:`1px solid ${C.border}`}}>
                      <span style={{fontSize:12,fontWeight:700,color:C.accent}}>Saldo</span>
                      <span style={{fontSize:13,fontWeight:700,color:saldo>=0?C.greenText:C.overdueText}}>{fmt(saldo)} · {saldo>=0?'disponible':'por cubrir'}</span>
                    </div>
                  </div>}
                </div>
              )})}
            </div>
          </>)}
        </div>
        )
      })()}

      {/* Vista Notaría: pendientes de liquidar a la notaría + liquidaciones (historial) */}
      {showNotaria&&notaTab==='hub'&&(()=>{
        const D=isDesktop
        const cards=[
          {t:'Pagar', ic:'clock', s:notariaPend.length?`${notariaPend.length} OT · ${fmtShort(notaPendTotal)} por pagar`:'al día', sM:notariaPend.length?`${fmtShort(notaPendTotal)} · ${notariaPend.length} OT`:'al día', col:C.soonText, bg:C.ambarBg, go:()=>setNotaTab('pend')},
          {t:'Cobros', ic:'exchange', s:notaLedger.n?`${notaLedger.n} OT · ${fmtShort(notaLedger.total)}`:'lo que nos cobran', col:C.azulInfo, bg:C.azulBg, go:()=>{setCobrosQ('');setCobEst('');setCobMes('');setCobAnio('');setCobOpenM(null);setNotaTab('cobros')}},
          {t:'Historial', ic:'check', s:notaLiquidaciones.filter(notaPagada).length?`${notaLiquidaciones.filter(notaPagada).length} pago${notaLiquidaciones.filter(notaPagada).length!==1?'s':''} · ${fmtShort(notaLiquidaciones.filter(notaPagada).reduce((a,r)=>a+(r.total||0),0))}`:'sin pagos', col:C.greenText, bg:C.greenBg, go:()=>setNotaTab('pagados')},
          {t:'Carga masiva', ic:'file', s:'importar · correo', col:C.muted, bg:C.bgSoft, go:()=>{setShowNotaria(false);setHubOpen(false);setCargaOpen(null);setShowCargaPag(true)}},
        ]
        return (
          <div style={{padding:D?'8px 22px 44px':'6px 12px 30px',maxWidth:D?760:undefined,margin:'0 auto'}}>
            {(()=>{ const sinCli=notaGroups.sin||[]; if(!sinCli.length) return null; const diasDe=e=>e.created_at?Math.floor((Date.now()-new Date(e.created_at).getTime())/86400000):0; const venc=sinCli.filter(e=>diasDe(e)>=3); const alerta=venc.length>0; return (
              <div onClick={()=>setNotaTab('pend')} style={{cursor:'pointer',display:'flex',alignItems:'center',gap:11,background:alerta?C.overdueBg:C.soonBg,border:`1px solid ${alerta?'#F3C9C4':'#F0D88A'}`,borderRadius:12,padding:'10px 12px',marginBottom:12}}>
                <span style={{width:30,height:30,borderRadius:10,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><SIcon n='clock' s={16} c={alerta?C.overdueText:C.soonText}/></span>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:alerta?C.overdueText:C.soonText}}>{sinCli.length} OT sin identificar{alerta?` · ${venc.length} llevan +3 días`:''}</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Asígnales cliente para cargarlas a quien las paga{alerta?' — ya deberían estar resueltas':''}</div></div>
                <span style={{color:C.textSoft,fontSize:14}}><Gl n='chevron'/></span>
              </div>
            )})()}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:D?12:8}}>
              {cards.map(c=><HubTile key={c.t} ic={c.ic} t={c.t} s={c.s} sM={c.sM} col={c.col} bg={c.bg} onClick={c.go}/>)}
            </div>
            {/* Avisos como tarjetas hermanas bajo las 4: "No son nuestras" (roja si hay por resolver) y "Recordatorios" (bitácora del pedido de liquidación, días 15 y 30). */}
            {(()=>{ const nn=notaNoNuestras, hayNN=nn.items.length>0, rojo=nn.n>0
              // Con «No son nuestras» son tres tarjetas: Documentos toma la fila completa para que la grilla calce.
              const tile=(k,{ic,t,s,sM,bg,cardBg,cardBd,tCol,go},full)=><div key={k} style={{gridColumn:full?'1 / -1':undefined,minWidth:0}}><HubTile icNode={ic} t={t} s={s} sM={sM} bg={bg} cardBg={cardBg} cardBd={cardBd} tCol={tCol} onClick={go}/></div>
              return (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:D?12:8,marginTop:D?12:8}}>
                  {hayNN&&tile('nn',{t:'No son nuestras', s:rojo?`${nn.n} OT · ${nn.nPend>0?`${nn.nPend} por consultar`:'consultadas'}`:`${nn.resueltas.length} resuelta${nn.resueltas.length!==1?'s':''}`, sM:rojo?(nn.nPend>0?`${nn.nPend} por consultar`:`${nn.n} consultadas`):`${nn.resueltas.length} resuelta${nn.resueltas.length!==1?'s':''}`,
                    ic:<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={rojo?C.overdueText:C.muted} strokeWidth='1.9'><circle cx='12' cy='12' r='9'/><path d='M15 9l-6 6M9 9l6 6'/></svg>,
                    bg:rojo?C.surface:C.bgSoft, cardBg:rojo?C.overdueBg:undefined, cardBd:rojo?C.overdueText+'44':undefined, tCol:rojo?C.overdueText:undefined,
                    go:()=>{ setNoNSel(new Set(nn.items.filter(x=>x.estado==='pendiente').map(x=>x.id))); setNotaTab('nonuestras') }})}
                  <PedidosTile bulkImports={bulkImports} render={u=>tile('rec',{t:'Pedidos', s:u===undefined?'…':u?`${fmtFechaDMY(isoLocal(u.p.created_at))} · ${_PED_CHIP[u.estado][0].toLowerCase()}`:'días 15 y 30',
                    ic:<SIcon n='mail' s={17} c={u&&u.porSeguir?C.soonText:u&&u.estado==='rev'?C.azulInfo:C.muted}/>, bg:u&&u.porSeguir?C.soonBg:u&&u.estado==='rev'?C.azulBg:C.bgSoft, go:()=>setNotaTab('recordatorios')})}/>
                  <DocumentosNotariaTile render={rs=>{ const _v=(rs||[]).filter(d=>!_esWord(d)), nG=_v.filter(d=>d.estado==='guardado').length, nP=_v.filter(d=>['por_clasificar','pendiente_ot','error','asignado'].includes(d.estado)).length
                    return tile('docs',{t:'Documentos', s:rs===null?'…':nP?`${nG} guardados · ${nP} por asignar`:`${nG} guardados`, sM:rs===null?'…':nP?`${nP} por asignar`:`${nG} guardados`,
                      ic:<SIcon n='file' s={17} c={nP?C.soonText:C.muted}/>, bg:nP?C.soonBg:C.bgSoft, go:()=>{setDocSub(null);setNotaTab('documentos')}},hayNN) }}/>
                </div>) })()}
          </div>
        )
      })()}
      {/* Vista "Cobros": ledger de lo que la notaría nos cobra (por carga masiva o por OT) + errores + CSV */}
      {showNotaria&&notaTab==='cobros'&&(()=>{
        // Cobros = cada OT que la notaría nos cobra (notaLedger, fuente única). Foto con estados que filtran + buscador/Mes/Año + meses plegables.
        const D=isDesktop
        const cnOf = e => clients.find(c=>String(c.id)===String(e.client_id))?.name || (e.personal_de?`Personal · ${e.personal_de}`:'Sin cliente')
        const EST={porpagar:['Por pagar',C.soonText,C.soonBg],enliq:['En liquidación',C.azulInfo,C.azulBg],pagada:['Pagada',C.greenText,C.greenBg],err:['Con error',C.overdueText,C.overdueBg]}
        const _n=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        const qq=_n(cobrosQ.trim())
        const base=notaLedger.rows.filter(r=>{ const d=String(r.e.date||''); if(cobAnio&&d.slice(0,4)!==cobAnio) return false; if(cobMes&&d.slice(5,7)!==cobMes) return false
          return !qq||_n(`${r.e.ot_number||''} ${fmtOt(r.e.ot_number)} ${r.e.concept||''} ${cnOf(r.e)}`).includes(qq) })
        const sum=a=>a.reduce((t,r)=>t+(r.e.amount||0),0)
        const de=k=>k==='err'?base.filter(r=>r.err):base.filter(r=>r.estado===k)
        const rows=(cobEst?de(cobEst):base).slice().sort((x,y)=>String(y.e.date||'').localeCompare(String(x.e.date||'')))
        const groups=[]; const gi={}
        rows.forEach(r=>{ const mk=String(r.e.date||'').slice(0,7)||'sin'; if(gi[mk]==null){ gi[mk]=groups.length; groups.push({mk,rows:[],tot:0}) } const g=groups[gi[mk]]; g.rows.push(r); g.tot+=(r.e.amount||0) })
        const iSin=groups.findIndex(g=>g.mk==='sin'); if(iSin>=0) groups.push(groups.splice(iSin,1)[0])
        const mesLbl = mk => { if(mk==='sin'||!/^\d{4}-\d{2}/.test(mk)) return 'Sin fecha'; const [y,m]=mk.split('-'); return mesTitulo(new Date(Number(y),Number(m)-1,1)) }
        const filtrando=!!(qq||cobEst||cobMes)
        const abierto=mk=>filtrando||(cobOpenM?cobOpenM.has(mk):mk===groups[0]?.mk)
        const toggleM=mk=>setCobOpenM(p=>{ const n=new Set(p||(groups[0]?[groups[0].mk]:[])); n.has(mk)?n.delete(mk):n.add(mk); return n })
        const anios=[...new Set(notaLedger.rows.map(r=>String(r.e.date||'').slice(0,4)).filter(Boolean))].sort().reverse()
        const csvRows = () => { const head=['Fecha','OT','Cliente','Concepto','Monto','Estado','Error']; return [head,...rows.map(r=>[fmtFechaDMY(r.e.date)||'', r.e.ot_number||'', cnOf(r.e), r.e.concept||'', r.e.amount||0, EST[r.estado][0], r.err==='sincliente'?'Sin cliente':r.err==='dup'?'Posible duplicado':''])] }
        const chip=k=><span style={{fontSize:9.5,fontWeight:700,color:EST[k][1],background:EST[k][2],borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{EST[k][0]}</span>
        const fila=(r,i)=>{ const e=r.e; const errTxt=r.err==='sincliente'?'Sin cliente':r.err==='dup'?'Posible duplicado':null; return (
          <div key={e.id} onClick={onEdit?()=>onEdit(e):undefined} style={{display:'flex',alignItems:'center',gap:12,padding:D?'9px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:onEdit?'pointer':'default'}}>
            {diaGrande(e.date)}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:r.err==='sincliente'?C.overdueText:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.client_id&&onOpenClientFicha?<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha(e.client_id)}}>{cnOf(e)}</span>:cnOf(e)}</div>
              <div style={{fontSize:11.5,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b style={{color:errTxt?C.overdueText:C.azulInfo,fontWeight:700}}>{fmtOt(e.ot_number)||'s/OT'}</b>{errTxt?<span style={{color:C.overdueText,fontWeight:600}}> · {errTxt}</span>:(D&&e.concept)?` · ${e.concept}`:''}</div>
            </div>
            {D&&chip(r.estado)}
            <div style={{flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
              <span style={{fontSize:13.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:D?90:undefined,textAlign:'right'}}>{fmt(e.amount)}</span>
              {!D&&chip(r.estado)}
            </div>
            {D&&onEdit&&<span style={{fontSize:14,color:C.textSoft,flexShrink:0}}><Gl n='chevron'/></span>}
          </div>) }
        const selSty={fontSize:12,fontWeight:500,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:'5px 10px',cursor:'pointer',outline:'none',flexShrink:0}
        const MESES=[['','Mes'],['01','ene'],['02','feb'],['03','mar'],['04','abr'],['05','may'],['06','jun'],['07','jul'],['08','ago'],['09','sep'],['10','oct'],['11','nov'],['12','dic']]
        const estTile=k=>{ const rs=de(k); if(!rs.length&&k!=='porpagar'&&k!=='pagada') return null; const on=cobEst===k; const [l,col,bg]=EST[k]; return (
          <div key={k} onClick={()=>setCobEst(on?'':k)} style={{flex:1,minWidth:0,background:bg,borderRadius:10,padding:'8px 11px',cursor:'pointer',boxShadow:on?`0 0 0 1.5px ${col}`:'none'}}>
            <div style={{fontSize:9.5,fontWeight:700,color:col,textTransform:'uppercase',letterSpacing:.4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l} · {rs.length}</div>
            <div style={{fontSize:14,fontWeight:700,color:col,marginTop:1,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmtShort(sum(rs))}</div>
          </div>) }
        return (
          <div style={{padding:D?'8px 22px 44px':'6px 12px 30px',maxWidth:D?820:undefined,margin:'0 auto'}}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span style={{...SEC_LBL}}>Cobrado por la notaría{cobAnio?` en ${cobAnio}`:''}</span>
                {rows.length>0&&<button onClick={()=>csvDownload('cobros_notaria.csv',csvRows())} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Exportar ↓</button>}
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:25,fontWeight:800,color:C.text,letterSpacing:-.5,fontVariantNumeric:'tabular-nums'}}>{fmt(sum(base))}</span><span style={{fontSize:12,color:C.muted}}>· {base.length} OT</span></div>
              <div style={{display:'grid',gridTemplateColumns:`repeat(${['porpagar','enliq','pagada','err'].filter(k=>de(k).length||k==='porpagar'||k==='pagada').length},minmax(0,1fr))`,gap:8,marginTop:12}}>{['porpagar','enliq','pagada','err'].map(estTile)}</div>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}>
              <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px'}}>
                <SIcon n='search' s={14} c={C.done}/>
                <input value={cobrosQ} onChange={e=>setCobrosQ(e.target.value)} placeholder='Buscar OT, cliente o trámite' style={{border:'none',background:'none',outline:'none',fontSize:12,color:C.text,width:'100%',minWidth:0}}/>
              </div>
              <select value={cobMes} onChange={e=>setCobMes(e.target.value)} style={selSty}>{MESES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
              <select value={cobAnio} onChange={e=>setCobAnio(e.target.value)} style={selSty}><option value=''>Año</option>{anios.map(a=><option key={a} value={a}>{a}</option>)}</select>
            </div>
            {notaLedger.n===0&&<div style={{color:C.muted,textAlign:'center',padding:30,fontSize:13,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>Sin cobros de notaría cargados.</div>}
            {notaLedger.n>0&&rows.length===0&&<div style={{color:C.muted,textAlign:'center',padding:24,fontSize:13,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>Nada calza con el filtro.</div>}
            {groups.map(g=>{ const op=abierto(g.mk); return (
              <div key={g.mk} style={{marginBottom:op?12:8}}>
                <div onClick={()=>!filtrando&&toggleM(g.mk)} style={{display:'flex',alignItems:'center',gap:8,padding:'2px 2px 6px',cursor:filtrando?'default':'pointer'}}>
                  {!filtrando&&<span style={{fontSize:13,color:C.textSoft,transform:op?'rotate(90deg)':'none',transition:'transform .15s'}}><Gl n='chevron'/></span>}
                  <span style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5,flex:1}}>{mesLbl(g.mk)}</span>
                  <span style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap'}}>{g.rows.length} OT</span>
                  <span style={{fontSize:12,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:76,textAlign:'right'}}>{fmt(g.tot)}</span>
                </div>
                {op&&<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{g.rows.map(fila)}</div>}
              </div>) })}
          </div>
        )
      })()}
      {/* Vista "No son nuestras": OT no reconocidas acumuladas de las cargas — se consultan a la notaría cuando quieras (no solo en la carga) */}
      {showNotaria&&notaTab==='recordatorios'&&(
        <div style={{padding:isDesktop?'8px 22px 44px':'6px 12px 30px',maxWidth:isDesktop?760:undefined,margin:'0 auto'}}>
          <PedidosNotaria isDesktop={isDesktop} bulkImports={bulkImports} onRevisar={arch=>onBulk&&onBulk(true,arch)}/>
        </div>
      )}
      {showNotaria&&notaTab==='documentos'&&(
        <div style={{padding:isDesktop?'8px 22px 44px':'6px 12px 30px',maxWidth:isDesktop?1100:undefined,margin:'0 auto'}}>
          <DocumentosNotaria isDesktop={isDesktop} clients={clients} clientEntities={clientEntities} expenses={expenses} user={currentUser} onOpenClientFicha={onOpenClientFicha} sub={docSub} setSub={setDocSub}/>
        </div>
      )}
      {showNotaria&&notaTab==='nonuestras'&&(()=>{
        // OT que no son nuestras (render aprobado 2026-10-08): se guardan completas por N° de OT, con historial; resolver NO las borra.
        // Botones: UN solo estilo (nb) — mismo alto (34), tipografía (12.5/600), radio y alineación en toda la vista; el CTA del panel 38.
        const D=isDesktop
        const NN=notaNoNuestras
        const _n=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
        const qq=_n(noNQ.trim())
        const match=x=>!qq||_n(`${x.ot} ${x.materia} ${x.requirente} ${x.concepto}`).includes(qq)
        const activos=NN.activos.filter(match), resueltas=NN.resueltas.filter(match)
        const sel=NN.activos.filter(x=>noNSel.has(x.id))
        const selTot=sel.reduce((a,x)=>a+(x.monto||0),0)
        const nb=(v='ghost',extra={})=>({minHeight:34,padding:'0 13px',borderRadius:8,fontSize:12.5,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,
          ...(v==='pri'?{background:C.accent,color:'#fff',border:`1px solid ${C.accent}`}:v==='ok'?{background:C.greenText,color:'#fff',border:`1px solid ${C.greenText}`}:{background:C.surface,color:C.accent,border:`1px solid ${C.border}`}),...extra})
        const lblK={fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}
        const ln=(l,v,col)=><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,fontSize:12,padding:'2px 0'}}><span style={{color:col||C.muted,fontWeight:col?600:400}}>{l}</span><span style={{color:C.text,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>
        const estPill=x=>{ const t=x.estado==='resuelta'?(x.resolucion==='era_nuestra'?'Era nuestra · cargada':'Respondida'):x.estado==='consultada'?`Consultada ${x.consultadaAt?fmtFechaDMY(String(x.consultadaAt).slice(0,10)):''}`:'Por consultar'
          const st=x.estado==='resuelta'?{bg:C.greenBg,c:C.greenText}:x.estado==='consultada'?{bg:C.soonBg,c:C.soonText}:{bg:C.overdueBg,c:C.overdueText}
          return <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:st.bg,color:st.c,whiteSpace:'nowrap'}}>{t}</span> }
        const ACC={marcada:'Marcada como no nuestra',volvio:'Volvió en otra liquidación',consultada:'Consultada a la notaría',era_nuestra:'Sí era nuestra · gasto cargado',respondida:'La notaría respondió',reabierta:'Volvió a la revisión'}
        const toggleSel=x=>setNoNSel(p=>{ const n=new Set(p); n.has(x.id)?n.delete(x.id):n.add(x.id); return n })
        const GRID=D?'18px 100px minmax(0,1fr) 150px 32px':'18px minmax(0,1fr) auto 32px'
        const detalle=x=>{ const kv=(l,v)=>v?<div style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:12,padding:'4px 0',borderBottom:`0.5px solid ${C.track}`}}><span style={{color:C.muted,flexShrink:0}}>{l}</span><span style={{fontWeight:600,color:C.text,textAlign:'right',minWidth:0}}>{v}</span></div>:null
          const hist=[...(x.historial||[])].sort((a,b)=>String(a.at).localeCompare(String(b.at)))
          const gasto=x.expense_id?(expenses||[]).find(e=>String(e.id)===String(x.expense_id)):null
          return (
          <div style={{background:C.bgSoft,borderTop:`0.5px solid ${C.border}`,padding:D?'12px 14px 14px 41px':'12px 13px 14px'}}>
            <div style={{display:'grid',gridTemplateColumns:D?'1fr 1fr':'1fr',gap:D?18:12}}>
              <div>
                <div style={{...lblK,marginBottom:4}}>Datos de la OT</div>
                {kv('OT',x.ot)}{kv('Fecha',x.fecha?fmtFechaDMY(String(x.fecha).slice(0,10)):'—')}{kv('Materia',x.materia)}{kv('Requirente',x.requirente)}{kv('Concepto',x.concepto)}{kv('Subconcepto',x.subconcepto)}{kv('Monto',fmt(x.monto))}
                {(x.cargas||[]).map((c,i)=><Fragment key={i}>{kv(i===0?'Vino en':'',`${c.filename||'Carga'}${c.fecha?` · ${fmtFechaDMY(String(c.fecha).slice(0,10))}`:''}`)}</Fragment>)}
              </div>
              <div>
                <div style={{...lblK,marginBottom:4}}>Historial</div>
                {!hist.length&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Marcada como no nuestra en la carga.</div>}
                {hist.map((h,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:12,padding:'4px 0',borderBottom:`0.5px solid ${C.track}`}}><span style={{minWidth:0}}><b style={{fontWeight:600}}>{ACC[h.accion]||h.detalle||h.accion}</b>{h.por?<span style={{color:C.muted}}> · {h.por}</span>:null}</span><span style={{color:C.muted,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtFechaDMY(String(h.at||'').slice(0,10))}</span></div>)}
              </div>
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
              {x.estado!=='resuelta'
                ? <><button onClick={()=>resolverNoNuestra(x,'era_nuestra')} style={nb('ok')}>Sí era nuestra · cargar gasto</button><button onClick={()=>resolverNoNuestra(x,'respondida')} style={nb()}>La notaría respondió</button></>
                : <><button onClick={()=>reabrirNoNuestra(x)} style={nb()}>Volver a la revisión</button>{gasto&&onEdit&&<button onClick={()=>onEdit(gasto)} style={nb()}>Ver gasto</button>}</>}
            </div>
          </div>) }
        const fila=x=>{ const on=noNSel.has(x.id), open=noNOpen===x.id, res=x.estado==='resuelta'
          return (
          <Fragment key={x.id}>
            <div onClick={()=>setNoNOpen(open?null:x.id)} style={{display:'grid',gridTemplateColumns:GRID,columnGap:10,rowGap:2,alignItems:'center',padding:D?'8px 8px 8px 13px':'9px 6px 9px 12px',borderTop:`0.5px solid ${C.border}`,cursor:'pointer',background:on?C.azulBg:C.surface}}>
              <span onClick={e=>{ e.stopPropagation(); if(!res) toggleSel(x) }} style={{...(D?{}:{gridRow:'1 / 3'}),width:18,height:18,borderRadius:6,border:`1.5px solid ${res?C.border:(on?C.accent:C.done)}`,background:on?C.accent:'transparent',display:'inline-flex',alignItems:'center',justifyContent:'center',cursor:res?'default':'pointer'}}>{on?<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>:null}</span>
              {D ? <>
                <span style={{minWidth:0}}><span style={{display:'block',fontSize:12,fontWeight:700,color:C.azulInfo,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{x.ot}</span><span style={{display:'block',fontSize:11,color:C.muted,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{x.fecha?fmtFechaDMY(String(x.fecha).slice(0,10)):'sin fecha'}</span></span>
                <span style={{minWidth:0}}><span style={{display:'block',fontSize:12.5,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.materia||x.concepto||'—'}</span>{x.requirente&&<span style={{display:'block',fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.requirente}</span>}</span>
                <span style={{textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}><span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(x.monto)}</span>{estPill(x)}</span>
              </> : <>
                <span style={{gridColumn:2,gridRow:1,fontSize:13,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.materia||x.concepto||'—'}</span>
                <span style={{gridColumn:2,gridRow:2,fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b style={{color:C.azulInfo,fontWeight:700}}>{x.ot}</b>{x.fecha?` · ${fmtFechaDMY(String(x.fecha).slice(0,10))}`:''}</span>
                <span style={{gridColumn:3,gridRow:1,fontSize:13,fontWeight:700,color:C.text,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmt(x.monto)}</span>
                <span style={{gridColumn:3,gridRow:2,justifySelf:'end'}}>{estPill(x)}</span>
              </>}
              <span style={{...(D?{}:{gridColumn:4,gridRow:'1 / 3'}),display:'inline-flex',justifyContent:'center',transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><SIcon n='chevron' s={14} c={C.done}/></span>
            </div>
            {open&&detalle(x)}
          </Fragment>) }
        const hero=(
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
            <div style={{...lblK,color:C.overdueText}}>No son nuestras</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:12,color:C.muted}}>{NN.items.length} OT</span><span style={{fontSize:22,fontWeight:800,color:C.overdueText,letterSpacing:-.4,fontVariantNumeric:'tabular-nums'}}>{fmt(NN.totTodo)}</span></div>
            <div style={{borderTop:`1px solid ${C.track}`,paddingTop:6,marginTop:6}}>
              {ln('Por consultar',fmt(NN.totPend),C.overdueText)}{ln('Consultadas',fmt(NN.totCons),C.soonText)}{ln('Resueltas',fmt(NN.totRes),C.greenText)}
            </div>
          </div>)
        const consultar=(
          <div style={{background:sel.length?C.azulBg:C.surface,border:`1px solid ${sel.length?C.accent:C.border}`,borderRadius:12,padding:'11px 13px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:13,fontWeight:700,color:sel.length?C.accent:C.muted}}>{sel.length} seleccionada{sel.length!==1?'s':''}</span><span style={{fontSize:15,fontWeight:800,color:sel.length?C.accent:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(selTot)}</span></div>
            <div style={{display:'flex',gap:8,marginTop:9}}>
              <button onClick={()=>setNoNSel(sel.length===NN.activos.length?new Set():new Set(NN.activos.map(x=>x.id)))} style={nb('ghost',{flex:1,minHeight:38})}>{sel.length===NN.activos.length&&sel.length?'Ninguna':'Todas'}</button>
              <button disabled={noNSending||!sel.length} onClick={()=>consultarNoNuestras(sel.map(x=>({...x,motivo:x.materia,nombre:x.requirente})))} style={nb('pri',{flex:2,minHeight:38,opacity:(noNSending||!sel.length)?.55:1,cursor:(noNSending||!sel.length)?'default':'pointer'})}>{noNSending?'Enviando…':`Consultar a la notaría${sel.length?` (${sel.length})`:''}`}</button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:7,lineHeight:1.4}}>Va a {cleanNotaDest(notaEmail)||NOTARIA_DEFAULT}, dirigido a {NOTA_DIRIGIDO}, con la oficina en copia.{NN.ultConsulta?` Última consulta: ${fmtFechaDMY(String(NN.ultConsulta).slice(0,10))}.`:''}</div>
          </div>)
        const bit=<BitacoraLista prefijo='notaria.nonuestra' titulo='Bitácora' limite={8} vacio='Aún no hay registros.' etiquetas={{'notaria.nonuestra_registradas':'Registradas desde la carga','notaria.nonuestra_consultada':'Consultada a la notaría','notaria.nonuestra_era_nuestra':'Sí era nuestra · gasto cargado','notaria.nonuestra_respondida':'La notaría respondió','notaria.nonuestra_reabierta':'Volvió a la revisión'}}/>
        const lista=(
          <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:10}}>
            <Buscador value={noNQ} onChange={setNoNQ} placeholder='Buscar OT, requirente o materia…'  />
            <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:C.surface}}>
              {D&&<div style={{display:'grid',gridTemplateColumns:GRID,columnGap:10,padding:'7px 8px 7px 13px',background:C.bgSoft,...lblK}}><span/><span>OT · fecha</span><span>Materia · requirente</span><span style={{textAlign:'right'}}>Monto · estado</span><span/></div>}
              {activos.length===0&&<div style={{color:C.greenText,textAlign:'center',padding:'22px 16px',fontSize:13}}>{qq?`Ninguna OT calza con "${noNQ.trim()}".`:'Sin OT por consultar · todo consultado o resuelto.'}</div>}
              {activos.map(fila)}
            </div>
            {resueltas.length>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',background:C.surface}}>
              <div onClick={()=>setNoNResOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:9,padding:'10px 13px',background:C.bgSoft,cursor:'pointer'}}>
                <span style={{display:'inline-flex',transform:(noNResOpen||qq)?'rotate(90deg)':'none',transition:'transform .15s'}}><SIcon n='chevron' s={13} c={C.muted}/></span>
                <span style={{fontSize:13,fontWeight:700,color:C.text}}>Resueltas · {resueltas.length}</span>
                <span style={{fontSize:11,color:C.muted,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>quedan con su resolución</span>
                <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(resueltas.reduce((a,x)=>a+(x.monto||0),0))}</span>
              </div>
              {(noNResOpen||qq)&&resueltas.map(fila)}
            </div>}
            {!D&&bit}
          </div>)
        return (
          <div style={{padding:D?'8px 20px 44px':'6px 12px 30px',maxWidth:D?1240:undefined,margin:'0 auto'}}>
            {D
              ? <div style={{display:'flex',gap:18,alignItems:'flex-start'}}>{lista}<div style={{width:300,flexShrink:0,position:'sticky',top:12,display:'flex',flexDirection:'column',gap:10}}>{hero}{consultar}{bit}</div></div>
              : <div style={{display:'flex',flexDirection:'column',gap:10}}>{hero}{NN.activos.length>0&&consultar}{lista}</div>}
          </div>
        )
      })()}
      {/* Vista "Pagos realizados": liquidaciones a la notaría con detalle clickeable + CSV */}
      {showNotaria&&notaTab==='pagados'&&(()=>{
        // Pagos realizados (= liquidaciones a la notaría; reemplaza Historial › Notaría): foto + filtros + meses con subtotal.
        const D=isDesktop
        const _n=t=>String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        const qq=_n(pagQ.trim())
        const gsDe=r=>(expenses||[]).filter(e=>String(e.notaria_render_id)===String(r.id))
        const cliN=cid=>clients.find(c=>String(c.id)===String(cid))?.name||''
        const okF=r=>{ const ca=isoLocal(r.created_at); if(pagAnio&&ca.slice(0,4)!==pagAnio) return false; if(pagMes&&ca.slice(5,7)!==pagMes) return false
          if(qq&&!_n(`${r.periodo||''} ${r.user_name||''} ${r.ot_numbers||''} ${gsDe(r).map(e=>`${e.ot_number||''} ${cliN(e.client_id)} ${e.personal_de||''}`).join(' ')}`).includes(qq)) return false; return true }
        const dirMul = pagosOrd==='nuevo'?1:-1
        const list=[...notaLiquidaciones].filter(okF).sort((a,b)=>dirMul*String(b.created_at||'').localeCompare(String(a.created_at||'')))
        const tot=list.filter(notaPagada).reduce((a,r)=>a+(r.total||0),0)   // pagado = enviado con comprobante, marcado pagado o enlazado al cargo; lo «por enviar» aún no se transfiere
        const nPorEnv=list.filter(r=>!notaPagada(r)).length
        const groups=[]; const gi={}
        list.forEach(r=>{ const mk=isoLocal(r.created_at).slice(0,7)||'sin'; if(gi[mk]==null){ gi[mk]=groups.length; groups.push({mk,rows:[],tot:0}) } const g=groups[gi[mk]]; g.rows.push(r); if(notaPagada(r)) g.tot+=(r.total||0) })   // mismo criterio que el total: los meses suman al total
        const mesLbl = mk => { if(mk==='sin'||!/^\d{4}-\d{2}/.test(mk)) return 'Sin fecha'; const [y,m]=mk.split('-'); return mesTitulo(new Date(Number(y),Number(m)-1,1)) }
        const anios=[...new Set(notaLiquidaciones.map(r=>isoLocal(r.created_at).slice(0,4)).filter(Boolean))].sort().reverse()
        const csvRows=()=>{ const head=['Fecha','Periodo','Total','Estado','N OT','OT','Quién','Cargo en banco']; const body=list.map(r=>[fmtFechaDMY(isoLocal(r.created_at))||'', r.periodo||'', r.total||0, notaEstado(r)==='por_enviar'?'Por enviar':'Pagada', r.n_gastos||0, r.ot_numbers||'', r.user_name||'', r.movimiento_id?'Sí':'No']); return [head,...body] }
        const chip=r=>{ const pe=!notaPagada(r); return <span style={{fontSize:9.5,fontWeight:700,color:pe?C.soonText:C.greenText,background:pe?C.soonBg:C.greenBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{pe?'Por enviar':'Pagada'}</span> }
        const fila = (r,i) => { const open=notaLiqOpen===r.id; const gs=gsDe(r); const adding=notaLiqAdd===r.id; const est=notaEstado(r); return (
          <div key={r.id} style={{borderTop:i?`1px solid ${C.track}`:'none'}}>
            <div onClick={()=>setNotaLiqOpen(open?null:r.id)} style={{display:'flex',alignItems:'center',gap:12,padding:D?'10px 14px':'10px 12px',cursor:'pointer'}}>
              {diaGrande(isoLocal(r.created_at))}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{BRAND.notaria}</div>
                <div style={{fontSize:11.5,color:C.muted,marginTop:1,whiteSpace:'nowrap'}}>{r.n_gastos||gs.length} OT{r.user_name?` · ${r.user_name}`:''}</div>
              </div>
              {D&&chip(r)}
              <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:D?96:undefined,textAlign:'right'}}>{fmt(r.total)}</span>
                {!D&&chip(r)}
              </div>
              <span style={{fontSize:14,color:C.muted,transform:open?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><Gl n='chevron'/></span>
            </div>
            {open&&<div style={{padding:D?'10px 14px 12px':'10px 12px 12px',background:C.bgSoft,borderTop:`1px solid ${C.track}`}}>
              <div onClick={r.movimiento_id&&onOpenMovBanco?()=>onOpenMovBanco(r.movimiento_id):undefined} style={{display:'flex',alignItems:'baseline',gap:8,fontSize:12,padding:'0 0 8px',marginBottom:6,borderBottom:`1px solid ${C.border}`,cursor:r.movimiento_id&&onOpenMovBanco?'pointer':'default'}}>
                <span style={{color:r.movimiento_id?C.text:C.muted,fontWeight:r.movimiento_id?600:400}}>{r.movimiento_id?'Cargo en el banco de la oficina':'Sin cargo en el banco de la oficina'}</span>
                {r.movimiento_id&&onOpenMovBanco&&<span style={{marginLeft:'auto',color:C.azulInfo,fontWeight:600,whiteSpace:'nowrap'}}>Ver en Banco <Gl n='chevron'/></span>}
              </div>
              {gs.map(e=>{ const cn=cliN(e.client_id)||(e.personal_de?`Personal · ${e.personal_de}`:'Sin cliente'); return (
                <div key={e.id} onClick={onEdit?()=>onEdit(e):undefined} style={{display:'flex',alignItems:'baseline',gap:8,padding:'5px 0',fontSize:12,cursor:onEdit?'pointer':'default'}}>
                  <span style={{fontSize:11,color:C.azulInfo,fontWeight:700,width:66,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtOt(e.ot_number)}</span>
                  <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{e.client_id&&onOpenClientFicha?<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha(e.client_id)}} style={{cursor:'pointer',fontWeight:600}}>{cn}</span>:<b style={{fontWeight:600}}>{cn}</b>}<span style={{color:C.muted}}> · {e.concept||'—'}</span></span>
                  <span style={{fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:C.text}}>{fmt(e.amount)}</span>
                </div>) })}
              <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
                <button onClick={()=>descargarExcelNota(r)} style={{fontSize:10,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>↓ Excel</button>
                {est==='por_enviar'&&<button onClick={()=>{abrirEnvioNotaria(r)}} style={{fontSize:10,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>Enviar</button>}
                {est==='enviada'&&<button onClick={()=>reenviarNotaria(r)} disabled={reenviando===r.id} style={{fontSize:10,fontWeight:700,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:6,padding:'4px 10px',cursor:reenviando===r.id?'default':'pointer',opacity:reenviando===r.id?.6:1}}>{reenviando===r.id?'Reenviando…':'Reenviar'}</button>}
                {r.comprobante_url&&<a href={r.comprobante_url} target='_blank' rel='noreferrer' style={{fontSize:10,fontWeight:600,color:C.azulInfo,textDecoration:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 10px'}}>Ver comprobante</a>}
                {notariaPend.length>0&&<button onClick={()=>{setNotaLiqAdd(adding?null:r.id);setAddSel(new Set());setAddSearch('');setAddOpenCli(new Set())}} style={{fontSize:10,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>{adding?'Cerrar':'Añadir OT'}</button>}
                <button onClick={()=>deshacerNotaria(r)} style={{fontSize:10,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer'}}>Anular</button>
              </div>
              {adding&&addPicker(r)}
            </div>}
          </div>
        )}
        const selSty={fontSize:12,fontWeight:500,color:C.muted,background:C.surface,border:`1px solid ${C.border}`,borderRadius:20,padding:'5px 10px',cursor:'pointer',outline:'none',flexShrink:0}
        const MESES=[['','Mes'],['01','ene'],['02','feb'],['03','mar'],['04','abr'],['05','may'],['06','jun'],['07','jul'],['08','ago'],['09','sep'],['10','oct'],['11','nov'],['12','dic']]
        const nest=(lbl,val,bg,col,go)=><div onClick={go} style={{flex:1,minWidth:0,background:bg,borderRadius:10,padding:'8px 11px',cursor:go?'pointer':'default'}}><div style={{fontSize:9.5,fontWeight:700,color:col,textTransform:'uppercase',letterSpacing:.4,whiteSpace:'nowrap'}}>{lbl}</div><div style={{fontSize:14,fontWeight:700,color:col,marginTop:1,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{val}</div></div>
        return (
          <div style={{padding:D?'8px 22px 44px':'6px 12px 30px',maxWidth:D?820:undefined,margin:'0 auto'}}>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span style={{...SEC_LBL}}>Pagado a la notaría{pagAnio?` en ${pagAnio}`:''}</span>
                {list.length>0&&<button onClick={()=>csvDownload('pagos_notaria.csv',csvRows())} style={{fontSize:12,fontWeight:600,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0,whiteSpace:'nowrap'}}>Exportar ↓</button>}
              </div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:25,fontWeight:800,color:C.greenText,letterSpacing:-.5,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span><span style={{fontSize:12,color:C.muted}}>· {list.length-nPorEnv} pago{list.length-nPorEnv!==1?'s':''}</span></div>
              {(notaPendTotal>0||nPorEnv>0)&&<div style={{display:'flex',gap:8,marginTop:12}}>
                {notaPendTotal>0&&nest('Por pagar',fmt(notaPendTotal),C.tealBg,C.tealText,()=>setNotaTab('pend'))}
                {nPorEnv>0&&nest('Por enviar',`${nPorEnv} pago${nPorEnv!==1?'s':''}`,C.soonBg,C.soonText)}
              </div>}
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}>
              <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px'}}>
                <SIcon n='search' s={14} c={C.done}/>
                <input value={pagQ} onChange={e=>setPagQ(e.target.value)} placeholder='Buscar OT, cliente o quién' style={{border:'none',background:'none',outline:'none',fontSize:12,color:C.text,width:'100%',minWidth:0}}/>
              </div>
              <select value={pagMes} onChange={e=>setPagMes(e.target.value)} style={selSty}>{MESES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
              <select value={pagAnio} onChange={e=>setPagAnio(e.target.value)} style={selSty}><option value=''>Año</option>{anios.map(a=><option key={a} value={a}>{a}</option>)}</select>
            </div>
            {list.length===0&&<div style={{color:C.muted,textAlign:'center',padding:30,fontSize:13,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>{notaLiquidaciones.length?'Nada calza con el filtro.':'Sin pagos registrados.'}</div>}
            {groups.map(g=>(
              <div key={g.mk} style={{marginBottom:12}}>
                <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',margin:'0 2px 6px'}}>
                  <span onClick={()=>setPagosOrd(o=>o==='nuevo'?'antiguo':'nuevo')} title='Cambiar orden' style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5,cursor:'pointer'}}>{mesLbl(g.mk)}</span>
                  <span style={{fontSize:12,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(g.tot)}</span>
                </div>
                <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{g.rows.map(fila)}</div>
              </div>
            ))}
          </div>
        )
      })()}
      {showNotaria&&notaTab==='pend'&&(()=>{
        // Deuda notaría (render aprobado 2026-10-08): buscador + OT en su columna (› abre el gasto) + panel lateral fijo en escritorio
        // (Pendiente · Seleccionadas · Pagar con UNA confirmación en el mismo panel · Agrupar/filtros · Bitácora). Móvil: panel arriba, lista abajo.
        const _n = t => String(t||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
        const qq = _n(notaQ.trim())
        const cliName = cid => clients.find(c=>String(c.id)===String(cid))?.name||'Cliente'
        const matchE = (e,extra='') => !qq || _n(`${e.ot_number||''} ${fmtOt(e.ot_number)} ${e.concept||''} ${extra}`).includes(qq)
        // Partes del total: con fondo + adelanta oficina (clientes) + sin fondo de cliente (personal y sin asignar) = Pendiente a notaría
        // Personales: lo que cubre el fondo de esa persona cuenta como "con fondo"; el resto queda sin fondo.
        let sinFondoT=notaGroups.sin.reduce((a,e)=>a+(e.amount||0),0)
        let conFondoT=0,adelantoT=0; Object.entries(notaGroups.byClient).forEach(([cid,gs])=>{ const ap=gs.reduce((a,e)=>a+(e.amount||0),0); const d=dispCliente(cid).disp; conFondoT+=Math.min(ap,d); adelantoT+=Math.max(0,ap-d) })
        Object.entries(notaGroups.personal).forEach(([persona,gs])=>{ const cb=coberturaPersona(persona,gs); conFondoT+=cb.con; sinFondoT+=Math.max(0,cb.ap-cb.con) })
        const asumeT=notaGroups.asume.reduce((a,e)=>a+(e.amount||0),0)
        // Selección: cuánto se paga con el fondo de cada cliente vs cuánto adelanta la oficina — total y por abogado (misma lógica de antes).
        const selByCli={}; notaSel.forEach(e=>{ const k=e.incobrable_at?'__asume__':(e.client_id||(e.personal_de?'p:'+e.personal_de:'__none__')); selByCli[k]=(selByCli[k]||0)+(e.amount||0) })
        let conFondo=0, adelanto=0, asumeSel=0; const porAbg={}
        Object.entries(selByCli).forEach(([cid,sel])=>{ if(cid==='__asume__'){ asumeSel+=sel; return } const d=cid.startsWith('p:')?coberturaPersona(cid.slice(2),notaSel.filter(e=>!e.client_id&&!e.incobrable_at&&e.personal_de===cid.slice(2))).con:dispCliente(cid).disp; const con=Math.min(sel,d), ade=Math.max(0,sel-d); conFondo+=con; adelanto+=ade; const resp=cid.startsWith('p:')?`Personal · ${cid.slice(2)}`:cid==='__none__'?'Sin cliente':esOficina(cid)?'Oficina':(clients.find(c=>String(c.id)===String(cid))?.abogado_responsable||'Sin abogado'); const o=porAbg[resp]=porAbg[resp]||{con:0,ade:0}; o.con+=con; o.ade+=ade })
        const abgs=Object.entries(porAbg).sort((a,b)=>(b[1].con+b[1].ade)-(a[1].con+a[1].ade))
        const D=isDesktop
        const lblK={fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}
        const ln=(l,v,col)=><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,fontSize:12,padding:'2px 0'}}><span style={{color:col||C.muted,fontWeight:col?600:400}}>{l}</span><span style={{color:col||C.text,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>
        // Partes del pendiente (tocables: filtran la lista). Conteos de quién está en cada parte.
        const cliEnt=Object.entries(notaGroups.byClient).map(([cid,gs])=>{ const ap=gs.reduce((a,e)=>a+(e.amount||0),0); const d=dispCliente(cid).disp; return {cid,ap,d} })
        const perEnt=Object.entries(notaGroups.personal).map(([persona,gs])=>{ const cb=coberturaPersona(persona,gs); return {persona,ap:cb.ap,d:cb.con} })
        const nCon=cliEnt.filter(x=>Math.min(x.ap,x.d)>0).length+perEnt.filter(x=>Math.min(x.ap,x.d)>0).length
        const nAdel=cliEnt.filter(x=>x.ap>x.d).length
        const perSin=perEnt.filter(x=>x.ap>x.d).map(x=>x.persona)
        const pctP=v=>notaPendTotal>0?Math.round(v/notaPendTotal*100)+'%':''
        // "Lo que tiene fondos": por cliente/persona, las OT más antiguas primero mientras alcance su disponible (salta las que no caben);
        // la oficina (Liberona Escala) e incobrables (asume la oficina) van completas. Misma regla de bloqueo que la selección manual.
        const pagables=(()=>{ const ids=[]; const byDate=(a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.ot_number||'').localeCompare(String(b.ot_number||''))
          const tomar=(gs,disp)=>{ let used=0; [...gs].sort(byDate).forEach(e=>{ if(disp===Infinity||used+(e.amount||0)<=disp){ used+=(e.amount||0); ids.push(e) } }) }
          Object.entries(notaGroups.byClient).forEach(([cid,gs])=>tomar(gs,dispCliente(cid).disp))
          Object.entries(notaGroups.personal).forEach(([persona,gs])=>coberturaPersona(persona,gs).pagables.forEach(e=>ids.push(e)))
          notaGroups.asume.forEach(e=>ids.push(e))
          return ids })()
        const pagablesT=pagables.reduce((a,e)=>a+(e.amount||0),0)
        const btnPagables = pagables.length>0 && (
          <button onClick={()=>{ setSelNota(new Set(pagables.map(e=>e.id))); setNotaConfirm(false); setDeudaEstF('sel'); setNotaCliOpen(new Set(pagables.map(e=>e.incobrable_at?'__asume__':e.client_id?String(e.client_id):e.personal_de?'p:'+e.personal_de:'__sinasignar__'))) }} title={`${pagables.length} OT: lo que cubre el fondo de cada cliente o persona, más lo de la oficina y lo que asume`} style={{width:'100%',minHeight:38,marginTop:10,borderRadius:9,border:`1px solid ${C.greenText}`,background:C.greenBg,color:C.greenText,fontSize:12.5,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'0 12px'}}>
            <span style={{whiteSpace:'nowrap'}}>Seleccionar con fondos</span><span style={{fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(pagablesT)}</span>
          </button>)
        const partes=[['con','Con saldo',conFondoT,C.greenText,`${nCon} con fondo para pagar`],['adel','Adelanta oficina',adelantoT,C.soonText,`${nAdel} cliente${nAdel!==1?'s':''} · pedir fondos`],...(sinFondoT>0?[['pers','Personal sin saldo',sinFondoT,C.muted,perSin.join(' · ')||'sin cliente asignado']]:[]),...(asumeT>0?[['asume','A cargo de la oficina',asumeT,C.grisText,`${notaGroups.asume.length} OT incobrable${notaGroups.asume.length!==1?'s':''}`]]:[])]
        const hero = (
          <div style={{background:C.tileBg,border:`1px solid ${C.tileLine}`,borderRadius:12,padding:'12px 14px'}}>
            <div style={{...lblK,color:C.accent}}>Pendiente a notaría</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:12,color:C.muted}}>{BRAND.notaria} · {notariaPend.length} OT</span><span style={{fontSize:24,fontWeight:800,color:C.accent,letterSpacing:-.5,fontVariantNumeric:'tabular-nums'}}>{fmt(notaPendTotal)}</span></div>
            {D
              ? <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:10}}>{partes.map(([k,l,v,col,sub])=>{ const on=deudaEstF===k; return (
                  <div key={k} onClick={()=>setDeudaEstF(f=>f===k?null:k)} style={{display:'flex',alignItems:'center',gap:10,border:`1px solid ${on?C.accent:C.tileLine}`,background:on?C.selBg:C.tileBg,borderRadius:10,padding:'7px 10px',cursor:'pointer'}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:700,color:col===C.muted?C.text:col}}>{l}</div><div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>
                    <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:14,fontWeight:800,color:col===C.muted?C.text:col,fontVariantNumeric:'tabular-nums'}}>{fmt(v)}</div><div style={{fontSize:10,color:C.muted}}>{pctP(v)}</div></div>
                  </div>) })}</div>
              : <div style={{borderTop:`1px solid ${C.track}`,paddingTop:6,marginTop:8}}>{partes.map(([k,l,v,col])=>{ const on=deudaEstF===k; return (
                  <div key={k} onClick={()=>setDeudaEstF(f=>f===k?null:k)} style={{display:'flex',alignItems:'center',gap:8,minHeight:30,padding:'0 6px',margin:'0 -6px',borderRadius:8,background:on?C.selBg:'transparent',cursor:'pointer'}}>
                    <span style={{width:7,height:7,borderRadius:'50%',background:col,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:12.5,fontWeight:on?700:600,color:col===C.muted?C.text:col}}>{l}</span>
                    <span style={{fontSize:10.5,color:C.muted}}>{pctP(v)}</span>
                    <span style={{fontSize:13,fontWeight:700,color:col===C.muted?C.text:col,fontVariantNumeric:'tabular-nums',minWidth:84,textAlign:'right'}}>{fmt(v)}</span>
                  </div>) })}</div>}
            {btnPagables}
          </div>)
        const selBox = selNota.size>0 && (
          <div style={{background:adelanto>0?C.overdueBg:C.tileBg,border:`1px solid ${adelanto>0?C.overdueText:C.accent}`,borderRadius:12,padding:'11px 13px'}}>
            <div style={{...lblK,color:adelanto>0?C.overdueText:C.accent}}>Seleccionadas</div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,marginTop:2}}><span style={{fontSize:13,fontWeight:700,color:adelanto>0?C.overdueText:C.accent}}>{selNota.size} OT</span><span style={{fontSize:16,fontWeight:800,color:adelanto>0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmt(notaTotal)}</span></div>
            {ln('Con saldo',fmt(conFondo),C.greenText)}
            {ln('Adelanto',fmt(adelanto),adelanto>0?C.overdueText:null)}
            {asumeSel>0&&ln('A cargo de la oficina',fmt(asumeSel))}
            {abgs.length>0&&<div style={{borderTop:'0.5px solid rgba(83,114,129,.25)',marginTop:6,paddingTop:6}}>
              <div style={{...lblK,marginBottom:2}}>Por responsable</div>
              {abgs.map(([resp,o])=><Fragment key={resp}>{ln(/^(Personal|Oficina|Sin )/.test(resp)?resp:String(resp).split(' ')[0],fmt(o.con+o.ade))}{o.ade>0&&<div style={{fontSize:10.5,color:C.overdueText,textAlign:'right',marginTop:-2}}>adelanto {fmt(o.ade)}</div>}</Fragment>)}
            </div>}
            {!notaConfirm
              ? <>
                  <button onClick={()=>setNotaConfirm(true)} style={{width:'100%',minHeight:38,marginTop:9,borderRadius:9,border:'none',background:adelanto>0?C.overdueText:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}>Pagar a la notaría · {fmt(notaTotal)}</button>
                  <div style={{fontSize:11,color:C.muted,marginTop:6,lineHeight:1.4}}>Guarda la liquidación y pasa a la página de envío, donde subes el comprobante.</div>
                </>
              : <div style={{marginTop:9,background:C.surface,borderRadius:9,padding:'10px 11px'}}>
                  <div style={{fontSize:12.5,color:C.text,lineHeight:1.45}}>Vas a pagar <b>{fmt(notaTotal)}</b> a la notaría{adelanto>0?<>: <b style={{color:C.greenText}}>{fmt(conFondo)}</b> con fondo y adelantas <b style={{color:C.overdueText}}>{fmt(adelanto)}</b> de la oficina</>:''}.</div>
                  <div style={{display:'flex',gap:8,marginTop:9}}>
                    <button onClick={()=>setNotaConfirm(false)} style={{flex:1,minHeight:38,borderRadius:9,border:`1px solid ${C.border}`,background:C.surface,color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                    <button disabled={notaSending} onClick={liquidarNotaria} style={{flex:2,minHeight:38,borderRadius:9,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:notaSending?'default':'pointer',opacity:notaSending?.6:1}}>{notaSending?'Guardando…':'Continuar'}</button>
                  </div>
                </div>}
          </div>)
        // Barra: buscador + selector de orden + selector de agrupar (mismo selector que Facturación; render aprobado 2026-10-15)
        const hayClientes=Object.keys(notaGroups.byClient).length>0
        const selS={fontSize:12.5,fontWeight:600,border:`1px solid ${C.border}`,borderRadius:10,height:40,boxSizing:'border-box',padding:'0 10px',background:C.surface,color:C.accent,cursor:'pointer',minWidth:0,...(D?{}:{width:'100%'})}   // mismo alto que el buscador
        const ORDS=[['monto|desc','Mayor monto'],['monto|asc','Menor monto'],['nombre|asc','Cliente A–Z'],['nombre|desc','Cliente Z–A'],['saldo|desc','Mayor disponible'],['saldo|asc','Menor disponible']]
        const selOrden=hayClientes&&<select value={`${deudaSort.col}|${deudaSort.dir}`} onChange={ev=>{ const [col,dir]=ev.target.value.split('|'); setDeudaSort({col,dir}) }} style={selS}>{ORDS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        const selGrupo=hayClientes&&<select value={deudaGroup} onChange={ev=>setDeudaGroup(ev.target.value)} style={selS}><option value='cliente'>Por cliente</option><option value='responsable'>Por abogado</option><option value='estado'>Por estado</option></select>
        const toolbar = D
          ? <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
              <div style={{flex:1,minWidth:200}}><Buscador value={notaQ} onChange={setNotaQ} placeholder='Buscar OT, cliente o trámite…' /></div>
              {selOrden}{selGrupo}
            </div>
          : <div>
              <Buscador value={notaQ} onChange={setNotaQ} placeholder='Buscar OT, cliente o trámite…' style={{marginBottom:8}} />
              {hayClientes&&<div style={{display:'flex',gap:8,marginBottom:8}}><div style={{flex:1,minWidth:0,display:'flex'}}>{selOrden}</div><div style={{flex:1,minWidth:0,display:'flex'}}>{selGrupo}</div></div>}
            </div>
        const bitacoraFull = <BitacoraLista prefijo='notaria.' titulo='Bitácora' limite={6} vacio='Aún no hay registros de notaría.' etiquetas={{'notaria.liquidada':'Liquidación guardada','notaria.liquidacion_anulada':'Liquidación anulada','notaria.personal':'Marcado personal','notaria.eliminado':'Gasto anulado eliminado','notaria.cliente_asignado':'Cliente asignado','notaria.recordatorio_liquidacion':'Recordatorio para pedir la liquidación','notaria.recordatorio_liquidacion_prueba':'Recordatorio de prueba','notaria.ajuste_auditoria':'Ajuste de revisión','notaria.ot_cargada':'OT cargada'}}/>
        const bitacora = deudaBitOpen
          ? <div><div onClick={()=>setDeudaBitOpen(false)} style={{fontSize:11,color:C.muted,textAlign:'right',cursor:'pointer',marginBottom:4}}>Ocultar bitácora</div>{bitacoraFull}</div>
          : <div onClick={()=>setDeudaBitOpen(true)} style={{background:C.tileBg,border:`1px solid ${C.tileLine}`,borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',cursor:'pointer'}}><span style={{...lblK,color:C.accent,flex:1}}>Bitácora</span><span style={{fontSize:12,color:C.muted}}>ver registros <Gl n='chevron'/></span></div>
        // ── Lista. Celdas comunes de la fila (escritorio: grilla NOTA_GC; móvil: dos líneas con el estado bajo la cifra).
        const colSaldo=(saldo,queda)=><div style={{textAlign:'right',minWidth:0}}><div style={{...SEC_LBL}}>Saldo</div><div style={{fontSize:12.5,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(saldo)}</div>{queda!=null&&<div style={{fontSize:10.5,color:C.muted,whiteSpace:'nowrap'}}>queda {fmt(queda)}</div>}</div>
        const colD=(k,v,col)=><div style={{textAlign:'right',minWidth:0}}><div style={{...SEC_LBL}}>{k}</div><div style={{fontSize:12.5,fontWeight:600,color:col||C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</div></div>
        const montoEst=(v,est)=><div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:D?15:14,fontWeight:800,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(v)}</div>{est&&<span style={{fontSize:9.5,borderRadius:20,padding:'2px 8px',fontWeight:700,whiteSpace:'nowrap',display:'inline-block',marginTop:3,background:est.bg,color:est.c}}>{est.l}</span>}</div>
        const nombreOT=(nodo,n)=><div style={{fontSize:14,fontWeight:700,color:C.accent,lineHeight:1.25,overflowWrap:'anywhere'}}>{nodo} <span style={{fontSize:11,fontWeight:500,color:C.textSoft,whiteSpace:'nowrap'}}>· {n} OT</span></div>   // nombre completo del cliente, nunca cortado (si no cabe, baja de línea)
        const filaCab=(open,onClick,nombre,sub,cols,derecha)=> D
          ? <div onClick={onClick} style={{display:'grid',gridTemplateColumns:NOTA_GC,columnGap:10,alignItems:'center',padding:'11px 14px',cursor:'pointer'}}>
              <span style={{display:'inline-flex',transform:open?'rotate(90deg)':'none',transition:'transform .15s'}}><SIcon n='chevron' s={13} c={C.muted}/></span>
              <div style={{minWidth:0}}>{nombre}<div style={{fontSize:11,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>{derecha}
            </div>
          : <div onClick={onClick} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer'}}>
              <span style={{display:'inline-flex',transform:open?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><SIcon n='chevron' s={13} c={C.muted}/></span>
              <div style={{flex:1,minWidth:0}}>{nombre}<div style={{fontSize:11,color:C.muted,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div></div>
              {derecha}
            </div>
        const clientCard=(cid,gsAll)=>{
          const {fondo:fondosC, reservado:reservadoC, disp, asumido, oficina:esOf}=dispCliente(cid)
          const aPagar=gsAll.reduce((a,e)=>a+(e.amount||0),0)
          const exc=excepNota.has(cid)
          const cn=cliName(cid)
          const gs = qq ? gsAll.filter(e=>matchE(e,cn)) : gsAll
          const cubre=disp>=aPagar, sinF=disp<=0
          const est = exc?{l:'Con adelanto',bg:C.overdueBg,c:C.overdueText}:sinF?{l:'Sin saldo',bg:C.overdueBg,c:C.overdueText}:cubre?{l:'Con saldo',bg:C.greenBg,c:C.greenText}:{l:'Parcial',bg:C.ambarBg,c:C.soonText}
          const deficit=Math.max(0,aPagar-disp)   // sin línea de déficit (redundante con el monto y el chip); rojo solo en el chip
          const open = !!qq || notaCliOpen.has(cid)
          return (
          <div key={cid} style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:8,background:C.surface}}>
            {filaCab(open,()=>setNotaCliOpen(p=>{const n=new Set(p);n.has(cid)?n.delete(cid):n.add(cid);return n}),
              nombreOT(onOpenClientFicha?<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha(cid)}} style={{cursor:'pointer'}}>{cn}</span>:cn, qq?`${gs.length} de ${gsAll.length}`:gsAll.length),
              esOf?<>Oficina · gasto propio</>:<>Disponible <b style={{color:disp>0?C.text:C.overdueText,fontWeight:600}}>{fmt(disp)}</b>{asumido>0&&<> · {fmt(asumido)} de la oficina</>}</>,   // lo que tiene para pagar estas OT (fondo − lo ya gastado); la ficha muestra el saldo después de pagarlas
              esOf?colD('Oficina','gasto propio',C.muted):colSaldo(disp,deficit>0?null:disp-aPagar),
              montoEst(aPagar,esOf?null:est))}
            {open&&<div>
              {(!cubre||exc)&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'6px 13px',borderTop:`1px solid ${C.border}`}}><span style={{fontSize:12,color:exc?C.overdueText:C.muted,fontWeight:exc?600:400}}>Oficina cubre la diferencia{exc?' · activado':''}</span><Switch on={exc} onToggle={()=>setExcepNota(p=>{const n=new Set(p);n.has(cid)?n.delete(cid):n.add(cid);return n})}/></div>}
              {gs.map(e=>{ const on=selNota.has(e.id); const usadoOtros=gsAll.filter(x=>x.id!==e.id&&selNota.has(x.id)).reduce((a,x)=>a+(x.amount||0),0); const excede=(usadoOtros+(e.amount||0)) > disp; return notaRow(e, !on&&!exc&&excede, exc&&excede, notaQ) })}
            </div>}
          </div>)
        }
        const allEntries=Object.entries(notaGroups.byClient).map(([cid,gs])=>{
          const {disp}=dispCliente(cid); const aPagar=gs.reduce((a,e)=>a+(e.amount||0),0); const exc=excepNota.has(cid)
          const conF=disp>0; const porFondos=!(notaFondos&&!conF&&!exc)
          const cubre=disp>=aPagar, sinF=disp<=0
          const estKey=exc?'adelanto':sinF?'sinfondos':cubre?'cubre':'parcial'
          const resp=clients.find(c=>String(c.id)===String(cid))?.abogado_responsable||'__sin__'
          const hit=!qq||gs.some(e=>matchE(e,cliName(cid)))
          return {cid,gs,porFondos,hit,estKey,resp,aPagar,disp,sal:saldoCliente(expenses,cid),nom:cliName(cid)}
        })
        const sKey={nombre:e=>e.nom.toLowerCase(),monto:e=>e.aPagar,saldo:e=>e.disp,ot:e=>e.gs.length}[deudaSort.col]||(e=>e.aPagar)
        const sDir=deudaSort.dir==='asc'?1:-1
        const pasaEst=e=>!deudaEstF||(deudaEstF==='sel'?e.gs.some(x=>selNota.has(x.id)):deudaEstF==='con'?e.disp>0:deudaEstF==='adel'?e.aPagar>e.disp:false)
        const entries=allEntries.filter(e=>e.porFondos&&e.hit&&pasaEst(e)).sort((a,b)=>{ const x=sKey(a),y=sKey(b); return (typeof x==='string'?x.localeCompare(y,'es'):x-y)*sDir })
        const ocultasFondos=qq?allEntries.filter(e=>!e.porFondos&&e.hit).reduce((a,e)=>a+e.gs.filter(x=>matchE(x,cliName(e.cid))).length,0):0
        const listaClientes=(()=>{
          if(deudaGroup==='cliente') return entries.map(e=>clientCard(e.cid,e.gs))
          const groups={}; entries.forEach(e=>{ const gk=deudaGroup==='responsable'?e.resp:e.estKey; (groups[gk]=groups[gk]||[]).push(e) })
          const ESTLBL={cubre:'Con saldo',parcial:'Parcial',sinfondos:'Sin saldo · adelanta la oficina',adelanto:'Con adelanto activado'}
          const order=deudaGroup==='responsable'
            ? Object.keys(groups).sort((a,b)=>groups[b].reduce((s,e)=>s+e.aPagar,0)-groups[a].reduce((s,e)=>s+e.aPagar,0))
            : ['sinfondos','adelanto','parcial','cubre'].filter(k=>groups[k])
          return order.map(gk=>{
            const arr=groups[gk]; const tot=arr.reduce((s,e)=>s+e.aPagar,0); const nOT=arr.reduce((s,e)=>s+e.gs.length,0)
            const open=!!qq||!deudaGrpOpen.has(gk)
            const label=deudaGroup==='responsable'?(gk==='__sin__'?'Sin abogado':gk):(ESTLBL[gk]||gk)
            return (
              <div key={gk} style={{marginBottom:8}}>
                <div onClick={()=>setDeudaGrpOpen(p=>{const n=new Set(p);n.has(gk)?n.delete(gk):n.add(gk);return n})} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 13px',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:open?'12px 12px 0 0':12,cursor:'pointer'}}>
                  <span style={{display:'inline-flex',transform:open?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><SIcon n='chevron' s={12} c={C.accent}/></span>
                  <span style={{...SEC_LBL,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
                  <span style={{fontSize:11,color:C.textSoft,flexShrink:0}}>{arr.length} cliente{arr.length!==1?'s':''} · {nOT} OT</span>
                  <span style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span>
                </div>
                {open&&<div style={{border:`1px solid ${C.border}`,borderTop:'none',borderRadius:'0 0 12px 12px',padding:'8px 8px 1px'}}>{arr.map(e=>clientCard(e.cid,e.gs))}</div>}
              </div>)
          })
        })()
        const personales=!notaResp?Object.entries(notaGroups.personal).map(([persona,gsAll])=>{ const gs=qq?gsAll.filter(e=>matchE(e,persona)):gsAll; if(qq&&!gs.length) return null; if(deudaEstF==='sel'){ if(!gsAll.some(x=>selNota.has(x.id))) return null } else if(deudaEstF){ const cbF=coberturaPersona(persona,gsAll), dd=cbF.con, tt=cbF.ap; if(deudaEstF==='adel'||deudaEstF==='asume'||(deudaEstF==='con'&&!(dd>0))||(deudaEstF==='pers'&&!(tt>dd))) return null } const pc=personChip(persona); const k='p:'+persona; const open=!!qq||notaCliOpen.has(k); const tot=gsAll.reduce((a,e)=>a+(e.amount||0),0); const cbP=coberturaPersona(persona,gsAll), dP=cbP.disp; const sinFP=cbP.con<=0, cubreP=cbP.con>=tot; return (
          <div key={persona} style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:8,background:C.surface}}>
            {(()=>{ const defP=Math.max(0,tot-dP); const estP=sinFP?{l:'Sin saldo',bg:C.overdueBg,c:C.overdueText}:cubreP?{l:'Con saldo',bg:C.greenBg,c:C.greenText}:{l:'Parcial',bg:C.ambarBg,c:C.soonText}; return filaCab(open,()=>setNotaCliOpen(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n}),
              nombreOT(<>Personal · <span style={{color:pc.color,fontWeight:800}}>{persona}</span></>,gsAll.length),
              <>Disponible <b style={{color:dP>0?C.text:C.overdueText,fontWeight:600}}>{fmt(dP)}</b></>,
              colSaldo(dP,defP>0?null:dP-tot),
              montoEst(tot,estP)) })()}
            {open&&<div>{gs.map(e=>notaRow(e,false,false,notaQ))}</div>}
          </div>)}):null
        const asGs=(qq?notaGroups.asume.filter(e=>matchE(e,cliName(e.client_id))):notaGroups.asume)
        const asumeBlock=!notaResp&&asGs.length>0&&(!deudaEstF||deudaEstF==='asume'||(deudaEstF==='sel'&&asGs.some(x=>selNota.has(x.id))))&&(()=>{ const k='__asume__'; const open=!!qq||notaCliOpen.has(k); return (
          <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:8,background:C.surface}}>
            {filaCab(open,()=>setNotaCliOpen(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n}),
              nombreOT('A cargo de la oficina',notaGroups.asume.length),
              <>Incobrables · no se cobran al cliente</>,
              colD('Paga','la oficina',C.muted),
              montoEst(asumeT,null))}
            {open&&<div>{asGs.map(e=><div key={e.id}><div style={{fontSize:11,fontWeight:700,color:C.accent,padding:D?'7px 14px 0 42px':'7px 12px 0 40px',borderTop:`0.5px solid ${C.border}`}}>{onOpenClientFicha?<span onClick={()=>onOpenClientFicha(e.client_id)} style={{cursor:'pointer'}}>{cliName(e.client_id)}</span>:cliName(e.client_id)}</div>{notaRow(e,false,false,notaQ)}</div>)}</div>}
          </div>) })()
        const sinGs=qq?notaGroups.sin.filter(e=>matchE(e)):notaGroups.sin
        const sinBlock=!notaResp&&sinGs.length>0&&(!deudaEstF||deudaEstF==='pers'||(deudaEstF==='sel'&&sinGs.some(x=>selNota.has(x.id))))&&(()=>{ const k='__sinasignar__'; const open=!!qq||notaCliOpen.has(k); const tot=notaGroups.sin.reduce((a,e)=>a+(e.amount||0),0); return (
          <div style={{border:`1px dashed ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:8,background:C.surface}}>
            <div onClick={()=>setNotaCliOpen(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n})} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',cursor:'pointer'}}>
              <span style={{display:'inline-flex',transform:open?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}><SIcon n='chevron' s={13} c={C.muted}/></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>Sin cliente ni persona</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>Asígnales cliente o márcalos como personal · {notaGroups.sin.length} OT</div></div>
              <div style={{fontSize:13,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</div>
            </div>
            {open&&<div>{sinGs.map(e=>(
              <div key={e.id} style={{padding:'10px 12px',borderTop:`0.5px solid ${C.border}`}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
                  <div style={{minWidth:0,fontSize:12.5,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.azulInfo,fontWeight:700}}>{fmtOt(e.ot_number)}</b> · {e.concept||'—'} <span style={{color:C.muted,fontSize:11}}>· {e.date?fmtFechaDMY(e.date):'sin fecha'}</span></div>
                  <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(e.amount)}</span>
                </div>
                <div style={{marginTop:7,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  {onAssignClientToExpense&&<div style={{flex:'1 1 200px',minWidth:0}}><AsignarClienteInline bill={{id:e.id}} clients={clients} label='Asignar cliente' placeholder='Buscar cliente…' onAssign={async(_,cid)=>{ try{ await onAssignClientToExpense(e.id,cid); logActividad('notaria.cliente_asignado',{tabla:'expenses',id:e.id,detalle:{name:cliName(cid),title:[fmtOt(e.ot_number),e.concept].filter(Boolean).join(' · '),monto:e.amount}}) }catch(err){ appAlert('No se pudo asignar: '+(err.message||err)) } }}/></div>}
                  <span style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase'}}>o personal</span>
                  {PERSONAS_NOTA.map(p=>{ const pc=personChip(p); return <button key={p} onClick={()=>marcarPersonal(e,p)} style={{fontSize:11,background:pc.bg,color:pc.color,border:'none',borderRadius:12,minHeight:30,padding:'0 11px',fontWeight:600,cursor:'pointer'}}>{p}</button> })}
                </div>
              </div>
            ))}</div>}
          </div>)})()
        const anulados=!qq&&notariaAnulados.length>0&&(
          <div style={{border:`1px dashed ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:8}}>
            <div onClick={()=>setNotaAnulOpen(o=>!o)} style={{padding:'9px 13px',background:C.bgSoft,display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
              <span style={{fontSize:12,fontWeight:700,color:C.muted}}>Anulados · orden notaría <span style={{fontWeight:400,color:C.textSoft}}>· {notariaAnulados.length}</span></span>
              <span style={{fontSize:11,color:C.textSoft}}>{notaAnulOpen?'Ocultar':'no se liquidan · ver'}</span>
            </div>
            {notaAnulOpen&&notariaAnulados.map(e=>{ const cn=clients.find(c=>c.id===e.client_id)?.name||(e.personal_de?`Personal · ${e.personal_de}`:'Sin asignar'); return (
              <div key={e.id} style={{padding:'9px 13px',display:'flex',alignItems:'center',gap:10,borderTop:`0.5px solid ${C.border}`}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.azulInfo,fontWeight:700}}>{fmtOt(e.ot_number)}</b> · {e.concept||'—'}</div><div style={{fontSize:10.5,color:C.textSoft}}>{cn} · {e.date?fmtFechaDMY(e.date):'sin fecha'}</div></div>
                <span style={{fontSize:12,color:C.textSoft,fontVariantNumeric:'tabular-nums'}}>{fmt(e.amount)}</span>
                <button onClick={()=>eliminarGastoNota(e)} style={{fontSize:11,color:C.overdueText,background:C.overdueBg,border:'none',borderRadius:8,minHeight:30,padding:'0 10px',fontWeight:600,cursor:'pointer'}}>Eliminar</button>
              </div>
            )})}
          </div>)
        const nada = !entries.length && !(personales||[]).some(Boolean) && !sinBlock && !asumeBlock
        const lista = (
          <div style={{flex:1,minWidth:0}}>
            {!D&&toolbar}
            {deudaEstF&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:C.accent,background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:'6px 11px',marginBottom:8}}><span style={{flex:1}}>Mostrando: {deudaEstF==='sel'?`Seleccionadas · ${selNota.size} OT`:partes.find(x=>x[0]===deudaEstF)?.[1]}</span><button onClick={()=>setDeudaEstF(null)} style={{border:'none',background:'none',color:C.accent,fontWeight:700,fontSize:12,cursor:'pointer',minHeight:28}}>Ver todo</button></div>}
            {ocultasFondos>0&&<div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:C.soonText,background:C.soonBg,borderRadius:9,padding:'7px 11px',marginBottom:8}}><span style={{flex:1}}>{ocultasFondos} OT más calzan, ocultas por el filtro de saldo.</span><button onClick={()=>setNotaFondos(false)} style={{border:'none',background:'none',color:C.accent,fontWeight:700,fontSize:12,cursor:'pointer',minHeight:30}}>Ver todos</button></div>}
            {notariaPend.length===0&&notariaAnulados.length===0&&<div style={{color:C.muted,textAlign:'center',padding:30,fontSize:13}}>No hay gastos de notaría pendientes de liquidar.</div>}
            {qq&&nada&&!ocultasFondos&&<div style={{color:C.muted,textAlign:'center',padding:24,fontSize:13}}>Ninguna OT calza con "{notaQ.trim()}".</div>}
            {listaClientes}
            {personales}
            {sinBlock}
            {asumeBlock}
            {anulados}
            {!D&&<div style={{marginTop:12}}>{bitacora}</div>}
          </div>)
        return (
          <div style={{padding:D?'8px 20px 130px':'4px 16px 130px',maxWidth:D?1240:undefined,margin:'0 auto'}}>
            {D
              ? <>{toolbar}<div style={{display:'flex',gap:18,alignItems:'flex-start'}}>
                  {lista}
                  <div style={{width:290,flexShrink:0,position:'sticky',top:12,display:'flex',flexDirection:'column',gap:10}}>{hero}{selBox}{bitacora}</div>
                </div></>
              : <div style={{display:'flex',flexDirection:'column',gap:10}}>{hero}{selBox}{lista}</div>}
          </div>)
      })()}
      {/* Modal "Enviar a notaría": FUERA del bloque notaTab==='pend' para que se monte al setNotaSend desde CUALQUIER
          pestaña (Pagos realizados / hub). Antes vivía dentro de 'pend' → el botón Enviar de "Pagos realizados" no abría nada. */}
      {/* PÁGINA "Pagar a la notaría" (no modal): comprobante + borrador editable + boletas a nombre de + envío, con confirmaciones. */}
      {showNotaria&&notaTab==='enviar'&&notaSend&&(()=>{
        const gsS=(expenses||[]).filter(e=>String(e.notaria_render_id)===String(notaSend.id))
        const totS=gsS.reduce((a,e)=>a+(e.amount||0),0)
        const dest=cleanNotaDest(notaEmail)
        const clientesLiq=[...new Set(gsS.map(e=>e.client_id).filter(Boolean))]
        const entsLiq=clientesLiq.flatMap(cid=>(clientEntities||[]).filter(e2=>String(e2.client_id)===String(cid)))
        const esEstudio = (notaBolRS||'')===BRAND.nombreLegal
        const inp={width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:13,background:'#fff',color:C.text,boxSizing:'border-box',outline:'none'}
        const confirmarEnviar=async()=>{ if(!compFile){appAlert('Adjunta el comprobante de transferencia.');return} if(!dest){appAlert('Falta el correo de la notaría.');return}
          if(!await appConfirm(`¿Enviar a la notaría (${dest}) el aviso de pago de ${gsS.length} OT por ${fmt(totS)} con tu comprobante, pidiendo emitir las boletas a nombre de ${notaBolRS} · ${notaBolRUT}? La oficina queda en copia.`)) return
          await enviarNotaria(notaSend); setNotaTab('pagados') }
        const guardarDespues=async()=>{ if(!await appConfirm('¿Guardar como pendiente de enviar? Todavía NO se avisa a la notaría; el correo lo mandas desde "Pagos realizados" cuando tengas el comprobante.')) return; setNotaSend(null); setNotaTab('pagados') }
        const marcarSinCorreo=async()=>{ if(!await appConfirm('¿Marcar esta liquidación como YA PAGADA, sin enviar correo? La notaría NO recibe aviso — solo para OT que ya pagaste antes.')) return; try{ const {error}=await supabase.from('rendiciones').update({estado_envio:'pagado'}).eq('id',notaSend.id); if(error) throw error; const hoyN=new Date().toISOString(); await supabase.from('expenses').update({notaria_liquidado_at:hoyN}).eq('notaria_render_id',notaSend.id).is('notaria_liquidado_at',null); setExpenses(p=>p.map(e=>String(e.notaria_render_id)===String(notaSend.id)&&!e.notaria_liquidado_at?{...e,notaria_liquidado_at:hoyN}:e)); if(setRendiciones) setRendiciones(p=>p.map(x=>x.id===notaSend.id?{...x,estado_envio:'pagado'}:x)); logActividad('notaria.liquidacion_pagada_sin_correo',{tabla:'rendiciones',id:notaSend.id,detalle:{title:`${notaSend.n_gastos||0} OT · ${notaSend.periodo||''}`,monto:notaSend.total}}) }catch(err){ appAlert('No se pudo marcar como pagada: '+(err.message||err)); return }; setNotaSend(null); setNotaTab('pagados') }   // antes el error se tragaba en silencio y la pantalla la mostraba pagada igual
        return (
        <div style={{padding:isDesktop?'8px 20px 70px':'6px 16px 70px',maxWidth:isDesktop?680:undefined,margin:'0 auto'}}>
          <div style={{background:C.accent,borderRadius:12,padding:'13px 16px',color:'#fff',textAlign:'center',marginBottom:14}}>
            <div style={{fontSize:10,color:C.onNavyLabel,textTransform:'uppercase',letterSpacing:.5}}>Total a transferir</div>
            <div style={{fontSize:25,fontWeight:700,letterSpacing:-.5,marginTop:2,fontVariantNumeric:'tabular-nums'}}>{fmt(totS)}</div>
            <div style={{fontSize:10,color:'#9FE1CB',marginTop:3}}>{notaSend.n_gastos||gsS.length} OT · {BRAND.notaria}</div>
          </div>

          <label style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,display:'block',marginBottom:5}}>Comprobante de transferencia</label>
          {compFile
            ? <div style={{display:'flex',alignItems:'center',gap:9,border:'1px solid #9FE1CB',background:C.greenBg,borderRadius:10,padding:'9px 11px',marginBottom:14}}><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/><polyline points='9 15 11 17 15 13'/></svg><span style={{flex:1,minWidth:0,fontSize:11,fontWeight:600,color:C.greenText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{compFile.name}</span><button onClick={()=>setCompFile(null)} style={{background:'none',border:'none',color:C.textSoft,fontSize:15,cursor:'pointer',lineHeight:1}}><Gl n='x'/></button></div>
            : <label style={{border:`1.5px dashed ${C.muted}`,borderRadius:10,background:C.bgPanel,padding:14,textAlign:'center',color:C.muted,fontSize:11,display:'flex',flexDirection:'column',alignItems:'center',gap:6,cursor:'pointer',marginBottom:14}}>
                <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>
                <span>Toca para subir el comprobante del banco (imagen o PDF)</span>
                <input type='file' accept='image/*,application/pdf' onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; if(!f) return; if(f.size>15*1024*1024){ appAlert('El archivo supera 15 MB.'); return } setCompFile(f) }} style={{display:'none'}}/>
              </label>}

          <label style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,display:'block',marginBottom:5}}>Correo de la notaría <span style={{color:C.accent}}>· editable</span></label>
          <input value={notaEmail} onChange={e=>setNotaEmail(e.target.value)} placeholder='notaria@...' style={{...inp,height:36,marginBottom:14}}/>

          <div style={{border:`1px solid ${C.accent}44`,background:C.azulBg,borderRadius:11,padding:11,marginBottom:14}}>
            <div style={{fontSize:10,color:C.accent,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,marginBottom:7}}>Boletas a nombre de</div>
            <div style={{display:'flex',gap:6,marginBottom:9}}>
              <button onClick={()=>{setNotaBolPick(false);aplicarBoletas(BRAND.nombreLegal,BRAND.rut)}} style={{flex:1,fontSize:12,fontWeight:600,borderRadius:8,padding:'7px',cursor:'pointer',border:`1px solid ${esEstudio?C.accent:C.border}`,background:esEstudio?C.accent:'#fff',color:esEstudio?'#fff':C.muted}}>La oficina</button>
              <button onClick={()=>{ if(entsLiq.length===1){ aplicarBoletas(entsLiq[0].name,entsLiq[0].rut||''); setNotaBolPick(false) } else setNotaBolPick(v=>!v) }} style={{flex:1,fontSize:12,fontWeight:600,borderRadius:8,padding:'7px',cursor:'pointer',border:`1px solid ${!esEstudio?C.accent:C.border}`,background:!esEstudio?C.accent:'#fff',color:!esEstudio?'#fff':C.muted}}>El cliente{entsLiq.length>1?<>{" "}<Gl n='chevD'/></>:''}</button>
            </div>
            {notaBolPick&&entsLiq.length>0&&<div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:9}}>{entsLiq.map(en=>(<button key={en.id} onClick={()=>{aplicarBoletas(en.name,en.rut||'');setNotaBolPick(false)}} style={{textAlign:'left',border:`1px solid ${C.border}`,background:'#fff',borderRadius:8,padding:'7px 10px',cursor:'pointer',fontSize:12.5,color:C.text}}>{en.name}<span style={{color:C.muted}}> · {en.rut||'sin RUT'}</span></button>))}</div>}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <input value={notaBolRS} onChange={e=>aplicarBoletas(e.target.value,notaBolRUT)} placeholder='Razón social' style={{...inp,height:34}}/>
              <input value={notaBolRUT} onChange={e=>aplicarBoletas(notaBolRS,e.target.value)} placeholder='RUT' style={{...inp,height:34}}/>
            </div>
          </div>

          <label style={{fontSize:10,color:C.muted,fontWeight:600,textTransform:'uppercase',letterSpacing:.5,display:'block',marginBottom:5}}>Mensaje <span style={{color:C.accent}}>· editable</span></label>
          <textarea value={notaMsg} onChange={e=>setNotaMsg(e.target.value)} rows={9} style={{...inp,resize:'vertical',lineHeight:1.5,fontFamily:'inherit',marginBottom:6}}/>
          <div style={{fontSize:10.5,color:C.muted,marginBottom:16,display:'flex',alignItems:'center',gap:5}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2'><line x1='8' y1='6' x2='21' y2='6'/><line x1='8' y1='12' x2='21' y2='12'/><line x1='8' y1='18' x2='21' y2='18'/><line x1='3' y1='6' x2='3.01' y2='6'/><line x1='3' y1='12' x2='3.01' y2='12'/><line x1='3' y1='18' x2='3.01' y2='18'/></svg>El detalle de las {gsS.length} OT y el total se anexan solos al correo, junto con el comprobante.</div>

          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button disabled={notaSending||!compFile||!dest} onClick={confirmarEnviar} style={{flex:2,minWidth:200,height:46,borderRadius:11,border:'none',background:C.accent,color:'#fff',fontSize:14,fontWeight:700,cursor:(notaSending||!compFile||!dest)?'default':'pointer',opacity:(notaSending||!compFile||!dest)?.5:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{notaSending?<Spin/>:<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><line x1='22' y1='2' x2='11' y2='13'/><polygon points='22 2 15 22 11 13 2 9 22 2'/></svg>}{notaSending?'Enviando…':'Enviar aviso a la notaría'}</button>
            <button disabled={notaSending} onClick={guardarDespues} style={{flex:1,minWidth:160,height:46,borderRadius:11,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12.5,fontWeight:600,cursor:'pointer'}}>Guardar y enviar después</button>
          </div>
          <div style={{textAlign:'center',marginTop:14}}><button onClick={marcarSinCorreo} style={{fontSize:11.5,color:C.muted,background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>Ya la pagué antes — marcar sin enviar correo</button></div>
        </div>
        )
      })()}

      {/* Vista "Sin cliente · por asignar": la app resuelve sola el cliente (aprendido + IA), tú confirmas lo dudoso */}
      {showOrphans&&(()=>{
        const total=orphans.reduce((a,e)=>a+(e.amount||0),0)
        const ql=orfQ.trim().toLowerCase()
        const lista = ql ? orphans.filter(e=>`${e.concept||''} ${Math.round(e.amount||0)} ${e.rut||e.receptor_rut||''}`.toLowerCase().includes(ql)) : orphans
        const autoArr=Object.entries(orfAuto)
        const card = e=>{
          const s=orfSug[e.id]
          const alta=s&&s.conf>=90
          return (
            <div key={e.id} style={{background:C.card,borderRadius:12,padding:'10px 12px',marginBottom:8,border:`1px solid ${C.border}`}}>
              <div onClick={()=>onEdit&&onEdit(e)} title='Ver el gasto' style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:s||orfPickFor===e.id?8:9,cursor:onEdit?'pointer':'default'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,lineHeight:1.35,overflowWrap:'anywhere'}}>{e.concept||'—'}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{e.date?fmtFechaDMY(e.date):'sin fecha'} · {e.category||'Otro'}{e.type==='fondo'?' · Fondo':''}{e.ot_number?` · OT ${e.ot_number}`:''}</div>
                </div>
                <span style={{fontSize:14,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(e.amount)}</span>
              </div>
              {s&&orfPickFor!==e.id?(
                <div style={{display:'flex',alignItems:'center',gap:8,background:alta?C.greenBg:C.bgSoft,borderRadius:8,padding:'6px 8px 6px 10px'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:alta?C.greenText:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</div>
                    <div style={{fontSize:10,color:alta?'#3E7A66':C.muted,marginTop:1}}>{s.via} · {s.conf}%</div>
                  </div>
                  <button onClick={()=>aplicarOrf(e,s.client_id)} title='Asignar' style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:30,height:24,background:alta?C.greenText:C.accent,border:'none',borderRadius:8,cursor:'pointer',flexShrink:0}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg></button>
                  <button onClick={()=>setOrfPickFor(e.id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',padding:'0 4px',flexShrink:0}}>otro</button>
                </div>
              ):(
                <div style={{display:'flex',justifyContent:'flex-end',gap:6,alignItems:'center'}}>
                  {onCreateOccasional&&<button onClick={async()=>{ const nm=await appPrompt('Nombre del cliente ocasional:', e.concept||''); if(nm&&nm.trim()){ const c=await onCreateOccasional(nm.trim()); if(c) aplicarOrf(e,c.id) } }} style={{fontSize:11,fontWeight:600,padding:'5px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,cursor:'pointer'}}>+ Ocasional</button>}
                  <button onClick={()=>setOrfPersona(orfPersona===e.id?null:e.id)} style={{fontSize:11,fontWeight:600,padding:'5px 10px',borderRadius:8,border:`1px solid ${orfPersona===e.id?C.accent:C.border}`,background:'#fff',color:C.accent,cursor:'pointer'}}>Personal de {orfPersona===e.id?<Gl n='chevU'/>:<Gl n='chevD'/>}</button>
                  <AsignarClienteInline bill={{id:e.id}} clients={clients} onAssign={(_,cid)=>aplicarOrf(e,cid)} label='Asignar cliente' placeholder='Buscar cliente por nombre o RUT…'/>
                </div>
              )}
              {orfPersona===e.id&&<div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end',marginTop:8}}>{PERSONAS_NOTA.map(p=>{ const pc=personChip(p); return <button key={p} onClick={async()=>{ await marcarPersonal(e,p); setOrfPersona(null) }} style={{fontSize:11,background:pc.bg,color:pc.color,border:'none',borderRadius:12,minHeight:30,padding:'0 11px',fontWeight:600,cursor:'pointer'}}>{p}</button> })}</div>}
            </div>
          )
        }
        return (
        <div style={{padding:'4px 20px 100px',...(isDesktop?{maxWidth:760,margin:'0 auto'}:{})}}>
          {orphans.length===0&&autoArr.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>No quedan gastos sin cliente.</div>}
          {orphans.length>0&&(
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:11,display:'flex',alignItems:'center',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:15,fontWeight:700,color:C.text}}>{orphans.length} gasto{orphans.length===1?'':'s'} sin cliente</div>
                <div style={{fontSize:11,color:C.muted,marginTop:1}}>{fmt(total)} · la app puede resolver la mayoría</div>
              </div>
              <button disabled={orfBusy} onClick={runOrfAsistente} style={{fontSize:12,fontWeight:600,color:'#fff',background:C.accent,border:'none',borderRadius:10,padding:'9px 15px',cursor:orfBusy?'default':'pointer',opacity:orfBusy?.6:1,display:'inline-flex',alignItems:'center',gap:7,whiteSpace:'nowrap',flexShrink:0}}>{orfBusy&&<Spin/>}{orfBusy?'Resolviendo…':orfRan?'Resolver de nuevo':'Resolver con IA'}</button>
            </div>
          )}
          {autoArr.length>0&&(
            <div style={{background:C.greenBg,border:`1px solid #B9E3D2`,borderRadius:10,marginBottom:11,overflow:'hidden'}}>
              <div onClick={()=>setOrfAutoOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 13px',cursor:'pointer'}}>
                <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M20 6 9 17l-5-5'/></svg>
                <span style={{fontSize:12,fontWeight:500,color:C.greenText,flex:1}}>{autoArr.length} asignada{autoArr.length===1?'':'s'} por la app · reversibles</span>
                <span style={{fontSize:11,fontWeight:600,color:C.greenText}}>{orfAutoOpen?'Ocultar':'Ver'}</span>
              </div>
              {orfAutoOpen&&<div style={{padding:'0 13px 8px'}}>{autoArr.map(([id,a])=>(
                <div key={id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:'1px solid #C7E7D8'}}>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.greenText,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div><div style={{fontSize:10,color:'#3E7A66',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.concept||'—'} · {fmt(a.amount)} · {a.via}</div></div>
                  <button onClick={()=>deshacerOrf({id})} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'3px 9px',cursor:'pointer',flexShrink:0}}>Deshacer</button>
                </div>
              ))}</div>}
            </div>
          )}
          {orphans.length>3&&(
            <div style={{display:'flex',alignItems:'center',gap:7,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:'7px 11px',marginBottom:11}}>
              <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>
              <input value={orfQ} onChange={e=>setOrfQ(e.target.value)} placeholder='Buscar por glosa, monto o RUT' style={{border:'none',background:'none',outline:'none',fontSize:12,color:C.text,width:'100%'}}/>
            </div>
          )}
          {lista.map(card)}
          {ql&&lista.length===0&&<div style={{color:C.muted,textAlign:'center',padding:24,fontSize:12}}>Sin resultados para “{orfQ}”.</div>}
        </div>
        )
      })()}

      {/* Vista general: lista de clientes con saldo */}
      {!selectedClient&&!showOrphans&&!showNotaria&&(
        <div style={{padding:'4px 20px 100px'}}>
          {showHistorial&&(
            <div style={{padding:'2px 0 0'}}>
              {/* Pestañas: separa rendiciones a CLIENTES de liquidaciones a NOTARÍA */}
              {(()=>{ const tab=(id,lbl)=>{ const on=histTab===id; return <button onClick={()=>setHistTab(id)} style={{fontSize:13,fontWeight:500,background:on?C.accent:'#fff',color:on?'#fff':C.muted,border:`1px solid ${on?C.accent:C.border}`,borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>{lbl}</button> }
                void tab; return <div style={{display:'flex',gap:6,marginBottom:12,alignItems:'center'}}><button onClick={()=>exportHist()} title='Exportar a CSV' style={{marginLeft:'auto',fontSize:11,fontWeight:600,background:'none',border:'none',color:C.azulInfo,cursor:'pointer',padding:'2px 4px'}}>Exportar ↓</button><button onClick={()=>setHistOrden(o=>o==='nuevo'?'antiguo':'nuevo')} title='Ordenar por fecha' style={{fontSize:15,fontWeight:500,background:'none',border:'none',color:C.muted,cursor:'pointer',padding:'2px 4px',lineHeight:1}}>{histOrden==='nuevo'?'↓':'↑'}</button></div> })()}
              {/* Foto: protagonista "Rendido en el año" + alertas de acción anidadas (canon de la foto). Cero recálculo: sale de rendiciones/rendirPend/notaPendTotal. */}
              {(()=>{
                const yr = hAnio || String(new Date().getFullYear())
                const tile=(lbl,val,bg,col,onClick)=><div onClick={onClick} style={{flex:1,background:bg,borderRadius:10,padding:'8px 10px',cursor:onClick?'pointer':'default'}}><div style={{fontSize:9,color:col,textTransform:'uppercase',letterSpacing:.4}}>{lbl}</div><div style={{fontSize:14,fontWeight:700,color:col,marginTop:2,whiteSpace:'nowrap'}}>{val}</div></div>
                if(histTab==='clientes'){
                  const act=(rendiciones||[]).filter(r=>r.tipo==='cliente'&&!r.anulada_at)
                  const yrR=act.filter(r=>(r.created_at||'').slice(0,4)===yr)
                  const montoYr=yrR.reduce((a,r)=>a+(r.total||0),0)
                  const prN=rendirPend.length, prMonto=rendirPend.reduce((a,x)=>a+(x.monto||0),0)
                  const sinEnv=act.filter(r=>!r.sent_at).length
                  return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:12}}>
                    <div style={{...SEC_LBL}}>Rendido en {yr}</div>
                    <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:25,fontWeight:800,color:C.greenText,letterSpacing:-.5}}>{fmt(montoYr)}</span><span style={{fontSize:12,color:C.muted}}>· {yrR.length} rendicion{yrR.length!==1?'es':''}</span></div>
                    {(prN>0||sinEnv>0)&&<div style={{display:'flex',gap:8,marginTop:12}}>
                      {prN>0&&tile('Por rendir · +30d',`${prN} cliente${prN!==1?'s':''} · ${fmt(prMonto)}`,C.overdueBg,C.overdueText,()=>{setShowHistorial(false);setQ('');setShowRendiciones(true);setRendSub('rendir')})}
                      {sinEnv>0&&tile('Sin enviar',`${sinEnv} rendicion${sinEnv!==1?'es':''}`,C.soonBg,C.soonText,()=>setHistSinEnv(v=>!v))}
                    </div>}
                  </div>
                }
                const yrL=notaLiquidaciones.filter(r=>(r.created_at||'').slice(0,4)===yr)
                const montoYr=yrL.reduce((a,r)=>a+(r.total||0),0)
                const porEnv=notaLiquidaciones.filter(r=>notaEstado(r)==='por_enviar').length
                return <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 15px',marginBottom:12}}>
                  <div style={{...SEC_LBL}}>Liquidado a notaría en {yr}</div>
                  <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:2}}><span style={{fontSize:25,fontWeight:800,color:C.tealText,letterSpacing:-.5}}>{fmt(montoYr)}</span><span style={{fontSize:12,color:C.muted}}>· {yrL.length} liquidacion{yrL.length!==1?'es':''}</span></div>
                  {(notaPendTotal>0||porEnv>0)&&<div style={{display:'flex',gap:8,marginTop:12}}>
                    {notaPendTotal>0&&tile('Pendiente de pago',fmt(notaPendTotal),C.tealBg,C.tealText)}
                    {porEnv>0&&tile('Por enviar',`${porEnv} liquidacion${porEnv!==1?'es':''}`,C.soonBg,C.soonText)}
                  </div>}
                </div>
              })()}
              {/* Filtros compartidos (idénticos en ambas pestañas): buscador + Mes + Año */}
              {(()=>{
                const selSty={fontSize:12,fontWeight:500,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 10px',cursor:'pointer',outline:'none'}
                const MESES=[['','Mes'],['01','ene'],['02','feb'],['03','mar'],['04','abr'],['05','may'],['06','jun'],['07','jul'],['08','ago'],['09','sep'],['10','oct'],['11','nov'],['12','dic']]
                const anios=[...new Set((rendiciones||[]).map(r=>(r.created_at||'').slice(0,4)).filter(Boolean))].sort().reverse()
                return <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:12}}>
                  <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 10px'}}>
                    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/></svg>
                    <input value={hQ} onChange={e=>setHQ(e.target.value)} placeholder={histTab==='clientes'?'Buscar cliente':'Buscar período'} style={{border:'none',background:'none',outline:'none',fontSize:12,color:C.text,width:'100%'}}/>
                  </div>
                  <select value={hMes} onChange={e=>setHMes(e.target.value)} style={selSty}>{MESES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
                  <select value={hAnio} onChange={e=>setHAnio(e.target.value)} style={selSty}><option value=''>Año</option>{anios.map(a=><option key={a} value={a}>{a}</option>)}</select>
                </div>
              })()}
              {(()=>{
                const okFecha=r=>{ const ca=r.created_at||''; if(hAnio&&ca.slice(0,4)!==hAnio) return false; if(hMes&&ca.slice(5,7)!==hMes) return false; return true }
                const q=hQ.trim().toLowerCase()
                const ord=(a,b)=>{ const cmp=(a.created_at||'')<(b.created_at||'')?1:-1; return histOrden==='antiguo'?-cmp:cmp }
                // Agrupa por mes (created_at YYYY-MM) con subtotal — no un muro plano que mezcla meses.
                const MESN=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
                const mesLbl=k=>{ if(k==='sin') return 'Sin fecha'; const [y,m]=k.split('-'); return `${MESN[(+m||1)-1]} ${y}` }
                const agrupar=rows=>{ const gs=[],ix={}; rows.forEach(r=>{ const k=(r.created_at||'').slice(0,7)||'sin'; if(!ix[k]){ix[k]={k,items:[],total:0};gs.push(ix[k])} ix[k].items.push(r); ix[k].total+=(r.total||0) }); return gs }
                const mesHdr=(g)=><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'8px 2px 6px'}}><span style={{fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>{mesLbl(g.k)}</span><span style={{fontSize:11,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(g.total)} · {g.items.length}</span></div>
                const cardWrap=children=><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'2px 13px',marginBottom:2}}>{children}</div>
                if(histTab==='clientes'){
                  const rends=(rendiciones||[]).filter(r=>{ if(r.tipo!=='cliente') return false; if(histSinEnv&&(r.sent_at||r.anulada_at)) return false; if(!okFecha(r)) return false; if(q){ const cl=clients.find(x=>x.id===r.client_id); if(!(cl?.name||'').toLowerCase().includes(q)) return false } return true }).sort(ord)
                  const chipSinEnv=histSinEnv&&<div style={{display:'flex',justifyContent:'flex-start',margin:'2px 2px 8px'}}><button onClick={()=>setHistSinEnv(false)} style={{fontSize:11,fontWeight:600,color:C.soonText,background:C.soonBg,border:'none',borderRadius:20,padding:'3px 10px',cursor:'pointer'}}>Solo sin enviar · quitar</button></div>
                  if(!rends.length) return <>{chipSinEnv}<div style={{color:C.muted,textAlign:'center',padding:24,fontSize:12}}>Sin rendiciones</div></>
                  const activas=rends.filter(r=>!r.anulada_at), anuladas=rends.filter(r=>r.anulada_at)
                  return (<>
                    {chipSinEnv}
                    {agrupar(activas).map(g=><div key={g.k}>{mesHdr(g)}{cardWrap(g.items.map(r=>renderRendRow(r,true,true)))}</div>)}
                    {activas.length===0&&<div style={{color:C.muted,textAlign:'center',padding:'14px 0',fontSize:12}}>Sin rendiciones activas</div>}
                    {anuladas.length>0&&<details style={{marginTop:6}}>
                      <summary style={{fontSize:12,color:C.textSoft,cursor:'pointer',padding:'10px 2px',listStyleType:'none'}}>Anuladas · {anuladas.length}</summary>
                      {cardWrap(anuladas.map(r=>renderRendRow(r,true,true)))}
                    </details>}
                  </>)
                }
                const liq=[...notaLiquidaciones].filter(r=>{ if(!okFecha(r)) return false; if(q&&!String(r.periodo||'').toLowerCase().includes(q)) return false; return true }).sort(ord)
                if(!liq.length) return <div style={{fontSize:12,color:C.muted,padding:'24px 0',textAlign:'center'}}>Sin liquidaciones a notaría.</div>
                const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
                const notaRow=r=>{ const d=r.created_at?new Date(r.created_at):null; const est=notaEstado(r); const estLbl=est==='enviada'?'Enviada':est==='por_enviar'?'Por enviar':'Pagado histórico'; const estBg=est==='enviada'?C.greenBg:est==='por_enviar'?C.soonBg:C.border; const estCol=est==='enviada'?C.greenText:est==='por_enviar'?C.soon:C.muted; const open=expandRend===r.id; return (
                  <div key={r.id}>
                    <div onClick={()=>setExpandRend(open?null:r.id)} style={{display:'flex',gap:12,alignItems:'center',padding:'9px 2px',borderBottom:open?'none':`0.5px solid ${C.border}`,cursor:'pointer'}}>
                      <div style={{textAlign:'center',width:42,flexShrink:0}}><div style={{fontSize:15,fontWeight:600,color:C.accent}}>{d&&!isNaN(d)?d.getDate():'—'}</div><div style={{fontSize:9,color:C.muted}}>{d&&!isNaN(d)?`${M[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`:''}</div></div>
                      <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text}}>{BRAND.notaria}</div><div style={{fontSize:11,color:C.muted,marginTop:1}}>{r.periodo?`${r.periodo} · `:''}{r.n_gastos||0} OT</div></div>
                      <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(r.total)}</div><div style={{marginTop:3}}><span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:estBg,color:estCol,whiteSpace:'nowrap'}}>{estLbl}</span></div></div>
                    </div>
                    {open&&<div style={{padding:'6px 2px 10px 54px',borderBottom:`0.5px solid ${C.border}`}}>
                      {r.ot_numbers&&<div style={{fontSize:10,color:C.azulInfo,fontWeight:600,marginBottom:7}}>OT: {r.ot_numbers}</div>}
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        <button onClick={e=>{e.stopPropagation();descargarExcelNota(r)}} style={{fontSize:11,fontWeight:500,color:C.greenText,background:C.greenBg,border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>↓ Excel</button>
                        {est==='por_enviar'&&<button onClick={e=>{e.stopPropagation();abrirEnvioNotaria(r)}} style={{fontSize:11,fontWeight:500,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>Enviar</button>}
                        {est==='enviada'&&<button onClick={e=>{e.stopPropagation();reenviarNotaria(r)}} disabled={reenviando===r.id} style={{fontSize:11,fontWeight:500,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:8,padding:'4px 10px',cursor:reenviando===r.id?'default':'pointer',opacity:reenviando===r.id?.6:1}}>{reenviando===r.id?'Reenviando…':'Reenviar'}</button>}
                        {r.comprobante_url&&<a href={r.comprobante_url} target='_blank' rel='noreferrer' onClick={e=>e.stopPropagation()} style={{fontSize:11,fontWeight:500,color:C.azulInfo,textDecoration:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 10px'}}>Ver comprobante</a>}
                        {notariaPend.length>0&&<button onClick={e=>{e.stopPropagation();setNotaLiqAdd(notaLiqAdd===r.id?null:r.id);setAddSel(new Set());setAddSearch('');setAddOpenCli(new Set())}} style={{fontSize:11,fontWeight:500,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>{notaLiqAdd===r.id?'Cerrar':'Añadir OT'}</button>}
                        <button onClick={e=>{e.stopPropagation();deshacerNotaria(r)}} style={{fontSize:11,fontWeight:500,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>Anular</button>
                      </div>
                      {notaLiqAdd===r.id&&<div onClick={e=>e.stopPropagation()}>{addPicker(r)}</div>}
                    </div>}
                  </div>) }
                return (<>{agrupar(liq).map(g=><div key={g.k}>{mesHdr(g)}{cardWrap(g.items.map(notaRow))}</div>)}</>)
              })()}
              <div style={{marginTop:16}}><BitacoraLista prefijo='gastos.' titulo='Bitácora de gastos' limite={12} vacio='Aún no hay registros.' etiquetas={{'gastos.cuenta_personal_ajuste':'Ajuste de cuenta personal','gastos.fondo_asignado':'Fondo asignado a un gasto','gastos.conciliado':'Gasto conciliado con el banco','gastos.mover_cliente':'Gasto movido de cliente','gastos.fondo_sin_deposito_borrado':'Fondo sin depósito borrado','gastos.categoria_corregida':'Categoría corregida','gastos.incobrable':'Marcado incobrable','gastos.eliminado':'Gasto eliminado (a la papelera)','gastos.personal':'Marcado como personal','gastos.notaria_pagado':'Marcado pagado a la notaría','gastos.notaria_pagado_deshecho':'Pago a la notaría desmarcado','gastos.estado_historico':'Marcado histórico (no descuenta saldo)','gastos.estado_descuenta':'Marcado que descuenta saldo','gastos.estado_deshecho':'Estado del gasto deshecho','gastos.clasificados_historico':'Clasificados como histórico','gastos.clasificados_descuenta':'Clasificados que descuentan'}}/></div>
            </div>
          )}
        </div>
      )}

      {/* Vista cliente: Saldo arriba, Fondos recibidos y Gastos en secciones. La RS es etiqueta de cada gasto, no agrupación — el fondo cubre todas las razones sociales. */}
      {selectedClient&&(
        <div style={{padding:'4px 20px 130px'}}>
          <Buscador value={qMovG} onChange={setQMovG} placeholder='Buscar gasto, OT o monto…' style={{marginBottom:8}}/>
          {gastoToolbar()}
          {(()=>{
            const _qm=_normTxt(qMovG.trim()), _qd=qMovG.replace(/\D/g,'')
            const matchMov=e=>!_qm || _normTxt(`${e.concept||''} ${e.subconcept||''} ${e.ot_number||''} ${e.category||''} ${e.requirente||''}`).includes(_qm) || (_qd.length>=3&&String(Math.abs(e.amount||0)).includes(_qd))
            const movs=filtered.filter(e=>esOficina(selectedClient.id)?!esRendido(e):true).filter(matchMov)   // cliente: los rendidos van en la misma lista (marca gris con su fecha)
            const fondos=movs.filter(e=>e.type==='fondo')
            const gastos=movs.filter(e=>e.type!=='fondo')
            const rendidos=filtered.filter(esRendido)
            if(movs.length===0&&rendidos.length===0) return <div style={{color:C.muted,textAlign:'center',padding:40}}>Sin movimientos</div>
            // Cliente: UNA lista con todos los movimientos (fondos y gastos) en orden de fecha, cada uno con su saldo después; los filtros de arriba la acotan.
            if(!esOficina(selectedClient.id)) return (<>
              {movs.length>0&&<><div style={{...SEC_LBL,margin:'4px 2px 6px'}}>{gastoCatF==='Fondo'?'Fondos':gastoCatF==='__gastos__'?'Gastos':'Movimientos'} · {movs.length}</div>{movs.map(renderMov)}</>}
              {movs.length===0&&<div style={{color:C.muted,textAlign:'center',padding:22,fontSize:13}}>Sin movimientos con estos filtros.</div>}
            </>)
            return (<>
              {fondos.length>0&&<><div style={{fontSize:9,color:C.greenText,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',margin:'2px 2px 6px'}}>Fondos recibidos · {fondos.length}</div>{fondos.map(renderMov)}</>}
              {gastos.length>0&&(esOficina(selectedClient.id) ? (()=>{
                // Oficina: la lista se agrupa por MES, colapsable (no un muro plano que mezcla meses).
                const groups=[]; const seen={}
                gastos.forEach(e=>{ const k=(e.date||'').slice(0,7)||'sin'; if(!seen[k]){seen[k]={k,items:[],total:0};groups.push(seen[k])} seen[k].items.push(e); seen[k].total+=(e.amount||0) })
                const isOpen=(k,gi)=> ofiMesOpen===null ? gi===0 : ofiMesOpen.has(k)
                const toggle=k=> setOfiMesOpen(prev=>{ const base= prev===null ? new Set([groups[0].k]) : new Set(prev); base.has(k)?base.delete(k):base.add(k); return base })
                return groups.map((g,gi)=>{ const op=isOpen(g.k,gi); return (
                  <div key={g.k} style={{marginTop:gi===0?10:6}}>
                    <div onClick={()=>toggle(g.k)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',padding:'8px 4px',borderBottom:`0.5px solid ${C.border}`}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:'capitalize'}}>{g.k==='sin'?'Sin fecha':_mesLabelOf(g.k)}<span style={{color:C.textSoft,fontWeight:500}}> · {g.items.length}</span></span>
                      <span style={{display:'flex',alignItems:'center',gap:9}}><span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(g.total)}</span><span style={{fontSize:11,color:C.textSoft,transform:op?'rotate(180deg)':'none',transition:'transform .2s'}}><Gl n='chevD'/></span></span>
                    </div>
                    {op&&g.items.map(renderMov)}
                  </div>
                )})
              })() : <><div style={{fontSize:9,color:C.overdueText,fontWeight:700,letterSpacing:.4,textTransform:'uppercase',margin:'12px 2px 6px'}}>Gastos · {gastos.length}</div>{(()=>{ const gs=[]; const seen={}; gastos.forEach(e=>{ const k=(e.date||'').slice(0,7)||'sin'; if(!seen[k]){seen[k]={k,items:[],total:0};gs.push(seen[k])} seen[k].items.push(e); seen[k].total+=(e.amount||0) })
                  return gs.map(g=><div key={g.k}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'6px 4px 5px',margin:'4px 0 6px',borderBottom:`0.5px solid ${C.border}`}}><span style={{fontSize:11.5,fontWeight:700,color:C.accent,textTransform:'capitalize'}}>{g.k==='sin'?'Sin fecha':_mesLabelOf(g.k)}<span style={{color:C.textSoft,fontWeight:500}}> · {g.items.length}</span></span><span style={{fontSize:12.5,fontWeight:700,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>−{fmt(g.total)}</span></div>{g.items.map(renderMov)}</div>) })()}</>)}
              {rendidosBlock('__single__',rendidos)}
            </>)
          })()}
          {fichaHistorial}
        </div>
      )}

      {showClasificar&&(()=>{
        const q=clasifSearch.trim().toLowerCase()
        const cn=cid=>clients.find(c=>String(c.id)===String(cid))?.name||'Cliente'
        const elf=q?gastosClasificar.filter(e=>(cn(e.client_id)+' '+(e.concept||'')).toLowerCase().includes(q)):gastosClasificar
        const byCli={}; elf.forEach(e=>{(byCli[e.client_id]=byCli[e.client_id]||[]).push(e)})
        const grupos=Object.entries(byCli).map(([cid,items])=>({cid,items,total:items.reduce((a,e)=>a+(e.amount||0),0),name:cn(cid)})).sort((a,b)=>a.name.localeCompare(b.name))
        const chk=(on,sz)=><span style={{width:sz||16,height:sz||16,borderRadius:4,flexShrink:0,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center'}}>{on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3.5' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span>
        const toggleGrp=g=>setClasifOpen(p=>{const n=new Set(p);n.has(g.cid)?n.delete(g.cid):n.add(g.cid);return n})
        return (
        <div style={{position:'fixed',inset:0,zIndex:1000,background:C.bg,display:'flex',flexDirection:'column'}}>
          <div style={{padding:'calc(env(safe-area-inset-top,0px) + 16px) 20px 10px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <button onClick={()=>{setShowClasificar(false);setSelClasif(new Set())}} aria-label='Volver' style={{display:'inline-flex',alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,cursor:'pointer',fontSize:14,fontWeight:600,lineHeight:1,padding:'2px 6px 2px 0',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>
            <div>
              <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Clasificar pagos</div>
              <div style={{fontSize:11,color:C.muted,marginTop:1}}>{gastosClasificar.length} gasto{gastosClasificar.length!==1?'s':''} antiguo{gastosClasificar.length!==1?'s':''} de carga masiva por clasificar</div>
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'10px 20px 24px'}}>
            <ChipSearch value={clasifSearch} onChange={e=>setClasifSearch(e.target.value)} placeholder='Buscar cliente o concepto...' style={{marginBottom:10}}/>
            {grupos.length===0&&<div style={{color:C.muted,textAlign:'center',padding:40}}>Nada por clasificar.</div>}
            {grupos.map(g=>{ const open=clasifOpen.has(g.cid); const allSel=g.items.every(e=>selClasif.has(e.id)); const someSel=g.items.some(e=>selClasif.has(e.id)); return (
              <div key={g.cid} style={{background:'#fff',border:`0.5px solid ${open?C.done:C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:6}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <button onClick={()=>setSelClasif(p=>{const n=new Set(p);g.items.forEach(e=>allSel?n.delete(e.id):n.add(e.id));return n})} title={allSel?'Quitar todos':'Seleccionar todos'} style={{background:'none',border:'none',padding:0,cursor:'pointer',display:'inline-flex'}}>{chk(allSel||someSel,20)}</button>
                  <div onClick={()=>toggleGrp(g)} style={{flex:1,minWidth:0,cursor:'pointer'}}>
                    <div style={{fontSize:13,fontWeight:600,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.name}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>{g.items.length} gasto{g.items.length!==1?'s':''} · {fmt(g.total)}</div>
                  </div>
                  <svg onClick={()=>toggleGrp(g)} width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='2.5' strokeLinecap='round' strokeLinejoin='round' style={{flexShrink:0,transform:open?'rotate(180deg)':'none',transition:'transform .15s',cursor:'pointer'}}><polyline points='6 9 12 15 18 9'/></svg>
                </div>
                {open&&<div style={{marginTop:9,paddingTop:8,borderTop:`0.5px solid ${C.border}`,display:'flex',flexDirection:'column',gap:9}}>
                  {g.items.map(e=>{ const on=selClasif.has(e.id); return (
                    <div key={e.id} onClick={()=>setSelClasif(p=>{const n=new Set(p);n.has(e.id)?n.delete(e.id):n.add(e.id);return n})} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer',fontSize:11}}>
                      {chk(on)}
                      <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{e.concept||'—'}</span>
                      <span style={{fontWeight:600,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',color:on?C.text:C.muted}}>{fmt(e.amount)}</span>
                    </div>) })}
                </div>}
              </div>
            )})}
          </div>
          {selClasif.size>0&&(
            <div style={{flexShrink:0,padding:'12px 16px',borderTop:`1px solid ${C.border}`,background:C.accent,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
              <span style={{fontSize:12,color:'#fff',fontWeight:600}}>{selClasif.size} seleccionado{selClasif.size!==1?'s':''}</span>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>clasifBulk('historico')} style={{fontSize:12,padding:'7px 13px',borderRadius:20,background:C.bgWarm,color:C.grisText,fontWeight:600,border:'none',cursor:'pointer'}}>Histórico</button>
                <button onClick={()=>clasifBulk('descuenta')} style={{fontSize:12,padding:'7px 13px',borderRadius:20,background:C.greenBg,color:C.greenText,fontWeight:600,border:'none',cursor:'pointer'}}>Descuenta</button>
              </div>
            </div>
          )}
        </div>) })()}

      {/* Barras inferiores de rendir eliminadas — se usa el botón "↓ Rendir" del encabezado */}

      {/* Respaldos: ya no es ventana aparte — el ícono abre el gasto, cuyo formulario tiene sus respaldos */}
      {pedirModal}
    </div>
  )
  // Rendición · Enviar rendición · Enviar devolución = PÁGINAS (antes ventanas a pantalla completa): "‹ origen" vuelve al cliente o a Rendiciones.
  const _origenRend = showRendiciones?(rendSub==='rendir'?'Rendir a cliente':'Rendiciones'):(selectedClient?.name||'Gastos')
  const _envPag = el => isDesktop?<div data-envpag style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{el}</div>:el
  if(rendicionClient){ const cerrar=()=>{_rendCliRef.current=null;setRendicionClient(null);setRendEntityIds([]);setRendEdit(null);setRendNav(null)}
    // Borradores preparados: anterior / siguiente saltan los clientes que ya no tienen gastos por rendir (borrador ya guardado).
    const _conPend = id => gastosPorRendirCli(expenses,id).some(e=>(Number(e.amount)||0)!==0)
    const _irBorr = j => { const c=(clients||[]).find(x=>String(x.id)===String(rendNav.ids[j])); if(!c) return; setRendEntityIds([]); setRendEdit(null); setRendicionClient(c); setRendNav({...rendNav,i:j}); requestAnimationFrame(()=>{ window.scrollTo(0,0); const el=document.querySelector('[data-envpag]'); if(el) el.scrollTop=0 }) }
    const _busca = (desde,paso) => { for(let j=desde;j>=0&&j<rendNav.ids.length;j+=paso){ if(_conPend(rendNav.ids[j])) return j } return -1 }
    const _nav = rendNav&&!rendEdit ? {i:rendNav.i, n:rendNav.ids.length, onPrev:()=>{ const j=_busca(rendNav.i-1,-1); if(j>=0) _irBorr(j) }, onNext:()=>{ const j=_busca(rendNav.i+1,1); if(j>=0) _irBorr(j) }} : null
    _rendCliRef.current = rendicionClient.id
    const _yo = rendicionClient.id
    const _revisada = rendNav&&!rendEdit ? ()=>{ if(_rendCliRef.current!==_yo) return; const j=_busca(rendNav.i+1,1); if(j>=0) _irBorr(j); else cerrar() } : null
    return _envPag(<FlujoPagina origen={_origenRend} titulo={rendEdit?'Editar rendición':'Rendición'} ctx={rendicionClient.name&&rendicionClient.name!==_origenRend?rendicionClient.name:null} onBack={cerrar} maxW={1180}><RendicionModal key={rendicionClient.id} client={rendicionClient} entityIds={rendEntityIds} expenses={expenses} clientEntities={clientEntities} sales={sales} rendiciones={rendiciones} onClose={cerrar} setExpenses={setExpenses} setRendiciones={setRendiciones} billing={billing} setBilling={setBilling} onRendicionComplete={onRendicionComplete} currentUserName={currentUserName} editRend={rendEdit} preSel={!!_nav} navBorr={_nav} onRevisada={_revisada} onEnviar={r=>{setRendicionClient(null);setRendEntityIds([]);setRendEdit(null);setRendNav(null);setEmailRend(r)}} asPage/></FlujoPagina>) }
  if(emailRend){ const cli=clients.find(c=>c.id===emailRend.client_id)
    return _envPag(<FlujoPagina origen={_origenRend} titulo='Enviar rendición' ctx={[cli?.name!==_origenRend?cli?.name:null,emailRend.correlativo?`N° ${emailRend.correlativo}`:null].filter(Boolean).join(' · ')||null} onBack={()=>setEmailRend(null)} maxW={1180}><RendicionEmailModal key={`${emailRend.id||'v'}-${emailRend.client_id}-${emailRend.correlativo||''}`} r={emailRend} client={clients.find(c=>c.id===emailRend.client_id)} user={currentUser} expenses={expenses} clientEntities={clientEntities} sales={sales} setExpenses={setExpenses} onSent={(id,at,corr)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,sent_at:at,correlativo:corr??x.correlativo}:x))} onPatch={(id,patch)=>setRendiciones(p=>p.map(x=>x.id===id?{...x,...patch}:x))} onNext={x=>setEmailRend(x)} onClose={()=>setEmailRend(null)} asPage/></FlujoPagina>) }
  if(devEmailRend) return _envPag(<FlujoPagina origen={_origenRend} titulo='Enviar devolución' ctx={devEmailRend.client?.name&&devEmailRend.client.name!==_origenRend?devEmailRend.client.name:null} onBack={()=>setDevEmailRend(null)} maxW={1180}><DevolucionEmailModal client={devEmailRend.client} rend={devEmailRend.rend} rendN={devEmailRend.rend?.correlativo} amount={devEmailRend.amount} fecha={devEmailRend.fecha} user={currentUser} setRendiciones={setRendiciones} onClose={()=>setDevEmailRend(null)} asPage/></FlujoPagina>)
  // Detalle de una liquidación de caja chica = PÁGINA (antes modal): foto guardada al liquidar (fondo · gastado · cubierto) + gastos por cliente.
  if(liqDetail){ const r=liqDetail; const gs=(expenses||[]).filter(e=>String(e.render_id)===String(r.id)).sort((a,b)=>(a.date||'')<(b.date||'')?1:-1); const tot=gs.reduce((a,e)=>a+(e.amount||0),0)
    const porCli={}; gs.forEach(e=>{ const k=e.client_id||'__sin__'; (porCli[k]=porCli[k]||[]).push(e) })
    const cub=r.saldo_caja!=null?Math.max(0,-r.saldo_caja):null
    const saldoHoy=r.user_name?saldoCajaChica(pettyCash,expenses,r.user_name):null
    const anx=anexoCajaChica(expenses,clients,r.user_name,gs,isoLocal(r.created_at)||null)
    const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px 6px'}
    const fila=(e)=>(<div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`,cursor:'pointer'}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div><div style={{fontSize:10.5,color:C.muted}}>{RENDCAT(e.category)} · {fmtFechaDMY(e.date)}</div></div><span style={{fontSize:12.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(e.amount)}</span></div>)
    const page=<FlujoPagina origen='Gastos' titulo='Liquidación de caja chica' ctx={r.user_name||null} onBack={()=>setLiqDetail(null)} maxW={1120}>
      <div style={{display:'flex',flexDirection:isDesktop?'row':'column',alignItems:'flex-start',gap:isDesktop?18:12}}>
        <div style={{flex:1,minWidth:0,width:'100%',display:'flex',flexDirection:'column',gap:12}}>
          {cub>0
            ? <div style={{background:C.overdueBg,borderRadius:12,padding:'12px 14px'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:10,fontWeight:700,color:C.overdueText,textTransform:'uppercase',letterSpacing:.5}}>Cubierto por {r.user_name} — a reembolsar</span><span style={{fontSize:22,fontWeight:800,color:C.overdueText,fontVariantNumeric:'tabular-nums'}}>{fmt(cub)}</span></div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'4px 14px',marginTop:4,fontSize:11.5,color:C.overdueText}}><span>Fondo recibido <b>{fmt(r.fondo_recibido)}</b></span><span>Gastado <b>{fmt(r.gastado)}</b></span><span>{gs.length} gasto{gs.length!==1?'s':''}</span></div></div>
            : <div style={{background:C.azulBg,borderRadius:12,padding:'12px 14px'}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10}}><span style={{fontSize:10,fontWeight:700,color:C.azulInfo,textTransform:'uppercase',letterSpacing:.5}}>Total liquidado</span><span style={{fontSize:22,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span></div>
                {r.saldo_caja!=null&&<div style={{display:'flex',flexWrap:'wrap',gap:'4px 14px',marginTop:4,fontSize:11.5,color:C.muted}}><span>Fondo recibido <b style={{color:C.text}}>{fmt(r.fondo_recibido)}</b></span><span>Gastado <b style={{color:C.text}}>{fmt(r.gastado)}</b></span><span>Saldo de caja <b style={{color:C.text}}>{fmt(r.saldo_caja)}</b></span></div>}</div>}
          {gs.length===0&&<div style={{fontSize:12,color:C.muted}}>Sin gastos en esta liquidación.</div>}
          {Object.entries(porCli).map(([k,arr])=>{ const cn=k==='__sin__'?'Sin cliente':(clients.find(c=>String(c.id)===String(k))?.name||'—'); const sub=arr.reduce((a,e)=>a+(e.amount||0),0); return (
            <div key={k} style={card}><div onClick={()=>k!=='__sin__'&&onOpenClientFicha&&onOpenClientFicha(k)} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,paddingBottom:4,cursor:k!=='__sin__'?'pointer':'default'}}><span style={{fontSize:13,fontWeight:700,color:C.accent}}>{cn}</span><span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(sub)}</span></div>{arr.map(fila)}</div>) })}
          {gs.length>0&&<div style={{display:'flex',justifyContent:'space-between',padding:'4px 14px'}}><span style={{fontSize:13,fontWeight:700,color:C.text}}>Total</span><span style={{fontSize:13,fontWeight:800,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(tot)}</span></div>}
        </div>
        <div style={isDesktop?{width:340,flexShrink:0}:{width:'100%'}}>
          <div style={card}><div style={{...SEC_LBL,paddingBottom:4}}>Liquidación</div>
            <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`}}><div style={{minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{r.user_name||'—'} · {r.periodo||''}</div><div style={{fontSize:10.5,color:C.muted}}>Liquidada {r.created_at?fmtFechaTS(r.created_at):'—'}</div></div><span style={{fontSize:12.5,fontWeight:700,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(tot)}</span></div>
            {r.ot_numbers&&<div style={{padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`,fontSize:11,color:C.muted}}>OT {r.ot_numbers}</div>}
            {saldoHoy!=null&&saldoHoy<0&&<div onClick={()=>onEntregarCaja&&onEntregarCaja(r.user_name,-saldoHoy)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`,cursor:'pointer'}}><div style={{minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.overdueText}}>Reembolso pendiente</div><div style={{fontSize:10.5,color:C.muted}}>Saldo de caja hoy</div></div><span style={{fontSize:12.5,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Entregar caja {fmt(-saldoHoy)} <Gl n='chevron'/></span></div>}
            {saldoHoy!=null&&saldoHoy>=0&&cub>0&&<div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`}}><span style={{fontSize:12.5,fontWeight:600,color:C.greenText}}>Reembolsado</span><span style={{fontSize:11,color:C.muted}}>saldo de caja hoy {fmt(saldoHoy)}</span></div>}
            {gs.length>0&&<div onClick={async()=>{ try{ const b64=await liquidacionPdfBase64({me:r.user_name, periodo:r.periodo, gastos:gs, clients, resumen:r.saldo_caja!=null?{fondo:r.fondo_recibido, gastado:r.gastado, saldo:r.saldo_caja}:null, anexo:anx}); const a=document.createElement('a'); a.href='data:application/pdf;base64,'+b64; a.download=`Liquidacion ${r.user_name||''} ${r.periodo||''}`.replace(/[^\w\s-]/g,'').trim()+'.pdf'; a.click() }catch(e){ appAlert('No se pudo armar el PDF: '+(e?.message||e)) } }} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 0',borderTop:`0.5px solid ${C.bgSoft}`,cursor:'pointer'}}><span style={{fontSize:12.5,fontWeight:600,color:C.accent}}>Descargar PDF</span><span style={{fontSize:11,color:C.muted}}>con el anexo</span></div>}
          </div>
          {gs.length>0&&<div style={{...card,marginTop:12}}><div style={{...SEC_LBL,paddingBottom:4}}>Anexo · {r.user_name}</div>
            <div style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5,padding:'8px 0 2px',borderTop:`0.5px solid ${C.bgSoft}`}}>Por categoría</div>
            {anx.categorias.map(x=><div key={x.cat} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'4px 0',fontSize:12}}><span style={{color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.cat} <span style={{color:C.muted}}>· {x.n}</span></span><span style={{fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(x.total)}</span></div>)}
            <div style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5,padding:'10px 0 2px',borderTop:`0.5px solid ${C.bgSoft}`,marginTop:6}}>Caja chica por mes</div>
            {anx.porMes.map(x=><div key={x.mes} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'4px 0',fontSize:12}}><span style={{color:x.n?C.text:C.muted}}>{x.etiqueta} <span style={{color:C.muted}}>· {x.n} gasto{x.n!==1?'s':''}</span></span><span style={{fontWeight:600,color:x.n?C.text:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(x.total)}</span></div>)}
            <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'6px 0 2px',fontSize:12,borderTop:`0.5px solid ${C.bgSoft}`,marginTop:2}}><span style={{fontWeight:700,color:C.text}}>Promedio mensual</span><span style={{fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(anx.promedio)}</span></div>
            {anx.clientes.length>0&&<><div style={{fontSize:10.5,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5,padding:'10px 0 2px',borderTop:`0.5px solid ${C.bgSoft}`,marginTop:6}}>Clientes con más gasto · 6 meses</div>
            {anx.clientes.map(x=><div key={x.id||'sin'} onClick={()=>x.id&&onOpenClientFicha&&onOpenClientFicha(x.id)} style={{display:'flex',justifyContent:'space-between',gap:10,padding:'4px 0',fontSize:12,cursor:x.id?'pointer':'default'}}><span style={{color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.name} <span style={{color:C.muted}}>· {x.n}</span></span><span style={{fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(x.total)}</span></div>)}</>}
          </div>}
        </div>
      </div>
    </FlujoPagina>
    return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{page}</div>:page }
  if(showRevOfi){ const pg=<RevisionOficinaPage items={revOfiVis} setExpenses={setExpenses} clients={clients} sales={sales} clientEntities={clientEntities} me={currentUserName} isAdmin={isAdmin} revisor={revisorNombre} onBack={()=>setShowRevOfi(false)}/>
    return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pg}</div>:pg }
  // Revisar = caja chica del equipo + gastos que revisa el equipo. Una sola fuente para la tarjeta del hub y la página.
  // Revisar es para todos: cada uno ve lo suyo (caja chica y gastos del equipo solo admin/revisor; sin cliente y consultas, todos).
  const revisarRes = (()=>{
    const alCC = isAdmin ? alertasCajaChica(pettyCash,expenses) : []
    const negCC = alCC.filter(a=>a.tipo==='negativo'), totNeg = negCC.reduce((t,a)=>t-a.saldo,0)
    const sinCC = isAdmin ? calceCajaChica(pettyCash,[],{}).cajasSinTransf.length : 0
    const miSaldo = isAdmin ? null : ((pettyCash||[]).some(p=>p.user_name===currentUserName) ? saldoCajaChica(pettyCash,expenses,currentUserName) : null)
    const caja = !isAdmin ? (miSaldo==null ? {s:'sin caja entregada'} : miSaldo<0 ? {s:`la oficina te debe ${fmtN(-miSaldo)}`, col:C.overdueText} : {s:`disponible ${fmtN(miSaldo)}`, col:miSaldo<=(BRAND.cajaChicaUmbral||0)?C.soonText:undefined})
      : negCC.length ? {s:`${negCC.length} en negativo · ${fmtMill(totNeg)}`, sM:`${negCC.length} en negativo`, col:C.overdueText} : alCC.length ? {s:`${alCC.length} baja${alCC.length!==1?'s':''}`, col:C.soonText} : sinCC ? {s:`${sinCC} sin conciliar`, col:C.soonText} : {s:'al día'}
    const nP=revOfiVis.filter(e=>!e.revision_estado).length, nN=revOfiVis.filter(e=>e.revision_estado==='nose').length
    const gas = isAdmin ? (nN?{s:`${nN} para decidir`,col:C.soonText}:nP?{s:`${nP}${revisorNombre?` de ${revisorNombre}`:' en revisión'}`,col:C.soonText}:{s:'al día'}) : (nP?{s:`${nP} por revisar`,col:C.soonText}:{s:'al día'})
    const nGas = isAdmin?(nN||nP):nP
    const resumen = [negCC.length?`${negCC.length} caja${negCC.length!==1?'s':''} en negativo`:sinCC?`${sinCC} caja${sinCC!==1?'s':''} sin conciliar`:null, nGas?`${nGas} gasto${nGas!==1?'s':''}`:null].filter(Boolean).join(' · ')
    const sinPorPersona={}; if(isAdmin) calceCajaChica(pettyCash,[],{}).cajasSinTransf.forEach(x=>{ const u=x.petty?.user_name; if(u) sinPorPersona[u]=(sinPorPersona[u]||0)+1 })
    const consultas = (expenses||[]).filter(e=>!e.deleted_at&&e.revision_estado==='consultar'&&(isAdmin||e.revisado_por===currentUserName)).sort((a,b)=>String(a.revisado_por||'').localeCompare(String(b.revisado_por||''),'es')||String(b.date||'').localeCompare(String(a.date||'')))
    const verGas = true   // todos ven Gastos (el limited, solo lo que cargó)
    const sinCli = orphans.length ? {s:`${orphans.length} por asignar`, col:C.soonText} : {s:'al día'}
    const resumenC = [fondosReg.length?`${fondosReg.length} fondo${fondosReg.length!==1?'s':''}`:null, verGas?resumen:null, orphans.length?`${orphans.length} sin cliente`:null, consultas.length?`${consultas.length} consulta${consultas.length!==1?'s':''}`:null].filter(Boolean).join(' · ')
    return {alCC, caja, gas, verGas, sinCli, resumen:resumenC, sinCC, sinPorPersona, consultas, col:negCC.length&&isAdmin?C.overdueText:resumenC?C.soonText:undefined}
  })()
  if(showRevisar&&revCaja&&revisarRes&&isAdmin){ const r=revisarRes
    const personas=[...new Set((pettyCash||[]).map(p=>p.user_name).filter(Boolean))].map(persona=>({persona, saldo:saldoCajaChica(pettyCash,expenses,persona), sin:r.sinPorPersona[persona]||0})).sort((a,b)=>a.saldo-b.saldo)
    const pg=(
    <FlujoPagina origen='Revisar' titulo='Caja chica' ctx='cajas del equipo' onBack={()=>setRevCaja(false)} maxW={760}>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{personas.map((x,i)=>{ const neg=x.saldo<0, baja=!neg&&x.saldo<=(BRAND.cajaChicaUmbral||0); return (
        <div key={x.persona} onClick={()=>onEntregarCaja&&onEntregarCaja(x.persona,neg?-x.saldo:null)} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:personChip(x.persona).color,whiteSpace:'nowrap'}}>{x.persona}</div>
            <div style={{fontSize:11.5,color:x.sin?C.soonText:C.muted,fontWeight:x.sin?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{x.sin?`${x.sin} sin transferencia`:'conciliada'}</div>
          </div>
          <span style={{fontSize:11.5,fontWeight:700,color:C.accent,background:C.azulBg,borderRadius:20,padding:'3px 10px',whiteSpace:'nowrap'}}>Entregar</span>
          <span style={{fontSize:14,fontWeight:700,color:neg?C.overdueText:baja?C.soonText:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?96:84,textAlign:'right'}}>{fmtSaldoG(x.saldo)}</span>
        </div>) })}{personas.length===0&&<div style={{padding:22,textAlign:'center',fontSize:13,color:C.muted}}>Sin cajas entregadas.</div>}</div>
      {onRevisionCajaChica&&<div onClick={onRevisionCajaChica} style={{display:'flex',alignItems:'center',gap:10,marginTop:10,background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 14px',cursor:'pointer'}}>
        <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text}}>Conciliar con el banco</span>
        <span style={{fontSize:12,color:r.sinCC?C.soonText:C.muted,fontWeight:r.sinCC?600:400,whiteSpace:'nowrap'}}>{r.sinCC?`${r.sinCC} sin conciliar`:'al día'}</span>
        <span style={{color:C.textSoft}}><Gl n='chevron'/></span>
      </div>}
    </FlujoPagina>)
    return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pg}</div>:pg }
  if(showRevisar&&showMov){ const pg=<MovilizacionView expenses={expenses} clients={clients} persona={movPersona} isAdmin={isAdmin||soyRevisor} excluir={movExcluir} puedeEditar={isAdmin?null:(e=>e._p===currentUserName)} origen='Revisar' onBack={()=>setShowMov(false)} onEdit={onEdit}/>
    return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pg}</div>:pg }
  if(showRevisar&&revisarRes&&!showOrphans){ const r=revisarRes; const nT=4; const _mv=movilizacionDatos(expenses,clients,{persona:movPersona, excluir:movExcluir, anio:String(new Date().getFullYear())}); const _mvMes=_mv.meses[0]; const pg=(
    <FlujoPagina origen='Gastos' titulo='Revisar' onBack={()=>setShowRevisar(false)} maxW={isDesktop&&nT>=3?1000:760}>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?`repeat(${Math.max(nT,2)},minmax(0,1fr))`:(nT===2||nT===4?'1fr 1fr':'1fr'),gap:isDesktop?12:8}}>
        <HubTile ic='wallet' bg={C.greenBg} col={C.greenText} t='Caja chica' s={r.caja.s} sM={r.caja.sM} sCol={r.caja.col} onClick={()=>isAdmin?setRevCaja(true):(onIrCajaChica&&onIrCajaChica())}/>
        {r.verGas&&<HubTile ic='check' bg={C.soonBg} col={C.soonText} t='Gastos' s={r.gas.s} sCol={r.gas.col} onClick={()=>setShowRevOfi(true)}/>}
        <HubTile ic='alert' bg={C.overdueBg} col={C.overdueText} t='Sin cliente' s={r.sinCli.s} sCol={r.sinCli.col} onClick={()=>setShowOrphans(true)}/>
        <HubTile icNode={<MovIcon s={isDesktop?17:15} c={C.tealText||C.accent}/>} bg={C.tealBg||C.azulBg} t='Movilización' s={_mv.sinMotivo.length?`${_mv.sinMotivo.length} sin motivo`:_mvMes?`${fmt(_mvMes.tot)} en ${MES_C[+_mvMes.k.slice(5,7)-1]||''}`:'sin viajes'} sCol={_mv.sinMotivo.length?C.soonText:undefined} onClick={()=>setShowMov(true)}/>
      </div>
      {fondosReg.length>0&&<div style={{marginTop:16}}>
        <div style={{...SEC_LBL,margin:'0 2px 6px'}}>Fondos por registrar · {fondosReg.length}</div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{fondosReg.map((r,i)=>{ const p=r.propuesta||{}, cl=(clients||[]).find(c=>String(c.id)===String(r.cliente_id)), cn=cl?.name||r.cliente_nombre||r.de_nombre||'Cliente', ab=fondoAb===r.id, busy=fondoBusy===r.id
          // Quien transfiere solo se nombra si no es el mismo cliente (p. ej. la empresa del cliente que paga por él).
          const ev=(r.evidencia||[])[0]||{}, nq=x=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''), otro=r.de_nombre&&nq(r.de_nombre)!==nq(cn)?r.de_nombre:null
          const msg=String(ev.texto||'').match(/«[^»]*»/)?.[0]||null, proyV=fondoProy[r.id]!==undefined?fondoProy[r.id]:p.proyecto
          const sub=isDesktop?[otro?`Transferencia de ${otro}`:'Transferencia',msg].filter(Boolean).join(' · '):(proyV||msg||(otro?`Transferencia de ${otro}`:'Sin proyecto'))
          const ops=proyectosDe(r.cliente_id), val=fondoProy[r.id]!==undefined?fondoProy[r.id]:(p.proyecto||'')
          const sel=<select value={val} onClick={e=>e.stopPropagation()} onChange={e=>setFondoProy(o=>({...o,[r.id]:e.target.value}))} style={{fontSize:12.5,border:`1px solid ${C.border}`,borderRadius:9,padding:'7px 10px',color:C.text,background:C.surface,maxWidth:isDesktop?320:'100%',width:isDesktop?'auto':'100%'}}>
            <option value=''>Proyecto: sin proyecto</option>{[...new Set([...(p.proyecto?[p.proyecto]:[]),...ops])].map(o=><option key={o} value={o}>Proyecto: {o}</option>)}</select>
          const btnG={fontSize:12.5,fontWeight:600,borderRadius:9,padding:'7px 12px',border:`1px solid ${C.border}`,background:C.surface,color:C.accent,cursor:busy?'default':'pointer',whiteSpace:'nowrap',opacity:busy?.6:1}
          const btnP={fontSize:12.5,fontWeight:700,borderRadius:9,padding:'8px 14px',border:'none',background:C.accent,color:'#fff',cursor:busy?'default':'pointer',whiteSpace:'nowrap',opacity:busy?.6:1}
          const fuente=<span style={{fontSize:12,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{ev.fuente&&ev.fuente!=='cartola'?`Aviso de ${ev.fuente}`:'Cartola del banco'}</span>
          const acc=<><button disabled={busy} onClick={e=>{e.stopPropagation();resolverFondo(r,false)}} style={btnG}>No corresponde</button><button disabled={busy} onClick={e=>{e.stopPropagation();resolverFondo(r,true)}} style={btnP}>{busy?'Registrando…':isDesktop?'Registrar fondo':'Registrar'}</button></>
          return <div key={r.id} style={{borderTop:i?`1px solid ${C.track}`:'none'}}>
            <div onClick={()=>setFondoAb(ab?null:r.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer'}}>
              {diaGrande(p.fecha||String(r.recibido_at||'').slice(0,10))}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><span onClick={ev=>{ if(r.cliente_id&&onOpenClientFicha){ ev.stopPropagation(); onOpenClientFicha(r.cliente_id) } }}>{cn}</span></div>
                <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>
              </div>
              <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?96:0,textAlign:'right',flexShrink:0}}>{fmt(p.monto)}</span>
            </div>
            {ab&&(isDesktop
              ?<div style={{display:'flex',alignItems:'center',gap:10,padding:'2px 14px 12px 62px'}}>{sel}{fuente}<span style={{flex:1}}/>{acc}</div>
              :<div style={{display:'flex',flexDirection:'column',gap:8,padding:'0 12px 12px'}}>{sel}<div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>{acc}</div></div>)}
          </div> })}</div>
      </div>}
      {(()=>{ // Trámites del año cuya glosa no dice de qué es: se completan en Editar gasto (chips «¿De qué?»). Cada miembro ve lo suyo.
        const y0=`${new Date().getFullYear()}-01-01`
        const sd=(expenses||[]).filter(e=>!e.deleted_at&&e.type!=='fondo'&&!e.ot_number&&String(e.date||'')>=y0&&CATS_DE_CLIENTE.has(e.category)&&glosaSinDetalle(e.concept)&&(isAdmin||e.created_by===currentUserName)).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
        if(!sd.length) return null
        const ver=sinDetTodos?sd:sd.slice(0,6)
        return <div style={{marginTop:16}}>
          <div style={{...SEC_LBL,margin:'0 2px 6px'}}>Sin detalle · {sd.length}</div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{ver.map((e,i)=>{ const cn=(clients||[]).find(c=>String(c.id)===String(e.client_id))?.name||(e.personal_de?`Personal · ${e.personal_de}`:'Oficina'); return (
            <div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i?`1px solid ${C.track}`:'none',cursor:onEdit?'pointer':'default'}}>
              {diaGrande(e.date)}
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><span onClick={ev=>{ if(e.client_id&&onOpenClientFicha){ ev.stopPropagation(); onOpenClientFicha(e.client_id) } }}>{cn}</span></div>
                <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.category} · {e.concept||'sin glosa'}{isAdmin&&e.created_by?` · ${e.created_by}`:''}</div>
              </div>
              <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?96:0,textAlign:'right',flexShrink:0}}>{fmt(e.amount)}</span>
            </div>) })}
            {sd.length>6&&<div onClick={()=>setSinDetTodos(o=>!o)} style={{padding:'9px 14px',borderTop:`1px solid ${C.track}`,fontSize:12.5,fontWeight:700,color:C.accent,cursor:'pointer',textAlign:'center'}}>{sinDetTodos?'Ver menos':`Ver los ${sd.length}`}</div>}
          </div>
        </div> })()}
      {r.consultas.length>0&&<div style={{marginTop:16}}>
        <div style={{...SEC_LBL,margin:'0 2px 6px'}}>Por consultar · {r.consultas.length}</div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{r.consultas.map((e,i)=>{ const cn=(clients||[]).find(c=>String(c.id)===String(e.client_id))?.name||(e.personal_de?`Personal · ${e.personal_de}`:'Oficina'); const pc=personChip(e.revisado_por||''); return (
          <div key={e.id} onClick={()=>onEdit&&onEdit(e)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderTop:i?`1px solid ${C.track}`:'none',cursor:onEdit?'pointer':'default'}}>
            {diaGrande(e.date)}
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><span onClick={ev=>{ if(e.client_id&&onOpenClientFicha){ ev.stopPropagation(); onOpenClientFicha(e.client_id) } }}>{cn}</span></div>
              <div style={{fontSize:11.5,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b style={{color:pc.color,fontWeight:700}}>{e.revisado_por||'Equipo'}</b> · {e.concept||e.category||'—'}</div>
            </div>
            {isDesktop&&isAdmin&&<button onClick={ev=>{ev.stopPropagation();marcarConsulta(e,null)}} style={{fontSize:11.5,fontWeight:700,color:C.accent,background:C.azulBg,borderRadius:20,padding:'3px 10px',border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Resuelta</button>}
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
              <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?96:0,textAlign:'right'}}>{fmt(e.amount)}</span>
              {!isDesktop&&isAdmin&&<button onClick={ev=>{ev.stopPropagation();marcarConsulta(e,null)}} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.azulBg,borderRadius:20,padding:'2px 9px',border:'none',cursor:'pointer',whiteSpace:'nowrap'}}>Resuelta</button>}
            </div>
          </div>) })}</div>
      </div>}
    </FlujoPagina>)
    return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pg}</div>:pg }
  if(pedirOpen) return isDesktop?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pedirModal}</div>:pedirModal
  // ── HUB de Gastos (cara de entrada). Presentación pura: mismas cifras auditadas, sin recalcular nada.
  const showHub = hubOpen && !selectedClient && !showOrphans && !showNotaria && !showHistorial
  // ── Cuenta personal de un miembro (lo propio): saldo propio = fondos de uso general − gastos sin fondo asignado.
  // Un fondo de un tercero (p. ej. el que deja un cliente para un socio) cubre SOLO los gastos ligados a él (reembolso_fondo_id);
  // lo que le quede no se usa para otros gastos. Total de la cuenta = fondos − gastos (mismo criterio que dispPersona).
  if(cuentaP){
    const p=cuentaP, D=isDesktop
    const movsP=(expenses||[]).filter(e=>!e.deleted_at&&!e.client_id&&e.personal_de===p).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))
    const fondosP=movsP.filter(e=>e.type==='fondo'&&cuentaEnSaldo(e)&&!e.no_descuenta_saldo), gastosP=movsP.filter(e=>e.type!=='fondo'&&cuentaEnSaldo(e)&&!e.no_descuenta_saldo)
    const cubre=f=>gastosP.filter(g=>String(g.reembolso_fondo_id)===String(f.id))
    const esDedic=f=>cubre(f).length>0
    const fondoDe=g=>fondosP.find(f=>String(f.id)===String(g.reembolso_fondo_id))
    const sinFondo=gastosP.filter(g=>!fondoDe(g))
    const sum=a=>a.reduce((t,e)=>t+(Number(e.amount)||0),0)
    const libresT=sum(fondosP.filter(f=>!esDedic(f))), sinFondoT=sum(sinFondo)
    const propio=libresT-sinFondoT
    const quedaTer=fondosP.filter(esDedic).reduce((t,f)=>t+(Number(f.amount)||0)-sum(cubre(f)),0)
    const nomFondo=f=>{ const c=String(f.concept||'Fondo'); const m=c.match(/^Fondo por rendir\s*·\s*de\s+(.+?)(\s*·\s*para\s+.*)?$/i); if(m) return `Fondo de ${m[1]}`; if(/^Aporte\b/i.test(c)) return 'Aporte propio'; return c }
    const asignar=async(g,fid)=>{ const v=fid||null
      if(!DEMO){ const {error}=await supabase.from('expenses').update({reembolso_fondo_id:v}).eq('id',g.id); if(error){ appAlert('No se pudo asignar: '+error.message); return } logActividad('gastos.fondo_asignado',{tabla:'expenses',id:g.id,detalle:{concept:g.concept,amount:g.amount,persona:p,fondo:v}}) }
      setExpenses(prev=>prev.map(x=>x.id===g.id?{...x,reembolso_fondo_id:v}:x)) }
    const selFondo=g=> fondosP.length>0 && (
      <div onClick={ev=>ev.stopPropagation()} style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,marginTop:8,paddingTop:8,borderTop:`1px solid ${C.bgSoft}`}}>
        <span style={{fontSize:11,color:C.muted}}>Lo paga</span>
        <select value={g.reembolso_fondo_id||''} onChange={ev=>asignar(g,ev.target.value)} style={{fontSize:12,fontWeight:600,border:`1px solid ${fondoDe(g)?C.greenText:C.border}`,borderRadius:20,padding:'3px 10px',background:fondoDe(g)?C.greenBg:C.surface,color:fondoDe(g)?C.greenText:C.muted,cursor:'pointer',maxWidth:D?260:'70%'}}>
          <option value=''>Cuenta propia</option>
          {fondosP.map(f=><option key={f.id} value={f.id}>{nomFondo(f)}</option>)}
        </select>
      </div>)
    const linea=(l,v,col)=><div style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:12.5,padding:'3px 0'}}><span style={{color:C.muted}}>{l}</span><b style={{color:col||C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</b></div>
    const hero=(
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
        <div style={{...SEC_LBL}}>Saldo propio</div>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:8,marginTop:2}}>
          <span style={{fontSize:12,fontWeight:600,color:propio<0?C.overdueText:propio>0?C.greenText:C.muted}}>{propio<0?'debe a la oficina':propio>0?'a favor':'al día'}</span>
          <span style={{fontSize:24,fontWeight:800,color:propio<0?C.overdueText:C.accent,fontVariantNumeric:'tabular-nums',letterSpacing:-.5}}>{fmtSaldoG(propio)}</span>
        </div>
        <div style={{borderTop:`1px solid ${C.track}`,marginTop:8,paddingTop:5}}>
          {linea('Fondos propios',fmt(libresT))}
          {linea('Gastos sin fondo',fmtSaldoG(-sinFondoT),sinFondoT?C.overdueText:null)}
          {quedaTer>0&&linea('Queda en fondos de terceros',fmt(quedaTer),C.greenText)}
        </div>
      </div>)
    const fondosCard=fondosP.length>0&&(
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{...SEC_LBL,padding:'10px 14px 6px'}}>Fondos · {fondosP.length}</div>
        {fondosP.map(f=>{ const c=cubre(f), usado=sum(c), queda=(Number(f.amount)||0)-usado; return (
          <div key={f.id} style={{padding:'9px 14px',borderTop:`1px solid ${C.track}`}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'baseline'}}>
              <span style={{fontSize:13,fontWeight:700,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nomFondo(f)}</span>
              <span style={{fontSize:13,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(f.amount)}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:11.5,color:C.muted,marginTop:2}}>
              <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.length?`cubre ${c.length} gasto${c.length!==1?'s':''} · ${fmt(usado)}`:'uso general'}</span>
              {c.length>0&&<span style={{fontWeight:600,color:queda<0?C.overdueText:C.text,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums'}}>queda {fmtSaldoG(queda)}</span>}
            </div>
          </div>) })}
      </div>)
    const btnC=(bg,col)=>({height:32,padding:'0 14px',minWidth:D?96:0,flex:D?'0 0 auto':1,borderRadius:9,fontSize:13,fontWeight:600,fontFamily:'inherit',cursor:'pointer',whiteSpace:'nowrap',border:'none',background:bg,color:col})   // mismo botón que la ficha de cliente
    const acciones=(
      <div style={{display:'flex',gap:8}}>
        <button type='button' onClick={()=>onIrConciliacion?onIrConciliacion():onAddFondo()} title='Los fondos entran desde la conciliación bancaria' style={btnC(C.greenBg,C.greenText)}>+ Fondo</button>
        <button type='button' onClick={()=>onAdd&&onAdd({personal_de:p})} style={btnC(C.border,C.accent)}>+ Gasto</button>
      </div>)
    const lblMov=<div style={{...SEC_LBL,margin:'2px 2px 6px'}}>Movimientos · {movsP.length}</div>
    const lista=(<div>
      {!D&&lblMov}
      {movsP.length===0?<div style={{color:C.muted,textAlign:'center',padding:24,fontSize:13}}>Sin movimientos.</div>
        :movsP.map(e=>renderMov(e,0,null,e.type!=='fondo'?selFondo(e):null,{sinPersonal:true}))}
    </div>)
    const pg=(
      <FlujoPagina origen='Gastos' titulo={p} ctx='Cuenta personal' onBack={()=>setCuentaP(null)} maxW={1100}>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}><div style={{width:D?'auto':'100%'}}>{acciones}</div></div>
        {D
          ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1.6fr)',columnGap:16,alignItems:'start'}}>   {/* fila de títulos + fila de cajas: las dos columnas parten a la misma altura */}
              <div aria-hidden style={{...SEC_LBL,margin:'2px 2px 6px'}}>{'\u00a0'}</div>{lblMov}
              <div style={{display:'flex',flexDirection:'column',gap:12}}>{hero}{fondosCard}</div>{lista}
            </div>
          : <div style={{display:'flex',flexDirection:'column',gap:12}}>{hero}{fondosCard}{lista}</div>}
      </FlujoPagina>)
    return D?<div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{pg}</div>:pg
  }
  if(showHub){
    const D = isDesktop
    const activos = clientsWithMovs.filter(c=>c.status!=='Terminado')
    const nSin = orphans.length + revN(revNoActivo) + revN(revOcasional)
    const cards = [
      {t:'Rendiciones', ic:'receipt', s:txtBorr||(rendirPend.length?`${fmtShort(rendirPend.reduce((a,x)=>a+(x.monto||0),0))} por rendir`:'al día'), col:C.accent, bg:C.azulBg, go:()=>{setHubOpen(false);setShowRendiciones(true);setRendSub(null)}},
      {t:'Notaría', ic:'building', s:notariaPend.length?`${fmtShort(notaPendTotal)} por pagar`:'al día', col:C.tealText, bg:C.tealBg, go:()=>{setNotaTab('hub');setShowNotaria(true)}},
    ]
    if(revisarRes&&D) cards.push({t:'Revisar', ic:'check', s:revisarRes.resumen||'al día', sCol:revisarRes.col, col:C.soonText, bg:C.soonBg, go:()=>setShowRevisar(true)})
    const hubInner = (
      <div style={{maxWidth:D?960:undefined,margin:'0 auto',padding:D?'8px 22px 44px':'2px 6px 30px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',padding:D?'14px 2px 12px':'16px 8px 10px'}}>
          <div style={{display:'flex',alignItems:'baseline',gap:7,minWidth:0}}>
            <span style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,whiteSpace:'nowrap'}}>Gastos y Fondos</span>
          </div>
          <div style={{display:'flex',gap:8}}>{!D&&revisarRes&&<button type='button' onClick={()=>setShowRevisar(true)} style={{...chipBtn(),...(revisarRes.resumen?{color:revisarRes.col}:{})}}>Revisar</button>}<button type='button' onClick={()=>{setHubOpen(false);setNotaMenuOpen(true)}} style={chipBtn('primary')}>+ Cargar</button></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:D?`repeat(${cards.length},minmax(0,1fr))`:'1fr 1fr',gap:D?12:8,marginBottom:12}}>
          {cards.map(c=><HubTile key={c.t} ic={c.ic} t={c.t} s={c.s} sCol={c.sCol} col={c.col} bg={c.bg} onClick={c.go}/>)}
        </div>
        {/* Avisos de caja chica por persona (alertasCajaChica, fuente única): en negativo / baja → "Entregar caja" (Nueva Caja prellenada). Solo si hay alguno.
            SOLO ADMIN: un limited ve únicamente SU caja (regla del proyecto); antes este bloque no revisaba el rol y mostraba la caja de todo el equipo + "Entregar caja". */}
        {!isAdmin&&(()=>{ const tiene=(pettyCash||[]).some(p=>p.user_name===currentUserName); if(!tiene) return null
          const saldo=saldoCajaChica(pettyCash,expenses,currentUserName)
          const pend=(expenses||[]).filter(e=>e.type==='gasto'&&e.created_by===currentUserName&&!e.rendered_at&&!e.paid_by_client)
          return (
          <div onClick={()=>onIrCajaChica&&onIrCajaChica()} className='lf-row' style={{display:'flex',alignItems:'center',gap:10,background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'11px 14px',marginBottom:10,cursor:onIrCajaChica?'pointer':'default'}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:saldo<0?C.overdue:(saldo<=(BRAND.cajaChicaUmbral||0)?C.soon:C.normal),flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>Mi caja chica</div>
              <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{saldo<0?`la oficina te debe ${fmtN(-saldo)}`:`disponible ${fmtN(saldo)}`}{pend.length?` · ${pend.length} sin liquidar`:''}</div>
            </div>
            <span style={{fontSize:12,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>Ver <Gl n='chevron'/></span>
          </div>) })()}
        {renderListaClientes({enHub:true})}
      </div>
    )
    if(D) return <div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{hubInner}{pedirModal}</div>
    return <div style={{background:C.bg,minHeight:'100%'}}>{hubInner}{pedirModal}</div>
  }
  // Notaría / Historial / Sin cliente: son SECCIONES sin lista maestra → van a todo el ancho (sin el 2-panel de clientes).
  if(isDesktop && (showNotaria||showHistorial||showOrphans||showGastosOficina)) return <div style={{height:'calc(100vh - 66px)',overflowY:'auto',background:C.bg}}>{body}</div>
  // Escritorio con un cliente abierto: la ficha va a todo el ancho, sin la lista de clientes al lado (pedido 2026-10-13); "← Clientes" vuelve a la lista.
  return body
}

// Revisión mensual de los gastos que el equipo cargó a la oficina. El revisor (miembros.revisa_gastos) confirma Oficina,
// los pasa a su cliente o marca "No sé", que sube a los socios. Compuerta humana: nada se mueve solo y todo se deshace en línea.
export function RevisionOficinaPage({items,setExpenses,clients,sales,clientEntities,me,isAdmin,revisor,onBack}){
  const isDesktop=useIsDesktop()
  const [pick,setPick]=useState(null)
  const [pq,setPq]=useState('')
  const [hechos,setHechos]=useState([])
  const ahora=()=>new Date().toISOString()
  // Bitácora de reasignaciones (misma tabla que "Reasignar gastos"); no frena si falla.
  const auditar=(e,de,a)=>{ try{ supabase.from('expense_audit').insert({expense_id:e.id,from_client_id:de||null,to_client_id:a||null,concept:e.concept||null,amount:e.amount??null,moved_by:me||null}).then(()=>{},()=>{}) }catch(e){registrarError({origen:'accion',vista:'expense_audit',err:e})} }
  const antesDe=e=>({client_id:e.client_id,entity_id:e.entity_id||null,project:e.project||null,sale_id:e.sale_id||null,revision_estado:e.revision_estado||null,revisado_por:e.revisado_por||null,revisado_at:e.revisado_at||null})
  const marcar=async(e,estado)=>{
    const patch={revision_estado:estado,revisado_por:me||null,revisado_at:ahora()}
    const {error}=await supabase.from('expenses').update(patch).eq('id',e.id)
    if(error){ appAlert('No se pudo guardar: '+error.message); return }
    setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
    setHechos(h=>[{e,accion:estado,antes:antesDe(e)},...h])
  }
  const aCliente=async(e,c)=>{
    setPick(null); setPq('')
    // Proyecto solo si no hay duda (única venta o única activa); si no, queda para la ficha del cliente.
    const vs=(sales||[]).filter(s=>s.client_id===c.id&&VENTA_REAL(s)); const act=vs.filter(s=>s.status==='Activo'); const v=vs.length===1?vs[0]:(act.length===1?act[0]:null)
    const patch={client_id:c.id,revision_estado:'cliente',revisado_por:me||null,revisado_at:ahora(),entity_id:v?.entity_id||(clientEntities||[]).find(x=>x.client_id===c.id)?.id||null,project:v?v.title:null,sale_id:v?v.id:null}
    const {error}=await supabase.from('expenses').update(patch).eq('id',e.id)
    if(error){ appAlert('No se pudo mover: '+error.message); return }
    setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
    auditar(e,e.client_id,c.id)
    const gk=glosaKey(e.concept||''); if(gk) learnPut('gasto_cliente',gk,c.id)
    setHechos(h=>[{e,accion:'cliente',cli:c,antes:antesDe(e)},...h])
  }
  const deshacer=async h=>{
    const {error}=await supabase.from('expenses').update(h.antes).eq('id',h.e.id)
    if(error){ appAlert('No se pudo deshacer: '+error.message); return }
    if(h.accion==='cliente') auditar(h.e,h.cli?.id,h.antes.client_id)
    setExpenses(p=>p.map(x=>x.id===h.e.id?{...x,...h.antes}:x))
    setHechos(l=>l.filter(x=>x!==h))
  }
  const hechosIds=new Set(hechos.map(h=>h.e.id))
  const vivos=items.filter(e=>!hechosIds.has(e.id))
  const pend=vivos.filter(e=>!e.revision_estado)
  const nose=vivos.filter(e=>e.revision_estado==='nose')
  const porMes=l=>{ const m={}; l.forEach(e=>{ const k=String(e.date||'').slice(0,7); (m[k]=m[k]||[]).push(e) }); return Object.entries(m).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,x])=>[k,x.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))]) }
  const MES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const mesLbl=k=>{ const [y,m]=k.split('-'); return MES[+m-1]?`${MES[+m-1]} ${y}`:'Sin fecha' }
  const chip={display:'inline-flex',alignItems:'center',height:isDesktop?26:32,padding:'0 12px',borderRadius:8,fontSize:12,fontWeight:700,border:'none',cursor:'pointer',fontFamily:'inherit',background:C.azulTenue,color:C.accent,whiteSpace:'nowrap'}
  const acciones=e=>(
    <div style={{display:'flex',gap:6,flexWrap:'wrap',flexShrink:0}}>
      <button type='button' onClick={()=>{setPick(pick===e.id?null:e.id);setPq('')}} style={pick===e.id?{...chip,background:C.azulTenueOn}:chip}>Cliente</button>
      <button type='button' onClick={()=>marcar(e,'oficina')} style={chip}>Oficina</button>
      {!isAdmin&&e.revision_estado!=='nose'&&<button type='button' onClick={()=>marcar(e,'nose')} style={{...chip,background:'transparent',color:C.muted}}>No sé</button>}
    </div>)
  const buscaCli=e=>{ const ms=pq.trim()?(clients||[]).filter(c=>!c.is_internal&&_normTxt(c.name).includes(_normTxt(pq))).slice(0,6):[]
    return (<div style={{marginTop:8,marginLeft:54}}>
      <Inp value={pq} onChange={x=>setPq(x.target.value)} placeholder='Buscar cliente…' autoFocus style={{height:34,fontSize:13}}/>
      {ms.length>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:4,overflow:'hidden'}}>{ms.map((c,i)=><button key={c.id} type='button' onClick={()=>aCliente(e,c)} style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',border:'none',borderTop:i?`1px solid ${C.track}`:'none',background:C.surface,fontSize:13,cursor:'pointer',fontFamily:'inherit',color:C.text}}>{c.name}</button>)}</div>}
    </div>) }
  const fila=(e,i)=>(
    <div key={e.id} style={{padding:'10px 12px',borderTop:i?`1px solid ${C.track}`:'none'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        {diaGrande(e.date)}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13.5,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
          <div style={{fontSize:11.5,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{[e.created_by,e.category,e.revision_estado==='nose'&&e.revisado_por?`${e.revisado_por} no supo`:null].filter(Boolean).join(' · ')}</div>
        </div>
        {isDesktop&&acciones(e)}
        <span style={{fontWeight:700,fontSize:14,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap',minWidth:isDesktop?90:0,textAlign:'right'}}>{fmt(e.amount)}</span>
      </div>
      {!isDesktop&&<div style={{marginLeft:54,marginTop:8}}>{acciones(e)}</div>}
      {pick===e.id&&buscaCli(e)}
    </div>)
  const bloque=(titulo,lista)=>lista.length>0&&(
    <div style={{marginBottom:18}}>
      {titulo&&<div style={{...SEC_LBL,margin:'4px 2px 8px'}}>{titulo}</div>}
      {porMes(lista).map(([k,l])=>(
        <div key={k} style={{marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:12.5,fontWeight:700,color:C.accent,margin:'0 2px 6px'}}><span>{mesLbl(k)}</span><span style={{color:C.muted,fontWeight:600,fontVariantNumeric:'tabular-nums'}}>{l.length} · {fmt(l.reduce((a,e)=>a+(Number(e.amount)||0),0))}</span></div>
          <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{l.map(fila)}</div>
        </div>))}
    </div>)
  return (
    <FlujoPagina origen='Gastos' titulo='Revisión de oficina' onBack={onBack} maxW={900}>
      {isAdmin&&bloque('Para decidir',nose)}
      {bloque(isAdmin?`En revisión${revisor?` de ${revisor}`:''}`:null,pend)}
      {!pend.length&&!(isAdmin&&nose.length)&&<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,textAlign:'center',fontSize:13,color:C.greenText}}>Todo revisado</div>}
      {hechos.length>0&&<div style={{marginTop:6}}>
        <div style={{...SEC_LBL,margin:'4px 2px 8px'}}>Revisados ahora</div>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
          {hechos.map((h,i)=><div key={h.e.id+i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',fontSize:12.5}}>
            <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{h.e.concept||'—'}</span>
            <span style={{color:C.muted,whiteSpace:'nowrap'}}>{h.accion==='cliente'?`→ ${h.cli?.name}`:h.accion==='oficina'?'Oficina':'No sé'}</span>
            <button type='button' onClick={()=>deshacer(h)} style={{border:'none',background:'none',color:C.accent,fontWeight:600,fontSize:12,cursor:'pointer',fontFamily:'inherit',padding:0}}>Deshacer</button>
          </div>)}
        </div>
      </div>}
    </FlujoPagina>)
}

// Descarga un archivo de Drive como base64 (para reenviar adjuntos ya guardados, ej. comprobante de notaría). Devuelve {base64,mime,ext} o null.
export async function driveDownloadB64(token, fileId){
  try{
    let mime='application/octet-stream'
    try{ const meta=await driveGet(token,`https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType`); if(meta&&meta.mimeType) mime=meta.mimeType }catch(_){}
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,{headers:{Authorization:'Bearer '+token}})
    if(!r.ok) return null
    const buf=new Uint8Array(await r.arrayBuffer())
    let bin=''; const CH=8192; for(let i=0;i<buf.length;i+=CH){ bin+=String.fromCharCode.apply(null, buf.subarray(i,i+CH)) }
    const ext = mime.includes('pdf')?'pdf':(mime.includes('png')?'png':((mime.includes('jpeg')||mime.includes('jpg'))?'jpg':'dat'))
    return { base64: btoa(bin), mime, ext }
  }catch(_){ return null }
}

// Hoja de liquidación de notaría con formato corporativo: título navy, encabezados, bordes, zebra y moneda CLP.
export function buildLiquidacionExcelWS(XLSX, {gastos, clients, titulo, sub}){
  const NAVY='003C50', WHITE='FFFFFF', LINE='E4E8EB', ZEBRA='F5F7F9', TXT='3D3D3D', MUT='537281', AZ='185FA5'
  const fmtOt = ot => ot?(String(ot).toUpperCase().startsWith('OT')?ot:'OT-'+ot):'—'
  const gs=[...gastos].sort((a,b)=>(a.ot_number||'')>(b.ot_number||'')?1:-1)
  // Abogado = responsable interno del cliente: la notaría sabe por quién va cada OT al leer el detalle, sin decirlo en el correo.
  const cliOf = e => clients.find(c=>String(c.id)===String(e.client_id))
  const rows=gs.map(e=>[fmtOt(e.ot_number), e.concept||'—', cliOf(e)?.name||'Sin cliente', cliOf(e)?.abogado_responsable||'—', e.amount||0])
  const total=gs.reduce((a,e)=>a+(e.amount||0),0)
  const ws=XLSX.utils.aoa_to_sheet([[titulo,'','','',''],[sub||'','','','',''],['OT','Descripción','Cliente','Abogado','Costo'],...rows,['','','','Total',total]])
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:4}},{s:{r:1,c:0},e:{r:1,c:4}}]
  ws['!cols']=[{wch:15},{wch:52},{wch:24},{wch:13},{wch:15}]
  ws['!rows']=[{hpt:28},{hpt:16},{hpt:20}]
  const bd={top:{style:'thin',color:{rgb:LINE}},bottom:{style:'thin',color:{rgb:LINE}},left:{style:'thin',color:{rgb:LINE}},right:{style:'thin',color:{rgb:LINE}}}
  const S=(addr,s)=>{ if(ws[addr]) ws[addr].s=s }
  S('A1',{font:{bold:true,sz:14,color:{rgb:WHITE}},fill:{patternType:'solid',fgColor:{rgb:NAVY}},alignment:{horizontal:'left',vertical:'center'}})
  S('A2',{font:{sz:10,italic:true,color:{rgb:MUT}},alignment:{horizontal:'left',vertical:'center'}})
  ;['A3','B3','C3','D3','E3'].forEach((a,i)=>S(a,{font:{bold:true,sz:11,color:{rgb:WHITE}},fill:{patternType:'solid',fgColor:{rgb:NAVY}},alignment:{horizontal:i===4?'right':'left',vertical:'center'},border:bd}))
  const n=rows.length
  for(let i=0;i<n;i++){ const r=4+i; const z=i%2===1?{fill:{patternType:'solid',fgColor:{rgb:ZEBRA}}}:{}
    S('A'+r,{font:{sz:10,bold:true,color:{rgb:AZ}},alignment:{horizontal:'left',vertical:'center'},border:bd,...z})
    S('B'+r,{font:{sz:10,color:{rgb:TXT}},alignment:{horizontal:'left',vertical:'center',wrapText:true},border:bd,...z})
    S('C'+r,{font:{sz:10,color:{rgb:MUT}},alignment:{horizontal:'left',vertical:'center'},border:bd,...z})
    S('D'+r,{font:{sz:10,color:{rgb:MUT}},alignment:{horizontal:'left',vertical:'center'},border:bd,...z})
    const d='E'+r; if(ws[d]){ ws[d].t='n'; ws[d].z='"$"#,##0'; ws[d].s={font:{sz:10,color:{rgb:TXT}},numFmt:'"$"#,##0',alignment:{horizontal:'right',vertical:'center'},border:bd,...z} }
  }
  const tr=4+n
  S('D'+tr,{font:{bold:true,sz:11,color:{rgb:TXT}},alignment:{horizontal:'right',vertical:'center'},border:{top:{style:'medium',color:{rgb:NAVY}}}})
  const dt='E'+tr; if(ws[dt]){ ws[dt].t='n'; ws[dt].z='"$"#,##0'; ws[dt].s={font:{bold:true,sz:12,color:{rgb:NAVY}},numFmt:'"$"#,##0',alignment:{horizontal:'right',vertical:'center'},border:{top:{style:'medium',color:{rgb:NAVY}}}} }
  return ws
}

// Excel de liquidación en base64 (para adjuntar al correo de la notaría).
export async function liquidacionExcelB64({gastos, clients, titulo, sub}){
  const XLSX=await loadXLSXStyle()
  const ws=buildLiquidacionExcelWS(XLSX,{gastos,clients,titulo,sub})
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Notaría')
  return XLSX.write(wb,{bookType:'xlsx',type:'base64'})
}

