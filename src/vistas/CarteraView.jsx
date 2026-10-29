// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase, getDriveToken, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { BRAND, C, Gl, PERSON_CHIP, SEC_LBL, SIcon, _normTxt, appAlert, appConfirm, fmt, fmtFechaDMY, personChip, useIsDesktop } from '../lib/base.jsx'
import { CART_DOT, DocumentosDrive, DriveAuthError, INICIALES_RESP, Modal, PREC_FOLDERS, SEÑAL_COL, _norm, cargarMammoth, cargarPdfjs, cartDias, cartDiasPlazo, carteraMovimiento, claudeCall, costoVentaUF, daysLeft, driveCall, driveToken, esPermanente, esRecurrente, facturaEmitida, leerDriveTextoSA, mesCorto, nDias, readUFCache, setLearningKV, taskAssignees, useArrastre, usePersistedState, ventaCLP, registrarError } from '../lib/compartido.jsx'

export async function driveFetchBufAuth(url){   // como driveGetAuth pero devuelve el ArrayBuffer (para leer el contenido del archivo)
  let token=await driveToken()
  let res=token?await fetch(url,{headers:{Authorization:'Bearer '+token}}):{status:401}
  if(res.status===401){ try{localStorage.removeItem('drive_token')}catch(_){}; let t2=null; try{ t2=await getDriveToken() }catch(_){}; if(t2){ try{localStorage.setItem('drive_token',t2)}catch(_){}; res=await fetch(url,{headers:{Authorization:'Bearer '+t2}}) } }
  if(res.status===401||res.status===403) throw new DriveAuthError()
  if(!res.ok) throw new Error('No se pudo leer el archivo ('+res.status+')')
  return res.arrayBuffer()
}

export async function leerDriveTexto(file){   // lee un archivo de Drive a texto plano (gdoc/docx vía mammoth, pdf vía pdfjs) — mismo patrón que extractFromFile
  const id=file.id, mt=file.mimeType||'', nm=(file.name||'').toLowerCase()
  const isGDoc = mt==='application/vnd.google-apps.document'
  const url = isGDoc
    ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`
    : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`
  const buf = await driveFetchBufAuth(url)
  if(!isGDoc && (mt==='application/pdf'||nm.endsWith('.pdf'))){
    const pdf = await (await cargarPdfjs()).getDocument({data:new Uint8Array(buf)}).promise
    let text=''
    for(let i=1;i<=pdf.numPages;i++){ const page=await pdf.getPage(i); const c=await page.getTextContent(); text+=c.items.map(it=>it.str||'').join(' ')+'\n' }
    return text
  }
  const r = await (await cargarMammoth()).extractRawText({arrayBuffer:buf})
  return r.value||''
}

// Fase 2B — Escáner Gmail → novedades de CARTERA (client-side, tu buzón). La IA cruza correos con proyectos activos
// y propone: (update) nuevo "en qué está" de un proyecto; (nuevo) proyecto para un cliente sin uno. Compuerta humana.
export async function escanearCarteraGmail(clients=[], proyectos=[], onProgress){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const q=encodeURIComponent('is:unread -in:spam -in:trash')
  const CAP=120; let ids=[], pageToken=''
  while(ids.length<CAP){
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken?`&pageToken=${pageToken}`:''}`,{headers:{Authorization:'Bearer '+token}})
    if(!r.ok){ const e=new Error('Gmail '+r.status); e.code=r.status; throw e }
    const j=await r.json(); (j.messages||[]).forEach(m=>ids.push(m.id)); pageToken=j.nextPageToken; if(!pageToken) break
  }
  ids=ids.slice(0,CAP); if(!ids.length) return []
  const correos=[]; let done=0
  const fetchMeta=async(id)=>{ try{
    const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,{headers:{Authorization:'Bearer '+token}})
    if(!r.ok) return; const j=await r.json(); const H={}; (j.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
    const from=H['from']||'', subj=H['subject']||''; const m=from.match(/<(.+?)>/); const email=(m?m[1]:from).trim().toLowerCase()
    if(!email.includes('@')) return
    if(/no-?reply|noreply|notif|mailer-daemon|newsletter|bounce|postmaster/.test(email)) return
    correos.push({from:email, fromName:(from.replace(/<.+?>/,'').replace(/["']/g,'').trim())||email, subject:subj, snippet:(j.snippet||'')})
  }catch(_){} ; done++; if(onProgress&&done%10===0) onProgress(done,ids.length) }
  for(let i=0;i<ids.length;i+=8){ await Promise.all(ids.slice(i,i+8).map(fetchMeta)) }
  if(!correos.length) return []
  const clientList=clients.filter(c=>c.status!=='Terminado').map(c=>({id:String(c.id),nombre:c.name}))
  const proyList=proyectos.filter(p=>p.activo!==false).map(p=>({id:String(p.id),cliente_id:String(p.cliente_id||''),nombre:p.nombre_proyecto,estado_actual:p.nota||''}))
  const hoyISO=new Date().toISOString().slice(0,10); const out=[]
  for(let i=0;i<correos.length;i+=20){
    const batch=correos.slice(i,i+20)
    const prompt=`Eres asistente de un abogado del estudio ${BRAND.nombre}. Te paso CORREOS (remitente, asunto, preview), la lista de CLIENTES y la de PROYECTOS activos (con su "estado_actual" = en qué está). Para cada correo con relevancia real para un proyecto o cliente decide UNA de estas tres: (a) actualiza un PROYECTO existente → {"tipo":"update","proyecto_id":"<id de la lista>","sugerencia":"nuevo 'en qué está' en 1 frase","fuente":"Remitente — Asunto"}; (b) tema NUEVO de un cliente SIN proyecto → {"tipo":"nuevo","cliente_id":"<id o null>","sugerencia":"tema/nombre del proyecto en pocas palabras","fuente":"Remitente — Asunto"}; (c) COMPROMISO o PLAZO concreto con FECHA cierta para un PROYECTO existente (una entrega acordada, un vencimiento, una reunión o audiencia fijada por el correo) → {"tipo":"hito","proyecto_id":"<id de la lista>","titulo":"compromiso en pocas palabras","fecha":"YYYY-MM-DD","fuente":"Remitente — Asunto"}. Solo usa "hito" si el correo fija una fecha real y concreta (no un "a la brevedad"). Ignora newsletters, notificaciones, publicidad y lo irrelevante. Sé conservador: solo lo que claramente mueve un proyecto. Devuelve SOLO un JSON array (sin markdown). Hoy ${hoyISO}. NUNCA inventes ids fuera de las listas ni fechas que no estén en el correo.\nCLIENTES:\n${JSON.stringify(clientList)}\nPROYECTOS:\n${JSON.stringify(proyList)}\nCORREOS:\n${JSON.stringify(batch.map(c=>({de:c.fromName+' <'+c.from+'>',asunto:c.subject,preview:c.snippet})))}`
    try{
      const data=await claudeCall({model:'claude-opus-4-8',max_tokens:2500,messages:[{role:'user',content:prompt}]})
      const arr=JSON.parse((data.content?.[0]?.text||'').replace(/```json|```/g,'').trim())
      ;(Array.isArray(arr)?arr:[]).forEach(x=>{
        if(!x||!x.tipo) return
        if(x.tipo==='update'){ if(x.sugerencia&&proyList.some(p=>p.id===String(x.proyecto_id))) out.push({tipo:'update',proyecto_id:String(x.proyecto_id),sugerencia:String(x.sugerencia).slice(0,240),fuente:String(x.fuente||'')}) }
        else if(x.tipo==='nuevo'){ if(!x.sugerencia) return; const cid=(x.cliente_id&&clientList.some(c=>c.id===String(x.cliente_id)))?String(x.cliente_id):null; out.push({tipo:'nuevo',cliente_id:cid,sugerencia:String(x.sugerencia).slice(0,120),fuente:String(x.fuente||'')}) }
        else if(x.tipo==='hito'){ if(x.titulo&&/^\d{4}-\d{2}-\d{2}$/.test(x.fecha||'')&&proyList.some(p=>p.id===String(x.proyecto_id))) out.push({tipo:'hito',proyecto_id:String(x.proyecto_id),titulo:String(x.titulo).slice(0,160),fecha:x.fecha,fuente:String(x.fuente||'')}) }
      })
    }catch(_){}
  }
  return out
}

// Último contacto con un cliente por HILO (Gmail, client-side con el token del usuario). Devuelve el hilo más reciente
// enviado o recibido con ese correo/dominio. firmDom = dominio de correo del estudio (para marcar enviado vs recibido).
// Busca por dominio corporativo (capta a cualquier contacto de la empresa); si es proveedor gratuito, por el correo exacto.
export async function ultimoContactoGmail(email, firmDom){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const dom=(String(email).split('@')[1]||'').toLowerCase()
  const free=/^(gmail|hotmail|outlook|yahoo|live|icloud|me|proton|protonmail|aol|gmx|yopmail)\./.test(dom+'.')
  const target=(dom && !free) ? `@${dom}` : email
  const q=encodeURIComponent(`(from:${target} OR to:${target}) -in:spam -in:trash`)
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${q}&maxResults=1`,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok){ const e=new Error('Gmail '+r.status); e.code=r.status; throw e }
  const j=await r.json(); const th=(j.threads||[])[0]; if(!th) return null
  const tr=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{Authorization:'Bearer '+token}})
  if(!tr.ok) return null
  const tj=await tr.json(); const msgs=tj.messages||[]; const last=msgs[msgs.length-1]; if(!last) return null
  const H={}; (last.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
  const fromRaw=(H['from']||''); const mm=fromRaw.match(/<(.+?)>/); const fromEmail=(mm?mm[1]:fromRaw).trim().toLowerCase()
  const dir=(firmDom && fromEmail.endsWith('@'+firmDom)) ? 'out' : 'in'
  const ms=last.internalDate ? Number(last.internalDate) : (H['date']?Date.parse(H['date']):NaN)
  const iso=isFinite(ms) ? new Date(ms).toISOString().slice(0,10) : null
  return { fecha:iso, asunto:(H['subject']||'(sin asunto)').slice(0,140), dir, threadId:th.id, cuenta:fromEmail }
}

