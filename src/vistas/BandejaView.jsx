// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { tasaBHE } from '../../supabase/functions/_shared/comisionesReglas.js'
import { claveVentaFactura } from '../../supabase/functions/_shared/facturacionReglas.js'
import { BRAND, C, SEC_LBL, appAlert, fmt, fmtFechaDMY, isoLocal, personChip } from '../lib/base.jsx'
import { PageHeader, _DEMO_BANDEJA, abrirDocumento, aprenderVenta, asignarVentaFactura, correoMarcaHtml, enviarComoUsuario, fechaHoraCL, firmaDefault, logActividad, pctBHE, pillPersonaSty, registrarError, registrarFondoPropuesto, setLearningKV, txtEnviado } from '../lib/compartido.jsx'

// Pedido de boleta a un colaborador (agente comisiones-documentos): el borrador se arma con BRAND (receptor) y los datos de la propuesta.
export const borradorPedidoBoleta = p => { const L=p.lineas||[], uno=L.length===1, l0=L[0]||{}, tot=k=>L.reduce((a,l)=>a+(Number(l[k])||0),0), pila=String(p.nombre||'').trim().split(/\s+/)[0]
  const trab=uno?(l0.trabajo?`por la comisión del trabajo "${l0.trabajo}"${l0.factura?` (Factura N° ${l0.factura}${l0.pago_cliente?`, pagada por el cliente el ${fmtFechaDMY(l0.pago_cliente)}`:''})`:''}`:'por la comisión'):`por ${L.length} comisiones`
  return [`${pila}:`,'','Espero que estés muy bien.','',
    `${uno?`El ${fmtFechaDMY(l0.pagado_at)} te transferimos ${fmt(tot('liquido'))}`:`Te transferimos ${fmt(tot('liquido'))}`} ${trab}. Para registrar el pago, te agradeceré emitir la boleta de honorarios con estos datos:`,'',
    `  Receptor: ${BRAND.nombreLegal||BRAND.nombre}`, ...(BRAND.rut?[`  RUT: ${BRAND.rut}`]:[]),
    `  Glosa: ${uno&&l0.trabajo?`Comisión ${l0.trabajo}`:'Comisiones'}`,
    `  Bruto: ${fmt(tot('bruto'))}`, `  Retención ${pctBHE(p.tasa||tasaBHE(l0.pagado_at))}: ${fmt(tot('retencion'))}`, `  Líquido (ya transferido): ${fmt(tot('liquido'))}`,'',
    'Saludos cordiales,'].join('\n') }

export const asuntoPedidoBoleta = p => { const L=p.lineas||[], l0=L[0]||{}, b=L.reduce((a,l)=>a+(Number(l.bruto)||0),0); return `Boleta de honorarios · ${L.length===1&&l0.trabajo?`comisión ${l0.trabajo}`:'comisiones'} · ${fmt(b)}` }

export const BANDEJA_BTN = {registrar_factura:'Abrir en Facturación',asignar_venta:'Asignar',adjuntar_respaldo:'Adjuntar al gasto',registrar_fondo:'Registrar fondo',registrar_solicitud:'Confirmar',crear_tarea:'Crear tarea',guardar_cuenta:'Guardar cuenta',conciliar:'Conciliar en Banco',cargar_notaria:'Cargar liquidación',revisar:'Revisado',pedir_boleta:'Enviar el pedido'}

// La venta sugerida no corresponde a esta factura: se recuerda (no se vuelve a sugerir para la misma clave) y se liberan sus cuotas.
export async function rechazarVentaFactura(facturaId,saleId){
  if(DEMO||!facturaId||!saleId) return
  const {data:f}=await supabase.from('billing').select('client_id,concept,receptor_rut').eq('id',facturaId).maybeSingle()
  await supabase.from('learnings').delete().eq('kind','cuota_no_emitir').eq('value',`cubierta:${facturaId}`)
  if(f) await aprenderVenta('venta_factura_no',claveVentaFactura(f),saleId)
}

export const _MES_ES = {ene:0,feb:1,mar:2,abr:3,may:4,jun:5,jul:6,ago:7,sep:8,sept:8,set:8,oct:9,nov:10,dic:11}

