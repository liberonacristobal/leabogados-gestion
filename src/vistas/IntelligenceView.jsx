// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { C, Gl, SEC_LBL, appAlert, fmt, personChip, useIsDesktop } from '../lib/base.jsx'
import { Copyable, Modal, NOMBRE_CLI, PageHeader, PorSocioVista, UF_FALLBACK, chipBtn, claudeCall, cobradoBill, comisionesVenta, currentYear, esRecurrente, esSubarriendo, fmtShort, fmtUFk, margenPct, readUFCache, rsDisplay, rsLabel, saldoBill, ventaCuentaEnAnio, ventaHistoricaUF, ventaUF } from '../lib/compartido.jsx'

// Última actividad del cliente: fecha más reciente entre ventas, facturas (no anuladas) y gastos.
export const ultimaActividad = (clientId, sales, billing, expenses) => {
  const ds=[]
  ;(sales||[]).filter(s=>String(s.client_id)===String(clientId)).forEach(s=>{ const d=s.activated_at||s.created_at||(s.year?`${s.year}-${String(s.month||1).padStart(2,'0')}-01`:null); if(d) ds.push(String(d).slice(0,10)) })
  ;(billing||[]).filter(b=>String(b.client_id)===String(clientId)&&b.status!=='Anulada'&&!b.deleted_at).forEach(b=>{ const d=b.paid_at||b.issued_at||b.due; if(d) ds.push(String(d).slice(0,10)) })
  ;(expenses||[]).filter(e=>String(e.client_id)===String(clientId)).forEach(e=>{ if(e.date) ds.push(String(e.date).slice(0,10)) })
  return ds.length ? ds.sort().slice(-1)[0] : null
}

// ─── SALES VIEW ───────────────────────────────────────────────────────────────
// ─── INTELIGENCIA DE NEGOCIOS (MVP) ───────────────────────────────────────────
// Solo admin. KPIs sólidos + Oportunidades accionables calculadas con helpers fuente única.
// El código calcula; el Resumen IA (claudeCall) se suma en una etapa siguiente.
export const IA_SPK = (<svg width='10' height='10' viewBox='0 0 24 24' fill='currentColor' style={{display:'inline-block',verticalAlign:'-1px',marginRight:4}}><path d='M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z'/></svg>)

