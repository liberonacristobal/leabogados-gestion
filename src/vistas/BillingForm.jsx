// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo } from 'react'
import { supabase, DEMO } from '../supabase'
import { BRAND, C, Gl, SEC_LBL, Spin, _normTxt, appAlert, fmt, fmtFechaDMY, fmtRutCL, folioN, useIsDesktop } from '../lib/base.jsx'
import { Attachments, Sparkle, descargarPdfU8, estadoCobro, facturaDtePdfBase64, facturaNombreArchivo, montoFactura, saldoBill, serieKey, splitSetDTE, tipoFacturaLbl, tituloProv } from '../lib/compartido.jsx'

export const BanIcon = ({size=15,color}) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke={color||C.overdue} strokeWidth='2' strokeLinecap='round'><circle cx='12' cy='12' r='9'/><line x1='5.6' y1='5.6' x2='18.4' y2='18.4'/></svg>
)

// Comprobante imprimible de un cobro (documento interno, no el DTE oficial del SII). Reusa el patrón de impresión.
export function printComprobante(bill, clientName){
  if(!bill) return
  const A='#003C50', MUT='#537281', GRAY='#E4E8EB', TXT='#3D3D3D'
  const n=v=>fmt(Number(v)||0)   // formateador CLP único (global fmt)
  const dmy = fmtFechaDMY   // delega al helper global (evita la copia local divergente)
  const row=(l,v)=>`<tr><td style='padding:8px 0;color:${MUT};width:160px;vertical-align:top'>${l}</td><td style='padding:8px 0;font-weight:600'>${v}</td></tr>`
  const html=`<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Comprobante ${bill.invoice_no||''}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'DM Sans',Helvetica,Arial,sans-serif;color:${TXT};font-size:12px;background:#fff}.page{max-width:816px;margin:0 auto}@page{size:letter portrait;margin:16mm 18mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none}}.print-btn{position:fixed;bottom:20px;right:20px;background:${A};color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer}</style></head><body><div class='page'><div style='background:${A};color:#fff;padding:22px 26px;display:flex;justify-content:space-between;align-items:center'><div><div style='font-size:16px;font-weight:700'>${BRAND.nombre}</div><div style='font-size:10px;opacity:.7;margin-top:2px'>${BRAND.web}</div></div><div style='text-align:right'><div style='font-size:13px;font-weight:600'>Comprobante de cobro</div>${bill.invoice_no?`<div style='font-size:11px;opacity:.85;margin-top:2px'>N° ${bill.invoice_no}</div>`:''}</div></div><div style='padding:24px 26px'><table style='width:100%;border-collapse:collapse;font-size:12px'>${row('Cliente', clientName||'—')}${bill.receptor_name?row('Razón social', bill.receptor_name+(bill.receptor_rut?` · ${fmtRutCL(bill.receptor_rut)}`:'')):''}${row('Concepto', bill.concept||'—')}${row('Monto', n(bill.amount))}${row('Estado', bill.status||'—')}${row('Emisión', dmy(bill.issued_at))}${bill.status==='Pagado'?row('Fecha de pago', dmy(bill.paid_at)):row('Vencimiento', dmy(bill.due))}${bill.notes?row('Notas', bill.notes):''}</table><div style='margin-top:26px;padding-top:12px;border-top:1px solid ${GRAY};font-size:10px;color:${MUT};display:flex;justify-content:space-between'><span>${BRAND.direccionCalle} · ${BRAND.ciudad}</span><span>Documento interno — no es el DTE del SII</span></div></div></div><button class='print-btn no-print' onclick='window.print()'>Imprimir / Guardar PDF</button></body></html>`
  const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close() }
}

