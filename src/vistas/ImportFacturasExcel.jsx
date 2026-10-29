// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState } from 'react'
import { supabase } from '../supabase'
import { normRut as crNormRut } from '../cartola.js'
import { C, SEC_LBL, Spin, appAlert, fmt, fmtRutCL, folioN } from '../lib/base.jsx'
import { aprenderRS, claudeCall, dueFromIssued, normRut, ultimoDiaHabilMesEmision } from '../lib/compartido.jsx'

// ─── IMPORTAR FACTURAS DESDE EXCEL (antiguas, con fecha de pago) — con preview y pre-confirmación ──
export function ImportFacturasExcel({clients=[],clientEntities=[],billing=[],onImported,onClose}) {
  const [rows,setRows] = useState(null)
  const [fileName,setFileName] = useState('')
  const [cargando,setCargando] = useState(false)
  const [importando,setImportando] = useState(false)
  const [resultado,setResultado] = useState(null)
  const [editRow,setEditRow] = useState(null)   // id de fila en modo "asignar cliente"
  const [q,setQ] = useState('')
  const [iaBusy,setIaBusy] = useState(false)
  const [iaReport,setIaReport] = useState(null)   // auditoría de Opus 4.8 antes de importar
  const norm = s => String(s??'').toLowerCase().trim()
  const normRut = crNormRut   // normalizador único de RUT
  const inp = {width:'100%',height:36,border:`0.5px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 11px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const fmt0 = n => fmt(Number(n)||0)   // formateador CLP único (global fmt): redondeo y signo -$ correctos
  const fmtD = iso => { if(!iso) return '—'; const p=String(iso).slice(0,10).split('-'); return p.length===3?`${p[2]}-${p[1]}-${p[0]}`:String(iso) }
  const dueFromIssued = iso => ultimoDiaHabilMesEmision(iso)   // último día hábil del mes de emisión (regla del estudio)
  // Pagada sin fecha de pago: se asume pagada a los 20 días de emitida (criterio del estudio).
  const pagoInferido = iso => { if(!iso) return null; const d=new Date(iso+'T12:00'); d.setDate(d.getDate()+20); return d.toISOString().slice(0,10) }
  const parseMonto = v => { if(v==null||v==='') return null; if(typeof v==='number') return Math.round(v); let s=String(v).replace(/[^\d,.-]/g,''); if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.'); else if(s.includes(',')) s=s.replace(',','.'); const n=parseFloat(s); return isNaN(n)?null:Math.round(n) }
  const parseFecha = v => { if(!v) return null; if(v instanceof Date && !isNaN(v)) { const d=new Date(v.getTime()-v.getTimezoneOffset()*60000); return d.toISOString().slice(0,10) } const s=String(v).trim(); let m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/); if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`; m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if(m){ let[,d,mo,y]=m; if(y.length===2) y='20'+y; return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}` } return null }
  const COL = {
    cliente:['cliente','nombre','razon social','razón social','receptor','señor','señores','razon','cliente/receptor','nombre cliente','razon social a facturar'],
    rut:['rut','r.u.t','rut receptor','rut cliente'],
    factura:['n° factura','factura','folio','nro','numero','número','n factura','n°','nº','documento','doc','numero factura','n de factura','nro factura'],
    monto:['monto','total','valor','neto','importe','monto total','bruto','monto bruto','monto neto','honorarios','monto honorarios'],
    emision:['emision','emisión','fecha emision','fecha emisión','fecha','fecha factura','fecha doc','fecha de emision','fecha de emisión'],
    pago:['fecha pago','pago','pagado','fecha de pago','fecha pagada','fecha cobro','cobrado','fecha de cobro'],
    estado:['estado','status','estado factura','estado pago'],
    concepto:['concepto','glosa','detalle','descripcion','descripción','observacion','observación','servicio'],
  }
  const mapEstado = raw => { const k=norm(raw); if(!k) return null; if(/(pagad|cobrad)/.test(k)) return 'Pagado'; if(/(anulad)/.test(k)) return 'Anulada'; if(/(vencid)/.test(k)) return 'Vencido'; if(/(pendiente|por cobrar|emitid)/.test(k)) return 'Pendiente'; return null }
  const descargarPlantilla = async()=>{
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const header=['Cliente','RUT','N° factura','Monto','Fecha emisión','Fecha pago','Estado','Concepto']
      const ej=[['Ejemplo S.A.','76.123.456-7','1234','1500000','01-03-2026','15-03-2026','Pagada','Asesoría tributaria'],
                ['Otro Cliente SpA','77.987.654-3','1235','800000','05-03-2026','','Pendiente','Honorarios']]
      const ws=XLSX.utils.aoa_to_sheet([header,...ej]); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Facturas')
      XLSX.writeFile(wb,'Plantilla_facturas.xlsx')
    }catch(e){ appAlert('No se pudo generar la plantilla: '+e.message) }
  }
  const matchClient = (nombre,rut) => {
    const rn=normRut(rut)
    if(rn){ const c=clients.find(x=>normRut(x.rut)===rn); if(c) return {client:c,ent:null}
      const ce=(clientEntities||[]).find(e=>normRut(e.rut)===rn); if(ce){ const c2=clients.find(x=>String(x.id)===String(ce.client_id)); if(c2) return {client:c2,ent:ce} } }
    const nn=norm(nombre)
    if(nn){ const c=clients.find(x=>norm(x.name)===nn); if(c) return {client:c,ent:null}
      const ce=(clientEntities||[]).find(e=>norm(e.name)===nn); if(ce){ const c2=clients.find(x=>String(x.id)===String(ce.client_id)); if(c2) return {client:c2,ent:ce} }
      if(nn.length>3){ const c2=clients.find(x=>norm(x.name).includes(nn)||nn.includes(norm(x.name))); if(c2) return {client:c2,ent:null,fuzzy:true} } }
    return {client:null,ent:null}
  }
  const onFile = async(e) => {
    const file=e.target.files?.[0]; if(!file) return
    setFileName(file.name); setCargando(true)
    try{
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const wb = XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true})
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const objs = XLSX.utils.sheet_to_json(sheet,{defval:''})
      const getField = (o,field) => { for(const k of Object.keys(o)){ if(COL[field].includes(norm(k))) return o[k] } return '' }
      const build = (g,idx) => {
        const rut=String(g('rut')||'').trim(), nombre=String(g('cliente')||'').trim()
        const factura=String(g('factura')||'').trim().replace(/\.0$/,'')
        const concepto=String(g('concepto')||'').trim()||'Honorarios'
        const emision=parseFecha(g('emision')), pago=parseFecha(g('pago')), monto=parseMonto(g('monto'))
        if(!rut&&!nombre&&!factura&&monto==null) return null
        const m=matchClient(nombre,rut)
        const estadoCol=mapEstado(g('estado'))
        const status = estadoCol || (pago?'Pagado':'Pendiente')
        let error=null
        if(monto==null) error='Monto inválido'; else if(monto<=0) error='Monto debe ser > 0'
        // dedupe por folio NORMALIZADO (soporta "340" == "Factura 340" == "340.0"); evita la doble carga que duplicó facturas.
        const _nf = v => folioN(String(v||'').replace(/\.0$/,'')).toLowerCase()
        const dup = factura && _nf(factura)!=='' && (billing||[]).some(b=>_nf(b.invoice_no)===_nf(factura))
        // Pagada sin fecha → se infiere emisión + 20 días (criterio del estudio); se marca como estimada.
        const pagoFinal = pago || (status==='Pagado'&&emision?pagoInferido(emision):null)
        const pagoEstimado = !pago && !!pagoFinal
        return {id:idx, rut, nombre, factura, concepto, emision, pago:pagoFinal, pagoEstimado, monto, status,
          client_id:m.client?.id||null, clientName:m.client?.name||null, entity_id:m.ent?.id||null,
          receptor_name:(m.ent?.name)||nombre||null, receptor_rut:(m.ent?.rut)||rut||null, fuzzy:!!m.fuzzy, error, dup}
      }
      let parsed=[]
      objs.forEach(o=>{ const r=build(f=>getField(o,f), parsed.length); if(r) parsed.push(r) })
      // Dedup dentro del MISMO archivo: la 2ª aparición de un N° de factura se marca como duplicada.
      const vistos=new Set()
      parsed.forEach(r=>{ if(r.factura){ if(vistos.has(r.factura)) r.dup=true; else vistos.add(r.factura) } })
      if(parsed.length===0){ appAlert('No se encontraron filas. El Excel debe tener al menos columnas de Cliente (o RUT), Monto y Fecha. Tip: agrega una columna "Fecha pago" para que entren como pagadas.'); setRows(null); setCargando(false); return }
      setRows(parsed)
    }catch(err){ appAlert('Error al leer el Excel: '+err.message) }
    setCargando(false)
  }
  const asignar = async (rowId, clientId) => {
    const c=clients.find(x=>String(x.id)===String(clientId))
    const ents=(clientEntities||[]).filter(e=>String(e.client_id)===String(clientId))
    const row=(rows||[]).find(r=>r.id===rowId)
    const rut=row?.rut?String(row.rut).trim():''
    // Aprende: guarda el RUT como razón social del cliente para que próximas importaciones lo reconozcan solas (no repetir el trabajo).
    if(rut){
      await aprenderRS(clientId, rut, row?.nombre||c?.name, clientEntities)   // fuente única (dedup por RUT)
    }
    // Aplica el cliente a TODAS las filas con el mismo RUT que aún no lo tienen (no asignar a mano una por una).
    setRows(p=>p.map(r=>(r.id===rowId || (rut && String(r.rut).trim()===rut && !r.client_id))
      ? {...r,client_id:clientId,clientName:c?.name||null,entity_id:ents.length===1?ents[0].id:r.entity_id,fuzzy:false}
      : r))
    setEditRow(null); setQ('')
  }
  const toggleEx = id => setRows(p=>p.map(r=>r.id===id?{...r,_skip:!r._skip}:r))
  const importar = async() => {
    const aImportar = (rows||[]).filter(r=>!r.error&&!r.dup&&!r._skip)
    if(aImportar.length===0){ appAlert('No hay filas válidas para importar.'); return }
    setImportando(true)
    // Fila por fila: si un N° de factura ya existe (incl. borradas, que igual ocupan el número único), se omite esa sola y sigue.
    let ok=0, dups=0, errs=0, lastErr=''
    for(const r of aImportar){
      const _yImp = r.emision ? new Date(r.emision).getFullYear() : (r.pago ? new Date(r.pago).getFullYear() : null)
      const payload={client_id:r.client_id||null, entity_id:r.entity_id||null, concept:r.concepto, amount:r.monto, status:r.status,
        invoice_no:r.factura||null, issued_at:r.emision||null, due:r.emision?dueFromIssued(r.emision):null, paid_at:r.pago||null,
        sale_year:(_yImp>1990&&_yImp<2100)?_yImp:null,
        receptor_name:r.receptor_name||null, receptor_rut:r.receptor_rut||null, billing_type:'honorarios', updated_at:new Date().toISOString()}
      const {error}=await supabase.from('billing').insert(payload)
      if(error){ if(/duplicate|unique/i.test(error.message)) dups++; else { errs++; lastErr=error.message } } else ok++
    }
    setResultado({n:ok, dups, errs, lastErr})
    onImported&&await onImported()
    setImportando(false)
  }
  // Auditoría con IA (Opus 4.8) ANTES de importar: solo lee y opina, no modifica nada.
  const revisarIA = async() => {
    if(!rows?.length) return
    setIaBusy(true); setIaReport(null)
    try{
      const muestra = rows.map((r,i)=>`${i+1}|${(r.nombre||'').slice(0,40)}|${r.rut||''}|${r.monto??''}|${r.emision||''}|${r.pago||''}|${r.status||''}|${(r.concepto||'').slice(0,45)}|${r.client_id?'match':'SIN'}`).join('\n')
      const prompt = `Eres auditor de datos de facturación de un estudio de abogados chileno. Revisa este lote de facturas ANTES de importarlo y advierte problemas. Cada fila es: idx|cliente|rut|monto(CLP)|fechaEmision(AAAA-MM-DD)|fechaPago|estado|concepto|match (match=el cliente YA existe en la base; SIN=no existe y quedaría huérfana).

Devuelve SOLO un JSON válido (sin markdown ni backticks):
{"resumen":"2-3 frases con totales y estado general","alertas":[{"tipo":"corto","detalle":"qué pasa y por qué","n":cantidad_de_filas}],"clientes_a_crear":["NOMBRE (RUT)"],"recomendacion":"go o no-go y por qué, 1-2 frases"}

Enfócate en: filas SIN cliente (cuántas y agrupar por cliente nuevo), montos negativos o notas de crédito, facturas anuladas, fechas fuera de un rango razonable, RUT mal formateados (espacios), conceptos truncados o ambiguos, y cualquier inconsistencia. En "clientes_a_crear" lista (máx 60) los clientes con estado SIN, sin repetir, formato "NOMBRE (RUT)". NO inventes datos; básate solo en las filas. Sé conciso y útil.

FILAS (${rows.length}):
${muestra}`
      const j = await claudeCall({model:'claude-opus-4-8',max_tokens:2500,messages:[{role:'user',content:prompt}]})
      let txt = (j?.content?.[0]?.text||'').replace(/```json|```/g,'').trim()
      const rep = JSON.parse(txt)
      setIaReport(rep)
    }catch(e){ appAlert('No se pudo analizar con IA: '+e.message) }
    setIaBusy(false)
  }

  // ── render ──
  if(resultado) return (
    <div style={{padding:'20px',textAlign:'center'}}>
      <div style={{fontSize:15,fontWeight:600,color:C.normal,marginBottom:8}}>Importadas {resultado.n} factura{resultado.n!==1?'s':''}</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:18}}>Ya están en Facturación. Asigna las que quedaron sin cliente.{resultado.dups>0&&` ${resultado.dups} omitida${resultado.dups!==1?'s':''} por N° de factura repetido.`}{resultado.errs>0&&` ${resultado.errs} con error.`}</div>
      <button onClick={onClose} style={{padding:'10px 18px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Cerrar</button>
    </div>
  )
  if(!rows) return (
    <div style={{padding:'8px 2px'}}>
      <div style={{fontSize:12,color:C.muted,lineHeight:1.5,marginBottom:14}}>Sube un Excel con tus facturas antiguas. Detecta columnas por nombre: <strong>Cliente</strong> o <strong>RUT</strong>, <strong>N° factura</strong>, <strong>Monto</strong>, <strong>Fecha</strong> (emisión) y <strong>Fecha pago</strong>. Las que traigan fecha de pago entran como <strong>Pagadas</strong>; el resto como Pendientes. Verás un preview antes de guardar.</div>
      <label style={{display:'block',border:`1.5px dashed ${C.accent}`,borderRadius:12,padding:'22px 14px',textAlign:'center',cursor:'pointer',background:C.bgSoft}}>
        <input type='file' accept='.xlsx,.xls' onChange={onFile} style={{display:'none'}}/>
        <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{cargando?'Leyendo…':'Elegir archivo Excel'}</div>
        {fileName&&<div style={{fontSize:11,color:C.muted,marginTop:4}}>{fileName}</div>}
      </label>
      <div style={{textAlign:'center',marginTop:10}}>
        <button onClick={descargarPlantilla} style={{fontSize:12,fontWeight:600,color:C.muted,background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>Descargar plantilla de ejemplo</button>
      </div>
    </div>
  )
  const validas = rows.filter(r=>!r.error&&!r.dup&&!r._skip)
  const totalImp = validas.reduce((a,r)=>a+(r.monto||0),0)
  const sinCli = validas.filter(r=>!r.client_id).length
  const stPill = r => r.error?['Error',C.overdue,'#FCEBEB']:r.dup?['Ya existe','#C77F18',C.soonBg]:r._skip?['Omitida',C.muted,C.bgSoft]:r.status==='Pagado'?['Pagada',C.normal,'#E1F5EE']:['Pendiente',C.accent,'#E6EEF1']
  const matches = q.trim()?clients.filter(c=>norm(c.name).includes(norm(q))||normRut(c.rut).includes(normRut(q))||norm(c.razon_social).includes(norm(q))).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'es')).slice(0,8):[]
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,gap:8}}>
        <div style={{fontSize:12,color:C.muted}}><strong style={{color:C.text}}>{validas.length}</strong> a importar · {fmt0(totalImp)}{sinCli>0&&<span style={{color:C.soon}}> · {sinCli} sin cliente</span>}</div>
        <button onClick={()=>{setRows(null);setFileName('');setIaReport(null)}} style={{fontSize:11,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer'}}>Otro archivo</button>
      </div>
      {/* Revisión con IA (Opus 4.8) — solo audita, no modifica */}
      <button onClick={revisarIA} disabled={iaBusy} style={{width:'100%',marginBottom:10,height:44,borderRadius:10,border:`1px solid ${C.accent}`,background:iaBusy?C.bgSoft:C.azulBg,color:C.accent,fontSize:12,fontWeight:600,cursor:iaBusy?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>{iaBusy?<Spin/>:null}{iaBusy?'Analizando con Opus 4.8…':(iaReport?'Volver a revisar con IA':'Revisar con IA (Opus 4.8)')}</button>
      {iaReport&&(
        <div style={{border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 13px',marginBottom:12,background:C.bgSoft}}>
          <div style={{...SEC_LBL,marginBottom:6}}>Revisión IA · Opus 4.8</div>
          {iaReport.resumen&&<div style={{fontSize:12,color:C.text,lineHeight:1.45,marginBottom:9}}>{iaReport.resumen}</div>}
          {Array.isArray(iaReport.alertas)&&iaReport.alertas.length>0&&<div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:9}}>
            {iaReport.alertas.map((a,i)=>(
              <div key={i} style={{display:'flex',gap:7,fontSize:12,color:C.text,alignItems:'baseline'}}>
                <span style={{color:C.soon,fontWeight:700,flexShrink:0}}>!</span>
                <span><strong style={{fontWeight:600}}>{a.tipo}{a.n?` (${a.n})`:''}:</strong> {a.detalle}</span>
              </div>
            ))}
          </div>}
          {Array.isArray(iaReport.clientes_a_crear)&&iaReport.clientes_a_crear.length>0&&(
            <details style={{marginBottom:9}}>
              <summary style={{fontSize:12,fontWeight:600,color:C.accent,cursor:'pointer'}}>Clientes a crear ({iaReport.clientes_a_crear.length})</summary>
              <div style={{fontSize:11,color:C.muted,marginTop:5,lineHeight:1.6,maxHeight:160,overflowY:'auto'}}>{iaReport.clientes_a_crear.map((c,i)=><div key={i}>{c}</div>)}</div>
            </details>
          )}
          {iaReport.recomendacion&&<div style={{fontSize:12,fontWeight:600,color:C.accent,borderTop:`1px solid ${C.border}`,paddingTop:8}}>{iaReport.recomendacion}</div>}
          <div style={{fontSize:10,color:C.textSoft,marginTop:8}}>La IA solo revisa; no cambia tus datos. Tú decides qué importar.</div>
        </div>
      )}
      <div style={{maxHeight:'52vh',overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
        {rows.map(r=>{ const [sl,sc,sb]=stPill(r); return (
          <div key={r.id} style={{border:`0.5px solid ${C.border}`,borderRadius:10,padding:'9px 11px',opacity:(r._skip||r.error||r.dup)?.6:1}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.clientName||r.nombre||'(sin cliente)'}{r.fuzzy&&<span style={{color:C.soon,fontWeight:500}}> ·aprox</span>}</div>
                <div style={{fontSize:11,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.factura?`Factura N° ${r.factura} · `:''}{r.concepto} · {fmtD(r.emision)}{r.pago?` · pagada ${fmtD(r.pago)}${r.pagoEstimado?' (estimada)':''}`:''}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{fmt0(r.monto)}</div>
                <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:sb,color:sc,whiteSpace:'nowrap'}}>{sl}</span>
              </div>
            </div>
            {r.error&&<div style={{fontSize:11,color:C.overdue,marginTop:4}}>{r.error}</div>}
            {!r.error&&!r.dup&&(
              <div style={{display:'flex',gap:8,marginTop:6,alignItems:'center'}}>
                {!r.client_id&&editRow!==r.id&&<button onClick={()=>{setEditRow(r.id);setQ('')}} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'4px 10px',cursor:'pointer'}}>+ Asignar cliente</button>}
                {r.client_id&&editRow!==r.id&&<button onClick={()=>{setEditRow(r.id);setQ('')}} style={{fontSize:11,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer'}}>Cambiar</button>}
                <button onClick={()=>toggleEx(r.id)} style={{fontSize:11,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'4px 9px',cursor:'pointer',marginLeft:'auto'}}>{r._skip?'Incluir':'Omitir'}</button>
              </div>
            )}
            {editRow===r.id&&(
              <div style={{marginTop:6}}>
                <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder='Buscar cliente…' style={inp}/>
                {matches.length>0&&<div style={{border:`0.5px solid ${C.border}`,borderRadius:8,marginTop:4,overflow:'hidden'}}>
                  {matches.map(c=>(<div key={c.id} onClick={()=>asignar(r.id,c.id)} style={{padding:'8px 11px',cursor:'pointer',borderBottom:`0.5px solid ${C.border}`}}><div style={{fontSize:13,fontWeight:500,color:C.text}}>{c.name}</div>{c.rut&&<div style={{fontSize:10,color:C.muted}}>{fmtRutCL(c.rut)}</div>}</div>))}
                </div>}
              </div>
            )}
          </div>
        )})}
      </div>
      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button onClick={onClose} style={{flex:1,height:44,borderRadius:10,border:`0.5px solid ${C.border}`,background:'#fff',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={importando||validas.length===0} onClick={importar} style={{flex:2,height:44,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:(importando||validas.length===0)?'default':'pointer',opacity:(importando||validas.length===0)?.6:1}}>{importando?'Importando…':`Importar ${validas.length}`}</button>
      </div>
    </div>
  )
}

