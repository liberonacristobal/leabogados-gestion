// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { BRAND, C, Gl, SEC_LBL, SIcon, _normTxt, appAlert, personChip, useIsDesktop } from '../lib/base.jsx'
import { INICIALES_RESP, MESES_ABR, MESES_LG, NOMBRE_CLI, RendicionModal, TIT_PAG, UF_FALLBACK, claudeCall, driveGet, driveToken, enviarComoUsuario, esCorreoOficina, esRecurrente, extraerTextoGmail, fmtUF, isAssignee, margenDeSale, okDB, txtEnviado, useUF, ventaUFmesDe } from '../lib/compartido.jsx'

// FUENTE ÚNICA del documento de rendición (HTML imprimible). La usan el historial ("Ver PDF")
// y RendicionModal (al enviar), para que ambos PDFs sean idénticos. Recibe datos ya normalizados.
// gastos: [{date,concept,category,amount}] · fondos: [{date,concept,amount}]
// Reporte de horas al cliente (Fase 2) — statement mensual. forPrint=true envuelve con botón de imprimir; si no, sirve como cuerpo de correo.
export function horasReporteHtml({ razon, periodo, dirigidoA, entradas, estimadas, consumidas, lang='es', forPrint=false }){
  const A='#003C50', GRAY='#E4E8EB', MUTED='#537281', TXT='#3D3D3D'
  const EN = lang==='en'
  const T = EN ? {title:'Hours Report', date:'Date', desc:'Description', by:'By', hours:'Hours', total:'Total hours', est:'Included', cons:'Consumed', bal:'Balance', over:'Over', attn:'Attn', print:'Print / Save PDF'}
             : {title:'Reporte de horas', date:'Fecha', desc:'Descripción', by:'Abogado', hours:'Horas', total:'Total de horas', est:'Incluidas', cons:'Consumidas', bal:'Saldo', over:'Excedido', attn:'Dirigido a', print:'Imprimir / Guardar PDF'}
  const fh = n => (Math.round((Number(n)||0)*10)/10).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})
  const _mEs=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'], _mEn=['January','February','March','April','May','June','July','August','September','October','November','December']
  const _pp=String(periodo||'').split('-'), _mi=(+_pp[1]||0)-1
  const perFmt = (_mi>=0&&_pp[0]) ? (EN?_mEn[_mi]:_mEs[_mi])+' '+_pp[0] : (periodo||'')
  const rows = (entradas||[]).map(h=>`<tr><td style='padding:6px 8px;border-bottom:1px solid #EFF1F3'>${String(h.fecha||'').split('-').reverse().join('-')}</td><td style='padding:6px 8px;border-bottom:1px solid #EFF1F3'>${String(h.glosa||'').replace(/</g,'&lt;')}</td><td style='padding:6px 8px;border-bottom:1px solid #EFF1F3'>${String(h.user_name||'').replace(/</g,'&lt;')}</td><td style='padding:6px 8px;border-bottom:1px solid #EFF1F3;text-align:right'>${fh(h.horas)}</td></tr>`).join('')
  const total = (entradas||[]).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const saldo = (Number(estimadas)||0) - (Number(consumidas)||0)
  const over = saldo < 0
  const body = `<div style='max-width:600px;margin:0 auto;font-family:DM Sans,Arial,sans-serif;color:${TXT}'>
    <div style='background:${A};padding:18px 24px;display:flex;justify-content:space-between;align-items:center'><img src='${location.origin}${BRAND.logo.blanco}' alt='${BRAND.nombre}' style='height:26px;display:block'/><div style='text-align:right;color:#fff'><div style='font-size:13px;font-weight:700'>${razon||''}</div><div style='font-size:10px;opacity:.85'>${T.title} · ${perFmt}</div></div></div>
    ${dirigidoA?`<div style='background:${GRAY};padding:7px 24px;font-size:10px;color:${TXT}'>${T.attn}: ${dirigidoA}</div>`:''}
    <div style='padding:18px 24px'>
      <table style='width:100%;border-collapse:collapse;font-size:11px'><thead><tr style='color:${MUTED};text-transform:uppercase;font-size:9px'><th style='text-align:left;padding:6px 8px;border-bottom:1px solid ${GRAY}'>${T.date}</th><th style='text-align:left;padding:6px 8px;border-bottom:1px solid ${GRAY}'>${T.desc}</th><th style='text-align:left;padding:6px 8px;border-bottom:1px solid ${GRAY}'>${T.by}</th><th style='text-align:right;padding:6px 8px;border-bottom:1px solid ${GRAY}'>${T.hours}</th></tr></thead><tbody>${rows}</tbody></table>
      <div style='display:flex;justify-content:space-between;padding:8px;border-top:1.5px solid ${A};font-weight:700;font-size:12px;margin-top:2px'><span>${T.total}</span><span>${fh(total)} h</span></div>
      <div style='display:flex;gap:8px;margin-top:14px'>
        <div style='flex:1;background:#F5F7F9;border-radius:8px;padding:9px;text-align:center'><div style='font-size:14px;font-weight:700;color:${A}'>${fh(estimadas)}</div><div style='font-size:8px;color:${MUTED};text-transform:uppercase'>${T.est}</div></div>
        <div style='flex:1;background:#F5F7F9;border-radius:8px;padding:9px;text-align:center'><div style='font-size:14px;font-weight:700;color:${A}'>${fh(consumidas)}</div><div style='font-size:8px;color:${MUTED};text-transform:uppercase'>${T.cons}</div></div>
        <div style='flex:1;background:${over?'#FCEBEB':'#E1F5EE'};border-radius:8px;padding:9px;text-align:center'><div style='font-size:14px;font-weight:700;color:${over?C.overdueText:C.greenText}'>${fh(Math.abs(saldo))}</div><div style='font-size:8px;color:${MUTED};text-transform:uppercase'>${over?T.over:T.bal}</div></div>
      </div>
    </div>
    <div style='padding:12px 24px;border-top:1px solid ${GRAY};font-size:9px;color:${MUTED};display:flex;justify-content:space-between'><span>${BRAND.direccionCalle} · ${BRAND.web}</span><span>${perFmt}</span></div>
  </div>`
  if(!forPrint) return body
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'><title>${T.title} — ${razon||''}</title><style>@media print{.no-print{display:none}}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}</style></head><body style='margin:0;background:#fff'>${body}<button class='print-btn no-print' onclick='window.print()'>${T.print}</button></body></html>`
}

// Captura automática de horas (client-side): correos ENVIADOS (trabajo hecho) + documentos de Drive modificados
// hace poco. Devuelve propuestas {source,source_ref,client_id,glosa,horas,fecha,tag}; el humano confirma/edita (compuerta).
// Heurística sobria: correo = 0,2 h c/u (agrupa por cliente y día); documento = 0,5 h. Nunca inventa horas ni cliente.
export async function capturaHorasFuentes(token, clients=[], dias=2){
  const norm = s => _normTxt(s)
  const genericDom = d => /^(gmail|hotmail|outlook|yahoo|icloud|live|me|proton|protonmail)\./.test(d+'.') || ['gmail.com','hotmail.com','outlook.com','yahoo.com','icloud.com','live.com'].includes(d)
  const activos = clients.filter(c=>c.status!=='Terminado')
  const cliByEmail = raw => { const em=String(raw||'').toLowerCase().trim(); if(!em.includes('@')||esCorreoOficina(em)) return null
    let c=activos.find(x=>String(x.email||'').toLowerCase()===em); if(c) return String(c.id)
    const dom=em.split('@')[1]||''; if(dom&&!genericDom(dom)){ c=activos.find(x=>String(x.email||'').toLowerCase().split('@')[1]===dom); if(c) return String(c.id) }
    return null }
  const cliByName = txt => { const t=norm(txt); const c=activos.find(x=>{ const n=norm(x.name); return n.length>2 && t.includes(n) }); return c?String(c.id):null }
  const out=[]
  // ── Gmail: enviados de los últimos 2 días ──
  try{
    const q=encodeURIComponent('in:sent newer_than:'+dias+'d -in:chats')
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=60`,{headers:{Authorization:'Bearer '+token}})
    if(r.ok){ const j=await r.json(); const ids=(j.messages||[]).map(m=>m.id).slice(0,60)
      const msgs=[]
      const fetchMeta=async id=>{ try{ const rr=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`,{headers:{Authorization:'Bearer '+token}}); if(!rr.ok) return; const jj=await rr.json(); const H={}; (jj.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value); const fecha=jj.internalDate?new Date(Number(jj.internalDate)).toLocaleDateString('en-CA',{timeZone:'America/Santiago'}):null; const dest=(H['to']||'').split(',').map(s=>{const m=s.match(/<(.+?)>/);return (m?m[1]:s).trim()}).filter(Boolean); let cid=null; for(const d of dest){ cid=cliByEmail(d); if(cid) break } msgs.push({id,cid,subject:H['subject']||'(sin asunto)',fecha}) }catch(_){}}
      for(let i=0;i<ids.length;i+=8){ await Promise.all(ids.slice(i,i+8).map(fetchMeta)) }
      const grupos={}
      msgs.forEach(m=>{ if(!m.cid||!m.fecha) return; const k=m.cid+'|'+m.fecha; (grupos[k]=grupos[k]||{cid:m.cid,fecha:m.fecha,subs:[],ids:[]}); grupos[k].subs.push(m.subject); grupos[k].ids.push(m.id) })
      Object.values(grupos).forEach(g=>{ const n=g.ids.length; const horas=Math.min(1.5,Math.max(0.2,Math.round(n*0.2*10)/10)); out.push({ source:'gmail', source_ref:g.ids.sort().join(','), client_id:g.cid, tag:'CORREO', titulo:n>1?`${n} correos · ${g.subs[0]}`:g.subs[0], glosa:n>1?`${n} correos enviados`:('Correo: '+g.subs[0]), horas, fecha:g.fecha }) })
    }
  }catch(_){}
  // ── Drive: documentos modificados en las últimas 48 h (donde puedo escribir) ──
  try{
    const cut=new Date(Date.now()-dias*864e5).toISOString()
    const dq=encodeURIComponent(`modifiedTime > '${cut}' and trashed=false and mimeType != 'application/vnd.google-apps.folder' and 'me' in writers`)
    const data=await driveGet(token,`https://www.googleapis.com/drive/v3/files?q=${dq}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=40&supportsAllDrives=true&includeItemsFromAllDrives=true`)
    ;(data?.files||[]).forEach(f=>{ const cid=cliByName(f.name); const fecha=String(f.modifiedTime||'').slice(0,10); if(!fecha) return; out.push({ source:'drive', source_ref:f.id, client_id:cid, tag:'DOCUMENTO', titulo:f.name, glosa:'Documento: '+f.name, horas:0.5, fecha }) })
  }catch(_){}
  return out
}