export function BillingForm({bill,clients,clientEntities,sales=[],billing=[],onAssignSeries,proveedores=[],terceros=[],anticipos=[],onConsume,onSave,onClose,onDelete,onAnular,onEmitirDTE,onActualizarEstado,saving,user,onAttachChange,pagina=false,onVerBanco}) {
  // pagina = la factura abierta como PÁGINA (no modal): escritorio en 2 columnas (formulario | saldo · acciones · historial).
  const isDesk = useIsDesktop()
  const [concB,setConcB] = useState(null)   // conciliaciones bancarias de esta factura (para "Ver en Banco ›" e historial)
  useEffect(()=>{ if(!pagina||!bill?.id||(typeof DEMO!=='undefined'&&DEMO)) return; let vivo=true
    supabase.from('conciliacion').select('movimiento_id,monto_aplicado,created_at').eq('factura_id',bill.id).order('created_at',{ascending:true}).then(({data})=>{ if(vivo) setConcB(data||[]) }).catch(()=>{})
    return ()=>{ vivo=false } },[pagina,bill?.id])
  const [f,setF] = useState(bill||{client_id:'',concept:'',amount:'',monto_terceros:'',status:'Pendiente',invoice_no:'',issued_at:'',due:'',paid_at:'',notes:'',billing_type:'honorarios',receptor_name:'',receptor_rut:''})
  const [clientQuery,setClientQuery] = useState('')
  const [nuevaRS,setNuevaRS] = useState(false)
  // Proveedor al que le pertenece el monto "de terceros" de esta factura (cuenta por pagar anclada a este cobro).
  const tercerosBill = (terceros||[]).filter(t=>String(t.billing_id)===String(bill?.id))
  const [terceroProv,setTerceroProv] = useState(()=>{ const t=tercerosBill.find(x=>x.estado!=='pagado')||tercerosBill[0]; return t?String(t.proveedor_id):'' })
  const terceroPagado = tercerosBill.some(t=>t.estado==='pagado')
  // "Retienes %": atajo para fijar monto_terceros = amount × (1 − %). Inicial desde el split guardado o la comisión aprendida del externo.
  const [retPct,setRetPct] = useState(()=>{ const t=tercerosBill.find(x=>x.comision_pct!=null); if(t) return String(t.comision_pct); const amt=Number(bill?.amount)||0, mt=Number(bill?.monto_terceros)||0; return (amt>0&&mt>0)?String(Math.round((amt-mt)/amt*100)):'' })
  const [comPctMap,setComPctMap] = useState({})
  useEffect(()=>{ if(typeof DEMO!=='undefined'&&DEMO) return; supabase.from('learnings').select('key,value').eq('kind','tercero_comision_pct').order('updated_at',{ascending:true}).then(({data})=>{ const m={}; (data||[]).forEach(r=>{ const v=parseFloat(r.value); if(r.key&&!isNaN(v)) m[String(r.key)]=v }); setComPctMap(m) },()=>{}) },[])
  const tituloProv = p => (p?.nombre?.trim()||p?.razon_social?.trim()||'Proveedor')
  const provsOrd = [...(proveedores||[])].sort((a,b)=>tituloProv(a).localeCompare(tituloProv(b),'es'))
  const [selAnt,setSelAnt] = useState(new Set())
  const [anularOpen,setAnularOpen] = useState(false)
  const [motivoBaja,setMotivoBaja] = useState('')
  const [obsBaja,setObsBaja] = useState('')
  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const rsList = (clientEntities||[]).filter(e=>e.client_id===f.client_id)
  // Proyecto = venta. La factura se asocia a una venta del cliente (sale_id) → así se concilian programadas ↔ pagadas.
  const clientSales = (sales||[]).filter(s=>String(s.client_id)===String(f.client_id))
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
  const sugVenta = useMemo(()=>{
    if(f.sale_id || !f.concept || !clientSales.length) return null
    const cw = new Set(norm(f.concept).split(/[^a-z0-9]+/).filter(w=>w.length>3))
    let best=null, score=0
    clientSales.forEach(s=>{ const n=norm(s.title).split(/[^a-z0-9]+/).filter(w=>w.length>3).filter(w=>cw.has(w)).length; if(n>score){score=n;best=s} })
    return score>0?best:null
  },[f.concept,f.sale_id,f.client_id,sales])
  // Hermanas: facturas de la MISMA serie (mismo cliente, misma glosa base) que están SIN proyecto → ofrecer asignarlas junto con esta.
  const [serieDone,setSerieDone] = useState(false)
  const hermanas = useMemo(()=>{
    if(!f.sale_id || !f.concept || !f.client_id) return []
    const k = serieKey(f.concept); if(!k || k.length<4) return []
    return (billing||[]).filter(b=>String(b.id)!==String(f.id) && !b.deleted_at && String(b.client_id)===String(f.client_id) && !b.sale_id && b.billing_type!=='reembolso' && b.status!=='Anulada' && serieKey(b.concept)===k)
  },[f.sale_id,f.concept,f.client_id,f.id,billing])
  const flabel={fontSize:10,fontWeight:600,color:C.textSoft,letterSpacing:'.05em',textTransform:'uppercase',marginBottom:3,display:'block'}
  const inp={width:'100%',height:36,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none'}
  // 'Pagado' NO es seleccionable a mano: un pago solo se marca conciliando contra el banco (o al aplicar un anticipo).
  // Una factura que ya está Pagada mantiene su opción (para poder revertirla), pero no se puede setear manualmente.
  const estados=(()=>{ const base=['Pendiente','Anulado']; return (f.status&&!base.includes(f.status))?[f.status,...base]:base })()
  // Acciones según el estado: una factura EMITIDA (tiene folio) no muestra "Emitir al SII" ni "Eliminar" — su folio no se borra, se anula.
  const esEmitidaF = !!(bill?.invoice_no) && bill?.status!=='Programada'
  const guardarEl = (
        <button disabled={saving||!f.client_id||!f.concept} onClick={()=>onSave({...f,_terceroProv:terceroProv,_terceroPagado:terceroPagado})} style={{height:pagina?40:36,padding:'0 18px',width:pagina&&isDesk?'100%':undefined,borderRadius:8,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.concept)?.6:1}}>
          {saving?<Spin/>:null}{saving?'Guardando...':'Guardar'}
        </button>
  )
  const accionesEl = (<>
        {bill?.id&&!esEmitidaF&&<button onClick={()=>onDelete(bill.id)} style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.overdue}`,background:'#fff',color:C.overdue,fontSize:13,fontWeight:500,cursor:'pointer'}}>Eliminar</button>}
        {bill?.id&&<button onClick={()=>printComprobante(f,clients.find(c=>String(c.id)===String(f.client_id))?.name)} title='Imprimir / Guardar PDF' style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.accent,fontSize:13,fontWeight:500,cursor:'pointer'}}>Comprobante</button>}
        {bill?.id&&onAnular&&f.status!=='Anulado'&&f.status!=='Anulada'&&<button onClick={()=>{setMotivoBaja('');setObsBaja('');setAnularOpen(true)}} style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.soon}`,background:'#fff',color:C.soon,fontSize:13,fontWeight:500,cursor:'pointer'}}>Anular</button>}
        {bill?.id&&onEmitirDTE&&f.status!=='Anulado'&&f.status!=='Anulada'&&!bill.dte_track_id&&!esEmitidaF&&<button onClick={()=>onEmitirDTE(bill)} title='Generar y enviar la factura electrónica al SII (con vista previa antes de emitir)' style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.accent}`,background:'#fff',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer'}}>Emitir al SII</button>}
        {bill?.id&&bill.dte_xml&&<button onClick={async()=>{ try{ const doc=splitSetDTE(bill.dte_xml)[0]||bill.dte_xml; const r=await facturaDtePdfBase64(doc); const bin=atob(r.base64); const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i); descargarPdfU8(u8, facturaNombreArchivo(r)) }catch(e){ appAlert('No se pudo generar el PDF: '+(e.message||e)) } }} title='Descargar el PDF oficial (con timbre) de la factura emitida' style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${C.tealText}`,background:'#fff',color:C.tealText,fontSize:13,fontWeight:600,cursor:'pointer'}}>{pagina?'Descargar PDF':'PDF'}</button>}
        {bill?.id&&bill.dte_track_id&&onActualizarEstado&&(()=>{ const est=String(bill.dte_estado||'enviado'); const rech=/rech/i.test(est); const acep=/acep/i.test(est); return <button onClick={()=>onActualizarEstado(bill)} title='Re-consultar el estado del DTE en el SII (puede tardar en aceptarse o rechazarse)' style={{height:36,padding:'0 12px',borderRadius:8,border:`0.5px solid ${rech?C.overdue:acep?C.normal:C.soon}`,background:'#fff',color:rech?C.overdue:acep?C.greenText:C.soonText,fontSize:12,fontWeight:600,cursor:'pointer'}}>SII: {rech?'rechazada':acep?'aceptada':'enviado'} · actualizar</button> })()}
  </>)
  // Lado derecho (página): saldo con su fuente única (saldoBill/montoFactura/estadoCobro) + historial derivado de la propia factura y su conciliación.
  const estF = bill?.id ? estadoCobro(bill) : null
  const montoF = bill?.id ? montoFactura(bill) : 0, saldoF = bill?.id ? Math.max(0,saldoBill(bill)) : 0, pagadoF = Math.max(0,montoF-saldoF)
  const lnF = (l,v,col) => <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:10,fontSize:12,padding:'2px 0'}}><span style={{color:C.muted}}>{l}</span><span style={{fontWeight:700,color:col||C.text,fontVariantNumeric:'tabular-nums'}}>{v}</span></div>
  const saldoEl = bill?.id ? (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:'uppercase',letterSpacing:.5}}>Saldo</span>{estF&&<span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:estF.bg,color:estF.text,whiteSpace:'nowrap'}}>{bill.status==='Programada'?'Programada':estF.label}</span>}</div>
      <div style={{fontSize:24,fontWeight:800,color:saldoF>0?(estF?.text||C.text):C.greenText,textAlign:'right',fontVariantNumeric:'tabular-nums',margin:'2px 0 4px'}}>{fmt(saldoF)}</div>
      <div style={{borderTop:`1px solid ${C.track}`,paddingTop:5}}>{lnF('Monto',fmt(montoF))}{lnF('Pagado',fmt(pagadoF),pagadoF>0?C.greenText:null)}</div>
      {(concB||[]).length>0&&<div style={{marginTop:8,background:C.greenBg,borderRadius:9,padding:'8px 10px',display:'flex',alignItems:'center',gap:8,fontSize:12}}>
        <span style={{flex:1,minWidth:0,color:C.greenText,fontWeight:600}}>Conciliada con el banco{bill.paid_at?` · pagada ${fmtFechaDMY(bill.paid_at)}`:''}</span>
        {onVerBanco&&<span onClick={()=>onVerBanco(concB[concB.length-1].movimiento_id)} style={{color:C.accent,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Ver en Banco <Gl n='chevron'/></span>}
      </div>}
    </div>) : null
  const historialEl = bill?.id ? (()=>{ const ev=[]
    if(bill.invoice_no&&bill.issued_at) ev.push({d:bill.issued_at,t:`Emitida · N° ${folioN(bill.invoice_no)}`,m:montoF})
    else if(bill.due) ev.push({d:bill.due,t:'Programada',m:montoF})
    const env=bill.email_sent_at||bill.sent_at; if(env) ev.push({d:env,t:'Enviada al cliente',s:[bill.sent_to?`a ${bill.sent_to}`:null,bill.sent_by||null].filter(Boolean).join(' · ')})
    ;(concB||[]).forEach(c=>ev.push({d:c.created_at,t:'Conciliada con el banco',m:c.monto_aplicado}))
    if(bill.paid_at&&!(concB||[]).length) ev.push({d:bill.paid_at,t:'Pagada',m:pagadoF||null})
    if(bill.anulada_at) ev.push({d:bill.anulada_at,t:'Anulada',s:[bill.anulada_por,bill.motivo_baja].filter(Boolean).join(' · ')})
    ev.sort((x,y)=>String(y.d).localeCompare(String(x.d)))
    return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'10px 14px 6px'}}>
      <div style={{...SEC_LBL,marginBottom:2}}>Historial de la factura</div>
      {!ev.length&&<div style={{fontSize:12,color:C.muted,padding:'8px 0'}}>Sin movimientos aún.</div>}
      {ev.map((e,i)=><div key={i} style={{display:'flex',gap:10,padding:'7px 0',borderTop:i?`0.5px solid ${C.bgSoft}`:'none'}}>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{e.t}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtFechaDMY(String(e.d).slice(0,10))}{e.s?` · ${e.s}`:''}</div></div>
        {e.m!=null&&<div style={{fontSize:12.5,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{fmt(e.m)}</div>}
      </div>)}
    </div>) })() : null
  return (
    <>
      <div className='qt-head' style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,borderBottom:`0.5px solid ${C.border}`,position:'sticky',top:0,background:'#fff',zIndex:2}}>
        <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
          <button className='qt-volver' onClick={onClose} aria-label='Volver' style={{alignItems:'center',gap:4,background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:600,cursor:'pointer',padding:'2px 6px 2px 0',flexShrink:0}}><svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round'><polyline points='15 18 9 12 15 6'/></svg>Volver</button>
          <span style={{fontSize:15,fontWeight:500,color:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {bill?.id?'Editar cobro':'Nuevo cobro'}
            {f.client_id&&<><span style={{color:C.textSoft,fontWeight:400,margin:'0 7px'}}>|</span><span style={{color:C.muted,fontWeight:600}}>{clients.find(c=>String(c.id)===String(f.client_id))?.name||'Cliente'}</span></>}
          </span>
        </div>
        <button className='qt-close' onClick={onClose} style={{width:28,height:24,borderRadius:6,border:`0.5px solid ${C.border}`,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',flexShrink:0}}>
          <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#537281' strokeWidth='2.4' strokeLinecap='round'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg>
        </button>
      </div>
      <div style={pagina&&isDesk?{display:'grid',gridTemplateColumns:'minmax(0,1fr) 340px',gap:18,alignItems:'start'}:(pagina?{display:'flex',flexDirection:'column',gap:12}:undefined)}>
      {pagina&&!isDesk&&saldoEl}
      <div style={pagina?{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}:undefined}>
      <div className='qt-body' style={{display:'flex',flexDirection:'column',gap:8}}>
        {!f.client_id&&(
          <div>
            <label style={flabel}>Cliente</label>
            <input value={clientQuery} onChange={e=>setClientQuery(e.target.value)} placeholder='Buscar cliente por nombre...' style={inp}/>
            {clientQuery.trim()&&(
              <div style={{maxHeight:180,overflowY:'auto',border:`0.5px solid ${C.border}`,borderRadius:8,marginTop:4,background:'#fff'}}>
                {clients.filter(c=>_normTxt(c.name).includes(_normTxt(clientQuery))).slice(0,30).map(c=>(
                  <div key={c.id} onClick={()=>{up('client_id',c.id);setClientQuery('')}} style={{padding:'9px 11px',fontSize:13,color:C.text,cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}} onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft} onMouseLeave={e=>e.currentTarget.style.background='#fff'}>{c.name}</div>
                ))}
                {clients.filter(c=>_normTxt(c.name).includes(_normTxt(clientQuery))).length===0&&<div style={{padding:'9px 11px',fontSize:13,color:C.muted}}>Sin resultados</div>}
              </div>
            )}
          </div>
        )}

        {bill?.id&&(()=>{
          const antDisp = anticipos.filter(a=>String(a.client_id)===String(f.client_id) && a.estado==='disponible')
          if(antDisp.length===0) return null
          const totalDisp = antDisp.reduce((s,a)=>s+(a.monto||0),0)
          const totalSel = antDisp.filter(a=>selAnt.has(a.id)).reduce((s,a)=>s+(a.monto||0),0)
          const fmtF = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
          const toggle = id => setSelAnt(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n })
          const montoFac = parseInt(f.amount)||0
          const cubre = montoFac>0 ? totalSel>=montoFac : totalSel>0
          const aplicar = () => { const ids=[...selAnt]; if(!ids.length) return; onConsume&&onConsume(ids,bill.id); if(cubre) up('status','Pagado'); setSelAnt(new Set()) }
          return (
            <div>
              <label style={flabel}>Anticipos disponibles</label>
              <div style={{border:'0.5px solid #C8EAD9',borderRadius:10,overflow:'hidden'}}>
                <div style={{background:C.greenBg,padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <span style={{display:'flex',alignItems:'center',gap:7,fontSize:12,fontWeight:500,color:C.greenText}}>
                    <svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='#1D9E75' strokeWidth='2'><circle cx='12' cy='12' r='10'/><line x1='12' y1='16' x2='12' y2='12'/><line x1='12' y1='8' x2='12.01' y2='8'/></svg>
                    Este cliente tiene anticipos sin aplicar
                  </span>
                  <span style={{fontSize:13,fontWeight:600,color:C.normal,flexShrink:0}}>{fmt(totalDisp)}</span>
                </div>
                {antDisp.map(a=>{ const on=selAnt.has(a.id); return (
                  <div key={a.id} onClick={()=>toggle(a.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 13px',borderTop:`0.5px solid ${C.border}`,background:'#fff',cursor:'pointer'}}>
                    <div style={{width:16,height:16,borderRadius:4,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',border:on?'1.5px solid #003C50':`1.5px solid ${C.border}`,background:on?C.accent:'#fff'}}>
                      {on&&<svg width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='#fff' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'><polyline points='20 6 9 17 4 12'/></svg>}
                    </div>
                    <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text}}>{fmt(a.monto)}</div><div style={{fontSize:11,color:C.textSoft,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{fmtF(a.fecha)}{a.proyecto?` · ${a.proyecto}`:''}{a.nota?` · ${a.nota}`:''}</div></div>
                    <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,flexShrink:0,background:on?C.greenBg:C.bgSoft,color:on?C.normal:C.done,whiteSpace:'nowrap'}}>{on?'Seleccionado':'Disponible'}</span>
                  </div>
                )})}
                <div style={{background:C.bgSoft,padding:'9px 13px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                  <span style={{fontSize:11,color:C.muted}}>Imputar: <b style={{color:C.text}}>{fmt(totalSel)}</b>{totalSel>0&&!cubre&&montoFac>0&&<span style={{color:C.soon}}> · abono, queda {fmt(montoFac-totalSel)}</span>}</span>
                  <button onClick={aplicar} disabled={totalSel<=0} style={{height:24,borderRadius:8,background:C.greenText,color:'#fff',border:'none',fontSize:11,fontWeight:500,padding:'0 12px',cursor:totalSel>0?'pointer':'not-allowed',opacity:totalSel>0?1:.6}}>{cubre?'Marcar como pagado':'Imputar abono'}</button>
                </div>
              </div>
            </div>
          )
        })()}

        <div>
          <label style={flabel}>Tipo de factura</label>
          {f.billing_type==='externo'||f.billing_type==='subarriendo'
            ? <div style={{fontSize:12.5,color:C.text,background:C.bgSoft,borderRadius:10,padding:'9px 12px'}}>{tipoFacturaLbl(f)}{f.billing_type==='externo'?' · el externo y el % se ven abajo, en «De terceros»':''}</div>
            : <div style={{display:'flex',background:C.bgSoft,borderRadius:10,padding:3,gap:2}}>
            {[['honorarios','Honorarios'],['reembolso','Gastos'],['comision','Comisión']].map(([v,l])=>{ const on=(f.billing_type||'honorarios')===v; return (
              <button key={v} type='button' onClick={()=>up('billing_type',v)} style={{flex:1,border:on?'0.5px solid rgba(0,0,0,.08)':'0.5px solid transparent',borderRadius:8,padding:'8px 0',background:on?'#fff':'transparent',color:on?C.text:C.muted,fontSize:12,cursor:'pointer'}}>{l}</button>
            )})}
          </div>}
          {f.billing_type==='comision'&&<input value={f.comision_origen||''} onChange={e=>up('comision_origen',e.target.value)} placeholder='Quién la generó (cliente derivado o asunto)' style={{...inp,marginTop:6}}/>}
        </div>

        <div><label style={flabel}>Concepto</label><input value={f.concept||''} onChange={e=>up('concept',e.target.value)} placeholder='Descripción del cobro...' style={inp}/></div>

        {f.client_id&&(
          <div>
            <label style={flabel}>Proyecto (venta)</label>
            <select value={f.sale_id||''} onChange={e=>up('sale_id',e.target.value||null)} style={sel}>
              <option value=''>— Sin proyecto —</option>
              {clientSales.map(s=><option key={s.id} value={s.id}>{s.title}{s.year?` · ${s.year}`:''}</option>)}
            </select>
            {sugVenta&&<button type='button' onClick={()=>up('sale_id',sugVenta.id)} style={{marginTop:5,fontSize:11,fontWeight:600,color:C.greenText,background:C.greenBg,border:'none',borderRadius:20,padding:'3px 11px',cursor:'pointer'}}><Sparkle/> Sugerido: {sugVenta.title}</button>}
            {f.sale_id&&hermanas.length>0&&!serieDone&&(
              <div style={{marginTop:8,background:C.greenBg,border:'0.5px solid #9FE1CB',borderRadius:10,padding:'9px 11px'}}>
                <div style={{fontSize:11,color:C.greenText,fontWeight:600,marginBottom:6}}>Hay {hermanas.length} factura{hermanas.length!==1?'s':''} más de esta serie sin proyecto. ¿Asignarla{hermanas.length!==1?'s':''} también a "{clientSales.find(s=>String(s.id)===String(f.sale_id))?.title||'esta venta'}"?</div>
                <div style={{display:'flex',gap:6}}>
                  <button type='button' onClick={()=>{ onAssignSeries&&onAssignSeries(f.sale_id, hermanas.map(b=>b.id)); setSerieDone(true) }} style={{fontSize:11,fontWeight:600,color:'#fff',background:C.greenText,border:'none',borderRadius:8,padding:'4px 12px',cursor:'pointer'}}>Sí, asignar {hermanas.length}</button>
                  <button type='button' onClick={()=>setSerieDone(true)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'#fff',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 12px',cursor:'pointer'}}>Solo esta</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Monto total (CLP)</label><input type='number' value={f.amount||''} onChange={e=>up('amount',e.target.value)} placeholder='0' style={inp}/></div>
          <div><label style={flabel}>De terceros (CLP)</label><input type='number' value={f.monto_terceros||''} onChange={e=>{ up('monto_terceros',e.target.value); const amt=Number(f.amount)||0, mt=parseInt(e.target.value)||0; setRetPct(amt>0&&mt>0?String(Math.round((amt-mt)/amt*100)):'') }} placeholder='0' style={inp}/></div>
        </div>
        {(Number(f.amount)||0)>0&&(()=>{ const amt=Number(f.amount)||0; const mt=parseInt(f.monto_terceros)||0; const com=Math.max(0,amt-mt); return (
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:C.muted}}>o retienes</span>
            <input value={retPct} onChange={e=>{ const v=e.target.value.replace(/[^\d.,]/g,''); setRetPct(v); if(v===''){ up('monto_terceros','') } else { const pct=Math.max(0,Math.min(100,parseFloat(String(v).replace(',','.'))||0)); up('monto_terceros',String(Math.round(amt*(1-pct/100)))) } }} inputMode='decimal' placeholder='0' style={{width:54,height:32,textAlign:'right',fontSize:12,fontWeight:700,border:`0.5px solid ${C.border}`,borderRadius:8,padding:'0 9px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}}/>
            <span style={{fontSize:12,fontWeight:700,color:C.tealText}}>%</span>
            {mt>0&&com>0&&<span style={{fontSize:11,color:C.greenText,fontWeight:600}}>Tu comisión {fmt(com)}</span>}
            {mt>0&&<span style={{fontSize:11,color:C.tealText}}>· externo {fmt(mt)}</span>}
          </div>) })()}
        {(parseInt(f.monto_terceros)||0)>0&&(
          <div>
            <label style={flabel}>¿A quién le pagas?</label>
            {terceroPagado?(
              <div style={{fontSize:12,color:C.muted,background:C.bgSoft,borderRadius:8,padding:'9px 11px'}}>Ya le pagaste a <b style={{color:C.text}}>{tituloProv(provsOrd.find(p=>String(p.id)===terceroProv))}</b>. Para cambiarlo, deshaz el pago en Comisiones.</div>
            ):provsOrd.length===0?(
              <div style={{fontSize:12,color:C.muted,background:C.bgSoft,borderRadius:8,padding:'9px 11px'}}>Crea proveedores en Facturación → Proveedores.</div>
            ):(
              <select value={terceroProv} onChange={e=>{ const pid=e.target.value; setTerceroProv(pid); if(pid&&!retPct&&comPctMap[String(pid)]!=null){ const pct=comPctMap[String(pid)]; setRetPct(String(pct)); const amt=Number(f.amount)||0; up('monto_terceros',String(Math.round(amt*(1-pct/100)))) } }} style={sel}>
                <option value=''>— Sin asignar —</option>
                {provsOrd.map(p=><option key={p.id} value={p.id}>{tituloProv(p)}</option>)}
              </select>
            )}
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Estado</label><select value={f.status||'Pendiente'} onChange={e=>up('status',e.target.value)} style={sel}>{estados.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><label style={flabel}>N° Factura</label><input value={f.invoice_no||''} onChange={e=>up('invoice_no',e.target.value)} placeholder='367...' style={inp}/></div>
        </div>

        {f.client_id&&(
          <div>
            <label style={flabel}>Razón social</label>
            {!nuevaRS&&rsList.length>0?(
              <select value={f.receptor_rut||''} onChange={e=>{
                if(e.target.value==='__nueva__'){setNuevaRS(true);up('receptor_name','');up('receptor_rut','')}
                else{const ce=rsList.find(x=>x.rut===e.target.value);up('receptor_name',ce?.name||'');up('receptor_rut',ce?.rut||'')}
              }} style={sel}>
                <option value=''>— Sin especificar —</option>
                {rsList.map(e=><option key={e.id} value={e.rut||e.name}>{e.name}{e.rut?` · ${fmtRutCL(e.rut)}`:''}</option>)}
                <option value='__nueva__'>+ Nueva razón social...</option>
              </select>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <input value={f.receptor_name||''} onChange={e=>up('receptor_name',e.target.value)} placeholder='Nombre / razón social' style={inp}/>
                <input value={f.receptor_rut||''} onChange={e=>up('receptor_rut',e.target.value)} placeholder='RUT (76.xxx.xxx-x)' style={inp}/>
                {rsList.length>0&&<button type='button' onClick={()=>{setNuevaRS(false);up('receptor_name','');up('receptor_rut','')}} style={{alignSelf:'flex-start',background:'none',border:'none',color:C.accent,fontSize:12,fontWeight:500,cursor:'pointer'}}><Gl n='chevL'/> Elegir de las existentes</button>}
              </div>
            )}
          </div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div><label style={flabel}>Emisión</label><input type='date' value={f.issued_at||''} onChange={e=>up('issued_at',e.target.value)} style={inp}/></div>
          <div><label style={flabel}>Vencimiento</label><input type='date' value={f.due||''} onChange={e=>up('due',e.target.value)} style={inp}/></div>
          {f.status==='Pagado'&&<div><label style={flabel}>Fecha de pago</label><input type='date' value={f.paid_at||''} onChange={e=>up('paid_at',e.target.value)} style={inp}/></div>}
        </div>

        <div>
          <label style={flabel}>Notas</label>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,alignItems:'center'}}>
            <input value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...' style={inp}/>
            {bill?.id&&user&&<Attachments inline table='billing_attachments' idField='billing_id' entityId={bill.id} folderKind='facturas' namePrefix={`${clients.find(c=>String(c.id)===String(f.client_id))?.name||''} · ${f.concept||'Cobro'}`} user={user} onChange={onAttachChange}/>}
          </div>
        </div>
      </div>
      {!(pagina&&isDesk)&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',padding:'12px 18px',borderTop:`0.5px solid ${C.border}`}}>
        {accionesEl}
        <button onClick={onClose} style={{height:36,padding:'0 16px',borderRadius:8,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:500,cursor:'pointer',marginLeft:'auto'}}>Cancelar</button>
        {guardarEl}
      </div>}
      </div>
      {pagina&&!isDesk&&historialEl}
      {pagina&&isDesk&&<div style={{position:'sticky',top:72,display:'flex',flexDirection:'column',gap:12}}>{saldoEl}<div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',display:'flex',flexDirection:'column',gap:8}}>{guardarEl}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{accionesEl}</div></div>{historialEl}</div>}
      </div>
      {anularOpen&&(
        <div style={{position:'fixed',inset:0,background:'rgba(20,30,35,.45)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>e.target===e.currentTarget&&setAnularOpen(false)}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,padding:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:4}}>Dar de baja factura</div>
            <div style={{fontSize:12,color:C.muted,marginBottom:10}}>{f.concept||'—'} · {fmt(parseInt(f.amount)||0)}</div>
            {bill?.dte_track_id
              ? <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:8,background:C.azulBg,color:C.accent,fontSize:12,fontWeight:600,marginBottom:12}}><BanIcon size={15} color={C.accent}/>Emitida al SII: se anula con una Nota de Crédito electrónica</div>
              : <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',borderRadius:8,background:C.soonBg,color:C.soonText,fontSize:12,fontWeight:600,marginBottom:12}}><BanIcon size={15} color='#C77F18'/>Podrás reactivarla después si fue un error</div>}
            <label style={flabel}>Motivo</label>
            <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:12}}>
              {MOTIVOS_BAJA.map(m=>(
                <button key={m} onClick={()=>setMotivoBaja(m)} style={{textAlign:'left',padding:'8px 11px',borderRadius:8,border:`1.5px solid ${motivoBaja===m?C.overdue:C.border}`,background:motivoBaja===m?C.overdueBg:'transparent',color:motivoBaja===m?C.overdue:C.text,fontSize:12,fontWeight:motivoBaja===m?700:500,cursor:'pointer'}}>{m}</button>
              ))}
            </div>
            <label style={flabel}>Observaciones (opcional)</label>
            <input value={obsBaja} onChange={e=>setObsBaja(e.target.value)} placeholder='Detalle adicional...' style={{...inp,marginBottom:14}}/>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setAnularOpen(false)} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
              <button disabled={!motivoBaja} onClick={async()=>{ await onAnular(bill,motivoBaja,obsBaja); setAnularOpen(false); onClose() }} style={{flex:2,height:44,borderRadius:10,border:'none',background:motivoBaja?C.overdue:C.done,color:'#fff',fontSize:13,fontWeight:700,cursor:motivoBaja?'pointer':'default'}}>{bill?.dte_track_id?'Anular y emitir NC':'Confirmar baja'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export const MOTIVOS_BAJA = ['Servicio no prestado','Cliente canceló el servicio','Error al programar','Facturado por otro medio','Otro']

