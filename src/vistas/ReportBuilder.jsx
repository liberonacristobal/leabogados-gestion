// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState } from 'react'
import { BRAND, C, Gl, SEC_LBL, fmt, fmtN, useIsDesktop } from '../lib/base.jsx'
import { costoVentaUF, esRecurrente, esSubarriendo, ventaUF } from '../lib/cifras.js'
import { BitacoraLista, Lbl, META_UF, UF_FALLBACK, comisionesVenta, currentMonth, currentYear, daysLeft, fmtUF, isAssignee, logActividad, montoFactura, saldoBill, urgency, useUF } from '../lib/compartido.jsx'

// ─── REPORT BUILDER ──────────────────────────────────────────────────────────
export function ReportBuilder({sales,billing,clients,expenses,tasks,terceros=[],onClose}) {
  const {uf:ufHoy} = useUF()
  // Misma fuente de verdad que el Dashboard: ventaUF anualiza recurrentes y convierte CLP→UF.
  const ufRef = ufHoy || sales.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  const esRec = s => esRecurrente(s)
  // Comisiones en UF de la venta — fuente única comisionesVenta (registradas; si no hay, el costo pactado).
  const costoVentaUF = s => { const u=parseFloat(s.uf_value)||ufRef; return u>0 ? comisionesVenta(s,terceros,billing,ufRef).anual/u : 0 }
  const [sections,setSections] = useState({ventas:true,cobranza:true,gastos:true,tareas:false})
  const [period,setPeriod] = useState('month')
  const [selYear,setSelYear] = useState(String(currentYear))
  const [selMonth,setSelMonth] = useState(String(currentMonth))
  const MONTHS=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  // Años normalizados a string (sales.year es número y billing da string → evita el año duplicado en el dropdown)
  const years=[...new Set([...sales.map(s=>s.year?String(s.year):null),...billing.map(b=>b.issued_at?.slice(0,4))].filter(Boolean))].sort((a,b)=>Number(b)-Number(a))
  if(!years.includes(String(currentYear))) years.unshift(String(currentYear))
  const toggle=k=>setSections(p=>({...p,[k]:!p[k]}))
  const getPeriodLabel=()=>period==='year'?`Año ${selYear}`:`${MONTHS[parseInt(selMonth)-1]} ${selYear}`

  const filterByPeriod=(items,dateField)=>items.filter(item=>{
    const d=item[dateField]; if(!d) return false
    if(period==='year') return d.startsWith(selYear)
    return d.startsWith(`${selYear}-${String(selMonth).padStart(2,'0')}`)
  })

  // buildHtml = FUENTE ÚNICA del reporte: la misma página alimenta la vista previa (iframe) y la impresión.
  const buildHtml=()=>{
    const label=getPeriodLabel()
    const now=new Date().toLocaleDateString('es-CL',{day:'2-digit',month:'long',year:'numeric'})
    const A='#003C50', A2='#537281', A3='#99ABB4', A4='#E4E8EB', G='#3D3D3D'
    const fmtN=fmt
    const fmtUFN=fmtUF

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Reporte LE — ${label}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'DM Sans',sans-serif;color:${G};background:#fff;font-size:11px}
  @page{size:letter portrait;margin:18mm 18mm 18mm 18mm}
  @media print{
    .no-print{display:none}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page-break{page-break-before:always}
  }
  .header{background:${A};color:#fff;padding:24px 28px;margin-bottom:24px;border-radius:0}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start}
  .firma-name{font-size:20px;font-weight:700;letter-spacing:-.5px;margin-bottom:2px}
  .firma-sub{font-size:10px;opacity:.75;letter-spacing:.5px;text-transform:uppercase}
  .firma-logo{height:34px;width:auto;display:block;margin-bottom:4px}
  .report-title{text-align:right}
  .report-title h1{font-size:16px;font-weight:600;margin-bottom:4px}
  .report-title p{font-size:10px;opacity:.8}
  .firma-sub-url{font-size:10px;opacity:.7;text-transform:lowercase;margin-top:2px}
  .section{margin-bottom:28px}
  .section-title{font-size:13px;font-weight:700;color:${A};text-transform:uppercase;letter-spacing:.8px;border-bottom:2px solid ${A};padding-bottom:6px;margin-bottom:14px}
  .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
  .kpi{background:${A4};border-radius:6px;padding:12px 14px}
  .kpi-label{font-size:9px;color:${A2};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;font-weight:600}
  .kpi-value{font-size:16px;font-weight:700;color:${A}}
  .kpi-sub{font-size:9px;color:${A2};margin-top:2px}
  .progress-bar{height:8px;background:#F5F7F9;border-radius:4px;overflow:hidden;margin:6px 0 2px}
  .progress-fill{height:100%;background:${A};border-radius:4px}
  table{width:100%;border-collapse:collapse;font-size:10px}
  thead tr{background:${A};color:#fff}
  thead th{padding:7px 10px;text-align:left;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.4px}
  tbody tr:nth-child(even){background:${A4}}
  tbody tr:nth-child(odd){background:#fff}
  tbody td{padding:6px 10px;color:${G};border-bottom:1px solid ${A4}}
  tfoot tr{background:${A4};font-weight:700}
  tfoot td{padding:7px 10px;border-top:2px solid ${A3}}
  .badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:9px;font-weight:700}
  .badge-pending{background:#E6EEF1;color:${A}}
  .badge-overdue{background:#FCEBEB;color:#E24B4A}
  .badge-paid{background:#E1F5EE;color:#1D9E75}
  .badge-area{background:${A4};color:${A2}}
  .who-section{margin-bottom:16px}
  .who-title{font-size:11px;font-weight:700;color:${A2};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;padding:4px 0;border-bottom:1px solid ${A4}}
  .footer{margin-top:32px;padding-top:12px;border-top:1px solid ${A4};display:flex;justify-content:space-between;font-size:9px;color:${A3}}
  .print-btn{position:fixed;bottom:24px;right:24px;background:${A};color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;box-shadow:0 4px 16px rgba(0,60,80,.3)}
</style></head><body>`

    // Header
    html+=`<div class="header">
      <div class="header-top">
        <div>
          <img src="data:image/png;base64,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" alt="${BRAND.nombre}" class="firma-logo"/>
        </div>
        <div class="report-title">
          <h1>Reporte de Gestión</h1>
          <p>${label} · Generado ${now}</p>
          <p class="firma-sub-url">${BRAND.web}</p>
        </div>
      </div>
    </div>`

    // ── VENTAS
    if(sections.ventas){
      const ss=filterByPeriod(sales.filter(s=>s.status!=='Borrador'&&s.status!=='Propuesta'&&s.status!=='Rechazada'&&!esSubarriendo(s)).map(s=>({...s,date:`${s.year}-${String(s.month||1).padStart(2,'0')}-01`})),'date')
      const brutoUF=ss.reduce((a,s)=>a+ventaUF(s,ufRef),0)
      const costoUF=ss.reduce((a,s)=>a+costoVentaUF(s),0)
      const netoUF=brutoUF-costoUF
      // En modo mes la barra compara contra la meta MENSUAL (META_UF/12), no la anual (si no, un mes siempre marca ~8%).
      const metaRef = period==='year' ? META_UF : META_UF/12
      const metaTxt = period==='year' ? `meta anual UF ${META_UF.toLocaleString('es-CL')}` : `meta mensual UF ${Math.round(META_UF/12).toLocaleString('es-CL')}`
      const pct=metaRef>0?Math.min(100,Math.round((netoUF/metaRef)*100)):0
      html+=`<div class="section">
        <div class="section-title">Ventas</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Bruto</div><div class="kpi-value">${fmtUFN(brutoUF)}</div></div>
          <div class="kpi"><div class="kpi-label">Costo terceros</div><div class="kpi-value" style="color:#E24B4A">${costoUF>0?fmtUFN(costoUF):'—'}</div></div>
          <div class="kpi"><div class="kpi-label">Neto</div><div class="kpi-value" style="color:#1D9E75">${fmtUFN(netoUF)}</div></div>
        </div>
        <div style="margin-bottom:16px;padding:10px 14px;background:${A4};border-radius:6px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:10px;font-weight:600;color:${A}">Avance ${metaTxt}</span>
            <span style="font-size:13px;font-weight:700;color:${A}">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>`
      if(ss.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Área</th><th>Estado</th><th style="text-align:right">UF Bruto</th><th style="text-align:right">UF Costo</th><th style="text-align:right">UF Neto</th></tr></thead><tbody>`
        ss.forEach(s=>{
          const c=clients.find(x=>x.id===s.client_id)
          const bru=ventaUF(s,ufRef), cos=costoVentaUF(s), neto=bru-cos
          html+=`<tr><td>${c?.name||'—'}</td><td>${s.title||'—'}</td><td><span class="badge badge-area">${s.area||'—'}</span></td><td>${s.status||'—'}</td><td style="text-align:right">${fmtUFN(bru)}</td><td style="text-align:right;color:#E24B4A">${cos>0?fmtUFN(cos):'—'}</td><td style="text-align:right;color:#1D9E75;font-weight:600">${fmtUFN(neto)}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="4">TOTAL</td><td style="text-align:right">${fmtUFN(brutoUF)}</td><td style="text-align:right;color:#E24B4A">${fmtUFN(costoUF)}</td><td style="text-align:right;color:#1D9E75">${fmtUFN(netoUF)}</td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin ventas en este período</p>`
      }
      html+=`</div>`
    }

    // ── COBRANZA
    if(sections.cobranza){
      const bb=filterByPeriod(billing,'issued_at').filter(b=>b.billing_type!=='reembolso'&&['Pendiente','Vencido','Pagado'].includes(b.status))
      const pending=bb.filter(b=>b.status==='Pendiente').reduce((a,b)=>a+saldoBill(b),0)   // saldo real (descuenta abonos parciales), no el monto total
      const overdue=bb.filter(b=>b.status==='Vencido').reduce((a,b)=>a+saldoBill(b),0)
      const paid=bb.filter(b=>b.status==='Pagado').reduce((a,b)=>a+montoFactura(b),0)   // autoridad DTE
      html+=`<div class="section${sections.ventas?' page-break':''}">
        <div class="section-title">Cobranza</div>
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Por cobrar</div><div class="kpi-value">${fmtN(pending)}</div></div>
          <div class="kpi"><div class="kpi-label">Vencido</div><div class="kpi-value" style="color:#E24B4A">${fmtN(overdue)}</div></div>
          <div class="kpi"><div class="kpi-label">Cobrado</div><div class="kpi-value" style="color:#1D9E75">${fmtN(paid)}</div></div>
        </div>`
      if(bb.length>0){
        html+=`<table><thead><tr><th>Cliente</th><th>Concepto</th><th>N° Factura</th><th>Emisión</th><th>Estado</th><th style="text-align:right">Monto</th><th>Antigüedad</th></tr></thead><tbody>`
        bb.sort((a,b)=>(a.status==='Vencido'?0:1)-(b.status==='Vencido'?0:1)).forEach(b=>{
          const c=clients.find(x=>x.id===b.client_id)
          const dias=b.due?Math.round((new Date()-new Date(b.due+'T12:00'))/86400000):null
          const badgeClass=b.status==='Pagado'?'badge-paid':b.status==='Vencido'?'badge-overdue':'badge-pending'
          const diasStr=dias!==null&&dias>0?`${dias}d vencido`:dias!==null&&dias<0?`${Math.abs(dias)}d restantes`:'—'
          html+=`<tr><td>${c?.name||'—'}</td><td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.concept||'—'}</td><td style="font-family:monospace">${b.invoice_no||'—'}</td><td>${b.issued_at||'—'}</td><td><span class="badge ${badgeClass}">${b.status}</span></td><td style="text-align:right;font-weight:600">${fmtN(montoFactura(b))}</td><td style="color:${dias>0?C.overdue:A2}">${diasStr}</td></tr>`
        })
        html+=`</tbody><tfoot><tr><td colspan="5">TOTAL</td><td style="text-align:right">${fmtN(pending+overdue+paid)}</td><td></td></tr></tfoot></table>`
      } else {
        html+=`<p style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin cobros en este período</p>`
      }
      html+=`</div>`
    }

    // ── GASTOS (híbrido: movimientos DEL PERÍODO + saldo acumulado a la fecha de fin del período)
    if(sections.gastos){
      const periodEnd = period==='year' ? `${selYear}-12-31` : `${selYear}-${String(selMonth).padStart(2,'0')}-31`
      const inPeriod = d => d && (period==='year' ? d.startsWith(selYear) : d.startsWith(`${selYear}-${String(selMonth).padStart(2,'0')}`))
      const acc={}
      expenses.forEach(e=>{
        if(!acc[e.client_id]) acc[e.client_id]={fMes:0,gMes:0,fAcc:0,gAcc:0}
        const a=acc[e.client_id]
        if(inPeriod(e.date)){ e.type==='fondo'?a.fMes+=(e.amount||0):a.gMes+=(e.amount||0) }
        // saldo a la fecha: movimientos con fecha <= fin del período (sin fecha se incluyen, para no perder plata)
        if(!e.date || e.date<=periodEnd){ e.type==='fondo'?a.fAcc+=(e.amount||0):a.gAcc+=(e.amount||0) }
      })
      // Solo clientes con movimiento EN el período
      const filas=clients.filter(c=>acc[c.id]&&(acc[c.id].fMes||acc[c.id].gMes))
      html+=`<div class="section page-break">
        <div class="section-title">Gastos y Fondos · ${label}</div>
        <table style="margin-bottom:16px"><thead><tr><th>Cliente</th><th style="text-align:right">Fondos (período)</th><th style="text-align:right">Gastos (período)</th><th style="text-align:right">Saldo a la fecha</th></tr></thead><tbody>`
      if(filas.length){
        filas.forEach(c=>{ const a=acc[c.id]; const sal=a.fAcc-a.gAcc
          html+=`<tr><td>${c.name}</td><td style="text-align:right;color:#1D9E75">${fmtN(a.fMes)}</td><td style="text-align:right;color:#E24B4A">${fmtN(a.gMes)}</td><td style="text-align:right;font-weight:700;color:${sal<0?C.overdue:C.normal}">${fmtN(sal)}</td></tr>`
        })
      } else {
        html+=`<tr><td colspan="4" style="color:${A3};font-style:italic;text-align:center;padding:16px">Sin movimientos de gastos en este período</td></tr>`
      }
      html+=`</tbody></table></div>`
    }

    // ── TAREAS
    if(sections.tareas){
      const activeTasks=tasks.filter(t=>t.status==='Activo')
      const WHO=['Cristóbal','Martín','Martina','Erasmo','Rodrigo']
      html+=`<div class="section page-break"><div class="section-title">Tareas Activas</div>`
      WHO.forEach(who=>{
        const mine=activeTasks.filter(t=>isAssignee(t,who)).sort((a,b)=>(daysLeft(a.due)||999)-(daysLeft(b.due)||999))
        if(!mine.length) return
        html+=`<div class="who-section"><div class="who-title">${who} · ${mine.length} tarea${mine.length!==1?'s':''}</div>
        <table><thead><tr><th>Cliente</th><th>Proyecto</th><th>Tarea</th><th>Plazo</th><th>Estado</th></tr></thead><tbody>`
        mine.forEach(t=>{
          const c=clients.find(x=>x.id===t.client_id)
          const u=urgency(t.due,t.status)
          const color=u==='overdue'?C.overdue:u==='urgent'?C.soon:u==='soon'?C.soon:C.normal
          const dias=t.due?daysLeft(t.due):null
          const diasStr=dias!==null?(dias<0?`${Math.abs(dias)}d vencido`:dias===0?'hoy':`${dias}d`):''
          html+=`<tr><td>${c?.name||'—'}</td><td>${t.project||'—'}</td><td>${t.title}</td><td>${t.due||'—'}</td><td style="color:${color};font-weight:600">${diasStr}</td></tr>`
        })
        html+=`</tbody></table></div>`
      })
      html+=`</div>`
    }

    // Footer
    html+=`<div class="footer"><span>${BRAND.nombre} · ${BRAND.web}</span><span>Reporte ${label} · ${now}</span><span>CONFIDENCIAL</span></div>`
    html+=`<button class="print-btn no-print" onclick="window.print()">Imprimir / Guardar PDF</button>`
    html+=`</body></html>`
    return html
  }
  const generatePDF=()=>{
    const html=buildHtml()
    const win=window.open('','_blank')
    win.document.write(html)
    win.document.close()
    setTimeout(()=>win.focus(),300)
    logActividad('reporte.generado',{detalle:{title:`${getPeriodLabel()} · ${Object.entries(sections).filter(([,v])=>v).map(([k])=>k).join(', ')}`}})
  }
  const isDesk=useIsDesktop()

  const anySelected=Object.values(sections).some(Boolean)

  const preview=anySelected?buildHtml():null
  return (
    <div style={isDesk?{display:'flex',alignItems:'flex-start',gap:18}:undefined}>
    <div style={isDesk?{width:360,flexShrink:0}:undefined}>
      <div style={{marginBottom:16}}>
        <Lbl>Período</Lbl>
        <div style={{display:'flex',gap:6,marginBottom:10}}>
          {[['month','Por mes'],['year','Por año']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriod(v)} style={{flex:1,padding:'8px',borderRadius:8,border:`1px solid ${period===v?C.accent:C.border}`,background:period===v?C.azulBg:'transparent',color:period===v?C.accent:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:period==='month'?'1fr 1fr':'1fr',gap:8}}>
          <select value={selYear} onChange={e=>setSelYear(e.target.value)} style={{padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:13}}>
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          {period==='month'&&(
            <select value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={{padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:13}}>
              {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      <div style={{marginBottom:20}}>
        <Lbl>Secciones a incluir</Lbl>
        {[
          ['ventas','Ventas','Meta, proyectos, bruto/costo/neto'],
          ['cobranza','Cobranza','Facturas, estado y antigüedad'],
          ['gastos','Gastos y Fondos','Saldos por cliente'],
          ['tareas','Tareas activas','Por responsable con urgencia'],
        ].map(([k,label,desc])=>(
          <div key={k} onClick={()=>toggle(k)} style={{display:'flex',gap:12,alignItems:'flex-start',padding:'10px 14px',borderRadius:10,border:`1px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?C.azulBg:'#fff',marginBottom:8,cursor:'pointer'}}>
            <div style={{width:20,height:20,borderRadius:6,border:`2px solid ${sections[k]?C.accent:C.border}`,background:sections[k]?C.accent:'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
              {sections[k]&&<span style={{color:'#fff',fontSize:11,fontWeight:700}}><Gl n='tick'/></span>}
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:sections[k]?C.accent:C.text}}>{label}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {anySelected&&(
        <div style={{background:C.bgSoft,borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:C.muted}}>
          {Object.entries(sections).filter(([,v])=>v).length} sección{Object.entries(sections).filter(([,v])=>v).length!==1?'es':''} · {getPeriodLabel()} · Tamaño carta vertical
        </div>
      )}

      <div style={{display:'flex',gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>
        <button disabled={!anySelected} onClick={generatePDF} style={{flex:2,padding:'9px 14px',borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:!anySelected?.6:1}}>
          Imprimir / Guardar PDF
        </button>
      </div>
      <div style={{marginTop:12}}><BitacoraLista prefijo='reporte.' titulo='Reportes generados' etiquetas={{'reporte.generado':'Reporte generado'}} limite={8}/></div>
    </div>
    {preview&&<div style={{flex:1,minWidth:0,marginTop:isDesk?0:14}}>
      <div style={{...SEC_LBL,marginBottom:6}}>Vista previa</div>
      <iframe title='Vista previa del reporte' srcDoc={preview} style={{width:'100%',height:isDesk?'calc(100vh - 190px)':520,border:`1px solid ${C.border}`,borderRadius:12,background:'#fff'}}/>
    </div>}
    </div>
  )
}