export function IntelligenceView({sales=[], billing=[], clients=[], clientEntities=[], expenses=[], terceros=[], anticipos=[], fantasmaIds=null, setTab, onOpenClientFicha, onOpenSale, navTo, onBack, backLabel}){
  const go = t => navTo ? navTo({tab:t}) : (setTab&&setTab(t))   // salto que apila origen+scroll (navTo) con fallback a setTab
  const isDesktop = useIsDesktop()   // Fase 3: columna centrada más ancha en escritorio
  const [openOpp,setOpenOpp] = useState(null)
  const [openSeg,setOpenSeg] = useState(null)   // segmento de cartera abierto
  const [openArea,setOpenArea] = useState(null)   // área de servicios abierta
  const [biSec,setBiSec] = useState(null)       // sección del índice abierta (hub): oport|cartera|servicios|tendencias|ia
  const [openFoco,setOpenFoco] = useState(null) // foco del SII expandido en el héroe
  const [radarOpen,setRadarOpen] = useState(()=>{ try{ if(sessionStorage.getItem('abrir_radar')){ sessionStorage.removeItem('abrir_radar'); return true } }catch(_){} return false }) // replegada por defecto (evita el muro de novedades); abierta si se llega desde el aviso de normativa
  const [briefBusy,setBriefBusy] = useState(false)  // generando brief IA del foco
  const [memoBusy,setMemoBusy] = useState(false)    // generando memo de conversación
  const [memoText,setMemoText] = useState(null)     // memo generado (editable)
  const [iaResumen,setIaResumen] = useState(null)   // narrativa IA "foco de la semana"
  const [iaBusy,setIaBusy] = useState(false)
  const [planAnio,setPlanAnio] = useState(null)     // "Plan del Año" (interno + outlook SII)
  const [planBusy,setPlanBusy] = useState(false)
  const [pregunta,setPregunta] = useState('')       // "pregúntale al negocio"
  const [respuesta,setRespuesta] = useState(null)
  const [pregBusy,setPregBusy] = useState(false)
  const [siiNov,setSiiNov] = useState([])           // Radar tributario: novedades del SII (Stage 7)
  const cargarSii = ()=> DEMO ? setSiiNov(demoData.sii_novedades||[]) : supabase.from('sii_novedades').select('*').then(({data})=>setSiiNov(data||[]),()=>{})
  const [radarBusy,setRadarBusy] = useState(false)  // llamada a la edge function sii-radar (auto-ingesta)
  const [radarMsg,setRadarMsg] = useState(null)
  const actualizarRadar = async () => {
    setRadarBusy(true); setRadarMsg(null)
    try{
      const {data:{session}} = await supabase.auth.getSession()
      if(!session) throw new Error('Sesión expirada. Vuelve a entrar.')
      const resp = await fetch('https://kibuwhtpoxrnfowfdolu.supabase.co/functions/v1/sii-radar',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':supabase.supabaseKey},
        body:JSON.stringify({})
      })
      const data = await resp.json().catch(()=>({}))
      if(!resp.ok) throw new Error(data.error||('Error '+resp.status))
      await cargarSii()
      const errs=(data.errores||[]).length
      setRadarMsg(`${data.inserted||0} nuevas${errs?` · ${errs} fuente(s) con error`:''}`)
    }catch(e){ setRadarMsg('Error: '+(e?.message||'reintenta')) }
    setRadarBusy(false)
  }
  useEffect(()=>{ cargarSii() },[])
  const [addOpen,setAddOpen] = useState(false)      // "Agregar novedad SII"
  const [addForm,setAddForm] = useState({tipo:'circular',numero:'',fecha:'',titulo:'',url:'',resumen:'',prioridad:'media',areas:[]})
  const [addBusy,setAddBusy] = useState(false)
  const [iaAreasBusy,setIaAreasBusy] = useState(false)
  const areasFirma = useMemo(()=>[...new Set((sales||[]).filter(s=>['Activo','Terminado'].includes(s.status)).map(s=>s.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es')),[sales])
  const ufRef = (readUFCache()?.value) || (sales.find(s=>s.uf_value>0)?.uf_value) || UF_FALLBACK
  const yr = currentYear
  const hoy = new Date().toISOString().slice(0,10)
  const mesesDesde = d => { if(!d) return 999; const a=new Date(hoy), b=new Date(String(d).slice(0,10)); if(isNaN(b.getTime())) return 999; return (a.getFullYear()-b.getFullYear())*12+(a.getMonth()-b.getMonth()) }

  const {kpis, opp, cartera, carteraTot, servicios, serviciosTot, ventasSinCosto, tendencias} = useMemo(()=>{
    const reales = (clients||[]).filter(c=>!c.is_internal&&!c.is_occasional)
    const vh = id => ventaHistoricaUF(id, sales, ufRef)
    const ult = id => ultimaActividad(id, sales, billing, expenses)
    const areasDe = id => [...new Set((sales||[]).filter(s=>String(s.client_id)===String(id)&&['Activo','Terminado'].includes(s.status)).map(s=>s.area).filter(Boolean))]
    const tieneRec = id => (sales||[]).some(s=>String(s.client_id)===String(id)&&esRecurrente(s))

    const dormidos = reales.filter(c=>(c.status||'Activo')==='Activo'&&mesesDesde(ult(c.id))>=9&&vh(c.id)>=20).map(c=>({c,uf:vh(c.id),meses:mesesDesde(ult(c.id))})).sort((a,b)=>b.uf-a.uf)
    const venc={}; (billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&b.status==='Vencido').forEach(b=>{ venc[b.client_id]=(venc[b.client_id]||0)+saldoBill(b) })
    const cobranza = Object.entries(venc).map(([cid,monto])=>({c:(clients||[]).find(x=>String(x.id)===String(cid))||{id:cid,name:'Sin cliente'},monto})).filter(x=>x.monto>0).sort((a,b)=>b.monto-a.monto)
    const crossSell = reales.filter(c=>(c.status||'Activo')==='Activo'&&areasDe(c.id).length===1&&vh(c.id)>=30).map(c=>({c,uf:vh(c.id),area:areasDe(c.id)[0]})).sort((a,b)=>b.uf-a.uf)
    const sinRec = reales.filter(c=>(c.status||'Activo')==='Activo'&&!tieneRec(c.id)&&vh(c.id)>=50).map(c=>({c,uf:vh(c.id)})).sort((a,b)=>b.uf-a.uf)
    const winback = reales.filter(c=>c.status==='Terminado'&&vh(c.id)>=30&&mesesDesde(ult(c.id))<=18).map(c=>({c,uf:vh(c.id),meses:mesesDesde(ult(c.id))})).sort((a,b)=>b.uf-a.uf)

    const vendidoYTD = (sales||[]).filter(s=>!s.deleted_at&&['Activo','Terminado'].includes(s.status)&&!esSubarriendo(s)&&ventaCuentaEnAnio(s,yr)).reduce((a,s)=>a+ventaUF(s,ufRef),0)   // fuente única con Inicio/Ventas: Activo+Terminado, sin subarriendo
    const porCobrar = (billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&['Pendiente','Vencido'].includes(b.status)).reduce((a,b)=>a+saldoBill(b),0)
    const cobradoYTD = (billing||[]).filter(b=>!b.deleted_at&&b.billing_type!=='reembolso'&&cobradoBill(b)>0&&String((b.status==='Pagado'?b.paid_at:b.issued_at)||'').slice(0,4)===String(yr)).reduce((a,b)=>a+cobradoBill(b),0)   // incluye parciales (fuente única, coincide con fichas/dashboard)
    // Cartera: TODOS los no-internos segmentados por salud (cascada, cada cliente cae en uno). Terminados fuera.
    const noInt = (clients||[]).filter(c=>!c.is_internal)
    const segCli = c => {
      if(c.is_occasional) return 'ocasional'
      if(c.status==='Terminado') return null
      const meses = mesesDesde(ult(c.id))
      if(meses>=9) return 'dormido'
      if((venc[c.id]||0)>0 || meses>=4) return 'riesgo'
      return 'sano'
    }
    const cartera = {sano:[],riesgo:[],dormido:[],ocasional:[]}
    noInt.forEach(c=>{ const s=segCli(c); if(!s) return; cartera[s].push({c, uf:vh(c.id), meses:mesesDesde(ult(c.id)), area:areasDe(c.id)[0]||'—', rec:tieneRec(c.id), saldoVenc:venc[c.id]||0}) })
    Object.keys(cartera).forEach(k=>cartera[k].sort((a,b)=>b.uf-a.uf))
    const ufSeg = k => cartera[k].reduce((a,x)=>a+x.uf,0)
    const carteraTot = {activos: cartera.sano.length+cartera.riesgo.length+cartera.dormido.length, ufTotal: ['sano','riesgo','dormido','ocasional'].reduce((a,k)=>a+ufSeg(k),0), ufSeg:{sano:ufSeg('sano'),riesgo:ufSeg('riesgo'),dormido:ufSeg('dormido'),ocasional:ufSeg('ocasional')}}

    // Servicios y Precios: por área (venta, ticket, recurrencia, rango, clientes). Activo+Terminado.
    const ventasReales = (sales||[]).filter(s=>!s.deleted_at&&['Activo','Terminado'].includes(s.status)&&!esSubarriendo(s))
    const areaAgg = {}
    const comUFv = s => { const u=parseFloat(s.uf_value)||ufRef; return u>0 ? comisionesVenta(s,terceros,billing,ufRef).anual/u : 0 }   // comisiones reales (o pactadas) en UF de la venta — fuente única
    ventasReales.forEach(s=>{ const a=s.area||'Sin área'; const u=ventaUF(s,ufRef); const co=comUFv(s); if(!areaAgg[a]) areaAgg[a]={uf:0,costo:0,conCosto:0,n:0,rec:0,tickets:[],byCli:{}}; const A=areaAgg[a]; A.uf+=u; A.costo+=co; if(co>0) A.conCosto++; A.n++; if(esRecurrente(s)) A.rec++; if(u>0) A.tickets.push(u); if(s.client_id) A.byCli[s.client_id]=(A.byCli[s.client_id]||0)+u })
    const servicios = Object.entries(areaAgg).map(([area,d])=>({ area, uf:d.uf, costo:d.costo, margen:d.uf-d.costo, margenPct:d.uf>0?(d.uf-d.costo)/d.uf*100:0, conCosto:d.conCosto, n:d.n, ticket:d.n?d.uf/d.n:0, recPct:d.n?Math.round(d.rec/d.n*100):0, min:d.tickets.length?Math.min(...d.tickets):0, max:d.tickets.length?Math.max(...d.tickets):0, clientes:Object.entries(d.byCli).map(([cid,uf])=>({cid,uf,name:((clients||[]).find(c=>String(c.id)===String(cid))||{}).name||'—'})).sort((a,b)=>b.uf-a.uf) })).sort((a,b)=>b.uf-a.uf)
    const costoTot = servicios.reduce((a,s)=>a+s.costo,0), ufTot = servicios.reduce((a,s)=>a+s.uf,0)
    const serviciosTot = {areas:servicios.length, uf:ufTot, costo:costoTot, margen:ufTot-costoTot, conCosto:ventasReales.filter(s=>comUFv(s)>0).length, nTotal:ventasReales.length}
    // Ventas sin costo cargado (Activo+Terminado): el margen no es representativo hasta cargar su reparto de terceros.
    const ventasSinCosto = ventasReales.filter(s=>comUFv(s)<=0).sort((a,b)=>ventaUF(b,ufRef)-ventaUF(a,ufRef))

    // Tendencias: crecimiento año vs año anterior (total y por abogado). Complementa (no duplica) Ventas-por-mes ni Servicios.
    const prevYr = yr-1
    // Misma base que Vendido (Inicio/Ventas/Por socio): Activo+Terminado, sin subarriendo, ventaCuentaEnAnio; mismo dueño que Por socio.
    const vYear = y => (sales||[]).filter(s=>!s.deleted_at&&['Activo','Terminado'].includes(s.status)&&!esSubarriendo(s)&&ventaCuentaEnAnio(s,y))
    const cliAbo={}; (clients||[]).forEach(c=>{ if(c) cliAbo[String(c.id)]=c.abogado_responsable })
    const sumBy = (arr,fn)=>{ const m={}; arr.forEach(s=>{ const k=fn(s)||'—'; m[k]=(m[k]||0)+ventaUF(s,ufRef) }); return m }
    const curY=vYear(yr), prvY=vYear(prevYr)
    const totCur=curY.reduce((a,s)=>a+ventaUF(s,ufRef),0), totPrv=prvY.reduce((a,s)=>a+ventaUF(s,ufRef),0)
    const resp=s=>s.responsible||cliAbo[String(s.client_id)], abCur=sumBy(curY,resp), abPrv=sumBy(prvY,resp)
    const dl=(cur,prv)=>[...new Set([...Object.keys(cur),...Object.keys(prv)])].map(k=>({k,cur:cur[k]||0,prv:prv[k]||0,pct:(prv[k]||0)>0?Math.round(((cur[k]||0)-(prv[k]||0))/(prv[k]||0)*100):null})).filter(x=>x.cur>0||x.prv>0).sort((a,b)=>b.cur-a.cur)
    const tendencias={prevYr,totCur,totPrv,pctTot: totPrv>0?Math.round((totCur-totPrv)/totPrv*100):null, abogados:dl(abCur,abPrv)}
    return {kpis:{vendidoYTD,porCobrar,cobradoYTD}, opp:{dormidos,cobranza,crossSell,sinRec,winback}, cartera, carteraTot, servicios, serviciosTot, ventasSinCosto, tendencias}
  },[sales,billing,clients,expenses,ufRef,yr])

  // Radar tributario (Stage 7): cruza cada novedad del SII con los clientes cuya área coincide con la(s) área(s) de la novedad.
  const radar = useMemo(()=>{
    if(!(siiNov||[]).length) return []
    const reales = (clients||[]).filter(c=>!c.is_internal)
    const areasDe = id => [...new Set((sales||[]).filter(s=>String(s.client_id)===String(id)&&['Activo','Terminado'].includes(s.status)).map(s=>s.area).filter(Boolean))]
    const cliAreas = {}; reales.forEach(c=>{ cliAreas[c.id]=areasDe(c.id) })
    return (siiNov||[]).filter(n=>n.vigente!==false).map(n=>{
      const areas=n.areas||[]
      const expuestos = areas.length ? reales.filter(c=>(cliAreas[c.id]||[]).some(a=>areas.includes(a))).map(c=>({id:c.id,name:c.name,uf:ventaHistoricaUF(c.id,sales,ufRef)})).sort((a,b)=>b.uf-a.uf) : []
      return {...n, expuestos}
    }).sort((a,b)=> (b.expuestos.length-a.expuestos.length) || (String(b.fecha||'')).localeCompare(String(a.fecha||'')))
  },[siiNov,sales,clients,ufRef])

  const OPPS = [
    {k:'dormidos', col:C.soonText, t:'Clientes dormidos', sub:'Activos 9+ meses sin actividad', rows:opp.dormidos, metric:x=>`${fmtUFk(x.uf)} · ${x.meses}m`, val:x=>fmtUFk(x.uf), ctx:x=>`sin actividad hace ${x.meses}m`},
    {k:'cobranza', col:C.overdue, t:'Cobranza vencida', sub:'Saldo vencido por cliente', rows:opp.cobranza, metric:x=>fmt(x.monto), val:x=>fmt(x.monto), ctx:x=>'saldo vencido'},
    {k:'cross', col:C.accent, t:'Cross-sell', sub:'Una sola área de servicio', rows:opp.crossSell, metric:x=>`${fmtUFk(x.uf)} · ${x.area}`, val:x=>fmtUFk(x.uf), ctx:x=>`solo ${x.area}`},
    {k:'sinrec', col:C.azulInfo, t:'Top sin recurrencia', sub:'Valiosos sin plan mensual', rows:opp.sinRec, metric:x=>fmtUFk(x.uf), val:x=>fmtUFk(x.uf), ctx:x=>'sin plan mensual'},
    {k:'winback', col:C.normal, t:'Win-back', sub:'Terminados recuperables (≤18m)', rows:opp.winback, metric:x=>`${fmtUFk(x.uf)} · ${x.meses}m`, val:x=>fmtUFk(x.uf), ctx:x=>`terminado hace ${x.meses}m`},
  ]
  const kpiCard = (label,val,col,onClick) => (<div onClick={onClick} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'8px 10px',cursor:onClick?'pointer':'default',position:'relative'}}><div style={{...SEC_LBL}}>{label}</div><div style={{fontSize:16,fontWeight:600,color:col}}>{val}</div>{onClick&&<span aria-hidden="true" style={{position:'absolute',top:7,right:8,fontSize:12,color:C.textSoft}}><Gl n='chevron'/></span>}</div>)

  // Etapa IA: narra y prioriza las oportunidades ya calculadas (cifras del código, IA solo el foco). Vía claude-proxy.
  const correrIA = async () => {
    setIaBusy(true)
    try{
      const resumenOpp = OPPS.map(o=> o.rows.length ? `${o.t} (${o.rows.length}): ${o.rows.slice(0,3).map(x=>`${x.c.name} ${o.metric(x)}`).join('; ')}` : null).filter(Boolean).join('. ')
      const prompt = `Eres el copiloto estratégico del socio de un estudio de abogados chileno. Cifras YA calculadas (no inventes ni cambies números): vendido ${yr} ${fmtUFk(kpis.vendidoYTD)}, por cobrar ${fmt(kpis.porCobrar)}, cobrado ${yr} ${fmt(kpis.cobradoYTD)}. Oportunidades detectadas: ${resumenOpp||'sin oportunidades destacadas'}. Escribe 3 a 4 frases MUY concretas, en español de Chile, tono directo y estratégico, diciendo en qué enfocar esta semana y por qué, priorizando ingresos y cobranza. Menciona 2 o 3 clientes puntuales por nombre cuando aporte. Da el foco, no listes todo. Sin saludo, sin markdown, sin viñetas.`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:400,messages:[{role:'user',content:prompt}]})
      const txt = (data.content?.[0]?.text||'').trim()
      setIaResumen(txt || 'No se pudo generar el resumen. Reintenta.')
    }catch(e){ setIaResumen('No se pudo generar: '+(e?.message||'reintenta')) }
    setIaBusy(false)
  }

  // Pregúntale al negocio: pregunta libre → IA responde con un brief de los datos reales, blindada a no inventar.
  const preguntarIA = async (qOverride) => {
    const q = (typeof qOverride==='string'?qOverride:pregunta).trim()
    if(!q) return
    setPregBusy(true); setRespuesta(null)
    try{
      const brief = `Datos del estudio (NO inventes ni cambies cifras; si la respuesta no está en estos datos, dilo claramente):
- Vendido ${yr}: ${fmtUFk(kpis.vendidoYTD)}; por cobrar ${fmt(kpis.porCobrar)}; cobrado ${fmt(kpis.cobradoYTD)}; crecimiento vs ${tendencias.prevYr}: ${tendencias.pctTot==null?'s/d':tendencias.pctTot+'%'}.
- Cartera: ${carteraTot.activos} clientes activos, valor histórico ${fmtUFk(carteraTot.ufTotal)}. Sanos ${cartera.sano.length}, en riesgo ${cartera.riesgo.length}, dormidos ${cartera.dormido.length}, ocasionales ${cartera.ocasional.length}.
- Servicios por área: ${servicios.slice(0,6).map(s=>`${s.area}: ${fmtUFk(s.uf)}, ticket ${fmtUFk(s.ticket)}, ${s.recPct}% recurrente`).join('; ')}.
- Por abogado ${yr} (vs ${tendencias.prevYr}): ${tendencias.abogados.map(a=>`${a.k} ${fmtUFk(a.cur)}${a.pct!=null?` (${a.pct>=0?'+':''}${a.pct}%)`:''}`).join('; ')}.
- Oportunidades: dormidos ${opp.dormidos.length} (${opp.dormidos.slice(0,3).map(x=>x.c.name).join(', ')||'—'}); cobranza vencida ${opp.cobranza.length}; cross-sell ${opp.crossSell.length}; sin recurrencia ${opp.sinRec.length}; win-back ${opp.winback.length}.`
      const prompt = `Eres el analista de negocio de un estudio de abogados chileno. Responde la pregunta del socio USANDO SOLO los datos entregados (no inventes nombres ni cifras; si no está, dilo). Español de Chile, directo, máximo 4 frases, con cifras cuando aporten.\n\nPREGUNTA: ${q}\n\nDATOS:\n${brief}`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:400,messages:[{role:'user',content:prompt}]})
      setRespuesta((data.content?.[0]?.text||'').trim()||'No pude responder con los datos disponibles.')
    }catch(e){ setRespuesta('No se pudo: '+(e?.message||'reintenta')) }
    setPregBusy(false)
  }

  // Radar: sugerir áreas con IA (clasifica la novedad contra las áreas reales del estudio).
  const sugerirAreas = async () => {
    if(!addForm.titulo.trim()&&!addForm.resumen.trim()) return
    setIaAreasBusy(true)
    try{
      const prompt = `Eres asistente tributario de un estudio de abogados chileno. Áreas del estudio (usa SOLO estas, tal cual están escritas): ${areasFirma.join(' | ')}. Novedad del SII: "${addForm.titulo}. ${addForm.resumen}". Responde SOLO un array JSON con las áreas del estudio a las que afecta (subconjunto EXACTO de la lista; [] si ninguna). Sin markdown ni texto extra.`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:200,messages:[{role:'user',content:prompt}]})
      const txt=(data.content?.[0]?.text||'').trim().replace(/```json|```/g,'')
      const arr=JSON.parse(txt)
      if(Array.isArray(arr)) setAddForm(f=>({...f,areas:arr.filter(a=>areasFirma.includes(a))}))
    }catch(_){ appAlert('No se pudo sugerir áreas, márcalas a mano.') }
    setIaAreasBusy(false)
  }
  const guardarNovedad = async () => {
    if(!addForm.titulo.trim()) return
    setAddBusy(true)
    try{
      const row={tipo:addForm.tipo,numero:addForm.numero||null,fecha:addForm.fecha||null,titulo:addForm.titulo.trim(),url:addForm.url.trim()||null,resumen:addForm.resumen.trim()||null,areas:addForm.areas,prioridad:addForm.prioridad,vigente:true}
      const {error}=await supabase.from('sii_novedades').insert(row)
      if(error){appAlert('Error: '+error.message);setAddBusy(false);return}
      await cargarSii(); setAddOpen(false); setAddForm({tipo:'circular',numero:'',fecha:'',titulo:'',url:'',resumen:'',prioridad:'media',areas:[]})
    }catch(e){ appAlert('Error: '+(e?.message||e)) }
    setAddBusy(false)
  }

  // Plan del Año: relato IA que sintetiza lo interno (BI) + el outlook del SII (Radar). La culminación.
  const correrPlan = async () => {
    setPlanBusy(true)
    try{
      const radarTxt = radar.length ? radar.slice(0,6).map(n=>`${n.titulo} [${(n.areas||[]).join('/')||'s/área'}; ${n.expuestos.length} clientes]`).join('; ') : 'sin novedades del SII cargadas aún'
      const oppTxt = OPPS.map(o=> o.rows.length?`${o.t} ${o.rows.length}`:null).filter(Boolean).join(', ')
      const brief = `INTERNO — vendido ${yr} ${fmtUFk(kpis.vendidoYTD)} (crecimiento ${tendencias.pctTot==null?'s/d':tendencias.pctTot+'%'} vs ${tendencias.prevYr}); por cobrar ${fmt(kpis.porCobrar)}; cobrado ${fmt(kpis.cobradoYTD)}. Cartera ${carteraTot.activos} activos (en riesgo ${cartera.riesgo.length}, dormidos ${cartera.dormido.length}). Áreas top: ${servicios.slice(0,4).map(s=>`${s.area} ${fmtUFk(s.uf)} (${s.recPct}% rec)`).join(', ')}. Por abogado: ${tendencias.abogados.map(a=>`${a.k} ${fmtUFk(a.cur)}${a.pct!=null?` (${a.pct>=0?'+':''}${a.pct}%)`:''}`).join(', ')}. Oportunidades: ${oppTxt||'—'}. EXTERNO (Radar SII): ${radarTxt}.`
      const prompt = `Eres el asesor estratégico del socio de un estudio de abogados chileno. Con los datos INTERNOS + el outlook del SII (EXTERNO), escribe un PLAN DEL AÑO en 5-6 frases concretas: dónde concentrar, qué áreas potenciar, qué clientes/segmentos priorizar, qué riesgos de cobranza atacar, y qué oportunidades regulatorias del SII aprovechar (con su cruce por área). Español de Chile, directo, con cifras cuando aporten. Usa SOLO estos datos, no inventes; si algo no está, no lo afirmes. Sin markdown ni viñetas.\n\nDATOS:\n${brief}`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:600,messages:[{role:'user',content:prompt}]})
      setPlanAnio((data.content?.[0]?.text||'').trim()||'No se pudo generar el plan.')
    }catch(e){ setPlanAnio('No se pudo: '+(e?.message||'reintenta')) }
    setPlanBusy(false)
  }

  // Brief del foco (Fase 2): IA explica de qué se trata y por qué importa, BLINDADA a la fuente; se guarda en sii_novedades.brief para no regenerar.
  const generarBrief = async (n) => {
    setBriefBusy(true)
    try{
      const prompt = `Eres asistente tributario de un estudio de abogados chileno. Explica en 2-3 frases, factual y en español de Chile, de qué se trata este foco del SII y por qué le importa al estudio y a sus clientes. Usa SOLO la información dada; NO inventes cifras, números de norma ni cites artículos que no aparezcan. Sin markdown.\n\nFOCO: ${n.titulo}\nTIPO: ${n.tipo||''} ${n.numero||''}\nRESUMEN: ${n.resumen||'(sin resumen)'}\nÁREAS: ${(n.areas||[]).join(', ')||'—'}`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:300,messages:[{role:'user',content:prompt}]})
      const brief = (data.content?.[0]?.text||'').trim()
      if(brief){ const {error}=await supabase.from('sii_novedades').update({brief}).eq('id',n.id); if(error){appAlert('No se pudo guardar: '+error.message)} else { await cargarSii() } }
    }catch(e){ appAlert('No se pudo generar el brief: '+(e?.message||'reintenta')) }
    setBriefBusy(false)
  }

  // Memo de conversación (Fase 3): borrador IA para plantear el foco al cliente, editable. La IA es insumo, el abogado valida.
  const generarMemo = async (n) => {
    setMemoBusy(true); setMemoText(null)
    try{
      const prompt = `Eres abogado tributarista de un estudio chileno. Redacta un MEMO breve para que el abogado plantee una conversación proactiva a un cliente sobre este foco del SII. Empieza con "Asunto: ..." y luego 4-5 frases. Tono profesional cercano, español de Chile (forma usted). Explica qué está haciendo el SII, por qué conviene revisarlo y propón coordinar una reunión. Usa SOLO la info dada; NO inventes cifras ni cites normas que no aparezcan. Sin markdown.\n\nFOCO: ${n.titulo}\nTIPO: ${n.tipo||''} ${n.numero||''}\nCONTEXTO: ${n.brief||n.resumen||''}\nÁREAS: ${(n.areas||[]).join(', ')||'—'}`
      const data = await claudeCall({model:'claude-opus-4-8',max_tokens:450,messages:[{role:'user',content:prompt}]})
      setMemoText((data.content?.[0]?.text||'').trim()||'No se pudo generar el memo.')
    }catch(e){ setMemoText('No se pudo: '+(e?.message||'reintenta')) }
    setMemoBusy(false)
  }


  return (
    <div style={isDesktop?{maxWidth:1040,margin:'0 auto'}:undefined}>
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bg,zIndex:10}}>
        <PageHeader origen={backLabel||'Inicio'} onBack={()=>onBack?onBack():(setTab&&setTab('dashboard'))} titulo='Inteligencia' ctx='oportunidades y salud de los proyectos' style={{position:'static',margin:'-20px -20px 12px'}}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          {kpiCard('Vendido '+yr, fmtUFk(kpis.vendidoYTD), C.accent, ()=>go('sales'))}
          {kpiCard('Por cobrar', fmtShort(kpis.porCobrar), C.overdue, ()=>go('billing'))}
          {kpiCard('Cobrado '+yr, fmtShort(kpis.cobradoYTD), C.normal, ()=>go('billing'))}
        </div>
      </div>
      <div style={{padding:'10px 20px 100px'}}>
        {/* HÉROE — Radar tributario · SII (varios focos + clientes a conversar) */}
        <div style={{background:C.accent,borderRadius:14,padding:'13px 14px 7px',marginBottom:openFoco?9:13}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
            <div onClick={()=>radar.length&&setRadarOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:11,minWidth:0,cursor:radar.length?'pointer':'default'}}>
              <span style={{width:38,height:38,borderRadius:12,background:'rgba(159,196,222,.15)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9FC4DE" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><line x1="12" y1="12" x2="19" y2="6"/></svg>
              </span>
              <div style={{minWidth:0}}>
                <div style={{fontSize:10,fontWeight:700,color:'#9FC4DE',textTransform:'uppercase',letterSpacing:'.07em'}}>Radar tributario · SII</div>
                <div style={{fontSize:19,fontWeight:700,color:'#fff',lineHeight:1.1,display:'flex',alignItems:'center',gap:8}}>{radar.length} foco{radar.length!==1?'s':''} activo{radar.length!==1?'s':''}{radar.length>0&&<span style={{fontSize:12,color:'#6E93A6'}}>{radarOpen?'⌃':<Gl n='chevron'/>}</span>}</div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:13,flexShrink:0}}>
              <button onClick={(e)=>{e.stopPropagation();actualizarRadar()}} disabled={radarBusy} title='Actualizar' style={{fontSize:14,color:'#9FC4DE',background:'none',border:'none',cursor:radarBusy?'default':'pointer',padding:0,lineHeight:1}}>{radarBusy?'…':'↻'}</button>
              <button onClick={(e)=>{e.stopPropagation();setAddOpen(true)}} title='Agregar novedad' style={{fontSize:19,color:'#9FC4DE',background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:1}}>+</button>
            </div>
          </div>
          {radarMsg&&<div style={{fontSize:10,color:radarMsg.startsWith('Error')?'#F3B0AE':'#9FE0C8',marginBottom:6}}>{radarMsg}</div>}
          {radar.length===0
            ? <div style={{fontSize:12,color:'#88A6B6',padding:'2px 0 9px',lineHeight:1.5}}>Sin novedades del SII aún · agrégalas con + o la ingesta automática.</div>
            : !radarOpen
            ? <div onClick={()=>setRadarOpen(true)} style={{fontSize:11,color:'#88A6B6',padding:'2px 0 9px',lineHeight:1.5,cursor:'pointer'}}>Toca para ver los focos y los clientes expuestos.</div>
            : radar.map(n=>{ const pr=n.prioridad==='alta'?C.overdue:n.prioridad==='media'?C.soon:C.azulInfo; const op=openFoco===n.id; return (
              <div key={n.id} onClick={()=>{setOpenFoco(op?null:n.id);setMemoText(null)}} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderTop:'0.5px solid rgba(255,255,255,.13)',cursor:'pointer'}}>
                <span style={{width:7,height:7,borderRadius:'50%',background:pr,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:op?'#fff':'#EAF0F3',fontWeight:op?600:400,lineHeight:1.3}}>{n.titulo}</div>
                  {(n.tipo||n.numero)&&<div style={{fontSize:10,color:'#88A6B6',marginTop:1}}>{((n.numero||'').toUpperCase().includes((n.tipo||'').toUpperCase())?(n.numero||''):`${n.tipo||''} ${n.numero||''}`).toUpperCase().trim()}</div>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:15,fontWeight:700,color:'#fff',lineHeight:1}}>{n.expuestos.length}</div>
                  <div style={{fontSize:8,color:'#88A6B6',textTransform:'uppercase',letterSpacing:'.04em'}}>clientes</div>
                </div>
                <span style={{fontSize:13,color:'#6E93A6',flexShrink:0}}>{op?'⌃':<Gl n='chevron'/>}</span>
              </div>
            )})}
        </div>
        {openFoco&&(()=>{ const n=radar.find(x=>String(x.id)===String(openFoco)); if(!n) return null; const pr=n.prioridad==='alta'?C.overdue:n.prioridad==='media'?C.soon:C.azulInfo; const tag=((n.numero||'').toUpperCase().includes((n.tipo||'').toUpperCase())?(n.numero||''):`${n.tipo||''} ${n.numero||''}`).toUpperCase().trim(); return (
          <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',marginBottom:13}}>
            <div style={{fontSize:9,fontWeight:700,color:pr,textTransform:'uppercase',letterSpacing:'.04em',marginBottom:5}}>{tag||'SII'}{n.prioridad?` · prioridad ${n.prioridad}`:''}</div>
            <div style={{fontSize:14,fontWeight:600,color:C.text,lineHeight:1.3,marginBottom:6}}>{n.titulo}</div>
            {(n.brief||n.resumen)&&<div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:10}}>{n.brief||n.resumen}</div>}
            {n.expuestos.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:11}}>
              {n.expuestos.slice(0,10).map(c=>(<span key={c.id} onClick={()=>onOpenClientFicha&&onOpenClientFicha(c.id)} style={{fontSize:12,color:C.text,background:C.bgSoft,borderRadius:20,padding:'4px 10px',cursor:'pointer'}}>{c.name}</span>))}
              {n.expuestos.length>10&&<span style={{fontSize:11,color:C.muted,padding:'4px 4px'}}>+{n.expuestos.length-10}</span>}
            </div>}
            <div style={{display:'flex',flexWrap:'wrap',gap:7,alignItems:'center'}}>
              {!n.brief&&<button onClick={()=>generarBrief(n)} disabled={briefBusy} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,borderRadius:8,padding:'4px 10px',cursor:briefBusy?'default':'pointer',opacity:briefBusy?.6:1}}>{briefBusy?'…':<>{IA_SPK}Generar brief</>}</button>}
              <button onClick={()=>generarMemo(n)} disabled={memoBusy} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,background:'#fff',color:C.accent,borderRadius:8,padding:'4px 10px',cursor:memoBusy?'default':'pointer',opacity:memoBusy?.6:1}}>{memoBusy?'…':<>{IA_SPK}Memo de conversación</>}</button>
              {n.url&&<a href={n.url} target='_blank' rel='noreferrer' style={{fontSize:11,fontWeight:600,color:C.azulInfo,textDecoration:'none',marginLeft:'auto'}}>{n.numero?n.numero:'Fuente'} · sii.cl ↗</a>}
            </div>
            {memoText&&<div style={{marginTop:11,borderTop:`0.5px solid ${C.border}`,paddingTop:11}}>
              <textarea value={memoText} onChange={e=>setMemoText(e.target.value)} rows={7} style={{width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'9px 11px',fontSize:12,color:C.text,lineHeight:1.5,outline:'none',resize:'vertical',boxSizing:'border-box',fontFamily:'inherit',background:C.bgSoft}}/>
              <div style={{display:'flex',gap:7,marginTop:7}}>
                <Copyable text={memoText} title='Copiar memo' style={{fontSize:11,fontWeight:600,border:`1px solid ${C.accent}`,background:C.azulBg,color:C.accent,borderRadius:8,padding:'4px 12px',cursor:'pointer'}}>Copiar</Copyable>
                <button onClick={()=>setMemoText(null)} style={{fontSize:11,fontWeight:600,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>Cerrar</button>
              </div>
            </div>}
          </div>
        )})()}

        {/* ÍNDICE — lentes del negocio como grilla de tarjetas (patrón de casa: accesos/Gastos/Facturación). Una sección abierta a la vez; el detalle se abre debajo. */}
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'minmax(0,1fr) minmax(0,1fr)',gap:isDesktop?12:9}}>
          {(()=>{ const oportN=OPPS.reduce((a,o)=>a+o.rows.length,0); const ico={fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round'}; const SECS=[
            {k:'oport',bg:C.azulBg,fg:C.azulInfo,t:'Oportunidades',sub:'dormidos · cobranza · cross-sell',ct:oportN,svg:<svg width="18" height="18" viewBox="0 0 24 24" {...ico}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/></svg>},
            {k:'cartera',bg:C.greenBg,fg:C.greenText,t:'Seguimiento',sub:`${cartera.riesgo.length+cartera.dormido.length} sin avanzar · toca empujar`,ct:cartera.riesgo.length+cartera.dormido.length,ctCol:(cartera.riesgo.length+cartera.dormido.length)>0?C.soonText:C.greenText,svg:<svg width="18" height="18" viewBox="0 0 24 24" {...ico}><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.5a3 3 0 0 1 0 5.8"/><path d="M17 14.5a5 5 0 0 1 3.5 4.5"/></svg>},
            {k:'servicios',bg:C.ambarBg,fg:C.soonText,t:'Servicios y precios',sub:serviciosTot.areas&&servicios[0]?`Top: ${servicios[0].area}`:'',ct:serviciosTot.areas,svg:<svg width="18" height="18" viewBox="0 0 24 24" {...ico}><path d="M3.5 3.5h7l9.5 9.5-7 7L3.5 10.5z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>},
            {k:'tendencias',bg:C.tealBg,fg:C.tealText,t:'Tendencias',sub:`vs ${tendencias.prevYr} · por abogado`,ct:tendencias.pctTot==null?null:`${tendencias.pctTot>=0?'+':''}${tendencias.pctTot}%`,ctCol:tendencias.pctTot>=0?C.greenText:C.overdueText,svg:<svg width="18" height="18" viewBox="0 0 24 24" {...ico}><path d="M3 17l6-6 4 4 8-8"/><path d="M16 7h5v5"/></svg>},
            {k:'socios',bg:C.azulBg,fg:C.accent,t:'Socios · la foto',sub:'todas las cifras por abogado',ct:null,svg:<svg width="18" height="18" viewBox="0 0 24 24" {...ico}><circle cx="8" cy="8" r="3"/><path d="M2.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 19a4 4 0 0 1 6.5-3.1"/></svg>},
            {k:'ia',bg:'#EFEAF7',fg:'#5B3E8E',t:'Asesor IA · Foco y Plan',sub:'Pregúntale · Foco semana · Plan del Año',ct:null,svg:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z"/></svg>},
          ]; return SECS.map((s)=>{ const open=biSec===s.k; return (
            <div key={s.k} onClick={()=>setBiSec(open?null:s.k)} style={{cursor:'pointer',background:open?C.bgSoft:C.surface,border:`1px solid ${open?s.fg:C.border}`,borderRadius:12,padding:'13px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <span style={{width:34,height:34,borderRadius:10,background:s.bg,color:s.fg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{s.svg}</span>
                {s.ct!=null&&<span style={{fontSize:16,fontWeight:800,color:s.ctCol||s.fg,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{s.ct}</span>}
              </div>
              <div style={{fontSize:14,fontWeight:700,color:C.accent,marginTop:9,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.t}</div>
              {s.sub&&<div style={{fontSize:11,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.sub}</div>}
            </div>
          )}) })()}
        </div>

        {biSec==='oport'&&(<div style={{marginTop:12}}>
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {OPPS.map(o=>{ const open=openOpp===o.k; const n=o.rows.length; return (
            <div key={o.k} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
              <div onClick={()=>n&&setOpenOpp(open?null:o.k)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 11px',cursor:n?'pointer':'default'}}>
                <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text}}>{o.t}</div><div style={{fontSize:10,color:C.muted}}>{o.sub}</div></div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}><span style={{fontSize:14,fontWeight:600,color:n?o.col:C.done}}>{n}</span>{n>0&&<span style={{fontSize:12,color:C.textSoft}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>}</div>
              </div>
              {open&&<div>
                {o.rows.slice(0,12).map(x=>(
                  <div key={x.c.id} onClick={()=>x.c.id&&onOpenClientFicha&&onOpenClientFicha(x.c.id)} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 11px',borderTop:`0.5px solid ${C.border}`,cursor:'pointer'}}>
                    <span style={{width:7,height:7,borderRadius:'50%',background:o.col,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{...NOMBRE_CLI}}>{x.c.name}</div>
                      <div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.ctx(x)}</div>
                    </div>
                    <span style={{fontSize:13,fontWeight:700,color:o.col,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{o.val(x)}</span>
                    <span style={{color:C.textSoft,fontSize:13,flexShrink:0}}><Gl n='chevron'/></span>
                  </div>
                ))}
                {o.rows.length>12&&<div style={{fontSize:10,color:C.muted,textAlign:'center',padding:'6px'}}>+{o.rows.length-12} más</div>}
              </div>}
            </div>
          )})}
        </div></div>)}
        {addOpen&&(
          <Modal title='Agregar novedad SII' fullscreenOnMobile onClose={()=>!addBusy&&setAddOpen(false)} footer={<button onClick={guardarNovedad} disabled={addBusy||!addForm.titulo.trim()} style={{width:'100%',height:44,borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:13,fontWeight:600,cursor:(addBusy||!addForm.titulo.trim())?'default':'pointer',opacity:(addBusy||!addForm.titulo.trim())?.5:1}}>{addBusy?'Guardando…':'Guardar novedad'}</button>}>
              {(()=>{ const inp={width:'100%',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:13,color:C.text,outline:'none',boxSizing:'border-box',background:'#fff',fontFamily:'inherit'}; const lab={fontSize:10,fontWeight:600,color:C.muted,textTransform:'uppercase',letterSpacing:'.04em',display:'block',marginBottom:4}; return (<>
                <div style={{marginBottom:10}}><label style={lab}>Título *</label><input value={addForm.titulo} onChange={e=>setAddForm(f=>({...f,titulo:e.target.value}))} style={inp} placeholder='Ej: Fiscalización IVA servicios digitales'/></div>
                <div style={{marginBottom:10}}><label style={lab}>Resumen</label><textarea value={addForm.resumen} onChange={e=>setAddForm(f=>({...f,resumen:e.target.value}))} rows={2} style={{...inp,resize:'vertical'}} placeholder='Qué dice, en una frase'/></div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <div style={{flex:1}}><label style={lab}>Tipo</label><select value={addForm.tipo} onChange={e=>setAddForm(f=>({...f,tipo:e.target.value}))} style={inp}>{['circular','resolucion','oficio','jurisprudencia','pgct','ley'].map(t=><option key={t} value={t}>{t}</option>)}</select></div>
                  <div style={{flex:1}}><label style={lab}>N°</label><input value={addForm.numero} onChange={e=>setAddForm(f=>({...f,numero:e.target.value}))} style={inp} placeholder='42'/></div>
                </div>
                <div style={{display:'flex',gap:8,marginBottom:10}}>
                  <div style={{flex:1}}><label style={lab}>Fecha</label><input type='date' value={addForm.fecha} onChange={e=>setAddForm(f=>({...f,fecha:e.target.value}))} style={inp}/></div>
                  <div style={{flex:1}}><label style={lab}>Prioridad</label><select value={addForm.prioridad} onChange={e=>setAddForm(f=>({...f,prioridad:e.target.value}))} style={inp}>{['alta','media','baja'].map(p=><option key={p} value={p}>{p}</option>)}</select></div>
                </div>
                <div style={{marginBottom:10}}><label style={lab}>Fuente (URL oficial)</label><input value={addForm.url} onChange={e=>setAddForm(f=>({...f,url:e.target.value}))} style={inp} placeholder='https://www.sii.cl/...'/></div>
                <div style={{marginBottom:13}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <label style={{...lab,marginBottom:0}}>Áreas afectadas</label>
                    <button onClick={sugerirAreas} disabled={iaAreasBusy} style={{fontSize:10,fontWeight:600,color:C.accent,background:'none',border:'none',cursor:'pointer'}}>{iaAreasBusy?'…':<>{IA_SPK}Sugerir con IA</>}</button>
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {areasFirma.length===0&&<span style={{fontSize:11,color:C.muted}}>Sin áreas registradas en ventas.</span>}
                    {areasFirma.map(a=>{ const on=addForm.areas.includes(a); return (
                      <button key={a} onClick={()=>setAddForm(f=>({...f,areas:on?f.areas.filter(x=>x!==a):[...f.areas,a]}))} style={{fontSize:11,fontWeight:on?600:500,borderRadius:20,padding:'4px 11px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',color:on?C.accent:C.muted}}>{a}</button>
                    )})}
                  </div>
                </div>
              </>)})()}
          </Modal>
        )}
        {biSec==='cartera'&&(<div style={{marginTop:12}}>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:9}}>
            <div><div style={{...SEC_LBL}}>Clientes activos</div><div style={{fontSize:22,fontWeight:600,color:C.accent}}>{carteraTot.activos}</div></div>
            <div style={{textAlign:'right'}}><div style={{...SEC_LBL}}>Valor proyectos · histórico</div><div style={{fontSize:17,fontWeight:600,color:C.accent}}>{fmtUFk(carteraTot.ufTotal)}</div></div>
          </div>
          {carteraTot.ufTotal>0&&<div style={{display:'flex',height:8.5,borderRadius:6,overflow:'hidden',background:C.bgWarm,marginBottom:12}}>
            {[['sano','#1D9E75'],['riesgo','#C77F18'],['dormido','#E24B4A'],['ocasional','#99ABB4']].map(([k,c])=>{ const w=carteraTot.ufSeg[k]/carteraTot.ufTotal*100; return w>0?<div key={k} style={{width:`${w}%`,background:c}}/>:null })}
          </div>}
          {[
            {k:'sano', dot:'#1D9E75', col:C.greenText, t:'Sanos', sub:''},
            {k:'riesgo', dot:'#C77F18', col:C.soonText, t:'En riesgo', sub:'saldo vencido o enfriándose'},
            {k:'dormido', dot:'#E24B4A', col:C.overdueText, t:'Dormidos', sub:'activos 9+ meses sin actividad'},
            {k:'ocasional', dot:'#99ABB4', col:C.muted, t:'Ocasionales', sub:''},
          ].map(seg=>{ const rows=cartera[seg.k]; const open=openSeg===seg.k; const n=rows.length; return (
            <div key={seg.k} style={{borderTop:`0.5px solid ${C.border}`}}>
              <div onClick={()=>n&&setOpenSeg(open?null:seg.k)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 0',cursor:n?'pointer':'default'}}>
                <span style={{width:9,height:9,borderRadius:'50%',background:seg.dot,flexShrink:0}}/>
                <span style={{flex:1,fontSize:13,fontWeight:600,color:C.text,minWidth:0}}>{seg.t}{seg.sub&&<span style={{fontSize:10,fontWeight:400,color:C.muted}}> · {seg.sub}</span>}</span>
                <span style={{fontSize:11,color:C.muted,flexShrink:0}}>{n}{seg.k!=='ocasional'&&carteraTot.ufSeg[seg.k]>0?` · ${fmtUFk(carteraTot.ufSeg[seg.k])}`:''}</span>
                {n>0&&<span style={{fontSize:12,color:C.textSoft,flexShrink:0}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>}
              </div>
              {open&&rows.slice(0,500).map(x=>(
                <div key={x.c.id} onClick={()=>x.c.id&&onOpenClientFicha&&onOpenClientFicha(x.c.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'7px 0 7px 18px',borderTop:`0.5px solid ${C.track}`,cursor:'pointer'}}>
                  <div style={{minWidth:0}}>
                    <div style={{...NOMBRE_CLI}}>{x.c.name}</div>
                    {(()=>{ const rs=rsLabel(x.c.id,clients,clientEntities); const bits=[rs.name&&rs.name!==x.c.name?rsDisplay(rs.name):null,rs.rut].filter(Boolean); return bits.length?<div style={{fontSize:10,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bits.join(' · ')}</div>:null })()}
                    <div style={{fontSize:10,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.area} · {fmtUFk(x.uf)}{x.meses<900?` · hace ${x.meses}m`:''}{x.saldoVenc>0?` · saldo ${fmt(x.saldoVenc)}`:(x.rec?' · recurrente':'')}</div>
                  </div>
                  <span style={{fontSize:12,color:seg.col,flexShrink:0}}><Gl n='chevron'/></span>
                </div>
              ))}
              {open&&rows.length>15&&<div style={{fontSize:10,color:C.muted,textAlign:'center',padding:'5px 0'}}>+{rows.length-15} más</div>}
            </div>
          )})}
          <div onClick={()=>go('cartera')} style={{borderTop:`1px solid ${C.border}`,marginTop:6,paddingTop:10,fontSize:12,fontWeight:700,color:C.azulInfo,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}>Ver seguimiento completo · novedades y rentabilidad <Gl n='chevron'/></div>
        </div>
        </div>)}
        {biSec==='servicios'&&(<div style={{marginTop:12}}>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:9}}>
            <div><div style={{...SEC_LBL}}>Áreas</div><div style={{fontSize:22,fontWeight:600,color:C.accent}}>{serviciosTot.areas}</div></div>
            <div style={{textAlign:'right'}}><div style={{...SEC_LBL}}>Vendido · histórico</div><div style={{fontSize:17,fontWeight:600,color:C.accent}}>{fmtUFk(serviciosTot.uf)}</div></div>
          </div>
          {servicios.map(s=>{ const open=openArea===s.area; const w=serviciosTot.uf>0?s.uf/serviciosTot.uf*100:0; return (
            <div key={s.area} style={{borderTop:`0.5px solid ${C.border}`,padding:'10px 0 2px'}}>
              <div onClick={()=>setOpenArea(open?null:s.area)} style={{cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8}}>
                  <span style={{fontSize:13,fontWeight:600,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.area}</span>
                  <span style={{display:'inline-flex',alignItems:'center',gap:6,flexShrink:0}}><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.bgSoft,color:C.muted,whiteSpace:'nowrap'}}>{Math.round(w)}% del total</span><span style={{fontSize:13,fontWeight:600,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtUFk(s.uf)}</span></span>
                </div>
                                <div style={{fontSize:11,color:C.muted}}>{s.n} venta{s.n!==1?'s':''} · ticket {fmtUFk(s.ticket)} · <span style={{color:s.recPct>0?C.greenText:C.coralText}}>{s.recPct}% recurrente</span>{s.min>0&&s.max>s.min?` · rango ${fmtUFk(s.min)}–${fmtUFk(s.max)}`:''}</div>
              </div>
              {open&&s.clientes.slice(0,8).map(c=>(
                <div key={c.cid} onClick={()=>c.cid&&onOpenClientFicha&&onOpenClientFicha(c.cid)} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0 6px 14px',borderTop:`0.5px solid ${C.track}`,cursor:'pointer'}}>
                  <span style={{...NOMBRE_CLI,flex:1,minWidth:0}}>{c.name}</span>
                  <span style={{fontSize:12,fontWeight:600,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmtUFk(c.uf)}</span>
                  <span style={{color:C.textSoft,fontSize:12,flexShrink:0}}><Gl n='chevron'/></span>
                </div>
              ))}
            </div>
          )})}
          {(()=>{ const cov=serviciosTot.nTotal>0?serviciosTot.conCosto/serviciosTot.nTotal*100:0; const repr=cov>=60; const areasCon=servicios.filter(s=>s.conCosto>0); return (
          <div style={{marginTop:12,borderTop:`1px solid ${C.border}`,paddingTop:11}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
              <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:.4,textTransform:'uppercase'}}>Rentabilidad · margen de contribución</span>
              <span style={{fontSize:10,fontWeight:700,color:repr?C.greenText:C.soonText}}>{serviciosTot.conCosto}/{serviciosTot.nTotal} con costo</span>
            </div>
            <div style={{display:'flex',gap:7,marginBottom:repr?10:8}}>
              <div style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 9px'}}><div style={{fontSize:9,color:C.muted}}>Honorarios</div><div style={{fontSize:15,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtUFk(serviciosTot.uf)}</div></div>
              <div style={{flex:1,background:C.bgSoft,borderRadius:10,padding:'7px 9px'}}><div style={{fontSize:9,color:C.muted}}>Costo terceros</div><div style={{fontSize:15,fontWeight:700,color:C.soonText,fontVariantNumeric:'tabular-nums'}}>{fmtUFk(serviciosTot.costo)}</div></div>
              <div style={{flex:1,background:repr?C.greenBg:C.bgSoft,borderRadius:10,padding:'7px 9px'}}><div style={{fontSize:9,color:C.muted}}>Margen</div><div style={{fontSize:15,fontWeight:700,color:C.greenText,fontVariantNumeric:'tabular-nums'}}>{serviciosTot.uf>0?Math.round(serviciosTot.margen/serviciosTot.uf*100)+'%':'—'}</div></div>
            </div>
            {!repr&&<div style={{background:C.ambarBg,borderRadius:10,padding:'8px 11px',marginBottom:10}}><div style={{fontSize:11,color:C.soonText,lineHeight:1.4}}>El margen aún no es representativo: falta cargar el costo de terceros en <b>{serviciosTot.nTotal-serviciosTot.conCosto} ventas</b>. Cárgalo abajo y se enciende con cifras reales.</div></div>}
            {areasCon.map(s=>{ const mp=Math.round(s.margenPct); const cp=Math.max(0,100-mp); return (
              <div key={s.area} style={{marginBottom:9}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',fontSize:12,marginBottom:4}}><span style={{fontWeight:600,color:C.text}}>{s.area} <span style={{fontSize:10,color:C.textSoft,fontWeight:500}}>· {s.conCosto}/{s.n} con costo</span></span></div>
                <div style={{display:'flex',gap:6}}><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.greenBg,color:C.greenText,whiteSpace:'nowrap'}}>{mp}% margen</span><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.soonBg,color:C.soonText,whiteSpace:'nowrap'}}>{cp}% terceros</span></div>
              </div>
            )})}
            {areasCon.length===0&&<div style={{fontSize:11,color:C.grisText,marginBottom:8}}>Aún ninguna área con costo cargado.</div>}
            {ventasSinCosto.length>0&&onOpenSale&&(<div style={{marginTop:6}}>
              <div style={{...SEC_LBL,marginBottom:4}}>Cargar costo de terceros</div>
              {ventasSinCosto.slice(0,6).map(s=>{ const cli=(clients||[]).find(c=>String(c.id)===String(s.client_id)); return (
                <div key={s.id} onClick={()=>onOpenSale(s)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'7px 0',borderTop:`0.5px solid ${C.track}`,cursor:'pointer'}}>
                  <div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.title||'Venta'}</div><div style={{fontSize:10,color:C.muted}}>{cli?.name||'—'} · {s.area||'Sin área'}</div></div>
                  <span style={{fontSize:11,fontWeight:600,color:C.accent,flexShrink:0,whiteSpace:'nowrap'}}>+ costo <Gl n='chevron'/></span>
                </div>
              )})}
              {ventasSinCosto.length>6&&<div style={{fontSize:10,color:C.muted,textAlign:'center',padding:'5px 0'}}>+{ventasSinCosto.length-6} ventas más sin costo</div>}
            </div>)}
          </div>
          )})()}
        </div>
        </div>)}
        {biSec==='tendencias'&&(<div style={{marginTop:12}}>
        <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'13px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',marginBottom:11}}>
            <div><div style={{...SEC_LBL}}>Vendido {yr}</div><div style={{fontSize:22,fontWeight:600,color:C.accent}}>{fmtUFk(tendencias.totCur)}</div></div>
            {tendencias.pctTot!=null&&<div style={{textAlign:'right'}}><div style={{fontSize:14,fontWeight:700,color:tendencias.pctTot>=0?C.greenText:C.overdueText}}>{tendencias.pctTot>=0?'+':''}{tendencias.pctTot}%</div><div style={{fontSize:9,color:C.muted}}>vs {tendencias.prevYr} · {fmtUFk(tendencias.totPrv)}</div></div>}
          </div>
          <div style={{...SEC_LBL,marginBottom:4}}>Por abogado · vs {tendencias.prevYr}</div>
          {tendencias.abogados.map(a=>{ const pc=personChip(a.k); return (
            <div key={a.k} style={{display:'flex',alignItems:'center',gap:9,padding:'7px 0',borderTop:`0.5px solid ${C.track}`}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:pc.color||C.muted,flexShrink:0}}/>
              <span style={{flex:1,fontSize:13,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.k}</span>
              <span style={{fontSize:13,fontWeight:500,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmtUFk(a.cur)}</span>
              <span style={{width:50,textAlign:'right',fontSize:11,fontWeight:600,color:a.pct==null?C.muted:(a.pct>=0?C.greenText:C.overdueText),flexShrink:0}}>{a.pct==null?'nuevo':`${a.pct>=0?'+':''}${a.pct}%`}</span>
            </div>
          )})}
        </div>
        </div>)}
        {biSec==='socios'&&(<div style={{marginTop:12}}>
          <PorSocioVista tabIni='cmp' billing={billing} sales={sales} clients={clients} anticipos={anticipos} terceros={terceros} expenses={expenses} fantasmaIds={fantasmaIds} onOpenClientFicha={onOpenClientFicha} onIrBanco={mid=>navTo&&navTo({tab:'conciliacion',conc:mid})} onIrBilling={()=>navTo&&navTo({tab:'billing'})} onIrCobranza={()=>navTo&&navTo({tab:'cobranza'})} onIrProveedores={()=>navTo&&navTo({tab:'proveedores'})} onIrSubarriendo={()=>navTo&&navTo({tab:'subarriendo'})}/>
        </div>)}
        {biSec==='ia'&&(<div style={{marginTop:12}}>
          <div style={{marginBottom:12}}>
            {iaResumen ? (
              <div style={{background:C.azulBg,border:`1px solid ${C.accent}`,borderRadius:12,padding:'12px 14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,gap:8}}>
                  <span style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:'.05em'}}>{IA_SPK}Foco de la semana</span>
                  <button onClick={correrIA} disabled={iaBusy} style={{...chipBtn('soft'),flexShrink:0,opacity:iaBusy?.6:1}}>{iaBusy?'…':'Otra vez'}</button>
                </div>
                <div style={{fontSize:13,color:C.text,lineHeight:1.5}}>{iaResumen}</div>
              </div>
            ) : (
              <button onClick={correrIA} disabled={iaBusy} style={{width:'100%',background:C.azulBg,border:`1px solid ${C.accent}`,borderRadius:12,padding:'12px 14px',cursor:iaBusy?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,color:C.accent,fontSize:13,fontWeight:600}}>
                {iaBusy?'Analizando oportunidades…':<>{IA_SPK}Foco de la semana · Resumen IA</>}
              </button>
            )}
          </div>
          <div style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',marginBottom:12}}>
            <div style={{display:'flex',gap:8}}>
              <input value={pregunta} onChange={e=>setPregunta(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')preguntarIA()}} placeholder='¿Qué quieres saber de tus números?' style={{flex:1,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:13,color:C.text,outline:'none',minWidth:0,background:'#fff'}}/>
              <button onClick={()=>preguntarIA()} disabled={pregBusy||!pregunta.trim()} style={{height:36,padding:'0 14px',borderRadius:8,background:C.accent,color:'#fff',border:'none',fontSize:12,fontWeight:600,cursor:(pregBusy||!pregunta.trim())?'default':'pointer',flexShrink:0,opacity:(pregBusy||!pregunta.trim())?.5:1}}>{pregBusy?'…':'Preguntar'}</button>
            </div>
            {!respuesta&&!pregBusy&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:9}}>
              {['¿Qué cliente estoy por perder?','¿Qué área conviene potenciar?','¿Dónde están mis oportunidades?'].map(q=>(
                <button key={q} onClick={()=>{setPregunta(q);preguntarIA(q)}} style={{fontSize:11,color:C.muted,border:`1px solid ${C.border}`,background:'#fff',borderRadius:20,padding:'4px 10px',cursor:'pointer'}}>{q}</button>
              ))}
            </div>}
            {respuesta&&<div style={{marginTop:10,fontSize:13,color:C.text,lineHeight:1.5,background:C.bgSoft,borderRadius:10,padding:'10px 12px'}}>{respuesta}</div>}
          </div>
          <div style={{background:C.azulBg,border:`1px solid ${C.accent}`,borderRadius:12,padding:'13px 14px'}}>
            {planAnio ? (<>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:7,gap:8}}>
                <span style={{fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:'.05em'}}>{IA_SPK}Plan del año {yr}</span>
                <button onClick={correrPlan} disabled={planBusy} style={{...chipBtn('soft'),flexShrink:0,opacity:planBusy?.6:1}}>{planBusy?'…':'Otra vez'}</button>
              </div>
              <div style={{fontSize:13,color:C.text,lineHeight:1.55}}>{planAnio}</div>
            </>) : (
              <button onClick={correrPlan} disabled={planBusy} style={{width:'100%',background:'none',border:'none',cursor:planBusy?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,color:C.accent,fontSize:13,fontWeight:600,padding:'2px 0'}}>
                {planBusy?'Sintetizando interno + SII…':<>{IA_SPK}Generar Plan del Año (interno + SII)</>}
              </button>
            )}
          </div>
        </div>)}
      </div>
    </div>
  )
}