// Correos recientes del proyecto (con el cliente/su dominio), HACIA ADELANTE (after:desde). Devuelve [{id,subject,from,fecha,snippet,dir}] para que el Agente detecte evidencia de pasos cumplidos.
export async function correosProyGmail(email, firmDom, desdeISO){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const dom=(String(email).split('@')[1]||'').toLowerCase()
  const free=/^(gmail|hotmail|outlook|yahoo|live|icloud|me|proton|protonmail|aol|gmx|yopmail)\./.test(dom+'.')
  const target=(dom && !free) ? `@${dom}` : email
  const after = desdeISO ? ` after:${String(desdeISO).replace(/-/g,'/')}` : ''
  const q=encodeURIComponent(`(from:${target} OR to:${target}) -in:spam -in:trash${after}`)
  const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=12`,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok){ const e=new Error('Gmail '+r.status); e.code=r.status; throw e }
  const j=await r.json(); const ids=(j.messages||[]).map(m=>m.id)
  const out=[]
  for(const id of ids){ try{
    const rm=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{Authorization:'Bearer '+token}})
    if(!rm.ok) continue; const jm=await rm.json()
    const H={}; (jm.payload?.headers||[]).forEach(h=>H[h.name.toLowerCase()]=h.value)
    const fromRaw=(H['from']||''); const mm=fromRaw.match(/<(.+?)>/); const fromEmail=(mm?mm[1]:fromRaw).trim().toLowerCase()
    const dir=(firmDom && fromEmail.endsWith('@'+firmDom)) ? 'out' : 'in'
    const ms=jm.internalDate?Number(jm.internalDate):(H['date']?Date.parse(H['date']):NaN)
    const fecha=isFinite(ms)?new Date(ms).toISOString().slice(0,10):null
    out.push({ id, subject:(H['subject']||'(sin asunto)').slice(0,160), from:fromEmail, fecha, snippet:(jm.snippet||'').slice(0,300), dir })
  }catch(_){} }
  return out
}

// Fase 2C — Calendar → hitos de CARTERA (client-side, scope calendar.events ya concedido). Liga eventos próximos a proyectos.
export async function escanearCarteraCalendario(clients=[], proyectos=[]){
  const token=await driveToken()
  if(!token){ const e=new Error('Sin token de Google'); e.code=401; throw e }
  const now=Date.now(); const timeMin=new Date(now-3*864e5).toISOString(); const timeMax=new Date(now+35*864e5).toISOString()
  const url=`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=60`
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token}})
  if(!r.ok){ const e=new Error('Calendar '+r.status); e.code=r.status; throw e }
  const j=await r.json(); const events=(j.items||[]).filter(e=>e.status!=='cancelled'&&(e.summary||'').trim())
  if(!events.length) return []
  const evs=events.map(e=>{ const dt=e.start?.dateTime||'', d=e.start?.date||''; const fecha=(dt||d||'').slice(0,10)
    const cuando = dt ? new Date(dt).toLocaleString('es-CL',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : (d? new Date(d+'T00:00').toLocaleDateString('es-CL',{weekday:'short',day:'numeric',month:'short'})+' · todo el día' : '')
    return { titulo:(e.summary||'').slice(0,160), fecha, cuando, asistentes:(e.attendees||[]).map(a=>a.email).filter(Boolean).slice(0,8), ubicacion:e.location||'' } }).filter(e=>e.fecha)
  const clientList=clients.filter(c=>c.status!=='Terminado').map(c=>({id:String(c.id),nombre:c.name}))
  const proyList=proyectos.filter(p=>p.activo!==false).map(p=>({id:String(p.id),cliente_id:String(p.cliente_id||''),nombre:p.nombre_proyecto}))
  const hoyISO=new Date().toISOString().slice(0,10)
  const prompt=`Eres asistente de un abogado del estudio ${BRAND.nombre}. Te paso EVENTOS del calendario (título, fecha, asistentes, ubicación), CLIENTES y PROYECTOS activos. Para cada evento que claramente corresponda a un cliente/proyecto (audiencia, reunión, vencimiento, hito), devuelve {"tipo":"hito","proyecto_id":"<id de la lista o null>","cliente_id":"<id o null>","titulo":"...","fecha":"YYYY-MM-DD"}. Enlaza a un PROYECTO existente por su cliente siempre que puedas. Ignora eventos personales o irrelevantes. Devuelve SOLO un JSON array (sin markdown). Hoy ${hoyISO}. NUNCA inventes ids fuera de las listas.\nCLIENTES:\n${JSON.stringify(clientList)}\nPROYECTOS:\n${JSON.stringify(proyList)}\nEVENTOS:\n${JSON.stringify(evs)}`
  try{
    const data=await claudeCall({model:'claude-opus-4-8',max_tokens:2000,messages:[{role:'user',content:prompt}]})
    const arr=JSON.parse((data.content?.[0]?.text||'').replace(/```json|```/g,'').trim())
    const out=[]
    ;(Array.isArray(arr)?arr:[]).forEach(x=>{
      if(!x||x.tipo!=='hito'||!x.titulo||!/^\d{4}-\d{2}-\d{2}$/.test(x.fecha||'')) return
      const pid=(x.proyecto_id&&proyList.some(p=>p.id===String(x.proyecto_id)))?String(x.proyecto_id):null
      if(!pid) return   // v1: solo hitos ligados a un proyecto existente
      const ev=evs.find(e=>e.titulo===x.titulo)
      out.push({tipo:'hito',proyecto_id:pid,titulo:String(x.titulo).slice(0,160),fecha:x.fecha,fuente:ev?.cuando||x.fecha})
    })
    return out
  }catch(_){ return [] }
}

// ─── PANEL DE CARTERA (Fase 1: vista limpia de proyectos activos, orden por "sin mover") ────
export const ETAPAS_CARTERA = ['Diagnóstico','Análisis','Borrador','Revisión cliente','Ejecución','Cierre']

// Plantillas de etapas por tipo de asunto (reemplazan las 6 genéricas para los 'proyecto'). De los flujos legales reales.
export const STAGE_TEMPLATES = {
  reorg: ['Diagnóstico','Diseño de estructura','Escrituras/aportes','SII/formalización','Cierre'],
  sucesorio: ['Antecedentes','Inventario','Trámite','Inscripción','Cierre'],
  compraventa: ['Due diligence','Promesa','Escritura','Inscripción CBR','Cierre'],
  juicio: ['Demanda','Contestación','Prueba','Sentencia','Apelación'],
  informe: ['Antecedentes','Análisis','Informe','Entrega'],
}

export const CART_AV  = (()=>{ const N={CL:'Cristóbal',EE:'Erasmo',MC:'Martín',MP:'Martina',RD:'Rodrigo'}; const o={}; for(const i in N) o[i]=personChip(N[i]).color; return o })()  // color por persona: DERIVA de PERSON_CHIP (fuente única, no duplicar)

// Prioridad viva (NO se guarda): estado*3 + plazo*2 + inactividad. Casos borde → 0, nunca NaN.
export function carteraScore(p){
  const pe = p.estado==='rojo'?3:p.estado==='ambar'?2:1
  const d = cartDiasPlazo(p.plazo); const pp = d==null?0:d<0?5:d<=7?4:d<=14?3:d<=30?2:1
  const inact = cartDias(p.ultima_actividad); const pi = inact==null?0:Math.min(6,Math.floor(inact/7))
  return pe*3 + pp*2 + pi
}

export function CarteraView({ proyectos=[], setProyectos, proyEquipo=[], proySeguidores=[], proyEntregables=[], proyHitos=[], onSeguir, onSetTipo, onAddEntregable, onToggleEntregable, onMoverEntregable, onDelEntregable, onAddHito, onToggleHito, onDelHito, onUpdHito, onReorderHitos, onSeedPlan, pmoOps=[], onSaveOperacion, onDelOperacion, onAddMiembro, onDelMiembro, pmoSug=[], onAplicarEvidencia, onDescartarEvidencia, clients=[], sales=[], tasks=[], billing=[], expenses=[], rendiciones=[], anticipos=[], terceros=[], focusId=null, onFocusHandled, currentUserName, userRole, onClose, onOpenClientFicha, onOpenSale, onAddTaskForProject, onCompleteTask, onPreviewTask }){
  const isDesktop = useIsDesktop()   // Fase 3: columna más ancha en escritorio
  // Tareas de un proyecto: enlace firme por project_id, con respaldo por cliente (tareas antiguas sin project_id).
  const tareasDe = p => (tasks||[]).filter(t=> t.status!=='Terminado' && !t.archived && (String(t.project_id||'')===String(p.id) || (!t.project_id && p.cliente_id && String(t.client_id||'')===String(p.cliente_id))))
  // Motor de movimiento = FUENTE ÚNICA global carteraMovimiento (definida a nivel módulo; la comparte el Inicio).
  const _dias = iso => iso==null?null:Math.round((Date.now()-new Date(String(iso).slice(0,10)+'T12:00').getTime())/86400000)
  const HOY = new Date().toISOString().slice(0,10)
  const esAdmin = userRole==='admin'
  const miInicial = INICIALES_RESP[currentUserName] || (DEMO?'CL':null)   // en demo cae a CL para mostrar el opt-in/Mi semana
  // Opt-in por abogado: un proyecto es MÍO si soy responsable, estoy en el equipo o lo sigo. Nada ajeno por default.
  const _soy = miInicial
  const _enEquipo = pid => (proyEquipo||[]).some(e=>String(e.proyecto_id)===String(pid)&&e.miembro===_soy)
  const _sigo = pid => (proySeguidores||[]).some(e=>String(e.proyecto_id)===String(pid)&&e.miembro===_soy)
  const esMio = p => !_soy || (p.responsable||'')===_soy || _enEquipo(p.id) || _sigo(p.id)
  // Generalizado para el selector de persona: ¿la persona `per` es responsable/equipo/seguidor de p?
  const esDePersona = (p,per) => (p.responsable||'')===per || (proyEquipo||[]).some(e=>String(e.proyecto_id)===String(p.id)&&e.miembro===per) || (proySeguidores||[]).some(e=>String(e.proyecto_id)===String(p.id)&&e.miembro===per)
  const razonMia = p => (p.responsable||'')===_soy ? 'Responsable' : _enEquipo(p.id) ? 'En el equipo' : _sigo(p.id) ? 'Siguiendo' : null
  const TIPO_META = { puntual:{l:'Puntual',c:C.greenText,bg:C.greenBg}, permanente:{l:'Permanente',c:C.tealText,bg:C.tealBg}, proyecto:{l:'Proyecto',c:C.accent,bg:C.azulBg} }
  const tipoDe = p => p.tipo || 'proyecto'
  const _TIPO_ORDEN = ['puntual','permanente','proyecto']
  // Etapas del proyecto según su plantilla (solo tipo 'proyecto'; permanente/puntual no llevan etapas → aparición progresiva).
  const etapasDe = p => (tipoDe(p)==='proyecto') ? (STAGE_TEMPLATES[p.template]||ETAPAS_CARTERA) : null
  // Fase 2b — estructura del proyecto: entregables, hitos, equipo.
  const entregablesDe = p => (proyEntregables||[]).filter(e=>String(e.proyecto_id)===String(p.id)).sort((a,b)=>(a.orden||0)-(b.orden||0))
  const hitosDe = p => (proyHitos||[]).filter(h=>String(h.proyecto_id)===String(p.id)).sort((a,b)=>String(a.fecha||'~').localeCompare(String(b.fecha||'~')))
  const equipoDe = p => (proyEquipo||[]).filter(e=>String(e.proyecto_id)===String(p.id))
  const ROL_LBL={responsable:'Responsable',apoyo:'Apoyo',revisa:'Revisa',tramites:'Trámites'}
  const NOMBRE_DE_INI={CL:'Cristóbal',EE:'Erasmo',MC:'Martín',MP:'Martina',RD:'Rodrigo'}
  const cnm = id => { const c=clients.find(x=>String(x.id)===String(id)); return c?.name || '' }
  const fmtDia = iso => iso ? fmtFechaDMY(iso) : ''   // unificado a DD-MM-AAAA (antes "10 sept" sin año)
  // Último contacto por hilo (Gmail): caché por cliente_id {loading|none|err|{...}}; dominio del estudio desde BRAND (configurable).
  const FIRM_MAIL_DOM = (String((BRAND?.pago?.gastos?.email)||'').split('@')[1]||'').toLowerCase()
  const [ultCont,setUltCont] = useState({})
  const [docsProy,setDocsProy] = useState({})   // cache de documentos de Drive por proyecto (para confirmar pasos del plan)
  const [iaSug,setIaSug] = useState({})         // confirmaciones por CONTENIDO (IA leyó el documento/correo) por proyecto
  const [iaBusy,setIaBusy] = useState({})       // "leyendo con IA" por proyecto
  const [correosProy,setCorreosProy] = useState({})   // cache de correos recientes por proyecto (para confirmar pasos del plan)
  const [calProy,setCalProy] = useState({})           // OLA 4 — cache de citas de Google Calendar por proyecto (audiencias/firmas → paso)
  const resolverEmailCli = async(clientId)=>{ const cl=clients.find(c=>String(c.id)===String(clientId)); let to=(cl?.email||'').trim()
    if(!to){ try{ const {data}=await supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(clientId)).maybeSingle(); if(data?.value) to=String(data.value).split(/[,;]/)[0].trim() }catch(_){} }
    if(!to){ try{ const {data}=await supabase.from('contacts').select('email,principal').eq('client_id',clientId); const c=(data||[]).find(x=>x.principal&&x.email)||(data||[]).find(x=>x.email); if(c) to=String(c.email).trim() }catch(_){} }
    return to }
  const cargarUltContacto = async(p)=>{ if(!esAdmin||!p?.cliente_id) return; const cid=String(p.cliente_id); if(ultCont[cid]) return
    if(DEMO){ setUltCont(m=>({...m,[cid]:{fecha:new Date(Date.now()-3*864e5).toISOString().slice(0,10),asunto:'RE: Borradores de la reorganización',dir:'in',threadId:'demo',cuenta:'gerencia@cliente.cl'}})); return }
    setUltCont(m=>({...m,[cid]:{loading:true}}))
    try{ const email=await resolverEmailCli(cid); if(!email){ setUltCont(m=>({...m,[cid]:{none:true,noEmail:true}})); return }
      const res=await ultimoContactoGmail(email, FIRM_MAIL_DOM); setUltCont(m=>({...m,[cid]:res||{none:true}})) }
    catch(e){ setUltCont(m=>({...m,[cid]:{err:(e?.code===401||e?.code===403)?'sinpermiso':'error'}})) } }
  // Escaneo perezoso de CORREOS recientes del proyecto (admin, hacia adelante). Cachea por proyecto.
  const cargarCorreosProy = async(p)=>{ if(!esAdmin||!p?.cliente_id) return; const pid=String(p.id); if(correosProy[pid]) return
    if(DEMO){ const hoy=new Date().toISOString().slice(0,10); setCorreosProy(o=>({...o,[pid]:{ msgs:[
      { id:'m1', subject:'Inscripción de los inmuebles aportados en el Conservador', from:'notaria@notariaxyz.cl', fecha:hoy, snippet:'Se practicó la inscripción de dominio de los inmuebles aportados a nombre de la sociedad.', dir:'in' },
      { id:'m2', subject:'RE: Borradores de la reorganización', from:'gerencia@cliente.cl', fecha:hoy, snippet:'Quedamos a la espera de sus comentarios.', dir:'in' },
    ] }})); return }
    setCorreosProy(o=>({...o,[pid]:{loading:true}}))
    try{ const email=await resolverEmailCli(p.cliente_id); if(!email){ setCorreosProy(o=>({...o,[pid]:{none:true,noEmail:true}})); return }
      const msgs=await correosProyGmail(email, FIRM_MAIL_DOM, _TRAMITE_DESDE); setCorreosProy(o=>({...o,[pid]:{ msgs:msgs||[] }})) }
    catch(e){ setCorreosProy(o=>({...o,[pid]:{err:(e?.code===401||e?.code===403)?'sinpermiso':'error'}})) } }
  // OLA 4 — Citas de Google Calendar del proyecto (audiencias/firmas) para ligarlas al paso. Reusa driveToken (ya se escribe al Calendar).
  const cargarCalProy = async(p)=>{ if(!esAdmin||!p?.cliente_id) return; const pid=String(p.id); if(calProy[pid]) return
    if(DEMO){ setCalProy(o=>({...o,[pid]:{ eventos:[
      { id:'ev1', summary:'Firma de las escrituras de los actos', fecha:new Date(Date.now()-2*864e5).toISOString().slice(0,10) },
      { id:'ev2', summary:'Reunión con el cliente', fecha:new Date(Date.now()+6*864e5).toISOString().slice(0,10) },
    ] }})); return }
    setCalProy(o=>({...o,[pid]:{loading:true}}))
    try{ const token=await driveToken(); if(!token){ setCalProy(o=>({...o,[pid]:{none:true}})); return }
      const nombre=(clients.find(c=>String(c.id)===String(p.cliente_id))||{}).name||''
      const timeMin=new Date(_TRAMITE_DESDE+'T00:00').toISOString(); const timeMax=new Date(Date.now()+365*864e5).toISOString()
      const url=`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50${nombre?`&q=${encodeURIComponent(nombre)}`:''}`
      const r=await fetch(url,{headers:{Authorization:'Bearer '+token}})
      if(!r.ok){ setCalProy(o=>({...o,[pid]:{err:(r.status===401||r.status===403)?'sinpermiso':'error'}})); return }
      const d=await r.json(); const eventos=(d.items||[]).map(ev=>({ id:ev.id, summary:ev.summary||'(sin título)', fecha:String(ev.start?.date||ev.start?.dateTime||'').slice(0,10) })).filter(ev=>ev.fecha)
      setCalProy(o=>({...o,[pid]:{ eventos }})) }
    catch(e){ setCalProy(o=>({...o,[pid]:{err:'error'}})) } }
  const haceTxt = iso => { const d=cartDias(iso); return d==null?'sin actividad':d<=0?'hoy':d===1?'ayer':`hace ${nDias(d)}` }
  const haceCol = iso => { const d=cartDias(iso); return d==null?C.grisText:d>=21?C.overdueText:d>=14?'#854F0B':C.muted }
  // Propuesta abierta = proyecto cuya venta vinculada sigue en 'Propuesta' (pipeline no cerrado) → se mantiene visible arriba.
  const saleDe = p => p.sale_id ? (sales||[]).find(s=>String(s.id)===String(p.sale_id)) : null
  const esPropAbierta = p => { const s=saleDe(p); return !!(s && s.status==='Propuesta' && !s.deleted_at) }
  // Momentum: recencia de actividad (fresco arriba) + trabajo activo (tareas) + vencimiento próximo + avance de etapa. Lo parado cae al fondo.
  const carteraMomentum = p => {
    const dias = cartDias(p.ultima_actividad)
    const rec = dias==null?0 : dias<=3?6 : dias<=7?5 : dias<=14?3 : dias<=30?1 : 0
    const nT = tareasDe(p).length
    let dp = p.plazo ? cartDiasPlazo(p.plazo) : null
    tareasDe(p).forEach(t=>{ if(t.due){ const d=cartDiasPlazo(t.due); if(d!=null&&(dp==null||d<dp)) dp=d } })
    const soon = dp==null?0 : dp<0?2 : dp<=7?3 : dp<=14?2 : 0
    return rec + (nT>0?2:0) + soon + Math.min(2,(p.etapa_idx||0)*0.4)
  }

  const [q,setQ] = useState('')
  const [fase,setFase] = usePersistedState('cartera_fase','curso')   // curso | pausa | terminados
  const [sortBy,setSortBy] = usePersistedState('cartera_sort2','movimiento')   // movimiento | sinmover | plazo | prioridad | cliente (recuerda al volver)
  const [estadoF,setEstadoF] = usePersistedState('cartera_estadoF','todos') // todos | rojo | ambar | verde
  const [soloMios,setSoloMios] = usePersistedState('cartera_solomios2',true) // (legado) — reemplazado por 'vista'
  const [vista,setVista] = usePersistedState('cartera_vista','mios')          // (legado) mios | estudio — reemplazado por el selector de persona
  const [selPer,setSelPer] = usePersistedState('cartera_persona', INICIALES_RESP[currentUserName]||'all')   // inicial (CL/EE/..) o 'all' = todo el estudio
  const [perOpen,setPerOpen] = useState(false)   // dropdown del selector de persona
  const [entDraft,setEntDraft] = useState('')     // Fase 2b: nuevo entregable
  const [hitoDraft,setHitoDraft] = useState('')   // Fase 2b: nuevo hito (título)
  const [hitoFecha,setHitoFecha] = useState('')   // Fase 2b: nuevo hito (fecha)
  const [addMiemOpen,setAddMiemOpen] = useState(false)  // Fase 2b: picker de integrante
  // Equipo sugerido: quien tiene tareas asignadas o cargó gastos en el cliente del proyecto (6 meses). El socio decide (Agregar / No); el «No» se aprende.
  const [sugEqNo,setSugEqNo] = useState(()=>new Set())
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key').eq('kind','equipo_sug_no').then(({data})=>{ if(data) setSugEqNo(new Set(data.map(r=>String(r.key)))) },()=>{}) },[])
  const [openId,setOpenId] = usePersistedState('cartera_open',null)         // proyecto abierto (como página workspace)
  const [wsTab,setWsTab] = useState('resumen')                              // subpágina del workspace: resumen|plan|calendario|tareas|equipo|bitacora
  const [dragEnt,setDragEnt] = useState(null)                               // id del entregable que se está arrastrando (tablero de etapas)
  const [dragCol,setDragCol] = useState(null)                               // columna (etapa) sobre la que se está soltando
  // Reordenar pasos arrastrando el asa ⠿ (mouse o dedo: useArrastre). item = {pid, i, reorder}; destino = «pid:i».
  const arrPaso = useArrastre({grupo:'paso', onSoltar:(it,dest)=>{ const [pid,to]=String(dest).split(':'); if(String(it.pid)===pid) it.reorder(it.i,+to) }})
  const dragPaso = arrPaso.arrastrando ? arrPaso.arrastrando.i : null
  const [subAbierto,setSubAbierto] = useState({})                           // pasos con sus sub-etapas expandidas
  const [faseAgr,setFaseAgr] = useState(false)                              // Plan: agrupar pasos por fase (proyectos largos)
  const [faseCol,setFaseCol] = useState({})                                 // fases colapsadas (por key); default = fase completa colapsada
  // OLA 3 — AUTO-CONFIRMAR: cuántas veces se confirmó a mano cada mapeo concepto→paso (learnings). Si ≥2, el Agente lo marca solo (reversible).
  const [pmoAutoCount,setPmoAutoCount] = useState({})                       // conceptKey → nº de confirmaciones manuales previas
  const [autoHechos,setAutoHechos] = useState([])                           // pasos marcados SOLOS esta sesión (para el aviso "Confirmado solo · Deshacer")
  const [autoNo,setAutoNo] = useState(()=>new Set())                        // evidencias que el usuario deshizo → no volver a auto-confirmar en la sesión
  const autoDone = useRef(new Set())                                        // evidencias ya auto-aplicadas (evita doble aplicación)
  const AUTO_MIN = 2                                                        // umbral de "patrón aprendido" para abrir la compuerta solo
  useEffect(()=>{ if(DEMO){ setPmoAutoCount(demoData.pmo_learn_count||{}); return }
    supabase.from('learnings').select('key').in('kind',['pmo_tramite_hito','pmo_doc_hito']).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ const k=String(r.key); m[k]=(m[k]||0)+1 }); setPmoAutoCount(m) },()=>{}) },[])
  const [pmoProyOp,setPmoProyOp] = useState({})                             // projectId → operacionId (de qué operación nació) — para que la biblioteca aprenda del uso
  useEffect(()=>{ if(DEMO){ setPmoProyOp(demoData.pmo_proy_op||{}); return }
    supabase.from('learnings').select('key,value').eq('kind','pmo_proy_op').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ if(r.key&&r.value) m[String(r.key)]=String(r.value) }); setPmoProyOp(m) },()=>{}) },[])
  // OLA 4 — plazos legales del cliente (tabla `plazos`: audiencias, vencimientos, obligaciones) para integrarlos al Calendario del proyecto. Título propio del plazo, sin inventar.
  const [plazosAll,setPlazosAll] = useState([])
  useEffect(()=>{ if(DEMO){ setPlazosAll(demoData.plazos||[]); return }
    supabase.from('plazos').select('id,client_id,titulo,fecha,tipo,estado').then(({data})=>setPlazosAll(data||[]),()=>{}) },[])
  // OLA 3 #4 — Agente proactivo cross-cartera (barrido diario de Drive, server-side). Apagado hasta que el admin lo encienda; "Probar" simula sin escribir.
  const [crossCfg,setCrossCfg] = useState('off'); const [crossBusy,setCrossBusy] = useState(false); const [crossRes,setCrossRes] = useState(null)
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('value').eq('kind','config').eq('key','pmo_cross_cartera').order('updated_at',{ascending:false}).limit(1).then(({data})=>{ if(data&&data[0]) setCrossCfg(String(data[0].value||'off').toLowerCase()) },()=>{}) },[])
  const probarCross = async()=>{ setCrossBusy(true); setCrossRes(null); try{ const {data,error}=await supabase.functions.invoke('agente-pmo',{body:{dryRun:true,preview:true}}); setCrossRes(error?{error:error.message}:(data||{})) }catch(e){ setCrossRes({error:e.message||'error'}) } setCrossBusy(false) }
  const toggleCross = async()=>{ const nv=crossCfg==='on'?'off':'on'; setCrossCfg(nv); try{ await setLearningKV('config','pmo_cross_cartera',nv) }catch(e){registrarError({origen:'accion',vista:'config',err:e})} }
  const [draft,setDraft] = useState('')             // borrador de nota de la fila abierta
  const [nuevo,setNuevo] = useState(false)
  const [focoOpen,setFocoOpen] = useState(false)   // vista "Mi foco" (cross-proyecto: qué vence / siguiente paso / detenidos)
  const [metOpen,setMetOpen] = useState(false)     // vista "Métricas de proyectos" (Ola 4)
  const [metExp,setMetExp] = useState(null)        // fila expandida en Métricas (drill-down a su lista de proyectos)
  const [bibOpen,setBibOpen] = useState(false)     // editor de la biblioteca de pasos (pmo_operaciones)
  const [bibSel,setBibSel] = useState(null)        // operación seleccionada en el editor
  const NF0 = { cliente_id:'', sale_id:'', operacionId:'', nombre:'', responsable:esAdmin?'CL':(miInicial||'CL'), nota:'', plazo:'' }
  const [nf,setNf] = useState(NF0)
  const [clientQ,setClientQ] = useState('')
  const [alcanceFor,setAlcanceFor] = useState(null)   // Fase 2A: proyecto sobre el que leer la propuesta
  const [novedades,setNovedades] = useState([])       // Fase 2B: sugerencias del correo pendientes de revisar
  const [escaneando,setEscaneando] = useState(false)
  const [novOpen,setNovOpen] = useState(false)   // novedades correo/agenda: COLAPSADO por defecto (era ruido al entrar)
  const [archivados,setArchivados] = useState([])     // proyectos archivados (activo=false), para ver/reponer
  const [archOpen,setArchOpen] = useState(false)
  const [notas,setNotas] = useState({})               // bitácora manual: { proyecto_id: [{id,texto,autor,created_at}] }
  const [grpOpen,setGrpOpen] = useState({})           // clientes con varios proyectos: abiertos/cerrados
  const [notaDraft,setNotaDraft] = useState('')       // borrador de nota nueva en la bitácora abierta
  const [bitFull,setBitFull] = useState({})           // { proyecto_id: true } → bitácora completa (por defecto colapsada a los últimos)
  const [rentOpen,setRentOpen] = useState(false)      // panel de rentabilidad agregada
  const [rentBy,setRentBy] = useState('abogado')      // abogado | cliente
  const [rentBase,setRentBase] = useState('mes')      // base del margen: mes | ano | ytd (recurrentes)
  // Interruptor del correo semanal. value: 'off' · 'on' (todo el equipo) · iniciales ('CL') = solo esa persona.
  const [semanalVal,setSemanalVal] = useState('off')
  const [pruebaMsg,setPruebaMsg] = useState('')       // feedback del botón "Enviarme una prueba"
  const miIniSemanal = INICIALES_RESP[currentUserName] || 'CL'
  const semanalOn = semanalVal !== 'off'
  const semanalTodos = semanalVal === 'on'
  useEffect(()=>{ if(DEMO){ return } supabase.from('learnings').select('value').eq('kind','config').eq('key','cartera_semanal').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ setSemanalVal((data?.value||'off').trim()||'off') },()=>{}) },[])
  const setSemanal = async (v) => {
    const prev = semanalVal; setSemanalVal(v)
    if(DEMO) return
    try{ await supabase.from('learnings').delete().eq('kind','config').eq('key','cartera_semanal'); await supabase.from('learnings').insert({kind:'config',key:'cartera_semanal',value:v}) }catch(e){ setSemanalVal(prev); appAlert('No se pudo guardar: '+e.message) }
  }
  const toggleSemanal = () => setSemanal(semanalOn ? 'off' : miIniSemanal)   // al prender, por defecto solo tú
  const enviarPrueba = async () => {
    setPruebaMsg('Enviando…')
    if(DEMO){ setPruebaMsg('En demo no se envía.'); return }
    try{
      const {data:{session}} = await supabase.auth.getSession()
      const res = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/cartera-semanal',{ method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+(session?.access_token||''),'apikey':supabase.supabaseKey}, body:JSON.stringify({}) })
      const j = await res.json().catch(()=>({}))
      if(!res.ok) throw new Error(j.error||('Error '+res.status))
      setPruebaMsg('Listo — revisa tu correo.')
    }catch(e){ setPruebaMsg('No se pudo: '+(e?.message||'reintenta')) }
    setTimeout(()=>setPruebaMsg(''),6000)
  }
  useEffect(()=>{
    if(DEMO){ setNotas({}); return }
    supabase.from('cartera_notas').select('*').order('created_at',{ascending:false}).then(({data})=>{ if(!data) return; const m={}; data.forEach(n=>{ (m[n.proyecto_id]=m[n.proyecto_id]||[]).push(n) }); setNotas(m) },()=>{})
  },[])   // eslint-disable-line
  const agregarNota = async (p) => {
    const t=(notaDraft||'').trim(); if(!t) return
    setNotaDraft('')
    if(DEMO){ setNotas(prev=>({ ...prev, [p.id]:[{ id:'n'+Date.now(), texto:t, autor:currentUserName||null, created_at:new Date().toISOString() },...(prev[p.id]||[])] })); return }
    const { data,error } = await supabase.from('cartera_notas').insert({ proyecto_id:p.id, texto:t, autor:currentUserName||null }).select().single()
    if(error||!data){ appAlert('No se pudo guardar la nota'+(error?': '+error.message:'')); return }
    setNotas(prev=>({ ...prev, [p.id]:[data,...(prev[p.id]||[])] }))
  }
  // Bitácora = eventos automáticos + notas manuales, cronología única. AGRUPA los iguales del mismo día
  // (evita "Factura emitida" ×10) y conserva el ref del primero para el salto clickeable.
  const bitacoraDe = p => {
    const auto = (mov(p).eventos||[]).map(e=>({ iso:e.iso, tipo:e.tipo, texto:e.texto, autor:null, ref:e.ref }))
    const man = (notas[p.id]||[]).filter(Boolean).map(n=>({ iso:String(n.created_at||'').slice(0,10), tipo:'nota', texto:n.texto, autor:n.autor, ref:null }))
    const all = [...auto,...man].filter(e=>e.iso&&e.iso.length>=10).sort((a,b)=>b.iso.localeCompare(a.iso))
    const out=[], seen=new Map()
    all.forEach(e=>{ if(e.tipo==='nota'){ out.push({...e,count:1}); return } const k=e.tipo+'|'+e.texto+'|'+e.iso; if(seen.has(k)){ seen.get(k).count++ } else { const o={...e,count:1}; seen.set(k,o); out.push(o) } })
    return out.slice(0,40)
  }
  const clickEvento = e => { if(!e.ref) return; if(e.ref.kind==='task'){ const t=(tasks||[]).find(x=>String(x.id)===String(e.ref.id)); if(t&&onPreviewTask) onPreviewTask(t) } else if(e.ref.kind==='ficha'&&onOpenClientFicha){ onOpenClientFicha(e.ref.id) } }
  // ── Rentabilidad (fuente única): Margen = Honorarios − Costos de terceros − (horas × valor hora).
  const [valorHora,setValorHora] = useState({ general:4.5, permanente:2 })
  const [sugEsf,setSugEsf] = useState({})
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key,value').eq('kind','config').in('key',['valor_hora_uf','valor_hora_permanente_uf']).then(({data})=>{ if(!data) return; const g=data.find(r=>r.key==='valor_hora_uf'), pm=data.find(r=>r.key==='valor_hora_permanente_uf'); setValorHora(v=>({ general:g?parseFloat(g.value)||v.general:v.general, permanente:pm?parseFloat(pm.value)||v.permanente:v.permanente })) },()=>{}) },[])
  const saveVH = async (campo,val) => { const v=parseFloat(val); if(!(v>0)) return; setValorHora(o=>({...o,[campo]:v})); if(DEMO) return; const key=campo==='general'?'valor_hora_uf':'valor_hora_permanente_uf'; try{ await supabase.from('learnings').delete().eq('kind','config').eq('key',key); await supabase.from('learnings').insert({kind:'config',key,value:String(v)}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
  const esPermanente = (p,s) => (s?.cobro_type==='mensual') || /permanente/i.test((p.nombre_proyecto||'')+' '+(s?.title||''))
  const rentabilidadDe = p => {
    const s = saleDe(p); if(!s) return null
    const uf = readUFCache()?.value || parseFloat(s.uf_value) || 0
    const rec = esRecurrente(s)
    // Base ELEGIBLE (rentBase): 'mes' (default) · 'ano' · 'ytd' (acumulado del año). Solo afecta a RECURRENTES; un encargo one-off es fijo.
    // Fuentes únicas: ventaCLP (honorario) y costoVentaUF (costo de terceros), ambas anuales → se llevan a la base. El esfuerzo (horas) escala igual.
    const mesesYTD = new Date().getMonth()+1                              // meses transcurridos del año en curso (1..12)
    const meses = rentBase==='ano' ? 12 : rentBase==='ytd' ? mesesYTD : 1
    const honor = rec ? (ventaCLP(s, uf)/12)*meses : ventaCLP(s, uf)
    const terc  = rec ? ((costoVentaUF(s, uf)*uf)/12)*meses : (costoVentaUF(s, uf)*uf)
    const perm = esPermanente(p,s); const vh = perm?valorHora.permanente:valorHora.general
    const horas = (parseFloat(p.esfuerzo_horas)||0) * (rec ? meses : 1)
    const esf = horas*vh*uf
    const margen = honor - terc - esf
    return { honor, terc, esf, horas, vh, perm, margen, pct: honor>0?margen/honor:null, uf, rec, base:rentBase }
  }
  const sugerirEsfuerzo = async (p) => {
    setSugEsf(o=>({...o,[p.id]:'busy'}))
    const s = saleDe(p); const area = s?.area||p.area||'General'
    let previo=null
    try{ const {data}=await supabase.from('learnings').select('value').eq('kind','esfuerzo_area').eq('key',area).order('updated_at',{ascending:false}).limit(1).maybeSingle(); if(data?.value) previo=parseFloat(data.value) }catch(_){}
    const prompt = `Eres socio de un estudio de abogados chileno. Estima en CUÁNTAS HORAS de trabajo total se hace este encargo, de principio a fin. Devuelve SOLO un número entero de horas, nada más.\n\nEncargo: "${p.nombre_proyecto||s?.title||''}"\nÁrea: ${area}\nHonorario: ${s?(s.moneda==='CLP'?fmt(s.amount_clp):`UF ${s.amount_uf}`):'—'}${previo?`\nEn casos anteriores de esta área estimaste alrededor de ${previo} horas.`:''}`
    try{ const data=await claudeCall({model:'claude-opus-4-8',max_tokens:20,messages:[{role:'user',content:prompt}]}); const n=parseInt(((data?.content?.[0]?.text||'').match(/\d+/)||[])[0])
      if(n>0){ updP(p,{esfuerzo_horas:n}); try{ await supabase.from('learnings').delete().eq('kind','esfuerzo_area').eq('key',area); await supabase.from('learnings').insert({kind:'esfuerzo_area',key:area,value:String(n)}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
    }catch(e){ appAlert('No se pudo sugerir: '+(e?.message||'reintenta')) }
    setSugEsf(o=>({...o,[p.id]:null}))
  }
  // Fase 4 — SIGUIENTE PASO (IA, compuerta). Toma el estado REAL del proyecto y propone UNA acción concreta. No inventa; si está al día, lo dice.
  const sugerirSiguientePaso = async (p) => {
    setSigPaso(o=>({...o,[p.id]:{busy:true}}))
    if(DEMO){ setTimeout(()=>setSigPaso(o=>({...o,[p.id]:{texto:'Agendar la firma ante notario y confirmar la fecha con los dos socios.', fecha:new Date(Date.now()+5*864e5).toISOString().slice(0,10), aldia:false}})),500); return }
    const s=saleDe(p); const _et=etapasDe(p)
    const etapaTxt=_et?`${_et[Math.min(p.etapa_idx||0,_et.length-1)]} (etapa ${Math.min(p.etapa_idx||0,_et.length-1)+1} de ${_et.length})`:(tipoDe(p)==='permanente'?'asesoría permanente':'encargo puntual')
    const ents=entregablesDe(p).filter(e=>!e.hecho).map(e=>e.texto)
    const hs=hitosDe(p).filter(h=>!h.hecho).map(h=>`${h.titulo}${h.fecha?` (${h.fecha})`:''}`)
    const tks=tareasDe(p).map(t=>`${t.title}${t.due?` (vence ${String(t.due).slice(0,10)})`:''}`)
    const m=mov(p); const uc=ultCont[String(p.cliente_id)]
    const notas=bitacoraDe(p).filter(e=>e.tipo==='nota').slice(0,3).map(e=>e.texto)
    const hoyISO=new Date().toISOString().slice(0,10)
    const brief=[`Proyecto: ${p.nombre_proyecto||s?.title||''}`,`Cliente: ${cnm(p.cliente_id)||'—'}`,`Tipo/etapa: ${etapaTxt}`,
      p.plazo?`Próximo plazo: ${p.plazo}${p.plazo_label?` (${p.plazo_label})`:''}`:'Sin plazo fijado',
      `En qué está (nota): ${p.nota||'—'}`,
      ents.length?`Entregables pendientes: ${ents.join('; ')}`:'Sin entregables pendientes',
      hs.length?`Hitos pendientes: ${hs.join('; ')}`:'Sin hitos pendientes',
      tks.length?`Tareas abiertas: ${tks.join('; ')}`:'Sin tareas abiertas',
      m?.dias!=null?`Último movimiento interno: ${m.ultima?.texto||'actividad'} hace ${m.dias}d`:'Sin movimiento registrado',
      uc&&uc.fecha?`Último correo con el cliente: ${uc.dir==='out'?'enviado por nosotros':'recibido del cliente'} "${uc.asunto}" (${uc.fecha})`:'',
      notas.length?`Últimas notas de bitácora: ${notas.join(' | ')}`:''
    ].filter(Boolean).join('\n')
    const prompt=`Eres un abogado senior de un estudio chileno revisando este encargo. Con SOLO los datos de abajo (no inventes nada), dime el SIGUIENTE PASO concreto para mover el proyecto: una sola acción, clara y accionable, en 1 frase (español de Chile, trato "tú"). Si procede, sugiere una fecha límite realista (a partir de hoy ${hoyISO}). Si el proyecto está al día y no hay nada urgente, dilo claramente. Devuelve SOLO un JSON (sin markdown): {"paso":"la acción en 1 frase","fecha":"YYYY-MM-DD o null","aldia":true/false}.\n\nDATOS:\n${brief}`
    try{ const data=await claudeCall({model:'claude-opus-4-8',max_tokens:300,messages:[{role:'user',content:prompt}]})
      const j=JSON.parse((data?.content?.[0]?.text||'').replace(/```json|```/g,'').trim())
      setSigPaso(o=>({...o,[p.id]:{texto:String(j.paso||'').slice(0,240), fecha:/^\d{4}-\d{2}-\d{2}$/.test(j.fecha||'')?j.fecha:null, aldia:!!j.aldia}}))
    }catch(e){ setSigPaso(o=>({...o,[p.id]:{err:true}})) }
  }
  // Resumen del proyecto de un vistazo (rule-based, datos reales): etapa · tareas abiertas · estado de facturación.
  const resumenDe = p => {
    const bMine = (billing||[]).filter(b=>!b.deleted_at && b.billing_type!=='reembolso' && (String(b.client_id)===String(p.cliente_id) || (p.sale_id&&String(b.sale_id)===String(p.sale_id))))
    const emit = bMine.filter(facturaEmitida)
    const cobrado = bMine.filter(b=>b.paid_at && b.status==='Pagado').reduce((a,b)=>a+(b.amount||0),0)
    const prog = bMine.filter(b=>b.status==='Programada')
    const tks = tareasDe(p)
    const _et = etapasDe(p)
    const parts = [ _et ? _et[Math.min(p.etapa_idx||0,_et.length-1)] : (TIPO_META[tipoDe(p)]?.l||'Encargo') ]
    if(tks.length) parts.push(`${tks.length} tarea${tks.length!==1?'s':''} abierta${tks.length!==1?'s':''}`)
    if(cobrado>0) parts.push(`${fmt(cobrado)} cobrado`)
    else if(emit.length) parts.push(`${emit.length} factura${emit.length!==1?'s':''} emitida${emit.length!==1?'s':''}`)
    else if(prog.length) parts.push(`${prog.length} cuota${prog.length!==1?'s':''} por facturar`)
    else parts.push('sin facturación aún')
    return parts.join(' · ')
  }

  // Movimiento por proyecto (fuente única). Se recomputa cuando cambian los datos reales.
  const movMap = useMemo(()=>{ const m={}; (proyectos||[]).concat(archivados||[]).forEach(p=>{ m[p.id]=carteraMovimiento(p,{billing,tasks,anticipos,expenses,hitos:proyHitos}) }); return m },[proyectos,archivados,billing,tasks,anticipos,expenses,proyHitos])
  const mov = p => movMap[p.id] || { ultima:null, dias:null, score:0 }
  // CADENCIA ADAPTATIVA: cada cuánto conviene revisar un proyecto, según su horizonte (último plazo pendiente).
  // Proyecto corto → se revisa seguido; largo → menos (sin ruido). "Frío" = pasó el intervalo sin avance real.
  const cadenciaProyecto = p => {
    const dd = hitosDe(p).filter(h=>!h.hecho && h.plazo).map(h=>cartDiasPlazo(h.plazo)).filter(d=>d!=null)
    const horizonte = dd.length ? Math.max(...dd) : null
    const intervalo = horizonte==null ? 14 : horizonte<60 ? 7 : horizonte<=180 ? 14 : 21
    const inact = mov(p).dias
    return { intervalo, horizonte, inact, frio: inact!=null && inact > intervalo }
  }
  // BLOQUE 2 — "el proyecto se alimenta solo": gastos de TRÁMITE del cliente (CBR/Conservador/Diario Oficial/Reg.Civil) → hito del proyecto, con compuerta. Solo hitos REALES (inscripción/publicación/posesión), nunca copias/vigencias/certificados. Conservador: no enlaza a ciegas, el humano confirma dentro del proyecto.
  const _TRAMITE_CATS = new Set(['CBR','Conservador','Diario Oficial','Registro Civil','Notaria'])
  const _normC = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim()
  const _tramiteHito = (cat, concept) => { const c=_normC(concept)
    if(/copia|certificad|vigencia|fotocopia/.test(c)) return null   // documentos/retiros, NO el acto (no son hito)
    if(cat==='Notaria'){   // notaría: solo el acto societario/real, nunca poderes/legalizaciones/copias
      if(/constituc/.test(c)) return 'Escritura de constitución'
      if(/compraventa|compra venta/.test(c)) return 'Escritura de compraventa'
      if(/modificaci/.test(c)) return 'Escritura de modificación'
      return null }
    if(/publicac/.test(c)) return 'Publicación en Diario Oficial'
    if(/posesion efectiva/.test(c)) return 'Posesión efectiva inscrita'
    if(/inscrip/.test(c)) return cat==='Diario Oficial' ? 'Publicación en Diario Oficial' : 'Inscripción en CBR'
    return null }
  // El Agente opera HACIA ADELANTE: solo mira trámites recientes (ventana), nunca de tiempos muy pasados. Fecha efectiva = date (legal) o, si falta, created_at (cuándo entró). Overridable para backfill.
  const _TRAMITE_DESDE = (()=>{ const d=new Date(); d.setDate(d.getDate()-180); return d.toISOString().slice(0,10) })()
  const _fechaEfectiva = e => String(e.date||e.created_at||'').slice(0,10)
  // Trámite CONFIRMA (marca hecho) un hito del PLAN. Solo propone si el gasto calza con un hito planificado NO hecho; si no calza con el plan, es contexto (no genera tarjeta).
  const tramiteSugDe = p => {
    if(tipoDe(p)!=='proyecto' || !p.cliente_id) return []
    const desc = new Set((pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='gasto'&&s.estado==='descartada').map(s=>String(s.origen_id)))
    const pendientesPlan = hitosDe(p).filter(h=>!h.hecho)   // hitos del plan aún por cumplir
    const usados=new Set(); const out=[]
    ;(expenses||[]).forEach(e=>{ if(e.deleted_at||e.proyecto_id||String(e.client_id||'')!==String(p.cliente_id)||!_TRAMITE_CATS.has(e.category)||desc.has(String(e.id))) return
      const fe=_fechaEfectiva(e); if(!fe||fe<_TRAMITE_DESDE) return   // hacia adelante: ignora trámites de tiempos muy pasados
      const titulo=_tramiteHito(e.category,e.concept); if(!titulo) return
      const tks=_sigTok(titulo)   // ¿calza con un paso del plan? (todos los tokens del concepto presentes en el título del paso — flexible)
      const h = pendientesPlan.find(x=>{ if(usados.has(x.id)) return false; const hs=new Set(_sigTok(x.titulo)); return tks.length && tks.every(w=>hs.has(w)) })
      if(!h) return   // no está en el plan → contexto, sin tarjeta
      usados.add(h.id)
      out.push({ source:'gasto', origenId:e.id, label:e.concept||'', conceptKey:(glosaKey&&glosaKey(e.concept||''))||_normC(e.concept), hitoId:h.id, hitoTitulo:h.titulo, fecha:e.date||null })
    })
    return out
  }
  // DOCUMENTOS de Drive que confirman un paso del plan: escaneo de la carpeta del cliente (nombres), match por tokens significativos del hito, hacia adelante (modifiedTime). Compuerta → aprende → se libera.
  const _STOP = new Set(['de','en','el','la','los','las','del','por','con','una','uno','ante','para','segun','sobre','entre','desde','hasta','este','esta','su','sus','al','y','e','o'])
  const _sigTok = s => _normC(s).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(w=>w.length>=3 && !_STOP.has(w))
  const _docConfirma = (fileName, hitoTitulo) => {
    const ht=_sigTok(hitoTitulo); if(!ht.length) return false
    const fnTok=new Set(_sigTok(String(fileName).replace(/\.[a-z0-9]{2,5}$/,'')))
    const overlap=ht.filter(w=>fnTok.has(w)); if(!overlap.length) return false
    if(ht.length===1) return overlap[0].length>=5                     // hito de una sola palabra fuerte (Firma, Audiencia…)
    return overlap.length>=2 && overlap.some(w=>w.length>=6)          // ≥2 palabras en común y al menos una fuerte (evita falsos positivos)
  }
  const docSugDe = p => {
    if(tipoDe(p)!=='proyecto' || !p.cliente_id) return []
    const dd = docsProy[String(p.id)]; const files = dd&&dd.files; if(!files||!files.length) return []
    const desc = new Set((pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='documento'&&s.estado==='descartada').map(s=>String(s.origen_id)))
    const pendientesPlan = hitosDe(p).filter(h=>!h.hecho)
    const usados=new Set(); const out=[]
    files.forEach(f=>{ if(desc.has(String(f.id))) return; const fe=String(f.modifiedTime||'').slice(0,10); if(fe&&fe<_TRAMITE_DESDE) return   // hacia adelante
      const h = pendientesPlan.find(x=>!usados.has(x.id) && _docConfirma(f.name, x.titulo)); if(!h) return
      usados.add(h.id)
      out.push({ source:'documento', origenId:f.id, label:f.name, conceptKey:_normC((f.name||'').replace(/\.[a-z0-9]{2,5}$/,'')), hitoId:h.id, hitoTitulo:h.titulo, fecha:fe||null })
    })
    return out
  }
  // CORREOS que confirman un paso del plan: asunto+snippet comparten tokens significativos con el título del paso (hacia adelante). Compuerta.
  const correoSugDe = p => {
    if(tipoDe(p)!=='proyecto' || !p.cliente_id) return []
    const cc=correosProy[String(p.id)]; const msgs=cc&&cc.msgs; if(!msgs||!msgs.length) return []
    const desc=new Set((pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='correo'&&s.estado==='descartada').map(s=>String(s.origen_id)))
    const pend=hitosDe(p).filter(h=>!h.hecho)
    const usados=new Set(); const out=[]
    msgs.forEach(m=>{ if(desc.has(String(m.id))) return; const fe=String(m.fecha||'').slice(0,10); if(fe&&fe<_TRAMITE_DESDE) return
      const texto=`${m.subject||''} ${m.snippet||''}`
      const h=pend.find(x=>!usados.has(x.id) && _docConfirma(texto, x.titulo)); if(!h) return
      usados.add(h.id)
      out.push({ source:'correo', origenId:m.id, label:m.subject||'(sin asunto)', conceptKey:_normC(m.subject||''), hitoId:h.id, hitoTitulo:h.titulo, fecha:fe||null })
    })
    return out
  }
  // OLA 4 — COBROS Y FONDOS que confirman un paso: un anticipo recibido confirma "Provisión de fondos"; una factura pagada confirma "Pago de honorarios".
  // Reusa los anticipos y la cobranza que ya existen (sin cálculo de saldo — solo confirma el paso). Hacia adelante. Compuerta.
  const fondoSugDe = p => {
    if(tipoDe(p)!=='proyecto' || !p.cliente_id) return []
    const pendFondo = hitosDe(p).filter(h=>!h.hecho && /provisi[oó]n|fondos|anticipo/.test(_normC(h.titulo)))
    const pendPago = hitosDe(p).filter(h=>!h.hecho && /pago|honorario|cobro/.test(_normC(h.titulo)))
    if(!pendFondo.length && !pendPago.length) return []
    const desc=new Set((pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='fondo'&&s.estado==='descartada').map(s=>String(s.origen_id)))
    const usados=new Set(); const out=[]
    ;(anticipos||[]).forEach(a=>{ if(!pendFondo.length||String(a.client_id||'')!==String(p.cliente_id)||a.deleted_at) return
      const fe=String(a.fecha||'').slice(0,10); if(fe&&fe<_TRAMITE_DESDE) return; const oid='ant:'+a.id; if(desc.has(oid)) return
      const h=pendFondo.find(x=>!usados.has(x.id)); if(!h) return; usados.add(h.id)
      out.push({ source:'fondo', origenId:oid, label:`Anticipo recibido${a.nota?` · ${a.nota}`:''}`, conceptKey:_normC(h.titulo), hitoId:h.id, hitoTitulo:h.titulo, fecha:fe||null }) })
    ;(billing||[]).forEach(b=>{ if(!pendPago.length||b.deleted_at||!b.paid_at||b.status!=='Pagado') return
      if(String(b.client_id||'')!==String(p.cliente_id)&&!(p.sale_id&&String(b.sale_id)===String(p.sale_id))) return
      const fe=String(b.paid_at).slice(0,10); if(fe&&fe<_TRAMITE_DESDE) return; const oid='fac:'+b.id; if(desc.has(oid)) return
      const h=pendPago.find(x=>!usados.has(x.id)); if(!h) return; usados.add(h.id)
      out.push({ source:'fondo', origenId:oid, label:`Pago recibido${b.invoice_no?` · factura N° ${b.invoice_no}`:''}`, conceptKey:_normC(h.titulo), hitoId:h.id, hitoTitulo:h.titulo, fecha:fe||null }) })
    return out
  }
  // OLA 4 — CITAS de Google Calendar (audiencia/firma) que ya ocurrieron confirman su paso (match por tokens del título). Compuerta.
  const calSugDe = p => {
    if(tipoDe(p)!=='proyecto' || !p.cliente_id) return []
    const cc=calProy[String(p.id)]; const evs=cc&&cc.eventos; if(!evs||!evs.length) return []
    const hoy=new Date().toISOString().slice(0,10)
    const desc=new Set((pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='calendario'&&s.estado==='descartada').map(s=>String(s.origen_id)))
    const pend=hitosDe(p).filter(h=>!h.hecho)
    const usados=new Set(); const out=[]
    evs.forEach(ev=>{ const fe=String(ev.fecha||'').slice(0,10); if(!fe||fe>hoy||fe<_TRAMITE_DESDE) return   // solo citas pasadas (ya ocurrieron) y hacia adelante
      if(desc.has(String(ev.id))) return
      const h=pend.find(x=>!usados.has(x.id) && _docConfirma(ev.summary, x.titulo)); if(!h) return
      usados.add(h.id)
      out.push({ source:'calendario', origenId:ev.id, label:ev.summary, conceptKey:_normC(ev.summary), hitoId:h.id, hitoTitulo:h.titulo, fecha:fe||null }) })
    return out
  }
  // Escaneo perezoso de la carpeta de Drive del cliente (admin). Cachea por proyecto. Carpeta = clients.drive_folder_id; escanea el folder + subcarpetas (1 nivel).
  const cargarDocsProy = async (p) => {
    if(!esAdmin || !p.cliente_id || docsProy[String(p.id)]) return
    if(DEMO){ const hoy=new Date().toISOString().slice(0,10); setDocsProy(o=>({...o,[String(p.id)]:{ files:[
      { id:'d1', name:'Escritura de constitución Pehuén SpA.docx', mimeType:'application/vnd.google-apps.document', modifiedTime:hoy },
      { id:'d2', name:'Publicación Diario Oficial - extracto.pdf', mimeType:'application/pdf', modifiedTime:hoy },
      { id:'d3', name:'Minuta reunión cliente.docx', mimeType:'application/vnd.google-apps.document', modifiedTime:hoy },
      { id:'d4', name:'Certificado de vigencia sociedad.pdf', mimeType:'application/pdf', modifiedTime:hoy },
    ] }})); return }
    const cl = clients.find(c=>String(c.id)===String(p.cliente_id)); const fid = cl?.drive_folder_id
    if(!fid){ setDocsProy(o=>({...o,[String(p.id)]:{none:true,noFolder:true}})); return }
    setDocsProy(o=>({...o,[String(p.id)]:{loading:true}}))
    try{
      const top = await driveCall({ action:'search', q:`'${fid}' in parents and trashed=false`, pageSize:100 })
      let files = (top.files||[]).filter(f=>f.mimeType!=='application/vnd.google-apps.folder')
      const subs = (top.files||[]).filter(f=>f.mimeType==='application/vnd.google-apps.folder').slice(0,12)
      for(const s of subs){ try{ const r=await driveCall({ action:'search', q:`'${s.id}' in parents and trashed=false`, pageSize:100 }); files=files.concat((r.files||[]).filter(f=>f.mimeType!=='application/vnd.google-apps.folder')) }catch(_){} }
      setDocsProy(o=>({...o,[String(p.id)]:{ files }}))
    }catch(e){ setDocsProy(o=>({...o,[String(p.id)]:{ err:(e&&(e.code===401||e.code===403))?'sinpermiso':'error' }})) }
  }
  // ¿El contenido del archivo es legible por IA? PDF (pdfjs) + Google Doc / Word .docx (mammoth) — vía leerDriveTexto.
  const _legible = f => { const mt=f.mimeType||''; const nm=(f.name||'').toLowerCase()
    return mt==='application/pdf' || nm.endsWith('.pdf') || mt==='application/vnd.google-apps.document' || mt==='application/vnd.openxmlformats-officedocument.wordprocessingml.document' || nm.endsWith('.docx') }
  // Revisa con IA el CONTENIDO de los documentos que el NOMBRE no confirmó: pregunta cuál paso del plan evidencia cada uno. Compuerta (surgen en la misma tarjeta). Acotado (6 docs) y bajo demanda.
  // Revisa con IA el CONTENIDO de la evidencia que no confirmó por nombre/asunto: documentos (PDF, se baja y extrae texto) + correos (asunto+snippet). Una sola llamada; compuerta.
  const revisarDocsIA = async (p) => {
    if(iaBusy[p.id]) return; setIaBusy(o=>({...o,[p.id]:true}))
    try{
      const pend=hitosDe(p).filter(h=>!h.hecho)
      const dd=docsProy[String(p.id)]; const files=(dd&&dd.files)||[]
      const yaDoc=new Set([...docSugDe(p).map(s=>String(s.origenId)), ...(pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='documento').map(s=>String(s.origen_id))])
      const docCands=files.filter(f=>{ const fe=String(f.modifiedTime||'').slice(0,10); return _legible(f) && !yaDoc.has(String(f.id)) && (!fe||fe>=_TRAMITE_DESDE) }).slice(0,5)
      const cc=correosProy[String(p.id)]; const msgs=(cc&&cc.msgs)||[]
      const yaCorreo=new Set([...correoSugDe(p).map(s=>String(s.origenId)), ...(pmoSug||[]).filter(s=>String(s.proyecto_id)===String(p.id)&&s.origen==='correo').map(s=>String(s.origen_id))])
      const mailCands=msgs.filter(m=>{ const fe=String(m.fecha||'').slice(0,10); return !yaCorreo.has(String(m.id)) && (!fe||fe>=_TRAMITE_DESDE) }).slice(0,8)
      if(!pend.length || (!docCands.length && !mailCands.length)){ setIaSug(o=>({...o,[p.id]:[]})); setIaBusy(o=>({...o,[p.id]:false})); return }
      const items=[]
      for(const f of docCands){ try{ const tx=await leerDriveTexto(f); if(tx&&tx.trim().length>40) items.push({ source:'documento', id:f.id, name:f.name, fecha:String(f.modifiedTime||'').slice(0,10), texto:tx.slice(0,6000) }) }catch(_){} }
      mailCands.forEach(m=>{ const tx=`${m.subject||''}\n${m.snippet||''}`; if(tx.trim().length>10) items.push({ source:'correo', id:m.id, name:m.subject||'(correo)', fecha:String(m.fecha||'').slice(0,10), texto:tx }) })
      if(!items.length){ setIaSug(o=>({...o,[p.id]:[]})); setIaBusy(o=>({...o,[p.id]:false})); return }
      const pasosTxt=pend.map((h,i)=>`${i+1}. ${h.titulo}`).join('\n')
      const itemsTxt=items.map((d,i)=>`[${String.fromCharCode(65+i)}] (${d.source}) ${d.name}\n${d.texto}`).join('\n\n---\n\n')
      const prompt=`Eres asistente de un estudio de abogados chileno. PASOS pendientes del proyecto:\n${pasosTxt}\n\nEVIDENCIA (documentos y correos — tipo, nombre/asunto, extracto):\n${itemsTxt}\n\n¿Qué evidencia PRUEBA que un paso está CUMPLIDO (es el producto/resultado de ese paso, no solo lo menciona)? Responde SOLO JSON: [{"doc":"A","paso":N}] con los matches claros; si ninguno, []. Usa solo lo que la evidencia prueba; no inventes.`
      const data=await claudeCall({model:'claude-sonnet-4-6',max_tokens:400,messages:[{role:'user',content:prompt}]})
      const raw=(data?.content?.[0]?.text||'[]').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      let arr=[]; try{ arr=JSON.parse(raw) }catch(_){ arr=[] }
      const out=[]; (Array.isArray(arr)?arr:[]).forEach(m=>{ const di=String(m.doc||'').toUpperCase().charCodeAt(0)-65; const pi=(parseInt(m.paso,10)||0)-1; const d=items[di]; const h=pend[pi]; if(d&&h&&!out.some(x=>x.hitoId===h.id)) out.push({ source:d.source, origenId:d.id, label:d.name+' · leído por IA', conceptKey:_normC(d.name), hitoId:h.id, hitoTitulo:h.titulo, fecha:d.fecha||null }) })
      setIaSug(o=>({...o,[p.id]:out}))
    }catch(e){ setIaSug(o=>({...o,[p.id]:[]})) }
    setIaBusy(o=>({...o,[p.id]:false}))
  }
  // Fase 4 — RADAR DE ATENCIÓN (rule-based, datos reales; umbrales alineados al correo semanal). Anticipa, no proyecta plata ni fechas inventadas.
  // Devuelve {nivel:'alto'|'medio', motivos:[], orden} o null si el proyecto está al día. Solo proyectos en curso.
  const riesgoDe = p => {
    if(p.activo===false || p.pausado) return null
    const motivos=[]; let sev=0   // 2=alto, 1=medio
    const dP = cartDiasPlazo(p.plazo)
    if(dP!=null && dP<0){ motivos.push(`Plazo vencido ${-dP}d`); sev=Math.max(sev,2) }
    else if(dP!=null && dP<=3){ motivos.push(dP===0?'Plazo vence hoy':`Plazo en ${dP}d`); sev=Math.max(sev,1) }
    hitosDe(p).forEach(h=>{ if(h.hecho||!h.fecha) return; const d=cartDiasPlazo(h.fecha); if(d!=null&&d<0){ motivos.push(`Hito vencido: ${h.titulo}`); sev=Math.max(sev,2) } else if(d!=null&&d<=3){ motivos.push(`Hito ${d===0?'hoy':`en ${d}d`}: ${h.titulo}`); sev=Math.max(sev,1) } })
    const tks=tareasDe(p); const venc=tks.filter(t=>{ const d=daysLeft(t.due); return d!=null&&d<0 }).length
    if(venc>0){ motivos.push(`${venc} tarea${venc!==1?'s':''} vencida${venc!==1?'s':''}`); sev=Math.max(sev,2) }
    const md=mov(p).dias
    if(md!=null && md>45){ motivos.push(`Sin movimiento ${md}d`); sev=Math.max(sev,2) }
    else if(md!=null && md>21){ motivos.push(`Sin movimiento ${md}d`); sev=Math.max(sev,1) }
    if(!motivos.length) return null
    return { nivel: sev>=2?'alto':'medio', motivos, orden: sev*1000 + (dP!=null&&dP<0?-dP:0) + (md||0) }
  }
  const [sigPaso,setSigPaso] = useState({})   // Siguiente paso IA por proyecto: {busy}|{texto,fecha}|{err}
  const rows = useMemo(()=>{
    // Pestaña: En curso (activa, no pausada) · En pausa (activa, pausada) · Terminados (archivados = activo:false)
    let arr = fase==='terminados' ? (archivados||[]) : (proyectos||[]).filter(p=> p.activo!==false && (fase==='pausa' ? !!p.pausado : !p.pausado))
    // Selector de persona: 'all' = toda la cartera del estudio; un inicial = proyectos donde esa persona es responsable ∪ equipo ∪ seguidor.
    if(selPer && selPer!=='all') arr = arr.filter(p=>esDePersona(p,selPer))
    if(estadoF!=='todos') arr = arr.filter(p=>(p.estado||'verde')===estadoF)
    if(q){ const s=q.toLowerCase(); arr = arr.filter(p=>(cnm(p.cliente_id)+' '+(p.nombre_proyecto||'')+' '+(p.nota||'')).toLowerCase().includes(s)) }
    const key = p => { const d=mov(p).dias; return d==null?Infinity:d }
    const pin = (a,b) => { const fa=!!a.fijado, fb=!!b.fijado; if(fa!==fb) return fa?-1:1; if(fa&&fb) return String(a.fijado_at||'').localeCompare(String(b.fijado_at||'')); return 0 }   // fijados arriba, en el orden en que se fijaron
    return [...arr].sort((a,b)=>{
      const pn = pin(a,b); if(pn!==0) return pn
      if(sortBy==='movimiento'){ const pa=esPropAbierta(a), pb=esPropAbierta(b); if(pa!==pb) return pa?-1:1; return mov(b).score-mov(a).score }
      if(sortBy==='sinmover') return key(b)-key(a)
      if(sortBy==='plazo'){ const pa=a.plazo?new Date(a.plazo).getTime():Infinity, pb=b.plazo?new Date(b.plazo).getTime():Infinity; return pa-pb }
      if(sortBy==='prioridad') return carteraScore(b)-carteraScore(a)
      if(sortBy==='cliente') return cnm(a.cliente_id).localeCompare(cnm(b.cliente_id),'es')
      return 0
    })
  },[proyectos,archivados,fase,esAdmin,miInicial,selPer,proyEquipo,proySeguidores,estadoF,q,sortBy,clients,sales,movMap])

  const abrir = p => { setFocoOpen(false); setMetOpen(false); setOpenId(p.id); setWsTab('resumen'); setDraft(p.nota||''); cargarUltContacto(p); cargarDocsProy(p); cargarCorreosProy(p); cargarCalProy(p) }   // abre el proyecto como PÁGINA workspace (cierra Mi foco/Métricas; el "‹ Mis proyectos" lo cierra)
  // Entrar directo a un proyecto desde el Inicio ("Mis proyectos"): abre su detalle y ajusta la pestaña.
  useEffect(()=>{ if(!focusId) return; const p=(proyectos||[]).find(x=>String(x.id)===String(focusId)); if(p){ setFase(p.pausado?'pausa':'curso'); setOpenId(focusId); setDraft(p.nota||''); cargarUltContacto(p) } onFocusHandled&&onFocusHandled() },[focusId])   // eslint-disable-line
  useEffect(()=>{ if(openId){ const p=(proyectos||[]).find(x=>String(x.id)===String(openId)); if(p) setDraft(p.nota||'') } },[])   // eslint-disable-line -- al volver con un proyecto abierto, carga su nota en el editor
  // OLA 3 — AUTO-CONFIRMAR al abrir (acción deliberada del usuario, NO en cada render): un gasto de trámite cuyo mapeo ya se
  // aprendió ≥AUTO_MIN veces marca su paso SOLO (reversible). Solo gasto (evidencia inequívoca); docs/correos siguen con compuerta.
  useEffect(()=>{ if(!openId) return; const p=(proyectos||[]).find(x=>String(x.id)===String(openId)); if(!p) return
    tramiteSugDe(p).forEach(s=>{ const k=s.source+':'+s.origenId; if(autoDone.current.has(k)||autoNo.has(k)) return
      if(s.source!=='gasto'||!s.conceptKey||(pmoAutoCount[s.conceptKey]||0)<AUTO_MIN) return
      autoDone.current.add(k); onAplicarEvidencia&&onAplicarEvidencia(p,s,{auto:true})
      setAutoHechos(a=>a.some(x=>x.evKey===k)?a:[...a,{pid:String(p.id),hitoId:s.hitoId,titulo:s.hitoTitulo,source:s.source,origenId:s.origenId,evKey:k}]) })
  },[openId,pmoAutoCount])   // eslint-disable-line
  const deshacerAuto = (x) => { onUpdHito&&onUpdHito(x.hitoId,{hecho:false,fecha:null}); setAutoNo(s=>{ const n=new Set(s); n.add(x.evKey); return n }); setAutoHechos(a=>a.filter(y=>y.evKey!==x.evKey)) }
  const patch = async (p,campos) => {
    const upd = { ...campos, ultima_actividad:HOY, updated_at:new Date().toISOString() }
    setProyectos(prev=>prev.map(x=>x.id===p.id?{...x,...upd}:x))
    const { error } = await supabase.from('proyectos_cartera').update(upd).eq('id',p.id)
    if(error) appAlert('No se pudo guardar: '+error.message)
  }
  const avanzar = p => { const et=etapasDe(p); const max=(et?et.length:6)-1; patch(p,{ etapa_idx:Math.min(max,(p.etapa_idx||0)+1) }) }
  const setTemplate = (p,tpl) => { const et=STAGE_TEMPLATES[tpl]||ETAPAS_CARTERA; updP(p,{ template:tpl||null, etapa_idx:Math.min(p.etapa_idx||0, et.length-1) }) }
  const setEstado = (p,e) => patch(p,{ estado:e })
  const guardarNota = p => { if((draft||'')!==(p.nota||'')) patch(p,{ nota:draft||null }) }
  // Cambios de gestión (pausar/fijar) que NO son "movimiento real": no tocan ultima_actividad.
  const updP = async (p,campos) => {
    setProyectos(prev=>prev.map(x=>x.id===p.id?{...x,...campos}:x))
    const { error } = await supabase.from('proyectos_cartera').update({...campos,updated_at:new Date().toISOString()}).eq('id',p.id)
    if(error) appAlert('No se pudo guardar: '+error.message)
  }
  const togglePausa = p => updP(p,{ pausado: !p.pausado })
  const fijar = p => updP(p,{ fijado:true, fijado_at:new Date().toISOString() })
  const quitarFijar = p => updP(p,{ fijado:false, fijado_at:null })
  const archivar = async p => {
    if(!(await appConfirm(`¿Terminar "${p.nombre_proyecto||cnm(p.cliente_id)}"? Sale del panel; queda en Terminados, no se borra.`))) return
    setProyectos(prev=>prev.filter(x=>x.id!==p.id)); setArchivados(prev=>[{...p,activo:false},...prev]); setOpenId(null)
    const { error } = await supabase.from('proyectos_cartera').update({activo:false,updated_at:new Date().toISOString()}).eq('id',p.id)
    if(error) appAlert('No se pudo terminar: '+error.message)
  }
  const reponer = async p => {
    setArchivados(prev=>prev.filter(x=>x.id!==p.id)); setProyectos(prev=>[{...p,activo:true,ultima_actividad:HOY},...prev])
    const { error } = await supabase.from('proyectos_cartera').update({activo:true,ultima_actividad:HOY,updated_at:new Date().toISOString()}).eq('id',p.id)
    if(error) appAlert('No se pudo reponer: '+error.message)
  }
  useEffect(()=>{
    if(DEMO){ setArchivados([
      {id:'pa1',cliente_id:'c5',nombre_proyecto:'Registro de marca',responsable:'CL',estado:'verde',activo:false},
      {id:'pa2',cliente_id:'c7',nombre_proyecto:'Contrato de flota',responsable:'EE',estado:'verde',activo:false},
    ]); return }
    supabase.from('proyectos_cartera').select('*').eq('activo',false).order('updated_at',{ascending:false}).limit(50).then(({data})=>{ if(data) setArchivados(data) },()=>{})
  },[])   // eslint-disable-line
  const crear = async () => {
    if(!nf.cliente_id||!nf.sale_id||!nf.nombre.trim()){ appAlert('Un proyecto nace de un cliente y una venta. Elige la venta y, si quieres, cámbiale el nombre.'); return }
    const op = nf.operacionId ? (pmoOps||[]).find(o=>String(o.id)===String(nf.operacionId)) : null
    const row = { cliente_id:nf.cliente_id, sale_id:nf.sale_id||null, nombre_proyecto:nf.nombre.trim(), responsable:nf.responsable||null, nota:nf.nota.trim()||null, plazo:nf.plazo||null, estado:'verde', etapa_idx:0, origen:nf.sale_id?'venta':'manual', activo:true, ultima_actividad:HOY }
    let created
    if(DEMO){ created={id:'p'+Date.now(),...row}; setProyectos(prev=>[created,...prev]) }
    else { const { data,error } = await supabase.from('proyectos_cartera').insert(row).select().single(); if(error){ appAlert('No se pudo crear: '+error.message); return } created=data; setProyectos(prev=>[data,...prev]) }
    if(op && created && onSeedPlan) onSeedPlan(created.id, op)   // nace con su plan (los pasos del asunto)
    setNuevo(false); setNf(NF0); setClientQ('')
  }


  // Fase 2B: escaneo del correo (client-side, tu buzón). Corre 1×/día al abrir (solo admin) + botón manual. Cache en localStorage.
  const NOV_KEY = 'cartera_nov_'+HOY
  const escanear = async (forzar) => {
    if(escaneando) return
    setEscaneando(true)
    let res=[], sinPermiso=false
    // 401 = sin token; 403 = permiso/scope no concedido (típico si entraste antes de sumar el scope de Calendar → hay que reentrar).
    try{ res = res.concat(await escanearCarteraGmail(clients, proyectos)) }catch(e){ if(e?.code===401||e?.code===403) sinPermiso=true }
    try{ res = res.concat(await escanearCarteraCalendario(clients, proyectos)) }catch(e){ if(e?.code===401||e?.code===403) sinPermiso=true }
    setNovedades(res); try{ localStorage.setItem(NOV_KEY, JSON.stringify(res)); localStorage.setItem('cartera_nov_dia', HOY) }catch(_){}
    if(forzar){ if(sinPermiso) appAlert('No pude leer correo/calendario. Cierra sesión y vuelve a entrar con tu correo de la oficina (Google) para conceder el permiso, y prueba de nuevo.'); else if(!res.length) appAlert('Sin novedades por ahora.') }
    setEscaneando(false)
  }
  useEffect(()=>{
    if(!esAdmin) return
    if(DEMO){ setNovedades([
      {tipo:'update',proyecto_id:(proyectos[0]&&proyectos[0].id)||'p1',sugerencia:'Recibidos los poderes; falta agendar la firma ante notario',fuente:'Juan Pérez — RE: Poderes firmados'},
      {tipo:'hito',proyecto_id:(proyectos[1]&&proyectos[1].id)||'p2',titulo:'Audiencia de conciliación',fecha:new Date(Date.now()+9*864e5).toISOString().slice(0,10),fuente:'lun 14 jul · 09:30 · Juzgado Civil'},
      {tipo:'nuevo',cliente_id:(clients.find(c=>!c.is_internal)||{}).id||null,sugerencia:'Posible constitución de sociedad',fuente:'gerencia@metalurgica — Consulta constitución'},
    ]); return }
    try{ const dia=localStorage.getItem('cartera_nov_dia'); if(dia===HOY){ const c=localStorage.getItem(NOV_KEY); if(c){ setNovedades(JSON.parse(c)||[]); return } } }catch(_){}
    escanear(false)   // primer ingreso del día → escanea solo
  },[])   // eslint-disable-line
  const cerrarNov = (idx) => { setNovedades(prev=>{ const nx=prev.filter((_,i)=>i!==idx); try{ localStorage.setItem(NOV_KEY, JSON.stringify(nx)) }catch(_){}; return nx }) }
  const aceptarNov = async (n, idx) => {
    if(n.tipo==='update'){ const p=proyectos.find(x=>String(x.id)===String(n.proyecto_id)); if(p) await patch(p,{nota:n.sugerencia}); cerrarNov(idx) }
    else if(n.tipo==='hito'){
      const p=proyectos.find(x=>String(x.id)===String(n.proyecto_id)); if(!p){ appAlert('Ese proyecto ya no está.'); return }
      await patch(p,{ plazo:n.fecha, plazo_label:n.titulo })
      // Cae como hito del proyecto (panel Hitos + Mi semana), salvo que ya exista uno igual (dedup por título+fecha).
      const yaHito=(proyHitos||[]).some(h=>String(h.proyecto_id)===String(p.id)&&String(h.fecha||'').slice(0,10)===n.fecha&&_normTxt(h.titulo||'')===_normTxt(n.titulo||''))
      if(!yaHito&&onAddHito) onAddHito(p.id,n.titulo,n.fecha)
      if(p.cliente_id) supabase.from('plazos').insert({client_id:String(p.cliente_id),titulo:n.titulo,fecha:n.fecha,tipo:'hito',fuente:'correo/calendario'}).then(()=>{},()=>{})
      cerrarNov(idx)
    }
    else if(n.tipo==='nuevo'){
      if(!n.cliente_id){ appAlert('Esta novedad no trae cliente; créala a mano con "+ Nuevo".'); return }
      const row={ cliente_id:String(n.cliente_id), nombre_proyecto:n.sugerencia, responsable:esAdmin?'CL':(miInicial||null), nota:null, estado:'verde', etapa_idx:0, origen:'correo', activo:true, ultima_actividad:HOY }
      const { data,error } = await supabase.from('proyectos_cartera').insert(row).select().single()
      if(error){ appAlert('No se pudo crear: '+error.message); return }
      setProyectos(prev=>[data,...prev]); cerrarNov(idx)
    }
  }

  const nCrit = rows.filter(p=>(p.estado||'verde')==='rojo').length
  const chipSty = (on,col,bg) => ({ fontSize:12, fontWeight:500, color:on?'#fff':col, background:on?C.accent:bg, borderRadius:20, padding:'4px 12px', border:'none', cursor:'pointer' })
  const perItem = { display:'flex', alignItems:'center', gap:9, width:'100%', border:'none', background:'none', padding:'7px 9px', borderRadius:8, fontSize:13, fontWeight:600, color:C.text, textAlign:'left', cursor:'pointer' }
  const perAv = (i,sz=22) => <span style={{ width:sz, height:sz, borderRadius:'50%', background:CART_AV[i]||C.muted, color:'#fff', fontSize:9.5, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i}</span>

  // Fijar a nivel CLIENTE (toca todos sus proyectos activos a la vez).
  const fijarCliente = g => g.proyectos.forEach(p=>{ if(!p.fijado) fijar(p) })
  const quitarFijarCliente = g => g.proyectos.forEach(p=>{ if(p.fijado) quitarFijar(p) })
  // Grupos por cliente (protagonista). rows ya viene filtrado + ordenado (fijados y movimiento); agrupar preserva ese orden.
  const grupos = (()=>{ const seen=new Map(); rows.forEach(p=>{ const cid=String(p.cliente_id||'—'); if(!seen.has(cid)) seen.set(cid,{cliente_id:p.cliente_id,cliente:cnm(p.cliente_id)||'—',proyectos:[]}); seen.get(cid).proyectos.push(p) })
    return [...seen.values()].map(g=>{ let best=null,fij=false; g.proyectos.forEach(p=>{ const mm=mov(p); if(!best||mm.score>best.score) best=mm; if(p.fijado) fij=true }); return {...g, mov:best||{ultima:null,dias:null,score:0}, fijado:fij} }) })()
  const CHINCHETA = <svg width="12" height="12" viewBox="0 0 24 24" fill={C.accent} style={{flexShrink:0}}><path d="M14 2l8 8-5 1-4 4-1 6-3-3-6 6 6-6-3-3 6-1 4-4z"/></svg>
  const señalLine = (m, style={}) => { const s=m.ultima, dd=m.dias
    const fecha = dd==null?'':dd<=0?'hoy':dd===1?'ayer':fmtDia(s&&s.iso)
    if(!s) return <div style={{ fontSize:11, color:C.grisText, display:'flex', alignItems:'center', gap:6, ...style }}><span style={{ width:6, height:6, borderRadius:'50%', background:C.done }}/>Sin señales{dd!=null?` · ${dd<=0?'hoy':dd===1?'ayer':`hace ${dd} días`}`:''}</div>
    return <div style={{ fontSize:12, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', ...style }}><span style={{ width:6, height:6, borderRadius:'50%', background:SEÑAL_COL[s.tipo]||C.muted, flexShrink:0 }}/><span style={{ color:C.text, fontWeight:600 }}>{s.texto}</span><span style={{ color:C.muted, fontWeight:600 }}>· {fecha}</span>{dd>1&&<span style={{ color:C.textSoft, fontSize:10 }}>· hace {dd} d</span>}</div>
  }


  // Icono contextual del próximo paso (según el texto del hito) — Opción A del render aprobado.
  const stepIcon = cap => { const c=(cap||'').toLowerCase()
    if(/firma|escritura/.test(c)) return <><path d="M3 21s3.5-.8 6-3.3l9.5-9.5-2.7-2.7L6.3 15C3.8 17.5 3 21 3 21z"/><path d="M14 6l4 4"/></>
    if(/inscrip|cbr|conservador|registro/.test(c)) return <><rect x="5" y="20" width="14" height="2" rx="1"/><path d="M8 17h8l1-5a5 5 0 1 0-10 0z"/></>
    if(/borrador|estatuto|redac|minuta|contrato|poder|mandato/.test(c)) return <><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 13h5M10 17h3"/></>
    if(/entrega|env[ií]o|remis/.test(c)) return <path d="M3 11l18-8-7 18-3-7-8-3z"/>
    if(/due diligence|informe|an[aá]lisis|revis/.test(c)) return <><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></>
    if(/junta|reuni|audiencia|comparendo/.test(c)) return <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/></>
    return <><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></>
  }
  // OLA 2 — FASE del proyecto (para la "vista por etapa del estudio"): se deduce del PRÓXIMO paso pendiente,
  // mapeado al flujo típico (diagnóstico → diseño → negociación → escrituras → inscripciones → SII → cierre).
  // Sin plan / al día tienen su propia caja. Es el mapa del flujo de trabajo del estudio en una pantalla.
  const FASE_DEFS = [
    {k:'diagnostico',   l:'Estudio de antecedentes',      o:1, re:/diagn[oó]stico|due diligence|estudio|levantamiento|antecedentes|t[ií]tulos/},
    {k:'diseno',        l:'Redacción de documentos',      o:2, re:/dise[ñn]o|estatuto|borrador|minuta|informe|estructura|contrato|poder|mandato/},
    {k:'negociacion',   l:'Negociación',                  o:3, re:/revisi[oó]n|negociaci[oó]n/},
    {k:'escrituras',    l:'Otorgamiento y firma',         o:4, re:/escritura|firma|notar[ií]a|comparec/},
    {k:'inscripciones', l:'Publicaciones e inscripciones',o:5, re:/publicaci[oó]n|diario oficial|inscripci[oó]n|cbr|conservador|registro|posesi[oó]n/},
    {k:'sii',           l:'Trámites ante el SII',         o:6, re:/\bsii\b|\brut\b|inicio de actividades|impuesto|efectos/},
    {k:'cierre',        l:'Cierre',                       o:7, re:/cierre|entrega|carpeta|cumplimiento/},
  ]
  const faseDePaso = t => { const s=(t||'').toLowerCase(); return FASE_DEFS.find(x=>x.re.test(s)) || {k:'otro',l:'Otros pasos',o:90} }
  const faseDe = p => { const pasos=hitosDe(p); if(!pasos.length) return {k:'sinplan',l:'Sin plan',o:98}
    const next=pasos.filter(h=>!h.hecho).sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))[0]
    if(!next) return {k:'aldia',l:'Plan al día',o:97}
    const t=(next.titulo||'').toLowerCase(); return FASE_DEFS.find(x=>x.re.test(t)) || {k:'otro',l:'En curso',o:90} }
  // Fila A+ del landing: nombre · cliente debajo · avance en pasos (chip) · próximo paso pendiente con icono+color · avatar responsable.
  const filaProyecto = p => {
    const pasosF = hitosDe(p)
    const pDone = pasosF.filter(h=>h.hecho).length
    const nextH = pasosF.filter(h=>!h.hecho).sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))[0]
    const etapaNm = pasosF.length ? `${pDone} de ${pasosF.length} pasos` : (TIPO_META[tipoDe(p)]?.l||'Encargo')
    const cap = nextH?.titulo || p.plazo_label || (p.plazo?'Próximo plazo':(pasosF.length?'Plan al día':'Sin plan aún'))
    const fecha = nextH?.plazo || nextH?.fecha || p.plazo || null
    const dd = fecha ? cartDiasPlazo(fecha) : null
    const r = riesgoDe(p)
    const tone = ((fecha && dd!=null && dd<0) || r?.nivel==='alto') ? 'late' : (dd!=null && dd<=7) ? 'soon' : 'ok'
    const tc = tone==='late'?C.overdueText:tone==='soon'?C.soonText:C.greenText
    const dc = tone==='late'?C.overdue:tone==='soon'?'#E09B2D':C.greenText
    const due = fecha ? (dd<0?`venció ${fmtDia(fecha)}`:fmtDia(fecha)) : '—'
    const resp = p.responsable || miInicial || 'CL'
    return (
      <div key={p.id} onClick={()=>abrir(p)} style={{ display:'flex', alignItems:'flex-start', gap:13, background:'#fff', border:`1px solid ${openId===p.id?C.accent:C.border}`, borderRadius:11, padding:'13px 16px', marginBottom:8, cursor:'pointer' }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:dc, flexShrink:0, marginTop:6 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:C.accent, letterSpacing:'-.01em', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.nombre_proyecto}</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{cnm(p.cliente_id)||'—'}</div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:600, color:C.muted, border:`1px solid ${C.border}`, borderRadius:7, padding:'3px 9px', marginTop:9, maxWidth:'100%', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{etapaNm}</div>
          <div style={{ display:'flex', alignItems:'center', gap:7, marginTop:8, fontSize:12.5, fontWeight:600, color:tc }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}>{stepIcon(cap)}</svg><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cap} · {due}</span></div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:11, flexShrink:0, marginTop:2 }}>{perAv(resp,24)}<span style={{ color:C.textSoft, fontSize:15 }}><Gl n='chevron'/></span></div>
      </div>
    )
  }

  // WORKSPACE del proyecto — página completa con subpáginas (Resumen/Plan/Calendario/Tareas/Equipo/Bitácora). Reusa helpers/handlers; sin barras ni rentabilidad.
  const renderWorkspace = (p) => {
    const terminado = p.activo===false
    const _et = etapasDe(p)
    const hs = hitosDe(p); const hsPend = hs.filter(h=>!h.hecho).length; const hsDone = hs.length - hsPend
    const avancePct = hs.length ? Math.round((hsDone/hs.length)*100) : null   // avance = PASOS hechos / total
    const nextPaso = hs.filter(h=>!h.hecho).sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))[0]
    const proxPlazo = nextPaso?.plazo || p.plazo || null
    const dP = cartDiasPlazo(proxPlazo)
    const tks = tareasDe(p)
    const venceTk = tks.map(t=>daysLeft(t.due)).filter(d=>d!=null).sort((a,b)=>a-b)[0]
    const ents = entregablesDe(p); const entsDone = ents.filter(e=>e.hecho).length
    const eq = equipoDe(p)
    const bit = bitacoraDe(p)
    const cl = clients.find(c=>String(c.id)===String(p.cliente_id))
    const tm = TIPO_META[tipoDe(p)]||TIPO_META.proyecto
    const inp = { fontSize:12, padding:'4px 7px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', color:C.text }
    const card = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 14px', marginBottom:12 }
    const secHd = t => <div style={{...SEC_LBL,marginBottom:8}}>{t}</div>
    const TABS = [['resumen','Resumen'],['plan','Plan'],['calendario','Calendario'],['tareas','Tareas'],['equipo','Equipo'],['bitacora','Bitácora']]
    const _pasosOrd = () => hs.slice().sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))
    const descargarCrono = () => {
      const rows=[['Tipo','Detalle','Plazo','Fecha real','Estado']]
      _pasosOrd().forEach(h=>{ rows.push(['Paso',h.titulo,h.plazo||'',h.fecha||'',h.hecho?'Hecho':'Pendiente']); ents.filter(e=>String(e.hito_id||'')===String(h.id)).forEach(e=>rows.push(['· etapa',e.texto,'','',e.hecho?'Hecha':'Pendiente'])) })
      tks.forEach(t=>rows.push(['Tarea',t.title||'',t.due||'','',t.status||'Abierta']))
      const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
      const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`cronograma_${(p.nombre_proyecto||'proyecto').replace(/[^\w]+/g,'_')}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500)
    }
    // Carta Gantt descargable (imprimible → PDF): un paso por fila, con PLANIFICADO (plazo, rombo contorno) vs REAL (fecha hecha, rombo verde) sobre un eje de meses. Para reunión/cliente. (Barras/marcadores van en el PDF, no en la UI — regla "no barras" es para pantalla.)
    const descargarGantt = () => {
      const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      const pasos=_pasosOrd()
      const hoy=new Date().toISOString().slice(0,10)
      const allF=[hoy]; pasos.forEach(h=>{ if(h.plazo) allF.push(String(h.plazo).slice(0,10)); if(h.fecha) allF.push(String(h.fecha).slice(0,10)) })
      const minF=allF.reduce((a,b)=>a<b?a:b), maxF=allF.reduce((a,b)=>a>b?a:b)
      const d0=new Date(minF+'T12:00'), d1=new Date(maxF+'T12:00')
      const months=[]; { const c=new Date(d0.getFullYear(),d0.getMonth(),1); const end=new Date(d1.getFullYear(),d1.getMonth(),1); while(c<=end){ months.push(new Date(c)); c.setMonth(c.getMonth()+1) } }
      const span=Math.max(1,(d1-d0)); const pos=f=>{ const d=new Date(String(f).slice(0,10)+'T12:00'); return Math.max(0,Math.min(100,((d-d0)/span)*100)) }
      const monthCols=months.map(m=>`<div style="flex:1;border-left:1px solid #E4E8EB;padding:3px 4px;font-size:9px;color:#537281;text-transform:uppercase">${mesCorto(m)} ${String(m.getFullYear()).slice(2)}</div>`).join('')
      const hoyPos=pos(hoy)
      const filas = pasos.length? pasos.map((h,i)=>{ const plan=h.plazo?pos(h.plazo):null, real=h.fecha?pos(h.fecha):null
        const metaTxt = [h.plazo?`plazo ${String(h.plazo).slice(0,10)}`:null, h.fecha?`hecho ${String(h.fecha).slice(0,10)}`:null].filter(Boolean).join(' · ')
        return `<div style="display:flex;align-items:center;border-top:1px solid #EEF1F3">
        <div style="width:250px;flex-shrink:0;padding:7px 10px;font-size:11px;color:#3D3D3D">${i+1}. ${esc(h.titulo)}${metaTxt?` <span style="color:#99ABB4;font-size:9px">· ${esc(metaTxt)}</span>`:''}</div>
        <div style="flex:1;position:relative;height:26px;border-left:1px solid #E4E8EB">
          <div style="position:absolute;left:${hoyPos}%;top:0;bottom:0;width:1px;background:#99ABB4"></div>
          ${plan!=null?`<div title="plazo" style="position:absolute;left:${plan}%;top:50%;width:11px;height:11px;border:1.5px solid #003C50;background:#fff;transform:translate(-50%,-50%) rotate(45deg)"></div>`:''}
          ${real!=null?`<div title="hecho" style="position:absolute;left:${real}%;top:50%;width:11px;height:11px;background:#1D9E75;transform:translate(-50%,-50%) rotate(45deg)"></div>`:''}
        </div></div>`}).join('') : '<div style="padding:12px;color:#99ABB4;font-size:11px">Aún sin pasos en el plan.</div>'
      const done=pasos.filter(h=>h.hecho).length
      const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Carta Gantt — ${esc(p.nombre_proyecto||'Proyecto')}</title><style>@media print{.no-print{display:none}}body{margin:0;font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;background:#fff}</style></head><body><div style="max-width:940px;margin:0 auto;padding:22px 26px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #003C50;padding-bottom:10px;margin-bottom:14px">
          <div><div style="font-size:16px;font-weight:800;color:#003C50">${esc(p.nombre_proyecto||'Proyecto')}</div><div style="font-size:11px;color:#537281;margin-top:2px">${esc(cnm(p.cliente_id)||'')} · Carta Gantt · ${done} de ${pasos.length} pasos</div></div>
          <div style="font-size:10px;color:#537281;text-align:right">${esc(BRAND?.nombre||'')}<br>${esc(hoy)}</div>
        </div>
        <div style="border:1px solid #E4E8EB;border-radius:8px;overflow:hidden">
          <div style="display:flex;background:#F5F7F9"><div style="width:250px;flex-shrink:0;padding:3px 10px;font-size:9px;color:#537281;text-transform:uppercase">Paso</div>${monthCols}</div>
          ${filas}
        </div>
        <div style="margin-top:10px;font-size:9.5px;color:#537281">◇ plazo planificado · ◆ realizado en verde · línea gris = hoy. Fechas reales registradas en el proyecto.</div>
        <button class="no-print" onclick="window.print()" style="margin-top:16px;background:#003C50;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-weight:600;cursor:pointer">Imprimir / Guardar PDF</button>
      </div></body></html>`
      const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() }
    }
    // Métrica compacta (icono + valor + calificador), sin cajas con tinte
    const mTile = (icon,label,val,qual,qcol) => (
      <div style={{ padding:'10px 12px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, color:C.muted, marginBottom:5 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{icon}</svg><span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:.3 }}>{label}</span></div>
        <div style={{ fontSize:16, fontWeight:700, color:C.text, letterSpacing:'-.01em' }}>{val}</div>
        {qual&&<div style={{ fontSize:10.5, fontWeight:600, color:qcol||C.muted, marginTop:1 }}>{qual}</div>}
      </div>
    )
    const I_CAL=<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>
    const I_CHECK=<><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>
    const I_DOC=<><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/></>
    const I_FLAG=<><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></>
    return (
      <div style={{ maxWidth:isDesktop?880:720, margin:'0 auto', padding:'0 14px 48px' }}>
        {/* HEADER */}
        <div style={{ padding:'14px 0 10px' }}>
          <button onClick={()=>setOpenId(null)} style={{ background:'none', border:'none', color:C.muted, fontSize:12.5, fontWeight:600, cursor:'pointer', padding:0, marginBottom:9 }}><Gl n='chevL'/> Mis proyectos</button>
          <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
            <span style={{ width:9, height:9, borderRadius:'50%', background:CART_DOT[p.estado||'verde'], flexShrink:0, marginTop:7 }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:19, fontWeight:700, color:C.accent, letterSpacing:'-.01em' }}>{p.nombre_proyecto||'Proyecto'}</span>
                <span onClick={()=>{ const nx=_TIPO_ORDEN[(_TIPO_ORDEN.indexOf(tipoDe(p))+1)%_TIPO_ORDEN.length]; onSetTipo&&onSetTipo(p.id,nx) }} title='Tipo de encargo — toca para cambiar' style={{ fontSize:9.5, fontWeight:700, color:tm.c, background:tm.bg, borderRadius:20, padding:'2px 9px', cursor:'pointer' }}>{tm.l}</span>
                {p.pausado&&<span style={{ fontSize:9.5, fontWeight:700, color:C.grisText, background:C.bgWarm, borderRadius:20, padding:'2px 8px' ,whiteSpace:'nowrap'}}>En pausa</span>}
                {terminado&&<span style={{ fontSize:9.5, fontWeight:700, color:C.textSoft, background:C.bgSoft, borderRadius:20, padding:'2px 8px' ,whiteSpace:'nowrap'}}>Terminado</span>}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:9, marginTop:4, flexWrap:'wrap' }}>
                <span onClick={()=>onOpenClientFicha&&onOpenClientFicha(p.cliente_id)} style={{ fontSize:13, fontWeight:600, color:C.muted, cursor:'pointer' }}>{cnm(p.cliente_id)||'—'} <Gl n='chevron'/></span>
                <span style={{ color:C.border }}>·</span>
                <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:C.muted }}>{perAv(p.responsable||'—',20)}{NOMBRE_DE_INI[p.responsable]||p.responsable||'Sin responsable'}</span>
              </div>
            </div>
          </div>
        </div>
        {/* RAIL de subpáginas */}
        <div style={{ display:'flex', gap:4, overflowX:'auto', borderBottom:`1px solid ${C.border}`, marginBottom:14 }}>
          {TABS.map(([k,l])=>{ const on=wsTab===k; return <button key={k} onClick={()=>setWsTab(k)} style={{ fontSize:13, fontWeight:on?700:600, color:on?C.accent:C.muted, background:'none', border:'none', borderBottom:`2px solid ${on?C.accent:'transparent'}`, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap', marginBottom:-1 }}>{l}</button> })}
        </div>

        {/* RESUMEN */}
        {wsTab==='resumen' && <>
          <div style={{ ...card, padding:0, overflow:'hidden' }}>
            <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderBottom:`1px solid ${C.border}` }}>
              <div style={{ flexShrink:0 }}>
                {avancePct!=null ? <><div style={{ fontSize:30, fontWeight:800, color:C.accent, letterSpacing:'-.02em', lineHeight:1 }}>{avancePct}%</div><div style={{ fontSize:10, fontWeight:600, color:C.muted, marginTop:2 }}>avance</div></> : <><div style={{ fontSize:17, fontWeight:700, color:C.muted, lineHeight:1.1 }}>Sin plan</div><div style={{ fontSize:10, fontWeight:600, color:C.muted, marginTop:2 }}>ármalo en Plan</div></>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13.5, fontWeight:700, color:C.text }}>{hs.length ? (nextPaso?`Siguiente: ${nextPaso.titulo}`:'Plan al día') : 'Aún sin pasos — ármalo en la pestaña Plan'}</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:3, lineHeight:1.4 }}>{resumenDe(p)}</div>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:isDesktop?'repeat(4,1fr)':'repeat(2,1fr)' }}>
              {[0,1,2,3].map(i=><div key={i} style={{ borderRight:(isDesktop?(i<3):(i%2===0))?`1px solid ${C.border}`:'none', borderTop:(!isDesktop&&i>1)?`1px solid ${C.border}`:'none' }}>
                {i===0&&mTile(I_CAL,'Próximo plazo', proxPlazo?fmtDia(proxPlazo):'—', proxPlazo?(dP<0?`vencido ${-dP}d`:dP===0?'hoy':`en ${dP} días`):'sin plazo', dP==null?C.muted:dP<0?C.overdueText:dP<=7?C.soonText:C.muted)}
                {i===1&&mTile(I_CHECK,'Tareas', tks.length, venceTk!=null?(venceTk<0?'1 vencida':`próxima en ${venceTk}d`):'al día', venceTk!=null&&venceTk<0?C.overdueText:C.muted)}
                {i===2&&mTile(I_FLAG,'Pasos', hs.length?`${hsDone}/${hs.length}`:'—', hs.length?(hsPend?`${hsPend} por hacer`:'todos hechos'):'sin plan', C.muted)}
                {i===3&&mTile(I_DOC,'Sub-etapas', ents.length?`${entsDone}/${ents.length}`:'—', ents.length?`${ents.length-entsDone} por cerrar`:'—', C.muted)}
              </div>)}
            </div>
          </div>
          {/* OLA 2 — MAPA DEL PROYECTO: el flujo de pasos como diagrama liviano (hecho verde · actual anillo · pendiente contorno). Mapa mental de un vistazo; toca para ir al Plan. (Dots, NO barras.) */}
          {hs.length>0 && (()=>{
            const pasosOrd=_pasosOrd(); const fz=faseDe(p)
            const nextId=pasosOrd.filter(h=>!h.hecho)[0]?.id
            const nodes=[]; pasosOrd.forEach((h,i)=>{ if(i>0) nodes.push(<div key={'c'+h.id} style={{ flex:'1 1 10px', minWidth:10, height:2, background:pasosOrd[i-1].hecho?C.greenText:C.border }}/>)
              const isNext=h.id===nextId; const col=h.hecho?C.greenText:isNext?C.accent:C.border
              nodes.push(<div key={h.id} title={h.titulo} style={{ width:isNext?15:11, height:isNext?15:11, borderRadius:'50%', flexShrink:0, background:h.hecho?C.greenText:'#fff', border:`2px solid ${col}`, boxShadow:isNext?`0 0 0 3px ${C.azulBg}`:'none' }}/>) })
            const dProx = proxPlazo?cartDiasPlazo(proxPlazo):null
            return <div onClick={()=>setWsTab('plan')} style={{ ...card, cursor:'pointer' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:11 }}>{secHd('Mapa del proyecto')}<span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, color:C.muted }}>{fz.l}</span></div>
              <div style={{ display:'flex', alignItems:'center', padding:'0 3px' }}>{nodes}</div>
              <div style={{ fontSize:12.5, color:C.text, marginTop:11, fontWeight:600 }}>{nextPaso?`Próximo: ${nextPaso.titulo}`:'Todos los pasos hechos'}{nextPaso&&proxPlazo?<span style={{ color:dProx==null?C.muted:dProx<0?C.overdueText:dProx<=7?C.soonText:C.muted, fontWeight:700 }}>{` · ${dProx<0?`vencido ${-dProx}d`:dProx===0?'hoy':`en ${dProx} días`}`}</span>:''}</div>
            </div>
          })()}
          {/* OLA 3 — AUTO-CONFIRMADO: pasos que el Agente marcó SOLO (patrón ya aprendido ≥2 veces). Avisado y reversible. */}
          {(()=>{ const mios=autoHechos.filter(x=>String(x.pid)===String(p.id)); if(!mios.length) return null
            return <div style={{ background:C.greenBg, border:`1px solid ${C.greenText}33`, borderRadius:12, padding:'11px 13px', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.greenText} strokeWidth="2.5"><path d="M4 12l5 5L20 6"/></svg><span style={{ fontSize:10, fontWeight:700, color:C.greenText, textTransform:'uppercase', letterSpacing:.3 }}>Confirmado automáticamente</span></div>
              {mios.map((x,i)=>(
                <div key={x.evKey} style={{ display:'flex', alignItems:'center', gap:10, borderTop:i?`1px solid ${C.greenText}22`:'none', padding:'7px 0 2px' }}>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:12.5, color:C.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.titulo}</div><div style={{ fontSize:10.5, color:C.muted }}>evidencia inequívoca · patrón aprendido</div></div>
                  <span onClick={()=>deshacerAuto(x)} style={{ fontSize:11.5, fontWeight:600, color:C.muted, cursor:'pointer', flexShrink:0 }}>Deshacer</span>
                </div>
              ))}
            </div>
          })()}
          {/* AGENTE PMO · se refleja solo — gastos de trámite del cliente → hito, con compuerta (bloque 2) */}
          {(()=>{
            const base=[...tramiteSugDe(p), ...docSugDe(p), ...correoSugDe(p), ...fondoSugDe(p), ...calSugDe(p), ...(iaSug[p.id]||[])]
            const seen=new Set(); const sug=base.filter(s=>{ if(seen.has(s.hitoId)) return false; seen.add(s.hitoId); return true })
            const dd=docsProy[String(p.id)]; const files=(dd&&dd.files)||[]
            const yaNombre=new Set(docSugDe(p).map(s=>String(s.origenId)))
            const candPDF=files.filter(f=>_legible(f) && !yaNombre.has(String(f.id))).length
            const cc=correosProy[String(p.id)]; const candMail=((cc&&cc.msgs)||[]).filter(m=>!correoSugDe(p).some(s=>String(s.origenId)===String(m.id))).length
            const puedeIA = esAdmin && (candPDF>0||candMail>0) && hitosDe(p).some(h=>!h.hecho)
            if(!sug.length && !puedeIA) return null
            const iaDone = iaSug[p.id]!==undefined
            return <div style={{ background:'#F7F4FC', border:'1px solid #E3DAF2', borderRadius:12, padding:'11px 13px', marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:sug.length?8:0 }}><span style={{ fontSize:10, fontWeight:700, color:'#5B3E8E', textTransform:'uppercase', letterSpacing:.3 }}>Antecedentes del plan</span>{sug.length>0&&<span style={{ marginLeft:'auto', fontSize:9.5, fontWeight:700, color:'#5B3E8E', background:'#EFEAF7', borderRadius:20, padding:'2px 8px' ,whiteSpace:'nowrap'}}>{sug.length} por confirmar</span>}</div>
              {sug.map((s,i)=>(
                <div key={s.source+'_'+s.origenId} style={{ borderTop:i?`1px solid #E3DAF2`:'none', padding:'8px 0 2px' }}>
                  <div style={{ fontSize:12.5, color:C.text, fontWeight:600 }}>{s.source==='documento'?'Un documento':s.source==='correo'?'Un correo':s.source==='fondo'?'Un cobro':s.source==='calendario'?'Una cita':'Un trámite'} confirma «{s.hitoTitulo}»{s.fecha?` · ${fmtDia(s.fecha)}`:''}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:1 }}><span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:.3, color:'#5B3E8E', background:'#EFEAF7', borderRadius:20, padding:'1px 6px', flexShrink:0 }}>{s.source==='documento'?'Drive':s.source==='correo'?'Correo':s.source==='fondo'?'Cobro':s.source==='calendario'?'Agenda':'Gasto'}</span><span style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.label}</span></div>
                  <div style={{ display:'flex', gap:12, marginTop:6, alignItems:'center' }}>
                    <button onClick={()=>onAplicarEvidencia&&onAplicarEvidencia(p,s)} style={{ fontSize:11.5, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>Marcar hecho</button>
                    <span onClick={()=>onDescartarEvidencia&&onDescartarEvidencia(p,s)} style={{ fontSize:11.5, fontWeight:600, color:C.muted, cursor:'pointer' }}>No corresponde</span>
                  </div>
                </div>
              ))}
              {puedeIA&&<div style={{ marginTop:sug.length?10:0, display:'flex', alignItems:'center', gap:10 }}>
                <button onClick={()=>revisarDocsIA(p)} disabled={!!iaBusy[p.id]} style={{ fontSize:11.5, fontWeight:600, color:'#5B3E8E', background:'#EFEAF7', border:'none', borderRadius:8, padding:'6px 12px', cursor:iaBusy[p.id]?'default':'pointer' }}>{iaBusy[p.id]?'Leyendo con IA…':'Revisar documentos y correos con IA'}</button>
                {iaDone&&!iaBusy[p.id]&&(iaSug[p.id]||[]).length===0&&<span style={{ fontSize:11, color:C.muted }}>Sin evidencia nueva en el contenido.</span>}
              </div>}
            </div>
          })()}
          {/* ÚLTIMO CONTACTO (Gmail del usuario; admin) */}
          {esAdmin&&(()=>{ const uc=ultCont[String(p.cliente_id)]; if(!uc) return null
            if(uc.loading) return <div style={{ fontSize:11, color:C.grisText, marginBottom:12 }}>Buscando el último correo…</div>
            if(uc.err) return uc.err==='sinpermiso' ? <div style={{ fontSize:11, color:C.grisText, marginBottom:12 }}>Conecta Google (cierra sesión y reingresa) para ver el último correo.</div> : null
            if(uc.none) return <div style={{ fontSize:11, color:C.grisText, marginBottom:12 }}>Sin correos con este cliente{uc.noEmail?' · falta su correo en la ficha':''}.</div>
            const dd=_dias(uc.fecha); const hace = dd==null?'' : dd<=0?'hoy' : dd===1?'ayer' : `hace ${dd} d`; const linkable = uc.threadId&&uc.threadId!=='demo'
            return <div onClick={()=>linkable&&window.open('https://mail.google.com/mail/u/0/#all/'+uc.threadId,'_blank')} style={{ display:'flex', alignItems:'center', gap:9, ...card, cursor:linkable?'pointer':'default' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:uc.dir==='out'?C.azulInfo:C.greenText, flexShrink:0 }}/>
              <div style={{ flex:1, minWidth:0 }}><div style={{...SEC_LBL}}>Último contacto · {uc.dir==='out'?'enviado':'recibido'}</div><div style={{ fontSize:12.5, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{uc.asunto}</div></div>
              <div style={{ textAlign:'right', flexShrink:0 }}><div style={{ fontSize:11, fontWeight:700, color:dd!=null&&dd>45?C.coralText:C.accent }}>{hace}</div>{linkable&&<div style={{ fontSize:10, color:C.azulInfo }}>ver en Gmail <Gl n='chevron'/></div>}</div>
            </div>
          })()}
          {/* SIGUIENTE PASO · IA (compuerta) */}
          {(()=>{ const sp=sigPaso[p.id]; return (
            <div style={{ marginBottom:12 }}>
              {!sp && <button onClick={()=>sugerirSiguientePaso(p)} style={{ fontSize:11.5, fontWeight:600, color:'#5B3E8E', background:'#EFEAF7', border:'none', borderRadius:8, padding:'8px 13px', cursor:'pointer' }}>Sugerir siguiente paso · IA</button>}
              {sp?.busy && <div style={{ fontSize:11, color:C.grisText }}>Analizando el estado del proyecto…</div>}
              {sp?.err && <div style={{ fontSize:11, color:C.coralText }}>No se pudo sugerir. <span onClick={()=>sugerirSiguientePaso(p)} style={{ color:C.azulInfo, cursor:'pointer', fontWeight:600 }}>Reintentar</span></div>}
              {sp && sp.texto!=null && <div style={{ background:'#F7F4FC', border:'1px solid #E3DAF2', borderRadius:12, padding:'11px 13px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}><span style={{ fontSize:10, fontWeight:700, color:'#5B3E8E', textTransform:'uppercase', letterSpacing:.3 }}>Siguiente paso</span>{sp.aldia&&<span style={{ fontSize:9.5, fontWeight:700, color:C.greenText, background:C.greenBg, borderRadius:20, padding:'2px 8px' ,whiteSpace:'nowrap'}}>Al día</span>}{sp.fecha&&<span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, color:C.accent }}>{fmtDia(sp.fecha)}</span>}</div>
                <div style={{ fontSize:12.5, color:C.text, lineHeight:1.45 }}>{sp.texto}</div>
                <div style={{ display:'flex', gap:14, marginTop:8, alignItems:'center' }}>
                  {!sp.aldia && onAddTaskForProject && <button onClick={()=>{ onAddTaskForProject(p,{title:sp.texto,due:sp.fecha||null}); setSigPaso(o=>({...o,[p.id]:undefined})) }} style={{ fontSize:11.5, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>Crear tarea</button>}
                  <span onClick={()=>setSigPaso(o=>({...o,[p.id]:undefined}))} style={{ fontSize:11.5, fontWeight:600, color:C.muted, cursor:'pointer' }}>Descartar</span>
                </div>
              </div>}
            </div>
          )})()}
        </>}

        {/* PLAN — tablero de PASOS tipo carta Gantt: plazo (planificado) + fecha real + sub-etapas; arrastrar para reordenar, marcar hecho, agregar/quitar. */}
        {wsTab==='plan' && (()=>{
          const pasos = hitosDe(p).slice().sort((a,b)=> ((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)) || String(a.titulo||'').localeCompare(String(b.titulo||'')))
          const subsDe = hid => ents.filter(e=>String(e.hito_id||'')===String(hid)).sort((a,b)=>((a.orden||0)-(b.orden||0)))
          const reorder = (from,to) => { if(from===to||from==null) return; const ids=pasos.map(x=>x.id); const [m]=ids.splice(from,1); ids.splice(to,0,m); onReorderHitos&&onReorderHitos(ids) }
          // Selector de operación (siembra el plan desde la biblioteca) — para proyectos sin plan o para sumar otra operación.
          const opSelect = (label) => (pmoOps&&pmoOps.length)
            ? <select value='' onChange={e=>{ const op=(pmoOps||[]).find(o=>String(o.id)===e.target.value); if(op){ onSeedPlan&&onSeedPlan(p.id,op) } e.target.value='' }} style={{ ...inp, maxWidth:220 }}>
                <option value=''>{label}</option>{(pmoOps||[]).map(o=><option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            : null
          if(!pasos.length) return <div style={{ ...card, textAlign:'center' }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:4 }}>Arma el plan del proyecto</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:12, lineHeight:1.45 }}>Elige el tipo de operación y se cargan sus pasos; los editas, mueves y marcas hechos. O lee la propuesta y el plan nace de ella.</div>
            <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap' }}>{opSelect('Elegir operación…')}{esAdmin&&<button onClick={()=>setAlcanceFor(p)} style={{ fontSize:12, fontWeight:600, color:C.azulInfo, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer' }}>Leer la propuesta</button>}<button onClick={()=>onAddHito&&onAddHito(p.id,'Nuevo paso')} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer' }}>+ Paso suelto</button></div>
          </div>
          const done = pasos.filter(h=>h.hecho).length
          // Fila de paso reutilizable (modo plano y agrupado por fase). i = índice GLOBAL en `pasos` (para reordenar). canReorder: solo en modo plano.
          const pasoRow = (h,i,canReorder) => { const dd=h.plazo?cartDiasPlazo(h.plazo):null; const subs=subsDe(h.id); const open=!!subAbierto[h.id]
            // OLA 4 — tareas que cuelgan de este paso (match por título). tAll = todas (abiertas+cerradas) para saber si ya se completaron todas → proponer avanzar el plan.
            const _mt = t => t && !t.archived && t.title && _docConfirma(t.title, h.titulo) && ((String(t.project_id||'')===String(p.id)) || (!t.project_id && p.cliente_id && String(t.client_id||'')===String(p.cliente_id)))
            const tAll = (tasks||[]).filter(_mt); const tareasPaso = tAll.filter(t=>t.status!=='Terminado')
            const tareasListas = !h.hecho && tAll.length>0 && tareasPaso.length===0   // todas las tareas del paso cerradas → compuerta para marcarlo hecho
            const plazoCol = h.hecho?C.muted:(dd!=null&&dd<0?C.overdueText:dd!=null&&dd<=7?C.soonText:C.muted); const dnd=canReorder
            const asa = dnd ? arrPaso.props({pid:p.id,i,reorder}, h.titulo||'Paso') : null
            const esteArr = arrPaso.arrastrando && String(arrPaso.arrastrando.pid)===String(p.id) && dragPaso===i
            const sobreAqui = dnd && arrPaso.arrastrando && arrPaso.sobre===`${p.id}:${i}` && !esteArr
            return <div key={h.id} data-soltar={dnd?`${p.id}:${i}`:undefined} data-soltar-grupo={dnd?'paso':undefined}
                  style={{ borderTop:sobreAqui?`2px solid ${C.accent}`:(i?`1px solid ${C.bgSoft||'#F1EFE8'}`:'none'), padding:'9px 0', opacity:esteArr?.5:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                    {dnd && <span onPointerDown={asa.onPointerDown} title='Arrastra para reordenar' style={{ ...asa.style, cursor:'grab', color:C.textSoft, fontSize:isDesktop?13:17, lineHeight:1, padding:isDesktop?0:'4px 2px' }}>⠿</span>}
                    <span onClick={()=>onToggleHito&&onToggleHito(h.id,!h.hecho)} style={{ width:18, height:18, borderRadius:6, border:`1.5px solid ${h.hecho?C.greenText:C.done}`, background:h.hecho?C.greenText:'transparent', flexShrink:0, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>{h.hecho&&<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M4 12l5 5L20 6"/></svg>}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <input defaultValue={h.titulo} onBlur={e=>{ const v=e.target.value.trim(); if(v&&v!==h.titulo) onUpdHito&&onUpdHito(h.id,{titulo:v}) }} style={{ width:'100%', boxSizing:'border-box', fontSize:13, fontWeight:600, color:h.hecho?C.muted:C.text, textDecoration:h.hecho?'line-through':'none', border:'none', background:'none', padding:'1px 2px' }}/>
                      <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:3, flexWrap:'wrap', paddingLeft:2 }}>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10.5, color:plazoCol }}>plazo<input type='date' value={h.plazo||''} onChange={e=>onUpdHito&&onUpdHito(h.id,{plazo:e.target.value||null})} style={{ fontSize:10.5, padding:'1px 4px', borderRadius:6, border:`1px solid ${C.border}`, background:'#fff', color:C.text }}/>{h.plazo&&!h.hecho&&dd!=null&&<span style={{ fontWeight:700 }}>{dd<0?`vencido ${-dd}d`:dd===0?'hoy':`en ${dd}d`}</span>}</span>
                        {h.hecho&&<span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10.5, color:C.greenText, fontWeight:600 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12l5 5L20 6"/></svg>{h.fecha?fmtDia(h.fecha):'hecho'}</span>}
                        <span onClick={()=>setSubAbierto(o=>({...o,[h.id]:!open}))} style={{ fontSize:10.5, fontWeight:600, color:C.azulInfo, cursor:'pointer' }}>{subs.length?`${subs.filter(s=>s.hecho).length}/${subs.length} etapas`:'+ etapas'}{subs.length?(open?<>{" "}<Gl n='chevD'/></>:<>{" "}<Gl n='chevron'/></>):''}</span>
                        {onAddTaskForProject && <span onClick={()=>onAddTaskForProject(p,{title:h.titulo})} title='Crear una tarea para este paso' style={{ fontSize:10.5, fontWeight:600, color:C.azulInfo, cursor:'pointer' }}>+ tarea</span>}
                      </div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}>
                      {canReorder && !isDesktop && <><span onClick={()=>reorder(i,i-1)} style={{ cursor:i>0?'pointer':'default', color:i>0?C.done:C.border, fontSize:10, lineHeight:1 }}><Gl n='chevU'/></span><span onClick={()=>reorder(i,i+1)} style={{ cursor:i<pasos.length-1?'pointer':'default', color:i<pasos.length-1?C.done:C.border, fontSize:10, lineHeight:1 }}><Gl n='chevD'/></span></>}
                    </div>
                    <span onClick={()=>onDelHito&&onDelHito(h.id)} title='Quitar paso' style={{ color:C.grisText, cursor:'pointer', fontSize:15, flexShrink:0, lineHeight:1 }}><Gl n='x'/></span>
                  </div>
                  {(open||!subs.length&&false)&&subs.length>0&&<div style={{ paddingLeft:38, marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
                    {subs.map(e=>(
                      <div key={e.id} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span onClick={()=>onToggleEntregable&&onToggleEntregable(e.id,!e.hecho)} style={{ width:14, height:14, borderRadius:4, border:`1.5px solid ${e.hecho?C.greenText:C.done}`, background:e.hecho?C.greenText:'transparent', flexShrink:0, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>{e.hecho&&<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M4 12l5 5L20 6"/></svg>}</span>
                        <span style={{ flex:1, fontSize:11.5, color:e.hecho?C.muted:C.text, textDecoration:e.hecho?'line-through':'none' }}>{e.texto}</span>
                        <span onClick={()=>onDelEntregable&&onDelEntregable(e.id)} title='Quitar' style={{ color:C.grisText, cursor:'pointer', fontSize:13, flexShrink:0, lineHeight:1 }}><Gl n='x'/></span>
                      </div>
                    ))}
                    <input placeholder='+ etapa…' onKeyDown={ev=>{ if(ev.key==='Enter'&&ev.target.value.trim()){ onAddEntregable&&onAddEntregable(p.id,ev.target.value,null,h.id); ev.target.value='' } }} style={{ fontSize:11, padding:'4px 7px', borderRadius:6, border:`1px solid ${C.border}`, background:'#fff', marginTop:2 }}/>
                  </div>}
                  {open&&!subs.length&&<div style={{ paddingLeft:38, marginTop:6 }}><input placeholder='+ etapa…' onKeyDown={ev=>{ if(ev.key==='Enter'&&ev.target.value.trim()){ onAddEntregable&&onAddEntregable(p.id,ev.target.value,null,h.id); ev.target.value='' } }} style={{ fontSize:11, padding:'4px 7px', borderRadius:6, border:`1px solid ${C.border}`, background:'#fff' }}/></div>}
                  {tareasPaso.length>0 && <div style={{ paddingLeft:38, marginTop:6, display:'flex', flexDirection:'column', gap:4 }}>
                    {tareasPaso.map(t=>{ const td=daysLeft(t.due); return (
                      <div key={t.id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                        <span onClick={()=>onCompleteTask&&onCompleteTask(t)} title='Marcar tarea terminada' style={{ width:13, height:13, borderRadius:4, border:`1.5px solid ${C.azulInfo}`, flexShrink:0, cursor:'pointer' }}/>
                        <span onClick={()=>onPreviewTask&&onPreviewTask(t)} style={{ flex:1, minWidth:0, fontSize:11.5, color:C.text, cursor:'pointer', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</span>
                        <span style={{ fontSize:9.5, fontWeight:600, color:td==null?C.muted:td<0?C.overdueText:td<=2?C.soonText:C.muted, flexShrink:0 }}>{t.due?(td<0?`vencida ${-td}d`:td===0?'hoy':`en ${td}d`):'tarea'}</span>
                      </div> )})}
                  </div>}
                  {tareasListas && <div style={{ paddingLeft:38, marginTop:5 }}><span onClick={()=>onToggleHito&&onToggleHito(h.id,true)} style={{ fontSize:11, fontWeight:600, color:C.greenText, cursor:'pointer' }}>Tareas listas · marcar hecho <Gl n='chevron'/></span></div>}
                </div> }
          // OLA 2 — Fases colapsables (proyectos largos, ≥8 pasos): agrupa por fase en orden de aparición. Reordenar queda en el modo plano.
          const puedeAgrupar = pasos.length>=8; const agr = puedeAgrupar && faseAgr
          const faseGroups=[]; if(agr){ const idx={}; pasos.forEach((h,gi)=>{ const f=faseDePaso(h.titulo); if(!idx[f.k]){ idx[f.k]={f,items:[]}; faseGroups.push(idx[f.k]) } idx[f.k].items.push({h,gi}) }) }
          return <>
            <div style={{ ...card }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, flexWrap:'wrap' }}>{secHd('Plan de pasos')}<span style={{ fontSize:10, fontWeight:700, color:C.muted }}>{done}/{pasos.length}</span><span style={{ marginLeft:'auto', display:'flex', gap:12, alignItems:'center' }}>{puedeAgrupar&&<span onClick={()=>setFaseAgr(v=>!v)} title='Agrupar en fases colapsables' style={{ fontSize:11, fontWeight:600, color:agr?C.accent:C.muted, cursor:'pointer' }}>Por fase{agr?<>{" "}<Gl n='tick'/></>:''}</span>}<span onClick={descargarGantt} style={{ fontSize:11, fontWeight:600, color:C.azulInfo, cursor:'pointer' }}>Carta Gantt</span><span onClick={descargarCrono} style={{ fontSize:11, fontWeight:600, color:C.azulInfo, cursor:'pointer' }}>CSV</span></span></div>
              {!agr && pasos.map((h,i)=>pasoRow(h,i,true))}
              {agr && faseGroups.map((g,gIdx)=>{ const gdone=g.items.filter(x=>x.h.hecho).length; const full=gdone===g.items.length; const colapsada=faseCol[g.f.k]!=null?faseCol[g.f.k]:full
                return <div key={g.f.k} style={{ borderTop:gIdx?`1px solid ${C.border}`:'none' }}>
                  <div onClick={()=>setFaseCol(o=>({...o,[g.f.k]:!colapsada}))} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 0 4px', cursor:'pointer' }}>
                    <span style={{ fontSize:10, color:C.muted, width:10 }}>{colapsada?<Gl n='chevron'/>:<Gl n='chevD'/>}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:C.accent, textTransform:'uppercase', letterSpacing:.3 }}>{g.f.l}</span>
                    <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:full?C.greenText:C.muted }}>{gdone}/{g.items.length}</span>
                  </div>
                  {!colapsada && g.items.map(({h,gi})=>pasoRow(h,gi,false))}
                </div> })}
              <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:12, flexWrap:'wrap', borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
                <button onClick={()=>onAddHito&&onAddHito(p.id,'Nuevo paso')} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>+ Paso</button>
                {opSelect('+ Sumar operación…')}
              </div>
            </div>
          </>
        })()}

        {/* CALENDARIO */}
        {wsTab==='calendario' && (()=>{
          const items=[]
          hs.forEach(h=>{ if(!h.hecho&&h.fecha) items.push({ fecha:String(h.fecha).slice(0,10), texto:h.titulo, kind:'Hito' }) })
          tks.forEach(t=>{ if(t.due) items.push({ fecha:String(t.due).slice(0,10), texto:t.title||'Tarea', kind:'Tarea', t }) })
          if(p.plazo) items.push({ fecha:String(p.plazo).slice(0,10), texto:p.plazo_label||'Plazo del proyecto', kind:'Plazo' })
          // OLA 4 — plazos legales del cliente (su propio título) + citas de agenda futuras (el título del evento). Integra lo legal y lo agendado, sin inventar.
          ;(plazosAll||[]).forEach(pl=>{ if(String(pl.client_id)!==String(p.cliente_id)||!pl.fecha||pl.estado==='cumplido') return; items.push({ fecha:String(pl.fecha).slice(0,10), texto:pl.titulo||'Plazo', kind:'Plazo' }) })
          const hoyCal=new Date().toISOString().slice(0,10); const cc=calProy[String(p.id)]
          ;((cc&&cc.eventos)||[]).forEach(ev=>{ const f=String(ev.fecha||'').slice(0,10); if(!f||f<hoyCal) return; items.push({ fecha:f, texto:ev.summary||'Cita', kind:'Agenda' }) })
          items.sort((a,b)=>a.fecha.localeCompare(b.fecha))
          if(!items.length) return <div style={{ ...card, fontSize:12, color:C.muted, textAlign:'center' }}>Sin fechas en este proyecto. Agrega hitos o plazos de tareas y aparecerán aquí.</div>
          const KIND={ Tarea:{c:C.azulInfo,bg:C.azulBg}, Hito:{c:C.accent,bg:C.azulBg}, Plazo:{c:C.overdueText,bg:C.overdueBg}, Agenda:{c:C.azulInfo,bg:C.azulBg} }
          return <div style={{ ...card, padding:0, overflow:'hidden' }}>
            {items.map((it,i)=>{ const dd=cartDiasPlazo(it.fecha); const k=KIND[it.kind]||KIND.Tarea; const dc=dd==null?C.muted:dd<0?C.overdue:dd<=7?'#E09B2D':C.greenText
              return <div key={i} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 14px', borderTop:i?`1px solid ${C.border}`:'none' }}>
                <div style={{ textAlign:'center', minWidth:40, flexShrink:0 }}><div style={{ fontSize:15, fontWeight:700, color:dc, lineHeight:1 }}>{new Date(it.fecha+'T12:00').getDate()}</div><div style={{ fontSize:9, color:C.muted, textTransform:'uppercase' }}>{mesCorto(it.fecha+'T12:00')}</div></div>
                <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.texto}</div><div style={{ fontSize:10.5, fontWeight:600, color:dc }}>{dd==null?'':dd<0?`vencido ${-dd}d`:dd===0?'hoy':`en ${dd} días`}</div></div>
                <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:.3, color:k.c, background:k.bg, borderRadius:20, padding:'2px 8px', flexShrink:0 }}>{it.kind}</span>
              </div>
            })}
          </div>
        })()}

        {/* TAREAS */}
        {wsTab==='tareas' && <div style={card}>
          {secHd(`Tareas · ${tks.length}`)}
          {tks.length===0 && <div style={{ fontSize:12, color:C.grisText, marginBottom:8 }}>Sin tareas abiertas.</div>}
          {tks.map((t,ti)=>{ const d=daysLeft(t.due); const col=d==null?C.muted:d<0?C.overdueText:d<=2?C.soonText:C.muted; return (
            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 0', borderTop:ti?`1px solid ${C.bgSoft||'#F1EFE8'}`:'none' }}>
              <span onClick={()=>onCompleteTask&&onCompleteTask(t)} title='Marcar terminada' style={{ width:17, height:17, borderRadius:6, border:`1.5px solid ${C.done}`, flexShrink:0, cursor:'pointer' }}/>
              <div onClick={()=>onPreviewTask&&onPreviewTask(t)} style={{ flex:1, minWidth:0, cursor:'pointer' }}><div style={{ fontSize:12.5, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.title}</div><div style={{ fontSize:10, color:col }}>{t.due?(d<0?`vencida ${-d}d`:d===0?'vence hoy':`en ${d}d`):'sin plazo'}{t.who?` · ${INICIALES_RESP[t.who]||t.who}`:''}</div></div>
            </div>
          )})}
          {onAddTaskForProject&&<div style={{ textAlign:'right', paddingTop:8 }}><span onClick={()=>onAddTaskForProject(p)} style={{ fontSize:12, fontWeight:600, color:C.accent, cursor:'pointer' }}>+ Nueva tarea</span></div>}
        </div>}

        {/* EQUIPO */}
        {wsTab==='equipo' && <>
          <div style={card}>
            <div style={{ display:'flex', alignItems:'center', marginBottom:eq.length?6:4 }}>{secHd('Equipo')}{esAdmin&&<span onClick={()=>setAddMiemOpen(o=>!o)} style={{ marginLeft:'auto', fontSize:10.5, fontWeight:700, color:C.azulInfo, cursor:'pointer' }}>{addMiemOpen?'Cerrar':'+ Integrante'}</span>}</div>
            {eq.map(e=>(
              <div key={e.miembro} style={{ display:'flex', alignItems:'center', gap:9, padding:'5px 0' }}>
                {perAv(e.miembro,22)}
                <span style={{ flex:1, fontSize:12.5, color:C.text }}>{NOMBRE_DE_INI[e.miembro]||e.miembro}</span>
                <span style={{ fontSize:10, fontWeight:700, color:C.muted, background:C.bgSoft, border:`1px solid ${C.border}`, borderRadius:20, padding:'1px 8px' }}>{ROL_LBL[e.rol]||e.rol}</span>
                {esAdmin&&e.rol!=='responsable'&&<span onClick={()=>onDelMiembro&&onDelMiembro(p.id,e.miembro)} title='Quitar del equipo' style={{ color:C.grisText, cursor:'pointer', fontSize:15, flexShrink:0, lineHeight:1 }}><Gl n='x'/></span>}
              </div>
            ))}
            {esAdmin&&(()=>{ const desde=new Date(Date.now()-183*864e5).toISOString().slice(0,10)
              const sug=Object.entries(NOMBRE_DE_INI).filter(([i])=>!eq.some(e=>e.miembro===i)&&!sugEqNo.has(`${p.id}:${i}`)).map(([i,n])=>({i,n,
                nT:(tasks||[]).filter(t=>p.cliente_id&&String(t.client_id)===String(p.cliente_id)&&taskAssignees(t).includes(n)&&String(t.created_at||t.due||'').slice(0,10)>=desde).length,
                nG:(expenses||[]).filter(e=>p.cliente_id&&!e.deleted_at&&String(e.client_id)===String(p.cliente_id)&&e.created_by===n&&String(e.date||'')>=desde).length})).filter(x=>x.nT+x.nG>=2)
              return sug.map(x=><div key={'s'+x.i} style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 0', borderTop:`1px solid ${C.bgSoft}` }}>
                {perAv(x.i,22)}
                <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:12.5, fontWeight:600, color:C.text }}>{x.n} · sugerido</div><div style={{ fontSize:10.5, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{[x.nT?`${x.nT} tarea${x.nT!==1?'s':''}`:null,x.nG?`${x.nG} gasto${x.nG!==1?'s':''}`:null].filter(Boolean).join(' y ')} en este cliente{isDesktop?' (6 meses)':''}</div></div>
                <span onClick={()=>onAddMiembro&&onAddMiembro(p.id,x.i,'apoyo')} style={{ fontSize:11, fontWeight:700, color:'#fff', background:C.accent, borderRadius:20, padding:'4px 11px', cursor:'pointer', whiteSpace:'nowrap' }}>Agregar</span>
                <span onClick={()=>{ setSugEqNo(s=>new Set([...s,`${p.id}:${x.i}`])); if(!DEMO) setLearningKV('equipo_sug_no',`${p.id}:${x.i}`,'1').catch(()=>{}) }} style={{ fontSize:11, fontWeight:600, color:C.muted, cursor:'pointer' }}>No</span>
              </div>) })()}
            {addMiemOpen&&esAdmin&&<div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:7 }}>{Object.keys(NOMBRE_DE_INI).filter(i=>!eq.some(e=>e.miembro===i)).map(i=><button key={i} onClick={()=>{ onAddMiembro&&onAddMiembro(p.id,i,'apoyo'); setAddMiemOpen(false) }} style={{ fontSize:11, fontWeight:700, color:C.accent, background:C.azulBg, border:'none', borderRadius:20, padding:'4px 11px', cursor:'pointer' }}>+ {i}</button>)}</div>}
          </div>
          <div style={card}>
            {secHd('Cliente')}
            <div onClick={()=>onOpenClientFicha&&onOpenClientFicha(p.cliente_id)} style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer' }}>
              <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, fontWeight:600, color:C.accent }}>{cnm(p.cliente_id)||'—'}</div>{cl?.email&&<div style={{ fontSize:11, color:C.muted }}>{cl.email}</div>}</div>
              <span style={{ color:C.textSoft, fontSize:15 }}><Gl n='chevron'/></span>
            </div>
            {cl?.email&&<div style={{ marginTop:8 }}><a href={`mailto:${cl.email}`} style={{ fontSize:12, fontWeight:600, color:C.azulInfo, textDecoration:'none' }}>Escribir correo <Gl n='chevron'/></a></div>}
          </div>
        </>}

        {/* BITÁCORA */}
        {wsTab==='bitacora' && <div style={card}>
          {secHd('Qué pasó')}
          <input value={notaDraft} onChange={e=>setNotaDraft(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') agregarNota(p) }} placeholder='Agregar una nota a la bitácora…' style={{ width:'100%', boxSizing:'border-box', fontSize:12, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', marginBottom:12 }}/>
          {bit.length===0 ? <div style={{ fontSize:11, color:C.grisText }}>Sin movimientos aún.</div> : (()=>{ const full=!!bitFull[p.id]; const vis=full?bit:bit.slice(0,8)
            return <><div style={{ position:'relative', paddingLeft:18 }}>
              <div style={{ position:'absolute', left:5, top:4, bottom:6, width:2, background:C.border }}/>
              {vis.map((e,ei)=>{ const dd=_dias(e.iso); const cu=dd==null?'':dd<=0?'hoy':dd===1?'ayer':`hace ${dd} d`; const clickable=!!e.ref; const titulo=e.tipo==='nota'?'Nota':(e.count>1?`${e.texto} · ${e.count}`:e.texto); return (
                <div key={ei} onClick={clickable?()=>clickEvento(e):undefined} style={{ position:'relative', paddingBottom:10, cursor:clickable?'pointer':'default', display:'flex', gap:8, alignItems:'flex-start' }}>
                  <span style={{ position:'absolute', left:-17, top:3, width:11, height:11, borderRadius:'50%', border:'2px solid #fff', background:SEÑAL_COL[e.tipo]||C.muted }}/>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:clickable?C.accent:C.text, fontWeight:600 }}>{titulo}</div>{e.tipo==='nota'&&<div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{e.texto}</div>}{e.autor&&<div style={{ fontSize:10, color:C.textSoft, marginTop:1 }}>{e.autor}</div>}</div>
                  <div style={{ textAlign:'right', flexShrink:0 }}><div style={{ fontSize:11, fontWeight:600, color:C.muted, whiteSpace:'nowrap' }}>{fmtDia(e.iso)}</div><div style={{ fontSize:9, color:C.textSoft, whiteSpace:'nowrap' }}>{cu}</div></div>
                </div>
              )})}
            </div>
            {bit.length>8&&<div onClick={()=>setBitFull(o=>({...o,[p.id]:!full}))} style={{ fontSize:11, fontWeight:600, color:C.azulInfo, cursor:'pointer', paddingLeft:18, marginTop:2 }}>{full?'Ver menos':`Ver toda la bitácora (${bit.length}) →`}</div>}
            </>
          })()}
        </div>}

        {/* ACCIONES */}
        <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'center', borderTop:`1px solid ${C.border}`, paddingTop:12, marginTop:4 }}>
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(p.cliente_id)} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:'none', cursor:'pointer', padding:0 }}>Ver ficha</button>
          {p.sale_id&&onOpenSale&&(()=>{ const v=sales.find(s=>String(s.id)===String(p.sale_id)); return v?<button onClick={()=>onOpenSale(v)} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:'none', cursor:'pointer', padding:0 }}>Ver venta</button>:null })()}
          {cl?.drive_folder_id&&<button onClick={()=>window.open('https://drive.google.com/drive/folders/'+cl.drive_folder_id,'_blank')} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:'none', cursor:'pointer', padding:0 }}>Carpeta en Drive</button>}
          {!terminado&&<button onClick={()=>togglePausa(p)} style={{ fontSize:12, fontWeight:600, color:C.muted, background:'none', border:'none', cursor:'pointer', padding:0, marginLeft:'auto' }}>{p.pausado?'Reanudar':'Pausar'}</button>}
          <button onClick={()=>{ terminado?reponer(p):archivar(p); setOpenId(null) }} style={{ fontSize:12, fontWeight:600, color:C.muted, background:'none', border:'none', cursor:'pointer', padding:0, marginLeft:terminado?'auto':0 }}>{terminado?'Reponer':'Terminar'}</button>
        </div>
      </div>
    )
  }

  // EDITOR de la biblioteca de pasos (pmo_operaciones) — página; se guarda en la tabla configurable (vendible: cada estudio arma la suya).
  const renderBiblioteca = () => {
    const ops = (pmoOps||[]).slice().sort((a,b)=>((a.orden||0)-(b.orden||0)))
    const op = ops.find(o=>String(o.id)===String(bibSel)) || ops[0] || null
    const inp = { fontSize:12, padding:'4px 7px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', color:C.text }
    const card = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 14px', marginBottom:12 }
    const pasos = op?.pasos || []
    const setPasos = (np) => onSaveOperacion && onSaveOperacion({ ...op, pasos:np })
    const upd = (i,patch) => setPasos(pasos.map((s,k)=>k===i?{...s,...patch}:s))
    const mover = (from,to) => { if(to<0||to>=pasos.length) return; const a=pasos.slice(); const [m]=a.splice(from,1); a.splice(to,0,m); setPasos(a) }
    const crearOp = async () => { if(!onSaveOperacion) return; const nueva=await onSaveOperacion({ id:'new_'+Date.now(), nombre:'Nueva operación', hint:'', pasos:[], orden:(ops.length+1) }); if(nueva?.id) setBibSel(nueva.id) }
    return (
      <div style={{ maxWidth:isDesktop?780:720, margin:'0 auto', padding:'0 14px 48px' }}>
        <div style={{ padding:'14px 0 10px' }}>
          <button onClick={()=>setBibOpen(false)} style={{ background:'none', border:'none', color:C.muted, fontSize:12.5, fontWeight:600, cursor:'pointer', padding:0, marginBottom:9 }}><Gl n='chevL'/> Mis proyectos</button>
          <div style={{ fontSize:19, fontWeight:700, color:C.accent, letterSpacing:'-.01em' }}>Biblioteca de pasos</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>El paso a paso y la duración de cada operación; arma el plan y sus plazos.</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
          <select value={op?op.id:''} onChange={e=>setBibSel(e.target.value)} style={{ ...inp, flex:1, minWidth:0, fontSize:13, padding:'9px 11px' }}>{ops.map(o=><option key={o.id} value={o.id}>{o.nombre} · {(o.pasos||[]).length} pasos</option>)}</select>
          <button onClick={crearOp} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer' }}>+ Operación</button>
        </div>
        {!op ? <div style={{ ...card, fontSize:12, color:C.muted, textAlign:'center' }}>No hay operaciones aún. Crea la primera.</div> : <>
          <div style={card}>
            <input defaultValue={op.nombre} key={'n'+op.id} onBlur={e=>{ const v=e.target.value.trim(); if(v&&v!==op.nombre) onSaveOperacion&&onSaveOperacion({...op,nombre:v}) }} style={{ width:'100%', boxSizing:'border-box', fontSize:16, fontWeight:700, color:C.accent, border:'none', background:'none', padding:'2px 2px' }}/>
            <input defaultValue={op.hint||''} key={'h'+op.id} onBlur={e=>{ if(e.target.value!==(op.hint||'')) onSaveOperacion&&onSaveOperacion({...op,hint:e.target.value}) }} placeholder='Descripción corta (opcional)' style={{ width:'100%', boxSizing:'border-box', fontSize:12, color:C.muted, border:'none', background:'none', padding:'3px 2px', marginTop:2 }}/>
          </div>
          <div style={card}>
            <div style={{ display:'flex', alignItems:'center', marginBottom:8 }}>{secHdBib('Pasos')}<span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, color:C.muted }}>{pasos.length}</span></div>
            {pasos.map((s,i)=>(
              <div key={i} style={{ borderTop:i?`1px solid ${C.bgSoft||'#F1EFE8'}`:'none', padding:'9px 0' }}>
                <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                  <span style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, background:s.m?C.accent:C.bgSoft, color:s.m?'#fff':C.muted, border:s.m?'none':`1px solid ${C.border}` }}>{i+1}</span>
                  <input defaultValue={s.t} key={op.id+'_'+i+'_'+s.t} onBlur={e=>{ const v=e.target.value.trim(); if(v&&v!==s.t) upd(i,{t:v}) }} style={{ flex:1, minWidth:0, fontSize:13, fontWeight:600, color:C.text, border:'none', background:'none', padding:'1px 2px' }}/>
                  <span style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}><input type='number' min='1' defaultValue={s.dias||''} key={op.id+'_'+i+'_d'+(s.dias||'')} onBlur={e=>{ const v=parseInt(e.target.value,10); const nv=v>0?v:null; if(nv!==(s.dias||null)) upd(i,{dias:nv}) }} placeholder='–' title='Días que suele tomar este paso. Define el plazo estimado del plan.' style={{ width:36, fontSize:11, color:C.muted, textAlign:'center', border:`1px solid ${C.border}`, borderRadius:6, background:'#fff', padding:'2px 2px' }}/><span style={{ fontSize:9.5, color:C.grisText }}>d</span></span>
                  <span onClick={()=>upd(i,{m:!s.m})} title='Marca si un trámite (CBR/D.Oficial/Notaría) confirma este paso' style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:.3, color:s.m?'#fff':C.muted, background:s.m?C.accent:C.bgSoft, border:`1px solid ${s.m?C.accent:C.border}`, borderRadius:20, padding:'2px 7px', cursor:'pointer', flexShrink:0 }}>hito</span>
                  <div style={{ display:'flex', flexDirection:'column', gap:2, flexShrink:0 }}><span onClick={()=>mover(i,i-1)} style={{ cursor:i>0?'pointer':'default', color:i>0?C.done:C.border, fontSize:10, lineHeight:1 }}><Gl n='chevU'/></span><span onClick={()=>mover(i,i+1)} style={{ cursor:i<pasos.length-1?'pointer':'default', color:i<pasos.length-1?C.done:C.border, fontSize:10, lineHeight:1 }}><Gl n='chevD'/></span></div>
                  <span onClick={()=>setPasos(pasos.filter((_,k)=>k!==i))} title='Quitar paso' style={{ color:C.grisText, cursor:'pointer', fontSize:15, flexShrink:0, lineHeight:1 }}><Gl n='x'/></span>
                </div>
                <div style={{ paddingLeft:29, marginTop:5, display:'flex', flexDirection:'column', gap:4 }}>
                  {(s.subs||[]).map((sub,j)=>(
                    <div key={j} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <span style={{ width:4, height:4, borderRadius:'50%', background:C.faint||C.done, flexShrink:0 }}/>
                      <input defaultValue={sub} key={op.id+'_'+i+'_s'+j+'_'+sub} onBlur={e=>{ const v=e.target.value; if(v!==sub) upd(i,{subs:(s.subs||[]).map((x,k)=>k===j?v:x)}) }} style={{ flex:1, minWidth:0, fontSize:11.5, color:C.text, border:'none', borderBottom:`1px solid transparent`, background:'none', padding:'1px 1px' }}/>
                      <span onClick={()=>upd(i,{subs:(s.subs||[]).filter((_,k)=>k!==j)})} title='Quitar' style={{ color:C.grisText, cursor:'pointer', fontSize:13, flexShrink:0, lineHeight:1 }}><Gl n='x'/></span>
                    </div>
                  ))}
                  <input placeholder='+ sub-etapa…' onKeyDown={e=>{ if(e.key==='Enter'&&e.target.value.trim()){ upd(i,{subs:[...(s.subs||[]),e.target.value.trim()]}); e.target.value='' } }} style={{ fontSize:11, padding:'3px 6px', borderRadius:6, border:`1px solid ${C.border}`, background:'#fff', marginTop:2 }}/>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:12, borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
              <button onClick={()=>setPasos([...pasos,{t:'Nuevo paso',m:false,subs:[]}])} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>+ Paso</button>
              <button onClick={()=>{ if(onDelOperacion){ onDelOperacion(op.id); setBibSel(null) } }} style={{ fontSize:12, fontWeight:600, color:C.coralText, background:'none', border:'none', cursor:'pointer', padding:0, marginLeft:'auto' }}>Eliminar operación</button>
            </div>
          </div>
          {/* OLA 3 — la biblioteca MEJORA desde el uso: pasos que ≥2 proyectos de esta operación agregaron fuera de la plantilla → proponer sumarlos. */}
          {(()=>{
            const nt = s => _normTxt(s)
            const plantillaSet = new Set((pasos||[]).map(s=>nt(s.t)))
            const proyectosOp = (proyectos||[]).concat(archivados||[]).filter(pr=>String(pmoProyOp[String(pr.id)]||'')===String(op.id))
            if(proyectosOp.length<2) return null
            const extra={}, pretty={}
            proyectosOp.forEach(pr=>{ const seen=new Set(); hitosDe(pr).forEach(h=>{ const k=nt(h.titulo); if(!k||plantillaSet.has(k)||seen.has(k)) return; seen.add(k); extra[k]=(extra[k]||0)+1; if(!pretty[k]) pretty[k]=h.titulo }) })
            const sug = Object.entries(extra).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(([k,n])=>({k,n,t:pretty[k]}))
            if(!sug.length) return null
            return <div style={{ ...card, border:`1px solid #E3DAF2`, background:'#F7F4FC' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'#5B3E8E', textTransform:'uppercase', letterSpacing:.3, marginBottom:3 }}>Sugerencias desde el uso</div>
              <div style={{ fontSize:11.5, color:C.muted, marginBottom:9 }}>Pasos que varios proyectos agregaron fuera de la plantilla.</div>
              {sug.map((s,i)=>(
                <div key={s.k} style={{ display:'flex', alignItems:'center', gap:10, borderTop:i?`1px solid #E3DAF2`:'none', padding:'8px 0 2px' }}>
                  <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:12.5, color:C.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.t}</div><div style={{ fontSize:10.5, color:C.muted }}>en {s.n} proyectos</div></div>
                  <button onClick={()=>setPasos([...pasos,{t:s.t,m:false,subs:[]}])} style={{ fontSize:11.5, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:'6px 12px', cursor:'pointer', flexShrink:0 }}>Agregar a la plantilla</button>
                </div>
              ))}
            </div>
          })()}
        </>}
        {/* OLA 3 #4 — Agente proactivo cross-cartera (Drive, server-side). Apagado por defecto; Probar simula sin escribir. Admin. */}
        {esAdmin && <div style={{ ...card, marginTop:4 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:C.accent }}>Antecedentes de la cartera · Drive</div>
              <div style={{ fontSize:11, color:C.muted, marginTop:2, lineHeight:1.4 }}>A diario revisa los documentos de Drive de la cartera y deja la evidencia por confirmar. No marca pasos solo.</div>
            </div>
            <span style={{ fontSize:9.5, fontWeight:700, color:crossCfg==='on'?C.greenText:C.grisText, background:crossCfg==='on'?C.greenBg:C.bgSoft, borderRadius:20, padding:'2px 8px', flexShrink:0 ,whiteSpace:'nowrap'}}>{crossCfg==='on'?'Encendido':'Apagado'}</span>
          </div>
          <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:10, flexWrap:'wrap' }}>
            <button onClick={probarCross} disabled={crossBusy} style={{ fontSize:11.5, fontWeight:600, color:C.azulInfo, background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 12px', cursor:crossBusy?'default':'pointer' }}>{crossBusy?'Simulando…':'Probar'}</button>
            <button onClick={toggleCross} style={{ fontSize:11.5, fontWeight:600, color:'#fff', background:crossCfg==='on'?C.coralText:C.accent, border:'none', borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>{crossCfg==='on'?'Apagar':'Encender'}</button>
            {crossRes&&<span style={{ fontSize:11, color:crossRes.error?C.coralText:C.muted }}>{crossRes.error?('Error: '+crossRes.error):`Simulación: ${crossRes.documento||0} ${(crossRes.documento||0)===1?'documento':'documentos'} por confirmar · ${crossRes.cross_cartera||''}`}</span>}
          </div>
        </div>}
      </div>
    )
  }
  const secHdBib = t => <span style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:.3 }}>{t}</span>

  // MI FOCO — una pantalla cross-proyecto: qué vence, tu siguiente paso por proyecto (el mapa) y lo detenido. Para dejar de revisar uno por uno.
  // OLA 2 — Carta Gantt del PORTAFOLIO (descargable → PDF): una fila por proyecto sobre un mismo eje de meses.
  // Reusa la lógica del Gantt por proyecto (eje de meses + rombos plazo/real + línea hoy), pero cross-proyecto:
  // se ve de un vistazo cuáles se solapan y cuáles vienen. Barras/spans van en el PDF, no en la UI (regla "no barras").
  const descargarGanttPortafolio = () => {
    const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const hoy=new Date().toISOString().slice(0,10)
    const filtro = selPer&&selPer!=='all'?(NOMBRE_DE_INI[selPer]||selPer):'Toda la oficina'
    const items = (proyectos||[]).filter(p=>p.activo!==false && !p.pausado && ((selPer&&selPer!=='all')?esDePersona(p,selPer):true))
      .map(p=>{ const hs=hitosDe(p); const fechas=[]; hs.forEach(h=>{ if(h.plazo) fechas.push(String(h.plazo).slice(0,10)); if(h.fecha) fechas.push(String(h.fecha).slice(0,10)) })
        const done=hs.filter(h=>h.hecho).length; const next=hs.filter(h=>!h.hecho).sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))[0]
        return { p, hs, fechas, done, next } })
      .filter(x=>x.fechas.length)   // solo proyectos con plan datado
    if(!items.length){ appAlert('Aún no hay proyectos con plazos para graficar.'); return }
    const allF=[hoy]; items.forEach(x=>x.fechas.forEach(f=>allF.push(f)))
    const minF=allF.reduce((a,b)=>a<b?a:b), maxF=allF.reduce((a,b)=>a>b?a:b)
    const d0=new Date(minF+'T12:00'), d1=new Date(maxF+'T12:00'); const span=Math.max(1,(d1-d0))
    const pos=f=>Math.max(0,Math.min(100,((new Date(String(f).slice(0,10)+'T12:00')-d0)/span)*100))
    const months=[]; { const c=new Date(d0.getFullYear(),d0.getMonth(),1); const end=new Date(d1.getFullYear(),d1.getMonth(),1); while(c<=end){ months.push(new Date(c)); c.setMonth(c.getMonth()+1) } }
    const monthCols=months.map(m=>`<div style="flex:1;border-left:1px solid #E4E8EB;padding:3px 4px;font-size:9px;color:#537281;text-transform:uppercase">${mesCorto(m)} ${String(m.getFullYear()).slice(2)}</div>`).join('')
    const hoyPos=pos(hoy)
    const filas = items.map(x=>{ const fs=x.fechas.map(pos); const a=Math.min(...fs), b=Math.max(...fs)
      const rombos = x.hs.map(h=>{ const plan=h.plazo?pos(h.plazo):null, real=h.fecha?pos(h.fecha):null
        return (plan!=null?`<div title="plazo: ${esc(h.titulo)}" style="position:absolute;left:${plan}%;top:50%;width:9px;height:9px;border:1.5px solid #003C50;background:#fff;transform:translate(-50%,-50%) rotate(45deg)"></div>`:'')
             + (real!=null?`<div title="hecho: ${esc(h.titulo)}" style="position:absolute;left:${real}%;top:50%;width:9px;height:9px;background:#1D9E75;transform:translate(-50%,-50%) rotate(45deg)"></div>`:'') }).join('')
      const sub = `${x.done}/${x.hs.length}${x.next?` · ${esc(x.next.titulo)}`:''}`
      return `<div style="display:flex;align-items:center;border-top:1px solid #EEF1F3">
        <div style="width:250px;flex-shrink:0;padding:7px 10px"><div style="font-size:11px;font-weight:600;color:#003C50">${esc(cnm(x.p.cliente_id)||x.p.nombre_proyecto||'Proyecto')}</div><div style="font-size:9px;color:#99ABB4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:235px">${sub}</div></div>
        <div style="flex:1;position:relative;height:28px;border-left:1px solid #E4E8EB">
          <div style="position:absolute;left:${hoyPos}%;top:0;bottom:0;width:1px;background:#99ABB4"></div>
          <div style="position:absolute;left:${a}%;width:${Math.max(0,b-a)}%;top:50%;height:2px;background:#E4E8EB;transform:translateY(-50%)"></div>
          ${rombos}
        </div></div>` }).join('')
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Carta Gantt del portafolio</title><style>@media print{.no-print{display:none}}body{margin:0;font-family:'DM Sans',Arial,sans-serif;color:#3D3D3D;background:#fff}</style></head><body><div style="max-width:980px;margin:0 auto;padding:22px 26px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #003C50;padding-bottom:10px;margin-bottom:14px">
        <div><div style="font-size:16px;font-weight:800;color:#003C50">Carta Gantt del portafolio</div><div style="font-size:11px;color:#537281;margin-top:2px">${esc(filtro)} · ${items.length} proyecto${items.length!==1?'s':''}</div></div>
        <div style="font-size:10px;color:#537281;text-align:right">${esc(BRAND?.nombre||'')}<br>${esc(hoy)}</div>
      </div>
      <div style="border:1px solid #E4E8EB;border-radius:8px;overflow:hidden">
        <div style="display:flex;background:#F5F7F9"><div style="width:250px;flex-shrink:0;padding:3px 10px;font-size:9px;color:#537281;text-transform:uppercase">Proyecto</div>${monthCols}</div>
        ${filas}
      </div>
      <div style="margin-top:10px;font-size:9.5px;color:#537281">◇ plazo planificado · ◆ realizado en verde · línea gris = hoy. Un proyecto por fila, mismo eje de tiempo.</div>
      <button class="no-print" onclick="window.print()" style="margin-top:16px;background:#003C50;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-weight:600;cursor:pointer">Imprimir / Guardar PDF</button>
    </div></body></html>`
    const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() }
  }
  // OLA 4 — MÉTRICAS Y EXPORTACIÓN del PMO: cumplimiento de plazos, por operación, dónde se atasca. Del dato al insight, descargable. (Números y tabla, NO barras.)
  const renderMetricas = () => {
    const card = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, marginBottom:12, overflow:'hidden' }
    const secHd = (t,n,col) => <div style={{ display:'flex', alignItems:'center', gap:7, margin:'18px 2px 8px', fontSize:9, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:col||C.muted }}>{t}{n!=null&&<span style={{ color:C.muted }}>· {n}</span>}</div>
    const base = (proyectos||[]).concat(archivados||[]).filter(p=>((selPer&&selPer!=='all')?esDePersona(p,selPer):true))
    const conPlan = base.filter(p=>hitosDe(p).length>0)
    const dif = (fecha,plazo) => Math.round((new Date(fecha+'T00:00')-new Date(plazo+'T00:00'))/86400000)
    let aTiempo=0, tarde=0, pendVenc=0, pendOk=0; const demora={}
    conPlan.forEach(p=>hitosDe(p).forEach(h=>{ if(!h.plazo) return
      if(h.hecho){ if(h.fecha){ const d=dif(String(h.fecha).slice(0,10),String(h.plazo).slice(0,10)); if(d<=0) aTiempo++; else { tarde++; const k=_normTxt(h.titulo); (demora[k]=demora[k]||{sum:0,n:0,t:h.titulo,proys:[]}); demora[k].sum+=d; demora[k].n++; if(!demora[k].proys.some(x=>String(x.id)===String(p.id))) demora[k].proys.push(p) } } }
      else { const dd=cartDiasPlazo(h.plazo); if(dd!=null&&dd<0) pendVenc++; else pendOk++ } }))
    const conFecha = aTiempo+tarde; const cumpl = conFecha?Math.round(aTiempo/conFecha*100):null
    const ops={}
    conPlan.forEach(p=>{ const oid=pmoProyOp[String(p.id)]||'_'; const nombre=(pmoOps||[]).find(o=>String(o.id)===String(oid))?.nombre || 'Sin operación'; const o=(ops[oid]=ops[oid]||{key:oid,nombre,nProy:0,done:0,total:0,aTiempo:0,conFecha:0,proys:[]}); o.nProy++; o.proys.push(p)
      hitosDe(p).forEach(h=>{ o.total++; if(h.hecho){ o.done++; if(h.plazo&&h.fecha){ o.conFecha++; if(dif(String(h.fecha).slice(0,10),String(h.plazo).slice(0,10))<=0) o.aTiempo++ } } }) })
    const opRows = Object.values(ops).filter(o=>o.total).sort((a,b)=>b.nProy-a.nProy)
    const atasco = Object.entries(demora).map(([k,x])=>({k, t:x.t, media:Math.round(x.sum/x.n), n:x.n, proys:x.proys})).sort((a,b)=>b.media-a.media).slice(0,4)
    const avanceDe = p => { const hs=hitosDe(p); return `${hs.filter(h=>h.hecho).length}/${hs.length}` }
    const subFila = p => <div key={'s'+p.id} onClick={()=>{ setMetOpen(false); abrir(p) }} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 14px 8px 26px', borderTop:`1px solid ${C.border}`, background:C.bgSoft||'#F7F9FA', cursor:'pointer' }}>
      <div style={{ flex:1, minWidth:0, fontSize:12, color:C.accent, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cnm(p.cliente_id)||p.nombre_proyecto}</div>
      <div style={{ fontSize:10.5, fontWeight:700, color:C.muted, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>{avanceDe(p)}</div><span style={{ color:C.textSoft, fontSize:13, flexShrink:0 }}><Gl n='chevron'/></span>
    </div>
    const exportar = () => {
      const esc=s=>`"${String(s==null?'':s).replace(/"/g,'""')}"`
      const rows=[['Operación','Proyectos','Pasos hechos','Pasos totales','Pasos con fecha','A tiempo','% a tiempo']]
      opRows.forEach(o=>rows.push([o.nombre,o.nProy,o.done,o.total,o.conFecha,o.aTiempo,o.conFecha?Math.round(o.aTiempo/o.conFecha*100)+'%':'—']))
      rows.push([]); rows.push(['Cumplimiento global',cumpl!=null?cumpl+'%':'—']); rows.push(['Pasos a tiempo',aTiempo]); rows.push(['Pasos tarde',tarde]); rows.push(['Pasos pendientes vencidos',pendVenc])
      const csv='﻿'+rows.map(r=>r.map(esc).join(';')).join('\n')
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='metricas_pmo.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),500)
    }
    const stat = (n,l,col,onClick) => <div onClick={onClick} style={{ flex:1, padding:'10px 8px', textAlign:'center', cursor:onClick?'pointer':'default' }}><div style={{ fontSize:19, fontWeight:800, color:n>0?col:C.muted, letterSpacing:'-.02em' }}>{n}</div><div style={{...SEC_LBL,marginTop:1}}>{l}</div></div>
    return (
      <div style={{ maxWidth:isDesktop?880:720, margin:'0 auto', padding:'0 14px 48px' }}>
        <div style={{ padding:'14px 0 10px' }}>
          <button onClick={()=>setMetOpen(false)} style={{ background:'none', border:'none', color:C.muted, fontSize:12.5, fontWeight:600, cursor:'pointer', padding:0, marginBottom:9 }}><Gl n='chevL'/> Mis proyectos</button>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:19, fontWeight:700, color:C.accent, letterSpacing:'-.01em' }}>Cumplimiento</div>
            {conPlan.length>0 && <span onClick={exportar} style={{ marginLeft:'auto', fontSize:11, fontWeight:600, color:C.azulInfo, cursor:'pointer', border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', whiteSpace:'nowrap' }}>Exportar CSV ↓</span>}
          </div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{selPer&&selPer!=='all'?(NOMBRE_DE_INI[selPer]||selPer):'Toda la oficina'} · {conPlan.length} proyecto{conPlan.length!==1?'s':''} con plan</div>
        </div>
        {!conPlan.length ? <div style={{ ...card, textAlign:'center', fontSize:13, color:C.muted, padding:'32px 16px' }}>Aún no hay proyectos con plan para medir.</div> : <>
          {/* Protagonista: cumplimiento de plazos, con a tiempo / tarde anidados */}
          <div style={card}>
            <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px' }}>
              <div style={{ flexShrink:0 }}><div style={{ fontSize:32, fontWeight:800, color:cumpl==null?C.muted:cumpl>=80?C.greenText:cumpl>=50?'#E09B2D':C.overdueText, letterSpacing:'-.02em', lineHeight:1 }}>{cumpl==null?'—':`${cumpl}%`}</div><div style={{ fontSize:10, fontWeight:600, color:C.muted, marginTop:2 }}>plazos cumplidos</div></div>
              <div style={{ flex:1, minWidth:0, fontSize:12, color:C.muted, lineHeight:1.5 }}>De {conFecha} paso{conFecha!==1?'s':''} completado{conFecha!==1?'s':''} con plazo, <b style={{ color:C.greenText }}>{aTiempo} a tiempo</b> y <b style={{ color:C.overdueText }}>{tarde} tarde</b>.</div>
            </div>
            <div style={{ display:'flex', borderTop:`1px solid ${C.border}` }}>
              {stat(pendVenc,'Pendientes vencidos',C.overdueText,()=>{ setMetOpen(false); setFocoOpen(true) })}<div style={{ width:1, background:C.border }}/>{stat(pendOk,'Pendientes al día',C.muted)}<div style={{ width:1, background:C.border }}/>{stat(conPlan.length,'Con plan',C.accent,()=>setMetOpen(false))}
            </div>
          </div>
          {/* Por operación (tabla de números) */}
          {opRows.length>0 && <>{secHd('Por operación')}<div style={card}>
            <div style={{ display:'flex', alignItems:'center', padding:'8px 14px', borderBottom:`1px solid ${C.border}`, fontSize:9, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:.3 }}>
              <span style={{ width:12, flexShrink:0 }}/><div style={{ flex:1 }}>Operación</div><div style={{ width:54, textAlign:'right' }}>Proy.</div><div style={{ width:66, textAlign:'right' }}>Avance</div><div style={{ width:66, textAlign:'right' }}>A tiempo</div>
            </div>
            {opRows.map((o,i)=>{ const pct=o.conFecha?Math.round(o.aTiempo/o.conFecha*100):null; const ek='op:'+o.key; const open=metExp===ek
              return <div key={i}>
                <div onClick={()=>setMetExp(open?null:ek)} style={{ display:'flex', alignItems:'center', padding:'10px 14px', borderTop:i?`1px solid ${C.border}`:'none', fontSize:12.5, cursor:'pointer' }}>
                  <span style={{ width:12, flexShrink:0, color:C.textSoft, fontSize:10 }}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
                  <div style={{ flex:1, minWidth:0, color:C.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{o.nombre}</div>
                  <div style={{ width:54, textAlign:'right', color:C.muted, fontVariantNumeric:'tabular-nums' }}>{o.nProy}</div>
                  <div style={{ width:66, textAlign:'right', color:C.muted, fontVariantNumeric:'tabular-nums' }}>{o.done}/{o.total}</div>
                  <div style={{ width:66, textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums', color:pct==null?C.muted:pct>=80?C.greenText:pct>=50?'#E09B2D':C.overdueText }}>{pct==null?'—':`${pct}%`}</div>
                </div>
                {open && o.proys.map(subFila)}
              </div> })}
          </div></>}
          {/* Dónde se atasca */}
          {atasco.length>0 && <>{secHd('Dónde se atasca',null,'#E09B2D')}<div style={card}>
            {atasco.map((a,i)=>{ const ek='at:'+a.k; const open=metExp===ek
              return <div key={i}>
                <div onClick={()=>setMetExp(open?null:ek)} style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 14px', borderTop:i?`1px solid ${C.border}`:'none', cursor:'pointer' }}>
                  <span style={{ width:12, flexShrink:0, color:C.textSoft, fontSize:10 }}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
                  <div style={{ flex:1, minWidth:0, fontSize:12.5, color:C.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.t}</div>
                  <div style={{ textAlign:'right', flexShrink:0 }}><div style={{ fontSize:12, fontWeight:700, color:'#E09B2D' }}>+{a.media}d tarde</div><div style={{ fontSize:9.5, color:C.muted }}>{a.n===1?'1 vez':`${a.n} veces`}</div></div>
                </div>
                {open && a.proys.map(subFila)}
              </div> })}
          </div></>}
        </>}
      </div>
    )
  }
  const renderFoco = () => {
    const foco = (proyectos||[]).filter(p=>p.activo!==false && !p.pausado && ((selPer&&selPer!=='all')?esDePersona(p,selPer):true))
    const card = { background:'#fff', border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', marginBottom:12 }
    const secHd = (t,n,col) => <div style={{ display:'flex', alignItems:'center', gap:7, margin:'18px 2px 8px', fontSize:9, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:col||C.muted }}>{t}<span style={{ color:C.muted }}>· {n}</span></div>
    const pend=[]; foco.forEach(p=> hitosDe(p).filter(h=>!h.hecho&&h.plazo).forEach(h=>pend.push({p,h,dd:cartDiasPlazo(h.plazo)})))
    const urgentes = pend.filter(x=>x.dd!=null&&x.dd<=7).sort((a,b)=>a.dd-b.dd)
    const conPlan = foco.filter(p=>hitosDe(p).length>0)
    const sinPlan = foco.filter(p=>hitosDe(p).length===0)
    const nextDe = p => hitosDe(p).filter(h=>!h.hecho).sort((a,b)=>((a.orden==null?1e9:a.orden)-(b.orden==null?1e9:b.orden)))[0]
    const cad = p => cadenciaProyecto(p)   // cadencia adaptativa: frío según el horizonte del proyecto, no un umbral fijo
    const esDetenido = p => cad(p).frio
    // OLA 3 — ANTICIPAR ATRASOS: el plazo viene (0–7d, aún NO vencido) pero el proyecto está frío (sin avance) → se va a atrasar. Avisar antes.
    const riesgo = foco.map(p=>{ const nx=nextDe(p); const dd=nx&&nx.plazo?cartDiasPlazo(nx.plazo):null; const c=cad(p); return {p,nx,dd,inact:c.inact,frio:c.frio} })
      .filter(x=>x.nx&&x.dd!=null&&x.dd>=0&&x.dd<=7&&x.frio).sort((a,b)=>a.dd-b.dd)
    const riesgoIds = new Set(riesgo.map(x=>String(x.p.id)))
    const nVenc = pend.filter(x=>x.dd!=null&&x.dd<0).length, nSem = pend.filter(x=>x.dd!=null&&x.dd>=0&&x.dd<=7).length, nDet = foco.filter(p=>esDetenido(p)&&hitosDe(p).length>0).length   // "sin mover" solo cuenta proyectos CON plan (los que muestran el chip en "Tus proyectos"); los sin plan ya están en su sección
    const filaPaso = (x) => { const dc = x.dd<0?C.overdue:x.dd<=2?'#E09B2D':C.soonText; const tc = x.dd<0?C.overdueText:x.dd<=2?C.soonText:C.greenText
      return <div key={x.p.id+'_'+x.h.id} onClick={()=>abrir(x.p)} style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 14px', borderTop:`1px solid ${C.border}`, cursor:'pointer' }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:dc, flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, color:C.text, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.h.titulo}</div><div style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cnm(x.p.cliente_id)||x.p.nombre_proyecto}</div></div>
        <div style={{ textAlign:'right', flexShrink:0 }}><div style={{ fontSize:11, fontWeight:700, color:tc }}>{x.dd<0?`venció ${-x.dd}d`:x.dd===0?'hoy':`en ${x.dd}d`}</div><div style={{ fontSize:9.5, color:C.muted }}>{fmtDia(x.h.plazo)}</div></div>
        <span style={{ color:C.textSoft, fontSize:14 }}><Gl n='chevron'/></span>
      </div> }
    const filaProy = p => { const hs=hitosDe(p); const done=hs.filter(h=>h.hecho).length; const nx=nextDe(p); const dd=nx&&nx.plazo?cartDiasPlazo(nx.plazo):null; const c=cad(p); const det=c.frio
      const tc = dd!=null&&dd<0?C.overdueText:dd!=null&&dd<=7?C.soonText:C.muted
      return <div key={p.id} onClick={()=>abrir(p)} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 14px', borderTop:`1px solid ${C.border}`, cursor:'pointer' }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:CART_DOT[p.estado||'verde'], flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:C.accent, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cnm(p.cliente_id)||p.nombre_proyecto}</div>
          <div style={{ fontSize:11.5, color:tc, fontWeight:600, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nx?`Siguiente: ${nx.titulo}`:'Plan al día'}{nx&&nx.plazo?` · ${dd<0?`venció ${-dd}d`:dd===0?'hoy':`en ${dd}d`}`:''}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:9, flexShrink:0 }}>{det&&<span title={`Sin movimiento hace ${c.inact}d · se revisa cada ${c.intervalo}d`} style={{ fontSize:9, fontWeight:700, color:C.grisText, background:C.bgWarm, borderRadius:20, padding:'2px 7px', textTransform:'uppercase', letterSpacing:.3 }}>Sin mover · {c.inact}d</span>}<span style={{ fontSize:10.5, fontWeight:700, color:C.muted }}>{done}/{hs.length}</span><span style={{ color:C.textSoft, fontSize:14 }}><Gl n='chevron'/></span></div>
      </div> }
    const filaRiesgo = (x) => (
      <div key={'r'+x.p.id} onClick={()=>abrir(x.p)} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 14px', borderTop:`1px solid ${C.border}`, cursor:'pointer' }}>
        <span style={{ width:8, height:8, borderRadius:'50%', background:'#E09B2D', flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.accent, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cnm(x.p.cliente_id)||x.p.nombre_proyecto}</div>
          <div style={{ fontSize:11.5, color:C.muted, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.nx.titulo} · vence {x.dd===0?'hoy':`en ${x.dd}d`} · sin avance {x.inact}d</div>
        </div>
        <span style={{ color:C.textSoft, fontSize:14, flexShrink:0 }}><Gl n='chevron'/></span>
      </div> )
    return (
      <div style={{ maxWidth:isDesktop?880:720, margin:'0 auto', padding:'0 14px 48px' }}>
        <div style={{ padding:'14px 0 10px' }}>
          <button onClick={()=>setFocoOpen(false)} style={{ background:'none', border:'none', color:C.muted, fontSize:12.5, fontWeight:600, cursor:'pointer', padding:0, marginBottom:9 }}><Gl n='chevL'/> Mis proyectos</button>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:19, fontWeight:700, color:C.accent, letterSpacing:'-.01em' }}>Pendientes</div>
            {conPlan.length>0 && <span onClick={descargarGanttPortafolio} title='Todos los proyectos en un mismo eje de tiempo' style={{ marginLeft:'auto', fontSize:11, fontWeight:600, color:C.azulInfo, cursor:'pointer', border:`1px solid ${C.border}`, borderRadius:8, padding:'4px 10px', whiteSpace:'nowrap' }}>Carta Gantt del portafolio ↓</span>}
          </div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{selPer&&selPer!=='all'?(NOMBRE_DE_INI[selPer]||selPer):'Toda la oficina'} · lo que pide tu acción, de un vistazo</div>
        </div>
        {/* La foto (canon): un protagonista "Por atender" (pasos con plazo), con Vencido/Por vencer anidados; debajo, lo que es de PROYECTOS (sin mover / sin plan). Cada cifra baja a su lista. */}
        {(()=>{ const irA = id => { const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}) }
          const nAtender = urgentes.length
          if(nAtender===0 && riesgo.length===0 && nDet===0 && sinPlan.length===0) return (
            <div style={{ ...card, display:'flex', alignItems:'center', gap:12, padding:'16px 18px' }}>
              <span style={{ width:34, height:34, borderRadius:'50%', background:C.greenBg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><SIcon n='check' s={18} c={C.greenText}/></span>
              <div><div style={{ fontSize:14, fontWeight:700, color:C.accent }}>Todo al día</div><div style={{ fontSize:12, color:C.muted, marginTop:1 }}>Nada vence pronto y cada proyecto tiene su plan.</div></div>
            </div>)
          const heroCol = nVenc>0?C.overdueText:nAtender>0?C.soonText:C.muted
          const tile = (n,lbl,bg,col,id) => <div onClick={e=>{ e.stopPropagation(); irA(id) }} style={{ flex:1, background:n>0?bg:C.bgSoft, borderRadius:10, padding:'8px 11px', cursor:'pointer' }}><div style={{ fontSize:17, fontWeight:800, color:n>0?col:C.muted, lineHeight:1.1 }}>{n}</div><div style={{ fontSize:10, fontWeight:600, color:n>0?col:C.muted, marginTop:1 }}>{lbl}</div></div>
          const mini = (n,lbl,col,id) => <div onClick={()=>irA(id)} style={{ flex:1, padding:'9px 14px', display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}><span style={{ fontSize:15, fontWeight:800, color:n>0?col:C.muted }}>{n}</span><span style={{ fontSize:11, color:C.muted }}>{lbl}</span><span style={{ marginLeft:'auto', color:C.textSoft, fontSize:13 }}><Gl n='chevron'/></span></div>
          return <div style={card}>
            <div onClick={()=>irA(riesgo.length?'foco-riesgo':'foco-pasos')} style={{ display:'flex', alignItems:'center', gap:14, padding:'15px 16px', cursor:'pointer' }}>
              <div style={{ flexShrink:0 }}><div style={{ fontSize:32, fontWeight:800, color:heroCol, lineHeight:1, letterSpacing:'-.02em' }}>{nAtender}</div><div style={{ fontSize:10, fontWeight:600, color:C.muted, marginTop:3 }}>pasos por atender</div></div>
              <div style={{ flex:1, display:'flex', gap:9, minWidth:0 }}>
                {tile(nVenc,'Vencido',C.overdueBg,C.overdueText,'foco-pasos')}
                {tile(nSem,'Por vencer · 7 días',C.soonBg,C.soonText,'foco-pasos')}
              </div>
              <span style={{ color:C.textSoft, fontSize:16, flexShrink:0 }}><Gl n='chevron'/></span>
            </div>
            <div style={{ display:'flex', borderTop:`1px solid ${C.border}` }}>
              {mini(nDet,'proyectos sin mover',C.grisText,'foco-proys')}<div style={{ width:1, background:C.border }}/>{mini(sinPlan.length,'sin plan',C.accent,'foco-sinplan')}
            </div>
          </div>
        })()}
        {riesgo.length>0 && <div id='foco-riesgo'>{secHd('En riesgo de atraso',riesgo.length,'#E09B2D')}<div style={card}>{riesgo.map(filaRiesgo)}</div></div>}
        {(()=>{ const lista = urgentes.filter(x=>!riesgoIds.has(String(x.p.id))); if(!lista.length) return null; const col = lista.some(x=>x.dd<0)?C.overdueText:C.soonText
          return <div id='foco-pasos'>{secHd('Pasos por atender',lista.length,col)}<div style={card}>{lista.map(filaPaso)}</div></div> })()}
        {conPlan.length>0 && <div id='foco-proys'>{secHd('Tus proyectos · siguiente paso',conPlan.length)}<div style={card}>{conPlan.slice().sort((a,b)=>{ const na=nextDe(a),nb=nextDe(b); const da=na&&na.plazo?cartDiasPlazo(na.plazo):9999, db=nb&&nb.plazo?cartDiasPlazo(nb.plazo):9999; const aa=((da<=7)||esDetenido(a))?0:1, ab=((db<=7)||esDetenido(b))?0:1; return aa!==ab?aa-ab:da-db }).map(filaProy)}</div></div>}
        {sinPlan.length>0 && <div id='foco-sinplan'>{secHd('Sin plan — ármalo',sinPlan.length,C.muted)}<div style={card}>{sinPlan.map(p=>(
          <div key={p.id} onClick={()=>abrir(p)} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 14px', borderTop:`1px solid ${C.border}`, cursor:'pointer' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:C.faint||C.done, flexShrink:0 }}/>
            <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:13, fontWeight:600, color:C.accent, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cnm(p.cliente_id)||p.nombre_proyecto}</div><div style={{ fontSize:11, color:C.muted }}>Elige la operación y nace con sus pasos</div></div>
            <span style={{ color:C.textSoft, fontSize:14 }}><Gl n='chevron'/></span>
          </div>
        ))}</div></div>}
        {!foco.length && <div style={{ ...card, textAlign:'center', fontSize:13, color:C.muted, padding:'32px 16px' }}>No hay proyectos activos con este filtro.</div>}
      </div>
    )
  }

  // Overlay compartido: la lectura de la propuesta (Alcance) se dispara desde el Plan (workspace) y desde el landing → se renderiza en ambos.
  const alcanceOverlay = alcanceFor ? <CarteraAlcanceModal proyecto={alcanceFor} client={clients.find(c=>String(c.id)===String(alcanceFor.cliente_id))||null} onClose={()=>setAlcanceFor(null)} onAddHito={onAddHito} onAddEntregable={onAddEntregable} onApplied={(id,campos)=>{ setProyectos(prev=>prev.map(x=>x.id===id?{...x,...campos}:x)); if(openId===id) setDraft(d=>d) }}/> : null
  if(focoOpen) return renderFoco()
  if(metOpen) return renderMetricas()
  if(bibOpen) return renderBiblioteca()
  const wsP = openId ? ((proyectos||[]).find(x=>String(x.id)===String(openId)) || (archivados||[]).find(x=>String(x.id)===String(openId))) : null
  if(wsP) return <>{renderWorkspace(wsP)}{alcanceOverlay}</>

  return (
    <div style={{ maxWidth:isDesktop?1040:720, margin:'0 auto', padding:'0 14px 40px' }}>
      {(()=>{ const btns = <>
          <button onClick={()=>setFocoOpen(true)} title='Pendientes — lo que pide tu acción, de un vistazo' style={{ fontSize:12, fontWeight:700, color:C.accent, background:C.azulBg, border:'none', borderRadius:20, padding:'4px 12px', cursor:'pointer' }}>Pendientes</button>
          {esAdmin&&<button onClick={()=>setMetOpen(true)} title='Cumplimiento: plazos cumplidos, por operación, dónde se atasca' style={{ fontSize:12, fontWeight:600, color:C.muted, background:'none', border:'none', cursor:'pointer', padding:'4px 6px' }}>Cumplimiento</button>}
          <button onClick={()=>setNuevo(v=>!v)} style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.done||'#99ABB4'}`, borderRadius:20, padding:'4px 12px', cursor:'pointer' }}>+ Nuevo</button>
        </>
        const titulo = <><button onClick={onClose} style={{ background:'none', border:'none', color:C.accent, fontSize:20, cursor:'pointer', padding:0 }}><Gl n='chevL'/></button><div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:17, fontWeight:600, color:C.accent }}>Mis proyectos · {rows.length}{nCrit?` · ${nCrit} crítico${nCrit!==1?'s':''}`:''}</div><div style={{ fontSize:10, color:C.muted, fontWeight:500, marginTop:1 }}>seguimiento de proyectos activos</div></div></>
        return isDesktop
          ? <div style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 0 12px' }}>{titulo}{btns}</div>
          : <div style={{ padding:'14px 0 12px' }}><div style={{ display:'flex', alignItems:'center', gap:8 }}>{titulo}</div><div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:10 }}>{btns}</div></div>
      })()}

      {/* Banner "N ventas activas sin proyecto" retirado por instrucción del usuario: el alta de proyectos pasa por "+ Nuevo" (nace de cliente+venta). */}

      {/* "Resumen semanal por correo" retirado del header por instrucción del usuario (no más correos por ahora; se retoma después).
          El motor (semanal/toggleSemanal/enviarPrueba + edge resumen-lunes) queda intacto para reactivarlo cuando se decida. */}

      {esAdmin&&novedades.length>0&&(
        <div style={{ marginBottom:12, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', background:'#fff' }}>
          <div onClick={()=>setNovOpen(o=>!o)} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', cursor:'pointer', background:C.azulBg||'#E6F1FB' }}>
            <span style={{ fontSize:12, fontWeight:600, color:C.azulInfo||C.azulInfo, flex:1 }}>Sugerencias del correo y la agenda · {novedades.length}</span>
            <span style={{ fontSize:12, color:C.azulInfo||C.azulInfo }}>{novOpen?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
          </div>
          {novOpen&&<div style={{ padding:'8px 12px', fontSize:11, color:C.muted, borderTop:`1px solid ${C.border}`, lineHeight:1.5 }}>Leídas de tu Gmail y Calendar. <b style={{color:C.text}}>Aceptar</b> la guarda en el proyecto (o crea uno / fija el plazo); <b style={{color:C.text}}>Descartar</b> la quita. No cambia nada hasta que tú elijas.</div>}
          {novOpen&&novedades.map((n,idx)=>{
            const cli = (n.tipo==='update'||n.tipo==='hito') ? (()=>{ const p=proyectos.find(x=>String(x.id)===String(n.proyecto_id)); return p?cnm(p.cliente_id):'' })() : cnm(n.cliente_id)
            const texto = n.tipo==='hito' ? n.titulo : n.sugerencia
            const tag = n.tipo==='nuevo'?'NUEVO':n.tipo==='hito'?'AGENDA':null
            const btn = n.tipo==='nuevo'?'Crear proyecto':n.tipo==='hito'?'Fijar como hito':'Guardar en el proyecto'
            return (
              <div key={idx} style={{ padding:'10px 12px', borderTop:`1px solid ${C.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  {tag&&<span style={{ fontSize:9.5, fontWeight:700, color:C.azulInfo||C.azulInfo, background:C.azulBg||'#E6F1FB', borderRadius:20, padding:'2px 8px' ,whiteSpace:'nowrap'}}>{tag}</span>}
                  <span style={{ fontSize:13, fontWeight:600, color:C.accent }}>{cli||'Sin cliente'}</span>
                  {n.tipo==='hito'&&n.fecha&&<span style={{ marginLeft:'auto', fontSize:11, fontWeight:700, color:C.accent }}>{fmtDia(n.fecha)}</span>}
                </div>
                <div style={{ fontSize:13, color:C.text, marginBottom:3 }}>{texto}</div>
                {n.fuente&&<div style={{ fontSize:11, color:C.muted, marginBottom:8 }}>{n.fuente}</div>}
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={()=>aceptarNov(n,idx)} style={{ fontSize:12, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:'6px 14px', cursor:'pointer' }}>{btn}</button>
                  <button onClick={()=>cerrarNov(idx)} style={{ fontSize:12, fontWeight:600, color:C.muted, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'6px 12px', cursor:'pointer' }}>Descartar</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {nuevo&&(
        <div style={{ background:C.bgSoft||'#F5F7F9', border:`1px solid ${C.border}`, borderRadius:12, padding:12, marginBottom:12 }}>
          <div style={{ position:'relative', marginBottom:8 }}>
            <input value={clientQ} onChange={e=>{ setClientQ(e.target.value); setNf(f=>({...f,cliente_id:''})) }} placeholder='Buscar cliente…' style={{ width:'100%', boxSizing:'border-box', fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff' }}/>
            {clientQ&&!nf.cliente_id&&(
              <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:5, background:'#fff', border:`1px solid ${C.border}`, borderRadius:8, marginTop:2, maxHeight:180, overflowY:'auto' }}>
                {clients.filter(c=>_normTxt(c.name).includes(_normTxt(clientQ))).slice(0,7).map(c=>(
                  <div key={c.id} onClick={()=>{ setNf(f=>({...f,cliente_id:c.id})); setClientQ(c.name) }} style={{ padding:'8px 10px', fontSize:13, color:C.text, cursor:'pointer', borderBottom:`1px solid ${C.bgSoft||'#F5F7F9'}` }}>{c.name}</div>
                ))}
              </div>
            )}
          </div>
          {/* ¿De qué VENTA de este cliente nace el proyecto? (tú eliges) — o proyecto suelto sin venta */}
          {nf.cliente_id&&(()=>{ const cliSales=(sales||[]).filter(s=>String(s.client_id)===String(nf.cliente_id)&&!s.deleted_at).sort((a,b)=>(a.status==='Activo'?0:1)-(b.status==='Activo'?0:1))
            const hasProj=sid=>(proyectos||[]).some(p=>String(p.sale_id)===String(sid))
            return <div style={{ marginBottom:8 }}>
              <div style={{...SEC_LBL,marginBottom:6}}>¿De qué venta nace?</div>
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {cliSales.map(s=>{ const ya=hasProj(s.id); const on=String(nf.sale_id)===String(s.id); return (
                  <button key={s.id} disabled={ya} onClick={()=>setNf(f=>({...f, sale_id:on?'':String(s.id), nombre:on?f.nombre:(s.title||f.nombre) }))} style={{ display:'flex', alignItems:'center', gap:8, textAlign:'left', background:on?C.azulBg:'#fff', border:`1px solid ${on?C.accent:C.border}`, borderRadius:8, padding:'8px 10px', cursor:ya?'default':'pointer', opacity:ya?.55:1 }}>
                    <span style={{ width:15, height:15, borderRadius:'50%', border:`1.5px solid ${on?C.accent:C.done}`, background:on?C.accent:'transparent', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>{on&&<span style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }}/>}</span>
                    <span style={{ flex:1, minWidth:0 }}><span style={{ fontSize:12.5, fontWeight:600, color:C.text, display:'block', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.title||'Venta sin título'}</span><span style={{ fontSize:10.5, color:C.muted }}>{s.status||''}{s.responsible?` · ${INICIALES_RESP[s.responsible]||s.responsible}`:''}</span></span>
                    {ya&&<span style={{ fontSize:9.5, fontWeight:700, color:C.textSoft, flexShrink:0 }}>ya tiene proyecto</span>}
                  </button>
                )})}
                {cliSales.length===0&&<div style={{ fontSize:11.5, color:C.muted, background:'#fff', border:`1px dashed ${C.border}`, borderRadius:8, padding:'9px 10px' }}>Este cliente no tiene ventas. Crea la venta primero — el proyecto nace de ella.</div>}
              </div>
            </div>
          })()}
          <input value={nf.nombre} onChange={e=>setNf(f=>({...f,nombre:e.target.value}))} placeholder='Nombre del proyecto (por defecto, el de la venta — cámbialo si quieres)' style={{ width:'100%', boxSizing:'border-box', fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', marginBottom:8 }}/>
          <input value={nf.nota} onChange={e=>setNf(f=>({...f,nota:e.target.value}))} placeholder='¿En qué está? (tema abierto)' style={{ width:'100%', boxSizing:'border-box', fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', marginBottom:8 }}/>
          {(pmoOps||[]).length>0&&<div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <select value={nf.operacionId} onChange={e=>setNf(f=>({...f,operacionId:e.target.value}))} title='Nace con los pasos de esta operación' style={{ flex:1, minWidth:0, boxSizing:'border-box', fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', color:C.text }}><option value=''>Plan del asunto — sin plan por ahora</option>{(pmoOps||[]).map(o=><option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
            {esAdmin&&<button onClick={()=>{ setBibSel(nf.operacionId||(pmoOps||[])[0]?.id||null); setBibOpen(true) }} title='Ver y editar el paso a paso de esta operación' style={{ fontSize:12, fontWeight:600, color:C.accent, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 11px', cursor:'pointer', whiteSpace:'nowrap', flexShrink:0 }}>Editar pasos <Gl n='chevron'/></button>}
          </div>}
          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
            <select value={nf.responsable} onChange={e=>setNf(f=>({...f,responsable:e.target.value}))} disabled={!esAdmin} style={{ fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', color:C.text }}>
              {['CL','EE','MC','MP','RD'].map(i=><option key={i} value={i}>{i}</option>)}
            </select>
            <input type='date' value={nf.plazo} onChange={e=>setNf(f=>({...f,plazo:e.target.value}))} style={{ flex:1, fontSize:13, padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', color:C.text }}/>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={crear} style={{ flex:1, fontSize:13, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:9, cursor:'pointer' }}>Crear proyecto</button>
            <button onClick={()=>{ setNuevo(false); setNf(NF0); setClientQ('') }} style={{ fontSize:13, fontWeight:600, color:C.muted, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 14px', cursor:'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {(()=>{ const scope=arr=> (selPer&&selPer!=='all') ? arr.filter(p=>esDePersona(p,selPer)) : arr
        const nCurso=scope((proyectos||[]).filter(p=>p.activo!==false&&!p.pausado)).length
        const nPausa=scope((proyectos||[]).filter(p=>p.activo!==false&&!!p.pausado)).length
        const nTerm=scope(archivados||[]).length
        const tab=(k,l,n)=>(<button key={k} onClick={()=>{setFase(k);setOpenId(null)}} style={{ fontSize:12, fontWeight:600, borderRadius:20, padding:'5px 13px', border:`1px solid ${fase===k?C.accent:C.border}`, background:fase===k?C.accent:'#fff', color:fase===k?'#fff':C.muted, cursor:'pointer', whiteSpace:'nowrap' }}>{l}<span style={{opacity:.65,marginLeft:5}}>{n}</span></button>)
        return <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>{tab('curso','En curso',nCurso)}{tab('pausa','En pausa',nPausa)}{tab('terminados','Terminados',nTerm)}</div>
      })()}

      <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
        {vista!=='semana'&&fase!=='terminados'&&<select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{ fontSize:12, color:C.muted, background:C.track, border:'none', borderRadius:8, padding:'6px 10px', cursor:'pointer' }}>
          <option value='movimiento'>En movimiento</option>
          <option value='sinmover'>Sin mover</option>
          <option value='plazo'>Plazo</option>
          <option value='prioridad'>Prioridad</option>
          <option value='cliente'>Cliente</option>
          <option value='etapa'>Por etapa</option>
        </select>}
        <div style={{ position:'relative' }}>
          <button onClick={()=>setPerOpen(o=>!o)} style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:12.5, fontWeight:600, color:C.text, background:'#fff', border:`1px solid ${C.border}`, borderRadius:9, padding:'5px 9px 5px 6px', cursor:'pointer' }}>
            {selPer==='all' ? <span style={{ padding:'0 2px' }}>Toda la oficina</span> : <>{perAv(selPer,21)}{NOMBRE_DE_INI[selPer]||selPer}</>}
            <span style={{ color:C.az3||C.done, fontSize:11 }}><Gl n='chevD'/></span>
          </button>
          {perOpen && <div style={{ position:'absolute', top:'calc(100% + 5px)', left:0, zIndex:30, background:'#fff', border:`1px solid ${C.border}`, borderRadius:10, boxShadow:'0 8px 26px rgba(8,34,45,.14)', padding:5, minWidth:190 }}>
            <button onClick={()=>{ setSelPer('all'); setPerOpen(false); setOpenId(null) }} style={{ ...perItem, color:C.accent }}>Toda la oficina{selPer==='all'&&<span style={{ marginLeft:'auto', color:C.greenText, fontWeight:800 }}><Gl n='tick'/></span>}</button>
            <div style={{ height:1, background:C.border, margin:'4px 2px' }}/>
            {['CL','EE','MC','MP','RD'].map(i=><button key={i} onClick={()=>{ setSelPer(i); setPerOpen(false); setOpenId(null) }} style={perItem}>{perAv(i)}{NOMBRE_DE_INI[i]||i}{selPer===i&&<span style={{ marginLeft:'auto', color:C.greenText, fontWeight:800 }}><Gl n='tick'/></span>}</button>)}
          </div>}
        </div>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar' style={{ marginLeft:'auto', fontSize:12, padding:'6px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'#fff', width:110 }}/>
      </div>

      {(()=>{
        // LANDING A+ (PMO): Prioritarios (riesgoDe) arriba, luego En curso/En pausa/Terminados. Fila A+; al abrir, detalle inline (reemplazo por página workspace en el próximo paso).
        if(!rows.length) return <div style={{ textAlign:'center', color:C.muted, fontSize:13, padding:'40px 0', border:`1px dashed ${C.border}`, borderRadius:12 }}>{proyectos.length?'Nada con este filtro.':'Aún no hay proyectos. Toca “+ Nuevo” o se irán creando desde tus ventas activas.'}</div>
        const sech = (t,n,late)=> <div key={'h'+t} style={{ display:'flex', alignItems:'center', gap:6, margin:'16px 2px 7px', fontSize:9, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:late?C.overdueText:C.done }}>{t}<span style={{ color:C.muted }}>· {n}</span></div>
        const lista = p => filaProyecto(p)   // abrir un proyecto navega a su página workspace (early-return arriba), ya no expande inline
        // Vista por ETAPA del estudio: agrupa por la fase en que está cada proyecto (el flujo de trabajo de un vistazo).
        if(sortBy==='etapa'){
          const byF={}; rows.forEach(p=>{ const f=faseDe(p); (byF[f.k]=byF[f.k]||{f,ps:[]}).ps.push(p) })
          const gs=Object.values(byF).sort((a,b)=>a.f.o-b.f.o)
          return <div>{gs.map(g=>[sech(g.f.l,g.ps.length,false), ...g.ps.map(lista)])}</div>
        }
        const prio = fase==='curso' ? rows.filter(p=>riesgoDe(p)) : []
        const resto = fase==='curso' ? rows.filter(p=>!riesgoDe(p)) : rows
        return <div>
          {prio.length>0 && [sech('Prioritarios',prio.length,true), ...prio.map(lista)]}
          {resto.length>0 && [sech(fase==='pausa'?'En pausa':fase==='terminados'?'Terminados':'En curso',resto.length,false), ...resto.map(lista)]}
        </div>
      })()}

      {alcanceOverlay}
    </div>
  )
}

// Fase 2A — lee la propuesta aceptada del Drive con IA y extrae el alcance (compuerta humana antes de aplicar).
export function CarteraAlcanceModal({ proyecto, client, onClose, onApplied, onAddHito, onAddEntregable }){
  const [step,setStep] = useState('picker')   // picker | busy | review
  const [err,setErr] = useState(null)
  const [file,setFile] = useState(null)
  const [resumen,setResumen] = useState('')
  const [servicios,setServicios] = useState([])   // [{t,on}]
  const [fases,setFases] = useState([])           // [{titulo,fecha,subetapas:[],on}] — las etapas del plan con sus sub-etapas
  const [saving,setSaving] = useState(false)
  // Propuestas del estudio (carpeta central de Drive), filtradas por el nombre del cliente — es ahí donde viven, no en la carpeta del cliente.
  const [propAll,setPropAll] = useState(null)   // null=cargando · []=sin acceso/sin match
  const [propQ,setPropQ] = useState(_norm(client?.name||'').split(' ')[0]||'')
  useEffect(()=>{ let alive=true
    driveCall({action:'search', q:`'${PREC_FOLDERS.propuesta}' in parents and trashed=false`, pageSize:200})
      .then(d=>{ if(!alive) return; const legible=(f)=>/pdf|wordprocessing|presentation|document/i.test(f.mimeType||''); setPropAll((d.files||[]).filter(legible).sort((a,b)=>String(b.modifiedTime||'').localeCompare(String(a.modifiedTime||'')))) })
      .catch(()=>{ if(alive) setPropAll([]) })
    return ()=>{ alive=false } }, [])   // eslint-disable-line
  const propMatch = (propAll||[]).filter(f=>{ const q=_norm(propQ).trim(); return !q || _norm(f.name).includes(q) })

  const extraer = async (f) => {
    setStep('busy'); setErr(null); setFile(f)
    try{
      const txt = (await leerDriveTextoSA(f)).slice(0,16000)
      if(!txt||txt.length<100) throw new Error('El documento no tiene texto suficiente.')
      const sys = `Eres abogado chileno. Del texto de esta PROPUESTA DE HONORARIOS/SERVICIOS extrae el PLAN DE TRABAJO (el "alcance de los servicios"), respetando su estructura real. Devuelve SOLO un JSON (sin markdown): {"resumen":"2-3 frases del alcance","servicios":["..."],"fases":[{"titulo":"nombre de la etapa o fase","fecha":"YYYY-MM-DD o vacío","subetapas":["tarea o punto dentro de la fase","..."]}]}. Las FASES son las etapas del encargo EN ORDEN; las SUBETAPAS son los puntos o tareas de cada fase, tal como los lista la propuesta. Pon fecha SOLO si la propuesta la menciona para esa fase (p. ej. un plan por meses); si no, deja "". NO inventes fases, subetapas ni fechas: usa el lenguaje de la propuesta. En litigios, las fases son las etapas procesales del encargo.`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:3500,system:sys,messages:[{role:'user',content:txt}]})
      const out = data?.content?.[0]?.text||''; const m = out.match(/\{[\s\S]*\}/); let obj={}
      try{ obj = m?JSON.parse(m[0]):{} }catch(_){ obj={} }
      setResumen(String(obj.resumen||''))
      setServicios((Array.isArray(obj.servicios)?obj.servicios:[]).filter(Boolean).map(s=>({t:String(s).slice(0,240),on:true})))
      const fs=(Array.isArray(obj.fases)?obj.fases:[]).filter(x=>x&&x.titulo).map(x=>({ titulo:String(x.titulo).slice(0,200), fecha:/^\d{4}-\d{2}-\d{2}$/.test(x.fecha||'')?x.fecha:'', subetapas:(Array.isArray(x.subetapas)?x.subetapas:[]).filter(Boolean).map(s=>String(s).slice(0,400)), on:true }))
      setFases(fs)
      if(!obj.resumen && !fs.length && !(obj.servicios||[]).length) throw new Error('No pude leer un plan claro en ese documento.')
      setStep('review')
    }catch(e){ setErr(/No hay conexión|Failed to fetch|No autorizado|GOOGLE_OAUTH/i.test(e?.message||'')?'Conecta Drive desde el menú para leer el documento.':(e?.message||'No se pudo leer.')); setStep('picker') }
  }
  const aplicar = async () => {
    if(saving) return; setSaving(true); setErr(null)
    try{
      const servSel = servicios.filter(s=>s.on).map(s=>s.t)
      const alcance = (resumen.trim() + (servSel.length?`\n\nServicios: ${servSel.join(' · ')}`:'')).trim() || null
      const faseSel = fases.filter(f=>f.on)
      const conFecha = faseSel.filter(f=>f.fecha).sort((a,b)=>a.fecha.localeCompare(b.fecha))
      const prox = conFecha.find(f=>f.fecha>=new Date().toISOString().slice(0,10)) || conFecha[0] || null
      const campos = { alcance, ultima_actividad:new Date().toISOString().slice(0,10), updated_at:new Date().toISOString() }
      if(prox){ campos.plazo_label = prox.titulo; campos.plazo = prox.fecha }
      const { error } = await supabase.from('proyectos_cartera').update(campos).eq('id',proyecto.id)
      if(error) throw error
      // Agenda las fases con fecha como plazos del cliente (misma tabla que el calendario de plazos)
      const conAgenda = faseSel.filter(f=>f.fecha)
      if(conAgenda.length && client?.id){
        const ins = conAgenda.map(f=>({ client_id:String(client.id), titulo:f.titulo, tipo:'hito', fecha:f.fecha||null, fuente:file?.name||'propuesta', file_id:file?.id||null }))
        await supabase.from('plazos').insert(ins).then(()=>{},()=>{})   // tolera tabla ausente
      }
      // SIEMBRA EL PLAN desde la propuesta: cada fase = un paso (hito) ordenado, con sus sub-etapas (entregables colgando del hito). Pasos reales del documento, no inventados.
      if(faseSel.length && onAddHito){ for(let i=0;i<faseSel.length;i++){ const f=faseSel[i]
        try{ const h=await onAddHito(proyecto.id, f.titulo, null, null, { plazo:f.fecha||null, orden:i })
          if(h?.id && onAddEntregable){ for(let j=0;j<(f.subetapas||[]).length;j++){ try{ await onAddEntregable(proyecto.id, f.subetapas[j], null, h.id) }catch(e){registrarError({origen:'accion',vista:'plazos',err:e})} } }
        }catch(e){registrarError({origen:'accion',vista:'plazos',err:e})} } }
      onApplied&&onApplied(proyecto.id, campos)
      onClose()
    }catch(e){ setErr(/relation .*proyectos_cartera|Could not find the table|column .*alcance/i.test(e?.message||'')?'Falta la columna: corre el ALTER de docs/sql_proyectos_cartera.sql.':(e?.message||'No se pudo guardar.')); setSaving(false) }
  }

  const box = { fontSize:13, color:C.text, lineHeight:1.5, background:C.bgSoft||'#F5F7F9', border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 10px', width:'100%', boxSizing:'border-box' }
  const lbl = { fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:.3, margin:'0 0 6px' }
  return (
    <Modal fullscreenOnMobile title={<><span style={{color:C.accent}}>Alcance del proyecto</span>{client?.name&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose} closeOnBackdrop={false}>
      <div style={{ padding:'4px 2px' }}>
        {err&&<div style={{ fontSize:12, color:C.overdue, background:C.overdueBg||'#FCEBEB', borderRadius:8, padding:'8px 10px', marginBottom:10 }}>{err}</div>}
        {step==='picker'&&(
          <>
            <div style={{ fontSize:13, color:C.muted, marginBottom:10 }}>Elige la propuesta de honorarios aceptada. La IA leerá su alcance y armará el plan para tu revisión.</div>
            <div style={lbl}>Propuestas de la oficina</div>
            <div style={{ display:'flex', alignItems:'center', gap:6, border:`1.5px solid ${C.accent}`, background:'#fff', borderRadius:8, padding:'6px 9px', marginBottom:8 }}>
              <input value={propQ} onChange={e=>setPropQ(e.target.value)} placeholder='Buscar propuesta por nombre…' style={{ border:'none', outline:'none', fontSize:13, color:C.text, flex:1, minWidth:0, background:'none' }}/>
            </div>
            <div style={{ border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden', marginBottom:14, maxHeight:230, overflowY:'auto' }}>
              {propAll===null ? <div style={{ fontSize:12, color:C.muted, padding:'10px' }}>Buscando propuestas…</div>
                : propMatch.length===0 ? <div style={{ fontSize:12, color:C.muted, padding:'10px' }}>{propAll.length?'Sin propuestas que calcen — ajusta la búsqueda o elige del Drive del cliente.':'No se pudo leer la carpeta de propuestas (revisa la conexión a Drive).'}</div>
                : propMatch.slice(0,20).map(f=>(
                  <div key={f.id} onClick={()=>extraer(f)} style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px', borderTop:`1px solid ${C.bgSoft||'#F1EFE8'}`, cursor:'pointer' }}>
                    <span style={{ flex:1, minWidth:0, fontSize:12.5, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize:10, color:C.muted, flexShrink:0 }}>{String(f.modifiedTime||'').slice(0,10)}</span>
                    <span style={{ color:C.textSoft, fontSize:14, flexShrink:0 }}><Gl n='chevron'/></span>
                  </div>
                ))}
            </div>
            {client ? <><div style={lbl}>…o del Drive del cliente</div><DocumentosDrive client={client} onPick={extraer}/></> : null}
          </>
        )}
        {step==='busy'&&<div style={{ fontSize:13, color:C.muted, textAlign:'center', padding:'26px 0' }}>Leyendo la propuesta y extrayendo el alcance…</div>}
        {step==='review'&&(
          <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:C.azulBg||'#E6F1FB', borderRadius:20, padding:'4px 10px', marginBottom:12 }}>
              <span style={{ fontSize:11, color:C.azulInfo||C.azulInfo }}>Leído por IA · {file?.name||'propuesta'}</span>
            </div>
            <div style={lbl}>Resumen del alcance</div>
            <textarea value={resumen} onChange={e=>setResumen(e.target.value)} rows={3} style={{ ...box, resize:'vertical', marginBottom:14 }}/>
            {servicios.length>0&&<>
              <div style={lbl}>Servicios comprometidos</div>
              <div style={{ marginBottom:14 }}>
                {servicios.map((s,i)=>(
                  <div key={i} onClick={()=>setServicios(a=>a.map((x,j)=>j===i?{...x,on:!x.on}:x))} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', cursor:'pointer' }}>
                    <span style={{ width:16, height:16, borderRadius:4, flexShrink:0, background:s.on?C.done:'transparent', border:s.on?'none':`1.5px solid ${C.done||'#99ABB4'}`, color:'#fff', fontSize:11, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{s.on?<Gl n='tick'/>:''}</span>
                    <span style={{ fontSize:13, color:s.on?C.text:C.muted }}>{s.t}</span>
                  </div>
                ))}
              </div>
            </>}
            {fases.length>0&&<>
              <div style={lbl}>Plan del proyecto · {fases.length} {fases.length===1?'etapa':'etapas'}</div>
              <div style={{ border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden', marginBottom:4 }}>
                {fases.map((f,i)=>(
                  <div key={i} style={{ padding:'9px 10px', borderTop:i?`1px solid ${C.bgSoft||'#F1EFE8'}`:'none', opacity:f.on?1:.5 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:C.text, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{i+1}. {f.titulo}</span>
                      <input type='date' value={f.fecha} onChange={e=>setFases(a=>a.map((x,j)=>j===i?{...x,fecha:e.target.value}:x))} style={{ fontSize:11, padding:'2px 5px', borderRadius:6, border:`1px solid ${C.border}`, color:C.text }}/>
                      <span onClick={()=>setFases(a=>a.map((x,j)=>j===i?{...x,on:!x.on}:x))} style={{ width:16, height:16, borderRadius:4, flexShrink:0, cursor:'pointer', background:f.on?C.done:'transparent', border:f.on?'none':`1.5px solid ${C.done||'#99ABB4'}`, color:'#fff', fontSize:11, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{f.on?<Gl n='tick'/>:''}</span>
                    </div>
                    {(f.subetapas||[]).length>0&&<ul style={{ margin:'5px 0 0', paddingLeft:18 }}>{f.subetapas.map((s,j)=><li key={j} style={{ fontSize:11.5, color:C.muted, marginBottom:2 }}>{s}</li>)}</ul>}
                  </div>
                ))}
              </div>
              <div style={{ fontSize:11, color:C.grisText, marginBottom:14 }}>Cada etapa marcada se crea como paso del plan, con sus sub-etapas. Las que tengan fecha se agendan como plazo.</div>
            </>}
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={aplicar} disabled={saving} style={{ flex:1, fontSize:13, fontWeight:600, color:'#fff', background:C.accent, border:'none', borderRadius:8, padding:10, cursor:saving?'default':'pointer' }}>{saving?'Creando el plan…':'Crear el plan'}</button>
              <button onClick={onClose} style={{ fontSize:13, fontWeight:600, color:C.muted, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 14px', cursor:'pointer' }}>Descartar</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

