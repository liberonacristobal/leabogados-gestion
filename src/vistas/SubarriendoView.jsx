// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, Fragment } from 'react'
import { supabase, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { C, Gl, SIcon, _normTxt, appAlert, fmt, fmtFechaDMY, folioN, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { esSubarriendo } from '../lib/cifras.js'
import { ActBtn, KpiIco, PageHeader, esFacIngreso, fmtMill, loadXLSXStyle } from '../lib/compartido.jsx'

// ── SUBARRIENDO (página propia, en Oficina): ingreso por arriendo, NO honorarios ni comisiones. No se mezcla con Proveedores.
// Fuente única: la venta marcada esSubarriendo + sus facturas (billing_type='subarriendo') + sus anticipos (pago sin factura) + el banco
// (conciliación de esas facturas/anticipos). Mes a mes (render aprobado 2026-10-16): tarjetas que filtran, grupos plegables, fila que se despliega.
export const SUB_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

// Meses que cubre un documento según su glosa ("Mensual Octubre 2026", "(marzo–abril 2026)"); si no los nombra, se deducen del monto.
export function subMesesDe(texto, fechaRef, monto, mensual){
  const t=_normTxt(texto), ys=(String(texto||'').match(/(20\d\d)/)||[])[1], y=Number(ys)||Number(String(fechaRef||'').slice(0,4))||null
  const idx=SUB_MESES.map((m,i)=>({i,p:t.indexOf(m)})).filter(x=>x.p>=0).sort((a,b)=>a.p-b.p).map(x=>x.i)
  if(y&&idx.length){ const a=idx[0], b=idx[idx.length-1]; const out=[]; for(let m=a;m<=Math.max(a,b);m++) out.push(`${y}-${String(m+1).padStart(2,'0')}`); return out }
  const f=String(fechaRef||'').slice(0,7); if(!f) return []
  const n=Math.max(1,Math.round((Number(monto)||0)/(mensual||Number(monto)||1)))
  const out=[]; let [yy,mm]=f.split('-').map(Number); for(let k=0;k<n;k++){ out.push(`${yy}-${String(mm).padStart(2,'0')}`); mm++; if(mm>12){mm=1;yy++} } return out
}

export function SubarriendoView({sales=[],billing=[],anticipos=[],clients=[],onOpenSale,onOpenFactura,onOpenClientFicha,onIrBanco,onCargarFactura,onBack,origen='Oficina'}){
  const isDesktop=useIsDesktop()
  const hoyISO=isoLocal(Date.now()), hoyYM=hoyISO.slice(0,7)
  const subVentas = sales.filter(s=>esSubarriendo(s)&&!s.deleted_at)
  const venta = subVentas[0]||null
  const ventaIds = new Set(subVentas.map(s=>String(s.id)))
  const subFacturas = billing.filter(b=>!b.deleted_at&&b.status!=='Anulada'&&(b.billing_type==='subarriendo'||ventaIds.has(String(b.sale_id)))&&!esFacIngreso(b))
  const subAnt = anticipos.filter(a=>ventaIds.has(String(a.sale_id)))
  const mensual = venta ? (Number(venta.amount_clp)||0) : 0
  const cli = venta ? clients.find(c=>String(c.id)===String(venta.client_id)) : null
  const inicioYM = venta ? `${venta.year||hoyISO.slice(0,4)}-${String(venta.month||1).padStart(2,'0')}` : hoyYM
  // Banco: depósitos conciliados a esas facturas y anticipos (fecha real del pago).
  const [conc,setConc]=useState([]), [movs,setMovs]=useState({})
  const fIds=subFacturas.map(b=>b.id).join(','), aIds=subAnt.map(a=>a.id).join(',')
  useEffect(()=>{ let vivo=true
    if(DEMO){ const cc=(demoData.conciliacion||[]).filter(c=>fIds.includes(String(c.factura_id))||aIds.includes(String(c.anticipo_id))); const mm={}; (demoData.cartola_movimientos||[]).forEach(m=>{ if(cc.some(c=>String(c.movimiento_id)===String(m.id))) mm[m.id]=m }); setConc(cc); setMovs(mm); return }
    ;(async()=>{ try{
      const fs=fIds?fIds.split(','):[], as=aIds?aIds.split(','):[]
      const [r1,r2]=await Promise.all([fs.length?supabase.from('conciliacion').select('movimiento_id,factura_id,anticipo_id,monto_aplicado').in('factura_id',fs):Promise.resolve({data:[]}), as.length?supabase.from('conciliacion').select('movimiento_id,factura_id,anticipo_id,monto_aplicado').in('anticipo_id',as):Promise.resolve({data:[]})])
      const cc=[...(r1.data||[]),...(r2.data||[])], ids=[...new Set(cc.map(c=>c.movimiento_id).filter(Boolean))]
      const {data:mv}=ids.length?await supabase.from('cartola_movimientos').select('id,fecha,monto,cuenta').in('id',ids):{data:[]}
      if(!vivo) return; const mm={}; (mv||[]).forEach(m=>{ mm[m.id]=m }); setConc(cc); setMovs(mm)
    }catch(_){} })()
    return ()=>{ vivo=false } },[fIds,aIds])
  // Mes → {factura, pagos[]}. Pagos de una factura (o de su anticipo) se reparten en orden por los meses que cubre.
  const porMes = {}
  const mesDe = ym => (porMes[ym]=porMes[ym]||{ym,fac:null,pagos:[],ant:null})
  const pagosDe = (campo,id) => conc.filter(c=>String(c[campo])===String(id)).map(c=>({mov:movs[c.movimiento_id]||null,monto:Number(c.monto_aplicado)||0,movId:c.movimiento_id})).sort((a,b)=>String(a.mov?.fecha||'').localeCompare(String(b.mov?.fecha||'')))
  subFacturas.forEach(b=>{ const ms=subMesesDe(b.concept,b.issued_at||b.due,b.amount,mensual); const pg=[...pagosDe('factura_id',b.id),...(b.prepaid_anticipo_id?pagosDe('anticipo_id',b.prepaid_anticipo_id):[])]
    ms.forEach((ym,i)=>{ const x=mesDe(ym); if(!x.fac||(!x.fac.invoice_no&&b.invoice_no)) x.fac=b; const p=pg[i]||(pg.length===1&&ms.length>1?null:null); if(p) x.pagos.push(p) }) })
  subAnt.forEach(a=>{ if(subFacturas.some(b=>String(b.prepaid_anticipo_id)===String(a.id))) return
    const ms=subMesesDe(a.nota,a.fecha,a.monto,mensual); const pg=pagosDe('anticipo_id',a.id)
    ms.forEach((ym,i)=>{ const x=mesDe(ym); x.ant=a; const p=pg[i]||(i===0&&!pg.length?{mov:null,monto:Number(a.monto)||0,fecha:a.fecha}:null); if(p) x.pagos.push(p) }) })
  // Años y meses del año elegido: desde el inicio del contrato hasta diciembre (o hasta el último mes con documento).
  const ymsDoc=Object.keys(porMes).sort()
  const anioIni=Number(inicioYM.slice(0,4)), anioFin=Math.max(Number(hoyISO.slice(0,4)), Number((ymsDoc[ymsDoc.length-1]||hoyYM).slice(0,4)))
  const anios=[]; for(let y=anioFin;y>=anioIni;y--) anios.push(y)
  const [yr,setYr]=useState(Number(hoyISO.slice(0,4)))
  const [lf,setLf]=useState(null), [modo,setModo]=useState('mes'), [abierto,setAbierto]=useState(null), [plegado,setPlegado]=useState({ok:true,prog:true})
  const meses=[]; for(let m=1;m<=12;m++){ const ym=`${yr}-${String(m).padStart(2,'0')}`; if(ym<inicioYM) continue; meses.push(porMes[ym]||{ym,fac:null,pagos:[],ant:null}) }
  const pagadoDe = x => x.pagos.reduce((s,p)=>s+p.monto,0)
  const fechaPago = x => { const p=x.pagos[0]; return p ? (p.mov?.fecha||p.fecha||null) : null }
  const venceDe = ym => `${ym}-01`
  const est = x => { const pag=pagadoDe(x)>0, fac=!!x.fac?.invoice_no
    if(pag) return fac?'ok':'pf'
    const diasVenc=(new Date(hoyISO)-new Date(venceDe(x.ym)))/86400000
    return diasVenc>9 ? 'sp' : 'prog' }
  const montoMes = x => pagadoDe(x)||mensual
  const ESTL = {sp:['Sin pago',C.overdueText,C.overdueBg,'tCobrar'],pf:['Factura pendiente',C.soonText,C.soonBg,'tSinFac'],ok:['Pagado y facturado',C.greenText,C.greenBg,'tCheck'],prog:['Programado',C.muted,C.card,'tEspera']}
  const grupos = ['sp','pf','ok','prog'].map(k=>({k,xs:meses.filter(x=>est(x)===k)}))
  const sumG = xs => xs.reduce((s,x)=>s+montoMes(x),0)
  const cobrado = meses.reduce((s,x)=>s+pagadoDe(x),0)
  const facturado = meses.filter(x=>x.fac?.invoice_no).reduce((s,x)=>s+mensual,0)
  const nPag = meses.filter(x=>pagadoDe(x)>0).length
  const G = k => grupos.find(g=>g.k===k).xs
  const rsFac = subFacturas.find(b=>b.invoice_no&&b.receptor_name)
  const receptor = rsFac ? `${rsFac.receptor_name}${rsFac.receptor_rut?' · '+rsFac.receptor_rut:''}` : (cli?.name||'')
  const mesLbl = ym => { const [y,m]=ym.split('-'); const s=SUB_MESES[Number(m)-1]; return s.charAt(0).toUpperCase()+s.slice(1)+' '+y }
  const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}
  const kLbl={fontSize:10,fontWeight:700,color:C.accent,textTransform:'uppercase',letterSpacing:.5}
  const num={fontVariantNumeric:'tabular-nums'}
  // Tarjetas (mismo componente que Comisiones): etiqueta + cifra en $M; filtran la lista.
  const tile = (k,l,v,bg,fg,ico,onTap) => { const on=lf===k, tap=onTap||(v?()=>setLf(on?null:k):null), blanco=bg===C.card
    return <div key={k} onClick={tap||undefined} className={tap?'pv-c':undefined} style={{background:bg,border:`1px solid ${blanco?C.border:'transparent'}`,borderRadius:10,padding:isDesktop?'10px 12px':'10px',cursor:tap?'pointer':'default',minWidth:0,outline:on?`1.5px solid ${fg}`:'none',outlineOffset:-1.5,display:'flex',gap:10,alignItems:'center'}}>
      {isDesktop&&<KpiIco n={ico} c={fg} soft={blanco}/>}
      <div style={{minWidth:0}}><div style={{...kLbl,color:fg,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',...(isDesktop?{}:{fontSize:9.5,letterSpacing:.3})}}>{l}</div><div style={{fontSize:isDesktop?19:17,fontWeight:700,color:fg,letterSpacing:-.4,...num,marginTop:1,whiteSpace:'nowrap'}}>{v?fmtMill(v):'—'}</div></div></div> }
  const nTxt = (l,xs) => xs.length?`${l} · ${xs.length}`:l
  const tiles = <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'repeat(2,minmax(0,1fr))',gap:8}}>
    {tile('cob',`Cobrado · ${yr}`,cobrado,C.greenBg,C.greenText,'tCheck')}
    {tile('pf',nTxt('Factura pendiente',G('pf')),sumG(G('pf')),C.soonBg,C.soonText,'tSinFac')}
    {tile('sp',nTxt('Sin pago',G('sp')),sumG(G('sp')),C.overdueBg,C.overdueText,'tCobrar')}
    {tile('fac',`Facturado · ${yr}`,facturado,C.card,C.accent,'tFavor')}
    {tile('prog',nTxt('Programado',G('prog')),sumG(G('prog')),C.card,C.accent,'tEspera')}
    {tile('men','Arriendo mensual',mensual,C.card,C.accent,'tBanco',venta&&onOpenSale?()=>onOpenSale(venta):null)}
  </div>
  // Filtro de tarjeta → qué meses se ven (y abiertos).
  const filtroMes = x => !lf ? true : lf==='cob' ? pagadoDe(x)>0 : lf==='fac' ? !!x.fac?.invoice_no : est(x)===lf
  const qi = (l,v,on) => <div onClick={on?e=>{e.stopPropagation();on()}:undefined} className={on?'pv-c':undefined} style={{display:'flex',justifyContent:'space-between',gap:8,fontSize:11.5,padding:'2px 4px',margin:'0 -4px',borderRadius:5,cursor:on?'pointer':'default'}}><span style={{color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{l}</span><b style={{...num,color:on?C.accent:C.text,whiteSpace:'nowrap'}}>{v}</b></div>
  const qBox = (t,h) => <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 10px',minWidth:0}}><div style={{...kLbl,fontSize:9.5,marginBottom:3}}>{t}</div>{h}</div>
  const detalle = x => { const e=est(x), b=x.fac, p=x.pagos[0]
    return <div onClick={ev=>ev.stopPropagation()} style={{gridColumn:'1/-1',padding:'8px 0 4px'}}>
      <div style={{display:'grid',gridTemplateColumns:isDesktop?'repeat(3,minmax(0,1fr))':'1fr',gap:10}}>
        {qBox('Pago', x.pagos.length ? <>{x.pagos.map((pg,i)=><Fragment key={i}>{qi(`Recibido ${fmtFechaDMY(pg.mov?.fecha||pg.fecha)}`,fmt(pg.monto))}</Fragment>)}{p?.mov&&qi(`Cuenta ${p.mov.cuenta||''}`,<>Ver <Gl n='chevron'/></>,onIrBanco?()=>onIrBanco(p.movId):null)}</> : <>{qi(e==='sp'?`Vencido el ${fmtFechaDMY(venceDe(x.ym))}`:`Vence el ${fmtFechaDMY(venceDe(x.ym))}`,fmt(mensual))}{qi('Sin pago registrado','—')}</>)}
        {qBox('Factura', b?.invoice_no ? <>{qi(`Factura N° ${folioN(b.invoice_no)} · ${fmtFechaDMY(b.issued_at)}`,fmt(Number(b.amount)||0),onOpenFactura?()=>onOpenFactura(b):null)}{qi(b.status==='Pagado'?'Pagada':b.status,'')}</> : b ? <>{qi('Programada',fmt(Number(b.amount)||0),onOpenFactura?()=>onOpenFactura(b):null)}{qi(receptor,'')}</> : <>{qi('Pendiente de emitir',fmt(montoMes(x)))}{qi(receptor,'')}</>)}
        {qBox('Contrato', <>{qi(`Mensual · desde ${inicioYM.slice(5)}-${inicioYM.slice(0,4)}`,fmt(mensual))}{qi('Venta del subarriendo',<>Ver <Gl n='chevron'/></>,venta&&onOpenSale?()=>onOpenSale(venta):null)}</>)}
      </div>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8,flexWrap:'wrap'}}>
        {p?.mov&&onIrBanco&&<ActBtn variant='ghost' onClick={()=>onIrBanco(p.movId)}>Ver en Banco <Gl n='chevron'/></ActBtn>}
        {b?.invoice_no&&onOpenFactura&&<ActBtn variant='ghost' onClick={()=>onOpenFactura(b)}>Ver factura <Gl n='chevron'/></ActBtn>}
        {e==='pf'&&onCargarFactura&&<ActBtn variant='primary' onClick={onCargarFactura}>Cargar factura <Gl n='chevron'/></ActBtn>}
      </div>
    </div> }
  const COLS='minmax(200px,1.6fr) 150px 150px 140px 18px'
  const celFac = x => { const e=est(x); return x.fac?.invoice_no ? <span style={{color:C.text}}>N° {folioN(x.fac.invoice_no)}</span> : e==='pf' ? <span style={{color:C.soonText,fontWeight:700}}>Pendiente</span> : <span style={{color:C.done}}>—</span> }
  const celPago = x => { const e=est(x), f=fechaPago(x); return f ? <span style={num}>{fmtFechaDMY(f)}</span> : e==='sp' ? <span style={{color:C.overdueText,fontWeight:700}}>Sin pago</span> : <span style={{color:C.done}}>—</span> }
  const subFila = x => { const e=est(x), f=fechaPago(x)
    if(e==='sp') return `Vencido el ${fmtFechaDMY(venceDe(x.ym))}`
    if(e==='prog') return `Vence el ${fmtFechaDMY(venceDe(x.ym))}`
    return isDesktop ? (cli?.name||receptor) : `Pagado ${fmtFechaDMY(f)}${x.fac?.invoice_no?` · N° ${folioN(x.fac.invoice_no)}`:' · factura pendiente'}` }
  const colMonto = x => { const e=est(x); return e==='sp'?C.overdueText:e==='prog'?C.textSoft:C.text }
  const filaMes = x => { const open=abierto===x.ym
    if(!isDesktop) return <div key={x.ym} onClick={()=>setAbierto(open?null:x.ym)} style={{padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:13.5,fontWeight:700,color:C.accent}}>{mesLbl(x.ym)}</div><div style={{fontSize:11,color:est(x)==='sp'?C.overdueText:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subFila(x)}</div></div><div style={{fontSize:13,fontWeight:700,color:colMonto(x),...num}}>{fmt(montoMes(x))}</div></div>
      {open&&detalle(x)}</div>
    return <div key={x.ym} onClick={()=>setAbierto(open?null:x.ym)} className='pv-c' style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,alignItems:'center',padding:'9px 14px',borderTop:`1px solid ${C.bgSoft}`,fontSize:12.5,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
      <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{mesLbl(x.ym)}</div><div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{subFila(x)}</div></div>
      <span style={{textAlign:'right'}}>{celPago(x)}</span><span style={{textAlign:'right'}}>{celFac(x)}</span>
      <span style={{textAlign:'right',fontWeight:700,color:colMonto(x),...num}}>{fmt(montoMes(x))}</span>
      <span style={{color:C.textSoft,fontSize:11}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>
      {open&&detalle(x)}</div> }
  const band = (k,xs) => { const fold=!lf&&plegado[k]; return <div onClick={()=>!lf&&setPlegado(p=>({...p,[k]:!p[k]}))} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',background:C.bgSoft,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,cursor:lf?'default':'pointer'}}><span style={{...kLbl,flex:1}}>{ESTL[k][0]} · {xs.length}</span>{isDesktop&&<span style={{...kLbl,...num,letterSpacing:0}}>{fmt(sumG(xs))}</span>}{!lf&&<span style={{color:C.textSoft,fontSize:11}}>{fold?<Gl n='chevD'/>:<Gl n='chevU'/>}</span>}</div> }
  const listaMes = <div style={card}>
    {isDesktop&&<div style={{display:'grid',gridTemplateColumns:COLS,columnGap:12,padding:'8px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,...kLbl,fontSize:9.5}}><span>Mes</span><span style={{textAlign:'right'}}>Fecha de pago</span><span style={{textAlign:'right'}}>Factura</span><span style={{textAlign:'right'}}>Monto</span><span/></div>}
    {grupos.map(g=>{ const xs=g.xs.filter(filtroMes); if(!xs.length) return null; const fold=!lf&&plegado[g.k]; return <Fragment key={g.k}>{band(g.k,xs)}{!fold&&xs.map(filaMes)}</Fragment> })}
    {meses.filter(filtroMes).length===0&&<div style={{padding:'16px 14px',fontSize:12.5,color:C.muted}}>Nada en este filtro.</div>}
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'9px 14px',borderTop:`1px solid ${C.border}`,fontSize:12.5,fontWeight:700}}><span style={{flex:1}}>Cobrado {yr} · {nPag} pago{nPag!==1?'s':''}</span><span style={num}>{fmt(cobrado)}</span>{isDesktop&&<span style={{width:18}}/>}</div>
  </div>
  // Por factura: cada documento con los meses que cubre; los pagos sin factura van juntos al final.
  const facsAnio = subFacturas.filter(b=>subMesesDe(b.concept,b.issued_at||b.due,b.amount,mensual).some(ym=>ym.startsWith(String(yr)))).sort((a,b)=>String(a.due||a.issued_at||'').localeCompare(String(b.due||b.issued_at||'')))
  const sinFac = meses.filter(x=>est(x)==='pf')
  const filaFac = b => { const ms=subMesesDe(b.concept,b.issued_at||b.due,b.amount,mensual), open=abierto==='f:'+b.id, xs=ms.map(ym=>porMes[ym]).filter(Boolean)
    const pag=xs.reduce((s,x)=>s+pagadoDe(x),0), titulo=b.invoice_no?`Factura N° ${folioN(b.invoice_no)}`:'Programada'
    const rango=ms.length>1?`${SUB_MESES[Number(ms[0].slice(5))-1]}–${mesLbl(ms[ms.length-1]).toLowerCase()}`:mesLbl(ms[0]||'').toLowerCase()
    return <div key={b.id} onClick={()=>setAbierto(open?null:'f:'+b.id)} className='pv-c' style={{padding:isDesktop?'9px 14px':'10px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer',background:open?C.bgSoft:'transparent'}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:C.accent}}>{titulo}</div><div style={{fontSize:11,color:C.muted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{rango}{b.issued_at&&b.invoice_no?` · emitida ${fmtFechaDMY(b.issued_at)}`:''}{pag?' · pagada':''}</div></div><div style={{fontSize:13,fontWeight:700,...num}}>{fmt(Number(b.amount)||0)}</div>{isDesktop&&<span style={{color:C.textSoft,fontSize:11}}>{open?<Gl n='chevU'/>:<Gl n='chevD'/>}</span>}</div>
      {open&&<div onClick={e=>e.stopPropagation()} style={{padding:'6px 0 2px',display:'grid',gap:2}}>{xs.map(x=><Fragment key={x.ym}>{qi(`${mesLbl(x.ym)} · ${fechaPago(x)?'pagado '+fmtFechaDMY(fechaPago(x)):'sin pago'}`,fmt(montoMes(x)),x.pagos[0]?.mov&&onIrBanco?()=>onIrBanco(x.pagos[0].movId):null)}</Fragment>)}<div style={{display:'flex',justifyContent:'flex-end',marginTop:6}}>{onOpenFactura&&<ActBtn variant='ghost' onClick={()=>onOpenFactura(b)}>Ver factura <Gl n='chevron'/></ActBtn>}</div></div>}
    </div> }
  const listaFac = <div style={card}>
    {facsAnio.length>0&&<>{<div style={{padding:'8px 14px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,...kLbl}}>Facturas · {facsAnio.length}</div>}{facsAnio.map(filaFac)}</>}
    {sinFac.length>0&&<>{band('pf',sinFac)}{!plegado.pf&&sinFac.map(filaMes)}</>}
    {!facsAnio.length&&!sinFac.length&&<div style={{padding:'16px 14px',fontSize:12.5,color:C.muted}}>Sin facturas en {yr}.</div>}
  </div>
  const exportar = async () => { try{ const XLSX=await loadXLSXStyle()
    const rows=meses.map(x=>[mesLbl(x.ym), fechaPago(x)?fmtFechaDMY(fechaPago(x)):'', x.fac?.invoice_no?`N° ${folioN(x.fac.invoice_no)}`:'', ESTL[est(x)][0], montoMes(x)])
    const ws=XLSX.utils.aoa_to_sheet([[`Subarriendo ${cli?.name||''} · ${yr}`],[],['Mes','Fecha de pago','Factura','Estado','Monto'],...rows,[],['Cobrado','','','',cobrado],['Factura pendiente','','','',sumG(G('pf'))],['Sin pago','','','',sumG(G('sp'))]])
    ws['!cols']=[{wch:18},{wch:14},{wch:12},{wch:20},{wch:14}]
    Object.keys(ws).forEach(k=>{ if(/^E\d+$/.test(k)&&typeof ws[k].v==='number'){ ws[k].z='"$"#,##0' } })
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Subarriendo'); XLSX.writeFile(wb,`Subarriendo ${yr}.xlsx`) }catch(e){ appAlert('No se pudo exportar: '+e.message) } }
  const selAnio = <select value={yr} onChange={e=>{setYr(Number(e.target.value));setLf(null);setAbierto(null)}} style={{fontSize:12.5,fontWeight:700,color:C.accent,border:`1px solid ${C.border}`,borderRadius:8,padding:'6px 8px',background:C.card,outline:'none',cursor:'pointer'}}>{anios.map(y=><option key={y} value={y}>{y}</option>)}</select>
  const btnExcel = <span onClick={exportar} title='Descargar Excel' style={{height:30,width:32,display:'inline-flex',alignItems:'center',justifyContent:'center',border:`1px solid ${C.border}`,borderRadius:8,background:C.card,cursor:'pointer'}}><SIcon n='download' s={14} c={C.accent}/></span>
  const segModo = <div style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>{[['mes','Por mes'],['fac','Por factura']].map(([k,l])=><span key={k} onClick={()=>{setModo(k);setAbierto(null)}} style={{fontSize:12,fontWeight:700,padding:'6px 12px',cursor:'pointer',background:modo===k?C.accent:C.card,color:modo===k?'#fff':C.muted}}>{l}</span>)}</div>
  const css = <style>{`.pv-c:hover{background:${C.azulBg};box-shadow:0 0 0 2px ${C.azulBg}}`}</style>
  return (<div>
    {css}
    <PageHeader origen={origen} onBack={onBack} titulo='Subarriendo' ctx={cli&&isDesktop?<span onClick={()=>onOpenClientFicha&&onOpenClientFicha(cli.id)} style={{cursor:'pointer',color:C.accent,fontWeight:600,textDecoration:'underline',textUnderlineOffset:2}}>{cli.name}</span>:null} right={venta?<span style={{display:'inline-flex',gap:8,alignItems:'center'}}>{selAnio}{btnExcel}</span>:null}/>
    <div style={{padding:isDesktop?'14px 26px 48px':'12px 12px 40px',display:'flex',flexDirection:'column',gap:12}}>
      {!venta ? <div style={{...card,padding:24,textAlign:'center',color:C.muted,fontSize:13}}>No hay un subarriendo registrado.</div> : <>
        {tiles}
        <div style={{display:'flex',justifyContent:isDesktop?'flex-end':'flex-start'}}>{segModo}</div>
        {modo==='mes'?listaMes:listaFac}
      </>}
    </div>
  </div>)
}