export function HorasView({ clients=[], sales=[], tasks=[], terceros=[], billing=[], currentUserName, isAdmin, onOpenClientFicha, onOpenCostosOfi }){
  const isDesktop = useIsDesktop()   // Fase 3: columna más ancha en escritorio
  const me = currentUserName || ''
  const [horas,setHoras] = useState([])
  const [manual,setManual] = useState(false)
  const [mq,setMq] = useState('')
  const [mf,setMf] = useState({client_id:'',fecha:'',horas:1,glosa:'',billable:true})
  // Registro rápido (adopción): cliente → proyecto → horas → registrar, en 2 toques.
  const [qC,setQC]=useState(null),[qS,setQS]=useState(null),[qH,setQH]=useState(1),[qGlo,setQGlo]=useState(''),[qGloOpen,setQGloOpen]=useState(false),[qBill,setQBill]=useState(true),[qOtro,setQOtro]=useState('')
  const [dur,setDur] = useState({})
  // Horas de asesoría permanente AUTODEFINIDAS: horas/mes = ceil(valor asesoría ÷ tarifa hora).
  // Tarifa = 3 UF/h (config del estudio, learnings); las asesorías en pesos se convierten con la UF del primer día hábil del año.
  const [tarifaUF,setTarifaUF] = useState(3)
  const [ufAnio,setUfAnio] = useState(0)
  const ufHoy = useUF().uf || UF_FALLBACK
  const hoy = new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})
  const mesActual = hoy.slice(0,7)
  const mesLabel = ym => { const p=String(ym||'').split('-'); return (MESES_LG[(+p[1]||1)-1]||'')+(p[0]?' '+p[0]:'') }   // 'Agosto 2026'
  const fFecha = iso => { const p=String(iso||'').split('-'); return p[2]?(+p[2])+' '+(MESES_ABR[(+p[1]||1)-1]||'').toLowerCase():String(iso||'') }   // '27 ago'
  const cn = id => clients.find(c=>String(c.id)===String(id))?.name || 'Cliente'
  const f0 = n => '$'+Math.round(n||0).toLocaleString('es-CL')
  const fh = n => (Math.round((Number(n)||0)*10)/10).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})+' h'
  // Valor mensual de la asesoría en UF (fuente: la venta recurrente); pesos → UF del primer día hábil del año.
  const ufAnioEff = ufAnio>0 ? ufAnio : ufHoy
  const ventaUFmes = s => ventaUFmesDe(s, ufAnioEff)
  const estDe = s => { const u=ventaUFmes(s), t=tarifaUF||3; return u>0&&t>0 ? Math.ceil(u/t) : 0 }   // horas/mes autodefinidas (redondeo hacia arriba)
  const saleDe = cid => permanentes.find(p=>String(p.cid)===String(cid))?.sale
  // Propuestas descartadas (la app APRENDE): lo que botas no vuelve a proponerse. Clave = source:ref | tarea:id | coord:cid.
  const [desc,setDesc] = useState(()=>new Set())
  const descartar = key => { setDesc(s=>{ const n=new Set(s); n.add(key); return n }); setAgenda(a=>a.filter(x=>x.id!==key)); if(DEMO) return; try{ supabase.from('learnings').insert({kind:'horas_descartado',key,value:'1'}) }catch(_){} }

  useEffect(()=>{
    if(DEMO){ setHoras(demoData.horas||[]); setTarifaUF(3); setUfAnio(UF_FALLBACK); return }
    let ok=true
    supabase.from('horas').select('*').order('fecha',{ascending:false}).then(({data})=>{ if(ok&&data) setHoras(data) },()=>{})
    supabase.from('learnings').select('key,value').eq('kind','config').in('key',['tarifa_hora_permanente_uf','uf_anio_'+mesActual.slice(0,4)]).then(({data})=>{ if(!ok||!data) return; const t=data.find(r=>r.key==='tarifa_hora_permanente_uf'); const u=data.find(r=>String(r.key).startsWith('uf_anio_')); if(t&&parseFloat(t.value)>0) setTarifaUF(parseFloat(t.value)); if(u&&parseFloat(u.value)>0) setUfAnio(parseFloat(u.value)) },()=>{})
    supabase.from('learnings').select('key').eq('kind','horas_descartado').then(({data})=>{ if(ok&&data) setDesc(new Set(data.map(r=>r.key))) },()=>{})
    return ()=>{ ok=false }
  },[])

  const permanentes = useMemo(()=>{ const m={}; sales.forEach(s=>{ if(esRecurrente(s)&&s.client_id) m[String(s.client_id)]=s }); return Object.entries(m).map(([cid,s])=>({cid,sale:s})) },[sales])
  // Detector de fugas: tareas terminadas en los últimos días (por mí) sin hora cargada aún.
  const misTareasHoy = useMemo(()=>{ const c=new Date(hoy+'T00:00:00'); c.setDate(c.getDate()-3); const cut=c.toISOString().slice(0,10)
    return (tasks||[]).filter(t=>{ const d=String(t.completed_at||'').slice(0,10); return d>=cut && d<=hoy && (isAssignee(t,me)||t.who===me) }).filter(t=> !horas.some(h=>h.source==='tarea'&&String(h.source_ref)===String(t.id)) && !desc.has('tarea:'+t.id)) }, [tasks,horas,me,hoy,desc])
  const misHoras = useMemo(()=> (isAdmin?horas:horas.filter(h=>h.user_name===me)), [horas,isAdmin,me])
  const semana = useMemo(()=>{ const d=new Date(hoy+'T00:00:00'); const dow=(d.getDay()+6)%7; const lun=new Date(d); lun.setDate(d.getDate()-dow); const li=lun.toISOString().slice(0,10); return misHoras.filter(h=> (h.fecha||'')>=li) }, [misHoras,hoy])
  const totSem = semana.reduce((a,h)=>a+(Number(h.horas)||0),0)

  async function addHora(row){
    const full = { user_name:me, billable:true, source:'manual', created_by:me, ...row }
    if(DEMO){ setHoras(p=>[{ id:'h'+Date.now(), created_at:new Date().toISOString(), ...full },...p]); return }
    const { data,error } = await supabase.from('horas').insert(full).select().single()
    if(error||!data){ appAlert('No se pudo guardar: '+(error?.message||'')); return }
    setHoras(p=>[data,...p])
  }
  const registrarTarea = t => addHora({ client_id:t.client_id, fecha:String(t.completed_at||'').slice(0,10)||hoy, horas:(dur[t.id]||1), glosa:t.title||'', source:'tarea', source_ref:String(t.id) })
  // A2 — Cronómetro en vivo. Persiste en localStorage (sobrevive navegación/recarga); al detener pre-llena el registro.
  const [timer,setTimer] = useState(()=>{ try{ const t=JSON.parse(localStorage.getItem('horas_timer')||'null'); return t&&t.startMs?t:null }catch(_){ return null } })
  const [tq,setTq] = useState(''); const [,forceTick] = useState(0)
  useEffect(()=>{ if(!timer) return; const i=setInterval(()=>forceTick(x=>x+1),1000); return ()=>clearInterval(i) },[timer])
  const persistTimer = t => { try{ t?localStorage.setItem('horas_timer',JSON.stringify(t)):localStorage.removeItem('horas_timer') }catch(_){}; setTimer(t) }
  const startTimer = () => persistTimer({ startMs:Date.now(), clientId:'', clientName:'' })
  const cancelTimer = () => { persistTimer(null); setTq('') }
  const stopTimer = () => { const ms=Date.now()-(timer?.startMs||Date.now()); const h=Math.max(0.1,Math.round(ms/360000)/10); setMf({ client_id:timer?.clientId||'', fecha:hoy, horas:h, glosa:'', billable:true }); setManual(true); persistTimer(null); setTq('') }
  const elapsedTxt = () => { const s=Math.max(0,Math.floor((Date.now()-(timer?.startMs||Date.now()))/1000)); const p=n=>String(n).padStart(2,'0'); return `${p(Math.floor(s/3600))}:${p(Math.floor(s%3600/60))}:${p(s%60)}` }
  // E1 — Editar / corregir / borrar una hora (con deshacer).
  const [editH,setEditH] = useState(null); const [ef,setEf] = useState({}); const [eq,setEq] = useState(''); const [undoH,setUndoH] = useState(null)
  const abrirEdit = h => { setEditH(h.id); setEf({ client_id:h.client_id, fecha:h.fecha, horas:h.horas, glosa:h.glosa||'', billable:h.billable!==false }); setEq('') }
  const guardarEdit = async () => { const patch={ client_id:ef.client_id, fecha:ef.fecha, horas:parseFloat(ef.horas)||0, glosa:ef.glosa, billable:!!ef.billable }; setHoras(p=>p.map(x=>x.id===editH?{...x,...patch}:x)); const id=editH; setEditH(null); if(DEMO) return; try{ okDB(await supabase.from('horas').update(patch).eq('id',id),'guardar las horas') }catch(e){ appAlert('No se pudo guardar: '+e.message) } }
  const borrarHora = async h => { setHoras(p=>p.filter(x=>x.id!==h.id)); setEditH(null); setUndoH(h); if(DEMO) return; try{ if(!okDB(await supabase.from('horas').delete().eq('id',h.id),'borrar las horas')){ setHoras(p=>[h,...p]); setUndoH(null) } }catch(_){} }
  const deshacerBorrar = async () => { const h=undoH; setUndoH(null); if(!h) return; setHoras(p=>[h,...p]); if(DEMO) return; const {id,created_at,report_id,...rest}=h; try{ const r=await supabase.from('horas').insert(rest).select().single(); if(!okDB(r,'restaurar las horas')) setHoras(p=>p.filter(x=>x.id!==h.id)); else if(r.data) setHoras(p=>p.map(x=>x.id===h.id?r.data:x)) }catch(_){} }
  useEffect(()=>{ if(undoH){ const t=setTimeout(()=>setUndoH(null),6000); return ()=>clearTimeout(t) } },[undoH])
  // F4 — Exportar mis horas a CSV (separador ';' y coma decimal para Excel es-CL; BOM para acentos).
  const exportarCSV = () => {
    const esc = v => { const s=String(v==null?'':v); return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s }
    const head = ['fecha','cliente','horas','glosa','facturable','abogado','fuente']
    const body = misHoras.map(h=>[h.fecha, cn(h.client_id), String(Number(h.horas)||0).replace('.',','), h.glosa||'', h.billable===false?'no':'si', h.user_name||'', h.source||''].map(esc).join(';'))
    const csv = '﻿'+[head.join(';'),...body].join('\n')
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a'); a.href=url; a.download='horas_'+hoy+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500)
  }
  // Read-back del calendario (Fase 3): lee la agenda del día y propone entradas (duración = duración del evento).
  const [agenda,setAgenda] = useState([]); const [agLoading,setAgLoading]=useState(false); const [agDone,setAgDone]=useState(false); const [agq,setAgq]=useState({})
  const stripLegal = s => _normTxt(s).replace(/\b(spa|s a|ltda|limitada|sa|eirl|e i r l|y cia|cia|inversiones|abogados)\b/g,'').replace(/\s+/g,' ').trim()
  const matchCli = ev => { const t=stripLegal(ev.titulo||''); const byName=clients.find(c=>{ const n=stripLegal(c.name); return c.status!=='Terminado'&&n.length>2&&t.includes(n) }); if(byName) return String(byName.id); const doms=(ev.asistentes||[]).map(a=>String(a).split('@')[1]||'').filter(Boolean); const byMail=clients.find(c=>c.email&&doms.includes(String(c.email).split('@')[1]||'')); return byMail?String(byMail.id):null }
  // "Revisar mi día": junta agenda (calendario) + correos enviados (Gmail) + documentos recientes (Drive) → propuestas de horas.
  async function revisarAgenda(scope='dia'){
    const esSemana = scope==='semana'
    setAgLoading(true); setAgDone(false)
    try{
      let props=[]
      if(DEMO){ props=[
        {source:'calendar',source_ref:'ev1',tag:'AGENDA',titulo:'Reunión asesoría mensual — Comercial Andes SpA',descripcion:'Revisión de estados de causas y próximos vencimientos.',fecha:hoy,horas:1,asistentes:[]},
        {source:'calendar',source_ref:'ev2',tag:'AGENDA',titulo:'Audiencia preparatoria Tech Araucanía',descripcion:'',fecha:hoy,horas:2,asistentes:[]},
        {source:'gmail',source_ref:'g1',tag:'CORREO',titulo:'3 correos · Contrato de arriendo',glosa:'3 correos enviados',fecha:hoy,horas:0.6,client_id:'c1'},
        {source:'drive',source_ref:'d1',tag:'DOCUMENTO',titulo:'Minuta societaria Tech Araucanía.docx',glosa:'Documento: Minuta societaria Tech Araucanía.docx',fecha:hoy,horas:0.5,client_id:'c4'},
      ]; if(esSemana){ const d2=new Date(hoy+'T12:00'); d2.setDate(d2.getDate()-2); const f2=d2.toISOString().slice(0,10); props.push(
        {source:'calendar',source_ref:'ev3',tag:'AGENDA',titulo:'Reunión de directorio — Viñedos del Maipo',descripcion:'',fecha:f2,horas:1.5,asistentes:[]},
        {source:'gmail',source_ref:'g2',tag:'CORREO',titulo:'Correo · Envío de escritura de compraventa',glosa:'1 correo enviado',fecha:f2,horas:0.3,client_id:'c5'}
      ) } }
      else {
        const token=await driveToken(); if(!token){ appAlert('Para leer tu agenda, cierra sesión y vuelve a entrar con tu cuenta de Google.'); setAgLoading(false); return }
        const lun=new Date(hoy+'T12:00'); lun.setDate(lun.getDate()-((lun.getDay()+6)%7)); const lunI=lun.toISOString().slice(0,10)
        const diasSem = ((new Date(hoy+'T12:00').getDay()+6)%7)+1
        const tMin = esSemana ? lunI+'T00:00:00' : hoy+'T00:00:00'
        try{
          const url=`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date(tMin).toISOString())}&timeMax=${encodeURIComponent(new Date(hoy+'T23:59:59').toISOString())}&singleEvents=true&orderBy=startTime`
          const r=await fetch(url,{headers:{Authorization:'Bearer '+token}})
          if(r.status===401){ appAlert('Tu sesión de Google expiró. Cierra sesión y vuelve a entrar.'); setAgLoading(false); return }
          if(r.ok){ const j=await r.json(); (j.items||[]).filter(e=>e.status!=='cancelled'&&(e.summary||'').trim()&&e.start?.dateTime&&e.end?.dateTime).forEach(e=>props.push({ source:'calendar', source_ref:e.id, tag:'AGENDA', titulo:e.summary, descripcion:e.description||'', fecha:String(e.start.dateTime||'').slice(0,10), horas:Math.max(0.1,Math.round((new Date(e.end.dateTime)-new Date(e.start.dateTime))/360000)/10), asistentes:(e.attendees||[]).map(a=>a.email).filter(Boolean) })) }
        }catch(_){}
        try{ const extra=await capturaHorasFuentes(token, clients, esSemana?diasSem:2); props.push(...extra) }catch(_){}
      }
      const conCli = props.map(p=> p.client_id!==undefined ? p : {...p, client_id:matchCli(p)})
      const nuevos = conCli.filter(p=> !desc.has(p.source+':'+p.source_ref) && !horas.some(h=>h.source===p.source && String(h.source_ref)===String(p.source_ref)))
      const items=nuevos.map(p=>({...p, id:p.source+':'+p.source_ref})); setAgenda(items); setAgDone(true)
      redactarIA(items)   // A1: la IA redacta glosa + duración de los correos/documentos (progresivo)
    }catch(e){ appAlert('No se pudo leer tu día: '+(e.message||e)) }
    setAgLoading(false)
  }
  const registrarAgenda = ev => { if(!ev.client_id){ appAlert('Elige el cliente.'); return } addHora({ client_id:ev.client_id, fecha:ev.fecha||hoy, horas:ev.horas||0.2, glosa:ev.glosa||ev.titulo, source:ev.source||'calendar', source_ref:String(ev.source_ref||ev.id) }); setAgenda(a=>a.filter(x=>x.id!==ev.id)) }
  const bumpAg = (id,delta) => setAgenda(a=>a.map(ev=>ev.id===id?{...ev,horas:Math.max(0.1,Math.round(((ev.horas||1)+delta)*10)/10)}:ev))
  // A1 — la IA lee el CONTENIDO (cuerpo del correo / texto del documento) y redacta la glosa facturable + estima la duración.
  async function redactarIA(items){
    const targets = items.filter(p=> p.source==='gmail'||p.source==='drive'||p.source==='calendar'||p.source==='pega')
    if(!targets.length) return
    const keepHoras = x => x.source==='calendar'   // en reuniones la duración es la del evento; la IA solo redacta la glosa
    setAgenda(a=>a.map(x=> targets.some(t=>t.id===x.id)?{...x,iaLoading:true}:x))
    try{
      let withContent
      if(DEMO){
        await new Promise(r=>setTimeout(r,1000))
        const demoOut = { 'gmail:g1':{glosa:'Revisión y comentarios al borrador de contrato de arriendo; coordinación de observaciones con la contraparte.',horas:1.3}, 'drive:d1':{glosa:'Preparación de minuta societaria y revisión de estatutos de la sociedad.',horas:1.5}, 'calendar:ev1':{glosa:'Reunión mensual de asesoría: revisión de estado de causas y próximos vencimientos.'}, 'calendar:ev2':{glosa:'Audiencia preparatoria: comparecencia y gestión ante el tribunal.'}, 'calendar:ev3':{glosa:'Reunión de directorio: asistencia y minuta de acuerdos.'} }
        setAgenda(a=>a.map(x=>{ const o=demoOut[x.id]; return o?{...x,glosa:o.glosa,horas:keepHoras(x)?x.horas:(o.horas??x.horas),ia:true,iaLoading:false}:(targets.some(t=>t.id===x.id)?{...x,iaLoading:false}:x) }))
        return
      }
      const token = await driveToken().catch(()=>null)
      if(!token){ setAgenda(a=>a.map(x=> targets.some(t=>t.id===x.id)?{...x,iaLoading:false}:x)); return }
      withContent = []
      for(const p of targets){
        let content=''
        try{
          if(p.source==='gmail'){ const ids=String(p.source_ref||'').split(',').filter(Boolean).slice(0,3); for(const id of ids){ const rr=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,{headers:{Authorization:'Bearer '+token}}); if(rr.ok) content+=' '+extraerTextoGmail(await rr.json()) } }
          else if(p.source==='drive'){ const rr=await fetch(`https://www.googleapis.com/drive/v3/files/${p.source_ref}/export?mimeType=text/plain&supportsAllDrives=true`,{headers:{Authorization:'Bearer '+token}}); if(rr.ok) content=await rr.text() }
          else if(p.source==='calendar'){ content = p.descripcion||'' }
          else if(p.source==='pega'){ content = p.contenido||'' }
        }catch(_){}
        withContent.push({ id:p.id, tipo:p.tag, titulo:p.titulo, contenido:((content||'')+' '+(p.titulo||'')).replace(/\s+/g,' ').trim().slice(0,2200) })
      }
      const prompt=`Eres asistente de un abogado chileno. Para CADA ítem escribe una "glosa" facturable BREVE (1 sola línea, español jurídico de Chile, describe la gestión efectivamente realizada; NO inventes datos ni cifras que no aparezcan en el contenido; sin exagerar) y estima "horas" dedicadas (número entre 0.1 y 8 según el trabajo). Devuelve SOLO un JSON array [{"id":"<id>","glosa":"...","horas":<num>}].\nITEMS: ${JSON.stringify(withContent)}`
      const j=await claudeCall({model:'claude-opus-4-8',max_tokens:1200,messages:[{role:'user',content:prompt}]})
      const txt=j?.content?.[0]?.text||''; const m=txt.match(/\[[\s\S]*\]/); const arr=m?JSON.parse(m[0]):[]
      setAgenda(a=>a.map(x=>{ const o=arr.find(y=>String(y.id)===String(x.id)); if(!o) return targets.some(t=>t.id===x.id)?{...x,iaLoading:false}:x; const h=keepHoras(x)?x.horas:Math.max(0.1,Math.min(8,parseFloat(o.horas)||x.horas)); return {...x, glosa:o.glosa||x.glosa, horas:h, ia:true, iaLoading:false} }))
    }catch(_){ setAgenda(a=>a.map(x=> targets.some(t=>t.id===x.id)?{...x,iaLoading:false}:x)) }
  }
  // A4 — "Pegar y redactar": pegas un chat de WhatsApp / correo / nota y la IA arma glosa + horas + cliente.
  const [pega,setPega] = useState(false); const [pegaTxt,setPegaTxt] = useState(''); const [pegaBusy,setPegaBusy] = useState(false)
  async function redactarPegado(){
    const t = pegaTxt.trim(); if(!t) return
    setPegaBusy(true)
    try{
      let glosa='', hh=0.5, cid=null
      if(DEMO){ await new Promise(r=>setTimeout(r,900)); glosa='Coordinación con el cliente por WhatsApp sobre el estado del contrato y próximos pasos.'; hh=0.4; cid='c1' }
      else{
        const lista = clients.filter(c=>c.status!=='Terminado').map(c=>({id:c.id,nombre:c.name})).slice(0,400)
        const prompt=`Eres asistente de un abogado chileno. Del siguiente texto (chat de WhatsApp, correo o nota) escribe una "glosa" facturable BREVE (1 línea, español jurídico de Chile; describe la gestión; NO inventes), estima "horas" (0.1 a 8) y elige el "client_id" de la lista si es claro (si no, null). Devuelve SOLO JSON {"glosa":"...","horas":<num>,"client_id":"<id o null>"}.\nCLIENTES: ${JSON.stringify(lista)}\nTEXTO: ${t.slice(0,4000)}`
        const j=await claudeCall({model:'claude-opus-4-8',max_tokens:400,messages:[{role:'user',content:prompt}]})
        const txt=j?.content?.[0]?.text||''; const m=txt.match(/\{[\s\S]*\}/); const o=m?JSON.parse(m[0]):{}
        glosa=o.glosa||'Gestión registrada desde una nota.'; hh=Math.max(0.1,Math.min(8,parseFloat(o.horas)||0.5)); cid=(o.client_id&&clients.some(c=>String(c.id)===String(o.client_id)))?String(o.client_id):null
      }
      const ref='n'+Date.now()
      setAgenda(a=>[{ id:'pega:'+ref, source:'pega', source_ref:ref, tag:'NOTA', titulo:t.slice(0,90), glosa, horas:hh, fecha:hoy, client_id:cid, ia:true }, ...a])
      setPega(false); setPegaTxt(''); setAgDone(true)
    }catch(e){ appAlert('No se pudo redactar: '+(e.message||e)) }
    setPegaBusy(false)
  }
  // Fase 4 (INTERNA, formato oficina): panel de equipo + rentabilidad YTD. Solo admin.
  const [vista,setVista] = useState('mias')     // mias | equipo | ytd
  const [mView,setMView] = useState('semana')   // semana | mes
  const [metas,setMetas] = useState({})         // meta horas/semana por persona
  const [metaEdit,setMetaEdit] = useState(null)
  const [metaUnit,setMetaUnit] = useState('semana')   // ajustable: la meta se ingresa en h/día o h/semana (se guarda semanal)
  useEffect(()=>{
    if(DEMO){ setMetas({'Cristóbal':40,'Erasmo':40,'Martín':40,'Martina':40,'Rodrigo':30}); return }
    supabase.from('learnings').select('key,value').eq('kind','meta_horas').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ m[r.key]=Number(r.value)||0 }); setMetas(m) },()=>{})
  },[])
  async function setMeta(name,val){ const v=Number(val)||0; setMetas(m=>({...m,[name]:v})); if(DEMO) return; try{ await supabase.from('learnings').delete().eq('kind','meta_horas').eq('key',name); await supabase.from('learnings').insert({kind:'meta_horas',key:name,value:String(v)}) }catch(_){} }
  const EQUIPO = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  const lunISO = (()=>{ const d=new Date(hoy+'T00:00:00'); const dow=(d.getDay()+6)%7; d.setDate(d.getDate()-dow); return d.toISOString().slice(0,10) })()
  const horasPeriodo = name => horas.filter(h=> h.user_name===name && (mView==='mes' ? String(h.fecha||'').startsWith(mesActual) : (h.fecha||'')>=lunISO)).reduce((a,h)=>a+(Number(h.horas)||0),0)
  // D3 — horas facturables del período (excluye las marcadas no facturables). Métrica de utilización que de verdad importa.
  const horasPeriodoFact = name => horas.filter(h=> h.user_name===name && h.billable!==false && (mView==='mes' ? String(h.fecha||'').startsWith(mesActual) : (h.fecha||'')>=lunISO)).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const bookingDe = name => (tasks||[]).filter(t=> t.status!=='Terminado' && (isAssignee(t,name)||t.who===name)).length
  const metaPeriodo = name => { const w=Number(metas[name])||0; return mView==='mes'? Math.round(w*4.33) : w }
  // Vista calendario del equipo (pantalla 8): grilla semana × persona con carga (horas + tareas del día).
  const [eqView,setEqView] = useState('carga')   // carga (barras) | agenda (calendario)
  const [wkOff,setWkOff] = useState(0)            // semanas de desplazamiento
  const [cellSel,setCellSel] = useState(null)     // {name,iso} para detalle
  // Interruptor del recordatorio de viernes por correo (cron horas-recordatorio). 'off' · 'on' (equipo) · iniciales.
  const [recVal,setRecVal] = useState('off'); const [recMsg,setRecMsg] = useState('')
  const recOn = recVal!=='off'
  useEffect(()=>{ if(DEMO){ setRecVal('on'); return } supabase.from('learnings').select('value').eq('kind','config').eq('key','recordatorio_horas').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ setRecVal((data?.value||'off').trim()||'off') },()=>{}) },[])
  const setRec = async v => { const prev=recVal; setRecVal(v); if(DEMO) return; try{ await supabase.from('learnings').delete().eq('kind','config').eq('key','recordatorio_horas'); await supabase.from('learnings').insert({kind:'config',key:'recordatorio_horas',value:v}) }catch(e){ setRecVal(prev); appAlert('No se pudo guardar: '+e.message) } }
  const enviarPruebaRec = async () => { setRecMsg('Enviando…'); if(DEMO){ setRecMsg('En demo no se envía.'); setTimeout(()=>setRecMsg(''),4000); return }
    try{ const {data:{session}}=await supabase.auth.getSession(); const res=await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/horas-recordatorio',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?.access_token||''),'apikey':supabase.supabaseKey},body:JSON.stringify({})}); const j=await res.json().catch(()=>({})); if(!res.ok) throw new Error(j.error||('Error '+res.status)); setRecMsg('Listo — revisa tu correo.') }catch(e){ setRecMsg('No se pudo: '+(e?.message||'reintenta')) }
    setTimeout(()=>setRecMsg(''),6000) }
  const weekMon = (()=>{ const d=new Date(lunISO+'T00:00:00'); d.setDate(d.getDate()+wkOff*7); return d.toISOString().slice(0,10) })()
  const weekDias = (()=>{ const d=new Date(weekMon+'T00:00:00'); return [0,1,2,3,4].map(i=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+i).toISOString().slice(0,10)) })()
  const horasDiaDe = (name,iso) => horas.filter(h=>h.user_name===name && h.fecha===iso).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const tareasDiaDe = (name,iso) => (tasks||[]).filter(t=>t.due===iso && t.status!=='Terminado' && (isAssignee(t,name)||t.who===name))
  const anioAct = mesActual.slice(0,4)
  const mesesYTD = (new Date().getMonth()+1)
  const ytdData = permanentes.map(({cid,sale})=>{ const estMes=estDe(sale); const est=estMes*mesesYTD; const valorUF=tarifaUF||3
    const hCli=horas.filter(h=>String(h.client_id)===String(cid)&&String(h.fecha||'').slice(0,4)===anioAct); const cons=hCli.reduce((a,h)=>a+(Number(h.horas)||0),0)
    // Sobre-cupos MENSUALES (el balde se llena cada mes; no netear). `exceso`=sobre-trabajo TOTAL (esfuerzo);
    // `excesoFact`=lo FACTURABLE de ese sobre-trabajo (lo que podrías cobrar; cobrarlo es opcional).
    let excesoMeses=0, excesoFactMeses=0
    for(let m=1;m<=mesesYTD;m++){ const mm=anioAct+'-'+String(m).padStart(2,'0'); const hm=hCli.filter(h=>String(h.fecha||'').slice(0,7)===mm); const cm=hm.reduce((a,h)=>a+(Number(h.horas)||0),0); const cmF=hm.filter(h=>h.billable!==false).reduce((a,h)=>a+(Number(h.horas)||0),0); excesoMeses+=Math.max(0,cm-estMes); excesoFactMeses+=Math.max(0,cmF-estMes) }
    const exCLP=Math.round(excesoFactMeses*valorUF*ufHoy); return { cid, est, cons, over:cons>est, exceso:excesoMeses, excesoFact:excesoFactMeses, valorUF, exCLP, sinCfg:estMes<=0 } })
  const excedenteYTD = ytdData.reduce((a,d)=>a+(d.exCLP||0),0)
  // ── Apuesta 3 f1 — Margen real por cliente: ingreso (honorario) − costo (horas × costo/hora del abogado, en pesos). ──
  const [costoHora,setCostoHora] = useState({})   // nombre → costo/hora en pesos (lo define el usuario)
  const [costosOpen,setCostosOpen] = useState(false)
  useEffect(()=>{ if(DEMO){ setCostoHora({'Cristóbal':18000,'Erasmo':18000,'Martín':11250,'Martina':6159}); return } supabase.from('learnings').select('key,value').eq('kind','costo_hora').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ m[r.key]=Number(r.value)||0 }); setCostoHora(m) },()=>{}) },[])
  async function setCosto(name,val){ const v=Math.max(0,Math.round(parseFloat(val)||0)); setCostoHora(m=>({...m,[name]:v})); if(DEMO) return; try{ await supabase.from('learnings').delete().eq('kind','costo_hora').eq('key',name); await supabase.from('learnings').insert({kind:'costo_hora',key:name,value:String(v)}) }catch(_){} }
  const hayCostos = Object.values(costoHora).some(v=>Number(v)>0)
  // ── Apuesta 3 f2 — Costo CARGADO: suma el overhead de oficina (Costos de Oficina, sin remuneraciones) prorrateado por hora. ──
  const [costosOfi,setCostosOfi] = useState([])
  const [cargarOverhead,setCargarOverhead] = useState(true)   // por defecto el margen usa el costo CARGADO (real neto); el toggle permite ver solo-sueldo
  const ym0mes = new Date().toISOString().slice(0,7)
  useEffect(()=>{ if(DEMO){ setCostosOfi([
      {categoria:'Arriendo y espacio',item:'Arriendo',monto:2780000},{categoria:'Arriendo y espacio',item:'Subarriendo',monto:2000000,es_ingreso:true},
      {categoria:'Servicios y tecnología',item:'Internet',monto:34200},{categoria:'Impuestos y patentes',item:'PPM',monto:800000}]); return }
    supabase.from('costos_oficina').select('categoria,item,monto,es_ingreso,desde,monto_prev').eq('activo',true).then(({data})=>setCostosOfi(data||[]),()=>{}) },[])
  const effCosto = r => (r.desde && ym0mes < String(r.desde).slice(0,7)) ? (r.monto_prev??r.monto) : r.monto
  const overheadMes = costosOfi.filter(r=>!['Remuneraciones','Leyes sociales'].includes(r.categoria)).reduce((a,r)=>a+(r.es_ingreso?-1:1)*effCosto(r),0)
  // Solo el equipo CON COSTO (costo/hora definido) absorbe el overhead — excluye colaboradores externos (ej. quien no genera costo de oficina). Configurable, sin nombres cableados.
  const metasSemTot = EQUIPO.filter(n=>Number(costoHora[n])>0).reduce((a,n)=>a+(Number(metas[n])||0),0)
  const capacidadMes = metasSemTot*4.33 || (DEMO?560:0)   // horas/mes del equipo con costo (Σ metas semanales ×4,33)
  const overheadHora = capacidadMes>0 ? overheadMes/capacidadMes : 0
  const hayOverhead = overheadMes>0 && capacidadMes>0
  const [ohOpen,setOhOpen] = useState(false)   // desglose del overhead por categoría (clickeable → Costos de Oficina)
  const overheadPorCat = useMemo(()=>{ const m={}; costosOfi.filter(r=>!['Remuneraciones','Leyes sociales'].includes(r.categoria)).forEach(r=>{ m[r.categoria]=(m[r.categoria]||0)+(r.es_ingreso?-1:1)*effCosto(r) }); return Object.entries(m).map(([cat,mes])=>({cat,mes,hora:capacidadMes>0?mes/capacidadMes:0})).filter(x=>x.mes!==0).sort((a,b)=>b.mes-a.mes) },[costosOfi,capacidadMes])
  const margenData = useMemo(()=> permanentes.map(({sale})=> margenDeSale(sale, horas, costoHora, cargarOverhead?overheadHora:0, mesesYTD, ufHoy, ufAnioEff, anioAct, terceros, billing)),
    [permanentes, horas, costoHora, mesesYTD, ufHoy, ufAnioEff, anioAct, cargarOverhead, overheadHora, terceros, billing])
  const margenTot = margenData.filter(d=>!d.sinIng).reduce((a,d)=>({ing:a.ing+d.ingCLP,costo:a.costo+d.costoCLP,margen:a.margen+d.margen}),{ing:0,costo:0,margen:0})
  // ④ Rentabilidad por abogado: valor generado (horas facturables × tarifa) vs costo cargado (horas × costo/hora cargado).
  const tarifaCLP = (Number(tarifaUF)||3) * ufHoy
  const margenAbogado = useMemo(()=> EQUIPO.filter(n=>Number(costoHora[n])>0).map(name=>{
    const hs = horas.filter(h=>h.user_name===name && String(h.fecha||'').slice(0,4)===anioAct)
    const horasTot = hs.reduce((a,h)=>a+(Number(h.horas)||0),0)
    const horasFact = hs.filter(h=>h.billable!==false).reduce((a,h)=>a+(Number(h.horas)||0),0)
    const cargado = (Number(costoHora[name])||0) + (hayOverhead?overheadHora:0)
    const costo = Math.round(horasTot*cargado), genera = Math.round(horasFact*tarifaCLP)
    const margen = genera-costo, pct = genera>0?Math.round(margen/genera*100):0
    return { name, horasTot, horasFact, costo, genera, margen, pct }
  }).filter(x=>x.horasTot>0).sort((a,b)=>b.margen-a.margen), [horas, costoHora, overheadHora, hayOverhead, anioAct, tarifaCLP])
  const [margenTab,setMargenTab] = useState('cliente')   // Rentabilidad: una sola lista con tabs Por cliente / Por abogado (antes eran dos listas apiladas)
  const exportYTD = () => {
    const rows=ytdData.filter(d=>!d.sinCfg).map(d=>`<tr><td style='padding:6px 10px;border-bottom:1px solid #EFF1F3'>${cn(d.cid).replace(/</g,'&lt;')}</td><td style='padding:6px 10px;border-bottom:1px solid #EFF1F3;text-align:right'>${fh(d.est)} h</td><td style='padding:6px 10px;border-bottom:1px solid #EFF1F3;text-align:right'>${fh(d.cons)} h</td><td style='padding:6px 10px;border-bottom:1px solid #EFF1F3;text-align:right;font-weight:700;color:${d.exCLP>0?'#A32D2D':'#537281'}'>${d.exCLP>0?f0(d.exCLP):'—'}</td><td style='padding:6px 10px;border-bottom:1px solid #EFF1F3;font-weight:700;color:${d.exCLP>0?'#A32D2D':'#0F6E56'}'>${d.exCLP>0?'Reajustar':'OK'}</td></tr>`).join('')
    const heroExc = excedenteYTD>0?`<div style='background:#F5F7F9;border-radius:8px;padding:12px 14px;margin-bottom:16px'><div style='font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#537281;font-weight:700'>Podrías haber facturado · ${anioAct}</div><div style='font-size:22px;font-weight:800;color:#003C50;margin-top:2px'>${f0(excedenteYTD)}</div><div style='font-size:10px;color:#537281;margin-top:2px'>Trabajo facturable por sobre lo incluido cada mes, a tu valor hora (cobrarlo es opcional). Base para el reajuste ${Number(anioAct)+1}.</div></div>`:''
    const html=`<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Rentabilidad permanentes — uso interno</title><style>@media print{.no-print{display:none}}.print-btn{position:fixed;bottom:20px;right:20px;background:#003C50;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-weight:600;cursor:pointer}</style></head><body style='margin:0;font-family:DM Sans,Arial,sans-serif;color:#3D3D3D;background:#fff'><div style='max-width:640px;margin:0 auto'><div style='background:#003C50;color:#fff;padding:18px 24px;display:flex;justify-content:space-between;align-items:center'><div><div style='font-size:15px;font-weight:700'>${BRAND.nombre}</div><div style='font-size:10px;opacity:.85'>Rentabilidad de asesorías permanentes · YTD ${anioAct}</div></div><span style='font-size:10px;font-weight:700;background:#E24B4A;padding:3px 9px;border-radius:5px'>USO INTERNO</span></div><div style='padding:20px 24px'>${heroExc}<table style='width:100%;border-collapse:collapse;font-size:12px'><thead><tr style='color:#537281;text-transform:uppercase;font-size:9px'><th style='text-align:left;padding:6px 10px;border-bottom:1px solid #E4E8EB'>Cliente</th><th style='text-align:right;padding:6px 10px;border-bottom:1px solid #E4E8EB'>Incluidas YTD</th><th style='text-align:right;padding:6px 10px;border-bottom:1px solid #E4E8EB'>Consumidas YTD</th><th style='text-align:right;padding:6px 10px;border-bottom:1px solid #E4E8EB'>Podrías facturar</th><th style='text-align:left;padding:6px 10px;border-bottom:1px solid #E4E8EB'>Acción</th></tr></thead><tbody>${rows}</tbody></table><div style='margin-top:16px;font-size:10px;color:#537281'>Documento de uso interno de la oficina — no distribuir al cliente. Base para revisar tarifas ${Number(anioAct)+1}.</div></div></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button></body></html>`
    const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() }
  }
  const guardarManual = () => { if(!mf.client_id||!(Number(mf.horas)>0)){ appAlert('Elige cliente y horas.'); return } addHora({ client_id:mf.client_id, fecha:mf.fecha||hoy, horas:Number(mf.horas), glosa:mf.glosa, billable:mf.billable }); setManual(false); setMf({client_id:'',fecha:'',horas:1,glosa:'',billable:true}); setMq('') }
  const guardarRapido = () => { if(!qC){ appAlert('Elige el cliente.'); return } if(!(Number(qH)>0)){ appAlert('Elige las horas.'); return } addHora({ client_id:qC, sale_id:qS||null, fecha:hoy, horas:Number(qH), glosa:qGlo, billable:qBill, source:'rapido' }); setQC(null); setQS(null); setQH(1); setQGlo(''); setQGloOpen(false); setQBill(true); setQOtro('') }
  const bump = (id,delta) => setDur(p=>({...p,[id]:Math.max(0.1,Math.round(((p[id]||1)+delta)*10)/10)}))
  // Mejoras: Mi semana + recordatorio de viernes + coordinación del socio (sugerida, facturable).
  const dow = (new Date(hoy+'T00:00:00').getDay()+6)%7   // 0=lun … 6=dom
  const semDias = (()=>{ const d=new Date(lunISO+'T00:00:00'); return [0,1,2,3,4].map(i=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+i).toISOString().slice(0,10)) })()
  const misHorasDia = iso => horas.filter(h=>h.user_name===me && h.fecha===iso).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const misTareasDia = iso => (tasks||[]).filter(t=>t.due===iso && t.status!=='Terminado' && (isAssignee(t,me)||t.who===me)).length
  const misHorasSem = horas.filter(h=>h.user_name===me && (h.fecha||'')>=lunISO).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const delegadasHoy = (()=>{ if(!isAdmin) return []; const c=new Date(hoy+'T00:00:00'); c.setDate(c.getDate()-1); const cut=c.toISOString().slice(0,10)
    const del=(tasks||[]).filter(t=> t.assigned_by===me && t.client_id && String(t.created_at||'').slice(0,10)>=cut && !(isAssignee(t,me)||t.who===me))
    const by={}; del.forEach(t=>{ (by[String(t.client_id)]=by[String(t.client_id)]||[]).push(t) })
    return Object.entries(by).filter(([cid])=> !desc.has('coord:'+cid) && !horas.some(h=>h.source==='coordinacion'&&String(h.client_id)===cid&&h.fecha===hoy&&h.user_name===me)).map(([cid,ts])=>({cid,n:ts.length})) })()
  const registrarCoord = (cid,n) => addHora({ client_id:cid, fecha:hoy, horas:0.2, glosa:`Coordinación · delegación de ${n} tarea${n!==1?'s':''}`, source:'coordinacion', billable:true })
  const consumoMes = cid => horas.filter(h=>String(h.client_id)===String(cid)&&String(h.fecha||'').startsWith(mesActual)).reduce((a,h)=>a+(Number(h.horas)||0),0)
  // D2 — consumo FACTURABLE del mes (excluye las horas marcadas no facturables). Base del "podrías facturar".
  const consumoMesFact = cid => horas.filter(h=>String(h.client_id)===String(cid)&&h.billable!==false&&String(h.fecha||'').startsWith(mesActual)).reduce((a,h)=>a+(Number(h.horas)||0),0)
  // Excedente = inteligencia de repricing (no cobro): $ que no estamos cobrando según la propuesta (valor hora excedente).
  const excedenteCLP = (excesoH,valorUF) => Math.round((Number(excesoH)||0)*(Number(valorUF)||0)*ufHoy)
  const cliOpen = cid => onOpenClientFicha&&onOpenClientFicha(cid)
  // Reporte de horas al cliente (Fase 2). Solo el socio (admin) reporta = visado.
  const [rep,setRep] = useState(null)   // {cid,mes,para,lang,sending}
  const abrirReporte = cid => { const cl=clients.find(c=>String(c.id)===String(cid)); setRep({cid,mes:mesActual,para:cl?.email||'',lang:'es',sending:false}) }
  const entriesRep = (cid,mes) => horas.filter(h=>String(h.client_id)===String(cid)&&String(h.fecha||'').startsWith(mes))
  const verPdfRep = () => { const {cid,mes,lang}=rep; const ents=entriesRep(cid,mes); const html=horasReporteHtml({razon:cn(cid),periodo:mes,entradas:ents,estimadas:estDe(saleDe(cid)),consumidas:ents.reduce((a,h)=>a+(+h.horas||0),0),lang,forPrint:true}); const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() } }
  async function enviarReporte(){
    const {cid,mes,para,lang}=rep, ents=entriesRep(cid,mes)
    if(!ents.length){ appAlert('No hay horas cargadas en ese mes.'); return }
    if(!para||!/@/.test(para)){ appAlert('Ingresa el correo del cliente.'); return }
    setRep(r=>({...r,sending:true}))
    const razon=cn(cid), estMes=estDe(saleDe(cid)), cons=ents.reduce((a,h)=>a+(+h.horas||0),0)
    const html=horasReporteHtml({razon,periodo:mes,dirigidoA:para,entradas:ents,estimadas:estMes,consumidas:cons,lang})
    const subject=(lang==='en'?'Hours report':'Reporte de horas')+` · ${razon} · ${lang==='en'?mes:mesLabel(mes)}`
    if(DEMO){ appAlert('En demo no se envía; el reporte se armó correcto. Usa “Ver PDF” para verlo.'); setRep(null); return }
    try{
      const via=await enviarComoUsuario({to:para,subject,html,text:`${razon} · ${mes} · ${cons} h`})
      if(!via){ setRep(r=>({...r,sending:false})); return }
      const {data:rr}=await supabase.from('reportes_horas').insert({client_id:cid,periodo:mes,total_horas:cons,n_entradas:ents.length,dirigido_a:para,estimadas:estMes,consumidas:cons,estado_envio:'enviado',sent_at:new Date().toISOString(),sent_by:me}).select().single()
      if(rr?.id){ await supabase.from('horas').update({report_id:rr.id}).in('id',ents.map(e=>e.id)) }
      try{ await supabase.from('learnings').delete().eq('kind','horas_para').eq('key',String(cid)); await supabase.from('learnings').insert({kind:'horas_para',key:String(cid),value:para}) }catch(_){}
      appAlert(txtEnviado(via,{que:'Reporte',para})); setRep(null)
    }catch(e){ appAlert('No se pudo enviar: '+(e.message||e)); setRep(r=>({...r,sending:false})) }
  }
  const step = {display:'inline-flex',alignItems:'center',border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff'}
  const stepB = {width:26,height:30,display:'flex',alignItems:'center',justifyContent:'center',color:C.muted,fontSize:15,background:C.bgSoft,cursor:'pointer',userSelect:'none'}
  const inp = {width:'100%',height:38,border:`1px solid ${C.border}`,borderRadius:10,padding:'0 11px',fontSize:13,background:'#fff',color:C.text,boxSizing:'border-box',outline:'none'}
  const lbl = {fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.05em',margin:'2px 2px 8px'}

  // Ventas POR HORA: consumo real (tabla horas por sale_id) vs tope; alarma al acercarse/pasar el tope.
  const consumoVenta = (sid, periodo) => horas.filter(h=>String(h.sale_id)===String(sid) && (periodo!=='mes' || String(h.fecha||'').startsWith(mesActual))).reduce((a,h)=>a+(Number(h.horas)||0),0)
  const ventasPorHora = (sales||[]).filter(s=>s.cobro_type==='hora' && s.status==='Activo' && !s.deleted_at).map(s=>{
    const cc=s.cobro_config||{}; const tarifa=parseFloat(cc.tarifaHoraUF)||tarifaUF||3; const tope=parseInt(cc.topeHoras)||0; const periodo=cc.topePeriodo||'mes'
    const cons=consumoVenta(s.id,periodo); const pct=tope>0?cons/tope*100:0
    return { s, tarifa, tope, periodo, cons, pct, facturableUF:cons*tarifa }
  }).sort((a,b)=>b.pct-a.pct)
  return (
    <div style={{padding:'12px 14px 40px',maxWidth:isDesktop?940:560,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
        <div style={TIT_PAG}>Horas</div>
        <span style={{fontSize:11,color:C.textSoft}}>Esta semana: <b style={{color:C.accent}}>{fh(totSem)}</b></span>
      </div>
      {ventasPorHora.length>0 && <div style={{marginTop:12,marginBottom:4}}>
        <div style={{...SEC_LBL,margin:'0 2px 7px'}}>Ventas por hora · consumo y tope</div>
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}:{display:'flex',flexDirection:'column',gap:8}}>
          {ventasPorHora.map(({s,tarifa,tope,periodo,cons,pct,facturableUF})=>{
            const over=tope>0&&cons>tope, near=tope>0&&!over&&pct>=90
            const barCol=over?C.overdue:near?'#EF9F27':C.normal, stCol=over?C.overdueText:near?C.soonText:C.greenText, stBg=over?C.overdueBg:near?C.soonBg:C.greenBg
            return (
            <div key={s.id} onClick={()=>{ setVista('mias'); setQC(s.client_id); setQS(s.id); setTimeout(()=>document.getElementById('horas-reg')?.scrollIntoView({behavior:'smooth',block:'start'}),80) }} title='Registrar horas en este proyecto' style={{background:'#fff',border:`1px solid ${over?'#F3C9C4':near?'#EBD9AE':C.border}`,borderRadius:12,padding:'10px 12px',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:tope>0?8:0}}>
                <span style={{width:28,height:28,borderRadius:8,background:stBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={stCol} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><circle cx='12' cy='12' r='9'/><polyline points='12 7 12 12 15 14'/></svg></span>
                <div style={{flex:1,minWidth:0}}><div style={{...NOMBRE_CLI}}>{cn(s.client_id)}</div><div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div></div>
                {tope>0&&<span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:stBg,color:stCol,flexShrink:0,whiteSpace:'nowrap'}}>{Math.round(pct)}%</span>}
              </div>
              {tope>0
                ? <>
                  <div style={{fontSize:10,color:C.muted,marginTop:5}}>{fh(cons)} de {tope} h/{periodo==='total'?'total':'mes'}{isAdmin?` · ${tarifa} UF/h · facturable ≈ ${fmtUF(facturableUF)}`:''}{over?` · ${fh(cons-tope)} sobre el tope`:near?` · quedan ${fh(tope-cons)}`:''}</div>
                </>
                : <div style={{fontSize:10,color:C.muted,marginTop:6}}>{fh(cons)} este {periodo==='total'?'proyecto':'mes'}{isAdmin?` · ${tarifa} UF/h · facturable ≈ ${fmtUF(facturableUF)}`:''}{isAdmin?' · sin tope':''}</div>}
            </div>
            )})}
        </div>
      </div>}
      {(dow===3||dow===4) && <div style={{background:C.soonBg,borderRadius:12,padding:'10px 12px',marginBottom:12,display:'flex',alignItems:'center',gap:8}}><span style={{width:6,height:6,borderRadius:'50%',background:C.soonText,flexShrink:0}}/><span style={{flex:1,fontSize:12,color:C.soonText,fontWeight:600}}>{dow===4?'Es viernes':'Es jueves'} — llevas <b>{fh(misHorasSem)}</b> registradas esta semana. Revisa que no quede nada por registrar.</span></div>}
      {isAdmin && <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden',marginBottom:14}}>{[['mias','Mis horas'],['equipo','Equipo'],['ytd','Rentabilidad']].map(([k,l])=><button key={k} onClick={()=>setVista(k)} style={{fontSize:11,fontWeight:700,padding:'5px 13px',border:'none',background:vista===k?C.accent:'#fff',color:vista===k?'#fff':C.muted,cursor:'pointer'}}>{l}</button>)}</div>}

      {isAdmin && vista==='equipo' && <>
        <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden',marginBottom:12}}>{[['carga','Carga'],['agenda','Calendario']].map(([k,l])=><button key={k} onClick={()=>setEqView(k)} style={{fontSize:11,fontWeight:700,padding:'5px 14px',border:'none',background:eqView===k?C.accent:'#fff',color:eqView===k?'#fff':C.muted,cursor:'pointer'}}>{l}</button>)}</div>

        {eqView==='carga' && <>
        <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:20,overflow:'hidden',marginBottom:12,marginLeft:8}}>{[['semana','Semana'],['mes','Mes']].map(([k,l])=><button key={k} onClick={()=>setMView(k)} style={{fontSize:11,fontWeight:700,padding:'5px 14px',border:'none',background:mView===k?C.accent:'#fff',color:mView===k?'#fff':C.muted,cursor:'pointer'}}>{l}</button>)}</div>
        <div style={{...SEC_LBL,margin:'0 2px 8px'}}>Horas reales vs meta · {mView==='mes'?'mes':'semana'}</div>
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',columnGap:8,alignItems:'start'}:undefined}>
        {EQUIPO.map(name=>{ const real=horasPeriodo(name); const fact=horasPeriodoFact(name); const factPct=real>0?Math.round(fact/real*100):0; const meta=metaPeriodo(name); const pct=meta>0?Math.round(real/meta*100):0; const book=bookingDe(name); const col=personChip(name).color; const util=pct>100?C.overdue:pct>=70?C.normal:'#EF9F27'; return (
          <div key={name} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:7}}>
              <span style={{width:24,height:24,borderRadius:'50%',background:col,color:'#fff',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{INICIALES_RESP[name]||name.slice(0,2)}</span>
              <span style={{fontSize:13,fontWeight:700,color:C.text}}>{name}</span>
              <span style={{marginLeft:'auto',fontSize:11,fontWeight:700,color:pct>100?C.overdueText:C.greenText,fontVariantNumeric:'tabular-nums'}}>{meta>0?pct+'%':'sin meta'}</span>
            </div>
            <div style={{height:8,borderRadius:6,background:C.bgSoft,overflow:'hidden'}}><span style={{display:'block',height:'100%',width:Math.min(100,pct)+'%',background:util,borderRadius:6}}/></div>
            <div style={{fontSize:10,color:C.textSoft,marginTop:5,display:'flex',justifyContent:'space-between'}}><span>{fh(real)} de {meta?fh(meta):'—'} · {book} tarea{book!==1?'s':''} abierta{book!==1?'s':''}</span><span onClick={()=>setMetaEdit(metaEdit===name?null:name)} style={{color:C.azulInfo,fontWeight:700,cursor:'pointer'}}>meta</span></div>
            {real>0 && <div style={{fontSize:10,marginTop:3,fontWeight:600,color:factPct>=70?C.greenText:factPct>=40?C.soonText:C.overdueText}}>{fh(fact)} facturables · {factPct}% del tiempo{factPct<70?' · revisar':''}</div>}
            {metaEdit===name && (()=>{ const dia=metaUnit==='dia'; const wk=Number(metas[name])||0; return <div style={{marginTop:7,display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:11,color:C.muted}}>Meta</span>
              <input key={name+metaUnit} type='number' step='0.5' defaultValue={dia?(wk?+(wk/5).toFixed(1):''):(wk||'')} onBlur={e=>{ const v=parseFloat(e.target.value)||0; setMeta(name, dia? Math.round(v*5*10)/10 : v); setMetaEdit(null) }} style={{...inp,height:32,width:72,textAlign:'right'}} autoFocus/>
              <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>{[['dia','h/día'],['semana','h/sem']].map(([u,l])=><span key={u} onMouseDown={e=>{e.preventDefault();setMetaUnit(u)}} style={{fontSize:11,padding:'6px 9px',fontWeight:700,cursor:'pointer',background:metaUnit===u?C.accent:'#fff',color:metaUnit===u?'#fff':C.muted}}>{l}</span>)}</div>
              <span style={{fontSize:10,color:C.textSoft}}>{dia?'× 5 días':'se guarda semanal'}</span>
            </div> })()}
          </div>
        )})}</div>
        {(()=>{ const libres=EQUIPO.filter(n=>{ const m=metaPeriodo(n); return m>0 && horasPeriodo(n)/m < 0.7 }); if(!libres.length) return null; return <div style={{background:C.greenBg,borderRadius:12,padding:'10px 12px',fontSize:12,color:C.greenText,lineHeight:1.5,marginTop:2}}><b style={{color:C.accent}}>{libres.join(', ')}</b> con holgura {mView==='mes'?'este mes':'esta semana'}. Buen momento para ofrecer más al cliente o tomar un nuevo encargo.</div> })()}
        </>}

        {eqView==='agenda' && (()=>{ const MD=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return <>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <button onClick={()=>setWkOff(o=>o-1)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,width:30,height:30,fontSize:15,color:C.muted,cursor:'pointer'}}><Gl n='chevL'/></button>
            <span style={{fontSize:12,fontWeight:700,color:C.accent}}>{wkOff===0?'Esta semana':wkOff===1?'Próxima semana':wkOff===-1?'Semana pasada':`Semana del ${new Date(weekMon+'T00:00').getDate()} ${MD[new Date(weekMon+'T00:00').getMonth()]}`}</span>
            <button onClick={()=>setWkOff(o=>o+1)} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,width:30,height:30,fontSize:15,color:C.muted,cursor:'pointer'}}><Gl n='chevron'/></button>
          </div>
          <div style={{overflowX:'auto',WebkitOverflowScrolling:'touch'}}><div style={{minWidth:420}}>
            <div style={{display:'grid',gridTemplateColumns:'58px repeat(5,1fr)',gap:3,marginBottom:3}}>
              <div/>{weekDias.map(iso=>{ const dd=new Date(iso+'T00:00'); const isHoy=iso===hoy; return <div key={iso} style={{textAlign:'center',fontSize:9,fontWeight:700,color:isHoy?C.azulInfo:C.done,textTransform:'uppercase'}}>{['lun','mar','mié','jue','vie'][weekDias.indexOf(iso)]}<div style={{fontSize:11,color:isHoy?C.azulInfo:C.muted}}>{dd.getDate()}</div></div> })}
            </div>
            {EQUIPO.map(name=>{ const col=personChip(name).color; return (
              <div key={name} style={{display:'grid',gridTemplateColumns:'58px repeat(5,1fr)',gap:3,marginBottom:3,alignItems:'stretch'}}>
                <div style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:20,height:20,borderRadius:'50%',background:col,color:'#fff',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{INICIALES_RESP[name]||name.slice(0,2)}</span></div>
                {weekDias.map(iso=>{ const h=horasDiaDe(name,iso); const tk=tareasDiaDe(name,iso); const load=h+tk.length*1.5; const bg=load<=0?'#fff':load<3?C.greenBg:load<6?C.ambarBg:C.overdueBg; const tc=load<3?C.greenText:load<6?C.soonText:C.overdueText; const sel=cellSel&&cellSel.name===name&&cellSel.iso===iso; const empty=h<=0&&tk.length===0; return (
                  <div key={iso} onClick={()=>!empty&&setCellSel(sel?null:{name,iso})} style={{background:bg,border:`1px solid ${sel?C.accent:(iso===hoy?C.azulInfo+'55':C.border)}`,borderRadius:8,minHeight:38,padding:'4px 2px',textAlign:'center',cursor:empty?'default':'pointer'}}>
                    {h>0&&<div style={{fontSize:11,fontWeight:700,color:tc,fontVariantNumeric:'tabular-nums'}}>{fh(h).replace(' h','')}</div>}
                    {tk.length>0&&<div style={{fontSize:8,color:h>0?tc:C.soonText,marginTop:h>0?0:6}}>{tk.length} plazo{tk.length!==1?'s':''}</div>}
                    {empty&&<div style={{fontSize:11,color:'#C4CDD2',marginTop:6}}>·</div>}
                  </div>
                )})}
              </div>
            )})}
          </div></div>
          {cellSel && (()=>{ const h=horas.filter(x=>x.user_name===cellSel.name&&x.fecha===cellSel.iso); const tk=tareasDiaDe(cellSel.name,cellSel.iso); const dd=new Date(cellSel.iso+'T00:00'); return (
            <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginTop:10}}>
              <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:7}}>{cellSel.name} · {['lun','mar','mié','jue','vie','sáb','dom'][(dd.getDay()+6)%7]} {dd.getDate()} {MD[dd.getMonth()]}</div>
              {h.map(x=><div key={x.id} onClick={()=>cliOpen(x.client_id)} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`,cursor:onOpenClientFicha?'pointer':'default'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><b style={{color:C.text}}>{cn(x.client_id)}</b><span style={{color:C.textSoft}}>{x.glosa?' · '+x.glosa:''}</span></span><span style={{color:C.accent,fontWeight:700,flexShrink:0,marginLeft:8}}>{fh(x.horas)}</span></div>)}
              {tk.map(t=><div key={t.id} onClick={()=>cliOpen(t.client_id)} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`,cursor:onOpenClientFicha?'pointer':'default'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><span style={{fontSize:8,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:6,padding:'1px 5px',marginRight:5}}>PLAZO</span><b style={{color:C.text}}>{cn(t.client_id)}</b><span style={{color:C.textSoft}}>{t.title?' · '+t.title:''}</span></span></div>)}
              {h.length===0&&tk.length===0&&<div style={{fontSize:11,color:C.textSoft}}>Sin carga ese día.</div>}
            </div>
          )})()}
          <div style={{fontSize:10,color:C.textSoft,marginTop:9,display:'flex',gap:10,flexWrap:'wrap'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:9,height:9,borderRadius:4,background:C.greenBg,border:`1px solid ${C.border}`}}/>Liviano</span><span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:9,height:9,borderRadius:4,background:C.ambarBg,border:`1px solid ${C.border}`}}/>Cargado</span><span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:9,height:9,borderRadius:4,background:C.overdueBg,border:`1px solid ${C.border}`}}/>Muy cargado</span></div>
        </>})()}

        {/* Recordatorio de viernes por correo (cron horas-recordatorio) — interruptor + prueba */}
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 13px',marginTop:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:C.text}}>Recordatorio de viernes por correo</div><div style={{fontSize:11,color:C.textSoft,marginTop:2}}>Cada viernes el equipo recibe un correo para cargar sus horas antes del fin de semana.</div></div>
            <span onClick={()=>setRec(recOn?'off':'on')} style={{width:40,height:23,borderRadius:12,background:recOn?C.normal:C.border,position:'relative',display:'inline-block',cursor:'pointer',flexShrink:0}}><span style={{position:'absolute',top:2,left:recOn?19:2,width:19,height:19,borderRadius:'50%',background:'#fff',transition:'left .15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}}/></span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginTop:10}}>
            <button onClick={enviarPruebaRec} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'5px 12px',cursor:'pointer'}}>Enviarme una prueba</button>
            {recMsg && <span style={{fontSize:11,color:/No se pudo/.test(recMsg)?C.overdueText:C.greenText}}>{recMsg}</span>}
          </div>
        </div>
      </>}

      {isAdmin && vista==='ytd' && <>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><span style={{fontSize:11,color:C.muted}}>YTD {anioAct} · para reajustar tarifas</span><button onClick={exportYTD} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 11px',cursor:'pointer'}}>Exportar · uso interno</button></div>
        {/* Apuesta 3 f1 — Margen real (ingreso − costo horas). */}
        {permanentes.length>0 && <>
          {hayCostos && <div style={{background:C.accent,borderRadius:12,padding:'13px 15px',marginBottom:10,color:'#fff'}}>
            <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.06em',opacity:.85,fontWeight:700}}>Margen real · permanentes · {anioAct}</div>
            <div style={{fontSize:23,fontWeight:800,margin:'3px 0 2px',letterSpacing:'-.5px',fontVariantNumeric:'tabular-nums',color:margenTot.margen>=0?'#fff':'#FFD2CC'}}>{f0(margenTot.margen)}</div>
            <div style={{fontSize:11,opacity:.85,lineHeight:1.4}}>Ingreso {f0(margenTot.ing)} − costo {f0(margenTot.costo)} (horas × costo/hora{margenData.some(d=>d.comisCLP>0)?' + costos de terceros':''}).</div>
          </div>}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'0 2px 7px',gap:8}}>
            <span style={{display:'inline-flex',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:20,padding:2,flexShrink:0}}>
              {[['cliente','Por cliente'],['abogado','Por abogado']].map(([v,l])=><span key={v} onClick={()=>setMargenTab(v)} style={{fontSize:10,fontWeight:700,padding:'4px 11px',borderRadius:18,cursor:'pointer',color:margenTab===v?'#fff':C.muted,background:margenTab===v?C.accent:'transparent'}}>{l}</span>)}
            </span>
            <span onClick={()=>setCostosOpen(o=>!o)} style={{fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer'}}>Costo/hora {costosOpen?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
          </div>
          {costosOpen && <div style={{background:C.bgSoft,borderRadius:10,padding:'10px 12px',marginBottom:9}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:8}}>Editas el sueldo/hora (costo-empresa ÷ horas del mes). El overhead de oficina se suma solo → costo cargado. El margen se recalcula.</div>
            {hayOverhead && <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px',marginBottom:9}}>
              <div onClick={()=>setOhOpen(o=>!o)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
                <div><div style={{fontSize:12,fontWeight:700,color:C.accent}}>Overhead de oficina</div><div style={{fontSize:10,color:C.muted,marginTop:1}}>{f0(overheadMes)}/mes ÷ {Math.round(capacidadMes)} h del equipo</div></div>
                <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{f0(Math.round(overheadHora))}/h</div><span style={{fontSize:11,color:C.textSoft}}>{ohOpen?<Gl n='chevU'/>:<Gl n='chevD'/>}</span></div>
              </div>
              {ohOpen && <div style={{marginTop:9,borderTop:`1px dashed ${C.border}`,paddingTop:8}}>
                {overheadPorCat.map(x=>(<div key={x.cat} onClick={()=>onOpenCostosOfi&&onOpenCostosOfi()} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',cursor:onOpenCostosOfi?'pointer':'default'}}><span style={{fontSize:12,color:C.text}}>{x.cat}</span><span style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontSize:12,fontWeight:600,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{f0(Math.round(x.hora))}/h</span>{onOpenCostosOfi&&<span style={{color:C.textSoft,fontSize:12}}><Gl n='chevron'/></span>}</span></div>))}
                {onOpenCostosOfi&&<div onClick={()=>onOpenCostosOfi()} style={{fontSize:10,color:C.azulInfo,fontWeight:700,marginTop:7,cursor:'pointer'}}>Ver y editar Costos de oficina →</div>}
              </div>}
            </div>}
            {EQUIPO.map(name=>{ const s=Number(costoHora[name])||0; const tiene=s>0; const oh=(hayOverhead&&tiene)?overheadHora:0; const cargado=s+oh; const sPct=cargado>0?Math.round(s/cargado*100):0; return (
              <div key={name} style={{borderTop:`0.5px solid ${C.border}`,padding:'8px 0'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:12,color:tiene?C.text:C.done}}>{name}</span>
                  <div style={{display:'flex',alignItems:'center',gap:5}}><span style={{fontSize:11,color:C.textSoft}}>$</span><input key={name+':'+(costoHora[name]??'')} type='number' step='100' min='0' defaultValue={costoHora[name]||''} onBlur={e=>setCosto(name,e.target.value)} placeholder='—' style={{...inp,height:30,width:82,textAlign:'right',fontSize:12}}/><span style={{fontSize:10,color:C.textSoft}}>/h</span></div>
                </div>
                {tiene&&hayOverhead&&<>
                  <div style={{height:13,borderRadius:4,background:'#fff',overflow:'hidden',display:'flex',margin:'6px 0 4px'}}><span style={{width:sPct+'%',background:C.accent}}/><span style={{flex:1,background:C.soonText}}/></div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:C.muted}}><span>sueldo {f0(s)} + oficina {f0(Math.round(oh))}</span><span style={{color:C.accent,fontWeight:800}}>{f0(Math.round(cargado))}/h cargado</span></div>
                </>}
              </div>
            )})}
          </div>}
          {hayCostos && hayOverhead && <div style={{display:'flex',alignItems:'center',gap:9,background:C.bgSoft,borderRadius:10,padding:'10px 12px',marginBottom:9}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:C.text}}>Cargar overhead de oficina</div>
              <div style={{fontSize:10,color:C.muted,marginTop:1}}>+{f0(Math.round(overheadHora))}/h · {f0(overheadMes)}/mes de oficina ÷ {Math.round(capacidadMes)} h del equipo → margen real neto</div>
            </div>
            <div onClick={()=>setCargarOverhead(v=>!v)} style={{width:40,height:23,borderRadius:12,background:cargarOverhead?C.normal:C.done,position:'relative',cursor:'pointer',transition:'.15s',flexShrink:0}}>
              <div style={{position:'absolute',top:2,left:cargarOverhead?19:2,width:19,height:19,borderRadius:'50%',background:'#fff',transition:'.15s',boxShadow:'0 1px 2px rgba(0,0,0,.2)'}}/>
            </div>
          </div>}
          {!hayCostos && <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:13,fontSize:12,color:C.textSoft,marginBottom:10,lineHeight:1.5}}>Define el <b style={{color:C.text}}>costo/hora por abogado</b> (toca “Costo/hora <Gl n='chevD'/>”) para ver el margen real de cada cliente.</div>}
          {hayCostos && margenTab==='cliente' && <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',columnGap:8,alignItems:'start'}:undefined}>{margenData.filter(d=>!d.sinIng).map(d=>{ const neg=d.margen<0; return (
            <div key={d.cid} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 11px',marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                <span onClick={()=>cliOpen(d.cid)} style={{...NOMBRE_CLI,cursor:onOpenClientFicha?'pointer':'default'}}>{cn(d.cid)}</span>
                <span style={{fontSize:12,fontWeight:800,color:neg?C.overdueText:C.greenText}}>{d.ingCLP>0?((d.margen>=0?'+':'')+d.pct+'%'):'—'}</span>
              </div>
              <div style={{height:18,borderRadius:6,background:C.bgSoft,overflow:'hidden',display:'flex',margin:'8px 0 5px'}}>{neg?<span style={{width:'100%',height:'100%',background:C.overdue}}/>:<><span style={{width:(d.ingCLP>0?Math.round(d.costoCLP/d.ingCLP*100):0)+'%',height:'100%',background:'#E9A9A0'}}/><span style={{flex:1,height:'100%',background:C.normal}}/></>}</div>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted}}><span>paga {f0(d.ingCLP)}</span><span>cuesta {f0(d.costoCLP)}</span><span style={{color:neg?C.overdueText:C.greenText,fontWeight:700}}>{neg?'pierdes '+f0(-d.margen):'margen '+f0(d.margen)}</span></div>
              {neg && <div style={{fontSize:10,color:C.overdueText,fontWeight:600,marginTop:5}}>Te cuesta más de lo que paga — reajustar o conversar.</div>}
              {d.faltaCosto && <div style={{fontSize:9,color:C.soonText,marginTop:4}}>Falta costo/hora de algún abogado — el costo está subestimado.</div>}
            </div>
          )})}</div>}
          {hayCostos && margenTab==='abogado' && (margenAbogado.length>0
            ? <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',columnGap:8,alignItems:'start'}:undefined}>
            {margenAbogado.map(a=>{ const neg=a.margen<0; return (
              <div key={a.name} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 11px',marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.accent}}>{a.name}</span>
                  <span style={{fontSize:12,fontWeight:800,color:neg?C.overdueText:C.greenText}}>{a.genera>0?((a.margen>=0?'+':'')+a.pct+'%'):'—'}</span>
                </div>
                <div style={{height:18,borderRadius:6,background:C.bgSoft,overflow:'hidden',display:'flex',margin:'8px 0 5px'}}>{neg?<span style={{width:'100%',height:'100%',background:C.overdue}}/>:<><span style={{width:(a.genera>0?Math.round(a.costo/a.genera*100):0)+'%',height:'100%',background:'#E9A9A0'}}/><span style={{flex:1,height:'100%',background:C.normal}}/></>}</div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:C.muted}}><span>genera {f0(a.genera)}</span><span>cuesta {f0(a.costo)}</span><span style={{color:neg?C.overdueText:C.greenText,fontWeight:700}}>{neg?'pierdes '+f0(-a.margen):'margen '+f0(a.margen)}</span></div>
                <div style={{fontSize:9,color:C.textSoft,marginTop:4}}>{fh(a.horasFact)} facturables de {fh(a.horasTot)} · valoradas a {tarifaUF} UF/h</div>
              </div>
            )})}</div>
            : <div style={{fontSize:12,color:C.textSoft,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:13}}>Aún no hay horas con costo/hora definido por abogado.</div>)}
          <div style={{height:6}}/>
        </>}
        {excedenteYTD>0 && <div style={{background:C.accent,borderRadius:12,padding:'13px 15px',marginBottom:10,color:'#fff'}}>
          <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'.06em',opacity:.85,fontWeight:700}}>Podrías haber facturado · {anioAct}</div>
          <div style={{fontSize:23,fontWeight:800,margin:'3px 0 2px',letterSpacing:'-.5px',fontVariantNumeric:'tabular-nums'}}>{f0(excedenteYTD)}</div>
          <div style={{fontSize:11,opacity:.85,lineHeight:1.4}}>Trabajo facturable por sobre lo incluido cada mes, a tu valor hora. Cobrarlo es opcional — es tu base para reajustar tarifas.</div>
        </div>}
        {ytdData.length===0 && <div style={{fontSize:12,color:C.textSoft,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:14}}>Sin asesorías permanentes configuradas.</div>}
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',columnGap:8,alignItems:'start'}:undefined}>
        {ytdData.map(d=>(
          <div key={d.cid} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:8}}>
            <div onClick={()=>cliOpen(d.cid)} style={{...NOMBRE_CLI,marginBottom:7,cursor:onOpenClientFicha?'pointer':'default'}}>{cn(d.cid)}</div>
            {d.sinCfg ? <div style={{fontSize:11,color:C.textSoft}}>Sin valor de asesoría para calcular las horas.</div> : <>
              <div style={{display:'flex',gap:6}}>
                <div style={{flex:1,textAlign:'center',background:C.bgSoft,borderRadius:8,padding:'7px 4px'}}><div style={{fontSize:13,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fh(d.est)}</div><div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase'}}>Incluidas</div></div>
                <div style={{flex:1,textAlign:'center',background:C.bgSoft,borderRadius:8,padding:'7px 4px'}}><div style={{fontSize:13,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fh(d.cons)}</div><div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase'}}>Consumidas</div></div>
                <div style={{flex:1,textAlign:'center',background:d.over?C.overdueBg:C.greenBg,borderRadius:8,padding:'7px 4px'}}><div style={{fontSize:13,fontWeight:700,color:d.over?C.overdueText:C.greenText,fontVariantNumeric:'tabular-nums'}}>{d.est>0?Math.round((d.est-d.cons)/d.est*100)+'%':'—'}</div><div style={{fontSize:8,color:C.textSoft,textTransform:'uppercase'}}>Holgura</div></div>
              </div>
              <div style={{fontSize:11,fontWeight:600,marginTop:7,color:d.exceso>0?C.overdueText:C.greenText}}>{d.exceso>0
                ? <>Trabajaste <b>{fh(d.exceso)}</b> de más este año{d.excesoFact>0 ? <> · <b>{f0(d.exCLP)}</b> facturable que podrías cobrar (opcional)</> : <> · nada facturable por sobre lo incluido</>}. Base para reajustar la tarifa.</>
                : 'Dentro de lo incluido — con espacio para ofrecer más.'}</div>
            </>}
          </div>
        ))}</div>
      </>}

      {vista==='mias' && <>
      <div id='horas-reg' style={{scrollMarginTop:70}}/>
      {/* Cronómetro en vivo (A2) */}
      {!timer ? (
        <div onClick={startTimer} style={{display:'flex',alignItems:'center',gap:9,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:12,cursor:'pointer'}}>
          <span style={{width:26,height:26,borderRadius:'50%',background:C.greenBg,color:C.greenText,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,flexShrink:0}}>▶</span>
          <span style={{fontSize:13,fontWeight:600,color:C.accent}}>Iniciar cronómetro</span>
        </div>
      ) : (
        <div style={{background:C.accent,borderRadius:12,padding:'10px 12px',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:9}}>
            <span style={{width:9,height:9,borderRadius:'50%',background:'#5FE0A0',boxShadow:'0 0 0 4px rgba(95,224,160,.22)',flexShrink:0}}/>
            <span style={{fontFamily:'ui-monospace,monospace',fontSize:23,fontWeight:700,color:'#fff',letterSpacing:'.02em',fontVariantNumeric:'tabular-nums'}}>{elapsedTxt()}</span>
            <span onClick={cancelTimer} style={{marginLeft:'auto',color:'#fff',opacity:.7,fontSize:12,cursor:'pointer'}}>Cancelar</span>
          </div>
          {timer.clientId ? (
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span onClick={()=>persistTimer({...timer,clientId:'',clientName:''})} style={{flex:1,minWidth:0,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{timer.clientName} <span style={{opacity:.6}}><Gl n='chevD'/></span></span>
              <button onClick={stopTimer} style={{background:'#fff',color:C.accent,border:'none',borderRadius:10,padding:'8px 14px',fontSize:13,fontWeight:700,cursor:'pointer',flexShrink:0}}>Detener y registrar</button>
            </div>
          ) : (
            <div>
              <input value={tq} onChange={e=>setTq(e.target.value)} placeholder='¿De qué cliente?…' style={{...inp,height:34,fontSize:12}}/>
              {tq.trim() && <div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:4,background:'#fff',overflow:'hidden',maxHeight:130,overflowY:'auto'}}>{clients.filter(c=>c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(tq))).slice(0,6).map(c=><div key={c.id} onClick={()=>persistTimer({...timer,clientId:String(c.id),clientName:c.name})} style={{padding:'7px 10px',fontSize:12,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}</div>)}</div>}
              <div style={{marginTop:8,textAlign:'right'}}><button onClick={stopTimer} style={{background:'rgba(255,255,255,.15)',color:'#fff',border:'1px solid rgba(255,255,255,.3)',borderRadius:10,padding:'7px 12px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Detener sin cliente</button></div>
            </div>
          )}
        </div>
      )}
      <div style={{...SEC_LBL,margin:'6px 2px 8px'}}>Mi semana</div>
      <div style={{display:'flex',gap:6,marginBottom:16}}>
        {semDias.map((iso,i)=>{ const hh=misHorasDia(iso); const td=misTareasDia(iso); const isHoy=iso===hoy; return (
          <div key={iso} style={{flex:1,textAlign:'center',background:isHoy?C.azulBg:'#fff',border:`1px solid ${isHoy?C.azulInfo:C.border}`,borderRadius:10,padding:'8px 2px'}}>
            <div style={{fontSize:9,color:C.textSoft,textTransform:'uppercase',fontWeight:700}}>{['lun','mar','mié','jue','vie'][i]}</div>
            <div style={{fontSize:13,fontWeight:700,color:hh>0?C.accent:'#99ABB4',marginTop:2,fontVariantNumeric:'tabular-nums'}}>{hh>0?fh(hh).replace(' h',''):'·'}</div>
            {td>0 && <div style={{fontSize:8,color:C.soonText,marginTop:2}}>{td} plazo{td!==1?'s':''}</div>}
          </div>
        )})}
      </div>

      {/* Registro rápido: cliente → proyecto → horas → registrar (2 toques). No pierde detalle: glosa/facturable clickeables. Los "frecuentes" salen de las horas/tareas/responsable de cada usuario. */}
      {(()=>{
        const _c={}; horas.forEach(h=>{ if(h.user_name===me&&h.client_id) _c[h.client_id]=(_c[h.client_id]||0)+1 })
        const _t={}; (tasks||[]).forEach(t=>{ if(t.client_id&&(isAssignee(t,me)||t.who===me)) _t[t.client_id]=(_t[t.client_id]||0)+1 })
        const _sc=clients.filter(c=>!c.is_internal&&c.status!=='Terminado').map(c=>({c,s:(_c[c.id]||0)*3+(_t[c.id]||0)+(_normTxt(c.abogado_responsable||'')===_normTxt(me)?2:0)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.c)
        // Orden de sugerencia pedido: 1° clientes con VENTAS POR HORA, 2° ASESORÍA PERMANENTE, 3° frecuentes (por horas/tareas/responsable).
        const _vph=[...new Set((ventasPorHora||[]).map(x=>String(x.s?.client_id)).filter(Boolean))]
        const _perm=[...new Set((permanentes||[]).map(x=>String(x.cid)).filter(Boolean))]
        const _prio=[...new Set([..._vph,..._perm])]
        const _byId=id=>clients.find(c=>String(c.id)===String(id)&&!c.is_internal&&c.status!=='Terminado')
        const frec=[...(_prio.map(_byId).filter(Boolean)), ..._sc.filter(c=>!_prio.includes(String(c.id)))].slice(0,6)
        const projsFor=cid=>(sales||[]).filter(s=>String(s.client_id)===String(cid)&&s.title&&!['Rechazada','Borrador'].includes(s.status))
        const projs=qC?projsFor(qC):[]
        const selCli=qC?clients.find(c=>String(c.id)===String(qC)):null
        const chip=(on,txt,onClick,extra)=><span onClick={onClick} style={{fontSize:12,fontWeight:600,border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:'#fff',color:on?'#fff':C.accent,borderRadius:20,padding:'6px 12px',cursor:'pointer',whiteSpace:'nowrap',...extra}}>{txt}</span>
        const pickCli=cid=>{ const nc=String(qC)===String(cid)?null:String(cid); setQC(nc); const ps=nc?projsFor(nc):[]; setQS(ps.length===1?String(ps[0].id):null); setQOtro('') }
        return (
        <div style={{border:`1px solid ${C.normal}`,background:C.greenBg,borderRadius:12,padding:'12px 13px',marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:800,textTransform:'uppercase',letterSpacing:'.4px',color:C.greenText,marginBottom:9,display:'flex',alignItems:'center',gap:6}}><SIcon n='clock' s={14} c={C.greenText}/>Registrar tiempo · hoy</div>
          <div style={lbl}>Cliente</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {frec.map(c=>chip(String(qC)===String(c.id),c.name,()=>pickCli(c.id)))}
            {selCli&&!frec.some(c=>String(c.id)===String(qC))&&chip(true,selCli.name,()=>pickCli(qC))}
            {chip(qOtro==='__open__',qOtro==='__open__'?'Cerrar':'Otro cliente…',()=>setQOtro(qOtro==='__open__'?'':'__open__'),{borderStyle:'dashed'})}
          </div>
          {qOtro==='__open__'&&<input value={''} onChange={e=>setQOtro(e.target.value||'__open__')} placeholder='Buscar cliente…' style={{...inp,height:34,fontSize:12,marginTop:7}}/>}
          {qOtro&&qOtro!=='__open__'&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:5,background:'#fff',overflow:'hidden',maxHeight:130,overflowY:'auto'}}>{clients.filter(c=>!c.is_internal&&c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(qOtro))).slice(0,6).map(c=><div key={c.id} onClick={()=>pickCli(c.id)} style={{padding:'7px 10px',fontSize:12,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}</div>)}</div>}
          {qC&&<>
            <div style={lbl}>Proyecto</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {projs.map(s=>chip(String(qS)===String(s.id),s.title,()=>setQS(String(qS)===String(s.id)?null:String(s.id))))}
              {chip(qS===null,'Sin proyecto',()=>setQS(null),{borderStyle:'dashed'})}
            </div>
          </>}
          <div style={lbl}>Horas</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {[0.5,1,1.5,2,3,4].map(h=>chip(Number(qH)===h,fh(h).replace(' h',''),()=>setQH(h),{minWidth:40,textAlign:'center'}))}
          </div>
          {!qGloOpen&&<div onClick={()=>setQGloOpen(true)} style={{fontSize:12,color:C.azulInfo,fontWeight:600,marginTop:9,cursor:'pointer'}}>+ glosa (opcional) · {qBill?'facturable':'no facturable'}</div>}
          {qGloOpen&&<div style={{marginTop:9}}>
            <input value={qGlo} onChange={e=>setQGlo(e.target.value)} placeholder='Detalle de la gestión (opcional)' style={{...inp,height:34,fontSize:12}}/>
            <label style={{display:'flex',alignItems:'center',gap:6,marginTop:7,fontSize:12,color:C.muted,cursor:'pointer'}}><input type='checkbox' checked={qBill} onChange={e=>setQBill(e.target.checked)}/>Facturable</label>
          </div>}
          <button onClick={guardarRapido} disabled={!qC} style={{marginTop:11,width:'100%',background:qC?C.normal:C.done,color:'#fff',border:'none',borderRadius:10,padding:'11px',fontSize:14,fontWeight:700,cursor:qC?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}><SIcon n='check' s={15} c='#fff'/>{qC?`Registrar ${fh(qH)} · ${selCli?selCli.name:''}`:'Elige cliente y horas'}</button>
        </div>)
      })()}

      {/* ¿Qué hiciste hoy? */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'2px 2px 8px',gap:6,flexWrap:'wrap'}}>
        <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.05em'}}>Por registrar</span>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>setPega(p=>!p)} disabled={agLoading} title='Pegar un chat de WhatsApp o una nota' style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 10px',cursor:'pointer'}}>Pegar</button>
          <button onClick={()=>revisarAgenda('dia')} disabled={agLoading} style={{fontSize:11,fontWeight:600,color:C.accent,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 11px',cursor:agLoading?'default':'pointer'}}>{agLoading?'Leyendo…':'Revisar mi día'}</button>
          <button onClick={()=>revisarAgenda('semana')} disabled={agLoading} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:20,padding:'4px 11px',cursor:agLoading?'default':'pointer'}}>Reconstruir semana</button>
        </div>
      </div>
      {pega && (
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:11,marginBottom:9}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:6}}>Pega un chat de WhatsApp, un correo o una nota. La IA arma la glosa, estima las horas y sugiere el cliente.</div>
          <textarea value={pegaTxt} onChange={e=>setPegaTxt(e.target.value)} rows={4} placeholder='Pega aquí el texto…' style={{...inp,height:'auto',minHeight:80,fontSize:12,resize:'vertical',fontFamily:'inherit',padding:'8px 10px'}}/>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button onClick={redactarPegado} disabled={pegaBusy||!pegaTxt.trim()} style={{flex:1,background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'9px',fontSize:12,fontWeight:600,cursor:(pegaBusy||!pegaTxt.trim())?'default':'pointer',opacity:(pegaBusy||!pegaTxt.trim())?.6:1}}>{pegaBusy?'Redactando…':'Redactar con IA'}</button>
            <button onClick={()=>{setPega(false);setPegaTxt('')}} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.muted,borderRadius:10,padding:'9px 12px',fontSize:12,cursor:'pointer'}}>Cerrar</button>
          </div>
        </div>
      )}
      {agenda.map(ev=>(
        <div key={ev.id} style={{position:'relative',background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
          <span onClick={()=>descartar(ev.id)} title='Descartar — no volver a proponerlo' style={{position:'absolute',top:8,right:9,width:24,height:24,borderRadius:'50%',background:C.bgSoft,color:C.textSoft,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer'}}><Gl n='x'/></span>
          {(()=>{ const tg={AGENDA:[C.tealBg,C.tealText],CORREO:[C.azulBg,C.azulInfo],DOCUMENTO:[C.greenBg,C.greenText],NOTA:[C.soonBg,C.soonText]}[ev.tag||'AGENDA']||[C.tealBg,C.tealText]; return <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:tg[0],color:tg[1],letterSpacing:'.02em',whiteSpace:'nowrap'}}>{ev.tag||'AGENDA'}</span> })()}
          {ev.iaLoading&&<span style={{fontSize:9,fontWeight:700,color:C.azulInfo,marginLeft:6}}>Redactando con IA…</span>}
          {ev.ia&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.greenBg,color:C.greenText,marginLeft:6,letterSpacing:'.02em',display:'inline-flex',alignItems:'center',gap:3,whiteSpace:'nowrap'}}><svg width='9' height='9' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round'><path d='M12 3l1.9 5.2L19 10l-5.1 1.8L12 17l-1.9-5.2L5 10l5.1-1.8z'/></svg>IA</span>}
          {ev.fecha&&<span style={{fontSize:9,color:C.textSoft,marginLeft:6}}>{fFecha(ev.fecha)}</span>}
          {ev.client_id ? <div onClick={()=>cliOpen(ev.client_id)} style={{...NOMBRE_CLI,margin:'7px 0 2px',cursor:onOpenClientFicha?'pointer':'default'}}>{cn(ev.client_id)}</div>
            : <div style={{margin:'7px 0 4px'}}><input value={agq[ev.id]||''} onChange={e=>setAgq(q=>({...q,[ev.id]:e.target.value}))} placeholder='¿De qué cliente? Buscar…' style={{...inp,height:32,fontSize:12}}/>{(agq[ev.id]||'').trim()&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:3,overflow:'hidden',maxHeight:120,overflowY:'auto'}}>{clients.filter(c=>c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(agq[ev.id]))).slice(0,6).map(c=><div key={c.id} onClick={()=>{setAgenda(a=>a.map(x=>x.id===ev.id?{...x,client_id:String(c.id)}:x));setAgq(q=>({...q,[ev.id]:''}))}} style={{padding:'7px 10px',fontSize:12,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}</div>)}</div>}</div>}
          <div style={{fontSize:12,color:ev.ia?C.text:C.muted,lineHeight:1.35}}>{ev.iaLoading ? <span style={{color:C.textSoft}}>Leyendo el contenido y redactando la glosa…</span> : (ev.ia ? ev.glosa : ev.titulo)}</div>
          {ev.ia && ev.titulo && <div style={{fontSize:10,color:C.textSoft,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.titulo}</div>}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10,gap:8}}>
            <div style={step}><span style={stepB} onClick={()=>bumpAg(ev.id,-0.1)}>−</span><b style={{fontSize:14,color:C.accent,padding:'0 4px',minWidth:44,textAlign:'center',fontVariantNumeric:'tabular-nums'}}>{fh(ev.horas)}</b><span style={stepB} onClick={()=>bumpAg(ev.id,0.1)}>+</span></div>
            <button onClick={()=>registrarAgenda(ev)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Registrar</button>
          </div>
        </div>
      ))}
      {delegadasHoy.map(d=>(
        <div key={'co'+d.cid} style={{position:'relative',background:'#FFFDF6',border:`1px solid ${C.soonBg}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
          <span onClick={()=>descartar('coord:'+d.cid)} title='Descartar — no volver a proponerlo' style={{position:'absolute',top:8,right:9,width:24,height:24,borderRadius:'50%',background:C.bgSoft,color:C.textSoft,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer'}}><Gl n='x'/></span>
          <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.ambarBg,color:C.soonText,letterSpacing:'.02em',whiteSpace:'nowrap'}}>COORDINACIÓN</span>
          <div onClick={()=>cliOpen(d.cid)} style={{...NOMBRE_CLI,margin:'7px 0 2px',cursor:onOpenClientFicha?'pointer':'default'}}>{cn(d.cid)}</div>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.35}}>Delegaste {d.n} tarea{d.n!==1?'s':''} — coordinación (facturable)</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',marginTop:10,gap:9}}><span style={{fontSize:11,color:C.textSoft}}>0,2 h</span><button onClick={()=>registrarCoord(d.cid,d.n)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Registrar</button></div>
        </div>
      ))}
      {(misTareasHoy.length===0 && agenda.length===0 && delegadasHoy.length===0) && <div style={{fontSize:12,color:C.textSoft,background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'14px',marginBottom:9}}>{agDone?'Nada pendiente por registrar.':'Toca “Revisar mi día” para traer tus reuniones, correos y documentos, o registra el tiempo con “+ Registrar tiempo”.'}</div>}
      {misTareasHoy.map(t=>(
        <div key={t.id} style={{position:'relative',background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
          <span onClick={()=>descartar('tarea:'+t.id)} title='Descartar — no volver a proponerlo' style={{position:'absolute',top:8,right:9,width:24,height:24,borderRadius:'50%',background:C.bgSoft,color:C.textSoft,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer'}}><Gl n='x'/></span>
          <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.azulBg,color:C.azulInfo,letterSpacing:'.02em',whiteSpace:'nowrap'}}>TAREA</span>
          <div onClick={()=>cliOpen(t.client_id)} style={{...NOMBRE_CLI,margin:'7px 0 2px',cursor:onOpenClientFicha?'pointer':'default'}}>{cn(t.client_id)}</div>
          <div style={{fontSize:12,color:C.muted,lineHeight:1.35}}>{t.title||'Tarea'}</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:10,gap:8}}>
            <div style={step}><span style={stepB} onClick={()=>bump(t.id,-0.1)}>−</span><b style={{fontSize:14,color:C.accent,padding:'0 4px',minWidth:44,textAlign:'center',fontVariantNumeric:'tabular-nums'}}>{fh(dur[t.id]||1)}</b><span style={stepB} onClick={()=>bump(t.id,0.1)}>+</span></div>
            <button onClick={()=>registrarTarea(t)} style={{background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'8px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Registrar</button>
          </div>
        </div>
      ))}
      {!manual && <div onClick={()=>{setManual(true);setMf(f=>({...f,fecha:hoy}))}} style={{textAlign:'center',fontSize:12,fontWeight:600,color:C.accent,padding:11,border:`1px dashed ${C.border}`,borderRadius:12,background:'#fff',cursor:'pointer',marginBottom:14}}>+ Registrar tiempo</div>}
      {manual && (
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:13,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:C.accent,marginBottom:10}}>Registrar tiempo</div>
          <div style={{marginBottom:10}}><div style={lbl}>Cliente</div>
            {mf.client_id ? <div style={{...inp,display:'flex',alignItems:'center',justifyContent:'space-between'}}>{cn(mf.client_id)}<span onClick={()=>{setMf(f=>({...f,client_id:''}));setMq('')}} style={{color:C.textSoft,cursor:'pointer',fontSize:12}}>cambiar</span></div>
              : <><input value={mq} onChange={e=>setMq(e.target.value)} placeholder='Buscar cliente…' style={inp}/>
                {mq.trim()&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,marginTop:4,overflow:'hidden',maxHeight:150,overflowY:'auto'}}>{clients.filter(c=>c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(mq))).slice(0,8).map(c=><div key={c.id} onClick={()=>{setMf(f=>({...f,client_id:c.id}));setMq('')}} style={{padding:'8px 11px',fontSize:13,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}</div>)}</div>}</>}
          </div>
          <div style={{display:'flex',gap:9,marginBottom:10}}>
            <div style={{flex:1}}><div style={lbl}>Fecha</div><input type='date' value={mf.fecha} onChange={e=>setMf(f=>({...f,fecha:e.target.value}))} style={inp}/></div>
            <div style={{width:118}}><div style={lbl}>Horas (0,1)</div><input type='number' step='0.1' min='0' value={mf.horas} onChange={e=>setMf(f=>({...f,horas:e.target.value}))} style={{...inp,textAlign:'right'}}/></div>
          </div>
          <div style={{marginBottom:10}}><div style={lbl}>Glosa</div><input value={mf.glosa} onChange={e=>setMf(f=>({...f,glosa:e.target.value}))} placeholder='Detalle de la gestión' style={inp}/></div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,fontSize:12,color:C.muted,cursor:'pointer'}} onClick={()=>setMf(f=>({...f,billable:!f.billable}))}><span style={{width:34,height:20,borderRadius:12,background:mf.billable?C.normal:C.done,position:'relative',display:'inline-block'}}><span style={{position:'absolute',top:2,left:mf.billable?16:2,width:16,height:16,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/></span>Facturable al cliente</div>
          <div style={{display:'flex',gap:8}}><button onClick={guardarManual} style={{flex:1,background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'10px',fontSize:13,fontWeight:600,cursor:'pointer'}}>Registrar</button><button onClick={()=>{setManual(false);setMq('')}} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.accent,borderRadius:10,padding:'10px 14px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Cancelar</button></div>
        </div>
      )}

      {/* Retainer de clientes permanentes */}
      {permanentes.length>0 && <>
        {/* F3 — alertas de consumo: asesorías por sobre lo pactado o en camino a excederse este mes */}
        {(()=>{ const alertas = permanentes.map(({cid,sale})=>{ const cons=consumoMes(cid); const est=estDe(sale); const diaMes=new Date().getDate(); const diasMes=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate(); const proj=diaMes>0?cons/diaMes*diasMes:0; const over=est>0&&cons>est; const willOver=est>0&&!over&&proj>est*1.05; return {cid,over,willOver,est} }).filter(a=>a.over||a.willOver).sort((a,b)=>(b.over?1:0)-(a.over?1:0))
          if(!alertas.length) return null
          return <div style={{background:C.soonBg,border:`1px solid ${C.soon}`,borderRadius:12,padding:'10px 12px',marginBottom:10}}>
            <div style={{fontSize:12,fontWeight:700,color:C.soonText,marginBottom:5}}>{alertas.length} asesoría{alertas.length!==1?'s':''} por revisar este mes</div>
            {alertas.map(a=><div key={a.cid} onClick={()=>cliOpen(a.cid)} style={{fontSize:11,color:C.soonText,padding:'2px 0',cursor:onOpenClientFicha?'pointer':'default'}}>· <b>{cn(a.cid)}</b> — {a.over?`excedió las ${fh(a.est)} incluidas`:'va camino a excederse'}</div>)}
            {isAdmin && <div style={{fontSize:11,color:C.accent,fontWeight:700,marginTop:6}}>Base para reajustar la tarifa en Repricing.</div>}
          </div>
        })()}
        <div style={lbl}>Asesorías permanentes · {mesLabel(mesActual)}</div>
        <div style={isDesktop?{display:'grid',gridTemplateColumns:'1fr 1fr',columnGap:8,alignItems:'start'}:undefined}>
        {permanentes.map(({cid,sale})=>{ const cons=consumoMes(cid); const consFact=consumoMesFact(cid); const est=estDe(sale); const pct=est>0?Math.min(100,Math.round(cons/est*100)):0; const over=est>0&&cons>est; const fee=sale?.moneda==='UF'?('UF '+(parseFloat(sale.amount_uf)||0).toLocaleString('es-CL')):f0(sale?.amount_clp)
          return (
          <div key={cid} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 12px',marginBottom:9}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}>
              <span onClick={()=>cliOpen(cid)} style={{...NOMBRE_CLI,cursor:onOpenClientFicha?'pointer':'default'}}>{cn(cid)}</span>
              <span style={{fontSize:10,color:C.textSoft}}>{fee}/mes</span>
            </div>
            {est>0 ? <>
              <div style={{height:22,borderRadius:8,background:over?C.overdueBg:C.greenBg,overflow:'hidden',marginTop:8}}><span style={{display:'block',height:'100%',width:pct+'%',background:over?C.overdue:C.normal}}/></div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:7,fontSize:11,color:C.muted}}><span>Incluidas {fh(est)}</span><span>Consumidas {fh(cons)}</span><span style={{color:over?C.overdueText:C.greenText,fontWeight:600}}>{over?'Excedido '+fh(cons-est):'Saldo '+fh(est-cons)}</span></div>
              <div style={{fontSize:10,color:C.textSoft,marginTop:4}}>{fee}/mes ÷ {tarifaUF} UF/h → {est} h incluidas{over?' · revisar tarifa':''}</div>
              {(()=>{ const diaMes=new Date().getDate(); const diasMes=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate(); const rate=diaMes>0?cons/diaMes:0; if(est>0&&rate>0&&!over&&rate*diasMes>est){ const dia=Math.min(diasMes,Math.ceil(est/rate)); return <div style={{fontSize:10,color:C.soonText,marginTop:3}}>A este ritmo, agotas las {fh(est)} cerca del día {dia}.</div> } return null })()}
              {over && (()=>{ const exceso=cons-est; const excFact=Math.max(0,consFact-est); const monto=excedenteCLP(excFact,tarifaUF); return (
                <div style={{marginTop:8,fontSize:11,color:C.overdueText,lineHeight:1.4}}>Excediste <b>{fh(exceso)}</b> este mes{excFact>0 ? <> · podrías facturar <b>{f0(monto)}</b> ({tarifaUF} UF/h) — opcional</> : <> · nada facturable por sobre lo incluido</>}. Base para reajustar la tarifa.</div>
              )})()}
              {isAdmin && (!rep || String(rep.cid)!==String(cid)) && <div onClick={()=>abrirReporte(cid)} style={{marginTop:9,fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer'}}>Reportar horas al cliente →</div>}
              {isAdmin && rep && String(rep.cid)===String(cid) && (()=>{ const ents=entriesRep(cid,rep.mes); const cons=ents.reduce((a,h)=>a+(Number(h.horas)||0),0); return (
                <div style={{marginTop:10,borderTop:`1px solid ${C.bgSoft}`,paddingTop:10}}>
                  <div style={{display:'flex',gap:9,marginBottom:9,alignItems:'flex-end'}}>
                    <div style={{flex:1}}><div style={lbl}>Mes</div><input type='month' value={rep.mes} onChange={e=>setRep(x=>({...x,mes:e.target.value}))} style={inp}/></div>
                    <div style={{width:88}}><div style={lbl}>Horas</div><div style={{...inp,display:'flex',alignItems:'center',justifyContent:'center',color:C.accent,fontWeight:700}}>{fh(cons)}</div></div>
                  </div>
                  <div style={{marginBottom:9}}><div style={lbl}>Para (correo del cliente)</div><input value={rep.para} onChange={e=>setRep(x=>({...x,para:e.target.value}))} placeholder='correo@cliente.cl' style={inp}/></div>
                  <div style={{display:'flex',gap:7,alignItems:'center'}}>
                    <button onClick={enviarReporte} disabled={rep.sending} style={{flex:1,background:C.accent,color:'#fff',border:'none',borderRadius:10,padding:'9px',fontSize:12,fontWeight:600,cursor:'pointer'}}>{rep.sending?'Enviando…':'Enviar al cliente'}</button>
                    <button onClick={verPdfRep} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.accent,borderRadius:10,padding:'9px 11px',fontSize:12,fontWeight:600,cursor:'pointer'}}>Ver PDF</button>
                    <button onClick={()=>setRep(x=>({...x,lang:x.lang==='es'?'en':'es'}))} title='Idioma' style={{background:'#fff',border:`1px solid ${C.border}`,color:rep.lang==='en'?C.accent:C.done,borderRadius:10,padding:'9px 10px',fontSize:11,fontWeight:700,cursor:'pointer'}}>{rep.lang==='en'?'EN':'ES'}</button>
                    <button onClick={()=>setRep(null)} style={{background:'none',border:'none',color:C.textSoft,fontSize:11,cursor:'pointer'}}>Cancelar</button>
                  </div>
                </div>
              )})()}
            </> : <div style={{fontSize:11,color:C.textSoft,marginTop:5}}>Sin valor de asesoría para calcular las horas.</div>}
          </div>
        )})}</div>
      </>}

      {/* Mis horas de la semana — con editar/borrar (E1) y exportar CSV (F4) */}
      {semana.length>0 && <>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'14px 2px 7px'}}>
          <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:'.05em'}}>{isAdmin?'Horas de la semana':'Mis horas de la semana'}</span>
          <button onClick={exportarCSV} title='Exportar mis horas a CSV' style={{fontSize:11,fontWeight:600,color:C.azulInfo,background:'#fff',border:`1px solid ${C.border}`,borderRadius:20,padding:'3px 11px',cursor:'pointer'}}>↓ CSV</button>
        </div>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'4px 12px'}}>
          {semana.map(h=> editH===h.id ? (
            <div key={h.id} style={{padding:'9px 0',borderTop:`1px solid ${C.bgSoft}`}}>
              <div style={{marginBottom:7}}>{ef.client_id ? <div style={{...inp,height:34,display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:12}}>{cn(ef.client_id)}<span onClick={()=>{setEf(f=>({...f,client_id:''}));setEq('')}} style={{color:C.textSoft,cursor:'pointer',fontSize:11}}>cambiar</span></div>
                : <><input value={eq} onChange={e=>setEq(e.target.value)} placeholder='Buscar cliente…' style={{...inp,height:34,fontSize:12}}/>{eq.trim()&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:3,overflow:'hidden',maxHeight:120,overflowY:'auto'}}>{clients.filter(c=>c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(eq))).slice(0,6).map(c=><div key={c.id} onClick={()=>{setEf(f=>({...f,client_id:String(c.id)}));setEq('')}} style={{padding:'7px 10px',fontSize:12,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}</div>)}</div>}</>}</div>
              <div style={{display:'flex',gap:7,marginBottom:7}}>
                <input type='date' value={ef.fecha} onChange={e=>setEf(f=>({...f,fecha:e.target.value}))} style={{...inp,height:34,flex:1,fontSize:12}}/>
                <input type='number' step='0.1' min='0' value={ef.horas} onChange={e=>setEf(f=>({...f,horas:e.target.value}))} style={{...inp,height:34,width:74,textAlign:'right',fontSize:12}}/>
              </div>
              <input value={ef.glosa} onChange={e=>setEf(f=>({...f,glosa:e.target.value}))} placeholder='Glosa' style={{...inp,height:34,fontSize:12,marginBottom:7}}/>
              <div onClick={()=>setEf(f=>({...f,billable:!f.billable}))} style={{display:'flex',alignItems:'center',gap:7,fontSize:11,color:C.muted,marginBottom:9,cursor:'pointer'}}><span style={{width:32,height:19,borderRadius:12,background:ef.billable?C.normal:C.done,position:'relative',display:'inline-block'}}><span style={{position:'absolute',top:2,left:ef.billable?15:2,width:15,height:15,borderRadius:'50%',background:'#fff'}}/></span>Facturable al cliente</div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={guardarEdit} style={{flex:1,background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'8px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Guardar</button>
                <button onClick={()=>borrarHora(h)} style={{background:'#fff',border:'1px solid #F2C4BE',color:C.overdue,borderRadius:8,padding:'8px 12px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Borrar</button>
                <button onClick={()=>setEditH(null)} style={{background:'#fff',border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,padding:'8px 11px',fontSize:12,cursor:'pointer'}}><Gl n='x'/></button>
              </div>
            </div>
          ) : (
            <div key={h.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderTop:`1px solid ${C.bgSoft}`,fontSize:12}}>
              <div style={{minWidth:0,flex:1}}><div onClick={()=>cliOpen(h.client_id)} style={{color:C.text,fontWeight:600,cursor:onOpenClientFicha?'pointer':'default'}}>{cn(h.client_id)}</div><div style={{color:C.textSoft,fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fFecha(h.fecha)}{h.glosa?' · '+h.glosa:''}{isAdmin&&h.user_name?' · '+h.user_name:''}{h.billable===false?' · no facturable':''}</div></div>
              <span style={{fontWeight:700,color:C.accent,flexShrink:0,fontVariantNumeric:'tabular-nums',marginLeft:8}}>{fh(h.horas)}</span>
              <span onClick={()=>abrirEdit(h)} title='Editar' style={{marginLeft:9,color:C.textSoft,cursor:'pointer',fontSize:14,flexShrink:0}}>✎</span>
            </div>
          ))}
        </div>
        {undoH && <div style={{background:'#10171B',color:'#fff',borderRadius:10,padding:'8px 12px',fontSize:12,display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}><span>Hora borrada.</span><span onClick={deshacerBorrar} style={{color:'#7FE0A9',fontWeight:700,cursor:'pointer'}}>Deshacer</span></div>}
      </>}
      </>}
    </div>
  )
}

