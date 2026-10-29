// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabase'
import { C, Gl, SEC_LBL, SIcon, Spin, _normTxt, appAlert, fmt, fmtFechaDMY, fmtRutCL, personChip, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, Buscador, DriveIcon, TH_BAND, UF_FALLBACK, abrirDocumento, cargarPdfjs, claudeCall, cobradoBill, comisionesVenta, currentYear, driveGet, driveToken, esRecurrente, esSubarriendo, estadoCobro, fmtShort, fmtUF, fmtUFk, montoFactura, rsDisplay, rsLabel, useUF, ventaCLP, ventaCuentaEnAnio, ventaUF, viewMemGuardar, viewMemLeer, registrarError } from '../lib/compartido.jsx'

// Reconoce a qué cliente EXISTENTE apunta una propuesta (por el nombre del archivo de Drive). SOLO enlaza, NUNCA crea
// (anti-duplicados / "no inventar datos"). Mira nombres de clientes y razones sociales (client_entities). Match conservador:
// TODOS los tokens (≥3 letras) del nombre/RS deben aparecer en el archivo, y el nombre ≥5 chars. Sin match claro → null
// (el borrador queda "cliente por confirmar", nunca se adivina). Prefiere el match más específico (etiqueta más larga).
export function matchClientePropuesta(fileName, clients=[], clientEntities=[]){
  const f=_normTxt(fileName); if(!f) return null
  const has=nm=>{ const n=_normTxt(nm); if(n.length<5) return false; const t=n.split(' ').filter(w=>w.length>=3); return t.length>=1 && t.every(w=>f.includes(w)) }
  let best=null
  const consider=(client_id,entity_id,label)=>{ if(!client_id||!label||!has(label)) return; const score=_normTxt(label).length; if(!best||score>best.score) best={client_id,entity_id:entity_id||null,via:label,score} }
  for(const e of (clientEntities||[])) consider(e?.client_id, e?.id, e?.name)        // razón social (más específico)
  for(const c of (clients||[])){ if(c?.deleted_at||c?.is_internal) continue; consider(c?.id, null, c?.name) }
  return best?{client_id:best.client_id, entity_id:best.entity_id, via:best.via}:null
}

// Tokens distintivos del nombre de archivo de una propuesta (para aprender/consultar alias cliente). Excluye palabras genéricas, fechas y versiones.
export const _PROP_STOP = new Set(['propuesta','propuestas','honorarios','honorario','final','finales','borrador','draft','version','pdf','para','con','del','los','las','una','uno','nuevo','nueva'])

export const _propTokens = s => _normTxt(String(s).replace(/\.[a-z0-9]{2,5}$/i,'').replace(/\bv\d+\b/ig,' ')).split(/[\s_\-]+/).filter(w=>w.length>=3 && w.length<=12 && !/^\d+$/.test(w) && !w.includes('.') && !_PROP_STOP.has(w))

// Prompt único para leer una propuesta (PDF) con IA y extraer sus datos. NO inventa (usa "" o null). Se usa al
// ingerir borradores desde Drive; devuelve SOLO JSON.
export const PROMPT_PROPUESTA_IA = `Eres un experto extractor de datos de propuestas y contratos de servicios legales en Chile. Lee TODO el documento y devuelve SOLO un JSON (sin markdown ni backticks) con estos campos. Reglas:
- Si un dato no está explícito pero se infiere con certeza, infiérelo; si no, usa "" o null. NO inventes.
- cliente_nombre: cliente/contraparte a quien se dirige la propuesta (persona o empresa).
- cliente_rut: RUT chileno formato 12.345.678-9 si aparece.
- razon_social: razón social facturable si difiere del nombre del cliente.
- area: área legal (Corporativo, Tributario, Laboral, Litigios, Inmobiliario, etc.).
- proyecto: nombre CORTO y general del encargo, 2 a 5 palabras (ej. "Recuperación de IVA exportador", "Reorganización societaria", "Juicio laboral", "Asesoría tributaria permanente"). NO una descripción larga ni una frase: solo el asunto, como lo llamaría el estudio internamente.
- moneda: "UF" o "CLP" según en qué se expresan los honorarios.
- honorario_total: monto total SOLO como número (sin símbolos ni separadores de miles; punto decimal si hay decimales).
- notas: condiciones relevantes (reajuste, vigencia, gastos, IVA, hitos, forma de cobro).
Devuelve: { cliente_nombre, cliente_rut, razon_social, area, proyecto, moneda, honorario_total, notas }`

export const AreaChip = ({area}) => {
  const bg={Corporativo:C.azulBg,Tributario:'#F2E9DE',Laboral:'#F2E9DE',Otro:C.bgSoft}
  if(!area) return null
  return <span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,background:bg[area]||C.bgSoft,color:C.muted,fontWeight:700,whiteSpace:'nowrap'}}>{area}</span>
}

export const Pill = ({label,bg,color,small}) => <span style={{display:'inline-block',padding:small?'1px 7px':'2px 9px',borderRadius:20,fontSize:small?10:11,fontWeight:600,color:color||'#fff',background:bg||C.accent,whiteSpace:'nowrap'}}>{label}</span>

