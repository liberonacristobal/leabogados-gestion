// Resultado del año — FUENTE ÚNICA del «Resultado del año» de Inicio (Vendido, Facturado, Cobrado, Margen y sus detalles) y del Panel de socios.
// Extraído de DashboardView SIN cambiar ninguna fórmula: son los mismos bloques, con sus mismas dependencias. Inicio y el Panel llaman a este hook,
// por eso muestran siempre las mismas cifras.
import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll, DEMO } from '../supabase'
import { demoData } from '../demoData'
import { UF_FALLBACK, comisionesVenta, currentYear, esFacIngreso, esSubarriendo, margenPct, montoFactura, redondearPartes, resultadoMes, ufDelDia, useFuentesResultado, useUF, useUFFechas, ventaCLP, ventaCuentaEnAnio, ventaUF, ventaVendidaEnAnio } from './compartido.jsx'

export const META_CLP = 400000000

export function useResultadoAnio({ sales, billing, terceros, costosOfiRows, expenses, clients, anticipos, selYear }){
  const yr = currentYear
  const _mNow = new Date().getMonth()+1
  // "Ingresado a caja" ANCLADO A LA CARTOLA (regla 2026-08-27: debe cuadrar con el banco). Honorarios cobrados =
  // abonos (no internos) conciliados a factura/anticipo, por fecha del depósito. El fondo por rendir NO cuenta.
  const [ingConc,setIngConc] = useState([])     // conciliacion a factura/anticipo
  const [ingAbonos,setIngAbonos] = useState([]) // cartola: abonos no internos
  useEffect(()=>{
    if(DEMO){ setIngConc((demoData.conciliacion||[]).filter(c=>['factura','anticipo'].includes(c.tipo_destino))); setIngAbonos((demoData.cartola_movimientos||[]).filter(m=>m.tipo==='abono'&&!m.es_interno)); return }
    selectAll(()=>supabase.from('conciliacion').select('movimiento_id,factura_id,anticipo_id,tipo_destino,monto_aplicado').in('tipo_destino',['factura','anticipo']).order('id')).then(({data})=>setIngConc(data||[]),()=>{})
    selectAll(()=>supabase.from('cartola_movimientos').select('id,fecha,monto,monto_conciliado,cliente_id,categoria').eq('tipo','abono').neq('es_interno',true).order('id')).then(({data})=>setIngAbonos(data||[]),()=>{})
  },[])
  const salesYr = sales.filter(s=>ventaVendidaEnAnio(s,yr))
  const ufState = useUF()
  const ufHoy = ufState.uf

  const ufRef = ufHoy || salesYr.find(s=>s.uf_value>0)?.uf_value || UF_FALLBACK
  const ufDias = useUFFechas(billing)   // UF de cada día (mindicador): las cifras del año en UF se convierten con la UF del día de cada movimiento
  const ufDeVenta = s => ventaUF(s, ufRef)
  const clpDeVenta = s => ventaCLP(s, ufRef)
  const [targets,setTargets] = useState([])
  useEffect(()=>{
    if(DEMO){ setTargets(demoData.annual_targets||[]); return }
    supabase.from('annual_targets').select('*').order('year',{ascending:false}).then(({data})=>{
      const rows = (data&&data.length)?[...data]:[]
      if(!rows.some(t=>t.year===currentYear)) rows.unshift({year:currentYear,target_amount:META_CLP,currency:'CLP'})
      setTargets(rows)
    })
  },[])
  // Métricas de un año desde sales (vendido), misma fórmula que el cálculo central
  const metricasAnio = (year) => {
    const sy = sales.filter(s=>ventaVendidaEnAnio(s,year))   // Vendido = Activo + Terminado (fuente única con SalesView; excluye Pausado, que antes divergía)
    const bruto = Math.round(sy.reduce((a,s)=>a+clpDeVenta(s),0))
    // Comisiones = fuente única comisionesVenta (las registradas; si una venta no tiene, su costo pactado). En UF, con la UF de la venta.
    const costo = Math.round(sy.reduce((a,s)=>a+comisionesVenta(s,terceros,billing,ufRef).anual,0))
    const neto = bruto - costo
    // UF NOMINALES (suma directa de amount_uf, igual que la pestaña Ventas) — para que ambas vistas cuadren en modo UF. No reconvertir el CLP con la UF de hoy.
    const brutoUF = sy.reduce((a,s)=>a+ufDeVenta(s),0)
    const costoUF = sy.reduce((a,s)=>{ const u=parseFloat(s.uf_value)||ufRef; return a+(u>0?comisionesVenta(s,terceros,billing,ufRef).anual/u:0) },0)
    const netoUF = brutoUF - costoUF
    const meta = Number(targets.find(t=>t.year===year)?.target_amount) || (year===currentYear?META_CLP:0)
    const pct = meta>0 ? Math.round((neto/meta)*100) : 0   // % meta sobre NETO (igual que el historial y pctMeta) — no mezclar bruto/neto
    return {year,bruto,costo,neto,brutoUF,costoUF,netoUF,meta,pct}
  }
  const m = metricasAnio(selYear)
  const metaUF = m.meta>0 ? ((m.bruto>0&&m.brutoUF>0) ? m.meta*m.brutoUF/m.bruto : (ufRef>0?m.meta/ufRef:0)) : 0
  // Facturado/Cobrado del AÑO seleccionado (facturas emitidas en el año; cobrado = de esas, cuánto pagado).
  const _sySel = String(selYear)
  // "Ingresado a caja" = HONORARIOS COBRADOS anclados a la CARTOLA (regla 2026-08-27: debe cuadrar con el banco).
  // = abonos (no internos) conciliados a factura/anticipo, por AÑO DE INGRESO = fecha del depósito. El fondo por rendir NO cuenta.
  // Desglose por AÑO DE VENTA (factura→sale.year / anticipo→sale.year). Lo no conciliado = "por identificar" (alerta, aparte).
  const ingresosPorAnioVenta = useMemo(()=>{
    const saleYrById={}; sales.forEach(s=>{ if(s.year!=null) saleYrById[String(s.id)]=s.year })
    const billById={}; (billing||[]).forEach(b=>{ billById[String(b.id)]=b })
    const antById={}; (anticipos||[]).forEach(a=>{ antById[String(a.id)]=a })
    const abonoById={}; ingAbonos.forEach(m=>{ abonoById[String(m.id)]=m })
    // Facturas emitidas POR CUENTA de un externo (terceros_pagos.comision_pct): lo cobrado NO es propio; solo nuestra comisión entra (proporcional a lo cobrado).
    const extByBill={}; (terceros||[]).forEach(t=>{ if(t&&t.comision_pct!=null&&t.billing_id){ const e=(extByBill[String(t.billing_id)]=extByBill[String(t.billing_id)]||{com:0,mto:0}); e.com+=Number(t.comision_monto)||0; e.mto+=Number(t.monto)||0 } })
    // Gasto dentro de una factura de honorarios (fondo ligado: expenses.invoice_id) = reembolso, no honorario: igual que Por socio.
    const fondoEnFac={}; (expenses||[]).forEach(e=>{ if(e&&!e.deleted_at&&e.type==='fondo'&&e.invoice_id) fondoEnFac[String(e.invoice_id)]=(fondoEnFac[String(e.invoice_id)]||0)+(Number(e.amount)||0) })
    const yrDe = iso => { const y=String(iso||'').slice(0,4); return /^\d{4}$/.test(y)?+y:null }
    const anioVentaDe = c => {
      let sid=null, sy=null, docFecha=null
      if(c.tipo_destino==='factura'){ const b=billById[String(c.factura_id)]; sid=b?.sale_id; sy=b?.sale_year; docFecha=b?.issued_at||b?.due }
      else { const a=antById[String(c.anticipo_id)]; sid=a?.sale_id; sy=a?.sale_year; docFecha=a?.fecha }
      if(sid&&saleYrById[String(sid)]!=null) return saleYrById[String(sid)]
      if(sy!=null) return sy
      // Fallback: sin venta enlazada, el año lo da el propio documento (emisión de la factura / fecha del anticipo o pago sin factura).
      // Antes esto caía a "sin año" aunque el documento SÍ tuviera fecha (facturas emitidas y anticipos/pagos conciliados).
      return yrDe(docFecha)
    }
    const byMonth={}
    let total=0, totalUF=0, sinMontoUF=0, percibidasUF=0, cajaSubarrUF=0, cajaReembUF=0, cajaExtUF=0, sinMonto=0, sinN=0, percibidas=0, cajaSubarr=0, cajaReemb=0, cajaExt=0; const byYear={}, byYearUF={}; const listByYear={}; const sinList=[]; const percList=[]; const cajaList=[]   // depósitos que no son cobrado propio (subarriendo, reembolsos, externos), con su fecha: el control de la proyección los suma
    ingConc.forEach(c=>{
      const m=abonoById[String(c.movimiento_id)]; if(!m) return
      if(!String(m.fecha||'').startsWith(_sySel)) return          // AÑO DE INGRESO A CAJA = fecha del depósito
      let monto=Number(c.monto_aplicado)||0; if(monto<=0) return
      // Lo que NO es cobrado propio se acumula aparte solo para cuadrar el «Total a caja» con el banco.
      if(m.categoria==='Subarriendo'){ cajaList.push({ id:'cs-'+c.movimiento_id+'-'+String(c.anticipo_id||c.factura_id), paid_at:m.fecha, _cobrado:monto }); cajaSubarr+=monto; cajaSubarrUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); return } // subarriendo = ingreso por arriendo, NO honorarios cobrados (vive en Colaboradores)
      if(c.tipo_destino==='factura'){
        const b=billById[String(c.factura_id)]
        if(b&&b.billing_type==='reembolso'){ cajaList.push({ id:'cr-'+c.movimiento_id+'-'+String(c.factura_id), paid_at:m.fecha, _cobrado:monto }); cajaReemb+=monto; cajaReembUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); return } // reembolso de gastos: devuelve plata, no son honorarios
        const ex=extByBill[String(c.factura_id)]
        if(ex){ cajaList.push({ id:'ce-'+c.movimiento_id+'-'+String(c.factura_id), paid_at:m.fecha, _cobrado:monto }); cajaExt+=monto; cajaExtUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); const base=ex.com+ex.mto; const p=base>0?monto*ex.com/base:0; percibidas+=p; percibidasUF+=p/ufDelDia(ufDias,m.fecha,ufRef); percList.push({ id:'cp-'+c.movimiento_id+'-'+String(c.factura_id), client_id:b?.client_id||m.cliente_id, folio:b?.invoice_no, paid_at:m.fecha, _cobrado:p }); return }
        const fo=b&&fondoEnFac[String(b.id)]
        if(fo){ const mf=montoFactura(b)||monto, r=monto*Math.min(1,fo/mf); cajaList.push({ id:'cr-'+c.movimiento_id+'-'+String(c.factura_id), paid_at:m.fecha, _cobrado:r }); cajaReemb+=r; cajaReembUF+=r/ufDelDia(ufDias,m.fecha,ufRef); monto-=r; if(monto<1) return }
      }
      const ay=anioVentaDe(c)
      let item
      if(c.tipo_destino==='factura'){ const b=billById[String(c.factura_id)]||{}; item={ id:'cf-'+c.movimiento_id+'-'+String(c.factura_id), client_id:b.client_id||m.cliente_id, invoice_no:b.invoice_no, folio:b.invoice_no, sale_id:b.sale_id||null, paid_at:m.fecha, _cobrado:monto, concept:b.concept } }
      else { const a=antById[String(c.anticipo_id)]||{}; item={ id:'ca-'+c.movimiento_id+'-'+String(c.anticipo_id), client_id:a.client_id||m.cliente_id, invoice_no:null, folio:null, sale_id:a.sale_id||null, paid_at:m.fecha, _cobrado:monto, _esAnticipo:true, concept:a.nota||'Anticipo' } }
      total+=monto; totalUF+=monto/ufDelDia(ufDias,m.fecha,ufRef)   // Cobrado en UF: cada pago con la UF del día del depósito
      { const ymC=String(m.fecha||'').slice(0,7); byMonth[ymC]=(byMonth[ymC]||0)+monto }   // cobrado propio por MES del depósito: suma de los meses = total
      if(ay==null){ sinMonto+=monto; sinMontoUF+=monto/ufDelDia(ufDias,m.fecha,ufRef); sinN++; sinList.push(item); return }
      byYear[ay]=(byYear[ay]||0)+monto; byYearUF[ay]=(byYearUF[ay]||0)+monto/ufDelDia(ufDias,m.fecha,ufRef); (listByYear[ay]=listByYear[ay]||[]).push(item)
    })
    // Por identificar = abonos del año que aún no se conciliaron (cola de conciliación) → ALERTA de acción, no plata perdida.
    const porIdentificar = ingAbonos.filter(m=>String(m.fecha||'').startsWith(_sySel)&&m.categoria!=='Subarriendo').reduce((a,m)=>a+Math.max(0,(Number(m.monto)||0)-(Number(m.monto_conciliado)||0)),0)
    const delAnio = byYear[selYear]||0
    const anteriores = Math.max(0, total - delAnio - sinMonto)
    const prioYears = Object.keys(byYear).map(Number).filter(y=>y<selYear).sort((a,b)=>b-a)
    const allYears = Object.keys(byYear).map(Number).sort((a,b)=>b-a)
    return {byMonth,total,totalUF,sinMontoUF,percibidasUF,byYear,byYearUF,delAnio,anteriores,sinMonto,sinN,prioYears,allYears,listByYear,sinList,porIdentificar,percibidas,percList,cajaList,cajaSubarr,cajaReemb,cajaExt,totalCaja:total+cajaSubarr+cajaReemb+cajaExt,totalCajaUF:totalUF+cajaSubarrUF+cajaReembUF+cajaExtUF,cajaSubarrUF,cajaReembUF,cajaExtUF}
  },[ingConc,ingAbonos,billing,anticipos,sales,terceros,expenses,selYear,ufDias,ufRef])
  // Comisiones PAGADAS del año (base caja, por pagado_at) atribuidas al AÑO DE LA VENTA — espejo de ingresosPorAnioVenta.
  // Año de venta = terceros.sale_id → sales.year; si no, vía la factura (billing.sale_id → sales.year); si no, el año del documento. Así "sin año" no aparece cuando la factura tiene venta.
  const comisPagadasAnioVenta = useMemo(()=>{
    const saleYrById={}; sales.forEach(s=>{ if(s.year!=null) saleYrById[String(s.id)]=s.year })
    const billById={}; (billing||[]).forEach(b=>{ billById[String(b.id)]=b })
    const yrDe = iso => { const y=String(iso||'').slice(0,4); return /^\d{4}$/.test(y)?+y:null }
    const anioVentaDe = t => {
      if(t.sale_id!=null && saleYrById[String(t.sale_id)]!=null) return saleYrById[String(t.sale_id)]
      const b=billById[String(t.billing_id)]
      if(b){ if(b.sale_id!=null && saleYrById[String(b.sale_id)]!=null) return saleYrById[String(b.sale_id)]; return yrDe(b.issued_at||b.due) }
      return null
    }
    let total=0, totalUF=0, totalTodo=0, sinAnio=0; const byYear={}
    ;(terceros||[]).forEach(t=>{
      if(t.estado!=='pagado') return
      if(!String(t.pagado_at||'').startsWith(String(selYear))) return   // AÑO DE SALIDA = fecha del pago
      const monto=Number(t.monto)||0; if(monto<=0) return
      totalTodo+=monto
      if(t.comision_pct!=null) return   // traspaso a un externo (factura por su cuenta): no es costo nuestro; lo nuestro entra como comisión percibida
      total+=monto; totalUF+=monto/ufDelDia(ufDias,t.pagado_at,ufRef)
      const ay=anioVentaDe(t)
      if(ay==null){ sinAnio+=monto; return }
      byYear[ay]=(byYear[ay]||0)+monto
    })
    return {total,totalUF,totalTodo,byYear,sinAnio}
  },[terceros,billing,sales,selYear,ufDias,ufRef])
  // Meta de cobranza del año (annual_targets.collection_target). % y faltante para la foto de ingresos.
  const metaCobranza = Number(targets.find(t=>t.year===selYear)?.collection_target) || 0
  // Facturado del año = HONORARIOS EMITIDOS en el año (por fecha de emisión issued_at), monto del DTE (fuente única montoFactura).
  // OJO criterio (afinado con el usuario): captura TODAS las facturas emitidas en el año, incluidas las de ventas de años anteriores;
  // EXCLUYE la facturación de gastos/reembolsos (billing_type='reembolso') — solo honorarios. El desglose por año de venta va en el drill.
  const _esFactHon = b => b && !b.deleted_at && b.invoice_no && b.status!=='Anulada' && esFacIngreso(b)   // honorarios + comisión + por externo (el externo va a «por cuenta de terceros» vía extBillIds)
  const extBillIds = useMemo(()=>new Set((terceros||[]).filter(t=>t&&t.comision_pct!=null&&t.billing_id).map(t=>String(t.billing_id))),[terceros])
  // Facturado POR CUENTA de terceros (externo con retención): se muestra aparte, no suma a lo propio.
  const facturadoTerceros = useMemo(()=>{ const list=(billing||[]).filter(b=> _esFactHon(b) && extBillIds.has(String(b.id)) && String(b.issued_at||'').slice(0,4)===String(selYear)).sort((a,b)=>String(b.issued_at||'').localeCompare(String(a.issued_at||''))); return {total:list.reduce((a,b)=>a+montoFactura(b),0), totalUF:list.reduce((a,b)=>a+montoFactura(b)/ufDelDia(ufDias,b.issued_at,ufRef),0), list} },[billing,extBillIds,selYear,ufDias,ufRef])
  // Total EMITIDO en el año (todo tipo: honorarios propios, por cuenta de terceros, reembolsos, subarriendo) → línea al pie del panel Facturado.
  const facturadoEmitido = useMemo(()=>{ const r={total:0,reemb:0,subarr:0,totalUF:0,reembUF:0,subarrUF:0}; (billing||[]).forEach(b=>{ if(!b||b.deleted_at||!b.invoice_no||b.status==='Anulada'||String(b.issued_at||'').slice(0,4)!==String(selYear)) return; const v=montoFactura(b), vu=v/ufDelDia(ufDias,b.issued_at,ufRef); r.total+=v; r.totalUF+=vu; if(b.billing_type==='reembolso'){ r.reemb+=v; r.reembUF+=vu } else if(b.billing_type==='subarriendo'){ r.subarr+=v; r.subarrUF+=vu } }); return r },[billing,selYear,ufDias,ufRef])
  const facturadoYr = useMemo(()=> (billing||[]).filter(b=> _esFactHon(b) && !extBillIds.has(String(b.id)) && String(b.issued_at||'').slice(0,4)===String(selYear)).reduce((a,b)=>a+montoFactura(b),0), [billing,extBillIds,selYear])
  // Facturado (emitido en el año) DESGLOSADO por año de la venta → drill del embudo (2026 / 2025 / sin venta=0). Lista por factura.
  const facturadoByYear = useMemo(()=>{
    const syById={}; sales.forEach(s=>{ if(s.year!=null) syById[String(s.id)]=s.year })
    const byYear={}, byYearUF={}; const listByYear={}
    ;(billing||[]).forEach(b=>{
      if(!_esFactHon(b) || extBillIds.has(String(b.id)) || String(b.issued_at||'').slice(0,4)!==String(selYear)) return
      // AÑO DE LA VENTA: venta enlazada (sale_id→sales.year) → sale_year (año resuelto a mano, aunque no haya venta enlazada) → año del vencimiento. Espeja anioVentaDe de Cobrado. Antes solo miraba sale_id y caía a "sin venta" ignorando sale_year.
      const y = (b.sale_id!=null && syById[String(b.sale_id)]!=null) ? syById[String(b.sale_id)] : (b.sale_year!=null ? b.sale_year : (b.due?Number(String(b.due).slice(0,4)):0))
      byYear[y]=(byYear[y]||0)+montoFactura(b); byYearUF[y]=(byYearUF[y]||0)+montoFactura(b)/ufDelDia(ufDias,b.issued_at,ufRef); (listByYear[y]=listByYear[y]||[]).push(b)
    })
    return {byYear,byYearUF,listByYear}
  },[billing,sales,extBillIds,selYear,ufDias,ufRef])
  const fuRes = useFuentesResultado()
  // MARGEN del año = el MISMO resultado del Estado de resultados / Oficina / Resultado del año (devengado): Σ resultadoMes del año elegido.
  const resAnio = useMemo(()=>{ const deps={billing,terceros,costosOfiRows,expenses,clients,ufd:ufDias,ufFb:ufRef}, ult=selYear===currentYear?_mNow:12
    const K=['fac','sub','rex','ing','cos','com','res'], o={}; K.forEach(k=>{ o[k]=0; o[k+'UF']=0 })
    o.rexItems=[]
    for(let i=1;i<=ult;i++){ const r=resultadoMes(fuRes,deps,`${selYear}-${String(i).padStart(2,'0')}`); K.forEach(k=>{ o[k]+=r[k]; o[k+'UF']+=r[k+'UF'] }); o.rexItems.push(...(r.rexItems||[])) }
    o.pct=margenPct(o.res,o.ing)
    // Cifras para MOSTRAR la cascada: redondeadas de modo que las partes sumen el total (UF enteras; pesos a $0,1M como fmtMill).
    const cuadra=(paso,sf)=>{ const ing=Math.round(o['ing'+sf]/paso)*paso, [fac,sub,rex]=redondearPartes([o['fac'+sf],o['sub'+sf],o['rex'+sf]],paso,[0]), [res,cos,com]=redondearPartes([o['res'+sf],o['cos'+sf],o['com'+sf]],paso,[0]); return {fac,sub,rex,ing,cos,com,res} }
    o.verUF=cuadra(1,'UF'); o.verCLP=cuadra(1e5,'')
    return o },[fuRes,billing,terceros,costosOfiRows,expenses,clients,selYear,currentYear,_mNow,ufDias,ufRef])
  return { salesYr, ufState, ufHoy, ufRef, ufDias, ingConc, ingAbonos, targets, metricasAnio, m, metaUF, ingresosPorAnioVenta, comisPagadasAnioVenta, metaCobranza, _esFactHon, extBillIds, facturadoTerceros, facturadoEmitido, facturadoYr, facturadoByYear, fuRes, resAnio }
}

// Porcentajes del «Resultado del año» (Vendido contra meta, Facturado contra lo vendido, Cobrado contra meta de cobranza): una sola fórmula para Inicio y el Panel de socios.
export function pctsAnio({ m, resAnio, metaUF, ingYTD, metaCobranza }){
  const ventaPct=metaUF>0?Math.round(m.brutoUF/metaUF*100):0   // sin tope: si supera la meta muestra el sobrecumplimiento (ej. 103%)
  const ventaNetoPct=metaUF>0?Math.round(m.netoUF/metaUF*100):0   // venta NETA (neto de comisiones) vs la MISMA meta
  const factPct=m.bruto>0?Math.min(100,Math.round(resAnio.fac/m.bruto*100)):0
  const cobroPct=metaCobranza>0?Math.round(ingYTD/metaCobranza*100):0   // sin tope: igual que ventaPct
  return { ventaPct, ventaNetoPct, factPct, cobroPct }
}
