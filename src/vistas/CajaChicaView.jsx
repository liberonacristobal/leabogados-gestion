// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase, DEMO } from '../supabase'
import { glosaKey } from '../../supabase/functions/_shared/ventaGastoReglas.js'
import { BRAND, C, Gl, SEC_LBL, Spin, appAlert, appConfirm, diaGrande, fmt, fmtFechaDMY, fmtN, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, CAT_COLORS, ClientePicker, EQUIPO_CFG, FlujoPagina, INICIALES_RESP, MAIL_OFICINA_CONFIRM, MES_L, Modal, MovIcon, MovilizacionView, SOCIOS_CFG, Sparkle, TH_BAND, TXT_REINGRESO, _ccDia, _ccDias, _ccEsAjuste, _glosaTransf, _norm, bigDate, calceCajaChica, cargarAdminsEstudio, chipBtn, claudeCall, driveToken, fmtSaldoG, gastosPorLiquidarCaja, incrustarLogosCorreo, learnPut, logActividad, movilizacionDatos, nDias, okDB, posiblesDuplicadosGastos, restoreScroll, saldoCajaChica, sendGmailWithPdf, sendMailServer, txtEnviado, registrarError } from '../lib/compartido.jsx'
import { liquidacionPdfBase64 } from '../lib/rendiciones.jsx'

export const _ccNotaVisible = n => String(n||'').replace(/\s*·\s*mov:[0-9a-f-]+/g,'').replace(/\[ajuste\]\s*/ig,'').trim()

