// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { tasaBHE, pagarT, reajusteBHEPago, estadoComision } from '../../supabase/functions/_shared/comisionesReglas.js'
import { calcesCompraPago } from '../../supabase/functions/_shared/comprasReglas.js'
import { C, Gl, SIcon, _normTxt, appAlert, appConfirm, appPrompt, diaGrande, fmt, fmtFechaDMY, fmtRutCL, folioN, useIsDesktop } from '../lib/base.jsx'
import { ActBtn, Attachments, BitacoraLista, Buscador, Copyable, KpiIco, MES_C, NOMBRE_CLI, PageHeader, TH_BAND, _diasDesde, _diasEntre, _lev, _nRut, abrirDocumento, cargarAdminsEstudio, claudeCall, correoMarcaHtml, enviarComoUsuario, esBoletaProv, fechaBHE, firmaDefault, fmtMill, fmtShort, glosaFactura, logActividad, mesTitulo, montoFactura, nCuotaDe, nDias, pctBHE, periodoF29, saldoBill, saldoComisiones, setLearningKV, tipoFactura, tituloProv, txtEnviado, venceBill, viewMemGuardar, viewMemLeer, registrarError } from '../lib/compartido.jsx'

// Tipo de parecido entre dos textos (nombre o razón social), MISMA regla que clientesParecidos (exacto/contenido/typo).
export function _simTipo(aRaw,bRaw){
  const a=_normTxt(aRaw), b=_normTxt(bRaw); if(!a||!b) return null
  if(a===b) return 'exacto'
  const at=a.split(' ').filter(w=>w.length>1), bt=b.split(' ').filter(w=>w.length>1)
  const short=at.length<=bt.length?at:bt, long=at.length<=bt.length?bt:at
  if(short.length>=2 && short.every(t=>long.includes(t))) return 'contenido'
  if(at.length===bt.length && Math.min(a.length,b.length)>=6 && _lev(a,b)<=2) return 'typo'
  return null
}

// RUT normalizado para comparar (quita puntos/guión/espacios, deja dígitos + K). Un proveedor puede ser PERSONA (cédula)
// y/o tener SOCIEDAD (RUT de la RS): comparamos ambos identificadores textuales + el RUT.
export const _nrmRut = s => (s||'').toString().toLowerCase().replace(/[^0-9k]/g,'')

// Proveedores EXISTENTES que colisionan con uno NUEVO. Mira nombre, razón social y RUT (persona natural con RUT y/o
// sociedad, ej. Andrés Mery / Rodrigo Díaz / Álvaro Awad). RUT igual = 'rut' (señal más fuerte); nombre/RS parecido =
// exacto/contenido/typo. Bloquea la creación para no duplicar (prevención > fusión).
export function proveedoresParecidos(f, proveedores=[], excludeId=null){
  const labelsNew=[f?.nombre,f?.razon_social].filter(Boolean)
  const rutNew=_nrmRut(f?.rut)
  const rank={rut:0,exacto:1,contenido:2,typo:3}
  const out=[]
  for(const p of (proveedores||[])){
    if(!p||(excludeId!=null&&String(p.id)===String(excludeId))) continue
    let tipo=null
    if(rutNew && _nrmRut(p.rut)===rutNew) tipo='rut'
    else { const labelsP=[p.nombre,p.razon_social].filter(Boolean)
      for(const ln of labelsNew) for(const lp of labelsP){ const t=_simTipo(ln,lp); if(t && (!tipo||rank[t]<rank[tipo])) tipo=t } }
    if(tipo) out.push({proveedor:p, tipo})
  }
  out.sort((a,b)=>rank[a.tipo]-rank[b.tipo])
  return out
}

export const _tipoDupProvLbl = t => t==='rut'?'mismo RUT':t==='exacto'?'idéntico':t==='contenido'?'muy similar':'posible typo'

export const _CAT_NO_PROV = ['Equipo','Socio','Caja chica','Contadora','Reembolso oficina','Devolución','Impuestos','Notaría','Cliente']

// ── Boletas de honorarios (módulo país Chile) ── Quien emite boleta: nuestro COSTO es el bruto; la retención la paga el estudio
// al SII (F29) y al proveedor se le transfiere el líquido. La tasa cambia cada año (Ley 21.133): agregar aquí el año nuevo.
// «Comisiones por cobrar» de un proveedor — FUENTE ÚNICA (Inicio, home de Comisiones y su ficha). Dos caminos:
// (1) el % que retenemos al cobrar facturas de sus clientes (terceros_pagos.comision_monto; cobrada cuando esa factura está Pagada) y
// (2) las facturas que le emitimos por comisiones (honorarios del cliente vinculado al proveedor). Por cobrar = saldo vivo; cobradas = del año.
export const comisionesACobrar = (p, terceros, billing, yr) => {
  const bId={}; (billing||[]).forEach(b=>{ bId[String(b.id)]=b })
  const vivo = b => !!b && !b.deleted_at && b.status!=='Anulada'
  const items=[]
  ;(terceros||[]).filter(t=>String(t.proveedor_id)===String(p?.id)&&Number(t.comision_monto)>0).forEach(t=>{ const b=bId[String(t.billing_id)]; if(vivo(b)) items.push({k:'r'+t.id,tipo:'ret',b,t,monto:Number(t.comision_monto)||0,cob:b.status==='Pagado'}) })
  if(p?.client_id) (billing||[]).filter(b=>String(b.client_id)===String(p.client_id)&&['honorarios','comision'].includes(tipoFactura(b))&&b.invoice_no&&vivo(b)).forEach(b=>items.push({k:'f'+b.id,tipo:'fac',b,monto:Number(b.amount)||0,cob:b.status==='Pagado'}))
  const delAnio = x => String(x.b.paid_at||x.b.issued_at||'').slice(0,4)===String(yr)
  return {items, porCobrar:items.filter(x=>!x.cob).reduce((s,x)=>s+x.monto,0), cobradasAnio:items.filter(x=>x.cob&&delAnio(x)).reduce((s,x)=>s+x.monto,0)} }

export const f29BHE = (fecha, expenses, nombre) => { const per=String(fecha||'').slice(0,7); if(!/^\d{4}-\d{2}$/.test(per)) return null
  const lbl=`${per.slice(5,7)}-${per.slice(0,4)}`, hoyP=new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}).slice(0,7)
  const pago=(expenses||[]).find(e=>!e.deleted_at&&e.category==='Impuestos y patentes'&&e.subcategory==='PPM'&&periodoF29(e)===per)
  const estado=pago?'pagada':per>=hoyP?'ira':'por_pagar'
  const txt={pagada:`Pagada en el F29 ${lbl} · ${fmtFechaDMY(pago?.date)}`, ira:`Irá en el F29 ${lbl}`, por_pagar:`F29 ${lbl} sin pago registrado`}[estado]
  return {per, lbl, estado, pago:estado==='pagada'?pago:null, txt} }

// ── PROVEEDORES (página, tab 'proveedores'): SOLO a quienes les pagas comisión o que te pagan comisiones. El subarriendo y los servicios
// de oficina no van aquí. Lenguaje aprobado (2026-10-14): Comisiones · Pagada · Por pagar (el cliente ya pagó) · Sujeto a cobro (el cliente aún no paga) · Anticipo · Comisiones por cobrar (lo que te pagan). Las comisiones se
// siguen POR TRABAJO (la venta; o "Facturas a {cliente}" cuando no hay venta) y POR CUOTA: vence · cliente pagó (fecha del banco) · le pagaste.
// CUADRE DE COMISIONES (fuente única: Mis comisiones y ficha del proveedor). Solo descalces RELEVANTES: |dif| > máx($10.000, 2% de lo que
// corresponde) — los redondeos y las diferencias por el valor de la UF de cada cuota no se muestran. Tres revisiones:
//  · base: líquido de sus comisiones (pagadas + por pagar) vs el % pactado de lo que pagó el cliente (facturas pagadas + anticipos sin factura);
//  · banco: lo transferido (conciliación 'tercero' del movimiento) vs el líquido de las comisiones que ese pago saldó (p. ej. se pagó el bruto);
//  · sin comisión: factura emitida de una venta con comisión % que no tiene su comisión registrada.
export const CUADRE_UMBRAL = corr => Math.max(10000, Math.abs(corr||0)*0.02)

export function cuadreComisiones({ts=[], billing=[], anticipos=[], concs=[], sales=[]}){
  const byId=new Map((billing||[]).map(b=>[String(b.id),b])), items=[], ok=[], filas=[]
  const vivas=(ts||[]).filter(t=>{ if(!t.billing_id) return true; const b=byId.get(String(t.billing_id)); return !!b&&b.status!=='Anulada'&&!b.deleted_at })
  const porVenta={}; vivas.forEach(t=>{ const sid=String(t.sale_id||byId.get(String(t.billing_id))?.sale_id||''); if(sid) (porVenta[sid]=porVenta[sid]||[]).push(t) })
  Object.entries(porVenta).forEach(([sid,tv])=>{ const sale=(sales||[]).find(x=>String(x.id)===sid); const pct=tv.map(t=>t.tipo_costo==='pct'?Number(t.valor)||0:0).find(v=>v>0)
    if(!pct||!sale) return
    const bs=(billing||[]).filter(b=>String(b.sale_id)===sid&&!b.deleted_at&&b.status!=='Anulada'&&!['reembolso','nota_credito'].includes(b.billing_type))
    const cobrado=bs.filter(b=>b.status==='Pagado'&&b.invoice_no).reduce((a,b)=>a+montoFactura(b),0)+(anticipos||[]).filter(a=>String(a.sale_id)===sid&&!a.billing_id).reduce((a,x)=>a+(Number(x.monto)||0),0)
    const corr=Math.round(cobrado*pct/100)
    const reg=tv.filter(t=>t.estado==='pagado'||t.estado==='por_pagar'||['Pagado','Anticipada'].includes(byId.get(String(t.billing_id))?.status)).reduce((a,t)=>a+pagarT(t),0)
    const dif=reg-corr, base={sid, sale, cobrado, corr, reg, pct, dif}
    if(cobrado>0) filas.push(base)
    if(cobrado>0&&Math.abs(dif)>CUADRE_UMBRAL(corr)) items.push({k:'base:'+sid, tipo:'base', sid, sale, monto:dif, cobrado, corr, reg, pct}); else if(cobrado>0) ok.push(base)
    // Factura emitida sin su comisión (ni por la factura ni por una cuota de la venta).
    bs.filter(b=>b.invoice_no&&!vivas.some(t=>String(t.billing_id)===String(b.id))&&['Pendiente','Vencido','Pagado'].includes(b.status)&&String(b.issued_at||'')>='2026-06-06').forEach(b=>items.push({k:'sincom:'+b.id, tipo:'sincom', sid, sale, b, monto:null, pct}))
  })
  // Banco: cada transferencia que pagó comisiones, contra el líquido de esas comisiones.
  const movs=[...new Set(vivas.map(t=>t.movimiento_id).filter(Boolean).map(String))]
  movs.forEach(mid=>{ const aplic=(concs||[]).filter(c=>String(c.movimiento_id)===mid&&c.tipo_destino==='tercero').reduce((a,c)=>a+(Number(c.monto_aplicado)||0),0); if(!aplic) return
    const tm=vivas.filter(t=>String(t.movimiento_id)===mid), liq=tm.reduce((a,t)=>a+pagarT(t),0), dif=aplic-liq
    if(Math.abs(dif)>CUADRE_UMBRAL(liq)) items.push({k:'mov:'+mid, tipo:'banco', mid, ts:tm, aplic, liq, monto:dif, sid:String(tm[0]?.sale_id||''), sale:(sales||[]).find(x=>String(x.id)===String(tm[0]?.sale_id))}) })
  return {items, ok, filas}
}

export function CorreoBoletaPage({prov, bm, lineas=[], user, onBack, onSent}){
  const isDesktop = useIsDesktop()
  const myEmail = String(user?.email||'').toLowerCase()
  const [para,setPara] = useState('')
  const [firma,setFirma] = useState(firmaDefault(myEmail)||{nombre:user?.name||'',cargo:'Abogado',telefono:''})
  const [sending,setSending] = useState(false)
  const [verPrev,setVerPrev] = useState(false)   // celular: vista previa del correo bajo demanda
  const uno = lineas.length===1
  const datos = String(prov?.datos_pago||'').split(/\n+/).map(x=>x.trim()).filter(Boolean)
  const asunto = `Comisiones por pagar · Boleta N° ${bm.folio} · ${fmt(bm.liq)}`
  const base = ['Estimados:','','Espero que estén muy bien.','',
    `Adjunto mi boleta de honorarios N° ${bm.folio} por ${uno?'la comisión del trabajo que el cliente ya pagó':'las comisiones de los trabajos que los clientes ya pagaron'}:`,'',
    ...lineas.map(l=>`  ${l.txt}${l.pago?` (pagó el ${fmtFechaDMY(l.pago)})`:''}: ${fmt(l.monto)}`),'',
    `  Boleta N° ${bm.folio} · ${fmtFechaDMY(bm.fecha)} · bruto: ${fmt(bm.bruto)}`,
    `  Retención ${pctBHE(tasaBHE(bm.fecha))}: ${fmt(bm.ret)}`,
    `  Líquido a transferir: ${fmt(bm.liq)}`,'',
    `Les pido transferir ${fmt(bm.liq)} a la cuenta de:`,'',
    `  ${prov?.razon_social||prov?.nombre||firma.nombre||''}`,
    ...(prov?.rut?[`  RUT: ${fmtRutCL(prov.rut)}`]:[]),
    ...datos.map(x=>`  ${x}`),'',
    'Saludos,'].join('\n')
  const [body,setBody] = useState(base)
  useEffect(()=>{ let on=true
    cargarAdminsEstudio().then(a=>{ if(on){ const ems=(a||[]).map(x=>x.email).filter(e=>e&&e!==myEmail); setPara(p=>p||ems.join(', ')) } })
    if(!DEMO&&myEmail) supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',myEmail).order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(on&&data?.value){ try{ setFirma(f=>({...f,...JSON.parse(data.value)})) }catch(_){} } },()=>{})
    if(!DEMO&&bm.bheId) supabase.from('learnings').select('value').eq('kind','correo_boleta').eq('key',String(bm.bheId)).maybeSingle().then(({data})=>{ if(on&&data?.value) setBody(String(data.value)) },()=>{})
    return ()=>{ on=false } },[])
  const adjunto = async () => {
    const aB64 = blob => new Promise((res,rej)=>{ const fr=new FileReader(); fr.onloadend=()=>res(String(fr.result||'').split(',')[1]||''); fr.onerror=rej; fr.readAsDataURL(blob) })
    const nombre = `bhe_${_nRut(prov?.rut).slice(0,-1)}-${bm.folio}.pdf`
    if(bm.file) return {base64:await aB64(bm.file), name:nombre, mime:'application/pdf'}
    if(bm.storage_path&&!DEMO){ const {data}=await supabase.storage.from('documentos').download(bm.storage_path); if(data) return {base64:await aB64(data), name:nombre, mime:'application/pdf'} }
    return null }
  const guardarBorrador = async () => { if(!DEMO&&bm.bheId){ try{ await setLearningKV('correo_boleta',String(bm.bheId),body) }catch(e){registrarError({origen:'accion',vista:'correo_boleta',err:e})} } appAlert('Borrador guardado.') }
  const enviar = async () => {
    if(!para.trim()){ appAlert('Falta a quién enviarlo (Para).'); return }
    setSending(true)
    try{
      const a = await adjunto()
      if(!a && !(await appConfirm('No encontré el PDF de la boleta para adjuntarlo. ¿Enviar igual?'))){ setSending(false); return }
      const r = DEMO ? 'demo' : await enviarComoUsuario({to:para.trim(), subject:asunto, html:correoMarcaHtml(body,`Boleta N° ${bm.folio}`,firma,false), text:body, attachments:a?[a]:null})
      setSending(false)
      if(!r) return
      onSent&&onSent(r)
    }catch(e){ setSending(false); appAlert('No se pudo enviar: '+(e.message||e)) }
  }
  const inp = {width:'100%',border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'8px 10px',color:C.text,background:C.card,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
  return (<div>
    <PageHeader origen='Mis comisiones' onBack={onBack} titulo='Envío de boleta a la oficina' ctx={isDesktop?`Boleta N° ${bm.folio} · ${fmt(bm.liq)}`:null}/>
    <div style={{padding:isDesktop?'14px 24px 40px':'12px 14px 40px',maxWidth:900,margin:'0 auto',display:'flex',flexDirection:'column',gap:10}}>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px',display:'grid',gridTemplateColumns:'64px 1fr',gap:'8px 10px',alignItems:'center',fontSize:12.5}}>
        <span style={{color:C.muted}}>Para</span><input value={para} onChange={e=>setPara(e.target.value)} style={inp}/>
        <span style={{color:C.muted}}>Asunto</span><span style={{fontWeight:600,minWidth:0,...(isDesktop?{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}:{})}}>{asunto}</span>
        <span style={{color:C.muted}}>Adjunto</span><span style={{color:C.text}}>{bm.file||bm.storage_path?`bhe_${_nRut(prov?.rut).slice(0,-1)}-${bm.folio}.pdf`:'sin PDF'}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1fr) minmax(0,1fr)':'1fr',gap:10,alignItems:'start'}}>
        <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
          <textarea value={body} onChange={e=>setBody(e.target.value)} rows={isDesktop?24:18} style={{...inp,lineHeight:1.55,resize:'vertical'}}/>
          <div style={{fontSize:11,color:C.textSoft}}>{isDesktop?'Las líneas con sangría van dentro del recuadro de datos. La firma se agrega sola.':'Con sangría va en el recuadro. La firma va sola.'}</div>
          {!isDesktop&&<span onClick={()=>setVerPrev(v=>!v)} style={{fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer'}}>{verPrev?'Ocultar vista previa':'Ver cómo llega el correo'} <Gl n={verPrev?'chevU':'chevD'}/></span>}
        </div>
        {(isDesktop||verPrev)&&<div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:10,minWidth:0,overflow:'hidden'}} dangerouslySetInnerHTML={{__html:correoMarcaHtml(body,`Boleta N° ${bm.folio}`,firma,false)}}/>}
      </div>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'auto auto':'1fr 1fr',justifyContent:isDesktop?'end':'stretch',gap:8}}>
        <ActBtn variant='ghost' size='lg' onClick={guardarBorrador}>Guardar borrador</ActBtn>
        <ActBtn variant='primary' size='lg' disabled={sending} onClick={enviar}>{sending?'Enviando…':'Enviar'}</ActBtn>
      </div>
    </div>
  </div>)
}