// Fecha y autor de nuestra solicitud citada bajo la respuesta («El lun, 19 oct 2026 a las 16:01, Erasmo Escala (<ee@…>) escribió:»).
export function solicitudCitada(cuerpo){
  const t=String(cuerpo||''), m=t.match(/El\s+\S+,\s+(\d{1,2})\s+([a-zá]+)\.?\s+(\d{4})\s+a\s+las\s+(\d{1,2}):(\d{2}),\s*([^(<\n]+?)\s*\(?<([\w.+-]+@[\w.-]+)>/i)
  if(!m) return null
  const mes=_MES_ES[m[2].toLowerCase().slice(0,4)]??_MES_ES[m[2].toLowerCase().slice(0,3)]
  const d=mes==null?null:new Date(Number(m[3]),mes,Number(m[1]),Number(m[4]),Number(m[5]))
  return {fecha:d&&!isNaN(d)?d.toISOString():null, autor:m[6].trim().split(/\s+/)[0]||null, email:m[7].toLowerCase()}
}

export const asuntoBase = s => String(s||'').replace(/^((re|rv|fw|fwd)\s*:\s*)+/i,'').trim()

export function BandejaView({isDesktop, onBack, origen, clients=[], sales=[], expenses=[], user, onOpenClientFicha, onIrBanco, onCargarNotaria, onTareaCreada, onFondoRegistrado, onIrFacturasSII, onIrSinVenta}){
  const [elegido,setElegido]=useState({})   // adjuntar_respaldo: gasto elegido por tarjeta
  const [paraBoleta,setParaBoleta]=useState({})   // pedir_boleta: correo del colaborador (se aprende al enviar)
  const [rows,setRows]=useState(null), [err,setErr]=useState(null), [busy,setBusy]=useState(null), [abierto,setAbierto]=useState(null), [verSin,setVerSin]=useState(false)
  const cliPorId=useMemo(()=>new Map((clients||[]).map(c=>[String(c.id),c])),[clients])
  const yo=user?.name||'Oficina'
  const patch=async(id,cambios)=>{ if(!DEMO){ const {error}=await supabase.from('agente_bandeja').update(cambios).eq('id',id); if(error) throw error } setRows(p=>(p||[]).map(r=>r.id===id?{...r,...cambios}:r)) }
  // Cierre automático: lo que ya se resolvió por otra vía (el depósito se concilió en Banco, la liquidación se cargó en Notaría).
  const autoCerrar=async lista=>{ if(DEMO) return
    const conc=lista.filter(r=>r.estado==='pendiente'&&r.propuesta?.accion==='conciliar'&&r.propuesta?.movimiento_id)
    if(conc.length){ const {data:movs}=await supabase.from('cartola_movimientos').select('id,estado,fecha,monto').in('id',conc.map(r=>r.propuesta.movimiento_id))
      for(const r of conc){ const mv=(movs||[]).find(m=>String(m.id)===String(r.propuesta.movimiento_id)); if(mv&&mv.estado==='conciliado') await patch(r.id,{estado:'registrado',motivo:`Depósito del ${fmtFechaDMY(mv.fecha)} ya conciliado`,resuelto_at:new Date().toISOString()}).catch(()=>{}) } }
    const nota=lista.filter(r=>r.estado==='pendiente'&&r.propuesta?.accion==='cargar_notaria')
    if(nota.length){ const desde=new Date(Math.min(...nota.map(r=>new Date(r.recibido_at).getTime()))-86400000).toISOString()
      const {data:bi}=await supabase.from('bulk_imports').select('created_at,resumen').eq('status','active').gte('created_at',desde).order('created_at',{ascending:true})
      for(const r of nota){ const b=(bi||[]).find(x=>x.resumen?.notaria&&new Date(x.created_at)>=new Date(new Date(r.recibido_at).getTime()-86400000)); if(!b) continue
        const mot=`Liquidación cargada el ${fmtFechaDMY(isoLocal(b.created_at))}`
        const gc=r.propuesta?.guardar_cuenta
        await patch(r.id,gc?{propuesta:{accion:'guardar_cuenta',titulo:'Guardar la cuenta de la notaría como conocida',...gc},tipo:'cuenta_bancaria',motivo:mot}:{estado:'registrado',motivo:mot,resuelto_at:new Date().toISOString()}).catch(()=>{}) } } }
  useEffect(()=>{ let on=true
    if(DEMO){ setRows(_DEMO_BANDEJA); return }
    const hace30=new Date(Date.now()-30*86400000).toISOString()
    // Orden por fecha de ENTRADA a la Bandeja (created_at): una factura registrada días después de emitida queda arriba, no al fondo.
    supabase.from('agente_bandeja').select('*').or(`estado.in.(pendiente,sospechoso),created_at.gte.${hace30}`).order('created_at',{ascending:false}).limit(400)
      .then(({data,error})=>{ if(!on) return; if(error){ setErr(error.message); return } setRows(data||[]); autoCerrar(data||[]).catch(()=>{}) },e=>on&&setErr(e.message||String(e)))
    return ()=>{ on=false } },[])   // eslint-disable-line react-hooks/exhaustive-deps
  const nombreCli=r=>{ const c=r.cliente_id?cliPorId.get(String(r.cliente_id)):null; return c?.name||r.cliente_nombre||(r.tipo==='liquidacion_notaria'||/notar/i.test(r.de||'')?`Notaría · ${r.de_nombre||r.de}`:(r.de_nombre||r.de)) }
  const montoDe=r=>{ const e=(r.evidencia||[]).find(x=>x.monto!=null); return e?Number(e.monto):null }
  const hecho=async(r,cambios,log)=>{ await patch(r.id,{...cambios,resuelto_por:yo,resuelto_at:new Date().toISOString()}); logActividad('agente.'+(log||'confirmado'),{tabla:'agente_bandeja',id:r.id,detalle:{cliente:nombreCli(r),title:cambios.motivo||'Correo del agente resuelto'}}) }
  const confirmar=async r=>{ const p=r.propuesta||{}, a=p.accion
    if(a==='conciliar'){ onIrBanco&&onIrBanco(p.movimiento_id); return }
    if(a==='registrar_factura'){ onIrFacturasSII&&onIrFacturasSII(); return }
    if(a==='asignar_venta'&&!(p.cuotas||[]).length){ onIrSinVenta&&onIrSinVenta(); return }   // varias ventas, ninguna sugerida: se asigna en Facturación › Por clasificar; la propuesta se cierra sola   // la registra el motor de Facturación (Cargadas sin registrar); la propuesta se cierra sola al quedar registrada
    if(a==='cargar_notaria'){ onCargarNotaria&&onCargarNotaria(p.path?{path:p.path,nombre:p.nombre||'Liquidación notaría.xlsx'}:null); return }
    setBusy(r.id)
    try{
      if(a==='pedir_boleta'){
        const to=String(paraBoleta[r.id]??p.para??'').trim(); if(!to) throw new Error('Falta el correo del colaborador.')
        const em=String(user?.email||'').toLowerCase(); let firma=firmaDefault(em)||{nombre:user?.name||'',cargo:'',telefono:''}
        if(!DEMO&&em){ const {data:fr}=await supabase.from('learnings').select('value').eq('kind','firma_correo').eq('key',em).order('updated_at',{ascending:false}).limit(1).maybeSingle(); if(fr?.value){ try{ firma={...firma,...JSON.parse(fr.value)} }catch(_){} } }
        const text=borradorPedidoBoleta(p), subject=asuntoPedidoBoleta(p)
        const via=DEMO?'usuario':await enviarComoUsuario({to, subject, html:correoMarcaHtml(text,'Boleta de honorarios',firma,false), text, que:'El pedido de boleta'})
        if(!via){ setBusy(null); return }
        if(!DEMO&&p.proveedor_id&&to!==p.para){ try{ await setLearningKV('proveedor_email',String(p.proveedor_id),to) }catch(e){registrarError({origen:'accion',vista:'proveedor_email',err:e})} }
        await hecho(r,{estado:'espera',motivo:`Pedido enviado el ${fmtFechaDMY(new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'}))} · boleta por recibir`},'boleta_pedida')
        appAlert(txtEnviado(via,{que:'Pedido de boleta',g:'o',para:to}))
      } else if(a==='definir_documento'){
        const doc=r._doc; if(!['boleta','factura','ninguno'].includes(doc)) throw new Error('Elige boleta o factura.')
        if(!DEMO&&p.proveedor_id){ if(doc==='ninguno') await setLearningKV('proveedor_sin_documento',String(p.proveedor_id),JSON.stringify({motivo:'No emite boleta ni factura',quien:yo,fecha:new Date().toLocaleDateString('en-CA',{timeZone:'America/Santiago'})})); else { const {error}=await supabase.from('proveedores').update({documento:doc}).eq('id',p.proveedor_id); if(error) throw error } }
        await hecho(r,{estado:'resuelto',motivo:doc==='ninguno'?`${p.nombre||'Colaborador'} no emite documento`:`${p.nombre||'Colaborador'} emite ${doc}`},'documento_definido')
      } else if(a==='adjuntar_respaldo'){
        const cs=p.candidatos||[], gid=elegido[r.id]||(cs.length===1?cs[0].id:null), g=cs.find(x=>String(x.id)===String(gid))
        if(!g) throw new Error(cs.length?'Elige el gasto.':'Aún no hay un gasto por ese monto.')
        if(!p.path) throw new Error('El documento no quedó guardado.')
        if(!DEMO){ const {data:ya}=await supabase.from('expense_attachments').select('id').eq('expense_id',g.id).eq('storage_path',p.path).limit(1)
          if(!ya?.length){ const {error}=await supabase.from('expense_attachments').insert({expense_id:g.id,name:p.nombre||'Respaldo.pdf',storage_path:p.path,uploaded_by:yo}); if(error) throw error } }
        await hecho(r,{estado:'resuelto',motivo:`Respaldo adjuntado al gasto de ${g.cliente} ${fmt(g.monto)} del ${fmtFechaDMY(g.fecha)}`},'respaldo_adjuntado')
      } else if(a==='registrar_fondo'){
        const c=await registrarFondoPropuesto(r,{proyecto:p.proyecto||null,yo,sales,expenses,onFondo:onFondoRegistrado})
        setRows(q=>(q||[]).map(x=>x.id===r.id?{...x,...c}:x))
      } else if(a==='registrar_solicitud'){
        const montos=(p.montos||[]).map(Number).filter(n=>n>0); if(!montos.length) throw new Error('El correo no trae el monto de la solicitud.')
        const cit=solicitudCitada(r.cuerpo), asu=asuntoBase(r.asunto)||'Solicitud de fondos'
        if(!DEMO){
          // Nunca dos veces: si ya existe una solicitud del cliente con el mismo monto y asunto, no se vuelve a registrar.
          const {data:ya}=await supabase.from('fund_requests').select('id,monto,asunto').eq('client_id',r.cliente_id).gte('enviada_at',new Date(Date.now()-60*86400000).toISOString())
          const nuevos=montos.filter(m=>!(ya||[]).some(f=>Math.round(Number(f.monto))===m&&String(f.asunto||'').trim().toLowerCase()===asu.toLowerCase()))
          if(nuevos.length){ const {error}=await supabase.from('fund_requests').insert(nuevos.map(m=>({client_id:r.cliente_id,monto:m,asunto:asu,para:p.para||r.de,enviada_por:cit?.autor||r.abogado||yo,enviada_at:cit?.fecha||r.recibido_at,n_adjuntos:0}))); if(error) throw error }
        }
        await hecho(r,{estado:'espera',motivo:'Solicitud registrada · por recibir'},'solicitud_registrada')
      } else if(a==='crear_tarea'){
        const who=p.asignado||r.abogado||yo, title=String(p.tarea||'').trim()||asuntoBase(r.asunto)
        if(!DEMO){
          const {data:ya}=await supabase.from('tasks').select('id').eq('client_id',r.cliente_id).eq('title',title).neq('status','Terminado').limit(1)
          if(!ya?.length){ const {data:t,error}=await supabase.from('tasks').insert({title,who,assignees:[who],client_id:r.cliente_id||null,status:'Activo',note:`Correo de ${r.de_nombre||r.de} (${r.de}) del ${fechaHoraCL(r.recibido_at)} · ${r.asunto}`,assigned_by:yo}).select().single(); if(error) throw error; onTareaCreada&&onTareaCreada(t) }
          // Aprende el correo del cliente (se reconoció por el nombre): la próxima vez lo identifica por la dirección.
          if(p.aprender_email&&r.cliente_id){ const {data:c}=await supabase.from('contacts').select('id').eq('client_id',r.cliente_id).ilike('email',p.aprender_email).limit(1); if(!c?.length) await supabase.from('contacts').insert({client_id:r.cliente_id,nombre:r.de_nombre||p.aprender_email.split('@')[0],email:p.aprender_email}) }
        }
        await hecho(r,{estado:'resuelto',motivo:`Tarea creada a ${who}`},'tarea_creada')
      } else if(a==='guardar_cuenta'){
        if(!p.dominio||!p.cuenta) throw new Error('Falta la cuenta o el remitente.')
        if(!DEMO) await setLearningKV('cuenta_conocida',p.dominio,JSON.stringify({cuenta:p.cuenta,banco:p.banco||null,rut:p.rut||null}))
        await hecho(r,{estado:'resuelto',motivo:'Cuenta guardada como conocida'},'cuenta_guardada')
      } else if(a==='asignar_venta'){
        await asignarVentaFactura({facturaId:p.billing_id,saleId:p.sale_id,cuotaIds:p.cuotas||[],sugerida:p.sale_id,venta:p.venta})
        await hecho(r,{estado:'registrado',motivo:`Factura N° ${p.folio} asignada a «${p.venta}» · reemplaza ${(p.cuotas||[]).length} cuotas`},'venta_asignada')
      } else if(a==='revisar'){
        await hecho(r,{estado:'resuelto',motivo:`Revisado por ${yo}`},'revisado')
      }
    }catch(e){ appAlert('No se pudo completar: '+(e.message||e)) }
    setBusy(null) }
  // Cuenta guardada junto a la liquidación pendiente (mismo correo): se guarda sin cerrar la carga.
  const guardarCuentaAnexa=async r=>{ const gc=r.propuesta?.guardar_cuenta; if(!gc) return; setBusy(r.id)
    try{ if(!DEMO) await setLearningKV('cuenta_conocida',gc.dominio,JSON.stringify({cuenta:gc.cuenta,banco:gc.banco||null,rut:gc.rut||null}))
      const {guardar_cuenta,...resto}=r.propuesta; await patch(r.id,{propuesta:resto}); logActividad('agente.cuenta_guardada',{tabla:'agente_bandeja',id:r.id,detalle:{title:`Cuenta ${gc.cuenta} guardada como conocida`}}) }catch(e){ appAlert('No se pudo guardar: '+(e.message||e)) }
    setBusy(null) }
  const descartar=async(r,como='Descartado')=>{ setBusy(r.id); try{
      const p=r.propuesta||{}
      // «No corresponde» a una venta sugerida: las cuotas vuelven a la proyección y la factura queda sin venta (Facturación › Por clasificar).
      if(p.accion==='asignar_venta'){ await rechazarVentaFactura(p.billing_id,p.sale_id); await hecho(r,{estado:'descartado',motivo:`No corresponde a «${p.venta||'la venta sugerida'}» · la factura queda sin venta (${yo})`},'venta_rechazada') }
      else await hecho(r,{estado:'descartado',motivo:`${como} por ${yo}`},'descartado') }catch(e){ appAlert('No se pudo descartar: '+(e.message||e)) } setBusy(null) }
  const restaurar=async r=>{ setBusy(r.id); try{ await patch(r.id,{estado:r.propuesta?.accion?'pendiente':'sin_accion',resuelto_por:null,resuelto_at:null,motivo:null}); logActividad('agente.restaurado',{tabla:'agente_bandeja',id:r.id,detalle:{title:'Correo del agente restaurado'}}) }catch(e){ appAlert('No se pudo restaurar: '+(e.message||e)) } setBusy(null) }
  const card={background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}
  const wrap=ch=><div style={isDesktop?{maxWidth:1120,margin:'0 auto',padding:'12px 20px 40px'}:{padding:'8px 16px 40px'}}>{ch}</div>
  const lista=rows||[]
  const G={pend:lista.filter(r=>r.estado==='pendiente'), hech:lista.filter(r=>['registrado','espera','resuelto'].includes(r.estado)), sosp:lista.filter(r=>r.estado==='sospechoso')}
  G.sin=lista.filter(r=>!G.pend.includes(r)&&!G.hech.includes(r)&&!G.sosp.includes(r))
  const partes=[['Pendientes',G.pend.length,C.soonText,C.soonBg],['Ya registrados',G.hech.length,C.greenText,C.greenBg],['Sospechosos',G.sosp.length,G.sosp.length?C.overdueText:C.textSoft,G.sosp.length?C.overdueBg:C.bgSoft],['Sin acción',G.sin.length,C.textSoft,C.bgSoft]]
  const chipAbg=n=>n?<span style={{...pillPersonaSty(personChip(n),false),cursor:'default',fontSize:10.5,padding:'2px 9px'}}>{n}</span>:null
  const linkCli=r=>{ const nm=nombreCli(r); return r.cliente_id&&onOpenClientFicha?<b onClick={e=>{e.stopPropagation();onOpenClientFicha(r.cliente_id)}} style={{fontSize:14,color:C.accent,cursor:'pointer',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{nm}</b>:<b style={{fontSize:14,color:C.accent,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{nm}</b> }
  const tituloProp=r=>{ const p=r.propuesta||{}
    if(isDesktop) return p.titulo||'Revisar el correo'
    if(p.accion==='crear_tarea') return `Tarea a ${p.asignado||r.abogado||yo}: ${String(p.tarea||'').charAt(0).toLowerCase()}${String(p.tarea||'').slice(1)}`
    if(p.accion==='guardar_cuenta') return 'Guardar cuenta como conocida'
    if(p.accion==='revisar') return 'Revisar el comprobante'
    return p.titulo||'Revisar el correo' }
  const lineaDato=(t,v,k)=><div key={k} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,marginTop:4}}><span style={{color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>{t}</span><b style={{color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{v}</b></div>
  const adjuntos=r=>(r.adjuntos||[]).length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:7}}>{r.adjuntos.map((a,i)=><span key={i} onClick={e=>{e.stopPropagation(); if(a.path&&!DEMO) abrirDocumento(a.path)}} style={{fontSize:10.5,fontWeight:600,borderRadius:20,padding:'2px 9px',background:C.bgSoft,color:a.path?C.accent:C.textSoft,cursor:a.path?'pointer':'default',maxWidth:'100%',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.nombre}</span>)}</div>
  const cuerpo=r=>abierto===r.id&&r.cuerpo&&<div style={{marginTop:8,fontSize:11.5,color:C.text,whiteSpace:'pre-wrap',background:C.bgSoft,borderRadius:10,padding:'8px 10px',maxHeight:260,overflowY:'auto'}}>{r.cuerpo}</div>
  const btnSec={fontSize:12.5,fontWeight:600,color:C.accent,background:'none',border:'none',padding:'7px 10px',cursor:'pointer'}
  const btnPri={fontSize:12.5,fontWeight:700,color:'#fff',background:C.accent,border:'none',borderRadius:9,padding:'7px 14px',cursor:'pointer',whiteSpace:'nowrap'}
  const tarjeta=r=>{ const p=r.propuesta||{}, ev=r.evidencia||[], montos=ev.filter(x=>x.monto!=null), b=busy===r.id, sosp=r.estado==='sospechoso'
    return <div key={r.id} onClick={()=>setAbierto(abierto===r.id?null:r.id)} style={{...card,padding:isDesktop?'12px 16px':'11px 12px',marginBottom:10,cursor:'pointer'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0}}>{linkCli(r)}{chipAbg(r.abogado)}<span style={{flex:1}}/>{isDesktop&&<span style={{fontSize:11,color:C.textSoft,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fechaHoraCL(r.recibido_at)}</span>}</div>
      <div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:2,fontVariantNumeric:'tabular-nums'}}>{isDesktop?`${r.de_nombre?r.de_nombre+' · ':''}${r.de}`:`${r.de_nombre||r.de} · ${fechaHoraCL(r.recibido_at)}`}</div>
      <div style={{fontSize:12,color:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{r.asunto||'(sin asunto)'}</div>
      <div style={{background:sosp?C.overdueBg:C.bgSoft,borderRadius:10,padding:'9px 11px',marginTop:9}}>
        <div style={{fontSize:12.5,fontWeight:700,color:sosp?C.overdueText:C.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sosp?(isDesktop?'Datos bancarios distintos de los conocidos':'Datos bancarios distintos'):tituloProp(r)}</div>
        {ev.map((x,i)=>lineaDato(x.texto,x.monto!=null?fmt(x.monto):x.valor,i))}
        {montos.length>1&&!['pedir_boleta','definir_documento','asignar_venta'].includes(p.accion)&&<div style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:12,marginTop:5,paddingTop:5,borderTop:`1px solid ${C.border}`}}><span style={{color:C.textSoft}}>Total por recibir</span><b style={{color:C.text,fontVariantNumeric:'tabular-nums'}}>{fmt(montos.reduce((s,x)=>s+Number(x.monto||0),0))}</b></div>}
        {r.motivo&&<div style={{fontSize:11,color:C.textSoft,marginTop:5,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.motivo}</div>}
        {p.accion==='adjuntar_respaldo'&&(p.candidatos||[]).length>0&&<div onClick={e=>e.stopPropagation()} style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${C.border}`}}>
          <select value={elegido[r.id]||((p.candidatos||[]).length===1?p.candidatos[0].id:'')} onChange={e=>setElegido(o=>({...o,[r.id]:e.target.value}))} style={{width:'100%',fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 8px',color:C.text,background:C.surface}}>
            {(p.candidatos||[]).length>1&&<option value=''>Elige el gasto</option>}
            {(p.candidatos||[]).map(g=><option key={g.id} value={g.id}>{fmtFechaDMY(g.fecha)} · {g.cliente} · {fmt(g.monto)} · {g.concepto}</option>)}
          </select></div>}
        {p.accion==='pedir_boleta'&&<div onClick={e=>e.stopPropagation()} style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${C.border}`}}>
          <input value={paraBoleta[r.id]??p.para??''} onChange={e=>setParaBoleta(o=>({...o,[r.id]:e.target.value}))} placeholder='Correo del colaborador' style={{width:'100%',fontSize:12,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 8px',color:C.text,background:C.surface,boxSizing:'border-box'}}/>
          {abierto===r.id&&<div style={{marginTop:8,fontSize:11.5,color:C.text,whiteSpace:'pre-wrap',background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px'}}><b>{asuntoPedidoBoleta(p)}</b>{'\n\n'}{borradorPedidoBoleta(p)}</div>}
        </div>}
        {p.guardar_cuenta&&<div onClick={e=>e.stopPropagation()} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:6,paddingTop:6,borderTop:`1px solid ${C.border}`}}><span style={{fontSize:11.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',minWidth:0}}>Cuenta {p.guardar_cuenta.banco||''} {p.guardar_cuenta.cuenta}</span><button disabled={b} onClick={()=>guardarCuentaAnexa(r)} style={{...btnSec,padding:'3px 4px',fontSize:11.5}}>Guardar cuenta</button></div>}
      </div>
      {adjuntos(r)}
      {cuerpo(r)}
      <div onClick={e=>e.stopPropagation()} style={{display:'flex',gap:6,marginTop:9,justifyContent:'flex-end'}}>
        {sosp?<button disabled={b} onClick={()=>descartar(r,'Archivado')} style={btnPri}>{b?'Guardando…':'Archivar'}</button>
          :p.accion==='definir_documento'?<><button disabled={b} onClick={()=>descartar(r)} style={btnSec}>Descartar</button><button disabled={b} onClick={()=>confirmar({...r,_doc:'ninguno'})} style={btnSec}>No emite</button><button disabled={b} onClick={()=>confirmar({...r,_doc:'factura'})} style={{...btnSec,border:`1px solid ${C.border}`,borderRadius:9}}>Factura</button><button disabled={b} onClick={()=>confirmar({...r,_doc:'boleta'})} style={{...btnPri,opacity:b?.6:1}}>{b?'Guardando…':'Boleta'}</button></>
          :<><button disabled={b} onClick={()=>descartar(r)} style={btnSec}>{p.accion==='asignar_venta'&&(p.cuotas||[]).length?'No corresponde':'Descartar'}</button>{p.accion==='pedir_boleta'&&abierto!==r.id&&<button onClick={()=>setAbierto(r.id)} style={btnSec}>Ver el correo</button>}<button disabled={b} onClick={()=>confirmar(r)} style={{...btnPri,opacity:b?.6:1}}>{b?'Enviando…':p.accion==='asignar_venta'&&!(p.cuotas||[]).length?'Abrir en Facturación':(BANDEJA_BTN[p.accion]||'Revisado')}</button></>}
      </div>
    </div> }
  const filaHecha=(r,i,conRest)=>{ const m=montoDe(r)
    return <div key={r.id} onClick={()=>setAbierto(abierto===r.id?null:r.id)} style={{padding:isDesktop?'10px 14px':'9px 12px',borderTop:i?`1px solid ${C.track}`:'none',cursor:'pointer'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',gap:6,alignItems:'center',minWidth:0}}>{linkCli(r)}{isDesktop&&chipAbg(r.abogado)}</div>
          <div style={{fontSize:11,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.motivo||r.resumen||'—'}</div>
          <div style={{fontSize:10.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontVariantNumeric:'tabular-nums'}}>{isDesktop?`${r.de_nombre||r.de} · ${fechaHoraCL(r.recibido_at)}`:`correo ${fechaHoraCL(r.recibido_at)}`}</div>
        </div>
        {m!=null&&<b style={{fontSize:13,color:C.text,fontVariantNumeric:'tabular-nums',flexShrink:0}}>{fmt(m)}</b>}
        {conRest&&r.estado==='descartado'&&<button disabled={busy===r.id} onClick={e=>{e.stopPropagation();restaurar(r)}} style={{...btnSec,padding:'3px 4px',fontSize:11.5,flexShrink:0}}>Restaurar</button>}
      </div>
      {abierto===r.id&&<div onClick={e=>e.stopPropagation()}>{adjuntos(r)}{cuerpo(r)}</div>}
    </div> }
  const SL=(t,n,mt)=><div style={{...SEC_LBL,margin:`${mt||2}px 2px 6px`}}>{t} · {n}</div>
  const pend=<>{SL('Pendientes',G.pend.length)}{G.pend.map(tarjeta)}{!G.pend.length&&<div style={{...card,padding:'11px 14px',fontSize:12,color:C.textSoft,marginBottom:10}}>Sin correos por confirmar.</div>}</>
  const lado=<>
    {SL('Ya registrados',G.hech.length,isDesktop?2:12)}
    <div style={{...card,overflow:'hidden'}}>{G.hech.map((r,i)=>filaHecha(r,i))}{!G.hech.length&&<div style={{padding:'11px 14px',fontSize:12,color:C.textSoft}}>Sin correos registrados.</div>}</div>
    {SL('Sospechosos',G.sosp.length,12)}
    {G.sosp.length?G.sosp.map(tarjeta):<div style={{...card,padding:'11px 14px',fontSize:12,color:C.textSoft}}>Sin correos sospechosos.</div>}
    <div onClick={()=>setVerSin(v=>!v)} style={{...SEC_LBL,margin:'12px 2px 6px',cursor:'pointer',display:'flex',justifyContent:'space-between'}}><span>Sin acción · {G.sin.length}</span><span style={{color:C.textSoft}}>{verSin?'Ocultar':'Ver'}</span></div>
    {verSin&&<div style={{...card,overflow:'hidden'}}>{G.sin.map((r,i)=>filaHecha(r,i,true))}{!G.sin.length&&<div style={{padding:'11px 14px',fontSize:12,color:C.textSoft}}>Sin correos.</div>}</div>}
  </>
  return wrap(<>
    <PageHeader origen={origen||'Oficina'} onBack={onBack} titulo='Bandeja del agente' style={{margin:isDesktop?'-12px -20px 12px':'-8px -16px 12px'}}/>
    {err&&<div style={{...card,padding:16,color:C.overdueText,fontSize:13,marginBottom:12}}>No se pudo leer la bandeja: {err}</div>}
    {!rows&&!err&&<div style={{padding:30,textAlign:'center',color:C.muted,fontSize:13}}>Cargando…</div>}
    {rows&&<>
      <div style={{...card,padding:isDesktop?'14px 18px':'12px 14px',marginBottom:12}}>
        <div style={{...SEC_LBL}}>Correos de la oficina revisados · 30 días</div>
        <div style={{display:'flex',alignItems:'baseline',gap:8}}><span style={{fontSize:isDesktop?28:24,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{lista.length}</span><span style={{fontSize:12,color:C.textSoft}}>cada hora</span></div>
        <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(4,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8,marginTop:10}}>
          {partes.map(([t,v,c,bg])=><div key={t} style={{background:bg,borderRadius:10,padding:'8px 11px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:6}}><span style={{fontSize:11.5,fontWeight:600,color:c,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t}</span><span style={{fontSize:15,fontWeight:800,color:c,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>)}
        </div>
      </div>
      {isDesktop?<div style={{display:'grid',gridTemplateColumns:'minmax(0,1.25fr) minmax(0,1fr)',gap:16,alignItems:'start'}}><div>{pend}</div><div>{lado}</div></div>:<>{pend}{lado}</>}
    </>}
  </>)
}