export function SalesView({sales,clients,clientEntities=[],billing=[],terceros=[],onEdit,onAdd,onAddPropuesta,onRechazar,onActivar,onOpenClientFicha,onIngestPropuesta,onAprobarPropuesta,onDevolverPropuesta}) {
  const isDesktop = useIsDesktop()   // Fase 3: columna centrada más ancha en escritorio
  const _vmV = viewMemLeer('ventas')   // volver al lugar exacto tras abrir una venta/factura (página)
  const [fYear,setFYear] = useState(_vmV?.fYear??String(currentYear))
  const [fArea,setFArea] = useState(_vmV?.fArea||'')
  const [q,setQ] = useState(_vmV?.q||'')
  const [hubView,setHubView] = useState(_vmV?.hubView??null)               // null = solo tarjetas · 'vendido' = filtros + desglose · 'propuestas' = lista de propuestas
  const [estSel,setEstSel] = useState(()=>new Set(_vmV?.est||['Activo','Terminado']))   // filtro de estado MULTI-selección (afecta Vendido + desglose)
  const [abogSel,setAbogSel] = useState(()=>new Set(_vmV?.abog||[]))      // filtro de abogado multi (vacío = todos)
  const [openF,setOpenF] = useState(null)                   // desplegable de filtro abierto: 'estado' | 'abogado' | null
  const toggleSet = (setter,val)=>setter(prev=>{ const n=new Set(prev); n.has(val)?n.delete(val):n.add(val); return n })
  const ufState = useUF()
  const ufHoy = ufState.uf
  const ufRef = ufHoy || sales.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  // Atribución de abogado (FUENTE ÚNICA, igual que Inteligencia/ProyeccionDetalle.respDe): la venta manda; si no tiene, el abogado del cliente. Toda venta debería tener responsible (se exige al guardar), este fallback es el blindaje.
  const abogDeCliente = useMemo(()=>Object.fromEntries((clients||[]).map(c=>[String(c.id), c.abogado_responsable||null])),[clients])
  const respVenta = s => s.responsible || abogDeCliente[String(s.client_id)] || 'Sin abogado'
  const porHoras = s => s.cobro_type==='hora'   // se cobra por horas: sin monto fijo es lo esperable (no '0')
  // Búsqueda libre: por título de venta o nombre de cliente (respeta año/área). Solo se usa cuando hay texto.
  const filtered = useMemo(()=>{
    if(!q.trim()) return []
    const t=_normTxt(q), rq=String(q).replace(/[^0-9kK]/g,'').toUpperCase(), nr=x=>String(x||'').replace(/[^0-9kK]/g,'').toUpperCase()
    let r = sales.filter(s=>{ if(esSubarriendo(s)) return false; const cli=clients.find(c=>String(c.id)===String(s.client_id)); const ents=(clientEntities||[]).filter(e=>String(e.client_id)===String(s.client_id))
      if(_normTxt(s.title).includes(t)||_normTxt(cli?.name).includes(t)||ents.some(e=>_normTxt(e.name).includes(t))) return true
      return rq.length>=3 && [cli?.rut,...ents.map(e=>e.rut)].some(x=>nr(x).includes(rq)) })
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r.sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))
  },[sales,clients,clientEntities,q,fYear,fArea])
  // Encabezado "Vendido del año" = Activo + Terminado del año seleccionado (mismo universo que el Dashboard), independiente del filtro de la lista. UF por defecto, toca para CLP.
  const [montoUF,setMontoUF] = useState(_vmV?.montoUF??true)
  const yearSales = sales.filter(s=> !esSubarriendo(s) && (!fYear || ventaCuentaEnAnio(s,fYear)) && (!fArea || s.area===fArea))
  const actYr = yearSales.filter(s=>s.status==='Activo')
  const termYr = yearSales.filter(s=>s.status==='Terminado')
  const sumUF = arr=>arr.reduce((a,s)=>a+ventaUF(s,ufRef),0)
  const sumCLP = arr=>Math.round(arr.reduce((a,s)=>a+ventaCLP(s,ufRef),0))
  // "Vendido" = ventas del año/área con estado dentro del filtro multi (por defecto Activo+Terminado) y abogado dentro del filtro (vacío = todos). El desglose suma exacto a este total.
  const vendSrc = yearSales.filter(s=> estSel.has(s.status) && (abogSel.size===0 || abogSel.has(respVenta(s))))
  const vendUF=sumUF(vendSrc), vendCLP=sumCLP(vendSrc)
  const comDe = s => comisionesVenta(s,terceros,billing,ufRef).anual
  const comUFde = s => { const u=parseFloat(s.uf_value)||ufRef; return u>0 ? comDe(s)/u : 0 }   // UF de la propia venta (igual que su ficha)
  const vendCom = vendSrc.reduce((a,s)=>a+comDe(s),0), vendComUF = vendSrc.reduce((a,s)=>a+comUFde(s),0)
  const netoUF = vendUF - vendComUF, netoCLP = vendCLP - vendCom
  const fmtMonto = (uf,clp)=> montoUF ? fmtUFk(uf) : fmtShort(clp)
  const ESTADOS = ['Activo','Terminado','Pausado','Propuesta','Borrador','Rechazada']
  const abogados = [...new Set(sales.filter(s=>!esSubarriendo(s)).map(respVenta))].filter(a=>a&&a!=='Sin abogado')
  const years = [...new Set(sales.map(s=>s.year).filter(Boolean))].sort((a,b)=>b-a)
  if(!years.includes(currentYear)) years.unshift(currentYear)

  // Pipeline KPIs (Propuestas) — SIEMPRE todos los años (el pipeline no depende del año seleccionado): tile = total global,
  // y el panel "Esperando aprobación" agrupa por año. Mantiene el filtro de área si está activo.
  const propuestasFiltradas = useMemo(()=>{
    let r = sales.filter(s=>s.status==='Propuesta')
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r
  },[sales,fArea])
  // Borradores = propuestas cargadas desde Drive (por completar). Se muestran junto a las Propuestas en el hub.
  const borradoresFiltrados = useMemo(()=>{
    let r = sales.filter(s=>s.status==='Borrador')
    if(fYear) r = r.filter(s=>String(s.year)===fYear)
    if(fArea) r = r.filter(s=>s.area===fArea)
    return r.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))
  },[sales,fYear,fArea])
  // Ingesta de propuestas desde la carpeta compartida de Drive (solo PDF, último mes). Dedup por learnings propuesta_drive.
  const [drvLoad,setDrvLoad]=useState(false)
  const [drvFiles,setDrvFiles]=useState(null)   // null = aún no buscado
  const [drvErr,setDrvErr]=useState('')
  const [drvDone,setDrvDone]=useState({})        // file_id → sale_id ya registrados
  const [drvAlias,setDrvAlias]=useState({})      // token normalizado del archivo → client_id (aprendido: learnings propuesta_alias). Ej: "vkh" → Luis Silva.
  const [drvBusy,setDrvBusy]=useState(null)
  // Match del PDF a cliente: primero por nombre/razón social (matchClientePropuesta); si no, por alias aprendido (un token del archivo → cliente).
  const matchCli = (fileName)=>{ const direct=matchClientePropuesta(fileName, clients, clientEntities); if(direct) return direct; for(const t of _propTokens(fileName)){ const cid=drvAlias[t]; if(cid&&clients.some(c=>String(c.id)===String(cid))) return {client_id:cid, entity_id:null, via:t} } return null }
  // Dedup fuerte: no re-ofrecer un PDF de Drive cuyo cliente YA tiene una propuesta o venta cargada (no rechazada ni borrador).
  // Así no se proponen propuestas ya cargadas como propuesta ni ya aceptadas (activas/terminadas).
  const clientesConPropuestaOVenta = useMemo(()=> new Set((sales||[]).filter(s=>s.client_id&&!['Rechazada','Borrador'].includes(s.status)).map(s=>String(s.client_id))), [sales])
  const propuestaYaCargada = (file)=>{ const m=matchCli(file?.name||''); return !!(m && clientesConPropuestaOVenta.has(String(m.client_id))) }
  const cargarDrive=async()=>{
    setDrvLoad(true); setDrvErr('')
    try{
      const token=await driveToken()
      const PROP='1MQg9_q0l20mjB-LftuYQywTE4T81Kxf3'   // carpeta compartida de propuestas (misma que el formulario)
      const cutoff=new Date(Date.now()-31*24*60*60*1000).toISOString()
      const q=encodeURIComponent(`'${PROP}' in parents and modifiedTime>'${cutoff}' and trashed=false and mimeType='application/pdf'`)
      const data=await driveGet(token,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,webViewLink,size)&orderBy=modifiedTime+desc&pageSize=100`)
      setDrvFiles(data.files||[])
      try{ const {data:al}=await supabase.from('learnings').select('key,value').eq('kind','propuesta_drive'); const m={}; (al||[]).forEach(r=>{m[r.key]=r.value}); setDrvDone(m) }catch(_){}
      try{ const {data:aa}=await supabase.from('learnings').select('key,value').eq('kind','propuesta_alias'); const am={}; (aa||[]).forEach(r=>{ if(r.key&&r.value) am[r.key]=r.value }); setDrvAlias(am) }catch(_){}
    }catch(e){ const m=String(e?.message||''); setDrvErr(/auth|token|drive_auth|401|conex/i.test(m)?'No pude leer la carpeta de Drive — revisa que Drive esté conectado (menú → Conectar Drive).':('No se pudo leer la carpeta de Drive: '+(m||'error'))) }
    setDrvLoad(false)
  }
  const registrarDrive=async(file)=>{
    if(drvDone[file.id]||drvBusy) return
    setDrvBusy(file.id)
    let info=null
    // Leer el PDF con IA para llenar el borrador (título/área/monto/cliente). NO inventa: cliente solo si ya existe.
    try{
      const token=await driveToken()
      const r=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,{headers:{Authorization:'Bearer '+token}})
      if(r.ok){
        const buf=new Uint8Array(await r.arrayBuffer())
        const pdf=await (await cargarPdfjs()).getDocument({data:buf}).promise
        let text=''
        for(let i=1;i<=pdf.numPages;i++){ const pg=await pdf.getPage(i); const c=await pg.getTextContent(); text+=c.items.map(it=>it.str||'').join(' ')+'\n' }
        if(text.trim()){
          const apiData=await claudeCall({model:'claude-sonnet-4-6',max_tokens:2000,system:PROMPT_PROPUESTA_IA,messages:[{role:'user',content:text.slice(0,40000)}]})
          const raw=(apiData.content?.[0]?.text||'{}').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
          const p=JSON.parse(raw)
          // Cliente SOLO si ya existe (nunca crear): por RUT, luego por nombre exacto, luego el matcher por archivo.
          const rutN=(p.cliente_rut||'').replace(/[.\-]/g,'').trim()
          let cli=null
          if(rutN) cli=clients.find(c=>(c.rut||'').replace(/[.\-]/g,'')===rutN)
          if(!cli && p.cliente_nombre){ const nn=_normTxt(p.cliente_nombre); if(nn) cli=clients.find(c=>_normTxt(c.name)===nn) }
          const m2 = cli?{client_id:cli.id,entity_id:null} : matchClientePropuesta(p.cliente_nombre||file.name, clients, clientEntities)
          const num=parseFloat(String(p.honorario_total||'').toString().replace(/[^\d.]/g,''))
          const esUF=String(p.moneda||'').toUpperCase()==='UF'
          info={ title:(p.proyecto||'').trim()||undefined, area:p.area||null,
            amount_uf: esUF&&num?num:null, amount_clp: (!esUF&&num)?Math.round(num):null, moneda: esUF?'UF':(num?'CLP':null),
            client_id:m2?.client_id||null, entity_id:m2?.entity_id||null, notas:p.notas||null }
        }
      }
    }catch(_){ info=null }   // si la IA/Drive falla, cae al borrador simple (matcher por nombre de archivo)
    const m0 = info || matchClientePropuesta(file.name, clients, clientEntities)
    const saved=await onIngestPropuesta?.(file, m0)
    if(saved){ setDrvDone(d=>({...d,[file.id]:saved.id}))
      // Aprende alias: si el PDF se resolvió a un cliente que el NOMBRE DEL ARCHIVO solo no reconocía, guarda sus tokens cortos → cliente (ej. "vkh" → Luis Silva), para no volver a mostrarlo ni pedir confirmar.
      const cid = m0?.client_id || saved?.client_id
      if(cid){ const direct=matchClientePropuesta(file.name, clients, clientEntities)
        if(!direct || String(direct.client_id)!==String(cid)){ const toks=_propTokens(file.name).filter(t=>t.length<=6)
          for(const t of toks){ try{ const {data:ex}=await supabase.from('learnings').select('id').eq('kind','propuesta_alias').eq('key',t).order('updated_at',{ascending:false}).limit(1); if(!(ex&&ex.length)) await supabase.from('learnings').insert({kind:'propuesta_alias',key:t,value:String(cid)}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
          if(toks.length) setDrvAlias(a=>{ const n={...a}; toks.forEach(t=>{ if(!n[t]) n[t]=String(cid) }); return n }) } } }
    setDrvBusy(null)
  }
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

  const statusPillBg = st => st==='Activo'?C.accent:st==='Propuesta'?C.muted:st==='Borrador'?'#E8CC6A':st==='Rechazada'?C.overdue:st==='Terminado'?C.done:C.soon
  const statusPillColor = st => st==='Borrador'?'#4A3800':undefined
  const areaIcon = a => ({Corporativo:'building',Tributario:'file',Laboral:'users'}[a]||'briefcase')

  // Agrupación de la lista: tiles por Abogado o Área (alternable). Buscar muestra resultados planos (sin agrupar).
  const [groupBy,setGroupBy] = useState(_vmV?.groupBy||'abogado')
  const [selGroup,setSelGroup] = useState(_vmV?.selGroup??null)
  const [verTodasV,setVerTodasV] = useState(false)   // "ver todas" en el drill del grupo (evita scroll eterno)
  const [openYearV,setOpenYearV] = useState(null)     // año expandido en la tarjeta "Ingreso por año" (muestra sus cuotas)
  const AREA_COL = {'Tributario':'#BA7517','Corporativo':'#534AB7'}
  const colorGrupo = k => groupBy==='abogado' ? (k==='Sin abogado'?C.done:personChip(k).color) : (AREA_COL[k]||'#537281')
  const grupos = useMemo(()=>{
    // El desglose desglosa el MISMO universo que "Vendido" (estado en el filtro multi + abogado en el filtro), así suma exacto al total.
    const src = sales.filter(s=> !esSubarriendo(s) && (!fYear||ventaCuentaEnAnio(s,fYear)) && (!fArea||s.area===fArea) && estSel.has(s.status) && (abogSel.size===0||abogSel.has(respVenta(s))))
    const m={}
    src.forEach(s=>{
      const k = groupBy==='abogado' ? respVenta(s) : (s.area||'Sin área')
      if(!m[k]) m[k]={key:k,count:0,uf:0,rows:[]}
      m[k].count++; m[k].uf+=ventaUF(s,ufRef); m[k].rows.push(s)
    })
    return Object.values(m).sort((a,b)=>b.uf-a.uf)
  },[sales,fYear,fArea,groupBy,ufRef,estSel,abogSel])
  // Ingreso por año del grupo elegido: distribuye las cuotas (emitidas + programadas) de esas ventas por AÑO de VENCIMIENTO; cobrado vs por cobrar por año. Fuente única montoFactura/cobradoBill. Otro lente que "vendido" (contrato): cuándo entra la plata.
  // Proyección: se muestra hasta el año en que termina la cobranza (todas las cuotas). EXCEPCIÓN — las recurrentes (mensuales activas) se proyectan solo UN año (sus primeras 12 cuotas por vencimiento), para no arrastrar un contrato indefinido a años futuros.
  const ingresoPorAnio = rows => {
    const m={}; const listByYear={}; let sinFecha=0; const revisar=new Set()   // revisar = cuota con vencimiento ANTES del año de su venta (dato malo, ej. typo de fecha) → se muestra marcada, no se esconde
    ;(rows||[]).forEach(s=>{
      let cuotas = (billing||[]).filter(b=> b && !b.deleted_at && String(b.sale_id)===String(s.id) && b.status!=='Anulada' && !['reembolso','nota_credito'].includes(b.billing_type))
      cuotas = cuotas.sort((a,b)=>String(a.due||'').localeCompare(String(b.due||'')))
      if(esRecurrente(s)) cuotas = cuotas.slice(0,12)   // recurrente = un año (12 cuotas)
      cuotas.forEach(b=>{ const y=b.due?String(b.due).slice(0,4):null; const monto=montoFactura(b); if(!y){ sinFecha+=monto; return } const anom=s.year&&Number(y)<Number(s.year); if(anom) revisar.add(String(b.id)); if(!m[y]) m[y]={monto:0,cobrado:0,revisar:false}; m[y].monto+=monto; m[y].cobrado+=cobradoBill(b); if(anom) m[y].revisar=true; (listByYear[y]=listByYear[y]||[]).push(b) })
    })
    const years = Object.keys(m).sort()
    const total = years.reduce((a,y)=>a+m[y].monto,0)
    const nCuotas = years.reduce((a,y)=>a+(listByYear[y]?.length||0),0)
    return {m,years,total,sinFecha,listByYear,nCuotas,revisar}
  }
  // Lista del Vendido = el MISMO universo que el desglose (suma exacta al total). Orden de la tabla: monto (desc) por defecto.
  const listaVendido = useMemo(()=>grupos.flatMap(g=>g.rows),[grupos])
  const [ordV,setOrdV] = useState(_vmV?.ordV||{k:'monto',dir:-1})
  useEffect(()=>{ viewMemGuardar('ventas',{fYear,fArea,q,hubView,est:[...estSel],abog:[...abogSel],montoUF,groupBy,selGroup,ordV}) },[fYear,fArea,q,hubView,estSel,abogSel,montoUF,groupBy,selGroup,ordV])
  const valV = (s,k) => k==='venta'?(s.title||''):k==='resp'?respVenta(s):ventaUF(s,ufRef)
  const ordenarVentas = rows => [...rows].sort((a,b)=>{ const va=valV(a,ordV.k), vb=valV(b,ordV.k); const r=typeof va==='string'?va.localeCompare(vb,'es'):(va-vb); return (r*ordV.dir)||(a.title||'').localeCompare(b.title||'','es') })
  const exportarVentas = async rows => {
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const head=['Venta','Cliente','Razón social','RUT','Responsable','Área','Año','Mes','Estado','Forma de cobro','UF','$']
      const data=rows.map(s=>{ const cli=clients.find(c=>String(c.id)===String(s.client_id)); const rs=rsLabel(s.client_id,clients,clientEntities,s.entity_id); return [s.title||'', cli?.name||'', rs.name||'', rs.rut||cli?.rut||'', respVenta(s), s.area||'', s.year||'', s.month||'', s.status||'', porHoras(s)?'por horas':(esRecurrente(s)?'mensual':(s.cobro_type||'')), Math.round(ventaUF(s,ufRef)*100)/100, Math.round(ventaCLP(s,ufRef))] })
      const ws=XLSX.utils.aoa_to_sheet([head,...data]); ws['!cols']=[{wch:38},{wch:30},{wch:30},{wch:14},{wch:13},{wch:13},{wch:6},{wch:5},{wch:10},{wch:13},{wch:10},{wch:14}]; ws['!autofilter']={ref:`A1:L${data.length+1}`}; ws['!views']=[{state:'frozen',ySplit:1}]
      for(let r=1;r<=data.length;r++){ const u=ws[XLSX.utils.encode_cell({r,c:10})]; if(u&&u.t==='n') u.z='#,##0.00'; const m=ws[XLSX.utils.encode_cell({r,c:11})]; if(m&&m.t==='n') m.z='#,##0' }
      const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Ventas'); XLSX.writeFile(wb,`Ventas_${fYear||'todas'}_${new Date().toISOString().slice(0,10)}.xlsx`)
    }catch(e){ appAlert('No se pudo generar el Excel: '+e.message) }
  }
  // Escritorio: tabla ordenable (venta con su cliente · responsable · mes · monto) con total = suma de las filas.
  const tablaVentas = (rows,tUF,tCLP) => { const COLS='minmax(0,1fr) 104px 116px 104px 124px 12px'
    const comT=rows.reduce((a,s)=>a+comDe(s),0), comTUF=rows.reduce((a,s)=>a+comUFde(s),0)
    const hc=(k,l,right)=>{ const on=ordV.k===k; return <span onClick={()=>setOrdV(o=>o.k===k?{k,dir:-o.dir}:{k,dir:k==='monto'?-1:1})} style={{cursor:'pointer',userSelect:'none',textAlign:right?'right':'left',color:on?C.accent:C.muted}}>{l}{on?(ordV.dir===1?<>{" "}<Gl n='chevU'/></>:<>{" "}<Gl n='chevD'/></>):''}</span> }
    const vis=verTodasV?rows:rows.slice(0,25)
    return (<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,padding:'8px 14px',...TH_BAND}}>{hc('venta','Venta · cliente')}{hc('resp','Responsable')}{hc('monto','Monto',1)}<span style={{textAlign:'right',color:C.muted}}>Terceros</span><span style={{textAlign:'right',color:C.muted}}>Neto oficina</span><span/></div>
      {vis.map(s=>{ const cli=clients.find(c=>String(c.id)===String(s.client_id)); const rp=respVenta(s); const pc=rp&&rp!=='Sin abogado'?personChip(rp):null; const ufA=ventaUF(s,ufRef), clpA=ventaCLP(s,ufRef), com=comDe(s), comUF=comUFde(s)
        return (<div key={s.id} onClick={()=>onEdit(s)} className='lf-row' style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',fontSize:12.5}}>
          <div style={{minWidth:0}}>
            <div style={{fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title||'—'}</div>
            <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}><span onClick={cli&&onOpenClientFicha?(ev)=>{ev.stopPropagation();onOpenClientFicha(cli.id)}:undefined} title={cli?'Ver ficha del cliente':undefined} style={{color:C.accent,cursor:cli?'pointer':'default'}}>{cli?.name||'—'}</span>{s.year?` · ${s.month?String(s.month).padStart(2,'0')+'-':''}${s.year}`:''}</div>
          </div>
          <span>{pc?<span style={{fontSize:9.5,fontWeight:700,color:pc.color,background:pc.bg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{rp}</span>:<span style={{color:C.textSoft}}>—</span>}</span>
          <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:700,color:C.text}}>{(ufA>0||clpA>0)?<>{fmtMonto(ufA,clpA)}{esRecurrente(s)?<span style={{fontSize:9,fontWeight:500,color:C.muted}}> /año</span>:null}</>:<span style={{fontWeight:500,color:C.muted}}>{porHoras(s)?'por horas':'—'}</span>}</span>
          <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.muted}}>{com>0?`−${fmtMonto(comUF,com)}`:'—'}</span>
          <span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',fontWeight:700,color:C.accent}}>{(ufA>0||clpA>0)?fmtMonto(ufA-comUF,clpA-com):'—'}</span>
          <SIcon n='chevron' s={12} c={C.done}/>
        </div>) })}
      {rows.length>25&&<div onClick={()=>setVerTodasV(v=>!v)} style={{padding:'8px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:11,fontWeight:700,color:C.accent,cursor:'pointer'}}>{verTodasV?'Ver menos':`+ ${rows.length-25} ventas más`}</div>}
      <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12,fontWeight:700}}>
        <span>{rows.length} venta{rows.length!==1?'s':''}</span><span/><span style={{textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtMonto(tUF,tCLP)}</span><span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.muted}}>{comT>0?`−${fmtMonto(comTUF,comT)}`:'—'}</span><span style={{textAlign:'right',fontVariantNumeric:'tabular-nums',color:C.accent}}>{fmtMonto(tUF-comTUF,tCLP-comT)}</span><span/>
      </div>
    </div>) }
  const buscando = q.trim().length>0
  // Lista plana = búsqueda (todas las coincidencias) o vista de Propuestas. El desglose (Vendido) va en 'vendido'.
  const flatView = buscando || hubView==='propuestas'
  const flatRows = buscando ? filtered : (hubView==='propuestas' ? propuestasFiltradas.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)) : [])
  const saleRow = s => {
    const ufA=ventaUF(s,ufRef), clpA=ventaCLP(s,ufRef), rec=esRecurrente(s)
    const client=clients.find(c=>String(c.id)===String(s.client_id))
    const isPropuesta = s.status==='Propuesta'
    const diasPendiente = s.created_at ? Math.floor((Date.now()-new Date(s.created_at))/86400000) : 0
    const tardio = isPropuesta && diasPendiente>14
    return (
      <div key={s.id}
        onClick={()=>onEdit(s)}
        style={{background:C.card,borderRadius:12,padding:'12px 14px',marginBottom:8,border:`1px solid ${tardio?C.soon:C.border}`,cursor:'pointer'}}
        onMouseEnter={e=>e.currentTarget.style.borderColor=tardio?C.soon:C.accent}
        onMouseLeave={e=>e.currentTarget.style.borderColor=tardio?C.soon:C.border}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:9,marginBottom:5}}>
          <SIcon n={areaIcon(s.area)} s={18} c={C.muted}/>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title}</div>
            <div onClick={client&&onOpenClientFicha?(ev)=>{ev.stopPropagation();onOpenClientFicha(client.id)}:undefined} title={client&&onOpenClientFicha?'Ver ficha del cliente':undefined} style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:client&&onOpenClientFicha?'pointer':'inherit'}}>{client?.name||'—'}</div>
            {(()=>{ const rs=rsLabel(s.client_id,clients,clientEntities,s.entity_id); return (_normTxt(rs.name)!==_normTxt(client?.name))?<div onClick={client&&onOpenClientFicha?(ev)=>{ev.stopPropagation();onOpenClientFicha(client.id)}:undefined} style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:client&&onOpenClientFicha?'pointer':'inherit'}}>{rsDisplay(rs.name)}{rs.rut?` · ${fmtRutCL(rs.rut)}`:''}</div>:null })()}
          </div>
          <div style={{textAlign:'right',flexShrink:0}}>
            {(()=>{ const com=comDe(s); if(!(com>0)||!(clpA>0)) return null
              // Con comisiones: protagonista = lo que queda para la oficina; el bruto y la comisión en gris debajo.
              const nUF=ufA>0?ufA-comUFde(s):0
              return <><div style={{fontSize:13,fontWeight:600,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{ufA>0?fmtUF(nUF):fmt(clpA-com)}{rec?<span style={{fontSize:9,fontWeight:500,color:C.muted}}> /año</span>:null}</div>
                <div style={{fontSize:10.5,color:C.muted,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{ufA>0?fmtUF(ufA):fmtShort(clpA)} − {fmtShort(com)} terceros</div></> })()}
            {!(comDe(s)>0&&clpA>0)&&<>{ufA>0&&<div style={{fontSize:13,fontWeight:600,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtUF(ufA)}{rec?<span style={{fontSize:9,fontWeight:500,color:C.muted}}> /año</span>:null}</div>}
            {clpA>0&&<div style={{fontSize:11,color:C.muted,fontVariantNumeric:'tabular-nums'}}>{fmt(clpA)}</div>}</>}
            {!(ufA>0)&&!(clpA>0)&&porHoras(s)&&<div style={{fontSize:12,color:C.muted}}>por horas</div>}
          </div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <AreaChip area={s.area}/>
          {groupBy==='abogado'&&(()=>{ const rp=respVenta(s); if(!rp||rp==='Sin abogado') return null; const pc=personChip(rp); return <span style={{fontSize:11,color:pc.color,fontWeight:700}}>{rp}</span> })()}
          <span style={{fontSize:10,color:C.muted}}>{s.year}{s.month?' · '+String(s.month).padStart(2,'0'):''}</span>
          {isPropuesta&&<span style={{fontSize:10,color:tardio?C.soonText:C.muted,fontWeight:tardio?700:400}}>{diasPendiente} día{diasPendiente!==1?'s':''} esperando</span>}
          {isPropuesta&&s.aprobacion==='pendiente'&&<span style={{fontSize:10.5,fontWeight:700,color:personChip(s.propuesta_de||'').color||C.accent,background:personChip(s.propuesta_de||'').bg||C.azulBg,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{s.propuesta_de||'Equipo'} · por aprobar</span>}
          {isPropuesta&&s.cobro_config?.propuesta_pdf&&<span onClick={e=>{e.stopPropagation();abrirDocumento(s.cobro_config.propuesta_pdf)}} style={{fontSize:11,fontWeight:700,color:C.accent,cursor:'pointer'}}>Ver propuesta</span>}
          {isPropuesta&&s.aprobacion==='pendiente'
            ? <span style={{marginLeft:'auto',display:'flex',gap:6}} onClick={e=>e.stopPropagation()}><ActBtn onClick={()=>onDevolverPropuesta&&onDevolverPropuesta(s)} style={{minHeight:30}}>Devolver</ActBtn><ActBtn variant='primary' onClick={()=>onAprobarPropuesta&&onAprobarPropuesta(s)} style={{minHeight:30}}>Aprobar</ActBtn></span>
            : isPropuesta
            ? <span style={{marginLeft:'auto',display:'flex',gap:6}} onClick={e=>e.stopPropagation()}><ActBtn onClick={()=>onRechazar(s)} style={{minHeight:30,color:C.overdueText}}>Rechazar</ActBtn><ActBtn variant='success' onClick={()=>onActivar(s)} style={{minHeight:30}}>Activar</ActBtn></span>
            : <span style={{marginLeft:'auto'}}><Pill label={s.status} bg={statusPillBg(s.status)} color={statusPillColor(s.status)} small/></span>}
        </div>
      </div>
    )
  }

  return (
    <div style={isDesktop?{maxWidth:1180,margin:'0 auto'}:undefined}>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
          <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4}}>Ventas</div>
          <span style={{display:'flex',gap:8,alignItems:'center'}}>
          {isDesktop&&<ActBtn onClick={()=>exportarVentas(ordenarVentas(selGroup?(grupos.find(g=>g.key===selGroup)?.rows||[]):listaVendido))} title='Descargar las ventas del filtro (Vendido)'><SIcon n='download' s={14} c={C.accent}/>Excel</ActBtn>}
          <span onClick={()=>setMontoUF(v=>!v)} title='Alternar UF / pesos' style={{display:'inline-flex',background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:20,padding:2,cursor:'pointer',flexShrink:0}}>
            <span style={{fontSize:11,fontWeight:700,padding:'3px 12px',borderRadius:18,background:montoUF?C.accent:'transparent',color:montoUF?'#fff':C.done,lineHeight:1}}>UF</span>
            <span style={{fontSize:11,fontWeight:700,padding:'3px 12px',borderRadius:18,background:!montoUF?C.accent:'transparent',color:!montoUF?'#fff':C.done,lineHeight:1}}>$</span>
          </span>
          </span>
        </div>
        <Buscador value={q} onChange={setQ} placeholder={isDesktop?'Buscar por venta, cliente, razón social o RUT':'Venta, cliente, razón social o RUT'} style={{marginTop:10,marginBottom:9}}/>
        {/* Hub en tarjetas (formato Banco): fila 1 Vendido · Propuestas · fila 2 Nueva venta · Nueva propuesta. Al tocar Vendido se despliegan los filtros. META no va acá: vive en el Dashboard "Cómo va el año" (fuente única, neto). */}
        {!buscando && <div style={{marginBottom:8}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
          {/* Vendido — protagonista */}
          <div onClick={()=>setHubView(v=>v==='vendido'?null:'vendido')} style={{background:'#EAF2FB',border:'1px solid #D5E6F6',borderRadius:12,padding:'12px',cursor:'pointer',position:'relative',...(hubView==='vendido'?{outline:`2px solid ${C.azulInfo}`,outlineOffset:1}:{})}}>
            <span style={{position:'absolute',top:10,right:11,color:C.textSoft,fontSize:13,transform:hubView==='vendido'?'rotate(90deg)':'none'}}><Gl n='chevron'/></span>
            <span style={{width:30,height:30,borderRadius:8,background:'#D5E6F6',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:8}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.azulInfo} strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'><path d='M23 6l-9.5 9.5-5-5L1 18'/><path d='M17 6h6v6'/></svg></span>
            <div style={{...SEC_LBL,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Vendido {fYear||'total'}</div>
            <div style={{fontSize:20,fontWeight:800,color:C.accent,letterSpacing:-.4,marginTop:3,fontVariantNumeric:'tabular-nums'}}>{fmtMonto(vendUF,vendCLP)}</div>
            {vendCom>0&&<div style={{fontSize:10,color:C.muted,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontVariantNumeric:'tabular-nums'}}>terceros −{fmtMonto(vendComUF,vendCom)}{isDesktop?` · neto ${fmtMonto(netoUF,netoCLP)}`:''}</div>}
            <div style={{fontSize:10,color:C.textSoft,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{vendSrc.length} · {actYr.length} activas · {termYr.length} terminadas</div>
          </div>
          {/* Propuestas */}
          {(()=>{ const vacio=propuestasFiltradas.length===0; const tard=propuestasFiltradas.filter(s=>{const d=s.created_at?Math.floor((Date.now()-new Date(s.created_at))/86400000):0;return d>14}).length; return (
          <div onClick={vacio?onAddPropuesta:()=>setHubView(v=>v==='propuestas'?null:'propuestas')} title={vacio?'Crear la primera propuesta':'Ver propuestas'} style={{background:C.bgSoft,border:`1px solid ${hubView==='propuestas'?C.accent:C.border}`,borderRadius:12,padding:'12px',cursor:'pointer',position:'relative'}}>
            <span style={{position:'absolute',top:10,right:11,color:C.textSoft,fontSize:13,transform:hubView==='propuestas'?'rotate(90deg)':'none'}}><Gl n='chevron'/></span>
            <span style={{width:30,height:30,borderRadius:8,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:8}}><SIcon n='check' s={16} c={C.muted}/></span>
            <div style={{...SEC_LBL}}>Propuestas</div>
            <div style={{fontSize:19,fontWeight:800,color:C.accent,letterSpacing:-.4,marginTop:3}}>{vacio?'—':fmtUF(pipelineUF)}</div>
            <div style={{fontSize:10,color:vacio?C.accent:C.done,fontWeight:vacio?700:400,marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{vacio?'+ Crear la primera':(()=>{ const nAp=propuestasFiltradas.filter(x=>x.aprobacion==='pendiente').length; return `${propuestasFiltradas.length} en pipeline${nAp?` · ${nAp} por aprobar`:tard?` · ${tard} tardía${tard!==1?'s':''}`:''}` })()}</div>
          </div>
          )})()}
          </div>
          {/* Fila de acciones estilo tiles del Inicio (tinte suave + círculo blanco + ícono/texto oscuro):
              Nueva propuesta = tile VERDE (protagonista, ancho), Nueva venta = tile NEUTRO (compacto). */}
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8}}>
          {/* Nueva propuesta — tile verde (greenBg) */}
          <div onClick={onAddPropuesta} style={{background:C.greenBg,borderRadius:12,padding:'13px 16px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10,minHeight:54}}>
            <span style={{width:30,height:30,borderRadius:9,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.greenText} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 20h9'/><path d='M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'/></svg></span>
            <div style={{fontSize:14,fontWeight:800,color:C.greenText}}>Nueva propuesta</div>
          </div>
          {/* Nueva venta — tile neutro (bgSoft) */}
          <div onClick={onAdd} style={{background:C.bgSoft,borderRadius:12,padding:'13px 16px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:9,minHeight:54}}>
            <span style={{width:28,height:28,borderRadius:8,background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2' strokeLinecap='round'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg></span>
            <div style={{fontSize:12.5,fontWeight:700,color:C.muted}}>Nueva venta</div>
          </div>
          </div>
        </div>}
        {/* Filtros — se despliegan al abrir Vendido */}
        {hubView==='vendido' && !buscando && (()=>{
          // Filtros como CHIPS desplegables (sin muro de pills): Estado y Abogado abren un checklist; Año/Área son selects compactos con look de chip.
          const chip=(active,label,val,onClick,open)=>(
            <span onClick={onClick} style={{display:'inline-flex',alignItems:'center',gap:7,maxWidth:'100%',background:active?C.azulBg:C.bgSoft,border:`1px solid ${active||open?C.accent:C.border}`,borderRadius:10,padding:'7px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>
              <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft,flexShrink:0}}>{label}</span>
              <span style={{fontSize:12,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis'}}>{val}</span>
              <span style={{color:C.textSoft,fontSize:11,flexShrink:0}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
            </span>)
          const estTxt = estSel.size===0?'Ninguno':(estSel.size===ESTADOS.length?'Todos':ESTADOS.filter(e=>estSel.has(e)).join(', '))
          const abTxt = abogSel.size===0?'Todos':abogados.filter(a=>abogSel.has(a)).join(', ')
          const chipSel={display:'inline-flex',alignItems:'center',gap:2,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'0 6px 0 11px'}
          const chipLbl={fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft,flexShrink:0}
          const selBare={border:'none',background:'transparent',fontSize:12,fontWeight:600,color:C.accent,padding:'7px 4px',cursor:'pointer',outline:'none'}
          const popSty={marginTop:8,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',maxWidth:260,background:'#fff',boxShadow:'0 8px 22px rgba(0,40,60,.12)',position:'relative',zIndex:6}
          const optSty={display:'flex',alignItems:'center',gap:9,padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',fontSize:13,color:C.text}
          const ckSty=on=>({width:17,height:17,borderRadius:6,border:`1.5px solid ${on?C.accent:C.border}`,background:on?C.accent:'transparent',color:'#fff',fontSize:11,fontWeight:800,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0})
          const popHd={fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.3,color:C.textSoft,padding:'8px 12px 4px',background:C.bgSoft}
          return (
          <div style={{marginBottom:8,position:'relative'}}>
            {openF&&<div onClick={()=>setOpenF(null)} style={{position:'fixed',inset:0,zIndex:5}}/>}
            <div style={{display:'flex',flexWrap:'wrap',gap:7,alignItems:'center',position:'relative',zIndex:6}}>
              {chip(estSel.size!==ESTADOS.length, 'Estado', estTxt, ()=>setOpenF(o=>o==='estado'?null:'estado'), openF==='estado')}
              {abogados.length>0 && chip(abogSel.size>0, 'Abogado', abTxt, ()=>setOpenF(o=>o==='abogado'?null:'abogado'), openF==='abogado')}
              <span style={chipSel}><span style={chipLbl}>Año</span><select value={fYear} onChange={e=>setFYear(e.target.value)} style={selBare}><option value=''>Todos</option>{years.map(y=><option key={y} value={y}>{y}</option>)}</select></span>
              <span style={chipSel}><span style={chipLbl}>Área</span><select value={fArea} onChange={e=>setFArea(e.target.value)} style={selBare}><option value=''>Todas</option>{['Corporativo','Tributario','Laboral','Otro'].map(a=><option key={a} value={a}>{a}</option>)}</select></span>
            </div>
            {openF==='estado' && <div style={popSty}>
              <div style={popHd}>Estado · uno o varios</div>
              {ESTADOS.map(st=>{ const on=estSel.has(st); return <div key={st} onClick={()=>toggleSet(setEstSel,st)} style={optSty}><span style={ckSty(on)}>{on?<Gl n='tick'/>:''}</span>{st}</div> })}
            </div>}
            {openF==='abogado' && <div style={popSty}>
              <div style={popHd}>Abogado · uno o varios</div>
              {abogados.map(a=>{ const on=abogSel.has(a); const pc=personChip(a); return <div key={a} onClick={()=>toggleSet(setAbogSel,a)} style={optSty}><span style={ckSty(on)}>{on?<Gl n='tick'/>:''}</span><span style={{width:8,height:8,borderRadius:'50%',background:pc.color,flexShrink:0}}/>{a}</div> })}
            </div>}
          </div>
          )})()}
      </div>
      <div style={{padding:'4px 20px 100px'}}>
        {flatView ? (
          buscando ? (
            flatRows.length===0
              ? <div style={{color:C.muted,textAlign:'center',padding:40}}>Sin resultados para tu búsqueda</div>
              : <div style={isDesktop?{maxWidth:720}:undefined}>{flatRows.map(saleRow)}</div>
          ) : (()=>{
            const fmtKB=n=>{ const k=Number(n)||0; return k>=1048576?(k/1048576).toFixed(1)+' MB':Math.max(1,Math.round(k/1024))+' KB' }
            const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
            const fmtDrvDate=iso=>{ try{ const d=new Date(iso); return d.getDate()+' '+M[d.getMonth()] }catch(_){return ''} }
            const sinRegRaw=(drvFiles||[]).filter(f=>!drvDone[f.id]); const sinReg=sinRegRaw.filter(f=>!propuestaYaCargada(f)); const sinRegOcultas=sinRegRaw.length-sinReg.length
            const secHd=(t,n,sub)=>(<div style={{display:'flex',alignItems:'baseline',gap:8,margin:'18px 2px 8px'}}><span style={{fontSize:12,fontWeight:800,color:C.accent}}>{t}</span><span style={{fontSize:11,fontWeight:700,color:C.muted}}>{n}</span>{sub&&<span style={{fontSize:10.5,color:C.textSoft}}>· {sub}</span>}</div>)
            return (
            <div style={isDesktop?{maxWidth:760}:undefined}>
              <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:6}}>
                <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderBottom:drvFiles?`1px solid ${C.border}`:'none'}}>
                  <span style={{flexShrink:0}}><DriveIcon size={20}/></span>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>Propuestas en Drive</div><div style={{fontSize:10.5,color:C.muted}}>PDF del último mes · las carga como borrador</div></div>
                  <button onClick={cargarDrive} disabled={drvLoad} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'7px 13px',cursor:drvLoad?'default':'pointer',opacity:drvLoad?.7:1,display:'flex',alignItems:'center',gap:6}}>{drvLoad?<Spin/>:null}{drvFiles?'Actualizar':'Buscar'}</button>
                </div>
                {drvErr&&<div style={{fontSize:11.5,color:C.overdueText,background:C.overdueBg,padding:'8px 14px'}}>{drvErr}</div>}
                {drvFiles&&drvFiles.length===0&&!drvErr&&<div style={{fontSize:12,color:C.muted,padding:'14px'}}>No hay PDFs de propuestas del último mes en la carpeta.</div>}
                {drvFiles&&drvFiles.length>0&&<div>
                  {drvFiles.map((file,i)=>{ const reg=drvDone[file.id]; const match=reg?null:matchCli(file.name); const busy=drvBusy===file.id; const cli=match?clients.find(c=>String(c.id)===String(match.client_id)):null
                    return (
                    <div key={file.id} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 14px',borderTop:i>0?`1px solid ${C.bgSoft}`:'none'}}>
                      <span style={{width:28,height:34,borderRadius:5,background:C.overdueBg,border:'1px solid #F3CFCE',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:7.5,fontWeight:800,color:C.overdueText}}>PDF</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12.5,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div>
                        <div style={{fontSize:10,color:C.textSoft,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtDrvDate(file.modifiedTime)}{file.size?` · ${fmtKB(file.size)}`:''} · {reg?'registrada':cli?`cliente ${cli.name}`:'cliente por confirmar'}</div>
                      </div>
                      {reg
                        ? <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.greenBg,color:C.greenText,whiteSpace:'nowrap',flexShrink:0}}>Borrador <Gl n='tick'/></span>
                        : <button onClick={()=>registrarDrive(file)} disabled={busy} style={{fontSize:11.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'6px 12px',cursor:busy?'default':'pointer',opacity:busy?.7:1,display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap',flexShrink:0}}>{busy?<Spin/>:null}{busy?'Leyendo…':'Registrar'}</button>}
                    </div>)})}
                  {sinReg.length>1&&<div style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`}}><button onClick={async()=>{ for(const f of sinReg){ await registrarDrive(f) } }} style={{fontSize:11.5,fontWeight:700,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'7px 13px',cursor:'pointer'}}>Registrar las {sinReg.length} como borrador</button></div>}
                </div>}
              </div>
              {secHd('Borradores', borradoresFiltrados.length, 'por completar')}
              {borradoresFiltrados.length===0
                ? <div style={{fontSize:12,color:C.muted,padding:'6px 2px'}}>Sin borradores. Usa "Buscar" arriba para traer las propuestas del Drive.</div>
                : borradoresFiltrados.map(saleRow)}
              {secHd('Propuestas', propuestasFiltradas.length, 'enviadas · al 100%')}
              {propuestasFiltradas.length===0
                ? <div style={{fontSize:12,color:C.muted,padding:'6px 2px'}}>Sin propuestas activas.</div>
                : propuestasFiltradas.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).map(saleRow)}
            </div>)
          })()
        ) : hubView!=='vendido' ? (
          // Vista PERSISTENTE debajo del hub (landing): dos columnas — Esperando aprobación (con tramo de tardías en ámbar) y
          // Borradores + Drive. Reusa saleRow (mismo card, tardía en ámbar, Rechazar/Activar) y el motor de Drive existente.
          (()=>{
            const dias = s => s.created_at ? Math.floor((Date.now()-new Date(s.created_at))/86400000) : 0
            const props = propuestasFiltradas.slice().sort((a,b)=> (Number(dias(b)>14)-Number(dias(a)>14)) || (new Date(b.created_at||0)-new Date(a.created_at||0)))
            const tard = props.filter(s=>dias(s)>14), alDia = props.filter(s=>dias(s)<=14)
            const pipeUF = props.reduce((a,s)=>a+ventaUF(s,ufRef),0), pipeCLP = Math.round(props.reduce((a,s)=>a+ventaCLP(s,ufRef),0))
            // Agrupación por año (desc): el panel separa las propuestas por año; dentro de cada año, tardías primero.
            const byYear={}; props.forEach(s=>{ const y=String(s.year||'—'); (byYear[y]=byYear[y]||[]).push(s) })
            const propYears = Object.keys(byYear).sort((a,b)=>b.localeCompare(a))
            const borr = borradoresFiltrados, sinRegRaw = (drvFiles||[]).filter(f=>!drvDone[f.id]), sinReg = sinRegRaw.filter(f=>!propuestaYaCargada(f)), sinRegOcultas = sinRegRaw.length-sinReg.length, BORR_MAX = 6
            const colHd = (dotC,t,n,right) => <div style={{display:'flex',alignItems:'center',gap:8,margin:'0 2px 8px'}}><span style={{width:8,height:8,borderRadius:'50%',background:dotC,flexShrink:0}}/><span style={{fontSize:12,fontWeight:800,color:C.accent}}>{t}</span><span style={{fontSize:11,fontWeight:700,color:C.muted}}>{n}</span><span style={{marginLeft:'auto'}}>{right}</span></div>
            const subHd = (t,c) => <div style={{fontSize:10,fontWeight:700,color:c,textTransform:'uppercase',letterSpacing:.4,margin:'2px 2px 5px'}}>{t}</div>
            return (
            <div style={{marginTop:6}}>
              <div style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1fr) minmax(0,1.2fr)':'minmax(0,1fr)',gap:14}}>
                {/* Esperando aprobación */}
                <div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:12,padding:12,minWidth:0}}>
                  {colHd(C.greenText,'Esperando aprobación',props.length, props.length>0?<span style={{fontSize:12,fontWeight:800,color:C.accent}}>{fmtMonto(pipeUF,pipeCLP)}</span>:null)}
                  {props.length===0
                    ? <div onClick={onAddPropuesta} style={{fontSize:12,color:C.muted,padding:'10px 2px',cursor:'pointer'}}>Sin propuestas esperando. <span style={{color:C.greenText,fontWeight:700}}>+ Nueva propuesta</span></div>
                    : propYears.map(y=>{ const ps=byYear[y].slice().sort((a,b)=> (Number(dias(b)>14)-Number(dias(a)>14)) || (new Date(b.created_at||0)-new Date(a.created_at||0))); const yUF=ps.reduce((a,s)=>a+ventaUF(s,ufRef),0), yCLP=Math.round(ps.reduce((a,s)=>a+ventaCLP(s,ufRef),0)); const nt=ps.filter(s=>dias(s)>14).length; return (
                        <div key={y}>
                          <div style={{display:'flex',alignItems:'baseline',gap:8,margin:'8px 2px 5px'}}>
                            <span style={{fontSize:11,fontWeight:800,color:C.accent}}>{y}</span>
                            <span style={{fontSize:10,fontWeight:700,color:C.muted}}>{ps.length} propuesta{ps.length!==1?'s':''}{nt?<span style={{color:C.soonText}}> · {nt} tardía{nt!==1?'s':''}</span>:null}</span>
                            <span style={{marginLeft:'auto',fontSize:11,fontWeight:800,color:C.accent}}>{fmtMonto(yUF,yCLP)}</span>
                          </div>
                          {ps.map(saleRow)}
                        </div>) })}
                </div>
                {/* Borradores + Drive */}
                <div style={{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:12,padding:12,minWidth:0}}>
                  {colHd('#E8CC6A','Borradores · Drive',borr.length,
                    <button onClick={cargarDrive} disabled={drvLoad} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 11px',cursor:drvLoad?'default':'pointer',display:'inline-flex',alignItems:'center',gap:6}}>{drvLoad?<Spin/>:null}{drvFiles?'Actualizar Drive':'Buscar en Drive'}</button>)}
                  {drvErr&&<div style={{fontSize:11,color:C.overdueText,background:C.overdueBg,borderRadius:8,padding:'7px 10px',marginBottom:8}}>{drvErr}</div>}
                  {sinReg.length>0&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,background:'#fff',marginBottom:10,overflow:'hidden'}}>
                    <div style={{...SEC_LBL,padding:'8px 12px 4px'}}>En Drive · {sinReg.length} sin registrar{sinRegOcultas>0?<span style={{fontWeight:600,textTransform:'none',letterSpacing:0}}> · {sinRegOcultas} ya en el sistema</span>:''}</div>
                    {sinReg.slice(0,6).map((file,i)=>{ const match=matchCli(file.name); const cli=match?clients.find(c=>String(c.id)===String(match.client_id)):null; const busy=drvBusy===file.id; return (
                      <div key={file.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderTop:i>0?`1px solid ${C.bgSoft}`:'none'}}>
                        <span style={{width:24,height:30,borderRadius:5,background:C.overdueBg,border:'1px solid #F3CFCE',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:7,fontWeight:800,color:C.overdueText}}>PDF</span>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{file.name}</div><div style={{fontSize:10,color:C.textSoft}}>{cli?`cliente ${cli.name}`:'cliente por confirmar'}</div></div>
                        <button onClick={()=>registrarDrive(file)} disabled={busy} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 11px',cursor:busy?'default':'pointer',display:'inline-flex',alignItems:'center',gap:5,flexShrink:0}}>{busy?<Spin/>:null}{busy?'Leyendo…':'Registrar'}</button>
                      </div>)})}
                    {sinReg.length>1&&<div style={{padding:'8px 12px',borderTop:`1px solid ${C.bgSoft}`}}><button onClick={async()=>{ for(const f of sinReg){ await registrarDrive(f) } }} style={{fontSize:11,fontWeight:700,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'6px 11px',cursor:'pointer'}}>Registrar las {sinReg.length} como borrador</button></div>}
                  </div>}
                  {borr.length===0
                    ? <div style={{fontSize:12,color:C.muted,padding:'10px 2px'}}>Sin borradores. Toca <b>Buscar en Drive</b> para traer las propuestas del mes.</div>
                    : <>{borr.slice(0,BORR_MAX).map(saleRow)}{borr.length>BORR_MAX&&<div onClick={()=>setHubView('propuestas')} style={{fontSize:11,fontWeight:700,color:C.accent,cursor:'pointer',padding:'6px 2px'}}>Ver los {borr.length} borradores <Gl n='chevron'/></div>}</>}
                </div>
              </div>
            </div>)
          })()
        ) : grupos.length===0 ? (
          <div style={{color:C.muted,textAlign:'center',padding:40}}>Sin ventas con estos filtros</div>
        ) : (()=>{ const _tbl = (<>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'0 2px 7px'}}>
            <span style={{fontSize:9,color:C.textSoft,fontWeight:700,letterSpacing:.4,textTransform:'uppercase'}}>Desglose · suma {fmtMonto(vendUF,vendCLP)}</span>
            <div style={{display:'flex',gap:5}}>
              {[['abogado','Responsable'],['area','Área']].map(([v,l])=>{ const on=groupBy===v; return <span key={v} onClick={()=>{setGroupBy(v);setSelGroup(null)}} style={{fontSize:10,fontWeight:on?700:600,borderRadius:20,padding:'3px 12px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.accent:'#fff',color:on?'#fff':C.muted}}>{l}</span> })}
            </div>
          </div>
          {/* Desglose = tabla alineada SIN líneas verticales (los separadores | ensuciaban al cortarse entre filas): columnas fijas Ventas·UF·$·% comparables hacia abajo; el % va en chip con el color de la persona (personChip → bg+color) como ancla a la derecha. Cada fila filtra su detalle (selGroup). */}
          {grupos.length>0&&(()=>{ const GT='1fr 40px 54px 48px 46px'; const nc={fontVariantNumeric:'tabular-nums',textAlign:'right'}; const hc={...nc,fontSize:9,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}; return (
            <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'0 12px',marginBottom:6}}>
              <div style={{display:'grid',gridTemplateColumns:GT,columnGap:10,alignItems:'center',padding:'8px 0 6px'}}>
                <span style={{fontSize:9,fontWeight:600,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>{groupBy==='abogado'?'Responsable':'Área'}</span>
                <span style={hc}>Ventas</span><span style={hc}>UF</span><span style={hc}>$</span><span style={{...hc,textAlign:'center'}}>%</span>
              </div>
              {grupos.map(g=>{ const col=colorGrupo(g.key); const chip=groupBy==='abogado'?personChip(g.key):{bg:(col||C.muted)+'1A',color:col}; const on=selGroup===g.key; const sin=g.key==='Sin abogado'||g.key==='Sin área'; const pct=vendUF>0?g.uf/vendUF*100:0; const pctTxt=(pct>0&&pct<1)?pct.toFixed(1).replace('.',','):Math.round(pct); const gclp=Math.round(g.rows.reduce((a,s)=>a+ventaCLP(s,ufRef),0)); const ph=!(g.uf>0)&&g.rows.every(porHoras); return (
                <div key={g.key} onClick={()=>{setSelGroup(on?null:g.key);setVerTodasV(false);setOpenYearV(null)}} style={{display:'grid',gridTemplateColumns:GT,columnGap:10,alignItems:'center',padding:'9px 0',borderTop:`0.5px solid ${C.border}`,cursor:'pointer',background:on?C.bgSoft:(sin?'#FBF7EF':'transparent')}}>
                  <span style={{display:'flex',alignItems:'center',gap:7,minWidth:0}}>
                    <span style={{width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/>
                    <span style={{fontSize:14,fontWeight:600,color:col,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{g.key}</span>
                    {sin&&<span style={{fontSize:9.5,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:20,padding:'2px 8px',flexShrink:0,whiteSpace:'nowrap'}}>Asignar</span>}
                  </span>
                  <span style={{...nc,fontSize:13,color:C.muted}}>{g.count}</span>
                  <span style={{...nc,fontSize:ph?11:13,fontWeight:ph?500:600,color:ph?C.muted:C.text}}>{ph?'por horas':Math.round(g.uf).toLocaleString('es-CL')}</span>
                  <span style={{...nc,fontSize:12,color:C.muted}}>{ph?'—':fmtShort(gclp)}</span>
                  <span style={{background:chip.bg,color:chip.color,borderRadius:8,padding:'3px 0',textAlign:'center',fontSize:13,fontWeight:700,fontVariantNumeric:'tabular-nums'}}>{ph?'—':`${pctTxt}%`}</span>
                </div>
              )}) }
            </div>
          )})()}
          </>);
          // Lista de ventas SIEMPRE visible junto al desglose: sin elegir, todas las del filtro (suman el Vendido); al elegir un responsable/área, las suyas.
          const _drill = ((()=>{ const g=selGroup?grupos.find(x=>x.key===selGroup):null; const rows=ordenarVentas(g?g.rows:listaVendido); if(!rows.length) return null; const col=selGroup?colorGrupo(selGroup):C.accent
            const tUF=rows.reduce((a,s)=>a+ventaUF(s,ufRef),0), tCLP=Math.round(rows.reduce((a,s)=>a+ventaCLP(s,ufRef),0)); return (
            <div style={{marginTop:isDesktop?0:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8,flexWrap:'wrap'}}>
                {selGroup&&<span style={{width:8,height:8,borderRadius:4,background:col}}></span>}
                <span style={{fontSize:12,fontWeight:700,color:C.accent}}>{selGroup||'Ventas'}</span>
                <span style={{fontSize:11,color:C.muted}}>· {rows.length} venta{rows.length!==1?'s':''} · {fmtMonto(tUF,tCLP)}</span>
                {selGroup&&<span onClick={()=>{setSelGroup(null);setVerTodasV(false);setOpenYearV(null)}} style={{fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer'}}>· ver todas</span>}
              </div>
              {selGroup&&groupBy==='abogado'&&(()=>{ const iv=ingresoPorAnio(rows); if(!iv.years.length) return null; const anoNow=String(new Date().getFullYear()); const cobTot=iv.years.reduce((a,y)=>a+iv.m[y].cobrado,0); return (
                <div style={{background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:12,padding:'9px 12px 4px',marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:2}}>
                    <span style={{fontSize:9,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.4}}>Ingreso por año</span>
                    <span style={{fontSize:10,color:C.textSoft}}>cuándo entra la plata</span>
                  </div>
                  {iv.years.map(y=>{ const d=iv.m[y]; const fut=Number(y)>Number(anoNow); const open=openYearV===y; const cuotas=(iv.listByYear[y]||[]).slice().sort((a,b)=>String(a.due||'').localeCompare(String(b.due||''))); return (
                    <div key={y} style={{borderTop:`0.5px solid ${C.border}`}}>
                      <div onClick={()=>setOpenYearV(open?null:y)} style={{display:'grid',gridTemplateColumns:'1fr auto 14px',columnGap:8,alignItems:'baseline',padding:'6px 0',cursor:'pointer'}}>
                        <span style={{fontSize:13,fontWeight:600,color:C.text}}>{y}{fut&&<span style={{fontSize:9,fontWeight:600,color:C.textSoft,marginLeft:6,textTransform:'uppercase',letterSpacing:.3}}>programado</span>}{d.revisar&&<span style={{fontSize:9,fontWeight:700,color:C.soonText,background:C.ambarBg,borderRadius:6,padding:'1px 5px',marginLeft:6,textTransform:'uppercase',letterSpacing:.3}} title='Hay cuotas con fecha anterior al año de la venta — revisar'>revisar</span>}<span style={{fontSize:10,color:C.textSoft,fontWeight:500,marginLeft:6}}>· {cuotas.length}</span></span>
                        <span style={{textAlign:'right'}}>
                          <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmtShort(d.monto)}</span>
                        </span>
                        <span style={{alignSelf:'center',color:C.textSoft,transform:open?'rotate(90deg)':'none',transition:'transform .15s',fontSize:12,lineHeight:1}}><Gl n='chevron'/></span>
                      </div>
                      {open&&<div style={{paddingBottom:6}}>
                        {cuotas.map(b=>{ const est=b.status==='Programada'?{label:'Programada',text:C.done,bg:C.bgSoft}:estadoCobro(b); const cn=(clients.find(c=>String(c.id)===String(b.client_id))?.name)||b.receptor_name||'—'
                          // Abre la VENTA (modal, no navega → al cerrar quedas en este mismo drill). Si la cuota no tiene venta, cae a la ficha.
                          const ventaCuota = b.sale_id ? sales.find(s=>String(s.id)===String(b.sale_id)) : null
                          const abrirCuota = (ventaCuota&&onEdit) ? (ev)=>{ev.stopPropagation();onEdit(ventaCuota)} : (onOpenClientFicha&&b.client_id ? (ev)=>{ev.stopPropagation();onOpenClientFicha(b.client_id)} : undefined); return (
                          <div key={b.id} onClick={abrirCuota} title={ventaCuota?'Abrir la venta':(b.client_id?'Ver ficha del cliente':undefined)} style={{display:'grid',gridTemplateColumns:'46px 1fr auto',columnGap:8,alignItems:'center',padding:'4px 0 4px 2px',cursor:abrirCuota?'pointer':'default'}}>
                            <span style={{fontSize:10,color:iv.revisar.has(String(b.id))?C.soonText:C.muted,fontVariantNumeric:'tabular-nums',fontWeight:iv.revisar.has(String(b.id))?700:400}}>{b.due?fmtFechaDMY(b.due).slice(0,5):'—'}</span>
                            <span style={{minWidth:0,overflow:'hidden'}}>
                              <span style={{fontSize:12,fontWeight:500,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'block'}}>{cn}</span>
                              {iv.revisar.has(String(b.id))?<span style={{fontSize:10,fontWeight:700,color:C.soonText}} title='Fecha anterior al año de la venta — revisar'>Revisar fecha</span>:<span style={{fontSize:10,fontWeight:600,color:est.text}}>{est.label}</span>}
                            </span>
                            <span style={{fontSize:12,fontWeight:600,color:C.text,textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{fmtShort(montoFactura(b))}</span>
                          </div>
                        )})}
                      </div>}
                    </div>
                  )})}
                  <div style={{display:'grid',gridTemplateColumns:'1fr auto 14px',columnGap:8,alignItems:'baseline',padding:'6px 0 5px',borderTop:`1.5px solid ${C.accent}`,marginTop:1}}>
                    <span style={{fontSize:12,fontWeight:700,color:C.accent}}>Total ingreso</span>
                    <span style={{textAlign:'right'}}>
                      <span style={{fontSize:14,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtShort(iv.total)}</span>
                    </span>
                    <span/>
                  </div>
                </div>
              )})()}
              {isDesktop ? tablaVentas(rows,tUF,tCLP) : (<>
                {(verTodasV?rows:rows.slice(0,8)).map(saleRow)}
                {rows.length>8&&<div onClick={()=>setVerTodasV(v=>!v)} style={{textAlign:'center',padding:'7px 0',fontSize:11,color:C.accent,fontWeight:600,cursor:'pointer'}}>{verTodasV?'Ver menos':`+ ${rows.length-8} más · ver todas`}</div>}
                <div style={{marginTop:8}}><ActBtn full onClick={()=>exportarVentas(rows)}><SIcon n='download' s={14} c={C.accent}/>Descargar Excel</ActBtn></div>
              </>)}
            </div>
          )})());
          const _invite = <div style={{border:`1.5px dashed ${C.border}`,borderRadius:12,padding:'40px 20px',textAlign:'center',color:C.muted,fontSize:13,lineHeight:1.5}}>Elige un responsable o área a la izquierda<br/>para ver sus ventas.</div>;
          return isDesktop ? (
            <div style={{display:'grid',gridTemplateColumns:'360px minmax(0,1fr)',gap:16,alignItems:'start'}}>
              <div style={{minWidth:0}}>{_tbl}</div>
              <div style={{minWidth:0}}>{_drill||_invite}</div>
            </div>
          ) : (<>{_tbl}{_drill}</>);
        })()}
      </div>
    </div>
  )
}

