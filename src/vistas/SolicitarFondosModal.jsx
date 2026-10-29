// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { BRAND, C, Gl, SEC_LBL, Spin, _normTxt, appAlert, diaGrande, fmt, fmtN, fmtRutCL, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { CUENTA_GASTOS_DEFAULT, Modal, depositoDeSolicitud, enviarComoUsuario, equipoPorNombre, esCorreoOficina, esPersona, estadoSolicitud, fInp, facturaCorreoShell, logActividad, mesCorto, registrarError, setLearningKV, txtEnviado } from '../lib/compartido.jsx'

// Solicitar fondos al cliente (#7): correo auto-redactado pidiendo provisión de fondo por rendir. PARA = contactos del cliente,
// CC = abogado responsable (automático). Reusa enviarComoUsuario + la cuenta de gastos + los learnings factura_to/cc y la tabla
// contacts → los correos ingresados se APRENDEN y se sugieren en TODO correo futuro al cliente (facturas, rendiciones, etc.). Linkeado al cliente.
export function SolicitarFondosModal({client:clientProp, clients=[], sale, montoInicial, responsable, user, expenses=[], onClose, asPage=false}){
  const EMAIL_BY_NAME=equipoPorNombre()
  const [client,setClient]=useState(clientProp||null)   // si viene sin cliente (tarjeta del hub) se elige con el buscador
  const [cq,setCq]=useState('')
  const resp = responsable || client?.abogado_responsable || null
  const respEmail = resp?EMAIL_BY_NAME[resp]:null
  const proyecto = sale?.title || ''
  const isDesktop = useIsDesktop()
  const [para,setPara]=useState(client?.email||'')
  const [cc,setCc]=useState([respEmail,BRAND.casillaAgente].filter(Boolean)); const [ccInput,setCcInput]=useState('')
  const [contacts,setContacts]=useState([])
  const [monto,setMonto]=useState(montoInicial?String(montoInicial):'')
  const [asunto,setAsunto]=useState(`Solicitud de provisión de fondos${proyecto?` — ${proyecto}`:''}`)
  const [saludo,setSaludo]=useState(esPersona(client?.name)?`Estimado/a ${(client?.name||'').trim().split(/\s+/)[0]},`:'Estimados,')
  const [cta,setCta]=useState(CUENTA_GASTOS_DEFAULT)
  const [msg,setMsg]=useState('')
  const [sending,setSending]=useState(false)
  const bodyTocado=useRef(false)
  const [extras,setExtras]=useState([])   // adjuntos (presupuesto, cotización) que viajan con el correo
  const [prevOpen,setPrevOpen]=useState(false)   // móvil: ver la vista previa (colapsable)
  const MAX_ADJ=18*1024*1024
  const fmtBytes=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB'
  const onExtras=fileList=>{ const files=Array.from(fileList||[]); files.forEach(f=>{ const r=new FileReader(); r.onload=()=>{ const b=String(r.result||'').split(',')[1]||''; setExtras(p=>{ if(p.some(x=>x.name===f.name&&x.size===f.size)) return p; if(p.reduce((a,x)=>a+(x.size||0),0)+f.size>MAX_ADJ){ appAlert(`"${f.name}" no cabe: los adjuntos superan ~18 MB en total.`); return p } return [...p,{name:f.name,base64:b,mime:f.type||'application/octet-stream',size:f.size}] }) }; r.readAsDataURL(f) }) }
  const removeExtra=(name,size)=>setExtras(p=>p.filter(x=>!(x.name===name&&x.size===size)))
  // Historial de solicitudes: se carga de fund_requests y se cruza con los depósitos (fondos) del cliente.
  const [tab,setTab]=useState('nueva')   // 'nueva' | 'historial'
  const [reqs,setReqs]=useState(null)    // null=cargando
  const cargarReqs=()=>{ supabase.from('fund_requests').select('*').order('enviada_at',{ascending:false}).limit(200).then(({data})=>setReqs(data||[]),()=>setReqs([])) }
  useEffect(()=>{ if(tab==='historial'&&reqs===null) cargarReqs() },[tab])   // eslint-disable-line
  const cnReq=id=>clients.find(c=>String(c.id)===String(id))?.name||'Cliente'
  // Depósito recibido = fondo del cliente (expenses type='fondo') con fecha >= la solicitud (monto aproximado si viene). Nada sin rastro.
  const reqEstado=(r)=>{ const st=estadoSolicitud(r,expenses); return st.k==='rec'&&!st.dep ? {...st,dep:depositoDeSolicitud(r,expenses)} : st }
  const volverAPedir=(r)=>{ const c=clients.find(x=>String(x.id)===String(r.client_id)); if(c) pickClient(c); if(r.monto) setMonto(String(r.monto)); setTab('nueva') }
  const persona=esPersona(client?.name)
  const genMsg=()=>`Espero que ${persona?'estés':'estén'} muy bien. ${proyecto?`En el marco del encargo ${proyecto}, solicitamos`:'Solicitamos'} la provisión de un fondo por rendir${monto?` por ${fmtN(+monto||0)}`:''}, destinado a gastos notariales, inscripciones y otros trámites asociados, el cual será debidamente rendido.\n\nPuede transferir a la cuenta que se indica a continuación. Quedamos atentos a su confirmación.`
  useEffect(()=>{ if(!bodyTocado.current) setMsg(genMsg()) },[monto,proyecto,client?.id])   // eslint-disable-line
  useEffect(()=>{ if(!client?.id) return; let alive=true
    supabase.from('contacts').select('nombre,email,principal').eq('client_id',client.id).then(({data})=>{ if(alive) setContacts((data||[]).filter(c=>c.email)) },()=>{})
    supabase.from('learnings').select('value').eq('kind','factura_to').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data?.value&&!client?.email) setPara(String(data.value).trim()) },()=>{})
    supabase.from('learnings').select('value').eq('kind','factura_cc').eq('key',String(client.id)).maybeSingle().then(({data})=>{ if(alive&&data?.value){ const ems=String(data.value).split(/[,;]/).map(s=>s.trim().toLowerCase()).filter(Boolean); setCc(p=>[...new Set([...p,...ems])]) } },()=>{})
    supabase.from('learnings').select('value').eq('kind','cuenta_gastos').eq('key','estudio').order('updated_at',{ascending:false}).limit(1).maybeSingle().then(({data})=>{ if(alive&&data?.value){ try{ setCta(p=>({...p,...JSON.parse(data.value)})) }catch(_){} } },()=>{})
    return ()=>{alive=false} },[client?.id])   // eslint-disable-line
  const addCc=em=>{ const e=String(em||'').trim().toLowerCase(); if(e&&e.includes('@')&&!cc.includes(e)&&e!==(para||'').toLowerCase()) setCc(p=>[...p,e]); setCcInput('') }
  const removeCc=em=>setCc(p=>p.filter(x=>x!==em))
  const pickClient=(c)=>{ setClient(c); setCq(''); setPara(c?.email||''); setSaludo(esPersona(c?.name)?`Estimado/a ${(c?.name||'').trim().split(/\s+/)[0]},`:'Estimados,'); const re=c?.abogado_responsable?EMAIL_BY_NAME[c.abogado_responsable]:null; if(re) setCc(p=>[...new Set([...p,re])]) }
  const buildHtml=()=>{ const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const ctaBox=`<div style="margin:14px 0;padding:12px 16px;background:#F7F9FA;border:1px solid #E4E8EB;border-radius:8px;font-size:13px;line-height:1.7"><div style="color:#537281;font-weight:600;margin-bottom:3px">Cuenta destinada a gastos</div><div>${esc(cta.razon)}</div><div><span style="color:#537281">RUT:</span> <b>${esc(cta.rut)}</b></div><div><span style="color:#537281">${esc(cta.banco)} · Cuenta corriente:</span> <b>${esc(cta.cuenta)}</b></div>${cta.email?`<div><span style="color:#537281">Confirmación a:</span> ${esc(cta.email)}</div>`:''}</div>`
    // Mismo cascarón que los correos de facturas (header navy con logo + pie de firma con logo/dirección/web), pero lo firma Administración.
    const inner=`${esc(saludo)}<br><br>${esc(msg).replace(/\n/g,'<br>')}${ctaBox}<div style="margin-top:16px">Saludos cordiales,</div>`
    return facturaCorreoShell(inner, {nombre:'Administración', cargo:BRAND.nombre, telefono:''}, 'es')
  }
  const enviar=async()=>{ if(!para.trim()){ appAlert('Falta el destinatario.'); return } setSending(true)
    try{
      const text=`${saludo}\n\n${msg}\n\nCuenta destinada a gastos: ${cta.banco} · ${cta.cuenta} · ${cta.razon} · ${fmtRutCL(cta.rut)}\n\n${BRAND.dominio}`
      const adjuntos=extras.map(a=>({base64:a.base64,name:a.name,mime:a.mime}))
      const via=await enviarComoUsuario({to:para.trim(), cc:cc.join(','), subject:asunto, html:buildHtml(), text, attachments:adjuntos, soloUsuario:true, que:'La solicitud de fondos'})
      if(via==='reauth'){ setSending(false); return }   // el aviso «NO se envió» + reingreso lo da enviarComoUsuario
      if(via===null){ setSending(false); return }
      if(client?.id){
        try{ await setLearningKV('factura_to',String(client.id),para.trim()) }catch(e){registrarError({origen:'accion',vista:'factura_to',err:e})}
        if(cc.length) try{ await setLearningKV('factura_cc',String(client.id),cc.join(',')) }catch(e){registrarError({origen:'accion',vista:'factura_cc',err:e})}
        try{ await supabase.from('learnings').delete().eq('kind','cuenta_gastos').eq('key','estudio'); await supabase.from('learnings').insert({kind:'cuenta_gastos',key:'estudio',value:JSON.stringify(cta)}) }catch(e){registrarError({origen:'accion',vista:'learnings',err:e})}
        // Los correos ingresados quedan como contactos del cliente → sugeridos en todo correo futuro (compartido con FacturaEmailModal).
        try{ const ya=new Set(contacts.map(c=>(c.email||'').toLowerCase())); const nuevos=[...new Set([para.trim(),...cc].map(e=>String(e).trim().toLowerCase()).filter(e=>e&&e.includes('@')&&!esCorreoOficina(e)&&!ya.has(e)))]; if(nuevos.length) await supabase.from('contacts').insert(nuevos.map(e=>({client_id:client.id,nombre:e.split('@')[0],email:e}))) }catch(e){registrarError({origen:'accion',vista:'contacts',err:e})}
      }
      // Registro permanente de la solicitud (historial + cruce con el depósito): nada sin rastro.
      try{ const {error:frErr}=await supabase.from('fund_requests').insert({ client_id:client?.id||null, sale_id:sale?.id||null, monto:+monto||0, asunto, para:para.trim(), cc:cc.join(','), enviada_por:user?.name||null, n_adjuntos:extras.length })
        if(frErr) console.error('fund_requests',frErr.message); else logActividad('fondos.solicitud_enviada',{tabla:'clients',id:client?.id,detalle:{cliente:client?.name,title:'Solicitud de fondos enviada',monto:+monto||0}}) }catch(e){registrarError({origen:'accion',vista:'fund_requests',err:e})}
      appAlert(txtEnviado(via,{que:'Solicitud de fondos', g:'a', para:[para.trim(),...cc].filter(Boolean).join(', ')})); onClose()
    }catch(e){ appAlert('Error al enviar: '+(e.message||e)) }
    setSending(false)
  }
  const fInp={width:'100%',padding:'9px 11px',borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,boxSizing:'border-box'}
  const lbl={fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}
  const dz={display:'block',border:`1.5px dashed ${C.border}`,borderRadius:10,padding:'10px',textAlign:'center',cursor:'pointer'}
  const tabBtn=on=>({fontSize:13,fontWeight:700,color:on?C.accent:C.muted,background:'none',border:'none',borderBottom:`2px solid ${on?C.accent:'transparent'}`,padding:'7px 4px',marginBottom:-1,cursor:'pointer'})
  const _body = (<>
    <div style={{display:'flex',gap:16,marginBottom:14,borderBottom:`1px solid ${C.border}`}}>
      <button onClick={()=>setTab('nueva')} style={tabBtn(tab==='nueva')}>Nueva solicitud</button>
      <button onClick={()=>setTab('historial')} style={tabBtn(tab==='historial')}>Historial{reqs?.length?` · ${reqs.length}`:''}</button>
    </div>
    {tab==='historial' ? (()=>{
      if(reqs===null) return <div style={{textAlign:'center',padding:30,color:C.muted,fontSize:13}}><Spin/> Cargando…</div>
      if(!reqs.length) return <div style={{textAlign:'center',padding:30,color:C.muted,fontSize:13,background:C.bgSoft,borderRadius:12}}>Aún no has enviado solicitudes de fondos.</div>
      const sinResp=reqs.filter(r=>reqEstado(r).k==='sin').length
      const byCli={}; reqs.forEach(r=>{ (byCli[String(r.client_id)]=byCli[String(r.client_id)]||[]).push(r) })
      const grupos=Object.entries(byCli).sort((a,b)=>String(b[1][0].enviada_at||'').localeCompare(String(a[1][0].enviada_at||'')))
      return (<div>
        <div style={{fontSize:11,color:C.muted,marginBottom:10}}>{reqs.length} solicitud{reqs.length!==1?'es':''} · {reqs.filter(r=>reqEstado(r).k==='rec').length} con fondo recibido{sinResp>0&&<> · <b style={{color:C.overdueText}}>{sinResp} sin depósito +7 días</b></>}</div>
        {grupos.map(([cid,rs])=>{ const tot=rs.reduce((a,r)=>a+(r.monto||0),0); const rec=rs.reduce((a,r)=>a+(reqEstado(r).k==='rec'?(depositoDeSolicitud(r,expenses)?.amount||r.monto||0):0),0); return (
          <div key={cid} style={{marginBottom:12}}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 11px',background:C.accent,borderRadius:10}}><span style={{flex:1,minWidth:0,fontSize:13,fontWeight:800,color:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cnReq(cid)}</span><span style={{fontSize:11,color:'#AEC4CE',fontWeight:600,flexShrink:0}}>pedido {fmt(tot)}{rec>0?` · recibido ${fmt(rec)}`:''}</span></div>
            {rs.map(r=>{ const est=reqEstado(r); const dd=r.enviada_at?new Date(r.enviada_at):null; const dnum=dd?dd.getDate():'—'; const dmon=dd?mesCorto(dd):''; return (
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 11px',borderBottom:`.5px solid ${C.track}`}}>
                {diaGrande(isoLocal(r.enviada_at))}
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.asunto||'Solicitud de fondos'}</div><div style={{fontSize:11,color:C.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.enviada_por?`${r.enviada_por} · `:''}a {r.para||'—'}{r.monto?` · ${fmt(r.monto)}`:''}{r.n_adjuntos>0?` · ${r.n_adjuntos} adj.`:''}</div></div>
                <span style={{fontSize:9.5,fontWeight:700,borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap',flexShrink:0,color:est.k==='rec'?C.greenText:est.k==='sin'?C.overdueText:C.soonText,background:est.k==='rec'?C.greenBg:est.k==='sin'?C.overdueBg:C.soonBg}}>{est.k==='rec'?`✓ Fondo recibido`:est.k==='sin'?`Sin depósito · ${est.dias} d`:'Enviada'}</span>
                {est.k!=='rec'&&<button onClick={()=>volverAPedir(r)} style={{fontSize:11,fontWeight:700,color:C.accent,background:'#fff',border:`1px solid ${C.accent}`,borderRadius:8,padding:'4px 9px',cursor:'pointer',flexShrink:0}}>Volver a pedir</button>}
              </div>
            )})}
          </div>
        )})}
      </div>)
    })() : !client
      ? <div><div style={lbl}>ELIGE EL CLIENTE</div><input value={cq} onChange={e=>setCq(e.target.value)} placeholder='Buscar cliente…' style={fInp} autoFocus/>{cq.trim()&&<div style={{border:`1px solid ${C.border}`,borderRadius:8,marginTop:6,overflow:'hidden',maxHeight:260,overflowY:'auto'}}>{(clients||[]).filter(c=>!c.is_internal&&c.status!=='Terminado'&&_normTxt(c.name).includes(_normTxt(cq))).slice(0,8).map(c=><div key={c.id} onClick={()=>pickClient(c)} style={{padding:'9px 11px',fontSize:13,color:C.text,cursor:'pointer',borderTop:`1px solid ${C.bgSoft}`}}>{c.name}{c.abogado_responsable?<span style={{color:C.textSoft,fontSize:10}}> · {c.abogado_responsable}</span>:''}</div>)}</div>}</div>
      : (()=>{
        const formEl=(<div style={{display:'flex',flexDirection:'column',gap:11}}>
          <div><div style={lbl}>PARA</div><input value={para} onChange={e=>setPara(e.target.value)} placeholder='correo@cliente.cl' style={fInp}/>
            {contacts.length>0&&<div style={{display:'flex',gap:5,flexWrap:'wrap',marginTop:5}}>{contacts.map(c=>{ const isTo=(c.email||'').toLowerCase()===(para||'').toLowerCase(); return <button key={c.email} type='button' title={c.email} onClick={()=>{ if(isTo) return; if(!para.trim()) setPara(c.email); else addCc(c.email) }} style={{fontSize:10,border:`0.5px solid ${isTo?C.accent:C.border}`,background:isTo?C.accent:'#fff',color:isTo?'#fff':C.accent,borderRadius:20,padding:'2px 9px',cursor:isTo?'default':'pointer'}}>{isTo?<><Gl n='tick'/>{" "}</>:''}{c.nombre||c.email}</button> })}</div>}
          </div>
          <div><div style={lbl}>CC {resp&&<span style={{fontWeight:400,textTransform:'none',color:C.textSoft}}>· abogado responsable ({resp})</span>}</div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>{cc.map(e=><span key={e} style={{fontSize:10,background:C.greenBg,color:C.greenText,borderRadius:20,padding:'2px 4px 2px 9px',display:'inline-flex',alignItems:'center'}}>{e}<button type='button' onClick={()=>removeCc(e)} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontWeight:700,padding:'0 4px'}}><Gl n='x'/></button></span>)}
              <input value={ccInput} onChange={e=>setCcInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'||e.key===','){ e.preventDefault(); addCc(ccInput) } }} onBlur={()=>addCc(ccInput)} placeholder='+ correo' style={{flex:1,minWidth:90,padding:'6px 8px',border:`1px solid ${C.border}`,borderRadius:8,fontSize:12}}/></div>
          </div>
          <div style={{display:'flex',gap:10}}>
            <div style={{flex:1}}><div style={lbl}>ASUNTO</div><input value={asunto} onChange={e=>setAsunto(e.target.value)} style={fInp}/></div>
            <div style={{width:150}}><div style={lbl}>MONTO DEL FONDO</div><span style={{display:'flex',alignItems:'center',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff'}}><span style={{fontSize:13,color:C.muted,padding:'0 2px 0 10px'}}>$</span><input value={monto} onChange={e=>setMonto(e.target.value.replace(/[^\d]/g,''))} inputMode='numeric' placeholder='opcional' style={{border:'none',outline:'none',flex:1,padding:'9px 8px 9px 2px',fontSize:13,minWidth:0}}/></span></div>
          </div>
          <div><div style={lbl}>SALUDO</div><input value={saludo} onChange={e=>setSaludo(e.target.value)} style={fInp}/></div>
          <div><div style={lbl}>MENSAJE</div><textarea value={msg} onChange={e=>{bodyTocado.current=true;setMsg(e.target.value)}} rows={7} style={{...fInp,minHeight:isDesktop?150:130,lineHeight:1.6,resize:'vertical',fontFamily:'inherit'}}/></div>
          <div style={{background:C.soonBg,border:'1px solid #F0E4B8',borderRadius:10,padding:'9px 11px'}}>
            <div style={{fontSize:10,color:C.soonText,fontWeight:700,marginBottom:6}}>Cuenta destinada a gastos (se recuerda)</div>
            <div style={{display:'flex',gap:6,marginBottom:6}}><input value={cta.banco} onChange={e=>setCta(p=>({...p,banco:e.target.value}))} placeholder='Banco' style={{...fInp,padding:'6px 8px',fontSize:12,flex:1}}/><input value={cta.cuenta} onChange={e=>setCta(p=>({...p,cuenta:e.target.value}))} placeholder='N° cuenta' style={{...fInp,padding:'6px 8px',fontSize:12,flex:1}}/></div>
            <div style={{display:'flex',gap:6}}><input value={cta.razon} onChange={e=>setCta(p=>({...p,razon:e.target.value}))} placeholder='Razón social' style={{...fInp,padding:'6px 8px',fontSize:12,flex:2}}/><input value={cta.rut} onChange={e=>setCta(p=>({...p,rut:e.target.value}))} placeholder='RUT' style={{...fInp,padding:'6px 8px',fontSize:12,flex:1}}/></div>
          </div>
          <div><div style={lbl}>ADJUNTOS <span style={{fontWeight:400,textTransform:'none',color:C.textSoft}}>· opcional (presupuesto, cotización)</span></div>
            <label style={dz}><input type='file' multiple onChange={e=>{onExtras(e.target.files);e.target.value=''}} style={{display:'none'}}/><span style={{fontSize:12,color:C.muted}}><svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' style={{verticalAlign:-3,marginRight:5}}><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>Toca para adjuntar</span></label>
            {extras.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6}}>{extras.map(a=><span key={a.name+a.size} style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,color:C.accent,background:C.azulBg,borderRadius:8,padding:'5px 9px'}}>{a.name}<span style={{color:C.muted}}>· {fmtBytes(a.size)}</span><button type='button' onClick={()=>removeExtra(a.name,a.size)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontWeight:700,padding:0,lineHeight:1,fontSize:14}}><Gl n='x'/></button></span>)}</div>}
          </div>
        </div>)
        const previewEl=(<div>
          <div style={{...SEC_LBL,marginBottom:6}}>Vista previa del correo</div>
          <div style={{fontSize:11,color:C.muted,marginBottom:7,lineHeight:1.5}}><b style={{color:C.text}}>Para:</b> {para||'—'}{cc.length?<> · <b style={{color:C.text}}>CC:</b> {cc.join(', ')}</>:''}{extras.length?<> · {extras.length} adjunto{extras.length!==1?'s':''}</>:''}</div>
          <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',background:'#fff',maxHeight:isDesktop?'60vh':420,overflowY:'auto'}}><div style={{padding:12}} dangerouslySetInnerHTML={{__html:buildHtml()}}/></div>
        </div>)
        const sendBtn=(<button disabled={sending||!para.trim()} onClick={enviar} style={{marginTop:6,width:'100%',padding:12,borderRadius:10,border:'none',background:(!para.trim())?C.done:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:(!para.trim())?'default':'pointer'}}>{sending?'Enviando…':'Enviar solicitud'}</button>)
        return isDesktop
          ? <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:16,alignItems:'start'}}><div>{formEl}{sendBtn}</div><div>{previewEl}</div></div>
          : <div style={{display:'flex',flexDirection:'column',gap:11}}>{formEl}<div style={{borderTop:`1px solid ${C.border}`,paddingTop:9}}><button type='button' onClick={()=>setPrevOpen(o=>!o)} style={{fontSize:12,fontWeight:700,color:C.azulInfo,background:'none',border:'none',cursor:'pointer',padding:0}}>{prevOpen?<>Ocultar vista previa{" "}<Gl n='chevU'/></>:<>Ver cómo se verá el correo{" "}<Gl n='chevD'/></>}</button>{prevOpen&&<div style={{marginTop:9}}>{previewEl}</div>}</div>{sendBtn}</div>
      })()
    }
    </>)
  const _page = _body
  return asPage ? _page : (<Modal fullscreen fsMaxWidth={(tab==='historial'||(client&&isDesktop))?980:640} title={<><span style={{color:C.accent}}>Solicitar fondos</span>{tab==='nueva'&&client?.name&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted}}>{client.name}</span></>}</>} onClose={onClose}>{_body}</Modal>)
}

