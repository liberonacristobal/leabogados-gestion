// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { C, Gl, Spin, _normTxt, appAlert, diaGrande, fmt, fmtFechaDMY, personChip, useIsDesktop } from '../lib/base.jsx'
import { CATS_DE_CLIENTE, CATS_GASTO, FloatFld, INICIALES_RESP, Inp, MEDIOS_MOV, MEDIO_CON_DETALLE, deQueOpciones, esPermanente, fInp, glosaMovilizacion, glosaSinDetalle, learnPut, logActividad, medioMovDe, saldoCliente, subOtro, subproyectosCliente, useDeQueAprendido } from '../lib/compartido.jsx'

export const TrashIcon = ({color}) => (
  <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={color||'#537281'} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14'/></svg>
)

// «fs 1918v 2862 1949 San Bernardo» → «fs 1918v N° 2862 de 1949 · San Bernardo». Sin fojas queda tal como se escribió.
export const deQueTexto = s => { const t=String(s||'').trim().replace(/\s+/g,' ')
  const m=t.match(/^(?:(?:fs|fj|fjs|fojas)\.?\s*)?(\d+\s*(?:v|vta|vuelta)?)\s*[,;-]?\s*(?:n[°º.]?|nro\.?|n[uú]mero)?\s*(\d+)\s*[,;-]?\s*(?:de|del|a[ñn]o)?\s*((?:18|19|20)\d{2})\b\s*(.*)$/i)
  if(!m) return t
  const fs=m[1].replace(/\s+/g,'').replace(/(vta|vuelta)$/i,'v'), resto=m[4].replace(/^(cbr|de|del)\s+/i,'').trim()
  return `fs ${fs} N° ${m[2]} de ${m[3]}${resto?` · ${resto}`:''}` }

export const _CAT_KW = [[/\b(uber|cabify|didi|taxi|metro|bip|micro|bencina|peaje|estacionamiento|transvip|movilizaci[oó]n)\b/,'Movilización'],[/\bnotari/,'Notaria'],[/\b(env[ií]o|despacho|chilexpress|starken|dhl|courier|correos de chile|carta certificada|encomienda)\b/,'Otro'],[/diario oficial/,'Diario Oficial'],[/registro civil/,'Registro Civil'],[/archivo judicial/,'Archivo Judicial'],[/\b(cbr|conservador|certificad|inscripci)/,'CBR']]

export const _NOM_GENERICO = new Set(['sociedad','limitada','inversiones','servicios','comercial','inmobiliaria','asesorias','agricola','empresa','empresas','chile','holding','group','capital','consultores','compania','ingenieria','construccion','constructora','desarrollo','gestion','proyectos','abogados','familia','sucesion','corporacion','fundacion','internacional','sociedades','negocios','transportes','importadora','exportadora','distribuidora','oficina','certificado','notaria','escritura','compraventa'])

export const _tokG = s => _normTxt(s).split(' ').filter(w=>w.length>=5)

export const _esOfiCli = c => !!c && (c.is_internal || /liberona\s+escala/i.test(c.name||''))

