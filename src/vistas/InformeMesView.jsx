// Cierre del mes: informe con IA (6 puntos en tarjetas, variante «Cifra arriba»), comparación mes contra mes (variaciones en lista) y lo que hay hoy.
// Las cifras salen de las mismas funciones de Inicio, Estado de resultados, Socios y Cobranza; la IA solo redacta con ese resumen y su texto se verifica
// número por número contra él (_shared/informeMes.js). El informe se guarda por mes en learnings (kind informe_mes) y se regenera a pedido.
import { useEffect, useMemo, useState } from 'react'
import { supabase, DEMO } from '../supabase'
import { C, SIcon, fmtFechaDMY, useIsDesktop } from '../lib/base.jsx'
import { PageHeader, _ymPrev, claudeCall, fmtShort, fmtUFk, resultadoMes, resumenCartera, saldoComisiones, setLearningKV, porCobrarBills, useFlujoCaja } from '../lib/compartido.jsx'
import { esSubarriendo, ventaUF } from '../lib/cifras.js'
import { useResultadoAnio } from '../lib/resultadoAnio.js'
import { retirosSocios } from './SociosView.jsx'
import { leerFoto, filasFoto, resumenFoto } from '../../supabase/functions/_shared/fotoMes.js'
import { INDICADORES, construirDossier, estadosTemas, filasComparacion, leerInformeIA, textoDeInforme, textoVariacion, verificarTexto } from '../../supabase/functions/_shared/informeMes.js'

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const etiquetaMes = ym => `${MESES[Number(ym.slice(5,7))-1]} ${ym.slice(0,4)}`
const cap = s => s.charAt(0).toUpperCase()+s.slice(1)
const ESTADO = { mejora:['Mejora',C.greenBg,C.greenText], atencion:['Atención',C.soonBg,C.soonText], riesgo:['Riesgo',C.overdueBg,C.overdueText], sin_cambio:['Sin cambio',C.bgSoft,C.muted] }
const TEMA_LBL = { resultado:'Resultado', cobranza:'Cobranza', ventas:'Ventas', comisiones:'Comisiones', retiros:'Retiros', liquidez:'Liquidez' }
const ENLACE_LBL = { estadoResultados:'Estado de resultados', cobranza:'Por cobrar', ventas:'Ventas', proveedores:'Por pagar', socios:'Socios', flujoCaja:'Flujo de caja' }
const PILL = { up:[C.greenBg,C.greenText], dn:[C.overdueBg,C.overdueText], nt:[C.bgSoft,C.muted] }
const DEST_CIERRE = { porCobrar:'cobranza', vencido:'cobranza', m60:'cobranza', comisiones:'proveedores', fondos:'gastos' }
const DEST_FILA = { Resultado:'estadoResultados', Ventas:'ventas', 'Socios y pagos':'socios' }

const SYSTEM = `Eres analista financiero de un estudio de abogados chileno. Recibes un RESUMEN en JSON con las cifras de un mes, ya calculadas por el sistema, comparadas con el mes anterior. Redacta el informe del mes.
Reglas:
1) Usa SOLO números que estén en el resumen y cópialos exactamente como aparecen (por ejemplo «$11,4M», «+24%», «UF 640», «72%»). No calcules, no redondees, no conviertas monedas ni inventes cifras.
2) Si el resumen no explica la causa de un cambio, dilo («el resumen no permite precisar la causa»); no especules.
3) Registro formal de oficina de abogados, sin exclamaciones ni jerga.
4) El estado de cada tema ya viene decidido en el resumen (estados): respétalo y no lo contradigas.
5) Enfoque financiero: calidad del ingreso (cobrado frente a ingresos), mora (vencido sobre lo por cobrar), margen, costos, comisiones como pasivo, retiros frente al resultado y liquidez.
Devuelve SOLO un JSON: {"frase": una oración de lectura general de hasta 25 palabras, "puntos": [seis objetos, en este orden fijo: resultado, cobranza, ventas, comisiones, retiros, liquidez]}.
Cada punto: {"tema": ..., "cifra": la cifra principal copiada, "etiqueta": una o dos palabras, "variacion": copiada del resumen o "", "titular": hasta 14 palabras con la cifra clave, "porque": hasta 30 palabras con lo que lo explica según el resumen, "enlace": estadoResultados | cobranza | ventas | proveedores | socios | flujoCaja (en el orden de los temas)}.`

