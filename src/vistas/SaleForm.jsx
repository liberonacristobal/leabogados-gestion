// Movido desde App.jsx por scripts/mover-a-modulo.py. Sin cambios de comportamiento.
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabase'
import { C, Gl, SEC_LBL, Spin, _normTxt, appAlert, appConfirm, fmt, fmtFechaDMY, fmtRutCL, isoLocal, useIsDesktop } from '../lib/base.jsx'
import { CubrirCuotasModal, DriveIcon, EQUIPO_RESPALDO, FacturarBloqueModal, Fld, Inp, Lbl, NOMBRE_CLI, PaginaSobre, Sel, Switch, Txt, WHO_LIST, _equipo, _tipoDupLbl, anio4ISO, cargarMammoth, cargarPdfjs, chipBtn, claudeCall, clientesParecidos, comisionesVenta, currentMonth, currentYear, driveGet, driveToken, esSubarriendo, fmtUF, planDeVenta, useUF } from '../lib/compartido.jsx'

export const equipoPorEmail = () => { const r={}; Object.entries(EQUIPO_RESPALDO).forEach(([n,e])=>{ r[e]=n }); return {...r, ...(_equipo?.pe||{})} }

export function MiniClientForm({onSave,onCancel,defaultStatus='Activo',defaultName='',clients=[],onPickExisting}) {
  const [f,setF] = useState({name:defaultName||'',rut:'',type:'Corporativo'})
  const [saving,setSaving] = useState(false)
  const [okDistinto,setOkDistinto] = useState(false)
  const up=(k,v)=>{ setF(p=>({...p,[k]:v})); if(k==='name') setOkDistinto(false) }
  // Alarma anti-duplicado: clientes existentes iguales o muy parecidos al nombre tipeado. BLOQUEA crear hasta usar el existente o confirmar que es distinto.
  const parecidos = useMemo(()=>clientesParecidos(f.name, clients), [f.name, clients])
  const bloqueado = parecidos.length>0 && !okDistinto
  const save = async() => {
    if(!f.name.trim() || bloqueado) return
    setSaving(true)
    try {
      const {data,error} = await supabase.from('clients').insert({...f,status:defaultStatus}).select().single()
      if(error) throw error
      onSave(data)
    } catch(e) { appAlert('Error: '+e.message) }
    setSaving(false)
  }
  return (
    <div style={{background:C.bgSoft,borderRadius:10,padding:'12px 14px',marginBottom:12,border:`1px solid ${C.accent}`}}>
      <div style={{fontSize:12,fontWeight:600,color:C.accent,marginBottom:10}}>Nuevo cliente</div>
      <Fld label='Nombre'><Inp value={f.name} onChange={e=>up('name',e.target.value)} placeholder='Nombre del cliente...' autoFocus/></Fld>
      {parecidos.length>0&&(
        <div style={{background:C.soonBg,border:`1px solid ${C.soon}`,borderRadius:9,padding:'9px 11px',margin:'0 0 10px'}}>
          <div style={{fontSize:11,fontWeight:700,color:C.soonText,marginBottom:6}}>Ya existe {parecidos.length>1?'n fichas parecidas':'una ficha parecida'} — no dupliques:</div>
          {parecidos.slice(0,4).map(({cliente,tipo})=>(
            <div key={cliente.id} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}}>
              <span style={{flex:1,minWidth:0,fontSize:12,color:C.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cliente.name} <span style={{fontSize:9,fontWeight:700,color:C.soonText}}>· {_tipoDupLbl(tipo)}</span></span>
              {onPickExisting&&<span onClick={()=>onPickExisting(cliente)} style={{fontSize:11,fontWeight:700,color:'#fff',background:C.accent,borderRadius:7,padding:'4px 10px',cursor:'pointer',flexShrink:0,whiteSpace:'nowrap'}}>Usar esta</span>}
            </div>
          ))}
          <label style={{display:'flex',alignItems:'center',gap:7,marginTop:7,cursor:'pointer'}}>
            <input type='checkbox' checked={okDistinto} onChange={e=>setOkDistinto(e.target.checked)} style={{width:15,height:15,accentColor:C.accent,cursor:'pointer'}}/>
            <span style={{fontSize:11,color:C.text}}>Confirmo que es un cliente <b>distinto</b> — crear igual</span>
          </label>
        </div>
      )}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <Fld label='RUT'><Inp value={f.rut} onChange={e=>up('rut',e.target.value)} placeholder='76.xxx.xxx-x'/></Fld>
        <Fld label='Tipo'><Sel value={f.type} onChange={e=>up('type',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
      </div>
      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button onClick={onCancel} style={{flex:1,padding:8,borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
        <button disabled={saving||!f.name.trim()||bloqueado} onClick={save} title={bloqueado?'Usa la ficha existente o confirma que es distinto':''} style={{flex:2,padding:8,borderRadius:8,border:'none',background:bloqueado?C.done:C.accent,color:'#fff',fontSize:12,fontWeight:600,cursor:bloqueado?'default':'pointer'}}>{saving?'Guardando...':'Crear cliente'}</button>
      </div>
    </div>
  )
}

// Reparto del costo de terceros entre proveedores (cuentas por pagar).
// Cada fila = un proveedor + monto (CLP) + cuota ancla (la factura cuyo pago libera el fee).
// Reparto del costo a proveedores. Cada fila: proveedor + tipo (% / UF / $) + valor.
// El costo se reparte en las MISMAS cuotas que el cobro (se distribuye al guardar).
// Por defecto el tipo = la unidad de la venta. La reconciliación y los montos se muestran en esa unidad.
export function RepartoTerceros({proveedores=[],rows=[],setRows,moneda='UF',ufVal=0,saleTotal=0,costTotal=0,hideHeader=false}) {
  const titulo = p => (p?.nombre?.trim()||p?.razon_social?.trim()||'Proveedor')
  const provs = [...proveedores].sort((a,b)=>titulo(a).localeCompare(titulo(b),'es'))
  const esUF = moneda!=='CLP'
  const defTipo = esUF ? 'uf' : 'clp'
  const inp={width:'100%',height:36,border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,padding:'0 9px',color:C.text,background:'#fff',outline:'none',boxSizing:'border-box'}
  const sel={...inp,appearance:'none',fontSize:12}
  const fmtU = v => esUF ? fmtUF(v) : fmt(Math.round(v))
  // Aporte de una fila en la UNIDAD de la venta (UF si la venta es UF; CLP si es CLP).
  const enUnidad = r => {
    const v = parseFloat(r.valor)||0
    if(r.tipo==='pct') return saleTotal*v/100
    if(esUF) return r.tipo==='uf' ? v : (ufVal>0 ? v/ufVal : 0)   // clp sobre venta UF (raro)
    return r.tipo==='uf' ? v*ufVal : v                            // venta CLP
  }
  const suma = rows.reduce((a,r)=>a+enUnidad(r),0)
  const tol = esUF ? 0.01 : 1
  const cuadra = costTotal<=0 || Math.abs(costTotal-suma)<=tol
  const up=(i,k,v)=>setRows(rows.map((r,j)=>j===i?{...r,[k]:v}:r))
  // Al agregar un proveedor toma por defecto el costo aún no repartido (todo el costo si es el primero), en las mismas cuotas.
  const addRow=()=>{
    const asignado = rows.reduce((a,r)=>a+enUnidad(r),0)
    const resto = Math.max(0, costTotal-asignado)
    const val = resto>0 ? (esUF? String(+resto.toFixed(2)) : String(Math.round(resto))) : ''
    setRows([...rows,{proveedor_id:'',tipo:defTipo,valor:val,_edit:false}])
  }
  const delRow=i=>setRows(rows.filter((_,j)=>j!==i))
  const tipos=[['pct','%'],['uf','UF'],['clp','$']]
  const Switch = ({on,onClick,title}) => (
    <button type='button' onClick={onClick} title={title} style={{width:30,height:17,borderRadius:10,border:'none',background:on?C.accent:C.toggleOff,position:'relative',cursor:'pointer',padding:0,flexShrink:0,transition:'background .15s'}}>
      <span style={{position:'absolute',top:2,left:on?15:2,width:13,height:13,borderRadius:'50%',background:'#fff',transition:'left .15s'}}/>
    </button>
  )
  return (
    <div style={hideHeader?{}:{background:C.bgSoft,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px 12px',marginBottom:14}}>
      {!hideHeader&&<div style={{...SEC_LBL,marginBottom:8}}>¿A quién le pagas?</div>}
      {provs.length===0?(
        <div style={{fontSize:12,color:C.muted,lineHeight:1.45}}>Sin proveedores. Créalos en <strong style={{color:C.accent}}>Clientes → Proveedores</strong>.</div>
      ):(<>
        {rows.map((r,i)=>{
          const tipo=r.tipo||defTipo
          return (
          <div key={i} style={{marginBottom:9}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr auto 20px',gap:8,alignItems:'center'}}>
              <select value={r.proveedor_id||''} onChange={e=>up(i,'proveedor_id',e.target.value)} style={sel}>
                <option value=''>— Proveedor —</option>
                {provs.map(p=><option key={p.id} value={p.id}>{titulo(p)}</option>)}
              </select>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:10,color:C.muted,whiteSpace:'nowrap'}}>Cambiar</span>
                <Switch on={!!r._edit} onClick={()=>up(i,'_edit',!r._edit)} title='Cambiar condiciones (monto y forma)'/>
              </div>
              <button type='button' onClick={()=>delRow(i)} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,lineHeight:1,padding:0}}><Gl n='x'/></button>
            </div>
            {r.proveedor_id&&<div style={{display:'flex',alignItems:'center',gap:7,marginTop:6}}>
              <span style={{fontSize:10,color:C.muted,whiteSpace:'nowrap'}}>Comisión desde</span>
              <input type='month' value={r.desde||''} onChange={e=>up(i,'desde',e.target.value)} style={{...inp,height:30,fontSize:11,flex:1,minWidth:0}}/>
              <span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap'}}>{r.desde?'en adelante':'todas'}</span>
            </div>}
            {(r._edit || !((parseFloat(r.valor)||0)>0))?(
              <div style={{display:'flex',height:36,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',background:'#fff',marginTop:6}}>
                <input type='number' value={r.valor??''} onChange={e=>up(i,'valor',e.target.value)} placeholder={tipo==='pct'?'% que te cobra':tipo==='uf'?'Cuánto (UF)':'Cuánto ($)'} style={{flex:1,minWidth:0,border:'none',padding:'0 9px',fontSize:13,color:C.text,outline:'none'}}/>
                <div style={{display:'flex',flexShrink:0}}>
                  {tipos.map(([v,l])=>(
                    <button key={v} type='button' onClick={()=>up(i,'tipo',v)} style={{padding:'0 8px',border:'none',borderLeft:`1px solid ${C.border}`,background:tipo===v?C.accent:C.bgSoft,color:tipo===v?'#fff':C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{l}</button>
                  ))}
                </div>
              </div>
            ):(
              <div style={{fontSize:12,color:C.muted,marginTop:4}}><strong style={{color:C.text,fontWeight:600}}>{fmtU(enUnidad(r))}</strong> · en las mismas cuotas del cobro</div>
            )}
          </div>
        )})}
        <button type='button' onClick={addRow} style={{fontSize:12,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,padding:'7px 12px',marginTop:rows.length?4:0}}>+ Agregar proveedor</button>
        {rows.length>0&&costTotal>0&&!cuadra&&(
          <div style={{fontSize:11,color:C.muted,marginTop:8}}>Repartido <strong style={{color:C.text}}>{fmtU(suma)}</strong> de <strong style={{color:C.text}}>{fmtU(costTotal)}</strong>.</div>
        )}
      </>)}
    </div>
  )
}

// Íconos del selector visual de "Forma de cobro" (SaleForm). Trazo heredado (currentColor).
export const _cIc = d => <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>{d}</svg>

export const COBRO_IC = {
  cuotas: _cIc(<><rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/></>),
  mensual: _cIc(<><path d='M17 1l4 4-4 4'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><path d='M7 23l-4-4 4-4'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></>),
  porcentaje: _cIc(<><path d='M19 5L5 19'/><circle cx='6.5' cy='6.5' r='2.5'/><circle cx='17.5' cy='17.5' r='2.5'/></>),
  personalizada: _cIc(<><path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/></>),
  hora: _cIc(<><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/></>),
}

export function SaleForm({asPage=false,afterHero=null,sale,clients:initialClients,clientEntities,billing,sales=[],proveedores=[],terceros=[],anticipos=[],onCubrirCuotas,onDescubrirCuotas,onFacturarBloque,onSaveTariff,onCambiarFormato,onUpdateCuotas,onSave,onClose,onDelete,onPrimerasTareas,saving,user,onExposeUpload,onExposeDrive,onExposeReasign}) {
  const [cubrirAnt,setCubrirAnt] = useState(null)
  const [facturarAntS,setFacturarAntS] = useState(null)
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const WHO_LIST = ['Cristóbal','Erasmo','Martín','Martina','Rodrigo']
  // Si estamos activando una propuesta, guardar el honorario original antes de que el usuario lo edite
  const _activandoPropuesta = !!(sale?._activandoPropuesta)
  const _propAmountUF = sale?._propAmountUF ?? null
  const _propAmountCLP = sale?._propAmountCLP ?? null
  const [f,setF] = useState(sale ? {...sale, area: sale.area||'Corporativo', status: _activandoPropuesta?'Activo':sale.status} : {client_id:'',title:'',area:'Corporativo',amount_uf:'',cost_uf:'',uf_value:'',year:currentYear,month:currentMonth,status:'Activo',notes:'',responsible:'',cobro_type:'cuotas',entity_id:''})
  const [clients,setClients] = useState(initialClients)
  const [clientQ,setClientQ] = useState('')
  const [showNewClient,setShowNewClient] = useState(false)
  const [selectedClient,setSelectedClient] = useState(initialClients.find(c=>c.id===sale?.client_id)||null)
  const [reasignCli,setReasignCli] = useState(false)   // reasignar la venta/propuesta a otro cliente (click en el nombre)
  const [rsMode,setRsMode] = useState(null)   // razón social: null=mostrar asignada · 'pick'=elegir otra · 'new'=agregar
  const [newRS,setNewRS] = useState({name:'',rut:''})
  const [extraEntities,setExtraEntities] = useState([])   // razones sociales creadas dentro de este form
  const [savingRS,setSavingRS] = useState(false)
  const [cobroType,setCobroType] = useState(sale?.cobro_type||'cuotas')
  const [nCuotas,setNCuotas] = useState(sale?.cobro_config?.nCuotas||3)
  const [cobroInicio,setCobroInicio] = useState(sale?.cobro_config?.cobroInicio||'')
  const [tramos,setTramos] = useState(sale?.cobro_config?.tramos||[{id:1,pct:50,fecha:''},{id:2,pct:50,fecha:''}])
  const [cuotasCustom,setCuotasCustom] = useState(sale?.cobro_config?.cuotasCustom||[{id:1,monto:'',fecha:''}])
  const [mensualInicio,setMensualInicio] = useState(sale?.cobro_config?.mensualInicio||'')
  // Cuotas mensuales con UNA cuota distinta (modelo: monto recurrente + cuota distinta inicial/final; el N° se deriva para cuadrar el total)
  const [cuotaDist,setCuotaDist] = useState(sale?.cobro_config?.cuotaDist||false)
  const [cuotaDistPos,setCuotaDistPos] = useState(sale?.cobro_config?.cuotaDistPos||'primera')
  const [cuotaDistMonto,setCuotaDistMonto] = useState(sale?.cobro_config?.cuotaDistMonto||'')
  const [cuotaRec,setCuotaRec] = useState(sale?.cobro_config?.cuotaRec||'')
  // Cobro POR HORA: tarifa (UF/hora, override del valor global del estudio) + tope de horas + periodo del tope. Se factura por consumo real (tabla horas por sale_id), no genera cuotas programadas.
  const [tarifaHoraUF,setTarifaHoraUF] = useState(sale?.cobro_config?.tarifaHoraUF||'')
  const [topeHoras,setTopeHoras] = useState(sale?.cobro_config?.topeHoras||'')
  const [topePeriodo,setTopePeriodo] = useState(sale?.cobro_config?.topePeriodo||'mes')
  const [openSec,setOpenSec] = useState({})   // acordeones de secciones secundarias del form (Clasificación, Notas)
  const [cuotaEdits,setCuotaEdits] = useState({})   // ediciones inline de cuotas programadas guardadas {id:{due,amount}} (amount en la unidad cuotaUnit)
  const [savingCuotas,setSavingCuotas] = useState(false)
  const [cuotaUnit,setCuotaUnit] = useState(sale?.moneda||'UF')   // unidad para editar las cuotas (parte por la de la venta)
  const [moverYM,setMoverYM] = useState('')         // nuevo mes de inicio para CORRER todas las cuotas programadas juntas
  const [pausFromId,setPausFromId] = useState('')   // cuota desde la que se PAUSA (esa y las siguientes)
  const [reactOpen,setReactOpen] = useState(false)  // panel para reactivar cuotas pausadas
  const [reactFromId,setReactFromId] = useState('') // cuota desde la que se REANUDA
  const [reactMonth,setReactMonth] = useState('')   // YYYY-MM de la 1ª factura al reactivar
  const [costMode,setCostMode] = useState('fijo')
  const [costPct,setCostPct] = useState('')
  // Reparto del costo de terceros entre proveedores. Para venta existente se ancla por billing_id;
  // para venta nueva por índice de cuota (cuotaIdx), que se resuelve a billing_id al guardar.
  // Reconstruye las filas del reparto agrupando los terceros_pagos por proveedor+tipo+valor
  // (cada fila se reparte en N cuotas, así que varios registros = una fila del formulario).
  const [reparto,setReparto] = useState(()=>{
    const mine=(terceros||[]).filter(t=>String(t.sale_id)===String(sale?.id)&&t.tipo_costo)   // las comisiones por factura (tipo_costo null) no son del reparto
    const dueById={}; (billing||[]).forEach(b=>{ dueById[String(b.id)]=(b.due||b.issued_at||'').slice(0,7) })
    const g={}
    // "desde" (mes) inferido = cuota MÁS ANTIGUA con comisión de ese proveedor → conserva el efecto "desde X" al reabrir/re-guardar sin columna nueva.
    mine.forEach(t=>{ const k=`${t.proveedor_id}|${t.tipo_costo||''}|${t.valor??''}`; if(!g[k]) g[k]={proveedor_id:t.proveedor_id,tipo:t.tipo_costo||'clp',valor:t.valor??'',_dues:[]}; const dm=t.billing_id?dueById[String(t.billing_id)]:''; if(dm) g[k]._dues.push(dm) })
    const cuotasN=(billing||[]).filter(b=>String(b.sale_id)===String(sale?.id)&&b.billing_type!=='reembolso').length
    return Object.values(g).map(x=>{ const dues=(x._dues||[]).filter(Boolean).sort(); const {_dues,...rest}=x
      // Solo marca "desde" si la comisión NO cubre todas las cuotas (si cubre todas, es "todas", sin fecha).
      return {...rest, desde:(dues.length && dues.length<cuotasN)?dues[0]:''} })
  })
  const [tariffs,setTariffs] = useState([])
  const [histAbierto,setHistAbierto] = useState(false)   // Historial de honorarios colapsado por defecto (form más corto al reabrir)
  useEffect(()=>{ if(!sale?.id) return; supabase.from('sale_tariff_history').select('*').eq('sale_id',sale.id).order('vigente_desde',{ascending:true}).then(({data})=>setTariffs(data||[])) },[sale?.id])
  const fmtMesAno = d => d ? d.slice(5,7)+'/'+d.slice(0,4) : '—'
  const [modCobro,setModCobro] = useState(false)
  const [modMode,setModMode] = useState('ajustar')
  const [newHon,setNewHon] = useState('')
  const [newVig,setNewVig] = useState('')
  const [newCosto,setNewCosto] = useState('')
  const [newCostMode,setNewCostMode] = useState('fijo')
  const [newCostPct,setNewCostPct] = useState('')
  const [newFmt,setNewFmt] = useState('')
  const [newNCuotas,setNewNCuotas] = useState(3)
  const [newCobroInicio,setNewCobroInicio] = useState('')
  const [newCuotasCustom,setNewCuotasCustom] = useState([{id:1,monto:'',fecha:''}])
  const [savingTariff,setSavingTariff] = useState(false)
  const [propuestaStep,setPropuestaStep] = useState(null)
  const [propuestaData,setPropuestaData] = useState(null)
  const [propError,setPropError] = useState('')
  const [propClientMatch,setPropClientMatch] = useState(null)
  const [propClientCandidates,setPropClientCandidates] = useState([])
  const [propSearchQ,setPropSearchQ] = useState('')
  const [propEntitySel,setPropEntitySel] = useState('')
  const [propClientMode,setPropClientMode] = useState('asociar')
  const [propNewClient,setPropNewClient] = useState({name:'',rut:'',razon_social:''})
  const [propCreating,setPropCreating] = useState(false)
  const [propDriveFiles,setPropDriveFiles] = useState([])
  const [propDriveLoading,setPropDriveLoading] = useState(false)
  const [propDriveError,setPropDriveError] = useState('')
  const [aiFields,setAiFields] = useState(new Set())
  const [hasDraft,setHasDraft] = useState(false)
  const [draftTs,setDraftTs] = useState(null)
  const draftTimer = useRef(null)
  const DRAFT_KEY = 'leabogados_sale_draft'
  const {uf: ufHoy} = useUF()
  const [openCondicion,setOpenCondicion] = useState(null)
  useEffect(()=>{ if(onExposeUpload) onExposeUpload(()=>setPropuestaStep('upload')) },[])
  useEffect(()=>{ if(onExposeReasign) onExposeReasign(()=>{ setReasignCli(true); setClientQ('') }) },[])   // el nombre del encabezado (App) dispara el cambio de cliente
  useEffect(()=>{
    if(!onExposeDrive) return
    onExposeDrive(async()=>{
      setPropuestaStep('drive')
      setPropDriveError('')
      setPropDriveLoading(true)
      try {
        const token = await driveToken()
        const PROPUESTAS_FOLDER = '1MQg9_q0l20mjB-LftuYQywTE4T81Kxf3'
        const cutoff = new Date(Date.now()-15*24*60*60*1000).toISOString()
        const q = encodeURIComponent(`'${PROPUESTAS_FOLDER}' in parents and modifiedTime>'${cutoff}' and trashed=false and (mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType='application/vnd.google-apps.document')`)
        const data = await driveGet(token,`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime+desc&pageSize=50`)
        setPropDriveFiles(data.files||[])
      } catch(e) {
        setPropDriveError(e.message||'Error al conectar con Drive')
      }
      setPropDriveLoading(false)
    })
  },[])
  useEffect(()=>{ if(ufHoy && !f.uf_value) up('uf_value', Math.round(ufHoy)) },[ufHoy])
  useEffect(()=>{
    if(sale?.id) return
    try { const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null'); if(d?.ts){setHasDraft(true);setDraftTs(d.ts)} } catch {}
  },[])
  useEffect(()=>{
    if(sale?.id) return
    clearTimeout(draftTimer.current)
    draftTimer.current=setTimeout(()=>{
      localStorage.setItem(DRAFT_KEY,JSON.stringify({f,selectedClient,cobroType,nCuotas,cobroInicio,tramos,cuotasCustom,mensualInicio,costMode,costPct,ts:Date.now()}))
    },2000)
    return ()=>clearTimeout(draftTimer.current)
  },[f,selectedClient,cobroType,nCuotas,cobroInicio,mensualInicio,costMode,costPct,tramos,cuotasCustom])
  const resetMod = () => { setModCobro(false); setModMode('ajustar'); setNewHon(''); setNewVig(''); setNewCosto(''); setNewFmt(''); setNewNCuotas(3); setNewCobroInicio(''); setNewCuotasCustom([{id:1,monto:'',fecha:''}]); setNewCostMode('fijo'); setNewCostPct('') }

  const AiBadge = ({field}) => aiFields.has(field) ? <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:C.border,color:C.muted,marginLeft:5,verticalAlign:'middle',lineHeight:1,whiteSpace:'nowrap'}}>IA</span> : null
  const clearDraft = () => { localStorage.removeItem(DRAFT_KEY); setHasDraft(false) }
  const restoreDraft = () => {
    try {
      const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'{}')
      if(d.f) setF(d.f)
      if(d.selectedClient){setSelectedClient(d.selectedClient);setClientQ('')}
      if(d.cobroType) setCobroType(d.cobroType)
      if(d.nCuotas) setNCuotas(d.nCuotas)
      if(d.cobroInicio) setCobroInicio(d.cobroInicio)
      if(d.tramos) setTramos(d.tramos)
      if(d.cuotasCustom) setCuotasCustom(d.cuotasCustom)
      if(d.mensualInicio) setMensualInicio(d.mensualInicio)
      if(d.costMode) setCostMode(d.costMode)
      if(d.costPct) setCostPct(d.costPct)
    } catch {}
    setHasDraft(false)
  }

  const extractFromFile = async (file) => {
    if(file.size > 10*1024*1024) { setPropError('El archivo supera 10 MB.'); return }
    setPropuestaStep('extracting')
    setPropError('')
    try {
      let text = ''
      if(file.name.toLowerCase().endsWith('.pdf')) {
        const arrayBuf = await file.arrayBuffer()
        const pdf = await (await cargarPdfjs()).getDocument({data: new Uint8Array(arrayBuf)}).promise
        for(let i=1; i<=pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const content = await page.getTextContent()
          text += content.items.map(it=>it.str||'').join(' ') + '\n'
        }
      } else {
        const arrayBuf = await file.arrayBuffer()
        const result = await (await cargarMammoth()).extractRawText({arrayBuffer: arrayBuf})
        text = result.value
      }
      const apiData = await claudeCall({model:'claude-sonnet-4-6',max_tokens:4000,system:`Eres un experto extractor de datos de propuestas y contratos de servicios legales en Chile. Lee TODO el documento y devuelve SOLO un JSON (sin markdown ni backticks) con estos campos. Reglas:
- Si un dato no está explícito pero se infiere con certeza, infiérelo; si no, usa "" o null. No inventes.
- cliente_nombre: cliente/contraparte a quien se dirige la propuesta (persona o empresa).
- cliente_rut: RUT chileno formato 12.345.678-9 si aparece.
- razon_social: razón social facturable si difiere del nombre del cliente.
- contactos: nombres, cargos y/o emails de contactos mencionados (texto).
- area: área legal (Corporativo, Tributario, Laboral, Litigios, Inmobiliario, etc.).
- proyecto: nombre CORTO y general del encargo, 2 a 5 palabras (ej. "Recuperación de IVA exportador", "Reorganización societaria", "Juicio laboral", "Asesoría tributaria permanente"). NO una descripción larga ni una frase: solo el asunto, como lo llamaría el estudio internamente.
- moneda: "UF" o "CLP" según en qué se expresan los honorarios.
- honorario_total: monto total SOLO como número (sin símbolos ni separadores de miles; usa punto decimal si hay decimales).
- forma_cobro: cómo se cobra (único, mensual, por cuotas, por etapas, éxito, mixto, etc.).
- n_cuotas: número de cuotas si aplica (entero) o null.
- tipo_honorario_badges: lista de etiquetas como "fijo","variable","éxito","mensual","por hora".
- notas: condiciones relevantes (reajuste, vigencia, gastos, IVA, hitos, etc.).
Devuelve: { cliente_nombre, cliente_rut, razon_social, contactos, area, proyecto, moneda, honorario_total, forma_cobro, n_cuotas, tipo_honorario_badges, notas }`,messages:[{role:'user',content:text.slice(0,40000)}]})
      const raw = (apiData.content?.[0]?.text || '{}').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim()
      const parsed = JSON.parse(raw)
      setPropuestaData(parsed)
      const nombre = (parsed.cliente_nombre||'').toLowerCase().trim()
      const rut = (parsed.cliente_rut||'').replace(/[.\-]/g,'').trim()
      const tokenize = s => s.toLowerCase().replace(/[^\wáéíóúüñ\s]/g,'').split(/\s+/).filter(w=>w.length>2)
      const countCommon = (a,b) => { const sb=new Set(tokenize(b)); return tokenize(a).filter(w=>sb.has(w)).length }
      let exactMatch = null
      if(rut) exactMatch = clients.find(c=>(c.rut||'').replace(/[.\-]/g,'')=== rut)
      // Nunca duplicar (regla de oro): un cliente con el MISMO nombre normalizado (minúsculas+sin acentos+espacios colapsados) YA es su ficha → asociar, no crear otra.
      if(!exactMatch && nombre){ const _nn=_normTxt(nombre); if(_nn) exactMatch = clients.find(c=>_normTxt(c.name)===_nn) }
      let tokenCandidates = []
      if(!exactMatch && nombre) {
        const scored = clients.map(c=>({c,score:countCommon(nombre,c.name)})).filter(x=>x.score>=2)
        scored.sort((a,b)=>b.score-a.score)
        tokenCandidates = scored.map(x=>x.c)
      }
      const match = exactMatch||(tokenCandidates.length===1?tokenCandidates[0]:null)
      setPropClientMatch(match||null)
      setPropClientCandidates(tokenCandidates.length>1?tokenCandidates:[])
      setPropSearchQ('')
      if(match){
        setPropClientMode('asociar')
        const ents=(clientEntities||[]).filter(e=>e.client_id===match.id)
        setPropEntitySel(ents[0]?.id||'')
      } else if(tokenCandidates.length>1) {
        setPropClientMode('candidatos')
      } else {
        setPropClientMode('crear')
        setPropNewClient({name:parsed.cliente_nombre||'',rut:parsed.cliente_rut||'',razon_social:parsed.razon_social||''})
      }
      setPropuestaStep('asociar')
    } catch(err) {
      setPropError(err.message||'Error al procesar el archivo.')
      setPropuestaStep('upload')
    }
  }

  const applyPropuesta = async () => {
    setPropCreating(true)
    const d = propuestaData
    const filled = new Set()
    try {
      let client = propClientMatch
      if(!client || propClientMode==='crear') {
        // Previene el duplicado de ficha en el origen (lo de Eugenia/Saavedra): si el RUT ya está en otra ficha, avisa.
        const _rut=propNewClient.rut.trim()
        if(_rut){ const _n=s=>(s||'').replace(/[.\s-]/g,'').toUpperCase(); const ya=(clients||[]).find(c=>c.rut&&_n(c.rut)===_n(_rut))||(clientEntities||[]).find(e=>e.rut&&_n(e.rut)===_n(_rut)); if(ya && !await appConfirm(`Ya existe una ficha con el RUT ${_rut}${ya.name?` · ${ya.name}`:''}. Un RUT debería estar en una sola ficha. ¿Crear otra de todas formas?`)){ setPropCreating(false); return } }
        // Nunca duplicar (regla de oro) — ALARMA + BLOQUEO: si ya existe una ficha igual o muy parecida, no crear a ciegas.
        //  · idéntica (mismo nombre normalizado) → se reusa esa ficha (es la misma).
        //  · muy parecida (contenido/typo) → compuerta: cancelar = ir a usar la existente; aceptar = crear igual (es otra).
        const par = clientesParecidos(propNewClient.name, clients)
        const exacto = par.find(p=>p.tipo==='exacto')
        if(exacto){
          client = exacto.cliente
          const ents=(clientEntities||[]).filter(e=>e.client_id===exacto.cliente.id); if(ents[0]&&!propEntitySel) setPropEntitySel(ents[0].id)
        } else if(par.length){
          const nombres = par.slice(0,3).map(p=>`• ${p.cliente.name} (${_tipoDupLbl(p.tipo)})`).join('\n')
          if(!await appConfirm(`Ojo: ya existe ${par.length>1?'n fichas':'una ficha'} muy parecida${par.length>1?'s':''} — para no duplicar (y no repetir carpetas en Drive), mejor usa la existente con "Buscar otro cliente":\n\n${nombres}\n\n¿Crear una ficha NUEVA de todas formas?`)){ setPropCreating(false); return }
        }
        if(!client) {
          // clients NO tiene columna razon_social: el cliente se crea con nombre/RUT y la razón social va a client_entities.
          const {data:nc,error} = await supabase.from('clients').insert({name:propNewClient.name.trim(),rut:propNewClient.rut.trim()||null}).select().single()
          if(error) throw error
          client = nc
          setClients(p=>[...p,nc])
          const rs=propNewClient.razon_social.trim()
          // Sincroniza la RS al estado local (extraEntities) y selecciónala, si no el SaleForm no la ve y la venta quedaría sin entity_id hasta recargar (mismo patrón que agregarRS).
          if(rs){ try{ const {data:ne}=await supabase.from('client_entities').insert({client_id:nc.id,name:rs,rut:propNewClient.rut.trim()||null}).select().single(); if(ne){ setExtraEntities(p=>[...p,ne]); up('entity_id',ne.id) } }catch(_){} }
        }
      }
      setSelectedClient(client)
      up('client_id',client.id)
      if(propEntitySel) up('entity_id',propEntitySel)
      filled.add('client_id')
      if(d.proyecto){ up('title',d.proyecto); filled.add('title') }
      const AREAS = ['Corporativo','Tributario','Laboral','Otro']
      if(d.area){ const a=AREAS.find(x=>x.toLowerCase()===d.area?.toLowerCase()); if(a){ up('area',a); filled.add('area') } }
      const WHO_MAP = equipoPorEmail()
      { const r = client?.abogado_responsable || (user?.email && WHO_MAP[user.email]); if(r){ up('responsible',r); filled.add('responsible') } }   // el abogado del cliente manda; el usuario es respaldo
      if(d.moneda==='CLP'){ up('moneda','CLP'); if(d.honorario_total){ up('amount_clp',String(d.honorario_total)); filled.add('amount_clp') } }
      else if(d.honorario_total){ up('amount_uf',String(d.honorario_total)); filled.add('amount_uf') }
      if(d.forma_cobro){ const MAP={cuotas:'cuotas',mensual:'mensual',porcentaje:'porcentaje',personalizada:'personalizada'}; const mapped=MAP[d.forma_cobro?.toLowerCase()]; if(mapped){ setCobroType(mapped); filled.add('cobro_type') } }
      if(d.n_cuotas){ setNCuotas(parseInt(d.n_cuotas)||3); filled.add('n_cuotas') }
      if(d.notas){ up('notes',d.notas); filled.add('notes') }
      setAiFields(filled)
      setPropuestaStep(null)
      setPropuestaData(null)
    } catch(err) {
      setPropError(err.message||'Error al guardar la propuesta.')
    }
    setPropCreating(false)
  }

  const up=(k,v)=>setF(p=>({...p,[k]:v}))
  const clientMatches = useMemo(()=>{ if(!clientQ.trim()) return []; return clients.filter(c=>_normTxt(c.name).includes(_normTxt(clientQ))).slice(0,6) },[clients,clientQ])
  const clientEntitiesList = useMemo(()=>{ if(!f.client_id) return []; const base=(clientEntities||[]).filter(e=>e.client_id===f.client_id); const extra=extraEntities.filter(e=>e.client_id===f.client_id&&!base.some(b=>String(b.id)===String(e.id))); return [...base,...extra] },[clientEntities,extraEntities,f.client_id])
  // Regla: al elegir cliente, si tiene 1 razón social se asigna sola; si tiene varias se propone la primera. Siempre se puede Cambiar.
  useEffect(()=>{
    if(!f.client_id) return
    const valida = f.entity_id && clientEntitiesList.some(e=>String(e.id)===String(f.entity_id))
    if(!valida && clientEntitiesList.length>0){ up('entity_id', clientEntitiesList[0].id); setRsMode(null) }
  },[clientEntitiesList])
  // Agregar una razón social nueva al cliente desde el form de venta (se persiste y queda seleccionada).
  const agregarRS = async() => {
    const name=newRS.name.trim(); if(!name||!f.client_id) return
    const rut=newRS.rut.trim()
    const _n=s=>(s||'').replace(/[.\s-]/g,'').toUpperCase()
    const dup=(clientEntitiesList||[]).find(e=> (rut&&e.rut&&_n(e.rut)===_n(rut)) || _n(e.name)===_n(name) )
    if(dup && !await appConfirm(`Ya existe la razón social "${dup.name}"${dup.rut?` · ${fmtRutCL(dup.rut)}`:''} en este cliente. ¿Agregarla de todas formas?`)) return
    setSavingRS(true)
    try{
      const {data,error}=await supabase.from('client_entities').insert({client_id:f.client_id,name,rut:rut||null}).select().single()
      if(error)throw error
      setExtraEntities(p=>[...p,data]); up('entity_id',data.id); setNewRS({name:'',rut:''}); setRsMode(null)
    }catch(e){ appAlert('No se pudo agregar la razón social: '+e.message) }
    setSavingRS(false)
  }
  // Cobro mensual: el inicio se toma del Año/Mes de la venta por defecto (evita años distintos, como pasó con BM Soluciones).
  useEffect(()=>{ if(cobroType==='mensual' && !mensualInicio && f.year && f.month) setMensualInicio(`${f.year}-${String(f.month).padStart(2,'0')}-01`) },[cobroType,f.year,f.month])
  const moneda = f.moneda||'UF'
  const ufVal = parseFloat(f.uf_value)||0
  const amountUF = parseFloat(f.amount_uf)||0
  const montoCLP = parseFloat(f.amount_clp)||0
  const totalCLP = moneda==='CLP' ? montoCLP : amountUF*ufVal
  const costVal = costMode==='pct'
    ? (moneda==='UF' ? amountUF*(parseFloat(costPct)||0)/100 : montoCLP*(parseFloat(costPct)||0)/100)
    : (moneda==='UF' ? parseFloat(f.cost_uf)||0 : parseFloat(f.cost_clp)||0)
  const hasCost = costMode==='pct' ? (parseFloat(costPct)||0)>0 : costVal>0
  // Costo derivado del REPARTO (comisión de proveedores) en la unidad de la venta. Espeja enUnidad de RepartoTerceros:
  // fuente única para que, en una venta sin costo explícito, el reparto (ej. Martín 30%) SÍ entre al margen (cost_uf/clp).
  const repartoEnUnidad = r => { const v=parseFloat(r.valor)||0; if(r.tipo==='pct') return (moneda==='CLP'?montoCLP:amountUF)*v/100; if(moneda!=='CLP') return r.tipo==='uf'?v:(ufVal>0?v/ufVal:0); return r.tipo==='uf'?v*ufVal:v }
  const costoReparto = (reparto||[]).filter(r=>r.proveedor_id && (parseFloat(r.valor)||0)>0).reduce((a,r)=>a+repartoEnUnidad(r),0)
  const panelHon = parseFloat(newHon)||0
  const panelCosto = newCostMode==='pct' ? panelHon*(parseFloat(newCostPct)||0)/100 : parseFloat(newCosto)||0

  // Modelo "cuota distinta": el usuario fija el monto RECURRENTE y el de UNA cuota distinta (inicial/final).
  // El N° de cuotas se deriva para cuadrar el total; el último recurrente absorbe el residuo. Devuelve montos en la MONEDA.
  // Fuente ÚNICA del plan "cuota distinta": se deriva de N° cuotas + monto de la distinta (1ª o última);
  // el resto se reparte parejo para cuadrar el total. MISMA fórmula que planDeVenta (App.jsx:474-477) para que
  // el plan y la generación NUNCA divergan (antes: generación derivaba N desde el monto recurrente y nCuotas
  // quedaba stale=3 → el guardarraíl de conciliación se descalibraba).
  const calcCuotasDist = () => {
    const total = moneda==='CLP'?montoCLP:amountUF
    const D = parseFloat(cuotaDistMonto)||0
    const n = Math.max(1, parseInt(nCuotas)||0)
    if(!total||n<=0) return []
    if(n===1) return [{m:total,d:true}]
    const resto = +((total - D)/(n-1)).toFixed(2)
    const rl = Array.from({length:n-1},()=>({m:resto,d:false}))
    return cuotaDistPos==='ultima' ? [...rl,{m:D,d:true}] : [{m:D,d:true},...rl]
  }
  const generarCobros = () => {
    if(!f.client_id||!totalCLP) return []
    const cobros = []
    // Vencimiento estándar: día 1 del mes (se emite del 1 al 5). La 1ª cuota NUNCA cae ANTES del "Inicio cobro":
    // inicio día 1 → ese mes; inicio en cualquier día posterior (ej. 30/09) → el 1 del mes SIGUIENTE (01/10), nunca el 1 de ESE mes (01/09, anterior al inicio).
    const mesISO=(inicio,i)=>{ const [yy,mm,dd]=anio4ISO(inicio).split('-').map(Number); let cy=yy, cm=mm+i+((dd>1)?1:0); while(cm>12){cm-=12;cy++} return `${cy}-${String(cm).padStart(2,'0')}-01` }
    if(cobroType==='mensual' && mensualInicio) {
      const [y,m,d] = anio4ISO(mensualInicio).split('-').map(Number); let cy=y, cm=m+((d>1)?1:0); if(cm>12){cm-=12;cy++}
      // Mes vencido: la cuota se DEVENGA/emite en un mes pero corresponde al servicio del mes ANTERIOR (la que emites en julio es junio). La fecha (devengo) no cambia, solo la etiqueta del mes.
      for(let i=0;i<12;i++){ const lm=cm===1?12:cm-1, ly=cm===1?cy-1:cy; cobros.push({monto:Math.round(totalCLP), fecha:`${cy}-${String(cm).padStart(2,'0')}-01`, label:`Mensual ${MONTHS[lm-1]} ${ly}`}); cm++; if(cm>12){cm=1;cy++} }
    } else if(cobroType==='cuotas' && cobroInicio && cuotaDist) {
      const arr = calcCuotasDist()
      if(arr.length){
        const totR = Math.round(totalCLP); let acc=0
        arr.forEach((c,i)=>{ const mm = moneda==='CLP'?Math.round(c.m):Math.round(c.m*ufVal); acc+=mm; cobros.push({monto:mm, fecha:mesISO(cobroInicio,i), label:`Cuota ${i+1}/${arr.length}`}) }
        )
        cobros[cobros.length-1].monto += (totR-acc)   // cuadra el total exacto (residuo de redondeo)
      }
    } else if(cobroType==='cuotas' && cobroInicio && nCuotas>0) {
      const mc = Math.round(totalCLP/nCuotas)
      const totR = Math.round(totalCLP)
      // La última cuota absorbe el residuo de redondeo para que la suma de cuotas == total exacto.
      for(let i=0;i<nCuotas;i++) { cobros.push({monto: i===nCuotas-1?(totR-mc*(nCuotas-1)):mc, fecha:mesISO(cobroInicio,i), label:`Cuota ${i+1}/${nCuotas}`}) }
    } else if(cobroType==='porcentaje') {
      tramos.forEach(t=>{ if(t.pct&&t.fecha) cobros.push({monto:Math.round(totalCLP*t.pct/100), fecha:anio4ISO(t.fecha), label:`${t.pct}%`}) })
      // Si los tramos suman 100%, el último absorbe el residuo de redondeo para que Σ cuotas == total exacto.
      if(cobros.length && Math.round(tramos.reduce((a,t)=>a+(parseInt(t.pct)||0),0))===100){ const totR=Math.round(totalCLP), acc=cobros.reduce((a,c)=>a+c.monto,0); cobros[cobros.length-1].monto += (totR-acc) }
    } else if(cobroType==='personalizada') {
      cuotasCustom.forEach((c,i)=>{ if(c.monto&&c.fecha){ const mm=moneda==='CLP'?Math.round(parseFloat(c.monto)||0):Math.round((parseFloat(c.monto)||0)*ufVal); cobros.push({monto:mm, fecha:anio4ISO(c.fecha), label:moneda==='CLP'?`Cobro ${i+1}`:`Cobro ${i+1} (${c.monto} UF)`}) } })
    }
    return cobros
  }
  const cobros = generarCobros()
  const cobroConfig = {nCuotas,cobroInicio:anio4ISO(cobroInicio),tramos,cuotasCustom,mensualInicio,cuotaDist,cuotaDistPos,cuotaDistMonto,cuotaRec,
    ...(cobroType==='hora' ? {tarifaHoraUF:parseFloat(String(tarifaHoraUF).replace(',','.'))||null, topeHoras:parseInt(topeHoras)||null, topePeriodo} : {})}
  // Propuesta/Borrador: aún no es venta activa → se edita con el MISMO formulario completo que una venta nueva
  // (honorarios, costos, forma de cobro, notas). Sus cuotas son todas Programadas sin emitir, así que al guardar se regeneran.
  const propBorr = !!(sale?.id && (sale?.status==='Propuesta'||sale?.status==='Borrador'))
  const formNuevo = !sale?.id || propBorr
  const isDesktop = useIsDesktop()   // doble presentación: móvil 1 columna, escritorio 2 columnas (datos | dinero/cobro)

  // Persiste las ediciones inline de cuotas (fecha/monto) pendientes, para que el "Guardar" principal
  // NO las pierda si el usuario no tocó el botón "Guardar cambios" del acordeón. No aplica en propuesta/borrador
  // (ahí las cuotas se regeneran). Recompone prog/toCLP igual que el acordeón (viven en su render, fuera de scope).
  const flushCuotaEdits = async () => {
    if(propBorr || !sale?.id || !onUpdateCuotas) return
    const prog=(billing||[]).filter(b=>String(b.sale_id)===String(sale.id)&&b.status==='Programada'&&!b.deleted_at)
    const ufc = parseFloat(f.uf_value)||ufVal||0
    const esUFc = cuotaUnit==='UF' && ufc>0
    const toCLPc = v => esUFc ? Math.round((parseFloat(v)||0)*ufc) : Math.round(parseFloat(v)||0)
    const ups=Object.entries(cuotaEdits).map(([id,e])=>{ const b=prog.find(x=>String(x.id)===String(id)); if(!b) return null; const due=e.due!==undefined?e.due:b.due; const amount=e.amount!==undefined?toCLPc(e.amount):b.amount; if(due===b.due&&amount===Math.round(b.amount||0)) return null; return {id:b.id,due,amount} }).filter(Boolean)
    if(ups.length){ await onUpdateCuotas(ups); setCuotaEdits({}) }
  }

  const handleSave = async (extra={}) => {
    // REGLA: toda venta debe tener abogado responsable. Excepción: el subarriendo (no es venta de cartera; se excluye de Vendido/metas/desglose).
    const esSub = (f.area==='Subarriendo') || (sale?.cobro_config?.subarriendo===true)
    if(!esSub && !String(f.responsible||'').trim()){ appAlert('Toda venta debe tener un abogado responsable. Elige el responsable antes de guardar.'); return }
    // Reparto: solo filas con proveedor elegido y monto. Si hay filas con monto pero SIN proveedor y ninguna completa, avisar.
    const repartoLimpio = (reparto||[]).filter(r=>r.proveedor_id && (parseFloat(r.valor)||0)>0)
    const hayIncompleto = (reparto||[]).some(r=>(parseFloat(r.valor)||0)>0 && !r.proveedor_id)
    if(repartoLimpio.length===0 && hayIncompleto){ appAlert('Elige el proveedor en el reparto de costos antes de guardar (o quita la fila con la ×).'); return }
    await flushCuotaEdits()
    const saveF = {...f}
    if(!hasCost && costoReparto>0) {   // sin costo explícito pero con reparto → el costo de la venta = el reparto (que entre al margen)
      if(moneda==='UF') { saveF.cost_uf = +costoReparto.toFixed(2)||null; saveF.cost_clp = null }
      else { saveF.cost_clp = Math.round(costoReparto)||null; saveF.cost_uf = null }
    }
    else if(!hasCost) { saveF.cost_uf = null; saveF.cost_clp = null }
    else if(costMode==='pct') {
      if(moneda==='UF') saveF.cost_uf = (amountUF*(parseFloat(costPct)||0)/100)||null
      else saveF.cost_clp = (montoCLP*(parseFloat(costPct)||0)/100)||null
    }
    if(_activandoPropuesta) {
      saveF.proposal_amount_uf = _propAmountUF
      saveF.proposal_amount_clp = _propAmountCLP
      saveF.activated_at = new Date().toISOString()
      saveF.status = 'Activo'
    } else if(!sale?.id && saveF.status==='Activo' && !saveF.activated_at && !esSub) {
      // Venta que nace Activa sin pasar por Propuesta: igual es una venta ganada → sella activación y monto para el embudo de conversión.
      saveF.activated_at = new Date().toISOString()
      if(saveF.proposal_amount_uf==null && saveF.proposal_amount_clp==null){ saveF.proposal_amount_uf = parseFloat(saveF.amount_uf)>0?parseFloat(saveF.amount_uf):null; saveF.proposal_amount_clp = saveF.proposal_amount_uf?null:(parseFloat(saveF.amount_clp)>0?Math.round(parseFloat(saveF.amount_clp)):null) }
    }
    // GUARD porcentaje: los tramos deben sumar 100% (si no, la venta se sub-facturaría permanentemente).
    if(cobroType==='porcentaje'){ const sp=(tramos||[]).reduce((a,t)=>a+(parseInt(t.pct)||0),0); if(sp!==100){ appAlert(`Los tramos "por porcentaje" deben sumar 100% (hoy suman ${sp}%).`); return } }
    // GUARD "venta Activa sin cuotas": una venta que NACE Activa (nueva, o al activar una propuesta) sin cuotas generadas
    // quedaría contando en "Vendido" pero fuera de cobranza/proyección, en silencio (raíz de Tarragona/Masihy). Se bloquea.
    const naceActiva = _activandoPropuesta || (!sale?.id && saveF.status==='Activo')
    if(naceActiva && cobroType!=='hora' && (!cobros || cobros.length===0)){
      appAlert('Esta venta quedaría ACTIVA pero sin cuotas para facturar. Define el "Inicio de cobro" (y N° de cuotas / montos / fechas) para que se generen las cuotas antes de guardar.'); return
    }
    // GUARD integridad honorario = Σ cuotas (personalizada): avisa si las cuotas no cuadran con el honorario.
    if(cobroType==='personalizada' && cobros && cobros.length && totalCLP>0){
      const sc=cobros.reduce((a,c)=>a+(c.monto||0),0)
      if(Math.abs(sc-totalCLP) > Math.max(totalCLP*0.01,1000)){
        const ok=await appConfirm(`La suma de las cuotas (${fmt(sc)}) no cuadra con el honorario (${fmt(Math.round(totalCLP))}). ¿Guardar igual?`); if(!ok) return
      }
    }
    clearDraft()
    // En propuesta/borrador editada se regeneran las cuotas programadas (todas sin emitir) según la forma de cobro actual.
    onSave({...saveF, cobros, cobro_type:cobroType, cobro_config:cobroConfig, _actualizarPago:false, _regenProg:propBorr, repartoTerceros:repartoLimpio, ...extra, _thenPrimerasTareas: !!((extra&&extra._thenPrimerasTareas)||(!sale?.id&&!_activandoPropuesta&&saveF.status==='Activo'))})   // venta nueva Activo (o activar propuesta) → arranque de tareas + correo
  }

  const handleSaveDraft = () => {
    const saveF = {...f, status:'Borrador'}
    if(!hasCost && costoReparto>0) {
      if(moneda==='UF') { saveF.cost_uf = +costoReparto.toFixed(2)||null; saveF.cost_clp = null }
      else { saveF.cost_clp = Math.round(costoReparto)||null; saveF.cost_uf = null }
    }
    else if(!hasCost) { saveF.cost_uf = null; saveF.cost_clp = null }
    else if(costMode==='pct') {
      if(moneda==='UF') saveF.cost_uf = (amountUF*(parseFloat(costPct)||0)/100)||null
      else saveF.cost_clp = (montoCLP*(parseFloat(costPct)||0)/100)||null
    }
    clearDraft()
    onSave({...saveF, cobros:[], cobro_type:cobroType, cobro_config:cobroConfig, _actualizarPago:false})
  }

  const confirmAndSave = async() => {
    if(modMode==='ajustar') {
      if(!newHon||!newVig){ appAlert('Completa el nuevo honorario y la fecha de vigencia.'); return }
      setSavingTariff(true)
      const rec = await onSaveTariff(sale, {honorario:panelHon, costo:panelCosto||null, currency:moneda, vigente_desde:newVig+'-01', motivo:null})
      if(rec) {
        setTariffs(p=>[...p,rec])
        const updF = {...f}
        if(moneda==='UF'){updF.amount_uf=newHon;updF.cost_uf=panelCosto||null;updF.cost_clp=null}
        else{updF.amount_clp=newHon;updF.cost_clp=panelCosto||null;updF.cost_uf=null}
        onSave({...updF, cobros, cobro_type:cobroType, cobro_config:cobroConfig, _actualizarPago:false})
      }
    } else {
      if(!newFmt||!newVig){ appAlert('Elige el nuevo formato y la fecha de vigencia.'); return }
      const vigDate=newVig+'-01'
      const baseHon=panelHon||(moneda==='CLP'?montoCLP:amountUF)||0
      const totalC=moneda==='CLP'?baseHon:baseHon*ufVal
      const nuevasCuotas=[]
      if(newFmt==='cuotas'&&newCobroInicio&&newNCuotas>0&&totalC>0){
        const mc=Math.round(totalC/newNCuotas)
        const totR=Math.round(totalC)
        for(let i=0;i<newNCuotas;i++){const [yy,mm]=newCobroInicio.split('-').map(Number);let cy=yy,cm=mm+i;while(cm>12){cm-=12;cy++}nuevasCuotas.push({due:`${cy}-${String(cm).padStart(2,'0')}-01`,amount:i===newNCuotas-1?(totR-mc*(newNCuotas-1)):mc,concept:`${sale.title} — Cuota ${i+1}/${newNCuotas}`})}
      } else if(newFmt==='mensual'&&newVig&&totalC>0){
        const [y,m]=newVig.split('-').map(Number);let cy=y,cm=m
        for(let i=0;i<12;i++){const lm=cm===1?12:cm-1,ly=cm===1?cy-1:cy;nuevasCuotas.push({due:`${cy}-${String(cm).padStart(2,'0')}-01`,amount:Math.round(totalC),concept:`${sale.title} — Mensual ${MONTHS[lm-1]} ${ly}`});cm++;if(cm>12){cm=1;cy++}}
      } else if(newFmt==='personalizada'){
        newCuotasCustom.forEach((c,i)=>{if(c.monto&&c.fecha){const mm=moneda==='CLP'?Math.round(parseFloat(c.monto)||0):Math.round((parseFloat(c.monto)||0)*ufVal);nuevasCuotas.push({due:anio4ISO(c.fecha),amount:mm,concept:`${sale.title} — Cobro ${i+1}`})}})
      } else if(newFmt==='unico'&&newVig&&totalC>0){
        nuevasCuotas.push({due:vigDate,amount:Math.round(totalC),concept:`${sale.title} — Pago único`})
      }
      // GUARD: "Cambiar formato" BORRA las programadas vigentes antes de recrear. Si con estos datos no se generaría
      // ninguna cuota (p.ej. falta "Inicio de cobro"), abortar para NO dejar la venta sin cuotas (borrar sin reemplazo).
      if(newFmt!=='hora' && nuevasCuotas.length===0){ appAlert('Con estos datos no se generaría ninguna cuota (revisa el Inicio de cobro, el N° de cuotas o los montos). No se cambió el formato para no borrar las cuotas actuales sin reemplazo.'); return }
      setSavingTariff(true)
      const rec=await onCambiarFormato(sale,{newFmt,newHon:baseHon||null,newCosto:panelCosto||null,vigDate,motivo:null,nuevasCuotas})
      if(rec){ setTariffs(p=>[...p,rec])
        if(newFmt==='hora'){ const cfg={...cobroConfig, tarifaHoraUF:parseFloat(String(tarifaHoraUF).replace(',','.'))||null, topeHoras:parseInt(topeHoras)||null, topePeriodo}; onSave({...f,cobros:[],cobro_type:'hora',cobro_config:cfg,_actualizarPago:false}) }
        else onSave({...f,cobros,cobro_type:cobroType,cobro_config:cobroConfig,_actualizarPago:false}) }
    }
    setSavingTariff(false)
  }

  if(propuestaStep==='drive') return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:7,fontSize:13,fontWeight:600,color:C.text}}><DriveIcon size={16}/>Cargar desde Drive</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropDriveError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {propDriveLoading?(
        <div style={{textAlign:'center',padding:'40px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
          <Spin/>
          <div style={{fontSize:13,color:C.muted}}>Buscando archivos en Drive...</div>
        </div>
      ):propDriveError?(
        <div style={{fontSize:12,color:C.overdue,padding:'12px 0'}}>{propDriveError}</div>
      ):propDriveFiles.length===0?(
        <div style={{fontSize:13,color:C.muted,padding:'24px 0',textAlign:'center'}}>No hay archivos modificados en los ultimos 15 dias</div>
      ):(
        <>
          <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Archivos modificados en los ultimos 15 dias</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,maxHeight:320,overflowY:'auto'}}>
            {propDriveFiles.map(f=>(
              <button key={f.id} type='button' onClick={async()=>{
                setPropuestaStep('extracting')
                try {
                  const token = await driveToken()
                  const isGDoc = f.mimeType==='application/vnd.google-apps.document'
                  const downloadUrl = isGDoc
                    ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document`
                    : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`
                  const res = await fetch(downloadUrl,{headers:{Authorization:'Bearer '+token}})
                  const blob = await res.blob()
                  const fname = isGDoc?(f.name.includes('.')?f.name:f.name+'.docx'):(f.name||'archivo.pdf')
                  const file = new File([blob],fname,{type:blob.type})
                  await extractFromFile(file)
                } catch(e) {
                  setPropDriveError(e.message||'Error al descargar el archivo')
                  setPropuestaStep('drive')
                }
              }} style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,textAlign:'left',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                <div style={{fontSize:13,fontWeight:600,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</div>
                <div style={{fontSize:10,color:C.muted,flexShrink:0}}>{fmtFechaDMY(isoLocal(f.modifiedTime))}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )

  if(propuestaStep==='upload'||propuestaStep==='extracting') return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Cargar propuesta</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {propuestaStep==='upload'?(
        <>
          <div
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accent}}
            onDragLeave={e=>{e.currentTarget.style.borderColor='#99ABB4'}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#99ABB4';const fi=e.dataTransfer.files[0];if(fi) extractFromFile(fi)}}
            onClick={()=>document.getElementById('prop-file-inp').click()}
            style={{border:'2px dashed #99ABB4',borderRadius:12,padding:'36px 20px',textAlign:'center',cursor:'pointer',transition:'border-color .15s'}}>
            <input id='prop-file-inp' type='file' accept='.pdf,.docx' style={{display:'none'}} onChange={e=>{const fi=e.target.files[0];if(fi) extractFromFile(fi)}}/>
            <svg width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='#99ABB4' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/></svg>
            <div style={{fontSize:13,fontWeight:600,color:C.text,marginTop:10}}>Arrastra un PDF o Word aqui</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>o haz clic para seleccionar · max 10 MB</div>
          </div>
          {propError&&<div style={{fontSize:12,color:C.overdue,marginTop:8}}>{propError}</div>}
        </>
      ):(
        <div style={{textAlign:'center',padding:'48px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <Spin/>
          <div style={{fontSize:13,color:C.muted}}>Leyendo propuesta con IA...</div>
        </div>
      )}
    </>
  )

  if(propuestaStep==='asociar'&&propuestaData) return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.text}}>Propuesta leida</div>
        <button type='button' onClick={()=>{setPropuestaStep(null);setPropuestaData(null);setPropError('')}} style={{background:'none',border:'none',color:C.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
      </div>
      {/* Candidatos múltiples */}
      {propClientMode==='candidatos'&&(
        <>
          <Lbl>Varios clientes posibles — elige uno</Lbl>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
            {propClientCandidates.map(c=>(
              <button key={c.id} type='button' onClick={()=>{setPropClientMatch(c);setPropClientMode('asociar');const ents=(clientEntities||[]).filter(e=>e.client_id===c.id);setPropEntitySel(ents[0]?.id||'')}}
                style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,textAlign:'left',cursor:'pointer'}}>
                <div style={{...NOMBRE_CLI}}>{c.name}</div>
                {c.rut&&<div style={{fontSize:11,color:C.muted}}>{fmtRutCL(c.rut)}</div>}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:4}}>
            <button type='button' onClick={()=>{setPropClientMode('buscar');setPropSearchQ('')}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Buscar otro cliente</button>
            <button type='button' onClick={()=>{setPropClientMode('crear');setPropNewClient({name:propuestaData?.cliente_nombre||'',rut:propuestaData?.cliente_rut||'',razon_social:propuestaData?.razon_social||''})}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Crear como Prospecto</button>
          </div>
        </>
      )}
      {/* Cliente detectado con certeza */}
      {(propClientMode==='asociar'||propClientMode==='crear')&&propClientMatch&&(
        <>
          <Lbl>Cliente detectado</Lbl>
          <div style={{padding:'10px 14px',borderRadius:8,background:C.azulBg,border:`1px solid ${C.accent}`,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:C.accent}}>{propClientMatch.name}</div>
            {propClientMatch.rut&&<div style={{fontSize:11,color:C.muted}}>{fmtRutCL(propClientMatch.rut)}</div>}
          </div>
          <div style={{display:'flex',gap:8,marginBottom:10}}>
            <button type='button' onClick={()=>setPropClientMode('asociar')}
              style={{flex:1,padding:'10px 0',borderRadius:8,border:`1px solid ${propClientMode==='asociar'?C.accent:C.border}`,background:propClientMode==='asociar'?C.accent:'transparent',color:propClientMode==='asociar'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>
              Asociar a este cliente
            </button>
            <button type='button' onClick={()=>setPropClientMode('crear')}
              style={{flex:1,padding:'10px 0',borderRadius:8,border:`1px solid ${propClientMode==='crear'?C.accent:C.border}`,background:propClientMode==='crear'?C.accent:'transparent',color:propClientMode==='crear'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>
              Crear cliente nuevo
            </button>
          </div>
          {propClientMode==='asociar'&&(()=>{const ents=(clientEntities||[]).filter(e=>e.client_id===propClientMatch.id);if(!ents.length)return null;return(<Fld label='Razon social'><select value={propEntitySel} onChange={e=>setPropEntitySel(e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,fontSize:14,color:C.text,boxSizing:'border-box'}}><option value=''>— Asociar despues —</option>{ents.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${fmtRutCL(e.rut)}`:''}</option>)}</select></Fld>)})()}
          {propClientMode==='crear'&&(<>
            <Fld label='Nombre'><Inp value={propNewClient.name} onChange={e=>setPropNewClient(p=>({...p,name:e.target.value}))} placeholder='Nombre del cliente'/></Fld>
            <Fld label='RUT'><Inp value={propNewClient.rut} onChange={e=>setPropNewClient(p=>({...p,rut:e.target.value}))} placeholder='12.345.678-9'/></Fld>
            <Fld label='Razon social'><Inp value={propNewClient.razon_social} onChange={e=>setPropNewClient(p=>({...p,razon_social:e.target.value}))} placeholder='Opcional'/></Fld>
          </>)}
        </>
      )}
      {/* Sin match — crear nuevo */}
      {(propClientMode==='crear'||propClientMode==='buscar')&&!propClientMatch&&propClientMode!=='buscar'&&(
        <>
          <Lbl>Cliente no encontrado</Lbl>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <button type='button' onClick={()=>{setPropClientMode('buscar');setPropSearchQ('')}} style={{flex:1,padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Buscar otro cliente</button>
          </div>
          <Fld label='Nombre'><Inp value={propNewClient.name} onChange={e=>setPropNewClient(p=>({...p,name:e.target.value}))} placeholder='Nombre del cliente'/></Fld>
          <Fld label='RUT'><Inp value={propNewClient.rut} onChange={e=>setPropNewClient(p=>({...p,rut:e.target.value}))} placeholder='12.345.678-9'/></Fld>
          <Fld label='Razon social'><Inp value={propNewClient.razon_social} onChange={e=>setPropNewClient(p=>({...p,razon_social:e.target.value}))} placeholder='Opcional'/></Fld>
        </>
      )}
      {/* Búsqueda manual */}
      {propClientMode==='buscar'&&(
        <>
          <Lbl>Buscar cliente</Lbl>
          <Inp value={propSearchQ} onChange={e=>setPropSearchQ(e.target.value)} placeholder='Escribe nombre o RUT...' style={{marginBottom:8}}/>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12,maxHeight:180,overflowY:'auto'}}>
            {(propSearchQ.trim().length>=2?clients.filter(c=>_normTxt(c.name).includes(_normTxt(propSearchQ))||((c.rut||'').includes(propSearchQ))):clients.slice(0,8)).map(c=>(
              <button key={c.id} type='button' onClick={()=>{setPropClientMatch(c);setPropClientMode('asociar');const ents=(clientEntities||[]).filter(e=>e.client_id===c.id);setPropEntitySel(ents[0]?.id||'')}}
                style={{padding:'10px 14px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,textAlign:'left',cursor:'pointer'}}>
                <div style={{...NOMBRE_CLI}}>{c.name}</div>
                {c.rut&&<div style={{fontSize:11,color:C.muted}}>{fmtRutCL(c.rut)}</div>}
              </button>
            ))}
          </div>
          <button type='button' onClick={()=>{setPropClientMode('crear');setPropClientMatch(null);setPropNewClient({name:propuestaData?.cliente_nombre||'',rut:propuestaData?.cliente_rut||'',razon_social:propuestaData?.razon_social||''})}} style={{width:'100%',padding:'9px 0',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:4}}>Crear como Prospecto</button>
        </>
      )}
      {propError&&<div style={{fontSize:12,color:C.overdue,marginBottom:10}}>{propError}</div>}
      {(propClientMode==='asociar'||propClientMode==='crear')&&(
        <button type='button' disabled={propCreating||(propClientMode==='crear'&&!propNewClient.name.trim())} onClick={applyPropuesta}
          style={{width:'100%',padding:12,borderRadius:10,border:'none',background:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer',opacity:(propCreating||(propClientMode==='crear'&&!propNewClient.name.trim()))?0.6:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:4}}>
          {propCreating&&<Spin/>}
          {propCreating?'Aplicando...':'Continuar y pre-llenar formulario'}
        </button>
      )}
    </>
  )

  return (
    <>
      {/* Banner recuperar borrador local */}
      {hasDraft&&!sale?.id&&(
        <div style={{background:'#FFFBF0',border:'1px solid #E8CC6A',borderRadius:8,padding:'10px 12px',marginBottom:10,display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:'#7A5C00'}}>Borrador guardado</div>
            {draftTs&&<div style={{fontSize:11,color:'#7A5C00'}}>{new Date(draftTs).toLocaleDateString('es-CL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</div>}
          </div>
          <div style={{display:'flex',gap:8,flexShrink:0}}>
            <button onClick={clearDraft} style={{background:'none',border:'none',color:'#7A5C00',fontSize:12,cursor:'pointer',fontWeight:600}}>Descartar</button>
            <button onClick={restoreDraft} style={{padding:'5px 12px',borderRadius:6,border:'none',background:'#E8CC6A',color:'#4A3800',fontSize:12,fontWeight:700,cursor:'pointer'}}>Recuperar</button>
          </div>
        </div>
      )}

      {/* HERO: resumen visual en vivo — materia + honorario (protagonistas) + margen. Aditivo, lee el estado; no reemplaza la edición de abajo. */}
      {(selectedClient || (f.title||'').trim() || amountUF>0 || montoCLP>0) && (()=>{
        const base = moneda==='UF' ? amountUF : montoCLP
        const hon = base>0 ? (moneda==='UF' ? `${(+amountUF.toFixed(2)).toLocaleString('es-CL')} UF` : fmt(Math.round(montoCLP))) : '—'
        const honSub = base>0
          ? (moneda==='UF' ? `≈ ${fmt(Math.round(amountUF*ufVal))}${ufVal>0?` · UF $${Math.round(ufVal).toLocaleString('es-CL')}`:''}` : (ufVal>0?`≈ ${(+(montoCLP/ufVal).toFixed(1)).toLocaleString('es-CL')} UF`:' '))
          : 'Ingresa el honorario abajo'
        // Si la venta ya tiene comisiones registradas, el margen usa esas (fuente única comisionesVenta); si no, el costo pactado.
        const comR = sale?.id ? comisionesVenta(sale, terceros, billing, ufVal) : {real:false,clp:0}
        const costHero = comR.real ? (moneda==='UF' ? (ufVal>0?comR.anual/ufVal:0) : comR.anual) : costVal   // honorario del año vs costo del año (mensuales: incluye lo proyectado)
        const margen = base - costHero
        const pct = base>0 ? Math.max(0,Math.min(100,Math.round(margen/base*100))) : 0
        const fmtU = v => moneda==='UF' ? `${(+v.toFixed(1)).toLocaleString('es-CL')} UF` : fmt(Math.round(v))
        return (
        <div style={{background:'linear-gradient(135deg,#003C50,#0A5168)',color:'#fff',borderRadius:16,padding:'16px 16px 15px',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
            <span style={{fontSize:12,fontWeight:700,opacity:.92,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedClient?.name||'Sin cliente'}</span>
            {cobroType!=='hora'&&<span style={{display:'inline-flex',border:'1.5px solid rgba(255,255,255,.35)',borderRadius:8,overflow:'hidden',flexShrink:0}}>
              {['UF','CLP'].map(mo=><span key={mo} onClick={()=>up('moneda',mo)} style={{fontSize:11,fontWeight:700,padding:'4px 11px',cursor:'pointer',background:moneda===mo?'#fff':'transparent',color:moneda===mo?C.accent:'rgba(255,255,255,.7)'}}>{mo}</span>)}
            </span>}
          </div>
          <div style={{fontSize:17,fontWeight:800,letterSpacing:-.3,lineHeight:1.25,margin:'9px 0 11px'}}>{(f.title||'').trim()||'Nueva venta'}</div>
          <div style={{fontSize:34,fontWeight:800,letterSpacing:-1,lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{hon}{cobroType==='mensual'&&base>0&&<span style={{fontSize:15,fontWeight:700,opacity:.75,letterSpacing:0}}> /mes</span>}</div>
          <div style={{fontSize:12,opacity:.72,fontWeight:600,marginTop:4}}>{honSub}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:12}}>
            {[f.area||'Corporativo', (f.responsible||'sin responsable'), `${f.status||'Activo'} · ${f.year||currentYear}`].map((t,i)=>(
              <span key={i} style={{fontSize:9.5,fontWeight:700,background:'rgba(255,255,255,.14)',borderRadius:20,padding:'2px 8px',whiteSpace:'nowrap'}}>{t}</span>
            ))}
          </div>
          {costHero>0&&base>0&&(
            <div style={{marginTop:13,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.18)'}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:10,fontWeight:700,opacity:.8,marginBottom:6}}><span>Margen {pct}%</span><span>Costo {100-pct}%</span></div>
              <div style={{height:9,borderRadius:5,overflow:'hidden',display:'flex',background:'rgba(255,255,255,.15)'}}><span style={{width:pct+'%',background:'#2BD49E'}}/><span style={{width:(100-pct)+'%',background:'#E8B873'}}/></div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
                <span style={{fontSize:11,opacity:.85}}>Margen<b style={{fontSize:14,fontWeight:800,display:'block',color:'#8FE3C4'}}>{fmtU(margen)}</b></span>
                <span style={{fontSize:11,opacity:.85,textAlign:'right'}}>{comR.real?'Costos de terceros':'Costo proveedores'}<b style={{fontSize:14,fontWeight:800,display:'block'}}>{fmtU(costHero)}</b></span>
              </div>
            </div>
          )}
        </div>
        )
      })()}
      {afterHero}

      {/* Escritorio: 2 columnas (izquierda=datos · derecha=dinero/cobro). En móvil estos divs apilan igual que hoy (misma estructura, sin duplicar). */}
      <div style={isDesktop&&formNuevo?{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:0,alignItems:'start'}:undefined}>
      <div style={isDesktop&&formNuevo?{paddingRight:22,borderRight:`1px solid ${C.border}`}:undefined}>
      {/* 1. Cliente — reasignable: click en "Cambiar" para mover la venta/propuesta a otro cliente */}
      {(!selectedClient || reasignCli) ? (
        <Fld label={reasignCli?<>Reasignar a otro cliente {selectedClient&&<span style={{fontWeight:400,color:C.muted}}>· hoy: {selectedClient.name}</span>}</>:'Cliente'}>
          <div style={{position:'relative'}}>
            <div style={{display:'flex',gap:6}}>
              <Inp value={clientQ} onChange={e=>setClientQ(e.target.value)} placeholder='Buscar cliente…' autoFocus style={{flex:1}}/>
              {reasignCli
                ? <button onClick={()=>{setReasignCli(false);setClientQ('')}} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>Cancelar</button>
                : <button onClick={()=>setShowNewClient(true)} style={{padding:'8px 12px',borderRadius:8,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:12,fontWeight:600,cursor:'pointer',flexShrink:0}}>+ Nuevo</button>}
            </div>
            {clientQ.trim()&&!showNewClient&&(clientMatches.length>0||!reasignCli)&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#fff',border:`1px solid ${C.border}`,borderRadius:8,boxShadow:'0 4px 20px rgba(0,0,0,.12)',zIndex:100,marginTop:4,maxHeight:200,overflowY:'auto'}}>
                {clientMatches.map(c=>(
                  <div key={c.id} onMouseDown={()=>{ const rea=reasignCli; setSelectedClient(c);up('client_id',c.id);
                    if(rea){ up('entity_id',''); setRsMode(null); setReasignCli(false) }   // al reasignar, la RS del cliente anterior deja de valer: se re-elige
                    else { if(c.abogado_responsable)up('responsible',c.abogado_responsable);
                      // Anticipa: área y formato de cobro = los más usados en las ventas pasadas de este cliente (no re-elegir lo de siempre).
                      const past=(sales||[]).filter(s=>String(s.client_id)===String(c.id)&&!['Borrador','Rechazada','Propuesta'].includes(s.status)&&!esSubarriendo(s));
                      if(past.length){ const mode=k=>{const m={};past.forEach(s=>{if(s[k])m[s[k]]=(m[s[k]]||0)+1});const e=Object.entries(m).sort((a,b)=>b[1]-a[1])[0];return e?e[0]:null}; const ar=mode('area');if(ar)up('area',ar); const co=mode('cobro_type');if(co)setCobroType(co) } }
                    setClientQ('')}}
                    style={{padding:'9px 14px',cursor:'pointer',borderBottom:`1px solid ${C.border}`,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft}
                    onMouseLeave={e=>e.currentTarget.style.background='#fff'}>
                    <div style={{fontWeight:500}}>{c.name}</div>
                    {c.rut&&<div style={{fontSize:11,color:C.muted}}>{fmtRutCL(c.rut)}</div>}
                  </div>
                ))}
                {/* Nunca perder el nombre tipeado: si no hay un cliente que calce EXACTO, ofrecer crearlo con ese nombre (abre el mini-form pre-llenado). */}
                {!reasignCli&&!clientMatches.some(c=>_normTxt(c.name)===_normTxt(clientQ))&&(
                  <div onMouseDown={()=>setShowNewClient(true)}
                    style={{padding:'10px 14px',cursor:'pointer',fontSize:13,fontWeight:600,color:C.accent,background:'#FBFCFD',borderTop:clientMatches.length?`1px solid ${C.border}`:'none'}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.bgSoft}
                    onMouseLeave={e=>e.currentTarget.style.background='#FBFCFD'}>
                    + Crear «{clientQ.trim()}» como {f.status==='Propuesta'?'prospecto':'cliente nuevo'}
                  </div>
                )}
              </div>
            )}
          </div>
          {reasignCli&&sale?.id&&<div style={{fontSize:11,color:C.coralText,marginTop:6}}>Mueve esta {f.status==='Propuesta'?'propuesta':'venta'} a otro cliente. Las facturas ya emitidas mantienen su receptor; revisa la razón social a facturar tras cambiar.</div>}
        </Fld>
      ) : (sale?.id ? null : (
        <div onClick={()=>{setReasignCli(true);setClientQ('')}} title='Cambiar cliente' style={{marginBottom:10,padding:'11px 13px',borderRadius:13,background:C.azulBg,border:`1.5px solid #CFE0EA`,display:'flex',alignItems:'center',gap:11,cursor:'pointer'}}>
          <span style={{width:34,height:34,borderRadius:10,background:C.accent,color:'#fff',fontSize:13,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{(selectedClient.name||'?').trim().slice(0,2).toUpperCase()}</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:C.accent,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedClient.name}</div>
            {selectedClient.rut&&<div style={{fontSize:11,color:C.muted}}>{fmtRutCL(selectedClient.rut)}</div>}
          </div>
          <span style={{fontSize:11.5,fontWeight:700,color:C.muted,background:'#fff',border:`1px solid ${C.border}`,borderRadius:9,padding:'6px 12px',flexShrink:0}}>Cambiar</span>
        </div>
      ))}
      {showNewClient&&<MiniClientForm defaultName={clientQ} clients={clients} defaultStatus={f.status==='Propuesta'?'Prospecto':'Activo'} onPickExisting={c=>{setSelectedClient(c);up('client_id',c.id);setShowNewClient(false);setClientQ('')}} onSave={c=>{setClients(p=>[...p,c]);setSelectedClient(c);up('client_id',c.id);setShowNewClient(false);setClientQ('')}} onCancel={()=>setShowNewClient(false)}/>}
      {showNewClient&&f.status==='Propuesta'&&<div style={{fontSize:11,color:'#7A5C00',background:'#FFFBF0',border:'1px solid #E8CC6A',borderRadius:6,padding:'5px 10px',marginTop:-8,marginBottom:8}}>Se crea como Prospecto; al activar la propuesta pasa a Activo.</div>}

      <Fld label={<>Proyecto<AiBadge field='title'/></>}><Inp value={f.title||''} onChange={e=>up('title',e.target.value)} placeholder='Ej: Reorganización societaria…'/></Fld>

      {/* 2. Razón social — 1 se asigna sola · varias propone la 1ª · siempre se puede Cambiar / agregar */}
      {f.client_id&&(
        <div style={{marginBottom:10}}>
          <Lbl>Razón social a facturar</Lbl>
          {rsMode==='new'?(
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <Inp value={newRS.name} onChange={e=>setNewRS(r=>({...r,name:e.target.value}))} placeholder='Nombre / razón social' style={{flex:'1 1 160px',marginBottom:0}}/>
              <Inp value={newRS.rut} onChange={e=>setNewRS(r=>({...r,rut:e.target.value}))} placeholder='RUT' style={{width:120,marginBottom:0}}/>
              <button type='button' disabled={savingRS||!newRS.name.trim()} onClick={agregarRS} style={{...chipBtn('primary'),opacity:(savingRS||!newRS.name.trim())?.5:1}}>{savingRS?'…':'Agregar'}</button>
              <button type='button' onClick={()=>{setRsMode(null);setNewRS({name:'',rut:''})}} style={chipBtn('soft')}>Cancelar</button>
            </div>
          ):clientEntitiesList.length===0?(
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:12,color:C.muted,flex:1}}>Sin razón social (se asocia al emitir la 1ª factura)</span>
              <button type='button' onClick={()=>setRsMode('new')} style={chipBtn('soft')}>+ Agregar</button>
            </div>
          ):rsMode==='pick'?(
            <select autoFocus value={f.entity_id||''} onChange={e=>{ if(e.target.value==='__new__'){setRsMode('new')} else {up('entity_id',e.target.value);setRsMode(null)} }} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box'}}>
              {clientEntitiesList.map(e=><option key={e.id} value={e.id}>{e.name}{e.rut?` · ${fmtRutCL(e.rut)}`:''}</option>)}
              <option value='__new__'>+ Nueva razón social…</option>
            </select>
          ):(
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,fontWeight:500,color:C.text,flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{(()=>{const e=clientEntitiesList.find(x=>String(x.id)===String(f.entity_id));return e?`${e.name}${e.rut?' · '+e.rut:''}`:'— Elegir —'})()}{clientEntitiesList.length>1&&<span style={{fontSize:11,fontWeight:400,color:C.muted}}> · propuesta</span>}</span>
              <button type='button' onClick={()=>setRsMode('pick')} style={chipBtn('soft')}>Cambiar</button>
            </div>
          )}
        </div>
      )}

      {/* 3-4. Clasificación (accordion colapsable): Área/Responsable + Estado/Año/Mes */}
      {(()=>{ const open=!!openSec.clasif; return (
      <div style={{border:`1px solid ${C.border}`,borderRadius:10,marginBottom:10,overflow:'hidden'}}>
        <div onClick={()=>setOpenSec(p=>({...p,clasif:!p.clasif}))} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer'}}>
          <span style={{width:22,height:22,borderRadius:6,background:C.bgSoft,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'><path d='M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'/></svg></span>
          <span style={{fontSize:12,fontWeight:700,color:C.accent,flex:1}}>Clasificación</span>
          {!open&&<span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'46%'}}>{f.area||'Corporativo'} · {f.responsible||'sin resp.'} · {f.year||currentYear}</span>}
          <span style={{color:C.textSoft,fontSize:12,flexShrink:0}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
        </div>
        {open&&<div style={{padding:'0 12px 12px',borderTop:`1px solid ${C.bgSoft}`}}>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10,margin:'10px 0'}}>
            <Fld label={<>Área<AiBadge field='area'/></>}><Sel value={f.area||'Corporativo'} onChange={e=>up('area',e.target.value)} options={['Corporativo','Tributario','Laboral','Otro']}/></Fld>
            {(()=>{ const faltaResp = f.area!=='Subarriendo' && !String(f.responsible||'').trim(); return (
            <Fld label={<>Responsable <span style={{color:C.overdue}}>*</span><AiBadge field='responsible'/></>}>
              <select value={f.responsible||''} onChange={e=>up('responsible',e.target.value)} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${faltaResp?C.overdue:C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box'}}>
                <option value=''>— Seleccionar —</option>
                {WHO_LIST.map(w=><option key={w} value={w}>{w}</option>)}
              </select>
            </Fld>
            )})()}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)',gap:10}}>
            <Fld label='Estado'><Sel value={f.status||'Activo'} onChange={e=>up('status',e.target.value)} options={['Activo','Propuesta','Borrador','Rechazada','Terminado','Pausado']}/></Fld>
            <Fld label='Año'><Inp type='number' value={f.year||currentYear} onChange={e=>up('year',parseInt(e.target.value))} placeholder={String(currentYear)}/></Fld>
            <Fld label='Mes'>
              <select value={f.month||currentMonth} onChange={e=>up('month',parseInt(e.target.value))} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bgSoft,color:C.text,fontSize:14,boxSizing:'border-box'}}>
                {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </Fld>
          </div>
        </div>}
      </div>
      )})()}

      </div>
      <div style={isDesktop&&formNuevo?{paddingLeft:22}:undefined}>
      {/* 5–8. Honorarios + costos en una línea (toggle UF/CLP compartido), cobro, notas — editable en venta nueva y en propuesta/borrador */}
      {formNuevo&&cobroType!=='hora'&&(<>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
          <div style={{...SEC_LBL}}>Honorarios y costos<AiBadge field='amount_uf'/><AiBadge field='amount_clp'/></div>
          <div style={{display:'flex',background:'#fff',border:`1px solid ${C.border}`,borderRadius:6,overflow:'hidden'}}>
            {['UF','CLP'].map(mo=>(
              <button key={mo} type='button' onClick={()=>up('moneda',mo)} style={{padding:'3px 11px',border:'none',background:moneda===mo?C.accent:'transparent',color:moneda===mo?'#fff':C.muted,fontSize:11,fontWeight:700,cursor:'pointer',letterSpacing:.3}}>{mo}</button>
            ))}
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10,marginBottom:costVal>0?12:14}}>
          <div style={{minWidth:0}}>
            <div style={{height:22,display:'flex',alignItems:'center',marginBottom:6}}><span style={{fontSize:10.5,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3}}>Honorario</span></div>
            <div style={{display:'flex',alignItems:'center',height:46,border:`1.5px solid ${C.border}`,borderRadius:12,background:C.bgSoft,padding:'0 12px',boxSizing:'border-box'}}>
              {moneda!=='UF'&&<span style={{fontSize:14,fontWeight:700,color:C.textSoft,marginRight:6}}>$</span>}
              <input type='number' step={moneda==='UF'?'0.01':'1'} value={moneda==='UF'?f.amount_uf||'':f.amount_clp||''} onChange={e=>up(moneda==='UF'?'amount_uf':'amount_clp',e.target.value)} placeholder={moneda==='UF'?'0,00':'0'} style={{flex:1,minWidth:0,border:'none',background:'transparent',outline:'none',fontSize:18,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums',padding:0}}/>
              {moneda==='UF'&&<span style={{fontSize:13,fontWeight:700,color:C.textSoft,marginLeft:6}}>UF</span>}
            </div>
            {moneda==='UF'&&<div style={{display:'flex',alignItems:'center',gap:3,marginTop:5}}><span style={{fontSize:10,color:C.textSoft}}>UF día $</span><input type='number' value={f.uf_value||''} onChange={e=>up('uf_value',e.target.value)} placeholder={ufHoy?String(Math.round(ufHoy)):'—'} style={{width:62,border:'none',background:'transparent',fontSize:11,color:C.muted,outline:'none',padding:0}}/></div>}
          </div>
          <div style={{minWidth:0}}>
            <div style={{height:22,display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,gap:6}}>
              <span style={{fontSize:10.5,fontWeight:700,color:C.textSoft,textTransform:'uppercase',letterSpacing:.3,whiteSpace:'nowrap'}}>Costo prov.</span>
              <span style={{display:'inline-flex',background:'#EAEEF0',borderRadius:7,padding:2}}>
                {[['fijo',moneda==='UF'?'UF':'$'],['pct','%']].map(([v,l])=>(<button key={v} type='button' onClick={()=>setCostMode(v)} style={{padding:'2px 8px',border:'none',borderRadius:5,background:costMode===v?C.accent:'transparent',color:costMode===v?'#fff':C.muted,fontSize:10,fontWeight:700,cursor:'pointer'}}>{l}</button>))}
              </span>
            </div>
            <div style={{display:'flex',alignItems:'center',height:46,border:`1.5px solid ${C.border}`,borderRadius:12,background:C.bgSoft,padding:'0 12px',boxSizing:'border-box'}}>
              {costMode!=='pct'&&moneda!=='UF'&&<span style={{fontSize:14,fontWeight:700,color:C.textSoft,marginRight:6}}>$</span>}
              <input type='number' step={costMode==='pct'?'0.1':'0.01'} value={costMode==='pct'?costPct:(moneda==='UF'?f.cost_uf||'':f.cost_clp||'')} onChange={e=>{ if(costMode==='pct') setCostPct(e.target.value); else up(moneda==='UF'?'cost_uf':'cost_clp',e.target.value) }} placeholder='0' style={{flex:1,minWidth:0,border:'none',background:'transparent',outline:'none',fontSize:16,fontWeight:600,color:C.text,fontVariantNumeric:'tabular-nums',padding:0}}/>
              {costMode==='pct'&&<span style={{fontSize:13,fontWeight:700,color:C.textSoft,marginLeft:6}}>%</span>}
              {costMode!=='pct'&&moneda==='UF'&&<span style={{fontSize:13,fontWeight:700,color:C.textSoft,marginLeft:6}}>UF</span>}
            </div>
            {costMode==='pct'&&costVal>0&&<div style={{fontSize:10,color:C.textSoft,marginTop:5}}>= {moneda==='UF'?fmtUF(costVal):fmt(Math.round(costVal))}</div>}
          </div>
        </div>
        {costVal>0&&<RepartoTerceros proveedores={proveedores} rows={reparto} setRows={setReparto} moneda={moneda} ufVal={ufVal} saleTotal={moneda==='UF'?amountUF:montoCLP} costTotal={costVal}/>}
        <div onClick={()=>setCobroType('hora')} style={{fontSize:11,fontWeight:600,color:C.accent,cursor:'pointer',marginTop:2,marginBottom:8}}>¿Cobro por hora? Sin monto fijo →</div>
      </>)}

      {/* 7. Forma de cobro — venta nueva y propuesta/borrador. Por hora: sin presupuesto, se elige aunque no haya honorarios. */}
      {formNuevo&&(totalCLP>0||cobroType==='hora')&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:800,color:C.muted,textTransform:'uppercase',letterSpacing:.5,marginBottom:8,display:'flex',alignItems:'center',gap:7}}><svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke={C.done} strokeWidth='2'><rect x='2' y='5' width='20' height='14' rx='2'/><path d='M2 10h20'/></svg>Forma de cobro</div>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:8,marginBottom:12}}>
            {[['cuotas','Cuotas mensuales','monto fijo en N pagos'],['mensual','Mensual recurrente','sin fecha de término'],['porcentaje','Por porcentaje','% de éxito'],['personalizada','Personalizada','cuotas a medida'],['hora','Por hora','sin monto fijo · según horas']].map(([v,l,d])=>{ const on=cobroType===v; const wide=v==='hora'; return (
              <button key={v} type='button' onClick={()=>setCobroType(v)} style={{gridColumn:wide?'1 / -1':'auto',display:'flex',alignItems:'center',gap:9,padding:'10px 11px',borderRadius:12,border:`1.5px solid ${on?C.accent:C.border}`,background:on?C.azulBg:'#fff',cursor:'pointer',textAlign:'left'}}>
                <span style={{width:28,height:28,borderRadius:8,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:on?C.accent:C.bgSoft,color:on?'#fff':C.muted}}>{COBRO_IC[v]}</span>
                <span style={{minWidth:0}}><span style={{display:'block',fontSize:12,fontWeight:700,color:on?C.accent:C.text,lineHeight:1.15}}>{l}</span><span style={{display:'block',fontSize:9.5,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d}</span></span>
              </button>) })}
          </div>
          {cobroType==='mensual'&&(
            <div style={{background:'#fff',border:`1px solid `,borderRadius:14,padding:'13px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10,marginBottom:8}}>
                {moneda==='UF'
                  ? <Fld label='Monto mensual UF'><Inp type='number' step='0.01' value={f.amount_uf||''} onChange={e=>up('amount_uf',e.target.value)} placeholder='0.00'/></Fld>
                  : <Fld label='Monto mensual (CLP)'><Inp type='number' value={f.amount_clp||''} onChange={e=>up('amount_clp',e.target.value)} placeholder='Ej: 1500000'/></Fld>}
                <Fld label='Inicio cobro'><Inp type='date' value={mensualInicio} onChange={e=>setMensualInicio(e.target.value)}/></Fld>
              </div>
              {mensualInicio&&totalCLP>0&&<div style={{fontSize:11,color:C.muted}}>Genera <strong style={{color:C.text}}>12 cobros</strong> de <strong style={{color:C.text}}>{fmt(Math.round(totalCLP))}</strong>/mes desde {mensualInicio.slice(0,7)}</div>}
              {(()=>{ const ym=f.year&&f.month?`${f.year}-${String(f.month).padStart(2,'0')}`:''; if(!mensualInicio||!ym||mensualInicio.slice(0,7)===ym) return null; return (
                <div style={{fontSize:11,color:C.soonText,background:C.soonBg,border:'1px solid #FAC775',borderRadius:8,padding:'7px 10px',marginTop:8,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span>El inicio mensual ({mensualInicio.slice(0,7)}) no coincide con el Año/Mes de la venta ({ym}).</span>
                  <button type='button' onClick={()=>setMensualInicio(`${ym}-01`)} style={{...chipBtn('soft'),height:22}}>Usar {ym}</button>
                </div>
              )})()}
            </div>
          )}
          {cobroType==='hora'&&(
            <div style={{background:'#fff',border:`1px solid `,borderRadius:14,padding:'13px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10}}>
                <Fld label='Tarifa (UF/hora)'><Inp type='number' step='0.1' value={tarifaHoraUF} onChange={e=>setTarifaHoraUF(e.target.value)} placeholder='3.0 (oficina)'/></Fld>
                <Fld label='Tope de horas'><Inp type='number' value={topeHoras} onChange={e=>setTopeHoras(e.target.value)} placeholder='Ej: 20'/></Fld>
              </div>
              <div style={{display:'flex',gap:6,marginTop:8}}>
                {[['mes','Tope por mes'],['total','Total del proyecto']].map(([v,l])=>(
                  <button key={v} type='button' onClick={()=>setTopePeriodo(v)} style={{flex:1,padding:'7px',borderRadius:8,border:`1.5px solid ${topePeriodo===v?C.accent:C.border}`,background:topePeriodo===v?C.azulBg:'#fff',color:topePeriodo===v?C.accent:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{l}</button>
                ))}
              </div>
              <div style={{fontSize:11,color:C.greenText,background:C.greenBg,borderRadius:8,padding:'8px 10px',marginTop:9,lineHeight:1.45}}>No genera cuotas programadas — se factura por las horas cargadas a esta venta. Tarifa vacía usa la de la oficina (3 UF/h).</div>
            </div>
          )}
          {cobroType==='cuotas'&&(
            <div style={{background:'#fff',border:`1px solid `,borderRadius:14,padding:'13px 14px'}}>
              <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:10,marginBottom:8}}>
                <Fld label='N° cuotas'><Inp type='number' min='1' max='60' value={nCuotas} onChange={e=>setNCuotas(Math.max(1,parseInt(e.target.value)||1))}/></Fld>
                <Fld label='Inicio cobro'><Inp type='date' value={cobroInicio} onChange={e=>setCobroInicio(anio4ISO(e.target.value))}/></Fld>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderTop:`1px solid ${C.border}`}}>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>Una cuota distinta</span>
                <Switch on={cuotaDist} onToggle={()=>setCuotaDist(v=>!v)}/>
              </div>
              {cuotaDist&&(
                <div style={{background:'#fff',borderRadius:8,padding:'10px 12px',border:`1px solid ${C.border}`,marginBottom:8}}>
                  <div style={{display:'flex',gap:6,marginBottom:8}}>
                    {[['primera','Primera'],['ultima','Última']].map(([v,l])=>(
                      <button key={v} type='button' onClick={()=>setCuotaDistPos(v)} style={{flex:1,padding:6,borderRadius:8,border:`1.5px solid ${cuotaDistPos===v?C.accent:C.border}`,background:cuotaDistPos===v?C.azulBg:'transparent',color:cuotaDistPos===v?C.accent:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{l}</button>
                    ))}
                  </div>
                  <Fld label={`Monto de la ${cuotaDistPos==='primera'?'primera':'última'} (${moneda})`}><Inp type='number' step={moneda==='UF'?'0.01':'1'} value={cuotaDistMonto} onChange={e=>setCuotaDistMonto(e.target.value)} placeholder={moneda==='UF'?'0.00':'0'}/></Fld>
                </div>
              )}
              {cobroInicio&&!cuotaDist&&<div style={{fontSize:11,color:C.muted}}>Cuota mensual: <strong style={{color:C.text}}>{fmt(Math.round(totalCLP/nCuotas))}</strong> · Total: {fmt(totalCLP)}</div>}
              {cobroInicio&&cuotaDist&&(()=>{ const arr=calcCuotasDist(); if(!arr.length) return null; const recs=arr.filter(c=>!c.d); const D=arr.find(c=>c.d); const u=v=>moneda==='UF'?`UF ${(+v.toFixed(2))}`:fmt(Math.round(v)); const recGroups={}; recs.forEach(c=>{const k=(+c.m.toFixed(2));recGroups[k]=(recGroups[k]||0)+1}); const recTxt=Object.entries(recGroups).map(([m,n])=>`${n} de ${u(parseFloat(m))}`).join(' + '); return (
                <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}><strong style={{color:C.text}}>{arr.length} cuotas</strong> · {cuotaDistPos==='primera'?`1 de ${u(D.m)} + ${recTxt}`:`${recTxt} + 1 de ${u(D.m)}`} · Total {fmt(totalCLP)}</div>
              )})()}
            </div>
          )}
          {cobroType==='porcentaje'&&(
            <div style={{background:'#fff',border:`1px solid `,borderRadius:14,padding:'13px 14px'}}>
              {tramos.map((t,i)=>(
                <div key={t.id} style={{display:'grid',gridTemplateColumns:'60px 1fr 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'%':''}><Inp type='number' min='0' max='100' value={t.pct} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,pct:parseInt(e.target.value)||0}:x))}/></Fld>
                  <Fld label={i===0?'Fecha':''}><Inp type='date' value={t.fecha} onChange={e=>setTramos(p=>p.map(x=>x.id===t.id?{...x,fecha:anio4ISO(e.target.value)}:x))}/></Fld>
                  {tramos.length>2&&<button onClick={()=>setTramos(p=>p.filter(x=>x.id!==t.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}><Gl n='x'/></button>}
                </div>
              ))}
              <button onClick={()=>setTramos(p=>[...p,{id:Date.now(),pct:0,fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar tramo</button>
              <div style={{fontSize:11,color:tramos.reduce((a,t)=>a+t.pct,0)!==100?C.overdue:C.normal,marginTop:4}}>Total: {tramos.reduce((a,t)=>a+t.pct,0)}% {tramos.reduce((a,t)=>a+t.pct,0)!==100?'(debe sumar 100%)':''}</div>
            </div>
          )}
          {cobroType==='personalizada'&&(
            <div style={{background:'#fff',border:`1px solid `,borderRadius:14,padding:'13px 14px'}}>
              {cuotasCustom.map((c,i)=>(
                <div key={c.id} style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) 32px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                  <Fld label={i===0?'Monto':''}>
                    <Inp type='number' step={moneda==='UF'?'0.01':'1'} value={c.monto} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,monto:e.target.value}:x))} placeholder={moneda==='UF'?'0.00':'0'}/>
                  </Fld>
                  <Fld label={i===0?'Fecha':''}>
                    <div>
                      <Inp type='date' value={c.fecha} onChange={e=>setCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,fecha:anio4ISO(e.target.value)}:x))}/>
                      {moneda==='UF'&&c.monto&&ufVal>0&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmt(Math.round(parseFloat(c.monto)*ufVal))}</div>}
                    </div>
                  </Fld>
                  {cuotasCustom.length>1&&<button onClick={()=>setCuotasCustom(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}><Gl n='x'/></button>}
                </div>
              ))}
              <button onClick={()=>setCuotasCustom(p=>[...p,{id:Date.now(),monto:'',fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar cuota</button>
              {cuotasCustom.some(c=>c.monto)&&(
                <div style={{fontSize:11,color:C.muted,marginTop:6}}>
                  {moneda==='UF'
                    ? <>Total: <strong style={{color:C.text}}>{fmtUF(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0))}</strong> = {fmt(Math.round(cuotasCustom.reduce((a,c)=>a+(parseFloat(c.monto)||0),0)*ufVal))}</>
                    : <>Total: <strong style={{color:C.text}}>{fmt(cuotasCustom.reduce((a,c)=>a+Math.round(parseFloat(c.monto)||0),0))}</strong></>
                  }
                </div>
              )}
            </div>
          )}
          {cobros.length>0&&(()=>{ const av=_activandoPropuesta||propBorr; return (
            <div style={{marginTop:9,borderRadius:10,padding:'9px 11px',background:av?C.soonBg:C.azulBg,border:`1px solid ${av?'#EBD9AE':C.border}`}}>
              {av&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:700,color:C.soonText,marginBottom:6}}><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke={C.soonText} strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'/><line x1='12' y1='9' x2='12' y2='13'/><line x1='12' y1='17' x2='12.01' y2='17'/></svg>Se programará la facturación · revisa antes de guardar</div>}
              <div style={{display:'flex',flexDirection:'column',gap:3}}>
                {cobros.slice(0,6).map((c,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:11,color:av?C.soonText:C.accent}}><span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.label} · {fmtFechaDMY(c.fecha)}</span><span style={{fontWeight:700,whiteSpace:'nowrap',marginLeft:8}}>{fmt(c.monto)}</span></div>)}
                {cobros.length>6&&<div style={{fontSize:10,color:C.textSoft}}>+ {cobros.length-6} cuota{cobros.length-6!==1?'s':''} más</div>}
              </div>
              <div style={{fontSize:10,color:av?C.soonText:C.done,marginTop:6}}>Se {av?'reprograman':'crean'} {cobros.length} cuota{cobros.length!==1?'s':''} programada{cobros.length!==1?'s':''}. Las emitidas/pagadas no se tocan.</div>
            </div>
          ) })()}
        </div>
      )}

      </div>
      </div>
      {/* 8. Notas — solo nueva venta */}
      {formNuevo&&(()=>{ const open=!!openSec.notas; return (
      <div style={{border:`1px solid ${C.border}`,borderRadius:10,marginBottom:10,overflow:'hidden'}}>
        <div onClick={()=>setOpenSec(p=>({...p,notas:!p.notas}))} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',cursor:'pointer'}}>
          <span style={{width:22,height:22,borderRadius:6,background:C.bgSoft,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke={C.muted} strokeWidth='1.9' strokeLinecap='round' strokeLinejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><line x1='8' y1='13' x2='16' y2='13'/></svg></span>
          <span style={{fontSize:12,fontWeight:700,color:C.accent,flex:1}}>Notas<AiBadge field='notes'/></span>
          {!open&&f.notes&&<span style={{fontSize:10,color:C.textSoft,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'50%'}}>{f.notes}</span>}
          <span style={{color:C.textSoft,fontSize:12,flexShrink:0}}>{open?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
        </div>
        {open&&<div style={{padding:'10px 12px',borderTop:`1px solid ${C.bgSoft}`}}><Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/></div>}
      </div>
      )})()}

      {/* 9. CONDICIONES REGISTRADAS — solo venta activa guardada (en propuesta/borrador se edita con el form completo) */}
      {sale?.id&&!propBorr&&(()=>{
        const COBRO_LBL = {cuotas:'Cuotas mensuales',mensual:'Mensual recurrente',porcentaje:'Por porcentaje',personalizada:'Personalizada',hora:'Por hora'}
        const curHon = moneda==='UF' ? (amountUF>0?fmtUF(amountUF):'—') : (montoCLP>0?fmt(montoCLP):'—')
        const curCost = moneda==='UF' ? (parseFloat(f.cost_uf)>0?fmtUF(parseFloat(f.cost_uf)):(costMode==='pct'&&parseFloat(costPct)>0?`${costPct}%`:'—')) : (parseFloat(f.cost_clp)>0?fmt(parseFloat(f.cost_clp)):(costMode==='pct'&&parseFloat(costPct)>0?`${costPct}%`:'—'))
        const curCobro = COBRO_LBL[cobroType]||'—'
        const notasPrev = f.notes ? (f.notes.length>48?f.notes.slice(0,48)+'…':f.notes) : '—'
        const titP = p => (p?.nombre?.trim()||p?.razon_social?.trim()||'Proveedor')
        const provIds = [...new Set((reparto||[]).map(r=>r.proveedor_id).filter(Boolean))]
        const provNames = provIds.map(id=>titP(proveedores.find(p=>String(p.id)===String(id))))
        const provLabel = provNames.length===0?'':provNames.length===1?provNames[0]:`${provNames.length} proveedores`
        const addReparto = ()=>{ const esUF=moneda!=='CLP'; setReparto([...(reparto||[]),{proveedor_id:'',tipo:esUF?'uf':'clp',valor: costVal>0?String(esUF?+costVal.toFixed(2):Math.round(costVal)):'',_edit:false}]); setOpenCondicion('costos') }
        const row = (lbl,val,key,isLast) => (
          <div key={key} onClick={()=>setOpenCondicion(openCondicion===key?null:key)}
            style={{display:'flex',alignItems:'center',padding:'10px 12px',borderBottom:isLast?'none':`1px solid ${C.border}`,cursor:'pointer',userSelect:'none'}}>
            <div style={{fontSize:12,color:C.muted,width:118,flexShrink:0}}>{lbl}</div>
            <div style={{flex:1,fontSize:13,fontWeight:500,color:val==='—'?C.muted:C.text,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{val}</div>
            <span style={{fontSize:16,color:C.muted,flexShrink:0,marginLeft:6,transform:openCondicion===key?'rotate(90deg)':'rotate(0)',transition:'transform .15s'}}><Gl n='chevron'/></span>
          </div>
        )
        return (
          <>
            <div style={{...SEC_LBL,marginTop:8,marginBottom:6}}>Condiciones registradas</div>
            <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
              {row('Honorarios',curHon,'honorarios',false)}
              {openCondicion==='honorarios'&&(
                <div style={{padding:'10px 12px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Honorario</span><span style={{fontWeight:500,color:C.text}}>{curHon}</span></div>
                  {curCost!=='—'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Costo</span><span style={{fontWeight:500,color:C.text}}>{curCost}</span></div>}
                  <button type='button' onClick={()=>{ setModCobro(true); setModMode('ajustar'); setOpenCondicion(null) }} style={{...chipBtn('soft'),marginTop:8}}>Ajustar honorario</button>
                </div>
              )}
              <div onClick={()=>setOpenCondicion(openCondicion==='costos'?null:'costos')} style={{display:'flex',alignItems:'center',padding:'10px 12px',borderBottom:`1px solid ${C.border}`,cursor:'pointer',userSelect:'none'}}>
                <div style={{fontSize:12,color:C.muted,width:118,flexShrink:0}}>Costos de proveedores</div>
                <div style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:13,fontWeight:500,color:curCost==='—'?C.muted:C.text,flexShrink:0}}>{curCost}</span>
                  {provLabel
                    ? <span style={{fontSize:12,color:C.muted,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>· {provLabel}</span>
                    : (costVal>0&&openCondicion!=='costos')&&<button onClick={e=>{e.stopPropagation();addReparto()}} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:20,padding:'3px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>+ Agregar proveedor</button>}
                </div>
                <span style={{fontSize:16,color:C.muted,flexShrink:0,marginLeft:6,transform:openCondicion==='costos'?'rotate(90deg)':'rotate(0)',transition:'transform .15s'}}><Gl n='chevron'/></span>
              </div>
              {openCondicion==='costos'&&(
                <div style={{padding:'10px 12px 12px',borderTop:`1px solid ${C.border}`}}>
                  <RepartoTerceros proveedores={proveedores} rows={reparto} setRows={setReparto} moneda={moneda} ufVal={ufVal} saleTotal={moneda==='UF'?amountUF:montoCLP} costTotal={costVal} hideHeader/>
                </div>
              )}
              {row('Forma de cobro',curCobro,'cobro',false)}
              {openCondicion==='cobro'&&(()=>{
                const mesLbl = iso => { if(!iso) return '—'; const p=String(iso).slice(0,7).split('-'); return p.length===2?`${MONTHS[parseInt(p[1])-1]||p[1]} ${p[0]}`:String(iso) }
                return (
                <div style={{padding:'10px 12px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft}}>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Forma</span><span style={{fontWeight:500,color:C.text}}>{curCobro}</span></div>
                  {cobroType==='mensual'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Inicio mensual</span><span style={{fontWeight:500,color:C.text}}>{mesLbl(mensualInicio)} · 12 meses</span></div>}
                  {cobroType==='cuotas'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Cuotas</span><span style={{fontWeight:500,color:C.text}}>{nCuotas} desde {mesLbl(cobroInicio)}</span></div>}
                  {cobroType==='hora'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0'}}><span style={{color:C.muted}}>Por hora</span><span style={{fontWeight:500,color:C.text}}>{(parseFloat(String(tarifaHoraUF).replace(',','.'))||3)} UF/h · tope {topeHoras||'—'} h/{topePeriodo==='total'?'total':'mes'}</span></div>}
                  <div style={{fontSize:11,color:C.muted,marginTop:6,lineHeight:1.4}}>Para cambiar el formato o el inicio se regeneran las cuotas programadas (las emitidas/pagadas no se tocan).</div>
                  <button type='button' onClick={()=>{ setModCobro(true); setModMode('cambiar'); setOpenCondicion(null) }} style={{...chipBtn('soft'),marginTop:8}}>Cambiar forma de cobro</button>
                </div>
                )
              })()}
              {(()=>{
                const prog=(billing||[]).filter(b=>String(b.sale_id)===String(sale.id)&&b.status==='Programada'&&!b.deleted_at).sort((a,b)=>(a.due||'')>(b.due||'')?1:-1)
                const paus=(billing||[]).filter(b=>String(b.sale_id)===String(sale.id)&&b.status==='Pausada'&&!b.deleted_at).sort((a,b)=>(a.due||'')>(b.due||'')?1:-1)
                if(prog.length===0 && paus.length===0) return null
                const cuotaLbl = b => (b.concept&&b.concept.includes('—')) ? (b.concept.split('—').pop()||'').trim() : (b.due||'')
                const mesCuota = ym => { if(!ym) return ''; const [yy,mm]=ym.split('-'); return `${MONTHS[(+mm)-1]||''} ${yy}` }
                const primerMes = prog[0] ? (prog[0].due||'').slice(0,7) : ''
                // Mover inicio: corre TODAS las programadas por el mismo delta de meses (preserva montos y espaciado). Las emitidas/pagadas no entran (prog ya es solo 'Programada').
                const moverInicio = async(nuevoYM) => {
                  if(!nuevoYM || !primerMes || !prog.length) return
                  const [oy,om]=primerMes.split('-').map(Number); const [ny,nm]=nuevoYM.split('-').map(Number)
                  const delta=(ny-oy)*12+(nm-om); if(delta===0){ setMoverYM(''); return }
                  const ok=await appConfirm(`Mover ${prog.length} cuota${prog.length!==1?'s':''} ${delta>0?'+':''}${delta} mes${Math.abs(delta)!==1?'es':''}. Se corren todas juntas; montos y espaciado no cambian. Las emitidas no se tocan. ¿Continuar?`)
                  if(!ok) return
                  const shift=due=>{ const [yy,mm]=(due||'').slice(0,7).split('-').map(Number); let cy=yy,cm=mm+delta; while(cm>12){cm-=12;cy++} while(cm<1){cm+=12;cy--} return `${cy}-${String(cm).padStart(2,'0')}-01` }
                  await onUpdateCuotas?.(prog.map(b=>({id:b.id,due:shift(b.due)}))); setMoverYM('')
                }
                // Pausar: la cuota elegida y TODAS las siguientes (por fecha) pasan a 'Pausada' → salen de proyección/checklist/export solas (esos filtran por 'Programada').
                const pausarDesde = async() => {
                  const from = prog.find(x=>String(x.id)===String(pausFromId)) || prog[0]
                  if(!from) return
                  const idx = prog.findIndex(x=>x.id===from.id); const afectadas = prog.slice(idx)
                  const ok = await appConfirm(`Pausar ${afectadas.length} cuota${afectadas.length!==1?'s':''} desde ${cuotaLbl(from)}. Salen de la proyección, el checklist y el export hasta reactivar. ¿Continuar?`)
                  if(!ok) return
                  await onUpdateCuotas?.(afectadas.map(x=>({id:x.id,status:'Pausada'}))); setPausFromId('')
                }
                // Reactivar: reanuda desde la cuota elegida, re-anclando su devengo al mes elegido y corriendo las siguientes mes a mes. Vuelven a 'Programada'.
                const reactivar = async() => {
                  if(!reactMonth) return
                  const from = paus.find(x=>String(x.id)===String(reactFromId)) || paus[0]
                  const idx = paus.findIndex(x=>x.id===from.id); const afectadas = paus.slice(idx)
                  const [yy,mm]=reactMonth.split('-').map(Number)
                  const ups = afectadas.map((x,i)=>{ let cy=yy,cm=mm+i; while(cm>12){cm-=12;cy++} return {id:x.id,due:`${cy}-${String(cm).padStart(2,'0')}-01`,status:'Programada'} })
                  await onUpdateCuotas?.(ups); setReactOpen(false); setReactFromId(''); setReactMonth('')
                }
                const uf = parseFloat(f.uf_value)||ufVal||0
                const esUF = cuotaUnit==='UF' && uf>0
                // amount de edición se guarda en la unidad cuotaUnit; a CLP para comparar/persistir.
                const toCLP = v => esUF ? Math.round((parseFloat(v)||0)*uf) : Math.round(parseFloat(v)||0)
                const fromCLP = clp => esUF ? +((clp||0)/uf).toFixed(2) : Math.round(clp||0)
                const cambios=Object.keys(cuotaEdits).some(id=>{ const b=prog.find(x=>String(x.id)===String(id)); if(!b) return false; const e=cuotaEdits[id]; return (e.due!==undefined&&e.due!==(b.due||''))||(e.amount!==undefined&&toCLP(e.amount)!==Math.round(b.amount||0)) })
                const toggleUnit=()=>{ const nu=cuotaUnit==='UF'?'CLP':'UF'; const ok=nu!=='UF'||uf>0; if(!ok) return; setCuotaEdits(p=>{ const n={}; for(const id in p){ const e=p[id]; n[id]={...e}; if(e.amount!==undefined){ const clp = esUF?Math.round((parseFloat(e.amount)||0)*uf):Math.round(parseFloat(e.amount)||0); n[id].amount = nu==='UF'&&uf>0 ? +(clp/uf).toFixed(2) : clp } } return n }); setCuotaUnit(nu) }
                const guardar=async()=>{
                  const ups=Object.entries(cuotaEdits).map(([id,e])=>{ const b=prog.find(x=>String(x.id)===String(id)); if(!b) return null; const due=e.due!==undefined?e.due:b.due; const amount=e.amount!==undefined?toCLP(e.amount):b.amount; if(due===b.due&&amount===Math.round(b.amount||0)) return null; return {id:b.id,due,amount} }).filter(Boolean)
                  if(!ups.length) return
                  setSavingCuotas(true); await onUpdateCuotas?.(ups); setCuotaEdits({}); setSavingCuotas(false)
                }
                return (<>
                  {row('Cuotas programadas',`${prog.length} pendiente${prog.length!==1?'s':''}${paus.length?` · ${paus.length} pausada${paus.length!==1?'s':''}`:''}`,'cuotasprog',false)}
                  {openCondicion==='cuotasprog'&&(
                    <div style={{padding:'10px 12px 12px',borderTop:`1px solid ${C.border}`,background:C.bgSoft}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:8}}>
                        <span style={{fontSize:11,color:C.muted,lineHeight:1.4,flex:1}}>Ajusta fecha o monto sin rehacer todo. Las emitidas/pagadas no aparecen.</span>
                        {uf>0&&<div style={{display:'flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>{['UF','CLP'].map(u=>(<button key={u} type='button' onClick={()=>{ if(u!==cuotaUnit) toggleUnit() }} style={{padding:'4px 10px',border:'none',background:cuotaUnit===u?C.accent:'#fff',color:cuotaUnit===u?'#fff':C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{u}</button>))}</div>}
                      </div>
                      {prog.length>0&&(
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:10,paddingBottom:10,borderBottom:`1px solid ${C.border}`}}>
                          <span style={{fontSize:11,color:C.muted,whiteSpace:'nowrap'}}>Mover inicio a</span>
                          <input type='month' value={moverYM||primerMes} onChange={e=>setMoverYM(e.target.value)} style={{fontSize:13,padding:'7px 8px',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',color:C.text}}/>
                          <button type='button' onClick={()=>moverInicio(moverYM||primerMes)} style={chipBtn('primary')}>Correr todas</button>
                        </div>
                      )}
                      {prog.map(b=>{ const e=cuotaEdits[b.id]||{}; const due=e.due!==undefined?e.due:(b.due||''); const amount=e.amount!==undefined?e.amount:fromCLP(b.amount||0); return (
                        <div key={b.id} style={{display:'grid',gridTemplateColumns:'1.1fr 1fr',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                          <Fld label={b.concept&&b.concept.includes('Cuota')?(b.concept.split('—').pop()||'').trim():'Vence'}><Inp type='date' value={due} onChange={ev=>setCuotaEdits(p=>({...p,[b.id]:{...p[b.id],due:ev.target.value}}))}/></Fld>
                          <Fld label={`Monto (${cuotaUnit})`}>
                            <Inp type='number' step={esUF?'0.01':'1'} value={amount} onChange={ev=>setCuotaEdits(p=>({...p,[b.id]:{...p[b.id],amount:ev.target.value}}))}/>
                            {esUF&&<div style={{fontSize:10,color:C.muted,marginTop:2}}>{fmt(toCLP(amount))}</div>}
                          </Fld>
                        </div>
                      )})}
                      {cambios&&<button type='button' onClick={guardar} disabled={savingCuotas} style={{...chipBtn('soft'),marginTop:2,opacity:savingCuotas?.6:1}}>{savingCuotas?'Guardando…':'Guardar cambios'}</button>}
                      {prog.length>0&&(
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                          <span style={{fontSize:11,color:C.muted}}>Pausar desde</span>
                          <select value={pausFromId||(prog[0]?.id||'')} onChange={e=>setPausFromId(e.target.value)} style={{fontSize:12,padding:'6px 8px',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',color:C.text}}>{prog.map(b=><option key={b.id} value={b.id}>{cuotaLbl(b)} · {mesCuota((b.due||'').slice(0,7))}</option>)}</select>
                          <button type='button' onClick={pausarDesde} style={chipBtn('soft')}>Pausar</button>
                        </div>
                      )}
                      {paus.length>0&&(
                        <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                          <div style={{fontSize:11,fontWeight:700,color:C.soonText,marginBottom:6}}>Pausadas · {paus.length}</div>
                          {paus.map(b=>(<div key={b.id} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.muted,padding:'2px 0'}}><span>{cuotaLbl(b)} · {mesCuota((b.due||'').slice(0,7))}</span><span>{fmt(b.amount||0)}</span></div>))}
                          {!reactOpen
                            ? <button type='button' onClick={()=>{setReactOpen(true);setReactFromId(paus[0]?.id||'');setReactMonth('')}} style={{...chipBtn('soft'),marginTop:8}}>Reactivar…</button>
                            : (<div style={{marginTop:8,display:'flex',flexDirection:'column',gap:8}}>
                                <Fld label='Reanudar desde'><select value={reactFromId||(paus[0]?.id||'')} onChange={e=>setReactFromId(e.target.value)} style={{width:'100%',fontSize:13,padding:'8px',border:`1px solid ${C.border}`,borderRadius:8,background:'#fff',color:C.text}}>{paus.map(b=><option key={b.id} value={b.id}>{cuotaLbl(b)}</option>)}</select></Fld>
                                <Fld label='1ª factura en'><Inp type='month' value={reactMonth} onChange={e=>setReactMonth(e.target.value)}/></Fld>
                                <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}><button type='button' onClick={()=>setReactOpen(false)} style={chipBtn('soft')}>Cancelar</button><button type='button' disabled={!reactMonth} onClick={reactivar} style={{...chipBtn('primary'),opacity:reactMonth?1:.5}}>Reactivar</button></div>
                              </div>)
                          }
                        </div>
                      )}
                    </div>
                  )}
                </>)
              })()}
              {row('Notas',notasPrev,'notas',true)}
              {openCondicion==='notas'&&(
                <div style={{padding:'8px 12px 12px',borderTop:`1px solid ${C.border}`}}>
                  <Txt value={f.notes||''} onChange={e=>up('notes',e.target.value)} placeholder='Observaciones...'/>
                </div>
              )}
            </div>
            {(()=>{
              const antVenta = (anticipos||[]).filter(a=>String(a.sale_id)===String(sale.id))
              const cuotasV = (billing||[]).filter(b=>String(b.sale_id)===String(sale.id)&&b.billing_type!=='reembolso')
              const nAnt = cuotasV.filter(b=>b.status==='Anticipada').length
              const nProg = cuotasV.filter(b=>b.status==='Programada').length
              if(antVenta.length===0 && nAnt===0) return null
              const fmtDA = iso => { try{ const d=new Date(iso+'T12:00'); return String(d.getDate()).padStart(2,'0')+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+d.getFullYear() }catch(e){return iso||'—'} }
              return (
                <>
                  <div style={{...SEC_LBL,marginBottom:6}}>Anticipos y cuotas</div>
                  <div style={{border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden',marginBottom:10}}>
                    <div style={{display:'flex',gap:14,padding:'10px 12px',background:C.bgSoft,borderBottom:`1px solid ${C.border}`,fontSize:11,color:C.muted}}>
                      <span><strong style={{color:C.greenText}}>{nAnt}</strong> anticipada{nAnt!==1?'s':''}</span>
                      <span><strong style={{color:C.text}}>{nProg}</strong> programada{nProg!==1?'s':''}</span>
                    </div>
                    {antVenta.length===0&&<div style={{padding:'10px 12px',fontSize:12,color:C.muted}}>Sin anticipos en este proyecto.</div>}
                    {antVenta.map(a=>{ const disp=a.estado==='disponible'; const cubre=cuotasV.some(b=>String(b.prepaid_anticipo_id)===String(a.id)); return (
                      <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderBottom:`1px solid ${C.border}`}}>
                        <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:500,color:C.text}}>{fmt(a.monto)}</div><div style={{fontSize:11,color:C.textSoft}}>{fmtDA(a.fecha)}{a.nota?` · ${a.nota}`:''}</div></div>
                        <span style={{fontSize:9.5,fontWeight:700,padding:'2px 8px',borderRadius:20,background:disp?C.greenBg:cubre?C.azulBg:C.bgSoft,color:disp?C.normal:cubre?C.accent:C.done,whiteSpace:'nowrap'}}>{disp?'Disponible':cubre?'En cuotas':'Consumido'}</span>
                        {disp&&onCubrirCuotas&&<button type='button' onClick={()=>setCubrirAnt(a)} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 10px',cursor:'pointer',flexShrink:0}}>Imputar a cuotas</button>}
                        {!disp&&cubre&&!a.billing_id&&onFacturarBloque&&<button type='button' onClick={()=>setFacturarAntS(a)} style={{fontSize:11,fontWeight:600,color:C.accent,background:C.azulBg,border:'none',borderRadius:8,padding:'5px 10px',cursor:'pointer',flexShrink:0}}>Emitir factura</button>}
                        {!disp&&cubre&&onDescubrirCuotas&&<button type='button' onClick={()=>onDescubrirCuotas(a.id)} style={{fontSize:11,fontWeight:600,color:C.muted,background:'none',border:`0.5px solid ${C.border}`,borderRadius:8,padding:'5px 10px',cursor:'pointer',flexShrink:0}}>Deshacer</button>}
                      </div>
                    )})}
                  </div>
                </>
              )
            })()}
          </>
        )
      })()}
      {cubrirAnt&&<PaginaSobre origen='Venta' titulo='Cubrir cuotas con anticipo' ctx={sale?.title||null} onBack={()=>setCubrirAnt(null)}><CubrirCuotasModal asPage anticipo={cubrirAnt} sales={[sale].filter(Boolean)} billing={billing} clients={clients} onConfirm={ids=>{onCubrirCuotas&&onCubrirCuotas(cubrirAnt.id,ids);setCubrirAnt(null)}} onClose={()=>setCubrirAnt(null)}/></PaginaSobre>}
      {facturarAntS&&<PaginaSobre origen='Venta' titulo='Facturar anticipo en bloque' ctx={sale?.title||null} onBack={()=>setFacturarAntS(null)}><FacturarBloqueModal asPage anticipo={facturarAntS} billing={billing} sales={[sale].filter(Boolean)} clients={clients} onConfirm={d=>onFacturarBloque&&onFacturarBloque(facturarAntS,d)} onClose={()=>setFacturarAntS(null)}/></PaginaSobre>}

      {/* 10. Actualizar honorarios (solo ventas activas guardadas) */}
      {sale?.id&&!propBorr&&(
        <div style={{marginTop:6,marginBottom:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:modCobro?10:0}}>
            <span style={{fontSize:13,fontWeight:600,color:C.text}}>Actualizar honorarios</span>
            <Switch on={modCobro} onToggle={()=>{ modCobro ? resetMod() : setModCobro(true) }}/>
          </div>
          {modCobro&&(
            <div>
              <div style={{fontSize:12,color:C.muted,background:C.bgSoft,borderRadius:8,padding:'8px 10px',marginBottom:10,lineHeight:1.4}}>Reemplaza las programadas; las emitidas/pagadas no se tocan.</div>
              <div style={{display:'flex',gap:0,marginBottom:12,border:`0.5px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
                {['ajustar','cambiar'].map(m=>(
                  <button key={m} onClick={()=>setModMode(m)} style={{flex:1,padding:'8px 6px',border:'none',background:modMode===m?C.accent:C.bgSoft,color:modMode===m?'#fff':C.muted,fontSize:12,fontWeight:modMode===m?600:400,cursor:'pointer'}}>
                    {m==='ajustar'?'Ajustar monto':'Cambiar formato'}
                  </button>
                ))}
              </div>
              {modMode==='ajustar'&&(
                <>
                  <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'flex-end'}}>
                    <div style={{flex:'0 0 60%',boxSizing:'border-box'}}>
                      <Lbl>Nuevo honorario</Lbl>
                      <div style={{display:'flex',height:40,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
                        <input type='number' step={moneda==='UF'?'0.01':'1'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder={moneda==='UF'?'0.00':'0'}
                          style={{flex:1,border:'none',padding:'0 10px',fontSize:13,background:C.bgSoft,color:C.text,outline:'none',minWidth:0}} autoFocus/>
                        <select value={moneda} onChange={e=>up('moneda',e.target.value)}
                          style={{width:52,border:'none',borderLeft:`1px solid ${C.border}`,padding:'0 4px',fontSize:12,background:C.bgSoft,color:C.accent,fontWeight:600,cursor:'pointer',outline:'none'}}>
                          <option value='UF'>UF</option>
                          <option value='CLP'>CLP</option>
                        </select>
                      </div>
                    </div>
                    <div style={{flex:'0 0 calc(40% - 8px)',boxSizing:'border-box'}}>
                      <Lbl>Vigente desde</Lbl>
                      <Inp type='month' value={newVig} onChange={e=>setNewVig(e.target.value)} style={{fontSize:11,padding:'10px 6px'}}/>
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:panelCosto>0?4:10}}>
                    <span style={{fontSize:12,color:C.muted,flexShrink:0}}>Agregar costo</span>
                    <div style={{display:'flex',height:34,border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden',flexShrink:0}}>
                      <button type='button' onClick={()=>setNewCostMode('fijo')} style={{padding:'0 10px',border:'none',background:newCostMode==='fijo'?C.accent:C.bgSoft,color:newCostMode==='fijo'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>{moneda}</button>
                      <button type='button' onClick={()=>setNewCostMode('pct')} style={{padding:'0 10px',border:'none',borderLeft:`1px solid ${C.border}`,background:newCostMode==='pct'?C.accent:C.bgSoft,color:newCostMode==='pct'?'#fff':C.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>%</button>
                    </div>
                    <input type='number' step={newCostMode==='pct'?'0.1':'0.01'}
                      value={newCostMode==='pct'?newCostPct:newCosto}
                      onChange={e=>{ if(newCostMode==='pct') setNewCostPct(e.target.value); else setNewCosto(e.target.value) }}
                      placeholder='0'
                      style={{flex:1,padding:'0 10px',height:34,borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,background:C.bgSoft,color:C.text,outline:'none',minWidth:0,boxSizing:'border-box'}}
                    />
                  </div>
                  {panelHon>0&&panelCosto>0&&<div style={{fontSize:12,color:C.muted,marginBottom:10}}>= {moneda==='UF'?fmtUF(panelCosto):fmt(Math.round(panelCosto))} · neto firma <strong style={{color:C.text}}>{moneda==='UF'?fmtUF(panelHon-panelCosto):fmt(Math.round(panelHon-panelCosto))}</strong></div>}
                  {newVig&&(()=>{const progN=(billing||[]).filter(b=>b.sale_id===sale.id&&b.status==='Programada'&&b.due&&b.due>=newVig+'-01').length;return progN>0?<div style={{fontSize:11,color:C.soon,background:'#FFFBF0',border:'0.5px solid #F0D88A',borderRadius:8,padding:'8px 10px',marginBottom:8,lineHeight:1.4}}>Se recalcularán <strong>{progN}</strong> factura{progN!==1?'s':''} programada{progN!==1?'s':''} desde {newVig}.</div>:null})()}
                </>
              )}
              {modMode==='cambiar'&&(
                <>
                  <div style={{...SEC_LBL,marginBottom:8}}>Nuevo formato</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                    {[{k:'mensual',lbl:'Mensual',desc:'Cobro recurrente / mes'},{k:'cuotas',lbl:'Cuotas iguales',desc:'N cuotas de igual valor'},{k:'personalizada',lbl:'Personalizada',desc:'Montos y fechas libres'},{k:'unico',lbl:'Pago único',desc:'Un solo cobro'},{k:'hora',lbl:'Por hora',desc:'Tarifa + tope; se factura por horas'}].map(({k,lbl,desc})=>(
                      <div key={k} onClick={()=>setNewFmt(k)} style={{padding:'10px 10px 8px',borderRadius:10,border:`0.5px solid ${newFmt===k?C.accent:C.border}`,background:newFmt===k?'#EDF3F5':'transparent',cursor:'pointer'}}>
                        <div style={{fontSize:12,fontWeight:newFmt===k?600:400,color:newFmt===k?C.accent:C.text,marginBottom:2}}>{lbl}</div>
                        <div style={{fontSize:10,color:C.muted,lineHeight:1.3}}>{desc}</div>
                      </div>
                    ))}
                  </div>
                  <Fld label='Vigente desde'><Inp type='month' value={newVig} onChange={e=>setNewVig(e.target.value)}/></Fld>
                  {newFmt==='cuotas'&&(
                    <div style={{background:C.bgSoft,borderRadius:10,padding:'12px',border:`0.5px solid ${C.border}`,margin:'8px 0'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                        <Fld label='N.° de cuotas'><Inp type='number' value={newNCuotas} onChange={e=>setNewNCuotas(parseInt(e.target.value)||3)} placeholder='3'/></Fld>
                        <Fld label={`Monto total (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                        <Fld label='Primera cuota'><Inp type='month' value={newCobroInicio} onChange={e=>setNewCobroInicio(e.target.value)}/></Fld>
                        <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                      </div>
                      {newHon&&newNCuotas>0&&(()=>{const tot=moneda==='CLP'?parseFloat(newHon)||0:(parseFloat(newHon)||0)*ufVal;const mc=tot>0?Math.round(tot/newNCuotas):0;return mc>0?<div style={{fontSize:11,color:C.muted,background:'#fff',borderRadius:6,padding:'6px 8px',border:`0.5px solid ${C.border}`}}>{newNCuotas} cuotas de <strong style={{color:C.accent}}>{fmt(mc)}</strong></div>:null})()}
                    </div>
                  )}
                  {newFmt==='mensual'&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'8px 0'}}>
                      <Fld label={`Nuevo monto (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                      <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                    </div>
                  )}
                  {newFmt==='personalizada'&&(
                    <div style={{background:C.bgSoft,borderRadius:10,padding:'12px',border:`0.5px solid ${C.border}`,margin:'8px 0'}}>
                      {newCuotasCustom.map((c,i)=>(
                        <div key={c.id} style={{display:'grid',gridTemplateColumns:'1fr 1fr 28px',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                          <Fld label={i===0?`Monto (${moneda})`:''}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={c.monto} onChange={e=>setNewCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,monto:e.target.value}:x))}/></Fld>
                          <Fld label={i===0?'Fecha':''}><Inp type='date' value={c.fecha} onChange={e=>setNewCuotasCustom(p=>p.map(x=>x.id===c.id?{...x,fecha:anio4ISO(e.target.value)}:x))}/></Fld>
                          {newCuotasCustom.length>1&&<button onClick={()=>setNewCuotasCustom(p=>p.filter(x=>x.id!==c.id))} style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:18,paddingBottom:2}}><Gl n='x'/></button>}
                        </div>
                      ))}
                      <button onClick={()=>setNewCuotasCustom(p=>[...p,{id:Date.now(),monto:'',fecha:''}])} style={{fontSize:12,color:C.accent,background:'none',border:'none',cursor:'pointer',fontWeight:600}}>+ Agregar cuota</button>
                    </div>
                  )}
                  {newFmt==='unico'&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,margin:'8px 0'}}>
                      <Fld label={`Monto (${moneda})`}><Inp type='number' step={moneda==='CLP'?'1':'0.01'} value={newHon} onChange={e=>setNewHon(e.target.value)} placeholder='0'/></Fld>
                      <Fld label='Costo (opc.)'><Inp type='number' value={newCosto} onChange={e=>setNewCosto(e.target.value)} placeholder='0'/></Fld>
                    </div>
                  )}
                  {newFmt==='hora'&&(
                    <div style={{background:C.azulBg,border:'0.5px solid #CFE0EC',borderRadius:10,padding:'12px',margin:'8px 0'}}>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                        <Fld label='Tarifa (UF/hora)'><Inp type='number' step='0.1' value={tarifaHoraUF} onChange={e=>setTarifaHoraUF(e.target.value)} placeholder='3.0'/></Fld>
                        <Fld label='Tope de horas'><Inp type='number' value={topeHoras} onChange={e=>setTopeHoras(e.target.value)} placeholder='Ej: 20'/></Fld>
                      </div>
                      <div style={{display:'flex',gap:6,marginTop:8}}>
                        {[['mes','Por mes'],['total','Total']].map(([v,l])=><button key={v} type='button' onClick={()=>setTopePeriodo(v)} style={{flex:1,padding:'7px',borderRadius:8,border:`1.5px solid ${topePeriodo===v?C.accent:C.border}`,background:topePeriodo===v?'#fff':C.bgSoft,color:topePeriodo===v?C.accent:C.muted,fontSize:11,fontWeight:700,cursor:'pointer'}}>{l}</button>)}
                      </div>
                      <div style={{fontSize:11,color:C.greenText,marginTop:8,lineHeight:1.4}}>Sin monto fijo — se factura por las horas registradas. No genera cuotas.</div>
                    </div>
                  )}
                  {newVig&&newFmt&&(()=>{const vigDate=newVig+'-01';const progN=(billing||[]).filter(b=>b.sale_id===sale.id&&b.status==='Programada'&&b.due&&b.due>=vigDate).length; const hora=newFmt==='hora'; return <div style={{fontSize:11,color:C.soonText,background:C.soonBg,border:'0.5px solid #EBD9AE',borderRadius:8,padding:'8px 10px',margin:'8px 0',lineHeight:1.4}}>{hora?<>Se <strong>cancelan {progN}</strong> cuota{progN!==1?'s':''} programada{progN!==1?'s':''} desde {newVig} y la venta pasa a <strong>cobro por hora</strong>.</>:<>Reemplaza <strong>{progN}</strong> factura{progN!==1?'s':''} programada{progN!==1?'s':''} desde {newVig}.</>} Las emitidas/pagadas no se tocan.</div>})()}
                </>
              )}
            </div>
          )}
          {/* 10. Historial de honorarios */}
          <div style={{marginTop:modCobro?14:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <div onClick={()=>setHistAbierto(o=>!o)} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
              <Lbl>Historial de honorarios</Lbl>{tariffs.length>0&&<span style={{fontSize:11,color:C.muted}}>· {tariffs.length}</span>}
              <span style={{marginLeft:'auto',fontSize:12,color:C.muted}}>{histAbierto?<Gl n='chevD'/>:<Gl n='chevron'/>}</span>
            </div>
            {histAbierto&&<>
            {tariffs.length===0&&<div style={{fontSize:12,color:C.muted,padding:'4px 0'}}>Sin historial registrado.</div>}
            {tariffs.map((t,i)=>{
              const vigente=i===tariffs.length-1
              const cur=t.currency||'UF'
              return (
                <div key={t.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text}}>Desde {fmtMesAno(t.vigente_desde)}</div>
                    {t.motivo&&<div style={{fontSize:10,color:C.muted}}>{t.motivo}</div>}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{cur==='CLP'?fmt(t.honorario):fmtUF(t.honorario)}</div>
                      {t.costo>0&&<div style={{fontSize:10,color:C.overdue}}>Costo {cur==='CLP'?fmt(t.costo):fmtUF(t.costo)}</div>}
                    </div>
                    <span style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:.4,padding:'2px 7px',borderRadius:4,background:vigente?C.greenBg:C.border,color:vigente?C.greenText:C.muted}}>{vigente?'Vigente':'Histórico'}</span>
                  </div>
                </div>
              )
            })}
            </>}
          </div>
        </div>
      )}

      {/* 11. Botones — CTA principal full-width abajo, acciones secundarias arriba (responsive móvil) */}
      <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:6}}>
        {sale?.id&&sale?.status==='Activo'&&!_activandoPropuesta&&!modCobro&&onPrimerasTareas&&
          <button type='button' disabled={saving} onClick={()=>handleSave({_thenPrimerasTareas:true})} title='Guarda la venta y abre la generación de tareas con IA' style={{width:'100%',padding:'9px 14px',borderRadius:10,border:`1px solid ${C.azulInfo}`,background:C.azulBg,color:C.azulInfo,fontSize:13,fontWeight:600,cursor:saving?'default':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8z"/></svg>Primeras tareas con IA
          </button>}
        <div style={{display:'flex',gap:8}}>
          {(!asPage||modCobro)&&<button onClick={modCobro?resetMod:onClose} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.border}`,background:'transparent',color:C.muted,fontSize:13,fontWeight:600,cursor:'pointer'}}>Cancelar</button>}
          {!sale?.id&&!modCobro&&<button disabled={saving} onClick={handleSaveDraft} style={{flex:1,padding:'9px 14px',borderRadius:10,border:`1px solid ${C.accent}`,background:'transparent',color:C.accent,fontSize:13,fontWeight:600,cursor:'pointer'}}>Borrador</button>}
          {sale?.id&&<button onClick={()=>onDelete(sale.id)} style={{flex:1,padding:'11px 0',borderRadius:10,border:`1px solid ${C.overdue}`,background:'transparent',color:C.overdue,fontSize:13,fontWeight:600,cursor:'pointer'}}>Eliminar</button>}
        </div>
        <button disabled={saving||savingTariff||!f.client_id||!f.title} onClick={modCobro?confirmAndSave:()=>handleSave()}
          style={{width:'100%',padding:13,borderRadius:10,border:'none',background:_activandoPropuesta?C.normal:C.accent,color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,opacity:(!f.client_id||!f.title)?.6:1}}>
          {(saving||savingTariff)?<Spin/>:null}{(saving||savingTariff)?'Guardando...':modCobro?'Confirmar y guardar':_activandoPropuesta?'Activar propuesta':'Guardar'}
        </button>
      </div>
    </>
  )
}