export function CajaChicaView({isAdmin=false,expenses,setExpenses,clients,currentUserName,currentUserEmail,pettyCash,setPettyCash,rendiciones,setRendiciones,onOpenClientFicha,onEditExpense}) {
  expenses = (expenses||[]).filter(Boolean)   // blindaje: una fila vacía no debe tumbar la vista
  const me = currentUserName || ''
  const isDesktop = useIsDesktop()   // escritorio: PENDIENTES y CAJA lado a lado; móvil: pestañas (idéntico a antes)
  const [movOpen,setMovOpen] = useState(false)   // mi movilización (control de Uber), visible al liquidar
  const [tab,setTab] = useState(()=>{ try{ const v=sessionStorage.getItem('cc_tab'); if(v){ sessionStorage.removeItem('cc_tab'); return v } }catch(_){} return 'liquidar' }) // liquidar | caja (desde el resumen de Tareas puede llegar 'caja')
  const [selected,setSelected] = useState(new Set())
  const [saving,setSaving] = useState(false)
  const [openRendicion,setOpenRendicion] = useState(null)
  const [confirmLiq,setConfirmLiq] = useState(false) // popup de confirmación de liquidación
  const [enviarA,setEnviarA] = useState('')
  const [cc,setCc] = useState('')
  const [toast,setToast] = useState(null) // confirmación post-liquidación
  const [newMonto,setNewMonto] = useState('')
  const [newFecha,setNewFecha] = useState(new Date().toISOString().slice(0,10))
  const [newNota,setNewNota] = useState('')
  const [admins,setAdmins] = useState([])   // administradores del estudio (miembros rol admin) → destinatarios y "Entregado por"
  useEffect(()=>{ let vivo=true; cargarAdminsEstudio().then(a=>{ if(vivo) setAdmins(a||[]) }); return ()=>{ vivo=false } },[])
  useEffect(()=>{ if(confirmLiq) restoreScroll({w:0,d:0}) },[confirmLiq])   // la página de liquidar parte arriba
  const adminNombres = admins.length ? admins.map(a=>a.nombre) : (SOCIOS_CFG||[]).map(x=>String(x.nombre||'').split(' ')[0]).filter(Boolean)
  // Último recurso si `miembros` no responde: las direcciones de siempre (nunca enviar a nadie).
  const adminEmails = admins.length ? admins.map(a=>a.email).filter(Boolean) : ['cl@leabogados.cl','ee@leabogados.cl']
  const [newDeliveredBy,setNewDeliveredBy] = useState('')
  const [showNuevaCaja,setShowNuevaCaja] = useState(false)
  const [editCajaId,setEditCajaId] = useState(null)   // caja entregada en edición (petty_cash)
  const [cajaOtra,setCajaOtra] = useState(false)
  // Conciliación desde el miembro: trae SOLO sus transferencias (filtro por su RUT en el servidor, últimos 60 días), las enlaza al
  // instante con la regla única calceCajaChica y le avisa de transferencias que aún no registra (registrar · ya la registré · no es caja).
  const miCfg = (EQUIPO_CFG||[]).find(s=>_norm(s.nombre)===_norm(me))
  const [misTransf,setMisTransf] = useState([])
  const [misConc,setMisConc] = useState(()=>new Set())
  const [misNoCaja,setMisNoCaja] = useState(()=>new Set())
  const [asociarDe,setAsociarDe] = useState(null)   // id de la transferencia que el miembro está asociando a una caja ya registrada
  const [ccBusy,setCcBusy] = useState(null)
  const cargarMisTransf = useCallback(async()=>{
    if(DEMO||!miCfg?.rut) return
    try{
      const desde=new Date(Date.now()-60*86400000).toISOString().slice(0,10)
      const {data:ms}=await supabase.from('cartola_movimientos').select('id,tipo,monto,monto_conciliado,fecha,rut_contraparte,es_interno,categoria,estado,descripcion').eq('tipo','cargo').in('rut_contraparte',[miCfg.rut,String(miCfg.rut).replace(/\./g,'')]).gte('fecha',desde)
      const ids=(ms||[]).map(m=>m.id)
      const {data:cs}=ids.length?await supabase.from('conciliacion').select('movimiento_id').in('movimiento_id',ids):{data:[]}
      const {data:nc}=ids.length?await supabase.from('learnings').select('key').eq('kind','cc_no_caja').in('key',ids.map(String)):{data:[]}
      setMisTransf(ms||[]); setMisConc(new Set((cs||[]).map(c=>String(c.movimiento_id)))); setMisNoCaja(new Set((nc||[]).map(r=>String(r.key))))
    }catch(_){}
  },[miCfg?.rut])   // eslint-disable-line
  useEffect(()=>{ cargarMisTransf() },[cargarMisTransf])
  const miCalce = useMemo(()=>{
    if(!miCfg) return null
    const sueldos={[_norm(me)]:new Set(misTransf.filter(m=>misConc.has(String(m.id))).map(m=>Math.round(Math.abs(m.monto||0))))}
    return calceCajaChica((pettyCash||[]).filter(p=>p.user_name===me), misTransf.filter(m=>!misNoCaja.has(String(m.id))), {equipo:[miCfg],conciliados:misConc,sueldos})
  },[pettyCash,misTransf,misConc,misNoCaja,me,miCfg])   // eslint-disable-line
  const enlazarMia = async(petty,cargo,nuevoMonto)=>{
    const monto=Math.round(Math.abs(cargo.monto||0))
    const nota=`${petty.notes||''}${nuevoMonto?` · ajustada de ${fmtCLP(petty.amount)} a lo transferido`:''} · mov:${cargo.id}`.trim()
    const patch={notes:nota,movimiento_id:cargo.id,...(nuevoMonto?{amount:monto}:{})}
    const {error}=await supabase.from('petty_cash').update(patch).eq('id',petty.id); if(error) throw error
    await supabase.from('cartola_movimientos').update({estado:'conciliado',monto_conciliado:monto,categoria:'Caja chica'}).eq('id',cargo.id)
    setPettyCash(p=>p.map(x=>x.id===petty.id?{...x,...patch}:x))
    setMisTransf(p=>p.map(m=>m.id===cargo.id?{...m,estado:'conciliado',categoria:'Caja chica'}:m))
    logActividad('cajachica.conciliada',{tabla:'petty_cash',id:petty.id,detalle:{title:`${me} · caja ${fmtFechaDMY(petty.delivered_at)} ↔ transferencia ${fmtFechaDMY(cargo.fecha)}`,monto}})
  }
  // Regla del usuario: mismo monto + transferencia el mismo día o el anterior → se enlaza sola apenas el miembro registra la caja.
  const autoCC=useRef(new Set())
  useEffect(()=>{ if(DEMO||!miCalce) return; miCalce.auto.forEach(({petty,cargo})=>{ const k=petty.id+'|'+cargo.id; if(autoCC.current.has(k)) return; autoCC.current.add(k); enlazarMia(petty,cargo).catch(()=>{}) }) },[miCalce])   // eslint-disable-line
  const registrarDesdeTransf = async(cargo)=>{
    setCcBusy(cargo.id)
    try{
      const monto=Math.round(Math.abs(cargo.monto||0))
      const {data,error}=await supabase.from('petty_cash').insert({user_name:me,amount:monto,delivered_at:_ccDia(cargo.fecha),notes:`Registrada desde la transferencia · mov:${cargo.id}`,movimiento_id:cargo.id}).select().single(); if(error) throw error
      await supabase.from('cartola_movimientos').update({estado:'conciliado',monto_conciliado:monto,categoria:'Caja chica'}).eq('id',cargo.id)
      setPettyCash(p=>[data,...p]); setMisTransf(p=>p.map(m=>m.id===cargo.id?{...m,estado:'conciliado',categoria:'Caja chica'}:m))
      logActividad('cajachica.registrada',{tabla:'petty_cash',id:data.id,detalle:{title:`Caja recibida · ${me} · desde la transferencia ${fmtFechaDMY(cargo.fecha)}`,monto}})
    }catch(e){ appAlert('No se pudo registrar: '+e.message) }
    setCcBusy(null)
  }
  const asociarTransf = async(cargo,petty)=>{
    setCcBusy(cargo.id)
    try{ await enlazarMia(petty,cargo,Math.round(Math.abs(cargo.monto||0))!==Math.round(petty.amount||0)); setAsociarDe(null) }catch(e){ appAlert('No se pudo asociar: '+e.message) }
    setCcBusy(null)
  }
  const noEsCaja = async(cargo)=>{
    setMisNoCaja(p=>new Set([...p,String(cargo.id)]))
    try{ await supabase.from('learnings').delete().eq('kind','cc_no_caja').eq('key',String(cargo.id)); await supabase.from('learnings').insert({kind:'cc_no_caja',key:String(cargo.id),value:me}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
  }
  const [fCat,setFCat] = useState('')
  const [pettyQ,setPettyQ] = useState('')            // buscador libre de pendientes
  const [pettyOrd,setPettyOrd] = useState('nuevo')   // orden por fecha: nuevo↔antiguo
  // Asistente IA de liquidación: revisa pendientes (determinista) + sugiere cliente/categoría (IA), aprende.
  const [asistOpen,setAsistOpen] = useState(false)
  const [asistBusy,setAsistBusy] = useState(false)
  const [asistRan,setAsistRan] = useState(false)
  const [iaSug,setIaSug] = useState({})        // {expenseId:{client_id?,category?,cliLearned?,catLearned?}}
  const [asistAttach,setAsistAttach] = useState(new Set())  // ids con comprobante de respaldo (informativo)
  const [dupOk,setDupOk] = useState(new Set())  // ids que el usuario marcó "son distintos"
  const [pickCliFor,setPickCliFor] = useState(null)  // id del gasto con picker de cliente abierto
  const [pickCatFor,setPickCatFor] = useState(null)  // id del gasto con selector de categoría abierto

  // Gastos pendientes de liquidar DEL USUARIO (tipo gasto, no rendidos, created_by = me)
  const misPendientes = gastosPorLiquidarCaja(expenses, me)
  const pendientes = misPendientes
    .filter(e=>!fCat||e.category===fCat)
    .filter(e=>{ const q=pettyQ.trim().toLowerCase(); if(!q) return true; return (e.concept||'').toLowerCase().includes(q) || String(Math.round(e.amount||0)).includes(q.replace(/[.$\s]/g,'')) })
    .sort((a,b)=>{ const c=(a.date||'')<(b.date||'')?1:-1; return pettyOrd==='nuevo'?c:-c })
  // "Sin liquidar": total pendiente del usuario, independiente del filtro de categoría
  const sinLiquidar = misPendientes.reduce((a,e)=>a+(e.amount||0),0)

  // Caja actual del usuario
  const miCaja = pettyCash.filter(p=>p.user_name===me)
  const saldoCaja = saldoCajaChica(pettyCash, expenses, me)
  const ultCaja = [...miCaja].sort((a,b)=>String(b.delivered_at||'').localeCompare(String(a.delivered_at||'')))[0]||null
  // Ritmo de gasto: lo gastado en los últimos 90 días (mismo universo que el saldo) → cuántos días alcanza la caja. Solo con historia suficiente.
  const _hace90 = new Date(Date.now()-90*86400000).toISOString().slice(0,10)
  const _g90 = expenses.filter(e=>e.type==='gasto'&&e.created_by===me&&!e.paid_by_client&&e.date&&e.date>=_hace90)
  const ritmoMes = _g90.length>=5 ? _g90.reduce((a,e)=>a+(e.amount||0),0)/3 : 0
  const diasAlcanza = ritmoMes>0&&saldoCaja>0 ? Math.round(saldoCaja/(ritmoMes/30)) : null
  const diasDe = d => d ? Math.floor((Date.now()-new Date(d+'T12:00').getTime())/86400000) : null
  const faltaDe = e => !e.category ? 'categoría' : (!e.client_id&&e.category!=='Fondo') ? 'cliente' : null

  const toggleSelect = id => setSelected(prev=>{
    const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n
  })

  // Selección estable: se arma sobre TODOS los pendientes del usuario (no se pierde al filtrar por categoría)
  const seleccionados = misPendientes.filter(e=>selected.has(e.id))
  const totalSel = seleccionados.reduce((a,e)=>a+(e.amount||0),0)

  const fmtCLP = fmtN
  const CATS = CAT_COLORS
  // Pills de categoría en PENDIENTES: [valor en DB, etiqueta mostrada]
  const CAT_PILLS = [['','Todos'],['Notaria','Notaria'],['CBR','CBR'],['Movilización','Movil.'],['Archivo Judicial','Archivo'],['Diario Oficial','DO'],['Registro Civil','R. Civil'],['Otro','Otro']]
  const CAT_LIST = ['Notaria','CBR','Movilización','Archivo Judicial','Diario Oficial','Registro Civil','Fondo','Otro']
  const catLabel = c => c==='Diario Oficial'?'DO':c==='Registro Civil'?'R. Civil':c==='Movilización'?'Movil.':c==='Archivo Judicial'?'Archivo':(c||'Otro')
  const catBadge = c => c==='CBR'?{bg:C.border,color:C.accent}:(c==='Notaria'||c==='Diario Oficial')?{bg:C.soonBg,color:C.soon}:{bg:C.bgSoft,color:C.muted}
  // KPI cards (compartidas PENDIENTES/CAJA): mismo formato que Facturación — fondo con tinte de
  // color según el dato, label mayúscula muted, cifra bold del color. El bg se pasa por tarjeta.
  const kpiCard = {flex:1,minWidth:0,borderRadius:10,padding:'10px 12px',border:`1px solid ${C.border}`}
  const kpiLbl = {fontSize:9,color:C.muted,marginBottom:3,textTransform:'uppercase',letterSpacing:.4,whiteSpace:'nowrap'}
  const kpiVal = {fontSize:17,fontWeight:600,whiteSpace:'nowrap',lineHeight:1.15}
  const kpiSub = {fontSize:8,fontWeight:600,letterSpacing:.4,marginTop:1,textTransform:'uppercase'}

  // Auto-cierre del mensaje de confirmación post-liquidación
  useEffect(()=>{ if(toast){ const t=setTimeout(()=>setToast(null),7000); return ()=>clearTimeout(t) } },[toast])

  const periodoActual = () => new Date().toLocaleDateString('es-CL',{month:'long',year:'numeric'})
  // Período de la liquidación = mes(es) de los GASTOS, no el de hoy. Mismo criterio que la rendición al cliente.
  const periodoDeGastos = (gs) => {
    const fechas = (gs||[]).map(e=>e.date).filter(Boolean).sort()
    if(!fechas.length) return periodoActual()
    const mesAno = d => new Date(d+'T12:00').toLocaleDateString('es-CL',{month:'long',year:'numeric'})
    const dia = d => new Date(d+'T12:00').toLocaleDateString('es-CL')
    const ini=fechas[0], fin=fechas[fechas.length-1]
    return mesAno(ini)===mesAno(fin) ? mesAno(ini) : `${dia(ini)} – ${dia(fin)}`
  }

  // ── Asistente IA: clasificación determinista (listos / a revisar) ─────────────
  // Las cifras y la detección de problemas son deterministas; la IA solo sugiere cliente/categoría.
  const asistFindings = useMemo(()=>{
    if(!asistRan) return null
    // Posibles duplicados: mismo monto y misma fecha con glosa parecida → se marca todo menos el primero del grupo.
    const _dupM = posiblesDuplicadosGastos(misPendientes)
    const dupFlag = new Set(_dupM.keys())
    const revisar=[], listos=[]
    misPendientes.forEach(e=>{
      const sug=iaSug[e.id]||{}
      if(!e.client_id){ revisar.push({e,tipo:'cliente',sug}); return }
      if(!e.category){ revisar.push({e,tipo:'categoria',sug}); return }
      if(dupFlag.has(e.id)&&!dupOk.has(e.id)){ revisar.push({e,tipo:'dup',ref:_dupM.get(e.id)}); return }
      listos.push(e)
    })
    const totListos = listos.reduce((a,e)=>a+(e.amount||0),0)
    const conResp = misPendientes.filter(e=>asistAttach.has(String(e.id))).length
    return {revisar,listos,totListos,conResp}
  },[asistRan,misPendientes,iaSug,dupOk,asistAttach])

  const runAsistente = async() => {
    setAsistOpen(true); setAsistBusy(true); setAsistRan(false); setDupOk(new Set()); setIaSug({})
    try{
      const ids = misPendientes.map(e=>e.id)
      let attach=new Set()
      if(ids.length){ const {data}=await supabase.from('expense_attachments').select('expense_id').in('expense_id',ids); attach=new Set((data||[]).map(x=>String(x.expense_id))) }
      setAsistAttach(attach)
      const learnedCli={}, learnedCat={}
      const [{data:lc},{data:lk}] = await Promise.all([
        supabase.from('learnings').select('key,value').eq('kind','gasto_cliente').order('updated_at',{ascending:true}),
        supabase.from('learnings').select('key,value').eq('kind','gasto_categoria').order('updated_at',{ascending:true}),
      ])
      ;(lc||[]).forEach(r=>{ if(r.key&&r.value) learnedCli[r.key]=r.value })
      ;(lk||[]).forEach(r=>{ if(r.key&&r.value) learnedCat[r.key]=r.value })
      const sug={}, needIA=[]
      misPendientes.forEach(e=>{
        const gk=glosaKey(e.concept||''); const s={}
        if(!e.client_id && gk && learnedCli[gk] && clients.some(c=>String(c.id)===String(learnedCli[gk]))){ s.client_id=learnedCli[gk]; s.cliLearned=true }
        if(!e.category && gk && learnedCat[gk] && CAT_LIST.includes(learnedCat[gk])){ s.category=learnedCat[gk]; s.catLearned=true }
        if((!e.client_id&&!s.client_id)||(!e.category&&!s.category)) needIA.push(e)
        if(s.client_id||s.category) sug[e.id]=s
      })
      if(needIA.length){
        const clientList = clients.filter(c=>c.status!=='Terminado').map(c=>({id:c.id,nombre:c.name}))
        const prompt=`Eres asistente contable del estudio ${BRAND.nombre}. Te paso GASTOS de caja chica a los que les falta cliente o categoría, la lista de CLIENTES y las CATEGORÍAS válidas. Para cada gasto sugiere el cliente (id de la lista) y/o la categoría más probable según la glosa. Si no es claro, usa null. Devuelve SOLO un JSON array: [{"id":"<id del gasto>","client_id":"<id o null>","category":"<una de las categorías o null>"}]. NUNCA inventes un client_id fuera de la lista ni una categoría fuera de las dadas.\nCATEGORIAS: ${JSON.stringify(CAT_LIST)}\nCLIENTES: ${JSON.stringify(clientList)}\nGASTOS: ${JSON.stringify(needIA.map(e=>({id:e.id,glosa:e.concept||'',monto:e.amount||0,falta_cliente:!e.client_id,falta_categoria:!e.category})))}`
        try{
          const j=await claudeCall({model:'claude-opus-4-8',max_tokens:1500,messages:[{role:'user',content:prompt}]})
          const txt=j?.content?.[0]?.text||''
          const m=txt.match(/\[[\s\S]*\]/); const arr=m?JSON.parse(m[0]):[]
          arr.forEach(o=>{ const e=needIA.find(x=>String(x.id)===String(o.id)); if(!e) return; const s=sug[e.id]||{}; if(!e.client_id && o.client_id && clients.some(c=>String(c.id)===String(o.client_id))){ s.client_id=o.client_id; s.cliIA=true } if(!e.category && o.category && CAT_LIST.includes(o.category)){ s.category=o.category; s.catIA=true } if(s.client_id||s.category) sug[e.id]=s })
        }catch(err){}
      }
      setIaSug(sug)
    }catch(e){}
    setAsistBusy(false); setAsistRan(true)
  }

  const aplicarCliente = async(e,client_id) => {
    if(!client_id) return
    try{ okDB(await supabase.from('expenses').update({client_id}).eq('id',e.id),'asignar el cliente al gasto') }catch(e){registrarError({origen:'accion',vista:'expenses',err:e})}
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,client_id}:x))
    const gk=glosaKey(e.concept||''); if(gk) learnPut('gasto_cliente',gk,client_id)
    setPickCliFor(null)
  }
  const aplicarCategoria = async(e,category) => {
    if(!category) return
    const patch={category}
    // Movilización = siempre de la oficina: si el gasto no tiene cliente, lo asigna al cliente interno (Liberona Escala).
    if(category==='Movilización' && !e.client_id){ const ofi=(clients||[]).find(c=>c.is_internal||/liberona\s+escala/i.test(c.name||'')); if(ofi) patch.client_id=ofi.id }
    try{ okDB(await supabase.from('expenses').update(patch).eq('id',e.id),'guardar la categoría del gasto') }catch(e){registrarError({origen:'accion',vista:'expenses',err:e})}
    if(setExpenses) setExpenses(p=>p.map(x=>x.id===e.id?{...x,...patch}:x))
    const gk=glosaKey(e.concept||''); if(gk) learnPut('gasto_categoria',gk,category)
    setPickCatFor(null)
  }
  const seleccionarListos = (cerrar) => {
    if(!asistFindings) return
    setSelected(prev=>{ const n=new Set(prev); asistFindings.listos.forEach(e=>n.add(e.id)); return n })
    if(cerrar) setAsistOpen(false)
  }

  const handleLiquidar = async(abrirCorreo=false) => {
    if(!selected.size) return
    setSaving(true)
    try {
      const renderId = crypto.randomUUID()
      const now = new Date().toISOString()
      const gastosSel = seleccionados
      const periodo = periodoDeGastos(gastosSel)   // #2: período = mes(es) de los gastos, no el de hoy
      const totalLiq = gastosSel.reduce((a,e)=>a+(e.amount||0),0)
      const clientesIds = [...new Set(gastosSel.map(e=>e.client_id).filter(Boolean))]
      const otNumsLiq = [...new Set(gastosSel.map(e=>e.ot_number).filter(Boolean))].join(', ')   // OT de notaría incluidas
      // Registrar la liquidación PRIMERO — si falla, ningún gasto queda marcado
      const _fondo=miCaja.reduce((a,p)=>a+(p.amount||0),0)   // foto de la caja AL LIQUIDAR (fuente: saldoCajaChica)
      const {error:rErr} = await supabase.from('rendiciones').insert({ id: renderId, user_name: me, periodo, total: totalLiq, n_gastos: gastosSel.length, n_clientes: clientesIds.length, ot_numbers: otNumsLiq||null, fondo_recibido: Math.round(_fondo), gastado: Math.round(_fondo-saldoCaja), saldo_caja: Math.round(saldoCaja) })
      if(rErr) throw rErr
      // Marcar gastos — registrar cuáles SÍ se marcaron (marcados) para no inflar la rendición ante fallas parciales
      const erroresMarcado = [], marcados = []
      for(const e of gastosSel) {
        const {error} = await supabase.from('expenses').update({ rendered_at: now, render_id: renderId, rendered_by: me }).eq('id',e.id)
        if(error) erroresMarcado.push(e.concept||e.id); else marcados.push(e)
      }
      const totalReal = marcados.reduce((a,e)=>a+(e.amount||0),0)
      // #1: ajustar la rendición a los gastos REALMENTE marcados (no dejar total/n inflados); si no se marcó ninguno, cancelarla
      if(erroresMarcado.length){
        if(marcados.length===0){ await supabase.from('rendiciones').delete().eq('id',renderId); appAlert('No se pudo marcar ningún gasto. La liquidación se canceló; reintenta.'); setSaving(false); return }
        const nClientesReal = [...new Set(marcados.map(e=>e.client_id).filter(Boolean))].length
        await supabase.from('rendiciones').update({ total: totalReal, n_gastos: marcados.length, n_clientes: nClientesReal }).eq('id',renderId)
        appAlert(`Liquidación creada con ${marcados.length} gasto(s) por ${fmtCLP(totalReal)}. ${erroresMarcado.length} no se marcaron y siguen pendientes: ${erroresMarcado.join(', ')}.`)
      }
      // Estado local: usar SOLO los marcados (los que fallaron siguen en pendientes sin recargar)
      const marcadosIds = new Set(marcados.map(e=>e.id))
      setRendiciones(p=>[{id:renderId,user_name:me,periodo,total:totalReal,n_gastos:marcados.length,n_clientes:[...new Set(marcados.map(e=>e.client_id).filter(Boolean))].length,created_at:now,ot_numbers:otNumsLiq||null,fondo_recibido:Math.round(miCaja.reduce((a,p)=>a+(p.amount||0),0)),gastado:Math.round(miCaja.reduce((a,p)=>a+(p.amount||0),0)-saldoCaja),saldo_caja:Math.round(saldoCaja)},...p])
      if(setExpenses) setExpenses(p=>p.map(e=>marcadosIds.has(e.id)?{...e,rendered_at:now,render_id:renderId,rendered_by:me}:e))
      // Trazabilidad: avisar a los admin cuando un limited liquida su caja chica (no cuando liquida un admin). No bloquea.
      // Resumen de caja para la liquidación (fuente única saldoCajaChica): fondo recibido · gastado · saldo; si es negativo, lo puso de su bolsillo → a reembolsar.
      const fondoTot=miCaja.reduce((a,p)=>a+(p.amount||0),0), gastadoTot=fondoTot-saldoCaja, cubierto=Math.max(0,-saldoCaja)
      // Aviso a los socios al teléfono (decisión del 26-10-2026: ya no por correo); el PDF y el anexo quedan en la liquidación.
      if(!adminNombres.includes(me)&&!DEMO){ try{ supabase.functions.invoke('push',{body:{action:'avisar',tipo:'cajachica',etiqueta:`liq-${renderId}`,titulo:'Liquidación de caja chica',cuerpo:`${me} · ${marcados.length} gasto${marcados.length!==1?'s':''} · ${fmtCLP(totalReal)}${cubierto>0?` · a reembolsar ${fmtCLP(cubierto)}`:''}`,url:`/?liquidacion=${renderId}`}}).catch(()=>{}) }catch(e){registrarError({origen:'accion',vista:'push',err:e})} }
      setSelected(new Set())
      setConfirmLiq(false)
      let correoOk = false
      if(abrirCorreo) {
        const dest = (enviarA||'').trim() || adminEmails.join(',')
        const asunto = 'Liquidación caja chica — ' + me + ' — ' + periodo
        const lineas = marcados.map(e=>{ const cn=clients.find(cl=>cl.id===e.client_id)?.name||'Sin cliente'; return '• '+fmtFechaDMY(e.date)+' · '+(e.concept||'—')+' · '+cn+' · '+(e.category||'Otro')+' · $'+(e.amount||0).toLocaleString('es-CL') }).join('\n')
        const texto = 'Estimados,\n\nEspero que estén muy bien. Adjunto la liquidación de caja chica.\n\nResponsable: '+me+'\nPeríodo: '+periodo+'\nN° de gastos: '+marcados.length+'\nFondo recibido: '+fmtCLP(fondoTot)+'\nGastado: '+fmtCLP(gastadoTot)+'\n'+(cubierto>0?'Cubierto por '+me+' — a reembolsar: '+fmtCLP(cubierto):'Saldo de caja: '+fmtCLP(saldoCaja))+'\n\nDetalle:\n'+lineas+'\n\nTOTAL: $'+totalReal.toLocaleString('es-CL')+'\n\nQuedo a disposición para cualquier consulta.'
        // Mismo flujo que la rendición al cliente: Gmail API con PDF adjunto + cuerpo HTML; si no hay token, fallback a mailto + PDF imprimible.
        let sent=false
        // HTML + PDF se arman una sola vez (no dependen del token), para servir tanto al envío
        // desde el correo del usuario como al fallback desde el servidor (oficina).
        const porCli={}; marcados.forEach(e=>{ const cn=clients.find(cl=>cl.id===e.client_id)?.name||'Sin cliente'; (porCli[cn]=porCli[cn]||[]).push(e) })
        const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        const filasHtml = Object.entries(porCli).map(([cn,gs])=>{
          const tot=gs.reduce((a,e)=>a+(e.amount||0),0)
          const rows=gs.map(e=>`<tr><td style="padding:4px 0;font-size:12px;color:#3D3D3D">${fmtFechaDMY(e.date)} · ${esc((e.concept||'—'))}</td><td style="padding:4px 0;font-size:12px;color:#E24B4A;text-align:right;font-weight:bold;white-space:nowrap">-$${(e.amount||0).toLocaleString('es-CL')}</td></tr>`).join('')
          return `<div style="margin-top:14px"><div style="font-size:13px;font-weight:bold;color:#003C50;border-bottom:1px solid #003C50;padding-bottom:3px">${esc(cn)} — $${tot.toLocaleString('es-CL')}</div><table style="width:100%;border-collapse:collapse">${rows}</table></div>`
        }).join('')
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f0f2f4;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8eb"><div style="background:#003C50;padding:20px 28px;text-align:center"><img src="${BRAND.logoUrl}${BRAND.logo.blanco}" alt="${BRAND.nombre}" height="28" width="184" style="height:28px;width:184px;display:inline-block;border:0"/></div><div style="padding:28px"><div style="font-size:16px;color:#1a1a1a;margin:0 0 6px">Estimados,</div><div style="font-size:14px;color:#666666;margin:0 0 16px">Espero que estén muy bien. Adjunto la liquidación de caja chica de <b>${esc(me)}</b> — ${esc(periodo)}.</div><div style="background:#f5f5f5;border-radius:8px;padding:16px"><div style="font-size:13px;color:#666666">N° de gastos: <b style="color:#1a1a1a">${marcados.length}</b></div><table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px;color:#3D3D3D"><tr><td style="padding:3px 0">Fondo recibido</td><td style="padding:3px 0;text-align:right">$${fondoTot.toLocaleString('es-CL')}</td></tr><tr><td style="padding:3px 0">Gastado</td><td style="padding:3px 0;text-align:right;color:#E24B4A">-$${gastadoTot.toLocaleString('es-CL')}</td></tr>${cubierto>0?`<tr><td style="padding:8px 0 3px;font-weight:bold;border-top:1.5px solid #537281">Cubierto por ${esc(me)} — a reembolsar</td><td style="padding:8px 0 3px;text-align:right;font-weight:bold;color:#A32D2D;border-top:1.5px solid #537281">$${cubierto.toLocaleString('es-CL')}</td></tr>`:`<tr><td style="padding:8px 0 3px;font-weight:bold;border-top:1.5px solid #537281">Saldo de caja</td><td style="padding:8px 0 3px;text-align:right;font-weight:bold;color:#0F6E56;border-top:1.5px solid #537281">$${saldoCaja.toLocaleString('es-CL')}</td></tr>`}</table>${filasHtml}<table style="width:100%;border-collapse:collapse;border-top:1.5px solid #537281;margin-top:14px"><tr><td style="padding-top:8px;font-size:13px;font-weight:bold;color:#1a1a1a">TOTAL</td><td style="padding-top:8px;font-size:13px;font-weight:bold;color:#E24B4A;text-align:right">-$${totalReal.toLocaleString('es-CL')}</td></tr></table></div><div style="font-size:12px;color:#999999;margin-top:16px">Se adjunta el PDF con el detalle por cliente.</div></div><div style="padding:16px 28px;border-top:1px solid #eeeeee"><div style="font-size:11px;color:#999999">${BRAND.dominio} · ${BRAND.nombre}</div></div></div></body></html>`
        const toAll = (cc||'').trim() ? dest+','+cc.trim() : dest
        const pdfName = `Liquidacion ${me} ${periodo}`.replace(/[^\w\s-]/g,'').trim()+'.pdf'
        let pdf=null; try{ pdf = await liquidacionPdfBase64({me, periodo, gastos:marcados, clients, resumen:{fondo:fondoTot, gastado:gastadoTot, saldo:saldoCaja}}) }catch(_){}
        const emb = await incrustarLogosCorreo(html)   // logo INLINE (CID) para que se vea en Gmail (no imagen remota)
        // 1) desde el correo del propio usuario (Gmail API)
        try{
          const token = await driveToken()
          if(token && pdf){ await sendGmailWithPdf(token, {to:toAll, subject:asunto, bodyText:texto, bodyHtml:emb.html, inlineImages:emb.inlineImages, pdfBase64:pdf, pdfName}); sent='usuario' }
        }catch(_){ sent=false }
        // 2) si el Gmail del usuario falló, se PREGUNTA antes de usar la oficina; si dice que no, cae al mailto (3) desde su correo
        if(!sent && pdf && await appConfirm(MAIL_OFICINA_CONFIRM)){ try{ await sendMailServer({to:toAll, subject:asunto, html, text:texto, pdfBase64:pdf, pdfName}); sent='oficina' }catch(_){ sent=false } }
        // 3) último recurso: mailto + PDF imprimible para adjuntar a mano
        if(!sent){
          const ccStr = (cc||'').trim() ? '&cc=' + encodeURIComponent(cc.trim()) : ''
          const mailLink = document.createElement('a')
          mailLink.href = 'mailto:' + dest + '?subject=' + encodeURIComponent(asunto) + ccStr + '&body=' + encodeURIComponent(texto)
          mailLink.click()
          try{ generatePDF() }catch(_){}   // abre el PDF imprimible para adjuntar a mano
        }
        // Confirmación explícita: salió (desde qué cuenta y a quién) o no salió y quedó abierto el correo para enviarlo a mano.
        correoOk = sent ? {ok:true, t:txtEnviado(sent,{que:'Correo de la liquidación', para:toAll})} : {ok:false, t:'El correo NO se envió automáticamente: se abrió tu correo para enviarlo a mano con el PDF. '+TXT_REINGRESO()}
      }
      setToast({ n: marcados.length, total: totalReal, correo: correoOk })
    } catch(e) { appAlert('Error: '+e.message) }
    setSaving(false)
  }

  const handleNuevaCaja = async() => {
    if(!newMonto||!(parseInt(newMonto)>0)) return
    setSaving(true)
    try {
      const patch = { amount: parseInt(newMonto), delivered_at: newFecha, delivered_by: newDeliveredBy||null, notes: newNota||null }
      if(editCajaId){
        const {data,error} = await supabase.from('petty_cash').update(patch).eq('id',editCajaId).select().single()
        if(error) throw error
        setPettyCash(p=>p.map(x=>x.id===editCajaId?data:x))
      } else {
        const {data,error} = await supabase.from('petty_cash').insert({user_name:me, ...patch}).select().single()
        if(error) throw error
        setPettyCash(p=>[data,...p])
        logActividad('cajachica.registrada',{tabla:'petty_cash',id:data.id,detalle:{title:`Caja recibida · ${me}${patch.delivered_by?` · de ${patch.delivered_by}`:''}`,monto:patch.amount}})
      }
      setNewMonto(''); setNewNota(''); setNewFecha(new Date().toISOString().slice(0,10)); setEditCajaId(null); setShowNuevaCaja(false)
    } catch(e) { appAlert('Error: '+e.message) }
    setSaving(false)
  }
  const handleBorrarCaja = async() => {
    if(!editCajaId || !await appConfirm('¿Eliminar esta caja entregada? Hazlo solo si la registraste por error (no borra los gastos, solo el monto entregado).')) return
    setSaving(true)
    try { const {error} = await supabase.from('petty_cash').delete().eq('id',editCajaId); if(error) throw error; setPettyCash(p=>p.filter(x=>x.id!==editCajaId)); setNewMonto(''); setNewNota(''); setEditCajaId(null); setShowNuevaCaja(false) }
    catch(e) { appAlert('Error: '+e.message) }
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
      <div><div class='firma'>${BRAND.nombre}</div><div style='font-size:9px;opacity:.7;text-transform:uppercase;margin-top:2px'>${BRAND.web}</div></div>
      <div class='doc-title'><div>Liquidación de Caja Chica</div><div style='font-size:11px;opacity:.8;margin-top:2px'>${me} · ${now}</div></div>
    </div>
    <div class='kpi-row'>
      <div class='kpi'><div class='kpi-label'>Número de gastos</div><div class='kpi-value'>${gastosSel.length}</div></div>
      <div class='kpi'><div class='kpi-label'>Clientes</div><div class='kpi-value'>${Object.keys(porCliente).length}</div></div>
      <div class='kpi'><div class='kpi-label'>Total a rendir</div><div class='kpi-value'>${fmtN(totalSel)}</div></div>
    </div>`
    Object.entries(porCliente).forEach(([cname,gastos])=>{
      const tot=gastos.reduce((a,e)=>a+(e.amount||0),0)
      html+=`<div class='section-title'>${cname} — ${fmtN(tot)}</div>
      <table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th style='text-align:right'>Monto</th></tr></thead><tbody>`
      gastos.forEach(e=>{ html+=`<tr><td>${e.date||'—'}</td><td>${e.category||'Otro'}</td><td>${e.concept||'—'}</td><td style='text-align:right;font-weight:600;color:#E24B4A'>-${fmtN(e.amount)}</td></tr>` })
      html+=`</tbody><tfoot><tr><td colspan='3'>TOTAL ${cname.toUpperCase()}</td><td style='text-align:right;color:#E24B4A'>-${fmtN(tot)}</td></tr></tfoot></table>`
    })
    html+=`<div class='footer'><span>${BRAND.nombre} · ${BRAND.web}</span><span>${me} · ${now}</span><span>CONFIDENCIAL</span></div>
    <button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button>
    </body></html>`
    const w=window.open('','_blank'); w.document.write(html); w.document.close()
  }

  // LIQUIDAR = PÁGINA (antes ventana de 340px): gastos por cliente, cómo queda tu caja (misma fórmula del PDF y el correo) y a quién se envía.
  if(confirmLiq){
    const gastosSel = seleccionados
    const totalLiq = gastosSel.reduce((a,e)=>a+(e.amount||0),0)
    const fondoTot = miCaja.reduce((a,p)=>a+(p.amount||0),0), gastadoTot = fondoTot-saldoCaja
    const porCli = {}; gastosSel.forEach(e=>{ const cn=clients.find(cl=>cl.id===e.client_id)?.name||'Sin cliente'; (porCli[cn]=porCli[cn]||[]).push(e) })
    const grupos = Object.entries(porCli).sort((a,b)=>a[0].localeCompare(b[0],'es'))
    const inp = {width:'100%',boxSizing:'border-box',border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',fontSize:13,background:C.bgSoft,color:C.text,outline:'none'}
    const ln = (l,v,col,b) => <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,padding:b?'8px 0 2px':'4px 0',borderTop:b?`1px solid ${C.track}`:'none',marginTop:b?4:0,fontSize:b?13:12.5,fontWeight:b?700:500}}><span style={{color:b?C.text:C.muted}}>{l}</span><span style={{fontVariantNumeric:'tabular-nums',fontWeight:700,color:col||C.text}}>{v}</span></div>
    const lista = (
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        <div style={{...SEC_LBL,padding:'10px 14px 6px'}}>Gastos a liquidar · período {periodoDeGastos(gastosSel)}</div>
        {grupos.map(([cn,gs])=>(<div key={cn}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,padding:'8px 14px 4px',borderTop:`1px solid ${C.track}`}}><span style={{fontSize:12.5,fontWeight:700,color:C.accent}}>{cn}</span><span style={{fontSize:12,fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(gs.reduce((a,e)=>a+(e.amount||0),0))}</span></div>
          {gs.map(e=>(<div key={e.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 14px 6px 22px',fontSize:12}}>
            <span style={{width:74,flexShrink:0,color:C.muted,fontSize:11}}>{fmtFechaDMY(e.date)}</span>
            <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:C.text}}>{e.concept||'—'}<span style={{color:C.muted}}> · {catLabel(e.category)}</span></span>
            <span style={{fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmtCLP(e.amount)}</span>
          </div>))}
        </div>))}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:C.bgSoft,padding:'10px 14px',borderTop:`1px solid ${C.border}`}}><span style={{fontSize:12,fontWeight:700,color:C.text}}>Total · {gastosSel.length} gasto{gastosSel.length!==1?'s':''}</span><span style={{fontSize:15,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(totalLiq)}</span></div>
      </div>)
    const panel = (
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
          <div style={{...SEC_LBL,marginBottom:4}}>Cómo queda tu caja</div>
          {ln('Fondo recibido',fmtCLP(fondoTot))}
          {ln('Gastado',fmtCLP(gastadoTot))}
          {saldoCaja<0 ? ln('Cubierto por ti · a reembolsar',fmtCLP(-saldoCaja),C.overdueText,true) : ln('Saldo disponible',fmtCLP(saldoCaja),C.greenText,true)}
        </div>
        <ActBtn variant='primary' size='lg' full disabled={saving} onClick={()=>handleLiquidar(false)}>{saving?'Liquidando…':'Liquidar'}</ActBtn>
        {!adminNombres.includes(me)&&<div style={{fontSize:11,color:C.muted,textAlign:'center'}}>Los socios reciben el aviso en el teléfono, con el PDF en la app.</div>}
        <ActBtn full disabled={saving} onClick={generatePDF} style={{color:C.accent}}>Descargar PDF</ActBtn>
      </div>)
    return <FlujoPagina origen='Caja chica' titulo='Liquidar' ctx={`${gastosSel.length} gasto${gastosSel.length!==1?'s':''} · ${fmtCLP(totalLiq)}`} onBack={()=>{ if(!saving) setConfirmLiq(false) }} maxW={1060}>
      {isDesktop
        ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 340px',gap:18,alignItems:'start'}}>{lista}{panel}</div>
        : <div style={{display:'flex',flexDirection:'column',gap:12}}>{panel.props.children[0]}{lista}{panel.props.children.slice(1)}</div>}
    </FlujoPagina>
  }
  if(movOpen) return <MovilizacionView expenses={expenses} clients={clients} persona={me} origen='Caja chica' onBack={()=>setMovOpen(false)} onEdit={onEditExpense}/>
  const _mv = movilizacionDatos(expenses, clients, {persona:me, anio:String(new Date().getFullYear())}), _mvMes=_mv.meses[0]
  return (
    <div style={{maxWidth:isDesktop?1120:820,margin:'0 auto'}}>{/* escritorio: PENDIENTES y CAJA lado a lado (1120). Móvil: columna + pestañas, idéntico. */}
      {/* Confirmación post-liquidación (PASO 3) */}
      {toast&&(
        <div style={{position:'fixed',top:12,left:0,right:0,zIndex:400,display:'flex',justifyContent:'center',padding:'0 16px',pointerEvents:'none'}}>
          <div style={{background:'#fff',border:'1px solid #1D9E75',borderRadius:10,padding:'12px 16px',maxWidth:520,width:'100%',boxShadow:'0 6px 24px rgba(0,0,0,.15)',pointerEvents:'auto',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.greenText}}>Liquidación registrada</div>
              <div style={{fontSize:12,color:C.text,marginTop:2}}>{toast.n} gasto{toast.n!==1?'s':''} liquidado{toast.n!==1?'s':''} por {fmtCLP(toast.total)}</div>
              {toast.correo&&<div style={{fontSize:11,color:toast.correo.ok?C.greenText:C.soonText,marginTop:5,fontWeight:600}}>{toast.correo.t}</div>}
            </div>
            <button onClick={()=>setToast(null)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0}}><Gl n='x'/></button>
          </div>
        </div>
      )}
      {/* ── Asistente IA de liquidación (modal centrado; no cierra al tocar fuera) ── */}
      {asistOpen&&(
        <Modal title='Asistente de liquidación' fullscreenOnMobile closeOnBackdrop={false} onClose={()=>setAsistOpen(false)} footer={<button onClick={()=>seleccionarListos(true)} disabled={!asistFindings||!asistFindings.listos.length} style={{width:'100%',height:44,background:(!asistFindings||!asistFindings.listos.length)?C.done:C.accent,color:'#fff',border:'none',borderRadius:10,fontSize:13,fontWeight:500,cursor:(!asistFindings||!asistFindings.listos.length)?'default':'pointer'}}>Confirmar los listos</button>}>
            <div style={{margin:'-14px -16px'}}>
              {asistBusy&&(
                <div style={{padding:'40px 20px',textAlign:'center',color:C.muted,fontSize:13}}>Revisando tus gastos pendientes…</div>
              )}
              {!asistBusy&&asistRan&&asistFindings&&(()=>{
                const {revisar,listos,totListos,conResp}=asistFindings
                if(!misPendientes.length) return <div style={{padding:'40px 20px',textAlign:'center',color:C.textSoft,fontSize:13}}>No tienes gastos pendientes de liquidar.</div>
                const cliName = id => clients.find(c=>String(c.id)===String(id))?.name||'cliente'
                const chip = (label,onClick,primary)=>(<button onClick={onClick} style={{height:24,display:'inline-flex',alignItems:'center',gap:4,padding:'0 10px',borderRadius:20,fontSize:11,cursor:'pointer',border:`0.5px solid ${primary?C.muted:C.border}`,background:'#fff',color:primary?C.accent:C.muted}}>{label}</button>)
                const check = <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>
                return (<>
                  <div style={{padding:'13px 16px',fontSize:13,lineHeight:1.55,color:C.muted,background:C.azulBg,borderBottom:`1px solid ${C.border}`}}>
                    Tienes <b style={{color:C.accent}}>{misPendientes.length} gasto{misPendientes.length!==1?'s':''}</b> sin liquidar por <b style={{color:C.accent}}>{fmtCLP(sinLiquidar)}</b>. {listos.length} list{listos.length!==1?'os':'o'}{revisar.length?`; ${revisar.length} para revisar`:''}.{conResp?` · ${conResp} con comprobante`:''}
                  </div>
                  {listos.length>0&&(
                    <div style={{padding:'13px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,background:C.greenBg,borderBottom:`1px solid ${C.border}`}}>
                      <div>
                        <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:.4,color:C.greenText,fontWeight:600}}>Listos para liquidar</div>
                        <div style={{fontSize:16,fontWeight:500,color:C.greenText,marginTop:2}}>{listos.length} gasto{listos.length!==1?'s':''} · {fmtCLP(totListos)}</div>
                      </div>
                      <button onClick={()=>seleccionarListos(false)} style={{height:24,padding:'0 14px',background:C.greenText,color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>Seleccionar</button>
                    </div>
                  )}
                  {revisar.length>0&&<div style={{...SEC_LBL,padding:'11px 16px 4px'}}>Revisar antes · {revisar.length}</div>}
                  {revisar.map(({e,tipo,sug,ref})=>{
                    const dot = tipo==='dup'?C.overdue:C.soon
                    return (
                      <div key={e.id} style={{padding:'9px 16px',borderBottom:`0.5px solid ${C.border}`,display:'flex',gap:10,alignItems:'flex-start'}}>
                        <span style={{width:8,height:8,borderRadius:'50%',background:dot,flexShrink:0,marginTop:5}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'} · <span style={{color:C.muted}}>{fmtCLP(e.amount)}</span></div>
                          <div style={{fontSize:11,color:C.textSoft,marginTop:1}}>
                            {tipo==='cliente'?'Sin cliente asignado':tipo==='categoria'?'Sin categoría':`Posible duplicado${ref?` (mismo monto y fecha que «${(ref.concept||'—').slice(0,28)}»)`:''}`}
                          </div>
                          <div style={{marginTop:6,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                            {tipo==='cliente'&&<>
                              {sug&&sug.client_id&&chip(<>{cliName(sug.client_id)} {check}{(sug.cliLearned||sug.cliIA)&&<span style={{color:sug.cliLearned?C.greenText:C.muted,marginLeft:2}}>{sug.cliLearned?<Sparkle/>:'IA'}</span>}</>,()=>aplicarCliente(e,sug.client_id),true)}
                              {chip('Elegir otro',()=>setPickCliFor(pickCliFor===e.id?null:e.id))}
                              {pickCliFor===e.id&&<div style={{flexBasis:'100%'}}><ClientePicker clients={clients} onPick={cid=>aplicarCliente(e,cid)}/></div>}
                            </>}
                            {tipo==='categoria'&&<>
                              {sug&&sug.category&&chip(<>{catLabel(sug.category)} {check}{(sug.catLearned||sug.catIA)&&<span style={{color:sug.catLearned?C.greenText:C.muted,marginLeft:2}}>{sug.catLearned?<Sparkle/>:'IA'}</span>}</>,()=>aplicarCategoria(e,sug.category),true)}
                              {chip('Otra',()=>setPickCatFor(pickCatFor===e.id?null:e.id))}
                              {pickCatFor===e.id&&<div style={{flexBasis:'100%',display:'flex',gap:6,flexWrap:'wrap',marginTop:2}}>{CAT_LIST.map(c=>chip(catLabel(c),()=>aplicarCategoria(e,c)))}</div>}
                            </>}
                            {tipo==='dup'&&<>
                              {chip('Son distintos',()=>setDupOk(p=>{const n=new Set(p);n.add(e.id);return n}),true)}
                            </>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {!revisar.length&&listos.length>0&&<div style={{padding:'14px 16px',fontSize:12,color:C.greenText,textAlign:'center'}}>Todo en orden — no hay nada que revisar.</div>}
                </>)
              })()}
            </div>
        </Modal>
      )}
      <div style={{padding:'20px 20px 10px',position:'sticky',top:0,background:C.bgSoft,zIndex:10}}>
        <div style={{fontSize:20,fontWeight:600,color:C.text,fontFamily:"'DM Sans',sans-serif",letterSpacing:-.4,marginBottom:12}}>Caja chica</div>
        {!isDesktop&&<div style={{display:'flex',background:C.bgSoft,borderRadius:10,padding:3,border:`1px solid ${C.border}`}}>
          {[['liquidar','POR LIQUIDAR'],['caja','HISTORIAL']].map(([id,lbl])=>{ const on=tab===id; return (
            <button key={id} onClick={()=>setTab(id)} style={{flex:1,padding:'8px 0',borderRadius:8,border:'none',
              background:on?C.accent:'transparent',color:on?'#fff':C.muted,
              fontSize:12,fontWeight:700,letterSpacing:'.05em',cursor:'pointer',transition:'background .15s'}}>{lbl}</button>
          )})}
        </div>}
      </div>

      <div style={isDesktop?{display:'flex',alignItems:'flex-start',gap:18,padding:'0 6px'}:undefined}>
      {(tab==='liquidar'||isDesktop)&&(
        <div style={isDesktop?{flex:1,minWidth:0,padding:'0 0 40px'}:{padding:'0 0 130px'}}>
          {/* Resumen (canon): Saldo caja protagonista; Sin liquidar = chip de acción (el saldo ya descuenta todos los gastos) */}
          <div style={{padding:'2px 14px 10px'}}>
            {(()=>{ const sch = saldoCaja<0 ? {num:C.overdue,bg:C.overdueBg,bd:'#F2D5D5',label:C.muted} : saldoCaja<=(BRAND.cajaChicaUmbral||50000) ? {num:C.soon,bg:'#FEF6EE',bd:'#F5E2CC',label:C.soon} : {num:C.normal,bg:C.greenBg,bd:'#D4EDE0',label:C.muted}; return (
            <div style={{background:sch.bg,borderRadius:10,padding:'12px 14px',border:`1px solid ${sch.bd}`,display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px 12px',flexWrap:'wrap'}}>
              <div style={{minWidth:0,flex:'1 1 200px'}}>
                <div style={{fontSize:10,fontWeight:600,color:sch.label,textTransform:'uppercase',letterSpacing:.5,marginBottom:4}}>Saldo en tu caja{saldoCaja<0?' · te debemos':''}</div>
                <div style={{fontSize:22,fontWeight:700,color:sch.num,lineHeight:1.1}}>{fmtSaldoG(saldoCaja)}</div>
                {ultCaja&&<div style={{fontSize:10,color:C.muted,marginTop:4}}>Última caja recibida · {fmtFechaDMY(ultCaja.delivered_at)} · {fmtCLP(ultCaja.amount)}</div>}
                {ritmoMes>0&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>Gastas ~{fmtCLP(Math.round(ritmoMes))}/mes (últimos 90 días){diasAlcanza!=null?` · tu caja alcanza ~${diasAlcanza} día${diasAlcanza!==1?'s':''}`:saldoCaja<0?' · conviene pedir reposición':''}</div>}
              </div>
              {sinLiquidar>0&&<span style={{flexShrink:0,fontSize:11,fontWeight:600,color:C.soon,background:'#fff',border:'0.5px solid #F5E2CC',padding:'5px 11px',borderRadius:20,whiteSpace:'nowrap'}}>{misPendientes.length} por liquidar · {fmtCLP(sinLiquidar)}</span>}
            </div>) })()}
            {_mv.tot.n>0&&<div onClick={()=>setMovOpen(true)} style={{marginTop:8,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
              <span style={{width:30,height:30,borderRadius:9,background:C.tealBg||C.azulBg,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><MovIcon s={15} c={C.tealText||C.accent}/></span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>Mi movilización{_mvMes&&_mvMes.k!=='sin fecha'?` · ${MES_L[+_mvMes.k.slice(5,7)-1]||''}`:''}</div>
                <div style={{fontSize:11.5,color:_mv.sinMotivo.length?C.soonText:C.muted,fontWeight:_mv.sinMotivo.length?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{_mv.sinMotivo.length?`${_mv.sinMotivo.length} viaje${_mv.sinMotivo.length!==1?'s':''} sin motivo · complétalos`:`${_mvMes?_mvMes.n:0} viaje${_mvMes&&_mvMes.n===1?'':'s'} este mes · ${_mv.tot.n} en el año`}</div></div>
              {_mvMes&&<span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(_mvMes.tot)}</span>}
              <span style={{color:C.textSoft}}><Gl n='chevron'/></span>
            </div>}
            {saldoCaja>=0&&saldoCaja<=(BRAND.cajaChicaUmbral||0)&&<div style={{marginTop:8,background:C.soonBg,borderRadius:10,padding:'9px 12px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}><span style={{fontSize:13,fontWeight:700,color:C.soonText}}>Caja chica baja</span><span style={{fontSize:11.5,color:C.soonText}}>Quedan {fmtCLP(saldoCaja)} · aviso a la oficina</span></div>}
          </div>
          {/* MIS GASTOS + asistente IA + conteo */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'2px 14px 8px'}}>
            <span style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}><span style={{fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase',whiteSpace:'nowrap'}}>Por liquidar · {misPendientes.length}</span>
              {misPendientes.length>1&&<button onClick={()=>setSelected(prev=>prev.size===misPendientes.length?new Set():new Set(misPendientes.map(e=>e.id)))} style={{height:26,padding:'0 11px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>{selected.size===misPendientes.length?'Quitar selección':'Seleccionar todos'}</button>}</span>
            <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
              {misPendientes.length>0&&<button onClick={runAsistente} style={{height:24,display:'inline-flex',alignItems:'center',gap:5,padding:'0 11px',borderRadius:8,border:`0.5px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
                <svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15l-1.6-4.2L6 9.2l4.4-1.6z'/><path d='M19 14l.7 2 2 .7-2 .7L19 19.4 18.3 17.4l-2-.7 2-.7z'/></svg>
                Asistente IA
              </button>}
              {isDesktop&&<span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>{pendientes.length} gasto{pendientes.length!==1?'s':''}</span>}
            </div>
          </div>
          {/* Pills de categoría */}
          <div style={{display:'flex',gap:6,flexWrap:isDesktop?'nowrap':'wrap',overflowX:isDesktop?'auto':'visible',padding:'0 14px 10px'}}>
            {CAT_PILLS.map(([val,lbl])=>{ const on=fCat===val; return (
              <button key={val||'todos'} onClick={()=>setFCat(val)} style={{height:24,display:'inline-flex',alignItems:'center',padding:'0 11px',borderRadius:20,fontSize:11,whiteSpace:'nowrap',cursor:'pointer',flexShrink:0,
                border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?C.accent:'#fff',color:on?'#fff':C.muted}}>{lbl}</button>
            )})}
          </div>
          {misPendientes.length>=6&&(
            <div style={{display:'flex',gap:8,alignItems:'center',padding:'0 14px 10px'}}>
              <input value={pettyQ} onChange={e=>setPettyQ(e.target.value)} placeholder='Buscar concepto o monto…' style={{flex:1,height:32,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'0 11px',fontSize:13,background:C.bgSoft,color:C.text,outline:'none'}}/>
              <button onClick={()=>setPettyOrd(o=>o==='nuevo'?'antiguo':'nuevo')} title='Orden por fecha' style={{height:24,padding:'0 11px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap',flexShrink:0}}>{pettyOrd==='nuevo'?'Nuevo → antiguo':'Antiguo → nuevo'}</button>
            </div>
          )}
          {/* Filas de gasto */}
          {pendientes.length===0&&<div style={{color:C.textSoft,textAlign:'center',padding:36,fontSize:13}}>{pettyQ?'Sin resultados para la búsqueda':'No tienes gastos pendientes de liquidar'}</div>}
          {isDesktop && pendientes.length>0 ? (
            /* Escritorio: tabla (misma fuente `pendientes`, misma selección). Móvil: filas de abajo, intactas. */
            <div style={{padding:'0 14px'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5,tableLayout:'fixed'}}>
              <colgroup><col style={{width:30}}/><col style={{width:88}}/><col/><col style={{width:66}}/><col style={{width:84}}/></colgroup>
              <thead><tr>{['','Fecha','Concepto · cliente','Categoría','Monto'].map((h,i)=><th key={i} style={{...TH_BAND,textAlign:i===4?'right':'left',padding:'6px 8px',borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
              <tbody>{pendientes.map(e=>{ const client=clients.find(cl=>cl.id===e.client_id); const isSel=selected.has(e.id); const bdg=catBadge(e.category); return (
                <tr key={e.id} onClick={()=>toggleSelect(e.id)} style={{cursor:'pointer',background:isSel?C.bgSoft:'transparent'}}>
                  <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,width:28}}><span style={{display:'inline-flex',width:17,height:17,borderRadius:6,alignItems:'center',justifyContent:'center',border:`1.5px solid ${isSel?C.accent:C.done}`,background:isSel?C.accent:'transparent'}}>{isSel&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}</span></td>
                  <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,whiteSpace:'nowrap',color:C.muted}}>{fmtFechaDMY(e.date)}{(()=>{ const d=diasDe(e.date); return d!=null&&d>30?<div style={{fontSize:10,color:C.soonText,fontWeight:600}}>hace {d} días</div>:null })()}</td>
                  <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,minWidth:0}}><div style={{fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={e.concept||''}>{e.concept||'—'}</div><div style={{fontSize:11.5,marginTop:1,display:'flex',alignItems:'baseline',gap:8,minWidth:0}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{client?<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(client.id)}} style={{color:C.muted,fontWeight:600,cursor:'pointer'}}>{client.name}</span>:(e.category==='Fondo'?<span style={{color:C.textSoft}}>—</span>:<span onClick={onEditExpense?(ev=>{ev.stopPropagation();onEditExpense(e)}):undefined} style={{fontSize:11,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:4,padding:'1px 6px',cursor:onEditExpense?'pointer':'default',whiteSpace:'nowrap'}}>falta cliente{onEditExpense?<>{" "}· completar{" "}<Gl n='chevron'/></>:''}</span>)}</span>{onEditExpense&&<span onClick={ev=>{ev.stopPropagation();onEditExpense(e)}} style={{flexShrink:0,fontSize:11,fontWeight:600,color:C.azulInfo,cursor:'pointer'}}>editar</span>}</div></td>
                  <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`}}>{e.category?<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,fontWeight:700,background:bdg.bg,color:bdg.color,whiteSpace:'nowrap'}}>{catLabel(e.category)}</span>:<span style={{fontSize:10,color:C.soon,fontWeight:600}}>sin categoría</span>}</td>
                  <td style={{padding:'9px 8px',borderBottom:`0.5px solid ${C.bgSoft}`,textAlign:'right',fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmtCLP(e.amount)}</td>
                </tr>) })}</tbody>
            </table></div>
          ) : pendientes.map(e=>{
            const client=clients.find(cl=>cl.id===e.client_id)
            const isSel=selected.has(e.id)
            const bdg=catBadge(e.category)
            return (
              <div key={e.id} onClick={()=>toggleSelect(e.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderBottom:'0.5px solid #E4E8EB',cursor:'pointer',background:isSel?C.bgSoft:'transparent'}}>
                <div style={{width:17,height:17,borderRadius:6,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:`1.5px solid ${isSel?C.accent:C.done}`,background:isSel?C.accent:'transparent'}}>
                  {isSel&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                </div>
                {bigDate(e.date)}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{e.concept||'—'}</div>
                  <div style={{fontSize:10,color:C.textSoft,marginTop:2,display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                    {client&&<span onClick={ev=>{ev.stopPropagation();onOpenClientFicha&&onOpenClientFicha(client.id)}} style={{color:C.muted,fontWeight:600,cursor:'pointer'}}>{client.name}</span>}
                    {(()=>{ const d=diasDe(e.date); return d!=null&&d>30?<span style={{color:C.soonText,fontWeight:600}}>hace {d} días</span>:null })()}
                    {faltaDe(e)
                      ? <span onClick={onEditExpense?(ev=>{ev.stopPropagation();onEditExpense(e)}):undefined} style={{fontSize:10,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:4,padding:'1px 6px',cursor:onEditExpense?'pointer':'default'}}>falta {faltaDe(e)}{onEditExpense?<>{" "}· completar{" "}<Gl n='chevron'/></>:''}</span>
                      : onEditExpense&&<span onClick={ev=>{ev.stopPropagation();onEditExpense(e)}} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>editar</span>}
                  </div>
                </div>
                <div style={{flexShrink:0,marginLeft:8,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(e.amount)}</span>
                  {e.category&&<span style={{fontSize:9.5,padding:'2px 8px',borderRadius:20,fontWeight:700,background:bdg.bg,color:bdg.color,whiteSpace:'nowrap'}}>{catLabel(e.category)}</span>}
                </div>
              </div>
            )
          })}
          {/* Barra inferior de liquidación */}
          {selected.size>0&&(
            <div style={isDesktop?{margin:'10px 14px 0',borderRadius:10,background:C.accent,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}:{position:'fixed',left:0,right:0,bottom:'calc(56px + env(safe-area-inset-bottom,0px))',background:C.accent,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',zIndex:49}}>
              <div>
                <div style={{fontSize:10,color:'rgba(255,255,255,.6)',letterSpacing:'.03em'}}>{selected.size} GASTO{selected.size!==1?'S':''} SELECCIONADO{selected.size!==1?'S':''}</div>
                <div style={{fontSize:16,fontWeight:600,color:'#fff',marginTop:1}}>{fmtCLP(totalSel)}</div>
              </div>
              <button onClick={()=>{ setEnviarA(adminEmails.join(', ')); setCc(''); setConfirmLiq(true) }} disabled={saving} style={{minHeight:isDesktop?34:40,padding:'0 16px',background:'#fff',color:C.accent,border:'none',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Liquidar {selected.size} · {fmtCLP(totalSel)} <Gl n='chevron'/></button>
            </div>
          )}
        </div>
      )}

      {(tab==='caja'||isDesktop)&&<div style={isDesktop?{width:360,flexShrink:0}:undefined}>{(()=>{
        const misRend = rendiciones.filter(r=>r.user_name===me && r.tipo!=='cliente').sort((a,b)=>(b.created_at||'')>(a.created_at||'')?1:-1)   // excluye rendiciones al cliente (no son liquidaciones de caja chica) para no doble-contar
        const totalLiquidado = misRend.reduce((a,r)=>a+(r.total||0),0)
        const cajasOrd = [...miCaja].sort((a,b)=>(b.delivered_at||'')>(a.delivered_at||'')?1:-1)
        const totalRecibido = cajasOrd.reduce((a,p)=>a+(p.amount||0),0)
        const secLbl = {fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase'}
        const totRow = (lbl,val)=>(<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:C.bgSoft,borderRadius:8,padding:'8px 11px',marginTop:8}}><span style={{fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.02em',textTransform:'uppercase'}}>{lbl}</span><span style={{fontSize:13,fontWeight:600,color:C.accent}}>{fmtCLP(val)}</span></div>)
        const fmtD = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
        return (
        <div style={{padding:'4px 0 100px'}}>
          {/* Historial: el saldo ya está arriba (una sola vez); aquí lo acumulado */}
          <div style={{padding:'4px 14px 10px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0 2px'}}>
              <span style={{fontSize:11,color:C.muted}}>Recibido a la fecha</span>
              <span style={{fontSize:13,fontWeight:600,color:C.muted}}>{fmtCLP(totalRecibido)}</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6,padding:'0 2px'}}>
              <span style={{fontSize:11,color:C.muted}}>Liquidado a la fecha</span>
              <span style={{fontSize:13,fontWeight:600,color:C.muted}}>{fmtCLP(totalLiquidado)}</span>
            </div>
          </div>
          {/* TRANSFERENCIAS A MÍ SIN CAJA: aviso simple con 3 salidas (registrar · ya la registré · no es caja chica). */}
          {(()=>{ if(!miCalce) return null
            const items=[...miCalce.sugeridos.filter(s=>s.tipo==='exacto'||s.tipo==='ajustar').map(s=>({cargo:s.cargos[0],sug:s.cajas[0]})),
              ...miCalce.transfSinCaja.filter(t=>!t.posibleSueldo).map(t=>({cargo:t.cargo}))].sort((a,b)=>String(b.cargo.fecha).localeCompare(String(a.cargo.fecha)))
            if(!items.length) return null
            const libres=(pettyCash||[]).filter(p=>p.user_name===me&&!p.movimiento_id&&!p.rendered_at)
            const bt=(on)=>({fontSize:11,fontWeight:700,borderRadius:8,padding:'6px 10px',cursor:'pointer',whiteSpace:'nowrap',border:on?'none':`1px solid ${C.border}`,background:on?C.accent:'#fff',color:on?'#fff':C.accent})
            return (
              <div style={{borderTop:`0.5px solid ${C.bgSoft}`,padding:'11px 14px',background:C.soonBg}}>
                <div style={{fontSize:12,fontWeight:700,color:C.soonText,marginBottom:8}}>Te transfirieron y no está registrado · {items.length}</div>
                {items.map(({cargo:m,sug})=>{ const b=ccBusy===m.id; return (
                  <div key={m.id} style={{background:'#fff',border:`1px solid ${C.border}`,borderRadius:10,padding:'9px 11px',marginBottom:7}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10}}>{diaGrande(_glosaTransf(m.descripcion).fecha||m.fecha)}<div style={{flex:1,minWidth:0}}>
                      {(()=>{ const g=_glosaTransf(m.descripcion); return <span style={{fontSize:12,fontWeight:600,color:C.text}}>Transferencia a ti{g.hora?<span style={{color:C.muted,fontWeight:400}}> · {g.hora}</span>:null}{g.cuenta?<span style={{color:C.muted,fontWeight:400}}> · cuenta ···{g.cuenta}</span>:null}</span> })()}</div>
                      <span style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(Math.abs(m.monto||0))}</span>
                    </div>
                    {sug&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>¿Es tu caja del {fmtFechaDMY(sug.delivered_at)} por {fmtCLP(sug.amount)}?</div>}
                    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
                      {sug ? <button disabled={b} onClick={()=>asociarTransf(m,sug)} style={bt(true)}>{b?'…':'Sí, es esa caja'}</button>
                           : <button disabled={b} onClick={()=>registrarDesdeTransf(m)} style={bt(true)}>{b?'…':'Registrar como caja'}</button>}
                      {libres.length>0&&<button disabled={b} onClick={()=>setAsociarDe(asociarDe===m.id?null:m.id)} style={bt(false)}>{sug?'Es otra caja':'Ya la registré'}</button>}
                      {sug&&<button disabled={b} onClick={()=>registrarDesdeTransf(m)} style={bt(false)}>Es una caja nueva</button>}
                      <button disabled={b} onClick={()=>noEsCaja(m)} style={{...bt(false),border:'none',background:'none',color:C.muted}}>No es caja chica</button>
                    </div>
                    {asociarDe===m.id&&<div style={{marginTop:8,borderTop:`1px solid ${C.bgSoft}`,paddingTop:6}}>
                      {libres.map(p=> <div key={p.id} onClick={()=>asociarTransf(m,p)} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'7px 2px',cursor:'pointer',fontSize:12,borderBottom:`1px solid ${C.bgSoft}`}}><span style={{color:C.text}}>Caja del {fmtFechaDMY(p.delivered_at)}{p.notes?<span style={{color:C.muted}}> · {p.notes}</span>:null}</span><span style={{fontWeight:700,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(p.amount)}</span></div>)}
                      <div style={{fontSize:10,color:C.textSoft,marginTop:5}}>Si el monto no coincide, la caja queda en lo transferido.</div>
                    </div>}
                  </div>) })}
              </div>) })()}
          {/* CAJAS RECIBIDAS: cada miembro registra lo que le transfieren (puede ser antes de la cartola); queda "por conciliar"
              hasta que el banco la enlaza (barrido caja-chica-sweep o conciliación). Conciliada = bloqueada para el miembro. */}
          <div style={{borderTop:`0.5px solid ${C.bgSoft}`,padding:'11px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:9}}>
              <span style={secLbl}>Cajas recibidas</span>
              <button onClick={()=>{ setEditCajaId(null); setNewMonto(''); setNewNota(''); setNewFecha(new Date().toISOString().slice(0,10)); setNewDeliveredBy(adminNombres.includes(me)?me:(adminNombres[0]||'')); setCajaOtra(false); setShowNuevaCaja(true) }} style={chipBtn('primary')}>+ Nueva Caja</button>
            </div>
            {cajasOrd.length===0&&<div style={{fontSize:12,color:C.textSoft,padding:'4px 0'}}>Aún no hay cajas registradas. Registra cada transferencia que recibas.</div>}
            {cajasOrd.map((p,i)=>{ const activa=i===0&&!p.rendered_at; const editable=!p.rendered_at&&(isAdmin||(!p.movimiento_id&&!_ccEsAjuste(p))); return (
              <div key={p.id} onClick={editable?()=>{ setEditCajaId(p.id); setNewMonto(String(p.amount||'')); setNewNota(p.notes||''); setNewFecha((p.delivered_at||new Date().toISOString()).slice(0,10)); setCajaOtra(true); setNewDeliveredBy(p.delivered_by||adminNombres[0]||''); setShowNuevaCaja(true) }:undefined} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'8px 0',borderBottom:`0.5px solid ${C.bgSoft}`,cursor:editable?'pointer':'default'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>{diaGrande(p.delivered_at)}<div style={{minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:C.text}}>{p.delivered_by?`De ${p.delivered_by}`:'Caja recibida'}{p.notes&&!String(p.notes).startsWith('Abono caja chica')&&!String(p.notes).startsWith('Registrada desde')?<span style={{color:C.muted}}> · {_ccNotaVisible(p.notes)}</span>:null}{editable&&<span style={{fontSize:10,color:C.accent,fontWeight:600,marginLeft:7}}>Editar</span>}</div>
                  {(()=>{ const d=p.delivered_at?_ccDias(new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}),p.delivered_at):0; const ajuste=_ccEsAjuste(p); const sinBanco=!ajuste&&!p.movimiento_id&&!p.rendered_at&&d>=5
                    const tm=p.movimiento_id&&misTransf.find(m=>m.id===p.movimiento_id); const tf=tm?(_glosaTransf(tm.descripcion).fecha||tm.fecha):null
                    return <div style={{fontSize:10,fontWeight:600,marginTop:1,color:p.movimiento_id?C.greenText:ajuste?C.muted:sinBanco?C.overdueText:C.soonText}}>{ajuste&&!p.movimiento_id?'ajuste de caja · sin transferencia':p.movimiento_id?(tf?`transferencia del ${fmtFechaDMY(tf)} conciliada ✓`:<>transferencia conciliada{" "}<Gl n='tick'/></>):sinBanco?`sin transferencia en el banco · ${nDias(d)}`:'transferencia por conciliar'}</div> })()}
                </div>
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmtCLP(p.amount)}</div>
                  <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:activa?C.greenBg:C.bgSoft,color:activa?C.normal:C.done,whiteSpace:'nowrap'}}>{activa?'Activa':'Cerrada'}</span>
                </div>
              </div>
            )})}

          </div>
          {/* LIQUIDACIONES */}
          <div style={{borderTop:'0.5px solid #E4E8EB',marginTop:4,padding:'11px 14px'}}>
            <div style={{marginBottom:9}}><span style={secLbl}>Liquidaciones</span></div>
            {misRend.length===0&&<div style={{fontSize:12,color:C.textSoft,padding:'4px 0'}}>Aún no hay liquidaciones.</div>}
            {misRend.map(r=>{
              const isOpen=openRendicion===r.id
              const gastosR=expenses.filter(e=>e.render_id===r.id)
              return (
              <div key={r.id} style={{borderBottom:`0.5px solid ${C.bgSoft}`}}>
                <div onClick={()=>setOpenRendicion(isOpen?null:r.id)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',cursor:'pointer'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>{bigDate(r.created_at)}<div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text}}>{r.periodo}</div><div style={{fontSize:10,color:C.textSoft,marginTop:1}}>{r.n_gastos} gasto{r.n_gastos!==1?'s':''}</div></div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:12,fontWeight:500,color:C.muted}}>{fmtCLP(r.total)}</span>
                    <span style={{fontSize:11,color:C.textSoft,transform:isOpen?'rotate(180deg)':'none',display:'inline-block',transition:'transform .2s'}}><Gl n='chevD'/></span>
                  </div>
                </div>
                {isOpen&&(
                  <div style={{padding:'2px 0 10px'}}>
                    {gastosR.length===0&&<div style={{fontSize:12,color:C.textSoft,padding:'4px 0'}}>Sin detalle disponible</div>}
                    {gastosR.map(e=>{ const cl=clients.find(x=>x.id===e.client_id); return (
                      <div key={e.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.concept||'—'}</div>
                          <div style={{fontSize:10,color:C.textSoft,marginTop:1}}>{cl?cl.name+' · ':''}{e.date?fmtD(e.date):''}{e.category?' · '+catLabel(e.category):''}</div>
                        </div>
                        <div style={{fontSize:12,fontWeight:500,color:C.overdue,flexShrink:0}}>{fmtCLP(e.amount)}</div>
                      </div>
                    )})}
                    <div style={{display:'flex',gap:8,marginTop:10}}>
                      <button onClick={()=>{
                        const now=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
                        const A='#003C50',A2='#537281',A4='#E4E8EB'
                        const porCliente={}
                        gastosR.forEach(e=>{ const cn=clients.find(x=>x.id===e.client_id)?.name||'Sin cliente'; if(!porCliente[cn])porCliente[cn]=[]; porCliente[cn].push(e) })
                        let html=`<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Liquidación — ${r.user_name} — ${r.periodo}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',sans-serif;color:#3D3D3D;font-size:11px}@page{size:letter portrait;margin:16mm 18mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}.header{background:${A};color:#fff;padding:20px 24px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}.firma{font-size:16px;font-weight:700}.kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}.kpi{background:${A4};border-radius:6px;padding:10px 12px}.kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;font-weight:600}.kpi-value{font-size:15px;font-weight:700;color:${A}}table{width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px}thead tr{background:${A};color:#fff}thead th{padding:6px 10px;text-align:left;font-size:9px;font-weight:600;text-transform:uppercase}tbody tr:nth-child(even){background:${A4}}tbody td{padding:6px 10px;border-bottom:1px solid ${A4}}tfoot tr{background:${A4};font-weight:700}tfoot td{padding:7px 10px;border-top:2px solid ${A2}}.section-title{font-size:12px;font-weight:700;color:${A};border-bottom:2px solid ${A};padding-bottom:4px;margin:16px 0 10px}.footer{margin-top:24px;padding-top:10px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A2}}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}</style></head><body><div class='header'><div><img src='${location.origin}${BRAND.logo.blanco}' alt='${BRAND.nombre}' style='height:26px;display:block'/><div style='font-size:9px;opacity:.7;margin-top:4px'>${BRAND.web}</div></div><div style='text-align:right'><div style='font-size:13px;font-weight:600'>Liquidación de Caja Chica</div><div style='font-size:11px;opacity:.8;margin-top:2px'>${r.user_name} · ${r.periodo}</div></div></div><div class='kpi-row'><div class='kpi'><div class='kpi-label'>Gastos</div><div class='kpi-value'>${gastosR.length}</div></div><div class='kpi'><div class='kpi-label'>Clientes</div><div class='kpi-value'>${Object.keys(porCliente).length}</div></div><div class='kpi'><div class='kpi-label'>Total</div><div class='kpi-value'>${fmtN(r.total)}</div></div></div>`
                        Object.entries(porCliente).forEach(([cn,gs])=>{ const tot=gs.reduce((a,e)=>a+(e.amount||0),0); html+=`<div class='section-title'>${cn} — ${fmtN(tot)}</div><table><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th style='text-align:right'>Monto</th></tr></thead><tbody>`; gs.forEach(e=>{ html+=`<tr><td>${e.date||'—'}</td><td>${e.category||'Otro'}</td><td>${e.concept||'—'}</td><td style='text-align:right;font-weight:600;color:#E24B4A'>-${fmtN(e.amount)}</td></tr>` }); html+=`</tbody><tfoot><tr><td colspan='3'>TOTAL ${cn.toUpperCase()}</td><td style='text-align:right;color:#E24B4A'>-${fmtN(tot)}</td></tr></tfoot></table>` })
                        html+=`<div class='footer'><span>${BRAND.nombre}</span><span>${r.user_name} · ${r.periodo}</span><span>CONFIDENCIAL</span></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / PDF</button></body></html>`
                        const w=window.open('','_blank'); w.document.write(html); w.document.close()
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E4E8EB',background:C.bgSoft,color:C.accent,fontSize:11,fontWeight:500,cursor:'pointer'}}>PDF</button>
                      <button onClick={()=>{
                        const a2=encodeURIComponent('Liquidación caja chica — '+r.user_name+' — '+r.periodo)
                        const b2=encodeURIComponent('Estimados,\n\nEspero que estén muy bien. Adjunto la liquidación de caja chica.\n\nResponsable: '+r.user_name+'\nPeríodo: '+r.periodo+'\nGastos: '+gastosR.length+'\nTotal: $'+r.total.toLocaleString('es-CL'))
                        const mailLink=document.createElement('a'); mailLink.href='mailto:'+adminEmails.join(',')+'?subject='+a2+'&body='+b2; mailLink.click()
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E4E8EB',background:C.bgSoft,color:C.muted,fontSize:11,fontWeight:500,cursor:'pointer'}}>Correo</button>
                      <button onClick={async()=>{
                        if(!await appConfirm('¿Reabrir esta liquidación? Los gastos vuelven a pendientes para que puedas editarla y rehacerla, o dejarla anulada.')) return
                        try {
                          const {error:ue}=await supabase.from('expenses').update({rendered_at:null,render_id:null,rendered_by:null}).eq('render_id',r.id)
                          if(ue) throw ue   // si no se liberan los gastos, NO borrar la rendición (quedarían huérfanos)
                          await supabase.from('rendiciones').delete().eq('id',r.id)
                          if(setRendiciones) setRendiciones(p=>p.filter(x=>x.id!==r.id))
                          if(setExpenses) setExpenses(p=>p.map(e=>e.render_id===r.id?{...e,rendered_at:null,render_id:null,rendered_by:null}:e))
                          setOpenRendicion(null)
                        } catch(err) { appAlert('Error: '+err.message) }
                      }} style={{flex:1,height:34,borderRadius:8,border:'0.5px solid #E24B4A',background:'transparent',color:C.overdue,fontSize:11,fontWeight:500,cursor:'pointer'}}>Reabrir</button>
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
      })()}</div>}
      </div>

      {/* Modal de liquidación (PP-12 commit 2): detalle compacto + PDF / Correo / Confirmar */}
      {/* Modal Nueva Caja Chica (PP-12 commit 3) — diseño moderno, sin mensaje amarillo */}
      {showNuevaCaja&&(()=>{
        const hoyISO = new Date().toISOString().slice(0,10)
        const hoySel = !cajaOtra && newFecha===hoyISO
        const lbl = {fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase',marginBottom:7}
        const fpill = on => ({fontSize:12,padding:'6px 12px',borderRadius:20,cursor:'pointer',border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,fontWeight:on?600:400})
        return (
          <div onClick={()=>!saving&&setShowNuevaCaja(false)} style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px 16px'}}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:18,width:'100%',maxWidth:360,padding:'18px 20px 20px',maxHeight:'85vh',overflowY:'auto'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                <span style={{fontSize:16,fontWeight:600,color:C.accent}}>{editCajaId?'Editar caja chica':'Nueva caja chica'} <span style={{color:C.textSoft,fontWeight:400,margin:'0 6px'}}>|</span><span style={{color:C.muted,fontWeight:600}}>{me}</span></span>
                <button onClick={()=>!saving&&setShowNuevaCaja(false)} style={{background:'none',border:'none',cursor:'pointer',padding:0,lineHeight:0}}>
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.5' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
                </button>
              </div>

              <div style={{marginBottom:16}}>
                <div style={lbl}>Monto</div>
                <div style={{display:'flex',alignItems:'center',gap:6,background:C.bgSoft,border:'0.5px solid #E4E8EB',borderRadius:10,padding:'12px 14px'}}>
                  <span style={{fontSize:20,fontWeight:500,color:C.textSoft}}>$</span>
                  <input value={newMonto} onChange={e=>setNewMonto(e.target.value.replace(/\D/g,''))} inputMode='numeric' placeholder='0' style={{flex:1,border:'none',background:'none',fontSize:22,fontWeight:600,color:C.text,outline:'none',width:'100%'}}/>
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
                  {adminNombres.map(n=>{ const on=newDeliveredBy===n; return (
                    <button key={n} onClick={()=>setNewDeliveredBy(n)} style={{display:'inline-flex',alignItems:'center',gap:7,fontSize:12,fontWeight:on?600:400,padding:'6px 13px 6px 6px',borderRadius:20,border:on?'0.5px solid #003C50':'0.5px solid #E4E8EB',background:on?C.azulBg:'#fff',color:on?C.accent:C.muted,cursor:'pointer'}}>
                      <span style={{width:24,height:24,borderRadius:'50%',background:on?C.accent:C.done,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700}}>{INICIALES_RESP[n]||n.slice(0,2).toUpperCase()}</span>{n}
                    </button>
                  )})}
                </div>
              </div>

              <div style={{marginBottom:16}}>
                <div style={lbl}>Fecha</div>
                <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  <button onClick={()=>{setNewFecha(hoyISO);setCajaOtra(false)}} style={fpill(hoySel)}>Hoy</button>
                  <button onClick={()=>setCajaOtra(true)} style={fpill(cajaOtra)}>Otra fecha</button>
                  {cajaOtra&&<input type='date' value={newFecha} onChange={e=>setNewFecha(e.target.value)} style={{height:34,border:'0.5px solid #E4E8EB',borderRadius:8,fontSize:12,padding:'0 10px',color:C.text,outline:'none'}}/>}
                </div>
              </div>

              <div style={{marginBottom:18}}>
                <div style={lbl}>Nota <span style={{textTransform:'none',letterSpacing:0,color:C.textSoft}}>· opcional</span></div>
                <input value={newNota} onChange={e=>setNewNota(e.target.value)} placeholder='Ej: cubre saldo + caja del mes' style={{width:'100%',height:38,border:'0.5px solid #E4E8EB',borderRadius:8,fontSize:13,padding:'0 12px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}}/>
              </div>

              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>{setShowNuevaCaja(false);setEditCajaId(null)}} disabled={saving} style={{flex:1,height:44,borderRadius:10,border:'0.5px solid #E4E8EB',background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
                <button onClick={handleNuevaCaja} disabled={saving||!newMonto} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:newMonto?'pointer':'not-allowed',opacity:(saving||!newMonto)?.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>{saving?<Spin/>:null}{saving?'Guardando...':(editCajaId?'Guardar cambios':'Registrar caja')}</button>
              </div>
              {editCajaId&&<button onClick={handleBorrarCaja} disabled={saving} style={{width:'100%',marginTop:10,height:44,borderRadius:10,border:'none',background:'none',color:C.overdue,fontSize:12,fontWeight:600,cursor:'pointer'}}>Eliminar esta caja</button>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