export function InformeMesView({ sales=[], billing=[], clients=[], terceros=[], expenses=[], anticipos=[], costosOfiRows=[], fantasmaIds=null, socios=[], user=null, onGo, onBack, backLabel='Panel de socios' }){
  const isDesktop = useIsDesktop()
  const hoy = new Date().toISOString().slice(0,10), ymHoy = hoy.slice(0,7), ultimoCerrado = _ymPrev(ymHoy)
  const [ym,setYm] = useState(ultimoCerrado)
  const ymP = _ymPrev(ym), anio = Number(ym.slice(0,4)), mismoAnio = ymP.slice(0,4)===ym.slice(0,4)
  const go = (d,x) => onGo&&onGo(d,x)
  const pct1 = v => v==null?'—':(Math.round(v*10)/10).toLocaleString('es-CL',{minimumFractionDigits:1,maximumFractionDigits:1})

  // ── Cifras del mes y del anterior: las funciones de siempre ──
  const R = useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear:anio })
  const deps = { billing, terceros, costosOfiRows, expenses, clients }
  const rm = useMemo(()=>resultadoMes(R.fuRes,deps,ym),[R.fuRes,billing,terceros,costosOfiRows,expenses,clients,ym])
  const rp = useMemo(()=>resultadoMes(R.fuRes,deps,ymP),[R.fuRes,billing,terceros,costosOfiRows,expenses,clients,ymP])
  const byMes = R.ingresosPorAnioVenta.byMonth||{}
  const cierran = (ymX) => (sales||[]).filter(s=>s&&!s.deleted_at&&['Activo','Terminado'].includes(s.status)&&!esSubarriendo(s)&&String(s.activated_at||'').slice(0,7)===ymX)
  const ventasDe = ymX => { const l=cierran(ymX); return { n:l.length, uf:l.reduce((a,s)=>a+ventaUF(s,R.ufRef),0) } }
  const vM = ventasDe(ym), vP = ventasDe(ymP)
  const ret = useMemo(()=>retirosSocios({ expenses, clients, socios, yr:anio }),[expenses,clients,socios,anio])
  const retDe = ymX => ret.retSoc.filter(r=>String(r.d0).slice(0,7)===ymX).reduce((a,r)=>a+r.amt,0)
  const d = { m:{ ing:rm.ing, cobrado:byMes[ym]??0, cos:rm.cos, com:rm.com, res:rm.res, margen:rm.margen, ventasUF:vM.uf, ventasN:vM.n, retiros:retDe(ym) },
              p:{ ing:rp.ing, cobrado:mismoAnio?(byMes[ymP]??0):null, cos:rp.cos, com:rp.com, res:rp.res, margen:rp.margen, ventasUF:vP.uf, ventasN:vP.n, retiros:mismoAnio?retDe(ymP):null } }
  const filas = useMemo(()=>filasComparacion(d),[JSON.stringify(d)])

  // ── Cartera al cierre: la foto que la app guarda el día 1 de cada mes (learnings foto_mes, key = mes que cierra) ──
  const [fotos,setFotos] = useState({})
  useEffect(()=>{ let v=true; setFotos({}); if(DEMO) return
    supabase.from('learnings').select('key,value').eq('kind','foto_mes').in('key',[ym,ymP]).then(({data})=>{ if(!v) return; const o={}; (data||[]).forEach(r=>{ const f=leerFoto(r.value); if(f) o[r.key]=f }); setFotos(o) },()=>{})
    return ()=>{ v=false } },[ym])
  const fM = fotos[ym]||null, fP = fotos[ymP]||null
  const filasCierre = useMemo(()=>filasFoto(fM,fP),[fM,fP])

  // ── Lo que hay hoy ──
  const cart = useMemo(()=>resumenCartera(billing),[billing])
  const porCobrar = porCobrarBills(billing)
  const sc = useMemo(()=>saldoComisiones(terceros,billing),[terceros,billing])
  const diasCom = sc.porPagarDesde ? Math.round((Date.now()-new Date(sc.porPagarDesde+'T12:00').getTime())/86400000) : null
  const flujo = useFlujoCaja({ billing, terceros, costosOfiRows, anticipos, expenses, clients, sales, fantasmaIds })
  const pctVencido = porCobrar>0 ? cart.vencidoTot/porCobrar : null
  const estados = estadosTemas({ filas, pctVencido, comisionDias:diasCom, flujo:flujo.fin, difRetiros:ret.difAcum })

  // ── Resumen para la IA ──
  const fmtV = { clp:fmtShort, uf:n=>fmtUFk(n), n:n=>String(n), pts:n=>`${pct1(n)} %` }
  const dossier = useMemo(()=>construirDossier({ mes:etiquetaMes(ym), comparado:etiquetaMes(ymP), filas, f:fmtV, estados,
    extras:{ porCobrar:fmtShort(porCobrar), vencido:fmtShort(cart.vencidoTot), porcentajeVencido:pctVencido==null?null:`${Math.round(pctVencido*100)} %`, vencidoMasDeSesentaDias:fmtShort(cart.expo.m60), flujoCajaProximasSemanas:`${flujo.fin>0?'+':''}${fmtShort(flujo.fin)}`, semanas:8,
      comisionesPorPagar:fmtShort(sc.porPagar), diasComisionMasAntigua:diasCom, retirosAcumuladosCadaSocio:ret.SOC.map(s=>`${s} ${fmtShort(ret.retTot[s]||0)}`), diferenciaRetiros:fmtShort(Math.abs(ret.difAcum)), carteraAlCierre:resumenFoto(fM,fP,fmtShort) } }),[filas,fM,fP,ym,estados.resultado,estados.cobranza,porCobrar,cart.vencidoTot,flujo.fin,sc.porPagar,diasCom,ret.difAcum])

  // ── Informe guardado / generado ──
  const [inf,setInf] = useState(null), [cargando,setCargando] = useState(true), [busy,setBusy] = useState(false), [err,setErr] = useState(null), [copiado,setCopiado] = useState(false)
  useEffect(()=>{ let v=true; setInf(null); setErr(null); setCargando(true)
    if(DEMO){ setCargando(false); return }
    supabase.from('learnings').select('value').eq('kind','informe_mes').eq('key',ym).order('updated_at',{ascending:false}).limit(1).then(({data})=>{ if(!v) return; try{ setInf(data&&data[0]?JSON.parse(data[0].value):null) }catch(_){ setInf(null) } setCargando(false) },()=>{ if(v) setCargando(false) })
    return ()=>{ v=false } },[ym])
  const generar = async () => {
    if(DEMO){ setErr('El informe con IA no está disponible en la demo.'); return }
    setBusy(true); setErr(null)
    try{
      let ok=null, falta=null
      for(let i=0;i<2&&!ok;i++){
        const aviso = falta ? `\n\nTu respuesta anterior ${Array.isArray(falta)?`tenía números que no están en el resumen: ${falta.join(', ')}`:'no tenía el formato pedido'}. Corrígela usando solo cifras del resumen.` : ''
        const data = await claudeCall({ feature:'InformeMes', model:'claude-opus-4-8', max_tokens:2200, system:SYSTEM, messages:[{ role:'user', content:`Resumen de ${etiquetaMes(ym)} contra ${etiquetaMes(ymP)}:\n${JSON.stringify(dossier)}${aviso}` }] })
        const cand = leerInformeIA(data?.content?.[0]?.text||'')
        if(!cand){ falta='formato'; continue }
        const v = verificarTexto(textoDeInforme(cand), dossier)
        if(v.ok) ok=cand; else falta=v.faltantes
      }
      if(!ok) throw new Error(`El informe no pasó la verificación de cifras (${Array.isArray(falta)?`números que no están en el resumen: ${falta.join(', ')}`:'formato inválido'}). Intenta de nuevo; la comparación de abajo sigue vigente.`)
      ok.puntos.forEach(p=>{ p.estado=estados[p.tema]||'sin_cambio' })
      const reg = { ...ok, ym, comparado:ymP, por:user?.name||null, at:new Date().toISOString() }
      await setLearningKV('informe_mes', ym, JSON.stringify(reg)); setInf(reg)
    }catch(e){ setErr(e.message||'No se pudo generar el informe.') }
    setBusy(false) }
  const copiar = async () => { if(!inf) return; const t=[`Informe de ${etiquetaMes(ym)}`, inf.frase, ...inf.puntos.map(p=>`${TEMA_LBL[p.tema]}: ${p.titular} ${p.porque}`)].join('\n'); try{ await navigator.clipboard.writeText(t); setCopiado(true); setTimeout(()=>setCopiado(false),1800) }catch(_){} }

  // ── Presentación ──
  const valFila = f => f.m==null?'—':f.tipo==='clp'?fmtShort(f.m):f.tipo==='uf'?fmtUFk(f.m):f.tipo==='pts'?`${pct1(f.m)} %`:String(f.m)
  const valPrev = f => f.p==null?'—':f.tipo==='clp'?fmtShort(f.p):f.tipo==='uf'?fmtUFk(f.p):f.tipo==='pts'?`${pct1(f.p)} %`:String(f.p)
  const pill = f => { const [bg,fg]=PILL[f.tono]||PILL.nt; return <span style={{fontSize:11,fontWeight:800,borderRadius:20,padding:'2px 9px',minWidth:56,textAlign:'center',whiteSpace:'nowrap',background:bg,color:fg}}>{textoVariacion(f)}</span> }
  const tarjeta = (p,i) => { const [lb,bg,fg]=ESTADO[p.estado||'sin_cambio']; return (
    <div key={i} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:12,display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><span style={{fontSize:10,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,flex:1}}>{TEMA_LBL[p.tema]}</span><span style={{fontSize:10,fontWeight:800,borderRadius:20,padding:'2px 9px',background:bg,color:fg}}>{lb}</span></div>
      <div style={{fontSize:24,fontWeight:800,color:p.estado==='sin_cambio'?C.accent:fg,fontVariantNumeric:'tabular-nums',lineHeight:1.1}}>{p.cifra}<span style={{fontSize:11,fontWeight:600,color:C.muted,marginLeft:6}}>{[p.etiqueta,p.variacion].filter(Boolean).join(' · ')}</span></div>
      <div style={{fontSize:13.5,fontWeight:800,color:C.accent,lineHeight:1.3}}>{p.titular}</div>
      <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>{p.porque}</div>
      <div onClick={()=>go(p.enlace)} style={{fontSize:11.5,fontWeight:700,color:C.azulInfo,cursor:'pointer',marginTop:'auto',paddingTop:2}}>{ENLACE_LBL[p.enlace]||'Ver detalle'} ›</div>
    </div>) }
  const grupos = [...new Set(INDICADORES.map(x=>x[0]))]
  const fila = f => (
    <div key={f.k} onClick={()=>go(DEST_FILA[f.grupo])} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
      <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{f.etiqueta}</div>{!isDesktop&&<div style={{fontSize:10.5,color:C.muted}}>{etiquetaMes(ymP).split(' ')[0]} {valPrev(f)}</div>}</div>
      {isDesktop&&<span style={{fontSize:13,color:C.muted,fontVariantNumeric:'tabular-nums',minWidth:80,textAlign:'right'}}>{valPrev(f)}</span>}
      <span style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',minWidth:80,textAlign:'right',whiteSpace:'nowrap'}}>{valFila(f)}</span>
      {pill(f)}
    </div>)
  const [lblM,lblP] = [cap(MESES[Number(ym.slice(5,7))-1]).slice(0,3), cap(MESES[Number(ymP.slice(5,7))-1]).slice(0,3)]
  const caja = (titulo,link,onLink,children,extra) => (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`}}><span style={{fontSize:12,fontWeight:800,color:C.accent,flex:1}}>{titulo}</span>{extra}{link&&<span onClick={onLink} style={{fontSize:11,fontWeight:700,color:C.azulInfo,cursor:'pointer',whiteSpace:'nowrap'}}>{link} ›</span>}</div>{children}
    </div>)
  const btn = (txt,on,primary,dis) => <button onClick={on} disabled={dis} style={{fontSize:11,fontWeight:700,borderRadius:8,padding:'6px 12px',cursor:dis?'default':'pointer',border:`1px solid ${primary?C.accent:C.border}`,background:primary?C.accent:C.surface,color:primary?'#fff':C.muted,opacity:dis?.6:1,whiteSpace:'nowrap'}}>{txt}</button>
  const selMes = (
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',margin:'6px 0'}}>
      <span style={{display:'inline-flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
        <span onClick={()=>ym>`${anio-1}-12`&&ym>'2026-01'&&setYm(_ymPrev(ym))} style={{padding:'4px 10px',fontSize:12,fontWeight:700,color:C.muted,background:C.surface,cursor:'pointer'}}>‹</span>
        <span style={{padding:'4px 12px',fontSize:11,fontWeight:700,color:'#fff',background:C.accent}}>{cap(etiquetaMes(ym))}</span>
        <span onClick={()=>{ const n=(()=>{ const [Y,M]=ym.split('-').map(Number); const x=new Date(Y,M,1); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}` })(); if(n<=ultimoCerrado) setYm(n) }} style={{padding:'4px 10px',fontSize:12,fontWeight:700,color:ym>=ultimoCerrado?C.textSoft:C.muted,background:C.surface,cursor:ym>=ultimoCerrado?'default':'pointer'}}>›</span>
      </span>
      <span style={{fontSize:11,color:C.muted}}>contra {etiquetaMes(ymP)}</span>
    </div>)
  return (
    <div style={{maxWidth:1120,margin:'0 auto',padding:isDesktop?'0 20px 40px':'0 14px 40px'}}>
      <PageHeader origen={backLabel} onBack={onBack} titulo={`Cierre de ${etiquetaMes(ym)}`}/>
      {selMes}
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {caja('Qué pasó en el mes', null, null,
          <div style={{padding:12,display:'flex',flexDirection:'column',gap:8}}>
            {cargando ? <div style={{fontSize:12,color:C.muted}}>Cargando…</div>
            : inf ? (<>
              <div style={{background:C.bgSoft,borderRadius:10,padding:'10px 12px'}}><div style={{fontSize:10,fontWeight:800,letterSpacing:.5,textTransform:'uppercase',color:C.muted,marginBottom:3}}>{cap(MESES[Number(ym.slice(5,7))-1])} en una frase</div><div style={{fontSize:14.5,fontWeight:700,color:C.accent,lineHeight:1.4}}>{inf.frase}</div></div>
              <div style={{display:'grid',gridTemplateColumns:isDesktop?'1fr 1fr':'1fr',gap:8}}>{inf.puntos.map(tarjeta)}</div>
              <div style={{fontSize:10.5,color:C.muted}}>Redactado con IA el {fmtFechaDMY(String(inf.at||'').slice(0,10))} a partir de las cifras de la app; cada número se verificó contra ellas.</div>
            </>) : <div style={{fontSize:12.5,color:C.muted}}>Aún no hay informe de {etiquetaMes(ym)}. Se genera a pedido a partir de las cifras de abajo.</div>}
            {err&&<div style={{fontSize:12,color:C.overdueText}}>{err}</div>}
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{btn(busy?'Generando…':inf?'Regenerar':'Generar informe',generar,!inf,busy)}{inf&&btn(copiado?'Copiado':'Copiar',copiar,false,false)}</div>
          </div>)}
        {caja(`${cap(etiquetaMes(ym).split(' ')[0])} contra ${etiquetaMes(ymP).split(' ')[0]}`, 'Estado de resultados', ()=>go('estadoResultados'),
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',background:C.bgSoft,fontSize:10,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:.4}}><span style={{flex:1}}>Indicador</span>{isDesktop&&<span style={{minWidth:80,textAlign:'right'}}>{lblP}</span>}<span style={{minWidth:80,textAlign:'right'}}>{lblM}</span><span style={{minWidth:56,textAlign:'center'}}>Var.</span></div>
            {grupos.map(g=>(<div key={g}><div style={{padding:'6px 12px',background:C.bgSoft,fontSize:10,fontWeight:800,color:C.accent,textTransform:'uppercase',letterSpacing:.4,borderTop:`1px solid ${C.border}`}}>{g}</div>{filas.filter(f=>f.grupo===g).map(fila)}</div>))}
            {!mismoAnio&&<div style={{padding:'8px 12px',fontSize:10.5,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>El cobrado y los retiros del mes anterior pertenecen a otro año y no se comparan aquí.</div>}
          </div>)}
        {caja(`Cartera al cierre de ${etiquetaMes(ym)}`, 'Cobranza', ()=>go('cobranza'),
          fM ? <div>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 12px',background:C.bgSoft,fontSize:10,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:.4}}><span style={{flex:1}}>Indicador</span>{isDesktop&&<span style={{minWidth:80,textAlign:'right'}}>{lblP}</span>}<span style={{minWidth:80,textAlign:'right'}}>{lblM}</span><span style={{minWidth:56,textAlign:'center'}}>Var.</span></div>
            {filasCierre.map(f=>(
              <div key={f.k} onClick={()=>go(DEST_CIERRE[f.k])} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{f.etiqueta}</div>{!isDesktop&&fP&&<div style={{fontSize:10.5,color:C.muted}}>{lblP} {valPrev(f)}</div>}</div>
                {isDesktop&&<span style={{fontSize:13,color:C.muted,fontVariantNumeric:'tabular-nums',minWidth:80,textAlign:'right'}}>{valPrev(f)}</span>}
                <span style={{fontSize:13,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums',minWidth:80,textAlign:'right',whiteSpace:'nowrap'}}>{valFila(f)}</span>
                {pill(f)}
              </div>))}
            <div style={{padding:'8px 12px',fontSize:10.5,color:C.muted,borderTop:`1px solid ${C.bgSoft}`}}>Foto del {fmtFechaDMY(fM.capturada)}{fP?`; anterior, del ${fmtFechaDMY(fP.capturada)}`:''}.</div>
          </div> : <div style={{padding:'10px 12px',fontSize:12,color:C.muted}}>Sin foto de cartera de {etiquetaMes(ym)}.</div>)}
        {caja('Hoy', 'Cobranza', ()=>go('cobranza'),
          <div>
            {[['Por cobrar',fmtShort(porCobrar),pctVencido!=null?`${Math.round(pctVencido*100)} % vencido`:'', 'cobranza'],['Vencido',fmtShort(cart.vencidoTot),`${fmtShort(cart.expo.m60)} con más de 60 días`,'cobranza'],['Comisiones por pagar',fmtShort(sc.porPagar),diasCom!=null?`la más antigua, hace ${diasCom} días`:'','proveedores'],['Flujo de caja · 8 semanas',(flujo.fin>0?'+':'')+fmtShort(flujo.fin),'','flujoCaja']].map(([l,v,s,dest])=>(
              <div key={l} onClick={()=>go(dest)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderTop:`1px solid ${C.bgSoft}`,cursor:'pointer'}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{l}</div>{s&&<div style={{fontSize:10.5,color:C.muted}}>{s}</div>}</div>
                <span style={{fontSize:14,fontWeight:800,color:C.accent,fontVariantNumeric:'tabular-nums'}}>{v}</span>
              </div>))}
          </div>)}
      </div>
    </div>)
}
