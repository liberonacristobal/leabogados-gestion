// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { coberturaVenta } from '../../supabase/functions/_shared/ventasReglas.js'
import * as SD from '../../supabase/functions/_shared/saludDatos.js'
import { C, Gl, SEC_LBL, SIcon, appAlert, appConfirm, fmt, fmtFechaDMY, fmtRutCL, folioN, isoLocal, personChip, useIsDesktop } from '../lib/base.jsx'
import { TAB_LABELS, conciliarVentasSaldadas, esSubarriendo, fechaHoraCL, fetchUFFechas, learnPut, logActividad, mesTitulo, pillPersonaSty, registrarError, setLearningKV, titleCase, ufDelDia, ufFechaCache, useTrabajosDetenidos, ventaUF } from '../lib/compartido.jsx'

export function RevisionDatosModal({onEnlazarComisiones, onConsumeAnticipos, billing=[], clients=[], clientEntities=[], sales=[], anticipos=[], conciliacion=[], terceros=[], expenses=[], tasks=[], onCerrarTrabajo, onOpenMov, onResolverDupAnticipo, onOpenClientFicha, onOpenFactura, onFixVencimiento, onResolverCuotaTramo, onResolverGlosa, onRetirarFantasmas, onDismissFantasma, onPasarTerminado, onActualizarHonorario, onGuardarClientRut, onCubrirCuotas, onQuitarRsGasto, onReabrirTrabajo}){
  const [ptBusy,setPtBusy]=useState(null)        // sale_id en proceso de "pasar a Terminado"
  const [ptDone,setPtDone]=useState(()=>new Set()) // ventas ya pasadas en esta sesión
  const [ahBusy,setAhBusy]=useState(null)        // sale_id en proceso de "actualizar honorario"
  const [ahDone,setAhDone]=useState(()=>new Set()) // honorarios ya alineados en esta sesión
  const cName=id=>(clients.find(c=>String(c.id)===String(id))?.name)||'—'
  const isDesk=useIsDesktop()   // hook ANTES de cualquier return temprano
  // Última corrida del auditor nocturno (edge auditor-datos), que revisa con estas mismas reglas cada noche.
  const [audAt,setAudAt]=useState(null)
  useEffect(()=>{ if(DEMO) return; supabase.from('auditoria_hallazgos').select('ultima_vez').order('ultima_vez',{ascending:false}).limit(1).then(({data})=>{ if(data?.[0]) setAudAt(data[0].ultima_vez) },()=>{}) },[])
  const audLinea=audAt&&<div style={{fontSize:11,color:C.textSoft,margin:'0 2px 8px'}}>Revisión automática cada noche · última: {fechaHoraCL(audAt)}</div>
  // Banco: plata contada dos veces o de más. Lee la cartola y la caja chica enlazada (no vienen en props).
  const [bkMovs,setBkMovs]=useState([]); const [bkPc,setBkPc]=useState([])
  useEffect(()=>{ if(DEMO) return; let v=true
    selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,tipo,nombre_contraparte,descripcion,estado,monto_conciliado,es_interno').order('id')).then(({data})=>{ if(v&&data) setBkMovs(data) },()=>{})
    supabase.from('petty_cash').select('movimiento_id,amount').not('movimiento_id','is',null).then(({data})=>{ if(v&&data) setBkPc(data) },()=>{})
    return ()=>{v=false} },[])
  const bancoChk=useMemo(()=>SD.bancoChk(bkMovs,conciliacion,bkPc,terceros),[bkMovs,bkPc,conciliacion,terceros])
  const [fixing,setFixing]=useState(null)   // id de la factura cuyo vencimiento se está corrigiendo
  const [ctBusy,setCtBusy]=useState(null)   // sale_id de la cuota↔tramo que se está resolviendo
  const [ctDone,setCtDone]=useState(()=>new Set())  // sale_id ya resueltos/ignorados en esta sesión
  const [coRows,setCoRows]=useState([])     // diccionario costo_oficina (key→value) para detectar glosas en conflicto
  const [glDone,setGlDone]=useState(()=>new Set())  // claves de glosa ya definidas en esta sesión
  const [glPick,setGlPick]=useState({})     // key → categoría elegida en la compuerta
  const [glBusy,setGlBusy]=useState(null)
  useEffect(()=>{ if(DEMO){ setCoRows(demoData.learnings_co||[]); return } supabase.from('learnings').select('key,value,hits,updated_at').eq('kind','costo_oficina').then(({data})=>{ if(data) setCoRows(data) },()=>{}) },[])
  const rutMulti=useMemo(()=>SD.rutMulti(clientEntities),[clientEntities])
  const folioDup=useMemo(()=>SD.folioDup(billing),[billing])
  // Facturas posiblemente duplicadas: cruce REAL por identidad del receptor (RUT > razón social > cliente) + concepto + monto, EXCLUYENDO las anuladas por nota de crédito (status Anulada / NC). Dos entidades distintas con el mismo monto (ej. Tarragona a 3 RS, o folios de RUT distinto) NO se marcan; solo la MISMA entidad con la misma cuota repetida. La NC deja la factura fuera automáticamente.
  const facDup=useMemo(()=>SD.facDup(billing),[billing])
  const montoNeDte=useMemo(()=>SD.montoNeDte(billing),[billing])
  const ventasDup=useMemo(()=>SD.ventasDup(sales),[sales])
  // Doble conteo cuota↔tramo: venta NO recurrente donde la suma de cuotas Programadas + facturas Emitidas SUPERA la venta → al emitir el tramo la programada no se redujo, se cuenta dos veces. Excluye recurrentes (mensuales), donde prog+emit>venta es normal (meses futuros+pasados).
  const [ctNo,setCtNo]=useState(()=>new Set())   // ventas marcadas «No es doble conteo» (learnings data_health): no vuelven a aparecer
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key,value').eq('kind','data_health').like('key','cuotatramo:%').then(({data})=>{ setCtNo(new Set((data||[]).filter(r=>r.value==='distintos').map(r=>String(r.key).replace(/^cuotatramo:/,'')))) },()=>{}) },[])
  const cuotaTramo=useMemo(()=>SD.cuotaTramo(billing,sales,ctNo),[billing,sales,ctNo])
  // Glosa en conflicto: clave del diccionario costo_oficina que guardó >1 categoría (Retiro vs Sueldo) → la sugerencia sale no determinista.
  const glosaConflict=useMemo(()=>SD.glosaConflict(coRows),[coRows])
  // Facturas huérfanas: emitidas (con folio, no anuladas/borradas, no reembolso/NC) SIN cliente asignado → hay que vincularlas para que cuenten en el por-cobrar del cliente.
  const huerfanas=useMemo(()=>SD.huerfanas(billing),[billing])
  // Vencimiento incoherente: factura emitida cuyo due quedó ANTERIOR a su emisión (típico de emitir tarde por match de DTE sin recalcular el plazo) → se ve "vencida" recién emitida. Auto-corregible (due = emisión + plazo).
  const vencIncoh=useMemo(()=>SD.vencIncoh(billing),[billing])
  // Anticipos posibles duplicados: uno cargado a MANO (sin respaldo bancario, no marcado 'revisado') cuyo monto
  // CALZA con los depósitos del banco del mismo cliente (la suma, o uno exacto). Caso Gabriela/Eugenia.
  const antDup=useMemo(()=>SD.antDup(anticipos,conciliacion),[anticipos,conciliacion])
  // Cuotas fantasma: Programadas ya SALDADAS (emitidas) que siguen figurando por facturar — motor de conciliación (read-only, Fase 1).
  const [ufMapFechas,setUfMapFechas]=useState({})   // UF por fecha (mindicador) para el calce por monto de la señal 8
  useEffect(()=>{ if(DEMO) return; const ds=[]; (billing||[]).forEach(b=>{ if(b.issued_at)ds.push(b.issued_at); if(b.due)ds.push(b.due) }); (anticipos||[]).forEach(a=>{ if(a.fecha)ds.push(a.fecha) }); if(!ds.length) return; let alive=true; fetchUFFechas(ds).then(m=>{ if(alive) setUfMapFechas(m||{}) }).catch(()=>{}); return ()=>{alive=false} },[billing,anticipos])
  const [fantasmaNo,setFantasmaNo]=useState(()=>new Set())   // programadas marcadas "es pendiente, no fantasma" (aprendido)
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key').eq('kind','fantasma_no').then(({data})=>{ if(data) setFantasmaNo(new Set(data.map(r=>String(r.key)))) },()=>{}) },[])
  const [cfRetiradas,setCfRetiradas]=useState(()=>new Set())   // retiradas en esta sesión (para ocultarlas al toque)
  const [cfBusy,setCfBusy]=useState(false)
  const cuotasFantasma=useMemo(()=>conciliarVentasSaldadas(billing,sales,anticipos,conciliacion,ufMapFechas,fantasmaNo).filter(x=>!cfRetiradas.has(String(x.prog.id))),[billing,sales,anticipos,conciliacion,ufMapFechas,fantasmaNo,cfRetiradas])
  const cfAlta=cuotasFantasma.filter(x=>x.conf==='alta')
  const cfTotal=cuotasFantasma.reduce((a,x)=>a+(x.monto||0),0)
  // Salud de facturación (read-only, te lleva al dato): vistas v_ventas_salud / v_sii_ventas_sin_enlazar en prod; en demo se computa IGUAL desde los datos cargados (misma lógica que la vista, verificada 6/7/6). Cuotas sin generar y SII sin enlazar solo se ven desde las VENTAS, invisibles al radar de billing.
  const [saludRows,setSaludRows]=useState([])
  const [siiRows,setSiiRows]=useState([])
  // Cruce "el banco revela el RUT": movimientos con RUT+nombre, negativos aprendidos ("No es"), y hechos (recién guardados).
  const [movsRut,setMovsRut]=useState([])
  const [rutNo,setRutNo]=useState(()=>new Set())
  const [rutDone,setRutDone]=useState(()=>new Set())
  const [brBusy,setBrBusy]=useState(null)
  useEffect(()=>{
    if(DEMO){
      const bySale={}; (billing||[]).forEach(b=>{ if(b.sale_id)(bySale[String(b.sale_id)]=bySale[String(b.sale_id)]||[]).push(b) })
      const rows=(sales||[]).filter(s=>!s.deleted_at).map(s=>{
        const vivas=(bySale[String(s.id)]||[]).filter(b=>!b.deleted_at&&b.status!=='Anulada'&&!['reembolso','nota_credito'].includes(b.billing_type||''))
        const n_cuotas=vivas.length, suma_cuotas=vivas.reduce((a,b)=>a+(Number(b.amount)||0),0)
        const nplan=parseInt((s.cobro_config&&s.cobro_config.nCuotas)||0,10)||null
        const faltan_cuotas=s.status==='Activo'&&s.cobro_type==='cuotas'&&nplan>1&&n_cuotas>0&&n_cuotas<nplan
        const honorario_descuadrado=s.amount_clp!=null&&(s.amount_uf==null||s.amount_uf==='')&&!['mensual','hora'].includes(s.cobro_type)&&n_cuotas>0&&Math.abs(Number(s.amount_clp)-suma_cuotas)>1000
        return { id:s.id, client_id:s.client_id, title:s.title, status:s.status, cobro_type:s.cobro_type, amount_clp:s.amount_clp, amount_uf:s.amount_uf, nplan, n_cuotas, suma_cuotas, faltan_cuotas, honorario_descuadrado }
      }).filter(v=>v.faltan_cuotas||v.honorario_descuadrado)
      setSaludRows(rows); setSiiRows([]); setMovsRut([]); return
    }
    supabase.from('v_ventas_salud').select('*').then(({data})=>{ if(data) setSaludRows(data.filter(v=>v.faltan_cuotas||v.honorario_descuadrado)) },()=>{})
    supabase.from('v_sii_ventas_sin_enlazar').select('*').then(({data})=>{ if(data) setSiiRows(data) },()=>{})
    selectAll(()=>supabase.from('cartola_movimientos').select('rut_contraparte,nombre_contraparte,monto').not('rut_contraparte','is',null).order('id')).then(({data})=>{ if(data) setMovsRut(data.filter(m=>m.nombre_contraparte)) },()=>{})
    supabase.from('learnings').select('key').eq('kind','rut_banco_no').then(({data})=>{ if(data) setRutNo(new Set(data.map(r=>r.key))) },()=>{})
  },[])
  // Faltan cuotas solo si lo generado (facturado + anticipado + programado) NO alcanza el honorario: una venta a «3 cuotas»
  // facturada en 1 o 2 documentos que suman el total no tiene nada pendiente (nCuotas=3 es el valor por defecto del formulario).
  const cuotasSinGen=useMemo(()=>{
    const uf={...(ufFechaCache()||{}),...(ufMapFechas||{})}, porVenta={}
    ;(billing||[]).forEach(b=>{ if(b&&b.sale_id) (porVenta[String(b.sale_id)]=porVenta[String(b.sale_id)]||[]).push(b) })
    return saludRows.filter(v=>{ if(!v.faltan_cuotas) return false
      const s=(sales||[]).find(x=>String(x.id)===String(v.id)); const cv=s&&coberturaVenta(s,porVenta[String(v.id)]||[],uf)
      if(!cv||!cv.ok) return true
      return cv.usado+cv.prog.reduce((a,x)=>a+x.uu,0) < cv.plan*0.97 })
  },[saludRows,sales,billing,ufMapFechas])
  const honorarioDesc=useMemo(()=>SD.honorarioDescuadrado(saludRows,billing,sales),[saludRows,billing,sales])
  // Pago ya recibido (anticipo disponible, de UNA venta) que calza con sus cuotas programadas vencidas o del próximo mes
  // (suma de las más antiguas ±2% o $1.000 = variación UF): esas cuotas ya están pagadas → «Cubrir» las deja Anticipadas. Caso Varas/Donoso/Cordomi.
  const [cubiertasRD,setCubiertasRD]=useState(()=>new Set())
  // Subarriendo: pago de un mes ↔ su factura emitida (regla única SD.anticiposSubarriendo, la misma del auditor nocturno).
  const [antSubDone,setAntSubDone]=useState(()=>new Set())
  // Facturas recibidas en plazo de reclamo (regla única SD.comprasEnPlazoReclamo, la misma del auditor nocturno).
  const [cpPend,setCpPend]=useState([]), [cpVistas,setCpVistas]=useState(()=>new Set()), [cpHist,setCpHist]=useState([])
  useEffect(()=>{ if(DEMO) return; let v=true
    Promise.all([supabase.from('sii_compras_docs').select('id,folio,tipo_dte,emisor_name,emisor_rut,proveedor_id,fecha_emision,monto,sii_estado,fecha_recepcion').eq('sii_estado','PENDIENTE'),supabase.from('learnings').select('key').eq('kind','compra_sin_reclamo'),
      selectAll(()=>supabase.from('sii_compras_docs').select('id,emisor_rut,fecha_emision,monto').order('id'))])
      .then(([c,l,h])=>{ if(!v) return; setCpPend(c.data||[]); setCpVistas(new Set((l.data||[]).map(r=>String(r.key)))); setCpHist(h.data||[]) },()=>{})
    return ()=>{v=false} },[])
  // Errores de la app en los últimos 30 días (registrarError), agrupados por vista y mensaje. «Resuelto» los marca a todos.
  const [appErr,setAppErr]=useState([])
  useEffect(()=>{ if(DEMO) return; let v=true
    const desde=new Date(Date.now()-30*864e5).toISOString()
    supabase.from('app_errores').select('id,created_at,usuario,vista,origen,mensaje,version').is('resuelto_at',null).gte('created_at',desde).order('created_at',{ascending:false}).limit(500)
      .then(({data})=>{ if(v) setAppErr(data||[]) },()=>{})
    return ()=>{v=false} },[])
  const errGrupos=useMemo(()=>{ const by={}
    appErr.forEach(e=>{ const k=`${e.vista||''}|${e.mensaje}`; const g=(by[k]=by[k]||{k,vista:e.vista,origen:e.origen,mensaje:e.mensaje,ids:[],usuarios:new Set(),ult:e.created_at,version:e.version})
      g.ids.push(e.id); if(e.usuario) g.usuarios.add(e.usuario.split('@')[0]) })
    return Object.values(by) },[appErr])
  const errResuelto=async g=>{ setAppErr(p=>p.filter(e=>!g.ids.includes(e.id))); if(DEMO) return
    try{ const {data:{session}}=await supabase.auth.getSession(); await supabase.from('app_errores').update({resuelto_at:new Date().toISOString(),resuelto_por:session?.user?.email||null}).in('id',g.ids) }catch(_){} }
  // Compras de proveedores observados por el SII (W39), regla única SD.comprasObservadasSII (la misma del auditor nocturno).
  const [cpObs,setCpObs]=useState([]), [cpObsVistas,setCpObsVistas]=useState(()=>new Set())
  useEffect(()=>{ if(DEMO) return; let v=true
    Promise.all([supabase.from('sii_compras_docs').select('id,folio,tipo_dte,emisor_name,emisor_rut,periodo,monto,observado_iva,observado_sii').eq('observado_sii',true),supabase.from('learnings').select('key').eq('kind','compra_observada_vista')])
      .then(([c,l])=>{ if(!v) return; setCpObs(c.data||[]); setCpObsVistas(new Set((l.data||[]).map(r=>String(r.key)))) },()=>{})
    return ()=>{v=false} },[])
  const observadas=useMemo(()=>SD.comprasObservadasSII(cpObs,cpObsVistas),[cpObs,cpObsVistas])
  // Trabajos detenidos (regla única ventasReglas.trabajosDetenidos vía useTrabajosDetenidos, la misma del auditor nocturno y de Cobranza).
  const [detHechos,setDetHechos]=useState(()=>new Set())
  const hoyCL=new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})
  const detTodos=useTrabajosDetenidos({sales,billing,expenses,tasks})
  const detenidos=useMemo(()=>detTodos.filter(x=>!detHechos.has(String(x.s.id))),[detTodos,detHechos])
  const detTerm=detenidos.filter(x=>x.tipo==='terminado'), detSaldo=detenidos.filter(x=>x.tipo==='con_saldo')
  const sigueActivo=async x=>{ setDetHechos(p=>new Set([...p,String(x.s.id)])); if(DEMO) return; try{ await setLearningKV('trabajo_activo_ok',String(x.s.id),hoyCL); logActividad('ventas.sigue_activo',{tabla:'sales',id:x.s.id,detalle:{title:`«${x.s.title||'Trabajo'}» de ${cName(x.s.client_id)} sigue activo (sin movimiento desde ${fmtFechaDMY(x.ult)})`}}) }catch(e){registrarError({origen:'accion',vista:'trabajo_activo_ok',err:e})} }
  const cerrarTrabajo=async x=>{ if(!onCerrarTrabajo) return; setDetHechos(p=>new Set([...p,String(x.s.id)])); try{ await onCerrarTrabajo(x.s) }catch(e){ setDetHechos(p=>{ const n=new Set(p); n.delete(String(x.s.id)); return n }); appAlert('No se pudo cerrar: '+(e.message||e)) } }
  // Agrupados por abogado (responsable de la venta, si no el del cliente): cada uno cierra los suyos de una vez.
  const abgDe=x=>x.s.responsible||clients.find(c=>String(c.id)===String(x.s.client_id))?.abogado_responsable||'Sin abogado'
  const detTermPorAbg=Object.entries(detTerm.reduce((m,x)=>{ (m[abgDe(x)]=m[abgDe(x)]||[]).push(x); return m },{})).sort((a,b)=>b[1].length-a[1].length)
  const cerrarVarios=async(abg,xs)=>{ if(!(await appConfirm({title:`Cerrar ${xs.length} trabajos de ${abg}`,message:'Quedan como Terminados. El estado se puede volver a cambiar desde cada venta.',confirmText:`Cerrar los ${xs.length}`}))) return; for(const x of xs) await cerrarTrabajo(x) }
  // Gasto con razón social de otro cliente · trabajo Terminado que sigue recibiendo gastos (reglas únicas de saludDatos, las mismas del auditor).
  const [rsAjHechos,setRsAjHechos]=useState(()=>new Set()), [tcgHechos,setTcgHechos]=useState(()=>new Set()), [tcgOk,setTcgOk]=useState({})
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('key,value').eq('kind','terminada_gastos_ok').then(({data})=>setTcgOk(Object.fromEntries((data||[]).map(r=>[String(r.key),String(r.value||'')]))),()=>{}) },[])
  const rsAjena=useMemo(()=>SD.gastoRsAjena(expenses,clientEntities).filter(e=>!rsAjHechos.has(String(e.id))),[expenses,clientEntities,rsAjHechos])
  const termGastos=useMemo(()=>SD.terminadaConGastos(sales,expenses,hoyCL,{ok:tcgOk}).filter(x=>!tcgHechos.has(String(x.s.id))),[sales,expenses,hoyCL,tcgOk,tcgHechos])
  const sinHecho=(set,k)=>set(p=>{ const n=new Set(p); n.delete(k); return n })
  const quitarRs=async e=>{ if(!onQuitarRsGasto) return; setRsAjHechos(p=>new Set([...p,String(e.id)])); try{ await onQuitarRsGasto(e) }catch(err){ sinHecho(setRsAjHechos,String(e.id)); appAlert('No se pudo: '+(err.message||err)) } }
  const reabrirTrabajo=async x=>{ if(!onReabrirTrabajo) return; setTcgHechos(p=>new Set([...p,String(x.s.id)])); try{ await onReabrirTrabajo(x.s) }catch(err){ sinHecho(setTcgHechos,String(x.s.id)); appAlert('No se pudo: '+(err.message||err)) } }
  const sigueTerminado=async x=>{ setTcgHechos(p=>new Set([...p,String(x.s.id)])); if(DEMO) return; try{ await setLearningKV('terminada_gastos_ok',String(x.s.id),hoyCL); logActividad('ventas.sigue_terminado',{tabla:'sales',id:x.s.id,detalle:{title:`«${x.s.title||'Trabajo'}» de ${cName(x.s.client_id)} sigue terminado`}}) }catch(e){registrarError({origen:'accion',vista:'terminada_gastos_ok',err:e})} }
  const decidirObservada=async(x,decision)=>{ setCpObsVistas(p=>new Set([...p,String(x.id)])); if(DEMO) return; try{ await setLearningKV('compra_observada_vista',String(x.id),JSON.stringify({decision,fecha:new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})})); logActividad('compras.observada_decidida',{tabla:'sii_compras_docs',id:x.id,detalle:{title:`Factura N° ${x.folio} de ${x.emisor_name||'proveedor'} (observada por el SII): ${decision==='rectificar'?'se rectifica el F29':'se acredita el crédito'}`}}) }catch(e){registrarError({origen:'accion',vista:'compra_observada_vista',err:e})} }
  const enReclamo=useMemo(()=>SD.comprasEnPlazoReclamo(cpPend,new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}),cpVistas,{terceros,historial:cpHist}),[cpPend,cpVistas,terceros,cpHist])
  const sinReclamo=async x=>{ setCpVistas(p=>new Set([...p,String(x.d.id)])); if(DEMO) return; try{ await setLearningKV('compra_sin_reclamo',String(x.d.id),JSON.stringify({fecha:new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})})); logActividad('compras.sin_reclamo',{tabla:'sii_compras_docs',id:x.d.id,detalle:{title:`Factura N° ${x.d.folio} de ${x.d.emisor_name||'proveedor'} · revisada sin reclamo`}}) }catch(e){registrarError({origen:'accion',vista:'compra_sin_reclamo',err:e})} }
  const antSub=useMemo(()=>SD.anticiposSubarriendo(anticipos,billing,sales,conciliacion).filter(x=>!antSubDone.has(String(x.a.id))),[anticipos,billing,sales,conciliacion,antSubDone])
  const anticipoCubre=useMemo(()=>{
    const lim=new Date(); lim.setDate(lim.getDate()+31); const limISO=lim.toISOString().slice(0,10)
    const progBySale={}; (billing||[]).forEach(b=>{ if(!b.deleted_at&&b.sale_id&&b.status==='Programada'&&!b.prepaid_anticipo_id&&String(b.due||'')<=limISO) (progBySale[String(b.sale_id)]=progBySale[String(b.sale_id)]||[]).push(b) })
    // Lo más antiguo primero (FIFO): uno o varios pagos seguidos de la misma venta (hasta 6) contra las cuotas más antiguas.
    // Así calzan las cuotas pagadas en dos transferencias (p. ej. 250.000 + 614.000 = 22 UF) y, tras un calce, sigue con los pagos y cuotas restantes.
    const out=[], antBySale={}
    ;(anticipos||[]).forEach(a=>{ if(a.estado!=='disponible'||!a.sale_id||cubiertasRD.has(String(a.id))||!((Number(a.monto)||0)>0)) return; (antBySale[String(a.sale_id)]=antBySale[String(a.sale_id)]||[]).push(a) })
    // Venta en UF: se compara en UF (cada pago con la UF de su día; cada cuota con la UF del día en que se generó), así la variación de la UF no esconde el calce.
    const ufM={...(ufFechaCache()||{}),...(ufMapFechas||{})}, ventaUF=new Set((sales||[]).filter(x=>x&&x.moneda==='UF').map(x=>String(x.id)))
    const subarr=new Set((sales||[]).filter(x=>x&&esSubarriendo(x)).map(x=>String(x.id)))   // subarriendo: cada pago es de SU mes (lo ve el flujo), no se calza por monto
    const enUF=(monto,iso)=>{ const u=ufDelDia(ufM,iso,null); return u>0?(Number(monto)||0)/u:null }
    Object.entries(antBySale).forEach(([sid,as0])=>{ if(subarr.has(sid)) return
      const as=[...as0].sort((x,y)=>String(x.fecha||'').localeCompare(String(y.fecha||'')))
      const cs=(progBySale[sid]||[]).sort((x,y)=>String(x.due||'').localeCompare(String(y.due||'')))
      const uf=ventaUF.has(sid)&&as.every(x=>enUF(x.monto,x.fecha)!=null)&&cs.every(c=>enUF(c.amount,c.issued_at||c.due)!=null)
      const vA=x=>uf?enUF(x.monto,x.fecha):(Number(x.monto)||0), vC=c=>uf?enUF(c.amount,c.issued_at||c.due):(Number(c.amount)||0)
      const tol=v=>uf?Math.max(0.1,v*0.03):Math.max(1000,v*0.02)
      let ia=0, ic=0
      while(ia<as.length&&ic<cs.length){
        let hit=null, sumA=0
        for(let i=ia;i<Math.min(as.length,ia+6)&&!hit;i++){ sumA+=vA(as[i]); let sumC=0, pesos=0
          for(let j=ic;j<cs.length;j++){ sumC+=vC(cs[j]); pesos+=Number(cs[j].amount)||0; if(Math.abs(sumA-sumC)<=tol(sumC)){ hit={i,j,sumC:pesos}; break } if(sumC>sumA+tol(sumA)) break } }
        if(!hit) break
        const grupo=as.slice(ia,hit.i+1)
        out.push({a:grupo[0],extra:grupo.slice(1),cuotas:cs.slice(ic,hit.j+1),sum:hit.sumC,pagado:grupo.reduce((t,x)=>t+(Number(x.monto)||0),0)})
        ia=hit.i+1; ic=hit.j+1
      }
    })
    return out
  },[anticipos,billing,sales,ufMapFechas,cubiertasRD])
  // Ventas COBRADAS en Borrador/Propuesta: tienen facturas emitidas/pagadas pero su estado las deja FUERA de "Vendido" (que cuenta solo Activo+Terminado). Trabajo real invisible → candidato a pasar a Terminado. Client-side desde sales+billing.
  const ventasBorradorCobrado=useMemo(()=>SD.ventasBorradorCobrado(sales,billing),[sales,billing])
  // Cruce banco→RUT: cliente con actividad y SIN RUT (ni ficha ni RS) cuyo nombre calza, por token completo (sin conectores), con un único RUT en el banco.
  const bancoRut=useMemo(()=>{
    if(!movsRut.length) return []
    const CONN=new Set(['de','del','la','las','los','y','e','da','do','san','santa','von','van','di'])
    const toks=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean)
    const cliToks=s=>toks(s).filter(t=>t.length>2&&!CONN.has(t))
    const bankSet=s=>new Set(toks(s).filter(t=>t.length>2))
    const entRut=new Set((clientEntities||[]).filter(e=>e.rut&&String(e.rut).trim()).map(e=>String(e.client_id)))
    const act=new Set(); (billing||[]).forEach(b=>{ if(!b.deleted_at&&b.status!=='Anulada'&&b.client_id) act.add(String(b.client_id)) }); (sales||[]).forEach(s=>{ if(!s.deleted_at&&s.client_id) act.add(String(s.client_id)) })
    const pre=movsRut.map(m=>({set:bankSet(m.nombre_contraparte), m}))
    const out=[]
    ;(clients||[]).forEach(c=>{
      if(c.is_occasional||c.is_internal) return
      if(c.rut&&String(c.rut).trim()) return
      if(entRut.has(String(c.id))) return
      if(!act.has(String(c.id))) return
      if(rutDone.has(String(c.id))) return
      const ct=cliToks(c.name); if(ct.length<2) return
      const byRut={}
      pre.forEach(({set,m})=>{ if(!ct.every(t=>set.has(t))) return; const rk=String(m.rut_contraparte||'').replace(/[.\s-]/g,'').toLowerCase(); if(!rk) return; const g=byRut[rk]||(byRut[rk]={rut:m.rut_contraparte,name:m.nombre_contraparte,n:0,total:0}); g.n++; g.total+=Math.abs(Number(m.monto)||0) })
      const rks=Object.keys(byRut); if(rks.length!==1) return   // match ambiguo (varios RUT) → fuera
      const rk=rks[0]; if(rutNo.has(String(c.id)+':'+rk)) return
      const g=byRut[rk]
      const nf=(billing||[]).filter(b=>!b.deleted_at&&b.status!=='Anulada'&&String(b.client_id)===String(c.id)).length
      out.push({client:c, rut:g.rut, rutKey:rk, bankName:g.name, nMovs:g.n, total:g.total, nFact:nf})
    })
    return out.sort((a,b)=>b.nFact-a.nFact)
  },[clients,clientEntities,billing,sales,movsRut,rutNo,rutDone])
  const total=rsAjena.length+termGastos.length+errGrupos.length+observadas.length+detTerm.length+detSaldo.length+enReclamo.length+antSub.length+rutMulti.length+folioDup.length+facDup.length+montoNeDte.length+ventasDup.length+huerfanas.length+antDup.length+vencIncoh.length+cuotaTramo.length+glosaConflict.filter(x=>!glDone.has(x.key)).length+cuotasFantasma.length+cuotasSinGen.length+anticipoCubre.length+honorarioDesc.length+siiRows.length+ventasBorradorCobrado.length+bancoRut.length
  if(total===0) return <div style={{padding:'26px 0',textAlign:'center'}}>{audLinea}<div style={{display:'flex',justifyContent:'center',marginBottom:4}}><SIcon n='check' s={30} c={C.greenText}/></div><div style={{fontSize:13,fontWeight:600,color:C.greenText}}>Todo cuadra</div><div style={{fontSize:11,color:C.muted,marginTop:3}}>Sin duplicados de ficha ni de folio, y todos los montos cuadran con el DTE.</div></div>
  const sh=(t,color,n)=><div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,color,marginBottom:3,display:'flex',alignItems:'center',gap:6}}>{t}<span style={{background:color,color:'#fff',borderRadius:20,fontSize:9.5,padding:'2px 8px',fontWeight:700,whiteSpace:'nowrap'}}>{n}</span></div>
  const lk=onClick=><span onClick={onClick} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>Abrir →</span>
  // Cifras SIEMPRE a la derecha: monto principal + (opcional) secundario debajo, alineados.
  const amt=(main,sub,col)=><div style={{textAlign:'right',flexShrink:0,marginLeft:10}}><div style={{fontSize:13,fontWeight:700,color:col||C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{main}</div>{sub&&<div style={{fontSize:10,color:C.muted,whiteSpace:'nowrap',fontVariantNumeric:'tabular-nums',marginTop:1}}>{sub}</div>}</div>
  const fila={display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}
  const secBox={breakInside:'avoid',display:'inline-block',width:'100%',boxSizing:'border-box',background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px 8px',marginBottom:12}
  return <div>
    {audLinea}
    <div style={{background:C.soonBg,borderRadius:12,padding:'12px 14px',marginBottom:12}}><div style={{fontSize:10,fontWeight:700,color:C.soonText,textTransform:'uppercase',letterSpacing:.5}}>Por revisar</div><div style={{fontSize:24,fontWeight:800,color:C.soonText,letterSpacing:-.4,fontVariantNumeric:'tabular-nums'}}>{total}</div><div style={{fontSize:11.5,color:C.soonText}}>Toca cada una para abrir su ficha o factura · cada resolución queda registrada.</div></div>
    <div style={isDesk?{columnCount:2,columnGap:12}:undefined}>
    {folioDup.length>0&&<div style={secBox}>{sh('Folio duplicado','#C0392B',folioDup.length)}
      {folioDup.map(({folio,rows})=><div key={folio} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Factura N° {folio} · {rows.length} filas</div>
        {rows.map(b=><div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{...fila,fontSize:11,color:C.muted,marginTop:3,paddingLeft:10,cursor:'pointer'}}><span style={{minWidth:0}}>{cName(b.client_id)} · {b.concept||'—'} {lk(()=>onOpenFactura&&onOpenFactura(b))}</span>{amt(fmt(b.amount||0))}</div>)}
      </div>)}
    </div>}
    {facDup.length>0&&<div style={secBox}>{sh('Facturas posiblemente duplicadas','#C0392B',facDup.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>misma entidad (RUT/RS) · mismo concepto · mismo monto · sin nota de crédito</div>
      {facDup.map((g,i)=><div key={i} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{g.rs||cName(g.cid)}{g.rut?<span style={{color:C.muted,fontWeight:400}}> · {fmtRutCL(g.rut)}</span>:''}</div>
        <div style={{fontSize:10,color:C.muted,marginTop:1}}>{g.concept||'—'}</div></div>{amt(fmt(g.amount||0))}</div>
        {g.rows.map(b=><div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{fontSize:11,color:C.muted,marginTop:3,paddingLeft:10,cursor:'pointer',display:'flex',alignItems:'center',gap:6}}><span style={{fontWeight:600,color:C.accent}}>{b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'Programada'}</span><span>· {b.status} · {b.due?fmtFechaDMY(b.due):'—'}</span>{lk(()=>onOpenFactura&&onOpenFactura(b))}</div>)}
      </div>)}
    </div>}
    {rutMulti.length>0&&<div style={secBox}>{sh('RUT repetido en fichas',C.coralText,rutMulti.length)}
      {rutMulti.map(({rut,rs,clientIds})=><div key={rut} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={{fontSize:12,fontWeight:600,color:C.text}}>RUT {rut}{rs?` · ${rs}`:''}</div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>En {clientIds.length} fichas: {clientIds.map((id,i)=><span key={id}>{i>0?' · ':''}<span onClick={()=>onOpenClientFicha&&onOpenClientFicha(id)} style={{color:C.azulInfo,fontWeight:600,cursor:'pointer'}}>{cName(id)}</span></span>)}</div>
      </div>)}
    </div>}
    {montoNeDte.length>0&&<div style={secBox}>{sh('Monto distinto al DTE',C.soonText,montoNeDte.length)}
      {montoNeDte.map(({b,dte})=><div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{...fila,fontSize:11,color:C.muted,marginTop:3,borderTop:`1px solid ${C.bgSoft}`,paddingTop:9,cursor:'pointer'}}><span style={{minWidth:0}}>{cName(b.client_id)} · Factura N° {folioN(b.invoice_no)} {lk(()=>onOpenFactura&&onOpenFactura(b))}</span>{amt(`DTE ${fmt(dte)}`,`sistema ${fmt(b.amount)}`)}</div>)}
    </div>}
    {ventasDup.length>0&&<div style={secBox}>{sh('Ventas que podrían estar duplicadas',C.muted,ventasDup.length)}
      {ventasDup.map((arr,i)=><div key={i} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div onClick={()=>onOpenClientFicha&&onOpenClientFicha(arr[0].client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer'}}>{cName(arr[0].client_id)}</div>
        {arr.map(s=><div key={s.id} style={{...fila,fontSize:11,color:C.muted,marginTop:2,paddingLeft:10}}><span style={{minWidth:0}}>{s.title||'—'} · {s.year}</span>{amt(s.amount_uf?`${s.amount_uf} UF`:fmt(s.amount_clp||0))}</div>)}
      </div>)}
    </div>}
    {cuotaTramo.filter(x=>!ctDone.has(x.s.id)).length>0&&<div style={secBox}>{sh('Cuota programada + tramo ya emitido',C.overdueText,cuotaTramo.filter(x=>!ctDone.has(x.s.id)).length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>la programada no se redujo al emitir el tramo → se cuenta dos veces (excluye ventas recurrentes)</div>
      {cuotaTramo.filter(x=>!ctDone.has(x.s.id)).map(({s,venta,prog,emit,exceso})=><div key={s.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(s.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',minWidth:0}}>{cName(s.client_id)} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {s.title||'—'}</span><div style={{fontSize:11,color:C.muted,fontWeight:400,marginTop:2}}>se cuenta de más</div></div>{amt(fmt(exceso),null,C.overdueText)}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,marginTop:6}}>{[['Venta',venta],['Programado',prog],['Emitido',emit]].map(([l,v])=><div key={l} style={{background:C.bgSoft,borderRadius:8,padding:'5px 8px',textAlign:'right'}}><div style={{...SEC_LBL}}>{l}</div><div style={{fontSize:12,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(v)}</div></div>)}</div>
        {onResolverCuotaTramo&&<div style={{display:'flex',gap:8,marginTop:8}}>
          <button disabled={ctBusy===s.id} onClick={async()=>{ if(!(await appConfirm(`Voy a reducir la cuota programada de ${cName(s.client_id)} en ${fmt(exceso)}, para que el tramo ya emitido no se cuente dos veces. Es reversible. ¿Confirmas?`))) return; setCtBusy(s.id); try{ await onResolverCuotaTramo(s,'reducir',exceso); setCtDone(d=>new Set([...d,s.id])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) }; setCtBusy(null) }} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:ctBusy===s.id?'default':'pointer',opacity:ctBusy===s.id?.6:1}}>{ctBusy===s.id?'Aplicando…':'Reducir la programada'}</button>
          <button disabled={ctBusy===s.id} onClick={async()=>{ setCtDone(d=>new Set([...d,s.id])); try{ await onResolverCuotaTramo(s,'ignorar') }catch(_){}}} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>No es doble conteo</button>
        </div>}
      </div>)}
    </div>}
    {cuotasFantasma.length>0&&<div style={secBox}>{sh('Cuotas ya emitidas que figuran por facturar',C.overdueText,cuotasFantasma.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:6}}>cruce exacto · mismo período o mes de vencimiento + monto, o cobertura por anticipo · {fmt(cfTotal)} en total</div>
      {onRetirarFantasmas&&cfAlta.length>0&&<button disabled={cfBusy} onClick={async()=>{ if(!(await appConfirm(`Voy a retirar ${cfAlta.length} cuota(s) programada(s) que ya están emitidas (alta confianza), por ${fmt(cfAlta.reduce((a,x)=>a+(x.monto||0),0))}. Cada una queda enlazada a su factura y es REVERSIBLE (undo). ¿Confirmas?`))) return; setCfBusy(true); try{ await onRetirarFantasmas(cfAlta.map(x=>({progId:x.prog.id, realId:x.posterior?.id||null, monto:x.monto}))); setCfRetiradas(s=>new Set([...s,...cfAlta.map(x=>String(x.prog.id))])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) } setCfBusy(false) }} style={{width:'100%',padding:'9px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:cfBusy?'default':'pointer',opacity:cfBusy?.6:1,marginBottom:4}}>{cfBusy?'Retirando…':`Retirar las ${cfAlta.length} de alta confianza · ${fmt(cfAlta.reduce((a,x)=>a+(x.monto||0),0))}`}</button>}
      {cuotasFantasma.slice(0,40).map(({prog,sale,monto,razones,conf,posterior})=><div key={prog.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
          <div onClick={()=>onOpenClientFicha&&onOpenClientFicha(prog.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(prog.client_id)} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {prog.concept||sale?.title||'—'}</span></div>
          <span style={{fontSize:13,fontWeight:600,color:C.text,flexShrink:0}}>{fmt(monto)}</span>
        </div>
        <div style={{fontSize:10.5,color:C.muted,marginTop:2}}><span style={{fontWeight:700,color:conf==='alta'?C.greenText:C.soonText}}>{conf==='alta'?<><Gl n='tick'/>{" "}alta confianza</>:'Revisar'}</span> · {razones.join(' · ')}</div>
        <div style={{display:'flex',gap:12,marginTop:5}}>
          {onOpenFactura&&<span onClick={()=>onOpenFactura(prog)} style={{fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer'}}>Ver ficha <Gl n='chevron'/></span>}
          {onRetirarFantasmas&&<span onClick={async()=>{ if(!(await appConfirm(`Retirar esta cuota (ya emitida) por ${fmt(monto)}. Reversible. ¿Confirmas?`))) return; try{ await onRetirarFantasmas([{progId:prog.id, realId:posterior?.id||null, monto}]); setCfRetiradas(s=>new Set([...s,String(prog.id)])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) } }} style={{fontSize:11,fontWeight:600,color:C.greenText,cursor:'pointer'}}>Retirar</span>}
          {onDismissFantasma&&<span onClick={async()=>{ try{ await onDismissFantasma(prog.id) }catch(_){}; setFantasmaNo(s=>new Set([...s,String(prog.id)])) }} style={{fontSize:11,fontWeight:600,color:C.muted,cursor:'pointer'}}>No, es pendiente</span>}
        </div>
      </div>)}
      {cuotasFantasma.length>40&&<div style={{fontSize:10,color:C.muted,marginTop:5}}>y {cuotasFantasma.length-40} más…</div>}
    </div>}
    {glosaConflict.filter(x=>!glDone.has(x.key)).length>0&&<div style={secBox}>{sh('Glosa con dos categorías (Retiro/Sueldo)',C.overdueText,glosaConflict.filter(x=>!glDone.has(x.key)).length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>la misma glosa enseñó categorías distintas → la sugerencia sale no determinista · define cuál es</div>
      {glosaConflict.filter(x=>!glDone.has(x.key)).map(({key,votos})=>{ const sel=glPick[key]||votos[0].cat; return <div key={key} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>«{key}»</div>
        <div style={{fontSize:10.5,color:C.muted,marginTop:1}}>{votos.map(v=>`${v.cat} ${v.n}×`).join(' · ')}</div>
        {onResolverGlosa&&<><div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>{['Retiros','Sueldos','Otros'].map(cat=><button key={cat} onClick={()=>setGlPick(p=>({...p,[key]:cat}))} style={{fontSize:11,fontWeight:700,borderRadius:20,padding:'4px 12px',cursor:'pointer',border:`1px solid ${sel===cat?C.accent:C.border}`,background:sel===cat?C.azulBg:'#fff',color:sel===cat?C.accent:C.muted}}>{cat}</button>)}</div>
        <button disabled={glBusy===key} onClick={async()=>{ if(!(await appConfirm(`Definir esta glosa como ${sel}. Cambia cómo se clasifican los próximos movimientos (y con eso el margen y las comisiones). ¿Confirmas?`))) return; setGlBusy(key); try{ await onResolverGlosa(key,sel); setGlDone(d=>new Set([...d,key])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) }; setGlBusy(null) }} style={{marginTop:8,padding:'8px 14px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:glBusy===key?'default':'pointer',opacity:glBusy===key?.6:1}}>{glBusy===key?'Guardando…':`Definir como ${sel}`}</button></>}
      </div> })}
    </div>}
    {huerfanas.length>0&&<div style={secBox}>{sh('Facturas sin cliente',C.azulInfo,huerfanas.length)}
      {huerfanas.slice(0,30).map(b=><div key={b.id} onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{...fila,fontSize:11,color:C.muted,marginTop:3,borderTop:`1px solid ${C.bgSoft}`,paddingTop:9,cursor:'pointer'}}><span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)} · {b.receptor_name||b.concept||'—'} {lk(()=>onOpenFactura&&onOpenFactura(b))}</span>{amt(fmt(b.amount||0))}</div>)}
      {huerfanas.length>30&&<div style={{fontSize:10,color:C.muted,marginTop:5}}>y {huerfanas.length-30} más…</div>}
    </div>}
    {vencIncoh.length>0&&<div style={secBox}>{sh('Vencimiento anterior a la emisión',C.soonText,vencIncoh.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>emitida hoy pero con vencimiento en el pasado (se ve "vencida" sin serlo) · el plazo debe correr desde la emisión</div>
      {vencIncoh.map(b=><div key={b.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0',display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'}}>
        <div style={{minWidth:0,flex:1}}>
          <div onClick={()=>onOpenFactura&&onOpenFactura(b)} style={{fontSize:12,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>Factura N° {folioN(b.invoice_no)} · {b.receptor_name||cName(b.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:1}}>Emitida {fmtFechaDMY(b.issued_at)} · vence {fmtFechaDMY(b.due)} <span style={{color:C.overdueText}}>(antes de emitir)</span></div>
        </div>
        {onFixVencimiento&&<button onClick={async()=>{ setFixing(b.id); try{ await onFixVencimiento(b) }catch(_){}; setFixing(null) }} disabled={fixing===b.id} style={{flexShrink:0,background:C.accent,color:'#fff',border:'none',borderRadius:8,padding:'7px 12px',fontSize:11,fontWeight:700,cursor:fixing===b.id?'default':'pointer',opacity:fixing===b.id?.6:1}}>{fixing===b.id?'Corrigiendo…':'Corregir'}</button>}</div>)}
    </div>}
    {antDup.length>0&&<div style={secBox}>{sh('Anticipos posibles duplicados',C.soonText,antDup.length)}
      {antDup.map(({manual,banks,suma})=><div key={manual.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'10px 0'}}>
        <div style={{fontSize:13,fontWeight:700,color:C.text}}><span onClick={()=>onOpenClientFicha&&onOpenClientFicha(manual.client_id)} style={{cursor:'pointer'}}>{cName(manual.client_id)}</span><span style={{fontSize:9.5,fontWeight:700,color:'#fff',background:C.soonText,borderRadius:20,padding:'2px 8px',marginLeft:7,whiteSpace:'nowrap'}}>calce exacto</span></div>
        <div style={{display:'flex',gap:8,marginTop:6}}>
          <div style={{flex:1,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 9px'}}><div style={{fontSize:9,fontWeight:700,color:C.greenText,textTransform:'uppercase',letterSpacing:.3}}>Del banco</div>{banks.map(b=><div key={b.id} style={{fontSize:11,color:C.muted,marginTop:2}}>{fmt(b.monto||0)}</div>)}<div style={{fontSize:12,fontWeight:700,color:C.greenText,marginTop:3}}>Total {fmt(suma)}</div></div>
          <div style={{flex:1,border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 9px'}}><div style={{fontSize:9,fontWeight:700,color:C.overdueText,textTransform:'uppercase',letterSpacing:.3}}>A mano · sin respaldo</div><div style={{fontSize:12,fontWeight:700,color:C.overdueText,marginTop:2}}>{fmt(manual.monto||0)}</div><div style={{fontSize:10,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{manual.nota||'—'}</div></div>
        </div>
        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button onClick={()=>onResolverDupAnticipo&&onResolverDupAnticipo(manual.id,true)} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Es duplicado · dejar el del banco</button>
          <button onClick={()=>onResolverDupAnticipo&&onResolverDupAnticipo(manual.id,false)} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Son distintos</button>
        </div>
      </div>)}
    </div>}
    {anticipoCubre.length>0&&<div style={secBox}>{sh('Pago recibido que cubre cuotas',C.greenText,anticipoCubre.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>el cliente ya pagó (anticipo de la misma venta) y la cuota sigue por facturar · la diferencia es variación UF</div>
      {anticipoCubre.map(({a,extra=[],cuotas,sum,pagado})=><div key={a.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(a.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(a.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{extra.length?`${extra.length+1} pagos desde el ${fmtFechaDMY(a.fecha)}`:`pago del ${fmtFechaDMY(a.fecha)}`} · {cuotas.length} cuota{cuotas.length!==1?'s':''} desde {fmtFechaDMY(cuotas[0].due)}</div></div>
          {amt(fmt(pagado??(Number(a.monto)||0)),`cuotas ${fmt(sum)}`,C.greenText)}</div>
        {onCubrirCuotas&&<button onClick={async()=>{ await onCubrirCuotas(a.id,cuotas.map(c=>c.id),extra.map(x=>x.id)); setCubiertasRD(p=>new Set([...p,String(a.id),...extra.map(x=>String(x.id))])) }} style={{marginTop:7,fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer'}}>Cubrir {cuotas.length>1?`las ${cuotas.length} cuotas`:'la cuota'}</button>}
      </div>)}
    </div>}
    {errGrupos.length>0&&<div style={secBox}>{sh('Errores de la app',C.overdueText,errGrupos.length)}
      {errGrupos.map(g=><div key={g.k} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={g.mensaje}>{g.mensaje}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{TAB_LABELS[g.vista]||g.vista||'Fuera de una vista'} · {[...g.usuarios].join(', ')||'—'} · {fmtFechaDMY(isoLocal(g.ult))}</div></div>
          {amt(`${g.ids.length}`,g.ids.length===1?'vez':'veces',C.overdueText)}</div>
        <div style={{display:'flex',gap:6,marginTop:7}}><button onClick={()=>errResuelto(g)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Resuelto</button></div>
      </div>)}
    </div>}
    {observadas.length>0&&<div style={secBox}>{sh('Compras de proveedores observados por el SII',C.overdueText,observadas.length)}
      {observadas.map(x=><div key={x.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titleCase(x.emisor_name||'Proveedor')}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>Factura N° {x.folio}{x.periodo?` · ${mesTitulo(String(x.periodo).slice(0,7)+'-15T12:00')}`:''} · IVA objetado en el F29</div></div>
          {amt(fmt(Number(x.observado_iva)||0),'IVA',C.overdueText)}</div>
        <div style={{display:'flex',gap:6,marginTop:7,flexWrap:'wrap'}}>{[['rectificar','Se rectifica'],['acreditar','Se acredita']].map(([k,l])=><button key={k} onClick={()=>decidirObservada(x,k)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>{l}</button>)}</div>
      </div>)}
    </div>}
    {detSaldo.length>0&&<div style={secBox}>{sh('Trabajos sin movimiento con saldo por cobrar',C.overdueText,detSaldo.length)}
      {detSaldo.map(x=><div key={x.s.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(x.s.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(x.s.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s.title||'Trabajo'} · sin movimiento desde {fmtFechaDMY(x.ult)}</div></div>
          {amt(fmt(x.porCobrar),`${x.facturas} factura${x.facturas!==1?'s':''} por cobrar`,C.overdueText)}</div>
      </div>)}
    </div>}
    {detTerm.length>0&&<div style={secBox}>{sh('Trabajos activos que parecen terminados',C.soonText,detTerm.length)}
      {detTermPorAbg.map(([abg,xs])=><div key={abg}>
        <div style={{display:'flex',alignItems:'center',gap:8,margin:'8px 0 2px'}}>
          <span style={{...pillPersonaSty(personChip(abg),false),cursor:'default',fontSize:10.5,padding:'2px 9px'}}>{abg}</span>
          <span style={{fontSize:11,color:C.muted}}>{xs.length} trabajo{xs.length!==1?'s':''}</span><span style={{flex:1}}/>
          {onCerrarTrabajo&&xs.length>1&&<button onClick={()=>cerrarVarios(abg,xs)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Cerrar los {xs.length}</button>}
        </div>
        {xs.map(x=><div key={x.s.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
          <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(x.s.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(x.s.client_id)}</div>
            <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s.title||'Trabajo'}</div></div>
            {amt(`${x.dias} días`,`desde ${fmtFechaDMY(x.ult)}`,C.soonText)}</div>
          <div style={{display:'flex',gap:6,marginTop:7,flexWrap:'wrap'}}>
            {onCerrarTrabajo&&<button onClick={()=>cerrarTrabajo(x)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Cerrar trabajo</button>}
            <button onClick={()=>sigueActivo(x)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Sigue activo</button>
          </div>
        </div>)}
      </div>)}
    </div>}
    {termGastos.length>0&&<div style={secBox}>{sh('Trabajos terminados que siguen recibiendo gastos',C.soonText,termGastos.length)}
      {termGastos.map(x=><div key={x.s.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(x.s.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(x.s.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s.title||'Trabajo'} · {x.gastos.length} gasto{x.gastos.length!==1?'s':''} · último {fmtFechaDMY(x.ultimo)}</div></div>
          {amt(fmt(x.monto),null,C.soonText)}</div>
        <div style={{display:'flex',gap:6,marginTop:7,flexWrap:'wrap'}}>
          {onReabrirTrabajo&&<button onClick={()=>reabrirTrabajo(x)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Reabrir trabajo</button>}
          <button onClick={()=>sigueTerminado(x)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Sigue terminado</button>
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(x.s.client_id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Abrir ficha</button>
        </div>
      </div>)}
    </div>}
    {rsAjena.length>0&&<div style={secBox}>{sh('Gastos con razón social de otro cliente',C.overdueText,rsAjena.length)}
      {rsAjena.map(e=>{ const en=(clientEntities||[]).find(x=>String(x.id)===String(e.entity_id)); return <div key={e.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(e.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(e.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaDMY(e.date)} · {e.concept||'Gasto'}</div>
          <div style={{fontSize:11,color:C.overdueText,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titleCase(en?.name||'')} · razón social de {cName(en?.client_id)}</div></div>
          {amt(fmt(e.amount||0),null,C.text)}</div>
        <div style={{display:'flex',gap:6,marginTop:7,flexWrap:'wrap'}}>
          {onQuitarRsGasto&&<button onClick={()=>quitarRs(e)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Quitar razón social</button>}
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(e.client_id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Abrir ficha</button>
        </div>
      </div> })}
    </div>}
    {enReclamo.length>0&&<div style={secBox}>{sh('Facturas recibidas en plazo de reclamo',C.soonText,enReclamo.length)}
      {enReclamo.map(x=><div key={x.d.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titleCase(x.d.emisor_name||'Proveedor')}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>Factura N° {x.d.folio} · plazo hasta el {fmtFechaDMY(x.vence)}</div></div>
          {amt(fmt(Number(x.d.monto)||0),x.quedan===0?'vence hoy':`quedan ${x.quedan} día${x.quedan!==1?'s':''}`,x.quedan<=2?C.overdueText:C.soonText)}</div>
        {x.calce&&<div style={{fontSize:11,color:C.greenText,marginTop:5}}>Calza con {x.calce.length} comisi{x.calce.length===1?'ón':'ones'} sin factura de este proveedor ({fmt(x.calce.reduce((a,t)=>a+(Number(t.monto)||0),0))})</div>}
        <div style={{display:'flex',gap:6,marginTop:7,flexWrap:'wrap'}}>
          {x.calce&&onEnlazarComisiones&&<button onClick={async()=>{ try{ await onEnlazarComisiones(x.d,x.calce.map(t=>t.id)); await sinReclamo(x) }catch(e){ appAlert('No se pudo enlazar: '+(e.message||e)) } }} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Enlazar {x.calce.length===1?'la comisión':`las ${x.calce.length} comisiones`}</button>}
          <button onClick={()=>sinReclamo(x)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,padding:'5px 12px',cursor:'pointer'}}>Sin reclamo</button>
        </div>
      </div>)}
    </div>}
    {antSub.length>0&&<div style={secBox}>{sh('Pagos de subarriendo',C.greenText,antSub.length)}
      {antSub.map(x=><div key={x.a.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(x.a.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(x.a.client_id)}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>{SD.perTexto(x.per)} · {x.tipo==='aplicar'?`Factura N° ${folioN(x.b.invoice_no)}`:'pendiente de emisión'}</div></div>
          {amt(fmt(Number(x.a.monto)||0),x.tipo==='aplicar'?'calce exacto':'sin factura',x.tipo==='aplicar'?C.greenText:C.soonText)}</div>
        {x.tipo==='aplicar'&&onConsumeAnticipos&&<button onClick={async()=>{ await onConsumeAnticipos([x.a.id],x.b.id); setAntSubDone(p=>new Set([...p,String(x.a.id)])) }} style={{marginTop:7,fontSize:11,fontWeight:700,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'6px 13px',cursor:'pointer'}}>Cubrir la Factura N° {folioN(x.b.invoice_no)}</button>}
      </div>)}
    </div>}
    {cuotasSinGen.length>0&&<div style={secBox}>{sh('Cuotas sin generar',C.azulInfo,cuotasSinGen.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>ventas Activas a cuotas con menos cuotas que el plan · solo formato "cuotas" (excluye personalizada/mensual)</div>
      {cuotasSinGen.map(v=><div key={v.id} onClick={()=>onOpenClientFicha&&onOpenClientFicha(v.client_id)} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0',cursor:'pointer'}}>
        <div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(v.client_id)} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {v.title||'—'}</span></div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>plan {v.nplan} · generadas {Number(v.n_cuotas)} · <span style={{color:C.azulInfo,fontWeight:700}}>faltan {v.nplan-Number(v.n_cuotas)}</span> {lk(()=>onOpenClientFicha&&onOpenClientFicha(v.client_id))}</div>
      </div>)}
    </div>}
    {honorarioDesc.filter(v=>!ahDone.has(String(v.id))).length>0&&(()=>{ const hd=honorarioDesc.filter(v=>!ahDone.has(String(v.id))); return <div style={secBox}>{sh('Honorario ≠ lo facturado',C.soonText,hd.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>el honorario registrado no coincide con la suma facturada · higiene de dato (lo facturado es la realidad)</div>
      {hd.map(v=>{ const fact=Math.round(Number(v.suma_cuotas)||0); return <div key={v.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(v.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{cName(v.client_id)} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {v.title||'—'}{v.status!=='Activo'?` · ${v.status}`:''}</span></div>{amt(`facturado ${fmt(fact)}`,`registrado ${fmt(v.amount_clp||0)}`)}</div>
        {onActualizarHonorario&&<div style={{display:'flex',gap:8,marginTop:7}}>
          <button disabled={ahBusy===v.id} onClick={async()=>{ if(!(await appConfirm(`Voy a fijar el honorario de "${v.title||'—'}" de ${cName(v.client_id)} en ${fmt(fact)} (lo facturado), en vez de ${fmt(v.amount_clp||0)}. Ajusta "Vendido"${v.year?' '+v.year:''} a la realidad. Es reversible. ¿Confirmas?`))) return; setAhBusy(v.id); try{ await onActualizarHonorario(v.id, fact); setAhDone(d=>new Set([...d,String(v.id)])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) } setAhBusy(null) }} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:ahBusy===v.id?'default':'pointer',opacity:ahBusy===v.id?.6:1}}>{ahBusy===v.id?'Ajustando…':`Honorario = ${fmt(fact)}`}</button>
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(v.client_id)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Abrir ficha</button>
        </div>}
      </div> })}
    </div> })()}
    {ventasBorradorCobrado.filter(x=>!ptDone.has(String(x.s.id))).length>0&&(()=>{ const vbc=ventasBorradorCobrado.filter(x=>!ptDone.has(String(x.s.id))); return <div style={secBox}>{sh('Ventas cobradas en borrador',C.overdueText,vbc.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>tienen facturas pagadas pero siguen en Borrador/Propuesta → quedan FUERA de "Vendido" (solo cuenta Activo/Terminado) · pásalas a Terminado</div>
      {vbc.map(({s,emitido,pagado,n})=><div key={s.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0'}}>
        <div style={fila}><div style={{minWidth:0}}><div onClick={()=>onOpenClientFicha&&onOpenClientFicha(s.client_id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cName(s.client_id)} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {s.title||'—'} · {s.status}</span></div>
        <div style={{fontSize:11,color:C.muted,marginTop:2}}>{n} factura{n!==1?'s':''} fuera de Vendido</div></div>{amt(`cobrado ${fmt(pagado)}`,emitido!==pagado?`emitido ${fmt(emitido)}`:null,C.overdueText)}</div>
        {onPasarTerminado&&<div style={{display:'flex',gap:8,marginTop:7}}>
          <button disabled={ptBusy===s.id} onClick={async()=>{ if(!(await appConfirm(`Voy a pasar "${s.title||'—'}" de ${cName(s.client_id)} a Terminado y fijar su honorario en ${fmt(emitido)} (lo facturado). Así suma en Vendido ${s.year}. Es reversible. ¿Confirmas?`))) return; setPtBusy(s.id); try{ await onPasarTerminado(s, emitido); setPtDone(d=>new Set([...d,String(s.id)])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) } setPtBusy(null) }} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:ptBusy===s.id?'default':'pointer',opacity:ptBusy===s.id?.6:1}}>{ptBusy===s.id?'Pasando…':`Pasar a Terminado · honorario ${fmt(emitido)}`}</button>
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(s.client_id)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Abrir ficha</button>
        </div>}
      </div>)}
    </div> })()}
    {siiRows.length>0&&<div style={secBox}>{sh('DTE del SII sin enlazar',C.tealText,siiRows.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>facturas emitidas en el SII que la app aún no vinculó a una venta · se cargan en Facturación</div>
      {siiRows.slice(0,30).map((v,i)=>{ const cl=v.client_id; return <div key={(v.folio||'')+'-'+i} onClick={cl?(()=>onOpenClientFicha&&onOpenClientFicha(cl)):undefined} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0',cursor:cl?'pointer':'default',display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
        <div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>N° {v.folio} · {v.receptor_name||'—'}</div><div style={{fontSize:10.5,color:C.muted,marginTop:1}}>{fmtFechaDMY(v.fecha_emision)} · {cl?'con cliente':'sin cliente'}</div></div>
        <span style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0}}>{fmt(Math.round(Number(v.monto)||0))}</span>
      </div> })}
      {siiRows.length>30&&<div style={{fontSize:10,color:C.muted,marginTop:5}}>y {siiRows.length-30} más…</div>}
    </div>}
    {bancoRut.length>0&&<div style={secBox}>{sh('Clientes sin RUT · el banco sugiere uno',C.azulInfo,bancoRut.length)}
      <div style={{fontSize:10,color:C.textSoft,marginBottom:2}}>el RUT no está en la ficha ni en una razón social, pero aparece en un movimiento del banco con el mismo nombre · revisa la evidencia y confirma</div>
      {bancoRut.map(p=><div key={p.client.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'10px 0'}}>
        <div onClick={()=>onOpenClientFicha&&onOpenClientFicha(p.client.id)} style={{fontSize:13,fontWeight:600,color:C.accent,cursor:'pointer',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.client.name} <span style={{fontSize:10,fontWeight:400,color:C.muted}}>· {p.nFact} factura{p.nFact!==1?'s':''}</span></div>
        <div style={{display:'flex',gap:8,marginTop:6,background:C.azulBg,borderRadius:9,padding:'8px 10px',alignItems:'flex-start'}}>
          <SIcon n='tBanco' s={14} c={C.azulInfo}/>
          <div style={{fontSize:11,color:C.text,lineHeight:1.4,minWidth:0,flex:1}}>Banco: <span style={{color:C.muted}}>{p.bankName}</span> · <b style={{color:C.accent,fontVariantNumeric:'tabular-nums'}}>{fmtRutCL(p.rut)}</b><div style={{fontSize:10,color:C.muted,marginTop:2}}>{p.nMovs} movimiento{p.nMovs!==1?'s':''}</div></div>{amt(fmt(Math.round(p.total)))}
        </div>
        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button disabled={brBusy===p.client.id} onClick={async()=>{ if(!(await appConfirm(`Voy a guardar el RUT ${fmtRutCL(p.rut)} en la ficha de ${p.client.name}. Lo tomé del banco (${p.bankName}). Es reversible. ¿Confirmas?`))) return; setBrBusy(p.client.id); try{ onGuardarClientRut&&await onGuardarClientRut(p.client.id,p.rut); setRutDone(d=>new Set([...d,String(p.client.id)])) }catch(e){ appAlert('No se pudo: '+(e.message||e)) } setBrBusy(null) }} style={{flex:1,padding:'8px',borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:12,fontWeight:700,cursor:brBusy===p.client.id?'default':'pointer',opacity:brBusy===p.client.id?.6:1}}>{brBusy===p.client.id?'Guardando…':'Es el mismo · guardar RUT'}</button>
          <button onClick={()=>{ learnPut('rut_banco_no',String(p.client.id)+':'+p.rutKey,p.rut); setRutNo(s=>new Set([...s,String(p.client.id)+':'+p.rutKey])) }} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>No es</button>
          <button onClick={()=>onOpenClientFicha&&onOpenClientFicha(p.client.id)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Ficha</button>
        </div>
      </div>)}
    </div>}
    {(()=>{ const {sobre,doble,atras,sinBanco,concBy}=bancoChk; const n=sobre.length+doble.length+atras.length+sinBanco.length; if(!n) return null
      const movFila=(m,det)=><div key={m.id} onClick={()=>onOpenMov&&onOpenMov(m.id)} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0',cursor:onOpenMov?'pointer':'default',display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}>
        <div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:600,color:C.accent,overflowWrap:'anywhere'}}>{fmtFechaDMY(m.fecha)} · {m.nombre_contraparte||String(m.descripcion||'').slice(0,60)||'—'}</div><div style={{fontSize:10.5,color:C.muted,marginTop:1}}>{det}</div></div>
        <span style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(m.monto||0)}</span></div>
      return <div style={secBox}>{sh('Banco · plata contada dos veces o de más',C.overdueText,n)}
        {doble.length>0&&<><div style={{fontSize:10,color:C.textSoft,margin:'4px 0 2px'}}>pago a proveedor registrado como comisión y además como gasto · se cuenta dos veces</div>{doble.map(m=>movFila(m,'comisión pagada + gasto'))}</>}
        {sobre.length>0&&<><div style={{fontSize:10,color:C.textSoft,margin:'8px 0 2px'}}>conciliado por más de lo que entró o salió del banco</div>{sobre.map(m=>movFila(m,`conciliado ${fmt(concBy[String(m.id)]||0)}`))}</>}
        {atras.length>0&&<><div style={{fontSize:10,color:C.textSoft,margin:'8px 0 2px'}}>la cifra conciliada no está al día con lo imputado</div>{atras.map(m=>movFila(m,`marcado ${fmt(m.monto_conciliado||0)} · aplicado ${fmt(concBy[String(m.id)]||0)}`))}</>}
        {sinBanco.length>0&&<><div style={{fontSize:10,color:C.textSoft,margin:'8px 0 2px'}}>comisión marcada pagada sin su transferencia del banco</div>{sinBanco.slice(0,30).map(t=><div key={t.id} style={{borderTop:`1px solid ${C.bgSoft}`,padding:'9px 0',display:'flex',justifyContent:'space-between',gap:8,alignItems:'baseline'}}><div style={{minWidth:0,flex:1}}><div style={{fontSize:12,fontWeight:600,color:C.text}}>{t.proveedor||'Proveedor'}</div><div style={{fontSize:10.5,color:C.muted,marginTop:1}}>pagada {t.pagado_at?fmtFechaDMY(t.pagado_at):'—'}</div></div><span style={{fontSize:12,fontWeight:700,color:C.text,flexShrink:0,fontVariantNumeric:'tabular-nums'}}>{fmt(Number(t.monto)||0)}</span></div>)}</>}
      </div> })()}
    </div>
  </div>
}

