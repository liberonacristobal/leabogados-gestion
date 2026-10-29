// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect } from 'react'
import { supabase, getDriveToken, connectDrivePermanente } from '../supabase'
import { BRAND, C, Gl, fmt, fmtFechaDMY, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { BitacoraLista, DriveAuthError, PREC_FOLDERS, Sparkle, claudeCall, driveCall, driveGet, driveToken, fmtUF, leerDriveTextoSA, logActividad, registrarError, rsLabel, saldoBill, ventaHistoricaUF } from '../lib/compartido.jsx'
import { DocumentosDrive } from '../lib/fichaCliente.jsx'

// ─── CENTRO DE APRENDIZAJE: lo que la app aprendió (learnings) — visible y borrable (des-aprender un match errado) ──
// Asistente de redacción legal con IA (claudeCall). Redacta en el FORMATO del estudio; el usuario valida/edita (compuerta humana).
export const ESTUDIO_BRIEF = `Eres redactor del estudio jurídico chileno ${BRAND.nombre} (práctica corporativa y tributaria). Socios: ${BRAND.socios}. Membrete/firma del estudio: "${BRAND.direccionFirma}, ${BRAND.ciudad}", "${BRAND.telefono}", "${BRAND.web}". Escribe en español jurídico chileno, formal, claro y preciso. El estudio factura SIEMPRE exento de IVA; los honorarios se expresan en UF. Usa SOLO los datos que entregue el usuario; si falta un dato clave (honorarios, alcance, nombres), déjalo marcado como [completar] en vez de inventarlo. Devuelve solo el documento, sin comentarios ni explicaciones.`

export const TIPOS_REDACCION = [
  {k:'propuesta', lbl:'Propuesta de honorarios', max:2600, sys:`${ESTUDIO_BRIEF}\n\nRedacta una PROPUESTA DE SERVICIOS PROFESIONALES con la estructura exacta del estudio:\n· Encabezado: "Propuesta de Servicios Profesionales" + subtítulo con el tipo de asesoría; destinatario(s) y empresa; "PRESENTE"; "Santiago, <fecha>"; "CONFIDENCIAL"; "Ref.: Propuesta de Servicios Legales - <tema>"; "De mi consideración:".\n· Intro: "${BRAND.nombre} tiene el agrado de someter a su consideración la presente propuesta de servicios profesionales. El objeto de nuestro encargo es...".\n· "I. Alcance de los Servicios" (subsecciones A/B e ítems numerados según corresponda).\n· "II. Honorarios Profesionales" (Honorario Fijo / Retainer en UF; Honorario de Éxito / Success Fee como % si aplica).\n· "III. Forma de Pago" (ej. Retainer 50% a la aceptación y 50% al cierre; "la facturación se realizará mediante factura exenta de IVA").\n· "IV. Condiciones y Exclusiones" (no incluye litigios/arbitrajes salvo indicación expresa; un cambio sustancial de alcance requiere revisión de honorarios; los gastos de terceros —derechos notariales, CBR, certificados— son de cargo del cliente).\n· Cierre cordial + firma de un Socio (Cristóbal Liberona o Erasmo Escala), bajo él "Socio" y "${BRAND.nombre}".`},
  {k:'memo', lbl:'Memo', max:2200, sys:`${ESTUDIO_BRIEF}\n\nRedacta un MEMORÁNDUM legal: membrete del estudio ("CONFIDENCIAL", fecha, dirección, teléfono, leabogados.cl), una exposición ordenada de los hechos, el análisis jurídico/tributario aplicable y conclusiones/recomendaciones.`},
  {k:'informe', lbl:'Informe tributario', max:3000, sys:`${ESTUDIO_BRIEF}\n\nRedacta un INFORME / OPINIÓN LEGAL TRIBUTARIA sobre la materia específica que indique el usuario, con la estructura y el estándar del estudio:\n· Encabezado: "Santiago, <fecha>"; destinatario ("Señores <X>", "Presente"); "Ref.: Opinión legal – <materia>"; "De nuestra consideración:".\n· Intro: "En nuestra calidad de asesores legales de <Sociedad>, RUT <X>, ... hemos examinado <la documentación/materia>...".\n· "I. Antecedentes y alcance de la revisión" (hechos, contratos y documentos tenidos a la vista).\n· "II. Marco normativo y análisis" (subsecciones II.1, II.2…; CITA las normas chilenas pertinentes —DL 824 sobre Impuesto a la Renta, DL 825 sobre IVA y sus artículos, Código Tributario, circulares/oficios del SII—; cuando haya requisitos copulativos, analízalos UNO A UNO y cierra cada uno, cuando corresponda, con "Este requisito se encuentra satisfecho").\n· "III. Conclusiones" (numeradas; usa el estándar "en términos jurídicamente razonables").\n· "IV. Reservas y limitaciones" (opinión emitida solo desde una perspectiva jurídica, sobre los antecedentes a la fecha, bajo estándar de razonabilidad jurídica, sin garantía de resultado ni pronunciamiento sobre la actuación futura del SII, en beneficio exclusivo del destinatario).\n· Firma de un Socio (Cristóbal Liberona o Erasmo Escala), "Socio", "${BRAND.nombre}".\nSALVAGUARDA CRÍTICA: NUNCA inventes números de artículos, oficios, circulares ni jurisprudencia. Si no estás seguro de una cita normativa exacta, escríbela como [verificar cita]. Si falta un dato clave (norma, hechos, RUT), márcalo como [completar].`},
  {k:'presentacion', lbl:'Presentación', max:2600, sys:`${ESTUDIO_BRIEF}\n\nRedacta el GUION/ESQUEMA de una PRESENTACIÓN profesional del estudio (para convertir a láminas) sobre la materia que indique el usuario. Estructura: portada (título + cliente + fecha); agenda; luego una lámina por sección con el formato "Lámina N — <título>" y 3-5 viñetas concisas; cierra con conclusiones/próximos pasos y una lámina de contacto del estudio. Si es una presentación de servicios/honorarios, refleja el alcance y la estructura de honorarios (UF, factura exenta de IVA). Marca datos faltantes como [completar].`},
  {k:'plan', lbl:'Plan de acción', max:2400, sys:`${ESTUDIO_BRIEF}\n\nRedacta un PLAN DE ACCIÓN / HOJA DE RUTA para la materia que indique el usuario, con la estructura del estudio:\n· Encabezado: "CONFIDENCIAL"; "Santiago, <fecha>"; destinatario/cliente; "Ref.: Plan de acción – <materia>".\n· "Objetivo": 1-2 frases con el resultado que se busca lograr.\n· "Etapas" numeradas (I, II, III…). Cada etapa con: un título; las acciones concretas (viñetas); el RESPONSABLE de cada acción (Estudio / Cliente / Notaría / SII / Conservador de Bienes Raíces / contador, según corresponda); y un PLAZO o hito estimado.\n· "Consideraciones legales y tributarias clave": requisitos, riesgos y contingencias a tener presentes.\n· "Próximos pasos inmediatos": las primeras 2-3 acciones para arrancar de inmediato.\n· Firma de un Socio (Cristóbal Liberona o Erasmo Escala), "Socio", "${BRAND.nombre}".\nSi falta un dato clave (plazos exactos, montos, normas), márcalo como [completar]. NO inventes cifras, plazos legales ni números de norma; si no estás seguro de una cita, escríbela como [verificar cita].`},
  {k:'minuta', lbl:'Minuta de reunión', max:1600, sys:`${ESTUDIO_BRIEF}\n\nRedacta una MINUTA DE REUNIÓN: encabezado (cliente, fecha, asistentes), puntos tratados numerados, acuerdos/decisiones y próximos pasos con responsables. Concisa y accionable.`},
  {k:'clausula', lbl:'Cláusula', max:1400, sys:`${ESTUDIO_BRIEF}\n\nRedacta la o las CLÁUSULAS contractuales que pida el usuario, precisas y ejecutables bajo derecho chileno. Si aporta valor, ofrece alternativas de redacción.`},
  {k:'correo', lbl:'Correo', max:1100, sys:`${ESTUDIO_BRIEF}\n\nRedacta un CORREO profesional (al cliente o contraparte) en el tono del estudio, claro y cordial. Empieza con "Asunto: ...".`},
]

// Biblioteca de cláusulas: categorías canónicas (la IA debe usar EXACTAMENTE una de estas al extraer).
export const CATS_CLAUSULA = ['Confidencialidad','No competencia','Declaraciones y garantías','Honorarios y pago','Pacto de accionistas','Testamentos y sucesorio','Protocolo familiar','Indemnidad y responsabilidad','Resolución de conflictos','General']

// driveGet con auto-refresh: el provider_token de Google vence a la hora; si da 401, limpia el cacheado y reintenta con el de la sesión.
export async function driveGetAuth(url){
  let token=await driveToken()
  try{ if(!token) throw new DriveAuthError(); return await driveGet(token,url) }
  catch(e){
    if(e&&e.code===401){
      try{ localStorage.removeItem('drive_token') }catch(_){}
      let t2=null; try{ t2=await getDriveToken() }catch(_){}
      if(t2){ try{ localStorage.setItem('drive_token',t2) }catch(_){}; return await driveGet(t2,url) }
    }
    throw (e&&e.code===401)?new DriveAuthError():e
  }
}

export function AsistenteRedaccion({clients=[], sales=[], billing=[], clientEntities=[], onClose}){
  const [tipo,setTipo] = useState('propuesta')
  const isDesk = useIsDesktop()
  const [cliente,setCliente] = useState('')
  const [datos,setDatos] = useState('')
  const [draft,setDraft] = useState('')
  const [loading,setLoading] = useState(false)
  const [err,setErr] = useState(null)
  const [copiado,setCopiado] = useState(false)
  const [siiNov,setSiiNov] = useState([])   // radar SII (capa del BI) para cruzar memos/informes/presentaciones
  const [cruzarSii,setCruzarSii] = useState(true)
  const SII_TIPOS = ['memo','informe','presentacion','plan']
  useEffect(()=>{ supabase.from('sii_novedades').select('tipo,numero,titulo,areas,prioridad,resumen,brief,fecha,vigente').then(({data})=>setSiiNov((data||[]).filter(n=>n.vigente!==false)),()=>{}) },[])
  const [cruzarCliente,setCruzarCliente] = useState(true)
  const cliObj = (clients||[]).find(c=>c.name&&c.name.trim()===cliente.trim()) || (cliente.trim().length>=3 ? (clients||[]).find(c=>c.name&&(c.name||'').toLowerCase().includes(cliente.trim().toLowerCase())) : null)
  const perfilCliente = (c)=>{   // fuente única: ventaHistoricaUF + saldoBill (sin re-implementar fórmulas)
    const cid=c.id
    const rs=rsLabel(cid, clients, clientEntities)
    const ruts=[...new Set((clientEntities||[]).filter(e=>String(e.client_id)===String(cid)).map(e=>e.rut).filter(Boolean))]
    const vts=(sales||[]).filter(s=>String(s.client_id)===String(cid)&&!s.deleted_at&&['Activo','Terminado'].includes(s.status))
    const areas=[...new Set(vts.map(s=>s.area).filter(Boolean))]
    const encargos=[...new Set(vts.map(s=>s.title).filter(Boolean))].slice(0,6)
    const vendidoUF=ventaHistoricaUF(cid, sales)
    const porCobrar=(billing||[]).filter(b=>String(b.client_id)===String(cid)).reduce((a,b)=>a+saldoBill(b),0)
    const parts=[`Cliente: ${c.name}${rs&&rs!==c.name?` (RS: ${rs})`:''}.`]
    if(ruts.length) parts.push(`RUT: ${ruts.join(', ')}.`)
    if(areas.length) parts.push(`Áreas contratadas con el estudio: ${areas.join(', ')}.`)
    if(encargos.length) parts.push(`Encargos: ${encargos.join('; ')}.`)
    if(vendidoUF>0) parts.push(`Vendido histórico al estudio: ${fmtUF(vendidoUF)}.`)
    if(porCobrar>0) parts.push(`Saldo por cobrar actual: ${fmt(porCobrar)}.`)
    return parts.join(' ')
  }
  const [cliDocSel,setCliDocSel]=useState(null); const [cliDocTxt,setCliDocTxt]=useState(''); const [cliDocBusy,setCliDocBusy]=useState(false); const [cliDocErr,setCliDocErr]=useState(null); const [mostrarDocCli,setMostrarDocCli]=useState(false)
  const [cliFolder,setCliFolder]=useState(null); const [guardando,setGuardando]=useState(false); const [guardadoUrl,setGuardadoUrl]=useState(null); const [guardadoErr,setGuardadoErr]=useState(null)
  const usarDocCliente = async(file)=>{   // lee un documento de la carpeta del cliente y lo deja como contexto de la redacción
    setCliDocBusy(true); setCliDocErr(null)
    try{ const txt=(await leerDriveTextoSA(file)).slice(0,8000); setCliDocSel(file); setCliDocTxt(txt); setMostrarDocCli(false) }
    catch(e){ setCliDocErr(/No hay conexión|No autorizado|Failed to fetch|GOOGLE_OAUTH/i.test(e?.message||'')?'Conecta Drive desde el menú ☰ para leer el documento.':(e?.message||'No se pudo leer el documento.')) }
    setCliDocBusy(false)
  }
  const [precKw,setPrecKw]=useState(''); const [precBusy,setPrecBusy]=useState(false); const [precErr,setPrecErr]=useState(null)
  const [precFiles,setPrecFiles]=useState(null); const [precSel,setPrecSel]=useState(null); const [precTxt,setPrecTxt]=useState(''); const [precReading,setPrecReading]=useState(false)
  const [precFromIndex,setPrecFromIndex]=useState(false); const [idxBusy,setIdxBusy]=useState(false); const [idxMsg,setIdxMsg]=useState(null); const [precNeedAuth,setPrecNeedAuth]=useState(false)
  const [clauMode,setClauMode]=useState('usar'); const [clauLib,setClauLib]=useState(null); const [clauCat,setClauCat]=useState(''); const [clauKw,setClauKw]=useState(''); const [clauBusy,setClauBusy]=useState(false); const [clauDocs,setClauDocs]=useState(null); const [extrBusy,setExtrBusy]=useState(null); const [extrMsg,setExtrMsg]=useState(null)
  useEffect(()=>{ setPrecFiles(null); setPrecSel(null); setPrecTxt(''); setPrecErr(null) },[tipo])   // no arrastrar un precedente de otro tipo
  useEffect(()=>{ setCliDocSel(null); setCliDocTxt(''); setMostrarDocCli(false); setCliDocErr(null); setGuardadoUrl(null); setGuardadoErr(null)   // reset + busca la carpeta del cliente al cambiar
    let alive=true; if(!cliObj){ setCliFolder(null); return ()=>{alive=false} }
    if(cliObj.drive_folder_id){ setCliFolder({id:cliObj.drive_folder_id,name:cliObj.name}); return ()=>{alive=false} }   // carpeta de la ficha (fuente única)
    ;(async()=>{ try{ const {data}=await supabase.from('client_drive').select('folder_id,folder_name').eq('client_id',String(cliObj.id)).maybeSingle(); if(alive) setCliFolder(data&&data.folder_id?{id:data.folder_id,name:data.folder_name}:null) }catch(_){ if(alive) setCliFolder(null) } })()
    return ()=>{alive=false}
  },[cliObj&&cliObj.id])
  useEffect(()=>{ try{ const d=JSON.parse(localStorage.getItem('redaccion_draft')||'null'); if(d&&(Date.now()-(d.ts||0))<10*60*1000){ if(d.tipo)setTipo(d.tipo); if(d.cliente!=null)setCliente(d.cliente); if(d.datos!=null)setDatos(d.datos) } localStorage.removeItem('redaccion_draft') }catch(_){} },[])   // volver de Reconectar Drive sin perder lo escrito
  const MIMES_PREC="(mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.google-apps.document')"
  const manejarDriveErr = (e)=>{ const m=e?.message||''; if((e&&e.code===401)||/drive_auth|No hay conexión|No autorizado|GOOGLE_OAUTH|configurar|Failed to fetch|NetworkError|Error 40|Error 50/i.test(m)){ setPrecNeedAuth(true); setPrecErr(null) } else { setPrecErr(m||'No se pudo conectar con Drive.') } }
  const reconectarDrive = ()=>{ try{ localStorage.setItem('redaccion_draft', JSON.stringify({tipo,cliente,datos,ts:Date.now()})) }catch(_){}; connectDrivePermanente() }
  const buscarPrecLive = async()=>{   // Fase 1: búsqueda en vivo en el Drive (fallback si el índice está vacío/no existe)
    const folder = PREC_FOLDERS[tipo]; if(!folder) return
    const kw=(precKw.trim()||cliente.trim()).replace(/['\\]/g,' ').trim()
    const filt = kw ? ` and (fullText contains '${kw}' or name contains '${kw}')` : ''
    const q = `'${folder}' in parents and trashed=false and ${MIMES_PREC}${filt}`
    const data = await driveCall({action:'search', q, pageSize:20})
    setPrecFiles(data.files||[]); setPrecFromIndex(false)
  }
  const buscarPrec = async()=>{   // Fase 2: índice primero (instantáneo, ordenado por usos); si no hay, cae a la búsqueda en vivo
    if(!PREC_FOLDERS[tipo]||precBusy) return
    setPrecBusy(true); setPrecErr(null); setPrecNeedAuth(false); setPrecFiles(null)
    try{
      const kw=(precKw.trim()||cliente.trim()).toLowerCase()
      let rows=null
      try{
        const {data,error}=await supabase.from('precedentes_index').select('file_id,title,mime_type,modified_time,usos').eq('tipo',tipo).order('usos',{ascending:false}).order('modified_time',{ascending:false}).limit(300)
        if(!error&&data&&data.length) rows=data
      }catch(_){}
      if(rows){
        const mapped=rows.map(r=>({id:r.file_id,name:r.title,mimeType:r.mime_type,modifiedTime:r.modified_time,usos:r.usos}))
        const filt = kw ? mapped.filter(r=>(r.name||'').toLowerCase().includes(kw)) : mapped
        setPrecFiles(filt.slice(0,30)); setPrecFromIndex(true)
      } else {
        await buscarPrecLive()
      }
    }catch(e){ manejarDriveErr(e) }
    setPrecBusy(false)
  }
  const indexarPrecedentes = async()=>{   // recorre las carpetas-biblioteca y puebla precedentes_index (upsert, conserva usos)
    if(idxBusy) return
    setIdxBusy(true); setPrecErr(null); setPrecNeedAuth(false); setIdxMsg(null)
    try{
      let total=0
      for(const tp of Object.keys(PREC_FOLDERS)){
        const folder=PREC_FOLDERS[tp]; let pageToken=null
        do{
          const q=encodeURIComponent(`'${folder}' in parents and trashed=false and ${MIMES_PREC}`)
          const url=`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=100${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`
          const data=await driveGetAuth(url)
          const rows=(data.files||[]).map(f=>({file_id:f.id,title:f.name,tipo:tp,mime_type:f.mimeType,modified_time:f.modifiedTime,updated_at:new Date().toISOString()}))
          if(rows.length){ const {error}=await supabase.from('precedentes_index').upsert(rows,{onConflict:'file_id'}); if(error) throw error; total+=rows.length }
          pageToken=data.nextPageToken||null
        } while(pageToken)
      }
      setIdxMsg(`Índice actualizado: ${total} documentos.`)
      await buscarPrec()
    }catch(e){ manejarDriveErr(e) }
    setIdxBusy(false)
  }
  const elegirPrec = async(file)=>{
    if(precReading) return
    setPrecReading(true); setPrecErr(null); setPrecNeedAuth(false)
    try{
      const txt = (await leerDriveTextoSA(file)).slice(0,7000)
      setPrecSel(file); setPrecTxt(txt)
      // aprende: el precedente que usas sube en el ranking (se ofrece primero la próxima vez)
      try{ if(precFromIndex&&file.usos!=null) await supabase.from('precedentes_index').update({usos:(file.usos||0)+1}).eq('file_id',file.id) }catch(e){registrarError({origen:'accion',vista:'precedentes_index',err:e})}
    }catch(e){ manejarDriveErr(e) }
    setPrecReading(false)
  }
  const cargarClausulas = async()=>{
    setClauBusy(true); setPrecErr(null)
    try{ const {data}=await supabase.from('clausulas').select('id,titulo,categoria,texto,usos').order('usos',{ascending:false}).order('titulo').limit(300); setClauLib(data||[]) }
    catch(_){ setClauLib([]) }
    setClauBusy(false)
  }
  useEffect(()=>{ if(tipo==='clausula'&&clauLib===null) cargarClausulas() },[tipo])   // carga la biblioteca al entrar a Cláusula
  const usarClausula = (c)=>{ setPrecSel({name:c.titulo}); setPrecTxt(c.texto||''); try{ supabase.from('clausulas').update({usos:(c.usos||0)+1}).eq('id',c.id) }catch(e){registrarError({origen:'accion',vista:'clausulas',err:e})} }
  const buscarDocClausula = async()=>{
    if(clauBusy) return
    setClauBusy(true); setPrecErr(null); setPrecNeedAuth(false); setExtrMsg(null); setClauDocs(null)
    try{
      const kw=(clauKw.trim()||cliente.trim()).replace(/['\\]/g,' ').trim()
      if(!kw) throw new Error('Escribe qué documento buscar (cliente, materia…).')
      const q=`trashed=false and (fullText contains '${kw}' or name contains '${kw}') and ${MIMES_PREC}`
      const data=await driveCall({action:'search', q, pageSize:20})
      setClauDocs(data.files||[])
    }catch(e){ manejarDriveErr(e) }
    setClauBusy(false)
  }
  const extraerClausulas = async(file)=>{
    if(extrBusy) return
    setExtrBusy(file.id); setPrecErr(null); setExtrMsg(null)
    try{
      const txt = await leerDriveTextoSA(file)
      if(!txt||txt.length<200) throw new Error('El documento no tiene texto suficiente.')
      const sys = `Eres abogado chileno. Del documento legal extrae las CLÁUSULAS REUTILIZABLES (no los datos del caso). Devuelve SOLO un JSON array, sin markdown ni backticks, de objetos {titulo, categoria, texto}. titulo: nombre corto de la cláusula. categoria: EXACTAMENTE una de: ${CATS_CLAUSULA.join(' | ')}. texto: la cláusula redactada de forma reutilizable, reemplazando nombres/RUT/montos/fechas específicos del caso por marcadores [PARTE], [SOCIEDAD], [MONTO], [PLAZO], [FECHA]; conserva la redacción jurídica. Omite recitales y datos puramente del caso. Máximo 12 cláusulas.`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:3500,system:sys,messages:[{role:'user',content:txt.slice(0,14000)}]})
      const out = data?.content?.[0]?.text||''
      const m = out.match(/\[[\s\S]*\]/); let arr=[]; try{ arr = m?JSON.parse(m[0]):[] }catch(_){ arr=[] }
      const rows = (Array.isArray(arr)?arr:[]).filter(c=>c&&c.titulo&&c.texto).map(c=>{ const cat=CATS_CLAUSULA.includes(c.categoria)?c.categoria:'General'; return { clave:`${cat}::${String(c.titulo).slice(0,80)}`.toLowerCase(), titulo:String(c.titulo).slice(0,120), categoria:cat, texto:String(c.texto), fuente:file.name, file_id:file.id, updated_at:new Date().toISOString() } })
      if(!rows.length) throw new Error('No se encontraron cláusulas reutilizables en ese documento.')
      const {error}=await supabase.from('clausulas').upsert(rows,{onConflict:'clave'}); if(error) throw error
      setExtrMsg(`${rows.length} cláusulas guardadas desde "${file.name}".`); await cargarClausulas()
    }catch(e){ if(e&&(e.code===401||/drive_auth/.test(e.message||''))) setPrecNeedAuth(true); else setPrecErr(e?.message||'No se pudo extraer.') }
    setExtrBusy(null)
  }
  const generar = async()=>{
    if(!datos.trim()||loading) return
    setLoading(true); setErr(null)
    try{
      const t=TIPOS_REDACCION.find(x=>x.k===tipo)
      const hoy=new Date().toLocaleDateString('es-CL',{day:'numeric',month:'long',year:'numeric'})
      let content=`Fecha de hoy: ${hoy}.\n${cliente.trim()?`Destinatario/cliente: ${cliente.trim()}\n`:''}Datos e instrucciones para el documento:\n${datos.trim()}`
      if(cruzarCliente&&cliObj){ content+=`\n\nPERFIL DEL CLIENTE (de nuestra base de datos; úsalo para contextualizar y personalizar, no lo recites textual): ${perfilCliente(cliObj)}` }
      if(cruzarSii&&SII_TIPOS.includes(tipo)&&siiNov.length){
        const PRIO={alta:3,media:2,baja:1}
        const digest=siiNov.slice().sort((a,b)=>(PRIO[b.prioridad]||0)-(PRIO[a.prioridad]||0)).slice(0,18).map(n=>`- ${`${(n.tipo||'').toUpperCase()} ${n.numero||''}`.trim()}: ${n.titulo}${n.areas&&n.areas.length?` (áreas: ${n.areas.join('/')})`:''}${(n.brief||n.resumen)?` — ${(n.brief||n.resumen).slice(0,160)}`:''}`).join('\n')
        content+=`\n\nRADAR SII VIGENTE DEL ESTUDIO (contexto normativo actual, del módulo BI). Incorpora y CITA (tipo N° número) SOLO las novedades realmente pertinentes a este documento; ignora las que no apliquen. No inventes citas fuera de esta lista ni de la ley aplicable:\n${digest}`
      }
      if(precTxt&&precSel){ content+=`\n\nPRECEDENTE DEL ESTUDIO (documento real "${precSel.name}"): sigue su ESTRUCTURA, tono y cláusulas como modelo, pero ADAPTA todo al caso actual — NO copies datos, montos ni nombres del precedente.\n---\n${precTxt}\n---` }
      if(cliDocTxt&&cliDocSel){ content+=`\n\nDOCUMENTO DEL CLIENTE ("${cliDocSel.name}", de su carpeta en Drive): úsalo como fuente de datos y contexto REAL de este caso (partes, RUT, montos, fechas, cláusulas). Extrae lo pertinente; no lo copies textual.\n---\n${cliDocTxt}\n---` }
      const data=await claudeCall({model:'claude-opus-4-8',max_tokens:t.max,system:t.sys,messages:[{role:'user',content}]})
      setDraft(data?.content?.[0]?.text||'(sin respuesta)')
      logActividad('redaccion.generado',{detalle:{title:(TIPOS_REDACCION.find(t=>t.k===tipo)?.lbl||tipo),name:cliente||null}})
    }catch(e){ setErr(e?.message||'No se pudo generar.') }
    setLoading(false)
  }
  const copiar = ()=>{ try{ navigator.clipboard.writeText(draft); setCopiado(true); setTimeout(()=>setCopiado(false),1500) }catch(_){} }
  const mdToHtml = (md)=>{   // markdown del borrador → HTML para Word (.doc)
    const esc = s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const inline = s=>{ let x=esc(s); x=x.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>'); x=x.replace(/\*([^*\n]+)\*/g,'<i>$1</i>'); return x }
    let html='', inUl=false, inOl=false
    const close=()=>{ if(inUl){html+='</ul>';inUl=false} if(inOl){html+='</ol>';inOl=false} }
    for(const raw of String(md||'').split('\n')){
      const l=raw.replace(/\s+$/,''); let m
      if(/^\s*---+\s*$/.test(l)){ close(); html+='<hr/>'; continue }
      if(m=l.match(/^###\s+(.*)/)){ close(); html+='<h3>'+inline(m[1])+'</h3>'; continue }
      if(m=l.match(/^##\s+(.*)/)){ close(); html+='<h2>'+inline(m[1])+'</h2>'; continue }
      if(m=l.match(/^#\s+(.*)/)){ close(); html+='<h1>'+inline(m[1])+'</h1>'; continue }
      if(m=l.match(/^\s*[-*•]\s+(.*)/)){ if(inOl){html+='</ol>';inOl=false} if(!inUl){html+='<ul>';inUl=true} html+='<li>'+inline(m[1])+'</li>'; continue }
      if(m=l.match(/^\s*\d+[.)]\s+(.*)/)){ if(inUl){html+='</ul>';inUl=false} if(!inOl){html+='<ol>';inOl=true} html+='<li>'+inline(m[1])+'</li>'; continue }
      if(l.trim()===''){ close(); html+='<p></p>'; continue }
      close(); html+='<p>'+inline(l)+'</p>'
    }
    close(); return html
  }
  const parseSlides = (md)=>{   // "Lámina N — título" / "## título" delimitan láminas; viñetas y párrafos van al cuerpo
    const isTitle = l => /^#{1,3}\s+\S/.test(l) || /^#{0,3}\s*L[áa]mina\b/i.test(l)
    const clean = s => s.replace(/^#{1,3}\s+/,'').replace(/^#{0,3}\s*L[áa]mina\s*\d*\s*[—–:.-]*\s*/i,'').replace(/\*\*/g,'').replace(/\*/g,'').trim()
    const slides=[]; let cur=null
    for(const raw of String(md||'').split('\n')){
      const l=raw.replace(/\s+$/,''); if(!l.trim()||/^\s*---+\s*$/.test(l)) continue
      if(isTitle(l)){ cur={title:clean(l),bullets:[]}; slides.push(cur); continue }
      const b=l.replace(/^\s*[-*•]\s+/,'').replace(/\*\*/g,'').replace(/\*/g,'').trim()
      if(!cur){ cur={title:b,bullets:[]}; slides.push(cur); continue }
      cur.bullets.push(b)
    }
    return slides.filter(s=>s.title||s.bullets.length)
  }
  const descargarPPTX = async()=>{
    logActividad('redaccion.pptx',{detalle:{title:(TIPOS_REDACCION.find(t=>t.k===tipo)?.lbl||tipo),name:cliente||null}})
    if(!draft) return
    const P = (await import('https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/+esm')).default
    const pptx = new P(); pptx.layout='LAYOUT_WIDE'
    const NAVY='003C50', GRAF='3D3D3D'
    parseSlides(draft).forEach((s,i)=>{
      const sl=pptx.addSlide()
      sl.addText(s.title||'', {x:0.6,y:0.5,w:12,h:1,fontSize:i===0?30:22,bold:true,color:NAVY,fontFace:'Calibri'})
      if(s.bullets.length) sl.addText(s.bullets.map(b=>({text:b,options:{bullet:true,fontSize:16,color:GRAF,paraSpaceAfter:8}})),{x:0.9,y:1.7,w:11.5,h:5.3,fontFace:'Calibri',valign:'top'})
    })
    const fn=(`Presentación${cliente.trim()?' - '+cliente.trim():''}`).replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.\-]/g,'').trim()||'Presentación'
    await pptx.writeFile({fileName:fn+'.pptx'})
  }
  const descargarWord = ()=>{
    logActividad('redaccion.word',{detalle:{title:(TIPOS_REDACCION.find(t=>t.k===tipo)?.lbl||tipo),name:cliente||null}})
    if(!draft) return
    const t=TIPOS_REDACCION.find(x=>x.k===tipo)
    const html=`<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><style>@page{margin:2.5cm} body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.45} h1{font-size:15pt;margin:14pt 0 6pt} h2{font-size:13pt;margin:12pt 0 5pt} h3{font-size:12pt;margin:10pt 0 4pt} p{margin:0 0 8pt} ul,ol{margin:0 0 8pt 18pt} hr{border:none;border-top:1px solid #999;margin:10pt 0}</style></head><body>${mdToHtml(draft)}</body></html>`
    const blob=new Blob(['﻿',html],{type:'application/msword'})
    const url=URL.createObjectURL(blob)
    const fn=(`${t?.lbl||'Documento'}${cliente.trim()?' - '+cliente.trim():''}`).replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.\-]/g,'').trim()||'Documento'
    const a=document.createElement('a'); a.href=url; a.download=fn+'.doc'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500)
  }
  const guardarEnDrive = async()=>{
    if(!draft||!cliFolder||guardando) return
    setGuardando(true); setGuardadoUrl(null); setGuardadoErr(null)
    try{
      const t=TIPOS_REDACCION.find(x=>x.k===tipo)
      const html=`<html><head><meta charset='utf-8'></head><body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a">${mdToHtml(draft)}</body></html>`
      const name=(`${t?.lbl||'Documento'}${cliente.trim()?' - '+cliente.trim():''}`).replace(/[^\w\sáéíóúñÁÉÍÓÚÑ.\-]/g,'').trim()||'Documento'
      const d=await driveCall({action:'upload', folderId:cliFolder.id, name, html})
      setGuardadoUrl(d.url||null)
      logActividad('redaccion.drive',{detalle:{title:(TIPOS_REDACCION.find(t=>t.k===tipo)?.lbl||tipo),name:cliente||null}})
    }catch(e){ const m=e?.message||''; setGuardadoErr(/No hay conexión|No autorizado|Failed to fetch|GOOGLE_OAUTH/i.test(m)?'Conecta Drive desde el menú ☰ para guardar.':(m||'No se pudo guardar en Drive.')) }
    setGuardando(false)
  }
  const inp = {width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'9px 11px',fontSize:13,color:C.text,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
  return (
    <div style={{padding:'2px 2px 6px',...(isDesk?{display:'flex',alignItems:'flex-start',gap:18}:{})}}>
    <div style={isDesk?{width:420,flexShrink:0}:undefined}>
      <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>La IA redacta en el formato de la oficina. <b>Tú validas y editas</b> antes de usarlo — nada se envía solo.</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
        {TIPOS_REDACCION.map(t=>(<button key={t.k} onClick={()=>setTipo(t.k)} style={{fontSize:12,fontWeight:600,padding:'5px 12px',borderRadius:20,border:`1px solid ${tipo===t.k?C.accent:C.border}`,background:tipo===t.k?C.azulBg:'#fff',color:tipo===t.k?C.accent:C.muted,cursor:'pointer'}}>{t.lbl}</button>))}
      </div>
      <input value={cliente} onChange={e=>setCliente(e.target.value)} placeholder='Cliente / destinatario (opcional)' style={{...inp,marginBottom:8}} list='red-cli'/>
      <datalist id='red-cli'>{(clients||[]).map(c=><option key={c.id} value={c.name}/>)}</datalist>
      <textarea value={datos} onChange={e=>setDatos(e.target.value)} placeholder='Datos e instrucciones: de qué se trata, alcance, honorarios (UF), hechos clave…' rows={4} style={{...inp,resize:'vertical',marginBottom:10}}/>
      {cliObj&&(
        <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,color:C.muted,margin:'0 2px 10px',cursor:'pointer'}}>
          <input type='checkbox' checked={cruzarCliente} onChange={e=>setCruzarCliente(e.target.checked)} style={{accentColor:C.accent,width:15,height:15}}/>
          Cruzar con la ficha de <span style={{color:C.azulInfo,fontWeight:600,margin:'0 3px'}}>{cliObj.name}</span> (ventas, áreas, por cobrar)
        </label>
      )}
      {cliObj&&(cliDocSel&&cliDocTxt
        ? <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,color:C.normal,margin:'0 2px 10px'}}><span>Con documento del cliente: <b>{cliDocSel.name}</b></span><button type='button' onClick={()=>{setCliDocSel(null);setCliDocTxt('')}} style={{fontSize:10,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>Quitar</button></div>
        : <div style={{margin:'0 2px 10px'}}>
            <button type='button' onClick={()=>setMostrarDocCli(v=>!v)} style={{fontSize:12,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>{mostrarDocCli?'Ocultar documentos':`+ Traer un documento de ${cliObj.name}`}</button>
            {cliDocBusy&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Leyendo el documento…</div>}
            {cliDocErr&&<div style={{fontSize:11,color:C.overdueText,marginTop:6}}>{cliDocErr}</div>}
            {mostrarDocCli&&!cliDocBusy&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 10px',marginTop:6}}><DocumentosDrive client={cliObj} onPick={usarDocCliente}/></div>}
          </div>
      )}
      {SII_TIPOS.includes(tipo)&&siiNov.length>0&&(
        <label style={{display:'flex',alignItems:'center',gap:7,fontSize:12,color:C.muted,margin:'0 2px 10px',cursor:'pointer'}}>
          <input type='checkbox' checked={cruzarSii} onChange={e=>setCruzarSii(e.target.checked)} style={{accentColor:C.accent,width:15,height:15}}/>
          Cruzar con el radar SII de la oficina <span style={{color:C.azulInfo,fontWeight:600}}>({siiNov.length} novedades vigentes)</span>
        </label>
      )}
      {PREC_FOLDERS[tipo]&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 10px',margin:'0 0 10px'}}>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <input value={precKw} onChange={e=>setPrecKw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();buscarPrec()}}} placeholder='Precedentes en tu Drive (cliente, tema…)' style={{...inp,flex:1,padding:'6px 9px',fontSize:12,marginBottom:0}}/>
            <button type='button' onClick={buscarPrec} disabled={precBusy} style={{fontSize:12,fontWeight:600,color:'#fff',background:precBusy?C.done:C.muted,border:'none',borderRadius:8,padding:'7px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{precBusy?'Buscando…':'Buscar'}</button>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:5}}>
            <span style={{fontSize:10,color:C.muted}}>{precFromIndex?'desde tu índice':precFiles?'búsqueda en vivo':''}</span>
            <button type='button' onClick={indexarPrecedentes} disabled={idxBusy} style={{fontSize:10,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>{idxBusy?'Indexando…':'↻ Indexar Drive'}</button>
          </div>
          {idxMsg&&<div style={{fontSize:10,color:C.normal,marginTop:3}}>{idxMsg}</div>}
          {precNeedAuth&&<div style={{fontSize:11,color:C.text,marginTop:7,background:C.ambarBg,borderRadius:8,padding:'7px 9px',lineHeight:1.4}}>Tu acceso a Drive expiró. <button type='button' onClick={reconectarDrive} style={{fontSize:11,fontWeight:700,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>Reconectar Drive</button> <span style={{color:C.muted}}>— te lleva a Google y vuelve; guardamos lo que escribiste.</span></div>}
          {precErr&&<div style={{fontSize:11,color:C.overdueText,marginTop:6}}>{precErr}</div>}
          {precFiles&&precFiles.length===0&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Sin resultados en la carpeta.</div>}
          {precFiles&&precFiles.length>0&&(
            <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:170,overflowY:'auto',marginTop:7}}>
              {precFiles.map(f=>{ const sel=precSel&&precSel.id===f.id; return (
                <button key={f.id} type='button' onClick={()=>elegirPrec(f)} disabled={precReading} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 9px',borderRadius:8,border:`1px solid ${sel?C.accent:C.border}`,background:sel?C.azulBg:'#fff',cursor:'pointer',textAlign:'left'}}>
                  <span style={{fontSize:12,fontWeight:sel?700:500,color:sel?C.accent:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{sel?<><Gl n='tick'/>{" "}</>:''}{f.name}</span>
                  <span style={{fontSize:10,color:C.muted,flexShrink:0}}>{fmtFechaDMY(isoLocal(f.modifiedTime))}</span>
                </button>
              )})}
            </div>
          )}
          {precReading&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Leyendo el documento…</div>}
          {precSel&&precTxt&&!precReading&&<div style={{fontSize:11,color:C.normal,marginTop:6}}>Usando de base: <b>{precSel.name}</b></div>}
        </div>
      )}
      {tipo==='clausula'&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 10px',margin:'0 0 10px'}}>
          <div style={{display:'flex',gap:6,marginBottom:8}}>
            {[['usar','Usar guardadas'],['extraer','Extraer de un documento']].map(([k,l])=>(<button key={k} type='button' onClick={()=>setClauMode(k)} style={{fontSize:12,fontWeight:600,padding:'4px 10px',borderRadius:8,border:`1px solid ${clauMode===k?C.accent:C.border}`,background:clauMode===k?C.azulBg:'#fff',color:clauMode===k?C.accent:C.muted,cursor:'pointer'}}>{l}</button>))}
          </div>
          {clauMode==='usar'?(
            <>
              <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:7}}>
                {['',...CATS_CLAUSULA].map(cat=>(<button key={cat||'todas'} type='button' onClick={()=>setClauCat(cat)} style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,border:`1px solid ${clauCat===cat?C.accent:C.border}`,background:clauCat===cat?C.azulBg:'#fff',color:clauCat===cat?C.accent:C.muted,cursor:'pointer'}}>{cat||'Todas'}</button>))}
              </div>
              <input value={clauKw} onChange={e=>setClauKw(e.target.value)} placeholder='Buscar en tus cláusulas…' style={{...inp,padding:'6px 9px',fontSize:12,marginBottom:7}}/>
              {clauLib===null?<div style={{fontSize:11,color:C.muted}}>Cargando…</div>:(()=>{ const f=(clauLib||[]).filter(c=>(!clauCat||c.categoria===clauCat)&&(!clauKw.trim()||((c.titulo||'')+' '+(c.texto||'')).toLowerCase().includes(clauKw.toLowerCase()))); return f.length?(
                <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:200,overflowY:'auto'}}>{f.slice(0,40).map(c=>{ const sel=precSel&&precSel.name===c.titulo; return (
                  <button key={c.id} type='button' onClick={()=>usarClausula(c)} style={{textAlign:'left',padding:'6px 9px',borderRadius:8,border:`1px solid ${sel?C.accent:C.border}`,background:sel?C.azulBg:'#fff',cursor:'pointer'}}>
                    <div style={{fontSize:12,fontWeight:600,color:sel?C.accent:C.text}}>{sel?<><Gl n='tick'/>{" "}</>:''}{c.titulo} <span style={{fontSize:9,fontWeight:600,color:C.muted}}>· {c.categoria}</span></div>
                    <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.texto}</div>
                  </button>)})}</div>
              ):<div style={{fontSize:11,color:C.muted}}>Sin cláusulas guardadas{clauCat?` en ${clauCat}`:''}. Usa "Extraer de un documento".</div> })()}
            </>
          ):(
            <>
              <div style={{display:'flex',gap:6}}>
                <input value={clauKw} onChange={e=>setClauKw(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();buscarDocClausula()}}} placeholder='Documento del Drive (cliente, materia…)' style={{...inp,flex:1,padding:'6px 9px',fontSize:12,marginBottom:0}}/>
                <button type='button' onClick={buscarDocClausula} disabled={clauBusy} style={{fontSize:12,fontWeight:600,color:'#fff',background:clauBusy?C.done:C.muted,border:'none',borderRadius:8,padding:'7px 11px',cursor:'pointer'}}>{clauBusy?'…':'Buscar'}</button>
              </div>
              {clauDocs&&clauDocs.length>0&&<div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:170,overflowY:'auto',marginTop:7}}>{clauDocs.map(f=>(
                <div key={f.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 9px',borderRadius:8,border:`1px solid ${C.border}`}}>
                  <span style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  <button type='button' onClick={()=>extraerClausulas(f)} disabled={!!extrBusy} style={{fontSize:10,fontWeight:700,color:C.accent,background:'none',border:`1px solid ${C.accent}`,borderRadius:6,padding:'3px 8px',cursor:'pointer',whiteSpace:'nowrap'}}>{extrBusy===f.id?'Extrayendo…':'Extraer'}</button>
                </div>))}</div>}
              {clauDocs&&clauDocs.length===0&&<div style={{fontSize:11,color:C.muted,marginTop:6}}>Sin resultados.</div>}
              {extrMsg&&<div style={{fontSize:10,color:C.normal,marginTop:6}}>{extrMsg}</div>}
            </>
          )}
          {precNeedAuth&&<div style={{fontSize:11,color:C.text,marginTop:7,background:C.ambarBg,borderRadius:8,padding:'7px 9px',lineHeight:1.4}}>Tu acceso a Drive expiró. <button type='button' onClick={reconectarDrive} style={{fontSize:11,fontWeight:700,color:C.accent,background:'none',border:'none',cursor:'pointer',padding:0,textDecoration:'underline'}}>Reconectar Drive</button></div>}
          {precErr&&<div style={{fontSize:11,color:C.overdueText,marginTop:6}}>{precErr}</div>}
          {precSel&&precTxt&&clauMode==='usar'&&<div style={{fontSize:11,color:C.normal,marginTop:6}}>Redactando sobre: <b>{precSel.name}</b></div>}
        </div>
      )}
      <button onClick={generar} disabled={loading||!datos.trim()} style={{width:'100%',height:44,background:(loading||!datos.trim())?C.done:C.accent,color:'#fff',border:'none',borderRadius:10,fontSize:13,fontWeight:600,cursor:(loading||!datos.trim())?'default':'pointer'}}>{loading?'Redactando…':<><Sparkle/> Generar borrador</>}</button>
      {err&&<div style={{fontSize:11,color:C.overdueText,marginTop:8}}>{err}</div>}
    </div>
    <div style={isDesk?{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:12}:{marginTop:14,display:'flex',flexDirection:'column',gap:12}}>
      {!draft&&isDesk&&<div style={{border:`1px dashed ${C.border}`,borderRadius:12,padding:'40px 20px',textAlign:'center',fontSize:12.5,color:C.muted}}>{loading?'Redactando…':'El borrador aparece aquí. Tú validas y editas antes de usarlo.'}</div>}
      {draft&&<div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
          <span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.4}}>Borrador · edítalo</span>
          <div style={{display:'flex',gap:8}}>
            <button onClick={generar} disabled={loading} style={{fontSize:11,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>Regenerar</button>
            {tipo==='presentacion'&&<button onClick={descargarPPTX} style={{fontSize:11,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>PPTX</button>}
            <button onClick={descargarWord} style={{fontSize:11,color:C.muted,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'3px 9px',cursor:'pointer'}}>Word</button>
            <button onClick={copiar} style={{fontSize:11,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'3px 11px',cursor:'pointer'}}>{copiado?<>Copiado{" "}<Gl n='tick'/></>:'Copiar'}</button>
          </div>
        </div>
        <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={isDesk?26:16} style={{...inp,resize:'vertical',fontSize:13,lineHeight:1.5}}/>
        {cliFolder&&<div style={{marginTop:8,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <button type='button' onClick={guardarEnDrive} disabled={guardando} style={{fontSize:11,fontWeight:600,color:'#fff',background:guardando?C.done:C.accent,border:'none',borderRadius:8,padding:'5px 11px',cursor:guardando?'default':'pointer'}}>{guardando?'Guardando…':`Guardar en la carpeta de ${cliFolder.name}`}</button>
          {guardadoUrl&&<a href={guardadoUrl} target='_blank' rel='noopener' style={{fontSize:11,color:C.normal,fontWeight:600}}>Guardado <Gl n='tick'/> · abrir en Drive</a>}
          {guardadoErr&&<span style={{fontSize:11,color:C.overdueText}}>{guardadoErr}</span>}
        </div>}
      </div>}
      <BitacoraLista prefijo='redaccion.' titulo='Redactados' etiquetas={{'redaccion.generado':'Borrador generado','redaccion.word':'Descargado en Word','redaccion.pptx':'Descargado en PPTX','redaccion.drive':'Guardado en el Drive del cliente'}} limite={8}/>
    </div>
    </div>
  )
}