export const _hoyLocal = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export function GastosForm({clients,expenses,clientEntities,tasks,sales,onSave,onClose,preClient,sinCabecera=false,userName,estudioId,onIrCliente,onLanding}) {
  const isDesktop = useIsDesktop()
  const hoy = _hoyLocal()
  const nuevaFila = date => ({id:Date.now()+Math.random(),category:null,concept:'',amount:'',date:date||hoy,paid_by_client:false,subcategory:'',cli:null,proj:'',resp:null,picking:false,pq:'',mvMedio:'',mvDesde:'',mvHasta:'',mvMotivo:'',deQue:'',dupOk:false})
  const [q,setQ] = useState('')
  const [selectedClient,setSelectedClient] = useState(preClient&&preClient.id?preClient:null)   // {personal_de} = gasto personal precargado (cuenta del equipo)
  // Gasto personal de un miembro: en vez de cliente se elige la persona (personal_de). La tanda entera es de esa persona.
  const [personal,setPersonal] = useState(preClient?.personal_de||null)
  const [equipo,setEquipo] = useState([])
  useEffect(()=>{ let on=true
    if(DEMO){ setEquipo(Object.keys(INICIALES_RESP)); return }
    supabase.from('miembros').select('nombre,estudio_id,es_socio').then(({data})=>{ if(!on) return
      const vistos=new Set()
      setEquipo((data||[]).filter(m=>!estudioId||m.estudio_id===estudioId)
        .sort((a,b)=>(b.es_socio?1:0)-(a.es_socio?1:0)||String(a.nombre||'').localeCompare(String(b.nombre||''),'es'))
        .map(m=>String(m.nombre||'').split(' (')[0].trim()).filter(n=>n&&!vistos.has(n)&&vistos.add(n)))
    },()=>{})
    return ()=>{on=false} },[estudioId])
  const [rows,setRows] = useState(()=>[nuevaFila()])
  const [saving,setSaving] = useState(false)
  const [saved,setSaved] = useState(0)
  const rsList = useMemo(()=>{ if(!selectedClient) return []; return (clientEntities||[]).filter(e=>e.client_id===selectedClient.id) },[clientEntities,selectedClient])
  const [entityId,setEntityId] = useState('')
  useEffect(()=>{ setEntityId(rsList[0]?.id||'') },[rsList])   // pre-poblar con la primera RS del cliente
  const [project,setProject] = useState('')
  const [projAuto,setProjAuto] = useState(false)
  const [newProject,setNewProject] = useState(false)
  const [subproject,setSubproject] = useState('')
  const esOficina = _esOfiCli(selectedClient)
  const gastosVivos = useMemo(()=>(expenses||[]).filter(e=>e.type==='gasto'&&!e.deleted_at),[expenses])

  // Proyectos de un cliente (ventas + tareas, más reciente primero). La oficina no hereda proyectos de tareas:
  // así se colaba "Títulos San Bernardo" en gastos de oficina.
  const projectsOf = useCallback(cid=>{
    if(!cid) return []
    const cli=(clients||[]).find(c=>c.id===cid); const m={}
    if(!_esOfiCli(cli)) (tasks||[]).filter(t=>t.client_id===cid&&t.project).forEach(t=>{ const d=t.created_at||t.due||''; if(!(t.project in m)||d>m[t.project]) m[t.project]=d })
    ;(sales||[]).filter(s=>s.client_id===cid&&s.title&&!s.deleted_at).forEach(s=>{ const d=s.created_at||s.date||''; if(!(s.title in m)||d>m[s.title]) m[s.title]=d })
    return Object.keys(m).sort((a,b)=>(m[b]||'').localeCompare(m[a]||''))
  },[clients,tasks,sales])
  // Proyecto por defecto: solo si el cliente tiene UN proyecto; con varios, quien carga lo marca (obligatorio al guardar).
  const projDefault = useCallback(cid=>{
    const cli=(clients||[]).find(c=>c.id===cid); if(!cid||_esOfiCli(cli)) return ''
    const lista=projectsOf(cid)
    return lista.length===1 ? lista[0] : ''
  },[clients,projectsOf])
  const clientProjects = useMemo(()=>projectsOf(selectedClient?.id),[projectsOf,selectedClient])
  const preProjRef = useRef(null)   // proyecto que trae "Repetir" (si sigue vigente para el cliente)
  useEffect(()=>{ const pre=preProjRef.current; preProjRef.current=null; const p=(pre&&projectsOf(selectedClient?.id).includes(pre))?pre:projDefault(selectedClient?.id); setProject(p); setProjAuto(!!p); setNewProject(false) },[selectedClient?.id])
  const ventaProj = (sales||[]).find(s=>selectedClient&&s.client_id===selectedClient.id&&s.title===project)
  const subsCli = useMemo(()=>selectedClient?subproyectosCliente(selectedClient.id,tasks,expenses):[],[selectedClient,tasks,expenses])
  // La razón social sigue al proyecto elegido cuando la venta la tiene.
  useEffect(()=>{ const v=(sales||[]).find(s=>selectedClient&&s.client_id===selectedClient.id&&s.title===project); if(v?.entity_id&&rsList.some(e=>e.id===v.entity_id)) setEntityId(v.entity_id) },[project])
  const matches = useMemo(()=>{ if(!q.trim()) return []; return clients.filter(c=>_normTxt(c.name).includes(_normTxt(q))).slice(0,6) },[clients,q])
  const balance = selectedClient ? saldoCliente(expenses, selectedClient.id) : null

  // Clientes recientes: primero los de quien carga, luego los de todos.
  const recientes = useMemo(()=>{
    const rec=(a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))
    const mios=gastosVivos.filter(e=>userName&&e.created_by===userName).sort(rec)
    const out=[]; const seen=new Set()
    ;[...mios,...[...gastosVivos].sort(rec)].forEach(e=>{ if(out.length>=6||!e.client_id||seen.has(e.client_id)) return; const c=(clients||[]).find(x=>x.id===e.client_id); if(c){ seen.add(c.id); out.push(c) } })
    return out
  },[gastosVivos,clients,userName])

  // Lo aprendido (glosa → cliente / categoría).
  const [learn,setLearn] = useState({cli:{},cat:{}})
  const [deq,aprenderDeQue] = useDeQueAprendido()
  useEffect(()=>{ let on=true
    const rd=k=>selectAll(()=>supabase.from('learnings').select('key,value,updated_at,id').eq('kind',k).order('updated_at',{ascending:true}).order('id')).then(r=>{ const m={}; (r?.data||[]).forEach(x=>{ if(x.key&&x.value) m[x.key]=x.value }); return m },()=>({}))
    Promise.all([rd('gasto_cliente'),rd('gasto_categoria')]).then(([cli,cat])=>{ if(on) setLearn({cli,cat}) })
    return ()=>{on=false} },[])

  // Índices para sugerir cliente desde la glosa: nombres/RS únicos de cada cliente e historial de gastos.
  const idx = useMemo(()=>{
    const cliById=new Map((clients||[]).map(c=>[c.id,c]))
    const nom=new Map()
    const addNom=(cid,s)=>_tokG(s).forEach(t=>{ if(_NOM_GENERICO.has(t)) return; const set=nom.get(t)||new Set(); set.add(cid); nom.set(t,set) })
    ;(clients||[]).forEach(c=>{ if(!_esOfiCli(c)) addNom(c.id,c.name) })
    ;(clientEntities||[]).forEach(e=>{ const c=cliById.get(e.client_id); if(c&&!_esOfiCli(c)) addNom(c.id,e.name) })
    const tok=new Map(), gk=new Map()
    const inc=(map,k,cid)=>{ const m=map.get(k)||new Map(); m.set(cid,(m.get(cid)||0)+1); map.set(k,m) }
    gastosVivos.forEach(e=>{ if(!e.client_id||!e.concept) return; new Set(_tokG(e.concept)).forEach(t=>inc(tok,t,e.client_id)); const k=glosaKey(e.concept); if(k) inc(gk,k,e.client_id) })
    return {cliById,nom,tok,gk}
  },[clients,clientEntities,gastosVivos])
  const top = m => { let n=0,best=null,bc=0; m.forEach((c,k)=>{ n+=c; if(c>bc){bc=c;best=k} }); return {best,bc,n} }
  // Cliente que sugiere la glosa (o null). La primera evidencia manda: si apunta al cliente actual, no hay aviso.
  const sugerirCliente = (concept,curId) => {
    if(!concept||concept.trim().length<4) return null
    const {cliById,nom,tok,gk}=idx
    const vale=cid=>{ const c=cliById.get(cid); return c&&!_esOfiCli(c)?c:null }
    const k=glosaKey(concept); const hk=k&&gk.get(k)
    if(hk){ const t=top(hk); if(t.bc>=2&&t.bc/t.n>=0.8){ const c=vale(t.best); if(c) return c.id===curId?null:{c,motivo:`Los gastos con esta descripción son de ${c.name}.`} } }
    if(k&&learn.cli[k]&&(!hk||top(hk).bc/top(hk).n>=0.8)){ const c=vale(learn.cli[k]); if(c) return c.id===curId?null:{c,motivo:`Esta descripción ya se asignó a ${c.name}.`} }
    const ts=_tokG(concept)
    for(const t of ts){ const s=nom.get(t); if(s&&s.size===1){ const c=vale([...s][0]); if(c) return c.id===curId?null:{c,motivo:`La descripción menciona a ${c.name}.`} } }
    for(const t of ts){ const m=tok.get(t); if(!m) continue; const r=top(m); if(r.bc>=3&&r.bc/r.n>=0.85){ const c=vale(r.best); if(c) return c.id===curId?null:{c,motivo:`«${t[0].toUpperCase()+t.slice(1)}» aparece en ${r.bc} gastos de ${c.name}.`} } }
    return null
  }
  const catAuto = concept => { const k=glosaKey(concept||''); const l=k&&learn.cat[k]; if(l&&CATS_GASTO.includes(l)) return l; const n=_normTxt(concept); for(const [re,cat] of _CAT_KW) if(re.test(n)) return cat; return null }
  const catDe = r => r.category || catAuto(r.concept) || 'Otro'
  const cliDe = r => r.cli || selectedClient
  const projDe = r => r.cli ? r.proj : project

  const updateRow = (id,patch) => setRows(p=>{ let n=p.map(r=>r.id===id?{...r,...patch}:r); const last=n[n.length-1]; if(last&&(last.concept||last.amount)) n=[...n,{...nuevaFila(last.date),...(last.category==='Movilización'?{category:'Movilización'}:{})}]; return n })   // tanda de movilización: la fila nueva ya viene en Movilización
  const removeRow = id => setRows(p=>{ const n=p.filter(r=>r.id!==id); return n.length?n:[nuevaFila()] })
  const moverFila = (r,c) => {
    updateRow(r.id,{cli:c,proj:projDefault(c.id),resp:'mov',picking:false,pq:''})
    const gk=glosaKey(r.concept||'')
    if(gk&&!_esOfiCli(c)) supabase.from('learnings').select('value').eq('kind','gasto_proyecto').eq('key',`${c.id}::${gk}`).order('updated_at',{ascending:false}).limit(1).then(({data})=>{ const v=data&&data[0]?.value; if(v&&projectsOf(c.id).includes(v)) setRows(p=>p.map(x=>x.id===r.id&&x.cli?.id===c.id?{...x,proj:v}:x)) },()=>{})
  }

  const llenas = rows.filter(r=>r.amount&&parseInt(r.amount)>0)
  // Movilización (Uber y similares) es excepcional: siempre con medio, trayecto y motivo. La glosa que ve el cliente se arma de ahí.
  const movMedio = r => r.mvMedio || medioMovDe(r.concept)
  const faltaMovDe = r => { if(catDe(r)!=='Movilización') return false; const md=movMedio(r); return !md || (MEDIO_CON_DETALLE.has(md) && (!r.mvDesde.trim()||!r.mvHasta.trim()||r.mvMotivo.trim().length<4)) }
  const faltaMov = llenas.some(faltaMovDe)
  // Trámite sin «de qué»: la línea ¿De qué? lo completa (chip o texto libre); sin eso no se guarda.
  const pideDeQue = r => CATS_DE_CLIENTE.has(catDe(r)) && glosaSinDetalle(r.concept)
  const faltaDetDe = r => pideDeQue(r) && !String(r.deQue||'').trim()
  const faltaDet = llenas.filter(faltaDetDe).length
  // Posible duplicado (solo Movilización, sin cargas BIP): misma persona, mismo día y misma cifra que un viaje ya cargado o que otra fila de esta carga.
  const gastosPorFecha = useMemo(()=>{ const m=new Map(); (expenses||[]).forEach(e=>{ if(e.deleted_at||e.type==='fondo'||!e.date||e.category!=='Movilización') return; const k=String(e.date).slice(0,10); (m.get(k)||m.set(k,[]).get(k)).push(e) }); return m },[expenses])
  const esBip = (medio,concept) => medio==='Carga BIP' || medioMovDe(concept)==='Carga BIP'
  const dupDe = r => { if(!r.amount||r.dupOk||catDe(r)!=='Movilización'||esBip(movMedio(r),r.concept)) return null
    const monto=parseInt(r.amount)||0, f=r.date||hoy
    const ya=(gastosPorFecha.get(f)||[]).find(e=>(Number(e.amount)||0)===monto&&!esBip(e.subcategory,e.concept)&&(personal?e.personal_de===personal||e.created_by===userName:(!userName||e.created_by===userName)))
    if(ya) return {fecha:ya.date,concept:ya.concept,amount:ya.amount}
    const otra=llenas.find(o=>o.id!==r.id&&rows.indexOf(o)<rows.indexOf(r)&&(o.date||hoy)===f&&(parseInt(o.amount)||0)===monto&&catDe(o)==='Movilización'&&!esBip(movMedio(o),o.concept))
    return otra?{fecha:f,concept:otra.concept,amount:otra.amount,enCarga:true}:null }
  const dupPend = llenas.filter(r=>dupDe(r)).length
  const deQueScope = r => personal?`p:${personal}`:(cliDe(r)?.id?String(cliDe(r).id):null)
  const gastoDeFila = r => { const cat=catDe(r)
    if(cat!=='Movilización'){ const dq=pideDeQue(r)&&String(r.deQue||'').trim()?deQueTexto(r.deQue):''
      return {concept:dq?`${String(r.concept||'').trim()} · ${dq}`:r.concept, subcategory:cat==='Otro'?subOtro(r.subcategory):null} }
    const md=movMedio(r), orig=String(r.concept||'').trim()
    if(!MEDIO_CON_DETALLE.has(md)) return {concept:orig||md, subcategory:md}
    const concept=glosaMovilizacion(r.mvDesde,r.mvHasta,r.mvMotivo)
    return {concept, subcategory:md, ...(orig.split(/\s+/).length>2&&orig!==concept?{notas:`Glosa original: ${orig}`}:{})} }
  const avisoDe = r => {
    if(r.resp) return null
    const cli=cliDe(r); if(!cli) return null
    const sug=sugerirCliente(r.concept,cli.id)
    if(_esOfiCli(cli)&&CATS_DE_CLIENTE.has(catDe(r))) return {bloquea:true,sug,motivo:`${catDe(r)==='Notaria'?'Los gastos de notaría':catDe(r)==='CBR'?'Los certificados del CBR':`Los gastos de ${catDe(r)}`} suelen ser de un cliente.`}
    return sug?{bloquea:false,sug,motivo:sug.motivo}:null
  }
  const faltaProyecto = !personal&&!esOficina&&!project.trim()&&llenas.some(r=>!r.cli)
  const faltaProyFila = llenas.some(r=>r.cli&&!_esOfiCli(r.cli)&&!r.proj)
  const bloqueadas = llenas.filter(r=>avisoDe(r)?.bloquea).length
  const puedeGuardar = (!!selectedClient||!!personal)&&llenas.length>0&&!faltaProyecto&&!faltaProyFila&&!bloqueadas&&!faltaMov&&!faltaDet&&!dupPend&&!saving

  const saveAll = async() => {
    if(!puedeGuardar) return
    setSaving(true)
    let count=0; const errores=[]
    if(personal){
      // Personal: sin cliente, sin proyecto; descuenta de la caja de quien carga y queda como deuda de la persona con la oficina.
      for(const r of llenas){ const cat=catDe(r)
        try{
          await onSave({client_id:null,personal_de:personal,type:'gasto',amount:parseInt(r.amount),category:cat,date:r.date||hoy,sale_id:null,entity_id:null,project:null,subproject:null,...gastoDeFila(r),paid_by_client:false},{keep:true})
          count++
          if(pideDeQue(r)&&String(r.deQue||'').trim()) aprenderDeQue(`p:${personal}`,deQueTexto(r.deQue))
          logActividad('gastos.personal',{tabla:'expenses',detalle:{title:r.concept||cat,persona:personal,monto:parseInt(r.amount)}})
        }catch(e){ errores.push(r.concept||cat||'Fila') }
      }
      if(errores.length) appAlert(`${errores.length} gasto(s) no se guardaron: ${errores.join(', ')}`)
      setSaved(count); setRows([nuevaFila()]); setPersonal(null); setQ(''); setSaving(false)
      return
    }
    for(const r of llenas) {
      const cli=cliDe(r); const cat=catDe(r); const proj=projDe(r)||null
      const vta=r.cli?(sales||[]).find(s=>s.client_id===cli.id&&s.title===proj):null
      const ent=r.cli?(vta?.entity_id||(clientEntities||[]).find(e=>e.client_id===cli.id)?.id||null):(entityId||null)
      try {
        await onSave({client_id:cli.id,type:'gasto',amount:parseInt(r.amount),category:cat,date:r.date||hoy,sale_id:null,entity_id:ent,project:proj,subproject:!r.cli&&esPermanente(ventaProj)&&subproject.trim()?subproject.trim():null,...gastoDeFila(r),paid_by_client:cat==='Notaria'},{keep:true})   // lo que carga el equipo es siempre caja chica; notaría va por su liquidación
        count++
        if(pideDeQue(r)&&String(r.deQue||'').trim()) aprenderDeQue(String(cli.id),deQueTexto(r.deQue))
        // Si se corrigió el cliente desde el aviso, la glosa queda aprendida para ese cliente.
        if(r.resp==='mov'){ const gk=glosaKey(r.concept||''); if(gk) learnPut('gasto_cliente',gk,cli.id) }
      } catch(e){ errores.push(r.concept||cat||'Fila') }
    }
    if(errores.length) appAlert(`${errores.length} gasto(s) no se guardaron: ${errores.join(', ')}`)
    setSaved(count)
    setRows([nuevaFila()])
    // Sin cliente fijo de origen, la siguiente carga parte eligiendo cliente (no arrastrar el anterior).
    if(!preClient){ setSelectedClient(null); setQ('') }
    setSaving(false)
  }

  const inS = {height:34,padding:'0 10px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:13.5,background:C.bgSoft,color:C.text,boxSizing:'border-box',outline:'none',width:'100%',fontFamily:'inherit'}
  const chip = (tone) => ({display:'inline-flex',alignItems:'center',height:24,padding:'0 12px',borderRadius:8,fontSize:12,fontWeight:700,whiteSpace:'nowrap',boxSizing:'border-box',cursor:'pointer',fontFamily:'inherit',
    ...(tone==='aviso1'?{background:C.avisoMid,color:C.avisoText,border:`1px solid ${C.avisoLine}`}:tone==='aviso2'?{background:'transparent',color:C.avisoText,border:'1px solid transparent'}:{background:C.azulTenue,color:C.accent,border:'1px solid transparent'})})
  const spark = <svg width='11' height='11' viewBox='0 0 24 24' fill={C.done} style={{flexShrink:0}} aria-label='Sugerido'><path d='M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z'/></svg>
  const diaInput = r => (
    <label style={{position:'relative',flexShrink:0,cursor:'pointer'}} title='Cambiar fecha'>
      {diaGrande(r.date)}
      <input type='date' value={r.date||hoy} onChange={e=>e.target.value&&updateRow(r.id,{date:e.target.value})} onClick={e=>{ try{ e.currentTarget.showPicker?.() }catch(_){} }} style={{position:'absolute',inset:0,opacity:0,width:'100%',height:'100%',cursor:'pointer',border:'none',padding:0}}/>
    </label>)
  const focusSig = id => setTimeout(()=>{ const ids=rows.map(r=>r.id); const i=ids.indexOf(id); const el=document.querySelectorAll('[data-gconcept]')[i+1]; el&&el.focus() },30)

  const filaCliente = r => {
    const ms=r.pq.trim()?(clients||[]).filter(c=>_normTxt(c.name).includes(_normTxt(r.pq))).slice(0,6):[]
    return (
      <div style={{position:'relative',marginTop:8}}>
        <Inp value={r.pq} onChange={e=>updateRow(r.id,{pq:e.target.value})} placeholder='Buscar cliente…' autoFocus style={{height:32,fontSize:13}}/>
        {ms.length>0&&<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginTop:4,maxHeight:220,overflowY:'auto'}}>
          {ms.map(c=><div key={c.id} onMouseDown={()=>moverFila(r,c)} style={{padding:'10px 12px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}>{c.name}</div>)}
        </div>}
      </div>)
  }
  const aviso = (r,a) => {
    const nombre=a.sug?.c?.name
    const txtCorto=nombre?`¿Es de ${nombre}?`:'¿De qué cliente es?'
    const txtLargo=a.bloquea?`${a.motivo}${a.sug?' '+a.sug.motivo:''} ${nombre?`¿Mover este gasto a ${nombre}?`:'¿De qué cliente es?'}`:`${a.motivo} ¿Mover este gasto a ${nombre}?`
    return (
      <div style={{marginTop:8,background:C.avisoBg,border:`1px solid ${C.avisoLine}`,borderRadius:8,padding:'7px 10px',color:C.avisoText,fontSize:12,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <span style={{flex:'1 1 auto',minWidth:0}}>{isDesktop?txtLargo:txtCorto}</span>
        <span style={{display:'flex',gap:6,marginLeft:'auto',flexWrap:'wrap'}}>
          {a.sug&&<button type='button' onClick={()=>moverFila(r,a.sug.c)} style={chip('aviso1')}>{a.bloquea?'Sí':'Sí, mover'}</button>}
          {a.bloquea&&<button type='button' onClick={()=>updateRow(r.id,{picking:true})} style={chip(a.sug?'aviso2':'aviso1')}>{a.sug?'Otro':'Elegir cliente'}</button>}
          <button type='button' onClick={()=>updateRow(r.id,{resp:'no'})} style={chip('aviso2')}>{a.bloquea?'Oficina':'No'}</button>
        </span>
      </div>)
  }
  // Sub-línea de la fila: categoría · cliente/proyecto si se movió · eliminar
  const selTxt = (value,label,opts,onChange,col,fw) => (
    <label style={{position:'relative',display:'inline-flex',alignItems:'center',gap:3,color:col||C.muted,fontWeight:fw||400,cursor:'pointer',whiteSpace:'nowrap',maxWidth:200,overflow:'hidden'}}>
      <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{label}</span><span style={{fontSize:9,opacity:.7}}><Gl n='chevD'/></span>
      <select value={value} onChange={e=>onChange(e.target.value)} style={{position:'absolute',inset:0,opacity:0,width:'100%',cursor:'pointer',fontSize:16}}>{opts}</select>
    </label>)
  const subLinea = (r,ultima) => {
    const cat=catDe(r)
    const sel={border:'none',background:'transparent',color:C.muted,fontSize:12,padding:0,fontFamily:'inherit',cursor:'pointer',outline:'none',maxWidth:140}
    return (
      <div style={{display:'flex',alignItems:'center',columnGap:12,rowGap:4,flexWrap:'wrap',fontSize:12,color:C.muted,minWidth:0}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
          {selTxt(cat,cat,CATS_GASTO.map(c=><option key={c} value={c}>{c}</option>),v=>updateRow(r.id,{category:v}))}
          {!r.category&&catAuto(r.concept)&&spark}
        </span>
        {cat==='Otro'&&r.category==='Otro'&&<input list='gasto-subcats' value={r.subcategory||''} onChange={e=>updateRow(r.id,{subcategory:e.target.value})} placeholder='Subcategoría' style={{...sel,borderBottom:`1px solid ${C.border}`,width:110,color:C.text}}/>}
        {r.cli&&<span style={{display:'inline-flex',alignItems:'center',gap:6,minWidth:0}}>
          <button type='button' onClick={()=>updateRow(r.id,{cli:null,proj:'',resp:null})} title='Volver al cliente del lote' style={{...sel,color:C.accent,fontWeight:600,maxWidth:220,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>→ {r.cli.name}</button>
          {!_esOfiCli(r.cli)&&selTxt(r.proj,r.proj||'Elegir proyecto',[<option key='' value=''>Elegir proyecto</option>,...projectsOf(r.cli.id).map(p=><option key={p} value={p}>{p}</option>)],v=>updateRow(r.id,{proj:v}),r.proj?C.muted:C.overdueText)}
        </span>}
        {!ultima&&<button type='button' onClick={()=>removeRow(r.id)} title='Eliminar' style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',padding:2,display:'flex',alignItems:'center'}}><TrashIcon/></button>}
      </div>)
  }
  const montoInput = (r,w) => <input inputMode='numeric' value={r.amount?Number(r.amount).toLocaleString('es-CL'):''} onChange={e=>updateRow(r.id,{amount:e.target.value.replace(/\D/g,'')})} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); focusSig(r.id) } }} placeholder='$0' style={{...inS,width:w,flexShrink:0,textAlign:'right',fontWeight:700,fontVariantNumeric:'tabular-nums'}}/>
  // Movilización: medio + desde + hasta + motivo (obligatorios). Lo que falta se marca en rojo suave.
  const lineaMov = r => { const fi=(k,ph,w)=>{ const v=r[k]||'', bad=!v.trim()||(k==='mvMotivo'&&v.trim().length<4)
      return <input value={v} onChange={e=>updateRow(r.id,{[k]:e.target.value})} placeholder={ph} style={{...inS,height:30,fontSize:12.5,flex:w,minWidth:0,borderColor:bad?C.overdueText:C.border}}/> }
    const md=movMedio(r)
    return (<div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6,marginTop:6,fontSize:12.5}}>
      {selTxt(md,md||'Elegir medio',[<option key='' value=''>Elegir medio</option>,...MEDIOS_MOV.map(m=><option key={m} value={m}>{m}</option>)],v=>updateRow(r.id,{mvMedio:v}),md?C.accent:C.overdueText,600)}
      {MEDIO_CON_DETALLE.has(md)&&<><div style={{display:'flex',gap:6,flex:'1 1 220px',minWidth:0}}>{fi('mvDesde','Desde',1)}{fi('mvHasta','Hasta',1)}</div>
      <div style={{display:'flex',flex:'2 1 220px',minWidth:0}}>{fi('mvMotivo','Motivo (para qué fue)',1)}</div></>}
    </div>) }
  const avisoDup = (r,d) => (
    <div style={{marginTop:8,background:C.avisoBg,border:`1px solid ${C.avisoLine}`,borderRadius:8,padding:'7px 10px',color:C.avisoText,fontSize:12,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <span style={{flex:'1 1 220px',minWidth:0}}>{d.enCarga?'Otra fila de esta carga tiene el mismo día y monto':`Ya hay un gasto parecido el ${fmtFechaDMY(d.fecha)}`}: «{d.concept||'sin glosa'}» {fmt(d.amount)}. ¿Es otro?</span>
      <span style={{display:'flex',gap:6,marginLeft:'auto'}}>
        <button type='button' onClick={()=>updateRow(r.id,{dupOk:true})} style={chip('aviso1')}>Es otro</button>
        <button type='button' onClick={()=>removeRow(r.id)} style={chip('aviso2')}>Quitar</button>
      </span>
    </div>)
  const lineaDeQue = r => { const op=deQueOpciones(deq,deQueScope(r),personal?null:cliDe(r)?.id,clientEntities), v=String(r.deQue||'')
    const falta=!v.trim()&&!!r.amount
    return (<div style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6,marginTop:6,fontSize:12}}>
      <span style={{fontWeight:700,color:falta?C.overdueText:C.accent,whiteSpace:'nowrap'}}>¿De qué?</span>
      {op.map(o=>{ const on=_normTxt(v)===_normTxt(o); return <button key={o} type='button' onClick={()=>updateRow(r.id,{deQue:on?'':o})} style={{...chip(),height:26,fontWeight:on?700:500,background:on?C.azulTenueOn:C.azulTenue,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis'}}>{o}</button> })}
      <input value={op.some(o=>_normTxt(o)===_normTxt(v))?'':v} onChange={e=>updateRow(r.id,{deQue:e.target.value})} placeholder={isDesktop?'Inmueble, sociedad o fs/N°/año':'o escribe…'} style={{...inS,height:28,fontSize:12.5,flex:'1 1 180px',minWidth:0,borderColor:falta?C.overdueText:C.border}}/>
    </div>) }
  const glosaInput = r => <input data-gconcept='1' value={r.concept} onChange={e=>updateRow(r.id,{concept:e.target.value})} placeholder='Descripción' style={{...inS,flex:1,minWidth:0}}/>

  const btnGuardar = (
    <button type='button' disabled={!puedeGuardar} onClick={saveAll} title={bloqueadas?'Responde el aviso para guardar':faltaProyecto||faltaProyFila?'Falta el proyecto':faltaMov?'Falta el medio o el trayecto y motivo de la movilización':faltaDet?'Falta de qué es (inmueble, sociedad o persona)':dupPend?'Responde el aviso de posible duplicado':undefined}
      style={{width:isDesktop?220:'100%',height:38,borderRadius:8,border:`1px solid ${C.azulTenueOn}`,background:C.azulTenueOn,color:C.accent,fontSize:13,fontWeight:700,cursor:puedeGuardar?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:puedeGuardar?1:.5,fontFamily:'inherit'}}>
      {saving?<Spin/>:null}{saving?'Guardando...':llenas.length>1?`Guardar ${llenas.length} gastos${personal?' personales':''}`:personal?'Guardar gasto personal':'Guardar gasto'}
    </button>)

  // ── Inicio de la carga (aún sin cliente): repetir lo frecuente, clientes recientes y por tipo — todo desde los gastos de quien carga.
  const misGastos = useMemo(()=>{ const m=gastosVivos.filter(e=>userName&&e.created_by===userName); return m.length?m:gastosVivos },[gastosVivos,userName])
  const cliById = useMemo(()=>new Map((clients||[]).map(c=>[c.id,c])),[clients])
  const nombreCli = c => _esOfiCli(c)?'Oficina':c.name
  const iniciales = c => _esOfiCli(c)?'OF':((_normTxt(c.name).split(' ').filter(w=>w.length>2&&!_NOM_GENERICO.has(w)).slice(0,2).map(w=>w[0]).join(''))||String(c.name||'').slice(0,2)).toUpperCase()
  const repetir = useMemo(()=>{
    const lim=new Date(); lim.setDate(lim.getDate()-120); const limS=lim.toISOString().slice(0,10); const g={}
    misGastos.forEach(e=>{ if(!e.client_id||!e.category||String(e.date||'')<limS) return; const c=cliById.get(e.client_id); if(!c) return; const k=e.client_id+'|'+e.category; (g[k]=g[k]||{c,cat:e.category,items:[]}).items.push(e) })
    const ahora=Date.now()
    // Frecuencia ponderada por cercanía: lo que más cargas y hace poco, primero.
    return Object.values(g).filter(x=>x.items.length>=2).map(x=>{ x.items.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))); const ult=x.items[0]; const ams=x.items.map(i=>Number(i.amount)||0).sort((a,b)=>a-b); const dias=Math.max(1,(ahora-new Date(ult.date).getTime())/864e5); return {...x,ult,med:ams[Math.floor(ams.length/2)],score:x.items.length/Math.sqrt(dias)} }).sort((a,b)=>b.score-a.score).slice(0,6)
  },[misGastos,cliById])
  const tipos = useMemo(()=>{ const cnt={},top={}
    misGastos.forEach(e=>{ if(!CATS_GASTO.includes(e.category)) return; cnt[e.category]=(cnt[e.category]||0)+1; if(e.client_id&&cliById.get(e.client_id)){ const t=top[e.category]||(top[e.category]={}); t[e.client_id]=(t[e.client_id]||0)+1 } })
    const orden=CATS_GASTO.filter(c=>c!=='Otro').sort((a,b)=>(cnt[b]||0)-(cnt[a]||0)).slice(0,5).concat('Otro')
    const clientesDe=cat=>Object.entries(top[cat]||{}).sort((a,b)=>b[1]-a[1]).map(([id])=>cliById.get(id)).filter(Boolean)
    return {orden,clientesDe}
  },[misGastos,cliById])
  const ultFecha = useMemo(()=>{ const m={}; misGastos.forEach(e=>{ if(e.client_id&&String(e.date||'')>(m[e.client_id]||'')) m[e.client_id]=String(e.date).slice(0,10) }); return m },[misGastos])
  // Gastos de clientes que cargó esta persona y siguen sin proyecto (regla: ningún gasto de cliente sin proyecto).
  const sinProyecto = useMemo(()=>{ if(!userName) return []; const m={}
    gastosVivos.forEach(e=>{ if(e.created_by!==userName||e.project||e.sale_id||!e.client_id) return; const c=cliById.get(e.client_id); if(!c||_esOfiCli(c)) return; (m[c.id]=m[c.id]||{c,n:0}).n++ })
    return Object.values(m).sort((a,b)=>b.n-a.n) },[gastosVivos,cliById,userName])
  const [tipo,setTipo] = useState(null)
  const [verSinProy,setVerSinProy] = useState(false)
  const buscRef = useRef(null)
  useEffect(()=>{ if(!isDesktop||selectedClient) return; const h=e=>{ if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement?.tagName||'')){ e.preventDefault(); buscRef.current&&buscRef.current.focus() } }; window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h) },[isDesktop,selectedClient])
  useEffect(()=>{ onLanding&&onLanding(!selectedClient&&!personal) },[selectedClient,personal])
  const elegirPersonal = p => {
    setSaved(0); setQ(''); setTipo(null); setSelectedClient(null); setPersonal(p); setRows([nuevaFila()])
    setTimeout(()=>{ const el=document.querySelector('[data-gconcept]'); el&&el.focus() },80)
  }
  const elegirCliente = (c,extra={}) => {
    setSaved(0); setQ(''); setTipo(null); setPersonal(null)
    if(extra.proj) preProjRef.current=extra.proj
    const fila={...nuevaFila(),...(extra.cat?{category:extra.cat}:{}),...(extra.concept?{concept:extra.concept}:{})}
    setRows(extra.concept?[fila,nuevaFila()]:[fila]); setSelectedClient(c)
    setTimeout(()=>{ const el=document.querySelector(extra.concept?'input[inputmode=numeric]':'[data-gconcept]'); el&&el.focus() },80)
  }
  const ICO_CAT = {
    'Movilización':<><path d='M5 17h14l-1.5-6h-11z'/><circle cx='8' cy='18' r='1.6'/><circle cx='16' cy='18' r='1.6'/><path d='M7 11l1.5-4h7l1.5 4'/></>,
    'CBR':<path d='M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6'/>,
    'Notaria':<><path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'/><path d='M14 3v5h5M9 14h6M9 17h4'/></>,
    'Registro Civil':<><rect x='3' y='5' width='18' height='14' rx='2'/><circle cx='9' cy='12' r='2.2'/><path d='M14 10h4M14 14h3'/></>,
    'Archivo Judicial':<path d='M4 7h16v13H4zM2 3h20v4H2zM10 12h4'/>,
    'Diario Oficial':<><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 7h8M8 11h8M8 15h5'/></>,
    'Otro':<><circle cx='6' cy='12' r='1.5'/><circle cx='12' cy='12' r='1.5'/><circle cx='18' cy='12' r='1.5'/></>,
  }
  const icoCat = (k,s=18) => <svg width={s} height={s} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>{ICO_CAT[k]||ICO_CAT.Otro}</svg>
  const catLbl = k => k==='Notaria'?'Notaría':k
  const secT = (t,extra) => <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,fontSize:11,fontWeight:700,letterSpacing:.6,textTransform:'uppercase',color:C.muted,margin:'18px 0 8px'}}><span>{t}</span>{extra}</div>
  const avatar = (c,s=46) => <div style={{width:s,height:s,borderRadius:'50%',background:_esOfiCli(c)?C.track:C.azulTenueOn,color:_esOfiCli(c)?C.muted:C.accent,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:s>40?15:12,flexShrink:0}}>{iniciales(c)}</div>
  const fechaCorta = d => { const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; const s=String(d||'').slice(0,10).split('-'); return s.length===3?`${+s[2]} ${M[+s[1]-1]}`:'' }
  const hov = (on,off) => ({onMouseEnter:e=>{e.currentTarget.style.background=on}, onMouseLeave:e=>{e.currentTarget.style.background=off}})
  const btnReset = {border:'none',fontFamily:'inherit',cursor:'pointer',textAlign:'left'}
  const listaCli = (lista) => (
    <div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginTop:8}}>
      {lista.map((c,i)=><button key={c.id} type='button' onClick={()=>elegirCliente(c,tipo?{cat:tipo}:{})} {...hov(C.bgSoft,C.surface)} style={{...btnReset,width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:C.surface,borderTop:i?`1px solid ${C.track}`:'none',minHeight:48}}>
        {avatar(c,32)}<span style={{flex:1,minWidth:0,fontSize:14,fontWeight:500,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nombreCli(c)}</span>
        {ultFecha[c.id]&&<span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap'}}>{fechaCorta(ultFecha[c.id])}</span>}
      </button>)}
    </div>)
  const buscador = (
    <>
      <div style={{display:'flex',alignItems:'center',gap:8,height:44,borderRadius:12,background:C.bgSoft,border:`1px solid ${C.border}`,padding:'0 14px',boxSizing:'border-box'}}>
        <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2.2' style={{flexShrink:0}}><circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/></svg>
        <input ref={buscRef} value={q} onChange={e=>setQ(e.target.value)} placeholder='¿Para qué cliente?' style={{...fInp,fontSize:15,height:40}}/>
        {isDesktop&&!q&&<span style={{fontSize:11,color:C.textSoft,border:`1px solid ${C.border}`,borderRadius:6,padding:'1px 6px',background:C.surface}}>/</span>}
      </div>
      {q.trim()&&(matches.length?listaCli(matches):<div style={{fontSize:12.5,color:C.textSoft,padding:'10px 4px'}}>Sin coincidencias</div>)}
    </>)
  const tipoVista = tipo&&(
    <>
      <div style={{display:'flex',alignItems:'center',gap:8,marginTop:14}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:6,height:30,padding:'0 10px',borderRadius:8,background:C.azulTenue,color:C.accent,fontSize:13,fontWeight:700}}>{icoCat(tipo,15)}{catLbl(tipo)}</span>
        <button type='button' onClick={()=>setTipo(null)} style={{...btnReset,background:'none',color:C.muted,fontSize:12.5,padding:'4px 6px'}}>Quitar</button>
      </div>
      {secT(`Clientes con ${catLbl(tipo)}`)}
      {listaCli((tipos.clientesDe(tipo).length?tipos.clientesDe(tipo):recientes).slice(0,8))}
    </>)
  const totSP = sinProyecto.reduce((a,x)=>a+x.n,0)
  const avisoSinProy = totSP>0&&onIrCliente&&(
    <div style={{marginTop:14}}>
      <button type='button' onClick={()=>setVerSinProy(v=>!v)} style={{...btnReset,width:'100%',display:'flex',alignItems:'center',gap:8,background:C.avisoBg,border:`1px solid ${C.avisoLine}`,color:C.avisoText,borderRadius:10,padding:'9px 12px',fontSize:12.5,minHeight:40}}>
        <span>{totSP} gasto{totSP!==1?'s':''} tuyo{totSP!==1?'s':''} sin proyecto</span><b style={{marginLeft:'auto',whiteSpace:'nowrap'}}>{verSinProy?'Ocultar':<>Completar{" "}<Gl n='chevron'/></>}</b>
      </button>
      {verSinProy&&<div style={{border:`1px solid ${C.border}`,borderRadius:10,marginTop:6,overflow:'hidden'}}>
        {sinProyecto.map((x,i)=><button key={x.c.id} type='button' onClick={()=>onIrCliente(x.c.id)} {...hov(C.bgSoft,C.surface)} style={{...btnReset,width:'100%',display:'flex',justifyContent:'space-between',gap:8,padding:'10px 12px',background:C.surface,borderTop:i?`1px solid ${C.track}`:'none',fontSize:13,color:C.text}}>
          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.c.name}</span><span style={{color:C.muted,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{x.n} <Gl n='chevron'/></span>
        </button>)}
      </div>}
    </div>)
  const bloquePersonal = equipo.length>0&&(
    <>
      {secT('Gasto personal de')}
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {equipo.map(p=>{ const pc=personChip(p); return (
          <button key={p} type='button' onClick={()=>elegirPersonal(p)} {...hov(C.bgSoft,C.surface)} style={{...btnReset,display:'inline-flex',alignItems:'center',gap:7,height:36,padding:'0 12px 0 5px',borderRadius:10,background:C.surface,border:`1px solid ${C.border}`,fontSize:13,fontWeight:600,color:C.text}}>
            <span style={{width:26,height:26,borderRadius:8,background:pc.bg,color:pc.color,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700}}>{INICIALES_RESP[p]||p.slice(0,2).toUpperCase()}</span>{p}
          </button>) })}
      </div>
    </>)
  const tarjetaRep = x => (
    <button key={x.c.id+x.cat} type='button' onClick={()=>elegirCliente(x.c,{cat:x.cat,concept:x.ult.concept||'',proj:x.ult.project||null})} style={{...btnReset,background:C.azulTenue,borderRadius:14,padding:12,minHeight:86,display:'flex',flexDirection:'column',justifyContent:'space-between',minWidth:0}}>
      <div style={{minWidth:0}}><div style={{fontSize:14,fontWeight:700,color:C.accent,lineHeight:1.2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nombreCli(x.c)}</div><div style={{fontSize:12,color:C.muted,marginTop:2}}>{catLbl(x.cat)}</div></div>
      <div style={{marginTop:6,minWidth:0}}>
        <div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.ult.concept}</div>
        <div style={{textAlign:'right',fontSize:13,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums',marginTop:2}}>{fmt(x.med)}</div>
      </div>
    </button>)
  const filaRep = (x,i) => (
    <button key={x.c.id+x.cat} type='button' onClick={()=>elegirCliente(x.c,{cat:x.cat,concept:x.ult.concept||'',proj:x.ult.project||null})} {...hov(C.bgSoft,C.surface)} style={{...btnReset,width:'100%',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1.5fr) 84px',gap:12,alignItems:'center',padding:'10px 14px',background:C.surface,borderTop:i?`1px solid ${C.track}`:'none'}}>
      <span style={{fontWeight:600,color:C.accent,fontSize:13.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nombreCli(x.c)}</span>
      <span style={{fontSize:12.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.ult.concept}<span style={{color:C.textSoft}}> · {catLbl(x.cat)}</span></span>
      <span style={{textAlign:'right',fontWeight:700,fontSize:13,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(x.med)}</span>
    </button>)
  const landing = isDesktop ? (
    <>
      {buscador}
      {!q.trim()&&(tipo?tipoVista:(
        <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.55fr) minmax(0,1fr)',gap:24}}>
          <div style={{minWidth:0}}>
            {repetir.length>0&&<>{secT('Repetir un gasto')}<div style={{border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>{repetir.map(filaRep)}</div></>}
            {secT('Por tipo')}
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {tipos.orden.map(k=>{ const tc=tipos.clientesDe(k)[0]; return <button key={k} type='button' onClick={()=>setTipo(k)} {...hov(C.azulTenueOn,C.azulTenue)} style={{...btnReset,display:'inline-flex',alignItems:'center',gap:6,height:30,padding:'0 12px',borderRadius:8,background:C.azulTenue,color:C.accent,fontSize:12.5,fontWeight:700}}>{icoCat(k,14)}{catLbl(k)}{tc&&<span style={{fontWeight:500,color:C.muted}}>{nombreCli(tc)}</span>}</button> })}
            </div>
          </div>
          <div style={{minWidth:0}}>
            {recientes.length>0&&<>{secT('Clientes recientes')}{listaCli(recientes)}</>}
            {bloquePersonal}
            {avisoSinProy}
          </div>
        </div>))}
    </>
  ) : (
    <>
      {buscador}
      {!q.trim()&&(tipo?tipoVista:(
        <>
          {repetir.length>0&&<>{secT('Repetir')}<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{repetir.slice(0,4).map(tarjetaRep)}</div></>}
          {recientes.length>0&&<>{secT('Clientes recientes')}
            <div style={{display:'flex',gap:8,overflowX:'auto',paddingBottom:4,scrollbarWidth:'none',margin:'0 -4px'}}>
              {recientes.map(c=><button key={c.id} type='button' onClick={()=>elegirCliente(c)} style={{...btnReset,background:'none',flex:'0 0 auto',width:70,display:'flex',flexDirection:'column',alignItems:'center',gap:5,padding:0}}>
                {avatar(c)}<span style={{fontSize:11.5,color:C.text,textAlign:'center',lineHeight:1.2,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{nombreCli(c)}</span>
              </button>)}
            </div></>}
          {secT('Por tipo')}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
            {tipos.orden.map(k=><button key={k} type='button' onClick={()=>setTipo(k)} style={{...btnReset,background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:12,height:62,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,fontSize:12,fontWeight:600,color:C.accent,textAlign:'center'}}><span style={{color:C.muted,display:'flex'}}>{icoCat(k)}</span>{catLbl(k)}</button>)}
          </div>
          {bloquePersonal}
          {avisoSinProy}
        </>))}
    </>)

  return (
    <>
      {!sinCabecera&&<div style={{display:'flex',alignItems:'center',gap:9,marginBottom:14}}>
        <button className='qt-volver' onClick={onClose} aria-label='Volver' style={{display:'flex',alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',padding:'2px 6px 2px 0',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>
        <div style={{fontSize:16,fontWeight:600,color:C.accent}}>Registrar gastos</div>
      </div>}
      {saved>0&&!selectedClient&&<div style={{fontSize:12,color:C.greenText,marginBottom:8,fontWeight:600}}>{saved} gasto{saved!==1?'s':''} guardado{saved!==1?'s':''}</div>}
      {!selectedClient&&!personal&&landing}

      {(selectedClient||personal)&&(
        <>
          {saved>0&&<div style={{fontSize:12,color:C.greenText,marginBottom:8,fontWeight:600}}>{saved} gasto{saved!==1?'s':''} guardado{saved!==1?'s':''}</div>}
          {personal?(
          <div style={{display:'grid',gridTemplateColumns:isDesktop?'1fr 1fr':'1fr',columnGap:10}}>
            <FloatFld label='Personal de'>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,height:24}}>
                <span style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:14,color:C.text,minWidth:0}}>{(()=>{ const pc=personChip(personal); return <span style={{width:22,height:22,borderRadius:7,background:pc.bg,color:pc.color,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9.5,fontWeight:700,flexShrink:0}}>{INICIALES_RESP[personal]||personal.slice(0,2).toUpperCase()}</span> })()}{personal}</span>
                <button type='button' onClick={()=>setPersonal(null)} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',padding:0,fontFamily:'inherit'}}>Cambiar</button>
              </div>
            </FloatFld>
          </div>
          ):<>
          {balance!=null&&balance<=0&&!esOficina&&(
            <div style={{fontSize:12,color:C.avisoText,background:C.avisoBg,border:`1px solid ${C.avisoLine}`,borderRadius:8,padding:'8px 11px',marginBottom:8,lineHeight:1.4}}>
              <b>{selectedClient.name}</b> no tiene fondos. Pídele a Erasmo o Cristóbal que los soliciten.
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:isDesktop?'1fr 1fr':'1fr',columnGap:10}}>
            <FloatFld label='Cliente'>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,height:24}}>
                <span style={{fontSize:14,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedClient.name}</span>
                <button type='button' onClick={()=>setSelectedClient(null)} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer',padding:0,fontFamily:'inherit'}}>Cambiar</button>
              </div>
            </FloatFld>
            <FloatFld label={esOficina?'Proyecto (opcional)':'Proyecto'}>
              {clientProjects.length===0||newProject?(
                <input value={project} onChange={e=>{setProject(e.target.value);setProjAuto(false)}} placeholder='Nombre del proyecto' autoFocus={newProject} style={fInp}/>
              ):(
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <select value={project} onChange={e=>{ if(e.target.value==='__nuevo'){ setNewProject(true); setProject('') } else setProject(e.target.value); setProjAuto(false) }} style={{...fInp,flex:1,minWidth:0,color:project?C.text:faltaProyecto?C.overdueText:C.done,cursor:'pointer',appearance:'none',WebkitAppearance:'none'}}>
                    <option value=''>Elegir proyecto</option>
                    {clientProjects.map(p=><option key={p} value={p}>{p}</option>)}
                    <option value='__nuevo'>+ Nuevo proyecto</option>
                  </select>
                  {projAuto&&project&&spark}
                </div>
              )}
            </FloatFld>
            {rsList.length>1&&<FloatFld label='Razón social'>
              <select value={entityId} onChange={e=>setEntityId(e.target.value)} style={{...fInp,cursor:'pointer',appearance:'none',WebkitAppearance:'none'}}>
                {rsList.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </FloatFld>}
            {esPermanente(ventaProj)&&<FloatFld label='Subproyecto'>
              <input value={subproject} onChange={e=>setSubproject(e.target.value)} list='gasto-subproy' placeholder='Ej: Campos, Marcas…' style={fInp}/>
              <datalist id='gasto-subproy'>{subsCli.map(x=><option key={x} value={x}/>)}</datalist>
            </FloatFld>}
          </div>
          </>}

          <div style={{border:`1px solid ${C.border}`,borderRadius:12,marginTop:4}}>
            {rows.map((r,i)=>{ const ultima=i===rows.length-1&&!r.concept&&!r.amount; const a=!ultima&&r.amount?avisoDe(r):null
              return (
                <div key={r.id} style={{padding:'10px 12px',borderTop:i?`1px solid ${C.track}`:'none'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    {diaInput(r)}
                    {glosaInput(r)}
                    {montoInput(r,isDesktop?120:86)}
                  </div>
                  {!ultima&&<div style={{marginTop:6,marginLeft:54}}>{subLinea(r,ultima)}</div>}
                  {(!ultima||r.category==='Movilización')&&catDe(r)==='Movilización'&&<div style={{marginLeft:54}}>{lineaMov(r)}</div>}
                  {!ultima&&pideDeQue(r)&&<div style={{marginLeft:54}}>{lineaDeQue(r)}</div>}
                  {a&&!r.picking&&<div style={{marginLeft:54}}>{aviso(r,a)}</div>}
                  {!ultima&&(()=>{ const d=dupDe(r); return d?<div style={{marginLeft:54}}>{avisoDup(r,d)}</div>:null })()}
                  {r.picking&&<div style={{marginLeft:54}}>{filaCliente(r)}</div>}
                </div>)
            })}
            <datalist id='gasto-subcats'>
              {[...new Set((expenses||[]).filter(e=>e.subcategory).map(e=>e.subcategory))].sort().map(s=><option key={s} value={s}/>)}
            </datalist>
          </div>
        </>
      )}

      {(selectedClient||personal)&&<div style={{display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:isDesktop?'flex-end':'stretch',gap:10,marginTop:12}}>
        {faltaDet>0&&<span style={{fontSize:12,color:C.overdueText,width:isDesktop?'auto':'100%',textAlign:isDesktop?'right':'center'}}>{faltaDet===1?'1 gasto: falta de qué es':`${faltaDet} gastos: falta de qué son`}</span>}
        {btnGuardar}</div>}
    </>
  )
}