export function ProveedoresView({proveedores=[],terceros=[],setTerceros,billing=[],anticipos=[],expenses=[],clients=[],sales=[],user,onSave,onRevertirPago,onAsignarFacturas,onOpenSale,onOpenFactura,onOpenClientFicha,onIrBanco,onBack,origen='Volver',saving,focoProvId=null,onFocoUsado,soloProvId=null}) {
  const isDesktop = useIsDesktop()
  // soloProvId: «Mis comisiones» del miembro del equipo — su propia ficha, solo lectura (sin editar, enlazar, pagar ni banco).
  const ro = !!soloProvId
  const mem = ro ? null : viewMemLeer('proveedores')
  const [view,setView] = useState(ro?'ficha':(mem?.view||'list'))   // list | ficha | form | enlazar | pagar
  const [modo,setModo] = useState(mem?.modo==='cli'?'cli':'prov')   // lista: prov (por proveedor) | cli (por cliente)
  const [lf,setLf] = useState('todos'), [expP,setExpP] = useState(null), [verSinMov,setVerSinMov] = useState(false)   // landing: filtro por tarjeta · fila desplegada · proveedores sin movimiento en el año
  const [selId,setSelId] = useState(ro?String(soloProvId):(mem?.selId||null))
  const [yr,setYr] = useState(mem?.yr||String(new Date().getFullYear()))
  const [tf,setTf] = useState(mem?.tf||'todos')        // filtro Por trabajo: todos | por_pagar | por_devengar | pagados | revisar | sincuota | porfacturar
  const [cf,setCf] = useState('todas')                 // filtro de cuotas en la ficha: todas | por_pagar | por_devengar | pagada
  const [cliF,setCliF] = useState(null)                // filtro por cliente en la ficha (no mezclar la bolsa)
  const [mesF,setMesF] = useState(null)                // filtro por mes de la cuota del cliente (tarjeta Comisiones sujetas a cobro, por mes)
  const [ordC,setOrdC] = useState(-1), [ordP,setOrdP] = useState(-1)   // orden por fecha: comisiones · pagos y facturas del SII (−1 = más nuevo primero)
  const [expT,setExpT] = useState(null), [nVer,setNVer] = useState(5) // comisión desplegada · cuántas se muestran
  const [revOpen,setRevOpen] = useState(false), [secAb,setSecAb] = useState(null), [cliMas,setCliMas] = useState(false)   // ficha: revisar y acciones · tarjetita abierta · más clientes
  useEffect(()=>{ if(ro) return; viewMemGuardar('proveedores',{view:['form','pagar','boleta'].includes(view)?(selId?'ficha':'list'):view,selId,yr,modo,tf}) },[view,selId,yr,modo,tf])
  useEffect(()=>{ if(focoProvId&&proveedores.some(p=>String(p.id)===String(focoProvId))){ setSelId(String(focoProvId)); setView('ficha'); setCf('todas'); onFocoUsado&&onFocoUsado() } },[focoProvId,proveedores])
  const [q,setQ] = useState('')
  const [ord,setOrd] = useState({k:'total',dir:-1})
  const [evMas,setEvMas] = useState(false), [cMas,setCMas] = useState(false), [retOpen,setRetOpen] = useState(false)
  const [busy,setBusy] = useState(null)
  const [asgOpen,setAsgOpen] = useState(false), [facQ,setFacQ] = useState(''), [montos,setMontos] = useState({}), [asgBusy,setAsgBusy] = useState(null)
  const [f,setF] = useState({nombre:'',razon_social:'',rut:'',datos_pago:''})
  const [okDistinto,setOkDistinto] = useState(false)
  const [completarCola,setCompletarCola] = useState([])   // "Completar datos de pago": recorre los que faltan uno tras otro
  const [selEnl,setSelEnl] = useState(null)
  const [bol,setBol] = useState(null)                      // página Registrar boleta/factura: {ids:Set, numero, fecha, monto}
  const [bolMail,setBolMail] = useState(null)              // ro: boleta recién guardada → página del correo a la oficina
  // Cuadre: respuestas del miembro («Está bien / No es así») y causas que anota un socio (learnings cuadre_resp / cuadre_nota).
  const [cuadreResp,setCuadreResp] = useState({}), [cuadreNota,setCuadreNota] = useState({}), [concsRo,setConcsRo] = useState([]), [verFilasCuadre,setVerFilasCuadre] = useState(false)
  useEffect(()=>{ if(DEMO) return; supabase.from('learnings').select('kind,key,value').in('kind',['cuadre_resp','cuadre_nota']).then(({data})=>{ const r={}, n={}; (data||[]).forEach(x=>{ try{ (x.kind==='cuadre_resp'?r:n)[x.key]=JSON.parse(x.value) }catch(_){} }); setCuadreResp(r); setCuadreNota(n) },()=>{}) },[])
  // En «Mis comisiones» no se carga el banco: solo la conciliación de las transferencias que pagaron SUS comisiones (para el cuadre).
  useEffect(()=>{ if(DEMO||!ro) return; const ids=[...new Set((terceros||[]).filter(t=>String(t.proveedor_id)===String(soloProvId)&&t.movimiento_id).map(t=>String(t.movimiento_id)))]; if(!ids.length) return
    supabase.from('conciliacion').select('movimiento_id,tipo_destino,monto_aplicado').in('movimiento_id',ids).then(({data})=>setConcsRo(data||[]),()=>{}) },[ro,soloProvId,terceros])
  const [leyendoBol,setLeyendoBol] = useState(false)       // lectura del PDF de la boleta con IA (N°, fecha, bruto)
  const [enlP,setEnlP] = useState(null)                    // enlace a mano abierto: {mid} un pago · {tid} una comisión pagada · {did} una factura del SII
  const [enlSel,setEnlSel] = useState(()=>new Set())
  const [marcas,setMarcas] = useState({})                  // pagos marcados "trabajo por identificar" (learnings pago_prov_por_identificar: key = movimiento)
  const [aportes,setAportes] = useState({})                // pagos que aportaron una PARTE a comisiones saldadas con otro pago (FIFO): learnings pago_prov_aporte, key = movimiento, value = {t:[ids],monto}
  useEffect(()=>{ if(DEMO||ro) return; supabase.from('learnings').select('kind,key,value').in('kind',['pago_prov_por_identificar','pago_prov_aporte']).then(({data})=>{ const o={}, a={}; (data||[]).forEach(r=>{ if(r.kind==='pago_prov_aporte'){ try{ a[r.key]=JSON.parse(r.value) }catch(_){} } else o[r.key]=r.value||'Trabajo por identificar' }); setMarcas(o); setAportes(a) },()=>{}) },[])
  // Datos que no viven en App: facturas del SII de los proveedores, cargos del banco a sus RUT (con su conciliación) y la fecha
  // del abono del cliente para cada cuota con comisión (conciliación factura → movimiento).
  const [docs,setDocs] = useState([]), [cargos,setCargos] = useState([]), [concs,setConcs] = useState([]), [gastosCat,setGastosCat] = useState({}), [abonoCli,setAbonoCli] = useState({})
  const ruts = useMemo(()=>new Set(proveedores.map(p=>_nRut(p.rut)).filter(Boolean)),[proveedores])
  // Boletas de honorarios de los proveedores (bruto, retención, líquido, PDF en el bucket privado `documentos`).
  const [bhes,setBhes] = useState([])
  useEffect(()=>{ if(DEMO){ setBhes(demoData.boletas_honorarios||[]); return } const ids=proveedores.filter(esBoletaProv).map(p=>p.id).filter(id=>!ro||String(id)===String(soloProvId)); if(!ids.length) return
    supabase.from('boletas_honorarios').select('*').in('proveedor_id',ids).order('fecha',{ascending:false}).then(({data})=>setBhes(data||[]),()=>{}) },[proveedores])
  const bheDe = t => t?.bhe_id ? bhes.find(b=>String(b.id)===String(t.bhe_id)) : null
  const billIds = useMemo(()=>[...new Set(terceros.map(t=>t.billing_id).filter(Boolean).map(String))],[terceros])
  useEffect(()=>{ let vivo=true
    if(DEMO){ setDocs(demoData.sii_compras_docs||[]); const movs=demoData.cartola_movimientos||[]; setCargos(movs.filter(m=>m.tipo==='cargo'&&ruts.has(_nRut(m.rut_contraparte)))); setConcs(demoData.conciliacion||[])
      const ab={}; (demoData.conciliacion||[]).filter(c=>c.tipo_destino==='factura'&&c.factura_id).forEach(c=>{ const m=movs.find(x=>x.id===c.movimiento_id); if(m&&(!ab[c.factura_id]||m.fecha<ab[c.factura_id].fecha)) ab[c.factura_id]={fecha:m.fecha,mov:m.id} }); setAbonoCli(ab); return }
    const ids=proveedores.map(p=>p.id); if(!ids.length) return
    ;(async()=>{ try{
      const [{data:d},{data:m},{data:cf}]=await Promise.all([
        ro?Promise.resolve({data:[]}):supabase.from('sii_compras_docs').select('id,folio,tipo_dte,fecha_emision,emisor_rut,monto,proveedor_id,movimiento_id').in('proveedor_id',ids),
        ro?Promise.resolve({data:[]}):selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,tipo,rut_contraparte,categoria,estado,monto_conciliado,descripcion,es_interno').eq('tipo','cargo').order('id')),
        billIds.length?supabase.from('conciliacion').select('movimiento_id,factura_id').eq('tipo_destino','factura').in('factura_id',billIds):Promise.resolve({data:[]})])
      if(!vivo) return
      const mine=(m||[]).filter(x=>!x.es_interno&&ruts.has(_nRut(x.rut_contraparte)))
      setDocs(d||[]); setCargos(mine)
      const movIds=[...new Set((cf||[]).map(x=>x.movimiento_id).filter(Boolean))]
      if(movIds.length){ const {data:mv}=await supabase.from('cartola_movimientos').select('id,fecha').in('id',movIds); if(!vivo) return
        const fecha={}; (mv||[]).forEach(x=>{ fecha[x.id]=x.fecha }); const ab={}
        ;(cf||[]).forEach(c=>{ const fe=fecha[c.movimiento_id]; if(!fe) return; if(!ab[c.factura_id]||fe<ab[c.factura_id].fecha) ab[c.factura_id]={fecha:fe,mov:c.movimiento_id} }); setAbonoCli(ab) }
      if(mine.length){ const {data:c}=await supabase.from('conciliacion').select('id,movimiento_id,tipo_destino,gasto_id,monto_aplicado').in('movimiento_id',mine.map(x=>x.id))
        if(!vivo) return; setConcs(c||[])
        const gids=[...new Set((c||[]).map(x=>x.gasto_id).filter(Boolean))]
        if(gids.length){ const {data:g}=await supabase.from('expenses').select('id,category,subcategory').in('id',gids); if(vivo){ const o={}; (g||[]).forEach(x=>{ o[x.id]=x }); setGastosCat(o) } } }
    }catch(_){} })()
    return ()=>{ vivo=false } },[proveedores,ruts,billIds.join(',')])

  const hoyISO = new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})   // fecha de Chile (no UTC: de noche daba el día siguiente)
  const dmy = iso => fmtFechaDMY(String(iso||'').slice(0,10))
  const dm = iso => { const s=String(iso||'').slice(0,10).split('-'); return s[2]?`${s[2]}-${s[1]}`:'' }
  const cIni = n => (n||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()
  const yOf = d => String(d||'').slice(0,4)
  const sgn = d => Number(d.tipo_dte)===61?-1:1
  const billById = useMemo(()=>new Map(billing.map(b=>[String(b.id),b])),[billing])
  const facDe = t => t?.billing_id ? billById.get(String(t.billing_id)) : null
  const tValida = t => { if(!t.billing_id) return true; const b=facDe(t); return !!b && b.status!=='Anulada' && !b.deleted_at }
  const tercDe = id => terceros.filter(t=>String(t.proveedor_id)===String(id)&&tValida(t))
  const est = t => estadoComision(t, facDe(t))
  // Saldo de una comisión en COSTO (bruto si emite boleta) y en lo que falta TRANSFERIRLE (líquido). Los aportes son plata del banco (líquido).
  const ratioT = t => { const p=pagarT(t); return p>0 ? (Number(t.monto)||0)/p : 1 }
  const saldoT = t => est(t)==='pagada' ? 0 : Math.max(0,(Number(t.monto)||0)-Math.round(aporteDe(t.id)*ratioT(t)))   // lo que falta pagarle de esa comisión (costo)
  const saldoPag = t => est(t)==='pagada' ? 0 : Math.max(0,pagarT(t)-aporteDe(t.id))   // lo que falta TRANSFERIRLE (calce con el banco)
  const venceT = t => String(facDe(t)?.due||facDe(t)?.issued_at||'9')
  const pagoCli = t => { const b=facDe(t); if(!b) return null; const a=abonoCli[String(b.id)]; if(a) return {fecha:a.fecha,mov:a.mov}
    if(b.status==='Anticipada'){ const an=(anticipos||[]).find(x=>String(x.id)===String(b.prepaid_anticipo_id)); return an?{fecha:String(an.fecha).slice(0,10),mov:null,anticipo:true}:null }
    return b.status==='Pagado'&&b.paid_at ? {fecha:String(b.paid_at).slice(0,10),mov:null} : null }
  const sumM = a => a.reduce((s,t)=>s+(Number(t.monto)||0),0)
  // Aportes parciales (una comisión pagada en varias transferencias: p. ej. el tope de la 1ª transferencia a una cuenta nueva).
  // learnings pago_prov_aporte: key = movimiento, value = {asig:[{t,monto}]} (formato antiguo {t:[ids],monto} → al primero).
  const aporteAsig = useMemo(()=>{ const o={}; Object.entries(aportes).forEach(([mid,v])=>{ o[mid]=Array.isArray(v?.asig)?v.asig:(v?.t||[]).map((t,i)=>({t,monto:i===0?(Number(v?.monto)||0):0})) }); return o },[aportes])
  const aporteDe = tid => Object.values(aporteAsig).flat().filter(a=>String(a.t)===String(tid)).reduce((s,a)=>s+(Number(a.monto)||0),0)
  // Cómo paga un cliente (para no mezclar la bolsa: unos pagan al día y otros no): vencidas hoy o atraso promedio de sus últimos pagos.
  const comoPaga = cid => { if(!cid) return null
    const bs=billing.filter(b=>String(b.client_id)===String(cid)&&!b.deleted_at&&b.status!=='Anulada'&&b.billing_type!=='reembolso'&&b.invoice_no)
    const venc=bs.filter(b=>b.status==='Vencido'||(b.status!=='Pagado'&&b.due&&String(b.due).slice(0,10)<hoyISO)), vencM=venc.reduce((s,b)=>s+saldoBill(b),0)
    const pag=bs.filter(b=>b.status==='Pagado'&&b.due&&b.paid_at).sort((a,b)=>String(b.paid_at).localeCompare(String(a.paid_at))).slice(0,12)
    const atraso=pag.length?Math.round(pag.reduce((s,b)=>s+Math.max(0,_diasEntre(b.due,b.paid_at)||0),0)/pag.length):null
    if(venc.length) return {tono:'rev',txt:`${venc.length===1?'1 factura vencida':`${venc.length} facturas vencidas`} · ${fmtShort(vencM)}`}
    if(atraso!=null&&atraso>7) return {tono:'pp',txt:`paga ~${atraso} días después del vencimiento`}
    if(atraso!=null) return {tono:'pg',txt:'paga al día'}
    return {tono:'dev',txt:'sin pagos aún'} }
  // Trabajo de una comisión: la venta (de la comisión o de su factura); si no hay, las facturas a ese cliente.
  const ventaDe = t => { const sid=t.sale_id||facDe(t)?.sale_id; return sid ? sales.find(s=>String(s.id)===String(sid)) : null }
  const cliDe = t => { const s=ventaDe(t); const b=facDe(t); return clients.find(c=>String(c.id)===String(s?.client_id||b?.client_id)) }
  const trabajoDe = t => { const s=ventaDe(t); if(s) return {k:'s:'+s.id,titulo:s.title||'Venta',sale:s,cli:clients.find(c=>String(c.id)===String(s.client_id))}
    const c=cliDe(t); return c ? {k:'c:'+c.id,titulo:`Facturas a ${c.name}`,sale:null,cli:c} : {k:'x',titulo:'Sin trabajo asignado',sale:null,cli:null} }
  // Estado legible de una cuota (con su acción y su tono).
  const cuotaInfo = t => { const b=facDe(t), e=est(t), pc=pagoCli(t)
    if(e==='pagada'){ const dd=pc?_diasEntre(pc.fecha,t.pagado_at):null; return {tono:'pg',txt:dd!=null&&dd>=0?`pagada · ${dd} día${dd===1?'':'s'} después`:'pagada'} }
    if(e==='por_pagar'){ const d=_diasDesde(pc?.fecha), ap=aporteDe(t.id); if(ap>0) return {tono:'pp',txt:`pago parcial ${fmt(ap)} · falta ${fmt(Math.max(0,(Number(t.monto)||0)-ap))}`}; return {tono:t.estado!=='por_pagar'?'rev':'pp',txt:(t.estado!=='por_pagar'?'el cliente pagó · la comisión no avanzó':'por pagar')+(d!=null?` · hace ${nDias(d)}`:'')} }
    if(!b) return {tono:'rev',txt:'sin cuota del cliente'}
    if(b.status==='Programada'){ const d=_diasDesde(b.due); return d!=null&&d>0 ? {tono:'rev',txt:`por facturar · venció hace ${nDias(d)}`} : {tono:'dev',txt:'sujeto a cobro'} }
    if(b.status==='Vencido'){ const d=_diasDesde(b.due); return {tono:'rev',txt:`factura vencida${d!=null?` · hace ${nDias(d)}`:''}`} }
    return {tono:'dev',txt:b.due?`facturada · vence ${dm(b.due)}`:'facturada'} }
  const TONO = {pg:[C.greenBg,C.greenText],pp:[C.soonBg,C.soonText],dev:[C.bgSoft,C.muted],rev:[C.overdueBg,C.overdueText]}
  // Trabajos de una lista de comisiones (agrupa, ordena cuotas por vencimiento y arma la línea de seguimiento).
  const trabajosDe = ts => { const g={}
    ts.forEach(t=>{ const w=trabajoDe(t); const k=w.k+'|'+t.proveedor_id; if(!g[k]) g[k]={...w,key:k,prov:proveedores.find(p=>String(p.id)===String(t.proveedor_id)),ts:[]}; g[k].ts.push(t) })
    return Object.values(g).map(w=>{ w.ts.sort((a,b)=>String(facDe(a)?.due||facDe(a)?.issued_at||'9').localeCompare(String(facDe(b)?.due||facDe(b)?.issued_at||'9')))
      const by=e=>w.ts.filter(t=>est(t)===e)
      w.total=sumM(w.ts); w.pagada=sumM(by('pagada')); w.porPagar=sumM(by('por_pagar')); w.porDevengar=sumM(by('por_devengar'))
      w.nPag=by('pagada').length
      const desf=w.ts.filter(t=>est(t)==='por_pagar'&&t.estado!=='por_pagar'), pp=by('por_pagar'), sinC=w.ts.filter(t=>!t.billing_id&&est(t)!=='pagada')
      const progV=w.ts.filter(t=>est(t)==='por_devengar'&&facDe(t)?.status==='Programada'&&String(facDe(t)?.due||'9')<hoyISO)
      const venc=w.ts.filter(t=>est(t)==='por_devengar'&&facDe(t)?.status==='Vencido')
      const prox=w.ts.filter(t=>est(t)==='por_devengar'&&facDe(t)).map(t=>facDe(t)).filter(b=>String(b.due||'')>=hoyISO).sort((a,b)=>String(a.due).localeCompare(String(b.due)))[0]
      const ultPag=by('pagada').map(t=>t.pagado_at).filter(Boolean).sort().pop()
      const fcli=xs=>xs.map(t=>pagoCli(t)?.fecha).filter(Boolean).sort()[0]
      w.rev = desf.length>0||sinC.length>0||progV.length>0||venc.length>0
      w.seg = desf.length ? {tono:'rev',txt:`el cliente pagó el ${dm(fcli(desf))} · la comisión no avanzó`,t:desf[0]}
        : pp.length ? {tono:'pp',txt:`el cliente pagó el ${dm(fcli(pp))}`,t:pp[0],pagar:true}
        : sinC.length ? {tono:'rev',txt:'sin cuota del cliente'}
        : progV.length ? {tono:'rev',txt:`${progV.length} cuota${progV.length!==1?'s':''} sin facturar · ${progV.length>1?'la 1ª ':''}vencía el ${dm(facDe(progV[0])?.due)}`,t:progV[0]}
        : venc.length ? {tono:'rev',txt:`${venc.length} factura${venc.length!==1?'s':''} vencida${venc.length!==1?'s':''} · ${venc.length>1?'la más antigua ':''}venció el ${dm(facDe(venc[0])?.due)}`,t:venc[0]}
        : prox ? {tono:'dev',txt:prox.invoice_no?`factura ${folioN(prox.invoice_no)} vence el ${dm(prox.due)}`:`próxima cuota ${dm(prox.due)}`,b:prox}
        : w.porDevengar>0 ? {tono:'dev',txt:'sujeto a cobro'}
        : {tono:'pg',txt:ultPag?`${w.ts.length>1?'última pagada':'pagada'} el ${dm(ultPag)}`:'pagada'}
      return w }).sort((a,b)=>(b.porPagar-a.porPagar)||(Number(b.rev)-Number(a.rev))||(b.porDevengar-a.porDevengar)||(b.total-a.total)) }

  // Clasificación de un cargo del banco a un RUT de proveedor: comisión enlazada · pago a proveedor · sin clasificar · otro (sueldo, bono, caja chica: no se muestra).
  const concDe = mid => concs.filter(c=>String(c.movimiento_id)===String(mid))
  const esEquipo = id => { const p=proveedores.find(x=>String(x.id)===String(id)); const r=_nRut(p?.rut); return cargos.some(m=>_nRut(m.rut_contraparte)===r&&(m.categoria==='Equipo'||concDe(m.id).some(c=>['Sueldos','Bono'].includes(gastosCat[c.gasto_id]?.category)))) }
  const claseCargo = (m, equipo) => { const cs=concDe(m.id)
    if(cs.some(c=>c.tipo_destino==='devolucion')) return 'otro'   // cargo que el proveedor devolvió (pago doble): no es pago ni comisión
    if(cs.some(c=>c.tipo_destino==='tercero')||terceros.some(t=>String(t.movimiento_id)===String(m.id))) return 'comision'
    const g=cs.map(c=>gastosCat[c.gasto_id]).find(Boolean)
    if(g&&['Sueldos','Bono'].includes(g.category)) return 'otro'
    if(g&&(g.category==='Proveedores'||g.subcategory==='Comisiones')) return 'proveedor'
    if(['Proveedor','Comisiones'].includes(m.categoria)) return 'proveedor'
    if(_CAT_NO_PROV.includes(m.categoria)) return 'otro'
    if(!m.categoria&&!cs.length) return equipo?'otro':'sinclas'
    return 'otro' }
  const cargosDe = id => { const p=proveedores.find(x=>String(x.id)===String(id)); const r=_nRut(p?.rut); if(!r) return []; const eq=esEquipo(id); return cargos.filter(m=>_nRut(m.rut_contraparte)===r).map(m=>({...m,_cl:claseCargo(m,eq)})).filter(m=>m._cl!=='otro') }
  const docsDe = id => docs.filter(d=>String(d.proveedor_id)===String(id))
  const clienteDe = p => p?.client_id ? clients.find(c=>String(c.id)===String(p.client_id)) : null
  const factQueTePaga = p => p?.client_id ? billing.filter(b=>String(b.client_id)===String(p.client_id)&&['honorarios','comision'].includes(tipoFactura(b))&&!b.deleted_at&&b.status!=='Anulada') : []
  // Métricas por proveedor. Comisión/Pagada/Por pagar/Sujeto a cobro = saldo vivo; Pagadas del año y transferido = año del filtro.
  const met = p => { const ts=tercDe(p.id), by=e=>ts.filter(t=>est(t)===e)
    const reten=ts.filter(t=>Number(t.comision_monto)>0)
    const retCob=reten.filter(t=>facDe(t)?.status==='Pagado').reduce((s,t)=>s+(Number(t.comision_monto)||0),0)
    const retPend=reten.filter(t=>facDe(t)?.status!=='Pagado').reduce((s,t)=>s+(Number(t.comision_monto)||0),0)
    const fPag=factQueTePaga(p).filter(b=>b.status==='Pagado').reduce((s,b)=>s+(Number(b.amount)||0),0)
    const cs=cargosDe(p.id).filter(m=>yOf(m.fecha)===yr)
    const pagadasAnio=sumM(by('pagada').filter(t=>yOf(t.pagado_at||t.created_at)===yr))
    const equipo=esEquipo(p.id)
    const pp=by('por_pagar'), masAnt=pp.map(t=>pagoCli(t)?.fecha).filter(Boolean).sort()[0], ca=comisionesACobrar(p,terceros,billing,yr)
    return {porCobrarTe:ca.porCobrar, cobAnioTe:ca.cobradasAnio, caItems:ca.items, total:sumM(ts),pagada:sumM(by('pagada')),porPagar:pp.reduce((a,t)=>a+saldoT(t),0),porDevengar:by('por_devengar').reduce((a,t)=>a+saldoT(t),0),nPorPagar:pp.length,masAnt,
      trabajos:new Set(ts.map(t=>trabajoDe(t).k)).size, aFavor:retCob+fPag, retPend, retCob, fPag, pagadasAnio,
      transferido: equipo ? pagadasAnio : sumM(cs.filter(m=>m._cl!=='sinclas')), sinClas:sumM(cs.filter(m=>m._cl==='sinclas')), nSinClas:cs.filter(m=>m._cl==='sinclas').length,
      facturo:docsDe(p.id).filter(d=>yOf(d.fecha_emision)===yr).reduce((s,d)=>s+sgn(d)*(Number(d.monto)||0),0), equipo,
      les:ts.length>0||cargosDe(p.id).length>0, te:reten.length>0||factQueTePaga(p).length>0} }
  // Calces exactos y ÚNICOS, SIEMPRE dentro de un mismo cliente (no se mezcla la bolsa): (a) un pago ↔ una comisión por pagar,
  // (b) 2–3 transferencias del mismo proveedor en ≤10 días ↔ una comisión o todas las por pagar de un cliente (la 1ª transferencia
  // a una cuenta nueva tiene tope), (c) un pago ↔ una factura del SII. Se compara contra el SALDO (descontados aportes parciales). Lo ambiguo no entra.
  const calces = useMemo(()=>{ const out=[]
    proveedores.forEach(p=>{ const cs=cargosDe(p.id)
      const xp=tercDe(p.id).filter(t=>est(t)==='por_pagar'&&saldoPag(t)>0)
      // A quien es del equipo (sueldo/caja) y además cobra comisiones, sus transferencias quedan en "Equipo" o sin categoría: también se
      // prueban, solo para el calce exacto y único con sus comisiones (un sueldo nunca calza con una comisión).
      const r0=_nRut(p.rut), deEquipo = xp.length ? cargos.filter(m=>_nRut(m.rut_contraparte)===r0&&!(Number(m.monto_conciliado)>0)&&!concDe(m.id).length&&(!m.categoria||m.categoria==='Equipo')&&!cs.some(x=>x.id===m.id)).map(m=>({...m,_cl:'sinclas'})) : []
      const libres=[...cs,...deEquipo].filter(m=>(m._cl==='sinclas'||(m._cl==='proveedor'&&!(Number(m.monto_conciliado)>0)))&&!aporteAsig[m.id]).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha)))
      const amt=m=>Math.abs(Number(m.monto)||0)
      const usados=new Set()
      libres.forEach(m=>{ const a=amt(m); const ts=xp.filter(t=>Math.abs(saldoPag(t)-a)<=1); if(ts.length!==1) return; if(libres.filter(o=>Math.abs(amt(o)-a)<=1).length!==1) return
        usados.add(m.id); out.push({k:'c:'+m.id,tipo:'com',prov:p,m,ms:[m],t:ts[0],ts:[ts[0]]}) })
      // combos por cliente
      const porCli={}; xp.forEach(t=>{ const k=String(cliDe(t)?.id||'x'); (porCli[k]=porCli[k]||[]).push(t) })
      const targets=[]; Object.values(porCli).forEach(g=>{ g.forEach(t=>targets.push([t])); if(g.length>1) targets.push(g) })
      const L=libres.filter(m=>!usados.has(m.id)), wins=[]
      for(let i=0;i<L.length;i++) for(let n=1;n<=3&&i+n<=L.length;n++){ const w=L.slice(i,i+n); if(n>1&&(_diasEntre(w[0].fecha,w[n-1].fecha)||0)>10) break; wins.push(w) }
      const hits=[]; targets.forEach(ts=>{ const sum=ts.reduce((s,t)=>s+saldoPag(t),0); wins.forEach(w=>{ if(w.length===1&&ts.length===1) return; if(Math.abs(w.reduce((s,m)=>s+amt(m),0)-sum)<=1) hits.push({ts,w}) }) })
      hits.forEach(h=>{ const mismoT=hits.filter(x=>x.ts===h.ts).length, mismaW=hits.filter(x=>x.w===h.w).length; if(mismoT!==1||mismaW!==1) return
        if(h.w.some(m=>usados.has(m.id))) return; h.w.forEach(m=>usados.add(m.id))
        out.push({k:'x:'+h.w.map(m=>m.id).join('+'),tipo:'combo',prov:p,ms:h.w,m:h.w[h.w.length-1],ts:h.ts,t:h.ts[0]}) })
      calcesCompraPago(docsDe(p.id), cs).forEach(({d,m})=>out.push({k:'d:'+d.id,tipo:'sii',prov:p,m,d})) })
    return out.sort((a,b)=>String(b.m.fecha).localeCompare(String(a.m.fecha)))
  },[proveedores,cargos,docs,terceros,concs,gastosCat,billing,aporteAsig])
  const calceDeCargo = mid => calces.find(c=>c.tipo!=='sii'&&(c.ms||[c.m]).some(m=>String(m.id)===String(mid)))
  const calceDeDoc = did => calces.find(c=>c.tipo==='sii'&&String(c.d.id)===String(did))
  // TRAZABILIDAD: un pago al proveedor debe quedar enlazado a las comisiones que paga o a la factura que salda. Lo previo a la app
  // (antes de APP_DESDE) es histórico: se puede enlazar, pero no se marca como pendiente. Al equipo (sueldo) no se le exige.
  const APP_DESDE='2026-06-01'
  const pagoLibre = m => (m._cl==='proveedor'||m._cl==='sinclas') && !aportes[m.id] && !terceros.some(t=>String(t.movimiento_id)===String(m.id)) && !docs.some(d=>String(d.movimiento_id)===String(m.id))
  const pagosLibresDe = id => cargosDe(id).filter(pagoLibre)
  const pagadasSinBancoDe = id => esEquipo(id) ? [] : tercDe(id).filter(t=>est(t)==='pagada'&&!t.movimiento_id)
  const marcar = async (m, prov, on, silencioso=false) => {
    if(!DEMO){ try{ await supabase.from('learnings').delete().eq('kind','pago_prov_por_identificar').eq('key',String(m.id)); if(on) await supabase.from('learnings').insert({kind:'pago_prov_por_identificar',key:String(m.id),value:'Trabajo por identificar'}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})} }
    setMarcas(p=>{ const n={...p}; if(on) n[m.id]='Trabajo por identificar'; else delete n[m.id]; return n })
    if(!silencioso) logActividad(`proveedores.${prov.id}.marca`,{tabla:'cartola_movimientos',id:m.id,detalle:{title:on?`Pago del ${dm(m.fecha)}: trabajo por identificar`:`Pago del ${dm(m.fecha)}: se quitó la marca`,monto:Math.abs(Number(m.monto)||0)}})
  }
  // FIFO DENTRO DE CADA CLIENTE: cada peso de las transferencias (por fecha) va a la cuota más antigua del cliente; los clientes se
  // atienden uno tras otro (nunca se mezcla la bolsa). Una comisión que se completa queda pagada con la fecha y el movimiento del pago
  // que la completa; lo que aportan los demás pagos queda como aporte (pago_prov_aporte). Si el cargo no estaba conciliado, se concilia
  // (tipo 'tercero') por lo asignado; si ya estaba conciliado (p. ej. como gasto), solo se enlaza.
  const aplicarFIFO = async (prov, ms, ts) => {
    const cliKey=t=>String(cliDe(t)?.id||'x'), cliPrim={}
    ts.forEach(t=>{ const k=cliKey(t); if(!cliPrim[k]||venceT(t)<cliPrim[k]) cliPrim[k]=venceT(t) })
    const tsO=[...ts].sort((a,b)=>cliPrim[cliKey(a)].localeCompare(cliPrim[cliKey(b)])||cliKey(a).localeCompare(cliKey(b))||venceT(a).localeCompare(venceT(b)))
    const msO=[...ms].sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha)))
    const avail=msO.map(m=>Math.abs(Number(m.monto)||0)), alloc=[], completa={}; let mi=0
    for(const t of tsO){ let need=saldoPag(t)
      while(need>0.5&&mi<msO.length){ const take=Math.min(need,avail[mi]); if(take>0){ alloc.push({m:msO[mi],t,monto:Math.round(take)}); need-=take; avail[mi]-=take } if(avail[mi]<=0.5) mi++ }
      if(need<=0.5){ const last=alloc.filter(a=>a.t.id===t.id).pop(); if(last) completa[t.id]=last.m } }
    const fechaDe=m=>String(m.fecha).slice(0,10)
    const descT=t=>alloc.filter(a=>a.t.id===t.id).map(a=>`${dm(a.m.fecha)} ${fmt(a.monto)}`).join(' + ')
    // 1) comisiones completas → pagadas
    for(const [tid,m] of Object.entries(completa)){ const t=ts.find(x=>String(x.id)===String(tid)); const patch={estado:'pagado',pagado_at:fechaDe(m),movimiento_id:m.id,referencia:`Pagada: ${descT(t)}`,...(reajusteBHEPago(t,fechaDe(m))||{})}
      if(!DEMO){ const {error}=await supabase.from('terceros_pagos').update(patch).eq('id',tid); if(error) throw error }
      setTerceros&&setTerceros(p=>p.map(x=>String(x.id)===String(tid)?{...x,...patch}:x)) }
    // 2) aportes (lo que un pago puso en una comisión que NO cerró con ese pago)
    const porMov={}; alloc.forEach(a=>{ if(completa[a.t.id]&&completa[a.t.id].id===a.m.id) return; (porMov[a.m.id]=porMov[a.m.id]||[]).push({t:a.t.id,monto:a.monto}) })
    for(const [mid,asig] of Object.entries(porMov)){ const prev=aporteAsig[mid]||[]; const val={asig:[...prev,...asig]}
      if(!DEMO){ await supabase.from('learnings').delete().eq('kind','pago_prov_aporte').eq('key',String(mid)); const {error}=await supabase.from('learnings').insert({kind:'pago_prov_aporte',key:String(mid),value:JSON.stringify(val)}); if(error) throw error }
      setAportes(p=>({...p,[mid]:val})) }
    // 3) conciliación de los cargos que no lo estaban
    for(const m of msO){ const sum=alloc.filter(a=>a.m.id===m.id).reduce((s,a)=>s+a.monto,0); if(!(sum>0)||Number(m.monto_conciliado)>0) continue
      let cc={id:'demo'+m.id}; const aplicado=sum, estado=(Math.abs(Number(m.monto)||0)-aplicado)<=1?'conciliado':'parcial'
      if(!DEMO){ const r1=await supabase.from('conciliacion').insert({movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:sum,origen:'manual'}).select().single(); if(r1.error) throw r1.error; cc=r1.data
        const {error}=await supabase.from('cartola_movimientos').update({categoria:m.categoria||'Proveedor',monto_conciliado:aplicado,estado}).eq('id',m.id); if(error) throw error }
      setConcs(p=>[...p,{id:cc.id,movimiento_id:m.id,tipo_destino:'tercero',monto_aplicado:sum}]); setCargos(p=>p.map(x=>x.id===m.id?{...x,categoria:x.categoria||'Proveedor',monto_conciliado:aplicado,estado}:x)) }
    const nComp=Object.keys(completa).length, parciales=[...new Set(alloc.map(a=>a.t.id))].filter(id=>!completa[id]).length, sobra=Math.round(avail.reduce((s,x)=>s+Math.max(0,x),0))
    logActividad(`proveedores.${prov.id}.enlace`,{tabla:'cartola_movimientos',id:msO[0]?.id,detalle:{title:`${msO.length===1?'Pago del '+dm(msO[0].fecha):msO.length+' pagos ('+msO.map(m=>dm(m.fecha)).join(' + ')+')'} ↔ ${nComp} pagada${nComp!==1?'s':''}${parciales?` · ${parciales} con pago parcial`:''} (FIFO por cliente)`,monto:msO.reduce((s,m)=>s+Math.abs(Number(m.monto)||0),0)}})
    return {nComp,parciales,sobra}
  }
  // Enlace a mano (lo que no calza exacto): uno o varios pagos ↔ comisiones (FIFO por cliente) y/o facturas del SII.
  const guardarEnlace = async (m, prov, tIds=[], dIds=[], msExtra=[]) => {
    if((!tIds.length&&!dIds.length)||busy) return
    setBusy('enl')
    try{
      const ts=terceros.filter(t=>tIds.includes(t.id)), ms=[m,...msExtra.filter(x=>x.id!==m.id)]
      let r=null
      if(ts.length) r=await aplicarFIFO(prov, ms, ts)
      if(dIds.length){ if(!DEMO){ const {error}=await supabase.from('sii_compras_docs').update({movimiento_id:m.id}).in('id',dIds); if(error) throw error } setDocs(p=>p.map(d=>dIds.includes(d.id)?{...d,movimiento_id:m.id}:d))
        logActividad(`proveedores.${prov.id}.factura`,{tabla:'sii_compras_docs',id:dIds[0],detalle:{title:`Pago del ${dm(m.fecha)} ↔ ${dIds.length===1?'1 factura':dIds.length+' facturas'}`,monto:Math.abs(Number(m.monto)||0)}}) }
      for(const x of ms) if(marcas[x.id]) await marcar(x,prov,false,true)
      const partes=[r?`${r.nComp===1?'1 comisión pagada':`${r.nComp} comisiones pagadas`}${r.parciales?` y ${r.parciales===1?'1 con pago parcial':r.parciales+' con pago parcial'}`:''}`:null, dIds.length?(dIds.length===1?'1 factura':`${dIds.length} facturas`):null].filter(Boolean).join(' · ')
      appAlert(`Quedó enlazado: ${partes}.${r&&r.sobra>1?` Sobran ${fmt(r.sobra)} de ${ms.length===1?'ese pago':'esos pagos'} sin asignar.`:''}`); setEnlP(null); setEnlSel(new Set())
    }catch(e){ appAlert('No se pudo enlazar: '+(e.message||e)) }
    setBusy(null)
  }

  const enlazar = async (lista, silencioso=false) => {
    if(!lista.length||busy) return 0
    setBusy('enl'); let ok=0
    for(const c of lista){
      try{
        if(c.tipo==='com'||c.tipo==='combo'){ await aplicarFIFO(c.prov, c.ms||[c.m], c.ts||[c.t])
        } else {
          if(!DEMO){ const {error}=await supabase.from('sii_compras_docs').update({movimiento_id:c.m.id}).eq('id',c.d.id); if(error) throw error }
          setDocs(p=>p.map(x=>x.id===c.d.id?{...x,movimiento_id:c.m.id}:x))
          logActividad(`proveedores.${c.prov.id}.factura`,{tabla:'sii_compras_docs',id:c.d.id,detalle:{title:`Factura N° ${c.d.folio} ↔ pago del ${dm(c.m.fecha)}`,monto:Math.abs(Number(c.d.monto)||0)}})
        }
        ok++
      }catch(e){ appAlert(`Se enlazaron ${ok} de ${lista.length}. No se pudo enlazar ${c.tipo!=='sii'?'el pago con la comisión':`la factura N° ${c.d.folio}`}: ${e.message||e}`); setBusy(null); setSelEnl(null); return ok }
    }
    setBusy(null); setSelEnl(null)
    if(ok&&!silencioso) appAlert(ok===1?'Quedó enlazado.':`Quedaron enlazados ${ok}.`)
    return ok
  }
  // Conciliación sola: un pago del banco que calza EXACTO y ÚNICO con comisiones por pagar (mismo cliente) se enlaza sin botón
  // (regla "compuerta → aprende → se libera"; lo ambiguo sigue en "Por enlazar"). Cada enlace deja historial y se puede deshacer.
  const autoIntentados = useRef(new Set())
  useEffect(()=>{ if(DEMO||busy) return
    const auto=calces.filter(c=>(c.tipo==='com'||c.tipo==='combo')&&!autoIntentados.current.has(c.k))
    if(!auto.length) return
    auto.forEach(c=>autoIntentados.current.add(c.k))
    enlazar(auto,true)
  },[calces])
  // "Pasar a por pagar": el cliente ya pagó la cuota pero el flag quedó atrás. Compuerta: tú confirmas; deja historial.
  const pasarAPorPagar = async ts => {
    if(!ts.length) return
    if(!(await appConfirm(`${ts.length===1?'Esta comisión':'Estas '+ts.length+' comisiones'} (${fmt(sumM(ts))}) tienen la cuota del cliente pagada. ¿Pasarlas a "por pagar"?`))) return
    const ids=ts.map(t=>t.id)
    if(!DEMO){ const {error}=await supabase.from('terceros_pagos').update({estado:'por_pagar'}).in('id',ids); if(error){ appAlert('No se pudo: '+error.message); return } }
    setTerceros&&setTerceros(p=>p.map(t=>ids.includes(t.id)?{...t,estado:'por_pagar'}:t))
    ts.forEach(t=>logActividad(`proveedores.${t.proveedor_id}.devengar`,{tabla:'terceros_pagos',id:t.id,detalle:{title:`Comisión${facDe(t)?.invoice_no?' factura '+folioN(facDe(t).invoice_no):''} pasa a por pagar`,monto:Number(t.monto)||0}}))
  }
  const desenlazarDoc = async (d, prov) => {
    if(!(await appConfirm(`¿Quitar el enlace de la factura N° ${d.folio} con su pago?`))) return
    if(!DEMO){ const {error}=await supabase.from('sii_compras_docs').update({movimiento_id:null}).eq('id',d.id); if(error){ appAlert('No se pudo: '+error.message); return } }
    setDocs(p=>p.map(x=>x.id===d.id?{...x,movimiento_id:null}:x))
    logActividad(`proveedores.${prov.id}.factura_quitar`,{tabla:'sii_compras_docs',id:d.id,detalle:{title:`Factura N° ${d.folio}`}})
  }

  const anios = [...new Set([...terceros.map(t=>yOf(t.pagado_at)),...docs.map(d=>yOf(d.fecha_emision)),...cargos.map(m=>yOf(m.fecha))].filter(y=>/^\d{4}$/.test(y)))]
  if(!anios.includes(yr)) anios.push(yr)
  anios.sort((a,b)=>b.localeCompare(a))
  const selAnio = <select value={yr} onChange={e=>setYr(e.target.value)} title='Año de lo pagado y transferido' style={{fontSize:12.5,fontWeight:700,color:C.accent,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 8px',background:C.card,outline:'none',cursor:'pointer'}}>{anios.map(y=><option key={y} value={y}>{y}</option>)}</select>
  const sel = proveedores.find(p=>String(p.id)===String(selId))
  const abrirFicha = (id,filtro='todas',cli=null) => { setSelId(String(id)); setView('ficha'); setCf(filtro); setCliF(cli); setNVer(5); setExpT(null); setEvMas(false); setCMas(false); setAsgOpen(false); setRetOpen(false) }
  const abrirNuevo = () => { setF({nombre:'',razon_social:'',rut:'',datos_pago:'',documento:null}); setOkDistinto(false); setCompletarCola([]); setView('form') }
  const abrirEditar = (p,cola=[]) => { setF({id:p.id,nombre:p.nombre||'',razon_social:p.razon_social||'',rut:p.rut||'',datos_pago:p.datos_pago||'',documento:p.documento||null}); setOkDistinto(false); setCompletarCola(cola); setSelId(String(p.id)); setView('form') }
  const abrirBoleta = p => { const sinDoc=tercDe(p.id).filter(t=>est(t)!=='pagada'&&!t.factura_numero); const pp=sinDoc.filter(t=>est(t)==='por_pagar')
    setSelId(String(p.id)); setBol({ids:new Set((pp.length?pp:[]).map(t=>t.id)),numero:'',fecha:hoyISO,monto:''}); setView('boleta') }
  const card = {background:C.card,border:`1px solid ${C.border}`,borderRadius:12}
  const kLbl = {fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}
  const num = {fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}
  const pill = (bg,fg,txt) => <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:bg,color:fg,lineHeight:1.35,display:'inline-block',whiteSpace:'nowrap'}}>{txt}</span>
  const tono = (tn,txt) => pill(TONO[tn][0],TONO[tn][1],txt)
  const link = (txt,on,col=C.azulInfo) => <span onClick={e=>{e.stopPropagation();on&&on()}} style={{fontSize:12,fontWeight:700,color:col,cursor:'pointer',whiteSpace:'nowrap'}}>{txt}</span>
  // Celda tocable de una tabla: abre su contexto (el subrayado suave marca que se puede tocar).
  const celda = (contenido,on,extra={}) => <span onClick={on?e=>{e.stopPropagation();on()}:undefined} className={on?'pv-c':undefined} style={{cursor:on?'pointer':'default',borderRadius:5,...extra}}>{contenido}</span>
  const sub = {textDecoration:'underline',textDecorationColor:C.done,textUnderlineOffset:2}
  const dash = <span style={{color:C.textSoft,fontWeight:500}}>—</span>
  // Comisiones por cobrar: cada factura de donde sale la cifra (retención al cobrar la factura del cliente, o factura que le emitimos).
  const filaCob = (x,prov) => { const b=x.b, cl=clients.find(c=>String(c.id)===String(b.client_id)), st=b.status
  const est = x.cob ? `cobrada ${dmy(b.paid_at||b.issued_at)}` : st==='Vencido' ? 'vencida' : 'por vencer'
  const que = x.tipo==='ret' ? `${Number(x.t.comision_pct)?Number(x.t.comision_pct)+'% ':''}de la factura del cliente` : 'factura que le emitimos'
  return <div key={x.k} onClick={()=>onOpenFactura&&onOpenFactura(b)} className='pv-c' style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
  <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{`Factura N° ${folioN(b.invoice_no)||'—'}`}{x.tipo==='ret'&&cl?' · ':''}{x.tipo==='ret'&&cl&&celda(<span style={sub}>{cl.name}</span>,()=>onOpenClientFicha&&onOpenClientFicha(cl.id))}</div>
    <div style={{fontSize:11,color:C.muted}}>{prov?`${tituloProv(prov)} · `:''}{que} · <span style={{color:!x.cob&&st==='Vencido'?C.overdueText:C.muted}}>{est}</span></div></div>
  <span style={{fontSize:13,fontWeight:700,color:x.cob?C.muted:C.text,...num}}>{fmt(x.monto)}</span></div> }
  const money = (n,col) => n ? <span style={{...num,color:col||C.text}}>{fmt(n)}</span> : dash
  const wrap = ch => <div style={{padding:isDesktop?'16px 26px 48px':'12px 14px 40px',maxWidth:isDesktop?1180:640,margin:'0 auto',display:'flex',flexDirection:'column',gap:12}}>{ch}</div>
  const chips = (opts,val,set) => <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>{opts.map(([k,l])=><span key={k} onClick={()=>set(k)} style={{fontSize:11.5,fontWeight:600,padding:'4px 10px',borderRadius:20,cursor:'pointer',border:`1px solid ${val===k?C.accent:C.border}`,background:val===k?C.azulBg:C.card,color:val===k?C.accent:C.muted,whiteSpace:'nowrap'}}>{l}</span>)}</div>
  const css = <style>{`.pv-c:hover{background:${C.azulBg};box-shadow:0 0 0 2px ${C.azulBg}}`}</style>
  const exportCSV = (nombre, head, rows) => { try{ const esc=c=>{ const s=String(c==null?'':c); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s }
    const csv=[head,...rows].map(r=>r.map(esc).join(';')).join('\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'})); a.download=nombre; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000) }catch(e){ appAlert('No se pudo exportar: '+(e.message||e)) } }

  // ── FORMULARIO ──
  if(view==='form'){
    const provParecidos = f.id ? [] : proveedoresParecidos(f, proveedores)
    const bloqueado = !f.id && provParecidos.length>0 && !okDistinto
    const canSave = f.nombre?.trim() && !bloqueado
    const up=(k,v)=>{ setF(p=>({...p,[k]:v})); if(k!=='datos_pago') setOkDistinto(false) }
    const inp={width:'100%',height:40,border:`1px solid ${C.border}`,borderRadius:9,fontSize:13,padding:'0 11px',color:C.text,background:C.card,outline:'none',boxSizing:'border-box'}
    const guardar = async () => { const d=await onSave(f); if(!d) return
      logActividad(`proveedores.${d.id}.${f.id?'editar':'crear'}`,{tabla:'proveedores',id:d.id,detalle:{title:tituloProv(d)}})
      const resto=completarCola.filter(id=>String(id)!==String(d.id))
      if(resto.length){ const nx=proveedores.find(p=>String(p.id)===String(resto[0])); if(nx){ abrirEditar(nx,resto); return } }
      setCompletarCola([]); setSelId(String(d.id)); setView('ficha') }
    const cola = completarCola.length>1 ? `${completarCola.length} por completar` : null
    return (<div>
      <PageHeader origen={f.id?tituloProv(sel):'Proveedores'} onBack={()=>{setCompletarCola([]);setView(f.id?'ficha':'list')}} titulo={f.id?'Editar proveedor':'Nuevo proveedor'} ctx={cola}/>
      {wrap(<div style={{...card,padding:'14px 16px',display:'flex',flexDirection:'column',gap:12,maxWidth:560}}>
        <div><div style={{...kLbl,marginBottom:5}}>Nombre <span style={{color:C.overdue}}>*</span> · persona de contacto</div><input value={f.nombre} onChange={e=>up('nombre',e.target.value)} placeholder='Ej: Rodrigo Díaz' style={inp}/></div>
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'minmax(0,1.4fr) minmax(0,1fr)':'1fr',gap:12}}>
          <div><div style={{...kLbl,marginBottom:5}}>Razón social</div><input value={f.razon_social} onChange={e=>up('razon_social',e.target.value)} placeholder='Ej: Díaz & Asociados SpA' style={inp}/></div>
          <div><div style={{...kLbl,marginBottom:5}}>RUT</div><input value={f.rut} onChange={e=>up('rut',e.target.value)} placeholder='Ej: 76.123.456-7' style={inp}/></div>
        </div>
        <div><div style={{...kLbl,marginBottom:5}}>Documento que emite</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{[['factura','Factura'],['boleta','Boleta de honorarios']].map(([k,l])=>{ const on=(f.documento||'factura')===k; return <span key={k} onClick={()=>up('documento',k)} style={{fontSize:12,fontWeight:on?700:600,borderRadius:20,padding:'5px 12px',cursor:'pointer',border:`1px solid ${on?C.accent:C.border}`,background:on?C.azulBg:C.card,color:on?C.accent:C.muted}}>{l}</span> })}</div>
          {f.documento==='boleta'&&<div style={{fontSize:11.5,color:C.textSoft,marginTop:5}}>Costo = bruto de la boleta. Se le transfiere el líquido y la retención ({pctBHE(tasaBHE())} en {new Date().getFullYear()}) va al F29.</div>}</div>
        <div><div style={{...kLbl,marginBottom:5}}>Datos de pago · para transferir</div><textarea autoFocus={completarCola.length>0} value={f.datos_pago} onChange={e=>up('datos_pago',e.target.value)} placeholder='Banco, tipo de cuenta, N° de cuenta, RUT, correo…' style={{...inp,height:'auto',minHeight:72,padding:'9px 11px',resize:'vertical',fontFamily:'inherit'}}/></div>
        {provParecidos.length>0&&<div style={{border:`1px solid ${C.soon}`,background:C.soonBg,borderRadius:9,padding:'8px 10px'}}>
          <div style={{fontSize:11.5,fontWeight:700,color:C.soonText,marginBottom:5}}>Ya existe un proveedor parecido. ¿Es alguno de estos?</div>
          {provParecidos.slice(0,5).map(({proveedor:p,tipo})=><div key={p.id} onClick={()=>abrirFicha(p.id)} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 3px',borderTop:`0.5px solid ${C.soon}`,cursor:'pointer'}}><span style={{flex:1,minWidth:0,fontSize:12.5,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tituloProv(p)}{p.rut?<span style={{fontWeight:400,color:C.muted}}> · {fmtRutCL(p.rut)}</span>:''}</span><span style={{fontSize:9.5,fontWeight:700,color:C.soonText,textTransform:'uppercase'}}>{_tipoDupProvLbl(tipo)}</span><span style={{fontSize:11.5,fontWeight:700,color:C.accent}}>Abrir <Gl n='chevron'/></span></div>)}
          <label style={{display:'flex',alignItems:'center',gap:7,marginTop:8,cursor:'pointer'}}><input type='checkbox' checked={okDistinto} onChange={e=>setOkDistinto(e.target.checked)} style={{width:15,height:15,accentColor:C.accent}}/><span style={{fontSize:11.5,color:C.text}}>No es ninguno: es un proveedor distinto</span></label>
        </div>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><ActBtn variant='ghost' size='lg' onClick={()=>{setCompletarCola([]);setView(f.id?'ficha':'list')}}>{completarCola.length>1?'Terminar':'Cancelar'}</ActBtn><ActBtn variant='primary' size='lg' disabled={saving||!canSave} onClick={guardar}>{saving?'Guardando…':completarCola.length>1?'Guardar y seguir':'Guardar'}</ActBtn></div>
      </div>)}
    </div>)
  }

  // ── REGISTRAR BOLETA O FACTURA (página): el proveedor manda su boleta (Martín) o factura; se guarda contra las comisiones que cubre
  // (terceros_pagos.factura_numero/factura_fecha + el archivo) para que al pagar ya esté y la ficha muestre qué boleta respalda cada cuota.
  // Lee la boleta de honorarios del SII (PDF) con IA y completa N°, fecha y bruto si están vacíos. Si falla, se escriben a mano.
  const leerBoletaPdf = async file => { if(DEMO) return; setLeyendoBol(true)
    try{ const b64=await new Promise((res,rej)=>{ const fr=new FileReader(); fr.onloadend=()=>res(String(fr.result||'').split(',')[1]||''); fr.onerror=rej; fr.readAsDataURL(file) })
      const j=await claudeCall({model:'claude-opus-4-8',max_tokens:200,messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}},{type:'text',text:'Es una boleta de honorarios electrónica del SII de Chile. Responde SOLO un JSON {"folio":número,"fecha":"AAAA-MM-DD","bruto":número entero en pesos (Total Honorarios)}. Si un dato no está, null.'}]}]})
      const t=String(j?.content?.[0]?.text||''), m=t.match(/\{[\s\S]*\}/); const o=m?JSON.parse(m[0]):null
      if(o){ const fe=/^\d{4}-\d\d-\d\d$/.test(String(o.fecha||''))?o.fecha:null, br=Math.round(Number(o.bruto)||0)||null, fo=parseInt(o.folio)||null
        setBol(p=>p?({...p, numero:p.numero||(fo?String(fo):''), fecha:fe||p.fecha, monto:p.monto||(br?String(br):''), leida:{folio:fo,fecha:fe,bruto:br}}):p) }
    }catch(_){ } setLeyendoBol(false) }
  if(view==='correoBol'&&sel&&bolMail&&ro){
    const lineas=bolMail.ids.map(id=>terceros.find(t=>t.id===id)).filter(Boolean).map(t=>{ const b=facDe(t), w=trabajoDe(t), c=cliDe(t)
      return {txt:`${c?.name||'Sin cliente'} · ${b?.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:(b?.concept||w.titulo||'Comisión')}`, pago:pagoCli(t)?.fecha||null, monto:pagarT(t)} })
    return <CorreoBoletaPage prov={sel} bm={bolMail} lineas={lineas} user={user} onBack={()=>{setBolMail(null);setView('ficha')}}
      onSent={r=>{ logActividad(`proveedores.${sel.id}.boleta_enviada`,{tabla:'terceros_pagos',id:bolMail.ids[0],detalle:{title:`Boleta N° ${bolMail.folio} enviada a la oficina`,monto:bolMail.liq}}); if(!DEMO&&bolMail.bheId) setLearningKV('boleta_enviada',String(bolMail.bheId),new Date().toISOString()).catch(()=>{})
        appAlert(txtEnviado(r==='oficina'?'oficina':'usuario',{que:'Boleta',g:'a',para:'la oficina'})+' Con la boleta adjunta.'); setBolMail(null); setView('ficha') }}/> }
  if(view==='boleta'&&sel&&bol){
    const ts=tercDe(sel.id).filter(t=>est(t)!=='pagada'&&(!ro||(est(t)==='por_pagar'&&!t.factura_numero))).sort((a,b)=>(est(a)==='por_pagar'?0:1)-(est(b)==='por_pagar'?0:1))
    const elegidas=ts.filter(t=>bol.ids.has(t.id)), total=sumM(elegidas), monto=parseInt(String(bol.monto).replace(/\D/g,''))||0
    const toggle=id=>setBol(p=>{ const n=new Set(p.ids); n.has(id)?n.delete(id):n.add(id); return {...p,ids:n} })
    const inp={width:'100%',height:38,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 10px',color:C.text,background:C.card,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}
    const cb = on => <span style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:C.card,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3'><polyline points='5 12 10 17 19 7'/></svg>}</span>
    // Boleta de honorarios: se ingresa el BRUTO (total honorarios); la app calcula la retención con la tasa del año y el líquido,
    // y lo compara con lo que se le debe transferir por las comisiones elegidas.
    const conBol=esBoletaProv(sel), tasaB=tasaBHE(bol.fecha), retB=Math.round(monto*tasaB), liqB=monto-retB, sumPag=elegidas.reduce((a,t)=>a+pagarT(t),0)
    const dif = monto>0&&elegidas.length ? (conBol ? liqB-sumPag : monto-total) : null
    const guardar = async () => { if(!bol.numero.trim()||!elegidas.length) return; if(conBol&&!(monto>0)){ appAlert('Falta el bruto de la boleta.'); return } setBusy('bol')
      const patch={factura_numero:bol.numero.trim(),factura_fecha:bol.fecha||null}, ids=elegidas.map(t=>t.id)
      const porId={}
      if(conBol){
        const folio=parseInt(String(bol.numero).replace(/\D/g,''))||0, rutN=_nRut(sel.rut).slice(0,-1)
        let storage_path=null
        if(bol.file&&!DEMO){ storage_path=`bhe/${rutN}/BHE_${rutN}_N${String(folio).padStart(4,'0')}.pdf`
          const up=await supabase.storage.from('documentos').upload(storage_path,bol.file,{contentType:'application/pdf',upsert:true}); if(up.error){ setBusy(null); appAlert('No se pudo subir el PDF: '+up.error.message); return } }
        let bheId=null
        if(!DEMO){ const {data:bh,error}=await supabase.from('boletas_honorarios').upsert({proveedor_id:sel.id,emisor_rut:fmtRutCL(sel.rut),emisor_nombre:sel.razon_social||tituloProv(sel),folio,fecha:bol.fecha,bruto:monto,retencion:retB,liquido:liqB,tasa:tasaB,storage_path,created_by:user?.name||null},{onConflict:'emisor_rut,folio'}).select().single()
          if(error){ setBusy(null); appAlert('No se pudo guardar la boleta: '+error.message); return } bheId=bh.id; setBhes(p=>[bh,...p.filter(x=>x.id!==bh.id)]) }
        // El bruto, la retención y el líquido de la boleta se reparten entre las comisiones según lo que se le transfiere por cada una.
        let accB=0, accR=0
        elegidas.forEach((t,i)=>{ const last=i===elegidas.length-1, sh=sumPag>0?pagarT(t)/sumPag:1/elegidas.length
          const b2=last?monto-accB:Math.round(monto*sh), r2=last?retB-accR:Math.round(retB*sh); accB+=b2; accR+=r2
          porId[t.id]={...patch,bhe_id:bheId,monto:b2,retencion:r2,liquido:b2-r2} })
      }
      if(!DEMO){ for(const id of ids){ const {error}=await supabase.from('terceros_pagos').update(porId[id]||patch).eq('id',id); if(error){ setBusy(null); appAlert('No se pudo guardar: '+error.message); return } } }
      setTerceros&&setTerceros(p=>p.map(t=>ids.includes(t.id)?{...t,...(porId[t.id]||patch)}:t))
      logActividad(`proveedores.${sel.id}.boleta`,{tabla:'terceros_pagos',id:ids[0],detalle:{title:`N° ${patch.factura_numero} · ${ids.length} ${ids.length===1?'comisión':'comisiones'}`,monto:monto||total}})
      setBusy(null)
      if(ro){ const sp=conBol?`bhe/${_nRut(sel.rut).slice(0,-1)}/BHE_${_nRut(sel.rut).slice(0,-1)}_N${String(parseInt(String(bol.numero).replace(/\D/g,''))||0).padStart(4,'0')}.pdf`:null
        setBolMail({folio:patch.factura_numero, fecha:bol.fecha, bruto:monto, ret:retB, liq:liqB, ids, file:bol.file||null, storage_path:bol.file?sp:null, bheId:porId[ids[0]]?.bhe_id||null}); setBol(null); setView('correoBol'); return }
      appAlert(`Quedó guardada la boleta N° ${patch.factura_numero} en ${ids.length===1?'1 comisión':ids.length+' comisiones'}.`); setBol(null); setView('ficha') }
    const lista = <div style={{...card,overflow:'hidden'}}>
      <div style={{...kLbl,padding:'10px 14px 6px'}}>¿Qué comisiones cubre?</div>
      {ts.length===0&&<div style={{padding:'12px 14px',fontSize:12.5,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>No tiene comisiones sin pagar.</div>}
      {ts.map(t=>{ const b=facDe(t), cl=cliDe(t), ci=cuotaInfo(t); return <div key={t.id} onClick={()=>toggle(t.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
        {cb(bol.ids.has(t.id))}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b?.invoice_no?`Factura ${folioN(b.invoice_no)}`:trabajoDe(t).titulo}{cl?` · ${cl.name}`:''}</div><div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:2}}>{tono(ci.tono,ci.txt)}{t.factura_numero&&<span style={{fontSize:11,color:C.muted}}>ya tiene N° {t.factura_numero}</span>}</div></div>
        <span style={{fontSize:13,fontWeight:700,...num}}>{fmt(t.monto)}</span></div> })}
      <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontWeight:700}}><span>{elegidas.length} {elegidas.length===1?'comisión':'comisiones'}</span><span style={num}>{fmt(total)}</span></div>
    </div>
    const form = <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{...card,padding:'10px 14px',display:'flex',flexDirection:'column',gap:9}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div><div style={{...kLbl,marginBottom:4}}>N° de boleta o factura</div><input autoFocus value={bol.numero} onChange={e=>setBol(p=>({...p,numero:e.target.value}))} placeholder='Ej: 245' style={inp}/></div>
          <div><div style={{...kLbl,marginBottom:4}}>Fecha</div><input type='date' value={bol.fecha} onChange={e=>setBol(p=>({...p,fecha:e.target.value}))} style={inp}/></div>
        </div>
        <div><div style={{...kLbl,marginBottom:4}}>{conBol?'Bruto de la boleta (total honorarios)':'Monto de la boleta'}</div><input inputMode='numeric' value={bol.monto} onChange={e=>setBol(p=>({...p,monto:e.target.value}))} placeholder='$' style={inp}/>
          {conBol&&monto>0&&<div style={{display:'flex',flexDirection:'column',gap:2,marginTop:6,fontSize:12}}>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Retención {pctBHE(tasaB)} · va al F29{f29BHE(bol.fecha)?` ${f29BHE(bol.fecha).lbl}`:''}</span><span style={num}>{fmt(retB)}</span></div>
            <div style={{display:'flex',justifyContent:'space-between'}}><span style={{color:C.muted}}>Líquido a transferir</span><b style={num}>{fmt(liqB)}</b></div></div>}
          {dif!=null&&<div style={{fontSize:11.5,marginTop:5,color:Math.abs(dif)<=1?C.greenText:C.soonText,fontWeight:600}}>{Math.abs(dif)<=1?'Cuadra con las comisiones elegidas':conBol?`El líquido es ${fmt(Math.abs(dif))} ${dif>0?'más':'menos'} que lo que se le debe por las comisiones elegidas (${fmt(sumPag)})`:`${dif>0?'La boleta es':'Las comisiones son'} ${fmt(Math.abs(dif))} más${dif>0?'':' que la boleta'}`}</div>}</div>
        {conBol&&<div><div style={{...kLbl,marginBottom:4}}>PDF de la boleta</div><input type='file' accept='application/pdf' onChange={e=>{ const fl=e.target.files?.[0]||null; setBol(p=>({...p,file:fl,leida:null})); if(fl) leerBoletaPdf(fl) }} style={{fontSize:12}}/>
          <div style={{fontSize:11,color:leyendoBol?C.muted:bol.leida?C.greenText:C.textSoft,fontWeight:bol.leida?600:400,marginTop:3}}>{leyendoBol?'Leyendo la boleta…':bol.leida?`Leída: N° ${bol.leida.folio||'—'} · ${bol.leida.fecha?fmtFechaDMY(bol.leida.fecha):'—'} · bruto ${bol.leida.bruto?fmt(bol.leida.bruto):'—'}`:'La app lee el N°, la fecha y el bruto. Se guarda con la boleta y se descarga desde cada comisión.'}</div></div>}
        {user&&elegidas[0]&&!conBol&&<div><div style={{...kLbl,marginBottom:4}}>Archivo de la boleta</div><Attachments table='terceros_attachments' idField='terceros_pago_id' entityId={elegidas[0].id} folderKind='facturas' namePrefix={`boleta_${tituloProv(sel)}`} user={user} inline/></div>}
      </div>
      <ActBtn variant='primary' size='lg' full disabled={!bol.numero.trim()||!elegidas.length||busy==='bol'} onClick={guardar}>{busy==='bol'?'Guardando…':ro?'Guardar y continuar al correo':'Guardar'}</ActBtn>
      {!ro&&<div style={{fontSize:11.5,color:C.muted}}>Al pagar, la boleta ya viene escrita. No cambia el estado de las comisiones.</div>}
    </div>
    return (<div>
      <PageHeader origen={ro?'Mis comisiones':tituloProv(sel)} onBack={()=>{setBol(null);setView('ficha')}} titulo={ro?'Registrar boleta':'Registrar boleta o factura'} ctx={isDesktop?(elegidas.length?`${elegidas.length} ${elegidas.length===1?'comisión':'comisiones'} · ${fmt(total)}`:null):null}/>
      {wrap(isDesktop ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.3fr) minmax(0,1fr)',gap:14,alignItems:'start'}}>{lista}{form}</div> : <>{form}{lista}</>)}
    </div>)
  }

  // ── PAGAR (página): qué transferir y a quién. No marca nada: la comisión queda pagada sola al conciliarse la transferencia del banco. ──
  // ── POR ENLAZAR (compuerta: tú confirmas; todo enlace se puede deshacer) ──
  if(view==='enlazar'){
    const marcados = selEnl || new Set(calces.map(c=>c.k))
    const toggle = k => { const n=new Set(marcados); n.has(k)?n.delete(k):n.add(k); setSelEnl(n) }
    const elegidos = calces.filter(c=>marcados.has(c.k))
    const cb = on => <span style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:C.card,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3'><polyline points='5 12 10 17 19 7'/></svg>}</span>
    return (<div>
      <PageHeader origen='Proveedores' onBack={()=>{setSelEnl(null);setView('list')}} titulo='Por enlazar' ctx={`${calces.length} calce${calces.length!==1?'s':''} exacto${calces.length!==1?'s':''} · mismo RUT y monto`}/>
      {wrap(<>
        {calces.length===0 ? <div style={{...card,padding:24,textAlign:'center',color:C.muted,fontSize:13}}>No hay pagos que calcen exacto con una comisión o una factura. Lo demás se enlaza desde la ficha de cada proveedor.</div> : <>
        <div style={{...card,overflow:'hidden'}}>
          {isDesktop&&<div style={{display:'grid',gridTemplateColumns:'26px 92px minmax(0,.9fr) minmax(0,1.5fr) 120px 80px',columnGap:12,padding:'8px 14px',background:C.bgSoft,...kLbl,fontSize:9.5}}><span/><span>Pago</span><span>Proveedor</span><span>Se enlaza con</span><span style={{textAlign:'right'}}>Monto</span><span/></div>}
          {calces.map(c=>{ const on=marcados.has(c.k); const esCom=c.tipo!=='sii'; const cl=esCom?cliDe(c.t):null; const tsC=c.ts||[c.t]; const que=esCom?`${tsC.length>1?`${tsC.length} comisiones`:`Comisión${facDe(c.t)?.invoice_no?' · factura '+folioN(facDe(c.t).invoice_no):''}`}${cl?' · '+cl.name:''}${(c.ms||[]).length>1?` · ${c.ms.length} transferencias (${c.ms.map(m=>dm(m.fecha)).join(' + ')})`:''}`:`Su factura N° ${c.d.folio} · ${dmy(c.d.fecha_emision)}`; const monto=(c.ms||[c.m]).reduce((a,m)=>a+Math.abs(Number(m.monto)||0),0)
            return isDesktop
              ? <div key={c.k} onClick={()=>toggle(c.k)} style={{display:'grid',gridTemplateColumns:'26px 92px minmax(0,.9fr) minmax(0,1.5fr) 120px 80px',columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5,cursor:'pointer'}}>
                  {cb(on)}<span style={{color:C.muted,...num}}>{dmy(c.m.fecha)}</span>{celda(<span style={{fontWeight:700,color:C.accent,...sub}}>{tituloProv(c.prov)}</span>,()=>abrirFicha(c.prov.id),{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}
                  <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{que} <span style={{color:C.muted}}>· {esCom?((c.ms||[]).length>1?'pago en partes':'comisión'):'factura del SII'}</span></span>
                  <span style={{textAlign:'right',fontWeight:700,...num}}>{fmt(monto)}</span><span style={{textAlign:'right'}}>{link('ver pago ›',()=>onIrBanco&&onIrBanco(c.m.id))}</span></div>
              : <div key={c.k} onClick={()=>toggle(c.k)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
                  {cb(on)}<div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{tituloProv(c.prov)}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{dm(c.m.fecha)} · {que}</div></div>
                  <span style={{fontSize:13,fontWeight:700,...num}}>{fmt(monto)}</span></div> })}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
          <ActBtn variant='ghost' size='lg' onClick={()=>{setSelEnl(null);setView('list')}}>Ahora no</ActBtn>
          <ActBtn variant='primary' size='lg' full={!isDesktop} disabled={!elegidos.length||!!busy} onClick={async()=>{ const n=await enlazar(elegidos); if(n) setView('list') }}>{busy?'Enlazando…':`Enlazar ${elegidos.length} seleccionado${elegidos.length!==1?'s':''}`}</ActBtn>
        </div>
        <div style={{fontSize:11.5,color:C.muted}}>Solo calces únicos y dentro de un mismo cliente: un pago, o 2–3 transferencias en 10 días (la primera a una cuenta nueva tiene tope), que suman exacto una comisión o lo por pagar de un cliente. La comisión queda pagada en la fecha del pago que la completa.</div>
        </>}
      </>)}
    </div>)
  }

  // ── FICHA ──
  if(view==='ficha'&&sel){
    const m0=met(sel), ts=tercDe(sel.id), dsAll=docsDe(sel.id), csAll=cargosDe(sel.id), cli=clienteDe(sel), fq=factQueTePaga(sel)
    const conBolF = esBoletaProv(sel)   // emite boleta de honorarios: costo bruto · retención · líquido
    const ws=trabajosDe(ts)
    // Por cliente: la bolsa de comisiones separada por cliente (unos pagan al día y otros no).
    const porCliente = (()=>{ const g={}; ts.forEach(t=>{ const c=cliDe(t); const k=String(c?.id||'x'); (g[k]=g[k]||{k,cli:c,ts:[]}).ts.push(t) })
      return Object.values(g).map(x=>({...x,porPagar:x.ts.filter(t=>est(t)==='por_pagar').reduce((a,t)=>a+saldoT(t),0),porDevengar:sumM(x.ts.filter(t=>est(t)==='por_devengar')),pagada:sumM(x.ts.filter(t=>est(t)==='pagada')),cp:comoPaga(x.cli?.id)}))
        .sort((a,b)=>(b.porPagar-a.porPagar)||(b.porDevengar-a.porDevengar)) })()
    const ln = (l,v) => <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,padding:'5px 0',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5}}><span style={{color:C.muted,flexShrink:0}}>{l}</span><span style={{minWidth:0,textAlign:'right',color:C.text,fontWeight:600}}>{v}</span></div>
    const datos = <div style={{...card,padding:'10px 14px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}><span style={kLbl}>Datos</span>{!isDesktop&&link('Editar',()=>abrirEditar(sel))}</div>
      {ln('RUT',sel.rut?<Copyable text={sel.rut}>{fmtRutCL(sel.rut)}</Copyable>:link('+ agregar',()=>abrirEditar(sel)))}
      {sel.razon_social&&ln('Razón social',sel.razon_social)}
      {sel.datos_pago?.trim()
        ? <div style={{padding:'6px 0',borderTop:`1px solid ${C.bgSoft}`}}><div style={{display:'flex',justifyContent:'space-between',fontSize:12.5}}><span style={{color:C.muted}}>Datos de pago</span><Copyable text={sel.datos_pago}><span style={{fontSize:11.5,fontWeight:700,color:C.azulInfo}}>Copiar</span></Copyable></div><div style={{fontSize:12,color:C.text,whiteSpace:'pre-wrap',lineHeight:1.45,marginTop:3}}>{sel.datos_pago}</div></div>
        : ln('Datos de pago',link('+ agregar',()=>abrirEditar(sel)))}
      {ln('Relación',[m0.equipo?'Equipo':null,m0.les?'Le pagas comisión':null,m0.te?'Te paga comisión':null].filter(Boolean).join(' · ')||'Sin comisiones aún')}
      {cli&&ln('También es cliente',link(cli.name+' ›',()=>onOpenClientFicha&&onOpenClientFicha(cli.id)))}
    </div>
    const cobPend = m0.caItems.filter(x=>!x.cob), cobAnio = m0.caItems.filter(x=>x.cob&&String(x.b.paid_at||x.b.issued_at||'').slice(0,4)===String(yr))
    const aFavor = m0.caItems.length ? <div style={{...card,overflow:'hidden'}}>
      <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px 6px'}}><span style={kLbl}>Por cobrar</span><b style={{fontSize:13,...num}}>{fmt(m0.porCobrarTe)}</b></div>
      {cobPend.length?cobPend.map(x=>filaCob(x)):<div style={{padding:'8px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Nada por cobrar</div>}
      <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px 6px',borderTop:`1px solid ${C.border}`}}><span style={kLbl}>Cobradas {yr}</span><b style={{fontSize:13,...num}}>{fmt(m0.cobAnioTe)}</b></div>
      {cobAnio.length?cobAnio.map(x=>filaCob(x)):<div style={{padding:'8px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Ninguna en {yr}</div>}
    </div> : null
    const hayCuadre = m0.facturo!==0||m0.transferido>0||m0.sinClas>0
    const cuadre = (hayCuadre&&!m0.equipo) ? <div style={{...card,overflow:'hidden'}}>
      <div style={{...kLbl,padding:'10px 14px 4px'}}>Cuadre {yr}</div>
      {[['Facturas que te emitió (SII)',m0.facturo,`${dsAll.filter(d=>yOf(d.fecha_emision)===yr).length} documentos`],['Le transferiste',m0.transferido+m0.sinClas,m0.nSinClas?`incluye ${fmt(m0.sinClas)} sin clasificar`:'pagos del banco'],['Diferencia',m0.facturo-(m0.transferido+m0.sinClas),'ver facturas y pagos']].map(([l,v,s2],i)=>
        <div key={l} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderTop:`1px solid ${C.bgSoft}`,background:i===2?C.bgSoft:'transparent'}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600}}>{l}</div><div style={{fontSize:11,color:C.muted}}>{s2}</div></div><span style={{fontSize:13.5,fontWeight:800,color:i===2?C.muted:C.text,...num}}>{v<0?'−'+fmt(-v):fmt(v)}</span></div>)}
    </div> : null
    // Comisiones por trabajo y por cuota.
    const CF = 'minmax(0,1.1fr) 92px 100px 112px 100px minmax(170px,1.2fr)'
    // Enlace a mano (panel bajo la fila): un pago → comisiones/facturas · una comisión pagada → su pago · una factura del SII → su pago.
    const cbx = on => <span style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${on?C.accent:C.done}`,background:on?C.accent:C.card,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3'><polyline points='5 12 10 17 19 7'/></svg>}</span>
    const togSel = k => setEnlSel(p=>{ const n=new Set(p); n.has(k)?n.delete(k):n.add(k); return n })
    const unoSel = k => setEnlSel(new Set([k]))
    const cerrarEnl = () => { setEnlP(null); setEnlSel(new Set()) }
    const opt = (k,txt,sub2,monto,onTog) => <div key={k} onClick={onTog} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>{cbx(enlSel.has(k))}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{txt}</div>{sub2&&<div style={{fontSize:11,color:C.muted}}>{sub2}</div>}</div><span style={{fontSize:12.5,fontWeight:700,...num}}>{fmt(monto)}</span></div>
    const caja = (titulo, items, pie) => <div onClick={e=>e.stopPropagation()} style={{margin:'2px 14px 10px',border:`1px solid ${C.accent}`,borderRadius:10,overflow:'hidden',background:C.card}}>
      <div style={{padding:'8px 12px',fontSize:12,fontWeight:700,color:C.accent,background:C.azulBg}}>{titulo}</div>{items}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'8px 12px',borderTop:`1px solid ${C.bgSoft}`}}>{pie}</div></div>
    const vacio = txt => <div style={{padding:'10px 12px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>{txt}</div>
    const panelEnlace = () => { if(!enlP) return null
      if(enlP.mid){ const m=csAll.find(x=>String(x.id)===String(enlP.mid)); if(!m) return null
        const cand=ts.filter(t=>est(t)!=='pagada'||!t.movimiento_id).filter(t=>saldoT(t)>0||(est(t)==='pagada'&&!t.movimiento_id)), dsC=dsAll.filter(d=>!d.movimiento_id&&Number(d.tipo_dte)!==61)
        const otros=pagosLibresDe(sel.id).filter(x=>x.id!==m.id&&Math.abs(_diasEntre(m.fecha,x.fecha)||0)<=20)
        const tSel=cand.filter(t=>enlSel.has('t:'+t.id)), dSel=dsC.filter(d=>enlSel.has('d:'+d.id)), mSel=otros.filter(x=>enlSel.has('m:'+x.id))
        const mm=Math.abs(Number(m.monto)||0)+mSel.reduce((a,x)=>a+Math.abs(Number(x.monto)||0),0)
        const pendT=t=>est(t)==='pagada'?pagarT(t):saldoPag(t), dif=tSel.length?mm-tSel.reduce((a,t)=>a+pendT(t),0):null
        const grupos={}; cand.forEach(t=>{ const c=cliDe(t); const k=String(c?.id||'x'); (grupos[k]=grupos[k]||{cli:c,ts:[]}).ts.push(t) })
        const nClis=new Set(tSel.map(t=>String(cliDe(t)?.id||'x'))).size
        return caja(`¿Qué pagó la transferencia del ${dmy(m.fecha)} por ${fmt(Math.abs(Number(m.monto)||0))}?`, <>
          {cand.length===0&&dsC.length===0&&vacio('No hay comisiones ni facturas sin pago para enlazar.')}
          {Object.values(grupos).map(g=>{ const cp=comoPaga(g.cli?.id); return <div key={g.cli?.id||'x'}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 12px',background:C.bgSoft,borderTop:`1px solid ${C.border}`,fontSize:11.5,fontWeight:700,color:C.accent,flexWrap:'wrap'}}>{g.cli?.name||'Sin cliente'}{cp&&tono(cp.tono,cp.txt)}</div>
            {g.ts.sort((a,b)=>venceT(a).localeCompare(venceT(b))).map(t=>{ const b=facDe(t); return opt('t:'+t.id,`Comisión · ${b?.invoice_no?'factura '+folioN(b.invoice_no):trabajoDe(t).titulo}`,cuotaInfo(t).txt,pendT(t),()=>togSel('t:'+t.id)) })}</div> })}
          {dsC.map(d=>opt('d:'+d.id,`Su factura N° ${d.folio}`,`SII · ${dmy(d.fecha_emision)}`,Math.abs(Number(d.monto)||0),()=>togSel('d:'+d.id)))}
          {otros.length>0&&<><div style={{padding:'6px 12px',background:C.bgSoft,borderTop:`1px solid ${C.border}`,fontSize:11.5,fontWeight:700,color:C.muted}}>Otras transferencias cercanas (si se pagó en partes)</div>
            {otros.map(x=>opt('m:'+x.id,`Pago del ${dmy(x.fecha)}`,marcas[x.id]?'trabajo por identificar':'sin enlazar',Math.abs(Number(x.monto)||0),()=>togSel('m:'+x.id)))}</>}
        </>, <>
          {dif!=null&&<span style={{fontSize:11.5,fontWeight:600,color:Math.abs(dif)<=1?C.greenText:C.soonText,flex:'1 1 220px'}}>{Math.abs(dif)<=1?'Cuadra':dif>0?`Sobran ${fmt(dif)} del pago`:`Falta ${fmt(-dif)}: la comisión más nueva queda con pago parcial`}{nClis>1?' · se asigna cliente por cliente (FIFO)':''}</span>}
          <ActBtn variant='primary' disabled={(!tSel.length&&!dSel.length)||!!busy} onClick={()=>guardarEnlace(m,sel,tSel.map(t=>t.id),dSel.map(d=>d.id),mSel)}>{busy==='enl'?'Enlazando…':'Enlazar'}</ActBtn>
          <ActBtn variant='ghost' onClick={()=>marcar(m,sel,!marcas[m.id])}>{marcas[m.id]?'Quitar marca':'Marcar: trabajo por identificar'}</ActBtn>
          <ActBtn variant='ghost' onClick={cerrarEnl}>Cerrar</ActBtn></>) }
      if(enlP.tid){ const t=ts.find(x=>x.id===enlP.tid); if(!t) return null
        const libres=pagosLibresDe(sel.id), m=libres.find(x=>enlSel.has('m:'+x.id))
        return caja(`¿Con qué pago del banco se pagó esta comisión de ${fmt(t.monto)}?`, <>
          {libres.length===0&&vacio('No hay pagos a este proveedor sin enlazar.')}
          {libres.map(x=>opt('m:'+x.id,`Pago del ${dmy(x.fecha)}`,marcas[x.id]?'trabajo por identificar':(x._cl==='sinclas'?'sin clasificar en Banco':'pago a proveedor'),Math.abs(Number(x.monto)||0),()=>unoSel('m:'+x.id)))}
        </>, <><ActBtn variant='primary' disabled={!m||!!busy} onClick={()=>guardarEnlace(m,sel,[t.id],[])}>{busy==='enl'?'Enlazando…':'Enlazar'}</ActBtn><ActBtn variant='ghost' onClick={cerrarEnl}>Cerrar</ActBtn></>) }
      if(enlP.did){ const d=dsAll.find(x=>x.id===enlP.did); if(!d) return null
        const pagos=csAll.filter(x=>!docs.some(o=>String(o.movimiento_id)===String(x.id))), m=pagos.find(x=>enlSel.has('m:'+x.id))
        return caja(`¿Con qué pago se saldó su factura N° ${d.folio} (${fmt(Math.abs(Number(d.monto)||0))})?`, <>
          {pagos.length===0&&vacio('No hay pagos a este proveedor para enlazar.')}
          {pagos.map(x=>opt('m:'+x.id,`Pago del ${dmy(x.fecha)}`,x._cl==='comision'?'ya pagó comisiones':(x._cl==='sinclas'?'sin clasificar en Banco':'pago a proveedor'),Math.abs(Number(x.monto)||0),()=>unoSel('m:'+x.id)))}
        </>, <><ActBtn variant='primary' disabled={!m||!!busy} onClick={()=>guardarEnlace(m,sel,[],[d.id])}>{busy==='enl'?'Enlazando…':'Enlazar'}</ActBtn><ActBtn variant='ghost' onClick={cerrarEnl}>Cerrar</ActBtn></>) }
      return null }
    // ── Ficha (rediseño 2026-10-14): 4 tarjetas · por cliente · comisiones por factura (una línea, se despliega) · pagos del banco · facturas del SII ──
    const sumSaldo = a => a.reduce((x,t)=>x+saldoT(t),0)
    const montoMovs = ms => ms.reduce((x,m)=>x+Math.abs(Number(m.monto)||0),0)
    const cliCorto = n => String(n||'').split(/\s+/).slice(0,2).join(' ')
    const tPag=ts.filter(t=>est(t)==='pagada'), tPP=ts.filter(t=>est(t)==='por_pagar'), tCob=ts.filter(t=>est(t)==='por_devengar')
    const esAnt = t => { if(est(t)!=='pagada') return false; const pc=pagoCli(t); return !pc || (!!t.pagado_at && String(t.pagado_at).slice(0,10)<String(pc.fecha).slice(0,10)) }
    const sinFacProv = m0.equipo ? [] : ts.filter(t=>!t.factura_numero&&(est(t)==='por_pagar'||(est(t)==='pagada'&&yOf(t.pagado_at)===yr)))
    const porIdentP = pagosLibresDe(sel.id).filter(m=>marcas[m.id])
    const nCli = new Set(ts.map(t=>String(cliDe(t)?.id||'x'))).size
    const alCobroTot = sumSaldo(tCob)
    // Mes de la comisión sujeta a cobro = el de la cuota del cliente: vencimiento de la factura emitida o fecha de la programada.
    const fechaCuotaT = t => { const b=facDe(t); return String((b?.invoice_no?venceBill(b):(b?.due||b?.issued_at))||'').slice(0,10) }
    const mesT = t => fechaCuotaT(t).slice(0,7)
    const filtroT = t => (cf==='todas'||(cf==='sinfac'?sinFacProv.includes(t):est(t)===cf)) && (!cliF||String(cliDe(t)?.id||'x')===String(cliF)) && (!mesF||mesT(t)===mesF)
    const fEmi = t => String(facDe(t)?.issued_at||facDe(t)?.due||t.pagado_at||t.created_at||'').slice(0,10)
    const tsF = ts.filter(filtroT).sort((a,b)=>ordC*(fEmi(a)<fEmi(b)?-1:fEmi(a)>fEmi(b)?1:0))
    const tsMostrar = tsF.slice(0,nVer)
    const band = (titulo,der) => <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}><span style={{...kLbl,color:C.accent,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{titulo}</span>{der}</div>
    const ordTog = (v,set) => <span onClick={()=>set(-v)} style={{fontSize:11.5,fontWeight:600,color:C.muted,cursor:'pointer',whiteSpace:'nowrap'}}>{v<0?'↓ Más nuevo':'↑ Más antiguo'}</span>
    const KP = {com:[C.card,C.accent,C.border],pag:[C.greenBg,C.greenText,'transparent'],pp:[C.soonBg,C.soonText,'transparent'],cob:[C.azulBg,C.accent,'transparent']}
    const ICO_P={com:'tPct',pag:'tCheck',pp:'tPagar',cob:'tEspera'}
    const tile = (k,l,v,s,filtro) => { const [bg,fg,bd]=KP[k], on=cf===filtro&&filtro!=='todas'; return <div key={k} onClick={()=>{setCf(on?'todas':filtro);setNVer(5)}} className='pv-c' style={{background:bg,border:`1px solid ${bd}`,borderRadius:10,padding:'10px 12px',cursor:'pointer',minWidth:0,outline:on?`1.5px solid ${fg}`:'none',outlineOffset:-1.5,display:'flex',gap:10,alignItems:'flex-start'}}>
      {isDesktop&&<KpiIco n={ICO_P[k]} c={fg} soft={k==='com'}/>}
      <div style={{minWidth:0}}><div style={{...kLbl,color:fg}}>{l}</div><div style={{fontSize:isDesktop?19:16,fontWeight:700,color:fg,letterSpacing:-.4,...num,marginTop:2}}>{fmt(v)}</div><div style={{fontSize:11,color:fg,opacity:.85,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s}</div></div></div> }
    const nAnt = tPag.filter(esAnt).length
    const tiles = <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}}>
      {tile('com','Comisiones',m0.total,`${nCli} cliente${nCli!==1?'s':''} · ${ts.length} factura${ts.length!==1?'s':''}`,'todas')}
      {tile('pag','Pagada',m0.pagada,`${tPag.length} factura${tPag.length!==1?'s':''}${nAnt?` · ${nAnt} anticipo${nAnt!==1?'s':''}`:''}`,'pagada')}
      {tile('pp','Por pagar',m0.porPagar,m0.porPagar>0?(isDesktop&&m0.masAnt?`Ya cobrado · desde ${dmy(m0.masAnt)}`:'Ya cobrado'):'Al día','por_pagar')}
      {tile('cob','Sujeto a cobro',alCobroTot,`${tCob.length} factura${tCob.length!==1?'s':''} sin cobrar`,'por_devengar')}
    </div>
    // Quien emite boleta: costo pagado del año separado en retención (F29) y líquido (transferido).
    const mesLbl = (k,largo) => { const [y,m]=String(k||'').split('-').map(Number); if(!y||!m) return 'Sin fecha'; return largo?mesTitulo(new Date(y,m-1,1)):`${MES_C[m-1]} ${y}` }
    // Comisiones sujetas a cobro, por mes de la cuota del cliente: monto = líquido (lo que se transfiere), bruto en la línea de abajo. Total en bruto = tarjeta «Sujeto a cobro».
    const mesCard = (()=>{ if(!ro||!tCob.length) return null
      const g={}; tCob.forEach(t=>{ const k=mesT(t)||'sin'; (g[k]=g[k]||[]).push(t) })
      const meses=Object.entries(g).sort((a,b)=>a[0]==='sin'?1:b[0]==='sin'?-1:a[0].localeCompare(b[0]))
      const liqT=t=>saldoPag(t), totLiq=tCob.reduce((a,t)=>a+liqT(t),0)
      const ultimo=n=>String(n||'').trim().split(/\s+/).slice(-1)[0]||n
      const irMes=k=>{ setMesF(mesF===k?null:k); setCf('por_devengar'); setCliF(null); setNVer(30); setTimeout(()=>{ try{ document.getElementById('pv-comisiones')?.scrollIntoView({behavior:'smooth',block:'start'}) }catch(_){} },60) }
      const cliLnk=(c,txt)=>c&&onOpenClientFicha?<span onClick={e=>{e.stopPropagation();onOpenClientFicha(c.id)}} style={{cursor:'pointer',textDecoration:'underline',textDecorationColor:C.border,textUnderlineOffset:2}}>{txt}</span>:<span>{txt}</span>
      return <div style={{...card,overflow:'hidden'}}>
        {band('Comisiones sujetas a cobro, por mes',<span style={{fontSize:11,color:C.muted}}>líquido</span>)}
        {meses.map(([k,xs],i)=>{ const venc=xs.some(t=>{ const f=fechaCuotaT(t); return !!f&&f<hoyISO }), bruto=xs.reduce((a,t)=>a+saldoT(t),0), liq=xs.reduce((a,t)=>a+liqT(t),0)
          const clis=[...new Map(xs.map(t=>{ const c=cliDe(t); return [String(c?.id||'x'),c] })).values()]
          const det=xs.map((t,j)=>{ const c=cliDe(t), nc=nCuotaDe(facDe(t)); return <Fragment key={t.id}>{j?' · ':''}{cliLnk(c,c?.name||'Sin cliente')}{nc?` cuota ${nc.n}${nc.de?'/'+nc.de:''}`:''}</Fragment> })
          const detM=clis.length===1?`${clis[0]?.name||'Sin cliente'} · ${xs.length} cuota${xs.length!==1?'s':''}`:clis.length===2?`${ultimo(clis[0]?.name)} y ${ultimo(clis[1]?.name)} · ${xs.length} cuotas`:`${clis.length} clientes · ${xs.length} cuotas`
          return <div key={k} onClick={()=>irMes(k)} className='pv-c' style={{display:'flex',alignItems:'center',gap:10,padding:isDesktop?'10px 14px':'10px 12px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:'pointer',outline:mesF===k?`1.5px solid ${C.accent}`:'none',outlineOffset:-1.5}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:C.accent,whiteSpace:'nowrap'}}>{k==='sin'?'Sin fecha':mesLbl(k,isDesktop)}{venc&&<span style={{fontSize:10,fontWeight:700,color:C.overdueText,background:C.overdueBg,borderRadius:20,padding:'2px 8px',marginLeft:6}}>vencida</span>}</div>
              <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{isDesktop?<>{det}{venc&&xs.length===1?' · pendiente de pago del cliente':''} · bruto {fmt(bruto)}</>:detM}</div>
            </div>
            <span style={{fontSize:13,fontWeight:800,color:C.text,...num,flexShrink:0}}>{fmt(liq)}</span>
            {isDesktop&&<span style={{color:C.done,flexShrink:0}}><Gl n='chevron'/></span>}
          </div> })}
        <div style={{display:'flex',justifyContent:'space-between',padding:isDesktop?'9px 14px':'9px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12}}><span style={{color:C.muted}}>{tCob.length} cuota{tCob.length!==1?'s':''}{isDesktop?` · bruto ${fmt(alCobroTot)}`:''}</span><b style={{color:C.accent,...num}}>{fmt(totLiq)}</b></div>
      </div> })()
    const cuadreCard = (()=>{ const {items,ok,filas}=cuadreComisiones({ts, billing, anticipos, concs:ro?concsRo:concs, sales}); if(!items.length&&!ok.length) return null
      const keyR=k=>`${sel.id}:${k}`, cliN=sid=>{ const sv=(sales||[]).find(x=>String(x.id)===String(sid)); return clients.find(c=>String(c.id)===String(sv?.client_id))?.name||'Sin cliente' }
      const pend=items.filter(x=>!cuadreResp[keyR(x.k)])
      const responder=async(x,r)=>{ let nota=''; if(r==='no'){ const v=await appPrompt('Indica tu observación (la verá la oficina)',''); if(v===null) return; nota=String(v||'').trim() }
        const val={r,nota:nota||null,at:new Date().toISOString(),por:user?.name||null}; setCuadreResp(p=>({...p,[keyR(x.k)]:val}))
        if(!DEMO) setLearningKV('cuadre_resp',keyR(x.k),JSON.stringify(val)).catch(()=>{})
        logActividad(`proveedores.${sel.id}.cuadre`,{tabla:'terceros_pagos',id:x.ts?.[0]?.id||null,detalle:{title:`Cuadre · ${r==='ok'?'conforme':'con observaciones'}${nota?': '+nota:''}`,monto:x.monto||null}}) }
      const anotar=async x=>{ const v=await appPrompt('Causa de la diferencia (la verá el proveedor)', cuadreNota[x.k]?.txt||''); if(v===null) return; const val={txt:String(v||'').trim()}; setCuadreNota(p=>({...p,[x.k]:val})); if(!DEMO) setLearningKV('cuadre_nota',x.k,JSON.stringify(val)).catch(()=>{}) }
      // Todo clickeable: cliente → ficha · trabajo → venta (socio) o ficha · boleta → PDF · transferencia → Banco (socio) o sus comisiones · factura → factura.
      const saleDe=sid=>(sales||[]).find(x=>String(x.id)===String(sid)), cliIdDe=sid=>saleDe(sid)?.client_id
      const irCli=sid=>{ const c=cliIdDe(sid); if(c&&onOpenClientFicha) onOpenClientFicha(c) }
      const irVenta=sid=>{ const sv=saleDe(sid); if(!ro&&sv&&onOpenSale) onOpenSale(sv); else irCli(sid) }
      const verComis=sid=>{ const c=cliIdDe(sid); setCliF(c?String(c):null); setCf('todas'); setNVer(30); setTimeout(()=>{ try{ document.getElementById('pv-comisiones')?.scrollIntoView({behavior:'smooth',block:'start'}) }catch(e){registrarError({origen:'accion',vista:'cuadre_nota',err:e})} },60) }
      const lnk=(txt,on,col)=>on?<span onClick={e=>{e.stopPropagation();on()}} style={{color:col||C.accent,fontWeight:600,cursor:'pointer',textDecoration:'underline',textDecorationColor:C.border,textUnderlineOffset:2}}>{txt}</span>:<span>{txt}</span>
      const boletaLnk=t=>{ const bh=bheDe(t); return bh?lnk(`la boleta N° ${bh.folio}`,bh.storage_path?()=>abrirDocumento(bh.storage_path):null):'una comisión' }
      const txtDe=x=> x.tipo==='banco' ? {t:lnk(`Transferencia del ${dmy(csAll.find(m=>String(m.id)===String(x.mid))?.fecha||x.ts?.[0]?.pagado_at)}`,(!ro&&onIrBanco)?()=>onIrBanco(x.mid):()=>verComis(x.sid),C.text),
          s:<>Se transfirieron {fmt(x.aplic)} por {x.ts.map((t,i)=><Fragment key={t.id}>{i?' y ':''}{boletaLnk(t)}</Fragment>)}, cuyo líquido era {fmt(x.liq)}.</>}
        : x.tipo==='base' ? {t:lnk(`${x.monto>0?'Comisión pagada en exceso':'Comisión pendiente de pago'} respecto de lo pagado por el cliente`,()=>verComis(x.sid),C.text), s:<>{lnk(`El cliente pagó ${fmt(x.cobrado)}`,()=>irCli(x.sid))}; el {x.pct}% es {fmt(x.corr)} y {lnk(`las comisiones registradas suman ${fmt(x.reg)} líquido`,()=>verComis(x.sid))}.</>}
        : {t:lnk(`Factura N° ${folioN(x.b.invoice_no)} sin comisión registrada`,(!ro&&onOpenFactura)?()=>onOpenFactura(x.b):()=>irCli(x.sid),C.text), s:<>{glosaFactura(x.b)} · {fmt(montoFactura(x.b))}. ¿Cambió lo acordado o falta registrar la comisión?</>}
      const btn=(l,on)=><span onClick={on} className='pv-c' style={{fontSize:11.5,fontWeight:700,color:C.accent,background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:'4px 11px',cursor:'pointer',whiteSpace:'nowrap'}}>{l}</span>
      const porCli={}; items.forEach(x=>{ const k=String(x.sid||'x'); (porCli[k]=porCli[k]||[]).push(x) })
      const totMas=items.filter(x=>x.monto>0).reduce((a,x)=>a+x.monto,0)
      const irPend=()=>{ const x=pend[0]; if(!x) return; try{ document.getElementById('cq-'+x.k)?.scrollIntoView({behavior:'smooth',block:'center'}) }catch(_){} }
      return <div style={{...card,overflow:'hidden'}}>
        {band('Cuadre de comisiones', pend.length?<span onClick={irPend} style={{fontSize:10.5,fontWeight:700,color:C.soonText,background:C.soonBg,borderRadius:20,padding:'2px 9px',whiteSpace:'nowrap',cursor:'pointer'}}>{pend.length} por confirmar</span>:items.length?<span style={{fontSize:10.5,fontWeight:700,color:C.greenText}}>respondido</span>:null)}
        {items.length===0&&<div style={{padding:'10px 14px',fontSize:12.5,color:C.greenText,fontWeight:600}}>Sin diferencias respecto de lo pagado por cada cliente.</div>}
        {Object.entries(porCli).map(([sid,xs])=><div key={sid} style={{borderTop:`1px solid ${C.bgSoft}`}}>
          <div style={{padding:'9px 14px 2px',fontSize:13,fontWeight:700,color:C.accent}}>{lnk(cliN(sid),()=>irCli(sid))}{xs[0]?.sale?.title?<span style={{fontWeight:500,color:C.muted}}> · {lnk(xs[0].sale.title,()=>irVenta(sid),C.muted)}</span>:null}</div>
          {xs.map(x=>{ const t=txtDe(x), r=cuadreResp[keyR(x.k)], n=cuadreNota[x.k]
            return <div key={x.k} id={'cq-'+x.k} style={{display:'flex',alignItems:isDesktop?'center':'flex-start',gap:10,padding:'7px 14px 9px',flexWrap:isDesktop?'nowrap':'wrap'}}>
              <div style={{flex:1,minWidth:isDesktop?0:'100%'}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{t.t}</div><div style={{fontSize:11,color:C.muted,lineHeight:1.45}}>{t.s}{n?.txt?<> <b style={{color:C.text}}>{n.txt}</b></>:null}</div>
                {r&&<div style={{fontSize:11,fontWeight:600,color:r.r==='ok'?C.greenText:C.soonText,marginTop:2}}>{r.por||'Respuesta'}: {r.r==='ok'?(x.tipo==='sincom'?'confirma el cambio':'conforme'):(x.tipo==='sincom'?'solicita el registro':'con observaciones')}{r.nota?` · ${r.nota}`:''} · {dmy(r.at)}</div>}</div>
              {x.monto!=null&&<span onClick={()=>verComis(x.sid)} title='Ver las comisiones de este cliente' style={{fontSize:13,fontWeight:800,color:C.soonText,...num,flexShrink:0,cursor:'pointer'}}>{x.monto>0?'+':'−'}{fmt(Math.abs(x.monto))}</span>}
              <span style={{display:'flex',gap:6,flexShrink:0}}>{ro&&!r&&<>{btn(x.tipo==='sincom'?'Confirmar cambio':'Conforme',()=>responder(x,'ok'))}{btn(x.tipo==='sincom'?'Solicitar registro':'Con observaciones',()=>responder(x,'no'))}</>}{!ro&&x.tipo!=='banco'&&btn(n?.txt?'Editar causa':'+ Causa',()=>anotar(x))}</span>
            </div> })}
        </div>)}
        {(filas.length>0||totMas>0)&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.border}`,background:C.bgSoft,fontSize:12}}>
          {filas.length>0?<span onClick={()=>setVerFilasCuadre(v=>!v)} style={{color:C.accent,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>{verFilasCuadre?'Ocultar detalle':`Detalle por trabajo (${filas.length})`} <Gl n={verFilasCuadre?'chevU':'chevD'}/></span>:<span/>}
          {totMas>0&&<b onClick={()=>setVerFilasCuadre(true)} style={{color:C.soonText,whiteSpace:'nowrap',cursor:'pointer',...num}}>Pagado en exceso {fmt(totMas)}</b>}</div>}
        {verFilasCuadre&&filas.map(f=><div key={f.sid} onClick={()=>verComis(f.sid)} className='pv-c' style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,cursor:'pointer'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{lnk(cliN(f.sid),()=>irCli(f.sid))}{isDesktop&&f.sale?.title?<span style={{fontWeight:500,color:C.muted}}> · {lnk(f.sale.title,()=>irVenta(f.sid),C.muted)}</span>:null}</div>
            <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>pagó {fmt(f.cobrado)} · {f.pct}% {fmt(f.corr)} · {isDesktop?'comisiones ':''}{fmt(f.reg)}</div></div>
          <span style={{fontWeight:700,color:C.muted,flexShrink:0,...num}}>{Math.abs(f.dif)<1?'$0':(f.dif>0?'+':'−')+fmt(Math.abs(f.dif))}</span><span style={{color:C.textSoft,fontSize:11,flexShrink:0}}><Gl n='chevron'/></span></div>)}
      </div> })()
    const bolStrip = esBoletaProv(sel) ? (()=>{ const py=tPag.filter(t=>yOf(t.pagado_at||t.created_at)===yr), cto=sumM(py), liq=py.reduce((a,t)=>a+pagarT(t),0), nB=new Set(py.map(t=>t.bhe_id).filter(Boolean)).size
      const retPorPagar=py.reduce((a,t)=>{ const bh=bheDe(t), f=f29BHE(bh?.fecha||t.factura_fecha||t.pagado_at,expenses,tituloProv(sel)); return a+(f?.estado==='pagada'?0:(Number(t.monto)||0)-pagarT(t)) },0)
      const it=(l,v,s2)=><div style={{minWidth:0}}><div style={kLbl}>{l}</div><div style={{fontSize:isDesktop?17:15,fontWeight:700,color:C.accent,...num,marginTop:2}}>{fmt(v)}</div><div style={{fontSize:11,color:C.textSoft}}>{s2}</div></div>
      return <div style={{...card,padding:'10px 14px',display:'flex',flexDirection:'column',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',background:C.azulBg,color:C.accent,whiteSpace:'nowrap'}}>Emite boleta · retención {pctBHE(tasaBHE(yr+'-01-01'))} ({yr})</span><span style={{fontSize:11,color:C.textSoft}}>{nB} boleta{nB!==1?'s':''} pagada{nB!==1?'s':''} en {yr}</span></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10}}>{it(`Costo pagado ${yr}`,cto,'bruto')}{it('Retención · F29',cto-liq,retPorPagar>0?`${fmtShort(retPorPagar)} aún sin F29 pagado`:'pagada en el F29')}{it('Líquido transferido',liq,`a ${tituloProv(sel).split(' ')[0]}`)}</div>
      </div> })() : null
    // Por revisar: pastilla con contador; al tocarla se despliega cada punto con su acción.
    const pagSinBancoP = pagadasSinBancoDe(sel.id)
    const revItems = [
      sinFacProv.length>0&&{k:'sf',t:'Sin factura del proveedor',s:`${sinFacProv.length} comisi${sinFacProv.length===1?'ón':'ones'} con el cliente pagado: ${sinFacProv.slice(0,6).map(t=>facDe(t)?.invoice_no?'N° '+folioN(facDe(t).invoice_no):'s/f').join(', ')}${sinFacProv.length>6?'…':''}`,m:sumM(sinFacProv),a:'Ver',on:()=>{setCf('sinfac');setNVer(5);setRevOpen(false)}},
      ...porIdentP.map(m=>({k:'pi'+m.id,t:'Pago por identificar',s:`${dmy(m.fecha)}${typeof marcas[m.id]==='string'&&marcas[m.id]!=='Trabajo por identificar'?' · '+marcas[m.id]:''}`,m:Math.abs(Number(m.monto)||0),a:'Enlazar',on:()=>{setEnlP({mid:m.id});setEnlSel(new Set());setSecAb('pagos');setRevOpen(false)}})),
      pagSinBancoP.length>0&&{k:'sb',t:'Pagadas sin su pago del banco',s:`${pagSinBancoP.length} comisi${pagSinBancoP.length===1?'ón':'ones'}`,m:sumM(pagSinBancoP),a:'Ver',on:()=>{setCf('pagada');setNVer(5);setRevOpen(false)}},
    ].filter(Boolean)
    // Opción A (2026-10-14): un solo desplegable «Revisar y acciones» (lo pendiente + registrar factura del proveedor + agregar comisión); Pagar aparte.
    const accItems = [
      !m0.equipo&&{k:'bol',t:`Registrar factura de ${tituloProv(sel).split(' ')[0]}`,s:'Anota su factura en las comisiones que cubre',on:()=>{setRevOpen(false);abrirBoleta(sel)}},
      onAsignarFacturas&&{k:'asg',t:'Agregar comisión a una factura tuya',s:'Cuando la venta no la trae',on:()=>{setRevOpen(false);setAsgOpen(true);setFacQ('')}},
    ].filter(Boolean)
    const revPill = (revItems.length||accItems.length) ? <span onClick={()=>setRevOpen(o=>!o)} className='pv-c' style={{display:'inline-flex',alignItems:'center',gap:6,height:36,padding:'0 14px',borderRadius:10,border:`1px solid ${revOpen?C.accent:C.border}`,background:revOpen?C.azulBg:C.card,fontSize:13,fontWeight:700,color:C.accent,cursor:'pointer',boxSizing:'border-box'}}>Revisar y acciones {revItems.length>0&&<span style={{background:C.soonBg,color:C.soonText,borderRadius:10,padding:'0 7px',fontSize:11}}>{revItems.length}</span>} {revOpen?<Gl n='chevU'/>:<Gl n='chevD'/>}</span> : null
    const secLbl = t => <div style={{...kLbl,fontSize:9.5,padding:'7px 14px 5px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}>{t}</div>
    const revPanel = (revOpen&&!ro) ? <div style={{...card,overflow:'hidden',maxWidth:isDesktop?520:'none'}}>
      {revItems.length>0&&<>{secLbl(`Por revisar · ${revItems.length}`)}{revItems.map((x,i)=><div key={x.k} onClick={x.on} className='pv-c' style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:'pointer'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600}}>{x.t}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s}</div></div>
        <span style={{fontSize:12.5,fontWeight:700,...num}}>{fmt(x.m)} <Gl n='chevron'/></span></div>)}</>}
      {accItems.length>0&&<>{secLbl('Acciones')}{accItems.map((x,i)=><div key={x.k} onClick={x.on} className='pv-c' style={{padding:'9px 14px',borderTop:i?`1px solid ${C.bgSoft}`:'none',cursor:'pointer'}}><div style={{fontSize:12.5,fontWeight:600}}>{x.t}</div><div style={{fontSize:11,color:C.muted}}>{x.s}</div></div>)}</>}
    </div> : null
    const btnBoleta = <ActBtn variant='ghost' size='lg' onClick={()=>abrirBoleta(sel)}>Registrar factura de {tituloProv(sel).split(' ')[0]}</ActBtn>
    const listasCobro = ro ? tPP.filter(t=>!t.factura_numero) : []
    const acciones = ro ? (listasCobro.length ? <div className='pv-c' onClick={()=>abrirBoleta(sel)} style={{...card,display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:C.avisoBg,border:`1px solid ${C.avisoLine}`,cursor:'pointer'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.avisoText,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{isDesktop?(listasCobro.length===1?'1 comisión por pagar':`${listasCobro.length} comisiones por pagar`):`${listasCobro.length} por pagar`}</div><div style={{fontSize:11.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{isDesktop?'el cliente ya pagó · ':''}líquido {fmt(listasCobro.reduce((a,t)=>a+saldoPag(t),0))}</div></div>
        <ActBtn variant='primary'>Registrar boleta</ActBtn></div> : null)
      : <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>{revPill}</div>
    // Por cliente: la bolsa separada por cliente; tocar filtra las comisiones, el nombre abre su ficha.
    const porClienteCard = porCliente.length>0 ? <div style={{...card,overflow:'hidden'}}>
      {band('Por cliente',cliF?link('Ver todos',()=>setCliF(null),C.accent):null)}
      {(cliMas?porCliente:porCliente.slice(0,5)).map(x=>{ const on=String(cliF)===x.k, nPP=x.ts.filter(t=>est(t)==='por_pagar').length, nCob=x.ts.filter(t=>est(t)==='por_devengar').length, nPg=x.ts.filter(t=>est(t)==='pagada').length
        const cob=sumSaldo(x.ts.filter(t=>est(t)==='por_devengar')), [v,et]=x.porPagar>0?[x.porPagar,null]:cob>0?[cob,'sujeto a cobro']:[x.pagada,'pagada']
        return <div key={x.k} onClick={()=>{setCliF(on?null:x.k);setNVer(5)}} className='pv-c' style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.cli?celda(<span>{x.cli.name}</span>,onOpenClientFicha?()=>onOpenClientFicha(x.cli.id):null):'Sin cliente'}</div>
            <div style={{fontSize:11,color:C.muted}}>{[nPP?`${nPP} por pagar`:null,nCob?`${nCob} sujeta${nCob!==1?'s':''} a cobro`:null,nPg?`${nPg} pagada${nPg!==1?'s':''}`:null].filter(Boolean).join(' · ')}</div></div>
          <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:700,color:et?C.muted:C.text,...num}}>{fmt(v)}</div>{et&&<div style={{fontSize:10.5,fontWeight:600,color:C.muted}}>{et}</div>}</div></div> })}
      {porCliente.length>5&&<div onClick={()=>setCliMas(v=>!v)} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer'}}>{cliMas?'Ver menos':`Ver ${porCliente.length-5} más ›`}</div>}
    </div> : null
    // Comisiones por factura: una línea (fecha · folio · glosa · comisión y estado); al tocar se despliega la cadena cliente → proveedor → pago.
    // Quien emite boleta de honorarios: en escritorio la fila muestra costo (bruto) · retención · líquido · boleta.
    const BOL_GC = '104px 92px 82px 92px'   // Boleta · Costo · Retención · Líquido (cifras al extremo derecho)
    const bolCab = conBolF&&isDesktop ? <div style={{display:'flex',justifyContent:'flex-end',padding:'6px 14px',...TH_BAND}}><div style={{display:'grid',gridTemplateColumns:BOL_GC,columnGap:12,textAlign:'right'}}><span style={{textAlign:'left'}}>Boleta</span><span>Costo (bruto)</span><span>Retención</span><span>Líquido</span></div></div> : null
    const estLbl = t => { const e=est(t); if(e==='por_pagar') return [aporteDe(t.id)>0?'Pago parcial':'Por pagar',C.soonText]; if(e==='por_devengar') return ['Sujeto a cobro',C.muted]; return [esAnt(t)?'Anticipo':'Pagada',esAnt(t)?C.azulInfo:C.muted] }
    const det = (l,v) => <div style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:11.5,padding:'2px 0',maxWidth:340}}><span style={{color:C.muted,whiteSpace:'nowrap'}}>{l}</span><span style={{textAlign:'right',fontWeight:600,color:C.text,minWidth:0}}>{v}</span></div>
    const lk = (txt,on) => on ? <span onClick={e=>{e.stopPropagation();on()}} style={{color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}>{txt} <Gl n='chevron'/></span> : <span style={{whiteSpace:'nowrap'}}>{txt}</span>
    const filaT = t => { const b=facDe(t), pc=pagoCli(t), [eL,eC]=estLbl(t), open=expT===t.id, e=est(t), w=trabajoDe(t), ap=aporteDe(t.id), bh=bheDe(t)
      const glosa = b ? glosaFactura(b) : (w.titulo||'Sin factura del cliente')
      const cliTxt = pc ? lk(dmy(pc.fecha),pc.mov&&onIrBanco?()=>onIrBanco(pc.mov):(b&&onOpenFactura?()=>onOpenFactura(b):null))
        : !b ? 'Sin factura del cliente' : b.status==='Programada' ? 'Por facturar' : b.status==='Vencido' ? `Vencida${b.due?' hace '+nDias(_diasDesde(b.due)):''}` : `Por cobrar${b.due?' · vence '+dmy(b.due):''}`
      return <Fragment key={t.id}>
        <div onClick={()=>setExpT(open?null:t.id)} className='pv-c' style={{display:'flex',alignItems:open?'flex-start':'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
          {diaGrande(fEmi(t))}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'baseline',gap:8,minWidth:0}}><span style={{fontSize:12.5,fontWeight:700,color:C.text,flexShrink:0}}>{b?.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'Sin factura'}</span><span style={{fontSize:11.5,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{(!cliF&&cliDe(t)?.name)?`${cliDe(t).name} · `:''}{glosa}</span></div>
            {open&&<div style={{marginTop:7}} onClick={e=>e.stopPropagation()}>
              {b&&det('Tu factura',lk(`Factura N° ${folioN(b.invoice_no)||'—'} · ${fmt(montoFactura(b))}`,onOpenFactura?()=>onOpenFactura(b):null))}
              {det('Cliente pagó',cliTxt)}
              {!m0.equipo&&!conBolF&&det(`${tituloProv(sel)} facturó`,t.factura_numero?`Factura N° ${t.factura_numero}${t.factura_fecha?' · '+dmy(t.factura_fecha):''}`:lk('Sin factura del proveedor',ro?null:()=>abrirBoleta(sel)))}
              {conBolF&&<>
                {det('Boleta',bh?<span onClick={()=>abrirDocumento(bh.storage_path)} title='Descargar la boleta (PDF)' style={{display:'inline-flex',alignItems:'center',gap:4,color:C.accent,cursor:'pointer',whiteSpace:'nowrap'}}><SIcon n='download' s={12} c={C.accent}/>N° {bh.folio} · {dmy(bh.fecha)}</span>:t.factura_numero?`N° ${t.factura_numero}${t.factura_fecha?' · '+dmy(t.factura_fecha):''}`:lk(ro?'Sin boleta':'Sin boleta · registrar',ro?null:()=>abrirBoleta(sel)))}
                {det('Costo (bruto)',fmt(Number(t.monto)||0))}
                {det(`Retención ${pctBHE(bh?Number(bh.tasa)||tasaBHE(bh.fecha):tasaBHE(fechaBHE(t.pagado_at,venceT(t))))}`,fmt(t.retencion!=null?Number(t.retencion)||0:(Number(t.monto)||0)-pagarT(t)))}
                {(()=>{ const f=f29BHE(bh?.fecha||t.factura_fecha||(t.estado==='pagado'?t.pagado_at:null),expenses,tituloProv(sel)); return f?det('F29',<span style={{color:f.estado==='pagada'?C.greenText:f.estado==='ira'?C.muted:C.soonText}}>{f.txt}</span>):null })()}
                {det(e==='pagada'?'Líquido transferido':'Líquido a transferir',fmt(pagarT(t)))}</>}
              {det('Le pagaste',t.estado==='pagado'?lk(t.pagado_at?dmy(t.pagado_at):'Pagada',t.movimiento_id&&onIrBanco?()=>onIrBanco(t.movimiento_id):null):ap>0?`${fmt(ap)} · faltan ${fmt(Math.max(0,(Number(t.monto)||0)-ap))}`:e==='por_pagar'?'Por pagar':'—')}
              {w.sale&&det('Trabajo',lk(w.titulo,onOpenSale?()=>onOpenSale(w.sale):null))}
              {t.referencia&&<div style={{fontSize:11,color:C.textSoft,marginTop:3}}>{t.referencia}</div>}
              <div style={{display:'flex',gap:12,marginTop:5,flexWrap:'wrap'}}>
                {e==='pagada'&&!t.movimiento_id&&!m0.equipo&&!ro&&link('Enlazar con su pago ›',()=>{setEnlP({tid:t.id});setEnlSel(new Set())},C.accent)}
                {e==='pagada'&&onRevertirPago&&!ro&&link('Deshacer pago',async()=>{ if(await appConfirm('¿Deshacer este pago? La comisión vuelve a "por pagar".')){ onRevertirPago(t); logActividad(`proveedores.${sel.id}.deshacer`,{tabla:'terceros_pagos',id:t.id,detalle:{title:b?.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'Comisión',monto:Number(t.monto)||0}}) } },C.muted)}
              </div></div>}
          </div>
          {conBolF&&isDesktop ? <div style={{display:'grid',gridTemplateColumns:BOL_GC,columnGap:12,textAlign:'right',flexShrink:0,alignItems:'baseline'}}>
            <span style={{fontSize:10.5,fontWeight:700,color:eC,textAlign:'left',whiteSpace:'nowrap'}}>{bh?<span onClick={ev=>{ev.stopPropagation();abrirDocumento(bh.storage_path)}} title='Descargar la boleta (PDF)' style={{display:'inline-flex',alignItems:'center',gap:3,color:C.accent,cursor:'pointer'}}><SIcon n='download' s={11} c={C.accent}/>N° {bh.folio}</span>:eL}</span>
            <span style={{fontSize:13,fontWeight:700,color:e==='por_pagar'?C.text:C.muted,...num}}>{fmt(e==='pagada'?t.monto:saldoT(t))}</span>
            <span style={{fontSize:12,color:C.textSoft,...num}}>{fmt(t.retencion!=null?Number(t.retencion)||0:(Number(t.monto)||0)-pagarT(t))}</span>
            <span style={{fontSize:12,color:C.textSoft,...num}}>{fmt(e==='pagada'?pagarT(t):saldoPag(t))}</span>
          </div>
          : <div style={{textAlign:'right',flexShrink:0}}><div style={{fontSize:13,fontWeight:700,color:e==='por_pagar'?C.text:C.muted,...num}}>{fmt(e==='pagada'?t.monto:saldoT(t))}</div><div style={{fontSize:10.5,fontWeight:700,color:eC}}>{eL}</div></div>}
        </div>
        {enlP?.tid===t.id&&panelEnlace()}</Fragment> }
    const exportCuotas = () => exportCSV(`comisiones_${tituloProv(sel).replace(/\s+/g,'_')}.csv`,['Emitida','Cliente','Tu factura','Glosa','Cliente pagó','Factura del proveedor','Comisión','Le pagaste','Estado'],
      tsF.map(t=>{ const b=facDe(t); return [dmy(fEmi(t)),cliDe(t)?.name||'',b?.invoice_no?`N° ${folioN(b.invoice_no)}`:'',b?glosaFactura(b):'',pagoCli(t)?.fecha?dmy(pagoCli(t).fecha):'',t.factura_numero||'',Math.round(Number(t.monto)||0),t.pagado_at?dmy(t.pagado_at):'',estLbl(t)[0]] }))
    const tituloLista = (cliF?(porCliente.find(x=>x.k===String(cliF))?.cli?.name||'Sin cliente'):'Comisiones por factura')+(cf==='todas'?'':` · ${({pagada:'Pagadas',por_pagar:'Por pagar',por_devengar:'Sujeto a cobro',sinfac:'Sin factura del proveedor'})[cf]||''}`)+(mesF?` · ${mesF==='sin'?'Sin fecha':mesLbl(mesF,true)}`:'')
    const comisionesCard = <div id='pv-comisiones' style={{...card,overflow:'hidden'}}>
      {band(asgOpen?'Agregar comisión a una factura tuya':tituloLista,asgOpen?link('Cerrar',()=>setAsgOpen(false),C.accent):<span style={{display:'inline-flex',gap:10,alignItems:'center'}}>{mesF&&link('Quitar mes',()=>setMesF(null),C.accent)}{ordTog(ordC,setOrdC)}</span>)}
      {asgOpen&&(()=>{ const yaAsig=new Set(ts.map(t=>String(t.billing_id))); const asignables = facQ.trim() ? billing.filter(b=>{ if(b.status==='Anulada'||b.billing_type==='reembolso'||yaAsig.has(String(b.id))) return false; const c=clients.find(x=>String(x.id)===String(b.client_id)); return _normTxt(`${c?.name||''} ${b.concept||''} ${b.invoice_no||''} ${b.receptor_name||''}`).includes(_normTxt(facQ)) }).slice(0,10) : []
        const asignar = async bid => { const m=parseInt(montos[bid])||0; if(!m||!onAsignarFacturas) return; setAsgBusy(bid); const ok=await onAsignarFacturas(sel.id,[{billing_id:bid,monto:m}]); setAsgBusy(null); if(ok){ setMontos(p=>{const n={...p};delete n[bid];return n}); const b=billing.find(x=>String(x.id)===String(bid)); logActividad(`proveedores.${sel.id}.asignar`,{tabla:'billing',id:bid,detalle:{title:b?.invoice_no?`Factura ${folioN(b.invoice_no)}`:'Factura',monto:m}}) } }
        return <div style={{padding:'0 14px 10px'}}><Buscador value={facQ} onChange={setFacQ} placeholder='Factura de la oficina: cliente, concepto o N°…' autoFocus/>
          {facQ.trim()&&asignables.length===0&&<div style={{fontSize:12,color:C.muted,padding:'8px 2px'}}>Sin facturas (o ya están asignadas a este proveedor).</div>}
          {asignables.map(b=>{ const c=clients.find(x=>String(x.id)===String(b.client_id)); return <div key={b.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderTop:`1px solid ${C.bgSoft}`}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c?.name||b.receptor_name||'Sin cliente'}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.invoice_no?`Factura N° ${folioN(b.invoice_no)} · `:''}{b.concept||'—'} · {fmt(b.amount)}</div></div>
            <input type='number' value={montos[b.id]||''} onChange={e=>setMontos(p=>({...p,[b.id]:e.target.value}))} placeholder='Su parte $' style={{width:100,height:34,border:`1px solid ${C.border}`,borderRadius:8,fontSize:12.5,padding:'0 8px',outline:'none',boxSizing:'border-box'}}/>
            <ActBtn variant='primary' disabled={asgBusy===b.id||!(parseInt(montos[b.id])||0)} onClick={()=>asignar(b.id)}>{asgBusy===b.id?'…':'Asignar'}</ActBtn></div> })}</div> })()}
      {tsF.length>0&&bolCab}
      {tsF.length===0 ? <div style={{padding:'16px 14px',fontSize:12.5,color:C.muted}}>{ts.length?'Nada en este filtro.':ro?'Sin comisiones todavía.':'Sin comisiones todavía. Aparecen al agregarlo en el reparto de una venta o con "+ Asignar factura".'}</div> : tsMostrar.map(filaT)}
      {tsF.length>tsMostrar.length&&<div onClick={()=>setNVer(n=>n+20)} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer'}}>Ver {Math.min(20,tsF.length-tsMostrar.length)} más <Gl n='chevron'/></div>}
      {tsF.length>0&&<div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'8px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12}}><span style={{color:C.muted}}>Total{cliF||cf!=='todas'?' del filtro':''}</span><b style={{...num}}>{fmt(tsF.reduce((x,t)=>x+(est(t)==='pagada'?(Number(t.monto)||0):saldoT(t)),0))}</b></div>}
    </div>
    // Pagos del banco y facturas del proveedor en el SII (año del filtro).
    const pagosY = csAll.filter(m=>yOf(m.fecha)===yr).sort((a,b)=>ordP*String(a.fecha).localeCompare(String(b.fecha)))
    const filaPago = m => { const tsM=terceros.filter(t=>String(t.movimiento_id)===String(m.id)), asig=aporteAsig[m.id]||[], c=calceDeCargo(m.id)
      const nomT = t => { const b=facDe(t); return `${cliCorto(cliDe(t)?.name)} ${b?.invoice_no?'N° '+folioN(b.invoice_no):''}`.trim() }
      const tit = tsM.length ? tsM.slice(0,3).map(nomT).join(' + ')+(tsM.length>3?` + ${tsM.length-3}`:'') : asig.length ? 'Anticipo de comisión' : marcas[m.id] ? 'Por identificar' : m._cl==='sinclas' ? 'Sin clasificar en Banco' : 'Sin enlazar'
      const subT = tsM.length ? <>{tsM.length} comisi{tsM.length===1?'ón':'ones'} · {lk('Ver en Banco',onIrBanco?()=>onIrBanco(m.id):null)}</>
        : c&&c.tipo!=='sii' ? <>Calza con {(c.ts||[]).length>1?`${c.ts.length} comisiones`:'una comisión'} · {lk(busy?'…':'Enlazar',()=>enlazar([c]))}</>
        : pagoLibre(m) ? <>{marcas[m.id]&&typeof marcas[m.id]==='string'&&marcas[m.id]!=='Trabajo por identificar'?marcas[m.id]+' · ':''}{lk('Enlazar',()=>{setEnlP({mid:m.id});setEnlSel(new Set())})}</> : lk('Ver en Banco',onIrBanco?()=>onIrBanco(m.id):null)
      return <Fragment key={m.id}><div className='pv-c' onClick={()=>onIrBanco&&onIrBanco(m.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
        {diaGrande(m.fecha,marcas[m.id]?C.soonText:null)}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tit}</div><div style={{fontSize:11,color:C.muted}} onClick={e=>e.stopPropagation()}>{subT}</div></div>
        <span style={{fontSize:13,fontWeight:700,...num}}>{fmt(Math.abs(Number(m.monto)||0))}</span></div>{enlP?.mid===m.id&&panelEnlace()}</Fragment> }
    const pagosCard = pagosY.length ? <div style={{...card,overflow:'hidden'}}>{band(`Pagos del banco · ${yr}`,ordTog(ordP,setOrdP))}{pagosY.slice(0,evMas?999:8).map(filaPago)}{pagosY.length>8&&!evMas&&<div onClick={()=>setEvMas(true)} style={{padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12,fontWeight:700,color:C.accent,cursor:'pointer'}}>Ver los {pagosY.length} <Gl n='chevron'/></div>}</div> : null
    const docsY = dsAll.filter(d=>yOf(d.fecha_emision)===yr).sort((a,b)=>ordP*String(a.fecha_emision).localeCompare(String(b.fecha_emision)))
    const cubre = d => ts.filter(t=>String(t.factura_numero||'').split(/[^0-9]+/).includes(String(d.folio)))
    const filaDoc = d => { const nc=Number(d.tipo_dte)===61, cs=cubre(d), c=calceDeDoc(d.id), pag=cs.filter(t=>est(t)==='pagada').reduce((x,t)=>x+(Number(t.monto)||0),0)
      const tit = <><span style={{fontWeight:700}}>{nc?'NC':'F'}{d.folio}</span>{cs.length?<span style={{color:C.muted}}> · {cs.slice(0,3).map(t=>{ const b=facDe(t); return `${cliCorto(cliDe(t)?.name)} ${b?.invoice_no?'N° '+folioN(b.invoice_no):''}`.trim() }).join(' · ')}{cs.length>3?` · +${cs.length-3}`:''}</span>:null}</>
      const subT = nc ? 'Nota de crédito' : d.movimiento_id ? <>Pago enlazado · {lk('Ver en Banco',onIrBanco?()=>onIrBanco(d.movimiento_id):null)}</>
        : cs.length ? (pag>=(Number(d.monto)||0)-1 ? 'Pagada' : pag>0 ? `Pagada en parte · saldo ${fmt((Number(d.monto)||0)-pag)}` : 'Por pagar')
        : c ? <>Calza con el pago del {dmy(c.m.fecha)} · {lk(busy?'…':'Enlazar',()=>enlazar([c]))}</>
        : <>Sin asignar · {lk('Asignar a comisiones',()=>{ const pp=tercDe(sel.id).filter(t=>est(t)!=='pagada'&&!t.factura_numero); setBol({ids:new Set(pp.map(t=>t.id)),numero:String(d.folio),fecha:String(d.fecha_emision||'').slice(0,10),monto:String(Math.abs(Number(d.monto)||0))}); setView('boleta') })}</>
      return <Fragment key={d.id}><div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`}}>
        {diaGrande(d.fecha_emision)}<div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tit}</div><div style={{fontSize:11,color:C.muted}}>{subT}</div></div>
        <span style={{fontSize:13,fontWeight:700,color:nc?C.muted:C.text,...num}}>{nc?'−':''}{fmt(Math.abs(Number(d.monto)||0))}</span></div>{enlP?.did===d.id&&panelEnlace()}</Fragment> }
    const docsCard = docsY.length ? <div style={{...card,overflow:'hidden'}}>{band(`Facturas de ${tituloProv(sel)} en el SII · ${yr}`,ordTog(ordP,setOrdP))}{docsY.map(filaDoc)}</div> : null
    const ETQ = Object.fromEntries([['comision','Enlazó un pago con una comisión'],['factura','Enlazó una factura con su pago'],['factura_quitar','Quitó el enlace de una factura'],['asignar','Asignó una factura'],['deshacer','Deshizo un pago'],['pagar','Pagó comisiones'],['boleta','Registró su factura'],['boleta_enviada','Envió su boleta a la oficina'],['enlace','Enlazó un pago'],['marca','Marcó un pago'],['devengar','Pasó una comisión a por pagar'],['editar','Editó los datos'],['crear','Creó la ficha'],['cuadre','Cuadró la cuenta']].map(([k,l])=>[`proveedores.${sel.id}.${k}`,l]))
    const bita = <BitacoraLista prefijo={`proveedores.${sel.id}.`} etiquetas={ETQ} limite={15} vacio='Aquí queda cada pago, enlace o cambio: quién y cuándo.'/>
    const btnExcel = <span onClick={exportCuotas} title='Descargar Excel' style={{height:30,width:32,display:'inline-flex',alignItems:'center',justifyContent:'center',border:`1px solid ${C.border}`,borderRadius:8,background:C.card,cursor:'pointer'}}><SIcon n='download' s={14} c={C.accent}/></span>
    // Datos del proveedor siempre a la vista (copiables); Editar al extremo.
    const dItem = (l,v,max) => <span style={{display:'flex',flexDirection:'column',minWidth:0,maxWidth:max||'none'}}><span style={{...kLbl,fontSize:9.5}}>{l}</span><span style={{fontSize:12.5,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v}</span></span>
    const copiar = <b style={{fontSize:11,color:C.accent,marginLeft:4}}>Copiar</b>
    const relTxt = [m0.equipo?'Equipo':null,m0.les?'Le pagas comisión':null,m0.te?'Te paga comisión':null].filter(Boolean).join(' · ')||'Sin comisiones aún'
    const datosStrip = <div style={{...card,padding:'9px 14px',display:'flex',flexWrap:'wrap',gap:'6px 22px',alignItems:'flex-end'}}>
      {isDesktop&&sel.razon_social&&dItem('Razón social',sel.razon_social)}
      {dItem('RUT',sel.rut?<Copyable text={sel.rut}>{fmtRutCL(sel.rut)}{copiar}</Copyable>:ro?'—':link('+ agregar',()=>abrirEditar(sel),C.accent))}
      {dItem('Datos de pago',sel.datos_pago?.trim()?<Copyable text={sel.datos_pago}>{sel.datos_pago.trim().split(/\n+/).join(' · ')}{copiar}</Copyable>:ro?'—':link('+ agregar',()=>abrirEditar(sel),C.accent),isDesktop?300:'100%')}
      {isDesktop&&dItem('Relación',relTxt)}
      {!ro&&<span style={{marginLeft:'auto'}}>{link('Editar ›',()=>abrirEditar(sel),C.accent)}</span>}
    </div>
    // Tarjetitas: pagos del banco · facturas del SII · comisiones por cobrar · historial (cerradas; se abre una a la vez).
    const pagTot = pagosY.reduce((x,m)=>x+Math.abs(Number(m.monto)||0),0), ultPagoF = pagosY.map(m=>String(m.fecha)).sort().pop()
    const facY = docsY.filter(d=>Number(d.tipo_dte)!==61), nNC = docsY.length-facY.length, docNet = docsY.reduce((x,d)=>x+sgn(d)*Math.abs(Number(d.monto)||0),0)
    const ultDoc = [...facY].sort((p1,p2)=>String(p1.fecha_emision).localeCompare(String(p2.fecha_emision))).pop()
    const secs = [
      pagosCard&&{k:'pagos',t:'Pagos del banco',v:fmt(pagTot),s:`${pagosY.length} en ${yr}${ultPagoF?' · último '+dmy(ultPagoF):''}`,el:pagosCard},
      docsCard&&{k:'sii',t:'Facturas en el SII',v:fmt(docNet),s:`${facY.length} factura${facY.length!==1?'s':''}${nNC?` y ${nNC} NC`:''} en ${yr}${ultDoc?' · última F'+ultDoc.folio:''}`,el:docsCard},
      aFavor&&{k:'cobrar',t:'Comisiones por cobrar',v:fmt(m0.porCobrarTe),s:`cobradas ${yr} ${fmt(m0.cobAnioTe)}`,el:aFavor},
      {k:'hist',t:'Historial',v:null,s:'Pagos, enlaces y cambios',el:bita},
    ].filter(Boolean)
    const secAbierta = secs.find(x=>x.k===secAb)
    const mini = x => { const on=secAb===x.k; return <div key={x.k} onClick={()=>setSecAb(on?null:x.k)} className='pv-c' style={isDesktop
      ? {background:on?C.azulBg:C.card,border:`1px solid ${on?C.accent:C.border}`,borderRadius:10,padding:'9px 12px',cursor:'pointer',minWidth:0}
      : {display:'flex',alignItems:'center',gap:10,padding:'11px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:on?C.azulBg:'transparent'}}>
      {isDesktop ? <>
        <div style={{display:'flex',justifyContent:'space-between',...kLbl,fontSize:9.5}}><span>{x.t}</span><span>{on?<Gl n='chevU'/>:<Gl n='chevD'/>}</span></div>
        {x.v&&<div style={{fontSize:14,fontWeight:700,marginTop:3,...num}}>{x.v}</div>}
        <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s}</div>
      </> : <>
        <div style={{flex:1,minWidth:0}}><div style={{...kLbl,fontSize:9.5}}>{x.t}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.s}</div></div>
        {x.v&&<span style={{fontSize:13,fontWeight:700,...num}}>{x.v}</span>}<span style={{color:C.textSoft,fontSize:11}}>{on?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
      </>}</div> }
    const minis = isDesktop
      ? <div style={{display:'grid',gridTemplateColumns:`repeat(${secs.length},minmax(0,1fr))`,gap:8}}>{secs.map(mini)}</div>
      : <div style={{...card,overflow:'hidden'}}>{secs.map((x,i)=><Fragment key={x.k}>{i===0?<div style={{marginTop:-1}}>{mini(x)}</div>:mini(x)}{secAb===x.k&&<div style={{padding:'0 0 8px'}}>{x.el}</div>}</Fragment>)}</div>
    return (<div>{css}
      <PageHeader origen={ro?origen:'Proveedores'} onBack={ro?onBack:()=>setView('list')} titulo={ro?(isDesktop?'Mis comisiones':'Comisiones'):tituloProv(sel)} right={<span style={{display:'inline-flex',gap:8,alignItems:'center'}}>{selAnio}{btnExcel}</span>}/>
      {wrap(isDesktop ? <>
        {datosStrip}{tiles}{bolStrip}{acciones}{revPanel}{mesCard}{cuadreCard}
        <div style={{display:'grid',gridTemplateColumns:conBolF?'minmax(0,1fr) minmax(0,2.8fr)':'minmax(0,1fr) minmax(0,1.9fr)',gap:12,alignItems:'start'}}>{porClienteCard||<span/>}{comisionesCard}</div>
        {!ro&&minis}{!ro&&secAbierta&&secAbierta.el}
      </> : <>{tiles}{bolStrip}{datosStrip}{acciones}{revPanel}{mesCard}{cuadreCard}{porClienteCard}{comisionesCard}{!ro&&minis}</>)}
    </div>)
  }

  // ── LISTA (por proveedor · por trabajo) ──
  const filas = proveedores.map(p=>({p,...met(p)}))
  const sc = saldoComisiones(terceros, billing)
  const tsTodas = terceros.filter(tValida)
  const pagadasAnio = sumM(tsTodas.filter(t=>est(t)==='pagada'&&yOf(t.pagado_at||t.created_at)===yr))
  const transfAnio = filas.reduce((s,r)=>s+r.transferido,0)
  const cobAnioTot = filas.reduce((s,r)=>s+r.cobAnioTe,0)
  const conDeuda = filas.filter(r=>r.porPagar>0)
  const masAntTot = conDeuda.map(r=>r.masAnt).filter(Boolean).sort()[0]
  const nCom=calces.filter(c=>c.tipo!=='sii').length, nSii=calces.filter(c=>c.tipo==='sii').length
  const sinCuota = tsTodas.filter(t=>!t.billing_id&&est(t)!=='pagada')
  const progVenc = tsTodas.filter(t=>est(t)==='por_devengar'&&facDe(t)?.status==='Programada'&&String(facDe(t)?.due||'9')<hoyISO)
  const libresTodos = proveedores.flatMap(p=>pagosLibresDe(p.id).map(m=>({p,m})))
  const porIdent = libresTodos.filter(x=>marcas[x.m.id]), sinEnl = libresTodos.filter(x=>!marcas[x.m.id]&&String(x.m.fecha)>=APP_DESDE&&!calceDeCargo(x.m.id))   // los que calzan exacto ya salen en 'calza con una comisión'
  const pagSinBanco = proveedores.flatMap(p=>pagadasSinBancoDe(p.id).map(t=>({p,t})))
  const montoMov = xs => xs.reduce((a,x)=>a+Math.abs(Number(x.m.monto)||0),0)
  const qq=_normTxt(q.trim())
  // ── Landing (2026-10-14): 4 tarjetas que filtran · por revisar en una línea · lista de una línea que se despliega · por proveedor ⇄ por cliente ──
  // Filtro por año (2026-10-15): Por pagar y Sujeto a cobro = comisiones de facturas del cliente emitidas (o programadas) en el año elegido;
  // Pagada = pagada en el año. Comisiones por cobrar: pendientes de facturas del año + cobradas en el año.
  const yT = t => { const b=facDe(t); return yOf(b ? (b.issued_at||b.due) : (t.pagado_at||t.created_at)) }
  const sinFacDe = p => { const m=met(p); return m.equipo ? [] : tercDe(p.id).filter(t=>!t.factura_numero&&((est(t)==='por_pagar'&&yT(t)===yr)||(est(t)==='pagada'&&yOf(t.pagado_at)===yr))) }
  const filasL = filas.map(r=>{ const ts=tercDe(r.p.id), sf=sinFacDe(r.p), tsY=ts.filter(t=>yT(t)===yr), ppY=tsY.filter(t=>est(t)==='por_pagar')
    const caY=r.caItems.filter(x=>x.cob ? String(x.b.paid_at||x.b.issued_at||'').slice(0,4)===String(yr) : yOf(x.b.issued_at)===yr)
    return {...r, porPagar:ppY.reduce((a,t)=>a+saldoT(t),0), nPorPagar:ppY.length, masAnt:ppY.map(t=>pagoCli(t)?.fecha).filter(Boolean).sort()[0], cob:tsY.filter(t=>est(t)==='por_devengar').reduce((a,t)=>a+saldoT(t),0), pagAnio:r.pagadasAnio,
      caItems:caY, porCobrarTe:caY.filter(x=>!x.cob).reduce((a,x)=>a+x.monto,0), sinFac:sf.length, sinFacM:sumM(sf), nCli:new Set(ts.map(t=>String(cliDe(t)?.id||'x'))).size, clis:[...new Set(ts.map(t=>cliDe(t)?.name).filter(Boolean))]} })
  const ppTot = filasL.reduce((s,r)=>s+r.porPagar,0)
  const cobTot = filasL.reduce((s,r)=>s+r.cob,0), porCobrarTot = filasL.reduce((s,r)=>s+r.porCobrarTe,0)
  const sinFacTot = filasL.reduce((s,r)=>s+r.sinFac,0), sinFacMTot = filasL.reduce((s,r)=>s+r.sinFacM,0)
  const enLf = r => lf==='por_pagar'?r.porPagar>0 : lf==='por_devengar'?r.cob>0 : lf==='pagada'?r.pagAnio>0 : lf==='cobrar'?(r.caItems||[]).length>0 : lf==='sinfac'?r.sinFac>0 : true
  // Landing (2026-10-15): 6 tarjetas iguales — etiqueta + cifra en $M, sin texto debajo (el detalle aparece al tocar).
  const KPL = {pp:[C.soonBg,C.soonText,'transparent'],cob:[C.azulBg,C.accent,'transparent'],pag:[C.greenBg,C.greenText,'transparent'],te:[C.card,C.accent,C.border],sf:[C.card,C.accent,C.border],pi:[C.card,C.accent,C.border]}
  const ICO_L={pp:'tPagar',cob:'tEspera',pag:'tCheck',te:'tEntra',sf:'tSinFac',pi:'tIdentif'}
  const tileL = (k,l,v,f,onTap) => { const [bg,fg,bd]=KPL[k], on=f&&lf===f, tap=onTap||(f?()=>setLf(on?'todos':f):null); return <div key={k} onClick={v?tap||undefined:undefined} className={v&&tap?'pv-c':undefined} style={{background:bg,border:`1px solid ${bd}`,borderRadius:10,padding:isDesktop?'10px 12px':'10px',cursor:v&&tap?'pointer':'default',minWidth:0,outline:on?`1.5px solid ${fg}`:'none',outlineOffset:-1.5,display:'flex',gap:10,alignItems:'center'}}>
    {isDesktop&&<KpiIco n={ICO_L[k]} c={fg} soft={bg===C.card||bg===C.surface||bg===C.tileBg}/>}
    <div style={{minWidth:0}}><div style={{...kLbl,color:fg,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',...(isDesktop?{}:{fontSize:9.5,letterSpacing:.3})}}>{l}</div><div style={{fontSize:isDesktop?19:17,fontWeight:700,color:fg,letterSpacing:-.4,...num,marginTop:1,whiteSpace:'nowrap'}}>{v?fmtMill(v):'—'}</div></div></div> }
  const nP = f => filasL.filter(f).length
  const provN = n => `${n} proveedor${n!==1?'es':''}`
  const tilesL = <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}}>
    {tileL('pp','Por pagar',ppTot,'por_pagar')}
    {tileL('cob','Sujeto a cobro',cobTot,'por_devengar')}
    {tileL('pag',`Pagada · ${yr}`,pagadasAnio,'pagada')}
    {tileL('te','Comisiones por cobrar',porCobrarTot,'cobrar')}
    {tileL('sf',`Sin factura${sinFacTot?' · '+sinFacTot:''}`,sinFacMTot,'sinfac')}
    {tileL('pi',`Por identificar${porIdent.length?' · '+porIdent.length:''}`,montoMov(porIdent),null,porIdent.length?()=>abrirFicha(porIdent[0].p.id):null)}
  </div>
  // Por enlazar (pagos del banco por calzar): alerta de una línea, solo si hay. Sin factura / Por identificar ya son tarjetas.
  const nEnl = nCom+nSii+sinEnl.length+pagSinBanco.length
  const revisarL = nEnl>0 ? <div onClick={()=>{ if(nCom+nSii>0){setSelEnl(null);setView('enlazar')} else abrirFicha((sinEnl[0]||pagSinBanco[0]).p.id) }} className='pv-c' style={{...card,display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer'}}><span style={{width:7,height:7,borderRadius:'50%',background:C.soonText,flexShrink:0}}/><span style={{flex:1,minWidth:0,fontSize:12.5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}><b>Por enlazar</b> · {nEnl} pago{nEnl!==1?'s':''} del banco</span><span style={{fontSize:11.5,fontWeight:700,color:C.accent}}>Ver <Gl n='chevron'/></span></div> : null
  // Por proveedor
  let vis = filasL.filter(r=>enLf(r)&&(!qq||_normTxt(`${r.p.nombre||''} ${r.p.razon_social||''} ${r.p.rut||''} ${r.clis.join(' ')}`).includes(qq)||(_nRut(q)&&_nRut(r.p.rut).includes(_nRut(q)))))
  vis = [...vis].sort((a,b)=> ord.k==='nombre' ? tituloProv(a.p).localeCompare(tituloProv(b.p),'es')*ord.dir : ((a[ord.k]-b[ord.k])*ord.dir || (b.cob-a.cob) || tituloProv(a.p).localeCompare(tituloProv(b.p),'es')))
  const activo = r => r.porPagar>0||r.cob>0||r.pagAnio>0
  const visAct = vis.filter(activo), visSin = vis.filter(r=>!activo(r))
  const tot = k => visAct.reduce((s,r)=>s+(r[k]||0),0)
  const COLS='minmax(200px,1.7fr) 130px 150px 150px 18px'
  const th = (k,l) => <span onClick={()=>setOrd(o=>({k,dir:o.k===k?-o.dir:(k==='nombre'?1:-1)}))} style={{textAlign:k==='nombre'?'left':'right',cursor:'pointer'}}>{l}{ord.k===k?(ord.dir<0?<>{" "}<Gl n='chevD'/></>:<>{" "}<Gl n='chevU'/></>):''}</span>
  const qi = (l,v,on) => <div onClick={on?e=>{e.stopPropagation();on()}:undefined} className={on?'pv-c':undefined} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,padding:'2px 4px',margin:'0 -4px',borderRadius:5,cursor:on?'pointer':'default'}}><span style={{color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{l}</span><b style={{...num,color:C.text}}>{v}</b></div>
  const qBox = (titulo,hijos) => <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',minWidth:0}}><div style={{...kLbl,fontSize:9.5,marginBottom:3}}>{titulo}</div>{hijos}</div>
  const vistaRapida = r => { const ts=tercDe(r.p.id)
    const pp=ts.filter(t=>est(t)==='por_pagar').sort((a,b)=>saldoT(b)-saldoT(a))
    const g={}; ts.filter(t=>est(t)==='por_devengar').forEach(t=>{ const c=cliDe(t); const k=String(c?.id||'x'); (g[k]=g[k]||{c,ts:[]}).ts.push(t) })
    const cobG=Object.values(g).map(x=>({...x,m:x.ts.reduce((s,t)=>s+saldoT(t),0),venc:x.ts.filter(t=>facDe(t)?.status==='Vencido').length})).sort((a,b)=>b.m-a.m)
    const ultPago=cargosDe(r.p.id).filter(m=>terceros.some(t=>String(t.movimiento_id)===String(m.id))).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha)))[0]
    const ultDoc=docsDe(r.p.id).filter(d=>Number(d.tipo_dte)!==61).sort((a,b)=>String(b.fecha_emision).localeCompare(String(a.fecha_emision)))[0]
    const fol=t=>facDe(t)?.invoice_no?` · N° ${folioN(facDe(t).invoice_no)}`:''
    return <div onClick={e=>e.stopPropagation()} style={{gridColumn:'1/-1',padding:'8px 0 4px'}}>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'1fr',gap:10}}>
        {qBox('Le debes',pp.length?pp.slice(0,4).map(t=><Fragment key={t.id}>{qi(`${cliDe(t)?.name||'Sin cliente'}${fol(t)}`,fmt(saldoT(t)),()=>abrirFicha(r.p.id,'por_pagar',String(cliDe(t)?.id||'x')))}</Fragment>):<div style={{fontSize:11.5,color:C.muted}}>Nada por pagar</div>)}
        {qBox('Sujeto a cobro',cobG.length?cobG.slice(0,4).map(x=><Fragment key={x.c?.id||'x'}>{qi(`${x.c?.name||'Sin cliente'} · ${x.ts.length} factura${x.ts.length!==1?'s':''}${x.venc?`, ${x.venc} vencida${x.venc!==1?'s':''}`:''}`,fmt(x.m),()=>abrirFicha(r.p.id,'por_devengar',String(x.c?.id||'x')))}</Fragment>):<div style={{fontSize:11.5,color:C.muted}}>Nada sujeto a cobro</div>)}
        {qBox('Último movimiento',<>
          {ultPago?qi(`Le pagaste ${dmy(ultPago.fecha)}`,fmt(Math.abs(Number(ultPago.monto)||0)),onIrBanco?()=>onIrBanco(ultPago.id):null):qi('Sin pagos registrados','—')}
          {!r.equipo&&(ultDoc?qi(`Su última factura N° ${ultDoc.folio} · ${dmy(ultDoc.fecha_emision)}`,fmt(Math.abs(Number(ultDoc.monto)||0)),()=>abrirFicha(r.p.id)):qi('Sin facturas en el SII','—'))}
          {!r.equipo&&qi('Sin factura del proveedor',r.sinFac||'—',r.sinFac?()=>abrirFicha(r.p.id,'sinfac'):null)}</>)}
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}><ActBtn variant='ghost' onClick={()=>abrirFicha(r.p.id)}>Ver ficha <Gl n='chevron'/></ActBtn></div>
    </div> }
  const bolRecibida = p => { const ts=tercDe(p.id).filter(t=>est(t)==='por_pagar'&&t.bhe_id); if(!ts.length) return null; const fol=[...new Set(ts.map(t=>bheDe(t)?.folio).filter(Boolean))]
    return `Boleta${fol.length>1?'s':''} N° ${fol.join(', ')||'—'} recibida · transferir ${fmt(ts.reduce((a,t)=>a+saldoPag(t),0))}` }
  const subProv = r => bolRecibida(r.p) || [r.equipo?'Equipo':(r.p.razon_social||r.p.rut||null), r.nCli?(r.nCli===1&&r.clis[0]?r.clis[0]:`${r.nCli} clientes`):null].filter(Boolean).join(' · ')
  const filaProv = r => { const open=expP===r.p.id, cv=v=>v?fmtMill(v):dash
    return <div key={r.p.id} onClick={()=>setExpP(open?null:r.p.id)} className='pv-c' style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
      <div style={{minWidth:0}}>{celda(<span style={{fontSize:13,fontWeight:700,color:C.accent}}>{tituloProv(r.p)}</span>,()=>abrirFicha(r.p.id))}<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{subProv(r)}</div></div>
      <span style={{textAlign:'right',fontWeight:700,color:r.porPagar>0?C.soonText:C.done,...num}}>{cv(r.porPagar)}</span>
      <span style={{textAlign:'right',color:r.cob?C.text:C.done,...num}}>{cv(r.cob)}</span>
      <span style={{textAlign:'right',color:r.pagAnio?C.muted:C.done,...num}}>{cv(r.pagAnio)}</span>
      <span style={{color:C.textSoft,fontSize:11}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
      {open&&vistaRapida(r)}
    </div> }
  const tablaProv = <div style={{...card,overflow:'hidden'}}>
    <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,padding:'8px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,...kLbl,fontSize:9.5}}>{th('nombre','Proveedor')}{th('porPagar','Por pagar')}{th('cob','Sujeto a cobro')}{th('pagAnio',`Pagada ${yr}`)}<span/></div>
    {visAct.map(filaProv)}
    {visSin.length>0&&<div onClick={()=>setVerSinMov(v=>!v)} className='pv-c' style={{padding:'8px 14px',borderTop:`1px solid ${C.border}`,fontSize:11.5,fontWeight:600,color:C.muted,cursor:'pointer'}}>Sin movimiento en {yr} · {visSin.length} ({visSin.slice(0,4).map(r=>tituloProv(r.p)).join(', ')}{visSin.length>4?'…':''}) {verSinMov?<Gl n='chevU'/>:<Gl n='chevD'/>}</div>}
    {verSinMov&&visSin.map(filaProv)}
    {visAct.length>0&&<div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,padding:'9px 14px',borderTop:`1px solid ${C.border}`,fontSize:12.5,fontWeight:700}}><span>Total</span><span style={{textAlign:'right',...num}}>{fmtMill(tot('porPagar'))}</span><span style={{textAlign:'right',...num}}>{fmtMill(tot('cob'))}</span><span style={{textAlign:'right',...num}}>{fmtMill(tot('pagAnio'))}</span><span/></div>}
  </div>
  const bandL = (t,der) => <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:C.bgSoft,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}><span style={{...kLbl,flex:1}}>{t}</span>{der}</div>
  const filaMovil = (r,k) => <div key={r.p.id} onClick={()=>abrirFicha(r.p.id,k==='pp'?'por_pagar':k==='cob'?'por_devengar':'todas')} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
    <div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{tituloProv(r.p)}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k==='pp'&&r.masAnt?`${r.nPorPagar} factura${r.nPorPagar!==1?'s':''} · desde ${dmy(r.masAnt)}`:(r.clis.slice(0,3).join(' · ')||subProv(r))}</div></div>
    <div style={{textAlign:'right'}}><div style={{fontSize:13,fontWeight:700,color:k==='pp'?C.soonText:C.muted,...num}}>{fmtMill(k==='pp'?r.porPagar:k==='cob'?r.cob:r.pagAnio)}</div></div></div>
  const gPP=vis.filter(r=>r.porPagar>0).sort((a,b)=>b.porPagar-a.porPagar), gCob=vis.filter(r=>!(r.porPagar>0)&&r.cob>0).sort((a,b)=>b.cob-a.cob), gPag=vis.filter(r=>!(r.porPagar>0)&&!(r.cob>0)&&r.pagAnio>0)
  const listaProvMovil = <div style={{...card,overflow:'hidden'}}>
    {gPP.length>0&&<>{bandL(`Por pagar · ${gPP.length}`)}{gPP.map(r=>filaMovil(r,'pp'))}</>}
    {gCob.length>0&&<>{bandL(`Sujeto a cobro · ${gCob.length}`)}{gCob.map(r=>filaMovil(r,'cob'))}</>}
    {gPag.length>0&&<>{bandL(`Pagada ${yr} · ${gPag.length}`)}{gPag.map(r=>filaMovil(r,'pag'))}</>}
    {visSin.length>0&&<div onClick={()=>setVerSinMov(v=>!v)} style={{padding:'9px 12px',borderTop:`1px solid ${C.border}`,fontSize:11.5,fontWeight:600,color:C.muted,cursor:'pointer'}}>Sin movimiento en {yr} · {visSin.length} {verSinMov?<Gl n='chevU'/>:<Gl n='chevD'/>}</div>}
    {verSinMov&&visSin.map(r=>filaMovil(r,'sin'))}
  </div>
  // Por cliente: el mismo dinero visto desde el cliente (qué comisiones arrastra y a quién).
  const porCli = (()=>{ const g={}; tsTodas.forEach(t=>{ const c=cliDe(t); const k=String(c?.id||'x'); if(!g[k]) g[k]={k,c,ts:[]}; g[k].ts.push(t) })
    return Object.values(g).map(x=>{ const provs={}; x.ts.forEach(t=>{ const pk=String(t.proveedor_id); if(!provs[pk]) provs[pk]={p:proveedores.find(p=>String(p.id)===pk),pp:0,cob:0,pag:0}; const e=est(t); if(e==='por_pagar'){ if(yT(t)===yr) provs[pk].pp+=saldoT(t) } else if(e==='por_devengar'){ if(yT(t)===yr) provs[pk].cob+=saldoT(t) } else if(yOf(t.pagado_at)===yr) provs[pk].pag+=Number(t.monto)||0 })
      const ps=Object.values(provs); return {...x,ps,porPagar:ps.reduce((s,p)=>s+p.pp,0),cob:ps.reduce((s,p)=>s+p.cob,0),pagAnio:ps.reduce((s,p)=>s+p.pag,0),sinFac:0} })
      .filter(x=>(x.porPagar+x.cob+x.pagAnio>0||lf==='cobrar')&&enLf(x)&&(!qq||_normTxt(`${x.c?.name||''} ${x.ps.map(p=>tituloProv(p.p)).join(' ')}`).includes(qq)))
      .sort((a,b)=>(b.porPagar-a.porPagar)||(b.cob-a.cob)||(b.pagAnio-a.pagAnio)) })()
  const filaCli = x => { const open=expP==='c:'+x.k, cv=v=>v?fmt(v):dash
    return <div key={x.k} onClick={()=>setExpP(open?null:'c:'+x.k)} className='pv-c' style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
      <div style={{minWidth:0}}>{x.c?celda(<span style={{...NOMBRE_CLI}}>{x.c.name}</span>,onOpenClientFicha?()=>onOpenClientFicha(x.c.id):null):<span style={{fontSize:13,fontWeight:700,color:C.muted}}>Sin cliente</span>}<div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.ps.map(p=>tituloProv(p.p)).join(' · ')}</div></div>
      <span style={{textAlign:'right',fontWeight:700,color:x.porPagar>0?C.soonText:C.done,...num}}>{cv(x.porPagar)}</span>
      <span style={{textAlign:'right',color:x.cob?C.text:C.done,...num}}>{cv(x.cob)}</span>
      <span style={{textAlign:'right',color:x.pagAnio?C.muted:C.done,...num}}>{cv(x.pagAnio)}</span>
      <span/><span style={{color:C.textSoft,fontSize:11}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
      {open&&<div onClick={e=>e.stopPropagation()} style={{gridColumn:'1/-1',padding:'6px 0 2px',display:'grid',gap:2}}>{x.ps.map(p=><Fragment key={p.p?.id||'x'}>{qi(`${tituloProv(p.p)}${p.pp?` · por pagar ${fmt(p.pp)}`:''}${p.cob?` · sujeto a cobro ${fmt(p.cob)}`:''}`,fmt(p.pp+p.cob+p.pag),p.p?()=>abrirFicha(p.p.id,'todas',x.k):null)}</Fragment>)}</div>}
    </div> }
  const tablaCli = <div style={{...card,overflow:'hidden'}}>
    <div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,padding:'8px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,...kLbl,fontSize:9.5}}><span>Cliente</span><span style={{textAlign:'right'}}>Por pagar</span><span style={{textAlign:'right'}}>Sujeto a cobro</span><span style={{textAlign:'right'}}>Pagada {yr}</span><span/><span/></div>
    {porCli.length?porCli.map(filaCli):<div style={{padding:'16px 14px',fontSize:12.5,color:C.muted}}>Nada en este filtro.</div>}
  </div>
  const listaCliMovil = <div style={{...card,overflow:'hidden'}}>{porCli.map(x=><div key={x.k} onClick={()=>{ if(x.ps.length===1&&x.ps[0].p) abrirFicha(x.ps[0].p.id,'todas',x.k); else setExpP(expP==='c:'+x.k?null:'c:'+x.k) }} style={{padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
    <div style={{display:'flex',alignItems:'baseline',gap:8}}><span style={{flex:1,minWidth:0,fontSize:13.5,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{x.c?.name||'Sin cliente'}</span><span style={{fontSize:13,fontWeight:700,color:x.porPagar>0?C.soonText:C.muted,...num}}>{fmt(x.porPagar||x.cob||x.pagAnio)}</span></div>
    <div style={{fontSize:11,color:C.muted}}>{x.ps.map(p=>tituloProv(p.p)).join(' · ')}{x.porPagar>0?' · por pagar':x.cob>0?' · sujeto a cobro':''}</div>
    {expP==='c:'+x.k&&<div style={{marginTop:6}} onClick={e=>e.stopPropagation()}>{x.ps.map(p=><Fragment key={p.p?.id||'x'}>{qi(tituloProv(p.p),fmt(p.pp+p.cob+p.pag),p.p?()=>abrirFicha(p.p.id,'todas',x.k):null)}</Fragment>)}</div>}
  </div>)}</div>
  const exportar = () => modo==='cli'
    ? exportCSV(`comisiones_por_cliente.csv`,['Cliente','Proveedores','Por pagar','Sujeto a cobro',`Pagada ${yr}`],porCli.map(x=>[x.c?.name||'Sin cliente',x.ps.map(p=>tituloProv(p.p)).join(' · '),Math.round(x.porPagar),Math.round(x.cob),Math.round(x.pagAnio)]))
    : exportCSV(`proveedores.csv`,['Proveedor','Razón social','RUT','Clientes','Por pagar','Sujeto a cobro',`Pagada ${yr}`,'Sin factura del proveedor','Comisiones por cobrar'],[...vis.map(r=>[tituloProv(r.p),r.p.razon_social||'',r.p.rut||'',r.clis.join(' · '),Math.round(r.porPagar),Math.round(r.cob),Math.round(r.pagAnio),r.sinFac,Math.round(r.porCobrarTe)]),['TOTAL','','','',Math.round(vis.reduce((s,r)=>s+r.porPagar,0)),Math.round(vis.reduce((s,r)=>s+r.cob,0)),Math.round(vis.reduce((s,r)=>s+r.pagAnio,0)),vis.reduce((s,r)=>s+r.sinFac,0),Math.round(vis.reduce((s,r)=>s+r.porCobrarTe,0))]])
  const segModo = <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>{[['prov','Por proveedor'],['cli','Por cliente']].map(([k,l])=><span key={k} onClick={()=>{setModo(k);setExpP(null)}} style={{fontSize:12,fontWeight:700,padding:'6px 12px',cursor:'pointer',background:modo===k?C.accent:C.card,color:modo===k?'#fff':C.muted}}>{l}</span>)}</div>
  const btnExcelL = <span onClick={exportar} title='Descargar Excel' style={{height:30,width:32,display:'inline-flex',alignItems:'center',justifyContent:'center',border:`1px solid ${C.border}`,borderRadius:8,background:C.card,cursor:'pointer'}}><SIcon n='download' s={14} c={C.accent}/></span>
  const itsCob = filasL.flatMap(r=>r.caItems.map(x=>({...x,prov:r.p}))), itsPend=itsCob.filter(x=>!x.cob).sort((a,b)=>String(a.b.issued_at).localeCompare(String(b.b.issued_at))), itsAnio=itsCob.filter(x=>x.cob&&String(x.b.paid_at||x.b.issued_at||'').slice(0,4)===String(yr)).sort((a,b)=>String(b.b.paid_at).localeCompare(String(a.b.paid_at)))
  const listaCobrar = <div style={{...card,overflow:'hidden'}}>
    <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px 6px'}}><span style={kLbl}>Por cobrar</span><b style={{fontSize:13,...num}}>{fmt(porCobrarTot)}</b></div>
    {itsPend.length?itsPend.map(x=>filaCob(x,x.prov)):<div style={{padding:'8px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Nada por cobrar</div>}
    <div style={{display:'flex',justifyContent:'space-between',padding:'10px 14px 6px',borderTop:`1px solid ${C.border}`}}><span style={kLbl}>Cobradas {yr}</span><b style={{fontSize:13,...num}}>{fmt(cobAnioTot)}</b></div>
    {itsAnio.length?itsAnio.map(x=>filaCob(x,x.prov)):<div style={{padding:'8px 14px',fontSize:12,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Ninguna en {yr}</div>}
  </div>
  const lfTxt = lf!=='todos' ? <span style={{fontSize:11.5,color:C.muted}}>Filtro: <b style={{color:C.accent}}>{({por_pagar:'Por pagar',por_devengar:'Sujeto a cobro',pagada:`Pagada ${yr}`,cobrar:'Comisiones por cobrar',sinfac:'Sin factura del proveedor'})[lf]}</b> {link('Quitar',()=>setLf('todos'),C.accent)}</span> : null
  return (<div>{css}
    <PageHeader origen={origen} onBack={onBack} titulo='Proveedores' ctx={isDesktop?`${proveedores.length} proveedores`:null} right={<span style={{display:'inline-flex',gap:8,alignItems:'center'}}>{selAnio}{isDesktop&&btnExcelL}<ActBtn variant='primary' onClick={abrirNuevo} title='Nuevo proveedor'>{isDesktop?'+ Nuevo':'+'}</ActBtn></span>}/>
    {wrap(<>
      {tilesL}
      {revisarL}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:isDesktop?'nowrap':'wrap'}}>
        <Buscador value={q} onChange={setQ} placeholder='Buscar proveedor, cliente o RUT…' style={{flex:1,minWidth:isDesktop?200:'100%'}}/>
        {segModo}{lfTxt}
      </div>
      {lf==='cobrar' ? listaCobrar : modo==='cli' ? (isDesktop?tablaCli:listaCliMovil) : (vis.length===0 ? <div style={{...card,padding:24,textAlign:'center',color:C.muted,fontSize:13}}>{q.trim()||lf!=='todos'?'Sin resultados':'Aún no hay proveedores. Agrega el primero.'}</div> : (isDesktop?tablaProv:listaProvMovil))}
    </>)}
  </div>)
}

